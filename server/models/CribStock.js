import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true, unique: true },
  totalCount: { type: Number, required: true, min: 0, max: 10000, validate: Number.isInteger },
  revision: { type: Number, required: true, min: 1, validate: Number.isInteger },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
export default mongoose.model('CribStock', schema);
