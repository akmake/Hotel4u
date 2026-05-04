import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const ContractDocSchema = new Schema({
  name:       { type: String, required: true },
  url:        String,
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

const CompanySchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  name:        { type: String, required: true, trim: true },
  type:        { type: String, enum: ['corporate', 'agency', 'tour_operator', 'government'], default: 'corporate' },

  // Contact
  contactName:  String,
  contactTitle: String,
  email:        String,
  phone:        String,
  address:      String,
  taxId:        String,

  // Financial
  creditLimit:  { type: Number, default: 0 },
  discountPct:  { type: Number, default: 0, min: 0, max: 100 },
  paymentTerms: { type: String, default: 'immediate' },  // e.g. 'Net 30', 'Net 60', 'immediate'
  currency:     { type: String, default: 'ILS' },

  // Contract
  contractNumber:    String,
  contractStartDate: String,  // YYYY-MM-DD
  contractEndDate:   String,
  contractDocuments: { type: [ContractDocSchema], default: [] },

  // Travel agent specific (relevant when type='agency')
  agentCode:       String,
  commissionPct:   { type: Number, default: 0, min: 0, max: 100 },
  rateCodes:       [String],

  notes:  String,
  active: { type: Boolean, default: true },
}, { timestamps: true });

CompanySchema.index({ property: 1, type: 1 });
CompanySchema.index({ property: 1, active: 1 });

export default model('Company', CompanySchema);
