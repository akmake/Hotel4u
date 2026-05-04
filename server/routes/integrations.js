/**
 * פרק י"ט — Integrations Route
 * Integration Event Log CRUD + Webhook Subscriptions management.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope } from '../middleware/authContext.js';
import mongoose from 'mongoose';
import IntegrationLog from '../models/IntegrationLog.js';
import WebhookSubscription, { WEBHOOK_EVENTS } from '../models/WebhookSubscription.js';

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// Integration Event Log (section 38)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/integrations/log?propertyId=&source=&status=&from=&to=&page=&limit=
router.get('/log', asyncHandler(async (req, res) => {
  const { propertyId, source, status } = req.query;
  assertPropertyScope(req, propertyId);

  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const skip  = (page - 1) * limit;

  const filter = { property: propertyId };
  if (source) filter.source = source;
  if (status) filter.status = status;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to + 'T23:59:59Z');
  }

  const [logs, total] = await Promise.all([
    IntegrationLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    IntegrationLog.countDocuments(filter),
  ]);

  res.json({ success: true, data: logs, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

// POST /api/integrations/log — record an integration event (used by services)
router.post('/log', asyncHandler(async (req, res) => {
  const { propertyId } = req.body;
  assertPropertyScope(req, propertyId);

  const { source, destination, eventType, direction, payloadId, requestBody,
          responseBody, statusCode, status, retryCount, errorMessage, durationMs, relatedEntity } = req.body;

  const log = await IntegrationLog.create({
    property: propertyId,
    source, destination, eventType, direction, payloadId,
    requestBody, responseBody, statusCode, status, retryCount, errorMessage, durationMs, relatedEntity,
  });

  res.status(201).json({ success: true, data: log });
}));

// GET /api/integrations/log/stats?propertyId=
// Summary counts by source & status
router.get('/log/stats', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

  const stats = await IntegrationLog.aggregate([
    { $match: { property: new mongoose.Types.ObjectId(propertyId), createdAt: { $gte: since } } },
    { $group: { _id: { source: '$source', status: '$status' }, count: { $sum: 1 } } },
    { $sort: { '_id.source': 1 } },
  ]);

  res.json({ success: true, data: stats });
}));

// DELETE /api/integrations/log?propertyId=&olderThanDays=30
// Purge old log entries (admin maintenance)
router.delete('/log', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const days     = Math.max(7, Number(req.query.olderThanDays) || 30);
  const cutoff   = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result   = await IntegrationLog.deleteMany({ property: propertyId, createdAt: { $lt: cutoff } });
  res.json({ success: true, data: { deleted: result.deletedCount, cutoff } });
}));

// ══════════════════════════════════════════════════════════════════════════════
// Webhook Subscriptions (section 39)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/integrations/webhooks?propertyId=
router.get('/webhooks', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const subs = await WebhookSubscription.find({ property: propertyId })
    .select('-secret')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data: subs });
}));

// GET /api/integrations/webhooks/events — list available event types
router.get('/webhooks/events', (req, res) => {
  res.json({ success: true, data: WEBHOOK_EVENTS });
});

// POST /api/integrations/webhooks — create subscription
router.post('/webhooks', asyncHandler(async (req, res) => {
  const { propertyId, url, events, description } = req.body;
  assertPropertyScope(req, propertyId);

  if (!url || !url.startsWith('https://')) {
    return res.status(400).json({ success: false, error: 'URL must start with https://' });
  }
  if (!events?.length) {
    return res.status(400).json({ success: false, error: 'At least one event is required' });
  }
  const invalid = events.filter(e => !WEBHOOK_EVENTS.includes(e));
  if (invalid.length) {
    return res.status(400).json({ success: false, error: `Unknown events: ${invalid.join(', ')}` });
  }

  const secret = crypto.randomBytes(32).toString('hex');
  const sub = await WebhookSubscription.create({
    property: propertyId,
    url,
    events,
    secret,
    description,
    createdBy: req.actor?._id,
  });

  // Return secret only on creation
  res.status(201).json({ success: true, data: { ...sub.toObject(), secret } });
}));

// PATCH /api/integrations/webhooks/:id
router.patch('/webhooks/:id', asyncHandler(async (req, res) => {
  const sub = await WebhookSubscription.findById(req.params.id);
  if (!sub) return res.status(404).json({ success: false, error: 'Webhook not found' });
  assertPropertyScope(req, String(sub.property));

  const { url, events, active, description } = req.body;
  if (url !== undefined) {
    if (!url.startsWith('https://')) return res.status(400).json({ success: false, error: 'URL must start with https://' });
    sub.url = url;
  }
  if (events !== undefined) sub.events = events;
  if (active !== undefined) { sub.active = active; if (active) sub.failureCount = 0; }
  if (description !== undefined) sub.description = description;
  await sub.save();

  res.json({ success: true, data: sub.toObject({ versionKey: false }) });
}));

// POST /api/integrations/webhooks/:id/rotate-secret — regenerate signing secret
router.post('/webhooks/:id/rotate-secret', asyncHandler(async (req, res) => {
  const sub = await WebhookSubscription.findById(req.params.id);
  if (!sub) return res.status(404).json({ success: false, error: 'Webhook not found' });
  assertPropertyScope(req, String(sub.property));

  sub.secret = crypto.randomBytes(32).toString('hex');
  await sub.save();
  res.json({ success: true, data: { secret: sub.secret } });
}));

// DELETE /api/integrations/webhooks/:id
router.delete('/webhooks/:id', asyncHandler(async (req, res) => {
  const sub = await WebhookSubscription.findById(req.params.id);
  if (!sub) return res.status(404).json({ success: false, error: 'Webhook not found' });
  assertPropertyScope(req, String(sub.property));
  await sub.deleteOne();
  res.json({ success: true, data: { deleted: true } });
}));

export default router;
