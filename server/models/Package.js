// Packages (gap-map item 10): a component is one item (breakfast, a show ticket, a carriage ride) sold
// with the stay. "simple" posts a fixed price on its schedule; "allowance" gives the guest an amount to
// use — the charge that comes from the outlet is absorbed by the package (profit / loss / excess).
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const SCHEDULES = ['every', 'first', 'last', 'except_first', 'except_last', 'except_ends', 'weekdays', 'every_n'];
export const CALCS = ['per_adult_child', 'per_person', 'per_room'];
export const LINKS = ['included', 'added'];

const ComponentSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  code:        { type: String, required: true, maxlength: 20 },     // immutable once created
  name:        { type: String, required: true, maxlength: 80 },     // short, for reports
  description: { type: String, maxlength: 300 },                    // full, for the desk to explain to the guest
  kind:        { type: String, enum: ['simple', 'allowance'], default: 'simple' },
  // Price per unit (gross, VAT included). For an allowance: the package price; `allowance` is what the guest may use.
  price:       { type: Number, required: true, min: 0 },
  childPrice:  { type: Number, min: 0 },                            // per_adult_child only; blank = adult price
  allowance:   { type: Number, min: 0 },
  calc:        { type: String, enum: CALCS, default: 'per_adult_child' },
  // included: the price comes off the room night (total unchanged); added: on top, on its own line.
  link:        { type: String, enum: LINKS, default: 'added' },
  schedule:    { type: String, enum: SCHEDULES, default: 'every' },
  weekdays:    { type: [Number], default: [] },                      // schedule 'weekdays' (0-6)
  everyN:      { type: Number, min: 2, max: 30 },                    // schedule 'every_n': each N-th night starting at night `fromNight`
  fromNight:   { type: Number, min: 1, max: 365, default: 1 },
  sellable:    { type: Boolean, default: false },                    // can be added to a reservation on a regular rate
  chargeCode:  { type: String, required: true },                     // ChargeCode.code posted (and that the allowance absorbs)
  altCodes:    { type: [String], default: [] },                      // other codes that may use the allowance (room service for the restaurant)
  overCode:    String,                                               // code for an excess charge (blank = the outlet's own code)
  validFrom:   String,                                               // HH:MM — allowance hours; a charge outside goes to the guest
  validTo:     String,
  seasons:     { type: [new Schema({ from: String, to: String, price: Number, allowance: Number }, { _id: false })], default: [] },
  active:      { type: Boolean, default: true },
  updatedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  updatedByName: String,
}, { timestamps: true });
ComponentSchema.index({ property: 1, code: 1 }, { unique: true });

// Allowance used per reservation-night: the package ledger (profit / loss / excess per night).
const UsageSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  component:   { type: Schema.Types.ObjectId, ref: 'PackageComponent', required: true },
  componentCode: String,
  date:        { type: String, required: true },                     // night (service date) of the allowance
  price:       { type: Number, default: 0 },                         // what the package posted for it
  allowance:   { type: Number, default: 0 },                         // what the guest may use
  used:        { type: Number, default: 0 },                         // absorbed so far (≤ allowance)
  excess:      { type: Number, default: 0 },                         // outlet charges above the allowance (guest pays)
  lines:       [{ _id: false, folio: Schema.Types.ObjectId, line: Schema.Types.ObjectId, amount: Number, code: String, at: Date }],
}, { timestamps: true });
UsageSchema.index({ reservation: 1, component: 1, date: 1 }, { unique: true });
UsageSchema.index({ property: 1, date: 1 });

export const PackageComponent = mongoose.models.PackageComponent || model('PackageComponent', ComponentSchema);
export const PackageUsage = mongoose.models.PackageUsage || model('PackageUsage', UsageSchema);
