/**
 * invoiceService.js
 * שירות הפקת חשבוניות — לפי חוק מע"מ ישראלי
 *
 * אחריות:
 *  1. יצירת חשבוניות מ-Folio קיים
 *  2. הקצאת מספר חשבונית סידורי ואטומי
 *  3. חישוב נטו / מע"מ / ברוטו
 *  4. בדיקת תנאי מספר הקצאה (B2B מעל 25,000 ₪)
 *  5. הנפקת הודעת זיכוי
 */

import mongoose from 'mongoose';
import Invoice, { INVOICE_TYPE_LABELS } from '../models/Invoice.js';
import Folio from '../models/Folio.js';
import Property from '../models/Property.js';

// סף לחובת מספר הקצאה מרשות המסים (ב-₪)
const ALLOCATION_THRESHOLD_ILS = 25000;
const TXN_UNSUPPORTED_CODE = 20;
const TXN_UNSUPPORTED_MSG = 'Transaction numbers are only allowed on a replica set member or mongos';

// ─── עזרים ────────────────────────────────────────────────────────────────

function todayYmd() {
  return new Date().toISOString().split('T')[0];
}

function isTransactionUnsupportedError(err) {
  return err?.code === TXN_UNSUPPORTED_CODE || String(err?.message || '').includes(TXN_UNSUPPORTED_MSG);
}

function withOptionalSession(query, session) {
  return session ? query.session(session) : query;
}

async function saveWithOptionalSession(doc, session) {
  if (session) return doc.save({ session });
  return doc.save();
}

async function runWithOptionalTransaction(work) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    try { await session.abortTransaction(); } catch (_) {}
    if (isTransactionUnsupportedError(err)) {
      return work(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * מקצה מספר חשבונית סידורי ואטומי — עדכון מונה על גבי Property בפעולה אטומית.
 * @returns {Promise<string>} מספר חשבונית מעוצב (למשל "INV-1001")
 */
async function allocateInvoiceNumber(propertyId, session) {
  const updateOptions = session
    ? { returnDocument: 'after', session }
    : { returnDocument: 'after' };
  const property = await Property.findByIdAndUpdate(
    propertyId,
    { $inc: { invoiceSequence: 1 } },
    updateOptions,
  ).select('invoicePrefix invoiceSequence');

  if (!property) throw Object.assign(new Error('נכס לא נמצא'), { status: 404 });

  const prefix = property.invoicePrefix || 'INV';
  const seq = property.invoiceSequence;
  return `${prefix}-${String(seq).padStart(6, '0')}`;
}

/**
 * בנה פרטי מוכר מתוך מסמך Property.
 */
function buildSellerParty(property) {
  return {
    name:      property.legalName || property.name,
    legalName: property.legalName,
    vatNumber: property.taxNumber || '',
    address:   [property.address, property.city].filter(Boolean).join(', '),
    city:      property.city || '',
    country:   property.country || 'IL',
    phone:     property.phone || '',
    email:     property.email || '',
  };
}

/**
 * חשב נטו / מע"מ / ברוטו לשורה, לפי שיעור מע"מ ומחיר ברוטו.
 * עסקאות מלונאות: המחיר בד"כ כולל מע"מ — מפרקים לאחור.
 */
function calcLineAmounts(unitPrice, quantity, discountPct, vatRate, pricesIncludeVat = true) {
  const qty = quantity || 1;
  const disc = discountPct || 0;
  const rawTotal = unitPrice * qty;
  const discountAmount = rawTotal * (disc / 100);
  const afterDiscount = rawTotal - discountAmount;

  let netAmount, vatAmount, grossAmount;
  if (pricesIncludeVat) {
    grossAmount = afterDiscount;
    netAmount   = grossAmount / (1 + vatRate / 100);
    vatAmount   = grossAmount - netAmount;
  } else {
    netAmount   = afterDiscount;
    vatAmount   = netAmount * (vatRate / 100);
    grossAmount = netAmount + vatAmount;
  }

  return {
    netAmount:   Math.round(netAmount   * 100) / 100,
    vatAmount:   Math.round(vatAmount   * 100) / 100,
    grossAmount: Math.round(grossAmount * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
  };
}

/**
 * בנה שורות חשבונית משורות Folio.
 */
function buildLinesFromFolio(folioLines, vatRate, pricesIncludeVat) {
  const chargeLines = folioLines.filter(l => l.status === 'posted' && l.amount > 0);

  return chargeLines.map(line => {
    const { netAmount, vatAmount, grossAmount } = calcLineAmounts(
      line.amount + (line.taxAmount || 0), // מחיר ברוטו (כפי שנשמר בfolio)
      1,
      0,
      vatRate,
      true, // folio תמיד שומר ברוטו
    );

    return {
      description: line.description,
      quantity:    1,
      unitPrice:   netAmount,
      discountPct: 0,
      netAmount,
      vatRate,
      vatAmount,
      grossAmount,
      serviceDate: line.serviceDate,
      department:  line.department || '',
      folioLineId: line._id,
    };
  });
}

/**
 * חשב סיכומים כלליים מרשימת שורות חשבונית.
 */
function calcTotals(lines) {
  return lines.reduce(
    (acc, l) => ({
      totalNet:      acc.totalNet      + l.netAmount,
      totalVat:      acc.totalVat      + l.vatAmount,
      totalGross:    acc.totalGross    + l.grossAmount,
      totalDiscount: acc.totalDiscount + (l.discountPct > 0 ? l.unitPrice * l.quantity * (l.discountPct / 100) : 0),
    }),
    { totalNet: 0, totalVat: 0, totalGross: 0, totalDiscount: 0 },
  );
}

// ─── API ציבורי ─────────────────────────────────────────────────────────────

/**
 * הנפק חשבונית מ-Folio קיים.
 *
 * @param {object} params
 * @param {string} params.folioId      - מזהה ה-Folio
 * @param {string} params.type         - סוג החשבונית (INVOICE_TYPES)
 * @param {object} [params.buyer]      - פרטי הקונה (אם לא מסופק — B2C)
 * @param {string} [params.notes]      - הערות
 * @param {Array}  [params.payments]   - תשלומים (לחשבונית מס קבלה)
 * @param {string} params.issuedBy     - מזהה המשתמש המנפיק
 * @param {string} params.propertyId   - מזהה הנכס
 */
export async function issueInvoiceFromFolio({
  folioId,
  type,
  buyer,
  notes,
  payments = [],
  issuedBy,
  propertyId,
}) {
  return runWithOptionalTransaction(async (session) => {
    const [folio, property] = await Promise.all([
      withOptionalSession(Folio.findById(folioId), session),
      withOptionalSession(Property.findById(propertyId), session),
    ]);

    if (!folio) throw Object.assign(new Error('Folio לא נמצא'), { status: 404 });
    if (!property) throw Object.assign(new Error('נכס לא נמצא'), { status: 404 });

    const vatRate = property.vatRate || 18;
    const lines   = buildLinesFromFolio(folio.lines, vatRate, true);

    if (!lines.length) {
      throw Object.assign(new Error('אין חיובים פעילים ב-Folio להפקת חשבונית'), { status: 400 });
    }

    const totals   = calcTotals(lines);
    const today    = todayYmd();
    const invoiceNumber = await allocateInvoiceNumber(propertyId, session);

    // חישוב תשלומים
    const amountPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const balance    = Math.round((totals.totalGross - amountPaid) * 100) / 100;

    // בדיקת חובת מספר הקצאה
    const requiresAllocation = (
      type === 'tax_invoice' || type === 'tax_invoice_receipt'
    ) && !!buyer?.vatNumber && totals.totalGross >= ALLOCATION_THRESHOLD_ILS;

    const invoice = new Invoice({
      property:     propertyId,
      folio:        folioId,
      reservation:  folio.reservation,
      type,
      invoiceNumber,
      status:       requiresAllocation ? 'pending_allocation' : 'issued',
      issueDate:    today,
      taxDate:      today,
      serviceDate:  folio.lines[0]?.serviceDate || today,
      seller:       buildSellerParty(property),
      buyer:        buyer || null,
      lines,
      currency:     folio.currency || 'ILS',
      ...totals,
      vatRate,
      payments,
      amountPaid,
      balance,
      requiresAllocation,
      issuedBy,
      issuedAt: new Date(),
      notes: notes || '',
    });

    await saveWithOptionalSession(invoice, session);
    return invoice;
  });
}

/**
 * הנפק חשבונית ידנית (ללא Folio) — למקרים מיוחדים.
 */
export async function issueManualInvoice({
  propertyId,
  type,
  buyer,
  lines: rawLines,
  payments = [],
  notes,
  issuedBy,
  pricesIncludeVat = false,
}) {
  return runWithOptionalTransaction(async (session) => {
    const property = await withOptionalSession(Property.findById(propertyId), session);
    if (!property) throw Object.assign(new Error('נכס לא נמצא'), { status: 404 });

    const vatRate = property.vatRate || 18;

    const lines = rawLines.map(l => {
      const { netAmount, vatAmount, grossAmount, discountAmount } = calcLineAmounts(
        l.unitPrice, l.quantity || 1, l.discountPct || 0, vatRate, pricesIncludeVat,
      );
      return {
        description: l.description,
        quantity:    l.quantity || 1,
        unitPrice:   l.unitPrice,
        discountPct: l.discountPct || 0,
        netAmount,
        vatRate,
        vatAmount,
        grossAmount,
        serviceDate: l.serviceDate || todayYmd(),
        department:  l.department || '',
      };
    });

    if (!lines.length) throw Object.assign(new Error('חובה לספק לפחות פריט אחד'), { status: 400 });

    const totals      = calcTotals(lines);
    const today       = todayYmd();
    const invoiceNumber = await allocateInvoiceNumber(propertyId, session);
    const amountPaid  = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const balance     = Math.round((totals.totalGross - amountPaid) * 100) / 100;
    const requiresAllocation = (type === 'tax_invoice' || type === 'tax_invoice_receipt')
      && !!buyer?.vatNumber && totals.totalGross >= ALLOCATION_THRESHOLD_ILS;

    const invoice = new Invoice({
      property: propertyId,
      type,
      invoiceNumber,
      status:   requiresAllocation ? 'pending_allocation' : 'issued',
      issueDate: today,
      taxDate:   today,
      serviceDate: lines[0]?.serviceDate || today,
      seller:    buildSellerParty(property),
      buyer:     buyer || null,
      lines,
      currency:  property.defaultCurrency || 'ILS',
      ...totals,
      vatRate,
      payments,
      amountPaid,
      balance,
      requiresAllocation,
      issuedBy,
      issuedAt: new Date(),
      notes: notes || '',
    });

    await saveWithOptionalSession(invoice, session);
    return invoice;
  });
}

/**
 * הנפק הודעת זיכוי לחשבונית קיימת.
 *
 * @param {string} originalInvoiceId - מזהה החשבונית המקורית
 * @param {number} [creditAmount]    - סכום לזיכוי (אם חלקי); אם לא מסופק — זיכוי מלא
 * @param {string} reason            - סיבת הזיכוי
 * @param {string} issuedBy          - מזהה המשתמש
 */
export async function issueCreditNote({ originalInvoiceId, creditAmount, reason, issuedBy }) {
  return runWithOptionalTransaction(async (session) => {
    const original = await withOptionalSession(Invoice.findById(originalInvoiceId), session);
    if (!original) throw Object.assign(new Error('חשבונית מקורית לא נמצאה'), { status: 404 });
    if (original.status !== 'issued') {
      throw Object.assign(new Error('ניתן להנפיק הודעת זיכוי רק לחשבונית שהונפקה'), { status: 400 });
    }

    const property = await withOptionalSession(Property.findById(original.property), session);
    if (!property) throw Object.assign(new Error('נכס לא נמצא'), { status: 404 });

    // FIN-07: a reason is required, and credits are capped by what was not credited yet
    // (cumulative — two partial credits can never exceed the original).
    const why = String(reason || '').trim();
    if (why.length < 3) throw Object.assign(new Error('מסמך זיכוי מחייב סיבה'), { status: 422 });
    const prior = await withOptionalSession(Invoice.find({ relatedInvoiceId: original._id, type: 'credit_note', status: { $ne: 'cancelled' } }).select('totalGross'), session);
    const alreadyCredited = Math.round(prior.reduce((sum, c) => sum + Math.abs(c.totalGross || 0), 0) * 100) / 100;
    const remaining = Math.round((original.totalGross - alreadyCredited) * 100) / 100;
    if (remaining <= 0.005) throw Object.assign(new Error('החשבונית כבר זוכתה במלואה'), { status: 409 });
    const vatRate = original.vatRate;
    const isFullCredit = creditAmount === undefined || creditAmount === null;
    if (!isFullCredit && !(Number(creditAmount) > 0)) throw Object.assign(new Error('סכום הזיכוי חייב להיות חיובי'), { status: 422 });
    if (!isFullCredit && Number(creditAmount) - remaining > 0.005) throw Object.assign(new Error(`ניתן לזכות עד ${remaining.toFixed(2)}`), { status: 422 });
    const grossToCredit = isFullCredit ? remaining : Number(creditAmount);

    // שורות הודעת הזיכוי — ערכים שליליים
    const ratio = grossToCredit / original.totalGross;
    const lines = original.lines.map(l => ({
      description: l.description,
      quantity:    l.quantity,
      unitPrice:   -(l.unitPrice * ratio),
      discountPct: l.discountPct,
      netAmount:   Math.round(-l.netAmount  * ratio * 100) / 100,
      vatRate:     l.vatRate,
      vatAmount:   Math.round(-l.vatAmount  * ratio * 100) / 100,
      grossAmount: Math.round(-l.grossAmount * ratio * 100) / 100,
      serviceDate: l.serviceDate,
      department:  l.department,
    }));

    const today           = todayYmd();
    const invoiceNumber   = await allocateInvoiceNumber(String(original.property), session);
    const totalNet        = lines.reduce((s, l) => s + l.netAmount, 0);
    const totalVat        = lines.reduce((s, l) => s + l.vatAmount, 0);
    const totalGross      = lines.reduce((s, l) => s + l.grossAmount, 0);

    const creditNote = new Invoice({
      property:         original.property,
      folio:            original.folio,
      reservation:      original.reservation,
      type:             'credit_note',
      invoiceNumber,
      status:           'issued',
      issueDate:        today,
      taxDate:          today,
      serviceDate:      original.serviceDate,
      seller:           original.seller,
      buyer:            original.buyer,
      lines,
      currency:         original.currency,
      totalNet,
      totalVat,
      totalGross,
      totalDiscount:    0,
      vatRate,
      relatedInvoiceId: original._id,
      issuedBy,
      issuedAt:         new Date(),
      notes:            why,
    });

    await saveWithOptionalSession(creditNote, session);

    // The original stays as issued (a final document is never changed); only the link is added.
    await Invoice.findByIdAndUpdate(
      originalInvoiceId,
      { $push: { creditedBy: creditNote._id } },
      session ? { session } : {},
    );

    return creditNote;
  });
}

/**
 * עדכן מספר הקצאה על חשבונית ממתינה.
 */
export async function setAllocationNumber(invoiceId, allocationNumber) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw Object.assign(new Error('חשבונית לא נמצאה'), { status: 404 });
  if (invoice.status !== 'pending_allocation') {
    throw Object.assign(new Error('החשבונית אינה ממתינה למספר הקצאה'), { status: 400 });
  }

  invoice.allocationNumber      = allocationNumber;
  invoice.allocationReceivedAt  = new Date();
  invoice.status                = 'issued';
  await invoice.save();
  return invoice;
}
