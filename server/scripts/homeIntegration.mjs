#!/usr/bin/env node
/* eslint-disable no-console */
// Home screen suite (gap-map item 8): menu counters, weekly view, house status (comp / house use,
// maximum availability), vacant room search, turned-away requests, rate "use". Runs against a live
// PMS server + the same DB, on a throw-away property removed at the end.
//   node scripts/homeIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import TurnAway from '../models/TurnAway.js';
import AuditLog from '../models/AuditLog.js';
import { RatePlan } from '../models/RatePlan.js';
import { DeskItem } from '../models/DeskItem.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const API = BASE.replace(/\/pms$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `HOM${Date.now().toString(36).toUpperCase()}`;
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${typeof info === 'string' ? info : JSON.stringify(info).slice(0, 300)}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
let P;
async function call(method, url, t, body, base = BASE) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${base}${url}${sep}propertyId=${P}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify({ ...body, propertyId: P }) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG });
  P = String(p._id);
  try {
    const rt = await RoomType.create({ property: P, code: TAG, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    const rooms = [];
    for (let i = 1; i <= 6; i += 1) rooms.push(await Room.create({ property: P, roomType: rt._id, number: `${TAG.slice(-3)}${i}`, floor: 1, cleanStatus: i <= 3 ? 'clean' : 'dirty', opsStatus: i === 6 ? 'out_of_order' : 'available', occStatus: 'vacant' }));
    const users = {};
    for (const role of ['front_desk_manager', 'housekeeper', 'general_manager']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const M = tok(users.front_desk_manager); const H = tok(users.housekeeper); const G = tok(users.general_manager);
    const comp = await RatePlan.create({ property: P, code: `${TAG}C`, name: 'חינם', use: 'comp' });
    const paying = await RatePlan.create({ property: P, code: `${TAG}P`, name: 'רגיל' });
    let n = 0;
    const stay = async ({ status, arrival, departure, room, plan, adults = 2 }) => {
      n += 1;
      const g = await GuestProfile.create({ property: P, firstName: `אורח${n}`, lastName: TAG });
      return Reservation.create({ property: P, confirmationNumber: `${TAG}-${n}`, status, primaryGuest: g._id, adults, arrivalDate: arrival, departureDate: departure, nights: Math.round((Date.parse(departure) - Date.parse(arrival)) / 864e5), roomsCount: 1, roomType: rt._id, ratePlan: plan?._id, ratePerNight: 500, totalAmount: 500, assignedRoom: room?._id, checkedInAt: status === 'in_house' ? new Date() : undefined, guaranteeType: 'credit_card' });
    };
    await stay({ status: 'in_house', arrival: addDays(today, -1), departure: addDays(today, 2), room: rooms[0], plan: comp, adults: 1 });
    await stay({ status: 'in_house', arrival: addDays(today, -2), departure: today, room: rooms[3], plan: paying });
    await stay({ status: 'confirmed', arrival: today, departure: addDays(today, 1), plan: paying });
    await DeskItem.create({ property: P, kind: 'message', status: 'open', text: 'הודעה', date: today, reservation: undefined }).catch(() => null);

    // ── Counters ──
    let r = await call('GET', '/frontdesk/home/counters', M);
    const c = r.data;
    check('HM1 counters: arrivals left, in house, due out, VC/VD, out of order', r.success && c.arrivals.rooms === 1 && c.inHouse === 2 && c.departuresDue === 1 && c.rooms.ooo === 1 && c.rooms.oc === 1 && c.rooms.od === 1 && c.rooms.vc === 2 && c.rooms.vd === 1, c);
    check('HM2 counters map to menu entries, occupancy on availability', c?.nav?.['/pms/arrivals'] === 1 && c.nav['/pms/in-house'] === 2 && c.nav['/pms/housekeeping'] === 1 && /%/.test(c.nav['/pms/availability'] || ''), c?.nav);
    r = await call('GET', '/frontdesk/home/counters', H);
    check('HM3 counters carry no guest identity', r.success && !JSON.stringify(r.data).includes(TAG), r.status);

    // ── Weekly view ──
    r = await call('GET', '/frontdesk/home/week', M);
    const d0 = r.data?.rows?.[0];
    check('HM4 weekly view: 7 days with free, sold, guests, arrivals', r.success && r.data.rows.length === 7 && d0.date === today && d0.sellable === 5 && d0.definite === 2 && d0.arrivals === 1 && d0.guests === 3, d0);
    r = await call('POST', '/frontdesk/home/turnaways', H, { date: today, reason: 'full' });
    check('HM5 housekeeping cannot record a turned-away request', r.status === 403, r.status);
    r = await call('POST', '/frontdesk/home/turnaways', M, { date: today, reason: 'nope' });
    check('HM6 a turned-away request needs a reason from the list', r.status === 422 && r.fields?.reason, r);
    await call('POST', '/frontdesk/home/turnaways', M, { date: addDays(today, 1), reason: 'full', rooms: 2, nights: 3 });
    r = await call('GET', '/frontdesk/home/week', M);
    check('HM7 turned-away requests are counted on their day', r.data.rows[1].turnaways.count === 1 && r.data.rows[1].turnaways.rooms === 2, r.data.rows[1].turnaways);

    // ── House status ──
    r = await call('GET', '/frontdesk/home/house', M);
    const h = r.data;
    check('HM8 house status: rooms, movement expected vs done', r.success && h.rooms.total === 6 && h.rooms.outOfSale === 1 && h.movement.arrivals.expected === 1 && h.movement.arrivals.done === 0 && h.movement.departures.expected === 1, h);
    check('HM9 comp rooms are counted apart (by the rate use)', h.use.comp.rooms === 1 && h.use.comp.guests === 1 && h.use.houseUse.rooms === 0, h.use);
    check('HM10 maximum availability: regular / overbooking / options released / committed', h.maxAvailability.regular === h.maxAvailability.withOverbooking && h.maxAvailability.committed >= 2, h.maxAvailability);
    r = await call('GET', `/frontdesk/home/house?date=${addDays(today, 3)}`, M);
    check('HM11 a future day has no housekeeping state', r.success && r.data.housekeeping === null && r.data.isFuture, r.data?.housekeeping);

    // ── Vacant room search ──
    r = await call('GET', '/frontdesk/home/free-rooms', M);
    const f = r.data;
    check('HM12 vacant search defaults to clean rooms; occupied and out-of-order are out', r.success && f.rooms.every((x) => x.ready) && !f.rooms.some((x) => x.number === rooms[0].number || x.number === rooms[5].number), f?.rooms?.map((x) => x.number));
    r = await call('GET', '/frontdesk/home/free-rooms?status=all', M);
    check('HM13 "all vacant" adds the dirty ones', r.data.rooms.length > f.rooms.length && r.data.rooms.some((x) => !x.ready), [f.rooms.length, r.data?.rooms?.length]);
    r = await call('GET', `/frontdesk/home/free-rooms?from=${today}&to=${addDays(today, 90)}`, M);
    check('HM14 vacant search is limited to 60 nights', r.status === 422, r.status);

    // ── Rate use ──
    r = await call('PATCH', `/rates/plans/${paying._id}`, G, { use: 'free' });
    const ok = await call('PATCH', `/rates/plans/${paying._id}`, G, { use: 'house_use' });
    check('HM15 rate use accepts only paying / comp / house use', r.status === 422 && ok.status === 200 && (await RatePlan.findById(paying._id).lean()).use === 'house_use', [r.status, ok.status]);
    const audits = await AuditLog.countDocuments({ property: P, action: 'home.turnaway' });
    check('HM16 turned-away requests are audited', audits === 1, audits);
  } finally {
    await Promise.all([Room, RoomType, User, GuestProfile, Reservation, TurnAway, AuditLog, RatePlan, DeskItem].map((m) => m.deleteMany({ property: P }).catch(() => null)));
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
