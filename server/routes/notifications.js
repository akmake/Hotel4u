import mongoose from 'mongoose';
import Notification, {
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_CHANNELS,
} from '../models/Notification.js';
import { attachActor, requireRoles, assertPropertyScope, actorOrSystem } from '../middleware/authContext.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { audit } from '../services/auditService.js';
import { Router } from 'express';

const router = Router();

function actor(req) { return actorOrSystem(req); }

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications?propertyId=&unreadOnly=&type=&priority=&page=&limit=
// Returns the current user's notifications
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, unreadOnly, type, priority, page = 1, limit = 30 } = req.query;
  assertPropertyScope(req, propertyId);

  const a = actor(req);
  const filter = {
    property: propertyId,
    $or: [
      { recipientUser: a.id },
      ...(a.role ? [{ recipientRole: a.role }] : []),
      { recipientUser: { $exists: false }, recipientRole: { $exists: false } },
    ],
    dismissed: false,
  };

  if (unreadOnly === 'true') filter.read = false;
  if (type) filter.type = type;
  if (priority) filter.priority = { $in: String(priority).split(',') };

  const total = await Notification.countDocuments(filter);
  const unreadCount = await Notification.countDocuments({ ...filter, read: false });

  const notifications = await Notification.find(filter)
    .sort({ priority: -1, createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  res.json({
    success: true,
    data: notifications,
    total,
    unreadCount,
    page: Number(page),
    limit: Number(limit),
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/types — list all notification types
// ─────────────────────────────────────────────────────────────────────────────
router.get('/types', (req, res) => {
  res.json({ success: true, data: { types: NOTIFICATION_TYPES, priorities: NOTIFICATION_PRIORITIES, channels: NOTIFICATION_CHANNELS } });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/unread-count?propertyId=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/unread-count', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);

  const a = actor(req);
  const filter = {
    property: propertyId,
    read: false,
    dismissed: false,
    $or: [
      { recipientUser: a.id },
      ...(a.role ? [{ recipientRole: a.role }] : []),
      { recipientUser: { $exists: false }, recipientRole: { $exists: false } },
    ],
  };

  const count = await Notification.countDocuments(filter);
  res.json({ success: true, data: { count } });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/notifications — create notification (system/admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, [
    'super_admin', 'property_admin', 'general_manager', 'front_desk_manager',
    'system',
  ], 'Creating notifications requires manager permissions');

  const {
    propertyId, type, priority = 'normal', channel = 'in_app',
    title, body, recipientUserId, recipientRole,
    entityType, entityId, link, expiresInHours,
  } = req.body;

  assertPropertyScope(req, propertyId);

  if (!type || !NOTIFICATION_TYPES.includes(type)) {
    return res.status(400).json({ success: false, error: `Invalid notification type. Must be one of: ${NOTIFICATION_TYPES.join(', ')}` });
  }
  if (!title || !body) {
    return res.status(400).json({ success: false, error: 'title and body are required' });
  }

  const a = actor(req);
  const notification = await Notification.create({
    property: propertyId,
    type,
    priority,
    channel,
    title: title.trim(),
    body: body.trim(),
    recipientUser: recipientUserId || undefined,
    recipientRole: recipientRole || undefined,
    entityType: entityType || undefined,
    entityId: entityId ? new mongoose.Types.ObjectId(String(entityId)) : undefined,
    link: link || undefined,
    expiresAt: expiresInHours ? new Date(Date.now() + Number(expiresInHours) * 3600000) : undefined,
    createdBy: a.id || undefined,
  });

  res.status(201).json({ success: true, data: notification });
}));

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/:id/read
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/read', asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);
  if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });
  assertPropertyScope(req, notification.property);

  notification.read = true;
  notification.readAt = new Date();
  await notification.save();

  res.json({ success: true, data: { read: true, readAt: notification.readAt } });
}));

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/read-all?propertyId=
// Mark all current user's notifications as read
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/read-all', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);

  const a = actor(req);
  const filter = {
    property: propertyId,
    read: false,
    dismissed: false,
    $or: [
      { recipientUser: a.id },
      ...(a.role ? [{ recipientRole: a.role }] : []),
    ],
  };

  const result = await Notification.updateMany(filter, {
    $set: { read: true, readAt: new Date() },
  });

  res.json({ success: true, data: { modified: result.modifiedCount } });
}));

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/:id/dismiss
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/dismiss', asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);
  if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });
  assertPropertyScope(req, notification.property);

  notification.dismissed = true;
  notification.read = true;
  notification.readAt = notification.readAt || new Date();
  await notification.save();

  res.json({ success: true, data: { dismissed: true } });
}));

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/notifications/:id — only admin / creator
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, ['super_admin', 'property_admin', 'general_manager'], 'Deleting notifications requires admin permissions');

  const notification = await Notification.findById(req.params.id);
  if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });
  assertPropertyScope(req, notification.property);

  await Notification.deleteOne({ _id: notification._id });
  res.json({ success: true, data: { deleted: true } });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/notifications/broadcast — send to all staff of a property
// ─────────────────────────────────────────────────────────────────────────────
router.post('/broadcast', asyncHandler(async (req, res) => {
  requireRoles(req, ['super_admin', 'property_admin', 'general_manager'], 'Broadcasting requires admin permissions');

  const { propertyId, type = 'system.alert', priority = 'normal', title, body, link, expiresInHours } = req.body;
  assertPropertyScope(req, propertyId);

  if (!title || !body) {
    return res.status(400).json({ success: false, error: 'title and body are required' });
  }

  const a = actor(req);
  const notification = await Notification.create({
    property: propertyId,
    type,
    priority,
    channel: 'in_app',
    title: title.trim(),
    body: body.trim(),
    // No recipientUser/recipientRole = broadcast
    link: link || undefined,
    expiresAt: expiresInHours ? new Date(Date.now() + Number(expiresInHours) * 3600000) : undefined,
    createdBy: a.id || undefined,
  });

  await audit({
    property: propertyId,
    actor: a.id || null,
    actorName: a.name || 'system',
    action: 'notification.broadcast',
    entityType: 'Notification',
    entityId: notification._id,
    after: { title, body, priority },
    ip: req.ip,
  }).catch(() => null);

  res.status(201).json({ success: true, data: notification });
}));

export default router;
