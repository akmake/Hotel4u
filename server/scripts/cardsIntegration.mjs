#!/usr/bin/env node
/* eslint-disable no-console */
// Card clearing (gap-map item 12) through the provider layer with the test provider: settings, card on file
// (token + last 4 only), card check, authorization at check-in / top-up / release, charge (capture or sale),
// refund to the card, card companies as debtors (settlement + deposit), roles, audit.
// Live PMS server + same DB, on a throw-away property removed at the end.
//   node scripts/cardsIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import Folio from '../models/Folio.js';
import ChargeCode from '../models/ChargeCode.js';
import InventoryDate from '../models/InventoryDate.js';
import StaySegment from '../models/StaySegment.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import GuestRegistrationCard from '../models/GuestRegistrationCard.js';
import { PaymentCard, CardAuthorization, CardTransaction, CardSettlement } from '../models/Payments.js';
import { releaseFinished } from '../services/cardService.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `CRD${Date.now().toString(36).toUpperCase()}`;
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
const bal = (f) => Math.round(f.lines.filter((l) => l.status === 'posted').reduce((s, l) => s + l.amount + (l.taxAmount || 0), 0) * 100) / 100;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG, reservationSequence: 0 });
  P = String(p._id);
  try {
    const rt = await RoomType.create({ property: P, code: `${TAG}S`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3, adultsMax: 3 });
    await InventoryDate.insertMany(Array.from({ length: 5 }, (_, i) => ({ property: P, roomType: rt._id, date: addDays(today, i), physicalCount: 5 })));
    const guest = await GuestProfile.create({ property: P, firstName: 'אורח', lastName: TAG, idNumber: '000000018', nationality: 'IL' });
    const mk = (role) => User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const R = tok(await mk('receptionist')); const F = tok(await mk('finance_manager')); const H = tok(await mk('housekeeper'));
    let n = 0;
    const mkRes = async ({ status = 'confirmed', arrival = today, nights = 2 } = {}) => {
      n += 1;
      const room = await Room.create({ property: P, roomType: rt._id, number: `${TAG.slice(-3)}${n}`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: status === 'in_house' ? 'occupied' : 'vacant' });
      const r = await Reservation.create({ property: P, confirmationNumber: `${TAG}-${n}`, status, primaryGuest: guest._id, adults: 2, arrivalDate: arrival, departureDate: addDays(arrival, nights), nights, roomsCount: 1, roomType: rt._id, ratePerNight: 500, totalAmount: 500 * nights, assignedRoom: room._id, guaranteeType: 'credit_card', ...(status === 'in_house' ? { checkedInAt: new Date() } : {}) });
      await ReservationRoom.create({ reservation: r._id, property: P, roomTypeBooked: rt._id, assignedRoom: room._id, arrivalDate: arrival, departureDate: addDays(arrival, nights), nightlyRate: 500, adults: 2, status: status === 'in_house' ? 'in_house' : 'reserved' });
      const folio = await Folio.create({ property: P, reservation: r._id, ownerType: 'guest', lines: [] });
      return { r, folio };
    };
    const addCard = async (reservation, number) => {
      const s = await call('POST', '/cards/capture', R, { reservation: String(reservation._id) });
      const f = await call('POST', `/cards/capture/${s.data?.sessionToken}`, R, { payload: { number, expMonth: 12, expYear: new Date().getFullYear() + 2, holderName: 'Test Guest' } });
      return { s, f };
    };

    // ── Settings ──
    let r = await call('GET', '/cards/settings', R);
    check('CR1 settings: test provider available, 4 test cards', r.success && r.data.provider === 'mock' && r.data.available && r.data.testCards.length === 4, r);
    r = await call('PUT', '/cards/settings', R, { provider: 'mock', authBasis: 'per_night', authAmount: 300, incidentals: 100 });
    check('CR2 receptionist cannot change clearing settings', r.status === 403, r.status);
    r = await call('PUT', '/cards/settings', F, { provider: 'mock', mode: 'live' });
    check('CR3 test provider in live mode refused', r.status === 422 && r.fields?.mode, r);
    r = await call('PUT', '/cards/settings', F, { provider: 'nope' });
    check('CR4 unknown provider refused', r.status === 422, r.status);
    r = await call('PUT', '/cards/settings', F, { provider: 'mock', authBasis: 'per_night', authAmount: 300, incidentals: 100, authOnCheckIn: true });
    check('CR5 policy saved: 300 per night + 100 extras', r.success && r.data.authBasis === 'per_night' && r.data.authAmount === 300, r);

    // ── Card on file ──
    const s1 = await mkRes();
    let c = await addCard(s1.r, '4111111111111111');
    check('CR6 a real-looking card number is refused by the test provider', c.f.status === 422 && c.f.fields?.number, c.f);
    c = await addCard(s1.r, '4242424242424242');
    const card1 = c.f.data;
    check('CR7 test card captured: last 4 + brand, on the reservation', c.f.success && card1?.last4 === '4242' && card1.brand === 'visa', c.f);
    const raw = await PaymentCard.findById(card1.id).lean();
    const resRaw = await Reservation.findById(s1.r._id).lean();
    check('CR8 no card number stored; provider token sealed', !JSON.stringify(raw).includes('4242424242424242') && String(raw.token).startsWith('v1:') && resRaw.card?.last4 === '4242', raw.token?.slice(0, 5));
    const sx = await call('POST', '/cards/capture', R, { reservation: String(s1.r._id) });
    await PaymentCard.updateOne({ 'capture.token': sx.data.sessionToken }, { $set: { 'capture.expiresAt': new Date(Date.now() - 1000) } });
    r = await call('POST', `/cards/capture/${sx.data.sessionToken}`, R, { payload: { number: '4242424242424242', expMonth: 12, expYear: 2099 } });
    check('CR9 expired capture window refused', r.status === 410, r.status);
    r = await call('POST', `/cards/${card1.id}/verify`, R, {});
    check('CR10 card check ok', r.success && r.data.lastCheck?.ok === true, r);
    const sDecl = await mkRes({ arrival: addDays(today, 1) });
    const cd = (await addCard(sDecl.r, '4000000000000002')).f.data;
    r = await call('POST', `/cards/${cd.id}/verify`, R, {});
    check('CR11 card check of a declined card is recorded as failed', r.success && r.data.lastCheck?.ok === false, r.data?.lastCheck);

    // ── Check-in authorization ──
    await call('POST', `/frontdesk/reservations/${s1.r._id}/registration`, R, { firstName: 'אורח', lastName: TAG, dateOfBirth: '1990-05-01', nationality: 'IL', address: 'הרצל 10, חיפה', idDocType: 'id_card', idDocNumber: '000000018', idVerified: true });
    r = await call('POST', `/frontdesk/reservations/${s1.r._id}/check-in`, R, { guarantee: { method: 'credit_card', reference: '4242' }, override: { enabled: false } });
    check('CR12 check-in places the authorization: (300 + 100) × 2 nights = 800', r.success && r.data?.cardAuth?.ok && r.data.cardAuth.amount === 800, [r.status, r.error, r.data?.cardAuth, r.details, r.reasons]);
    let st = await call('GET', `/cards/reservations/${s1.r._id}`, R);
    check('CR13 reservation card state: active authorization 800', st.success && st.data.auth?.amount === 800 && st.data.card?.last4 === '4242', st.data?.auth);
    r = await call('POST', `/frontdesk/reservations/${s1.r._id}/charges`, R, { description: 'ספא', amount: 1500, department: 'spa', idempotencyKey: key() });
    r = await call('GET', '/cards/authorizations', R);
    const row = r.data?.find((x) => x.reservation === String(s1.r._id));
    check('CR14 authorization board: the stay passed its authorization (gap > 0)', r.success && row && row.gap > 0 && row.authorized === 800, row);
    r = await call('POST', `/cards/reservations/${s1.r._id}/top-up`, R, {});
    check('CR15 top-up raises the authorization to the exposure', r.success && r.data.amount >= row.exposure && r.data.history.some((h) => h.kind === 'increment'), r.data);

    // ── Charge ──
    const f1 = await Folio.findById(s1.folio._id).lean();
    r = await call('POST', `/cards/folios/${s1.folio._id}/charge`, R, { amount: bal(f1) + 100 });
    check('CR16 charge above the balance refused before money moves', r.status === 422 && !(await CardTransaction.exists({ folio: s1.folio._id })), r.status);
    r = await call('POST', `/cards/folios/${s1.folio._id}/charge`, R, { amount: 500 });
    const cap = r.data;
    const f1b = await Folio.findById(s1.folio._id).lean();
    const payLine = f1b.lines.find((l) => String(l._id) === cap?.lineId);
    check('CR17 capture from the authorization → payment line (credit card, last 4, approval)', r.success && cap.kind === 'capture' && payLine?.method === 'credit_card' && payLine.payDetails?.last4 === '4242' && payLine.methodRef === cap.approval && payLine.amount === -500, [r.status, r.error, payLine]);
    let set = await call('GET', `/cards/settlements?from=${today}&to=${today}`, F);
    check('CR18 card company owes the day: visa 500', set.success && set.data.rows.find((x) => x.brand === 'visa')?.expected === 500, set.data?.rows);

    // ── Limits and declines ──
    const s2 = await mkRes({ status: 'in_house', arrival: addDays(today, -1), nights: 3 });
    const climit = (await addCard(s2.r, '4000000000009995')).f.data;
    r = await call('POST', `/cards/reservations/${s2.r._id}/authorize`, R, { amount: 1500 });
    check('CR19 authorization above the card limit declined (402)', r.status === 402, r.status);
    r = await call('POST', `/cards/reservations/${s2.r._id}/authorize`, R, { amount: 800 });
    check('CR20 authorization within the limit approved', r.success && r.data.amount === 800, r);
    await call('POST', `/frontdesk/reservations/${s2.r._id}/charges`, R, { description: 'אירוע', amount: 1200, department: 'other', idempotencyKey: key() });
    r = await call('POST', `/cards/folios/${s2.folio._id}/charge`, R, { amount: 1200 });
    const f2 = await Folio.findById(s2.folio._id).lean();
    check('CR21 charge needing a top-up past the limit declined — no payment line', r.status === 402 && !f2.lines.some((l) => l.type === 'payment'), [r.status, r.error]);
    r = await call('POST', `/cards/${climit.id}/remove`, R, {});
    check('CR22 a card with an active authorization cannot be removed', r.status === 409, r.status);
    r = await call('POST', `/cards/reservations/${s2.r._id}/release`, R, {});
    check('CR23 release the authorization', r.success && r.data.status === 'released', r);
    r = await call('POST', `/cards/${climit.id}/remove`, R, {});
    check('CR24 card removed; reservation no longer points at it', r.success && !(await Reservation.findById(s2.r._id).lean()).card, r);

    // ── Refund to card ──
    const s3 = await mkRes({ status: 'in_house', arrival: today, nights: 2 });
    await addCard(s3.r, '5555555555554444');
    r = await call('POST', `/cards/folios/${s3.folio._id}/charge`, R, { amount: 300, kind: 'deposit' });
    const dep = r.data;
    check('CR25 deposit by card (sale, no authorization)', r.success && dep.kind === 'sale', r);
    r = await call('POST', `/cards/folios/${s3.folio._id}/refund`, R, { paymentLineId: dep.lineId, amount: 100, reasonCode: 'overpayment' });
    check('CR26 receptionist refund needs a manager — refused before money moves', r.status === 403 && !(await CardTransaction.exists({ kind: 'refund', folio: s3.folio._id })), r.status);
    r = await call('POST', `/cards/folios/${s3.folio._id}/refund`, F, { paymentLineId: dep.lineId, amount: 400, reasonCode: 'overpayment' });
    check('CR27 refund above the payment refused', r.status === 422, r.status);
    r = await call('POST', `/cards/folios/${s3.folio._id}/refund`, F, { paymentLineId: dep.lineId, amount: 100, reasonCode: 'overpayment' });
    const f3 = await Folio.findById(s3.folio._id).lean();
    check('CR28 refund to the same card → refund line linked to the payment', r.success && f3.lines.some((l) => l.type === 'refund' && String(l.refundOf) === dep.lineId && l.amount === 100), [r.status, r.error]);
    const mc = (await call('GET', `/cards/settlements?from=${today}&to=${today}`, F)).data.rows.find((x) => x.brand === 'mastercard');
    check('CR29 mastercard owes 300 − 100 = 200', mc?.expected === 200, mc);
    const cash = await Folio.findById(s3.folio._id);
    cash.lines.push({ type: 'deposit', description: 'מזומן', amount: -50, taxAmount: 0, serviceDate: today, source: 'manual', status: 'posted', method: 'cash' });
    await cash.save();
    r = await call('POST', `/cards/folios/${s3.folio._id}/refund`, F, { paymentLineId: String(cash.lines[cash.lines.length - 1]._id), amount: 10, reasonCode: 'overpayment' });
    check('CR30 a payment that did not go through the provider is not refunded to a card', r.status === 404, r.status);

    // ── Settlement / deposits ──
    set = await call('GET', `/cards/settlements?status=open`, F);
    const visa = set.data.rows.find((x) => x.brand === 'visa');
    r = await call('POST', `/cards/settlements/${visa.id}/deposit`, R, { amount: 490, fee: 10 });
    check('CR31 receptionist cannot record deposits', r.status === 403, r.status);
    r = await call('POST', `/cards/settlements/${visa.id}/deposit`, F, { amount: 600, fee: 10 });
    check('CR32 deposit above what is owed refused', r.status === 422, r.status);
    r = await call('POST', `/cards/settlements/${visa.id}/deposit`, F, { amount: 490, fee: 10, ref: 'DEP-1' });
    check('CR33 deposit + provider fee settle the day', r.success && r.data.status === 'settled' && r.data.open === 0, r);
    r = await call('GET', `/cards/transactions?from=${today}&to=${today}`, F);
    check('CR34 transactions log: capture, sale, refund', r.success && ['capture', 'sale', 'refund'].every((k) => r.data.some((t) => t.kind === k)), r.data?.map((t) => t.kind));

    // ── Release after departure, roles, audit ──
    await call('POST', `/cards/reservations/${s3.r._id}/authorize`, R, { amount: 200 });
    await Reservation.updateOne({ _id: s3.r._id }, { $set: { status: 'checked_out' } });
    const released = await releaseFinished({ propertyId: P });
    const a3 = await CardAuthorization.findOne({ reservation: s3.r._id }).sort({ createdAt: -1 }).lean();
    check('CR35 authorizations of departed stays are released automatically', released >= 1 && a3.status !== 'active', [released, a3?.status]);
    r = await call('GET', '/cards/authorizations', H);
    check('CR36 housekeeper cannot see card data', r.status === 403, r.status);
    const acts = await AuditLog.distinct('action', { property: P, action: /^card\./ });
    check('CR37 audited: settings, add, verify, auth, increment, decline, capture, sale, refund, deposit, release, remove', ['card.settings', 'card.add', 'card.verify', 'card.auth', 'card.auth_increment', 'card.auth_declined', 'card.capture', 'card.sale', 'card.refund', 'card.deposit', 'card.auth_release', 'card.remove'].every((a) => acts.includes(a)), acts);
  } finally {
    await Promise.all([Room, RoomType, User, GuestProfile, Reservation, ReservationRoom, AuditLog, Folio, ChargeCode, InventoryDate, StaySegment, HousekeepingTask, GuestRegistrationCard, PaymentCard, CardAuthorization, CardTransaction, CardSettlement].map((m) => m.deleteMany({ property: P }).catch(() => null)));
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
