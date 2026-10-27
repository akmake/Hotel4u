import { emitPropertyChange } from '../socket.js';
import AuditLog from '../models/AuditLog.js';

/**
 * Write an immutable audit entry.
 * Swallows errors so that a logging failure never breaks the main request.
 */
export async function audit({
  property, actor, actorName, action, entityType, entityId,
  before, after, reason, ip, userAgent, session = null, afterCommit = null,
}) {
  try {
    const notify = () => { if (property) emitPropertyChange(String(property), { entity: entityType || null, action: action || null, at: Date.now() }); };
    const entry = {
      property,
      actor: actor || undefined,
      actorName: actorName || 'system',
      action,
      entityType,
      // Bulk actions have no single record: anchor them to the property so the entry is not dropped
      // (entityId is required and a failed write is swallowed below).
      entityId:  entityId || property || undefined,
      before:    before    || undefined,
      after:     after     || undefined,
      reason:    reason    || undefined,
      ip:        ip        || undefined,
      userAgent: userAgent || undefined,
    };
    if (session) await AuditLog.create([entry], { session });
    else await AuditLog.create(entry);
    if (session) afterCommit?.push(notify);
    else notify();
  } catch (err) {
    if (session) throw err;
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
