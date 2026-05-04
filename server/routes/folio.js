import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Folio from '../models/Folio.js';
import { audit } from '../services/auditService.js';

const router = Router();

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

export default router;
