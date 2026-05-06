import mongoose from 'mongoose';
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import { createMaintenanceTicket, resolveMaintenanceTicket } from '../services/roomService.js';
import { fireEvent } from '../services/automationEngine.js';
import { actorOrSystem, assertPropertyScope, requireRoles } from '../middleware/authContext.js';

const router = Router();
const MAINTENANCE_ROLES = ['super_admin', 'property_admin', 'general_manager', 'maintenance_manager', 'technician', 'front_desk_manager'];

// GET /api/maintenance/stats?propertyId=
router.get('/stats', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const pid = new mongoose.Types.ObjectId(propertyId);
  const now = new Date();
  const openStatuses = { $nin: ['resolved', 'verified', 'closed'] };

  const [byStatus, byCategory, byPriority, overdueCount] = await Promise.all([
    MaintenanceTicket.aggregate([
      { $match: { property: pid } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    MaintenanceTicket.aggregate([
      { $match: { property: pid, status: openStatuses } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
    MaintenanceTicket.aggregate([
      { $match: { property: pid, status: openStatuses } },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]),
    MaintenanceTicket.countDocuments({
      property: propertyId,
      status: openStatuses,
      dueDate: { $ne: null, $lt: now },
    }),
  ]);

  res.json({ success: true, data: { byStatus, byCategory, byPriority, overdueCount } });
}));

// GET /api/maintenance?propertyId=&status=&category=&priority=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, status, category, priority } = req.query;
  assertPropertyScope(req, propertyId);
  const filter = { property: propertyId };
  if (status)   filter.status   = { $in: status.split(',') };
  if (category) filter.category = category;
  if (priority) filter.priority = priority;
  const tickets = await MaintenanceTicket.find(filter)
    .populate('room', 'number floor')
    .populate('assignedTo', 'firstName lastName')
    .populate('reportedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data: tickets });
}));

// GET /api/maintenance/:id — full ticket with notes populated
router.get('/:id', asyncHandler(async (req, res) => {
  const ticket = await MaintenanceTicket.findById(req.params.id)
    .populate('room', 'number floor')
    .populate('reportedBy', 'firstName lastName role')
    .populate('assignedTo', 'firstName lastName role')
    .lean();
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  assertPropertyScope(req, ticket.property);
  res.json({ success: true, data: ticket });
}));

// POST /api/maintenance
router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Opening maintenance ticket requires maintenance/front-desk permissions');
  const { propertyId, roomId, category, description, priority, blocksRoom, estimatedCost, notes } = req.body;
  assertPropertyScope(req, propertyId);
  const actor = actorOrSystem(req);
  const ticket = await createMaintenanceTicket({ propertyId, roomId, category, description, priority, blocksRoom, actorId: actor.id });
  if (estimatedCost != null) ticket.estimatedCost = Number(estimatedCost);
  if (notes?.trim()) ticket.notes = notes.trim();
  if (estimatedCost != null || notes?.trim()) await ticket.save();

  fireEvent('maintenance.created', {
    property: String(propertyId),
    ticket:   ticket?.toObject ? ticket.toObject() : ticket,
    room:     roomId ? { _id: String(roomId) } : null,
    actor:    { id: actor.id, name: actor.name },
  }).catch(() => null);

  res.status(201).json({ success: true, data: ticket });
}));

// PATCH /api/maintenance/:id/assign
router.patch('/:id/assign', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Assigning maintenance requires maintenance/front-desk permissions');
  const { userId } = req.body;
  const existing = await MaintenanceTicket.findById(req.params.id).lean();
  if (!existing) return res.status(404).json({ success: false, error: 'Ticket not found' });
  assertPropertyScope(req, existing.property);
  const update = { assignedTo: userId || null };
  if (userId && existing.status === 'new') update.status = 'assigned';
  const ticket = await MaintenanceTicket.findByIdAndUpdate(req.params.id, update, { new: true })
    .populate('assignedTo', 'firstName lastName');
  res.json({ success: true, data: ticket });
}));

// PATCH /api/maintenance/:id/status
router.patch('/:id/status', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Updating maintenance requires maintenance/front-desk permissions');
  const { status, propertyId } = req.body;
  assertPropertyScope(req, propertyId);
  const actor = actorOrSystem(req);

  if (status === 'resolved') {
    const ticket = await resolveMaintenanceTicket({ ticketId: req.params.id, propertyId, actorId: actor.id, actorName: actor.name, ip: req.ip });
    return res.json({ success: true, data: ticket });
  }

  const update = { status };
  if (status === 'in_progress') update.startedAt = new Date();
  if (status === 'reopened') update.resolvedAt = null;

  const ticket = await MaintenanceTicket.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  res.json({ success: true, data: ticket });
}));

// PATCH /api/maintenance/:id/priority
router.patch('/:id/priority', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Permission required');
  const { priority, propertyId } = req.body;
  assertPropertyScope(req, propertyId);
  const ticket = await MaintenanceTicket.findByIdAndUpdate(req.params.id, { priority }, { new: true });
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  res.json({ success: true, data: ticket });
}));

// PATCH /api/maintenance/:id/due
router.patch('/:id/due', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Permission required');
  const { dueDate, propertyId } = req.body;
  assertPropertyScope(req, propertyId);
  const ticket = await MaintenanceTicket.findByIdAndUpdate(
    req.params.id,
    { dueDate: dueDate ? new Date(dueDate) : null },
    { new: true }
  );
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  res.json({ success: true, data: ticket });
}));

// POST /api/maintenance/:id/notes
router.post('/:id/notes', asyncHandler(async (req, res) => {
  const { text, authorName } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'Note text required' });
  const ticket = await MaintenanceTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  assertPropertyScope(req, ticket.property);
  const actor = actorOrSystem(req);
  ticket.internalNotes.push({
    text: text.trim(),
    author: actor.id || undefined,
    authorName: authorName || actor.name || 'מערכת',
  });
  await ticket.save();
  res.json({ success: true, data: ticket });
}));

// POST /api/maintenance/:id/approve-close — manager approval for critical ticket closure (Ch. 22.4)
router.post('/:id/approve-close', asyncHandler(async (req, res) => {
  requireRoles(req, ['super_admin','property_admin','general_manager','maintenance_manager'], 'Approving critical ticket closure requires manager permissions');
  const ticket = await MaintenanceTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  assertPropertyScope(req, ticket.property);

  if (ticket.priority !== 'critical') {
    return res.status(400).json({ success: false, error: 'Only critical tickets require closing approval' });
  }
  if (!['resolved'].includes(ticket.status)) {
    return res.status(400).json({ success: false, error: 'Ticket must be resolved before closing approval' });
  }

  const actor = actorOrSystem(req);
  ticket.closingApprovedBy = actor.id || undefined;
  ticket.closingApprovedAt = new Date();
  ticket.status = 'verified';
  await ticket.save();

  res.json({ success: true, data: ticket });
}));

// POST /api/maintenance/:id/photos — attach photo URLs to ticket
router.post('/:id/photos', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Permission required');
  const { url, caption } = req.body;
  if (!url?.trim()) return res.status(400).json({ success: false, error: 'url is required' });

  const ticket = await MaintenanceTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  assertPropertyScope(req, ticket.property);

  const actor = actorOrSystem(req);
  ticket.photos.push({ url: url.trim(), caption: caption?.trim() || undefined, uploadedBy: actor.id || undefined });
  await ticket.save();

  res.json({ success: true, data: ticket.photos });
}));

// PATCH /api/maintenance/:id/parts — update parts-needed list
router.patch('/:id/parts', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Permission required');
  const { parts } = req.body;
  if (!Array.isArray(parts)) return res.status(400).json({ success: false, error: 'parts must be an array' });

  const ticket = await MaintenanceTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  assertPropertyScope(req, ticket.property);

  ticket.partsNeeded = parts;
  await ticket.save();

  res.json({ success: true, data: ticket.partsNeeded });
}));

// PATCH /api/maintenance/:id/vendor — set vendor contact
router.patch('/:id/vendor', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Permission required');
  const { name, phone, email } = req.body;
  const ticket = await MaintenanceTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  assertPropertyScope(req, ticket.property);

  ticket.vendorContact = { name, phone, email };
  await ticket.save();

  res.json({ success: true, data: ticket.vendorContact });
}));

export default router;
