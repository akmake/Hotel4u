// /api/pms/cards — card clearing: settings, cards on file, authorizations, charge / refund to card, settlements.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import * as cs from '../services/cardService.js';

const router = Router();
const READ = [...new Set([...cs.CARD_ROLES, ...cs.SETTLE_ROLES, 'auditor', 'owner_readonly'])];
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[cards]', err);
    res.status(safe).json({ success: false, error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.code ? { code: err.code } : {}) });
  }
};
function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
const actorOf = (req) => { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; };
const read = (req) => requireRoles(req, READ, 'אין הרשאה לכרטיסי אשראי');
const b = (req) => req.body || {};

router.get('/settings', handle(async (req) => { read(req); return cs.getSettings({ propertyId: scope(req) }); }));
router.put('/settings', handle(async (req) => cs.saveSettings({ propertyId: scope(req), body: b(req), actor: actorOf(req), ip: req.ip })));

router.post('/capture', handle(async (req) => cs.startCapture({ propertyId: scope(req), guestId: b(req).guest, reservationId: b(req).reservation, returnUrl: b(req).returnUrl, actor: actorOf(req) })));
router.post('/capture/:token', handle(async (req) => cs.finishCapture({ propertyId: scope(req), sessionToken: req.params.token, payload: b(req).payload, actor: actorOf(req), ip: req.ip })));
router.get('/', handle(async (req) => { read(req); return cs.listCards({ propertyId: scope(req), guestId: req.query.guest, reservationId: req.query.reservation }); }));
router.post('/:id/verify', handle(async (req) => cs.verifyCard({ propertyId: scope(req), cardId: req.params.id, actor: actorOf(req), ip: req.ip })));
router.post('/:id/remove', handle(async (req) => cs.removeCard({ propertyId: scope(req), cardId: req.params.id, actor: actorOf(req), ip: req.ip })));

router.get('/reservations/:id', handle(async (req) => { read(req); return cs.reservationCardState({ propertyId: scope(req), reservationId: req.params.id }); }));
router.post('/reservations/:id/card', handle(async (req) => cs.setReservationCard({ propertyId: scope(req), reservationId: req.params.id, cardId: b(req).card, actor: actorOf(req), ip: req.ip })));
router.post('/reservations/:id/authorize', handle(async (req) => cs.authorize({ propertyId: scope(req), reservationId: req.params.id, cardId: b(req).card, amount: b(req).amount, actor: actorOf(req), ip: req.ip })));
router.post('/reservations/:id/top-up', handle(async (req) => { requireRoles(req, cs.CARD_ROLES); return cs.topUp({ propertyId: scope(req), reservationId: req.params.id, actor: actorOf(req), ip: req.ip }); }));
router.post('/reservations/:id/release', handle(async (req) => { requireRoles(req, cs.CARD_ROLES); return cs.releaseAuth({ propertyId: scope(req), reservationId: req.params.id, actor: actorOf(req), ip: req.ip }); }));
router.get('/authorizations', handle(async (req) => { read(req); return cs.authBoard({ propertyId: scope(req) }); }));

router.post('/folios/:id/charge', handle(async (req) => cs.chargeFolio({ propertyId: scope(req), folioId: req.params.id, cardId: b(req).card, amount: b(req).amount, kind: b(req).kind, actor: actorOf(req), ip: req.ip })));
router.post('/folios/:id/refund', handle(async (req) => cs.refundToCard({ propertyId: scope(req), folioId: req.params.id, paymentLineId: b(req).paymentLineId, amount: b(req).amount, reasonCode: b(req).reasonCode, note: b(req).note, actor: actorOf(req), ip: req.ip })));
router.get('/folios/:id/payments', handle(async (req) => { read(req); return cs.folioCardPayments({ propertyId: scope(req), folioId: req.params.id }); }));

router.get('/settlements', handle(async (req) => { read(req); return cs.settlements({ propertyId: scope(req), from: req.query.from, to: req.query.to, status: req.query.status }); }));
router.post('/settlements/:id/deposit', handle(async (req) => cs.recordDeposit({ propertyId: scope(req), id: req.params.id, amount: b(req).amount, fee: b(req).fee, ref: b(req).ref, actor: actorOf(req), ip: req.ip })));
router.get('/transactions', handle(async (req) => { read(req); return cs.transactions({ propertyId: scope(req), from: req.query.from, to: req.query.to }); }));

export default router;
