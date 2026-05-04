import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import { audit, auditCtxFromReq } from '../services/auditService.js';
import User, { ROLES } from '../models/User.js';

const router = Router();
const ADMIN_ROLES = ['super_admin', 'property_admin', 'general_manager'];

// GET /api/users?propertyId=&role=&active=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, role, active } = req.query;
  assertPropertyScope(req, propertyId);
  const filter = { property: propertyId };
  if (role)               filter.role   = role;
  if (active !== undefined) filter.active = active === 'true';
  const users = await User.find(filter).select('-passwordHash').sort({ firstName: 1 }).lean();
  res.json({ success: true, data: users });
}));

// GET /api/users/roles — return valid roles list
router.get('/roles', (req, res) => {
  res.json({ success: true, data: ROLES });
});

// GET /api/users/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-passwordHash').lean();
  if (!user) return res.status(404).json({ success: false, error: 'משתמש לא נמצא' });
  assertPropertyScope(req, String(user.property));
  res.json({ success: true, data: user });
}));

// POST /api/users
router.post('/', asyncHandler(async (req, res) => {
  const { propertyId, firstName, lastName, email, password, role } = req.body;
  assertPropertyScope(req, propertyId);

  if (!firstName || !lastName || !email || !password || !role)
    return res.status(400).json({ success: false, error: 'כל שדות החובה נדרשים' });
  if (!ROLES.includes(role))
    return res.status(400).json({ success: false, error: `תפקיד לא תקין: ${role}` });
  if (password.length < 6)
    return res.status(400).json({ success: false, error: 'הסיסמה חייבת לפחות 6 תווים' });

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) return res.status(400).json({ success: false, error: 'כתובת האימייל כבר בשימוש' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ property: propertyId, firstName, lastName, email, passwordHash, role });
  const safe = user.toObject();
  delete safe.passwordHash;

  await audit({ property: propertyId, ...auditCtxFromReq(req), action: 'user.create', entityType: 'User', entityId: user._id, after: safe });
  res.status(201).json({ success: true, data: safe });
}));

// PATCH /api/users/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'משתמש לא נמצא' });
  assertPropertyScope(req, String(user.property));

  const allowed = ['firstName', 'lastName', 'email', 'role', 'active'];
  const before  = (() => { const o = user.toObject(); delete o.passwordHash; return o; })();
  const update  = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

  if (update.role && !ROLES.includes(update.role))
    return res.status(400).json({ success: false, error: `תפקיד לא תקין: ${update.role}` });

  // Only admins may change a user's role or active status
  if ((update.role || update.active !== undefined) && !ADMIN_ROLES.includes(req.actor?.role))
    return res.status(403).json({ success: false, error: 'אין הרשאה לשנות תפקיד או סטטוס פעילות' });

  if (req.body.password) {
    if (req.body.password.length < 6)
      return res.status(400).json({ success: false, error: 'הסיסמה חייבת לפחות 6 תווים' });
    update.passwordHash = await bcrypt.hash(req.body.password, 12);
  }

  const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-passwordHash').lean();
  await audit({ property: String(user.property), ...auditCtxFromReq(req), action: 'user.update', entityType: 'User', entityId: user._id, before, after: updated });
  res.json({ success: true, data: updated });
}));

// DELETE /api/users/:id — soft delete (deactivate)
router.delete('/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'משתמש לא נמצא' });
  assertPropertyScope(req, String(user.property));

  if (!ADMIN_ROLES.includes(req.actor?.role))
    return res.status(403).json({ success: false, error: 'רק מנהלים יכולים לנטרל משתמשים' });

  if (req.params.id === req.actor?.id)
    return res.status(400).json({ success: false, error: 'לא ניתן לנטרל את עצמך' });

  await User.findByIdAndUpdate(req.params.id, { active: false });
  await audit({ property: String(user.property), ...auditCtxFromReq(req), action: 'user.deactivate', entityType: 'User', entityId: user._id });
  res.json({ success: true, data: { deactivated: true } });
}));

export default router;
