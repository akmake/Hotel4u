import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const HK_TYPE     = ['checkout_clean','stayover','deep_clean','turndown','pickup','arrival_prep'];
export const HK_PRIORITY = ['urgent','high','medium','low'];
export const HK_STATUS   = ['new','assigned','in_progress','paused','completed','failed_inspection','inspected','cancelled'];

const LostFoundSchema = new Schema({
  itemDescription: { type: String, required: true },
  foundLocation:   String,
  reportedBy:      String,
  status:          { type: String, enum: ['found','claimed','donated','discarded'], default: 'found' },
  reportedAt:      { type: Date, default: Date.now },
}, { _id: true });

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
  pausedAt:    Date,
  pauseReason: String,
  cancelledAt: Date,
  cancelReason:String,
  inspectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  inspectedAt: Date,
  notes:       String,
  inspectionNotes: String,
  supplies:    [{ item: String, qty: Number }],
  photos:      [String],                                   // URLs / base64 refs
  checklist:   [{ item: String, done: Boolean }],           // OPS-02 results, from the property checklist
  returnReason:String,                                     // OPS-04 "return to cleaning"
  returnedAt:  Date,
  returnedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  inspectionChecklist: [{ item: String, done: Boolean }],
  defects:     [{ text: String, severity: { type: String, enum: ['minor', 'major', 'blocking'] } }],
  isDND:       { type: Boolean, default: false },          // Do Not Disturb
  isNoService: { type: Boolean, default: false },          // Guest declined service
  lostFound:   [LostFoundSchema],
  issueReported: {
    description: String,
    reportedAt:  Date,
    ticketId:    { type: Schema.Types.ObjectId, ref: 'MaintenanceTicket' },
  },
  autoCreated: { type: Boolean, default: false },
}, { timestamps: true });

HousekeepingTaskSchema.index({ property: 1, date: 1, status: 1 });
HousekeepingTaskSchema.index({ room: 1, date: 1 });

export default model('HousekeepingTask', HousekeepingTaskSchema);

