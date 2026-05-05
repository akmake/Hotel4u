import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CrmTimelineEventSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  entityType: {
    type: String,
    enum: ['account', 'contact', 'lead', 'opportunity', 'activity', 'task', 'system'],
    required: true,
  },
  entityId: { type: String, required: true },
  eventType: { type: String, required: true },
  title: { type: String, required: true },
  description: String,
  source: {
    type: String,
    enum: ['manual', 'workflow', 'integration', 'system', 'ai'],
    default: 'system',
  },
  actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  payload: { type: Map, of: Schema.Types.Mixed, default: {} },
  happenedAt: { type: Date, default: Date.now },
}, { timestamps: true });

CrmTimelineEventSchema.index({ property: 1, happenedAt: -1 });
CrmTimelineEventSchema.index({ property: 1, entityType: 1, entityId: 1, happenedAt: -1 });
CrmTimelineEventSchema.index({ property: 1, eventType: 1, happenedAt: -1 });

export default model('CrmTimelineEvent', CrmTimelineEventSchema);
