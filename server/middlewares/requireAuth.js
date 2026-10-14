import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export default async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.jwt;
    if (!token) {
      return res.status(401).json({ msg: 'Unauthorized: No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    const user = await User.findById(decoded.id).select('-passwordHash -totpSecret');
    if (!user) {
      return res.status(401).json({ msg: 'Unauthorized: User not found' });
    }
    // A deactivated account or an expired access window ends the cookie session too (ADM-06).
    if (user.active === false || (user.accessUntil && user.accessUntil < new Date())) {
      return res.status(401).json({ msg: 'Unauthorized: User inactive' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ msg: 'Unauthorized' });
  }
}