import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Operational status — affects sellability
export const OPS_STATUS = ['available', 'out_of_order', 'out_of_service', 'maintenance_hold', 'owner_hold'];
// Housekeeping status
export const CLEAN_STATUS = ['clean', 'dirty', 'inspected', 'pickup', 'turndown_required'];
// Occupancy status
export const OCC_STATUS = ['vacant', 'occupied', 'due_in', 'due_out', 'checked_out'];

const RoomSchema = new Schema({
  property:        { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  roomType:        { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  number:          { type: String, required: true },
  floor:           { type: Number, required: true },
  building:        String,
  wing:            String,
  opsStatus:       { type: String, enum: OPS_STATUS,   default: 'available' },
  cleanStatus:     { type: String, enum: CLEAN_STATUS, default: 'clean' },
  occStatus:       { type: String, enum: OCC_STATUS,   default: 'vacant' },
  isVip:           { type: Boolean, default: false },
  isSmoking:       { type: Boolean, default: false },
  isAccessible:    { type: Boolean, default: false },
  connectingRoom:  { type: Schema.Types.ObjectId, ref: 'Room' },
  internalNotes:   String,
  active:          { type: Boolean, default: true },
}, { timestamps: true });

RoomSchema.index({ property: 1, number: 1 }, { unique: true });

// A room is sellable only when ops is available and clean is not dirty/unknown
RoomSchema.virtual('isSellable').get(function () {
  return this.opsStatus === 'available' && this.occStatus === 'vacant';
});

export default model('Room', RoomSchema);
