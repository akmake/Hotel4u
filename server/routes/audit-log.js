// /api/pms/audit-log — ADM-07 audit trail. Read-only, for managers and auditors only; secrets and
// identity documents are masked in before/after; exports are themselves audited.
import { Router } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { audit } from '../services/auditService.js';

const router = Router();
const AUDIT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'auditor', 'finance_manager'];
const GROUPS = {
  finance: /^(folio|payment|invoice|refund|day_close|night_audit|finance)/i,
  inventory: /^(inventory|room|stay|reservation\.(price|modified))/i,
  reservations: /^(reservation|quote|booking|arrival_queue)/i,
  operations: /^(housekeeping|maintenance|lost_item|room\.)/i,
  permissions: /^(user|role)/i,
  auth: /^(auth|LOGIN|LOGOUT)/i,
  privacy: /^(guest|registration|privacy|retention)/i,
};
const SENSITIVE = /(password|totp|secret|token|idnumber|passport|documentnumber|signature|cardnumber|cvv|pan$|iban|accountnumber|hash)/i;
const escapeRx = (v) => String(v).slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function redact(v, depth = 0) {
  if (v === null || v === undefined || depth > 6) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (typeof v === 'object' && !(v instanceof Date) && !(v instanceof mongoose.Types.ObjectId)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE.test(k) ? '••••' : redact(val, depth + 1);
    return out;
  }
  return v;
}

function buildFilter(q) {
  const filter = { property: new mongoose.Types.ObjectId(String(q.propertyId)) };
  const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
  const from = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(to.getTime() - 7 * 86400000);
  filter.createdAt = { $gte: from, $lte: to };
  if (q.actor && mongoose.isValidObjectId(String(q.actor))) filter.actor = new mongoose.Types.ObjectId(String(q.actor));
  if (q.group && GROUPS[q.group]) filter.action = GROUPS[q.group];
  if (q.entityId && mongoose.isValidObjectId(String(q.entityId))) filter.entityId = new mongoose.Types.ObjectId(String(q.entityId));
  if (q.entityType) filter.entityType = String(q.entityType).slice(0, 40);
  if (q.q) filter.$or = [{ action: new RegExp(escapeRx(q.q), 'i') }, { reason: new RegExp(escapeRx(q.q), 'i') }];
  return { filter, from, to };
}

const row = (l) => ({
  id: String(l._id), at: l.createdAt, actorName: l.actorName || 'system', actor: l.actor ? String(l.actor) : null, action: l.action,
  entityType: l.entityType, entityId: l.entityId ? String(l.entityId) : null, reason: l.reason || null, ip: l.ip || null,
  source: l.actor ? 'user' : 'system',
});

function badProperty(req, res) {
  const { propertyId } = req.query;
  if (!propertyId || !mongoose.isValidObjectId(String(propertyId))) { res.status(400).json({ success: false, error: 'propertyId נדרש' }); return true; }
  assertPropertyScope(req, propertyId);
  return false;
}

// GET /api/pms/audit-log?propertyId=&from=&to=&actor=&group=&entityId=&q=&page=
router.get('/', asyncHandler(async (req, res) => {
  requireRoles(req, AUDIT_ROLES, 'יומן הביקורת פתוח למבקר ולמנהל בלבד');
  if (badProperty(req, res)) return;
  const { filter, from, to } = buildFilter(req.query);
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 50));
  const total = await AuditLog.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).select('-before -after').lean();
  const withDiff = new Set((await AuditLog.find({ _id: { $in: logs.map((l) => l._id) }, $or: [{ before: { $exists: true } }, { after: { $exists: true } }] }).select('_id').lean()).map((l) => String(l._id)));
  const actors = await User.find({ property: req.query.propertyId }).select('firstName lastName').sort({ firstName: 1 }).lean();
  res.json({
    success: true,
    data: {
      from, to, total, page, pages, pageSize, groups: Object.keys(GROUPS),
      actors: actors.map((a) => ({ id: String(a._id), name: `${a.firstName || ''} ${a.lastName || ''}`.trim() })),
      rows: logs.map((l) => ({ ...row(l), hasDiff: withDiff.has(String(l._id)) })),
    },
  });
}));

// GET /api/pms/audit-log/export?… — CSV (no before/after); the export itself is recorded.
router.get('/export', asyncHandler(async (req, res) => {
  requireRoles(req, AUDIT_ROLES, 'יומן הביקורת פתוח למבקר ולמנהל בלבד');
  if (badProperty(req, res)) return;
  const { filter, from, to } = buildFilter(req.query);
  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(5000).select('-before -after').lean();
  // Cells that start with a formula character are prefixed so spreadsheets do not execute them.
  const cell = (v) => {
    let t = String(v ?? '').replace(/"/g, '""');
    if (/^[=+\-@]/.test(t)) t = `'${t}`;
    return `"${t}"`;
  };
  const header = ['מועד', 'משתמש', 'פעולה', 'סוג רשומה', 'מזהה רשומה', 'סיבה', 'IP'];
  const lines = [header.map(cell).join(',')]
    .concat(logs.map((l) => [new Date(l.createdAt).toISOString(), l.actorName || 'system', l.action, l.entityType, l.entityId, l.reason || '', l.ip || ''].map(cell).join(',')));
  await audit({ property: req.query.propertyId, actor: req.actor.id, actorName: req.actor.name, action: 'audit.exported', entityType: 'Property', entityId: req.query.propertyId, after: { rows: logs.length, from, to, group: req.query.group || null, actorFilter: req.query.actor || null }, ip: req.ip });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${lines.join('\n')}`);
}));

// GET /api/pms/audit-log/entity/:type/:id — history of one record (masked)
router.get('/entity/:type/:id', asyncHandler(async (req, res) => {
  requireRoles(req, AUDIT_ROLES, 'יומן הביקורת פתוח למבקר ולמנהל בלבד');
  if (badProperty(req, res)) return;
  if (!mongoose.isValidObjectId(String(req.params.id))) return res.status(400).json({ success: false, error: 'מזהה לא תקין' });
  const logs = await AuditLog.find({ entityType: req.params.type, entityId: req.params.id, property: req.query.propertyId }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, data: logs.map((l) => ({ ...row(l), before: redact(l.before), after: redact(l.after) })) });
}));

// GET /api/pms/audit-log/:id — one event with masked before/after
router.get('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, AUDIT_ROLES, 'יומן הביקורת פתוח למבקר ולמנהל בלבד');
  if (!mongoose.isValidObjectId(String(req.params.id))) return res.status(400).json({ success: false, error: 'מזהה לא תקין' });
  const l = await AuditLog.findById(req.params.id).lean();
  if (!l) return res.status(404).json({ success: false, error: 'האירוע לא נמצא' });
  assertPropertyScope(req, String(l.property || ''));
  res.json({ success: true, data: { ...row(l), userAgent: l.userAgent ? String(l.userAgent).slice(0, 160) : null, before: redact(l.before), after: redact(l.after) } });
}));

export default router;
