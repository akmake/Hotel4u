import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const MT_CATEGORY = ['electricity','water','hvac','furniture','cleaning','safety','lock','internet','tv','noise','other'];
export const MT_PRIORITY = ['critical','high','medium','low'];
export const MT_STATUS   = ['new','assigned','in_progress','waiting_parts','waiting_vendor','resolved','verified','closed','reopened'];

const NoteSchema = new Schema({
  text:       { type: String, required: true },
  author:     { type: Schema.Types.ObjectId, ref: 'User' },
  authorName: String,
  createdAt:  { type: Date, default: Date.now },
}, { _id: true });

const PhotoSchema = new Schema({
  url:        { type: String, required: true },
  caption:    String,
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

const PartSchema = new Schema({
  name:     { type: String, required: true },
  quantity: { type: Number, default: 1, min: 1 },
  ordered:  { type: Boolean, default: false },
  orderedAt:Date,
  notes:    String,
}, { _id: true });

const MaintenanceTicketSchema = new Schema({
  property:      { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  room:          { type: Schema.Types.ObjectId, ref: 'Room' },
  areaId:        String,
  // OPS-07: opened by a preventive-maintenance plan (one ticket per plan, due date and room).
  preventive:    { plan: { type: Schema.Types.ObjectId, ref: 'PreventivePlan' }, due: String },
  category:      { type: String, enum: MT_CATEGORY, required: true },
  description:   { type: String, required: true },
  priority:      { type: String, enum: MT_PRIORITY, default: 'medium' },
  status:        { type: String, enum: MT_STATUS, default: 'new' },
  reportedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  assignedTo:    { type: Schema.Types.ObjectId, ref: 'User' },

  // Vendor
  vendor:        String,
  vendorContact: {
    name:  String,
    phone: String,
    email: String,
  },

  // Cost
  estimatedCost: Number,
  actualCost:    Number,

  // Timeline
  dueDate:       Date,
  startedAt:     Date,
  resolvedAt:    Date,

  // Documentation
  photos:        { type: [PhotoSchema], default: [] },
  partsNeeded:   { type: [PartSchema], default: [] },

  // Notes
  notes:         String,
  internalNotes: { type: [NoteSchema], default: [] },

  blocksRoom:    { type: Boolean, default: false },
  // OPS-06: what this means for guests — nothing, the room cannot be sold/used, or a guest must move.
  guestImpact:   { type: String, enum: ['none', 'block', 'move'], default: 'none' },
  reopenReason:  String,
  closingNote:   String,
  closedAt:      Date,
  closedBy:      { type: Schema.Types.ObjectId, ref: 'User' },
  slaBreach:     { type: Boolean, default: false },

  // Closing requires approval for critical
  closingApprovedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  closingApprovedAt:   Date,
}, { timestamps: true });

MaintenanceTicketSchema.index({ property: 1, status: 1 });
MaintenanceTicketSchema.index({ property: 1, priority: 1 });
MaintenanceTicketSchema.index({ room: 1 });

export default model('MaintenanceTicket', MaintenanceTicketSchema);
