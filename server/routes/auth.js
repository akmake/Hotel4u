import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { asyncHandler } from '../middleware/errorHandler.js';
import User from '../models/User.js';

const router = Router();

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

  const payload = {
    id:         String(user._id),
    firstName:  user.firstName,
    lastName:   user.lastName,
    email:      user.email,
    role:       user.role,
    propertyId: String(user.property),
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });

  res.json({
    success: true,
    data: { token, user: payload },
  });
}));

// POST /api/auth/logout — client-side only (just acknowledge)
router.post('/logout', (req, res) => res.json({ success: true }));

// GET /api/auth/me — validate token and return user info
router.get('/me', asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ success: false, error: 'לא מחובר' });

  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    res.json({ success: true, data: payload });
  } catch {
    res.status(401).json({ success: false, error: 'Token פג תוקף' });
  }
}));

export default router;
