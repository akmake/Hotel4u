#!/usr/bin/env node
/* eslint-disable no-console */
// Custom permissions (gap-map item 11): permission groups over built-in roles (grant / deny, inheritance,
// individual overrides), charge-code and report-group limits, assignment rules, unlock, audit.
// Live PMS server + same DB, on a throw-away property removed at the end.
//   node scripts/permissionsIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import Folio from '../models/Folio.js';
import ChargeCode from '../models/ChargeCode.js';
import ReservationRoom from '../models/ReservationRoom.js';
import PermissionGroup from '../models/PermissionGroup.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `PRM${Date.now().toString(36).toUpperCase()}`;
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
    const guest = await GuestProfile.create({ property: P, firstName: 'אורח', lastName: TAG });
    const mk = (role, n = role) => User.create({ property: P, firstName: 'בדיקה', lastName: n, email: `${TAG.toLowerCase()}-${n}@test.local`, passwordHash: 'x', role, active: true });
    const admin = await mk('property_admin'); const gm = await mk('general_manager'); const clerk = await mk('receptionist', 'clerk'); const clerk2 = await mk('receptionist', 'clerk2'); const fdm = await mk('front_desk_manager');
    const A = tok(admin); const C = tok(clerk); const C2 = tok(clerk2); const M = tok(fdm); const GM = tok(gm);
    const room = await Room.create({ property: P, roomType: rt._id, number: `${TAG.slice(-3)}1`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'occupied' });
    const res = await Reservation.create({ property: P, confirmationNumber: `${TAG}-1`, status: 'in_house', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, -1), departureDate: addDays(today, 2), nights: 3, roomsCount: 1, roomType: rt._id, ratePerNight: 500, totalAmount: 1500, assignedRoom: room._id, guaranteeType: 'credit_card' });
    await ReservationRoom.create({ reservation: res._id, property: P, roomTypeBooked: rt._id, assignedRoom: room._id, arrivalDate: res.arrivalDate, departureDate: res.departureDate, nightlyRate: 500, status: 'in_house' });
    await Folio.create({ property: P, reservation: res._id, ownerType: 'guest', lines: [] });
    // 409 = permitted but nothing to release (a throw-away property has no non-guaranteed stays); 403 = not permitted.
    const release = (t) => call('POST', '/frontdesk/arrivals/release-non-guaranteed', t, { ids: [] }).then((x) => ({ ...x, success: x.status !== 403 }));

    // ── Catalogue + groups ──
    let r = await call('GET', '/permissions/catalog', C);
    check('PM1 receptionist cannot open permission management', r.status === 403, r.status);
    r = await call('GET', '/permissions/catalog', A);
    check('PM2 catalogue: capabilities, charge codes, report groups', r.success && r.data.capabilities.length >= 10 && r.data.chargeCodes.some((c) => c.code === 'minibar') && r.data.reportGroups.length > 3, r.data && Object.keys(r.data));
    r = await call('POST', '/permissions/groups', A, { name: 'אחראי משמרת', grants: ['nope'] });
    check('PM3 unknown capability refused', r.status === 422 && r.fields?.grants, r);
    r = await call('POST', '/permissions/groups', A, { name: 'אחראי משמרת', grants: ['gtd.release'], denies: ['gtd.release'] });
    check('PM4 same capability granted and denied refused', r.status === 422 && r.fields?.denies, r);
    r = await call('POST', '/permissions/groups', A, { name: 'פקיד', description: 'פקיד קבלה', grants: [], chargeCodes: ['minibar', 'f_and_b'] });
    const base = r.data;
    check('PM5 group created (charge codes limited)', r.success && base?.id && base.chargeCodes.length === 2, r);
    r = await call('POST', '/permissions/groups', A, { name: 'פקיד' });
    check('PM6 duplicate name refused', r.status === 409, r.status);
    r = await call('POST', '/permissions/groups', A, { name: 'x', chargeCodes: ['nope_code'] });
    check('PM7 unknown charge code refused', r.status === 422 && r.fields?.chargeCodes, r);
    r = await call('POST', '/permissions/groups', GM, { name: 'אחראי משמרת', parent: base.id, grants: ['gtd.release', 'charge.reverse'], description: 'פקיד + שחרור והיפוך' });
    const lead = r.data;
    check('PM8 group inheriting another ("shift lead" = "clerk" + more)', r.success && lead?.parent === base.id, r);
    r = await call('PATCH', `/permissions/groups/${base.id}`, A, { name: 'פקיד', parent: lead.id, chargeCodes: ['minibar', 'f_and_b'] });
    check('PM9 inheritance loop refused', r.status === 422 && r.fields?.parent, r);

    // ── Assignment + effect ──
    r = await release(C);
    check('PM10 before: a receptionist cannot release non-guaranteed', r.status === 403, r.status);
    r = await call('PATCH', `/permissions/users/${clerk._id}`, C, { group: lead.id });
    check('PM11 a receptionist cannot assign permissions', r.status === 403, r.status);
    r = await call('PATCH', `/permissions/users/${admin._id}`, A, { group: lead.id });
    check('PM12 nobody changes their own permissions', r.status === 403, r.status);
    r = await call('PATCH', `/permissions/users/${gm._id}`, A, { denies: ['nope'] });
    check('PM13 unknown capability on a user refused', r.status === 422, r.status);
    r = await call('PATCH', `/permissions/users/${clerk._id}`, A, { group: lead.id });
    check('PM14 receptionist assigned to the group: effective grants from the group and its parent', r.success && r.data.effective.grants.includes('gtd.release') && r.data.effective.chargeCodes.length === 2, r.data);
    r = await release(C);
    check('PM15 applies at once, same token: release now allowed', r.success, [r.status, r.error]);
    r = await release(C2);
    check('PM16 another receptionist without the group still cannot', r.status === 403, r.status);

    // ── Deny and individual override ──
    r = await call('POST', '/permissions/groups', A, { name: 'בלי שחרור', denies: ['gtd.release'] });
    const noRel = r.data;
    r = await release(M);
    check('PM17 front-desk manager releases by role', r.success, [r.status, r.error]);
    await call('PATCH', `/permissions/users/${fdm._id}`, A, { group: noRel.id });
    r = await release(M);
    check('PM18 group deny removes a role default', r.status === 403, r.status);
    r = await call('PATCH', `/permissions/users/${fdm._id}`, A, { grants: ['gtd.release'] });
    r = await release(M);
    check('PM19 an individual grant beats the group deny', r.success && !r.data?.effective?.denies?.includes('gtd.release'), [r.status, r.error]);
    r = await call('PATCH', `/permissions/users/${fdm._id}`, A, { grants: ['gtd.release'], denies: ['gtd.release'] });
    check('PM20 grant + deny of the same capability on one user refused', r.status === 422, r);
    await call('PATCH', `/permissions/users/${fdm._id}`, A, { group: null, grants: [], denies: [] });
    r = await release(M);
    check('PM21 group removed → back to the role default', r.success, [r.status, r.error]);

    // ── Charge-code limit ──
    const charge = (t, department) => call('POST', `/frontdesk/reservations/${res._id}/charges`, t, { description: 'בדיקה', amount: 50, department, idempotencyKey: key() });
    r = await charge(C, 'spa');
    check('PM22 a code outside the group list is refused', r.status === 403 && r.code === 'code_not_permitted' || r.status === 403, [r.status, r.error]);
    r = await charge(C, 'minibar');
    check('PM23 a permitted code posts', r.success, [r.status, r.error]);
    r = await charge(C2, 'spa');
    check('PM24 without the group no limit', r.success, [r.status, r.error]);

    // ── Report groups ──
    const lim = await call('POST', '/permissions/groups', A, { name: 'דוחות קבלה', reportGroups: ['קבלה'] });
    await call('PATCH', `/permissions/users/${clerk2._id}`, A, { group: lim.data.id });
    r = await call('GET', '/report-center/catalog', C2);
    check('PM25 report catalogue shows only the permitted group', r.success && r.data.reports.length > 0 && r.data.reports.every((x) => x.group === 'קבלה'), r.data?.reports?.map((x) => x.group));
    const other = (await call('GET', '/report-center/catalog', C)).data?.reports?.find((x) => x.group !== 'קבלה');
    r = other ? await call('GET', `/report-center/${other.code}`, C2) : { status: 0 };
    check('PM26 opening a report of another group is refused', r.status === 403, r.status);
    r = await call('POST', '/permissions/groups', A, { name: 'x', reportGroups: ['לא קיימת'] });
    check('PM27 unknown report group refused', r.status === 422, r.status);

    // ── Unlock ──
    r = await call('POST', `/permissions/users/${clerk._id}/unlock`, A, {});
    check('PM30 unlocking a user who is not locked refused', r.status === 409, r.status);
    await User.updateOne({ _id: clerk._id }, { $set: { lockUntil: new Date(Date.now() + 3600000), failedLoginAttempts: 3 } });
    r = await call('GET', '/permissions/users', A);
    check('PM31 users list shows the lock', r.success && r.data.find((u) => u.id === String(clerk._id))?.locked === true, r.data?.length);
    r = await call('POST', `/permissions/users/${clerk._id}/unlock`, C2, {});
    check('PM32 a receptionist cannot unlock', r.status === 403, r.status);
    r = await call('POST', `/permissions/users/${clerk._id}/unlock`, A, {});
    const after = await User.findById(clerk._id).lean();
    check('PM33 administrator unlocks: lock and counter cleared', r.success && !after.lockUntil && after.failedLoginAttempts === 0, after);

    // ── Audit ──
    const acts = await AuditLog.distinct('action', { property: P, action: /^(permission|user)\./ });
    check('PM34 audited: group create / update-less, user assign, unlock', ['permission.group_create', 'permission.user_assign', 'user.unlock'].every((a) => acts.includes(a)), acts);
  } finally {
    await Promise.all([Room, RoomType, User, GuestProfile, Reservation, AuditLog, Folio, ReservationRoom, ChargeCode, PermissionGroup].map((m) => m.deleteMany({ property: P }).catch(() => null)));
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
