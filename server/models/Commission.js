// Travel-agent commissions (gap-map item 10): one record per departed reservation of an agent, held or
// ready, then paid in a payment (cheque / transfer / file) whose lifecycle is tracked. Not folio lines:
// the commission is owed to the agent, not charged to the guest.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const HOLD_KINDS = ['review', 'until_paid', 'offset'];     // לבירור · עד שהחייב ישלם · כבר קוזזה
export const RECORD_STATUS = ['ready', 'held', 'paid', 'cancelled'];
export const PAY_STATUS = ['issued', 'cleared', 'not_presented', 'voided'];

const CommissionRecordSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  agent:       { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  confirmationNumber: String,
  guestName:   String,
  arrivalDate: String,
  departureDate: String,
  base:        { type: Number, default: 0 },                         // net room revenue the commission is on
  pct:         { type: Number, default: 0, min: 0, max: 100 },
  source:      { type: String, enum: ['plan', 'agent', 'reservation', 'manual'], default: 'agent' },
  calculated:  { type: Number, default: 0 },                         // base × pct
  amount:      { type: Number, default: 0 },                         // what is paid (calculated unless edited by hand)
  edited:      { type: new Schema({ by: String, at: Date, note: String, from: Number }, { _id: false }), default: undefined },
  manual:      { type: Boolean, default: false },                    // entered by hand (always starts held for review)
  status:      { type: String, enum: RECORD_STATUS, default: 'ready' },
  hold:        { type: new Schema({ kind: { type: String, enum: HOLD_KINDS }, note: String, by: String, at: Date }, { _id: false }), default: undefined },
  payment:     { type: Schema.Types.ObjectId, ref: 'CommissionPayment' },
  history:     [{ _id: false, at: Date, by: String, action: String, note: String }],
}, { timestamps: true });
CommissionRecordSchema.index({ property: 1, reservation: 1 }, { unique: true });
CommissionRecordSchema.index({ property: 1, agent: 1, status: 1, departureDate: 1 });

const CommissionPaymentSchema = new Schema({
  property:  { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  agent:     { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  number:    { type: String, required: true },                      // cheque / transfer number (or file reference)
  method:    { type: String, enum: ['cheque', 'transfer', 'file'], default: 'cheque' },
  amount:    { type: Number, required: true },
  from:      String,                                                // departure range the payment covers
  to:        String,
  records:   [{ type: Schema.Types.ObjectId, ref: 'CommissionRecord' }],
  status:    { type: String, enum: PAY_STATUS, default: 'issued' },
  clearedAt: Date,
  printedAt: Date,
  history:   [{ _id: false, at: Date, by: String, action: String, note: String }],
  createdByName: String,
}, { timestamps: true });
CommissionPaymentSchema.index({ property: 1, method: 1, number: 1 }, { unique: true });
CommissionPaymentSchema.index({ property: 1, agent: 1, createdAt: -1 });

export const CommissionRecord = mongoose.models.CommissionRecord || model('CommissionRecord', CommissionRecordSchema);
export const CommissionPayment = mongoose.models.CommissionPayment || model('CommissionPayment', CommissionPaymentSchema);
