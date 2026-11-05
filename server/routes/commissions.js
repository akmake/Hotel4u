// /api/pms/commissions — travel-agent commissions: records, holds, manual edits, payments and their lifecycle.
import { requireCan } from '../services/permissionService.js';
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import * as cm from '../services/commissionService.js';

const router = Router();
const READ = [...cm.COMMISSION_ROLES, 'revenue_manager', 'owner_readonly', 'auditor'];
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[commissions]', err);
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
const read = (req) => requireRoles(req, READ, 'אין הרשאה לעמלות סוכנים');
const manage = (req) => requireCan(req, 'commission.manage', cm.COMMISSION_ROLES, 'עמלות סוכנים — למנהל, לכספים או למכירות');

router.get('/', handle(async (req) => { read(req); return cm.list({ propertyId: scope(req), ...req.query }); }));
router.get('/agents', handle(async (req) => { read(req); return cm.agentsList({ propertyId: scope(req) }); }));
router.post('/process', handle(async (req) => { manage(req); return cm.processDepartures({ propertyId: scope(req), through: req.body?.through, from: req.body?.from, actor: actorOf(req), ip: req.ip }); }));
router.post('/manual', handle(async (req) => cm.addManual({ propertyId: scope(req), body: req.body, actor: actorOf(req), ip: req.ip })));
router.post('/hold', handle(async (req) => cm.setHold({ propertyId: scope(req), ids: req.body?.ids, id: req.body?.id, kind: req.body?.kind, note: req.body?.note, actor: actorOf(req), ip: req.ip })));
router.post('/release', handle(async (req) => cm.releaseHold({ propertyId: scope(req), ids: req.body?.ids, id: req.body?.id, actor: actorOf(req), ip: req.ip })));
router.post('/detach', handle(async (req) => cm.detachReservation({ propertyId: scope(req), reservationId: req.body?.reservation, reason: req.body?.reason, actor: actorOf(req), ip: req.ip })));
router.get('/pre-payment', handle(async (req) => { read(req); return cm.prePaymentReport({ propertyId: scope(req), agent: req.query.agent, from: req.query.from, to: req.query.to }); }));
router.post('/pay', handle(async (req) => cm.pay({ propertyId: scope(req), body: req.body, actor: actorOf(req), ip: req.ip })));
router.get('/payments', handle(async (req) => { read(req); return cm.listPayments({ propertyId: scope(req), ...req.query }); }));
router.get('/payments/:id', handle(async (req) => { read(req); return cm.paymentDetail({ propertyId: scope(req), id: req.params.id }); }));
router.post('/payments/:id/status', handle(async (req) => cm.setPaymentStatus({ propertyId: scope(req), id: req.params.id, status: req.body?.status, note: req.body?.note, actor: actorOf(req), ip: req.ip })));
router.post('/payments/:id/print', handle(async (req) => cm.markPrinted({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip })));
router.get('/report', handle(async (req) => { read(req); return cm.report({ propertyId: scope(req), kind: req.query.kind, from: req.query.from, to: req.query.to }); }));
router.get('/reservation/:id', handle(async (req) => { read(req); return cm.reservationCommission({ propertyId: scope(req), reservationId: req.params.id }); }));
router.patch('/:id', handle(async (req) => cm.editAmount({ propertyId: scope(req), id: req.params.id, amount: req.body?.amount, note: req.body?.note, actor: actorOf(req), ip: req.ip })));

export default router;
