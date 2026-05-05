import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CrmOpportunitySchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  account: { type: Schema.Types.ObjectId, ref: 'CrmAccount', required: true },
  primaryContact: { type: Schema.Types.ObjectId, ref: 'CrmContact', default: null },
  lead: { type: Schema.Types.ObjectId, ref: 'CrmLead', default: null },

  name: { type: String, required: true, trim: true },
  pipelineKey: { type: String, default: 'default' },
  stage: {
    type: String,
    enum: [
      'qualification',
      'discovery',
      'proposal',
      'negotiation',
      'contract',
      'closed_won',
      'closed_lost',
    ],
    default: 'qualification',
  },

  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'ILS' },
  probability: { type: Number, min: 0, max: 100, default: 10 },
  expectedCloseDate: { type: String, default: null }, // YYYY-MM-DD
  closedAt: { type: Date, default: null },
  lostReason: String,
  healthStatus: {
    type: String,
    enum: ['healthy', 'at_risk', 'stalled'],
    default: 'healthy',
  },

  owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  lastActivityAt: { type: Date, default: null },

  tags: { type: [String], default: [] },
  customFields: { type: Map, of: Schema.Types.Mixed, default: {} },
  active: { type: Boolean, default: true },
}, { timestamps: true });

CrmOpportunitySchema.index({ property: 1, stage: 1 });
CrmOpportunitySchema.index({ property: 1, pipelineKey: 1, stage: 1 });
CrmOpportunitySchema.index({ property: 1, owner: 1 });
CrmOpportunitySchema.index({ property: 1, expectedCloseDate: 1 });

export default model('CrmOpportunity', CrmOpportunitySchema);
