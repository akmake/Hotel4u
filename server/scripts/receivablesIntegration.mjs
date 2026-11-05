#!/usr/bin/env node
/* eslint-disable no-console */
// Receivables suite (gap-map item 7): AR account, holding bin, direct / recurring / batch debts,
// payments (oldest first, selected, on account), allocation and its undo, voided payment, write-off,
// transfer / consolidation (and undo), restriction, notes & traces, statements & reminders, checklist.
// Runs against a live PMS server + the same DB, on a throw-away property removed at the end.
//   node scripts/receivablesIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import Folio from '../models/Folio.js';
import Company from '../models/Company.js';
import ArNote from '../models/ArNote.js';
import ArLetter from '../models/ArLetter.js';
import AuditLog from '../models/AuditLog.js';
import ChargeCode from '../models/ChargeCode.js';
import Invoice from '../models/Invoice.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { arDayCloseHook } from '../services/arService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `ARQ${Date.now().toString(36).toUpperCase()}`;
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${typeof info === 'string' ? info : JSON.stringify(info).slice(0, 300)}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
let P;
async function call(method, url, t, body) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${url}${sep}propertyId=${P}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify({ ...body, propertyId: P }) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const round = (n) => Math.round(n * 100) / 100;
const bal = async (id) => { const f = await Folio.findById(id).lean(); return Math.round(f.lines.filter((l) => l.status === 'posted').reduce((s, l) => s + l.amount + (l.taxAmount || 0), 0) * 100) / 100; };
let k = 0;
const key = () => `${TAG}k${(k += 1)}xx`;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', vatRate: 18, reservationPrefix: TAG, taxNumber: '514000000' });
  P = String(p._id);
  try {
    const rt = await RoomType.create({ property: P, code: TAG, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    const users = {};
    for (const role of ['finance_manager', 'receptionist']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const F = tok(users.finance_manager); const R = tok(users.receptionist);
    const acme = await Company.create({ property: P, name: `אקמה ${TAG}`, type: 'corporate', creditLimit: 0 });
    const beta = await Company.create({ property: P, name: `בטא ${TAG}`, type: 'agency' });
    const A = String(acme._id); const B = String(beta._id);

    // ── Account ───────────────────────────────────────────────────────────────
    let r = await call('PUT', `/finance/receivables/${A}/account`, R, { type: 'standard' });
    check('AR1 a receptionist cannot open an AR account', r.status === 403, r.status);
    r = await call('PUT', `/finance/receivables/${A}/account`, F, { type: 'standard', paymentTerms: 'net30', creditLimit: 5000, billing: { name: 'הנהלת חשבונות', email: 'ap@acme.test' } });
    const acc1 = await Company.findById(A).lean();
    check('AR2 finance opens an account with a number, terms and limit', r.success && /^AR-\d{5}$/.test(acc1.ar?.number || '') && acc1.paymentTerms === 'net30' && acc1.creditLimit === 5000, r);
    r = await call('PUT', `/finance/receivables/${B}/account`, F, { type: 'agency', paymentTerms: 'eom30', number: acc1.ar.number });
    check('AR3 an account number is unique', r.status === 422 && r.fields?.number, r);
    await call('PUT', `/finance/receivables/${B}/account`, F, { type: 'agency', paymentTerms: 'eom30' });

    // ── Holding bin ───────────────────────────────────────────────────────────
    const g = await GuestProfile.create({ property: P, firstName: 'דנה', lastName: TAG });
    const res1 = await Reservation.create({ property: P, confirmationNumber: `${TAG}-1`, status: 'checked_out', primaryGuest: g._id, adults: 2, arrivalDate: addDays(today, -3), departureDate: today, nights: 3, roomsCount: 1, roomType: rt._id, ratePerNight: 400, totalAmount: 1200, company: acme._id, checkedOutAt: new Date() });
    const stayDebt = await Folio.create({ property: P, reservation: res1._id, ownerType: 'company', ownerRef: A, lines: [{ type: 'charge', description: 'לינה', amount: 1016.95, taxAmount: 183.05, department: 'rooms', serviceDate: addDays(today, -1), status: 'posted', vatRate: 18 }], settlement: { mode: 'company_ar', balance: 1200, at: new Date() } });
    r = await call('GET', '/finance/receivables', F);
    const rowA = r.data?.rows?.find((x) => x.companyId === A);
    check('AR4 a departed company balance waits in the holding bin', r.data?.totals?.binCount === 1 && rowA?.binCount === 1 && rowA.items[0].status === 'bin', r.data?.totals);
    r = await call('POST', '/finance/receivables/bin/approve', R, { folioIds: [String(stayDebt._id)] });
    const sd = await Folio.findById(stayDebt._id).lean();
    check('AR5 approving the bin numbers the debt with entry and due dates', r.success && /^D-\d{6}$/.test(sd.ar?.number || '') && sd.ar.enteredOn === today && sd.ar.dueDate === addDays(today, 30), sd.ar);

    // ── Direct debt ───────────────────────────────────────────────────────────
    const k1 = key();
    r = await call('POST', `/finance/receivables/${A}/debts`, R, { code: 'other', amount: 300, description: 'השכרת חניה', ref: 'PO-77', idempotencyKey: k1 });
    const direct = r.data?.folioId;
    const r2 = await call('POST', `/finance/receivables/${A}/debts`, R, { code: 'other', amount: 300, idempotencyKey: k1 });
    const df = direct ? await Folio.findById(direct).lean() : null;
    check('AR6 a new debt directly on the account (no stay), idempotent', r.success && df && !df.reservation && df.ar.origin === 'direct' && await bal(direct) === 300 && r2.data?.duplicate === true, r);
    r = await call('POST', `/finance/receivables/${B}/debts`, R, { code: 'other', amount: 0, idempotencyKey: key() });
    check('AR7 a debt needs a positive amount', r.status === 422, r.status);

    // ── Payments ──────────────────────────────────────────────────────────────
    r = await call('POST', `/finance/receivables/${A}/payments`, R, { amount: 200, method: 'bank_transfer', details: { payDate: today, payerName: 'אקמה', reference: 'TR-1' }, idempotencyKey: key() });
    check('AR8 a payment goes to the oldest debt first', r.success && await bal(stayDebt._id) === 1000 && await bal(direct) === 300, r);
    r = await call('POST', `/finance/receivables/${A}/payments`, R, { amount: 2000, method: 'bank_transfer', details: { payDate: today, payerName: 'אקמה', reference: 'TR-1' }, idempotencyKey: key() });
    check('AR9 more than the open balance is refused without "rest on account"', r.status === 422, r.status);
    r = await call('POST', `/finance/receivables/${A}/payments`, R, { amount: 500, mode: 'unapplied', method: 'cheque', details: { dueDate: today, payerName: 'אקמה', bank: '12', branch: '345', account: '67890', number: '1001' }, idempotencyKey: key() });
    let acc = await call('GET', `/finance/receivables/${A}`, F);
    check('AR10 a payment on account lowers the balance but not the debts', r.success && acc.data?.summary?.unapplied === 500 && acc.data.summary.debts === 1300 && acc.data.summary.total === 800, r.success ? acc.data?.summary : r);
    r = await call('POST', `/finance/receivables/${A}/allocate`, R, { allocations: [{ folioId: direct, amount: 300 }], idempotencyKey: key() });
    acc = await call('GET', `/finance/receivables/${A}`, F);
    check('AR11 money on account is matched to a debt', r.success && await bal(direct) === 0 && acc.data.summary.unapplied === 200, r.success ? acc.data.summary : r);
    const allocLine = (await Folio.findById(direct).lean()).lines.find((l) => l.arLink?.kind === 'alloc');
    r = await call('POST', `/finance/receivables/debts/${direct}/unallocate`, R, { lineId: String(allocLine._id) });
    acc = await call('GET', `/finance/receivables/${A}`, F);
    check('AR12 undoing the match reopens the debt and returns the money on account', r.success && await bal(direct) === 300 && acc.data.summary.unapplied === 500, r.success ? acc.data.summary : r);
    const unFolio = await Folio.findOne({ property: P, ownerRef: A, 'ar.origin': 'unapplied' }).lean();
    const depLine = unFolio.lines.find((l) => l.type === 'deposit' && !l.arLink);
    r = await call('POST', `/finance/receivables/${A}/payments/${depLine._id}/void`, R, { reason: 'שיק חזר' });
    check('AR13 a receptionist cannot void a payment', r.status === 403, r.status);
    r = await call('POST', `/finance/receivables/${A}/payments/${depLine._id}/void`, F, { reason: 'שיק חזר' });
    acc = await call('GET', `/finance/receivables/${A}`, F);
    check('AR14 a voided payment leaves the account and the balance rises', r.success && acc.data.summary.unapplied === 0 && acc.data.summary.total === 1300, r.success ? acc.data.summary : r);
    const pays = (await call('GET', `/finance/receivables/${A}?view=payments`, F)).data?.payments || [];
    check('AR15 payments list shows where each payment sits', pays.some((x) => x.where === 'על החשבון' && x.undone) && pays.some((x) => x.where === sd.ar.number), pays.map((x) => x.where));

    // ── Adjustment / write-off ────────────────────────────────────────────────
    r = await call('POST', `/finance/receivables/debts/${stayDebt._id}/adjust`, R, { reason: 'small_balance', amount: 10, idempotencyKey: key() });
    check('AR16 a receptionist cannot write off above the approval limit', r.status === 403, r.status);
    r = await call('POST', `/finance/receivables/debts/${stayDebt._id}/adjust`, F, { reason: 'other', amount: 10, idempotencyKey: key() });
    check('AR17 "other" needs a written reason', r.status === 422, r.status);
    r = await call('POST', `/finance/receivables/debts/${stayDebt._id}/adjust`, F, { reason: 'small_balance', amount: 10, idempotencyKey: key() });
    const wo = (await Folio.findById(stayDebt._id).lean()).lines.find((l) => l.arLink?.kind === 'writeoff');
    check('AR18 a write-off is a new line with the reason', r.success && await bal(stayDebt._id) === 990 && wo?.amount === -10 && /small_balance/.test(wo.reason), r);

    // ── Transfer / consolidation ──────────────────────────────────────────────
    r = await call('POST', `/finance/receivables/debts/${stayDebt._id}/transfer`, F, { toCompanyId: B, reason: 'נרשם על החברה הלא נכונה', idempotencyKey: key() });
    check('AR19 a debt with payments is not moved before undoing the match', r.status === 409 && r.code === 'has_payments', r);
    r = await call('POST', `/finance/receivables/debts/${direct}/transfer`, F, { toCompanyId: B, reason: 'נרשם על החברה הלא נכונה', idempotencyKey: key() });
    const moved = r.data?.folioId ? await Folio.findById(r.data.folioId).lean() : null;
    const src = await Folio.findById(direct).lean();
    check('AR20 a debt moves to another account; the source keeps a plus and a minus', r.success && moved?.ownerRef === B && await bal(moved._id) === 300 && src.status === 'closed' && String(src.ar.transferredTo) === String(moved._id) && src.lines.some((l) => l.arLink?.kind === 'out'), r);
    const d1 = (await call('POST', `/finance/receivables/${B}/debts`, R, { code: 'other', amount: 100, idempotencyKey: key() })).data.folioId;
    r = await call('POST', `/finance/receivables/${B}/consolidate`, F, { folioIds: [String(moved._id), d1], ref: 'FLIGHT LY001', idempotencyKey: key() });
    const cons = r.data?.folioId;
    check('AR21 consolidating debts makes one debt with a new number', r.success && await bal(cons) === 400 && (await Folio.findById(d1).lean()).status === 'closed', r);
    r = await call('POST', `/finance/receivables/debts/${cons}/unconsolidate`, F, {});
    check('AR22 consolidation can be undone on the same day', r.success && await bal(d1) === 100 && await bal(moved._id) === 300 && (await Folio.findById(cons).lean()).status === 'closed', r);

    // ── Restriction ───────────────────────────────────────────────────────────
    r = await call('PUT', `/finance/receivables/${B}/account`, F, { restricted: true });
    check('AR23 restricting an account needs a reason', r.status === 422 && r.fields?.restrictedReason, r);
    await call('PUT', `/finance/receivables/${B}/account`, F, { restricted: true, restrictedReason: 'חובות ישנים' });
    r = await call('POST', `/finance/receivables/${B}/debts`, R, { code: 'other', amount: 50, idempotencyKey: key() });
    check('AR24 a restricted account takes no new charges', r.status === 409 && r.code === 'ar_restricted', r);
    await call('PUT', `/finance/receivables/${B}/account`, F, { restricted: false });

    // ── Notes and traces ──────────────────────────────────────────────────────
    await call('POST', `/finance/receivables/${A}/notes`, R, { kind: 'note', text: 'דיברתי עם רינה, תשלום בסוף החודש' });
    r = await call('POST', `/finance/receivables/${A}/notes`, R, { kind: 'trace', text: 'לבדוק העברה בנקאית', dueDate: today });
    const traceId = r.data?.id;
    let cl = await call('GET', '/finance/receivables/checklist', F);
    check('AR25 a trace due today shows on the daily checklist', cl.data?.traces?.some((t) => t.id === traceId), cl.data?.traces);
    await call('PUT', `/finance/receivables/traces/${traceId}`, R, { done: true });
    const tr = await call('GET', '/finance/receivables/traces', F);
    check('AR26 a done trace leaves the open traces list', tr.success && !tr.data.some((t) => t.id === traceId), tr.status);

    // ── Statements and reminders ──────────────────────────────────────────────
    let cand = await call('GET', '/finance/receivables/letters?kind=statement&minBalance=100', F);
    const cA = cand.data?.find((x) => x.companyId === A);
    check('AR27 batch statements list accounts above the minimum balance', cA && cA.printed === false && cA.balance === 990 + 0, cand.data);
    r = await call('POST', '/finance/receivables/letters', R, { kind: 'statement', companyIds: [A], text: 'נא להעביר לתשלום' });
    const letters = await call('GET', `/finance/receivables/letters?ids=${r.data?.letters?.[0]?.id}`, F);
    cand = await call('GET', '/finance/receivables/letters?kind=statement&minBalance=100', F);
    check('AR28 a statement is recorded with what it showed and marked printed', r.success && letters.data?.[0]?.snapshot?.debts?.length >= 1 && letters.data[0].snapshot.property.taxNumber === '514000000' && cand.data.find((x) => x.companyId === A)?.printed === true, letters.data?.[0]?.snapshot?.debts);
    await Folio.updateOne({ _id: stayDebt._id }, { $set: { 'ar.dueDate': addDays(today, -40), 'ar.enteredOn': addDays(today, -70) } });
    cand = await call('GET', '/finance/receivables/letters?kind=reminder', F);
    const rem = cand.data?.find((x) => x.companyId === A);
    check('AR29 an overdue account is due a reminder at its cycle level', rem?.level === 2 && rem.daysPast === 40, cand.data);
    r = await call('POST', '/finance/receivables/letters', R, { kind: 'reminder', companyIds: [A] });
    cand = await call('GET', '/finance/receivables/letters?kind=reminder', F);
    check('AR30 a sent reminder is not offered again in the same cycle', r.success && !cand.data.some((x) => x.companyId === A), cand.data);
    r = await call('POST', '/finance/receivables/letters', R, { kind: 'statement', companyIds: [B], via: 'email' });
    check('AR31 email without a billing address is reported, not sent', r.success && r.data.failed.length === 1 && r.data.letters.length === 0, r.data);

    // ── Batch, recurring, holding-bin policy ──────────────────────────────────
    r = await call('POST', '/finance/receivables/mass-charge', R, { code: 'other', amount: 25, idempotencyKey: key() });
    check('AR32 a receptionist cannot post a batch charge', r.status === 403, r.status);
    r = await call('POST', '/finance/receivables/mass-charge', F, { code: 'other', amount: 25, description: 'דמי טיפול', idempotencyKey: key() });
    check('AR33 a batch charge opens a debt on every active account', r.success && r.data.created.length === 2, r.data);
    await call('POST', `/finance/receivables/${A}/recurring`, F, { code: 'other', amount: 150, day: 1, description: 'חניה חודשית' });
    r = await call('POST', '/finance/receivables/recurring/run', F, {});
    const r2b = await call('POST', '/finance/receivables/recurring/run', F, {});
    check('AR34 a recurring charge posts once a month', r.success && r.data.created.length === 1 && r2b.data.created.length === 0, [r, r2b]);
    const res2 = await Reservation.create({ property: P, confirmationNumber: `${TAG}-2`, status: 'checked_out', primaryGuest: g._id, adults: 1, arrivalDate: addDays(today, -1), departureDate: today, nights: 1, roomsCount: 1, roomType: rt._id, ratePerNight: 400, totalAmount: 400, company: acme._id });
    const bin2 = await Folio.create({ property: P, reservation: res2._id, ownerType: 'company', ownerRef: A, lines: [{ type: 'charge', description: 'לינה', amount: 400, taxAmount: 0, department: 'rooms', serviceDate: today, status: 'posted' }] });
    await call('PUT', '/finance/receivables/policy', F, { holdBin: false });
    const hook = await arDayCloseHook({ propertyId: P, actor: { id: users.finance_manager._id, name: 'בדיקה', role: 'finance_manager' } });
    check('AR35 without a holding bin, day close enters departed balances', hook.entered === 1 && !!(await Folio.findById(bin2._id).lean()).ar?.number, hook);

    // ── Views ─────────────────────────────────────────────────────────────────
    acc = await call('GET', `/finance/receivables/${A}`, F);
    const month = acc.data?.year?.find((m) => m.month === today.slice(0, 7));
    check('AR36 the year view shows this month charged and paid', month?.charged > 0 && month.paid > 0, month);
    const s = await call('GET', `/finance/receivables/search?q=${encodeURIComponent(sd.ar.number)}`, F);
    check('AR37 debts are found by number across accounts', s.data?.length === 1 && s.data[0].companyId === A, s.data?.length);
    cl = await call('GET', '/finance/receivables/checklist', F);
    check('AR38 the checklist counts reminders and statements due', cl.success && typeof cl.data.reminders === 'number' && cl.data.bin.holdBin === false, cl.data);
    // ── Voiding payments: on a debt, with a receipt, and money returned on account ─
    const trx = (n) => ({ amount: n, mode: 'selected', method: 'bank_transfer', details: { payDate: today, payerName: 'אקמה', reference: `TR-${n}` }, idempotencyKey: key() });
    const receiptFor = async (folioId, lineId, amount) => Invoice.create({ property: P, folio: folioId, type: 'receipt', issuer: 'hotel4u', status: 'issued', invoiceNumber: `R-${String(lineId).slice(-5)}`, seller: { name: 'בדיקה' }, payments: [{ method: 'bank_transfer', amount, folioLineId: lineId }], totalGross: amount, totalNet: amount, totalVat: 0 });
    const payLine = async (fid) => (await Folio.findById(fid).lean()).lines.filter((l) => l.type === 'payment' && !l.arLink).pop();
    const dz = (await call('POST', `/finance/receivables/${A}/debts`, R, { code: 'other', amount: 30, idempotencyKey: key() })).data.folioId;
    await call('POST', `/finance/receivables/${A}/payments`, R, { ...trx(30), allocations: [{ folioId: dz, amount: 30 }] });
    r = await call('POST', `/finance/receivables/${A}/payments/${(await payLine(dz))._id}/void`, F, { folioId: dz, reason: 'העברה הוחזרה' });
    check('AR40 a payment on a debt (no receipt) is voided and the debt reopens', r.success && await bal(dz) === 30 && !r.data.receipt, r);
    const dx = (await call('POST', `/finance/receivables/${A}/debts`, R, { code: 'other', amount: 100, idempotencyKey: key() })).data.folioId;
    await call('POST', `/finance/receivables/${A}/payments`, R, { ...trx(100), allocations: [{ folioId: dx, amount: 100 }] });
    const px = await payLine(dx);
    await receiptFor(dx, px._id, 100);
    r = await call('POST', `/finance/receivables/${A}/payments/${px._id}/void`, F, { folioId: dx, reason: 'שיק חזר' });
    const refundX = (await Folio.findById(dx).lean()).lines.find((l) => l.type === 'refund' && String(l.refundOf) === String(px._id));
    check('AR41 a receipted payment is voided by a refund of it, and the refund receipt is requested', r.success && r.data.receipt === `R-${String(px._id).slice(-5)}` && refundX?.amount === 100 && await bal(dx) === 100 && ('refundReceipt' in r.data), r.data);
    const dy = (await call('POST', `/finance/receivables/${A}/debts`, R, { code: 'other', amount: 50, idempotencyKey: key() })).data.folioId;
    await call('POST', `/finance/receivables/${A}/payments`, R, { ...trx(50), allocations: [{ folioId: dy, amount: 50 }] });
    const py = await payLine(dy);
    await receiptFor(dy, py._id, 50);
    await call('POST', `/finance/receivables/debts/${dy}/unallocate`, R, { lineId: String(py._id) });
    const back = (await Folio.findOne({ property: P, ownerRef: A, 'ar.origin': 'unapplied' }).lean()).lines.find((l) => l.arLink?.kind === 'unalloc_in' && String(l.arLink.line) === String(py._id));
    acc = await call('GET', `/finance/receivables/${A}`, F);
    const before = acc.data.summary.unapplied;
    r = await call('POST', `/finance/receivables/${A}/payments/${back._id}/void`, F, { reason: 'שיק חזר' });
    acc = await call('GET', `/finance/receivables/${A}`, F);
    const yLines = (await Folio.findById(dy).lean()).lines;
    check('AR42 money returned on account is voided; its receipt is credited on the debt it came from', r.success && round(before - acc.data.summary.unapplied) === 50 && await bal(dy) === 50 && yLines.some((l) => l.type === 'refund' && String(l.refundOf) === String(py._id)), [before, acc.data?.summary?.unapplied, r]);
    r = await call('POST', `/finance/receivables/${A}/payments/${back._id}/void`, F, { reason: 'שיק חזר' });
    check('AR43 voiding twice is harmless', r.success && r.data.duplicate === true, r);
    const audits = await AuditLog.countDocuments({ property: P, action: /^ar\./ });
    check('AR39 receivables actions are audited', audits >= 10, audits);
  } finally {
    await Promise.all([Folio, Reservation, GuestProfile, RoomType, User, Company, ArNote, ArLetter, AuditLog, ChargeCode, Invoice].map((m) => m.deleteMany({ property: P }).catch(() => null)));
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => null); process.exit(1); });
