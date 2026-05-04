import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import { completeHkTask, inspectRoom } from '../services/roomService.js';

const router = Router();

// GET /api/housekeeping?propertyId=&date=&status=&assignedTo=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, date, status, priority, assignedTo } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const filter = { property: propertyId, date: date || today };
  if (status)     filter.status = { $in: status.split(',') };
  if (priority)   filter.priority = priority;
  if (assignedTo) filter.assignedTo = assignedTo;

  const tasks = await HousekeepingTask.find(filter)
    .populate('room', 'number floor cleanStatus opsStatus occStatus')
    .populate('assignedTo', 'firstName lastName')
    .populate('reservation', 'confirmationNumber primaryGuest isVip')
    .sort({ priority: 1, dueTime: 1 })
    .lean();

  res.json({ success: true, data: tasks });
}));

// PATCH /api/housekeeping/:id/assign
router.patch('/:id/assign', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const task = await HousekeepingTask.findByIdAndUpdate(
    req.params.id,
    { assignedTo: userId, status: 'assigned', assignedAt: new Date() },
    { new: true }
  ).populate('room', 'number').populate('assignedTo', 'firstName lastName');
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/start
router.patch('/:id/start', asyncHandler(async (req, res) => {
  const task = await HousekeepingTask.findByIdAndUpdate(
    req.params.id,
    { status: 'in_progress', startedAt: new Date() },
    { new: true }
  );
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

// POST /api/housekeeping/:id/complete
router.post('/:id/complete', asyncHandler(async (req, res) => {
  const { propertyId } = req.body;
  const task = await completeHkTask({ taskId: req.params.id, propertyId, actorId: null, actorName: 'system', ip: req.ip });
  res.json({ success: true, data: task });
}));

// POST /api/housekeeping/:id/inspect
router.post('/:id/inspect', asyncHandler(async (req, res) => {
  const { approved, notes, propertyId } = req.body;
  const task = await inspectRoom({ taskId: req.params.id, approved, notes, propertyId, actorId: null, actorName: 'system', ip: req.ip });
  res.json({ success: true, data: task });
}));

export default router;
