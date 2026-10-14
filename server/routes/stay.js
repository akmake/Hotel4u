// /api/pms/stay — changes to a booking or a stay: room move (FD-09), extension (FD-10),
// early-departure preview (FD-11), booking change (RSV-05) and cancellation notice (RSV-06).
// Every change has a preview; rules live in services/stayChangeService.js.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import {
  moveCandidates, moveRoom, extensionPreview, extendStay, earlyDeparturePreview,
  modificationPreview, modifyBooking, cancellationPreview, cancelWithNotice,
} from '../services/stayChangeService.js';
import { reinstatePreview, reinstateReservation, reverseCheckInPreview, reverseCheckIn, postStayCharge } from '../services/reversalService.js';

const router = Router();

const FRONT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist'];
const BOOKING_ROLES = [...FRONT_ROLES, 'sales_manager', 'revenue_manager'];
const CANCEL_ROLES = [...FRONT_ROLES, 'sales_manager'];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[stay]', err);
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

function actorOf(req) {
  const a = actorOrSystem(req);
  return { id: a.id, name: a.name, role: a.role };
}

// ── FD-09 ───────────────────────────────────────────────────────────────────
router.get('/:id/move-candidates', handle(async (req) => {
  requireRoles(req, FRONT_ROLES, 'מעבר חדר מתבצע בקבלה');
  return moveCandidates({ propertyId: scope(req), reservationId: req.params.id, unitId: req.query.unitId, fromRoomId: req.query.fromRoomId });
}));

router.post('/:id/move', handle(async (req) => {
  requireRoles(req, FRONT_ROLES, 'מעבר חדר מתבצע בקבלה');
  return moveRoom({ propertyId: scope(req), reservationId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

// ── FD-10 ───────────────────────────────────────────────────────────────────
router.get('/:id/extension', handle(async (req) => {
  requireRoles(req, FRONT_ROLES, 'הארכה מתבצעת בקבלה');
  return extensionPreview({ propertyId: scope(req), reservationId: req.params.id, newDeparture: req.query.newDeparture });
}));

router.post('/:id/extend', handle(async (req) => {
  requireRoles(req, FRONT_ROLES, 'הארכה מתבצעת בקבלה');
  return extendStay({ propertyId: scope(req), reservationId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

// ── FD-11 ───────────────────────────────────────────────────────────────────
router.get('/:id/early-departure', handle(async (req) => {
  requireRoles(req, FRONT_ROLES, 'עזיבה מוקדמת מתבצעת בקבלה');
  return earlyDeparturePreview({ propertyId: scope(req), reservationId: req.params.id });
}));

// ── RSV-05 ──────────────────────────────────────────────────────────────────
router.post('/:id/modification/preview', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה לשנות הזמנה');
  return modificationPreview({ propertyId: scope(req), reservationId: req.params.id, changes: req.body?.changes || {} });
}));

router.post('/:id/modify', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה לשנות הזמנה');
  return modifyBooking({ propertyId: scope(req), reservationId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

// ── RSV-06 ──────────────────────────────────────────────────────────────────
router.post('/:id/cancellation/preview', handle(async (req) => {
  requireRoles(req, CANCEL_ROLES, 'אין הרשאה לביטול');
  return cancellationPreview({ propertyId: scope(req), reservationId: req.params.id, input: req.body || {} });
}));

router.post('/:id/cancel', handle(async (req) => {
  requireRoles(req, CANCEL_ROLES, 'אין הרשאה לביטול');
  return cancelWithNotice({ propertyId: scope(req), reservationId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

// ── Gap G6: walking a stay back ─────────────────────────────────────────────
router.get('/:id/reinstate', handle(async (req) => {
  requireRoles(req, CANCEL_ROLES, 'אין הרשאה לשחזור הזמנה');
  return reinstatePreview({ propertyId: scope(req), reservationId: req.params.id });
}));

router.post('/:id/reinstate', handle(async (req) => {
  requireRoles(req, CANCEL_ROLES, 'אין הרשאה לשחזור הזמנה');
  return reinstateReservation({ propertyId: scope(req), reservationId: req.params.id, reason: req.body?.reason, actor: actorOf(req), ip: req.ip });
}));

router.get('/:id/reverse-check-in', handle(async (req) => {
  requireRoles(req, FRONT_ROLES, 'ביטול כניסה מתבצע בקבלה');
  return reverseCheckInPreview({ propertyId: scope(req), reservationId: req.params.id });
}));

router.post('/:id/reverse-check-in', handle(async (req) => {
  requireRoles(req, FRONT_ROLES, 'ביטול כניסה מתבצע בקבלה');
  return reverseCheckIn({ propertyId: scope(req), reservationId: req.params.id, reason: req.body?.reason, roomUsed: !!req.body?.roomUsed, actor: actorOf(req), ip: req.ip });
}));

router.post('/:id/post-stay-charge', handle(async (req) => {
  requireRoles(req, [...FRONT_ROLES, 'finance_manager'], 'חיוב אחרי יציאה מותר למנהל או לכספים');
  return postStayCharge({ propertyId: scope(req), reservationId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

export default router;
