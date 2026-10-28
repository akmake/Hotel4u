/**
 * automationEngine.js
 *
 * Evaluates AutomationRules on PMS events and executes their actions.
 *
 * Usage (fire-and-forget — never throws to caller):
 *   import { fireEvent } from './automationEngine.js';
 *   fireEvent('reservation.created', { reservation, property: propertyId, actor });
 */

import AutomationRule from '../models/AutomationRule.js';
import Notification    from '../models/Notification.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Room            from '../models/Room.js';
import RoomType        from '../models/RoomType.js';
import Property        from '../models/Property.js';
import Reservation     from '../models/Reservation.js';
import GuestProfile    from '../models/GuestProfile.js';
import Folio           from '../models/Folio.js';
import { financialWrite } from './financialTransaction.js';
import { openBusinessDate } from '../utils/businessDate.js';
import { push as pushNotification } from './notificationService.js';
import { emit as emitWebhook }     from './webhookService.js';
import { dispatchDirectEmail, dispatchDirectSms } from './notificationDispatcher.js';
import { buildGenericEmail, buildPaymentLinkEmail, buildReservationConfirmationEmail } from './emailService.js';
import { buildPaymentLinkSms } from './smsService.js';

// ── Field resolver ────────────────────────────────────────────────────────────

function get(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

// ── Condition evaluator ───────────────────────────────────────────────────────

function evalCondition(condition, ctx) {
  const { field, operator, value } = condition;
  const actual = get(ctx, field);

  switch (operator) {
    case 'eq':       return actual == value;           // intentional loose eq
    case 'ne':       return actual != value;
    case 'gt':       return Number(actual) >  Number(value);
    case 'lt':       return Number(actual) <  Number(value);
    case 'gte':      return Number(actual) >= Number(value);
    case 'lte':      return Number(actual) <= Number(value);
    case 'in':       return Array.isArray(value) ? value.includes(actual) : false;
    case 'nin':      return Array.isArray(value) ? !value.includes(actual) : true;
    case 'contains': return typeof actual === 'string' && actual.toLowerCase().includes(String(value).toLowerCase());
    default:         return false;
  }
}

function evalConditionSet(conditions, ctx) {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every(c => evalCondition(c, ctx));
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function handleCreateAlert(params, ctx) {
  const propertyId = ctx.property;
  const title      = interpolate(params.title || 'Automation alert', ctx);
  const body       = interpolate(params.body  || '', ctx);
  await pushNotification({
    property: propertyId,
    type:     params.notificationType || 'system_health',
    title,
    body,
    priority: params.priority || 'normal',
    channel:  'in_app',
    recipientRole: params.recipientRole || undefined,
    entityType: ctx._entityType || undefined,
    entityId:   ctx._entityId   || undefined,
  });
}

async function handleNotifyStaff(params, ctx) {
  const propertyId = ctx.property;
  const title      = interpolate(params.title || 'Staff notification', ctx);
  const body       = interpolate(params.body  || '', ctx);
  await pushNotification({
    property: propertyId,
    type:     params.notificationType || 'system_health',
    title,
    body,
    priority:      params.priority     || 'normal',
    channel:       params.channel      || 'in_app',
    recipientRole: params.recipientRole || undefined,
    recipientUserId: params.recipientUserId || undefined,
    entityType: ctx._entityType || undefined,
    entityId:   ctx._entityId   || undefined,
  });
}

async function handleCreateHousekeepingTask(params, ctx) {
  const propertyId = ctx.property;
  const roomId     = params.roomId || get(ctx, 'room._id') || get(ctx, 'reservation.assignedRoom') || undefined;
  if (!roomId) return;
  const existingOpen = await HousekeepingTask.findOne({
    property: propertyId,
    room:     roomId,
    status:   { $in: ['pending', 'assigned', 'in_progress'] },
    type:     params.type || 'clean',
  }).lean();
  if (existingOpen) return;

  await HousekeepingTask.create({
    property:     propertyId,
    room:         roomId,
    type:         params.type     || 'clean',
    priority:     params.priority || 'normal',
    notes:        params.notes    || `Automation: ${ctx._triggerName || ''}`,
    reservation:  get(ctx, 'reservation._id') || undefined,
    status:       'pending',
  });
}

async function handleCreateMaintenanceTicket(params, ctx) {
  const propertyId = ctx.property;
  const roomId     = params.roomId || get(ctx, 'room._id') || undefined;
  await MaintenanceTicket.create({
    property:    propertyId,
    room:        roomId  || undefined,
    category:    params.category    || 'other',
    description: interpolate(params.description || `Automation: ${ctx._triggerName || ''}`, ctx),
    priority:    params.priority    || 'medium',
    status:      'new',
    blocksRoom:  !!params.blocksRoom,
  });
}

async function handleUpdateRoomStatus(params, ctx) {
  const roomId = params.roomId || get(ctx, 'room._id') || get(ctx, 'reservation.assignedRoom');
  if (!roomId) return;
  const update = {};
  if (params.opsStatus)   update.opsStatus   = params.opsStatus;
  if (params.cleanStatus) update.cleanStatus = params.cleanStatus;
  if (!Object.keys(update).length) return;
  await Room.findByIdAndUpdate(roomId, { $set: update });
}

async function handleUpdateReservation(params, ctx) {
  const reservationId = params.reservationId || get(ctx, 'reservation._id');
  if (!reservationId) return;
  const allowed = ['internalNotes', 'guestNotes', 'isVip', 'isFlagged', 'flagReason', 'marketSegment'];
  const patch = {};
  for (const key of allowed) {
    if (params[key] !== undefined) patch[key] = params[key];
  }
  if (!Object.keys(patch).length) return;
  await Reservation.findByIdAndUpdate(reservationId, { $set: patch });
}

async function handlePostCharge(params, ctx) {
  const reservationId = params.reservationId || get(ctx, 'reservation._id');
  if (!reservationId || !params.amount) return;
  const reservation = await Reservation.findById(reservationId).select('property').lean();
  if (!reservation) return;
  return financialWrite(`automation:${reservationId}`, async (session) => {
  const folio = await Folio.findOne({ reservation: reservationId, status: 'open' }).session(session).sort({ createdAt: -1 });
  if (!folio) return;
  const property = await Property.findById(reservation.property).session(session).select('timezone dayClose').lean();
  folio.lines.push({
    type:        'charge',
    serviceDate: openBusinessDate(property),
    description: interpolate(params.description || 'Automation charge', ctx),
    amount:      Number(params.amount),
    taxAmount:   Number(params.taxAmount || 0),
    currency:    params.currency || folio.currency || 'ILS',
    source:      'manual',
    status:      'posted',
    postedAt:    new Date(),
  });
  await folio.save({ session });
  }, String(reservation.property));
}

async function resolveGuestContact(ctx) {
  // Returns { email, phone } from context (reservation.primaryGuest or explicit params)
  const guestId = get(ctx, 'reservation.primaryGuest');
  if (!guestId) return {};
  const guest = await GuestProfile.findById(guestId).select('email phone emails phones firstName lastName').lean();
  if (!guest) return {};
  return {
    email: guest.email || guest.emails?.[0]?.address || null,
    phone: guest.phone || guest.phones?.[0]?.number  || null,
    name:  `${guest.firstName || ''} ${guest.lastName || ''}`.trim() || null,
  };
}

async function handleSendMessage(params, ctx) {
  const subject = interpolate(params.subject || params.title || 'הודעה מהמלון', ctx);
  const body    = interpolate(params.body    || '', ctx);
  const channel = params.channel || 'email';

  if (channel === 'email' || channel === 'both') {
    const toEmail = params.to || (await resolveGuestContact(ctx)).email;
    if (toEmail) {
      const { subject: s, html, text } = buildGenericEmail({
        subject,
        message:      body,
        guestName:    interpolate(params.guestName || '{{reservation.primaryGuest.firstName}}', ctx) || undefined,
        propertyName: params.propertyName || undefined,
      });
      await dispatchDirectEmail({ to: toEmail, subject: s, html, text });
    }
  }

  if (channel === 'sms' || channel === 'both') {
    const toPhone = params.to || (await resolveGuestContact(ctx)).phone;
    if (toPhone) {
      await dispatchDirectSms({ to: toPhone, body: `${subject}${body ? '\n' + body : ''}` });
    }
  }

  // Always create an in-app notification too
  await pushNotification({
    property: ctx.property,
    type:     'reservation.new',
    title:    subject,
    body,
    priority: params.priority || 'normal',
    channel:  'in_app',
    recipientUserId: params.recipientUserId || undefined,
    entityType: ctx._entityType || undefined,
    entityId:   ctx._entityId   || undefined,
  });
}

async function handleSendPaymentLink(params, ctx) {
  const paymentLink = params.paymentLink || params.link;
  const contact     = await resolveGuestContact(ctx);
  const toEmail     = params.toEmail || contact.email;
  const toPhone     = params.toPhone || contact.phone;
  const confirmationNumber = get(ctx, 'reservation.confirmationNumber') || '';
  const amount      = params.amount;
  const currency    = params.currency || 'ILS';

  if (toEmail && paymentLink) {
    const { subject, html, text } = buildPaymentLinkEmail({
      guestName:          contact.name,
      confirmationNumber,
      amount,
      currency,
      paymentLink,
      expiresAt:          params.expiresAt || null,
      propertyName:       params.propertyName || null,
    });
    await dispatchDirectEmail({ to: toEmail, subject, html, text });
  }

  if (toPhone && paymentLink) {
    const body = buildPaymentLinkSms({ confirmationNumber, amount, currency, paymentLink });
    await dispatchDirectSms({ to: toPhone, body });
  }

  // In-app fallback even without a real link
  await pushNotification({
    property: ctx.property,
    type:     'folio.payment_due',
    title:    'שליחת קישור תשלום',
    body:     paymentLink ? `קישור: ${paymentLink}` : 'קישור תשלום לא הוגדר',
    priority: 'normal',
    channel:  'in_app',
    entityType: ctx._entityType || undefined,
    entityId:   ctx._entityId   || undefined,
  });
}

async function handleWebhook(params, ctx) {
  const propertyId = ctx.property;
  const eventType  = params.eventType || ctx._triggerName || 'automation.triggered';
  await emitWebhook(propertyId, eventType, {
    trigger:     ctx._triggerName,
    ruleId:      ctx._ruleId,
    context:     ctx,
    params,
  });
}

async function handleSendConfirmation(params, ctx) {
  const reservation = ctx.reservation;
  if (!reservation?._id) return;

  const [guest, property, roomTypeDoc] = await Promise.all([
    GuestProfile.findById(reservation.primaryGuest).select('firstName lastName email emails').lean(),
    Property.findById(ctx.property).select('name phone email').lean(),
    RoomType.findById(reservation.roomType).select('name').lean(),
  ]);

  const toEmail = guest?.email || guest?.emails?.[0]?.address;
  if (toEmail) {
    const { subject, html, text } = buildReservationConfirmationEmail({
      guestName:          `${guest.firstName || ''} ${guest.lastName || ''}`.trim(),
      confirmationNumber: reservation.confirmationNumber,
      arrivalDate:        reservation.arrivalDate,
      departureDate:      reservation.departureDate,
      roomType:           roomTypeDoc?.name || '',
      nights:             reservation.nights,
      totalAmount:        reservation.totalAmount,
      currency:           reservation.currency || 'ILS',
      propertyName:       property?.name,
      propertyPhone:      property?.phone,
      propertyEmail:      property?.email,
    });
    await dispatchDirectEmail({ to: toEmail, subject, html, text });
  }

  await Reservation.findByIdAndUpdate(reservation._id, { $set: { confirmationSent: true } });
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

const ACTION_HANDLERS = {
  create_alert:              handleCreateAlert,
  notify_staff:              handleNotifyStaff,
  create_housekeeping_task:  handleCreateHousekeepingTask,
  create_maintenance_ticket: handleCreateMaintenanceTicket,
  update_room_status:        handleUpdateRoomStatus,
  update_reservation:        handleUpdateReservation,
  post_charge:               handlePostCharge,
  send_message:              handleSendMessage,
  send_payment_link:         handleSendPaymentLink,
  send_confirmation:         handleSendConfirmation,
  webhook:                   handleWebhook,
};

// ── Simple template interpolation ─────────────────────────────────────────────
// Supports {{reservation.confirmationNumber}}, {{guest.firstName}}, etc.

function interpolate(template, ctx) {
  if (!template || typeof template !== 'string') return template;
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
    const val = get(ctx, path);
    return val != null ? String(val) : '';
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Fire an automation trigger event.
 * Always resolves — never throws. Errors are logged per-rule.
 *
 * @param {string} trigger  - One of TRIGGER_TYPES
 * @param {object} context  - { property: propertyId, reservation?, room?, actor?, ... }
 */
export async function fireEvent(trigger, context = {}) {
  if (!trigger || !context.property) return;

  let rules;
  try {
    rules = await AutomationRule.find({
      property: String(context.property),
      trigger,
      active: true,
    }).lean();
  } catch (err) {
    console.error(`[AutomationEngine] Failed to load rules for ${trigger}:`, err.message);
    return;
  }

  if (!rules.length) return;

  const ctx = {
    ...context,
    _triggerName: trigger,
    property:     String(context.property),
  };

  for (const rule of rules) {
    try {
      // Evaluate conditions
      if (!evalConditionSet(rule.conditions, ctx))  continue;
      // Evaluate exceptions (if any match, skip)
      if (evalConditionSet(rule.exceptions, ctx) && rule.exceptions?.length) continue;

      const handler = ACTION_HANDLERS[rule.action];
      if (!handler) {
        console.warn(`[AutomationEngine] Unknown action type: ${rule.action} (rule ${rule._id})`);
        continue;
      }

      const ruleCtx = { ...ctx, _ruleId: String(rule._id), _entityType: rule.entityType, _entityId: rule.entityId };
      await handler(rule.actionParams || {}, ruleCtx);

      // Update runtime stats (best-effort)
      await AutomationRule.findByIdAndUpdate(rule._id, {
        $inc:  { runCount: 1 },
        $set:  { lastRunAt: new Date(), lastError: null },
      }).catch(() => null);

    } catch (err) {
      console.error(`[AutomationEngine] Rule ${rule._id} (${rule.name}) failed on ${trigger}:`, err.message);
      await AutomationRule.findByIdAndUpdate(rule._id, {
        $set: { lastError: err.message, lastRunAt: new Date() },
      }).catch(() => null);
    }
  }
}
