// OPS-07 — a recurring preventive-maintenance check (services/preventiveService.js).
import mongoose from 'mongoose';

const { Schema } = mongoose;

const PreventivePlanSchema = new Schema({
  property:  { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  title:     { type: String, required: true, maxlength: 120 },
  category:  { type: String, required: true },
  priority:  { type: String, default: 'low' },
  scope:     { type: String, enum: ['all_rooms', 'room_type', 'rooms', 'area'], default: 'all_rooms' },
  roomType:  { type: Schema.Types.ObjectId, ref: 'RoomType' },
  rooms:     [{ type: Schema.Types.ObjectId, ref: 'Room' }],
  area:      String,
  everyDays: { type: Number, required: true, min: 1 },
  leadDays:  { type: Number, default: 0 },
  nextDue:   { type: String, required: true },            // YYYY-MM-DD of the next round
  checklist: [String],
  active:    { type: Boolean, default: true },
  lastRunAt: Date,
  lastOpened: Number,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

PreventivePlanSchema.index({ property: 1, active: 1, nextDue: 1 });

export default mongoose.models.PreventivePlan || mongoose.model('PreventivePlan', PreventivePlanSchema);
