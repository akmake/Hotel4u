// Isolated failure/concurrency evidence: cancellation, no-show and extension.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import Room from '../models/Room.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import InventoryDate from '../models/InventoryDate.js';
import Folio from '../models/Folio.js';
import AuditLog from '../models/AuditLog.js';
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import WorkItem from '../models/WorkItem.js';
import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';
import OperationLock from '../models/OperationLock.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { businessDateOf } from '../services/frontDeskService.js';
import { createBooking } from '../services/bookingService.js';
import { cancelWithNotice, extendStay } from '../services/stayChangeService.js';
import { cancelReservation, markNoShow } from '../services/reservationService.js';

const startedAt = new Date().toISOString(), results = [];
const actor = { id: String(new mongoose.Types.ObjectId()), role: 'property_admin', name: 'Synthetic QA' };
const id = (v) => String(v?._id || v);
const plus = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const outcome = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: { message: e.message, status: e.status, code: e.code } }; } };
async function fixture({ inHouse = false, board = false, future = false, roomsCount = 1 } = {}) {
  const p = await Property.create({ name: 'Synthetic closure QA', reservationPrefix: randomUUID().slice(0, 8), timezone: 'Asia/Jerusalem', vatRate: 18, boardPricing: { supplements: [{ board: 'half_board', adult: 100, child: 50, active: true }] } });
  const propertyId = id(p), today = businessDateOf(p), arrival = plus(today, future ? 2 : 0), departure = plus(arrival, 2);
  const type = await RoomType.create({ property: propertyId, code: 'STD', name: 'Synthetic standard', baseRate: 500, capacityMax: 4, adultsMax: 4 });
  const rooms = [];
  for (let i = 0; i < 2; i++) rooms.push(await Room.create({ property: propertyId, roomType: type._id, number: String(101 + i), floor: 1, cleanStatus: 'clean' }));
  const plan = await RatePlan.create({ property: propertyId, code: 'BAR', name: 'Synthetic rate' });
  const dates = Array.from({ length: 10 }, (_, i) => plus(today, i));
  await InventoryDate.insertMany(dates.map((date) => ({ property: propertyId, roomType: type._id, date, physicalCount: 2 })));
  await RateDate.insertMany(dates.map((date) => ({ ratePlan: plan._id, roomType: type._id, date, price: 500 })));
  const guest = await GuestProfile.create({ property: propertyId, firstName: 'Synthetic', lastName: 'Guest' });
  const booking = await createBooking({ propertyId, actor, input: { arrival, departure, adults: 2, children: 0, rooms: roomsCount, roomTypeId: id(type), ratePlanId: id(plan), guestId: id(guest), mode: 'confirm', idempotencyKey: randomUUID(), ...(board ? { board: 'half_board' } : {}) } });
  const resId = booking.id, units = await ReservationRoom.find({ reservation: resId }).sort({ _id: 1 });
  await Reservation.updateOne({ _id: resId }, { $set: { assignedRoom: rooms[0]._id, ...(inHouse ? { status: 'in_house', checkedInAt: new Date() } : {}) } });
  for (const [i, unit] of units.entries()) {
    unit.assignedRoom = rooms[i]._id; if (inHouse) unit.status = 'in_house'; await unit.save();
    await StaySegment.updateMany({ reservationRoom: unit._id }, { $set: { room: rooms[i]._id } });
    if (inHouse) await Room.updateOne({ _id: rooms[i]._id }, { $set: { occStatus: 'occupied' } });
  }
  return { propertyId, today, arrival, departure, type, plan, rooms, units, resId };
}
async function state(f) {
  const collections = [Reservation, ReservationRoom, StaySegment, InventoryDate, Room, Folio, ArrivalQueueEntry, WorkItem, ChannelUpdateQueue, AuditLog];
  const value = {};
  for (const Model of collections) value[Model.modelName] = (await Model.find({ property: f.propertyId }).sort({ _id: 1 }).lean()).map(({ createdAt, updatedAt, __v, ...doc }) => doc);
  return JSON.parse(JSON.stringify(value));
}
const cancel = (f) => cancelReservation({ reservationId: f.resId, reason: 'Synthetic cancellation', actorId: actor.id, actorName: actor.name });
const noShow = (f) => markNoShow({ reservationId: f.resId, actorId: actor.id, actorName: actor.name });
const notice = (f) => cancelWithNotice({ propertyId: f.propertyId, reservationId: f.resId, actor, input: { channel: 'desk', track: 'review', reason: 'regret' } });
const extend = (f) => extendStay({ propertyId: f.propertyId, reservationId: f.resId, actor, input: { newDeparture: plus(f.departure, 1), paymentArrangement: 'Synthetic guarantee', guestConfirmation: 'Synthetic consent' } });
async function check(code, name, fn) {
  const evidence = {};
  try { await fn(evidence); results.push({ code, name, status: 'passed', evidence }); console.log(`PASS ${code} ${name}`); }
  catch (e) { results.push({ code, name, status: 'failed', failure: e.message, evidence }); console.log(`FAIL ${code} ${name}: ${e.message.split('\n')[0]}`); }
}
async function rollback(e, f, Model, method, fn, shouldInject = () => true) {
  e.before = await state(f); const original = Model[method];
  Model[method] = function (...args) { if (shouldInject(...args)) throw new Error('QA_INJECTED_FAILURE'); return original.apply(this, args); };
  try { e.response = await outcome(fn); } finally { Model[method] = original; }
  e.after = await state(f); assert.equal(e.response.ok, false); assert.equal(e.response.error?.message, 'QA_INJECTED_FAILURE'); assert.deepEqual(e.after, e.before);
}
let replica;
try {
  replica = await createAccountingTestReplica(); await mongoose.connect(replica.getUri(`closure_qa_${Date.now()}`));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await check('CX01', 'cancellation stock failure restores reservation units and queue', async (e) => {
    const f = await fixture();
    await ArrivalQueueEntry.create({ property: f.propertyId, reservation: f.resId, reservationRoom: f.units[0]._id, owner: actor.id, arrivedAt: new Date(), reason: 'cleaning' });
    await rollback(e, f, InventoryDate, 'updateMany', () => cancel(f), (_, update) => update?.$inc?.bookedCount < 0);
  });
  await check('CX02', 'failed cancellation notice audit restores notice stock and status', async (e) => {
    const f = await fixture(); await rollback(e, f, AuditLog, 'create', () => notice(f), (entry) => (Array.isArray(entry) ? entry[0] : entry)?.action === 'reservation.cancellation_recorded');
  });
  await check('CX03', 'failed finance follow-up cannot leave a cancelled booking without its work item', async (e) => {
    const f = await fixture(); await rollback(e, f, WorkItem, 'create', () => notice(f));
  });
  await check('CX04', 'concurrent cancellations release inventory once', async (e) => {
    const f = await fixture(); e.responses = await Promise.all([1, 2].map(() => outcome(() => cancel(f)))); e.after = await state(f);
    assert.equal(e.responses.filter((r) => r.ok).length, 1); assert.ok(e.after.InventoryDate.every((n) => n.bookedCount === 0));
  });
  await check('CX05', 'cancelling a future assignment cannot vacate an occupied physical room', async (e) => {
    const f = await fixture({ future: true }); await Room.updateOne({ _id: f.rooms[0]._id }, { $set: { occStatus: 'occupied' } });
    e.response = await outcome(() => cancel(f)); assert.equal(e.response.ok, true); assert.equal((await Room.findById(f.rooms[0]._id)).occStatus, 'occupied');
  });
  await check('NS01', 'no-show stock failure restores all booking state', async (e) => { const f = await fixture(); await rollback(e, f, InventoryDate, 'updateMany', () => noShow(f), (_, u) => u?.$inc?.bookedCount < 0); });
  await check('NS02', 'no-show racing cancellation cannot release the same nights twice', async (e) => {
    const f = await fixture(); e.responses = await Promise.all([outcome(() => noShow(f)), outcome(() => cancel(f))]); e.after = await state(f);
    assert.equal(e.responses.filter((r) => r.ok).length, 1); assert.ok(e.after.InventoryDate.every((n) => n.bookedCount === 0));
  });
  await check('NS03', 'legacy no-show cannot bypass the future-arrival guard', async (e) => {
    const f = await fixture({ future: true }); e.before = await state(f); e.response = await outcome(() => noShow(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('NS04', 'legacy no-show cannot silently close a multi-room booking', async (e) => {
    const f = await fixture({ roomsCount: 2 }); e.before = await state(f); e.response = await outcome(() => noShow(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('NS05', 'failed no-show audit rolls back state and stock', async (e) => { const f = await fixture(); await rollback(e, f, AuditLog, 'create', () => noShow(f), (entry) => (Array.isArray(entry) ? entry[0] : entry)?.action === 'reservation.no_show'); });
  await check('EX01', 'extension stock failure restores old departure units and segments', async (e) => { const f = await fixture({ inHouse: true }); await rollback(e, f, InventoryDate, 'updateMany', () => extend(f), (_, u) => u?.$inc?.bookedCount > 0); });
  await check('EX02', 'extension unit-save failure leaves no extended segment', async (e) => { const f = await fixture({ inHouse: true }); await rollback(e, f, ReservationRoom.prototype, 'save', () => extend(f)); });
  await check('EX03', 'extension audit failure restores booking and stock', async (e) => { const f = await fixture({ inHouse: true }); await rollback(e, f, AuditLog, 'create', () => extend(f), (entry) => (Array.isArray(entry) ? entry[0] : entry)?.action === 'stay.extended'); });
  await check('EX04', 'half-board extension keeps meal price and total snapshot and tax consistent', async (e) => {
    const f = await fixture({ inHouse: true, board: true }); e.response = await outcome(() => extend(f)); const r = await Reservation.findById(f.resId).lean(); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.response.value.added, 700); assert.equal(r.totalAmount, 2100); assert.equal(r.priceSnapshot.total, 2100); assert.equal(r.priceSnapshot.board.nightly.length, 3); assert.equal(r.taxAmount, Math.round((2100 - 2100 / 1.18) * 100) / 100);
  });
  await check('EX05', 'two identical concurrent extensions charge and allocate only once', async (e) => {
    const f = await fixture({ inHouse: true }); e.responses = await Promise.all([1, 2].map(() => outcome(() => extend(f)))); e.after = await state(f);
    assert.equal(e.responses.filter((r) => r.ok).length, 1); assert.equal(e.after.Reservation[0].totalAmount, 1500); assert.equal(e.after.InventoryDate.find((n) => n.date === f.departure).bookedCount, 1);
  });
  await check('EX06', 'extension refuses an in-house unit with no assigned physical room', async (e) => {
    const f = await fixture({ inHouse: true }); await ReservationRoom.updateMany({ reservation: f.resId }, { $set: { assignedRoom: null } }); e.before = await state(f); e.response = await outcome(() => extend(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('EX07', 'new extension segment keeps old nights and records the new night rate', async (e) => {
    const f = await fixture({ inHouse: true }); await RateDate.updateOne({ ratePlan: f.plan._id, date: f.departure }, { $set: { price: 800 } });
    e.response = await outcome(() => extend(f)); const seg = await StaySegment.find({ reservation: f.resId }).sort({ fromDate: 1 }).lean(); e.segments = seg;
    assert.equal(e.response.ok, true); assert.equal(seg.length, 2); assert.equal(seg[0].toDate, f.departure); assert.equal(seg[0].ratePerNight, 500); assert.equal(seg[1].fromDate, f.departure); assert.equal(seg[1].ratePerNight, 800);
  });
  await check('CX06', 'cancellation rejects a stale parent status with an entered unit', async (e) => {
    const f = await fixture(); await ReservationRoom.updateOne({ _id: f.units[0]._id }, { $set: { status: 'in_house' } });
    e.before = await state(f); e.response = await outcome(() => cancel(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('CX07', 'channel queue failure rolls back the entire cancellation', async (e) => { const f = await fixture(); await rollback(e, f, ChannelUpdateQueue, 'create', () => cancel(f)); });
  await check('CX08', 'notice records one finance decision item without creating a fee or refund', async (e) => {
    const f = await fixture(); const beforeFolios = await Folio.find({ reservation: f.resId }).lean();
    e.response = await outcome(() => notice(f)); const r = await Reservation.findById(f.resId).lean();
    assert.equal(e.response.ok, true); assert.equal(r.status, 'cancelled'); assert.equal(r.cancellation.channel, 'desk'); assert.equal(await WorkItem.countDocuments({ property: f.propertyId }), 1);
    assert.deepEqual(await Folio.find({ reservation: f.resId }).lean(), beforeFolios);
  });
  await check('NS06', 'all no-show entry points reject a guest already in the arrival queue', async (e) => {
    const f = await fixture(); await ArrivalQueueEntry.create({ property: f.propertyId, reservation: f.resId, reservationRoom: f.units[0]._id, owner: actor.id, arrivedAt: new Date(), reason: 'cleaning' });
    e.before = await state(f); e.response = await outcome(() => noShow(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('NS07', 'a successful no-show closes its unit without changing physical occupancy', async (e) => {
    const f = await fixture(); await Room.updateOne({ _id: f.rooms[0]._id }, { $set: { occStatus: 'occupied' } }); e.response = await outcome(() => noShow(f));
    assert.equal(e.response.ok, true); assert.equal((await ReservationRoom.findById(f.units[0]._id)).status, 'no_show'); assert.equal((await Room.findById(f.rooms[0]._id)).occStatus, 'occupied');
  });
  await check('EX08', 'expired extension lease rolls back all added nights', async (e) => {
    const f = await fixture({ inHouse: true }); e.before = await state(f); const original = StaySegment.insertMany; let injected = false;
    StaySegment.insertMany = async function (...args) { const value = await original.apply(this, args); if (!injected) { injected = true; await OperationLock.updateMany({ key: `res:${f.resId}` }, { $set: { expiresAt: new Date(0) } }); } return value; };
    try { e.response = await outcome(() => extend(f)); } finally { StaySegment.insertMany = original; }
    e.after = await state(f); assert.equal(e.response.error?.code, 'lock_expired'); assert.deepEqual(e.after, e.before);
  });
  await check('EX09', 'mixed room types are refused before extension can allocate the wrong inventory', async (e) => {
    const f = await fixture({ inHouse: true, roomsCount: 2 }); const other = await RoomType.create({ property: f.propertyId, code: 'FAM', name: 'Synthetic family', baseRate: 800 });
    await ReservationRoom.updateOne({ _id: f.units[1]._id }, { $set: { roomTypeBooked: other._id } });
    e.before = await state(f); e.response = await outcome(() => extend(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('EX10', 'an unpriced board supplement blocks extension without losing the meal package', async (e) => {
    const f = await fixture({ inHouse: true, board: true }); await Property.updateOne({ _id: f.propertyId }, { $set: { 'boardPricing.supplements': [] } });
    e.before = await state(f); e.response = await outcome(() => extend(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('EX11', 'closed rate on an added night blocks extension', async (e) => {
    const f = await fixture({ inHouse: true }); await RateDate.updateOne({ ratePlan: f.plan._id, date: f.departure }, { $set: { stopSell: true } });
    e.before = await state(f); e.response = await outcome(() => extend(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('EX12', 'new booking and extension cannot both sell the last added night', async (e) => {
    const f = await fixture({ inHouse: true }); await Room.deleteOne({ _id: f.rooms[1]._id }); await InventoryDate.updateMany({ property: f.propertyId }, { $set: { physicalCount: 1 } });
    const r = await Reservation.findById(f.resId).lean();
    e.responses = await Promise.all([outcome(() => extend(f)), outcome(() => createBooking({ propertyId: f.propertyId, actor, input: { arrival: f.departure, departure: plus(f.departure, 1), adults: 2, children: 0, rooms: 1, roomTypeId: id(f.type), ratePlanId: id(f.plan), guestId: id(r.primaryGuest), mode: 'confirm', idempotencyKey: randomUUID() } }))]);
    assert.equal(e.responses.filter((r) => r.ok).length, 1); assert.equal((await InventoryDate.findOne({ property: f.propertyId, date: f.departure })).bookedCount, 1);
  });
  await check('EX13', 'two units assigned to one physical room cannot be extended', async (e) => {
    const f = await fixture({ inHouse: true, roomsCount: 2 }); await ReservationRoom.updateMany({ reservation: f.resId }, { $set: { assignedRoom: f.rooms[0]._id } });
    e.before = await state(f); e.response = await outcome(() => extend(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('EX14', 'a board included in the rate is not supplemented twice on extension', async (e) => {
    const f = await fixture({ inHouse: true }); await RatePlan.updateOne({ _id: f.plan._id }, { $set: { includesBreakfast: true } }); await Reservation.updateOne({ _id: f.resId }, { $set: { board: 'breakfast' } });
    e.response = await outcome(() => extend(f)); assert.equal(e.response.ok, true); assert.equal(e.response.value.added, 500);
  });
  await check('EX15', 'manual lodging extension price still includes the separately priced board', async (e) => {
    const f = await fixture({ inHouse: true, board: true });
    e.response = await outcome(() => extendStay({ propertyId: f.propertyId, reservationId: f.resId, actor, input: { newDeparture: plus(f.departure, 1), paymentArrangement: 'Synthetic guarantee', guestConfirmation: 'Synthetic consent', manualRate: 400, reason: 'Synthetic manager adjustment' } }));
    const r = await Reservation.findById(f.resId).lean(); assert.equal(e.response.ok, true); assert.equal(e.response.value.added, 600); assert.equal(r.totalAmount, 2000); assert.equal(r.priceSnapshot.nightly.at(-1).price, 400); assert.equal(r.priceSnapshot.board.nightly.at(-1).price, 200);
  });
  await check('EX16', 'partial arrival cannot silently extend only some units of the booking', async (e) => {
    const f = await fixture({ inHouse: true, roomsCount: 2 }); await Reservation.updateOne({ _id: f.resId }, { $set: { status: 'partially_checked_in' } }); await ReservationRoom.updateOne({ _id: f.units[1]._id }, { $set: { status: 'reserved' } });
    e.before = await state(f); e.response = await outcome(() => extend(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
} catch (e) { results.push({ code: 'INFRA', status: 'blocked', failure: e.message }); console.error(e.message); }
finally {
  await mongoose.disconnect(); if (replica) await replica.stop();
  const dir = fileURLToPath(new URL('../../docs/product-readiness/evidence/', import.meta.url)); await mkdir(dir, { recursive: true });
  const paths = ['../services/reservationService.js', '../services/stayChangeService.js', '../services/platformService.js', '../services/bookingService.js', '../services/frontDeskService.js', '../services/availabilityService.js', '../services/channelQueueService.js', '../services/auditService.js', '../services/boardService.js', '../services/stayTransaction.js', '../services/locks.js', '../routes/reservations.js', './stayClosureReadiness.mjs'];
  const hashes = Object.fromEntries(paths.map((p) => [p, createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex')]));
  const report = { startedAt, finishedAt: new Date().toISOString(), mode: 'isolated local replica; synthetic fixtures; no external delivery', hashes, counts: { passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length, blocked: results.filter((r) => r.status === 'blocked').length }, results };
  const body = JSON.stringify(report, null, 2) + '\n'; await writeFile(`${dir}/stay-closure-${startedAt.replace(/[:.]/g, '-')}.json`, body); await writeFile(`${dir}/stay-closure-latest.json`, body);
  console.log(JSON.stringify(report.counts)); if (report.counts.failed || report.counts.blocked) process.exitCode = 1;
}
