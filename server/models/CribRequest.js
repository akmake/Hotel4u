import mongoose from 'mongoose';
const { Schema } = mongoose;
const count = { type: Number, min: 0, max: 100, validate: Number.isInteger, default: 0 };
const schema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  reservationRoom: { type: Schema.Types.ObjectId, ref: 'ReservationRoom', required: true },
  requestedQty: { ...count },
  outstandingQty: { ...count },
  deliveryRoom: { type: Schema.Types.ObjectId, ref: 'Room', default: null },
  revision: { type: Number, min: 0, validate: Number.isInteger, required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.index({ property: 1, reservationRoom: 1 }, { unique: true });
schema.index({ property: 1, outstandingQty: -1, updatedAt: 1 });
export default mongoose.model('CribRequest', schema);
