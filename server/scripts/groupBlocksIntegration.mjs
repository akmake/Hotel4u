#!/usr/bin/env node
/* eslint-disable no-console */
// Group blocks suite (gap-map item 6): programme (schedule, meals, kitchen), money (billing profile,
// payments with proof, approval into the group's account), rooms (per-night grid, rooming list with
// shares, list status and check-in, series). Runs against a live PMS server + the same DB, on a
// throw-away property removed at the end.
//   node scripts/groupBlocksIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Folio from '../models/Folio.js';
import AuditLog from '../models/AuditLog.js';
import InventoryDate from '../models/InventoryDate.js';
import GroupBlock from '../models/GroupBlock.js';
import { EventSpace } from '../models/Event.js';
import { MealType, GroupProgramItem } from '../models/GroupProgram.js';
import { GroupPayment, GroupAttachment } from '../models/GroupMoney.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `GRB${Date.now().toString(36).toUpperCase()}`;
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG, discountApprovalPercent: 10 });
  const P = String(p._id);
  const groupIds = [];
  const planIds = [];
  try {
    const rt = await RoomType.create({ property: P, code: TAG, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    for (let i = 1; i <= 6; i += 1) await Room.create({ property: P, roomType: rt._id, number: `${i}0${i}`, floor: i <= 3 ? 1 : 2, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' });
    const plan = await RatePlan.create({ property: P, code: `${TAG}G`, name: 'קבוצות', type: 'group', active: true });
    planIds.push(plan._id);
    const rateDays = [];
    for (let i = -1; i < 70; i += 1) rateDays.push({ property: P, ratePlan: plan._id, roomType: rt._id, date: addDays(today, i), price: 500, stopSell: false });
    await RateDate.insertMany(rateDays, { ordered: false }).catch(() => null);
    const hall = await EventSpace.create({ property: P, name: `אולם ${TAG}`, capacity: 120 });
    const users = {};
    for (const role of ['front_desk_manager', 'receptionist', 'finance_manager']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const M = tok(users.front_desk_manager); const R = tok(users.receptionist); const F = tok(users.finance_manager);

    // ── Programme ──────────────────────────────────────────────────────────
    let r = await call('POST', '/group-blocks', M, { propertyId: P, name: 'יום עיון', stayType: 'day', arrivalDate: addDays(today, 10), departureDate: addDays(today, 11), pax: 80, minPax: 60, contactName: 'רחל', contactPhone: '0501234567' });
    const D = r.data?.id; if (D) groupIds.push(D);
    check('PRG a day seminar opens without rooms', r.status === 200 && r.data.stayType === 'day' && r.data.allotments.length === 0 && r.data.minPax === 60, `${r.status} ${r.error}`);
    const meals = (await call('GET', `/group-blocks/meal-types?propertyId=${P}`, R)).data || [];
    const lunch = meals.find((m) => m.name === 'ארוחת צהריים');
    const breakfast = meals.find((m) => m.name === 'ארוחת בוקר');
    const night = meals.find((m) => m.name === 'פינוקי לילה');
    check('PRG the meal catalog starts with the six meals', meals.length === 6 && lunch?.kosher.includes('meat') && !breakfast?.kosher.includes('meat'), JSON.stringify(meals.map((m) => m.name)));
    const d0 = addDays(today, 10); const d1 = addDays(today, 11);
    r = await call('POST', `/group-blocks/${D}/program`, R, { propertyId: P, date: d0, start: '08:00', end: '09:00', kind: 'meal', mealTypeId: breakfast.id, kosher: 'meat', spaceId: String(hall._id) });
    check('PRG a meat breakfast is refused (kashrut from the catalog)', r.status === 422 && r.fields?.kosher, `${r.status}`);
    r = await call('POST', `/group-blocks/${D}/program`, R, { propertyId: P, date: d0, start: '12:30', end: '13:30', kind: 'meal', mealTypeId: lunch.id, kosher: 'meat', menu: 'שניצל', location: 'חצר' });
    check('PRG a meal must be in a hall', r.status === 422 && r.fields?.spaceId, `${r.status}`);
    r = await call('POST', `/group-blocks/${D}/program`, R, { propertyId: P, date: d0, start: '12:30', end: '13:30', kind: 'meal', mealTypeId: lunch.id, kosher: 'meat', menu: 'שניצל', spaceId: String(hall._id), pricePerPax: 95, kitchenNotes: '5 צמחוניים' });
    check('PRG a lunch in the hall, 80 diners by default (the group)', r.status === 200 && r.data.item.pax === 80 && r.data.item.total === 7600 && r.data.warnings.length === 0, `${r.status} ${r.error}`);
    r = await call('POST', `/group-blocks/${D}/program`, R, { propertyId: P, date: d0, start: '13:00', end: '15:00', kind: 'activity', title: 'הרצאה', spaceId: String(hall._id) });
    check('PRG the hall busy at the same time: saved, with a warning', r.status === 200 && r.data.warnings.length === 1, JSON.stringify(r.data?.warnings));
    r = await call('POST', `/group-blocks/${D}/program`, R, { propertyId: P, date: d0, start: '16:00', end: '17:00', kind: 'activity', title: 'סיור', location: 'אוטובוס' });
    check('PRG an activity in a free location', r.status === 200 && r.data.item.location === 'אוטובוס' && !r.data.item.spaceId, `${r.status} ${r.error}`);
    r = await call('POST', `/group-blocks/${D}/program`, R, { propertyId: P, date: d1, start: '00:30', end: '01:30', kind: 'meal', mealTypeId: night.id, kosher: 'dairy', spaceId: String(hall._id), pax: 40 });
    check('PRG a meal at 00:30 belongs to the kitchen day before', r.status === 200 && r.data.item.kitchenDay === d0, r.data?.item?.kitchenDay);
    r = await call('POST', `/group-blocks/${D}/program/duplicate-day`, R, { propertyId: P, from: d0, to: d0 });
    check('PRG a day is not copied onto itself', r.status === 422, r.status);
    r = await call('POST', `/group-blocks/${D}/program/duplicate-day`, R, { propertyId: P, from: d0, to: d1 });
    check('PRG copying the first day to the second copies its 3 items', r.status === 200 && r.data.copied === 3, `${r.status} ${r.error}`);
    r = await call('GET', `/group-blocks/kitchen?propertyId=${P}&from=${d0}&days=7`, R);
    check('PRG kitchen week: 3 meals, 200 diners, the night meal at the end of its day', r.status === 200 && r.data.totals.meals === 3 && r.data.totals.diners === 200 && r.data.days[0].meals.at(-1)?.night === true, JSON.stringify(r.data?.totals));
    r = await call('POST', `/group-blocks/${D}/move`, M, { propertyId: P, arrivalDate: addDays(today, 17), departureDate: addDays(today, 18), dryRun: true });
    check('PRG move preview: same length, the 7 items move with it', r.status === 200 && r.data.programMoves && r.data.programItems === 7 && r.data.delta === 7, JSON.stringify(r.data));
    r = await call('POST', `/group-blocks/${D}/move`, M, { propertyId: P, arrivalDate: addDays(today, 17), departureDate: addDays(today, 18) });
    const moved = await GroupProgramItem.find({ group: D }).lean();
    check('PRG moving the group moves every item by 7 days (and its kitchen day)', r.status === 200 && moved.length === 7 && moved.every((i) => i.date >= addDays(today, 17)) && moved.some((i) => i.start === '00:30' && i.kitchenDay === addDays(today, 17)), `${r.status} ${r.error}`);

    // ── Money ──────────────────────────────────────────────────────────────
    r = await call('GET', `/group-blocks/${D}/billing/suggest?propertyId=${P}`, R);
    check('MNY suggestion from the programme: priced meals × diners', r.status === 200 && r.data.lines.some((l) => l.category === 'meals' && l.amount === 15200), JSON.stringify(r.data?.lines));
    const bill = { propertyId: P, lines: [{ category: 'meals', amount: 15200 }, { category: 'activities', description: 'אולם והגברה', amount: 3000 }], discount: { kind: 'percent', value: 15, reason: 'negotiated' }, terms: 'net30' };
    r = await call('PUT', `/group-blocks/${D}/billing`, R, bill);
    check('MNY a 15% discount by a receptionist needs a manager', r.status === 403 && r.code === 'discount_needs_approval', `${r.status}`);
    r = await call('PUT', `/group-blocks/${D}/billing`, M, { ...bill, discount: { ...bill.discount, value: 5 } });
    check('MNY billing 18,200 − 5% = 17,290 incl. VAT; due date = departure + 30', r.status === 200 && r.data.billing.totals.total === 17290 && r.data.billing.dueDate === addDays(addDays(today, 18), 30) && r.data.summary.state === 'unpaid', JSON.stringify(r.data?.billing?.totals));
    r = await call('POST', `/group-blocks/${D}/payments`, R, { propertyId: P, method: 'bank_transfer', amount: 5000, details: { reference: '', payDate: today } });
    check('MNY a transfer needs its reference (same rules as a folio payment)', r.status === 422, `${r.status}`);
    r = await call('POST', `/group-blocks/${D}/payments`, R, { propertyId: P, method: 'bank_transfer', amount: 5000, details: { reference: '778899', payDate: today, payerName: 'משרד' } });
    const pay1 = r.data?.id;
    check('MNY a transfer is recorded as pending', r.status === 200 && r.data.status === 'pending', `${r.status} ${r.error}`);
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('%PDF-1.4\n% transfer confirmation\n')], { type: 'application/pdf' }), 'transfer.pdf');
    const up = await fetch(`${BASE}/group-blocks/${D}/payments/${pay1}/attachments?propertyId=${P}`, { method: 'POST', headers: { Authorization: `Bearer ${R}` }, body: form }).then((x) => x.json());
    const att = up.data?.id;
    const withTok = await fetch(`${BASE}/group-blocks/${D}/attachments/${att}?propertyId=${P}`, { headers: { Authorization: `Bearer ${R}` } });
    const noTok = await fetch(`${BASE}/group-blocks/${D}/attachments/${att}?propertyId=${P}`);
    check('MNY the proof is stored and served only with a login', up.success && withTok.status === 200 && /pdf/.test(withTok.headers.get('content-type') || '') && noTok.status === 401, `${up.error || ''} ${withTok.status} ${noTok.status}`);
    r = await call('POST', `/group-blocks/${D}/payments/${pay1}/approve`, R, { propertyId: P });
    check('MNY a receptionist cannot approve a payment', r.status === 403, r.status);
    r = await call('POST', `/group-blocks/${D}/payments/${pay1}/approve`, F, { propertyId: P });
    const acct = r.data?.account ? await Folio.findById(r.data.account.id).lean() : null;
    check('MNY finance approves → the group account is opened and the 5,000 posted in advance', r.status === 200 && acct?.account?.outlet === 'groups' && String(acct.account.groupBlock) === D && acct.lines.some((l) => l.type === 'deposit' && l.amount === -5000 && l.method === 'bank_transfer') && r.data.summary.state === 'partial' && r.data.summary.progress === 29, `${r.status} ${r.error} ${JSON.stringify(r.data?.summary)}`);
    r = await call('POST', `/group-blocks/${D}/payments/${pay1}/approve`, F, { propertyId: P });
    check('MNY an approved payment is not approved twice', r.status === 409, r.status);
    r = await call('POST', `/group-blocks/${D}/payments`, R, { propertyId: P, method: 'cheque', amount: 20000, details: { number: '100234', bank: '12', branch: '345', account: '678901', dueDate: addDays(today, 10) } });
    const pay2 = r.data?.id;
    r = await call('POST', `/group-blocks/${D}/payments/${pay2}/approve`, F, { propertyId: P });
    check('MNY an advance above what is left to pay is refused', r.status === 422 && /מקדמה עד/.test(r.error || ''), `${r.status} ${r.error}`);
    r = await call('POST', `/group-blocks/${D}/payments/${pay2}/reject`, F, { propertyId: P });
    check('MNY rejecting needs a reason', r.status === 422, r.status);
    r = await call('POST', `/group-blocks/${D}/payments/${pay2}/reject`, F, { propertyId: P, reason: 'שיק ללא כיסוי' });
    check('MNY rejected with a reason — nothing posted', r.status === 200 && r.data.payments.find((x) => x.id === pay2)?.status === 'rejected' && r.data.summary.approved === 5000, `${r.status}`);

    // ── Rooms: grid, rooming list, shares, status, check-in ────────────────
    r = await call('POST', '/group-blocks', M, { propertyId: P, name: 'טיול', arrivalDate: today, departureDate: addDays(today, 3), pax: 7, contactName: 'מדריך', contactPhone: '0509999999', ratePlanId: String(plan._id), allotments: [{ roomTypeId: String(rt._id), blocked: 3, negotiatedRate: 400 }] });
    const G = r.data?.id; if (G) groupIds.push(G);
    check('ROM a lodging group holds 3 rooms', r.status === 200 && r.data.totals.blocked === 3, `${r.status} ${r.error}`);
    r = await call('PUT', `/group-blocks/${G}/grid`, M, { propertyId: P, roomTypeId: String(rt._id), nights: { [today]: 3, [addDays(today, 1)]: 3, [addDays(today, 2)]: 2 } });
    const held = await InventoryDate.find({ property: P, roomType: rt._id, date: { $in: [today, addDays(today, 2)] } }).lean();
    check('ROM per-night grid 3 · 3 · 2: the hold follows it night by night', r.status === 200 && r.data.allotments[0].varies && held.find((x) => x.date === today)?.groupAllotmentCount === 3 && held.find((x) => x.date === addDays(today, 2))?.groupAllotmentCount === 2, `${r.status} ${r.error} ${JSON.stringify(held.map((x) => [x.date, x.groupAllotmentCount]))}`);
    r = await call('PUT', `/group-blocks/${G}/grid`, M, { propertyId: P, roomTypeId: String(rt._id), nights: { [today]: 9 } });
    check('ROM a night asking for more rooms than are free is refused', r.status === 409 && r.code === 'not_enough_rooms', `${r.status} ${r.error}`);
    r = await call('PUT', `/group-blocks/${G}/rooming-list`, R, { propertyId: P, entries: [
      { guestName: 'משה כהן', roomTypeName: 'סטנדרט', adults: 2 },
      { guestName: 'רבקה כהן', share: true },
      { guestName: 'דוד לוי', roomTypeId: String(rt._id), adults: 2 },
      { guestName: 'שרה מזרחי', roomTypeId: String(rt._id), departureDate: addDays(today, 2), adults: 1 },
    ] });
    check('ROM the rooming list keeps the share and matches the room type by name', r.status === 200 && r.data.roomingList[1].share && r.data.roomingList[0].roomTypeId === String(rt._id), `${r.status} ${r.error}`);
    r = await call('POST', `/group-blocks/${G}/rooming-book`, R, { propertyId: P });
    const share = r.data && await Reservation.findOne({ property: P, 'shares.0': { $exists: true } }).lean();
    check('ROM booking the whole list: 3 bookings + the share in the room above', r.status === 200 && r.data.done.length === 4 && r.data.failed.length === 0 && share?.shares?.[0]?.name?.includes('רבקה'), `${r.status} ${r.error} ${JSON.stringify(r.data?.failed)}`);
    r = await call('POST', `/group-blocks/${G}/pickup`, R, { propertyId: P, roomTypeId: String(rt._id), arrival: addDays(today, 1), departure: addDays(today, 3), newGuest: { firstName: 'נוסף', lastName: TAG, phone: '0501111111' }, idempotencyKey: `${TAG}-extra` });
    check('ROM no room left on the full nights → refused, names the nights', r.status === 409 && r.code === 'block_full', `${r.status} ${r.error}`);
    const first = await Reservation.findOne({ property: P, group: G }).sort({ createdAt: 1 }).lean();
    r = await call('POST', `/frontdesk/reservations/${first._id}/check-in`, R, { propertyId: P });
    check('ROM a guest of the group is not checked in before the list is final', r.status === 409 && r.code === 'rooming_not_final', `${r.status} ${r.error}`);
    r = await call('POST', `/group-blocks/${G}/check-in`, R, { propertyId: P });
    check('ROM group check-in before final is refused', r.status === 409, r.status);
    r = await call('POST', `/group-blocks/${G}/rooming-status`, R, { propertyId: P, status: 'final' });
    check('ROM the list is marked final', r.status === 200 && r.data.roomingStatus === 'final', `${r.status} ${r.error}`);
    r = await call('PUT', `/group-blocks/${G}/rooming-list`, R, { propertyId: P, entries: [] });
    check('ROM a final list is not edited in the group', r.status === 409 && r.code === 'rooming_final', r.status);
    r = await call('POST', `/group-blocks/${G}/rooming-status`, R, { propertyId: P, status: 'preliminary' });
    check('ROM only a manager returns a final list to preliminary', r.status === 403, r.status);
    r = await call('POST', `/group-blocks/${G}/assign-rooms`, R, { propertyId: P });
    const roomsNow = await Reservation.find({ property: P, group: G, status: { $nin: ['cancelled'] } }).select('assignedRoom').lean();
    check('ROM group room assignment: every booking has a room', r.status === 200 && roomsNow.every((x) => x.assignedRoom), `${r.status} ${r.error} ${JSON.stringify(r.data?.failed)}`);
    r = await call('POST', `/group-blocks/${G}/check-in`, M, { propertyId: P });
    const inHouse = await Reservation.countDocuments({ property: P, group: G, status: { $in: ['in_house', 'checked_in'] } });
    check('ROM group check-in: every booking arriving today with a ready room goes in (or is reported with its reason)', r.status === 200 && r.data.done.length + r.data.failed.length === 3 && inHouse === r.data.done.length, `${r.status} ${r.error} done=${r.data?.done?.length} failed=${JSON.stringify(r.data?.failed)}`);

    // ── Copy / series ──────────────────────────────────────────────────────
    r = await call('POST', `/group-blocks/${G}/copy`, M, { propertyId: P, arrivalDates: [addDays(today, 30), addDays(today, 37)], asSeries: true, withRoster: true, withBilling: true });
    const copies = r.data?.created || [];
    copies.forEach((c) => groupIds.push(c.id));
    const c1 = copies[0] ? await GroupBlock.findById(copies[0].id).lean() : null;
    check('SER two copies, tentative, linked to the master, grid moved with the dates, list without bookings', r.status === 200 && copies.length === 2 && c1?.status === 'tentative' && String(c1.seriesOf) === G && c1.allotments[0].nightly?.[0]?.date === addDays(today, 32) && c1.roomingList.length === 4 && c1.roomingList.every((x) => !x.reservationId) && c1.roomingStatus === 'none', `${r.status} ${r.error}`);
    r = await call('GET', `/group-blocks/${G}?propertyId=${P}`, R);
    check('SER the group shows its series (master + 2)', r.status === 200 && r.data.series.length === 3 && r.data.series.find((x) => x.master)?.id === G, JSON.stringify(r.data?.series?.map((x) => x.groupCode)));
    r = await call('POST', `/group-blocks/${G}/move`, M, { propertyId: P, arrivalDate: addDays(today, 40), departureDate: addDays(today, 43) });
    check('SER a group with live bookings does not move (copy it instead)', r.status === 409 && r.code === 'has_reservations', `${r.status}`);
  } finally {
    const resIds = (await Reservation.find({ property: p._id }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: p._id }, { entityId: { $in: [...resIds, ...groupIds.map((x) => new mongoose.Types.ObjectId(x))] } }] });
    await Folio.collection.deleteMany({ property: p._id });
    await ReservationRoom.deleteMany({ property: p._id });
    await Reservation.deleteMany({ property: p._id });
    await InventoryDate.deleteMany({ property: p._id });
    await RateDate.deleteMany({ ratePlan: { $in: planIds } });
    await GroupProgramItem.deleteMany({ property: p._id });
    await MealType.deleteMany({ property: p._id });
    await GroupPayment.deleteMany({ property: p._id });
    await GroupAttachment.deleteMany({ property: p._id });
    await GroupBlock.deleteMany({ property: p._id });
    await EventSpace.deleteMany({ property: p._id });
    await GuestProfile.deleteMany({ property: p._id });
    await Room.deleteMany({ property: p._id });
    await RoomType.deleteMany({ property: p._id });
    await RatePlan.deleteMany({ property: p._id });
    await User.deleteMany({ property: p._id });
    await Property.deleteMany({ _id: p._id });
    await mongoose.disconnect();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
