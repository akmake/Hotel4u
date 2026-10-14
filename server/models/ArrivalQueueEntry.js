import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// FD-04 — a guest who physically arrived but whose unit cannot enter yet.
// Queueing never changes the reservation, inventory or room status; it tracks the delay,
// who owns resolving it and when it was resolved.
export const QUEUE_REASONS = ['cleaning', 'inspection', 'maintenance', 'assignment', 'occupied'];
export const QUEUE_PRIORITIES = ['normal', 'urgent'];
export const QUEUE_CONTACT = ['desk', 'message'];
export const QUEUE_STATUS = ['active', 'checked_in', 'removed'];

const ArrivalQueueEntrySchema = new Schema({
  property:        { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation:     { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  reservationRoom: { type: Schema.Types.ObjectId, ref: 'ReservationRoom', required: true },
  room:            { type: Schema.Types.ObjectId, ref: 'Room' },       // room at the time of queueing, if any
  arrivedAt:       { type: Date, required: true },                       // server time, never client-supplied
  reason:          { type: String, enum: QUEUE_REASONS, required: true },
  owner:           { type: Schema.Types.ObjectId, ref: 'User', required: true },
  ownerName:       String,
  housekeepingTask:{ type: Schema.Types.ObjectId, ref: 'HousekeepingTask' },
  readyEta:        Date,                                                 // estimate, not a commitment
  priority:        { type: String, enum: QUEUE_PRIORITIES, default: 'normal' },
  guestContact:    { type: String, enum: QUEUE_CONTACT },
  notes:           { type: String, maxlength: 2000 },
  status:          { type: String, enum: QUEUE_STATUS, default: 'active' },
  resolvedAt:      Date,
  removalReason:   { type: String, maxlength: 500 },
  createdBy:       { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy:       { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, optimisticConcurrency: true });

ArrivalQueueEntrySchema.index({ property: 1, status: 1, arrivedAt: 1 });
// One active queue entry per unit.
ArrivalQueueEntrySchema.index(
  { reservationRoom: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

export default model('ArrivalQueueEntry', ArrivalQueueEntrySchema);
