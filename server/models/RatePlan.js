import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const RatePlanSchema = new Schema({
  property:          { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  code:              { type: String, required: true },    // BAR, VIP, OTA, CORP, PKG
  name:              { type: String, required: true },
  type:              { type: String, enum: ['public','corporate','package','ota','promo','group'], default: 'public' },
  isRefundable:      { type: Boolean, default: true },
  includesBreakfast: { type: Boolean, default: false },
  halfBoard:         { type: Boolean, default: false },   // lunch+dinner included
  fullBoard:         { type: Boolean, default: false },   // all meals included
  allInclusive:      { type: Boolean, default: false },
  cancellationPolicy:String,
  depositPolicy:     String,
  channels:          [String],                            // ['direct','booking','expedia']
  sortOrder:         { type: Number, default: 0 },
  active:            { type: Boolean, default: true },
}, { timestamps: true });

// Per-date price row: one doc per (ratePlan, roomType, date)
const RateDateSchema = new Schema({
  ratePlan:  { type: Schema.Types.ObjectId, ref: 'RatePlan', required: true },
  roomType:  { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  date:      { type: String, required: true },            // 'YYYY-MM-DD'
  price:     { type: Number, required: true },
  minLos:    { type: Number, default: 1 },
  maxLos:    Number,
  stopSell:  { type: Boolean, default: false },
  cta:       { type: Boolean, default: false },           // closed to arrival
  ctd:       { type: Boolean, default: false },           // closed to departure
}, { timestamps: true });

RateDateSchema.index({ ratePlan: 1, roomType: 1, date: 1 }, { unique: true });

export const RatePlan = model('RatePlan', RatePlanSchema);
export const RateDate = model('RateDate', RateDateSchema);
