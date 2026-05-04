import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import { completeHkTask, inspectRoom } from '../services/roomService.js';
import { audit } from '../services/auditService.js';

const router = Router();

const TASK_POPULATE = [
  { path: 'room',        select: 'number floor cleanStatus opsStatus occStatus' },
  { path: 'assignedTo',  select: 'firstName lastName' },
  { path: 'reservation', select: 'confirmationNumber primaryGuest isVip' },
  { path: 'issueReported.ticketId', select: 'status category' },
];

// GET /api/housekeeping
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, date, status, priority, assignedTo, dnd, noService } = req.query;
  const today  = new Date().toISOString().split('T')[0];
  const filter = { property: propertyId, date: date || today };
  if (status)     filter.status    = { $in: status.split(',') };
  if (priority)   filter.priority  = priority;
  if (assignedTo) filter.assignedTo= assignedTo;
  if (dnd === 'true')       filter.isDND      = true;
  if (noService === 'true') filter.isNoService= true;

  const tasks = await HousekeepingTask.find(filter)
    .populate(TASK_POPULATE)
    .sort({ priority: 1, dueTime: 1 })
    .lean();
  res.json({ success: true, data: tasks });
}));

// GET /api/housekeeping/staff-summary — workload per user
router.get('/staff-summary', asyncHandler(async (req, res) => {
  const { propertyId, date } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const tasks = await HousekeepingTask.find({ property: propertyId, date: date || today })
    .populate('assignedTo', 'firstName lastName').lean();

  const map = {};
  tasks.forEach(t => {
    if (!t.assignedTo) return;
    const k = String(t.assignedTo._id);
    if (!map[k]) map[k] = { user: t.assignedTo, total: 0, done: 0, inProgress: 0, paused: 0 };
    map[k].total++;
    if (t.status === 'completed' || t.status === 'inspected') map[k].done++;
    else if (t.status === 'in_progress') map[k].inProgress++;
    else if (t.status === 'paused')      map[k].paused++;
  });
  const unassigned = tasks.filter(t => !t.assignedTo).length;
  res.json({ success: true, data: { staff: Object.values(map), unassigned } });
}));

// POST /api/housekeeping/generate — create tasks for all checkout/stayover rooms
router.post('/generate', asyncHandler(async (req, res) => {
  const { propertyId, date } = req.body;
  const today = date || new Date().toISOString().split('T')[0];

  // Checkout rooms (due out today)
  const checkouts = await Reservation.find({ property: propertyId, departureDate: today, status: { $in: ['in_house','checked_out'] } }).populate('assignedRoom').lean();
  // Stayovers (in_house, not due out)
  const stayovers = await Reservation.find({ property: propertyId, status: 'in_house', arrivalDate: { $lt: today }, departureDate: { $gt: today } }).populate('assignedRoom').lean();

  const created = [];
  const toCreate = [];

  for (const res of checkouts) {
    if (!res.assignedRoom) continue;
    const exists = await HousekeepingTask.exists({ property: propertyId, room: res.assignedRoom._id, date: today, type: 'checkout_clean' });
    if (!exists) toCreate.push({ property: propertyId, room: res.assignedRoom._id, reservation: res._id, type: 'checkout_clean', priority: 'high', date: today, autoCreated: true });
  }
  for (const res of stayovers) {
    if (!res.assignedRoom) continue;
    const exists = await HousekeepingTask.exists({ property: propertyId, room: res.assignedRoom._id, date: today, type: 'stayover' });
    if (!exists) toCreate.push({ property: propertyId, room: res.assignedRoom._id, reservation: res._id, type: 'stayover', priority: 'medium', date: today, autoCreated: true });
  }

  if (toCreate.length) {
    const docs = await HousekeepingTask.insertMany(toCreate);
    created.push(...docs);
  }
  res.json({ success: true, data: { created: created.length, checkouts: checkouts.length, stayovers: stayovers.length } });
}));

// POST /api/housekeeping/auto-assign — distribute unassigned tasks round-robin
router.post('/auto-assign', asyncHandler(async (req, res) => {
  const { propertyId, date } = req.body;
  const today = date || new Date().toISOString().split('T')[0];

  // Get housekeeping staff
  const staff = await User.find({ property: propertyId, role: { $in: ['housekeeper','housekeeping_manager'] }, active: true }).lean();
  if (!staff.length) return res.status(400).json({ success:false, error:'אין צוות חדרנות פעיל' });

  const unassigned = await HousekeepingTask.find({ property: propertyId, date: today, status: 'new', assignedTo: null }).sort({ priority: 1 });
  let idx = 0;
  for (const task of unassigned) {
    task.assignedTo = staff[idx % staff.length]._id;
    task.status     = 'assigned';
    task.assignedAt = new Date();
    await task.save();
    idx++;
  }
  res.json({ success: true, data: { assigned: unassigned.length, staffCount: staff.length } });
}));

// PATCH /api/housekeeping/:id/assign
router.patch('/:id/assign', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const task = await HousekeepingTask.findByIdAndUpdate(
    req.params.id,
    { assignedTo: userId || null, status: userId ? 'assigned' : 'new', assignedAt: userId ? new Date() : null },
    { new: true }
  ).populate(TASK_POPULATE);
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/start
router.patch('/:id/start', asyncHandler(async (req, res) => {
  const task = await HousekeepingTask.findByIdAndUpdate(
    req.params.id,
    { status: 'in_progress', startedAt: new Date() },
    { new: true }
  ).populate(TASK_POPULATE);
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/pause
router.patch('/:id/pause', asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const task = await HousekeepingTask.findByIdAndUpdate(
    req.params.id,
    { status: 'paused', pausedAt: new Date(), pauseReason: reason },
    { new: true }
  ).populate(TASK_POPULATE);
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/cancel
router.patch('/:id/cancel', asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const task = await HousekeepingTask.findByIdAndUpdate(
    req.params.id,
    { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
    { new: true }
  ).populate(TASK_POPULATE);
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/resume — resume paused task
router.patch('/:id/resume', asyncHandler(async (req, res) => {
  const task = await HousekeepingTask.findByIdAndUpdate(
    req.params.id,
    { status: 'in_progress', pausedAt: null, pauseReason: null },
    { new: true }
  ).populate(TASK_POPULATE);
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

// PATCH /api/housekeeping/:id/dnd — toggle DND flag
router.patch('/:id/dnd', asyncHandler(async (req, res) => {
  const { isDND } = req.body;
  const task = await HousekeepingTask.findByIdAndUpdate(req.params.id, { isDND: !!isDND, status: isDND ? 'cancelled' : 'new', cancelReason: isDND ? 'DND — אורח לא מעוניין בניקיון' : null }, { new: true }).populate(TASK_POPULATE);
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/no-service — guest declined service
router.patch('/:id/no-service', asyncHandler(async (req, res) => {
  const { isNoService } = req.body;
  const task = await HousekeepingTask.findByIdAndUpdate(req.params.id, { isNoService: !!isNoService, status: isNoService ? 'cancelled' : 'new', cancelReason: isNoService ? 'No Service — אורח ביטל ניקיון' : null }, { new: true }).populate(TASK_POPULATE);
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

// POST /api/housekeeping/:id/report-issue — report maintenance issue from room
router.post('/:id/report-issue', asyncHandler(async (req, res) => {
  const { description, category = 'other', priority = 'medium', propertyId } = req.body;
  const task = await HousekeepingTask.findById(req.params.id).populate('room');
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  if (!description?.trim()) return res.status(400).json({ success:false, error:'description required' });

  const ticket = await MaintenanceTicket.create({ property: task.property, room: task.room._id, category, description: description.trim(), priority, status: 'new' });

  task.issueReported = { description: description.trim(), reportedAt: new Date(), ticketId: ticket._id };
  await task.save();

  res.json({ success: true, data: { task, ticket } });
}));

// POST /api/housekeeping/:id/lost-found — report lost & found item
router.post('/:id/lost-found', asyncHandler(async (req, res) => {
  const { itemDescription, foundLocation, reportedBy } = req.body;
  if (!itemDescription?.trim()) return res.status(400).json({ success:false, error:'item description required' });
  const task = await HousekeepingTask.findByIdAndUpdate(
    req.params.id,
    { $push: { lostFound: { itemDescription: itemDescription.trim(), foundLocation, reportedBy, reportedAt: new Date() } } },
    { new: true }
  ).populate(TASK_POPULATE);
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/lost-found/:itemId — update lost-found status
router.patch('/:id/lost-found/:itemId', asyncHandler(async (req, res) => {
  const { status } = req.body;
  const task = await HousekeepingTask.findById(req.params.id);
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  const item = task.lostFound.id(req.params.itemId);
  if (!item) return res.status(404).json({ success:false, error:'פריט לא נמצא' });
  item.status = status;
  await task.save();
  res.json({ success: true, data: task });
}));

// PATCH /api/housekeeping/:id/supplies — update supplies list
router.patch('/:id/supplies', asyncHandler(async (req, res) => {
  const { supplies } = req.body; // [{ item, qty }]
  const task = await HousekeepingTask.findByIdAndUpdate(req.params.id, { supplies }, { new: true }).populate(TASK_POPULATE);
  if (!task) return res.status(404).json({ success:false, error:'משימה לא נמצאה' });
  res.json({ success: true, data: task });
}));

export default router;

