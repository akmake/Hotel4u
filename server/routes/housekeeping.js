import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Reservation from '../models/Reservation.js';
import User from '../models/User.js';
import { completeHkTask, inspectRoom } from '../services/roomService.js';

const router = Router();

const HK_VIEW_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'housekeeping_manager',
  'housekeeper',
];
const HK_MANAGE_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'housekeeping_manager',
];
const HK_EXECUTE_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'housekeeping_manager',
  'housekeeper',
];

const TASK_POPULATE = [
  { path: 'room', select: 'number floor cleanStatus opsStatus occStatus' },
  { path: 'assignedTo', select: 'firstName lastName' },
  { path: 'reservation', select: 'confirmationNumber primaryGuest isVip' },
  { path: 'issueReported.ticketId', select: 'status category' },
];

function requirePropertyScope(req, explicitPropertyId) {
  const propertyId = explicitPropertyId || req.query.propertyId || req.body.propertyId || req.actor?.propertyId;
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}

async function findTaskInScope(req, taskId) {
  const task = await HousekeepingTask.findById(taskId);
  if (!task) return null;
  assertPropertyScope(req, String(task.property));
  return task;
}

// GET /api/housekeeping
router.get('/', asyncHandler(async (req, res) => {
  requireRoles(req, HK_VIEW_ROLES);

  const propertyId = requirePropertyScope(req);
  const { date, status, priority, assignedTo, dnd, noService } = req.query;
  const today = new Date().toISOString().split('T')[0];

  const filter = { property: propertyId, date: date || today };
  if (status) filter.status = { $in: status.split(',') };
  if (priority) filter.priority = priority;
  if (assignedTo) filter.assignedTo = assignedTo;
  if (dnd === 'true') filter.isDND = true;
  if (noService === 'true') filter.isNoService = true;

  const tasks = await HousekeepingTask.find(filter)
    .populate(TASK_POPULATE)
    .sort({ priority: 1, dueTime: 1 })
    .lean();

  res.json({ success: true, data: tasks });
}));

// GET /api/housekeeping/staff-summary
router.get('/staff-summary', asyncHandler(async (req, res) => {
  requireRoles(req, HK_VIEW_ROLES);

  const propertyId = requirePropertyScope(req);
  const today = new Date().toISOString().split('T')[0];
  const date = req.query.date || today;

  const tasks = await HousekeepingTask.find({ property: propertyId, date })
    .populate('assignedTo', 'firstName lastName')
    .lean();

  const map = {};
  tasks.forEach((task) => {
    if (!task.assignedTo) return;
    const key = String(task.assignedTo._id);
    if (!map[key]) {
      map[key] = { user: task.assignedTo, total: 0, done: 0, inProgress: 0, paused: 0 };
    }

    map[key].total += 1;
    if (task.status === 'completed' || task.status === 'inspected') map[key].done += 1;
    else if (task.status === 'in_progress') map[key].inProgress += 1;
    else if (task.status === 'paused') map[key].paused += 1;
  });

  const unassigned = tasks.filter((task) => !task.assignedTo).length;
  res.json({ success: true, data: { staff: Object.values(map), unassigned } });
}));

// POST /api/housekeeping/generate
router.post('/generate', asyncHandler(async (req, res) => {
  requireRoles(req, HK_MANAGE_ROLES);

  const propertyId = requirePropertyScope(req);
  const today = req.body.date || new Date().toISOString().split('T')[0];

  const checkouts = await Reservation.find({
    property: propertyId,
    departureDate: today,
    status: { $in: ['in_house', 'checked_out'] },
  }).populate('assignedRoom').lean();

  const stayovers = await Reservation.find({
    property: propertyId,
    status: 'in_house',
    arrivalDate: { $lt: today },
    departureDate: { $gt: today },
  }).populate('assignedRoom').lean();

  const toCreate = [];

  for (const reservation of checkouts) {
    if (!reservation.assignedRoom) continue;
    const exists = await HousekeepingTask.exists({
      property: propertyId,
      room: reservation.assignedRoom._id,
      date: today,
      type: 'checkout_clean',
    });
    if (!exists) {
      toCreate.push({
        property: propertyId,
        room: reservation.assignedRoom._id,
        reservation: reservation._id,
        type: 'checkout_clean',
        priority: 'high',
        date: today,
        autoCreated: true,
      });
    }
  }

  for (const reservation of stayovers) {
    if (!reservation.assignedRoom) continue;
    const exists = await HousekeepingTask.exists({
      property: propertyId,
      room: reservation.assignedRoom._id,
      date: today,
      type: 'stayover',
    });
    if (!exists) {
      toCreate.push({
        property: propertyId,
        room: reservation.assignedRoom._id,
        reservation: reservation._id,
        type: 'stayover',
        priority: 'medium',
        date: today,
        autoCreated: true,
      });
    }
  }

  const created = toCreate.length ? await HousekeepingTask.insertMany(toCreate) : [];

  res.json({
    success: true,
    data: { created: created.length, checkouts: checkouts.length, stayovers: stayovers.length },
  });
}));

// POST /api/housekeeping/auto-assign
router.post('/auto-assign', asyncHandler(async (req, res) => {
  requireRoles(req, HK_MANAGE_ROLES);

  const propertyId = requirePropertyScope(req);
  const today = req.body.date || new Date().toISOString().split('T')[0];

  const staff = await User.find({
    property: propertyId,
    role: { $in: ['housekeeper', 'housekeeping_manager'] },
    active: true,
  }).lean();

  if (!staff.length) {
    return res.status(400).json({ success: false, error: 'No active housekeeping staff found' });
  }

  const unassigned = await HousekeepingTask.find({
    property: propertyId,
    date: today,
    status: 'new',
    assignedTo: null,
  }).sort({ priority: 1 });

  let index = 0;
  for (const task of unassigned) {
    task.assignedTo = staff[index % staff.length]._id;
    task.status = 'assigned';
    task.assignedAt = new Date();
    await task.save();
    index += 1;
  }

  res.json({ success: true, data: { assigned: unassigned.length, staffCount: staff.length } });
}));

// PATCH /api/housekeeping/:id/assign
router.patch('/:id/assign', asyncHandler(async (req, res) => {
  requireRoles(req, HK_MANAGE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  const { userId } = req.body;
  if (userId) {
    const user = await User.findById(userId).lean();
    if (!user) return res.status(400).json({ success: false, error: 'Assigned user not found' });
    if (String(user.property) !== String(task.property)) {
      return res.status(400).json({ success: false, error: 'Assigned user must belong to the same property' });
    }
  }

  task.assignedTo = userId || null;
  task.status = userId ? 'assigned' : 'new';
  task.assignedAt = userId ? new Date() : null;
  await task.save();

  await task.populate(TASK_POPULATE);
  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/start
router.patch('/:id/start', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  task.status = 'in_progress';
  task.startedAt = new Date();
  await task.save();
  await task.populate(TASK_POPULATE);

  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/pause
router.patch('/:id/pause', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  task.status = 'paused';
  task.pausedAt = new Date();
  task.pauseReason = req.body.reason;
  await task.save();
  await task.populate(TASK_POPULATE);

  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/cancel
router.patch('/:id/cancel', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  task.status = 'cancelled';
  task.cancelledAt = new Date();
  task.cancelReason = req.body.reason;
  await task.save();
  await task.populate(TASK_POPULATE);

  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/resume
router.patch('/:id/resume', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  task.status = 'in_progress';
  task.pausedAt = null;
  task.pauseReason = null;
  await task.save();
  await task.populate(TASK_POPULATE);

  res.json({ success: true, data: task });
}));

// POST /api/housekeeping/:id/complete
router.post('/:id/complete', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  const completed = await completeHkTask({
    taskId: req.params.id,
    propertyId: String(task.property),
    actorId: req.actor?.id || null,
    actorName: req.actor?.name || 'system',
    ip: req.ip,
  });

  res.json({ success: true, data: completed });
}));

// POST /api/housekeeping/:id/inspect
router.post('/:id/inspect', asyncHandler(async (req, res) => {
  requireRoles(req, HK_MANAGE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  const inspected = await inspectRoom({
    taskId: req.params.id,
    approved: req.body.approved,
    notes: req.body.notes,
    propertyId: String(task.property),
    actorId: req.actor?.id || null,
    actorName: req.actor?.name || 'system',
    ip: req.ip,
  });

  res.json({ success: true, data: inspected });
}));

// PATCH /api/housekeeping/:id/dnd
router.patch('/:id/dnd', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  const isDND = !!req.body.isDND;
  task.isDND = isDND;
  task.status = isDND ? 'cancelled' : 'new';
  task.cancelReason = isDND ? 'DND - guest does not want service' : null;
  await task.save();
  await task.populate(TASK_POPULATE);

  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/no-service
router.patch('/:id/no-service', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  const isNoService = !!req.body.isNoService;
  task.isNoService = isNoService;
  task.status = isNoService ? 'cancelled' : 'new';
  task.cancelReason = isNoService ? 'No Service - guest declined service' : null;
  await task.save();
  await task.populate(TASK_POPULATE);

  res.json({ success: true, data: task });
}));

// POST /api/housekeeping/:id/report-issue
router.post('/:id/report-issue', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  const { description, category = 'other', priority = 'medium' } = req.body;
  if (!description?.trim()) {
    return res.status(400).json({ success: false, error: 'description is required' });
  }

  const ticket = await MaintenanceTicket.create({
    property: task.property,
    room: task.room,
    category,
    description: description.trim(),
    priority,
    status: 'new',
  });

  task.issueReported = {
    description: description.trim(),
    reportedAt: new Date(),
    ticketId: ticket._id,
  };
  await task.save();
  await task.populate(TASK_POPULATE);

  res.json({ success: true, data: { task, ticket } });
}));

// POST /api/housekeeping/:id/lost-found
router.post('/:id/lost-found', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  const { itemDescription, foundLocation, reportedBy } = req.body;
  if (!itemDescription?.trim()) {
    return res.status(400).json({ success: false, error: 'itemDescription is required' });
  }

  task.lostFound = task.lostFound || [];
  task.lostFound.push({
    itemDescription: itemDescription.trim(),
    foundLocation,
    reportedBy: reportedBy || req.actor?.name || 'system',
    reportedAt: new Date(),
  });

  await task.save();
  await task.populate(TASK_POPULATE);

  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/lost-found/:itemId
router.patch('/:id/lost-found/:itemId', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  const item = task.lostFound.id(req.params.itemId);
  if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

  item.status = req.body.status;
  await task.save();

  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/supplies
router.patch('/:id/supplies', asyncHandler(async (req, res) => {
  requireRoles(req, HK_EXECUTE_ROLES);

  const task = await findTaskInScope(req, req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  task.supplies = req.body.supplies;
  await task.save();
  await task.populate(TASK_POPULATE);

  res.json({ success: true, data: task });
}));

export default router;
