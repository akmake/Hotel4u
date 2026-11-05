#!/usr/bin/env node
/* eslint-disable no-console */
// Packages + agent commissions (gap-map item 10): components (simple / allowance), plan and reservation links,
// nightly posting (included / added, schedule), allowance absorption (profit / loss / excess, hours), commission
// percent sources, holds, manual edits, payments (cheque lifecycle) and roles. Live PMS server + same DB, on a
// throw-away property removed at the end.
//   node scripts/packagesIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import Company from '../models/Company.js';
import ChargeCode from '../models/ChargeCode.js';
import ReservationRoom from '../models/ReservationRoom.js';
import { RatePlan } from '../models/RatePlan.js';
import { PackageComponent, PackageUsage } from '../models/Package.js';
import { CommissionRecord, CommissionPayment } from '../models/Commission.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `PKG${Date.now().toString(36).toUpperCase()}`;
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
const r2 = (n) => Math.round(n * 100) / 100;
const key = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG, reservationSequence: 0 });
  P = String(p._id);
  try {
    const rt = await RoomType.create({ property: P, code: `${TAG}S`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3, adultsMax: 3 });
    const guest = await GuestProfile.create({ property: P, firstName: 'אורח', lastName: TAG });
    const users = {};
    for (const role of ['general_manager', 'receptionist', 'finance_manager']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const G = tok(users.general_manager); const R = tok(users.receptionist); const F = tok(users.finance_manager);
    let roomSeq = 0;
    const mkStay = async ({ arrival, departure, plan, adults = 2, children = 0, rate = 500, status = 'in_house', extra = {} }) => {
      const room = await Room.create({ property: P, roomType: rt._id, number: `${TAG.slice(-3)}${(roomSeq += 1)}`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'occupied' });
      const nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000);
      const r = await Reservation.create({ property: P, confirmationNumber: `${TAG}-${roomSeq}`, status, primaryGuest: guest._id, adults, children, arrivalDate: arrival, departureDate: departure, nights, roomsCount: 1, roomType: rt._id, ratePlan: plan?._id, ratePerNight: rate, totalAmount: rate * nights, assignedRoom: room._id, guaranteeType: 'credit_card', ...extra });
      await ReservationRoom.create({ reservation: r._id, property: P, roomTypeBooked: rt._id, assignedRoom: room._id, arrivalDate: arrival, departureDate: departure, nightlyRate: rate, adults, children, status });
      await Folio.create({ property: P, reservation: r._id, ownerType: 'guest', lines: [] });
      return r;
    };
    const lines = async (r) => (await Folio.find({ reservation: r._id }).lean()).flatMap((f) => f.lines);

    // ── Components ──
    let r = await call('POST', '/packages/components', R, { code: 'BKF', name: 'ארוחת בוקר', price: 60, chargeCode: 'board' });
    check('PK1 receptionist cannot define components', r.status === 403, r.status);
    r = await call('POST', '/packages/components', G, { code: 'DIN', name: 'ארוחת ערב', kind: 'allowance', price: 100, allowance: 80, chargeCode: 'board' });
    check('PK2 allowance below price refused', r.status === 422 && r.fields?.allowance, r);
    r = await call('POST', '/packages/components', G, { code: 'DIN', name: 'ארוחת ערב', price: 100, chargeCode: 'nope' });
    check('PK3 unknown charge code refused', r.status === 422 && r.fields?.chargeCode, r);
    r = await call('POST', '/packages/components', G, { code: 'X', name: 'x', price: 10, chargeCode: 'board', schedule: 'weekdays' });
    check('PK4 bad code / weekdays without a day refused', r.status === 422 && r.fields?.code && r.fields?.weekdays, r);
    r = await call('POST', '/packages/components', G, { code: 'BKF', name: 'ארוחת בוקר', description: 'מזנון בוקר 07:00–10:30', price: 60, calc: 'per_adult_child', childPrice: 30, link: 'included', chargeCode: 'board' });
    const bkf = r.data;
    check('PK5 simple component created', r.success && bkf?.id && bkf.link === 'included' && bkf.childPrice === 30, r);
    r = await call('POST', '/packages/components', G, { code: 'BKF', name: 'כפול', price: 1, chargeCode: 'board' });
    check('PK6 duplicate code refused', r.status === 409, r.status);
    r = await call('POST', '/packages/components', G, { code: 'SHOW', name: 'מופע', price: 120, calc: 'per_room', link: 'added', schedule: 'first', chargeCode: 'other', sellable: true });
    const show = r.data;
    check('PK7 "first night" added component created', r.success && show?.schedule === 'first' && show.sellable, r);
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const outside = Number(hm.slice(0, 2)) < 12 ? ['20:00', '21:00'] : ['01:00', '02:00'];
    r = await call('POST', '/packages/components', G, { code: 'DIN', name: 'ארוחת ערב', kind: 'allowance', price: 100, allowance: 150, calc: 'per_room', link: 'added', chargeCode: 'board', altCodes: ['f_and_b'], validFrom: '00:00', validTo: '23:59' });
    const din = r.data;
    check('PK8 allowance component (price 100, allowance 150, alternative code)', r.success && din?.kind === 'allowance' && din.allowance === 150 && din.altCodes[0] === 'f_and_b', r);
    r = await call('POST', '/packages/components', G, { code: 'LATE', name: 'קפה מאוחר', kind: 'allowance', price: 20, allowance: 20, calc: 'per_room', link: 'added', chargeCode: 'board', altCodes: ['minibar'], validFrom: outside[0], validTo: outside[1] });
    const late = r.data;
    r = await call('PATCH', `/packages/components/${bkf.id}`, G, { code: 'ZZZ', name: 'ארוחת בוקר', description: 'מזנון', price: 60, calc: 'per_adult_child', childPrice: 30, link: 'included', chargeCode: 'board' });
    check('PK9 code is immutable on update', r.success && r.data.code === 'BKF', r.data);

    // ── Plan links + nightly posting ──
    const plan = await RatePlan.create({ property: P, code: `${TAG}B`, name: 'עם בוקר', type: 'package' });
    r = await call('PUT', `/packages/plans/${plan._id}`, G, { components: [{ component: bkf.id }, { component: bkf.id }] });
    check('PK10 same component twice on a plan refused', r.status === 422, r.status);
    r = await call('PUT', `/packages/plans/${plan._id}`, G, { components: [{ component: bkf.id }, { component: din.id }, { component: late.id }], commission: { eligible: true } });
    check('PK11 plan linked to components + qualifies for commission', r.success && r.data.components.length === 3 && r.data.commission.eligible, r);
    const s1 = await mkStay({ arrival: addDays(today, -2), departure: addDays(today, 2), plan, adults: 2, children: 1 });
    r = await call('GET', `/packages/reservations/${s1._id}`, R);
    const n0 = r.data?.nights?.[0];
    check('PK12 breakdown per night: 4 nights, breakfast 2×60+30 = 150 included, room = 500 − 150', r.success && r.data.nights.length === 4 && n0.components.find((c) => c.code === 'BKF')?.amount === 150 && n0.room === 350, n0);
    r = await call('POST', `/packages/reservations/${s1._id}/items`, R, { component: show.id });
    check('PK13 front desk adds a sellable component to the stay', r.success, r);
    r = await call('POST', `/packages/reservations/${s1._id}/items`, R, { component: bkf.id });
    check('PK14 a component not sold separately is refused', r.status === 422, r);
    r = await call('GET', `/packages/reservations/${s1._id}`, R);
    check('PK15 "first night" component only on night 1', r.data.nights[0].components.some((c) => c.code === 'SHOW') && r.data.nights.slice(1).every((c) => !c.components.some((x) => x.code === 'SHOW')), r.data.nights.map((x) => x.components.map((c) => c.code)));
    r = await call('POST', `/frontdesk/reservations/${s1._id}/post-nights`, R, {});
    const posted = await lines(s1);
    const roomLines = posted.filter((l) => l.department === 'rooms'); const bk = posted.filter((l) => l.reference?.startsWith('pkg:') && l.description.includes('ארוחת בוקר'));
    check('PK16 day close posts nights ended so far (2): room lines at 350 gross, breakfast 150 on its own line', r.success && roomLines.length === 2 && roomLines.every((l) => r2(l.amount + l.taxAmount) === 350) && bk.length === 2 && bk.every((l) => r2(l.amount + l.taxAmount) === 150), [r.status, roomLines.length, bk.length, posted.length]);
    const nightGross = (d) => r2(posted.filter((l) => l.serviceDate === d && l.type === 'charge').reduce((s, l) => s + l.amount + l.taxAmount, 0));
    check('PK17 guest total unchanged by "included": night 1 = 500 + show 120 + dinner 100 + late 20', nightGross(addDays(today, -2)) === 740, nightGross(addDays(today, -2)));
    const again = await call('POST', `/frontdesk/reservations/${s1._id}/post-nights`, R, {});
    check('PK18 posting twice adds nothing', again.success && (await lines(s1)).length === posted.length, again);
    const u0 = await PackageUsage.findOne({ reservation: s1._id, date: addDays(today, -2) }).lean();
    check('PK19 allowance night keeps its ledger row (price 100, allowance 150, nothing used)', u0 && u0.price === 100 && u0.allowance === 150 && u0.used === 0, u0);

    // ── Allowance absorbs outlet charges ──
    const ch = (amount, department = 'f_and_b') => call('POST', `/frontdesk/reservations/${s1._id}/charges`, R, { description: 'מסעדה', amount, department, idempotencyKey: key() });
    let c = await ch(90);
    check('PK20 dinner 90 within the allowance: fully absorbed', c.success && c.data.packageAbsorbed === 90, c);
    c = await ch(100);
    check('PK21 second dinner 100: only 60 left of 150 → 60 absorbed, 40 excess to the guest', c.success && c.data.packageAbsorbed === 60, c);
    const uT = await PackageUsage.findOne({ reservation: s1._id, component: din.id, date: today }).lean();
    check('PK22 usage: used 150, excess 40, price 100 → loss 50', uT && uT.used === 150 && uT.excess === 40 && uT.price === 100, uT);
    const after = await lines(s1);
    const credits = after.filter((l) => l.reference?.startsWith('pkgabs:'));
    check('PK23 absorption = new discount lines linked to the charges (nothing edited)', credits.length === 2 && credits.every((l) => l.type === 'discount' && l.discountOf) && r2(credits.reduce((s, l) => s + l.amount + l.taxAmount, 0)) === -150, credits.map((l) => [l.amount, l.taxAmount]));
    c = await ch(30, 'minibar');
    check('PK24 hours: the "late" allowance is outside its hours → nothing absorbed', c.success && !c.data.packageAbsorbed, c.data);
    c = await ch(50, 'spa');
    check('PK25 a code the package does not cover is not absorbed', c.success && !c.data.packageAbsorbed, c.data);
    r = await call('GET', `/packages/ledger?from=${addDays(today, -2)}&to=${today}`, F);
    const dinRow = r.data?.rows?.find((x) => x.code === 'DIN');
    check('PK26 package ledger: profit on unused nights, loss + excess on the used one', r.success && dinRow && dinRow.profit === 200 && dinRow.loss === 50 && dinRow.excess === 40, dinRow);
    r = await call('DELETE', `/packages/reservations/${s1._id}/items/${(await Reservation.findById(s1._id).lean()).packageItems[0]._id}`, R);
    check('PK27 component removed from the stay', r.success && r.data.items === 0, r);

    // ── Commissions ──
    const agent = await Company.create({ property: P, name: 'סוכן בדיקה', type: 'agency', commissionPct: 10, agentCode: 'AG1' });
    const noPlan = await RatePlan.create({ property: P, code: `${TAG}N`, name: 'ללא עמלה', type: 'public' });
    const pl8 = await RatePlan.create({ property: P, code: `${TAG}E`, name: 'עמלה 8', type: 'public', commission: { eligible: true, pct: 8 } });
    const pl10 = await RatePlan.create({ property: P, code: `${TAG}T`, name: 'עמלה מהסוכן', type: 'public', commission: { eligible: true } });
    r = await call('PUT', `/packages/plans/${noPlan._id}`, G, { commission: { eligible: true, pct: 120 } });
    check('PK28 commission over 100% refused', r.status === 422, r.status);
    const past = addDays(today, -3);
    const mkDeparted = async (plan, extra = {}, base = 1000) => {
      const s = await mkStay({ arrival: addDays(past, -2), departure: past, plan, status: 'checked_out', extra: { travelAgent: agent._id, ...extra } });
      await Folio.updateOne({ reservation: s._id }, { $push: { lines: { type: 'charge', description: 'לינה', amount: base, taxAmount: 0, department: 'rooms', serviceDate: addDays(past, -1), source: 'night_audit', status: 'posted', reference: `night:x:${s._id}` } } });
      return s;
    };
    const c1 = await mkDeparted(pl10); const c2 = await mkDeparted(pl8); const c3 = await mkDeparted(pl8, { commissionPct: 12 }); const c4 = await mkDeparted(noPlan);
    const c5 = await mkStay({ arrival: addDays(past, -2), departure: past, plan: pl10, status: 'checked_out' });
    await Folio.updateOne({ reservation: c5._id }, { $push: { lines: { type: 'charge', description: 'לינה', amount: 1000, taxAmount: 0, department: 'rooms', serviceDate: past, source: 'night_audit', status: 'posted' } } });
    // c1 still owes money → its commission waits for the debtor.
    await Folio.updateOne({ reservation: c1._id }, { $push: { lines: { type: 'charge', description: 'מיני־בר', amount: 100, taxAmount: 0, department: 'minibar', serviceDate: past, source: 'manual', status: 'posted' } } });
    r = await call('POST', '/commissions/process', R, {});
    check('PK29 receptionist cannot process commissions', r.status === 403, r.status);
    r = await call('POST', '/commissions/process', G, {});
    check('PK30 processing: records for the 3 qualifying departures (no agent / non-qualifying plan = none)', r.success && r.data.created === 3, r);
    let lst = await call('GET', `/commissions?status=open`, F);
    const rec = (x) => lst.data.rows.find((y) => y.reservation === String(x._id));
    check('PK31 percent sources: agent default 10% → 100, plan 8% → 80, reservation 12% → 120', rec(c1)?.amount === 100 && rec(c1).source === 'agent' && rec(c2)?.amount === 80 && rec(c2).source === 'plan' && rec(c3)?.amount === 120 && rec(c3).source === 'reservation', lst.data.rows.map((x) => [x.pct, x.source, x.amount]));
    r = await call('POST', '/commissions/process', G, {});
    check('PK32 processing again creates nothing', r.success && r.data.created === 0, r);
    check('PK33 a plan that does not qualify gets no record', !rec(c4), 'c4 listed');
    r = await call('POST', '/commissions/hold', G, { id: rec(c1).id, kind: 'until_paid', note: 'ממתין לתשלום' });
    check('PK34 hold "until the debtor pays"', r.success && r.data.held === 1, r);
    r = await call('POST', '/commissions/process', G, {});
    check('PK35 still owing → stays held', r.success && r.data.released === 0, r);
    await Folio.updateOne({ reservation: c1._id }, { $push: { lines: { type: 'payment', description: 'תשלום', amount: -1100, taxAmount: 0, department: 'cash', serviceDate: past, source: 'manual', status: 'posted' } } });
    r = await call('POST', '/commissions/process', G, {});
    lst = await call('GET', `/commissions?status=ready`, F);
    check('PK36 debtor paid → released to ready', r.success && r.data.released === 1 && rec(c1)?.status === 'ready', r);
    r = await call('PATCH', `/commissions/${rec(c2).id}`, G, { amount: 75 });
    check('PK37 manual change without a note refused', r.status === 422 && r.fields?.note, r);
    r = await call('PATCH', `/commissions/${rec(c2).id}`, G, { amount: 75, note: 'הסכם מיוחד' });
    check('PK38 manual change with a note keeps the calculated amount and who changed it', r.success && r.data.amount === 75 && r.data.calculated === 80 && r.data.edited?.from === 80, r);
    r = await call('POST', '/commissions/manual', G, { reservation: String(c4._id), agent: String(agent._id), amount: 55, note: 'שכחו לחבר סוכן' });
    check('PK39 manual record enters held for review', r.success && r.data.status === 'held' && r.data.hold?.kind === 'review', r);
    const manualId = r.data.id;
    r = await call('POST', '/commissions/hold', G, { id: manualId, kind: 'offset', note: 'קוזזה' });
    r = await call('POST', '/commissions/release', G, { id: manualId });
    check('PK40 an offset ("already deducted") commission is not released to payment', r.status === 409, r.status);
    r = await call('POST', '/commissions/hold', G, { id: manualId, kind: 'review', note: 'לבדיקה' });
    r = await call('POST', '/commissions/release', G, { id: manualId });
    check('PK41 a held-for-review record is released', r.success && r.data.released === 1, r);
    r = await call('GET', `/commissions/pre-payment?from=${addDays(past, -10)}&to=${today}`, F);
    check('PK42 pre-payment report: payable 100 + 75 + 120 + 55 = 350', r.success && r.data.payable === 350 && r.data.agents.length === 1, r.data);
    r = await call('POST', '/commissions/hold', G, { id: manualId, kind: 'review', note: 'עוד בדיקה' });
    r = await call('POST', '/commissions/pay', R, { method: 'cheque', startNumber: 5000, from: addDays(past, -10), to: today });
    check('PK43 receptionist cannot pay commissions', r.status === 403, r.status);
    r = await call('POST', '/commissions/pay', G, { method: 'cheque', from: addDays(past, -10), to: today });
    check('PK44 cheque payment needs a starting number', r.status === 422 && r.fields?.startNumber, r);
    r = await call('POST', '/commissions/pay', G, { method: 'cheque', startNumber: 5000, from: addDays(past, -10), to: today });
    const pay1 = r.data?.payments?.[0];
    check('PK45 payment: one cheque to the agent for the ready records only (295), the held one waits', r.success && r.data.payments.length === 1 && pay1.amount === 295 && pay1.number === '5000' && pay1.count === 3, r);
    r = await call('POST', '/commissions/pay', G, { method: 'cheque', startNumber: 5000, from: addDays(past, -10), to: today });
    check('PK46 nothing ready left → refused (no double payment)', r.status === 409, r.status);
    r = await call('POST', `/commissions/payments/${pay1.id}/status`, G, { status: 'cleared' });
    check('PK47 cheque cleared', r.success && r.data.status === 'cleared', r);
    r = await call('POST', `/commissions/payments/${pay1.id}/status`, G, { status: 'voided', note: 'x' });
    check('PK48 a cleared cheque cannot be voided directly', r.status === 409, r.status);
    r = await call('POST', `/commissions/payments/${pay1.id}/status`, G, { status: 'issued' });
    check('PK49 cleared → back to issued', r.success && r.data.status === 'issued', r);
    r = await call('POST', '/commissions/detach', G, { reservation: String(c1._id), reason: 'הזמנה ישירה' });
    check('PK50 a paid commission cannot be detached from its agent', r.status === 409, r.status);
    r = await call('POST', `/commissions/payments/${pay1.id}/status`, G, { status: 'voided' });
    check('PK51 voiding needs a reason', r.status === 422, r.status);
    r = await call('POST', `/commissions/payments/${pay1.id}/status`, G, { status: 'voided', note: 'שיק אבד' });
    lst = await call('GET', `/commissions?status=ready`, F);
    check('PK52 voided: its records go back to processing (3 ready again)', r.success && r.data.status === 'voided' && lst.data.rows.length === 3, [r.status, lst.data?.rows?.length]);
    r = await call('POST', `/commissions/payments/${pay1.id}/status`, G, { status: 'issued' });
    check('PK53 a void cannot be undone', r.status === 409, r.status);
    r = await call('POST', '/commissions/detach', G, { reservation: String(c2._id), reason: 'הוזמן ישירות' });
    lst = await call('GET', `/commissions?status=cancelled`, F);
    const resAfter = await Reservation.findById(c2._id).lean();
    check('PK54 detach: the reservation leaves the agent and its unpaid record is cancelled', r.success && !resAfter.travelAgent && lst.data.rows.length === 1, [r.status, lst.data?.rows?.length]);
    r = await call('POST', '/commissions/pay', G, { method: 'transfer', reference: 'TR-77', from: addDays(past, -10), to: today });
    check('PK55 transfer payment with a reference', r.success && r.data.payments[0].number === 'TR-77' && r.data.total === 220, r);
    r = await call('GET', `/commissions/report?kind=paid&from=${addDays(past, -10)}&to=${today}`, F);
    check('PK56 report of transferred commissions', r.success && r.data.rows.length === 2 && r.data.total === 220, r.data);
    r = await call('GET', `/commissions/payments?q=TR-77`, F);
    check('PK57 payment search by number', r.success && r.data.length === 1, r.data);

    // ── Audit ──
    const acts = await AuditLog.distinct('action', { property: P, action: /^(package|commission)\./ });
    check('PK58 audited: components, links, process, hold, edit, manual, pay, status, detach', ['package.component_create', 'package.plan_links', 'package.reservation_add', 'commission.process', 'commission.hold', 'commission.edit', 'commission.manual', 'commission.pay', 'commission.payment_status', 'commission.detach'].every((a) => acts.includes(a)), acts);
  } finally {
    await Promise.all([Room, RoomType, User, GuestProfile, Reservation, AuditLog, RatePlan, Folio, ReservationRoom, Company, ChargeCode, PackageComponent, PackageUsage, CommissionRecord, CommissionPayment].map((m) => m.deleteMany({ property: P }).catch(() => null)));
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
