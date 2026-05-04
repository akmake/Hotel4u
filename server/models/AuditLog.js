import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Immutable audit trail — never update or delete
const AuditLogSchema = new Schema({
  property:   { type: Schema.Types.ObjectId, ref: 'Property' },
  actor:      { type: Schema.Types.ObjectId, ref: 'User' },
  actorName:  String,                                       // denormalized for display
  action:     { type: String, required: true },             // e.g. 'reservation.check_in'
  entityType: { type: String, required: true },             // 'Reservation', 'Room', 'Folio'...
  entityId:   { type: Schema.Types.ObjectId, required: true },
  before:     Schema.Types.Mixed,                           // snapshot before change
  after:      Schema.Types.Mixed,                           // snapshot after change
  reason:     String,
  ip:         String,
  userAgent:  String,
  createdAt:  { type: Date, default: Date.now, immutable: true },
});

AuditLogSchema.index({ property: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1 });
AuditLogSchema.index({ actor: 1 });

export default model('AuditLog', AuditLogSchema);
