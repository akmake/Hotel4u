// /api/pms/codes — the hotel's code lists (segments, sources, reasons, special services, VIP, traces, notes, preferences, seasons, languages).
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireActor } from '../middleware/authContext.js';
import * as cl from '../services/codeListService.js';

const router = Router();
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[codes]', err);
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
// Any signed-in user of the property reads the lists (forms need them); changes are for managers.
router.get('/', handle(async (req) => (req.query.list ? cl.getList(scope(req), String(req.query.list), { activeOnly: req.query.active === '1' }) : cl.allLists(scope(req)))));
router.put('/:list/:code', handle(async (req) => cl.saveItem({ propertyId: scope(req), list: req.params.list, code: req.params.code, body: req.body || {}, actor: actorOf(req), ip: req.ip })));

export default router;
