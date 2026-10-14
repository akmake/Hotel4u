// Front-desk arrivals, check-in and waiting queue (spec W03: FD-02 / FD-03 / FD-04 / FD-05, INV-02).
//
// The server is the single source of truth for whether a stay unit may enter. Every list row and
// every write re-computes readiness from current room, reservation, guarantee and policy data;
// the UI only renders the reasons it receives.
import crypto from 'crypto';
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
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
import { audit } from './auditService.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

export const MANAGER_ROLES = ['super_admin', 'property_admin', 'general_manager', 'front_desk_manager'];

const ARRIVING_STATUSES = ['confirmed', 'modified', 'pending_payment', 'partially_checked_in'];
const IN_HOUSE_STATUSES = ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'];
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
const idStr = (v) => (v ? String(v._id || v) : null);
const nightsBetween = (a, b) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));

function policyOf(property) {
  const p = property?.checkInPolicy || {};
  return {
    requireInspection: !!p.requireInspection,
    requireGuarantee: p.requireGuarantee !== false,
    requireRegistration: p.requireRegistration !== false,
    requireSignature: !!p.requireSignature,
    termsVersion: p.termsVersion || 'he-1',
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
function implicitUnit(res) {
  return {
    _id: null,
    implicit: true,
    reservation: res._id,
    roomTypeBooked: res.roomType,
    assignedRoom: res.assignedRoom || null,
    arrivalDate: res.arrivalDate,
    departureDate: res.departureDate,
    status: IN_HOUSE_STATUSES.includes(res.status) && res.status !== 'partially_checked_in' ? 'in_house' : 'reserved',
  };
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
    status: IN_HOUSE_STATUSES.includes(reservation.status) ? 'in_house' : 'reserved',
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

function guaranteeState(res, folio) {
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
    reasons.push(reason('early', `הגעה מתוכננת ל־${res.arrivalDate} — כניסה מוקדמת דורשת אישור מנהל`, 'blocked'));
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
      const cleanLabel = { dirty: 'מלוכלך', pickup: 'ממתין לסידור', turndown_required: 'ממתין להכנת לילה', clean: 'נקי אך טרם נבדק' }[room.cleanStatus] || room.cleanStatus;
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

// Who physically occupies each room right now (an in-house stay that has not checked out).
async function occupancyMap(propertyId, roomIds, excludeReservationIds = []) {
  if (!roomIds.length) return new Map();
  const exclude = excludeReservationIds.map(String);
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
    }).populate('reservation', 'confirmationNumber').lean(),
  ]);
  const map = new Map();
  for (const s of stays) if (!exclude.includes(String(s._id))) map.set(String(s.assignedRoom), s.confirmationNumber);
  for (const u of units) {
    const resId = String(u.reservation?._id || u.reservation);
    if (!exclude.includes(resId)) map.set(String(u.assignedRoom), u.reservation?.confirmationNumber || 'שהייה אחרת');
  }
  return map;
}

// ── FD-02 arrivals ──────────────────────────────────────────────────────────
const SORTS = {
  eta: (r) => r.eta || '99:99',
  guest: (r) => r.guest.name,
  room: (r) => r.room?.number || '~',
  confirmation: (r) => r.confirmationNumber,
};

export async function listArrivals({ propertyId, date, q, roomTypeId, assignment, readiness, includeCheckedIn, sort = 'eta', dir = 'asc', page = 1, pageSize = 50 }) {
  const property = await loadProperty(propertyId);
  const businessDate = businessDateOf(property);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : businessDate;
  const policy = policyOf(property);

  const statuses = includeCheckedIn ? [...ARRIVING_STATUSES, ...IN_HOUSE_STATUSES] : ARRIVING_STATUSES;
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
    Folio.find({ reservation: { $in: resIds } }).select('reservation lines status').lean(),
    ArrivalQueueEntry.find({ reservation: { $in: resIds }, status: 'active' }).lean(),
  ]);
  const unitsByRes = new Map();
  for (const u of units) {
    const k = String(u.reservation);
    if (!unitsByRes.has(k)) unitsByRes.set(k, []);
    unitsByRes.get(k).push(u);
  }
  const folioByRes = new Map(folios.map((f) => [String(f.reservation), f]));
  const queueByUnit = new Map(queue.map((e) => [String(e.reservationRoom), e]));
  const queueByRes = new Map(queue.map((e) => [String(e.reservation), e]));

  const allUnits = reservations.flatMap((r) => (unitsByRes.get(String(r._id)) || [implicitUnit(r)]).map((u) => ({ r, u })));
  const roomIds = [...new Set(allUnits.map(({ u }) => idStr(u.assignedRoom)).filter(Boolean))];
  const rooms = await Room.find({ _id: { $in: roomIds } }).select('number floor cleanStatus opsStatus occStatus roomType').lean();
  const roomById = new Map(rooms.map((x) => [String(x._id), x]));
  const occ = await occupancyMap(propertyId, roomIds, resIds);

  let rows = allUnits.map(({ r, u }, idx) => {
    const list = unitsByRes.get(String(r._id)) || [u];
    const room = roomById.get(idStr(u.assignedRoom)) || null;
    const guarantee = guaranteeState(r, folioByRes.get(String(r._id)));
    const q2 = u._id ? queueByUnit.get(String(u._id)) : queueByRes.get(String(r._id));
    const readinessResult = computeReadiness({
      res: r, unit: u, room, guest: r.primaryGuest, policy, businessDate,
      occupiedBy: room ? occ.get(String(room._id)) : null, guarantee, queue: q2,
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
      room: room ? { id: String(room._id), number: room.number, floor: room.floor, cleanStatus: room.cleanStatus, opsStatus: room.opsStatus, occStatus: room.occStatus } : null,
      arrivalDate: u.arrivalDate || r.arrivalDate,
      departureDate: u.departureDate || r.departureDate,
      nights: nightsBetween(u.arrivalDate || r.arrivalDate, u.departureDate || r.departureDate),
      adults: r.adults,
      children: r.children,
      eta: r.eta || null,
      source: r.source,
      specialRequests: r.specialRequests || null,
      guarantee,
      readiness: readinessResult,
      queue: q2 ? { id: String(q2._id), arrivedAt: q2.arrivedAt, reason: q2.reason, ownerName: q2.ownerName, priority: q2.priority } : null,
    };
  });

  rows = rows.filter((r) => r.readiness.state !== 'closed');
  const counts = { all: rows.length, ready: 0, waiting: 0, queued: 0, blocked: 0, checked_in: 0 };
  for (const row of rows) counts[row.readiness.state] = (counts[row.readiness.state] || 0) + 1;

  if (assignment === 'assigned') rows = rows.filter((r) => r.room);
  else if (assignment === 'unassigned') rows = rows.filter((r) => !r.room);
  if (readiness && readiness !== 'all') {
    rows = rows.filter((r) => (readiness === 'waiting' ? ['waiting', 'queued'].includes(r.readiness.state) : r.readiness.state === readiness));
  }

  const key = SORTS[sort] || SORTS.eta;
  const sign = dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const ka = key(a); const kb = key(b);
    if (ka < kb) return -1 * sign;
    if (ka > kb) return 1 * sign;
    return a.key < b.key ? -1 : 1; // stable tie-break on a fixed id
  });

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
async function loadReservationInScope(reservationId, propertyId) {
  if (!isId(String(reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const res = await Reservation.findById(reservationId)
    .populate('primaryGuest', 'firstName lastName isBlacklisted blacklistReason dateOfBirth citizenship country passportNumber idDocType email phone marketingConsent')
    .populate('roomType', 'name code')
    .populate('company', 'name');
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  if (String(res.property) !== String(propertyId)) throw httpError('ההזמנה אינה שייכת לנכס הפעיל', 403);
  return res;
}

async function unitReadiness(res, unit, property) {
  const policy = policyOf(property);
  const room = unit.assignedRoom ? await Room.findById(unit.assignedRoom).lean() : null;
  const [occ, folio, queue] = await Promise.all([
    room ? occupancyMap(res.property, [room._id], [res._id]) : new Map(),
    Folio.findOne({ reservation: res._id }).select('lines').lean(),
    unit._id ? ArrivalQueueEntry.findOne({ reservationRoom: unit._id, status: 'active' }).lean() : null,
  ]);
  const guarantee = guaranteeState(res, folio);
  return {
    room,
    guarantee,
    queue,
    readiness: computeReadiness({
      res, unit, room, guest: res.primaryGuest, policy, businessDate: businessDateOf(property),
      occupiedBy: room ? occ.get(String(room._id)) : null, guarantee, queue,
    }),
  };
}

// ── FD-03 check-in context ──────────────────────────────────────────────────
export async function getCheckInContext({ propertyId, reservationId }) {
  const property = await loadProperty(propertyId);
  const res = await loadReservationInScope(reservationId, propertyId);
  const units = await ReservationRoom.find({ reservation: res._id }).populate('roomTypeBooked', 'name code').sort({ createdAt: 1, _id: 1 }).lean();
  const list = units.length ? units : [implicitUnit(res.toObject())];
  const out = [];
  for (const [i, u] of list.entries()) {
    const { room, readiness, queue } = await unitReadiness(res, u, property);
    out.push({
      unitId: u._id ? String(u._id) : null,
      index: i + 1,
      status: u.status,
      roomType: u.roomTypeBooked?.name ? { id: idStr(u.roomTypeBooked), name: u.roomTypeBooked.name } : { id: idStr(res.roomType), name: res.roomType?.name },
      room: room ? { id: String(room._id), number: room.number, floor: room.floor, cleanStatus: room.cleanStatus, opsStatus: room.opsStatus } : null,
      arrivalDate: u.arrivalDate,
      departureDate: u.departureDate,
      readiness,
      queue: queue ? { id: String(queue._id), reason: queue.reason, arrivedAt: queue.arrivedAt } : null,
    });
  }
  const folio = await Folio.findOne({ reservation: res._id }).select('lines status').lean();
  const card = await GuestRegistrationCard.findOne({ reservation: res._id, guest: res.primaryGuest?._id })
    .sort({ createdAt: -1 })
    .select('status signedAt idVerified termsVersion idDocType nationality createdAt')
    .lean();
  const g = res.primaryGuest || {};
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
      dateOfBirth: g.dateOfBirth || null,
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
  const firstName = String(input.firstName || '').trim().slice(0, 200);
  const lastName = String(input.lastName || '').trim().slice(0, 200);
  const errors = {};
  if (!firstName) errors.firstName = 'שם פרטי נדרש';
  if (!lastName) errors.lastName = 'שם משפחה נדרש';
  if (!input.dateOfBirth || Number.isNaN(Date.parse(input.dateOfBirth))) errors.dateOfBirth = 'תאריך לידה נדרש';
  else if (Date.parse(input.dateOfBirth) > Date.now()) errors.dateOfBirth = 'תאריך לידה עתידי';
  if (!/^[A-Za-z]{2}$/.test(String(input.nationality || ''))) errors.nationality = 'יש לבחור אזרחות';
  if (!['passport', 'id_card', 'drivers_license', 'other'].includes(input.idDocType)) errors.idDocType = 'יש לבחור סוג מסמך';
  const idDocNumber = String(input.idDocNumber || '').trim().slice(0, 40);
  if (!idDocNumber) errors.idDocNumber = 'מספר מסמך נדרש';
  if (input.idVerified !== true) errors.idVerified = 'יש לאשר שמסמך הזיהוי נבדק';
  const signature = typeof input.signature === 'string' && input.signature.startsWith('data:image/png;base64,') ? input.signature : null;
  if (policy.requireSignature && !signature) errors.signature = 'נדרשת חתימת האורח';
  if (signature && signature.length > 400_000) errors.signature = 'קובץ החתימה גדול מדי';
  if (Object.keys(errors).length) throw httpError('יש לתקן את שדות הרישום', 422, { fields: errors });

  const unitRoom = await ReservationRoom.findOne({ reservation: res._id }).sort({ createdAt: 1 }).populate('assignedRoom', 'number').lean();
  const roomNumber = unitRoom?.assignedRoom?.number || (res.assignedRoom ? (await Room.findById(res.assignedRoom).select('number').lean())?.number : undefined);

  const card = await GuestRegistrationCard.create({
    property: res.property,
    reservation: res._id,
    reservationRoom: unitRoom?._id,
    guest: res.primaryGuest._id,
    firstName,
    lastName,
    dateOfBirth: new Date(input.dateOfBirth),
    nationality: String(input.nationality).toUpperCase(),
    idDocType: input.idDocType,
    idDocNumber,
    idDocExpiry: input.idDocExpiry && !Number.isNaN(Date.parse(input.idDocExpiry)) ? new Date(input.idDocExpiry) : undefined,
    arrivalDate: res.arrivalDate,
    departureDate: res.departureDate,
    status: signature ? 'signed' : 'pending',
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

  // Marketing consent is its own decision, never pre-checked and never implied by registration.
  if (input.marketingConsent === true && !res.primaryGuest.marketingConsent) {
    await GuestProfile.updateOne(
      { _id: res.primaryGuest._id },
      { $set: { marketingConsent: true, marketingConsentAt: new Date(), marketingConsentIp: ip, marketingConsentFormVer: `registration:${policy.termsVersion}` } },
    );
  }

  // Never write the ID number or the signature image into the audit trail.
  await audit({
    property: res.property, actor: actor.id, actorName: actor.name,
    action: 'registration.saved', entityType: 'GuestRegistrationCard', entityId: card._id,
    after: { reservation: String(res._id), status: card.status, idDocType: card.idDocType, termsVersion: card.termsVersion, signed: !!signature },
    ip,
  });

  return { id: String(card._id), status: card.status, signedAt: card.signedAt, idVerified: true, termsVersion: card.termsVersion };
}

// ── FD-03 complete check-in ─────────────────────────────────────────────────
export async function completeCheckIn({ propertyId, reservationId, unitIds, guarantee, override, actor, ip }) {
  const property = await loadProperty(propertyId);
  const policy = policyOf(property);
  const res = await loadReservationInScope(reservationId, propertyId);
  const isManager = MANAGER_ROLES.includes(actor.role);

  const overrideOn = !!override?.enabled;
  const overrideReason = String(override?.reason || '').trim().slice(0, 500);
  if (overrideOn && !isManager) throw httpError('חריג כניסה מותר רק למנהל משמרת ומעלה', 403);
  if (overrideOn && overrideReason.length < 3) throw httpError('חריג כניסה מחייב סיבה', 422, { fields: { overrideReason: 'יש לפרט סיבה' } });

  // Guarantee is recorded on the reservation before entry, and validated server-side.
  if (guarantee?.method) {
    if (!GUARANTEE_METHODS.includes(guarantee.method)) throw httpError('שיטת ערבות לא מוכרת', 422);
    if (guarantee.method === 'company_guarantee' && !res.company) {
      throw httpError('ערבות חברה דורשת חברה משויכת להזמנה', 422, { fields: { guarantee: 'אין חברה משויכת' } });
    }
    if (res.guaranteeType !== guarantee.method) {
      const before = res.guaranteeType;
      res.guaranteeType = guarantee.method;
      res.updatedBy = actor.id || undefined;
      await res.save();
      await audit({
        property: res.property, actor: actor.id, actorName: actor.name, action: 'reservation.guarantee_set',
        entityType: 'Reservation', entityId: res._id, before: { guaranteeType: before },
        after: { guaranteeType: guarantee.method, reference: guarantee.reference ? String(guarantee.reference).slice(0, 80) : undefined }, ip,
      });
    }
  }

  const units = await ensureUnits(res);
  const wanted = Array.isArray(unitIds) && unitIds.length
    ? units.filter((u) => unitIds.map(String).includes(String(u._id)))
    : (units.length === 1 ? units : []);
  if (!wanted.length) throw httpError('יש לבחור לפחות יחידת שהייה אחת לכניסה', 422);

  // Re-check every selected unit now; a room blocked or taken since the wizard opened fails here.
  const failures = [];
  const usedOverride = new Set();
  for (const u of wanted) {
    const { readiness } = await unitReadiness(res, u.toObject(), property);
    if (readiness.state === 'checked_in') { failures.push({ unitId: String(u._id), reasons: [reason('already_in', 'היחידה כבר נכנסה', 'blocked')] }); continue; }
    const hard = readiness.reasons.filter((r) => r.severity === 'blocked' && r.code !== 'early');
    const early = readiness.reasons.find((r) => r.code === 'early');
    const soft = readiness.reasons.filter((r) => r.severity === 'waiting');
    const guaranteeMissing = readiness.reasons.find((r) => r.code === 'guarantee');
    const unresolved = [...hard];
    if (early) { if (overrideOn) usedOverride.add('early'); else unresolved.push(early); }
    if (soft.length) { if (overrideOn) soft.forEach((s) => usedOverride.add(s.code)); else unresolved.push(...soft); }
    if (guaranteeMissing) { if (overrideOn) usedOverride.add('guarantee'); else unresolved.push({ ...guaranteeMissing, severity: 'blocked' }); }
    if (unresolved.length) failures.push({ unitId: String(u._id), reasons: unresolved });
  }
  if (policy.requireRegistration) {
    const card = await GuestRegistrationCard.exists({ reservation: res._id, guest: res.primaryGuest._id });
    if (!card) {
      if (overrideOn) usedOverride.add('registration');
      else failures.push({ unitId: null, reasons: [reason('registration', 'לא נשמר רישום אורח', 'blocked', 'registration')] });
    }
  }
  if (failures.length) {
    throw httpError('הכניסה לא בוצעה — יש סיבות פתוחות', 409, { details: failures });
  }

  const allUnits = units.length;
  const willBeIn = units.filter((u) => !UNIT_OPEN_STATUSES.includes(u.status)).length + wanted.length;
  const singleFull = allUnits === 1 && wanted.length === 1;

  if (singleFull) {
    // Keep the established single-room path (folio posting, guest stats, automations).
    // That path reads the reservation-level room pointer, so align it with the unit first.
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
      overrideEarlyArrival: overrideOn,
    });
    await ReservationRoom.updateOne({ _id: wanted[0]._id }, { $set: { status: 'in_house' } });
  } else {
    // Multi-room: only the selected units enter; the reservation reflects a partial entry.
    await ReservationRoom.updateMany({ _id: { $in: wanted.map((u) => u._id) } }, { $set: { status: 'in_house' } });
    await Room.updateMany({ _id: { $in: wanted.map((u) => u.assignedRoom).filter(Boolean) } }, { $set: { occStatus: 'occupied' } });
    const before = { status: res.status };
    res.status = willBeIn >= allUnits ? 'in_house' : 'partially_checked_in';
    if (!res.checkedInAt) res.checkedInAt = new Date();
    res.updatedBy = actor.id || undefined;
    await res.save();
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
  return {
    reservationId: String(res._id),
    status: fresh.status,
    checkedInUnits: wanted.map((u) => String(u._id)),
    remainingUnits: allUnits - willBeIn,
    overridden: [...usedOverride],
    // Key issuing is a separate integration (INT-04); no lock provider is connected.
    key: { status: 'not_connected', label: 'לא מחובר ספק מפתחות — מסירה ידנית' },
  };
}

// ── INV-02 room candidates & assignment ─────────────────────────────────────
async function conflictingRoomIds({ propertyId, from, to, excludeReservationId }) {
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
    }).select('assignedRoom').lean(),
  ]);
  const map = new Map();
  for (const r of resConflicts) map.set(String(r.assignedRoom), r.confirmationNumber);
  for (const u of unitConflicts) if (!map.has(String(u.assignedRoom))) map.set(String(u.assignedRoom), 'יחידה אחרת');
  return map;
}

export async function roomCandidates({ propertyId, reservationId, unitId, allTypes }) {
  const property = await loadProperty(propertyId);
  const policy = policyOf(property);
  const res = await loadReservationInScope(reservationId, propertyId);
  let unit = null;
  if (unitId) {
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
  const occ = await occupancyMap(propertyId, rooms.map((r) => r._id), [res._id]);
  const readyClean = policy.requireInspection ? ['inspected'] : ['clean', 'inspected'];
  const currentRoomId = idStr(unit ? unit.assignedRoom : res.assignedRoom);

  const candidates = rooms.map((room) => {
    const conflict = conflicts.get(String(room._id)) || null;
    const blocked = room.opsStatus && room.opsStatus !== 'available';
    const occupiedBy = occ.get(String(room._id)) || null;
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

export async function assignRoom({ propertyId, reservationId, unitId, roomId, reason: changeReason, actor, ip }) {
  const res = await loadReservationInScope(reservationId, propertyId);
  if (!isId(String(roomId || ''))) throw httpError('יש לבחור חדר', 422);
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

async function populateQueue(query) {
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
  // Re-derive readiness for active entries so "ready now" is visible without a manual refresh.
  const out = [];
  for (const e of rows) {
    let readiness = null;
    if (e.status === 'active') {
      const res = await Reservation.findById(idStr(e.reservation)).populate('primaryGuest', 'isBlacklisted');
      const unit = await ReservationRoom.findById(idStr(e.reservationRoom)).lean();
      if (res && unit) readiness = (await unitReadiness(res, unit, property)).readiness;
    }
    out.push(queueDto(e, { readiness }));
  }
  return { businessDate: businessDateOf(property), rows: out };
}

export async function addToQueue({ propertyId, reservationId, unitId, input, actor, ip }) {
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
  if (input.readyEta && Number.isNaN(Date.parse(input.readyEta))) errors.readyEta = 'מועד לא תקין';
  if (input.guestContact && !['desk', 'message'].includes(input.guestContact)) errors.guestContact = 'ערך לא תקין';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי התור', 422, { fields: errors });

  const owner = await User.findOne({ _id: ownerId, property: propertyId }).select('firstName lastName active').lean()
    || (actor.role === 'super_admin' ? await User.findById(ownerId).select('firstName lastName').lean() : null);
  if (!owner) throw httpError('האחראי אינו משתמש בנכס', 422, { fields: { ownerId: 'משתמש לא בנכס' } });

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
  if (String(entry.property) !== String(propertyId)) throw httpError('הרשומה אינה שייכת לנכס הפעיל', 403);
  return entry;
}

function assertVersion(entry, version) {
  if (version !== undefined && version !== null && Number(version) !== entry.__v) {
    throw httpError('הרשומה עודכנה על ידי משתמש אחר — רעננו ונסו שוב', 409, { code: 'version_conflict' });
  }
}

export async function takeQueueOwnership({ propertyId, id, version, actor, ip }) {
  const entry = await loadEntry(id, propertyId);
  if (entry.status !== 'active') throw httpError('הרשומה כבר אינה פעילה', 409);
  // Atomic: only succeeds if nobody changed the entry since the user saw it.
  const filter = { _id: entry._id, status: 'active' };
  if (version !== undefined && version !== null) filter.__v = Number(version);
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
    if (input.readyEta && Number.isNaN(Date.parse(input.readyEta))) throw httpError('מועד לא תקין', 422);
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
  entry.status = 'removed';
  entry.removalReason = text;
  entry.resolvedAt = new Date();
  entry.updatedBy = actor.id || undefined;
  await entry.save();
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
    const room = await Room.findById(roomId).select('cleanStatus').lean();
    task = await HousekeepingTask.create({
      property: propertyId,
      room: roomId,
      reservation: entry.reservation,
      type: room?.cleanStatus === 'clean' ? 'arrival_prep' : 'checkout_clean',
      priority: 'urgent',
      date: today,
      notes: 'אורח ממתין בדלפק — נפתח מתור ההמתנה',
    });
    created = true;
  }
  entry.housekeepingTask = task._id;
  entry.updatedBy = actor.id || undefined;
  await entry.save();
  await audit({ property: entry.property, actor: actor.id, actorName: actor.name, action: 'arrival_queue.hk_priority', entityType: 'HousekeepingTask', entityId: task._id, after: { created, priority: 'urgent', queueEntry: String(entry._id) }, ip });
  return { taskId: String(task._id), created, status: task.status };
}
