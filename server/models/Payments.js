// Card payments through the property's clearing provider (gap-map item 12, services/cardService.js).
// We never keep a card number or CVV: only the provider's token (sealed), the last 4 digits, brand and expiry.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// A card on a guest profile (and optionally a company), captured on the provider's page.
const PaymentCardSchema = new Schema({
  property:   { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  guest:      { type: Schema.Types.ObjectId, ref: 'GuestProfile' },
  company:    { type: Schema.Types.ObjectId, ref: 'Company' },
  provider:   { type: String, required: true },
  token:      String,                                   // provider token, sealed (utils/secretBox) — never sent to the client
  last4:      String,
  brand:      String,                                   // visa | mastercard | amex | isracard | diners | other
  expMonth:   Number,
  expYear:    Number,
  holderName: String,
  status:     { type: String, enum: ['pending', 'active', 'removed'], default: 'pending' },
  capture:    { type: new Schema({ token: String, expiresAt: Date, reservation: Schema.Types.ObjectId }, { _id: false }), default: undefined },
  lastCheck:  { type: new Schema({ at: Date, ok: Boolean, message: String, by: String }, { _id: false }), default: undefined },
  addedByName: String,
  removedByName: String,
}, { timestamps: true });
PaymentCardSchema.index({ property: 1, guest: 1, status: 1 });
PaymentCardSchema.index({ 'capture.token': 1 }, { sparse: true });

// An authorization ("מסגרת") held on a card for a stay: placed at check-in, topped up when the balance passes it,
// captured at departure, the rest released.
const CardAuthorizationSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  card:        { type: Schema.Types.ObjectId, ref: 'PaymentCard', required: true },
  providerRef: { type: String, required: true },
  amount:      { type: Number, default: 0 },            // total authorized now
  captured:    { type: Number, default: 0 },
  status:      { type: String, enum: ['active', 'released', 'closed'], default: 'active' },
  history:     [{ _id: false, at: Date, kind: String, amount: Number, approval: String, ok: Boolean, message: String, by: String }],
}, { timestamps: true });
CardAuthorizationSchema.index({ property: 1, reservation: 1, status: 1 });

// Every money movement through the provider (sale, capture, refund) and the folio line it produced.
const CardTransactionSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  kind:         { type: String, enum: ['sale', 'capture', 'refund'], required: true },
  card:         { type: Schema.Types.ObjectId, ref: 'PaymentCard' },
  reservation:  { type: Schema.Types.ObjectId, ref: 'Reservation' },
  folio:        { type: Schema.Types.ObjectId, ref: 'Folio' },
  folioLine:    Schema.Types.ObjectId,
  of:           { type: Schema.Types.ObjectId, ref: 'CardTransaction' },   // refund → the sale/capture it returns
  providerRef:  String,
  approval:     String,
  amount:       { type: Number, required: true },        // positive; a refund is money back to the card
  brand:        String,
  last4:        String,
  businessDate: String,
  attention:    String,                                  // the provider moved money but the folio line failed — fix by hand
  byName:       String,
}, { timestamps: true });
CardTransactionSchema.index({ property: 1, businessDate: 1, brand: 1 });
CardTransactionSchema.index({ property: 1, folioLine: 1 });

// Card companies as debtors: what the provider owes the hotel per business day and brand, until the deposit arrives.
const CardSettlementSchema = new Schema({
  property:   { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  date:       { type: String, required: true },
  brand:      { type: String, required: true },
  expected:   { type: Number, default: 0 },              // sales + captures − refunds of the day
  deposited:  { type: Number, default: 0 },
  fees:       { type: Number, default: 0 },              // commission the provider kept
  status:     { type: String, enum: ['open', 'partial', 'settled'], default: 'open' },
  deposits:   [{ at: Date, amount: Number, fee: Number, ref: String, byName: String }],
}, { timestamps: true });
CardSettlementSchema.index({ property: 1, date: 1, brand: 1 }, { unique: true });

export const PaymentCard = mongoose.models.PaymentCard || model('PaymentCard', PaymentCardSchema);
export const CardAuthorization = mongoose.models.CardAuthorization || model('CardAuthorization', CardAuthorizationSchema);
export const CardTransaction = mongoose.models.CardTransaction || model('CardTransaction', CardTransactionSchema);
export const CardSettlement = mongoose.models.CardSettlement || model('CardSettlement', CardSettlementSchema);
