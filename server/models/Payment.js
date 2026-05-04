/**
 * פרק כא — Payment Model
 * Spec section 41 defines Payment as a distinct entity from FolioLine.
 * Tracks provider-level payment records with tokenization, correlationId, etc.
 * Spec section 18.3: no full card number storage — token only.
 */
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const PAYMENT_METHODS = [
  'cash',
  'credit_card',
  'bank_transfer',
  'pay_by_link',
  'voucher',
  'loyalty_points',
  'company_account',
  'ota_virtual_card',
];

export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'captured',
  'sale',             // single-step auth+capture
  'failed',
  'voided',
  'refunded',
  'partially_refunded',
];

export const PAYMENT_OPERATIONS = [
  'authorization',
  'capture',
  'sale',
  'refund',
  'void',
  'partial_refund',
  'pre_authorization',
  'release_authorization',
];

const PaymentSchema = new Schema({
  property:          { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  folio:             { type: Schema.Types.ObjectId, ref: 'Folio',       required: true },
  reservation:       { type: Schema.Types.ObjectId, ref: 'Reservation' },
  folioLineId:       { type: Schema.Types.ObjectId },   // link back to FolioLine that recorded this

  // Payment details
  paymentMethod:     { type: String, enum: PAYMENT_METHODS, required: true },
  operation:         { type: String, enum: PAYMENT_OPERATIONS, default: 'sale' },
  amount:            { type: Number, required: true },
  currency:          { type: String, default: 'ILS' },
  status:            { type: String, enum: PAYMENT_STATUSES, default: 'pending' },

  // Provider details (spec 18.3: no full card number stored)
  provider:          String,                            // 'cardcom', 'stripe', 'adyen', 'manual'
  providerReference: String,                            // provider transaction / charge ID
  correlationId:     { type: String },                  // idempotency key (spec 18.3)
  tokenId:           String,                            // card token — NOT the full card number
  last4:             String,                            // last 4 digits for display only
  cardBrand:         String,                            // 'visa', 'mastercard', etc.
  authCode:          String,

  // Refund tracking
  refundedAmount:    { type: Number, default: 0 },
  parentPaymentId:   { type: Schema.Types.ObjectId, ref: 'Payment' },  // for refunds/voids

  // Timeline
  authorizedAt:      Date,
  capturedAt:        Date,
  failedAt:          Date,
  voidedAt:          Date,
  refundedAt:        Date,
  failureReason:     String,

  // Metadata (spec 18.3: save correlation id vs payment provider)
  paymentLinkUrl:    String,
  paymentLinkExpiry: Date,

  // Actor
  createdBy:         { type: Schema.Types.ObjectId, ref: 'User' },
  notes:             String,
}, { timestamps: true });

// Spec 18.3: correlationId uniqueness for idempotency
PaymentSchema.index({ correlationId: 1 }, { unique: true, sparse: true });
PaymentSchema.index({ property: 1, createdAt: -1 });
PaymentSchema.index({ folio: 1 });
PaymentSchema.index({ providerReference: 1 }, { sparse: true });
PaymentSchema.index({ reservation: 1 });

export default model('Payment', PaymentSchema);
