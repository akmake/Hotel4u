// Ch. 29 — Guest Requests
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles, actorOrSystem } from '../middleware/authContext.js';
import { audit } from '../services/auditService.js';
import GuestRequest, { GR_CATEGORIES, GR_PRIORITIES, GR_STATUSES } from '../models/GuestRequest.js';

const router = Router();

const FRONT_DESK_ROLES = ['super_admin','property_admin','general_manager','front_desk_manager','receptionist','cashier'];
const MANAGER_ROLES    = ['super_admin','property_admin','general_manager','front_desk_manager'];

// ── GET /api/guest-requests?propertyId=&status=&category=&assignedTo=&roomId=&page=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, status, category, assignedTo, roomId, reservationId, overdue, page = 1, limit = 50 } = req.query;
  assertPropertyScope(req, propertyId);

  const filter = { property: propertyId };
  if (status)        filter.status = { $in: String(status).split(',') };
  if (category)      filter.category = category;
  if (assignedTo)    filter.assignedTo = assignedTo;
  if (roomId)        filter.room = roomId;
  if (reservationId) filter.reservation = reservationId;
  if (overdue === 'true') filter.dueAt = { $lt: new Date() };

  const total = await GuestRequest.countDocuments(filter);
  const requests = await GuestRequest.find(filter)
    .sort({ priority: -1, createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .populate('room', 'number floor')
    .populate('guest', 'firstName lastName vipLevel')
    .populate('assignedTo', 'firstName lastName')
    .populate('reservation', 'confirmationNumber')
    .lean();

  res.json({ success: true, data: requests, total, page: Number(page), limit: Number(limit) });
}));

// ── GET /api/guest-requests/stats?propertyId=
router.get('/stats', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);

  const [byStatus, byCategory, overdue, openTotal] = await Promise.all([
    GuestRequest.aggregate([
      { $match: { property: req.property || undefined } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).exec().catch(() => []),
    GuestRequest.aggregate([
      { $match: { property: req.property || undefined } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]).exec().catch(() => []),
    GuestRequest.countDocuments({ property: propertyId, dueAt: { $lt: new Date() }, status: { $nin: ['resolved','closed','cancelled'] } }),
    GuestRequest.countDocuments({ property: propertyId, status: { $in: ['open','assigned','in_progress'] } }),
  ]);

  res.json({ success: true, data: { byStatus, byCategory, overdue, openTotal } });
}));

// ── GET /api/guest-requests/meta — enums
router.get('/meta', (req, res) => {
  res.json({ success: true, data: { categories: GR_CATEGORIES, priorities: GR_PRIORITIES, statuses: GR_STATUSES } });
});

// ── GET /api/guest-requests/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const gr = await GuestRequest.findById(req.params.id)
    .populate('room', 'number floor cleanStatus')
    .populate('guest', 'firstName lastName phone email vipLevel')
    .populate('assignedTo', 'firstName lastName role')
    .populate('reservation', 'confirmationNumber arrivalDate departureDate')
    .lean();
  if (!gr) return res.status(404).json({ success: false, error: 'Request not found' });
  assertPropertyScope(req, gr.property);
  res.json({ success: true, data: gr });
}));

// ── POST /api/guest-requests — create
router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, FRONT_DESK_ROLES, 'Creating guest requests requires front-desk permissions');
  const { propertyId, reservationId, roomId, guestId, category, description, priority, slaMinutes, department } = req.body;
  assertPropertyScope(req, propertyId);

  if (!category || !GR_CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, error: `Invalid category. Must be one of: ${GR_CATEGORIES.join(', ')}` });
  }
  if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description is required' });

  const a = actorOrSystem(req);
  const gr = await GuestRequest.create({
    property:    propertyId,
    reservation: reservationId || undefined,
    room:        roomId || undefined,
    guest:       guestId || undefined,
    category,
    description: description.trim(),
    priority:    priority || 'medium',
    slaMinutes:  slaMinutes || 30,
    department:  department || undefined,
    createdBy:   a.id || undefined,
    updatedBy:   a.id || undefined,
  });

  await audit({ property: propertyId, actor: a.id, actorName: a.name, action: 'guest_request.created', entityType: 'GuestRequest', entityId: gr._id, after: gr.toObject(), ip: req.ip }).catch(() => null);
  res.status(201).json({ success: true, data: gr });
}));

// ── PATCH /api/guest-requests/:id/assign
router.patch('/:id/assign', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Assigning requests requires manager permissions');
  const { userId, department } = req.body;
  const gr = await GuestRequest.findById(req.params.id);
  if (!gr) return res.status(404).json({ success: false, error: 'Request not found' });
  assertPropertyScope(req, gr.property);

  gr.assignedTo  = userId || undefined;
  gr.department  = department || gr.department;
  gr.assignedAt  = new Date();
  gr.status      = 'assigned';
  const a = actorOrSystem(req);
  gr.updatedBy   = a.id || undefined;
  await gr.save();

  await audit({ property: gr.property, actor: a.id, actorName: a.name, action: 'guest_request.assigned', entityType: 'GuestRequest', entityId: gr._id, after: { assignedTo: userId, status: gr.status }, ip: req.ip }).catch(() => null);
  res.json({ success: true, data: gr });
}));

// ── PATCH /api/guest-requests/:id/start
router.patch('/:id/start', asyncHandler(async (req, res) => {
  const gr = await GuestRequest.findById(req.params.id);
  if (!gr) return res.status(404).json({ success: false, error: 'Request not found' });
  assertPropertyScope(req, gr.property);
  if (!['open','assigned'].includes(gr.status)) return res.status(400).json({ success: false, error: 'Cannot start request in current status' });

  gr.status    = 'in_progress';
  const a = actorOrSystem(req);
  gr.updatedBy = a.id || undefined;
  await gr.save();
  res.json({ success: true, data: gr });
}));

// ── POST /api/guest-requests/:id/resolve
router.post('/:id/resolve', asyncHandler(async (req, res) => {
  const { resolutionNotes, satisfactionScore } = req.body;
  const gr = await GuestRequest.findById(req.params.id);
  if (!gr) return res.status(404).json({ success: false, error: 'Request not found' });
  assertPropertyScope(req, gr.property);
  if (['resolved','closed','cancelled'].includes(gr.status)) return res.status(400).json({ success: false, error: 'Request already closed' });

  const a = actorOrSystem(req);
  gr.status          = 'resolved';
  gr.resolvedAt      = new Date();
  gr.resolutionNotes = resolutionNotes?.trim() || undefined;
  if (satisfactionScore) gr.satisfactionScore = Number(satisfactionScore);
  gr.updatedBy       = a.id || undefined;
  await gr.save();

  await audit({ property: gr.property, actor: a.id, actorName: a.name, action: 'guest_request.resolved', entityType: 'GuestRequest', entityId: gr._id, after: { status: 'resolved', resolutionNotes }, ip: req.ip }).catch(() => null);
  res.json({ success: true, data: gr });
}));

// ── POST /api/guest-requests/:id/close
router.post('/:id/close', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Closing requires manager permissions');
  const gr = await GuestRequest.findById(req.params.id);
  if (!gr) return res.status(404).json({ success: false, error: 'Request not found' });
  assertPropertyScope(req, gr.property);

  const a = actorOrSystem(req);
  gr.status    = 'closed';
  gr.closedAt  = new Date();
  gr.updatedBy = a.id || undefined;
  await gr.save();
  res.json({ success: true, data: gr });
}));

// ── PATCH /api/guest-requests/:id/notify-guest
router.patch('/:id/notify-guest', asyncHandler(async (req, res) => {
  const gr = await GuestRequest.findById(req.params.id);
  if (!gr) return res.status(404).json({ success: false, error: 'Request not found' });
  assertPropertyScope(req, gr.property);

  gr.guestNotified   = true;
  gr.guestNotifiedAt = new Date();
  await gr.save();
  res.json({ success: true, data: { guestNotified: true, guestNotifiedAt: gr.guestNotifiedAt } });
}));

// ── DELETE /api/guest-requests/:id — cancel
router.delete('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Cancelling requires manager permissions');
  const gr = await GuestRequest.findById(req.params.id);
  if (!gr) return res.status(404).json({ success: false, error: 'Request not found' });
  assertPropertyScope(req, gr.property);

  gr.status = 'cancelled';
  await gr.save();
  res.json({ success: true, data: { cancelled: true } });
}));

export default router;
