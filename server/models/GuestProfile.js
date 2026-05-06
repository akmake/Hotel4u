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
  // הסכמות — עם audit trail לפי חוק הספאם (תיקון 40) וחוק הגנת הפרטיות
  marketingConsent:        { type: Boolean, default: false },
  marketingConsentAt:      { type: Date },               // מועד מתן ההסכמה
  marketingConsentIp:      { type: String },             // IP של הדפדפן
  marketingConsentFormVer: { type: String },             // גרסת הטופס שהוצג

  privacyConsent:          { type: Boolean, default: false },
  privacyConsentAt:        { type: Date },
  privacyConsentIp:        { type: String },
  privacyPolicyVersion:    { type: String },             // גרסת מדיניות הפרטיות שהוצגה

  // שמירת נתונים — 7 שנים מהשהות האחרונה (פקודת מס הכנסה + חוק מע"מ)
  retentionDeleteAfter:    { type: Date },               // מחושב אוטומטית מ-lastStay

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

// עדכון אוטומטי של retentionDeleteAfter כאשר lastStay משתנה
// 7 שנים לפי פקודת מס הכנסה + חוק מע"מ
GuestProfileSchema.pre('save', function (next) {
  if (this.isModified('lastStay') && this.lastStay) {
    const d = new Date(this.lastStay);
    d.setFullYear(d.getFullYear() + 7);
    this.retentionDeleteAfter = d;
  }
  next();
});

export default model('GuestProfile', GuestProfileSchema);

