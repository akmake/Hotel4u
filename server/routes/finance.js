// /api/pms/finance — folio (FIN-01), charges & reversals (FIN-02), payments/deposits (FIN-03),
// refunds (FIN-04), credit notes (FIN-07) and day close (FIN-12).
// Business rules live in services/financeService.js; this file gates roles and property scope.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import {
  listFolios, getStayFolios, postCharge, reverseCharge, recordFolioPayment, refundPayment, creditNote,
  getDayClose, runDayClose, NIGHT_ROLES,
} from '../services/financeService.js';
import { listCodes, createCode, updateCode, CATALOG_ROLES } from '../services/chargeCodeService.js';
import { dayReport } from '../services/ledgerService.js';

const router = Router();

const FRONT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist'];
const MONEY_WORK = [...FRONT_ROLES, 'finance_manager', 'cashier'];
const MONEY_READ = [...MONEY_WORK, 'auditor', 'owner_readonly'];
const DAY_READ = [...new Set([...NIGHT_ROLES, 'auditor', 'owner_readonly'])];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[finance]', err);
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

// ── FIN-01 ──────────────────────────────────────────────────────────────────
router.get('/folios', handle(async (req) => {
  requireRoles(req, MONEY_READ, 'אין הרשאה לחשבונות אורח');
  const q = req.query;
  return listFolios({ propertyId: scope(req), view: q.view, q: q.q, page: q.page, pageSize: q.pageSize });
}));

router.get('/stays/:reservationId', handle(async (req) => {
  requireRoles(req, MONEY_READ, 'אין הרשאה לחשבונות אורח');
  return getStayFolios({ propertyId: scope(req), reservationId: req.params.reservationId });
}));

// ── FIN-02 ──────────────────────────────────────────────────────────────────
router.post('/folios/:id/charges', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה לרשום חיוב');
  return postCharge({ propertyId: scope(req), folioId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/folios/:id/lines/:lineId/reverse', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה לתקן חיוב');
  return reverseCharge({ propertyId: scope(req), folioId: req.params.id, lineId: req.params.lineId, reason: req.body?.reason, actor: actorOf(req), ip: req.ip });
}));

// ── FIN-03 / FIN-04 ─────────────────────────────────────────────────────────
router.post('/folios/:id/payments', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה לרשום תשלום');
  return recordFolioPayment({ propertyId: scope(req), folioId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/folios/:id/payments/:lineId/refund', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה להחזר');
  return refundPayment({ propertyId: scope(req), folioId: req.params.id, paymentLineId: req.params.lineId, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

// ── FIN-07 ──────────────────────────────────────────────────────────────────
router.post('/invoices/:id/credit-note', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה למסמך זיכוי');
  return creditNote({ propertyId: scope(req), invoiceId: req.params.id, amount: req.body?.amount, reason: req.body?.reason, actor: actorOf(req), ip: req.ip });
}));

// ── ADM-13 (gap G1): charge codes and payment methods ───────────────────────
router.get('/charge-codes', handle(async (req) => {
  requireRoles(req, MONEY_READ, 'אין הרשאה לקטלוג החיובים');
  return listCodes({ propertyId: scope(req), kind: req.query.kind || undefined, includeInactive: req.query.all === '1' });
}));

router.post('/charge-codes', handle(async (req) => {
  requireRoles(req, CATALOG_ROLES, 'ניהול קודי חיוב מותר להנהלה ולכספים');
  return createCode({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.patch('/charge-codes/:id', handle(async (req) => {
  requireRoles(req, CATALOG_ROLES, 'ניהול קודי חיוב מותר להנהלה ולכספים');
  return updateCode({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

// ── FIN-12 ──────────────────────────────────────────────────────────────────
router.get('/day-close', handle(async (req) => {
  requireRoles(req, DAY_READ, 'אין הרשאה לסגירת יום');
  return getDayClose({ propertyId: scope(req) });
}));

// G4: day report — trial balance, ledgers, revenue by code, receipts by method, manager flash.
router.get('/day-close/report', handle(async (req) => {
  requireRoles(req, DAY_READ, 'אין הרשאה לדוחות סגירת יום');
  return dayReport({ propertyId: scope(req), date: req.query.date });
}));

router.post('/day-close/run', handle(async (req) => {
  requireRoles(req, NIGHT_ROLES, 'סגירת יום מותרת למנהל משמרת/לילה או לכספים');
  const b = req.body || {};
  return runDayClose({ propertyId: scope(req), date: b.date, arrivals: b.arrivals, reason: b.reason, actor: actorOf(req), ip: req.ip });
}));

export default router;
