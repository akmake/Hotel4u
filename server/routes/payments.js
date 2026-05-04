/**
 * פרק יח — Payments Route
 * Spec sections 18.1 (payment methods) + 18.2 (operations) + 18.3 (rules).
 * All financial operations that require audit trail and OWASP-compliant tokenization.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope } from '../middleware/authContext.js';
import { audit, auditCtxFromReq } from '../services/auditService.js';
import Payment, { PAYMENT_METHODS, PAYMENT_OPERATIONS } from '../models/Payment.js';
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import { emit } from '../services/webhookService.js';

const router = Router();

// ── Helper ─────────────────────────────────────────────────────────────────────
function folioBalance(folio) {
  const lines = (folio.lines || []).filter(l => l.status === 'posted');
  return lines.reduce((s, l) => s + (l.amount || 0) + (l.taxAmount || 0), 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/payments?propertyId=&folioId=&reservationId=&status=&from=&to=
// ══════════════════════════════════════════════════════════════════════════════
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, folioId, reservationId, status } = req.query;
  assertPropertyScope(req, propertyId);

  const filter = { property: propertyId };
  if (folioId)       filter.folio       = folioId;
  if (reservationId) filter.reservation = reservationId;
  if (status)        filter.status      = status;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to + 'T23:59:59Z');
  }

  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);

  // Never return tokenId / authCode in list responses (OWASP)
  const safe = payments.map(({ tokenId, authCode, ...p }) => p);
  res.json({ success: true, data: safe, meta: { page, limit, total } });
}));

// GET /api/payments/methods — list available payment methods
router.get('/methods', (req, res) => {
  res.json({ success: true, data: PAYMENT_METHODS });
});

// GET /api/payments/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id).lean();
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });
  assertPropertyScope(req, String(payment.property));
  const { tokenId, authCode, ...safe } = payment;
  res.json({ success: true, data: safe });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/payments — create a new payment (sale / authorization / deposit)
// Spec 18.2 + 18.3
// ══════════════════════════════════════════════════════════════════════════════
router.post('/', asyncHandler(async (req, res) => {
  const {
    propertyId, folioId, reservationId,
    paymentMethod, operation = 'sale', amount, currency = 'ILS',
    provider, providerReference, tokenId, last4, cardBrand,
    correlationId, notes,
  } = req.body;

  assertPropertyScope(req, propertyId);

  if (!folioId)       return res.status(400).json({ success: false, error: 'folioId is required' });
  if (!paymentMethod) return res.status(400).json({ success: false, error: 'paymentMethod is required' });
  if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'amount must be positive' });

  // Spec 18.3: never store full card number — only token
  if (req.body.cardNumber) {
    return res.status(400).json({ success: false, error: 'Full card numbers must not be sent to this endpoint. Use tokenId only.' });
  }

  const folio = await Folio.findById(folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (String(folio.property) !== String(propertyId)) {
    return res.status(403).json({ success: false, error: 'Folio does not belong to property' });
  }

  // Idempotency check (spec 18.3)
  if (correlationId) {
    const existing = await Payment.findOne({ correlationId }).lean();
    if (existing) {
      return res.status(200).json({ success: true, data: existing, idempotent: true });
    }
  }

  const payment = await Payment.create({
    property: propertyId,
    folio: folioId,
    reservation: reservationId || folio.reservation,
    paymentMethod,
    operation,
    amount,
    currency,
    status: operation === 'authorization' ? 'authorized' : 'captured',
    provider,
    providerReference,
    tokenId,       // token only, not full card
    last4,
    cardBrand,
    correlationId,
    createdBy: req.actor?._id,
    notes,
    ...(operation === 'authorization' ? { authorizedAt: new Date() } : { capturedAt: new Date() }),
  });

  // Post payment line to folio
  folio.lines.push({
    type: 'payment',
    description: `תשלום — ${paymentMethod}${last4 ? ` **** ${last4}` : ''}`,
    amount: -Math.abs(amount),     // negative = reduces balance
    taxAmount: 0,
    department: 'payments',
    serviceDate: new Date().toISOString().split('T')[0],
    source: 'pms',
    status: 'posted',
    paymentMethod,
    reference: payment._id.toString(),
  });
  await folio.save();

  await audit({
    property: propertyId, ...auditCtxFromReq(req),
    action: `payment.${operation}`,
    entityType: 'Payment', entityId: payment._id,
    after: { amount, paymentMethod, operation, currency },
  });

  await emit(propertyId, 'payment.succeeded', { paymentId: String(payment._id), amount, paymentMethod });

  const { tokenId: _t, authCode: _a, ...safePayment } = payment.toObject();
  res.status(201).json({ success: true, data: safePayment });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/payments/:id/refund — spec 18.2: refund / partial refund
// Requires permission: payment.refund
// ══════════════════════════════════════════════════════════════════════════════
router.post('/:id/refund', asyncHandler(async (req, res) => {
  const { amount, reason, providerReference } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });
  assertPropertyScope(req, String(payment.property));

  if (!['captured', 'sale', 'partially_refunded'].includes(payment.status)) {
    return res.status(409).json({ success: false, error: `Cannot refund a payment with status "${payment.status}"` });
  }

  const maxRefund = payment.amount - (payment.refundedAmount || 0);
  const refundAmt = amount ? Math.min(Number(amount), maxRefund) : maxRefund;

  if (refundAmt <= 0) {
    return res.status(400).json({ success: false, error: 'Already fully refunded' });
  }

  payment.refundedAmount = (payment.refundedAmount || 0) + refundAmt;
  payment.status         = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded';
  payment.refundedAt     = new Date();
  if (providerReference) payment.providerReference = providerReference;
  await payment.save();

  // Post refund line to folio
  const folio = await Folio.findById(payment.folio);
  if (folio) {
    folio.lines.push({
      type: 'refund',
      description: `זיכוי — ${payment.paymentMethod}${reason ? ` (${reason})` : ''}`,
      amount: Math.abs(refundAmt),   // positive = increases balance
      taxAmount: 0,
      department: 'payments',
      serviceDate: new Date().toISOString().split('T')[0],
      source: 'pms',
      status: 'posted',
      reference: payment._id.toString(),
    });
    await folio.save();
  }

  // Audit (spec 18.3: refund/void require permission + audit)
  await audit({
    property: String(payment.property), ...auditCtxFromReq(req),
    action: 'payment.refund',
    entityType: 'Payment', entityId: payment._id,
    before: { status: 'captured', refundedAmount: payment.refundedAmount - refundAmt },
    after:  { status: payment.status, refundedAmount: payment.refundedAmount },
    reason,
  });

  const { tokenId: _t, authCode: _a, ...safe } = payment.toObject();
  res.json({ success: true, data: safe });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/payments/:id/void — spec 18.2
// ══════════════════════════════════════════════════════════════════════════════
router.post('/:id/void', asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });
  assertPropertyScope(req, String(payment.property));

  if (!['authorized', 'pending'].includes(payment.status)) {
    return res.status(409).json({ success: false, error: `Cannot void a payment with status "${payment.status}"` });
  }

  payment.status   = 'voided';
  payment.voidedAt = new Date();
  await payment.save();

  // Reverse the folio line
  const folio = await Folio.findById(payment.folio);
  if (folio) {
    const line = folio.lines.find(l => l.reference === payment._id.toString() && l.type === 'payment');
    if (line) line.status = 'voided';
    await folio.save();
  }

  await audit({
    property: String(payment.property), ...auditCtxFromReq(req),
    action: 'payment.void',
    entityType: 'Payment', entityId: payment._id,
    before: { status: 'authorized' }, after: { status: 'voided' }, reason,
  });

  res.json({ success: true, data: { voided: true, paymentId: req.params.id } });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/payments/:id/capture — capture a pre-authorization
// ══════════════════════════════════════════════════════════════════════════════
router.post('/:id/capture', asyncHandler(async (req, res) => {
  const { amount, providerReference } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });
  assertPropertyScope(req, String(payment.property));

  if (payment.status !== 'authorized') {
    return res.status(409).json({ success: false, error: `Cannot capture a payment with status "${payment.status}"` });
  }

  const captureAmt = amount ? Math.min(Number(amount), payment.amount) : payment.amount;
  payment.status      = 'captured';
  payment.amount      = captureAmt;
  payment.capturedAt  = new Date();
  payment.operation   = 'capture';
  if (providerReference) payment.providerReference = providerReference;
  await payment.save();

  await audit({
    property: String(payment.property), ...auditCtxFromReq(req),
    action: 'payment.capture',
    entityType: 'Payment', entityId: payment._id,
    before: { status: 'authorized' }, after: { status: 'captured', amount: captureAmt },
  });

  res.json({ success: true, data: { captured: true, amount: captureAmt } });
}));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/payments/link — generate a pay-by-link (spec 18.1 + 18.2)
// ══════════════════════════════════════════════════════════════════════════════
router.post('/link', asyncHandler(async (req, res) => {
  const { propertyId, folioId, reservationId, amount, currency = 'ILS', expiryHours = 48, notes } = req.body;
  assertPropertyScope(req, propertyId);

  if (!folioId || !amount || amount <= 0) {
    return res.status(400).json({ success: false, error: 'folioId and positive amount are required' });
  }

  const folio = await Folio.findById(folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  // In production this would call the payment provider to create a hosted link.
  // Here we create a pending Payment record and return a stub link URL.
  const linkToken = crypto.randomBytes(24).toString('hex');
  const expiry    = new Date(Date.now() + expiryHours * 3600_000);

  const payment = await Payment.create({
    property: propertyId,
    folio: folioId,
    reservation: reservationId || folio.reservation,
    paymentMethod: 'pay_by_link',
    operation: 'sale',
    amount,
    currency,
    status: 'pending',
    paymentLinkUrl: `/pay/${linkToken}`,
    paymentLinkExpiry: expiry,
    correlationId: linkToken,
    createdBy: req.actor?._id,
    notes,
  });

  await audit({
    property: propertyId, ...auditCtxFromReq(req),
    action: 'payment.link_created',
    entityType: 'Payment', entityId: payment._id,
    after: { amount, currency, expiryHours, linkToken },
  });

  res.status(201).json({
    success: true,
    data: {
      paymentId: String(payment._id),
      linkUrl: payment.paymentLinkUrl,
      expiry: payment.paymentLinkExpiry,
      amount,
      currency,
    },
  });
}));

export default router;
