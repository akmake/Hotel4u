#!/usr/bin/env node
/* eslint-disable no-console */
// Departures integration suite (W06: FD-06 in-house, FD-07 departures, FD-08 stay closing, FIN-01
// reads, FIN-03/04 at the desk, room-night posting). Runs against a live PMS server and the same DB;
// creates its own rooms/guests/stays/folios and restores everything it touched (incl. inventory).
//
//   node scripts/departureIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import Company from '../models/Company.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import InventoryDate from '../models/InventoryDate.js';
import AuditLog from '../models/AuditLog.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { postNightsUntil } from '../services/roomCharges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || 'hotel4u_dev_secret_change_in_prod';
const TAG = `DPT${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const bal = (f) => Math.round(f.lines.filter((l) => l.status === 'posted').reduce((s, l) => s + l.amount + (l.taxAmount || 0), 0) * 100) / 100;
const key = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const property = await Property.findOne({ active: { $ne: false } }).sort({ createdAt: 1 });
  const P = String(property._id);
  const today = todayYmdInTimezone(property.timezone || 'Asia/Jerusalem');
  const created = { res: [], guests: [], users: [], rooms: [], companies: [] };
  let inventorySnapshot = [];

  async function userWithRole(role) {
    let u = await User.findOne({ property: P, role, active: { $ne: false } });
    if (!u) { u = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true }); created.users.push(u._id); }
    return u;
  }

  try {
    const M = tok(await userWithRole('property_admin'));
    const R = tok(await userWithRole('receptionist'));
    const H = tok(await userWithRole('housekeeper'));
    const roomType = await RoomType.findOne({ property: P, active: { $ne: false } }).sort({ sortOrder: 1 });
    const guest = await GuestProfile.create({ property: P, firstName: 'יוצא', lastName: TAG });
    created.guests.push(guest._id);
    const mkRoom = async (i) => { const r = await Room.create({ property: P, roomType: roomType._id, number: `${TAG}-${i}`, floor: 98, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'occupied' }); created.rooms.push(r._id); return r; };

    // An in-house stay with unit records, a guest folio and (optionally) more folios.
    async function mkStay({ arrival = addDays(today, -2), departure = today, rooms = 1, rate = 500, extraFolios = [], company } = {}) {
      const rs = [];
      for (let i = 0; i < rooms; i += 1) rs.push(await mkRoom(`${created.res.length}-${i}`));
      const nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000);
      const r = await Reservation.create({
        property: P, confirmationNumber: `${TAG}-${created.res.length + 1}`, status: 'in_house', primaryGuest: guest._id,
        adults: 2, arrivalDate: arrival, departureDate: departure, nights, roomsCount: rooms, roomType: roomType._id,
        ratePerNight: rate, totalAmount: rate * nights * rooms, assignedRoom: rs[0]._id, checkedInAt: new Date(), company: company?._id,
        guaranteeType: 'credit_card',
      });
      created.res.push(r._id);
      const units = await ReservationRoom.insertMany(rs.map((room) => ({ reservation: r._id, property: P, roomTypeBooked: roomType._id, assignedRoom: room._id, arrivalDate: arrival, departureDate: departure, nightlyRate: rate, status: 'in_house' })));
      const guestFolio = await Folio.create({ property: P, reservation: r._id, ownerType: 'guest', lines: [] });
      const extra = [];
      for (const ef of extraFolios) extra.push(await Folio.create({ property: P, reservation: r._id, ...ef }));
      return { r, rooms: rs, units, guestFolio, extra };
    }

    // ── FD-06 / FD-07 lists ─────────────────────────────────────────────────
    const s1 = await mkStay();
    let ih = await call('GET', `/frontdesk/in-house?propertyId=${P}&q=${encodeURIComponent(TAG)}`, R);
    const ihRow = ih.data?.rows?.find((x) => x.reservationId === String(s1.r._id));
    check('FD-06 in-house lists the stay with its room', ih.status === 200 && ihRow && ihRow.rooms[0]?.number === s1.rooms[0].number, ih.status);
    ih = await call('GET', `/frontdesk/in-house?propertyId=${P}&q=${encodeURIComponent(TAG)}&view=overdue`, R);
    check('FD-06 "overdue" view filters on the server', ih.status === 200 && !ih.data.rows.some((x) => x.reservationId === String(s1.r._id)));
    let dep = await call('GET', `/frontdesk/departures?propertyId=${P}&q=${encodeURIComponent(TAG)}`, R);
    check('FD-07 departures lists today\'s departure as expected', dep.status === 200 && dep.data.rows.some((x) => x.reservationId === String(s1.r._id) && x.state === 'expected'));
    const hkDep = await call('GET', `/frontdesk/departures?propertyId=${P}`, H);
    check('RBAC: housekeeper cannot read departures (money)', hkDep.status === 403, hkDep.status);

    // ── Nights: context shows unposted nights; posting is idempotent ────────
    let ctx = await call('GET', `/frontdesk/reservations/${s1.r._id}/check-out?propertyId=${P}`, R);
    const lodging = ctx.data?.folios?.find((f) => f.id === String(s1.guestFolio._id));
    check('FD-08 context shows 2 unposted nights in the balance', ctx.status === 200 && lodging?.pendingNights?.count === 2 && Math.abs(lodging.balance - 1000) < 0.01, JSON.stringify(lodging?.pendingNights));
    const p1 = await postNightsUntil({ reservation: s1.r, until: today, source: 'pms' });
    const p2 = await postNightsUntil({ reservation: s1.r, until: today, source: 'pms' });
    const f1 = await Folio.findById(s1.guestFolio._id).lean();
    const night = f1.lines.find((l) => l.department === 'rooms');
    const vat = Number(property.vatRate ?? 18) / 100;
    check('Nights post once (second run adds nothing)', p1 === 2 && p2 === 0, `${p1}/${p2}`);
    check('Lodging VAT is extracted from the quoted rate (T22)', night && Math.abs(night.amount + night.taxAmount - 500) < 0.01 && Math.abs(night.amount - 500 / (1 + vat)) < 0.01, night && `${night.amount}+${night.taxAmount}`);

    // ── Payments: idempotent, never above the balance ───────────────────────
    const k1 = key();
    const pay1 = await call('POST', `/frontdesk/folios/${s1.guestFolio._id}/payments`, R, { propertyId: P, amount: 400, method: 'cash', idempotencyKey: k1 });
    const pay1b = await call('POST', `/frontdesk/folios/${s1.guestFolio._id}/payments`, R, { propertyId: P, amount: 400, method: 'cash', idempotencyKey: k1 });
    const afterPay = await Folio.findById(s1.guestFolio._id).lean();
    check('Payment with the same key is recorded once', pay1.status === 200 && pay1b.data?.duplicate === true && afterPay.lines.filter((l) => l.type === 'payment').length === 1, `${pay1.status}`);
    const over = await call('POST', `/frontdesk/folios/${s1.guestFolio._id}/payments`, R, { propertyId: P, amount: 5000, method: 'cash', idempotencyKey: key() });
    check('Payment above the balance is refused (no accidental credit)', over.status === 422, over.status);
    const nokey = await call('POST', `/frontdesk/folios/${s1.guestFolio._id}/payments`, R, { propertyId: P, amount: 10, method: 'cash' });
    check('Payment without an operation key is refused', nokey.status === 422, nokey.status);

    // Balance 600 left: checkout without settlement is refused with the folio named.
    let co = await call('POST', `/frontdesk/reservations/${s1.r._id}/check-out`, R, { propertyId: P });
    check('FD-08 open balance blocks checkout and names the folio', co.status === 409 && co.details?.some((d) => d.folioId === String(s1.guestFolio._id)), co.status);
    co = await call('POST', `/frontdesk/reservations/${s1.r._id}/check-out`, R, { propertyId: P, settlements: [{ folioId: String(s1.guestFolio._id), mode: 'approved_open', reason: 'ישלם מחר' }] });
    check('Receptionist cannot leave a balance open', co.status === 409, co.status);
    const legacy = await call('POST', `/reservations/${s1.r._id}/check-out`, R, {});
    check('Legacy /reservations/:id/check-out obeys the same rules', legacy.status === 409, legacy.status);
    await call('POST', `/frontdesk/folios/${s1.guestFolio._id}/payments`, R, { propertyId: P, amount: 600, method: 'credit_card', idempotencyKey: key() });
    co = await call('POST', `/frontdesk/reservations/${s1.r._id}/check-out`, R, { propertyId: P });
    const s1r = await Reservation.findById(s1.r._id).lean();
    const s1f = await Folio.findById(s1.guestFolio._id).lean();
    const s1room = await Room.findById(s1.rooms[0]._id).lean();
    const s1task = await HousekeepingTask.findOne({ reservation: s1.r._id, type: 'checkout_clean' }).lean();
    const s1unit = await ReservationRoom.findById(s1.units[0]._id).lean();
    check('FD-08 paid stay closes: reservation, unit, folio closed', co.status === 200 && s1r.status === 'checked_out' && s1unit.status === 'checked_out' && s1f.status === 'closed', JSON.stringify(co).slice(0, 200));
    check('FD-08 room goes dirty and a checkout-clean task is created', s1room.cleanStatus === 'dirty' && !!s1task);

    // ── T11: personal folio zero, companion folio owes ──────────────────────
    const s2 = await mkStay({ arrival: addDays(today, -1), extraFolios: [{ ownerType: 'room', lines: [{ type: 'charge', description: 'מיניבר', amount: 100, taxAmount: 0, serviceDate: today, status: 'posted' }] }] });
    await postNightsUntil({ reservation: s2.r, until: today, source: 'pms' });
    await call('POST', `/frontdesk/folios/${s2.guestFolio._id}/payments`, R, { propertyId: P, amount: 500, method: 'cash', idempotencyKey: key() });
    co = await call('POST', `/frontdesk/reservations/${s2.r._id}/check-out`, R, { propertyId: P });
    check('T11 companion folio with a balance blocks checkout', co.status === 409 && co.details?.some((d) => d.folioId === String(s2.extra[0]._id)), co.status);
    co = await call('POST', `/frontdesk/reservations/${s2.r._id}/check-out`, M, { propertyId: P, settlements: [{ folioId: String(s2.extra[0]._id), mode: 'approved_open', reason: 'מחלוקת על המיניבר' }] });
    const s2extra = await Folio.findById(s2.extra[0]._id).lean();
    check('T11 manager exception leaves that folio open, recorded with who and why', co.status === 200 && s2extra.status === 'open' && s2extra.settlement?.mode === 'approved_open' && s2extra.settlement?.reason === 'מחלוקת על המיניבר');
    dep = await call('GET', `/frontdesk/departures?propertyId=${P}&q=${encodeURIComponent(s2.r.confirmationNumber)}`, R);
    check('FD-07 a left stay with an open folio stays visible as an exception', dep.data?.rows?.[0]?.state === 'completed' && dep.data.rows[0].money.settledOpen === 1);

    // ── Credit balance: refund capped, manager only ─────────────────────────
    const s3 = await mkStay({ arrival: addDays(today, -1) });
    await postNightsUntil({ reservation: s3.r, until: today, source: 'pms' });
    await Folio.updateOne({ _id: s3.guestFolio._id }, { $push: { lines: { type: 'payment', description: 'שולם ביתר', amount: -650, taxAmount: 0, serviceDate: today, status: 'posted' } } });
    co = await call('POST', `/frontdesk/reservations/${s3.r._id}/check-out`, R, { propertyId: P });
    check('A credit balance is not "paid" — checkout asks to refund', co.status === 409 && JSON.stringify(co.details).includes('זכות'), co.status);
    let rf = await call('POST', `/frontdesk/folios/${s3.guestFolio._id}/refunds`, R, { propertyId: P, amount: 150, method: 'cash', reason: 'החזר עודף', idempotencyKey: key() });
    check('Receptionist cannot refund', rf.status === 403, rf.status);
    rf = await call('POST', `/frontdesk/folios/${s3.guestFolio._id}/refunds`, M, { propertyId: P, amount: 200, method: 'cash', reason: 'החזר עודף', idempotencyKey: key() });
    check('Refund above the credit is refused (T16)', rf.status === 422, rf.status);
    rf = await call('POST', `/frontdesk/folios/${s3.guestFolio._id}/refunds`, M, { propertyId: P, amount: 150, method: 'cash', reason: 'החזר עודף', idempotencyKey: key() });
    const s3f = await Folio.findById(s3.guestFolio._id).lean();
    check('Refund of the exact credit zeroes the folio', rf.status === 200 && Math.abs(bal(s3f)) < 0.01, bal(s3f));
    co = await call('POST', `/frontdesk/reservations/${s3.r._id}/check-out`, R, { propertyId: P });
    check('After the refund the stay closes', co.status === 200, co.status);

    // ── Company receivable: limit enforced, no limit needs a manager ────────
    const coLimitless = await Company.create({ property: P, name: `${TAG} בע"מ`, type: 'corporate', creditLimit: 0, active: true });
    const coLimited = await Company.create({ property: P, name: `${TAG} מסגרת`, type: 'corporate', creditLimit: 2000, active: true });
    created.companies.push(coLimitless._id, coLimited._id);
    const s4 = await mkStay({ company: coLimitless, extraFolios: [{ ownerType: 'company', ownerRef: String(coLimitless._id), lines: [{ type: 'charge', description: 'לינה לחברה', amount: 800, taxAmount: 0, serviceDate: today, status: 'posted' }] }] });
    await Folio.updateOne({ _id: s4.guestFolio._id }, { $push: { lines: { type: 'charge', description: 'לינה (ישן)', amount: 1000, taxAmount: 0, department: 'rooms', serviceDate: addDays(today, -2), status: 'posted' } } });
    await Folio.updateOne({ _id: s4.guestFolio._id }, { $push: { lines: { type: 'charge', description: 'לינה (ישן)', amount: 1000, taxAmount: 0, department: 'rooms', serviceDate: addDays(today, -1), status: 'posted' } } });
    ctx = await call('GET', `/frontdesk/reservations/${s4.r._id}/check-out?propertyId=${P}`, R);
    const s4lodging = ctx.data?.folios?.find((f) => f.id === String(s4.guestFolio._id));
    check('Legacy lodging lines (no reference) count as posted nights', s4lodging?.pendingNights?.count === 0, JSON.stringify(s4lodging?.pendingNights));
    await call('POST', `/frontdesk/folios/${s4.guestFolio._id}/payments`, R, { propertyId: P, amount: 2000, method: 'cash', idempotencyKey: key() });
    co = await call('POST', `/frontdesk/reservations/${s4.r._id}/check-out`, R, { propertyId: P, settlements: [{ folioId: String(s4.extra[0]._id), mode: 'company_ar' }] });
    check('Company without a credit line: receivable needs a manager (T13)', co.status === 409, co.status);
    await Folio.updateOne({ _id: s4.extra[0]._id }, { $set: { ownerRef: String(coLimited._id) } });
    co = await call('POST', `/frontdesk/reservations/${s4.r._id}/check-out`, R, { propertyId: P, settlements: [{ folioId: String(s4.extra[0]._id), mode: 'company_ar' }] });
    const s4c = await Folio.findById(s4.extra[0]._id).lean();
    check('Company within its limit: balance moves to receivables, folio stays open', co.status === 200 && s4c.settlement?.mode === 'company_ar' && s4c.status === 'open', co.status);

    // ── Partial departure of a two-room stay ────────────────────────────────
    const s5 = await mkStay({ rooms: 2, arrival: addDays(today, -1) });
    co = await call('POST', `/frontdesk/reservations/${s5.r._id}/check-out`, R, { propertyId: P, unitIds: [String(s5.units[0]._id)] });
    const s5r = await Reservation.findById(s5.r._id).lean();
    const s5f = await Folio.findById(s5.guestFolio._id).lean();
    check('Partial departure: one room leaves, stay is partially checked out, shared folio stays open', co.status === 200 && s5r.status === 'partially_checked_out' && s5f.status === 'open' && co.data?.remainingUnits === 1, JSON.stringify(co).slice(0, 200));
    check('Partial departure posts the leaving room\'s nights only', s5f.lines.filter((l) => l.department === 'rooms').length === 1);

    // ── Early departure: reason required, unused nights back to inventory ──
    const s6 = await mkStay({ arrival: addDays(today, -1), departure: addDays(today, 2) });
    inventorySnapshot = await InventoryDate.find({ property: P, roomType: roomType._id, date: { $in: [today, addDays(today, 1)] } }).lean();
    co = await call('POST', `/frontdesk/reservations/${s6.r._id}/check-out`, M, { propertyId: P, settlements: [{ folioId: String(s6.guestFolio._id), mode: 'approved_open', reason: 'בדיקה' }] });
    check('Early departure without a reason is refused', co.status === 409 && JSON.stringify(co.details).includes('לפני מועד'), co.status);
    co = await call('POST', `/frontdesk/reservations/${s6.r._id}/check-out`, M, { propertyId: P, early: { reason: 'שינוי תוכניות' }, settlements: [{ folioId: String(s6.guestFolio._id), mode: 'approved_open', reason: 'ישלם בהעברה' }] });
    const s6r = await Reservation.findById(s6.r._id).lean();
    const invAfter = await InventoryDate.find({ property: P, roomType: roomType._id, date: { $in: [today, addDays(today, 1)] } }).lean();
    const dropped = inventorySnapshot.length === 0 || invAfter.every((d) => d.bookedCount === (inventorySnapshot.find((x) => x.date === d.date)?.bookedCount ?? 0) - 1);
    check('Early departure: stay ends today, original date kept, unused nights released', co.status === 200 && s6r.departureDate === today && s6r.originalDepartureDate === addDays(today, 2) && dropped, JSON.stringify({ st: co.status, d: s6r.departureDate }));

    const sc = await mkStay();
    const ch = await call('POST', `/frontdesk/reservations/${sc.r._id}/charges`, R, { propertyId: P, description: 'מיניבר', amount: 118, department: 'minibar', idempotencyKey: key() });
    const scf = await Folio.findById(sc.guestFolio._id).lean();
    const cl = scf.lines.find((l) => l.department === 'minibar');
    check('Service charge: entered gross, VAT extracted, posted once', ch.status === 200 && cl && Math.abs(cl.amount + cl.taxAmount - 118) < 0.01 && Math.abs(cl.amount - 118 / (1 + vat)) < 0.01, JSON.stringify(ch).slice(0, 150));
  } finally {
    const resIds = created.res;
    await HousekeepingTask.deleteMany({ reservation: { $in: resIds } });
    await ReservationRoom.deleteMany({ reservation: { $in: resIds } });
    await Folio.deleteMany({ reservation: { $in: resIds } });
    await AuditLog.deleteMany({ entityId: { $in: resIds } });
    await Reservation.deleteMany({ _id: { $in: resIds } });
    await GuestProfile.deleteMany({ _id: { $in: created.guests } });
    await Company.deleteMany({ _id: { $in: created.companies } });
    await Room.deleteMany({ _id: { $in: created.rooms } });
    await User.deleteMany({ _id: { $in: created.users } });
    for (const d of inventorySnapshot) await InventoryDate.updateOne({ _id: d._id }, { $set: { bookedCount: d.bookedCount } });
    await mongoose.disconnect();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
