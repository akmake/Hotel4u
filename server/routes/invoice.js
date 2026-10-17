/**
 * invoice.js — נתיבי API לחשבוניות
 *
 * POST   /api/pms/invoices/folio/:folioId        — הנפק חשבונית מ-Folio
 * POST   /api/pms/invoices/manual                — הנפק חשבונית ידנית
 * GET    /api/pms/invoices                        — רשימת חשבוניות (עם פילטרים)
 * GET    /api/pms/invoices/:id                    — חשבונית בודדת
 * GET    /api/pms/invoices/:id/html               — HTML להדפסה / PDF
 * POST   /api/pms/invoices/:id/credit-note        — הנפק הודעת זיכוי
 * PATCH  /api/pms/invoices/:id/allocation         — עדכן מספר הקצאה
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireRoles, assertPropertyScope } from '../middleware/authContext.js';
import Invoice, { INVOICE_TYPES, INVOICE_TYPE_LABELS } from '../models/Invoice.js';
import { issueManualInvoice, issueCreditNote } from '../services/invoiceService.js';
import { setAllocation, printDocument } from '../services/documentService.js';
import { actorOrSystem } from '../middleware/authContext.js';

const router = Router();

const INVOICE_READ_ROLES = [
  'super_admin', 'chain_admin', 'property_admin', 'general_manager',
  'front_desk_manager', 'receptionist', 'finance_manager', 'cashier',
  'auditor', 'owner_readonly',
];
const INVOICE_WRITE_ROLES = [
  'super_admin', 'chain_admin', 'property_admin', 'general_manager',
  'front_desk_manager', 'finance_manager', 'cashier',
];
const INVOICE_ADMIN_ROLES = [
  'super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager',
];

// ── עזרים ─────────────────────────────────────────────────────────────────

function getPropertyId(req) {
  return req.actor?.propertyId || req.query.propertyId || req.body?.propertyId;
}

function validateInvoiceType(type) {
  if (!INVOICE_TYPES.includes(type)) {
    const err = new Error(`סוג חשבונית לא תקין: ${type}. ערכים חוקיים: ${INVOICE_TYPES.join(', ')}`);
    err.status = 400;
    throw err;
  }
}

async function getInvoiceInScope(req, invoiceId) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    const err = new Error('חשבונית לא נמצאה');
    err.status = 404;
    throw err;
  }
  assertPropertyScope(req, String(invoice.property));
  return invoice;
}

// ── POST /folio/:folioId — הועבר ל-POST /api/pms/finance/folios/:id/documents (FIN-06) ──
router.post('/folio/:folioId', (req, res) => {
  res.status(410).json({ success: false, error: 'הנפקה מחשבון אורח עברה למסך החשבון (POST /finance/folios/:id/documents)' });
});

// ── POST /manual — הנפקה ידנית ────────────────────────────────────────────
router.post('/manual', asyncHandler(async (req, res) => {
  requireRoles(req, INVOICE_ADMIN_ROLES);

  const { type, buyer, lines, payments, notes, pricesIncludeVat } = req.body;
  validateInvoiceType(type);

  if (!Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ success: false, error: 'חובה לספק לפחות שורת פריט אחת' });
  }

  const propertyId = getPropertyId(req);
  if (!propertyId) {
    return res.status(400).json({ success: false, error: 'propertyId נדרש' });
  }

  const invoice = await issueManualInvoice({
    propertyId,
    type,
    buyer:            buyer || null,
    lines,
    payments:         payments || [],
    notes:            notes || '',
    issuedBy:         req.actor?.id,
    pricesIncludeVat: pricesIncludeVat ?? false,
  });

  res.status(201).json({ success: true, data: invoice });
}));

// ── GET / — רשימת חשבוניות ────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  requireRoles(req, INVOICE_READ_ROLES);

  const propertyId = getPropertyId(req);
  if (!propertyId) {
    return res.status(400).json({ success: false, error: 'propertyId נדרש' });
  }

  const {
    type, status,
    dateFrom, dateTo,
    invoiceNumber,
    reservationId,
    folioId,
    page = 1,
    limit = 50,
  } = req.query;

  const filter = { property: propertyId };
  if (type)          filter.type          = type;
  if (status)        filter.status        = status;
  if (invoiceNumber) filter.invoiceNumber = new RegExp(invoiceNumber, 'i');
  if (reservationId) filter.reservation   = reservationId;
  if (folioId)       filter.folio         = folioId;
  if (dateFrom || dateTo) {
    filter.issueDate = {};
    if (dateFrom) filter.issueDate.$gte = dateFrom;
    if (dateTo)   filter.issueDate.$lte = dateTo;
  }

  const skip  = (Number(page) - 1) * Number(limit);
  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .sort({ issueDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('issuedBy', 'firstName lastName')
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  res.json({ success: true, data: { invoices, total, page: Number(page), limit: Number(limit) } });
}));

// ── GET /:id — חשבונית בודדת ──────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, INVOICE_READ_ROLES);

  const invoice = await Invoice.findById(req.params.id)
    .populate('issuedBy', 'firstName lastName')
    .populate('relatedInvoiceId', 'invoiceNumber type issueDate')
    .populate('creditedBy', 'invoiceNumber type issueDate totalGross')
    .populate('reservation', 'confirmationNumber arrivalDate departureDate')
    .lean();

  if (!invoice) return res.status(404).json({ success: false, error: 'חשבונית לא נמצאה' });
  assertPropertyScope(req, String(invoice.property));

  res.json({ success: true, data: invoice });
}));

// ── GET /:id/html — HTML להדפסה (מקור בהדפסה הראשונה, העתק אחריה) ─────
router.get('/:id/html', asyncHandler(async (req, res) => {
  requireRoles(req, INVOICE_READ_ROLES);
  const invoice = await Invoice.findById(req.params.id).select('property').lean();
  if (!invoice) return res.status(404).json({ success: false, error: 'חשבונית לא נמצאה' });
  assertPropertyScope(req, String(invoice.property));
  const html = await printDocument({ propertyId: String(invoice.property), id: req.params.id });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

// ── POST /:id/credit-note — הנפקת הודעת זיכוי ────────────────────────────
router.post('/:id/credit-note', asyncHandler(async (req, res) => {
  requireRoles(req, INVOICE_ADMIN_ROLES);

  const { creditAmount, reason } = req.body;
  await getInvoiceInScope(req, req.params.id);

  const creditNote = await issueCreditNote({
    originalInvoiceId: req.params.id,
    creditAmount:      creditAmount != null ? Number(creditAmount) : undefined,
    reason,
    issuedBy:          req.actor?.id,
  });

  res.status(201).json({ success: true, data: creditNote });
}));

// ── PATCH /:id/allocation — עדכון מספר הקצאה (9 ספרות) ───────────────────
router.patch('/:id/allocation', asyncHandler(async (req, res) => {
  requireRoles(req, INVOICE_ADMIN_ROLES);
  const invoice = await getInvoiceInScope(req, req.params.id);
  const a = actorOrSystem(req);
  const data = await setAllocation({ propertyId: String(invoice.property), id: req.params.id, input: req.body || {}, actor: { id: a.id, name: a.name, role: a.role }, ip: req.ip });
  res.json({ success: true, data });
}));

export default router;
