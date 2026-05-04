import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const MT_CATEGORY = ['electricity','water','hvac','furniture','cleaning','safety','lock','internet','tv','noise','other'];
export const MT_PRIORITY = ['critical','high','medium','low'];
export const MT_STATUS   = ['new','assigned','in_progress','waiting_parts','waiting_vendor','resolved','verified','closed','reopened'];

const MaintenanceTicketSchema = new Schema({
  property:      { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  room:          { type: Schema.Types.ObjectId, ref: 'Room' },
  areaId:        String,                                   // public area if not a room
  category:      { type: String, enum: MT_CATEGORY, required: true },
  description:   { type: String, required: true },
  priority:      { type: String, enum: MT_PRIORITY, default: 'medium' },
  status:        { type: String, enum: MT_STATUS, default: 'new' },
  reportedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  assignedTo:    { type: Schema.Types.ObjectId, ref: 'User' },
  vendor:        String,
  estimatedCost: Number,
  actualCost:    Number,
  dueDate:       Date,
  resolvedAt:    Date,
  notes:         String,
  blocksRoom:    { type: Boolean, default: false },        // if true, room goes OOO
}, { timestamps: true });

MaintenanceTicketSchema.index({ property: 1, status: 1 });
MaintenanceTicketSchema.index({ room: 1 });

export default model('MaintenanceTicket', MaintenanceTicketSchema);
