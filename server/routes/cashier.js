// /api/pms/cashier — cashier shifts (open with float, blind count at close) and currency exchange.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import {
  cashierOverview, openShift, closeShift, shiftDetail, listRates, setRate, exchange, voidExchange, listExchanges,
} from '../services/cashierService.js';

const router = Router();
const MONEY_WORK = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'finance_manager', 'cashier'];
const MONEY_READ = [...MONEY_WORK, 'auditor', 'owner_readonly'];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[cashier]', err);
    res.status(safe).json({ success: false, error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}), ...(typeof err.code === 'string' ? { code: err.code } : {}) });
  }
};
function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
function actorOf(req) { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; }

router.get('/shifts', handle(async (req) => { requireRoles(req, MONEY_READ, 'אין הרשאה לקופה'); return cashierOverview({ propertyId: scope(req), actor: actorOf(req), from: req.query.from, to: req.query.to }); }));
router.get('/shifts/:id', handle(async (req) => { requireRoles(req, MONEY_READ, 'אין הרשאה לקופה'); return shiftDetail({ propertyId: scope(req), shiftId: req.params.id, actor: actorOf(req) }); }));
router.post('/shifts', handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה לפתוח קופה'); return openShift({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/shifts/:id/close', handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה לסגור קופה'); return closeShift({ propertyId: scope(req), shiftId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));

router.get('/fx/rates', handle(async (req) => { requireRoles(req, MONEY_READ, 'אין הרשאה'); return listRates({ propertyId: scope(req) }); }));
router.put('/fx/rates/:currency', handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה'); return setRate({ propertyId: scope(req), currency: req.params.currency, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.get('/fx', handle(async (req) => { requireRoles(req, MONEY_READ, 'אין הרשאה'); return listExchanges({ propertyId: scope(req), from: req.query.from, to: req.query.to }); }));
router.post('/fx', handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה להמרת מט״ח'); return exchange({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/fx/:id/void', handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה'); return voidExchange({ propertyId: scope(req), id: req.params.id, reason: req.body?.reason, actor: actorOf(req), ip: req.ip }); }));

export default router;
