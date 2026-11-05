import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const PricingRuleSchema = new Schema({
  name: { type: String, required: true },
  priority: { type: Number, default: 100 },
  active: { type: Boolean, default: true },

  weekdays: { type: [Number], default: [] }, // 0-6
  seasonFrom: String, // YYYY-MM-DD
  seasonTo: String,   // YYYY-MM-DD
  season: String,     // code of a shared season (CodeList 'season') — its ranges, instead of seasonFrom/To

  minGuests: Number,
  maxGuests: Number,
  minChildren: Number,
  maxChildren: Number,

  minLos: Number,
  maxLos: Number,
  minLeadDays: Number,
  maxLeadDays: Number,

  channels: { type: [String], default: [] },
  companies: [{ type: Schema.Types.ObjectId, ref: 'Company' }],
  agents: [{ type: Schema.Types.ObjectId, ref: 'Company' }],
  promoCodes: { type: [String], default: [] },
  loyaltyTiers: { type: [String], default: [] },

  // 'all' — on top of the calendar too; 'base' — only nights priced without a calendar row (base / derived).
  appliesTo: { type: String, enum: ['all', 'base'], default: 'all' },
  adjustmentType: { type: String, enum: ['set', 'percent', 'fixed'], default: 'percent' },
  adjustmentValue: { type: Number, default: 0 },

  childPricePerNight: Number,
  extraGuestPricePerNight: Number,
}, { _id: true });

const BlackoutDateSchema = new Schema({
  fromDate: { type: String, required: true },
  toDate: { type: String, required: true },
  reason: String,
}, { _id: true });

const RatePlanSchema = new Schema({
  property:          { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  code:              { type: String, required: true },
  name:              { type: String, required: true },
  type:              { type: String, enum: ['public', 'corporate', 'package', 'ota', 'promo', 'group'], default: 'public' },
  isRefundable:      { type: Boolean, default: true },
  // How the house counts a stay on this rate (gap-map item 8, house status): paying, complimentary
  // (free room for a guest) or house use (staff / owner / inspection — not sold).
  use:               { type: String, enum: ['paying', 'comp', 'house_use'], default: 'paying' },
  includesBreakfast: { type: Boolean, default: false },
  halfBoard:         { type: Boolean, default: false },
  fullBoard:         { type: Boolean, default: false },
  allInclusive:      { type: Boolean, default: false },
  cancellationPolicy: String,
  depositPolicy:      String,
  channels:           { type: [String], default: [] },
  activeRoomTypes:   [{ type: Schema.Types.ObjectId, ref: 'RoomType' }],
  pricingRules:      { type: [PricingRuleSchema], default: [] },
  // Derived rate: a night without its own calendar price = the parent plan's price that night ± pct
  // (e.g. CORP = BAR −12%). The plan's own calendar row, when entered, always wins.
  derived: {
    from: { type: Schema.Types.ObjectId, ref: 'RatePlan' },
    pct:  { type: Number, min: -100, max: 500 },
  },
  sortOrder:         { type: Number, default: 0 },
  active:            { type: Boolean, default: true },
  // Revenue (gap-map item 9): takes part in day types (peak / low multipliers), and length-of-stay
  // tiers — from N nights, a price per room type (replaces the night's price) or a percent off.
  useDayTypes:       { type: Boolean, default: true },
  // Agent commission (gap-map item 10): a plan that does not qualify pays none. `pct` blank = the agent's
  // own default; a number here wins over the agent's.
  commission: { type: new Schema({ eligible: { type: Boolean, default: false }, pct: { type: Number, min: 0, max: 100 } }, { _id: false }), default: undefined },
  // Package components every reservation on this plan gets (optionally only for stays arriving in a range).
  components: { type: [new Schema({ component: { type: Schema.Types.ObjectId, ref: 'PackageComponent', required: true }, from: String, to: String }, { _id: false })], default: [] },
  tiers: {
    type: [new Schema({
      minNights: { type: Number, required: true, min: 2, max: 365 },
      label:     String,
      pct:       { type: Number, min: -90, max: 100 },
      prices:    [{ _id: false, roomType: { type: Schema.Types.ObjectId, ref: 'RoomType' }, price: { type: Number, min: 0 } }],
    }, { _id: true })],
    default: [],
  },
}, { timestamps: true });

RatePlanSchema.index({ property: 1, code: 1 }, { unique: true });

const RateDateSchema = new Schema({
  ratePlan:  { type: Schema.Types.ObjectId, ref: 'RatePlan', required: true },
  roomType:  { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  date:      { type: String, required: true }, // YYYY-MM-DD

  // Base price for this day before per-booking rules
  price:     { type: Number, required: true },

  // Restrictions
  minLos:    { type: Number, default: 1 },
  maxLos:    Number,
  cta:       { type: Boolean, default: false },
  ctd:       { type: Boolean, default: false },
  stopSell:  { type: Boolean, default: false },
  sellLimit: Number,
  releaseDays: Number,
  advancePurchaseMinDays: Number,
  lastMinuteMaxDays: Number,
  blackouts: { type: [BlackoutDateSchema], default: [] },

  // Optional raw deltas for fast day-of-week/occupancy overrides
  weekdayAdjustmentPct: Number,
  occupancy2Price: Number,
  occupancy3Price: Number,
  occupancy4Price: Number,
  childPricePerNight: Number,
  extraGuestPricePerNight: Number,
}, { timestamps: true });

RateDateSchema.index({ ratePlan: 1, roomType: 1, date: 1 }, { unique: true });

const RateOverrideLogSchema = new Schema({
  property:      { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  ratePlan:      { type: Schema.Types.ObjectId, ref: 'RatePlan', required: true },
  roomType:      { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  date:          { type: String, required: true },
  originalPrice: { type: Number, required: true },
  newPrice:      { type: Number, required: true },
  reason:        { type: String, required: true },
  changedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  changedByName: String,
  changedByRole: String,
  afterCheckIn:  { type: Boolean, default: false },
  approvedHighPrivilege: { type: Boolean, default: false },
}, { timestamps: true });

RateOverrideLogSchema.index({ property: 1, ratePlan: 1, roomType: 1, date: 1, createdAt: -1 });

export const RatePlan = model('RatePlan', RatePlanSchema);
export const RateDate = model('RateDate', RateDateSchema);
export const RateOverrideLog = model('RateOverrideLog', RateOverrideLogSchema);
