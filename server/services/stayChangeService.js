// Stay changes (spec W04/W05/W07: FD-09 room move, FD-10 extension, FD-11 early departure,
// RSV-05 booking change, RSV-06 cancellation with eligibility check).
//
// Rules enforced here (server-side):
//  - every change shows its consequences first (preview) and re-checks everything on commit;
//  - a move never rewrites completed nights: the active segment ends, a new one starts (T08);
//  - an extension is never silent: every added night needs the same room free and stock (T09);
//  - nights already charged are never deleted; a final document is corrected by a credit note (T10);
//  - a change to a stay that already started goes through move/extend/early departure, not RSV-05;
//  - a cancellation notice is always accepted and recorded with when/how it arrived; stock is
//    released; the rules produce a *proposal* with its source — no cancellation fee is charged
//    automatically (gate G06); credit note and refund are separate steps (W07).
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import Folio from '../models/Folio.js';
import Invoice from '../models/Invoice.js';
import Property from '../models/Property.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import { audit } from './auditService.js';
import { withLocks } from './locks.js';
import { getStayDates, nightlyAvailability, incrementInventory } from './availabilityService.js';
import { priceNights } from './bookingService.js';
import { cancelReservation } from './reservationService.js';
import { folioBalance } from './departureService.js';
import { raiseWork } from './platformService.js';
import {
  httpError, loadProperty, businessDateOf, ensureUnits, conflictingRoomIds, policyOf, MANAGER_ROLES, IN_HOUSE_STATUSES,
} from './frontDeskService.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const PRICE_ROLES = [...new Set([...MANAGER_ROLES, 'revenue_manager'])];
const PRE_ARRIVAL = ['confirmed', 'modified', 'pending_payment', 'hold'];
const TOOK_STOCK = ['confirmed', 'modified', 'pending_payment', 'hold'];
// Who initiated the move decides what may happen to the agreed price (hotel practice):
//  - hotel-initiated (fault, operational need, courtesy upgrade): the guest never pays more;
//  - guest-initiated (asked to move, bought an upgrade): the remaining nights may follow the new
//    room's rate — more only with the guest's consent, less as a goodwill decision.
// Only the remaining nights are ever repriced; nights already slept keep their price.
export const MOVE_REASONS = {
  guest_request: 'בקשת האורח', upgrade_sold: 'שדרוג בתשלום (האורח ביקש)',
  maintenance: 'תקלה בחדר', hotel_need: 'צורך של המלון (תפוסה/שיבוץ)', upgrade_free: 'שדרוג מטעם המלון', other: 'אחר',
};
const GUEST_INITIATED = ['guest_request', 'upgrade_sold'];
const REASON_ALIASES = { upgrade: 'upgrade_free' };
export const EARLY_REASONS = { guest_request: 'בקשת האורח', service_issue: 'תקלה או שירות', event: 'אירוע אישי', other: 'אחר' };

async function loadRes(propertyId, id) {
  if (!isId(String(id || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const res = await Reservation.findOne({ _id: id, property: propertyId });
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  return res;
}

async function issuedDocs(resId) {
  return Invoice.find({ reservation: resId, status: 'issued', type: { $ne: 'credit_note' } }).select('invoiceNumber totalGross').lean();
}

async function inHouseUnit(res, unitId, fromRoomId) {
  await ensureUnits(res);
  const units = await ReservationRoom.find({ reservation: res._id }).sort({ createdAt: 1, _id: 1 });
  const live = units.filter((u) => ['in_house', 'checked_in'].includes(u.status));
  if (!live.length) throw httpError('אין יחידה שוהה בהזמנה', 409);
  // From the room chart the unit is known by the room it is dragged out of.
  if (!unitId && fromRoomId) {
    const byRoom = live.find((u) => String(u.assignedRoom || '') === String(fromRoomId));
    if (byRoom) return { unit: byRoom, units };
  }
  if (unitId) {
    const u = live.find((x) => String(x._id) === String(unitId));
    if (!u) throw httpError('היחידה אינה שוהה כעת', 409);
    return { unit: u, units };
  }
  if (live.length > 1) throw httpError('יש לבחור יחידה', 422, { fields: { unitId: 'בחירה נדרשת' } });
  return { unit: live[0], units };
}

// ── FD-09 room move ─────────────────────────────────────────────────────────
export async function moveCandidates({ propertyId, reservationId, unitId, fromRoomId }) {
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const policy = policyOf(await Property.findById(propertyId).select('checkInPolicy').lean());
  const res = await loadRes(propertyId, reservationId);
  if (!IN_HOUSE_STATUSES.includes(res.status)) throw httpError('מעבר חדר מתבצע רק לאורח שבבית', 409);
  const { unit, units } = await inHouseUnit(res, unitId, fromRoomId);
  const to = unit.departureDate || res.departureDate;
  const conflicts = await conflictingRoomIds({ propertyId, from: today, to, excludeReservationId: res._id });
  for (const s of units) if (s.assignedRoom && String(s._id) !== String(unit._id)) conflicts.set(String(s.assignedRoom), 'יחידה אחרת בהזמנה זו');
  const rooms = await Room.find({ property: propertyId, active: { $ne: false } }).populate('roomType', 'name code').sort({ floor: 1, number: 1 }).lean();
  const ready = policy.requireInspection ? ['inspected'] : ['clean', 'inspected'];
  // Price of the remaining nights: as agreed, and per room type from the rate calendar (same rate plan).
  const remaining = remainingNightsOf(res, unit, today, to);
  const byType = {};
  for (const t of [...new Set(rooms.map((r) => String(r.roomType?._id || '')).filter(Boolean))]) {
    const q = await priceNights({ roomTypeId: t, ratePlanId: res.ratePlan, dates: remaining.map((n) => n.date), adults: res.adults || 2, children: res.children || 0, rooms: res.roomsCount || 1 });
    byType[t] = { total: q.missing.length ? null : q.perRoom, nightly: q.nightly, missing: q.missing };
  }
  return {
    unitId: String(unit._id), from: today, to,
    current: unit.assignedRoom ? String(unit.assignedRoom) : null,
    currentRoom: (() => { const c = rooms.find((r) => String(r._id) === String(unit.assignedRoom)); return c ? { number: c.number, floor: c.floor, roomType: c.roomType ? { id: String(c.roomType._id), name: c.roomType.name } : null } : null; })(),
    pricing: {
      nights: remaining.length,
      agreed: { total: round2(remaining.reduce((a, n) => a + n.price, 0)), nightly: remaining },
      byType,
      ratePlan: !!res.ratePlan,
      reasons: Object.entries(MOVE_REASONS).map(([value, label]) => ({ value, label, guestInitiated: GUEST_INITIATED.includes(value) })),
    },
    rooms: rooms.filter((r) => String(r._id) !== String(unit.assignedRoom)).map((r) => {
      const conflict = conflicts.get(String(r._id)) || null;
      const blocked = r.opsStatus !== 'available';
      const notReady = !ready.includes(r.cleanStatus);
      return {
        id: String(r._id), number: r.number, floor: r.floor, roomType: r.roomType ? { id: String(r.roomType._id), name: r.roomType.name } : null,
        sameType: String(r.roomType?._id) === String(unit.roomTypeBooked || res.roomType), cleanStatus: r.cleanStatus, opsStatus: r.opsStatus,
        available: !conflict && !blocked && !notReady,
        why: conflict ? `תפוס (${conflict})` : blocked ? 'חסום תפעולית' : notReady ? 'לא מוכן (ניקיון)' : null,
      };
    }),
  };
}

// Remaining nights of the unit with the price agreed for each (snapshot first, unit rate as fallback).
function remainingNightsOf(res, unit, today, to) {
  const agreed = new Map((res.priceSnapshot?.nightly || []).map((n) => [n.date, Number(n.price)]));
  const fallback = Number(unit.nightlyRate || res.ratePerNight || 0);
  return getStayDates(today, to).map((date) => ({ date, price: round2(agreed.has(date) ? agreed.get(date) : fallback) }));
}

export async function moveRoom({ propertyId, reservationId, input, actor, ip }) {
  const reasonKey = REASON_ALIASES[input.reason] || input.reason;
  const reason = MOVE_REASONS[reasonKey] ? reasonKey : null;
  const note = String(input.note || '').trim().slice(0, 300);
  const fields = {};
  if (!reason) fields.reason = 'יש לבחור סיבה';
  if (reason === 'other' && note.length < 3) fields.note = 'יש לפרט';
  if (!isId(String(input.roomId || ''))) fields.roomId = 'יש לבחור חדר יעד';
  // Price: keep (default) | target (new room's calendar rate for the remaining nights) | manual (flat per night).
  // Legacy callers sent only `rate` → manual.
  const priceMode = ['keep', 'target', 'manual'].includes(input.priceMode) ? input.priceMode : (input.rate !== undefined && input.rate !== null && input.rate !== '' ? 'manual' : 'keep');
  const manualRate = priceMode === 'manual' ? round2(input.rate) : null;
  if (priceMode !== 'keep') {
    if (!PRICE_ROLES.includes(actor.role)) throw httpError('שינוי מחיר במעבר חדר מותר למנהל', 403);
    if (priceMode === 'manual' && !(manualRate > 0)) fields.rate = 'מחיר חיובי';
    if (String(input.rateReason || '').trim().length < 3) fields.rateReason = 'סיבה לשינוי מחיר';
  }
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי המעבר', 422, { fields });

  return withLocks([`room:${input.roomId}`, `res:${reservationId}`], async () => {
    const property = await loadProperty(propertyId);
    const today = businessDateOf(property);
    const policy = policyOf(await Property.findById(propertyId).select('checkInPolicy').lean());
    const res = await loadRes(propertyId, reservationId);
    if (!IN_HOUSE_STATUSES.includes(res.status)) throw httpError('מעבר חדר מתבצע רק לאורח שבבית', 409);
    const { unit } = await inHouseUnit(res, input.unitId, input.fromRoomId);
    const target = await Room.findOne({ _id: input.roomId, property: propertyId, active: { $ne: false } });
    if (!target) throw httpError('חדר היעד לא נמצא', 404);
    if (String(target._id) === String(unit.assignedRoom)) throw httpError('זה החדר הנוכחי', 422);
    if (target.opsStatus !== 'available') throw httpError(`חדר ${target.number} חסום תפעולית`, 409);
    const ready = policy.requireInspection ? ['inspected'] : ['clean', 'inspected'];
    if (!ready.includes(target.cleanStatus)) throw httpError(`חדר ${target.number} אינו מוכן (${target.cleanStatus})`, 409);
    const to = unit.departureDate || res.departureDate;
    // T08: re-checked under the lock — the target may have been taken a second ago.
    const conflicts = await conflictingRoomIds({ propertyId, from: today, to, excludeReservationId: res._id });
    if (conflicts.has(String(target._id))) throw httpError(`חדר ${target.number} נתפס בינתיים (${conflicts.get(String(target._id))}) — המעבר לא בוצע`, 409, { code: 'target_taken' });

    const oldRoomId = unit.assignedRoom;
    const oldType = unit.roomTypeBooked || res.roomType;
    const newType = target.roomType;
    // New price of the remaining nights, then the initiator rule on the total.
    const remaining = remainingNightsOf(res, unit, today, to);
    const agreedTotal = round2(remaining.reduce((a, n) => a + n.price, 0));
    let newNightly = null;
    if (priceMode === 'target') {
      const q = await priceNights({ roomTypeId: newType, ratePlanId: res.ratePlan, dates: remaining.map((n) => n.date), adults: res.adults || 2, children: res.children || 0, rooms: res.roomsCount || 1 });
      if (!res.ratePlan || q.missing.length) throw httpError(`אין מחיר בלוח התעריפים לחדר היעד ל־${q.missing.length || remaining.length} לילות — אפשר להשאיר את המחיר או להזין מחיר ידני`, 422, { fields: { priceMode: 'אין מחיר בלוח' } });
      newNightly = q.nightly.map((n) => ({ date: n.date, price: round2(n.price) }));
    } else if (priceMode === 'manual') {
      newNightly = remaining.map((n) => ({ date: n.date, price: manualRate }));
    }
    const newTotal = newNightly ? round2(newNightly.reduce((a, n) => a + n.price, 0)) : agreedTotal;
    if (newNightly && newTotal - agreedTotal > 0.005) {
      if (!GUEST_INITIATED.includes(reason)) throw httpError('המעבר ביוזמת המלון — אי אפשר לחייב את האורח יותר מהמחיר שהוסכם', 422, { fields: { priceMode: 'לא בהעברה ביוזמת המלון' }, code: 'hotel_initiated_increase' });
      if (String(input.guestConsentRef || '').trim().length < 2) throw httpError('העלאת מחיר מחייבת אישור של האורח (איך ומתי אישר)', 422, { fields: { guestConsentRef: 'נדרש אישור האורח' } });
    }
    if (newNightly && Math.abs(newTotal - agreedTotal) < 0.005) newNightly = null; // nothing actually changes
    // The agreed per-night price is shared by all rooms of a booking; repricing one room of a
    // multi-room booking would reprice them all — that is a booking change, not a move.
    if (newNightly && ((res.roomsCount || 1) > 1 || (await ReservationRoom.countDocuments({ reservation: res._id })) > 1)) {
      throw httpError('בהזמנה מרובת חדרים המחיר משותף לכל החדרים — מעבירים עם אותו מחיר, ושינוי מחיר מתבצע בשינוי הזמנה', 422, { fields: { priceMode: 'לא בהזמנה מרובת חדרים' } });
    }
    const rate = newNightly ? round2(newTotal / Math.max(1, newNightly.length)) : Number(unit.nightlyRate || res.ratePerNight || 0);
    const newRate = newNightly ? rate : null;

    // Segments: the active one ends today, a new one starts today (completed nights untouched).
    const active = await StaySegment.find({ reservationRoom: unit._id, toDate: { $gt: today } }).sort({ fromDate: 1 });
    for (const seg of active) {
      if (seg.fromDate < today) { seg.toDate = today; await seg.save(); }
      else await StaySegment.deleteOne({ _id: seg._id });
    }
    await StaySegment.create({
      reservationRoom: unit._id, reservation: res._id, property: propertyId, fromDate: today, toDate: to, roomType: newType, room: target._id,
      ratePerNight: rate, ratePlan: res.ratePlan || undefined, changeReason: `מעבר חדר: ${MOVE_REASONS[reason]}${note ? ` — ${note}` : ''}`,
      createdBy: actor.id || undefined, createdByName: actor.name,
    });
    unit.assignedRoom = target._id;
    if (String(oldType) !== String(newType)) unit.roomTypeBooked = newType;
    if (newRate !== null) unit.nightlyRate = newRate;
    await unit.save();
    const set = {};
    if (String(res.assignedRoom || '') === String(oldRoomId || '')) set.assignedRoom = target._id;
    if (newNightly) {
      // Nights already slept keep their price; remaining nights take the new per-night price.
      const kept = (res.priceSnapshot?.nightly || []).filter((n) => n.date < today);
      set['priceSnapshot.nightly'] = [...kept, ...newNightly];
      set['priceSnapshot.total'] = round2([...kept, ...newNightly].reduce((a, n) => a + Number(n.price), 0));
      set.totalAmount = set['priceSnapshot.total'];
    }
    if (Object.keys(set).length) await Reservation.updateOne({ _id: res._id }, { $set: set });
    // Rooms: the old one needs cleaning before anyone else; the new one is occupied.
    if (oldRoomId) {
      await Room.updateOne({ _id: oldRoomId }, { $set: { occStatus: 'vacant', cleanStatus: 'dirty' } });
      const exists = await HousekeepingTask.exists({ room: oldRoomId, date: today, status: { $in: ['new', 'assigned', 'in_progress', 'paused'] } });
      if (!exists) await HousekeepingTask.create({ property: propertyId, room: oldRoomId, reservation: res._id, type: 'checkout_clean', priority: 'high', date: today, status: 'new', notes: 'אורח עבר חדר', autoCreated: true });
    }
    await Room.updateOne({ _id: target._id }, { $set: { occStatus: 'occupied' } });
    // A different room type moves the remaining nights between the two inventories.
    if (String(oldType) !== String(newType)) {
      await incrementInventory(propertyId, oldType, today, to, -1, { propertyId, actorId: actor.id, actorName: actor.name, ip, action: 'inventory.room_move_out', reason: res.confirmationNumber });
      await incrementInventory(propertyId, newType, today, to, 1, { propertyId, actorId: actor.id, actorName: actor.name, ip, action: 'inventory.room_move_in', reason: res.confirmationNumber });
    }
    const oldRoom = oldRoomId ? await Room.findById(oldRoomId).select('number').lean() : null;
    await audit({
      property: propertyId, actor: actor.id, actorName: actor.name, action: 'stay.room_moved', entityType: 'Reservation', entityId: res._id,
      before: { room: oldRoom?.number || null, remainingTotal: agreedTotal }, after: { room: target.number, priceMode: newNightly ? priceMode : 'keep', remainingTotal: newTotal, keyRequested: !!input.keyRequested, guestConsentRef: input.guestConsentRef || undefined },
      reason: [MOVE_REASONS[reason], note, newNightly ? `מחיר: ${input.rateReason}` : ''].filter(Boolean).join(' · '), ip,
    });
    return {
      reservationId: String(res._id), unitId: String(unit._id), from: oldRoom?.number || null, to: target.number, rate,
      price: { nights: remaining.length, before: agreedTotal, after: newTotal, difference: round2(newTotal - agreedTotal), changed: !!newNightly },
      // INT-04 is not connected: the new key is a separate task, never assumed done.
      key: input.keyRequested ? { status: 'not_connected', message: 'אין ספק מפתחות מחובר — יש להנפיק מפתח לחדר החדש ולבטל את הישן ידנית' } : null,
    };
  });
}

// ── FD-10 extension ─────────────────────────────────────────────────────────
async function extensionPlan({ propertyId, res, newDeparture }) {
  const units = await ReservationRoom.find({ reservation: res._id, status: { $in: ['in_house', 'checked_in'] } }).populate('assignedRoom', 'number opsStatus');
  if (!units.length) throw httpError('אין יחידה שוהה להארכה', 409);
  const oldDep = res.departureDate;
  if (!YMD.test(newDeparture || '') || newDeparture <= oldDep) throw httpError('תאריך היציאה החדש חייב להיות אחרי היציאה הנוכחית', 422, { fields: { newDeparture: 'מאוחר מהיציאה הנוכחית' } });
  const dates = getStayDates(oldDep, newDeparture);
  if (dates.length > 60) throw httpError('הארכה של עד 60 לילות', 422, { fields: { newDeparture: 'ארוך מדי' } });
  const conflicts = await conflictingRoomIds({ propertyId, from: oldDep, to: newDeparture, excludeReservationId: res._id });
  const blockers = [];
  for (const u of units) {
    if (!u.assignedRoom) continue;
    if (conflicts.has(String(u.assignedRoom._id))) blockers.push({ code: 'room_taken', label: `חדר ${u.assignedRoom.number} תפוס בלילות הנוספים (${conflicts.get(String(u.assignedRoom._id))})` });
    if (u.assignedRoom.opsStatus !== 'available') blockers.push({ code: 'room_blocked', label: `חדר ${u.assignedRoom.number} חסום תפעולית בלילות הנוספים` });
  }
  const roomTypeId = units[0].roomTypeBooked || res.roomType;
  const inv = await nightlyAvailability({ propertyId, roomTypeId, arrivalDate: oldDep, departureDate: newDeparture, excludeReservationId: res._id });
  const short = inv.nights.filter((n) => n.missing || n.stopSell || n.available < units.length);
  if (short.length) blockers.push({ code: 'no_stock', label: `אין מלאי ל־${short.slice(0, 3).map((n) => n.date).join(', ')}${short.length > 3 ? '…' : ''}` });
  const price = await priceNights({ roomTypeId, ratePlanId: res.ratePlan, dates, adults: res.adults || 1, children: res.children || 0, rooms: units.length });
  return { units, dates, roomTypeId, blockers, price, oldDep };
}

export async function extensionPreview({ propertyId, reservationId, newDeparture }) {
  const res = await loadRes(propertyId, reservationId);
  if (!IN_HOUSE_STATUSES.includes(res.status)) throw httpError('הארכה מתבצעת לאורח שבבית; לפני ההגעה — שינוי הזמנה', 409);
  const plan = await extensionPlan({ propertyId, res, newDeparture });
  const priced = plan.price.missing.length === 0;
  return {
    currentDeparture: plan.oldDep, newDeparture, nights: plan.dates.length, units: plan.units.length,
    nightly: plan.price.nightly, missingRates: plan.price.missing, perRoom: plan.price.perRoom,
    total: priced ? round2(plan.price.perRoom * plan.units.length) : null, priceSignature: plan.price.signature,
    blockers: plan.blockers, canExtend: plan.blockers.length === 0,
    needsManualPrice: !priced,
    suggestion: plan.blockers.some((b) => b.code === 'room_taken' || b.code === 'room_blocked') ? 'אפשר להאריך עם מעבר לחדר פנוי (מעבר חדר ואז הארכה), או לבחור תאריך אחר' : null,
  };
}

export async function extendStay({ propertyId, reservationId, input, actor, ip }) {
  const fields = {};
  const payment = String(input.paymentArrangement || '').trim().slice(0, 200);
  const confirmation = String(input.guestConfirmation || '').trim().slice(0, 200);
  if (payment.length < 2) fields.paymentArrangement = 'יש לציין הסדר תשלום / ערבות';
  if (confirmation.length < 2) fields.guestConfirmation = 'אסמכתה לאישור האורח';
  const manual = input.manualRate === undefined || input.manualRate === null || input.manualRate === '' ? null : round2(input.manualRate);
  if (manual !== null) {
    if (!PRICE_ROLES.includes(actor.role)) throw httpError('מחיר ידני להארכה מותר למנהל', 403);
    if (!(manual > 0)) fields.manualRate = 'מחיר חיובי';
    if (String(input.reason || '').trim().length < 3) fields.reason = 'סיבת חריג מחיר';
  }
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי ההארכה', 422, { fields });
  return withLocks([`res:${reservationId}`], async () => {
    const res = await loadRes(propertyId, reservationId);
    if (!IN_HOUSE_STATUSES.includes(res.status)) throw httpError('הארכה מתבצעת לאורח שבבית', 409);
    const plan = await extensionPlan({ propertyId, res, newDeparture: input.newDeparture });
    if (plan.blockers.length) throw httpError(plan.blockers[0].label, 409, { code: 'cannot_extend', details: plan.blockers });
    let nightly = plan.price.nightly;
    if (manual !== null) nightly = plan.dates.map((d) => ({ date: d, price: manual }));
    else {
      if (plan.price.missing.length) throw httpError('אין מחיר בלוח התעריפים לחלק מהלילות — נדרש מחיר ידני של מנהל', 409, { code: 'manual_price_required' });
      if (input.priceSignature && input.priceSignature !== plan.price.signature) throw httpError('המחיר ללילות הנוספים השתנה — יש לאשר מחדש', 409, { code: 'price_changed', details: [{ nightly: plan.price.nightly, priceSignature: plan.price.signature }] });
    }
    const added = round2(nightly.reduce((s, n) => s + n.price, 0) * plan.units.length);
    const newDep = input.newDeparture;
    for (const u of plan.units) {
      await StaySegment.updateMany({ reservationRoom: u._id, toDate: plan.oldDep }, { $set: { toDate: newDep } });
      u.departureDate = newDep;
      await u.save();
    }
    const nights = getStayDates(res.arrivalDate, newDep).length;
    await Reservation.updateOne({ _id: res._id }, {
      $set: {
        departureDate: newDep, nights, totalAmount: round2(Number(res.totalAmount || 0) + added),
        // Nights before the old departure keep their agreed price; the added nights get theirs.
        'priceSnapshot.nightly': [...(res.priceSnapshot?.nightly || []).filter((n) => n.date < plan.oldDep), ...nightly],
        lastChange: { at: new Date(), by: actor.name, reason: manual !== null ? `מחיר ידני: ${input.reason}` : 'הארכת שהייה', confirmationRef: confirmation, kind: 'extend' },
      },
    });
    await incrementInventory(propertyId, plan.roomTypeId, plan.oldDep, newDep, plan.units.length, { propertyId, actorId: actor.id, actorName: actor.name, ip, action: 'inventory.extension', reason: res.confirmationNumber });
    await audit({
      property: propertyId, actor: actor.id, actorName: actor.name, action: 'stay.extended', entityType: 'Reservation', entityId: res._id,
      before: { departureDate: plan.oldDep }, after: { departureDate: newDep, added, payment, confirmation, manualRate: manual }, reason: manual !== null ? input.reason : undefined, ip,
    });
    return { reservationId: String(res._id), departureDate: newDep, nights: plan.dates.length, added };
  });
}

// ── FD-11 early departure (preview; the departure itself runs in FD-08 checkout) ──
export async function earlyDeparturePreview({ propertyId, reservationId }) {
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const res = await loadRes(propertyId, reservationId);
  if (!IN_HOUSE_STATUSES.includes(res.status)) throw httpError('עזיבה מוקדמת רק לאורח שבבית', 409);
  if (res.departureDate <= today) throw httpError('היציאה מתוכננת להיום — זו יציאה רגילה', 409, { code: 'not_early' });
  const released = getStayDates(today, res.departureDate);
  const folios = await Folio.find({ reservation: res._id }).select('lines').lean();
  const futurePosted = folios.flatMap((f) => f.lines).filter((l) => l.status === 'posted' && ['rooms', 'room'].includes(l.department) && l.serviceDate >= today && !l.reversalOf);
  const docs = await issuedDocs(res._id);
  const units = await ReservationRoom.countDocuments({ reservation: res._id, status: { $in: ['in_house', 'checked_in'] } });
  return {
    departureDate: res.departureDate, newDeparture: today, nightsReleased: released.length, units: Math.max(1, units),
    policy: res.cancellationPolicy || null,
    postedFutureNights: futurePosted.length,
    documents: docs.map((d) => ({ number: d.invoiceNumber, gross: d.totalGross })),
    notes: [
      'לילות שכבר חויבו נשארים בחשבון — לא נמחקים.',
      futurePosted.length ? `${futurePosted.length} לילות עתידיים כבר נרשמו לחשבון — תיקון בהיפוך חיוב (מנהל) אם הוחלט לא לגבות.` : null,
      docs.length ? `הונפקו מסמכים (${docs.map((d) => d.invoiceNumber).join(', ')}) — תיקון סכום במסמך זיכוי, לא בשינוי המסמך (T10).` : null,
      'דמי עזיבה מוקדמת / החזר — לפי המדיניות שנרכשה, כפעולה נפרדת בחשבון. אין חיוב אוטומטי.',
    ].filter(Boolean),
  };
}

// ── RSV-05 booking change (before arrival) ──────────────────────────────────
async function modificationPlan({ propertyId, res, changes }) {
  const arrival = changes.arrival || res.arrivalDate;
  const departure = changes.departure || res.departureDate;
  const adults = changes.adults !== undefined ? Number(changes.adults) : res.adults;
  const children = changes.children !== undefined ? Number(changes.children) : (res.children || 0);
  const rooms = res.roomsCount || 1;
  const roomTypeId = changes.roomTypeId || String(res.roomType);
  const ratePlanId = changes.ratePlanId || (res.ratePlan ? String(res.ratePlan) : null);
  const property = await Property.findById(propertyId).select('timezone vatRate').lean();
  const today = businessDateOf(property);
  const fields = {};
  if (!YMD.test(arrival) || !YMD.test(departure) || departure <= arrival) fields.dates = 'טווח תאריכים לא תקין';
  else if (arrival < today) fields.dates = 'לא ניתן להעביר לתאריך שעבר';
  if (!(Number.isInteger(adults) && adults >= 1)) fields.adults = 'לפחות מבוגר אחד';
  if (!(Number.isInteger(children) && children >= 0)) fields.children = 'מספר ילדים לא תקין';
  if (children > 0) {
    const ages = Array.isArray(changes.childAges) ? changes.childAges.map(Number) : (res.childAges || []);
    if (ages.length !== children || ages.some((a) => !Number.isInteger(a) || a < 0 || a > 17)) fields.childAges = 'גיל לכל ילד';
  }
  if (!isId(String(roomTypeId))) fields.roomTypeId = 'סוג חדר לא תקין';
  if (Object.keys(fields).length) throw httpError('יש לתקן את השינוי', 422, { fields });
  const roomType = await RoomType.findOne({ _id: roomTypeId, property: propertyId, active: { $ne: false } }).lean();
  if (!roomType) throw httpError('סוג החדר לא נמצא או אינו פעיל', 422, { fields: { roomTypeId: 'לא זמין' } });
  const dates = getStayDates(arrival, departure);
  const blockers = [];
  const perRoomAdults = Math.ceil(adults / rooms);
  const perRoomChildren = Math.ceil(children / rooms);
  if (perRoomAdults > (roomType.adultsMax || roomType.capacityMax || 2) || perRoomAdults + perRoomChildren > (roomType.capacityMax || 2)) blockers.push({ code: 'capacity', label: 'ההרכב חורג מקיבולת החדר' });
  const inv = await nightlyAvailability({ propertyId, roomTypeId, arrivalDate: arrival, departureDate: departure, excludeReservationId: res._id });
  const ownNights = new Set(TOOK_STOCK.includes(res.status) && String(res.roomType) === String(roomTypeId) ? getStayDates(res.arrivalDate, res.departureDate) : []);
  const short = inv.nights.filter((n) => n.missing || n.stopSell || (n.available + (ownNights.has(n.date) ? rooms : 0)) < rooms);
  if (short.length) blockers.push({ code: 'no_stock', label: `אין מלאי ל־${short.slice(0, 3).map((n) => n.date).join(', ')}${short.length > 3 ? '…' : ''}` });
  if (inv.freeRooms < rooms) blockers.push({ code: 'no_rooms', label: 'אין מספיק חדרים פיזיים פנויים לכל הטווח' });
  const price = await priceNights({ roomTypeId, ratePlanId, dates, adults, children, rooms });
  if (price.missing.length) blockers.push({ code: 'missing_rate', label: `אין מחיר ל־${price.missing.slice(0, 3).join(', ')}` });
  if (price.closed.length) blockers.push({ code: 'rate_closed', label: 'התעריף סגור למכירה בחלק מהלילות' });
  const before = { arrival: res.arrivalDate, departure: res.departureDate, adults: res.adults, children: res.children || 0, roomTypeId: String(res.roomType), ratePlanId: res.ratePlan ? String(res.ratePlan) : null, total: res.totalAmount };
  const total = round2(price.perRoom * rooms);
  return {
    arrival, departure, adults, children, rooms, roomTypeId, ratePlanId, dates, roomType, price, blockers, before,
    after: { arrival, departure, adults, children, roomTypeId, ratePlanId, total, roomType: roomType.name },
    difference: round2(total - Number(res.totalAmount || 0)),
  };
}

export async function modificationPreview({ propertyId, reservationId, changes }) {
  const res = await loadRes(propertyId, reservationId);
  if (IN_HOUSE_STATUSES.includes(res.status)) throw httpError('האורח כבר נכנס — שינוי שהייה דרך הארכה, עזיבה מוקדמת או מעבר חדר', 409, { code: 'in_house' });
  if (!PRE_ARRIVAL.includes(res.status)) throw httpError('לא ניתן לשנות הזמנה בסטטוס זה', 409);
  const plan = await modificationPlan({ propertyId, res, changes: changes || {} });
  const docs = await issuedDocs(res._id);
  return {
    before: plan.before, after: plan.after, difference: plan.difference, nightly: plan.price.nightly, priceSignature: plan.price.signature,
    blockers: plan.blockers, canApply: plan.blockers.length === 0,
    documents: docs.map((d) => ({ number: d.invoiceNumber, gross: d.totalGross })), creditNoteNeeded: docs.length > 0 && plan.difference < 0,
    version: res.updatedAt ? new Date(res.updatedAt).toISOString() : null,
  };
}

export async function modifyBooking({ propertyId, reservationId, input, actor, ip }) {
  const reason = String(input.reason || '').trim().slice(0, 300);
  const confirmationRef = String(input.confirmationRef || '').trim().slice(0, 200);
  const fields = {};
  if (reason.length < 3) fields.reason = 'סיבת שינוי חובה';
  if (confirmationRef.length < 2) fields.confirmationRef = 'אסמכתה לאישור הלקוח';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי השינוי', 422, { fields });
  const first = await loadRes(propertyId, reservationId);
  const keys = [`res:${first._id}`, `inv:${propertyId}:${first.roomType}`];
  if (input.changes?.roomTypeId && input.changes.roomTypeId !== String(first.roomType)) keys.push(`inv:${propertyId}:${input.changes.roomTypeId}`);
  return withLocks(keys, async () => {
    const res = await loadRes(propertyId, reservationId);
    if (input.version && res.updatedAt && new Date(res.updatedAt).toISOString() !== String(input.version)) throw httpError('ההזמנה עודכנה בינתיים — רעננו ובדקו שוב', 409, { code: 'version_conflict' });
    if (IN_HOUSE_STATUSES.includes(res.status)) throw httpError('האורח כבר נכנס — שינוי שהייה דרך הארכה, עזיבה מוקדמת או מעבר חדר', 409, { code: 'in_house' });
    if (!PRE_ARRIVAL.includes(res.status)) throw httpError('לא ניתן לשנות הזמנה בסטטוס זה', 409);
    const plan = await modificationPlan({ propertyId, res, changes: input.changes || {} });
    if (plan.blockers.length) throw httpError(plan.blockers[0].label, 409, { code: 'cannot_apply', details: plan.blockers });
    if (input.priceSignature && input.priceSignature !== plan.price.signature) throw httpError('המחיר השתנה מאז התצוגה — יש לבדוק שוב', 409, { code: 'price_changed' });
    const rooms = plan.rooms;
    const tookStock = TOOK_STOCK.includes(res.status);
    if (tookStock) {
      await incrementInventory(propertyId, res.roomType, res.arrivalDate, res.departureDate, -rooms, { propertyId, actorId: actor.id, actorName: actor.name, ip, action: 'inventory.modify_release', reason: res.confirmationNumber });
      await incrementInventory(propertyId, plan.roomTypeId, plan.arrival, plan.departure, rooms, { propertyId, actorId: actor.id, actorName: actor.name, ip, action: 'inventory.modify_take', reason: res.confirmationNumber });
    }
    const total = plan.after.total;
    const avg = round2(plan.price.perRoom / plan.dates.length);
    // Units follow the booking; an assigned room stays only if it is still the right type and free.
    await ensureUnits(res);
    const units = await ReservationRoom.find({ reservation: res._id, status: { $in: ['reserved', 'tentative'] } });
    const conflicts = await conflictingRoomIds({ propertyId, from: plan.arrival, to: plan.departure, excludeReservationId: res._id });
    const roomIds = units.map((u) => u.assignedRoom).filter(Boolean);
    const roomDocs = await Room.find({ _id: { $in: roomIds } }).select('roomType').lean();
    const typeOf = new Map(roomDocs.map((r) => [String(r._id), String(r.roomType)]));
    let unassigned = 0;
    for (const u of units) {
      const keep = u.assignedRoom && typeOf.get(String(u.assignedRoom)) === String(plan.roomTypeId) && !conflicts.has(String(u.assignedRoom));
      if (u.assignedRoom && !keep) unassigned += 1;
      u.arrivalDate = plan.arrival; u.departureDate = plan.departure; u.roomTypeBooked = plan.roomTypeId; u.nightlyRate = avg;
      if (!keep) u.assignedRoom = null;
      if (plan.ratePlanId) u.ratePlan = plan.ratePlanId;
      await u.save();
    }
    await StaySegment.deleteMany({ reservation: res._id });
    await StaySegment.insertMany(units.map((u) => ({ reservationRoom: u._id, reservation: res._id, property: propertyId, fromDate: plan.arrival, toDate: plan.departure, roomType: plan.roomTypeId, room: u.assignedRoom || null, ratePerNight: avg, ratePlan: plan.ratePlanId || null, changeReason: `שינוי הזמנה: ${reason}`, createdBy: actor.id || undefined, createdByName: actor.name })));
    const firstRoom = units[0]?.assignedRoom || null;
    await Reservation.updateOne({ _id: res._id }, {
      $set: {
        arrivalDate: plan.arrival, departureDate: plan.departure, nights: plan.dates.length, adults: plan.adults, children: plan.children,
        childAges: plan.children ? (Array.isArray(input.changes?.childAges) ? input.changes.childAges.map(Number) : res.childAges) : [],
        roomType: plan.roomTypeId, ratePlan: plan.ratePlanId || undefined, ratePerNight: avg, totalAmount: total, assignedRoom: firstRoom,
        'priceSnapshot.nightly': plan.price.nightly, 'priceSnapshot.total': total, 'priceSnapshot.computedAt': new Date(),
        lastChange: { at: new Date(), by: actor.name, reason, confirmationRef, kind: 'modify' },
        updatedBy: actor.id || undefined,
      },
    });
    const docs = await issuedDocs(res._id);
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.modified', entityType: 'Reservation', entityId: res._id, before: plan.before, after: { ...plan.after, unassignedRooms: unassigned }, reason, ip });
    return { reservationId: String(res._id), total, difference: plan.difference, unassignedRooms: unassigned, creditNoteNeeded: docs.length > 0 && plan.difference < 0 };
  });
}

// ── RSV-06 cancellation with eligibility proposal ───────────────────────────
// Rule sources are shown with the result. They come from the official consumer-protection guide
// (spec 04: IL13–IL17) and are pending legal approval (gate G06) — so this is a proposal for a
// person to decide, never an automatic charge. Days are counted excluding Saturdays only; holiday
// calendars are not configured (flagged in the result).
function workingDaysBetween(fromDate, toDate, restDays = new Set()) {
  let n = 0;
  const d = new Date(fromDate);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setUTCHours(0, 0, 0, 0);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d < end && d.getUTCDay() !== 6 && !restDays.has(d.toISOString().slice(0, 10))) n += 1;
  }
  return n;
}

export function cancellationProposal({ res, input, paid, property }) {
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  const transactionAt = input.transactionAt ? new Date(input.transactionAt) : new Date(res.createdAt || Date.now());
  const disclosureAt = input.disclosureAt ? new Date(input.disclosureAt) : transactionAt;
  const service = new Date(`${res.arrivalDate}T12:00:00Z`);
  const total = Number(res.totalAmount || 0);
  const remote = ['phone', 'web', 'ota', 'email'].includes(input.channel);
  const lines = [];
  const sources = [];
  let statutory = { applies: false, eligible: null };
  let proposedFee = null;
  let needsReview = true;
  if (input.reason === 'service_failure') {
    lines.push('עילת הביטול היא כשל שירות ולא חרטה — לא נגבים דמי ביטול על אי־התאמה או הפרה.');
    sources.push('IL15 — מדריך רשות הגנת הצרכן');
    proposedFee = 0;
  } else if (remote && input.track !== 'contractual') {
    const start = disclosureAt > transactionAt ? disclosureAt : transactionAt;
    const days14 = (receivedAt - start) / 86400000 <= 14;
    const rest = new Set(property?.restDays || []);
    const workdays = workingDaysBetween(receivedAt, service, rest);
    const enough = workdays > 7;
    const protectedTrack = input.track === 'protected';
    statutory = { applies: true, eligible: protectedTrack ? null : days14 && enough, window: { from: start, days: 14 }, workingDaysBeforeService: workdays };
    if (protectedTrack) {
      lines.push('מסלול מוגן (למשל אזרח ותיק/אדם עם מוגבלות/עולה חדש): תקופה מורחבת בתנאים מסוימים — נדרשת בדיקת תנאים וראיה מידתית, לא 14 יום גורף.');
      sources.push('IL14 — מדריך רשות הגנת הצרכן');
    } else {
      lines.push(days14 ? 'ההודעה התקבלה בתוך 14 יום מהעסקה/הגילוי (המאוחר).' : 'ההודעה התקבלה אחרי 14 יום מהעסקה/הגילוי.');
      lines.push(enough ? `נותרו ${workdays} ימים שאינם שבת עד השירות (יותר מ־7).` : `נותרו ${workdays} ימים שאינם שבת עד השירות (7 או פחות).`);
      sources.push('IL13 — מדריך רשות הגנת הצרכן (מכר מרחוק)');
    }
    if (statutory.eligible) {
      proposedFee = round2(Math.min(total * 0.05, 100));
      lines.push(`דמי ביטול לכל היותר: הנמוך מ־5% ומ־100 ₪ = ${proposedFee.toFixed(2)} ₪.`);
      sources.push('IL15 — מדריך רשות הגנת הצרכן');
    }
    lines.push((property?.restDays || []).length ? `מניין הימים מדלג על שבתות ועל ${(property.restDays || []).length} ימי מנוחה שהוגדרו במדיניות הנכס.` : 'מניין הימים מדלג על שבתות בלבד — לוח חגים לא הוגדר במדיניות הנכס (ADM-05).');
  } else {
    // Front-desk/company sale or contractual track: the terms frozen on the booking govern.
    lines.push(remote ? 'נבחר מסלול חוזי.' : 'מכירה פרונטלית או לחברה — כלל המכר מרחוק לא חל אוטומטית; התנאים שנשמרו בהזמנה קובעים.');
    sources.push('IL17 — תנאים חוזיים; תנאי ללא החזר אינו גובר על זכות חוקית');
    const hoursBefore = (service - receivedAt) / 3600000;
    const freeHours = Number(property?.defaultCancellationHours ?? 24);
    if (res.priceSnapshot?.refundable === false) {
      lines.push('התעריף נמכר כ"ללא החזר" — בכפוף לזכויות לפי דין.');
      proposedFee = round2(total);
    } else if (hoursBefore >= freeHours) {
      lines.push(`ההודעה התקבלה ${Math.floor(hoursBefore)} שעות לפני ההגעה — בתוך חלון הביטול החינמי (${freeHours} שעות).`);
      proposedFee = 0;
      needsReview = false;
    } else {
      const feeSetting = property?.defaultCancellationFee;
      const fixed = feeSetting !== 'first_night' && feeSetting !== 'none' && Number(feeSetting) > 0 ? Number(feeSetting) : 0;
      const firstNight = Number(res.priceSnapshot?.nightly?.[0]?.price || res.ratePerNight || 0) * (res.roomsCount || 1);
      proposedFee = feeSetting === 'none' ? 0 : round2(fixed > 0 ? fixed : firstNight);
      lines.push(`ההודעה התקבלה פחות מ־${freeHours} שעות לפני ההגעה — לפי מדיניות הנכס: ${feeSetting === 'none' ? 'ללא דמי ביטול' : fixed > 0 ? 'דמי ביטול קבועים' : 'לילה ראשון'}.`);
    }
  }
  return {
    track: input.track, channel: input.channel, receivedAt, transactionAt, disclosureAt,
    statutory, proposedFee, paid: round2(paid), proposedRefund: proposedFee === null ? null : round2(Math.max(0, paid - proposedFee)),
    // Choosing the "review" or "protected" track always sends the decision to a person.
    lines, sources, needsReview: needsReview || proposedFee === null || ['review', 'protected'].includes(input.track),
    gate: 'G06 — הכרעה משפטית טרם אושרה: ההצעה אינה מחייבת ואין חיוב אוטומטי',
  };
}

function validateCancelInput(input) {
  const fields = {};
  if (!['phone', 'web', 'desk', 'ota', 'company', 'email', 'other'].includes(input.channel)) fields.channel = 'יש לבחור ערוץ';
  if (!['regular', 'protected', 'contractual', 'review'].includes(input.track)) fields.track = 'יש לבחור מסלול';
  if (!['regret', 'service_failure', 'other'].includes(input.reason)) fields.reason = 'יש לבחור סיבה';
  if (input.receivedAt && Number.isNaN(Date.parse(input.receivedAt))) fields.receivedAt = 'מועד לא תקין';
  if (input.receivedAt && Date.parse(input.receivedAt) > Date.now() + 60000) fields.receivedAt = 'מועד קבלה לא יכול להיות בעתיד';
  if (input.reason === 'other' && String(input.note || '').trim().length < 3) fields.note = 'יש לפרט';
  if (Object.keys(fields).length) throw httpError('יש להשלים את פרטי הודעת הביטול', 422, { fields });
}

async function paidOn(resId) {
  const folios = await Folio.find({ reservation: resId }).select('lines').lean();
  const lines = folios.flatMap((f) => f.lines).filter((l) => l.status === 'posted');
  return lines.filter((l) => ['payment', 'deposit'].includes(l.type)).reduce((s, l) => s - Number(l.amount || 0), 0)
    - lines.filter((l) => l.type === 'refund').reduce((s, l) => s + Number(l.amount || 0), 0);
}

export async function cancellationPreview({ propertyId, reservationId, input }) {
  validateCancelInput(input);
  const res = await loadRes(propertyId, reservationId);
  if (IN_HOUSE_STATUSES.includes(res.status)) throw httpError('השהייה כבר התחילה — לא מבטלים אחרי כניסה (T32)', 409);
  if (['cancelled', 'checked_out', 'no_show'].includes(res.status)) throw httpError('ההזמנה כבר נסגרה', 409);
  const property = await Property.findById(propertyId).select('defaultCancellationHours defaultCancellationFee restDays').lean();
  const paid = await paidOn(res._id);
  const docs = await issuedDocs(res._id);
  return { ...cancellationProposal({ res, input, paid, property }), documents: docs.map((d) => ({ number: d.invoiceNumber, gross: d.totalGross })) };
}

export async function cancelWithNotice({ propertyId, reservationId, input, actor, ip }) {
  validateCancelInput(input);
  const res = await loadRes(propertyId, reservationId);
  if (IN_HOUSE_STATUSES.includes(res.status)) throw httpError('השהייה כבר התחילה — לא מבטלים אחרי כניסה (T32)', 409);
  const property = await Property.findById(propertyId).select('defaultCancellationHours defaultCancellationFee restDays').lean();
  const paid = await paidOn(res._id);
  const proposal = cancellationProposal({ res, input, paid, property });
  const note = String(input.note || '').trim().slice(0, 500);
  const reasonText = `${{ regret: 'חרטה', service_failure: 'כשל שירות', other: 'אחר' }[input.reason]}${note ? ` — ${note}` : ''}`;
  // Receiving the notice and releasing stock happen now; money is decided separately.
  const out = await cancelReservation({ reservationId: res._id, reason: reasonText, actorId: actor.id, actorName: actor.name, ip });
  await Reservation.updateOne({ _id: res._id }, {
    $set: {
      cancellation: {
        receivedAt: proposal.receivedAt, channel: input.channel, transactionAt: proposal.transactionAt, disclosureAt: proposal.disclosureAt,
        priorCall: !!input.priorCall, track: input.track, reason: input.reason, note: note || undefined, proposal, decidedBy: actor.name,
      },
    },
  });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.cancellation_recorded', entityType: 'Reservation', entityId: res._id, after: { channel: input.channel, track: input.track, proposedFee: proposal.proposedFee, needsReview: proposal.needsReview }, reason: reasonText, ip });
  const balance = round2((await Folio.find({ reservation: res._id }).select('lines').lean()).reduce((s, f) => s + folioBalance(f), 0));
  // Money is decided by a person (W07, G06): someone must own the fee/refund decision.
  if (proposal.needsReview || paid > 0.005 || Math.abs(balance) > 0.005) {
    await raiseWork({ propertyId, kind: 'finance', severity: 'action', title: `ביטול ${res.confirmationNumber}: החלטת דמי ביטול / החזר`, body: `שולם ${round2(paid)} · דמי ביטול מוצעים ${proposal.proposedFee ?? 'לבירור'} · ${proposal.needsReview ? 'טעון בירור' : ''}`, source: { type: 'reservation', id: String(res._id), label: res.confirmationNumber, link: `/pms/folio?reservation=${res._id}` }, dedupeKey: `cancel:${res._id}` });
  }
  return { reservationId: String(out._id), status: out.status, proposal, balance };
}
