import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CrmActivitySchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },

  type: {
    type: String,
    enum: ['call', 'email', 'meeting', 'note', 'message', 'task_update', 'system'],
    required: true,
  },
  direction: {
    type: String,
    enum: ['inbound', 'outbound', 'internal'],
    default: 'internal',
  },
  channel: {
    type: String,
    enum: ['email', 'phone', 'whatsapp', 'sms', 'meeting', 'chat', 'other'],
    default: 'other',
  },
  subject: { type: String, required: true, trim: true },
  summary: String,
  outcome: String,
  happenedAt: { type: Date, default: Date.now },

  account: { type: Schema.Types.ObjectId, ref: 'CrmAccount', default: null },
  contact: { type: Schema.Types.ObjectId, ref: 'CrmContact', default: null },
  lead: { type: Schema.Types.ObjectId, ref: 'CrmLead', default: null },
  opportunity: { type: Schema.Types.ObjectId, ref: 'CrmOpportunity', default: null },

  owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
  active: { type: Boolean, default: true },
}, { timestamps: true });

CrmActivitySchema.index({ property: 1, happenedAt: -1 });
CrmActivitySchema.index({ property: 1, owner: 1, happenedAt: -1 });
CrmActivitySchema.index({ property: 1, opportunity: 1, happenedAt: -1 });
CrmActivitySchema.index({ property: 1, contact: 1, happenedAt: -1 });

export default model('CrmActivity', CrmActivitySchema);
