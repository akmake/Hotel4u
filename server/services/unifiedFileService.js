// FIN-11 — "קבצים במבנה אחיד" (Tax Authority open format, instructions version 1.31).
//
// Output (as the instructions require):
//   OPENFRMT/<VAT number without check digit>.<YY>/<MMDDhhmm>/INI.TXT
//   OPENFRMT/<VAT number without check digit>.<YY>/<MMDDhhmm>/BKMVDATA.zip   (BKMVDATA.TXT inside)
// Fixed-length records, CR+LF after each, Hebrew in ISO-8859-8 (logical), numeric fields zero-filled,
// alphanumeric fields space-filled, amounts as sign + digits with implied decimals.
// Records produced: A000 + one summary record per record type (INI.TXT); A100, C100 (document
// header), D110 (document lines), D120 (receipt lines), Z900 (BKMVDATA.TXT). The PMS issues documents
// and has no general ledger or inventory, so B100/B110/M100 are not produced (A000 field 1013 = 0).
// The verification printouts of §2.6 (count and total per document type) and §5.4 (records per
// type, path, range) are returned with the file.
import crypto from 'crypto';
import iconv from 'iconv-lite';
import Invoice from '../models/Invoice.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';
import { zip } from '../utils/zipWriter.js';

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const OPEN_FORMAT_CODES = { proforma: 300, tax_invoice: 305, tax_invoice_receipt: 320, credit_note: 330, receipt: 400 };
export const OPEN_FORMAT_LABELS = {
  100: 'הזמנה', 200: 'תעודת משלוח', 210: 'תעודת החזרה', 300: 'חשבונית / חשבונית עסקה', 305: 'חשבונית מס', 310: 'חשבונית ריכוז',
  320: 'חשבונית מס / קבלה', 330: 'חשבונית מס זיכוי', 340: 'חשבונית שריון', 345: 'חשבונית סוכן', 400: 'קבלה', 405: 'קבלה על תרומות',
};
// D120 field 1306 — payment means
const PAY_CODES = { cash: 1, cheque: 2, check: 2, credit_card: 3, bank_transfer: 4, voucher: 9, other: 9 };
// D120 field 1313 — clearing company (only when known from the card brand)
const CARD_CO = { isracard: 1, diners: 3, amex: 4 };
const CARD_NAMES = { visa: 'VISA', mastercard: 'MASTERCARD', isracard: 'ISRACARD', amex: 'AMEX', diners: 'DINERS', other: '' };

// ── field formatting ────────────────────────────────────────────────────────
const X = (v, n) => { const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, n); return s + ' '.repeat(n - s.length); };
const N = (v, n) => { const s = digits(v).slice(-n); return '0'.repeat(n - s.length) + s; };
// X9(i)v(d): sign + i+d digits, implied decimal point
const AMT = (v, i, d = 2) => {
  const n = Math.round(Math.abs(Number(v || 0)) * 10 ** d);
  const s = String(n).slice(-(i + d));
  return (Number(v || 0) < 0 && n > 0 ? '-' : '+') + '0'.repeat(i + d - s.length) + s;
};
const RATE = (v) => N(Math.round(Number(v || 0) * 100), 4); // 9(2)v99
const D8 = (ymd) => (YMD.test(String(ymd || '')) ? String(ymd).replace(/-/g, '') : '00000000');

function localParts(date, tz = 'Asia/Jerusalem') {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const g = (t) => f.find((x) => x.type === t)?.value || '00';
  return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour') === '24' ? '00' : g('hour'), mm: g('minute') };
}

function splitAddress(address) {
  const a = String(address || '').trim();
  const m = a.match(/^(.*?)[\s,]+(\d+[א-תA-Za-z]?)$/);
  return m ? { street: m[1], house: m[2] } : { street: a, house: '' };
}

function assertLen(rec, len, code) {
  if (rec.length !== len) throw new Error(`open format: record ${code} has length ${rec.length}, expected ${len}`);
  return rec;
}

// ── build ───────────────────────────────────────────────────────────────────
export async function buildUnifiedFile({ propertyId, from, to, actor, ip, now = new Date() }) {
  if (!YMD.test(from || '') || !YMD.test(to || '')) throw httpError('יש לבחור טווח תאריכים', 422, { fields: { from: 'מתאריך', to: 'עד תאריך' } });
  if (from > to) throw httpError('תאריך ההתחלה אחרי תאריך הסיום', 422);
  const property = await Property.findById(propertyId).lean();
  if (!property) throw httpError('הנכס לא נמצא', 404);
  const vat = digits(property.taxNumber);
  if (vat.length !== 9) throw httpError('חסר מספר עוסק (9 ספרות) בהגדרות הנכס — אי אפשר להפיק קובץ במבנה אחיד', 422, { code: 'seller_incomplete' });
  const tz = property.timezone || 'Asia/Jerusalem';
  const docs = await Invoice.find({ property: propertyId, issueDate: { $gte: from, $lte: to }, status: { $ne: 'draft' }, type: { $in: Object.keys(OPEN_FORMAT_CODES) } })
    .sort({ issueDate: 1, type: 1, seq: 1, createdAt: 1 }).populate('issuedBy', 'email firstName').populate('relatedInvoiceId', 'type invoiceNumber').lean();

  const primaryId = String(crypto.randomInt(1, 9)) + Array.from({ length: 14 }, () => crypto.randomInt(0, 10)).join('');
  const t = localParts(now, tz);
  const folder = `OPENFRMT/${vat.slice(0, 8)}.${t.y.slice(2)}/${t.m}${t.d}${t.hh}${t.mm}`;
  const lines = [];
  let recNo = 0;
  const counts = { C100: 0, D110: 0, D120: 0 };
  const byType = new Map();

  lines.push(assertLen(['A100', N(++recNo, 9), N(vat, 9), N(primaryId, 15), '&OF1.31&', X('', 50)].join(''), 95, 'A100'));
  let link = 0;
  for (const d of docs) {
    const code = OPEN_FORMAT_CODES[d.type];
    const credit = d.type === 'credit_note';
    const sign = (v) => (credit ? Math.abs(Number(v || 0)) : Number(v || 0));
    link += 1;
    const issued = d.issuedAt ? localParts(new Date(d.issuedAt), tz) : null;
    const buyerVat = digits(d.buyer?.vatNumber);
    const addr = splitAddress(d.buyer?.address);
    const isReceipt = d.type === 'receipt';
    const customerKey = (buyerVat || digits(d.buyer?.idNumber) || String(d.reservation || d.folio || d._id).slice(-15)).slice(0, 15);
    const user = String(d.issuedBy?.email || d.issuedBy?.firstName || '').split('@')[0];
    const c100 = [
      'C100', N(++recNo, 9), N(vat, 9), N(code, 3), X(d.invoiceNumber, 20),
      D8(d.issueDate), issued ? `${issued.hh}${issued.mm}` : '0000',
      X(d.buyer?.name, 50), X(addr.street, 50), X(addr.house, 10), X(d.buyer?.city, 30), X('', 8), X('', 30), X(d.buyer?.country === 'IL' || !d.buyer?.country ? 'IL' : d.buyer.country, 2),
      X(d.buyer?.phone, 15), N(buyerVat, 9), D8(d.issueDate),
      X('', 15), X('', 3), // foreign currency — export invoices only
      AMT(isReceipt ? 0 : sign(d.totalNet) + Math.abs(d.totalDiscount || 0), 12), AMT(isReceipt ? 0 : -Math.abs(d.totalDiscount || 0), 12),
      AMT(isReceipt ? 0 : sign(d.totalNet), 12), AMT(isReceipt ? 0 : sign(d.totalVat), 12), AMT(isReceipt ? d.amountPaid : sign(d.totalGross), 12),
      AMT(0, 9), X(customerKey, 15), X('', 10),
      ' ', // 1228 cancelled document (documents are never cancelled — corrected by credit notes)
      D8(d.issueDate), X('', 7), X(user, 9), N(link, 7), X('', 13),
    ].join('');
    lines.push(assertLen(c100, 444, 'C100'));
    counts.C100 += 1;
    const tb = byType.get(code) || { count: 0, total: 0 };
    tb.count += 1;
    tb.total = Math.round((tb.total + (isReceipt ? Number(d.amountPaid || 0) : sign(d.totalGross))) * 100) / 100;
    byType.set(code, tb);

    if (!isReceipt) {
      const baseType = credit && d.relatedInvoiceId ? OPEN_FORMAT_CODES[d.relatedInvoiceId.type] || 0 : 0;
      const baseNo = credit && d.relatedInvoiceId ? d.relatedInvoiceId.invoiceNumber : '';
      (d.lines || []).forEach((l, i) => {
        const qty = Math.abs(Number(l.quantity || 1)) || 1;
        const net = sign(l.netAmount);
        const rec = [
          'D110', N(++recNo, 9), N(vat, 9), N(code, 3), X(d.invoiceNumber, 20), N(i + 1, 4),
          N(baseType, 3), X(baseNo, 20), '1', X(l.department, 20), X(l.description, 30), X('', 50), X('', 30), X('יחידה', 20),
          AMT(qty, 12, 4), AMT(net / qty, 12), AMT(0, 12), AMT(net, 12), RATE(l.vatRate),
          X('', 7), D8(d.issueDate), N(link, 7), X('', 7), X('', 21),
        ].join('');
        lines.push(assertLen(rec, 339, 'D110'));
        counts.D110 += 1;
      });
    }
    if (['receipt', 'tax_invoice_receipt'].includes(d.type)) {
      (d.payments || []).forEach((p, i) => {
        const pc = PAY_CODES[p.method] || 9;
        const cheque = pc === 2;
        const card = pc === 3;
        const rec = [
          'D120', N(++recNo, 9), N(vat, 9), N(code, 3), X(d.invoiceNumber, 20), N(i + 1, 4), String(pc),
          N(cheque ? p.bank : 0, 10), N(cheque ? p.branch : 0, 10), N(cheque ? p.account : 0, 15), N(cheque ? p.reference : 0, 10),
          cheque ? D8(p.dueDate) : card ? D8(p.paymentDate || d.issueDate) : '00000000',
          AMT(p.amount, 12),
          String(card ? CARD_CO[p.cardBrand] || 0 : 0), X(card ? CARD_NAMES[p.cardBrand] || '' : '', 20),
          String(card ? (p.isRefund || p.amount < 0 ? 3 : (p.installments > 1 ? 2 : 1)) : 0),
          X('', 7), D8(d.issueDate), N(link, 7), X('', 60),
        ].join('');
        lines.push(assertLen(rec, 222, 'D120'));
        counts.D120 += 1;
      });
    }
  }
  const total = recNo + 1; // + Z900
  lines.push(assertLen(['Z900', N(total, 9), N(vat, 9), N(primaryId, 15), '&OF1.31&', N(total, 15), X('', 50)].join(''), 110, 'Z900'));

  const addrP = splitAddress(property.address);
  const company = /^5\d{8}$/.test(vat) ? vat : '';
  const pkgVersion = process.env.SOFTWARE_VERSION || '1.0';
  const a000 = [
    'A000', X('', 5), N(total, 15), N(vat, 9), N(primaryId, 15), '&OF1.31&',
    N(property.fiscal?.softwareRegNumber, 8), X(process.env.SOFTWARE_NAME || 'Hotel4U', 20), X(pkgVersion, 20),
    N(process.env.SOFTWARE_VENDOR_ID, 9), X(process.env.SOFTWARE_VENDOR_NAME || 'Hotel4U', 20),
    '2', X(folder.replace(/\//g, '\\'), 50), '0', '0', N(company, 9), N(0, 9), X('', 10),
    X(property.legalName || property.name, 50), X(addrP.street, 50), X(addrP.house, 10), X(property.city, 30), X(property.postalCode, 8),
    N(0, 4), D8(from), D8(to), `${t.y}${t.m}${t.d}`, `${t.hh}${t.mm}`, '0', '1', X('Hotel4U zip', 20), X('ILS', 3), '0', X('', 46),
  ].join('');
  const ini = [assertLen(a000, 466, 'A000')];
  for (const k of ['C100', 'D110', 'D120']) if (counts[k]) ini.push(assertLen(`${k}${N(counts[k], 15)}`, 19, k));

  const enc = (rows) => iconv.encode(`${rows.join('\r\n')}\r\n`, 'iso88598');
  const bkmv = enc(lines);
  const iniBuf = enc(ini);
  const inner = zip([{ name: 'BKMVDATA.TXT', data: bkmv }], now);
  const bundle = zip([{ name: `${folder}/INI.TXT`, data: iniBuf }, { name: `${folder}/BKMVDATA.zip`, data: inner }], now);

  const docTypes = Object.entries(OPEN_FORMAT_LABELS).map(([c, label]) => ({ code: Number(c), label, count: byType.get(Number(c))?.count || 0, total: byType.get(Number(c))?.total || 0 }));
  const summary = {
    vatNumber: vat, businessName: property.legalName || property.name, folder: folder.replace(/\//g, '\\'), from, to,
    producedAt: now.toISOString(), primaryId, softwareRegNumber: property.fiscal?.softwareRegNumber || null,
    records: [{ code: 'A100', label: 'רשומת פתיחה', count: 1 }, { code: 'C100', label: 'כותרת מסמך', count: counts.C100 }, { code: 'D110', label: 'פרטי מסמך', count: counts.D110 }, { code: 'D120', label: 'פרטי קבלות', count: counts.D120 }, { code: 'Z900', label: 'רשומת סיום', count: 1 }],
    totalRecords: total,
    documents: docTypes,
    warnings: [
      !property.fiscal?.softwareRegNumber && 'מספר רישום התוכנה ברשות המסים לא הוזן (שדה 1006 = אפסים) — התוכנה טרם נרשמה',
      !process.env.SOFTWARE_VENDOR_ID && 'מספר עוסק של יצרן התוכנה לא הוגדר בשרת (שדה 1009)',
    ].filter(Boolean),
  };
  await audit({ property: propertyId, actor: actor?.id, actorName: actor?.name, action: 'fiscal.open_format_export', entityType: 'Property', entityId: propertyId, after: { from, to, documents: counts.C100, records: total, primaryId }, ip });
  return { bundle, ini: iniBuf, bkmv, summary, fileName: `OPENFRMT_${vat}_${from.replace(/-/g, '')}-${to.replace(/-/g, '')}.zip` };
}
