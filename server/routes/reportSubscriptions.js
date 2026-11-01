// /api/pms/report-subscriptions — scheduled report e-mails (services/reportSubscriptionService.js).
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import { listSubscriptions, createSubscription, updateSubscription, deleteSubscription, sendNow } from '../services/reportSubscriptionService.js';

const router = Router();
const ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager', 'revenue_manager', 'front_desk_manager'];

const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status >= 500) console.error('[report-subscriptions]', err);
    res.status(status).json({ success: false, error: status >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}) });
  }
};

function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) { const err = new Error('יש לבחור נכס'); err.status = 400; throw err; }
  assertPropertyScope(req, propertyId);
  requireRoles(req, ROLES, 'אין הרשאה למנויי דוחות');
  return String(propertyId);
}
const actorOf = (req) => { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; };

router.get('/', handle((req) => listSubscriptions({ propertyId: scope(req) })));
router.post('/', handle((req) => createSubscription({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.put('/:id', handle((req) => updateSubscription({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.delete('/:id', handle((req) => deleteSubscription({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip })));
router.post('/:id/send', handle((req) => sendNow({ propertyId: scope(req), id: req.params.id, actor: actorOf(req) })));

export default router;
