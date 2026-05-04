import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import { actorOrSystem } from '../middleware/authContext.js';
import GroupBlock, { GROUP_STATUSES } from '../models/GroupBlock.js';
import Reservation from '../models/Reservation.js';
import { audit } from '../services/auditService.js';

const router = Router();

const COMMERCIAL_ROLES = [
  'super_admin', 'property_admin', 'general_manager',
  'front_desk_manager', 'sales_manager', 'revenue_manager', 'receptionist',
];
const MANAGER_ROLES = [
  'super_admin', 'property_admin', 'general_manager',
  'front_desk_manager', 'sales_manager', 'revenue_manager',
];

function actor(req) { return actorOrSystem(req); }

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/groups?propertyId=&status=&arrivalDate=&departureDate=&q=&page=&limit=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, status, arrivalDate, departureDate, q, page = 1, limit = 50 } = req.query;
  assertPropertyScope(req, propertyId);

  const filter = { property: propertyId };
  if (status) filter.status = { $in: String(status).split(',') };
  if (arrivalDate) filter.arrivalDate = { $gte: arrivalDate };
  if (departureDate) filter.departureDate = { $lte: departureDate };

  const total = await GroupBlock.countDocuments(filter);
  let groups = await GroupBlock.find(filter)
    .populate('company', 'name code')
    .sort({ arrivalDate: 1, createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  if (q) {
    const text = String(q).toLowerCase();
    groups = groups.filter(g =>
      g.name.toLowerCase().includes(text) ||
      g.groupCode.toLowerCase().includes(text) ||
      (g.contactName || '').toLowerCase().includes(text)
    );
  }

  res.json({ success: true, data: groups, total, page: Number(page), limit: Number(limit) });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/groups/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const group = await GroupBlock.findById(req.params.id)
    .populate('company', 'name code')
    .populate('createdBy', 'firstName lastName')
    .lean();
  if (!group) return res.status(404).json({ success: false, error: 'Group block not found' });
  assertPropertyScope(req, group.property);

  // Attach linked reservations count
  const reservationCount = await Reservation.countDocuments({
    property: group.property,
    $or: [{ group: String(group._id) }, { groupCode: group.groupCode }],
    status: { $nin: ['cancelled', 'no_show'] },
  });

  res.json({ success: true, data: { ...group, reservationCount } });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/groups
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Creating group blocks requires commercial permissions');

  const {
    propertyId, name, groupCode, description,
    arrivalDate, departureDate, cutoffDate,
    allotments = [], companyId,
    contactName, contactEmail, contactPhone,
    cancellationPolicy, depositPolicy, depositAmount, depositDueDate,
    autoReleaseOnCutoff, internalNotes, guestNotes,
  } = req.body;

  assertPropertyScope(req, propertyId);

  if (!name || !groupCode || !arrivalDate || !departureDate) {
    return res.status(400).json({ success: false, error: 'name, groupCode, arrivalDate, departureDate are required' });
  }
  if (departureDate <= arrivalDate) {
    return res.status(400).json({ success: false, error: 'departureDate must be after arrivalDate' });
  }

  const exists = await GroupBlock.findOne({ groupCode: String(groupCode).toUpperCase() });
  if (exists) return res.status(409).json({ success: false, error: `Group code ${groupCode} already exists` });

  const a = actor(req);
  const group = await GroupBlock.create({
    property: propertyId,
    name: name.trim(),
    groupCode: String(groupCode).toUpperCase().trim(),
    description,
    arrivalDate,
    departureDate,
    cutoffDate,
    allotments,
    company: companyId || undefined,
    contactName, contactEmail, contactPhone,
    cancellationPolicy, depositPolicy,
    depositAmount: depositAmount || 0,
    depositDueDate,
    autoReleaseOnCutoff: autoReleaseOnCutoff !== false,
    internalNotes, guestNotes,
    status: 'tentative',
    createdBy: a.id || undefined,
  });

  await audit({
    property: propertyId,
    actor: a.id || null,
    actorName: a.name || 'system',
    action: 'group.created',
    entityType: 'GroupBlock',
    entityId: group._id,
    after: group.toObject(),
    ip: req.ip,
  }).catch(() => null);

  res.status(201).json({ success: true, data: group });
}));

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/groups/:id
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Updating group blocks requires commercial permissions');

  const group = await GroupBlock.findById(req.params.id);
  if (!group) return res.status(404).json({ success: false, error: 'Group block not found' });
  assertPropertyScope(req, group.property);

  if (['completed', 'cancelled'].includes(group.status)) {
    return res.status(400).json({ success: false, error: `Cannot modify a ${group.status} group block` });
  }

  const allowed = [
    'name', 'description', 'cutoffDate', 'allotments', 'companyId',
    'contactName', 'contactEmail', 'contactPhone',
    'cancellationPolicy', 'depositPolicy', 'depositAmount', 'depositDueDate',
    'autoReleaseOnCutoff', 'internalNotes', 'guestNotes',
  ];

  const before = group.toObject();
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      group[key === 'companyId' ? 'company' : key] = req.body[key];
    }
  }
  await group.save();

  const a = actor(req);
  await audit({
    property: group.property,
    actor: a.id || null,
    actorName: a.name || 'system',
    action: 'group.modified',
    entityType: 'GroupBlock',
    entityId: group._id,
    before,
    after: group.toObject(),
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: group });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/groups/:id/confirm
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/confirm', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Confirming group requires manager permissions');

  const group = await GroupBlock.findById(req.params.id);
  if (!group) return res.status(404).json({ success: false, error: 'Group block not found' });
  assertPropertyScope(req, group.property);

  if (!['tentative'].includes(group.status)) {
    return res.status(400).json({ success: false, error: `Cannot confirm from status ${group.status}` });
  }
  if (!group.allotments.length || group.allotments.every(a => a.blocked === 0)) {
    return res.status(400).json({ success: false, error: 'Group must have at least one room allotment to confirm' });
  }

  group.status = 'confirmed';
  await group.save();

  const a = actor(req);
  await audit({
    property: group.property,
    actor: a.id || null,
    actorName: a.name || 'system',
    action: 'group.confirmed',
    entityType: 'GroupBlock',
    entityId: group._id,
    after: { status: 'confirmed' },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: group });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/groups/:id/cancel
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Cancelling group requires manager permissions');
  const { reason } = req.body;

  const group = await GroupBlock.findById(req.params.id);
  if (!group) return res.status(404).json({ success: false, error: 'Group block not found' });
  assertPropertyScope(req, group.property);

  if (['cancelled', 'completed'].includes(group.status)) {
    return res.status(400).json({ success: false, error: `Group is already ${group.status}` });
  }

  group.status = 'cancelled';
  group.cancelledAt = new Date();
  group.cancellationReason = reason || null;

  // Release all allotments
  for (const a of group.allotments) {
    a.released = a.blocked - a.picked;
  }
  group.releasedAt = new Date();
  await group.save();

  const a = actor(req);
  await audit({
    property: group.property,
    actor: a.id || null,
    actorName: a.name || 'system',
    action: 'group.cancelled',
    entityType: 'GroupBlock',
    entityId: group._id,
    after: { status: 'cancelled', reason },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: group });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/groups/:id/pickup — record pickup of rooms (reservation linked)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/pickup', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Recording pickup requires commercial permissions');
  const { roomTypeId, count = 1 } = req.body;

  if (!roomTypeId) return res.status(400).json({ success: false, error: 'roomTypeId is required' });

  const group = await GroupBlock.findById(req.params.id);
  if (!group) return res.status(404).json({ success: false, error: 'Group block not found' });
  assertPropertyScope(req, group.property);

  if (!['confirmed', 'tentative'].includes(group.status)) {
    return res.status(400).json({ success: false, error: `Cannot pick up rooms for a ${group.status} group` });
  }

  const allotment = group.allotments.find(a => String(a.roomTypeId) === String(roomTypeId));
  if (!allotment) return res.status(404).json({ success: false, error: 'Room type not found in allotment' });

  const available = allotment.blocked - allotment.picked - allotment.released;
  if (Number(count) > available) {
    return res.status(409).json({ success: false, error: `Only ${available} rooms available for pickup` });
  }

  allotment.picked += Number(count);
  group.totalRoomsPicked = group.allotments.reduce((s, a) => s + a.picked, 0);
  group.totalRevenue += (allotment.negotiatedRate || 0) * Number(count) * (group.nights || 1);
  await group.save();

  res.json({ success: true, data: { allotment, totalPicked: group.totalRoomsPicked } });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/groups/:id/release — release unreserved rooms back to inventory
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/release', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Releasing group rooms requires manager permissions');
  const { roomTypeId } = req.body;

  const group = await GroupBlock.findById(req.params.id);
  if (!group) return res.status(404).json({ success: false, error: 'Group block not found' });
  assertPropertyScope(req, group.property);

  const allotments = roomTypeId
    ? group.allotments.filter(a => String(a.roomTypeId) === String(roomTypeId))
    : group.allotments;

  for (const a of allotments) {
    a.released = Math.max(a.released, a.blocked - a.picked);
  }
  group.releasedAt = new Date();
  await group.save();

  const a = actor(req);
  await audit({
    property: group.property,
    actor: a.id || null,
    actorName: a.name || 'system',
    action: 'group.rooms_released',
    entityType: 'GroupBlock',
    entityId: group._id,
    after: { roomTypeId: roomTypeId || 'all', releasedAt: group.releasedAt },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: group });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/groups/:id/reservations — list reservations linked to group
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/reservations', asyncHandler(async (req, res) => {
  const group = await GroupBlock.findById(req.params.id).lean();
  if (!group) return res.status(404).json({ success: false, error: 'Group block not found' });
  assertPropertyScope(req, group.property);

  const reservations = await Reservation.find({
    property: group.property,
    $or: [{ group: String(group._id) }, { groupCode: group.groupCode }],
  })
    .populate('primaryGuest', 'firstName lastName email phone')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .sort({ arrivalDate: 1 })
    .lean();

  const stats = {
    total: reservations.length,
    confirmed: reservations.filter(r => r.status === 'confirmed').length,
    inHouse: reservations.filter(r => r.status === 'in_house').length,
    checkedOut: reservations.filter(r => r.status === 'checked_out').length,
    cancelled: reservations.filter(r => r.status === 'cancelled').length,
    totalRevenue: reservations.filter(r => !['cancelled', 'no_show'].includes(r.status))
      .reduce((s, r) => s + (r.totalAmount || 0), 0),
  };

  res.json({ success: true, data: reservations, stats });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/groups/:id/pickup-report — allotment vs pickup vs release summary
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/pickup-report', asyncHandler(async (req, res) => {
  const group = await GroupBlock.findById(req.params.id)
    .populate('allotments.roomTypeId', 'name code')
    .lean();
  if (!group) return res.status(404).json({ success: false, error: 'Group block not found' });
  assertPropertyScope(req, group.property);

  const report = group.allotments.map(a => ({
    roomType: a.roomTypeId,
    blocked: a.blocked,
    picked: a.picked,
    released: a.released,
    available: Math.max(0, a.blocked - a.picked - a.released),
    pickupRate: a.blocked > 0 ? Math.round((a.picked / a.blocked) * 100) : 0,
    negotiatedRate: a.negotiatedRate,
    projectedRevenue: a.picked * (a.negotiatedRate || 0) * (group.nights || 1),
  }));

  const totals = {
    blocked: report.reduce((s, r) => s + r.blocked, 0),
    picked: report.reduce((s, r) => s + r.picked, 0),
    released: report.reduce((s, r) => s + r.released, 0),
    available: report.reduce((s, r) => s + r.available, 0),
    projectedRevenue: report.reduce((s, r) => s + r.projectedRevenue, 0),
    pickupRate: 0,
  };
  totals.pickupRate = totals.blocked > 0 ? Math.round((totals.picked / totals.blocked) * 100) : 0;

  res.json({
    success: true,
    data: {
      group: {
        name: group.name,
        groupCode: group.groupCode,
        arrivalDate: group.arrivalDate,
        departureDate: group.departureDate,
        nights: group.nights,
        status: group.status,
        cutoffDate: group.cutoffDate,
      },
      allotments: report,
      totals,
    },
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/groups/:id — only if tentative, no reservations
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Deleting group blocks requires manager permissions');

  const group = await GroupBlock.findById(req.params.id);
  if (!group) return res.status(404).json({ success: false, error: 'Group block not found' });
  assertPropertyScope(req, group.property);

  if (group.status !== 'tentative') {
    return res.status(400).json({ success: false, error: 'Only tentative group blocks can be deleted. Cancel instead.' });
  }

  const linkedCount = await Reservation.countDocuments({
    $or: [{ group: String(group._id) }, { groupCode: group.groupCode }],
    status: { $nin: ['cancelled'] },
  });
  if (linkedCount > 0) {
    return res.status(409).json({ success: false, error: `Cannot delete: ${linkedCount} active reservations linked to this group` });
  }

  await GroupBlock.deleteOne({ _id: group._id });

  const a = actor(req);
  await audit({
    property: group.property,
    actor: a.id || null,
    actorName: a.name || 'system',
    action: 'group.deleted',
    entityType: 'GroupBlock',
    entityId: group._id,
    before: group.toObject(),
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: { deleted: true } });
}));

export default router;
