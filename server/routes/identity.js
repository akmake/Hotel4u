// /api/pms/identity — users, roles and access (ADM-06) and the signed-in person's profile and
// sessions (SYS-04). Rules live in services/identityService.js.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import {
  ADMIN_ROLES, listUsers, grantableRoles, createUser, updateUser, deactivateUser, reactivateUser, issueSetupLink,
  getMe, updateMe, changeMyPassword, logoutEverywhere,
} from '../services/identityService.js';

const router = Router();

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[identity]', err);
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
const USER_READ = [...ADMIN_ROLES, 'auditor'];

// ── ADM-06 ──────────────────────────────────────────────────────────────────
router.get('/users', handle(async (req) => {
  requireRoles(req, USER_READ, 'ניהול משתמשים מותר למנהל נכס');
  return listUsers({ propertyId: scope(req), q: req.query.q, status: req.query.status, actor: actorOf(req) });
}));

router.get('/roles', handle(async (req) => {
  requireRoles(req, USER_READ, 'ניהול משתמשים מותר למנהל נכס');
  return grantableRoles(req.actor.role);
}));

router.post('/users', handle(async (req) => {
  requireRoles(req, ADMIN_ROLES, 'הוספת משתמשים מותרת למנהל נכס');
  return createUser({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.patch('/users/:id', handle(async (req) => updateUser({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip })));

router.post('/users/:id/deactivate', handle(async (req) => {
  requireRoles(req, ADMIN_ROLES, 'השבתת משתמשים מותרת למנהל נכס');
  return deactivateUser({ propertyId: scope(req), id: req.params.id, reason: req.body?.reason, actor: actorOf(req), ip: req.ip });
}));

router.post('/users/:id/reactivate', handle(async (req) => {
  requireRoles(req, ADMIN_ROLES, 'הפעלת משתמשים מותרת למנהל נכס');
  return reactivateUser({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip });
}));

router.post('/users/:id/setup-link', handle(async (req) => {
  requireRoles(req, ADMIN_ROLES, 'הנפקת קישור מותרת למנהל נכס');
  return issueSetupLink({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip });
}));

// ── SYS-04 ──────────────────────────────────────────────────────────────────
router.get('/me', handle(async (req) => getMe({ actor: actorOf(req) })));
router.patch('/me', handle(async (req) => updateMe({ actor: actorOf(req), input: req.body || {}, ip: req.ip })));
router.post('/me/password', handle(async (req) => changeMyPassword({ actor: actorOf(req), current: req.body?.current, next: req.body?.next, ip: req.ip })));
router.post('/me/logout-all', handle(async (req) => logoutEverywhere({ actor: actorOf(req), ip: req.ip })));

export default router;
