#!/usr/bin/env node
/* eslint-disable no-console */
// Stay-change integration suite (W04/W05/W07: FD-09 move, FD-10 extension, FD-11 early-departure
// preview, RSV-05 booking change, RSV-06 cancellation notice). Runs against a live PMS server and
// the same DB, on a throw-away property with its own rooms, rates and inventory.
//
//   node scripts/stayIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import StaySegment from '../models/StaySegment.js';
import Folio from '../models/Folio.js';
import InventoryDate from '../models/InventoryDate.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';
import AuditLog from '../models/AuditLog.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { postNightsUntil } from '../services/roomCharges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || 'hotel4u_dev_secret_change_in_prod';
const TAG = `STY${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nightsOf = (a, b) => { const out = []; let d = a; while (d < b) { out.push(d); d = addDays(d, 1); } return out; };

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG, reservationSequence: 0, defaultCancellationHours: 24 });
  const P = String(p._id);
  try {
    const std = await RoomType.create({ property: P, code: `${TAG}S`, name: 'סטנדרט', baseRate: 500, capacityMax: 3, adultsMax: 3 });
    const dlx = await RoomType.create({ property: P, code: `${TAG}D`, name: 'דלוקס', baseRate: 800, capacityMax: 3, adultsMax: 3 });
    const mk = (n, rt, extra = {}) => Room.create({ property: P, roomType: rt._id, number: n, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant', ...extra });
    const r101 = await mk('101', std, { occStatus: 'occupied' }); const r102 = await mk('102', std); const r103 = await mk('103', std, { cleanStatus: 'dirty' }); const r201 = await mk('201', dlx);
    const bar = await RatePlan.create({ property: P, code: 'BAR', name: 'Best Available', isRefundable: true });
    const days = Array.from({ length: 40 }, (_, i) => addDays(today, i - 2));
    await InventoryDate.insertMany(days.flatMap((date) => [{ property: P, roomType: std._id, date, physicalCount: 3 }, { property: P, roomType: dlx._id, date, physicalCount: 1 }]));
    await RateDate.insertMany(days.flatMap((date) => [{ ratePlan: bar._id, roomType: std._id, date, price: 500 }, { ratePlan: bar._id, roomType: dlx._id, date, price: 800 }]));
    const users = {};
    for (const role of ['property_admin', 'receptionist']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const M = tok(users.property_admin); const R = tok(users.receptionist);
    const guest = await GuestProfile.create({ property: P, firstName: 'אורח', lastName: TAG });
    let seq = 0;
    async function stay({ status, arrival, departure, room, rt = std, rate = 500, created }) {
      seq += 1;
      const res = await Reservation.create({
        property: P, confirmationNumber: `${TAG}-${seq}`, status, primaryGuest: guest._id, adults: 2, arrivalDate: arrival, departureDate: departure,
        nights: nightsOf(arrival, departure).length, roomsCount: 1, roomType: rt._id, ratePlan: bar._id, ratePerNight: rate, totalAmount: rate * nightsOf(arrival, departure).length,
        assignedRoom: room?._id, checkedInAt: status === 'in_house' ? new Date() : undefined, createdAt: created,
        priceSnapshot: { ratePlanCode: 'BAR', nightly: nightsOf(arrival, departure).map((date) => ({ date, price: rate })), total: rate * nightsOf(arrival, departure).length, refundable: true },
        cancellationPolicy: 'ביטול ללא חיוב עד 24 שעות',
      });
      const unit = await ReservationRoom.create({ reservation: res._id, property: P, roomTypeBooked: rt._id, assignedRoom: room?._id, arrivalDate: arrival, departureDate: departure, nightlyRate: rate, status: status === 'in_house' ? 'in_house' : 'reserved', ratePlan: bar._id });
      await StaySegment.create({ reservationRoom: unit._id, reservation: res._id, property: P, fromDate: arrival, toDate: departure, roomType: rt._id, room: room?._id, ratePerNight: rate, ratePlan: bar._id });
      await Folio.create({ property: P, reservation: res._id, ownerType: 'guest', lines: [] });
      await InventoryDate.updateMany({ property: P, roomType: rt._id, date: { $in: nightsOf(arrival, departure) } }, { $inc: { bookedCount: 1 } });
      return { res, unit };
    }
    const booked = async (rt, date) => (await InventoryDate.findOne({ property: P, roomType: rt._id, date }).lean()).bookedCount;

    // ── FD-09 ───────────────────────────────────────────────────────────────
    const ih = await stay({ status: 'in_house', arrival: addDays(today, -1), departure: addDays(today, 2), room: r101 });
    const other = await stay({ status: 'confirmed', arrival: today, departure: addDays(today, 2), room: r102 });
    let r = await call('GET', `/stay/${ih.res._id}/move-candidates?propertyId=${P}`, R);
    const cand = (n) => r.data?.rooms?.find((x) => x.number === n);
    check('FD-09 candidates: occupied, dirty and free rooms are told apart', r.status === 200 && cand('102')?.available === false && /תפוס/.test(cand('102')?.why || '') && cand('103')?.available === false && cand('201')?.available === true, JSON.stringify(r.data?.rooms || r).slice(0, 200));
    r = await call('POST', `/stay/${ih.res._id}/move`, R, { propertyId: P, roomId: String(r201._id) });
    check('FD-09 a move requires a reason', r.status === 422 && r.fields?.reason, r.status);
    r = await call('POST', `/stay/${ih.res._id}/move`, R, { propertyId: P, roomId: String(r103._id), reason: 'guest_request' });
    check('FD-09 a room that is not clean is refused', r.status === 409, r.status);
    r = await call('POST', `/stay/${ih.res._id}/move`, R, { propertyId: P, roomId: String(r102._id), reason: 'guest_request' });
    check('FD-09 a room held by another stay for the range is refused; the stay stays put (T08)', r.status === 409 && r.code === 'target_taken' && String((await ReservationRoom.findById(ih.unit._id).lean()).assignedRoom) === String(r101._id), r.status);
    r = await call('POST', `/stay/${ih.res._id}/move`, R, { propertyId: P, roomId: String(r201._id), reason: 'upgrade', rate: 600, rateReason: 'שדרוג' });
    check('FD-09 changing the price on a move needs a manager', r.status === 403, r.status);
    const stdToday = await booked(std, today); const dlxToday = await booked(dlx, today);
    r = await call('POST', `/stay/${ih.res._id}/move`, R, { propertyId: P, roomId: String(r201._id), reason: 'upgrade', keyRequested: true });
    const segs = await StaySegment.find({ reservationRoom: ih.unit._id }).sort({ fromDate: 1 }).lean();
    check('FD-09 move: active segment ends today, a new one starts in the new room (history kept)', r.status === 200 && segs.length === 2 && segs[0].toDate === today && segs[1].fromDate === today && String(segs[1].room) === String(r201._id), JSON.stringify(segs.map((s) => [s.fromDate, s.toDate])));
    const old101 = await Room.findById(r101._id).lean();
    check('FD-09 the old room goes to cleaning; a cleaning task is created', old101.cleanStatus === 'dirty' && old101.occStatus === 'vacant' && !!(await HousekeepingTask.exists({ room: r101._id, date: today })));
    check('FD-09 upgrade moves the remaining nights between room-type inventories', (await booked(std, today)) === stdToday - 1 && (await booked(dlx, today)) === dlxToday + 1);
    check('FD-09 key is reported as a separate task (no provider)', r.data?.key?.status === 'not_connected');

    // ── FD-09 pricing rule: who initiated the move decides the price ────────
    const eco = await RoomType.create({ property: P, code: `${TAG}E`, name: 'חסכוני', baseRate: 300, capacityMax: 3, adultsMax: 3 });
    await InventoryDate.insertMany(days.map((date) => ({ property: P, roomType: eco._id, date, physicalCount: 2 })));
    await RateDate.insertMany(days.map((date) => ({ ratePlan: bar._id, roomType: eco._id, date, price: 300 })));
    const r104 = await mk('104', std); const r202 = await mk('202', dlx, { occStatus: 'occupied' }); const r301 = await mk('301', eco); const r302 = await mk('302', eco, { occStatus: 'occupied' });
    const pa = await stay({ status: 'in_house', arrival: addDays(today, -1), departure: addDays(today, 2), room: r202, rt: dlx, rate: 800 });
    r = await call('GET', `/stay/${pa.res._id}/move-candidates?propertyId=${P}&fromRoomId=${r202._id}`, R);
    check('FD-09 candidates price the remaining nights: agreed vs the target room type from the calendar', r.status === 200 && r.data.pricing.nights === 2 && r.data.pricing.agreed.total === 1600 && r.data.pricing.byType[String(eco._id)]?.total === 600 && r.data.unitId === String(pa.unit._id), JSON.stringify(r.data?.pricing || r).slice(0, 220));
    r = await call('POST', `/stay/${pa.res._id}/move`, R, { propertyId: P, roomId: String(r301._id), reason: 'maintenance', note: 'המזגן לא מקרר', fault: { category: 'hvac' }, priceMode: 'target', rateReason: 'חדר נחות' });
    check('FD-09 repricing a move needs a manager', r.status === 403, r.status);
    r = await call('POST', `/stay/${pa.res._id}/move`, M, { propertyId: P, roomId: String(r301._id), reason: 'maintenance', priceMode: 'target', rateReason: 'ניסיון' });
    check('FD-09 a fault move asks what the fault is (type + description)', r.status === 422 && r.fields?.faultCategory && r.fields?.note, r.status);
    r = await call('POST', `/stay/${pa.res._id}/move`, M, { propertyId: P, roomId: String(r301._id), reason: 'maintenance', note: 'המזגן לא מקרר', fault: { category: 'hvac' }, priceMode: 'target', rateReason: 'עבר לחדר נחות בגלל תקלה' });
    const tk = await MaintenanceTicket.findOne({ property: P, room: r202._id }).lean();
    const left = await Room.findById(r202._id).lean();
    check('FD-09 fault move: a blocking maintenance ticket is opened on the room left, and the room is out of order', r.status === 200 && r.data.ticket?.blocked === true && tk?.category === 'hvac' && tk?.blocksRoom === true && /המזגן לא מקרר/.test(tk?.description || '') && left.opsStatus === 'out_of_order', JSON.stringify({ t: r.data?.ticket, ops: left.opsStatus, e: r.error }));
    let snap = (await Reservation.findById(pa.res._id).lean()).priceSnapshot.nightly;
    check('FD-09 moved to a cheaper room: only remaining nights repriced down (1600 → 600), the slept night keeps 800', r.status === 200 && r.data.price.before === 1600 && r.data.price.after === 600 && snap.find((n) => n.date === addDays(today, -1))?.price === 800 && snap.find((n) => n.date === today)?.price === 300, JSON.stringify({ st: r.status, e: r.error, p: r.data?.price }));
    const r105 = await mk('105', std, { occStatus: 'occupied' });
    const pc = await stay({ status: 'in_house', arrival: addDays(today, -1), departure: addDays(today, 2), room: r105, rt: std, rate: 450 });
    const r303 = await mk('303', eco);
    r = await call('POST', `/stay/${pc.res._id}/move`, M, { propertyId: P, roomId: String(r303._id), reason: 'upgrade_free' });
    check('FD-09 a move to a lower category cannot be called an upgrade', r.status === 422 && r.code === 'not_an_upgrade', `${r.status} ${r.error || ''}`);
    r = await call('POST', `/stay/${pc.res._id}/move`, M, { propertyId: P, roomId: String(r303._id), reason: 'guest_request', priceMode: 'manual', rate: 480, rateReason: 'ניסיון', guestConsentRef: 'אישר' });
    check('FD-09 moving down a category never raises the price, even at the guest request', r.status === 422 && r.code === 'not_up_increase', `${r.status} ${r.error || ''}`);
    r = await call('GET', `/stay/${pc.res._id}/move-candidates?propertyId=${P}`, R);
    check('FD-09 candidates tell the direction of each room (up / down / same)', r.status === 200 && r.data.rooms.find((x) => x.number === '303')?.direction === 'down' && r.data.rooms.find((x) => x.number === '201')?.direction === 'up' && r.data.rooms.find((x) => x.number === '102')?.direction === 'same' && r.data.pricing.reasons.find((x) => x.value === 'upgrade_free')?.onlyUp === true, JSON.stringify(r.data?.rooms?.map((x) => [x.number, x.direction])));
    const pb = await stay({ status: 'in_house', arrival: addDays(today, -1), departure: addDays(today, 2), room: r302, rt: eco, rate: 300 });
    r = await call('POST', `/stay/${pb.res._id}/move`, M, { propertyId: P, roomId: String(r104._id), reason: 'hotel_need', priceMode: 'target', rateReason: 'ניסיון' });
    check('FD-09 a hotel-initiated move never costs the guest more', r.status === 422 && r.code === 'hotel_initiated_increase', `${r.status} ${r.error || ''}`);
    r = await call('POST', `/stay/${pb.res._id}/move`, M, { propertyId: P, roomId: String(r104._id), reason: 'guest_request', priceMode: 'target', rateReason: 'האורח ביקש חדר גדול' });
    check('FD-09 a higher price needs the guest consent', r.status === 422 && r.fields?.guestConsentRef, r.status);
    r = await call('POST', `/stay/${pb.res._id}/move`, M, { propertyId: P, roomId: String(r104._id), reason: 'guest_request', priceMode: 'target', rateReason: 'האורח ביקש חדר גדול', guestConsentRef: 'אישר בטלפון 10:40' });
    snap = (await Reservation.findById(pb.res._id).lean()).priceSnapshot.nightly;
    check('FD-09 guest-requested upgrade: remaining nights at the new room rate (600 → 1000), consent kept in audit', r.status === 200 && r.data.price.after === 1000 && snap.find((n) => n.date === addDays(today, -1))?.price === 300 && snap.find((n) => n.date === addDays(today, 1))?.price === 500 && !!(await AuditLog.exists({ entityId: pb.res._id, action: 'stay.room_moved', 'after.guestConsentRef': 'אישר בטלפון 10:40' })), JSON.stringify({ st: r.status, e: r.error }));
    r = await call('PATCH', `/reservations/${other.res._id}/assign-room`, M, { roomId: String(r102._id), priceAdjustment: -231, adjustmentNote: 'חצי הפרש' });
    check('Legacy room-chart assignment no longer posts a price difference', r.status === 422 && (await Folio.find({ reservation: other.res._id }).lean()).every((f) => f.lines.length === 0), r.status);

    // ── FD-10 ───────────────────────────────────────────────────────────────
    r = await call('GET', `/stay/${ih.res._id}/extension?propertyId=${P}&newDeparture=${addDays(today, 3)}`, R);
    check('FD-10 preview prices the added night from the calendar', r.status === 200 && r.data.canExtend && r.data.total === 800 && r.data.nightly[0].date === addDays(today, 2), JSON.stringify(r.data || r).slice(0, 200));
    const sig = r.data?.priceSignature;
    await stay({ status: 'confirmed', arrival: addDays(today, 3), departure: addDays(today, 5), room: r201, rt: dlx, rate: 800 });
    r = await call('GET', `/stay/${ih.res._id}/extension?propertyId=${P}&newDeparture=${addDays(today, 4)}`, R);
    check('FD-10 the room taken on an added night blocks the extension and suggests a move (T09)', r.status === 200 && !r.data.canExtend && r.data.blockers.some((b) => b.code === 'room_taken') && !!r.data.suggestion, JSON.stringify(r.data?.blockers));
    r = await call('POST', `/stay/${ih.res._id}/extend`, R, { propertyId: P, newDeparture: addDays(today, 4), paymentArrangement: 'כרטיס', guestConfirmation: 'טלפון' });
    check('FD-10 no silent extension: commit refused too', r.status === 409 && r.code === 'cannot_extend', r.status);
    r = await call('POST', `/stay/${ih.res._id}/extend`, R, { propertyId: P, newDeparture: addDays(today, 3), priceSignature: sig });
    check('FD-10 payment arrangement and guest confirmation are required', r.status === 422 && r.fields?.paymentArrangement && r.fields?.guestConfirmation, r.status);
    const dlxAdded = await booked(dlx, addDays(today, 2));
    r = await call('POST', `/stay/${ih.res._id}/extend`, R, { propertyId: P, newDeparture: addDays(today, 3), priceSignature: sig, paymentArrangement: 'כרטיס בקובץ', guestConfirmation: 'אישור בעל־פה בדלפק' });
    const ext = await Reservation.findById(ih.res._id).lean();
    check('FD-10 extended: departure, total, stock and agreed price for the new night', r.status === 200 && ext.departureDate === addDays(today, 3) && ext.totalAmount === 1500 + 800 && (await booked(dlx, addDays(today, 2))) === dlxAdded + 1 && ext.priceSnapshot.nightly.some((n) => n.date === addDays(today, 2) && n.price === 800), JSON.stringify({ st: r.status, d: ext.departureDate, t: ext.totalAmount, e: r.error }));
    await postNightsUntil({ reservation: await Reservation.findById(ih.res._id), until: addDays(today, 3), source: 'pms' });
    const lines = (await Folio.find({ reservation: ih.res._id }).lean()).flatMap((f) => f.lines);
    const night2 = lines.find((l) => l.serviceDate === addDays(today, 2));
    check('Nights are charged at the agreed price per night (500 before, 800 for the extension)', night2 && Math.round((night2.amount + night2.taxAmount) * 100) / 100 === 800 && lines.filter((l) => l.serviceDate < today).every((l) => Math.round((l.amount + l.taxAmount) * 100) / 100 === 500), JSON.stringify(lines.map((l) => [l.serviceDate, l.amount + l.taxAmount])));

    // ── FD-11 ───────────────────────────────────────────────────────────────
    r = await call('GET', `/stay/${ih.res._id}/early-departure?propertyId=${P}`, R);
    check('FD-11 preview: nights released, charged nights kept, no automatic fee', r.status === 200 && r.data.nightsReleased === 3 && r.data.postedFutureNights > 0 && r.data.notes.some((n) => n.includes('אין חיוב אוטומטי')), JSON.stringify(r.data || r).slice(0, 200));

    // ── RSV-05 ──────────────────────────────────────────────────────────────
    r = await call('POST', `/stay/${ih.res._id}/modification/preview`, R, { propertyId: P, changes: { departure: addDays(today, 5) } });
    check('RSV-05 a stay that started is changed through extension/early departure/move', r.status === 409 && r.code === 'in_house', r.status);
    const fut = await stay({ status: 'confirmed', arrival: addDays(today, 10), departure: addDays(today, 12), room: r102 });
    r = await call('POST', `/stay/${fut.res._id}/modification/preview`, R, { propertyId: P, changes: { arrival: addDays(today, 11), departure: addDays(today, 14) } });
    check('RSV-05 preview shows before/after and the price difference', r.status === 200 && r.data.canApply && r.data.after.total === 1500 && r.data.difference === 500, JSON.stringify(r.data || r).slice(0, 200));
    const version = r.data?.version;
    r = await call('POST', `/stay/${fut.res._id}/modify`, R, { propertyId: P, changes: { arrival: addDays(today, 11), departure: addDays(today, 14) } });
    check('RSV-05 reason and customer confirmation are required', r.status === 422 && r.fields?.reason && r.fields?.confirmationRef, r.status);
    r = await call('POST', `/stay/${fut.res._id}/modify`, R, { propertyId: P, version: new Date(Date.now() - 86400000).toISOString(), changes: { arrival: addDays(today, 11), departure: addDays(today, 14) }, reason: 'שינוי תאריכים', confirmationRef: 'מייל' });
    check('RSV-05 a stale version is refused', r.status === 409 && r.code === 'version_conflict', r.status);
    const before10 = await booked(std, addDays(today, 10)); const before13 = await booked(std, addDays(today, 13));
    r = await call('POST', `/stay/${fut.res._id}/modify`, R, { propertyId: P, version, changes: { arrival: addDays(today, 11), departure: addDays(today, 14) }, reason: 'שינוי תאריכים', confirmationRef: 'מייל מהלקוח' });
    const mod = await Reservation.findById(fut.res._id).lean();
    check('RSV-05 applied: dates, total and snapshot updated; stock moved night by night', r.status === 200 && mod.arrivalDate === addDays(today, 11) && mod.totalAmount === 1500 && mod.priceSnapshot.nightly.length === 3 && (await booked(std, addDays(today, 10))) === before10 - 1 && (await booked(std, addDays(today, 13))) === before13 + 1, JSON.stringify({ st: r.status, e: r.error, a: mod.arrivalDate }));
    check('RSV-05 the assigned room is kept when still the right type and free', String(mod.assignedRoom) === String(r102._id));
    await stay({ status: 'confirmed', arrival: addDays(today, 11), departure: addDays(today, 13), room: r201, rt: dlx, rate: 800 });
    r = await call('POST', `/stay/${fut.res._id}/modification/preview`, R, { propertyId: P, changes: { roomTypeId: String(dlx._id) } });
    check('RSV-05 changing to a sold-out room type is blocked', r.status === 200 && !r.data.canApply && r.data.blockers.some((b) => ['no_stock', 'no_rooms'].includes(b.code)), JSON.stringify(r.data?.blockers));

    // ── RSV-06 ──────────────────────────────────────────────────────────────
    r = await call('POST', `/stay/${fut.res._id}/cancellation/preview`, R, { propertyId: P, channel: 'desk', track: 'contractual', reason: 'regret' });
    check('RSV-06 desk sale, notice well before arrival: contractual free window, fee 0', r.status === 200 && r.data.proposedFee === 0 && r.data.statutory.applies === false && r.data.sources.some((s) => s.startsWith('IL17')), JSON.stringify(r.data || r).slice(0, 220));
    r = await call('POST', `/stay/${fut.res._id}/cancellation/preview`, R, { propertyId: P, channel: 'phone', track: 'regular', reason: 'regret', transactionAt: new Date(Date.now() - 3 * 86400000).toISOString() });
    check('RSV-06 remote sale within 14 days and >7 working days: statutory right, capped fee proposal, flagged G06', r.status === 200 && r.data.statutory.eligible === true && r.data.proposedFee === 75 && /G06/.test(r.data.gate) && r.data.needsReview === true, JSON.stringify(r.data || r).slice(0, 260));
    r = await call('POST', `/stay/${fut.res._id}/cancellation/preview`, R, { propertyId: P, channel: 'phone', track: 'protected', reason: 'regret' });
    check('RSV-06 protected population is sent for review (no blanket 14-day rule)', r.status === 200 && r.data.statutory.eligible === null && r.data.needsReview);
    r = await call('POST', `/stay/${fut.res._id}/cancellation/preview`, R, { propertyId: P, channel: 'phone', track: 'regular', reason: 'service_failure' });
    check('RSV-06 service failure is not regret: no fee', r.status === 200 && r.data.proposedFee === 0);
    r = await call('POST', `/stay/${fut.res._id}/cancel`, R, { propertyId: P, track: 'regular', reason: 'regret' });
    check('RSV-06 the channel the notice came through is required', r.status === 422 && r.fields?.channel, r.status);
    r = await call('POST', `/stay/${fut.res._id}/cancel`, R, { propertyId: P, channel: 'phone', track: 'regular', reason: 'regret', receivedAt: new Date(Date.now() + 86400000).toISOString() });
    check('RSV-06 a notice cannot be dated in the future', r.status === 422 && r.fields?.receivedAt, r.status);
    const received = new Date(Date.now() - 2 * 3600000).toISOString();
    const st11 = await booked(std, addDays(today, 11));
    r = await call('POST', `/stay/${fut.res._id}/cancel`, R, { propertyId: P, channel: 'phone', track: 'regular', reason: 'regret', receivedAt: received, transactionAt: new Date(Date.now() - 3 * 86400000).toISOString() });
    const can = await Reservation.findById(fut.res._id).lean();
    const fLines = (await Folio.find({ reservation: fut.res._id }).lean()).flatMap((f) => f.lines);
    check('RSV-06 cancelled: notice recorded with its arrival time and channel, stock released', r.status === 200 && can.status === 'cancelled' && can.cancellation?.channel === 'phone' && new Date(can.cancellation.receivedAt).toISOString() === received && (await booked(std, addDays(today, 11))) === st11 - 1, JSON.stringify({ st: r.status, e: r.error }));
    check('RSV-06 no cancellation fee is charged automatically (G06)', fLines.length === 0 && r.data?.proposal?.proposedFee === 75);
    r = await call('POST', `/stay/${ih.res._id}/cancel`, M, { propertyId: P, channel: 'desk', track: 'contractual', reason: 'other', note: 'ניסיון' });
    check('RSV-06 a stay that started cannot be cancelled (T32)', r.status === 409, r.status);
    check('Other stay untouched by the move', String((await Reservation.findById(other.res._id).lean()).assignedRoom) === String(r102._id));
  } finally {
    const resIds = (await Reservation.find({ property: P }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: P }, { entityId: { $in: [p._id, ...resIds] } }] });
    await ChannelUpdateQueue.deleteMany({ property: P }).catch(() => null);
    await HousekeepingTask.deleteMany({ property: P });
    await MaintenanceTicket.deleteMany({ property: P });
    await Folio.deleteMany({ property: P });
    await StaySegment.deleteMany({ property: P });
    await ReservationRoom.deleteMany({ property: P });
    await Reservation.deleteMany({ property: P });
    await InventoryDate.deleteMany({ property: P });
    await RateDate.deleteMany({ roomType: { $in: (await RoomType.find({ property: P }).select('_id').lean()).map((x) => x._id) } });
    await RatePlan.deleteMany({ property: P });
    await GuestProfile.deleteMany({ property: P });
    await Room.deleteMany({ property: P });
    await RoomType.deleteMany({ property: P });
    await User.deleteMany({ property: P });
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
