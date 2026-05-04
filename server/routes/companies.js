import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Company from '../models/Company.js';

const router = Router();

// GET /api/companies?propertyId=&q=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, q } = req.query;
  const filter = { property: propertyId, active: true };
  if (q) filter.name = { $regex: q, $options: 'i' };
  const companies = await Company.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, data: companies });
}));

// POST /api/companies
router.post('/', asyncHandler(async (req, res) => {
  const { propertyId, name, type, contactName, email, phone, address, taxId, creditLimit, discountPct, notes } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'שם חברה נדרש' });
  const company = await Company.create({ property: propertyId, name, type, contactName, email, phone, address, taxId, creditLimit, discountPct, notes });
  res.json({ success: true, data: company });
}));

// PATCH /api/companies/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = ['name','type','contactName','email','phone','address','taxId','creditLimit','discountPct','notes','active'];
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const company = await Company.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!company) return res.status(404).json({ success: false, error: 'חברה לא נמצאה' });
  res.json({ success: true, data: company });
}));

export default router;
