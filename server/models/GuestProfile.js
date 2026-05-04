import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const GuestNoteSchema = new Schema({
  text:      { type: String, required: true },
  createdBy: String,
}, { timestamps: true });

const GuestProfileSchema = new Schema({
  property:       { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  firstName:      { type: String, required: true },
  lastName:       { type: String, required: true },
  email:          { type: String, index: true },
  phone:          String,
  gender:         { type: String, enum: ['M','F','other','unknown'], default: 'unknown' },
  country:        String,
  citizenship:    String,
  address: {
    line1:   String,
    city:    String,
    state:   String,
    zip:     String,
    country: String,
  },
  language:       { type: String, default: 'he' },
  dateOfBirth:    Date,
  idDocType:      { type: String, enum: ['passport','id_card','drivers_license','other'], default: 'passport' },
  passportNumber: String,
  passportExpiry: Date,
  loyaltyId:      String,
  vipLevel:       { type: Number, default: 0, min: 0, max: 5 },
  isBlacklisted:  { type: Boolean, default: false },
  blacklistReason:String,
  preferences:    String,
  allergies:      String,
  internalNotes:  String,
  notes:          [GuestNoteSchema],
  tags:           [{ type: String }],
  marketingConsent: { type: Boolean, default: false },
  privacyConsent:   { type: Boolean, default: false },
  totalStays:     { type: Number, default: 0 },
  totalRevenue:   { type: Number, default: 0 },
  noShowCount:    { type: Number, default: 0 },
  cancellationCount: { type: Number, default: 0 },
  lastStay:       Date,
  isAnonymized:   { type: Boolean, default: false },
  mergedInto:     { type: Schema.Types.ObjectId, ref: 'GuestProfile' },
}, { timestamps: true });

GuestProfileSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

export default model('GuestProfile', GuestProfileSchema);

