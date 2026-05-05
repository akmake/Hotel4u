import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CrmPipelineStageSchema = new Schema({
  key: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  order: { type: Number, required: true },
  probabilityDefault: { type: Number, min: 0, max: 100, default: 10 },
  requiredFields: { type: [String], default: [] },
  closeType: {
    type: String,
    enum: ['none', 'won', 'lost'],
    default: 'none',
  },
  active: { type: Boolean, default: true },
}, { _id: true });

const CrmPipelineSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  key: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: String,
  stages: { type: [CrmPipelineStageSchema], default: [] },
  active: { type: Boolean, default: true },
}, { timestamps: true });

CrmPipelineSchema.index({ property: 1, key: 1 }, { unique: true });
CrmPipelineSchema.index({ property: 1, active: 1 });

export default model('CrmPipeline', CrmPipelineSchema);
