/**
 * פרק י"ט סעיף 38 — Integration Event Log
 * Tracks every inbound/outbound call to external systems.
 */
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const INTEGRATION_SOURCES = [
  'channel_manager',   // Booking.com, Expedia, Agoda, Airbnb, GDS
  'payment_gateway',   // Cardcom, Stripe, Adyen
  'booking_engine',    // hotel website
  'pos',               // point of sale
  'door_lock',         // key card system
  'passport_scanner',
  'email',
  'sms',
  'whatsapp',
  'crm',
  'accounting',
  'tax_invoice',       // irs/shaam
  'revenue_management',
  'webhook_delivery',  // outbound webhooks
  'other',
];

export const INTEGRATION_STATUS = ['pending', 'success', 'failed', 'retrying', 'dead_letter'];

const IntegrationLogSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  source:       { type: String, enum: INTEGRATION_SOURCES, required: true },
  destination:  { type: String, required: true },          // e.g. "booking.com", "cardcom"
  eventType:    { type: String, required: true },          // e.g. "availability.push"
  direction:    { type: String, enum: ['inbound', 'outbound'], default: 'outbound' },
  payloadId:    { type: String },                          // idempotency / correlation ID
  requestBody:  { type: Schema.Types.Mixed },
  responseBody: { type: Schema.Types.Mixed },
  statusCode:   { type: Number },
  status:       { type: String, enum: INTEGRATION_STATUS, default: 'pending' },
  retryCount:   { type: Number, default: 0 },
  errorMessage: { type: String },
  durationMs:   { type: Number },                          // round-trip time
  relatedEntity: {                                         // optional link to reservation etc.
    type:     String,
    entityId: Schema.Types.ObjectId,
  },
}, { timestamps: true });

IntegrationLogSchema.index({ property: 1, createdAt: -1 });
IntegrationLogSchema.index({ property: 1, source: 1, status: 1 });
IntegrationLogSchema.index({ payloadId: 1 }, { sparse: true });

export default model('IntegrationLog', IntegrationLogSchema);
