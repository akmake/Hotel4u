#!/usr/bin/env node
/* eslint-disable no-console */
// Books integration suite — gaps from docs/specification/13-opera-gap-analysis.md:
//   G1 charge-code & payment-method catalogue (ADM-13) and every posting path going through it;
//   G4 day-close ledgers, trial balance, opening check and manager flash;
//   G6 reinstate cancelled/no-show, reverse check-in, post-stay charge, close settled window.
// Runs against a live PMS server and the same DB, on throw-away properties removed at the end.
//
//   node scripts/booksIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Folio from '../models/Folio.js';
import Invoice from '../models/Invoice.js';
import DayCloseRun from '../models/DayCloseRun.js';
import InventoryDate from '../models/InventoryDate.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import AuditLog from '../models/AuditLog.js';
import ChargeCode from '../models/ChargeCode.js';
import WorkItem from '../models/WorkItem.js';
import OperationLock from '../models/OperationLock.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { signPmsToken } from '../controllers/authController.js';
import { postNightsUntil } from '../services/roomCharges.js';
import { issueInvoiceFromFolio } from '../services/invoiceService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const TAG = `BKS${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
async function call(method, url, t, body, base = BASE) {
  const res = await fetch(`${base}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const key = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const props = [];
  const today = todayYmdInTimezone('Asia/Jerusalem');

  async function mkProperty(n) {
    const p = await Property.create({ name: `בדיקה ${TAG}-${n}`, timezone: 'Asia/Jerusalem', vatRate: 18, invoicePrefix: `${TAG}${n}`, invoiceSequence: 0 });
    props.push(p._id);
    const P = String(p._id);
    const rt = await RoomType.create({ property: P, code: `${TAG}${n}`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    const rooms = [];
    for (let i = 1; i <= 4; i += 1) rooms.push(await Room.create({ property: P, roomType: rt._id, number: `${n}0${i}`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' }));
    const users = {};
    for (const role of ['property_admin', 'front_desk_manager', 'receptionist', 'finance_manager', 'housekeeper']) {
      users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${n}-${role}@test.local`, passwordHash: 'x', role, active: true });
    }
    const guest = await GuestProfile.create({ property: P, firstName: 'אורח', lastName: `${TAG}${n}` });
    return { p, P, rt, rooms, users, guest, t: Object.fromEntries(Object.entries(users).map(([k, u]) => [k, signPmsToken(u)])) };
  }
  let seq = 0;
  async function mkStay(ctx, { status = 'in_house', arrival = addDays(today, -2), departure = addDays(today, 1), room = ctx.rooms[0], rate = 500, checkedInAt, checkedOutAt, unitStatus } = {}) {
    seq += 1;
    const nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000);
    const r = await Reservation.create({
      property: ctx.P, confirmationNumber: `${TAG}-${seq}`, status, primaryGuest: ctx.guest._id, adults: 2,
      arrivalDate: arrival, departureDate: departure, nights, roomsCount: 1, roomType: ctx.rt._id, ratePerNight: rate,
      totalAmount: rate * nights, assignedRoom: room?._id, guaranteeType: 'credit_card',
      checkedInAt: checkedInAt ?? (status === 'in_house' ? new Date() : undefined), checkedOutAt,
      cancelledAt: status === 'cancelled' ? new Date() : undefined, noShowAt: status === 'no_show' ? new Date() : undefined,
    });
    const us = unitStatus || ({ in_house: 'in_house', cancelled: 'cancelled', no_show: 'no_show', checked_out: 'checked_out' }[status] || 'reserved');
    await ReservationRoom.create({ reservation: r._id, property: ctx.P, roomTypeBooked: ctx.rt._id, assignedRoom: room?._id, arrivalDate: arrival, departureDate: departure, nightlyRate: rate, status: us });
    const folio = await Folio.create({ property: ctx.P, reservation: r._id, ownerType: 'guest', lines: [] });
    return { r, folio };
  }
  async function stock(ctx, from, to, physical, booked = 0) {
    for (let d = from; d < to; d = addDays(d, 1)) {
      await InventoryDate.updateOne({ property: ctx.P, roomType: ctx.rt._id, date: d }, { $set: { physicalCount: physical, bookedCount: booked, oooCount: 0, blockedCount: 0, tentativeCount: 0, overbookingLimit: 0 } }, { upsert: true });
    }
  }

  try {
    // ════════════════ G1 — catalogue ════════════════
    const A = await mkProperty('A');
    const { P } = A;
    const M = A.t.property_admin; const FM = A.t.front_desk_manager; const R = A.t.receptionist; const F = A.t.finance_manager; const H = A.t.housekeeper;

    let r = await call('GET', `/finance/charge-codes?propertyId=${P}&all=1`, R);
    const codes = r.data?.codes || [];
    check('G1 catalogue is seeded on first read (charges + 5 payment methods)', r.status === 200 && codes.some((c) => c.code === 'rooms' && c.postLevel === 'system') && codes.some((c) => c.code === 'minibar') && codes.filter((c) => c.kind === 'payment').length === 5, JSON.stringify(r).slice(0, 160));
    r = await call('GET', `/finance/charge-codes?propertyId=${P}`, H);
    check('G1 RBAC: housekeeper cannot read the catalogue', r.status === 403, r.status);
    r = await call('POST', `/finance/charge-codes`, R, { propertyId: P, code: 'bike_rental', name: 'השכרת אופניים', revenueGroup: 'other_operated' });
    check('G1 RBAC: receptionist cannot create a code', r.status === 403, r.status);
    r = await call('POST', `/finance/charge-codes`, M, { propertyId: P, code: 'Bike Rental', name: 'השכרת אופניים', revenueGroup: 'other_operated' });
    check('G1 code format is validated', r.status === 422 && r.fields?.code, r.status);
    r = await call('POST', `/finance/charge-codes`, M, { propertyId: P, code: 'bike_rental', name: 'השכרת אופניים', revenueGroup: 'other_operated', defaultPrice: 50, priceEditable: false, glAccount: '4150' });
    const bike = r.data;
    const rDupCode = await call('POST', `/finance/charge-codes`, M, { propertyId: P, code: 'bike_rental', name: 'כפול', revenueGroup: 'misc' });
    check('G1 admin creates a code; the same code twice is a conflict', r.status === 200 && bike?.code === 'bike_rental' && rDupCode.status === 409, `${r.status}/${rDupCode.status} ${r.error || ''}`);
    r = await call('POST', `/finance/charge-codes`, F, { propertyId: P, code: 'tour_exempt', name: 'סיור (פטור)', revenueGroup: 'other_operated', vatClass: 'exempt' });
    const rEx = await call('POST', `/finance/charge-codes`, F, { propertyId: P, code: 'tour_exempt', name: 'סיור (פטור)', revenueGroup: 'other_operated', vatClass: 'exempt', reason: 'שירות לתייר — אושר ע״י רו״ח' });
    check('G1 a VAT-exempt code needs a reason', r.status === 422 && rEx.status === 200, `${r.status}/${rEx.status}`);
    r = await call('PATCH', `/finance/charge-codes/${bike.id}`, M, { propertyId: P, code: 'bike', name: 'אופניים' });
    check('G1 a code is immutable (rename = new code)', r.status === 422 && r.fields?.code, r.status);
    r = await call('PATCH', `/finance/charge-codes/${bike.id}`, M, { propertyId: P, name: 'אופניים', version: '2001-01-01T00:00:00.000Z' });
    check('G1 a stale edit is a conflict', r.status === 409, r.status);
    const roomsCode = codes.find((c) => c.code === 'rooms');
    r = await call('PATCH', `/finance/charge-codes/${roomsCode.id}`, M, { propertyId: P, active: false });
    check('G1 the lodging code cannot be deactivated', r.status === 422, r.status);

    const s1 = await mkStay(A);
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, department: 'bike_rental', quantity: 2, unitPrice: 70, idempotencyKey: key() });
    check('G1 a locked price cannot be changed at posting', r.status === 422 && r.fields?.unitPrice, r.status);
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, department: 'bike_rental', quantity: 2, idempotencyKey: key() });
    let f1 = await Folio.findById(s1.folio._id).lean();
    let ln = f1.lines.find((l) => l.department === 'bike_rental');
    check('G1 locked price is applied (2 × 50 = 100 gross, VAT extracted), description defaults to the code name', r.status === 200 && ln && near(ln.amount + ln.taxAmount, 100) && near(ln.taxAmount, 15.25) && ln.description.startsWith('השכרת אופניים'), JSON.stringify(r).slice(0, 160));
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, department: 'tour_exempt', quantity: 1, unitPrice: 300, idempotencyKey: key() });
    f1 = await Folio.findById(s1.folio._id).lean();
    ln = f1.lines.find((l) => l.department === 'tour_exempt');
    check('G1 an exempt code posts without VAT', r.status === 200 && near(ln.amount, 300) && near(ln.taxAmount, 0), r.error);
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, M, { propertyId: P, department: 'rooms', quantity: 1, unitPrice: 500, idempotencyKey: key() });
    check('G1 lodging cannot be posted by hand (system code)', r.status === 422, r.status);
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, department: 'damage', quantity: 1, unitPrice: 200, idempotencyKey: key() });
    const rDmg = await call('POST', `/finance/folios/${s1.folio._id}/charges`, FM, { propertyId: P, department: 'damage', description: 'מגבת חסרה', quantity: 1, unitPrice: 200, idempotencyKey: key() });
    check('G1 a manager-level code: receptionist refused, shift manager allowed', r.status === 403 && rDmg.status === 200, `${r.status}/${rDmg.status}`);
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, department: 'no_such_code', quantity: 1, unitPrice: 10, idempotencyKey: key() });
    check('G1 an unknown code is refused', r.status === 422 && r.fields?.department, r.status);
    await call('PATCH', `/finance/charge-codes/${bike.id}`, M, { propertyId: P, active: false });
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, department: 'bike_rental', quantity: 1, idempotencyKey: key() });
    check('G1 a deactivated code cannot be posted', r.status === 422, r.status);
    r = await call('POST', `/frontdesk/reservations/${s1.r._id}/charges`, R, { propertyId: P, department: 'minibar', amount: 59, idempotencyKey: key() });
    const rDesk = await call('POST', `/frontdesk/reservations/${s1.r._id}/charges`, R, { propertyId: P, department: 'no_such_code', amount: 59, idempotencyKey: key() });
    check('G1 desk service charge goes through the catalogue', r.status === 200 && rDesk.status === 422, `${r.status}/${rDesk.status}`);

    // payment methods
    const pm = (await call('GET', `/finance/charge-codes?propertyId=${P}&kind=payment&all=1`, M)).data.codes;
    const cheque = pm.find((c) => c.code === 'cheque');
    await call('PATCH', `/finance/charge-codes/${cheque.id}`, M, { propertyId: P, active: false });
    r = await call('POST', `/finance/folios/${s1.folio._id}/payments`, R, { propertyId: P, amount: 10, method: 'cheque', methodRef: '1234', idempotencyKey: key() });
    check('G1 a deactivated payment method is refused', r.status === 422 && r.fields?.method, r.status);
    r = await call('PATCH', `/finance/charge-codes/${pm.find((c) => c.code === 'voucher').id}`, M, { propertyId: P, requireReference: false });
    check('G1 voucher/transfer/cheque always need a reference', r.status === 422, r.status);
    const cash = pm.find((c) => c.code === 'cash');
    await call('PATCH', `/finance/charge-codes/${cash.id}`, M, { propertyId: P, requireReference: true });
    r = await call('POST', `/finance/folios/${s1.folio._id}/payments`, R, { propertyId: P, amount: 10, method: 'cash', idempotencyKey: key() });
    check('G1 a property may require a reference for cash', r.status === 422 && r.fields?.methodRef, r.status);
    await call('PATCH', `/finance/charge-codes/${cash.id}`, M, { propertyId: P, requireReference: false });
    for (const c of pm.filter((x) => x.code !== 'cash')) await call('PATCH', `/finance/charge-codes/${c.id}`, M, { propertyId: P, active: false });
    r = await call('PATCH', `/finance/charge-codes/${cash.id}`, M, { propertyId: P, active: false });
    check('G1 at least one payment method stays active', r.status === 422, r.status);
    for (const c of pm) await call('PATCH', `/finance/charge-codes/${c.id}`, M, { propertyId: P, active: true });

    // legacy paths
    const before = (await Folio.findById(s1.folio._id).lean()).lines.length;
    r = await call('POST', `/folio/${s1.folio._id}/charge`, R, { description: 'מיני בר ישן', amount: 118, department: 'minibar' });
    f1 = await Folio.findById(s1.folio._id).lean();
    ln = f1.lines[f1.lines.length - 1];
    check('G1 legacy folio charge goes through the finance service (VAT extracted, catalogue code)', r.status === 200 && f1.lines.length === before + 1 && near(ln.taxAmount, 18) && ln.department === 'minibar', JSON.stringify(r).slice(0, 160));
    r = await call('POST', `/folio/${s1.folio._id}/charge`, R, { description: 'x', amount: 10, department: 'whatever' });
    check('G1 legacy folio charge with an unknown code is refused', r.status === 422, r.status);
    r = await call('POST', `/folio/${s1.folio._id}/void-line`, M, { lineId: String(ln._id), reason: 'x' });
    const rLegPay = await call('POST', '/payments', M, { propertyId: P, folioId: String(s1.folio._id), amount: 10, paymentMethod: 'cash' });
    const rLegRoute = await call('POST', '/folio-routing/apply', M, { propertyId: P });
    check('G1 legacy line deletion, direct payment and routing writes are closed (410)', r.status === 410 && rLegPay.status === 410 && rLegRoute.status === 410, `${r.status}/${rLegPay.status}/${rLegRoute.status}`);
    r = await call('POST', `/reservations/${s1.r._id}/add-service`, R, { description: 'שירות', amount: 118, department: 'spa' });
    f1 = await Folio.findById(s1.folio._id).lean();
    ln = f1.lines[f1.lines.length - 1];
    check('G1 legacy add-service extracts VAT from the guest price (no flat 17% rounding)', r.status === 201 && ln.department === 'spa' && near(ln.taxAmount, 18) && near(ln.amount, 100), JSON.stringify(r).slice(0, 160));
    const auditCount = await AuditLog.countDocuments({ property: P, action: 'charge_code.updated' });
    check('G1 catalogue edits are audited', auditCount >= 3, auditCount);

    // ════════════════ G4 — books ════════════════
    const B = await mkProperty('B');
    const BM = B.t.property_admin; const BR = B.t.receptionist;
    const inh = await mkStay(B, { arrival: addDays(today, -1), departure: addDays(today, 2) });
    const fut = await mkStay(B, { status: 'confirmed', arrival: addDays(today, 5), departure: addDays(today, 7), room: B.rooms[1] });
    await call('POST', `/finance/folios/${inh.folio._id}/charges`, BR, { propertyId: B.P, department: 'f_and_b', quantity: 1, unitPrice: 236, idempotencyKey: key() });
    await call('POST', `/finance/folios/${inh.folio._id}/payments`, BR, { propertyId: B.P, amount: 100, method: 'cash', idempotencyKey: key() });
    await call('POST', `/finance/folios/${fut.folio._id}/payments`, BR, { propertyId: B.P, amount: 300, method: 'credit_card', kind: 'deposit', idempotencyKey: key() });
    r = await call('GET', `/finance/day-close/report?propertyId=${B.P}&date=${today}`, BR);
    check('G4 RBAC: receptionist cannot read day-close books', r.status === 403, r.status);
    r = await call('GET', `/finance/day-close/report?propertyId=${B.P}&date=${today}`, BM);
    let L = r.data?.ledger;
    check('G4 trial balance: opening 0 + charges 236 − payments 400 = closing −164, balanced', r.status === 200 && near(L.trial.opening, 0) && near(L.trial.charges, 236) && near(L.trial.payments, 400) && near(L.trial.closing, -164) && near(L.trial.difference, 0), JSON.stringify(L?.trial || r).slice(0, 200));
    check('G4 ledgers split: guest +136 (in house), deposit −300 (future arrival)', near(L.ledgers.guest.balance, 136) && near(L.ledgers.deposit.balance, -300) && near(L.ledgers.ar.balance, 0), JSON.stringify(L?.ledgers));
    check('G4 revenue by code with VAT split and group', L.revenue.rows.some((x) => x.code === 'f_and_b' && near(x.net, 200) && near(x.tax, 36) && x.revenueGroup === 'f_and_b'), JSON.stringify(L?.revenue?.rows));
    check('G4 receipts by method (cash 100, card 300)', L.payments.some((x) => x.method === 'cash' && near(x.amount, 100)) && L.payments.some((x) => x.method === 'credit_card' && near(x.amount, 300)), JSON.stringify(L?.payments));
    r = await call('GET', `/finance/day-close/report?propertyId=${B.P}&date=${addDays(today, 3)}`, BM);
    check('G4 a future day has no report', r.status === 422, r.status);

    r = await call('POST', '/finance/day-close/run', BM, { propertyId: B.P });
    const ledStep = r.data?.steps?.find((s) => s.key === 'ledgers');
    check('G4 day close stores the trial balance and ledgers', r.status === 200 && r.data.status === 'done' && ledStep?.status === 'done' && near(ledStep.result.trial.closing + 0, ledStep.result.trial.opening + ledStep.result.trial.charges - ledStep.result.trial.payments + ledStep.result.trial.refunds + ledStep.result.trial.adjustments), JSON.stringify(r).slice(0, 240));
    check('G4 room night posted by the close counts in the closed day', ledStep && ledStep.result.revenue.groups.some((g) => g.key === 'rooms' && g.gross > 0), JSON.stringify(ledStep?.result?.revenue));
    const closedClosing = ledStep?.result?.trial?.closing;
    // A charge posted after the close belongs to the next business day, not to the closed one.
    await call('POST', `/finance/folios/${inh.folio._id}/charges`, BR, { propertyId: B.P, department: 'minibar', quantity: 1, unitPrice: 59, idempotencyKey: key() });
    r = await call('GET', `/finance/day-close/report?propertyId=${B.P}&date=${today}`, BM);
    check('G4 a posting after the close does not change the closed day', r.status === 200 && r.data.closed === true && near(r.data.ledger.trial.closing, closedClosing) && r.data.checks.find((c) => c.key === 'closed_changed')?.ok === true, JSON.stringify(r.data?.checks || r).slice(0, 220));
    r = await call('GET', `/finance/day-close/report?propertyId=${B.P}&date=${addDays(today, 1)}`, BM);
    check('G4 …it opens the next day: opening = stored close, charge 59', r.status === 200 && near(r.data.ledger.trial.opening, closedClosing) && near(r.data.ledger.trial.charges, 59) && r.data.checks.find((c) => c.key === 'opening')?.ok === true, JSON.stringify(r.data?.ledger?.trial || r).slice(0, 200));
    check('G4 manager flash has day / month / year figures', r.data?.flash?.mtd && typeof r.data.flash.ytd.occupancyPct === 'number');
    // Editing a line of the closed day afterwards is detected.
    await Folio.updateOne({ _id: inh.folio._id, 'lines.department': 'f_and_b' }, { $inc: { 'lines.$.amount': -50 } });
    r = await call('GET', `/finance/day-close/report?propertyId=${B.P}&date=${today}`, BM);
    const r2 = await call('GET', `/finance/day-close/report?propertyId=${B.P}&date=${addDays(today, 1)}`, BM);
    check('G4 changing history of a closed day is caught (closed day + next opening)', r.data.checks.find((c) => c.key === 'closed_changed')?.ok === false && r2.data.checks.find((c) => c.key === 'opening')?.ok === false, JSON.stringify(r2.data?.checks).slice(0, 220));

    // Opening check inside the run: yesterday stored with a different closing → urgent work item, run still done.
    const C = await mkProperty('C');
    await DayCloseRun.create({
      property: C.P, businessDate: addDays(today, -1), runNo: `DC-${addDays(today, -1).replace(/-/g, '')}`, status: 'done', attempts: 1, finishedAt: new Date(Date.now() - 3600000),
      steps: [{ key: 'ledgers', status: 'done', result: { trial: { opening: 0, charges: 0, adjustments: 0, payments: 0, refunds: 0, closing: 999, difference: 0 } } }],
    });
    await Property.updateOne({ _id: C.P }, { $set: { 'dayClose.lastClosedDate': addDays(today, -1) } });
    r = await call('POST', '/finance/day-close/run', C.t.property_admin, { propertyId: C.P });
    const cStep = r.data?.steps?.find((s) => s.key === 'ledgers');
    const wi = await WorkItem.findOne({ property: C.P, dedupeKey: `ledger:${today}` }).lean();
    check('G4 a broken opening does not stop the night but opens an urgent finance item', r.data?.status === 'done' && cStep?.result?.checks?.some((c) => c.key === 'opening' && c.ok === false) && wi?.severity === 'urgent', JSON.stringify({ st: r.data?.status, wi: !!wi, e: r.error }));

    // ════════════════ G6 — walking back ════════════════
    const D = await mkProperty('D');
    const DM = D.t.front_desk_manager; const DR = D.t.receptionist; const DA = D.t.property_admin;
    await stock(D, today, addDays(today, 10), 1, 0);
    const cx = await mkStay(D, { status: 'cancelled', arrival: addDays(today, 2), departure: addDays(today, 4), room: D.rooms[0] });
    r = await call('POST', `/stay/${cx.r._id}/reinstate`, DR, { propertyId: D.P });
    check('G6 reinstate requires a reason', r.status === 422, r.status);
    r = await call('GET', `/stay/${cx.r._id}/reinstate?propertyId=${D.P}`, DR);
    check('G6 reinstate preview: allowed, stock available', r.status === 200 && r.data.allowed === true, JSON.stringify(r).slice(0, 200));
    r = await call('POST', `/stay/${cx.r._id}/reinstate`, DR, { propertyId: D.P, reason: 'האורח התחרט וביקש לחדש' });
    const cxAfter = await Reservation.findById(cx.r._id).lean();
    const inv1 = await InventoryDate.findOne({ property: D.P, roomType: D.rt._id, date: addDays(today, 2) }).lean();
    const cxUnit = await ReservationRoom.findOne({ reservation: cx.r._id }).lean();
    check('G6 receptionist reinstates a cancellation: confirmed, stock taken again, unit reserved, history kept', r.status === 200 && cxAfter.status === 'confirmed' && inv1.bookedCount === 1 && cxUnit.status === 'reserved' && cxAfter.reversals?.[0]?.kind === 'reinstate_cancelled', JSON.stringify(r).slice(0, 200));
    const cx2 = await mkStay(D, { status: 'cancelled', arrival: addDays(today, 3), departure: addDays(today, 5), room: null });
    r = await call('POST', `/stay/${cx2.r._id}/reinstate`, DR, { propertyId: D.P, reason: 'לנסות לחדש' });
    check('G6 reinstate is refused when a night has no stock (last room was sold)', r.status === 409, `${r.status} ${r.error || ''}`);
    const cxPast = await mkStay(D, { status: 'cancelled', arrival: addDays(today, -1), departure: addDays(today, 1), room: null });
    r = await call('POST', `/stay/${cxPast.r._id}/reinstate`, DM, { propertyId: D.P, reason: 'מאוחר' });
    check('G6 a cancellation whose arrival passed is not reinstated', r.status === 409, r.status);
    await stock(D, today, addDays(today, 2), 3, 0);
    const ns = await mkStay(D, { status: 'no_show', arrival: addDays(today, -1), departure: addDays(today, 2), room: D.rooms[1] });
    r = await call('POST', `/stay/${ns.r._id}/reinstate`, DR, { propertyId: D.P, reason: 'הגיע בשתיים בלילה' });
    const rNs = await call('POST', `/stay/${ns.r._id}/reinstate`, DM, { propertyId: D.P, reason: 'הגיע בשתיים בלילה' });
    check('G6 reinstating a no-show: receptionist refused, shift manager allowed', r.status === 403 && rNs.status === 200 && (await Reservation.findById(ns.r._id).lean()).status === 'confirmed', `${r.status}/${rNs.status} ${rNs.error || ''}`);
    // Assigned room taken meanwhile → reinstated without the room.
    await stock(D, addDays(today, 6), addDays(today, 8), 3, 0);
    const holder = await mkStay(D, { status: 'confirmed', arrival: addDays(today, 6), departure: addDays(today, 8), room: D.rooms[2] });
    const cx3 = await mkStay(D, { status: 'cancelled', arrival: addDays(today, 6), departure: addDays(today, 8), room: D.rooms[2] });
    r = await call('POST', `/stay/${cx3.r._id}/reinstate`, DR, { propertyId: D.P, reason: 'חידוש' });
    check('G6 a room taken since the cancellation is released on reinstate', r.status === 200 && r.data.roomReleased === true && !(await Reservation.findById(cx3.r._id).lean()).assignedRoom && !!holder, JSON.stringify(r).slice(0, 160));

    // reverse check-in
    const ci = await mkStay(D, { arrival: today, departure: addDays(today, 2), room: D.rooms[3] });
    await Room.updateOne({ _id: D.rooms[3]._id }, { $set: { occStatus: 'occupied' } });
    r = await call('POST', `/stay/${ci.r._id}/reverse-check-in`, DR, { propertyId: D.P, reason: 'נכנס לחדר הלא נכון' });
    check('G6 receptionist cannot reverse a check-in', r.status === 403, r.status);
    r = await call('POST', `/stay/${ci.r._id}/reverse-check-in`, DM, { propertyId: D.P, reason: 'נכנס לחדר הלא נכון', roomUsed: true });
    const ciAfter = await Reservation.findById(ci.r._id).lean();
    const ciRoom = await Room.findById(D.rooms[3]._id).lean();
    const ciUnit = await ReservationRoom.findOne({ reservation: ci.r._id }).lean();
    check('G6 reverse check-in: confirmed, unit reserved, room vacant and dirty', r.status === 200 && ciAfter.status === 'confirmed' && !ciAfter.checkedInAt && ciUnit.status === 'reserved' && ciRoom.occStatus === 'vacant' && ciRoom.cleanStatus === 'dirty', JSON.stringify(r).slice(0, 160));
    const ciOld = await mkStay(D, { arrival: addDays(today, -1), departure: addDays(today, 2), room: D.rooms[0], checkedInAt: new Date(Date.now() - 30 * 3600000) });
    r = await call('POST', `/stay/${ciOld.r._id}/reverse-check-in`, DM, { propertyId: D.P, reason: 'מאוחר מדי' });
    check('G6 a check-in from an earlier business day is not reversed (early departure instead)', r.status === 409, r.status);
    const ciNight = await mkStay(D, { arrival: today, departure: addDays(today, 2), room: D.rooms[1] });
    await Folio.updateOne({ _id: ciNight.folio._id }, { $push: { lines: { type: 'charge', description: 'לינה', amount: 423.73, taxAmount: 76.27, department: 'rooms', serviceDate: today, source: 'night_audit', status: 'posted', reference: `night:x:${today}` } } });
    r = await call('POST', `/stay/${ciNight.r._id}/reverse-check-in`, DM, { propertyId: D.P, reason: 'טעות' });
    check('G6 a check-in with a posted room night is not reversed', r.status === 409, r.status);

    // post-stay charge
    const co = await mkStay(D, { status: 'checked_out', arrival: addDays(today, -3), departure: today, room: D.rooms[2], checkedOutAt: new Date() });
    await Folio.updateOne({ _id: co.folio._id }, { $set: { status: 'closed', closedAt: new Date() } });
    r = await call('POST', `/finance/folios/${co.folio._id}/charges`, DA, { propertyId: D.P, department: 'minibar', quantity: 1, unitPrice: 59, idempotencyKey: key() });
    check('G6 a closed stay folio takes no regular charge', r.status === 409, r.status);
    r = await call('POST', `/stay/${co.r._id}/post-stay-charge`, DR, { propertyId: D.P, department: 'minibar', quantity: 1, unitPrice: 59, reason: 'מיני בר', idempotencyKey: key() });
    check('G6 receptionist cannot post a post-stay charge', r.status === 403, r.status);
    r = await call('POST', `/stay/${co.r._id}/post-stay-charge`, DM, { propertyId: D.P, department: 'minibar', quantity: 1, unitPrice: 59, idempotencyKey: key() });
    check('G6 post-stay charge requires a reason', r.status === 422, r.status);
    r = await call('POST', `/stay/${co.r._id}/post-stay-charge`, DM, { propertyId: D.P, department: 'minibar', quantity: 2, unitPrice: 59, reason: 'נמצא בבדיקת חדר אחרי יציאה', idempotencyKey: key() });
    const psFolioId = r.data?.folioId;
    const rB = await call('POST', `/stay/${co.r._id}/post-stay-charge`, DM, { propertyId: D.P, department: 'laundry', quantity: 1, unitPrice: 40, reason: 'כביסה שלא נרשמה', idempotencyKey: key() });
    const ps = await Folio.findById(psFolioId).lean();
    const orig = await Folio.findById(co.folio._id).lean();
    check('G6 late charges go to one separate post-stay window; the closed stay folio is untouched', r.status === 200 && rB.data?.folioId === psFolioId && ps.ownerRef === 'post_stay' && ps.lines.length === 2 && orig.status === 'closed' && orig.lines.length === 0, JSON.stringify(r).slice(0, 160));
    r = await call('POST', `/finance/folios/${psFolioId}/charges`, DA, { propertyId: D.P, department: 'minibar', quantity: 1, unitPrice: 10, idempotencyKey: key() });
    check('G6 a regular charge on the post-stay window is refused (post-stay path only)', r.status === 409 && r.code === 'post_stay_required', r.status);
    r = await call('POST', `/finance/folios/${psFolioId}/close`, DR, { propertyId: D.P });
    check('G6 a window with a balance cannot be closed', r.status === 409, r.status);
    await call('POST', `/finance/folios/${psFolioId}/payments`, DR, { propertyId: D.P, amount: 158, method: 'credit_card', idempotencyKey: key() });
    r = await call('POST', `/finance/folios/${psFolioId}/close`, DR, { propertyId: D.P });
    check('G6 a settled post-stay window is closed', r.status === 200 && (await Folio.findById(psFolioId).lean()).status === 'closed', JSON.stringify(r).slice(0, 160));
    r = await call('POST', `/finance/folios/${ci.folio._id}/close`, DR, { propertyId: D.P });
    check('G6 the folio of an active stay is not closed here (check-out does it)', r.status === 409, r.status);
    const coOld = await mkStay(D, { status: 'checked_out', arrival: addDays(today, -50), departure: addDays(today, -45), room: D.rooms[0], checkedOutAt: new Date(Date.now() - 45 * 86400000) });
    r = await call('POST', `/stay/${coOld.r._id}/post-stay-charge`, DM, { propertyId: D.P, department: 'minibar', quantity: 1, unitPrice: 59, reason: 'מאוחר', idempotencyKey: key() });
    check('G6 post-stay window is limited (30 days by default)', r.status === 409, r.status);
    r = await call('POST', `/folio/${co.folio._id}/post-checkout-charge`, DM, { description: 'x', amount: 10, reason: 'x' });
    const rReopen = await call('POST', `/folio/${co.folio._id}/reopen`, DM, { reason: 'x' });
    check('G6 legacy reopen / post-checkout charge are closed (410)', r.status === 410 && rReopen.status === 410, `${r.status}/${rReopen.status}`);
    check('G6 actions are audited', await AuditLog.countDocuments({ property: D.P, action: { $in: ['reservation.reinstated', 'reservation.check_in_reversed', 'folio.post_stay_charge', 'folio.closed'] } }) >= 5);

    // ════════════════ EXT-04 tourist + IL11 cash law ════════════════
    const E = await mkProperty('E');
    const EM = E.t.property_admin; const ER = E.t.receptionist; const EF = E.t.finance_manager;
    const tour = await mkStay(E, { arrival: addDays(today, -1), departure: addDays(today, 2), rate: 590 });
    r = await call('POST', `/stay/${tour.r._id}/tourist`, ER, { propertyId: E.P, nonResident: true });
    check('EXT-04 a non-resident record needs passport country, visa type and entry date', r.status === 422 && r.fields?.passportCountry && r.fields?.visaType && r.fields?.entryDate, r.status);
    r = await call('POST', `/stay/${tour.r._id}/tourist`, ER, { propertyId: E.P, nonResident: true, passportCountry: 'IL', visaType: 'B2', entryDate: addDays(today, -1) });
    check('EXT-04 an Israeli passport is not a tourist', r.status === 422 && r.fields?.passportCountry, r.status);
    r = await call('POST', `/stay/${tour.r._id}/tourist`, ER, { propertyId: E.P, nonResident: true, passportCountry: 'us', visaType: 'B2', entryDate: addDays(today, -1), docLast4: '1234' });
    check('EXT-04 evidence recorded; without an approved property rule the decision is "pending rule" (regular VAT)', r.status === 200 && r.data.decision === 'pending_rule' && r.data.evidence.passportCountry === 'US', JSON.stringify(r.data || r).slice(0, 200));
    await postNightsUntil({ reservation: await Reservation.findById(tour.r._id), until: today, source: 'night_audit' });
    let tf = await Folio.findById(tour.folio._id).lean();
    check('EXT-04 no rule → the night is charged with VAT (no "foreign passport = 0%")', tf.lines.length === 1 && tf.lines[0].taxAmount > 0 && tf.lines[0].vatRate === 18, JSON.stringify(tf.lines.map((l) => [l.taxAmount, l.vatRate])));
    r = await call('PUT', '/finance/tax-policy', ER, { propertyId: E.P, tourist: { enabled: true }, reason: 'x' });
    check('ADM-04 receptionist cannot set the tax rule', r.status === 403, r.status);
    r = await call('PUT', '/finance/tax-policy', EF, { propertyId: E.P, tourist: { enabled: true, visaTypes: ['B2'] }, reason: 'הפעלה' });
    check('ADM-04 enabling the tourist rule needs the approving accountant and the legal basis', r.status === 422 && r.fields?.approvedBy && r.fields?.legalRef, r.status);
    r = await call('PUT', '/finance/tax-policy', EF, { propertyId: E.P, tourist: { enabled: true, visaTypes: ['b/2'], chargeCodes: ['rooms'], approvedBy: 'רו״ח בדיקה', legalRef: 'חוק מע״מ סעיף 30(א)(8)' }, reason: 'אושר ע״י רו״ח' });
    check('ADM-04 rule enabled with approver, legal basis and version', r.status === 200 && r.data.tourist.enabled && r.data.tourist.version === 1 && r.data.tourist.visaTypes[0] === 'B/2', JSON.stringify(r.data || r).slice(0, 200));
    r = await call('GET', `/stay/${tour.r._id}/tourist?propertyId=${E.P}`, ER);
    check('EXT-04 with the approved rule the tourist is eligible; nights already posted with VAT are reported', r.data?.decision === 'eligible' && r.data.postedWithVat === 1, JSON.stringify(r.data).slice(0, 200));
    await postNightsUntil({ reservation: await Reservation.findById(tour.r._id), until: addDays(today, 1), source: 'night_audit' });
    tf = await Folio.findById(tour.folio._id).lean();
    const zeroNight = tf.lines.find((l) => l.serviceDate === today && l.department === 'rooms');
    check('EXT-04 eligible tourist: lodging posts at 0% VAT, without the VAT part of the price (590 → 500), tagged with the rule version', zeroNight && zeroNight.taxAmount === 0 && zeroNight.vatRate === 0 && zeroNight.taxReason === 'tourist_rule_v1' && zeroNight.amount === 500, JSON.stringify(zeroNight));
    await call('POST', `/finance/folios/${tour.folio._id}/charges`, ER, { propertyId: E.P, department: 'minibar', quantity: 1, unitPrice: 118, idempotencyKey: key() });
    tf = await Folio.findById(tour.folio._id).lean();
    const mb = tf.lines.find((l) => l.department === 'minibar');
    check('EXT-04 a service outside the rule (minibar) keeps VAT', mb && Math.abs(mb.taxAmount - 18) < 0.01 && mb.vatRate === 18, JSON.stringify(mb));
    const inv = await issueInvoiceFromFolio({ folioId: tour.folio._id, type: 'tax_invoice', issuedBy: E.users.finance_manager._id, propertyId: E.P });
    const ivNight = inv.lines.find((l) => String(l.folioLineId) === String(zeroNight._id));
    const ivMb = inv.lines.find((l) => String(l.folioLineId) === String(mb._id));
    check('Invoice: each line keeps its posted VAT rate (zero-rated night 0%, minibar 18%)', ivNight?.vatRate === 0 && ivNight?.vatAmount === 0 && ivMb?.vatRate === 18 && Math.abs(ivMb.vatAmount - 18) < 0.01, JSON.stringify(inv.lines.map((l) => [l.vatRate, l.vatAmount])));
    const tour2 = await mkStay(E, { arrival: addDays(today, -1), departure: addDays(today, 2), room: E.rooms[1], rate: 590 });
    await call('POST', `/stay/${tour2.r._id}/tourist`, ER, { propertyId: E.P, nonResident: true, passportCountry: 'FR', visaType: 'A1', entryDate: addDays(today, -2) });
    r = await call('GET', `/stay/${tour2.r._id}/tourist?propertyId=${E.P}`, ER);
    await postNightsUntil({ reservation: await Reservation.findById(tour2.r._id), until: today, source: 'night_audit' });
    const t2 = (await Folio.findById(tour2.folio._id).lean()).lines[0];
    check('EXT-04 a visa type outside the approved list → not eligible, VAT charged', r.data?.decision === 'ineligible' && t2.taxAmount > 0, JSON.stringify({ d: r.data?.decision, t: t2?.taxAmount }));
    // reversed charge is not invoiced
    const tour3 = await mkStay(E, { arrival: addDays(today, -1), departure: addDays(today, 2), room: E.rooms[2] });
    await call('POST', `/finance/folios/${tour3.folio._id}/charges`, ER, { propertyId: E.P, department: 'spa', quantity: 1, unitPrice: 300, idempotencyKey: key() });
    await call('POST', `/finance/folios/${tour3.folio._id}/charges`, ER, { propertyId: E.P, department: 'parking', quantity: 1, unitPrice: 50, idempotencyKey: key() });
    const spa = (await Folio.findById(tour3.folio._id).lean()).lines.find((l) => l.department === 'spa');
    await call('POST', `/finance/folios/${tour3.folio._id}/lines/${spa._id}/reverse`, EM, { propertyId: E.P, reason: 'נרשם בטעות' });
    const inv3 = await issueInvoiceFromFolio({ folioId: tour3.folio._id, type: 'tax_invoice', issuedBy: E.users.finance_manager._id, propertyId: E.P });
    check('Invoice: a reversed charge is not invoiced', inv3.lines.length === 1 && Math.abs(inv3.totalGross - 50) < 0.01, JSON.stringify(inv3.lines.map((l) => [l.description, l.grossAmount])));
    // cash law
    r = await call('PUT', '/finance/tax-policy', EF, { propertyId: E.P, tourist: { enabled: true, visaTypes: ['B/2'], chargeCodes: ['rooms'], approvedBy: 'רו״ח בדיקה', legalRef: 'חוק מע״מ סעיף 30(א)(8)' }, cash: { rule: 'il_2024', threshold: 6000, touristThreshold: 40000 }, reason: 'חוק המזומן', version: 1 });
    check('IL11 cash-law rule can be switched on (gate G05 decision of the owner)', r.status === 200 && r.data.cash.rule === 'il_2024', JSON.stringify(r).slice(0, 160));
    const big = await mkStay(E, { status: 'confirmed', arrival: addDays(today, 5), departure: addDays(today, 9), room: E.rooms[3], rate: 2000 });
    r = await call('POST', `/finance/folios/${big.folio._id}/payments`, ER, { propertyId: E.P, kind: 'deposit', amount: 900, method: 'cash', idempotencyKey: key() });
    const ok800 = await call('POST', `/finance/folios/${big.folio._id}/payments`, ER, { propertyId: E.P, kind: 'deposit', amount: 800, method: 'cash', idempotencyKey: key() });
    check('IL11 resident, 8,000 transaction: cash up to the lower of 10% and 6,000 (800) — 900 refused, 800 accepted', r.status === 422 && r.code === 'cash_law' && ok800.status === 200, `${r.status} ${r.error || ''} / ${ok800.status}`);
    await call('POST', `/stay/${big.r._id}/tourist`, ER, { propertyId: E.P, nonResident: true, passportCountry: 'DE', visaType: 'B/2', entryDate: addDays(today, -1) });
    r = await call('POST', `/finance/folios/${big.folio._id}/payments`, ER, { propertyId: E.P, kind: 'deposit', amount: 5000, method: 'cash', idempotencyKey: key() });
    check('IL11 verified tourist: the 40,000 threshold applies (8,000 in cash allowed)', r.status === 200, `${r.status} ${r.error || ''}`);
    check('EXT-04 tourist record and rule changes are audited', await AuditLog.countDocuments({ property: E.P, action: { $in: ['reservation.tourist_recorded', 'tax_policy.tourist_updated'] } }) >= 5);
  } finally {
    const resIds = (await Reservation.find({ property: { $in: props } }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: { $in: props } }, { entityId: { $in: [...props, ...resIds] } }] });
    await Invoice.deleteMany({ property: { $in: props } });
    await Folio.deleteMany({ property: { $in: props } });
    await ReservationRoom.deleteMany({ property: { $in: props } });
    await Reservation.deleteMany({ property: { $in: props } });
    await DayCloseRun.deleteMany({ property: { $in: props } });
    await InventoryDate.deleteMany({ property: { $in: props } });
    await HousekeepingTask.deleteMany({ property: { $in: props } });
    await GuestProfile.deleteMany({ property: { $in: props } });
    await ChargeCode.deleteMany({ property: { $in: props } });
    await WorkItem.deleteMany({ property: { $in: props } });
    await OperationLock.deleteMany({ key: { $regex: props.map(String).join('|') || '^$' } });
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
