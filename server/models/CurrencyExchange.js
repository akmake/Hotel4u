// Currency exchange at the desk (Optima "Currency exch."): the hotel buys foreign cash from a guest
// (pays out shekels) or sells foreign cash (takes shekels). Each exchange belongs to the cashier's
// open shift, so the drawer count at close covers ILS and every foreign currency.
// FxRate holds the property's posted buy/sell rate per currency (shekels per one unit).
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const FxRateSchema = new Schema({
  property:  { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  currency:  { type: String, required: true },                    // ISO 4217, e.g. USD
  buy:       { type: Number, required: true },                    // hotel pays this many ILS per unit
  sell:      { type: Number, required: true },                    // hotel charges this many ILS per unit
  // Folio rates (gap-map item 3): a payment on a folio in this currency, and a charge priced in it.
  // Empty = the cash rates (pay → buy, charge → sell).
  pay:       Number,
  charge:    Number,
  active:    { type: Boolean, default: true },
  updatedByName: String,
}, { timestamps: true });
FxRateSchema.index({ property: 1, currency: 1 }, { unique: true });
export const FxRate = model('FxRate', FxRateSchema);

const CurrencyExchangeSchema = new Schema({
  property:      { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  number:        { type: String, required: true },                // EX-00031 — slip number
  shift:         { type: Schema.Types.ObjectId, ref: 'CashierShift', required: true },
  user:          { type: Schema.Types.ObjectId, ref: 'User' },
  userName:      String,
  businessDate:  { type: String, required: true },
  direction:     { type: String, enum: ['buy', 'sell'], required: true }, // buy = guest gives foreign, gets ILS
  currency:      { type: String, required: true },
  foreignAmount: { type: Number, required: true },
  rate:          { type: Number, required: true },                // ILS per unit actually applied
  ilsAmount:     { type: Number, required: true },
  guestName:     String,
  reservation:   { type: Schema.Types.ObjectId, ref: 'Reservation' },
  roomNumber:    String,
  docLast4:      String,                                          // passport / ID — last 4 only
  status:        { type: String, enum: ['done', 'voided'], default: 'done' },
  voidReason:    String,
  voidedByName:  String,
  voidedAt:      Date,
}, { timestamps: true });
CurrencyExchangeSchema.index({ property: 1, createdAt: -1 });
CurrencyExchangeSchema.index({ shift: 1 });

export default model('CurrencyExchange', CurrencyExchangeSchema);
