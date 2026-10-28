import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  requestKey: { type: String, required: true },
  requestHash: { type: String, required: true },
  status: { type: String, enum: ['applied', 'rolled_back'], required: true },
  targetDate: { type: String, required: true },
  sourceFingerprint: { type: String, required: true },
  afterFingerprint: String,
  financialHash: { type: String, required: true },
  originalDayClose: Schema.Types.Mixed,
  hadDayClose: Boolean,
  folios: [{ folio: Schema.Types.ObjectId, version: Number, hadVersion: Boolean, updatedAt: Date, hadUpdatedAt: Boolean }],
  changes: [{ folio: Schema.Types.ObjectId, line: Schema.Types.ObjectId, index: Number, accountingDate: String }],
  backupReference: { type: String, required: true },
  reason: { type: String, required: true },
  appliedBy: Schema.Types.ObjectId,
  appliedByName: String,
  rollbackHash: String,
  rollbackReason: String,
  rolledBackAt: Date,
  rolledBackBy: Schema.Types.ObjectId,
  result: Schema.Types.Mixed,
}, { timestamps: true });
schema.index({ property: 1, requestKey: 1 }, { unique: true });
export default mongoose.model('BusinessDayMigration', schema);
