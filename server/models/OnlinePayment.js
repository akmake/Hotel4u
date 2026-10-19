// A payment taken on the public booking site. The reservation is held (status 'hold') while the guest
// pays at the provider; the session is finalised once — paid → the stay is confirmed and the amount is
// posted to the guest account as a deposit. Card data never reaches us: only what the provider returns
// (last 4 digits, approval number, brand). `token` is the guest's capability for this booking.
import mongoose from 'mongoose';

const { Schema } = mongoose;

const OnlinePaymentSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation:  { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  token:        { type: String, required: true, unique: true },
  provider:     { type: String, required: true },
  providerRef:  String,
  amount:       { type: Number, required: true },
  stayTotal:    Number,
  currency:     { type: String, default: 'ILS' },
  kind:         { type: String, enum: ['full', 'deposit'], default: 'full' },
  status:       { type: String, enum: ['pending', 'processing', 'paid', 'failed', 'expired', 'needs_refund'], default: 'pending' },
  expiresAt:    Date,
  attempts:     { type: Number, default: 1 },
  result:       { last4: String, approval: String, cardBrand: String, installments: Number },
  mock:         { outcome: String, at: Date },
  error:        String,
  paidAt:       Date,
  folioLineId:  String,
  ip:           String,
}, { timestamps: true });

OnlinePaymentSchema.index({ reservation: 1 });
OnlinePaymentSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model('OnlinePayment', OnlinePaymentSchema);
