// /api/pms/group-blocks — group allotments that hold inventory, pickups at the group price, rooming list.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import { listBlocks, getBlock, createBlock, updateBlock, setBlockStatus, pickupFromBlock, saveRoster, GROUP_WORK } from '../services/groupBlockService.js';

const router = Router();
const READ = [...GROUP_WORK, 'finance_manager', 'auditor', 'owner_readonly'];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[group-blocks]', err);
    res.status(safe).json({ success: false, error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.details ? { details: err.details } : {}), ...(typeof err.code === 'string' ? { code: err.code } : {}) });
  }
};
function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
function actorOf(req) { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; }

router.get('/', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה לקבוצות'); return listBlocks({ propertyId: scope(req), view: req.query.view, q: req.query.q }); }));
router.get('/:id', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה לקבוצות'); return getBlock({ propertyId: scope(req), id: req.params.id }); }));
router.post('/', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה לפתוח קבוצה'); return createBlock({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.patch('/:id', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return updateBlock({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/:action(confirm|cancel|release)', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return setBlockStatus({ propertyId: scope(req), id: req.params.id, action: req.params.action, reason: req.body?.reason, roomTypeId: req.body?.roomTypeId, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/pickup', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return pickupFromBlock({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.put('/:id/rooming-list', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return saveRoster({ propertyId: scope(req), id: req.params.id, entries: req.body?.entries, actor: actorOf(req), ip: req.ip }); }));

export default router;
