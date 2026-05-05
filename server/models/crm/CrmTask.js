import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CrmTaskSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  title: { type: String, required: true, trim: true },
  description: String,
  status: {
    type: String,
    enum: ['open', 'in_progress', 'blocked', 'done', 'canceled'],
    default: 'open',
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  },

  dueAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },

  assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

  account: { type: Schema.Types.ObjectId, ref: 'CrmAccount', default: null },
  contact: { type: Schema.Types.ObjectId, ref: 'CrmContact', default: null },
  lead: { type: Schema.Types.ObjectId, ref: 'CrmLead', default: null },
  opportunity: { type: Schema.Types.ObjectId, ref: 'CrmOpportunity', default: null },

  tags: { type: [String], default: [] },
  customFields: { type: Map, of: Schema.Types.Mixed, default: {} },
  active: { type: Boolean, default: true },
}, { timestamps: true });

CrmTaskSchema.index({ property: 1, status: 1, dueAt: 1 });
CrmTaskSchema.index({ property: 1, assignee: 1, status: 1 });
CrmTaskSchema.index({ property: 1, opportunity: 1, status: 1 });

export default model('CrmTask', CrmTaskSchema);
