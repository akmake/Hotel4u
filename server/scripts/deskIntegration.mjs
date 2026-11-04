#!/usr/bin/env node
/* eslint-disable no-console */
// Front-desk communication suite (gap-map item 4): guest messages, alerts, traces, wake-up calls,
// locators, log book, phone book, operator search. Runs against a live PMS server + the same DB, on a
// throw-away property that is removed at the end.
//   node scripts/deskIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import AuditLog from '../models/AuditLog.js';
import { DeskItem, PhoneBookEntry } from '../models/DeskItem.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `DSK${Date.now().toString(36).toUpperCase()}`;
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18 });
  const P = String(p._id);
  try {
    const rt = await RoomType.create({ property: P, code: TAG, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    const rooms = [];
    for (let i = 1; i <= 3; i += 1) rooms.push(await Room.create({ property: P, roomType: rt._id, number: `${i}01`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'occupied' }));
    const users = {};
    for (const role of ['front_desk_manager', 'receptionist', 'housekeeper', 'technician']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const t = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, tok(u)]));
    const R = t.receptionist; const M = t.front_desk_manager; const HK = t.housekeeper; const TECH = t.technician;
    const guest = await GuestProfile.create({ property: P, firstName: 'דנה', lastName: `כהן${TAG}` });
    const mk = (i, extra = {}) => Reservation.create({ property: P, confirmationNumber: `${TAG}-${i}`, status: 'in_house', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, -1), departureDate: addDays(today, 3), nights: 4, roomsCount: 1, roomType: rt._id, ratePerNight: 500, totalAmount: 2000, assignedRoom: rooms[i]._id, checkedInAt: new Date(), ...extra });
    const r1 = await mk(0, { group: `G${TAG}` }); const r2 = await mk(1, { group: `G${TAG}` }); const r3 = await mk(2);
    const R1 = String(r1._id);

    // ── messages
    let r = await call('POST', '/desk/items', R, { propertyId: P, kind: 'message', reservationId: R1, text: 'להתקשר בחזרה' });
    check('MSG a message needs who left it', r.status === 422 && r.fields?.from, r.status);
    r = await call('POST', '/desk/items', R, { propertyId: P, kind: 'message', reservationId: R1, from: 'יוסי ממשרד הנסיעות', fromPhone: '050-1234567', text: 'להתקשר בחזרה לגבי הטיסה' });
    const msgId = r.data?.items?.[0]?.id;
    check('MSG a message for the guest is saved with room + guest snapshot', r.status === 200 && r.data.items[0].room === '101' && r.data.items[0].guest.startsWith('דנה'), `${r.status} ${r.error}`);
    r = await call('GET', `/frontdesk/in-house?propertyId=${P}`, R);
    const row = (r.data?.rows || []).find((x) => x.reservationId === R1);
    check('MSG the in-house list flags a waiting message', row?.messages === 1, JSON.stringify(row?.messages));
    r = await call('POST', '/desk/items/close', R, { propertyId: P, ids: [msgId], status: 'done', deliveredHow: 'printed' });
    const del = await DeskItem.findById(msgId).lean();
    check('MSG marked delivered (printed): closed with who and when, not deleted', r.status === 200 && del.status === 'done' && del.deliveredHow === 'printed' && !!del.closedByName, `${r.status} ${r.error}`);

    // ── alerts
    r = await call('POST', '/desk/items', R, { propertyId: P, kind: 'alert', reservationId: R1, text: 'לבדוק תעודת סטודנט' });
    check('ALR an alert needs when to pop up', r.status === 422 && r.fields?.on, r.status);
    r = await call('POST', '/desk/items', R, { propertyId: P, kind: 'alert', reservationId: R1, text: 'לבדוק תעודת סטודנט', on: ['check_out', 'open'] });
    const st = await call('GET', `/desk/stays/${R1}?propertyId=${P}`, R);
    check('ALR the stay view returns the alert with its moments', r.status === 200 && st.data?.alerts?.[0]?.on.includes('check_out'), `${r.status} ${r.error}`);

    // ── traces
    r = await call('POST', '/desk/items', R, { propertyId: P, kind: 'trace', reservationId: R1, department: 'housekeeping', text: 'פרחים בחדר', fromDate: today, toDate: addDays(today, 1) });
    const traceId = r.data?.items?.[0]?.id;
    await call('POST', '/desk/items', R, { propertyId: P, kind: 'trace', department: 'maintenance', text: 'לבדוק מזגן בלובי', fromDate: today });
    const hkList = await call('GET', `/desk/items?propertyId=${P}&kind=trace&from=${today}`, HK);
    check('TRC housekeeping sees only its department\'s open traces', r.status === 200 && hkList.data?.rows?.length === 1 && hkList.data.rows[0].department === 'housekeeping', `${r.status} ${hkList.status} ${hkList.data?.rows?.length}`);
    const tomorrowList = await call('GET', `/desk/items?propertyId=${P}&kind=trace&from=${addDays(today, 1)}`, R);
    check('TRC a trace over two days shows on the second day too', tomorrowList.data?.rows?.some((x) => x.id === traceId), tomorrowList.status);
    r = await call('POST', '/desk/items/close', HK, { propertyId: P, ids: [traceId], status: 'done' });
    check('TRC the department marks it resolved', r.status === 200 && (await DeskItem.findById(traceId).lean()).status === 'done', `${r.status} ${r.error}`);
    r = await call('POST', '/desk/items', TECH, { propertyId: P, kind: 'message', reservationId: R1, from: 'x', text: 'xx' });
    check('RBAC a technician cannot leave guest messages', r.status === 403, r.status);

    // ── wake-up calls
    r = await call('POST', '/desk/items', R, { propertyId: P, kind: 'wakeup', reservationId: R1, time: '25:00', date: today });
    check('WKP a wake-up needs a valid time', r.status === 422 && r.fields?.time, r.status);
    r = await call('POST', '/desk/items', R, { propertyId: P, kind: 'wakeup', reservationId: R1, time: '06:30', date: today, untilDate: addDays(today, 10), wholeGroup: true });
    check('WKP "every day until" for the whole group: one call per guest per day, cut at departure (2 guests × 4 days)', r.status === 200 && r.data.count === 8, `${r.status} ${r.error} ${r.data?.count}`);
    const wk = await call('GET', `/desk/items?propertyId=${P}&kind=wakeup&date=${today}`, R);
    check('WKP the day\'s wake-up list has both rooms at 06:30', wk.data?.rows?.length === 2 && wk.data.rows.every((x) => x.time === '06:30'), JSON.stringify(wk.data?.rows?.map((x) => x.room)));
    r = await call('POST', '/desk/items/close', R, { propertyId: P, ids: [wk.data.rows[0].id], status: 'no_answer', note: 'צלצל 3 פעמים' });
    const after = await call('GET', `/desk/items?propertyId=${P}&kind=wakeup&date=${today}&view=all`, R);
    check('WKP result "no answer" is kept with the time it was done', r.status === 200 && after.data.rows.some((x) => x.status === 'no_answer' && x.closedAt), `${r.status} ${r.error}`);

    // ── locator
    r = await call('POST', '/desk/items', R, { propertyId: P, kind: 'locator', reservationId: R1, text: 'בבריכה', until: new Date(Date.now() + 2 * 3600e3).toISOString() });
    await call('POST', '/desk/items', R, { propertyId: P, kind: 'locator', reservationId: R1, text: 'בספא', until: new Date(Date.now() + 3600e3).toISOString() });
    const op = await call('GET', `/desk/operator?propertyId=${P}&q=101`, R);
    check('LOC a new locator replaces the old one; the operator finds room 101 with "בספא" + wake-up', r.status === 200 && op.data?.rows?.[0]?.locator?.text === 'בספא' && op.data.rows[0].wakeup && (await DeskItem.countDocuments({ property: P, kind: 'locator', status: 'open' })) === 1, JSON.stringify(op.data?.rows?.[0]));
    r = await call('POST', '/desk/items', R, { propertyId: P, kind: 'locator', reservationId: R1, text: 'בבר', until: new Date(Date.now() - 60e3).toISOString() });
    check('LOC a locator in the past is refused', r.status === 422 && r.fields?.until, r.status);

    // ── log book
    r = await call('POST', '/desk/items', M, { propertyId: P, kind: 'logbook', text: 'המעלית בצד המערבי בתיקון עד מחר', important: true });
    const lb = await call('GET', `/desk/items?propertyId=${P}&kind=logbook`, R);
    check('LOG a shift note is unread for the next clerk', r.status === 200 && lb.data?.unread === 1, `${r.status} ${lb.data?.unread}`);
    await call('POST', `/desk/items/${r.data.items[0].id}/read`, R, { propertyId: P });
    const lb2 = await call('GET', `/desk/items?propertyId=${P}&kind=logbook`, R);
    check('LOG after reading it, it is marked read by name', lb2.data?.unread === 0 && lb2.data.rows[0].readBy.length === 2, JSON.stringify(lb2.data?.rows?.[0]?.readBy));
    r = await call('POST', '/desk/items/close', R, { propertyId: P, ids: [r.data.items[0].id], status: 'cancelled' });
    check('LOG a clerk cannot cancel someone else\'s note', r.status === 403, r.status);

    // ── phone book
    r = await call('POST', '/desk/phone-book', R, { propertyId: P, category: 'car_hire', name: 'אוויס טבריה' });
    check('PHB an entry needs a phone or a site', r.status === 422 && r.fields?.phone, r.status);
    r = await call('POST', '/desk/phone-book', R, { propertyId: P, category: 'car_hire', name: 'אוויס טבריה', phone: '04-6722766', website: 'avis.co.il' });
    const pb = await call('GET', `/desk/phone-book?propertyId=${P}&q=השכרת`, R);
    check('PHB saved with a full link; found by category name', r.status === 200 && pb.data?.rows?.[0]?.website === 'https://avis.co.il', `${r.status} ${JSON.stringify(pb.data?.rows)}`);
    void r3;
  } finally {
    await AuditLog.deleteMany({ property: p._id });
    await DeskItem.deleteMany({ property: p._id });
    await PhoneBookEntry.deleteMany({ property: p._id });
    await Reservation.deleteMany({ property: p._id });
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
