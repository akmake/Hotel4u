// /api/pms/promotions — promo codes used by the desk booking form and the booking site.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import { listPromotions, savePromotion } from '../services/promotionService.js';

const router = Router();
const READ = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager', 'front_desk_manager', 'receptionist', 'reservations_agent', 'finance_manager', 'auditor', 'owner_readonly'];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[promotions]', err);
    res.status(safe).json({ success: false, error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}) });
  }
};
function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
function actorOf(req) { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; }

router.get('/', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה למבצעים'); return listPromotions({ propertyId: scope(req) }); }));
router.post('/', handle(async (req) => savePromotion({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.patch('/:id', handle(async (req) => savePromotion({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip })));

export default router;
