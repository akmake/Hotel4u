import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// FIN-12 — one run per property and business day. The run is the lock: a second operator cannot
// start while it is running, and a failed run resumes from the first step that did not finish
// (posting is idempotent per unit-night, so a resumed run never charges twice — T33).
// 'ledgers' (gap G4) stores the trial balance and ledgers of the day; runs created before it existed
// simply do not have the step.
export const DAY_CLOSE_STEPS = ['post_nights', 'no_shows', 'snapshot', 'ledgers', 'advance'];

const StepSchema = new Schema({
  key:        { type: String, enum: DAY_CLOSE_STEPS, required: true },
  status:     { type: String, enum: ['pending', 'running', 'failed', 'done', 'skipped'], default: 'pending' },
  startedAt:  Date,
  finishedAt: Date,
  result:     Schema.Types.Mixed,
  error:      String,
}, { _id: false });

const DayCloseRunSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  businessDate: { type: String, required: true },          // YYYY-MM-DD, the day being closed
  runNo:        { type: String, required: true },          // DC-YYYYMMDD
  status:       { type: String, enum: ['pending', 'running', 'failed', 'done'], default: 'pending' },
  attempts:     { type: Number, default: 0 },
  options: {
    arrivals: { type: String, enum: ['none', 'no_show', 'keep'], default: 'none' },
    reason:   String,
  },
  readiness:    Schema.Types.Mixed,                        // what was open when the run started
  steps:        [StepSchema],
  startedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  startedByName:String,
  finishedAt:   Date,
  heartbeatAt:  Date,
}, { timestamps: true });

DayCloseRunSchema.index({ property: 1, businessDate: 1 }, { unique: true });
DayCloseRunSchema.index({ property: 1, createdAt: -1 });

export default model('DayCloseRun', DayCloseRunSchema);
