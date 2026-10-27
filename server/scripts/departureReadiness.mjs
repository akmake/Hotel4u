// Synthetic local replica only: checkout failures, early release and resumable day close.
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
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import InventoryDate from '../models/InventoryDate.js';
import Folio from '../models/Folio.js';
import AuditLog from '../models/AuditLog.js';
import GuestProfile from '../models/GuestProfile.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import DayCloseRun from '../models/DayCloseRun.js';
import Company from '../models/Company.js';
import OperationLock from '../models/OperationLock.js';
import WorkItem from '../models/WorkItem.js';
import { businessDateOf } from '../services/frontDeskService.js';
import { completeCheckOut, postPendingNights } from '../services/departureService.js';
import { postNightsUntil } from '../services/roomCharges.js';
import { runDayClose } from '../services/financeService.js';

const startedAt = new Date().toISOString(), results = [];
const actor = { id: String(new mongoose.Types.ObjectId()), role: 'property_admin', name: 'Synthetic QA' };
const id = (v) => String(v?._id || v);
const plus = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const outcome = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: { message: e.message, status: e.status, code: e.code } }; } };
async function fixture({ roomsCount = 1, board = false, partial = false } = {}) {
  const property = await Property.create({ name: 'Synthetic departure QA', timezone: 'Asia/Jerusalem', vatRate: 18 });
  const propertyId = id(property), today = businessDateOf(property), arrival = plus(today, -1), departure = plus(today, 1);
  await Property.updateOne({ _id: propertyId }, { $set: { 'dayClose.lastClosedDate': plus(today, -1) } });
  const type = await RoomType.create({ property: propertyId, code: 'STD', name: 'Synthetic room', capacityMax: 4, baseRate: 500 });
  const guest = await GuestProfile.create({ property: propertyId, firstName: 'Synthetic', lastName: 'Guest' });
  const res = await Reservation.create({ property: propertyId, confirmationNumber: randomUUID(), primaryGuest: guest._id, roomType: type._id, arrivalDate: arrival, departureDate: departure, nights: 2, adults: 2, children: 0, roomsCount, status: partial ? 'partially_checked_in' : 'in_house', checkedInAt: new Date(), ratePerNight: 500, totalAmount: (board ? 1400 : 1000) * roomsCount, priceSnapshot: { nightly: [arrival, today].map((date) => ({ date, price: 500 })), total: (board ? 1400 : 1000) * roomsCount, ...(board ? { board: { type: 'half_board', source: 'supplement', nightly: [arrival, today].map((date) => ({ date, price: 200 })) } } : {}) } });
  const units = [], rooms = [];
  for (let i = 0; i < roomsCount; i++) {
    const room = await Room.create({ property: propertyId, roomType: type._id, number: String(101 + i), floor: 1, cleanStatus: 'clean', occStatus: i && partial ? 'vacant' : 'occupied' }); rooms.push(room);
    const unit = await ReservationRoom.create({ property: propertyId, reservation: res._id, roomTypeBooked: type._id, assignedRoom: room._id, arrivalDate: arrival, departureDate: departure, status: i && partial ? 'reserved' : 'in_house', nightlyRate: 500 }); units.push(unit);
    await StaySegment.create({ property: propertyId, reservation: res._id, reservationRoom: unit._id, roomType: type._id, room: room._id, fromDate: arrival, toDate: departure, ratePerNight: 500 });
  }
  res.assignedRoom = rooms[0]._id; await res.save();
  await InventoryDate.insertMany([arrival, today, departure].map((date) => ({ property: propertyId, roomType: type._id, date, physicalCount: 2, bookedCount: date < departure ? roomsCount : 0 })));
  const folio = await Folio.create({ property: propertyId, reservation: res._id, ownerType: 'guest', lines: [] });
  return { propertyId, today, arrival, departure, type, resId: id(res), units, rooms, folio };
}
async function state(f) {
  const value = {};
  for (const Model of [Reservation, ReservationRoom, StaySegment, InventoryDate, Room, Folio, HousekeepingTask, AuditLog]) value[Model.modelName] = (await Model.find({ property: f.propertyId }).sort({ _id: 1 }).lean()).map(({ createdAt, updatedAt, __v, ...doc }) => doc);
  return JSON.parse(JSON.stringify(value));
}
const checkout = (f, extra = {}) => completeCheckOut({ propertyId: f.propertyId, reservationId: f.resId, actor, early: { reason: 'Synthetic early departure' }, settlements: [{ folioId: id(f.folio), mode: 'approved_open', reason: 'Synthetic manager approval' }], ...extra });
const closeDay = (f) => runDayClose({ propertyId: f.propertyId, date: f.today, actor, reason: 'Synthetic day review', arrivals: 'keep' });
async function check(code, name, fn) { const evidence = {}; try { await fn(evidence); results.push({ code, name, status: 'passed', evidence }); console.log(`PASS ${code} ${name}`); } catch (e) { results.push({ code, name, status: 'failed', failure: e.message, evidence }); console.log(`FAIL ${code} ${name}: ${e.message.split('\n')[0]}`); } }
async function rollback(e, f, Model, method, fn, inject = () => true) {
  e.before = await state(f); const original = Model[method]; Model[method] = function (...args) { if (inject.apply(this, args)) throw new Error('QA_DEPARTURE_FAILURE'); return original.apply(this, args); };
  try { e.response = await outcome(fn); } finally { Model[method] = original; }
  e.after = await state(f); assert.equal(e.response.error?.message, 'QA_DEPARTURE_FAILURE'); assert.deepEqual(e.after, e.before);
}
let replica;
try {
  replica = await createAccountingTestReplica(); await mongoose.connect(replica.getUri(`departure_qa_${Date.now()}`)); await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await check('DP01', 'early departure inventory failure restores charges dates units and rooms', async (e) => { const f = await fixture(); await rollback(e, f, InventoryDate, 'updateMany', () => checkout(f), (_, u) => u?.$inc?.bookedCount < 0); });
  await check('DP02', 'failed checkout cleaning task leaves the entire stay in house', async (e) => { const f = await fixture(); await rollback(e, f, HousekeepingTask, 'create', () => checkout(f)); });
  await check('DP03', 'checkout audit failure rolls back posting settlement and departure', async (e) => { const f = await fixture(); await rollback(e, f, AuditLog, 'create', () => checkout(f), (entry) => (Array.isArray(entry) ? entry[0] : entry)?.action === 'reservation.check_out'); });
  await check('DP04', 'failed folio settlement save restores the physical stay and inventory', async (e) => { const f = await fixture(); await rollback(e, f, Folio.prototype, 'save', () => checkout(f), function () { return !!this.settlement?.mode; }); });
  await check('DP05', 'unknown unit in a mixed checkout selection rejects the whole request', async (e) => { const f = await fixture({ roomsCount: 2 }); e.before = await state(f); e.response = await outcome(() => checkout(f, { unitIds: [id(f.units[0]), id(new mongoose.Types.ObjectId())] })); e.after = await state(f); assert.equal(e.response.error?.status, 422); assert.deepEqual(e.after, e.before); });
  await check('DP06', 'duplicate checkout indexes cannot release a unit twice', async (e) => { const f = await fixture({ roomsCount: 2 }); e.before = await state(f); e.response = await outcome(() => checkout(f, { unitIndexes: [1, 1] })); e.after = await state(f); assert.equal(e.response.error?.status, 422); assert.deepEqual(e.after, e.before); });
  await check('DP07', 'departure keeps the reservation partial while a reserved sibling has not arrived', async (e) => { const f = await fixture({ roomsCount: 2, partial: true }); e.response = await outcome(() => checkout(f, { unitIds: [id(f.units[0])] })); e.after = await state(f); assert.equal(e.response.ok, true); assert.equal(e.response.value.status, 'partially_checked_out'); assert.equal(e.response.value.remainingUnits, 1); assert.equal(e.after.Folio[0].status, 'open'); });
  await check('DP08', 'successful early departure truncates stay segments and releases only unused nights', async (e) => { const f = await fixture(); e.response = await outcome(() => checkout(f)); e.after = await state(f); assert.equal(e.response.ok, true); assert.equal(e.after.StaySegment[0].toDate, f.today); assert.equal(e.after.InventoryDate.find((n) => n.date === f.today).bookedCount, 0); assert.equal(e.after.InventoryDate.find((n) => n.date === f.arrival).bookedCount, 1); });
  await check('DP09', 'credit check includes the nights that checkout is about to post', async (e) => {
    const f = await fixture(); const company = await Company.create({ property: f.propertyId, name: 'Synthetic company', creditLimit: 100 }); await Folio.updateOne({ _id: f.folio._id }, { $set: { ownerType: 'company', ownerRef: id(company) } }); e.before = await state(f);
    e.response = await outcome(() => checkout(f, { actor: { ...actor, role: 'receptionist' }, settlements: [{ folioId: id(f.folio), mode: 'company_ar' }] })); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('RF01', 'a missing meal line is recovered even when the room night was already posted', async (e) => {
    const f = await fixture({ board: true }); await Folio.updateOne({ _id: f.folio._id }, { $push: { lines: { type: 'charge', description: 'Synthetic existing night', department: 'rooms', serviceDate: f.arrival, reference: `night:${id(f.units[0])}:${f.arrival}`, amount: 500, taxAmount: 0, status: 'posted' } } });
    const res = await Reservation.findById(f.resId); e.posted = await postNightsUntil({ reservation: res, until: f.today }); const saved = await Folio.findById(f.folio._id).lean(); assert.equal(saved.lines.filter((l) => l.department === 'rooms').length, 1); assert.equal(saved.lines.filter((l) => l.department === 'board').length, 1);
  });
  await check('RF02', 'explicit zero nightly price is preserved rather than replaced by a flat fallback', async (e) => {
    const f = await fixture(); await Reservation.updateOne({ _id: f.resId }, { $set: { 'priceSnapshot.nightly.0.price': 0 } }); e.response = await outcome(() => postPendingNights({ propertyId: f.propertyId, reservationId: f.resId, actor })); const saved = await Folio.findById(f.folio._id).lean(); assert.equal(e.response.ok, true); assert.equal(saved.lines.reduce((s, l) => s + l.amount + l.taxAmount, 0), 0);
  });
  await check('DC01', 'day close failing after one routed folio can resume without leaving a half-posted stay', async (e) => {
    const f = await fixture({ roomsCount: 2 }); await ReservationRoom.updateOne({ _id: f.units[1]._id }, { $set: { roomPayer: 'guest' } }); const original = Folio.prototype.save;
    Folio.prototype.save = function (...args) { if (this.ownerType === 'room') throw new Error('QA_ROUTED_POST'); return original.apply(this, args); };
    try { e.first = await outcome(() => closeDay(f)); } finally { Folio.prototype.save = original; }
    const lines = (await Folio.find({ reservation: f.resId }).lean()).flatMap((f) => f.lines); assert.equal(lines.length, 0); e.second = await outcome(() => closeDay(f)); assert.equal(e.second.value?.status, 'done');
  });
  await check('DC02', 'failure recording the advance step cannot advance the property date', async (e) => {
    const f = await fixture(); const original = DayCloseRun.updateOne; let once = false;
    DayCloseRun.updateOne = function (filter, update, ...rest) { if (!once && filter['steps.key'] === 'advance' && update?.$set?.['steps.$.status'] === 'done') { once = true; throw new Error('QA_ADVANCE_STEP'); } return original.call(this, filter, update, ...rest); };
    try { e.first = await outcome(() => closeDay(f)); } finally { DayCloseRun.updateOne = original; }
    assert.equal((await Property.findById(f.propertyId)).dayClose.lastClosedDate, plus(f.today, -1)); e.second = await outcome(() => closeDay(f)); assert.equal(e.second.value?.status, 'done');
  });
  await check('DC03', 'failed completion audit leaves day close resumable without advancing the property', async (e) => {
    const f = await fixture(); const original = AuditLog.create; AuditLog.create = function (entry, ...rest) { if ((Array.isArray(entry) ? entry[0] : entry)?.action === 'day_close.completed') throw new Error('QA_DAY_AUDIT'); return original.call(this, entry, ...rest); };
    try { e.first = await outcome(() => closeDay(f)); } finally { AuditLog.create = original; }
    assert.equal((await Property.findById(f.propertyId)).dayClose.lastClosedDate, plus(f.today, -1)); e.second = await outcome(() => closeDay(f)); assert.equal(e.second.value?.status, 'done');
  });
  await check('DC04', 'two concurrent day closes produce one completed run and unique night references', async (e) => {
    const f = await fixture(); e.responses = await Promise.all([1, 2].map(() => outcome(() => closeDay(f)))); assert.equal(e.responses.filter((r) => r.value?.status === 'done').length, 1); const refs = (await Folio.findById(f.folio._id)).lines.map((l) => l.reference); assert.equal(refs.length, 2); assert.equal(new Set(refs).size, refs.length);
  });
  await check('DP10', 'concurrent early departures release inventory and create cleaning once', async (e) => {
    const f = await fixture(); e.responses = await Promise.all([1, 2].map(() => outcome(() => checkout(f)))); assert.equal(e.responses.filter((r) => r.ok).length, 1); assert.equal(await HousekeepingTask.countDocuments({ reservation: f.resId }), 1); assert.equal((await InventoryDate.findOne({ property: f.propertyId, date: f.today })).bookedCount, 0);
  });
  await check('DP11', 'expired checkout lease rolls back the full departure', async (e) => {
    const f = await fixture(); e.before = await state(f); const original = HousekeepingTask.create; let injected = false;
    HousekeepingTask.create = async function (...args) { const value = await original.apply(this, args); if (!injected) { injected = true; await OperationLock.updateMany({ key: `res:${f.resId}` }, { $set: { expiresAt: new Date(0) } }); } return value; };
    try { e.response = await outcome(() => checkout(f)); } finally { HousekeepingTask.create = original; }
    e.after = await state(f); assert.equal(e.response.error?.code, 'lock_expired'); assert.deepEqual(e.after, e.before);
  });
  await check('DP12', 'invalid indexes and simultaneous ID/index selection do not partially check out', async (e) => {
    const f = await fixture({ roomsCount: 2 }); e.before = await state(f); e.responses = [];
    for (const selection of [{ unitIndexes: [1, 99] }, { unitIndexes: [1.5] }, { unitIndexes: [1], unitIds: [id(f.units[0])] }]) e.responses.push(await outcome(() => checkout(f, selection)));
    e.after = await state(f); assert.ok(e.responses.every((r) => r.error?.status === 422)); assert.deepEqual(e.after, e.before);
  });
  await check('DP13', 'failure cleaning the second departing room restores the first room too', async (e) => {
    const f = await fixture({ roomsCount: 2 }); let creates = 0; await rollback(e, f, HousekeepingTask, 'create', () => checkout(f, { unitIds: f.units.map(id) }), () => ++creates === 2);
  });
  await check('RF03', 'posting-nights audit failure rolls back every new charge', async (e) => {
    const f = await fixture(); await rollback(e, f, AuditLog, 'create', () => postPendingNights({ propertyId: f.propertyId, reservationId: f.resId, actor }), (entry) => (Array.isArray(entry) ? entry[0] : entry)?.action === 'folio.nights_posted');
  });
  await check('DC05', 'lost post-nights checkpoint resumes without duplicate committed charges', async (e) => {
    const f = await fixture(); const original = DayCloseRun.updateOne; let injected = false;
    DayCloseRun.updateOne = function (filter, update, ...rest) { if (!injected && filter['steps.key'] === 'post_nights' && update?.$set?.['steps.$.status'] === 'done') { injected = true; throw new Error('QA_POST_CHECKPOINT'); } return original.call(this, filter, update, ...rest); };
    try { e.first = await outcome(() => closeDay(f)); } finally { DayCloseRun.updateOne = original; }
    assert.equal(e.first.value?.status, 'failed'); assert.equal((await Folio.findById(f.folio._id)).lines.length, 2); e.second = await outcome(() => closeDay(f)); assert.equal(e.second.value?.status, 'done'); assert.equal((await Folio.findById(f.folio._id)).lines.length, 2);
  });
  await check('DC06', 'checkout racing day close posts the last used night once', async (e) => {
    const f = await fixture(); await Reservation.updateOne({ _id: f.resId }, { $set: { departureDate: f.today } }); await ReservationRoom.updateMany({ reservation: f.resId }, { $set: { departureDate: f.today } });
    e.responses = await Promise.all([outcome(() => checkout(f)), outcome(() => closeDay(f))]); assert.ok(e.responses.every((r) => r.ok)); assert.equal(e.responses[1].value.status, 'done'); const refs = (await Folio.findById(f.folio._id)).lines.map((l) => l.reference); assert.equal(refs.length, 1); assert.equal(new Set(refs).size, 1);
  });
  await check('DC07', 'future or out-of-order day close creates no run or charges', async (e) => {
    const f = await fixture(); e.before = await state(f); e.response = await outcome(() => runDayClose({ propertyId: f.propertyId, date: plus(f.today, 1), actor })); e.after = await state(f); assert.equal(e.response.error?.code, 'out_of_order'); assert.deepEqual(e.after, e.before); assert.equal(await DayCloseRun.countDocuments({ property: f.propertyId }), 0);
  });
  await check('DC08', 'expired day-close owner cannot advance or overwrite a checkpoint and stale run can resume', async (e) => {
    const f = await fixture(); const original = DayCloseRun.updateOne; let injected = false;
    DayCloseRun.updateOne = async function (filter, update, ...rest) { const value = await original.call(this, filter, update, ...rest); if (!injected && filter['steps.key'] === 'post_nights' && update?.$set?.['steps.$.status'] === 'done') { injected = true; await OperationLock.updateMany({ key: `dayclose:${f.propertyId}` }, { $set: { expiresAt: new Date(0) } }); } return value; };
    try { e.first = await outcome(() => closeDay(f)); } finally { DayCloseRun.updateOne = original; }
    assert.equal(e.first.error?.code, 'lock_expired'); assert.equal((await Property.findById(f.propertyId)).dayClose.lastClosedDate, plus(f.today, -1));
    await DayCloseRun.updateOne({ property: f.propertyId }, { $set: { heartbeatAt: new Date(Date.now() - 11 * 60000) } });
    e.second = await outcome(() => closeDay(f)); assert.equal(e.second.value?.status, 'done'); assert.equal((await Folio.findById(f.folio._id)).lines.length, 2);
  });
  await check('DP14', 'a foreign physical room reference cannot create a cross-property cleaning task', async (e) => {
    const f = await fixture(), other = await fixture(); await Reservation.updateOne({ _id: f.resId }, { $set: { assignedRoom: other.rooms[0]._id } }); await ReservationRoom.updateOne({ _id: f.units[0]._id }, { $set: { assignedRoom: other.rooms[0]._id } });
    e.before = await state(f); e.response = await outcome(() => checkout(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before); assert.equal((await Room.findById(other.rooms[0]._id)).occStatus, 'occupied');
  });
  await check('DP15', 'blocked room-payer checkout leaves no new folio or charges', async (e) => {
    const f = await fixture(); await ReservationRoom.updateOne({ _id: f.units[0]._id }, { $set: { roomPayer: 'guest' } }); e.before = await state(f); e.response = await outcome(() => checkout(f, { actor: { ...actor, role: 'receptionist' }, settlements: [] })); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('DC09', 'failure saving an urgent ledger warning cannot silently complete day close', async (e) => {
    const f = await fixture(); const original = WorkItem.create;
    await Folio.updateOne({ _id: f.folio._id }, { $push: { lines: { type: 'charge', description: 'Synthetic unmapped revenue', department: 'qa_unmapped', amount: 1, taxAmount: 0, status: 'posted', serviceDate: f.today } } });
    WorkItem.create = function (entry, ...rest) { if (String((Array.isArray(entry) ? entry[0] : entry)?.dedupeKey).startsWith('ledger:')) throw new Error('QA_LEDGER_WARNING'); return original.call(this, entry, ...rest); };
    try { e.first = await outcome(() => closeDay(f)); } finally { WorkItem.create = original; }
    assert.equal(e.first.value?.status, 'failed'); assert.equal((await Property.findById(f.propertyId)).dayClose.lastClosedDate, plus(f.today, -1)); e.second = await outcome(() => closeDay(f)); assert.equal(e.second.value?.status, 'done'); assert.equal(await WorkItem.countDocuments({ property: f.propertyId, dedupeKey: `ledger:${f.today}` }), 1);
  });
} catch (e) { results.push({ code: 'INFRA', status: 'blocked', failure: e.message }); console.error(e.message); }
finally {
  await mongoose.disconnect(); if (replica) await replica.stop();
  const dir = fileURLToPath(new URL('../../docs/product-readiness/evidence/', import.meta.url)); await mkdir(dir, { recursive: true });
  const paths = ['../services/departureService.js', '../services/financeService.js', '../services/roomCharges.js', '../services/touristService.js', '../services/stayTransaction.js', '../services/locks.js', '../services/platformService.js', '../services/auditService.js', '../services/frontDeskService.js', './departureReadiness.mjs'];
  const report = { startedAt, finishedAt: new Date().toISOString(), mode: 'isolated local replica; synthetic fixtures; no external delivery', hashes: Object.fromEntries(paths.map((p) => [p, createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex')])), counts: { passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length, blocked: results.filter((r) => r.status === 'blocked').length }, results };
  const body = JSON.stringify(report, null, 2) + '\n'; await writeFile(`${dir}/departure-${startedAt.replace(/[:.]/g, '-')}.json`, body); await writeFile(`${dir}/departure-latest.json`, body); console.log(JSON.stringify(report.counts)); if (report.counts.failed || report.counts.blocked) process.exitCode = 1;
}
