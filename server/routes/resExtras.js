// /api/pms/res-extras — waitlist, deposit due dates, batch confirmations, items, payment methods / privileges / housekeeping of a stay.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireActor } from '../middleware/authContext.js';
import * as rx from '../services/reservationExtrasService.js';

const router = Router();
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[res-extras]', err);
    res.status(safe).json({ success: false, error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) });
  }
};
function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
const actorOf = (req) => { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; };
const b = (req) => req.body || {};
const read = (req) => { if (!rx.EXTRA_ROLES.includes(req.actor?.role) && !['auditor', 'owner_readonly', 'housekeeping_manager'].includes(req.actor?.role)) throw Object.assign(new Error('אין הרשאה'), { status: 403 }); };

router.use(requireActor);
router.get('/waitlist', handle(async (req) => { read(req); return rx.listWaitlist({ propertyId: scope(req) }); }));
router.post('/waitlist', handle(async (req) => rx.addToWaitlist({ propertyId: scope(req), body: b(req), actor: actorOf(req), ip: req.ip })));
router.post('/waitlist/:id/promote', handle(async (req) => rx.promoteWaitlist({ propertyId: scope(req), id: req.params.id, body: b(req), actor: actorOf(req), ip: req.ip })));
router.post('/waitlist/:id/remove', handle(async (req) => rx.removeFromWaitlist({ propertyId: scope(req), id: req.params.id, reason: b(req).reason, actor: actorOf(req), ip: req.ip })));
router.get('/deposits', handle(async (req) => { read(req); return rx.depositList({ propertyId: scope(req) }); }));
router.put('/deposits/:id', handle(async (req) => rx.setDepositDue({ propertyId: scope(req), id: req.params.id, body: b(req), actor: actorOf(req), ip: req.ip })));
router.post('/deposits/:id/remind', handle(async (req) => { read(req); return rx.remindDeposit({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip }); }));
router.get('/confirmations', handle(async (req) => { read(req); return rx.unconfirmedArrivals({ propertyId: scope(req), from: req.query.from, to: req.query.to }); }));
router.post('/confirmations', handle(async (req) => rx.sendConfirmations({ propertyId: scope(req), ids: b(req).ids, actor: actorOf(req), ip: req.ip })));
router.get('/items', handle(async (req) => { read(req); return rx.listItemTypes({ propertyId: scope(req) }); }));
router.post('/items', handle(async (req) => rx.saveItemType({ propertyId: scope(req), body: b(req), actor: actorOf(req), ip: req.ip })));
router.patch('/items/:id', handle(async (req) => rx.saveItemType({ propertyId: scope(req), id: req.params.id, body: b(req), actor: actorOf(req), ip: req.ip })));
router.get('/items/availability', handle(async (req) => { read(req); return rx.itemAvailability({ propertyId: scope(req), from: req.query.from, to: req.query.to }); }));
router.post('/reservations/:id/items', handle(async (req) => rx.bookItem({ propertyId: scope(req), reservationId: req.params.id, body: b(req), actor: actorOf(req), ip: req.ip })));
router.post('/item-bookings/:id/release', handle(async (req) => rx.releaseItem({ propertyId: scope(req), bookingId: req.params.id, actor: actorOf(req), ip: req.ip })));
router.get('/reservations/:id/rules', handle(async (req) => { read(req); return rx.getRules({ propertyId: scope(req), reservationId: req.params.id }); }));
router.put('/reservations/:id/rules', handle(async (req) => rx.saveRules({ propertyId: scope(req), reservationId: req.params.id, body: b(req), actor: actorOf(req), ip: req.ip })));

export default router;
