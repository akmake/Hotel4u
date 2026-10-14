import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// GST-06 — a data-subject request (access, correction, erasure, marketing opt-out). Identity is
// verified with minimal evidence; erasure never destroys books of account or records the law
// requires to keep — those are listed as retained with their basis.
const PrivacyRequestSchema = new Schema({
  property:      { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  code:          { type: String, required: true },
  guest:         { type: Schema.Types.ObjectId, ref: 'GuestProfile' },
  requesterName: { type: String, required: true },
  contact:       { type: String, required: true },
  type:          { type: String, enum: ['access', 'correction', 'erasure', 'marketing_optout', 'other'], required: true },
  scope:         String,
  details:       String,
  verification:  { method: String, by: String, at: Date },
  dueDate:       String,                                   // set by the handler from the approved rule
  status:        { type: String, enum: ['open', 'in_progress', 'done', 'rejected'], default: 'open' },
  decision:      { type: String, enum: ['approved', 'partial', 'rejected'] },
  decisionReason:String,
  approvedBy:    String,
  retained:      [{ category: String, basis: String }],
  actions:       [{ at: { type: Date, default: Date.now }, by: String, kind: String, note: String }],
  respondedAt:   Date,
}, { timestamps: true });

PrivacyRequestSchema.index({ property: 1, status: 1, createdAt: -1 });
PrivacyRequestSchema.index({ property: 1, code: 1 }, { unique: true });

export default model('PrivacyRequest', PrivacyRequestSchema);
