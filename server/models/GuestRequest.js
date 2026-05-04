import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const GR_CATEGORIES = [
  'towels',
  'cleaning',
  'maintenance',
  'food',
  'transport',
  'complaint',
  'amenities',
  'noise',
  'temperature',
  'general',
];

export const GR_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export const GR_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'cancelled',
];

const GuestRequestSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation:  { type: Schema.Types.ObjectId, ref: 'Reservation' },
  room:         { type: Schema.Types.ObjectId, ref: 'Room' },
  guest:        { type: Schema.Types.ObjectId, ref: 'GuestProfile' },

  category:     { type: String, enum: GR_CATEGORIES, required: true },
  description:  { type: String, required: true, trim: true },
  priority:     { type: String, enum: GR_PRIORITIES, default: 'medium' },
  status:       { type: String, enum: GR_STATUSES, default: 'open' },

  // Assignment
  assignedTo:   { type: Schema.Types.ObjectId, ref: 'User' },
  assignedAt:   Date,
  department:   String,

  // SLA
  slaMinutes:   { type: Number, default: 30 },
  dueAt:        Date,

  // Resolution
  resolvedAt:   Date,
  closedAt:     Date,
  resolutionNotes: String,

  // Guest communication
  guestNotified:     { type: Boolean, default: false },
  guestNotifiedAt:   Date,
  satisfactionScore: { type: Number, min: 1, max: 5 },

  // Audit
  createdBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Auto-set dueAt from slaMinutes on create
GuestRequestSchema.pre('save', function (next) {
  if (this.isNew && !this.dueAt && this.slaMinutes) {
    this.dueAt = new Date(Date.now() + this.slaMinutes * 60_000);
  }
  next();
});

GuestRequestSchema.virtual('isOverdue').get(function () {
  return this.dueAt && this.status !== 'resolved' && this.status !== 'closed' && new Date() > this.dueAt;
});

GuestRequestSchema.index({ property: 1, status: 1 });
GuestRequestSchema.index({ property: 1, createdAt: -1 });
GuestRequestSchema.index({ reservation: 1 });
GuestRequestSchema.index({ room: 1, status: 1 });

export default model('GuestRequest', GuestRequestSchema);
