// Cash drawer close per cashier per business day (FIN-12 cash control): the cash the system expects
// (cash payments − cash refunds the user recorded that day), what was counted, and the difference.
// A close is final; a correction is a new close with a reason (kept as history).
import mongoose from 'mongoose';

const CashierCloseSchema = new mongoose.Schema({
  property:     { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
  businessDate: { type: String, required: true },           // YYYY-MM-DD
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:     String,
  expected:     { type: Number, required: true },
  counted:      { type: Number, required: true },
  variance:     { type: Number, required: true },           // counted − expected
  receipts:     Number,                                     // cash lines in the day
  note:         String,
  closedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  closedByName: String,
  supersedes:   { type: mongoose.Schema.Types.ObjectId, ref: 'CashierClose' },
  active:       { type: Boolean, default: true },           // false once a correcting close replaced it
}, { timestamps: true });

CashierCloseSchema.index({ property: 1, businessDate: 1, user: 1, active: 1 });

export default mongoose.model('CashierClose', CashierCloseSchema);
