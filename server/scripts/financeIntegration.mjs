#!/usr/bin/env node
/* eslint-disable no-console */
// Finance integration suite (W08/W09: FIN-01 folio, FIN-02 charge/reversal, FIN-03 payment/deposit,
// FIN-04 refund, FIN-07 credit note, FIN-12 day close). Runs against a live PMS server and the same
// DB. Everything happens on throw-away properties created here, because day close touches every
// stay of a property; all of it is removed at the end.
//
//   node scripts/financeIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Folio from '../models/Folio.js';
import Invoice from '../models/Invoice.js';
import { removeFiscalTestFixtures } from './fiscalTestCleanup.mjs';
import DayCloseRun from '../models/DayCloseRun.js';
import InventoryDate from '../models/InventoryDate.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import AuditLog from '../models/AuditLog.js';
import ChargeCode from '../models/ChargeCode.js';
import WorkItem from '../models/WorkItem.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { postNightsUntil } from '../services/roomCharges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `FIN${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const key = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const balOf = (f) => Math.round(f.lines.filter((l) => l.status === 'posted').reduce((s, l) => s + l.amount + (l.taxAmount || 0), 0) * 100) / 100;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const props = [];
  const today = todayYmdInTimezone('Asia/Jerusalem');

  // A self-contained property: room type, rooms, users and a guest.
  async function mkProperty(n) {
    const p = await Property.create({ name: `בדיקה ${TAG}-${n}`, legalName: 'בדיקה בע"מ', taxNumber: '514443210', address: 'רחוב הבדיקה 1', city: 'טבריה', timezone: 'Asia/Jerusalem', vatRate: 18, invoicePrefix: `${TAG}${n}`, invoiceSequence: 0 });
    props.push(p._id);
    const P = String(p._id);
    const rt = await RoomType.create({ property: P, code: `${TAG}${n}`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    const rooms = [];
    for (let i = 1; i <= 4; i += 1) rooms.push(await Room.create({ property: P, roomType: rt._id, number: `${n}0${i}`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' }));
    const users = {};
    for (const role of ['property_admin', 'receptionist', 'finance_manager', 'housekeeper']) {
      users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${n}-${role}@test.local`, passwordHash: 'x', role, active: true });
    }
    const guest = await GuestProfile.create({ property: P, firstName: 'אורח', lastName: `${TAG}${n}` });
    return { p, P, rt, rooms, users, guest, t: Object.fromEntries(Object.entries(users).map(([k, u]) => [k, tok(u)])) };
  }
  let seq = 0;
  async function mkStay(ctx, { status = 'in_house', arrival = addDays(today, -2), departure = addDays(today, 1), room = ctx.rooms[0], rate = 500, total } = {}) {
    seq += 1;
    const nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000);
    const r = await Reservation.create({
      property: ctx.P, confirmationNumber: `${TAG}-${seq}`, status, primaryGuest: ctx.guest._id, adults: 2,
      arrivalDate: arrival, departureDate: departure, nights, roomsCount: 1, roomType: ctx.rt._id, ratePerNight: rate,
      totalAmount: total ?? rate * nights, assignedRoom: room._id, checkedInAt: status === 'in_house' ? new Date() : undefined, guaranteeType: 'credit_card',
    });
    await ReservationRoom.create({ reservation: r._id, property: ctx.P, roomTypeBooked: ctx.rt._id, assignedRoom: room._id, arrivalDate: arrival, departureDate: departure, nightlyRate: rate, status: status === 'in_house' ? 'in_house' : 'reserved' });
    const folio = await Folio.create({ property: ctx.P, reservation: r._id, ownerType: 'guest', lines: [] });
    return { r, folio };
  }

  try {
    const A = await mkProperty('A');
    const { P } = A;
    const M = A.t.property_admin; const R = A.t.receptionist; const F = A.t.finance_manager; const H = A.t.housekeeper;

    // ── FIN-01 ──────────────────────────────────────────────────────────────
    const s1 = await mkStay(A);
    let r = await call('GET', `/finance/stays/${s1.r._id}?propertyId=${P}`, R);
    check('FIN-01 stay view returns folio windows and the guarantee separately', r.status === 200 && r.data.folios.length === 1 && r.data.guarantee.type === 'credit_card' && r.data.folios[0].totals.payments === 0, r.error);
    r = await call('GET', `/finance/stays/${s1.r._id}?propertyId=${P}`, H);
    check('RBAC: housekeeper cannot read folios', r.status === 403, r.status);

    // ── FIN-02 charge ───────────────────────────────────────────────────────
    const k1 = key();
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, description: 'מיניבר', department: 'minibar', quantity: 2, unitPrice: 59, idempotencyKey: k1 });
    const r2 = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, description: 'מיניבר', department: 'minibar', quantity: 2, unitPrice: 59, idempotencyKey: k1 });
    let f1 = await Folio.findById(s1.folio._id).lean();
    const ch = f1.lines.find((l) => l.department === 'minibar');
    check('FIN-02 charge 2×59 gross: VAT extracted (100 + 18), posted once for the same key', r.status === 200 && r2.data?.duplicate === true && f1.lines.length === 1 && Math.abs(ch.amount - 100) < 0.01 && Math.abs(ch.taxAmount - 18) < 0.01, JSON.stringify(r).slice(0, 160));
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, description: 'ספא', department: 'spa', quantity: 1, unitPrice: 100, serviceDate: addDays(today, 3), idempotencyKey: key() });
    check('FIN-02 service date after the business day is refused', r.status === 422 && r.fields?.serviceDate, r.status);
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${ch._id}/reverse`, R, { propertyId: P, reason: 'טעות' });
    check('FIN-02 receptionist cannot reverse a charge', r.status === 403, r.status);
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${ch._id}/reverse`, M, { propertyId: P });
    check('FIN-02 reversal requires a reason', r.status === 422, r.status);
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${ch._id}/reverse`, M, { propertyId: P, reason: 'נרשם בטעות' });
    f1 = await Folio.findById(s1.folio._id).lean();
    check('FIN-02 reversal is a linked counter line; nothing deleted; balance 0', r.status === 200 && f1.lines.length === 2 && f1.lines[0].status === 'posted' && String(f1.lines[1].reversalOf) === String(ch._id) && Math.abs(balOf(f1)) < 0.01, JSON.stringify(r).slice(0, 160));
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${ch._id}/reverse`, M, { propertyId: P, reason: 'שוב' });
    check('FIN-02 the same charge cannot be reversed twice', r.status === 409, r.status);

    // A charge on an issued document cannot be reversed (T18) — correction is a credit note.
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, description: 'חניה', department: 'parking', quantity: 1, unitPrice: 1180, idempotencyKey: key() });
    f1 = await Folio.findById(s1.folio._id).lean();
    const parking = f1.lines.find((l) => l.department === 'parking');
    const inv = await Invoice.create({
      property: P, folio: s1.folio._id, reservation: s1.r._id, type: 'tax_invoice', invoiceNumber: `${TAG}-INV1`, status: 'issued',
      issueDate: today, seller: { name: 'בדיקה' }, buyer: { name: 'אורח' }, vatRate: 18, totalNet: 1000, totalVat: 180, totalGross: 1180,
      lines: [{ description: 'חניה', quantity: 1, unitPrice: 1000, netAmount: 1000, vatRate: 18, vatAmount: 180, grossAmount: 1180, folioLineId: parking._id }],
    });
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${parking._id}/reverse`, M, { propertyId: P, reason: 'ביטול' });
    check('FIN-02 a charge on an issued document cannot be reversed (T18)', r.status === 409 && r.code === 'on_document', r.status);

    // ── FIN-07 credit note ──────────────────────────────────────────────────
    const invBeforeCredit = await Invoice.findById(inv._id).lean();
    const creditCountBefore = await Invoice.countDocuments({ property: P, type: 'credit_note' });
    r = await call('POST', `/finance/invoices/${inv._id}/credit-note`, R, { propertyId: P, idempotencyKey: key(), amount: 100, reason: 'החזר' });
    check('FIN-07 receptionist cannot issue a credit note', r.status === 403, r.status);
    r = await call('POST', `/finance/invoices/${inv._id}/credit-note`, F, { propertyId: P, idempotencyKey: key(), amount: 100 });
    check('FIN-07 credit note requires a reason', r.status === 422, r.status);
    r = await call('POST', `/finance/invoices/${inv._id}/credit-note`, F, { propertyId: P, idempotencyKey: key(), amount: 700, reason: 'שירות חלקי' });
    const r2b = await call('POST', `/finance/invoices/${inv._id}/credit-note`, F, { propertyId: P, idempotencyKey: key(), amount: 700, reason: 'שוב' });
    const invAfter = await Invoice.findById(inv._id).lean();
    check('FIN-07 local credit issuance is refused with an explicit external-issuer gate', r.status === 409 && r.code === 'managed_by_invoicer' && r2b.status === 409 && r2b.code === 'managed_by_invoicer', `${r.status}/${r2b.status} ${r2b.error || ''}`);
    check('FIN-07 refused local credits leave the original document and credit count unchanged', JSON.stringify(invAfter) === JSON.stringify(invBeforeCredit) && await Invoice.countDocuments({ property: P, type: 'credit_note' }) === creditCountBefore);

    // ── FIN-03 payment / deposit ────────────────────────────────────────────
    const s2 = await mkStay(A, { room: A.rooms[1] });
    await call('POST', `/finance/folios/${s2.folio._id}/charges`, R, { propertyId: P, description: 'ארוחה', department: 'f_and_b', quantity: 1, unitPrice: 500, idempotencyKey: key() });
    r = await call('POST', `/finance/folios/${s2.folio._id}/payments`, R, { propertyId: P, amount: 600, method: 'cash', idempotencyKey: key() });
    check('FIN-03 payment above the balance is refused', r.status === 422, r.status);
    r = await call('POST', `/finance/folios/${s2.folio._id}/payments`, R, { propertyId: P, amount: 200, method: 'bank_transfer', idempotencyKey: key() });
    check('FIN-03 bank transfer requires a reference and a transfer date', r.status === 422 && r.fields?.reference && r.fields?.payDate, JSON.stringify(r.fields));
    const pk = key();
    r = await call('POST', `/finance/folios/${s2.folio._id}/payments`, R, { propertyId: P, amount: 500, method: 'cash', idempotencyKey: pk });
    const rDup = await call('POST', `/finance/folios/${s2.folio._id}/payments`, R, { propertyId: P, amount: 500, method: 'cash', idempotencyKey: pk });
    check('FIN-03 payment recorded once for the same key', r.status === 200 && rDup.data?.duplicate === true && Math.abs(rDup.data.balance) < 0.01, r.error);
    const s3 = await mkStay(A, { status: 'confirmed', arrival: addDays(today, 5), departure: addDays(today, 7), room: A.rooms[2], rate: 400 });
    r = await call('POST', `/finance/folios/${s3.folio._id}/payments`, R, { propertyId: P, amount: 300, method: 'credit_card', details: { last4: '4242', approval: 'AB1234' }, kind: 'deposit', idempotencyKey: key() });
    const rOver = await call('POST', `/finance/folios/${s3.folio._id}/payments`, R, { propertyId: P, amount: 600, method: 'credit_card', details: { last4: '4242', approval: 'AB1235' }, kind: 'deposit', idempotencyKey: key() });
    check('FIN-03 deposit before arrival is allowed up to the stay total', r.status === 200 && rOver.status === 422, `${r.status}/${rOver.status}`);
    await Property.updateOne({ _id: P }, { $set: { 'financePolicy.cashLimitPerStay': 1000 } });
    const s4 = await mkStay(A, { room: A.rooms[3] });
    await call('POST', `/finance/folios/${s4.folio._id}/charges`, R, { propertyId: P, description: 'אירוע', department: 'other', quantity: 1, unitPrice: 2000, idempotencyKey: key() });
    r = await call('POST', `/finance/folios/${s4.folio._id}/payments`, R, { propertyId: P, amount: 800, method: 'cash', idempotencyKey: key() });
    const rCash = await call('POST', `/finance/folios/${s4.folio._id}/payments`, R, { propertyId: P, amount: 300, method: 'cash', idempotencyKey: key() });
    check('FIN-03 cash is checked cumulatively per stay (T25 policy)', r.status === 200 && rCash.status === 422 && rCash.code === 'cash_limit', `${r.status}/${rCash.status}`);
    await Property.updateOne({ _id: P }, { $set: { 'financePolicy.cashLimitPerStay': null } });

    // ── FIN-04 refund ───────────────────────────────────────────────────────
    // Deposit 300 on s3 is a credit of 300 (no charges yet).
    const f3 = await Folio.findById(s3.folio._id).lean();
    const dep = f3.lines.find((l) => l.type === 'deposit');
    r = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, R, { propertyId: P, amount: 100, reasonCode: 'cancellation', idempotencyKey: key() });
    check('FIN-04 refund above the approval threshold is blocked for a receptionist (T36)', r.status === 403 && r.code === 'approval_required', r.status);
    r = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, F, { propertyId: P, amount: 100, idempotencyKey: key() });
    check('FIN-04 refund requires a reason', r.status === 422 && r.fields?.reasonCode, r.status);
    const ra = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, F, { propertyId: P, amount: 200, reasonCode: 'overpayment', idempotencyKey: key() });
    const rb = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, F, { propertyId: P, amount: 200, reasonCode: 'overpayment', idempotencyKey: key() });
    const rc = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, F, { propertyId: P, amount: 100, reasonCode: 'overpayment', idempotencyKey: key() });
    check('FIN-04 partial refunds are capped cumulatively per payment (T16)', ra.status === 200 && rb.status === 422 && rc.status === 200 && rc.data.refundable === 0, `${ra.status}/${rb.status}/${rc.status}`);
    const f2 = await Folio.findById(s2.folio._id).lean();
    const cashPay = f2.lines.find((l) => l.type === 'payment');
    r = await call('POST', `/finance/folios/${s2.folio._id}/payments/${cashPay._id}/refund`, F, { propertyId: P, amount: 100, reasonCode: 'complaint', idempotencyKey: key() });
    check('FIN-04 a refund cannot turn a settled folio into a debt', r.status === 422 && r.code === 'exceeds_credit', r.status);
    r = await call('GET', `/finance/folios?propertyId=${P}&view=credit`, F);
    check('FIN-01 folio index lists folios', r.status === 200 && Array.isArray(r.data.rows), r.status);

    // ── FIN-12 day close on property A (full run) ───────────────────────────
    const arrival = await mkStay(A, { status: 'confirmed', arrival: today, departure: addDays(today, 2), room: A.rooms[3] });
    const leaving = await mkStay(A, { arrival: addDays(today, -1), departure: today, room: A.rooms[2] });
    let dc = await call('GET', `/finance/day-close?propertyId=${P}`, M);
    check('FIN-12 readiness lists the pending arrival and the departure not checked out', dc.status === 200 && dc.data.dateToClose === today && dc.data.readiness.arrivals.some((a) => a.id === String(arrival.r._id)) && dc.data.readiness.departures.some((d) => d.id === String(leaving.r._id)), JSON.stringify(dc.data?.readiness || dc).slice(0, 200));
    check('FIN-12 readiness previews the nights to post (does not charge)', dc.data.readiness.nights.count > 0 && (await Folio.findById(s1.folio._id).lean()).lines.every((l) => l.department !== 'rooms'));
    r = await call('POST', '/finance/day-close/run', R, { propertyId: P });
    check('RBAC: receptionist cannot run day close', r.status === 403, r.status);
    r = await call('POST', '/finance/day-close/run', M, { propertyId: P });
    check('FIN-12 open arrivals/departures require explicit decisions', r.status === 422 && r.code === 'decisions_required' && r.fields?.arrivals, r.status);
    r = await call('POST', '/finance/day-close/run', M, { propertyId: P, date: addDays(today, 1), arrivals: 'keep', reason: 'מאחרים' });
    check('FIN-12 a future day cannot be closed', r.status === 409, r.status);
    r = await call('POST', '/finance/day-close/run', M, { propertyId: P, arrivals: 'keep', reason: 'האורחים מאחרים — יגיעו בלילה' });
    const nightsA = (await Folio.findById(s1.folio._id).lean()).lines.filter((l) => l.department === 'rooms').length;
    check('FIN-12 run completes: steps done, nights posted through the business day', r.status === 200 && r.data.status === 'done' && r.data.steps.find((s) => s.key === 'post_nights').status === 'done' && nightsA === 3, JSON.stringify(r).slice(0, 220));
    check('FIN-12 "keep" leaves the arrival open (no silent no-show)', (await Reservation.findById(arrival.r._id).lean()).status === 'confirmed');
    check('FIN-12 snapshot report recorded for the day', !!r.data?.steps?.find((s) => s.key === 'snapshot')?.result?.roomNights);
    r = await call('POST', '/finance/day-close/run', M, { propertyId: P, arrivals: 'keep', reason: 'שוב' });
    check('FIN-12 the same day cannot be closed twice', r.status === 409 && r.code === 'already_closed', r.status);
    check('FIN-12 the property records the last closed day', (await Property.findById(P).lean()).dayClose?.lastClosedDate === today);

    // ── FIN-12 resume after a failure (T33) on property B ───────────────────
    const B = await mkProperty('B');
    const sb = await mkStay(B);
    const pending = await mkStay(B, { status: 'confirmed', arrival: today, departure: addDays(today, 1), room: B.rooms[1] });
    // A first attempt posted the nights and then stopped before no-shows.
    const postedFirst = await postNightsUntil({ reservation: await Reservation.findById(sb.r._id), until: addDays(today, 1), source: 'night_audit' });
    await DayCloseRun.create({
      property: B.P, businessDate: today, runNo: `DC-${today.replace(/-/g, '')}`, status: 'running', attempts: 1, heartbeatAt: new Date(),
      options: { arrivals: 'no_show', reason: 'לא הגיעו' },
      steps: [{ key: 'post_nights', status: 'done', result: { posted: postedFirst } }, { key: 'no_shows', status: 'running' }, { key: 'snapshot', status: 'pending' }, { key: 'advance', status: 'pending' }],
    });
    r = await call('POST', '/finance/day-close/run', B.t.property_admin, { propertyId: B.P, arrivals: 'no_show', reason: 'לא הגיעו' });
    check('FIN-12 a second operator is refused while a run is active', r.status === 409 && r.code === 'busy', r.status);
    await DayCloseRun.updateOne({ property: B.P, businessDate: today }, { $set: { status: 'failed', 'steps.1.status': 'failed', 'steps.1.error': 'נפל באמצע' } });
    r = await call('POST', '/finance/day-close/run', B.t.property_admin, { propertyId: B.P, arrivals: 'no_show', reason: 'לא הגיעו' });
    const nightsB = (await Folio.find({ reservation: sb.r._id }).lean()).flatMap((f) => f.lines).filter((l) => l.department === 'rooms').length;
    check('FIN-12 resume continues from the failed step without posting nights twice (T33)', r.status === 200 && r.data.status === 'done' && r.data.attempts === 2 && postedFirst === 3 && nightsB === 3, JSON.stringify({ s: r.status, st: r.data?.status, a: r.data?.attempts, postedFirst, nightsB }));
    check('FIN-12 no-show decision applied on resume', (await Reservation.findById(pending.r._id).lean()).status === 'no_show');

    // Legacy night audit no longer writes.
    r = await call('POST', '/reports/night-audit', M, { propertyId: P });
    check('Legacy night audit write is closed (moved to FIN-12)', r.status === 410, r.status);
  } finally {
    const resIds = (await Reservation.find({ property: { $in: props } }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: { $in: props } }, { entityId: { $in: [...props, ...resIds] } }] });
    await removeFiscalTestFixtures(props, TAG);
    // Explicit raw cleanup of the throw-away fixture properties; runtime deletes stay guarded.
    await Folio.collection.deleteMany({ property: { $in: props } });
    await ReservationRoom.deleteMany({ property: { $in: props } });
    await Reservation.deleteMany({ property: { $in: props } });
    await DayCloseRun.deleteMany({ property: { $in: props } });
    await InventoryDate.deleteMany({ property: { $in: props } });
    await HousekeepingTask.deleteMany({ property: { $in: props } });
    await GuestProfile.deleteMany({ property: { $in: props } });
    await ChargeCode.deleteMany({ property: { $in: props } });
    await WorkItem.deleteMany({ property: { $in: props } });
    await Room.deleteMany({ property: { $in: props } });
    await RoomType.deleteMany({ property: { $in: props } });
    await User.deleteMany({ property: { $in: props } });
    await Property.deleteMany({ _id: { $in: props } });
    await mongoose.disconnect();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
