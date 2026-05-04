import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const StaySegmentSchema = new Schema({
  reservationRoom:  { type: Schema.Types.ObjectId, ref: 'ReservationRoom', required: true },
  reservation:      { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  property:         { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  fromDate:         { type: String, required: true },
  toDate:           { type: String, required: true },
  roomType:         { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  room:             { type: Schema.Types.ObjectId, ref: 'Room' },
  ratePerNight:     { type: Number, required: true },
  ratePlan:         { type: Schema.Types.ObjectId, ref: 'RatePlan' },
  changeReason:     String,
  createdBy:        { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName:    String,
}, { timestamps: true });

StaySegmentSchema.index({ reservationRoom: 1, fromDate: 1 });
StaySegmentSchema.index({ reservation: 1, fromDate: 1 });

export default model('StaySegment', StaySegmentSchema);
