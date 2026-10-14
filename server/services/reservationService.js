import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import Property from '../models/Property.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import GuestProfile from '../models/GuestProfile.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import {
  checkAvailability,
  incrementInventory,
  consumeAvailabilityLock,
} from './availabilityService.js';
import { enqueueChannelUpdate } from './channelQueueService.js';
import { audit } from './auditService.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { fireEvent } from './automationEngine.js';
import { withLocks } from './locks.js';

// Quoted prices include VAT: the tax part is extracted (118 at 18% → 18), never added on top.
function vatIncluded(gross, ratePct) {
  const rate = Number(ratePct ?? 18) / 100;
  return Math.round((Number(gross) - Number(gross) / (1 + rate)) * 100) / 100;
}

function httpError(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Atomic per-property sequence (Property.reservationSequence). If the sequence is behind numbers
// that already exist (seeded/imported data), it jumps past the highest one and tries again.
export async function allocateConfirmationNumber(propertyId) {
  const prop = await Property.findById(propertyId).select('reservationPrefix').lean();
  const prefix = (prop?.reservationPrefix || 'RES').replace(/[^A-Za-z0-9]/g, '') || 'RES';
  for (let i = 0; i < 6; i += 1) {
    const p = await Property.findByIdAndUpdate(propertyId, { $inc: { reservationSequence: 1 } }, { returnDocument: 'after' }).select('reservationSequence').lean();
    const candidate = `${prefix}-${p?.reservationSequence ?? Date.now()}`;
    if (!(await Reservation.exists({ confirmationNumber: candidate }))) return candidate;
    const taken = await Reservation.find({ confirmationNumber: new RegExp(`^${prefix}-[0-9]+$`) }).select('confirmationNumber').lean();
    const max = taken.reduce((m, r) => Math.max(m, Number(r.confirmationNumber.slice(prefix.length + 1)) || 0), 0);
    await Property.updateOne({ _id: propertyId, reservationSequence: { $lt: max } }, { $set: { reservationSequence: max } });
  }
  throw httpError('לא ניתן להקצות מספר אישור — נסו שוב', 503);
}

async function todayByPropertyTimezone(propertyId) {
  const prop = await Property.findById(propertyId).select('timezone').lean();
  return todayYmdInTimezone(prop?.timezone || 'Asia/Jerusalem');
}

// Selling inventory is check-then-write; two clerks selling the last room at the same moment must
// not both succeed (T01). The whole creation runs under a per room-type lock; a concurrent request
// waits briefly and then sees the room as taken.
export async function createReservation(args) {
  const roomTypeId = args?.data?.roomTypeId;
  if (!roomTypeId || ['draft', 'quote'].includes(String(args?.data?.bookingStatus || '').toLowerCase())) return createReservationUnlocked(args);
  return withLocks([`inv:${args.propertyId}:${roomTypeId}`], () => createReservationUnlocked(args), { waitMs: 4000 });
}

async function createReservationUnlocked({ propertyId, data, actorId, actorName, ip }) {
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
    language,
    currency,
    marketSegment,
    companyId,
    travelAgentId,
    guaranteeType,
    guestNotes,
    internalNotes,
    channelReservationId,
    externalId,
    roomsCount,
    bookingStatus,
    cancellationPolicy,
    depositPolicy,
    quoteExpiresAt,
    holdExpiresAt,
    allowOverbooking,
  } = data;

  if (idempotencyKey) {
    const existing = await Reservation.findOne({ property: propertyId, idempotencyKey });
    if (existing) return existing;
  }

  const nights = Math.round((new Date(departureDate) - new Date(arrivalDate)) / 86400000);
  if (nights <= 0) throw httpError('Invalid stay dates', 400);
  const normalizedRoomsCount = Math.max(1, Number(roomsCount) || 1);

  const allowedStatus = new Set(['draft', 'quote', 'hold', 'pending_payment', 'confirmed']);
  const normalizedStatus = allowedStatus.has(String(bookingStatus || '').toLowerCase())
    ? String(bookingStatus).toLowerCase()
    : 'confirmed';
  const shouldCheckAvailability = normalizedStatus !== 'draft';
  const shouldCommitInventory = ['confirmed', 'pending_payment', 'hold'].includes(normalizedStatus);
  const shouldCreateFolio = ['confirmed', 'pending_payment', 'hold'].includes(normalizedStatus);
  const shouldAssignRoom = !['quote', 'draft'].includes(normalizedStatus);

  const avail = shouldCheckAvailability
    ? await checkAvailability({
        propertyId,
        roomTypeId,
        arrivalDate,
        departureDate,
        requiredRooms: normalizedRoomsCount,
        ignoreIdempotencyKey: idempotencyKey || null,
      })
    : { available: true, availableRooms: [], reason: null };
  if (!avail.available && !allowOverbooking) throw httpError(`No availability: ${avail.reason}`, 409);

  if (idempotencyKey && shouldCommitInventory) {
    await consumeAvailabilityLock({ propertyId, idempotencyKey }).catch(() => null);
  }

  const assignedRoom = !shouldAssignRoom
    ? null
    : avail.availableRooms.find(r => ['clean', 'inspected'].includes(r.cleanStatus))
    || avail.availableRooms[0]
    || null;

  const totalAmount = Number(ratePerNight) * nights * normalizedRoomsCount;
  const confNum = await allocateConfirmationNumber(propertyId);

  const res = await Reservation.create({
    property: propertyId,
    confirmationNumber: confNum,
    idempotencyKey: idempotencyKey || undefined,
    status: normalizedStatus,
    primaryGuest: primaryGuestId,
    adults: adults || 2,
    children: children || 0,
    arrivalDate,
    departureDate,
    nights,
    roomsCount: normalizedRoomsCount,
    source: source || 'direct',
    marketSegment: marketSegment || undefined,
    company: companyId || undefined,
    travelAgent: travelAgentId || undefined,
    roomType: roomTypeId,
    ratePlan: ratePlanId,
    assignedRoom: assignedRoom?._id || null,
    ratePerNight: Number(ratePerNight),
    totalAmount,
    taxAmount: vatIncluded(totalAmount, (await Property.findById(propertyId).select('vatRate').lean())?.vatRate),
    paymentStatus: 'unpaid',
    currency: currency || 'ILS',
    guaranteeType: guaranteeType || 'none',
    confirmationSent: false,
    cancellationPolicy: cancellationPolicy || undefined,
    depositPolicy: depositPolicy || undefined,
    quoteExpiresAt: quoteExpiresAt ? new Date(quoteExpiresAt) : undefined,
    holdExpiresAt: holdExpiresAt ? new Date(holdExpiresAt) : undefined,
    isVip: !!isVip,
    isOverbooking: !!allowOverbooking,
    language: language || 'he',
    externalId: externalId || undefined,
    channelReservationId: channelReservationId || undefined,
    internalNotes: internalNotes || undefined,
    guestNotes: guestNotes || undefined,
    specialRequests,
    createdBy: actorId,
    updatedBy: actorId,
  });

  if (shouldCreateFolio) {
    await Folio.create({
      property: propertyId,
      reservation: res._id,
      ownerType: 'guest',
      status: 'open',
      currency: currency || 'ILS',
      lines: [],
    });
  }

  if (shouldCommitInventory) {
    await incrementInventory(propertyId, roomTypeId, arrivalDate, departureDate, normalizedRoomsCount, {
      propertyId,
      actorId,
      actorName,
      ip,
      action: 'inventory.reservation_created',
      reason: `Reservation ${confNum}`,
    });
  }

  // Unit 0 must hold the same room as the reservation-level pointer (one source of truth).
  const selectedRooms = shouldAssignRoom
    ? [assignedRoom, ...(avail.availableRooms || []).filter((r) => String(r._id) !== String(assignedRoom?._id))]
      .filter(Boolean).slice(0, normalizedRoomsCount)
    : [];
  if (selectedRooms.length > 0 && shouldCommitInventory) {
    await Room.updateMany(
      { _id: { $in: selectedRooms.map((r) => r._id) } },
      { $set: { occStatus: 'due_in' } }
    );
  }

  const reservationRoomDocs = [];
  for (let i = 0; i < normalizedRoomsCount; i++) {
    const selectedRoom = selectedRooms[i] || null;
    reservationRoomDocs.push({
      reservation: res._id,
      property: propertyId,
      roomTypeBooked: roomTypeId,
      assignedRoom: selectedRoom?._id || null,
      arrivalDate,
      departureDate,
      ratePlan: ratePlanId || null,
      nightlyRate: Number(ratePerNight),
      guests: i === 0 ? [primaryGuestId] : [],
      status: normalizedStatus === 'draft' ? 'tentative' : 'reserved',
      notes: specialRequests || undefined,
    });
  }

  const insertedRooms = await ReservationRoom.insertMany(reservationRoomDocs);

  const segmentDocs = insertedRooms.map((rr) => ({
    reservationRoom: rr._id,
    reservation: res._id,
    property: propertyId,
    fromDate: arrivalDate,
    toDate: departureDate,
    roomType: roomTypeId,
    room: rr.assignedRoom || null,
    ratePerNight: Number(ratePerNight),
    ratePlan: ratePlanId || null,
    changeReason: 'Initial booking',
    createdBy: actorId || undefined,
    createdByName: actorName || 'system',
  }));

  await StaySegment.insertMany(segmentDocs);

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
      status: normalizedStatus,
    },
    idempotencyKey: idempotencyKey ? `${idempotencyKey}:reservation:created` : undefined,
  }).catch(() => null);

  fireEvent('reservation.created', {
    property:    String(propertyId),
    reservation: res.toObject(),
    actor:       { id: actorId, name: actorName },
  }).catch(() => null);

  return res;
}

export async function checkIn({ reservationId, actorId, actorName, ip, overrideClean = false, overrideEarlyArrival = false }) {
  const res = await Reservation.findById(reservationId)
    .populate('assignedRoom')
    .populate('primaryGuest', 'isBlacklisted blacklistReason firstName lastName');
  if (!res) throw httpError('Reservation not found', 404);
  if (!['confirmed', 'modified', 'pending_payment'].includes(res.status)) throw httpError(`Cannot check in from status ${res.status}`, 409);

  // 14.1 — Blacklist check
  if (res.primaryGuest?.isBlacklisted) {
    throw httpError(`Guest ${res.primaryGuest.firstName} ${res.primaryGuest.lastName} is blacklisted: ${res.primaryGuest.blacklistReason || 'no reason given'}`, 409);
  }

  // 14.1 — Arrival date validation
  const today = await todayByPropertyTimezone(res.property);
  if (res.arrivalDate > today && !overrideEarlyArrival) {
    throw httpError(`Arrival date is ${res.arrivalDate}; early check-in requires manager override`, 409);
  }

  const room = res.assignedRoom;
  if (!room) throw httpError('No assigned room - assign a room before check-in', 409);
  if (!overrideClean && !['clean', 'inspected'].includes(room.cleanStatus)) {
    throw httpError(`Room ${room.number} is not clean (${room.cleanStatus})`, 409);
  }
  if (room.opsStatus === 'out_of_order') {
    throw httpError(`Room ${room.number} is out of order`, 409);
  }

  const before = res.toObject();

  // Atomic claim: only one concurrent request can move the reservation into the house.
  const claimed = await Reservation.findOneAndUpdate(
    { _id: res._id, status: { $in: ['confirmed', 'modified', 'pending_payment'] } },
    { $set: { status: 'in_house', checkedInAt: new Date(), updatedBy: actorId } },
    { returnDocument: 'after' },
  );
  if (!claimed) throw httpError('Reservation was checked in meanwhile', 409);
  res.status = claimed.status;
  res.checkedInAt = claimed.checkedInAt;

  await Room.findByIdAndUpdate(room._id, { occStatus: 'occupied' });

  // Lodging is not pre-posted here: day close posts each night and checkout posts any night still
  // missing (services/roomCharges.js). Posting all nights at entry double-charged with night audit.

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

  fireEvent('checkin.completed', {
    property:    String(res.property),
    reservation: res.toObject(),
    room:        res.assignedRoom ? res.assignedRoom.toObject?.() ?? res.assignedRoom : null,
    actor:       { id: actorId, name: actorName },
  }).catch(() => null);

  return res;
}

export async function checkOut({ reservationId, actorId, actorName, ip, forceCheckout = false }) {
  const res = await Reservation.findById(reservationId).populate('assignedRoom');
  if (!res) throw httpError('Reservation not found', 404);
  if (!['in_house', 'checked_in'].includes(res.status)) throw httpError(`Cannot check out from status ${res.status}`, 409);

  const folio = await Folio.findOne({ reservation: reservationId, status: 'open' });
  if (folio) {
    const balance = folio.lines
      .filter(l => l.status === 'posted')
      .reduce((s, l) => s + l.amount + l.taxAmount, 0);
    if (balance > 0 && !forceCheckout) {
      throw httpError(`Open balance: ${balance.toFixed(2)}`, 409);
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

    const today = await todayByPropertyTimezone(res.property);
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

  fireEvent('checkout.completed', {
    property:    String(res.property),
    reservation: res.toObject(),
    room:        room ? { _id: String(room._id), number: room.number, floor: room.floor } : null,
    actor:       { id: actorId, name: actorName },
  }).catch(() => null);

  return res;
}

// A stay that ends without entering closes its open units and any waiting-queue entry, whatever
// screen or job ended it (cancel, no-show, night audit).
async function closeOpenUnits(reservationId, unitStatus, why) {
  await ReservationRoom.updateMany({ reservation: reservationId, status: { $in: ['reserved', 'tentative'] } }, { $set: { status: unitStatus } });
  await ArrivalQueueEntry.updateMany(
    { reservation: reservationId, status: 'active' },
    { $set: { status: 'removed', removalReason: why, resolvedAt: new Date() }, $inc: { __v: 1 } },
  );
}

export async function cancelReservation({ reservationId, reason, actorId, actorName, ip }) {
  const res = await Reservation.findById(reservationId);
  if (!res) throw httpError('Reservation not found', 404);
  if (['cancelled', 'checked_out', 'no_show'].includes(res.status)) throw httpError('Reservation already closed/cancelled', 409);
  // A stay that has started is not cancelled silently (T32) — it is checked out or handled as an exception.
  if (['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'].includes(res.status)) {
    throw httpError('השהייה כבר התחילה — לא מבטלים אחרי כניסה; יש לטפל ביציאה או כחריג', 409);
  }
  // Only statuses that took inventory give it back (a draft or an unheld quote never took any).
  const heldInventory = ['confirmed', 'modified', 'pending_payment', 'hold'].includes(res.status);

  const before = res.toObject();
  res.status = 'cancelled';
  res.cancelledAt = new Date();
  res.cancellationReason = reason || '';
  res.updatedBy = actorId;
  await res.save();
  await closeOpenUnits(res._id, 'cancelled', 'ההזמנה בוטלה');

  if (heldInventory) {
    await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -(res.roomsCount || 1), {
      propertyId: res.property,
      actorId,
      actorName,
      ip,
      action: 'inventory.reservation_cancelled',
      reason: `Reservation ${res.confirmationNumber}`,
    });
  }

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

  fireEvent('reservation.cancelled', {
    property:    String(res.property),
    reservation: res.toObject(),
    actor:       { id: actorId, name: actorName },
  }).catch(() => null);

  return res;
}

export async function modifyReservation({ reservationId, data, actorId, actorName, ip }) {
  const res = await Reservation.findById(reservationId);
  if (!res) throw httpError('Reservation not found', 404);
  if (!['confirmed', 'modified'].includes(res.status)) {
    throw httpError(`Cannot modify reservation from status ${res.status}`, 409);
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
    guestNotes,
    internalNotes,
    marketSegment,
    companyId,
    travelAgentId,
    group,
    guaranteeType,
    channelReservationId,
    externalId,
    priceOverrideReason,
    cancellationPolicy,
    depositPolicy,
  } = data;

  const datesChanged = (arrivalDate && arrivalDate !== res.arrivalDate)
    || (departureDate && departureDate !== res.departureDate);
  const typeChanged = roomTypeId && String(roomTypeId) !== String(res.roomType);

  if (datesChanged || typeChanged) {
    const newArrival = arrivalDate || res.arrivalDate;
    const newDeparture = departureDate || res.departureDate;
    const newRoomTypeId = roomTypeId || String(res.roomType);

    const nights = Math.round((new Date(newDeparture) - new Date(newArrival)) / 86400000);
    if (nights <= 0) throw httpError('Invalid dates', 400);

    await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -(res.roomsCount || 1), {
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
      requiredRooms: Math.max(1, Number(res.roomsCount) || 1),
      excludeReservationId: String(res._id),
    });

    if (!avail.available) {
      await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, (res.roomsCount || 1), {
        propertyId: res.property,
        actorId,
        actorName,
        ip,
        action: 'inventory.reservation_modify_rollback_old',
        reason: `Reservation ${res.confirmationNumber}`,
      });
      throw httpError(`No availability for new dates: ${avail.reason}`, 409);
    }

    await incrementInventory(res.property, newRoomTypeId, newArrival, newDeparture, (res.roomsCount || 1), {
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
    const roomsCount = Math.max(1, Number(res.roomsCount) || 1);
    res.ratePerNight = rate;
    res.totalAmount = rate * nights * roomsCount;
    res.taxAmount = vatIncluded(res.totalAmount, (await Property.findById(res.property).select('vatRate').lean())?.vatRate);

    if (typeChanged) {
      const bestRoom = avail.availableRooms.find(r => ['clean', 'inspected'].includes(r.cleanStatus))
        || avail.availableRooms[0]
        || null;
      res.assignedRoom = bestRoom?._id || null;
    }

    // Stay units carry their own range/type/room; they must follow the reservation, otherwise
    // assignment and conflict checks run against the old dates.
    const unitDocs = await ReservationRoom.find({ reservation: res._id, status: { $in: ['reserved', 'tentative'] } }).sort({ createdAt: 1, _id: 1 });
    for (const [i, u] of unitDocs.entries()) {
      u.arrivalDate = newArrival;
      u.departureDate = newDeparture;
      u.nightlyRate = rate;
      if (typeChanged) {
        u.roomTypeBooked = newRoomTypeId;
        u.assignedRoom = i === 0 ? (res.assignedRoom || null) : null;
      } else if (datesChanged && u.assignedRoom) {
        // The room was checked for the old range only; release it for re-assignment unless it is
        // the reservation's own pointer, which checkAvailability just validated.
        if (String(u.assignedRoom) !== String(res.assignedRoom || '')) u.assignedRoom = null;
      }
      await u.save();
    }
  } else if (ratePerNight != null && Number(ratePerNight) !== res.ratePerNight) {
    res.ratePerNight = Number(ratePerNight);
    res.totalAmount = Number(ratePerNight) * res.nights * Math.max(1, Number(res.roomsCount) || 1);
    res.taxAmount = vatIncluded(res.totalAmount, (await Property.findById(res.property).select('vatRate').lean())?.vatRate);
    await ReservationRoom.updateMany({ reservation: res._id, status: { $in: ['reserved', 'tentative'] } }, { $set: { nightlyRate: Number(ratePerNight) } });
  }

  if (ratePlanId !== undefined) res.ratePlan = ratePlanId || null;
  if (adults !== undefined) res.adults = adults;
  if (children !== undefined) res.children = children;
  if (specialRequests !== undefined) res.specialRequests = specialRequests;
  if (guestNotes !== undefined) res.guestNotes = guestNotes;
  if (internalNotes !== undefined) res.internalNotes = internalNotes;
  if (marketSegment !== undefined) res.marketSegment = marketSegment;
  if (companyId !== undefined) res.company = companyId || null;
  if (travelAgentId !== undefined) res.travelAgent = travelAgentId || null;
  if (group !== undefined) res.group = group || null;
  if (guaranteeType !== undefined) res.guaranteeType = guaranteeType || 'none';
  if (channelReservationId !== undefined) res.channelReservationId = channelReservationId || null;
  if (externalId !== undefined) res.externalId = externalId || null;
  if (cancellationPolicy !== undefined) res.cancellationPolicy = cancellationPolicy || null;
  if (depositPolicy !== undefined) res.depositPolicy = depositPolicy || null;

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

  fireEvent('reservation.modified', {
    property:    String(res.property),
    reservation: res.toObject(),
    actor:       { id: actorId, name: actorName },
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
  if (!res) throw httpError('Reservation not found', 404);
  const allowedStatuses = new Set(['confirmed', 'modified', 'pending_payment', 'hold']);
  if (!allowedStatuses.has(res.status)) {
    throw httpError(`Cannot mark no-show from status ${res.status}`, 409);
  }
  const before = res.toObject();

  res.status = 'no_show';
  res.noShowAt = new Date();
  res.updatedBy = actorId;
  await res.save();
  await closeOpenUnits(res._id, 'no_show', 'סומנה אי הגעה');

  await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -(res.roomsCount || 1), {
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

  fireEvent('reservation.noshow', {
    property:    String(res.property),
    reservation: res.toObject(),
    actor:       { id: actorId, name: actorName },
  }).catch(() => null);

  return res;
}

