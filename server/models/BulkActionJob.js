import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const BulkActionJobResultSchema = new Schema({
  reservationId: { type: String, required: true },
  success: { type: Boolean, required: true },
  status: { type: String, default: null },
  error: { type: String, default: null },
}, { _id: false });

const BulkActionJobSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorName: { type: String, default: 'system' },
  actorRole: { type: String, default: null },
  action: {
    type: String,
    enum: ['send_confirmation', 'cancel', 'mark_no_show', 'check_in', 'check_out', 'link_group', 'unlink_group'],
    required: true,
  },
  reservationIds: { type: [String], default: [] },
  requestPayload: { type: Schema.Types.Mixed, default: {} },
  status: {
    type: String,
    enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
    default: 'queued',
    index: true,
  },
  cancelRequested: { type: Boolean, default: false },
  total: { type: Number, default: 0 },
  processed: { type: Number, default: 0 },
  succeeded: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  results: { type: [BulkActionJobResultSchema], default: [] },
  error: { type: String, default: null },
  queuedAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  heartbeatAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

BulkActionJobSchema.index({ property: 1, status: 1, updatedAt: -1 });
BulkActionJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });

export default model('BulkActionJob', BulkActionJobSchema);
