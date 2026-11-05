// Group money (gap-map item 6, knowledge 14 §6): payments the group sends — recorded with their
// proof (a photo of the cheque, the transfer confirmation), approved or rejected by finance. An
// approved payment is posted to the group's account through the money core; receipts and invoices
// are issued from that account through the invoicing system.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const GROUP_PAY_METHODS = ['cash', 'credit_card', 'bank_transfer', 'cheque'];
export const GROUP_PAY_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

const GroupPaymentSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  group:       { type: Schema.Types.ObjectId, ref: 'GroupBlock', required: true },
  method:      { type: String, enum: GROUP_PAY_METHODS, required: true },
  amount:      { type: Number, required: true, min: 0.01 },
  date:        { type: String, required: true },                 // YYYY-MM-DD the money was paid
  reference:   String,                                            // approval / transfer / cheque number
  description: String,
  details:     { type: Schema.Types.Mixed, default: {} },         // per method, validated like a folio payment
  attachments: [{ type: Schema.Types.ObjectId, ref: 'GroupAttachment' }],
  status:      { type: String, enum: GROUP_PAY_STATUSES, default: 'pending' },
  recordedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  recordedByName: String,
  decidedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  decidedByName: String,
  decidedAt:   Date,
  decisionReason: String,
  folio:       { type: Schema.Types.ObjectId, ref: 'Folio' },     // set when approved and posted
  folioLineId: String,
}, { timestamps: true });
GroupPaymentSchema.index({ property: 1, group: 1, createdAt: -1 });
export const GroupPayment = model('GroupPayment', GroupPaymentSchema);

// The proof file itself. Kept in the database and served only to a signed-in user of the property —
// never from the public uploads folder (it shows bank details).
const GroupAttachmentSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  group:       { type: Schema.Types.ObjectId, ref: 'GroupBlock', required: true },
  name:        { type: String, required: true },
  mime:        { type: String, required: true },
  size:        { type: Number, required: true },
  data:        { type: Buffer, required: true },
  uploadedByName: String,
}, { timestamps: true });
GroupAttachmentSchema.index({ property: 1, group: 1 });
export const GroupAttachment = model('GroupAttachment', GroupAttachmentSchema);
