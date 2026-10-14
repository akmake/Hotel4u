/**
 * Payments route
 * Handles payment records, folio posting, and payment lifecycle actions.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import { audit, auditCtxFromReq } from '../services/auditService.js';
import Payment, { PAYMENT_METHODS } from '../models/Payment.js';
import Folio from '../models/Folio.js';
import { emit } from '../services/webhookService.js';
import { fireEvent } from '../services/automationEngine.js';

const router = Router();

const PAYMENT_READ_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'receptionist',
  'finance_manager',
  'cashier',
  'auditor',
  'owner_readonly',
];

const PAYMENT_WRITE_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'receptionist',
  'finance_manager',
  'cashier',
];

const PAYMENT_REFUND_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'finance_manager',
  'cashier',
];

const PAYMENT_VOID_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'finance_manager',
];

function requirePropertyScope(req, explicitPropertyId) {
  const propertyId = explicitPropertyId || req.query.propertyId || req.body.propertyId || req.actor?.propertyId;
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}

function sanitizePayment(paymentDocOrObj) {
  const payment = paymentDocOrObj.toObject ? paymentDocOrObj.toObject() : paymentDocOrObj;
  const { tokenId, authCode, ...safe } = payment;
  return safe;
}

function todayYmd() {
  return new Date().toISOString().split('T')[0];
}

// GET /api/payments?propertyId=&folioId=&reservationId=&status=&from=&to=
router.get('/', asyncHandler(async (req, res) => {
  requireRoles(req, PAYMENT_READ_ROLES);

  const propertyId = requirePropertyScope(req, req.query.propertyId);
  const { folioId, reservationId, status } = req.query;

  const filter = { property: propertyId };
  if (folioId) filter.folio = folioId;
  if (reservationId) filter.reservation = reservationId;
  if (status) filter.status = status;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(`${req.query.to}T23:59:59Z`);
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: payments.map(sanitizePayment),
    meta: { page, limit, total },
  });
}));

// GET /api/payments/methods
router.get('/methods', (req, res) => {
  requireRoles(req, PAYMENT_READ_ROLES);
  res.json({ success: true, data: PAYMENT_METHODS });
});

// GET /api/payments/:id
router.get('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, PAYMENT_READ_ROLES);

  const payment = await Payment.findById(req.params.id).lean();
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

  assertPropertyScope(req, String(payment.property));
  res.json({ success: true, data: sanitizePayment(payment) });
}));

// POST /api/payments
// Writes that post folio lines bypassed every money gate (balance cap, cash policy, catalogue,
// refund caps). They are closed; payments and refunds are recorded on /api/pms/finance (FIN-03/04).
// A live payment provider (authorize/capture/webhook) is gate G10 and does not exist yet.
const goneMsg = 'הפעולה הוחלפה: תשלום והחזר נרשמים במסך החשבון (FIN-03/FIN-04). ספק סליקה חי טרם חובר (שער G10).';
for (const path of ['/', '/:id/refund', '/:id/void']) {
  router.post(path, (req, res) => res.status(410).json({ success: false, error: goneMsg }));
}

router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, PAYMENT_WRITE_ROLES);

  const {
    propertyId,
    folioId,
    reservationId,
    paymentMethod,
    operation = 'sale',
    amount,
    currency = 'ILS',
    provider,
    providerReference,
    tokenId,
    last4,
    cardBrand,
    correlationId,
    notes,
  } = req.body;

  const scopedPropertyId = requirePropertyScope(req, propertyId);

  if (!folioId) return res.status(400).json({ success: false, error: 'folioId is required' });
  if (!paymentMethod) return res.status(400).json({ success: false, error: 'paymentMethod is required' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, error: 'amount must be positive' });
  if (req.body.cardNumber) {
    return res.status(400).json({
      success: false,
      error: 'Full card numbers are not allowed. Send tokenId only.',
    });
  }

  const folio = await Folio.findById(folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (String(folio.property) !== String(scopedPropertyId)) {
    return res.status(403).json({ success: false, error: 'Folio does not belong to property' });
  }

  if (correlationId) {
    const existing = await Payment.findOne({ correlationId }).lean();
    if (existing) {
      return res.status(200).json({ success: true, data: sanitizePayment(existing), idempotent: true });
    }
  }

  const numericAmount = Number(amount);
  const payment = await Payment.create({
    property: scopedPropertyId,
    folio: folioId,
    reservation: reservationId || folio.reservation,
    paymentMethod,
    operation,
    amount: numericAmount,
    currency,
    status: operation === 'authorization' ? 'authorized' : 'captured',
    provider,
    providerReference,
    tokenId,
    last4,
    cardBrand,
    correlationId,
    createdBy: req.actor?.id || null,
    notes,
    ...(operation === 'authorization' ? { authorizedAt: new Date() } : { capturedAt: new Date() }),
  });

  folio.lines.push({
    type: 'payment',
    description: `Payment - ${paymentMethod}${last4 ? ` **** ${last4}` : ''}`,
    amount: -Math.abs(numericAmount),
    taxAmount: 0,
    department: 'payments',
    serviceDate: todayYmd(),
    source: 'pms',
    status: 'posted',
    paymentMethod,
    reference: payment._id.toString(),
    createdBy: req.actor?.id || null,
  });
  await folio.save();

  await audit({
    property: scopedPropertyId,
    ...auditCtxFromReq(req),
    action: `payment.${operation}`,
    entityType: 'Payment',
    entityId: payment._id,
    after: { amount: numericAmount, paymentMethod, operation, currency },
  });

  await emit(scopedPropertyId, 'payment.succeeded', {
    paymentId: String(payment._id),
    amount: numericAmount,
    paymentMethod,
  });

  fireEvent('payment.succeeded', {
    property: String(scopedPropertyId),
    payment: {
      _id:           String(payment._id),
      amount:        numericAmount,
      currency,
      paymentMethod,
      operation,
      reservation:   String(payment.reservation || ''),
    },
  }).catch(() => null);

  res.status(201).json({ success: true, data: sanitizePayment(payment) });
}));

// POST /api/payments/:id/refund
router.post('/:id/refund', asyncHandler(async (req, res) => {
  requireRoles(req, PAYMENT_REFUND_ROLES);

  const { amount, reason, providerReference } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

  assertPropertyScope(req, String(payment.property));

  if (!['captured', 'sale', 'partially_refunded'].includes(payment.status)) {
    return res.status(409).json({
      success: false,
      error: `Cannot refund a payment with status "${payment.status}"`,
    });
  }

  const maxRefund = payment.amount - (payment.refundedAmount || 0);
  const refundAmount = amount ? Math.min(Number(amount), maxRefund) : maxRefund;

  if (refundAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Payment is already fully refunded' });
  }

  const before = {
    status: payment.status,
    refundedAmount: payment.refundedAmount || 0,
  };

  payment.refundedAmount = (payment.refundedAmount || 0) + refundAmount;
  payment.status = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded';
  payment.refundedAt = new Date();
  if (providerReference) payment.providerReference = providerReference;
  await payment.save();

  const folio = await Folio.findById(payment.folio);
  if (folio) {
    folio.lines.push({
      type: 'refund',
      description: `Refund - ${payment.paymentMethod}${reason ? ` (${reason})` : ''}`,
      amount: Math.abs(refundAmount),
      taxAmount: 0,
      department: 'payments',
      serviceDate: todayYmd(),
      source: 'pms',
      status: 'posted',
      reference: payment._id.toString(),
      createdBy: req.actor?.id || null,
    });
    await folio.save();
  }

  await audit({
    property: String(payment.property),
    ...auditCtxFromReq(req),
    action: 'payment.refund',
    entityType: 'Payment',
    entityId: payment._id,
    before,
    after: { status: payment.status, refundedAmount: payment.refundedAmount },
    reason,
  });

  res.json({ success: true, data: sanitizePayment(payment) });
}));

// POST /api/payments/:id/void
router.post('/:id/void', asyncHandler(async (req, res) => {
  requireRoles(req, PAYMENT_VOID_ROLES);

  const { reason } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

  assertPropertyScope(req, String(payment.property));

  if (!['authorized', 'pending'].includes(payment.status)) {
    return res.status(409).json({
      success: false,
      error: `Cannot void a payment with status "${payment.status}"`,
    });
  }

  const before = { status: payment.status };

  payment.status = 'voided';
  payment.voidedAt = new Date();
  await payment.save();

  const folio = await Folio.findById(payment.folio);
  if (folio) {
    const line = (folio.lines || []).find(
      (entry) => entry.reference === payment._id.toString() && entry.type === 'payment'
    );
    if (line) {
      line.status = 'voided';
      line.voidedAt = new Date();
      line.voidReason = reason || 'voided payment';
    }
    await folio.save();
  }

  await audit({
    property: String(payment.property),
    ...auditCtxFromReq(req),
    action: 'payment.void',
    entityType: 'Payment',
    entityId: payment._id,
    before,
    after: { status: payment.status },
    reason,
  });

  res.json({ success: true, data: { voided: true, paymentId: req.params.id } });
}));

// POST /api/payments/:id/capture
router.post('/:id/capture', asyncHandler(async (req, res) => {
  requireRoles(req, PAYMENT_VOID_ROLES);

  const { amount, providerReference } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

  assertPropertyScope(req, String(payment.property));

  if (payment.status !== 'authorized') {
    return res.status(409).json({
      success: false,
      error: `Cannot capture a payment with status "${payment.status}"`,
    });
  }

  const captureAmount = amount ? Math.min(Number(amount), payment.amount) : payment.amount;
  const before = { status: payment.status, amount: payment.amount };

  payment.status = 'captured';
  payment.amount = captureAmount;
  payment.capturedAt = new Date();
  payment.operation = 'capture';
  if (providerReference) payment.providerReference = providerReference;
  await payment.save();

  await audit({
    property: String(payment.property),
    ...auditCtxFromReq(req),
    action: 'payment.capture',
    entityType: 'Payment',
    entityId: payment._id,
    before,
    after: { status: payment.status, amount: captureAmount },
  });

  res.json({ success: true, data: { captured: true, amount: captureAmount } });
}));

// POST /api/payments/:id/fail  (gateway callback: mark payment as failed)
router.post('/:id/fail', asyncHandler(async (req, res) => {
  requireRoles(req, PAYMENT_WRITE_ROLES);

  const { reason, providerReference } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

  assertPropertyScope(req, String(payment.property));

  if (!['pending', 'authorized'].includes(payment.status)) {
    return res.status(409).json({
      success: false,
      error: `Cannot mark a ${payment.status} payment as failed`,
    });
  }

  const before = { status: payment.status };
  payment.status = 'failed';
  payment.failedAt = new Date();
  if (providerReference) payment.providerReference = providerReference;
  await payment.save();

  await audit({
    property: String(payment.property),
    ...auditCtxFromReq(req),
    action: 'payment.failed',
    entityType: 'Payment',
    entityId: payment._id,
    before,
    after: { status: 'failed' },
    reason,
  });

  fireEvent('payment.failed', {
    property: String(payment.property),
    payment: {
      _id:           String(payment._id),
      amount:        payment.amount,
      currency:      payment.currency,
      paymentMethod: payment.paymentMethod,
      reservation:   String(payment.reservation || ''),
      reason,
    },
  }).catch(() => null);

  res.json({ success: true, data: sanitizePayment(payment) });
}));

// POST /api/payments/link
router.post('/link', asyncHandler(async (req, res) => {
  requireRoles(req, PAYMENT_WRITE_ROLES);

  const { propertyId, folioId, reservationId, amount, currency = 'ILS', expiryHours = 48, notes } = req.body;
  const scopedPropertyId = requirePropertyScope(req, propertyId);

  if (!folioId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'folioId and positive amount are required' });
  }

  const folio = await Folio.findById(folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (String(folio.property) !== String(scopedPropertyId)) {
    return res.status(403).json({ success: false, error: 'Folio does not belong to property' });
  }

  const linkToken = crypto.randomBytes(24).toString('hex');
  const expiry = new Date(Date.now() + Number(expiryHours) * 3600_000);

  const payment = await Payment.create({
    property: scopedPropertyId,
    folio: folioId,
    reservation: reservationId || folio.reservation,
    paymentMethod: 'pay_by_link',
    operation: 'sale',
    amount: Number(amount),
    currency,
    status: 'pending',
    paymentLinkUrl: `/pay/${linkToken}`,
    paymentLinkExpiry: expiry,
    correlationId: linkToken,
    createdBy: req.actor?.id || null,
    notes,
  });

  await audit({
    property: scopedPropertyId,
    ...auditCtxFromReq(req),
    action: 'payment.link_created',
    entityType: 'Payment',
    entityId: payment._id,
    after: { amount: Number(amount), currency, expiryHours: Number(expiryHours), linkToken },
  });

  res.status(201).json({
    success: true,
    data: {
      paymentId: String(payment._id),
      linkUrl: payment.paymentLinkUrl,
      expiry: payment.paymentLinkExpiry,
      amount: Number(amount),
      currency,
    },
  });
}));

export default router;
