import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Folio from '../models/Folio.js';
import Company from '../models/Company.js';
import { audit } from '../services/auditService.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';

const router = Router();

const FOLIO_READ_ROLES = [
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

const FOLIO_WRITE_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'receptionist',
  'finance_manager',
  'cashier',
];

const FOLIO_MANAGER_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'finance_manager',
  'front_desk_manager',
];

function calcBalance(folio) {
  return (folio.lines || [])
    .filter((line) => line.status === 'posted')
    .reduce((sum, line) => sum + (line.amount || 0) + (line.taxAmount || 0), 0);
}

function todayYmd() {
  return new Date().toISOString().split('T')[0];
}

async function getFolioInScope(req, folioId, { lean = false, populate = null } = {}) {
  let query = Folio.findById(folioId);
  if (populate) query = query.populate(populate);
  if (lean) query = query.lean();

  const folio = await query;
  if (!folio) return null;

  assertPropertyScope(req, String(folio.property));
  return folio;
}

async function getReservationFolioInScope(req, reservationId, { lean = false, populate = null } = {}) {
  let query = Folio.findOne({ reservation: reservationId });
  if (populate) query = query.populate(populate);
  if (lean) query = query.lean();

  const folio = await query;
  if (!folio) return null;

  assertPropertyScope(req, String(folio.property));
  return folio;
}

// GET /api/folio/reservation/:resId
router.get('/reservation/:resId', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_READ_ROLES);

  const folio = await getReservationFolioInScope(req, req.params.resId, {
    lean: true,
    populate: { path: 'reservation', select: 'confirmationNumber primaryGuest arrivalDate departureDate' },
  });

  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  res.json({ success: true, data: { ...folio, balance: calcBalance(folio) } });
}));

// GET /api/folio/reservation/:resId/receipt
router.get('/reservation/:resId/receipt', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_READ_ROLES);

  const folio = await getReservationFolioInScope(req, req.params.resId, {
    lean: true,
    populate: {
      path: 'reservation',
      select: 'confirmationNumber arrivalDate departureDate nights ratePerNight totalAmount taxAmount currency',
      populate: [
        { path: 'primaryGuest', select: 'firstName lastName email phone' },
        { path: 'assignedRoom', select: 'number' },
        { path: 'roomType', select: 'name code' },
        { path: 'property', select: 'name address phone email' },
      ],
    },
  });

  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  const activeLines = (folio.lines || []).filter((line) => line.status === 'posted');
  const totalCharges = activeLines
    .filter((line) => line.amount > 0)
    .reduce((sum, line) => sum + (line.amount || 0) + (line.taxAmount || 0), 0);
  const totalPayments = activeLines
    .filter((line) => line.amount < 0)
    .reduce((sum, line) => sum + Math.abs(line.amount || 0), 0);

  res.json({
    success: true,
    data: {
      folio,
      totalCharges,
      totalPayments,
      balance: calcBalance(folio),
      generatedAt: new Date().toISOString(),
    },
  });
}));

// GET /api/folio/reservation/:resId/invoice
router.get('/reservation/:resId/invoice', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_READ_ROLES);

  const folio = await getReservationFolioInScope(req, req.params.resId, {
    lean: true,
    populate: {
      path: 'reservation',
      populate: [
        { path: 'primaryGuest', select: 'firstName lastName email phone country idDocNumber' },
        { path: 'assignedRoom', select: 'number' },
        { path: 'roomType', select: 'name code' },
        { path: 'property', select: 'name address phone email vatNumber' },
        { path: 'company', select: 'name address vatNumber' },
      ],
    },
  });

  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  const activeLines = (folio.lines || []).filter((line) => line.status === 'posted');
  const chargeLines = activeLines.filter((line) => line.amount > 0);
  const totalNet = chargeLines.reduce((sum, line) => sum + (line.amount || 0), 0);
  const totalTax = chargeLines.reduce((sum, line) => sum + (line.taxAmount || 0), 0);
  const totalGross = totalNet + totalTax;
  const totalPayments = activeLines
    .filter((line) => line.amount < 0)
    .reduce((sum, line) => sum + Math.abs(line.amount || 0), 0);

  res.json({
    success: true,
    data: {
      folio,
      chargeLines,
      totalNet,
      totalTax,
      totalGross,
      totalPayments,
      balance: totalGross - totalPayments,
      issuedAt: new Date().toISOString(),
    },
  });
}));

// POST /api/folio/:folioId/charge
router.post('/:folioId/charge', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_WRITE_ROLES);

  const { description, amount, taxAmount = 0, department, serviceDate } = req.body;
  if (!description || Number(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'description and positive amount are required' });
  }

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio is closed' });

  folio.lines.push({
    type: 'charge',
    description,
    amount: Number(amount),
    taxAmount: Number(taxAmount) || 0,
    department,
    serviceDate: serviceDate || todayYmd(),
    source: 'manual',
    status: 'posted',
    createdBy: req.actor?.id || null,
  });

  await folio.save();
  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/payment
router.post('/:folioId/payment', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_WRITE_ROLES);

  const { amount, description = 'Payment', method = 'cash', serviceDate } = req.body;
  if (Number(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'positive amount is required' });
  }

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio is closed' });

  folio.lines.push({
    type: 'payment',
    description: `${description}${method !== 'cash' ? ` (${method})` : ''}`,
    amount: -Math.abs(Number(amount)),
    taxAmount: 0,
    serviceDate: serviceDate || todayYmd(),
    source: 'pms',
    status: 'posted',
    createdBy: req.actor?.id || null,
  });

  await folio.save();

  await audit({
    property: folio.property,
    action: 'folio.payment',
    entityType: 'Folio',
    entityId: folio._id,
    after: { amount: Number(amount), method },
    ip: req.ip,
  });

  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/deposit
router.post('/:folioId/deposit', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_WRITE_ROLES);

  const { amount, description = 'Deposit', method = 'cash' } = req.body;
  if (Number(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'positive amount is required' });
  }

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio is closed' });

  folio.lines.push({
    type: 'deposit',
    description: `${description} - ${method}`,
    amount: -Math.abs(Number(amount)),
    taxAmount: 0,
    serviceDate: todayYmd(),
    source: 'pms',
    status: 'posted',
    createdBy: req.actor?.id || null,
  });

  await folio.save();

  await audit({
    property: folio.property,
    action: 'folio.deposit',
    entityType: 'Folio',
    entityId: folio._id,
    after: { amount: Number(amount), method },
    ip: req.ip,
  });

  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/discount
router.post('/:folioId/discount', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_MANAGER_ROLES);

  const { description = 'Discount', amount, reason, serviceDate } = req.body;
  if (Number(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'positive amount is required' });
  }

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio is closed' });

  folio.lines.push({
    type: 'discount',
    description: reason ? `${description}: ${reason}` : description,
    amount: -Math.abs(Number(amount)),
    taxAmount: 0,
    serviceDate: serviceDate || todayYmd(),
    source: 'manual',
    status: 'posted',
    createdBy: req.actor?.id || null,
  });

  await folio.save();

  await audit({
    property: folio.property,
    action: 'folio.discount',
    entityType: 'Folio',
    entityId: folio._id,
    after: { amount: Number(amount), reason },
    ip: req.ip,
  });

  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/adjustment
router.post('/:folioId/adjustment', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_MANAGER_ROLES);

  const { description = 'Adjustment', amount, reason, serviceDate } = req.body;
  if (Number.isNaN(Number(amount))) {
    return res.status(400).json({ success: false, error: 'amount is required' });
  }

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio is closed' });

  folio.lines.push({
    type: 'adjustment',
    description: reason ? `${description}: ${reason}` : description,
    amount: Number(amount),
    taxAmount: 0,
    serviceDate: serviceDate || todayYmd(),
    source: 'manual',
    status: 'posted',
    createdBy: req.actor?.id || null,
  });

  await folio.save();

  await audit({
    property: folio.property,
    action: 'folio.adjustment',
    entityType: 'Folio',
    entityId: folio._id,
    after: { amount: Number(amount), reason },
    ip: req.ip,
  });

  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/refund
router.post('/:folioId/refund', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_MANAGER_ROLES);

  const { amount, description = 'Refund', reason, method = 'cash', serviceDate } = req.body;
  if (Number(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'positive amount is required' });
  }

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  folio.lines.push({
    type: 'refund',
    description: `${description}${reason ? `: ${reason}` : ''} (${method})`,
    amount: -Math.abs(Number(amount)),
    taxAmount: 0,
    serviceDate: serviceDate || todayYmd(),
    source: 'manual',
    status: 'posted',
    createdBy: req.actor?.id || null,
  });

  await folio.save();

  await audit({
    property: folio.property,
    action: 'folio.refund',
    entityType: 'Folio',
    entityId: folio._id,
    after: { amount: Number(amount), reason, method },
    ip: req.ip,
  });

  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/void-line
router.post('/:folioId/void-line', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_MANAGER_ROLES);

  const { lineId, reason } = req.body;
  if (!lineId) return res.status(400).json({ success: false, error: 'lineId is required' });

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  const line = folio.lines.id(lineId);
  if (!line) return res.status(404).json({ success: false, error: 'Line not found' });
  if (line.status !== 'posted') {
    return res.status(400).json({ success: false, error: 'Line is already voided' });
  }

  line.status = 'voided';
  line.voidedAt = new Date();
  line.voidReason = reason;
  await folio.save();

  await audit({
    property: folio.property,
    action: 'folio.line_voided',
    entityType: 'Folio',
    entityId: folio._id,
    after: { lineId, reason },
    ip: req.ip,
  });

  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/transfer-line
router.post('/:folioId/transfer-line', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_MANAGER_ROLES);

  const { lineId, targetFolioId, reason } = req.body;
  if (!lineId || !targetFolioId) {
    return res.status(400).json({ success: false, error: 'lineId and targetFolioId are required' });
  }

  const source = await getFolioInScope(req, req.params.folioId);
  if (!source) return res.status(404).json({ success: false, error: 'Source folio not found' });

  const target = await getFolioInScope(req, targetFolioId);
  if (!target) return res.status(404).json({ success: false, error: 'Target folio not found' });

  if (source.status === 'closed' || target.status === 'closed') {
    return res.status(400).json({ success: false, error: 'Cannot transfer lines to/from a closed folio' });
  }

  const line = source.lines.id(lineId);
  if (!line || line.status !== 'posted') {
    return res.status(400).json({ success: false, error: 'Line cannot be transferred' });
  }

  line.status = 'voided';
  line.voidedAt = new Date();
  line.voidReason = `Transferred: ${reason || 'transfer'}`;

  target.lines.push({
    type: line.type,
    description: line.description,
    amount: line.amount,
    taxAmount: line.taxAmount,
    department: line.department,
    serviceDate: line.serviceDate,
    source: 'manual',
    status: 'posted',
    reference: `transferred from ${source._id}`,
    createdBy: req.actor?.id || null,
  });

  await source.save();
  await target.save();

  await audit({
    property: source.property,
    action: 'folio.transfer_line',
    entityType: 'Folio',
    entityId: source._id,
    after: { lineId, targetFolioId, reason },
    ip: req.ip,
  });

  res.json({
    success: true,
    data: {
      sourceBalance: calcBalance(source),
      targetBalance: calcBalance(target),
    },
  });
}));

// POST /api/folio/:folioId/close
router.post('/:folioId/close', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_WRITE_ROLES);

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio is already closed' });

  const balance = calcBalance(folio);
  if (Math.abs(balance) > 0.01) {
    return res.status(400).json({ success: false, error: `Cannot close folio with balance ${balance.toFixed(2)}` });
  }

  folio.status = 'closed';
  folio.closedAt = new Date();
  folio.closedBy = req.actor?.id || null;
  await folio.save();

  await audit({
    property: folio.property,
    action: 'folio.closed',
    entityType: 'Folio',
    entityId: folio._id,
    ip: req.ip,
  });

  res.json({ success: true, data: folio });
}));

// POST /api/folio/:folioId/reopen
router.post('/:folioId/reopen', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_MANAGER_ROLES, 'Reopening a closed folio requires manager permissions');

  const { reason } = req.body;
  if (!reason) return res.status(400).json({ success: false, error: 'reason is required' });

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });
  if (folio.status !== 'closed') return res.status(400).json({ success: false, error: 'Folio is not closed' });

  folio.status = 'open';
  folio.closedAt = undefined;
  folio.closedBy = undefined;
  await folio.save();

  await audit({
    property: folio.property,
    action: 'folio.reopened',
    entityType: 'Folio',
    entityId: folio._id,
    after: { reason },
    ip: req.ip,
  });

  res.json({ success: true, data: folio });
}));

// POST /api/folio/:folioId/post-checkout-charge
router.post('/:folioId/post-checkout-charge', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_MANAGER_ROLES, 'Post-checkout charges require manager permissions');

  const { description, amount, taxAmount = 0, department = 'damage', reason } = req.body;
  if (!description || Number(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'description and positive amount are required' });
  }
  if (!reason) {
    return res.status(400).json({ success: false, error: 'reason is required for post-checkout charges' });
  }

  const folio = await getFolioInScope(req, req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  const wasClosed = folio.status === 'closed';
  if (wasClosed) {
    folio.status = 'open';
    folio.closedAt = undefined;
    folio.closedBy = undefined;
  }

  folio.lines.push({
    type: 'charge',
    description: `[Post-Checkout] ${description}`,
    amount: Number(amount),
    taxAmount: Number(taxAmount) || 0,
    department,
    serviceDate: todayYmd(),
    source: 'manual',
    status: 'posted',
    reference: `reason: ${reason}`,
    createdBy: req.actor?.id || null,
  });

  await folio.save();

  await audit({
    property: folio.property,
    action: 'folio.post_checkout_charge',
    entityType: 'Folio',
    entityId: folio._id,
    after: { description, amount: Number(amount), department, reason, wasClosed },
    ip: req.ip,
  });

  res.status(201).json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/check-company-credit
router.post('/:folioId/check-company-credit', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_MANAGER_ROLES);

  const { amount } = req.body;
  const numericAmount = Number(amount || 0);

  const folio = await getFolioInScope(req, req.params.folioId, { lean: true });
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  if (folio.ownerType !== 'company' || !folio.ownerRef) {
    return res.json({ success: true, data: { applicable: false, withinLimit: true } });
  }

  const company = await Company.findById(folio.ownerRef).lean();
  if (!company) {
    return res.json({ success: true, data: { applicable: false, withinLimit: true } });
  }

  assertPropertyScope(req, String(company.property));

  const creditLimit = Number(company.creditLimit || 0);
  const currentBalance = calcBalance(folio);
  const projectedBalance = currentBalance + numericAmount;
  const withinLimit = creditLimit === 0 || projectedBalance <= creditLimit;

  res.json({
    success: true,
    data: {
      applicable: true,
      companyId: String(company._id),
      companyName: company.name,
      creditLimit,
      currentBalance,
      projectedBalance,
      withinLimit,
      overage: withinLimit ? 0 : projectedBalance - creditLimit,
    },
  });
}));

export default router;
