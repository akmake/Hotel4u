#!/usr/bin/env node
/* eslint-disable no-console */
// Fiscal completeness suite: Tax Authority allocation (OAuth connect, automatic request, held invoice
// decisions, retry, token refresh) against a LOCAL mock of the ITA API; open-format (מבנה אחיד 1.31)
// file structure; refund receipts; series start numbers; reports; cash drawer close; e-mail guard.
//
// The PMS server must run with the mock as its Tax Authority and with e-mail disabled, e.g.:
//   ITA_CLIENT_ID=test ITA_CLIENT_SECRET=secret ITA_REDIRECT_URI=http://localhost:4001/api/ita/callback \
//   ITA_AUTH_BASE=http://localhost:4899 ITA_API_BASE=http://localhost:4899 EMAIL_USER= EMAIL_PASS= \
//   PORT=4001 DISABLE_WHATSAPP=1 node app.js
//   node scripts/fiscalIntegration.mjs --baseUrl=http://localhost:4001/api/pms
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import iconv from 'iconv-lite';
import User from '../models/User.js';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Folio from '../models/Folio.js';
import Invoice from '../models/Invoice.js';
import { removeFiscalTestFixtures } from './fiscalTestCleanup.mjs';
import Company from '../models/Company.js';
import AuditLog from '../models/AuditLog.js';
import ChargeCode from '../models/ChargeCode.js';
import OperationLock from '../models/OperationLock.js';
import CashierClose from '../models/CashierClose.js';
import WorkItem from '../models/WorkItem.js';
import ItaAuthState from '../models/ItaAuthState.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { unzip } from '../utils/zipWriter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || 'http://localhost:4001/api/pms').replace(/\/+$/, '');
const ROOT = BASE.replace(/\/api\/pms$/, '');
const MOCK_PORT = Number(args.mockPort || 4899);
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `FSC${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(40000) });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) return { status: res.status, raw: Buffer.from(await res.arrayBuffer()), ct };
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const key = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const SELLER = { legalName: 'מלון הבדיקות בע"מ', taxNumber: '514443210', address: 'הרצל 12', city: 'טבריה', postalCode: '1410000' };

// ── mock Tax Authority ──────────────────────────────────────────────────────
const mock = { approvals: [], decisions: [], tokenCalls: [], refreshCalls: 0, mode: {}, seq: 0, expireNext: false };
function startMock() {
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/longtimetoken/oauth2/token')) {
      const form = Object.fromEntries(new URLSearchParams(body));
      mock.tokenCalls.push(form);
      if (form.grant_type === 'refresh_token') mock.refreshCalls += 1;
      if (form.grant_type === 'authorization_code' && form.code !== 'good-code') return send(400, { error: 'invalid_grant' });
      const ttl = mock.expireNext ? 1 : 3600;
      mock.expireNext = false;
      return send(200, { access_token: `at-${mock.tokenCalls.length}`, refresh_token: `rt-${mock.tokenCalls.length}`, expires_in: ttl, token_type: 'Bearer' });
    }
    if (req.url.startsWith('/Invoices/v2/Approval')) {
      const j = JSON.parse(body || '{}');
      mock.approvals.push({ auth: req.headers.authorization, body: j });
      const m = mock.mode[String(j.customer_vat_number)] || 'approve';
      if (m === 'down') return send(503, { status: 503 });
      if (m === 'held') return send(200, { status: 200, message: { errors: [{ code: 460, message: 'Invoice not approved', param: 'vat_number', location: 'approval' }] }, confirmation_number: '0', approved: false });
      if (m === 'bad') return send(400, { status: 400, message: { errors: [{ code: 431, message: 'VAT Number is incorrect', param: 'vat_number', location: 'request' }] }, confirmation_number: '0', approved: false });
      mock.seq += 1;
      return send(200, { status: 200, message: 'Invoice approved', confirmation_number: `2026101712000000000${String(100000000 + mock.seq)}`, approved: true });
    }
    if (req.url.startsWith('/InvoiceDecisionApi/v1/')) {
      mock.decisions.push({ path: req.url, body: JSON.parse(body || '{}') });
      return send(200, { status: 200, message: 'Decision accepted' });
    }
    return send(404, {});
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, () => resolve(server)));
}

async function main() {
  const mockServer = await startMock();
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const props = [];
  const today = todayYmdInTimezone('Asia/Jerusalem');

  async function mkProperty(n) {
    const p = await Property.create({ name: `בדיקה ${TAG}-${n}`, ...SELLER, timezone: 'Asia/Jerusalem', vatRate: 18 });
    props.push(p._id);
    const P = String(p._id);
    const rt = await RoomType.create({ property: P, code: `${TAG}${n}`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    const rooms = [];
    for (let i = 1; i <= 8; i += 1) rooms.push(await Room.create({ property: P, roomType: rt._id, number: `${n}${i}`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' }));
    const users = {};
    for (const role of ['property_admin', 'receptionist', 'finance_manager']) {
      users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${n}-${role}@test.local`, passwordHash: 'x', role, active: true });
    }
    users.receptionist2 = await User.create({ property: P, firstName: 'שני', lastName: 'קבלה', email: `${TAG.toLowerCase()}-${n}-r2@test.local`, passwordHash: 'x', role: 'receptionist', active: true });
    const guest = await GuestProfile.create({ property: P, firstName: 'רונית', lastName: `${TAG}${n}` });
    return { p, P, rt, rooms, users, guest, t: Object.fromEntries(Object.entries(users).map(([k, u]) => [k, tok(u)])) };
  }
  let seq = 0;
  async function mkStay(ctx, room) {
    seq += 1;
    const r = await Reservation.create({
      property: ctx.P, confirmationNumber: `${TAG}-${seq}`, status: 'in_house', primaryGuest: ctx.guest._id, adults: 2,
      arrivalDate: addDays(today, -2), departureDate: addDays(today, 1), nights: 3, roomsCount: 1, roomType: ctx.rt._id, ratePerNight: 500,
      totalAmount: 30000, assignedRoom: room._id, checkedInAt: new Date(), guaranteeType: 'credit_card',
    });
    await ReservationRoom.create({ reservation: r._id, property: ctx.P, roomTypeBooked: ctx.rt._id, assignedRoom: room._id, arrivalDate: r.arrivalDate, departureDate: r.departureDate, nightlyRate: 500, status: 'in_house' });
    const folio = await Folio.create({ property: ctx.P, reservation: r._id, ownerType: 'guest', lines: [] });
    return { r, folio };
  }
  const charge = (ctx, folio, gross, t = ctx.t.receptionist) => call('POST', `/finance/folios/${folio._id}/charges`, t, { propertyId: ctx.P, department: 'f_and_b', quantity: 1, unitPrice: gross, idempotencyKey: key() });
  const pay = (ctx, folio, body, t = ctx.t.receptionist) => call('POST', `/finance/folios/${folio._id}/payments`, t, { propertyId: ctx.P, idempotencyKey: key(), ...body });
  const issue = (ctx, folio, body) => call('POST', `/finance/folios/${folio._id}/documents`, ctx.t.receptionist, { propertyId: ctx.P, idempotencyKey: key(), ...body });
  const biz = (vat) => ({ kind: 'business', name: 'לקוח עסקי בע"מ', vatNumber: vat, address: 'הברזל 3, תל אביב' });

  try {
    const A = await mkProperty('A');
    const { P } = A; const R = A.t.receptionist; const F = A.t.finance_manager; const M = A.t.property_admin;

    // ── series start (before any document) ──────────────────────────────────
    let r = await call('PUT', `/finance/fiscal/series/tax_invoice?propertyId=${P}`, R, { next: 5001 });
    check('Series: receptionist cannot set numbering', r.status === 403, r.status);
    r = await call('PUT', `/finance/fiscal/series/tax_invoice?propertyId=${P}`, F, { next: 5001 });
    check('Series: first tax-invoice number set to 5001 before any document (continuing previous software)', r.status === 200 && r.data.find((x) => x.type === 'tax_invoice').next === 5001, JSON.stringify(r).slice(0, 160));

    // ── connect to the Tax Authority (OAuth code flow via mock) ─────────────
    r = await call('GET', `/finance/fiscal?propertyId=${P}`, F);
    check('Fiscal settings: ITA configured on the server, not connected yet, manual mode', r.status === 200 && r.data.ita.configured === true && r.data.ita.connected === false && r.data.ita.mode === 'manual', JSON.stringify(r.data?.ita || r));
    r = await call('POST', `/finance/fiscal/ita/connect?propertyId=${P}`, R, {});
    check('Connect: receptionist may not connect the business to the Tax Authority', r.status === 403, r.status);
    r = await call('POST', `/finance/fiscal/ita/connect?propertyId=${P}`, F, {});
    const authUrl = new URL(r.data?.url || 'http://x');
    const state = authUrl.searchParams.get('state');
    check('Connect: authorize URL per the ITA guide (longtimetoken/oauth2/authorize, response_type=code, client_id, scope, redirect_uri, state)', r.status === 200 && authUrl.pathname.endsWith('/longtimetoken/oauth2/authorize') && authUrl.searchParams.get('response_type') === 'code' && authUrl.searchParams.get('client_id') === 'test' && state?.length >= 32, r.data?.url);
    let cb = await fetch(`${ROOT}/api/ita/callback?state=wrong&code=good-code`, { redirect: 'manual' });
    check('Callback with an unknown state is refused (redirect with failure)', cb.status === 302 && /ita=failed/.test(cb.headers.get('location') || ''), cb.headers.get('location'));
    cb = await fetch(`${ROOT}/api/ita/callback?state=${state}&code=good-code`, { redirect: 'manual' });
    let pr = await Property.findById(P).lean();
    check('Callback exchanges the code (Basic client auth) and stores sealed tokens; mode switches to automatic', cb.status === 302 && /ita=connected/.test(cb.headers.get('location') || '') && pr.fiscal.ita.connected === true && pr.fiscal.allocationMode === 'api' && /^v1:/.test(pr.fiscal.ita.refreshToken) && !String(pr.fiscal.ita.accessToken).includes('at-'), cb.headers.get('location'));
    cb = await fetch(`${ROOT}/api/ita/callback?state=${state}&code=good-code`, { redirect: 'manual' });
    check('The same state cannot be used twice', /ita=failed/.test(cb.headers.get('location') || ''), cb.headers.get('location'));
    await call('PUT', `/finance/fiscal?propertyId=${P}`, F, { operatorId: '123456782', softwareRegNumber: '12345678' });

    // ── automatic allocation on issue ───────────────────────────────────────
    const s1 = await mkStay(A, A.rooms[0]);
    await charge(A, s1.folio, 7080);
    r = await issue(A, s1.folio, { type: 'tax_invoice', buyer: biz('515555551') });
    let a1 = mock.approvals[mock.approvals.length - 1]?.body || {};
    check('Issue above the threshold → request sent at once and approved; 9 right-most digits printed, full number kept', r.status === 200 && r.data.allocation.status === 'approved' && r.data.allocation.number?.length === 9 && r.data.allocation.fullNumber?.endsWith(r.data.allocation.number) && r.data.allocation.source === 'api' && r.data.number === '5001', JSON.stringify(r.data?.allocation || r));
    check('Approval payload per spec v2: lower-case fields, invoice_type 305, reference number, issuer/customer VAT, amounts, software number, operator id',
      a1.invoice_type === 305 && a1.invoice_id === r.data.id && a1.invoice_reference_number === '5001' && a1.vat_number === 514443210 && a1.customer_vat_number === 515555551 && a1.payment_amount === 6000 && a1.vat_amount === 1080 && a1.payment_amount_including_vat === 7080 && a1.accounting_software_number === 12345678 && a1.user_id === 123456782 && Array.isArray(a1.items) && a1.invoice_date === today,
      JSON.stringify(a1).slice(0, 300));
    check('Bearer token from the sealed store is used', /^Bearer at-/.test(mock.approvals[mock.approvals.length - 1]?.auth || ''), mock.approvals[mock.approvals.length - 1]?.auth);
    let html = await call('GET', `/finance/documents/${r.data.id}/print?propertyId=${P}`, R);
    let text = html.raw?.toString('utf8') || '';
    check('Approved invoice prints as the original with the allocation number', text.includes('>מקור<') && text.includes(r.data.allocation.number), '');

    // ── held invoice (460) → decision ───────────────────────────────────────
    mock.mode['516666662'] = 'held';
    const s2 = await mkStay(A, A.rooms[1]);
    await charge(A, s2.folio, 11800);
    r = await issue(A, s2.folio, { type: 'tax_invoice', buyer: biz('516666662') });
    const heldId = r.data?.id;
    check('Held by the Tax Authority (460) → status "not approved" with the reason, no number invented', r.status === 200 && r.data.allocation.status === 'rejected' && !r.data.allocation.number && /460/.test(r.data.allocation.rejectReason || r.data.allocation.lastError || ''), JSON.stringify(r.data?.allocation));
    check('A held invoice opens an urgent finance work item', await WorkItem.countDocuments({ property: P, dedupeKey: `alloc:${heldId}` }) === 1);
    html = await call('GET', `/finance/documents/${heldId}/print?propertyId=${P}`, R);
    check('Held, no decision yet → printed only as a reference copy', (html.raw?.toString('utf8') || '').includes('העתק לעיון'), '');
    r = await call('PATCH', `/finance/documents/${heldId}/allocation?propertyId=${P}`, F, { decision: 'continue' });
    const dec = mock.decisions[mock.decisions.length - 1];
    check('Decision "continue without a number" is reported to InvoiceDecisionApi/v1/Continue with invoice_id + vat_number', r.status === 200 && r.data.allocation.decision === 'continue' && r.data.allocation.decisionSent === true && dec?.path.endsWith('/InvoiceDecisionApi/v1/Continue') && dec.body.invoice_id === heldId && dec.body.vat_number === 514443210, JSON.stringify(dec || r).slice(0, 200));
    html = await call('GET', `/finance/documents/${heldId}/print?propertyId=${P}`, R);
    text = html.raw?.toString('utf8') || '';
    check('After "continue" the invoice is final and printed with "אין לנכות מס תשומות בגין חשבונית זו"', text.includes('אין לנכות מס תשומות בגין חשבונית זו') && text.includes('>מקור<'), '');

    // ── service down → pending → retry ──────────────────────────────────────
    mock.mode['517777773'] = 'down';
    const s3 = await mkStay(A, A.rooms[2]);
    await charge(A, s3.folio, 9440);
    r = await issue(A, s3.folio, { type: 'tax_invoice', buyer: biz('517777773') });
    const downId = r.data?.id;
    let dd = await Invoice.findById(downId).lean();
    check('Service unavailable → stays pending with the error and a scheduled retry', dd.allocationStatus === 'pending' && dd.allocationRetry === true && dd.allocationNextTryAt > new Date() && /503/.test(dd.allocationLastError || ''), JSON.stringify({ s: dd.allocationStatus, e: dd.allocationLastError }));
    mock.mode['517777773'] = 'approve';
    r = await call('POST', `/finance/fiscal/ita/retry?propertyId=${P}`, F, {});
    dd = await Invoice.findById(downId).lean();
    check('Retry (scheduler / manual) gets the number once the service is back', r.status === 200 && dd.allocationStatus === 'approved' && dd.allocationNumber?.length === 9, JSON.stringify(r.data));

    // ── data error → no automatic retry ─────────────────────────────────────
    mock.mode['518888884'] = 'bad';
    const s4 = await mkStay(A, A.rooms[3]);
    await charge(A, s4.folio, 8260);
    r = await issue(A, s4.folio, { type: 'tax_invoice', buyer: biz('518888884') });
    dd = await Invoice.findById(r.data?.id).lean();
    check('Data error (400 / 431) → pending, flagged, not retried automatically', dd.allocationStatus === 'pending' && dd.allocationRetry === false && /431/.test(dd.allocationLastError || ''), JSON.stringify({ s: dd.allocationStatus, e: dd.allocationLastError, rt: dd.allocationRetry }));

    // ── token refresh ───────────────────────────────────────────────────────
    await Property.updateOne({ _id: P }, { $set: { 'fiscal.ita.expiresAt': new Date(Date.now() - 1000) } });
    const before = mock.refreshCalls;
    const s5 = await mkStay(A, A.rooms[4]);
    await charge(A, s5.folio, 6490);
    r = await issue(A, s5.folio, { type: 'tax_invoice', buyer: biz('515555551') });
    check('Expired access token → refreshed with grant_type=refresh_token, then approved', mock.refreshCalls === before + 1 && r.data?.allocation?.status === 'approved', `${mock.refreshCalls - before} ${r.data?.allocation?.status}`);

    // ── customer asks for a number below the threshold ──────────────────────
    const s6 = await mkStay(A, A.rooms[5]);
    await charge(A, s6.folio, 1180);
    r = await issue(A, s6.folio, { type: 'tax_invoice', buyer: biz('515555551'), requestAllocation: true });
    check('Below the threshold but requested by the business customer → allocation requested and approved', r.data?.allocation?.status === 'approved' && r.data.allocation.requestedByCustomer === true, JSON.stringify(r.data?.allocation));

    // ── refund receipt ──────────────────────────────────────────────────────
    const s7 = await mkStay(A, A.rooms[6]);
    await pay(A, s7.folio, { kind: 'deposit', amount: 800, method: 'credit_card', details: { last4: '1111', approval: 'AP1', cardBrand: 'isracard', installments: 3 } });
    r = await issue(A, s7.folio, { type: 'receipt', buyer: { kind: 'private', name: 'רונית' } });
    const rec1 = r.data;
    let f7 = await Folio.findById(s7.folio._id).lean();
    const payLine = f7.lines.find((l) => l.type === 'deposit');
    r = await call('POST', `/finance/folios/${s7.folio._id}/payments/${payLine._id}/refund`, M, { propertyId: P, amount: 300, reasonCode: 'cancellation', idempotencyKey: key() });
    r = await call('GET', `/finance/folios/${s7.folio._id}/documents/context?propertyId=${P}`, R);
    check('A refund of a receipted payment is offered for its own receipt (−300)', r.data?.types?.receipt?.ok && r.data.payments.length === 1 && r.data.payments[0].amount === -300 && r.data.payments[0].kind === 'refund', JSON.stringify(r.data?.payments));
    r = await issue(A, s7.folio, { type: 'receipt', buyer: { kind: 'private', name: 'רונית' } });
    const rec2 = await Invoice.findById(r.data?.id).lean();
    check('Refund receipt: negative amount, next number in the receipt series, marked as refund', r.status === 200 && rec2.amountPaid === -300 && rec2.payments[0].isRefund === true && Number(rec2.invoiceNumber) === Number(rec1.number) + 1, JSON.stringify({ a: rec2?.amountPaid, n: rec2?.invoiceNumber }));

    // netted refund: refund before receipt → one receipt with net amount
    const s8 = await mkStay(A, A.rooms[7]);
    await pay(A, s8.folio, { kind: 'deposit', amount: 500, method: 'cash' });
    let f8 = await Folio.findById(s8.folio._id).lean();
    await call('POST', `/finance/folios/${s8.folio._id}/payments/${f8.lines[0]._id}/refund`, M, { propertyId: P, amount: 200, reasonCode: 'overpayment', idempotencyKey: key() });
    r = await issue(A, s8.folio, { type: 'receipt', buyer: { kind: 'private', name: 'רונית' } });
    const r8 = await Invoice.findById(r.data?.id).lean();
    const ctx8 = await call('GET', `/finance/folios/${s8.folio._id}/documents/context?propertyId=${P}`, R);
    check('Refund before the receipt is netted (receipt 300) and is not offered again', r8.amountPaid === 300 && r8.payments[0].nettedLineIds.length === 1 && ctx8.data.types.receipt.ok === false, JSON.stringify({ a: r8?.amountPaid, ok: ctx8.data?.types?.receipt }));

    r = await call('PUT', `/finance/fiscal/series/receipt?propertyId=${P}`, F, { next: 900 });
    check('Series start cannot change once documents of that type exist', r.status === 409, r.status);

    // ── e-mail guard (server runs without SMTP in this suite) ───────────────
    r = await call('POST', `/finance/documents/${rec1.id}/send?propertyId=${P}`, R, { to: 'not-an-email' });
    check('Send: invalid address refused', r.status === 422, r.status);
    r = await call('POST', `/finance/documents/${rec1.id}/send?propertyId=${P}`, R, { to: 'guest@example.com' });
    check('Send without SMTP configured → clear 409, nothing logged as sent', r.status === 409 && r.code === 'email_not_configured' && !(await Invoice.findById(rec1.id).lean()).sentLog?.length, `${r.status} ${r.code}`);

    // ── reports ─────────────────────────────────────────────────────────────
    r = await call('GET', `/finance/reports/journal?propertyId=${P}&from=${today}&to=${today}`, F);
    const ti = r.data?.perType?.find((x) => x.type === 'tax_invoice');
    const tiSeries = r.data?.series?.find((x) => x.type === 'tax_invoice');
    check('Journal: per-type count/total and series integrity (tax invoices 5001…, no gaps)', r.status === 200 && ti.count === 6 && tiSeries.first === 5001 && tiSeries.ok === true, JSON.stringify({ ti, tiSeries }));
    await Property.updateOne({ _id: P }, { $inc: { 'docSequences.tax_invoice': 1 } }); // simulate a lost number
    const s9 = await mkStay(A, A.rooms[0]);
    await charge(A, s9.folio, 118);
    await issue(A, s9.folio, { type: 'tax_invoice', buyer: { kind: 'private', name: 'אורח' } });
    r = await call('GET', `/finance/reports/journal?propertyId=${P}&from=${today}&to=${today}`, F);
    const gapS = r.data?.series?.find((x) => x.type === 'tax_invoice');
    check('Journal detects a gap in a series (5007 missing)', gapS.ok === false && gapS.gaps.includes(5007), JSON.stringify(gapS));
    r = await call('GET', `/finance/reports/vat?propertyId=${P}&from=${today}&to=${today}`, F);
    check('VAT report: standard-rated net, VAT and business customers with allocation numbers', r.status === 200 && r.data.summary.vat > 0 && r.data.business.some((x) => x.allocationNumber?.length === 9), JSON.stringify(r.data?.summary));
    r = await call('GET', `/finance/reports/receipts?propertyId=${P}&from=${today}&to=${today}`, F);
    const cardRow = r.data?.byMethod?.find((x) => x.method === 'credit_card');
    check('Receipts report: by method with refunds, card brand / installments breakdown, document link', r.status === 200 && cardRow?.received === 800 && cardRow.refunded === 300 && r.data.cards.some((x) => x.brand === 'isracard' && x.plan === 'תשלומים') && r.data.rows.every((x) => x.document), JSON.stringify(r.data?.byMethod));
    r = await call('GET', `/finance/reports/allocations?propertyId=${P}&from=${today}&to=${today}`, F);
    check('Allocation report: approved / pending / not approved counts and VAT at risk', r.status === 200 && r.data.counts.approved >= 4 && r.data.counts.rejected === 1 && r.data.counts.pending === 1 && r.data.vatAtRisk > 0, JSON.stringify(r.data?.counts));
    const sU = await mkStay(A, A.rooms[1]);
    await charge(A, sU.folio, 236);
    await Reservation.updateOne({ _id: sU.r._id }, { $set: { status: 'checked_out' } });
    r = await call('GET', `/finance/reports/undocumented?propertyId=${P}`, F);
    const und = r.data?.rows?.find((x) => x.folioId === String(sU.folio._id));
    check('Undocumented report flags a departed stay with charges and no invoice as high risk', und?.charges === 236 && und.severity === 'high', JSON.stringify(und));
    r = await call('GET', `/finance/reports/workbook?propertyId=${P}&from=${today}&to=${today}`, F);
    check('Accountant workbook downloads as .xlsx', r.status === 200 && r.raw?.slice(0, 2).toString() === 'PK' && /spreadsheetml/.test(r.ct || ''), `${r.status} ${r.ct}`);
    r = await call('GET', `/finance/reports/workbook?propertyId=${P}&from=${today}&to=${today}`, R);
    check('Workbook export is limited to management / finance', r.status === 403, r.status);

    // ── open format (מבנה אחיד 1.31) ────────────────────────────────────────
    r = await call('POST', `/finance/open-format?propertyId=${P}`, F, { from: today, to: today });
    check('Open format: produced with the verification printout', r.status === 200 && r.data.summary.totalRecords > 2, JSON.stringify(r).slice(0, 200));
    const outer = unzip(Buffer.from(r.data?.zipBase64 || '', 'base64'));
    const yy = today.slice(2, 4);
    const iniE = outer.find((e) => e.name.endsWith('/INI.TXT'));
    const bkE = outer.find((e) => e.name.endsWith('/BKMVDATA.zip'));
    check('Folder structure OPENFRMT/<8 digits>.<YY>/<MMDDhhmm>/ with INI.TXT and BKMVDATA.zip', iniE && bkE && new RegExp(`^OPENFRMT/51444321\\.${yy}/\\d{8}/INI\\.TXT$`).test(iniE.name), outer.map((e) => e.name).join(', '));
    const bk = unzip(bkE.data).find((e) => e.name === 'BKMVDATA.TXT');
    const bkText = iconv.decode(bk.data, 'iso88598');
    const iniText = iconv.decode(iniE.data, 'iso88598');
    const recs = bkText.split('\r\n').filter(Boolean);
    const LEN = { A100: 95, C100: 444, D110: 339, D120: 222, Z900: 110 };
    const badLen = recs.filter((x) => LEN[x.slice(0, 4)] !== x.length);
    check('Every BKMVDATA record has its fixed length (A100 95, C100 444, D110 339, D120 222, Z900 110) and CR+LF endings', badLen.length === 0 && bkText.endsWith('\r\n'), badLen.slice(0, 2).map((x) => `${x.slice(0, 4)}:${x.length}`).join(' '));
    const iniRecs = iniText.split('\r\n').filter(Boolean);
    const a000 = iniRecs[0];
    const pid = a000.slice(33, 48);
    check('A000 is 466 chars, &OF1.31&, same primary id as A100/Z900, total records match', a000.length === 466 && a000.slice(48, 56) === '&OF1.31&' && recs[0].slice(22, 37) === pid && recs[recs.length - 1].slice(22, 37) === pid && Number(a000.slice(9, 24)) === recs.length && Number(recs[recs.length - 1].slice(45, 60)) === recs.length, `${a000.length} ${a000.slice(48, 56)}`);
    const cnt = (code) => recs.filter((x) => x.startsWith(code)).length;
    const iniCount = (code) => Number(iniRecs.find((x) => x.startsWith(code))?.slice(4, 19) || 0);
    check('INI summary records equal the counts in BKMVDATA (C100 / D110 / D120)', ['C100', 'D110', 'D120'].every((c) => iniCount(c) === cnt(c)) && iniRecs.slice(1).every((x) => x.length === 19), JSON.stringify(['C100', 'D110', 'D120'].map((c) => [c, iniCount(c), cnt(c)])));
    check('Record numbers run 1…n and the software registration number / Hebrew names are encoded', recs.every((x, i) => Number(x.slice(4, 13)) === i + 1) && a000.slice(56, 64) === '12345678' && iniText.includes('מלון הבדיקות'), '');
    const c100s = recs.filter((x) => x.startsWith('C100'));
    const firstTi = c100s.find((x) => x.slice(22, 25) === '305');
    check('C100 of a tax invoice: type 305, number, customer VAT number, amount excl. VAT 6000.00 and VAT 1080.00', firstTi && firstTi.slice(25, 45).trim() === '5001' && firstTi.slice(252, 261) === '515555551' && firstTi.slice(317, 332) === '+00000000600000' && firstTi.slice(332, 347) === '+00000000108000', firstTi?.slice(22, 60));
    const d120 = recs.filter((x) => x.startsWith('D120'));
    const cardRec = d120.find((x) => x[49] === '3' && x.slice(103, 118) === '+00000000080000');
    check('D120 of a card receipt: means 3, amount 800.00, clearing company Isracard (1), installments type 2', cardRec && cardRec[118] === '1' && cardRec[139] === '2', cardRec?.slice(45, 145));
    check('The refund receipt is in the file with a negative amount', d120.some((x) => x.slice(103, 118) === '-00000000030000'), '');
    check('Printout lists count and total per document type (§2.6) and warns when the software is not registered', r.data.summary.documents.find((x) => x.code === 305).count === 7 && Array.isArray(r.data.summary.warnings), JSON.stringify(r.data.summary.documents.find((x) => x.code === 305)));
    r = await call('POST', `/finance/open-format?propertyId=${P}`, R, { from: today, to: today });
    check('Open format export is limited to management / finance', r.status === 403, r.status);

    // ── cash drawer ─────────────────────────────────────────────────────────
    const sc = await mkStay(A, A.rooms[2]);
    await charge(A, sc.folio, 1000);
    await pay(A, sc.folio, { amount: 600, method: 'cash', details: { tendered: 1000 } });
    const R2 = A.t.receptionist2;
    await pay(A, sc.folio, { amount: 100, method: 'cash' }, R2);
    r = await call('GET', `/finance/cash?propertyId=${P}`, R);
    const mine = r.data?.rows?.find((x) => x.userId === String(A.users.receptionist._id));
    const adminRow = r.data?.rows?.find((x) => x.userId === String(A.users.property_admin._id));
    check('Cash day: expected cash per cashier = cash taken − cash refunded by that user (500 + 600; the manager refund −200 on their own line)', r.status === 200 && mine?.expected === 1100 && adminRow?.expected === -200, JSON.stringify(r.data?.rows?.map((x) => [x.name, x.expected])));
    r = await call('POST', `/finance/cash/close?propertyId=${P}`, R, { counted: 1090 });
    check('Close with a difference requires an explanation', r.status === 422 && r.fields?.note, r.status);
    r = await call('POST', `/finance/cash/close?propertyId=${P}`, R, { counted: 1090, note: 'עודף שניתן בטעות' });
    const closed = r.data?.rows?.find((x) => x.userId === String(A.users.receptionist._id));
    check('Drawer closed: counted 1090, variance −10, recorded with who closed', r.status === 200 && closed.close.counted === 1090 && closed.close.variance === -10, JSON.stringify(closed?.close));
    r = await call('POST', `/finance/cash/close?propertyId=${P}`, R, { counted: 1100 });
    check('A second close of the same drawer needs a reason (correction keeps history)', r.status === 422, r.status);
    r = await call('POST', `/finance/cash/close?propertyId=${P}`, R, { counted: 100, userId: String(A.users.receptionist2._id) });
    check('A cashier cannot close another cashier\'s drawer', r.status === 403, r.status);
    r = await call('POST', `/finance/cash/close?propertyId=${P}`, M, { counted: 100, userId: String(A.users.receptionist2._id) });
    check('A manager can close another drawer; exact count needs no note', r.status === 200 && r.data.rows.find((x) => x.userId === String(A.users.receptionist2._id)).close.variance === 0, JSON.stringify(r).slice(0, 160));

    // ── disconnect ──────────────────────────────────────────────────────────
    r = await call('POST', `/finance/fiscal/ita/disconnect?propertyId=${P}`, F, {});
    pr = await Property.findById(P).lean();
    check('Disconnect removes the tokens and returns to manual entry', r.status === 200 && pr.fiscal.ita.connected === false && !pr.fiscal.ita.refreshToken && pr.fiscal.allocationMode === 'manual', JSON.stringify(pr.fiscal?.ita).slice(0, 120));
    check('Fiscal actions are audited', await AuditLog.countDocuments({ property: P, action: { $in: ['fiscal.ita_connected', 'fiscal.series_start', 'fiscal.open_format_export', 'cash.closed', 'invoice.allocation_decision', 'fiscal.ita_disconnected'] } }) >= 6);
  } finally {
    const resIds = (await Reservation.find({ property: { $in: props } }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: { $in: props } }, { entityId: { $in: [...props, ...resIds] } }] });
    await removeFiscalTestFixtures(props, TAG);
    await Folio.deleteMany({ property: { $in: props } });
    await ReservationRoom.deleteMany({ property: { $in: props } });
    await Reservation.deleteMany({ property: { $in: props } });
    await GuestProfile.deleteMany({ property: { $in: props } });
    await Company.deleteMany({ property: { $in: props } });
    await ChargeCode.deleteMany({ property: { $in: props } });
    await CashierClose.deleteMany({ property: { $in: props } });
    await WorkItem.deleteMany({ property: { $in: props } });
    await ItaAuthState.deleteMany({ property: { $in: props } });
    await OperationLock.deleteMany({ key: /^docs:/ });
    await Room.deleteMany({ property: { $in: props } });
    await RoomType.deleteMany({ property: { $in: props } });
    await User.deleteMany({ property: { $in: props } });
    await Property.deleteMany({ _id: { $in: props } });
    await mongoose.disconnect();
    mockServer.close();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
