import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import StaySegment from '../models/StaySegment.js';
import RoomBlock from '../models/RoomBlock.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import GuestProfile from '../models/GuestProfile.js';
import InventoryDate from '../models/InventoryDate.js';
import RoomSwapOperation from '../models/RoomSwapOperation.js';
import { loadProperty, businessDateOf, policyOf, IN_HOUSE_STATUSES } from './frontDeskService.js';
import { capacityIssue } from './stayChangeService.js';
import { getStayDates, nightlyAvailability, incrementInventory } from './availabilityService.js';
import { withLocks } from './locks.js';
import { runStayTransaction } from './stayTransaction.js';
import { audit } from './auditService.js';
import { payloadHash, validDate } from '../domain/accounting.js';

export const SWAP_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist'];
const LIVE = ['in_house', 'checked_in'];
const HOLDING = ['reserved', 'tentative', ...LIVE];
const RES_HOLDING = ['confirmed', 'modified', 'pending_payment', 'hold', ...IN_HOUSE_STATUSES];
const HK_OPEN = ['new', 'assigned', 'in_progress', 'paused', 'failed_inspection'];
const TICKET_OPEN = ['new', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor', 'reopened'];
const id = (v) => String(v?._id || v || '');
const hash = (v) => payloadHash(JSON.parse(JSON.stringify(v)));
const nextDay = (date) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const error = (message, code, status = 409, details) => Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
function authorize(propertyId, actor) {
  if (!mongoose.isValidObjectId(propertyId)) throw error('מזהה נכס לא תקין', 'invalid_property', 400);
  if (!actor?.id || !SWAP_ROLES.includes(actor.role)) throw error('החלפת חדרים מתבצעת בקבלה', 'swap_forbidden', 403);
  if (actor.propertyId && id(actor.propertyId) !== id(propertyId) && !['super_admin', 'chain_admin'].includes(actor.role)) throw error('הנכס אינו בתחום ההרשאה', 'swap_forbidden', 403);
}
function selection(input) {
  const parts = [input?.first, input?.second];
  if (parts.some((side) => !side || ['reservationId', 'unitId', 'roomId'].some((key) => !mongoose.isValidObjectId(side[key])))) throw error('יש לבחור שתי יחידות וחדרי מקור תקינים', 'invalid_swap_selection', 422);
  if (id(parts[0].unitId) === id(parts[1].unitId) || id(parts[0].roomId) === id(parts[1].roomId)) throw error('יש לבחור שתי יחידות בשני חדרים שונים', 'same_swap_unit', 422);
  return parts.map((s) => Object.fromEntries(['reservationId', 'unitId', 'roomId'].map((key) => [key, id(s[key])])));
}
async function loadSide(propertyId, ref, session) {
  const res = await Reservation.findOne({ _id: ref.reservationId, property: propertyId }).session(session);
  if (!res) throw error('ההזמנה לא נמצאה בנכס', 'swap_reservation_not_found', 404);
  const units = await ReservationRoom.find({ reservation: res._id, property: propertyId }).session(session).sort({ createdAt: 1, _id: 1 });
  const unit = units.find((u) => id(u) === ref.unitId);
  if (!unit) throw error('היחידה אינה שייכת להזמנה שנבחרה', 'swap_unit_not_found', 404);
  if (!IN_HOUSE_STATUSES.includes(res.status) || !LIVE.includes(unit.status)) throw error('החלפה אפשרית רק בין שתי יחידות שוהות', 'swap_not_in_house');
  if (id(unit.assignedRoom) !== ref.roomId) throw error('אחד מחדרי המקור השתנה — יש לבדוק את ההחלפה שוב', 'swap_source_changed');
  const room = await Room.findOne({ _id: ref.roomId, property: propertyId }).session(session).lean();
  if (!room) throw error('חדר המקור לא נמצא בנכס', 'swap_room_not_found', 404);
  const guest = await GuestProfile.findOne({ _id: res.primaryGuest, property: propertyId }).session(session).select('firstName lastName').lean();
  return { res, unit, units, room, guest };
}
function card(side) {
  return { reservationId: id(side.res), unitId: id(side.unit), roomId: id(side.room), roomNumber: side.room.number, floor: side.room.floor,
    guest: side.unit.occupantName || [side.guest?.firstName, side.guest?.lastName].filter(Boolean).join(' ') || 'אורח',
    confirmationNumber: side.res.confirmationNumber, departure: side.unit.departureDate, ratePerNight: side.unit.nightlyRate,
    currency: side.res.currency || 'ILS', accessible: !!side.room.isAccessible, smoking: !!side.room.isSmoking };
}
function groupedDeltas(legs, today) {
  const cells = new Map();
  for (const leg of legs) for (const date of getStayDates(today, leg.to)) for (const [type, delta] of [[leg.oldType, -1], [leg.newType, 1]]) {
    const key = `${type}:${date}`; cells.set(key, { roomTypeId: type, date, delta: (cells.get(key)?.delta || 0) + delta });
  }
  const ranges = [];
  for (const cell of [...cells.values()].filter((c) => c.delta).sort((a, b) => a.roomTypeId.localeCompare(b.roomTypeId) || a.date.localeCompare(b.date))) {
    const previous = ranges.at(-1);
    if (previous && previous.roomTypeId === cell.roomTypeId && previous.delta === cell.delta && previous.to === cell.date) previous.to = nextDay(cell.date);
    else ranges.push({ roomTypeId: cell.roomTypeId, from: cell.date, to: nextDay(cell.date), delta: cell.delta });
  }
  return ranges;
}
async function planSwap(propertyId, refs, session = null) {
  const property = await loadProperty(propertyId, session), today = businessDateOf(property), blockers = [];
  const sides = [];
  for (const ref of refs) sides.push(await loadSide(propertyId, ref, session));
  const add = (code, message, side) => blockers.push({ code, message, ...(side !== undefined ? { side } : {}) });
  const unitIds = sides.map((s) => s.unit._id), resIds = sides.map((s) => s.res._id);
  const types = await RoomType.find({ _id: { $in: sides.flatMap((s) => [s.room.roomType, s.unit.roomTypeBooked]) }, property: propertyId }).session(session).lean();
  const byType = new Map(types.map((t) => [id(t), t])), ready = policyOf(property).requireInspection ? ['inspected'] : ['clean', 'inspected'];
  const legs = [], segmentState = [];
  for (const [index, source] of sides.entries()) {
    const target = sides[1 - index], to = source.unit.departureDate;
    try { validDate(source.unit.arrivalDate); validDate(to); validDate(today); } catch { add('invalid_dates', 'יש לתקן את תאריכי השהייה לפני החלפה', index); continue; }
    if (source.unit.arrivalDate > today || to <= today) { add('no_nights_left', 'ההחלפה מחייבת שהייה פעילה עם לפחות לילה שנותר', index); continue; }
    if (getStayDates(today, to).length > 366) { add('swap_range_too_long', 'החלפה זו חורגת מ־366 לילות; נדרש טיפול פרטני', index); continue; }
    if (source.units.length < Math.max(1, source.res.roomsCount || 1)) add('incomplete_units', 'לא כל יחידות ההזמנה מתועדות — יש להשלים שיבוץ לפני החלפה', index);
    if (!['occupied', 'due_out'].includes(source.room.occStatus)) add('room_occupancy_mismatch', `חדר ${source.room.number} אינו מסומן כחדר שוהה`, index);
    if (target.room.active === false || target.room.opsStatus !== 'available') add('room_blocked', `חדר ${target.room.number} חסום תפעולית`, index);
    if (!ready.includes(target.room.cleanStatus)) add('room_not_ready', `חדר ${target.room.number} אינו מוכן לקבלת אורח אחר`, index);
    if (!byType.has(id(source.unit.roomTypeBooked))) add('invalid_room_type', 'סוג החדר הרשום ביחידה אינו שייך לנכס', index);
    const capacity = capacityIssue(source.res, source.unit, source.units, byType.get(id(target.room.roomType)));
    if (capacity) add('capacity', `${source.room.number} ← ${target.room.number}: ${capacity}`, index);
    const active = await StaySegment.find({ reservationRoom: source.unit._id, property: propertyId, toDate: { $gt: today } }).session(session).sort({ fromDate: 1, _id: 1 }).lean(); segmentState.push(active);
    if (!active.some((s) => s.fromDate <= today && today < s.toDate && id(s.room) === id(source.room))) add('segment_missing', 'אין מקטע שהייה תואם לחדר הנוכחי', index);
    if (active.some((s) => id(s.room) !== id(source.room))) add('future_room_change', 'כבר קיים מעבר חדר עתידי מתוכנן — יש לברר אותו לפני ההחלפה', index);
    const nightly = [];
    for (const date of getStayDates(today, to)) {
      if (active.filter((s) => s.fromDate <= date && date < s.toDate).length > 1) add('segment_overlap', 'קיימים מקטעי שהייה חופפים; נדרש תיקון לפני ההחלפה', index);
      const snapshot = source.res.priceSnapshot?.nightly?.find((n) => n.date === date);
      const segment = active.find((s) => s.fromDate <= date && date < s.toDate);
      const rate = Number(snapshot?.price ?? segment?.ratePerNight ?? source.unit.nightlyRate);
      if (!Number.isFinite(rate) || rate < 0) add('invalid_rate', 'מחיר הלילה הקיים אינו תקין', index);
      nightly.push({ date, rate, ratePlan: id(segment?.ratePlan || source.unit.ratePlan || source.res.ratePlan) || null });
    }
    const range = { arrivalDate: { $lt: to }, departureDate: { $gt: today } };
    if (await ReservationRoom.exists({ property: propertyId, _id: { $nin: unitIds }, assignedRoom: target.room._id, status: { $in: HOLDING }, ...range }).session(session)) add('third_party_conflict', `חדר ${target.room.number} משויך ליחידה אחרת בחלק מהלילות`, index);
    if (await Reservation.exists({ property: propertyId, _id: { $nin: resIds }, assignedRoom: target.room._id, status: { $in: RES_HOLDING }, ...range }).session(session)) add('third_party_conflict', `חדר ${target.room.number} מוחזק להזמנה אחרת`, index);
    const planned = await StaySegment.find({ property: propertyId, room: target.room._id, reservationRoom: { $nin: unitIds }, fromDate: { $lt: to }, toDate: { $gt: today } }).session(session).select('reservationRoom').lean();
    if (planned.length && await ReservationRoom.exists({ _id: { $in: planned.map((s) => s.reservationRoom) }, property: propertyId, status: { $in: HOLDING } }).session(session)) add('third_party_segment', `בחדר ${target.room.number} מתוכנן מקטע שהייה אחר`, index);
    if (await RoomBlock.exists({ property: propertyId, room: target.room._id, status: 'active', from: { $lt: to }, to: { $gt: today } }).session(session)) add('dated_room_block', `חדר ${target.room.number} חסום בחלק מהתאריכים`, index);
    if (await HousekeepingTask.exists({ property: propertyId, room: target.room._id, status: { $in: HK_OPEN }, date: { $lte: today } }).session(session)) add('open_housekeeping', `בחדר ${target.room.number} יש משימת משק בית פתוחה — יש להשלים אותה לפני החלפה`, index);
    if (await MaintenanceTicket.exists({ property: propertyId, room: target.room._id, status: { $in: TICKET_OPEN }, $or: [{ guestImpact: { $in: ['block', 'move'] } }, { blocksRoom: true }] }).session(session)) add('blocking_maintenance', `בחדר ${target.room.number} קיימת תקלה חוסמת`, index);
    legs.push({ index, to, oldType: id(source.unit.roomTypeBooked), newType: id(target.room.roomType), nightly });
  }
  const inventory = groupedDeltas(legs, today);
  for (const delta of inventory) {
    if (delta.delta > 0) {
      const available = await nightlyAvailability({ propertyId, roomTypeId: delta.roomTypeId, arrivalDate: delta.from, departureDate: delta.to, session });
      if (available.nights.some((n) => n.stopSell || n.available < delta.delta)) add('no_inventory', 'אין מלאי מתאים לסוג החדר בכל הלילות שנותרו');
    } else {
      const rows = await InventoryDate.find({ property: propertyId, roomType: delta.roomTypeId, date: { $gte: delta.from, $lt: delta.to } }).session(session).select('bookedCount').lean();
      if (rows.some((r) => Number(r.bookedCount || 0) < -delta.delta)) add('inventory_counter_mismatch', 'רישום המלאי הקיים אינו תואם לשהייה; יש לברר לפני ההחלפה');
    }
  }
  const previewHash = hash({ propertyId, today, policy: policyOf(property), sides: sides.map((s) => ({ res: s.res.toObject(), unit: s.unit.toObject(), units: s.units.map((u) => u.toObject()), room: s.room })), types, segmentState, inventory });
  return { sides, legs, inventory, plan: { businessDate: today, first: card(sides[0]), second: card(sides[1]), ready: blockers.length === 0, blockers, previewHash, inventory, priceMode: 'keep', note: 'המחירים, הארוחות והחשבונות נשארים עם כל אורח. שתי היחידות מחליפות חדרים להמשך שהייתן.', keys: { status: 'not_connected', message: 'יש להנפיק מפתחות חדשים ולבטל את הישנים לשני החדרים בנפרד' } } };
}

export async function previewRoomSwap({ propertyId, input, actor }) {
  authorize(propertyId, actor); const refs = selection(input);
  const session = await mongoose.startSession();
  try { return await session.withTransaction(async () => (await planSwap(propertyId, refs, session)).plan, { readConcern: { level: 'snapshot' } }); }
  finally { await session.endSession(); }
}

export async function swapRooms({ propertyId, input, actor, ip }) {
  authorize(propertyId, actor); const refs = selection(input);
  const requestKey = String(input.requestKey || '').trim(), reason = String(input.reason || '').trim().slice(0, 300);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestKey) || !/^[a-f0-9]{64}$/.test(input.previewHash || '') || reason.length < 3 || input.guestConsentConfirmed !== true || input.turnoverConfirmed !== true) throw error('נדרשים תצוגה מקדימה, סיבה, תיאום עם שני האורחים ואישור מוכנות החדרים', 'swap_confirmation_required', 422);
  if ((input.priceMode && input.priceMode !== 'keep') || input.rate !== undefined || input.manualRate !== undefined) throw error('החלפה שומרת על המחיר המוסכם של כל אורח', 'swap_keep_price_only', 422);
  const requestHash = hash({ refs, reason, previewHash: input.previewHash, guestConsentConfirmed: true, turnoverConfirmed: true });
  // The committed receipt survives later moves/check-out. Read it before validating the old rooms.
  const receipt = await RoomSwapOperation.findOne({ property: propertyId, requestKey }).lean();
  if (receipt) {
    if (receipt.payloadHash !== requestHash) throw error('מזהה הפעולה כבר שימש להחלפה עם פרטים אחרים', 'swap_request_conflict');
    return { ...receipt.result, duplicate: true };
  }
  // Only collect lock keys here. Source-state validation follows the receipt check under lock:
  // another identical request may have committed between the early receipt read and these reads.
  const initialUnits = await ReservationRoom.find({ property: propertyId, _id: { $in: refs.map((r) => r.unitId) } }).select('roomTypeBooked').lean();
  const initialRooms = await Room.find({ property: propertyId, _id: { $in: refs.map((r) => r.roomId) } }).select('roomType').lean();
  const typeIds = [...new Set([...initialUnits.map((u) => id(u.roomTypeBooked)), ...initialRooms.map((r) => id(r.roomType))])];
  const keys = [`swap:${propertyId}:${requestKey}`, `dayclose:${propertyId}`, ...refs.map((r) => `res:${r.reservationId}`), ...refs.map((r) => `room:${r.roomId}`), ...typeIds.map((t) => `inv:${propertyId}:${t}`)];
  return withLocks(keys, (lease) => runStayTransaction(async (session, afterCommit) => {
    const previous = await RoomSwapOperation.findOne({ property: propertyId, requestKey }).session(session).lean();
    if (previous) {
      if (previous.payloadHash !== requestHash) throw error('מזהה הפעולה כבר שימש להחלפה עם פרטים אחרים', 'swap_request_conflict');
      return { ...previous.result, duplicate: true };
    }
    const { sides, legs, inventory, plan } = await planSwap(propertyId, refs, session);
    if (!plan.ready) throw error(plan.blockers[0].message, 'swap_blocked', 409, plan.blockers);
    if (plan.previewHash !== input.previewHash || legs.some((l) => !typeIds.includes(l.oldType) || !typeIds.includes(l.newType))) throw error('פרטי ההחלפה השתנו — יש לבדוק שוב את התצוגה', 'swap_preview_stale');
    const newSegments = [];
    for (const leg of legs) {
      const source = sides[leg.index], target = sides[1 - leg.index];
      const segments = await StaySegment.find({ reservationRoom: source.unit._id, property: propertyId, toDate: { $gt: plan.businessDate } }).session(session);
      for (const segment of segments) {
        if (segment.fromDate < plan.businessDate) { segment.toDate = plan.businessDate; await segment.save({ session }); }
        else await StaySegment.deleteOne({ _id: segment._id }, { session });
      }
      for (const night of leg.nightly) {
        const previousSegment = newSegments.at(-1);
        if (previousSegment && id(previousSegment.reservationRoom) === id(source.unit) && previousSegment.toDate === night.date && previousSegment.ratePerNight === night.rate && id(previousSegment.ratePlan) === id(night.ratePlan)) previousSegment.toDate = nextDay(night.date);
        else newSegments.push({ property: propertyId, reservation: source.res._id, reservationRoom: source.unit._id, room: target.room._id, roomType: target.room.roomType, fromDate: night.date, toDate: nextDay(night.date), ratePerNight: night.rate, ratePlan: night.ratePlan || undefined, changeReason: `החלפה בין חדרים: ${reason}`, createdBy: actor.id, createdByName: actor.name });
      }
      source.unit.assignedRoom = target.room._id; source.unit.roomTypeBooked = target.room.roomType;
      await source.unit.save({ session });
    }
    await StaySegment.insertMany(newSegments, { session });
    for (const resId of [...new Set(sides.map((s) => id(s.res)))]) {
      const source = sides.find((s) => id(s.res) === resId), originalRoom = id(source.res.assignedRoom);
      const selectedIndex = sides.findIndex((s) => id(s.res) === resId && id(s.room) === originalRoom);
      const set = { lastChange: { at: new Date(), by: actor.name, reason, kind: 'room_swap' }, updatedBy: actor.id };
      if (selectedIndex >= 0) set.assignedRoom = sides[1 - selectedIndex].room._id;
      await Reservation.updateOne({ _id: resId, property: propertyId }, { $set: set }, { session });
    }
    await Room.updateMany({ _id: { $in: sides.map((s) => s.room._id) }, property: propertyId }, { $set: { occStatus: 'occupied' } }, { session });
    for (const delta of inventory) await incrementInventory(propertyId, delta.roomTypeId, delta.from, delta.to, delta.delta, { propertyId, actorId: actor.id, actorName: actor.name, action: 'inventory.room_swap', reason, ip }, { session, afterCommit });
    const result = { businessDate: plan.businessDate, first: { reservationId: id(sides[0].res), unitId: id(sides[0].unit), from: sides[0].room.number, to: sides[1].room.number }, second: { reservationId: id(sides[1].res), unitId: id(sides[1].unit), from: sides[1].room.number, to: sides[0].room.number }, priceMode: 'keep', keys: plan.keys };
    await RoomSwapOperation.create([{ property: propertyId, requestKey, payloadHash: requestHash, result }], { session });
    for (const side of sides) await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'stay.rooms_swapped', entityType: 'Reservation', entityId: side.res._id, before: { room: side.room.number, unitId: id(side.unit) }, after: { operationKey: requestKey, ...result, guestConsentConfirmed: true, turnoverConfirmed: true }, reason, ip, session, afterCommit });
    return result;
  }, lease, { operation: 'החלפת חדרים בין אורחים' }), { waitMs: 4000 });
}

export async function roomSwapOptions({ propertyId, reservationId, q = '', actor }) {
  authorize(propertyId, actor);
  if (!mongoose.isValidObjectId(reservationId)) throw error('יש לבחור שהייה', 'invalid_swap_selection', 422);
  if (!await Reservation.exists({ _id: reservationId, property: propertyId, status: { $in: IN_HOUSE_STATUSES } })) throw error('השהייה לא נמצאה בנכס', 'swap_reservation_not_found', 404);
  const today = businessDateOf(await loadProperty(propertyId)), query = { property: propertyId, status: { $in: LIVE }, assignedRoom: { $ne: null }, arrivalDate: { $lte: today }, departureDate: { $gt: today } };
  const text = String(q).trim().slice(0, 80);
  if (text) {
    const rx = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const rooms = await Room.find({ property: propertyId, number: rx }).select('_id').limit(201).lean();
    const guests = await GuestProfile.find({ property: propertyId, $or: [{ firstName: rx }, { lastName: rx }] }).select('_id').limit(201).lean();
    const stays = await Reservation.find({ property: propertyId, $or: [{ confirmationNumber: rx }, { primaryGuest: { $in: guests.map((g) => g._id) } }] }).select('_id').limit(201).lean();
    query.$or = [{ assignedRoom: { $in: rooms.map((r) => r._id) } }, { reservation: { $in: stays.map((r) => r._id) } }, { occupantName: rx }];
  }
  const decorate = async (rows) => {
    const output = [];
    for (const unit of rows) {
      const res = unit.reservation, room = unit.assignedRoom;
      if (!res || id(res.property) !== propertyId || !IN_HOUSE_STATUSES.includes(res.status) || !room || id(room.property) !== propertyId) continue;
      output.push({ reservationId: id(res), unitId: id(unit), roomId: id(room), roomNumber: room.number, guest: unit.occupantName || [res.primaryGuest?.firstName, res.primaryGuest?.lastName].filter(Boolean).join(' ') || 'אורח', confirmationNumber: res.confirmationNumber, departure: unit.departureDate });
    }
    return output;
  };
  const populate = (query) => query.populate({ path: 'reservation', select: 'property status confirmationNumber primaryGuest', populate: { path: 'primaryGuest', match: { property: propertyId }, select: 'firstName lastName' } }).populate('assignedRoom', 'property number').lean();
  const { $or: _search, ...sourceQuery } = query;
  const source = await populate(ReservationRoom.find({ ...sourceQuery, reservation: reservationId }).sort({ createdAt: 1, _id: 1 }).limit(201));
  const candidates = await populate(ReservationRoom.find(query).sort({ _id: 1 }).limit(101));
  return { businessDate: today, source: await decorate(source.slice(0, 200)), candidates: await decorate(candidates.slice(0, 100)), sourceTruncated: source.length > 200, hasMore: candidates.length > 100 };
}
