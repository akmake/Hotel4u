import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Pre-arrival online check-in: one record per reservation. The link token is a guest capability;
// it is looked up by sha256 and kept sealed so every send repeats the same link. What the guest fills in becomes a
// registration card (idVerified stays false until the desk sees the document) and upsell requests
// that the desk approves before anything is charged.
export const OCI_STATUSES = ['sent', 'opened', 'submitted'];
export const UPSELL_STATUSES = ['requested', 'approved', 'declined', 'posted', 'cancelled'];

const UpsellSchema = new Schema({
  key:        { type: String, required: true },
  kind:       { type: String, enum: ['early_checkin', 'late_checkout', 'extra'], required: true },
  label:      { type: String, required: true },
  price:      { type: Number, required: true, min: 0 },
  chargeCode: { type: String, required: true },
  time:       String,                                   // HH:MM for early check-in / late check-out
  status:     { type: String, enum: UPSELL_STATUSES, default: 'requested' },
  requestedAt: { type: Date, default: Date.now },
  decidedAt:  Date,
  decidedByName: String,
  declineReason: String,
  folioId:    String,
  lineId:     String,
  postedAt:   Date,
}, { _id: true });

const OnlineCheckInSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  tokenHash:   { type: String, required: true },
  tokenSealed: String,                                  // the same link can be sent again (utils/secretBox)
  expiresAt:   { type: Date, required: true },
  status:      { type: String, enum: OCI_STATUSES, default: 'sent' },
  sentAt:      Date,
  sentByName:  String,
  sentVia:     [String],                                // email · link (copied by the desk) · reminder
  openedAt:    Date,
  submittedAt: Date,
  submitIp:    String,
  eta:         String,
  requests:    String,
  registrationCard: { type: Schema.Types.ObjectId, ref: 'GuestRegistrationCard' },
  upsells:     [UpsellSchema],
}, { timestamps: true });

OnlineCheckInSchema.index({ reservation: 1 }, { unique: true });
OnlineCheckInSchema.index({ tokenHash: 1 });
OnlineCheckInSchema.index({ property: 1, status: 1 });

export default model('OnlineCheckIn', OnlineCheckInSchema);
