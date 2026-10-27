import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation', required: true },
  requestKey: { type: String, required: true, maxlength: 128 },
  payloadHash: { type: String, required: true },
  result: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });
schema.index({ property: 1, reservation: 1, requestKey: 1 }, { unique: true });
export default mongoose.model('RoomMoveOperation', schema);
