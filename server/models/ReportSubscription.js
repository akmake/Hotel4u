import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// A scheduled e-mail of reports (Cloudbeds "report subscriptions"): which reports, how often, at
// what hotel time, in which file format, to whom. One e-mail per run with one Excel file holding
// every report as its own sheet (CSV: one file per report).
export const RS_FREQUENCIES = ['daily', 'weekly', 'monthly'];
export const RS_FORMATS = ['xlsx', 'csv'];

const ReportSubscriptionSchema = new Schema({
  property:   { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  number:     { type: Number, required: true },                 // shown as the subscription ID
  subject:    { type: String, required: true, maxlength: 150 },
  reports:    { type: [String], required: true },
  frequency:  { type: String, enum: RS_FREQUENCIES, required: true },
  days:       { type: [Number], default: [] },                  // weekly: 0 = Sunday … 6 = Saturday
  time:       { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // hotel time
  format:     { type: String, enum: RS_FORMATS, default: 'xlsx' },
  recipients: { type: [String], required: true },
  active:     { type: Boolean, default: true },
  nextRunAt:  Date,
  lastRunAt:  Date,
  lastStatus: { type: String, enum: ['sent', 'failed', null], default: null },
  lastError:  String,
  createdByName: String,
  updatedByName: String,
}, { timestamps: true });

ReportSubscriptionSchema.index({ property: 1, number: 1 }, { unique: true });
ReportSubscriptionSchema.index({ active: 1, nextRunAt: 1 });

export default model('ReportSubscription', ReportSubscriptionSchema);
