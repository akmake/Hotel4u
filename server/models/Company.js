import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const CompanySchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  name:        { type: String, required: true },
  type:        { type: String, enum: ['corporate', 'agency', 'tour_operator', 'government'], default: 'corporate' },
  contactName: String,
  email:       String,
  phone:       String,
  address:     String,
  taxId:       String,
  creditLimit: { type: Number, default: 0 },
  discountPct: { type: Number, default: 0, min: 0, max: 100 },
  notes:       String,
  active:      { type: Boolean, default: true },
}, { timestamps: true });

export default model('Company', CompanySchema);
