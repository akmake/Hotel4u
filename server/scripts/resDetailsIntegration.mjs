#!/usr/bin/env node
/* eslint-disable no-console */
// Reservation details (gap-map item 14): options, composition / people / agent / flight / late check-out /
// special services / VIP reason / cashier note / hidden price / fixed rate, a rate for part of the nights,
// the phone summary (language, hidden price, foreign currency), fixed rate on extension, roles and audit.
// Live PMS server + same DB, on a throw-away property removed at the end.
//   node scripts/resDetailsIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import AuditLog from '../models/AuditLog.js';
import Company from '../models/Company.js';
import Folio from '../models/Folio.js';
import InventoryDate from '../models/InventoryDate.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `RDT${Date.now().toString(36).toUpperCase()}`;
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
  const other = await Property.create({ name: `זר ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: `${TAG}X`, reservationSequence: 0 });
  try {
    const rt = await RoomType.create({ property: P, code: `${TAG}S`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3, adultsMax: 3 });
    const bar = await RatePlan.create({ property: P, code: 'BAR', name: 'מחיר מלא', type: 'public' });
    const promo = await RatePlan.create({ property: P, code: 'PROMO', name: 'מבצע', type: 'promo' });
    for (let i = 0; i < 12; i += 1) {
      await RateDate.create({ ratePlan: promo._id, roomType: rt._id, date: addDays(today, i), price: 300 });
      await InventoryDate.create({ property: P, roomType: rt._id, date: addDays(today, i), physicalCount: 5 });
    }
    const mk = (role, prop = P) => User.create({ property: prop, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}-${String(prop).slice(-4)}@test.local`, passwordHash: 'x', role, active: true });
    const gm = await mk('general_manager'); const rcp = await mk('receptionist'); const stranger = await mk('receptionist', other._id);
    const G = tok(gm); const R = tok(rcp); const H = tok(await mk('housekeeper'));
    const agent = await Company.create({ property: P, name: 'סוכן', type: 'agency', commissionPct: 10 });
    const corp = await Company.create({ property: P, name: 'חברה', type: 'corporate' });
    const guest = await GuestProfile.create({ property: P, firstName: 'Dana', lastName: TAG });
    const res = await Reservation.create({ property: P, confirmationNumber: `${TAG}-1`, status: 'confirmed', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, 3), departureDate: addDays(today, 6), nights: 3, roomsCount: 1, roomType: rt._id, ratePlan: bar._id, ratePerNight: 500, totalAmount: 1500, guaranteeType: 'credit_card', priceSnapshot: { ratePlanCode: 'BAR', nightly: [0, 1, 2].map((i) => ({ date: addDays(today, 3 + i), price: 500 })), total: 1500 } });

    let r = await call('GET', '/res-details/options', R);
    check('RD1 options: staff, agents, companies, services, rate plans', r.success && r.data.users.length >= 2 && r.data.agents.length === 1 && r.data.companies.length === 2 && r.data.services.length > 3 && r.data.ratePlans.length === 2, r.data && Object.keys(r.data));
    r = await call('PATCH', `/res-details/${res._id}`, H, { teens: 1 });
    check('RD2 housekeeper cannot edit reservation details', r.status === 403, r.status);
    r = await call('PATCH', `/res-details/${res._id}`, R, { coordinator: String(stranger._id), travelAgent: String(corp._id), flight: { arrivalTime: '25:00' }, specialServices: ['nope'], isVip: true });
    check('RD3 validation: staff of another property, non-agent as agent, bad time, unknown service, VIP without reason', r.status === 422 && ['coordinator', 'travelAgent', 'flight', 'specialServices', 'vipReason'].every((k) => r.fields?.[k]), r.fields);
    r = await call('PATCH', `/res-details/${res._id}`, R, { teens: 1, infants: 1, coordinator: String(rcp._id), salesperson: String(gm._id), travelAgent: String(agent._id), flight: { arrivalNo: 'ly005', arrivalTime: '14:30' }, lateCheckout: '14:00', specialServices: ['cot', 'flowers'], isVip: true, vipReason: 'עיתונאית', cashierNote: 'לגבות פיקדון לפני מסירת מפתח' });
    const d = r.data;
    check('RD4 details saved: composition, people, agent, flight (upper-case), late check-out, services, VIP with reason', r.success && d.teens === 1 && d.infants === 1 && d.coordinator?.name && d.travelAgent?.name === 'סוכן' && d.flight.arrivalNo === 'LY005' && d.lateCheckout?.time === '14:00' && d.specialServices.length === 2 && d.isVip && d.vipReason === 'עיתונאית', r);
    const raw = await Reservation.findById(res._id).lean();
    check('RD5 late check-out moves the expected departure; flight landing fills the ETA', raw.etd === '14:00' && raw.eta === '14:30', [raw.etd, raw.eta]);
    r = await call('PATCH', `/res-details/${res._id}`, R, { fixedRate: true });
    check('RD6 receptionist cannot set a fixed rate', r.status === 422 && r.fields?.fixedRate, r.status);

    // Rate for part of the nights.
    r = await call('POST', `/res-details/${res._id}/split-rate`, R, { from: addDays(today, 4), to: addDays(today, 5), ratePlanId: String(promo._id), reason: 'מבצע לילה שני' });
    check('RD7 receptionist cannot re-price nights', r.status === 403, r.status);
    r = await call('POST', `/res-details/${res._id}/split-rate`, G, { from: addDays(today, 10), to: addDays(today, 11), ratePlanId: String(promo._id), reason: 'בדיקה' });
    check('RD8 nights outside the stay are refused', r.status === 422 && r.fields?.from, r.status);
    r = await call('POST', `/res-details/${res._id}/split-rate`, G, { from: addDays(today, 4), to: addDays(today, 5), ratePlanId: String(promo._id), reason: 'מבצע לילה שני' });
    const after = await Reservation.findById(res._id).lean();
    check('RD9 nights 2–3 on PROMO (300), night 1 stays BAR (500): total 1,100', r.success && after.totalAmount === 1100 && after.priceSnapshot.nightly[0].price === 500 && after.priceSnapshot.nightly[1].planCode === 'PROMO' && after.priceSnapshot.nightly[2].price === 300, after.priceSnapshot.nightly);

    // Phone summary.
    r = await call('GET', `/res-details/${res._id}/summary`, R);
    check('RD10 summary in Hebrew with the confirmation number, services and price', r.success && r.data.language === 'he' && r.data.text.includes(`${TAG}-1`) && r.data.text.includes('מיטת תינוק') && r.data.text.includes('1,100'), r.data?.text);
    await call('PATCH', `/res-details/${res._id}`, R, { hidePrice: true });
    await Reservation.updateOne({ _id: res._id }, { $set: { language: 'en' } });
    r = await call('GET', `/res-details/${res._id}/summary`, R);
    check('RD11 hidden price + guest language English: no price line, English text', r.success && r.data.language === 'en' && r.data.text.includes('Confirmation number') && !r.data.text.includes('1,100') && !r.data.text.includes('Total price'), r.data?.text);

    // Fixed rate on an extension.
    const room = await Room.create({ property: P, roomType: rt._id, number: `${TAG.slice(-3)}1`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'occupied' });
    const ih = await Reservation.create({ property: P, confirmationNumber: `${TAG}-2`, status: 'in_house', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, -1), departureDate: addDays(today, 1), nights: 2, roomsCount: 1, roomType: rt._id, ratePlan: promo._id, ratePerNight: 450, totalAmount: 900, assignedRoom: room._id, checkedInAt: new Date(), guaranteeType: 'credit_card', priceSnapshot: { ratePlanCode: 'PROMO', nightly: [{ date: addDays(today, -1), price: 450 }, { date: today, price: 450 }], total: 900 } });
    await ReservationRoom.create({ reservation: ih._id, property: P, roomTypeBooked: rt._id, assignedRoom: room._id, arrivalDate: ih.arrivalDate, departureDate: ih.departureDate, nightlyRate: 450, status: 'in_house' });
    await Folio.create({ property: P, reservation: ih._id, ownerType: 'guest', lines: [] });
    r = await call('GET', `/stay/${ih._id}/extension?newDeparture=${addDays(today, 3)}`, G);
    check('RD12 extension without fixed rate: added nights at the calendar price (300)', r.success && r.data.nightly.every((n) => n.price === 300), r.data?.nightly || [r.status, r.error]);
    await call('PATCH', `/res-details/${ih._id}`, G, { fixedRate: true });
    r = await call('GET', `/stay/${ih._id}/extension?newDeparture=${addDays(today, 3)}`, G);
    check('RD13 fixed rate: added nights keep the first night (450)', r.success && r.data.nightly.length === 2 && r.data.nightly.every((n) => n.price === 450) && r.data.total === 900, r.data?.nightly || [r.status, r.error]);

    const acts = await AuditLog.distinct('action', { property: P, action: /^reservation\.(details|split_rate)/ });
    check('RD14 audited: details + split rate', acts.includes('reservation.details') && acts.includes('reservation.split_rate'), acts);
  } finally {
    await Promise.all([Room, RoomType, User, GuestProfile, Reservation, ReservationRoom, AuditLog, Company, Folio, InventoryDate, RatePlan].map((m) => m.deleteMany({ property: { $in: [P, other._id] } }).catch(() => null)));
    await RateDate.deleteMany({ roomType: { $exists: true }, date: { $gte: addDays(today, -2) }, ratePlan: { $in: (await RatePlan.find({ property: P }).select('_id').lean()).map((x) => x._id) } }).catch(() => null);
    await Property.deleteMany({ _id: { $in: [P, other._id] } });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
