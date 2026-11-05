// /api/pms/permissions — custom permission groups, per-user assignment (group + individual grants / denies), unlock.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import * as pm from '../services/permissionService.js';
import { catalog as reportCatalog } from '../services/reportCenter.js';

const router = Router();
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[permissions]', err);
    res.status(safe).json({ success: false, error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}) });
  }
};
function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
const actorOf = (req) => { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; };
const admin = (req) => requireRoles(req, pm.ADMIN_ROLES, 'ניהול הרשאות — למנהל נכס בלבד');
const reportGroups = () => reportCatalog(null).groups.map((g) => (typeof g === 'string' ? g : g.name || g.code || String(g)));

router.get('/catalog', handle(async (req) => { admin(req); return pm.catalog({ propertyId: scope(req), reportGroups: reportGroups() }); }));
router.get('/groups', handle(async (req) => { admin(req); return pm.listGroups({ propertyId: scope(req) }); }));
router.post('/groups', handle(async (req) => { admin(req); return pm.saveGroup({ propertyId: scope(req), body: req.body, actor: actorOf(req), ip: req.ip, reportGroupNames: reportGroups() }); }));
router.patch('/groups/:id', handle(async (req) => { admin(req); return pm.saveGroup({ propertyId: scope(req), id: req.params.id, body: req.body, actor: actorOf(req), ip: req.ip, reportGroupNames: reportGroups() }); }));
router.get('/users', handle(async (req) => { admin(req); return pm.listUsers({ propertyId: scope(req), q: req.query.q }); }));
router.patch('/users/:id', handle(async (req) => { admin(req); return pm.assignUser({ propertyId: scope(req), userId: req.params.id, body: req.body, actor: actorOf(req), ip: req.ip }); }));
router.post('/users/:id/unlock', handle(async (req) => { admin(req); return pm.unlockUser({ propertyId: scope(req), userId: req.params.id, actor: actorOf(req), ip: req.ip }); }));

export default router;
