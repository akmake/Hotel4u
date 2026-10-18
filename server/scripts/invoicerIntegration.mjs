#!/usr/bin/env node
/* eslint-disable no-console */
// Documents issued through our standalone invoicing system (owner decision 2026-10-19).
// Starts the REAL invoicer (../invoicer, or INVOICER_DIR) on a disposable Replica Set, creates its
// owner and a hotel4u API key there, mounts the Hotel4u finance + invoicer routes in-process on a second
// disposable database, and checks the checkout document end to end. Never touches the hotel's data,
// .env or the running dev servers.
//
//   npm run qa:invoicer
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVOICER_DIR = path.resolve(process.env.INVOICER_DIR || path.join(__dirname, '../../../invoicer'));
if (!existsSync(path.join(INVOICER_DIR, 'server/start.js'))) {
  console.error(`invoicer not found at ${INVOICER_DIR} — set INVOICER_DIR`);
  process.exit(1);
}
const INV_PORT = Number(process.env.QA_INVOICER_PORT || 4911);
const INV_URL = `http://127.0.0.1:${INV_PORT}`;
const ORIGIN = 'http://127.0.0.1:5180';
const SECRET = 'isolated-invoicer-integration-secret';

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const key = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
// Israeli ID / company number with a valid check digit.
function taxId(prefix) {
  const body = String(prefix).padStart(8, '0').slice(0, 8);
  for (let d = 0; d <= 9; d += 1) {
    const s = body + d;
    const sum = [...s].reduce((acc, ch, i) => { const v = Number(ch) * ((i % 2) + 1); return acc + (v > 9 ? v - 9 : v); }, 0);
    if (sum % 10 === 0) return s;
  }
  throw new Error('no check digit');
}

const repl = await createAccountingTestReplica();
let invoicer; let server;
try {
  // ── the real invoicing system ──────────────────────────────────────────────
  invoicer = spawn(process.execPath, ['server/start.js'], {
    cwd: INVOICER_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MONGO_URI: repl.getUri('invoicer_qa_disposable'), PORT: String(INV_PORT), HOST: '127.0.0.1', APP_ORIGIN: ORIGIN, NODE_ENV: 'test', OUTBOX_INTERVAL_MS: '600000' },
  });
  let invLog = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`invoicer did not start:\n${invLog}`)), 60000);
    const on = (c) => { invLog += c; if (/listening/.test(invLog)) { clearTimeout(t); resolve(); } };
    invoicer.stdout.on('data', on); invoicer.stderr.on('data', on);
    invoicer.on('exit', (code) => { clearTimeout(t); reject(new Error(`invoicer exited ${code}:\n${invLog}`)); });
  });
  const inv = async (route, { method = 'GET', body, cookie, token, idem } = {}) => {
    const r = await fetch(INV_URL + route, { method, headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie') };
  };
  const setup = await inv('/api/auth/setup', { method: 'POST', body: { name: 'QA מנהל', companyName: 'QA', email: 'owner@example.test', password: 'Test-only-password-2026!' } });
  if (setup.status !== 201) throw new Error(`invoicer setup failed: ${JSON.stringify(setup.body)}`);
  const cookie = setup.cookie.split(';')[0];
  const apiClient = await inv('/v1/api-clients', { method: 'POST', cookie, body: { name: 'Hotel4u QA', sourceSystem: 'hotel4u', scopes: ['read', 'write'] } });
  const API_KEY = apiClient.body?.data?.key;
  if (!API_KEY) throw new Error(`api key not created: ${JSON.stringify(apiClient.body)}`);
  const api = (route, opts = {}) => inv(route, { ...opts, token: API_KEY });

  // ── Hotel4u, in-process, on its own disposable database ───────────────────
  Object.assign(process.env, {
    JWT_SECRET: SECRET, INVOICER_API_URL: INV_URL, INVOICER_API_KEY: API_KEY, EMAIL_USER: '', EMAIL_PASS: '', NODE_ENV: 'test', LEGACY_LOCAL_DOCUMENTS: '',
  });
  await mongoose.connect(repl.getUri('hotel4u_invoicer_qa_disposable'));
  const [{ attachActor, requireActor }, { errorHandler }, finance, invoices, invoicerRoutes] = await Promise.all([
    import('../middleware/authContext.js'), import('../middleware/errorHandler.js'),
    import('../routes/finance.js'), import('../routes/invoice.js'), import('../routes/invoicer.js'),
  ]);
  const [User, Property, RoomType, Room, GuestProfile, Reservation, ReservationRoom, Folio, Invoice, Company] = (await Promise.all([
    import('../models/User.js'), import('../models/Property.js'), import('../models/RoomType.js'), import('../models/Room.js'), import('../models/GuestProfile.js'),
    import('../models/Reservation.js'), import('../models/ReservationRoom.js'), import('../models/Folio.js'), import('../models/Invoice.js'), import('../models/Company.js'),
  ])).map((m) => m.default);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const app = express(); app.use(express.json());
  app.use('/api/pms', attachActor, requireActor);
  app.use('/api/pms/finance', finance.default); app.use('/api/pms/invoices', invoices.default); app.use('/api/pms/invoicer', invoicerRoutes.default);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const BASE = `http://127.0.0.1:${server.address().port}/api/pms`;
  const { todayYmdInTimezone } = await import('../utils/dateHelpers.js');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  const SELLER_ID = taxId('5144432');
  const p = await Property.create({ name: 'מלון בדיקה', legalName: 'בדיקות מלונאות בע"מ', taxNumber: SELLER_ID, address: 'הרצל 1', city: 'טבריה', timezone: 'Asia/Jerusalem', vatRate: 18 });
  const P = String(p._id);
  const rt = await RoomType.create({ property: P, code: 'STD', name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
  const room = await Room.create({ property: P, roomType: rt._id, number: '101', floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' });
  const users = {};
  for (const role of ['receptionist', 'finance_manager', 'super_admin']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `qa-${role}@test.local`, passwordHash: 'x', role, active: true });
  const tok = (u) => jwt.sign({ id: String(u._id), role: u.role, propertyId: P, tv: 0 }, SECRET, { expiresIn: '1h' });
  const R = tok(users.receptionist); const F = tok(users.finance_manager);
  const call = async (method, url, t, body, { raw = false } = {}) => {
    const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: raw ? 'text/html' : 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
    if (raw) return { status: res.status, text: await res.text() };
    let json = {}; try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, ...json };
  };
  const guest = await GuestProfile.create({ property: P, firstName: 'דנה', lastName: 'כהן', email: 'dana@test.local', address: { line1: 'הגפן 3', city: 'חיפה' } });
  const COMPANY_ID = taxId('5155555');
  const company = await Company.create({ property: P, name: 'חברת הייטק בע"מ', taxId: COMPANY_ID, address: 'יגאל אלון 90', type: 'corporate' });
  let seq = 0;
  async function mkStay() {
    seq += 1;
    const r = await Reservation.create({
      property: P, confirmationNumber: `QA-${seq}`, status: 'in_house', primaryGuest: guest._id, adults: 2, company: company._id,
      arrivalDate: addDays(today, -2), departureDate: today, nights: 2, roomsCount: 1, roomType: rt._id, ratePerNight: 500, totalAmount: 1000, assignedRoom: room._id, checkedInAt: new Date(),
    });
    await ReservationRoom.create({ reservation: r._id, property: P, roomTypeBooked: rt._id, assignedRoom: room._id, arrivalDate: r.arrivalDate, departureDate: r.departureDate, nightlyRate: 500, status: 'in_house' });
    return Folio.create({ property: P, reservation: r._id, ownerType: 'guest', lines: [] });
  }
  const charge = (folio, gross, dep = 'f_and_b') => call('POST', `/finance/folios/${folio._id}/charges`, R, { propertyId: P, department: dep, quantity: 1, unitPrice: gross, idempotencyKey: key() });
  const pay = (folio, body) => call('POST', `/finance/folios/${folio._id}/payments`, R, { propertyId: P, idempotencyKey: key(), ...body });
  const issue = (folio, body, t = R) => call('POST', `/finance/folios/${folio._id}/documents`, t, { propertyId: P, idempotencyKey: key(), ...body });
  const ctxOf = (folio) => call('GET', `/finance/folios/${folio._id}/documents/context?propertyId=${P}`, R);
  const privateBuyer = { kind: 'private', name: 'דנה כהן' };
  const businessBuyer = { kind: 'business', name: 'חברת הייטק בע"מ', vatNumber: COMPANY_ID, address: 'יגאל אלון 90', city: 'תל אביב' };

  // ── before the property is connected ──────────────────────────────────────
  const f1 = await mkStay();
  let r = await charge(f1, 10);
  await charge(f1, 500, 'minibar');
  await charge(f1, 333.33);
  r = await ctxOf(f1);
  check('context before connecting: issuer is the invoicing system, not ready, says why', r.status === 200 && r.data.issuer.system === 'invoicer' && r.data.issuer.ready === false && /חובר/.test(r.data.issuer.reason) && r.data.seller.ok === false && r.data.allocation === null, JSON.stringify(r.data?.issuer || r));
  r = await issue(f1, { type: 'tax_invoice', buyer: privateBuyer });
  check('issuing before connecting is refused (409, nothing written)', r.status === 409 && (await Invoice.countDocuments({ property: P })) === 0, `${r.status} ${JSON.stringify(r.error || r.message)}`);

  r = await call('POST', '/invoicer/connect', R, { propertyId: P });
  check('connecting the property needs finance / chain admin (receptionist 403)', r.status === 403, String(r.status));
  r = await call('POST', '/invoicer/connect', F, { propertyId: P });
  const WS = r.data?._id;
  check('finance manager connects the property — one workspace keyed by the property id', r.status === 200 && WS && r.data.sourceId === P, JSON.stringify(r).slice(0, 300));

  // ── checkout document: tax invoice / receipt ──────────────────────────────
  await pay(f1, { amount: 843.33, method: 'credit_card', details: { last4: '4242', approval: 'AP778', installments: 1, cardBrand: 'visa' } });
  r = await ctxOf(f1);
  check('context after connecting: ready, tax invoice / receipt recommended (843.33 = 843.33)', r.data?.issuer?.ready === true && r.data.recommended === 'tax_invoice_receipt' && r.data.totals.charges.gross === 843.33, JSON.stringify({ i: r.data?.issuer, rec: r.data?.recommended, t: r.data?.totals }));
  const ik = key();
  const first = await issue(f1, { type: 'tax_invoice_receipt', buyer: privateBuyer, idempotencyKey: ik });
  check('tax invoice / receipt issued in the invoicing system and returned with its number', first.status === 200 && first.data.issuer === 'invoicer' && first.data.number && first.data.external?.documentId, JSON.stringify(first).slice(0, 400));
  const remote = (await api(`/v1/workspaces/${WS}/documents/${first.data?.external?.documentId}`)).body?.data;
  check('the invoicing system holds the issued document: same number, gross 843.33 to the agora, card payment with last 4 only',
    remote?.status === 'issued' && remote.number === first.data.number && remote.gross === '843.33' && remote.payments?.[0]?.method === 'credit_card' && remote.payments[0].details?.last4 === '4242' && !JSON.stringify(remote).includes('AP778XX'),
    JSON.stringify({ s: remote?.status, n: remote?.number, g: remote?.gross, p: remote?.payments }).slice(0, 300));
  check('VAT-inclusive lines: 10.00 → 8.47 + 1.53 (not 8.47 + 1.52)', remote?.lines?.some((l) => l.gross === '10.00' && l.net === '8.47' && l.tax === '1.53'), JSON.stringify(remote?.lines));
  const mirror = await Invoice.findById(first.data?.id).lean();
  check('Hotel4u keeps a mirror only: issuer invoicer, external id, totals from the invoicing system, folio lines covered',
    mirror?.issuer === 'invoicer' && mirror.external?.documentId === remote?._id && mirror.totalGross === 843.33 && mirror.amountPaid === 843.33 && mirror.coveredLineIds?.length === 3 && mirror.invoiceNumber === remote?.number,
    JSON.stringify({ i: mirror?.issuer, g: mirror?.totalGross, c: mirror?.coveredLineIds?.length }));
  const again = await issue(f1, { type: 'tax_invoice_receipt', buyer: privateBuyer, idempotencyKey: ik });
  const remoteCount = (await api(`/v1/workspaces/${WS}/documents`)).body?.data?.length;
  check('a retry with the same request key returns the same document and issues nothing new', again.data?.duplicate === true && again.data.id === first.data.id && remoteCount === 1, JSON.stringify({ d: again.data?.duplicate, remoteCount }));
  r = await issue(f1, { type: 'tax_invoice', buyer: privateBuyer });
  check('the same charges cannot be documented twice', r.status === 409 && r.code === 'nothing_to_document', `${r.status} ${r.error || ''}`);
  r = await ctxOf(f1);
  check('folio context: nothing left to document', r.data?.charges.length === 0 && r.data.payments.length === 0 && r.data.documents.length === 1, JSON.stringify(r.data?.totals));

  r = await call('GET', `/finance/documents/${first.data.id}/print?propertyId=${P}`, R, null, { raw: true });
  check('print is a reference copy marked as a test-environment document of the invoicing system', r.status === 200 && r.text.includes(first.data.number) && r.text.includes('ללא תוקף חשבונאי'), `${r.status}`);
  r = await call('PATCH', `/finance/documents/${first.data.id}/allocation`, F, { propertyId: P, allocationNumber: '123456789' });
  check('allocation number of an invoicing-system document is not set in Hotel4u (409)', r.status === 409, `${r.status}`);
  r = await call('POST', `/finance/documents/${first.data.id}/send`, F, { propertyId: P, to: 'a@b.co' });
  check('sending is done from the invoicing system (409)', r.status === 409, `${r.status}`);
  r = await call('POST', `/finance/invoices/${first.data.id}/credit-note`, F, { propertyId: P, reason: 'בדיקה', idempotencyKey: key() });
  check('credit note is done in the invoicing system (409)', r.status === 409, `${r.status} ${r.error || ''}`);
  r = await call('POST', '/invoices/manual', F, { propertyId: P, type: 'tax_invoice', buyer: privateBuyer, lines: [{ description: 'x', quantity: 1, unitPrice: 100 }], idempotencyKey: key() });
  check('no in-app numbering: a manual invoice in Hotel4u is refused', r.status === 409 && (await Invoice.countDocuments({ property: P, issuer: { $ne: 'invoicer' } })) === 0, `${r.status} ${r.error || r.message || ''}`);

  // ── business payer, invoice then receipt, discount folded, customer reused ─
  const f2 = await mkStay();
  await charge(f2, 1180, 'minibar');
  await charge(f2, 236);
  const fd = await Folio.findById(f2._id);
  fd.lines.push({ type: 'discount', description: 'הנחת מנהל', amount: -84.75, taxAmount: -15.25, vatRate: 18, serviceDate: today, source: 'manual', status: 'posted', postedAt: new Date() });
  await fd.save();
  r = await issue(f2, { type: 'tax_invoice', buyer: businessBuyer });
  const remote2 = (await api(`/v1/workspaces/${WS}/documents/${r.data?.external?.documentId}`)).body?.data;
  check('tax invoice to a business: gross 1,316.00 after the 100.00 discount; discount named in the line it was folded into',
    r.status === 200 && remote2?.gross === '1316.00' && remote2.type === 'tax_invoice' && remote2.buyer?.taxId === COMPANY_ID && remote2.lines.length === 2 && remote2.lines.some((l) => /בניכוי הנחת מנהל 100.00/.test(l.description)),
    JSON.stringify({ s: r.status, e: r.error, g: remote2?.gross, l: remote2?.lines?.map((l) => [l.description, l.gross]) }));
  const m2 = await Invoice.findById(r.data?.id).lean();
  check('mirror covers the discount line too (3 folio lines)', m2?.coveredLineIds?.length === 3, JSON.stringify(m2?.coveredLineIds));
  await pay(f2, { amount: 1000, method: 'bank_transfer', details: { reference: '556677', payDate: addDays(today, -1), payerName: 'חברת הייטק' } });
  await pay(f2, { amount: 316, method: 'cash', details: { tendered: 400 } });
  r = await issue(f2, { type: 'receipt', buyer: businessBuyer });
  const remote3 = (await api(`/v1/workspaces/${WS}/documents/${r.data?.external?.documentId}`)).body?.data;
  check('receipt for the two payments: 1,316.00, transfer reference and cash kept', r.status === 200 && remote3?.type === 'receipt' && remote3.gross === '1316.00' && remote3.payments?.length === 2 && remote3.payments.some((x) => x.method === 'bank_transfer' && x.reference === '556677'), JSON.stringify({ s: r.status, e: r.error, g: remote3?.gross, p: remote3?.payments }).slice(0, 300));
  const f3 = await mkStay();
  await charge(f3, 59);
  r = await issue(f3, { type: 'tax_invoice', buyer: businessBuyer });
  const customers = (await api(`/v1/workspaces/${WS}/customers?q=${encodeURIComponent('חברת הייטק')}`)).body?.data || [];
  check('the same business is one customer in the invoicing system across stays', r.status === 200 && customers.filter((c) => c.externalId === `hotel4u:vat:${COMPANY_ID}`).length === 1, JSON.stringify(customers.map((c) => c.externalId)));

  // ── the invoicing system refuses: nothing is mirrored, the lines stay open ─
  const f4 = await mkStay();
  await charge(f4, 100);
  r = await issue(f4, { type: 'tax_invoice', buyer: { ...businessBuyer, name: 'עסק שגוי', vatNumber: '123456789' } });
  const open = await ctxOf(f4);
  check('a VAT number the invoicing system rejects (check digit) → 422 with its message; no mirror; charge still to document',
    r.status === 422 && /מערכת החשבוניות/.test(r.error || r.message || '') && open.data?.charges.length === 1 && (await Invoice.countDocuments({ folio: f4._id })) === 0,
    `${r.status} ${r.error || r.message || ''}`);
} catch (err) {
  console.error(err);
  results.push(false);
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (invoicer && invoicer.exitCode === null) { invoicer.removeAllListeners('exit'); invoicer.kill(); }
  await mongoose.disconnect().catch(() => null);
  await repl.stop().catch(() => null);
  const passed = results.filter(Boolean).length;
  console.log(`\nSummary: ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
}
