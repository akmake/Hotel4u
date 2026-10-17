// /api/pms/frontdesk — arrivals (FD-02), check-in wizard (FD-03/FD-05), room assignment (INV-02)
// and the waiting-for-room queue (FD-04). Business rules live in services/frontDeskService.js.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import User from '../models/User.js';
import { emit } from '../services/webhookService.js';
import {
  listInHouse, listDepartures, setEtd, getCheckOutContext, recordPayment, refundCredit, postServiceCharge, completeCheckOut, postPendingNights,
} from '../services/departureService.js';
import {
  listArrivals, getCheckInContext, saveRegistration, completeCheckIn,
  roomCandidates, assignRoom, setEta, noShowFromArrivals,
  listQueue, addToQueue, takeQueueOwnership, updateQueueEntry, removeFromQueue, prioritizeHousekeeping,
} from '../services/frontDeskService.js';
import { setRoomBilling, setGroupBilling } from '../services/groupBillingService.js';

const router = Router();

const FRONT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist'];
const ARRIVALS_READ_ROLES = [...FRONT_ROLES, 'housekeeping_manager', 'auditor', 'owner_readonly'];
const QUEUE_READ_ROLES = [...FRONT_ROLES, 'housekeeping_manager', 'housekeeper'];
const QUEUE_WORK_ROLES = [...FRONT_ROLES, 'housekeeping_manager'];
// Departures touch money: cashiers and finance work them alongside the desk.
const DEPARTURE_WORK_ROLES = [...FRONT_ROLES, 'finance_manager', 'cashier'];
const DEPARTURE_READ_ROLES = [...DEPARTURE_WORK_ROLES, 'auditor', 'owner_readonly'];

// Errors from the service carry field-level messages (`fields`) and per-unit reasons (`details`);
// the shared error handler drops those, so this router answers them itself.
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[frontdesk]', err);
    res.status(safe).json({
      success: false,
      error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message,
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.details ? { details: err.details } : {}),
      ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}),
    });
  }
};

function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) {
    const err = new Error('יש לבחור נכס');
    err.status = 400;
    throw err;
  }
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}

// Housekeeping sees what it needs to prepare rooms — not payment, blacklist, company or free text.
const HK_ROLES = ['housekeeping_manager', 'housekeeper'];
const HK_REASON_CODES = new Set(['no_room', 'room_blocked', 'room_occupied', 'room_dirty', 'not_inspected']);
function forHousekeeping(req, row) {
  if (!HK_ROLES.includes(req.actor?.role)) return row;
  const out = { ...row };
  delete out.guarantee; delete out.billing; delete out.company; delete out.specialRequests; delete out.notes; delete out.guestContact; delete out.source;
  if (out.guest) out.guest = { name: out.guest.name, vip: out.guest.vip };
  if (out.readiness) out.readiness = { ...out.readiness, reasons: (out.readiness.reasons || []).filter((r) => HK_REASON_CODES.has(r.code)) };
  return out;
}

function actorOf(req) {
  const a = actorOrSystem(req);
  return { id: a.id, name: a.name, role: a.role };
}

// ── FD-02 ───────────────────────────────────────────────────────────────────
router.get('/arrivals', handle(async (req) => {
  requireRoles(req, ARRIVALS_READ_ROLES);
  const q = req.query;
  const data = await listArrivals({
    propertyId: scope(req),
    date: q.date,
    q: q.q,
    roomTypeId: q.roomTypeId,
    assignment: q.assignment,
    readiness: q.readiness,
    includeCheckedIn: q.includeCheckedIn === '1' || q.includeCheckedIn === 'true',
    sort: q.sort,
    dir: q.dir,
    page: q.page,
    pageSize: q.pageSize,
  });
  return { ...data, rows: data.rows.map((r) => forHousekeeping(req, r)) };
}));

router.patch('/reservations/:id/eta', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  return setEta({ propertyId: scope(req), reservationId: req.params.id, eta: req.body?.eta, actor: actorOf(req), ip: req.ip });
}));

router.post('/reservations/:id/no-show', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  return noShowFromArrivals({ propertyId: scope(req), reservationId: req.params.id, actor: actorOf(req), ip: req.ip });
}));

// ── FD-03 / FD-05 ───────────────────────────────────────────────────────────
router.get('/reservations/:id/check-in', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  return getCheckInContext({ propertyId: scope(req), reservationId: req.params.id });
}));

router.post('/reservations/:id/registration', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  return saveRegistration({ propertyId: scope(req), reservationId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/reservations/:id/check-in', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  const b = req.body || {};
  const propertyId = scope(req);
  const result = await completeCheckIn({
    propertyId,
    reservationId: req.params.id,
    unitIds: b.unitIds,
    unitIndexes: b.unitIndexes,
    guarantee: b.guarantee,
    unitGuarantees: b.unitGuarantees,
    override: b.override,
    actor: actorOf(req),
    ip: req.ip,
  });
  emit(propertyId, 'guest.checked_in', { reservationId: result.reservationId, confirmationNumber: result.confirmationNumber, checkedInAt: new Date() }).catch(() => null);
  return result;
}));

// ── Group billing: who pays each room (booker / the room's guest) ───────────
router.patch('/reservations/:id/units/:unitIndex/billing', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  return setRoomBilling({ propertyId: scope(req), reservationId: req.params.id, unitIndex: req.params.unitIndex, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/reservations/:id/billing', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  return setGroupBilling({ propertyId: scope(req), reservationId: req.params.id, mode: req.body?.mode, actor: actorOf(req), ip: req.ip });
}));

// ── INV-02 ──────────────────────────────────────────────────────────────────
router.get('/reservations/:id/room-candidates', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  return roomCandidates({
    propertyId: scope(req),
    reservationId: req.params.id,
    unitId: req.query.unitId || null,
    allTypes: req.query.allTypes === '1',
  });
}));

router.post('/reservations/:id/assign-room', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  const b = req.body || {};
  return assignRoom({ propertyId: scope(req), reservationId: req.params.id, unitId: b.unitId, roomId: b.roomId, reason: b.reason, actor: actorOf(req), ip: req.ip });
}));

// ── FD-04 ───────────────────────────────────────────────────────────────────
// Owner picker: names and roles only — no contact or security fields.
router.get('/staff', handle(async (req) => {
  requireRoles(req, QUEUE_WORK_ROLES);
  const users = await User.find({ property: scope(req), active: { $ne: false }, role: { $in: [...QUEUE_READ_ROLES] } })
    .select('firstName lastName role').sort({ firstName: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), role: u.role }));
}));

router.get('/queue', handle(async (req) => {
  requireRoles(req, QUEUE_READ_ROLES);
  const data = await listQueue({ propertyId: scope(req), status: req.query.status === 'resolved' ? 'resolved' : 'active' });
  return { ...data, rows: data.rows.map((r) => forHousekeeping(req, r)) };
}));

router.post('/queue', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  const b = req.body || {};
  return addToQueue({ propertyId: scope(req), reservationId: b.reservationId, unitId: b.unitId, input: b, actor: actorOf(req), ip: req.ip });
}));

router.post('/queue/:id/take', handle(async (req) => {
  requireRoles(req, QUEUE_WORK_ROLES);
  return takeQueueOwnership({ propertyId: scope(req), id: req.params.id, version: req.body?.version, actor: actorOf(req), ip: req.ip });
}));

router.patch('/queue/:id', handle(async (req) => {
  requireRoles(req, QUEUE_WORK_ROLES);
  return updateQueueEntry({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/queue/:id/prioritize', handle(async (req) => {
  requireRoles(req, QUEUE_WORK_ROLES);
  return prioritizeHousekeeping({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip });
}));

router.post('/queue/:id/remove', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  return removeFromQueue({ propertyId: scope(req), id: req.params.id, reason: req.body?.reason, version: req.body?.version, actor: actorOf(req), ip: req.ip });
}));

// ── FD-06 / FD-07 / FD-08 ───────────────────────────────────────────────────
router.get('/in-house', handle(async (req) => {
  requireRoles(req, DEPARTURE_READ_ROLES);
  const q = req.query;
  return listInHouse({ propertyId: scope(req), q: q.q, departure: q.departure, view: q.view, page: q.page, pageSize: q.pageSize });
}));

router.get('/departures', handle(async (req) => {
  requireRoles(req, DEPARTURE_READ_ROLES);
  return listDepartures({ propertyId: scope(req), date: req.query.date, status: req.query.status, q: req.query.q });
}));

router.patch('/reservations/:id/etd', handle(async (req) => {
  requireRoles(req, FRONT_ROLES);
  return setEtd({ propertyId: scope(req), reservationId: req.params.id, etd: req.body?.etd, actor: actorOf(req), ip: req.ip });
}));

router.get('/reservations/:id/check-out', handle(async (req) => {
  requireRoles(req, DEPARTURE_WORK_ROLES);
  return getCheckOutContext({ propertyId: scope(req), reservationId: req.params.id });
}));

router.post('/reservations/:id/check-out', handle(async (req) => {
  requireRoles(req, DEPARTURE_WORK_ROLES);
  const b = req.body || {};
  return completeCheckOut({
    propertyId: scope(req), reservationId: req.params.id, unitIds: b.unitIds,
    unitIndexes: b.unitIndexes,
    settlements: Array.isArray(b.settlements) ? b.settlements : [], early: b.early, actor: actorOf(req), ip: req.ip,
  }).then((result) => {
    emit(String(req.query.propertyId || req.body?.propertyId || req.actor?.propertyId), 'guest.checked_out', { reservationId: result.reservationId, checkedOutAt: new Date() }).catch(() => null);
    return result;
  });
}));

router.post('/reservations/:id/charges', handle(async (req) => {
  requireRoles(req, DEPARTURE_WORK_ROLES);
  return postServiceCharge({ propertyId: scope(req), reservationId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/reservations/:id/post-nights', handle(async (req) => {
  requireRoles(req, DEPARTURE_WORK_ROLES);
  return postPendingNights({ propertyId: scope(req), reservationId: req.params.id, actor: actorOf(req), ip: req.ip });
}));

router.post('/folios/:folioId/payments', handle(async (req) => {
  requireRoles(req, DEPARTURE_WORK_ROLES);
  return recordPayment({ propertyId: scope(req), folioId: req.params.folioId, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/folios/:folioId/refunds', handle(async (req) => {
  requireRoles(req, DEPARTURE_WORK_ROLES); // the service narrows this to managers/finance
  return refundCredit({ propertyId: scope(req), folioId: req.params.folioId, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

export default router;
