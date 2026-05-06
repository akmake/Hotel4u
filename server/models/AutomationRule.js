/**
 * פרק כ — AutomationRule Model
 * Stores automation rules with trigger → conditions → action logic.
 * Spec section 40.3
 */
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const TRIGGER_TYPES = [
  'reservation.created',
  'reservation.modified',
  'reservation.cancelled',
  'reservation.noshow',
  'checkin.completed',
  'checkout.completed',
  'room.status_changed',
  'payment.failed',
  'payment.succeeded',
  'housekeeping.completed',
  'maintenance.created',
  'maintenance.sla_breach',
  'schedule.daily',
  'schedule.hourly',
];

export const ACTION_TYPES = [
  'send_message',
  'send_confirmation',
  'create_housekeeping_task',
  'create_maintenance_ticket',
  'post_charge',
  'send_payment_link',
  'create_alert',
  'update_room_status',
  'update_reservation',
  'webhook',
  'notify_staff',
];

const ConditionSchema = new Schema({
  field:    { type: String, required: true },   // e.g. "reservation.isVip", "payment.method"
  operator: { type: String, required: true, enum: ['eq','ne','gt','lt','gte','lte','in','nin','contains'] },
  value:    { type: Schema.Types.Mixed, required: true },
}, { _id: false });

const AutomationRuleSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  name:         { type: String, required: true, maxlength: 120 },
  description:  String,
  active:       { type: Boolean, default: true },

  // Trigger
  trigger:      { type: String, enum: TRIGGER_TYPES, required: true },

  // Conditions (ANDed together; empty = always match)
  conditions:   [ConditionSchema],

  // Action
  action:       { type: String, enum: ACTION_TYPES, required: true },
  actionParams: { type: Schema.Types.Mixed },     // action-specific parameters

  // Exceptions: conditions that PREVENT firing even if trigger+conditions match
  exceptions:   [ConditionSchema],

  // Runtime stats
  lastRunAt:    Date,
  runCount:     { type: Number, default: 0 },
  lastError:    String,

  // Owner
  owner:        { type: Schema.Types.ObjectId, ref: 'User' },
  createdBy:    { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

AutomationRuleSchema.index({ property: 1, trigger: 1, active: 1 });

export default model('AutomationRule', AutomationRuleSchema);
