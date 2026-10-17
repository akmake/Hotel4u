// /api/pms/finance — folio (FIN-01), charges & reversals (FIN-02), payments/deposits (FIN-03),
// refunds (FIN-04), credit notes (FIN-07) and day close (FIN-12).
// Business rules live in services/financeService.js; this file gates roles and property scope.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import {
  listFolios, getStayFolios, ensureGuestFolio, postCharge, reverseCharge, recordFolioPayment, refundPayment, creditNote,
  getDayClose, runDayClose, NIGHT_ROLES,
} from '../services/financeService.js';
import { listCodes, createCode, updateCode, CATALOG_ROLES } from '../services/chargeCodeService.js';
import { dayReport } from '../services/ledgerService.js';
import { closeSettledFolio } from '../services/reversalService.js';
import { getTaxPolicy, updateTaxPolicy, TAX_ADMIN_ROLES } from '../services/touristService.js';
import { documentContext, issueDocument, listDocuments, setAllocation, printDocument, sendDocument, listSeries, setSeriesStart, SERIES_ROLES } from '../services/documentService.js';
import { journal, vatReport, receiptsReport, undocumentedReport, allocationsReport, cashDay, closeCash, accountantWorkbook } from '../services/financeReportsService.js';
import { buildUnifiedFile } from '../services/unifiedFileService.js';
import { connectUrl, disconnect, connectionStatus, retryPending } from '../services/taxAuthorityService.js';
import Property from '../models/Property.js';

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

router.post('/stays/:reservationId/folio', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה לרשום תשלום');
  return ensureGuestFolio({ propertyId: scope(req), reservationId: req.params.reservationId });
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

router.post('/folios/:id/close', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה לסגור חשבון');
  return closeSettledFolio({ propertyId: scope(req), folioId: req.params.id, actor: actorOf(req), ip: req.ip });
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
  return creditNote({ propertyId: scope(req), invoiceId: req.params.id, amount: req.body?.amount, selections: req.body?.selections, reason: req.body?.reason, idempotencyKey: req.body?.idempotencyKey, actor: actorOf(req), ip: req.ip });
}));

// ── FIN-06 documents from a folio · FIN-10 allocation centre ────────────────
router.get('/folios/:id/documents/context', handle(async (req) => {
  requireRoles(req, MONEY_READ, 'אין הרשאה למסמכים');
  return documentContext({ propertyId: scope(req), folioId: req.params.id });
}));

router.post('/folios/:id/documents', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה להפקת מסמך');
  return issueDocument({ propertyId: scope(req), folioId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.get('/documents', handle(async (req) => {
  requireRoles(req, MONEY_READ, 'אין הרשאה למסמכים');
  const q = req.query;
  return listDocuments({ propertyId: scope(req), view: q.view, q: q.q, type: q.type, from: q.from, to: q.to, page: q.page, pageSize: q.pageSize });
}));

router.patch('/documents/:id/allocation', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה');
  return setAllocation({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/documents/:id/send', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה לשליחת מסמכים');
  return sendDocument({ propertyId: scope(req), id: req.params.id, to: req.body?.to, actor: actorOf(req), ip: req.ip });
}));

// ── FIN-11 reports and exports ──────────────────────────────────────────────
const REPORT_ROLES = [...new Set([...MONEY_READ, 'finance_manager', 'auditor', 'owner_readonly'])];
router.get('/reports/journal', handle(async (req) => { requireRoles(req, REPORT_ROLES, 'אין הרשאה לדוחות'); const q = req.query; return journal({ propertyId: scope(req), from: q.from, to: q.to, type: q.type }); }));
router.get('/reports/vat', handle(async (req) => { requireRoles(req, REPORT_ROLES, 'אין הרשאה לדוחות'); const q = req.query; return vatReport({ propertyId: scope(req), from: q.from, to: q.to }); }));
router.get('/reports/receipts', handle(async (req) => { requireRoles(req, REPORT_ROLES, 'אין הרשאה לדוחות'); const q = req.query; return receiptsReport({ propertyId: scope(req), from: q.from, to: q.to }); }));
router.get('/reports/undocumented', handle(async (req) => { requireRoles(req, REPORT_ROLES, 'אין הרשאה לדוחות'); const q = req.query; return undocumentedReport({ propertyId: scope(req), from: q.from, to: q.to }); }));
router.get('/reports/allocations', handle(async (req) => { requireRoles(req, REPORT_ROLES, 'אין הרשאה לדוחות'); const q = req.query; return allocationsReport({ propertyId: scope(req), from: q.from, to: q.to }); }));

const EXPORT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager', 'auditor'];
router.get('/reports/workbook', async (req, res) => {
  try {
    requireRoles(req, EXPORT_ROLES, 'יצוא לרואה החשבון — להנהלה ולכספים');
    const out = await accountantWorkbook({ propertyId: scope(req), from: req.query.from, to: req.query.to });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.send(out.buffer);
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status >= 500) console.error('[finance]', err);
    res.status(status >= 400 && status < 600 ? status : 500).json({ success: false, error: status >= 500 ? 'שגיאת שרת' : err.message });
  }
});

// Open format (מבנה אחיד 1.31): the zip comes back base64 together with the verification printout.
router.post('/open-format', handle(async (req) => {
  requireRoles(req, EXPORT_ROLES, 'הפקת קבצים במבנה אחיד — להנהלה ולכספים');
  const out = await buildUnifiedFile({ propertyId: scope(req), from: req.body?.from, to: req.body?.to, actor: actorOf(req), ip: req.ip });
  return { summary: out.summary, fileName: out.fileName, zipBase64: out.bundle.toString('base64') };
}));

// ── FIN-12 cash drawer ──────────────────────────────────────────────────────
router.get('/cash', handle(async (req) => { requireRoles(req, MONEY_WORK.concat(['auditor']), 'אין הרשאה לקופה'); return cashDay({ propertyId: scope(req), date: req.query.date }); }));
router.post('/cash/close', handle(async (req) => {
  requireRoles(req, MONEY_WORK, 'אין הרשאה לסגירת קופה');
  const b = req.body || {};
  return closeCash({ propertyId: scope(req), date: b.date, userId: b.userId, counted: b.counted, note: b.note, actor: actorOf(req), ip: req.ip });
}));

// ── Fiscal set-up: series, software registration, Tax Authority connection ──
const FISCAL_ADMIN = SERIES_ROLES;
router.get('/fiscal', handle(async (req) => {
  requireRoles(req, MONEY_READ, 'אין הרשאה');
  const propertyId = scope(req);
  const p = await Property.findById(propertyId).select('legalName name taxNumber address city fiscal').lean();
  return { ita: await connectionStatus(propertyId), series: await listSeries({ propertyId }), emailFrom: p?.fiscal?.emailFrom || '', seller: { name: p?.legalName || p?.name || '', taxNumber: p?.taxNumber || '', address: p?.address || '', city: p?.city || '' } };
}));
router.put('/fiscal', handle(async (req) => {
  requireRoles(req, FISCAL_ADMIN, 'הגדרות מסמכים — להנהלה ולכספים');
  const propertyId = scope(req);
  const b = req.body || {};
  const set = {};
  const fields = {};
  if (b.softwareRegNumber !== undefined) { const v = String(b.softwareRegNumber || '').replace(/\D/g, ''); if (v && v.length !== 8) fields.softwareRegNumber = 'מספר רישום — 8 ספרות'; set['fiscal.softwareRegNumber'] = v || null; }
  if (b.operatorId !== undefined) { const v = String(b.operatorId || '').replace(/\D/g, ''); if (v && v.length !== 9) fields.operatorId = 'ת.ז. — 9 ספרות'; set['fiscal.operatorId'] = v || null; }
  if (b.emailFrom !== undefined) { const v = String(b.emailFrom || '').trim(); if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) fields.emailFrom = 'דוא״ל'; set['fiscal.emailFrom'] = v || null; }
  if (b.allocationMode === 'manual') set['fiscal.allocationMode'] = 'manual';
  if (b.allocationMode === 'api') {
    const p = await Property.findById(propertyId).select('fiscal').lean();
    if (!p?.fiscal?.ita?.connected) fields.allocationMode = 'יש להתחבר לרשות המסים קודם';
    else set['fiscal.allocationMode'] = 'api';
  }
  if (Object.keys(fields).length) { const e = new Error('יש לתקן את ההגדרות'); e.status = 422; e.fields = fields; throw e; }
  await Property.updateOne({ _id: propertyId }, { $set: set });
  const a = actorOf(req);
  const { audit } = await import('../services/auditService.js');
  await audit({ property: propertyId, actor: a.id, actorName: a.name, action: 'fiscal.settings', entityType: 'Property', entityId: propertyId, after: Object.fromEntries(Object.entries(set).map(([k, v]) => [k.replace('fiscal.', ''), v])), ip: req.ip });
  return { ita: await connectionStatus(propertyId) };
}));
router.put('/fiscal/series/:type', handle(async (req) => {
  requireRoles(req, FISCAL_ADMIN, 'קביעת מספור — להנהלה ולכספים');
  return setSeriesStart({ propertyId: scope(req), type: req.params.type, next: req.body?.next, actor: actorOf(req), ip: req.ip });
}));
router.post('/fiscal/ita/connect', handle(async (req) => {
  requireRoles(req, FISCAL_ADMIN, 'חיבור לרשות המסים — להנהלה ולכספים');
  return connectUrl({ propertyId: scope(req), actor: actorOf(req), env: req.body?.env });
}));
router.post('/fiscal/ita/disconnect', handle(async (req) => {
  requireRoles(req, FISCAL_ADMIN, 'ניתוק מרשות המסים — להנהלה ולכספים');
  return disconnect({ propertyId: scope(req), actor: actorOf(req), ip: req.ip });
}));
router.post('/fiscal/ita/retry', handle(async (req) => {
  requireRoles(req, FISCAL_ADMIN, 'אין הרשאה');
  return retryPending({ propertyId: scope(req), force: true });
}));

router.get('/documents/:id/print', async (req, res) => {
  try {
    requireRoles(req, MONEY_READ, 'אין הרשאה למסמכים');
    const html = await printDocument({ propertyId: scope(req), id: req.params.id });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status >= 500) console.error('[finance]', err);
    res.status(status >= 400 && status < 600 ? status : 500).json({ success: false, error: status >= 500 ? 'שגיאת שרת' : err.message });
  }
});

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

// ── ADM-04 (gate G04/G05): tourist zero-rating rule and cash-law rule ───────
router.get('/tax-policy', handle(async (req) => {
  requireRoles(req, MONEY_READ, 'אין הרשאה');
  return getTaxPolicy({ propertyId: scope(req) });
}));

router.put('/tax-policy', handle(async (req) => {
  requireRoles(req, TAX_ADMIN_ROLES, 'כלל המס מוגדר על ידי הנהלה או כספים');
  return updateTaxPolicy({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
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
