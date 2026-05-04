import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../middleware/errorHandler.js';
import User, { ROLES } from '../models/User.js';

const router = Router();

// GET /api/users?propertyId=
router.get('/', asyncHandler(async (req, res) => {
  const users = await User.find({ property: req.query.propertyId })
    .select('-passwordHash').sort({ createdAt: 1 }).lean();
  res.json({ success: true, data: users });
}));

// POST /api/users
router.post('/', asyncHandler(async (req, res) => {
  const { propertyId, firstName, lastName, email, password, role } = req.body;
  if (!firstName || !lastName || !email || !password || !role)
    return res.status(400).json({ success: false, error: 'שדות חובה חסרים' });
  if (!ROLES.includes(role))
    return res.status(400).json({ success: false, error: 'תפקיד לא תקין' });

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) return res.status(400).json({ success: false, error: 'אימייל כבר קיים במערכת' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ property: propertyId, firstName, lastName, email, passwordHash, role });
  const { passwordHash: _, ...safe } = user.toObject();
  res.json({ success: true, data: safe });
}));

// PATCH /api/users/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const { role, active, firstName, lastName, password } = req.body;
  const update = {};
  if (role      !== undefined) { if (!ROLES.includes(role)) return res.status(400).json({ success: false, error: 'תפקיד לא תקין' }); update.role = role; }
  if (active    !== undefined) update.active = active;
  if (firstName !== undefined) update.firstName = firstName;
  if (lastName  !== undefined) update.lastName  = lastName;
  if (password)                update.passwordHash = await bcrypt.hash(password, 12);

  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-passwordHash').lean();
  if (!user) return res.status(404).json({ success: false, error: 'משתמש לא נמצא' });
  res.json({ success: true, data: user });
}));

export default router;
