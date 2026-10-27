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
  // Optional for legacy bookings. Never default unknown per-unit composition to zero.
  adults:            { type: Number, min: 1, validate: Number.isInteger },
  children:          { type: Number, min: 0, validate: Number.isInteger },
  status:            { type: String, enum: RR_STATUS, default: 'reserved' },
  notes:             String,
  // Group billing (per room): who pays the room nights and who pays the extras of this room.
  // 'booker' = the reservation's main account; 'guest' = this room's own account (Folio ownerType
  // 'room', ownerRef = this unit id). A room with anything on 'guest' needs its own guarantee.
  roomPayer:         { type: String, enum: ['booker', 'guest'], default: 'booker' },
  extrasPayer:       { type: String, enum: ['booker', 'guest'], default: 'booker' },
  occupantName:      { type: String, trim: true, maxlength: 120 },
  occupantPhone:     { type: String, trim: true, maxlength: 40 },
  guaranteeType:     { type: String, enum: ['none', 'credit_card', 'deposit', 'voucher'], default: 'none' },
  guaranteeReference:{ type: String, trim: true, maxlength: 80 },
}, { timestamps: true });

ReservationRoomSchema.index({ reservation: 1, createdAt: 1 });
ReservationRoomSchema.index({ property: 1, arrivalDate: 1, departureDate: 1 });

export const RESERVATION_ROOM_STATUS = RR_STATUS;
export default model('ReservationRoom', ReservationRoomSchema);
