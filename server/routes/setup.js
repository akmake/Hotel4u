// /api/pms/setup — hotel setup (ADM-01 property, ADM-02 room types, ADM-03 rooms).
// Rules live in services/setupService.js; this file only resolves scope and the actor.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import { roomPhotoUpload, addRoomTypePhoto, setRoomTypePhotos } from '../services/roomTypePhotoService.js';
import { ONLINE_ADMIN_ROLES, getOnlineSettings, saveOnlineSettings } from '../services/publicBookingService.js';
import { SETUP_ROLES, setupOverview, updateProperty, createRoomType, updateRoomType, addRooms, updateRoom } from '../services/setupService.js';

const router = Router();
const READ = [...SETUP_ROLES, 'front_desk_manager', 'revenue_manager', 'maintenance_manager', 'housekeeping_manager', 'auditor', 'owner_readonly'];

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
router.post('/room-types/:id/photos', (req, res, next) => roomPhotoUpload(req, res, (err) => (err ? res.status(422).json({ success: false, error: err.code === 'LIMIT_FILE_SIZE' ? 'התמונה גדולה מ־15MB' : 'קובץ לא תקין' }) : next())),
  handle(async (req) => addRoomTypePhoto({ propertyId: scope(req), typeId: req.params.id, file: req.file, actor: actorOf(req), ip: req.ip })));
router.put('/room-types/:id/photos', handle(async (req) => setRoomTypePhotos({ propertyId: scope(req), typeId: req.params.id, images: req.body?.images, actor: actorOf(req), ip: req.ip })));
// Public booking site: on/off, payment at booking (full / deposit), rate plans sold, texts.
router.get('/online-booking', handle(async (req) => { requireRoles(req, ONLINE_ADMIN_ROLES, 'אין הרשאה'); return getOnlineSettings({ propertyId: scope(req) }); }));
router.put('/online-booking', handle(async (req) => { requireRoles(req, ONLINE_ADMIN_ROLES, 'אין הרשאה לשנות את אתר ההזמנות'); return saveOnlineSettings({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.patch('/rooms/:id', handle(async (req) => updateRoom({ propertyId: scope(req), roomId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip })));

export default router;
