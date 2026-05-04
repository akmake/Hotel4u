import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import InventoryDate from '../models/InventoryDate.js';
import {
  checkAvailability,
  getStayDates,
  lockAvailability,
  consumeAvailabilityLock,
  releaseAvailabilityLock,
} from '../services/availabilityService.js';
import { audit } from '../services/auditService.js';

const router = Router();

const COUNT_FIELDS = [
  'physicalCount',
  'blockedCount',
  'oooCount',
  'bookedCount',
  'tentativeCount',
  'lockedCount',
  'allotmentCount',
  'releasedAllotmentCount',
  'overbookingLimit',
  'minLos',
  'maxLos',
];

const FLAG_FIELDS = ['stopSell', 'closedToArrival', 'closedToDeparture'];

function sanitizePatch(payload = {}) {
  const update = {};

  for (const key of COUNT_FIELDS) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
      const n = Number(payload[key]);
      if (!Number.isNaN(n)) update[key] = n;
    }
  }

  for (const key of FLAG_FIELDS) {
    if (payload[key] !== undefined) update[key] = !!payload[key];
  }

  for (const key of ['note']) {
    if (payload[key] !== undefined) update[key] = payload[key];
  }

  return update;
}

// GET /api/inventory?propertyId=&roomTypeId=&fromDate=&toDate=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, roomTypeId, fromDate, toDate } = req.query;

  if (!propertyId || !roomTypeId || !fromDate || !toDate) {
    return res.status(400).json({
      success: false,
      error: 'Required query params: propertyId, roomTypeId, fromDate, toDate',
    });
  }

  const dates = getStayDates(fromDate, toDate);
  const docs = await InventoryDate.find({
    property: propertyId,
    roomType: roomTypeId,
    date: { $in: dates },
  }).sort({ date: 1 }).lean();

  const data = docs.map((row) => {
    const effectiveAllotment = Math.max(0, (row.allotmentCount || 0) - (row.releasedAllotmentCount || 0));
    const sellableCount = Math.max(0, row.physicalCount - row.blockedCount - row.oooCount);
    const availableCount = Math.max(
      0,
      sellableCount - row.bookedCount - row.tentativeCount - row.lockedCount - effectiveAllotment + row.overbookingLimit
    );

    return {
      ...row,
      effectiveAllotment,
      sellableCount,
      availableCount,
    };
  });

  res.json({ success: true, data });
}));

// PUT /api/inventory/bulk
router.put('/bulk', asyncHandler(async (req, res) => {
  const { propertyId, roomTypeId, fromDate, toDate, values, reason } = req.body;
  if (!propertyId || !roomTypeId || !fromDate || !toDate) {
    return res.status(400).json({
      success: false,
      error: 'Required body fields: propertyId, roomTypeId, fromDate, toDate',
    });
  }

  const dates = getStayDates(fromDate, toDate);
  if (!dates.length) return res.status(400).json({ success: false, error: 'Invalid date range' });

  const update = sanitizePatch(values || {});
  const ops = dates.map((date) => ({
    updateOne: {
      filter: { property: propertyId, roomType: roomTypeId, date },
      update: { $set: update, $setOnInsert: { property: propertyId, roomType: roomTypeId, date } },
      upsert: true,
    },
  }));

  if (ops.length) {
    await InventoryDate.bulkWrite(ops, { ordered: false });
  }

  await audit({
    property: propertyId,
    actor: null,
    actorName: 'system',
    action: 'inventory.bulk_update',
    entityType: 'InventoryDate',
    entityId: roomTypeId,
    before: null,
    after: { fromDate, toDate, values: update },
    reason,
    ip: req.ip,
  }).catch(() => null);

  const docs = await InventoryDate.find({
    property: propertyId,
    roomType: roomTypeId,
    date: { $in: dates },
  }).sort({ date: 1 }).lean();

  res.json({ success: true, data: docs });
}));

// PATCH /api/inventory/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const update = sanitizePatch(req.body || {});
  const row = await InventoryDate.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
  if (!row) return res.status(404).json({ success: false, error: 'Inventory row not found' });

  await audit({
    property: row.property,
    actor: null,
    actorName: 'system',
    action: 'inventory.row_update',
    entityType: 'InventoryDate',
    entityId: row._id,
    before: null,
    after: update,
    reason: req.body?.reason,
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: row });
}));

// POST /api/inventory/availability/check
router.post('/availability/check', asyncHandler(async (req, res) => {
  const { propertyId, roomTypeId, arrivalDate, departureDate, requiredRooms = 1 } = req.body;
  const result = await checkAvailability({
    propertyId,
    roomTypeId,
    arrivalDate,
    departureDate,
    requiredRooms: Number(requiredRooms) || 1,
  });

  res.json({ success: true, data: result });
}));

// POST /api/inventory/locks
router.post('/locks', asyncHandler(async (req, res) => {
  const {
    propertyId,
    roomTypeId,
    arrivalDate,
    departureDate,
    roomsCount = 1,
    idempotencyKey,
    source,
    timeoutSeconds,
  } = req.body;

  const lock = await lockAvailability({
    propertyId,
    roomTypeId,
    arrivalDate,
    departureDate,
    roomsCount: Number(roomsCount) || 1,
    idempotencyKey,
    source,
    timeoutSeconds: timeoutSeconds ? Number(timeoutSeconds) : undefined,
  });

  await audit({
    property: propertyId,
    actor: null,
    actorName: 'system',
    action: 'inventory.lock.created',
    entityType: 'InventoryLock',
    entityId: lock._id,
    before: null,
    after: lock.toObject(),
    reason: 'Availability lock created',
    ip: req.ip,
  }).catch(() => null);

  res.status(201).json({ success: true, data: lock });
}));

// POST /api/inventory/locks/consume
router.post('/locks/consume', asyncHandler(async (req, res) => {
  const { propertyId, idempotencyKey } = req.body;
  const lock = await consumeAvailabilityLock({ propertyId, idempotencyKey });

  await audit({
    property: propertyId,
    actor: null,
    actorName: 'system',
    action: 'inventory.lock.consumed',
    entityType: 'InventoryLock',
    entityId: lock._id,
    before: null,
    after: lock.toObject(),
    reason: 'Availability lock consumed',
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: lock });
}));

// POST /api/inventory/locks/release
router.post('/locks/release', asyncHandler(async (req, res) => {
  const { propertyId, idempotencyKey } = req.body;
  const lock = await releaseAvailabilityLock({ propertyId, idempotencyKey });
  if (!lock) return res.status(404).json({ success: false, error: 'Lock not found' });

  await audit({
    property: propertyId,
    actor: null,
    actorName: 'system',
    action: 'inventory.lock.released',
    entityType: 'InventoryLock',
    entityId: lock._id,
    before: null,
    after: lock.toObject(),
    reason: 'Availability lock released',
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: lock });
}));

export default router;
