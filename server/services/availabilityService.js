import InventoryDate from '../models/InventoryDate.js';
import Room from '../models/Room.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import InventoryLock from '../models/InventoryLock.js';
import RoomBlock from '../models/RoomBlock.js';
import RoomType from '../models/RoomType.js';
import { audit } from './auditService.js';

function toIsoDate(dateObj) {
  return dateObj.toISOString().split('T')[0];
}

export function getStayDates(arrivalDate, departureDate) {
  const dates = [];
  const start = new Date(`${arrivalDate}T00:00:00.000Z`);
  const end = new Date(`${departureDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) return dates;

  const cur = new Date(start);
  while (cur < end) {
    dates.push(toIsoDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function getActiveLocksCountByDate({ propertyId, roomTypeId, dates, ignoreIdempotencyKey, session = null }) {
  const now = new Date();
  const locks = await InventoryLock.find({
    property: propertyId,
    roomType: roomTypeId,
    status: 'active',
    expiresAt: { $gt: now },
  }).session(session).lean();

  const map = new Map(dates.map((d) => [d, 0]));
  for (const lock of locks) {
    if (ignoreIdempotencyKey && lock.idempotencyKey === ignoreIdempotencyKey) continue;
    const lockDates = getStayDates(lock.arrivalDate, lock.departureDate);
    for (const d of lockDates) {
      if (map.has(d)) map.set(d, (map.get(d) || 0) + lock.roomsCount);
    }
  }
  return map;
}

export async function getOccupiedRoomIds({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId, session = null }) {
  // Any stay holding a room blocks it, whatever room type it was booked as (upgrades, moves).
  const query = {
    property: propertyId,
    assignedRoom: { $ne: null },
    status: { $nin: ['cancelled', 'no_show', 'checked_out'] },
    arrivalDate: { $lt: departureDate },
    departureDate: { $gt: arrivalDate },
  };
  if (excludeReservationId) query._id = { $ne: excludeReservationId };

  const conflicting = await Reservation.find(query).session(session).select('assignedRoom').lean();
  const ids = new Set(conflicting.map((r) => String(r.assignedRoom)).filter(Boolean));
  // Stay units hold rooms too (multi-room bookings, front-desk assignment).
  const unitQuery = {
    property: propertyId,
    assignedRoom: { $ne: null },
    status: { $in: ['reserved', 'tentative', 'checked_in', 'in_house'] },
    arrivalDate: { $lt: departureDate },
    departureDate: { $gt: arrivalDate },
  };
  if (excludeReservationId) unitQuery.reservation = { $ne: excludeReservationId };
  const units = await ReservationRoom.find(unitQuery).session(session).select('assignedRoom reservation').populate('reservation', 'status').lean();
  for (const u of units) {
    if (['cancelled', 'no_show', 'checked_out'].includes(u.reservation?.status)) continue;
    ids.add(String(u.assignedRoom));
  }
  return ids;
}

export async function checkAvailability({
  propertyId,
  roomTypeId,
  arrivalDate,
  departureDate,
  excludeReservationId = null,
  requiredRooms = 1,
  ignoreIdempotencyKey = null,
  session = null,
}) {
  const a = await assessAvailability({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId, ignoreIdempotencyKey, session });
  if (!a.dates.length) return { available: false, availableRooms: [], reason: 'Invalid stay dates' };
  const closed = a.nights.find((n) => n.stopSell);
  if (closed) return { available: false, availableRooms: [], reason: `Stop-sell on ${closed.date}` };
  const short = a.nights.find((n) => n.available < requiredRooms);
  if (short) return { available: false, availableRooms: [], reason: `Not enough availability on ${short.date}` };
  return {
    available: a.freeRoomDocs.length >= requiredRooms,
    availableRooms: a.freeRoomDocs,
    reason: a.freeRoomDocs.length < requiredRooms ? 'No physical rooms available for this stay' : null,
  };
}

async function adjustLockedCount({ propertyId, roomTypeId, arrivalDate, departureDate, delta, session = null }) {
  const dates = getStayDates(arrivalDate, departureDate);
  if (!dates.length || !delta) return;

  await InventoryDate.updateMany(
    { property: propertyId, roomType: roomTypeId, date: { $in: dates } },
    { $inc: { lockedCount: delta } }, { session },
  );

  await InventoryDate.updateMany(
    { property: propertyId, roomType: roomTypeId, date: { $in: dates }, lockedCount: { $lt: 0 } },
    { $set: { lockedCount: 0 } }, { session },
  );
}

export async function lockAvailability({
  propertyId,
  roomTypeId,
  arrivalDate,
  departureDate,
  roomsCount = 1,
  idempotencyKey,
  source = 'pms',
  timeoutSeconds = 300,
}) {
  if (!idempotencyKey) throw new Error('idempotencyKey is required');

  const existing = await InventoryLock.findOne({ property: propertyId, idempotencyKey });
  if (existing) {
    if (existing.status === 'active' && existing.expiresAt > new Date()) return existing;
    if (existing.status === 'consumed') return existing;
  }

  const avail = await checkAvailability({
    propertyId,
    roomTypeId,
    arrivalDate,
    departureDate,
    requiredRooms: roomsCount,
    ignoreIdempotencyKey: idempotencyKey,
  });
  if (!avail.available) throw new Error(`No availability: ${avail.reason}`);

  const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

  let lock;
  try {
    lock = await InventoryLock.create({
      property: propertyId,
      roomType: roomTypeId,
      arrivalDate,
      departureDate,
      roomsCount,
      idempotencyKey,
      source,
      status: 'active',
      expiresAt,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const deduped = await InventoryLock.findOne({ property: propertyId, idempotencyKey });
      if (deduped) return deduped;
    }
    throw err;
  }

  await adjustLockedCount({ propertyId, roomTypeId, arrivalDate, departureDate, delta: roomsCount });

  return lock;
}

export async function consumeAvailabilityLock({ propertyId, idempotencyKey, session = null }) {
  const lock = await InventoryLock.findOne({ property: propertyId, idempotencyKey }).session(session);
  if (!lock) throw new Error('Lock not found');
  if (lock.status === 'consumed') return lock;
  if (lock.status !== 'active' || lock.expiresAt <= new Date()) {
    throw new Error('Lock expired or inactive');
  }

  lock.status = 'consumed';
  lock.consumedAt = new Date();
  await lock.save({ session });

  await adjustLockedCount({
    propertyId,
    roomTypeId: lock.roomType,
    arrivalDate: lock.arrivalDate,
    departureDate: lock.departureDate,
    delta: -lock.roomsCount,
    session,
  });

  return lock;
}

export async function releaseAvailabilityLock({ propertyId, idempotencyKey }) {
  const lock = await InventoryLock.findOne({ property: propertyId, idempotencyKey });
  if (!lock) return null;
  if (lock.status !== 'active') return lock;

  lock.status = 'released';
  lock.releasedAt = new Date();
  await lock.save();

  await adjustLockedCount({
    propertyId,
    roomTypeId: lock.roomType,
    arrivalDate: lock.arrivalDate,
    departureDate: lock.departureDate,
    delta: -lock.roomsCount,
  });

  return lock;
}

export async function incrementInventory(propertyId, roomTypeId, arrivalDate, departureDate, delta = 1, auditContext = null, { session = null, afterCommit = null } = {}) {
  const dates = getStayDates(arrivalDate, departureDate);
  await InventoryDate.updateMany(
    { property: propertyId, roomType: roomTypeId, date: { $in: dates } },
    { $inc: { bookedCount: delta } },
    { session },
  );

  if (auditContext?.propertyId) {
    await audit({
      property: auditContext.propertyId,
      actor: auditContext.actorId || null,
      actorName: auditContext.actorName || 'system',
      action: auditContext.action || 'inventory.booked.adjust',
      entityType: 'InventoryDate',
      entityId: roomTypeId,
      before: null,
      after: { roomTypeId, arrivalDate, departureDate, delta },
      reason: auditContext.reason,
      ip: auditContext.ip, session, afterCommit,
    });
  }
}

// ── Availability from what is really there (2026-10-19) ─────────────────────────────────────────
// Per night and room type: rooms of the type that are not out of sale that night, minus stays sold
// as the type, minus rooms of the type held by stays sold as another type (upgrades, moves), minus
// short booking locks and manual holds. No pre-made inventory rows are needed: an InventoryDate row,
// when present, only adds restrictions (stop sell, CTA/CTD, min/max stay) and the overbooking allowance.
const LIVE_RES_STATUSES = ['cancelled', 'no_show', 'checked_out', 'quote', 'draft', 'waitlisted'];
const LIVE_UNIT_STATUSES = ['reserved', 'tentative', 'checked_in', 'in_house'];
const HELD_NOW = ['out_of_order', 'out_of_service', 'maintenance_hold', 'owner_hold', 'internal_use'];
const nextDay = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return toIsoDate(d); };

// Is the room out of sale on night d? Its current status (until outOfServiceUntil, or until released)
// or a dated block (INV-04).
export function roomBlockedOn(room, d, blocksByRoom) {
  if (room.active === false) return true;
  if (HELD_NOW.includes(room.opsStatus) && (!room.outOfServiceUntil || d <= room.outOfServiceUntil)) return true;
  return (blocksByRoom?.get(String(room._id)) || []).some((b) => b.from <= d && d < b.to);
}

export async function activeBlocks({ propertyId, from, to, roomTypeId, roomId, session = null }) {
  const q = { property: propertyId, status: 'active', from: { $lt: to }, to: { $gt: from } };
  if (roomTypeId) q.roomType = roomTypeId;
  if (roomId) q.room = roomId;
  const rows = await RoomBlock.find(q).session(session).lean();
  const byRoom = new Map();
  for (const b of rows) byRoom.set(String(b.room), [...(byRoom.get(String(b.room)) || []), b]);
  return byRoom;
}

// Stays (stay units where they exist) overlapping [from, to), with the room type they were sold as.
async function liveStays({ propertyId, from, to, excludeReservationId, session = null }) {
  const rq = { property: propertyId, status: { $nin: LIVE_RES_STATUSES }, arrivalDate: { $lt: to }, departureDate: { $gt: from } };
  if (excludeReservationId) rq._id = { $ne: excludeReservationId };
  const reservations = await Reservation.find(rq).session(session).select('_id roomType roomsCount arrivalDate departureDate assignedRoom').lean();
  if (!reservations.length) return [];
  const units = await ReservationRoom.find({ reservation: { $in: reservations.map((r) => r._id) } }).session(session).select('reservation roomTypeBooked assignedRoom arrivalDate departureDate status').lean();
  const byRes = new Map();
  for (const u of units) byRes.set(String(u.reservation), [...(byRes.get(String(u.reservation)) || []), u]);
  const out = [];
  for (const r of reservations) {
    const us = byRes.get(String(r._id));
    if (us?.length) {
      for (const u of us) if (LIVE_UNIT_STATUSES.includes(u.status)) out.push({ type: String(u.roomTypeBooked), room: (u.assignedRoom || (us.length === 1 ? r.assignedRoom : null)) ? String(u.assignedRoom || r.assignedRoom) : null, arrival: u.arrivalDate, departure: u.departureDate, count: 1 });
    } else if (r.roomType) {
      const n = Math.max(1, Number(r.roomsCount) || 1);
      out.push({ type: String(r.roomType), room: n === 1 && r.assignedRoom ? String(r.assignedRoom) : null, arrival: r.arrivalDate, departure: r.departureDate, count: n });
    }
  }
  return out;
}

export async function assessAvailability({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId = null, ignoreIdempotencyKey = null, stays = null, roomsOfType = null, session = null }) {
  const dates = getStayDates(arrivalDate, departureDate);
  if (!dates.length) return { dates, nights: [], freeRoomDocs: [] };
  const from = dates[0]; const to = nextDay(dates[dates.length - 1]);
  // A party must see members already written in its own transaction.
  const rooms = roomsOfType || await Room.find({ property: propertyId, roomType: roomTypeId, active: { $ne: false } }).session(session).lean();
  const blocksByRoom = await activeBlocks({ propertyId, from, to, roomTypeId, session });
  const allStays = stays || await liveStays({ propertyId, from, to, excludeReservationId, session });
  const invDocs = await InventoryDate.find({ property: propertyId, roomType: roomTypeId, date: { $in: dates } }).session(session).lean();
  const locks = await getActiveLocksCountByDate({ propertyId, roomTypeId, dates, ignoreIdempotencyKey, session });
  const type = String(roomTypeId);
  const roomIds = new Set(rooms.map((r) => String(r._id)));
  const invByDate = new Map(invDocs.map((d) => [d.date, d]));
  const nights = dates.map((date) => {
    const covering = allStays.filter((s) => s.arrival <= date && date < s.departure);
    const sold = covering.filter((s) => s.type === type).reduce((a, s) => a + s.count, 0);
    const heldByOther = covering.filter((s) => s.type !== type && s.room && roomIds.has(s.room)).length;
    const sellable = rooms.filter((r) => !roomBlockedOn(r, date, blocksByRoom)).length;
    const inv = invByDate.get(date);
    const allotment = inv ? Math.max(0, (inv.allotmentCount || 0) - (inv.releasedAllotmentCount || 0)) : 0;
    const available = sellable - sold - heldByOther - (locks.get(date) || 0) - (inv?.blockedCount || 0) - allotment + (inv?.overbookingLimit || 0);
    return {
      date, available: Math.max(0, available), total: rooms.length, outOfSale: rooms.length - sellable, sold: sold + heldByOther,
      stopSell: !!inv?.stopSell, closedToArrival: !!inv?.closedToArrival, closedToDeparture: !!inv?.closedToDeparture,
      minLos: inv?.minLos || null, maxLos: inv?.maxLos || null,
    };
  });
  const occupied = await getOccupiedRoomIds({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId, session });
  const freeRoomDocs = rooms.filter((r) => !occupied.has(String(r._id)) && dates.every((d) => !roomBlockedOn(r, d, blocksByRoom)));
  return { dates, nights, freeRoomDocs };
}

// Rooms of a type free for every night of a range (choosing a specific room).
export async function roomsFreeForStay({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId = null }) {
  const dates = getStayDates(arrivalDate, departureDate);
  if (!dates.length) return [];
  const rooms = await Room.find({ property: propertyId, roomType: roomTypeId, active: { $ne: false } }).lean();
  const blocksByRoom = await activeBlocks({ propertyId, from: dates[0], to: nextDay(dates[dates.length - 1]), roomTypeId });
  const occupied = await getOccupiedRoomIds({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId });
  return rooms.filter((r) => !occupied.has(String(r._id)) && dates.every((d) => !roomBlockedOn(r, d, blocksByRoom)));
}

// INV-01 grid: every room type × every night of a range in one pass.
export async function availabilityGrid({ propertyId, from, days = 14 }) {
  const n = Math.min(62, Math.max(1, Number(days) || 14));
  const dates = [from]; while (dates.length < n) dates.push(nextDay(dates[dates.length - 1]));
  const to = nextDay(dates[dates.length - 1]);
  const [types, allRooms, stays] = await Promise.all([
    RoomType.find({ property: propertyId, active: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).lean(),
    Room.find({ property: propertyId, active: { $ne: false } }).lean(),
    liveStays({ propertyId, from, to }),
  ]);
  const rows = [];
  for (const t of types) {
    const roomsOfType = allRooms.filter((r) => String(r.roomType) === String(t._id));
    const a = await assessAvailability({ propertyId, roomTypeId: t._id, arrivalDate: from, departureDate: to, stays, roomsOfType });
    rows.push({ roomType: { id: String(t._id), code: t.code, name: t.name }, rooms: roomsOfType.length, nights: a.nights });
  }
  const totals = dates.map((date, i) => {
    const total = rows.reduce((s, r) => s + r.rooms, 0);
    const available = rows.reduce((s, r) => s + (r.nights[i]?.available || 0), 0);
    const sold = rows.reduce((s, r) => s + (r.nights[i]?.sold || 0), 0);
    const outOfSale = rows.reduce((s, r) => s + (r.nights[i]?.outOfSale || 0), 0);
    const sellable = total - outOfSale;
    return { date, total, available, sold, outOfSale, occupancyPct: sellable > 0 ? Math.round((Math.min(sold, sellable) / sellable) * 100) : 0 };
  });
  return { from, dates, rows, totals };
}

// INV-03: availability per night (never an average) plus the physical rooms free for the whole stay.
export async function nightlyAvailability({ propertyId, roomTypeId, arrivalDate, departureDate, ignoreIdempotencyKey = null, excludeReservationId = null, session = null }) {
  const a = await assessAvailability({ propertyId, roomTypeId, arrivalDate, departureDate, ignoreIdempotencyKey, excludeReservationId, session });
  return { nights: a.nights, freeRooms: a.freeRoomDocs.length };
}
