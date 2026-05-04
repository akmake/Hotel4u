import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const RES_STATUS = [
  'draft', 'quote', 'hold', 'pending_payment',
  'confirmed', 'modified', 'cancelled', 'waitlisted',
  'no_show', 'checked_in', 'in_house', 'checked_out',
  'partially_checked_in', 'partially_checked_out',
];

export const PAYMENT_STATUS = ['unpaid', 'partial', 'paid', 'refunded', 'balance_due'];
export const SOURCE = ['direct', 'booking', 'expedia', 'agoda', 'airbnb', 'gds', 'walk_in', 'corporate', 'agent', 'phone'];

const ReservationSchema = new Schema({
  property:          { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  confirmationNumber:{ type: String, required: true, unique: true },
  idempotencyKey:    String,
  status:            { type: String, enum: RES_STATUS, default: 'confirmed' },

  // Guests
  primaryGuest:      { type: Schema.Types.ObjectId, ref: 'GuestProfile', required: true },
  additionalGuests:  [{ type: Schema.Types.ObjectId, ref: 'GuestProfile' }],
  adults:            { type: Number, default: 1 },
  children:          { type: Number, default: 0 },

  // Dates
  arrivalDate:       { type: String, required: true },    // 'YYYY-MM-DD'
  departureDate:     { type: String, required: true },
  nights:            { type: Number, required: true },

  // Booking details
  source:            { type: String, enum: SOURCE, default: 'direct' },
  marketSegment:     String,
  ratePlan:          { type: Schema.Types.ObjectId, ref: 'RatePlan' },
  roomType:          { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  assignedRoom:      { type: Schema.Types.ObjectId, ref: 'Room' },

  // Financials
  ratePerNight:      { type: Number, required: true },
  totalAmount:       { type: Number, required: true },
  taxAmount:         { type: Number, default: 0 },
  discountAmount:    { type: Number, default: 0 },
  paymentStatus:     { type: String, enum: PAYMENT_STATUS, default: 'unpaid' },
  depositAmount:     { type: Number, default: 0 },
  depositPaid:       { type: Number, default: 0 },
  currency:          { type: String, default: 'ILS' },

  // Relations
  company:           { type: Schema.Types.ObjectId, ref: 'Company' },
  group:             String,

  // Meta
  isVip:             { type: Boolean, default: false },
  specialRequests:   String,
  internalNotes:     String,
  language:          { type: String, default: 'he' },
  externalId:        String,                              // OTA reservation ID

  // Timestamps for operations
  checkedInAt:       Date,
  checkedOutAt:      Date,
  cancelledAt:       Date,
  cancellationReason:String,
  noShowAt:          Date,

  createdBy:         { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy:         { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

ReservationSchema.index({ property: 1, arrivalDate: 1 });
ReservationSchema.index({ property: 1, departureDate: 1 });
ReservationSchema.index({ property: 1, status: 1 });
ReservationSchema.index({ primaryGuest: 1 });
ReservationSchema.index({ property: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

export default model('Reservation', ReservationSchema);
