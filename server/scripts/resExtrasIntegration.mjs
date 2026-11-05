#!/usr/bin/env node
/* eslint-disable no-console */
// Waitlist, deposits, confirmations, items, payment methods / privileges / housekeeping (gap-map item 15).
// Live PMS server + same DB, on a throw-away property removed at the end.
//   node scripts/resExtrasIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import AuditLog from '../models/AuditLog.js';
import Folio from '../models/Folio.js';
import Company from '../models/Company.js';
import InventoryDate from '../models/InventoryDate.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import ChargeCode from '../models/ChargeCode.js';
import { RatePlan } from '../models/RatePlan.js';
import { ItemType, ItemBooking } from '../models/Items.js';
import { cleanupWaitlist } from '../services/reservationExtrasService.js';
import { generateTasks } from '../services/operationsService.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `RXT${Date.now().toString(36).toUpperCase()}`;
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${typeof info === 'string' ? info : JSON.stringify(info).slice(0, 400)}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
let P;
async function call(method, url, t, body) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${url}${sep}propertyId=${P}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify({ ...body, propertyId: P }) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const key = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG, reservationSequence: 0 });
  P = String(p._id);
  try {
    const rt = await RoomType.create({ property: P, code: `${TAG}S`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3, adultsMax: 3 });
    const room = await Room.create({ property: P, roomType: rt._id, number: `${TAG.slice(-3)}1`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' });
    const plan = await RatePlan.create({ property: P, code: 'BAR', name: 'מחיר מלא', type: 'public' });
    for (let i = -3; i < 30; i += 1) await InventoryDate.create({ property: P, roomType: rt._id, date: addDays(today, i), physicalCount: 1 });
    const mk = (role) => User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const gmU = await mk('general_manager');
    const G = tok(gmU); const R = tok(await mk('receptionist')); const H = tok(await mk('housekeeper'));
    const guest = await GuestProfile.create({ property: P, firstName: 'רינה', lastName: TAG, phone: '0500000000' });
    const A = addDays(today, 10); const D = addDays(today, 12);
    const blocker = await Reservation.create({ property: P, confirmationNumber: `${TAG}-B`, status: 'confirmed', primaryGuest: guest._id, adults: 2, arrivalDate: A, departureDate: D, nights: 2, roomsCount: 1, roomType: rt._id, ratePlan: plan._id, ratePerNight: 500, totalAmount: 1000, guaranteeType: 'credit_card' });

    // ── Waitlist ──
    let r = await call('POST', '/res-extras/waitlist', R, { newGuest: { firstName: 'מאיר', lastName: TAG, phone: '0521111111' }, roomTypeId: String(rt._id), ratePlanId: String(plan._id), arrival: A, departure: D, adults: 2, priority: 1, note: 'כל חדר' });
    const wl = r.data;
    check('WL1 waitlist request saved without holding inventory', r.success && (await Reservation.findById(wl.id).lean()).status === 'waitlisted', r);
    r = await call('GET', '/res-extras/waitlist', R);
    check('WL2 waitlist shows the request as not available (the only room is taken)', r.success && r.data.length === 1 && r.data[0].available === false && r.data[0].priority === 1, r.data);
    r = await call('POST', `/res-extras/waitlist/${wl.id}/promote`, R, {});
    check('WL3 promote refused while the room type is full', r.status === 409, r.status);
    await Reservation.updateOne({ _id: blocker._id }, { $set: { status: 'cancelled' } });
    r = await call('GET', '/res-extras/waitlist', R);
    check('WL4 after a cancellation the request shows available', r.data?.[0]?.available === true, r.data);
    r = await call('POST', `/res-extras/waitlist/${wl.id}/promote`, R, {});
    const wAfter = await Reservation.findById(wl.id).lean();
    check('WL5 promote books for real; the waitlist entry leaves the statistics (deleted, "promoted")', r.success && r.data.confirmationNumber && wAfter.status === 'deleted' && wAfter.deletion?.reason === 'promoted' && String(wAfter.waitlist.promotedTo) === r.data.id, [r.status, r.error, wAfter.status]);
    const booked = r.data;
    const old = await Reservation.create({ property: P, confirmationNumber: `${TAG}-OLD`, status: 'waitlisted', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, -1), departureDate: addDays(today, 1), nights: 2, roomsCount: 1, roomType: rt._id, ratePerNight: 0, totalAmount: 0 });
    const removed = await cleanupWaitlist({ propertyId: P });
    check('WL6 day close removes requests whose arrival passed', removed === 1 && (await Reservation.findById(old._id).lean()).status === 'deleted');

    // ── Deposit ──
    r = await call('PUT', `/res-extras/deposits/${booked.id}`, R, { amount: 5000, dueDate: addDays(today, 20) });
    check('WL7 deposit above the stay price / due after arrival refused', r.status === 422 && r.fields?.amount && r.fields?.dueDate, r.fields);
    r = await call('PUT', `/res-extras/deposits/${booked.id}`, R, { amount: 300, dueDate: addDays(today, 3) });
    check('WL8 deposit 300 due in 3 days saved', r.success, r);
    const folio = await Folio.findOne({ reservation: booked.id }) || await Folio.create({ property: P, reservation: booked.id, ownerType: 'guest', lines: [] });
    folio.lines.push({ type: 'deposit', description: 'מקדמה', amount: -100, taxAmount: 0, serviceDate: today, source: 'manual', status: 'posted', method: 'cash' });
    await folio.save();
    r = await call('GET', '/res-extras/deposits', R);
    check('WL9 open deposits: 300 due, 100 paid, 200 open', r.success && r.data.rows.find((x) => x.id === booked.id)?.open === 200, r.data);
    r = await call('POST', `/res-extras/deposits/${booked.id}/remind`, R, {});
    check('WL10 reminder without a guest e-mail is refused cleanly', r.status === 422 || r.status === 409, r.status);

    // ── Confirmations ──
    r = await call('GET', `/res-extras/confirmations?from=${today}&to=${addDays(today, 30)}`, R);
    check('WL11 unconfirmed arrivals list includes the new booking', r.success && r.data.some((x) => x.id === booked.id), r.data);
    r = await call('POST', '/res-extras/confirmations', R, { ids: [booked.id] });
    check('WL12 batch send reports per booking (no address → failed, not a crash)', r.success && r.data.failed === 1 && r.data.rows[0].error, r.data);

    // ── Items ──
    r = await call('POST', '/res-extras/items', R, { code: 'ROLL', name: 'מיטה מתקפלת', total: 1 });
    check('WL13 receptionist cannot define items', r.status === 403, r.status);
    r = await call('POST', '/res-extras/items', G, { code: 'ROLL', name: 'מיטה מתקפלת', total: 1, price: 80 });
    const roll = r.data;
    const other = await Reservation.create({ property: P, confirmationNumber: `${TAG}-O`, status: 'confirmed', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, 11), departureDate: addDays(today, 13), nights: 2, roomsCount: 1, roomType: rt._id, ratePerNight: 500, totalAmount: 1000 });
    r = await call('POST', `/res-extras/reservations/${booked.id}/items`, R, { item: roll.id });
    const rollBooking = r.data;
    check('WL14 rollaway booked for the stay', r.success && rollBooking.id, r);
    r = await call('POST', `/res-extras/reservations/${other._id}/items`, R, { item: roll.id });
    check('WL15 the only rollaway is taken on the overlapping night → refused', r.status === 409, r.status);
    r = await call('GET', `/res-extras/items/availability?from=${A}&to=${D}`, R);
    check('WL16 availability shows 0 free', r.data?.[0]?.minFree === 0, r.data);
    await call('POST', `/res-extras/item-bookings/${rollBooking.id}/release`, R, {});
    r = await call('POST', `/res-extras/reservations/${other._id}/items`, R, { item: roll.id });
    check('WL17 released → the other stay gets it', r.success, r);

    // ── Payment methods / privileges ──
    const corp = await Company.create({ property: P, name: 'חברה', type: 'corporate' });
    r = await call('PUT', `/res-extras/reservations/${booked.id}/rules`, R, { paymentMethods: [{ method: 'company', company: String(corp._id) }] });
    check('WL18 company payer without receivables account refused', r.status === 422 && r.fields?.paymentMethods, r.fields);
    r = await call('PUT', `/res-extras/reservations/${booked.id}/rules`, R, { paymentMethods: [{ method: 'credit_card', rule: 'authorization' }] });
    check('WL19 card with an authorization rule needs a card on the booking', r.status === 422, r.status);
    r = await call('PUT', `/res-extras/reservations/${booked.id}/rules`, R, { paymentMethods: [{ method: 'cash', covers: 'room' }, { method: 'voucher', covers: 'extras', rule: 'voucher_number', ref: 'V-77', limit: 400 }] });
    check('WL20 two payment methods with their rules saved', r.success && r.data.paymentMethods.length === 2 && r.data.paymentMethods[1].ref === 'V-77', r);
    r = await call('PUT', `/res-extras/reservations/${booked.id}/rules`, R, { privileges: { postStayCharges: true } });
    check('WL21 the post-stay privilege is a manager decision', r.status === 422 && r.fields?.privileges, r.status);
    await call('PUT', `/res-extras/reservations/${booked.id}/rules`, R, { privileges: { preArrivalCharges: false } });
    r = await call('POST', `/finance/folios/${folio._id}/charges`, R, { department: 'minibar', unitPrice: 20, quantity: 1, idempotencyKey: key() });
    check('WL22 "no charges before arrival" refuses a charge on the confirmed booking', r.status === 409, [r.status, r.error]);

    // ── Housekeeping on the stay ──
    const ihRoom = await Room.create({ property: P, roomType: rt._id, number: `${TAG.slice(-3)}2`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'occupied' });
    const ih = await Reservation.create({ property: P, confirmationNumber: `${TAG}-IH`, status: 'in_house', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, -1), departureDate: addDays(today, 5), nights: 6, roomsCount: 1, roomType: rt._id, ratePerNight: 500, totalAmount: 3000, assignedRoom: ihRoom._id, checkedInAt: new Date() });
    await ReservationRoom.create({ reservation: ih._id, property: P, roomTypeBooked: rt._id, assignedRoom: ihRoom._id, arrivalDate: ih.arrivalDate, departureDate: ih.departureDate, nightlyRate: 500, status: 'in_house' });
    r = await call('PUT', `/res-extras/reservations/${ih._id}/rules`, R, { housekeeping: { cleaningEvery: 2, turndown: true, turndownTime: '20:30' } });
    check('WL23 housekeeping on the stay saved (every 2 days + turndown 20:30)', r.success && r.data.housekeeping.cleaningEvery === 2, r);
    await generateTasks({ propertyId: P, date: today, actor: { id: gmU._id, name: 'בדיקה', role: 'general_manager' } });
    const t1 = await HousekeepingTask.find({ property: P, room: ihRoom._id, date: today }).lean();
    await generateTasks({ propertyId: P, date: addDays(today, 1), actor: { id: gmU._id, name: 'בדיקה', role: 'general_manager' } });
    const t2 = await HousekeepingTask.find({ property: P, room: ihRoom._id, date: addDays(today, 1) }).lean();
    check('WL24 day 1 of the stay: turndown 20:30, no stayover clean; day 2: stayover clean', t1.some((t) => t.type === 'turndown' && t.dueTime === '20:30') && !t1.some((t) => t.type === 'stayover') && t2.some((t) => t.type === 'stayover'), [t1.map((t) => t.type), t2.map((t) => t.type)]);
    r = await call('GET', '/res-extras/waitlist', H);
    check('WL25 housekeeper cannot see the waitlist', r.status === 403, r.status);

    const acts = await AuditLog.distinct('action', { property: P, action: /^reservation\.(waitlist|deposit|item|rules)/ });
    check('WL26 audited: waitlist, promote, deposit, items, rules', ['reservation.waitlisted', 'reservation.waitlist_promoted', 'reservation.deposit_due', 'reservation.item_booked', 'reservation.rules'].every((a) => acts.includes(a)), acts);
  } finally {
    await Promise.all([Room, RoomType, User, GuestProfile, Reservation, ReservationRoom, AuditLog, Folio, Company, InventoryDate, HousekeepingTask, ChargeCode, RatePlan, ItemType, ItemBooking].map((m) => m.deleteMany({ property: P }).catch(() => null)));
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
