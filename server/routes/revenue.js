// /api/pms/revenue — day types + hotel calendar, length-of-stay tiers, channel restrictions, strategies.
import { requireCan } from '../services/permissionService.js';
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import * as rev from '../services/revenueService.js';

const router = Router();
const READ = [...rev.RATE_ROLES, 'front_desk_manager', 'sales_manager', 'finance_manager', 'reservations_manager', 'owner_readonly', 'auditor'];
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[revenue]', err);
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
const read = (req) => requireRoles(req, READ, 'אין הרשאה לניהול הכנסות');
const manage = (req) => requireCan(req, 'rates.manage', rev.RATE_ROLES, 'ניהול הכנסות — למנהל או לאחראי הכנסות');

router.get('/calendar', handle(async (req) => { read(req); return rev.hotelCalendar({ propertyId: scope(req), from: req.query.from, days: req.query.days }); }));
router.put('/calendar', handle(async (req) => { manage(req); return rev.setCalendar({ propertyId: scope(req), body: req.body, actor: actorOf(req), ip: req.ip }); }));
router.get('/day-types', handle(async (req) => { read(req); return rev.listDayTypes({ propertyId: scope(req) }); }));
router.post('/day-types', handle(async (req) => { manage(req); return rev.saveDayType({ propertyId: scope(req), body: req.body, actor: actorOf(req), ip: req.ip }); }));
router.patch('/day-types/:id', handle(async (req) => { manage(req); return rev.saveDayType({ propertyId: scope(req), id: req.params.id, body: req.body, actor: actorOf(req), ip: req.ip }); }));

router.get('/plans', handle(async (req) => { read(req); return rev.listPlans({ propertyId: scope(req) }); }));
router.put('/plans/:id', handle(async (req) => { manage(req); return rev.savePlanRevenue({ propertyId: scope(req), planId: req.params.id, body: req.body, actor: actorOf(req), ip: req.ip }); }));

router.get('/channel-rules', handle(async (req) => { read(req); return rev.listChannelRules({ propertyId: scope(req) }); }));
router.post('/channel-rules', handle(async (req) => { manage(req); return rev.saveChannelRule({ propertyId: scope(req), body: req.body, actor: actorOf(req), ip: req.ip }); }));
router.patch('/channel-rules/:id', handle(async (req) => { manage(req); return rev.saveChannelRule({ propertyId: scope(req), id: req.params.id, body: req.body, actor: actorOf(req), ip: req.ip }); }));

router.get('/strategies', handle(async (req) => { read(req); return rev.listStrategies({ propertyId: scope(req) }); }));
router.post('/strategies', handle(async (req) => { manage(req); return rev.saveStrategy({ propertyId: scope(req), body: req.body, actor: actorOf(req), ip: req.ip }); }));
router.patch('/strategies/:id', handle(async (req) => { manage(req); return rev.saveStrategy({ propertyId: scope(req), id: req.params.id, body: req.body, actor: actorOf(req), ip: req.ip }); }));
router.post('/strategies/run', handle(async (req) => { manage(req); return rev.runStrategies({ propertyId: scope(req) }); }));
router.get('/restrictions/manual', handle(async (req) => { read(req); return rev.manualRestrictionLog({ propertyId: scope(req), limit: req.query.limit }); }));
router.get('/restrictions',handle(async (req) => { read(req); return rev.restrictionLog({ propertyId: scope(req), limit: req.query.limit, activeOnly: req.query.active === '1' }); }));

export default router;
