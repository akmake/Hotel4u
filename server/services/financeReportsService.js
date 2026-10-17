// Fiscal & cash reports (FIN-11 / FIN-12): everything the accountant and the auditor ask for, built
// from the documents and the folios — never from typed totals.
//   journal       — every document in a period, per-type count and total (open-format §2.6 printout),
//                   and series integrity (gaps / duplicates in each running series)
//   vat           — sales VAT by document: standard / zero-rated / exempt, credit notes negative, and
//                   the business-customer list with the 9-digit allocation number (detailed-report data)
//   receipts      — money taken by method (cash, card by brand/installments, transfers, cheques by
//                   due date, vouchers), refunds, and whether each has a receipt
//   undocumented  — charges with no tax invoice / payments with no receipt (legal exposure list)
//   allocations   — documents by allocation state with their amounts
//   cash          — expected cash per cashier per day and the drawer close (counted / variance)
//   workbook      — all of the above as an Excel workbook for the accountant
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import Invoice, { INVOICE_TYPE_LABELS } from '../models/Invoice.js';
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import ChargeCode from '../models/ChargeCode.js';
import User from '../models/User.js';
import Property from '../models/Property.js';
import CashierClose from '../models/CashierClose.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf, MANAGER_ROLES } from './frontDeskService.js';
import { undocumentedByFolio } from './documentService.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const SERIES = ['tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_note', 'proforma'];
const METHOD_LABELS = { cash: 'מזומן', credit_card: 'כרטיס אשראי', bank_transfer: 'העברה בנקאית', cheque: 'שיק', check: 'שיק', voucher: 'שובר', other: 'אחר' };
const ALLOC_LABELS = { not_required: 'לא נדרש', pending: 'ממתין', approved: 'אושר', rejected: 'לא אושר' };

function range(from, to, fallbackDays = 30, property) {
  const today = businessDateOf(property);
  const t = YMD.test(to || '') ? to : today;
  let f = from;
  if (!YMD.test(f || '')) { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - fallbackDays + 1); f = d.toISOString().slice(0, 10); }
  if (f > t) throw httpError('תאריך ההתחלה אחרי תאריך הסיום', 422);
  return { from: f, to: t };
}

async function prop(propertyId) {
  const p = await Property.findById(propertyId).select('name legalName taxNumber timezone vatRate').lean();
  if (!p) throw httpError('הנכס לא נמצא', 404);
  return p;
}

const allocState = (d) => d.allocationStatus || (d.status === 'pending_allocation' ? 'pending' : d.allocationNumber ? 'approved' : 'not_required');
const signed = (d, v) => (d.type === 'credit_note' ? -Math.abs(Number(v || 0)) : Number(v || 0));

// ── journal + series integrity ──────────────────────────────────────────────
export async function journal({ propertyId, from, to, type }) {
  const p = await prop(propertyId);
  const r = range(from, to, 30, p);
  const filter = { property: propertyId, issueDate: { $gte: r.from, $lte: r.to }, status: { $ne: 'draft' } };
  if (type && SERIES.includes(type)) filter.type = type;
  const docs = await Invoice.find(filter).sort({ issueDate: 1, type: 1, seq: 1 }).populate('reservation', 'confirmationNumber').lean();
  const rows = docs.map((d) => ({
    id: String(d._id), type: d.type, typeLabel: INVOICE_TYPE_LABELS[d.type], number: d.invoiceNumber, issueDate: d.issueDate,
    buyer: d.buyer?.name || '', buyerVat: d.buyer?.vatNumber || '', confirmationNumber: d.reservation?.confirmationNumber || '',
    net: round2(signed(d, d.totalNet)), vat: round2(signed(d, d.totalVat)), gross: round2(d.type === 'receipt' ? 0 : signed(d, d.totalGross)),
    paid: round2(d.amountPaid || 0), allocation: allocState(d), allocationNumber: d.allocationNumber || '',
  }));
  const perType = SERIES.map((t) => {
    const of = rows.filter((x) => x.type === t);
    return { type: t, label: INVOICE_TYPE_LABELS[t], count: of.length, total: round2(of.reduce((s, x) => s + (t === 'receipt' ? x.paid : x.gross), 0)) };
  });
  // Series integrity runs over the whole series (a gap is a gap whatever the period).
  const all = await Invoice.aggregate([
    { $match: { property: oid(propertyId), type: { $in: SERIES }, seq: { $type: 'number' } } },
    { $group: { _id: '$type', seqs: { $push: '$seq' } } },
  ]);
  const series = all.map((g) => {
    const seqs = [...g.seqs].sort((a, b) => a - b);
    const dup = seqs.filter((v, i) => i && v === seqs[i - 1]);
    const set = new Set(seqs);
    const gaps = [];
    for (let n = seqs[0]; n <= seqs[seqs.length - 1] && gaps.length < 50; n += 1) if (!set.has(n)) gaps.push(n);
    return { type: g._id, label: INVOICE_TYPE_LABELS[g._id], first: seqs[0], last: seqs[seqs.length - 1], count: seqs.length, gaps, duplicates: [...new Set(dup)], ok: !gaps.length && !dup.length };
  });
  return { ...r, rows, perType, series, business: { name: p.legalName || p.name, vatNumber: p.taxNumber || '' } };
}

// ── VAT (sales side) ────────────────────────────────────────────────────────
export async function vatReport({ propertyId, from, to }) {
  const p = await prop(propertyId);
  const r = range(from, to, 31, p);
  const docs = await Invoice.find({ property: propertyId, issueDate: { $gte: r.from, $lte: r.to }, status: 'issued', type: { $in: ['tax_invoice', 'tax_invoice_receipt', 'credit_note'] } })
    .sort({ issueDate: 1, seq: 1 }).lean();
  const codes = new Map((await ChargeCode.find({ property: propertyId }).select('code vatClass').lean()).map((c) => [c.code, c.vatClass]));
  const rows = docs.map((d) => {
    let standard = 0; let zero = 0; let exempt = 0;
    for (const l of d.lines || []) {
      const net = signed(d, l.netAmount);
      if (Number(l.vatRate) > 0) standard += net;
      else if (codes.get(l.department) === 'exempt') exempt += net;
      else zero += net;
    }
    return {
      id: String(d._id), type: d.type, typeLabel: INVOICE_TYPE_LABELS[d.type], number: d.invoiceNumber, issueDate: d.issueDate,
      buyer: d.buyer?.name || '', buyerVat: d.buyer?.vatNumber || '',
      standard: round2(standard), zero: round2(zero), exempt: round2(exempt), vat: round2(signed(d, d.totalVat)), gross: round2(signed(d, d.totalGross)),
      allocationNumber: d.allocationNumber || '', allocation: allocState(d),
    };
  });
  const tot = (k) => round2(rows.reduce((s, x) => s + x[k], 0));
  const rates = new Map();
  for (const d of docs) for (const l of d.lines || []) {
    if (!(Number(l.vatRate) > 0)) continue;
    const k = Number(l.vatRate);
    const cur = rates.get(k) || { rate: k, net: 0, vat: 0 };
    cur.net = round2(cur.net + signed(d, l.netAmount)); cur.vat = round2(cur.vat + signed(d, l.vatAmount));
    rates.set(k, cur);
  }
  return {
    ...r,
    summary: { standard: tot('standard'), zero: tot('zero'), exempt: tot('exempt'), vat: tot('vat'), gross: tot('gross'), documents: rows.length, credits: rows.filter((x) => x.type === 'credit_note').length },
    byRate: [...rates.values()].sort((a, b) => a.rate - b.rate),
    rows,
    business: rows.filter((x) => x.buyerVat),
    note: 'דוח עסקאות (צד המכירות) מתוך המסמכים שהופקו במערכת. תשומות ודיווח PCN874 מופקים בהנהלת החשבונות.',
  };
}

// ── receipts by method ──────────────────────────────────────────────────────
export async function receiptsReport({ propertyId, from, to }) {
  const p = await prop(propertyId);
  const r = range(from, to, 30, p);
  const folios = await Folio.find({ property: propertyId, lines: { $elemMatch: { serviceDate: { $gte: r.from, $lte: r.to }, type: { $in: ['payment', 'deposit', 'refund'] }, status: 'posted' } } })
    .select('reservation lines').lean();
  const docs = await Invoice.find({ folio: { $in: folios.map((f) => f._id) }, type: { $in: ['receipt', 'tax_invoice_receipt'] } }).select('invoiceNumber type payments.folioLineId payments.nettedLineIds').lean();
  const onDoc = new Map();
  for (const d of docs) for (const x of d.payments || []) {
    if (x.folioLineId) onDoc.set(String(x.folioLineId), `${INVOICE_TYPE_LABELS[d.type]} ${d.invoiceNumber}`);
    for (const n of x.nettedLineIds || []) onDoc.set(String(n), `${INVOICE_TYPE_LABELS[d.type]} ${d.invoiceNumber} (נוכה)`);
  }
  const res = new Map((await Reservation.find({ _id: { $in: folios.map((f) => f.reservation) } }).select('confirmationNumber primaryGuest').populate('primaryGuest', 'firstName lastName').lean()).map((x) => [String(x._id), x]));
  const users = new Map((await User.find({ property: propertyId }).select('firstName lastName').lean()).map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim()]));
  const rows = [];
  for (const f of folios) {
    const rv = res.get(String(f.reservation));
    for (const l of f.lines) {
      if (l.status !== 'posted' || !['payment', 'deposit', 'refund'].includes(l.type) || l.serviceDate < r.from || l.serviceDate > r.to) continue;
      const amount = round2(l.type === 'refund' ? -Math.abs(l.amount) : Math.abs(l.amount));
      rows.push({
        id: String(l._id), date: l.serviceDate, kind: l.type, method: l.method || 'other', methodLabel: METHOD_LABELS[l.method] || l.method || 'אחר', amount,
        reference: l.methodRef || '', details: l.payDetails || null,
        confirmationNumber: rv?.confirmationNumber || '', guest: rv?.primaryGuest ? `${rv.primaryGuest.firstName || ''} ${rv.primaryGuest.lastName || ''}`.trim() : '',
        by: users.get(String(l.createdBy)) || '', document: onDoc.get(String(l._id)) || null,
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const byMethod = Object.keys(METHOD_LABELS).filter((m) => m !== 'check').map((m) => {
    const of = rows.filter((x) => x.method === m);
    return { method: m, label: METHOD_LABELS[m], count: of.length, received: round2(of.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0)), refunded: round2(-of.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0)), net: round2(of.reduce((s, x) => s + x.amount, 0)) };
  }).filter((x) => x.count);
  const cards = new Map();
  for (const x of rows.filter((y) => y.method === 'credit_card')) {
    const k = `${x.details?.cardBrand || 'לא צוין'}|${x.details?.installments > 1 ? 'תשלומים' : 'רגיל'}`;
    const cur = cards.get(k) || { brand: x.details?.cardBrand || 'לא צוין', plan: x.details?.installments > 1 ? 'תשלומים' : 'רגיל', count: 0, amount: 0 };
    cur.count += 1; cur.amount = round2(cur.amount + x.amount);
    cards.set(k, cur);
  }
  return {
    ...r, rows, byMethod, cards: [...cards.values()],
    cheques: rows.filter((x) => x.method === 'cheque' && x.amount > 0).map((x) => ({ ...x, dueDate: x.details?.dueDate || null, bank: x.details?.bank || '', branch: x.details?.branch || '', account: x.details?.account || '' })).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
    total: round2(rows.reduce((s, x) => s + x.amount, 0)),
    withoutReceipt: rows.filter((x) => !x.document).length,
  };
}

// ── undocumented (legal exposure) ───────────────────────────────────────────
export async function undocumentedReport({ propertyId, from, to }) {
  const p = await prop(propertyId);
  const r = range(from, to, 90, p);
  const folios = await Folio.find({ property: propertyId, 'lines.serviceDate': { $gte: r.from, $lte: r.to } }).select('reservation ownerType lines status').lean();
  const und = await undocumentedByFolio(folios, p.vatRate ?? 18);
  const list = folios.map((f) => ({ f, u: und.get(String(f._id)) })).filter((x) => x.u && (Math.abs(x.u.charges) > 0.005 || Math.abs(x.u.payments) > 0.005));
  const res = new Map((await Reservation.find({ _id: { $in: list.map((x) => x.f.reservation) } }).select('confirmationNumber status departureDate primaryGuest').populate('primaryGuest', 'firstName lastName').lean()).map((x) => [String(x._id), x]));
  const today = businessDateOf(p);
  const rows = list.map(({ f, u }) => {
    const rv = res.get(String(f.reservation));
    const departed = rv?.status === 'checked_out';
    return {
      folioId: String(f._id), reservationId: String(f.reservation), confirmationNumber: rv?.confirmationNumber || '', status: rv?.status || '',
      guest: rv?.primaryGuest ? `${rv.primaryGuest.firstName || ''} ${rv.primaryGuest.lastName || ''}`.trim() : '', departureDate: rv?.departureDate || null,
      charges: round2(u.charges), payments: round2(u.payments), oldest: u.oldest,
      ageDays: u.oldest ? Math.round((Date.parse(today) - Date.parse(u.oldest)) / 86400000) : 0,
      severity: departed && u.charges > 0.005 ? 'high' : departed ? 'medium' : 'low',
    };
  }).sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || b.ageDays - a.ageDays);
  return {
    ...r, rows,
    totals: { charges: round2(rows.reduce((s, x) => s + x.charges, 0)), payments: round2(rows.reduce((s, x) => s + x.payments, 0)), departedWithCharges: rows.filter((x) => x.severity === 'high').length },
  };
}

// ── allocations ─────────────────────────────────────────────────────────────
export async function allocationsReport({ propertyId, from, to }) {
  const p = await prop(propertyId);
  const r = range(from, to, 90, p);
  const docs = await Invoice.find({ property: propertyId, issueDate: { $gte: r.from, $lte: r.to }, type: { $in: ['tax_invoice', 'tax_invoice_receipt'] }, $or: [{ requiresAllocation: true }, { allocationStatus: { $in: ['pending', 'approved', 'rejected'] } }] })
    .sort({ issueDate: 1, seq: 1 }).lean();
  const rows = docs.map((d) => ({
    id: String(d._id), type: d.type, typeLabel: INVOICE_TYPE_LABELS[d.type], number: d.invoiceNumber, issueDate: d.issueDate, buyer: d.buyer?.name || '', buyerVat: d.buyer?.vatNumber || '',
    net: round2(d.totalNet), vat: round2(d.totalVat), state: allocState(d), stateLabel: ALLOC_LABELS[allocState(d)], number9: d.allocationNumber || '', source: d.allocationSource || '',
    decision: d.allocationDecision || '', reason: d.allocationRejectReason || d.allocationLastError || '',
  }));
  const by = (s) => rows.filter((x) => x.state === s);
  return { ...r, rows, counts: { pending: by('pending').length, approved: by('approved').length, rejected: by('rejected').length }, vatAtRisk: round2([...by('pending'), ...by('rejected')].reduce((s, x) => s + x.vat, 0)) };
}

// ── cash drawer per cashier ─────────────────────────────────────────────────
async function cashLines(propertyId, date) {
  const folios = await Folio.find({ property: propertyId, lines: { $elemMatch: { serviceDate: date, method: 'cash', status: 'posted' } } }).select('lines').lean();
  const out = [];
  for (const f of folios) for (const l of f.lines) {
    if (l.serviceDate !== date || l.method !== 'cash' || l.status !== 'posted' || !['payment', 'deposit', 'refund'].includes(l.type)) continue;
    out.push({ user: l.createdBy ? String(l.createdBy) : null, amount: round2(l.type === 'refund' ? -Math.abs(l.amount) : Math.abs(l.amount)) });
  }
  return out;
}

export async function cashDay({ propertyId, date }) {
  const p = await prop(propertyId);
  const day = YMD.test(date || '') ? date : businessDateOf(p);
  const lines = await cashLines(propertyId, day);
  const users = new Map((await User.find({ property: propertyId }).select('firstName lastName role').lean()).map((u) => [String(u._id), u]));
  const closes = await CashierClose.find({ property: propertyId, businessDate: day }).sort({ createdAt: 1 }).lean();
  const ids = new Set([...lines.map((l) => l.user).filter(Boolean), ...closes.map((c) => String(c.user))]);
  const rows = [...ids].map((uid) => {
    const of = lines.filter((l) => l.user === uid);
    const expected = round2(of.reduce((s, l) => s + l.amount, 0));
    const close = closes.filter((c) => String(c.user) === uid && c.active).slice(-1)[0] || null;
    const u = users.get(uid);
    return {
      userId: uid, name: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : 'משתמש', expected, lines: of.length,
      close: close ? { id: String(close._id), counted: close.counted, variance: close.variance, expectedAtClose: close.expected, note: close.note || null, by: close.closedByName, at: close.createdAt, stale: Math.abs(close.expected - expected) > 0.005 } : null,
      history: closes.filter((c) => String(c.user) === uid).map((c) => ({ id: String(c._id), counted: c.counted, variance: c.variance, active: c.active, note: c.note || null, by: c.closedByName, at: c.createdAt })),
    };
  });
  const unattributed = round2(lines.filter((l) => !l.user).reduce((s, l) => s + l.amount, 0));
  return { date: day, rows, unattributed, total: round2(lines.reduce((s, l) => s + l.amount, 0)), counted: round2(rows.reduce((s, x) => s + (x.close?.counted || 0), 0)), variance: round2(rows.reduce((s, x) => s + (x.close?.variance || 0), 0)) };
}

export async function closeCash({ propertyId, date, userId, counted, note, actor, ip }) {
  const p = await prop(propertyId);
  const day = YMD.test(date || '') ? date : businessDateOf(p);
  const target = userId || actor.id;
  const isManager = [...MANAGER_ROLES, 'finance_manager'].includes(actor.role);
  if (String(target) !== String(actor.id) && !isManager) throw httpError('סגירת קופה של עובד אחר — למנהל או לכספים', 403);
  const c = Number(counted);
  if (!Number.isFinite(c) || c < 0) throw httpError('יש להזין את הסכום שנספר', 422, { fields: { counted: 'סכום' } });
  const lines = (await cashLines(propertyId, day)).filter((l) => l.user === String(target));
  const expected = round2(lines.reduce((s, l) => s + l.amount, 0));
  const variance = round2(c - expected);
  const why = String(note || '').trim().slice(0, 300);
  const prev = await CashierClose.findOne({ property: propertyId, businessDate: day, user: target, active: true });
  if (prev && why.length < 3) throw httpError('הקופה כבר נסגרה — סגירה מתקנת מחייבת סיבה', 422, { fields: { note: 'סיבה' } });
  if (Math.abs(variance) > 0.005 && why.length < 3) throw httpError(`יש הפרש של ${variance.toFixed(2)} — נדרש הסבר`, 422, { fields: { note: 'הסבר להפרש' } });
  const u = await User.findById(target).select('firstName lastName').lean();
  const row = await CashierClose.create({
    property: propertyId, businessDate: day, user: target, userName: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : undefined,
    expected, counted: round2(c), variance, receipts: lines.length, note: why || undefined, closedBy: actor.id || undefined, closedByName: actor.name, supersedes: prev?._id,
  });
  if (prev) await CashierClose.updateOne({ _id: prev._id }, { $set: { active: false } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: prev ? 'cash.close_corrected' : 'cash.closed', entityType: 'CashierClose', entityId: row._id, after: { date: day, user: String(target), expected, counted: round2(c), variance }, reason: why || undefined, ip });
  return cashDay({ propertyId, date: day });
}

// ── accountant workbook ─────────────────────────────────────────────────────
export async function accountantWorkbook({ propertyId, from, to }) {
  const [j, v, rc, al, und] = await Promise.all([
    journal({ propertyId, from, to }), vatReport({ propertyId, from, to }), receiptsReport({ propertyId, from, to }),
    allocationsReport({ propertyId, from, to }), undocumentedReport({ propertyId, from, to }),
  ]);
  const docs = await Invoice.find({ property: propertyId, issueDate: { $gte: j.from, $lte: j.to }, status: { $ne: 'draft' } }).sort({ issueDate: 1, type: 1, seq: 1 }).lean();
  const wb = XLSX.utils.book_new();
  const sheet = (name, rows) => { const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'אין נתונים' }]); ws['!views'] = [{ RTL: true }]; XLSX.utils.book_append_sheet(wb, ws, name); };
  sheet('מסמכים', j.rows.map((x) => ({ 'סוג': x.typeLabel, 'מספר': x.number, 'תאריך': x.issueDate, 'נמען': x.buyer, 'ע.מ. נמען': x.buyerVat, 'הזמנה': x.confirmationNumber, 'לפני מע"מ': x.net, 'מע"מ': x.vat, 'כולל מע"מ': x.gross, 'התקבל': x.paid, 'מספר הקצאה': x.allocationNumber })));
  const lines = [];
  for (const d of docs) for (const l of d.lines || []) lines.push({ 'סוג': INVOICE_TYPE_LABELS[d.type], 'מספר': d.invoiceNumber, 'תאריך': d.issueDate, 'תיאור': l.description, 'קוד': l.department || '', 'מועד שירות': l.serviceDate || '', 'לפני מע"מ': signed(d, l.netAmount), 'שיעור מע"מ': l.vatRate, 'מע"מ': signed(d, l.vatAmount), 'סה"כ': signed(d, l.grossAmount) });
  sheet('שורות', lines);
  sheet('תקבולים', rc.rows.map((x) => ({ 'תאריך': x.date, 'סוג': x.kind === 'refund' ? 'החזר' : x.kind === 'deposit' ? 'מקדמה' : 'תשלום', 'אמצעי': x.methodLabel, 'סכום': x.amount, 'אסמכתה': x.reference, '4 ספרות': x.details?.last4 || '', 'תשלומים': x.details?.installments || '', 'בנק': x.details?.bank || '', 'סניף': x.details?.branch || '', 'חשבון': x.details?.account || '', 'פירעון': x.details?.dueDate || '', 'הזמנה': x.confirmationNumber, 'אורח': x.guest, 'מסמך': x.document || 'ללא קבלה' })));
  sheet('מע"מ', [...v.rows.map((x) => ({ 'סוג': x.typeLabel, 'מספר': x.number, 'תאריך': x.issueDate, 'נמען': x.buyer, 'ע.מ.': x.buyerVat, 'חייב': x.standard, 'שיעור אפס': x.zero, 'פטור': x.exempt, 'מע"מ': x.vat, 'מספר הקצאה': x.allocationNumber })), { 'סוג': 'סה"כ', 'חייב': v.summary.standard, 'שיעור אפס': v.summary.zero, 'פטור': v.summary.exempt, 'מע"מ': v.summary.vat }]);
  sheet('הקצאות', al.rows.map((x) => ({ 'מספר': x.number, 'תאריך': x.issueDate, 'נמען': x.buyer, 'ע.מ.': x.buyerVat, 'לפני מע"מ': x.net, 'מע"מ': x.vat, 'מצב': x.stateLabel, 'מספר הקצאה': x.number9, 'החלטה': x.decision, 'סיבה': x.reason })));
  sheet('ללא מסמך', und.rows.map((x) => ({ 'הזמנה': x.confirmationNumber, 'אורח': x.guest, 'סטטוס': x.status, 'חיובים בלי חשבונית': x.charges, 'תקבולים בלי קבלה': x.payments, 'הוותיק': x.oldest, 'ימים': x.ageDays })));
  sheet('רציפות', j.series.map((x) => ({ 'סדרה': x.label, 'ראשון': x.first, 'אחרון': x.last, 'מסמכים': x.count, 'חסרים': x.gaps.join(', '), 'כפולים': x.duplicates.join(', '), 'תקין': x.ok ? 'כן' : 'לא' })));
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buffer, fileName: `accounting_${j.from}_${j.to}.xlsx` };
}
