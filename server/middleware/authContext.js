import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';

const FALLBACK_JWT_SECRET = 'hotel4u_dev_secret_change_in_prod';

function getJwtSecret() {
  return process.env.JWT_SECRET || FALLBACK_JWT_SECRET;
}

function safeVerifyToken(token) {
  const secret = getJwtSecret();
  if (!token) return null;
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

// The bearer token only says who claims to be calling. On every request the user is re-read: a
// deactivated user, an expired access window, or a token issued before "log out everywhere" /
// a password change (tokenVersion) is rejected; role and property come from the database, so a
// role change applies immediately instead of when the token expires.
export async function attachActor(req, _res, next) {
  req.actor = null;
  try {
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = safeVerifyToken(bearer);
    if (payload?.id && mongoose.isValidObjectId(String(payload.id))) {
      const user = await User.findById(payload.id).select('firstName lastName email role property active tokenVersion accessUntil').lean();
      const tokenVersion = Number(payload.tv || 0);
      const expired = user?.accessUntil && new Date(user.accessUntil) < new Date();
      if (user && user.active !== false && !expired && tokenVersion === Number(user.tokenVersion || 0)) {
        req.actor = {
          id: String(user._id),
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'unknown',
          email: user.email || null,
          role: user.role || null,
          propertyId: user.property ? String(user.property) : null,
        };
      }
    }
  } catch {
    req.actor = null;
  }
  next();
}

export function requireActor(req, res, next) {
  if (!req.actor) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

export function actorOrSystem(req, fallbackName = 'system') {
  if (req.actor) {
    return {
      id: req.actor.id || null,
      name: req.actor.name || fallbackName,
      role: req.actor.role || null,
      propertyId: req.actor.propertyId || null,
    };
  }
  return { id: null, name: fallbackName, role: null, propertyId: null };
}

export function requireRoles(req, roles, message = 'Insufficient permissions') {
  if (!req.actor) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  if (!roles.includes(req.actor.role)) {
    const err = new Error(message);
    err.status = 403;
    throw err;
  }
}

export function assertPropertyScope(req, propertyId) {
  if (!req.actor) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  if (['super_admin', 'chain_admin'].includes(req.actor.role)) {
    if (!propertyId) return;
  }

  if (!propertyId && req.actor.propertyId) return;
  if (!propertyId) {
    const err = new Error('propertyId is required');
    err.status = 400;
    throw err;
  }

  if (!req.actor.propertyId) {
    const err = new Error('Actor has no property scope');
    err.status = 403;
    throw err;
  }

  if (String(req.actor.propertyId) !== String(propertyId)) {
    const err = new Error('Property scope violation');
    err.status = 403;
    throw err;
  }
}
