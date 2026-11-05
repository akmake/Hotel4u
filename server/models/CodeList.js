// Code lists the hotel manages (gap-map item 13): market segments, sources, reasons, special services, VIP
// levels, trace texts, note types, preferences, seasons, language by nationality. Built-in defaults live in
// services/codeListService.js; a stored row overrides a default (label / active / extra) or adds a new code.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const CodeListSchema = new Schema({
  property:  { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  list:      { type: String, required: true },
  code:      { type: String, required: true, maxlength: 40 },
  label:     { type: String, required: true, maxlength: 120 },
  active:    { type: Boolean, default: true },
  sortOrder: { type: Number, default: 100 },
  extra:     { type: Schema.Types.Mixed },          // per list: VIP services, season ranges, segment auto-rules
  updatedByName: String,
}, { timestamps: true });
CodeListSchema.index({ property: 1, list: 1, code: 1 }, { unique: true });

export default mongoose.models.CodeList || model('CodeList', CodeListSchema);
