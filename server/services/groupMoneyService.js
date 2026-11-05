// Group money (gap-map item 6, knowledge 14 §6).
//  - billing profile: lines by category, a discount with a reason (above the property threshold it
//    needs a manager), VAT, payment terms and a due date → the amount the group is expected to pay;
//  - a suggestion from the group itself: rooms × nights × the group price, and every priced item of
//    the programme × max(participants, the minimum the client committed to);
//  - payments: recorded with their proof (attachments), pending until finance approves. Approval posts
//    the money to the group's account (a house folio of outlet "groups") through the money core —
//    in advance as a deposit, capped by the expected amount. Receipts are issued from that account
//    through the invoicing system, like any folio.
import { can } from './permissionService.js';
import mongoose from 'mongoose';
import GroupBlock from '../models/GroupBlock.js';
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import { GroupProgramItem } from '../models/GroupProgram.js';
import { GroupPayment, GroupAttachment, GROUP_PAY_METHODS } from '../models/GroupMoney.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { DISCOUNT_REASONS, PRICE_OVERRIDE_ROLES } from './bookingService.js';
import { getStayDates } from './availabilityService.js';

const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DEAD_RES = ['cancelled', 'no_show', 'deleted', 'draft'];

export const BILLING_CATEGORIES = { lodging: 'לינה', meals: 'ארוחות', activities: 'פעילויות', transport: 'הסעות', equipment: 'ציוד', other: 'אחר' };
export const PAYMENT_TERMS = { immediate: 'מיידי', net15: 'שוטף + 15', net30: 'שוטף + 30', net60: 'שוטף + 60', custom: 'תנאי אחר' };
export const METHOD_LABELS = { cash: 'מזומן', credit_card: 'כרטיס אשראי', bank_transfer: 'העברה בנקאית', cheque: 'שיק' };
export const MONEY_APPROVE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const ATTACH_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const ATTACH_MAX = 5 * 1024 * 1024;

async function loadGroup(propertyId, id, session = null) {
  if (!isId(id)) throw httpError('מזהה קבוצה לא תקין', 400);
  const g = await GroupBlock.findOne({ _id: id, property: propertyId }).session(session);
  if (!g) throw httpError('הקבוצה לא נמצאה', 404);
  return g;
}

// Totals of a billing profile: lines − discount (+ VAT when the lines are before VAT).
export function billingTotals(b) {
  if (!b) return { subtotal: 0, discount: 0, net: 0, vat: 0, total: 0 };
  const subtotal = round2((b.lines || []).reduce((s, l) => s + Number(l.amount || 0), 0));
  const d = b.discount?.kind ? (b.discount.kind === 'percent' ? round2(subtotal * Number(b.discount.value || 0) / 100) : round2(b.discount.value || 0)) : 0;
  const after = round2(Math.max(0, subtotal - d));
  const rate = Number(b.vatRate ?? 18);
  const vat = b.vatIncluded === false ? round2(after * rate / 100) : round2(after - after / (1 + rate / 100));
  const total = b.vatIncluded === false ? round2(after + vat) : after;
  return { subtotal, discount: d, net: round2(total - vat), vat, total };
}

export async function groupExpected(propertyId, groupId, session = null) {
  const g = await GroupBlock.findOne({ _id: groupId, property: propertyId }).select('billing').session(session).lean();
  return billingTotals(g?.billing).total;
}

// What the group would cost from its own data — the desk starts the profile from it.
export async function suggestBilling({ propertyId, id }) {
  const g = await loadGroup(propertyId, id);
  const nights = getStayDates(g.arrivalDate, g.departureDate).length;
  const lines = [];
  const rooms = (g.allotments || []).filter((a) => (a.blocked || 0) - (a.released || 0) > 0);
  const priced = rooms.filter((a) => a.negotiatedRate > 0);
  if (priced.length) {
    const amount = round2(priced.reduce((s, a) => s + ((a.blocked || 0) - (a.released || 0)) * nights * a.negotiatedRate, 0));
    lines.push({ category: 'lodging', description: `לינה · ${priced.map((a) => `${(a.blocked || 0) - (a.released || 0)} × ${a.roomTypeName}`).join(', ')} · ${nights} לילות`, amount });
  } else if (rooms.length) {
    const res = await Reservation.find({ property: propertyId, group: String(g._id), status: { $nin: DEAD_RES } }).select('totalAmount').lean();
    const amount = round2(res.reduce((s, r) => s + (r.totalAmount || 0), 0));
    if (amount > 0) lines.push({ category: 'lodging', description: `לינה · ${res.length} הזמנות`, amount });
  }
  const items = await GroupProgramItem.find({ property: propertyId, group: g._id, pricePerPax: { $gt: 0 } }).lean();
  // Billed per item: at least the minimum committed to, less the free places of the agent (Free Pax).
  const { freePaxOf } = await import('./groupBlockService.js');
  const free = freePaxOf(g);
  const billed = (i) => Math.max(0, Math.max(i.pax || 0, g.minPax || 0) - free);
  for (const [cat, kinds] of [['meals', ['meal']], ['activities', ['activity', 'general']]]) {
    const mine = items.filter((i) => kinds.includes(i.kind));
    if (!mine.length) continue;
    const amount = round2(mine.reduce((s, i) => s + billed(i) * i.pricePerPax, 0));
    const underMin = mine.some((i) => g.minPax && (i.pax || 0) < g.minPax);
    lines.push({ category: cat, description: `${BILLING_CATEGORIES[cat]} · ${mine.length} פריטים בלו״ז${underMin ? ` · לפי התחייבות מינימום ${g.minPax}` : ''}${free ? ` · בניכוי ${free} מקומות חינם` : ''}`, amount });
  }
  return { lines };
}

export async function saveBilling({ propertyId, id, input, actor, ip }) {
  const g = await loadGroup(propertyId, id);
  if (g.status === 'cancelled') throw httpError('הקבוצה בוטלה', 409);
  const v = input || {};
  const errors = {};
  const lines = [];
  for (const l of Array.isArray(v.lines) ? v.lines.slice(0, 40) : []) {
    const amount = round2(l.amount);
    if (!BILLING_CATEGORIES[l.category]) { errors.lines = 'קטגוריה לכל שורה'; continue; }
    if (!(amount >= 0 && amount <= 10_000_000)) { errors.lines = 'סכום לא תקין'; continue; }
    lines.push({ category: l.category, description: clip(l.description, 200) || BILLING_CATEGORIES[l.category], amount });
  }
  const vatRate = v.vatRate === undefined || v.vatRate === '' ? 18 : Number(v.vatRate);
  if (!(vatRate >= 0 && vatRate <= 30)) errors.vatRate = 'שיעור מע״מ';
  let discount;
  if (v.discount && Number(v.discount.value) > 0) {
    const kind = v.discount.kind === 'amount' ? 'amount' : 'percent';
    const value = round2(v.discount.value);
    if (kind === 'percent' && value > 100) errors.discount = 'אחוז עד 100';
    if (!DISCOUNT_REASONS[v.discount.reason]) errors.discountReason = 'יש לבחור סיבה';
    if (v.discount.reason === 'other' && clip(v.discount.note, 200).length < 3) errors.discountNote = 'יש לפרט';
    discount = { kind, value, reason: v.discount.reason, note: clip(v.discount.note, 200) || undefined };
  }
  const terms = PAYMENT_TERMS[v.terms] ? v.terms : 'immediate';
  if (terms === 'custom' && clip(v.termsText, 200).length < 3) errors.termsText = 'פרטו את התנאי';
  const due = { immediate: g.arrivalDate, net15: addDays(g.departureDate, 15), net30: addDays(g.departureDate, 30), net60: addDays(g.departureDate, 60), custom: null }[terms];
  const dueDate = YMD.test(String(v.dueDate || '')) ? v.dueDate : due;
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרופיל החיוב', 422, { fields: errors });
  const draft = { lines, vatRate, vatIncluded: v.vatIncluded !== false, discount, terms, termsText: terms === 'custom' ? clip(v.termsText, 200) : undefined, dueDate: dueDate || undefined, notes: clip(v.notes, 500) || undefined };
  const t = billingTotals(draft);
  if (discount) {
    // Above the property's discount threshold a manager decides (same rule as a booking discount).
    const property = await Property.findById(propertyId).select('discountApprovalPercent').lean();
    const pct = t.subtotal > 0 ? round2(t.discount * 100 / t.subtotal) : 0;
    const threshold = Number(property?.discountApprovalPercent ?? 10);
    if (pct - threshold > 0.005 && !can(actor, 'discount.approve', PRICE_OVERRIDE_ROLES)) throw httpError(`הנחה של ${pct}% (מעל ${threshold}%) מחייבת אישור מנהל`, 403, { code: 'discount_needs_approval' });
    if (pct - threshold > 0.005) discount.approvedByName = actor.name;
  }
  const before = g.billing ? billingTotals(g.billing) : null;
  g.billing = { ...draft, updatedByName: actor.name, updatedAt: new Date() };
  await g.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.billing_saved', entityType: 'GroupBlock', entityId: g._id, before: before ? { total: before.total } : undefined, after: { total: t.total, lines: lines.length, discount: discount ? `${discount.kind}:${discount.value}` : null, terms, dueDate }, reason: discount ? DISCOUNT_REASONS[discount.reason] : undefined, ip });
  return getMoney({ propertyId, id });
}

// The group's account: a house folio of outlet "groups", opened once.
async function ensureAccount({ propertyId, g, actor, ip }) {
  if (g.masterFolioId) {
    const f = await Folio.findOne({ _id: g.masterFolioId, property: propertyId }).select('_id').lean();
    if (f) return String(f._id);
  }
  const { createHouseAccount } = await import('./financeService.js');
  const out = await createHouseAccount({ propertyId, input: { name: `קבוצה ${g.name}`, phone: g.contactPhone, email: g.contactEmail, companyId: g.company ? String(g.company) : undefined, outlet: 'groups', note: `קבוצה ${g.groupCode} · ${g.arrivalDate}` }, actor, ip });
  const folioId = out.id || out.folioId || out.account?.id;
  await Folio.updateOne({ _id: folioId, property: propertyId }, { $set: { 'account.groupBlock': g._id } });
  await GroupBlock.updateOne({ _id: g._id }, { $set: { masterFolioId: folioId } });
  g.masterFolioId = folioId;
  return String(folioId);
}

function paymentDto(p) {
  return {
    id: String(p._id), method: p.method, methodLabel: METHOD_LABELS[p.method] || p.method, amount: p.amount, date: p.date, reference: p.reference || null, description: p.description || null,
    details: p.details || {}, status: p.status, recordedBy: p.recordedByName || null, decidedBy: p.decidedByName || null, decidedAt: p.decidedAt || null, decisionReason: p.decisionReason || null,
    attachments: (p.attachments || []).map((a) => ({ id: String(a._id || a), name: a.name || 'קובץ', mime: a.mime || null, size: a.size || null })), folioLineId: p.folioLineId || null, createdAt: p.createdAt,
  };
}

export async function getMoney({ propertyId, id }) {
  const g = (await loadGroup(propertyId, id)).toObject();
  const payments = await GroupPayment.find({ property: propertyId, group: g._id }).populate('attachments', 'name mime size').sort({ createdAt: -1 }).lean();
  const t = billingTotals(g.billing);
  const approved = round2(payments.filter((p) => p.status === 'approved').reduce((s, p) => s + p.amount, 0));
  const pending = round2(payments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0));
  let account = null;
  if (g.masterFolioId) {
    const f = await Folio.findOne({ _id: g.masterFolioId, property: propertyId }).select('account lines status').lean();
    if (f) {
      const posted = f.lines.filter((l) => l.status === 'posted');
      const charges = round2(posted.filter((l) => !['payment', 'deposit', 'refund'].includes(l.type)).reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0));
      const paid = round2(posted.filter((l) => ['payment', 'deposit'].includes(l.type)).reduce((s, l) => s - Number(l.amount || 0), 0) - posted.filter((l) => l.type === 'refund').reduce((s, l) => s + Number(l.amount || 0), 0));
      account = { id: String(f._id), number: f.account?.number || null, status: f.status, charges, paid, balance: round2(charges - paid) };
    }
  }
  // Overall state, with a progress bar on the screen.
  let state = 'none';
  if (t.total > 0) state = approved >= t.total - 0.005 ? 'paid' : approved > 0.005 ? 'partial' : pending > 0.005 ? 'pending' : 'unpaid';
  const property = await Property.findById(propertyId).select('timezone dayClose discountApprovalPercent').lean();
  const today = businessDateOf(property);
  return {
    group: { id: String(g._id), name: g.name, groupCode: g.groupCode, status: g.status, pax: g.pax || 0, minPax: g.minPax || 0, arrivalDate: g.arrivalDate, departureDate: g.departureDate },
    billing: g.billing ? { ...g.billing, lines: (g.billing.lines || []).map((l) => ({ id: String(l._id), category: l.category, categoryLabel: BILLING_CATEGORIES[l.category], description: l.description, amount: l.amount })), termsLabel: PAYMENT_TERMS[g.billing.terms] || null, totals: t } : null,
    payments: payments.map(paymentDto),
    summary: { expected: t.total, approved, pending, left: round2(Math.max(0, t.total - approved)), state, progress: t.total > 0 ? Math.min(100, Math.round(approved * 100 / t.total)) : 0, overdue: !!(g.billing?.dueDate && g.billing.dueDate < today && approved < t.total - 0.005) },
    account,
    options: { categories: BILLING_CATEGORIES, terms: PAYMENT_TERMS, methods: METHOD_LABELS, discountReasons: DISCOUNT_REASONS, discountApprovalPercent: Number(property?.discountApprovalPercent ?? 10) },
    today,
  };
}

export async function recordPayment({ propertyId, id, input, actor, ip }) {
  const g = await loadGroup(propertyId, id);
  if (g.status === 'cancelled') throw httpError('הקבוצה בוטלה', 409);
  const v = input || {};
  const errors = {};
  const amount = round2(v.amount);
  if (!(amount > 0 && amount <= 10_000_000)) errors.amount = 'סכום חיובי';
  if (!GROUP_PAY_METHODS.includes(v.method)) errors.method = 'יש לבחור אמצעי';
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const date = YMD.test(String(v.date || '')) ? v.date : today;
  if (date > today) errors.date = 'תאריך עתידי';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי התשלום', 422, { fields: errors });
  // The same details a folio payment needs — checked now, so approving it later cannot fail on them.
  const { paymentDetails } = await import('./financeService.js');
  const { methodRef, payDetails } = paymentDetails({ method: v.method, amount, input: { details: v.details || {}, methodRef: v.reference }, today });
  const p = await GroupPayment.create({
    property: propertyId, group: g._id, method: v.method, amount, date, reference: methodRef || clip(v.reference, 40) || undefined, description: clip(v.description, 200) || undefined,
    details: { ...(v.details || {}), ...(payDetails || {}) }, status: 'pending', recordedBy: actor.id || undefined, recordedByName: actor.name,
  });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.payment_recorded', entityType: 'GroupBlock', entityId: g._id, after: { payment: String(p._id), method: v.method, amount, date }, ip });
  return paymentDto(p.toObject());
}

export async function addAttachment({ propertyId, id, paymentId, file, actor, ip }) {
  const g = await loadGroup(propertyId, id);
  if (!file) throw httpError('לא נבחר קובץ', 422);
  if (!ATTACH_TYPES.includes(file.mimetype)) throw httpError('קובץ תמונה (PNG / JPG / WEBP) או PDF', 422);
  if (file.size > ATTACH_MAX) throw httpError('עד 5MB לקובץ', 422);
  if (!isId(paymentId)) throw httpError('מזהה תשלום לא תקין', 400);
  const p = await GroupPayment.findOne({ _id: paymentId, property: propertyId, group: g._id });
  if (!p) throw httpError('התשלום לא נמצא', 404);
  if ((p.attachments || []).length >= 5) throw httpError('עד 5 צרופות לתשלום', 422);
  const a = await GroupAttachment.create({ property: propertyId, group: g._id, name: clip(file.originalname, 120) || 'קובץ', mime: file.mimetype, size: file.size, data: file.buffer, uploadedByName: actor.name });
  p.attachments.push(a._id);
  await p.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.payment_attachment', entityType: 'GroupBlock', entityId: g._id, after: { payment: String(p._id), file: a.name, size: a.size }, ip });
  return { id: String(a._id), name: a.name, mime: a.mime, size: a.size };
}

export async function getAttachment({ propertyId, id, attachmentId }) {
  if (!isId(id) || !isId(attachmentId)) throw httpError('מזהה לא תקין', 400);
  const a = await GroupAttachment.findOne({ _id: attachmentId, property: propertyId, group: id }).lean();
  if (!a) throw httpError('הקובץ לא נמצא', 404);
  return a;
}

// Finance decides. Approve → the money goes into the group's account (deposit when it is more than
// what is charged there so far). Reject / cancel → nothing is posted.
export async function decidePayment({ propertyId, id, paymentId, decision, reason, actor, ip }) {
  const g = await loadGroup(propertyId, id);
  if (!isId(paymentId)) throw httpError('מזהה תשלום לא תקין', 400);
  const p = await GroupPayment.findOne({ _id: paymentId, property: propertyId, group: g._id });
  if (!p) throw httpError('התשלום לא נמצא', 404);
  if (p.status !== 'pending') throw httpError('התשלום כבר טופל', 409);
  const why = clip(reason, 300);
  if (decision === 'cancel') {
    if (String(p.recordedBy || '') !== String(actor.id || '') && !MONEY_APPROVE.includes(actor.role)) throw httpError('ביטול רישום — מי שרשם או כספים', 403);
  } else if (!MONEY_APPROVE.includes(actor.role)) throw httpError('אישור תשלום קבוצה — כספים או הנהלה', 403);
  if (decision === 'reject' && why.length < 3) throw httpError('יש לפרט את סיבת הדחייה', 422, { fields: { reason: 'סיבה' } });
  if (decision === 'approve') {
    if (g.status === 'cancelled') throw httpError('הקבוצה בוטלה', 409);
    const folioId = await ensureAccount({ propertyId, g, actor, ip });
    const { recordFolioPayment } = await import('./financeService.js');
    const folio = await Folio.findById(folioId).select('lines').lean();
    const posted = folio.lines.filter((l) => l.status === 'posted');
    const balance = round2(posted.reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0));
    const kind = p.amount - balance > 0.005 ? 'deposit' : 'payment';
    const out = await recordFolioPayment({
      propertyId, folioId, actor, ip,
      input: { amount: p.amount, method: p.method, kind, details: p.details || {}, methodRef: p.reference, idempotencyKey: `grp-pay-${p._id}`, note: p.description },
    });
    p.folio = folioId;
    p.folioLineId = out.lineId;
  }
  p.status = { approve: 'approved', reject: 'rejected', cancel: 'cancelled' }[decision];
  if (!p.status) throw httpError('החלטה לא מוכרת', 422);
  p.decidedBy = actor.id || undefined;
  p.decidedByName = actor.name;
  p.decidedAt = new Date();
  p.decisionReason = why || undefined;
  await p.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `group.payment_${p.status}`, entityType: 'GroupBlock', entityId: g._id, reason: why || undefined, after: { payment: String(p._id), amount: p.amount, method: p.method, folioLineId: p.folioLineId || null }, ip });
  return getMoney({ propertyId, id });
}
