/**
 * notificationService.js
 *
 * Centralised helper so any route / service can push a notification
 * without duplicating schema knowledge.
 *
 * Usage:
 *   import { push } from './notificationService.js';
 *   await push({ property, type: 'reservation.new', title: '...', body: '...' });
 */

import Notification from '../models/Notification.js';

/**
 * @param {object} params
 * @param {string}  params.property        - Property ObjectId or string
 * @param {string}  params.type            - NOTIFICATION_TYPES value
 * @param {string}  params.title
 * @param {string}  params.body
 * @param {string} [params.priority]       - low|normal|high|critical (default: normal)
 * @param {string} [params.channel]        - in_app|email|sms|push (default: in_app)
 * @param {string} [params.recipientUserId]
 * @param {string} [params.recipientRole]
 * @param {string} [params.entityType]
 * @param {string} [params.entityId]
 * @param {string} [params.link]
 * @param {number} [params.expiresInHours]
 * @param {string} [params.createdBy]
 * @returns {Promise<import('../models/Notification.js').default>}
 */
export async function push({
  property,
  type,
  title,
  body,
  priority = 'normal',
  channel = 'in_app',
  recipientUserId,
  recipientRole,
  entityType,
  entityId,
  link,
  expiresInHours,
  createdBy,
}) {
  return Notification.create({
    property,
    type,
    title,
    body,
    priority,
    channel,
    recipientUser:  recipientUserId || undefined,
    recipientRole:  recipientRole   || undefined,
    entityType:     entityType      || undefined,
    entityId:       entityId        || undefined,
    link:           link            || undefined,
    expiresAt:      expiresInHours ? new Date(Date.now() + Number(expiresInHours) * 3600000) : undefined,
    createdBy:      createdBy       || undefined,
  });
}

/**
 * Fire-and-forget wrapper — swallows errors so callers don't need try/catch
 */
export function pushSilent(params) {
  push(params).catch(err =>
    console.error('[notificationService] failed to create notification:', err.message)
  );
}
