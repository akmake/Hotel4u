import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';

const router = Router();

// Specific paths MUST come before /:id

// GET /api/properties/room-types?propertyId=
router.get('/room-types', asyncHandler(async (req, res) => {
  const { propertyId, all } = req.query;
  const filter = { property: propertyId };
  if (!all) filter.active = true;
  const types = await RoomType.find(filter).sort({ sortOrder: 1 }).lean();
  res.json({ success: true, data: types });
}));

// POST /api/properties/room-types
router.post('/room-types', asyncHandler(async (req, res) => {
  const {
    propertyId, code, name, shortDesc, fullDesc,
    capacityBase, capacityMax, baseRate,
    bedType, extraBedAllowed, cribAllowed, roomSizeSqm, view, amenities,
    sellable, showInEngine, overbookingAllowed, overbookingLimit, sortOrder,
  } = req.body;

  if (!propertyId || !code || !name || baseRate === undefined) {
    return res.status(400).json({ success: false, error: 'נדרשים: propertyId, code, name, baseRate' });
  }

  const rt = await RoomType.create({
    property: propertyId,
    code: code.toUpperCase(),
    name,
    shortDesc,
    fullDesc,
    capacityBase: Number(capacityBase) || 2,
    capacityMax:  Number(capacityMax)  || 2,
    baseRate:     Number(baseRate),
    bedType:      bedType || 'double',
    extraBedAllowed: !!extraBedAllowed,
    cribAllowed:     cribAllowed !== false,
    roomSizeSqm:  roomSizeSqm ? Number(roomSizeSqm) : undefined,
    view:         view || undefined,
    amenities:    Array.isArray(amenities) ? amenities : [],
    sellable:        sellable !== false,
    showInEngine:    showInEngine !== false,
    overbookingAllowed: !!overbookingAllowed,
    overbookingLimit:   Number(overbookingLimit) || 0,
    sortOrder:    Number(sortOrder) || 0,
  });

  res.status(201).json({ success: true, data: rt });
}));

// PATCH /api/properties/room-types/:id
router.patch('/room-types/:id', asyncHandler(async (req, res) => {
  const allowed = [
    'name', 'shortDesc', 'fullDesc', 'baseRate',
    'capacityBase', 'capacityMax',
    'bedType', 'extraBedAllowed', 'cribAllowed', 'roomSizeSqm', 'view', 'amenities',
    'sellable', 'showInEngine', 'overbookingAllowed', 'overbookingLimit',
    'active', 'sortOrder',
  ];
  const update = {};
  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      update[k] = ['baseRate', 'capacityBase', 'capacityMax', 'roomSizeSqm', 'overbookingLimit', 'sortOrder'].includes(k)
        ? Number(req.body[k])
        : req.body[k];
    }
  });

  const rt = await RoomType.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!rt) return res.status(404).json({ success: false, error: 'סוג חדר לא נמצא' });
  res.json({ success: true, data: rt });
}));

// DELETE /api/properties/room-types/:id  (soft delete)
router.delete('/room-types/:id', asyncHandler(async (req, res) => {
  const rt = await RoomType.findByIdAndUpdate(req.params.id, { active: false }, { new: true }).lean();
  if (!rt) return res.status(404).json({ success: false, error: 'סוג חדר לא נמצא' });
  res.json({ success: true, data: rt });
}));

// GET /api/properties
router.get('/', asyncHandler(async (req, res) => {
  const properties = await Property.find({ active: true }).lean();
  res.json({ success: true, data: properties });
}));

// GET /api/properties/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const property = await Property.findById(req.params.id).lean();
  if (!property) return res.status(404).json({ success: false, error: 'נכס לא נמצא' });
  res.json({ success: true, data: property });
}));

// PATCH /api/properties/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = [
    'name', 'legalName', 'city', 'address', 'country', 'phone', 'email', 'website',
    'checkInTime', 'checkOutTime',
    'taxNumber', 'vatRate', 'invoicePrefix', 'invoiceSequence',
    'defaultCancellationHours', 'defaultCancellationFee',
    'petPolicy', 'smokingPolicy', 'childrenPolicy',
  ];
  const update = {};
  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      update[k] = ['vatRate', 'invoiceSequence', 'defaultCancellationHours'].includes(k)
        ? Number(req.body[k])
        : req.body[k];
    }
  });
  const property = await Property.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!property) return res.status(404).json({ success: false, error: 'נכס לא נמצא' });
  res.json({ success: true, data: property });
}));

export default router;
