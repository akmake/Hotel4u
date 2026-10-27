// Booking -> arrival audit, using synthetic fixtures in a new local replica only.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
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
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import AuditLog from '../models/AuditLog.js';
import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';
import OperationLock from '../models/OperationLock.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { createBooking } from '../services/bookingService.js';
import { businessDateOf, completeCheckIn, saveRegistration, getCheckInContext } from '../services/frontDeskService.js';

const startedAt = new Date().toISOString(), results = [];
const actor = { id: String(new mongoose.Types.ObjectId()), name: 'Synthetic QA', role: 'property_admin' };
const id = (v) => String(v?._id || v);
const plus = (d, n) => { const date = new Date(`${d}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + n); return date.toISOString().slice(0, 10); };
const outcome = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: { message: e.message, code: e.code, status: e.status } }; } };

async function fixture({ rooms = 1, registration = false, guarantee = false, book = true } = {}) {
  const p = await Property.create({ name: 'Synthetic arrival QA', reservationPrefix: randomUUID().slice(0, 8), timezone: 'Asia/Jerusalem', checkInPolicy: { requireRegistration: registration, requireGuarantee: guarantee } });
  const today = businessDateOf(p), departure = plus(today, 2), propertyId = id(p);
  const type = await RoomType.create({ property: propertyId, code: 'STD', name: 'Synthetic standard', baseRate: 500, capacityMax: 4, adultsMax: 4 });
  const physical = [];
  for (let i = 0; i < 4; i++) physical.push(await Room.create({ property: propertyId, roomType: type._id, number: String(101 + i), floor: 1, cleanStatus: 'clean' }));
  const plan = await RatePlan.create({ property: propertyId, code: 'BAR', name: 'Synthetic rate', isRefundable: true });
  await InventoryDate.insertMany([0, 1].map((n) => ({ property: propertyId, roomType: type._id, date: plus(today, n), physicalCount: 4 })));
  await RateDate.insertMany([0, 1].map((n) => ({ ratePlan: plan._id, roomType: type._id, date: plus(today, n), price: 500 })));
  const guest = await GuestProfile.create({ property: propertyId, firstName: 'Synthetic', lastName: 'Guest', email: `qa-${randomUUID()}@example.invalid` });
  const input = { mode: 'confirm', idempotencyKey: randomUUID(), arrival: today, departure, adults: Math.max(2, rooms), children: 0, rooms, roomTypeId: id(type), ratePlanId: id(plan), guestId: id(guest) };
  const f = { p, propertyId, today, departure, type, plan, physical, guest, input };
  if (book) {
    f.booking = await createBooking({ propertyId, input, actor });
    f.res = await Reservation.findById(f.booking.id);
    f.units = await ReservationRoom.find({ reservation: f.res._id }).sort({ createdAt: 1, _id: 1 });
  }
  return f;
}

async function snapshot(f) {
    const [reservations, units, segments, inventory, rooms, guests, queues, folios, auditCount, channelCount] = await Promise.all([
    Reservation.find({ property: f.propertyId }).sort({ _id: 1 }).lean(),
    ReservationRoom.find({ property: f.propertyId }).sort({ _id: 1 }).lean(),
    StaySegment.find({ property: f.propertyId }).sort({ _id: 1 }).lean(),
    InventoryDate.find({ property: f.propertyId }).sort({ date: 1 }).lean(),
    Room.find({ property: f.propertyId }).sort({ number: 1 }).lean(),
    GuestProfile.find({ property: f.propertyId }).sort({ _id: 1 }).lean(),
    ArrivalQueueEntry.find({ property: f.propertyId }).sort({ _id: 1 }).lean(),
    Folio.find({ property: f.propertyId }).sort({ _id: 1 }).lean(),
    AuditLog.countDocuments({ property: f.propertyId }),
    ChannelUpdateQueue.countDocuments({ property: f.propertyId }),
  ]);
  return {
    auditCount, channelCount,
    reservations: reservations.map((r) => ({ id: id(r), status: r.status, room: id(r.assignedRoom), total: r.totalAmount, guarantee: r.guaranteeType, checkedInAt: r.checkedInAt, snapshot: r.priceSnapshot })),
    units: units.map((u) => ({ id: id(u), room: id(u.assignedRoom), status: u.status, guarantee: u.guaranteeType })),
    segments: segments.map((s) => ({ id: id(s), room: id(s.room), from: s.fromDate, to: s.toDate })),
    inventory: inventory.map((i) => ({ date: i.date, booked: i.bookedCount })),
    rooms: rooms.map((r) => ({ number: r.number, occupancy: r.occStatus, clean: r.cleanStatus })),
    guests: guests.map((g) => ({ id: id(g), stays: g.totalStays, revenue: g.totalRevenue })),
    queues: queues.map((q) => ({ id: id(q), unit: id(q.reservationRoom), status: q.status })),
    folios: folios.map((f) => ({ id: id(f), reservation: id(f.reservation), lines: f.lines.map((l) => ({ type: l.type, amount: l.amount, status: l.status })) })),
  };
}
const enter = (f, extra = {}) => completeCheckIn({ propertyId: f.propertyId, reservationId: id(f.res), actor, ...extra });
async function check(code, name, fn) {
  const evidence = {};
  try { await fn(evidence); results.push({ code, name, status: 'passed', evidence }); console.log(`PASS ${code} ${name}`); }
  catch (e) { results.push({ code, name, status: 'failed', failure: e.message, evidence }); console.log(`FAIL ${code} ${name}: ${e.message.split('\n')[0]}`); }
}

let replica;
try {
  replica = await createAccountingTestReplica();
  await mongoose.connect(replica.getUri(`arrival_qa_${Date.now()}`));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

  await check('AR01', 'booking registration partial deposit and entry keep outstanding amount', async (e) => {
    const f = await fixture({ registration: true, guarantee: true });
    await saveRegistration({ propertyId: f.propertyId, reservationId: id(f.res), actor, input: { firstName: 'Synthetic', lastName: 'Guest', dateOfBirth: '1990-01-01', nationality: 'IL', idDocType: 'passport', idDocNumber: 'QA1234567', idVerified: true } });
    // Posted operational deposit fixture; this does not test external payment capture.
    await Folio.updateOne({ reservation: f.res._id }, { $push: { lines: { type: 'deposit', amount: -200, taxAmount: 0, description: 'Synthetic deposit', serviceDate: f.today, status: 'posted' } } });
    e.context = await getCheckInContext({ propertyId: f.propertyId, reservationId: id(f.res) });
    e.response = await outcome(() => enter(f, { guarantee: { method: 'deposit' } })); e.after = await snapshot(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.reservations[0].status, 'in_house');
    assert.equal(e.after.reservations[0].total, 1000); assert.equal(e.after.guests[0].stays, 1);
    assert.equal(e.after.folios[0].lines.reduce((s, l) => s + l.amount, 0), -200);
    assert.notEqual((await Reservation.findById(f.res._id)).paymentStatus, 'paid');
  });

  await check('AR02', 'partial entry followed by cleaned room counts the stay once', async (e) => {
    const f = await fixture({ rooms: 2 });
    await Room.updateOne({ _id: f.units[1].assignedRoom }, { $set: { cleanStatus: 'dirty' } });
    e.blocked = await outcome(() => enter(f, { unitIds: f.units.map(id) })); assert.equal(e.blocked.error?.status, 409);
    e.first = await outcome(() => enter(f, { unitIds: [id(f.units[0])] })); e.mid = await snapshot(f);
    assert.equal(e.first.ok, true); assert.equal(e.mid.reservations[0].status, 'partially_checked_in');
    await Room.updateOne({ _id: f.units[1].assignedRoom }, { $set: { cleanStatus: 'clean' } });
    e.second = await outcome(() => enter(f, { unitIds: [id(f.units[1])] })); e.after = await snapshot(f);
    assert.equal(e.second.ok, true); assert.equal(e.after.reservations[0].status, 'in_house'); assert.equal(e.after.guests[0].stays, 1);
  });

  await check('AR03', 'same booking key with changed guest count is rejected', async (e) => {
    const f = await fixture(); e.before = await snapshot(f);
    e.response = await outcome(() => createBooking({ propertyId: f.propertyId, actor, input: { ...f.input, adults: 3 } })); e.after = await snapshot(f);
    assert.equal(e.response.ok, false, 'Changed booking request returned duplicate success'); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });

  await check('AR04', 'failure saving frozen booking price leaves no partial booking', async (e) => {
    const f = await fixture({ book: false }); e.before = await snapshot(f);
    const original = Reservation.updateOne;
    Reservation.updateOne = function (filter, update, ...rest) { if (update?.$set?.priceSnapshot) throw new Error('QA_BOOKING_SNAPSHOT'); return original.call(this, filter, update, ...rest); };
    try { e.response = await outcome(() => createBooking({ propertyId: f.propertyId, input: f.input, actor })); } finally { Reservation.updateOne = original; }
    e.after = await snapshot(f); assert.equal(e.response.error?.message, 'QA_BOOKING_SNAPSHOT'); assert.deepEqual(e.after, e.before, 'Booking, stock or units remained after price snapshot failure');
  });

  await check('AR05', 'failure creating booking segments leaves no partial booking', async (e) => {
    const f = await fixture({ book: false }); e.before = await snapshot(f);
    const original = StaySegment.insertMany; StaySegment.insertMany = () => { throw new Error('QA_BOOKING_SEGMENTS'); };
    try { e.response = await outcome(() => createBooking({ propertyId: f.propertyId, input: f.input, actor })); } finally { StaySegment.insertMany = original; }
    e.after = await snapshot(f); assert.equal(e.response.error?.message, 'QA_BOOKING_SEGMENTS'); assert.deepEqual(e.after, e.before, 'Booking, folio or inventory remained without stay segments');
  });

  await check('AR06', 'single-room entry rolls back when occupancy update fails', async (e) => {
    const f = await fixture(); e.before = await snapshot(f);
    const original = Room.findByIdAndUpdate; Room.findByIdAndUpdate = () => { throw new Error('QA_CHECKIN_ROOM'); };
    try { e.response = await outcome(() => enter(f)); } finally { Room.findByIdAndUpdate = original; }
    e.after = await snapshot(f); assert.equal(e.response.error?.message, 'QA_CHECKIN_ROOM'); assert.deepEqual(e.after, e.before, 'Reservation entered while unit/room did not');
  });

  await check('AR07', 'multi-room entry rolls back when guest statistics update fails', async (e) => {
    const f = await fixture({ rooms: 2 }); e.before = await snapshot(f);
    const original = GuestProfile.findByIdAndUpdate; GuestProfile.findByIdAndUpdate = () => { throw new Error('QA_CHECKIN_GUEST'); };
    try { e.response = await outcome(() => enter(f, { unitIds: f.units.map(id) })); } finally { GuestProfile.findByIdAndUpdate = original; }
    e.after = await snapshot(f); assert.equal(e.response.error?.message, 'QA_CHECKIN_GUEST'); assert.deepEqual(e.after, e.before, 'Units and rooms entered despite failed check-in');
  });

  await check('AR08', 'failed queue resolution does not leave an entered guest still waiting', async (e) => {
    const f = await fixture();
    await ArrivalQueueEntry.create({ property: f.propertyId, reservation: f.res._id, reservationRoom: f.units[0]._id, room: f.units[0].assignedRoom, arrivedAt: new Date(), reason: 'cleaning', owner: actor.id });
    e.before = await snapshot(f);
    const original = ArrivalQueueEntry.updateMany; ArrivalQueueEntry.updateMany = () => { throw new Error('QA_CHECKIN_QUEUE'); };
    try { e.response = await outcome(() => enter(f)); } finally { ArrivalQueueEntry.updateMany = original; }
    e.after = await snapshot(f); assert.equal(e.response.error?.message, 'QA_CHECKIN_QUEUE'); assert.deepEqual(e.after, e.before, 'Check-in persisted although queue resolution failed');
  });

  await check('AR09', 'unknown unit in a mixed selection rejects the entire request', async (e) => {
    const f = await fixture({ rooms: 2 }); e.before = await snapshot(f);
    e.response = await outcome(() => enter(f, { unitIds: [id(f.units[0]), id(new mongoose.Types.ObjectId())] })); e.after = await snapshot(f);
    assert.equal(e.response.ok, false, 'Unknown unit was silently discarded and partial entry performed'); assert.deepEqual(e.after, e.before);
  });

  await check('AR10', 'duplicate assigned room across two units blocks check-in', async (e) => {
    const f = await fixture({ rooms: 2 });
    await ReservationRoom.updateOne({ _id: f.units[1]._id }, { $set: { assignedRoom: f.units[0].assignedRoom } });
    e.before = await snapshot(f); e.response = await outcome(() => enter(f, { unitIds: f.units.map(id) })); e.after = await snapshot(f);
    assert.equal(e.response.ok, false, 'Two selected units entered into the same room'); assert.deepEqual(e.after, e.before);
  });

  await check('AR11', 'booking failure rolls back a newly created guest and can retry', async (e) => {
    const f = await fixture({ book: false }); e.before = await snapshot(f);
    const input = { ...f.input, guestId: undefined, newGuest: { firstName: 'New synthetic', lastName: 'Guest', phone: '+15550001234' } };
    const original = StaySegment.insertMany; StaySegment.insertMany = () => { throw new Error('QA_NEW_GUEST_BOOKING'); };
    try { e.failure = await outcome(() => createBooking({ propertyId: f.propertyId, input, actor })); } finally { StaySegment.insertMany = original; }
    e.afterFailure = await snapshot(f); assert.equal(e.failure.error?.message, 'QA_NEW_GUEST_BOOKING'); assert.deepEqual(e.afterFailure, e.before);
    e.retry = await outcome(() => createBooking({ propertyId: f.propertyId, input, actor }));
    assert.equal(e.retry.ok, true); assert.equal(await GuestProfile.countDocuments({ property: f.propertyId }), 2);
    assert.equal(await Reservation.countDocuments({ property: f.propertyId }), 1);
  });

  await check('AR12', 'identical booking retry ignores untrusted client price fields', async (e) => {
    const f = await fixture(); e.before = await snapshot(f);
    e.response = await outcome(() => createBooking({ propertyId: f.propertyId, input: { ...f.input, ratePerNight: 1, totalAmount: 1 }, actor })); e.after = await snapshot(f);
    assert.equal(e.response.ok, true); assert.equal(e.response.value.duplicate, true); assert.deepEqual(e.after, e.before);
  });

  await check('AR13', 'check-in audit failure rolls back guarantee, guest statistics and occupancy', async (e) => {
    const f = await fixture({ guarantee: true }); e.before = await snapshot(f);
    const original = AuditLog.create;
    AuditLog.create = function (entries, ...rest) { if ((Array.isArray(entries) ? entries[0] : entries)?.action === 'reservation.check_in') throw new Error('QA_CHECKIN_AUDIT'); return original.call(this, entries, ...rest); };
    try { e.response = await outcome(() => enter(f, { guarantee: { method: 'credit_card', reference: '4242' } })); } finally { AuditLog.create = original; }
    e.after = await snapshot(f); assert.equal(e.response.error?.message, 'QA_CHECKIN_AUDIT'); assert.deepEqual(e.after, e.before);
  });

  await check('AR14', 'duplicate or out-of-range unit indexes are rejected without changes', async (e) => {
    const f = await fixture({ rooms: 2 }); e.before = await snapshot(f);
    e.duplicate = await outcome(() => enter(f, { unitIndexes: [1, 1] }));
    e.unknown = await outcome(() => enter(f, { unitIndexes: [1, 999] })); e.after = await snapshot(f);
    assert.equal(e.duplicate.error?.status, 422); assert.equal(e.unknown.error?.status, 422); assert.deepEqual(e.after, e.before);
    e.malformed = await outcome(() => enter(f, { unitIds: 'not-an-array' }));
    assert.equal(e.malformed.error?.status, 422); assert.deepEqual(await snapshot(f), e.before);
  });

  await check('AR15', 'two identical concurrent booking requests create one booking and one inventory allocation', async (e) => {
    const f = await fixture({ book: false });
    e.responses = await Promise.all([1, 2].map(() => outcome(() => createBooking({ propertyId: f.propertyId, input: f.input, actor }))));
    e.after = await snapshot(f); assert.equal(e.responses.every((r) => r.ok), true);
    assert.equal(e.after.reservations.length, 1); assert.equal(e.after.units.length, 1); assert.equal(e.after.inventory.every((i) => i.booked === 1), true);
    assert.equal(e.responses.filter((r) => r.value.duplicate).length, 1);
  });

  await check('AR16', 'expired check-in lease cannot commit partially completed entry', async (e) => {
    const f = await fixture(); e.before = await snapshot(f); let injected = false;
    const original = ArrivalQueueEntry.updateMany;
    ArrivalQueueEntry.updateMany = async function (...args) {
      const result = await original.apply(this, args);
      if (!injected) { injected = true; await OperationLock.updateMany({ key: `res:${id(f.res)}` }, { $set: { expiresAt: new Date(0) } }); }
      return result;
    };
    try { e.response = await outcome(() => enter(f)); } finally { ArrivalQueueEntry.updateMany = original; }
    e.after = await snapshot(f); assert.equal(e.response.error?.code, 'lock_expired'); assert.deepEqual(e.after, e.before);
  });
} catch (e) { results.push({ code: 'INFRA', status: 'blocked', failure: e.message }); console.error(e); }
finally {
  await mongoose.disconnect(); if (replica) await replica.stop();
  const dir = fileURLToPath(new URL('../../docs/product-readiness/evidence/', import.meta.url)); await mkdir(dir, { recursive: true });
  const hash = (p) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');
  const files = ['../services/frontDeskService.js', '../services/bookingService.js', '../services/reservationService.js', '../services/availabilityService.js', '../services/stayTransaction.js', '../services/channelQueueService.js', '../services/auditService.js', '../services/locks.js', '../models/Reservation.js', './arrivalReadiness.mjs'];
  const report = { startedAt, finishedAt: new Date().toISOString(), mode: 'synthetic fixtures; isolated local replica; services; no payment capture', hashes: Object.fromEntries(files.map((p) => [p, hash(p)])), counts: { passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length, blocked: results.filter((r) => r.status === 'blocked').length }, results };
  const text = JSON.stringify(report, null, 2) + '\n';
  await writeFile(`${dir}/arrival-${startedAt.replace(/[:.]/g, '-')}.json`, text); await writeFile(`${dir}/arrival-latest.json`, text);
  console.log(JSON.stringify(report.counts)); if (report.counts.failed || report.counts.blocked) process.exitCode = 1;
}
