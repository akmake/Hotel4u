// Revenue management (gap-map item 9): day types and the hotel calendar, channel restrictions,
// automatic strategies and the restrictions they placed (history: placed / lifted).
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Day type (peak / low / conference…): price = (price + addition) × multiplier on every rate plan
// that takes part in day types (RatePlan.useDayTypes, default on).
const DayTypeSchema = new Schema({
  property:   { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  code:       { type: String, required: true },
  name:       { type: String, required: true },
  color:      { type: String, default: '#94a3b8' },
  multiplier: { type: Number, default: 1, min: 0.1, max: 5 },
  addition:   { type: Number, default: 0, min: -10000, max: 10000 },
  // Rate plans shown first (in this order) when the stay starts on a day of this type; the rest follow as usual.
  planOrder:  [{ type: Schema.Types.ObjectId, ref: 'RatePlan' }],
  active:     { type: Boolean, default: true },
  updatedByName: String,
}, { timestamps: true });
DayTypeSchema.index({ property: 1, code: 1 }, { unique: true });

// Hotel calendar: one row per date — its day type, a note for the staff and events (conference, city event).
const HotelDaySchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  date:     { type: String, required: true }, // YYYY-MM-DD
  dayType:  { type: Schema.Types.ObjectId, ref: 'DayType' },
  note:     { type: String, maxlength: 300 },
  events:   { type: [String], default: [] },
  updatedByName: String,
}, { timestamps: true });
HotelDaySchema.index({ property: 1, date: 1 }, { unique: true });

// Channel restriction for a date range: close a channel, or a discount on it (e.g. "web −5%").
// Empty ratePlans / roomTypes = all.
const ChannelRuleSchema = new Schema({
  property:  { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  channel:   { type: String, enum: ['desk', 'web', 'ota'], required: true },
  action:    { type: String, enum: ['close', 'discount'], required: true },
  pct:       { type: Number, min: 0, max: 90 },
  from:      { type: String, required: true },
  to:        { type: String, required: true },
  ratePlans: [{ type: Schema.Types.ObjectId, ref: 'RatePlan' }],
  roomTypes: [{ type: Schema.Types.ObjectId, ref: 'RoomType' }],
  note:      String,
  active:    { type: Boolean, default: true },
  updatedByName: String,
}, { timestamps: true });

// Automatic strategy: when occupancy reaches X% (or X rooms sold) on a stay night, place a restriction.
const StrategySchema = new Schema({
  property:  { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  name:      { type: String, required: true },
  priority:  { type: Number, default: 10, min: 1, max: 999 },
  active:    { type: Boolean, default: true },
  roomTypes: [{ type: Schema.Types.ObjectId, ref: 'RoomType' }], // empty = whole hotel (occupancy of all rooms)
  ratePlans: [{ type: Schema.Types.ObjectId, ref: 'RatePlan' }], // empty = all rate plans
  metric:    { type: String, enum: ['occupancy_pct', 'rooms_sold'], default: 'occupancy_pct' },
  threshold: { type: Number, required: true, min: 1 },
  action:    { type: String, enum: ['stop_sell', 'cta', 'min_los'], required: true },
  minLos:    { type: Number, min: 2, max: 30 },
  stayFrom:  String,  // stay nights the condition applies to (optional)
  stayTo:    String,
  controlFrom: String, // when the strategy is checked (optional)
  controlTo:   String,
  daysAhead: { type: Number, default: 90, min: 1, max: 365 }, // moving window from today
  weekdays:  { type: [Number], default: [] },
  lastRunAt: Date,
  updatedByName: String,
}, { timestamps: true });

// A restriction a strategy placed on one night (per room type when the strategy is per type, else null).
// liftedAt set = no longer active; the row stays as history.
const AutoRestrictionSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  strategy: { type: Schema.Types.ObjectId, ref: 'RevenueStrategy', required: true },
  strategyName: String,
  priority: Number,
  date:     { type: String, required: true },
  roomType: { type: Schema.Types.ObjectId, ref: 'RoomType' },
  ratePlans: [{ type: Schema.Types.ObjectId, ref: 'RatePlan' }],
  action:   { type: String, enum: ['stop_sell', 'cta', 'min_los'], required: true },
  minLos:   Number,
  measured: Number, // occupancy % or rooms sold when placed
  placedAt: { type: Date, default: Date.now },
  liftedAt: Date,
  liftedMeasured: Number,
}, { timestamps: false });
AutoRestrictionSchema.index({ property: 1, date: 1, liftedAt: 1 });
AutoRestrictionSchema.index({ strategy: 1, liftedAt: 1 });

// Manual restriction changes (rate calendar per plan × room type, or hotel inventory per room type):
// one row per night that changed — what was set, by whom and when (shown against what is active now).
const RestrictionSet = { _id: false, stopSell: Boolean, cta: Boolean, ctd: Boolean, minLos: Number, maxLos: Number };
const RestrictionLogSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  level:    { type: String, enum: ['rate', 'inventory'], required: true },
  ratePlan: { type: Schema.Types.ObjectId, ref: 'RatePlan' },
  roomType: { type: Schema.Types.ObjectId, ref: 'RoomType' },
  date:     { type: String, required: true },
  before:   RestrictionSet,
  after:    RestrictionSet,
  by:       { type: Schema.Types.ObjectId, ref: 'User' },
  byName:   String,
  at:       { type: Date, default: Date.now },
}, { timestamps: false });
RestrictionLogSchema.index({ property: 1, at: -1 });
RestrictionLogSchema.index({ property: 1, date: 1 });

export const RestrictionLog = model('RestrictionLog', RestrictionLogSchema);
export const DayType = model('DayType', DayTypeSchema);
export const HotelDay = model('HotelDay', HotelDaySchema);
export const ChannelRule = model('ChannelRule', ChannelRuleSchema);
export const RevenueStrategy = model('RevenueStrategy', StrategySchema);
export const AutoRestriction = model('AutoRestriction', AutoRestrictionSchema);
