import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { loginUser, logout, refresh, signPmsToken, verifyMfaLogin } from '../controllers/authController.js';
import requireAuth from '../middlewares/requireAuth.js';
import requireRefresh from '../middlewares/requireRefresh.js';
import { requestPasswordReset, resetPassword } from '../services/identityService.js';
import { pmsJwtSecret } from '../utils/jwtSecret.js';

const getPmsJwtSecret = pmsJwtSecret;

const router = Router();

// POST /api/auth/login
router.post('/login', loginUser);
// SYS-01 two-factor: second step of the login (ticket from /login + 6-digit or recovery code).
router.post('/mfa', verifyMfaLogin);

// SYS-02 — password recovery. The answer is the same whether or not the address exists.
const respond = (fn) => async (req, res) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    const status = Number(err?.status) || 500;
    res.status(status).json({ success: false, error: status >= 500 ? 'שגיאת שרת' : err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.code ? { code: err.code } : {}) });
  }
};
router.post('/password/request', respond((req) => requestPasswordReset({ email: req.body?.email, origin: process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`, ip: req.ip })));
router.post('/password/reset', respond((req) => resetPassword({ token: req.body?.token, password: req.body?.password, ip: req.ip })));

// POST /api/auth/register — closed. Accounts are created only by an administrator (ADM-06, /pms/admin/users).
router.post('/register', (req, res) => res.status(410).json({ success: false, message: 'ההרשמה העצמית סגורה. משתמש חדש נוצר על ידי מנהל המערכת.' }));

// POST /api/auth/logout
router.post('/logout', logout);

// POST /api/auth/refresh
router.post('/refresh', requireRefresh, refresh);

// GET /api/auth/me — supports both Bearer token (PMS) and HttpOnly cookie (Ziporiclass)
router.get('/me', async (req, res, next) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), getPmsJwtSecret());
      const user = await User.findOne({ _id: payload.id, active: true }).select('-passwordHash -totpSecret').lean();
      if (!user) return res.status(401).json({ success: false, error: 'משתמש לא פעיל' });
      // Same gate as the PMS API: revoked sessions and expired access are not "logged in".
      if (Number(payload.tv || 0) !== Number(user.tokenVersion || 0) || (user.accessUntil && new Date(user.accessUntil) < new Date())) {
        return res.status(401).json({ success: false, error: 'המושב הסתיים — יש להתחבר מחדש' });
      }
      return res.json({
        _id: user._id,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        propertyId: user.property ? String(user.property) : null,
        canManagePriceLists: user.canManagePriceLists,
        canViewCommissions: user.canViewCommissions,
      });
    } catch {
      return res.status(401).json({ success: false, error: 'Token פג תוקף' });
    }
  }
  requireAuth(req, res, next);
}, (req, res) => {
  const user = req.user;
  res.json({
    _id: user._id,
    // PMS users have firstName/lastName and an empty `name`
    name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    propertyId: user.property ? String(user.property) : null,
    canManagePriceLists: user.canManagePriceLists,
    canViewCommissions: user.canViewCommissions,
    // A valid cookie session also yields a fresh PMS token, so the two auth paths can't drift
    // apart (otherwise an expired PMS token left the user "logged in" but locked out of /pms).
    token: user.active === false ? undefined : signPmsToken(user),
  });
});

export default router;
