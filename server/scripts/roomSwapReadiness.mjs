// Isolated local replica, synthetic guests only. Never loads .env or app.js.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
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
import InventoryLock from '../models/InventoryLock.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import RoomBlock from '../models/RoomBlock.js';
import OperationLock from '../models/OperationLock.js';
import AuditLog from '../models/AuditLog.js';
import RoomSwapOperation from '../models/RoomSwapOperation.js';
import Folio from '../models/Folio.js';
import User from '../models/User.js';
import { businessDateOf } from '../services/frontDeskService.js';
import { previewRoomSwap, swapRooms, roomSwapOptions } from '../services/roomSwapService.js';
import { planNights } from '../services/roomCharges.js';
import { attachActor, requireActor } from '../middleware/authContext.js';
import { pmsJwtSecret } from '../utils/jwtSecret.js';
import stayRouter from '../routes/stay.js';

const startedAt = new Date().toISOString(), results = [];
const actor = { id: String(new mongoose.Types.ObjectId()), name: 'Synthetic swap QA', role: 'receptionist' };
const id = (v) => String(v?._id || v);
const plus = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const plain = (v) => JSON.parse(JSON.stringify(v));
const models = { Property, RoomType, Room, GuestProfile, Reservation, ReservationRoom, StaySegment, InventoryDate, InventoryLock, HousekeepingTask, MaintenanceTicket, RoomBlock, AuditLog, RoomSwapOperation, Folio };

export async function fixture({ differentTypes = false, tail = false, sameReservation = false } = {}) {
  const property = await Property.create({ name: 'Synthetic swap hotel', timezone: 'Asia/Jerusalem' });
  const propertyId = id(property), today = businessDateOf(property), arrival = plus(today, -1);
  const types = [await RoomType.create({ property: propertyId, code: 'STD', name: 'Standard', baseRate: 500, capacityMax: 6, adultsMax: 6, childrenMax: 4 })];
  types.push(differentTypes ? await RoomType.create({ property: propertyId, code: 'DLX', name: 'Deluxe', baseRate: 800, capacityMax: 6, adultsMax: 6, childrenMax: 4 }) : types[0]);
  const rooms = [], reservations = [], units = [];
  for (let i = 0; i < 2; i++) {
    const departure = plus(today, tail && i === 0 ? 3 : 2);
    rooms.push(await Room.create({ property: propertyId, roomType: types[i]._id, number: String(101 + i), floor: 1, occStatus: 'occupied', cleanStatus: 'clean' }));
    const guest = await GuestProfile.create({ property: propertyId, firstName: i ? 'נועה' : 'דני', lastName: 'בדיקה', email: `guest-${randomUUID()}@example.test`, phone: '0000000000' });
    reservations.push(sameReservation && i ? reservations[0] : await Reservation.create({ property: propertyId, confirmationNumber: `QA-${randomUUID()}`, primaryGuest: guest._id, roomType: types[i]._id, assignedRoom: rooms[i]._id, status: 'in_house', arrivalDate: arrival, departureDate: departure, nights: tail && i === 0 ? 4 : 3, roomsCount: sameReservation ? 2 : 1, adults: sameReservation ? 4 : 2, children: 0, ratePerNight: 500 + i * 300, totalAmount: 1500 + i * 900 }));
    units.push(await ReservationRoom.create({ property: propertyId, reservation: reservations[i]._id, roomTypeBooked: types[i]._id, assignedRoom: rooms[i]._id, arrivalDate: arrival, departureDate: departure, nightlyRate: 500 + i * 300, adults: 2, children: 0, occupantName: i ? 'נועה בדיקה' : 'דני בדיקה', roomPayer: i ? 'guest' : 'booker', status: 'in_house' }));
    await StaySegment.create({ property: propertyId, reservation: reservations[i]._id, reservationRoom: units[i]._id, room: rooms[i]._id, roomType: types[i]._id, fromDate: arrival, toDate: departure, ratePerNight: units[i].nightlyRate });
    await Folio.create({ property: propertyId, reservation: reservations[i]._id, ownerType: i ? 'room' : 'guest', ...(i ? { ownerRef: units[i]._id } : {}), lines: [] });
  }
  for (const type of [...new Map(types.map((t) => [id(t), t])).values()]) for (let n = 0; n < (tail ? 3 : 2); n++) {
    const date = plus(today, n), count = units.filter((u) => id(u.roomTypeBooked) === id(type) && date < u.departureDate).length;
    await InventoryDate.create({ property: propertyId, roomType: type._id, date, physicalCount: types[0] === types[1] ? 2 : 1, bookedCount: count });
  }
  return { property, propertyId, today, arrival, rooms, types, reservations, units };
}
function refs(f) { return Object.fromEntries(['first', 'second'].map((key, i) => [key, { reservationId: id(f.reservations[i]), unitId: id(f.units[i]), roomId: id(f.rooms[i]) }])); }
const preview = (f, input = refs(f)) => previewRoomSwap({ propertyId: f.propertyId, input, actor });
const commit = (f, input) => swapRooms({ propertyId: f.propertyId, input, actor });
async function body(f) { const plan = await preview(f); return { ...refs(f), previewHash: plan.previewHash, requestKey: randomUUID(), reason: 'Synthetic coordinated guest swap', guestConsentConfirmed: true, turnoverConfirmed: true }; }
async function state(f) {
  const out = {};
  for (const [name, model] of Object.entries(models)) out[name] = await model.find(name === 'Property' ? { _id: f.propertyId } : { property: f.propertyId }).sort({ _id: 1 }).lean();
  return plain(out);
}
const outcome = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: { message: e.message, code: e.code, status: e.status } }; } };
async function scenario(code, name, run) {
  const evidence = {};
  try { await run(evidence); results.push({ code, name, status: 'passed', evidence }); console.log(`PASS ${code} ${name}`); }
  catch (e) { results.push({ code, name, status: 'failed', failure: e.message, evidence }); console.log(`FAIL ${code} ${name}: ${e.message.split('\n')[0]}`); }
}
async function blocked(f, expected, e) {
  const input = await body(f); e.before = await state(f); const plan = await preview(f); e.blockers = plan.blockers;
  assert.equal(plan.ready, false); assert.ok(plan.blockers.some((b) => b.code === expected), JSON.stringify(plan.blockers));
  e.response = await outcome(() => commit(f, input)); assert.equal(e.response.error?.code, 'swap_blocked'); assert.deepEqual(await state(f), e.before);
}

// Exported fixture is also used by the explicit local-only browser harness.
const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
if (isMain) {
let replica, httpServer;
try {
  replica = await createAccountingTestReplica();
  await mongoose.connect(replica.getUri(), { dbName: `swap_qa_${Date.now()}` });
  await Promise.all([...Object.values(models), OperationLock, User].map((m) => m.init()));

  await scenario('SW01', 'both guests swap atomically; histories, accounts and prices remain with their units', async (e) => {
    const f = await fixture(); const input = await body(f); e.before = await state(f); e.response = await commit(f, input); e.after = await state(f);
    for (let i = 0; i < 2; i++) {
      const unit = await ReservationRoom.findById(f.units[i]._id).lean(); assert.equal(id(unit.assignedRoom), id(f.rooms[1 - i])); assert.equal(unit.nightlyRate, f.units[i].nightlyRate); assert.equal(unit.roomPayer, f.units[i].roomPayer);
      const res = await Reservation.findById(f.reservations[i]._id).lean(); assert.equal(id(res.assignedRoom), id(f.rooms[1 - i])); assert.equal(res.totalAmount, f.reservations[i].totalAmount);
      const segments = await StaySegment.find({ reservationRoom: unit._id }).sort({ fromDate: 1 }).lean();
      assert.deepEqual(segments.map((s) => [id(s.room), s.fromDate, s.toDate, s.ratePerNight]), [[id(f.rooms[i]), f.arrival, f.today, unit.nightlyRate], [id(f.rooms[1 - i]), f.today, unit.departureDate, unit.nightlyRate]]);
    }
    assert.deepEqual(e.after.Folio, e.before.Folio); assert.deepEqual(e.after.InventoryDate, e.before.InventoryDate);
    assert.equal(e.after.HousekeepingTask.length, 0); assert.ok(e.after.Room.every((r) => r.occStatus === 'occupied' && r.cleanStatus === 'clean'));
    assert.equal(e.after.AuditLog.filter((a) => a.action === 'stay.rooms_swapped').length, 2); assert.equal(e.after.RoomSwapOperation.length, 1); assert.equal(e.response.keys.status, 'not_connected');
  });
  await scenario('SW02', 'replay after successful swap returns original receipt without swapping back', async (e) => {
    const f = await fixture(), input = await body(f); await commit(f, input); e.before = await state(f); e.response = await commit(f, input);
    assert.equal(e.response.duplicate, true); assert.deepEqual(await state(f), e.before);
    const conflict = await outcome(() => commit(f, { ...input, reason: 'Changed request' })); assert.equal(conflict.error?.code, 'swap_request_conflict');
  });
  await scenario('SW03', 'simultaneous identical requests produce one swap and one receipt replay', async (e) => {
    const f = await fixture(), input = await body(f); e.responses = await Promise.all([outcome(() => commit(f, input)), outcome(() => commit(f, input))]);
    assert.ok(e.responses.every((r) => r.ok), JSON.stringify(e.responses)); assert.equal(e.responses.filter((r) => r.value.duplicate).length, 1);
    assert.equal(await RoomSwapOperation.countDocuments({ property: f.propertyId }), 1);
  });
  await scenario('SW04', 'simultaneous different requests cannot reverse an already committed swap', async (e) => {
    const f = await fixture(), input = await body(f); e.responses = await Promise.all([outcome(() => commit(f, input)), outcome(() => commit(f, { ...input, requestKey: randomUUID() }))]);
    assert.equal(e.responses.filter((r) => r.ok).length, 1); assert.equal(e.responses.find((r) => !r.ok).error.code, 'swap_source_changed');
  });
  await scenario('SW05', 'same-booking units swap while the primary room follows its original unit', async (e) => {
    const f = await fixture({ sameReservation: true }); await commit(f, await body(f));
    e.res = await Reservation.findById(f.reservations[0]._id).lean(); assert.equal(id(e.res.assignedRoom), id(f.rooms[1]));
    for (let i = 0; i < 2; i++) assert.equal(id((await ReservationRoom.findById(f.units[i]._id)).assignedRoom), id(f.rooms[1 - i]));
  });
  await scenario('SW06', 'different categories and departure dates change only the net tail inventory', async (e) => {
    const f = await fixture({ differentTypes: true, tail: true }); e.plan = await preview(f); assert.equal(e.plan.ready, true, JSON.stringify(e.plan.blockers));
    await commit(f, await body(f)); e.inventory = await InventoryDate.find({ property: f.propertyId }).lean();
    for (let i = 0; i < 2; i++) for (let n = 0; n < 3; n++) assert.equal(e.inventory.find((r) => id(r.roomType) === id(f.types[i]) && r.date === plus(f.today, n)).bookedCount, n < 2 ? 1 : i === 1 ? 1 : 0);
  });
  await scenario('SW07', 'unassigned future category booking prevents overselling the longer leg', async (e) => {
    const f = await fixture({ differentTypes: true, tail: true });
    await Reservation.create({ ...f.reservations[1].toObject(), _id: new mongoose.Types.ObjectId(), confirmationNumber: randomUUID(), status: 'confirmed', arrivalDate: plus(f.today, 2), departureDate: plus(f.today, 3), nights: 1, assignedRoom: null });
    await blocked(f, 'no_inventory', e);
  });
  const blockerCases = [
    ['SW08', 'second guest cannot fit into the first guest room', 'capacity', async (f) => { await RoomType.updateOne({ _id: f.types[0]._id }, { $set: { capacityMax: 2, adultsMax: 2 } }); await Reservation.updateOne({ _id: f.reservations[1]._id }, { $set: { adults: 3 } }); await ReservationRoom.updateOne({ _id: f.units[1]._id }, { $set: { adults: 3 } }); }],
    ['SW09', 'dirty occupied room is not ready for another guest', 'room_not_ready', async (f) => { await Room.updateOne({ _id: f.rooms[1]._id }, { $set: { cleanStatus: 'dirty' } }); }],
    ['SW10', 'out of order occupied room blocks the swap', 'room_blocked', async (f) => { await Room.updateOne({ _id: f.rooms[1]._id }, { $set: { opsStatus: 'out_of_order' } }); }],
    ['SW11', 'future dated room block prevents swapping for the remaining stay', 'dated_room_block', async (f) => { await RoomBlock.create({ property: f.propertyId, room: f.rooms[1]._id, roomType: f.types[1]._id, from: plus(f.today, 1), to: plus(f.today, 2), reason: 'Synthetic block' }); }],
    ['SW12', 'open housekeeping and DND task must be resolved first', 'open_housekeeping', async (f) => { await HousekeepingTask.create({ property: f.propertyId, room: f.rooms[1]._id, date: f.today, type: 'stayover', status: 'paused', isDND: true }); }],
    ['SW13', 'guest-must-move maintenance ticket prevents receiving another guest', 'blocking_maintenance', async (f) => { await MaintenanceTicket.create({ property: f.propertyId, room: f.rooms[1]._id, category: 'lock', description: 'Synthetic lock fault', guestImpact: 'move' }); }],
    ['SW14', 'a third unit overlapping either destination is protected', 'third_party_conflict', async (f) => { await ReservationRoom.create({ ...f.units[1].toObject(), _id: new mongoose.Types.ObjectId(), reservation: f.reservations[0]._id, arrivalDate: plus(f.today, 1), status: 'reserved' }); }],
    ['SW15', 'legacy future reservation holding a destination is protected', 'third_party_conflict', async (f) => { await Reservation.create({ ...f.reservations[1].toObject(), _id: new mongoose.Types.ObjectId(), confirmationNumber: randomUUID(), status: 'confirmed', arrivalDate: plus(f.today, 1) }); }],
    ['SW16', 'incomplete legacy multi-room booking requires explicit units', 'incomplete_units', async (f) => { await Reservation.updateOne({ _id: f.reservations[0]._id }, { $set: { roomsCount: 3 } }); }],
    ['SW17', 'missing stay segment cannot erase an unknown history', 'segment_missing', async (f) => { await StaySegment.deleteMany({ reservationRoom: f.units[0]._id }); }],
    ['SW18', 'overlapping stay segments require repair before swap', 'segment_overlap', async (f) => { const s = await StaySegment.findOne({ reservationRoom: f.units[0]._id }).lean(); await StaySegment.create({ ...s, _id: new mongoose.Types.ObjectId() }); }],
    ['SW19', 'existing future room change cannot be silently overwritten', 'future_room_change', async (f) => { const s = await StaySegment.findOne({ reservationRoom: f.units[0]._id }).lean(); await StaySegment.create({ ...s, _id: new mongoose.Types.ObjectId(), room: f.rooms[1]._id, fromDate: plus(f.today, 1) }); }],
  ];
  for (const [code, name, blocker, setup] of blockerCases) await scenario(code, name, async (e) => { const f = await fixture(); await setup(f); await blocked(f, blocker, e); });
  await scenario('SW20', 'changed source or changed preview cannot commit stale choices', async (e) => {
    const f = await fixture(), input = await body(f); await ReservationRoom.updateOne({ _id: f.units[0]._id }, { $set: { occupantName: 'Updated occupant' } }); e.before = await state(f);
    e.stale = await outcome(() => commit(f, input)); assert.equal(e.stale.error?.code, 'swap_preview_stale'); assert.deepEqual(await state(f), e.before);
    e.source = await outcome(() => commit(f, { ...input, first: { ...input.first, roomId: id(f.rooms[1]) }, second: { ...input.second, roomId: id(f.rooms[0]) } })); assert.equal(e.source.error?.code, 'swap_source_changed');
  });
  await scenario('SW21', 'neither consent, turnover, price nor request identity can be bypassed', async (e) => {
    const f = await fixture(), input = await body(f); e.before = await state(f); e.responses = [];
    for (const patch of [{ guestConsentConfirmed: false }, { turnoverConfirmed: false }, { requestKey: '' }, { previewHash: '' }, { reason: 'x' }, { priceMode: 'manual' }, { rate: 1 }]) {
      const r = await outcome(() => commit(f, { ...input, ...patch })); e.responses.push(r); assert.equal(r.error?.status, 422);
    }
    assert.deepEqual(await state(f), e.before);
  });
  await scenario('SW22', 'same unit, foreign property and wrong reservation-unit pairing are rejected', async (e) => {
    const f = await fixture(), other = await fixture(), input = await body(f); e.before = await state(f);
    for (const patch of [{ second: input.first }, { second: refs(other).second }, { first: { ...input.first, unitId: input.second.unitId } }]) {
      const r = await outcome(() => commit(f, { ...input, ...patch })); assert.equal(r.ok, false); (e.responses ||= []).push(r);
    }
    assert.deepEqual(await state(f), e.before);
  });
  const failures = [
    ['SW23', 'segment insertion', StaySegment, 'insertMany'],
    ['SW24', 'second unit save', ReservationRoom.prototype, 'save'],
    ['SW25', 'room update', Room, 'updateMany'],
    ['SW26', 'inventory update', InventoryDate, 'updateMany'],
    ['SW27', 'second reservation audit', AuditLog, 'create'],
    ['SW28', 'receipt insertion', RoomSwapOperation, 'create'],
  ];
  for (const [code, name, target, method] of failures) await scenario(code, `failure during ${name} rolls back both guests and every side effect`, async (e) => {
    const f = await fixture({ differentTypes: true, tail: true }), input = await body(f); e.before = await state(f);
    const original = target[method]; let hits = 0;
    target[method] = function (...args) {
      const selected = method === 'save' ? id(this.property) === f.propertyId : target === AuditLog ? args[0]?.[0]?.action === 'stay.rooms_swapped' : true;
      if (selected && ++hits >= (['SW24', 'SW27'].includes(code) ? 2 : 1)) throw new Error(`QA_INJECT_${code}`);
      return original.apply(this, args);
    };
    try { e.response = await outcome(() => commit(f, input)); } finally { target[method] = original; }
    assert.equal(e.response.error?.message, `QA_INJECT_${code}`, JSON.stringify(e.response)); assert.deepEqual(await state(f), e.before);
  });
  await scenario('SW29', 'expired operation ownership aborts both guests before commit', async (e) => {
    const f = await fixture(), input = await body(f); e.before = await state(f); const original = RoomSwapOperation.create;
    RoomSwapOperation.create = async function (...args) { await OperationLock.updateMany({ key: `dayclose:${f.propertyId}` }, { $set: { expiresAt: new Date(0) } }); return original.apply(this, args); };
    try { e.response = await outcome(() => commit(f, input)); } finally { RoomSwapOperation.create = original; }
    assert.equal(e.response.ok, false); assert.deepEqual(await state(f), e.before);
  });
  await scenario('SW30', 'zero and varying agreed nightly rates remain intact', async (e) => {
    const f = await fixture(); await Reservation.updateOne({ _id: f.reservations[0]._id }, { $set: { 'priceSnapshot.nightly': [{ date: f.today, price: 0 }, { date: plus(f.today, 1), price: 720 }] } });
    await commit(f, await body(f)); e.segments = await StaySegment.find({ reservationRoom: f.units[0]._id }).sort({ fromDate: 1 }).lean();
    assert.deepEqual(e.segments.map((s) => s.ratePerNight), [500, 0, 720]);
  });
  await scenario('SW31', 'inspection policy is checked for both occupied rooms', async (e) => {
    const f = await fixture(); await Property.updateOne({ _id: f.propertyId }, { $set: { 'checkInPolicy.requireInspection': true } }); await blocked(f, 'room_not_ready', e);
  });
  await scenario('SW32', 'checkout after preview prevents swap with no partial change', async (e) => {
    const f = await fixture(), input = await body(f); await ReservationRoom.updateOne({ _id: f.units[1]._id }, { $set: { status: 'checked_out' } }); e.before = await state(f);
    e.response = await outcome(() => commit(f, input)); assert.equal(e.response.error?.code, 'swap_not_in_house'); assert.deepEqual(await state(f), e.before);
  });
  await scenario('SW33', 'search uses literal room text, retains source and omits private contact fields', async (e) => {
    const f = await fixture(); e.options = await roomSwapOptions({ propertyId: f.propertyId, reservationId: id(f.reservations[0]), q: '102', actor });
    assert.equal(e.options.source[0].unitId, id(f.units[0])); assert.deepEqual(e.options.candidates.map((u) => u.unitId), [id(f.units[1])]);
    assert.ok(!/email|phone|totalAmount|ratePerNight/.test(JSON.stringify(e.options)));
    const literal = await roomSwapOptions({ propertyId: f.propertyId, reservationId: id(f.reservations[0]), q: '[', actor }); assert.equal(literal.candidates.length, 0);
    const name = await roomSwapOptions({ propertyId: f.propertyId, reservationId: id(f.reservations[0]), q: 'נועה', actor }); assert.equal(name.candidates[0].unitId, id(f.units[1]));
  });
  await scenario('SW36', 'night and meal charge planning retains amount, unit reference and payer after the swap', async (e) => {
    const f = await fixture();
    await Reservation.updateOne({ _id: f.reservations[0]._id }, { $set: { 'priceSnapshot.nightly': [{ date: f.today, price: 0 }, { date: plus(f.today, 1), price: 720 }], 'priceSnapshot.board': { type: 'breakfast', source: 'supplement', nightly: [{ date: f.today, price: 80 }] } } });
    const financialPlan = async () => {
      const list = [];
      for (const res of f.reservations) { const current = await Reservation.findById(res._id); const plan = await planNights({ reservation: current, until: current.departureDate }); list.push(plan.items.map(({ description, ...financial }) => financial)); }
      return plain(list);
    };
    e.before = await financialPlan(); await commit(f, await body(f)); e.after = await financialPlan(); assert.deepEqual(e.after, e.before);
    assert.ok(e.after[0].some((i) => i.code === 'board' && i.gross === 80)); assert.ok(e.after[1].every((i) => i.toUnit && i.unitId === id(f.units[1])));
  });
  await scenario('SW37', 'receipt is rechecked when another request commits between preload reads', async (e) => {
    const f = await fixture(), input = await body(f), original = ReservationRoom.find;
    let entered, proceed, armed = true;
    const enteredPromise = new Promise((r) => { entered = r; }), gate = new Promise((r) => { proceed = r; });
    ReservationRoom.find = function (...args) {
      const query = original.apply(this, args);
      if (armed && args[0]?._id?.$in && String(args[0].property) === f.propertyId) {
        armed = false; const lean = query.lean;
        query.lean = async function (...values) { entered(); await gate; return lean.apply(this, values); };
      }
      return query;
    };
    let waiting;
    try { waiting = outcome(() => commit(f, input)); await enteredPromise; await commit(f, input); proceed(); e.response = await waiting; }
    finally { proceed(); ReservationRoom.find = original; if (waiting) await waiting; }
    assert.equal(e.response.ok, true, JSON.stringify(e.response)); assert.equal(e.response.value.duplicate, true); assert.equal(await RoomSwapOperation.countDocuments({ property: f.propertyId }), 1);
  });
  await scenario('SW38', 'original receipt remains available after later checkout', async (e) => {
    const f = await fixture(), input = await body(f); await commit(f, input);
    await ReservationRoom.updateMany({ property: f.propertyId }, { $set: { status: 'checked_out' } }); await Reservation.updateMany({ property: f.propertyId }, { $set: { status: 'checked_out' } });
    e.before = await state(f); e.response = await commit(f, input); assert.equal(e.response.duplicate, true); assert.deepEqual(await state(f), e.before);
  });
  await scenario('SW39', 'third-party future stay segment is protected even when its unit points elsewhere', async (e) => {
    const f = await fixture();
    const room = await Room.create({ property: f.propertyId, roomType: f.types[0]._id, number: '103', floor: 1 });
    const res = await Reservation.create({ ...f.reservations[0].toObject(), _id: new mongoose.Types.ObjectId(), confirmationNumber: randomUUID(), status: 'confirmed', assignedRoom: room._id });
    const unit = await ReservationRoom.create({ ...f.units[0].toObject(), _id: new mongoose.Types.ObjectId(), reservation: res._id, assignedRoom: room._id, status: 'reserved' });
    await StaySegment.create({ property: f.propertyId, reservation: res._id, reservationRoom: unit._id, room: f.rooms[1]._id, roomType: f.types[0]._id, fromDate: plus(f.today, 1), toDate: plus(f.today, 2), ratePerNight: 500 });
    await blocked(f, 'third_party_segment', e);
  });
  await scenario('SW40', 'category stop sell on the net extra night blocks the swap', async (e) => {
    const f = await fixture({ differentTypes: true, tail: true }); await InventoryDate.updateOne({ property: f.propertyId, roomType: f.types[1]._id, date: plus(f.today, 2) }, { $set: { stopSell: true } }); await blocked(f, 'no_inventory', e);
  });
  await scenario('SW41', 'an active booking hold protects the last destination category night', async (e) => {
    const f = await fixture({ differentTypes: true, tail: true });
    await InventoryLock.create({ property: f.propertyId, roomType: f.types[1]._id, arrivalDate: plus(f.today, 2), departureDate: plus(f.today, 3), roomsCount: 1, idempotencyKey: randomUUID(), expiresAt: new Date(Date.now() + 60000) }); await blocked(f, 'no_inventory', e);
  });
  await scenario('SW42', 'unknown group composition is never guessed as an equal split', async (e) => {
    const f = await fixture({ sameReservation: true }); await Reservation.updateOne({ _id: f.reservations[0]._id }, { $set: { adults: 6 } });
    await ReservationRoom.updateMany({ property: f.propertyId }, { $unset: { adults: 1, children: 1 } }); await RoomType.updateOne({ _id: f.types[0]._id }, { $set: { capacityMax: 2, adultsMax: 2 } }); await blocked(f, 'capacity', e);
  });

  const app = express(); app.use(express.json(), attachActor, requireActor); app.use('/api/pms/stay', stayRouter);
  httpServer = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${httpServer.address().port}/api/pms/stay`;
  async function userToken(property, role = 'receptionist') { const u = await User.create({ email: `swap-${randomUUID()}@example.test`, passwordHash: 'synthetic-placeholder', firstName: 'QA', lastName: 'Swap', property, role, active: true }); return jwt.sign({ id: id(u), tv: 0 }, pmsJwtSecret(), { expiresIn: '10m' }); }
  const request = async (path, token, input) => { const r = await fetch(`${base}${path}`, { method: input ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(10000) }); return { status: r.status, body: await r.json() }; };
  await scenario('SW34', 'real JWT routes reject absent identity, wrong role and foreign property', async (e) => {
    const f = await fixture(), input = { ...await body(f), propertyId: f.propertyId }; e.before = await state(f);
    e.responses = [await request('/room-swap', null, input), await request('/room-swap/preview', await userToken(f.propertyId, 'housekeeper'), input), await request('/room-swap', await userToken(new mongoose.Types.ObjectId()), input)];
    assert.deepEqual(e.responses.map((r) => r.status), [401, 403, 403]); assert.deepEqual(await state(f), e.before);
  });
  await scenario('SW35', 'real authenticated options, preview, commit and replay complete the HTTP workflow', async (e) => {
    const f = await fixture(), token = await userToken(f.propertyId);
    e.options = await request(`/room-swap/options?propertyId=${f.propertyId}&reservationId=${id(f.reservations[0])}`, token); assert.equal(e.options.status, 200);
    e.preview = await request('/room-swap/preview', token, { ...refs(f), propertyId: f.propertyId }); assert.equal(e.preview.status, 200); assert.equal(e.preview.body.data.ready, true);
    const input = { ...refs(f), propertyId: f.propertyId, previewHash: e.preview.body.data.previewHash, requestKey: randomUUID(), reason: 'Synthetic HTTP swap', guestConsentConfirmed: true, turnoverConfirmed: true };
    e.commit = await request('/room-swap', token, input); assert.equal(e.commit.status, 200); e.replay = await request('/room-swap', token, input); assert.equal(e.replay.body.data.duplicate, true);
  });
} catch (e) { results.push({ code: 'INFRA', status: 'blocked', failure: e.message }); console.error(e); }
finally {
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  await mongoose.disconnect(); if (replica) await replica.stop();
  const output = fileURLToPath(new URL('../../docs/product-readiness/evidence/', import.meta.url)); await mkdir(output, { recursive: true });
  const dependencies = ['../services/roomSwapService.js', '../models/RoomSwapOperation.js', '../services/stayChangeService.js', '../services/stayTransaction.js', '../services/locks.js', '../routes/stay.js', '../../client/src/components/stay/RoomSwapDialog.jsx', '../../client/src/pages/InHousePage.jsx', '../../client/src/utils/api.js', './roomSwapReadiness.mjs'];
  const report = { startedAt, finishedAt: new Date().toISOString(), mode: 'isolated local replica; synthetic guests; real JWT HTTP workflow; no .env', dependencyHashes: Object.fromEntries(dependencies.map((p) => [p, createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex')])), counts: Object.fromEntries(['passed', 'failed', 'blocked'].map((s) => [s, results.filter((r) => r.status === s).length])), results };
  const serialized = JSON.stringify(report, null, 2) + '\n'; await writeFile(`${output}/room-swaps-${startedAt.replace(/[:.]/g, '-')}.json`, serialized); await writeFile(`${output}/room-swaps-latest.json`, serialized);
  console.log(JSON.stringify(report.counts)); if (report.counts.failed || report.counts.blocked) process.exitCode = 1;
}
}
