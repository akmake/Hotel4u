import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Room from '../models/Room.js';
import { updateCleanStatus, updateOpsStatus } from '../services/roomService.js';
import { actorOrSystem, assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import { fireEvent } from '../services/automationEngine.js';

const router = Router();
const ROOM_MANAGER_ROLES = ['super_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'housekeeping_manager', 'maintenance_manager'];

// GET /api/rooms?propertyId=&floor=&type=&opsStatus=&cleanStatus=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, floor, type, opsStatus, cleanStatus } = req.query;
  assertPropertyScope(req, propertyId);
  const filter = { property: propertyId, active: true };
  if (floor) filter.floor = Number(floor);
  if (opsStatus) filter.opsStatus = opsStatus;
  if (cleanStatus) filter.cleanStatus = cleanStatus;

  const rooms = await Room.find(filter)
    .populate('roomType', 'name code baseRate')
    .populate('connectingRoom', 'number')
    .populate('preferredAlternateRoom', 'number floor')
    .sort({ number: 1 })
    .lean();

  const filtered = type
    ? rooms.filter((r) => r.roomType?.code?.toLowerCase() === String(type).toLowerCase())
    : rooms;

  res.json({ success: true, data: filtered });
}));

// GET /api/rooms/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const room = await Room.findById(req.params.id)
    .populate('roomType')
    .populate('connectingRoom', 'number floor')
    .populate('preferredAlternateRoom', 'number floor')
    .lean();

  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
  assertPropertyScope(req, room.property?._id || room.property);
  res.json({ success: true, data: room });
}));

// POST /api/rooms
router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, ROOM_MANAGER_ROLES, 'Room management requires manager permissions');
  const {
    propertyId,
    roomTypeId,
    number,
    floor,
    building,
    wing,
    housekeepingZone,
    maintenanceArea,
    isVip,
    isSmoking,
    isAccessible,
    internalNotes,
    connectingRoom,
    preferredAlternateRoom,
    lastRenovatedAt,
    opsStatus,
    outOfServiceUntil,
    cleanStatus,
    occStatus,
  } = req.body;

  if (!propertyId || !roomTypeId || !number || floor === undefined) {
    return res.status(400).json({ success: false, error: 'Required: propertyId, roomTypeId, number, floor' });
  }
  assertPropertyScope(req, propertyId);

  const room = await Room.create({
    property: propertyId,
    roomType: roomTypeId,
    number: String(number),
    floor: Number(floor),
    building: building || undefined,
    wing: wing || undefined,
    housekeepingZone: housekeepingZone || undefined,
    maintenanceArea: maintenanceArea || undefined,
    isVip: !!isVip,
    isSmoking: !!isSmoking,
    isAccessible: !!isAccessible,
    internalNotes: internalNotes || undefined,
    connectingRoom: connectingRoom || undefined,
    preferredAlternateRoom: preferredAlternateRoom || undefined,
    lastRenovatedAt: lastRenovatedAt || undefined,
    opsStatus: opsStatus || 'available',
    outOfServiceUntil: outOfServiceUntil || undefined,
    cleanStatus: cleanStatus || 'clean',
    occStatus: occStatus || 'vacant',
  });

  const populated = await Room.findById(room._id)
    .populate('roomType', 'name code')
    .populate('preferredAlternateRoom', 'number floor')
    .lean();

  res.status(201).json({ success: true, data: populated });
}));

// PATCH /api/rooms/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, ROOM_MANAGER_ROLES, 'Room management requires manager permissions');
  const allowed = [
    'number',
    'floor',
    'building',
    'wing',
    'roomType',
    'housekeepingZone',
    'maintenanceArea',
    'isVip',
    'isSmoking',
    'isAccessible',
    'internalNotes',
    'connectingRoom',
    'preferredAlternateRoom',
    'lastRenovatedAt',
    'active',
    'outOfServiceUntil',
  ];

  const update = {};
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  });

  const existing = await Room.findById(req.params.id).lean();
  if (!existing) return res.status(404).json({ success: false, error: 'Room not found' });
  assertPropertyScope(req, existing.property);
  const room = await Room.findByIdAndUpdate(req.params.id, update, { new: true })
    .populate('roomType', 'name code')
    .populate('preferredAlternateRoom', 'number floor')
    .lean();

  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
  res.json({ success: true, data: room });
}));

// DELETE /api/rooms/:id (soft delete)
router.delete('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, ROOM_MANAGER_ROLES, 'Room management requires manager permissions');
  const existing = await Room.findById(req.params.id).lean();
  if (!existing) return res.status(404).json({ success: false, error: 'Room not found' });
  assertPropertyScope(req, existing.property);
  const room = await Room.findByIdAndUpdate(req.params.id, { active: false }, { new: true }).lean();
  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
  res.json({ success: true, data: room });
}));

// PATCH /api/rooms/:id/clean-status
router.patch('/:id/clean-status', asyncHandler(async (req, res) => {
  requireRoles(req, ROOM_MANAGER_ROLES, 'Changing room status requires manager permissions');
  const { cleanStatus, propertyId } = req.body;
  assertPropertyScope(req, propertyId);
  // Same gates as /api/pms/ops (OPS-03): "inspected" only comes from an inspection, "cleaning" only
  // from a started task, and the room must belong to the property in scope.
  if (cleanStatus === 'inspected') return res.status(422).json({ success: false, error: 'סטטוס "נבדק" נקבע רק בבדיקת חדר (חדרנות ← בדיקת חדרים)' });
  if (!['clean', 'dirty', 'pickup', 'turndown_required'].includes(cleanStatus)) return res.status(422).json({ success: false, error: 'סטטוס ניקיון לא מוכר' });
  const inScope = await Room.exists({ _id: req.params.id, property: propertyId });
  if (!inScope) return res.status(404).json({ success: false, error: 'Room not found' });
  const actor = actorOrSystem(req);
  const room = await updateCleanStatus({
    roomId: req.params.id,
    cleanStatus,
    propertyId,
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });
  fireEvent('room.status_changed', {
    property: String(propertyId),
    room:     { _id: String(room._id), number: room.number, cleanStatus: room.cleanStatus, opsStatus: room.opsStatus },
    changedField: 'cleanStatus',
    newValue: cleanStatus,
  }).catch(() => null);
  res.json({ success: true, data: room });
}));

// PATCH /api/rooms/:id/ops-status
router.patch('/:id/ops-status', asyncHandler(async (req, res) => {
  requireRoles(req, ROOM_MANAGER_ROLES, 'Changing room status requires manager permissions');
  const { opsStatus, outOfServiceUntil, reason, propertyId } = req.body;
  assertPropertyScope(req, propertyId);
  const inScope = await Room.exists({ _id: req.params.id, property: propertyId });
  if (!inScope) return res.status(404).json({ success: false, error: 'Room not found' });
  const actor = actorOrSystem(req);
  const room = await updateOpsStatus({
    roomId: req.params.id,
    opsStatus,
    outOfServiceUntil,
    reason,
    propertyId,
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });
  fireEvent('room.status_changed', {
    property: String(propertyId),
    room:     { _id: String(room._id), number: room.number, cleanStatus: room.cleanStatus, opsStatus: room.opsStatus },
    changedField: 'opsStatus',
    newValue:     opsStatus,
  }).catch(() => null);
  res.json({ success: true, data: room });
}));

export default router;
