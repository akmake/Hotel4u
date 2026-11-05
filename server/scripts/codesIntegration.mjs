#!/usr/bin/env node
/* eslint-disable no-console */
// Code lists the hotel manages (gap-map item 13): reading / editing lists, fixed lists, reasons used by the
// discount / delete / turnaway / cancellation flows, VIP services + language + segment applied to a new booking,
// shared seasons in price rules, guest preferences from the list, roles and audit.
// Live PMS server + same DB, on a throw-away property removed at the end.
//   node scripts/codesIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import AuditLog from '../models/AuditLog.js';
import CodeList from '../models/CodeList.js';
import TurnAway from '../models/TurnAway.js';
import { applyBookingDefaults } from '../services/codeListService.js';
import { revenueContext } from '../services/revenueService.js';
import { matchesRule } from '../services/ratePricing.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `CDL${Date.now().toString(36).toUpperCase()}`;
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

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG, reservationSequence: 0 });
  P = String(p._id);
  try {
    const rt = await RoomType.create({ property: P, code: `${TAG}S`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3, adultsMax: 3 });
    const mk = (role) => User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const G = tok(await mk('general_manager')); const R = tok(await mk('receptionist'));

    let r = await call('GET', '/codes', R);
    check('CL1 every user reads the lists (15 lists with defaults)', r.success && r.data.length === 15 && r.data.find((l) => l.list === 'reason_discount')?.items.length >= 5, r.data?.length);
    r = await call('PUT', '/codes/reason_discount/loyalty', R, { label: 'חבר מועדון' });
    check('CL2 receptionist cannot change lists', r.status === 403, r.status);
    r = await call('PUT', '/codes/source/my_source', G, { label: 'מקור חדש' });
    check('CL3 a fixed list (sources) takes no new codes', r.status === 422 && r.fields?.code, r);
    r = await call('PUT', '/codes/source/phone', G, { label: 'טלפון / וואטסאפ' });
    check('CL4 a fixed list can rename a code', r.success && r.data.label === 'טלפון / וואטסאפ' && r.data.builtIn, r);
    r = await call('PUT', '/codes/reason_discount/loyalty', G, { label: 'חבר מועדון' });
    await call('PUT', '/codes/reason_discount/staff', G, { label: 'עובד / משפחת עובד', active: false });
    const dc = await call('GET', '/booking/discount-config', R);
    check('CL5 discount reasons: the hotel added one and turned one off', dc.success && dc.data.reasons.some((x) => x.code === 'loyalty') && !dc.data.reasons.some((x) => x.code === 'staff'), dc.data?.reasons?.map((x) => x.code));
    await call('PUT', '/codes/reason_delete/test', G, { label: 'הזמנת ניסיון', active: false });
    r = await call('GET', '/booking/delete-reasons', R);
    check('CL6 delete reasons follow the list', r.success && !r.data.some((x) => x.code === 'test') && r.data.some((x) => x.code === 'duplicate'), r.data);
    await call('PUT', '/codes/reason_turnaway/wedding', G, { label: 'חתונה באזור — הכול תפוס' });
    r = await call('POST', '/frontdesk/home/turnaways', R, { date: addDays(today, 5), nights: 2, rooms: 1, reason: 'wedding' });
    check('CL7 a turnaway with the hotel\'s own reason is recorded', r.success, [r.status, r.error, r.fields]);
    r = await call('POST', '/frontdesk/home/turnaways', R, { date: addDays(today, 5), nights: 2, rooms: 1, reason: 'nope' });
    check('CL8 a reason that is not on the list is refused', r.status === 422 && r.fields?.reason, r.status);

    // Cancellation reasons: the hotel's code is accepted; the legal codes keep their meaning.
    const guest = await GuestProfile.create({ property: P, firstName: 'אורח', lastName: TAG, vipLevel: 2, country: 'RU' });
    const res = await Reservation.create({ property: P, confirmationNumber: `${TAG}-1`, status: 'confirmed', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, 20), departureDate: addDays(today, 22), nights: 2, roomsCount: 1, roomType: rt._id, ratePerNight: 500, totalAmount: 1000, source: 'agent', guaranteeType: 'credit_card' });
    await call('PUT', '/codes/reason_cancel/weather', G, { label: 'מזג אוויר' });
    r = await call('POST', `/stay/${res._id}/cancellation/preview`, R, { channel: 'phone', track: 'regular', reason: 'weather', note: 'סערה' });
    check('CL9 cancellation preview accepts the hotel\'s reason', r.success, [r.status, r.error, r.fields]);
    r = await call('POST', `/stay/${res._id}/cancellation/preview`, R, { channel: 'phone', track: 'regular', reason: 'made_up' });
    check('CL10 cancellation with an unknown reason refused', r.status === 422 && r.fields?.reason, r.status);

    // VIP services + language + segment applied to a new booking.
    r = await call('PUT', '/codes/vip/2', G, { label: 'VIP זהב', extra: { services: ['flowers', 'nope'] } });
    check('CL11 VIP services must exist in the special-services list', r.status === 422, r.status);
    r = await call('PUT', '/codes/vip/2', G, { label: 'VIP זהב', extra: { services: ['flowers', 'fruit'] } });
    check('CL12 VIP level 2 → flowers + fruit', r.success && r.data.extra.services.length === 2, r);
    r = await call('PUT', '/codes/language_by_nationality/ru', G, { label: 'russian' });
    check('CL13 language rule validated (country code + 2-letter language)', r.status === 422 && r.fields?.code && r.fields?.label, r.fields);
    await call('PUT', '/codes/segment/agents', G, { label: 'סוכני נסיעות', extra: { sources: ['agent'] } });
    await applyBookingDefaults({ propertyId: P, reservationId: res._id });
    const after = await Reservation.findById(res._id).lean();
    check('CL14 new booking: VIP services added, language from nationality (RU → ru), segment by rule (agent)', after.specialServices.map((s) => s.code).sort().join() === 'flowers,fruit' && after.specialServices.every((s) => s.source === 'vip') && after.language === 'ru' && after.marketSegment === 'agents', [after.specialServices, after.language, after.marketSegment]);
    await applyBookingDefaults({ propertyId: P, reservationId: res._id });
    check('CL15 applying again adds nothing twice', (await Reservation.findById(res._id).lean()).specialServices.length === 2);

    // Seasons in price rules.
    r = await call('PUT', '/codes/season/summer', G, { label: 'קיץ', extra: { ranges: [{ from: addDays(today, 10), to: addDays(today, 5) }] } });
    check('CL16 season with a reversed range refused', r.status === 422 && r.fields?.extra, r.status);
    r = await call('PUT', '/codes/season/summer', G, { label: 'קיץ', extra: { ranges: [{ from: addDays(today, 10), to: addDays(today, 40) }] } });
    const rev = await revenueContext({ propertyId: P, dates: [addDays(today, 15)] });
    check('CL17 season saved and reaches the pricing context', r.success && rev.seasons?.summer?.length === 1, rev.seasons);
    const rule = { active: true, season: 'summer' };
    check('CL18 a price rule naming the season applies inside it and not outside', matchesRule(rule, { date: addDays(today, 15), seasons: rev.seasons }) && !matchesRule(rule, { date: addDays(today, 50), seasons: rev.seasons }));

    // Preferences from the list.
    r = await call('PATCH', `/guests/${guest._id}`, R, { preferenceCodes: ['quiet_room', 'nope'] });
    check('CL19 a preference that is not on the list is refused', r.status === 422, r.status);
    r = await call('PATCH', `/guests/${guest._id}`, R, { preferenceCodes: ['quiet_room', 'high_floor'] });
    check('CL20 preferences saved on the profile', (await GuestProfile.findById(guest._id).lean()).preferenceCodes?.length === 2, [r.status, r.error]);

    await call('PUT', '/codes/reason_discount/loyalty', G, { label: 'חבר מועדון (כרטיס)' });
    const acts = await AuditLog.distinct('action', { property: P, action: /^codes\./ });
    check('CL21 changes audited (create + update)', acts.includes('codes.create') && acts.includes('codes.update'), acts);
  } finally {
    await Promise.all([RoomType, User, GuestProfile, Reservation, AuditLog, CodeList, TurnAway].map((m) => m.deleteMany({ property: P }).catch(() => null)));
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
