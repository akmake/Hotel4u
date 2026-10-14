#!/usr/bin/env node
/* eslint-disable no-console */
// Operations integration suite (W11: OPS-01 planning, OPS-02 personal tasks, OPS-03 room status,
// OPS-04 inspection, OPS-05 lost & found, OPS-06 maintenance). Runs against a live PMS server and
// the same DB; creates its own rooms/users/stays and removes everything it created.
//
//   node scripts/opsIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import LostItem from '../models/LostItem.js';
import AuditLog from '../models/AuditLog.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || 'hotel4u_dev_secret_change_in_prod';
const TAG = `OPS${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const property = await Property.findOne({ active: { $ne: false } }).sort({ createdAt: 1 });
  const P = String(property._id);
  const today = todayYmdInTimezone(property.timezone || 'Asia/Jerusalem');
  const startedAt = new Date();
  const created = { res: [], guests: [], users: [], rooms: [] };
  let generatedIds = [];

  const mkUser = async (role, n = '') => {
    const u = await User.create({ property: P, firstName: 'בדיקה', lastName: `${role}${n}`, email: `${TAG.toLowerCase()}-${role}${n}@test.local`, passwordHash: 'x', role, active: true });
    created.users.push(u._id);
    return u;
  };

  try {
    const uM = await mkUser('property_admin');
    const uR = await mkUser('receptionist');
    const uH1 = await mkUser('housekeeper', 1);
    const uH2 = await mkUser('housekeeper', 2);
    const uHM = await mkUser('housekeeping_manager');
    const uT1 = await mkUser('technician', 1);
    const uT2 = await mkUser('technician', 2);
    const [M, R, H1, H2, HM, T1, T2] = [uM, uR, uH1, uH2, uHM, uT1, uT2].map(tok);
    const roomType = await RoomType.findOne({ property: P, active: { $ne: false } }).sort({ sortOrder: 1 });
    const mkRoom = async (i, extra = {}) => {
      const r = await Room.create({ property: P, roomType: roomType._id, number: `${TAG}-${i}`, floor: 97, cleanStatus: 'dirty', opsStatus: 'available', occStatus: 'vacant', ...extra });
      created.rooms.push(r._id);
      return r;
    };
    const guest = await GuestProfile.create({ property: P, firstName: 'אורח', lastName: `סודי${TAG}` });
    created.guests.push(guest._id);

    // A room whose guest leaves today but has not checked out yet.
    const occRoom = await mkRoom('occ', { occStatus: 'occupied' });
    const stay = await Reservation.create({
      property: P, confirmationNumber: `${TAG}-1`, status: 'in_house', primaryGuest: guest._id, adults: 1,
      arrivalDate: addDays(today, -1), departureDate: today, nights: 1, roomsCount: 1, roomType: roomType._id,
      ratePerNight: 400, totalAmount: 400, assignedRoom: occRoom._id, checkedInAt: new Date(),
    });
    created.res.push(stay._id);
    await ReservationRoom.create({ reservation: stay._id, property: P, roomTypeBooked: roomType._id, assignedRoom: occRoom._id, arrivalDate: stay.arrivalDate, departureDate: today, nightlyRate: 400, status: 'in_house' });

    // ── RBAC ───────────────────────────────────────────────────────────────
    let r = await call('GET', `/ops/board?propertyId=${P}`, H1);
    check('RBAC: housekeeper cannot open the planning board', r.status === 403, r.status);
    r = await call('POST', '/ops/tasks/generate', R, { propertyId: P });
    check('RBAC: receptionist cannot generate housekeeping work', r.status === 403, r.status);
    r = await call('GET', `/ops/inspections?propertyId=${P}`, T1);
    check('RBAC: technician cannot inspect rooms', r.status === 403, r.status);

    // ── OPS-01 generate + board ─────────────────────────────────────────────
    const before = new Set((await HousekeepingTask.find({ property: P, date: today }).select('_id').lean()).map((t) => String(t._id)));
    const g1 = await call('POST', '/ops/tasks/generate', HM, { propertyId: P });
    const g2 = await call('POST', '/ops/tasks/generate', HM, { propertyId: P });
    generatedIds = (await HousekeepingTask.find({ property: P, date: today, createdAt: { $gte: startedAt } }).select('_id room').lean()).filter((t) => !before.has(String(t._id))).map((t) => t._id);
    const occTask = await HousekeepingTask.findOne({ room: occRoom._id, date: today, status: { $ne: 'cancelled' } }).lean();
    check('OPS-01 generate creates a checkout clean for a room leaving today', g1.status === 200 && occTask?.type === 'checkout_clean', JSON.stringify(g1).slice(0, 120));
    check('OPS-01 generate is idempotent (second run creates nothing)', g2.status === 200 && g2.data.created === 0, g2.data?.created);
    r = await call('GET', `/ops/board?propertyId=${P}&floor=97`, HM);
    const occRow = r.data?.rooms?.find((x) => x.id === String(occRoom._id));
    check('OPS-01 board shows occupancy derived from the stay (due out)', r.status === 200 && occRow?.occupancy?.code === 'due_out', occRow?.occupancy?.code);
    check('OPS-01 board does not expose guest identity', r.status === 200 && !JSON.stringify(r.data).includes(`סודי${TAG}`));

    // ── OPS-02: the guest is still in the room ──────────────────────────────
    r = await call('POST', '/ops/tasks/assign', HM, { propertyId: P, taskIds: [String(occTask._id)], assigneeId: String(uH1._id) });
    check('OPS-01 assign a task to a housekeeper', r.status === 200 && r.data.assigned === 1, JSON.stringify(r).slice(0, 150));
    r = await call('POST', `/ops/tasks/${occTask._id}/start`, H1, { propertyId: P });
    check('OPS-02 checkout clean cannot start while the guest is still in the room', r.status === 409 && r.code === 'guest_in_room', r.status);

    // ── OPS-02 full flow on a vacant room ───────────────────────────────────
    const room1 = await mkRoom('1');
    r = await call('POST', '/ops/tasks', HM, { propertyId: P, roomId: String(room1._id), type: 'checkout_clean', assigneeId: String(uH1._id) });
    const t1 = r.data?.id;
    check('OPS-01 create a task for a room', r.status === 200 && t1, r.error);
    r = await call('POST', '/ops/tasks', HM, { propertyId: P, roomId: String(room1._id), type: 'checkout_clean' });
    check('OPS-01 duplicate open task for the same room/type/day is refused', r.status === 409, r.status);
    r = await call('POST', `/ops/tasks/${t1}/start`, H2, { propertyId: P });
    check('OPS-02 a housekeeper cannot start someone else\'s task', r.status === 403, r.status);
    await call('POST', `/ops/tasks/${t1}/dnd`, H1, { propertyId: P, on: true });
    r = await call('POST', `/ops/tasks/${t1}/start`, H1, { propertyId: P });
    check('OPS-02 DND blocks starting the task (no automatic override)', r.status === 409, r.status);
    await call('POST', `/ops/tasks/${t1}/dnd`, H1, { propertyId: P, on: false });
    r = await call('POST', `/ops/tasks/${t1}/start`, H1, { propertyId: P });
    const startedRoom = await Room.findById(room1._id).lean();
    check('OPS-02 start moves the room to "cleaning" without touching occupancy', r.status === 200 && startedRoom.cleanStatus === 'cleaning' && startedRoom.occStatus === 'vacant', startedRoom.cleanStatus);
    r = await call('POST', `/ops/tasks/${t1}/start`, H1, { propertyId: P });
    check('OPS-02 starting twice is refused (no double work)', r.status === 409, r.status);
    let mine = await call('GET', `/ops/my-tasks?propertyId=${P}`, H1);
    const myTask = mine.data?.tasks?.find((x) => x.id === t1);
    check('OPS-02 personal list shows the task with its checklist', mine.status === 200 && myTask?.checklist?.length > 0, mine.status);
    r = await call('POST', `/ops/tasks/${t1}/complete`, H1, { propertyId: P, checklist: [] });
    check('OPS-02 finishing with an incomplete checklist is refused', r.status === 422, r.status);
    r = await call('POST', `/ops/tasks/${t1}/complete`, H1, { propertyId: P, checklist: myTask.checklist.map((c) => ({ item: c.item, done: true })) });
    const doneRoom = await Room.findById(room1._id).lean();
    check('OPS-02 finishing makes the room clean — not inspected', r.status === 200 && doneRoom.cleanStatus === 'clean', doneRoom.cleanStatus);

    // ── OPS-04 inspection ───────────────────────────────────────────────────
    let iq = await call('GET', `/ops/inspections?propertyId=${P}`, HM);
    const insRow = iq.data?.rows?.find((x) => x.id === t1);
    check('OPS-04 finished task appears in the inspection queue', iq.status === 200 && !!insRow, iq.status);
    const allItems = (iq.data?.checklist || []).map((item) => ({ item, done: true }));
    const blocker = await MaintenanceTicket.create({ property: P, room: room1._id, category: 'water', description: `${TAG} נזילה`, priority: 'high', status: 'new', blocksRoom: true, guestImpact: 'block' });
    r = await call('POST', `/ops/tasks/${t1}/inspect`, HM, { propertyId: P, decision: 'approve', checklist: allItems });
    check('OPS-04 approval is refused while a blocking ticket is open (T04)', r.status === 409, r.status);
    await MaintenanceTicket.deleteOne({ _id: blocker._id });
    r = await call('POST', `/ops/tasks/${t1}/inspect`, HM, { propertyId: P, decision: 'return' });
    check('OPS-04 return to cleaning requires a note', r.status === 422, r.status);
    r = await call('POST', `/ops/tasks/${t1}/inspect`, HM, { propertyId: P, decision: 'return', note: 'כתם על השטיח' });
    const returned = await HousekeepingTask.findById(t1).lean();
    check('OPS-04 return sends the task back and the room to dirty', r.status === 200 && returned.status === 'failed_inspection' && (await Room.findById(room1._id).lean()).cleanStatus === 'dirty');
    await call('POST', `/ops/tasks/${t1}/start`, H1, { propertyId: P });
    await call('POST', `/ops/tasks/${t1}/complete`, H1, { propertyId: P, checklist: myTask.checklist.map((c) => ({ item: c.item, done: true })) });
    r = await call('POST', `/ops/tasks/${t1}/inspect`, HM, { propertyId: P, decision: 'approve', checklist: allItems });
    const insRoom = await Room.findById(room1._id).lean();
    check('OPS-04 approval marks the room inspected', r.status === 200 && insRoom.cleanStatus === 'inspected', r.error || insRoom.cleanStatus);

    // Separation of duties: the supervisor cleaned this one themselves.
    const room2 = await mkRoom('2');
    r = await call('POST', '/ops/tasks', HM, { propertyId: P, roomId: String(room2._id), type: 'deep_clean', assigneeId: String(uHM._id) });
    const t2 = r.data?.id;
    await call('POST', `/ops/tasks/${t2}/start`, HM, { propertyId: P });
    mine = await call('GET', `/ops/my-tasks?propertyId=${P}`, HM);
    const t2items = mine.data.tasks.find((x) => x.id === t2).checklist.map((c) => ({ item: c.item, done: true }));
    await call('POST', `/ops/tasks/${t2}/complete`, HM, { propertyId: P, checklist: t2items });
    r = await call('POST', `/ops/tasks/${t2}/inspect`, HM, { propertyId: P, decision: 'approve', checklist: allItems });
    check('OPS-04 the cleaner cannot inspect their own room (separation of duties)', r.status === 403, r.status);
    r = await call('POST', `/ops/tasks/${t2}/inspect`, M, { propertyId: P, decision: 'block', note: 'שבר בכיור', checklist: allItems });
    const blockedRoom = await Room.findById(room2._id).lean();
    const blockTicket = await MaintenanceTicket.findOne({ room: room2._id }).lean();
    check('OPS-04 "block" opens a blocking ticket and holds the room', r.status === 200 && blockedRoom.opsStatus !== 'available' && blockTicket?.blocksRoom === true, blockedRoom.opsStatus);

    // ── Cancel a task: cleanliness untouched ────────────────────────────────
    const room3 = await mkRoom('3');
    r = await call('POST', '/ops/tasks', HM, { propertyId: P, roomId: String(room3._id), type: 'pickup' });
    const t3 = r.data?.id;
    r = await call('POST', `/ops/tasks/${t3}/cancel`, HM, { propertyId: P });
    check('OPS-01 cancelling a task requires a reason', r.status === 422, r.status);
    r = await call('POST', `/ops/tasks/${t3}/cancel`, HM, { propertyId: P, reason: 'האורח ויתר' });
    check('OPS-01 cancelling leaves the room dirty', r.status === 200 && (await Room.findById(room3._id).lean()).cleanStatus === 'dirty');

    // ── OPS-03 manual status ────────────────────────────────────────────────
    let rs = await call('GET', `/ops/rooms?propertyId=${P}&floor=97`, R);
    const r3 = rs.data?.rows?.find((x) => x.id === String(room3._id));
    check('OPS-03 room status list for the desk', rs.status === 200 && r3?.cleanStatus === 'dirty' && !!r3.version, rs.status);
    r = await call('POST', `/ops/rooms/${room3._id}/clean-status`, HM, { propertyId: P, cleanStatus: 'inspected', reason: 'בדיקה' });
    check('OPS-03 "inspected" cannot be set by hand (only via OPS-04)', r.status === 422, r.status);
    r = await call('POST', `/ops/rooms/${room3._id}/clean-status`, R, { propertyId: P, cleanStatus: 'clean', reason: 'נוקה' });
    check('OPS-03 receptionist cannot mark a room clean by hand', r.status === 403, r.status);
    r = await call('POST', `/ops/rooms/${room3._id}/clean-status`, HM, { propertyId: P, cleanStatus: 'clean' });
    check('OPS-03 manual change requires a reason', r.status === 422, r.status);
    r = await call('POST', `/ops/rooms/${room3._id}/clean-status`, HM, { propertyId: P, cleanStatus: 'clean', reason: 'נוקה ללא משימה', version: r3.version });
    check('OPS-03 manager marks clean with the current version', r.status === 200, r.error);
    r = await call('POST', `/ops/rooms/${room3._id}/clean-status`, HM, { propertyId: P, cleanStatus: 'dirty', reason: 'שוב', version: r3.version });
    check('OPS-03 a stale version is refused (parallel update)', r.status === 409 && r.code === 'version_conflict', r.status);

    // ── OPS-06 maintenance ──────────────────────────────────────────────────
    const room4 = await mkRoom('4', { cleanStatus: 'clean' });
    r = await call('POST', '/ops/tickets', H1, { propertyId: P, roomId: String(room4._id), category: 'hvac' });
    check('OPS-06 ticket without a description is refused (field error)', r.status === 422 && r.fields?.description, r.status);
    r = await call('POST', '/ops/tickets', H1, { propertyId: P, roomId: String(room4._id), category: 'hvac', priority: 'high', guestImpact: 'block', description: 'המזגן לא מקרר' });
    const k1 = r.data?.id;
    check('OPS-06 housekeeper reports a blocking fault; the room goes out of order', r.status === 200 && (await Room.findById(room4._id).lean()).opsStatus === 'out_of_order', r.error);
    r = await call('POST', `/ops/tickets/${k1}/close`, T1, { propertyId: P, note: 'סגירה' });
    check('OPS-06 a ticket cannot be closed before it is resolved', r.status === 409, r.status);
    r = await call('POST', `/ops/tickets/${k1}/take`, T1, { propertyId: P });
    const r2 = await call('POST', `/ops/tickets/${k1}/take`, T2, { propertyId: P });
    check('OPS-06 taking a ticket is atomic (second technician refused)', r.status === 200 && r2.status === 409, `${r.status}/${r2.status}`);
    r = await call('POST', `/ops/tickets/${k1}/resolve`, T1, { propertyId: P });
    check('OPS-06 resolving requires a description of the fix', r.status === 422, r.status);
    r = await call('POST', `/ops/tickets/${k1}/resolve`, T1, { propertyId: P, note: 'הוחלף מדחס' });
    const afterFix = await Room.findById(room4._id).lean();
    check('OPS-06 resolving never makes the room available or clean by itself', r.status === 200 && afterFix.opsStatus === 'out_of_order' && afterFix.cleanStatus === 'clean');
    check('OPS-06 resolving creates a follow-up housekeeping task', !!r.data?.followUpTask && await HousekeepingTask.exists({ _id: r.data.followUpTask }));
    const second = await MaintenanceTicket.create({ property: P, room: room4._id, category: 'lock', description: `${TAG} מנעול`, priority: 'medium', status: 'new', blocksRoom: true, guestImpact: 'block' });
    r = await call('POST', `/ops/rooms/${room4._id}/unblock`, M, { propertyId: P, reason: 'תוקן' });
    check('Unblock is refused while another blocking ticket is open', r.status === 409, r.status);
    await MaintenanceTicket.deleteOne({ _id: second._id });
    r = await call('POST', `/ops/tickets/${k1}/close`, T1, { propertyId: P, note: 'נבדק ותקין' });
    check('OPS-06 close after resolve, with a note', r.status === 200, r.error);
    r = await call('POST', `/ops/tickets/${k1}/reopen`, T1, { propertyId: P });
    check('OPS-06 reopening requires a reason', r.status === 422, r.status);
    r = await call('POST', `/ops/rooms/${room4._id}/unblock`, T1, { propertyId: P, reason: 'תוקן' });
    check('RBAC: technician cannot unblock a room', r.status === 403, r.status);
    r = await call('POST', `/ops/rooms/${room4._id}/unblock`, M, { propertyId: P, reason: 'תוקן ונבדק' });
    check('Manager unblocks the room as a separate decision', r.status === 200 && (await Room.findById(room4._id).lean()).opsStatus === 'available', r.error);
    r = await call('POST', '/ops/tickets', M, { propertyId: P, roomId: String(room4._id), category: 'safety', priority: 'critical', description: 'ניצוץ בשקע' });
    const k2 = r.data?.id;
    await call('POST', `/ops/tickets/${k2}/take`, T1, { propertyId: P });
    await call('POST', `/ops/tickets/${k2}/resolve`, T1, { propertyId: P, note: 'הוחלף שקע' });
    r = await call('POST', `/ops/tickets/${k2}/close`, T1, { propertyId: P, note: 'סגירה' });
    check('OPS-06 closing a dangerous (critical) ticket requires a maintenance manager', r.status === 403, r.status);
    let tl = await call('GET', `/ops/tickets?propertyId=${P}&roomId=${room4._id}&status=all`, R);
    check('OPS-06 front desk can read tickets of a room', tl.status === 200 && tl.data.rows.some((x) => x.id === k2), tl.status);

    // ── OPS-05 lost & found ─────────────────────────────────────────────────
    r = await call('POST', '/ops/lost-items', H1, { propertyId: P, roomId: String(room1._id), description: 'שעון יד' });
    check('OPS-05 storage place is required', r.status === 422 && r.fields?.storage, r.status);
    r = await call('POST', '/ops/lost-items', H1, { propertyId: P, roomId: String(room1._id), description: 'שעון יד', storage: 'כספת קבלה' });
    const li = r.data?.id;
    check('OPS-05 register a found item with a code', r.status === 200 && /^L-\d+/.test(r.data?.code || ''), r.error);
    r = await call('POST', `/ops/lost-items/${li}/release`, R, { propertyId: P, recipientName: 'ישראל ישראלי' });
    check('OPS-05 release requires recorded verification', r.status === 422, r.status);
    r = await call('POST', `/ops/lost-items/${li}/release`, R, { propertyId: P, recipientName: 'ישראל ישראלי', evidence: 'ת״ז נבדקה + תיאור תואם' });
    const r2b = await call('POST', `/ops/lost-items/${li}/release`, R, { propertyId: P, recipientName: 'אחר', evidence: 'ת״ז נבדקה' });
    check('OPS-05 release once; a second claim is refused', r.status === 200 && r2b.status === 409, `${r.status}/${r2b.status}`);
    r = await call('POST', '/ops/lost-items', H1, { propertyId: P, location: 'לובי', description: 'דרכון', category: 'document', storage: 'כספת' });
    r = await call('POST', `/ops/lost-items/${r.data.id}/dispose`, HM, { propertyId: P, method: 'discarded', note: 'סוף תקופה' });
    check('OPS-05 a found ID document cannot be discarded', r.status === 422, r.status);
    const lost = await LostItem.findById(li).lean();
    check('OPS-05 chain of custody recorded (found → returned)', lost.custody.map((c) => c.action).join(',') === 'found,returned');

    // ── Legacy routes pass the same gates ───────────────────────────────────
    const room5 = await mkRoom('5', { cleanStatus: 'clean', opsStatus: 'out_of_order' });
    await MaintenanceTicket.create({ property: P, room: room5._id, category: 'water', description: `${TAG} הצפה`, priority: 'high', status: 'new', blocksRoom: true, guestImpact: 'block' });
    r = await call('PATCH', `/rooms/${room5._id}/clean-status`, M, { propertyId: P, cleanStatus: 'inspected' });
    check('Legacy: "inspected" cannot be set through /rooms either', r.status === 422, r.status);
    r = await call('PATCH', `/rooms/${room5._id}/ops-status`, M, { propertyId: P, opsStatus: 'available', reason: 'בדיקה' });
    check('Legacy: /rooms ops-status refuses unblocking with an open blocking ticket', r.status === 409 && (await Room.findById(room5._id).lean()).opsStatus === 'out_of_order', r.status);
    r = await call('POST', '/housekeeping/generate', M, { propertyId: P });
    const r410 = await call('PATCH', `/maintenance/${k1}/status`, M, { propertyId: P, status: 'closed' });
    check('Legacy housekeeping/maintenance writes are closed (moved to /ops)', r.status === 410 && r410.status === 410, `${r.status}/${r410.status}`);
  } finally {
    const rooms = created.rooms;
    const tasks = await HousekeepingTask.find({ $or: [{ room: { $in: rooms } }, { _id: { $in: generatedIds } }] }).select('_id').lean();
    const tickets = await MaintenanceTicket.find({ room: { $in: rooms } }).select('_id').lean();
    const items = await LostItem.find({ $or: [{ room: { $in: rooms } }, { foundBy: { $in: created.users } }] }).select('_id').lean();
    const ids = [...tasks, ...tickets, ...items].map((x) => x._id).concat(rooms, created.res);
    await AuditLog.deleteMany({ $or: [{ entityId: { $in: ids } }, { actor: { $in: created.users } }] });
    await HousekeepingTask.deleteMany({ _id: { $in: tasks.map((t) => t._id) } });
    await MaintenanceTicket.deleteMany({ _id: { $in: tickets.map((t) => t._id) } });
    await LostItem.deleteMany({ _id: { $in: items.map((t) => t._id) } });
    await ReservationRoom.deleteMany({ reservation: { $in: created.res } });
    await Reservation.deleteMany({ _id: { $in: created.res } });
    await GuestProfile.deleteMany({ _id: { $in: created.guests } });
    await Room.deleteMany({ _id: { $in: rooms } });
    await User.deleteMany({ _id: { $in: created.users } });
    await mongoose.disconnect();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
