import mongoose from 'mongoose';
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
  postedAt:    { type: Date, default: Date.now },
  source:      { type: String, enum: ['pms','pos','manual','channel'], default: 'pms' },
  status:      { type: String, enum: LINE_STATUS, default: 'posted' },
  reference:   String,
  createdBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  voidedAt:    Date,
  voidReason:  String,
}, { _id: true });

const FolioSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  ownerType:   { type: String, enum: ['guest','room','company','group','house'], default: 'guest' },
  ownerRef:    String,
  status:      { type: String, enum: FOLIO_STATUS, default: 'open' },
  currency:    { type: String, default: 'ILS' },
  lines:       [FolioLineSchema],
  closedAt:    Date,
  closedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, toJSON: { virtuals: true } });

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

export default model('Folio', FolioSchema);
