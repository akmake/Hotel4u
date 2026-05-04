import InventoryDate from '../models/InventoryDate.js';
import Room from '../models/Room.js';
import Reservation from '../models/Reservation.js';

/**
 * Returns all dates between arrival and departure (exclusive of departure).
 */
export function getStayDates(arrivalDate, departureDate) {
  const dates = [];
  const cur = new Date(arrivalDate);
  const end = new Date(departureDate);
  while (cur < end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/**
 * Check availability for a given stay.
 * Returns { available: boolean, availableRooms: Room[], reason: string|null }
 */
export async function checkAvailability({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId = null }) {
  const dates = getStayDates(arrivalDate, departureDate);
  if (dates.length === 0) return { available: false, availableRooms: [], reason: 'תאריכים לא תקינים' };

  // 1. Check InventoryDate for each night — is there capacity?
  const invDocs = await InventoryDate.find({
    property: propertyId,
    roomType: roomTypeId,
    date: { $in: dates },
  });

  for (const date of dates) {
    const inv = invDocs.find(i => i.date === date);
    if (!inv) return { available: false, availableRooms: [], reason: `אין רשומת מלאי לתאריך ${date}` };
    if (inv.stopSell) return { available: false, availableRooms: [], reason: `Stop Sell לתאריך ${date}` };
    const available = inv.physicalCount - inv.oooCount - inv.bookedCount + inv.overbookingLimit;
    if (available <= 0) return { available: false, availableRooms: [], reason: `אין זמינות ל-${date}` };
  }

  // 2. Find physical rooms of this type that are free for the whole stay
  const occupiedRoomIds = await getOccupiedRoomIds({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId });

  const freeRooms = await Room.find({
    property: propertyId,
    roomType: roomTypeId,
    opsStatus: 'available',
    active: true,
    _id: { $nin: occupiedRoomIds },
  });

  return {
    available: freeRooms.length > 0,
    availableRooms: freeRooms,
    reason: freeRooms.length === 0 ? 'אין חדרים פיזיים פנויים' : null,
  };
}

/**
 * Returns IDs of rooms that are occupied (have a confirmed reservation overlapping this stay).
 */
async function getOccupiedRoomIds({ propertyId, roomTypeId, arrivalDate, departureDate, excludeReservationId }) {
  const query = {
    property: propertyId,
    roomType: roomTypeId,
    assignedRoom: { $ne: null },
    status: { $nin: ['cancelled', 'no_show', 'checked_out'] },
    // Overlap: res.arrival < dep AND res.departure > arr
    arrivalDate: { $lt: departureDate },
    departureDate: { $gt: arrivalDate },
  };
  if (excludeReservationId) query._id = { $ne: excludeReservationId };

  const conflicting = await Reservation.find(query).select('assignedRoom');
  return conflicting.map(r => r.assignedRoom).filter(Boolean);
}

/**
 * Increment bookedCount on InventoryDate for each night of the stay.
 */
export async function incrementInventory(propertyId, roomTypeId, arrivalDate, departureDate, delta = 1) {
  const dates = getStayDates(arrivalDate, departureDate);
  await InventoryDate.updateMany(
    { property: propertyId, roomType: roomTypeId, date: { $in: dates } },
    { $inc: { bookedCount: delta } }
  );
}
