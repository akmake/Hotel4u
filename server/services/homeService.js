// Home screen & quick looks (gap-map item 8): live counters for the menu, the weekly control panel,
// the house status of a day (with comp / house use and maximum availability), the vacant room search
// and turned-away requests. Nothing here changes stays; everything is read from the same sources as the
// availability board, the front desk and housekeeping.
import { reasonMap } from './codeListService.js';
import mongoose from 'mongoose';
import GuestProfile from '../models/GuestProfile.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import Reservation from '../models/Reservation.js';
import { RatePlan } from '../models/RatePlan.js';
import GroupBlock from '../models/GroupBlock.js';
import InventoryDate from '../models/InventoryDate.js';
import Property from '../models/Property.js';
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import TurnAway, { TURNAWAY_REASONS } from '../models/TurnAway.js';
import { DeskItem } from '../models/DeskItem.js';
import { availabilityGrid } from './roomBlockService.js';
import { businessDateOf, IN_HOUSE_STATUSES, occupancyMap, conflictingRoomIds, httpError } from './frontDeskService.js';
import { audit } from './auditService.js';
import { ymdInTimezone } from '../utils/dateHelpers.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pct = (n, of) => (of > 0 ? Math.round((Math.min(n, of) / of) * 100) : 0);
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const ARRIVING = ['confirmed', 'modified', 'pending_payment', 'partially_checked_in'];
const DEAD = ['cancelled', 'no_show', 'deleted', 'quote', 'draft', 'waitlisted'];
const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

async function propertyOf(propertyId) {
  const p = await Property.findById(propertyId).select('name timezone dayClose checkInPolicy').lean();
  if (!p) throw httpError('הנכס לא נמצא', 404);
  return p;
}

// Rooms right now: vacant/occupied × clean/dirty, out of order apart.
async function roomsNow(propertyId, property) {
  const rooms = await Room.find({ property: propertyId, active: { $ne: false } }).select('number floor roomType cleanStatus opsStatus').lean();
  const occ = await occupancyMap(propertyId, rooms.map((r) => r._id));
  const ready = property?.checkInPolicy?.requireInspection ? ['inspected'] : ['clean', 'inspected'];
  const out = { total: rooms.length, ooo: 0, vc: 0, vd: 0, oc: 0, od: 0 };
  for (const r of rooms) {
    if (r.opsStatus && r.opsStatus !== 'available') { out.ooo += 1; continue; }
    const occupied = occ.has(String(r._id));
    const clean = ready.includes(r.cleanStatus);
    out[`${occupied ? 'o' : 'v'}${clean ? 'c' : 'd'}`] += 1;
  }
  return out;
}

// ── Menu counters (cached briefly: the menu polls) ─────────────────────────
const cache = new Map();
export async function navCounters({ propertyId }) {
  const hit = cache.get(String(propertyId));
  if (hit && hit.at > Date.now() - 20000) return hit.data;
  const property = await propertyOf(propertyId);
  const today = businessDateOf(property);
  const month = today.slice(0, 7);
  const [arrivals, inHouse, rooms, queue, messages, traces, board] = await Promise.all([
    Reservation.find({ property: propertyId, arrivalDate: today, status: { $in: ARRIVING } }).select('roomsCount group groupName').lean(),
    Reservation.find({ property: propertyId, status: { $in: IN_HOUSE_STATUSES } }).select('departureDate roomsCount').lean(),
    roomsNow(propertyId, property),
    ArrivalQueueEntry.countDocuments({ property: propertyId, status: 'active' }),
    DeskItem.countDocuments({ property: propertyId, kind: 'message', status: 'open' }),
    DeskItem.countDocuments({ property: propertyId, kind: 'trace', status: 'open', date: { $lte: today } }),
    availabilityGrid({ propertyId, month }),
  ]);
  const rooms$ = (list) => sum(list.map((r) => ({ n: Math.max(1, Number(r.roomsCount) || 1) })), 'n');
  const group = arrivals.filter((r) => r.group || r.groupName);
  const day = board.totals.find((t) => t.date === today);
  const monthDef = sum(board.totals, 'definite');
  const monthSellable = board.totals.reduce((s, t) => s + Math.max(0, t.total - t.outOfSale), 0);
  const data = {
    today,
    arrivals: { rooms: rooms$(arrivals), individual: rooms$(arrivals.filter((r) => !group.includes(r))), group: rooms$(group) },
    inHouse: rooms$(inHouse),
    departuresDue: rooms$(inHouse.filter((r) => r.departureDate <= today)),
    rooms,
    occupancyToday: day ? day.occupancyPct : 0,
    occupancyMonth: pct(monthDef, monthSellable),
    queue, messages, traces,
  };
  // What each menu entry shows (path → badge).
  data.nav = {
    '/pms/arrivals': data.arrivals.rooms || null,
    '/pms/arrival-queue': queue || null,
    '/pms/in-house': data.inHouse || null,
    '/pms/departures': data.departuresDue || null,
    '/pms/desk': messages + traces || null,
    '/pms/housekeeping': rooms.vd || null,
    // Occupancy tonight / this month — from the availability board (nights sold), so it lives on that entry.
    '/pms/availability': `${data.occupancyToday}% · ${data.occupancyMonth}%`,
  };
  cache.set(String(propertyId), { at: Date.now(), data });
  return data;
}

// ── Weekly control panel ─────────────────────────────────────────────────────
export async function weekView({ propertyId, from, days = 7 }) {
  const property = await propertyOf(propertyId);
  const today = businessDateOf(property);
  const start = YMD.test(from || '') ? from : today;
  const n = Math.min(14, Math.max(1, Number(days) || 7));
  const last = addDays(start, n - 1);
  const [board, groups, turnaways, inv] = await Promise.all([
    availabilityGrid({ propertyId, from: start, days: n }),
    GroupBlock.find({ property: propertyId, status: { $nin: ['cancelled', 'released', 'lost'] }, arrivalDate: { $lte: last }, departureDate: { $gt: start } })
      .select('name code status arrivalDate departureDate totalRoomsBlocked totalRoomsPicked').lean(),
    TurnAway.find({ property: propertyId, date: { $gte: start, $lte: last } }).select('date rooms reason').lean(),
    InventoryDate.find({ property: propertyId, date: { $gte: start, $lte: last } }).select('date groupAllotmentCount overbookingLimit').lean(),
  ]);
  const rows = board.totals.map((t) => {
    const sellable = Math.max(0, t.total - t.outOfSale);
    const invDay = inv.filter((x) => x.date === t.date);
    const ta = turnaways.filter((x) => x.date === t.date);
    return {
      date: t.date, isToday: t.date === today, total: t.total, outOfSale: t.outOfSale, sellable,
      definite: t.definite, tentative: t.tentative,
      physicalFree: sellable - t.definite - t.tentative,
      available: t.available, guests: t.guests, arrivals: t.arrivals, departures: t.departures,
      overbooked: Math.max(0, t.definite + t.tentative - sellable),
      groupHold: sum(invDay, 'groupAllotmentCount'),
      occupancyPct: t.occupancyPct,
      groups: groups.filter((g) => g.arrivalDate <= t.date && t.date < g.departureDate).map((g) => ({ id: String(g._id), name: g.name, code: g.code || null, status: g.status, blocked: g.totalRoomsBlocked || 0, picked: g.totalRoomsPicked || 0, arrives: g.arrivalDate === t.date })),
      turnaways: { count: ta.length, rooms: sum(ta, 'rooms') },
    };
  });
  return { today, from: start, rows, reasons: await reasonMap(propertyId, 'reason_turnaway') };
}

export async function addTurnAway({ propertyId, input, actor, ip }) {
  const fields = {};
  if (!YMD.test(input.date || '')) fields.date = 'תאריך הגעה';
  if (!(await reasonMap(propertyId, 'reason_turnaway'))[input.reason]) fields.reason = 'סיבה';
  const nights = Number(input.nights || 1); const rooms = Number(input.rooms || 1);
  if (!(nights >= 1 && nights <= 60)) fields.nights = '1–60';
  if (!(rooms >= 1 && rooms <= 100)) fields.rooms = '1–100';
  if (input.roomTypeId && !isId(input.roomTypeId)) fields.roomTypeId = 'סוג חדר';
  if (Object.keys(fields).length) throw httpError('יש להשלים את פרטי הפנייה', 422, { fields });
  const guestRef = input.guestId && mongoose.isValidObjectId(String(input.guestId)) && await GuestProfile.exists({ _id: input.guestId, property: propertyId }) ? input.guestId : undefined;
  const t = await TurnAway.create({ property: propertyId, date: input.date, nights, rooms, roomType: input.roomTypeId || undefined, guest: guestRef, reason: input.reason, note: String(input.note || '').trim().slice(0, 300) || undefined, by: actor.id || undefined, byName: actor.name });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'home.turnaway', entityType: 'TurnAway', entityId: t._id, after: { date: t.date, nights, rooms, reason: t.reason }, ip });
  return { id: String(t._id) };
}

// ── House status of a day ────────────────────────────────────────────────────
export async function houseStatus({ propertyId, date }) {
  const property = await propertyOf(propertyId);
  const today = businessDateOf(property);
  const day = YMD.test(date || '') ? date : today;
  const tz = property.timezone || 'Asia/Jerusalem';
  const [board, inv, arriving, leaving, staying] = await Promise.all([
    availabilityGrid({ propertyId, from: day, days: 1 }),
    InventoryDate.find({ property: propertyId, date: day }).select('allotmentCount releasedAllotmentCount groupAllotmentCount overbookingLimit').lean(),
    Reservation.find({ property: propertyId, arrivalDate: day, status: { $nin: DEAD } }).select('status roomsCount checkedInAt').lean(),
    Reservation.find({ property: propertyId, departureDate: day, status: { $nin: DEAD } }).select('status roomsCount checkedOutAt').lean(),
    Reservation.find({ property: propertyId, status: { $nin: [...DEAD, 'checked_out'] }, arrivalDate: { $lte: day }, departureDate: { $gt: day } }).select('roomsCount adults children ratePlan status').lean(),
  ]);
  const t = board.totals[0] || { total: 0, outOfSale: 0, definite: 0, tentative: 0, available: 0, guests: 0 };
  const rooms = (list) => list.reduce((s, r) => s + Math.max(1, Number(r.roomsCount) || 1), 0);
  const sellable = Math.max(0, t.total - t.outOfSale);
  // Comp and house use come from the rate the stay is on.
  const plans = new Map((await RatePlan.find({ _id: { $in: staying.map((r) => r.ratePlan).filter(Boolean) } }).select('use').lean()).map((p) => [String(p._id), p.use || 'paying']));
  const useOf = (r) => plans.get(String(r.ratePlan)) || 'paying';
  const byUse = (u) => { const l = staying.filter((r) => useOf(r) === u); return { rooms: rooms(l), guests: l.reduce((s, r) => s + Number(r.adults || 0) + Number(r.children || 0), 0) }; };
  const overbook = sum(inv, 'overbookingLimit');
  const groupHold = sum(inv, 'groupAllotmentCount') + inv.reduce((s, x) => s + Math.max(0, (x.allotmentCount || 0) - (x.releasedAllotmentCount || 0)), 0);
  const regular = Math.max(0, t.available - overbook);
  const arrivedDone = arriving.filter((r) => r.checkedInAt || IN_HOUSE_STATUSES.includes(r.status) || r.status === 'checked_out');
  const leftDone = leaving.filter((r) => r.status === 'checked_out' && (!r.checkedOutAt || ymdInTimezone(r.checkedOutAt, tz) <= day));
  const isToday = day === today;
  return {
    date: day, today, isToday, isFuture: day > today,
    rooms: { total: t.total, outOfSale: t.outOfSale, sellable },
    movement: {
      arrivals: { expected: rooms(arriving.filter((r) => !['no_show'].includes(r.status))), done: rooms(arrivedDone) },
      departures: { expected: rooms(leaving), done: rooms(leftDone) },
    },
    use: { comp: byUse('comp'), houseUse: byUse('house_use'), paying: byUse('paying') },
    forecast: {
      occupied: t.definite, tentative: t.tentative, groupNotPicked: sum(inv, 'groupAllotmentCount'),
      occupancyPct: pct(t.definite, sellable), withGroupsPct: pct(t.definite + sum(inv, 'groupAllotmentCount'), sellable), guests: t.guests,
    },
    // Housekeeping as it is now — only for today (a future day has no housekeeping state).
    housekeeping: isToday ? await roomsNow(propertyId, property) : null,
    maxAvailability: { regular, withOverbooking: t.available, ifOptionsReleased: regular + t.tentative, committed: t.definite + t.tentative + groupHold, overbookingLimit: overbook, groupHold },
  };
}

// ── Vacant room search ───────────────────────────────────────────────────────
export async function freeRooms({ propertyId, from, to, roomTypeId, status = 'ready' }) {
  const property = await propertyOf(propertyId);
  const today = businessDateOf(property);
  const a = YMD.test(from || '') ? from : today;
  const b = YMD.test(to || '') && to > a ? to : addDays(a, 1);
  if (b > addDays(a, 60)) throw httpError('חיפוש עד 60 לילות', 422, { fields: { to: 'עד 60 לילות' } });
  const q = { property: propertyId, active: { $ne: false } };
  if (isId(roomTypeId)) q.roomType = roomTypeId;
  const [rooms, types, taken] = await Promise.all([
    Room.find(q).select('number floor roomType cleanStatus opsStatus features maxOccupancy').sort({ floor: 1, number: 1 }).lean(),
    RoomType.find({ property: propertyId, active: { $ne: false } }).select('name code').sort({ sortOrder: 1, name: 1 }).lean(),
    conflictingRoomIds({ propertyId, from: a, to: b, excludeReservationId: null }),
  ]);
  // Guests still in the room tonight (overstay past their date) also hold it when searching from today.
  const occ = a === today ? await occupancyMap(propertyId, rooms.map((r) => r._id)) : new Map();
  const ready = property?.checkInPolicy?.requireInspection ? ['inspected'] : ['clean', 'inspected'];
  const typeName = new Map(types.map((t) => [String(t._id), t.name]));
  const free = rooms.filter((r) => (!r.opsStatus || r.opsStatus === 'available') && !taken.has(String(r._id)) && !(occ.get(String(r._id)) || []).length);
  const list = free.map((r) => ({ id: String(r._id), number: r.number, floor: r.floor ?? null, roomTypeId: String(r.roomType), roomType: typeName.get(String(r.roomType)) || '', cleanStatus: r.cleanStatus, ready: ready.includes(r.cleanStatus), maxOccupancy: r.maxOccupancy || null, features: r.features || [] }));
  const shown = status === 'all' ? list : list.filter((r) => r.ready);
  const byType = types.map((t) => ({ id: String(t._id), name: t.name, free: list.filter((r) => r.roomTypeId === String(t._id)).length, ready: list.filter((r) => r.roomTypeId === String(t._id) && r.ready).length })).filter((x) => !isId(roomTypeId) || x.id === String(roomTypeId));
  return { from: a, to: b, today, nights: Math.round((Date.parse(b) - Date.parse(a)) / 86400000), rooms: shown, totalFree: list.length, readyFree: list.filter((r) => r.ready).length, byType, types: types.map((t) => ({ id: String(t._id), name: t.name })) };
}

