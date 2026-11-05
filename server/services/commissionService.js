// Travel-agent commissions (gap-map item 10). A record per departed reservation of an agent (day by day from
// yesterday's departures), held or ready; paid in a payment per agent (cheque / transfer / file) with a
// lifecycle: issued → cleared (and back) / not presented / voided (final — its records return to processing).
// Percent: the reservation's own > the rate plan's code > the agent's default. A plan that does not qualify pays none.
import { can } from './permissionService.js';
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import Company from '../models/Company.js';
import Folio from '../models/Folio.js';
import { RatePlan } from '../models/RatePlan.js';
import { CommissionRecord, CommissionPayment, HOLD_KINDS } from '../models/Commission.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import Property from '../models/Property.js';

export const COMMISSION_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager', 'sales_manager'];
export const HOLD_LABEL = { review: 'לבירור', until_paid: 'עד שהחייב ישלם', offset: 'כבר קוזזה' };
export const PAY_LABEL = { issued: 'יצא', cleared: 'נפרע', not_presented: 'לא הוצג לבנק', voided: 'בוטל' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const mustManage = (actor) => { if (!can(actor, 'commission.manage', COMMISSION_ROLES)) throw httpError('עמלות סוכנים — למנהל, לכספים או למכירות', 403); };
const stamp = (actor, action, note) => ({ at: new Date(), by: actor?.name || 'מערכת', action, ...(note ? { note } : {}) });
const log = (propertyId, actor, ip, action, entityType, entityId, before, after, reason) => audit({ property: propertyId, actor: actor?.id, actorName: actor?.name, action, entityType, entityId, before, after, reason, ip });
const ROOM_DEPTS = ['rooms', 'room'];

const dto = (r, agents, ) => ({
  id: String(r._id), reservation: String(r.reservation), confirmationNumber: r.confirmationNumber, guestName: r.guestName, arrivalDate: r.arrivalDate, departureDate: r.departureDate,
  agent: String(r.agent), agentName: agents?.get(String(r.agent)) || '', base: r.base, pct: r.pct, source: r.source, calculated: r.calculated, amount: r.amount,
  edited: r.edited ? { by: r.edited.by, at: r.edited.at, note: r.edited.note, from: r.edited.from } : null, manual: !!r.manual, status: r.status,
  hold: r.hold?.kind ? { kind: r.hold.kind, label: HOLD_LABEL[r.hold.kind], note: r.hold.note || '', by: r.hold.by, at: r.hold.at } : null,
  payment: r.payment ? String(r.payment) : null, history: (r.history || []).map((h) => ({ at: h.at, by: h.by, action: h.action, note: h.note })),
});

// Net room revenue of a stay: posted lodging lines on every window, discounts and reversals included.
export async function roomRevenue(reservationId) {
  const folios = await Folio.find({ reservation: reservationId }).select('lines.status lines.type lines.department lines.amount ownerType').lean();
  let sum = 0;
  for (const f of folios) for (const l of f.lines || []) {
    if (l.status !== 'posted' || !ROOM_DEPTS.includes(l.department)) continue;
    if (!['charge', 'discount', 'adjustment', 'fee'].includes(l.type)) continue;
    sum += Number(l.amount || 0);
  }
  return round2(sum);
}

export async function paidInFull(reservationId) {
  const folios = await Folio.find({ reservation: reservationId }).select('lines.status lines.amount lines.taxAmount').lean();
  const bal = folios.flatMap((f) => f.lines || []).filter((l) => l.status === 'posted').reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0);
  return round2(bal) <= 0.005;
}

// Which percent applies, and where it came from. null → the stay does not qualify.
export async function percentFor(reservation, agent) {
  if (reservation.commissionPct != null) return { pct: Number(reservation.commissionPct), source: 'reservation' };
  const plan = reservation.ratePlan ? await RatePlan.findById(reservation.ratePlan).select('commission').lean() : null;
  if (!plan?.commission?.eligible) return null;
  if (plan.commission.pct != null) return { pct: Number(plan.commission.pct), source: 'plan' };
  if (Number(agent?.commissionPct) > 0) return { pct: Number(agent.commissionPct), source: 'agent' };
  return null;
}

// ── Processing ──────────────────────────────────────────────────────────────

// Records for departures up to `date` (inclusive) that have an agent, a qualifying plan, and none yet.
export async function processDepartures({ propertyId, through, from, actor, ip }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const upTo = through && YMD.test(through) ? through : businessDateOf(property);
  const lowest = from && YMD.test(from) ? from : '1970-01-01';
  const reservations = await Reservation.find({
    property: propertyId, status: 'checked_out', travelAgent: { $exists: true, $ne: null }, departureDate: { $gte: lowest, $lte: upTo },
  }).select('travelAgent confirmationNumber primaryGuest arrivalDate departureDate ratePlan commissionPct').populate('primaryGuest', 'firstName lastName').lean();
  if (!reservations.length) return { created: 0, held: 0, skipped: 0 };
  const have = new Set((await CommissionRecord.find({ property: propertyId, reservation: { $in: reservations.map((r) => r._id) } }).select('reservation').lean()).map((r) => String(r.reservation)));
  const agents = new Map((await Company.find({ _id: { $in: [...new Set(reservations.map((r) => String(r.travelAgent)))] }, property: propertyId }).select('name commissionPct').lean()).map((a) => [String(a._id), a]));
  let created = 0; let skipped = 0;
  for (const r of reservations) {
    if (have.has(String(r._id))) continue;
    const agent = agents.get(String(r.travelAgent));
    if (!agent) { skipped += 1; continue; }
    const p = await percentFor(r, agent);
    if (!p || !(p.pct > 0)) { skipped += 1; continue; }
    const base = await roomRevenue(r._id);
    if (!(base > 0)) { skipped += 1; continue; }
    const amount = round2(base * p.pct / 100);
    const name = r.primaryGuest ? [r.primaryGuest.firstName, r.primaryGuest.lastName].filter(Boolean).join(' ') : '';
    try {
      await CommissionRecord.create({
        property: propertyId, reservation: r._id, agent: r.travelAgent, confirmationNumber: r.confirmationNumber, guestName: name || '', arrivalDate: r.arrivalDate, departureDate: r.departureDate,
        base, pct: p.pct, source: p.source, calculated: amount, amount, status: 'ready', history: [stamp(actor, 'created', `${p.pct}% (${p.source})`)],
      });
      created += 1;
    } catch (err) { if (err?.code !== 11000) throw err; }
  }
  if (created) await log(propertyId, actor || { name: 'מערכת' }, ip, 'commission.process', 'CommissionRecord', propertyId, null, { created, through: upTo });
  const released = await releaseWaiting({ propertyId, actor });
  return { created, skipped, released };
}

// "Until the debtor pays": released once the reservation's accounts are settled.
export async function releaseWaiting({ propertyId, actor }) {
  const held = await CommissionRecord.find({ property: propertyId, status: 'held', 'hold.kind': 'until_paid' });
  let released = 0;
  for (const r of held) {
    if (!(await paidInFull(r.reservation))) continue;
    r.status = 'ready'; r.hold = undefined; r.history.push(stamp(actor, 'released', 'החייב שילם'));
    await r.save(); released += 1;
  }
  return released;
}

// ── Review ──────────────────────────────────────────────────────────────────

export async function list({ propertyId, status, agent, from, to, q, limit = 300 }) {
  const f = { property: propertyId };
  if (status === 'open') f.status = { $in: ['ready', 'held'] };
  else if (['ready', 'held', 'paid', 'cancelled'].includes(status)) f.status = status;
  if (agent && isId(agent)) f.agent = agent;
  if (from || to) f.departureDate = { ...(YMD.test(from || '') ? { $gte: from } : {}), ...(YMD.test(to || '') ? { $lte: to } : {}) };
  const needle = String(q || '').trim();
  if (needle) { const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ guestName: rx }, { confirmationNumber: rx }]; }
  const rows = await CommissionRecord.find(f).sort({ departureDate: -1, createdAt: -1 }).limit(Math.min(Number(limit) || 300, 1000)).lean();
  const agents = new Map((await Company.find({ _id: { $in: [...new Set(rows.map((r) => String(r.agent)))] } }).select('name').lean()).map((a) => [String(a._id), a.name]));
  const sums = { ready: 0, held: 0, paid: 0 };
  const all = await CommissionRecord.aggregate([{ $match: { property: new mongoose.Types.ObjectId(String(propertyId)), status: { $in: ['ready', 'held', 'paid'] } } }, { $group: { _id: '$status', total: { $sum: '$amount' }, n: { $sum: 1 } } }]);
  for (const a of all) sums[a._id] = { total: round2(a.total), n: a.n };
  const heldBy = await CommissionRecord.aggregate([{ $match: { property: new mongoose.Types.ObjectId(String(propertyId)), status: 'held' } }, { $group: { _id: '$hold.kind', total: { $sum: '$amount' }, n: { $sum: 1 } } }]);
  return {
    rows: rows.map((r) => dto(r, agents)),
    totals: { ready: sums.ready || { total: 0, n: 0 }, held: sums.held || { total: 0, n: 0 }, paid: sums.paid || { total: 0, n: 0 } },
    heldByKind: heldBy.map((h) => ({ kind: h._id, label: HOLD_LABEL[h._id] || h._id, total: round2(h.total), n: h.n })),
  };
}

async function loadRecord(propertyId, id) {
  const r = isId(id) ? await CommissionRecord.findOne({ _id: id, property: propertyId }) : null;
  if (!r) throw httpError('רשומת העמלה לא נמצאה', 404);
  return r;
}

export async function setHold({ propertyId, id, ids, kind, note, actor, ip }) {
  mustManage(actor);
  if (!HOLD_KINDS.includes(kind)) throw httpError('סוג השהיה לא תקין', 422, { fields: { kind: 'בחרו סוג' } });
  const targets = ids?.length ? ids : [id];
  let n = 0;
  for (const rid of targets) {
    const r = await loadRecord(propertyId, rid);
    if (!['ready', 'held'].includes(r.status)) throw httpError('אפשר להשהות רק עמלה שטרם שולמה', 409);
    r.status = 'held'; r.hold = { kind, note: String(note || '').slice(0, 200), by: actor.name, at: new Date() };
    r.history.push(stamp(actor, 'held', `${HOLD_LABEL[kind]}${note ? ` — ${note}` : ''}`));
    await r.save(); n += 1;
  }
  await log(propertyId, actor, ip, 'commission.hold', 'CommissionRecord', targets[0], null, { kind, count: n });
  return { held: n };
}

export async function releaseHold({ propertyId, id, ids, actor, ip }) {
  mustManage(actor);
  const targets = ids?.length ? ids : [id];
  let n = 0;
  for (const rid of targets) {
    const r = await loadRecord(propertyId, rid);
    if (r.status !== 'held') continue;
    if (r.hold?.kind === 'offset') throw httpError('עמלה שכבר קוזזה לא משתחררת לתשלום — בטלו אותה', 409);
    r.status = 'ready'; r.hold = undefined; r.history.push(stamp(actor, 'released')); await r.save(); n += 1;
  }
  await log(propertyId, actor, ip, 'commission.release', 'CommissionRecord', targets[0], null, { count: n });
  return { released: n };
}

// Amount or percent changed by hand, with a note (never silently).
export async function editAmount({ propertyId, id, amount, note, actor, ip }) {
  mustManage(actor);
  const why = String(note || '').trim();
  if (why.length < 3) throw httpError('שינוי ידני מחייב הערה', 422, { fields: { note: 'יש לפרט' } });
  const value = round2(amount);
  if (!(value >= 0)) throw httpError('סכום אפס ומעלה', 422, { fields: { amount: 'סכום אפס ומעלה' } });
  const r = await loadRecord(propertyId, id);
  if (!['ready', 'held'].includes(r.status)) throw httpError('אפשר לשנות רק עמלה שטרם שולמה', 409);
  const was = r.amount;
  r.amount = value; r.edited = { by: actor.name, at: new Date(), note: why.slice(0, 200), from: was };
  r.history.push(stamp(actor, 'edited', `${was} → ${value} · ${why}`));
  await r.save();
  await log(propertyId, actor, ip, 'commission.edit', 'CommissionRecord', r._id, { amount: was }, { amount: value }, why);
  return dto(r.toObject());
}

// A reservation the agent was never linked to: enters held, for review.
export async function addManual({ propertyId, body, actor, ip }) {
  mustManage(actor);
  const ref = String(body.reservation || '').trim();
  const res = await Reservation.findOne({ ...(isId(ref) ? { _id: ref } : { confirmationNumber: ref }), property: propertyId }).select('confirmationNumber primaryGuest arrivalDate departureDate status travelAgent').populate('primaryGuest', 'firstName lastName').lean();
  if (!res) throw httpError('ההזמנה לא נמצאה — בדקו את מספר האישור', 404, { fields: { reservation: 'לא נמצאה' } });
  if (!isId(body.agent)) throw httpError('בחרו סוכן', 422, { fields: { agent: 'סוכן חובה' } });
  const agent = await Company.findOne({ _id: body.agent, property: propertyId }).select('name').lean();
  if (!agent) throw httpError('הסוכן לא נמצא', 404);
  const amount = round2(body.amount); const note = String(body.note || '').trim();
  if (!(amount > 0)) throw httpError('סכום חיובי', 422, { fields: { amount: 'סכום חיובי' } });
  if (note.length < 3) throw httpError('רשומה ידנית מחייבת הערה', 422, { fields: { note: 'יש לפרט' } });
  if (await CommissionRecord.exists({ property: propertyId, reservation: res._id })) throw httpError('להזמנה כבר יש רשומת עמלה', 409);
  const base = await roomRevenue(res._id);
  const rec = await CommissionRecord.create({
    property: propertyId, reservation: res._id, agent: agent._id, confirmationNumber: res.confirmationNumber, guestName: res.primaryGuest ? [res.primaryGuest.firstName, res.primaryGuest.lastName].filter(Boolean).join(' ') : '', arrivalDate: res.arrivalDate, departureDate: res.departureDate,
    base, pct: base > 0 ? round2(amount / base * 100) : 0, source: 'manual', calculated: amount, amount, manual: true, status: 'held',
    hold: { kind: 'review', note: 'רשומה ידנית', by: actor.name, at: new Date() }, history: [stamp(actor, 'manual', note)],
  });
  await log(propertyId, actor, ip, 'commission.manual', 'CommissionRecord', rec._id, null, { amount, agent: String(agent._id), reservation: String(res._id) }, note);
  return dto(rec.toObject(), new Map([[String(agent._id), agent.name]]));
}

// Remove a reservation from its agent: an unpaid record is cancelled; a paid one stays for the audit trail.
export async function detachReservation({ propertyId, reservationId, reason, actor, ip }) {
  mustManage(actor);
  const why = String(reason || '').trim();
  if (why.length < 3) throw httpError('ניתוק מסוכן מחייב סיבה', 422, { fields: { reason: 'יש לפרט' } });
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId });
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  if (!res.travelAgent) throw httpError('ההזמנה לא מחוברת לסוכן', 409);
  const rec = await CommissionRecord.findOne({ property: propertyId, reservation: res._id });
  if (rec?.status === 'paid') throw httpError('העמלה כבר שולמה — לא ניתן לנתק', 409);
  const agent = res.travelAgent;
  res.travelAgent = undefined; await res.save();
  if (rec) { rec.status = 'cancelled'; rec.hold = undefined; rec.history.push(stamp(actor, 'detached', why)); await rec.save(); }
  await log(propertyId, actor, ip, 'commission.detach', 'Reservation', res._id, { travelAgent: String(agent) }, null, why);
  return { detached: true, cancelled: !!rec };
}

// ── Payment ─────────────────────────────────────────────────────────────────

export async function prePaymentReport({ propertyId, agent, from, to }) {
  if (!YMD.test(from || '') || !YMD.test(to || '') || to < from) throw httpError('טווח עזיבות לא תקין', 422);
  const f = { property: propertyId, status: { $in: ['ready', 'held'] }, departureDate: { $gte: from, $lte: to }, ...(agent && isId(agent) ? { agent } : {}) };
  const rows = await CommissionRecord.find(f).sort({ agent: 1, departureDate: 1 }).lean();
  const agents = new Map((await Company.find({ _id: { $in: [...new Set(rows.map((r) => String(r.agent)))] } }).select('name').lean()).map((a) => [String(a._id), a.name]));
  const by = new Map();
  for (const r of rows) {
    const k = String(r.agent);
    const e = by.get(k) || { agent: k, agentName: agents.get(k) || '', payable: 0, payableCount: 0, held: 0, heldCount: 0 };
    if (r.status === 'ready') { e.payable = round2(e.payable + r.amount); e.payableCount += 1; } else { e.held = round2(e.held + r.amount); e.heldCount += 1; }
    by.set(k, e);
  }
  const list = [...by.values()];
  return { from, to, agents: list, payable: round2(list.reduce((s, e) => s + e.payable, 0)), held: round2(list.reduce((s, e) => s + e.held, 0)), rows: rows.map((r) => dto(r, agents)) };
}

// One payment per agent for the ready (not held) records with departures in the range.
export async function pay({ propertyId, body, actor, ip }) {
  mustManage(actor);
  const method = ['cheque', 'transfer', 'file'].includes(body.method) ? body.method : 'cheque';
  const { from, to } = body;
  if (!YMD.test(from || '') || !YMD.test(to || '') || to < from) throw httpError('טווח עזיבות לא תקין', 422);
  const only = Array.isArray(body.agents) && body.agents.length ? body.agents.filter(isId) : null;
  const start = method === 'cheque' ? Number(body.startNumber) : null;
  if (method === 'cheque' && !(Number.isInteger(start) && start > 0)) throw httpError('מספר שיק התחלתי חובה', 422, { fields: { startNumber: 'מספר שלם חיובי' } });
  const stamp0 = Date.now().toString(36).toUpperCase();
  const rows = await CommissionRecord.find({ property: propertyId, status: 'ready', departureDate: { $gte: from, $lte: to }, ...(only ? { agent: { $in: only } } : {}) }).sort({ agent: 1, departureDate: 1 });
  if (!rows.length) throw httpError('אין עמלות מוכנות לתשלום בטווח', 409);
  const byAgent = new Map();
  for (const r of rows) { const k = String(r.agent); if (!byAgent.has(k)) byAgent.set(k, []); byAgent.get(k).push(r); }
  const agents = new Map((await Company.find({ _id: { $in: [...byAgent.keys()] } }).select('name').lean()).map((a) => [String(a._id), a.name]));
  const made = []; let seq = 0;
  for (const [agentId, recs] of byAgent) {
    const amount = round2(recs.reduce((s, r) => s + r.amount, 0));
    if (!(amount > 0)) continue;
    const number = method === 'cheque' ? String(start + seq) : method === 'transfer' ? String(body.reference || `TR-${stamp0}`).slice(0, 40) + (byAgent.size > 1 ? `-${seq + 1}` : '') : `FILE-${stamp0}-${seq + 1}`;
    seq += 1;
    let pay;
    try {
      pay = await CommissionPayment.create({ property: propertyId, agent: agentId, number, method, amount, from, to, records: recs.map((r) => r._id), createdByName: actor.name, history: [stamp(actor, 'issued', `${recs.length} הזמנות`)] });
    } catch (err) {
      if (err?.code === 11000) throw httpError(`מספר ${number} כבר קיים בתשלומים`, 409, { fields: { startNumber: 'כבר בשימוש' } });
      throw err;
    }
    for (const r of recs) { r.status = 'paid'; r.payment = pay._id; r.history.push(stamp(actor, 'paid', `${method === 'cheque' ? 'שיק' : method === 'transfer' ? 'העברה' : 'קובץ'} ${number}`)); await r.save(); }
    made.push({ id: String(pay._id), agent: agentId, agentName: agents.get(agentId) || '', number, amount, count: recs.length });
  }
  await log(propertyId, actor, ip, 'commission.pay', 'CommissionPayment', made[0]?.id || propertyId, null, { method, from, to, payments: made.length, total: round2(made.reduce((s, m) => s + m.amount, 0)) });
  return { payments: made, total: round2(made.reduce((s, m) => s + m.amount, 0)) };
}

const payDto = (p, agents) => ({
  id: String(p._id), agent: String(p.agent), agentName: agents?.get(String(p.agent)) || '', number: p.number, method: p.method, amount: p.amount, from: p.from, to: p.to,
  count: (p.records || []).length, status: p.status, statusLabel: PAY_LABEL[p.status], clearedAt: p.clearedAt, printedAt: p.printedAt, createdAt: p.createdAt, createdByName: p.createdByName,
  history: (p.history || []).map((h) => ({ at: h.at, by: h.by, action: h.action, note: h.note })),
});

export async function listPayments({ propertyId, agent, status, from, to, q }) {
  const f = { property: propertyId };
  if (agent && isId(agent)) f.agent = agent;
  if (PAY_LABEL[status]) f.status = status;
  if (YMD.test(from || '') || YMD.test(to || '')) f.createdAt = { ...(YMD.test(from || '') ? { $gte: new Date(`${from}T00:00:00Z`) } : {}), ...(YMD.test(to || '') ? { $lte: new Date(`${to}T23:59:59Z`) } : {}) };
  const needle = String(q || '').trim();
  if (needle) f.number = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const rows = await CommissionPayment.find(f).sort({ createdAt: -1 }).limit(300).lean();
  const agents = new Map((await Company.find({ _id: { $in: [...new Set(rows.map((r) => String(r.agent)))] } }).select('name').lean()).map((a) => [String(a._id), a.name]));
  return rows.map((p) => payDto(p, agents));
}

export async function paymentDetail({ propertyId, id }) {
  const p = isId(id) ? await CommissionPayment.findOne({ _id: id, property: propertyId }).lean() : null;
  if (!p) throw httpError('התשלום לא נמצא', 404);
  const agent = await Company.findById(p.agent).select('name taxId address').lean();
  const recs = await CommissionRecord.find({ _id: { $in: p.records } }).sort({ departureDate: 1 }).lean();
  return { ...payDto(p, new Map([[String(p.agent), agent?.name || '']])), agent: { id: String(p.agent), name: agent?.name || '', taxId: agent?.taxId || '', address: agent?.address || '' }, records: recs.map((r) => dto(r, new Map())) };
}

// issued → cleared | not_presented; cleared → issued (back); void is final and returns the records to processing.
export async function setPaymentStatus({ propertyId, id, status, note, actor, ip }) {
  mustManage(actor);
  const p = isId(id) ? await CommissionPayment.findOne({ _id: id, property: propertyId }) : null;
  if (!p) throw httpError('התשלום לא נמצא', 404);
  if (p.status === 'voided') throw httpError('תשלום שבוטל לא ניתן לשינוי — אי אפשר לבטל ביטול', 409);
  const allowed = { issued: ['cleared', 'not_presented', 'voided'], cleared: ['issued'], not_presented: ['issued', 'voided'] };
  if (!(allowed[p.status] || []).includes(status)) throw httpError(`אי אפשר לעבור מ"${PAY_LABEL[p.status]}" ל"${PAY_LABEL[status] || status}"`, 409);
  if (status === 'voided' && String(note || '').trim().length < 3) throw httpError('ביטול תשלום מחייב סיבה', 422, { fields: { note: 'יש לפרט' } });
  const was = p.status;
  p.status = status; p.clearedAt = status === 'cleared' ? new Date() : undefined;
  p.history.push(stamp(actor, status, note));
  await p.save();
  if (status === 'voided') {
    const recs = await CommissionRecord.find({ _id: { $in: p.records } });
    for (const r of recs) { r.status = 'ready'; r.payment = undefined; r.history.push(stamp(actor, 'payment_voided', `${p.number}${note ? ` — ${note}` : ''}`)); await r.save(); }
  }
  await log(propertyId, actor, ip, 'commission.payment_status', 'CommissionPayment', p._id, { status: was }, { status }, note);
  return payDto(p.toObject(), new Map());
}

export async function markPrinted({ propertyId, id, actor, ip }) {
  mustManage(actor);
  const p = await CommissionPayment.findOne({ _id: id, property: propertyId });
  if (!p) throw httpError('התשלום לא נמצא', 404);
  p.printedAt = new Date(); p.history.push(stamp(actor, 'printed')); await p.save();
  await log(propertyId, actor, ip, 'commission.print', 'CommissionPayment', p._id, null, { number: p.number });
  return { printed: true };
}

// Reports: transferred (paid) by departure range; payable = ready (not held).
export async function report({ propertyId, kind, from, to }) {
  if (!YMD.test(from || '') || !YMD.test(to || '') || to < from) throw httpError('טווח עזיבות לא תקין', 422);
  const status = kind === 'paid' ? 'paid' : 'ready';
  const rows = await CommissionRecord.find({ property: propertyId, status, departureDate: { $gte: from, $lte: to } }).sort({ agent: 1, departureDate: 1 }).lean();
  const agents = new Map((await Company.find({ _id: { $in: [...new Set(rows.map((r) => String(r.agent)))] } }).select('name').lean()).map((a) => [String(a._id), a.name]));
  return { kind: status === 'paid' ? 'paid' : 'payable', from, to, total: round2(rows.reduce((s, r) => s + r.amount, 0)), rows: rows.map((r) => dto(r, agents)) };
}

export async function reservationCommission({ propertyId, reservationId }) {
  const rec = await CommissionRecord.findOne({ property: propertyId, reservation: reservationId }).lean();
  if (!rec) return null;
  const agent = await Company.findById(rec.agent).select('name').lean();
  return dto(rec, new Map([[String(rec.agent), agent?.name || '']]));
}

export async function agentsList({ propertyId }) {
  const rows = await Company.find({ property: propertyId, type: { $in: ['agency', 'tour_operator'] }, active: { $ne: false } }).select('name commissionPct agentCode').sort({ name: 1 }).lean();
  return rows.map((a) => ({ id: String(a._id), name: a.name, commissionPct: a.commissionPct || 0, agentCode: a.agentCode || '' }));
}
