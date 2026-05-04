import InventoryDate from '../models/InventoryDate.js';
import Room from '../models/Room.js';
import Reservation from '../models/Reservation.js';
import InventoryLock from '../models/InventoryLock.js';
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

async function getActiveLocksCountByDate({ propertyId, roomTypeId, dates, ignoreIdempotencyKey }) {
  const now = new Date();
  const locks = await InventoryLock.find({
    property: propertyId,
    roomType: roomTypeId,
    status: 'active',
    expiresAt: { $gt: now },
  }).lean();

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

async function getOccupiedRoomIds({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId }) {
  const query = {
    property: propertyId,
    roomType: roomTypeId,
    assignedRoom: { $ne: null },
    status: { $nin: ['cancelled', 'no_show', 'checked_out'] },
    arrivalDate: { $lt: departureDate },
    departureDate: { $gt: arrivalDate },
  };
  if (excludeReservationId) query._id = { $ne: excludeReservationId };

  const conflicting = await Reservation.find(query).select('assignedRoom').lean();
  return new Set(conflicting.map((r) => String(r.assignedRoom)).filter(Boolean));
}

function isRoomSellableForArrival(room, arrivalDate) {
  if (!room?.active) return false;
  if (room.opsStatus === 'available') return true;
  if (room.opsStatus === 'out_of_service') {
    // Future sale is allowed only if a return-to-service date is configured.
    return !!room.outOfServiceUntil && room.outOfServiceUntil < arrivalDate;
  }
  return false;
}

function computeAvailableCount(inv, lockedCountForDate) {
  const sellable = inv.physicalCount - inv.blockedCount - inv.oooCount;
  const effectiveAllotment = Math.max(0, (inv.allotmentCount || 0) - (inv.releasedAllotmentCount || 0));
  return sellable - inv.bookedCount - inv.tentativeCount - effectiveAllotment - lockedCountForDate + inv.overbookingLimit;
}

export async function checkAvailability({
  propertyId,
  roomTypeId,
  arrivalDate,
  departureDate,
  excludeReservationId = null,
  requiredRooms = 1,
  ignoreIdempotencyKey = null,
}) {
  const dates = getStayDates(arrivalDate, departureDate);
  if (dates.length === 0) {
    return { available: false, availableRooms: [], reason: 'Invalid stay dates' };
  }

  const invDocs = await InventoryDate.find({
    property: propertyId,
    roomType: roomTypeId,
    date: { $in: dates },
  }).lean();
  const invByDate = new Map(invDocs.map((d) => [d.date, d]));

  const activeLocksByDate = await getActiveLocksCountByDate({
    propertyId,
    roomTypeId,
    dates,
    ignoreIdempotencyKey,
  });

  for (const date of dates) {
    const inv = invByDate.get(date);
    if (!inv) {
      return { available: false, availableRooms: [], reason: `Missing inventory row for ${date}` };
    }
    if (inv.stopSell) {
      return { available: false, availableRooms: [], reason: `Stop-sell on ${date}` };
    }

    const available = computeAvailableCount(inv, activeLocksByDate.get(date) || 0);
    if (available < requiredRooms) {
      return { available: false, availableRooms: [], reason: `Not enough availability on ${date}` };
    }
  }

  const occupiedRoomIds = await getOccupiedRoomIds({
    propertyId,
    roomTypeId,
    arrivalDate,
    departureDate,
    excludeReservationId,
  });

  const candidateRooms = await Room.find({
    property: propertyId,
    roomType: roomTypeId,
    active: true,
    opsStatus: { $in: ['available', 'out_of_service'] },
  }).lean();

  const freeRooms = candidateRooms.filter((room) => {
    if (occupiedRoomIds.has(String(room._id))) return false;
    return isRoomSellableForArrival(room, arrivalDate);
  });

  return {
    available: freeRooms.length >= requiredRooms,
    availableRooms: freeRooms,
    reason: freeRooms.length < requiredRooms ? 'No physical rooms available for this stay' : null,
  };
}

async function adjustLockedCount({ propertyId, roomTypeId, arrivalDate, departureDate, delta }) {
  const dates = getStayDates(arrivalDate, departureDate);
  if (!dates.length || !delta) return;

  await InventoryDate.updateMany(
    { property: propertyId, roomType: roomTypeId, date: { $in: dates } },
    { $inc: { lockedCount: delta } }
  );

  await InventoryDate.updateMany(
    { property: propertyId, roomType: roomTypeId, date: { $in: dates }, lockedCount: { $lt: 0 } },
    { $set: { lockedCount: 0 } }
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

export async function consumeAvailabilityLock({ propertyId, idempotencyKey }) {
  const lock = await InventoryLock.findOne({ property: propertyId, idempotencyKey });
  if (!lock) throw new Error('Lock not found');
  if (lock.status === 'consumed') return lock;
  if (lock.status !== 'active' || lock.expiresAt <= new Date()) {
    throw new Error('Lock expired or inactive');
  }

  lock.status = 'consumed';
  lock.consumedAt = new Date();
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

export async function incrementInventory(propertyId, roomTypeId, arrivalDate, departureDate, delta = 1, auditContext = null) {
  const dates = getStayDates(arrivalDate, departureDate);
  await InventoryDate.updateMany(
    { property: propertyId, roomType: roomTypeId, date: { $in: dates } },
    { $inc: { bookedCount: delta } }
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
      ip: auditContext.ip,
    }).catch(() => null);
  }
}
