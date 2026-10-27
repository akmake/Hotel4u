import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import Property from '../models/Property.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import GuestProfile from '../models/GuestProfile.js';
import RoomType from '../models/RoomType.js';
import Company from '../models/Company.js';
import { RatePlan } from '../models/RatePlan.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import {
  checkAvailability,
  incrementInventory,
  consumeAvailabilityLock,
  getStayDates,
} from './availabilityService.js';
import { enqueueChannelUpdate } from './channelQueueService.js';
import { audit } from './auditService.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { fireEvent } from './automationEngine.js';
import { withLocks } from './locks.js';
import { runStayTransaction } from './stayTransaction.js';
import { payloadHash } from '../domain/accounting.js';
import { randomUUID } from 'node:crypto';

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
export async function allocateConfirmationNumber(propertyId, session = null) {
  const prop = await Property.findById(propertyId).session(session).select('reservationPrefix').lean();
  const prefix = (prop?.reservationPrefix || 'RES').replace(/[^A-Za-z0-9]/g, '') || 'RES';
  for (let i = 0; i < 6; i += 1) {
    const p = await Property.findByIdAndUpdate(propertyId, { $inc: { reservationSequence: 1 } }, { returnDocument: 'after' }).session(session).select('reservationSequence').lean();
    const candidate = `${prefix}-${p?.reservationSequence ?? Date.now()}`;
    if (!(await Reservation.exists({ confirmationNumber: candidate }).session(session))) return candidate;
    const taken = await Reservation.find({ confirmationNumber: new RegExp(`^${prefix}-[0-9]+$`) }).session(session).select('confirmationNumber').lean();
    const max = taken.reduce((m, r) => Math.max(m, Number(r.confirmationNumber.slice(prefix.length + 1)) || 0), 0);
    await Property.updateOne({ _id: propertyId, reservationSequence: { $lt: max } }, { $set: { reservationSequence: max } }, { session });
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
  if (args.session) return createReservationUnlocked(args);
  const roomTypeId = args?.data?.roomTypeId;
  const key = args?.data?.idempotencyKey;
  const { idempotencyKey: ignoredKey, ...body } = args.data;
  const requestHash = payloadHash(JSON.parse(JSON.stringify(body)));
  const keys = [`inv:${args.propertyId}:${roomTypeId}`];
  if (key) keys.push(`booking:${args.propertyId}:${key}`);
  return withLocks(keys, (lease) => runStayTransaction(async (session, afterCommit) => {
    if (key) {
      const existing = await Reservation.findOne({ property: args.propertyId, idempotencyKey: key }).session(session);
      if (existing) {
        if (existing.legacyRequestHash !== requestHash) throw Object.assign(httpError('מזהה הפעולה שייך להזמנה אחרת או ללא זיהוי תוכן — יש לפתוח את ההזמנה הקיימת', 409), { code: 'request_conflict' });
        return existing;
      }
    }
    return createReservationUnlocked({ ...args, session, afterCommit, legacyRequestHash: requestHash });
  }, lease, { operation: 'יצירת הזמנה' }), { waitMs: 4000 });
}

async function createReservationUnlocked({ propertyId, data, actorId, actorName, ip, session = null, afterCommit = null, legacyRequestHash, preferredRoomId = null, excludedRoomIds = [] }) {
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

  // A valid property scope on the endpoint does not validate the referenced records.
  // Check these even for drafts and overbooking overrides, before creating any records.
  if (!(await Property.exists({ _id: propertyId }).session(session))) throw httpError('הנכס לא נמצא', 404);
  if (!(await RoomType.exists({ _id: roomTypeId, property: propertyId, active: { $ne: false } }).session(session))) throw httpError('סוג החדר לא נמצא בנכס', 422);
  if (!(await GuestProfile.exists({ _id: primaryGuestId, property: propertyId }).session(session))) throw httpError('האורח לא נמצא בנכס', 422);
  if (ratePlanId && !(await RatePlan.exists({ _id: ratePlanId, property: propertyId, active: { $ne: false } }).session(session))) throw httpError('התעריף לא נמצא בנכס', 422);
  if (companyId && !(await Company.exists({ _id: companyId, property: propertyId }).session(session))) throw httpError('החברה לא נמצאה בנכס', 422);

  if (idempotencyKey) {
    const existing = await Reservation.findOne({ property: propertyId, idempotencyKey }).session(session);
    if (existing) return existing;
  }

  const nights = Math.round((new Date(departureDate) - new Date(arrivalDate)) / 86400000);
  if (nights <= 0) throw httpError('Invalid stay dates', 400);
  const normalizedRoomsCount = Number(roomsCount ?? 1);
  const normalizedAdults = Number(adults ?? 2), normalizedChildren = Number(children ?? 0);
  if (!Number.isInteger(normalizedRoomsCount) || normalizedRoomsCount < 1 || !Number.isInteger(normalizedAdults) || normalizedAdults < 1 || !Number.isInteger(normalizedChildren) || normalizedChildren < 0) throw httpError('כמות החדרים והאורחים חייבת להיות מספר שלם ותקין', 422);

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
        session,
      })
    : { available: true, availableRooms: [], reason: null };
  if (!avail.available && !allowOverbooking) throw httpError(`No availability: ${avail.reason}`, 409);

  if (idempotencyKey && shouldCommitInventory) {
    await consumeAvailabilityLock({ propertyId, idempotencyKey, session }).catch(() => null);
  }

  const allocationRooms = (avail.availableRooms || []).filter((r) => !excludedRoomIds.map(String).includes(String(r._id)));
  const assignedRoom = !shouldAssignRoom
    ? null
    : allocationRooms.find((r) => preferredRoomId && String(r._id) === String(preferredRoomId))
    || allocationRooms.find(r => ['clean', 'inspected'].includes(r.cleanStatus))
    || allocationRooms[0]
    || null;

  const totalAmount = Number(ratePerNight) * nights * normalizedRoomsCount;
  const confNum = await allocateConfirmationNumber(propertyId, session);

  const [res] = await Reservation.create([{
    property: propertyId,
    confirmationNumber: confNum,
    idempotencyKey: idempotencyKey || undefined,
    legacyRequestHash,
    status: normalizedStatus,
    primaryGuest: primaryGuestId,
    adults: normalizedAdults,
    children: normalizedChildren,
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
    quoteExpiresAt: quoteExpiresAt ? new Date(quoteExpiresAt) : normalizedStatus === 'quote' ? new Date(Date.now() + 30 * 60000) : undefined,
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
  }], { session });

  if (shouldCreateFolio) {
    await Folio.create([{
      property: propertyId,
      reservation: res._id,
      ownerType: 'guest',
      status: 'open',
      currency: currency || 'ILS',
      lines: [],
    }], { session });
  }

  if (shouldCommitInventory) {
    await incrementInventory(propertyId, roomTypeId, arrivalDate, departureDate, normalizedRoomsCount, {
      propertyId,
      actorId,
      actorName,
      ip,
      action: 'inventory.reservation_created',
      reason: `Reservation ${confNum}`,
    }, { session, afterCommit });
  }

  // Unit 0 must hold the same room as the reservation-level pointer (one source of truth).
  const selectedRooms = shouldAssignRoom
    ? [assignedRoom, ...allocationRooms.filter((r) => String(r._id) !== String(assignedRoom?._id))]
      .filter(Boolean).slice(0, normalizedRoomsCount)
    : [];
  if (selectedRooms.length > 0 && shouldCommitInventory) {
    await Room.updateMany(
      { _id: { $in: selectedRooms.map((r) => r._id) } },
      { $set: { occStatus: 'due_in' } },
      { session },
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

  const insertedRooms = await ReservationRoom.insertMany(reservationRoomDocs, { session });

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

  await StaySegment.insertMany(segmentDocs, { session });

  await audit({
    property: propertyId,
    actor: actorId,
    actorName,
    action: 'reservation.created',
    entityType: 'Reservation',
    entityId: res._id,
    after: res.toObject(),
    ip, session, afterCommit,
  });

  await enqueueChannelUpdate({
    property: propertyId, session,
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
    idempotencyKey: idempotencyKey ? `${idempotencyKey}:reservation:created` : `reservation:${res._id}:created`,
  }).catch((err) => { if (session) throw err; });

  const notify = () => fireEvent('reservation.created', {
    property:    String(propertyId),
    reservation: res.toObject(),
    actor:       { id: actorId, name: actorName },
  }).catch(() => null);
  if (session) afterCommit?.push(notify);
  else notify();

  return res;
}

export async function checkIn({ reservationId, actorId, actorName, ip, overrideClean = false, overrideEarlyArrival = false, session = null, afterCommit = null }) {
  const res = await Reservation.findById(reservationId).session(session)
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
    { returnDocument: 'after', session },
  );
  if (!claimed) throw httpError('Reservation was checked in meanwhile', 409);
  res.status = claimed.status;
  res.checkedInAt = claimed.checkedInAt;

  await Room.findByIdAndUpdate(room._id, { occStatus: 'occupied' }, { session });

  // Lodging is not pre-posted here: day close posts each night and checkout posts any night still
  // missing (services/roomCharges.js). Posting all nights at entry double-charged with night audit.

  await GuestProfile.findByIdAndUpdate(res.primaryGuest, {
    $inc: { totalStays: 1, totalRevenue: res.totalAmount },
  }, { session });

  await audit({
    property: res.property,
    actor: actorId,
    actorName,
    action: 'reservation.check_in',
    entityType: 'Reservation',
    entityId: res._id,
    before,
    after: res.toObject(),
    ip, session, afterCommit,
  });

  const notify = () => fireEvent('checkin.completed', {
    property:    String(res.property),
    reservation: res.toObject(),
    room:        res.assignedRoom ? res.assignedRoom.toObject?.() ?? res.assignedRoom : null,
    actor:       { id: actorId, name: actorName },
  }).catch(() => null);
  if (session) afterCommit?.push(notify);
  else notify();

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
async function closeOpenUnits(reservationId, unitStatus, why, session) {
  await ReservationRoom.updateMany({ reservation: reservationId, status: { $in: ['reserved', 'tentative'] } }, { $set: { status: unitStatus } }, { session });
  await ArrivalQueueEntry.updateMany(
    { reservation: reservationId, status: 'active' },
    { $set: { status: 'removed', removalReason: why, resolvedAt: new Date() }, $inc: { __v: 1 } },
    { session },
  );
}

// Shared by notice recording and legacy closure paths; reload under the same stock lock.
export async function withReservationTransaction({ reservationId, propertyId }, work) {
  const first = await Reservation.findOne({ _id: reservationId, ...(propertyId ? { property: propertyId } : {}) });
  if (!first) throw httpError('Reservation not found', 404);
  return withLocks([`res:${reservationId}`, `inv:${first.property}:${first.roomType}`], (lease) => runStayTransaction(async (session, afterCommit) => {
    const current = await Reservation.findById(reservationId).session(session);
    if (!current || String(current.roomType) !== String(first.roomType) || String(current.property) !== String(first.property)) throw httpError('Reservation changed; refresh and retry', 409);
    return work(session, afterCommit);
  }, lease, { operation: 'סגירת הזמנה' }), { waitMs: 4000 });
}

async function assertNoEnteredUnits(reservationId, session) {
  if (await ReservationRoom.exists({ reservation: reservationId, status: { $in: ['in_house', 'checked_in', 'checked_out'] } }).session(session)) throw httpError('הזמנה כוללת יחידה שנכנסה — יש לטפל ביציאה', 409);
}

export async function cancelReservation({ reservationId, reason, actorId, actorName, ip, session = null, afterCommit = null }) {
  if (!session) return withReservationTransaction({ reservationId }, (session, afterCommit) => cancelReservation({ reservationId, reason, actorId, actorName, ip, session, afterCommit }));
  const res = await Reservation.findById(reservationId).session(session);
  if (!res) throw httpError('Reservation not found', 404);
  if (['cancelled', 'checked_out', 'no_show'].includes(res.status)) throw httpError('Reservation already closed/cancelled', 409);
  // A stay that has started is not cancelled silently (T32) — it is checked out or handled as an exception.
  if (['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'].includes(res.status)) {
    throw httpError('השהייה כבר התחילה — לא מבטלים אחרי כניסה; יש לטפל ביציאה או כחריג', 409);
  }
  // Only statuses that took inventory give it back (a draft or an unheld quote never took any).
  const heldInventory = ['confirmed', 'modified', 'pending_payment', 'hold'].includes(res.status);
  await assertNoEnteredUnits(res._id, session);

  const before = res.toObject();
  res.status = 'cancelled';
  res.cancelledAt = new Date();
  res.cancellationReason = reason || '';
  res.updatedBy = actorId;
  await res.save({ session });
  await closeOpenUnits(res._id, 'cancelled', 'ההזמנה בוטלה', session);

  if (heldInventory) {
    await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -(res.roomsCount || 1), {
      propertyId: res.property,
      actorId,
      actorName,
      ip,
      action: 'inventory.reservation_cancelled',
      reason: `Reservation ${res.confirmationNumber}`,
    }, { session, afterCommit });
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
    ip, session, afterCommit,
  });

  await enqueueChannelUpdate({
    propertyId: res.property, session,
    channel: res.source || 'direct',
    eventType: 'reservation',
    payload: { action: 'cancelled', reservationId: String(res._id), confirmationNumber: res.confirmationNumber },
    idempotencyKey: `reservation:${res._id}:cancelled:${randomUUID()}`,
  });

  afterCommit.push(() => fireEvent('reservation.cancelled', {
    property:    String(res.property),
    reservation: res.toObject(),
    actor:       { id: actorId, name: actorName },
  }).catch(() => null));

  return res;
}

export async function modifyReservation({ reservationId, data, actorId, actorName, ip }) {
  const first = await Reservation.findById(reservationId);
  if (!first) throw httpError('Reservation not found', 404);
  const keys = [`res:${reservationId}`, `inv:${first.property}:${first.roomType}`];
  if (data.roomTypeId) keys.push(`inv:${first.property}:${data.roomTypeId}`);
  const changeId = randomUUID();
  return withLocks(keys, (lease) => runStayTransaction((session, afterCommit) => modifyReservationLocked({ reservationId, data, actorId, actorName, ip, session, afterCommit, changeId, initialType: String(first.roomType) }), lease, { operation: 'שינוי הזמנה' }));
}

async function modifyReservationLocked({ reservationId, data, actorId, actorName, ip, session, afterCommit, changeId, initialType }) {
  const res = await Reservation.findById(reservationId).session(session);
  if (!res) throw httpError('Reservation not found', 404);
  if (String(res.roomType) !== initialType) throw httpError('סוג החדר השתנה — יש לרענן', 409);
  const commercialChange = ['arrivalDate', 'departureDate', 'roomTypeId', 'ratePerNight', 'ratePlanId', 'adults', 'children'].some((key) => data[key] !== undefined);
  if (commercialChange && res.board && res.board !== 'room_only') throw httpError('שינוי הזמנה עם ארוחות מתבצע מתוך תיק ההזמנה, עם בדיקת המחיר והפנסיון', 409);
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

  for (const [value, Model, label] of [[roomTypeId, RoomType, 'Room type'], [ratePlanId, RatePlan, 'Rate plan'], [companyId, Company, 'Company']]) {
    if (value && !await Model.exists({ _id: value, property: res.property }).session(session)) throw httpError(`${label} does not belong to this property`, 422);
  }
  for (const [value, minimum] of [[adults, 1], [children, 0]]) {
    if (value !== undefined && (!Number.isInteger(value) || value < minimum)) throw httpError('Invalid guest count', 422);
  }
  if (ratePerNight != null && (!Number.isFinite(Number(ratePerNight)) || Number(ratePerNight) < 0)) throw httpError('Invalid nightly rate', 422);

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
    }, { session, afterCommit });

    const avail = await checkAvailability({
      propertyId: String(res.property),
      roomTypeId: newRoomTypeId,
      arrivalDate: newArrival,
      departureDate: newDeparture,
      requiredRooms: Math.max(1, Number(res.roomsCount) || 1),
      excludeReservationId: String(res._id), session,
    });

    if (!avail.available) {
      await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, (res.roomsCount || 1), {
        propertyId: res.property,
        actorId,
        actorName,
        ip,
        action: 'inventory.reservation_modify_rollback_old',
        reason: `Reservation ${res.confirmationNumber}`,
      }, { session, afterCommit });
      throw httpError(`No availability for new dates: ${avail.reason}`, 409);
    }

    await incrementInventory(res.property, newRoomTypeId, newArrival, newDeparture, (res.roomsCount || 1), {
      propertyId: res.property,
      actorId,
      actorName,
      ip,
      action: 'inventory.reservation_modify_commit_new',
      reason: `Reservation ${res.confirmationNumber}`,
    }, { session, afterCommit });

    res.arrivalDate = newArrival;
    res.departureDate = newDeparture;
    res.nights = nights;
    if (typeChanged) res.roomType = newRoomTypeId;

    const rate = (ratePerNight != null ? Number(ratePerNight) : res.ratePerNight);
    const roomsCount = Math.max(1, Number(res.roomsCount) || 1);
    res.ratePerNight = rate;
    res.totalAmount = rate * nights * roomsCount;
    res.taxAmount = vatIncluded(res.totalAmount, (await Property.findById(res.property).session(session).select('vatRate').lean())?.vatRate);

    if (typeChanged) {
      const bestRoom = avail.availableRooms.find(r => ['clean', 'inspected'].includes(r.cleanStatus))
        || avail.availableRooms[0]
        || null;
      res.assignedRoom = bestRoom?._id || null;
    } else if (res.assignedRoom && !avail.availableRooms.some((room) => String(room._id) === String(res.assignedRoom))) {
      res.assignedRoom = null;
    }

    // Stay units carry their own range/type/room; they must follow the reservation, otherwise
    // assignment and conflict checks run against the old dates.
    const unitDocs = await ReservationRoom.find({ reservation: res._id, status: { $in: ['reserved', 'tentative'] } }).session(session).sort({ createdAt: 1, _id: 1 });
    for (const [i, u] of unitDocs.entries()) {
      u.arrivalDate = newArrival;
      u.departureDate = newDeparture;
      u.nightlyRate = rate;
      if (typeChanged) {
        u.roomTypeBooked = newRoomTypeId;
        u.assignedRoom = i === 0 ? (res.assignedRoom || null) : null;
      } else if (datesChanged && u.assignedRoom) {
        if (!avail.availableRooms.some((room) => String(room._id) === String(u.assignedRoom))) u.assignedRoom = null;
      }
      await u.save({ session });
    }
  } else if (ratePerNight != null && Number(ratePerNight) !== res.ratePerNight) {
    res.ratePerNight = Number(ratePerNight);
    res.totalAmount = Number(ratePerNight) * res.nights * Math.max(1, Number(res.roomsCount) || 1);
    res.taxAmount = vatIncluded(res.totalAmount, (await Property.findById(res.property).session(session).select('vatRate').lean())?.vatRate);
    await ReservationRoom.updateMany({ reservation: res._id, status: { $in: ['reserved', 'tentative'] } }, { $set: { nightlyRate: Number(ratePerNight) } }, { session });
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

  if (datesChanged || typeChanged || (ratePerNight != null && Number(ratePerNight) !== before.ratePerNight)) {
    res.set('priceSnapshot.nightly', getStayDates(res.arrivalDate, res.departureDate).map((date) => ({ date, price: res.ratePerNight })));
    res.set('priceSnapshot.total', res.totalAmount);
    res.set('priceSnapshot.computedAt', new Date());
    const units = await ReservationRoom.find({ reservation: res._id, status: { $in: ['reserved', 'tentative'] } }).session(session);
    await StaySegment.deleteMany({ reservation: res._id }, { session });
    if (units.length) await StaySegment.insertMany(units.map((unit) => ({
      reservationRoom: unit._id, reservation: res._id, property: res.property,
      fromDate: unit.arrivalDate, toDate: unit.departureDate, roomType: unit.roomTypeBooked,
      room: unit.assignedRoom || null, ratePerNight: unit.nightlyRate, ratePlan: res.ratePlan,
      changeReason: priceOverrideReason || 'Reservation update', createdBy: actorId, createdByName: actorName,
    })), { session });
  }

  res.status = 'modified';
  res.updatedBy = actorId;
  await res.save({ session });

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
    ip, session, afterCommit,
  });

  await enqueueChannelUpdate({
    propertyId: res.property, session,
    channel: res.source || 'direct',
    eventType: 'reservation',
    payload: { action: 'modified', reservationId: String(res._id), confirmationNumber: res.confirmationNumber },
    idempotencyKey: `reservation:${res._id}:modified:${changeId}`,
  });

  afterCommit.push(() => fireEvent('reservation.modified', {
    property:    String(res.property),
    reservation: res.toObject(),
    actor:       { id: actorId, name: actorName },
  }).catch(() => null));

  return Reservation.findById(res._id).session(session)
    .populate('primaryGuest', 'firstName lastName email phone vipLevel country')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .populate('ratePlan', 'name code')
    .lean();
}

export async function markNoShow({ reservationId, actorId, actorName, ip, session = null, afterCommit = null }) {
  if (!session) return withReservationTransaction({ reservationId }, (session, afterCommit) => markNoShow({ reservationId, actorId, actorName, ip, session, afterCommit }));
  const res = await Reservation.findById(reservationId).session(session);
  if (!res) throw httpError('Reservation not found', 404);
  const allowedStatuses = new Set(['confirmed', 'modified', 'pending_payment', 'hold']);
  if (!allowedStatuses.has(res.status)) {
    throw httpError(`Cannot mark no-show from status ${res.status}`, 409);
  }
  await assertNoEnteredUnits(res._id, session);
  const property = await Property.findById(res.property).session(session).select('timezone').lean();
  if (res.arrivalDate > todayYmdInTimezone(property?.timezone)) throw httpError('לא ניתן לסמן אי הגעה לפני יום ההגעה', 409);
  const units = await ReservationRoom.countDocuments({ reservation: res._id }).session(session);
  if ((res.roomsCount || 1) > 1 || units > 1) throw httpError('הזמנה מרובת חדרים — נדרש טיפול לפי יחידה', 409);
  if (await ArrivalQueueEntry.exists({ reservation: res._id, status: 'active' }).session(session)) throw httpError('האורח רשום בתור ההמתנה — יש להסיר מהתור קודם', 409);
  const before = res.toObject();

  res.status = 'no_show';
  res.noShowAt = new Date();
  res.updatedBy = actorId;
  await res.save({ session });
  await closeOpenUnits(res._id, 'no_show', 'סומנה אי הגעה', session);

  await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -(res.roomsCount || 1), {
    propertyId: res.property,
    actorId,
    actorName,
    ip,
    action: 'inventory.reservation_no_show',
    reason: `Reservation ${res.confirmationNumber}`,
  }, { session, afterCommit });

  await audit({
    property: res.property,
    actor: actorId,
    actorName,
    action: 'reservation.no_show',
    entityType: 'Reservation',
    entityId: res._id,
    before,
    after: res.toObject(),
    ip, session, afterCommit,
  });

  await enqueueChannelUpdate({
    propertyId: res.property, session,
    channel: res.source || 'direct',
    eventType: 'reservation',
    payload: { action: 'no_show', reservationId: String(res._id), confirmationNumber: res.confirmationNumber },
    idempotencyKey: `reservation:${res._id}:no_show:${randomUUID()}`,
  });

  afterCommit.push(() => fireEvent('reservation.noshow', {
    property:    String(res.property),
    reservation: res.toObject(),
    actor:       { id: actorId, name: actorName },
  }).catch(() => null));

  return res;
}

