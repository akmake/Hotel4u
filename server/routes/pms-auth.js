import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { asyncHandler } from '../middleware/errorHandler.js';
import { audit, auditCtxFromReq } from '../services/auditService.js';
import User from '../models/User.js';

const router = Router();
const FALLBACK_JWT_SECRET = 'hotel4u_dev_secret_change_in_prod';

function getJwtSecret() {
  return process.env.JWT_SECRET || FALLBACK_JWT_SECRET;
}

function signTokens(payload) {
  const secret = getJwtSecret();
  const access  = jwt.sign(payload, secret, { expiresIn: '8h' });
  const refresh = jwt.sign({ id: payload.id }, secret, { expiresIn: '7d' });
  return { access, refresh };
}

function buildPayload(user) {
  return {
    id:         String(user._id),
    firstName:  user.firstName,
    lastName:   user.lastName,
    email:      user.email,
    role:       user.role,
    propertyId: String(user.property),
  };
}

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success: false, error: 'נדרשים אימייל וסיסמה' });

  const user = await User.findOne({ email: email.toLowerCase(), active: true });
  if (!user)
    return res.status(401).json({ success: false, error: 'אימייל או סיסמה שגויים' });

  const ok = await user.comparePassword(password);
  if (!ok)
    return res.status(401).json({ success: false, error: 'אימייל או סיסמה שגויים' });

  user.lastLoginAt = new Date();
  await user.save();

  const payload = buildPayload(user);
  const { access, refresh } = signTokens(payload);

  await audit({
    property:   String(user.property),
    actor:      String(user._id),
    actorName:  `${user.firstName} ${user.lastName}`,
    action:     'auth.login',
    entityType: 'User',
    entityId:   user._id,
    ip:         req.ip || req.headers['x-forwarded-for'],
    userAgent:  req.headers['user-agent'],
  });

  res.json({ success: true, data: { token: access, refreshToken: refresh, user: payload } });
}));

// POST /api/auth/refresh
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(400).json({ success: false, error: 'refreshToken נדרש' });

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, getJwtSecret());
  } catch {
    return res.status(401).json({ success: false, error: 'Token לא תקין או פג תוקף' });
  }

  const user = await User.findOne({ _id: decoded.id, active: true });
  if (!user) return res.status(401).json({ success: false, error: 'משתמש לא נמצא' });

  const payload = buildPayload(user);
  const { access, refresh } = signTokens(payload);
  res.json({ success: true, data: { token: access, refreshToken: refresh, user: payload } });
}));

// POST /api/auth/logout
router.post('/logout', asyncHandler(async (req, res) => {
  // Stateless JWT — client drops token. Log the event if actor is attached.
  if (req.actor?.id) {
    await audit({
      property:   req.actor.propertyId,
      actor:      req.actor.id,
      actorName:  req.actor.name,
      action:     'auth.logout',
      entityType: 'User',
      entityId:   req.actor.id,
      ip:         req.ip,
    });
  }
  res.json({ success: true });
}));

// GET /api/auth/me
router.get('/me', asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ success: false, error: 'לא מחובר' });

  try {
    const payload = jwt.verify(auth.slice(7), getJwtSecret());
    // Return fresh user data from DB
    const user = await User.findOne({ _id: payload.id, active: true }).select('-passwordHash').lean();
    if (!user) return res.status(401).json({ success: false, error: 'משתמש לא פעיל' });
    res.json({ success: true, data: buildPayload(user) });
  } catch {
    res.status(401).json({ success: false, error: 'Token פג תוקף' });
  }
}));

// POST /api/auth/change-password
router.post('/change-password', asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!req.actor?.id)
    return res.status(401).json({ success: false, error: 'לא מחובר' });
  if (!currentPassword || !newPassword || newPassword.length < 6)
    return res.status(400).json({ success: false, error: 'סיסמה חדשה חייבת לפחות 6 תווים' });

  const user = await User.findById(req.actor.id);
  if (!user) return res.status(404).json({ success: false, error: 'משתמש לא נמצא' });

  const ok = await user.comparePassword(currentPassword);
  if (!ok) return res.status(401).json({ success: false, error: 'הסיסמה הנוכחית שגויה' });

  user.passwordHash = newPassword; // pre-save hook will hash
  await user.save();

  await audit({ property: String(user.property), ...auditCtxFromReq(req), action: 'auth.change_password', entityType: 'User', entityId: user._id });
  res.json({ success: true });
}));

export default router;
