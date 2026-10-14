// ADM-05 — operating and cancellation policy of the property.
//
// Business rules (check-in readiness, guarantees, child age, pets, the contractual cancellation
// window) are kept apart from legal rights: the cancellation-law engine (RSV-06) reads only the
// rest-day calendar from here and still flags its result for legal review (gate G06).
// Publishing bumps the policy version; existing bookings keep the terms frozen on them. Changing
// the guest-facing terms text requires a named approver and a new terms version.
import Property from '../models/Property.js';
import AuditLog from '../models/AuditLog.js';
import { audit } from './auditService.js';

function httpError(message, status = 400, extra = {}) { const e = new Error(message); e.status = status; Object.assign(e, extra); return e; }
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const POLICY_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
const FIELDS = 'name checkInTime checkOutTime checkInPolicy opsPolicy financePolicy defaultCancellationHours defaultCancellationFee petPolicy smokingPolicy restDays childMaxAge policyVersion policyPublishedAt policyPublishedBy';

function view(p) {
  const fee = p.defaultCancellationFee;
  return {
    version: p.policyVersion || 0, publishedAt: p.policyPublishedAt || null, publishedBy: p.policyPublishedBy || null,
    checkInTime: p.checkInTime || '15:00', checkOutTime: p.checkOutTime || '11:00',
    readiness: p.checkInPolicy?.requireInspection ? 'inspected' : 'clean',
    requireGuarantee: p.checkInPolicy?.requireGuarantee !== false,
    requireRegistration: p.checkInPolicy?.requireRegistration !== false,
    requireSignature: !!p.checkInPolicy?.requireSignature,
    terms: { version: p.checkInPolicy?.termsVersion || 'he-1', text: p.checkInPolicy?.termsText || '', approvedBy: p.checkInPolicy?.termsApprovedBy || null, approvedAt: p.checkInPolicy?.termsApprovedAt || null },
    inspectorMustDiffer: p.opsPolicy?.inspectorMustDiffer !== false,
    cancellation: {
      freeHours: Number(p.defaultCancellationHours ?? 24),
      fee: fee === 'none' ? { type: 'none' } : !Number.isNaN(Number(fee)) && fee !== '' && fee !== null && fee !== undefined && fee !== 'first_night' ? { type: 'fixed', amount: Number(fee) } : { type: 'first_night' },
    },
    finance: { cashLimitPerStay: p.financePolicy?.cashLimitPerStay ?? null, refundApprovalOver: p.financePolicy?.refundApprovalOver ?? 0 },
    childMaxAge: p.childMaxAge ?? null,
    petPolicy: p.petPolicy || 'not_allowed', smokingPolicy: p.smokingPolicy || 'non_smoking',
    restDays: (p.restDays || []).slice().sort(),
  };
}

export async function getPolicy({ propertyId }) {
  const p = await Property.findById(propertyId).select(FIELDS).lean();
  if (!p) throw httpError('הנכס לא נמצא', 404);
  const history = await AuditLog.find({ property: propertyId, action: 'policy.published' }).sort({ createdAt: -1 }).limit(10).select('actorName createdAt reason after.version after.changed').lean();
  return { ...view(p), history: history.map((h) => ({ version: h.after?.version ?? null, by: h.actorName, at: h.createdAt, reason: h.reason || null, changed: h.after?.changed || [] })) };
}

export async function publishPolicy({ propertyId, input, actor, ip }) {
  if (!POLICY_ROLES.includes(actor.role)) throw httpError('פרסום מדיניות מותר למנהל נכס', 403);
  const p = await Property.findById(propertyId);
  if (!p) throw httpError('הנכס לא נמצא', 404);
  const before = view(p.toObject());
  if (input.version !== undefined && Number(input.version) !== before.version) throw httpError('המדיניות עודכנה בינתיים — רעננו ובדקו שוב', 409, { code: 'version_conflict' });
  const fields = {};
  const why = String(input.reason || '').trim().slice(0, 300);
  if (why.length < 3) fields.reason = 'סיבת השינוי נדרשת';
  if (input.checkInTime !== undefined && !HHMM.test(input.checkInTime)) fields.checkInTime = 'שעה HH:MM';
  if (input.checkOutTime !== undefined && !HHMM.test(input.checkOutTime)) fields.checkOutTime = 'שעה HH:MM';
  if (input.readiness !== undefined && !['clean', 'inspected'].includes(input.readiness)) fields.readiness = 'clean או inspected';
  const c = input.cancellation || {};
  if (c.freeHours !== undefined && !(Number.isInteger(Number(c.freeHours)) && Number(c.freeHours) >= 0 && Number(c.freeHours) <= 24 * 60)) fields.freeHours = '0 עד 1440 שעות';
  if (c.fee?.type && !['none', 'first_night', 'fixed'].includes(c.fee.type)) fields.fee = 'סוג לא מוכר';
  if (c.fee?.type === 'fixed' && !(Number(c.fee.amount) > 0)) fields.feeAmount = 'סכום חיובי';
  const f = input.finance || {};
  if (f.cashLimitPerStay !== undefined && f.cashLimitPerStay !== null && f.cashLimitPerStay !== '' && !(Number(f.cashLimitPerStay) > 0)) fields.cashLimitPerStay = 'סכום חיובי או ריק';
  if (f.refundApprovalOver !== undefined && !(Number(f.refundApprovalOver) >= 0)) fields.refundApprovalOver = '0 ומעלה';
  if (input.childMaxAge !== undefined && input.childMaxAge !== null && input.childMaxAge !== '' && !(Number.isInteger(Number(input.childMaxAge)) && Number(input.childMaxAge) >= 0 && Number(input.childMaxAge) <= 17)) fields.childMaxAge = '0 עד 17';
  if (input.petPolicy !== undefined && !['not_allowed', 'on_request', 'allowed'].includes(input.petPolicy)) fields.petPolicy = 'לא מוכר';
  if (input.smokingPolicy !== undefined && !['non_smoking', 'designated_areas', 'allowed'].includes(input.smokingPolicy)) fields.smokingPolicy = 'לא מוכר';
  let restDays = null;
  if (input.restDays !== undefined) {
    restDays = [...new Set((Array.isArray(input.restDays) ? input.restDays : []).map(String))];
    if (restDays.some((d) => !YMD.test(d))) fields.restDays = 'תאריכים בפורמט YYYY-MM-DD';
    if (restDays.length > 400) fields.restDays = 'עד 400 ימים';
  }
  const termsChanged = input.terms?.text !== undefined && String(input.terms.text).trim() !== before.terms.text.trim();
  if (termsChanged) {
    if (String(input.terms.approvedBy || '').trim().length < 2) fields.termsApprovedBy = 'שינוי נוסח התנאים מחייב שם המאשר';
    if (String(input.terms.text).length > 20000) fields.termsText = 'עד 20,000 תווים';
  }
  if (Object.keys(fields).length) throw httpError('יש לתקן את המדיניות', 422, { fields });

  if (input.checkInTime !== undefined) p.checkInTime = input.checkInTime;
  if (input.checkOutTime !== undefined) p.checkOutTime = input.checkOutTime;
  p.checkInPolicy = p.checkInPolicy || {};
  if (input.readiness !== undefined) p.checkInPolicy.requireInspection = input.readiness === 'inspected';
  if (input.requireGuarantee !== undefined) p.checkInPolicy.requireGuarantee = !!input.requireGuarantee;
  if (input.requireRegistration !== undefined) p.checkInPolicy.requireRegistration = !!input.requireRegistration;
  if (input.requireSignature !== undefined) p.checkInPolicy.requireSignature = !!input.requireSignature;
  if (termsChanged) {
    const n = Number(String(before.terms.version).replace(/\D/g, '')) || 1;
    p.checkInPolicy.termsVersion = `he-${n + 1}`;
    p.checkInPolicy.termsText = String(input.terms.text).trim();
    p.checkInPolicy.termsApprovedBy = String(input.terms.approvedBy).trim().slice(0, 120);
    p.checkInPolicy.termsApprovedAt = new Date();
  }
  if (input.inspectorMustDiffer !== undefined) { p.opsPolicy = p.opsPolicy || {}; p.opsPolicy.inspectorMustDiffer = !!input.inspectorMustDiffer; }
  if (c.freeHours !== undefined) p.defaultCancellationHours = Number(c.freeHours);
  if (c.fee?.type) p.defaultCancellationFee = c.fee.type === 'fixed' ? String(Number(c.fee.amount)) : c.fee.type;
  p.financePolicy = p.financePolicy || {};
  if (f.cashLimitPerStay !== undefined) p.financePolicy.cashLimitPerStay = f.cashLimitPerStay === null || f.cashLimitPerStay === '' ? null : Number(f.cashLimitPerStay);
  if (f.refundApprovalOver !== undefined) p.financePolicy.refundApprovalOver = Number(f.refundApprovalOver);
  if (input.childMaxAge !== undefined) p.childMaxAge = input.childMaxAge === null || input.childMaxAge === '' ? null : Number(input.childMaxAge);
  if (input.petPolicy !== undefined) p.petPolicy = input.petPolicy;
  if (input.smokingPolicy !== undefined) p.smokingPolicy = input.smokingPolicy;
  if (restDays) p.restDays = restDays.sort();
  p.policyVersion = before.version + 1;
  p.policyPublishedAt = new Date();
  p.policyPublishedBy = actor.name;
  p.markModified('checkInPolicy'); p.markModified('opsPolicy'); p.markModified('financePolicy');
  await p.save();
  const after = view(p.toObject());
  const changed = Object.keys(after).filter((k) => !['version', 'publishedAt', 'publishedBy'].includes(k) && JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'policy.published', entityType: 'Property', entityId: propertyId, reason: why, before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: { version: after.version, changed, ...Object.fromEntries(changed.map((k) => [k, after[k]])) }, ip });
  return { ...after, changed, impact: 'חל על כניסות ועל הזמנות חדשות מעכשיו. הזמנות קיימות שומרות את תנאי הביטול והמחיר שנשמרו בהן.' };
}
