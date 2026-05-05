import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CrmLeadRoutingConditionSchema = new Schema({
  sources: { type: [String], default: [] },
  statuses: { type: [String], default: [] },
  minScore: { type: Number, default: null },
  maxScore: { type: Number, default: null },
  requiredTags: { type: [String], default: [] },
}, { _id: false });

const CrmLeadRoutingAssignmentSchema = new Schema({
  strategy: {
    type: String,
    enum: ['single_owner', 'round_robin', 'unassigned'],
    default: 'single_owner',
  },
  owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  ownerPool: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  assignTeam: { type: String, default: '' },
}, { _id: false });

const CrmLeadRoutingRuleSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  name: { type: String, required: true, trim: true },
  priority: { type: Number, default: 100 },
  active: { type: Boolean, default: true },
  conditions: { type: CrmLeadRoutingConditionSchema, default: {} },
  assignment: { type: CrmLeadRoutingAssignmentSchema, default: {} },
  roundRobinCursor: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

CrmLeadRoutingRuleSchema.index({ property: 1, active: 1, priority: 1 });
CrmLeadRoutingRuleSchema.index({ property: 1, name: 1 });

export default model('CrmLeadRoutingRule', CrmLeadRoutingRuleSchema);
