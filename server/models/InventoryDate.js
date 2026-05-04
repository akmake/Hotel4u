import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// One document per (property, roomType, date).
// availableCount = physicalCount - oooCount - bookedCount + overbookingLimit
const InventoryDateSchema = new Schema({
  property:         { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  roomType:         { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  date:             { type: String, required: true },    // 'YYYY-MM-DD'
  physicalCount:    { type: Number, default: 0 },
  oooCount:         { type: Number, default: 0 },        // rooms out of order
  bookedCount:      { type: Number, default: 0 },        // confirmed reservations
  tentativeCount:   { type: Number, default: 0 },
  overbookingLimit: { type: Number, default: 0 },
  stopSell:         { type: Boolean, default: false },
  minLos:           { type: Number, default: 1 },
  maxLos:           Number,
  closedToArrival:  { type: Boolean, default: false },
  closedToDeparture:{ type: Boolean, default: false },
}, { timestamps: true });

InventoryDateSchema.index({ property: 1, roomType: 1, date: 1 }, { unique: true });

InventoryDateSchema.virtual('availableCount').get(function () {
  return Math.max(0, this.physicalCount - this.oooCount - this.bookedCount + this.overbookingLimit);
});

export default model('InventoryDate', InventoryDateSchema);
