import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Ch. 17 — Billing Windows / Routing
// A routing rule redirects specific charge types from guest folio → company/group/agent folio

const FolioRoutingRuleSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },

  name:        { type: String, required: true, trim: true },
  active:      { type: Boolean, default: true },

  // What to route: departments (rooms, f_and_b, spa, parking, minibar, …) or all
  departments: [{ type: String }],          // empty = all departments
  chargeTypes: [{ type: String }],          // 'charge','tax','fee' etc — empty = all

  // Date range — only route charges for service dates in this range
  fromDate:    String,   // YYYY-MM-DD, null = no lower bound
  toDate:      String,   // YYYY-MM-DD, null = no upper bound

  // Percentage split — 100 means route everything, 50 means 50% goes here
  percentage:  { type: Number, min: 1, max: 100, default: 100 },

  // Target folio owner
  targetOwnerType: { type: String, enum: ['guest', 'company', 'group', 'agent', 'house'], required: true },
  targetOwnerId:   { type: Schema.Types.ObjectId },   // Company / GroupBlock / GuestProfile id
  targetFolioId:   { type: Schema.Types.ObjectId, ref: 'Folio' },  // resolved lazily

  notes:       String,
  createdBy:   { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

FolioRoutingRuleSchema.index({ reservation: 1, active: 1 });
FolioRoutingRuleSchema.index({ property: 1 });

export default model('FolioRoutingRule', FolioRoutingRuleSchema);
