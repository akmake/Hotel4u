import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import { createMaintenanceTicket, resolveMaintenanceTicket } from '../services/roomService.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, status } = req.query;
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
  const { propertyId, roomId, category, description, priority, blocksRoom } = req.body;
  const ticket = await createMaintenanceTicket({ propertyId, roomId, category, description, priority, blocksRoom, actorId: null });
  res.status(201).json({ success: true, data: ticket });
}));

router.patch('/:id/assign', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const ticket = await MaintenanceTicket.findByIdAndUpdate(req.params.id, { assignedTo: userId, status: 'assigned' }, { new: true });
  res.json({ success: true, data: ticket });
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status, propertyId } = req.body;
  if (status === 'resolved') {
    const ticket = await resolveMaintenanceTicket({ ticketId: req.params.id, propertyId, actorId: null, actorName: 'system', ip: req.ip });
    return res.json({ success: true, data: ticket });
  }
  const ticket = await MaintenanceTicket.findByIdAndUpdate(req.params.id, { status }, { new: true });
  res.json({ success: true, data: ticket });
}));

export default router;
