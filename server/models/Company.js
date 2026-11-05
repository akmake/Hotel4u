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
  voucherRequired: { type: Boolean, default: false }, // bookings paid by this company/agent need a voucher number
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

  // Receivables account (gap-map item 7, services/arService.js). Terms and credit limit stay in
  // paymentTerms / creditLimit above; the limit only flags, "restricted" blocks new charges.
  ar: {
    type: new Schema({
      active:      { type: Boolean, default: false },
      number:      String,                                 // AR-00012
      type:        { type: String, enum: ['standard', 'agency', 'government'], default: 'standard' },
      restricted:  { type: Boolean, default: false },
      restrictedReason: String,
      inStatements: { type: Boolean, default: true },      // included in batch statements
      permanent:   { type: Boolean, default: false },      // never removed by data purge
      billing: {
        name: String, email: String, phone: String, address: String,
      },
      recurring: [new Schema({
        code: String, description: String, amount: Number, day: { type: Number, min: 1, max: 28 },
        active: { type: Boolean, default: true }, lastPeriod: String, byName: String,
      }, { _id: true })],
      openedAt:    Date,
      openedByName: String,
    }, { _id: false }),
    default: undefined,
  },

  notes:  String,
  active: { type: Boolean, default: true },
}, { timestamps: true });

CompanySchema.index({ property: 1, type: 1 });
CompanySchema.index({ property: 1, active: 1 });

export default model('Company', CompanySchema);
