// Receivables (gap-map item 7): notes on an AR account (calls, history of problems) and traces —
// action items with a due date, marked done. One collection, kind decides.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const ArNoteSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  company:  { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  kind:     { type: String, enum: ['note', 'trace'], required: true },
  text:     { type: String, required: true, maxlength: 1000 },
  dueDate:  String,                       // trace: YYYY-MM-DD
  done:     { type: Boolean, default: false },
  doneAt:   Date,
  doneByName: String,
  by:       { type: Schema.Types.ObjectId, ref: 'User' },
  byName:   String,
}, { timestamps: true });

ArNoteSchema.index({ property: 1, company: 1, createdAt: -1 });
ArNoteSchema.index({ property: 1, kind: 1, done: 1, dueDate: 1 });

export default model('ArNote', ArNoteSchema);
