// /api/pms/packages — package components, links to rate plans / reservations, the package ledger.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import * as pk from '../services/packageService.js';

const router = Router();
const READ = [...pk.PACKAGE_ROLES, 'front_desk_manager', 'receptionist', 'reservations_manager', 'owner_readonly', 'auditor'];
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[packages]', err);
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
const read = (req) => requireRoles(req, READ, 'אין הרשאה לחבילות');

router.get('/components', handle(async (req) => { read(req); return pk.listComponents({ propertyId: scope(req) }); }));
router.post('/components', handle(async (req) => pk.saveComponent({ propertyId: scope(req), body: req.body, actor: actorOf(req), ip: req.ip })));
router.patch('/components/:id', handle(async (req) => pk.saveComponent({ propertyId: scope(req), id: req.params.id, body: req.body, actor: actorOf(req), ip: req.ip })));
router.get('/plans', handle(async (req) => { read(req); return pk.listPlans({ propertyId: scope(req) }); }));
router.put('/plans/:id', handle(async (req) => pk.savePlanLinks({ propertyId: scope(req), planId: req.params.id, body: req.body, actor: actorOf(req), ip: req.ip })));
router.get('/ledger', handle(async (req) => { read(req); return pk.ledger({ propertyId: scope(req), from: req.query.from, to: req.query.to }); }));
router.get('/reservations/:id', handle(async (req) => { read(req); return pk.breakdown({ propertyId: scope(req), reservationId: req.params.id }); }));
router.post('/reservations/:id/items', handle(async (req) => pk.addReservationComponent({ propertyId: scope(req), reservationId: req.params.id, body: req.body, actor: actorOf(req), ip: req.ip })));
router.delete('/reservations/:id/items/:itemId', handle(async (req) => pk.removeReservationComponent({ propertyId: scope(req), reservationId: req.params.id, itemId: req.params.itemId, actor: actorOf(req), ip: req.ip })));

export default router;
