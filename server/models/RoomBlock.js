// INV-04 — a room taken out of sale for a date range (renovation, repair, owner use).
// Nights are [from, to): `from` is the first blocked night, `to` the first night the room is sellable again.
// A block is never deleted; releasing it keeps who, when and why.
import mongoose from 'mongoose';

const { Schema } = mongoose;

const RoomBlockSchema = new Schema({
  property:  { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  room:      { type: Schema.Types.ObjectId, ref: 'Room', required: true },
  roomType:  { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  from:      { type: String, required: true },
  to:        { type: String, required: true },
  kind:      { type: String, enum: ['out_of_order', 'out_of_service'], default: 'out_of_order' },
  reason:    { type: String, required: true, maxlength: 300 },
  ticket:    { type: Schema.Types.ObjectId, ref: 'MaintenanceTicket' },
  status:    { type: String, enum: ['active', 'released'], default: 'active' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName: String,
  releasedAt: Date,
  releasedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  releasedByName: String,
  releaseReason: { type: String, maxlength: 300 },
}, { timestamps: true });

RoomBlockSchema.index({ property: 1, status: 1, from: 1, to: 1 });
RoomBlockSchema.index({ room: 1, status: 1 });

export default mongoose.models.RoomBlock || mongoose.model('RoomBlock', RoomBlockSchema);
