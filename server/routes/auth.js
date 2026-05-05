import { Router } from 'express';
import { loginUser, logout, refresh, registerUser } from '../controllers/authController.js';
import requireAuth from '../middlewares/requireAuth.js';
import requireRefresh from '../middlewares/requireRefresh.js';

const router = Router();

// POST /api/auth/login
router.post('/login', loginUser);

// POST /api/auth/register
router.post('/register', registerUser);

// POST /api/auth/logout
router.post('/logout', logout);

// POST /api/auth/refresh
router.post('/refresh', requireRefresh, refresh);

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = req.user;
  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    canManagePriceLists: user.canManagePriceLists,
    canViewCommissions: user.canViewCommissions,
  });
});

export default router;
