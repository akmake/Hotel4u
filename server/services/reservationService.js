import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import GuestProfile from '../models/GuestProfile.js';
import {
  checkAvailability,
  incrementInventory,
  consumeAvailabilityLock,
} from './availabilityService.js';
import { enqueueChannelUpdate } from './channelQueueService.js';
import { audit } from './auditService.js';

let _counter = 1000;

async function nextConfirmationNumber() {
  const last = await Reservation.findOne().sort({ createdAt: -1 }).select('confirmationNumber');
  if (last?.confirmationNumber) {
    const n = parseInt(last.confirmationNumber.replace('RES-', ''), 10);
    if (!Number.isNaN(n)) _counter = n;
  }
  return `RES-${++_counter}`;
}

export async function createReservation({ propertyId, data, actorId, actorName, ip }) {
  const {
    roomTypeId,
    arrivalDate,
    departureDate,
    primaryGuestId,
    adults,
    children,
    ratePlanId,
    ratePerNight,
    source,
    specialRequests,
    isVip,
    idempotencyKey,
  } = data;

  if (idempotencyKey) {
    const existing = await Reservation.findOne({ property: propertyId, idempotencyKey });
    if (existing) return existing;
  }

  const nights = Math.round((new Date(departureDate) - new Date(arrivalDate)) / 86400000);
  if (nights <= 0) throw new Error('Invalid stay dates');

  const avail = await checkAvailability({
    propertyId,
    roomTypeId,
    arrivalDate,
    departureDate,
    ignoreIdempotencyKey: idempotencyKey || null,
  });
  if (!avail.available) throw new Error(`No availability: ${avail.reason}`);

  if (idempotencyKey) {
    await consumeAvailabilityLock({ propertyId, idempotencyKey }).catch(() => null);
  }

  const assignedRoom = avail.availableRooms.find(r => ['clean', 'inspected'].includes(r.cleanStatus))
    || avail.availableRooms[0]
    || null;

  const totalAmount = Number(ratePerNight) * nights;
  const confNum = await nextConfirmationNumber();

  const res = await Reservation.create({
    property: propertyId,
    confirmationNumber: confNum,
    idempotencyKey: idempotencyKey || undefined,
    status: 'confirmed',
    primaryGuest: primaryGuestId,
    adults: adults || 2,
    children: children || 0,
    arrivalDate,
    departureDate,
    nights,
    source: source || 'direct',
    roomType: roomTypeId,
    ratePlan: ratePlanId,
    assignedRoom: assignedRoom?._id || null,
    ratePerNight: Number(ratePerNight),
    totalAmount,
    taxAmount: Math.round(totalAmount * 0.17),
    paymentStatus: 'unpaid',
    currency: 'ILS',
    isVip: !!isVip,
    specialRequests,
    createdBy: actorId,
    updatedBy: actorId,
  });

  await Folio.create({
    property: propertyId,
    reservation: res._id,
    ownerType: 'guest',
    status: 'open',
    currency: 'ILS',
    lines: [],
  });

  await incrementInventory(propertyId, roomTypeId, arrivalDate, departureDate, 1, {
    propertyId,
    actorId,
    actorName,
    ip,
    action: 'inventory.reservation_created',
    reason: `Reservation ${confNum}`,
  });

  if (assignedRoom) {
    await Room.findByIdAndUpdate(assignedRoom._id, { occStatus: 'due_in' });
  }

  await audit({
    property: propertyId,
    actor: actorId,
    actorName,
    action: 'reservation.created',
    entityType: 'Reservation',
    entityId: res._id,
    after: res.toObject(),
    ip,
  });

  await enqueueChannelUpdate({
    propertyId,
    channel: source || 'direct',
    eventType: 'reservation',
    payload: {
      action: 'created',
      reservationId: String(res._id),
      confirmationNumber: res.confirmationNumber,
      roomTypeId,
      arrivalDate,
      departureDate,
    },
    idempotencyKey: idempotencyKey ? `${idempotencyKey}:reservation:created` : undefined,
  }).catch(() => null);

  return res;
}

export async function checkIn({ reservationId, actorId, actorName, ip, overrideClean = false }) {
  const res = await Reservation.findById(reservationId).populate('assignedRoom');
  if (!res) throw new Error('Reservation not found');
  if (!['confirmed', 'modified'].includes(res.status)) throw new Error(`Cannot check in from status ${res.status}`);

  const today = new Date().toISOString().split('T')[0];
  if (res.arrivalDate > today) throw new Error(`Arrival date is ${res.arrivalDate}; too early for check-in`);

  const room = res.assignedRoom;
  if (!room) throw new Error('No assigned room');
  if (!overrideClean && !['clean', 'inspected'].includes(room.cleanStatus)) {
    throw new Error(`Room ${room.number} is not clean (${room.cleanStatus})`);
  }

  const before = res.toObject();

  res.status = 'in_house';
  res.checkedInAt = new Date();
  res.updatedBy = actorId;
  await res.save();

  await Room.findByIdAndUpdate(room._id, { occStatus: 'occupied' });

  const folio = await Folio.findOne({ reservation: reservationId, status: 'open' });
  if (folio) {
    const dates = [];
    const cur = new Date(res.arrivalDate);
    const end = new Date(res.departureDate);
    while (cur < end) {
      dates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }
    for (const date of dates) {
      folio.lines.push({
        type: 'charge',
        description: 'Room Night',
        amount: res.ratePerNight,
        taxAmount: Math.round(res.ratePerNight * 0.17),
        department: 'rooms',
        serviceDate: date,
        source: 'pms',
        status: 'posted',
        createdBy: actorId,
      });
    }
    await folio.save();
  }

  await GuestProfile.findByIdAndUpdate(res.primaryGuest, {
    $inc: { totalStays: 1, totalRevenue: res.totalAmount },
  });

  await audit({
    property: res.property,
    actor: actorId,
    actorName,
    action: 'reservation.check_in',
    entityType: 'Reservation',
    entityId: res._id,
    before,
    after: res.toObject(),
    ip,
  });

  return res;
}

export async function checkOut({ reservationId, actorId, actorName, ip, forceCheckout = false }) {
  const res = await Reservation.findById(reservationId).populate('assignedRoom');
  if (!res) throw new Error('Reservation not found');
  if (!['in_house', 'checked_in'].includes(res.status)) throw new Error(`Cannot check out from status ${res.status}`);

  const folio = await Folio.findOne({ reservation: reservationId, status: 'open' });
  if (folio) {
    const balance = folio.lines
      .filter(l => l.status === 'posted')
      .reduce((s, l) => s + l.amount + l.taxAmount, 0);
    if (balance > 0 && !forceCheckout) {
      throw new Error(`Open balance: ${balance.toFixed(2)}`);
    }
    folio.status = 'closed';
    folio.closedAt = new Date();
    folio.closedBy = actorId;
    await folio.save();
  }

  const before = res.toObject();
  res.status = 'checked_out';
  res.checkedOutAt = new Date();
  res.updatedBy = actorId;
  await res.save();

  const room = res.assignedRoom;
  if (room) {
    await Room.findByIdAndUpdate(room._id, { occStatus: 'checked_out', cleanStatus: 'dirty' });

    const today = new Date().toISOString().split('T')[0];
    await HousekeepingTask.create({
      property: res.property,
      room: room._id,
      reservation: res._id,
      type: 'checkout_clean',
      priority: 'high',
      status: 'new',
      date: today,
      dueTime: '12:00',
      autoCreated: true,
      notes: `Checkout: ${res.confirmationNumber}`,
    });
  }

  await audit({
    property: res.property,
    actor: actorId,
    actorName,
    action: 'reservation.check_out',
    entityType: 'Reservation',
    entityId: res._id,
    before,
    after: res.toObject(),
    ip,
  });

  return res;
}

export async function cancelReservation({ reservationId, reason, actorId, actorName, ip }) {
  const res = await Reservation.findById(reservationId);
  if (!res) throw new Error('Reservation not found');
  if (['cancelled', 'checked_out'].includes(res.status)) throw new Error('Reservation already closed/cancelled');

  const before = res.toObject();
  res.status = 'cancelled';
  res.cancelledAt = new Date();
  res.cancellationReason = reason || '';
  res.updatedBy = actorId;
  await res.save();

  await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -1, {
    propertyId: res.property,
    actorId,
    actorName,
    ip,
    action: 'inventory.reservation_cancelled',
    reason: `Reservation ${res.confirmationNumber}`,
  });

  if (res.assignedRoom) {
    await Room.findByIdAndUpdate(res.assignedRoom, { occStatus: 'vacant' });
  }

  await audit({
    property: res.property,
    actor: actorId,
    actorName,
    action: 'reservation.cancelled',
    entityType: 'Reservation',
    entityId: res._id,
    before,
    after: res.toObject(),
    reason,
    ip,
  });

  await enqueueChannelUpdate({
    propertyId: res.property,
    channel: res.source || 'direct',
    eventType: 'reservation',
    payload: { action: 'cancelled', reservationId: String(res._id), confirmationNumber: res.confirmationNumber },
    idempotencyKey: res.idempotencyKey ? `${res.idempotencyKey}:reservation:cancelled` : undefined,
  }).catch(() => null);

  return res;
}

export async function modifyReservation({ reservationId, data, actorId, actorName, ip }) {
  const res = await Reservation.findById(reservationId);
  if (!res) throw new Error('Reservation not found');
  if (!['confirmed', 'modified'].includes(res.status)) {
    throw new Error(`Cannot modify reservation from status ${res.status}`);
  }

  const before = res.toObject();
  const {
    arrivalDate,
    departureDate,
    roomTypeId,
    ratePerNight,
    ratePlanId,
    adults,
    children,
    specialRequests,
    internalNotes,
    priceOverrideReason,
  } = data;

  const datesChanged = (arrivalDate && arrivalDate !== res.arrivalDate)
    || (departureDate && departureDate !== res.departureDate);
  const typeChanged = roomTypeId && String(roomTypeId) !== String(res.roomType);

  if (datesChanged || typeChanged) {
    const newArrival = arrivalDate || res.arrivalDate;
    const newDeparture = departureDate || res.departureDate;
    const newRoomTypeId = roomTypeId || String(res.roomType);

    const nights = Math.round((new Date(newDeparture) - new Date(newArrival)) / 86400000);
    if (nights <= 0) throw new Error('Invalid dates');

    await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -1, {
      propertyId: res.property,
      actorId,
      actorName,
      ip,
      action: 'inventory.reservation_modify_release_old',
      reason: `Reservation ${res.confirmationNumber}`,
    });

    const avail = await checkAvailability({
      propertyId: String(res.property),
      roomTypeId: newRoomTypeId,
      arrivalDate: newArrival,
      departureDate: newDeparture,
      excludeReservationId: String(res._id),
    });

    if (!avail.available) {
      await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, 1, {
        propertyId: res.property,
        actorId,
        actorName,
        ip,
        action: 'inventory.reservation_modify_rollback_old',
        reason: `Reservation ${res.confirmationNumber}`,
      });
      throw new Error(`No availability for new dates: ${avail.reason}`);
    }

    await incrementInventory(res.property, newRoomTypeId, newArrival, newDeparture, 1, {
      propertyId: res.property,
      actorId,
      actorName,
      ip,
      action: 'inventory.reservation_modify_commit_new',
      reason: `Reservation ${res.confirmationNumber}`,
    });

    res.arrivalDate = newArrival;
    res.departureDate = newDeparture;
    res.nights = nights;
    if (typeChanged) res.roomType = newRoomTypeId;

    const rate = (ratePerNight != null ? Number(ratePerNight) : res.ratePerNight);
    res.ratePerNight = rate;
    res.totalAmount = rate * nights;
    res.taxAmount = Math.round(res.totalAmount * 0.17);

    if (typeChanged) {
      const bestRoom = avail.availableRooms.find(r => ['clean', 'inspected'].includes(r.cleanStatus))
        || avail.availableRooms[0]
        || null;
      res.assignedRoom = bestRoom?._id || null;
    }
  } else if (ratePerNight != null && Number(ratePerNight) !== res.ratePerNight) {
    res.ratePerNight = Number(ratePerNight);
    res.totalAmount = Number(ratePerNight) * res.nights;
    res.taxAmount = Math.round(res.totalAmount * 0.17);
  }

  if (ratePlanId !== undefined) res.ratePlan = ratePlanId || null;
  if (adults !== undefined) res.adults = adults;
  if (children !== undefined) res.children = children;
  if (specialRequests !== undefined) res.specialRequests = specialRequests;
  if (internalNotes !== undefined) res.internalNotes = internalNotes;

  res.status = 'modified';
  res.updatedBy = actorId;
  await res.save();

  await audit({
    property: res.property,
    actor: actorId,
    actorName,
    action: 'reservation.modified',
    entityType: 'Reservation',
    entityId: res._id,
    before,
    after: res.toObject(),
    reason: priceOverrideReason || 'Reservation update',
    ip,
  });

  await enqueueChannelUpdate({
    propertyId: res.property,
    channel: res.source || 'direct',
    eventType: 'reservation',
    payload: { action: 'modified', reservationId: String(res._id), confirmationNumber: res.confirmationNumber },
    idempotencyKey: res.idempotencyKey ? `${res.idempotencyKey}:reservation:modified` : undefined,
  }).catch(() => null);

  return Reservation.findById(res._id)
    .populate('primaryGuest', 'firstName lastName email phone vipLevel country')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .populate('ratePlan', 'name code')
    .lean();
}

export async function markNoShow({ reservationId, actorId, actorName, ip }) {
  const res = await Reservation.findById(reservationId);
  if (!res) throw new Error('Reservation not found');
  const before = res.toObject();

  res.status = 'no_show';
  res.noShowAt = new Date();
  res.updatedBy = actorId;
  await res.save();

  await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -1, {
    propertyId: res.property,
    actorId,
    actorName,
    ip,
    action: 'inventory.reservation_no_show',
    reason: `Reservation ${res.confirmationNumber}`,
  });
  if (res.assignedRoom) await Room.findByIdAndUpdate(res.assignedRoom, { occStatus: 'vacant' });

  await audit({
    property: res.property,
    actor: actorId,
    actorName,
    action: 'reservation.no_show',
    entityType: 'Reservation',
    entityId: res._id,
    before,
    after: res.toObject(),
    ip,
  });

  await enqueueChannelUpdate({
    propertyId: res.property,
    channel: res.source || 'direct',
    eventType: 'reservation',
    payload: { action: 'no_show', reservationId: String(res._id), confirmationNumber: res.confirmationNumber },
    idempotencyKey: res.idempotencyKey ? `${res.idempotencyKey}:reservation:no_show` : undefined,
  }).catch(() => null);

  return res;
}
