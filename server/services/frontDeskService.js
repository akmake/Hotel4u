// Front-desk arrivals, check-in and waiting queue (spec W03: FD-02 / FD-03 / FD-04 / FD-05, INV-02).
//
// The server is the single source of truth for whether a stay unit may enter. Every list row and
// every write re-computes readiness from current room, reservation, guarantee and policy data;
// the UI only renders the reasons it receives.
import crypto from 'crypto';
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import RoomBlock from '../models/RoomBlock.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import Property from '../models/Property.js';
import GuestProfile from '../models/GuestProfile.js';
import GuestRegistrationCard from '../models/GuestRegistrationCard.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import User from '../models/User.js';
import { checkIn as checkInReservation, markNoShow } from './reservationService.js';
import { fireEvent } from './automationEngine.js';
import { audit } from './auditService.js';
import { withLocks } from './locks.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

export const MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];

const ARRIVING_STATUSES = ['confirmed', 'modified', 'pending_payment', 'partially_checked_in'];
export const IN_HOUSE_STATUSES = ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'];
// Reservation statuses that hold a room for their date range.
const HOLDING_STATUSES = ['hold', 'pending_payment', 'confirmed', 'modified', 'in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'];
const UNIT_OPEN_STATUSES = ['reserved', 'tentative'];
const UNIT_HOLDING_STATUSES = ['reserved', 'tentative', 'checked_in', 'in_house'];
const GUARANTEE_METHODS = ['credit_card', 'deposit', 'voucher', 'company_guarantee'];
const ACTIVE_HK_STATUSES = ['new', 'assigned', 'in_progress', 'paused', 'failed_inspection'];

export function httpError(message, status = 400, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const QUEUE_OWNER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'housekeeping_manager', 'housekeeper'];

// Locks moved to services/locks.js (shared with booking); re-exported for existing imports.
export { withLocks };
const idStr = (v) => (v ? String(v._id || v) : null);
const nightsBetween = (a, b) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));

export function policyOf(property) {
  const p = property?.checkInPolicy || {};
  return {
    requireInspection: !!p.requireInspection,
    requireGuarantee: p.requireGuarantee !== false,
    requireRegistration: p.requireRegistration !== false,
    requireSignature: !!p.requireSignature,
    termsVersion: p.termsVersion || 'he-1',
    termsText: p.termsText || '',
  };
}

export async function loadProperty(propertyId) {
  const property = await Property.findById(propertyId).select('name timezone checkInTime checkInPolicy').lean();
  if (!property) throw httpError('הנכס לא נמצא', 404);
  return property;
}

// There is no managed business date yet (FIN-12 / day close is a later slice), so the property's
// local calendar day stands in for it. Never the browser clock, never UTC.
export function businessDateOf(property) {
  return todayYmdInTimezone(property?.timezone || 'Asia/Jerusalem');
}

// ── Stay units ──────────────────────────────────────────────────────────────
// Reservations created through the API have ReservationRoom units; older/seeded ones do not.
// Reads present such a reservation as one implicit unit; writes materialise it first.
function unitStatusFor(resStatus) {
  if (['cancelled', 'no_show', 'checked_out'].includes(resStatus)) return resStatus;
  return IN_HOUSE_STATUSES.includes(resStatus) && resStatus !== 'partially_checked_in' ? 'in_house' : 'reserved';
}

// One implicit unit per booked room, in the same order ensureUnits will create them, so the
// screen and the first write agree (unit index is the stable handle until ids exist).
export function implicitUnits(res) {
  const count = Math.max(1, Number(res.roomsCount || 1));
  return Array.from({ length: count }, (_, i) => ({
    _id: null,
    implicit: true,
    index: i + 1,
    reservation: res._id,
    roomTypeBooked: res.roomType,
    assignedRoom: i === 0 ? (res.assignedRoom || null) : null,
    arrivalDate: res.arrivalDate,
    departureDate: res.departureDate,
    status: unitStatusFor(res.status),
  }));
}

export async function ensureUnits(reservation) {
  const existing = await ReservationRoom.find({ reservation: reservation._id }).sort({ createdAt: 1, _id: 1 });
  if (existing.length) return existing;
  const count = Math.max(1, Number(reservation.roomsCount || 1));
  const docs = Array.from({ length: count }, (_, i) => ({
    reservation: reservation._id,
    property: reservation.property,
    roomTypeBooked: reservation.roomType?._id || reservation.roomType,
    assignedRoom: i === 0 ? (reservation.assignedRoom?._id || reservation.assignedRoom || null) : null,
    arrivalDate: reservation.arrivalDate,
    departureDate: reservation.departureDate,
    ratePlan: reservation.ratePlan || undefined,
    nightlyRate: Number(reservation.ratePerNight || 0),
    guests: [reservation.primaryGuest?._id || reservation.primaryGuest].filter(Boolean),
    status: unitStatusFor(reservation.status),
  }));
  return ReservationRoom.insertMany(docs);
}

// ── Guarantee ───────────────────────────────────────────────────────────────
function folioPaid(folio) {
  if (!folio) return 0;
  return -(folio.lines || [])
    .filter((l) => l.status === 'posted' && ['deposit', 'payment'].includes(l.type))
    .reduce((s, l) => s + Number(l.amount || 0), 0);
}

export function guaranteeState(res, folio) {
  const paid = Math.max(folioPaid(folio), Number(res.depositPaid || 0));
  const type = res.guaranteeType || 'none';
  let ok = false;
  let label = 'לא נרשמה ערבות';
  if (res.paymentStatus === 'paid') { ok = true; label = 'שולם מראש'; }
  else if (type === 'deposit') { ok = paid > 0; label = ok ? 'מקדמה התקבלה' : 'מקדמה לא התקבלה'; }
  else if (type === 'company_guarantee') { ok = !!res.company; label = ok ? 'ערבות חברה' : 'ערבות חברה ללא חברה משויכת'; }
  else if (type === 'credit_card') { ok = true; label = 'כרטיס אשראי (נרשם ידנית, ללא אימות ספק)'; }
  else if (type === 'voucher') { ok = true; label = 'שובר'; }
  return { type, ok, label, paid, total: Number(res.totalAmount || 0), paymentStatus: res.paymentStatus };
}

// ── Group billing (per room) ────────────────────────────────────────────────
// A room in a group is paid by the booker unless its guest pays for themselves (the room nights,
// the extras, or both). A room that pays for anything itself needs its own guarantee; the booker's
// guarantee covers only the rooms the booker pays for.
export function unitPaysSelf(u) {
  return u?.roomPayer === 'guest' || u?.extrasPayer === 'guest';
}

export function unitGuaranteeState(unit, folio) {
  const paid = folioPaid(folio);
  const type = unit?.guaranteeType || 'none';
  let ok = false;
  let label = 'לחדר זה לא נרשמה ערבות (האורח משלם בעצמו)';
  if (type === 'credit_card') { ok = true; label = 'כרטיס אשראי של החדר (נרשם ידנית)'; }
  else if (type === 'voucher') { ok = true; label = 'שובר לחדר'; }
  else if (paid > 0) { ok = true; label = 'התקבל תשלום/מקדמה לחדר'; }
  else if (type === 'deposit') label = 'מקדמה לחדר לא התקבלה';
  const nights = nightsBetween(unit?.arrivalDate, unit?.departureDate);
  const total = unit?.roomPayer === 'guest' ? Math.round(Number(unit?.nightlyRate || 0) * nights * 100) / 100 : 0;
  return { type, ok, label, paid, total, own: true };
}

export function unitBilling(u) {
  return {
    roomPayer: u?.roomPayer || 'booker',
    extrasPayer: u?.extrasPayer || 'booker',
    occupantName: u?.occupantName || null,
    occupantPhone: u?.occupantPhone || null,
    guaranteeType: u?.guaranteeType || 'none',
  };
}

// ── Readiness ───────────────────────────────────────────────────────────────
// severity: 'blocked' needs a different action (assign/unblock/manager), 'waiting' clears on its own
// once housekeeping/the previous guest finishes, 'info' never blocks.
function reason(code, label, severity, action = null) {
  return { code, label, severity, action };
}

function computeReadiness({ res, unit, room, guest, policy, businessDate, occupiedBy, guarantee, queue }) {
  const reasons = [];
  if (!UNIT_OPEN_STATUSES.includes(unit.status)) {
    return { state: ['cancelled', 'no_show'].includes(unit.status) ? 'closed' : 'checked_in', reasons: [] };
  }
  if (!ARRIVING_STATUSES.includes(res.status)) {
    reasons.push(reason('status', `לא ניתן להכניס הזמנה במצב ${res.status}`, 'blocked'));
  }
  if (guest?.isBlacklisted) {
    reasons.push(reason('blacklisted', 'האורח מסומן ברשימה שחורה — נדרשת החלטת מנהל', 'blocked'));
  }
  if (res.arrivalDate > businessDate) {
    // Another day entirely: dates must change (RSV-05); not something an override should paper over.
    reasons.push(reason('early', `ההזמנה מתחילה ב־${res.arrivalDate} — כדי להכניס היום יש לשנות את תאריכי ההזמנה`, 'blocked'));
  }
  if (!room) {
    reasons.push(reason('no_room', 'לא שובץ חדר', 'blocked', 'assign'));
  } else {
    if (room.opsStatus && room.opsStatus !== 'available') {
      const opsLabel = {
        out_of_order: 'מושבת (OOO)', out_of_service: 'מחוץ לשירות (OOS)', maintenance_hold: 'בהמתנה לתחזוקה',
        owner_hold: 'שמור לבעלים', internal_use: 'בשימוש פנימי',
      }[room.opsStatus] || room.opsStatus;
      reasons.push(reason('room_blocked', `חדר ${room.number} ${opsLabel} — ניקיון אינו מסיר חסימה`, 'blocked', 'assign'));
    }
    if (occupiedBy) {
      // Another stay is still in the room: never overridable, the guest waits or moves rooms.
      reasons.push(reason('room_occupied', `חדר ${room.number} עדיין תפוס (${occupiedBy})`, 'blocked', 'queue'));
    }
    const ready = policy.requireInspection ? ['inspected'] : ['clean', 'inspected'];
    if (!ready.includes(room.cleanStatus)) {
      const cleanLabel = { dirty: 'מלוכלך', cleaning: 'בניקיון', pickup: 'ממתין לסידור', turndown_required: 'ממתין להכנת לילה', clean: 'נקי אך טרם נבדק' }[room.cleanStatus] || room.cleanStatus;
      reasons.push(reason(
        room.cleanStatus === 'clean' ? 'not_inspected' : 'room_dirty',
        `חדר ${room.number} ${cleanLabel}`,
        'waiting',
        'queue',
      ));
    }
  }
  if (policy.requireGuarantee && !guarantee.ok) {
    reasons.push(reason('guarantee', guarantee.label, 'info', 'guarantee'));
  }
  let state = 'ready';
  if (reasons.some((r) => r.severity === 'blocked')) state = 'blocked';
  else if (reasons.some((r) => r.severity === 'waiting')) state = 'waiting';
  if (queue && state !== 'ready') state = state === 'blocked' ? 'blocked' : 'queued';
  return { state, reasons };
}

// Who physically occupies each room right now: room id → [{ resId, label }]. Unit records are the
// truth for stays that have them; the reservation-level pointer only counts for stays without units.
async function occupancyMap(propertyId, roomIds) {
  const map = new Map();
  if (!roomIds.length) return map;
  const [stays, units] = await Promise.all([
    Reservation.find({
      property: propertyId,
      assignedRoom: { $in: roomIds },
      status: { $in: IN_HOUSE_STATUSES },
    }).select('assignedRoom confirmationNumber').lean(),
    ReservationRoom.find({
      property: propertyId,
      assignedRoom: { $in: roomIds },
      status: { $in: ['in_house', 'checked_in'] },
    }).populate('reservation', 'confirmationNumber status').lean(),
  ]);
  const withUnits = new Set((await ReservationRoom.distinct('reservation', { reservation: { $in: stays.map((x) => x._id) } })).map(String));
  const add = (roomId, resId, label) => {
    const k = String(roomId);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ resId: String(resId), label });
  };
  for (const st of stays) if (!withUnits.has(String(st._id))) add(st.assignedRoom, st._id, st.confirmationNumber);
  for (const u of units) {
    if (['checked_out', 'cancelled', 'no_show'].includes(u.reservation?.status)) continue;
    add(u.assignedRoom, u.reservation?._id || u.reservation, u.reservation?.confirmationNumber || 'שהייה אחרת');
  }
  return map;
}

// The occupant of a room other than the given reservation, if any.
function occupantOther(occ, roomId, resId) {
  const list = occ.get(String(roomId)) || [];
  return list.find((x) => x.resId !== String(resId))?.label || null;
}

// ── FD-02 arrivals ──────────────────────────────────────────────────────────
const SORTS = {
  eta: (r) => r.eta || '99:99',
  guest: (r) => r.guest.name,
  room: (r) => r.room?.number || '~',
  confirmation: (r) => r.confirmationNumber,
};
const collate = (a, b) => String(a).localeCompare(String(b), 'he', { numeric: true, sensitivity: 'base' });

export async function listArrivals({ propertyId, date, q, roomTypeId, assignment, readiness, includeCheckedIn, sort = 'eta', dir = 'asc', page = 1, pageSize = 50 }) {
  const property = await loadProperty(propertyId);
  const businessDate = businessDateOf(property);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : businessDate;
  const policy = policyOf(property);

  // Entered stays are always loaded so the "checked in" count is right; they are hidden from the
  // rows unless asked for.
  const statuses = [...ARRIVING_STATUSES, ...IN_HOUSE_STATUSES, 'checked_out'];
  const filter = { property: propertyId, arrivalDate: day, status: { $in: [...new Set(statuses)] } };
  if (isId(roomTypeId)) filter.roomType = roomTypeId;

  let reservations = await Reservation.find(filter)
    .populate('primaryGuest', 'firstName lastName vipLevel isBlacklisted phone email')
    .populate('roomType', 'name code')
    .populate('company', 'name')
    .lean();

  const term = String(q || '').trim().toLowerCase();
  if (term) {
    reservations = reservations.filter((r) => {
      const g = r.primaryGuest || {};
      return `${g.firstName || ''} ${g.lastName || ''}`.toLowerCase().includes(term)
        || String(r.confirmationNumber || '').toLowerCase().includes(term);
    });
  }

  const resIds = reservations.map((r) => r._id);
  const [units, folios, queue] = await Promise.all([
    ReservationRoom.find({ reservation: { $in: resIds } }).populate('roomTypeBooked', 'name code').sort({ createdAt: 1, _id: 1 }).lean(),
    Folio.find({ reservation: { $in: resIds } }).select('reservation ownerType ownerRef lines status').lean(),
    ArrivalQueueEntry.find({ reservation: { $in: resIds }, status: 'active' }).lean(),
  ]);
  const unitsByRes = new Map();
  for (const u of units) {
    const k = String(u.reservation);
    if (!unitsByRes.has(k)) unitsByRes.set(k, []);
    unitsByRes.get(k).push(u);
  }
  const folioByRes = new Map(folios.filter((f) => f.ownerType !== 'room').map((f) => [String(f.reservation), f]));
  const roomFolioByUnit = new Map(folios.filter((f) => f.ownerType === 'room' && f.status !== 'closed').map((f) => [String(f.ownerRef), f]));
  const queueByUnit = new Map(queue.map((e) => [String(e.reservationRoom), e]));
  const queueByRes = new Map(queue.map((e) => [String(e.reservation), e]));

  const allUnits = reservations.flatMap((r) => (unitsByRes.get(String(r._id)) || implicitUnits(r)).map((u) => ({ r, u })));
  const roomIds = [...new Set(allUnits.map(({ u }) => idStr(u.assignedRoom)).filter(Boolean))];
  const rooms = await Room.find({ _id: { $in: roomIds } }).select('number floor cleanStatus opsStatus occStatus roomType').lean();
  const roomById = new Map(rooms.map((x) => [String(x._id), x]));
  const occ = await occupancyMap(propertyId, roomIds);

  let rows = allUnits.map(({ r, u }, idx) => {
    const list = unitsByRes.get(String(r._id)) || allUnits.filter((x) => x.r === r).map((x) => x.u);
    const room = roomById.get(idStr(u.assignedRoom)) || null;
    const guarantee = unitPaysSelf(u) ? unitGuaranteeState(u, roomFolioByUnit.get(String(u._id))) : guaranteeState(r, folioByRes.get(String(r._id)));
    const q2 = u._id ? queueByUnit.get(String(u._id)) : queueByRes.get(String(r._id));
    const readinessResult = computeReadiness({
      res: r, unit: u, room, guest: r.primaryGuest, policy, businessDate,
      occupiedBy: room ? occupantOther(occ, room._id, r._id) : null, guarantee, queue: q2,
    });
    const g = r.primaryGuest || {};
    return {
      key: `${r._id}:${u._id || 'implicit'}:${idx}`,
      reservationId: String(r._id),
      unitId: u._id ? String(u._id) : null,
      unitIndex: list.indexOf(u) + 1,
      unitsTotal: list.length,
      confirmationNumber: r.confirmationNumber,
      reservationStatus: r.status,
      unitStatus: u.status,
      guest: {
        id: idStr(g),
        name: `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'אורח ללא שם',
        vip: !!(r.isVip || g.vipLevel > 0),
        blacklisted: !!g.isBlacklisted,
      },
      company: r.company ? { id: idStr(r.company), name: r.company.name } : null,
      roomType: u.roomTypeBooked?.name ? { id: idStr(u.roomTypeBooked), name: u.roomTypeBooked.name, code: u.roomTypeBooked.code } : (r.roomType ? { id: idStr(r.roomType), name: r.roomType.name, code: r.roomType.code } : null),
      // occupiedBy: another stay still physically in the room — cleanliness says nothing about
      // readiness until that guest checks out (and check-out turns the room dirty).
      room: room ? { id: String(room._id), number: room.number, floor: room.floor, cleanStatus: room.cleanStatus, opsStatus: room.opsStatus, occStatus: room.occStatus, occupiedBy: occupantOther(occ, room._id, r._id) } : null,
      arrivalDate: u.arrivalDate || r.arrivalDate,
      departureDate: u.departureDate || r.departureDate,
      nights: nightsBetween(u.arrivalDate || r.arrivalDate, u.departureDate || r.departureDate),
      adults: r.adults,
      children: r.children,
      eta: r.eta || null,
      source: r.source,
      specialRequests: r.specialRequests || null,
      guarantee,
      billing: unitBilling(u),
      readiness: readinessResult,
      queue: q2 ? { id: String(q2._id), arrivedAt: q2.arrivedAt, reason: q2.reason, ownerName: q2.ownerName, priority: q2.priority } : null,
    };
  });

  rows = rows.filter((r) => r.readiness.state !== 'closed');
  const counts = { all: rows.length, ready: 0, waiting: 0, queued: 0, blocked: 0, checked_in: 0 };
  for (const row of rows) counts[row.readiness.state] = (counts[row.readiness.state] || 0) + 1;
  if (!includeCheckedIn) rows = rows.filter((r) => r.readiness.state !== 'checked_in');

  if (assignment === 'assigned') rows = rows.filter((r) => r.room);
  else if (assignment === 'unassigned') rows = rows.filter((r) => !r.room);
  if (readiness && readiness !== 'all') {
    rows = rows.filter((r) => (readiness === 'waiting' ? ['waiting', 'queued'].includes(r.readiness.state) : r.readiness.state === readiness));
  }

  const key = SORTS[sort] || SORTS.eta;
  const sign = dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => (collate(key(a), key(b)) * sign) || (a.key < b.key ? -1 : 1)); // tie-break on a fixed id

  const size = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 50;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);

  return {
    date: day,
    businessDate,
    policy,
    counts,
    total,
    page: current,
    pages,
    pageSize: size,
    rows: rows.slice((current - 1) * size, current * size),
  };
}

// ── Shared loaders for writes ───────────────────────────────────────────────
export async function loadReservationInScope(reservationId, propertyId) {
  if (!isId(String(reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const res = await Reservation.findById(reservationId)
    .populate('primaryGuest', 'firstName lastName isBlacklisted blacklistReason dateOfBirth citizenship country email phone marketingConsent')
    .populate('roomType', 'name code')
    .populate('company', 'name');
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  // Same answer as "not found": don't reveal that the id exists in another property.
  if (String(res.property) !== String(propertyId)) throw httpError('ההזמנה לא נמצאה', 404);
  return res;
}

async function unitReadiness(res, unit, property) {
  const policy = policyOf(property);
  const room = unit.assignedRoom ? await Room.findById(unit.assignedRoom).lean() : null;
  const [occ, folio, queue, ownFolio] = await Promise.all([
    room ? occupancyMap(res.property, [room._id]) : new Map(),
    Folio.findOne({ reservation: res._id, ownerType: { $ne: 'room' } }).select('lines').lean(),
    unit._id ? ArrivalQueueEntry.findOne({ reservationRoom: unit._id, status: 'active' }).lean() : null,
    unit._id && unitPaysSelf(unit) ? Folio.findOne({ reservation: res._id, ownerType: 'room', ownerRef: String(unit._id), status: { $ne: 'closed' } }).select('lines').lean() : null,
  ]);
  const guarantee = unitPaysSelf(unit) ? unitGuaranteeState(unit, ownFolio) : guaranteeState(res, folio);
  return {
    room,
    guarantee,
    queue,
    readiness: computeReadiness({
      res, unit, room, guest: res.primaryGuest, policy, businessDate: businessDateOf(property),
      occupiedBy: room ? occupantOther(occ, room._id, res._id) : null, guarantee, queue,
    }),
  };
}

// A document the guest already gave us: the latest registration card from any earlier stay, else the
// profile. The number never leaves the server in full — the desk confirms "···1234" and the save
// resolves the real value here (`reuseKnownDoc`).
async function knownDocFor(guestId, today) {
  if (!guestId) return null;
  const notExpired = (d) => !d || Date.parse(d) >= Date.parse(today);
  const card = await GuestRegistrationCard.findOne({ guest: guestId, idDocNumber: { $exists: true, $ne: '' } })
    .sort({ createdAt: -1 }).select('idDocType idDocNumber idDocExpiry dateOfBirth nationality').lean();
  if (card && notExpired(card.idDocExpiry)) {
    return { idDocType: card.idDocType, number: card.idDocNumber, expiry: card.idDocExpiry || null, dateOfBirth: card.dateOfBirth || null, nationality: card.nationality || null, source: 'previous_stay' };
  }
  const g = await GuestProfile.findById(guestId).select('idDocType passportNumber passportExpiry').lean();
  if (g?.passportNumber && notExpired(g.passportExpiry)) {
    return { idDocType: g.idDocType || 'passport', number: g.passportNumber, expiry: g.passportExpiry || null, dateOfBirth: null, nationality: null, source: 'profile' };
  }
  return null;
}

// ── FD-03 check-in context ──────────────────────────────────────────────────
export async function getCheckInContext({ propertyId, reservationId }) {
  const property = await loadProperty(propertyId);
  const res = await loadReservationInScope(reservationId, propertyId);
  const units = await ReservationRoom.find({ reservation: res._id }).populate('roomTypeBooked', 'name code').sort({ createdAt: 1, _id: 1 }).lean();
  const list = units.length ? units : implicitUnits(res.toObject());
  const out = [];
  for (const [i, u] of list.entries()) {
    const { room, readiness, queue, guarantee: unitGuarantee } = await unitReadiness(res, u, property);
    const own = u._id && unitPaysSelf(u) ? await Folio.findOne({ reservation: res._id, ownerType: 'room', ownerRef: String(u._id), status: { $ne: 'closed' } }).select('_id').lean() : null;
    out.push({
      unitId: u._id ? String(u._id) : null,
      index: i + 1,
      status: u.status,
      roomType: u.roomTypeBooked?.name ? { id: idStr(u.roomTypeBooked), name: u.roomTypeBooked.name } : { id: idStr(res.roomType), name: res.roomType?.name },
      room: room ? { id: String(room._id), number: room.number, floor: room.floor, cleanStatus: room.cleanStatus, opsStatus: room.opsStatus } : null,
      arrivalDate: u.arrivalDate,
      departureDate: u.departureDate,
      readiness,
      billing: unitBilling(u),
      guarantee: unitPaysSelf(u) ? unitGuarantee : null,
      folioId: own?._id ? String(own._id) : null,
      queue: queue ? { id: String(queue._id), reason: queue.reason, arrivedAt: queue.arrivedAt } : null,
    });
  }
  const folio = await Folio.findOne({ reservation: res._id, ownerType: { $ne: 'room' } }).select('lines status').lean();
  const card = await GuestRegistrationCard.findOne({ reservation: res._id, guest: res.primaryGuest?._id })
    .sort({ createdAt: -1 })
    .select('status signedAt idVerified termsVersion idDocType nationality createdAt')
    .lean();
  const g = res.primaryGuest || {};
  const known = await knownDocFor(g._id, businessDateOf(property));
  const digits = known ? String(known.number).replace(/\s+/g, '') : '';
  return {
    businessDate: businessDateOf(property),
    policy: policyOf(property),
    reservation: {
      id: String(res._id),
      confirmationNumber: res.confirmationNumber,
      status: res.status,
      arrivalDate: res.arrivalDate,
      departureDate: res.departureDate,
      nights: res.nights,
      adults: res.adults,
      children: res.children,
      totalAmount: res.totalAmount,
      currency: res.currency,
      eta: res.eta || null,
      specialRequests: res.specialRequests || null,
      company: res.company ? { id: idStr(res.company), name: res.company.name } : null,
      guaranteeType: res.guaranteeType,
      folioId: folio?._id ? String(folio._id) : null,
    },
    guest: {
      id: idStr(g),
      firstName: g.firstName || '',
      lastName: g.lastName || '',
      email: g.email || null,
      phone: g.phone || null,
      country: g.citizenship || g.country || null,
      dateOfBirth: g.dateOfBirth || known?.dateOfBirth || null,
      nationality: /^[A-Za-z]{2}$/.test(g.citizenship || '') ? g.citizenship.toUpperCase()
        : /^[A-Za-z]{2}$/.test(g.country || '') ? g.country.toUpperCase() : (known?.nationality || null),
      knownDoc: known ? { idDocType: known.idDocType, last4: digits.slice(-4), expiry: known.expiry, source: known.source } : null,
      blacklisted: !!g.isBlacklisted,
      marketingConsent: !!g.marketingConsent,
    },
    guarantee: guaranteeState(res, folio),
    registration: card ? {
      id: String(card._id), status: card.status, signedAt: card.signedAt, idVerified: !!card.idVerified,
      termsVersion: card.termsVersion || null, idDocType: card.idDocType, nationality: card.nationality,
    } : null,
    units: out,
  };
}

// ── FD-05 registration ──────────────────────────────────────────────────────
export async function saveRegistration({ propertyId, reservationId, input, actor, ip }) {
  const property = await loadProperty(propertyId);
  const policy = policyOf(property);
  const res = await loadReservationInScope(reservationId, propertyId);
  if (![...ARRIVING_STATUSES, ...IN_HOUSE_STATUSES].includes(res.status)) {
    throw httpError('רישום אורח נשמר רק להזמנה שמגיעה או שוהה', 409);
  }
  const firstName = String(input.firstName || '').trim().slice(0, 200);
  const lastName = String(input.lastName || '').trim().slice(0, 200);
  const errors = {};
  if (!firstName) errors.firstName = 'שם פרטי נדרש';
  if (!lastName) errors.lastName = 'שם משפחה נדרש';
  if (!input.dateOfBirth || Number.isNaN(Date.parse(input.dateOfBirth))) errors.dateOfBirth = 'תאריך לידה נדרש';
  else if (Date.parse(input.dateOfBirth) > Date.now()) errors.dateOfBirth = 'תאריך לידה עתידי';
  else if (Date.parse(input.dateOfBirth) < Date.parse('1900-01-01')) errors.dateOfBirth = 'תאריך לידה לא סביר';
  if (input.idDocExpiry) {
    if (Number.isNaN(Date.parse(input.idDocExpiry))) errors.idDocExpiry = 'תאריך לא תקין';
    else if (Date.parse(input.idDocExpiry) < Date.parse(businessDateOf(property))) errors.idDocExpiry = 'תוקף המסמך פג';
  }
  if (!/^[A-Za-z]{2}$/.test(String(input.nationality || ''))) errors.nationality = 'יש לבחור אזרחות';
  if (!['passport', 'id_card', 'drivers_license', 'other'].includes(input.idDocType)) errors.idDocType = 'יש לבחור סוג מסמך';
  let idDocNumber = String(input.idDocNumber || '').trim().slice(0, 40);
  let idDocType = input.idDocType;
  let idDocExpiry = input.idDocExpiry;
  if (!idDocNumber && input.reuseKnownDoc === true) {
    const known = await knownDocFor(res.primaryGuest._id, businessDateOf(property));
    if (known) { idDocNumber = String(known.number).trim().slice(0, 40); idDocType = known.idDocType; idDocExpiry = known.expiry; }
  }
  if (!idDocNumber) errors.idDocNumber = 'מספר מסמך נדרש';
  if (input.idVerified !== true) errors.idVerified = 'יש לאשר שמסמך הזיהוי נבדק';
  // Only a real PNG data URL is accepted; anything else is an error, never silently dropped.
  let signature = null;
  if (input.signature !== undefined && input.signature !== null && input.signature !== '') {
    const m = typeof input.signature === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.signature) : null;
    const bytes = m ? Buffer.from(m[1], 'base64') : null;
    if (!bytes || bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) errors.signature = 'קובץ החתימה אינו תקין';
    else if (input.signature.length > 400_000) errors.signature = 'קובץ החתימה גדול מדי';
    else signature = input.signature;
  }
  if (policy.requireSignature && !signature && !errors.signature) errors.signature = 'נדרשת חתימת האורח';
  if (Object.keys(errors).length) throw httpError('יש לתקן את שדות הרישום', 422, { fields: errors });

  const unitRoom = await ReservationRoom.findOne({ reservation: res._id }).sort({ createdAt: 1 }).populate('assignedRoom', 'number').lean();
  const roomNumber = unitRoom?.assignedRoom?.number || (res.assignedRoom ? (await Room.findById(res.assignedRoom).select('number').lean())?.number : undefined);

  // A signature only counts as "signed" against an approved terms text; without one it is kept
  // as evidence but the card stays pending.
  const signedStatus = signature && policy.termsText ? 'signed' : 'pending';
  const previous = await GuestRegistrationCard.find({ reservation: res._id, guest: res.primaryGuest._id, supersededBy: { $exists: false } }).select('_id').lean();

  const card = await GuestRegistrationCard.create({
    property: res.property,
    reservation: res._id,
    reservationRoom: unitRoom?._id,
    guest: res.primaryGuest._id,
    firstName,
    lastName,
    dateOfBirth: new Date(input.dateOfBirth),
    nationality: String(input.nationality).toUpperCase(),
    idDocType,
    idDocNumber,
    idDocExpiry: idDocExpiry && !Number.isNaN(Date.parse(idDocExpiry)) ? new Date(idDocExpiry) : undefined,
    arrivalDate: res.arrivalDate,
    departureDate: res.departureDate,
    status: signedStatus,
    signatureUrl: signature || undefined,
    signatureHash: signature ? crypto.createHash('sha256').update(signature).digest('hex') : undefined,
    signedAt: signature ? new Date() : undefined,
    signedBy: actor.id || undefined,
    idVerified: true,
    termsVersion: policy.termsVersion,
    digitalDocConsent: input.digitalDocConsent === true,
    assignedRoom: roomNumber,
    createdBy: actor.id || undefined,
    ipAddress: ip,
  });

  // A correction replaces the earlier card: the register shows only the current one, the old one
  // stays for the record (cards cannot be deleted).
  if (previous.length) {
    await GuestRegistrationCard.updateMany(
      { _id: { $in: previous.map((x) => x._id) } },
      { $set: { supersededBy: card._id, supersededAt: new Date() } },
    );
  }

  // Marketing consent is its own decision, never pre-checked and never implied by registration.
  if (input.marketingConsent === true && !res.primaryGuest.marketingConsent) {
    const at = new Date();
    await GuestProfile.updateOne(
      { _id: res.primaryGuest._id },
      { $set: { marketingConsent: true, marketingConsentAt: at, marketingConsentIp: ip, marketingConsentFormVer: 'front_desk_marketing:v1' } },
    );
    await audit({
      property: res.property, actor: actor.id, actorName: actor.name,
      action: 'guest.marketing_consent_granted', entityType: 'GuestProfile', entityId: res.primaryGuest._id,
      after: { channel: 'front_desk', recordedBy: actor.name, formVersion: 'front_desk_marketing:v1', at }, ip,
    });
  }

  // Never write the ID number or the signature image into the audit trail.
  await audit({
    property: res.property, actor: actor.id, actorName: actor.name,
    action: 'registration.saved', entityType: 'GuestRegistrationCard', entityId: card._id,
    after: { reservation: String(res._id), status: card.status, idDocType: card.idDocType, termsVersion: card.termsVersion, signed: !!signature, supersedes: previous.map((x) => String(x._id)) },
    ip,
  });

  return {
    id: String(card._id), status: card.status, signedAt: card.signedAt, idVerified: true, termsVersion: card.termsVersion,
    termsMissing: !policy.termsText,
  };
}

// ── FD-03 complete check-in ─────────────────────────────────────────────────
export async function completeCheckIn({ propertyId, reservationId, unitIds, unitIndexes, guarantee, unitGuarantees, override, actor, ip }) {
  const property = await loadProperty(propertyId);
  const policy = policyOf(property);
  const res = await loadReservationInScope(reservationId, propertyId);
  const isManager = MANAGER_ROLES.includes(actor.role);

  const overrideOn = !!override?.enabled;
  const overrideReason = String(override?.reason || '').trim().slice(0, 500);
  if (overrideOn && !isManager) throw httpError('חריג כניסה מותר רק למנהל משמרת ומעלה', 403);
  if (overrideOn && overrideReason.length < 3) throw httpError('חריג כניסה מחייב סיבה', 422, { fields: { overrideReason: 'יש לפרט סיבה' } });

  // The guarantee method is validated now and applied in memory so readiness sees it, but it is
  // only persisted once every check passed — a refused check-in leaves no side effects.
  let guaranteeChange = null;
  if (guarantee?.method) {
    if (!GUARANTEE_METHODS.includes(guarantee.method)) throw httpError('שיטת ערבות לא מוכרת', 422);
    if (guarantee.method === 'company_guarantee' && !res.company) {
      throw httpError('ערבות חברה דורשת חברה משויכת להזמנה', 422, { fields: { guarantee: 'אין חברה משויכת' } });
    }
    // A self-declared card or voucher needs something checkable behind it.
    const ref = String(guarantee.reference || '').trim();
    if (['credit_card', 'voucher'].includes(guarantee.method) && ref.length < 4) {
      throw httpError(guarantee.method === 'credit_card' ? 'יש לרשום 4 ספרות אחרונות או מספר אישור מהמסוף' : 'יש לרשום את מספר השובר', 422, { fields: { guaranteeReference: 'נדרשת אסמכתה' } });
    }
    if (res.guaranteeType !== guarantee.method) {
      guaranteeChange = { before: res.guaranteeType, after: guarantee.method };
      res.guaranteeType = guarantee.method;
    }
  }

  // Per-room guarantees (rooms whose guest pays for themselves): validated now, applied in memory
  // to the units before readiness is re-checked, saved only when the check-in goes through.
  const roomGuarantees = [];
  for (const g of Array.isArray(unitGuarantees) ? unitGuarantees : []) {
    if (!g?.method) continue;
    if (!['credit_card', 'deposit', 'voucher'].includes(g.method)) throw httpError('שיטת ערבות לחדר לא מוכרת', 422);
    const ref = String(g.reference || '').trim().slice(0, 80);
    if (['credit_card', 'voucher'].includes(g.method) && ref.length < 4) {
      throw httpError(`חדר ${g.unitIndex || ''}: ${g.method === 'credit_card' ? 'יש לרשום 4 ספרות אחרונות או מספר אישור' : 'יש לרשום את מספר השובר'}`, 422, { fields: { unitGuarantee: 'נדרשת אסמכתה' } });
    }
    roomGuarantees.push({ unitId: g.unitId ? String(g.unitId) : null, unitIndex: Number(g.unitIndex) || null, method: g.method, reference: ref || undefined });
  }

  return withLocks([`res:${res._id}`], () => checkInLocked({ property, policy, res, unitIds, unitIndexes, guarantee, guaranteeChange, roomGuarantees, overrideOn, overrideReason, actor, ip }));
}

async function checkInLocked({ property, policy, res, unitIds, unitIndexes, guarantee, guaranteeChange, roomGuarantees = [], overrideOn, overrideReason, actor, ip }) {
  const units = await ensureUnits(res);
  let wanted;
  if (Array.isArray(unitIds) && unitIds.filter(Boolean).length) wanted = units.filter((u) => unitIds.map(String).includes(String(u._id)));
  else if (Array.isArray(unitIndexes) && unitIndexes.length) wanted = unitIndexes.map((i) => units[Number(i) - 1]).filter(Boolean);
  else wanted = units.length === 1 ? units : [];
  if (!wanted.length) throw httpError('יש לבחור לפחות יחידת שהייה אחת לכניסה', 422);

  const changedGuarantees = [];
  for (const g of roomGuarantees) {
    const u = g.unitId ? units.find((x) => String(x._id) === g.unitId) : units[g.unitIndex - 1];
    if (!u) continue;
    u.guaranteeType = g.method;
    u.guaranteeReference = g.reference;
    changedGuarantees.push(u);
  }

  // Re-check every selected unit now; a room blocked or taken since the wizard opened fails here.
  const failures = [];
  const usedOverride = new Set();
  for (const u of wanted) {
    const { readiness } = await unitReadiness(res, u.toObject(), property);
    if (readiness.state === 'checked_in') { failures.push({ unitId: String(u._id), reasons: [reason('already_in', 'היחידה כבר נכנסה', 'blocked')] }); continue; }
    const hard = readiness.reasons.filter((r) => r.severity === 'blocked');
    const soft = readiness.reasons.filter((r) => r.severity === 'waiting');
    const guaranteeMissing = readiness.reasons.find((r) => r.code === 'guarantee');
    const unresolved = [...hard];
    if (soft.length) { if (overrideOn) soft.forEach((s) => usedOverride.add(s.code)); else unresolved.push(...soft); }
    if (guaranteeMissing) { if (overrideOn) usedOverride.add('guarantee'); else unresolved.push({ ...guaranteeMissing, severity: 'blocked' }); }
    if (unresolved.length) failures.push({ unitId: String(u._id), reasons: unresolved });
  }
  // The guest register is a legal record: no override skips it.
  if (policy.requireRegistration) {
    const card = await GuestRegistrationCard.exists({ reservation: res._id, guest: res.primaryGuest._id });
    if (!card) failures.push({ unitId: null, reasons: [reason('registration', 'לא נשמר רישום אורח', 'blocked', 'registration')] });
  }
  if (failures.length) {
    throw httpError('הכניסה לא בוצעה — יש סיבות פתוחות', 409, { details: failures });
  }

  for (const u of changedGuarantees) {
    await ReservationRoom.updateOne({ _id: u._id }, { $set: { guaranteeType: u.guaranteeType, guaranteeReference: u.guaranteeReference } });
    await audit({
      property: res.property, actor: actor.id, actorName: actor.name, action: 'reservation.room_guarantee_set',
      entityType: 'ReservationRoom', entityId: u._id, after: { reservation: String(res._id), guaranteeType: u.guaranteeType, hasReference: !!u.guaranteeReference }, ip,
    });
  }

  if (guaranteeChange) {
    res.updatedBy = actor.id || undefined;
    await res.save();
    await audit({
      property: res.property, actor: actor.id, actorName: actor.name, action: 'reservation.guarantee_set',
      entityType: 'Reservation', entityId: res._id, before: { guaranteeType: guaranteeChange.before },
      after: { guaranteeType: guaranteeChange.after, reference: guarantee.reference ? String(guarantee.reference).slice(0, 80) : undefined }, ip,
    });
  }

  const allUnits = units.length;
  const singleFull = allUnits === 1 && wanted.length === 1;

  // Claim the units atomically: only units still open flip to in-house. If any was taken meanwhile
  // (another desk, a retry), undo our claim and stop before anything is charged.
  const claim = await ReservationRoom.updateMany(
    { _id: { $in: wanted.map((u) => u._id) }, status: { $in: UNIT_OPEN_STATUSES } },
    { $set: { status: 'in_house' } },
  );
  if (claim.modifiedCount !== wanted.length) {
    await ReservationRoom.updateMany({ _id: { $in: wanted.map((u) => u._id) }, status: 'in_house' }, { $set: { status: 'reserved' } }).catch(() => null);
    throw httpError('אחת היחידות נכנסה בינתיים — רעננו את המסך', 409, { code: 'already_in' });
  }

  if (singleFull) {
    // Keep the established single-room path (folio posting, guest stats, automations).
    // That path reads the reservation-level room pointer, so align it with the unit first.
    try {
      if (String(res.assignedRoom || '') !== String(wanted[0].assignedRoom || '')) {
        res.assignedRoom = wanted[0].assignedRoom;
        await res.save();
      }
      await checkInReservation({
        reservationId: res._id,
        actorId: actor.id,
        actorName: actor.name,
        ip,
        overrideClean: overrideOn,
        overrideEarlyArrival: false,
      });
    } catch (err) {
      await ReservationRoom.updateOne({ _id: wanted[0]._id }, { $set: { status: 'reserved' } }).catch(() => null);
      throw err;
    }
  } else {
    // Multi-room: only the selected units enter; the reservation reflects a partial entry.
    await Room.updateMany({ _id: { $in: wanted.map((u) => u.assignedRoom).filter(Boolean) } }, { $set: { occStatus: 'occupied' } });
    const before = { status: res.status };
    // Recount after the write: a parallel entry of another unit must not leave the stay "partial".
    const stillOpen = await ReservationRoom.countDocuments({ reservation: res._id, status: { $in: UNIT_OPEN_STATUSES } });
    const firstEntry = !['in_house', 'partially_checked_in'].includes(res.status);
    res.status = stillOpen === 0 ? 'in_house' : 'partially_checked_in';
    if (!res.checkedInAt) res.checkedInAt = new Date();
    res.updatedBy = actor.id || undefined;
    await res.save();
    if (firstEntry) {
      await GuestProfile.findByIdAndUpdate(res.primaryGuest._id, { $inc: { totalStays: 1, totalRevenue: res.totalAmount || 0 } });
    }
    fireEvent('checkin.completed', {
      property: String(res.property), reservation: res.toObject(), actor: { id: actor.id, name: actor.name },
    }).catch(() => null);
    await audit({
      property: res.property, actor: actor.id, actorName: actor.name, action: 'reservation.units_check_in',
      entityType: 'Reservation', entityId: res._id, before, after: { status: res.status, unitIds: wanted.map((u) => String(u._id)) }, ip,
    });
  }

  if (overrideOn) {
    await audit({
      property: res.property, actor: actor.id, actorName: actor.name, action: 'reservation.check_in_override',
      entityType: 'Reservation', entityId: res._id, reason: overrideReason,
      after: { overridden: [...usedOverride], unitIds: wanted.map((u) => String(u._id)) }, ip,
    });
  }

  await ArrivalQueueEntry.updateMany(
    { reservationRoom: { $in: wanted.map((u) => u._id) }, status: 'active' },
    { $set: { status: 'checked_in', resolvedAt: new Date(), updatedBy: actor.id || undefined } },
  );

  const fresh = await Reservation.findById(res._id).select('status checkedInAt confirmationNumber').lean();
  const remaining = await ReservationRoom.countDocuments({ reservation: res._id, status: { $in: UNIT_OPEN_STATUSES } });
  return {
    reservationId: String(res._id),
    confirmationNumber: fresh.confirmationNumber,
    status: fresh.status,
    checkedInUnits: wanted.map((u) => String(u._id)),
    remainingUnits: remaining,
    overridden: [...usedOverride],
    // Key issuing is a separate integration (INT-04); no lock provider is connected.
    key: { status: 'not_connected', label: 'לא מחובר ספק מפתחות — מסירה ידנית' },
  };
}

// ── INV-02 room candidates & assignment ─────────────────────────────────────
export async function conflictingRoomIds({ propertyId, from, to, excludeReservationId }) {
  const [resConflicts, unitConflicts] = await Promise.all([
    Reservation.find({
      property: propertyId,
      _id: { $ne: excludeReservationId },
      assignedRoom: { $ne: null },
      status: { $in: HOLDING_STATUSES },
      arrivalDate: { $lt: to },
      departureDate: { $gt: from },
    }).select('assignedRoom confirmationNumber').lean(),
    ReservationRoom.find({
      property: propertyId,
      reservation: { $ne: excludeReservationId },
      assignedRoom: { $ne: null },
      status: { $in: UNIT_HOLDING_STATUSES },
      arrivalDate: { $lt: to },
      departureDate: { $gt: from },
    }).select('assignedRoom reservation').populate('reservation', 'status confirmationNumber').lean(),
  ]);
  const map = new Map();
  for (const r of resConflicts) map.set(String(r.assignedRoom), r.confirmationNumber);
  for (const u of unitConflicts) {
    if (!u.reservation || !HOLDING_STATUSES.includes(u.reservation.status)) continue;
    if (!map.has(String(u.assignedRoom))) map.set(String(u.assignedRoom), u.reservation.confirmationNumber || 'יחידה אחרת');
  }
  // INV-04: a room taken out of sale for dates inside the range is not a candidate either.
  const blocks = await RoomBlock.find({ property: propertyId, status: 'active', from: { $lt: to }, to: { $gt: from } }).select('room from to reason').lean();
  for (const b of blocks) if (!map.has(String(b.room))) map.set(String(b.room), `חסום ${b.from.split('-').reverse().join('.')}–${b.to.split('-').reverse().join('.')}: ${b.reason}`);
  return map;
}

export async function roomCandidates({ propertyId, reservationId, unitId, allTypes }) {
  const property = await loadProperty(propertyId);
  const policy = policyOf(property);
  const res = await loadReservationInScope(reservationId, propertyId);
  if (![...ARRIVING_STATUSES, 'hold'].includes(res.status)) throw httpError('שיבוץ מתבצע רק להזמנה שטרם נכנסה', 409);
  let unit = null;
  if (unitId) {
    if (!isId(String(unitId))) throw httpError('מזהה יחידה לא תקין', 400);
    unit = await ReservationRoom.findOne({ _id: unitId, reservation: res._id }).lean();
    if (!unit) throw httpError('יחידת השהייה לא נמצאה', 404);
  }
  const from = unit?.arrivalDate || res.arrivalDate;
  const to = unit?.departureDate || res.departureDate;
  const roomTypeId = idStr(unit?.roomTypeBooked || res.roomType);
  const conflicts = await conflictingRoomIds({ propertyId, from, to, excludeReservationId: res._id });
  // Rooms taken by this reservation's other units are not candidates for this unit.
  const siblings = await ReservationRoom.find({ reservation: res._id, _id: { $ne: unit?._id || null }, assignedRoom: { $ne: null } }).select('assignedRoom').lean();
  for (const s of siblings) conflicts.set(String(s.assignedRoom), 'יחידה אחרת בהזמנה זו');

  const roomFilter = { property: propertyId, active: { $ne: false } };
  if (!allTypes) roomFilter.roomType = roomTypeId;
  const rooms = await Room.find(roomFilter).populate('roomType', 'name code').sort({ floor: 1, number: 1 }).lean();
  const occ = await occupancyMap(propertyId, rooms.map((r) => r._id));
  const readyClean = policy.requireInspection ? ['inspected'] : ['clean', 'inspected'];
  const currentRoomId = idStr(unit ? unit.assignedRoom : res.assignedRoom);

  const candidates = rooms.map((room) => {
    const conflict = conflicts.get(String(room._id)) || null;
    const blocked = room.opsStatus && room.opsStatus !== 'available';
    const occupiedBy = occupantOther(occ, room._id, res._id);
    return {
      id: String(room._id),
      number: room.number,
      floor: room.floor,
      roomType: room.roomType ? { id: String(room.roomType._id), name: room.roomType.name, code: room.roomType.code } : null,
      sameType: idStr(room.roomType) === roomTypeId,
      cleanStatus: room.cleanStatus,
      opsStatus: room.opsStatus,
      occupiedBy,
      conflict,
      current: String(room._id) === currentRoomId,
      assignable: !conflict && !blocked,
      readyNow: !conflict && !blocked && !occupiedBy && readyClean.includes(room.cleanStatus),
      isAccessible: !!room.isAccessible,
    };
  });
  return {
    range: { from, to, nights: nightsBetween(from, to) },
    roomType: res.roomType ? { id: roomTypeId, name: res.roomType.name } : null,
    currentRoomId,
    candidates,
  };
}

export async function assignRoom(args) {
  if (!isId(String(args.roomId || ''))) throw httpError('יש לבחור חדר', 422);
  if (!isId(String(args.reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  // Lock the room (two reservations racing for it) and the reservation (unit materialisation).
  return withLocks([`room:${args.roomId}`, `res:${args.reservationId}`], () => assignRoomLocked(args));
}

async function assignRoomLocked({ propertyId, reservationId, unitId, roomId, reason: changeReason, actor, ip }) {
  const res = await loadReservationInScope(reservationId, propertyId);
  if (![...ARRIVING_STATUSES, 'hold'].includes(res.status)) throw httpError('שיבוץ מתבצע רק להזמנה שטרם נכנסה', 409);
  const room = await Room.findOne({ _id: roomId, property: propertyId }).lean();
  if (!room) throw httpError('החדר לא נמצא בנכס', 404);
  if (room.opsStatus && room.opsStatus !== 'available') throw httpError(`חדר ${room.number} חסום תפעולית`, 409);

  const units = await ensureUnits(res);
  const unit = unitId ? units.find((u) => String(u._id) === String(unitId)) : (units.length === 1 ? units[0] : null);
  if (!unit) throw httpError('יש לבחור יחידת שהייה לשיבוץ', 422);
  if (!UNIT_OPEN_STATUSES.includes(unit.status)) throw httpError('היחידה כבר נכנסה — שינוי חדר מתבצע במעבר חדר', 409);

  const replacing = unit.assignedRoom && String(unit.assignedRoom) !== String(room._id);
  const why = String(changeReason || '').trim().slice(0, 500);
  if (replacing && why.length < 3) throw httpError('החלפת שיבוץ קיים מחייבת סיבה', 422, { fields: { reason: 'יש לפרט סיבה' } });

  // Re-check the full range at write time — the list the user saw may be stale.
  const conflicts = await conflictingRoomIds({ propertyId, from: unit.arrivalDate, to: unit.departureDate, excludeReservationId: res._id });
  const sibling = units.find((u) => String(u._id) !== String(unit._id) && String(u.assignedRoom || '') === String(room._id));
  if (conflicts.has(String(room._id)) || sibling) {
    throw httpError(`חדר ${room.number} נתפס בינתיים לחלק מהלילות (${conflicts.get(String(room._id)) || 'יחידה אחרת בהזמנה'})`, 409);
  }

  const before = { room: idStr(unit.assignedRoom) };
  unit.assignedRoom = room._id;
  await unit.save();
  // Keep the reservation-level pointer in sync for single-room stays and for the first unit,
  // which the tape chart and legacy screens read.
  if (units.length === 1 || String(units[0]._id) === String(unit._id)) {
    res.assignedRoom = room._id;
    res.updatedBy = actor.id || undefined;
    await res.save();
  }
  // A queue entry waiting for assignment now waits for the new room instead.
  await ArrivalQueueEntry.updateMany({ reservationRoom: unit._id, status: 'active' }, { $set: { room: room._id } });

  await audit({
    property: res.property, actor: actor.id, actorName: actor.name, action: replacing ? 'reservation.room_reassigned' : 'reservation.room_assigned',
    entityType: 'Reservation', entityId: res._id, before, after: { room: String(room._id), number: room.number, unitId: String(unit._id) },
    reason: why || undefined, ip,
  });
  return { reservationId: String(res._id), unitId: String(unit._id), room: { id: String(room._id), number: room.number } };
}

// ── ETA ─────────────────────────────────────────────────────────────────────
export async function setEta({ propertyId, reservationId, eta, actor, ip }) {
  const res = await loadReservationInScope(reservationId, propertyId);
  const value = eta ? String(eta) : null;
  if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw httpError('שעה לא תקינה (HH:MM)', 422);
  const before = res.eta || null;
  res.eta = value || undefined;
  await res.save();
  await audit({ property: res.property, actor: actor.id, actorName: actor.name, action: 'reservation.eta_set', entityType: 'Reservation', entityId: res._id, before: { eta: before }, after: { eta: value }, ip });
  return { eta: value };
}

// ── RSV-07 no-show from arrivals ────────────────────────────────────────────
export async function noShowFromArrivals({ propertyId, reservationId, actor, ip }) {
  const property = await loadProperty(propertyId);
  const res = await loadReservationInScope(reservationId, propertyId);
  const units = await ReservationRoom.countDocuments({ reservation: res._id });
  if (units > 1) throw httpError('הזמנה מרובת חדרים — אי הגעה מטופלת מתוך תיק ההזמנה ליחידה הרלוונטית', 409);
  if (res.arrivalDate > businessDateOf(property)) throw httpError('לא ניתן לסמן אי הגעה לפני יום ההגעה', 409);
  const active = await ArrivalQueueEntry.exists({ reservation: res._id, status: 'active' });
  if (active) throw httpError('האורח רשום בתור ההמתנה — כלומר הגיע. יש להסיר מהתור קודם', 409);
  const updated = await markNoShow({ reservationId: res._id, actorId: actor.id, actorName: actor.name, ip });
  await ReservationRoom.updateMany({ reservation: res._id, status: { $in: UNIT_OPEN_STATUSES } }, { $set: { status: 'no_show' } });
  return { reservationId: String(updated._id), status: updated.status };
}

// ── FD-04 queue ─────────────────────────────────────────────────────────────
function queueDto(e, extras = {}) {
  const res = e.reservation || {};
  const g = res.primaryGuest || {};
  return {
    id: String(e._id),
    version: e.__v,
    status: e.status,
    reservationId: idStr(res),
    confirmationNumber: res.confirmationNumber,
    unitId: idStr(e.reservationRoom),
    guest: { name: `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'אורח', vip: !!(res.isVip || g.vipLevel > 0) },
    room: e.room ? { id: idStr(e.room), number: e.room.number, cleanStatus: e.room.cleanStatus, opsStatus: e.room.opsStatus } : null,
    arrivedAt: e.arrivedAt,
    reason: e.reason,
    owner: e.owner ? { id: idStr(e.owner), name: e.ownerName || `${e.owner.firstName || ''} ${e.owner.lastName || ''}`.trim() } : null,
    housekeepingTask: e.housekeepingTask ? { id: idStr(e.housekeepingTask), status: e.housekeepingTask.status, priority: e.housekeepingTask.priority } : null,
    readyEta: e.readyEta || null,
    priority: e.priority,
    guestContact: e.guestContact || null,
    notes: e.notes || null,
    resolvedAt: e.resolvedAt || null,
    removalReason: e.removalReason || null,
    ...extras,
  };
}

function populateQueue(query) {
  return query
    .populate({ path: 'reservation', select: 'confirmationNumber primaryGuest isVip arrivalDate departureDate', populate: { path: 'primaryGuest', select: 'firstName lastName vipLevel' } })
    .populate('room', 'number cleanStatus opsStatus')
    .populate('owner', 'firstName lastName')
    .populate('housekeepingTask', 'status priority');
}

export async function listQueue({ propertyId, status = 'active' }) {
  const property = await loadProperty(propertyId);
  const filter = { property: propertyId };
  if (status === 'active') filter.status = 'active';
  else {
    // Resolved entries of the current business day only; history lives in the audit trail.
    const since = new Date(Date.now() - 36 * 3600 * 1000);
    filter.status = { $in: ['checked_in', 'removed'] };
    filter.resolvedAt = { $gte: since };
  }
  const rows = await populateQueue(ArrivalQueueEntry.find(filter).sort({ priority: -1, arrivedAt: 1, _id: 1 }).limit(200)).lean();
  // Re-derive readiness for active entries (batched) so "ready now" shows without a manual refresh.
  const active = rows.filter((e) => e.status === 'active');
  const policy = policyOf(property);
  const businessDate = businessDateOf(property);
  const resIds = active.map((e) => idStr(e.reservation));
  const [resDocs, unitDocs, folios] = await Promise.all([
    Reservation.find({ _id: { $in: resIds } }).populate('primaryGuest', 'isBlacklisted').lean(),
    ReservationRoom.find({ _id: { $in: active.map((e) => idStr(e.reservationRoom)) } }).lean(),
    Folio.find({ reservation: { $in: resIds }, ownerType: { $ne: 'room' } }).select('reservation lines').lean(),
  ]);
  const roomIds = unitDocs.map((u) => u.assignedRoom).filter(Boolean);
  const [roomDocs, occ] = await Promise.all([Room.find({ _id: { $in: roomIds } }).lean(), occupancyMap(propertyId, roomIds)]);
  const resById = new Map(resDocs.map((x) => [String(x._id), x]));
  const unitById = new Map(unitDocs.map((x) => [String(x._id), x]));
  const roomById = new Map(roomDocs.map((x) => [String(x._id), x]));
  const folioByRes = new Map(folios.map((f) => [String(f.reservation), f]));
  const out = rows.map((e) => {
    let readiness = null;
    const res = resById.get(idStr(e.reservation));
    const unit = unitById.get(idStr(e.reservationRoom));
    if (e.status === 'active' && res && unit) {
      const room = unit.assignedRoom ? roomById.get(String(unit.assignedRoom)) : null;
      readiness = computeReadiness({
        res, unit, room, guest: res.primaryGuest, policy, businessDate,
        occupiedBy: room ? occupantOther(occ, room._id, res._id) : null,
        guarantee: guaranteeState(res, folioByRes.get(String(res._id))), queue: e,
      });
    }
    return queueDto(e, { readiness });
  });
  return { businessDate, rows: out };
}

export async function addToQueue(args) {
  if (!isId(String(args.reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  return withLocks([`res:${args.reservationId}`], () => addToQueueLocked(args));
}

function etaError(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return 'מועד לא תקין';
  if (t < Date.now() - 3600_000 || t > Date.now() + 24 * 3600_000) return 'הערכה צריכה להיות ב־24 השעות הקרובות';
  return null;
}

async function addToQueueLocked({ propertyId, reservationId, unitId, input, actor, ip }) {
  const property = await loadProperty(propertyId);
  const res = await loadReservationInScope(reservationId, propertyId);
  if (!ARRIVING_STATUSES.includes(res.status)) throw httpError('רק הזמנה מאושרת שטרם נכנסה יכולה להיכנס לתור', 409);
  if (res.arrivalDate > businessDateOf(property)) throw httpError('ההגעה מתוכננת ליום אחר — אין להוסיף לתור של היום', 409);
  const units = await ensureUnits(res);
  const unit = unitId ? units.find((u) => String(u._id) === String(unitId)) : (units.length === 1 ? units[0] : null);
  if (!unit) throw httpError('יש לבחור יחידת שהייה', 422);
  if (!UNIT_OPEN_STATUSES.includes(unit.status)) throw httpError('היחידה כבר נכנסה', 409);

  const errors = {};
  if (!['cleaning', 'inspection', 'maintenance', 'assignment', 'occupied'].includes(input.reason)) errors.reason = 'יש לבחור סיבת עיכוב';
  const ownerId = input.ownerId || actor.id;
  if (!isId(String(ownerId || ''))) errors.ownerId = 'יש לבחור אחראי';
  const priority = input.priority === 'urgent' ? 'urgent' : 'normal';
  if (priority === 'urgent' && !MANAGER_ROLES.includes(actor.role)) errors.priority = 'עדיפות דחופה דורשת אישור מנהל';
  if (etaError(input.readyEta)) errors.readyEta = etaError(input.readyEta);
  if (input.guestContact && !['desk', 'message'].includes(input.guestContact)) errors.guestContact = 'ערך לא תקין';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי התור', 422, { fields: errors });

  // Owner must be an active desk/housekeeping user of this property — never someone elsewhere.
  const owner = await User.findOne({ _id: ownerId, property: propertyId, active: { $ne: false }, role: { $in: QUEUE_OWNER_ROLES } })
    .select('firstName lastName').lean();
  if (!owner) throw httpError('האחראי אינו משתמש פעיל בקבלה או בחדרנות בנכס', 422, { fields: { ownerId: 'משתמש לא מתאים' } });

  let entry;
  try {
    entry = await ArrivalQueueEntry.create({
      property: res.property,
      reservation: res._id,
      reservationRoom: unit._id,
      room: unit.assignedRoom || undefined,
      arrivedAt: new Date(),
      reason: input.reason,
      owner: owner._id,
      ownerName: `${owner.firstName || ''} ${owner.lastName || ''}`.trim(),
      readyEta: input.readyEta ? new Date(input.readyEta) : undefined,
      priority,
      guestContact: input.guestContact || undefined,
      notes: input.notes ? String(input.notes).slice(0, 2000) : undefined,
      createdBy: actor.id || undefined,
    });
  } catch (err) {
    if (err?.code === 11000) throw httpError('היחידה כבר נמצאת בתור ההמתנה', 409);
    throw err;
  }
  await audit({
    property: res.property, actor: actor.id, actorName: actor.name, action: 'arrival_queue.added',
    entityType: 'ArrivalQueueEntry', entityId: entry._id,
    after: { reservation: String(res._id), unit: String(unit._id), reason: entry.reason, owner: String(owner._id), priority }, ip,
  });
  return { id: String(entry._id) };
}

async function loadEntry(id, propertyId) {
  if (!isId(String(id || ''))) throw httpError('מזהה לא תקין', 400);
  const entry = await ArrivalQueueEntry.findById(id);
  if (!entry) throw httpError('רשומת התור לא נמצאה', 404);
  if (String(entry.property) !== String(propertyId)) throw httpError('רשומת התור לא נמצאה', 404);
  return entry;
}

function assertVersion(entry, version) {
  if (version === undefined || version === null || version === '') throw httpError('חסרה גרסת רשומה — רעננו את המסך', 422, { code: 'version_required' });
  if (Number(version) !== entry.__v) {
    throw httpError('הרשומה עודכנה על ידי משתמש אחר — רעננו ונסו שוב', 409, { code: 'version_conflict' });
  }
}

export async function takeQueueOwnership({ propertyId, id, version, actor, ip }) {
  const entry = await loadEntry(id, propertyId);
  if (entry.status !== 'active') throw httpError('הרשומה כבר אינה פעילה', 409);
  // Atomic: only succeeds if nobody changed the entry since the user saw it.
  assertVersion(entry, version);
  const filter = { _id: entry._id, status: 'active', __v: Number(version) };
  const updated = await ArrivalQueueEntry.findOneAndUpdate(
    filter,
    { $set: { owner: actor.id, ownerName: actor.name, updatedBy: actor.id }, $inc: { __v: 1 } },
    { returnDocument: 'after' },
  );
  if (!updated) throw httpError('הרשומה עודכנה על ידי משתמש אחר — רעננו ונסו שוב', 409, { code: 'version_conflict' });
  await audit({ property: entry.property, actor: actor.id, actorName: actor.name, action: 'arrival_queue.owner_taken', entityType: 'ArrivalQueueEntry', entityId: entry._id, before: { owner: String(entry.owner) }, after: { owner: String(actor.id) }, ip });
  return { id: String(updated._id), version: updated.__v };
}

export async function updateQueueEntry({ propertyId, id, input, actor, ip }) {
  const entry = await loadEntry(id, propertyId);
  if (entry.status !== 'active') throw httpError('הרשומה כבר אינה פעילה', 409);
  assertVersion(entry, input.version);
  const before = { readyEta: entry.readyEta, priority: entry.priority, guestContact: entry.guestContact, reason: entry.reason, notes: entry.notes };
  if (input.readyEta !== undefined) {
    if (etaError(input.readyEta)) throw httpError(etaError(input.readyEta), 422, { fields: { readyEta: etaError(input.readyEta) } });
    entry.readyEta = input.readyEta ? new Date(input.readyEta) : undefined;
  }
  if (input.priority !== undefined) {
    const p = input.priority === 'urgent' ? 'urgent' : 'normal';
    if (p === 'urgent' && entry.priority !== 'urgent' && !MANAGER_ROLES.includes(actor.role)) throw httpError('עדיפות דחופה דורשת אישור מנהל', 403);
    entry.priority = p;
  }
  if (input.guestContact !== undefined) {
    if (input.guestContact && !['desk', 'message'].includes(input.guestContact)) throw httpError('ערך לא תקין', 422);
    entry.guestContact = input.guestContact || undefined;
  }
  if (input.reason !== undefined) {
    if (!['cleaning', 'inspection', 'maintenance', 'assignment', 'occupied'].includes(input.reason)) throw httpError('סיבה לא תקינה', 422);
    entry.reason = input.reason;
  }
  if (input.notes !== undefined) entry.notes = input.notes ? String(input.notes).slice(0, 2000) : undefined;
  entry.updatedBy = actor.id || undefined;
  try {
    await entry.save();
  } catch (err) {
    if (err?.name === 'VersionError') throw httpError('הרשומה עודכנה על ידי משתמש אחר — רעננו ונסו שוב', 409, { code: 'version_conflict' });
    throw err;
  }
  await audit({ property: entry.property, actor: actor.id, actorName: actor.name, action: 'arrival_queue.updated', entityType: 'ArrivalQueueEntry', entityId: entry._id, before, after: { readyEta: entry.readyEta, priority: entry.priority, guestContact: entry.guestContact, reason: entry.reason }, ip });
  return { id: String(entry._id), version: entry.__v };
}

export async function removeFromQueue({ propertyId, id, reason: why, version, actor, ip }) {
  const entry = await loadEntry(id, propertyId);
  if (entry.status !== 'active') throw httpError('הרשומה כבר אינה פעילה', 409);
  assertVersion(entry, version);
  const text = String(why || '').trim().slice(0, 500);
  if (text.length < 3) throw httpError('הסרה מהתור מחייבת סיבה', 422, { fields: { reason: 'יש לפרט סיבה' } });
  // Conditional write: a check-in that resolved the entry meanwhile wins over the removal.
  const updated = await ArrivalQueueEntry.findOneAndUpdate(
    { _id: entry._id, status: 'active', __v: entry.__v },
    { $set: { status: 'removed', removalReason: text, resolvedAt: new Date(), updatedBy: actor.id || undefined }, $inc: { __v: 1 } },
    { returnDocument: 'after' },
  );
  if (!updated) throw httpError('הרשומה עודכנה בינתיים — רעננו ונסו שוב', 409, { code: 'version_conflict' });
  await audit({ property: entry.property, actor: actor.id, actorName: actor.name, action: 'arrival_queue.removed', entityType: 'ArrivalQueueEntry', entityId: entry._id, reason: text, after: { status: 'removed' }, ip });
  return { id: String(entry._id) };
}

// FD-04-A02: ask housekeeping to prioritise the room. Never marks the room ready.
export async function prioritizeHousekeeping({ propertyId, id, actor, ip }) {
  const property = await loadProperty(propertyId);
  const entry = await loadEntry(id, propertyId);
  if (entry.status !== 'active') throw httpError('הרשומה כבר אינה פעילה', 409);
  const unit = await ReservationRoom.findById(entry.reservationRoom).lean();
  const roomId = unit?.assignedRoom || entry.room;
  if (!roomId) throw httpError('אין חדר משובץ — יש לשבץ חדר לפני בקשת עדיפות מחדרנות', 409);
  const today = businessDateOf(property);
  let task = await HousekeepingTask.findOne({ property: propertyId, room: roomId, date: today, status: { $in: ACTIVE_HK_STATUSES } }).sort({ createdAt: -1 });
  let created = false;
  if (task) {
    if (task.priority !== 'urgent') {
      task.priority = 'urgent';
      task.notes = [task.notes, 'אורח ממתין בדלפק'].filter(Boolean).join(' · ').slice(0, 2000);
      await task.save();
    }
  } else {
    if (entry.reason === 'occupied') throw httpError('האורח הקודם עדיין בחדר — אין משימת ניקיון לקדם עד שייצא', 409);
    const room = await Room.findById(roomId).select('cleanStatus').lean();
    if (room?.cleanStatus === 'inspected') throw httpError('החדר כבר נבדק ומוכן — אין צורך בניקיון', 409);
    task = await HousekeepingTask.create({
      property: propertyId,
      room: roomId,
      reservation: entry.reservation,
      // A clean room waits for inspection/prep; anything else needs a full clean.
      type: room?.cleanStatus === 'clean' ? 'arrival_prep' : 'checkout_clean',
      priority: 'urgent',
      date: today,
      notes: 'אורח ממתין בדלפק — נפתח מתור ההמתנה',
    });
    created = true;
  }
  await ArrivalQueueEntry.updateOne({ _id: entry._id }, { $set: { housekeepingTask: task._id, updatedBy: actor.id || undefined } });
  await audit({ property: entry.property, actor: actor.id, actorName: actor.name, action: 'arrival_queue.hk_priority', entityType: 'HousekeepingTask', entityId: task._id, after: { created, priority: 'urgent', queueEntry: String(entry._id) }, ip });
  return { taskId: String(task._id), created, status: task.status };
}
