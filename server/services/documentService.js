// Fiscal documents from a folio (spec FIN-06 issue, FIN-10 allocation centre, FIN-03-A06 receipt).
//
// Rules enforced here (server-side):
//  - a document is built from the folio — charges for an invoice, payments for a receipt — never typed
//    twice; a charge already on a live tax invoice and a payment already on a receipt are not
//    documented again (a fully credited invoice frees its charges for a corrected one);
//  - a tax invoice/receipt is issued only when the payments it lists equal the charges it lists;
//    otherwise the desk issues a tax invoice and a receipt separately;
//  - every type has its own running series per property; the number is final once issued and the
//    document is never edited (corrections are credit notes, FIN-07);
//  - "Israel invoices": a tax invoice to a VAT-registered business whose amount before VAT exceeds
//    the threshold in force on the issue date needs a 9-digit allocation number from the Tax
//    Authority. Until it is entered the document is marked pending — "pending" is not a number and
//    a refusal is not a licence to invent one;
//  - one operation key per request, so a retry never issues a second document.
import mongoose from 'mongoose';
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import Company from '../models/Company.js';
import Property from '../models/Property.js';
import Invoice, { CHARGE_DOC_TYPES, PAYMENT_DOC_TYPES, INVOICE_TYPE_LABELS } from '../models/Invoice.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { withLocks } from './locks.js';
import { renderInvoiceHtml } from '../utils/invoiceTemplate.js';
import { requestAllocation, sendDecision } from './taxAuthorityService.js';
import { sendEmail } from './emailService.js';
import { runFiscalTransaction } from './fiscalTransaction.js';
import { payloadHash } from '../domain/accounting.js';
import { emitAccountingEvent, fiscalAudit } from './accountingService.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { sumMoney, legacyNumber, ROUNDING_POLICY } from '../domain/money.js';
import { invoicerClient, invoicerConfigured } from './invoicerClient.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const digits = (v) => String(v ?? '').replace(/\D/g, '');

export const ISSUE_TYPES = ['tax_invoice', 'tax_invoice_receipt', 'receipt', 'proforma', 'refund_receipt'];
export const ALLOCATION_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'finance_manager'];
const CHARGE_LINE_TYPES = ['charge', 'fee', 'tax', 'adjustment', 'discount'];

// Thresholds of the allocation mechanism by issue date (amount before VAT, strictly above).
export const ALLOCATION_SCHEDULE = [
  { from: '2026-06-01', threshold: 5000 },
  { from: '2026-01-01', threshold: 10000 },
  { from: '2025-01-01', threshold: 20000 },
  { from: '2024-05-05', threshold: 25000 },
];

export function allocationThreshold(ymd) {
  return ALLOCATION_SCHEDULE.find((x) => String(ymd) >= x.from) || null;
}

export function validVatNumber(v) {
  return /^\d{9}$/.test(digits(v));
}

// Is an allocation number required for this document? Returns the decision with its basis.
export function allocationRule({ type, buyer, totalNet, totalVat, issueDate, requested = false }) {
  const rule = allocationThreshold(issueDate);
  const base = { threshold: rule?.threshold ?? null, from: rule?.from ?? null };
  const net = round2(totalNet);
  if (!['tax_invoice', 'tax_invoice_receipt'].includes(type)) return { ...base, required: false, reason: 'סוג המסמך אינו חשבונית מס' };
  if (!rule) return { ...base, required: false, reason: 'לפני תחולת חשבוניות ישראל' };
  if (buyer?.kind !== 'business' || !validVatNumber(buyer.vatNumber)) return { ...base, required: false, reason: 'הנמען אינו עוסק מורשה — לא נדרש מספר הקצאה' };
  if (!(Number(totalVat) > 0)) return { ...base, required: false, reason: 'אין מע״מ במסמך — לא נדרש מספר הקצאה' };
  // §1.2: an allocation number may be requested for any amount when the customer asks for it.
  if (requested && net <= rule.threshold) return { ...base, required: true, reason: `הלקוח (עוסק מורשה ${digits(buyer.vatNumber)}) ביקש מספר הקצאה — לפני מע״מ ${net.toFixed(2)}` };
  if (net <= rule.threshold) return { ...base, required: false, reason: `סכום לפני מע״מ ${net.toFixed(2)} אינו עולה על הסף ${rule.threshold.toLocaleString('he-IL')} — לא נדרש` };
  return { ...base, required: true, reason: `עוסק מורשה ${digits(buyer.vatNumber)} · לפני מע״מ ${net.toFixed(2)} מעל הסף ${rule.threshold.toLocaleString('he-IL')} (מ־${rule.from.split('-').reverse().join('.')})` };
}

function sellerOf(property) {
  const missing = [];
  if (!clip(property.legalName || property.name, 200)) missing.push('שם העסק');
  if (!validVatNumber(property.taxNumber)) missing.push('מספר עוסק / ח.פ. (9 ספרות)');
  if (!clip(property.address, 200)) missing.push('כתובת');
  if (!clip(property.city, 80)) missing.push('עיר');
  return {
    ok: missing.length === 0,
    missing,
    party: {
      name: property.legalName || property.name, legalName: property.legalName || undefined, vatNumber: digits(property.taxNumber) || '',
      address: clip(property.address, 200), city: clip(property.city, 80), country: property.country || 'IL',
      phone: property.phone || '', email: property.email || '',
    },
  };
}

// Which folio lines are already on a live document: charges on a tax invoice that is not fully
// credited, payments on a receipt / tax invoice-receipt.
export async function docCoverage(folioIds, session) {
  const ids = (Array.isArray(folioIds) ? folioIds : [folioIds]).map(String);
  const docs = await Invoice.find({ folio: { $in: ids }, status: { $in: ['issued', 'pending_allocation'] } })
    .select('type issuer invoiceNumber totalGross relatedInvoiceId creditPurpose coveredLineIds lines.folioLineId payments.folioLineId payments.nettedLineIds').session(session || null).lean();
  const creditsOf = new Map();
  for (const d of docs.filter((x) => x.type === 'credit_note' && x.relatedInvoiceId)) {
    const k = String(d.relatedInvoiceId);
    creditsOf.set(k, [...(creditsOf.get(k) || []), d]);
  }
  const charges = new Map();
  const credits = new Map(); // folio line → the credit note that documents it (a correction line)
  const payments = new Map();
  for (const d of docs) {
    if (CHARGE_DOC_TYPES.includes(d.type)) {
      const cns = creditsOf.get(String(d._id)) || [];
      const fully = round2(cns.reduce((s, c) => s + Math.abs(c.totalGross || 0), 0)) >= Math.abs(d.totalGross || 0) - 0.005;
      // Only a cancellation for re-issue frees the charges for a corrected invoice; a correction
      // credit (the guest pays less) is matched by correction lines on the folio, so nothing is freed.
      // An old in-app credit note has no purpose — it kept the old meaning (free when fully credited).
      const reissued = cns.some((c) => c.creditPurpose === 'reissue' || (!c.creditPurpose && c.issuer !== 'invoicer'));
      if (!(fully && reissued)) {
        for (const l of d.lines || []) if (l.folioLineId) charges.set(String(l.folioLineId), d.invoiceNumber);
        for (const id of d.coveredLineIds || []) charges.set(String(id), d.invoiceNumber);
        for (const c of cns) for (const id of c.coveredLineIds || []) { charges.set(String(id), c.invoiceNumber); credits.set(String(id), c.invoiceNumber); }
      }
    }
    // A refund receipt (invoicing system) documents the refund lines it lists.
    if (d.type === 'refund_receipt') for (const id of d.coveredLineIds || []) payments.set(String(id), d.invoiceNumber);
    if (PAYMENT_DOC_TYPES.includes(d.type) || d.type === 'refund_receipt') {
      for (const p of d.payments || []) {
        if (p.folioLineId) payments.set(String(p.folioLineId), d.invoiceNumber);
        for (const n of p.nettedLineIds || []) payments.set(String(n), d.invoiceNumber);
      }
    }
  }
  return { charges, payments, credits };
}

// Folio ↔ documents, in gross: what the documents say was charged / paid must equal the folio lines
// they cover. A difference means money moved without a document (or the other way round).
export async function reconcileFolios(folios) {
  const list = (Array.isArray(folios) ? folios : [folios]).filter(Boolean);
  const out = new Map();
  if (!list.length) return out;
  const ids = list.map((f) => f._id);
  const coverage = await docCoverage(ids);
  const docs = await Invoice.find({ folio: { $in: ids }, status: { $in: ['issued', 'pending_allocation'] } })
    .select('folio type issuer totalGross amountPaid relatedInvoiceId creditPurpose').lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  for (const f of list) {
    const mine = docs.filter((d) => String(d.folio) === String(f._id));
    // A charge document freed by a cancellation for re-issue nets to zero with its credits.
    const freed = new Set();
    for (const d of mine.filter((x) => CHARGE_DOC_TYPES.includes(x.type))) {
      const cns = mine.filter((c) => c.type === 'credit_note' && String(c.relatedInvoiceId) === String(d._id));
      const fully = round2(cns.reduce((s, c) => s + Math.abs(c.totalGross || 0), 0)) >= Math.abs(d.totalGross || 0) - 0.005;
      if (fully && cns.some((c) => c.creditPurpose === 'reissue' || (!c.creditPurpose && c.issuer !== 'invoicer'))) { freed.add(String(d._id)); cns.forEach((c) => freed.add(String(c._id))); }
    }
    let docCharges = 0;
    let docPaid = 0;
    for (const d of mine) {
      if (freed.has(String(d._id))) continue;
      if (CHARGE_DOC_TYPES.includes(d.type)) docCharges += Math.abs(d.totalGross || 0);
      if (d.type === 'credit_note' && byId.get(String(d.relatedInvoiceId))) docCharges -= Math.abs(d.totalGross || 0);
      if (PAYMENT_DOC_TYPES.includes(d.type)) docPaid += Number(d.amountPaid || 0);
      if (d.type === 'refund_receipt') docPaid -= Math.abs(d.totalGross || 0);
    }
    let folioCharges = 0;
    let folioPaid = 0;
    for (const l of f.lines || []) {
      if (l.status !== 'posted') continue;
      const id = String(l._id);
      if (coverage.charges.has(id)) folioCharges += Number(l.amount || 0) + Number(l.taxAmount || 0);
      if (coverage.payments.has(id)) folioPaid -= Number(l.amount || 0);
    }
    const c = { documents: round2(docCharges), folio: round2(folioCharges) };
    const p = { documents: round2(docPaid), folio: round2(folioPaid) };
    c.diff = round2(c.documents - c.folio);
    p.diff = round2(p.documents - p.folio);
    out.set(String(f._id), { ok: Math.abs(c.diff) < 0.01 && Math.abs(p.diff) < 0.01, charges: c, payments: p });
  }
  return out;
}

function eligibleLines(folio, coverage, propertyVat) {
  let posted = folio.lines.filter((l) => l.status === 'posted');
  // Receivables moves (gap-map item 7) are internal: a payment matched to another debt, a write-off,
  // the pair lines of a debt moved to another account. No document is issued for them, and a payment
  // voided on the account (bounced cheque) is no longer receipted.
  const voidedPay = new Set(posted.filter((l) => l.arLink?.kind === 'void').map((l) => String(l.reversalOf)));
  posted = posted.filter((l) => !l.arLink && !voidedPay.has(String(l._id)));
  // A reversed charge and its reversal cancel out — neither is invoiced.
  const reversed = new Set(posted.filter((l) => l.reversalOf).map((l) => String(l.reversalOf)));
  const charges = posted
    .filter((l) => CHARGE_LINE_TYPES.includes(l.type) && !l.reversalOf && !reversed.has(String(l._id)) && !coverage.charges.has(String(l._id)))
    .filter((l) => Math.abs(Number(l.amount || 0) + Number(l.taxAmount || 0)) > 0.005)
    .map((l) => {
      const net = round2(l.amount);
      const vat = round2(l.taxAmount || 0);
      const rate = Number.isFinite(l.vatRate) ? l.vatRate : (Math.abs(vat) > 0.005 ? propertyVat : 0);
      return { id: String(l._id), description: l.description, serviceDate: l.serviceDate, department: l.department || '', quantity: l.quantity || 1, net, vat, gross: round2(net + vat), vatRate: rate, discountOf: l.discountOf ? String(l.discountOf) : null };
    });
  // A refund of a payment that has no receipt yet is netted into that payment's receipt; a refund of a
  // payment already receipted gets its own (negative) receipt line — money returned is documented too.
  // A Paid Out (cash handed out for the guest) is not a refund of a payment — it is owed back and has
  // its own signed slip, so it never enters a receipt.
  const refunds = posted.filter((x) => x.type === 'refund' && !x.paidOut?.purpose && !coverage.payments.has(String(x._id)));
  const refundedOf = new Map();
  for (const l of refunds.filter((x) => x.refundOf && !coverage.payments.has(String(x.refundOf)))) {
    const k = String(l.refundOf);
    const cur = refundedOf.get(k) || { amount: 0, ids: [] };
    refundedOf.set(k, { amount: round2(cur.amount + Number(l.amount || 0)), ids: [...cur.ids, String(l._id)] });
  }
  const payments = posted
    .filter((l) => ['payment', 'deposit'].includes(l.type) && !coverage.payments.has(String(l._id)))
    .map((l) => ({ l, net: refundedOf.get(String(l._id)) }))
    .map(({ l, net }) => ({ l, amount: round2(Math.abs(Number(l.amount || 0)) - (net?.amount || 0)), netted: net?.ids || [] }))
    .filter((x) => x.amount > 0.005)
    .map(({ l, amount, netted }) => ({
      id: String(l._id), kind: 'payment', description: l.description, method: l.method || 'other', reference: l.methodRef || null, amount,
      date: l.payDetails?.payDate || l.serviceDate, postedAt: l.postedAt, details: l.payDetails || null, netted,
    }));
  for (const l of refunds.filter((x) => !x.refundOf || coverage.payments.has(String(x.refundOf)))) {
    const amt = round2(Math.abs(Number(l.amount || 0)));
    if (amt > 0.005) payments.push({ id: String(l._id), kind: 'refund', description: l.description, method: l.method || 'other', reference: l.methodRef || null, amount: -amt, date: l.serviceDate, postedAt: l.postedAt, details: l.payDetails || null, netted: [], refundOf: l.refundOf ? String(l.refundOf) : null });
  }
  return { charges, payments };
}

const sum = (rows, k) => legacyNumber(sumMoney(rows.map((r) => r[k] || 0)));

// What in each folio has no document yet (checkout reminder: charges without a tax invoice,
// payments without a receipt). folios may be lean.
export async function undocumentedByFolio(folios, propertyVat = 18) {
  const out = new Map();
  if (!folios.length) return out;
  const coverage = await docCoverage(folios.map((f) => f._id));
  for (const f of folios) {
    const { charges, payments } = eligibleLines(f, coverage, propertyVat);
    const dates = [...charges.map((c) => c.serviceDate), ...payments.map((x) => x.date)].filter(Boolean).sort();
    out.set(String(f._id), { charges: sum(charges, 'gross'), payments: sum(payments, 'amount'), chargeLines: charges.length, paymentLines: payments.length, oldest: dates[0] || null });
  }
  return out;
}

// With the invoicing system a refund is never a negative receipt line: it is a refund receipt, the
// credit of the receipt that documented the refunded payment. Receipts then list payments only.
function typeAvailability(charges, allPayments, { external = false } = {}) {
  const refunds = external ? allPayments.filter((p) => p.kind === 'refund') : [];
  const payments = external ? allPayments.filter((p) => p.kind !== 'refund') : allPayments;
  const g = sum(charges, 'gross');
  const p = sum(payments, 'amount');
  const out = {
    tax_invoice: g > 0.005 ? { ok: true } : { ok: false, why: 'אין חיובים שטרם הופקה עליהם חשבונית' },
    receipt: payments.length && Math.abs(p) > 0.005 ? { ok: true } : { ok: false, why: 'אין תקבולים או החזרים שטרם הופקה עליהם קבלה' },
    proforma: g > 0.005 ? { ok: true } : { ok: false, why: 'אין חיובים לדרישת תשלום' },
  };
  if (!(g > 0.005) || !(p > 0.005)) out.tax_invoice_receipt = { ok: false, why: !(g > 0.005) ? 'אין חיובים שטרם הופקה עליהם חשבונית' : 'אין תקבולים — הפיקו חשבונית מס' };
  else if (Math.abs(g - p) > 0.01) out.tax_invoice_receipt = { ok: false, why: `התקבולים (${p.toFixed(2)}) אינם שווים לחיובים (${g.toFixed(2)}) — הפיקו חשבונית מס וקבלה בנפרד` };
  else out.tax_invoice_receipt = { ok: true };
  if (!external) out.refund_receipt = { ok: false, why: 'קבלת החזר מופקת במערכת החשבוניות' };
  else if (!refunds.length) out.refund_receipt = { ok: false, why: 'אין החזרים שטרם הופקה עליהם קבלת החזר' };
  else out.refund_receipt = { ok: true, amount: round2(-sum(refunds, 'amount')) };
  let recommended = null;
  if (out.tax_invoice_receipt.ok) recommended = 'tax_invoice_receipt';
  else if (out.tax_invoice.ok) recommended = 'tax_invoice';
  else if (out.receipt.ok) recommended = 'receipt';
  else if (out.refund_receipt.ok) recommended = 'refund_receipt';
  return { types: out, recommended };
}

async function loadFolio(folioId, propertyId, session) {
  if (!isId(String(folioId || ''))) throw httpError('מזהה חשבון לא תקין', 400);
  const folio = await Folio.findById(folioId).session(session || null);
  if (!folio || String(folio.property) !== String(propertyId)) throw httpError('החשבון לא נמצא', 404);
  return folio;
}

function guestParty(g) {
  if (!g) return null;
  return {
    kind: 'private', name: `${g.firstName || ''} ${g.lastName || ''}`.trim(), idNumber: '',
    address: g.address?.line1 || '', city: g.address?.city || '', email: g.email || '', phone: g.phone || '',
  };
}

function companyParty(c) {
  if (!c) return null;
  return { kind: 'business', companyId: String(c._id), name: c.name, vatNumber: digits(c.taxId), address: c.address || '', city: '', email: c.email || '', phone: c.phone || '' };
}

// FIN-06 draft view: what can be documented in this folio window, by whom, and what the law asks.
export async function documentContext({ propertyId, folioId }) {
  const folio = await loadFolio(folioId, propertyId);
  // Credits and refunds made in the invoicing system since the last look count before offering more.
  if (documentIssuer() === 'invoicer') await syncInvoicerDocuments(propertyId).catch(() => null);
  const [property, res] = await Promise.all([
    Property.findById(propertyId).lean(),
    Reservation.findById(folio.reservation).select('confirmationNumber primaryGuest company arrivalDate departureDate').populate('primaryGuest', 'firstName lastName email phone address').populate('company', 'name taxId address email phone').lean(),
  ]);
  const payerCompany = folio.ownerType === 'company' && isId(String(folio.ownerRef || '')) ? await Company.findById(folio.ownerRef).select('name taxId address email phone').lean() : null;
  const coverage = await docCoverage(folio._id);
  const { charges, payments } = eligibleLines(folio, coverage, property?.vatRate ?? 18);
  const externalIssuer = documentIssuer() === 'invoicer';
  const { types, recommended } = typeAvailability(charges, payments, { external: externalIssuer });
  const issueDate = businessDateOf(property);
  // A passer-by account names its own payer (NR folio); a stay takes it from the reservation.
  const acct = !folio.reservation ? folio.account || {} : null;
  const acctCompany = acct?.company ? await Company.findById(acct.company).select('name taxId address email phone').lean() : null;
  const company = companyParty(payerCompany || acctCompany || res?.company);
  const guest = acct ? { kind: 'private', name: acct.name || '', idNumber: '', address: '', city: '', email: acct.email || '', phone: acct.phone || '' } : guestParty(res?.primaryGuest);
  const docs = await Invoice.find({ folio: folio._id }).sort({ createdAt: 1 }).lean();
  const external = externalIssuer ? await invoicerReadiness(propertyId) : null;
  return {
    folio: { id: String(folio._id), ownerType: folio.ownerType, status: folio.status },
    reservation: res ? { id: String(res._id), confirmationNumber: res.confirmationNumber, arrivalDate: res.arrivalDate, departureDate: res.departureDate } : null,
    // With the invoicing system the seller's identity and the allocation rule live there.
    issuer: external ? { system: 'invoicer', ...external } : { system: 'hotel4u', ready: true },
    seller: external ? { ok: external.ready, missing: external.ready ? [] : [external.reason], party: null } : sellerOf(property || {}),
    issueDate,
    allocation: external ? null : allocationThreshold(issueDate),
    buyers: { guest, company },
    buyerDefault: payerCompany || acctCompany ? company : guest,
    charges,
    payments: externalIssuer ? payments.filter((p) => p.kind !== 'refund') : payments,
    refunds: externalIssuer ? payments.filter((p) => p.kind === 'refund').map((p) => ({ ...p, amount: -p.amount })) : [],
    totals: {
      charges: { net: sum(charges, 'net'), vat: sum(charges, 'vat'), gross: sum(charges, 'gross') },
      payments: sum(externalIssuer ? payments.filter((p) => p.kind !== 'refund') : payments, 'amount'),
    },
    types, recommended,
    documents: docs.map(docDto),
  };
}

function cleanBuyer(input) {
  const b = input && typeof input === 'object' ? input : {};
  const kind = b.kind === 'business' ? 'business' : 'private';
  const party = {
    kind,
    name: clip(b.name, 120), vatNumber: kind === 'business' ? digits(b.vatNumber) : undefined,
    idNumber: kind === 'private' ? digits(b.idNumber).slice(0, 9) || undefined : undefined,
    address: clip(b.address, 200) || undefined, city: clip(b.city, 80) || undefined,
    email: clip(b.email, 120) || undefined, phone: clip(b.phone, 30) || undefined, country: 'IL',
  };
  const errors = {};
  if (party.name.length < 2) errors.name = kind === 'business' ? 'שם העסק' : 'שם הנמען';
  if (kind === 'business') {
    if (!validVatNumber(party.vatNumber)) errors.vatNumber = 'מספר עוסק / ח.פ. — 9 ספרות';
    if (!party.address) errors.address = 'כתובת העסק';
  }
  if (party.idNumber && party.idNumber.length < 5) errors.idNumber = 'מספר זהות לא תקין';
  if (Object.keys(errors).length) throw httpError('יש להשלים את פרטי הנמען', 422, { fields: errors });
  return party;
}

async function nextNumber(propertyId, type, session) {
  // Every in-app numbering path (manual invoice, credit note, folio document) passes here.
  if (documentIssuer() === 'invoicer') throw httpError('מסמכים פיסקליים מופקים במערכת החשבוניות בלבד — Hotel4u אינו ממספר מסמכים', 409, { code: 'managed_by_invoicer' });
  const p =await Property.findByIdAndUpdate(propertyId, { $inc: { [`docSequences.${type}`]: 1 } }, { returnDocument: 'after', ...(session ? { session } : {}) }).select('docSequences').lean();
  if (!p) throw httpError('הנכס לא נמצא', 404);
  const seq = p.docSequences?.[type] || 1;
  return { seq, number: String(seq) };
}
export { nextNumber as nextDocumentNumber };

function opKey(key) {
  const k = String(key || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(k)) throw httpError('חסר מזהה פעולה (idempotency key)', 422);
  return `doc:${k}`;
}

export function docDto(d) {
  return {
    id: String(d._id), type: d.type, typeLabel: INVOICE_TYPE_LABELS[d.type] || d.type, number: d.invoiceNumber || null, status: d.status,
    issueDate: d.issueDate, net: round2(d.totalNet || 0), vat: round2(d.totalVat || 0), gross: round2(d.totalGross || 0), paid: round2(d.amountPaid || 0),
    buyer: d.buyer ? { name: d.buyer.name, vatNumber: d.buyer.vatNumber || null, email: d.buyer.email || null } : null,
    folioId: d.folio ? String(d.folio) : null, reservationId: d.reservation ? String(d.reservation?._id || d.reservation) : null,
    relatedTo: d.relatedInvoiceId ? String(d.relatedInvoiceId?._id || d.relatedInvoiceId) : null,
    allocation: {
      status: d.allocationStatus || (d.status === 'pending_allocation' ? 'pending' : d.allocationNumber ? 'approved' : 'not_required'),
      number: d.allocationNumber || null, fullNumber: d.allocationFullNumber || null, reason: d.allocationReason || null, threshold: d.allocationThreshold ?? null, rejectReason: d.allocationRejectReason || null,
      source: d.allocationSource || null, lastError: d.allocationLastError || null, retry: d.allocationRetry !== false, attempts: d.allocationAttempts || 0,
      decision: d.allocationDecision || null, decidedAt: d.allocationDecidedAt || null, decisionSent: d.allocationDecisionSent ?? null,
      requestedByCustomer: !!d.requestedByCustomer,
    },
    sent: (d.sentLog || []).map((x) => ({ to: x.to, at: x.at, by: x.by })),
    printed: d.printCount || 0,
    issuer: d.issuer || 'hotel4u',
    external: d.issuer === 'invoicer' ? { documentId: d.external?.documentId || null, environment: d.external?.environment || null } : null,
  };
}

// FIN-06-A03 issue.
export async function issueDocument({ propertyId, folioId, input, actor, ip }) {
  const type = input.type;
  if (!ISSUE_TYPES.includes(type)) throw httpError('יש לבחור סוג מסמך', 422, { fields: { type: 'סוג מסמך' } });
  const requestKey = opKey(input.idempotencyKey);
  const requestPayloadHash = payloadHash({ propertyId: String(propertyId), folioId: String(folioId), input });
  const duplicate = (d) => {
    if (d.requestPayloadHash && d.requestPayloadHash !== requestPayloadHash) throw httpError('מזהה הפעולה כבר שימש לבקשה עם תוכן אחר', 409);
    if (String(d.folio) !== String(folioId)) throw httpError('מזהה הפעולה שייך לחשבון אחר', 409);
    return { ...docDto(d), duplicate: true };
  };
  const dup = await Invoice.findOne({ property: propertyId, requestKey }).lean();
  if (dup) return duplicate(dup);
  if (documentIssuer() === 'invoicer') return issueViaInvoicer({ propertyId, folioId, input, actor, ip, type, requestKey, requestPayloadHash, duplicate });
  const issued = await withLocks([`docs:${folioId}`], () => runFiscalTransaction(async (session) => {
    const again = await Invoice.findOne({ property: propertyId, requestKey }).session(session).lean();
    if (again) return duplicate(again);
    const folio = await loadFolio(folioId, propertyId, session);
    const property = await Property.findById(propertyId).session(session).lean();
    const seller = sellerOf(property || {});
    if (!seller.ok) throw httpError(`חסרים פרטי העסק להנפקת מסמך: ${seller.missing.join(', ')} — הגדרות › פרטי הנכס`, 422, { code: 'seller_incomplete', details: seller.missing });
    const coverage = await docCoverage(folio._id, session);
    const { charges, payments } = eligibleLines(folio, coverage, property.vatRate ?? 18);
    const { types } = typeAvailability(charges, payments);
    if (!types[type].ok) throw httpError(types[type].why, 409, { code: 'nothing_to_document' });
    const buyer = cleanBuyer(input.buyer);
    const requested = !!input.requestAllocation && buyer.kind === 'business';
    const withCharges = type !== 'receipt';
    const withPayments = ['receipt', 'tax_invoice_receipt'].includes(type);
    const lines = withCharges ? charges.map((c) => ({
      description: c.description, quantity: 1, unitPrice: c.net, discountPct: 0,
      netAmount: c.net, vatRate: c.vatRate, vatAmount: c.vat, grossAmount: c.gross,
      serviceDate: c.serviceDate, department: c.department, folioLineId: c.id,
    })) : [];
    const pays = withPayments ? payments.map((p) => ({
      method: p.method === 'cheque' ? 'cheque' : ['cash', 'credit_card', 'bank_transfer', 'voucher'].includes(p.method) ? p.method : 'other',
      amount: p.amount, reference: p.reference || undefined, paidAt: p.postedAt, paymentDate: p.date, folioLineId: p.id, nettedLineIds: p.netted?.length ? p.netted : undefined, isRefund: p.kind === 'refund' || undefined,
      last4: p.details?.last4, cardBrand: p.details?.cardBrand, installments: p.details?.installments,
      bank: p.details?.bank, branch: p.details?.branch, account: p.details?.account, dueDate: p.details?.dueDate, payerName: p.details?.payerName,
    })) : [];
    const totalNet = withCharges ? sum(lines, 'netAmount') : 0;
    const totalVat = withCharges ? sum(lines, 'vatAmount') : 0;
    const amountPaid = sum(pays, 'amount');
    const totalGross = withCharges ? sum(lines, 'grossAmount') : amountPaid;
    const issueDate = todayYmdInTimezone(property.timezone || 'Asia/Jerusalem');
    const alloc = allocationRule({ type, buyer, totalNet, totalVat, issueDate, requested });
    const serviceDates = lines.map((l) => l.serviceDate).filter(Boolean).sort();
    const { seq, number } = await nextNumber(propertyId, type, session);
    const snapshot = { seller: seller.party, buyer, lines, pays, totalNet, totalVat, totalGross, issueDate, currency: folio.currency || 'ILS', type, number };
    const [doc] = await Invoice.create([{
      property: propertyId, folio: folio._id, reservation: folio.reservation, type, invoiceNumber: number, seq, requestKey,
      requestPayloadHash, moneyPolicy: ROUNDING_POLICY, documentHash: payloadHash(snapshot),
      status: 'issued', issueDate, taxDate: issueDate, serviceDate: serviceDates[serviceDates.length - 1] || issueDate,
      seller: seller.party, buyer: { ...buyer, kind: undefined }, lines, currency: folio.currency || 'ILS',
      totalNet, totalVat, totalGross, totalDiscount: 0, vatRate: property.vatRate ?? 18,
      payments: pays, amountPaid, balance: withCharges ? round2(totalGross - amountPaid) : 0,
      requiresAllocation: alloc.required, allocationStatus: alloc.required ? 'pending' : 'not_required', requestedByCustomer: requested,
      allocationReason: alloc.reason, allocationThreshold: alloc.threshold ?? undefined,
      issuedBy: actor.id || undefined, issuedAt: new Date(), notes: clip(input.notes, 500) || undefined,
    }], { session });
    await fiscalAudit({
      propertyId, actor, action: 'invoice.issued', entityId: doc._id,
      after: { type, number, folioId: String(folio._id), net: totalNet, vat: totalVat, gross: totalGross, paid: amountPaid, charges: lines.length, payments: pays.length, buyerKind: buyer.kind, allocation: alloc.required ? 'pending' : 'not_required' },
    }, session);
    await emitAccountingEvent({ propertyId, eventKey: `document:${doc._id}`, type: 'document.issued', sourceId: doc._id, payload: { documentId: String(doc._id), hash: doc.documentHash, type, net: String(totalNet), tax: String(totalVat), gross: String(totalGross) }, topics: ['document.archive'] }, session);
    return { ...docDto(doc.toObject()), duplicate: false, requestAutomaticAllocation: alloc.required && property.fiscal?.allocationMode === 'api' };
  }), { waitMs: 3000 });
  // Network effects run after commit and after releasing the lock.
  if (issued.requestAutomaticAllocation) {
    await requestAllocation({ invoiceId: issued.id, actor }).catch(() => null);
    return { ...docDto(await Invoice.findById(issued.id).lean()), duplicate: false };
  }
  delete issued.requestAutomaticAllocation;
  return issued;
}

// ── Issuing through the invoicing system (owner decision 2026-10-19) ───────────────────────────
// Every fiscal document is issued by our standalone invoicing system (../invoicer) over its API.
// Hotel4u still builds it from the folio (no retyping, no double documents) and keeps a mirror with
// the number that came back, so the folio, the checkout and the day close know what is documented.
// LEGACY_LOCAL_DOCUMENTS=1 keeps the old in-app numbering for the legacy QA suites; never in production.
export function documentIssuer() {
  if (process.env.LEGACY_LOCAL_DOCUMENTS === '1' && process.env.NODE_ENV !== 'production') return 'hotel4u';
  return 'invoicer';
}

async function invoicerReadiness(propertyId) {
  if (!invoicerConfigured()) return { ready: false, reason: 'מערכת החשבוניות לא חוברה לשרת — יש להגדיר INVOICER_API_URL ו־INVOICER_API_KEY' };
  try {
    const w = await invoicerClient().requireWorkspace(propertyId);
    return { ready: true, workspace: w.name || null, environment: w.environment || 'sandbox' };
  } catch (err) {
    return { ready: false, reason: err.message };
  }
}

const INVOICER_METHODS = ['cash', 'credit_card', 'bank_transfer', 'cheque', 'voucher'];
const PAY_LABELS = { cash: 'מזומן', credit_card: 'כרטיס אשראי', bank_transfer: 'העברה בנקאית', cheque: 'שיק', voucher: 'שובר' };
const fixed2 = (n) => round2(n).toFixed(2);

// Charges at the price the guest paid (VAT included), so the document total equals the folio to the
// agora. A discount or adjustment (negative) cannot be a line of its own — it is folded into the
// largest charges with the same VAT rate and named in their description.
// Folio line id → its invoice combination (folio.combos): those lines go out as one invoice line.
function comboMap(folio) {
  return new Map((folio.combos || []).flatMap((c) => (c.lineIds || []).map((id) => [String(id), { id: String(c._id), label: c.label }])));
}

function invoicerLines(charges, combos = new Map()) {
  const byRate = new Map();
  for (const c of charges) byRate.set(c.vatRate, [...(byRate.get(c.vatRate) || []), c]);
  const out = [];
  for (const [rate, rows] of byRate) {
    const pos = rows.filter((r) => r.gross > 0.005).map((r) => ({ ...r, ids: [r.id], folded: [] }));
    const neg = rows.filter((r) => r.gross < -0.005);
    for (const n of neg) {
      let left = round2(-n.gross);
      // A line discount folds into its own charge first, then into the largest ones.
      for (const p of [...pos].sort((a, b) => (b.id === n.discountOf) - (a.id === n.discountOf) || b.gross - a.gross)) {
        if (left <= 0.005) break;
        const take = round2(Math.min(left, p.gross));
        if (take <= 0.005) continue;
        p.gross = round2(p.gross - take);
        p.folded.push(`${n.description} ${fixed2(take)}`);
        if (!p.ids.includes(n.id)) p.ids.push(n.id);
        left = round2(left - take);
      }
      if (left > 0.005) throw httpError(`ההנחות והזיכויים בשיעור מע״מ ${rate}% גדולים מהחיובים באותו שיעור — לא ניתן לבנות מהם חשבונית`, 422, { code: 'negative_exceeds_charges' });
    }
    // Combined lines (same rate by construction) become one line under the combination's name.
    const merged = new Map();
    for (const p of pos) {
      const c = combos.get(p.id);
      if (!c) { out.push(p); continue; }
      const m = merged.get(c.id);
      if (!m) { const first = { ...p, description: c.label, folded: [...p.folded] }; merged.set(c.id, first); out.push(first); continue; }
      m.gross = round2(m.gross + p.gross);
      m.ids.push(...p.ids.filter((id) => !m.ids.includes(id)));
      m.folded.push(...p.folded);
      if (String(p.serviceDate || '') > String(m.serviceDate || '')) m.serviceDate = p.serviceDate;
    }
  }
  return out
    .sort((a, b) => String(a.serviceDate || '').localeCompare(String(b.serviceDate || '')))
    .map((p) => ({
      ids: p.ids, serviceDate: p.serviceDate, department: p.department,
      body: {
        description: clip(p.folded.length ? `${p.description} (בניכוי ${p.folded.join(', ')})` : p.description, 300),
        quantity: '1', unitPrice: fixed2(p.gross), vatRate: String(p.vatRate), pricesIncludeVat: true,
      },
    }));
}

function invoicerPayments(payments) {
  return payments.map((p) => {
    if (p.kind === 'refund' || p.amount <= 0) throw httpError('החזר כספי לאורח מתועד בקבלת החזר — מזכים את הקבלה המקורית במערכת החשבוניות', 422, { code: 'refund_in_invoicer' });
    if (!INVOICER_METHODS.includes(p.method)) throw httpError(`אמצעי התשלום "${p.method}" אינו נתמך בקבלה — ${Object.values(PAY_LABELS).join(' / ')}`, 422, { code: 'unsupported_method' });
    return { method: p.method, amount: fixed2(p.amount), reference: p.reference || undefined, details: p.details || {} };
  });
}

// One customer per payer in the invoicing system, found again on the next stay.
function invoicerCustomer(buyer, reservationId) {
  const taxId = buyer.kind === 'business' ? buyer.vatNumber : buyer.idNumber;
  return {
    name: buyer.name, kind: buyer.kind, taxId: taxId || undefined,
    email: buyer.email, phone: buyer.phone, address: buyer.address, city: buyer.city,
    externalId: buyer.kind === 'business' ? `hotel4u:vat:${taxId}` : taxId ? `hotel4u:id:${taxId}` : `hotel4u:res:${reservationId}`,
  };
}

async function issueViaInvoicer({ propertyId, folioId, input, actor, ip, type, requestKey, requestPayloadHash, duplicate }) {
  const client = invoicerClient();
  // Network calls run under the folio lock (not inside a DB transaction): a retry of the same request
  // reuses the same operation keys there, so it can never issue a second document.
  return withLocks([`docs:${folioId}`], async () => {
    const again = await Invoice.findOne({ property: propertyId, requestKey }).lean();
    if (again) return duplicate(again);
    const folio = await loadFolio(folioId, propertyId);
    const property = await Property.findById(propertyId).lean();
    const coverage = await docCoverage(folio._id);
    const { charges, payments: allPayments } = eligibleLines(folio, coverage, property?.vatRate ?? 18);
    const { types } = typeAvailability(charges, allPayments, { external: true });
    if (!types[type].ok) throw httpError(types[type].why, 409, { code: 'nothing_to_document' });
    if (type === 'refund_receipt') return refundViaInvoicer({ propertyId, folio, property, refunds: allPayments.filter((p) => p.kind === 'refund'), input, actor, ip, requestKey, requestPayloadHash, duplicate });
    const payments = allPayments.filter((p) => p.kind !== 'refund');
    const buyer = cleanBuyer(input.buyer);
    const withCharges = type !== 'receipt';
    const withPayments = ['receipt', 'tax_invoice_receipt'].includes(type);
    const lines = withCharges ? invoicerLines(charges, comboMap(folio)) : [];
    const pays = withPayments ? invoicerPayments(payments) : [];
    const res = await Reservation.findById(folio.reservation).select('confirmationNumber').lean();
    const ref = res?.confirmationNumber ? `הזמנה ${res.confirmationNumber}` : '';
    const docLines = withCharges ? lines.map((l) => l.body)
      : [{ description: ref ? `תקבול — ${ref}` : 'תקבול', quantity: '1', unitPrice: fixed2(sum(payments, 'amount')), vatRate: '0' }];
    const notes = [ref, clip(input.notes, 500)].filter(Boolean).join(' · ');

    const workspace = await client.requireWorkspace(propertyId);
    let issued;
    try {
      const customer = await client.ensureCustomer(workspace._id, invoicerCustomer(buyer, folio.reservation));
      const draft = await client.createDraft(workspace._id, { type, customer: customer._id, lines: docLines, ...(pays.length ? { payments: pays } : {}), ...(notes ? { notes } : {}) }, `hotel4u:draft:${requestKey}`);
      issued = draft.status === 'issued' ? draft : await client.issue(workspace._id, draft._id, `hotel4u:issue:${requestKey}`);
    } catch (err) {
      if (err.status >= 400 && err.status < 500) throw httpError(`מערכת החשבוניות לא הפיקה את המסמך: ${err.message}`, 422, { code: err.code || 'invoicer_rejected' });
      throw err;
    }

    const num = (v) => legacyNumber(v ?? '0');
    const mirrorLines = (issued.lines || []).map((l, i) => ({
      description: l.description, quantity: Number(l.quantity) || 1, unitPrice: num(l.unitPrice), discountPct: 0,
      netAmount: num(l.net), vatRate: Number(l.vatRate), vatAmount: num(l.tax), grossAmount: num(l.gross),
      serviceDate: lines[i]?.serviceDate, department: lines[i]?.department, folioLineId: lines[i]?.ids[0],
      externalLineId: l._id ? String(l._id) : undefined, folioLineIds: withCharges ? lines[i]?.ids : undefined,
    }));
    const mirrorPays = withPayments ? payments.map((p) => ({
      method: p.method, amount: p.amount, reference: p.reference || undefined, paidAt: p.postedAt, paymentDate: p.date, folioLineId: p.id, nettedLineIds: p.netted?.length ? p.netted : undefined,
      last4: p.details?.last4, cardBrand: p.details?.cardBrand, installments: p.details?.installments,
      bank: p.details?.bank, branch: p.details?.branch, account: p.details?.account, dueDate: p.details?.dueDate, payerName: p.details?.payerName,
    })) : [];
    const totalGross = num(issued.gross);
    const amountPaid = sum(mirrorPays, 'amount');
    const issueDate = issued.issueDate || todayYmdInTimezone(property?.timezone || 'Asia/Jerusalem');
    const serviceDates = lines.map((l) => l.serviceDate).filter(Boolean).sort();
    let doc;
    try {
      [doc] = await Invoice.create([{
        property: propertyId, folio: folio._id, reservation: folio.reservation, type, invoiceNumber: String(issued.number), requestKey, requestPayloadHash,
        issuer: 'invoicer', external: { workspace: String(workspace._id), documentId: String(issued._id), environment: issued.environment || 'sandbox' },
        coveredLineIds: lines.flatMap((l) => l.ids),
        status: 'issued', issueDate, taxDate: issueDate, serviceDate: serviceDates[serviceDates.length - 1] || issueDate,
        seller: { name: issued.seller?.name || property?.legalName || property?.name, vatNumber: issued.seller?.taxId || '', address: issued.seller?.address || '', city: issued.seller?.city || '', country: 'IL' },
        buyer: { ...buyer, kind: undefined }, lines: mirrorLines, currency: folio.currency || 'ILS',
        totalNet: num(issued.net), totalVat: num(issued.tax), totalGross, totalDiscount: 0, vatRate: property?.vatRate ?? 18,
        payments: mirrorPays, amountPaid, balance: withCharges ? round2(totalGross - amountPaid) : 0,
        allocationStatus: issued.allocationNumber ? 'approved' : 'not_required', allocationNumber: issued.allocationNumber || undefined,
        allocationReason: 'מנוהל במערכת החשבוניות', issuedBy: actor.id || undefined, issuedAt: new Date(), notes: clip(input.notes, 500) || undefined,
      }]);
    } catch (err) {
      if (err?.code === 11000) {
        const existing = await Invoice.findOne({ property: propertyId, $or: [{ requestKey }, { 'external.documentId': String(issued._id) }] }).lean();
        if (existing) return duplicate(existing);
      }
      throw err;
    }
    await audit({
      property: propertyId, actor: actor.id, actorName: actor.name, action: 'invoice.issued', entityType: 'Invoice', entityId: doc._id,
      after: { issuer: 'invoicer', externalId: String(issued._id), type, number: doc.invoiceNumber, folioId: String(folio._id), gross: totalGross, paid: amountPaid, lines: mirrorLines.length, buyerKind: buyer.kind },
      ip,
    });
    return { ...docDto(doc.toObject()), duplicate: false };
  }, { ttlMs: 90_000, waitMs: 3000 });
}

// ── Credits through the invoicing system ─────────────────────────────────────────────────────
// A credit there is always tied to its source: crediting a tax invoice gives a credit note, crediting
// a receipt gives a refund receipt (money returned). Hotel4u keeps a mirror linked to the source
// mirror, so the folio knows what is credited — whether the credit started here or there.
const mirrorMethod = (m) => (PAYMENT_MEANS_OK.includes(m) ? m : 'other');
const PAYMENT_MEANS_OK = ['cash', 'credit_card', 'bank_transfer', 'cheque', 'voucher', 'other'];

export async function saveCreditMirror({ propertyId, source, issued, requestKey, requestPayloadHash, actor, notes, payments = [], purpose, origin = 'hotel4u', coveredLineIds, session = null }) {
  const num = (v) => legacyNumber(v ?? '0');
  // Inside a transaction a duplicate-key error would abort it — look first.
  const before = await Invoice.findOne({ property: propertyId, $or: [{ requestKey }, { 'external.documentId': String(issued._id) }] }).session(session).lean();
  if (before) return { doc: before, created: false };
  const type = issued.type === 'refund_receipt' ? 'refund_receipt' : 'credit_note';
  const issueDate = issued.issueDate || todayYmdInTimezone('Asia/Jerusalem');
  const gross = num(issued.gross);
  try {
    const [doc] = await Invoice.create([{
      property: propertyId, folio: source.folio, reservation: source.reservation, type, invoiceNumber: String(issued.number),
      requestKey, requestPayloadHash: requestPayloadHash || undefined,
      issuer: 'invoicer', external: { workspace: source.external?.workspace, documentId: String(issued._id), environment: issued.environment || 'sandbox' },
      status: 'issued', issueDate, taxDate: issueDate, serviceDate: source.serviceDate || issueDate,
      seller: source.seller, buyer: source.buyer, currency: source.currency || 'ILS',
      lines: (issued.lines || []).map((l) => ({
        description: l.description, quantity: Number(l.quantity) || 1, unitPrice: num(l.unitPrice ?? l.gross), discountPct: 0,
        netAmount: num(l.net), vatRate: Number(l.vatRate) || 0, vatAmount: num(l.tax), grossAmount: num(l.gross),
        externalLineId: l._id ? String(l._id) : undefined, externalSourceLineId: l.sourceLineId ? String(l.sourceLineId) : undefined,
      })),
      ...(type === 'credit_note' ? { creditPurpose: purpose || 'correction', creditOrigin: origin } : {}),
      ...(coveredLineIds?.length ? { coveredLineIds } : {}),
      totalNet: num(issued.net), totalVat: num(issued.tax), totalGross: gross, totalDiscount: 0, vatRate: source.vatRate,
      payments, amountPaid: type === 'refund_receipt' ? gross : 0, balance: 0,
      relatedInvoiceId: source._id,
      allocationStatus: issued.allocationNumber ? 'approved' : 'not_required', allocationNumber: issued.allocationNumber || undefined,
      allocationReason: 'מנוהל במערכת החשבוניות', issuedBy: actor?.id || undefined, issuedAt: new Date(), notes: clip(notes, 500) || undefined,
    }], { session });
    return { doc: doc.toObject(), created: true };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const existing = await Invoice.findOne({ property: propertyId, $or: [{ requestKey }, { 'external.documentId': String(issued._id) }] }).lean();
    if (!existing) throw err;
    return { doc: existing, created: false };
  }
}

const invoicerFailure = (what) => (err) => {
  if (err.status >= 400 && err.status < 500) throw httpError(`מערכת החשבוניות לא הפיקה את ${what}: ${err.message}`, 422, { code: err.code || 'invoicer_rejected' });
  throw err;
};

// Refund lines on the folio → a refund receipt: the credit of the receipt that documented the
// refunded payment, for the refunded amount. One source receipt per request; the dialog offers the
// next one if refunds of several receipts are waiting.
async function refundViaInvoicer({ propertyId, folio, refunds, input, actor, ip, requestKey, requestPayloadHash, duplicate }) {
  const ofIds = [...new Set(refunds.map((r) => r.refundOf).filter(Boolean))];
  const sources = ofIds.length ? await Invoice.find({ property: propertyId, issuer: 'invoicer', status: 'issued', type: { $in: PAYMENT_DOC_TYPES }, 'payments.folioLineId': { $in: ofIds } }).lean() : [];
  const sourceOf = (r) => sources.find((d) => (d.payments || []).some((p) => String(p.folioLineId) === r.refundOf));
  const first = refunds.find((r) => sourceOf(r));
  if (!first) throw httpError('ההחזר הוא של תשלום שעדיין אין עליו קבלה — מפיקים קבלה על התקבולים (ההחזר יקוזז ממנה)', 409, { code: 'refund_without_receipt' });
  const source = sourceOf(first);
  if (source.type !== 'receipt') throw httpError(`התשלום תועד ב${INVOICE_TYPE_LABELS[source.type]} ${source.invoiceNumber} — את ההחזר מתעדים במסמך זיכוי לאותו מסמך (רשימת המסמכים › זיכוי)`, 409, { code: 'refund_on_invoice_receipt' });
  const group = refunds.filter((r) => String(sourceOf(r)?._id) === String(source._id));
  const amount = round2(-sum(group, 'amount'));
  // The same money may already have a refund receipt made directly in the invoicing system (synced,
  // not tied to a line): tie these refund lines to it instead of issuing a second one.
  const loose = await Invoice.findOne({ property: propertyId, type: 'refund_receipt', relatedInvoiceId: source._id, status: 'issued', totalGross: amount, 'payments.folioLineId': { $exists: false }, 'coveredLineIds.0': { $exists: false } }).lean();
  if (loose) {
    await Invoice.updateOne({ _id: loose._id }, { $set: { coveredLineIds: group.map((r) => r.id) } });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'invoice.refund_receipt_linked', entityType: 'Invoice', entityId: loose._id, after: { number: loose.invoiceNumber, refundLines: group.length, amount }, ip });
    return { ...docDto(await Invoice.findById(loose._id).lean()), duplicate: false, linked: true };
  }
  const reason = clip(input.notes, 500) || `החזר כספי לאורח (קבלה ${source.invoiceNumber})`;
  const issued = await invoicerClient()
    .credit(source.external.workspace, source.external.documentId, { reason, creditAmount: fixed2(amount) }, `hotel4u:refund:${requestKey}`)
    .catch(invoicerFailure('קבלת ההחזר'));
  const { doc, created } = await saveCreditMirror({
    propertyId, source, issued, requestKey, requestPayloadHash, actor, notes: reason,
    payments: group.map((r) => ({ method: mirrorMethod(r.method), amount: round2(-r.amount), reference: r.reference || undefined, paidAt: r.postedAt, paymentDate: r.date, folioLineId: r.id, isRefund: true })),
  });
  if (!created) return duplicate(doc);
  await audit({
    property: propertyId, actor: actor.id, actorName: actor.name, action: 'invoice.refund_receipt', entityType: 'Invoice', entityId: doc._id,
    after: { issuer: 'invoicer', externalId: String(issued._id), number: doc.invoiceNumber, source: source.invoiceNumber, folioId: String(folio._id), amount, refundLines: group.length }, ip,
  });
  return { ...docDto(doc), duplicate: false };
}

// Pull back what happened in the invoicing system after issuing: credits / refunds made there and
// allocation numbers that arrived later. Only documents whose source is one of ours are mirrored.
export async function syncInvoicerDocuments(propertyId) {
  if (documentIssuer() !== 'invoicer' || !invoicerConfigured()) return { skipped: 'not_configured' };
  const client = invoicerClient();
  const w = await client.findWorkspace(propertyId);
  if (!w) return { skipped: 'not_connected' };
  const mirrors = await Invoice.find({ property: propertyId, issuer: 'invoicer' }).lean();
  if (!mirrors.length) return { added: 0, updated: 0 };
  const byExt = new Map(mirrors.map((m) => [String(m.external?.documentId), m]));
  const remote = await client.listDocuments(w._id, { status: 'issued' });
  let added = 0;
  let updated = 0;
  for (const d of remote) {
    const mine = byExt.get(String(d._id));
    if (mine) {
      if (d.allocationNumber && mine.allocationNumber !== d.allocationNumber) {
        await Invoice.updateOne({ _id: mine._id }, { $set: { allocationNumber: d.allocationNumber, allocationStatus: 'approved' } });
        updated++;
      }
      continue;
    }
    if (!['credit_note', 'refund_receipt'].includes(d.type)) continue;
    const source = byExt.get(String(d.relatedDocument));
    if (!source) continue;
    if (d.type === 'credit_note') {
      // A credit made there is a correction of the folio too: mirrored with its correction lines.
      const { recordInvoicerCredit } = await import('./fiscalCorrectionService.js');
      const r = await recordInvoicerCredit({ propertyId, source, issued: d, origin: 'invoicer' });
      if (r.created || r.posted) added++;
      byExt.set(String(d._id), { external: { documentId: String(d._id) } });
      continue;
    }
    let payments = [];
    if (d.type === 'refund_receipt') {
      // Tie it to a refund line on the folio that is not documented yet (same receipt, same amount),
      // so the desk is not offered a second refund receipt for the same money.
      const gross = legacyNumber(d.gross ?? '0');
      const folio = source.folio ? await Folio.findById(source.folio).lean() : null;
      const covered = folio ? (await docCoverage(folio._id)).payments : new Map();
      const paid = new Set((source.payments || []).map((p) => String(p.folioLineId)));
      const line = (folio?.lines || []).find((l) => l.type === 'refund' && l.status === 'posted' && paid.has(String(l.refundOf)) && !covered.has(String(l._id)) && Math.abs(Math.abs(Number(l.amount || 0)) - gross) < 0.005);
      const method = d.payments?.[0]?.method || d.paymentMethod;
      payments = [{ method: mirrorMethod(method), amount: gross, isRefund: true, folioLineId: line ? String(line._id) : undefined }];
    }
    const { created } = await saveCreditMirror({ propertyId, source, issued: d, requestKey: `invoicer:${d._id}`, actor: null, notes: d.notes, payments });
    if (created) {
      added++;
      byExt.set(String(d._id), { external: { documentId: String(d._id) } });
      await audit({ property: propertyId, actor: null, actorName: 'מערכת החשבוניות', action: d.type === 'refund_receipt' ? 'invoice.refund_receipt' : 'invoice.credit_note', entityType: 'Invoice', entityId: source._id, after: { issuer: 'invoicer', synced: true, externalId: String(d._id), number: String(d.number), source: source.invoiceNumber } });
    }
  }
  // Credit notes mirrored before the folio carried their correction lines (or whose posting did not
  // finish): post them now, so folio and documents agree.
  const unposted = mirrors.filter((m) => m.type === 'credit_note' && m.creditPurpose !== 'reissue' && !(m.coveredLineIds || []).length && m.relatedInvoiceId);
  if (unposted.length) {
    const { recordInvoicerCredit } = await import('./fiscalCorrectionService.js');
    for (const m of unposted) {
      const source = mirrors.find((x) => String(x._id) === String(m.relatedInvoiceId));
      const issued = remote.find((x) => String(x._id) === String(m.external?.documentId)) || await client.getDocument(w._id, m.external.documentId).catch(() => null);
      if (!source || !issued) continue;
      const r = await recordInvoicerCredit({ propertyId, source, issued, origin: m.creditOrigin || 'hotel4u' });
      if (r.posted) updated++;
    }
  }
  return { added, updated };
}

// Every connected property, every few minutes (scheduler).
export async function syncAllInvoicerDocuments() {
  if (documentIssuer() !== 'invoicer' || !invoicerConfigured()) return;
  const ids = await Invoice.distinct('property', { issuer: 'invoicer' });
  for (const id of ids) await syncInvoicerDocuments(String(id)).catch((err) => console.error('[invoicerSync]', String(id), err.message));
}

async function loadDoc(propertyId, id) {
  if (!isId(String(id || ''))) throw httpError('מזהה מסמך לא תקין', 400);
  const doc = await Invoice.findOne({ _id: id, property: propertyId });
  if (!doc) throw httpError('המסמך לא נמצא', 404);
  return doc;
}

const allocState = (d) => d.allocationStatus && d.allocationStatus !== 'not_required' ? d.allocationStatus : (d.status === 'pending_allocation' ? 'pending' : d.allocationStatus || 'not_required');

// FIN-10: enter the number the Tax Authority returned (9 digits), or record a refusal.
export async function setAllocation({ propertyId, id, input, actor, ip }) {
  if (!ALLOCATION_ROLES.includes(actor.role)) throw httpError('עדכון מספר הקצאה מותר לכספים או להנהלה', 403);
  const doc = await loadDoc(propertyId, id);
  if (doc.issuer === 'invoicer') throw httpError('מספר ההקצאה של מסמך זה מנוהל במערכת החשבוניות', 409, { code: 'managed_by_invoicer' });
  const state = allocState(doc);
  if (!['pending', 'rejected'].includes(state)) throw httpError(state === 'approved' ? `למסמך כבר יש מספר הקצאה ${doc.allocationNumber}` : 'המסמך אינו דורש מספר הקצאה', 409);
  if (input.retry) {
    // Ask the service again (after a technical failure, a data fix or a hearing that allowed the invoice).
    const out = await requestAllocation({ invoiceId: doc._id, actor });
    if (out.outcome === 'manual') throw httpError('הנכס לא מחובר לרשות המסים — הזינו את המספר ידנית', 409);
    if (out.outcome === 'not_connected') throw httpError('אין חיבור פעיל לרשות המסים — התחברו מחדש בהגדרות', 409);
    return docDto(await Invoice.findById(doc._id).lean());
  }
  if (input.decision) {
    // §2.2.2: a held invoice — the business chooses how to continue, and the Tax Authority is told.
    if (state !== 'rejected') throw httpError('החלטה נדרשת רק לחשבונית שלא אושרה', 409);
    if (!['cancel', 'continue', 'hearing'].includes(input.decision)) throw httpError('החלטה לא מוכרת', 422);
    const sent = await sendDecision({ doc, decision: input.decision, actor });
    await Invoice.updateOne({ _id: doc._id }, { $set: { allocationDecision: input.decision, allocationDecidedAt: new Date(), allocationDecisionSent: sent.sent, allocationBy: actor.id || undefined } });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'invoice.allocation_decision', entityType: 'Invoice', entityId: doc._id, after: { number: doc.invoiceNumber, decision: input.decision, sent: sent.sent, reason: sent.reason || null }, ip });
    return docDto(await Invoice.findById(doc._id).lean());
  }
  if (input.rejected) {
    const why = clip(input.reason, 300);
    if (why.length < 3) throw httpError('יש לפרט את סיבת הסירוב', 422, { fields: { reason: 'סיבה' } });
    await Invoice.updateOne({ _id: doc._id }, { $set: { allocationStatus: 'rejected', allocationRejectReason: why, allocationBy: actor.id || undefined } });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'invoice.allocation_rejected', entityType: 'Invoice', entityId: doc._id, reason: why, after: { number: doc.invoiceNumber }, ip });
  } else {
    const num = digits(input.allocationNumber);
    if (!/^\d{9}$/.test(num)) throw httpError('מספר הקצאה הוא 9 ספרות', 422, { fields: { allocationNumber: '9 ספרות' } });
    const taken = await Invoice.findOne({ property: propertyId, allocationNumber: num, _id: { $ne: doc._id } }).select('invoiceNumber type').lean();
    if (taken) throw httpError(`מספר ההקצאה כבר רשום על ${INVOICE_TYPE_LABELS[taken.type] || ''} ${taken.invoiceNumber}`, 409, { fields: { allocationNumber: 'כבר בשימוש' } });
    await Invoice.updateOne({ _id: doc._id }, { $set: { allocationNumber: num, allocationStatus: 'approved', allocationReceivedAt: new Date(), allocationBy: actor.id || undefined, status: 'issued', allocationRejectReason: null } });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'invoice.allocation_set', entityType: 'Invoice', entityId: doc._id, after: { number: doc.invoiceNumber, allocationNumber: num }, ip });
  }
  return docDto(await Invoice.findById(doc._id).lean());
}

// FIN-10 / document list.
export async function listDocuments({ propertyId, view = 'all', q, type, from, to, page = 1, pageSize = 50 }) {
  const filter = { property: propertyId, status: { $ne: 'draft' } };
  if (view === 'pending') filter.$or = [{ allocationStatus: 'pending' }, { status: 'pending_allocation' }];
  if (view === 'rejected') filter.allocationStatus = 'rejected';
  if (type && ISSUE_TYPES.concat(['credit_note', 'debit_note']).includes(type)) filter.type = type;
  if (from || to) {
    filter.issueDate = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) filter.issueDate.$gte = from;
    if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) filter.issueDate.$lte = to;
  }
  if (q) {
    const term = clip(q, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(term, 'i');
    const res = await Reservation.find({ property: propertyId, confirmationNumber: rx }).select('_id').limit(200).lean();
    const or = [{ invoiceNumber: rx }, { 'buyer.name': rx }, { 'buyer.vatNumber': rx }, { allocationNumber: rx }, { reservation: { $in: res.map((r) => r._id) } }];
    if (filter.$or) { filter.$and = [{ $or: filter.$or }, { $or: or }]; delete filter.$or; } else filter.$or = or;
  }
  const size = Math.min(100, Math.max(10, Number(pageSize) || 50));
  const [total, pending, rejected] = await Promise.all([
    Invoice.countDocuments(filter),
    Invoice.countDocuments({ property: propertyId, $or: [{ allocationStatus: 'pending' }, { status: 'pending_allocation' }] }),
    Invoice.countDocuments({ property: propertyId, allocationStatus: 'rejected' }),
  ]);
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(pages, Math.max(1, Number(page) || 1));
  const docs = await Invoice.find(filter).sort({ issueDate: -1, createdAt: -1 }).skip((p - 1) * size).limit(size)
    .populate('reservation', 'confirmationNumber').lean();
  return {
    counts: { pending, rejected },
    total, page: p, pages, pageSize: size,
    rows: docs.map((d) => ({ ...docDto(d), confirmationNumber: d.reservation?.confirmationNumber || null })),
  };
}

// FIN-06-A04 print: the first print of a final document is the original, later ones are copies.
// While an allocation number is pending (or refused) the print is a marked copy and does not use up
// the original.
export async function printDocument({ propertyId, id }) {
  const doc = await loadDoc(propertyId, id);
  if (doc.issuer === 'invoicer') {
    // The original belongs to the invoicing system; here it is only a reference copy.
    const full = await Invoice.findById(doc._id).populate('reservation', 'confirmationNumber arrivalDate departureDate').lean();
    return renderInvoiceHtml(full, { mark: doc.external?.environment === 'live' ? 'external' : 'external_sandbox' });
  }
  const state = allocState(doc);
  // A held invoice the business chose to continue without a number is final — it is printed with
  // the mandated "do not deduct input tax" sentence (template), not as a reference copy.
  const blocked = state === 'pending' || (state === 'rejected' && doc.allocationDecision !== 'continue');
  let mark;
  if (blocked) mark = state === 'pending' ? 'pending' : 'rejected';
  else {
    const after = await Invoice.findOneAndUpdate({ _id: doc._id }, { $inc: { printCount: 1 } }, { returnDocument: 'after' }).select('printCount').lean();
    mark = after.printCount <= 1 ? 'original' : 'copy';
  }
  const full = await Invoice.findById(doc._id).populate('relatedInvoiceId', 'invoiceNumber type issueDate').populate('reservation', 'confirmationNumber arrivalDate departureDate').lean();
  return renderInvoiceHtml(full, { mark });
}


// ── Sending a document by e-mail (GST-04) ───────────────────────────────────
// The e-mail carries a copy marked as such; the original is the record kept in the system (a digital
// original needs a secure electronic signature, which is not part of this build).
export async function sendDocument({ propertyId, id, to, actor, ip }) {
  const email = clip(to, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError('כתובת דוא״ל לא תקינה', 422, { fields: { to: 'דוא״ל' } });
  const doc = await loadDoc(propertyId, id);
  if (doc.issuer === 'invoicer') throw httpError('שליחת המסמך ללקוח נעשית ממערכת החשבוניות', 409, { code: 'managed_by_invoicer' });
  const full = await Invoice.findById(doc._id).populate('relatedInvoiceId', 'invoiceNumber type issueDate').populate('reservation', 'confirmationNumber arrivalDate departureDate').lean();
  const property = await Property.findById(propertyId).select('name email fiscal').lean();
  const html = renderInvoiceHtml(full, { mark: 'email' });
  const label = `${INVOICE_TYPE_LABELS[doc.type] || 'מסמך'} ${doc.invoiceNumber}`;
  const info = await sendEmail({
    to: email,
    subject: `${label} — ${property?.name || ''}`.trim(),
    html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px">שלום,<br><br>מצורף ${label}${full.reservation?.confirmationNumber ? ` עבור הזמנה ${full.reservation.confirmationNumber}` : ''}.<br>המסמך המצורף הוא העתק; המקור נשמר במערכת העסק.<br><br>${property?.name || ''}</div>`,
    replyTo: property?.fiscal?.emailFrom || property?.email || undefined,
    attachments: [{ filename: `${label.replace(/[^\p{L}\p{N} _-]/gu, '')}.html`, content: html, contentType: 'text/html; charset=utf-8' }],
  });
  if (!info) throw httpError('שליחת דוא״ל אינה מוגדרת בשרת (EMAIL_USER / EMAIL_PASS)', 409, { code: 'email_not_configured' });
  await Invoice.updateOne({ _id: doc._id }, { $push: { sentLog: { to: email, at: new Date(), by: actor.name || null } } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'invoice.sent', entityType: 'Invoice', entityId: doc._id, after: { number: doc.invoiceNumber, to: email.replace(/(^.).*(@.*$)/, '$1***$2') }, ip });
  return docDto(await Invoice.findById(doc._id).lean());
}

// ── Document series (FIN-06): where each series stands; the first number can be set only before
// the first document of that type (continuing the numbering of the software used before).
export const SERIES_TYPES = ['tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_note', 'proforma'];
export const SERIES_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];

export async function listSeries({ propertyId }) {
  const p = await Property.findById(propertyId).select('docSequences').lean();
  const counts = await Invoice.aggregate([
    { $match: { property: new mongoose.Types.ObjectId(String(propertyId)), type: { $in: SERIES_TYPES } } },
    { $group: { _id: '$type', count: { $sum: 1 }, first: { $min: '$seq' }, last: { $max: '$seq' } } },
  ]);
  const by = new Map(counts.map((c) => [c._id, c]));
  return SERIES_TYPES.map((t) => {
    const c = by.get(t);
    return { type: t, label: INVOICE_TYPE_LABELS[t], count: c?.count || 0, first: c?.first ?? null, last: c?.last ?? null, next: Number(p?.docSequences?.[t] || 0) + 1, editable: !c };
  });
}

export async function setSeriesStart({ propertyId, type, next, actor, ip }) {
  if (!SERIES_ROLES.includes(actor.role)) throw httpError('קביעת מספור מותרת להנהלה ולכספים', 403);
  if (!SERIES_TYPES.includes(type)) throw httpError('סוג מסמך לא מוכר', 422);
  const n = Number(next);
  if (!Number.isInteger(n) || n < 1 || n > 999999999) throw httpError('מספר התחלתי — מספר שלם חיובי', 422, { fields: { next: 'מספר' } });
  const exists = await Invoice.exists({ property: propertyId, type });
  if (exists) throw httpError('כבר הופקו מסמכים מסוג זה — הסדרה רציפה ולא ניתן לשנות את המספור', 409);
  await Property.updateOne({ _id: propertyId }, { $set: { [`docSequences.${type}`]: n - 1 } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'fiscal.series_start', entityType: 'Property', entityId: propertyId, after: { type, next: n }, ip });
  return listSeries({ propertyId });
}
