import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const HK_TYPE     = ['checkout_clean','stayover','deep_clean','turndown','pickup','arrival_prep'];
export const HK_PRIORITY = ['urgent','high','medium','low'];
export const HK_STATUS   = ['new','assigned','in_progress','paused','completed','failed_inspection','inspected','cancelled'];

const HousekeepingTaskSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  room:        { type: Schema.Types.ObjectId, ref: 'Room', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation' },
  type:        { type: String, enum: HK_TYPE, required: true },
  priority:    { type: String, enum: HK_PRIORITY, default: 'medium' },
  status:      { type: String, enum: HK_STATUS, default: 'new' },
  date:        { type: String, required: true },           // 'YYYY-MM-DD'
  dueTime:     String,                                     // 'HH:MM'
  assignedTo:  { type: Schema.Types.ObjectId, ref: 'User' },
  assignedAt:  Date,
  startedAt:   Date,
  completedAt: Date,
  inspectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  inspectedAt: Date,
  notes:       String,
  inspectionNotes: String,
  autoCreated: { type: Boolean, default: false },          // created by checkout trigger
}, { timestamps: true });

HousekeepingTaskSchema.index({ property: 1, date: 1, status: 1 });
HousekeepingTaskSchema.index({ room: 1, date: 1 });

export default model('HousekeepingTask', HousekeepingTaskSchema);
