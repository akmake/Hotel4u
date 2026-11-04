// Multi-option quotations: priced by the same engine as a booking (searchAvailability), sent as one
// printable document, and converted into a reservation for the option the customer picked.
import mongoose from 'mongoose';
import Proposal from '../models/Proposal.js';
import Property from '../models/Property.js';
import GuestProfile from '../models/GuestProfile.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { searchAvailability, createBooking } from './bookingService.js';
import { getNextSequenceValue } from '../models/Counter.js';

const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BOARD = { room_only: 'לינה בלבד', breakfast: 'לינה וארוחת בוקר', half_board: 'חצי פנסיון', full_board: 'פנסיון מלא' };
const STATUS = { open: 'פתוחה', sent: 'נשלחה', won: 'הומרה להזמנה', lost: 'נסגרה' };

function dto(p) {
  const expired = ['open', 'sent'].includes(p.status) && new Date(p.validUntil) < new Date();
  return {
    id: String(p._id), number: p.number, status: p.status, statusLabel: expired ? 'פג תוקף' : STATUS[p.status], expired,
    customer: p.customer || {}, guestId: p.guest ? String(p.guest) : null,
    arrival: p.arrival, departure: p.departure, nights: p.nights, adults: p.adults, children: p.children, childAges: p.childAges || [], promoCode: p.promoCode || null,
    options: (p.options || []).map((o) => ({ id: String(o._id), roomTypeId: String(o.roomTypeId), roomTypeName: o.roomTypeName, ratePlanId: String(o.ratePlanId), ratePlanName: o.ratePlanName, board: o.board, boardLabel: BOARD[o.board] || '', rooms: o.rooms, total: o.total, averageNight: o.averageNight, refundable: o.refundable, cancellation: o.cancellation, note: o.note || null })),
    cheapest: Math.min(...(p.options || []).map((o) => o.total || 0)),
    validUntil: p.validUntil, sentAt: p.sentAt || null, chosenOption: p.chosenOption ? String(p.chosenOption) : null, reservationId: p.reservation ? String(p.reservation) : null,
    lostReason: p.lostReason || null, note: p.note || null, internalNote: p.internalNote || null, createdBy: p.createdByName || null, createdAt: p.createdAt, closedAt: p.closedAt || null,
  };
}

export async function listProposals({ propertyId, view = 'open', q }) {
  const filter = { property: propertyId };
  if (view === 'open') filter.status = { $in: ['open', 'sent'] };
  else if (view === 'won') filter.status = 'won';
  else if (view === 'lost') filter.status = 'lost';
  if (q) {
    const rx = new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ number: rx }, { 'customer.name': rx }, { 'customer.phone': rx }, { 'customer.email': rx }, { 'customer.company': rx }];
  }
  const rows = await Proposal.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  const all = await Proposal.aggregate([{ $match: { property: new mongoose.Types.ObjectId(String(propertyId)) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const c = Object.fromEntries(all.map((x) => [x._id, x.n]));
  return { rows: rows.map(dto), counts: { open: (c.open || 0) + (c.sent || 0), won: c.won || 0, lost: c.lost || 0 } };
}

export async function getProposal({ propertyId, id }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const p = await Proposal.findOne({ _id: id, property: propertyId }).lean();
  if (!p) throw httpError('ההצעה לא נמצאה', 404);
  return dto(p);
}

// Options are re-priced on the server — the client only says which room type / plan / board.
export async function createProposal({ propertyId, input, actor, ip }) {
  const b = input || {};
  const errors = {};
  const customer = { name: String(b.customer?.name || '').trim().slice(0, 120), phone: String(b.customer?.phone || '').trim().slice(0, 30), email: String(b.customer?.email || '').trim().toLowerCase().slice(0, 120), company: String(b.customer?.company || '').trim().slice(0, 120) };
  let guest = null;
  if (b.guestId) {
    guest = isId(b.guestId) ? await GuestProfile.findOne({ _id: b.guestId, property: propertyId }).select('firstName lastName phone email').lean() : null;
    if (!guest) errors.guestId = 'האורח לא נמצא';
    else { customer.name = customer.name || `${guest.firstName || ''} ${guest.lastName || ''}`.trim(); customer.phone = customer.phone || guest.phone || ''; customer.email = customer.email || guest.email || ''; }
  }
  if (customer.name.length < 2) errors['customer.name'] = 'שם הלקוח';
  if (!customer.phone && !customer.email) errors['customer.phone'] = 'טלפון או דוא״ל';
  const opts = Array.isArray(b.options) ? b.options.slice(0, 8) : [];
  if (!opts.length) errors.options = 'לפחות חלופה אחת';
  const validUntil = b.validUntil && !Number.isNaN(Date.parse(b.validUntil)) ? new Date(b.validUntil) : null;
  if (!validUntil || validUntil <= new Date()) errors.validUntil = 'תוקף בעתיד';
  else if (validUntil > new Date(Date.now() + 30 * 86400000)) errors.validUntil = 'עד 30 יום';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי ההצעה', 422, { fields: errors });
  const rooms = Math.max(1, Math.min(20, Number(b.rooms || 1)));
  const query = { arrival: b.arrival, departure: b.departure, adults: Number(b.adults || 2), children: Number(b.children || 0), childAges: b.childAges || [], rooms, promoCode: b.promoCode || undefined };
  const options = [];
  const boards = [...new Set(opts.map((o) => o.board || ''))];
  const searches = new Map();
  for (const bd of boards) searches.set(bd, await searchAvailability({ propertyId, query: { ...query, board: bd || undefined } }));
  const first = searches.values().next().value;
  if (b.promoCode && !first?.promo?.ok) throw httpError(first?.promo?.why || 'קוד מבצע לא תקין', 422, { fields: { promoCode: first?.promo?.why || 'לא תקין' } });
  for (const o of opts) {
    const s = searches.get(o.board || '');
    const offer = s.offers.find((x) => x.roomType.id === String(o.roomTypeId) && x.ratePlan.id === String(o.ratePlanId));
    if (!offer) throw httpError('אחת החלופות אינה זמינה לתאריכים', 422, { fields: { options: 'חלופה לא זמינה' } });
    if (!offer.bookable) throw httpError(`${offer.roomType.name} · ${offer.ratePlan.name}: ${offer.reasons[0]?.label || 'לא ניתן למכירה'}`, 409, { fields: { options: 'לא ניתן למכירה' } });
    options.push({
      roomTypeId: offer.roomType.id, roomTypeName: offer.roomType.name, ratePlanId: offer.ratePlan.id, ratePlanName: offer.ratePlan.name, board: offer.board.type, rooms,
      total: offer.total, averageNight: offer.averageNight, refundable: offer.ratePlan.refundable, cancellation: offer.cancellation.text, priceSignature: offer.priceSignature,
      note: String(o.note || '').trim().slice(0, 200) || undefined,
    });
  }
  const seq = await getNextSequenceValue(`proposal:${propertyId}`);
  const p = await Proposal.create({
    property: propertyId, number: `Q-${String(seq).padStart(5, '0')}`, guest: guest?._id, customer,
    arrival: first.arrival, departure: first.departure, nights: first.nights, adults: first.adults, children: first.children, childAges: query.childAges, promoCode: first.promo?.ok ? first.promo.code : undefined,
    options, validUntil, note: String(b.note || '').trim().slice(0, 1000) || undefined, internalNote: String(b.internalNote || '').trim().slice(0, 1000) || undefined, createdByName: actor.name,
  });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'proposal.created', entityType: 'Proposal', entityId: p._id, after: { number: p.number, options: options.length, arrival: p.arrival }, ip });
  return dto(p.toObject());
}

export async function markSent({ propertyId, id, actor, ip }) {
  const p = await Proposal.findOne({ _id: id, property: propertyId });
  if (!p) throw httpError('ההצעה לא נמצאה', 404);
  if (!['open', 'sent'].includes(p.status)) throw httpError('ההצעה כבר נסגרה', 409);
  p.status = 'sent'; p.sentAt = new Date();
  await p.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'proposal.sent', entityType: 'Proposal', entityId: p._id, ip });
  return dto(p.toObject());
}

export async function closeLost({ propertyId, id, reason, actor, ip }) {
  const p = await Proposal.findOne({ _id: id, property: propertyId });
  if (!p) throw httpError('ההצעה לא נמצאה', 404);
  if (!['open', 'sent'].includes(p.status)) throw httpError('ההצעה כבר נסגרה', 409);
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('סגירה מחייבת סיבה', 422, { fields: { reason: 'סיבה' } });
  Object.assign(p, { status: 'lost', lostReason: why, closedAt: new Date(), closedByName: actor.name });
  await p.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'proposal.lost', entityType: 'Proposal', entityId: p._id, reason: why, ip });
  return dto(p.toObject());
}

// The customer picked one option → a confirmed reservation at today's price for that option.
// If the price moved since the proposal was made, the desk must accept the new price first.
export async function acceptOption({ propertyId, id, optionId, acceptNewPrice, idempotencyKey, actor, ip }) {
  const p = await Proposal.findOne({ _id: id, property: propertyId });
  if (!p) throw httpError('ההצעה לא נמצאה', 404);
  if (p.status === 'won') return { reservationId: String(p.reservation), duplicate: true };
  if (!['open', 'sent'].includes(p.status)) throw httpError('ההצעה נסגרה', 409);
  if (p.validUntil < new Date()) throw httpError('תוקף ההצעה עבר — צרו הצעה חדשה', 409, { code: 'expired' });
  const o = p.options.id(optionId);
  if (!o) throw httpError('החלופה לא נמצאה', 404);
  const [firstName, ...rest] = (p.customer?.name || '').split(/\s+/);
  const input = {
    idempotencyKey: String(idempotencyKey || ''), mode: 'confirm', source: 'phone',
    arrival: p.arrival, departure: p.departure, adults: p.adults, children: p.children, childAges: p.childAges || [], rooms: o.rooms || 1,
    roomTypeId: String(o.roomTypeId), ratePlanId: String(o.ratePlanId), board: o.board, promoCode: p.promoCode || undefined,
    ...(acceptNewPrice ? {} : { priceSignature: o.priceSignature }),
    ...(p.guest ? { guestId: String(p.guest) } : { newGuest: { firstName: firstName || p.customer?.name, lastName: rest.join(' ') || '-', phone: p.customer?.phone, email: p.customer?.email }, forceNewGuest: true }),
    internalNotes: `מהצעת מחיר ${p.number}`,
  };
  const out = await createBooking({ propertyId, input, actor, ip });
  Object.assign(p, { status: 'won', chosenOption: o._id, reservation: out.id, closedAt: new Date(), closedByName: actor.name });
  await p.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'proposal.won', entityType: 'Proposal', entityId: p._id, after: { reservationId: out.id, confirmationNumber: out.confirmationNumber, option: `${o.roomTypeName} · ${o.ratePlanName}` }, ip });
  return { reservationId: out.id, confirmationNumber: out.confirmationNumber };
}

export async function printProposal({ propertyId, id }) {
  const p = await Proposal.findOne({ _id: id, property: propertyId }).lean();
  if (!p) throw httpError('ההצעה לא נמצאה', 404);
  const prop = await Property.findById(propertyId).select('name phone email address city timezone dayClose').lean();
  const fmt = (n) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(n || 0);
  const date = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('he-IL', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  const guests = `${p.adults} מבוגרים${p.children ? ` · ${p.children} ילדים` : ''}`;
  const rows = p.options.map((o, i) => `<tr><td><b>חלופה ${i + 1}</b></td><td>${esc(o.roomTypeName)}${o.rooms > 1 ? ` × ${o.rooms}` : ''}<div class="muted">${esc(o.ratePlanName)} · ${esc(BOARD[o.board] || '')}${o.refundable === false ? ' · ללא החזר' : ''}</div>${o.note ? `<div class="muted">${esc(o.note)}</div>` : ''}</td><td>${esc(fmt(o.averageNight))}</td><td class="total">${esc(fmt(o.total))}</td></tr><tr><td></td><td colspan="3" class="muted">${esc(o.cancellation || '')}</td></tr>`).join('');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>הצעת מחיר ${esc(p.number)}</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#111}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{border-bottom:1px solid #e5e5e5;padding:8px 4px;text-align:right;vertical-align:top}.muted{color:#666;font-size:13px}.total{font-weight:700}.box{border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0}@media print{button{display:none}}</style></head><body>
<h1>${esc(prop?.name || '')} — הצעת מחיר</h1>
<div class="muted">${esc([prop?.address, prop?.city].filter(Boolean).join(', '))} ${esc(prop?.phone || '')} ${esc(prop?.email || '')}</div>
<div class="box"><div>מספר הצעה: <b>${esc(p.number)}</b></div><div>עבור: <b>${esc(p.customer?.name || '')}</b>${p.customer?.company ? ` · ${esc(p.customer.company)}` : ''}</div>
<div>תאריכים: ${esc(date(p.arrival))} – ${esc(date(p.departure))} · ${esc(p.nights)} לילות · ${esc(guests)}</div></div>
${p.note ? `<p>${esc(p.note)}</p>` : ''}
<table><thead><tr><th></th><th>חדר ותנאים</th><th>ממוצע ללילה</th><th>סה״כ לשהייה</th></tr></thead><tbody>${rows}</tbody></table>
<div class="box"><b>תוקף ההצעה:</b> ${esc(new Date(p.validUntil).toLocaleString('he-IL'))}<div class="muted">המחירים כוללים מע״מ. זו הצעת מחיר ואינה הזמנה מאושרת או מסמך מס; המחיר והזמינות ייבדקו מחדש באישור.</div></div>
<button onclick="window.print()">הדפסה</button></body></html>`;
}

export { businessDateOf };
