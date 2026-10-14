import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// ADM-13 (gap G1) — the property's catalogue of charge codes and payment methods.
// A folio line carries the code in `department` (kept for compatibility with every existing
// posting path); the catalogue says what the code means: revenue group for reports, VAT class,
// accounting account for export, default price and who may post it manually.
// Codes are never deleted or renamed once created — they are deactivated, so history stays readable.
export const CODE_KINDS = ['charge', 'payment'];
export const REVENUE_GROUPS = ['rooms', 'f_and_b', 'other_operated', 'fees', 'misc'];
export const VAT_CLASSES = ['standard', 'exempt', 'zero'];
export const POST_LEVELS = ['staff', 'manager', 'system'];

const ChargeCodeSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  kind:         { type: String, enum: CODE_KINDS, default: 'charge' },
  code:         { type: String, required: true },                   // slug, immutable
  name:         { type: String, required: true, maxlength: 80 },
  revenueGroup: { type: String, enum: REVENUE_GROUPS, default: 'misc' },
  vatClass:     { type: String, enum: VAT_CLASSES, default: 'standard' },
  glAccount:    { type: String, maxlength: 40 },                     // accounting account for export (FIN-11)
  defaultPrice: { type: Number, min: 0 },                            // gross incl. VAT
  priceEditable:{ type: Boolean, default: true },
  postLevel:    { type: String, enum: POST_LEVELS, default: 'staff' }, // who may post it by hand
  requireReference: { type: Boolean, default: false },               // payment: reference mandatory
  active:       { type: Boolean, default: true },
  builtIn:      { type: Boolean, default: false },                   // shipped default; code logic depends on it
  sortOrder:    { type: Number, default: 100 },
  updatedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  updatedByName:String,
}, { timestamps: true });

ChargeCodeSchema.index({ property: 1, kind: 1, code: 1 }, { unique: true });

export default model('ChargeCode', ChargeCodeSchema);
