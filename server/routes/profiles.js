// /api/pms/profiles — guest profile extras (files, relations, restriction, past stays, revenue, history), company extras, booking profiles.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireActor } from '../middleware/authContext.js';
import * as pf from '../services/profileService.js';

const router = Router();
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[profiles]', err);
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
const read = (req) => { if (![...pf.PROFILE_ROLES, 'auditor', 'owner_readonly'].includes(req.actor?.role)) throw Object.assign(new Error('אין הרשאה לפרופילים'), { status: 403 }); };
const b = (req) => req.body || {};

router.use(requireActor);
router.get('/guests/:id', handle(async (req) => { read(req); return pf.profileExtras({ propertyId: scope(req), guestId: req.params.id }); }));
router.put('/guests/:id/relations', handle(async (req) => pf.saveRelations({ propertyId: scope(req), guestId: req.params.id, relations: b(req).relations, actor: actorOf(req), ip: req.ip })));
router.put('/guests/:id/restriction', handle(async (req) => pf.setRestriction({ propertyId: scope(req), guestId: req.params.id, body: b(req), actor: actorOf(req), ip: req.ip })));
router.post('/guests/:id/past-stays', handle(async (req) => pf.addPastStay({ propertyId: scope(req), guestId: req.params.id, body: b(req), actor: actorOf(req), ip: req.ip })));
router.post('/guests/:id/files', handle(async (req) => pf.addFile({ propertyId: scope(req), guestId: req.params.id, body: b(req), actor: actorOf(req), ip: req.ip })));
router.post('/files/:fileId/remove', handle(async (req) => pf.removeFile({ propertyId: scope(req), fileId: req.params.fileId, actor: actorOf(req), ip: req.ip })));
router.get('/files/:fileId', async (req, res) => {
  try {
    read(req);
    const f = await pf.getFile({ propertyId: scope(req), fileId: req.params.fileId });
    res.set({ 'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'Cache-Control': 'private, no-store' });
    res.send(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data.buffer || f.data));
  } catch (err) { res.status(Number(err.status || 500)).json({ success: false, error: err.message }); }
});
router.get('/companies/:id', handle(async (req) => { read(req); return pf.companyExtras({ propertyId: scope(req), companyId: req.params.id }); }));
router.put('/companies/:id/account-manager', handle(async (req) => pf.setAccountManager({ propertyId: scope(req), companyId: req.params.id, userId: b(req).userId, actor: actorOf(req), ip: req.ip })));
router.put('/reservations/:id', handle(async (req) => pf.setBookingProfiles({ propertyId: scope(req), reservationId: req.params.id, body: b(req), actor: actorOf(req), ip: req.ip })));

export default router;
