import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import GuestProfile from '../models/GuestProfile.js';
import { checkAvailability, incrementInventory } from './availabilityService.js';
import { audit } from './auditService.js';

let _counter = 1000;
async function nextConfirmationNumber() {
  // In production use an atomic counter in DB; this is fine for MVP
  const last = await Reservation.findOne().sort({ createdAt: -1 }).select('confirmationNumber');
  if (last?.confirmationNumber) {
    const n = parseInt(last.confirmationNumber.replace('RES-', ''), 10);
    if (!isNaN(n)) _counter = n;
  }
  return `RES-${++_counter}`;
}

// ─── Create Reservation ────────────────────────────────────────────────────────
export async function createReservation({ propertyId, data, actorId, actorName, ip }) {
  const { roomTypeId, arrivalDate, departureDate, primaryGuestId, adults, children,
          ratePlanId, ratePerNight, source, specialRequests, isVip } = data;

  const nights = Math.round((new Date(departureDate) - new Date(arrivalDate)) / 86400000);
  if (nights <= 0) throw new Error('תאריכים לא תקינים');

  // 1. Availability check
  const avail = await checkAvailability({ propertyId, roomTypeId, arrivalDate, departureDate });
  if (!avail.available) throw new Error(`אין זמינות: ${avail.reason}`);

  // 2. Assign best available room (clean + inspected first)
  let assignedRoom = avail.availableRooms.find(r => ['clean','inspected'].includes(r.cleanStatus))
    || avail.availableRooms[0]
    || null;

  const totalAmount = ratePerNight * nights;
  const confNum = await nextConfirmationNumber();

  // 3. Create reservation
  const res = await Reservation.create({
    property: propertyId,
    confirmationNumber: confNum,
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
    ratePerNight,
    totalAmount,
    taxAmount: Math.round(totalAmount * 0.17),
    paymentStatus: 'unpaid',
    currency: 'ILS',
    isVip: !!isVip,
    specialRequests,
    createdBy: actorId,
    updatedBy: actorId,
  });

  // 4. Open folio
  await Folio.create({
    property: propertyId,
    reservation: res._id,
    ownerType: 'guest',
    status: 'open',
    currency: 'ILS',
    lines: [],
  });

  // 5. Update inventory
  await incrementInventory(propertyId, roomTypeId, arrivalDate, departureDate, 1);

  // 6. Update room occupancy status
  if (assignedRoom) {
    await Room.findByIdAndUpdate(assignedRoom._id, { occStatus: 'due_in' });
  }

  // 7. Audit
  await audit({ property: propertyId, actor: actorId, actorName, action: 'reservation.created',
    entityType: 'Reservation', entityId: res._id, after: res.toObject(), ip });

  return res;
}

// ─── Check-in ─────────────────────────────────────────────────────────────────
export async function checkIn({ reservationId, actorId, actorName, ip, overrideClean = false }) {
  const res = await Reservation.findById(reservationId).populate('assignedRoom');
  if (!res) throw new Error('הזמנה לא נמצאה');
  if (!['confirmed','modified'].includes(res.status)) throw new Error(`לא ניתן לצ'ק-אין מסטטוס: ${res.status}`);

  const today = new Date().toISOString().split('T')[0];
  if (res.arrivalDate > today) throw new Error(`תאריך הגעה הוא ${res.arrivalDate} — מוקדם מדי לצ'ק-אין`);

  const room = res.assignedRoom;
  if (!room) throw new Error('אין חדר מוקצה להזמנה');
  if (!overrideClean && !['clean','inspected'].includes(room.cleanStatus)) {
    throw new Error(`חדר ${room.number} לא נקי (${room.cleanStatus}) — נדרשת הרשאה לעקיפה`);
  }

  const before = res.toObject();

  // Update reservation
  res.status = 'in_house';
  res.checkedInAt = new Date();
  res.updatedBy = actorId;
  await res.save();

  // Update room
  await Room.findByIdAndUpdate(room._id, { occStatus: 'occupied' });

  // Post room charges to folio for each night
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
        description: 'לינה',
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

  // Update guest stats
  await GuestProfile.findByIdAndUpdate(res.primaryGuest, { $inc: { totalStays: 1, totalRevenue: res.totalAmount } });

  await audit({ property: res.property, actor: actorId, actorName, action: 'reservation.check_in',
    entityType: 'Reservation', entityId: res._id, before, after: res.toObject(), ip });

  return res;
}

// ─── Check-out ────────────────────────────────────────────────────────────────
export async function checkOut({ reservationId, actorId, actorName, ip, forceCheckout = false }) {
  const res = await Reservation.findById(reservationId).populate('assignedRoom');
  if (!res) throw new Error('הזמנה לא נמצאה');
  if (!['in_house','checked_in'].includes(res.status)) throw new Error(`לא ניתן לצ'ק-אאוט מסטטוס: ${res.status}`);

  // Check folio balance
  const folio = await Folio.findOne({ reservation: reservationId, status: 'open' });
  if (folio) {
    const balance = folio.lines
      .filter(l => l.status === 'posted')
      .reduce((s, l) => s + l.amount + l.taxAmount, 0);
    if (balance > 0 && !forceCheckout) {
      throw new Error(`יתרה פתוחה: ₪${balance.toFixed(2)} — יש לסגור לפני יציאה`);
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
    // Room becomes dirty automatically
    await Room.findByIdAndUpdate(room._id, { occStatus: 'checked_out', cleanStatus: 'dirty' });

    // Auto-create housekeeping checkout task
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

  await audit({ property: res.property, actor: actorId, actorName, action: 'reservation.check_out',
    entityType: 'Reservation', entityId: res._id, before, after: res.toObject(), ip });

  return res;
}

// ─── Cancel Reservation ────────────────────────────────────────────────────────
export async function cancelReservation({ reservationId, reason, actorId, actorName, ip }) {
  const res = await Reservation.findById(reservationId);
  if (!res) throw new Error('הזמנה לא נמצאה');
  if (['cancelled','checked_out'].includes(res.status)) throw new Error('הזמנה כבר בוטלה/יצאה');

  const before = res.toObject();
  res.status = 'cancelled';
  res.cancelledAt = new Date();
  res.cancellationReason = reason || '';
  res.updatedBy = actorId;
  await res.save();

  // Release inventory
  await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -1);

  // Free the room
  if (res.assignedRoom) {
    await Room.findByIdAndUpdate(res.assignedRoom, { occStatus: 'vacant' });
  }

  await audit({ property: res.property, actor: actorId, actorName, action: 'reservation.cancelled',
    entityType: 'Reservation', entityId: res._id, before, after: res.toObject(), reason, ip });

  return res;
}

// ─── Modify Reservation ───────────────────────────────────────────────────────
export async function modifyReservation({ reservationId, data, actorId, actorName, ip }) {
  const res = await Reservation.findById(reservationId);
  if (!res) throw new Error('הזמנה לא נמצאה');
  if (!['confirmed', 'modified'].includes(res.status)) {
    throw new Error(`לא ניתן לשנות הזמנה בסטטוס: ${res.status}`);
  }

  const before = res.toObject();
  const {
    arrivalDate, departureDate, roomTypeId, ratePerNight,
    ratePlanId, adults, children, specialRequests, internalNotes, priceOverrideReason,
  } = data;

  const datesChanged = (arrivalDate && arrivalDate !== res.arrivalDate) ||
                       (departureDate && departureDate !== res.departureDate);
  const typeChanged  = roomTypeId && String(roomTypeId) !== String(res.roomType);

  if (datesChanged || typeChanged) {
    const newArrival    = arrivalDate    || res.arrivalDate;
    const newDeparture  = departureDate  || res.departureDate;
    const newRoomTypeId = roomTypeId     || String(res.roomType);

    const nights = Math.round((new Date(newDeparture) - new Date(newArrival)) / 86400000);
    if (nights <= 0) throw new Error('תאריכים לא תקינים');

    // Release old inventory
    await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -1);

    // Check new availability (exclude self so the old assigned room isn't counted)
    const avail = await checkAvailability({
      propertyId: String(res.property),
      roomTypeId: newRoomTypeId,
      arrivalDate: newArrival,
      departureDate: newDeparture,
      excludeReservationId: String(res._id),
    });
    if (!avail.available) {
      // Restore old inventory on failure
      await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, 1);
      throw new Error(`אין זמינות לתאריכים החדשים: ${avail.reason}`);
    }

    // Re-lock new inventory
    await incrementInventory(res.property, newRoomTypeId, newArrival, newDeparture, 1);

    res.arrivalDate   = newArrival;
    res.departureDate = newDeparture;
    res.nights        = nights;
    if (typeChanged) res.roomType = newRoomTypeId;

    const rate = (ratePerNight != null ? ratePerNight : res.ratePerNight);
    res.ratePerNight  = rate;
    res.totalAmount   = rate * nights;
    res.taxAmount     = Math.round(res.totalAmount * 0.17);

    // Reassign best available room if type changed
    if (typeChanged) {
      const bestRoom = avail.availableRooms.find(r => ['clean','inspected'].includes(r.cleanStatus))
        || avail.availableRooms[0] || null;
      res.assignedRoom = bestRoom?._id || null;
    }
  } else if (ratePerNight != null && ratePerNight !== res.ratePerNight) {
    res.ratePerNight  = ratePerNight;
    res.totalAmount   = ratePerNight * res.nights;
    res.taxAmount     = Math.round(res.totalAmount * 0.17);
  }

  if (ratePlanId !== undefined) res.ratePlan = ratePlanId || null;
  if (adults     !== undefined) res.adults     = adults;
  if (children   !== undefined) res.children   = children;
  if (specialRequests !== undefined) res.specialRequests = specialRequests;
  if (internalNotes   !== undefined) res.internalNotes   = internalNotes;

  res.status    = 'modified';
  res.updatedBy = actorId;
  await res.save();

  await audit({
    property: res.property, actor: actorId, actorName,
    action: 'reservation.modified',
    entityType: 'Reservation', entityId: res._id,
    before, after: res.toObject(),
    reason: priceOverrideReason || 'שינוי הזמנה',
    ip,
  });

  return Reservation.findById(res._id)
    .populate('primaryGuest', 'firstName lastName email phone vipLevel country')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .populate('ratePlan', 'name code')
    .lean();
}

// ─── No-show ──────────────────────────────────────────────────────────────────
export async function markNoShow({ reservationId, actorId, actorName, ip }) {
  const res = await Reservation.findById(reservationId);
  if (!res) throw new Error('הזמנה לא נמצאה');
  const before = res.toObject();
  res.status = 'no_show';
  res.noShowAt = new Date();
  res.updatedBy = actorId;
  await res.save();
  await incrementInventory(res.property, res.roomType, res.arrivalDate, res.departureDate, -1);
  if (res.assignedRoom) await Room.findByIdAndUpdate(res.assignedRoom, { occStatus: 'vacant' });
  await audit({ property: res.property, actor: actorId, actorName, action: 'reservation.no_show',
    entityType: 'Reservation', entityId: res._id, before, after: res.toObject(), ip });
  return res;
}
