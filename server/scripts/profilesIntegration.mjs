#!/usr/bin/env node
/* eslint-disable no-console */
// Profiles (gap-map item 16): files, relations, restriction rule (booking + checkout), past stays, revenue by
// department, change log, turnaways in the profile, "reservation" notes copied to new bookings, company account
// manager + negotiated rates, group profile on a new block, source / contact profiles on a booking, roles.
// Live PMS server + same DB, on a throw-away property removed at the end.
//   node scripts/profilesIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import GuestProfile, { GuestAttachment } from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import AuditLog from '../models/AuditLog.js';
import Folio from '../models/Folio.js';
import Company from '../models/Company.js';
import TurnAway from '../models/TurnAway.js';
import InventoryDate from '../models/InventoryDate.js';
import GroupBlock from '../models/GroupBlock.js';
import { RatePlan } from '../models/RatePlan.js';
import { applyBookingDefaults } from '../services/codeListService.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `PRF${Date.now().toString(36).toUpperCase()}`;
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${typeof info === 'string' ? info : JSON.stringify(info).slice(0, 400)}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
let P;
async function call(method, url, t, body, raw = false) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${url}${sep}propertyId=${P}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify({ ...body, propertyId: P }) : undefined, signal: AbortSignal.timeout(30000) });
  if (raw) return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
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
    await Room.create({ property: P, roomType: rt._id, number: `${TAG.slice(-3)}1`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' });
    for (let i = 0; i < 40; i += 1) await InventoryDate.create({ property: P, roomType: rt._id, date: addDays(today, i), physicalCount: 1 });
    const corp = await Company.create({ property: P, name: 'חברת אלפא', type: 'corporate' });
    const plan = await RatePlan.create({ property: P, code: 'CORP', name: 'מוסכם', type: 'corporate', pricingRules: [{ name: 'אלפא −15%', companies: [corp._id], adjustmentType: 'percent', adjustmentValue: -15 }] });
    const mk = (role) => User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const gmU = await mk('general_manager'); const rU = await mk('receptionist');
    const G = tok(gmU); const R = tok(rU); const H = tok(await mk('housekeeper'));
    const guest = await GuestProfile.create({ property: P, firstName: 'נועה', lastName: TAG, phone: '0507654321' });
    const spouse = await GuestProfile.create({ property: P, firstName: 'עמית', lastName: TAG });

    // Files
    let r = await call('POST', `/profiles/guests/${guest._id}/files`, R, { name: 'passport.exe', mime: 'application/x-msdownload', data: Buffer.from('x').toString('base64') });
    check('PF1 an unsupported file type is refused', r.status === 422, r.status);
    r = await call('POST', `/profiles/guests/${guest._id}/files`, R, { name: 'הסכם.txt', mime: 'text/plain', data: Buffer.from('שלום').toString('base64') });
    const file = r.data;
    check('PF2 file attached to the profile', r.success && file.id, r);
    r = await call('GET', `/profiles/files/${file.id}`, R, null, true);
    check('PF3 file served back to a signed-in user', r.status === 200 && r.type.startsWith('text/plain') && r.text === 'שלום', [r.status, r.type]);
    r = await call('GET', `/profiles/files/${file.id}`, H, null, true);
    check('PF4 housekeeper cannot read profile files', r.status === 403, r.status);

    // Relations, restriction
    r = await call('PUT', `/profiles/guests/${guest._id}/relations`, R, { relations: [{ kind: 'family', guest: String(guest._id) }] });
    check('PF5 a profile cannot relate to itself', r.status === 422, r.status);
    r = await call('PUT', `/profiles/guests/${guest._id}/relations`, R, { relations: [{ kind: 'family', guest: String(spouse._id), note: 'בן זוג' }, { kind: 'company', company: String(corp._id), note: 'סמנכ״לית' }] });
    check('PF6 relations saved (family + company)', r.success && r.data.relations.length === 2 && r.data.relations.some((x) => x.company?.name === 'חברת אלפא'), r);
    r = await call('PUT', `/profiles/guests/${guest._id}/restriction`, R, { rule: 'manager_approval', note: 'חוב פתוח מהשהייה הקודמת' });
    check('PF7 receptionist cannot restrict a guest', r.status === 403, r.status);
    r = await call('PUT', `/profiles/guests/${guest._id}/restriction`, G, { rule: 'manager_approval', note: 'חוב פתוח מהשהייה הקודמת' });
    check('PF8 manager sets "booking needs a manager"', r.success && r.data.restriction.rule === 'manager_approval', r);
    const booking = (t, extra = {}) => call('POST', '/booking/reservations', t, { guestId: String(guest._id), roomTypeId: String(rt._id), ratePlanId: String(plan._id), arrival: addDays(today, 5), departure: addDays(today, 7), adults: 2, children: 0, mode: 'confirm', idempotencyKey: key(), ...extra });
    r = await booking(R);
    check('PF9 restricted guest: the desk cannot book', r.status === 409 && r.code === 'guest_restricted', [r.status, r.error]);
    r = await booking(G);
    const resId = r.data?.id;
    check('PF10 a manager can book the restricted guest', r.success && resId, [r.status, r.error]);
    r = await call('GET', `/frontdesk/reservations/${resId}/check-out`, G);
    check('PF11 the rule pops up at checkout too', r.data?.guestAlert?.rule === 'manager_approval', [r.status, r.data?.guestAlert]);
    await call('PUT', `/profiles/guests/${guest._id}/restriction`, G, { rule: 'prepay_only', note: 'רק בתשלום מראש' });
    r = await booking(G, { arrival: addDays(today, 20), departure: addDays(today, 21) });
    check('PF12 prepay-only guest without a deposit guarantee is refused', r.status === 409 && r.code === 'guest_prepay_only', [r.status, r.error]);
    await call('PUT', `/profiles/guests/${guest._id}/restriction`, G, { rule: null });

    // Notes copied to bookings
    await call('POST', `/guests/${guest._id}/notes`, R, { text: 'מבקשת חדר רחוק מהמעלית', type: 'reservation' });
    await call('POST', `/guests/${guest._id}/notes`, R, { text: 'הערה כללית', type: 'general' });
    const fresh = await Reservation.create({ property: P, confirmationNumber: `${TAG}-N`, status: 'confirmed', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, 30), departureDate: addDays(today, 31), nights: 1, roomsCount: 1, roomType: rt._id, ratePerNight: 500, totalAmount: 500 });
    await applyBookingDefaults({ propertyId: P, reservationId: fresh._id });
    const fr = await Reservation.findById(fresh._id).lean();
    check('PF13 "reservation" notes of the profile are copied to a new booking (general notes are not)', fr.guestNotes?.includes('רחוק מהמעלית') && !fr.guestNotes.includes('הערה כללית'), fr.guestNotes);

    // Past stays, revenue by department, change log, turnaways
    r = await call('POST', `/profiles/guests/${guest._id}/past-stays`, R, { arrival: '2023-08-01', departure: '2023-08-04', amount: 2400, roomType: 'סוויטה' });
    check('PF14 past stays are entered by a manager only', r.status === 403, r.status);
    r = await call('POST', `/profiles/guests/${guest._id}/past-stays`, G, { arrival: '2023-08-01', departure: '2023-08-04', amount: 2400, roomType: 'סוויטה' });
    const g2 = await GuestProfile.findById(guest._id).lean();
    check('PF15 past stay counted in the guest statistics (stays, revenue)', r.success && g2.totalStays >= 1 && g2.totalRevenue >= 2400 && g2.pastStays[0].nights === 3, [g2.totalStays, g2.totalRevenue]);
    const f = await Folio.create({ property: P, reservation: resId, ownerType: 'guest', lines: [
      { type: 'charge', description: 'לינה', amount: 847.46, taxAmount: 152.54, department: 'rooms', serviceDate: today, source: 'night_audit', status: 'posted' },
      { type: 'charge', description: 'ספא', amount: 254.24, taxAmount: 45.76, department: 'spa', serviceDate: today, source: 'manual', status: 'posted' },
      { type: 'payment', description: 'תשלום', amount: -1300, taxAmount: 0, serviceDate: today, source: 'manual', status: 'posted', method: 'cash' },
    ] });
    await call('POST', '/frontdesk/home/turnaways', R, { date: addDays(today, 50), nights: 2, rooms: 1, reason: 'full', guestId: String(guest._id) });
    r = await call('GET', `/profiles/guests/${guest._id}`, R);
    const x = r.data;
    check('PF16 revenue by department: rooms 1,000, spa 300 (payments excluded)', x?.revenueByDepartment?.find((d) => d.department === 'rooms')?.amount === 1000 && x.revenueByDepartment.find((d) => d.department === 'spa')?.amount === 300, x?.revenueByDepartment);
    check('PF17 change log of the profile (relations, restriction, file, past stay)', ['guest.relations', 'guest.restriction', 'guest.file_added', 'guest.past_stay'].every((a) => x?.history?.some((h) => h.action === a)), x?.history?.map((h) => h.action));
    check('PF18 turned-away request of this guest shows in the profile', x?.turnaways?.length === 1, x?.turnaways);
    check('PF19 files listed in the profile', x?.files?.length === 1, x?.files);
    await f.deleteOne();

    // Company: account manager, negotiated rates, contacts
    r = await call('PUT', `/profiles/companies/${corp._id}/account-manager`, R, { userId: String(gmU._id) });
    check('PF20 the desk cannot set the account manager', r.status === 403, r.status);
    r = await call('PUT', `/profiles/companies/${corp._id}/account-manager`, G, { userId: String(gmU._id) });
    check('PF21 account manager + negotiated rates + contacts on the company', r.success && r.data.accountManager?.id === String(gmU._id) && r.data.negotiatedRates.length === 1 && r.data.negotiatedRates[0].adjustment === '-15%' && r.data.contacts.some((c) => c.id === String(guest._id)), r.data);

    // Booking profiles: source + contact
    const src = await Company.create({ property: P, name: 'כנס רפואה', type: 'source' });
    r = await call('PUT', `/profiles/reservations/${resId}`, R, { sourceProfile: String(corp._id) });
    check('PF22 only a company of type "source" can be the source profile', r.status === 422, r.status);
    r = await call('PUT', `/profiles/reservations/${resId}`, R, { sourceProfile: String(src._id), contactProfile: String(spouse._id) });
    check('PF23 source + contact profile set; the contact is marked as a contact', r.success && (await GuestProfile.findById(spouse._id).lean()).isContact === true, r);

    // Group profile on a new block
    r = await call('POST', '/group-blocks', G, { name: `כנס ${TAG}`, arrivalDate: addDays(today, 25), departureDate: addDays(today, 27), cutoffDate: addDays(today, 20), allotments: [{ roomTypeId: String(rt._id), blocked: 1, rate: 400 }] });
    const blk = r.data?.id ? await GroupBlock.findById(r.data.id).populate('company', 'type name').lean() : null;
    check('PF24 a block without a company gets its own group profile', blk?.company?.type === 'group' && blk.company.name === `כנס ${TAG}`, [r.status, r.error, blk?.company]);
  } finally {
    await Promise.all([Room, RoomType, User, GuestProfile, GuestAttachment, Reservation, AuditLog, Folio, Company, TurnAway, InventoryDate, GroupBlock, RatePlan].map((m) => m.deleteMany({ property: P }).catch(() => null)));
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
