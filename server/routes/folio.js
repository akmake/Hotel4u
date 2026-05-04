import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import Company from '../models/Company.js';
import { audit } from '../services/auditService.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';

const router = Router();

const calcBalance = (folio) =>
  folio.lines.filter(l => l.status === 'posted').reduce((s, l) => s + l.amount + l.taxAmount, 0);

// GET /api/folio/reservation/:resId
router.get('/reservation/:resId', asyncHandler(async (req, res) => {
  const folio = await Folio.findOne({ reservation: req.params.resId })
    .populate('reservation', 'confirmationNumber primaryGuest arrivalDate departureDate')
    .lean();
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  const balance = folio.lines.filter(l => l.status === 'posted').reduce((s, l) => s + l.amount + l.taxAmount, 0);
  res.json({ success: true, data: { ...folio, balance } });
}));

// GET /api/folio/reservation/:resId/receipt
router.get('/reservation/:resId/receipt', asyncHandler(async (req, res) => {
  const folio = await Folio.findOne({ reservation: req.params.resId })
    .populate({
      path: 'reservation',
      select: 'confirmationNumber arrivalDate departureDate nights ratePerNight totalAmount taxAmount currency',
      populate: [
        { path: 'primaryGuest', select: 'firstName lastName email phone' },
        { path: 'assignedRoom',  select: 'number' },
        { path: 'roomType',      select: 'name code' },
        { path: 'property',      select: 'name address phone email' },
      ],
    })
    .lean();
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  const activeLines   = folio.lines.filter(l => l.status === 'posted');
  const totalCharges  = activeLines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount + l.taxAmount, 0);
  const totalPayments = activeLines.filter(l => l.amount < 0).reduce((s, l) => s + Math.abs(l.amount), 0);
  const balance       = activeLines.reduce((s, l) => s + l.amount + l.taxAmount, 0);

  res.json({ success: true, data: { folio, totalCharges, totalPayments, balance, generatedAt: new Date().toISOString() } });
}));

// GET /api/folio/reservation/:resId/invoice — full tax invoice
router.get('/reservation/:resId/invoice', asyncHandler(async (req, res) => {
  const folio = await Folio.findOne({ reservation: req.params.resId })
    .populate({
      path: 'reservation',
      populate: [
        { path: 'primaryGuest', select: 'firstName lastName email phone country idDocNumber' },
        { path: 'assignedRoom',  select: 'number' },
        { path: 'roomType',      select: 'name code' },
        { path: 'property',      select: 'name address phone email vatNumber' },
        { path: 'company',       select: 'name address vatNumber' },
      ],
    })
    .lean();
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  const activeLines   = folio.lines.filter(l => l.status === 'posted');
  const chargeLines   = activeLines.filter(l => l.amount > 0);
  const totalNet      = chargeLines.reduce((s, l) => s + l.amount, 0);
  const totalTax      = chargeLines.reduce((s, l) => s + (l.taxAmount || 0), 0);
  const totalGross    = totalNet + totalTax;
  const totalPayments = activeLines.filter(l => l.amount < 0).reduce((s, l) => s + Math.abs(l.amount), 0);
  const balance       = totalGross - totalPayments;

  res.json({ success: true, data: { folio, chargeLines, totalNet, totalTax, totalGross, totalPayments, balance, issuedAt: new Date().toISOString() } });
}));

// POST /api/folio/:folioId/charge
router.post('/:folioId/charge', asyncHandler(async (req, res) => {
  const { description, amount, taxAmount = 0, department, serviceDate, propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio סגור' });

  folio.lines.push({ type:'charge', description, amount, taxAmount, department, serviceDate: serviceDate || new Date().toISOString().split('T')[0], source:'manual', status:'posted' });
  await folio.save();
  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/payment
router.post('/:folioId/payment', asyncHandler(async (req, res) => {
  const { amount, description = 'תשלום', method = 'cash', serviceDate, propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio סגור' });

  folio.lines.push({ type:'payment', description: `${description}${method !== 'cash' ? ` (${method})` : ''}`, amount: -Math.abs(amount), taxAmount:0, serviceDate: serviceDate || new Date().toISOString().split('T')[0], source:'pms', status:'posted' });
  await folio.save();
  await audit({ property: folio.property, action: 'folio.payment', entityType: 'Folio', entityId: folio._id, after: { amount, method }, ip: req.ip });
  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/deposit
router.post('/:folioId/deposit', asyncHandler(async (req, res) => {
  const { amount, description = 'פיקדון', method = 'cash', propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio סגור' });
  if (!(Number(amount) > 0)) return res.status(400).json({ success: false, error: 'amount חייב להיות חיובי' });

  folio.lines.push({ type:'deposit', description: `${description} — ${method}`, amount: -Math.abs(Number(amount)), taxAmount:0, serviceDate: new Date().toISOString().split('T')[0], source:'pms', status:'posted' });
  await folio.save();
  await audit({ property: folio.property, action: 'folio.deposit', entityType: 'Folio', entityId: folio._id, after: { amount: Number(amount), method }, ip: req.ip });
  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/discount
router.post('/:folioId/discount', asyncHandler(async (req, res) => {
  const { description = 'הנחה', amount, reason, serviceDate, propertyId } = req.body;
  if (!(Number(amount) > 0)) return res.status(400).json({ success: false, error: 'סכום הנחה חייב להיות חיובי' });
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio סגור' });

  folio.lines.push({ type:'discount', description: reason ? `${description}: ${reason}` : description, amount: -Math.abs(Number(amount)), taxAmount:0, serviceDate: serviceDate || new Date().toISOString().split('T')[0], source:'manual', status:'posted' });
  await folio.save();
  await audit({ property: folio.property, action: 'folio.discount', entityType: 'Folio', entityId: folio._id, after: { amount, reason }, ip: req.ip });
  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/adjustment
router.post('/:folioId/adjustment', asyncHandler(async (req, res) => {
  const { description, amount, reason, serviceDate, propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio סגור' });

  folio.lines.push({ type:'adjustment', description: reason ? `${description || 'התאמה'}: ${reason}` : (description || 'התאמה'), amount: Number(amount), taxAmount:0, serviceDate: serviceDate || new Date().toISOString().split('T')[0], source:'manual', status:'posted' });
  await folio.save();
  await audit({ property: folio.property, action: 'folio.adjustment', entityType: 'Folio', entityId: folio._id, after: { amount, reason }, ip: req.ip });
  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/refund
router.post('/:folioId/refund', asyncHandler(async (req, res) => {
  const { amount, description = 'החזר כספי', reason, method = 'cash', serviceDate, propertyId } = req.body;
  if (!(Number(amount) > 0)) return res.status(400).json({ success: false, error: 'סכום חייב להיות חיובי' });
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  folio.lines.push({ type:'refund', description: `${description}${reason ? ': ' + reason : ''} (${method})`, amount: -Math.abs(Number(amount)), taxAmount:0, serviceDate: serviceDate || new Date().toISOString().split('T')[0], source:'manual', status:'posted' });
  await folio.save();
  await audit({ property: folio.property, action: 'folio.refund', entityType: 'Folio', entityId: folio._id, after: { amount, reason, method }, ip: req.ip });
  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/void-line
router.post('/:folioId/void-line', asyncHandler(async (req, res) => {
  const { lineId, reason, propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  const line = folio.lines.id(lineId);
  if (!line) return res.status(404).json({ success: false, error: 'שורה לא נמצאה' });
  if (line.status !== 'posted') return res.status(400).json({ success: false, error: 'שורה כבר בוטלה' });

  line.status    = 'voided';
  line.voidedAt  = new Date();
  line.voidReason= reason;
  await folio.save();

  await audit({ property: folio.property, action: 'folio.line_voided', entityType: 'Folio', entityId: folio._id, after: { lineId, reason }, ip: req.ip });
  res.json({ success: true, data: { folio, balance: calcBalance(folio) } });
}));

// POST /api/folio/:folioId/transfer-line — move a line to another folio
router.post('/:folioId/transfer-line', asyncHandler(async (req, res) => {
  const { lineId, targetFolioId, reason, propertyId } = req.body;
  const source = await Folio.findById(req.params.folioId);
  const target = await Folio.findById(targetFolioId);
  if (!source || !target) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  const line = source.lines.id(lineId);
  if (!line || line.status !== 'posted') return res.status(400).json({ success: false, error: 'שורה לא ניתנת להעברה' });

  // void in source, copy to target
  line.status     = 'voided';
  line.voidedAt   = new Date();
  line.voidReason = `הועבר: ${reason || 'transfer'}`;

  target.lines.push({ type: line.type, description: line.description, amount: line.amount, taxAmount: line.taxAmount, department: line.department, serviceDate: line.serviceDate, source: 'manual', status: 'posted', reference: `transferred from ${source._id}` });

  await source.save();
  await target.save();

  await audit({ property: source.property, action: 'folio.transfer_line', entityType: 'Folio', entityId: source._id, after: { lineId, targetFolioId, reason }, ip: req.ip });
  res.json({ success: true, data: { sourceBalance: calcBalance(source), targetBalance: calcBalance(target) } });
}));

// POST /api/folio/:folioId/close
router.post('/:folioId/close', asyncHandler(async (req, res) => {
  const { propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio כבר סגור' });

  const balance = calcBalance(folio);
  if (Math.abs(balance) > 0.01) return res.status(400).json({ success: false, error: `לא ניתן לסגור folio עם יתרה: ₪${balance.toFixed(2)}` });

  folio.status   = 'closed';
  folio.closedAt = new Date();
  await folio.save();
  await audit({ property: folio.property, action: 'folio.closed', entityType: 'Folio', entityId: folio._id, ip: req.ip });
  res.json({ success: true, data: folio });
}));

// POST /api/folio/:folioId/reopen — spec 58: requires manager permission
router.post('/:folioId/reopen', asyncHandler(async (req, res) => {
  requireRoles(req,
    ['super_admin', 'property_admin', 'general_manager', 'finance_manager', 'front_desk_manager'],
    'Reopening a closed folio requires manager permissions'
  );
  const { reason, propertyId } = req.body;
  if (!reason) return res.status(400).json({ success: false, error: 'reason is required to reopen a folio' });
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status !== 'closed') return res.status(400).json({ success: false, error: 'Folio אינו סגור' });

  folio.status   = 'open';
  folio.closedAt = undefined;
  await folio.save();
  await audit({ property: folio.property, action: 'folio.reopened', entityType: 'Folio', entityId: folio._id, after: { reason }, ip: req.ip });
  res.json({ success: true, data: folio });
}));


// GET /api/folio/reservation/:resId
router.get('/reservation/:resId', asyncHandler(async (req, res) => {
  const folio = await Folio.findOne({ reservation: req.params.resId })
    .populate('reservation', 'confirmationNumber primaryGuest arrivalDate departureDate')
    .lean();
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  const balance = folio.lines.filter(l => l.status === 'posted').reduce((s, l) => s + l.amount + l.taxAmount, 0);
  res.json({ success: true, data: { ...folio, balance } });
}));

// POST /api/folio/:folioId/charge — add a charge line
router.post('/:folioId/charge', asyncHandler(async (req, res) => {
  const { description, amount, taxAmount = 0, department, serviceDate, propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio סגור' });

  folio.lines.push({ type:'charge', description, amount, taxAmount, department, serviceDate: serviceDate || new Date().toISOString().split('T')[0], source:'manual', status:'posted' });
  await folio.save();

  const balance = folio.lines.filter(l => l.status === 'posted').reduce((s, l) => s + l.amount + l.taxAmount, 0);
  res.json({ success: true, data: { folio, balance } });
}));

// POST /api/folio/:folioId/payment — record a payment
router.post('/:folioId/payment', asyncHandler(async (req, res) => {
  const { amount, description = 'תשלום', serviceDate, propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio סגור' });

  folio.lines.push({ type:'payment', description, amount: -Math.abs(amount), taxAmount:0, serviceDate: serviceDate || new Date().toISOString().split('T')[0], source:'pms', status:'posted' });
  await folio.save();

  const balance = folio.lines.filter(l => l.status === 'posted').reduce((s, l) => s + l.amount + l.taxAmount, 0);

  await audit({ property: folio.property, action: 'folio.payment', entityType: 'Folio', entityId: folio._id, after: { amount }, ip: req.ip });
  res.json({ success: true, data: { folio, balance } });
}));

// POST /api/folio/:folioId/void-line — void a line
router.post('/:folioId/void-line', asyncHandler(async (req, res) => {
  const { lineId, reason, propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  const line = folio.lines.id(lineId);
  if (!line) return res.status(404).json({ success: false, error: 'שורה לא נמצאה' });
  if (line.status !== 'posted') return res.status(400).json({ success: false, error: 'שורה כבר בוטלה' });

  line.status = 'voided';
  line.voidedAt = new Date();
  line.voidReason = reason;
  await folio.save();

  await audit({ property: folio.property, action: 'folio.line_voided', entityType: 'Folio', entityId: folio._id, after: { lineId, reason }, ip: req.ip });
  const balance = folio.lines.filter(l => l.status === 'posted').reduce((s, l) => s + l.amount + l.taxAmount, 0);
  res.json({ success: true, data: { folio, balance } });
}));

// POST /api/folio/:folioId/deposit — record a deposit / pre-auth
router.post('/:folioId/deposit', asyncHandler(async (req, res) => {
  const { amount, description = 'פיקדון', method = 'cash', propertyId } = req.body;
  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });
  if (folio.status === 'closed') return res.status(400).json({ success: false, error: 'Folio סגור' });
  if (!(Number(amount) > 0)) return res.status(400).json({ success: false, error: 'amount חייב להיות חיובי' });

  folio.lines.push({
    type: 'deposit',
    description: `${description} — ${method}`,
    amount: -Math.abs(Number(amount)),
    taxAmount: 0,
    serviceDate: new Date().toISOString().split('T')[0],
    source: 'pms',
    status: 'posted',
  });
  await folio.save();

  await audit({ property: folio.property, action: 'folio.deposit', entityType: 'Folio', entityId: folio._id, after: { amount: Number(amount), method }, ip: req.ip });
  const balance = folio.lines.filter(l => l.status === 'posted').reduce((s, l) => s + l.amount + l.taxAmount, 0);
  res.json({ success: true, data: { folio, balance } });
}));

// GET /api/folio/reservation/:resId/receipt — receipt data for printing
router.get('/reservation/:resId/receipt', asyncHandler(async (req, res) => {
  const folio = await Folio.findOne({ reservation: req.params.resId })
    .populate({
      path: 'reservation',
      select: 'confirmationNumber arrivalDate departureDate nights ratePerNight totalAmount taxAmount currency',
      populate: [
        { path: 'primaryGuest', select: 'firstName lastName email phone' },
        { path: 'assignedRoom', select: 'number' },
        { path: 'roomType', select: 'name code' },
        { path: 'property', select: 'name address phone email' },
      ],
    })
    .lean();

  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  const activeLines = folio.lines.filter(l => l.status === 'posted');
  const totalCharges  = activeLines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount + l.taxAmount, 0);
  const totalPayments = activeLines.filter(l => l.amount < 0).reduce((s, l) => s + Math.abs(l.amount), 0);
  const balance       = activeLines.reduce((s, l) => s + l.amount + l.taxAmount, 0);

  res.json({ success: true, data: { folio, totalCharges, totalPayments, balance, generatedAt: new Date().toISOString() } });
}));

// ══════════════════════════════════════════════════════════════════════════════
// פרק כה — Edge Cases
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/folio/:folioId/post-checkout-charge
// Damage / POS charge after checkout. Requires manager role + reason.
// Automatically reopens and re-closes the folio.
router.post('/:folioId/post-checkout-charge', asyncHandler(async (req, res) => {
  requireRoles(req, ['super_admin', 'property_admin', 'general_manager', 'finance_manager', 'front_desk_manager'],
    'Post-checkout charges require manager permissions');

  const { description, amount, taxAmount = 0, department = 'damage', reason, propertyId } = req.body;
  if (!description || !(Number(amount) > 0)) {
    return res.status(400).json({ success: false, error: 'description and amount are required' });
  }
  if (!reason) {
    return res.status(400).json({ success: false, error: 'reason is required for post-checkout charges' });
  }

  const folio = await Folio.findById(req.params.folioId);
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  if (propertyId) assertPropertyScope(req, propertyId);

  const wasClosed = folio.status === 'closed';

  // Reopen temporarily
  if (wasClosed) {
    folio.status = 'open';
    folio.closedAt = undefined;
  }

  folio.lines.push({
    type: 'charge',
    description: `[Post-Checkout] ${description}`,
    amount: Number(amount),
    taxAmount: Number(taxAmount),
    department,
    serviceDate: new Date().toISOString().split('T')[0],
    source: 'manual',
    status: 'posted',
    reference: `reason: ${reason}`,
  });

  // Leave folio open so payment can be collected — manager decides when to close again
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
// Returns whether charging amount to a company folio would exceed credit limit.
router.post('/:folioId/check-company-credit', asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const folio = await Folio.findById(req.params.folioId).populate('company').lean();
  if (!folio) return res.status(404).json({ success: false, error: 'Folio לא נמצא' });

  if (folio.ownerType !== 'company' || !folio.company) {
    return res.json({ success: true, data: { applicable: false, withinLimit: true } });
  }

  const company = folio.company;
  const creditLimit = Number(company.creditLimit || 0);
  const currentBalance = folio.lines
    .filter(l => l.status === 'posted')
    .reduce((s, l) => s + l.amount + l.taxAmount, 0);

  const projected = currentBalance + Number(amount || 0);
  const withinLimit = creditLimit === 0 || projected <= creditLimit;

  res.json({
    success: true,
    data: {
      applicable: true,
      creditLimit,
      currentBalance,
      projectedBalance: projected,
      withinLimit,
      overage: withinLimit ? 0 : projected - creditLimit,
    },
  });
}));

export default router;
