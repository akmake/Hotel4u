import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// OPS-05 — lost & found with a chain of custody. A found item is never matched to a guest by room
// number alone; release requires a verified recipient and evidence.
const CustodySchema = new Schema({
  at:      { type: Date, default: Date.now },
  action:  { type: String, enum: ['found', 'stored', 'transferred', 'returned', 'disposed'], required: true },
  storage: String,
  by:      { type: Schema.Types.ObjectId, ref: 'User' },
  byName:  String,
  toName:  String,
  note:    String,
}, { _id: true });

const LostItemSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  code:        { type: String, required: true },          // L-<seq>, unique per property
  room:        { type: Schema.Types.ObjectId, ref: 'Room' },
  location:    { type: String, maxlength: 200 },          // area when not a room
  foundAt:     { type: Date, required: true },
  description: { type: String, required: true, maxlength: 500 },
  category:    { type: String, enum: ['document', 'electronics', 'jewelry', 'clothing', 'money', 'hazardous', 'other'], default: 'other' },
  foundBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  foundByName: String,
  storage:     { type: String, required: true, maxlength: 200 },
  status:      { type: String, enum: ['found', 'stored', 'returned', 'disposed'], default: 'stored' },
  claimant:    { type: Schema.Types.ObjectId, ref: 'GuestProfile' },
  recipientName: String,
  releaseEvidence: { type: String, maxlength: 300 },
  disposal:    { type: String, enum: ['donated', 'discarded', 'police'] },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation' },
  task:        { type: Schema.Types.ObjectId, ref: 'HousekeepingTask' },
  custody:     [CustodySchema],
}, { timestamps: true });

LostItemSchema.index({ property: 1, status: 1, foundAt: -1 });
LostItemSchema.index({ property: 1, code: 1 }, { unique: true });

export default model('LostItem', LostItemSchema);
