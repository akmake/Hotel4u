import AuditLog from '../models/AuditLog.js';

export async function audit({ property, actor, actorName, action, entityType, entityId, before, after, reason, ip }) {
  await AuditLog.create({ property, actor, actorName, action, entityType, entityId, before, after, reason, ip });
}
