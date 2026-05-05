import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CrmAddressSchema = new Schema({
  line1: String,
  line2: String,
  city: String,
  state: String,
  postalCode: String,
  country: String,
}, { _id: false });

const CrmAccountSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  name: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['business', 'person', 'partner', 'other'],
    default: 'business',
  },
  lifecycleStatus: {
    type: String,
    enum: ['prospect', 'active', 'inactive', 'churn_risk', 'churned'],
    default: 'prospect',
  },
  owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  parentAccount: { type: Schema.Types.ObjectId, ref: 'CrmAccount', default: null },

  industry: String,
  website: String,
  email: String,
  phone: String,
  address: { type: CrmAddressSchema, default: {} },

  sourceSystem: String,
  externalId: String,

  healthScore: { type: Number, min: 0, max: 100, default: 50 },
  tags: { type: [String], default: [] },
  customFields: { type: Map, of: Schema.Types.Mixed, default: {} },

  active: { type: Boolean, default: true },
}, { timestamps: true });

CrmAccountSchema.index({ property: 1, name: 1 });
CrmAccountSchema.index({ property: 1, lifecycleStatus: 1 });
CrmAccountSchema.index({ property: 1, owner: 1 });
CrmAccountSchema.index({ property: 1, parentAccount: 1 });

export default model('CrmAccount', CrmAccountSchema);
