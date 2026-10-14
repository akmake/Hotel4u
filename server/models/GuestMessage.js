import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// GST-04 — a message to a guest, recorded with its purpose (service / document / marketing),
// channel, template version and delivery state. "sent" is not "delivered"; a retry is allowed
// only after a certain failure; the idempotency key stops duplicates.
const GuestMessageSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  guest:       { type: Schema.Types.ObjectId, ref: 'GuestProfile', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation' },
  purpose:     { type: String, enum: ['service', 'document', 'marketing'], required: true },
  channel:     { type: String, enum: ['email', 'sms', 'whatsapp', 'manual'], required: true },
  template:    String,
  language:    String,
  to:          String,                                     // address used (masked in lists)
  subject:     String,
  body:        { type: String, maxlength: 5000 },
  basis:       String,                                     // consent or service purpose that allows sending
  status:      { type: String, enum: ['queued', 'sent', 'delivered', 'failed', 'unknown'], default: 'queued' },
  error:       String,
  idempotencyKey: { type: String, required: true },
  sentAt:      Date,
  byName:      String,
}, { timestamps: true });

GuestMessageSchema.index({ property: 1, idempotencyKey: 1 }, { unique: true });
GuestMessageSchema.index({ guest: 1, createdAt: -1 });

export default model('GuestMessage', GuestMessageSchema);
