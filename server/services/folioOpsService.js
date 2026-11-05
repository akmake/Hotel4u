// Folio line operations (gap-map item 2): discount on lines, split, transfer between windows / rooms,
// invoice combinations, extra windows, Paid Out. Same rule as the money core: a posted line is never
// edited or deleted — every operation adds new lines (a discount line, or a linked reversal plus the
// new part / copy). A line already on an issued document is never touched (credit note instead).
import mongoose from 'mongoose';
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import Company from '../models/Company.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf, IN_HOUSE_STATUSES } from './frontDeskService.js';
import { folioBalance } from './departureService.js';
import { docCoverage, documentIssuer } from './documentService.js';
import { creditInvoicedParts, mirrorCredits } from './fiscalCorrectionService.js';
import { withLocks } from './locks.js';
import { runStayTransaction } from './stayTransaction.js';
import { financialWrite } from './financialTransaction.js';
import { noPostGate } from './noPostService.js';
import { DISCOUNT_REASONS, PRICE_OVERRIDE_ROLES } from './bookingService.js';
import { REFUND_ROLES } from './financeService.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const gross = (l) => round2(Number(l.amount || 0) + Number(l.taxAmount || 0));
const ACTIVE_STAY = [...IN_HOUSE_STATUSES, 'confirmed', 'modified', 'pending_payment', 'checked_out'];
const MAX_WINDOWS = 8;

export const PAID_OUT_PURPOSES = { taxi: 'מונית', courier: 'שליח', tickets: 'כרטיסים / הופעה', pharmacy: 'בית מרקחת', shopping: 'קנייה בשביל האורח', tip: 'טיפ בשם האורח', other: 'אחר' };

export function lineOpsConfig(property) {
  return {
    discountReasons: DISCOUNT_REASONS,
    discountApprovalPercent: Number(property?.discountApprovalPercent ?? 10),
    paidOutPurposes: PAID_OUT_PURPOSES,
    paidOutApprovalOver: Number(property?.financePolicy?.refundApprovalOver ?? 0),
    maxWindows: MAX_WINDOWS,
  };
}

function opRef(key) {
  const k = String(key || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(k)) throw httpError('חסר מזהה פעולה (idempotency key)', 422);
  return `op:${k}`;
}
const hasRef = (folio, ref) => folio.lines.some((l) => l.reference && (l.reference === ref || l.reference.startsWith(`${ref}:`)));

async function loadFolio(folioId, propertyId, session) {
  if (!isId(String(folioId || ''))) throw httpError('מזהה חשבון לא תקין', 400);
  const folio = await Folio.findById(folioId).session(session || null);
  if (!folio || String(folio.property) !== String(propertyId)) throw httpError('החשבון לא נמצא', 404);
  return folio;
}

// Two folios in one atomic write (both locked, same order every time → no deadlock).
function twoFolioWrite(ids, work, propertyId) {
  const keys = [...new Set(ids.map((id) => `folio:${id}`))].sort();
  return withLocks([...keys, `dayclose:${propertyId}`], (lease) => runStayTransaction((session, afterCommit) => {
    session.financialDayCloseLease = lease;
    return work(session, afterCommit);
  }, lease, { operation: 'רישום כספי' }), { waitMs: 4000 });
}

// What may be operated on: a posted charge/fee that is not a reversal, not reversed and not on an
// issued document. Returns { line, discounts, remaining } or throws a precise reason.
function workable(folio, lineId, onDocs, { allowInvoiced = false } = {}) {
  const line = folio.lines.id(lineId);
  if (!line) throw httpError('השורה לא נמצאה', 404);
  if (!['charge', 'fee'].includes(line.type) || line.status !== 'posted') throw httpError(`"${line.description}" אינה חיוב רשום`, 422);
  if (line.reversalOf) throw httpError('שורת היפוך לא ניתנת לפעולה', 422);
  if (folio.lines.some((l) => String(l.reversalOf || '') === String(line._id))) throw httpError(`"${line.description}" כבר בוטל או הועבר`, 409);
  const invoiced = onDocs.has(String(line._id));
  if (invoiced && !allowInvoiced) throw httpError(`"${line.description}" כלול במסמך ${onDocs.get(String(line._id))} — תיקון במסמך זיכוי`, 409, { code: 'on_document' });
  const reversed = new Set(folio.lines.filter((l) => l.reversalOf).map((l) => String(l.reversalOf)));
  const discounts = folio.lines.filter((l) => l.type === 'discount' && l.status === 'posted' && String(l.discountOf || '') === String(line._id) && !reversed.has(String(l._id)));
  const remaining = round2(gross(line) + discounts.reduce((s, d) => s + gross(d), 0));
  return { line, discounts, remaining, invoiced };
}

// Net/VAT of a gross part, in the proportion of the original line.
function partOf(line, partGross) {
  const g = gross(line);
  const tax = Math.abs(g) > 0.005 ? round2(Number(line.taxAmount || 0) * partGross / g) : 0;
  return { net: round2(partGross - tax), tax };
}

const copyBase = (l) => ({
  vatRate: l.vatRate, taxReason: l.taxReason, department: l.department, serviceDate: l.serviceDate,
  quantity: l.quantity, unitPrice: l.unitPrice,
});

async function windowLabel(folio, session) {
  if (folio.ownerRef === 'post_stay') return 'חיובים אחרי יציאה';
  if (String(folio.ownerRef || '').startsWith('extra:')) return folio.account?.name || 'חלון נוסף';
  if (String(folio.ownerRef || '').startsWith('share:')) return `Share · ${folio.account?.name || 'אורח'}`;
  if (folio.ownerType === 'company') return (await Company.findById(folio.ownerRef).session(session || null).select('name').lean())?.name || 'חברה';
  if (folio.ownerType === 'house') return folio.account?.name || folio.account?.number || 'חשבון מזדמן';
  return { guest: 'אורח', room: 'חדר', group: 'קבוצה' }[folio.ownerType] || folio.ownerType;
}

// A label that is clear from the other side: same stay → the window; another stay → room + guest.
async function folioLabel(folio, otherReservation, session) {
  const base = await windowLabel(folio, session);
  if (!folio.reservation || String(folio.reservation) === String(otherReservation || '')) return base;
  const r = await Reservation.findById(folio.reservation).session(session || null).select('confirmationNumber assignedRoom primaryGuest').populate('assignedRoom', 'number').populate('primaryGuest', 'firstName lastName').lean();
  const who = r?.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : '';
  return `חדר ${r?.assignedRoom?.number || '—'}${who ? ` · ${who}` : ''}${base !== 'אורח' ? ` (${base})` : ''}`;
}

// ── Discount on one or more lines ──────────────────────────────────────────
export async function discountLines({ propertyId, folioId, input, actor, ip }) {
  return financialWrite(`folio:${folioId}`, async (session, afterCommit) => {
    const folio = await loadFolio(folioId, propertyId, session);
    const ref = opRef(input.idempotencyKey);
    if (hasRef(folio, ref)) return { folioId: String(folio._id), duplicate: true, balance: folioBalance(folio) };
    if (folio.status === 'closed') throw httpError('החשבון סגור', 409);
    const ids = [...new Set((Array.isArray(input.lineIds) ? input.lineIds : []).map(String))];
    const kind = input.kind === 'amount' ? 'amount' : 'percent';
    const value = round2(input.value);
    const note = String(input.note || '').trim().slice(0, 200);
    const errors = {};
    if (!ids.length || ids.length > 200) errors.lineIds = 'יש לבחור שורות';
    if (!(value > 0) || (kind === 'percent' && value > 100)) errors.value = kind === 'percent' ? 'אחוז בין 0 ל־100' : 'סכום חיובי';
    if (!DISCOUNT_REASONS[input.reasonCode]) errors.reasonCode = 'יש לבחור סיבה';
    if (input.reasonCode === 'other' && note.length < 3) errors.note = 'יש לפרט';
    if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי ההנחה', 422, { fields: errors });
    const onDocs = (await docCoverage(folio._id, session)).charges;
    // A line already on an issued invoice may be discounted too: the discount is documented by a
    // credit note on that invoice line, issued in the same operation (fiscalCorrectionService).
    const items = ids.map((id) => workable(folio, id, onDocs, { allowInvoiced: true }));
    if (items.some((x) => x.invoiced) && documentIssuer() !== 'invoicer') {
      const x = items.find((y) => y.invoiced);
      throw httpError(`"${x.line.description}" כלול במסמך ${onDocs.get(String(x.line._id))} — תיקון במסמך זיכוי`, 409, { code: 'on_document' });
    }
    const left = round2(items.reduce((s, x) => s + x.remaining, 0));
    if (!(left > 0.005)) throw httpError('אין יתרה להנחה בשורות שנבחרו', 422);
    // Per line, in gross: percent of what is left on each line, or an amount spread pro rata.
    let total = kind === 'percent' ? 0 : value;
    if (kind === 'amount' && total - left > 0.005) throw httpError(`ההנחה גבוהה מהיתרה בשורות (${left.toFixed(2)})`, 422, { fields: { value: 'מעל היתרה' } });
    const parts = [];
    let spread = 0;
    items.forEach((x, i) => {
      let d = kind === 'percent' ? round2(x.remaining * value / 100) : (i === items.length - 1 ? round2(total - spread) : round2(total * x.remaining / left));
      d = Math.min(d, x.remaining);
      spread = round2(spread + d);
      if (d > 0.005) parts.push({ ...x, d });
    });
    if (kind === 'percent') total = spread;
    const basis = round2(items.reduce((s, x) => s + gross(x.line), 0));
    const pct = basis > 0 ? round2((total + items.reduce((s, x) => s - x.discounts.reduce((a, d) => a + gross(d), 0), 0)) * 100 / basis) : 0;
    const property = await Property.findById(propertyId).session(session).select('discountApprovalPercent timezone dayClose').lean();
    const threshold = Number(property?.discountApprovalPercent ?? 10);
    if (pct - threshold > 0.005 && !PRICE_OVERRIDE_ROLES.includes(actor.role)) throw httpError(`הנחה של ${pct}% (מעל ${threshold}%) מחייבת אישור מנהל`, 403, { code: 'discount_needs_approval' });
    const why = `${DISCOUNT_REASONS[input.reasonCode]}${note ? ` · ${note}` : ''}`;
    const invoicedParts = parts.filter((p) => p.invoiced);
    const credits = invoicedParts.length
      ? await creditInvoicedParts({ folio, parts: invoicedParts.map((p) => ({ folioLineId: String(p.line._id), gross: p.d })), reason: why, key: ref, session })
      : [];
    // The VAT split of an invoiced part is the one the credit note carries, to the agora.
    const fromCredit = new Map(credits.flatMap((c) => [...c.amounts.entries()].map(([id, a]) => [id, { ...a, credit: c }])));
    const lineOf = new Map();
    for (const { line, d } of parts) {
      const c = fromCredit.get(String(line._id));
      const { net, tax } = c && c.net !== null ? { net: c.net, tax: c.tax } : partOf(line, d);
      folio.lines.push({
        type: 'discount', description: `הנחה${kind === 'percent' ? ` ${value}%` : ''}: ${line.description}`.slice(0, 200), amount: -net, taxAmount: -tax,
        ...copyBase(line), source: 'manual', status: 'posted', reference: `${ref}:${line._id}`, discountOf: line._id, reason: why, createdBy: actor.id || undefined,
      });
      if (c) lineOf.set(String(folio.lines[folio.lines.length - 1]._id), c.credit);
    }
    await folio.save({ session });
    const cn = credits.length ? await mirrorCredits({
      propertyId, credits, actor, reason: why, session,
      lineIdsOf: (c) => [...lineOf.entries()].filter(([, cr]) => cr === c).map(([id]) => id),
    }) : [];
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.line_discount', entityType: 'Folio', entityId: folio._id, reason: why, after: { lines: parts.map((p) => String(p.line._id)), kind, value, total, percentOfLines: pct, threshold, approvedBy: pct - threshold > 0.005 ? actor.name : null, creditNotes: cn.map((d) => d.invoiceNumber) }, ip, session, afterCommit });
    return { folioId: String(folio._id), total, percent: pct, lines: parts.length, balance: folioBalance(folio), creditNotes: cn.map((d) => d.invoiceNumber) };
  }, propertyId);
}

// Resolve the destination folio: a window id, or another stay (its guest window, opened if missing).
async function resolveTarget({ propertyId, source, input, session }) {
  if (input.toFolioId) return loadFolio(input.toFolioId, propertyId, session);
  if (!isId(String(input.toReservationId || ''))) throw httpError('יש לבחור לאן להעביר', 422, { fields: { to: 'יעד' } });
  const res = await Reservation.findOne({ _id: input.toReservationId, property: propertyId }).session(session).select('status currency property').lean();
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  if (!IN_HOUSE_STATUSES.includes(res.status)) throw httpError('העברה לחדר אחר — רק לאורח שבבית', 409);
  let f = await Folio.findOne({ reservation: res._id, ownerType: 'guest', ownerRef: { $not: /^(extra:|post_stay|share:)/ }, status: { $ne: 'closed' } }).sort({ createdAt: 1 }).session(session);
  if (!f) [f] = await Folio.create([{ property: propertyId, reservation: res._id, ownerType: 'guest', currency: res.currency || source.currency || 'ILS', lines: [] }], { session });
  return f;
}

async function assertTarget({ source, target, session, propertyId }) {
  if (String(target._id) === String(source._id)) throw httpError('היעד הוא אותו חשבון', 422, { fields: { to: 'יעד אחר' } });
  if (String(target.property) !== String(propertyId)) throw httpError('החשבון לא נמצא', 404);
  if (target.status === 'closed') throw httpError('חשבון היעד סגור', 409);
  if ((target.currency || 'ILS') !== (source.currency || 'ILS')) throw httpError('העברה רק בין חשבונות באותו מטבע', 422);
  const res = target.reservation ? await Reservation.findById(target.reservation).session(session).select('status noPost').lean() : null;
  if (target.reservation && (!res || !ACTIVE_STAY.includes(res.status) || res.status === 'checked_out')) throw httpError('חשבון היעד שייך להזמנה שאינה פעילה', 409);
  return res;
}

// ── Split one line (part stays, part goes to the same or another window) ───
export async function splitLine({ propertyId, folioId, lineId, input, actor, ip }) {
  const pre = await loadFolio(folioId, propertyId);
  const target0 = input.toFolioId || input.toReservationId ? await resolveTarget({ propertyId, source: pre, input, session: null }) : pre;
  return twoFolioWrite([String(pre._id), String(target0._id)], async (session, afterCommit) => {
    const folio = await loadFolio(folioId, propertyId, session);
    const ref = opRef(input.idempotencyKey);
    if (hasRef(folio, ref)) return { folioId: String(folio._id), duplicate: true, balance: folioBalance(folio) };
    if (folio.status === 'closed') throw httpError('החשבון סגור', 409);
    const same = String(target0._id) === String(folio._id);
    const target = same ? folio : await loadFolio(target0._id, propertyId, session);
    const targetRes = same ? null : await assertTarget({ source: folio, target, session, propertyId });
    const onDocs = (await docCoverage(folio._id, session)).charges;
    const { line, discounts } = workable(folio, lineId, onDocs);
    if (discounts.length) throw httpError('יש הנחה על השורה — מפצלים לפני מתן הנחה (או מעבירים את השורה כולה)', 409, { code: 'discounted' });
    const g = gross(line);
    const kind = input.kind === 'percent' ? 'percent' : 'amount';
    const value = round2(input.value);
    const part = kind === 'percent' ? round2(g * value / 100) : value;
    if (!(part > 0.005) || part - g > -0.005) throw httpError(`החלק שמפוצל צריך להיות בין 0 ל־${g.toFixed(2)}`, 422, { fields: { value: 'לא בטווח' } });
    if (targetRes) noPostGate({ res: targetRes, code: { code: line.department }, input, actor });
    const moved = partOf(line, part);
    const kept = { net: round2(Number(line.amount) - moved.net), tax: round2(Number(line.taxAmount || 0) - moved.tax) };
    const toLabel = same ? null : await folioLabel(target, folio.reservation, session);
    const fromLabel = same ? null : await folioLabel(folio, target.reservation, session);
    const why = String(input.reason || '').trim().slice(0, 200) || 'פיצול שורה';
    folio.lines.push({
      type: 'adjustment', description: `פוצל: ${line.description}`.slice(0, 200), amount: -round2(line.amount), taxAmount: -round2(line.taxAmount || 0),
      ...copyBase(line), source: 'manual', status: 'posted', reference: `${ref}:rev`, reversalOf: line._id, reason: why, createdBy: actor.id || undefined,
    });
    folio.lines.push({
      type: line.type, description: `${line.description} (חלק)`.slice(0, 200), amount: kept.net, taxAmount: kept.tax,
      ...copyBase(line), source: 'manual', status: 'posted', reference: `${ref}:a`, splitOf: line._id, reason: why, createdBy: actor.id || undefined,
    });
    target.lines.push({
      type: line.type, description: `${line.description} (חלק)`.slice(0, 200), amount: moved.net, taxAmount: moved.tax,
      ...copyBase(line), source: same ? 'manual' : 'routing', status: 'posted', reference: `${ref}:b`, splitOf: line._id, reason: why, createdBy: actor.id || undefined,
      ...(same ? {} : { transferFrom: { folio: folio._id, line: line._id, label: fromLabel } }),
    });
    await folio.save({ session });
    if (!same) await target.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.line_split', entityType: 'Folio', entityId: folio._id, reason: why, before: { lineId: String(line._id), gross: g }, after: { kept: round2(g - part), moved: part, to: same ? null : { folio: String(target._id), label: toLabel } }, ip, session, afterCommit });
    return { folioId: String(folio._id), kept: round2(g - part), moved: part, toFolioId: String(target._id), balance: folioBalance(folio) };
  }, propertyId);
}

// ── Transfer lines (with their discounts) to another window or another room ─
export async function transferLines({ propertyId, folioId, input, actor, ip }) {
  const pre = await loadFolio(folioId, propertyId);
  const target0 = await resolveTarget({ propertyId, source: pre, input, session: null });
  return twoFolioWrite([String(pre._id), String(target0._id)], async (session, afterCommit) => {
    const folio = await loadFolio(folioId, propertyId, session);
    const ref = opRef(input.idempotencyKey);
    if (hasRef(folio, ref)) return { folioId: String(folio._id), toFolioId: String(target0._id), duplicate: true, balance: folioBalance(folio) };
    const target = await loadFolio(target0._id, propertyId, session);
    const targetRes = await assertTarget({ source: folio, target, session, propertyId });
    const otherStay = String(target.reservation || '') !== String(folio.reservation || '');
    const why = String(input.reason || '').trim().slice(0, 200);
    if (otherStay && why.length < 3) throw httpError('העברה לחדר אחר מחייבת סיבה', 422, { fields: { reason: 'יש לפרט' } });
    const ids = [...new Set((Array.isArray(input.lineIds) ? input.lineIds : []).map(String))];
    if (!ids.length || ids.length > 300) throw httpError('יש לבחור שורות להעברה', 422, { fields: { lineIds: 'יש לבחור' } });
    const onDocs = (await docCoverage(folio._id, session)).charges;
    const items = ids.map((id) => workable(folio, id, onDocs));
    for (const x of items) noPostGate({ res: targetRes, code: { code: x.line.department }, input, actor });
    const toLabel = await folioLabel(target, folio.reservation, session);
    const fromLabel = await folioLabel(folio, target.reservation, session);
    let total = 0;
    for (const { line, discounts } of items) {
      const newChargeId = new mongoose.Types.ObjectId();
      for (const l of [line, ...discounts]) {
        folio.lines.push({
          type: 'adjustment', description: `הועבר ל${toLabel}: ${l.description}`.slice(0, 200), amount: -round2(l.amount), taxAmount: -round2(l.taxAmount || 0),
          ...copyBase(l), source: 'routing', status: 'posted', reference: `${ref}:${l._id}:out`, reversalOf: l._id, transferTo: { folio: target._id, label: toLabel },
          reason: why || 'העברת שורה', createdBy: actor.id || undefined,
        });
        target.lines.push({
          ...(l === line ? { _id: newChargeId } : { discountOf: newChargeId }),
          type: l.type, description: l.description, amount: round2(l.amount), taxAmount: round2(l.taxAmount || 0),
          ...copyBase(l), source: 'routing', status: 'posted', reference: `${ref}:${l._id}:in`, transferFrom: { folio: folio._id, line: l._id, label: fromLabel },
          reason: why || undefined, createdBy: actor.id || undefined,
        });
        total = round2(total + gross(l));
      }
    }
    await folio.save({ session });
    await target.save({ session });
    const after = { from: String(folio._id), to: String(target._id), toLabel, lines: items.map((x) => String(x.line._id)), total, otherStay };
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.lines_transferred', entityType: 'Folio', entityId: folio._id, reason: why || undefined, after, ip, session, afterCommit });
    if (otherStay) await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.lines_received', entityType: 'Folio', entityId: target._id, reason: why || undefined, after: { ...after, fromLabel }, ip, session, afterCommit });
    return { folioId: String(folio._id), toFolioId: String(target._id), toLabel, moved: items.length, total, balance: folioBalance(folio) };
  }, propertyId);
}

// ── Invoice combinations (display only; the folio lines stay separate) ────
export async function combineLines({ propertyId, folioId, input, actor, ip }) {
  return financialWrite(`folio:${folioId}`, async (session, afterCommit) => {
    const folio = await loadFolio(folioId, propertyId, session);
    if (folio.status === 'closed') throw httpError('החשבון סגור', 409);
    const ids = [...new Set((Array.isArray(input.lineIds) ? input.lineIds : []).map(String))];
    const label = String(input.label || '').trim().slice(0, 80);
    if (ids.length < 2) throw httpError('לאיחוד בוחרים לפחות שתי שורות', 422, { fields: { lineIds: 'שתי שורות לפחות' } });
    if (label.length < 2) throw httpError('יש לתת שם לשורה המאוחדת', 422, { fields: { label: 'שם' } });
    const onDocs = (await docCoverage(folio._id, session)).charges;
    const items = ids.map((id) => workable(folio, id, onDocs));
    const property = await Property.findById(propertyId).session(session).select('vatRate').lean();
    const rateOf = (l) => (Number.isFinite(l.vatRate) ? l.vatRate : (Math.abs(Number(l.taxAmount || 0)) > 0.005 ? (property?.vatRate ?? 18) : 0));
    if (new Set(items.map((x) => rateOf(x.line))).size > 1) throw httpError('אפשר לאחד רק שורות באותו שיעור מע״מ', 422, { code: 'mixed_vat' });
    const inCombo = new Set((folio.combos || []).flatMap((c) => c.lineIds.map(String)));
    const taken = items.find((x) => inCombo.has(String(x.line._id)));
    if (taken) throw httpError(`"${taken.line.description}" כבר באיחוד אחר — בטלו אותו קודם`, 409);
    folio.combos.push({ label, lineIds: items.map((x) => x.line._id), by: actor.id || undefined, byName: actor.name });
    await folio.save({ session });
    const combo = folio.combos[folio.combos.length - 1];
    const total = round2(items.reduce((s, x) => s + x.remaining, 0));
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.lines_combined', entityType: 'Folio', entityId: folio._id, after: { comboId: String(combo._id), label, lines: ids, total }, ip, session, afterCommit });
    return { folioId: String(folio._id), comboId: String(combo._id), label, total };
  }, propertyId);
}

export async function uncombineLines({ propertyId, folioId, comboId, actor, ip }) {
  return financialWrite(`folio:${folioId}`, async (session, afterCommit) => {
    const folio = await loadFolio(folioId, propertyId, session);
    const combo = folio.combos.id(comboId);
    if (!combo) throw httpError('האיחוד לא נמצא', 404);
    const label = combo.label;
    folio.combos.pull(combo._id);
    await folio.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.lines_uncombined', entityType: 'Folio', entityId: folio._id, before: { comboId: String(comboId), label }, ip, session, afterCommit });
    return { folioId: String(folio._id) };
  }, propertyId);
}

// ── Paid Out: cash out of the drawer on the guest's behalf, owed back by the guest ──
export async function paidOut({ propertyId, folioId, input, actor, ip }) {
  return financialWrite(`folio:${folioId}`, async (session, afterCommit) => {
    const folio = await loadFolio(folioId, propertyId, session);
    const ref = opRef(input.idempotencyKey);
    const dup = folio.lines.find((l) => l.reference === ref);
    if (dup) return { folioId: String(folio._id), lineId: String(dup._id), duplicate: true, balance: folioBalance(folio) };
    if (folio.status === 'closed') throw httpError('החשבון סגור', 409);
    if (folio.ownerType === 'company') throw httpError('Paid Out נרשם בחשבון האורח, לא בחשבון חברה', 422);
    if (folio.reservation) {
      const res = await Reservation.findById(folio.reservation).session(session).select('status').lean();
      if (!res || !IN_HOUSE_STATUSES.includes(res.status)) throw httpError('Paid Out רק לאורח שבבית', 409);
    }
    const amount = round2(input.amount);
    const payee = String(input.payee || '').trim().slice(0, 120);
    const note = String(input.note || '').trim().slice(0, 200);
    const errors = {};
    if (!(amount > 0) || amount > 100000) errors.amount = 'סכום חיובי';
    if (!PAID_OUT_PURPOSES[input.purpose]) errors.purpose = 'יש לבחור עבור מה';
    if (input.purpose === 'other' && note.length < 3) errors.note = 'יש לפרט';
    if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי ה־Paid Out', 422, { fields: errors });
    const property = await Property.findById(propertyId).session(session).select('timezone financePolicy dayClose').lean();
    const threshold = Number(property?.financePolicy?.refundApprovalOver ?? 0);
    if (threshold > 0 && amount > threshold && !REFUND_ROLES.includes(actor.role)) throw httpError(`Paid Out מעל ${threshold.toFixed(2)} מחייב מנהל או כספים`, 403, { code: 'approval_required' });
    const purpose = PAID_OUT_PURPOSES[input.purpose];
    folio.lines.push({
      type: 'refund', description: `Paid Out — ${purpose}${payee ? ` · ל${payee}` : ''}${note ? ` · ${note}` : ''}`.slice(0, 200),
      amount, taxAmount: 0, serviceDate: businessDateOf(property), source: 'manual', status: 'posted', reference: ref,
      method: 'cash', paidOut: { payee: payee || undefined, purpose: input.purpose }, reason: note || purpose, createdBy: actor.id || undefined,
    });
    await folio.save({ session });
    const line = folio.lines[folio.lines.length - 1];
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.paid_out', entityType: 'Folio', entityId: folio._id, reason: note || purpose, after: { lineId: String(line._id), amount, purpose: input.purpose, payee: payee || null }, ip, session, afterCommit });
    return { folioId: String(folio._id), lineId: String(line._id), amount, balance: folioBalance(folio) };
  }, propertyId);
}

// ── Extra window for a stay (e.g. "personal" vs "business"), up to 8 per stay ──
export async function openWindow({ propertyId, reservationId, input, actor, ip }) {
  if (!isId(String(reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  return withLocks([`res:${reservationId}`], async () => {
    const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).select('status currency').lean();
    if (!res) throw httpError('ההזמנה לא נמצאה', 404);
    if (!ACTIVE_STAY.includes(res.status) || res.status === 'checked_out') throw httpError('חלון חדש נפתח רק להזמנה פעילה', 409);
    const label = String(input.label || '').trim().slice(0, 60);
    if (label.length < 2) throw httpError('יש לתת שם לחלון', 422, { fields: { label: 'שם' } });
    const all = await Folio.find({ reservation: res._id }).select('ownerRef account.name status').lean();
    if (all.filter((f) => f.status !== 'closed').length >= MAX_WINDOWS) throw httpError(`עד ${MAX_WINDOWS} חלונות פתוחים לשהייה`, 409);
    if (all.some((f) => f.status !== 'closed' && f.account?.name === label)) throw httpError('כבר יש חלון בשם הזה', 409);
    const n = all.filter((f) => String(f.ownerRef || '').startsWith('extra:')).length + 1;
    const folio = await Folio.create({ property: propertyId, reservation: res._id, ownerType: 'guest', ownerRef: `extra:${n}`, account: { name: label, openedByName: actor.name }, currency: res.currency || 'ILS', lines: [] });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.window_opened', entityType: 'Folio', entityId: folio._id, after: { reservation: String(res._id), label }, ip });
    return { folioId: String(folio._id), label };
  });
}

// Where lines can go: this stay's other open windows + guests in house (another room).
export async function transferTargets({ propertyId, reservationId }) {
  if (!isId(String(reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const stays = await Reservation.find({ property: propertyId, status: { $in: IN_HOUSE_STATUSES }, _id: { $ne: reservationId } })
    .select('confirmationNumber assignedRoom primaryGuest departureDate').populate('assignedRoom', 'number').populate('primaryGuest', 'firstName lastName').limit(500).lean();
  return {
    rooms: stays.map((r) => ({
      reservationId: String(r._id), confirmationNumber: r.confirmationNumber, room: r.assignedRoom?.number || null,
      guest: r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : '—', departureDate: r.departureDate,
    })).sort((a, b) => String(a.room || '').localeCompare(String(b.room || ''), 'he', { numeric: true })),
  };
}
