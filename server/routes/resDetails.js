// /api/pms/res-details — reservation details (gap-map item 14): extra fields, a rate for part of the nights, phone summary.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireActor } from '../middleware/authContext.js';
import * as rd from '../services/reservationDetailsService.js';

const router = Router();
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[res-details]', err);
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

router.use(requireActor);
router.get('/options', handle(async (req) => rd.detailOptions({ propertyId: scope(req) })));
router.get('/:id', handle(async (req) => rd.getDetails({ propertyId: scope(req), reservationId: req.params.id })));
router.patch('/:id', handle(async (req) => rd.saveDetails({ propertyId: scope(req), reservationId: req.params.id, body: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.post('/:id/split-rate', handle(async (req) => rd.splitRate({ propertyId: scope(req), reservationId: req.params.id, body: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.get('/:id/summary', handle(async (req) => rd.phoneSummary({ propertyId: scope(req), reservationId: req.params.id })));

export default router;
