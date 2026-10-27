// Housekeeping, room status, inspection, lost & found and maintenance (spec W11: OPS-01…OPS-06).
//
// Rules enforced here (server-side):
//  - occupancy, cleanliness and operational status are separate; nothing here changes occupancy;
//  - a cleaner can start only their own task, once (atomic transition), and not while DND is on;
//  - finishing a task makes the room "clean"; "inspected" only comes from an inspection, by someone
//    other than the cleaner when the policy says so, and never while a blocking ticket is open (T04);
//  - closing a repair never marks a room clean or available — unblocking is its own decision;
//  - every transition is conditional on the state the user saw, so parallel work conflicts loudly.
import mongoose from 'mongoose';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import LostItem from '../models/LostItem.js';
import User from '../models/User.js';
import GuestProfile from '../models/GuestProfile.js';
import { getNextSequenceValue } from '../models/Counter.js';
import { audit } from './auditService.js';
import { fireEvent } from './automationEngine.js';
import { raiseWork } from './platformService.js';
import { httpError, loadProperty, businessDateOf, withLocks, IN_HOUSE_STATUSES } from './frontDeskService.js';

export const HK_MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'housekeeping_manager'];
export const INSPECTOR_ROLES = [...HK_MANAGER_ROLES];
export const MT_MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'maintenance_manager'];
const HK_STAFF_ROLES = ['housekeeper', 'housekeeping_manager'];
const MT_STAFF_ROLES = ['technician', 'maintenance_manager'];
const ACTIVE_TASK = ['new', 'assigned', 'in_progress', 'paused', 'failed_inspection'];
const OPEN_TICKET = ['new', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor', 'reopened'];
const TASK_TYPES = ['checkout_clean', 'stayover', 'deep_clean', 'turndown', 'pickup', 'arrival_prep'];
// Work that ends in an inspection (OPS-04); a stayover or turndown is done when it is done.
const INSPECT_TYPES = ['checkout_clean', 'deep_clean', 'arrival_prep', 'pickup'];
const PAUSE_REASONS = { no_access: 'אין גישה לחדר', dnd: 'האורח ביקש לא להפריע', supplies: 'חסר ציוד', issue: 'תקלה בחדר' };
const MT_CATEGORIES = ['electricity', 'water', 'hvac', 'furniture', 'cleaning', 'safety', 'lock', 'internet', 'tv', 'noise', 'other'];

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const idStr = (v) => (v ? String(v._id || v) : null);
const nameOf = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : null);

function policyOf(property) {
  const p = property?.opsPolicy || {};
  const c = p.checklists || {};
  return {
    inspectorMustDiffer: p.inspectorMustDiffer !== false,
    requireInspection: !!property?.checkInPolicy?.requireInspection,
    checklists: {
      checkout_clean: c.checkout_clean?.length ? c.checkout_clean : ['מצעים הוחלפו', 'חדר רחצה נוקה וחוטא', 'מגבות ומוצרי אירוח הושלמו', 'רצפה נשאבה ונשטפה'],
      stayover: c.stayover?.length ? c.stayover : ['מיטה סודרה', 'מגבות הוחלפו לפי בקשה', 'פח אשפה רוקן'],
      inspection: c.inspection?.length ? c.inspection : ['ניקיון כללי תקין', 'אין ליקוי גלוי בציוד', 'מוצרי אירוח מלאים'],
    },
  };
}

async function loadOpsProperty(propertyId) {
  const property = await loadProperty(propertyId);
  const full = await (await import('../models/Property.js')).default.findById(propertyId).select('opsPolicy checkInPolicy timezone').lean();
  return { ...property, opsPolicy: full?.opsPolicy, checkInPolicy: full?.checkInPolicy };
}

function checklistFor(policy, type) {
  if (type === 'stayover' || type === 'turndown') return policy.checklists.stayover;
  return policy.checklists.checkout_clean;
}

async function loadTask(id, propertyId) {
  if (!isId(String(id || ''))) throw httpError('מזהה משימה לא תקין', 400);
  const task = await HousekeepingTask.findById(id);
  if (!task || String(task.property) !== String(propertyId)) throw httpError('המשימה לא נמצאה', 404);
  return task;
}

async function loadRoom(id, propertyId, session = null) {
  if (!isId(String(id || ''))) throw httpError('מזהה חדר לא תקין', 400);
  const room = await Room.findOne({ _id: id, property: propertyId }).session(session);
  if (!room) throw httpError('החדר לא נמצא', 404);
  return room;
}

async function blockingTickets(roomId) {
  return MaintenanceTicket.find({
    room: roomId,
    status: { $in: OPEN_TICKET },
    $or: [{ blocksRoom: true }, { priority: 'critical' }, { guestImpact: 'block' }],
  }).select('category priority description').lean();
}

// Who is in which room / who arrives: occupancy derived from stays, never edited here.
async function occupancyByRoom(propertyId, roomIds, businessDate) {
  const [stays, units, arrivals, queue] = await Promise.all([
    Reservation.find({ property: propertyId, assignedRoom: { $in: roomIds }, status: { $in: IN_HOUSE_STATUSES } }).select('assignedRoom departureDate').lean(),
    ReservationRoom.find({ property: propertyId, assignedRoom: { $in: roomIds }, status: { $in: ['in_house', 'checked_in', 'reserved', 'tentative'] }, arrivalDate: { $lte: businessDate }, departureDate: { $gte: businessDate } })
      .populate('reservation', 'status eta departureDate arrivalDate').lean(),
    Reservation.find({ property: propertyId, assignedRoom: { $in: roomIds }, arrivalDate: businessDate, status: { $in: ['confirmed', 'modified', 'pending_payment'] } }).select('assignedRoom eta').lean(),
    ArrivalQueueEntry.find({ property: propertyId, room: { $in: roomIds }, status: 'active' }).select('room arrivedAt').lean(),
  ]);
  const map = new Map();
  const get = (k) => { if (!map.has(k)) map.set(k, { inHouse: false, dueOut: false, arrival: null }); return map.get(k); };
  for (const s of stays) {
    const o = get(String(s.assignedRoom));
    o.inHouse = true;
    if (s.departureDate <= businessDate) o.dueOut = true;
  }
  for (const u of units) {
    const k = String(u.assignedRoom);
    const st = u.reservation?.status;
    if (['in_house', 'checked_in'].includes(u.status)) {
      const o = get(k);
      o.inHouse = true;
      if ((u.departureDate || u.reservation?.departureDate) <= businessDate) o.dueOut = true;
    } else if (u.arrivalDate === businessDate && ['confirmed', 'modified', 'pending_payment', 'partially_checked_in'].includes(st)) {
      get(k).arrival = { eta: u.reservation?.eta || null, waiting: false };
    }
  }
  for (const a of arrivals) {
    const o = get(String(a.assignedRoom));
    if (!o.arrival) o.arrival = { eta: a.eta || null, waiting: false };
  }
  for (const q of queue) {
    const o = get(String(q.room));
    o.arrival = { ...(o.arrival || { eta: null }), waiting: true, waitingSince: q.arrivedAt };
  }
  return map;
}

function occLabel(o) {
  if (!o) return { code: 'vacant', label: 'פנוי' };
  if (o.inHouse && o.dueOut) return { code: 'due_out', label: 'עוזב היום' };
  if (o.inHouse) return { code: 'occupied', label: 'תפוס' };
  return { code: 'vacant', label: 'פנוי' };
}

// ── OPS-01 board ────────────────────────────────────────────────────────────
export async function housekeepingBoard({ propertyId, date, floor, zone }) {
  const property = await loadOpsProperty(propertyId);
  const businessDate = businessDateOf(property);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : businessDate;
  const roomFilter = { property: propertyId, active: { $ne: false } };
  if (floor !== undefined && floor !== '' && !Number.isNaN(Number(floor))) roomFilter.floor = Number(floor);
  if (zone) roomFilter.housekeepingZone = String(zone);
  const rooms = await Room.find(roomFilter).populate('roomType', 'name code').sort({ floor: 1, number: 1 }).lean();
  const roomIds = rooms.map((r) => r._id);
  const [tasks, tickets, occ, staff] = await Promise.all([
    HousekeepingTask.find({ property: propertyId, date: day, room: { $in: roomIds }, status: { $ne: 'cancelled' } }).populate('assignedTo', 'firstName lastName').lean(),
    MaintenanceTicket.find({ room: { $in: roomIds }, status: { $in: OPEN_TICKET } }).select('room priority blocksRoom guestImpact category').lean(),
    occupancyByRoom(propertyId, roomIds, day),
    User.find({ property: propertyId, active: { $ne: false }, role: { $in: HK_STAFF_ROLES } }).select('firstName lastName role').sort({ firstName: 1 }).lean(),
  ]);
  const tasksByRoom = new Map();
  for (const t of tasks) {
    const k = String(t.room);
    if (!tasksByRoom.has(k)) tasksByRoom.set(k, []);
    tasksByRoom.get(k).push(t);
  }
  const ticketsByRoom = new Map();
  for (const t of tickets) {
    const k = String(t.room);
    if (!ticketsByRoom.has(k)) ticketsByRoom.set(k, []);
    ticketsByRoom.get(k).push(t);
  }
  const readyClean = property.checkInPolicy?.requireInspection ? ['inspected'] : ['clean', 'inspected'];
  const out = rooms.map((r) => {
    const o = occ.get(String(r._id));
    const rt = tasksByRoom.get(String(r._id)) || [];
    const tk = ticketsByRoom.get(String(r._id)) || [];
    const blocking = tk.some((t) => t.blocksRoom || t.priority === 'critical' || t.guestImpact === 'block');
    const occupancy = occLabel(o);
    return {
      id: String(r._id),
      number: r.number,
      floor: r.floor,
      zone: r.housekeepingZone || null,
      roomType: r.roomType ? { id: String(r.roomType._id), name: r.roomType.name, code: r.roomType.code } : null,
      cleanStatus: r.cleanStatus,
      opsStatus: r.opsStatus,
      occupancy,
      // Minimal arrival info (OPS-01-F05): time and "waiting at the desk" — no guest identity.
      arrival: o?.arrival || null,
      dnd: rt.some((t) => t.isDND),
      serviceDeclined: rt.some((t) => t.isNoService),
      tickets: { open: tk.length, blocking },
      ready: !blocking && r.opsStatus === 'available' && occupancy.code === 'vacant' && readyClean.includes(r.cleanStatus),
      tasks: rt.map((t) => ({
        id: String(t._id), type: t.type, status: t.status, priority: t.priority,
        assignee: t.assignedTo ? { id: String(t.assignedTo._id), name: nameOf(t.assignedTo) } : null,
        startedAt: t.startedAt || null, completedAt: t.completedAt || null, isDND: !!t.isDND, pauseReason: t.pauseReason || null,
        awaitsInspection: t.status === 'completed' && INSPECT_TYPES.includes(t.type),
      })),
    };
  });
  const allTasks = out.flatMap((r) => r.tasks);
  const load = new Map(staff.map((s) => [String(s._id), { id: String(s._id), name: nameOf(s), role: s.role, total: 0, done: 0, active: 0 }]));
  for (const t of allTasks) {
    if (!t.assignee) continue;
    const l = load.get(t.assignee.id);
    if (!l) continue;
    l.total += 1;
    if (['completed', 'inspected'].includes(t.status)) l.done += 1;
    if (t.status === 'in_progress') l.active += 1;
  }
  const floors = [...new Set((await Room.find({ property: propertyId, active: { $ne: false } }).distinct('floor')))].sort((a, b) => a - b);
  const zones = (await Room.find({ property: propertyId, active: { $ne: false }, housekeepingZone: { $nin: [null, ''] } }).distinct('housekeepingZone')).sort();
  return {
    date: day,
    businessDate,
    floors,
    zones,
    counts: {
      rooms: out.length,
      dirty: out.filter((r) => ['dirty', 'pickup'].includes(r.cleanStatus)).length,
      cleaning: out.filter((r) => r.cleanStatus === 'cleaning').length,
      clean: out.filter((r) => r.cleanStatus === 'clean').length,
      inspected: out.filter((r) => r.cleanStatus === 'inspected').length,
      blocked: out.filter((r) => r.opsStatus !== 'available' || r.tickets.blocking).length,
      unassigned: allTasks.filter((t) => !t.assignee && ACTIVE_TASK.includes(t.status)).length,
      awaitingInspection: allTasks.filter((t) => t.status === 'completed' && INSPECT_TYPES.includes(t.type)).length,
      arrivalsWaiting: out.filter((r) => r.arrival?.waiting).length,
    },
    staff: [...load.values()],
    rooms: out,
  };
}

// Generate the day's work from stays (OPS-01-A01), never twice for the same room/type/day.
export async function generateTasks({ propertyId, date, actor, ip }) {
  const property = await loadOpsProperty(propertyId);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : businessDateOf(property);
  const rooms = await Room.find({ property: propertyId, active: { $ne: false } }).select('_id cleanStatus opsStatus').lean();
  const occ = await occupancyByRoom(propertyId, rooms.map((r) => r._id), day);
  const existing = await HousekeepingTask.find({ property: propertyId, date: day, status: { $ne: 'cancelled' } }).select('room type').lean();
  const has = new Set(existing.map((t) => `${t.room}:${t.type}`));
  const toCreate = [];
  for (const r of rooms) {
    const o = occ.get(String(r._id));
    let type = null;
    let priority = 'medium';
    if (o?.inHouse && o.dueOut) { type = 'checkout_clean'; priority = 'high'; }
    else if (o?.inHouse) type = 'stayover';
    else if (['dirty', 'pickup'].includes(r.cleanStatus)) { type = 'checkout_clean'; priority = o?.arrival ? 'high' : 'medium'; }
    if (o?.arrival?.waiting) priority = 'urgent';
    if (!type || has.has(`${r._id}:${type}`)) continue;
    toCreate.push({ property: propertyId, room: r._id, type, priority, date: day, status: 'new', autoCreated: true });
    has.add(`${r._id}:${type}`);
  }
  const created = toCreate.length ? await HousekeepingTask.insertMany(toCreate) : [];
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'housekeeping.generated', entityType: 'Property', entityId: propertyId, after: { date: day, created: created.length }, ip });
  return { date: day, created: created.length };
}

export async function createTask({ propertyId, input, actor, ip }) {
  const property = await loadOpsProperty(propertyId);
  const room = await loadRoom(input.roomId, propertyId);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : businessDateOf(property);
  if (!TASK_TYPES.includes(input.type)) throw httpError('סוג משימה לא מוכר', 422, { fields: { type: 'יש לבחור סוג' } });
  const priority = ['urgent', 'high', 'medium', 'low'].includes(input.priority) ? input.priority : 'medium';
  const dup = await HousekeepingTask.exists({ property: propertyId, room: room._id, date: day, type: input.type, status: { $in: ACTIVE_TASK } });
  if (dup) throw httpError(`כבר קיימת משימה פתוחה מסוג זה לחדר ${room.number} ביום זה`, 409);
  let assignee = null;
  if (input.assigneeId) assignee = await staffMember(propertyId, input.assigneeId, HK_STAFF_ROLES);
  const task = await HousekeepingTask.create({
    property: propertyId, room: room._id, type: input.type, priority, date: day,
    status: assignee ? 'assigned' : 'new', assignedTo: assignee?._id, assignedAt: assignee ? new Date() : undefined,
    notes: input.notes ? String(input.notes).slice(0, 500) : undefined,
  });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'housekeeping.task_created', entityType: 'HousekeepingTask', entityId: task._id, after: { room: room.number, type: task.type, priority }, ip });
  return { id: String(task._id) };
}

async function staffMember(propertyId, userId, roles) {
  if (!isId(String(userId || ''))) throw httpError('יש לבחור עובד', 422, { fields: { assigneeId: 'עובד לא תקין' } });
  const u = await User.findOne({ _id: userId, property: propertyId, active: { $ne: false }, role: { $in: roles } }).select('firstName lastName role').lean();
  if (!u) throw httpError('העובד אינו פעיל בצוות המתאים בנכס', 422, { fields: { assigneeId: 'עובד לא מתאים' } });
  return u;
}

export async function assignTasks({ propertyId, taskIds, assigneeId, actor, ip }) {
  if (!Array.isArray(taskIds) || !taskIds.length) throw httpError('יש לבחור משימות', 422);
  const assignee = assigneeId ? await staffMember(propertyId, assigneeId, HK_STAFF_ROLES) : null;
  const results = [];
  for (const id of taskIds.slice(0, 200)) {
    if (!isId(String(id))) { results.push({ id, ok: false, error: 'מזהה לא תקין' }); continue; }
    // Only tasks nobody is working on may change hands.
    const updated = await HousekeepingTask.findOneAndUpdate(
      { _id: id, property: propertyId, status: { $in: ['new', 'assigned', 'failed_inspection'] } },
      assignee
        ? { $set: { assignedTo: assignee._id, assignedAt: new Date(), status: 'assigned' } }
        : { $set: { status: 'new' }, $unset: { assignedTo: 1, assignedAt: 1 } },
      { returnDocument: 'after' },
    );
    results.push(updated ? { id: String(id), ok: true } : { id: String(id), ok: false, error: 'המשימה בביצוע או הסתיימה' });
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'housekeeping.assigned', entityType: 'HousekeepingTask', entityId: null, after: { assignee: assignee ? nameOf(assignee) : null, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }, ip });
  return { results, assigned: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
}

export async function setTaskPriority({ propertyId, taskId, priority, reason, actor, ip }) {
  if (!['urgent', 'high', 'medium', 'low'].includes(priority)) throw httpError('עדיפות לא מוכרת', 422);
  const why = String(reason || '').trim();
  if (why.length < 3) throw httpError('שינוי עדיפות מחייב סיבה', 422, { fields: { reason: 'יש לפרט סיבה' } });
  const task = await loadTask(taskId, propertyId);
  const before = task.priority;
  task.priority = priority;
  task.notes = [task.notes, `עדיפות: ${why}`].filter(Boolean).join(' · ').slice(0, 2000);
  await task.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'housekeeping.priority', entityType: 'HousekeepingTask', entityId: task._id, before: { priority: before }, after: { priority }, reason: why, ip });
  return { id: String(task._id), priority };
}

// Cancelling work never changes the room's cleanliness (OPS-04-A05) — a dirty room stays dirty.
export async function cancelTask({ propertyId, taskId, reason, actor, ip }) {
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('ביטול משימה מחייב סיבה', 422, { fields: { reason: 'יש לפרט סיבה' } });
  const task = await loadTask(taskId, propertyId);
  const updated = await HousekeepingTask.findOneAndUpdate(
    { _id: task._id, status: { $in: ['new', 'assigned', 'paused', 'failed_inspection', 'completed'] } },
    { $set: { status: 'cancelled', cancelReason: why } },
    { returnDocument: 'after' },
  );
  if (!updated) throw httpError(task.status === 'in_progress' ? 'המשימה בביצוע — יש לעצור אותה קודם' : 'המשימה כבר הסתיימה או בוטלה', 409);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'housekeeping.task_cancelled', entityType: 'HousekeepingTask', entityId: task._id, before: { status: task.status }, reason: why, ip });
  return { id: String(task._id), status: 'cancelled' };
}

// ── OPS-02 personal tasks ───────────────────────────────────────────────────
export async function myTasks({ propertyId, actor, date, all }) {
  const property = await loadOpsProperty(propertyId);
  const policy = policyOf(property);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : businessDateOf(property);
  const filter = { property: propertyId, date: day, status: { $ne: 'cancelled' } };
  if (!(all && HK_MANAGER_ROLES.includes(actor.role))) filter.assignedTo = actor.id;
  const tasks = await HousekeepingTask.find(filter).populate({ path: 'room', select: 'number floor cleanStatus opsStatus roomType', populate: { path: 'roomType', select: 'name' } }).populate('assignedTo', 'firstName lastName').lean();
  const order = { in_progress: 0, paused: 1, failed_inspection: 2, assigned: 3, new: 4, completed: 5, inspected: 6 };
  const prio = { urgent: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || prio[a.priority] - prio[b.priority] || String(a.room?.number).localeCompare(String(b.room?.number), 'he', { numeric: true }));
  return {
    date: day,
    tasks: tasks.map((t) => ({
      id: String(t._id), type: t.type, status: t.status, priority: t.priority,
      room: t.room ? { id: String(t.room._id), number: t.room.number, floor: t.room.floor, type: t.room.roomType?.name, cleanStatus: t.room.cleanStatus, opsStatus: t.room.opsStatus } : null,
      assignee: t.assignedTo ? nameOf(t.assignedTo) : null,
      notes: t.notes || null, returnReason: t.returnReason || null, isDND: !!t.isDND, pauseReason: t.pauseReason || null,
      startedAt: t.startedAt || null, completedAt: t.completedAt || null,
      checklist: (t.checklist?.length ? t.checklist : checklistFor(policy, t.type).map((item) => ({ item, done: false }))),
    })),
  };
}

function assertMayWork(task, actor) {
  if (HK_MANAGER_ROLES.includes(actor.role)) return;
  if (String(task.assignedTo || '') !== String(actor.id)) throw httpError('המשימה משויכת לעובד אחר', 403);
}

export async function startTask({ propertyId, taskId, actor, ip }) {
  const task = await loadTask(taskId, propertyId);
  assertMayWork(task, actor);
  if (task.isDND) throw httpError('האורח ביקש לא להפריע — אין להיכנס עד שהבקשה תוסר', 409);
  if (task.type === 'checkout_clean') {
    const property = await loadOpsProperty(propertyId);
    const occ = (await occupancyByRoom(propertyId, [task.room], businessDateOf(property))).get(String(task.room));
    if (occ?.inHouse) throw httpError('האורח עדיין לא יצא מהחדר — ניקיון עזיבה מתחיל אחרי היציאה', 409, { code: 'guest_in_room' });
  }
  const updated = await HousekeepingTask.findOneAndUpdate(
    { _id: task._id, status: { $in: ['new', 'assigned', 'paused', 'failed_inspection'] } },
    { $set: { status: 'in_progress', startedAt: task.startedAt || new Date(), assignedTo: task.assignedTo || actor.id }, $unset: { pausedAt: 1, pauseReason: 1 } },
    { returnDocument: 'after' },
  );
  if (!updated) throw httpError('המשימה כבר בביצוע או הסתיימה', 409);
  await Room.updateOne({ _id: task.room, cleanStatus: { $in: ['dirty', 'pickup', 'turndown_required', 'clean'] } }, { $set: { cleanStatus: 'cleaning' } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'housekeeping.task_started', entityType: 'HousekeepingTask', entityId: task._id, ip });
  return { id: String(task._id), status: 'in_progress' };
}

export async function pauseTask({ propertyId, taskId, reason, note, actor, ip }) {
  if (!PAUSE_REASONS[reason]) throw httpError('יש לבחור סיבת עצירה', 422, { fields: { reason: 'סיבה נדרשת' } });
  const task = await loadTask(taskId, propertyId);
  assertMayWork(task, actor);
  const updated = await HousekeepingTask.findOneAndUpdate(
    { _id: task._id, status: { $in: ['in_progress', 'assigned', 'new'] } },
    { $set: { status: 'paused', pausedAt: new Date(), pauseReason: `${PAUSE_REASONS[reason]}${note ? ` — ${String(note).slice(0, 200)}` : ''}`, ...(reason === 'dnd' ? { isDND: true } : {}) } },
    { returnDocument: 'after' },
  );
  if (!updated) throw httpError('לא ניתן לעצור משימה במצב הנוכחי', 409);
  // A room left half-done is not clean.
  await Room.updateOne({ _id: task.room, cleanStatus: 'cleaning' }, { $set: { cleanStatus: 'dirty' } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'housekeeping.task_paused', entityType: 'HousekeepingTask', entityId: task._id, reason: PAUSE_REASONS[reason], ip });
  return { id: String(task._id), status: 'paused' };
}

export async function setDnd({ propertyId, taskId, on, actor, ip }) {
  const task = await loadTask(taskId, propertyId);
  task.isDND = !!on;
  await task.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: on ? 'housekeeping.dnd_on' : 'housekeeping.dnd_off', entityType: 'HousekeepingTask', entityId: task._id, ip });
  return { id: String(task._id), isDND: task.isDND };
}

export async function completeTask({ propertyId, taskId, checklist, note, actor, ip }) {
  const property = await loadOpsProperty(propertyId);
  const policy = policyOf(property);
  const task = await loadTask(taskId, propertyId);
  assertMayWork(task, actor);
  const template = checklistFor(policy, task.type);
  const done = new Map((Array.isArray(checklist) ? checklist : []).map((c) => [String(c.item), !!c.done]));
  const results = template.map((item) => ({ item, done: done.get(item) === true }));
  const missing = results.filter((r) => !r.done).map((r) => r.item);
  if (missing.length) throw httpError('יש להשלים את כל רשימת הבדיקה לפני סיום', 422, { details: missing.map((m) => ({ label: m })) });
  const updated = await HousekeepingTask.findOneAndUpdate(
    { _id: task._id, status: 'in_progress' },
    { $set: { status: 'completed', completedAt: new Date(), checklist: results, ...(note ? { notes: [task.notes, String(note).slice(0, 500)].filter(Boolean).join(' · ') } : {}) } },
    { returnDocument: 'after' },
  );
  if (!updated) throw httpError('אפשר לסיים רק משימה שבביצוע — התחילו אותה קודם', 409);
  // Clean — not inspected. A room that just checked out becomes vacant again; occupancy of a stayover is untouched.
  const room = await Room.findById(task.room);
  if (room) {
    if (!['inspected'].includes(room.cleanStatus)) room.cleanStatus = 'clean';
    if (room.occStatus === 'checked_out') room.occStatus = 'vacant';
    await room.save();
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'housekeeping.task_completed', entityType: 'HousekeepingTask', entityId: task._id, after: { room: room?.number, awaitsInspection: policy.requireInspection }, ip });
  fireEvent('housekeeping.completed', { property: String(propertyId), task: updated.toObject(), room: room ? { _id: String(room._id), number: room.number } : null, actor: { id: actor.id, name: actor.name } }).catch(() => null);
  return { id: String(task._id), status: 'completed', awaitsInspection: policy.requireInspection };
}

// ── OPS-04 inspection ───────────────────────────────────────────────────────
export async function inspectionQueue({ propertyId }) {
  const property = await loadOpsProperty(propertyId);
  const policy = policyOf(property);
  const tasks = await HousekeepingTask.find({ property: propertyId, status: 'completed', type: { $in: INSPECT_TYPES } })
    .populate({ path: 'room', select: 'number floor cleanStatus opsStatus roomType', populate: { path: 'roomType', select: 'name' } })
    .populate('assignedTo', 'firstName lastName')
    .sort({ completedAt: 1 })
    .lean();
  const roomIds = tasks.map((t) => t.room?._id).filter(Boolean);
  const [blocking, occ] = await Promise.all([
    MaintenanceTicket.find({ room: { $in: roomIds }, status: { $in: OPEN_TICKET } }).select('room priority blocksRoom guestImpact description').lean(),
    occupancyByRoom(propertyId, roomIds, businessDateOf(property)),
  ]);
  return {
    checklist: policy.checklists.inspection,
    inspectorMustDiffer: policy.inspectorMustDiffer,
    rows: tasks.map((t) => {
      const tk = blocking.filter((b) => String(b.room) === String(t.room?._id));
      return {
        id: String(t._id), type: t.type, completedAt: t.completedAt,
        cleaner: t.assignedTo ? { id: String(t.assignedTo._id), name: nameOf(t.assignedTo) } : null,
        room: t.room ? { id: String(t.room._id), number: t.room.number, floor: t.room.floor, type: t.room.roomType?.name, cleanStatus: t.room.cleanStatus, opsStatus: t.room.opsStatus } : null,
        openTickets: tk.map((x) => ({ priority: x.priority, blocking: !!(x.blocksRoom || x.priority === 'critical' || x.guestImpact === 'block'), description: x.description })),
        arrival: occ.get(String(t.room?._id))?.arrival || null,
      };
    }),
  };
}

export async function inspectTask({ propertyId, taskId, decision, checklist, defects, note, actor, ip }) {
  if (!INSPECTOR_ROLES.includes(actor.role)) throw httpError('בדיקת חדר מותרת למפקח חדרנות או מנהל', 403);
  const property = await loadOpsProperty(propertyId);
  const policy = policyOf(property);
  const task = await loadTask(taskId, propertyId);
  if (task.status !== 'completed') throw httpError('אפשר לבדוק רק חדר שהניקיון שלו הסתיים', 409);
  if (policy.inspectorMustDiffer && String(task.assignedTo || '') === String(actor.id)) throw httpError('הפרדת תפקידים: מי שניקה את החדר אינו יכול לאשר אותו', 403);
  const room = await Room.findById(task.room);
  if (!room) throw httpError('החדר לא נמצא', 404);
  const why = String(note || '').trim().slice(0, 1000);
  const cleanDefects = (Array.isArray(defects) ? defects : []).filter((d) => String(d?.text || '').trim()).slice(0, 20)
    .map((d) => ({ text: String(d.text).trim().slice(0, 300), severity: ['minor', 'major', 'blocking'].includes(d.severity) ? d.severity : 'minor' }));
  const results = policy.checklists.inspection.map((item) => ({ item, done: (Array.isArray(checklist) ? checklist : []).some((c) => c.item === item && c.done) }));

  return withLocks([`room:${room._id}`], async () => {
    if (decision === 'approve') {
      if (results.some((r) => !r.done)) throw httpError('יש לסמן את כל סעיפי הבדיקה כדי לאשר', 422);
      if (cleanDefects.some((d) => d.severity !== 'minor')) throw httpError('יש ליקוי מהותי — יש להחזיר לניקיון או לחסום', 422);
      if (room.opsStatus !== 'available') throw httpError(`החדר חסום תפעולית (${room.opsStatus}) — אישור ניקיון אינו מסיר חסימה`, 409);
      const blocks = await blockingTickets(room._id);
      if (blocks.length) throw httpError(`יש תקלה פתוחה שחוסמת את החדר: ${blocks[0].description}`, 409);
      const updated = await HousekeepingTask.findOneAndUpdate({ _id: task._id, status: 'completed' }, { $set: { status: 'inspected', inspectedBy: actor.id, inspectedAt: new Date(), inspectionNotes: why || undefined, inspectionChecklist: results, defects: cleanDefects } }, { returnDocument: 'after' });
      if (!updated) throw httpError('המשימה עודכנה בינתיים', 409);
      room.cleanStatus = 'inspected';
      if (room.occStatus === 'checked_out') room.occStatus = 'vacant';
      await room.save();
    } else if (decision === 'return') {
      if (why.length < 3) throw httpError('החזרה לניקיון מחייבת הערה', 422, { fields: { note: 'יש לפרט מה לתקן' } });
      const updated = await HousekeepingTask.findOneAndUpdate({ _id: task._id, status: 'completed' }, { $set: { status: 'failed_inspection', returnReason: why, returnedAt: new Date(), returnedBy: actor.id, inspectionChecklist: results, defects: cleanDefects }, $unset: { completedAt: 1 } }, { returnDocument: 'after' });
      if (!updated) throw httpError('המשימה עודכנה בינתיים', 409);
      room.cleanStatus = 'dirty';
      await room.save();
    } else if (decision === 'block') {
      if (why.length < 3) throw httpError('חסימת חדר מחייבת הערה', 422, { fields: { note: 'יש לתאר את הליקוי' } });
      const updated = await HousekeepingTask.findOneAndUpdate({ _id: task._id, status: 'completed' }, { $set: { status: 'failed_inspection', returnReason: `נחסם: ${why}`, returnedAt: new Date(), returnedBy: actor.id, inspectionChecklist: results, defects: cleanDefects } }, { returnDocument: 'after' });
      if (!updated) throw httpError('המשימה עודכנה בינתיים', 409);
      const ticket = await MaintenanceTicket.create({ property: propertyId, room: room._id, category: 'other', description: `ליקוי מבדיקת חדר: ${why}`, priority: 'high', status: 'new', blocksRoom: true, guestImpact: 'block', reportedBy: actor.id });
      room.opsStatus = 'maintenance_hold';
      await room.save();
      await HousekeepingTask.updateOne({ _id: task._id }, { $set: { 'issueReported.description': why, 'issueReported.reportedAt': new Date(), 'issueReported.ticketId': ticket._id } });
    } else {
      throw httpError('החלטה לא מוכרת', 422);
    }
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `housekeeping.inspection_${decision}`, entityType: 'HousekeepingTask', entityId: task._id, after: { room: room.number, defects: cleanDefects.length }, reason: why || undefined, ip });
    return { id: String(task._id), decision, room: { number: room.number, cleanStatus: room.cleanStatus, opsStatus: room.opsStatus } };
  });
}

// ── OPS-03 room status ──────────────────────────────────────────────────────
export async function roomStatusList({ propertyId, floor, clean, q }) {
  const property = await loadOpsProperty(propertyId);
  const businessDate = businessDateOf(property);
  const filter = { property: propertyId, active: { $ne: false } };
  if (floor !== undefined && floor !== '' && !Number.isNaN(Number(floor))) filter.floor = Number(floor);
  if (clean) filter.cleanStatus = clean === 'dirty' ? { $in: ['dirty', 'pickup'] } : clean;
  if (q) filter.number = { $regex: `^${String(q).replace(/[^0-9A-Za-z-]/g, '')}` };
  const rooms = await Room.find(filter).populate('roomType', 'name').sort({ floor: 1, number: 1 }).lean();
  const ids = rooms.map((r) => r._id);
  const [occ, tasks, tickets] = await Promise.all([
    occupancyByRoom(propertyId, ids, businessDate),
    HousekeepingTask.find({ room: { $in: ids }, date: businessDate, status: { $ne: 'cancelled' } }).select('room type status isDND isNoService assignedTo').populate('assignedTo', 'firstName lastName').lean(),
    MaintenanceTicket.find({ room: { $in: ids }, status: { $in: OPEN_TICKET } }).select('room priority blocksRoom guestImpact').lean(),
  ]);
  return {
    businessDate,
    rows: rooms.map((r) => {
      const t = tasks.filter((x) => String(x.room) === String(r._id));
      const tk = tickets.filter((x) => String(x.room) === String(r._id));
      return {
        id: String(r._id), number: r.number, floor: r.floor, roomType: r.roomType?.name || null,
        cleanStatus: r.cleanStatus, opsStatus: r.opsStatus, occupancy: occLabel(occ.get(String(r._id))),
        service: t.some((x) => x.isDND) ? 'dnd' : t.some((x) => x.isNoService) ? 'declined' : 'normal',
        task: t[0] ? { id: String(t[0]._id), type: t[0].type, status: t[0].status, assignee: nameOf(t[0].assignedTo) } : null,
        tickets: { open: tk.length, blocking: tk.some((x) => x.blocksRoom || x.priority === 'critical' || x.guestImpact === 'block') },
        version: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
      };
    }),
  };
}

// Manual cleanliness change: an exception to the task flow, so it needs a reason; "inspected"
// only comes from OPS-04; the user's version must still be current.
export async function setCleanStatus({ propertyId, roomId, cleanStatus, reason, version, actor, ip }) {
  if (!['dirty', 'clean'].includes(cleanStatus)) throw httpError(cleanStatus === 'inspected' ? 'סטטוס "נבדק" נקבע רק בבדיקת חדר' : 'סטטוס ניקיון לא מוכר', 422);
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('שינוי ידני של ניקיון מחייב סיבה', 422, { fields: { reason: 'יש לפרט סיבה' } });
  const room = await loadRoom(roomId, propertyId);
  if (version && room.updatedAt && new Date(room.updatedAt).toISOString() !== String(version)) {
    throw httpError('מצב החדר השתנה בינתיים — רעננו ונסו שוב', 409, { code: 'version_conflict' });
  }
  if (cleanStatus === 'clean' && !HK_MANAGER_ROLES.includes(actor.role)) throw httpError('סימון ידני כנקי מותר למפקח חדרנות או מנהל', 403);
  const before = room.cleanStatus;
  room.cleanStatus = cleanStatus;
  await room.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `room.clean_status.${cleanStatus}`, entityType: 'Room', entityId: room._id, before: { cleanStatus: before }, after: { cleanStatus }, reason: why, ip });
  return { id: String(room._id), cleanStatus, version: new Date(room.updatedAt).toISOString() };
}

// ── OPS-05 lost & found ─────────────────────────────────────────────────────
export async function listLostItems({ propertyId, status, q }) {
  const filter = { property: propertyId };
  if (status && status !== 'all') filter.status = status === 'open' ? { $in: ['found', 'stored'] } : status;
  if (q) filter.$or = [{ description: { $regex: String(q).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { code: String(q).toUpperCase() }];
  const items = await LostItem.find(filter).populate('room', 'number').populate('claimant', 'firstName lastName').sort({ foundAt: -1 }).limit(300).lean();
  const counts = await LostItem.aggregate([{ $match: { property: new mongoose.Types.ObjectId(propertyId) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  return {
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    rows: items.map((i) => ({
      id: String(i._id), code: i.code, description: i.description, category: i.category, room: i.room?.number || null, location: i.location || null,
      foundAt: i.foundAt, foundBy: i.foundByName, storage: i.storage, status: i.status,
      claimant: i.claimant ? nameOf(i.claimant) : null, recipientName: i.recipientName || null, disposal: i.disposal || null,
      custody: (i.custody || []).map((c) => ({ at: c.at, action: c.action, by: c.byName, to: c.toName, storage: c.storage, note: c.note })),
    })),
  };
}

export async function createLostItem({ propertyId, input, actor, ip }) {
  const errors = {};
  const description = String(input.description || '').trim().slice(0, 500);
  const storage = String(input.storage || '').trim().slice(0, 200);
  if (!description) errors.description = 'תיאור נדרש';
  if (!storage) errors.storage = 'מקום האחסון נדרש';
  if (!input.roomId && !String(input.location || '').trim()) errors.location = 'יש לציין חדר או מקום';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי המציאה', 422, { fields: errors });
  let room = null;
  if (input.roomId) room = await loadRoom(input.roomId, propertyId);
  const seq = await getNextSequenceValue(`lostitem:${propertyId}`);
  const foundAt = input.foundAt && !Number.isNaN(Date.parse(input.foundAt)) && Date.parse(input.foundAt) <= Date.now() ? new Date(input.foundAt) : new Date();
  const item = await LostItem.create({
    property: propertyId, code: `L-${String(seq).padStart(4, '0')}`, room: room?._id, location: input.location ? String(input.location).slice(0, 200) : undefined,
    foundAt, description, category: ['document', 'electronics', 'jewelry', 'clothing', 'money', 'hazardous', 'other'].includes(input.category) ? input.category : 'other',
    foundBy: actor.id, foundByName: actor.name, storage, status: 'stored', task: isId(String(input.taskId || '')) ? input.taskId : undefined,
    custody: [{ action: 'found', by: actor.id, byName: actor.name, storage, note: input.note ? String(input.note).slice(0, 300) : undefined }],
  });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'lost_item.found', entityType: 'LostItem', entityId: item._id, after: { code: item.code, category: item.category }, ip });
  return { id: String(item._id), code: item.code };
}

async function loadLostItem(id, propertyId) {
  if (!isId(String(id || ''))) throw httpError('מזהה לא תקין', 400);
  const item = await LostItem.findById(id);
  if (!item || String(item.property) !== String(propertyId)) throw httpError('הפריט לא נמצא', 404);
  return item;
}

export async function transferLostItem({ propertyId, id, storage, toName, note, actor, ip }) {
  const item = await loadLostItem(id, propertyId);
  if (!['found', 'stored'].includes(item.status)) throw httpError('הפריט כבר נמסר או טופל', 409);
  const place = String(storage || '').trim().slice(0, 200);
  if (!place) throw httpError('יש לציין מקום אחסון חדש', 422, { fields: { storage: 'נדרש' } });
  item.storage = place;
  item.custody.push({ action: 'transferred', by: actor.id, byName: actor.name, toName: toName ? String(toName).slice(0, 120) : undefined, storage: place, note: note ? String(note).slice(0, 300) : undefined });
  await item.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'lost_item.transferred', entityType: 'LostItem', entityId: item._id, after: { storage: place }, ip });
  return { id: String(item._id) };
}

export async function releaseLostItem({ propertyId, id, guestId, recipientName, evidence, note, actor, ip }) {
  const item = await loadLostItem(id, propertyId);
  if (!['found', 'stored'].includes(item.status)) throw httpError('הפריט כבר נמסר או טופל', 409);
  const who = String(recipientName || '').trim().slice(0, 120);
  const proof = String(evidence || '').trim().slice(0, 300);
  if (!who) throw httpError('יש לציין למי נמסר', 422, { fields: { recipientName: 'נדרש' } });
  if (proof.length < 3) throw httpError('יש לתעד איך אומת המקבל', 422, { fields: { evidence: 'נדרש' } });
  if (guestId) {
    if (!isId(String(guestId))) throw httpError('אורח לא תקין', 422);
    const g = await GuestProfile.findOne({ _id: guestId, property: propertyId }).select('_id').lean();
    if (!g) throw httpError('האורח לא נמצא בנכס', 422);
    item.claimant = g._id;
  }
  item.status = 'returned';
  item.recipientName = who;
  item.releaseEvidence = proof;
  item.custody.push({ action: 'returned', by: actor.id, byName: actor.name, toName: who, note: note ? String(note).slice(0, 300) : undefined });
  await item.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'lost_item.returned', entityType: 'LostItem', entityId: item._id, after: { code: item.code }, ip });
  return { id: String(item._id) };
}

export async function disposeLostItem({ propertyId, id, method, note, actor, ip }) {
  if (![...HK_MANAGER_ROLES, 'front_desk_manager'].includes(actor.role)) throw httpError('טיפול סופי בפריט מותר למנהל בלבד', 403);
  const item = await loadLostItem(id, propertyId);
  if (!['found', 'stored'].includes(item.status)) throw httpError('הפריט כבר נמסר או טופל', 409);
  if (!['donated', 'discarded', 'police'].includes(method)) throw httpError('יש לבחור אופן טיפול', 422);
  const why = String(note || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('יש לנמק את הטיפול הסופי', 422, { fields: { note: 'נדרש' } });
  if (item.category === 'document' && method !== 'police') throw httpError('מסמך זיהוי שנמצא נמסר למשטרה או לבעליו — לא נתרם ולא מושמד', 422);
  item.status = 'disposed';
  item.disposal = method;
  item.custody.push({ action: 'disposed', by: actor.id, byName: actor.name, note: why });
  await item.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'lost_item.disposed', entityType: 'LostItem', entityId: item._id, after: { method }, reason: why, ip });
  return { id: String(item._id) };
}

// ── OPS-06 maintenance ──────────────────────────────────────────────────────
function ticketDto(t) {
  return {
    id: String(t._id), category: t.category, priority: t.priority, status: t.status, description: t.description,
    room: t.room ? { id: idStr(t.room), number: t.room.number, opsStatus: t.room.opsStatus, cleanStatus: t.room.cleanStatus } : null,
    area: t.areaId || null,
    guestImpact: t.guestImpact || (t.blocksRoom ? 'block' : 'none'),
    blocksRoom: !!t.blocksRoom,
    assignee: t.assignedTo ? { id: idStr(t.assignedTo), name: nameOf(t.assignedTo) } : null,
    reportedBy: t.reportedBy ? nameOf(t.reportedBy) : null,
    vendor: t.vendor || null,
    dueDate: t.dueDate || null, startedAt: t.startedAt || null, resolvedAt: t.resolvedAt || null, closedAt: t.closedAt || null,
    estimatedCost: t.estimatedCost ?? null, actualCost: t.actualCost ?? null,
    notes: (t.internalNotes || []).map((n) => ({ text: n.text, by: n.authorName, at: n.createdAt })),
    parts: (t.partsNeeded || []).map((p) => ({ name: p.name, quantity: p.quantity, ordered: !!p.ordered })),
    photos: (t.photos || []).map((p) => ({ url: p.url, caption: p.caption || null, at: p.uploadedAt || null })),
    reopenReason: t.reopenReason || null, closingNote: t.closingNote || null,
    overdue: !!(t.dueDate && new Date(t.dueDate) < new Date() && OPEN_TICKET.includes(t.status)),
    createdAt: t.createdAt, version: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
  };
}

const TICKET_POPULATE = [
  { path: 'room', select: 'number opsStatus cleanStatus' },
  { path: 'assignedTo', select: 'firstName lastName' },
  { path: 'reportedBy', select: 'firstName lastName' },
];

export async function listTickets({ propertyId, status = 'open', priority, roomId, q, mine, actor }) {
  const filter = { property: propertyId };
  if (status === 'open') filter.status = { $in: OPEN_TICKET };
  else if (status === 'resolved') filter.status = { $in: ['resolved', 'verified'] };
  else if (status === 'closed') filter.status = 'closed';
  // 'all' = no status filter
  if (priority) filter.priority = priority;
  if (roomId && isId(String(roomId))) filter.room = roomId;
  if (mine) filter.assignedTo = actor.id;
  if (q) filter.description = { $regex: String(q).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const prio = { critical: 0, high: 1, medium: 2, low: 3 };
  const rows = (await MaintenanceTicket.find(filter).populate(TICKET_POPULATE).sort({ createdAt: -1 }).limit(300).lean()).map(ticketDto);
  rows.sort((a, b) => prio[a.priority] - prio[b.priority] || (b.overdue - a.overdue) || new Date(b.createdAt) - new Date(a.createdAt));
  const all = await MaintenanceTicket.find({ property: propertyId, status: { $in: OPEN_TICKET } }).select('priority status blocksRoom guestImpact dueDate assignedTo').lean();
  return {
    counts: {
      open: all.length,
      critical: all.filter((t) => t.priority === 'critical').length,
      blocking: all.filter((t) => t.blocksRoom || t.guestImpact === 'block').length,
      unassigned: all.filter((t) => !t.assignedTo).length,
      overdue: all.filter((t) => t.dueDate && new Date(t.dueDate) < new Date()).length,
    },
    rows,
  };
}

async function loadTicket(id, propertyId) {
  if (!isId(String(id || ''))) throw httpError('מזהה תקלה לא תקין', 400);
  const t = await MaintenanceTicket.findById(id);
  if (!t || String(t.property) !== String(propertyId)) throw httpError('התקלה לא נמצאה', 404);
  return t;
}

export async function getTicket({ propertyId, id }) {
  await loadTicket(id, propertyId);
  const t = await MaintenanceTicket.findById(id).populate(TICKET_POPULATE).lean();
  const history = (await (await import('../models/AuditLog.js')).default.find({ entityType: 'MaintenanceTicket', entityId: t._id }).sort({ createdAt: 1 }).select('action actorName createdAt reason').lean())
    .map((h) => ({ action: h.action, by: h.actorName, at: h.createdAt, reason: h.reason || null }));
  return { ...ticketDto(t), history };
}

function defaultDue(priority) {
  const hours = { critical: 2, high: 8, medium: 48, low: 120 }[priority] || 48;
  return new Date(Date.now() + hours * 3600_000);
}

// Block a room for operational reasons. OOO when it must not be sold; OOS keeps it sellable later.
async function blockRoom(room, impact, actor, ip, reason, session = null, afterCommit = null) {
  const before = room.opsStatus;
  room.opsStatus = impact === 'block' ? 'out_of_order' : room.opsStatus;
  await room.save({ session });
  if (before !== room.opsStatus) {
    await audit({ property: room.property, actor: actor.id, actorName: actor.name, action: 'room.ops_status.out_of_order', entityType: 'Room', entityId: room._id, before: { opsStatus: before }, after: { opsStatus: room.opsStatus }, reason, ip, session, afterCommit });
  }
}

export async function createTicket({ propertyId, input, actor, ip, session = null, afterCommit = null }) {
  const errors = {};
  const description = String(input.description || '').trim().slice(0, 2000);
  if (!description) errors.description = 'תיאור נדרש';
  if (!MT_CATEGORIES.includes(input.category)) errors.category = 'יש לבחור קטגוריה';
  if (!input.roomId && !String(input.area || '').trim()) errors.roomId = 'יש לבחור חדר או אזור';
  const priority = ['critical', 'high', 'medium', 'low'].includes(input.priority) ? input.priority : 'medium';
  const impact = ['none', 'block', 'move'].includes(input.guestImpact) ? input.guestImpact : (priority === 'critical' ? 'block' : 'none');
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי התקלה', 422, { fields: errors });
  let room = null;
  if (input.roomId) room = await loadRoom(input.roomId, propertyId, session);
  let assignee = null;
  if (input.assigneeId) assignee = await staffMember(propertyId, input.assigneeId, MT_STAFF_ROLES);
  const due = input.dueDate && !Number.isNaN(Date.parse(input.dueDate)) ? new Date(input.dueDate) : defaultDue(priority);
  const ticket = await new MaintenanceTicket({
    property: propertyId, room: room?._id, areaId: room ? undefined : String(input.area).slice(0, 120), category: input.category, description, priority,
    status: assignee ? 'assigned' : 'new', assignedTo: assignee?._id, reportedBy: actor.id, dueDate: due,
    blocksRoom: impact === 'block', guestImpact: impact,
    internalNotes: [{ text: 'נפתחה', author: actor.id, authorName: actor.name }],
  }).save({ session });
  if (room && impact === 'block') await blockRoom(room, impact, actor, ip, `תקלה: ${description.slice(0, 80)}`, session, afterCommit);
  // Linked from a housekeeping task (OPS-02 → OPS-06): record on the task, readiness unchanged.
  if (isId(String(input.taskId || ''))) {
    await HousekeepingTask.updateOne({ _id: input.taskId, property: propertyId }, { $set: { 'issueReported.description': description.slice(0, 300), 'issueReported.reportedAt': new Date(), 'issueReported.ticketId': ticket._id } }, { session });
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'maintenance.created', entityType: 'MaintenanceTicket', entityId: ticket._id, after: { room: room?.number, category: ticket.category, priority, impact }, ip, session, afterCommit });
  const notify = () => fireEvent('maintenance.created', { property: String(propertyId), ticket: ticket.toObject(), room: room ? { _id: String(room._id) } : null, actor: { id: actor.id, name: actor.name } }).catch(() => null);
  if (session) afterCommit?.push(notify);
  else notify();
  if (priority === 'critical') await raiseWork({ propertyId, kind: 'operations', severity: 'urgent', title: `תקלה מסוכנת${room ? ` בחדר ${room.number}` : ''}: ${description.slice(0, 80)}`, source: { type: 'ticket', id: String(ticket._id), label: room ? `חדר ${room.number}` : (input.area || ''), link: `/pms/maintenance?ticket=${ticket._id}` }, dedupeKey: `ticket:${ticket._id}` });
  return { id: String(ticket._id) };
}

export async function takeTicket({ propertyId, id, actor, ip }) {
  if (![...MT_STAFF_ROLES, ...MT_MANAGER_ROLES].includes(actor.role)) throw httpError('קבלת טיפול מותרת לצוות תחזוקה', 403);
  const t = await loadTicket(id, propertyId);
  const updated = await MaintenanceTicket.findOneAndUpdate(
    { _id: t._id, status: { $in: ['new', 'assigned', 'reopened'] }, $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }, { assignedTo: actor.id }] },
    { $set: { assignedTo: actor.id, status: 'in_progress', startedAt: t.startedAt || new Date() }, $push: { internalNotes: { text: 'התחיל טיפול', author: actor.id, authorName: actor.name } } },
    { returnDocument: 'after' },
  );
  if (!updated) throw httpError('התקלה כבר בטיפול של מישהו אחר או במצב שאינו פתוח', 409);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'maintenance.taken', entityType: 'MaintenanceTicket', entityId: t._id, ip });
  return { id: String(t._id), status: updated.status };
}

export async function updateTicket({ propertyId, id, input, actor, ip }) {
  const t = await loadTicket(id, propertyId);
  if (input.version && t.updatedAt && new Date(t.updatedAt).toISOString() !== String(input.version)) throw httpError('התקלה עודכנה בינתיים — רעננו', 409, { code: 'version_conflict' });
  const isMgr = MT_MANAGER_ROLES.includes(actor.role);
  const changes = {};
  if (input.assigneeId !== undefined) {
    if (!isMgr && String(input.assigneeId || '') !== String(actor.id)) throw httpError('שיוך לאחרים מותר למנהל תחזוקה', 403);
    if (input.assigneeId) { const a = await staffMember(propertyId, input.assigneeId, MT_STAFF_ROLES); t.assignedTo = a._id; if (t.status === 'new') t.status = 'assigned'; changes.assignee = nameOf(a); }
    else { t.assignedTo = undefined; changes.assignee = null; }
  }
  if (input.status !== undefined) {
    if (!['in_progress', 'waiting_parts', 'waiting_vendor'].includes(input.status)) throw httpError('מעבר מצב לא מותר כאן — סיום וסגירה בפעולות נפרדות', 422);
    if (!OPEN_TICKET.includes(t.status)) throw httpError('התקלה אינה פתוחה', 409);
    t.status = input.status; changes.status = input.status;
    if (input.status === 'in_progress' && !t.startedAt) t.startedAt = new Date();
  }
  if (input.priority !== undefined) {
    if (!['critical', 'high', 'medium', 'low'].includes(input.priority)) throw httpError('עדיפות לא מוכרת', 422);
    t.priority = input.priority; changes.priority = input.priority;
  }
  if (input.dueDate !== undefined) {
    if (input.dueDate && Number.isNaN(Date.parse(input.dueDate))) throw httpError('מועד לא תקין', 422);
    t.dueDate = input.dueDate ? new Date(input.dueDate) : undefined; changes.dueDate = input.dueDate;
  }
  if (input.estimatedCost !== undefined || input.actualCost !== undefined) {
    if (!isMgr) throw httpError('עלויות מעודכנות על ידי מנהל תחזוקה', 403);
    if (input.estimatedCost !== undefined) t.estimatedCost = input.estimatedCost === null || input.estimatedCost === '' ? undefined : Math.max(0, Number(input.estimatedCost));
    if (input.actualCost !== undefined) t.actualCost = input.actualCost === null || input.actualCost === '' ? undefined : Math.max(0, Number(input.actualCost));
    changes.cost = true;
  }
  if (input.vendor !== undefined) { t.vendor = input.vendor ? String(input.vendor).slice(0, 120) : undefined; changes.vendor = t.vendor; }
  if (input.note) t.internalNotes.push({ text: String(input.note).slice(0, 1000), author: actor.id, authorName: actor.name });
  if (Array.isArray(input.parts)) {
    t.partsNeeded = input.parts.filter((p) => String(p?.name || '').trim()).slice(0, 30).map((p) => ({ name: String(p.name).slice(0, 120), quantity: Math.max(1, Number(p.quantity) || 1), ordered: !!p.ordered }));
    changes.parts = t.partsNeeded.length;
  }
  await t.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'maintenance.updated', entityType: 'MaintenanceTicket', entityId: t._id, after: changes, ip });
  return { id: String(t._id), version: new Date(t.updatedAt).toISOString() };
}

// Repair done: the room still needs a decision (unblock) and usually a clean/inspection.
export async function resolveTicket({ propertyId, id, note, actor, ip }) {
  const t = await loadTicket(id, propertyId);
  if (!OPEN_TICKET.includes(t.status)) throw httpError('התקלה אינה פתוחה', 409);
  const text = String(note || '').trim().slice(0, 1000);
  if (text.length < 3) throw httpError('יש לתאר מה תוקן', 422, { fields: { note: 'נדרש' } });
  t.status = 'resolved';
  t.resolvedAt = new Date();
  t.internalNotes.push({ text: `תוקן: ${text}`, author: actor.id, authorName: actor.name });
  await t.save();
  let followUp = null;
  if (t.room) {
    const property = await loadOpsProperty(propertyId);
    const day = businessDateOf(property);
    const exists = await HousekeepingTask.exists({ room: t.room, date: day, status: { $in: ACTIVE_TASK } });
    if (!exists) {
      const task = await HousekeepingTask.create({ property: propertyId, room: t.room, type: 'pickup', priority: t.priority === 'critical' ? 'urgent' : 'high', date: day, status: 'new', notes: `סידור אחרי תיקון: ${text.slice(0, 120)}` });
      followUp = String(task._id);
    }
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'maintenance.resolved', entityType: 'MaintenanceTicket', entityId: t._id, reason: text, after: { followUpTask: followUp }, ip });
  return { id: String(t._id), status: 'resolved', followUpTask: followUp };
}

export async function closeTicket({ propertyId, id, note, actor, ip }) {
  const t = await loadTicket(id, propertyId);
  if (!['resolved', 'verified'].includes(t.status)) throw httpError('סוגרים תקלה רק אחרי שתוקנה', 409);
  if (t.priority === 'critical' && !MT_MANAGER_ROLES.includes(actor.role)) throw httpError('סגירת תקלה מסוכנת מחייבת מנהל תחזוקה', 403);
  const text = String(note || '').trim().slice(0, 1000);
  if (text.length < 3) throw httpError('יש לתעד את הסגירה', 422, { fields: { note: 'נדרש' } });
  t.status = 'closed';
  t.closedAt = new Date();
  t.closedBy = actor.id;
  t.closingNote = text;
  if (t.priority === 'critical') { t.closingApprovedBy = actor.id; t.closingApprovedAt = new Date(); }
  await t.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'maintenance.closed', entityType: 'MaintenanceTicket', entityId: t._id, reason: text, ip });
  return { id: String(t._id), status: 'closed' };
}

export async function reopenTicket({ propertyId, id, reason, actor, ip }) {
  const t = await loadTicket(id, propertyId);
  if (!['resolved', 'verified', 'closed'].includes(t.status)) throw httpError('התקלה עדיין פתוחה', 409);
  const why = String(reason || '').trim().slice(0, 500);
  if (why.length < 3) throw httpError('פתיחה מחדש מחייבת סיבה', 422, { fields: { reason: 'נדרש' } });
  t.status = 'reopened';
  t.reopenReason = why;
  t.resolvedAt = undefined;
  t.closedAt = undefined;
  t.internalNotes.push({ text: `נפתחה מחדש: ${why}`, author: actor.id, authorName: actor.name });
  await t.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'maintenance.reopened', entityType: 'MaintenanceTicket', entityId: t._id, reason: why, ip });
  return { id: String(t._id), status: 'reopened' };
}

// Unblock a room after repair — refused while any other blocking ticket is open (OPS-06 close ≠ unblock).
export async function unblockRoom({ propertyId, roomId, reason, actor, ip }) {
  if (![...MT_MANAGER_ROLES, 'front_desk_manager', 'housekeeping_manager'].includes(actor.role)) throw httpError('שחרור חסימת חדר מותר למנהל', 403);
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('שחרור חסימה מחייב סיבה', 422, { fields: { reason: 'נדרש' } });
  const room = await loadRoom(roomId, propertyId);
  const blocks = await blockingTickets(room._id);
  if (blocks.length) throw httpError(`יש עדיין תקלה פתוחה שחוסמת את החדר: ${blocks[0].description}`, 409);
  const before = room.opsStatus;
  room.opsStatus = 'available';
  room.outOfServiceUntil = undefined;
  await room.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'room.ops_status.available', entityType: 'Room', entityId: room._id, before: { opsStatus: before }, after: { opsStatus: 'available' }, reason: why, ip });
  return { id: String(room._id), opsStatus: 'available' };
}

export async function opsStaff({ propertyId, kind }) {
  const roles = kind === 'maintenance' ? MT_STAFF_ROLES : HK_STAFF_ROLES;
  const users = await User.find({ property: propertyId, active: { $ne: false }, role: { $in: roles } }).select('firstName lastName role').sort({ firstName: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: nameOf(u), role: u.role }));
}

export async function roomsLite({ propertyId }) {
  const rooms = await Room.find({ property: propertyId, active: { $ne: false } }).select('number floor').sort({ floor: 1, number: 1 }).lean();
  return rooms.map((r) => ({ id: String(r._id), number: r.number, floor: r.floor }));
}

export { PAUSE_REASONS, RoomType };
