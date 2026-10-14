import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// SYS-06 — an item someone must own and resolve (not just read): shift handover notes and alerts
// raised by the system (day close failed, dangerous fault, cancellation awaiting a money decision).
// Taking is atomic, a transfer needs a target and a note, closing needs a resolution.
const NoteSchema = new Schema({
  at:   { type: Date, default: Date.now },
  by:   String,
  kind: { type: String, enum: ['note', 'take', 'transfer', 'close', 'reopen'], default: 'note' },
  text: { type: String, maxlength: 1000 },
  to:   String,
}, { _id: false });

const WorkItemSchema = new Schema({
  property:  { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  kind:      { type: String, enum: ['operations', 'finance', 'integration', 'security', 'handover'], default: 'handover' },
  severity:  { type: String, enum: ['info', 'action', 'urgent'], default: 'action' },
  title:     { type: String, required: true, maxlength: 200 },
  body:      { type: String, maxlength: 2000 },
  source:    { type: { type: String }, id: String, label: String, link: String },
  dedupeKey: String,                                      // one open item per system event
  owner:     { type: Schema.Types.ObjectId, ref: 'User' },
  ownerName: String,
  status:    { type: String, enum: ['new', 'in_progress', 'closed'], default: 'new' },
  dueAt:     Date,
  notes:     [NoteSchema],
  closedReason: String,
  closedAt:  Date,
  createdBy: String,
}, { timestamps: true });

WorkItemSchema.index({ property: 1, status: 1, severity: 1, createdAt: -1 });
WorkItemSchema.index({ property: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' }, status: { $in: ['new', 'in_progress'] } } });

export default model('WorkItem', WorkItemSchema);
