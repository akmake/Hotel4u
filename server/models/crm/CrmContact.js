import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CrmConsentSchema = new Schema({
  email: { type: Boolean, default: true },
  sms: { type: Boolean, default: false },
  whatsapp: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const CrmContactSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  account: { type: Schema.Types.ObjectId, ref: 'CrmAccount', default: null },

  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, trim: true, default: '' },
  email: String,
  phone: String,
  title: String,
  buyerRoles: { type: [String], default: [] },
  preferredChannel: {
    type: String,
    enum: ['email', 'phone', 'whatsapp', 'sms', 'none'],
    default: 'none',
  },
  consent: { type: CrmConsentSchema, default: {} },

  owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  lifecycleStatus: {
    type: String,
    enum: ['lead', 'active', 'inactive'],
    default: 'lead',
  },
  lastInteractionAt: { type: Date, default: null },

  sourceSystem: String,
  externalId: String,
  tags: { type: [String], default: [] },
  customFields: { type: Map, of: Schema.Types.Mixed, default: {} },

  active: { type: Boolean, default: true },
}, { timestamps: true });

CrmContactSchema.index({ property: 1, account: 1 });
CrmContactSchema.index({ property: 1, owner: 1 });
CrmContactSchema.index({ property: 1, email: 1 });
CrmContactSchema.index({ property: 1, phone: 1 });
CrmContactSchema.index({ property: 1, lifecycleStatus: 1 });

export default model('CrmContact', CrmContactSchema);
