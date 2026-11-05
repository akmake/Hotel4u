// Receivables (gap-map item 7): every statement / reminder sent to an AR account, with a snapshot of
// what it showed — so it can be reprinted as sent, and a reminder is not repeated in the same cycle.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const ArLetterSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  company:  { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  kind:     { type: String, enum: ['statement', 'reminder'], required: true },
  level:    Number,                       // reminder level 1..3
  from:     String,
  to:       String,
  text:     String,                       // free text line
  withCopies: Boolean,
  via:      { type: String, enum: ['print', 'email'], default: 'print' },
  email:    String,
  batch:    String,                       // batch id when sent in a batch
  balance:  Number,
  snapshot: Schema.Types.Mixed,           // the statement as it was sent
  by:       { type: Schema.Types.ObjectId, ref: 'User' },
  byName:   String,
}, { timestamps: true });

ArLetterSchema.index({ property: 1, company: 1, createdAt: -1 });
ArLetterSchema.index({ property: 1, kind: 1, createdAt: -1 });

export default model('ArLetter', ArLetterSchema);
