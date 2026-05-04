import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const ChannelUpdateQueueSchema = new Schema({
  property:      { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  channel:       { type: String, required: true },
  eventType:     { type: String, enum: ['availability', 'rate', 'restriction', 'reservation'], required: true },
  payload:       { type: Schema.Types.Mixed, required: true },
  idempotencyKey:{ type: String },
  status:        { type: String, enum: ['pending', 'processing', 'sent', 'failed', 'dead_letter'], default: 'pending' },
  attempts:      { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lastError:     String,
  sentAt:        Date,
}, { timestamps: true });

ChannelUpdateQueueSchema.index({ property: 1, status: 1, nextAttemptAt: 1 });
ChannelUpdateQueueSchema.index({ property: 1, channel: 1, eventType: 1, createdAt: -1 });
ChannelUpdateQueueSchema.index(
  { property: 1, channel: 1, idempotencyKey: 1 },
  { unique: true, sparse: true }
);

export default model('ChannelUpdateQueue', ChannelUpdateQueueSchema);
