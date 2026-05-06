/**
 * notificationDispatcher.js
 *
 * Dispatches a Notification document to its delivery channel.
 * Called automatically after every Notification.create() in notificationService.
 *
 * Channels:
 *   in_app  — already stored in DB; no extra delivery needed
 *   email   — sends via emailService
 *   sms     — sends via smsService
 *   push    — stub (not yet wired)
 *
 * Recipient resolution order:
 *   1. notification.recipientUser  → load User.email / phone
 *   2. notification.entityType === 'Reservation' → load primaryGuest email/phone
 *   3. params.to (override from caller)
 */

import User         from '../models/User.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation  from '../models/Reservation.js';
import { sendEmail, buildGenericEmail } from './emailService.js';
import { sendSms }                      from './smsService.js';

// ── Recipient resolution ──────────────────────────────────────────────────────

async function resolveRecipientEmail(notification) {
  if (notification.recipientUser) {
    const user = await User.findById(notification.recipientUser).select('email').lean();
    return user?.email || null;
  }
  if (notification.entityType === 'Reservation' && notification.entityId) {
    const res = await Reservation.findById(notification.entityId)
      .populate('primaryGuest', 'email emails')
      .lean();
    return res?.primaryGuest?.email
      || res?.primaryGuest?.emails?.[0]?.address
      || null;
  }
  return null;
}

async function resolveRecipientPhone(notification) {
  if (notification.recipientUser) {
    return null; // Users don't have phone in current model
  }
  if (notification.entityType === 'Reservation' && notification.entityId) {
    const res = await Reservation.findById(notification.entityId)
      .populate('primaryGuest', 'phone phones')
      .lean();
    return res?.primaryGuest?.phone
      || res?.primaryGuest?.phones?.[0]?.number
      || null;
  }
  return null;
}

// ── Channel dispatchers ───────────────────────────────────────────────────────

async function dispatchEmail(notification) {
  const to = await resolveRecipientEmail(notification);
  if (!to) {
    console.warn(`[dispatcher] email channel: no recipient email for notification ${notification._id}`);
    return;
  }

  const { subject, html, text } = buildGenericEmail({
    subject:      notification.title,
    message:      notification.body,
    propertyName: undefined,
  });

  await sendEmail({ to, subject, html, text });
}

async function dispatchSms(notification) {
  const to = await resolveRecipientPhone(notification);
  if (!to) {
    console.warn(`[dispatcher] sms channel: no recipient phone for notification ${notification._id}`);
    return;
  }

  const body = `${notification.title}${notification.body ? '\n' + notification.body : ''}`;
  await sendSms({ to, body });
}

// ── Main dispatch function ────────────────────────────────────────────────────

/**
 * Dispatch a notification to its channel. Never throws — errors are logged.
 * @param {object} notification  — Mongoose document or plain object from Notification.create()
 */
export async function dispatch(notification) {
  if (!notification) return;

  const channel = notification.channel || 'in_app';

  if (channel === 'in_app') return; // already in DB — nothing to dispatch

  try {
    if (channel === 'email') {
      await dispatchEmail(notification);
    } else if (channel === 'sms') {
      await dispatchSms(notification);
    } else if (channel === 'push') {
      // Push not yet wired — no-op
    }
  } catch (err) {
    console.error(`[dispatcher] Failed to dispatch ${channel} notification ${notification._id}:`, err.message);
  }
}

/**
 * Convenience: dispatch a one-off email directly (bypasses Notification model).
 * Used for transactional emails from automationEngine actions.
 *
 * @param {{ to: string, subject: string, html?: string, text?: string }} params
 */
export async function dispatchDirectEmail(params) {
  try {
    await sendEmail(params);
  } catch (err) {
    console.error('[dispatcher] dispatchDirectEmail failed:', err.message);
  }
}

/**
 * Convenience: dispatch a one-off SMS directly.
 *
 * @param {{ to: string, body: string }} params
 */
export async function dispatchDirectSms(params) {
  try {
    await sendSms(params);
  } catch (err) {
    console.error('[dispatcher] dispatchDirectSms failed:', err.message);
  }
}
