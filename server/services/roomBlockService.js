// INV-04 — taking a room out of sale for a date range, and the availability grid (INV-01).
// A block removes the room from availability and from room assignment for its nights. It is refused
// while a stay is assigned to the room in those nights (move the guest first), and it warns before it
// leaves the room type oversold; nothing is deleted — release keeps the history.
import mongoose from 'mongoose';
import Room from '../models/Room.js';
import RoomBlock from '../models/RoomBlock.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf, conflictingRoomIds } from './frontDeskService.js';
import { assessAvailability, availabilityGrid as grid, getStayDates } from './availabilityService.js';
import { withLocks } from './locks.js';

export const BLOCK_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'maintenance_manager', 'revenue_manager'];
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const he = (ymd) => String(ymd).split('-').reverse().join('.');

function dto(b) {
  return {
    id: String(b._id), roomId: String(b.room?._id || b.room), room: b.room?.number ?? null, roomTypeId: String(b.roomType?._id || b.roomType),
    roomType: b.roomType?.name ?? null, from: b.from, to: b.to, nights: getStayDates(b.from, b.to).length, kind: b.kind, reason: b.reason,
    status: b.status, createdBy: b.createdByName || null, createdAt: b.createdAt, releasedAt: b.releasedAt || null, releasedBy: b.releasedByName || null, releaseReason: b.releaseReason || null,
  };
}

export async function listBlocks({ propertyId, from, to, roomId, includeReleased = false }) {
  const q = { property: propertyId };
  if (!includeReleased) q.status = 'active';
  if (isYmd(from)) q.to = { $gt: from };
  if (isYmd(to)) q.from = { $lt: to };
  if (roomId && mongoose.isValidObjectId(String(roomId))) q.room = roomId;
  const rows = await RoomBlock.find(q).populate('room', 'number').populate('roomType', 'name').sort({ from: 1 }).limit(500).lean();
  return rows.map(dto);
}

export async function createBlock({ propertyId, roomId, input, actor, ip }) {
  if (!BLOCK_ROLES.includes(actor.role)) throw httpError('חסימת חדר לתאריכים מותרת למנהל', 403);
  if (!mongoose.isValidObjectId(String(roomId || ''))) throw httpError('מזהה חדר לא תקין', 400);
  const from = input.from; const to = input.to;
  const fields = {};
  if (!isYmd(from)) fields.from = 'תאריך התחלה';
  if (!isYmd(to)) fields.to = 'תאריך חזרה למכירה';
  const reason = clip(input.reason, 300);
  if (reason.length < 3) fields.reason = 'סיבה';
  if (Object.keys(fields).length) throw httpError('יש להשלים את פרטי החסימה', 422, { fields });
  if (to <= from) throw httpError('תאריך החזרה למכירה חייב להיות אחרי תאריך ההתחלה', 422, { fields: { to: 'אחרי ההתחלה' } });
  const nights = getStayDates(from, to);
  if (nights.length > 366) throw httpError('חסימה עד שנה; לחדר שיוצא לתקופה ארוכה — השבתה בהגדרות החדרים', 422);
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  if (from < today) throw httpError('אי אפשר לחסום לילות שעברו', 422, { fields: { from: `מ־${he(today)}` } });
  const kind = input.kind === 'out_of_service' ? 'out_of_service' : 'out_of_order';

  return withLocks([`room:${roomId}`], async () => {
    const room = await Room.findOne({ _id: roomId, property: propertyId }).lean();
    if (!room) throw httpError('החדר לא נמצא', 404);
    const overlap = await RoomBlock.findOne({ property: propertyId, room: room._id, status: 'active', from: { $lt: to }, to: { $gt: from } }).lean();
    if (overlap) throw httpError(`החדר כבר חסום ${he(overlap.from)}–${he(overlap.to)} (${overlap.reason})`, 409, { code: 'overlap' });
    const conflicts = await conflictingRoomIds({ propertyId, from, to, excludeReservationId: null });
    const holder = conflicts.get(String(room._id));
    if (holder) throw httpError(`בחדר ${room.number} משובצת הזמנה ${holder} בתאריכים האלה — יש להעביר אותה לחדר אחר לפני החסימה`, 409, { code: 'room_assigned' });
    // Does taking this room out leave sold stays without a room of the type?
    const a = await assessAvailability({ propertyId, roomTypeId: room.roomType, arrivalDate: from, departureDate: to });
    const short = a.nights.filter((n) => n.total - n.outOfSale - 1 < n.sold).map((n) => n.date);
    if (short.length && !input.confirmOversell) {
      throw httpError(`החסימה תשאיר את סוג החדר מכור יותר מהחדרים ב־${short.slice(0, 5).map(he).join(', ')}${short.length > 5 ? '…' : ''}`, 409, { code: 'oversell', details: short });
    }
    const [b] = await RoomBlock.create([{
      property: propertyId, room: room._id, roomType: room.roomType, from, to, kind, reason,
      ticket: mongoose.isValidObjectId(String(input.ticketId || '')) ? input.ticketId : undefined,
      createdBy: actor.id || undefined, createdByName: actor.name || undefined,
    }]);
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'room.block_dates', entityType: 'Room', entityId: room._id, reason, after: { room: room.number, from, to, kind, nights: nights.length, oversell: short.length ? short : undefined }, ip });
    return dto({ ...b.toObject(), room: { _id: room._id, number: room.number } });
  });
}

export async function releaseBlock({ propertyId, blockId, reason, actor, ip }) {
  if (!BLOCK_ROLES.includes(actor.role)) throw httpError('שחרור חסימה מותר למנהל', 403);
  if (!mongoose.isValidObjectId(String(blockId || ''))) throw httpError('מזהה חסימה לא תקין', 400);
  const why = clip(reason, 300);
  if (why.length < 3) throw httpError('יש לפרט סיבה לשחרור', 422, { fields: { reason: 'סיבה' } });
  const b = await RoomBlock.findOneAndUpdate(
    { _id: blockId, property: propertyId, status: 'active' },
    { $set: { status: 'released', releasedAt: new Date(), releasedBy: actor.id || undefined, releasedByName: actor.name || undefined, releaseReason: why } },
    { returnDocument: 'after' },
  ).populate('room', 'number').populate('roomType', 'name').lean();
  if (!b) throw httpError('החסימה לא נמצאה או כבר שוחררה', 409);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'room.block_released', entityType: 'Room', entityId: b.room?._id, reason: why, after: { room: b.room?.number, from: b.from, to: b.to }, ip });
  return dto(b);
}

export async function availabilityGrid({ propertyId, from, days }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const start = isYmd(from) ? from : businessDateOf(property);
  const out = await grid({ propertyId, from: start, days });
  const last = out.dates[out.dates.length - 1];
  const blocks = await listBlocks({ propertyId, from: start, to: last ? new Date(Date.parse(`${last}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : start });
  return { ...out, today: businessDateOf(property), blocks };
}
