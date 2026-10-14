#!/usr/bin/env node
/* eslint-disable no-console */
// Booking integration suite (W01: INV-03 availability & price, RSV-02 create, RSV-04 quote,
// RSV-01 list, RSV-03 stay file). Runs against a live PMS server and the same DB, on a throw-away
// property with its own rate calendar and inventory; everything is removed at the end.
//
//   node scripts/bookingIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';
import AuditLog from '../models/AuditLog.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || 'hotel4u_dev_secret_change_in_prod';
const TAG = `BKG${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const key = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG, reservationSequence: 0, defaultCancellationHours: 48 });
  const P = String(p._id);
  try {
    const rt = await RoomType.create({ property: P, code: `${TAG}S`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3, adultsMax: 3 });
    for (let i = 1; i <= 2; i += 1) await Room.create({ property: P, roomType: rt._id, number: `${i}01`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' });
    const bar = await RatePlan.create({ property: P, code: 'BAR', name: 'Best Available', type: 'public', isRefundable: true });
    const nr = await RatePlan.create({ property: P, code: 'NR', name: 'Non-Refundable', type: 'public', isRefundable: false });
    const days = Array.from({ length: 30 }, (_, i) => addDays(today, i));
    await InventoryDate.insertMany(days.map((date) => ({ property: P, roomType: rt._id, date, physicalCount: 2 })));
    await RateDate.insertMany(days.flatMap((date, i) => [
      { ratePlan: bar._id, roomType: rt._id, date, price: i === 3 ? 600 : 500, cta: i === 10, minLos: i === 12 ? 3 : 1 },
      ...(i === 6 ? [] : [{ ratePlan: nr._id, roomType: rt._id, date, price: 450 }]),
    ]));
    const users = {};
    for (const role of ['property_admin', 'receptionist', 'housekeeper', 'housekeeping_manager']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const M = tok(users.property_admin); const R = tok(users.receptionist); const H = tok(users.housekeeper); const HM = tok(users.housekeeping_manager);
    const existing = await GuestProfile.create({ property: P, firstName: 'דנה', lastName: 'קיימת', email: `dana-${TAG.toLowerCase()}@example.com`, phone: '0501234567' });
    const qs = (o) => new URLSearchParams({ propertyId: P, ...o }).toString();
    const booked = async (date) => (await InventoryDate.findOne({ property: P, roomType: rt._id, date }).lean()).bookedCount;

    // ── INV-03 ──────────────────────────────────────────────────────────────
    let r = await call('GET', `/booking/availability?${qs({ arrival: addDays(today, 2), departure: addDays(today, 5), adults: 2, rooms: 1 })}`, R);
    const offBar = r.data?.offers?.find((o) => o.ratePlan.code === 'BAR');
    check('INV-03 price per night (not an average): 500 + 600 + 500 = 1600', r.status === 200 && offBar?.nightly.map((n) => n.price).join(',') === '500,600,500' && offBar.total === 1600 && offBar.bookable, JSON.stringify(offBar?.nightly || r).slice(0, 160));
    check('INV-03 availability is reported per night', offBar?.availability.length === 3 && offBar.availability.every((a) => a.available === 2));
    r = await call('GET', `/booking/availability?${qs({ arrival: addDays(today, 5), departure: addDays(today, 8), adults: 2, rooms: 1 })}`, R);
    const offNr = r.data?.offers?.find((o) => o.ratePlan.code === 'NR');
    check('INV-03 a night without a rate is not sellable (no silent fallback)', offNr && !offNr.bookable && offNr.reasons.some((x) => x.code === 'missing_rate'), JSON.stringify(offNr?.reasons));
    r = await call('GET', `/booking/availability?${qs({ arrival: addDays(today, 10), departure: addDays(today, 12), adults: 2 })}`, R);
    check('INV-03 closed-to-arrival blocks the offer', r.data?.offers?.find((o) => o.ratePlan.code === 'BAR')?.reasons.some((x) => x.code === 'cta'));
    r = await call('GET', `/booking/availability?${qs({ arrival: addDays(today, 12), departure: addDays(today, 14), adults: 2 })}`, R);
    check('INV-03 minimum stay is enforced', r.data?.offers?.find((o) => o.ratePlan.code === 'BAR')?.reasons.some((x) => x.code === 'min_los'));
    r = await call('GET', `/booking/availability?${qs({ arrival: addDays(today, 2), departure: addDays(today, 3), adults: 4, rooms: 1 })}`, R);
    check('INV-03 room capacity is enforced', r.data?.offers?.every((o) => o.reasons.some((x) => x.code === 'capacity')));
    r = await call('GET', `/booking/availability?${qs({ arrival: addDays(today, -1), departure: addDays(today, 1), adults: 2 })}`, R);
    check('INV-03 a past arrival date is refused', r.status === 422 && r.fields?.arrival, r.status);
    r = await call('POST', '/booking/reservations', H, { propertyId: P, mode: 'confirm', idempotencyKey: key() });
    check('RBAC: housekeeper cannot create a booking', r.status === 403, r.status);

    // ── RSV-02 confirm ──────────────────────────────────────────────────────
    const stay = { arrival: addDays(today, 2), departure: addDays(today, 5), adults: 2, children: 0, rooms: 1, roomTypeId: String(rt._id), ratePlanId: String(bar._id) };
    const k1 = key();
    const before2 = await booked(addDays(today, 2));
    r = await call('POST', '/booking/reservations', R, { propertyId: P, ...stay, mode: 'confirm', priceSignature: offBar.priceSignature, ratePerNight: 1, newGuest: { firstName: 'יוסי', lastName: 'בדיקה', phone: '0529999999' }, idempotencyKey: k1 });
    const res1 = await Reservation.findById(r.data?.id).lean();
    check('RSV-02 booking confirmed at the server price (client price ignored), snapshot frozen', r.status === 200 && res1?.status === 'confirmed' && res1.totalAmount === 1600 && res1.priceSnapshot?.nightly?.length === 3 && res1.priceSnapshot.ratePlanCode === 'BAR', JSON.stringify(r).slice(0, 200));
    check('RSV-02 terms snapshot and confirmation number from the property sequence', res1?.cancellationPolicy?.includes('48') && res1?.confirmationNumber === `${TAG}-1`, `${res1?.cancellationPolicy} ${res1?.confirmationNumber}`);
    check('RSV-02 inventory taken for each night', (await booked(addDays(today, 2))) === before2 + 1 && (await booked(addDays(today, 4))) === 1);
    const r1b = await call('POST', '/booking/reservations', R, { propertyId: P, ...stay, mode: 'confirm', priceSignature: offBar.priceSignature, newGuest: { firstName: 'יוסי', lastName: 'בדיקה', phone: '0529999999' }, idempotencyKey: k1 });
    check('RSV-02 retry with the same key creates nothing new', r1b.status === 200 && r1b.data.duplicate === true && (await Reservation.countDocuments({ property: P, idempotencyKey: k1 })) === 1);

    // T02: the price changed after it was shown.
    await RateDate.updateOne({ ratePlan: bar._id, roomType: rt._id, date: addDays(today, 3) }, { $set: { price: 700 } });
    r = await call('POST', '/booking/reservations', R, { propertyId: P, ...stay, mode: 'confirm', priceSignature: offBar.priceSignature, guestId: String(existing._id), idempotencyKey: key() });
    check('RSV-02 old price signature is refused with the new price (T02)', r.status === 409 && r.code === 'price_changed' && r.details?.[0]?.total === 1700, `${r.status} ${JSON.stringify(r.details)}`);
    // T01: one room left, two clerks at the same moment.
    const newSig = r.details?.[0]?.priceSignature;
    const [c1, c2] = await Promise.all([
      call('POST', '/booking/reservations', R, { propertyId: P, ...stay, mode: 'confirm', priceSignature: newSig, guestId: String(existing._id), idempotencyKey: key() }),
      call('POST', '/booking/reservations', M, { propertyId: P, ...stay, mode: 'confirm', priceSignature: newSig, guestId: String(existing._id), idempotencyKey: key() }),
    ]);
    const okCount = [c1, c2].filter((x) => x.status === 200).length;
    check('RSV-02 last room sold once; the parallel request gets a conflict (T01)', okCount === 1 && [c1, c2].some((x) => x.status === 409), `${c1.status}/${c2.status} ${c1.error || ''} ${c2.error || ''}`);
    check('RSV-02 inventory never exceeds physical rooms', (await booked(addDays(today, 3))) === 2);

    r = await call('POST', '/booking/reservations', R, { propertyId: P, arrival: addDays(today, 15), departure: addDays(today, 16), adults: 2, rooms: 1, roomTypeId: String(rt._id), ratePlanId: String(bar._id), mode: 'confirm', newGuest: { firstName: 'דנה', lastName: 'כפולה', email: `dana-${TAG.toLowerCase()}@example.com` }, idempotencyKey: key() });
    check('RSV-02 a new guest matching an existing email is surfaced as a possible duplicate', r.status === 409 && r.code === 'possible_duplicate' && r.details?.[0]?.id === String(existing._id), r.status);
    r = await call('POST', '/booking/reservations', R, { propertyId: P, arrival: addDays(today, 15), departure: addDays(today, 16), adults: 2, children: 1, rooms: 1, roomTypeId: String(rt._id), ratePlanId: String(bar._id), mode: 'confirm', guestId: String(existing._id), idempotencyKey: key() });
    check('RSV-02 children require their ages', r.status === 422 && r.fields?.childAges, r.status);
    r = await call('POST', '/booking/reservations', R, { propertyId: P, arrival: addDays(today, 15), departure: addDays(today, 17), adults: 2, rooms: 1, roomTypeId: String(rt._id), ratePlanId: String(bar._id), mode: 'confirm', guestId: String(existing._id), override: { ratePerNight: 300, reason: 'לקוח חוזר' }, idempotencyKey: key() });
    check('RSV-02 manual price: receptionist refused', r.status === 403, r.status);
    r = await call('POST', '/booking/reservations', M, { propertyId: P, arrival: addDays(today, 15), departure: addDays(today, 17), adults: 2, rooms: 1, roomTypeId: String(rt._id), ratePlanId: String(bar._id), mode: 'confirm', guestId: String(existing._id), override: { ratePerNight: 300 }, idempotencyKey: key() });
    check('RSV-02 manual price requires a reason', r.status === 422, r.status);
    r = await call('POST', '/booking/reservations', M, { propertyId: P, arrival: addDays(today, 15), departure: addDays(today, 17), adults: 2, rooms: 1, roomTypeId: String(rt._id), ratePlanId: String(bar._id), mode: 'confirm', guestId: String(existing._id), override: { ratePerNight: 300, reason: 'לקוח חוזר' }, idempotencyKey: key() });
    const ovr = await Reservation.findById(r.data?.id).lean();
    check('RSV-02 manager price with a reason is recorded in the snapshot', r.status === 200 && ovr.totalAmount === 600 && ovr.priceSnapshot?.override?.reason === 'לקוח חוזר', r.error);

    // ── Drafts and cancel ───────────────────────────────────────────────────
    const d20 = addDays(today, 20);
    const inv20 = await booked(d20);
    r = await call('POST', '/booking/reservations', R, { propertyId: P, arrival: d20, departure: addDays(today, 21), adults: 2, rooms: 1, roomTypeId: String(rt._id), ratePlanId: String(bar._id), mode: 'draft', guestId: String(existing._id), idempotencyKey: key() });
    const draftId = r.data?.id;
    check('RSV-02 draft holds no inventory', r.status === 200 && r.data.status === 'draft' && (await booked(d20)) === inv20, r.error);
    r = await call('POST', `/booking/reservations/${draftId}/cancel`, R, { propertyId: P });
    check('Cancel requires a reason', r.status === 422, r.status);
    r = await call('POST', `/booking/reservations/${draftId}/cancel`, R, { propertyId: P, reason: 'לא רלוונטי' });
    check('Cancelling a draft does not release inventory it never took', r.status === 200 && (await booked(d20)) === inv20, `${r.status} ${await booked(d20)}`);
    r = await call('POST', `/booking/reservations/${ovr._id}/cancel`, R, { propertyId: P, reason: 'האורח ביטל' });
    check('Cancelling a confirmed booking releases its nights', r.status === 200 && (await booked(addDays(today, 15))) === 0);
    const inh = await Reservation.create({ property: P, confirmationNumber: `${TAG}-IH`, status: 'in_house', primaryGuest: existing._id, adults: 1, arrivalDate: today, departureDate: addDays(today, 1), nights: 1, roomsCount: 1, roomType: rt._id, ratePerNight: 500, totalAmount: 500 });
    r = await call('POST', `/booking/reservations/${inh._id}/cancel`, M, { propertyId: P, reason: 'ניסיון' });
    check('A stay that already started cannot be cancelled (T32)', r.status === 409, r.status);

    // ── RSV-04 quotes ───────────────────────────────────────────────────────
    const q = { propertyId: P, arrival: addDays(today, 22), departure: addDays(today, 24), adults: 2, rooms: 1, roomTypeId: String(rt._id), ratePlanId: String(bar._id), guestId: String(existing._id) };
    r = await call('POST', '/booking/reservations', R, { ...q, mode: 'quote', validUntil: new Date(Date.now() - 60000).toISOString(), idempotencyKey: key() });
    check('RSV-04 quote validity must be in the future', r.status === 422 && r.fields?.validUntil, r.status);
    const inv22 = await booked(addDays(today, 22));
    r = await call('POST', '/booking/reservations', R, { ...q, mode: 'quote', validUntil: new Date(Date.now() + 2 * 86400000).toISOString(), language: 'he', channel: 'email', idempotencyKey: key() });
    const quoteId = r.data?.id;
    check('RSV-04 quote saved without holding inventory', r.status === 200 && r.data.status === 'quote' && (await booked(addDays(today, 22))) === inv22, r.error);
    const prev = await fetch(`${BASE}/booking/quotes/${quoteId}/preview?propertyId=${P}`, { headers: { Authorization: `Bearer ${R}` } });
    const html = await prev.text();
    check('RSV-04 printable quote says it is not a booking or tax document', prev.status === 200 && html.includes('אינה הזמנה מאושרת') && html.includes('1,000'), prev.status);
    r = await call('POST', `/booking/quotes/${quoteId}/sent`, R, { propertyId: P, channel: 'email' });
    check('RSV-04 mark as sent records channel and time', r.status === 200 && !!(await Reservation.findById(quoteId).lean()).quote.sentAt);
    await RateDate.updateOne({ ratePlan: bar._id, roomType: rt._id, date: addDays(today, 22) }, { $set: { price: 550 } });
    r = await call('POST', `/booking/quotes/${quoteId}/convert`, R, { propertyId: P });
    check('RSV-04 converting re-checks the price; a changed price needs confirmation', r.status === 409 && r.code === 'price_changed' && r.details?.[0]?.total === 1050, `${r.status} ${JSON.stringify(r.details)}`);
    r = await call('POST', `/booking/quotes/${quoteId}/convert`, R, { propertyId: P, priceSignature: r.details?.[0]?.priceSignature });
    const conv = await Reservation.findById(quoteId).lean();
    check('RSV-04 converted with the confirmed new price; inventory taken now', r.status === 200 && conv.status === 'confirmed' && conv.totalAmount === 1050 && (await booked(addDays(today, 22))) === inv22 + 1, r.error);
    r = await call('POST', `/booking/quotes/${quoteId}/convert`, R, { propertyId: P });
    check('RSV-04 a converted quote cannot be converted again', r.status === 409, r.status);
    r = await call('POST', '/booking/reservations', R, { ...q, arrival: addDays(today, 25), departure: addDays(today, 26), mode: 'quote', validUntil: new Date(Date.now() + 86400000).toISOString(), idempotencyKey: key() });
    const q2 = r.data?.id;
    r = await call('POST', `/booking/quotes/${q2}/close`, R, { propertyId: P });
    check('RSV-04 closing a quote requires a loss reason', r.status === 422, r.status);
    r = await call('POST', `/booking/quotes/${q2}/close`, R, { propertyId: P, reason: 'מחיר גבוה' });
    check('RSV-04 closed quote keeps its record (no delete)', r.status === 200 && (await Reservation.findById(q2).lean())?.quote?.lostReason === 'מחיר גבוה');

    // ── Hold expiry ─────────────────────────────────────────────────────────
    const d27 = addDays(today, 27);
    r = await call('POST', '/booking/reservations', R, { ...q, arrival: d27, departure: addDays(today, 28), mode: 'hold', holdMinutes: 30, idempotencyKey: key() });
    const holdId = r.data?.id;
    check('RSV-02 hold takes inventory until its expiry', r.status === 200 && r.data.status === 'hold' && (await booked(d27)) === 1, r.error);
    await Reservation.updateOne({ _id: holdId }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await call('GET', `/booking/availability?${qs({ arrival: d27, departure: addDays(today, 28), adults: 2 })}`, R);
    check('An expired hold releases its inventory', (await Reservation.findById(holdId).lean()).status === 'cancelled' && (await booked(d27)) === 0);

    const d18 = addDays(today, 18);
    r = await call('POST', '/booking/reservations', R, { ...q, arrival: d18, departure: addDays(today, 19), mode: 'hold', holdMinutes: 60, idempotencyKey: key() });
    const hold2 = r.data?.id;
    const invHeld = await booked(d18);
    r = await call('POST', `/booking/quotes/${hold2}/convert`, R, { propertyId: P });
    check('RSV-02 a plain hold is confirmed without taking inventory twice', r.status === 200 && (await Reservation.findById(hold2).lean()).status === 'confirmed' && (await booked(d18)) === invHeld, `${r.status} ${r.error || ''}`);

    // ── RSV-01 / RSV-03 ─────────────────────────────────────────────────────
    r = await call('GET', `/booking/reservations?${qs({ q: res1.confirmationNumber })}`, R);
    check('RSV-01 finds a booking by confirmation number', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].id === String(res1._id), r.status);
    r = await call('GET', `/booking/reservations?${qs({ status: 'quotes' })}`, R);
    check('RSV-01 quotes filter', r.status === 200 && r.data.rows.every((x) => ['quote', 'draft'].includes(x.status)));
    r = await call('GET', `/booking/reservations?${qs({ from: addDays(today, 1), to: addDays(today, 3), dateField: 'arrival' })}`, R);
    check('RSV-01 arrival range filter and unit totals', r.status === 200 && r.data.rows.every((x) => x.arrivalDate >= addDays(today, 1) && x.arrivalDate <= addDays(today, 3)) && r.data.units >= r.data.total, JSON.stringify({ st: r.status, total: r.data?.total, units: r.data?.units, arr: r.data?.rows?.map((x) => x.arrivalDate), err: r.error }));
    r = await call('GET', `/booking/reservations/${res1._id}?propertyId=${P}`, R);
    check('RSV-03 stay file: units, frozen price and allowed actions', r.status === 200 && r.data.units.length === 1 && r.data.price.snapshot.nightly.length === 3 && r.data.actions.checkIn.ok === false && r.data.history.length > 0, JSON.stringify(r.data?.actions || r).slice(0, 160));
    r = await call('GET', `/booking/reservations/${res1._id}?propertyId=${P}`, HM);
    check('RSV-03 housekeeping sees no money', r.status === 200 && r.data.price === null && r.data.money === null, r.status);
  } finally {
    const resIds = (await Reservation.find({ property: P }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: P }, { entityId: { $in: [p._id, ...resIds] } }] });
    await ChannelUpdateQueue.deleteMany({ property: P }).catch(() => null);
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
