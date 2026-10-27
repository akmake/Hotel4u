// Party and legacy creation audit. New local replica, synthetic data, no .env.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
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
import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';
import PartyBookingOperation from '../models/PartyBookingOperation.js';
import Company from '../models/Company.js';
import OperationLock from '../models/OperationLock.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { businessDateOf } from '../services/frontDeskService.js';
import { createParty } from '../services/partyBookingService.js';
import { createReservation } from '../services/reservationService.js';
import reservationsRouter from '../routes/reservations.js';

const startedAt = new Date().toISOString(), results = [];
const actor = { id: String(new mongoose.Types.ObjectId()), role: 'property_admin', name: 'Synthetic QA' };
const id = (v) => String(v?._id || v);
const plus = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const outcome = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: { message: e.message, status: e.status, code: e.code } }; } };
async function fixture() {
  const p = await Property.create({ name: 'Synthetic party QA', reservationPrefix: randomUUID().slice(0, 8), timezone: 'Asia/Jerusalem', vatRate: 18 });
  const propertyId = id(p), today = businessDateOf(p), departure = plus(today, 2);
  const type = await RoomType.create({ property: propertyId, code: 'STD', name: 'Synthetic standard', baseRate: 500, capacityMax: 4, adultsMax: 4 });
  const secondType = await RoomType.create({ property: propertyId, code: 'FAM', name: 'Synthetic family', baseRate: 800, capacityMax: 6, adultsMax: 6 });
  const rooms = [];
  for (let i = 0; i < 4; i++) rooms.push(await Room.create({ property: propertyId, roomType: i < 2 ? type._id : secondType._id, number: String(101 + i), floor: 1, cleanStatus: 'clean' }));
  const plan = await RatePlan.create({ property: propertyId, code: 'BAR', name: 'Synthetic rate', isRefundable: true });
  for (const t of [type, secondType]) {
    await InventoryDate.insertMany([0, 1].map((n) => ({ property: propertyId, roomType: t._id, date: plus(today, n), physicalCount: 2 })));
    await RateDate.insertMany([0, 1].map((n) => ({ ratePlan: plan._id, roomType: t._id, date: plus(today, n), price: t.baseRate })));
  }
  const guest = await GuestProfile.create({ property: propertyId, firstName: 'Synthetic', lastName: 'Guest' });
  const line = { roomTypeId: id(type), ratePlanId: id(plan), adults: 2, children: 0 };
  const input = { arrival: today, departure, guestId: id(guest), mode: 'confirm', idempotencyKey: randomUUID(), lines: [{ ...line }, { ...line }] };
  return { propertyId, p, today, departure, type, secondType, plan, rooms, guest, line, input };
}
const party = (f, input = f.input) => createParty({ propertyId: f.propertyId, input, actor });
const legacy = (f, extra = {}) => ({ propertyId: f.propertyId, actorId: actor.id, actorName: actor.name, data: { roomTypeId: id(f.type), ratePlanId: id(f.plan), primaryGuestId: id(f.guest), arrivalDate: f.today, departureDate: f.departure, adults: 2, children: 0, roomsCount: 1, ratePerNight: 500, idempotencyKey: f.input.idempotencyKey, ...extra } });
async function state(f) {
  const read = async (model, project) => (await model.find({ property: f.propertyId }).sort({ _id: 1 }).lean()).map(project);
  return {
    reservations: await read(Reservation, (r) => ({ id: id(r), key: r.idempotencyKey, status: r.status, room: id(r.assignedRoom), total: r.totalAmount, party: r.party })),
    units: await read(ReservationRoom, (r) => ({ id: id(r), reservation: id(r.reservation), room: id(r.assignedRoom), status: r.status })),
    segments: await read(StaySegment, (r) => ({ id: id(r), reservation: id(r.reservation), room: id(r.room), from: r.fromDate, to: r.toDate })),
    rooms: await read(Room, (r) => ({ id: id(r), occupancy: r.occStatus, clean: r.cleanStatus })),
    inventory: await read(InventoryDate, (r) => ({ type: id(r.roomType), date: r.date, booked: r.bookedCount })),
    guests: await GuestProfile.countDocuments({ property: f.propertyId }),
    folios: await Folio.countDocuments({ property: f.propertyId }),
    audit: await AuditLog.countDocuments({ property: f.propertyId }),
    channels: await ChannelUpdateQueue.countDocuments({ property: f.propertyId }),
    operations: await PartyBookingOperation.countDocuments({ property: f.propertyId }),
  };
}
async function check(code, name, fn) {
  const evidence = {};
  try { await fn(evidence); results.push({ code, name, status: 'passed', evidence }); console.log(`PASS ${code} ${name}`); }
  catch (e) { results.push({ code, name, status: 'failed', failure: e.message, evidence }); console.log(`FAIL ${code} ${name}: ${e.message.split('\n')[0]}`); }
}

let replica, server;
async function routeCall(f, path, body) {
  if (server) { await new Promise((resolve) => server.close(resolve)); server = null; }
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.actor = { ...actor, propertyId: f.propertyId }; next(); }); app.use('/reservations', reservationsRouter);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/reservations${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}
try {
  replica = await createAccountingTestReplica(); await mongoose.connect(replica.getUri(`party_qa_${Date.now()}`));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await check('PT01', 'two-room party has distinct rooms, linked members and correct stock', async (e) => {
    const f = await fixture(); e.response = await outcome(() => party(f)); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.reservations.length, 2);
    assert.equal(new Set(e.after.units.map((u) => u.room)).size, 2);
    assert.ok(e.after.reservations.every((r) => r.party?.size === 2));
    assert.ok(e.after.inventory.filter((i) => i.type === id(f.type)).every((i) => i.booked === 2));
  });
  await check('PT02', 'retry with fewer party lines cannot return a subset as duplicate success', async (e) => {
    const f = await fixture(); await party(f); e.before = await state(f);
    e.response = await outcome(() => party(f, { ...f.input, lines: [f.input.lines[0]] })); e.after = await state(f);
    assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('PT03', 'retry with changed party occupancy is rejected', async (e) => {
    const f = await fixture(); await party(f); e.before = await state(f);
    e.response = await outcome(() => party(f, { ...f.input, lines: [{ ...f.line, adults: 3 }, { ...f.line }] })); e.after = await state(f);
    assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('PT04', 'failure linking members leaves no partial party', async (e) => {
    const f = await fixture(); e.before = await state(f); let links = 0;
    const original = Reservation.updateOne;
    Reservation.updateOne = function (filter, update, ...rest) { if (update?.$set?.party && ++links === 2) throw new Error('QA_PARTY_LINK'); return original.call(this, filter, update, ...rest); };
    try { e.response = await outcome(() => party(f)); } finally { Reservation.updateOne = original; }
    e.after = await state(f); assert.equal(e.response.ok, false); assert.deepEqual(e.after, e.before);
  });
  await check('PT05', 'failed final party audit rolls back every member', async (e) => {
    const f = await fixture(); e.before = await state(f); const original = AuditLog.create;
    AuditLog.create = function (entries, ...rest) { if ((Array.isArray(entries) ? entries[0] : entries)?.action === 'reservation.party_created') throw new Error('QA_PARTY_AUDIT'); return original.call(this, entries, ...rest); };
    try { e.response = await outcome(() => party(f)); } finally { AuditLog.create = original; }
    e.after = await state(f); assert.equal(e.response.ok, false); assert.deepEqual(e.after, e.before);
  });
  await check('PT06', 'invalid second line leaves no first member, segments or newly created guest', async (e) => {
    const f = await fixture(); e.before = await state(f);
    e.response = await outcome(() => party(f, { ...f.input, guestId: undefined, newGuest: { firstName: 'New synthetic', lastName: 'Guest', phone: '+15550000001' }, lines: [{ ...f.line }, { ...f.line, children: 1 }] }));
    e.after = await state(f); assert.equal(e.response.ok, false); assert.deepEqual(e.after, e.before);
  });
  await check('PT07', 'identical concurrent party calls identify one completed operation', async (e) => {
    const f = await fixture(); e.responses = await Promise.all([1, 2].map(() => outcome(() => party(f)))); e.after = await state(f);
    assert.equal(e.responses.every((r) => r.ok), true);
    assert.equal(e.responses.filter((r) => r.value.duplicate).length, 1);
    assert.equal(e.after.reservations.length, 2); assert.equal(new Set(e.after.units.map((u) => u.room)).size, 2);
  });
  await check('PT08', 'legacy creation rolls back when stay-segment insertion fails', async (e) => {
    const f = await fixture(); e.before = await state(f); const original = StaySegment.insertMany;
    StaySegment.insertMany = () => { throw new Error('QA_LEGACY_SEGMENTS'); };
    try { e.response = await outcome(() => createReservation(legacy(f))); } finally { StaySegment.insertMany = original; }
    e.after = await state(f); assert.equal(e.response.ok, false); assert.deepEqual(e.after, e.before);
  });
  await check('PT09', 'legacy same operation key cannot silently accept changed price', async (e) => {
    const f = await fixture(); await createReservation(legacy(f)); e.before = await state(f);
    e.response = await outcome(() => createReservation(legacy(f, { ratePerNight: 700 }))); e.after = await state(f);
    assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('PT10', 'legacy draft creation is atomic even though it reserves no stock', async (e) => {
    const f = await fixture(); e.before = await state(f); const original = StaySegment.insertMany;
    StaySegment.insertMany = () => { throw new Error('QA_LEGACY_DRAFT'); };
    try { e.response = await outcome(() => createReservation(legacy(f, { bookingStatus: 'draft' }))); } finally { StaySegment.insertMany = original; }
    e.after = await state(f); assert.equal(e.response.ok, false); assert.deepEqual(e.after, e.before);
  });
  await check('PT11', 'automatic first line does not consume the room requested for the second line', async (e) => {
    const f = await fixture(); const requested = id(f.rooms[0]);
    e.response = await outcome(() => party(f, { ...f.input, lines: [{ ...f.line }, { ...f.line, roomId: requested }] })); e.after = await state(f);
    assert.equal(e.response.ok, true);
    const second = e.after.reservations.find((r) => r.party?.index === 2);
    assert.equal(second.room, requested); assert.equal(e.response.value.assignments.find((a) => a.line === 1)?.ok, true);
  });
  await check('PT12', 'multi-type party failure leaves both inventories unchanged', async (e) => {
    const f = await fixture(); e.before = await state(f); let links = 0; const original = Reservation.updateOne;
    Reservation.updateOne = function (filter, update, ...rest) { if (update?.$set?.party && ++links === 2) throw new Error('QA_MULTI_TYPE_LINK'); return original.call(this, filter, update, ...rest); };
    try { e.response = await outcome(() => party(f, { ...f.input, lines: [{ ...f.line }, { ...f.line, roomTypeId: id(f.secondType) }] })); } finally { Reservation.updateOne = original; }
    e.after = await state(f); assert.equal(e.response.ok, false); assert.deepEqual(e.after, e.before);
  });
  await check('PT13', 'legacy price quote uses configured VAT and the same inclusive total as creation', async (e) => {
    const f = await fixture(); const app = express(); app.use(express.json());
    // Route boundary test; authentication itself is covered by isolated regressions.
    app.use((req, res, next) => { req.actor = { ...actor, propertyId: f.propertyId }; next(); }); app.use('/reservations', reservationsRouter);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/reservations/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: f.propertyId, ...legacy(f).data }), signal: AbortSignal.timeout(10000) });
    e.status = response.status; e.body = await response.json();
    assert.equal(e.status, 200); assert.equal(e.body.data.total, 1000); assert.equal(e.body.data.taxAmount, 152.54); assert.equal(e.body.data.subtotal, 847.46);
  });
  await check('PT14', 'failure saving the party result rolls back everything and permits a clean retry', async (e) => {
    const f = await fixture(); e.before = await state(f); const original = PartyBookingOperation.create;
    PartyBookingOperation.create = () => { throw new Error('QA_PARTY_RESULT'); };
    try { e.failure = await outcome(() => party(f)); } finally { PartyBookingOperation.create = original; }
    e.afterFailure = await state(f); assert.equal(e.failure.error?.message, 'QA_PARTY_RESULT'); assert.deepEqual(e.afterFailure, e.before);
    e.retry = await outcome(() => party(f)); assert.equal(e.retry.ok, true); assert.equal(await PartyBookingOperation.countDocuments({ property: f.propertyId }), 1);
  });
  await check('PT15', 'legacy single-room creation and a party cannot oversell the same two rooms', async (e) => {
    const f = await fixture();
    e.responses = await Promise.all([outcome(() => party(f)), outcome(() => createReservation(legacy(f, { idempotencyKey: randomUUID() })))]);
    e.after = await state(f); assert.equal(e.responses.filter((r) => r.ok).length, 1);
    assert.ok(e.after.reservations.length >= 1 && e.after.reservations.length <= 2);
    assert.equal(new Set(e.after.units.map((u) => u.room)).size, e.after.reservations.length);
    assert.ok(e.after.inventory.filter((i) => i.type === id(f.type)).every((i) => i.booked === e.after.reservations.length));
  });
  await check('PT16', 'concurrent identical legacy requests create only one reservation', async (e) => {
    const f = await fixture(); e.responses = await Promise.all([1, 2].map(() => outcome(() => createReservation(legacy(f))))); e.after = await state(f);
    assert.equal(e.responses.every((r) => r.ok), true); assert.equal(e.after.reservations.length, 1);
    assert.equal(new Set(e.responses.map((r) => id(r.value))).size, 1);
    assert.ok(e.after.inventory.filter((i) => i.type === id(f.type)).every((i) => i.booked === 1));
  });
  await check('PT17', 'saved legacy quote retries do not change identity because of a generated expiry', async (e) => {
    const f = await fixture(), body = { propertyId: f.propertyId, ...legacy(f).data, bookingStatus: 'quote' };
    e.first = await routeCall(f, '/quote/save', body); e.before = await state(f);
    e.retry = await routeCall(f, '/quote/save', body); e.after = await state(f);
    assert.equal(e.first.status, 201); assert.equal(e.retry.status, 201);
    assert.equal(e.first.body.data._id, e.retry.body.data._id); assert.deepEqual(e.after, e.before);
  });
  await check('PT18', 'invalid legacy creation input returns a validation error without writing', async (e) => {
    const f = await fixture(); e.before = await state(f);
    e.response = await routeCall(f, '/', { propertyId: f.propertyId }); e.after = await state(f);
    assert.equal(e.response.status, 400); assert.deepEqual(e.after, e.before);
    e.malformedParty = await outcome(() => party(f, { ...f.input, lines: [null] }));
    assert.equal(e.malformedParty.error?.status, 422); assert.deepEqual(await state(f), e.before);
  });
  await check('PT19', 'legacy creation cannot link a guest from another property', async (e) => {
    const f = await fixture(), other = await fixture(); e.before = await state(f);
    e.response = await outcome(() => createReservation(legacy(f, { primaryGuestId: id(other.guest) }))); e.after = await state(f);
    assert.equal(e.response.ok, false); assert.deepEqual(e.after, e.before);
  });
  await check('PT20', 'foreign room type, rate plan or company cannot be referenced even with overbooking', async (e) => {
    const f = await fixture(), other = await fixture(); const company = await Company.create({ property: other.propertyId, name: 'Other synthetic company' });
    e.before = await state(f); e.responses = [];
    for (const change of [{ roomTypeId: id(other.type), allowOverbooking: true }, { ratePlanId: id(other.plan) }, { companyId: id(company) }]) e.responses.push(await outcome(() => createReservation(legacy(f, change))));
    e.after = await state(f); assert.equal(e.responses.every((r) => !r.ok && r.error.status === 422), true); assert.deepEqual(e.after, e.before);
  });
  await check('PT21', 'legacy creation without an operation key remains atomic and allocates distinct rooms', async (e) => {
    const f = await fixture(); e.responses = [];
    for (let i = 0; i < 2; i++) e.responses.push(await outcome(() => createReservation(legacy(f, { idempotencyKey: undefined }))));
    e.after = await state(f); assert.equal(e.responses.every((r) => r.ok), true);
    assert.equal(e.after.reservations.length, 2); assert.equal(new Set(e.after.units.map((u) => u.room)).size, 2);
  });
  await check('PT22', 'expired party lease cannot commit any member or operation result', async (e) => {
    const f = await fixture(); e.before = await state(f); const original = Reservation.updateOne; let injected = false;
    Reservation.updateOne = async function (filter, update, ...rest) {
      const value = await original.call(this, filter, update, ...rest);
      if (update?.$set?.party && !injected) { injected = true; await OperationLock.updateMany({ key: `party:${f.propertyId}:${f.input.idempotencyKey}` }, { $set: { expiresAt: new Date(0) } }); }
      return value;
    };
    try { e.response = await outcome(() => party(f)); } finally { Reservation.updateOne = original; }
    e.after = await state(f); assert.equal(e.response.error?.code, 'lock_expired'); assert.deepEqual(e.after, e.before);
  });
  await check('PT23', 'fractional room or guest counts are refused before legacy creation', async (e) => {
    const f = await fixture(); e.before = await state(f); e.responses = [];
    for (const change of [{ roomsCount: 1.5 }, { adults: 1.5 }, { children: 0.5 }]) e.responses.push(await outcome(() => createReservation(legacy(f, { ...change, idempotencyKey: randomUUID() }))));
    e.after = await state(f); assert.equal(e.responses.every((r) => !r.ok && r.error.status === 422), true); assert.deepEqual(e.after, e.before);
  });
} catch (e) { results.push({ code: 'INFRA', status: 'blocked', failure: e.message }); console.error(e.message); }
finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect(); if (replica) await replica.stop();
  const dir = fileURLToPath(new URL('../../docs/product-readiness/evidence/', import.meta.url)); await mkdir(dir, { recursive: true });
  const hash = (p) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');
  const paths = ['../services/partyBookingService.js', '../services/reservationService.js', '../services/bookingService.js', '../services/availabilityService.js', '../services/stayTransaction.js', '../services/locks.js', '../services/channelQueueService.js', '../services/auditService.js', '../models/PartyBookingOperation.js', '../models/Reservation.js', '../routes/reservations.js', './partyReadiness.mjs'];
  const report = { startedAt, finishedAt: new Date().toISOString(), mode: 'isolated local replica; synthetic fixtures; no external delivery; quote test at route boundary', hashes: Object.fromEntries(paths.map((p) => [p, hash(p)])), counts: { passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length, blocked: results.filter((r) => r.status === 'blocked').length }, results };
  const serialized = JSON.stringify(report, null, 2) + '\n';
  await writeFile(`${dir}/party-${startedAt.replace(/[:.]/g, '-')}.json`, serialized); await writeFile(`${dir}/party-latest.json`, serialized);
  console.log(JSON.stringify(report.counts)); if (report.counts.failed || report.counts.blocked) process.exitCode = 1;
}
