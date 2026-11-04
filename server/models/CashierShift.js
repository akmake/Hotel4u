// Cashier shift (Optima "Cashier shifts"): a drawer opened with a float by one user, the cash that
// passed through it (folio cash payments/refunds by that user, currency exchange), and a blind count
// at close — ILS and every foreign currency held — with the variance and who took over the drawer.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const ForeignSchema = new Schema({
  currency: { type: String, required: true },
  expected: { type: Number, default: 0 },
  counted:  { type: Number, default: 0 },
  variance: { type: Number, default: 0 },
}, { _id: false });

const CashierShiftSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  number:       { type: String, required: true },                 // SH-00012
  user:         { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userName:     String,
  status:       { type: String, enum: ['open', 'closed'], default: 'open' },
  businessDate: { type: String, required: true },                 // business day the shift opened on
  openedAt:     { type: Date, default: Date.now },
  openingFloat: { type: Number, default: 0 },
  openNote:     String,
  closedAt:     Date,
  closedByName: String,
  expected:     Number,                                           // ILS the drawer should hold at close
  counted:      Number,
  variance:     Number,                                           // counted − expected
  movement:     { cashIn: Number, cashOut: Number, exchangeIn: Number, exchangeOut: Number, receipts: Number },
  foreign:      [ForeignSchema],
  note:         String,
  handedTo:     String,                                           // who received the drawer
}, { timestamps: true });

CashierShiftSchema.index({ property: 1, user: 1, status: 1 });
CashierShiftSchema.index({ property: 1, openedAt: -1 });

export default model('CashierShift', CashierShiftSchema);
