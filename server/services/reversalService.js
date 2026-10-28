// Gap G6 — walking a stay back without workarounds (OPERA: reinstate reservation, reverse check-in,
// post-stay charging).
//
//  - Reinstate a cancelled / no-show booking: the stock is taken again only if every night is still
//    available (checked under the same room-type lock as selling), the original agreed price stays,
//    an assigned room that was taken since is released, and nothing is done to money: refunds or
//    credit notes made after the cancellation stay as they are and are reported back.
//  - Reverse a check-in: only on the business day of the check-in and before any room night was
//    posted (after that it is an early departure). Units go back to reserved, the room is freed
//    (and marked dirty if the guest used it).
//  - Post-stay charge: a late charge (minibar found after departure) goes to a separate "post-stay"
//    folio window, so issued documents of the stay are untouched; manager/finance, reason required,
//    within the property's post-stay window.
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import Invoice from '../models/Invoice.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { withLocks } from './locks.js';
import { nightlyAvailability, incrementInventory, getOccupiedRoomIds } from './availabilityService.js';
import { enqueueChannelUpdate } from './channelQueueService.js';
import { httpError, businessDateOf, MANAGER_ROLES, IN_HOUSE_STATUSES } from './frontDeskService.js';
import { folioBalance } from './departureService.js';
import { postCharge } from './financeService.js';
import { MANAGER_POST_ROLES } from './chargeCodeService.js';

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const FRONT_ROLES = [...MANAGER_ROLES, 'receptionist'];

function reasonOf(r) {
  const why = String(r || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('הפעולה מחייבת סיבה', 422, { fields: { reason: 'יש לפרט סיבה' } });
  return why;
}

async function loadRes(propertyId, id) {
  if (!isId(String(id || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const res = await Reservation.findOne({ _id: id, property: propertyId });
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  return res;
}

const localDate = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

// Money that moved after the cancellation — shown so the desk knows to collect again.
async function moneyAfter(res, since) {
  const folios = await Folio.find({ reservation: res._id }).select('lines').lean();
  const lines = folios.flatMap((f) => f.lines).filter((l) => l.status === 'posted' && since && new Date(l.postedAt) >= since);
  const refunds = round2(lines.filter((l) => l.type === 'refund').reduce((s, l) => s + Number(l.amount || 0), 0));
  const credits = await Invoice.find({ reservation: res._id, type: 'credit_note', createdAt: { $gte: since || new Date(0) } }).select('invoiceNumber totalGross').lean();
  return { refunds, creditNotes: credits.map((c) => ({ number: c.invoiceNumber, gross: round2(Math.abs(c.totalGross || 0)) })) };
}

// ── Reinstate (cancelled / no-show) ─────────────────────────────────────────
export async function reinstatePreview({ propertyId, reservationId }) {
  const res = await loadRes(propertyId, reservationId);
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const blockers = [];
  if (!['cancelled', 'no_show'].includes(res.status)) blockers.push('רק הזמנה שבוטלה או סומנה "לא הגיע" ניתנת לשחזור');
  if (res.status === 'cancelled' && res.arrivalDate < today) blockers.push('מועד ההגעה עבר — יוצרים הזמנה חדשה');
  if (res.status === 'no_show' && res.departureDate <= today) blockers.push('מועד העזיבה עבר — אין שהייה לשחזר');
  if (res.status === 'no_show' && res.arrivalDate < addDays(today, -1)) blockers.push('אפשר לשחזר "לא הגיע" רק עד יום אחרי מועד ההגעה');
  let nights = [];
  if (res.roomType && !blockers.length) {
    const avail = await nightlyAvailability({ propertyId, roomTypeId: res.roomType, arrivalDate: res.arrivalDate, departureDate: res.departureDate, excludeReservationId: res._id });
    const need = res.roomsCount || 1;
    // Past nights of a late no-show are not sold any more; only nights from today count.
    nights = avail.nights.map((n) => ({ ...n, needed: need, ok: n.date < today || (!n.missing && n.available >= need && !n.stopSell) }));
    const short = nights.filter((n) => !n.ok);
    if (short.length) blockers.push(`אין מלאי פנוי ל־${short.length} לילות (${short.slice(0, 4).map((n) => n.date).join(', ')}) — יש לשנות תאריכים או סוג חדר בהזמנה חדשה`);
  }
  let roomWarning = null;
  if (res.assignedRoom && !blockers.length) {
    const taken = await getOccupiedRoomIds({ propertyId, roomTypeId: res.roomType, arrivalDate: res.arrivalDate, departureDate: res.departureDate, excludeReservationId: res._id });
    if (taken.has(String(res.assignedRoom))) roomWarning = 'החדר ששובץ נתפס בינתיים — השיבוץ יוסר ויש לשבץ מחדש';
  }
  const since = res.status === 'cancelled' ? res.cancelledAt : res.noShowAt;
  return {
    reservationId: String(res._id), status: res.status, arrivalDate: res.arrivalDate, departureDate: res.departureDate,
    allowed: blockers.length === 0, blockers, roomWarning,
    managerOnly: res.status === 'no_show',
    money: await moneyAfter(res, since),
    price: { totalAmount: res.totalAmount ?? null, note: 'המחיר שהוסכם בהזמנה נשמר' },
  };
}

export async function reinstateReservation({ propertyId, reservationId, reason, actor, ip }) {
  const why = reasonOf(reason);
  const first = await loadRes(propertyId, reservationId);
  const roles = first.status === 'no_show' ? MANAGER_ROLES : FRONT_ROLES;
  if (!roles.includes(actor.role)) throw httpError(first.status === 'no_show' ? 'שחזור "לא הגיע" מותר למנהל משמרת ומעלה' : 'אין הרשאה לשחזר הזמנה', 403);
  const key = first.roomType ? [`inv:${propertyId}:${first.roomType}`, `res:${first._id}`] : [`res:${first._id}`];
  return withLocks(key, async () => {
    const preview = await reinstatePreview({ propertyId, reservationId });
    if (!preview.allowed) throw httpError(preview.blockers[0], 409, { details: preview.blockers });
    const res = await loadRes(propertyId, reservationId);
    const from = res.status;
    const before = { status: res.status, assignedRoom: res.assignedRoom ? String(res.assignedRoom) : null };
    res.status = 'confirmed';
    if (preview.roomWarning) res.assignedRoom = undefined;
    res.reversals.push({ kind: from === 'no_show' ? 'reinstate_no_show' : 'reinstate_cancelled', from, to: 'confirmed', at: new Date(), by: actor.id || undefined, byName: actor.name, reason: why });
    res.lastChange = { at: new Date(), by: actor.name, reason: why, kind: 'reinstate' };
    res.updatedBy = actor.id || undefined;
    await res.save();
    const unitSet = { status: 'reserved' };
    await ReservationRoom.updateMany({ reservation: res._id, status: from }, { $set: unitSet });
    if (preview.roomWarning) await ReservationRoom.updateMany({ reservation: res._id, status: 'reserved' }, { $unset: { assignedRoom: 1 } });
    // Mirror of the release done on cancel / no-show (same nights, same count).
    if (res.roomType) {
      await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, res.roomsCount || 1, {
        propertyId: res.property, actorId: actor.id, actorName: actor.name, ip, action: 'inventory.reservation_reinstated', reason: `Reservation ${res.confirmationNumber}`,
      });
    }
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.reinstated', entityType: 'Reservation', entityId: res._id, reason: why, before, after: { status: 'confirmed', roomReleased: !!preview.roomWarning, refundsAfterCancel: preview.money.refunds }, ip });
    await enqueueChannelUpdate({
      propertyId: res.property, channel: res.source || 'direct', eventType: 'reservation',
      payload: { action: 'reinstated', reservationId: String(res._id), confirmationNumber: res.confirmationNumber },
      idempotencyKey: res.idempotencyKey ? `${res.idempotencyKey}:reservation:reinstated:${res.reversals.length}` : undefined,
    }).catch(() => null);
    return { reservationId: String(res._id), status: 'confirmed', roomReleased: !!preview.roomWarning, money: preview.money };
  }, { waitMs: 4000 });
}

// ── Reverse check-in ────────────────────────────────────────────────────────
async function roomNightsPosted(resId) {
  const folios = await Folio.find({ reservation: resId }).select('lines.department lines.type lines.status lines.reversalOf').lean();
  return folios.flatMap((f) => f.lines).filter((l) => l.status === 'posted' && l.type === 'charge' && ['rooms', 'room'].includes(l.department)).length;
}

export async function reverseCheckInPreview({ propertyId, reservationId }) {
  const res = await loadRes(propertyId, reservationId);
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const blockers = [];
  if (!IN_HOUSE_STATUSES.includes(res.status)) blockers.push('ההזמנה אינה בשהייה');
  if (res.status === 'partially_checked_out') blockers.push('חלק מהיחידות כבר יצאו — מטפלים ביציאה');
  if (res.checkedInAt && localDate(res.checkedInAt, property?.timezone) !== today) blockers.push('ביטול כניסה אפשרי רק ביום העסקי של הכניסה — אחר כך זו עזיבה מוקדמת');
  const nights = await roomNightsPosted(res._id);
  if (nights) blockers.push(`כבר נרשמו ${nights} חיובי לינה — זו עזיבה מוקדמת, לא ביטול כניסה`);
  const units = await ReservationRoom.find({ reservation: res._id, status: { $in: ['in_house', 'checked_in'] } }).populate('assignedRoom', 'number').lean();
  return {
    reservationId: String(res._id), status: res.status, allowed: blockers.length === 0, blockers,
    units: units.map((u) => ({ id: String(u._id), room: u.assignedRoom?.number || null })),
    note: 'חיובים ותשלומים שנרשמו נשארים בחשבון. מפתחות שהונפקו — יש לבטל ידנית (אין ספק מפתחות מחובר).',
  };
}

export async function reverseCheckIn({ propertyId, reservationId, reason, roomUsed, actor, ip }) {
  if (!MANAGER_ROLES.includes(actor.role)) throw httpError('ביטול כניסה מותר למנהל משמרת ומעלה', 403);
  const why = reasonOf(reason);
  return withLocks([`res:${reservationId}`], async () => {
    const preview = await reverseCheckInPreview({ propertyId, reservationId });
    if (!preview.allowed) throw httpError(preview.blockers[0], 409, { details: preview.blockers });
    const res = await loadRes(propertyId, reservationId);
    const from = res.status;
    const units = await ReservationRoom.find({ reservation: res._id, status: { $in: ['in_house', 'checked_in'] } }).lean();
    const roomIds = [...new Set([...units.map((u) => u.assignedRoom), res.assignedRoom].filter(Boolean).map(String))];
    await ReservationRoom.updateMany({ _id: { $in: units.map((u) => u._id) } }, { $set: { status: 'reserved' } });
    const roomSet = { occStatus: 'vacant' };
    if (roomUsed) roomSet.cleanStatus = 'dirty';
    if (roomIds.length) await Room.updateMany({ _id: { $in: roomIds }, property: propertyId }, { $set: roomSet });
    res.status = 'confirmed';
    res.checkedInAt = undefined;
    res.reversals.push({ kind: 'reverse_check_in', from, to: 'confirmed', at: new Date(), by: actor.id || undefined, byName: actor.name, reason: why });
    res.lastChange = { at: new Date(), by: actor.name, reason: why, kind: 'reverse_check_in' };
    res.updatedBy = actor.id || undefined;
    await res.save();
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.check_in_reversed', entityType: 'Reservation', entityId: res._id, reason: why, before: { status: from, units: units.length }, after: { status: 'confirmed', rooms: roomIds.length, roomUsed: !!roomUsed }, ip });
    return { reservationId: String(res._id), status: 'confirmed', units: units.length, roomsFreed: roomIds.length, roomMarkedDirty: !!roomUsed };
  });
}

// ── Post-stay (late) charge ─────────────────────────────────────────────────
export async function postStayCharge({ propertyId, reservationId, input, actor, ip }) {
  if (!MANAGER_POST_ROLES.includes(actor.role)) throw httpError('חיוב אחרי יציאה מותר למנהל או לכספים', 403);
  const why = reasonOf(input.reason);
  const res = await loadRes(propertyId, reservationId);
  if (res.status !== 'checked_out') throw httpError('חיוב אחרי יציאה רק להזמנה שיצאה — לשהייה פעילה רושמים חיוב רגיל', 409);
  const property = await Property.findById(propertyId).select('timezone financePolicy dayClose').lean();
  const today = businessDateOf(property);
  const windowDays = Number(property?.financePolicy?.postStayDays ?? 30);
  const out = res.checkedOutAt ? localDate(res.checkedOutAt, property?.timezone) : res.departureDate;
  if (addDays(out, windowDays) < today) throw httpError(`עברו יותר מ־${windowDays} ימים מהיציאה — חיוב מאוחר דורש טיפול בחייבים`, 409);
  return withLocks([`res:${reservationId}`], async () => {
    // One open post-stay window per stay; issued documents of the stay stay untouched.
    let folio = await Folio.findOne({ reservation: res._id, ownerRef: 'post_stay', status: { $ne: 'closed' } });
    if (!folio) folio = await Folio.create({ property: res.property, reservation: res._id, ownerType: 'guest', ownerRef: 'post_stay', currency: res.currency || 'ILS', lines: [] });
    const serviceDate = /^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate || '') ? input.serviceDate : (res.departureDate <= today ? res.departureDate : today);
    const result = await postCharge({
      propertyId, folioId: String(folio._id), actor, ip,
      input: { ...input, serviceDate, reason: why, auditAction: 'folio.post_stay_charge' },
    });
    return { ...result, folioId: String(folio._id), postStay: true };
  });
}

// FIN-01: close a settled window (balance zero) of a stay that is no longer in house.
export async function closeSettledFolio({ propertyId, folioId, actor, ip }) {
  if (!isId(String(folioId || ''))) throw httpError('מזהה חשבון לא תקין', 400);
  const folio = await Folio.findOne({ _id: folioId, property: propertyId });
  if (!folio) throw httpError('החשבון לא נמצא', 404);
  if (folio.status === 'closed') return { folioId: String(folio._id), status: 'closed', duplicate: true };
  const res = await Reservation.findById(folio.reservation).select('status').lean();
  if (res && [...IN_HOUSE_STATUSES, 'confirmed', 'modified', 'pending_payment', 'hold'].includes(res.status)) throw httpError('החשבון של שהייה פעילה נסגר באשף היציאה', 409);
  const bal = folioBalance(folio);
  if (Math.abs(bal) > 0.005) throw httpError(`אפשר לסגור רק חשבון מאוזן (יתרה ${bal.toFixed(2)})`, 409);
  folio.status = 'closed';
  folio.closedAt = new Date();
  folio.closedBy = actor.id || undefined;
  await folio.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.closed', entityType: 'Folio', entityId: folio._id, after: { status: 'closed' }, ip });
  return { folioId: String(folio._id), status: 'closed' };
}
