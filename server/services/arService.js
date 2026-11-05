// Receivables / city ledger (gap-map item 7). A company's AR account lives on Company.ar; each debt is a
// company folio (Folio.ar: number, date entered, due date). Money rules of the core stay: a posted line is
// never edited — a payment matched to a debt, a write-off, a debt moved to another account or
// consolidated are all new lines (Folio line arLink), written atomically across the folios involved.
// Tax documents stay in the invoicing system; a statement / reminder here is an internal letter.
import mongoose from 'mongoose';
import Folio from '../models/Folio.js';
import Company from '../models/Company.js';
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import ArNote from '../models/ArNote.js';
import ArLetter from '../models/ArLetter.js';
import { getNextSequenceValue } from '../models/Counter.js';
import { folioBalance } from './departureService.js';
import { recordFolioPayment, postCharge, CREDIT_ROLES } from './financeService.js';
import { resolveChargeCode } from './chargeCodeService.js';
import { docCoverage } from './documentService.js';
import { httpError, businessDateOf, IN_HOUSE_STATUSES } from './frontDeskService.js';
import { audit } from './auditService.js';
import { withLocks } from './locks.js';
import { runStayTransaction } from './stayTransaction.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const gross = (l) => round2(Number(l.amount || 0) + Number(l.taxAmount || 0));
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const endOfMonth = (ymd) => { const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
const txt = (v, n) => String(v ?? '').trim().slice(0, n);
const PAY_TYPES = ['payment', 'deposit', 'refund'];
const MOVE_KINDS = ['alloc', 'alloc_out', 'unalloc', 'unalloc_in', 'void_offset'];
const ACTIVE_RES = ['confirmed', 'modified', 'pending_payment', 'hold', ...IN_HOUSE_STATUSES];

export const AR_TYPES = { standard: 'רגיל', agency: 'סוכן / מפעיל', government: 'ממשלתי / מוסדי' };
export const AR_TERMS = { immediate: 'מיידי', net15: '15 יום', net30: '30 יום', net45: '45 יום', net60: '60 יום', eom15: 'שוטף + 15', eom30: 'שוטף + 30', eom60: 'שוטף + 60' };
// Reminder levels: days past the due date at which reminder 1 / 2 / 3 is due, per account type.
export const REMINDER_CYCLES = { standard: [1, 30, 60], agency: [15, 45, 75], government: [30, 60, 90] };
export const ADJUST_REASONS = { bad_debt: 'חוב אבוד (מחיקת חוב)', small_balance: 'יתרה קטנה / עיגול', dispute: 'מחלוקת שהוכרעה', rate_correction: 'תיקון תעריף מוסכם', goodwill: 'מחווה ללקוח', other: 'אחר' };
export const AR_ROLES_WORK = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'finance_manager', 'cashier'];
export const AR_ROLES_MANAGE = CREDIT_ROLES;

export function termDays(terms) {
  const t = String(terms || '').toLowerCase();
  const n = Number((t.match(/(\d+)/) || [])[1] || 0);
  return { eom: /eom|שוטף/.test(t), days: n };
}
export function dueOf(enteredOn, terms) {
  if (!YMD.test(enteredOn || '')) return null;
  const { eom, days } = termDays(terms);
  return addDays(eom ? endOfMonth(enteredOn) : enteredOn, days);
}
const termsLabel = (t) => AR_TERMS[t] || t || 'מיידי';

function opRef(key) {
  const k = String(key || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(k)) throw httpError('חסר מזהה פעולה', 422);
  return `op:${k}`;
}
const hasRef = (folio, ref) => folio.lines.some((l) => l.reference && (l.reference === ref || l.reference.startsWith(`${ref}:`)));

// Several folios in one atomic write (all locked, sorted → no deadlock).
function multiWrite(propertyId, folioIds, work) {
  const keys = [...new Set(folioIds.map((id) => `folio:${id}`))].sort();
  return withLocks([...keys, `dayclose:${propertyId}`], (lease) => runStayTransaction((session, afterCommit) => {
    session.financialDayCloseLease = lease;
    return work(session, afterCommit);
  }, lease, { operation: 'רישום כספי' }), { waitMs: 4000 });
}

async function loadProperty(propertyId, session = null) {
  const p = await Property.findById(propertyId).session(session).select('name legalName address city phone email taxNumber timezone dayClose arPolicy').lean();
  if (!p) throw httpError('הנכס לא נמצא', 404);
  return p;
}
async function loadCompany(propertyId, companyId, session = null) {
  if (!isId(companyId)) throw httpError('מזהה חברה לא תקין', 400);
  const c = await Company.findOne({ _id: companyId, property: propertyId }).session(session);
  if (!c) throw httpError('החברה לא נמצאה', 404);
  return c;
}
async function loadDebt(propertyId, folioId, session = null) {
  if (!isId(folioId)) throw httpError('מזהה חוב לא תקין', 400);
  const f = await Folio.findById(folioId).session(session);
  if (!f || String(f.property) !== String(propertyId) || f.ownerType !== 'company') throw httpError('החוב לא נמצא', 404);
  return f;
}
const nextDebtNumber = async (propertyId) => `D-${String(await getNextSequenceValue(`ar-debt:${propertyId}`)).padStart(6, '0')}`;
function assertOpen(company) {
  if (company.ar?.restricted) throw httpError(`חשבון החייבים של ${company.name} מוגבל — לא נרשמים אליו חיובים חדשים${company.ar.restrictedReason ? ` (${company.ar.restrictedReason})` : ''}`, 409, { code: 'ar_restricted' });
}

// ── Debt summary ─────────────────────────────────────────────────────────────
function summarize(f, r, today, terms) {
  const posted = (f.lines || []).filter((l) => l.status === 'posted');
  const movedOut = new Set(posted.filter((l) => l.arLink?.kind === 'out').map((l) => String(l.reversalOf)));
  let charged = 0; let paid = 0; let adjusted = 0;
  for (const l of posted) {
    const g = gross(l);
    const k = l.arLink?.kind;
    if (k === 'out' || movedOut.has(String(l._id))) continue;
    if (PAY_TYPES.includes(l.type) || MOVE_KINDS.includes(k) || k === 'void') paid = round2(paid - g);
    else if (k === 'writeoff') adjusted = round2(adjusted - g);
    else charged = round2(charged + g);
  }
  const balance = folioBalance(f);
  const inHouse = !!r && IN_HOUSE_STATUSES.includes(r.status);
  const unapplied = f.ar?.origin === 'unapplied';
  const entered = !!f.ar?.enteredOn;
  const moved = !!(f.ar?.transferredTo || f.ar?.consolidatedInto);
  const lastCharge = posted.filter((l) => l.type === 'charge').map((l) => l.serviceDate).filter(Boolean).sort().pop();
  const since = f.ar?.enteredOn || r?.departureDate || lastCharge || null;
  const dueDate = f.ar?.dueDate || (since ? dueOf(since, terms) : null);
  const open = balance > 0.005;
  const overdueDays = open && !inHouse && dueDate && dueDate < today ? daysBetween(dueDate, today) : 0;
  const status = moved ? 'moved' : unapplied ? 'unapplied' : inHouse ? 'inHouse' : !open ? (Math.abs(balance) < 0.005 ? 'paid' : 'credit') : !entered ? 'bin' : 'open';
  return {
    folioId: String(f._id), number: f.ar?.number || null, origin: f.ar?.origin || 'stay', status, folioStatus: f.status,
    reservationId: r ? String(r._id) : null, confirmationNumber: r?.confirmationNumber || null,
    guest: r?.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : (posted.find((l) => l.type === 'charge')?.description || f.ar?.note || null),
    arrivalDate: r?.arrivalDate || null, departureDate: r?.departureDate || null,
    enteredOn: f.ar?.enteredOn || null, since, dueDate, overdueDays, age: inHouse || !since ? 0 : Math.max(0, daysBetween(since, today)),
    charged, paid, adjusted, balance, ref: f.ar?.ref || null, note: f.ar?.note || null,
    consolidatedFrom: (f.ar?.consolidatedFrom || []).map(String), consolidatedOn: f.ar?.consolidatedOn || null,
    movedTo: f.ar?.transferredTo ? String(f.ar.transferredTo) : f.ar?.consolidatedInto ? String(f.ar.consolidatedInto) : null,
  };
}

async function companyFolios(propertyId, companyIds, { includeClosed = false } = {}) {
  const q = { property: propertyId, ownerType: 'company' };
  if (companyIds) q.ownerRef = { $in: companyIds.map(String) };
  if (!includeClosed) q.status = { $ne: 'closed' };
  const folios = await Folio.find(q).select('reservation ownerRef status lines ar createdAt').lean();
  const res = new Map((await Reservation.find({ _id: { $in: folios.map((f) => f.reservation).filter(Boolean) } })
    .select('confirmationNumber status arrivalDate departureDate primaryGuest').populate('primaryGuest', 'firstName lastName').lean()).map((r) => [String(r._id), r]));
  return folios.map((f) => ({ f, r: f.reservation ? res.get(String(f.reservation)) : null }));
}

const BUCKETS = [['b0', 30], ['b30', 60], ['b60', 90], ['b90', Infinity]];
function accountRow(c, debts) {
  const row = {
    companyId: String(c._id), name: c.name, taxId: c.taxId || null, number: c.ar?.number || null, arActive: !!c.ar?.active, type: c.ar?.type || null,
    restricted: !!c.ar?.restricted, creditLimit: c.creditLimit || 0, paymentTerms: c.paymentTerms || null, termsLabel: termsLabel(c.paymentTerms),
    contact: { name: c.ar?.billing?.name || c.contactName || null, email: c.ar?.billing?.email || c.email || null, phone: c.ar?.billing?.phone || c.phone || null },
    total: 0, inHouse: 0, bin: 0, binCount: 0, b0: 0, b30: 0, b60: 0, b90: 0, overdue: 0, unapplied: 0, items: [],
  };
  for (const d of debts) {
    if (d.status === 'unapplied') { row.unapplied = round2(row.unapplied - d.balance); continue; }
    if (d.status === 'moved' || Math.abs(d.balance) < 0.005) continue;
    row.items.push(d);
    if (d.status === 'inHouse') row.inHouse = round2(row.inHouse + d.balance);
    else {
      if (d.status === 'bin') { row.bin = round2(row.bin + d.balance); row.binCount += 1; }
      row[BUCKETS.find(([, max]) => d.age <= max)[0]] = round2(row[BUCKETS.find(([, max]) => d.age <= max)[0]] + d.balance);
    }
    if (d.overdueDays > 0) row.overdue = round2(row.overdue + d.balance);
  }
  row.debts = round2(row.items.reduce((s, d) => s + d.balance, 0));
  row.total = round2(row.debts - row.unapplied);
  row.overLimit = row.creditLimit > 0 && row.debts > row.creditLimit + 0.005;
  row.items.sort((a, b) => String(a.since || '').localeCompare(String(b.since || '')));
  return row;
}

// ── Overview: every account with a balance, or an AR account ───────────────
export async function receivables({ propertyId }) {
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const all = await companyFolios(propertyId);
  const byCompany = new Map();
  for (const x of all) byCompany.set(String(x.f.ownerRef), [...(byCompany.get(String(x.f.ownerRef)) || []), x]);
  const companies = await Company.find({ property: propertyId, $or: [{ _id: { $in: [...byCompany.keys()].filter(isId) } }, { 'ar.active': true }] })
    .select('name taxId creditLimit paymentTerms contactName email phone ar').lean();
  const rows = companies.map((c) => accountRow(c, (byCompany.get(String(c._id)) || []).map(({ f, r }) => summarize(f, r, today, c.paymentTerms))))
    .filter((r) => r.arActive || r.items.length || r.unapplied > 0.005)
    .sort((a, b) => b.total - a.total);
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  return {
    today, holdBin: property.arPolicy?.holdBin !== false, writeOffApprovalOver: Number(property.arPolicy?.writeOffApprovalOver ?? 0), rows,
    totals: { total: sum('total'), inHouse: sum('inHouse'), b0: sum('b0'), b30: sum('b30'), b60: sum('b60'), b90: sum('b90'), overdue: sum('overdue'), unapplied: sum('unapplied'), bin: sum('bin'), binCount: rows.reduce((s, r) => s + r.binCount, 0), overLimit: rows.filter((r) => r.overLimit).length },
    config: { types: AR_TYPES, terms: AR_TERMS, adjustReasons: ADJUST_REASONS, cycles: REMINDER_CYCLES },
  };
}

// ── Account ──────────────────────────────────────────────────────────────────
export async function saveAccount({ propertyId, companyId, input, actor, ip }) {
  const c = await loadCompany(propertyId, companyId);
  const before = c.ar ? JSON.parse(JSON.stringify(c.ar)) : null;
  const fields = {};
  const ar = c.ar || {};
  let number = txt(input.number, 20);
  if (number && await Company.exists({ property: propertyId, 'ar.number': number, _id: { $ne: c._id } })) fields.number = 'מספר חשבון תפוס';
  if (input.type && !AR_TYPES[input.type]) fields.type = 'סוג לא תקין';
  if (input.paymentTerms !== undefined && !AR_TERMS[input.paymentTerms]) fields.paymentTerms = 'תנאי תשלום לא תקינים';
  const limit = input.creditLimit === undefined || input.creditLimit === '' ? null : Number(input.creditLimit);
  if (limit !== null && !(limit >= 0)) fields.creditLimit = 'מסגרת לא תקינה';
  const email = txt(input.billing?.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.billingEmail = 'כתובת דוא״ל לא תקינה';
  const restricted = input.restricted === undefined ? !!ar.restricted : !!input.restricted;
  const restrictedReason = txt(input.restrictedReason, 200);
  if (restricted && !ar.restricted && restrictedReason.length < 3) fields.restrictedReason = 'סיבה להגבלה';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי החשבון', 422, { fields });
  if (!number && !ar.number) number = `AR-${String(await getNextSequenceValue(`ar-account:${propertyId}`)).padStart(5, '0')}`;
  c.ar = {
    ...(c.ar?.toObject ? c.ar.toObject() : ar),
    active: input.active === undefined ? true : !!input.active,
    number: number || ar.number,
    type: input.type || ar.type || 'standard',
    restricted, restrictedReason: restricted ? (restrictedReason || ar.restrictedReason) : undefined,
    inStatements: input.inStatements === undefined ? ar.inStatements !== false : !!input.inStatements,
    permanent: input.permanent === undefined ? !!ar.permanent : !!input.permanent,
    billing: input.billing ? { name: txt(input.billing.name, 120) || undefined, email: email || undefined, phone: txt(input.billing.phone, 30) || undefined, address: txt(input.billing.address, 300) || undefined } : ar.billing,
    openedAt: ar.openedAt || new Date(), openedByName: ar.openedByName || actor.name,
  };
  if (input.paymentTerms !== undefined) c.paymentTerms = input.paymentTerms;
  if (limit !== null) c.creditLimit = limit;
  await c.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: before?.active ? 'ar.account_updated' : 'ar.account_opened', entityType: 'Company', entityId: c._id, before, after: { ...c.ar.toObject(), paymentTerms: c.paymentTerms, creditLimit: c.creditLimit }, reason: restricted && !before?.restricted ? restrictedReason : undefined, ip });
  return { companyId: String(c._id), number: c.ar.number };
}

export async function getAccount({ propertyId, companyId, view = 'open', q }) {
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const c = (await loadCompany(propertyId, companyId)).toObject();
  const all = (await companyFolios(propertyId, [companyId], { includeClosed: true })).map(({ f, r }) => ({ f, d: summarize(f, r, today, c.paymentTerms) }));
  const row = accountRow(c, all.filter(({ f }) => f.status !== 'closed').map(({ d }) => d));
  let debts = all.map(({ d }) => d).filter((d) => d.status !== 'unapplied');
  if (view === 'open') debts = debts.filter((d) => Math.abs(d.balance) > 0.005 && d.status !== 'moved');
  const term = txt(q, 60).toLowerCase();
  if (term) debts = debts.filter((d) => [d.number, d.confirmationNumber, d.guest, d.since, d.ref].some((v) => String(v || '').toLowerCase().includes(term)));
  debts.sort((a, b) => String(b.since || '').localeCompare(String(a.since || '')));
  // Payments: money in on any folio of the account, with where it sits now.
  const numberOf = new Map(all.map(({ f, d }) => [String(f._id), d.number || d.confirmationNumber || (d.status === 'unapplied' ? 'על החשבון' : 'חוב')]));
  const payments = [];
  for (const { f, d } of all) {
    const lines = f.lines.filter((l) => l.status === 'posted');
    const undone = new Set([...lines.filter((l) => ['unalloc', 'void'].includes(l.arLink?.kind)).map((l) => String(l.reversalOf)), ...lines.filter((l) => l.type === 'refund' && l.refundOf).map((l) => String(l.refundOf))]);
    for (const l of lines) {
      const k = l.arLink?.kind;
      const isIn = (['payment', 'deposit'].includes(l.type) && !k) || k === 'alloc' || (k === 'unalloc_in' && d.status === 'unapplied');
      if (!isIn) continue;
      payments.push({
        folioId: String(f._id), lineId: String(l._id), date: l.serviceDate, amount: round2(-gross(l)), method: l.method || null, methodRef: l.methodRef || null,
        description: l.description, where: d.status === 'unapplied' ? 'על החשבון' : numberOf.get(String(f._id)), unapplied: d.status === 'unapplied', allocated: k === 'alloc', returned: k === 'unalloc_in',
        undone: undone.has(String(l._id)), canUnallocate: d.status !== 'unapplied' && !undone.has(String(l._id)) && k !== 'unalloc_in', canVoid: k !== 'alloc' && !undone.has(String(l._id)),
      });
    }
  }
  payments.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  // Year view: what was charged and what came in, month by month (last 12 months).
  const months = [];
  for (let i = 11; i >= 0; i -= 1) { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); months.push({ month: d.toISOString().slice(0, 7), charged: 0, paid: 0 }); }
  const mIdx = new Map(months.map((m, i) => [m.month, i]));
  for (const { f } of all) {
    const lines = f.lines.filter((l) => l.status === 'posted');
    const movedOut = new Set(lines.filter((l) => l.arLink?.kind === 'out').map((l) => String(l.reversalOf)));
    for (const l of lines) {
      const i = mIdx.get(String(l.accountingDate || l.serviceDate || '').slice(0, 7));
      const k = l.arLink?.kind;
      if (i === undefined || k === 'out' || movedOut.has(String(l._id)) || (MOVE_KINDS.includes(k) && k !== 'void_offset')) continue;
      if (PAY_TYPES.includes(l.type) || k === 'void') months[i].paid = round2(months[i].paid - gross(l));
      else if (k !== 'writeoff' && f.ar?.origin !== 'unapplied') months[i].charged = round2(months[i].charged + gross(l));
    }
  }
  const [notes, letters, future] = await Promise.all([
    ArNote.find({ property: propertyId, company: companyId }).sort({ createdAt: -1 }).limit(100).lean(),
    ArLetter.find({ property: propertyId, company: companyId }).select('-snapshot').sort({ createdAt: -1 }).limit(50).lean(),
    Reservation.find({ property: propertyId, status: { $in: ACTIVE_RES }, departureDate: { $gte: today }, $or: [{ 'voucher.payerRef': String(companyId) }, { company: companyId }, { travelAgent: companyId }] })
      .select('confirmationNumber status arrivalDate departureDate totalAmount voucher primaryGuest').populate('primaryGuest', 'firstName lastName').sort({ arrivalDate: 1 }).limit(50).lean(),
  ]);
  return {
    today,
    account: {
      companyId: String(c._id), name: c.name, taxId: c.taxId || null, address: c.address || null, active: !!c.ar?.active, number: c.ar?.number || null, type: c.ar?.type || 'standard',
      typeLabel: AR_TYPES[c.ar?.type || 'standard'], paymentTerms: c.paymentTerms || 'immediate', termsLabel: termsLabel(c.paymentTerms), creditLimit: c.creditLimit || 0,
      restricted: !!c.ar?.restricted, restrictedReason: c.ar?.restrictedReason || null, inStatements: c.ar?.inStatements !== false, permanent: !!c.ar?.permanent,
      billing: c.ar?.billing || {}, contact: { name: c.contactName || null, email: c.email || null, phone: c.phone || null }, openedAt: c.ar?.openedAt || null, openedByName: c.ar?.openedByName || null,
      recurring: (c.ar?.recurring || []).map((x) => ({ id: String(x._id), code: x.code, description: x.description, amount: x.amount, day: x.day, active: x.active !== false, lastPeriod: x.lastPeriod || null })),
    },
    summary: { total: row.total, debts: row.debts, unapplied: row.unapplied, overdue: row.overdue, inHouse: row.inHouse, bin: row.bin, binCount: row.binCount, b0: row.b0, b30: row.b30, b60: row.b60, b90: row.b90, overLimit: row.overLimit },
    debts: debts.slice(0, 300), payments: view === 'payments' ? payments : payments.slice(0, 50), year: months,
    notes: notes.filter((n) => n.kind === 'note').map(noteDto), traces: notes.filter((n) => n.kind === 'trace').map(noteDto),
    letters: letters.map(letterDto),
    future: future.map((r) => ({ reservationId: String(r._id), confirmationNumber: r.confirmationNumber, status: r.status, arrivalDate: r.arrivalDate, departureDate: r.departureDate, totalAmount: r.totalAmount, guest: r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : null, payer: r.voucher?.payerRef === String(companyId) ? (r.voucher.type || 'voucher') : null })),
    config: { types: AR_TYPES, terms: AR_TERMS, adjustReasons: ADJUST_REASONS, cycles: REMINDER_CYCLES[c.ar?.type || 'standard'] },
  };
}
const noteDto = (n) => ({ id: String(n._id), kind: n.kind, text: n.text, dueDate: n.dueDate || null, done: !!n.done, doneAt: n.doneAt || null, doneByName: n.doneByName || null, byName: n.byName || null, at: n.createdAt });
const letterDto = (l) => ({ id: String(l._id), kind: l.kind, level: l.level || null, from: l.from || null, to: l.to || null, via: l.via, email: l.email || null, balance: l.balance, byName: l.byName, at: l.createdAt, batch: l.batch || null });

export async function getDebt({ propertyId, folioId }) {
  const property = await loadProperty(propertyId);
  const f = await loadDebt(propertyId, folioId);
  const c = await Company.findById(f.ownerRef).select('name paymentTerms').lean();
  const r = f.reservation ? await Reservation.findById(f.reservation).select('confirmationNumber status arrivalDate departureDate primaryGuest').populate('primaryGuest', 'firstName lastName').lean() : null;
  const d = summarize(f.toObject(), r, businessDateOf(property), c?.paymentTerms);
  return {
    ...d, companyId: String(f.ownerRef), companyName: c?.name || null,
    lines: f.lines.map((l) => ({ id: String(l._id), type: l.type, description: l.description, serviceDate: l.serviceDate, gross: gross(l), status: l.status, department: l.department || null, method: l.method || null, arKind: l.arLink?.kind || null, reason: l.reason || null, reversalOf: l.reversalOf ? String(l.reversalOf) : null })),
  };
}

// ── Holding bin: departed balances wait here until accounting enters them ───
async function enterDebts(propertyId, folios, { today, terms, actor }) {
  const out = [];
  for (const f of folios) {
    f.ar = { ...(f.ar?.toObject ? f.ar.toObject() : f.ar || {}), origin: f.ar?.origin || 'stay', number: f.ar?.number || await nextDebtNumber(propertyId), enteredOn: today, dueDate: dueOf(today, terms.get(String(f.ownerRef))), enteredByName: actor.name };
    await f.save();
    out.push({ folioId: String(f._id), number: f.ar.number });
  }
  return out;
}
async function binFolios(propertyId, folioIds = null) {
  const q = { property: propertyId, ownerType: 'company', status: { $ne: 'closed' }, 'ar.enteredOn': { $exists: false }, reservation: { $ne: null } };
  if (folioIds) q._id = { $in: folioIds.filter(isId) };
  const folios = await Folio.find(q);
  const res = new Map((await Reservation.find({ _id: { $in: folios.map((f) => f.reservation) } }).select('status').lean()).map((r) => [String(r._id), r.status]));
  return folios.filter((f) => folioBalance(f) > 0.005 && res.get(String(f.reservation)) === 'checked_out');
}
export async function approveBin({ propertyId, folioIds, actor, ip }) {
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const folios = await binFolios(propertyId, Array.isArray(folioIds) && folioIds.length ? folioIds.map(String) : null);
  if (!folios.length) throw httpError('אין בסל חובות לאישור', 409);
  const terms = new Map((await Company.find({ _id: { $in: folios.map((f) => f.ownerRef).filter(isId) } }).select('paymentTerms').lean()).map((c) => [String(c._id), c.paymentTerms]));
  const entered = await enterDebts(propertyId, folios, { today, terms, actor });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.bin_approved', entityType: 'Property', entityId: propertyId, after: { count: entered.length, numbers: entered.map((e) => e.number) }, ip });
  return { entered };
}
// Day close: without a holding bin, departed balances enter the accounts automatically; recurring
// charges of the month are posted. Never fails the close — errors are audited.
export async function arDayCloseHook({ propertyId, actor }) {
  const out = { entered: 0, recurring: 0 };
  try {
    const property = await loadProperty(propertyId);
    if (property.arPolicy?.holdBin === false) {
      const folios = await binFolios(propertyId);
      if (folios.length) {
        const terms = new Map((await Company.find({ _id: { $in: folios.map((f) => f.ownerRef).filter(isId) } }).select('paymentTerms').lean()).map((c) => [String(c._id), c.paymentTerms]));
        out.entered = (await enterDebts(propertyId, folios, { today: businessDateOf(property), terms, actor })).length;
      }
    }
    out.recurring = (await runRecurring({ propertyId, actor })).created.length;
  } catch (e) {
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.day_close_failed', entityType: 'Property', entityId: propertyId, after: { error: String(e.message || e).slice(0, 300) } }).catch(() => null);
  }
  return out;
}
export async function setPolicy({ propertyId, input, actor, ip }) {
  const before = (await loadProperty(propertyId)).arPolicy || {};
  const set = {};
  if (input.holdBin !== undefined) set['arPolicy.holdBin'] = !!input.holdBin;
  if (input.writeOffApprovalOver !== undefined) {
    const n = Number(input.writeOffApprovalOver);
    if (!(n >= 0)) throw httpError('סכום לא תקין', 422, { fields: { writeOffApprovalOver: 'סכום' } });
    set['arPolicy.writeOffApprovalOver'] = n;
  }
  await Property.updateOne({ _id: propertyId }, { $set: set });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.policy_updated', entityType: 'Property', entityId: propertyId, before, after: set, ip });
  return { ok: true };
}

// ── New debt directly on the account (no stay), recurring and batch charges ─
export async function newDebt({ propertyId, companyId, input, actor, ip, origin = 'direct' }) {
  const ref = opRef(input.idempotencyKey);
  const existing = await Folio.findOne({ property: propertyId, 'ar.opKey': ref }).lean();
  if (existing) return { folioId: String(existing._id), number: existing.ar.number, duplicate: true };
  const c = await loadCompany(propertyId, companyId);
  if (!c.ar?.active) throw httpError(`ל${c.name} אין חשבון חייבים פעיל`, 409, { code: 'ar_inactive' });
  assertOpen(c);
  const amount = round2(input.amount);
  const fields = {};
  if (!(amount > 0)) fields.amount = 'סכום חיובי';
  if (!input.code) fields.code = 'קוד חיוב';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי החוב', 422, { fields });
  await resolveChargeCode({ propertyId, code: input.code, actorRole: actor.role, unitPrice: amount });
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const number = await nextDebtNumber(propertyId);
  const newId = new mongoose.Types.ObjectId();
  return multiWrite(propertyId, [String(newId)], async (session, afterCommit) => {
    await Folio.create([{
      _id: newId, property: propertyId, ownerType: 'company', ownerRef: String(c._id), currency: 'ILS', lines: [],
      ar: { number, origin, enteredOn: today, dueDate: dueOf(today, c.paymentTerms), ref: txt(input.ref, 60) || undefined, note: txt(input.note, 200) || undefined, opKey: ref, enteredByName: actor.name },
    }], { session });
    await postCharge({ propertyId, folioId: String(newId), input: { department: input.code, unitPrice: amount, quantity: 1, description: txt(input.description, 200) || undefined, serviceDate: YMD.test(input.serviceDate || '') ? input.serviceDate : undefined, reason: txt(input.note, 200) || undefined, idempotencyKey: `${String(input.idempotencyKey).slice(0, 70)}-c`, auditAction: 'ar.debt_charge' }, actor, ip, session, afterCommit });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `ar.debt_${origin}`, entityType: 'Folio', entityId: newId, after: { number, companyId: String(c._id), amount, code: input.code }, ip, session, afterCommit });
    return { folioId: String(newId), number, duplicate: false };
  });
}

export async function debtCharge({ propertyId, folioId, input, actor, ip }) {
  const f = await loadDebt(propertyId, folioId);
  if (f.ar?.origin === 'unapplied') throw httpError('לא מחייבים את "על החשבון"', 422);
  assertOpen(await loadCompany(propertyId, f.ownerRef));
  if (f.reservation) {
    const r = await Reservation.findById(f.reservation).select('status').lean();
    if (r?.status === 'checked_out') return postCharge({ propertyId, folioId, input: { ...input, auditAction: 'folio.post_stay_charge', reason: input.reason || 'חיוב נוסף בחשבון חייבים' }, actor, ip });
  }
  return postCharge({ propertyId, folioId, input: { ...input, auditAction: 'ar.debt_charge' }, actor, ip });
}

export async function massCharge({ propertyId, input, actor, ip }) {
  const key = String(input.idempotencyKey || '').trim();
  opRef(key);
  const amount = round2(input.amount);
  if (!(amount > 0)) throw httpError('סכום חיובי', 422, { fields: { amount: 'סכום' } });
  const q = { property: propertyId, 'ar.active': true, 'ar.restricted': { $ne: true } };
  if (input.type && input.type !== 'all') q['ar.type'] = input.type;
  const accounts = await Company.find(q).select('name creditLimit').lean();
  const exposures = await receivables({ propertyId });
  const created = []; const skipped = [];
  for (const c of accounts) {
    const row = exposures.rows.find((r) => r.companyId === String(c._id));
    if (!input.overrideLimit && c.creditLimit > 0 && (row?.debts || 0) + amount > c.creditLimit + 0.005) { skipped.push({ companyId: String(c._id), name: c.name, reason: 'חריגה ממסגרת' }); continue; }
    const out = await newDebt({ propertyId, companyId: String(c._id), input: { code: input.code, amount, description: input.description, note: input.note, idempotencyKey: `${key.slice(0, 50)}-${String(c._id).slice(-12)}` }, actor, ip, origin: 'mass' });
    created.push({ companyId: String(c._id), name: c.name, number: out.number, duplicate: out.duplicate });
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.mass_charge', entityType: 'Property', entityId: propertyId, after: { code: input.code, amount, type: input.type || 'all', created: created.length, skipped: skipped.length, overrideLimit: !!input.overrideLimit }, ip });
  return { created, skipped };
}

export async function saveRecurring({ propertyId, companyId, input, actor, ip }) {
  const c = await loadCompany(propertyId, companyId);
  if (!c.ar?.active) throw httpError('יש לפתוח חשבון חייבים קודם', 409);
  if (input.id) {
    const x = c.ar.recurring.id(input.id);
    if (!x) throw httpError('החיוב הקבוע לא נמצא', 404);
    x.active = !!input.active;
  } else {
    const amount = round2(input.amount); const day = Number(input.day);
    const fields = {};
    if (!(amount > 0)) fields.amount = 'סכום חיובי';
    if (!(day >= 1 && day <= 28)) fields.day = 'יום 1–28';
    if (!input.code) fields.code = 'קוד חיוב';
    if (Object.keys(fields).length) throw httpError('יש לתקן את החיוב הקבוע', 422, { fields });
    await resolveChargeCode({ propertyId, code: input.code, actorRole: actor.role, unitPrice: amount });
    c.ar.recurring.push({ code: input.code, description: txt(input.description, 120) || undefined, amount, day, active: true, byName: actor.name });
  }
  await c.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.recurring_saved', entityType: 'Company', entityId: c._id, after: { recurring: c.ar.recurring.map((x) => ({ code: x.code, amount: x.amount, day: x.day, active: x.active })) }, ip });
  return { ok: true };
}

export async function runRecurring({ propertyId, actor, ip }) {
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const period = today.slice(0, 7); const day = Number(today.slice(8, 10));
  const accounts = await Company.find({ property: propertyId, 'ar.active': true, 'ar.recurring': { $elemMatch: { active: true, day: { $lte: day }, lastPeriod: { $ne: period } } } });
  const created = []; const skipped = [];
  for (const c of accounts) {
    for (const x of c.ar.recurring.filter((r) => r.active !== false && r.day <= day && r.lastPeriod !== period)) {
      if (c.ar.restricted) { skipped.push({ name: c.name, reason: 'חשבון מוגבל' }); continue; }
      const out = await newDebt({ propertyId, companyId: String(c._id), input: { code: x.code, amount: x.amount, description: x.description ? `${x.description} · ${period}` : undefined, note: `חיוב קבוע ${period}`, idempotencyKey: `rec-${String(x._id)}-${period}` }, actor, ip, origin: 'recurring' });
      await Company.updateOne({ _id: c._id, 'ar.recurring._id': x._id }, { $set: { 'ar.recurring.$.lastPeriod': period } });
      created.push({ name: c.name, number: out.number });
    }
  }
  return { period, created, skipped };
}

// ── Adjustment / write-off ───────────────────────────────────────────────────
export async function adjustDebt({ propertyId, folioId, input, actor, ip }) {
  const property = await loadProperty(propertyId);
  const reason = ADJUST_REASONS[input.reason] ? input.reason : null;
  const note = txt(input.note, 200);
  if (!reason) throw httpError('יש לבחור סיבה', 422, { fields: { reason: 'סיבה' } });
  if (reason === 'other' && note.length < 3) throw httpError('יש לפרט את הסיבה', 422, { fields: { note: 'פירוט' } });
  const code = await resolveChargeCode({ propertyId, code: input.code || 'other', actorRole: actor.role });
  return multiWrite(propertyId, [folioId], async (session, afterCommit) => {
    const f = await loadDebt(propertyId, folioId, session);
    const ref = opRef(input.idempotencyKey);
    if (hasRef(f, ref)) return { folioId, duplicate: true, balance: folioBalance(f) };
    const balance = folioBalance(f);
    if (!(balance > 0.005)) throw httpError('אין בחוב יתרה פתוחה', 409);
    const amount = input.percent ? round2(balance * Number(input.percent) / 100) : round2(input.amount);
    if (!(amount > 0) || amount - balance > 0.005) throw httpError(`סכום ההתאמה עד ${balance.toFixed(2)}`, 422, { fields: { amount: 'עד היתרה' } });
    const limit = Number(property.arPolicy?.writeOffApprovalOver ?? 0);
    if (amount > limit + 0.005 && !AR_ROLES_MANAGE.includes(actor.role)) throw httpError(`התאמה מעל ${limit.toFixed(2)} דורשת אישור כספים או מנהל כללי`, 403, { code: 'approval_required' });
    f.lines.push({
      type: 'adjustment', description: `${ADJUST_REASONS[reason]}${note ? ` — ${note}` : ''}`.slice(0, 200), amount: -amount, taxAmount: 0, department: code.code,
      serviceDate: businessDateOf(property), source: 'manual', status: 'posted', reference: ref, reason: `${reason}${note ? `: ${note}` : ''}`.slice(0, 300),
      arLink: { kind: 'writeoff' }, createdBy: actor.id || undefined,
    });
    await f.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.adjusted', entityType: 'Folio', entityId: f._id, reason: ADJUST_REASONS[reason], after: { number: f.ar?.number, amount, code: code.code, note }, ip, session, afterCommit });
    return { folioId, amount, balance: folioBalance(f), duplicate: false };
  });
}

// ── Moving debts: transfer to another account, consolidation (and its undo) ─
function liveLines(f) {
  const posted = f.lines.filter((l) => l.status === 'posted');
  const reversed = new Set(posted.filter((l) => l.reversalOf).map((l) => String(l.reversalOf)));
  return posted.filter((l) => !l.reversalOf && !reversed.has(String(l._id)));
}
async function assertMovable(f, session) {
  if (f.ar?.origin === 'unapplied') throw httpError('"על החשבון" אינו חוב', 422);
  if (f.ar?.transferredTo || f.ar?.consolidatedInto) throw httpError(`החוב ${f.ar?.number || ''} כבר הועבר`, 409);
  const live = liveLines(f);
  if (live.some((l) => PAY_TYPES.includes(l.type) || l.arLink)) throw httpError(`בחוב ${f.ar?.number || ''} יש תשלומים או התאמות — קודם מבטלים את השיוך`, 409, { code: 'has_payments' });
  if (!(folioBalance(f) > 0.005)) throw httpError(`בחוב ${f.ar?.number || ''} אין יתרה`, 409);
  const onDocs = (await docCoverage(f._id, session)).charges;
  const inv = live.find((l) => onDocs.has(String(l._id)));
  if (inv) throw httpError(`החוב כלול במסמך ${onDocs.get(String(inv._id))} — העברה דורשת זיכוי במערכת החשבוניות`, 409, { code: 'on_document' });
  return live;
}
// Moves every live line of src to dst: a reversal on src (arLink out, hidden on statements), a copy on dst.
function moveLines(src, dst, live, { ref, label, actor, today }) {
  const idMap = new Map();
  for (const l of live) idMap.set(String(l._id), new mongoose.Types.ObjectId());
  for (const l of live) {
    src.lines.push({ type: 'adjustment', description: `הועבר ל${label}: ${l.description}`.slice(0, 200), amount: -round2(l.amount), taxAmount: -round2(l.taxAmount || 0), vatRate: l.vatRate, taxReason: l.taxReason, department: l.department, serviceDate: today, source: 'routing', status: 'posted', reference: `${ref}:${l._id}:out`, reversalOf: l._id, arLink: { kind: 'out', folio: dst._id, number: dst.ar?.number }, createdBy: actor.id || undefined });
    dst.lines.push({ _id: idMap.get(String(l._id)), ...(l.discountOf && idMap.has(String(l.discountOf)) ? { discountOf: idMap.get(String(l.discountOf)) } : {}), type: l.type, description: l.description, amount: round2(l.amount), taxAmount: round2(l.taxAmount || 0), vatRate: l.vatRate, taxReason: l.taxReason, department: l.department, serviceDate: l.serviceDate, quantity: l.quantity, unitPrice: l.unitPrice, source: 'routing', status: 'posted', reference: `${ref}:${l._id}:in`, transferFrom: { folio: src._id, line: l._id, label: src.ar?.number || 'חוב' }, createdBy: actor.id || undefined });
  }
}

export async function transferDebt({ propertyId, folioId, input, actor, ip }) {
  const reason = txt(input.reason, 200);
  if (reason.length < 3) throw httpError('יש לפרט סיבה להעברה', 422, { fields: { reason: 'סיבה' } });
  const pre = await loadDebt(propertyId, folioId);
  if (String(pre.ownerRef) === String(input.toCompanyId)) throw httpError('החוב כבר בחשבון הזה', 422);
  const to = await loadCompany(propertyId, input.toCompanyId);
  assertOpen(to);
  const ref = opRef(input.idempotencyKey);
  const dup = await Folio.findOne({ property: propertyId, 'ar.opKey': ref }).select('ar').lean();
  if (dup) return { folioId: String(dup._id), number: dup.ar.number, duplicate: true };
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const number = await nextDebtNumber(propertyId);
  const newId = new mongoose.Types.ObjectId();
  return multiWrite(propertyId, [folioId, String(newId)], async (session, afterCommit) => {
    const src = await loadDebt(propertyId, folioId, session);
    const live = await assertMovable(src, session);
    const from = await Company.findById(src.ownerRef).session(session).select('name').lean();
    const [dst] = await Folio.create([{ _id: newId, property: propertyId, reservation: src.reservation || undefined, ownerType: 'company', ownerRef: String(to._id), currency: src.currency || 'ILS', lines: [], ar: { number, origin: 'transfer', enteredOn: src.ar?.enteredOn || today, dueDate: dueOf(src.ar?.enteredOn || today, to.paymentTerms), ref: src.ar?.ref, note: src.ar?.note, opKey: ref, transferFrom: src._id, enteredByName: actor.name } }], { session });
    moveLines(src, dst, live, { ref, label: to.name, actor, today });
    src.ar = { ...(src.ar?.toObject ? src.ar.toObject() : src.ar || {}), transferredTo: dst._id };
    src.status = 'closed'; src.closedAt = new Date(); src.closedBy = actor.id || undefined;
    await src.save({ session });
    await dst.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.debt_transferred', entityType: 'Folio', entityId: src._id, reason, after: { from: from?.name, to: to.name, number: src.ar?.number || null, newNumber: number, newFolio: String(dst._id), amount: folioBalance(dst) }, ip, session, afterCommit });
    return { folioId: String(dst._id), number, duplicate: false };
  });
}

export async function consolidateDebts({ propertyId, companyId, input, actor, ip }) {
  const ids = [...new Set((input.folioIds || []).map(String))];
  if (ids.length < 2 || ids.length > 100) throw httpError('יש לבחור לפחות שני חובות לאיחוד', 422);
  const c = await loadCompany(propertyId, companyId);
  const ref = opRef(input.idempotencyKey);
  const dup = await Folio.findOne({ property: propertyId, 'ar.opKey': ref }).select('ar').lean();
  if (dup) return { folioId: String(dup._id), number: dup.ar.number, duplicate: true };
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const number = await nextDebtNumber(propertyId);
  const newId = new mongoose.Types.ObjectId();
  return multiWrite(propertyId, [...ids, String(newId)], async (session, afterCommit) => {
    const srcs = [];
    for (const id of ids) {
      const f = await loadDebt(propertyId, id, session);
      if (String(f.ownerRef) !== String(c._id)) throw httpError('אפשר לאחד רק חובות של אותו חשבון', 422);
      if (!f.ar?.enteredOn) throw httpError('חוב שעדיין בסל — קודם מאשרים אותו', 409);
      srcs.push({ f, live: await assertMovable(f, session) });
    }
    const entered = srcs.map((s) => s.f.ar.enteredOn).sort()[0];
    const [dst] = await Folio.create([{ _id: newId, property: propertyId, ownerType: 'company', ownerRef: String(c._id), currency: 'ILS', lines: [], ar: { number, origin: 'consolidated', enteredOn: entered, dueDate: srcs.map((s) => s.f.ar.dueDate).filter(Boolean).sort()[0] || dueOf(entered, c.paymentTerms), ref: txt(input.ref, 60) || undefined, note: txt(input.note, 200) || `איחוד ${srcs.length} חובות`, opKey: ref, consolidatedFrom: srcs.map((s) => s.f._id), consolidatedOn: today, enteredByName: actor.name } }], { session });
    for (const { f, live } of srcs) {
      moveLines(f, dst, live, { ref, label: `חוב ${number}`, actor, today });
      f.ar = { ...f.ar.toObject(), consolidatedInto: dst._id };
      f.status = 'closed'; f.closedAt = new Date(); f.closedBy = actor.id || undefined;
      await f.save({ session });
    }
    await dst.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.debts_consolidated', entityType: 'Folio', entityId: dst._id, after: { number, from: srcs.map((s) => s.f.ar.number), amount: folioBalance(dst) }, ip, session, afterCommit });
    return { folioId: String(dst._id), number, duplicate: false };
  });
}

export async function unconsolidateDebt({ propertyId, folioId, actor, ip }) {
  const pre = await loadDebt(propertyId, folioId);
  if (pre.ar?.origin !== 'consolidated') throw httpError('זה אינו חוב מאוחד', 422);
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  if (pre.ar.consolidatedOn !== today) throw httpError('ביטול איחוד אפשרי רק ביום האיחוד', 409);
  const ids = (pre.ar.consolidatedFrom || []).map(String);
  return multiWrite(propertyId, [folioId, ...ids], async (session, afterCommit) => {
    const dst = await loadDebt(propertyId, folioId, session);
    if (dst.status === 'closed') return { folioId, duplicate: true };
    const live = liveLines(dst);
    if (live.some((l) => PAY_TYPES.includes(l.type) || l.arLink)) throw httpError('בחוב המאוחד יש תשלומים או התאמות — קודם מבטלים את השיוך', 409);
    const ref = `op:uncons-${String(dst._id)}`;
    for (const id of ids) {
      const src = await loadDebt(propertyId, id, session);
      const back = live.filter((l) => String(l.transferFrom?.folio || '') === id);
      moveLines(dst, src, back, { ref: `${ref}-${id}`, label: `חוב ${src.ar?.number || ''}`, actor, today });
      const ar = src.ar.toObject(); delete ar.consolidatedInto;
      src.ar = ar; src.status = 'open'; src.closedAt = undefined; src.closedBy = undefined;
      await src.save({ session });
    }
    dst.status = 'closed'; dst.closedAt = new Date(); dst.closedBy = actor.id || undefined;
    await dst.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.debts_unconsolidated', entityType: 'Folio', entityId: dst._id, after: { number: dst.ar.number, restored: ids.length }, ip, session, afterCommit });
    return { folioId, restored: ids.length, duplicate: false };
  });
}

// ── Payments ─────────────────────────────────────────────────────────────────
async function unappliedFolio(propertyId, company, { create = true } = {}) {
  let f = await Folio.findOne({ property: propertyId, ownerType: 'company', ownerRef: String(company._id), 'ar.origin': 'unapplied', status: { $ne: 'closed' } });
  if (!f && create) f = await Folio.create({ property: propertyId, ownerType: 'company', ownerRef: String(company._id), currency: 'ILS', lines: [], ar: { origin: 'unapplied', number: `${company.ar?.number || 'AR'}-ON`, note: 'תשלומים על החשבון' } });
  return f;
}

// input: { amount, method, details, note, idempotencyKey, mode: 'fifo'|'selected'|'unapplied', allocations?, restUnapplied? }
export async function receiveCompanyPayment({ propertyId, companyId, input, actor, ip }) {
  const c = await loadCompany(propertyId, companyId);
  const key = String(input.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,60}$/.test(key)) throw httpError('חסר מזהה פעולה', 422);
  const amount = round2(input.amount);
  if (!(amount > 0)) throw httpError('סכום חיובי', 422, { fields: { amount: 'סכום' } });
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const items = (await companyFolios(propertyId, [companyId])).map(({ f, r }) => summarize(f, r, today, c.paymentTerms))
    .filter((d) => d.balance > 0.005 && !['unapplied', 'moved'].includes(d.status))
    .sort((a, b) => String(a.since || '').localeCompare(String(b.since || '')));
  const mode = input.mode || (Array.isArray(input.allocations) && input.allocations.length ? 'selected' : 'fifo');
  let plan = []; let rest = 0;
  if (mode === 'unapplied') rest = amount;
  else if (mode === 'selected') {
    plan = (input.allocations || []).map((a) => ({ folioId: String(a.folioId), amount: round2(a.amount) })).filter((a) => a.amount > 0);
    if (!plan.length) throw httpError('יש לחלק את התשלום בין חובות', 422, { fields: { allocations: 'חלוקה' } });
    for (const a of plan) {
      const it = items.find((i) => i.folioId === a.folioId);
      if (!it) throw httpError('חוב שאינו פתוח בחשבון הזה', 422);
      if (a.amount - it.balance > 0.005) throw httpError(`בחוב ${it.number || it.confirmationNumber || ''} היתרה ${it.balance.toFixed(2)} בלבד`, 422);
    }
    const allocated = round2(plan.reduce((s, a) => s + a.amount, 0));
    if (allocated - amount > 0.005) throw httpError('החלוקה גבוהה מסכום התשלום', 422, { fields: { amount: 'חלוקה' } });
    rest = round2(amount - allocated);
    if (rest > 0.005 && !input.restUnapplied) throw httpError(`נשארו ${rest.toFixed(2)} לא מחולקים — חלקו אותם או סמנו "היתרה על החשבון"`, 422, { fields: { amount: 'חלוקה' } });
  } else {
    if (!items.length && !input.restUnapplied) throw httpError('לחברה אין יתרה פתוחה', 409);
    let left = amount;
    for (const it of items) { if (left <= 0.005) break; const part = round2(Math.min(left, it.balance)); plan.push({ folioId: it.folioId, amount: part }); left = round2(left - part); }
    rest = left;
    if (rest > 0.005 && !input.restUnapplied) throw httpError(`הסכום גבוה מהיתרה הפתוחה (${round2(amount - rest).toFixed(2)}) — סמנו "היתרה על החשבון" כדי לרשום את ההפרש כזיכוי`, 422, { fields: { amount: 'מעל היתרה' } });
  }
  const posted = [];
  for (const [i, a] of plan.entries()) {
    const out = await recordFolioPayment({ propertyId, folioId: a.folioId, input: { amount: a.amount, method: input.method, details: input.details || {}, note: input.note, idempotencyKey: `${key}-${i}` }, actor, ip });
    posted.push({ folioId: a.folioId, amount: a.amount, duplicate: out.duplicate, balance: out.balance });
  }
  if (rest > 0.005) {
    if (!c.ar?.active) throw httpError('תשלום על החשבון מחייב חשבון חייבים פעיל', 409);
    const u = await unappliedFolio(propertyId, c);
    const out = await recordFolioPayment({ propertyId, folioId: String(u._id), input: { kind: 'deposit', amount: rest, method: input.method, details: input.details || {}, note: input.note || 'על החשבון', idempotencyKey: `${key}-u` }, actor, ip });
    posted.push({ folioId: String(u._id), amount: rest, unapplied: true, duplicate: out.duplicate });
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'receivable.payment', entityType: 'Company', entityId: companyId, after: { amount, method: input.method, mode, folios: posted.length, unapplied: rest }, ip }).catch(() => null);
  return { amount, posted, unapplied: rest };
}

// Match money sitting "on account" to debts.
export async function allocateUnapplied({ propertyId, companyId, input, actor, ip }) {
  const c = await loadCompany(propertyId, companyId);
  const u0 = await unappliedFolio(propertyId, c, { create: false });
  if (!u0) throw httpError('אין תשלומים על החשבון', 409);
  const plan = (input.allocations || []).map((a) => ({ folioId: String(a.folioId), amount: round2(a.amount) })).filter((a) => a.amount > 0);
  if (!plan.length) throw httpError('יש לבחור חובות ולחלק', 422, { fields: { allocations: 'חלוקה' } });
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  return multiWrite(propertyId, [String(u0._id), ...plan.map((a) => a.folioId)], async (session, afterCommit) => {
    const u = await loadDebt(propertyId, u0._id, session);
    const ref = opRef(input.idempotencyKey);
    if (hasRef(u, ref)) return { duplicate: true };
    const credit = round2(-folioBalance(u));
    const total = round2(plan.reduce((s, a) => s + a.amount, 0));
    if (total - credit > 0.005) throw httpError(`על החשבון יש ${credit.toFixed(2)} בלבד`, 422, { fields: { amount: 'מעל הזיכוי' } });
    const last = [...u.lines].reverse().find((l) => l.status === 'posted' && l.type === 'deposit' && !l.arLink);
    for (const a of plan) {
      const d = await loadDebt(propertyId, a.folioId, session);
      if (String(d.ownerRef) !== String(c._id) || d.ar?.origin === 'unapplied' || d.status === 'closed') throw httpError('חוב שאינו פתוח בחשבון הזה', 422);
      const bal = folioBalance(d);
      if (a.amount - bal > 0.005) throw httpError(`בחוב ${d.ar?.number || ''} היתרה ${bal.toFixed(2)} בלבד`, 422);
      const outId = new mongoose.Types.ObjectId();
      u.lines.push({ _id: outId, type: 'payment', description: `שויך לחוב ${d.ar?.number || ''}`.trim(), amount: a.amount, taxAmount: 0, serviceDate: today, source: 'routing', status: 'posted', reference: `${ref}:${a.folioId}:out`, method: last?.method, arLink: { kind: 'alloc_out', folio: d._id, number: d.ar?.number }, createdBy: actor.id || undefined });
      d.lines.push({ type: 'payment', description: `תשלום על החשבון שויך${last?.methodRef ? ` · ${last.methodRef}` : ''}`, amount: -a.amount, taxAmount: 0, serviceDate: today, source: 'routing', status: 'posted', reference: `${ref}:${a.folioId}:in`, method: last?.method, methodRef: last?.methodRef, arLink: { kind: 'alloc', folio: u._id, line: outId }, createdBy: actor.id || undefined });
      await d.save({ session });
    }
    await u.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.payment_allocated', entityType: 'Company', entityId: c._id, after: { total, debts: plan.length }, ip, session, afterCommit });
    return { total, debts: plan.length, duplicate: false };
  });
}

// The payment leaves the debt (which reopens) and goes back "on account".
export async function unallocatePayment({ propertyId, folioId, lineId, actor, ip }) {
  const pre = await loadDebt(propertyId, folioId);
  if (pre.ar?.origin === 'unapplied') throw httpError('התשלום כבר על החשבון', 409);
  const c = await loadCompany(propertyId, pre.ownerRef);
  if (!c.ar?.active) throw httpError('ביטול שיוך מחייב חשבון חייבים פעיל', 409);
  const u0 = await unappliedFolio(propertyId, c);
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  return multiWrite(propertyId, [folioId, String(u0._id)], async (session, afterCommit) => {
    const d = await loadDebt(propertyId, folioId, session);
    const u = await loadDebt(propertyId, u0._id, session);
    const line = d.lines.id(lineId);
    if (!line || line.status !== 'posted' || !((['payment', 'deposit'].includes(line.type) && !line.arLink) || line.arLink?.kind === 'alloc')) throw httpError('התשלום לא נמצא', 404);
    if (d.lines.some((l) => l.arLink?.kind === 'unalloc' && String(l.reversalOf) === String(line._id))) return { folioId, duplicate: true };
    const amt = round2(-gross(line));
    d.lines.push({ type: 'payment', description: `ביטול שיוך: ${line.description}`.slice(0, 200), amount: amt, taxAmount: 0, serviceDate: today, source: 'routing', status: 'posted', reference: `op:unalloc-${line._id}:out`, reversalOf: line._id, method: line.method, arLink: { kind: 'unalloc', folio: u._id }, createdBy: actor.id || undefined });
    u.lines.push({ type: 'payment', description: `חזר מחוב ${d.ar?.number || ''}: ${line.description}`.slice(0, 200), amount: -amt, taxAmount: 0, serviceDate: today, source: 'routing', status: 'posted', reference: `op:unalloc-${line._id}:in`, method: line.method, methodRef: line.methodRef, arLink: { kind: 'unalloc_in', folio: d._id, line: line._id }, createdBy: actor.id || undefined });
    await d.save({ session });
    await u.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.payment_unallocated', entityType: 'Folio', entityId: d._id, after: { number: d.ar?.number, amount: amt, lineId: String(line._id) }, ip, session, afterCommit });
    return { folioId, amount: amt, duplicate: false };
  });
}

// A payment that did not happen (bounced cheque, reversed transfer): it leaves the account and the
// balance rises. Works on money "on account" (also money that came back there from a debt) and on a
// payment sitting on a debt. Without a receipt it is a void line; with a receipt it is a refund line of
// that payment, and the refund receipt is issued in the invoicing system right after (credit of the
// original receipt) — the same path as any refund. Money matched from "on account" is unmatched first.
export async function voidPayment({ propertyId, companyId, folioId, lineId, input, actor, ip }) {
  const reason = txt(input.reason, 200);
  if (reason.length < 3) throw httpError('יש לפרט סיבה לביטול', 422, { fields: { reason: 'סיבה' } });
  const c = await loadCompany(propertyId, companyId);
  const u0 = await unappliedFolio(propertyId, c, { create: false });
  const home0 = folioId ? await loadDebt(propertyId, folioId) : u0;
  if (!home0 || String(home0.ownerRef) !== String(c._id)) throw httpError('התשלום לא נמצא בחשבון הזה', 404);
  const pre = home0.lines.id(lineId);
  if (!pre) throw httpError('התשלום לא נמצא', 404);
  const originFolioId = pre.arLink?.kind === 'unalloc_in' ? String(pre.arLink.folio) : String(home0._id);
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const out = await multiWrite(propertyId, [String(home0._id), originFolioId], async (session, afterCommit) => {
    const home = await loadDebt(propertyId, home0._id, session);
    const line = home.lines.id(lineId);
    const onAccount = home.ar?.origin === 'unapplied';
    const plain = ['payment', 'deposit'].includes(line?.type) && !line.arLink;
    if (!line || line.status !== 'posted' || !(plain || (onAccount && line.arLink?.kind === 'unalloc_in'))) throw httpError(line?.arLink?.kind === 'alloc' ? 'התשלום שויך מ"על החשבון" — קודם מבטלים את השיוך' : 'התשלום לא ניתן לביטול', 409);
    const undone = (f, id) => f.lines.some((l) => l.status === 'posted' && (String(l.reversalOf || '') === String(id) || String(l.refundOf || '') === String(id)) && (l.type === 'refund' || ['void', 'unalloc'].includes(l.arLink?.kind)));
    if (undone(home, line._id)) return { duplicate: true };
    const amt = round2(-gross(line));
    if (onAccount && amt + folioBalance(home) > 0.005) throw httpError('חלק מהכסף שעל החשבון כבר שויך לחובות — קודם מבטלים את השיוך', 409, { code: 'allocated' });
    // Where the receipt (if any) lives: the payment itself, or — for money that came back from a debt — the original payment there.
    const origin = originFolioId === String(home._id) ? home : await loadDebt(propertyId, originFolioId, session);
    const originLine = origin === home ? line : origin.lines.id(line.arLink.line);
    if (!originLine) throw httpError('תשלום המקור לא נמצא', 404);
    const receipt = (await docCoverage(origin._id, session)).payments.get(String(originLine._id)) || null;
    const base = { taxAmount: 0, serviceDate: today, source: 'manual', status: 'posted', method: originLine.method, methodRef: originLine.methodRef, reason, createdBy: actor.id || undefined };
    if (origin === home) {
      home.lines.push(receipt
        ? { ...base, type: 'refund', description: `ביטול תשלום: ${line.description}`.slice(0, 200), amount: amt, reference: `op:void-${line._id}`, refundOf: line._id }
        : { ...base, type: line.type, description: `ביטול תשלום: ${line.description}`.slice(0, 200), amount: amt, reference: `op:void-${line._id}`, reversalOf: line._id, arLink: { kind: 'void' } });
    } else {
      // Money back "on account" from a debt: the credit leaves "on account"; the receipt is credited on the
      // debt where it was issued (refund line), offset there so the debt itself does not change.
      home.lines.push({ ...base, type: 'payment', description: `ביטול תשלום: ${line.description}`.slice(0, 200), amount: amt, reference: `op:void-${line._id}`, reversalOf: line._id, arLink: { kind: 'void' } });
      if (receipt && !origin.lines.some((l) => l.status === 'posted' && l.type === 'refund' && String(l.refundOf || '') === String(originLine._id))) {
        origin.lines.push({ ...base, type: 'refund', description: `ביטול תשלום (${receipt}): ${originLine.description}`.slice(0, 200), amount: amt, reference: `op:void-${line._id}:r`, refundOf: originLine._id });
        origin.lines.push({ ...base, type: 'payment', description: 'קיזוז — הכסף כבר הוצא מ"על החשבון"', amount: -amt, reference: `op:void-${line._id}:o`, arLink: { kind: 'void_offset', folio: home._id, line: line._id } });
      }
      await origin.save({ session });
    }
    await home.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ar.payment_voided', entityType: 'Company', entityId: c._id, reason, after: { amount: amt, method: originLine.method, lineId: String(line._id), receipt }, ip, session, afterCommit });
    return { amount: amt, duplicate: false, receipt, receiptFolio: receipt ? String(origin._id) : null };
  });
  if (!out.receipt || out.duplicate) return out;
  // The refund receipt is issued now in the invoicing system. If it is unreachable the refund line stays and
  // the refund receipt is issued later from the folio's documents (it shows as a refund without a receipt).
  try {
    const { issueDocument } = await import('./documentService.js');
    const doc = await issueDocument({ propertyId, folioId: out.receiptFolio, input: { type: 'refund_receipt', idempotencyKey: `arvoid-${lineId}`, notes: `ביטול תשלום — ${reason}` }, actor, ip });
    return { ...out, refundReceipt: doc.invoiceNumber || doc.number || null };
  } catch (e) {
    return { ...out, refundReceipt: null, refundReceiptError: String(e.message || e).slice(0, 200) };
  }
}

// ── Notes and traces ─────────────────────────────────────────────────────────
export async function addNote({ propertyId, companyId, input, actor, ip }) {
  await loadCompany(propertyId, companyId);
  const kind = input.kind === 'trace' ? 'trace' : 'note';
  const text = txt(input.text, 1000);
  if (text.length < 2) throw httpError('יש לכתוב טקסט', 422, { fields: { text: 'טקסט' } });
  if (kind === 'trace' && !YMD.test(input.dueDate || '')) throw httpError('תאריך יעד למשימה', 422, { fields: { dueDate: 'תאריך' } });
  const n = await ArNote.create({ property: propertyId, company: companyId, kind, text, dueDate: kind === 'trace' ? input.dueDate : undefined, by: actor.id || undefined, byName: actor.name });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `ar.${kind}_added`, entityType: 'Company', entityId: companyId, after: { text: text.slice(0, 120), dueDate: n.dueDate }, ip });
  return noteDto(n);
}
export async function setTraceDone({ propertyId, noteId, done, actor, ip }) {
  if (!isId(noteId)) throw httpError('מזהה לא תקין', 400);
  const n = await ArNote.findOne({ _id: noteId, property: propertyId, kind: 'trace' });
  if (!n) throw httpError('המשימה לא נמצאה', 404);
  n.done = !!done; n.doneAt = done ? new Date() : undefined; n.doneByName = done ? actor.name : undefined;
  await n.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: done ? 'ar.trace_done' : 'ar.trace_reopened', entityType: 'Company', entityId: n.company, after: { text: n.text.slice(0, 120) }, ip });
  return noteDto(n);
}
export async function listTraces({ propertyId, view = 'open' }) {
  const q = { property: propertyId, kind: 'trace' };
  if (view !== 'all') q.done = false;
  const rows = await ArNote.find(q).sort({ done: 1, dueDate: 1 }).limit(300).populate('company', 'name ar.number').lean();
  return rows.map((n) => ({ ...noteDto(n), companyId: String(n.company?._id || n.company), companyName: n.company?.name || '', accountNumber: n.company?.ar?.number || null }));
}

// ── Search debts across all accounts ────────────────────────────────────────
export async function searchDebts({ propertyId, q, status = 'open', from, to }) {
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const term = txt(q, 60).toLowerCase();
  const all = await companyFolios(propertyId, null, { includeClosed: status === 'all' });
  const companies = new Map((await Company.find({ _id: { $in: [...new Set(all.map((x) => String(x.f.ownerRef)))].filter(isId) } }).select('name paymentTerms ar.number').lean()).map((c) => [String(c._id), c]));
  return all.map(({ f, r }) => {
    const c = companies.get(String(f.ownerRef));
    return { ...summarize(f, r, today, c?.paymentTerms), companyId: String(f.ownerRef), companyName: c?.name || '', accountNumber: c?.ar?.number || null };
  }).filter((d) => d.status !== 'unapplied')
    .filter((d) => status === 'all' || (Math.abs(d.balance) > 0.005 && d.status !== 'moved'))
    .filter((d) => (!YMD.test(from || '') || (d.since || '') >= from) && (!YMD.test(to || '') || (d.since || '') <= to))
    .filter((d) => !term || [d.number, d.confirmationNumber, d.guest, d.companyName, d.accountNumber, d.ref].some((v) => String(v || '').toLowerCase().includes(term)))
    .sort((a, b) => String(b.since || '').localeCompare(String(a.since || ''))).slice(0, 300);
}

// ── Statements and reminders ─────────────────────────────────────────────────
async function statementOf(propertyId, companyId, { from, to, text, withCopies }) {
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const acc = await getAccount({ propertyId, companyId, view: 'all' });
  const end = YMD.test(to || '') ? to : today;
  const start = YMD.test(from || '') ? from : null;
  // Open debts as of now, plus debts settled within the period; moved debts never show.
  const debts = acc.debts.filter((d) => d.status !== 'moved' && (d.since || '') <= end && (Math.abs(d.balance) > 0.005 || (start && (d.since || '') >= start)));
  let copies = null;
  if (withCopies) {
    copies = {};
    for (const d of debts.filter((x) => Math.abs(x.balance) > 0.005).slice(0, 40)) copies[d.folioId] = (await getDebt({ propertyId, folioId: d.folioId })).lines.filter((l) => l.status === 'posted' && !['out'].includes(l.arKind) && !['payment', 'deposit', 'refund'].includes(l.type)).map((l) => ({ date: l.serviceDate, description: l.description, gross: l.gross }));
  }
  return {
    issuedOn: today, from: start, to: end, text: txt(text, 300) || null,
    property: { name: property.legalName || property.name, taxNumber: property.taxNumber || null, address: [property.address, property.city].filter(Boolean).join(', ') || null, phone: property.phone || null, email: property.email || null },
    account: { number: acc.account.number, name: acc.account.name, taxId: acc.account.taxId, termsLabel: acc.account.termsLabel, billing: { name: acc.account.billing?.name || acc.account.contact.name, email: acc.account.billing?.email || acc.account.contact.email, phone: acc.account.billing?.phone || acc.account.contact.phone, address: acc.account.billing?.address || acc.account.address } },
    debts: debts.map((d) => ({ folioId: d.folioId, number: d.number || d.confirmationNumber, date: d.since, guest: d.guest, confirmationNumber: d.confirmationNumber, charged: round2(d.charged - (d.adjusted || 0)), paid: d.paid, balance: d.balance, dueDate: d.dueDate, overdueDays: d.overdueDays })),
    payments: acc.payments.filter((p) => !p.undone && (!start || p.date >= start) && p.date <= end && !p.allocated).map((p) => ({ date: p.date, amount: p.amount, method: p.method, methodRef: p.methodRef, where: p.where })),
    summary: acc.summary, copies,
  };
}
export async function statementPreview({ propertyId, companyId, query }) {
  return statementOf(propertyId, companyId, { from: query.from, to: query.to, text: query.text, withCopies: query.copies === '1' });
}

function reminderLevel(type, daysPast) {
  const cycle = REMINDER_CYCLES[type] || REMINDER_CYCLES.standard;
  return cycle.filter((d) => daysPast >= d).length;
}
// Who is due a statement / reminder now. Statements: accounts in batch statements with a balance of at
// least minBalance (printed = a statement already recorded this month). Reminders: by the account type's
// cycle; a level already sent is not offered again until the next level.
export async function letterCandidates({ propertyId, kind = 'statement', minBalance = 0, type }) {
  const ov = await receivables({ propertyId });
  const month = ov.today.slice(0, 7);
  const ids = ov.rows.map((r) => r.companyId);
  const last = await ArLetter.aggregate([
    { $match: { property: new mongoose.Types.ObjectId(String(propertyId)), company: { $in: ids.filter(isId).map((id) => new mongoose.Types.ObjectId(id)) }, kind } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$company', at: { $first: '$createdAt' }, level: { $max: '$level' }, lastLevelAt: { $first: '$createdAt' } } },
  ]);
  const lastBy = new Map(last.map((l) => [String(l._id), l]));
  const accounts = new Map((await Company.find({ _id: { $in: ids.filter(isId) } }).select('ar.inStatements ar.type').lean()).map((c) => [String(c._id), c]));
  const out = [];
  for (const r of ov.rows) {
    const c = accounts.get(r.companyId);
    if (!r.arActive || (type && type !== 'all' && r.type !== type)) continue;
    const l = lastBy.get(r.companyId);
    if (kind === 'statement') {
      if (c?.ar?.inStatements === false || r.total < Number(minBalance || 0) - 0.005 || r.total <= 0.005) continue;
      const at = l?.at ? new Date(l.at).toISOString().slice(0, 10) : null;
      out.push({ companyId: r.companyId, name: r.name, number: r.number, balance: r.total, overdue: r.overdue, lastAt: at, printed: !!at && at.slice(0, 7) === month, email: r.contact.email });
    } else {
      const oldest = r.items.filter((d) => d.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays)[0];
      if (!oldest) continue;
      const level = reminderLevel(r.type, oldest.overdueDays);
      if (!level) continue;
      const sentLevel = l && new Date(l.at).toISOString().slice(0, 10) >= (oldest.dueDate || '') ? Number(l.level || 0) : 0;
      if (sentLevel >= level) continue;
      out.push({ companyId: r.companyId, name: r.name, number: r.number, balance: r.total, overdue: r.overdue, level, daysPast: oldest.overdueDays, lastAt: l?.at || null, lastLevel: sentLevel || null, email: r.contact.email });
    }
  }
  return out.sort((a, b) => b.balance - a.balance);
}

const REMINDER_TEXT = {
  1: 'תזכורת: לפי רישומינו היתרות הבאות עברו את מועד התשלום. נודה להסדרתן.',
  2: 'תזכורת שנייה: היתרות הבאות טרם שולמו. נבקש להסדיר את התשלום בהקדם.',
  3: 'התראה אחרונה לפני הגבלת האשראי: היתרות הבאות פתוחות זמן רב. נבקש להסדירן מיד.',
};

export async function sendLetters({ propertyId, input, actor, ip }) {
  const kind = input.kind === 'reminder' ? 'reminder' : 'statement';
  const ids = [...new Set((input.companyIds || []).map(String))].filter(isId);
  if (!ids.length || ids.length > 200) throw httpError('יש לבחור חשבונות', 422);
  const via = input.via === 'email' ? 'email' : 'print';
  const batch = ids.length > 1 ? `B${Date.now().toString(36)}` : undefined;
  const levels = kind === 'reminder' ? new Map((await letterCandidates({ propertyId, kind: 'reminder' })).map((x) => [x.companyId, x.level])) : new Map();
  const letters = []; const failed = [];
  for (const id of ids) {
    const level = kind === 'reminder' ? (Number(input.level) || levels.get(id) || 1) : undefined;
    const snap = await statementOf(propertyId, id, { from: input.from, to: input.to, text: kind === 'reminder' ? (txt(input.text, 300) || REMINDER_TEXT[level] || REMINDER_TEXT[1]) : input.text, withCopies: !!input.withCopies });
    if (kind === 'reminder') snap.debts = snap.debts.filter((d) => d.overdueDays > 0);
    let email;
    if (via === 'email') {
      email = snap.account.billing.email;
      if (!email) { failed.push({ companyId: id, name: snap.account.name, reason: 'אין כתובת דוא״ל לגבייה' }); continue; }
      try {
        const { sendEmail } = await import('./emailService.js');
        await sendEmail({ to: email, subject: `${kind === 'reminder' ? 'תזכורת תשלום' : 'דף חשבון'} — ${snap.property.name}`, html: letterHtml(kind, level, snap) });
      } catch (e) { failed.push({ companyId: id, name: snap.account.name, reason: `שליחה נכשלה: ${String(e.message || e).slice(0, 120)}` }); continue; }
    }
    const l = await ArLetter.create({ property: propertyId, company: id, kind, level, from: snap.from || undefined, to: snap.to, text: snap.text || undefined, withCopies: !!input.withCopies, via, email, batch, balance: snap.summary.total, snapshot: snap, by: actor.id || undefined, byName: actor.name });
    letters.push({ id: String(l._id), companyId: id, name: snap.account.name });
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `ar.${kind}_sent`, entityType: 'Property', entityId: propertyId, after: { count: letters.length, failed: failed.length, via, batch, level: input.level || null }, ip });
  return { letters, failed, batch: batch || null };
}
export async function getLetters({ propertyId, ids }) {
  const list = String(ids || '').split(',').filter(isId).slice(0, 200);
  const rows = await ArLetter.find({ _id: { $in: list }, property: propertyId }).lean();
  const order = new Map(list.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id))).map((l) => ({ ...letterDto(l), snapshot: l.snapshot }));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const heDate = (ymd) => (ymd ? ymd.split('-').reverse().join('.') : '');
const nis = (n) => `${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
function letterHtml(kind, level, s) {
  const title = kind === 'reminder' ? `תזכורת תשלום${level > 1 ? ` (${level})` : ''}` : 'דף חשבון';
  return `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
<p><b>${esc(s.property.name)}</b>${s.property.taxNumber ? ` · ע.מ./ח.פ. ${esc(s.property.taxNumber)}` : ''}<br>${esc(s.property.address || '')}</p>
<h2 style="font-size:18px">${title} — ${esc(s.account.name)} (${esc(s.account.number || '')})</h2>
<p>נכון ל־${heDate(s.issuedOn)}${s.text ? `<br>${esc(s.text)}` : ''}</p>
<table style="border-collapse:collapse;width:100%"><tr style="background:#f1f5f9"><th align="right">תאריך</th><th align="right">חוב</th><th align="right">אורח</th><th align="left">יתרה</th><th align="right">לתשלום עד</th></tr>
${s.debts.map((d) => `<tr><td>${heDate(d.date)}</td><td>${esc(d.number || '')}</td><td>${esc(d.guest || '')}</td><td align="left">${nis(d.balance)}</td><td>${heDate(d.dueDate)}</td></tr>`).join('')}
</table><p><b>יתרה לתשלום: ${nis(s.summary.total)}</b></p><p style="color:#64748b">קבלה על התשלום תופק עם קבלתו.</p></div>`;
}

// ── Daily checklist for accounting ──────────────────────────────────────────
export async function dailyChecklist({ propertyId }) {
  const ov = await receivables({ propertyId });
  const tomorrow = addDays(ov.today, 1);
  const [arrivals, traces, reminders, statements] = await Promise.all([
    Reservation.find({ property: propertyId, arrivalDate: { $in: [ov.today, tomorrow] }, status: { $in: ['confirmed', 'modified', 'pending_payment'] }, 'voucher.payerRef': { $exists: true, $ne: null } })
      .select('confirmationNumber arrivalDate voucher primaryGuest').populate('primaryGuest', 'firstName lastName').limit(100).lean(),
    ArNote.find({ property: propertyId, kind: 'trace', done: false, dueDate: { $lte: ov.today } }).populate('company', 'name').sort({ dueDate: 1 }).limit(50).lean(),
    letterCandidates({ propertyId, kind: 'reminder' }),
    letterCandidates({ propertyId, kind: 'statement' }),
  ]);
  const payers = new Map((await Company.find({ _id: { $in: [...new Set(arrivals.map((r) => r.voucher.payerRef))].filter(isId) } }).select('name ar creditLimit').lean()).map((c) => [String(c._id), c]));
  const rowsBy = new Map(ov.rows.map((r) => [r.companyId, r]));
  const enteredToday = await Folio.countDocuments({ property: propertyId, ownerType: 'company', 'ar.enteredOn': ov.today, 'ar.origin': { $in: ['direct', 'recurring', 'mass'] } });
  return {
    today: ov.today, tomorrow,
    bin: { count: ov.totals.binCount, total: ov.totals.bin, holdBin: ov.holdBin },
    arrivals: arrivals.map((r) => {
      const c = payers.get(String(r.voucher.payerRef));
      const row = rowsBy.get(String(r.voucher.payerRef));
      const warn = !c ? 'המשלם לא נמצא' : c.ar?.restricted ? 'חשבון מוגבל' : !c.ar?.active ? 'אין חשבון חייבים פעיל' : row?.overLimit ? 'חריגה ממסגרת' : null;
      return { reservationId: String(r._id), confirmationNumber: r.confirmationNumber, arrivalDate: r.arrivalDate, guest: r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : '', payer: c?.name || r.voucher.payerName || '', voucherType: r.voucher.type, warn };
    }),
    unapplied: ov.rows.filter((r) => r.unapplied > 0.005).map((r) => ({ companyId: r.companyId, name: r.name, amount: r.unapplied })),
    overLimit: ov.rows.filter((r) => r.overLimit).map((r) => ({ companyId: r.companyId, name: r.name, debts: r.debts, creditLimit: r.creditLimit })),
    restrictedWithBalance: ov.rows.filter((r) => r.restricted && r.total > 0.005).map((r) => ({ companyId: r.companyId, name: r.name, total: r.total })),
    traces: traces.map((n) => ({ ...noteDto(n), companyId: String(n.company?._id || ''), companyName: n.company?.name || '' })),
    reminders: reminders.length, statements: statements.filter((s) => !s.printed).length, enteredToday,
    totals: ov.totals,
  };
}
