import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope } from '../middleware/authContext.js';
import { audit, auditCtxFromReq } from '../services/auditService.js';
import Company from '../models/Company.js';
import Reservation from '../models/Reservation.js';
import Folio from '../models/Folio.js';

const router = Router();

// GET /api/companies?propertyId=&q=&type=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, q, type } = req.query;
  assertPropertyScope(req, propertyId);
  const filter = { property: propertyId, active: true };
  if (q)    filter.name = { $regex: q, $options: 'i' };
  if (type) filter.type = type;
  const companies = await Company.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, data: companies });
}));

// GET /api/companies/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id).lean();
  if (!company) return res.status(404).json({ success: false, error: 'חברה לא נמצאה' });
  assertPropertyScope(req, String(company.property));
  res.json({ success: true, data: company });
}));

// GET /api/companies/:id/reservations
router.get('/:id/reservations', asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id).lean();
  if (!company) return res.status(404).json({ success: false, error: 'חברה לא נמצאה' });
  assertPropertyScope(req, String(company.property));

  const { page = 1, limit = 50 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const filter = { $or: [{ company: company._id }, { travelAgent: company._id }] };

  const total        = await Reservation.countDocuments(filter);
  const reservations = await Reservation.find(filter)
    .populate('primaryGuest', 'firstName lastName email phone')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .sort({ arrivalDate: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  // Aggregate total spend
  const spend = await Reservation.aggregate([
    { $match: filter },
    { $group: { _id: null, total: { $sum: '$totalAmount' }, nights: { $sum: '$nights' }, count: { $sum: 1 } } },
  ]);
  const summary = spend[0] || { total: 0, nights: 0, count: 0 };

  res.json({ success: true, data: { reservations, total, summary, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
}));

// GET /api/companies/:id/balance — open folio balance
router.get('/:id/balance', asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id).lean();
  if (!company) return res.status(404).json({ success: false, error: 'חברה לא נמצאה' });
  assertPropertyScope(req, String(company.property));

  const openFolios = await Folio.find({
    property: String(company.property),
    status: 'open',
  }).lean();

  const openBalance = openFolios.reduce((sum, f) => {
    const balance = f.lines?.reduce((s, l) => s + (l.status === 'posted' ? (l.amount || 0) : 0), 0) || 0;
    return sum + balance;
  }, 0);

  res.json({ success: true, data: { openBalance, openFolios: openFolios.length } });
}));

// POST /api/companies
router.post('/', asyncHandler(async (req, res) => {
  const { propertyId, name, type, contactName, email, phone, address, taxId, creditLimit, discountPct, notes } = req.body;
  assertPropertyScope(req, propertyId);
  if (!name) return res.status(400).json({ success: false, error: 'שם חברה נדרש' });

  const company = await Company.create({ property: propertyId, name, type, contactName, email, phone, address, taxId, creditLimit, discountPct, notes });

  await audit({ property: propertyId, ...auditCtxFromReq(req), action: 'company.create', entityType: 'Company', entityId: company._id, after: company.toObject() });
  res.status(201).json({ success: true, data: company });
}));

// PATCH /api/companies/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ success: false, error: 'חברה לא נמצאה' });
  assertPropertyScope(req, String(company.property));

  const allowed = ['name','type','contactName','email','phone','address','taxId','creditLimit','discountPct','notes','active'];
  const before = company.toObject();
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const updated = await Company.findByIdAndUpdate(req.params.id, update, { new: true }).lean();

  await audit({ property: String(company.property), ...auditCtxFromReq(req), action: 'company.update', entityType: 'Company', entityId: company._id, before, after: updated });
  res.json({ success: true, data: updated });
}));

// DELETE /api/companies/:id — soft delete
router.delete('/:id', asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ success: false, error: 'חברה לא נמצאה' });
  assertPropertyScope(req, String(company.property));

  await Company.findByIdAndUpdate(req.params.id, { active: false });
  await audit({ property: String(company.property), ...auditCtxFromReq(req), action: 'company.delete', entityType: 'Company', entityId: company._id });
  res.json({ success: true, data: { deleted: true } });
}));

export default router;
