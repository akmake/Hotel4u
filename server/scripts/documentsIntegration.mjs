#!/usr/bin/env node
/* eslint-disable no-console */
// Payment details + fiscal documents suite (FIN-03 method details, FIN-06 issue, FIN-07 limits,
// FIN-10 allocation numbers, print original/copy). Runs against a live PMS server and the same DB on
// throw-away properties created here; everything is removed at the end.
//
//   node scripts/documentsIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Folio from '../models/Folio.js';
import Invoice from '../models/Invoice.js';
import Company from '../models/Company.js';
import AuditLog from '../models/AuditLog.js';
import ChargeCode from '../models/ChargeCode.js';
import OperationLock from '../models/OperationLock.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || 'hotel4u_dev_secret_change_in_prod';
const TAG = `DOC${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body, { raw = false } = {}) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: raw ? 'text/html' : 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  if (raw) return { status: res.status, text: await res.text() };
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const key = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const SELLER = { legalName: 'בדיקות מלונאות בע"מ', taxNumber: '514443210', address: 'הרצל 1', city: 'טבריה' };

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const props = [];
  const today = todayYmdInTimezone('Asia/Jerusalem');

  async function mkProperty(n, seller = SELLER) {
    const p = await Property.create({ name: `בדיקה ${TAG}-${n}`, ...seller, timezone: 'Asia/Jerusalem', vatRate: 18 });
    props.push(p._id);
    const P = String(p._id);
    const rt = await RoomType.create({ property: P, code: `${TAG}${n}`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    const rooms = [];
    for (let i = 1; i <= 6; i += 1) rooms.push(await Room.create({ property: P, roomType: rt._id, number: `${n}0${i}`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' }));
    const users = {};
    for (const role of ['property_admin', 'receptionist', 'finance_manager']) {
      users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${n}-${role}@test.local`, passwordHash: 'x', role, active: true });
    }
    const guest = await GuestProfile.create({ property: P, firstName: 'דנה', lastName: `${TAG}${n}`, email: 'dana@test.local', address: { line1: 'הגפן 3', city: 'חיפה' } });
    const company = await Company.create({ property: P, name: 'חברת הייטק בע"מ', taxId: '515555551', address: 'יגאל אלון 90, תל אביב', type: 'corporate' });
    return { p, P, rt, rooms, users, guest, company, t: Object.fromEntries(Object.entries(users).map(([k, u]) => [k, tok(u)])) };
  }
  let seq = 0;
  async function mkStay(ctx, { room = ctx.rooms[0], ownerType = 'guest', ownerRef } = {}) {
    seq += 1;
    const arrival = addDays(today, -2); const departure = addDays(today, 1);
    const r = await Reservation.create({
      property: ctx.P, confirmationNumber: `${TAG}-${seq}`, status: 'in_house', primaryGuest: ctx.guest._id, adults: 2, company: ctx.company._id,
      arrivalDate: arrival, departureDate: departure, nights: 3, roomsCount: 1, roomType: ctx.rt._id, ratePerNight: 500,
      totalAmount: 1500, assignedRoom: room._id, checkedInAt: new Date(), guaranteeType: 'credit_card',
    });
    await ReservationRoom.create({ reservation: r._id, property: ctx.P, roomTypeBooked: ctx.rt._id, assignedRoom: room._id, arrivalDate: arrival, departureDate: departure, nightlyRate: 500, status: 'in_house' });
    const folio = await Folio.create({ property: ctx.P, reservation: r._id, ownerType, ownerRef, lines: [] });
    return { r, folio };
  }
  const charge = (ctx, folio, gross, dep = 'f_and_b') => call('POST', `/finance/folios/${folio._id}/charges`, ctx.t.receptionist, { propertyId: ctx.P, department: dep, quantity: 1, unitPrice: gross, idempotencyKey: key() });
  const pay = (ctx, folio, body) => call('POST', `/finance/folios/${folio._id}/payments`, ctx.t.receptionist, { propertyId: ctx.P, idempotencyKey: key(), ...body });
  const issue = (ctx, folio, body, t = ctx.t.receptionist) => call('POST', `/finance/folios/${folio._id}/documents`, t, { propertyId: ctx.P, idempotencyKey: key(), ...body });
  const privateBuyer = { kind: 'private', name: 'דנה כהן' };
  const companyBuyer = (ctx) => ({ kind: 'business', name: 'חברת הייטק בע"מ', vatNumber: '515555551', address: 'יגאל אלון 90, תל אביב' });

  try {
    const A = await mkProperty('A');
    const { P } = A; const R = A.t.receptionist; const F = A.t.finance_manager;

    // ── FIN-03 payment details per method ───────────────────────────────────
    const s1 = await mkStay(A);
    await charge(A, s1.folio, 1180);
    let r = await pay(A, s1.folio, { amount: 100, method: 'credit_card' });
    check('FIN-03 card payment needs last 4 digits and an approval number', r.status === 422 && r.fields?.last4 && r.fields?.approval, JSON.stringify(r.fields));
    r = await pay(A, s1.folio, { amount: 100, method: 'credit_card', details: { last4: '4580123412341234', approval: 'A1234' } });
    check('FIN-03 a full card number is refused (only the last 4 digits are stored)', r.status === 422 && /מלא/.test(r.fields?.last4 || ''), JSON.stringify(r.fields));
    r = await pay(A, s1.folio, { amount: 100, method: 'credit_card', details: { last4: '1234', approval: 'A1234', installments: 40 } });
    check('FIN-03 installments 1–36', r.status === 422 && r.fields?.installments, JSON.stringify(r.fields));
    r = await pay(A, s1.folio, { amount: 300, method: 'credit_card', details: { last4: '1234', approval: 'A1234', installments: 3, cardBrand: 'visa' } });
    let f = await Folio.findById(s1.folio._id).lean();
    let line = f.lines.find((l) => l.method === 'credit_card');
    check('FIN-03 card sale stored: last4, approval as reference, installments; never the full number', r.status === 200 && line.methodRef === 'A1234' && line.payDetails?.last4 === '1234' && line.payDetails?.installments === 3 && !JSON.stringify(line).includes('4580'), JSON.stringify(line?.payDetails));
    r = await pay(A, s1.folio, { amount: 100, method: 'bank_transfer', details: { reference: '998877', payDate: addDays(today, 2) } });
    check('FIN-03 transfer date cannot be in the future', r.status === 422 && r.fields?.payDate, JSON.stringify(r.fields));
    r = await pay(A, s1.folio, { amount: 400, method: 'bank_transfer', details: { reference: '998877', payDate: addDays(today, -1), payerName: 'חברת הייטק' } });
    f = await Folio.findById(s1.folio._id).lean();
    line = f.lines.find((l) => l.method === 'bank_transfer');
    check('FIN-03 bank transfer stored with reference, date and payer', r.status === 200 && line.methodRef === '998877' && line.payDetails?.payDate === addDays(today, -1) && line.payDetails?.payerName === 'חברת הייטק', JSON.stringify(line?.payDetails));
    r = await pay(A, s1.folio, { amount: 100, method: 'cheque', details: { number: '1001', bank: '12', dueDate: today } });
    check('FIN-03 cheque needs bank, branch, account, number and due date', r.status === 422 && r.fields?.branch && r.fields?.account, JSON.stringify(r.fields));
    r = await pay(A, s1.folio, { amount: 100, method: 'cash', details: { tendered: 50 } });
    check('FIN-03 cash received below the amount is refused', r.status === 422 && r.fields?.tendered, JSON.stringify(r.fields));
    r = await pay(A, s1.folio, { amount: 380, method: 'cash', details: { tendered: 500 } });
    f = await Folio.findById(s1.folio._id).lean();
    line = f.lines.find((l) => l.method === 'cash');
    check('FIN-03 cash: amount received and change are recorded (500 → change 120)', r.status === 200 && r.data.change === 120 && line.payDetails?.tendered === 500 && line.payDetails?.change === 120, JSON.stringify(r.data));

    // ── FIN-06 context & tax invoice/receipt ────────────────────────────────
    r = await call('GET', `/finance/folios/${s1.folio._id}/documents/context?propertyId=${P}`, R);
    check('FIN-06 context: charges 1,180 and payments 1,080 not documented yet; invoice/receipt blocked (amounts differ); tax invoice recommended',
      r.status === 200 && r.data.totals.charges.gross === 1180 && r.data.totals.payments === 1080 && r.data.types.tax_invoice_receipt.ok === false && r.data.recommended === 'tax_invoice' && r.data.seller.ok,
      JSON.stringify(r.data?.totals || r));
    check('FIN-06 context: allocation threshold in force today is 5,000 (from 1.6.2026)', r.data?.allocation?.threshold === 5000, JSON.stringify(r.data?.allocation));
    r = await issue(A, s1.folio, { type: 'tax_invoice_receipt', buyer: privateBuyer });
    check('FIN-06 tax invoice/receipt refused when payments ≠ charges', r.status === 409, `${r.status} ${r.error || ''}`);
    await pay(A, s1.folio, { amount: 100, method: 'cash' });
    const ik = key();
    r = await issue(A, s1.folio, { type: 'tax_invoice_receipt', buyer: privateBuyer, idempotencyKey: ik });
    const r2 = await issue(A, s1.folio, { type: 'tax_invoice_receipt', buyer: privateBuyer, idempotencyKey: ik });
    const tir = await Invoice.findById(r.data?.id).lean();
    check('FIN-06 tax invoice/receipt issued once per request key, number 1 of its series', r.status === 200 && r2.data?.duplicate === true && r2.data.id === r.data.id && tir.invoiceNumber === '1' && tir.type === 'tax_invoice_receipt', JSON.stringify(r).slice(0, 200));
    check('FIN-06 document totals come from the folio (net 1,000 + VAT 180 = 1,180; paid 1,180; 4 payments with their details)',
      tir.totalNet === 1000 && tir.totalVat === 180 && tir.totalGross === 1180 && tir.amountPaid === 1180 && tir.payments.length === 4 && tir.payments.some((p) => p.method === 'credit_card' && p.last4 === '1234' && p.installments === 3) && tir.payments.some((p) => p.method === 'bank_transfer' && p.reference === '998877'),
      JSON.stringify({ n: tir.totalNet, v: tir.totalVat, g: tir.totalGross, p: tir.payments.length }));
    check('FIN-06 private guest — no allocation number required', tir.allocationStatus === 'not_required', tir.allocationStatus);
    r = await issue(A, s1.folio, { type: 'tax_invoice', buyer: privateBuyer });
    check('FIN-06 the same charges cannot be invoiced twice', r.status === 409 && r.code === 'nothing_to_document', `${r.status} ${r.error || ''}`);
    r = await issue(A, s1.folio, { type: 'receipt', buyer: privateBuyer });
    check('FIN-06 the same payments cannot be receipted twice', r.status === 409, `${r.status}`);
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${f.lines[0]._id}/reverse`, A.t.property_admin, { propertyId: P, reason: 'טעות' });
    check('FIN-02 an invoiced charge cannot be reversed — credit note instead', r.status === 409 && r.code === 'on_document', r.status);

    // ── receipt for a deposit, separate series ──────────────────────────────
    const s2 = await mkStay(A, { room: A.rooms[1] });
    await pay(A, s2.folio, { kind: 'deposit', amount: 500, method: 'cheque', details: { number: '5544', bank: '10', branch: '912', account: '123456', dueDate: addDays(today, 10), payerName: 'דנה כהן' } });
    r = await call('GET', `/finance/folios/${s2.folio._id}/documents/context?propertyId=${P}`, R);
    check('FIN-06 deposit only → receipt recommended, invoice unavailable', r.data?.recommended === 'receipt' && r.data.types.tax_invoice.ok === false, JSON.stringify(r.data?.types));
    r = await issue(A, s2.folio, { type: 'receipt', buyer: privateBuyer });
    const rc = await Invoice.findById(r.data?.id).lean();
    check('FIN-06 receipt: own series (number 1), no VAT, cheque details on it', r.status === 200 && rc.invoiceNumber === '1' && rc.totalVat === 0 && rc.amountPaid === 500 && rc.payments[0].bank === '10' && rc.payments[0].branch === '912' && rc.payments[0].dueDate === addDays(today, 10), JSON.stringify(rc?.payments?.[0]));
    r = await call('POST', `/finance/invoices/${rc._id}/credit-note`, F, { propertyId: P, amount: 100, reason: 'בדיקה' });
    check('FIN-07 a receipt cannot be credited', r.status === 422, r.status);

    // ── buyer validation ────────────────────────────────────────────────────
    const s3 = await mkStay(A, { room: A.rooms[2] });
    await charge(A, s3.folio, 7080);
    r = await issue(A, s3.folio, { type: 'tax_invoice', buyer: { kind: 'business', name: 'חברה', vatNumber: '12345', address: '' } });
    check('FIN-06 business buyer needs a 9-digit VAT/company number and an address', r.status === 422 && r.fields?.vatNumber && r.fields?.address, JSON.stringify(r.fields));

    // ── allocation number (net 6,000 to a business) ─────────────────────────
    r = await issue(A, s3.folio, { type: 'tax_invoice', buyer: companyBuyer(A) });
    const big = await Invoice.findById(r.data?.id).lean();
    check('FIN-10 business buyer, 6,000 before VAT (> 5,000) → issued, allocation pending, reason recorded', r.status === 200 && big.status === 'issued' && big.allocationStatus === 'pending' && big.allocationThreshold === 5000 && /515555551/.test(big.allocationReason), JSON.stringify({ s: big?.allocationStatus, why: big?.allocationReason }));
    let html = await call('GET', `/finance/documents/${big._id}/print?propertyId=${P}`, R, null, { raw: true });
    let after = await Invoice.findById(big._id).lean();
    check('Print while pending: marked "awaiting allocation", no input-VAT deduction note, original not used up', html.status === 200 && html.text.includes('ממתין למספר הקצאה') && after.printCount === 0, `${html.status} ${after.printCount}`);
    r = await call('GET', `/finance/documents?propertyId=${P}&view=pending`, R);
    check('FIN-10 list: pending view shows the document and the count', r.status === 200 && r.data.counts.pending === 1 && r.data.rows.some((x) => x.id === String(big._id)), JSON.stringify(r.data?.counts));
    r = await call('PATCH', `/finance/documents/${big._id}/allocation?propertyId=${P}`, R, { allocationNumber: '123456789' });
    check('FIN-10 receptionist cannot enter an allocation number', r.status === 403, r.status);
    r = await call('PATCH', `/finance/documents/${big._id}/allocation?propertyId=${P}`, F, { allocationNumber: '12345678' });
    check('FIN-10 allocation number must be 9 digits', r.status === 422, r.status);
    r = await call('PATCH', `/finance/documents/${big._id}/allocation?propertyId=${P}`, F, { allocationNumber: '123 456 789' });
    check('FIN-10 allocation number saved → approved', r.status === 200 && r.data.allocation.status === 'approved' && r.data.allocation.number === '123456789', JSON.stringify(r.data?.allocation || r.error));
    r = await call('PATCH', `/finance/documents/${big._id}/allocation?propertyId=${P}`, F, { allocationNumber: '987654321' });
    check('FIN-10 an approved number cannot be overwritten', r.status === 409, r.status);
    html = await call('GET', `/finance/documents/${big._id}/print?propertyId=${P}`, R, null, { raw: true });
    const html2 = await call('GET', `/finance/documents/${big._id}/print?propertyId=${P}`, R, null, { raw: true });
    check('Print: first print "מקור" with the allocation number, the next one "העתק נאמן למקור"', html.text.includes('>מקור<') && html.text.includes('123456789') && html2.text.includes('העתק נאמן למקור'), '');

    // exactly at the threshold → not required; a refusal path
    const s4 = await mkStay(A, { room: A.rooms[3] });
    await charge(A, s4.folio, 5900);
    r = await issue(A, s4.folio, { type: 'tax_invoice', buyer: companyBuyer(A) });
    check('FIN-10 exactly 5,000 before VAT is not "above" the threshold → not required', r.status === 200 && r.data.allocation.status === 'not_required', JSON.stringify(r.data?.allocation));
    const s5 = await mkStay(A, { room: A.rooms[4] });
    await charge(A, s5.folio, 11800);
    r = await issue(A, s5.folio, { type: 'tax_invoice', buyer: companyBuyer(A) });
    const rej = r.data?.id;
    r = await call('PATCH', `/finance/documents/${rej}/allocation?propertyId=${P}`, F, { allocationNumber: '123456789' });
    check('FIN-10 the same allocation number cannot sit on two documents', r.status === 409, r.status);
    r = await call('PATCH', `/finance/documents/${rej}/allocation?propertyId=${P}`, F, { rejected: true, reason: 'מספר עוסק שגוי' });
    check('FIN-10 a refusal is recorded with its reason (no number invented)', r.status === 200 && r.data.allocation.status === 'rejected' && !r.data.allocation.number, JSON.stringify(r.data?.allocation));
    // full credit frees the charges for a corrected invoice
    r = await call('POST', `/finance/invoices/${rej}/credit-note`, F, { propertyId: P, reason: 'מספר עוסק שגוי — הנפקה מחדש' });
    const cn = await Invoice.findById(r.data?.id).lean();
    r = await issue(A, s5.folio, { type: 'tax_invoice', buyer: { ...companyBuyer(A), vatNumber: '516666662' } });
    check('FIN-07 after a full credit note the charges can be invoiced again (corrected buyer); credit note has its own series', cn?.type === 'credit_note' && cn.invoiceNumber === '1' && r.status === 200 && r.data.allocation.status === 'pending', `${cn?.invoiceNumber} ${r.status} ${r.error || ''}`);

    // proforma does not lock charges
    const s6 = await mkStay(A, { room: A.rooms[5] });
    await charge(A, s6.folio, 236, 'parking');
    r = await issue(A, s6.folio, { type: 'proforma', buyer: privateBuyer });
    const pf = await Folio.findById(s6.folio._id).lean();
    const rv = await call('POST', `/finance/folios/${s6.folio._id}/lines/${pf.lines[0]._id}/reverse`, A.t.property_admin, { propertyId: P, reason: 'ביטול חניה' });
    check('FIN-06 a transaction invoice (proforma) is not a tax document — the charge can still be reversed', r.status === 200 && rv.status === 200, `${r.status} ${rv.status} ${rv.error || ''}`);

    // escape in print
    const s7 = await mkStay(A, { room: A.rooms[0] });
    await charge(A, s7.folio, 118);
    r = await issue(A, s7.folio, { type: 'tax_invoice', buyer: { kind: 'private', name: '<script>alert(1)</script>' } });
    html = await call('GET', `/finance/documents/${r.data?.id}/print?propertyId=${P}`, R, null, { raw: true });
    check('Print escapes user text (no script injection through a name)', !html.text.includes('<script>alert') && html.text.includes('&lt;script&gt;'), '');

    // checkout reminder
    const s8 = await mkStay(A, { room: A.rooms[1] });
    await charge(A, s8.folio, 590);
    await pay(A, s8.folio, { amount: 200, method: 'cash' });
    r = await call('GET', `/frontdesk/reservations/${s8.r._id}/check-out?propertyId=${P}`, R);
    const fo = r.data?.folios?.find((x) => x.id === String(s8.folio._id));
    check('Checkout context shows what has no document yet (charges 590, payments 200)', fo?.undocumented?.charges === 590 && fo.undocumented.payments === 200, JSON.stringify(fo?.undocumented || r.error));

    // seller details are required; series are per property
    const B = await mkProperty('B', { legalName: '', taxNumber: '' });
    const sb = await mkStay(B);
    await charge(B, sb.folio, 118);
    r = await issue(B, sb.folio, { type: 'tax_invoice', buyer: privateBuyer });
    check('FIN-06 no document without the business legal name, VAT number and address', r.status === 422 && r.code === 'seller_incomplete', `${r.status} ${r.error || ''}`);
    await Property.updateOne({ _id: B.P }, { $set: SELLER });
    r = await issue(B, sb.folio, { type: 'tax_invoice', buyer: privateBuyer });
    check('FIN-06 each property has its own series (second property also starts at 1)', r.status === 200 && r.data.number === '1', JSON.stringify(r.data || r.error));
    r = await call('GET', `/finance/folios/${sb.folio._id}/documents/context?propertyId=${A.P}`, A.t.receptionist);
    check('Scope: a folio of another property is not reachable', r.status === 403 || r.status === 404, r.status);

    r = await call('POST', `/invoices/folio/${s1.folio._id}`, F, { propertyId: P, type: 'tax_invoice' });
    check('Legacy issue-from-folio route is closed (410) — one issuing path', r.status === 410, r.status);
    check('Issue and allocation actions are audited', await AuditLog.countDocuments({ property: P, action: { $in: ['invoice.issued', 'invoice.allocation_set', 'invoice.allocation_rejected'] } }) >= 9);
  } finally {
    const resIds = (await Reservation.find({ property: { $in: props } }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: { $in: props } }, { entityId: { $in: [...props, ...resIds] } }] });
    await Invoice.deleteMany({ property: { $in: props } });
    await Folio.deleteMany({ property: { $in: props } });
    await ReservationRoom.deleteMany({ property: { $in: props } });
    await Reservation.deleteMany({ property: { $in: props } });
    await GuestProfile.deleteMany({ property: { $in: props } });
    await Company.deleteMany({ property: { $in: props } });
    await ChargeCode.deleteMany({ property: { $in: props } });
    await OperationLock.deleteMany({ key: /^docs:/ });
    await Room.deleteMany({ property: { $in: props } });
    await RoomType.deleteMany({ property: { $in: props } });
    await User.deleteMany({ property: { $in: props } });
    await Property.deleteMany({ _id: { $in: props } });
    await mongoose.disconnect();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
