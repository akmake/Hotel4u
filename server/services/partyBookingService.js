// RSV-02 multi-room booking ("party"): one guest/booker books several rooms — of the same or of
// different room types — in one action. Every room becomes its own reservation (own check-in,
// check-out, folio and cancellation, the way OPERA and Mews do it), linked by `party`.
//
// Rules:
//  - price per room comes from the server (createBooking): occupancy, children and rate plan per room;
//  - stock is checked for the whole party before anything is written (N rooms of a type need N free);
//  - all or nothing: if any room fails, the rooms already written are rolled back (stock released,
//    records removed) — the guest never gets half a booking;
//  - one operation key for the party; each room gets `<key>-<n>`, so a retry never books twice;
//  - a specific room may be chosen per line; assigning it is best effort and reported back.
import crypto from 'crypto';
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Folio from '../models/Folio.js';
import Room from '../models/Room.js';
import { audit } from './auditService.js';
import { nightlyAvailability, getOccupiedRoomIds, roomsFreeForStay } from './availabilityService.js';
import { createBooking, resolveGuest } from './bookingService.js';
import { cancelReservation } from './reservationService.js';
import { assignRoom, httpError } from './frontDeskService.js';

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const MAX_ROOMS = 20;
const SHARED = ['arrival', 'departure', 'source', 'companyId', 'payerType', 'booker', 'specialRequests', 'internalNotes', 'language', 'mode', 'holdMinutes', 'residency'];

export async function createParty({ propertyId, input, actor, ip }) {
  const key = String(input.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,70}$/.test(key)) throw httpError('חסר מזהה פעולה (idempotency key)', 422);
  const lines = Array.isArray(input.lines) ? input.lines.slice(0, MAX_ROOMS + 1) : [];
  if (!lines.length) throw httpError('יש להוסיף לפחות חדר אחד', 422, { fields: { lines: 'חדר אחד לפחות' } });
  if (lines.length > MAX_ROOMS) throw httpError(`עד ${MAX_ROOMS} חדרים בפעולה אחת — לקבוצה גדולה יותר: בלוק קבוצתי`, 422, { fields: { lines: 'יותר מדי חדרים' } });
  const mode = ['confirm', 'hold', 'draft'].includes(input.mode) ? input.mode : 'confirm';
  const lineErrors = {};
  lines.forEach((l, i) => {
    if (!isId(String(l.roomTypeId || ''))) lineErrors[i] = 'יש לבחור סוג חדר';
    else if (!isId(String(l.ratePlanId || ''))) lineErrors[i] = 'יש לבחור תעריף';
  });
  const picked = lines.map((l) => l.roomId).filter(Boolean).map(String);
  if (new Set(picked).size !== picked.length) throw httpError('אותו חדר נבחר ליותר משורה אחת', 422, { fields: { lines: 'חדר כפול' } });
  if (Object.keys(lineErrors).length) throw httpError('יש להשלים את פרטי החדרים', 422, { fields: { lines: lineErrors } });

  // Already done (retry of the same action) → return what exists.
  const done = await Reservation.find({ property: propertyId, idempotencyKey: { $in: lines.map((_, i) => `${key}-${i + 1}`) } }).select('_id confirmationNumber status party totalAmount').lean();
  if (done.length === lines.length && done.every((d) => d.party?.id === key)) {
    return { partyId: key, code: done[0].party.code, rooms: done.map((d) => ({ id: String(d._id), confirmationNumber: d.confirmationNumber, status: d.status, total: d.totalAmount })), duplicate: true };
  }

  // Whole-party stock check before anything is written (a draft holds nothing).
  if (mode !== 'draft') {
    const need = new Map();
    for (const l of lines) need.set(String(l.roomTypeId), (need.get(String(l.roomTypeId)) || 0) + 1);
    const short = [];
    for (const [typeId, count] of need) {
      const inv = await nightlyAvailability({ propertyId, roomTypeId: typeId, arrivalDate: input.arrival, departureDate: input.departure });
      const free = Math.min(inv.freeRooms, ...inv.nights.map((n) => (n.missing ? 0 : n.available)));
      if (free < count) short.push({ roomTypeId: typeId, need: count, free: Math.max(0, free) });
    }
    if (short.length) {
      throw httpError(short.map((s) => `נדרשים ${s.need} חדרים מסוג זה ופנויים ${s.free}`).join(' · '), 409, { code: 'party_short', details: short });
    }
  }

  // One guest for the whole party (duplicates are surfaced once, not per room).
  const guest = await resolveGuest({ propertyId, input, actor, ip });
  const shared = Object.fromEntries(SHARED.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
  const created = [];
  try {
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      const out = await createBooking({
        propertyId, actor, ip,
        input: {
          ...shared, mode, guestId: String(guest._id), rooms: 1,
          roomTypeId: l.roomTypeId, ratePlanId: l.ratePlanId, adults: Number(l.adults), children: Number(l.children || 0),
          childAges: l.childAges, priceSignature: l.priceSignature, override: l.override, board: l.board,
          specialRequests: [shared.specialRequests, l.note].filter(Boolean).join(' · ') || undefined,
          idempotencyKey: `${key}-${i + 1}`,
        },
      }).catch((e) => { e.lineIndex = i; throw e; });
      created.push({ ...out, line: i });
    }
  } catch (e) {
    await rollback({ propertyId, created, actor, ip, why: e.message });
    const err = httpError(`חדר ${Number(e.lineIndex ?? created.length) + 1}: ${e.message}`, e.status || 409, { code: e.code || 'party_failed', fields: { lines: { [e.lineIndex ?? created.length]: e.message } }, details: e.details });
    throw err;
  }

  const code = created[0].confirmationNumber;
  for (const c of created) {
    await Reservation.updateOne({ _id: c.id }, { $set: { party: { id: key, code, index: c.line + 1, size: created.length } } });
  }
  // Specific rooms, when chosen: best effort — the booking stands even if a room was taken meanwhile.
  const assignments = [];
  for (const c of created) {
    const roomId = lines[c.line].roomId;
    if (!roomId || mode === 'draft') continue;
    try {
      await assignRoom({ propertyId, reservationId: c.id, roomId: String(roomId), actor, ip });
      const room = await Room.findById(roomId).select('number').lean();
      assignments.push({ line: c.line, ok: true, room: room?.number || null });
    } catch (e) {
      assignments.push({ line: c.line, ok: false, message: e.message });
    }
  }
  if (created.length > 1) {
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.party_created', entityType: 'Reservation', entityId: created[0].id, after: { party: key, code, rooms: created.length, confirmations: created.map((c) => c.confirmationNumber) }, ip });
  }
  return {
    partyId: key, code, duplicate: false,
    rooms: created.map((c) => ({ id: c.id, confirmationNumber: c.confirmationNumber, status: c.status, total: c.total, line: c.line })),
    total: Math.round(created.reduce((s, c) => s + Number(c.total || 0), 0) * 100) / 100,
    assignments,
  };
}

// All or nothing: rooms written before the failure release their stock and are removed.
async function rollback({ propertyId, created, actor, ip, why }) {
  for (const c of created) {
    try {
      const r = await Reservation.findById(c.id).select('status').lean();
      if (r && !['cancelled', 'draft', 'quote'].includes(r.status)) {
        await cancelReservation({ reservationId: c.id, reason: 'ביטול אוטומטי — הזמנה מרובת חדרים לא הושלמה', actorId: actor.id, actorName: actor.name, ip });
      }
      await ReservationRoom.deleteMany({ reservation: c.id });
      await Folio.deleteMany({ reservation: c.id, 'lines.0': { $exists: false } });
      await Reservation.deleteOne({ _id: c.id });
      await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.party_rolled_back', entityType: 'Reservation', entityId: c.id, reason: String(why || '').slice(0, 300), after: { confirmationNumber: c.confirmationNumber }, ip });
    } catch (e) {
      console.error('[party] rollback failed', c.id, e.message);
    }
  }
}

// Rooms of a type free for every night of a range (for choosing a specific room while booking).
export async function freeRooms({ propertyId, roomTypeId, arrival, departure }) {
  if (!isId(String(roomTypeId || ''))) throw httpError('יש לבחור סוג חדר', 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival || '') || !/^\d{4}-\d{2}-\d{2}$/.test(departure || '') || departure <= arrival) throw httpError('תאריכים לא תקינים', 422);
  const rooms = (await roomsFreeForStay({ propertyId, roomTypeId, arrivalDate: arrival, departureDate: departure }))
    .sort((a, b) => (a.floor || 0) - (b.floor || 0) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  return rooms.map((r) => ({ id: String(r._id), number: r.number, floor: r.floor, cleanStatus: r.cleanStatus, accessible: !!r.isAccessible }));
}

// Members of a party, for the stay file.
export async function partyMembers({ propertyId, partyId }) {
  if (!partyId) return [];
  const rows = await Reservation.find({ property: propertyId, 'party.id': partyId }).select('confirmationNumber status party roomType assignedRoom adults children totalAmount').populate('roomType', 'name').populate('assignedRoom', 'number').sort({ 'party.index': 1 }).lean();
  return rows.map((r) => ({ id: String(r._id), confirmationNumber: r.confirmationNumber, status: r.status, index: r.party?.index, roomType: r.roomType?.name || null, room: r.assignedRoom?.number || null, adults: r.adults, children: r.children || 0, total: r.totalAmount }));
}

export const newPartyKey = () => `p${crypto.randomBytes(9).toString('hex')}`;
