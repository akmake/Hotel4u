// Requirement audit: intentionally exits 1 when a product requirement fails.
// Uses only a new local MongoDB replica and synthetic fixtures; never loads .env.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import express from 'express';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import InventoryDate from '../models/InventoryDate.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import OperationLock from '../models/OperationLock.js';
import AuditLog from '../models/AuditLog.js';
import RoomBlock from '../models/RoomBlock.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import RoomMoveOperation from '../models/RoomMoveOperation.js';
import { moveRoom, moveCandidates } from '../services/stayChangeService.js';
import { businessDateOf } from '../services/frontDeskService.js';
import { withLocks } from '../services/locks.js';
import stayRouter from '../routes/stay.js';

const results = [];
const startedAt = new Date().toISOString();
const actor = { id: String(new mongoose.Types.ObjectId()), name: 'Synthetic QA', role: 'property_admin' };
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const id = (v) => String(v?._id || v);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function fixture({ adults = 2, children = 0, small = false } = {}) {
  const property = await Property.create({ name: `QA-${randomUUID()}`, timezone: 'Asia/Jerusalem' });
  const propertyId = id(property);
  const today = businessDateOf(property);
  const arrivalDate = addDays(today, -1), departureDate = addDays(today, 2);
  const standard = await RoomType.create({ property: propertyId, code: 'STD', name: 'Synthetic standard', baseRate: 500, capacityMax: 6, adultsMax: 6, childrenMax: 4 });
  const targetType = small ? await RoomType.create({ property: propertyId, code: 'DBL', name: 'Synthetic double', baseRate: 400, capacityMax: 2, adultsMax: 2 }) : standard;
  const source = await Room.create({ property: propertyId, roomType: standard._id, number: '101', floor: 1, occStatus: 'occupied', cleanStatus: 'clean' });
  const target = await Room.create({ property: propertyId, roomType: targetType._id, number: '102', floor: 1, cleanStatus: 'clean' });
  const guest = await GuestProfile.create({ property: propertyId, firstName: 'Synthetic', lastName: 'Guest' });
  const reservation = await Reservation.create({ property: propertyId, confirmationNumber: randomUUID(), status: 'in_house', primaryGuest: guest._id, adults, children, arrivalDate, departureDate, nights: 3, roomsCount: 1, roomType: standard._id, assignedRoom: source._id, ratePerNight: 500, totalAmount: 1500 });
  const unit = await ReservationRoom.create({ property: propertyId, reservation: reservation._id, roomTypeBooked: standard._id, assignedRoom: source._id, arrivalDate, departureDate, nightlyRate: 500, status: 'in_house' });
  await StaySegment.create({ property: propertyId, reservation: reservation._id, reservationRoom: unit._id, fromDate: arrivalDate, toDate: departureDate, roomType: standard._id, room: source._id, ratePerNight: 500 });
  for (const type of small ? [standard, targetType] : [standard]) {
    await InventoryDate.insertMany([0, 1].map((n) => ({ property: propertyId, roomType: type._id, date: addDays(today, n), physicalCount: 4, bookedCount: id(type) === id(standard) ? 1 : 0 })));
  }
  return { property, propertyId, today, arrivalDate, departureDate, standard, targetType, source, target, guest, reservation, unit };
}

function args(f, extra = {}) {
  return { propertyId: f.propertyId, reservationId: id(f.reservation), actor, input: { roomId: id(f.target), unitId: id(f.unit), reason: 'guest_request', priceMode: 'keep', ...extra } };
}

async function state(f) {
  const [units, segments, rooms, inventory, tasks, reservation] = await Promise.all([
    ReservationRoom.find({ reservation: f.reservation._id }).sort({ _id: 1 }).lean(),
    StaySegment.find({ reservation: f.reservation._id }).sort({ fromDate: 1, _id: 1 }).lean(),
    Room.find({ property: f.propertyId }).sort({ number: 1 }).lean(),
    InventoryDate.find({ property: f.propertyId }).sort({ roomType: 1, date: 1 }).lean(),
    HousekeepingTask.find({ property: f.propertyId }).lean(),
    Reservation.findById(f.reservation._id).lean(),
  ]);
  return {
    reservation: { room: id(reservation.assignedRoom), type: id(reservation.roomType), total: reservation.totalAmount, nightly: reservation.priceSnapshot?.nightly?.map((n) => ({ date: n.date, price: n.price })) },
    units: units.map((u) => ({ id: id(u), room: id(u.assignedRoom), type: id(u.roomTypeBooked), status: u.status })),
    segments: segments.map((s) => ({ id: id(s), room: id(s.room), from: s.fromDate, to: s.toDate, rate: s.ratePerNight })),
    rooms: rooms.map((r) => ({ id: id(r), number: r.number, occupancy: r.occStatus, clean: r.cleanStatus })),
    inventory: inventory.map((i) => ({ type: id(i.roomType), date: i.date, booked: i.bookedCount })),
    tasks: tasks.map((t) => ({ room: id(t.room), type: t.type, status: t.status })),
  };
}

async function outcome(promise) {
  try { return { ok: true, value: await promise }; }
  catch (e) { return { ok: false, error: { message: e.message, status: e.status, code: e.code } }; }
}

async function scenario(code, name, requirements, run) {
  const evidence = {};
  try {
    await run(evidence);
    results.push({ code, name, requirements, status: 'passed', evidence });
    console.log(`PASS ${code} ${name}`);
  } catch (e) {
    results.push({ code, name, requirements, status: 'failed', failure: e.message, evidence });
    console.log(`FAIL ${code} ${name}: ${e.message.split('\n')[0]}`);
  }
}

let replica, httpServer;
try {
  replica = await createAccountingTestReplica();
  await mongoose.connect(replica.getUri(), { dbName: `room_readiness_${Date.now()}` });
  await Promise.all([Property, Room, RoomType, GuestProfile, Reservation, ReservationRoom, StaySegment, InventoryDate, HousekeepingTask, OperationLock, AuditLog, RoomBlock].map((m) => m.init()));

  await scenario('RM01', 'valid move preserves history and prepares old room for cleaning', ['MOV01', 'MOV05', 'MOV06'], async (e) => {
    const f = await fixture(); e.before = await state(f);
    e.response = await outcome(moveRoom(args(f))); e.after = await state(f);
    assert.equal(e.response.ok, true);
    assert.equal(e.after.units[0].room, id(f.target));
    assert.deepEqual(e.after.segments.map((s) => [s.room, s.from, s.to]), [[id(f.source), f.arrivalDate, f.today], [id(f.target), f.today, f.departureDate]]);
    assert.equal(e.after.rooms[0].clean, 'dirty'); assert.equal(e.after.rooms[0].occupancy, 'vacant');
    assert.equal(e.after.rooms[1].occupancy, 'occupied');
    assert.equal(e.after.tasks.filter((t) => t.room === id(f.source)).length, 1);
    assert.deepEqual(e.after.inventory, e.before.inventory);
  });

  await scenario('RM02', 'future conflicting reservation rejects move without changes', ['MOV01'], async (e) => {
    const f = await fixture();
    await Reservation.create({ ...f.reservation.toObject(), _id: new mongoose.Types.ObjectId(), confirmationNumber: randomUUID(), status: 'confirmed', arrivalDate: addDays(f.today, 1), departureDate: addDays(f.today, 3), nights: 2, assignedRoom: f.target._id });
    e.before = await state(f); e.response = await outcome(moveRoom(args(f))); e.after = await state(f);
    assert.equal(e.response.ok, false); assert.equal(e.response.error.code, 'target_taken'); assert.deepEqual(e.after, e.before);
  });

  await scenario('RM03', 'dirty room rejects move without changes', ['MOV01'], async (e) => {
    const f = await fixture(); await Room.updateOne({ _id: f.target._id }, { $set: { cleanStatus: 'dirty' } });
    e.before = await state(f); e.response = await outcome(moveRoom(args(f))); e.after = await state(f);
    assert.equal(e.response.ok, false); assert.equal(e.response.error.status, 409); assert.deepEqual(e.after, e.before);
  });

  await scenario('RM04', 'family cannot be moved to a room with capacity two', ['MOV02'], async (e) => {
    const f = await fixture({ adults: 2, children: 2, small: true });
    e.occupants = 4; e.targetCapacity = 2;
    e.candidate = (await moveCandidates({ propertyId: f.propertyId, reservationId: id(f.reservation), unitId: id(f.unit) })).rooms.find((r) => r.id === id(f.target));
    e.before = await state(f); e.response = await outcome(moveRoom(args(f))); e.after = await state(f);
    assert.equal(e.response.ok, false, 'Move accepted four occupants into a room with capacity two');
    assert.deepEqual(e.after, e.before);
  });

  await scenario('RM05A', 'a sibling unit in the same booking cannot be overwritten', ['ARR03', 'MOV01'], async (e) => {
    const f = await fixture(); await Reservation.updateOne({ _id: f.reservation._id }, { $set: { roomsCount: 2, adults: 4 } });
    await Room.updateOne({ _id: f.target._id }, { $set: { occStatus: 'occupied' } });
    await ReservationRoom.create({ property: f.propertyId, reservation: f.reservation._id, roomTypeBooked: f.standard._id, assignedRoom: f.target._id, arrivalDate: f.arrivalDate, departureDate: f.departureDate, nightlyRate: 500, status: 'in_house' });
    e.candidate = (await moveCandidates({ propertyId: f.propertyId, reservationId: id(f.reservation), unitId: id(f.unit) })).rooms.find((r) => r.id === id(f.target));
    e.before = await state(f); e.response = await outcome(moveRoom(args(f))); e.after = await state(f);
    assert.equal(e.response.ok, false, 'Commit accepted a target that the candidate list marks occupied by a sibling unit');
    assert.deepEqual(e.after, e.before);
  });

  await scenario('RM06', 'two concurrent moves cannot occupy the same target', ['MOV04'], async (e) => {
    const f = await fixture();
    const source = await Room.create({ property: f.propertyId, roomType: f.standard._id, number: '103', floor: 1, occStatus: 'occupied', cleanStatus: 'clean' });
    const res = await Reservation.create({ ...f.reservation.toObject(), _id: new mongoose.Types.ObjectId(), confirmationNumber: randomUUID(), assignedRoom: source._id });
    const unit = await ReservationRoom.create({ property: f.propertyId, reservation: res._id, roomTypeBooked: f.standard._id, assignedRoom: source._id, arrivalDate: f.arrivalDate, departureDate: f.departureDate, nightlyRate: 500, status: 'in_house' });
    await StaySegment.create({ property: f.propertyId, reservation: res._id, reservationRoom: unit._id, fromDate: f.arrivalDate, toDate: f.departureDate, roomType: f.standard._id, room: source._id, ratePerNight: 500 });
    e.responses = await Promise.all([outcome(moveRoom(args(f))), outcome(moveRoom(args({ ...f, reservation: res, unit })))]);
    e.targetOccupants = await ReservationRoom.countDocuments({ property: f.propertyId, assignedRoom: f.target._id, status: 'in_house' });
    assert.equal(e.responses.filter((r) => r.ok).length, 1); assert.equal(e.targetOccupants, 1);
  });

  await scenario('RM05B', 'moving selected unit leaves the sibling unit untouched', ['MOV05'], async (e) => {
    const f = await fixture();
    await Reservation.updateOne({ _id: f.reservation._id }, { $set: { roomsCount: 2, adults: 4 } });
    const otherRoom = await Room.create({ property: f.propertyId, roomType: f.standard._id, number: '103', floor: 1, occStatus: 'occupied', cleanStatus: 'clean' });
    const otherUnit = await ReservationRoom.create({ property: f.propertyId, reservation: f.reservation._id, roomTypeBooked: f.standard._id, assignedRoom: otherRoom._id, arrivalDate: f.arrivalDate, departureDate: f.departureDate, nightlyRate: 700, status: 'in_house' });
    const before = await ReservationRoom.findById(otherUnit._id).lean();
    e.response = await outcome(moveRoom(args(f)));
    e.sibling = await ReservationRoom.findById(otherUnit._id).lean();
    assert.equal(e.response.ok, true); assert.deepEqual(e.sibling, before);
    assert.equal(id((await ReservationRoom.findById(f.unit._id)).assignedRoom), id(f.target));
  });

  await scenario('RM07', 'failure creating target segment preserves pre-move state', ['MOV03'], async (e) => {
    const f = await fixture(); e.before = await state(f);
    const original = StaySegment.create;
    StaySegment.create = async () => { throw new Error('QA_INJECT_SEGMENT_CREATE'); };
    try { e.response = await outcome(moveRoom(args(f))); } finally { StaySegment.create = original; }
    e.after = await state(f);
    assert.equal(e.response.error?.message, 'QA_INJECT_SEGMENT_CREATE');
    assert.deepEqual(e.after, e.before, 'Failure left the original stay segment shortened without a target segment');
  });

  await scenario('RM08', 'failure updating room status preserves pre-move state', ['MOV03'], async (e) => {
    const f = await fixture(); e.before = await state(f);
    const original = Room.updateOne;
    Room.updateOne = () => { throw new Error('QA_INJECT_ROOM_UPDATE'); };
    try { e.response = await outcome(moveRoom(args(f))); } finally { Room.updateOne = original; }
    e.after = await state(f);
    assert.equal(e.response.error?.message, 'QA_INJECT_ROOM_UPDATE');
    assert.deepEqual(e.after, e.before, 'Failure left the unit moved while source/target occupancy was unchanged');
  });

  await scenario('RM09', 'failure adding target inventory preserves total booked inventory', ['MOV03'], async (e) => {
    const f = await fixture({ small: true }); e.before = await state(f);
    const original = InventoryDate.updateMany;
    InventoryDate.updateMany = function (filter, update, ...rest) {
      if (id(filter.roomType) === id(f.targetType) && update?.$inc?.bookedCount === 1) throw new Error('QA_INJECT_TARGET_INVENTORY');
      return original.call(this, filter, update, ...rest);
    };
    try { e.response = await outcome(moveRoom(args(f))); } finally { InventoryDate.updateMany = original; }
    e.after = await state(f);
    assert.equal(e.response.error?.message, 'QA_INJECT_TARGET_INVENTORY');
    assert.deepEqual(e.after, e.before, 'Failure changed the unit and reduced source inventory without adding target inventory');
  });

  await scenario('RM10', 'retry after lost response identifies the already completed move', ['MOV04'], async (e) => {
    const f = await fixture(); const request = args(f, { requestKey: randomUUID() });
    e.first = await outcome(moveRoom(request)); e.afterFirst = await state(f);
    e.retry = await outcome(moveRoom(request)); e.afterRetry = await state(f);
    assert.equal(e.first.ok, true); assert.deepEqual(e.afterRetry, e.afterFirst);
    assert.equal(e.retry.ok, true, 'Retry returns an error instead of identifying the completed request');
    assert.equal(e.retry.value.to, e.first.value.to);
  });

  await scenario('RM10B', 'same request key with changed content rejects without writes', ['MOV04'], async (e) => {
    const f = await fixture(); const request = args(f, { requestKey: randomUUID() });
    e.first = await outcome(moveRoom(request)); e.before = await state(f);
    e.changed = await outcome(moveRoom({ ...request, input: { ...request.input, note: 'changed after completion' } }));
    e.after = await state(f);
    assert.equal(e.first.ok, true); assert.equal(e.changed.error?.code, 'request_conflict'); assert.deepEqual(e.after, e.before);
    assert.equal(await RoomMoveOperation.countDocuments({ reservation: f.reservation._id }), 1);
  });

  await scenario('RM10C', 'failed replay-record write rolls back and the same request can retry', ['MOV03', 'MOV04'], async (e) => {
    const f = await fixture(); e.before = await state(f); const request = args(f, { requestKey: randomUUID() });
    const original = RoomMoveOperation.create;
    RoomMoveOperation.create = () => { throw new Error('QA_INJECT_REPLAY_RECORD'); };
    try { e.failed = await outcome(moveRoom(request)); } finally { RoomMoveOperation.create = original; }
    e.afterFailure = await state(f);
    assert.equal(e.failed.error?.message, 'QA_INJECT_REPLAY_RECORD'); assert.deepEqual(e.afterFailure, e.before);
    assert.equal(await AuditLog.countDocuments({ property: f.propertyId }), 0);
    e.retry = await outcome(moveRoom(request));
    assert.equal(e.retry.ok, true); assert.equal(await RoomMoveOperation.countDocuments({ reservation: f.reservation._id }), 1);
  });

  await scenario('RM11', 'old lock owner cannot release a newer owner lock', ['MOV04'], async (e) => {
    const key = `qa:${randomUUID()}`, aEntered = deferred(), aRelease = deferred(), bEntered = deferred(), bRelease = deferred();
    let a, b;
    try {
      a = withLocks([key], async () => { aEntered.resolve(); await aRelease.promise; }); await aEntered.promise;
      // Deterministic expiry injection: equivalent DB condition to a 30s operation expiring.
      await OperationLock.updateOne({ key }, { $set: { expiresAt: new Date(0) } });
      b = withLocks([key], async () => { bEntered.resolve(); await bRelease.promise; });
      await Promise.race([bEntered.promise, b]);
      e.newOwnerAcquired = !!(await OperationLock.exists({ key }));
      aRelease.resolve(); await a;
      e.newOwnerLockSurvivedOldRelease = !!(await OperationLock.exists({ key }));
      e.third = await outcome(withLocks([key], async () => 'entered while B still running'));
      assert.equal(e.newOwnerLockSurvivedOldRelease, true, 'A released B lock after A expired; a third owner entered while B was running');
      assert.equal(e.third.ok, false);
    } finally { aRelease.resolve(); bRelease.resolve(); await Promise.allSettled([a, b].filter(Boolean)); }
  });

  await scenario('RM11B', 'lease expiry during a transaction rolls back the move', ['MOV03', 'MOV04'], async (e) => {
    const f = await fixture(); e.before = await state(f);
    const original = StaySegment.create; let injected = false;
    StaySegment.create = async function (...params) {
      const created = await original.apply(this, params);
      if (!injected) {
        injected = true;
        // Outside the transaction: simulate the real lock expiry/takeover boundary.
        await OperationLock.updateMany({ key: { $in: [`room:${id(f.target)}`, `res:${id(f.reservation)}`] } }, { $set: { expiresAt: new Date(0) } });
      }
      return created;
    };
    try { e.response = await outcome(moveRoom(args(f))); } finally { StaySegment.create = original; }
    e.after = await state(f);
    assert.equal(e.response.error?.code, 'lock_expired'); assert.deepEqual(e.after, e.before);
  });

  await scenario('RM07B', 'audit failure rolls back move, ticket, inventory and replay record', ['MOV03', 'MOV06'], async (e) => {
    const f = await fixture({ small: true }); e.before = await state(f);
    const original = AuditLog.create;
    AuditLog.create = function (entry, ...rest) {
      if ((Array.isArray(entry) ? entry[0] : entry)?.action === 'stay.room_moved') throw new Error('QA_INJECT_MOVE_AUDIT');
      return original.call(this, entry, ...rest);
    };
    try { e.response = await outcome(moveRoom(args(f, { requestKey: randomUUID(), reason: 'maintenance', note: 'Synthetic fault', fault: { category: 'hvac', block: true } }))); }
    finally { AuditLog.create = original; }
    e.after = await state(f);
    e.tickets = await MaintenanceTicket.countDocuments({ property: f.propertyId });
    e.audit = await AuditLog.countDocuments({ property: f.propertyId });
    e.replays = await RoomMoveOperation.countDocuments({ property: f.propertyId });
    assert.equal(e.response.error?.message, 'QA_INJECT_MOVE_AUDIT'); assert.deepEqual(e.after, e.before);
    assert.equal(e.tickets, 0); assert.equal(e.audit, 0); assert.equal(e.replays, 0);
  });

  await scenario('RM04B', 'known unit composition allows a group move without guessing a split', ['MOV02', 'MOV05'], async (e) => {
    const f = await fixture({ adults: 6, small: true });
    await Reservation.updateOne({ _id: f.reservation._id }, { $set: { roomsCount: 3 } });
    await ReservationRoom.updateOne({ _id: f.unit._id }, { $set: { adults: 2, children: 0 } });
    e.response = await outcome(moveRoom(args(f))); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.units[0].room, id(f.target));
  });

  await scenario('RM04C', 'unknown group distribution cannot silently assume equal occupants', ['MOV02'], async (e) => {
    const f = await fixture({ adults: 6, small: true });
    await Reservation.updateOne({ _id: f.reservation._id }, { $set: { roomsCount: 3 } });
    e.before = await state(f); e.response = await outcome(moveRoom(args(f))); e.after = await state(f);
    assert.equal(e.response.error?.code, 'capacity'); assert.deepEqual(e.after, e.before);
  });

  await scenario('RM05C', 'stale source room rejects a different move without writes', ['MOV04'], async (e) => {
    const f = await fixture(); e.before = await state(f);
    e.response = await outcome(moveRoom(args(f, { fromRoomId: id(new mongoose.Types.ObjectId()) })));
    e.after = await state(f); assert.equal(e.response.error?.code, 'source_changed'); assert.deepEqual(e.after, e.before);
  });

  await scenario('RM12', 'manual repricing changes remaining nights only', ['MOV05'], async (e) => {
    const f = await fixture();
    await Reservation.updateOne({ _id: f.reservation._id }, { $set: { 'priceSnapshot.nightly': [f.arrivalDate, f.today, addDays(f.today, 1)].map((date) => ({ date, price: 500 })) } });
    e.response = await outcome(moveRoom(args(f, { priceMode: 'manual', rate: 300, rateReason: 'Synthetic approved goodwill discount' })));
    const res = await Reservation.findById(f.reservation._id).lean(); e.nightly = res.priceSnapshot.nightly; e.total = res.totalAmount;
    assert.equal(e.response.ok, true);
    assert.deepEqual(e.nightly.map((n) => [n.date, n.price]), [[f.arrivalDate, 500], [f.today, 300], [addDays(f.today, 1), 300]]);
    assert.equal(e.total, 1100);
    assert.equal(await AuditLog.countDocuments({ entityId: f.reservation._id, action: 'stay.room_moved' }), 1);
  });

  await scenario('RM13', 'maintenance move creates a blocking fault on the old room', ['MOV06'], async (e) => {
    const f = await fixture();
    e.response = await outcome(moveRoom(args(f, { reason: 'maintenance', note: 'Synthetic broken air conditioning', fault: { category: 'hvac', block: true } })));
    e.source = await Room.findById(f.source._id).lean();
    e.tickets = await MaintenanceTicket.find({ property: f.propertyId, room: f.source._id }).lean();
    assert.equal(e.response.ok, true); assert.equal(e.source.opsStatus, 'out_of_order');
    assert.equal(e.tickets.length, 1); assert.equal(e.tickets[0].blocksRoom, true);
    assert.equal(e.tickets[0].category, 'hvac');
  });

  await scenario('RM14', 'key request explicitly reports provider not connected', ['MOV07'], async (e) => {
    const f = await fixture(); e.response = await outcome(moveRoom(args(f, { keyRequested: true })));
    assert.equal(e.response.ok, true); assert.equal(e.response.value.key.status, 'not_connected');
  });

  const app = express(); app.use(express.json());
  let routeActor;
  app.use((req, res, next) => { req.actor = routeActor; next(); }); app.use('/stay', stayRouter);
  httpServer = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  await scenario('RM17', 'route rejects wrong property and unauthorized role', ['SEC01'], async (e) => {
    const f = await fixture(); e.before = await state(f);
    const post = async () => { const r = await fetch(`${base}/stay/${id(f.reservation)}/move?propertyId=${f.propertyId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args(f).input), signal: AbortSignal.timeout(10000) }); return { status: r.status, body: await r.json() }; };
    routeActor = { ...actor, propertyId: id(new mongoose.Types.ObjectId()) }; e.wrongProperty = await post();
    routeActor = { ...actor, propertyId: f.propertyId, role: 'housekeeper' }; e.wrongRole = await post();
    e.after = await state(f);
    assert.equal(e.wrongProperty.status, 403); assert.equal(e.wrongRole.status, 403); assert.deepEqual(e.after, e.before);
    e.limit = 'Actor is injected at router boundary; JWT validation and all other routes are outside this test.';
  });
} catch (e) {
  results.push({ code: 'INFRA', name: 'isolated test setup/execution', status: 'blocked', failure: e.message });
  console.error(`BLOCKED ${e.message}`);
} finally {
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  await mongoose.disconnect();
  if (replica) await replica.stop();
  const output = fileURLToPath(new URL('../../docs/product-readiness/evidence/', import.meta.url));
  await mkdir(output, { recursive: true });
  const hash = (p) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');
  const dependencies = ['../services/stayTransaction.js', '../services/auditService.js', '../services/frontDeskService.js', '../services/operationsService.js', '../services/availabilityService.js', '../models/RoomMoveOperation.js', '../models/ReservationRoom.js'];
  const report = { startedAt, finishedAt: new Date().toISOString(), mode: 'isolated local replica; synthetic fixtures; no production env loaded', serviceSha256: hash('../services/stayChangeService.js'), locksSha256: hash('../services/locks.js'), scriptSha256: hash('./roomMoveReadiness.mjs'), dependencyHashes: Object.fromEntries(dependencies.map((p) => [p, hash(p)])), counts: { passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length, blocked: results.filter((r) => r.status === 'blocked').length }, results };
  const serialized = JSON.stringify(report, null, 2) + '\n';
  await writeFile(`${output}/room-moves-${startedAt.replace(/[:.]/g, '-')}.json`, serialized, 'utf8');
  await writeFile(`${output}/room-moves-latest.json`, serialized, 'utf8');
  console.log(JSON.stringify(report.counts));
  if (report.counts.failed || report.counts.blocked) process.exitCode = 1;
}
