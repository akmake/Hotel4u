/**
 * פרק י"ט סעיף 39 — Webhook Subscriptions
 * Hotels can subscribe to events and receive HTTP callbacks.
 */
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const WEBHOOK_EVENTS = [
  'reservation.created',
  'reservation.modified',
  'reservation.cancelled',
  'guest.checked_in',
  'guest.checked_out',
  'room.status_changed',
  'payment.succeeded',
  'payment.failed',
  'folio.closed',
  'invoice.created',
  'maintenance.created',
  'housekeeping.completed',
];

const WebhookSubscriptionSchema = new Schema({
  property:        { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  url:             { type: String, required: true },
  events:          [{ type: String, enum: WEBHOOK_EVENTS }],
  // HMAC-SHA256 signing secret — stored; never returned in API responses
  secret:          { type: String, required: true },
  active:          { type: Boolean, default: true },
  description:     String,
  lastDeliveredAt: Date,
  failureCount:    { type: Number, default: 0 },
  createdBy:       { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

WebhookSubscriptionSchema.index({ property: 1, active: 1 });

export default model('WebhookSubscription', WebhookSubscriptionSchema);
