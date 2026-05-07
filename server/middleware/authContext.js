import jwt from 'jsonwebtoken';

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

export function attachActor(req, _res, next) {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = safeVerifyToken(bearer);

  if (payload) {
    req.actor = {
      id: payload.id || null,
      firstName: payload.firstName || '',
      lastName: payload.lastName || '',
      name: `${payload.firstName || ''} ${payload.lastName || ''}`.trim() || 'unknown',
      email: payload.email || null,
      role: payload.role || null,
      propertyId: payload.propertyId || null,
    };
  } else {
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
