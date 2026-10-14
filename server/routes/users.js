import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope } from '../middleware/authContext.js';
import User, { ROLES } from '../models/User.js';
import { actorPermissions } from '../middleware/permissions.js';
import { createUser, updateUser, deactivateUser } from '../services/identityService.js';

// Never send secrets or lockout state (2FA secret was leaking here).
const SAFE = 'firstName lastName email role active property lastLoginAt accessUntil createdAt twoFactorEnabled';

const router = Router();

// GET /api/users?propertyId=&role=&active=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, role, active } = req.query;
  const scopedPropertyId = propertyId || req.actor?.propertyId;
  assertPropertyScope(req, scopedPropertyId);
  const filter = { property: scopedPropertyId };
  if (role)               filter.role   = role;
  if (active !== undefined) filter.active = active === 'true';
  const users = await User.find(filter).select(SAFE).sort({ firstName: 1 }).lean();
  res.json({ success: true, data: users });
}));

// GET /api/users/roles — return valid roles list
router.get('/roles', (req, res) => {
  res.json({ success: true, data: ROLES });
});

// GET /api/users/me/permissions
// Returns the authenticated actor's full permission list (פרק י"ח section 35)
router.get('/me/permissions', asyncHandler(async (req, res) => {
  const actor = req.actor;
  if (!actor) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const permissions = actorPermissions(actor);
  res.json({ success: true, data: { role: actor.role, permissions } });
}));

// GET /api/users/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select(SAFE).lean();
  if (!user) return res.status(404).json({ success: false, error: 'משתמש לא נמצא' });
  assertPropertyScope(req, String(user.property));
  res.json({ success: true, data: user });
}));

// Writes go through the ADM-06 rules (authority ranks, no admin-chosen passwords, session revoke).
const fail = (res, err) => res.status(Number(err?.status) || 500).json({ success: false, error: Number(err?.status) >= 500 || !err?.status ? 'שגיאת שרת' : err.message, ...(err.fields ? { fields: err.fields } : {}) });
const actorOf = (req) => ({ id: req.actor?.id, name: req.actor?.name, role: req.actor?.role });

router.post('/', asyncHandler(async (req, res) => {
  const propertyId = req.body?.propertyId || req.actor?.propertyId;
  assertPropertyScope(req, propertyId);
  try { res.status(201).json({ success: true, data: await createUser({ propertyId, input: req.body || {}, actor: actorOf(req), ip: req.ip }) }); } catch (e) { fail(res, e); }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('property').lean();
  if (!user) return res.status(404).json({ success: false, error: 'משתמש לא נמצא' });
  assertPropertyScope(req, String(user.property));
  try {
    if (req.body?.active === false) return res.json({ success: true, data: await deactivateUser({ propertyId: String(user.property), id: req.params.id, reason: req.body?.reason || 'השבתה מהמסך הישן', actor: actorOf(req), ip: req.ip }) });
    if (req.body?.password) return res.status(422).json({ success: false, error: 'סיסמה לא נקבעת על ידי מנהל — יש להנפיק קישור הגדרת סיסמה' });
    res.json({ success: true, data: await updateUser({ propertyId: String(user.property), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }) });
  } catch (e) { fail(res, e); }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('property').lean();
  if (!user) return res.status(404).json({ success: false, error: 'משתמש לא נמצא' });
  assertPropertyScope(req, String(user.property));
  try { res.json({ success: true, data: await deactivateUser({ propertyId: String(user.property), id: req.params.id, reason: req.body?.reason || 'השבתה מהמסך הישן', actor: actorOf(req), ip: req.ip }) }); } catch (e) { fail(res, e); }
}));

export default router;
