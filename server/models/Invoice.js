/**
 * Invoice Model — מערכת חשבוניות ישראלית
 *
 * שדות חובה לפי חוק מס ערך מוסף, תשל"ו-1975 וכללי ניהול ספרים:
 *  - שם + כתובת + מספר עוסק מורשה של המוציא
 *  - מספר חשבונית סידורי ורציף
 *  - תאריך ביצוע העסקה
 *  - תיאור השירות / המוצר
 *  - סכום נטו + סכום מע"מ + סכום כולל מע"מ
 *  - ציון "מקור" / "העתק"
 *
 * סוגי מסמכים נתמכים:
 *  tax_invoice        — חשבונית מס
 *  tax_invoice_receipt— חשבונית מס קבלה (שולמה במעמד ההוצאה)
 *  receipt            — קבלה (ללא מע"מ להחזר)
 *  proforma           — חשבון עסקה (דרישת תשלום — אינו מסמך מע"מ)
 *  credit_note        — הודעת זיכוי (ביטול / זיכוי חלקי)
 *  debit_note         — הודעת חיוב (תוספת לחשבונית קיימת)
 *
 * חוק חדש 2024 (מספר הקצאה):
 *  חשבוניות מס B2B מעל 25,000 ₪ מחייבות מספר הקצאה מרשות המסים.
 *  השדה allocationNumber מאוחסן כאשר מתקבל מה-API של רשות המסים.
 *
 * עיקרון אי-שינוי (immutability):
 *  חשבונית שהונפקה (status = 'issued') היא נעולה לצמיתות.
 *  תיקונים מבוצעים אך ורק דרך הנפקת הודעת זיכוי + חשבונית חדשה.
 */

import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// ─── סוגי מסמכים ──────────────────────────────────────────────────────────
export const INVOICE_TYPES = [
  'tax_invoice',          // חשבונית מס
  'tax_invoice_receipt',  // חשבונית מס קבלה
  'receipt',              // קבלה
  'proforma',             // חשבון עסקה
  'credit_note',          // הודעת זיכוי
  'debit_note',           // הודעת חיוב
];

export const INVOICE_TYPE_LABELS = {
  tax_invoice:           'חשבונית מס',
  tax_invoice_receipt:   'חשבונית מס קבלה',
  receipt:               'קבלה',
  proforma:              'חשבון עסקה',
  credit_note:           'הודעת זיכוי',
  debit_note:            'הודעת חיוב',
};

// ─── סטטוסים ──────────────────────────────────────────────────────────────
export const INVOICE_STATUSES = [
  'draft',    // טיוטה — ניתן לעריכה
  'issued',   // הונפקה — נעולה
  'cancelled',// בוטלה (רק דרך הודעת זיכוי)
  'pending_allocation', // ממתינה למספר הקצאה מרשות המסים
];

// ─── אמצעי תשלום ──────────────────────────────────────────────────────────
export const PAYMENT_MEANS = [
  'cash',           // מזומן
  'credit_card',    // כרטיס אשראי
  'bank_transfer',  // העברה בנקאית
  'check',          // המחאה
  'voucher',        // שובר
  'other',          // אחר
];

// ─── שורת פריט בחשבונית ───────────────────────────────────────────────────
const InvoiceLineSchema = new Schema({
  description:  { type: String, required: true },   // תיאור השירות / המוצר
  quantity:     { type: Number, default: 1, min: 0 },
  unitPrice:    { type: Number, required: true },    // מחיר ליחידה (נטו)
  discountPct:  { type: Number, default: 0, min: 0, max: 100 },
  netAmount:    { type: Number, required: true },    // סכום נטו (לאחר הנחה)
  vatRate:      { type: Number, required: true },    // שיעור מע"מ (%)
  vatAmount:    { type: Number, required: true },    // סכום מע"מ
  grossAmount:  { type: Number, required: true },    // סכום כולל מע"מ
  serviceDate:  { type: String },                    // תאריך ביצוע השירות YYYY-MM-DD
  department:   { type: String },                    // rooms / f&b / parking וכו'
  folioLineId:  { type: Schema.Types.ObjectId },     // קישור לשורת folio המקורית
}, { _id: true });

// ─── פרטי צד לחשבונית (מוכר / קונה) ────────────────────────────────────
const PartySchema = new Schema({
  name:         { type: String, required: true },
  legalName:    { type: String },
  vatNumber:    { type: String },                    // מספר עוסק מורשה / ח.פ
  idNumber:     { type: String },                    // ת.ז (ליחידים)
  address:      { type: String },
  city:         { type: String },
  country:      { type: String, default: 'IL' },
  phone:        { type: String },
  email:        { type: String },
}, { _id: false });

// ─── סכום תשלום שמפורט בחשבונית (לחשבונית מס קבלה / קבלה) ──────────────
const PaymentDetailSchema = new Schema({
  method:       { type: String, enum: PAYMENT_MEANS, required: true },
  amount:       { type: Number, required: true },
  reference:    { type: String },                    // מספר אסמכתא (קבלה/שיק/העברה)
  paidAt:       { type: Date },
}, { _id: true });

// ─── מודל חשבונית ─────────────────────────────────────────────────────────
const InvoiceSchema = new Schema({
  // ── שייכות לנכס ──────────────────────────────────────────────────────
  property:       { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  folio:          { type: Schema.Types.ObjectId, ref: 'Folio' },
  reservation:    { type: Schema.Types.ObjectId, ref: 'Reservation' },

  // ── סוג ומספור ───────────────────────────────────────────────────────
  type:           { type: String, enum: INVOICE_TYPES, required: true },
  invoiceNumber:  { type: String, unique: true, sparse: true }, // INV-1001 (מוקצה בהנפקה)
  status:         { type: String, enum: INVOICE_STATUSES, default: 'draft' },

  // ── תאריכים ──────────────────────────────────────────────────────────
  issueDate:      { type: String },          // תאריך הוצאת החשבונית YYYY-MM-DD
  taxDate:        { type: String },          // תאריך מס (ייתכן שונה מתאריך ההנפקה)
  serviceDate:    { type: String },          // תאריך ביצוע העסקה

  // ── צדדים ────────────────────────────────────────────────────────────
  seller:         { type: PartySchema, required: true },
  buyer:          { type: PartySchema },     // לא חובה לעסקאות B2C (קופה רושמת)

  // ── פריטים ───────────────────────────────────────────────────────────
  lines:          { type: [InvoiceLineSchema], default: [] },

  // ── סיכומים פיננסיים ─────────────────────────────────────────────────
  currency:       { type: String, default: 'ILS' },
  totalNet:       { type: Number, required: true, default: 0 },   // סה"כ נטו
  totalVat:       { type: Number, required: true, default: 0 },   // סה"כ מע"מ
  totalGross:     { type: Number, required: true, default: 0 },   // סה"כ כולל מע"מ
  totalDiscount:  { type: Number, default: 0 },                   // סה"כ הנחה

  // ── מע"מ ─────────────────────────────────────────────────────────────
  vatRate:        { type: Number, required: true, default: 18 },  // שיעור מע"מ (%)

  // ── תשלום (לחשבונית מס קבלה / קבלה) ──────────────────────────────
  payments:       { type: [PaymentDetailSchema], default: [] },
  amountPaid:     { type: Number, default: 0 },
  balance:        { type: Number, default: 0 },                   // יתרה לתשלום

  // ── מספר הקצאה (חוק 2024 — B2B מעל 25,000 ₪) ────────────────────
  allocationNumber:     { type: String },   // מספר הקצאה מרשות המסים
  allocationRequestedAt:{ type: Date },
  allocationReceivedAt: { type: Date },
  requiresAllocation:   { type: Boolean, default: false },

  // ── קישורי מסמכים קשורים ─────────────────────────────────────────
  relatedInvoiceId:     { type: Schema.Types.ObjectId, ref: 'Invoice' }, // הודעת זיכוי ← חשבונית מקורית
  creditedBy:           [{ type: Schema.Types.ObjectId, ref: 'Invoice' }], // חשבונית ← הודעות זיכוי

  // ── נתוני הנפקה ─────────────────────────────────────────────────
  issuedBy:             { type: Schema.Types.ObjectId, ref: 'User' },
  issuedAt:             { type: Date },

  // ── הערות חופשיות ────────────────────────────────────────────────
  notes:                { type: String, maxlength: 500 },

}, { timestamps: true, toJSON: { virtuals: true } });

// ── אינדקסים ────────────────────────────────────────────────────────────────
InvoiceSchema.index({ property: 1, issueDate: -1 });
InvoiceSchema.index({ property: 1, type: 1, status: 1 });
InvoiceSchema.index({ folio: 1 });
InvoiceSchema.index({ reservation: 1 });

// ── נעילת שינוי לחשבוניות שהונפקו ─────────────────────────────────────────
InvoiceSchema.pre('save', function () {
  if (!this.isNew && this.isModified() && this.status === 'issued') {
    const allowedFields = ['creditedBy', 'allocationNumber', 'allocationReceivedAt', 'status'];
    const modifiedPaths = this.modifiedPaths();
    const illegalChange = modifiedPaths.find(p => !allowedFields.includes(p));
    if (illegalChange) {
      const err = new Error(`חשבונית שהונפקה אינה ניתנת לשינוי (שדה: ${illegalChange}). הנפק הודעת זיכוי.`);
      err.status = 422;
      throw err;
    }
  }
});

export default model('Invoice', InvoiceSchema);
