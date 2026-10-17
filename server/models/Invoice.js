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
 * חשבוניות ישראל (מספר הקצאה):
 *  חשבונית מס לעוסק מורשה מעל הסף (לפני מע״מ) מחייבת מספר הקצאה בן 9 ספרות מרשות המסים.
 *  הסף לפי תאריך ההנפקה: 25,000 (2024) → 20,000 (2025) → 10,000 (1.1.2026) → 5,000 (1.6.2026).
 *  מספר ההקצאה אינו מחליף את מספר המסמך; "ממתין" אינו מספר. allocationStatus מחזיק את המצב.
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

// מסמכים שמכסים חיובים (שורת חיוב שעליהם מתוקנת רק במסמך זיכוי) ומסמכים שמכסים תקבולים.
// חשבון עסקה אינו מסמך מס ואינו "נועל" שורות.
export const CHARGE_DOC_TYPES = ['tax_invoice', 'tax_invoice_receipt', 'debit_note'];
export const PAYMENT_DOC_TYPES = ['receipt', 'tax_invoice_receipt'];

// מצב מספר הקצאה — נפרד מסטטוס המסמך (מסמך שהונפק נשאר סופי גם כשההקצאה ממתינה).
export const ALLOCATION_STATUSES = ['not_required', 'pending', 'approved', 'rejected'];

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
  'cheque',         // שיק
  'check',          // המחאה (ערך ישן)
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
  // פרטי האמצעי מועתקים מהתקבול בחשבון (FIN-03): שיק — בנק, סניף, חשבון, פירעון; העברה — תאריך
  // ומשלם; כרטיס — 4 ספרות אחרונות ותשלומים. לעולם לא מספר כרטיס מלא.
  paymentDate:  { type: String },                    // YYYY-MM-DD — מועד התקבול / ההעברה
  folioLineId:  { type: Schema.Types.ObjectId },     // שורת התקבול בחשבון
  last4:        { type: String },
  cardBrand:    { type: String },
  installments: { type: Number },
  bank:         { type: String },
  branch:       { type: String },
  account:      { type: String },
  dueDate:      { type: String },
  payerName:    { type: String },
  nettedLineIds: [{ type: Schema.Types.ObjectId }],  // refunds netted into this payment before it was receipted
  isRefund:     { type: Boolean },                   // a refund line on a receipt (negative amount)
}, { _id: true });

// ─── מודל חשבונית ─────────────────────────────────────────────────────────
const InvoiceSchema = new Schema({
  // ── שייכות לנכס ──────────────────────────────────────────────────────
  property:       { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  folio:          { type: Schema.Types.ObjectId, ref: 'Folio' },
  reservation:    { type: Schema.Types.ObjectId, ref: 'Reservation' },

  // ── סוג ומספור ───────────────────────────────────────────────────────
  type:           { type: String, enum: INVOICE_TYPES, required: true },
  invoiceNumber:  { type: String },          // מספר רץ בסדרה של סוג המסמך בנכס (מוקצה בהנפקה)
  seq:            { type: Number },          // המספר הרץ כמספר
  requestKey:     { type: String },          // מפתח פעולה — אותה בקשה לא מנפיקה שני מסמכים
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

  // ── מספר הקצאה (חשבוניות ישראל) ──────────────────────────────────
  allocationNumber:     { type: String },   // מספר הקצאה מרשות המסים (9 ספרות)
  allocationRequestedAt:{ type: Date },
  allocationReceivedAt: { type: Date },
  requiresAllocation:   { type: Boolean, default: false },
  allocationStatus:     { type: String, enum: ALLOCATION_STATUSES, default: 'not_required' },
  allocationReason:     { type: String },   // למה נדרש / לא נדרש (בסיס החישוב והסף)
  allocationThreshold:  { type: Number },   // הסף שחל בתאריך ההנפקה
  allocationRejectReason: { type: String },
  allocationBy:         { type: Schema.Types.ObjectId, ref: 'User' },
  allocationFullNumber: { type: String },   // the full confirmation number returned by the Tax Authority
  allocationSource:     { type: String, enum: ['manual', 'api'] },
  allocationAttempts:   { type: Number, default: 0 },
  allocationLastError:  { type: String },   // last technical / data error from the service (pending)
  allocationRetry:      { type: Boolean, default: true },   // false after a data error — a retry would fail the same way
  allocationNextTryAt:  { type: Date },
  // When the Tax Authority holds the invoice (code 460/461) the business picks one of the routes it
  // allows: cancel (credit note), continue without a number (printed "אין לנכות מס תשומות"),
  // hearing (request through the portal, then ask again with the same invoice_id).
  allocationDecision:   { type: String, enum: ['cancel', 'continue', 'hearing'] },
  allocationDecidedAt:  { type: Date },
  allocationDecisionSent: { type: Boolean },
  requestedByCustomer:  { type: Boolean, default: false },  // allocation asked by the customer below the threshold
  // Documents sent by e-mail (copies; the original is the record in the system).
  sentLog:              [{ to: String, at: Date, by: String, _id: false }],

  // ── הדפסה: הראשונה "מקור", הבאות "העתק נאמן למקור" ───────────────
  printCount:           { type: Number, default: 0 },

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
// מספר מסמך ייחודי בתוך סדרה (נכס + סוג) — לא גלובלית: לכל נכס סדרות משלו.
// (האינדקס הישן invoiceNumber_1 מוסר ב-scripts/migrateInvoiceNumberIndex.js)
InvoiceSchema.index({ property: 1, type: 1, invoiceNumber: 1 }, { unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string' } } });
InvoiceSchema.index({ property: 1, requestKey: 1 }, { unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } });
InvoiceSchema.index({ property: 1, allocationStatus: 1 });
InvoiceSchema.index({ property: 1, issueDate: -1 });
InvoiceSchema.index({ property: 1, type: 1, status: 1 });
InvoiceSchema.index({ folio: 1 });
InvoiceSchema.index({ reservation: 1 });

// ── נעילת שינוי לחשבוניות שהונפקו ─────────────────────────────────────────
InvoiceSchema.pre('save', function () {
  if (!this.isNew && this.isModified() && this.status === 'issued') {
    const allowedFields = ['creditedBy', 'allocationNumber', 'allocationReceivedAt', 'status', 'allocationStatus', 'allocationRejectReason', 'allocationBy', 'allocationRequestedAt', 'printCount',
      'allocationFullNumber', 'allocationSource', 'allocationAttempts', 'allocationLastError', 'allocationRetry', 'allocationNextTryAt', 'allocationDecision', 'allocationDecidedAt', 'allocationDecisionSent', 'sentLog'];
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
