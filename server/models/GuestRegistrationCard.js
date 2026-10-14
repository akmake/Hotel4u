/**
 * GuestRegistrationCard.js
 * כרטיס רישום אורח — חובה לפי חוק בתי מלון, תשי"ד-1954
 * ותקנות בתי מלון (רישום), תשט"ז-1956.
 *
 * חוק החובה:
 *  מנהל בית מלון חייב לנהל פנקס אורחים ולרשום בו:
 *  שם מלא, אזרחות, מספר תעודת זהות / דרכון, תאריך לידה,
 *  תאריך הגעה ועזיבה של כל אורח.
 *
 * כרטיס הרישום נשמר לצמיתות (לא ניתן למחיקה) ומקושר
 * להזמנה ולפרופיל האורח. חתימה דיגיטלית נשמרת כ-URL.
 */

import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const ID_DOC_TYPES = ['passport', 'id_card', 'drivers_license', 'other'];
export const CARD_STATUSES = ['pending', 'signed'];

const GuestRegistrationCardSchema = new Schema({
  // ── קישורים ──────────────────────────────────────────────────────────
  property:     { type: Schema.Types.ObjectId, ref: 'Property',  required: true },
  reservation:  { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  guest:        { type: Schema.Types.ObjectId, ref: 'GuestProfile', required: true },

  // ── פרטי האורח — שדות חובה לפי חוק ──────────────────────────────────
  firstName:    { type: String, required: true },
  lastName:     { type: String, required: true },
  dateOfBirth:  { type: Date,   required: true },
  nationality:  { type: String, required: true },       // אזרחות (קוד ISO-3166)
  idDocType:    { type: String, enum: ID_DOC_TYPES, required: true },
  idDocNumber:  { type: String, required: true },       // מס' ת.ז / דרכון
  idDocExpiry:  { type: Date },                         // תוקף מסמך (חובה לדרכון)
  idDocCountry: { type: String },                       // מדינה מוציאת המסמך

  // ── תאריכי שהות ──────────────────────────────────────────────────────
  arrivalDate:   { type: String, required: true },      // YYYY-MM-DD
  departureDate: { type: String, required: true },      // YYYY-MM-DD

  // ── חתימה ────────────────────────────────────────────────────────────
  status:        { type: String, enum: CARD_STATUSES, default: 'pending' },
  signatureUrl:  { type: String },                      // URL לחתימה דיגיטלית
  signedAt:      { type: Date },
  signedBy:      { type: Schema.Types.ObjectId, ref: 'User' }, // הפקיד שאישר
  signatureHash: { type: String },                      // sha256 של תמונת החתימה (U06)
  idVerified:    { type: Boolean, default: false },     // הפקיד ראה מסמך מזהה — לא צילום (FD-05-F04)
  termsVersion:  { type: String },                      // גרסת נוסח התנאים שהוצג (FD-05-F05)
  digitalDocConsent: { type: Boolean, default: false }, // הסכמה למסמך דיגיטלי — נפרדת משיווק (FD-05-F08)
  reservationRoom: { type: Schema.Types.ObjectId, ref: 'ReservationRoom' },
  // A corrected card replaces the previous one; the old card stays for the record (no deletion).
  supersededBy:  { type: Schema.Types.ObjectId, ref: 'GuestRegistrationCard' },
  supersededAt:  { type: Date },

  // ── מיקום ───────────────────────────────────────────────────────────
  assignedRoom:  { type: String },                      // מס' חדר בעת הצ'ק-אין

  // ── מטא ─────────────────────────────────────────────────────────────
  createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  ipAddress:     { type: String },

}, { timestamps: true });

// ── אינדקסים ──────────────────────────────────────────────────────────────
GuestRegistrationCardSchema.index({ property: 1, arrivalDate: 1 });
GuestRegistrationCardSchema.index({ reservation: 1 });
GuestRegistrationCardSchema.index({ guest: 1 });
GuestRegistrationCardSchema.index({ idDocNumber: 1 });

// ── מניעת מחיקה — שמירה לצמיתות לפי חוק ────────────────────────────────
GuestRegistrationCardSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  const err = new Error('כרטיסי רישום אורחים אינם ניתנים למחיקה לפי חוק בתי מלון');
  err.status = 422;
  throw err;
});

export default model('GuestRegistrationCard', GuestRegistrationCardSchema);
