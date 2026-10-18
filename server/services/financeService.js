// Money core (spec W08/W09: FIN-01 folio, FIN-02 charge & reversal, FIN-03 payment/deposit,
// FIN-04 refund, FIN-07 credit note, FIN-12 day close).
//
// Rules enforced here (server-side):
//  - lines are never deleted or edited: a correction is a new line (reversal / refund / credit note);
//  - every write carries a client operation key, so a retry never posts twice;
//  - a charge entered as the guest price has its VAT extracted (T22);
//  - a charge already on an issued document is corrected by a credit note, not reversed (T18);
//  - a refund is tied to the payment it returns and capped cumulatively (T16); above the property
//    threshold only a manager/finance role may refund (T36);
//  - day close runs once per business day, in order, and resumes from the failed step without
//    posting a night twice (T33).
import mongoose from 'mongoose';
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import Invoice, { CHARGE_DOC_TYPES } from '../models/Invoice.js';
import Company from '../models/Company.js';
import GuestProfile from '../models/GuestProfile.js';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import ReservationRoom from '../models/ReservationRoom.js';
import ArrivalQueueEntry from '../models/ArrivalQueueEntry.js';
import DayCloseRun, { DAY_CLOSE_STEPS } from '../models/DayCloseRun.js';
import { audit } from './auditService.js';
import { httpError, loadProperty, businessDateOf, IN_HOUSE_STATUSES, MANAGER_ROLES } from './frontDeskService.js';
import { folioBalance } from './departureService.js';
import { planNights, postNightsUntil } from './roomCharges.js';
import { markNoShow } from './reservationService.js';
import { issueCreditNote } from './invoiceService.js';
import { docCoverage, docDto } from './documentService.js';
import { raiseWork } from './platformService.js';
import { resolveChargeCode, resolvePaymentMethod, taxFor } from './chargeCodeService.js';
import { computeLedger, ledgerChecks, storedFrom } from './ledgerService.js';
import { vatForLine, cashAllowance } from './touristService.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const FINANCE_ROLES = ['finance_manager'];
export const REFUND_ROLES = [...new Set([...MANAGER_ROLES, 'finance_manager', 'chain_admin'])];
export const REVERSE_ROLES = REFUND_ROLES;
export const CREDIT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
export const NIGHT_ROLES = [...new Set([...MANAGER_ROLES, 'finance_manager'])];
export const PAY_METHODS = ['cash', 'credit_card', 'bank_transfer', 'cheque', 'voucher'];
export const METHOD_LABELS = { cash: 'מזומן', credit_card: 'כרטיס אשראי (מסוף חיצוני)', bank_transfer: 'העברה בנקאית', cheque: 'שיק', voucher: 'שובר' };
export const CHARGE_DEPARTMENTS = ['minibar', 'f_and_b', 'spa', 'parking', 'laundry', 'telephone', 'damage', 'other'];
export const REFUND_REASONS = { cancellation: 'ביטול', overpayment: 'תשלום עודף', complaint: 'תלונה', other: 'אחר' };
const ACTIVE_STAY = [...IN_HOUSE_STATUSES, 'confirmed', 'modified', 'pending_payment', 'checked_out'];

export const CARD_BRANDS = ['visa', 'mastercard', 'isracard', 'amex', 'diners', 'other'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const digits = (v) => String(v ?? '').replace(/\D/g, '');

// FIN-03: the details a receipt must carry for each method. Returns { methodRef, payDetails } or
// throws 422 with per-field errors. `amount` is what is applied to the folio; for cash, `tendered`
// (optional) is what the guest handed over and the change is computed here.
// Card is a record of an external-terminal sale: last 4 digits + approval number — a longer digit
// string is refused so a full card number can never be stored.
export function paymentDetails({ method, amount, input, today }) {
  const d = input.details && typeof input.details === 'object' ? input.details : {};
  const errors = {};
  const out = {};
  let methodRef = clip(input.methodRef, 80);
  if (method === 'cash') {
    if (d.tendered !== undefined && d.tendered !== null && d.tendered !== '') {
      const tendered = round2(d.tendered);
      if (!(tendered > 0) || tendered - amount < -0.005) errors.tendered = 'הסכום שהתקבל קטן מהסכום לרישום';
      else { out.tendered = tendered; out.change = round2(tendered - amount); }
    }
  } else if (method === 'credit_card') {
    const last4 = digits(d.last4);
    const approval = clip(d.approval ?? input.methodRef, 20);
    if (digits(d.last4).length > 4 || /\d{7,}/.test(String(d.approval || ''))) errors.last4 = 'אין להקליד מספר כרטיס מלא — 4 ספרות אחרונות בלבד';
    else if (last4.length !== 4) errors.last4 = '4 ספרות אחרונות של הכרטיס';
    if (!/^[A-Za-z0-9-]{2,20}$/.test(approval)) errors.approval = 'מספר אישור מהמסוף';
    const inst = d.installments === undefined || d.installments === '' ? 1 : Number(d.installments);
    if (!Number.isInteger(inst) || inst < 1 || inst > 36) errors.installments = '1 עד 36 תשלומים';
    if (d.cardBrand && !CARD_BRANDS.includes(d.cardBrand)) errors.cardBrand = 'סוג כרטיס לא מוכר';
    Object.assign(out, { last4, installments: inst, cardBrand: d.cardBrand || undefined });
    methodRef = approval;
  } else if (method === 'bank_transfer') {
    const ref = clip(d.reference ?? input.methodRef, 40);
    const payDate = clip(d.payDate, 10);
    if (ref.length < 2) errors.reference = 'מספר אסמכתת ההעברה';
    if (!YMD.test(payDate)) errors.payDate = 'תאריך ההעברה';
    else if (today && payDate > today) errors.payDate = 'תאריך העברה לא יכול להיות עתידי';
    Object.assign(out, { payDate, payerName: clip(d.payerName, 80) || undefined, bank: clip(d.bank, 40) || undefined, account: clip(d.account, 30) || undefined });
    methodRef = ref;
  } else if (method === 'cheque') {
    const number = digits(d.number ?? input.methodRef).slice(0, 12);
    const bank = digits(d.bank).slice(0, 3);
    const branch = digits(d.branch).slice(0, 4);
    const account = digits(d.account).slice(0, 12);
    const dueDate = clip(d.dueDate, 10);
    if (number.length < 3) errors.number = 'מספר השיק';
    if (bank.length < 2) errors.bank = 'קוד בנק';
    if (branch.length < 3) errors.branch = 'מספר סניף';
    if (account.length < 4) errors.account = 'מספר חשבון';
    if (!YMD.test(dueDate)) errors.dueDate = 'תאריך פירעון';
    Object.assign(out, { bank, branch, account, dueDate, payerName: clip(d.payerName, 80) || undefined });
    methodRef = number;
  } else if (method === 'voucher') {
    const number = clip(d.number ?? input.methodRef, 40);
    if (number.length < 2) errors.number = 'מספר השובר';
    out.issuer = clip(d.issuer, 80) || undefined;
    methodRef = number;
  }
  if (Object.keys(errors).length) throw httpError('יש להשלים את פרטי אמצעי התשלום', 422, { fields: errors });
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return { methodRef, payDetails: Object.keys(out).length ? out : undefined };
}

// Short text for the folio line ("· כרטיס 4242 · אישור 12345 · 3 תשלומים").
export function methodSummary(method, ref, d = {}) {
  const p = d || {};
  if (method === 'credit_card') return ` · ****${p.last4 || ''}${ref ? ` · אישור ${ref}` : ''}${p.installments > 1 ? ` · ${p.installments} תשלומים` : ''}`;
  if (method === 'bank_transfer') return ` · אסמכתה ${ref}${p.payDate ? ` · ${p.payDate.split('-').reverse().join('/')}` : ''}`;
  if (method === 'cheque') return ` · שיק ${ref} · בנק ${p.bank}/${p.branch}${p.dueDate ? ` · פירעון ${p.dueDate.split('-').reverse().join('/')}` : ''}`;
  if (method === 'voucher') return ` · שובר ${ref}${p.issuer ? ` (${p.issuer})` : ''}`;
  if (method === 'cash') return `${ref ? ` · ${ref}` : ''}${p.tendered ? ` · התקבל ${p.tendered.toFixed(2)}, עודף ${Number(p.change || 0).toFixed(2)}` : ''}`;
  return ref ? ` · ${ref}` : '';
}

function opRef(key) {
  const k = String(key || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(k)) throw httpError('חסר מזהה פעולה (idempotency key)', 422);
  return `op:${k}`;
}

async function loadFolio(folioId, propertyId) {
  if (!isId(String(folioId || ''))) throw httpError('מזהה חשבון לא תקין', 400);
  const folio = await Folio.findById(folioId);
  if (!folio || String(folio.property) !== String(propertyId)) throw httpError('החשבון לא נמצא', 404);
  return folio;
}

// Lines that sit on an issued tax document — they can only be corrected by a credit note.
async function linesOnIssuedDocs(folioId) {
  return (await docCoverage(folioId)).charges;
}

function ownerLabel(f, companies) {
  if (f.ownerRef === 'post_stay') return 'חיובים אחרי יציאה';
  if (f.ownerType === 'company') return companies.get(String(f.ownerRef))?.name || 'חברה';
  return { guest: 'אורח', room: 'חדר', group: 'קבוצה', house: 'בית' }[f.ownerType] || f.ownerType;
}

function lineDto(l, onDocs, reversedIds, refundedByPayment, onReceipts = new Map()) {
  const gross = round2(Number(l.amount || 0) + Number(l.taxAmount || 0));
  const id = String(l._id);
  const refunded = refundedByPayment.get(id) || 0;
  return {
    id, type: l.type, description: l.description, department: l.department || null, serviceDate: l.serviceDate,
    postedAt: l.postedAt, source: l.source, status: l.status, gross, net: round2(l.amount), tax: round2(l.taxAmount || 0),
    quantity: l.quantity ?? null, unitPrice: l.unitPrice ?? null, method: l.method || null, methodRef: l.methodRef || null,
    payDetails: l.payDetails || null, onReceipt: onReceipts.get(id) || null,
    reason: l.reason || l.voidReason || null,
    reversalOf: l.reversalOf ? String(l.reversalOf) : null,
    refundOf: l.refundOf ? String(l.refundOf) : null,
    reversed: reversedIds.has(id),
    onDocument: onDocs.get(id) || null,
    refundable: ['payment', 'deposit'].includes(l.type) && l.status === 'posted' ? round2(Math.abs(gross) - refunded) : null,
  };
}

function totalsOf(lines) {
  const sum = (pred) => round2(lines.filter((l) => l.status === 'posted' && pred(l)).reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0));
  return {
    charges: sum((l) => ['charge', 'fee', 'tax'].includes(l.type)),
    adjustments: sum((l) => ['adjustment', 'discount'].includes(l.type)),
    payments: -sum((l) => ['payment', 'deposit'].includes(l.type)),
    refunds: sum((l) => l.type === 'refund'),
  };
}

// ── FIN-01 index: folios with money on them ─────────────────────────────────
export async function listFolios({ propertyId, view = 'open', q, page = 1, pageSize = 50 }) {
  const filter = { property: propertyId };
  if (view === 'closed') filter.status = 'closed';
  else filter.status = { $ne: 'closed' };
  let resFilter = null;
  if (q) {
    const term = String(q).trim().slice(0, 60);
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const guests = await GuestProfile.find({ property: propertyId, $or: [{ firstName: rx }, { lastName: rx }, { phone: rx }, { email: rx }] }).select('_id').limit(200).lean();
    resFilter = { property: propertyId, $or: [{ confirmationNumber: rx }, { primaryGuest: { $in: guests.map((g) => g._id) } }] };
  }
  if (resFilter) {
    const res = await Reservation.find(resFilter).select('_id').limit(500).lean();
    filter.reservation = { $in: res.map((r) => r._id) };
  }
  const folios = await Folio.find(filter).select('reservation ownerType ownerRef status lines.amount lines.taxAmount lines.status settlement currency updatedAt').sort({ updatedAt: -1 }).limit(1000).lean();
  let rows = folios.map((f) => ({ f, balance: folioBalance(f) }));
  if (view === 'balance') rows = rows.filter((r) => r.balance > 0.005);
  if (view === 'credit') rows = rows.filter((r) => r.balance < -0.005);
  const counts = {
    open: folios.length,
    balance: rows.length,
  };
  const total = rows.length;
  const size = Math.min(100, Math.max(10, Number(pageSize) || 50));
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(pages, Math.max(1, Number(page) || 1));
  const slice = rows.slice((p - 1) * size, p * size);
  const resIds = slice.map((r) => r.f.reservation);
  const reservations = await Reservation.find({ _id: { $in: resIds } }).select('confirmationNumber status arrivalDate departureDate primaryGuest assignedRoom company').populate('primaryGuest', 'firstName lastName').populate('assignedRoom', 'number').lean();
  const byRes = new Map(reservations.map((r) => [String(r._id), r]));
  const companyIds = slice.filter((r) => r.f.ownerType === 'company' && isId(String(r.f.ownerRef || ''))).map((r) => r.f.ownerRef);
  const companies = new Map((await Company.find({ _id: { $in: companyIds } }).select('name').lean()).map((c) => [String(c._id), c]));
  const [openBalance, openCredit] = view === 'closed' ? [0, 0] : [
    round2(folios.map(folioBalance).filter((b) => b > 0).reduce((s, b) => s + b, 0)),
    round2(folios.map(folioBalance).filter((b) => b < 0).reduce((s, b) => s + b, 0)),
  ];
  return {
    counts: { ...counts, owed: folios.filter((f) => folioBalance(f) > 0.005).length, credit: folios.filter((f) => folioBalance(f) < -0.005).length, openBalance, openCredit },
    total, page: p, pages, pageSize: size,
    rows: slice.map(({ f, balance }) => {
      const r = byRes.get(String(f.reservation));
      return {
        id: String(f._id), reservationId: String(f.reservation), status: f.status, currency: f.currency, balance,
        owner: ownerLabel(f, companies), ownerType: f.ownerType,
        settlement: f.settlement?.mode || null,
        confirmationNumber: r?.confirmationNumber || '—', reservationStatus: r?.status || null,
        guest: r?.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : '—',
        room: r?.assignedRoom?.number || null, arrivalDate: r?.arrivalDate, departureDate: r?.departureDate,
        updatedAt: f.updatedAt,
      };
    }),
  };
}

// A stay can reach the desk without a folio window (created lazily elsewhere). Taking money must not
// depend on that: give a live stay its guest window on demand, never for a cancelled/closed one.
export async function ensureGuestFolio({ propertyId, reservationId }) {
  if (!isId(String(reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).select('status currency').lean();
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  if (['cancelled', 'no_show'].includes(res.status)) throw httpError('לא ניתן לרשום תשלום להזמנה שבוטלה', 409);
  let folio = await Folio.findOne({ reservation: res._id, status: { $ne: 'closed' }, ownerType: 'guest' });
  if (!folio) folio = await Folio.create({ property: propertyId, reservation: res._id, ownerType: 'guest', currency: res.currency || 'ILS', lines: [] });
  return { folioId: String(folio._id) };
}

// ── FIN-01 stay view: every folio window of a reservation ───────────────────
export async function getStayFolios({ propertyId, reservationId }) {
  if (!isId(String(reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId })
    .populate('primaryGuest', 'firstName lastName').populate('assignedRoom', 'number').populate('company', 'name creditLimit').lean();
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  const property = await Property.findById(propertyId).select('vatRate defaultCurrency financePolicy timezone').lean();
  const folios = await Folio.find({ reservation: res._id }).sort({ createdAt: 1 }).lean();
  const stayUnits = await ReservationRoom.find({ reservation: res._id }).populate('assignedRoom', 'number').sort({ createdAt: 1, _id: 1 }).lean();
  const unitLabels = new Map(stayUnits.map((u, i) => [String(u._id), `חדר ${u.assignedRoom?.number || i + 1}${u.occupantName ? ` · ${u.occupantName}` : ''}`]));
  const companyIds = folios.filter((f) => f.ownerType === 'company' && isId(String(f.ownerRef || ''))).map((f) => f.ownerRef);
  const companies = new Map((await Company.find({ _id: { $in: companyIds } }).select('name').lean()).map((c) => [String(c._id), c]));
  const docs = await Invoice.find({ $or: [{ reservation: res._id }, { folio: { $in: folios.map((f) => f._id) } }] })
    .select('type invoiceNumber status issueDate totalNet totalVat totalGross amountPaid buyer relatedInvoiceId creditedBy allocationNumber allocationStatus allocationReason allocationThreshold allocationRejectReason printCount folio reservation').sort({ createdAt: 1 }).lean();
  const creditedOf = new Map();
  for (const d of docs.filter((x) => x.type === 'credit_note' && x.relatedInvoiceId)) {
    const k = String(d.relatedInvoiceId);
    creditedOf.set(k, round2((creditedOf.get(k) || 0) + Math.abs(d.totalGross || 0)));
  }
  const windows = [];
  const exceptions = [];
  for (const f of folios) {
    const coverage = await docCoverage(f._id);
    const onDocs = coverage.charges;
    const reversedIds = new Set(f.lines.filter((l) => l.reversalOf).map((l) => String(l.reversalOf)));
    const refundedByPayment = new Map();
    for (const l of f.lines) {
      if (l.type === 'refund' && l.refundOf && l.status === 'posted') {
        const k = String(l.refundOf);
        refundedByPayment.set(k, round2((refundedByPayment.get(k) || 0) + Number(l.amount || 0)));
      }
    }
    const balance = folioBalance(f);
    const lines = [...f.lines].sort((a, b) => String(a.serviceDate).localeCompare(String(b.serviceDate)) || new Date(a.postedAt) - new Date(b.postedAt))
      .map((l) => lineDto(l, onDocs, reversedIds, refundedByPayment, coverage.payments));
    const label = f.ownerType === 'room' && unitLabels.has(String(f.ownerRef)) ? unitLabels.get(String(f.ownerRef)) : ownerLabel(f, companies);
    if (balance < -0.005) exceptions.push({ code: 'credit', folioId: String(f._id), label: `${label}: יתרת זכות ${Math.abs(balance).toFixed(2)} — יש להחזיר או לאשר` });
    if (f.status === 'closed' && Math.abs(balance) > 0.005) exceptions.push({ code: 'closed_with_balance', folioId: String(f._id), label: `${label}: חשבון סגור עם יתרה` });
    if (f.settlement?.mode && Math.abs(balance) > 0.005) exceptions.push({ code: 'settled_open', folioId: String(f._id), label: `${label}: יתרה פתוחה באישור (${f.settlement.approvedByName || '—'})` });
    windows.push({
      id: String(f._id), ownerType: f.ownerType, owner: label, unitId: f.ownerType === 'room' ? String(f.ownerRef) : null, status: f.status, currency: f.currency || 'ILS',
      balance, totals: totalsOf(f.lines),
      settlement: f.settlement?.mode ? { mode: f.settlement.mode, reason: f.settlement.reason || null, by: f.settlement.approvedByName || null, at: f.settlement.at || null } : null,
      lines,
    });
  }
  return {
    reservation: {
      id: String(res._id), confirmationNumber: res.confirmationNumber, status: res.status,
      guest: res.primaryGuest ? `${res.primaryGuest.firstName || ''} ${res.primaryGuest.lastName || ''}`.trim() : '—',
      room: res.assignedRoom?.number || null, arrivalDate: res.arrivalDate, departureDate: res.departureDate, nights: res.nights,
      company: res.company ? { id: String(res.company._id), name: res.company.name } : null,
      totalAmount: res.totalAmount ?? null, currency: res.currency || property?.defaultCurrency || 'ILS',
    },
    // FIN-01-F05: a guarantee is shown on its own and is never counted as money received.
    guarantee: { type: res.guaranteeType || 'none', reference: res.guaranteeReference || null, depositRequired: res.depositAmount || 0 },
    vatRate: property?.vatRate ?? 18,
    businessDate: businessDateOf(property),
    canPost: ACTIVE_STAY.includes(res.status),
    folios: windows,
    documents: docs.map((d) => ({
      ...docDto(d),
      credited: creditedOf.get(String(d._id)) || 0, allocationNumber: d.allocationNumber || null,
      creditable: CHARGE_DOC_TYPES.includes(d.type) && d.status === 'issued' ? round2(Math.abs(d.totalGross || 0) - (creditedOf.get(String(d._id)) || 0)) : 0,
    })),
    exceptions,
    policy: { refundApprovalOver: property?.financePolicy?.refundApprovalOver ?? 0, cashLimitPerStay: property?.financePolicy?.cashLimitPerStay ?? null },
  };
}

// ── FIN-02 charge ───────────────────────────────────────────────────────────
export async function postCharge({ propertyId, folioId, input, actor, ip }) {
  const folio = await loadFolio(folioId, propertyId);
  const reference = opRef(input.idempotencyKey);
  const dup = folio.lines.find((l) => l.reference === reference);
  if (dup) return { folioId: String(folio._id), lineId: String(dup._id), duplicate: true, balance: folioBalance(folio) };
  if (folio.status === 'closed') throw httpError('החשבון סגור — חיוב נרשם בחשבון פתוח בלבד', 409);
  const res = await Reservation.findById(folio.reservation).select('status arrivalDate departureDate tourist property').lean();
  if (!res || !ACTIVE_STAY.includes(res.status)) throw httpError('לא ניתן לחייב הזמנה שבוטלה או לא הגיעה', 409);
  // G6: after departure a charge is a post-stay charge (manager, reason, own window) — not a regular one.
  if (res.status === 'checked_out' && input.auditAction !== 'folio.post_stay_charge') throw httpError('האורח כבר יצא — חיוב מאוחר נרשם דרך "חיוב אחרי יציאה" בתיק ההזמנה', 409, { code: 'post_stay_required' });
  const property = await Property.findById(propertyId).select('vatRate timezone').lean();
  const today = businessDateOf(property);
  const errors = {};
  // G1: the code comes from the property catalogue — it decides price lock, VAT class and who may post.
  const code = await resolveChargeCode({ propertyId, code: input.department, actorRole: actor.role, unitPrice: input.unitPrice });
  const description = String(input.description || '').trim().slice(0, 200) || code.name;
  const qty = Number(input.quantity ?? 1);
  const unit = round2(code.unitPrice ?? input.unitPrice);
  const serviceDate = YMD.test(input.serviceDate || '') ? input.serviceDate : today;
  if (!(qty > 0) || qty > 1000) errors.quantity = 'כמות חיובית';
  if (!(unit > 0)) errors.unitPrice = 'מחיר חיובי';
  if (serviceDate > today) errors.serviceDate = 'מועד שירות לא יכול להיות אחרי היום העסקי';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי החיוב', 422, { fields: errors });
  const gross = round2(qty * unit);
  // VAT: the code's class first (exempt/zero), then the tourist rule for this stay (EXT-04).
  const lineVat = code.vatClass !== 'standard' ? { rate: 0, reason: `code_${code.vatClass}` } : await vatForLine({ reservation: res, code: code.code, propertyVatRate: property?.vatRate ?? 18 });
  const { net, tax } = lineVat.strip ? { net: taxFor(gross, 'standard', lineVat.propertyVatRate).net, tax: 0 } : taxFor(gross, lineVat.rate === 0 ? 'zero' : 'standard', lineVat.rate);
  folio.lines.push({
    type: 'charge', description: qty !== 1 ? `${description} × ${qty}` : description, amount: net, taxAmount: tax,
    vatRate: lineVat.rate, taxReason: lineVat.reason || undefined,
    department: code.code, serviceDate, source: input.source === 'pos' ? 'pos' : 'manual', status: 'posted', reference,
    quantity: qty, unitPrice: unit, reason: input.reason ? String(input.reason).slice(0, 300) : undefined, createdBy: actor.id || undefined,
  });
  await folio.save();
  const line = folio.lines[folio.lines.length - 1];
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: input.auditAction || 'folio.charge', entityType: 'Folio', entityId: folio._id, after: { lineId: String(line._id), gross, net, tax, department: code.code, vatClass: code.vatClass, serviceDate }, reason: input.reason || undefined, ip });
  return { folioId: String(folio._id), lineId: String(line._id), gross, net, tax, duplicate: false, balance: folioBalance(folio) };
}

// FIN-02-A03: a reversal is an opposite line linked to the original — nothing is deleted.
export async function reverseCharge({ propertyId, folioId, lineId, reason, actor, ip }) {
  if (!REVERSE_ROLES.includes(actor.role)) throw httpError('היפוך חיוב מותר למנהל או לכספים', 403);
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('היפוך חיוב מחייב סיבה', 422, { fields: { reason: 'יש לפרט סיבה' } });
  const folio = await loadFolio(folioId, propertyId);
  if (folio.status === 'closed') throw httpError('החשבון סגור — תיקון במסמך זיכוי', 409);
  const line = folio.lines.id(lineId);
  if (!line) throw httpError('השורה לא נמצאה', 404);
  if (!['charge', 'fee'].includes(line.type) || line.status !== 'posted') throw httpError('אפשר להפוך רק חיוב רשום', 422);
  if (line.reversalOf) throw httpError('זו כבר שורת היפוך', 422);
  const reference = `rev:${line._id}`;
  const existing = folio.lines.find((l) => l.reference === reference || String(l.reversalOf || '') === String(line._id));
  if (existing) throw httpError('החיוב כבר הופך', 409);
  const onDocs = await linesOnIssuedDocs(folio._id);
  if (onDocs.has(String(line._id))) throw httpError(`החיוב כלול במסמך ${onDocs.get(String(line._id))} שהונפק — התיקון במסמך זיכוי (T18)`, 409, { code: 'on_document' });
  const property = await Property.findById(propertyId).select('timezone').lean();
  folio.lines.push({
    type: 'adjustment', description: `היפוך: ${line.description}`, amount: -round2(line.amount), taxAmount: -round2(line.taxAmount || 0), vatRate: line.vatRate, taxReason: line.taxReason,
    department: line.department, serviceDate: businessDateOf(property), source: 'manual', status: 'posted', reference,
    reversalOf: line._id, reason: why, createdBy: actor.id || undefined,
  });
  try {
    await folio.save();
  } catch (e) {
    if (e?.name === 'VersionError') throw httpError('החשבון עודכן בינתיים — רעננו', 409);
    throw e;
  }
  const rev = folio.lines[folio.lines.length - 1];
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.charge_reversed', entityType: 'Folio', entityId: folio._id, reason: why, before: { lineId: String(line._id), gross: round2(line.amount + (line.taxAmount || 0)) }, after: { reversalLineId: String(rev._id) }, ip });
  return { folioId: String(folio._id), lineId: String(rev._id), balance: folioBalance(folio) };
}

// ── FIN-03 payment / deposit (manual methods; card = external terminal record) ──
export async function recordFolioPayment({ propertyId, folioId, input, actor, ip }) {
  const folio = await loadFolio(folioId, propertyId);
  const reference = opRef(input.idempotencyKey);
  const dup = folio.lines.find((l) => l.reference === reference);
  if (dup) return { folioId: String(folio._id), lineId: String(dup._id), duplicate: true, balance: folioBalance(folio) };
  if (folio.status === 'closed') throw httpError('החשבון סגור', 409);
  const res = await Reservation.findById(folio.reservation).select('status totalAmount tourist').lean();
  if (!res || ['cancelled', 'no_show'].includes(res.status)) throw httpError('לא ניתן לרשום תשלום להזמנה שבוטלה', 409);
  const property = await Property.findById(propertyId).select('timezone financePolicy').lean();
  const amount = round2(input.amount);
  const kind = input.kind === 'deposit' ? 'deposit' : 'payment';
  const errors = {};
  if (!(amount > 0)) errors.amount = 'סכום חיובי';
  if (!PAY_METHODS.includes(input.method)) errors.method = 'יש לבחור אמצעי';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי התשלום', 422, { fields: errors });
  const { methodRef, payDetails } = paymentDetails({ method: input.method, amount, input, today: businessDateOf(property) });
  const pm = await resolvePaymentMethod({ propertyId, method: input.method, methodRef });
  const balance = folioBalance(folio);
  if (kind === 'payment' && amount - balance > 0.005) {
    throw httpError(balance > 0.005 ? `הסכום גבוה מהיתרה (${balance.toFixed(2)}) — לתשלום מראש בחרו "מקדמה"` : 'אין יתרה לתשלום — לתשלום מראש בחרו "מקדמה"', 422, { fields: { amount: 'גבוה מהיתרה' } });
  }
  if (kind === 'deposit') {
    // A deposit is capped by what the stay is expected to cost, minus what was already paid.
    const all = await Folio.find({ reservation: folio.reservation }).select('lines').lean();
    const paid = round2(all.flatMap((f) => f.lines).filter((l) => l.status === 'posted' && ['payment', 'deposit'].includes(l.type)).reduce((s, l) => s - Number(l.amount || 0), 0));
    const refunded = round2(all.flatMap((f) => f.lines).filter((l) => l.status === 'posted' && l.type === 'refund').reduce((s, l) => s + Number(l.amount || 0), 0));
    const expected = round2(Math.max(Number(res.totalAmount || 0), all.flatMap((f) => f.lines).filter((l) => l.status === 'posted' && !['payment', 'deposit', 'refund'].includes(l.type)).reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0)));
    const room = round2(expected - (paid - refunded));
    if (amount - room > 0.005) throw httpError(room > 0.005 ? `מקדמה עד ${room.toFixed(2)} (עלות השהייה פחות מה ששולם)` : 'השהייה כבר שולמה במלואה', 422, { fields: { amount: 'מעל עלות השהייה' } });
  }
  if (input.method === 'cash' && property?.financePolicy?.cashLimitPerStay) {
    // T25: cash is checked cumulatively per stay, not per receipt.
    const all = await Folio.find({ reservation: folio.reservation }).select('lines').lean();
    const cash = round2(all.flatMap((f) => f.lines).filter((l) => l.status === 'posted' && ['payment', 'deposit'].includes(l.type) && l.method === 'cash').reduce((s, l) => s - Number(l.amount || 0), 0));
    const limit = Number(property.financePolicy.cashLimitPerStay);
    if (cash + amount - limit > 0.005) throw httpError(`מזומן מצטבר לשהייה מוגבל ל־${limit.toFixed(2)} לפי מדיניות הנכס (כבר התקבלו ${cash.toFixed(2)})`, 422, { fields: { amount: 'מעל מגבלת מזומן' }, code: 'cash_limit' });
  }
  if (input.method === 'cash' && property?.financePolicy?.cashRule === 'il_2024') {
    // IL11: the legal cash limit on the whole stay (the transaction) — cumulative; tourist threshold when verified.
    const all = await Folio.find({ reservation: folio.reservation }).select('lines').lean();
    const flat = all.flatMap((f) => f.lines).filter((l) => l.status === 'posted');
    const charges = round2(flat.filter((l) => !['payment', 'deposit', 'refund'].includes(l.type)).reduce((s2, l) => s2 + Number(l.amount || 0) + Number(l.taxAmount || 0), 0));
    const price = Math.max(Number(res.totalAmount || 0), charges);
    const allow = await cashAllowance({ reservation: res, propertyFinance: property.financePolicy, transactionPrice: price });
    const cashSoFar = round2(flat.filter((l) => ['payment', 'deposit'].includes(l.type) && l.method === 'cash').reduce((s2, l) => s2 - Number(l.amount || 0), 0));
    if (allow && cashSoFar + amount - allow.limit > 0.005) {
      throw httpError(`חוק המזומן: בעסקה של ${price.toFixed(2)} מותר במזומן עד ${allow.limit.toFixed(2)}${allow.tourist ? ' (תייר מאומת)' : ''} — כבר התקבלו ${cashSoFar.toFixed(2)}. את היתרה באמצעי אחר`, 422, { fields: { amount: 'מעל מגבלת המזומן' }, code: 'cash_law' });
    }
  }
  folio.lines.push({
    type: kind,
    description: `${kind === 'deposit' ? 'מקדמה' : 'תשלום'} — ${pm.name}${methodSummary(input.method, methodRef, payDetails)}`,
    amount: -amount, taxAmount: 0, serviceDate: businessDateOf(property), source: 'pms', status: 'posted', reference,
    method: input.method, methodRef: methodRef || undefined, payDetails, reason: input.note ? String(input.note).slice(0, 200) : undefined,
    createdBy: actor.id || undefined,
  });
  await folio.save();
  const line = folio.lines[folio.lines.length - 1];
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `folio.${kind}`, entityType: 'Folio', entityId: folio._id, after: { lineId: String(line._id), amount, method: input.method, hasReference: !!methodRef }, ip });
  return { folioId: String(folio._id), lineId: String(line._id), duplicate: false, balance: folioBalance(folio), change: payDetails?.change ?? null };
}

// ── FIN-04 refund of a specific payment ─────────────────────────────────────
export async function refundPayment({ propertyId, folioId, paymentLineId, input, actor, ip }) {
  const folio = await loadFolio(folioId, propertyId);
  const reference = opRef(input.idempotencyKey);
  const dup = folio.lines.find((l) => l.reference === reference);
  if (dup) return { folioId: String(folio._id), lineId: String(dup._id), duplicate: true, balance: folioBalance(folio) };
  const pay = folio.lines.id(paymentLineId);
  if (!pay || !['payment', 'deposit'].includes(pay.type) || pay.status !== 'posted') throw httpError('תשלום המקור לא נמצא או אינו בר החזר', 404);
  const amount = round2(input.amount);
  const why = String(input.note || '').trim().slice(0, 300);
  const errors = {};
  if (!(amount > 0)) errors.amount = 'סכום חיובי';
  if (!REFUND_REASONS[input.reasonCode]) errors.reasonCode = 'יש לבחור סיבה';
  if (input.reasonCode === 'other' && why.length < 3) errors.note = 'יש לפרט';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי ההחזר', 422, { fields: errors });
  const property = await Property.findById(propertyId).select('timezone financePolicy').lean();
  const threshold = Number(property?.financePolicy?.refundApprovalOver ?? 0);
  // T36: above the threshold only a manager/finance role may refund — checked here, not in the UI.
  if (amount > threshold && !REFUND_ROLES.includes(actor.role)) throw httpError(threshold > 0 ? `החזר מעל ${threshold.toFixed(2)} מחייב מנהל או כספים` : 'החזר כספי מחייב מנהל או כספים', 403, { code: 'approval_required' });
  // T16: cumulative per payment.
  const already = round2(folio.lines.filter((l) => l.type === 'refund' && l.status === 'posted' && String(l.refundOf || '') === String(pay._id)).reduce((s, l) => s + Number(l.amount || 0), 0));
  const refundable = round2(Math.abs(Number(pay.amount || 0)) - already);
  if (amount - refundable > 0.005) throw httpError(refundable > 0.005 ? `ניתן להחזיר מתשלום זה עד ${refundable.toFixed(2)} (כבר הוחזרו ${already.toFixed(2)})` : 'התשלום הוחזר במלואו', 422, { fields: { amount: 'מעל יתרת ההחזר' } });
  // Money still owed by the guest is not returned: a refund may only bring the balance up to zero.
  const credit = -folioBalance(folio);
  if (amount - credit > 0.005) throw httpError(credit > 0.005 ? `יתרת הזכות בחשבון היא ${credit.toFixed(2)} — החזר גדול יותר ישאיר חוב` : 'אין יתרת זכות בחשבון — קודם יש לבטל או לזכות חיובים', 422, { fields: { amount: 'מעל יתרת הזכות' }, code: 'exceeds_credit' });
  folio.lines.push({
    type: 'refund', description: `החזר — ${REFUND_REASONS[input.reasonCode]}${why ? ` · ${why}` : ''} (${METHOD_LABELS[pay.method] || 'אמצעי מקורי'})`,
    amount, taxAmount: 0, serviceDate: businessDateOf(property), source: 'manual', status: 'posted', reference,
    refundOf: pay._id, method: pay.method || undefined, reason: why || REFUND_REASONS[input.reasonCode], createdBy: actor.id || undefined,
  });
  await folio.save();
  const line = folio.lines[folio.lines.length - 1];
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'folio.refund', entityType: 'Folio', entityId: folio._id, reason: why || input.reasonCode, after: { lineId: String(line._id), refundOf: String(pay._id), amount, refundedTotal: round2(already + amount) }, ip });
  return { folioId: String(folio._id), lineId: String(line._id), duplicate: false, balance: folioBalance(folio), refundable: round2(refundable - amount) };
}

// ── FIN-07 credit note (scope + role here; caps and immutability in invoiceService) ──
export async function creditNote({ propertyId, invoiceId, amount, selections, reason, idempotencyKey, actor, ip }) {
  if (!CREDIT_ROLES.includes(actor.role)) throw httpError('מסמך זיכוי מופק על ידי כספים או הנהלה', 403);
  if (!isId(String(invoiceId || ''))) throw httpError('מזהה מסמך לא תקין', 400);
  const inv = await Invoice.findOne({ _id: invoiceId, property: propertyId }).select('_id type issuer').lean();
  if (!inv) throw httpError('המסמך לא נמצא', 404);
  if (inv.issuer === 'invoicer') throw httpError('זיכוי של מסמך שהופק במערכת החשבוניות נעשה במערכת החשבוניות', 409, { code: 'managed_by_invoicer' });
  if (inv.type === 'credit_note') throw httpError('לא מזכים מסמך זיכוי', 422);
  if (!CHARGE_DOC_TYPES.includes(inv.type)) throw httpError('מסמך זיכוי מופק רק לחשבונית מס — לא לקבלה או לחשבון עסקה', 422);
  const cn = await issueCreditNote({ originalInvoiceId: invoiceId, creditAmount: amount === undefined || amount === null || amount === '' ? undefined : amount, selections, reason, issuedBy: actor.id, idempotencyKey });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'invoice.credit_note', entityType: 'Invoice', entityId: invoiceId, reason, after: { creditNote: String(cn._id), number: cn.invoiceNumber, gross: cn.totalGross }, ip });
  return { id: String(cn._id), number: cn.invoiceNumber, gross: round2(cn.totalGross) };
}

// ── FIN-12 day close ────────────────────────────────────────────────────────
async function dayState(propertyId) {
  const property = await Property.findById(propertyId).select('name timezone dayClose').lean();
  if (!property) throw httpError('הנכס לא נמצא', 404);
  const today = businessDateOf(property);
  const last = property.dayClose?.lastClosedDate || null;
  let dateToClose = today;
  if (last) {
    const next = addDays(last, 1);
    dateToClose = next <= today ? next : null;
  }
  return { property, today, last, dateToClose };
}

export async function readinessFor(propertyId, date) {
  const until = addDays(date, 1);
  const [arrivals, departures, queue, inHouse, checkedOut] = await Promise.all([
    Reservation.find({ property: propertyId, arrivalDate: { $lte: date }, status: { $in: ['confirmed', 'modified', 'pending_payment', 'hold'] } })
      .select('confirmationNumber arrivalDate roomsCount primaryGuest').populate('primaryGuest', 'firstName lastName').sort({ arrivalDate: 1 }).limit(200).lean(),
    Reservation.find({ property: propertyId, departureDate: { $lte: date }, status: { $in: IN_HOUSE_STATUSES } })
      .select('confirmationNumber departureDate assignedRoom primaryGuest').populate('primaryGuest', 'firstName lastName').populate('assignedRoom', 'number').limit(200).lean(),
    ArrivalQueueEntry.countDocuments({ property: propertyId, status: 'active' }),
    Reservation.find({ property: propertyId, status: { $in: IN_HOUSE_STATUSES } }),
    Reservation.find({ property: propertyId, status: 'checked_out', checkedOutAt: { $gte: new Date(Date.now() - 30 * 86400000) } }).select('_id confirmationNumber').lean(),
  ]);
  let nights = 0;
  let amount = 0;
  for (const r of inHouse) {
    try {
      const plan = await planNights({ reservation: r, until });
      nights += plan.count;
      amount += plan.gross;
    } catch { /* counted at run time */ }
  }
  const coFolios = checkedOut.length ? await Folio.find({ reservation: { $in: checkedOut.map((r) => r._id) }, status: { $ne: 'closed' } }).select('reservation lines settlement').lean() : [];
  const unsettled = coFolios.filter((f) => folioBalance(f) > 0.005 && !f.settlement?.mode);
  const name = (g) => (g ? `${g.firstName || ''} ${g.lastName || ''}`.trim() : '—');
  return {
    arrivals: arrivals.map((r) => ({ id: String(r._id), confirmationNumber: r.confirmationNumber, guest: name(r.primaryGuest), arrivalDate: r.arrivalDate, rooms: r.roomsCount || 1 })),
    departures: departures.map((r) => ({ id: String(r._id), confirmationNumber: r.confirmationNumber, guest: name(r.primaryGuest), departureDate: r.departureDate, room: r.assignedRoom?.number || null })),
    queueOpen: queue,
    unsettledDepartures: unsettled.length,
    nights: { count: nights, amount: round2(amount), inHouse: inHouse.length },
  };
}

function runDto(r) {
  if (!r) return null;
  return {
    id: String(r._id), runNo: r.runNo, businessDate: r.businessDate, status: r.status, attempts: r.attempts,
    options: r.options || {}, startedBy: r.startedByName || null, createdAt: r.createdAt, finishedAt: r.finishedAt || null,
    steps: (r.steps || []).map((s) => ({ key: s.key, status: s.status, startedAt: s.startedAt || null, finishedAt: s.finishedAt || null, result: s.result ?? null, error: s.error || null })),
    readiness: r.readiness ? { arrivals: r.readiness.arrivals?.length || 0, departures: r.readiness.departures?.length || 0, queueOpen: r.readiness.queueOpen || 0 } : null,
  };
}

// ── Automatic day close ─────────────────────────────────────────────────────
export async function setAutoDayClose({ propertyId, input, actor, ip }) {
  if (!NIGHT_ROLES.includes(actor.role)) throw httpError('הגדרת סגירה אוטומטית מותרת למנהל', 403);
  const time = String(input.time || '03:00');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw httpError('שעה HH:MM', 422, { fields: { time: 'שעה' } });
  const auto = { enabled: !!input.enabled, time, arrivals: input.arrivals === 'no_show' ? 'no_show' : 'keep', by: actor.name || undefined, at: new Date() };
  await Property.updateOne({ _id: propertyId }, { $set: { 'dayClose.auto': auto } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'day_close.auto_settings', entityType: 'Property', entityId: propertyId, after: auto, ip });
  return auto;
}

const localHm = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

// Called by the scheduler. Closes only days before today; never decides about open departures.
export async function autoDayCloseTick() {
  const props = await Property.find({ 'dayClose.auto.enabled': true }).select('name timezone dayClose').lean();
  for (const p of props) {
    try {
      const { today, dateToClose } = await dayState(p._id);
      if (!dateToClose || dateToClose >= today) continue;
      if (localHm(p.timezone) < (p.dayClose.auto.time || '03:00')) continue;
      if (p.dayClose.auto.triedOn === today) continue;
      const readiness = await readinessFor(p._id, dateToClose);
      if (readiness.departures.length) {
        await Property.updateOne({ _id: p._id }, { $set: { 'dayClose.auto.triedOn': today } });
        await raiseWork({ propertyId: p._id, kind: 'finance', severity: 'urgent', title: `סגירה אוטומטית של ${dateToClose} לא בוצעה`, body: `${readiness.departures.length} עזיבות לא נסגרו — סוגרים אותן או סוגרים את היום ידנית עם סיבה.`, source: { type: 'day_close', id: dateToClose, label: dateToClose, link: '/pms/night-audit' }, dedupeKey: `autoclose:${dateToClose}` }).catch(() => null);
        continue;
      }
      const policy = p.dayClose.auto.arrivals === 'no_show' ? 'no_show' : 'keep';
      await runDayClose({
        propertyId: p._id, date: dateToClose, arrivals: readiness.arrivals.length ? policy : undefined,
        reason: readiness.arrivals.length && policy === 'keep' ? 'סגירה אוטומטית — הגעות שלא נכנסו נשארו פתוחות לפי מדיניות הנכס' : undefined,
        actor: { id: null, name: 'סגירה אוטומטית', role: 'system' }, ip: 'scheduler',
      });
    } catch (err) {
      const today = new Date().toISOString().slice(0, 10);
      await Property.updateOne({ _id: p._id }, { $set: { 'dayClose.auto.triedOn': today } }).catch(() => null);
      await raiseWork({ propertyId: p._id, kind: 'finance', severity: 'urgent', title: 'סגירת יום אוטומטית נכשלה', body: String(err.message).slice(0, 400), source: { type: 'day_close', id: today, label: today, link: '/pms/night-audit' }, dedupeKey: `autoclose-fail:${today}` }).catch(() => null);
      console.error('[autoDayClose]', p.name, err.message);
    }
  }
}

export async function getDayClose({ propertyId }) {
  const { today, last, dateToClose, property } = await dayState(propertyId);
  const runs = await DayCloseRun.find({ property: propertyId }).sort({ businessDate: -1 }).limit(14).lean();
  const current = dateToClose ? runs.find((r) => r.businessDate === dateToClose) || null : null;
  return {
    today, lastClosedDate: last, dateToClose,
    auto: { enabled: !!property.dayClose?.auto?.enabled, time: property.dayClose?.auto?.time || '03:00', arrivals: property.dayClose?.auto?.arrivals || 'keep', by: property.dayClose?.auto?.by || null },
    readiness: dateToClose ? await readinessFor(propertyId, dateToClose) : null,
    current: runDto(current),
    runs: runs.map(runDto),
  };
}

const STALE_MS = 10 * 60 * 1000;

async function claimRun({ propertyId, date, options, readiness, actor }) {
  const runNo = `DC-${date.replace(/-/g, '')}`;
  let run = await DayCloseRun.findOne({ property: propertyId, businessDate: date });
  if (!run) {
    try {
      run = await DayCloseRun.create({
        property: propertyId, businessDate: date, runNo, status: 'running', attempts: 1, options, readiness,
        steps: DAY_CLOSE_STEPS.map((key) => ({ key, status: 'pending' })), startedBy: actor.id || undefined, startedByName: actor.name, heartbeatAt: new Date(),
      });
      return { run, resumed: false };
    } catch (e) {
      if (e?.code !== 11000) throw e;
      run = await DayCloseRun.findOne({ property: propertyId, businessDate: date });
    }
  }
  if (run.status === 'done') throw httpError(`היום ${date} כבר נסגר (${run.runNo})`, 409, { code: 'already_closed' });
  const staleBefore = new Date(Date.now() - STALE_MS);
  const claimed = await DayCloseRun.findOneAndUpdate(
    { _id: run._id, $or: [{ status: { $in: ['pending', 'failed'] } }, { status: 'running', heartbeatAt: { $lt: staleBefore } }] },
    { $set: { status: 'running', heartbeatAt: new Date(), options: { ...(run.options?.toObject?.() || run.options || {}), ...options }, readiness }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!claimed) throw httpError('סגירת היום כבר רצה ממסוף אחר — המתינו לסיומה', 409, { code: 'busy' });
  return { run: claimed, resumed: true };
}

async function setStep(runId, key, patch) {
  const set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`steps.$.${k}`, v]));
  await DayCloseRun.updateOne({ _id: runId, 'steps.key': key }, { $set: { ...set, heartbeatAt: new Date() } });
}

async function snapshotFor(propertyId, date) {
  const folios = await Folio.find({ property: propertyId, 'lines.serviceDate': date }).select('lines').lean();
  let roomGross = 0; let otherGross = 0; let payments = 0; let refunds = 0; let roomNights = 0;
  for (const f of folios) {
    for (const l of f.lines) {
      if (l.serviceDate !== date || l.status !== 'posted') continue;
      const g = Number(l.amount || 0) + Number(l.taxAmount || 0);
      const isRoom = ['rooms', 'room'].includes(l.department);
      if (l.type === 'charge') { if (isRoom) { roomGross += g; roomNights += 1; } else otherGross += g; }
      else if (l.type === 'adjustment' && l.reversalOf) { if (isRoom) roomGross += g; else otherGross += g; }
      else if (['payment', 'deposit'].includes(l.type)) payments += -g;
      else if (l.type === 'refund') refunds += g;
    }
  }
  const rooms = await Room.countDocuments({ property: propertyId, active: { $ne: false } });
  const sellable = await Room.countDocuments({ property: propertyId, active: { $ne: false }, opsStatus: 'available' });
  const [arrived, departed, noShows] = await Promise.all([
    Reservation.countDocuments({ property: propertyId, arrivalDate: date, status: { $in: [...IN_HOUSE_STATUSES, 'checked_out'] } }),
    Reservation.countDocuments({ property: propertyId, departureDate: date, status: 'checked_out' }),
    Reservation.countDocuments({ property: propertyId, arrivalDate: date, status: 'no_show' }),
  ]);
  return {
    rooms, sellable, roomNights,
    occupancyPct: sellable ? round2((roomNights / sellable) * 100) : 0,
    roomRevenue: round2(roomGross), otherRevenue: round2(otherGross),
    adr: roomNights ? round2(roomGross / roomNights) : 0,
    payments: round2(payments), refunds: round2(refunds),
    arrived, departed, noShows,
  };
}

export async function runDayClose({ propertyId, date, arrivals, reason, actor, ip }) {
  if (!NIGHT_ROLES.includes(actor.role) && actor.role !== 'system') throw httpError('סגירת יום מותרת למנהל משמרת/לילה או לכספים', 403);
  const { dateToClose, today } = await dayState(propertyId);
  if (!dateToClose) throw httpError('היום העסקי כבר נסגר — אין יום פתוח לסגירה', 409, { code: 'already_closed' });
  if (date && date !== dateToClose) throw httpError(date > today ? 'לא סוגרים יום עתידי' : `יש לסגור קודם את ${dateToClose} — ימים נסגרים לפי הסדר`, 409, { code: 'out_of_order' });
  const day = dateToClose;
  const readiness = await readinessFor(propertyId, day);
  const why = String(reason || '').trim().slice(0, 300);
  const fields = {};
  if (readiness.arrivals.length && !['no_show', 'keep'].includes(arrivals)) fields.arrivals = 'יש להחליט מה לעשות בהגעות שלא נכנסו';
  if (readiness.arrivals.length && arrivals === 'keep' && why.length < 3) fields.reason = 'השארת הגעות פתוחות מחייבת סיבה';
  if (readiness.departures.length && why.length < 3) fields.reason = 'יש עזיבות שלא נסגרו — נדרשת סיבה לאישור';
  if (Object.keys(fields).length) throw httpError('יש פריטים פתוחים שמחייבים החלטה לפני סגירה', 422, { fields, code: 'decisions_required' });

  const { run } = await claimRun({ propertyId, date: day, options: { arrivals: readiness.arrivals.length ? arrivals : 'none', reason: why || undefined }, readiness, actor });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'day_close.started', entityType: 'DayCloseRun', entityId: run._id, after: { businessDate: day, attempt: run.attempts, arrivals: readiness.arrivals.length, departures: readiness.departures.length }, reason: why || undefined, ip });

  const opts = run.options || {};
  const until = addDays(day, 1);
  const steps = {
    post_nights: async () => {
      const stays = await Reservation.find({ property: propertyId, status: { $in: IN_HOUSE_STATUSES } });
      let posted = 0;
      const errors = [];
      for (const r of stays) {
        try { posted += await postNightsUntil({ reservation: r, until, source: 'night_audit', actorId: actor.id }); }
        catch (e) { errors.push(`${r.confirmationNumber}: ${e.message}`); }
      }
      if (errors.length) { const err = new Error(`${errors.length} שהיות לא חויבו: ${errors.slice(0, 3).join(' · ')}`); err.partial = { posted }; throw err; }
      return { posted, stays: stays.length };
    },
    no_shows: async () => {
      if (opts.arrivals !== 'no_show') return { skipped: true };
      const pending = await Reservation.find({ property: propertyId, arrivalDate: { $lte: day }, status: { $in: ['confirmed', 'modified', 'pending_payment', 'hold'] } }).select('_id confirmationNumber').lean();
      let marked = 0;
      const errors = [];
      for (const r of pending) {
        try { await markNoShow({ reservationId: r._id, actorId: actor.id, actorName: actor.name || 'day_close', ip }); marked += 1; }
        catch (e) { errors.push(`${r.confirmationNumber}: ${e.message}`); }
      }
      if (errors.length) { const err = new Error(`${errors.length} הזמנות לא סומנו: ${errors.slice(0, 3).join(' · ')}`); err.partial = { marked }; throw err; }
      return { marked };
    },
    snapshot: async () => snapshotFor(propertyId, day),
    // G4: trial balance + ledgers. A break in the opening check (history of a closed day changed)
    // does not stop the night — it is stored on the run and opened as an urgent finance item.
    ledgers: async () => {
      const ledger = await computeLedger(propertyId, day);
      const checks = await ledgerChecks(propertyId, ledger);
      const broken = checks.filter((c) => c.ok === false);
      if (broken.length) {
        await raiseWork({ propertyId, kind: 'finance', severity: 'urgent', title: `סגירת ${day}: ${broken.length} בדיקות כספיות נכשלו`, body: broken.map((c) => c.label).join(' · ').slice(0, 500), source: { type: 'day_close', id: String(run._id), label: run.runNo, link: `/pms/night-audit/report?date=${day}` }, dedupeKey: `ledger:${day}` });
      }
      return { ...storedFrom(ledger), checks: checks.map(({ key, ok, amount, label }) => ({ key, ok, amount: amount ?? null, label })) };
    },
    advance: async () => {
      await Property.updateOne({ _id: propertyId }, { $set: { 'dayClose.lastClosedDate': day, 'dayClose.lastRunId': run._id } });
      return { closed: day };
    },
  };

  for (const s of run.steps) {
    if (['done', 'skipped'].includes(s.status)) continue;
    await setStep(run._id, s.key, { status: 'running', startedAt: new Date(), error: null });
    try {
      const result = await steps[s.key]();
      await setStep(run._id, s.key, { status: result?.skipped ? 'skipped' : 'done', finishedAt: new Date(), result });
    } catch (e) {
      await setStep(run._id, s.key, { status: 'failed', finishedAt: new Date(), error: String(e.message || e).slice(0, 500), result: e.partial || null });
      await DayCloseRun.updateOne({ _id: run._id }, { $set: { status: 'failed' } });
      await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'day_close.failed', entityType: 'DayCloseRun', entityId: run._id, after: { businessDate: day, step: s.key, error: String(e.message || e).slice(0, 300) }, ip });
      await raiseWork({ propertyId, kind: 'finance', severity: 'urgent', title: `סגירת היום ${day} נכשלה (${s.key})`, body: String(e.message || e).slice(0, 500), source: { type: 'day_close', id: String(run._id), label: run.runNo, link: '/pms/night-audit' }, dedupeKey: `dayclose:${day}` });
      return runDto(await DayCloseRun.findById(run._id).lean());
    }
  }
  await DayCloseRun.updateOne({ _id: run._id }, { $set: { status: 'done', finishedAt: new Date() } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'day_close.completed', entityType: 'DayCloseRun', entityId: run._id, after: { businessDate: day, runNo: run.runNo }, ip });
  return runDto(await DayCloseRun.findById(run._id).lean());
}

export { addDays as addBusinessDays, loadProperty };
