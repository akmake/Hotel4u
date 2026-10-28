// Requests never reserve future inventory. Stock tracks physical items until explicit return.
import mongoose from 'mongoose';
import CribRequest from '../models/CribRequest.js';
import CribStock from '../models/CribStock.js';
import CribOperation from '../models/CribOperation.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import RoomBlock from '../models/RoomBlock.js';
import { cribFacts, CRIB_ACTIVE_RES as ACTIVE_RES, CRIB_ACTIVE_UNIT as ACTIVE_UNIT } from './cribPresentation.js';
import { loadProperty, businessDateOf, IN_HOUSE_STATUSES } from './frontDeskService.js';
import { withLocks } from './locks.js';
import { runStayTransaction } from './stayTransaction.js';
import { payloadHash } from '../domain/accounting.js';
import { audit } from './auditService.js';

export const CRIB_FRONT = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist'];
export const CRIB_MANAGERS = CRIB_FRONT.filter((r) => r !== 'receptionist').concat('housekeeping_manager');
export const CRIB_WORK = [...CRIB_FRONT, 'housekeeping_manager', 'housekeeper'];
const id = (v) => String(v?._id || v || '');
const fail = (message, code, status = 409) => Object.assign(new Error(message), { code, status });
const isCount = (v, max = 100, min = 0) => Number.isInteger(v) && v >= min && v <= max;
function authorize(propertyId, actor, roles) {
  if (!mongoose.isValidObjectId(propertyId)) throw fail('יש לבחור נכס תקין', 'invalid_property', 400);
  if (!actor?.id || !roles.includes(actor.role)) throw fail('אין הרשאה לפעולת לולים זו', 'crib_forbidden', 403);
  if (actor.propertyId && id(actor.propertyId) !== id(propertyId) && !['super_admin', 'chain_admin'].includes(actor.role)) throw fail('הנכס אינו בתחום ההרשאה', 'crib_forbidden', 403);
}
async function target(propertyId, reservationId, unitId, session) {
  if (![reservationId, unitId].every((v) => mongoose.isValidObjectId(v))) throw fail('יש לבחור יחידה מתועדת בהזמנה', 'invalid_crib_unit', 422);
  const reservation = await Reservation.findOne({ property: propertyId, _id: reservationId }).session(session).lean();
  const unit = await ReservationRoom.findOne({ property: propertyId, reservation: reservationId, _id: unitId }).session(session).lean();
  if (!reservation || !unit) throw fail('יחידת השהייה לא נמצאה בנכס', 'crib_unit_not_found', 404);
  const room = unit.assignedRoom ? await Room.findOne({ property: propertyId, _id: unit.assignedRoom }).session(session).select('number opsStatus active roomType').lean() : null;
  return { reservation, unit, room };
}
async function stockSummary(propertyId, session) {
  const stock = await CribStock.findOne({ property: propertyId }).session(session).lean();
  const totals = await CribRequest.aggregate([{ $match: { property: new mongoose.Types.ObjectId(propertyId) } }, { $group: { _id: null, outstanding: { $sum: '$outstandingQty' } } }]).session(session);
  const used = totals[0]?.outstanding || 0;
  return { configured: !!stock, revision: stock?.revision || 0, total: stock?.totalCount ?? null, outstanding: used, availableNow: stock ? Math.max(0, stock.totalCount - used) : null, mode: 'physical_now_only' };
}
async function context(propertyId, reservationId, unitId, session, inventory = null) {
  const { reservation, unit, room } = await target(propertyId, reservationId, unitId, session);
  const record = await CribRequest.findOne({ property: propertyId, reservationRoom: unitId }).session(session).lean();
  const deliveryRoom = record?.deliveryRoom ? await Room.findOne({ property: propertyId, _id: record.deliveryRoom }).session(session).select('number').lean() : null;
  const guest = unit.occupantName || [reservation.confirmationNumber, 'יחידה'].join(' · ');
  const active = ACTIVE_RES.includes(reservation.status) && ACTIVE_UNIT.includes(unit.status);
  const property = await loadProperty(propertyId, session);
  return { reservationId, unitId, guest, confirmationNumber: reservation.confirmationNumber, room: room ? { id: id(room), number: room.number } : null,
    deliveryRoom: deliveryRoom ? { id: id(deliveryRoom), number: deliveryRoom.number } : null, arrival: unit.arrivalDate, departure: unit.departureDate, businessDate: businessDateOf(property),
    active, revision: record?.revision || 0, cribs: cribFacts(record, unit, reservation), stock: inventory || await stockSummary(propertyId, session), note: 'בקשה אינה שומרת מלאי עתידי. נמסר = מסירה פיזית שאושרה בידי עובד. אין חיוב אוטומטי.' };
}
async function snapshot(work) { const session = await mongoose.startSession(); try { return await session.withTransaction(() => work(session), { readConcern: { level: 'snapshot' } }); } finally { await session.endSession(); } }
export async function getCribContext({ propertyId, reservationId, unitId, actor }) {
  authorize(propertyId, actor, CRIB_WORK); return snapshot((session) => context(propertyId, reservationId, unitId, session));
}
function operationInput(input) {
  const requestKey = String(input.requestKey || ''), reason = String(input.reason || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestKey) || reason.length < 3 || reason.length > 300 || !isCount(input.expectedRevision, Number.MAX_SAFE_INTEGER)) throw fail('נדרשים מזהה פעולה, גרסה עדכנית וסיבה של 3–300 תווים', 'invalid_crib_operation', 422);
  if (['price', 'fee', 'charge'].some((k) => input[k] !== undefined)) throw fail('פעולת לולים אינה רושמת חיוב', 'crib_no_pricing', 422);
  return { requestKey, reason };
}
async function once({ propertyId, requestKey, hash, keys, actor, reason, ip, work }) {
  return withLocks([`crib:${propertyId}`, ...keys], (lease) => runStayTransaction(async (session, afterCommit) => {
    const receipt = await CribOperation.findOne({ property: propertyId, requestKey }).session(session).lean();
    if (receipt) { if (receipt.payloadHash !== hash) throw fail('מזהה הפעולה כבר שימש עם פרטים אחרים', 'crib_request_conflict'); return { ...receipt.result, duplicate: true }; }
    const { result, before, action, entityId } = await work(session);
    await CribOperation.create([{ property: propertyId, requestKey, payloadHash: hash, result }], { session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `crib.${action}`, entityType: 'CribRequest', entityId, before, after: result, reason, ip, session, afterCommit });
    return result;
  }, lease, { operation: 'עדכון לולים' }), { waitMs: 4000 });
}
export async function setCribStock({ propertyId, actor, input, ip }) {
  authorize(propertyId, actor, CRIB_MANAGERS); const { requestKey, reason } = operationInput(input);
  if (!isCount(input.totalCount, 10000) || input.physicalCountConfirmed !== true) throw fail('נדרשת כמות לולים שלמה לאחר ספירה פיזית', 'crib_stock_confirmation', 422);
  const hash = payloadHash({ action: 'stock', totalCount: input.totalCount, revision: input.expectedRevision, reason });
  return once({ propertyId, requestKey, hash, keys: [], actor, reason, ip, work: async (session) => {
    await loadProperty(propertyId, session); const before = await stockSummary(propertyId, session);
    if (before.revision !== input.expectedRevision) throw fail('המלאי השתנה — טענו מחדש', 'crib_stale');
    if (input.totalCount < before.outstanding) throw fail('הכמות קטנה ממספר הלולים שעדיין בחדרים — יש לאסוף או לברר לפני שינוי', 'crib_stock_in_use');
    const stock = await CribStock.findOne({ property: propertyId }).session(session) || new CribStock({ property: propertyId, revision: 0 });
    stock.totalCount = input.totalCount; stock.revision += 1; stock.updatedBy = actor.id; await stock.save({ session });
    return { result: { stock: await stockSummary(propertyId, session) }, before, action: 'stock_counted', entityId: stock._id };
  } });
}
export async function changeCribs({ propertyId, reservationId, unitId, actor, input, ip }) {
  const action = input.action;
  authorize(propertyId, actor, action === 'request' ? CRIB_FRONT : CRIB_WORK);
  const { requestKey, reason } = operationInput(input);
  if (!['request', 'deliver', 'collect'].includes(action) || !isCount(input.quantity, 100, action === 'request' ? 0 : 1)) throw fail('פעולה או כמות לולים לא תקינה', 'invalid_crib_quantity', 422);
  if (![reservationId, unitId].every((v) => mongoose.isValidObjectId(v))) throw fail('יש לבחור יחידה מתועדת', 'invalid_crib_unit', 422);
  if (action !== 'request' && (!mongoose.isValidObjectId(input.roomId) || input.physicalConfirmed !== true)) throw fail('יש לאשר מסירה או החזרה פיזית ואת החדר', 'crib_physical_confirmation', 422);
  const hash = payloadHash({ action, reservationId, unitId, quantity: input.quantity, roomId: action === 'request' ? null : input.roomId, revision: input.expectedRevision, reason });
  return once({ propertyId, requestKey, hash, keys: [`res:${reservationId}`, ...(action === 'request' ? [] : [`room:${input.roomId}`])], actor, reason, ip, work: async (session) => {
    const { reservation, unit, room } = await target(propertyId, reservationId, unitId, session);
    const record = await CribRequest.findOne({ property: propertyId, reservationRoom: unitId }).session(session) || new CribRequest({ property: propertyId, reservation: reservationId, reservationRoom: unitId, revision: 0 });
    if (record.revision !== input.expectedRevision) throw fail('בקשת הלולים השתנתה — טענו מחדש לפני פעולה נוספת', 'crib_stale');
    const before = record.toObject();
    if (action !== 'collect' && (!ACTIVE_RES.includes(reservation.status) || !ACTIVE_UNIT.includes(unit.status))) throw fail('השהייה אינה פעילה; אפשר עדיין לתעד החזרה של לול שנמסר', 'crib_stay_closed');
    if (action === 'request') record.requestedQty = input.quantity;
    if (action === 'deliver') {
      const today = businessDateOf(await loadProperty(propertyId, session));
      if (unit.arrivalDate > today || unit.departureDate <= today) throw fail('מסירה מתועדת רק ביום הגעה או במהלך שהייה עם לילה שנותר', 'crib_not_due');
      if (!room || id(room) !== id(input.roomId)) throw fail('חדר היחידה השתנה — בדקו שוב לאן למסור', 'crib_room_changed');
      if (room.active === false || room.opsStatus !== 'available') throw fail('החדר חסום למסירה', 'crib_room_blocked');
      if (await RoomBlock.exists({ property: propertyId, room: room._id, status: 'active', from: { $lte: today }, to: { $gt: today } }).session(session)) throw fail('החדר חסום בתאריך המסירה', 'crib_room_blocked');
      const type = await RoomType.findOne({ _id: room.roomType, property: propertyId }).session(session).lean();
      if (!type || type.active === false || type.cribAllowed === false) throw fail('סוג החדר אינו מאפשר לול', 'crib_not_allowed');
      if (record.outstandingQty && id(record.deliveryRoom) !== id(room)) throw fail('נותרו לולים בחדר הקודם — יש לאסוף אותם לפני מסירה בחדר החדש', 'crib_previous_room');
      if (input.quantity > record.requestedQty - record.outstandingQty) throw fail('המסירה חורגת מהכמות שהתבקשה ועדיין חסרה', 'crib_above_request');
      if (await ReservationRoom.exists({ property: propertyId, assignedRoom: room._id, _id: { $ne: unit._id }, status: { $in: ['in_house', 'checked_in'] } }).session(session)
        || await Reservation.exists({ property: propertyId, assignedRoom: room._id, _id: { $ne: reservation._id }, status: { $in: IN_HOUSE_STATUSES } }).session(session)) throw fail('בחדר עדיין שוהה אורח אחר — יש לברר לפני מסירה', 'crib_other_occupant');
      const stock = await stockSummary(propertyId, session);
      if (!stock.configured) throw fail('טרם הוזן מלאי לולים לאחר ספירה פיזית', 'crib_stock_unknown');
      if (stock.availableNow < input.quantity) throw fail('אין מספיק לולים זמינים כעת; הבקשה נשארת בהמתנה', 'crib_no_stock');
      record.outstandingQty += input.quantity; record.deliveryRoom = room._id;
    }
    if (action === 'collect') {
      if (!record.outstandingQty || input.quantity > record.outstandingQty) throw fail('אין בחדר כמות כזו של לולים שטרם הוחזרו', 'crib_above_outstanding');
      if (id(record.deliveryRoom) !== id(input.roomId)) throw fail('ההחזרה חייבת להתייחס לחדר שבו הלולים נמסרו', 'crib_return_room');
      record.outstandingQty -= input.quantity; if (!record.outstandingQty) record.deliveryRoom = null;
    }
    record.revision += 1; record.updatedBy = actor.id; await record.save({ session });
    return { result: await context(propertyId, reservationId, unitId, session), before, action, entityId: record._id };
  } });
}
export async function cribDesk({ propertyId, q = '', actor }) {
  authorize(propertyId, actor, CRIB_WORK);
  return snapshot(async (session) => {
    const activeReservations = await Reservation.distinct('_id', { property: propertyId, status: { $in: ACTIVE_RES } }).session(session);
    const activeUnits = await ReservationRoom.distinct('_id', { property: propertyId, reservation: { $in: activeReservations }, status: { $in: ACTIVE_UNIT } }).session(session);
    const query = { property: propertyId, $or: [{ outstandingQty: { $gt: 0 } }, { reservationRoom: { $in: activeUnits }, $expr: { $gt: ['$requestedQty', '$outstandingQty'] } }] };
    const term = String(q).trim().slice(0, 80);
    if (term) {
      const rx = new RegExp(term.split('').map((c) => /[a-zA-Z0-9א-ת\s]/.test(c) ? c : `\\${c}`).join(''), 'i');
      const rooms = await Room.distinct('_id', { property: propertyId, number: rx }).session(session);
      const units = await ReservationRoom.distinct('_id', { property: propertyId, $or: [{ assignedRoom: { $in: rooms } }, { occupantName: rx }] }).session(session);
      const reservations = await Reservation.distinct('_id', { property: propertyId, confirmationNumber: rx }).session(session);
      query.$and = [{ $or: [{ deliveryRoom: { $in: rooms } }, { reservationRoom: { $in: units } }, { reservation: { $in: reservations } }] }];
    }
    const records = await CribRequest.find(query).session(session).sort({ outstandingQty: -1, updatedAt: 1, _id: 1 }).limit(201).lean();
    const rows = [], inventory = await stockSummary(propertyId, session);
    for (const record of records.slice(0, 200)) {
      try { const row = await context(propertyId, id(record.reservation), id(record.reservationRoom), session, inventory); rows.push(row); }
      catch (err) { if (err.status !== 404) throw err; rows.push({ orphaned: true, requestId: id(record), outstanding: record.outstandingQty, message: 'רישום ללא יחידת מקור תקינה — נדרש בירור; הכמות נשארת תפוסה' }); }
    }
    return { stock: inventory, rows, hasMore: records.length > 200, limit: 200 };
  });
}
