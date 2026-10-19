// Housekeeping — the hotel's situation for one day, room by room, and the order to work in.
// Everything is derived from stays (units), room status, today's tasks and open tickets; nothing
// here writes. The priority order (stated on the screen):
//   1  guest waiting at the desk for this room
//   2  arrival today, room vacant and not ready — VIP first, then by expected arrival time
//   3  vacant dirty room of a type that today's unassigned arrivals will need
//   4  room left today (check-out done), no arrival
//   5  departure + arrival today, guest not out yet — clean the moment they leave
//   6  stayover service (not DND / service declined)
//   7  departure expected today, guest not out yet
//   8  other vacant dirty rooms
// Blocked rooms (out of order / blocking ticket) are listed apart and never prioritised.
import Room from '../models/Room.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import Property from '../models/Property.js';
import { businessDateOf, implicitUnits } from './frontDeskService.js';
import { ymdInTimezone } from '../utils/dateHelpers.js';

const STAY_STATUSES = ['hold', 'pending_payment', 'confirmed', 'modified', 'in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out', 'checked_out'];
const ARRIVING = ['confirmed', 'modified', 'pending_payment', 'partially_checked_in'];
const OPEN_TICKET = ['new', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor', 'reopened'];
const DONE_TASK = ['completed', 'inspected'];
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const idStr = (v) => (v ? String(v._id || v) : null);
const nameOf = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : null);

export const PRIORITY_RULES = [
  { rank: 1, code: 'waiting', label: 'אורח ממתין לחדר' },
  { rank: 2, code: 'arrival', label: 'הגעה היום — להכין' },
  { rank: 3, code: 'shortage', label: 'נדרש להגעות בלי חדר' },
  { rank: 4, code: 'left', label: 'יצא — ניקוי יציאה' },
  { rank: 5, code: 'turn', label: 'יציאה והגעה — לנקות מיד ביציאה' },
  { rank: 6, code: 'stayover', label: 'שוהה — סידור' },
  { rank: 7, code: 'due_out', label: 'צפוי לעזוב' },
  { rank: 8, code: 'vacant_dirty', label: 'פנוי מלוכלך' },
];
const RULE = Object.fromEntries(PRIORITY_RULES.map((r) => [r.code, r]));

// Every stay unit touching [from, to] — ReservationRoom where it exists, else the implicit unit.
async function loadUnits(propertyId, from, to) {
  const res = await Reservation.find({ property: propertyId, status: { $in: STAY_STATUSES }, arrivalDate: { $lte: to }, departureDate: { $gte: from } })
    .select('confirmationNumber status arrivalDate departureDate adults children roomsCount roomType assignedRoom eta isVip checkedInAt checkedOutAt primaryGuest groupName')
    .populate('primaryGuest', 'vipLevel')
    .lean();
  const units = await ReservationRoom.find({ reservation: { $in: res.map((r) => r._id) } }).sort({ createdAt: 1, _id: 1 }).lean();
  const byRes = new Map();
  for (const u of units) { const k = String(u.reservation); if (!byRes.has(k)) byRes.set(k, []); byRes.get(k).push(u); }
  const out = [];
  for (const r of res) {
    const list = byRes.get(String(r._id)) || implicitUnits(r);
    const share = list.length || 1;
    for (const u of list) {
      if (['cancelled', 'no_show'].includes(u.status)) continue;
      out.push({
        res: r,
        roomId: idStr(u.assignedRoom),
        roomTypeId: idStr(u.roomTypeBooked || r.roomType),
        arrivalDate: u.arrivalDate || r.arrivalDate,
        departureDate: u.departureDate || r.departureDate,
        unitStatus: u.status,
        // Guests per room: the reservation's heads spread over its rooms (rounded up for the first).
        guests: Math.ceil(Number(r.adults || 0) / share) + Math.ceil(Number(r.children || 0) / share),
        tentative: ['hold', 'pending_payment'].includes(r.status) && !['in_house', 'checked_in'].includes(u.status),
      });
    }
  }
  return out;
}

const inHouse = (u) => ['in_house', 'checked_in'].includes(u.unitStatus);
const left = (u) => u.unitStatus === 'checked_out';
const arriving = (u) => !inHouse(u) && !left(u) && ARRIVING.includes(u.res.status);

export async function hkOverview({ propertyId, date, days = 7 }) {
  const property = await Property.findById(propertyId).select('timezone checkInPolicy checkInTime checkOutTime dayClose').lean();
  const tz = property?.timezone || 'Asia/Jerusalem';
  const businessDate = businessDateOf(property);
  const day = isYmd(date) ? date : businessDate;
  const isToday = day === businessDate;
  const n = Math.min(14, Math.max(1, Number(days) || 7));
  const lastDay = addDays(day, n - 1);

  const [rooms, units, tasks, tickets, queue] = await Promise.all([
    Room.find({ property: propertyId, active: { $ne: false } }).populate('roomType', 'name code').sort({ floor: 1, number: 1 }).lean(),
    loadUnits(propertyId, addDays(day, -1), lastDay),
    HousekeepingTask.find({ property: propertyId, date: day, status: { $ne: 'cancelled' } }).populate('assignedTo', 'firstName lastName').lean(),
    MaintenanceTicket.find({ property: propertyId, status: { $in: OPEN_TICKET } }).select('room priority blocksRoom guestImpact').lean(),
    ArrivalQueueEntry.find({ property: propertyId, status: 'active' }).select('room reservation arrivedAt').lean(),
  ]);
  const readyClean = property?.checkInPolicy?.requireInspection ? ['inspected'] : ['clean', 'inspected'];

  // ── Today, per room ──
  const leftOn = (u) => {
    if (!left(u)) return null;
    const at = u.res.checkedOutAt ? ymdInTimezone(u.res.checkedOutAt, tz) : u.departureDate;
    return at < u.departureDate ? at : u.departureDate;
  };
  // A booking whose arrival day passed without check-in is not in the hotel — the desk must clear it.
  const stale = units.filter((u) => arriving(u) && u.arrivalDate < businessDate);
  const live = units.filter((u) => !stale.includes(u));
  const todayUnits = live.filter((u) => !u.tentative || u.arrivalDate === day);
  const perRoom = new Map();
  const slot = (id) => { if (!perRoom.has(id)) perRoom.set(id, { departure: null, arrival: null, stay: null }); return perRoom.get(id); };
  const unassignedArrivals = [];
  const noRoom = { departures: 0, stayovers: 0 };
  const waitingByRes = new Map(queue.filter((q) => !q.room).map((q) => [String(q.reservation), q]));
  const waitingByRoom = new Map(queue.filter((q) => q.room).map((q) => [String(q.room), q]));
  for (const u of todayUnits) {
    const info = {
      // No guest identity on housekeeping screens (OPS-01-F05): heads, VIP flag, group and times only.
      reservationId: String(u.res._id), guests: u.guests, vip: !!u.res.isVip || Number(u.res.primaryGuest?.vipLevel) > 0, group: u.res.groupName || null,
      arrivalDate: u.arrivalDate, departureDate: u.departureDate, eta: u.res.eta || null,
    };
    // Departures of the day: in house leaving today, or already left today.
    // A day after the business date is planned from the bookings: a stay booked over it counts as in house.
    const leftDay = leftOn(u);
    const end = leftDay || u.departureDate;
    const stayingThere = inHouse(u) || (day > businessDate && arriving(u) && !u.tentative);
    if (leftDay === day || (end === day && u.arrivalDate < day && stayingThere) || (isToday && inHouse(u) && u.departureDate < day)) {
      if (u.roomId) slot(u.roomId).departure = { ...info, left: leftDay === day, checkedOutAt: u.res.checkedOutAt || null };
      else noRoom.departures += 1;
      continue;
    }
    if (stayingThere && u.arrivalDate < day && day < end) {
      if (u.roomId) slot(u.roomId).stay = { ...info, arrivedToday: false, checkedInAt: u.res.checkedInAt || null };
      else noRoom.stayovers += 1;
      continue;
    }
    if (inHouse(u) && u.arrivalDate === day) {
      if (u.roomId) slot(u.roomId).stay = { ...info, arrivedToday: true, checkedInAt: u.res.checkedInAt || null };
      continue;
    }
    if (arriving(u) && u.arrivalDate === day) {
      const a = { ...info, tentative: u.tentative, roomTypeId: u.roomTypeId };
      if (u.roomId) slot(u.roomId).arrival = a;
      else unassignedArrivals.push({ ...a, waiting: waitingByRes.get(info.reservationId)?.arrivedAt || null });
    }
  }

  const tasksByRoom = new Map();
  for (const t of tasks) { const k = String(t.room); if (!tasksByRoom.has(k)) tasksByRoom.set(k, []); tasksByRoom.get(k).push(t); }
  const ticketsByRoom = new Map();
  for (const t of tickets) { if (!t.room) continue; const k = String(t.room); if (!ticketsByRoom.has(k)) ticketsByRoom.set(k, []); ticketsByRoom.get(k).push(t); }

  const list = rooms.map((r) => {
    const id = String(r._id);
    const s = perRoom.get(id) || {};
    const tk = ticketsByRoom.get(id) || [];
    const rt = tasksByRoom.get(id) || [];
    const blocking = r.opsStatus !== 'available' || tk.some((t) => t.blocksRoom || t.priority === 'critical' || t.guestImpact === 'block');
    const occupiedNow = !!(s.stay || (s.departure && !s.departure.left));
    const vacant = !occupiedNow;
    const clean = readyClean.includes(r.cleanStatus);
    const dirty = !clean;
    const dnd = rt.some((t) => t.isDND && !DONE_TASK.includes(t.status));
    const declined = rt.some((t) => t.isNoService);
    const waitQ = waitingByRoom.get(id);
    const open = rt.find((t) => !DONE_TASK.includes(t.status)) || null;
    const done = rt.find((t) => DONE_TASK.includes(t.status)) || null;
    const movement = s.departure && s.arrival ? 'turn' : s.departure ? 'departure' : s.arrival ? 'arrival' : s.stay ? (s.stay.arrivedToday ? 'arrived' : 'stayover') : 'vacant';
    return {
      id, number: r.number, floor: r.floor, zone: r.housekeepingZone || null,
      roomType: r.roomType ? { id: String(r.roomType._id), name: r.roomType.name, code: r.roomType.code } : null,
      cleanStatus: r.cleanStatus, opsStatus: r.opsStatus, blocking, openTickets: tk.length,
      movement, departure: s.departure || null, arrival: s.arrival ? { ...s.arrival, waitingSince: waitQ?.arrivedAt || null } : null, stay: s.stay || null,
      occupiedNow, vacant, ready: vacant && clean && !blocking,
      dnd, serviceDeclined: declined,
      task: open || done ? (() => { const t = open || done; return { id: String(t._id), type: t.type, status: t.status, priority: t.priority, assignee: nameOf(t.assignedTo), startedAt: t.startedAt || null, completedAt: t.completedAt || null }; })() : null,
      stayoverDone: !!(s.stay && rt.some((t) => ['stayover', 'turndown'].includes(t.type) && DONE_TASK.includes(t.status))),
      _clean: clean, _dirty: dirty,
    };
  });

  // Shortage: unassigned arrivals per type vs. ready vacant rooms of that type nobody arrives in.
  const needByType = new Map();
  for (const a of unassignedArrivals) needByType.set(a.roomTypeId, (needByType.get(a.roomTypeId) || 0) + 1);
  const shortage = [];
  for (const [typeId, need] of needByType) {
    const free = list.filter((x) => x.roomType?.id === typeId && !x.arrival && x.vacant && !x.blocking);
    const ready = free.filter((x) => x.ready).length;
    const missing = Math.max(0, need - ready);
    const type = list.find((x) => x.roomType?.id === typeId)?.roomType || null;
    shortage.push({ roomType: type, arrivals: need, readyRooms: ready, missing, dirtyCandidates: free.filter((x) => !x.ready).length });
    // Mark the dirty vacant rooms of the type to clean first (lowest floor/number first).
    free.filter((x) => !x.ready).slice(0, missing).forEach((x) => { x._shortage = true; });
  }

  // ── Priority ──
  for (const x of list) {
    let rule = null;
    const reason = [];
    if (x.blocking) { x.priority = null; continue; }
    if (x.arrival && x.vacant && !x.ready && x.arrival.waitingSince) rule = RULE.waiting;
    else if (x.arrival && x.vacant && !x.ready) rule = RULE.arrival;
    else if (x._shortage) rule = RULE.shortage;
    else if (x.departure?.left && x._dirty) rule = RULE.left;
    else if (x.movement === 'turn' && !x.departure.left) rule = RULE.turn;
    else if (x.stay && !x.stay.arrivedToday && !x.stayoverDone && !x.dnd && !x.serviceDeclined) rule = RULE.stayover;
    else if (x.departure && !x.departure.left) rule = RULE.due_out;
    else if (x.vacant && x._dirty && !x.arrival) rule = RULE.vacant_dirty;
    if (rule && x.arrival?.vip) reason.push('VIP');
    if (rule && x.arrival?.eta) reason.push(`הגעה ${x.arrival.eta}`);
    if (rule && x.task?.status === 'in_progress') reason.push('בניקוי עכשיו');
    x.priority = rule ? { rank: rule.rank, code: rule.code, label: rule.label, notes: reason } : null;
  }
  const etaKey = (x) => x.arrival?.eta || '99:99';
  const work = list.filter((x) => x.priority).sort((a, b) => a.priority.rank - b.priority.rank
    || (a.priority.code === 'waiting' ? String(a.arrival.waitingSince).localeCompare(String(b.arrival.waitingSince)) : 0)
    || (Number(!!b.arrival?.vip) - Number(!!a.arrival?.vip))
    || etaKey(a).localeCompare(etaKey(b))
    || (a.floor - b.floor) || String(a.number).localeCompare(String(b.number), 'he', { numeric: true }));
  work.forEach((x, i) => { x.priority.order = i + 1; });
  for (const x of list) { delete x._clean; delete x._dirty; delete x._shortage; }

  // ── Counts ──
  const deps = list.filter((x) => x.departure);
  const arrs = list.filter((x) => x.arrival);
  const arrivedToday = list.filter((x) => x.stay?.arrivedToday).length;
  const stays = list.filter((x) => x.stay && !x.stay.arrivedToday);
  const counts = {
    rooms: list.length,
    departures: { total: deps.length + noRoom.departures, noRoom: noRoom.departures, left: deps.filter((x) => x.departure.left).length, pending: deps.filter((x) => !x.departure.left).length, cleaned: deps.filter((x) => x.departure.left && x.ready).length },
    arrivals: {
      total: arrs.length + unassignedArrivals.length + arrivedToday,
      arrived: arrivedToday,
      pending: arrs.length + unassignedArrivals.length,
      assigned: arrs.length, unassigned: unassignedArrivals.length,
      roomReady: arrs.filter((x) => x.ready).length,
      waiting: arrs.filter((x) => x.arrival.waitingSince).length + unassignedArrivals.filter((a) => a.waiting).length,
      vip: arrs.filter((x) => x.arrival.vip).length + unassignedArrivals.filter((a) => a.vip).length,
    },
    stayovers: { total: stays.length + noRoom.stayovers, noRoom: noRoom.stayovers, serviced: stays.filter((x) => x.stayoverDone).length, dnd: stays.filter((x) => x.dnd || x.serviceDeclined).length },
    turns: list.filter((x) => x.movement === 'turn').length,
    vacant: { ready: list.filter((x) => x.ready).length, dirty: list.filter((x) => x.vacant && !x.ready && !x.blocking).length },
    blocked: list.filter((x) => x.blocking).length,
    guestsInHouse: list.reduce((s, x) => s + (x.stay ? x.stay.guests : 0) + (x.departure && !x.departure.left ? x.departure.guests : 0), 0),
    work: work.length,
    staleArrivals: new Set(stale.map((u) => String(u.res._id))).size,
  };

  // ── Next days: rooms to turn over (planning the team) ──
  const forecast = [];
  for (let i = 0; i < n; i += 1) {
    const d = addDays(day, i);
    const active = live.filter((u) => !u.tentative);
    const depN = active.filter((u) => (leftOn(u) || u.departureDate) === d && u.arrivalDate < d).length;
    const arrN = active.filter((u) => u.arrivalDate === d && !left(u)).length;
    const stayN = active.filter((u) => u.arrivalDate < d && d < (leftOn(u) || u.departureDate)).length;
    const guests = active.filter((u) => u.arrivalDate <= d && d < (leftOn(u) || u.departureDate)).reduce((s, u) => s + u.guests, 0);
    forecast.push({ date: d, departures: depN, arrivals: arrN, stayovers: stayN, guests, tentativeArrivals: live.filter((u) => u.tentative && u.arrivalDate === d).length });
  }

  return {
    date: day, businessDate, isToday,
    checkInTime: property?.checkInTime || '15:00', checkOutTime: property?.checkOutTime || '11:00',
    requireInspection: !!property?.checkInPolicy?.requireInspection,
    rules: PRIORITY_RULES,
    counts, work, rooms: list,
    unassignedArrivals: unassignedArrivals.sort((a, b) => (Number(!!b.waiting) - Number(!!a.waiting)) || (Number(b.vip) - Number(a.vip)) || String(a.eta || '99').localeCompare(String(b.eta || '99'))),
    shortage: shortage.filter((s) => s.arrivals > 0),
    forecast,
  };
}

// Work sheets to hand out: one per housekeeper with their rooms in the computed order, plus the
// rooms that need work and have no one (or no task) yet. Built on the same day picture as above.
export async function hkSheets({ propertyId, date, floor }) {
  const o = await hkOverview({ propertyId, date, days: 1 });
  const tasks = await HousekeepingTask.find({ property: propertyId, date: o.date, status: { $ne: 'cancelled' } })
    .populate('assignedTo', 'firstName lastName').select('room type status priority assignedTo notes dueTime isDND startedAt completedAt').lean();
  const roomById = new Map(o.rooms.map((r) => [r.id, r]));
  const f = floor !== undefined && floor !== '' && !Number.isNaN(Number(floor)) ? Number(floor) : null;
  const inFloor = (r) => f === null || r.floor === f;
  const sheets = new Map();
  const sheet = (id, name) => { if (!sheets.has(id)) sheets.set(id, { id, name, rows: [] }); return sheets.get(id); };
  const covered = new Set();
  for (const t of tasks) {
    const r = roomById.get(String(t.room));
    if (!r || !inFloor(r)) continue;
    covered.add(r.id);
    const s = t.assignedTo ? sheet(String(t.assignedTo._id), nameOf(t.assignedTo)) : sheet('unassigned', 'לא שובץ');
    s.rows.push({ ...rowOf(r), taskId: String(t._id), taskType: t.type, taskStatus: t.status, taskPriority: t.priority, dueTime: t.dueTime || null, notes: t.notes || null });
  }
  for (const r of o.work) {
    if (covered.has(r.id) || !inFloor(r)) continue;
    sheet('no_task', 'נדרשת עבודה — אין משימה').rows.push({ ...rowOf(r), taskId: null, taskType: null, taskStatus: null, taskPriority: null, dueTime: null, notes: null });
  }
  const order = (x) => x.priority?.order ?? 999;
  const list = [...sheets.values()].map((s) => {
    s.rows.sort((a, b) => order(a) - order(b) || (a.floor - b.floor) || String(a.number).localeCompare(String(b.number), 'he', { numeric: true }));
    s.summary = {
      rooms: s.rows.length,
      departures: s.rows.filter((x) => x.kind === 'departure' || x.kind === 'turn').length,
      stayovers: s.rows.filter((x) => x.kind === 'stayover').length,
      arrivals: s.rows.filter((x) => x.kind === 'arrival').length,
      done: s.rows.filter((x) => ['completed', 'inspected'].includes(x.taskStatus)).length,
    };
    return s;
  }).sort((a, b) => (['unassigned', 'no_task'].includes(a.id) ? 1 : 0) - (['unassigned', 'no_task'].includes(b.id) ? 1 : 0) || a.name.localeCompare(b.name, 'he'));
  return { date: o.date, businessDate: o.businessDate, checkOutTime: o.checkOutTime, sheets: list };
}

function rowOf(r) {
  const kind = r.movement === 'arrived' ? 'stayover' : r.movement;
  return {
    roomId: r.id, number: r.number, floor: r.floor, roomType: r.roomType?.name || null, cleanStatus: r.cleanStatus, kind,
    left: !!r.departure?.left, eta: r.arrival?.eta || null, vip: !!(r.arrival?.vip || r.stay?.vip), guests: r.arrival?.guests || r.stay?.guests || r.departure?.guests || 0,
    waiting: !!r.arrival?.waitingSince, dnd: r.dnd, priority: r.priority ? { order: r.priority.order, rank: r.priority.rank, label: r.priority.label } : null,
    stayUntil: r.stay?.departureDate || null,
  };
}
