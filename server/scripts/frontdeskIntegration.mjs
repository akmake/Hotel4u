#!/usr/bin/env node
/* eslint-disable no-console */
// Front-desk W03 integration suite (FD-02 arrivals, FD-03 check-in, FD-05 registration,
// FD-04 waiting queue, INV-02 assignment). Runs against a live PMS server and the same DB.
// It creates its own fixtures for "today" (property timezone), and removes them and restores
// every room it touched at the end — also when a check fails.
//
//   node scripts/frontdeskIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import GuestRegistrationCard from '../models/GuestRegistrationCard.js';
import AuditLog from '../models/AuditLog.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? '1'];
}));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || 'hotel4u_dev_secret_change_in_prod';
const TAG = `FDT${Date.now().toString(36).toUpperCase()}`;

const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? `  → ${info}` : ''}`);
}

function token(user, overrides = {}) {
  return jwt.sign({
    id: String(user._id), firstName: user.firstName, lastName: user.lastName, email: user.email,
    role: user.role, propertyId: String(user.property), ...overrides,
  }, SECRET, { expiresIn: '1h' });
}

async function call(method, url, tok, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { Accept: 'application/json', Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let json = {};
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}

const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const property = await Property.findOne({ active: { $ne: false } }).sort({ createdAt: 1 });
  if (!property) throw new Error('No property — run npm run seed first');
  const P = String(property._id);
  const today = todayYmdInTimezone(property.timezone || 'Asia/Jerusalem');
  const tomorrow = addDays(today, 1);

  const created = { reservations: [], guests: [], users: [], tasks: [], rooms: [] };
  const roomSnapshots = new Map();
  const policyBefore = property.checkInPolicy ? JSON.parse(JSON.stringify(property.checkInPolicy)) : null;

  async function snapshotRoom(id) {
    const key = String(id);
    if (!roomSnapshots.has(key)) {
      const r = await Room.findById(id).lean();
      roomSnapshots.set(key, { cleanStatus: r.cleanStatus, opsStatus: r.opsStatus, occStatus: r.occStatus });
    }
  }
  async function setRoom(id, patch) { await snapshotRoom(id); await Room.updateOne({ _id: id }, { $set: patch }); }

  async function userWithRole(role) {
    let u = await User.findOne({ property: P, role, active: { $ne: false } });
    if (!u) {
      u = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
      created.users.push(u._id);
    }
    return u;
  }

  try {
    // Defaults the suite relies on (restored at the end).
    property.checkInPolicy = { requireInspection: false, requireGuarantee: true, requireRegistration: true, requireSignature: false, termsVersion: 'he-1' };
    await property.save();

    const manager = await userWithRole('property_admin');
    const clerk = await userWithRole('receptionist');
    const housekeeper = await userWithRole('housekeeper');
    const M = token(manager);
    const R = token(clerk);
    const H = token(housekeeper);

    const roomType = await RoomType.findOne({ property: P, active: { $ne: false } }).sort({ sortOrder: 1 });
    const guest = await GuestProfile.create({ property: P, firstName: 'בודק', lastName: TAG, phone: '+972500000000' });
    created.guests.push(guest._id);

    const mkRes = async (extra = {}) => {
      const r = await Reservation.create({
        property: P, confirmationNumber: `${TAG}-${created.reservations.length + 1}`, status: 'confirmed',
        primaryGuest: guest._id, adults: 2, children: 0, arrivalDate: today, departureDate: tomorrow, nights: 1,
        roomType: roomType._id, ratePerNight: 400, totalAmount: 400, source: 'direct', ...extra,
      });
      created.reservations.push(r._id);
      return r;
    };

    // ── FD-02: arrivals list ────────────────────────────────────────────────
    const A = await mkRes();
    let list = await call('GET', `/frontdesk/arrivals?propertyId=${P}&q=${encodeURIComponent(TAG)}&pageSize=100`, R);
    const rowA = list.data?.rows?.find((x) => x.reservationId === String(A._id));
    check('FD-02 lists today\'s arrival as one unit row', list.status === 200 && rowA && rowA.unitsTotal === 1, JSON.stringify(list).slice(0, 200));
    check('FD-02 unassigned unit is blocked with reason no_room', rowA?.readiness.state === 'blocked' && rowA.readiness.reasons.some((x) => x.code === 'no_room'));
    check('FD-02 business date comes from the property timezone', list.data?.businessDate === today);

    const hkList = await call('GET', `/frontdesk/arrivals?propertyId=${P}`, H);
    check('RBAC: housekeeper cannot read arrivals', hkList.status === 403, hkList.status);
    const otherScope = await call('GET', `/frontdesk/arrivals?propertyId=${new mongoose.Types.ObjectId()}`, R);
    check('Scope: another property is rejected', otherScope.status === 403, otherScope.status);

    // ── INV-02: candidates & assignment ─────────────────────────────────────
    // Dedicated rooms so the suite never depends on (or disturbs) the seeded occupancy.
    for (let i = 1; i <= 3; i += 1) {
      const r = await Room.create({ property: P, roomType: roomType._id, number: `${TAG}-${i}`, floor: 99, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' });
      created.rooms.push(r._id);
    }
    const cand = await call('GET', `/frontdesk/reservations/${A._id}/room-candidates?propertyId=${P}`, R);
    const free = (cand.data?.candidates || []).filter((c) => created.rooms.map(String).includes(c.id));
    check('INV-02 returns free rooms of the booked type for the full range', cand.status === 200 && free.length === 3 && free.every((c) => c.assignable && c.readyNow), `free=${free.length}`);
    const [room1, room2, room3] = free;

    let as = await call('POST', `/frontdesk/reservations/${A._id}/assign-room`, R, { roomId: room1.id });
    check('INV-02 assigns a free room', as.status === 200 && as.data?.room?.number === room1.number, JSON.stringify(as).slice(0, 200));
    as = await call('POST', `/frontdesk/reservations/${A._id}/assign-room`, R, { roomId: room2.id });
    check('INV-02 replacing an assignment requires a reason', as.status === 422 && as.fields?.reason, as.status);

    const B = await mkRes({ assignedRoom: room3.id });
    as = await call('POST', `/frontdesk/reservations/${A._id}/assign-room`, R, { roomId: room3.id, reason: 'בדיקת התנגשות' });
    check('INV-02 room held by another stay for the range → 409', as.status === 409, as.status);

    // ── T04: clean but operationally blocked ────────────────────────────────
    await setRoom(room1.id, { opsStatus: 'out_of_order' });
    list = await call('GET', `/frontdesk/arrivals?propertyId=${P}&q=${encodeURIComponent(A.confirmationNumber)}`, R);
    const t04 = list.data?.rows?.[0];
    check('T04 clean room with OOO is blocked, cleanliness does not lift it', t04?.readiness.state === 'blocked' && t04.readiness.reasons.some((x) => x.code === 'room_blocked'));
    let ci = await call('POST', `/frontdesk/reservations/${A._id}/check-in`, M, { guarantee: { method: 'credit_card', reference: '4242' }, override: { enabled: true, reason: 'ניסיון עקיפה' } });
    check('T04 even a manager override cannot check in to an OOO room', ci.status === 409, ci.status);
    await setRoom(room1.id, { opsStatus: 'available' });

    // ── T05: dirty but vacant ───────────────────────────────────────────────
    await setRoom(room1.id, { cleanStatus: 'dirty' });
    list = await call('GET', `/frontdesk/arrivals?propertyId=${P}&q=${encodeURIComponent(A.confirmationNumber)}`, R);
    check('T05 dirty room is not shown as ready', list.data?.rows?.[0]?.readiness.state === 'waiting');
    ci = await call('POST', `/frontdesk/reservations/${A._id}/check-in`, R, { guarantee: { method: 'credit_card', reference: '4242' } });
    check('T05 check-in without override is refused with per-unit reasons', ci.status === 409 && Array.isArray(ci.details), ci.status);
    ci = await call('POST', `/frontdesk/reservations/${A._id}/check-in`, R, { guarantee: { method: 'credit_card', reference: '4242' }, override: { enabled: true, reason: 'אורח VIP' } });
    check('T05 receptionist cannot override', ci.status === 403, ci.status);
    ci = await call('POST', `/frontdesk/reservations/${A._id}/check-in`, M, { guarantee: { method: 'credit_card', reference: '4242' }, override: { enabled: true, reason: '' } });
    check('T05 manager override requires a reason', ci.status === 422, ci.status);
    await setRoom(room1.id, { cleanStatus: 'clean' });

    // ── FD-05 registration & guarantee gates ────────────────────────────────
    ci = await call('POST', `/frontdesk/reservations/${A._id}/check-in`, R, {});
    const codes = (ci.details || []).flatMap((d) => d.reasons.map((x) => x.code));
    check('FD-03 missing guarantee and registration block entry', ci.status === 409 && codes.includes('guarantee') && codes.includes('registration'), JSON.stringify(codes));
    let reg = await call('POST', `/frontdesk/reservations/${A._id}/registration`, R, { firstName: 'בודק', lastName: TAG });
    check('FD-05 invalid registration returns field errors', reg.status === 422 && reg.fields?.dateOfBirth && reg.fields?.idVerified, reg.status);
    const secretNumber = `99${Date.now() % 10000000}`;
    reg = await call('POST', `/frontdesk/reservations/${A._id}/registration`, R, {
      firstName: 'בודק', lastName: TAG, dateOfBirth: '1990-05-01', nationality: 'IL', idDocType: 'id_card', idDocNumber: secretNumber, idVerified: true,
    });
    check('FD-05 registration saved', reg.status === 200 && reg.data?.idVerified === true, JSON.stringify(reg).slice(0, 200));
    const leaked = await AuditLog.countDocuments({ $or: [{ after: { $regex: secretNumber } }, { 'after.idDocNumber': { $exists: true } }] }).catch(() => 0);
    const auditRow = await AuditLog.findOne({ action: 'registration.saved', entityId: reg.data?.id }).lean();
    check('FD-05 audit entry has no ID number', auditRow && !JSON.stringify(auditRow).includes(secretNumber) && leaked === 0);
    const guestAfter = await GuestProfile.findById(guest._id).lean();
    check('FD-05 marketing consent stays off unless chosen', guestAfter.marketingConsent !== true);

    ci = await call('POST', `/frontdesk/reservations/${A._id}/check-in`, R, { guarantee: { method: 'company_guarantee' } });
    check('FIN-03 company guarantee without a company is refused', ci.status === 422, ci.status);
    ci = await call('POST', `/frontdesk/reservations/${A._id}/check-in`, R, { guarantee: { method: 'voucher' } });
    check('FIN-03 a voucher needs its number (no self-declared guarantee)', ci.status === 422 && ci.fields?.guaranteeReference, ci.status);

    // Legacy endpoint must apply the same gates: dirty room → refused, not forced in.
    await setRoom(room1.id, { cleanStatus: 'dirty' });
    const legacy = await call('POST', `/reservations/${A._id}/check-in`, R, { guarantee: { method: 'credit_card', reference: '4242' } });
    check('Legacy /reservations/:id/check-in obeys readiness (dirty room → 409)', legacy.status === 409, legacy.status);
    await setRoom(room1.id, { cleanStatus: 'clean' });

    // Two desks press "check in" at the same moment: exactly one wins.
    const [c1, c2] = await Promise.all([
      call('POST', `/frontdesk/reservations/${A._id}/check-in`, R, { guarantee: { method: 'credit_card', reference: '4242' } }),
      call('POST', `/frontdesk/reservations/${A._id}/check-in`, M, { guarantee: { method: 'credit_card', reference: '4242' } }),
    ]);
    ci = c1.status === 200 ? c1 : c2;
    check('Concurrent check-ins: one succeeds, the other gets 409', [c1.status, c2.status].sort().join() === '200,409', `${c1.status}/${c2.status}`);
    const lodgingAtEntry = (await Folio.find({ reservation: A._id }).lean()).flatMap((f) => f.lines).filter((l) => l.department === 'rooms').length;
    check('Check-in no longer pre-posts lodging (day close / checkout post nights)', lodgingAtEntry === 0, lodgingAtEntry);
    check('FD-03 single-room check-in succeeds when ready', ci.status === 200 && ci.data?.status === 'in_house', JSON.stringify(ci).slice(0, 300));
    check('INT-04 key result is reported separately (no provider)', ci.data?.key?.status === 'not_connected');
    const aAfter = await Reservation.findById(A._id).lean();
    const r1After = await Room.findById(room1.id).lean();
    const aUnits = await ReservationRoom.find({ reservation: A._id }).lean();
    check('FD-03 reservation, unit and room updated', aAfter.status === 'in_house' && aUnits.length === 1 && aUnits[0].status === 'in_house' && r1After.occStatus === 'occupied');
    ci = await call('POST', `/frontdesk/reservations/${A._id}/check-in`, R, { guarantee: { method: 'credit_card', reference: '4242' } });
    check('FD-03 repeating the check-in does not enter twice', ci.status === 409, ci.status);

    // ── T03: two rooms, only one ready → partial entry, other one queued ─────
    // Reuse B's dates: make B a two-unit stay with room3 (ready) and room2 (dirty).
    await Reservation.updateOne({ _id: B._id }, { $set: { roomsCount: 2, assignedRoom: room3.id } });
    await setRoom(room2.id, { cleanStatus: 'dirty' });
    const b0 = await call('GET', `/frontdesk/reservations/${B._id}/check-in?propertyId=${P}`, R); // read-only, implicit unit
    check('FD-03 context shows one implicit unit per booked room before records exist', b0.status === 200 && b0.data?.units?.length === 2);
    // Materialise the two units (first write), then assign the second unit.
    as = await call('POST', `/frontdesk/reservations/${B._id}/assign-room`, R, { roomId: room3.id });
    const units = await ReservationRoom.find({ reservation: B._id }).sort({ createdAt: 1, _id: 1 }).lean();
    check('Units materialised from roomsCount on first write', units.length === 2, units.length);
    as = await call('POST', `/frontdesk/reservations/${B._id}/assign-room`, R, { unitId: String(units[1]._id), roomId: room2.id });
    check('INV-02 second unit assigned to a different room', as.status === 200, JSON.stringify(as).slice(0, 200));
    as = await call('POST', `/frontdesk/reservations/${B._id}/assign-room`, R, { unitId: String(units[1]._id), roomId: room3.id, reason: 'כפילות' });
    check('INV-02 the same room cannot be given to two units', as.status === 409, as.status);

    await call('POST', `/frontdesk/reservations/${B._id}/registration`, R, {
      firstName: 'בודק', lastName: TAG, dateOfBirth: '1990-05-01', nationality: 'IL', idDocType: 'passport', idDocNumber: 'P1234567', idVerified: true,
    });
    list = await call('GET', `/frontdesk/arrivals?propertyId=${P}&q=${encodeURIComponent(B.confirmationNumber)}`, R);
    const bRows = list.data?.rows || [];
    check('FD-02 a two-room reservation shows two rows', bRows.length === 2 && bRows.every((x) => x.unitsTotal === 2), bRows.length);

    ci = await call('POST', `/frontdesk/reservations/${B._id}/check-in`, R, { unitIds: [String(units[0]._id)], guarantee: { method: 'credit_card', reference: '4242' } });
    const bAfter = await Reservation.findById(B._id).lean();
    check('T03 ready unit enters alone; reservation is partially checked in', ci.status === 200 && bAfter.status === 'partially_checked_in' && ci.data?.remainingUnits === 1, JSON.stringify(ci).slice(0, 300));

    // ── FD-04 queue ─────────────────────────────────────────────────────────
    let q = await call('POST', '/frontdesk/queue', R, { propertyId: P, reservationId: String(B._id), unitId: String(units[1]._id), reason: 'cleaning', priority: 'urgent' });
    check('FD-04 receptionist cannot set urgent priority', q.status === 422 && q.fields?.priority, q.status);
    q = await call('POST', '/frontdesk/queue', R, { propertyId: P, reservationId: String(B._id), unitId: String(units[1]._id), reason: 'cleaning', arrivedAt: '2000-01-01T00:00:00Z' });
    check('FD-04 unit added to the queue', q.status === 200 && q.data?.id, JSON.stringify(q).slice(0, 200));
    const entry = await ArrivalQueueEntry.findById(q.data.id).lean();
    check('FD-04 arrival time is server time, not client-supplied', entry && new Date(entry.arrivedAt).getUTCFullYear() > 2020);
    const dup = await call('POST', '/frontdesk/queue', R, { propertyId: P, reservationId: String(B._id), unitId: String(units[1]._id), reason: 'cleaning' });
    check('FD-04 the same unit cannot be queued twice', dup.status === 409, dup.status);
    const bResAfterQueue = await Reservation.findById(B._id).lean();
    check('FD-04 queueing does not change the reservation', bResAfterQueue.status === 'partially_checked_in');

    let ql = await call('GET', `/frontdesk/queue?propertyId=${P}`, H);
    const hkJson = JSON.stringify(ql.data || {});
    check('Housekeeping queue view has no guarantee/blacklist/notes', !hkJson.includes('guarantee') && !hkJson.includes('blacklist') && !hkJson.includes('"notes"'));
    const qRow = ql.data?.rows?.find((x) => x.id === q.data.id);
    if (!qRow) console.log('queue list response:', JSON.stringify(ql).slice(0, 600));
    check('FD-04 housekeeping can read the queue with live readiness', ql.status === 200 && qRow?.readiness?.state === 'queued', JSON.stringify(qRow?.readiness));
    const take1 = await call('POST', `/frontdesk/queue/${q.data.id}/take`, M, { propertyId: P, version: qRow.version });
    const stale = await call('POST', `/frontdesk/queue/${q.data.id}/take`, R, { propertyId: P, version: qRow.version });
    check('FD-04 take ownership is atomic; a stale version gets a conflict', take1.status === 200 && stale.status === 409, `${take1.status}/${stale.status}`);
    const pr = await call('POST', `/frontdesk/queue/${q.data.id}/prioritize`, R, { propertyId: P });
    if (pr.data?.taskId) created.tasks.push(pr.data.taskId);
    const task = pr.data?.taskId ? await HousekeepingTask.findById(pr.data.taskId).lean() : null;
    const r2Mid = await Room.findById(room2.id).lean();
    check('FD-04-A02 housekeeping priority raised without marking the room ready', pr.status === 200 && task?.priority === 'urgent' && r2Mid.cleanStatus === 'dirty');

    // Room gets cleaned → the queued unit can enter; the queue entry is resolved.
    await setRoom(room2.id, { cleanStatus: 'clean' });
    ci = await call('POST', `/frontdesk/reservations/${B._id}/check-in`, R, { unitIds: [String(units[1]._id)] });
    const bFinal = await Reservation.findById(B._id).lean();
    const entryFinal = await ArrivalQueueEntry.findById(q.data.id).lean();
    check('T03 second unit enters later; reservation becomes in-house; queue resolved', ci.status === 200 && bFinal.status === 'in_house' && entryFinal.status === 'checked_in', JSON.stringify(ci).slice(0, 200));

    // Removal needs a reason and never cancels the reservation.
    const C = await mkRes();
    await call('POST', `/frontdesk/reservations/${C._id}/assign-room`, R, { roomId: room1.id }).catch(() => null); // room1 is occupied by A for tonight → conflict expected
    const qc = await call('POST', '/frontdesk/queue', R, { propertyId: P, reservationId: String(C._id), reason: 'assignment' });
    const qcRow = (await call('GET', `/frontdesk/queue?propertyId=${P}`, R)).data?.rows?.find((x) => x.id === qc.data?.id);
    let rm = await call('POST', `/frontdesk/queue/${qc.data?.id}/remove`, R, { propertyId: P, reason: '', version: qcRow?.version });
    check('FD-04 removal requires a reason', rm.status === 422, rm.status);
    rm = await call('POST', `/frontdesk/queue/${qc.data?.id}/remove`, R, { propertyId: P, reason: 'האורח יצא ויחזור בערב' });
    check('FD-04 removal without a version is refused', rm.status === 422, rm.status);
    rm = await call('POST', `/frontdesk/queue/${qc.data?.id}/remove`, R, { propertyId: P, reason: 'האורח יצא ויחזור בערב', version: qcRow?.version });
    const cAfter = await Reservation.findById(C._id).lean();
    check('FD-04 removal keeps the reservation confirmed', rm.status === 200 && cAfter.status === 'confirmed', rm.status);

    // ── RSV-07 guard rails from arrivals ────────────────────────────────────
    const ns = await call('POST', `/frontdesk/reservations/${B._id}/no-show`, R, { propertyId: P });
    check('RSV-07 no-show is refused for a multi-room reservation', ns.status === 409, ns.status);
    const D = await mkRes({ arrivalDate: tomorrow, departureDate: addDays(today, 2) });
    const ns2 = await call('POST', `/frontdesk/reservations/${D._id}/no-show`, R, { propertyId: P });
    check('RSV-07 no-show is refused before the arrival day', ns2.status === 409, ns2.status);

    const early = await call('POST', `/frontdesk/reservations/${D._id}/check-in`, M, { guarantee: { method: 'credit_card', reference: '4242' }, override: { enabled: true, reason: 'ניסיון' } });
    check('A stay for another day cannot be overridden in (dates must change)', early.status === 409 && JSON.stringify(early.details || []).includes('early'), early.status);
    const hkArr = await call('GET', `/frontdesk/arrivals?propertyId=${P}&q=${encodeURIComponent(TAG)}`, token(await userWithRole('housekeeping_manager')));
    check('Housekeeping manager arrivals rows carry no guarantee or special requests', hkArr.status === 200 && !JSON.stringify(hkArr.data.rows).includes('guarantee') && !JSON.stringify(hkArr.data.rows).includes('specialRequests'), hkArr.status);
    const hkCi = await call('POST', `/frontdesk/reservations/${C._id}/check-in`, H, {});
    check('RBAC: housekeeper cannot check guests in', hkCi.status === 403, hkCi.status);
  } finally {
    const resIds = created.reservations;
    const queueIds = (await ArrivalQueueEntry.find({ reservation: { $in: resIds } }).select('_id').lean()).map((x) => x._id);
    const cardIds = (await GuestRegistrationCard.find({ reservation: { $in: resIds } }).select('_id').lean()).map((x) => x._id);
    // Registration cards are delete-protected by a model hook; test fixtures are removed at collection level.
    await GuestRegistrationCard.collection.deleteMany({ _id: { $in: cardIds } });
    await ArrivalQueueEntry.deleteMany({ _id: { $in: queueIds } });
    await HousekeepingTask.deleteMany({ $or: [{ _id: { $in: created.tasks } }, { reservation: { $in: resIds } }] });
    await ReservationRoom.deleteMany({ reservation: { $in: resIds } });
    await Folio.deleteMany({ reservation: { $in: resIds } });
    await AuditLog.deleteMany({ $or: [{ entityId: { $in: [...resIds, ...queueIds, ...cardIds, ...created.tasks.map((t) => new mongoose.Types.ObjectId(t))] } }] });
    await Reservation.deleteMany({ _id: { $in: resIds } });
    await GuestProfile.deleteMany({ _id: { $in: created.guests } });
    await User.deleteMany({ _id: { $in: created.users } });
    await Room.deleteMany({ _id: { $in: created.rooms } });
    for (const [id, snap] of roomSnapshots) await Room.updateOne({ _id: id }, { $set: snap });
    await Property.updateOne({ _id: property._id }, policyBefore ? { $set: { checkInPolicy: policyBefore } } : { $unset: { checkInPolicy: 1 } });
    await mongoose.disconnect();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
