#!/usr/bin/env node
/* eslint-disable no-console */
// Revenue management suite (gap-map item 9): day types + hotel calendar, length-of-stay tiers, channel
// restrictions (close / web discount), automatic strategies (place / lift, history), roles and audit.
// Runs against a live PMS server + the same DB, on a throw-away property removed at the end.
//   node scripts/revenueIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import InventoryDate from '../models/InventoryDate.js';
import AuditLog from '../models/AuditLog.js';
import Folio from '../models/Folio.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import { RatePlan } from '../models/RatePlan.js';
import { DayType, HotelDay, ChannelRule, RevenueStrategy, AutoRestriction, RestrictionLog } from '../models/Revenue.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { priceNights } from '../services/bookingService.js';
import { channelOf } from '../services/revenueService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `REV${Date.now().toString(36).toUpperCase()}`;
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
    for (let i = 1; i <= 4; i += 1) await Room.create({ property: P, roomType: rt._id, number: `${TAG.slice(-3)}${i}`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' });
    const bar = await RatePlan.create({ property: P, code: `${TAG}B`, name: 'BAR', type: 'public' });
    const fix = await RatePlan.create({ property: P, code: `${TAG}F`, name: 'קבוע', type: 'public', useDayTypes: false });
    await InventoryDate.insertMany(Array.from({ length: 45 }, (_, i) => ({ property: P, roomType: rt._id, date: addDays(today, i), physicalCount: 4 })));
    const users = {};
    for (const role of ['general_manager', 'front_desk_manager', 'housekeeper']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const G = tok(users.general_manager); const F = tok(users.front_desk_manager); const H = tok(users.housekeeper);
    const search = async (arrival, nights, extra = '') => {
      const r = await call('GET', `/booking/availability?arrival=${arrival}&departure=${addDays(arrival, nights)}&adults=2${extra}`, F);
      const by = (plan) => r.data?.offers?.find((o) => o.ratePlan.id === String(plan._id));
      return { r, bar: by(bar), fix: by(fix) };
    };
    const night = (o, d) => o?.nightly?.find((n) => n.date === d)?.price;

    // ── Day types + hotel calendar ──
    const D1 = addDays(today, 10);
    let r = await call('POST', '/revenue/day-types', G, { code: 'PK', name: 'שיא', multiplier: 9 });
    check('RV1 day type: multiplier out of range refused', r.status === 422 && r.fields?.multiplier, r);
    r = await call('POST', '/revenue/day-types', G, { code: 'PK', name: 'שיא', multiplier: 1.2, addition: 100, color: '#dc2626' });
    const peak = r.data;
    check('RV2 day type created', r.success && peak?.multiplier === 1.2 && peak.addition === 100, r);
    r = await call('POST', '/revenue/day-types', F, { code: 'LO', name: 'שפל', multiplier: 0.9 });
    check('RV3 front-desk manager cannot define day types', r.status === 403, r.status);
    r = await call('PUT', '/revenue/calendar', G, { from: D1, to: addDays(D1, 6), weekdays: [new Date(`${D1}T00:00:00Z`).getUTCDay()], dayTypeId: peak.id, events: 'כנס רפואה, מרתון', note: 'להזמין צוות נוסף' });
    check('RV4 calendar: range + weekday filter sets one day', r.success && r.data.updated === 1, r);
    r = await call('GET', `/revenue/calendar?from=${D1}&days=7`, F);
    const c0 = r.data?.rows?.[0]; const c1 = r.data?.rows?.[1];
    check('RV5 calendar shows day type, events, note only on that day', r.success && c0.dayTypeId === peak.id && c0.events.length === 2 && c0.note && !c1.dayTypeId, [c0, c1]);
    let s = await search(D1, 1);
    check('RV6 day type changes the price: (500 + 100) × 1.2 = 720', night(s.bar, D1) === 720 && s.bar.revenue?.dayTypes?.includes('שיא'), s.bar?.nightly);
    check('RV7 plan outside day types keeps its price', night(s.fix, D1) === 500, s.fix?.nightly);
    r = await call('GET', `/demand?from=${D1}&days=7&ratePlanId=${bar._id}&roomTypeId=${rt._id}`, G);
    check('RV8 demand system prices the night with its day type', r.data?.rows?.[0]?.price === 720, r.data?.rows?.[0]);

    // ── Length-of-stay tiers ──
    const A = addDays(today, 20);
    r = await call('PUT', `/revenue/plans/${bar._id}`, G, { tiers: [{ minNights: 1, pct: 5 }] });
    check('RV9 tier from 1 night refused', r.status === 422, r.status);
    r = await call('PUT', `/revenue/plans/${bar._id}`, G, { tiers: [{ minNights: 3, pct: 10, label: '3+' }, { minNights: 7, prices: [{ roomTypeId: String(rt._id), price: 300 }] }] });
    check('RV10 tiers saved (percent and price list)', r.success && r.data.tiers.length === 2 && r.data.tiers[1].prices[0].price === 300, r);
    s = await search(A, 2);
    check('RV11 short stay: no tier', night(s.bar, A) === 500 && !s.bar.revenue?.tier, s.bar?.nightly);
    s = await search(A, 3);
    check('RV12 3 nights: tier −10% → 450', night(s.bar, A) === 450 && s.bar.revenue?.tier === '3+', s.bar?.nightly);
    s = await search(A, 7);
    check('RV13 7 nights: tier price per room type → 300 every night', s.bar?.nightly?.length === 7 && s.bar.nightly.every((n) => n.price === 300), s.bar?.nightly);

    // ── Channel restrictions ──
    const B = addDays(today, 30);
    r = await call('POST', '/revenue/channel-rules', G, { channel: 'web', action: 'discount', pct: 0, from: B, to: addDays(B, 3) });
    check('RV14 web discount without percent refused', r.status === 422 && r.fields?.pct, r);
    r = await call('POST', '/revenue/channel-rules', G, { channel: 'web', action: 'discount', pct: 10, from: B, to: addDays(B, 3) });
    check('RV15 web discount saved', r.success && r.data.pct === 10, r);
    const web = await search(B, 1, '&channel=web'); const desk = await search(B, 1);
    check('RV16 web discount applies on the site only (450 vs 500)', night(web.bar, B) === 450 && night(desk.bar, B) === 500 && web.bar.revenue?.channelDiscount === 10, [web.bar?.nightly, desk.bar?.nightly]);
    r = await call('POST', '/revenue/channel-rules', G, { channel: 'desk', action: 'close', from: B, to: B, ratePlans: [String(fix._id)] });
    s = await search(B, 1);
    check('RV17 closing a plan at the desk: that plan not bookable, the other is', r.success && s.fix && !s.fix.bookable && s.fix.reasons.some((x) => x.code === 'channel_closed') && s.bar.bookable, s.fix?.reasons);
    const w2 = await search(B, 1, '&channel=web');
    check('RV18 desk closure does not close the site', w2.fix?.bookable === true, w2.fix?.reasons);

    // ── Strategies ──
    const D2 = addDays(today, 5);
    const made = [];
    for (let i = 0; i < 3; i += 1) {
      const g = await GuestProfile.create({ property: P, firstName: `אורח${i}`, lastName: TAG });
      made.push(await Reservation.create({ property: P, confirmationNumber: `${TAG}-${i}`, status: 'confirmed', primaryGuest: g._id, adults: 2, arrivalDate: D2, departureDate: addDays(D2, 1), nights: 1, roomsCount: 1, roomType: rt._id, ratePlan: bar._id, ratePerNight: 500, totalAmount: 500, guaranteeType: 'credit_card' }));
    }
    r = await call('POST', '/revenue/strategies', F, { name: 'x', threshold: 75, action: 'min_los', minLos: 2 });
    check('RV19 front-desk manager cannot define strategies', r.status === 403, r.status);
    r = await call('POST', '/revenue/strategies', G, { name: 'מלא', threshold: 75, action: 'min_los', minLos: 1 });
    check('RV20 min nights below 2 refused', r.status === 422 && r.fields?.minLos, r);
    r = await call('POST', '/revenue/strategies', G, { name: 'תפוסה 75', threshold: 75, action: 'min_los', minLos: 2, daysAhead: 14 });
    const st = r.data;
    check('RV21 strategy saved and run at once: one night (75%) restricted', r.success && st.activeCount === 1, r);
    s = await search(D2, 1);
    check('RV22 booking 1 night on that night: min 2 nights', s.bar && !s.bar.bookable && s.bar.reasons.some((x) => x.code === 'min_los') && s.bar.revenue?.strategyMinLos === 2, s.bar?.reasons);
    s = await search(addDays(D2, 1), 1);
    check('RV23 next night (empty) unaffected', s.bar?.bookable === true, s.bar?.reasons);
    r = await call('GET', '/revenue/calendar?days=14', F);
    check('RV24 calendar shows the automatic restriction', r.data?.rows?.find((x) => x.date === D2)?.auto?.[0]?.action === 'min_los', r.data?.rows?.find((x) => x.date === D2));
    await Reservation.updateOne({ _id: made[0]._id }, { $set: { status: 'cancelled' } });
    r = await call('POST', '/revenue/strategies/run', G, {});
    check('RV25 occupancy drops → restriction lifted', r.success && r.data.lifted === 1, r);
    s = await search(D2, 1);
    check('RV26 night bookable again', s.bar?.bookable === true, s.bar?.reasons);
    r = await call('GET', '/revenue/restrictions', F);
    const hist = r.data?.find((x) => x.date === D2);
    check('RV27 history keeps it: placed at 75, lifted at 50', hist && hist.measured === 75 && hist.liftedAt && hist.liftedMeasured === 50, hist);
    await Reservation.updateOne({ _id: made[0]._id }, { $set: { status: 'confirmed' } });
    r = await call('POST', '/revenue/strategies', G, { name: 'נמכרו 3', metric: 'rooms_sold', threshold: 3, action: 'stop_sell', daysAhead: 14, roomTypes: [String(rt._id)], ratePlans: [String(fix._id)], priority: 1 });
    s = await search(D2, 2);
    check('RV28 rooms sold → stop sell on the chosen plan only', r.success && s.fix && !s.fix.bookable && s.fix.reasons.some((x) => x.code === 'strategy_closed') && !s.bar.reasons.some((x) => x.code === 'strategy_closed'), [s.fix?.reasons, s.bar?.reasons]);
    r = await call('PATCH', `/revenue/strategies/${st.id}`, G, { name: 'תפוסה 75', threshold: 75, action: 'min_los', minLos: 2, daysAhead: 14, active: false });
    check('RV29 turning a strategy off lifts its restrictions', r.success && r.data.activeCount === 0 && !(await AutoRestriction.exists({ strategy: st.id, liftedAt: null })), r.data);

    // ── Plan order by day type ──
    s = await search(D1, 1);
    const order0 = s.r.data.offers.map((o) => o.ratePlan.id);
    r = await call('PATCH', `/revenue/day-types/${peak.id}`, G, { code: 'PK', name: 'שיא', multiplier: 1.2, addition: 100, color: '#dc2626', planOrder: [String(fix._id)] });
    s = await search(D1, 1);
    const order1 = s.r.data.offers.map((o) => o.ratePlan.id);
    const n1 = await search(addDays(D1, 1), 1);
    check('RV33 day type puts its plans first on that day only', r.success && order0[0] === String(bar._id) && order1[0] === String(fix._id) && s.r.data.dayType?.name === 'שיא' && n1.r.data.offers[0].ratePlan.id === String(bar._id), [order0, order1]);

    // ── Sales channel kept on the booking ──
    const W = addDays(B, 1);
    const offer = (await search(W, 1, '&channel=web')).bar;
    r = await call('POST', '/booking/reservations', F, { arrival: W, departure: addDays(W, 1), adults: 2, rooms: 1, roomTypeId: String(rt._id), ratePlanId: String(bar._id), channel: 'web', mode: 'confirm', priceSignature: offer.priceSignature, newGuest: { firstName: 'רינה', lastName: TAG, phone: '0521112233' }, idempotencyKey: `${TAG}w` });
    const wres = r.data?.id ? await Reservation.findById(r.data.id).lean() : null;
    check('RV34 booking keeps the channel it was sold on (web, 450)', wres?.salesChannel === 'web' && wres.totalAmount === 450, [r.status, r.error, wres?.salesChannel, wres?.totalAmount]);
    const pW = await priceNights({ roomTypeId: rt._id, ratePlanId: bar._id, dates: [B, W], channel: channelOf(wres) });
    const pD = await priceNights({ roomTypeId: rt._id, ratePlanId: bar._id, dates: [B, W] });
    check('RV35 repricing a site booking keeps the web discount; desk does not get it', pW.nightly.every((x) => x.price === 450) && pD.nightly.every((x) => x.price === 500) && channelOf({ marketSegment: 'website' }) === 'web', [pW.nightly, pD.nightly]);

    // ── Manual restriction history ──
    r = await call('PUT', '/rates/bulk', G, { ratePlanId: String(bar._id), roomTypeId: String(rt._id), from: addDays(today, 40), to: addDays(today, 41), price: 500, minLos: 3, cta: true });
    const r2 = await call('PUT', '/rates/date', G, { ratePlanId: String(bar._id), roomTypeId: String(rt._id), date: addDays(today, 41), price: 520, minLos: 1 });
    const r3 = await call('PUT', '/rates/date', G, { ratePlanId: String(bar._id), roomTypeId: String(rt._id), date: addDays(today, 40), price: 530, minLos: 3, cta: true });
    let lg = await call('GET', '/revenue/restrictions/manual', F);
    const h40 = lg.data?.filter((x) => x.date === addDays(today, 40)); const h41 = lg.data?.filter((x) => x.date === addDays(today, 41));
    check('RV36 manual restriction changes logged per night; price-only change not logged', r.success && r2.success && r3.success && h40?.length === 1 && h41?.length === 2 && h40[0].after.includes('מינ׳ 3') && h40[0].by !== '—', lg.data);
    check('RV37 "set" vs "active now": the night changed later is flagged', h41.find((x) => x.after.includes('מינ׳ 3'))?.changedSince === true && h41.find((x) => x.after === 'פתוח')?.changedSince === false && h40[0].changedSince === false, h41);
    const inv = await InventoryDate.findOne({ property: P, roomType: rt._id, date: addDays(today, 42) }).lean();
    r = await call('PATCH', `/inventory/${inv._id}`, G, { stopSell: true });
    lg = await call('GET', '/revenue/restrictions/manual', F);
    check('RV38 hotel inventory closure logged too', lg.data?.some((x) => x.level === 'inventory' && x.date === addDays(today, 42) && x.after === 'סגור למכירה'), [r.status, lg.data?.[0]]);
    const other = await RatePlan.create({ property: new mongoose.Types.ObjectId(), code: `${TAG}X`, name: 'זר' });
    r = await call('PUT', '/rates/date', G, { ratePlanId: String(other._id), roomTypeId: String(rt._id), date: addDays(today, 40), price: 1 });
    await RatePlan.deleteOne({ _id: other._id });
    check('RV39 rate calendar refuses a plan of another property', r.status === 404, r.status);

    // ── Roles + audit ──
    r = await call('GET', '/revenue/calendar', H);
    check('RV30 housekeeper cannot read revenue screens', r.status === 403, r.status);
    const acts = await AuditLog.distinct('action', { property: P, action: /^revenue\./ });
    check('RV31 audited: day type, calendar, tiers, channel rule, strategy, run', ['revenue.day_type_created', 'revenue.calendar_set', 'revenue.plan_tiers_saved', 'revenue.channel_rule_created', 'revenue.strategy_created', 'revenue.strategies_run'].every((a) => acts.includes(a)), acts);
    const n = await ChannelRule.countDocuments({ property: P });
    check('RV32 rules are per property', n === 2, n);
  } finally {
    await Promise.all([Room, RoomType, User, GuestProfile, Reservation, InventoryDate, AuditLog, RatePlan, DayType, HotelDay, ChannelRule, RevenueStrategy, AutoRestriction, RestrictionLog, Folio, ReservationRoom, StaySegment].map((m) => m.deleteMany({ property: P }).catch(() => null)));
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
