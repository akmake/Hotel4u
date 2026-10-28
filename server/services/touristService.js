// EXT-04 / IL09 / IL11 — guests who are not Israeli residents.
//
// The desk records the evidence (non-resident declaration, passport country, entry visa type, entry
// date, last 4 digits of the document). What it means for tax is decided by the property's rule
// (Property.taxPolicy.tourist), which stays OFF until the property's accountant approves it (gate
// G04) — never "foreign passport = no VAT". The decision for a stay is one of:
//   none        — nothing recorded;
//   resident    — Israeli passport or no non-resident declaration → regular VAT;
//   pending_rule— evidence recorded, but the property has no approved rule → regular VAT;
//   ineligible  — the approved rule is not met (e.g. visa type not in the list) → regular VAT;
//   eligible    — the approved rule is met → the rule's charge codes post at 0% VAT.
// Lines already posted keep their VAT; a change is corrected by reversal and re-posting.
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import GuestProfile from '../models/GuestProfile.js';
import Folio from '../models/Folio.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf, MANAGER_ROLES } from './frontDeskService.js';

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const TAX_ADMIN_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const DESK_ROLES = [...MANAGER_ROLES, 'receptionist'];
export const DECISION_LABELS = {
  none: 'לא נרשם', resident: 'תושב ישראל — מע״מ רגיל', declared: 'הוצהר תייר בהזמנה — ראיות יושלמו בכניסה (עד אז מע״מ רגיל)', pending_rule: 'נרשם כתייר — הנכס טרם אישר כלל פטור (מע״מ רגיל)',
  ineligible: 'לא עומד בכלל הפטור — מע״מ רגיל', eligible: 'זכאי — לינה ללא מע״מ לפי כלל הנכס',
};

const normVisa = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function decide(tourist, rule) {
  if (!tourist || (!tourist.nonResident && !tourist.passportCountry)) return { decision: 'none', reason: null };
  if (tourist.nonResident && !tourist.passportCountry && !tourist.recordedAt) return { decision: 'declared', reason: 'חסרות ראיות (דרכון, אשרה, תאריך כניסה)' };
  if (!tourist.nonResident || String(tourist.passportCountry || '').toUpperCase() === 'IL') return { decision: 'resident', reason: tourist.passportCountry === 'IL' ? 'דרכון ישראלי' : 'לא הוצהר שאינו תושב ישראל' };
  if (!rule?.enabled) return { decision: 'pending_rule', reason: 'אין בנכס כלל פטור מאושר' };
  const allowed = (rule.visaTypes || []).map(normVisa).filter(Boolean);
  if (allowed.length && !allowed.includes(normVisa(tourist.visaType))) return { decision: 'ineligible', reason: `סוג האשרה ${tourist.visaType || '—'} אינו ברשימה המאושרת` };
  if (!tourist.passportCountry || !tourist.entryDate) return { decision: 'ineligible', reason: 'חסרות ראיות (מדינת דרכון / תאריך כניסה)' };
  return { decision: 'eligible', reason: null };
}

async function ruleOf(propertyId, session = null) {
  const p = await Property.findById(propertyId).session(session).select('taxPolicy vatRate timezone dayClose').lean();
  return { rule: p?.taxPolicy?.tourist || { enabled: false }, vatRate: p?.vatRate ?? 18, property: p };
}

// VAT for a line of this reservation under this charge code (used by every posting path).
export async function vatForLine({ reservation, code, propertyVatRate, session = null }) {
  const t = reservation?.tourist;
  if (!t?.nonResident) return { rate: propertyVatRate, reason: null };
  const { rule } = await ruleOf(reservation.property, session);
  const { decision } = decide(t, rule);
  if (decision === 'eligible' && (rule.chargeCodes || ['rooms']).includes(code)) {
    // strip: the tourist pays the shelf price without its VAT part (property pricing choice).
    return { rate: 0, reason: `tourist_rule_v${rule.version || 0}`, strip: (rule.pricing || 'net_of_vat') === 'net_of_vat', propertyVatRate };
  }
  return { rate: propertyVatRate, reason: null };
}

function dto(res, rule, postedWithVat) {
  const t = res.tourist || {};
  const { decision, reason } = decide(t, rule);
  return {
    reservationId: String(res._id),
    recorded: !!t.recordedAt,
    evidence: { nonResident: !!t.nonResident, passportCountry: t.passportCountry || null, visaType: t.visaType || null, entryDate: t.entryDate || null, docLast4: t.docLast4 || null, note: t.note || null },
    recordedBy: t.recordedByName || null, recordedAt: t.recordedAt || null,
    decision, decisionLabel: DECISION_LABELS[decision], reason,
    rule: { enabled: !!rule.enabled, visaTypes: rule.visaTypes || [], chargeCodes: rule.chargeCodes || ['rooms'], approvedBy: rule.approvedBy || null, version: rule.version || 0, pricing: rule.pricing || 'net_of_vat' },
    postedWithVat,
  };
}

export async function getTourist({ propertyId, reservationId }) {
  if (!isId(String(reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).select('tourist primaryGuest property').lean();
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  const { rule } = await ruleOf(propertyId);
  const lines = (await Folio.find({ reservation: res._id }).select('lines').lean()).flatMap((f) => f.lines);
  const reversed = new Set(lines.filter((l) => l.reversalOf).map((l) => String(l.reversalOf)));
  const codes = rule.chargeCodes || ['rooms'];
  const postedWithVat = lines.filter((l) => l.status === 'posted' && l.type === 'charge' && codes.includes(l.department) && Number(l.taxAmount) > 0 && !reversed.has(String(l._id))).length;
  // Prefill from the guest profile (citizenship) when nothing was recorded on this stay yet.
  let prefill = null;
  if (!res.tourist?.recordedAt && res.primaryGuest) {
    const g = await GuestProfile.findById(res.primaryGuest).select('citizenship residency').lean();
    if (g?.citizenship || g?.residency) prefill = { passportCountry: g.citizenship || null, residency: g.residency || null };
  }
  return { ...dto(res, rule, postedWithVat), prefill };
}

export async function recordTourist({ propertyId, reservationId, input, actor, ip }) {
  if (!DESK_ROLES.includes(actor.role) && !TAX_ADMIN_ROLES.includes(actor.role)) throw httpError('רישום מעמד תייר מתבצע בקבלה', 403);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId });
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  if (['cancelled', 'no_show'].includes(res.status)) throw httpError('לא רושמים מעמד להזמנה שבוטלה', 409);
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const nonResident = !!input.nonResident;
  const country = String(input.passportCountry || '').trim().toUpperCase();
  const visa = String(input.visaType || '').trim().slice(0, 20);
  const entry = String(input.entryDate || '').trim();
  const last4 = String(input.docLast4 || '').replace(/\D/g, '').slice(-4);
  const fields = {};
  if (nonResident) {
    if (!/^[A-Z]{2}$/.test(country)) fields.passportCountry = 'מדינת הדרכון (קוד בן 2 אותיות)';
    if (country === 'IL') fields.passportCountry = 'דרכון ישראלי — האורח אינו תייר לעניין זה';
    if (!visa) fields.visaType = 'סוג אשרת הכניסה';
    if (!YMD.test(entry)) fields.entryDate = 'תאריך הכניסה לישראל';
    else if (entry > today) fields.entryDate = 'תאריך כניסה עתידי';
    if (last4 && last4.length !== 4) fields.docLast4 = '4 ספרות אחרונות';
  }
  if (Object.keys(fields).length) throw httpError('יש להשלים את ראיות המעמד', 422, { fields });
  const before = res.tourist ? { nonResident: !!res.tourist.nonResident, passportCountry: res.tourist.passportCountry, visaType: res.tourist.visaType } : null;
  res.tourist = nonResident
    ? { nonResident: true, passportCountry: country, visaType: visa, entryDate: entry, docLast4: last4 || undefined, note: input.note ? String(input.note).slice(0, 300) : undefined, recordedAt: new Date(), recordedBy: actor.id || undefined, recordedByName: actor.name }
    : { nonResident: false, recordedAt: new Date(), recordedBy: actor.id || undefined, recordedByName: actor.name };
  await res.save();
  // The guest profile keeps citizenship / residency for next time (residency ≠ tax status).
  if (res.primaryGuest && nonResident) await GuestProfile.updateOne({ _id: res.primaryGuest }, { $set: { citizenship: country, residency: 'non_resident' } });
  const { rule } = await ruleOf(propertyId);
  const out = await getTourist({ propertyId, reservationId });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.tourist_recorded', entityType: 'Reservation', entityId: res._id, before, after: { nonResident, passportCountry: country || null, visaType: visa || null, entryDate: entry || null, hasDocLast4: !!last4, decision: decide(res.tourist, rule).decision }, ip });
  return out;
}

// ADM-04 — the property's tourist rule (gate G04: approved by the accountant, with the legal basis).
export async function getTaxPolicy({ propertyId }) {
  const { rule } = await ruleOf(propertyId);
  const fp = (await Property.findById(propertyId).select('financePolicy').lean())?.financePolicy || {};
  return { cash: { rule: fp.cashRule || 'none', threshold: fp.cashThreshold ?? 6000, touristThreshold: fp.touristCashThreshold ?? 40000 }, tourist: { pricing: rule.pricing || 'net_of_vat', enabled: !!rule.enabled, visaTypes: rule.visaTypes || [], chargeCodes: rule.chargeCodes || ['rooms'], legalRef: rule.legalRef || '', approvedBy: rule.approvedBy || '', approvedAt: rule.approvedAt || null, version: rule.version || 0, updatedBy: rule.updatedByName || null } };
}

export async function updateTaxPolicy({ propertyId, input, actor, ip }) {
  if (!TAX_ADMIN_ROLES.includes(actor.role)) throw httpError('כלל המס מוגדר על ידי הנהלה או כספים', 403);
  const t = input.tourist || {};
  const { rule } = await ruleOf(propertyId);
  if (input.version !== undefined && Number(input.version) !== Number(rule.version || 0)) throw httpError('הכלל עודכן בינתיים — רעננו', 409, { code: 'stale' });
  const visaTypes = [...new Set((Array.isArray(t.visaTypes) ? t.visaTypes : []).map((v) => String(v).trim().toUpperCase()).filter(Boolean))].slice(0, 20);
  const chargeCodes = [...new Set((Array.isArray(t.chargeCodes) ? t.chargeCodes : ['rooms']).map(String).filter(Boolean))].slice(0, 20);
  const fields = {};
  const enabled = !!t.enabled;
  if (enabled) {
    if (String(t.approvedBy || '').trim().length < 2) fields.approvedBy = 'שם רואה החשבון שאישר';
    if (String(t.legalRef || '').trim().length < 3) fields.legalRef = 'הבסיס החוקי (חוק/תקנה/סעיף)';
    if (!visaTypes.length) fields.visaTypes = 'לפחות סוג אשרה אחד שאושר';
    if (!chargeCodes.length) fields.chargeCodes = 'לפחות קוד חיוב אחד';
  }
  if (String(input.reason || '').trim().length < 3) fields.reason = 'סיבת השינוי';
  if (Object.keys(fields).length) throw httpError('יש להשלים את פרטי הכלל', 422, { fields });
  const next = {
    enabled, visaTypes, chargeCodes, pricing: t.pricing === 'same_price' ? 'same_price' : 'net_of_vat', legalRef: String(t.legalRef || '').trim().slice(0, 300), approvedBy: String(t.approvedBy || '').trim().slice(0, 120),
    approvedAt: enabled ? new Date() : rule.approvedAt || undefined, version: Number(rule.version || 0) + 1, updatedByName: actor.name,
  };
  const set = { 'taxPolicy.tourist': next };
  if (input.cash) {
    const c = input.cash;
    if (!['none', 'il_2024'].includes(c.rule)) throw httpError('כלל מזומן לא מוכר', 422, { fields: { cashRule: 'לא מוכר' } });
    const th = Number(c.threshold); const tth = Number(c.touristThreshold);
    if (c.rule === 'il_2024' && (!(th > 0) || !(tth > 0))) throw httpError('ספי המזומן חייבים להיות חיוביים', 422, { fields: { cashThreshold: 'סכום חיובי' } });
    Object.assign(set, { 'financePolicy.cashRule': c.rule, ...(th > 0 ? { 'financePolicy.cashThreshold': th } : {}), ...(tth > 0 ? { 'financePolicy.touristCashThreshold': tth } : {}) });
  }
  await Property.updateOne({ _id: propertyId }, { $set: set });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'tax_policy.tourist_updated', entityType: 'Property', entityId: propertyId, before: { enabled: !!rule.enabled, visaTypes: rule.visaTypes || [], chargeCodes: rule.chargeCodes || [], version: rule.version || 0 }, after: { enabled, visaTypes, chargeCodes, approvedBy: next.approvedBy, legalRef: next.legalRef, version: next.version, cash: input.cash || undefined }, reason: String(input.reason).trim(), ip });
  return getTaxPolicy({ propertyId });
}

// IL11 — cash allowed for this stay under the property's cash rule (null = no legal rule applied).
export async function cashAllowance({ reservation, propertyFinance, transactionPrice }) {
  if (propertyFinance?.cashRule !== 'il_2024') return null;
  const t = reservation?.tourist;
  const verifiedTourist = !!(t?.nonResident && t.passportCountry && t.passportCountry !== 'IL' && t.entryDate);
  const threshold = Number(verifiedTourist ? (propertyFinance.touristCashThreshold ?? 40000) : (propertyFinance.cashThreshold ?? 6000));
  const price = Number(transactionPrice || 0);
  const limit = price <= threshold ? Infinity : Math.min(price * 0.1, threshold);
  return { limit, threshold, price, tourist: verifiedTourist };
}
