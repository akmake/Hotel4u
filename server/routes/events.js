// /api/pms/events — function spaces, event bookings, search and the spaces × days chart.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import { listSpaces, saveSpace, searchEvents, eventsChart, getEvent, createEvent, updateEvent, setEventStatus, openEventFolio, EVENT_WORK } from '../services/eventService.js';

const router = Router();
const READ = [...EVENT_WORK, 'finance_manager', 'housekeeping_manager', 'maintenance_manager', 'auditor', 'owner_readonly'];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[events]', err);
    res.status(safe).json({ success: false, error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}), ...(typeof err.code === 'string' ? { code: err.code } : {}) });
  }
};
function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
function actorOf(req) { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; }

router.get('/spaces', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return listSpaces({ propertyId: scope(req), all: req.query.all === '1' }); }));
router.post('/spaces', handle(async (req) => saveSpace({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.patch('/spaces/:id', handle(async (req) => saveSpace({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.get('/chart', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return eventsChart({ propertyId: scope(req), from: req.query.from, days: req.query.days }); }));
router.get('/', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); const q = req.query; return searchEvents({ propertyId: scope(req), from: q.from, to: q.to, q: q.q, status: q.status, spaceId: q.spaceId }); }));
router.get('/:id', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return getEvent({ propertyId: scope(req), id: req.params.id }); }));
router.post('/', handle(async (req) => { requireRoles(req, EVENT_WORK, 'אין הרשאה לאירועים'); return createEvent({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.patch('/:id', handle(async (req) => { requireRoles(req, EVENT_WORK, 'אין הרשאה לאירועים'); return updateEvent({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/status', handle(async (req) => { requireRoles(req, EVENT_WORK, 'אין הרשאה לאירועים'); return setEventStatus({ propertyId: scope(req), id: req.params.id, status: req.body?.status, reason: req.body?.reason, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/folio', handle(async (req) => { requireRoles(req, ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'finance_manager', 'cashier', 'sales_manager'], 'אין הרשאה לפתוח חשבון'); return openEventFolio({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip }); }));

export default router;
