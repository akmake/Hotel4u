import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const RR_STATUS = ['reserved', 'checked_in', 'in_house', 'checked_out', 'cancelled', 'no_show', 'tentative'];

const ReservationRoomSchema = new Schema({
  reservation:       { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  property:          { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  roomTypeBooked:    { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  assignedRoom:      { type: Schema.Types.ObjectId, ref: 'Room' },
  arrivalDate:       { type: String, required: true },
  departureDate:     { type: String, required: true },
  ratePlan:          { type: Schema.Types.ObjectId, ref: 'RatePlan' },
  nightlyRate:       { type: Number, required: true },
  guests:            [{ type: Schema.Types.ObjectId, ref: 'GuestProfile' }],
  status:            { type: String, enum: RR_STATUS, default: 'reserved' },
  notes:             String,
}, { timestamps: true });

ReservationRoomSchema.index({ reservation: 1, createdAt: 1 });
ReservationRoomSchema.index({ property: 1, arrivalDate: 1, departureDate: 1 });

export const RESERVATION_ROOM_STATUS = RR_STATUS;
export default model('ReservationRoom', ReservationRoomSchema);
