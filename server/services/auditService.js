import AuditLog from '../models/AuditLog.js';

/**
 * Write an immutable audit entry.
 * Swallows errors so that a logging failure never breaks the main request.
 */
export async function audit({
  property, actor, actorName, action, entityType, entityId,
  before, after, reason, ip, userAgent,
}) {
  try {
    await AuditLog.create({
      property,
      actor: actor || undefined,
      actorName: actorName || 'system',
      action,
      entityType,
      entityId,
      before:    before    || undefined,
      after:     after     || undefined,
      reason:    reason    || undefined,
      ip:        ip        || undefined,
      userAgent: userAgent || undefined,
    });
  } catch (err) {
    // Never propagate — audit is fire-and-forget
    console.error('[audit] write failed:', err.message);
  }
}

/**
 * Helper: build audit context from express request.
 */
export function auditCtxFromReq(req) {
  return {
    actor:     req.actor?.id     || null,
    actorName: req.actor?.name   || 'system',
    ip:        req.ip            || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
  };
}
