// Quote, hold and modification audit against a new local replica, never a live hotel.
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
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { businessDateOf } from '../services/frontDeskService.js';
import { createBooking, convertQuote, closeQuote, releaseExpiredHolds } from '../services/bookingService.js';
import OperationLock from '../models/OperationLock.js';
import Company from '../models/Company.js';
import { modifyBooking } from '../services/stayChangeService.js';
import { modifyReservation } from '../services/reservationService.js';

const startedAt = new Date().toISOString(), results = [];
const actor = { id: String(new mongoose.Types.ObjectId()), role: 'property_admin', name: 'Synthetic QA' };
const id = (v) => String(v?._id || v);
const plus = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const outcome = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: { message: e.message, status: e.status, code: e.code } }; } };
async function fixture({ mode = 'quote', heldQuote = false, board = false } = {}) {
  const p = await Property.create({ name: 'Synthetic lifecycle QA', reservationPrefix: randomUUID().slice(0, 8), timezone: 'Asia/Jerusalem', vatRate: 18, boardPricing: { supplements: [{ board: 'half_board', adult: 100, child: 50, active: true }] } });
  const propertyId = id(p), today = businessDateOf(p), arrival = plus(today, 2), departure = plus(today, 4);
  const type = await RoomType.create({ property: propertyId, code: 'STD', name: 'Synthetic standard', baseRate: 500, capacityMax: 4, adultsMax: 4 });
  const rooms = [];
  for (let i = 0; i < 2; i++) rooms.push(await Room.create({ property: propertyId, roomType: type._id, number: String(101 + i), floor: 1, cleanStatus: 'clean' }));
  const plan = await RatePlan.create({ property: propertyId, code: 'BAR', name: 'Synthetic rate', isRefundable: true });
  const dates = Array.from({ length: 10 }, (_, i) => plus(today, i));
  await InventoryDate.insertMany(dates.map((date) => ({ property: propertyId, roomType: type._id, date, physicalCount: 2 })));
  await RateDate.insertMany(dates.map((date) => ({ ratePlan: plan._id, roomType: type._id, date, price: 500 })));
  const guest = await GuestProfile.create({ property: propertyId, firstName: 'Synthetic', lastName: 'Guest' });
  const input = { arrival, departure, adults: 2, children: 0, rooms: 1, roomTypeId: id(type), ratePlanId: id(plan), guestId: id(guest), mode, idempotencyKey: randomUUID(), ...(mode === 'quote' ? { validUntil: new Date(Date.now() + 86400000).toISOString(), holdInventory: heldQuote } : {}), ...(mode === 'hold' ? { holdMinutes: 60 } : {}), ...(board ? { board: 'half_board' } : {}) };
  const booking = await createBooking({ propertyId, input, actor });
  return { p, propertyId, today, arrival, departure, type, plan, guest, rooms, input, booking, resId: booking.id };
}
async function state(f) {
  const read = async (m, project) => (await m.find({ property: f.propertyId }).sort({ _id: 1 }).lean()).map(project);
  return {
    reservations: await read(Reservation, (r) => ({ id: id(r), status: r.status, arrival: r.arrivalDate, departure: r.departureDate, total: r.totalAmount, rate: r.ratePerNight, room: id(r.assignedRoom), snapshot: r.priceSnapshot, quote: r.quote, holdExpiresAt: r.holdExpiresAt, holdReleasedAt: r.holdReleasedAt })),
    units: await read(ReservationRoom, (r) => ({ id: id(r), status: r.status, room: id(r.assignedRoom), arrival: r.arrivalDate, departure: r.departureDate, rate: r.nightlyRate })),
    segments: await read(StaySegment, (r) => ({ id: id(r), unit: id(r.reservationRoom), room: id(r.room), from: r.fromDate, to: r.toDate, rate: r.ratePerNight })),
    inventory: await read(InventoryDate, (r) => ({ date: r.date, booked: r.bookedCount })),
    folios: await Folio.countDocuments({ property: f.propertyId }), audit: await AuditLog.countDocuments({ property: f.propertyId }),
  };
}
const convert = (f, extra = {}) => convertQuote({ propertyId: f.propertyId, id: f.resId, actor, ...extra });
const change = (f, extra = {}) => modifyBooking({ propertyId: f.propertyId, reservationId: f.resId, actor, input: { changes: { departure: plus(f.departure, 1) }, reason: 'Synthetic change', confirmationRef: 'QA approved', ...extra } });
const expire = (f) => Reservation.updateOne({ _id: f.resId }, { $set: { holdExpiresAt: new Date(Date.now() - 60000) } });
async function check(code, name, fn) {
  const evidence = {};
  try { await fn(evidence); results.push({ code, name, status: 'passed', evidence }); console.log(`PASS ${code} ${name}`); }
  catch (e) { results.push({ code, name, status: 'failed', failure: e.message, evidence }); console.log(`FAIL ${code} ${name}: ${e.message.split('\n')[0]}`); }
}
let replica;
try {
  replica = await createAccountingTestReplica(); await mongoose.connect(replica.getUri(`lifecycle_qa_${Date.now()}`));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await check('LC01', 'normal quote conversion reserves nights once and creates a folio', async (e) => {
    const f = await fixture(); e.response = await outcome(() => convert(f)); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.reservations[0].status, 'confirmed'); assert.equal(e.after.folios, 1);
    assert.ok(e.after.inventory.filter((i) => i.date >= f.arrival && i.date < f.departure).every((i) => i.booked === 1));
  });
  await check('LC02', 'concurrent conversion of one quote cannot reserve inventory twice', async (e) => {
    const f = await fixture(); e.responses = await Promise.all([1, 2].map(() => outcome(() => convert(f)))); e.after = await state(f);
    assert.equal(e.responses.filter((r) => r.ok).length, 1); assert.ok(e.after.inventory.filter((i) => i.date >= f.arrival && i.date < f.departure).every((i) => i.booked === 1));
  });
  await check('LC03', 'folio failure during quote conversion rolls back status and stock', async (e) => {
    const f = await fixture(); e.before = await state(f); const original = Folio.create; Folio.create = () => { throw new Error('QA_CONVERT_FOLIO'); };
    try { e.response = await outcome(() => convert(f)); } finally { Folio.create = original; }
    e.after = await state(f); assert.equal(e.response.error?.message, 'QA_CONVERT_FOLIO'); assert.deepEqual(e.after, e.before);
  });
  await check('LC04', 'failed stock release when closing a held quote preserves its full state', async (e) => {
    const f = await fixture({ heldQuote: true }); e.before = await state(f); const original = InventoryDate.updateMany;
    InventoryDate.updateMany = function (filter, update, ...rest) { if (update?.$inc?.bookedCount < 0) throw new Error('QA_CLOSE_STOCK'); return original.call(this, filter, update, ...rest); };
    try { e.response = await outcome(() => closeQuote({ propertyId: f.propertyId, id: f.resId, reason: 'Synthetic lost quote', actor })); } finally { InventoryDate.updateMany = original; }
    e.after = await state(f); assert.equal(e.response.ok, false); assert.deepEqual(e.after, e.before);
  });
  await check('LC05', 'failed stock release during hold expiry leaves the hold recoverable', async (e) => {
    const f = await fixture({ mode: 'hold' }); await expire(f); e.before = await state(f); const original = InventoryDate.updateMany;
    InventoryDate.updateMany = function (filter, update, ...rest) { if (update?.$inc?.bookedCount < 0) throw new Error('QA_EXPIRY_STOCK'); return original.call(this, filter, update, ...rest); };
    try { e.response = await outcome(() => releaseExpiredHolds({ propertyId: f.propertyId })); } finally { InventoryDate.updateMany = original; }
    e.after = await state(f); assert.equal(e.response.ok, false); assert.deepEqual(e.after, e.before);
  });
  await check('LC06', 'expired quote and hold leave cancelled units rather than tentative units', async (e) => {
    const f = await fixture({ heldQuote: true }); await expire(f); await Reservation.updateOne({ _id: f.resId }, { $set: { 'quote.validUntil': new Date(Date.now() - 60000) } });
    e.response = await outcome(() => releaseExpiredHolds({ propertyId: f.propertyId })); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.reservations[0].status, 'cancelled'); assert.ok(e.after.units.every((u) => u.status === 'cancelled'));
  });
  await check('LC07', 'releasing a held quote clears room assignments from units and segments', async (e) => {
    const f = await fixture({ heldQuote: true }); await expire(f); e.response = await outcome(() => releaseExpiredHolds({ propertyId: f.propertyId })); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.reservations[0].status, 'quote');
    assert.ok(e.after.units.every((u) => u.room === 'null')); assert.ok(e.after.segments.every((s) => s.room === 'null'));
  });
  await check('LC08', 'a quote cannot convert after the rate was closed for sale', async (e) => {
    const f = await fixture(); await RateDate.updateOne({ roomType: f.type._id, ratePlan: f.plan._id, date: f.arrival }, { $set: { stopSell: true } }); e.before = await state(f);
    e.response = await outcome(() => convert(f)); e.after = await state(f); assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('LC09', 'unchanged half-board quote converts without a false price-change error', async (e) => {
    const f = await fixture({ board: true }); e.response = await outcome(() => convert(f)); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.reservations[0].total, 1400); assert.equal(e.after.units[0].rate, 500);
    assert.equal((await Reservation.findById(f.resId)).taxAmount, Math.round((1400 - 1400 / 1.18) * 100) / 100);
  });
  await check('LC10', 'failed modification segment insertion restores old dates, segments and stock', async (e) => {
    const f = await fixture({ mode: 'confirm' }); e.before = await state(f); const original = StaySegment.insertMany; StaySegment.insertMany = () => { throw new Error('QA_MODIFY_SEGMENTS'); };
    try { e.response = await outcome(() => change(f)); } finally { StaySegment.insertMany = original; }
    e.after = await state(f); assert.equal(e.response.error?.message, 'QA_MODIFY_SEGMENTS'); assert.deepEqual(e.after, e.before);
  });
  await check('LC11', 'failed allocation of new modification nights restores old inventory', async (e) => {
    const f = await fixture({ mode: 'confirm' }); e.before = await state(f); const original = InventoryDate.updateMany;
    InventoryDate.updateMany = function (filter, update, ...rest) { if (update?.$inc?.bookedCount > 0) throw new Error('QA_MODIFY_STOCK'); return original.call(this, filter, update, ...rest); };
    try { e.response = await outcome(() => change(f)); } finally { InventoryDate.updateMany = original; }
    e.after = await state(f); assert.equal(e.response.error?.message, 'QA_MODIFY_STOCK'); assert.deepEqual(e.after, e.before);
  });
  await check('LC12', 'modifying half-board dates keeps lodging and meal supplements in the price', async (e) => {
    const f = await fixture({ mode: 'confirm', board: true }); e.response = await outcome(() => change(f)); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.reservations[0].total, 2100); assert.equal(e.after.reservations[0].snapshot.board.nightly.length, 3);
    assert.equal(e.after.units[0].rate, 500);
    const saved = await Reservation.findById(f.resId).lean();
    assert.equal(saved.taxAmount, Math.round((2100 - 2100 / 1.18) * 100) / 100);
  });
  await check('LC13', 'legacy modification rolls back if saving the reservation fails', async (e) => {
    const f = await fixture({ mode: 'confirm' }); e.before = await state(f); const original = Reservation.prototype.save;
    Reservation.prototype.save = function (...args) { if (id(this) === f.resId) throw new Error('QA_LEGACY_MODIFY_SAVE'); return original.apply(this, args); };
    try { e.response = await outcome(() => modifyReservation({ reservationId: f.resId, data: { departureDate: plus(f.departure, 1) }, actorId: actor.id, actorName: actor.name })); } finally { Reservation.prototype.save = original; }
    e.after = await state(f); assert.equal(e.response.error?.message, 'QA_LEGACY_MODIFY_SAVE'); assert.deepEqual(e.after, e.before);
  });
  await check('LC14', 'plain held booking confirms without taking its inventory twice', async (e) => {
    const f = await fixture({ mode: 'hold' }); e.before = await state(f); e.response = await outcome(() => convert(f)); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.reservations[0].status, 'confirmed'); assert.deepEqual(e.after.inventory, e.before.inventory);
  });
  await check('LC15', 'failed modification audit restores the full original booking', async (e) => {
    const f = await fixture({ mode: 'confirm' }); e.before = await state(f); const original = AuditLog.create;
    AuditLog.create = function (entry, ...rest) { if ((Array.isArray(entry) ? entry[0] : entry)?.action === 'reservation.modified') throw new Error('QA_MODIFY_AUDIT'); return original.call(this, entry, ...rest); };
    try { e.response = await outcome(() => change(f)); } finally { AuditLog.create = original; }
    e.after = await state(f); assert.equal(e.response.error?.message, 'QA_MODIFY_AUDIT'); assert.deepEqual(e.after, e.before);
  });
  await check('LC16', 'failed conversion audit restores quote, stock, units and folio', async (e) => {
    const f = await fixture(); e.before = await state(f); const original = AuditLog.create;
    AuditLog.create = function (entry, ...rest) { if ((Array.isArray(entry) ? entry[0] : entry)?.action === 'quote.converted') throw new Error('QA_CONVERT_AUDIT'); return original.call(this, entry, ...rest); };
    try { e.response = await outcome(() => convert(f)); } finally { AuditLog.create = original; }
    e.after = await state(f); assert.equal(e.response.error?.message, 'QA_CONVERT_AUDIT'); assert.deepEqual(e.after, e.before);
  });
  await check('LC17', 'closing and converting a held quote cannot both succeed', async (e) => {
    const f = await fixture({ heldQuote: true }); e.responses = await Promise.all([outcome(() => convert(f)), outcome(() => closeQuote({ propertyId: f.propertyId, id: f.resId, reason: 'Synthetic close', actor }))]); e.after = await state(f);
    assert.equal(e.responses.filter((r) => r.ok).length, 1);
    const status = e.after.reservations[0].status; assert.ok(['confirmed', 'cancelled'].includes(status));
    assert.ok(e.after.inventory.filter((i) => i.date >= f.arrival && i.date < f.departure).every((i) => i.booked === (status === 'confirmed' ? 1 : 0)));
  });
  await check('LC18', 'two expiry workers release the same hold exactly once', async (e) => {
    const f = await fixture({ mode: 'hold' }); await expire(f);
    e.responses = await Promise.all([1, 2].map(() => outcome(() => releaseExpiredHolds({ propertyId: f.propertyId })))); e.after = await state(f);
    assert.equal(e.responses.every((r) => r.ok), true); assert.equal(e.responses.reduce((sum, r) => sum + r.value.released, 0), 1); assert.ok(e.after.inventory.every((i) => i.booked === 0));
  });
  await check('LC19', 'successful legacy date modification synchronizes units, segments and price snapshot', async (e) => {
    const f = await fixture({ mode: 'confirm' }); e.response = await outcome(() => modifyReservation({ reservationId: f.resId, data: { departureDate: plus(f.departure, 1) }, actorId: actor.id, actorName: actor.name })); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.ok(e.after.units.every((u) => u.departure === plus(f.departure, 1))); assert.ok(e.after.segments.every((s) => s.to === plus(f.departure, 1)));
    assert.equal(e.after.reservations[0].snapshot.nightly.length, 3); assert.equal(e.after.reservations[0].snapshot.total, 1500);
  });
  await check('LC20', 'confirmed changed meal supplement updates quote total and board snapshot without inflating room rate', async (e) => {
    const f = await fixture({ board: true }); await Property.updateOne({ _id: f.propertyId }, { $set: { 'boardPricing.supplements.0.adult': 150 } });
    e.first = await outcome(() => convert(f)); assert.equal(e.first.error?.code, 'price_changed');
    const direct = await import('../services/bookingService.js');
    const { offer } = await direct.resolveOffer({ propertyId: f.propertyId, input: f.input, excludeReservationId: f.resId });
    e.response = await outcome(() => convert(f, { priceSignature: offer.priceSignature })); e.after = await state(f);
    assert.equal(e.response.ok, true); assert.equal(e.after.reservations[0].total, 1600); assert.equal(e.after.units[0].rate, 500); assert.ok(e.after.reservations[0].snapshot.board.nightly.every((n) => n.price === 300));
  });
  await check('LC21', 'legacy commercial edit cannot silently strip an existing meal package', async (e) => {
    const f = await fixture({ mode: 'confirm', board: true }); e.before = await state(f);
    e.response = await outcome(() => modifyReservation({ reservationId: f.resId, data: { departureDate: plus(f.departure, 1) }, actorId: actor.id, actorName: actor.name })); e.after = await state(f);
    assert.equal(e.response.error?.status, 409); assert.deepEqual(e.after, e.before);
  });
  await check('LC22', 'last-room held quote is excluded from its own availability check', async (e) => {
    const f = await fixture({ mode: 'hold' }); await Room.deleteOne({ _id: f.rooms[1]._id });
    e.response = await outcome(() => convert(f)); e.after = await state(f); assert.equal(e.response.ok, true); assert.equal(e.after.reservations[0].status, 'confirmed');
  });
  await check('LC23', 'expired modification lease rolls back every changed night and segment', async (e) => {
    const f = await fixture({ mode: 'confirm' }); e.before = await state(f); const original = StaySegment.insertMany; let injected = false;
    StaySegment.insertMany = async function (...args) { const value = await original.apply(this, args); if (!injected) { injected = true; await OperationLock.updateMany({ key: `res:${f.resId}` }, { $set: { expiresAt: new Date(0) } }); } return value; };
    try { e.response = await outcome(() => change(f)); } finally { StaySegment.insertMany = original; }
    e.after = await state(f); assert.equal(e.response.error?.code, 'lock_expired'); assert.deepEqual(e.after, e.before);
  });
  await check('LC24', 'sequential legacy metadata edits do not collide on the same channel event key', async (e) => {
    const f = await fixture({ mode: 'confirm' }); e.responses = [];
    for (const internalNotes of ['Synthetic first note', 'Synthetic second note']) e.responses.push(await outcome(() => modifyReservation({ reservationId: f.resId, data: { internalNotes }, actorId: actor.id, actorName: actor.name })));
    assert.equal(e.responses.every((r) => r.ok), true);
  });
  await check('LC25', 'legacy edits reject foreign rate plans and companies', async (e) => {
    const f = await fixture({ mode: 'confirm' }), other = await fixture({ mode: 'confirm' }); const company = await Company.create({ property: other.propertyId, name: 'Other synthetic company' }); e.before = await state(f); e.responses = [];
    for (const data of [{ ratePlanId: id(other.plan) }, { companyId: id(company) }]) e.responses.push(await outcome(() => modifyReservation({ reservationId: f.resId, data, actorId: actor.id, actorName: actor.name })));
    e.after = await state(f); assert.equal(e.responses.every((r) => !r.ok && r.error.status === 422), true); assert.deepEqual(e.after, e.before);
  });
  await check('LC26', 'legacy extension releases a room taken on the added night while keeping other available inventory', async (e) => {
    const f = await fixture({ mode: 'confirm' }); const room = f.rooms[0]._id;
    await Reservation.updateOne({ _id: f.resId }, { $set: { assignedRoom: room } });
    await ReservationRoom.updateMany({ reservation: f.resId }, { $set: { assignedRoom: room } });
    await StaySegment.updateMany({ reservation: f.resId }, { $set: { room } });
    const competing = await createBooking({ propertyId: f.propertyId, actor, input: { ...f.input, arrival: f.departure, departure: plus(f.departure, 1), idempotencyKey: randomUUID() } });
    await Reservation.updateOne({ _id: competing.id }, { $set: { assignedRoom: room } });
    await ReservationRoom.updateMany({ reservation: competing.id }, { $set: { assignedRoom: room } });
    await StaySegment.updateMany({ reservation: competing.id }, { $set: { room } });
    e.response = await outcome(() => modifyReservation({ reservationId: f.resId, data: { departureDate: plus(f.departure, 1) }, actorId: actor.id, actorName: actor.name }));
    assert.equal(e.response.ok, true);
    assert.equal((await Reservation.findById(f.resId)).assignedRoom, null);
    assert.ok((await ReservationRoom.find({ reservation: f.resId })).every((u) => !u.assignedRoom));
    assert.ok((await StaySegment.find({ reservation: f.resId })).every((s) => !s.room));
    assert.equal(id((await Reservation.findById(competing.id)).assignedRoom), id(room));
  });
} catch (e) { results.push({ code: 'INFRA', status: 'blocked', failure: e.message }); console.error(e.message); }
finally {
  await mongoose.disconnect(); if (replica) await replica.stop();
  const dir = fileURLToPath(new URL('../../docs/product-readiness/evidence/', import.meta.url)); await mkdir(dir, { recursive: true });
  const hash = (p) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');
  const paths = ['../services/bookingService.js', '../services/stayChangeService.js', '../services/reservationService.js', '../services/availabilityService.js', '../services/stayTransaction.js', '../services/locks.js', '../services/auditService.js', './lifecycleReadiness.mjs'];
  const report = { startedAt, finishedAt: new Date().toISOString(), mode: 'isolated local replica; synthetic fixtures; no payment capture', hashes: Object.fromEntries(paths.map((p) => [p, hash(p)])), counts: { passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length, blocked: results.filter((r) => r.status === 'blocked').length }, results };
  const text = JSON.stringify(report, null, 2) + '\n'; await writeFile(`${dir}/lifecycle-${startedAt.replace(/[:.]/g, '-')}.json`, text); await writeFile(`${dir}/lifecycle-latest.json`, text);
  console.log(JSON.stringify(report.counts)); if (report.counts.failed || report.counts.blocked) process.exitCode = 1;
}
