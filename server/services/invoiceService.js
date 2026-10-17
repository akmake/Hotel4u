/**
 * invoiceService.js
 * שירות הפקת חשבוניות — לפי חוק מע"מ ישראלי
 *
 * אחריות:
 *  1. חשבונית ידנית (ללא חשבון אורח) — מחשבון אורח: documentService
 *  2. הקצאת מספר חשבונית סידורי ואטומי
 *  3. חישוב נטו / מע"מ / ברוטו
 *  4. בדיקת תנאי מספר הקצאה (documentService.allocationRule — סף לפי תאריך, לפני מע״מ)
 *  5. הנפקת הודעת זיכוי
 */

import { runFiscalTransaction } from './fiscalTransaction.js';
import Invoice from '../models/Invoice.js';
import Property from '../models/Property.js';
import { nextDocumentNumber, allocationRule, validVatNumber } from './documentService.js';
import { calculateLine, sumMoney, minor, amount, legacyNumber, ROUNDING_POLICY } from '../domain/money.js';
import { creditLines } from '../domain/credit.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { emitAccountingEvent, fiscalAudit } from './accountingService.js';
import { payloadHash } from '../domain/accounting.js';

function identity(kind, key, payload) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(key || ''))) throw Object.assign(new Error('נדרש מזהה פעולה להנפקה'), { status: 422 });
  return { requestKey: `${kind}:${key}`, requestPayloadHash: payloadHash(payload) };
}
function checkDuplicate(existing, hash) {
  if (existing.requestPayloadHash !== hash) throw Object.assign(new Error('מזהה הפעולה כבר שימש לתוכן אחר'), { status: 409 });
  return existing;
}

// ─── עזרים ────────────────────────────────────────────────────────────────

const todayYmd = (property) => todayYmdInTimezone(property.timezone || 'Asia/Jerusalem');


function withOptionalSession(query, session) {
  return session ? query.session(session) : query;
}

async function saveWithOptionalSession(doc, session) {
  if (session) return doc.save({ session });
  return doc.save();
}


// מספור: סדרה רצה לכל סוג מסמך בנכס (documentService.nextDocumentNumber).
async function allocateInvoiceNumber(propertyId, session, type = 'tax_invoice') {
  return nextDocumentNumber(propertyId, type, session);
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
  const result = calculateLine({ unitPrice, quantity, discountPct, vatRate, pricesIncludeVat });
  return {
    netAmount: legacyNumber(result.net), vatAmount: legacyNumber(result.tax), grossAmount: legacyNumber(result.gross), discountAmount: legacyNumber(result.discount),
  };
}

/**
 * חשב סיכומים כלליים מרשימת שורות חשבונית.
 */
function calcTotals(lines) {
  const total = (key) => legacyNumber(sumMoney(lines.map((l) => l[key] || 0)));
  return { totalNet: total('netAmount'), totalVat: total('vatAmount'), totalGross: total('grossAmount'), totalDiscount: total('discountAmount') };
}

// ─── API ציבורי ─────────────────────────────────────────────────────────────

// הנפקה מחשבון אורח עברה ל-documentService.issueDocument (FIN-06): בונה מהחשבון, בלי כפל.

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
  idempotencyKey,
  pricesIncludeVat = false,
}) {
  const operation = identity('manual', idempotencyKey, { type, buyer, rawLines, payments, notes, pricesIncludeVat });
  return runFiscalTransaction(async (session) => {
    const property = await withOptionalSession(Property.findById(propertyId), session);
    if (!property) throw Object.assign(new Error('נכס לא נמצא'), { status: 404 });
    const existing = await Invoice.findOne({ property: propertyId, requestKey: operation.requestKey }).session(session);
    if (existing) return checkDuplicate(existing, operation.requestPayloadHash);

    if (property.vatRate == null) throw Object.assign(new Error('יש להגדיר מדיניות מע״מ לנכס'), { status: 422 });
    const vatRate = property.vatRate;

    const lines = rawLines.map(l => {
      const { netAmount, vatAmount, grossAmount, discountAmount } = calcLineAmounts(
        l.unitPrice, l.quantity ?? 1, l.discountPct ?? 0, vatRate, pricesIncludeVat,
      );
      return {
        description: l.description,
        quantity:    l.quantity ?? 1,
        unitPrice:   l.unitPrice,
        discountPct: l.discountPct || 0,
        netAmount,
        vatRate,
        vatAmount,
        grossAmount,
        discountAmount,
        serviceDate: l.serviceDate || todayYmd(property),
        department:  l.department || '',
      };
    });

    if (!lines.length) throw Object.assign(new Error('חובה לספק לפחות פריט אחד'), { status: 400 });

    const totals      = calcTotals(lines);
    const today       = todayYmd(property);
    const { seq, number: invoiceNumber } = await allocateInvoiceNumber(propertyId, session, type);
    const amountPaid  = legacyNumber(sumMoney(payments.map((p) => p.amount || 0)));
    const balance     = legacyNumber(amount(minor(totals.totalGross) - minor(amountPaid)));
    const alloc = allocationRule({ type, buyer: buyer ? { kind: validVatNumber(buyer.vatNumber) ? 'business' : 'private', vatNumber: buyer.vatNumber } : null, totalNet: totals.totalNet, totalVat: totals.totalVat, issueDate: today });
    const requiresAllocation = alloc.required;

    const invoice = new Invoice({
      property: propertyId,
      ...operation,
      moneyPolicy: ROUNDING_POLICY,
      type,
      invoiceNumber,
      seq,
      status:   'issued',
      allocationStatus: requiresAllocation ? 'pending' : 'not_required',
      allocationReason: alloc.reason,
      allocationThreshold: alloc.threshold ?? undefined,
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
    await emitAccountingEvent({ propertyId, eventKey: `document:${invoice._id}`, type: 'document.issued', sourceId: invoice._id, payload: { documentId: String(invoice._id), gross: String(invoice.totalGross) }, topics: ['document.archive'] }, session);
    await fiscalAudit({ propertyId, actor: { id: issuedBy }, action: 'invoice.manual_issued', entityId: invoice._id, after: { number: invoice.invoiceNumber } }, session);
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
export async function issueCreditNote({ originalInvoiceId, creditAmount, selections, reason, issuedBy, idempotencyKey }) {
  const operation = identity('credit', idempotencyKey, { originalInvoiceId: String(originalInvoiceId), creditAmount, selections, reason });
  return runFiscalTransaction(async (session) => {
    const original = await withOptionalSession(Invoice.findById(originalInvoiceId), session);
    if (!original) throw Object.assign(new Error('חשבונית מקורית לא נמצאה'), { status: 404 });
    const existing = await Invoice.findOne({ property: original.property, requestKey: operation.requestKey }).session(session);
    if (existing) return checkDuplicate(existing, operation.requestPayloadHash);
    if (original.status !== 'issued') {
      throw Object.assign(new Error('ניתן להנפיק הודעת זיכוי רק לחשבונית שהונפקה'), { status: 400 });
    }
    if (!['tax_invoice', 'tax_invoice_receipt', 'debit_note'].includes(original.type)) throw Object.assign(new Error('זיכוי מחייב חשבונית מקור'), { status: 422 });

    const property = await withOptionalSession(Property.findById(original.property), session);
    if (!property) throw Object.assign(new Error('נכס לא נמצא'), { status: 404 });

    // FIN-07: a reason is required, and credits are capped by what was not credited yet
    // (cumulative — two partial credits can never exceed the original).
    const why = String(reason || '').trim();
    if (why.length < 3) throw Object.assign(new Error('מסמך זיכוי מחייב סיבה'), { status: 422 });
    const prior = await withOptionalSession(Invoice.find({ relatedInvoiceId: original._id, type: 'credit_note', status: { $ne: 'cancelled' } }).select('lines'), session);
    const vatRate = original.vatRate;
    const lines = creditLines(original, prior, { creditAmount, selections });
    const today           = todayYmd(property);
    const { seq, number: invoiceNumber } = await allocateInvoiceNumber(String(original.property), session, 'credit_note');
    const { totalNet, totalVat, totalGross } = calcTotals(lines);

    const creditNote = new Invoice({
      property:         original.property,
      ...operation,
      moneyPolicy: ROUNDING_POLICY,
      folio:            original.folio,
      reservation:      original.reservation,
      type:             'credit_note',
      invoiceNumber,
      seq,
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
    await emitAccountingEvent({ propertyId: original.property, eventKey: `document:${creditNote._id}`, type: 'document.credited', sourceId: creditNote._id, payload: { originalId: String(original._id), documentId: String(creditNote._id), gross: String(totalGross) }, topics: ['document.archive'] }, session);
    await fiscalAudit({ propertyId: original.property, actor: { id: issuedBy }, action: 'invoice.credit_issued', entityId: creditNote._id, reason: why, after: { originalId: String(original._id), number: creditNote.invoiceNumber } }, session);

    // The original stays as issued (a final document is never changed); only the link is added.
    await Invoice.findByIdAndUpdate(
      originalInvoiceId,
      { $push: { creditedBy: creditNote._id } },
      session ? { session } : {},
    );

    return creditNote;
  });
}

// עדכון מספר הקצאה: documentService.setAllocation (9 ספרות, תפקידים, יומן ביקורת).
