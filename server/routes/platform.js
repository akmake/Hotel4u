// /api/pms/platform — property policy (ADM-05), global search (SYS-05) and work items / shift
// handover (SYS-06). Rules live in services/policyService.js and services/platformService.js.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import { POLICY_ROLES, getPolicy, publishPolicy } from '../services/policyService.js';
import { globalSearch, listWork, createWork, takeWork, transferWork, closeWork, noteWork } from '../services/platformService.js';
import User from '../models/User.js';

const router = Router();

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[platform]', err);
    res.status(safe).json({
      success: false,
      error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message,
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}),
    });
  }
};

function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) { const err = new Error('יש לבחור נכס'); err.status = 400; throw err; }
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
const actorOf = (req) => { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; };
const POLICY_READ = [...POLICY_ROLES, 'front_desk_manager', 'finance_manager', 'auditor', 'housekeeping_manager'];
const STAFF = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'finance_manager', 'cashier',
  'housekeeping_manager', 'housekeeper', 'maintenance_manager', 'technician', 'revenue_manager', 'sales_manager', 'auditor'];

// ── ADM-05 ──────────────────────────────────────────────────────────────────
router.get('/policy', handle(async (req) => {
  requireRoles(req, POLICY_READ, 'אין הרשאה לצפות במדיניות');
  return getPolicy({ propertyId: scope(req) });
}));

router.put('/policy', handle(async (req) => {
  requireRoles(req, POLICY_ROLES, 'פרסום מדיניות מותר למנהל נכס');
  return publishPolicy({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

// ── SYS-05 ──────────────────────────────────────────────────────────────────
router.get('/search', handle(async (req) => {
  requireRoles(req, [...STAFF, 'owner_readonly'], 'אין הרשאה לחיפוש');
  return globalSearch({ propertyId: scope(req), q: req.query.q, role: req.actor.role });
}));

// ── SYS-06 ──────────────────────────────────────────────────────────────────
// Everyone active in the property who can receive a handover (name and role only).
router.get('/staff', handle(async (req) => {
  requireRoles(req, STAFF, 'אין הרשאה');
  const users = await User.find({ property: scope(req), active: { $ne: false }, role: { $in: STAFF }, $or: [{ accessUntil: null }, { accessUntil: { $gt: new Date() } }] })
    .select('firstName lastName role').sort({ firstName: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), role: u.role }));
}));

router.get('/work', handle(async (req) => {
  requireRoles(req, STAFF, 'אין הרשאה');
  return listWork({ propertyId: scope(req), status: req.query.status || 'open', mine: req.query.mine === '1', actor: actorOf(req) });
}));

router.post('/work', handle(async (req) => {
  requireRoles(req, STAFF, 'אין הרשאה');
  return createWork({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/work/:id/take', handle(async (req) => {
  requireRoles(req, STAFF, 'אין הרשאה');
  return takeWork({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip });
}));

router.post('/work/:id/transfer', handle(async (req) => {
  requireRoles(req, STAFF, 'אין הרשאה');
  return transferWork({ propertyId: scope(req), id: req.params.id, toUserId: req.body?.toUserId, note: req.body?.note, actor: actorOf(req), ip: req.ip });
}));

router.post('/work/:id/close', handle(async (req) => {
  requireRoles(req, STAFF, 'אין הרשאה');
  return closeWork({ propertyId: scope(req), id: req.params.id, resolution: req.body?.resolution, actor: actorOf(req), ip: req.ip });
}));

router.post('/work/:id/note', handle(async (req) => {
  requireRoles(req, STAFF, 'אין הרשאה');
  return noteWork({ propertyId: scope(req), id: req.params.id, text: req.body?.text, actor: actorOf(req) });
}));

export default router;
