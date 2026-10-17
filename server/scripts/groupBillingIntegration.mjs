#!/usr/bin/env node
/* eslint-disable no-console */
// Group billing integration suite: who pays each room of a multi-room booking.
// - group routing (all / room_only / none) and per-room overrides
// - a room that pays for itself needs its own guarantee to check in; the booker's covers the rest
// - nights of a self-paying room post to that room's own account
// - a self-paying room settles its own account when it leaves, while the group stays
// Runs against a live PMS server and the same DB; creates its own fixtures and removes them.
//
//   node scripts/groupBillingIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import Folio from '../models/Folio.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import GuestRegistrationCard from '../models/GuestRegistrationCard.js';
import InventoryDate from '../models/InventoryDate.js';
import AuditLog from '../models/AuditLog.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { postNightsUntil } from '../services/roomCharges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || 'hotel4u_dev_secret_change_in_prod';
const TAG = `GRP${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const bal = (f) => Math.round(f.lines.filter((l) => l.status === 'posted').reduce((s, l) => s + l.amount + (l.taxAmount || 0), 0) * 100) / 100;
const key = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const property = await Property.findOne({ active: { $ne: false } }).sort({ createdAt: 1 });
  const P = String(property._id);
  const today = todayYmdInTimezone(property.timezone || 'Asia/Jerusalem');
  const created = { res: [], guests: [], users: [], rooms: [] };
  const policyBefore = property.checkInPolicy ? JSON.parse(JSON.stringify(property.checkInPolicy)) : undefined;
  let inventory = [];

  async function userWithRole(role) {
    let u = await User.findOne({ property: P, role, active: { $ne: false } });
    if (!u) { u = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true }); created.users.push(u._id); }
    return u;
  }

  try {
    // The guarantee gate must be on for this suite (restored at the end).
    await Property.updateOne({ _id: P }, { $set: { 'checkInPolicy.requireGuarantee': true } });
    const M = tok(await userWithRole('property_admin'));
    const R = tok(await userWithRole('receptionist'));
    const H = tok(await userWithRole('housekeeper'));
    const roomType = await RoomType.findOne({ property: P, active: { $ne: false } }).sort({ sortOrder: 1 });
    inventory = await InventoryDate.find({ property: P, roomType: roomType._id }).select('bookedCount').lean();
    const guest = await GuestProfile.create({ property: P, firstName: 'מזמין', lastName: TAG });
    created.guests.push(guest._id);
    const mkRoom = async (i, occ = 'vacant') => { const r = await Room.create({ property: P, roomType: roomType._id, number: `${TAG}-${i}`, floor: 97, cleanStatus: 'clean', opsStatus: 'available', occStatus: occ }); created.rooms.push(r._id); return r; };

    async function mkGroup({ status, arrival, departure, rooms = 3, rate = 400, occ = 'vacant' }) {
      const rs = [];
      for (let i = 0; i < rooms; i += 1) rs.push(await mkRoom(`${created.res.length}-${i}`, occ));
      const nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000);
      const r = await Reservation.create({
        property: P, confirmationNumber: `${TAG}-${created.res.length + 1}`, status, primaryGuest: guest._id,
        adults: 2 * rooms, arrivalDate: arrival, departureDate: departure, nights, roomsCount: rooms, roomType: roomType._id,
        ratePerNight: rate, totalAmount: rate * nights * rooms, assignedRoom: rs[0]._id, guaranteeType: 'credit_card',
        ...(status === 'in_house' ? { checkedInAt: new Date() } : {}),
      });
      created.res.push(r._id);
      const unitStatus = status === 'in_house' ? 'in_house' : 'reserved';
      const units = await ReservationRoom.insertMany(rs.map((room) => ({ reservation: r._id, property: P, roomTypeBooked: roomType._id, assignedRoom: room._id, arrivalDate: arrival, departureDate: departure, nightlyRate: rate, status: unitStatus })));
      const guestFolio = await Folio.create({ property: P, reservation: r._id, ownerType: 'guest', lines: [] });
      return { r, rooms: rs, units, guestFolio };
    }

    // ── Arrival: routing and per-room guarantee ─────────────────────────────
    const g = await mkGroup({ status: 'confirmed', arrival: today, departure: addDays(today, 2) });
    const reg = await call('POST', `/frontdesk/reservations/${g.r._id}/registration`, R, {
      propertyId: P, firstName: 'מזמין', lastName: TAG, dateOfBirth: '1980-01-01', nationality: 'IL', idDocType: 'id_card', idDocNumber: '000000018', idVerified: true,
    });
    check('Setup: registration saved', reg.status === 200, JSON.stringify(reg).slice(0, 160));

    const rowsOf = async () => (await call('GET', `/frontdesk/arrivals?propertyId=${P}&q=${encodeURIComponent(TAG)}`, R)).data?.rows?.filter((x) => x.reservationId === String(g.r._id)) || [];
    let rows = await rowsOf();
    check('Default: every room is paid by the booker', rows.length === 3 && rows.every((x) => x.billing?.roomPayer === 'booker' && x.billing?.extrasPayer === 'booker'), JSON.stringify(rows.map((x) => x.billing)));
    check('Default: the booker\'s guarantee makes every room ready', rows.every((x) => x.readiness.state === 'ready'), JSON.stringify(rows.map((x) => x.readiness)));

    let b = await call('POST', `/frontdesk/reservations/${g.r._id}/billing`, R, { propertyId: P, mode: 'none' });
    check('Group routing "none": each room pays itself', b.status === 200 && b.data.units.every((u) => u.billing.roomPayer === 'guest' && u.billing.extrasPayer === 'guest'), JSON.stringify(b).slice(0, 200));
    const ownFolios = await Folio.find({ reservation: g.r._id, ownerType: 'room' }).lean();
    check('Each self-paying room gets its own account', ownFolios.length === 3 && g.units.every((u) => ownFolios.some((f) => f.ownerRef === String(u._id))), ownFolios.length);
    rows = await rowsOf();
    check('A self-paying room without its own guarantee shows the guarantee reason', rows.every((x) => x.guarantee?.own && !x.guarantee.ok && x.readiness.reasons.some((r) => r.code === 'guarantee')), JSON.stringify(rows.map((x) => x.guarantee)));

    b = await call('PATCH', `/frontdesk/reservations/${g.r._id}/units/1/billing`, R, { propertyId: P, roomPayer: 'booker', extrasPayer: 'booker', occupantName: 'דנה' });
    check('One room can go back to the booker (mixed group)', b.status === 200 && b.data.billing.roomPayer === 'booker' && b.data.groupMode === 'mixed', JSON.stringify(b).slice(0, 200));
    const bad = await call('PATCH', `/frontdesk/reservations/${g.r._id}/units/1/billing`, R, { propertyId: P, roomPayer: 'someone' });
    check('An unknown payer is refused', bad.status === 422, bad.status);
    const hk = await call('PATCH', `/frontdesk/reservations/${g.r._id}/units/2/billing`, H, { propertyId: P, roomPayer: 'booker' });
    check('RBAC: housekeeper cannot change who pays', hk.status === 403, hk.status);

    let ci = await call('POST', `/frontdesk/reservations/${g.r._id}/check-in`, R, { propertyId: P, unitIndexes: [2] });
    check('Self-paying room without a guarantee cannot check in', ci.status === 409 && JSON.stringify(ci.details || []).includes('guarantee'), JSON.stringify(ci).slice(0, 200));
    const noRef = await call('POST', `/frontdesk/reservations/${g.r._id}/check-in`, R, { propertyId: P, unitIndexes: [2], unitGuarantees: [{ unitIndex: 2, method: 'credit_card', reference: '1' }] });
    check('A room card guarantee needs a checkable reference', noRef.status === 422, noRef.status);
    ci = await call('POST', `/frontdesk/reservations/${g.r._id}/check-in`, R, { propertyId: P, unitIndexes: [2], unitGuarantees: [{ unitIndex: 2, method: 'credit_card', reference: '4242' }] });
    const u2 = await ReservationRoom.findById(g.units[1]._id).lean();
    const afterCi = await Reservation.findById(g.r._id).lean();
    check('With its own guarantee the room checks in alone', ci.status === 200 && u2.status === 'in_house' && u2.guaranteeType === 'credit_card' && afterCi.status === 'partially_checked_in', JSON.stringify(ci).slice(0, 200));
    ci = await call('POST', `/frontdesk/reservations/${g.r._id}/check-in`, R, { propertyId: P, unitIndexes: [1] });
    check('A booker-paid room checks in on the booker\'s guarantee', ci.status === 200, JSON.stringify(ci).slice(0, 200));
    const ctx = await call('GET', `/frontdesk/reservations/${g.r._id}/check-in?propertyId=${P}`, R);
    const ctxU3 = ctx.data?.units?.find((u) => u.index === 3);
    check('Check-in context shows each room\'s payer, guarantee and own account', ctxU3?.billing?.roomPayer === 'guest' && ctxU3.guarantee && ctxU3.guarantee.ok === false && !!ctxU3.folioId, JSON.stringify(ctxU3).slice(0, 200));

    // ── In-house: nights routing, per-room settlement on departure ──────────
    const s = await mkGroup({ status: 'in_house', arrival: addDays(today, -2), departure: today, rooms: 2, rate: 500, occ: 'occupied' });
    b = await call('PATCH', `/frontdesk/reservations/${s.r._id}/units/2/billing`, R, { propertyId: P, roomPayer: 'guest', extrasPayer: 'guest', occupantName: 'יוסי' });
    check('Mid-stay: a room can switch to paying for itself', b.status === 200 && b.data.billing.roomPayer === 'guest', b.status);
    const posted = await postNightsUntil({ reservation: s.r, until: today, source: 'pms' });
    const gf = await Folio.findById(s.guestFolio._id).lean();
    const uf = await Folio.findOne({ reservation: s.r._id, ownerType: 'room', ownerRef: String(s.units[1]._id) }).lean();
    check('Nights of a self-paying room post to the room\'s account', posted === 4 && Math.abs(bal(gf) - 1000) < 0.01 && Math.abs(bal(uf) - 1000) < 0.01, `${posted} guest=${bal(gf)} room=${uf && bal(uf)}`);

    const coCtx = await call('GET', `/frontdesk/reservations/${s.r._id}/check-out?propertyId=${P}`, R);
    const roomAcc = coCtx.data?.folios?.find((f) => f.id === String(uf._id));
    check('Check-out context names the room account by room and occupant', roomAcc && roomAcc.ownerLabel.includes(s.rooms[1].number) && roomAcc.ownerLabel.includes('יוסי') && roomAcc.unitId === String(s.units[1]._id), JSON.stringify(roomAcc).slice(0, 200));

    let co = await call('POST', `/frontdesk/reservations/${s.r._id}/check-out`, R, { propertyId: P, unitIndexes: [2] });
    check('A self-paying room cannot leave with its own balance open', co.status === 409 && co.details?.some((d) => d.folioId === String(uf._id)) && !co.details?.some((d) => d.folioId === String(s.guestFolio._id)), JSON.stringify(co).slice(0, 240));
    await call('POST', `/frontdesk/folios/${uf._id}/payments`, R, { propertyId: P, amount: 1000, method: 'cash', idempotencyKey: key() });
    co = await call('POST', `/frontdesk/reservations/${s.r._id}/check-out`, R, { propertyId: P, unitIndexes: [2] });
    const ufAfter = await Folio.findById(uf._id).lean();
    const gfAfter = await Folio.findById(s.guestFolio._id).lean();
    const sAfter = await Reservation.findById(s.r._id).lean();
    check('Paid, the room leaves and closes its own account; the booker\'s stays open', co.status === 200 && ufAfter.status === 'closed' && gfAfter.status !== 'closed' && sAfter.status === 'partially_checked_out', JSON.stringify(co).slice(0, 200));
    const late = await call('PATCH', `/frontdesk/reservations/${s.r._id}/units/2/billing`, R, { propertyId: P, roomPayer: 'booker' });
    check('A room that already left cannot change who pays', late.status === 409, late.status);
    co = await call('POST', `/frontdesk/reservations/${s.r._id}/check-out`, R, { propertyId: P, unitIndexes: [1] });
    check('The last room still needs the booker\'s account settled', co.status === 409 && co.details?.some((d) => d.folioId === String(s.guestFolio._id)), co.status);
    await call('POST', `/frontdesk/folios/${s.guestFolio._id}/payments`, R, { propertyId: P, amount: 1000, method: 'credit_card', details: { last4: '4242', approval: 'AB9876' }, idempotencyKey: key() });
    co = await call('POST', `/frontdesk/reservations/${s.r._id}/check-out`, R, { propertyId: P, unitIndexes: [1] });
    const sFinal = await Reservation.findById(s.r._id).lean();
    check('Settled, the group checks out completely', co.status === 200 && sFinal.status === 'checked_out', JSON.stringify(co).slice(0, 200));

    const audits = await AuditLog.countDocuments({ action: { $in: ['reservation.room_billing_set', 'reservation.group_billing_set', 'reservation.room_guarantee_set'] }, $or: [{ entityId: { $in: created.res } }, { entityId: { $in: [...g.units, ...s.units].map((u) => u._id) } }] });
    check('Billing changes and room guarantees are audited', audits >= 4, audits);
    void M;
  } finally {
    const resIds = created.res;
    await HousekeepingTask.deleteMany({ reservation: { $in: resIds } });
    const unitIds = (await ReservationRoom.find({ reservation: { $in: resIds } }).select('_id').lean()).map((u) => u._id);
    await ReservationRoom.deleteMany({ reservation: { $in: resIds } });
    await Folio.deleteMany({ reservation: { $in: resIds } });
    await GuestRegistrationCard.collection.deleteMany({ reservation: { $in: resIds.map((id) => new mongoose.Types.ObjectId(String(id))) } });
    await AuditLog.deleteMany({ entityId: { $in: [...resIds, ...unitIds] } });
    await Reservation.deleteMany({ _id: { $in: resIds } });
    await GuestProfile.deleteMany({ _id: { $in: created.guests } });
    await Room.deleteMany({ _id: { $in: created.rooms } });
    await User.deleteMany({ _id: { $in: created.users } });
    for (const d of inventory) await InventoryDate.updateOne({ _id: d._id }, { $set: { bookedCount: d.bookedCount } });
    await Property.updateOne({ _id: P }, policyBefore ? { $set: { checkInPolicy: policyBefore } } : { $unset: { 'checkInPolicy.requireGuarantee': 1 } });
    await mongoose.disconnect();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
