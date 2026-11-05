// Voucher — who pays for what, chosen once on the reservation. The choice opens the payer's window
// (a company/agent folio linked to the stay) and drives routing:
//   agent_all  — nights, board and extras go to the payer's window
//   agent_room — nights and board to the payer; extras stay on the guest
//   deposit    — the payer covers lodging up to an amount; the rest is the guest's
//   guest_all  — the guest pays everything (the voucher is only a reference)
// A change applies from now on: lines already posted stay where they are (moving them is a
// separate, audited transfer). The voucher number can be mandatory per company.
import Reservation from '../models/Reservation.js';
import Company from '../models/Company.js';
import Folio from '../models/Folio.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';

export const VOUCHER_TYPES = {
  agent_all: 'הסוכן משלם הכול',
  agent_room: 'החדר על הסוכן, התוספות על האורח',
  deposit: 'הסוכן משלם מקדמה, השאר על האורח',
  guest_all: 'האורח משלם הכול',
};
export const ROOM_CODES = ['rooms', 'board'];
const CLOSED = ['checked_out', 'cancelled', 'no_show', 'deleted'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Who may be the payer: the agent and/or the company already on the reservation.
export async function payerOptions(res, session = null) {
  const ids = [['agent', res.travelAgent], ['company', res.company]].filter(([, id]) => id);
  const docs = await Company.find({ _id: { $in: ids.map(([, id]) => id) } }).session(session).select('name type voucherRequired ar.restricted').lean();
  return ids.map(([role, id]) => {
    const c = docs.find((d) => String(d._id) === String(id?._id || id));
    return c ? { role, id: String(c._id), name: c.name, voucherRequired: !!c.voucherRequired, restricted: !!c.ar?.restricted } : null;
  }).filter(Boolean);
}

// Validates the input and returns the voucher to store (no write).
export async function buildVoucher({ res, input, actor, session = null }) {
  const type = String(input?.type || '');
  const fields = {};
  if (!VOUCHER_TYPES[type]) fields.voucherType = 'יש לבחור סוג Voucher';
  const options = await payerOptions(res, session);
  let payer = null;
  if (input?.payerId) payer = options.find((o) => o.id === String(input.payerId)) || null;
  else if (options.length === 1) payer = options[0];
  if (type && type !== 'guest_all' && !payer) fields.voucherPayer = options.length > 1 ? 'יש לבחור מי משלם: הסוכן או החברה' : 'אין סוכן או חברה בהזמנה';
  if (input?.payerId && !payer) fields.voucherPayer = 'המשלם חייב להיות הסוכן או החברה של ההזמנה';
  if (type && type !== 'guest_all' && payer?.restricted) fields.voucherPayer = `חשבון החייבים של ${payer.name} מוגבל — לא נרשמים אליו חיובים חדשים`;
  const number = String(input?.number || '').trim().slice(0, 40);
  if (payer?.voucherRequired && !number) fields.voucherNumber = `מספר Voucher חובה אצל ${payer.name}`;
  const amount = round2(input?.amount);
  if (type === 'deposit' && !(amount > 0)) fields.voucherAmount = 'סכום חיובי';
  if (Object.keys(fields).length) throw httpError('יש להשלים את פרטי ה־Voucher', 422, { fields });
  return {
    type, number: number || undefined, amount: type === 'deposit' ? amount : undefined,
    payerRef: type === 'guest_all' ? undefined : payer.id, payerRole: type === 'guest_all' ? undefined : payer.role, payerName: type === 'guest_all' ? undefined : payer.name,
    by: actor.id || undefined, byName: actor.name, at: new Date(),
  };
}

// The payer's window for this stay (created on demand).
export async function payerFolio(reservation, payerRef, { create = true, session = null } = {}) {
  let folio = await Folio.findOne({ reservation: reservation._id, ownerType: 'company', ownerRef: String(payerRef), status: { $ne: 'closed' } }).session(session);
  if (!folio && create) {
    [folio] = await Folio.create([{ property: reservation.property, reservation: reservation._id, ownerType: 'company', ownerRef: String(payerRef), currency: reservation.currency || 'ILS', lines: [] }], { session });
  }
  return folio;
}

export function routesRoom(v) { return !!v?.payerRef && ['agent_all', 'agent_room', 'deposit'].includes(v.type); }
export function routesExtras(v) { return !!v?.payerRef && v.type === 'agent_all'; }

export async function setVoucher({ propertyId, reservationId, input, actor, ip, session = null, afterCommit = null }) {
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).session(session);
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  if (CLOSED.includes(res.status)) throw httpError('ההזמנה נסגרה — לא משנים Voucher', 409);
  const before = res.voucher?.type ? { type: res.voucher.type, number: res.voucher.number || null, payer: res.voucher.payerName || null, amount: res.voucher.amount ?? null } : null;
  const v = await buildVoucher({ res, input, actor, session });
  res.voucher = v;
  if (v.payerRef && v.type !== 'guest_all' && res.guaranteeType === 'none') res.guaranteeType = 'voucher';
  res.updatedBy = actor.id || undefined;
  await res.save({ session });
  if (routesRoom(v)) await payerFolio(res, v.payerRef, { session });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.voucher_set', entityType: 'Reservation', entityId: res._id, before, after: { type: v.type, number: v.number || null, payer: v.payerName || null, amount: v.amount ?? null }, ip, session, afterCommit });
  return { voucher: publicVoucher(v) };
}

export function publicVoucher(v) {
  if (!v?.type) return null;
  return { type: v.type, label: VOUCHER_TYPES[v.type], number: v.number || null, amount: v.amount ?? null, payerId: v.payerRef || null, payerRole: v.payerRole || null, payerName: v.payerName || null, by: v.byName || null, at: v.at || null };
}
