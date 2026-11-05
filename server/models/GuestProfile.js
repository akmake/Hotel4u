import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const GuestNoteSchema = new Schema({
  text:      { type: String, required: true },
  createdBy: String,
  type:      String,   // code from the hotel's note types ('reservation' notes are copied to every new booking)
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
  // ── OPERA-style additional contact ──
  title:          { type: String, enum: ['Mr','Mrs','Ms','Dr','Prof',''], default: '' },
  company:        String,
  jobTitle:       String,
  phones: [{
    number: String,
    type:   { type: String, enum: ['mobile','home','work','fax','other'], default: 'mobile' },
    primary:{ type: Boolean, default: false },
  }],
  emails: [{
    address: String,
    type:    { type: String, enum: ['personal','work','other'], default: 'personal' },
    primary: { type: Boolean, default: false },
  }],
  addresses: [{
    type:    { type: String, enum: ['home','work','other'], default: 'home' },
    line1:   String,
    line2:   String,
    city:    String,
    state:   String,
    zip:     String,
    country: String,
  }],
  // ── Loyalty / Membership ──
  loyaltyId:        String,
  membershipTier:   { type: String, enum: ['standard','silver','gold','platinum','diamond',''], default: '' },
  membershipPoints: { type: Number, default: 0 },
  vipLevel:       { type: Number, default: 0, min: 0, max: 5 },
  isBlacklisted:  { type: Boolean, default: false },
  blacklistReason:String,
  // ── OPERA-style detailed preferences ──
  roomTypePreference: String,
  bedTypePreference:  { type: String, enum: ['king','queen','twin','double','single',''], default: '' },
  floorPreference:    { type: String, enum: ['high','low','middle','any'], default: 'any' },
  smokingPreference:  { type: String, enum: ['smoking','non-smoking','any'], default: 'non-smoking' },
  pillow:             { type: String, enum: ['feather','foam','any',''], default: '' },
  newspaper:          String,
  specialRequests:    String,
  preferences:    String,
  preferenceCodes:{ type: [String], default: [] },   // codes from the hotel's preference list (CodeList 'preference')
  allergies:      String,
  internalNotes:  String,
  notes:          [GuestNoteSchema],
  // Profiles (gap-map item 16): relations, restriction rule, stays from a previous system, contact (does not stay).
  relations:      { type: [new Schema({ kind: { type: String, enum: ['company', 'family', 'assistant', 'colleague', 'other'] }, guest: { type: Schema.Types.ObjectId, ref: 'GuestProfile' }, company: { type: Schema.Types.ObjectId, ref: 'Company' }, note: String }, { _id: true })], default: [] },
  restriction:    { type: new Schema({ rule: { type: String, enum: ['alert', 'manager_approval', 'prepay_only'] }, note: String, byName: String, at: Date }, { _id: false }), default: undefined },
  pastStays:      { type: [new Schema({ arrival: String, departure: String, nights: Number, roomType: String, amount: Number, source: String, note: String, byName: String, at: Date }, { _id: true })], default: [] },
  isContact:      { type: Boolean, default: false },
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
  anonymizedAt:   Date,
  mergedInto:     { type: Schema.Types.ObjectId, ref: 'GuestProfile' },
  mergedAt:       Date,
  // GST-02: identity document — issuing country and who verified it (no copy is required).
  idDocCountry:   String,
  idVerifiedBy:   String,
  idVerifiedAt:   Date,
  residency:      String,                                  // residence ≠ citizenship ≠ tax status (G04)
  marketingOptOutAt: Date,                                 // GST-04-A06: immediate, separate from service messages
}, { timestamps: true });

GuestProfileSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// עדכון אוטומטי של retentionDeleteAfter כאשר lastStay משתנה
// 7 שנים לפי פקודת מס הכנסה + חוק מע"מ
GuestProfileSchema.pre('save', function () {
  if (this.isModified('lastStay') && this.lastStay) {
    const d = new Date(this.lastStay);
    d.setFullYear(d.getFullYear() + 7);
    this.retentionDeleteAfter = d;
  }
});

export default model('GuestProfile', GuestProfileSchema);


// Files attached to a guest profile (gap-map item 16): kept in the database, served only to signed-in users of the property.
const GuestAttachmentSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  guest:    { type: Schema.Types.ObjectId, ref: 'GuestProfile', required: true },
  name:     { type: String, required: true, maxlength: 120 },
  mime:     { type: String, required: true },
  size:     Number,
  data:     { type: Buffer, required: true },
  byName:   String,
  removed:  { type: Boolean, default: false },
}, { timestamps: true });
GuestAttachmentSchema.index({ property: 1, guest: 1 });
export const GuestAttachment = mongoose.models.GuestAttachment || model('GuestAttachment', GuestAttachmentSchema);
