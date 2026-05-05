import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CrmLeadScoreSchema = new Schema({
  fit: { type: Number, default: 0 },
  engagement: { type: Number, default: 0 },
  intent: { type: Number, default: 0 },
  negative: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
}, { _id: false });

const CrmLeadSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  account: { type: Schema.Types.ObjectId, ref: 'CrmAccount', default: null },
  contact: { type: Schema.Types.ObjectId, ref: 'CrmContact', default: null },

  fullName: { type: String, required: true, trim: true },
  email: String,
  phone: String,
  companyName: String,
  title: String,

  source: {
    type: String,
    enum: [
      'website_form',
      'import',
      'manual',
      'referral',
      'event',
      'partner',
      'ad',
      'api',
      'other',
    ],
    default: 'manual',
  },
  status: {
    type: String,
    enum: ['new', 'working', 'qualified', 'disqualified', 'converted', 'lost'],
    default: 'new',
  },
  score: { type: CrmLeadScoreSchema, default: {} },

  owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  assignedTeam: String,
  nextActionAt: { type: Date, default: null },
  lastActivityAt: { type: Date, default: null },

  lostReason: String,
  convertedOpportunity: { type: Schema.Types.ObjectId, ref: 'CrmOpportunity', default: null },
  convertedAt: { type: Date, default: null },

  notes: String,
  sourceSystem: String,
  externalId: String,
  tags: { type: [String], default: [] },
  customFields: { type: Map, of: Schema.Types.Mixed, default: {} },

  active: { type: Boolean, default: true },
}, { timestamps: true });

CrmLeadSchema.index({ property: 1, status: 1 });
CrmLeadSchema.index({ property: 1, owner: 1 });
CrmLeadSchema.index({ property: 1, source: 1 });
CrmLeadSchema.index({ property: 1, 'score.total': -1 });

export default model('CrmLead', CrmLeadSchema);
