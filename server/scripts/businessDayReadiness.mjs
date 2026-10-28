// Managed-day evidence on an isolated synthetic replica; never loads hotel configuration.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import Property from '../models/Property.js';
import Reservation from '../models/Reservation.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Folio from '../models/Folio.js';
import { businessDateOf } from '../services/frontDeskService.js';
import { postCharge, runDayClose, reverseCharge, recordFolioPayment, refundPayment } from '../services/financeService.js';
import { computeLedger, dayReport } from '../services/ledgerService.js';
import { receiptsReport, closeCash, cashDay } from '../services/financeReportsService.js';
import { postServiceCharge } from '../services/departureService.js';
import AuditLog from '../models/AuditLog.js';
import CashierClose from '../models/CashierClose.js';
import DayCloseRun from '../models/DayCloseRun.js';
import AutomationRule from '../models/AutomationRule.js';
import { fireEvent } from '../services/automationEngine.js';
import { markNoShow } from '../services/reservationService.js';
import { withLocks } from '../services/locks.js';
import { runStayTransaction } from '../services/stayTransaction.js';
const startedAt = new Date().toISOString(), results = [];
const actor = { id: String(new mongoose.Types.ObjectId()), role: 'property_admin', name: 'Synthetic QA' };
const plus = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const outcome = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: { message: e.message, code: e.code, status: e.status } }; } };
async function fixture() {
  const p = await Property.create({ name: 'Synthetic managed-day QA', timezone: 'Asia/Jerusalem', vatRate: 18 });
  const calendar = businessDateOf(p), day = plus(calendar, -1), closed = plus(day, -1), propertyId = String(p._id);
  // Raw setup deliberately also works before the schema learns the managed-date field.
  await Property.collection.updateOne({ _id: p._id }, { $set: { 'dayClose.businessDate': day, 'dayClose.lastClosedDate': closed } });
  const type = await RoomType.create({ property: p._id, code: 'STD', name: 'Synthetic room', baseRate: 500 });
  const guest = await GuestProfile.create({ property: p._id, firstName: 'Synthetic', lastName: 'Guest' });
  const res = await Reservation.create({ property: p._id, confirmationNumber: randomUUID(), primaryGuest: guest._id, roomType: type._id, arrivalDate: calendar, departureDate: plus(calendar, 2), nights: 2, roomsCount: 1, adults: 2, status: 'confirmed', ratePerNight: 500, totalAmount: 1000 });
  const folio = await Folio.create({ property: p._id, reservation: res._id, ownerType: 'guest', lines: [] });
  return { propertyId, resId: String(res._id), folioId: String(folio._id), day, calendar, closed };
}
const charge = (f, extra = {}) => postCharge({ propertyId: f.propertyId, folioId: f.folioId, actor, input: { description: 'Synthetic charge', department: 'other', unitPrice: 118, quantity: 1, idempotencyKey: randomUUID(), ...extra } });
const close = (f) => runDayClose({ propertyId: f.propertyId, date: f.day, actor, arrivals: 'keep', reason: 'Synthetic day review' });
const tx = (f, work) => withLocks([`qa:${f.folioId}`], (lease) => runStayTransaction(work, lease));
const line = (f, extra = {}) => ({ type: 'charge', description: 'Synthetic direct line', amount: 10, taxAmount: 0, department: 'rooms', serviceDate: f.day, status: 'posted', ...extra });
async function check(code, name, fn) { const evidence = {}; try { await fn(evidence); results.push({ code, name, status: 'passed', evidence }); console.log(`PASS ${code} ${name}`); } catch (e) { results.push({ code, name, status: 'failed', failure: e.message, evidence }); console.log(`FAIL ${code} ${name}: ${e.message.split('\n')[0]}`); } }
let replica;
try {
  replica = await createAccountingTestReplica(); await mongoose.connect(replica.getUri(`business_day_${Date.now()}`)); await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await check('BD01', 'managed business day does not move with the calendar', async (e) => { const f = await fixture(); e.property = await Property.findById(f.propertyId).lean(); assert.equal(businessDateOf(e.property), f.day); });
  await check('BD02', 'late service charge retains its service date but books to the open business day', async (e) => { const f = await fixture(); e.response = await outcome(() => charge(f, { serviceDate: f.closed })); e.folio = await Folio.findById(f.folioId).lean(); assert.equal(e.response.ok, true); assert.equal(e.folio.lines[0].serviceDate, f.closed); assert.equal(e.folio.lines[0].accountingDate, f.day); });
  await check('BD03', 'explicit booking into a closed accounting period is rejected', async (e) => { const f = await fixture(); e.response = await outcome(() => tx(f, async (session) => { const folio = await Folio.findById(f.folioId).session(session); folio.lines.push(line(f, { accountingDate: f.closed })); await folio.save({ session }); })); assert.equal(e.response.error?.code, 'closed_business_day'); assert.equal((await Folio.findById(f.folioId)).lines.length, 0); });
  await check('BD04', 'saved closed-day amounts cannot be edited through document save', async (e) => { const f = await fixture(); await charge(f); await close(f); e.response = await outcome(() => tx(f, async (session) => { const folio = await Folio.findById(f.folioId).session(session); folio.lines[0].amount = 999; await folio.save({ session }); })); assert.equal(e.response.error?.code, 'closed_business_day'); assert.equal((await Folio.findById(f.folioId)).lines[0].amount, 100); });
  await check('BD05', 'query updates cannot bypass closed financial-line protection', async (e) => { const f = await fixture(); await charge(f); await close(f); e.response = await outcome(() => Folio.updateOne({ _id: f.folioId }, { $set: { 'lines.0.amount': 999 } })); assert.equal(e.response.error?.code, 'financial_query_write_forbidden'); assert.equal((await Folio.findById(f.folioId)).lines[0].amount, 100); });
  await check('BD06', 'managed-period financial document saves require an atomic session', async (e) => { const f = await fixture(); const folio = await Folio.findById(f.folioId); folio.lines.push(line(f)); e.response = await outcome(() => folio.save()); assert.equal(e.response.error?.code, 'FINANCIAL_TRANSACTIONS_REQUIRED'); assert.equal((await Folio.findById(f.folioId)).lines.length, 0); });
  await check('BD07', 'successful close advances the managed date exactly one day and late charges use it', async (e) => { const f = await fixture(); await charge(f); e.close = await outcome(() => close(f)); assert.equal(e.close.value?.status, 'done'); assert.equal((await Property.findById(f.propertyId)).dayClose.businessDate, f.calendar); await charge(f, { serviceDate: f.day }); const saved = await Folio.findById(f.folioId); assert.deepEqual(saved.lines.map((l) => l.accountingDate), [f.day, f.calendar]); });
  await check('BD08', 'next-day posting cannot change the closed trial balance', async (e) => { const f = await fixture(); await charge(f); await close(f); e.before = (await computeLedger(f.propertyId, f.day)).trial; await charge(f); e.after = (await computeLedger(f.propertyId, f.day)).trial; assert.deepEqual(e.after, e.before); assert.equal(e.before.closing, 118); });
  await check('BD09', 'reversal books on the new open day and preserves the original closed line', async (e) => { const f = await fixture(); await charge(f); const original = (await Folio.findById(f.folioId)).lines[0].toObject(); await close(f); e.response = await outcome(() => reverseCharge({ propertyId: f.propertyId, folioId: f.folioId, lineId: String(original._id), actor, reason: 'Synthetic correction' })); const saved = await Folio.findById(f.folioId); assert.equal(e.response.ok, true); assert.deepEqual(saved.lines[0].toObject(), original); assert.equal(saved.lines[1].accountingDate, f.calendar); });
  await check('BD10', 'managed finance entry point serializes a charge racing day close', async (e) => { const f = await fixture(); e.responses = await Promise.all([outcome(() => charge(f)), outcome(() => close(f))]); assert.ok(e.responses[0].ok || e.responses[0].error?.code === 'business_day_closing'); assert.equal(e.responses[1].value?.status, 'done'); const saved = await Folio.findById(f.folioId); assert.ok(saved.lines.every((l) => [f.day, f.calendar].includes(l.accountingDate))); });
  await check('BD11', 'bank value date follows the calendar while receipt books on managed day', async (e) => {
    const f = await fixture(); await charge(f); e.response = await outcome(() => recordFolioPayment({ propertyId: f.propertyId, folioId: f.folioId, actor, input: { amount: 118, method: 'bank_transfer', details: { reference: 'SYNTHETIC', payDate: f.calendar }, idempotencyKey: randomUUID() } }));
    assert.equal(e.response.ok, true); const row = (await Folio.findById(f.folioId)).lines.at(-1); assert.equal(row.accountingDate, f.day); assert.equal(row.payDetails.payDate, f.calendar);
  });
  await check('BD12', 'cash and receipt reports group a late payment by accounting day', async (e) => {
    const f = await fixture(); await tx(f, async (session) => { const folio = await Folio.findById(f.folioId).session(session); folio.lines.push(line(f, { type: 'payment', method: 'cash', amount: -50, serviceDate: f.closed, createdBy: actor.id })); await folio.save({ session }); });
    e.cash = await cashDay({ propertyId: f.propertyId, date: f.day }); e.report = await receiptsReport({ propertyId: f.propertyId, from: f.day, to: f.day }); assert.equal(e.cash.total, 50); assert.equal(e.report.rows.length, 1); assert.equal(e.report.rows[0].date, f.day); assert.equal(e.report.rows[0].serviceDate, f.closed);
  });
  await check('BD13', 'cash close cannot rewrite a closed business day', async (e) => { const f = await fixture(); await close(f); e.response = await outcome(() => closeCash({ propertyId: f.propertyId, date: f.day, counted: 0, actor })); assert.equal(e.response.error?.code, 'closed_business_day'); assert.equal(await CashierClose.countDocuments({ property: f.propertyId }), 0); });
  await check('BD14', 'insertMany bulkWrite replacement and deletion cannot bypass managed ledger guard', async (e) => {
    const f = await fixture(); await charge(f); await close(f); e.responses = [];
    for (const write of [() => Folio.insertMany([{ property: f.propertyId, reservation: f.resId, lines: [line(f)] }]), () => Folio.bulkWrite([{ updateOne: { filter: { _id: new mongoose.Types.ObjectId(f.folioId) }, update: { $set: { 'lines.0.amount': 999 } } } }]), () => Folio.replaceOne({ _id: f.folioId }, { property: f.propertyId, reservation: f.resId, lines: [] }), () => Folio.deleteOne({ _id: f.folioId })]) e.responses.push(await outcome(write));
    assert.ok(e.responses.every((r) => r.error?.code === 'financial_query_write_forbidden')); assert.equal((await Folio.findById(f.folioId)).lines[0].amount, 100);
  });
  await check('BD15', 'closed period survives a failed final day-close commit', async (e) => {
    const f = await fixture(); await charge(f); const original = AuditLog.create;
    AuditLog.create = function (entry, ...rest) { if ((Array.isArray(entry) ? entry[0] : entry)?.action === 'day_close.completed') throw new Error('QA_PERIOD_COMMIT'); return original.call(this, entry, ...rest); };
    try { e.first = await outcome(() => close(f)); } finally { AuditLog.create = original; }
    assert.equal(e.first.value?.status, 'failed'); const p = await Property.findById(f.propertyId); assert.equal(p.dayClose.businessDate, f.day); assert.equal(p.dayClose.lastClosedDate, f.closed); e.second = await outcome(() => close(f)); assert.equal(e.second.value?.status, 'done');
  });
  await check('BD16', 'normal charge audit failure restores accounting entry and permits retry', async (e) => {
    const f = await fixture(); const original = AuditLog.create;
    AuditLog.create = function (entry, ...rest) { if ((Array.isArray(entry) ? entry[0] : entry)?.action === 'folio.charge') throw new Error('QA_PERIOD_CHARGE'); return original.call(this, entry, ...rest); };
    try { e.response = await outcome(() => charge(f)); } finally { AuditLog.create = original; }
    assert.equal(e.response.error?.message, 'QA_PERIOD_CHARGE'); assert.equal((await Folio.findById(f.folioId)).lines.length, 0); await charge(f); assert.equal((await Folio.findById(f.folioId)).lines[0].accountingDate, f.day);
  });
  await check('BD17', 'closed reports retain ledger classification when reservation status later changes', async (e) => {
    const f = await fixture(); await charge(f); await close(f); const before = await dayReport({ propertyId: f.propertyId, date: f.day }); await Reservation.updateOne({ _id: f.resId }, { $set: { status: 'cancelled' } }); const after = await dayReport({ propertyId: f.propertyId, date: f.day }); assert.equal(after.frozen, true); assert.deepEqual(after.ledger, before.ledger);
  });
  await check('BD18', 'legacy desk service charge supports managed day after activation', async (e) => {
    const f = await fixture(); await Reservation.updateOne({ _id: f.resId }, { $set: { status: 'in_house' } }); e.response = await outcome(() => postServiceCharge({ propertyId: f.propertyId, reservationId: f.resId, actor, input: { amount: 118, department: 'other', description: 'Synthetic service', idempotencyKey: randomUUID() } })); assert.equal(e.response.ok, true); assert.equal((await Folio.findById(f.folioId)).lines[0].accountingDate, f.day);
  });
  await check('BD19', 'late refund is booked in the new day without changing the payment period', async (e) => {
    const f = await fixture(); await recordFolioPayment({ propertyId: f.propertyId, folioId: f.folioId, actor, input: { kind: 'deposit', amount: 100, method: 'cash', idempotencyKey: randomUUID() } }); const pay = (await Folio.findById(f.folioId)).lines[0]; await close(f);
    e.response = await outcome(() => refundPayment({ propertyId: f.propertyId, folioId: f.folioId, paymentLineId: String(pay._id), actor, input: { amount: 100, reasonCode: 'cancellation', idempotencyKey: randomUUID() } })); assert.equal(e.response.ok, true); assert.deepEqual((await Folio.findById(f.folioId)).lines.map((l) => l.accountingDate), [f.day, f.calendar]);
  });
  await check('BD20', 'upsert cannot insert financial lines into a managed property', async (e) => {
    const f = await fixture(); e.response = await outcome(() => Folio.updateOne({ _id: new mongoose.Types.ObjectId() }, { $setOnInsert: { property: f.propertyId, reservation: f.resId, lines: [line(f)] } }, { upsert: true })); assert.equal(e.response.error?.code, 'financial_query_write_forbidden'); assert.equal(await Folio.countDocuments({ property: f.propertyId }), 1);
  });
  await check('BD21', 'legacy undated lines freeze on activation rather than being silently restamped', async (e) => {
    const f = await fixture(); await Folio.collection.updateOne({ _id: new mongoose.Types.ObjectId(f.folioId) }, { $push: { lines: { ...line(f), _id: new mongoose.Types.ObjectId(), postedAt: new Date() } } });
    e.response = await outcome(() => tx(f, async (session) => { const folio = await Folio.findById(f.folioId).session(session); folio.lines[0].amount = 999; await folio.save({ session }); })); assert.equal(e.response.error?.code, 'closed_business_day'); assert.equal((await Folio.findById(f.folioId)).lines[0].accountingDate, undefined);
  });
  await check('BD22', 'moving a ledger to an unactivated property cannot evade protection', async (e) => {
    const f = await fixture(); await charge(f); const other = await Property.create({ name: 'Synthetic unactivated' }); const folio = await Folio.findById(f.folioId); folio.property = other._id; e.response = await outcome(() => folio.save()); assert.equal(e.response.error?.code, 'closed_business_day'); assert.equal(String((await Folio.findById(f.folioId)).property), f.propertyId);
  });
  await check('BD23', 'failed cash-close audit leaves no partial close and a retry sees the saved row', async (e) => {
    const f = await fixture(); const original = AuditLog.create; AuditLog.create = function (entry, ...rest) { if ((Array.isArray(entry) ? entry[0] : entry)?.action === 'cash.closed') throw new Error('QA_CASH_CLOSE'); return original.call(this, entry, ...rest); };
    try { e.first = await outcome(() => closeCash({ propertyId: f.propertyId, counted: 0, actor })); } finally { AuditLog.create = original; }
    assert.equal(e.first.error?.message, 'QA_CASH_CLOSE'); assert.equal(await CashierClose.countDocuments({ property: f.propertyId }), 0); e.second = await outcome(() => closeCash({ propertyId: f.propertyId, counted: 0, actor })); assert.equal(e.second.ok, true); assert.equal(e.second.value.date, f.day); assert.ok(e.second.value.rows[0].close?.id);
  });
  await check('BD24', 'automation charge uses the managed posting day and keeps an explicit charge type', async (e) => {
    const f = await fixture(); const rule = await AutomationRule.create({ property: f.propertyId, name: 'Synthetic accounting rule', trigger: 'reservation.modified', action: 'post_charge', actionParams: { amount: 10, taxAmount: 1.8, description: 'Synthetic automatic charge' } }); await fireEvent('reservation.modified', { property: f.propertyId, reservation: { _id: f.resId } }); const folio = await Folio.findById(f.folioId); e.rule = await AutomationRule.findById(rule._id).lean(); assert.equal(folio.lines.length, 1); assert.equal(folio.lines[0].type, 'charge'); assert.equal(folio.lines[0].accountingDate, f.day);
  });
  await check('BD25', 'legacy no-show cannot use the calendar to bypass the managed arrival day', async (e) => {
    const f = await fixture(); e.response = await outcome(() => markNoShow({ reservationId: f.resId, actorId: actor.id, actorName: actor.name })); assert.equal(e.response.error?.status, 409); assert.equal((await Reservation.findById(f.resId)).status, 'confirmed');
  });
  await check('BD26', 'unactivated property retains the local calendar until migration activation', async (e) => {
    const f = await fixture(); const p = await Property.create({ name: 'Synthetic unactivated day', timezone: 'Asia/Jerusalem' }); assert.equal(businessDateOf(p), f.calendar); assert.equal(p.dayClose.businessDate, undefined);
  });
  await check('BD27', 'copying an existing closed line ID cannot add another charge to the closed day', async (e) => {
    const f = await fixture(); await charge(f); await close(f); e.response = await outcome(() => tx(f, async (session) => { const folio = await Folio.findById(f.folioId).session(session); folio.lines.push(folio.lines[0].toObject()); await folio.save({ session }); })); assert.equal(e.response.error?.code, 'financial_query_write_forbidden'); assert.equal((await Folio.findById(f.folioId)).lines.length, 1);
  });
} catch (e) { results.push({ code: 'INFRA', status: 'blocked', failure: e.message }); console.error(e.message); }
finally {
  await mongoose.disconnect(); if (replica) await replica.stop();
  const dir = fileURLToPath(new URL('../../docs/product-readiness/evidence/', import.meta.url)); await mkdir(dir, { recursive: true });
  const paths = ['../models/Folio.js', '../models/Property.js', '../services/financialPeriodGuard.js', '../services/financialTransaction.js', '../utils/businessDate.js', '../services/financeService.js', '../services/financeReportsService.js', '../services/automationEngine.js', '../services/departureService.js', '../services/roomCharges.js', '../services/ledgerService.js', '../services/frontDeskService.js', '../services/reservationService.js', '../routes/reservations.js', '../routes/dashboard.js', './businessDayReadiness.mjs'];
  const report = { startedAt, finishedAt: new Date().toISOString(), mode: 'isolated local replica; synthetic fixtures', hashes: Object.fromEntries(paths.map((p) => [p, createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex')])), counts: { passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length, blocked: results.filter((r) => r.status === 'blocked').length }, results };
  const body = JSON.stringify(report, null, 2) + '\n'; await writeFile(`${dir}/business-day-${startedAt.replace(/[:.]/g, '-')}.json`, body); await writeFile(`${dir}/business-day-latest.json`, body); console.log(JSON.stringify(report.counts)); if (report.counts.failed || report.counts.blocked) process.exitCode = 1;
}
