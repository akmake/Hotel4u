import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';

const router = Router();
const PROPERTY_ADMIN_ROLES = ['super_admin', 'property_admin', 'general_manager'];

const NUMERIC_FIELDS = new Set([
  'vatRate', 'invoiceSequence', 'reservationSequence', 'defaultCancellationHours',
]);

const CRM_SLA_NUMERIC_FIELDS = [
  'leadStaleDays',
  'leadDueGraceHours',
  'leadHighScoreThreshold',
  'leadHighScoreUnassignedEscalationHours',
  'leadAttentionScoreThreshold',
  'oppAtRiskInactiveDays',
  'oppStalledInactiveDays',
  'oppOverdueCloseEscalationDays',
  'oppAttentionScoreThreshold',
];

function normalizeCrmSla(value) {
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const key of CRM_SLA_NUMERIC_FIELDS) {
    if (value[key] !== undefined) out[key] = Number(value[key]);
  }
  return out;
}

function normalizeUpdate(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (k === 'crmSla') {
      const normalizedSla = normalizeCrmSla(v);
      if (normalizedSla) out[k] = normalizedSla;
      continue;
    }
    out[k] = NUMERIC_FIELDS.has(k) && v != null ? Number(v) : v;
  }
  return out;
}

async function loadPropertyOr404(id, res) {
  const row = await Property.findById(id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Property not found' });
    return null;
  }
  return row;
}

// -------- Room types --------
router.get('/room-types', asyncHandler(async (req, res) => {
  const { propertyId, all } = req.query;
  assertPropertyScope(req, propertyId);
  const filter = { property: propertyId };
  if (!all) filter.active = true;
  const types = await RoomType.find(filter).sort({ sortOrder: 1 }).lean();
  res.json({ success: true, data: types });
}));

router.post('/room-types', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Room type management requires property admin permissions');
  const {
    propertyId, code, name, shortDesc, fullDesc,
    capacityBase, capacityMax, adultsMax, childrenMax, baseRate,
    bedType, extraBedAllowed, cribAllowed, roomSizeSqm, view, amenities, images,
    sellable, showInEngine, closedToSale, sellOnChannels, blockOnChannels, allowRatePlans,
    overbookingAllowed, overbookingLimit, sortOrder,
  } = req.body;

  if (!propertyId || !code || !name || baseRate === undefined) {
    return res.status(400).json({ success: false, error: 'Required: propertyId, code, name, baseRate' });
  }
  assertPropertyScope(req, propertyId);

  const rt = await RoomType.create({
    property: propertyId,
    code: code.toUpperCase(),
    name,
    shortDesc,
    fullDesc,
    capacityBase: Number(capacityBase) || 2,
    capacityMax: Number(capacityMax) || 2,
    adultsMax: Number(adultsMax) || Number(capacityMax) || 2,
    childrenMax: Number(childrenMax) || 0,
    baseRate: Number(baseRate),
    bedType: bedType || 'double',
    extraBedAllowed: !!extraBedAllowed,
    cribAllowed: cribAllowed !== false,
    roomSizeSqm: roomSizeSqm ? Number(roomSizeSqm) : undefined,
    view: view || undefined,
    amenities: Array.isArray(amenities) ? amenities : [],
    images: Array.isArray(images) ? images : [],
    sellable: sellable !== false,
    showInEngine: showInEngine !== false,
    closedToSale: !!closedToSale,
    sellOnChannels: Array.isArray(sellOnChannels) ? sellOnChannels : [],
    blockOnChannels: Array.isArray(blockOnChannels) ? blockOnChannels : [],
    allowRatePlans: Array.isArray(allowRatePlans) ? allowRatePlans : [],
    overbookingAllowed: !!overbookingAllowed,
    overbookingLimit: Number(overbookingLimit) || 0,
    sortOrder: Number(sortOrder) || 0,
  });

  res.status(201).json({ success: true, data: rt });
}));

router.patch('/room-types/:id', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Room type management requires property admin permissions');
  const allowed = [
    'name', 'shortDesc', 'fullDesc', 'baseRate', 'capacityBase', 'capacityMax', 'adultsMax', 'childrenMax',
    'bedType', 'extraBedAllowed', 'cribAllowed', 'roomSizeSqm', 'view', 'amenities', 'images',
    'sellable', 'showInEngine', 'closedToSale', 'sellOnChannels', 'blockOnChannels', 'allowRatePlans',
    'overbookingAllowed', 'overbookingLimit', 'active', 'sortOrder',
  ];
  const update = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      update[k] = ['baseRate', 'capacityBase', 'capacityMax', 'adultsMax', 'childrenMax', 'roomSizeSqm', 'overbookingLimit', 'sortOrder'].includes(k)
        ? Number(req.body[k])
        : req.body[k];
    }
  }

  const existing = await RoomType.findById(req.params.id).select('property').lean();
  if (!existing) return res.status(404).json({ success: false, error: 'Room type not found' });
  assertPropertyScope(req, String(existing.property));
  const rt = await RoomType.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!rt) return res.status(404).json({ success: false, error: 'Room type not found' });
  res.json({ success: true, data: rt });
}));

router.delete('/room-types/:id', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Room type management requires property admin permissions');
  const existing = await RoomType.findById(req.params.id).select('property').lean();
  if (!existing) return res.status(404).json({ success: false, error: 'Room type not found' });
  assertPropertyScope(req, String(existing.property));
  const rt = await RoomType.findByIdAndUpdate(req.params.id, { active: false }, { new: true }).lean();
  if (!rt) return res.status(404).json({ success: false, error: 'Room type not found' });
  res.json({ success: true, data: rt });
}));

// -------- Property setup collections --------
router.get('/:id/setup', asyncHandler(async (req, res) => {
  assertPropertyScope(req, req.params.id);
  const row = await Property.findById(req.params.id).lean();
  if (!row) return res.status(404).json({ success: false, error: 'Property not found' });

  res.json({
    success: true,
    data: {
      buildings: row.buildings || [],
      housekeepingZones: row.housekeepingZones || [],
      publicAreas: row.publicAreas || [],
      taxes: row.taxes || [],
      surcharges: row.surcharges || [],
      paymentMethods: row.paymentMethods || [],
      messageTemplates: row.messageTemplates || [],
      documentTemplates: row.documentTemplates || [],
      requiredGuestFields: row.requiredGuestFields || [],
      requiredCheckInFields: row.requiredCheckInFields || [],
      requiredCheckOutFields: row.requiredCheckOutFields || [],
      numbering: {
        reservationPrefix: row.reservationPrefix,
        reservationSequence: row.reservationSequence,
        invoicePrefix: row.invoicePrefix,
        invoiceSequence: row.invoiceSequence,
      },
    },
  });
}));

router.put('/:id/setup/:collection', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Property setup update requires property admin permissions');
  assertPropertyScope(req, req.params.id);
  const allowed = [
    'buildings', 'housekeepingZones', 'publicAreas',
    'taxes', 'surcharges', 'paymentMethods',
    'messageTemplates', 'documentTemplates',
    'requiredGuestFields', 'requiredCheckInFields', 'requiredCheckOutFields',
  ];

  const { collection } = req.params;
  if (!allowed.includes(collection)) {
    return res.status(400).json({ success: false, error: `Invalid collection: ${collection}` });
  }

  const row = await loadPropertyOr404(req.params.id, res);
  if (!row) return;

  row[collection] = Array.isArray(req.body.items) ? req.body.items : [];
  await row.save();

  res.json({ success: true, data: row[collection] });
}));

router.post('/:id/buildings', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Property setup update requires property admin permissions');
  assertPropertyScope(req, req.params.id);
  const row = await loadPropertyOr404(req.params.id, res);
  if (!row) return;

  const { code, name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name is required' });

  row.buildings.push({ code, name, floors: [] });
  await row.save();
  res.status(201).json({ success: true, data: row.buildings[row.buildings.length - 1] });
}));

router.post('/:id/buildings/:buildingId/floors', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Property setup update requires property admin permissions');
  assertPropertyScope(req, req.params.id);
  const row = await loadPropertyOr404(req.params.id, res);
  if (!row) return;

  const building = row.buildings.id(req.params.buildingId);
  if (!building) return res.status(404).json({ success: false, error: 'Building not found' });

  const { number, name } = req.body;
  if (number == null) return res.status(400).json({ success: false, error: 'number is required' });

  building.floors.push({ number: Number(number), name, wings: [] });
  await row.save();
  res.status(201).json({ success: true, data: building.floors[building.floors.length - 1] });
}));

router.post('/:id/buildings/:buildingId/floors/:floorId/wings', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Property setup update requires property admin permissions');
  assertPropertyScope(req, req.params.id);
  const row = await loadPropertyOr404(req.params.id, res);
  if (!row) return;

  const building = row.buildings.id(req.params.buildingId);
  if (!building) return res.status(404).json({ success: false, error: 'Building not found' });

  const floor = building.floors.id(req.params.floorId);
  if (!floor) return res.status(404).json({ success: false, error: 'Floor not found' });

  const { code, name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name is required' });

  floor.wings.push({ code, name });
  await row.save();
  res.status(201).json({ success: true, data: floor.wings[floor.wings.length - 1] });
}));

router.patch('/:id/numbering', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Property setup update requires property admin permissions');
  assertPropertyScope(req, req.params.id);
  const row = await loadPropertyOr404(req.params.id, res);
  if (!row) return;

  const allowed = ['reservationPrefix', 'reservationSequence', 'invoicePrefix', 'invoiceSequence'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) row[k] = ['reservationSequence', 'invoiceSequence'].includes(k) ? Number(req.body[k]) : req.body[k];
  }
  await row.save();
  res.json({ success: true, data: {
    reservationPrefix: row.reservationPrefix,
    reservationSequence: row.reservationSequence,
    invoicePrefix: row.invoicePrefix,
    invoiceSequence: row.invoiceSequence,
  } });
}));

// -------- Core property --------
router.get('/', asyncHandler(async (req, res) => {
  const filter = { active: true };
  if (req.actor?.propertyId && req.actor.role !== 'super_admin') {
    filter._id = req.actor.propertyId;
  }
  const properties = await Property.find(filter).lean();
  res.json({ success: true, data: properties });
}));

router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Creating property requires property admin permissions');
  const payload = normalizeUpdate(req.body || {});
  if (!payload.name) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  const property = await Property.create(payload);
  res.status(201).json({ success: true, data: property });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  assertPropertyScope(req, req.params.id);
  const property = await Property.findById(req.params.id).lean();
  if (!property) return res.status(404).json({ success: false, error: 'Property not found' });
  res.json({ success: true, data: property });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, PROPERTY_ADMIN_ROLES, 'Property update requires property admin permissions');
  assertPropertyScope(req, req.params.id);
  const allowed = [
    'name', 'propertyCode', 'legalName', 'timezone', 'defaultCurrency', 'city', 'state', 'postalCode', 'address', 'country',
    'phone', 'email', 'website', 'logoUrl', 'activeLanguages',
    'checkInTime', 'checkOutTime',
    'taxNumber', 'vatRate', 'invoicePrefix', 'invoiceSequence',
    'reservationPrefix', 'reservationSequence',
    'defaultCancellationHours', 'defaultCancellationFee', 'defaultDepositPolicy',
    'petPolicy', 'smokingPolicy', 'childrenPolicy',
    'crmSla',
    'active',
  ];

  const update = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  }

  const property = await Property.findByIdAndUpdate(req.params.id, normalizeUpdate(update), { new: true }).lean();
  if (!property) return res.status(404).json({ success: false, error: 'Property not found' });
  res.json({ success: true, data: property });
}));

export default router;
