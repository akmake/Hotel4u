#!/usr/bin/env node
/* eslint-disable no-console */
// Stay tools suite (gap-map item 5): Re-Instate check-out, Split Master, Shares (add / merge / split of
// the lodging / remove / separate). Runs against a live PMS server + the same DB, on a throw-away
// property removed at the end.
//   node scripts/stayToolsIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import AuditLog from '../models/AuditLog.js';
import InventoryDate from '../models/InventoryDate.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { postNightsUntil } from '../services/roomCharges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `STT${Date.now().toString(36).toUpperCase()}`;
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const gross = (lines, pred) => Math.round(lines.filter((l) => l.status === 'posted' && pred(l)).reduce((s, l) => s + l.amount + (l.taxAmount || 0), 0) * 100) / 100;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG });
  const P = String(p._id);
  try {
    const rt = await RoomType.create({ property: P, code: TAG, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    const rooms = [];
    for (let i = 1; i <= 8; i += 1) rooms.push(await Room.create({ property: P, roomType: rt._id, number: `${i}0${i}`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' }));
    const users = {};
    for (const role of ['front_desk_manager', 'receptionist']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const M = tok(users.front_desk_manager); const R = tok(users.receptionist);
    let n = 0;
    const guest = async (first) => GuestProfile.create({ property: P, firstName: first, lastName: TAG });
    async function stay({ status = 'in_house', arrival = addDays(today, -2), departure = addDays(today, 2), roomIdx, units = 1, extra = {} }) {
      n += 1;
      const g = await guest(`אורח${n}`);
      const nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 864e5);
      const r = await Reservation.create({ property: P, confirmationNumber: `${TAG}-${n}`, status, primaryGuest: g._id, adults: 2 * units, arrivalDate: arrival, departureDate: departure, nights, roomsCount: units, roomType: rt._id, ratePerNight: 500, totalAmount: 500 * nights * units, assignedRoom: rooms[roomIdx]._id, checkedInAt: ['in_house', 'checked_out'].includes(status) ? new Date() : undefined, guaranteeType: 'credit_card', ...extra });
      const us = [];
      for (let i = 0; i < units; i += 1) us.push(await ReservationRoom.create({ reservation: r._id, property: P, roomTypeBooked: rt._id, assignedRoom: rooms[roomIdx + i]._id, arrivalDate: arrival, departureDate: departure, nightlyRate: 500, adults: 2, status: status === 'in_house' ? 'in_house' : status === 'checked_out' ? 'checked_out' : 'reserved' }));
      const folio = await Folio.create({ property: P, reservation: r._id, ownerType: 'guest', lines: [] });
      return { r, us, folio };
    }

    // ── Re-Instate check-out ────────────────────────────────────────────────
    const out = await stay({ status: 'checked_out', departure: today, roomIdx: 0, extra: { checkedOutAt: new Date() } });
    await Folio.updateOne({ _id: out.folio._id }, { $set: { status: 'closed', closedAt: new Date(), settlement: { mode: 'paid', balance: 0, at: new Date() } } });
    await Room.updateOne({ _id: rooms[0]._id }, { $set: { occStatus: 'checked_out', cleanStatus: 'dirty' } });
    await HousekeepingTask.create({ property: P, room: rooms[0]._id, reservation: out.r._id, type: 'checkout_clean', priority: 'high', status: 'new', date: today, autoCreated: true });
    let r = await call('POST', `/booking/reservations/${out.r._id}/reinstate-checkout`, R, { propertyId: P, reason: 'נשאר עוד לילה' });
    check('RIC a receptionist cannot reinstate a check-out', r.status === 403, r.status);
    r = await call('POST', `/booking/reservations/${out.r._id}/reinstate-checkout`, M, { propertyId: P });
    check('RIC a reason is required', r.status === 422, r.status);
    r = await call('POST', `/booking/reservations/${out.r._id}/reinstate-checkout`, M, { propertyId: P, reason: 'יציאה נרשמה בטעות' });
    const back = await Reservation.findById(out.r._id).lean();
    const fBack = await Folio.findById(out.folio._id).lean();
    const roomBack = await Room.findById(rooms[0]._id).lean();
    const hk = await HousekeepingTask.findOne({ reservation: out.r._id }).lean();
    check('RIC same day: back in house, unit in house, room occupied, folio reopened, checkout clean cancelled', r.status === 200 && back.status === 'in_house' && !back.checkedOutAt && fBack.status === 'open' && !fBack.settlement?.mode && roomBack.occStatus === 'occupied' && hk.status === 'cancelled' && back.reversals.some((x) => x.kind === 'reinstate_check_out'), `${r.status} ${r.error} ${back.status} ${fBack.status} ${roomBack.occStatus} ${hk?.status}`);
    const old = await stay({ status: 'checked_out', departure: addDays(today, -1), roomIdx: 1, extra: { checkedOutAt: new Date(Date.now() - 2 * 864e5) } });
    r = await call('GET', `/booking/reservations/${old.r._id}/reinstate-checkout?propertyId=${P}`, M);
    check('RIC a check-out of an earlier day cannot be reinstated', r.status === 200 && !r.data.allowed && /ביום העסקי/.test(r.data.blockers.join(' ')), JSON.stringify(r.data?.blockers));
    const taken = await stay({ status: 'checked_out', departure: today, roomIdx: 2, extra: { checkedOutAt: new Date() } });
    await stay({ status: 'in_house', roomIdx: 2 });
    r = await call('POST', `/booking/reservations/${taken.r._id}/reinstate-checkout`, M, { propertyId: P, reason: 'טעות' });
    check('RIC a room already taken by another guest blocks it', r.status === 409 && /תפוס/.test(r.error || ''), `${r.status} ${r.error}`);

    // ── Split Master ────────────────────────────────────────────────────────
    const multi = await stay({ status: 'confirmed', arrival: addDays(today, 3), departure: addDays(today, 5), roomIdx: 3, units: 2 });
    const unit2 = multi.us[1];
    const unitWin = await Folio.create({ property: P, reservation: multi.r._id, ownerType: 'room', ownerRef: String(unit2._id), lines: [] });
    r = await call('POST', `/booking/reservations/${multi.r._id}/split`, R, { propertyId: P, unitId: String(unit2._id) });
    const after = await Reservation.findById(multi.r._id).lean();
    const created = r.data ? await Reservation.findById(r.data.newReservationId).lean() : null;
    const movedUnit = await ReservationRoom.findById(unit2._id).lean();
    const movedWin = await Folio.findById(unitWin._id).lean();
    check('SPL a room becomes its own booking: new number, 2 nights × 500, unit + its window moved, both linked as a party', r.status === 200 && created && created.confirmationNumber !== after.confirmationNumber && created.totalAmount === 1000 && after.roomsCount === 1 && after.totalAmount === 1000 && String(movedUnit.reservation) === String(created._id) && String(movedWin.reservation) === String(created._id) && after.party?.id && after.party.id === created.party?.id && created.party.size === 2, `${r.status} ${r.error}`);
    r = await call('POST', `/booking/reservations/${multi.r._id}/split`, R, { propertyId: P, unitId: String(multi.us[0]._id) });
    check('SPL a one-room booking cannot be split', r.status === 409, r.status);

    // ── Shares ──────────────────────────────────────────────────────────────
    const A = await stay({ status: 'in_house', arrival: addDays(today, -2), departure: addDays(today, 2), roomIdx: 5 });
    r = await call('POST', `/booking/reservations/${A.r._id}/shares`, R, { propertyId: P, split: 'half', newGuest: { firstName: 'נועה', lastName: 'לוי' } });
    const shareId = r.data?.shareId;
    check('SHR a second guest joins the room with a window of their own', r.status === 200 && !!r.data.folioId && (await Folio.findById(r.data.folioId).lean())?.ownerRef === `share:${shareId}`, `${r.status} ${r.error}`);
    await postNightsUntil({ reservation: await Reservation.findById(A.r._id), until: today, source: 'night_audit' });
    let wins = await Folio.find({ reservation: A.r._id }).lean();
    const mainG = gross(wins.find((f) => !f.ownerRef).lines, (l) => l.department === 'rooms');
    const shareG = gross(wins.find((f) => f.ownerRef === `share:${shareId}`).lines, (l) => l.department === 'rooms');
    check('SHR "half": 2 nights × 500 → 500 on the main guest, 500 on the sharer', mainG === 500 && shareG === 500, `${mainG}/${shareG}`);
    r = await call('POST', `/booking/reservations/${A.r._id}/shares/${shareId}/split`, R, { propertyId: P, split: 'full' });
    await postNightsUntil({ reservation: await Reservation.findById(A.r._id), until: addDays(today, 1), source: 'night_audit' });
    wins = await Folio.find({ reservation: A.r._id }).lean();
    const main2 = gross(wins.find((f) => !f.ownerRef).lines, (l) => l.department === 'rooms');
    const share2 = gross(wins.find((f) => f.ownerRef === `share:${shareId}`).lines, (l) => l.department === 'rooms');
    check('SHR switched to "full": the next night is 500 on each window (1000 / 1000)', r.status === 200 && main2 === 1000 && share2 === 1000, `${r.status} ${main2}/${share2}`);
    const B = await stay({ status: 'confirmed', arrival: today, departure: addDays(today, 1), roomIdx: 6 });
    const C = await stay({ status: 'confirmed', arrival: today, departure: addDays(today, 1), roomIdx: 7 });
    await Folio.updateOne({ _id: C.folio._id }, { $push: { lines: { type: 'deposit', description: 'מקדמה', amount: -100, taxAmount: 0, serviceDate: today, status: 'posted', method: 'cash' } } });
    r = await call('POST', `/booking/reservations/${A.r._id}/shares`, R, { propertyId: P, split: 'none', mergeReservationId: String(C.r._id) });
    check('SHR a booking with money cannot be joined (has_money)', r.status === 409 && r.code === 'has_money', `${r.status} ${r.code}`);
    r = await call('POST', `/booking/reservations/${A.r._id}/shares`, R, { propertyId: P, split: 'none', mergeReservationId: String(B.r._id) });
    const bAfter = await Reservation.findById(B.r._id).lean();
    check('SHR joining an open booking: it is cancelled (stock released) and its guest is a Share here', r.status === 200 && r.data.mergedFrom === B.r.confirmationNumber && bAfter.status === 'cancelled', `${r.status} ${r.error} ${bAfter.status}`);
    r = await call('POST', `/booking/reservations/${A.r._id}/shares/${shareId}/end`, R, { propertyId: P, mode: 'remove' });
    check('SHR a sharer with an open balance cannot just be removed', r.status === 409 && r.code === 'share_balance', `${r.status} ${r.code}`);
    r = await call('POST', `/booking/reservations/${A.r._id}/shares/${shareId}/end`, R, { propertyId: P, mode: 'separate', reason: 'רוצה חדר משלו' });
    const sep = r.data?.newReservationId ? await Reservation.findById(r.data.newReservationId).lean() : null;
    const aFinal = await Reservation.findById(A.r._id).lean();
    check('SHR separate: a new booking with its own confirmation number from today; the share is closed as history', r.status === 200 && sep && sep.arrivalDate === today && sep.confirmationNumber !== aFinal.confirmationNumber && aFinal.shares.find((s) => String(s._id) === shareId).status === 'separated', `${r.status} ${r.error}`);
    const multi2 = await stay({ status: 'confirmed', arrival: addDays(today, 3), departure: addDays(today, 4), roomIdx: 3, units: 2 });
    r = await call('POST', `/booking/reservations/${multi2.r._id}/shares`, R, { propertyId: P, split: 'half', newGuest: { firstName: 'x', lastName: 'y' } });
    check('SHR a multi-room booking takes a Share only after Split Master', r.status === 409 && r.code === 'multi_room', `${r.status} ${r.code}`);
    r = await call('GET', `/frontdesk/in-house?propertyId=${P}`, R);
    const rowA = (r.data?.rows || []).find((x) => x.reservationId === String(A.r._id));
    check('SHR the in-house list names the sharer on the room', rowA?.shares?.length === 1, JSON.stringify(rowA?.shares));
  } finally {
    const resIds = (await Reservation.find({ property: p._id }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: p._id }, { entityId: { $in: resIds } }] });
    await Folio.collection.deleteMany({ property: p._id });
    await ReservationRoom.deleteMany({ property: p._id });
    await Reservation.deleteMany({ property: p._id });
    await HousekeepingTask.deleteMany({ property: p._id });
    await InventoryDate.deleteMany({ property: p._id });
    await GuestProfile.deleteMany({ property: p._id });
    await Room.deleteMany({ property: p._id });
    await RoomType.deleteMany({ property: p._id });
    await User.deleteMany({ property: p._id });
    await Property.deleteMany({ _id: p._id });
    await mongoose.disconnect();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
