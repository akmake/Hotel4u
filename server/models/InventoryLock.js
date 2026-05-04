import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const InventoryLockSchema = new Schema({
  property:        { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  roomType:        { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  arrivalDate:     { type: String, required: true },
  departureDate:   { type: String, required: true },
  roomsCount:      { type: Number, default: 1, min: 1 },
  idempotencyKey:  { type: String, required: true },
  source:          { type: String, enum: ['pms', 'ota', 'engine', 'api'], default: 'pms' },
  status:          { type: String, enum: ['active', 'consumed', 'released', 'expired'], default: 'active' },
  expiresAt:       { type: Date, required: true },
  consumedAt:      Date,
  releasedAt:      Date,
}, { timestamps: true });

InventoryLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
InventoryLockSchema.index({ property: 1, roomType: 1, arrivalDate: 1, departureDate: 1, status: 1 });
InventoryLockSchema.index({ property: 1, idempotencyKey: 1 }, { unique: true });

export default model('InventoryLock', InventoryLockSchema);
