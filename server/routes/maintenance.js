import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import { createMaintenanceTicket, resolveMaintenanceTicket } from '../services/roomService.js';
import { actorOrSystem, assertPropertyScope, requireRoles } from '../middleware/authContext.js';

const router = Router();
const MAINTENANCE_ROLES = ['super_admin', 'property_admin', 'general_manager', 'maintenance_manager', 'technician', 'front_desk_manager'];

router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, status } = req.query;
  assertPropertyScope(req, propertyId);
  const filter = { property: propertyId };
  if (status) filter.status = { $in: status.split(',') };
  const tickets = await MaintenanceTicket.find(filter)
    .populate('room', 'number floor')
    .populate('assignedTo', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data: tickets });
}));

router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Opening maintenance ticket requires maintenance/front-desk permissions');
  const { propertyId, roomId, category, description, priority, blocksRoom } = req.body;
  assertPropertyScope(req, propertyId);
  const actor = actorOrSystem(req);
  const ticket = await createMaintenanceTicket({ propertyId, roomId, category, description, priority, blocksRoom, actorId: actor.id });
  res.status(201).json({ success: true, data: ticket });
}));

router.patch('/:id/assign', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Assigning maintenance requires maintenance/front-desk permissions');
  const { userId } = req.body;
  const existing = await MaintenanceTicket.findById(req.params.id).lean();
  if (!existing) return res.status(404).json({ success: false, error: 'Ticket not found' });
  assertPropertyScope(req, existing.property);
  const ticket = await MaintenanceTicket.findByIdAndUpdate(req.params.id, { assignedTo: userId, status: 'assigned' }, { new: true });
  res.json({ success: true, data: ticket });
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
  requireRoles(req, MAINTENANCE_ROLES, 'Updating maintenance requires maintenance/front-desk permissions');
  const { status, propertyId } = req.body;
  assertPropertyScope(req, propertyId);
  const actor = actorOrSystem(req);
  if (status === 'resolved') {
    const ticket = await resolveMaintenanceTicket({ ticketId: req.params.id, propertyId, actorId: actor.id, actorName: actor.name, ip: req.ip });
    return res.json({ success: true, data: ticket });
  }
  const ticket = await MaintenanceTicket.findByIdAndUpdate(req.params.id, { status }, { new: true });
  res.json({ success: true, data: ticket });
}));

export default router;
