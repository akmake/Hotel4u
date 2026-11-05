import mongoose from 'mongoose';
import { guardFinancialSave, guardFinancialQuery } from '../services/financialPeriodGuard.js';
const { Schema, model } = mongoose;

export const LINE_TYPE = ['charge', 'payment', 'refund', 'adjustment', 'tax', 'fee', 'discount', 'deposit'];
export const LINE_STATUS = ['posted', 'voided', 'refunded', 'adjusted'];
export const FOLIO_STATUS = ['open', 'closed', 'suspended'];

const FolioLineSchema = new Schema({
  type:        { type: String, enum: LINE_TYPE, required: true },
  description: { type: String, required: true },
  amount:      { type: Number, required: true },           // positive=charge, negative=credit
  taxAmount:   { type: Number, default: 0 },
  department:  String,                                     // rooms, f&b, spa, parking, minibar
  serviceDate: { type: String, required: true },           // 'YYYY-MM-DD'
  accountingDate: String,                                // Immutable booking day; serviceDate may be historical.
  postedAt:    { type: Date, default: Date.now },
  source:      { type: String, enum: ['pms','pos','manual','channel','routing','night_audit'], default: 'pms' },
  status:      { type: String, enum: LINE_STATUS, default: 'posted' },
  reference:   String,
  createdBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  voidedAt:    Date,
  voidReason:  String,
  // FIN-02 / FIN-04 links: a reversal points at the charge it cancels, a refund at the payment it
  // returns. Lines are never deleted — corrections are new lines.
  reversalOf:  { type: Schema.Types.ObjectId },
  refundOf:    { type: Schema.Types.ObjectId },
  // Folio line operations (gap-map item 2, services/folioOpsService.js) — each is a new line:
  // a discount points at the charge it reduces; a split/transfer reverses the original
  // (reversalOf) and posts the parts/copy with a link back.
  discountOf:  { type: Schema.Types.ObjectId },
  splitOf:     { type: Schema.Types.ObjectId },
  transferFrom: { type: new Schema({ folio: Schema.Types.ObjectId, line: Schema.Types.ObjectId, label: String }, { _id: false }), default: undefined },
  transferTo:  { type: new Schema({ folio: Schema.Types.ObjectId, label: String }, { _id: false }), default: undefined },
  // Paid Out: cash the desk handed out on the guest's behalf (taxi, courier) — a cash-out line.
  paidOut:     { type: new Schema({ payee: String, purpose: String }, { _id: false }), default: undefined },
  // Foreign currency (gap-map item 3): the folio stays in shekels; the line keeps what was charged or
  // handed over in the foreign currency and the rate applied (charge: price; payment: cash tendered).
  fx:          { type: new Schema({ currency: String, amount: Number, rate: Number }, { _id: false }), default: undefined },
  // Receivables (gap-map item 7, services/arService.js): a line that moves money between debts of the
  // city ledger — allocation of an "on account" payment, transfer / consolidation of a debt, write-off,
  // voided payment. The pair lines of a transfer/consolidation are hidden on the statement.
  arLink:      { type: new Schema({ kind: String, folio: Schema.Types.ObjectId, line: Schema.Types.ObjectId, number: String }, { _id: false }), default: undefined },
  quantity:    Number,
  unitPrice:   Number,                                     // gross per unit as entered
  method:      String,                                     // payment/refund method
  methodRef:   String,                                     // primary reference: transfer no. / card approval / cheque no. / voucher no.
  // FIN-03: what the receipt must show for the method (validated in financeService.paymentDetails).
  // Card: last 4 digits only — never the full number or CVV.
  payDetails:  {
    type: new Schema({
      tendered:     Number,                                // cash handed over by the guest
      change:       Number,                                // cash returned
      last4:        String,
      cardBrand:    String,
      installments: Number,
      payDate:      String,                                // YYYY-MM-DD — transfer value date
      payerName:    String,                                // who paid (transfer / cheque drawer)
      bank:         String,
      branch:       String,
      account:      String,
      dueDate:      String,                                // cheque due date
      issuer:       String,                                // voucher issuer
    }, { _id: false }),
    default: undefined,
  },
  reason:      String,
  // VAT rate actually applied to this line (0 = zero-rated / exempt). Invoices use it instead of
  // recomputing every line at the property rate. taxReason says why (e.g. tourist rule version).
  vatRate:     Number,
  taxReason:   String,
}, { _id: true });

const FolioSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  // A house / passer-by account (NR folio: restaurant, spa, a visitor who does not stay) has no reservation.
  // A receivable debt opened directly on a company account (or its "on account" folio) has none either.
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: function () { return this.ownerType !== 'house' && !(this.ownerType === 'company' && this.ar?.origin && this.ar.origin !== 'stay'); } },
  ownerType:   { type: String, enum: ['guest','room','company','group','house'], default: 'guest' },
  ownerRef:    String,
  account: {
    number:  String,                                       // NR-000123
    name:    String,
    phone:   String,
    email:   String,
    taxId:   String,
    company: { type: Schema.Types.ObjectId, ref: 'Company' },
    outlet:  String,                                       // restaurant, spa, bar, events, other
    groupBlock: { type: Schema.Types.ObjectId, ref: 'GroupBlock' }, // the account of a group (outlet groups)
    note:    String,
    openedByName: String,
  },
  // Receivables (gap-map item 7): a company folio is one debt of the company's AR account once it is
  // entered (number + date entered + due date). origin says how it was born; 'unapplied' is the
  // account's "on account" folio that holds payments not yet matched to a debt.
  ar: {
    type: new Schema({
      number:    String,                                   // D-000123
      origin:    { type: String, enum: ['stay', 'direct', 'transfer', 'consolidated', 'recurring', 'mass', 'unapplied'] },
      enteredOn: String,                                   // YYYY-MM-DD business date the debt entered the account
      dueDate:   String,
      ref:       String,                                   // external reference (PO, flight, contract)
      note:      String,
      opKey:     String,                                   // idempotency of the operation that created it
      transferFrom: Schema.Types.ObjectId,
      transferredTo: Schema.Types.ObjectId,
      consolidatedFrom: { type: [Schema.Types.ObjectId], default: undefined },
      consolidatedInto: Schema.Types.ObjectId,
      consolidatedOn: String,
      enteredByName: String,
    }, { _id: false }),
    default: undefined,
  },
  status:      { type: String, enum: FOLIO_STATUS, default: 'open' },
  currency:    { type: String, default: 'ILS' },
  lines:       [FolioLineSchema],
  // Invoice combinations: charges shown as ONE line on the next invoice. Display only — the lines
  // themselves stay separate in the folio and are never edited.
  combos: [{
    label:   { type: String, required: true },
    lineIds: [Schema.Types.ObjectId],
    by:      { type: Schema.Types.ObjectId, ref: 'User' },
    byName:  String,
    at:      { type: Date, default: Date.now },
  }],
  closedAt:    Date,
  closedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  // How a balance was left at departure (FD-08-F04). A folio that still owes money stays open:
  // paid → closed; company_ar → receivable of the paying company; approved_open → manager exception.
  settlement: {
    mode:       { type: String, enum: ['paid', 'company_ar', 'approved_open'] },
    balance:    Number,
    reason:     String,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedByName: String,
    at:         Date,
  },
}, { timestamps: true, toJSON: { virtuals: true } });

FolioSchema.index({ property: 1, ownerType: 1, status: 1 });
FolioSchema.index({ property: 1, ownerType: 1, ownerRef: 1 });

FolioSchema.virtual('balance').get(function () {
  return this.lines
    .filter(l => l.status === 'posted')
    .reduce((sum, l) => sum + l.amount + l.taxAmount, 0);
});

FolioSchema.virtual('totalCharges').get(function () {
  return this.lines
    .filter(l => l.status === 'posted' && l.type === 'charge')
    .reduce((sum, l) => sum + l.amount + l.taxAmount, 0);
});

FolioSchema.virtual('totalPayments').get(function () {
  return this.lines
    .filter(l => l.status === 'posted' && ['payment','deposit'].includes(l.type))
    .reduce((sum, l) => sum + Math.abs(l.amount), 0);
});

FolioSchema.pre('save', async function () { await guardFinancialSave(this); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) FolioSchema.pre(operation, guardFinancialQuery);
FolioSchema.pre('insertMany', async function (docs) {
  const properties = docs.filter((d) => d.lines?.length).map((d) => d.property);
  if (properties.length && await mongoose.model('Property').exists({ _id: { $in: properties }, 'dayClose.businessDate': { $exists: true } })) throw Object.assign(new Error('שורות כספיות נרשמות בשמירת חשבון אטומית'), { status: 409, code: 'financial_query_write_forbidden' });
});
FolioSchema.pre('bulkWrite', async function (operations) {
  for (const operation of operations) for (const [kind, value] of Object.entries(operation)) {
    if (kind === 'insertOne') {
      if (value.document.lines?.length && await mongoose.model('Property').exists({ _id: value.document.property, 'dayClose.businessDate': { $exists: true } })) throw Object.assign(new Error('שורות כספיות נרשמות בשמירת חשבון אטומית'), { status: 409, code: 'financial_query_write_forbidden' });
    } else await guardFinancialQuery.call({ model: this, op: kind, getFilter: () => value.filter || {}, getUpdate: () => value.update || value.replacement || {}, getOptions: () => ({ upsert: value.upsert }) });
  }
});
export default model('Folio', FolioSchema);
