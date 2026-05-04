import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope } from '../middleware/authContext.js';
import AuditLog from '../models/AuditLog.js';

const router = Router();

// GET /api/audit-log?propertyId=&entityType=&entityId=&action=&from=&to=&page=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, entityType, entityId, action, from, to, page = 1, limit = 50 } = req.query;
  if (!propertyId) return res.status(400).json({ success: false, error: 'propertyId נדרש' });
  assertPropertyScope(req, propertyId);

  const filter = { property: propertyId };
  if (entityType) filter.entityType = entityType;
  if (entityId)   filter.entityId   = entityId;
  if (action)     filter.action     = { $regex: action, $options: 'i' };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to)   filter.createdAt.$lte = new Date(to + 'T23:59:59Z');
  }

  const skip  = (Number(page) - 1) * Number(limit);
  const total = await AuditLog.countDocuments(filter);
  const logs  = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  res.json({ success: true, data: { logs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
}));

// GET /api/audit-log/entity/:type/:id — full history of a single entity
router.get('/entity/:type/:id', asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);

  const logs = await AuditLog.find({ entityType: type, entityId: id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  res.json({ success: true, data: logs });
}));

export default router;
