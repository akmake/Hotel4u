// /api/pms/setup — hotel setup (ADM-01 property, ADM-02 room types, ADM-03 rooms).
// Rules live in services/setupService.js; this file only resolves scope and the actor.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import { SETUP_ROLES, setupOverview, updateProperty, createRoomType, updateRoomType, addRooms, updateRoom } from '../services/setupService.js';

const router = Router();
const READ = [...SETUP_ROLES, 'front_desk_manager', 'revenue_manager', 'auditor', 'owner_readonly'];

const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    res.status(status).json({ success: false, error: status >= 500 ? 'שגיאת שרת' : err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.code ? { code: err.code } : {}) });
    if (status >= 500) console.error('[setup]', err);
  }
};
function scope(req) {
  const id = String(req.query.propertyId || req.body?.propertyId || req.actor?.propertyId || '');
  if (!id) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, id);
  return id;
}
const actorOf = (req) => actorOrSystem(req);

router.get('/', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return setupOverview({ propertyId: scope(req) }); }));
router.patch('/property', handle(async (req) => updateProperty({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.post('/room-types', handle(async (req) => createRoomType({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.patch('/room-types/:id', handle(async (req) => updateRoomType({ propertyId: scope(req), typeId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.post('/rooms', handle(async (req) => addRooms({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.patch('/rooms/:id', handle(async (req) => updateRoom({ propertyId: scope(req), roomId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip })));

export default router;
