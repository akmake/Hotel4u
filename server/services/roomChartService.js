// Room chart (tape chart): every room × every night of a range — stays on their rooms, dated blocks,
// and stays not yet assigned a room (each as a pending bar by room type, plus counts per night). Read-only; changes go through
// the reservation file (assignment, moves) so the same rules apply everywhere.
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import RoomBlock from '../models/RoomBlock.js';
import Property from '../models/Property.js';
import { businessDateOf } from './frontDeskService.js';

const GONE = ['cancelled', 'no_show', 'quote', 'draft', 'waitlisted'];
const UNIT_LIVE = ['reserved', 'tentative', 'checked_in', 'in_house', 'checked_out'];
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export async function roomChart({ propertyId, from, days = 14 }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const start = isYmd(from) ? from : addDays(today, -1);
  const n = Math.min(45, Math.max(7, Number(days) || 14));
  const dates = Array.from({ length: n }, (_, i) => addDays(start, i));
  const end = addDays(start, n);

  const [types, rooms, reservations, blocks] = await Promise.all([
    RoomType.find({ property: propertyId, active: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).lean(),
    Room.find({ property: propertyId, active: { $ne: false } }).select('number floor roomType cleanStatus opsStatus outOfServiceUntil').lean(),
    Reservation.find({ property: propertyId, status: { $nin: GONE }, arrivalDate: { $lt: end }, departureDate: { $gt: start } })
      .select('confirmationNumber status arrivalDate departureDate roomType roomsCount assignedRoom adults children isVip primaryGuest party')
      .populate('primaryGuest', 'firstName lastName').lean(),
    RoomBlock.find({ property: propertyId, status: 'active', from: { $lt: end }, to: { $gt: start } }).select('room from to reason kind').lean(),
  ]);
  const units = reservations.length
    ? await ReservationRoom.find({ reservation: { $in: reservations.map((r) => r._id) } }).select('reservation roomTypeBooked assignedRoom arrivalDate departureDate status').lean()
    : [];
  const unitsByRes = new Map();
  for (const u of units) unitsByRes.set(String(u.reservation), [...(unitsByRes.get(String(u.reservation)) || []), u]);

  const bars = [];
  const pending = [];
  const unassigned = {};
  const addUnassigned = (typeId, a, b, count = 1) => {
    for (const d of dates) if (a <= d && d < b) { (unassigned[typeId] ||= {})[d] = (unassigned[typeId][d] || 0) + count; }
  };
  for (const r of reservations) {
    const guest = r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : '';
    const base = { reservationId: String(r._id), confirmation: r.confirmationNumber, guest, status: r.status, vip: !!r.isVip, pax: (r.adults || 0) + (r.children || 0) };
    const us = (unitsByRes.get(String(r._id)) || []).filter((u) => UNIT_LIVE.includes(u.status));
    if (us.length) {
      for (const u of us) {
        // A single-unit legacy reservation keeps its room on the reservation itself.
        const room = u.assignedRoom || (us.length === 1 ? r.assignedRoom : null);
        if (room) bars.push({ ...base, roomId: String(room), from: u.arrivalDate, to: u.departureDate, unitStatus: u.status });
        else if (u.status !== 'checked_out') {
          addUnassigned(String(u.roomTypeBooked), u.arrivalDate, u.departureDate);
          pending.push({ ...base, unitId: String(u._id), typeId: String(u.roomTypeBooked), from: u.arrivalDate, to: u.departureDate, unitStatus: u.status, rooms: 1 });
        }
      }
    } else if (r.assignedRoom && (r.roomsCount || 1) === 1) {
      bars.push({ ...base, roomId: String(r.assignedRoom), from: r.arrivalDate, to: r.departureDate });
    } else if (r.status !== 'checked_out' && r.roomType) {
      addUnassigned(String(r.roomType), r.arrivalDate, r.departureDate, Math.max(1, r.roomsCount || 1));
      pending.push({ ...base, typeId: String(r.roomType), from: r.arrivalDate, to: r.departureDate, rooms: Math.max(1, r.roomsCount || 1) });
    }
  }

  const sortNum = (a, b) => (a.floor || 0) - (b.floor || 0) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
  const held = ['out_of_order', 'out_of_service', 'maintenance_hold', 'owner_hold', 'internal_use'];
  return {
    today, from: start, dates,
    types: types.map((t) => ({
      id: String(t._id), code: t.code, name: t.name,
      rooms: rooms.filter((r) => String(r.roomType) === String(t._id)).sort(sortNum).map((r) => ({
        id: String(r._id), number: r.number, floor: r.floor, cleanStatus: r.cleanStatus, opsStatus: r.opsStatus,
        heldNow: held.includes(r.opsStatus) ? { until: r.outOfServiceUntil || null } : null,
      })),
      unassigned: unassigned[String(t._id)] || {},
    })),
    bars: bars.filter((b) => b.from < end && b.to > start),
    pending: pending.filter((b) => b.from < end && b.to > start).sort((a, b) => a.from.localeCompare(b.from)),
    blocks: blocks.map((b) => ({ roomId: String(b.room), from: b.from, to: b.to, reason: b.reason, kind: b.kind })),
  };
}
