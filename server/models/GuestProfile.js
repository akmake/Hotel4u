import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const GuestProfileSchema = new Schema({
  property:       { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  firstName:      { type: String, required: true },
  lastName:       { type: String, required: true },
  email:          { type: String, index: true },
  phone:          String,
  country:        String,
  language:       { type: String, default: 'he' },
  dateOfBirth:    Date,
  passportNumber: String,
  passportExpiry: Date,
  vipLevel:       { type: Number, default: 0, min: 0, max: 5 },
  isBlacklisted:  { type: Boolean, default: false },
  blacklistReason:String,
  preferences:    String,
  allergies:      String,
  internalNotes:  String,
  marketingConsent:{ type: Boolean, default: false },
  totalStays:     { type: Number, default: 0 },
  totalRevenue:   { type: Number, default: 0 },
}, { timestamps: true });

GuestProfileSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

export default model('GuestProfile', GuestProfileSchema);
