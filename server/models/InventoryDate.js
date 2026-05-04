import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// One document per (property, roomType, date)
// sellableCount = physicalCount - blockedCount - oooCount
// effectiveAllotment = max(0, allotmentCount - releasedAllotmentCount)
// availableCount = sellableCount - bookedCount - tentativeCount - lockedCount - effectiveAllotment + overbookingLimit
const InventoryDateSchema = new Schema({
  property:         { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  roomType:         { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  date:             { type: String, required: true },    // YYYY-MM-DD
  physicalCount:    { type: Number, default: 0 },
  blockedCount:     { type: Number, default: 0 },
  oooCount:         { type: Number, default: 0 },
  bookedCount:      { type: Number, default: 0 },
  tentativeCount:   { type: Number, default: 0 },
  lockedCount:      { type: Number, default: 0 },
  allotmentCount:   { type: Number, default: 0 },
  releasedAllotmentCount: { type: Number, default: 0 },
  overbookingLimit: { type: Number, default: 0 },
  stopSell:         { type: Boolean, default: false },
  minLos:           { type: Number, default: 1 },
  maxLos:           Number,
  closedToArrival:  { type: Boolean, default: false },
  closedToDeparture:{ type: Boolean, default: false },
}, { timestamps: true });

InventoryDateSchema.index({ property: 1, roomType: 1, date: 1 }, { unique: true });

InventoryDateSchema.virtual('sellableCount').get(function () {
  return Math.max(0, this.physicalCount - this.blockedCount - this.oooCount);
});

InventoryDateSchema.virtual('effectiveAllotment').get(function () {
  return Math.max(0, this.allotmentCount - this.releasedAllotmentCount);
});

InventoryDateSchema.virtual('availableCount').get(function () {
  const sellable = this.physicalCount - this.blockedCount - this.oooCount;
  const effectiveAllotment = Math.max(0, this.allotmentCount - this.releasedAllotmentCount);
  return Math.max(
    0,
    sellable - this.bookedCount - this.tentativeCount - this.lockedCount - effectiveAllotment + this.overbookingLimit
  );
});

export default model('InventoryDate', InventoryDateSchema);
