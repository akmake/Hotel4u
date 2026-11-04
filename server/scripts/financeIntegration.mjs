#!/usr/bin/env node
/* eslint-disable no-console */
// Finance integration suite (W08/W09: FIN-01 folio, FIN-02 charge/reversal, FIN-03 payment/deposit,
// FIN-04 refund, FIN-07 credit note, FIN-12 day close). Runs against a live PMS server and the same
// DB. Everything happens on throw-away properties created here, because day close touches every
// stay of a property; all of it is removed at the end.
//
//   node scripts/financeIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
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
import { removeFiscalTestFixtures } from './fiscalTestCleanup.mjs';
import DayCloseRun from '../models/DayCloseRun.js';
import InventoryDate from '../models/InventoryDate.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import AuditLog from '../models/AuditLog.js';
import ChargeCode from '../models/ChargeCode.js';
import WorkItem from '../models/WorkItem.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { postNightsUntil } from '../services/roomCharges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.PMS_ISOLATED_QA !== '1') dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
const TAG = `FIN${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
const tok = (u) => jwt.sign({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, propertyId: String(u.property), tv: Number(u.tokenVersion || 0) }, SECRET, { expiresIn: '1h' });
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const key = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const balOf = (f) => Math.round(f.lines.filter((l) => l.status === 'posted').reduce((s, l) => s + l.amount + (l.taxAmount || 0), 0) * 100) / 100;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const props = [];
  const today = todayYmdInTimezone('Asia/Jerusalem');

  // A self-contained property: room type, rooms, users and a guest.
  async function mkProperty(n) {
    const p = await Property.create({ name: `בדיקה ${TAG}-${n}`, legalName: 'בדיקה בע"מ', taxNumber: '514443210', address: 'רחוב הבדיקה 1', city: 'טבריה', timezone: 'Asia/Jerusalem', vatRate: 18, invoicePrefix: `${TAG}${n}`, invoiceSequence: 0 });
    props.push(p._id);
    const P = String(p._id);
    const rt = await RoomType.create({ property: P, code: `${TAG}${n}`, name: 'סטנדרט', baseRate: 500, capacityBase: 2, capacityMax: 3 });
    const rooms = [];
    for (let i = 1; i <= 4; i += 1) rooms.push(await Room.create({ property: P, roomType: rt._id, number: `${n}0${i}`, floor: 1, cleanStatus: 'clean', opsStatus: 'available', occStatus: 'vacant' }));
    const users = {};
    for (const role of ['property_admin', 'receptionist', 'finance_manager', 'housekeeper']) {
      users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${n}-${role}@test.local`, passwordHash: 'x', role, active: true });
    }
    const guest = await GuestProfile.create({ property: P, firstName: 'אורח', lastName: `${TAG}${n}` });
    return { p, P, rt, rooms, users, guest, t: Object.fromEntries(Object.entries(users).map(([k, u]) => [k, tok(u)])) };
  }
  let seq = 0;
  async function mkStay(ctx, { status = 'in_house', arrival = addDays(today, -2), departure = addDays(today, 1), room = ctx.rooms[0], rate = 500, total } = {}) {
    seq += 1;
    const nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000);
    const r = await Reservation.create({
      property: ctx.P, confirmationNumber: `${TAG}-${seq}`, status, primaryGuest: ctx.guest._id, adults: 2,
      arrivalDate: arrival, departureDate: departure, nights, roomsCount: 1, roomType: ctx.rt._id, ratePerNight: rate,
      totalAmount: total ?? rate * nights, assignedRoom: room._id, checkedInAt: status === 'in_house' ? new Date() : undefined, guaranteeType: 'credit_card',
    });
    await ReservationRoom.create({ reservation: r._id, property: ctx.P, roomTypeBooked: ctx.rt._id, assignedRoom: room._id, arrivalDate: arrival, departureDate: departure, nightlyRate: rate, status: status === 'in_house' ? 'in_house' : 'reserved' });
    const folio = await Folio.create({ property: ctx.P, reservation: r._id, ownerType: 'guest', lines: [] });
    return { r, folio };
  }

  try {
    const A = await mkProperty('A');
    const { P } = A;
    const M = A.t.property_admin; const R = A.t.receptionist; const F = A.t.finance_manager; const H = A.t.housekeeper;

    // ── FIN-01 ──────────────────────────────────────────────────────────────
    const s1 = await mkStay(A);
    let r = await call('GET', `/finance/stays/${s1.r._id}?propertyId=${P}`, R);
    check('FIN-01 stay view returns folio windows and the guarantee separately', r.status === 200 && r.data.folios.length === 1 && r.data.guarantee.type === 'credit_card' && r.data.folios[0].totals.payments === 0, r.error);
    r = await call('GET', `/finance/stays/${s1.r._id}?propertyId=${P}`, H);
    check('RBAC: housekeeper cannot read folios', r.status === 403, r.status);

    // ── FIN-02 charge ───────────────────────────────────────────────────────
    const k1 = key();
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, description: 'מיניבר', department: 'minibar', quantity: 2, unitPrice: 59, idempotencyKey: k1 });
    const r2 = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, description: 'מיניבר', department: 'minibar', quantity: 2, unitPrice: 59, idempotencyKey: k1 });
    let f1 = await Folio.findById(s1.folio._id).lean();
    const ch = f1.lines.find((l) => l.department === 'minibar');
    check('FIN-02 charge 2×59 gross: VAT extracted (100 + 18), posted once for the same key', r.status === 200 && r2.data?.duplicate === true && f1.lines.length === 1 && Math.abs(ch.amount - 100) < 0.01 && Math.abs(ch.taxAmount - 18) < 0.01, JSON.stringify(r).slice(0, 160));
    // ── Cash Basis / No Post ────────────────────────────────────────────────
    const sNp = await mkStay(A, { room: A.rooms[3] });
    const npCharge = (t, extra = {}) => call('POST', `/finance/folios/${sNp.folio._id}/charges`, t, { propertyId: P, department: 'minibar', quantity: 1, unitPrice: 30, idempotencyKey: key(), ...extra });
    r = await call('POST', `/booking/reservations/${sNp.r._id}/no-post`, R, { propertyId: P, on: true });
    check('NP the desk marks a guest "no charge to room"', r.status === 200 && (await Reservation.findById(sNp.r._id).lean()).noPost?.on === true, `${r.status} ${r.error}`);
    r = await npCharge(R);
    check('NP a minibar charge to a no-post guest is refused (code no_post)', r.status === 409 && r.code === 'no_post', `${r.status} ${r.code}`);
    r = await npCharge(R, { noPostApproval: { reason: 'אישור' } });
    check('NP a receptionist cannot approve it', r.status === 403, r.status);
    r = await npCharge(M, { noPostApproval: { reason: '' } });
    check('NP manager approval needs a reason', r.status === 422, r.status);
    r = await npCharge(M, { noPostApproval: { reason: 'האורח השאיר כרטיס' } });
    check('NP a manager approves one charge with a reason — posted and audited', r.status === 200 && !!(await AuditLog.findOne({ entityId: sNp.folio._id, action: 'folio.no_post_override' }).lean()), `${r.status} ${r.error}`);
    r = await call('POST', `/booking/reservations/${sNp.r._id}/no-post`, R, { propertyId: P, on: false });
    check('NP opening charges to the room is a manager decision', r.status === 403, r.status);
    r = await call('POST', `/booking/reservations/${sNp.r._id}/no-post`, M, { propertyId: P, on: false });
    const rOpen = await npCharge(R);
    check('NP after a manager opens it, the desk charges normally', r.status === 200 && rOpen.status === 200, `${r.status} ${rOpen.status} ${rOpen.error}`);
    // ── Voucher: who pays for what ──────────────────────────────────────────
    const { default: CompanyM } = await import('../models/Company.js');
    const { postNightsUntil: postNights } = await import('../services/roomCharges.js');
    const agency = await CompanyM.create({ property: P, name: `סוכנות ${TAG}`, type: 'agency', voucherRequired: true });
    const sV = await mkStay(A, { room: A.rooms[2] });
    await Reservation.updateOne({ _id: sV.r._id }, { $set: { travelAgent: agency._id } });
    r = await call('POST', `/booking/reservations/${sV.r._id}/voucher`, R, { propertyId: P, type: 'agent_room' });
    check('VCH the agency requires a voucher number', r.status === 422 && r.fields?.voucherNumber, `${r.status} ${JSON.stringify(r.fields)}`);
    r = await call('POST', `/booking/reservations/${sV.r._id}/voucher`, R, { propertyId: P, type: 'agent_room', number: 'V-1001' });
    const payerWin = await Folio.findOne({ reservation: sV.r._id, ownerType: 'company', ownerRef: String(agency._id) }).lean();
    check('VCH "room on the agent" opens the agent window', r.status === 200 && !!payerWin, `${r.status} ${r.error}`);
    await postNights({ reservation: await Reservation.findById(sV.r._id), until: today, source: 'night_audit' });
    const vWins = await Folio.find({ reservation: sV.r._id }).lean();
    const onPayer = vWins.find((f) => f.ownerType === 'company').lines.filter((l) => l.department === 'rooms').length;
    const onGuest = vWins.filter((f) => f.ownerType === 'guest').flatMap((f) => f.lines).filter((l) => l.department === 'rooms').length;
    check('VCH nights route to the agent window, none on the guest', onPayer === 2 && onGuest === 0, `${onPayer}/${onGuest}`);
    r = await call('POST', `/finance/folios/${sV.folio._id}/charges`, R, { propertyId: P, department: 'minibar', quantity: 1, unitPrice: 40, idempotencyKey: key() });
    check('VCH with "room on the agent" an extra stays on the guest', r.status === 200 && r.data.folioId === String(sV.folio._id) && !r.data.routed, `${r.status} ${r.data?.folioId}`);
    await call('POST', `/booking/reservations/${sV.r._id}/voucher`, R, { propertyId: P, type: 'agent_all', number: 'V-1001' });
    r = await call('POST', `/finance/folios/${sV.folio._id}/charges`, R, { propertyId: P, department: 'minibar', quantity: 1, unitPrice: 40, idempotencyKey: key() });
    check('VCH with "agent pays all" an extra posted to the guest is routed to the agent', r.status === 200 && r.data.folioId === String(payerWin._id) && r.data.routed?.reason === 'voucher', `${r.status} ${r.data?.folioId}`);
    const sD = await mkStay(A, { room: A.rooms[1] });
    await Reservation.updateOne({ _id: sD.r._id }, { $set: { travelAgent: agency._id } });
    r = await call('POST', `/booking/reservations/${sD.r._id}/voucher`, R, { propertyId: P, type: 'deposit', number: 'V-2002', amount: 700 });
    await postNights({ reservation: await Reservation.findById(sD.r._id), until: today, source: 'night_audit' });
    const dWins = await Folio.find({ reservation: sD.r._id }).lean();
    const round = (n) => Math.round(n * 100) / 100;
    const grossOf = (f) => round(f.lines.filter((l) => l.department === 'rooms').reduce((t, l) => t + l.amount + l.taxAmount, 0));
    const pG = grossOf(dWins.find((f) => f.ownerType === 'company')); const gG = grossOf(dWins.find((f) => f.ownerType === 'guest'));
    check('VCH "deposit" 700 over 2×500: agent 700 (one night + split), guest 300', r.status === 200 && pG === 700 && gG === 300, `${r.status} ${r.error || ''} ${pG}/${gG}`);
    // ── LOP: folio line operations (gap-map item 2) ─────────────────────────
    const sL = await mkStay(A, { room: A.rooms[3] });
    const LF = String(sL.folio._id);
    const post = async (department, unitPrice) => (await call('POST', `/finance/folios/${LF}/charges`, R, { propertyId: P, department, quantity: 1, unitPrice, idempotencyKey: key() })).data?.lineId;
    const c1 = await post('spa', 200); const c2 = await post('minibar', 100); const c3 = await post('spa', 50);
    const bal = async (id = LF) => balOf(await Folio.findById(id).lean());
    const dk = key();
    r = await call('POST', `/finance/folios/${LF}/lines/discount`, R, { propertyId: P, lineIds: [c1], kind: 'percent', value: 10, reasonCode: 'returning_guest', idempotencyKey: dk });
    const r2l = await call('POST', `/finance/folios/${LF}/lines/discount`, R, { propertyId: P, lineIds: [c1], kind: 'percent', value: 10, reasonCode: 'returning_guest', idempotencyKey: dk });
    check('LOP 10% discount on a line: a linked discount line, balance 350 → 330, posted once per key', r.status === 200 && r2l.data?.duplicate && await bal() === 330 && (await Folio.findById(LF).lean()).lines.filter((l) => String(l.discountOf || '') === c1).length === 1, `${r.status} ${r.error} ${await bal()}`);
    r = await call('POST', `/finance/folios/${LF}/lines/discount`, R, { propertyId: P, lineIds: [c3], kind: 'percent', value: 50, reasonCode: 'service_recovery', idempotencyKey: key() });
    check('LOP 50% discount by a receptionist needs a manager (discount_needs_approval)', r.status === 403 && r.code === 'discount_needs_approval', `${r.status} ${r.code}`);
    r = await call('POST', `/finance/folios/${LF}/lines/discount`, M, { propertyId: P, lineIds: [c3], kind: 'amount', value: 20, idempotencyKey: key() });
    check('LOP a discount needs a reason from the list', r.status === 422 && r.fields?.reasonCode, `${r.status}`);
    r = await call('POST', `/stays/${sL.r._id}/windows`.replace('/stays', '/finance/stays'), R, { propertyId: P, label: 'עסקי' });
    const W2 = r.data?.folioId;
    check('LOP a second window opens for the stay', r.status === 200 && !!W2, `${r.status} ${r.error}`);
    r = await call('POST', `/finance/folios/${LF}/lines/${c2}/split`, R, { propertyId: P, kind: 'amount', value: 40, toFolioId: W2, idempotencyKey: key() });
    const lf = await Folio.findById(LF).lean();
    const kept = lf.lines.find((l) => String(l.splitOf || '') === c2);
    check('LOP split 100 → 60 stays + 40 to the second window; original reversed, not edited', r.status === 200 && await bal() === 290 && await bal(W2) === 40 && lf.lines.some((l) => String(l.reversalOf || '') === c2) && lf.lines.find((l) => String(l._id) === c2).status === 'posted' && !!kept, `${r.status} ${r.error} ${await bal()}/${await bal(W2)}`);
    r = await call('POST', `/finance/folios/${LF}/lines/transfer`, R, { propertyId: P, lineIds: [c3], toReservationId: String(sD.r._id), idempotencyKey: key() });
    check('LOP moving a line to another room needs a reason', r.status === 422 && r.fields?.reason, `${r.status}`);
    const dGuest = String(dWins.find((f) => f.ownerType === 'guest')._id);
    const dBefore = await bal(dGuest);
    r = await call('POST', `/finance/folios/${LF}/lines/transfer`, R, { propertyId: P, lineIds: [c3], toReservationId: String(sD.r._id), reason: 'האורח ביקש לחייב את חדר החבר', idempotencyKey: key() });
    check('LOP transfer 50 to another room: out of here, onto that guest, both linked', r.status === 200 && await bal() === 240 && round(await bal(dGuest) - dBefore) === 50 && (await Folio.findById(dGuest).lean()).lines.some((l) => String(l.transferFrom?.line || '') === c3), `${r.status} ${r.error}`);
    r = await call('POST', `/finance/folios/${LF}/lines/transfer`, R, { propertyId: P, lineIds: [c3], toFolioId: W2, idempotencyKey: key() });
    check('LOP a line already moved cannot be moved again from here', r.status === 409, r.status);
    r = await call('POST', `/finance/folios/${LF}/combos`, R, { propertyId: P, lineIds: [c1, String(kept._id)], label: 'ספא ומיניבר' });
    const r2c = await call('POST', `/finance/folios/${LF}/combos`, R, { propertyId: P, lineIds: [c1, String(kept._id)], label: 'שוב' });
    check('LOP combine two lines for the invoice; a line cannot be in two combinations; money unchanged', r.status === 200 && r2c.status === 409 && await bal() === 240, `${r.status} ${r.error} ${r2c.status}`);
    r = await call('GET', `/finance/stays/${sL.r._id}?propertyId=${P}`, R);
    const mainWin = r.data?.folios.find((f) => f.id === LF);
    check('LOP stay view shows the combination on its lines and the second window by name', mainWin?.combos?.length === 1 && mainWin.lines.find((l) => l.id === c1)?.combo?.label === 'ספא ומיניבר' && r.data.folios.some((f) => f.owner === 'עסקי' && f.extra), r.error);
    r = await call('POST', `/finance/folios/${LF}/lines/${c1}/reverse`, M, { propertyId: P, reason: 'נרשם בטעות' });
    check('LOP reversing a discounted charge reverses its discount too (200 − 20 → 0)', r.status === 200 && await bal() === 60, `${r.status} ${r.error} ${await bal()}`);
    r = await call('POST', `/finance/folios/${LF}/paid-out`, R, { propertyId: P, amount: 80, purpose: 'taxi', payee: 'נהג מונית', idempotencyKey: key() });
    const po = (await Folio.findById(LF).lean()).lines.find((l) => l.paidOut?.purpose === 'taxi');
    const vw = (await call('GET', `/finance/stays/${sL.r._id}?propertyId=${P}`, R)).data?.folios.find((f) => f.id === LF);
    check('LOP Paid Out 80 by taxi: cash-out line in the guest folio, guest owes it (60 → 140), shown apart from refunds', r.status === 200 && po?.method === 'cash' && po.type === 'refund' && await bal() === 140 && vw?.totals.paidOut === 80 && vw?.totals.refunds === 0, `${r.status} ${r.error} ${await bal()}`);
    r = await call('POST', `/finance/folios/${LF}/paid-out`, R, { propertyId: P, amount: 80, purpose: 'other', idempotencyKey: key() });
    check('LOP Paid Out "other" needs a note', r.status === 422 && r.fields?.note, r.status);
    r = await call('POST', `/frontdesk/reservations/${sL.r._id}/post-nights`, R, { propertyId: P, ahead: true });
    const nightsHere = (await Folio.find({ reservation: sL.r._id }).lean()).map((f) => [String(f._id), f.lines.filter((l) => l.department === 'rooms' && !l.reversalOf)]);
    const mainNights = nightsHere.find(([id]) => id === LF)[1];
    check('LOP Auto Post charges tonight in advance, on the main window only', r.status === 200 && mainNights.some((l) => l.serviceDate === today) && nightsHere.filter(([id]) => id !== LF).every(([, ls]) => !ls.length), `${r.status} ${r.error} ${mainNights.map((l) => l.serviceDate)}`);
    r = await call('POST', `/frontdesk/reservations/${sL.r._id}/post-nights`, R, { propertyId: P, ahead: true });
    check('LOP Auto Post twice → "already posted", nothing charged twice', r.status === 409 && r.code === 'already_posted', `${r.status} ${r.code}`);

    // ── FX: foreign currency on the folio (gap-map item 3) ──────────────────
    r = await call('PUT', '/cashier/fx/rates/USD', M, { propertyId: P, buy: 3.6, sell: 3.8, pay: 3.7, charge: 3.75 });
    check('FX folio rates (pay / charge) are stored next to the cash rates', r.status === 200 && r.data.rates.find((x) => x.currency === 'USD')?.pay === 3.7, `${r.status} ${r.error}`);
    r = await call('POST', `/finance/folios/${LF}/charges`, R, { propertyId: P, department: 'spa', quantity: 1, currency: 'USD', foreignUnitPrice: 40, idempotencyKey: key() });
    let fxLine = (await Folio.findById(LF).lean()).lines.find((l) => String(l._id) === r.data?.lineId);
    check('FX a $40 charge posts 150 ₪ at the charge rate 3.75 and keeps $40 on the line', r.status === 200 && r.data.gross === 150 && fxLine?.fx?.currency === 'USD' && fxLine.fx.amount === 40 && fxLine.fx.rate === 3.75, `${r.status} ${r.error} ${r.data?.gross}`);
    r = await call('POST', `/finance/folios/${LF}/charges`, R, { propertyId: P, department: 'spa', quantity: 1, currency: 'EUR', foreignUnitPrice: 40, idempotencyKey: key() });
    check('FX a currency without a rate is refused (no_rate)', r.status === 422 && r.code === 'no_rate', `${r.status} ${r.code}`);
    const shiftOpen = await call('POST', '/cashier/shifts', F, { propertyId: P, openingFloat: 500 });
    r = await call('POST', `/finance/folios/${LF}/payments`, F, { propertyId: P, kind: 'payment', amount: 100, method: 'cash', fx: { currency: 'USD', tendered: 30 }, idempotencyKey: key() });
    fxLine = (await Folio.findById(LF).lean()).lines.find((l) => String(l._id) === r.data?.lineId);
    check('FX $30 cash for 100 ₪ at the pay rate 3.7 = 111 ₪: folio credited 100, change 11 ₪', r.status === 200 && fxLine?.amount === -100 && fxLine.fx?.amount === 30 && fxLine.payDetails?.change === 11 && r.data.change === 11, `${r.status} ${r.error}`);
    const sh = await call('GET', `/cashier/shifts?propertyId=${P}`, F);
    check('FX the cashier shift expects $30 more and 11 ₪ less in the drawer', shiftOpen.status === 200 && sh.data?.current?.foreign?.find((x) => x.currency === 'USD')?.expected === 30 && sh.data.current.expected === 489, `${shiftOpen.status} ${JSON.stringify(sh.data?.current?.foreign)} ${sh.data?.current?.expected}`);
    r = await call('POST', `/finance/folios/${LF}/payments`, F, { propertyId: P, kind: 'payment', amount: 100, method: 'cash', fx: { currency: 'USD', tendered: 20 }, idempotencyKey: key() });
    check('FX foreign cash worth less than the amount credited is refused', r.status === 422 && r.fields?.tendered, `${r.status}`);
    r = await call('POST', `/finance/folios/${LF}/payments`, F, { propertyId: P, kind: 'payment', amount: 100, method: 'bank_transfer', fx: { currency: 'USD', tendered: 30 }, idempotencyKey: key() });
    check('FX a foreign-currency payment is cash only', r.status === 422 && r.fields?.method, `${r.status}`);
    r = await call('GET', `/finance/stays/${sL.r._id}?propertyId=${P}`, R);
    check('FX the stay view carries the folio rates (balance in every currency)', r.data?.fxRates?.some((x) => x.currency === 'USD' && x.pay === 3.7 && x.charge === 3.75), r.error);

    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, description: 'ספא', department: 'spa', quantity: 1, unitPrice: 100, serviceDate: addDays(today, 3), idempotencyKey: key() });
    check('FIN-02 service date after the business day is refused', r.status === 422 && r.fields?.serviceDate, r.status);
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${ch._id}/reverse`, R, { propertyId: P, reason: 'טעות' });
    check('FIN-02 receptionist cannot reverse a charge', r.status === 403, r.status);
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${ch._id}/reverse`, M, { propertyId: P });
    check('FIN-02 reversal requires a reason', r.status === 422, r.status);
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${ch._id}/reverse`, M, { propertyId: P, reason: 'נרשם בטעות' });
    f1 = await Folio.findById(s1.folio._id).lean();
    check('FIN-02 reversal is a linked counter line; nothing deleted; balance 0', r.status === 200 && f1.lines.length === 2 && f1.lines[0].status === 'posted' && String(f1.lines[1].reversalOf) === String(ch._id) && Math.abs(balOf(f1)) < 0.01, JSON.stringify(r).slice(0, 160));
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${ch._id}/reverse`, M, { propertyId: P, reason: 'שוב' });
    check('FIN-02 the same charge cannot be reversed twice', r.status === 409, r.status);

    // A charge on an issued document cannot be reversed (T18) — correction is a credit note.
    r = await call('POST', `/finance/folios/${s1.folio._id}/charges`, R, { propertyId: P, description: 'חניה', department: 'parking', quantity: 1, unitPrice: 1180, idempotencyKey: key() });
    f1 = await Folio.findById(s1.folio._id).lean();
    const parking = f1.lines.find((l) => l.department === 'parking');
    const inv = await Invoice.create({
      property: P, folio: s1.folio._id, reservation: s1.r._id, type: 'tax_invoice', invoiceNumber: `${TAG}-INV1`, status: 'issued',
      issueDate: today, seller: { name: 'בדיקה' }, buyer: { name: 'אורח' }, vatRate: 18, totalNet: 1000, totalVat: 180, totalGross: 1180,
      lines: [{ description: 'חניה', quantity: 1, unitPrice: 1000, netAmount: 1000, vatRate: 18, vatAmount: 180, grossAmount: 1180, folioLineId: parking._id }],
    });
    r = await call('POST', `/finance/folios/${s1.folio._id}/lines/${parking._id}/reverse`, M, { propertyId: P, reason: 'ביטול' });
    check('FIN-02 a charge on an issued document cannot be reversed (T18)', r.status === 409 && r.code === 'on_document', r.status);

    // ── FIN-07 credit note ──────────────────────────────────────────────────
    const invBeforeCredit = await Invoice.findById(inv._id).lean();
    const creditCountBefore = await Invoice.countDocuments({ property: P, type: 'credit_note' });
    r = await call('POST', `/finance/invoices/${inv._id}/credit-note`, R, { propertyId: P, idempotencyKey: key(), amount: 100, reason: 'החזר' });
    check('FIN-07 receptionist cannot issue a credit note', r.status === 403, r.status);
    r = await call('POST', `/finance/invoices/${inv._id}/credit-note`, F, { propertyId: P, idempotencyKey: key(), amount: 100 });
    check('FIN-07 credit note requires a reason', r.status === 422, r.status);
    r = await call('POST', `/finance/invoices/${inv._id}/credit-note`, F, { propertyId: P, idempotencyKey: key(), amount: 700, reason: 'שירות חלקי' });
    const r2b = await call('POST', `/finance/invoices/${inv._id}/credit-note`, F, { propertyId: P, idempotencyKey: key(), amount: 700, reason: 'שוב' });
    const invAfter = await Invoice.findById(inv._id).lean();
    check('FIN-07 local credit issuance is refused with an explicit external-issuer gate', r.status === 409 && r.code === 'managed_by_invoicer' && r2b.status === 409 && r2b.code === 'managed_by_invoicer', `${r.status}/${r2b.status} ${r2b.error || ''}`);
    check('FIN-07 refused local credits leave the original document and credit count unchanged', JSON.stringify(invAfter) === JSON.stringify(invBeforeCredit) && await Invoice.countDocuments({ property: P, type: 'credit_note' }) === creditCountBefore);

    // ── FIN-03 payment / deposit ────────────────────────────────────────────
    const s2 = await mkStay(A, { room: A.rooms[1] });
    await call('POST', `/finance/folios/${s2.folio._id}/charges`, R, { propertyId: P, description: 'ארוחה', department: 'f_and_b', quantity: 1, unitPrice: 500, idempotencyKey: key() });
    r = await call('POST', `/finance/folios/${s2.folio._id}/payments`, R, { propertyId: P, amount: 600, method: 'cash', idempotencyKey: key() });
    check('FIN-03 payment above the balance is refused', r.status === 422, r.status);
    r = await call('POST', `/finance/folios/${s2.folio._id}/payments`, R, { propertyId: P, amount: 200, method: 'bank_transfer', idempotencyKey: key() });
    check('FIN-03 bank transfer requires a reference and a transfer date', r.status === 422 && r.fields?.reference && r.fields?.payDate, JSON.stringify(r.fields));
    const pk = key();
    r = await call('POST', `/finance/folios/${s2.folio._id}/payments`, R, { propertyId: P, amount: 500, method: 'cash', idempotencyKey: pk });
    const rDup = await call('POST', `/finance/folios/${s2.folio._id}/payments`, R, { propertyId: P, amount: 500, method: 'cash', idempotencyKey: pk });
    check('FIN-03 payment recorded once for the same key', r.status === 200 && rDup.data?.duplicate === true && Math.abs(rDup.data.balance) < 0.01, r.error);
    const s3 = await mkStay(A, { status: 'confirmed', arrival: addDays(today, 5), departure: addDays(today, 7), room: A.rooms[2], rate: 400 });
    r = await call('POST', `/finance/folios/${s3.folio._id}/payments`, R, { propertyId: P, amount: 300, method: 'credit_card', details: { last4: '4242', approval: 'AB1234' }, kind: 'deposit', idempotencyKey: key() });
    const rOver = await call('POST', `/finance/folios/${s3.folio._id}/payments`, R, { propertyId: P, amount: 600, method: 'credit_card', details: { last4: '4242', approval: 'AB1235' }, kind: 'deposit', idempotencyKey: key() });
    check('FIN-03 deposit before arrival is allowed up to the stay total', r.status === 200 && rOver.status === 422, `${r.status}/${rOver.status}`);
    await Property.updateOne({ _id: P }, { $set: { 'financePolicy.cashLimitPerStay': 1000 } });
    const s4 = await mkStay(A, { room: A.rooms[3] });
    await call('POST', `/finance/folios/${s4.folio._id}/charges`, R, { propertyId: P, description: 'אירוע', department: 'other', quantity: 1, unitPrice: 2000, idempotencyKey: key() });
    r = await call('POST', `/finance/folios/${s4.folio._id}/payments`, R, { propertyId: P, amount: 800, method: 'cash', idempotencyKey: key() });
    const rCash = await call('POST', `/finance/folios/${s4.folio._id}/payments`, R, { propertyId: P, amount: 300, method: 'cash', idempotencyKey: key() });
    check('FIN-03 cash is checked cumulatively per stay (T25 policy)', r.status === 200 && rCash.status === 422 && rCash.code === 'cash_limit', `${r.status}/${rCash.status}`);
    await Property.updateOne({ _id: P }, { $set: { 'financePolicy.cashLimitPerStay': null } });

    // ── FIN-04 refund ───────────────────────────────────────────────────────
    // Deposit 300 on s3 is a credit of 300 (no charges yet).
    const f3 = await Folio.findById(s3.folio._id).lean();
    const dep = f3.lines.find((l) => l.type === 'deposit');
    r = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, R, { propertyId: P, amount: 100, reasonCode: 'cancellation', idempotencyKey: key() });
    check('FIN-04 refund above the approval threshold is blocked for a receptionist (T36)', r.status === 403 && r.code === 'approval_required', r.status);
    r = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, F, { propertyId: P, amount: 100, idempotencyKey: key() });
    check('FIN-04 refund requires a reason', r.status === 422 && r.fields?.reasonCode, r.status);
    const ra = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, F, { propertyId: P, amount: 200, reasonCode: 'overpayment', idempotencyKey: key() });
    const rb = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, F, { propertyId: P, amount: 200, reasonCode: 'overpayment', idempotencyKey: key() });
    const rc = await call('POST', `/finance/folios/${s3.folio._id}/payments/${dep._id}/refund`, F, { propertyId: P, amount: 100, reasonCode: 'overpayment', idempotencyKey: key() });
    check('FIN-04 partial refunds are capped cumulatively per payment (T16)', ra.status === 200 && rb.status === 422 && rc.status === 200 && rc.data.refundable === 0, `${ra.status}/${rb.status}/${rc.status}`);
    const f2 = await Folio.findById(s2.folio._id).lean();
    const cashPay = f2.lines.find((l) => l.type === 'payment');
    r = await call('POST', `/finance/folios/${s2.folio._id}/payments/${cashPay._id}/refund`, F, { propertyId: P, amount: 100, reasonCode: 'complaint', idempotencyKey: key() });
    check('FIN-04 a refund cannot turn a settled folio into a debt', r.status === 422 && r.code === 'exceeds_credit', r.status);
    r = await call('GET', `/finance/folios?propertyId=${P}&view=credit`, F);
    check('FIN-01 folio index lists folios', r.status === 200 && Array.isArray(r.data.rows), r.status);

    // ── FIN-12 day close on property A (full run) ───────────────────────────
    const arrival = await mkStay(A, { status: 'confirmed', arrival: today, departure: addDays(today, 2), room: A.rooms[3] });
    const leaving = await mkStay(A, { arrival: addDays(today, -1), departure: today, room: A.rooms[2] });
    let dc = await call('GET', `/finance/day-close?propertyId=${P}`, M);
    check('FIN-12 readiness lists the pending arrival and the departure not checked out', dc.status === 200 && dc.data.dateToClose === today && dc.data.readiness.arrivals.some((a) => a.id === String(arrival.r._id)) && dc.data.readiness.departures.some((d) => d.id === String(leaving.r._id)), JSON.stringify(dc.data?.readiness || dc).slice(0, 200));
    check('FIN-09 readiness lists the receptionist drawer with cash and no close', dc.data.readiness.cash?.open?.some((c) => c.expected > 0), JSON.stringify(dc.data.readiness.cash));
    check('FIN-12 readiness previews the nights to post (does not charge)', dc.data.readiness.nights.count > 0 && (await Folio.findById(s1.folio._id).lean()).lines.every((l) => l.department !== 'rooms'));
    r = await call('POST', '/finance/day-close/run', R, { propertyId: P });
    check('RBAC: receptionist cannot run day close', r.status === 403, r.status);
    r = await call('POST', '/finance/day-close/run', M, { propertyId: P });
    check('FIN-12 open arrivals/departures require explicit decisions', r.status === 422 && r.code === 'decisions_required' && r.fields?.arrivals, r.status);
    r = await call('POST', '/finance/day-close/run', M, { propertyId: P, date: addDays(today, 1), arrivals: 'keep', reason: 'מאחרים' });
    check('FIN-12 a future day cannot be closed', r.status === 409, r.status);
    r = await call('POST', '/finance/day-close/run', M, { propertyId: P, arrivals: 'keep', reason: 'האורחים מאחרים — יגיעו בלילה' });
    const nightsA = (await Folio.findById(s1.folio._id).lean()).lines.filter((l) => l.department === 'rooms').length;
    check('FIN-12 run completes: steps done, nights posted through the business day', r.status === 200 && r.data.status === 'done' && r.data.steps.find((s) => s.key === 'post_nights').status === 'done' && nightsA === 3, JSON.stringify(r).slice(0, 220));
    check('FIN-12 "keep" leaves the arrival open (no silent no-show)', (await Reservation.findById(arrival.r._id).lean()).status === 'confirmed');
    check('FIN-12 snapshot report recorded for the day', !!r.data?.steps?.find((s) => s.key === 'snapshot')?.result?.roomNights);
    r = await call('POST', '/finance/day-close/run', M, { propertyId: P, arrivals: 'keep', reason: 'שוב' });
    check('FIN-12 the same day cannot be closed twice', r.status === 409 && r.code === 'already_closed', r.status);
    check('FIN-12 the property records the last closed day', (await Property.findById(P).lean()).dayClose?.lastClosedDate === today);

    // ── FIN-12 resume after a failure (T33) on property B ───────────────────
    const B = await mkProperty('B');
    const sb = await mkStay(B);
    const pending = await mkStay(B, { status: 'confirmed', arrival: today, departure: addDays(today, 1), room: B.rooms[1] });
    // A first attempt posted the nights and then stopped before no-shows.
    const postedFirst = await postNightsUntil({ reservation: await Reservation.findById(sb.r._id), until: addDays(today, 1), source: 'night_audit' });
    await DayCloseRun.create({
      property: B.P, businessDate: today, runNo: `DC-${today.replace(/-/g, '')}`, status: 'running', attempts: 1, heartbeatAt: new Date(),
      options: { arrivals: 'no_show', reason: 'לא הגיעו' },
      steps: [{ key: 'post_nights', status: 'done', result: { posted: postedFirst } }, { key: 'no_shows', status: 'running' }, { key: 'snapshot', status: 'pending' }, { key: 'advance', status: 'pending' }],
    });
    r = await call('POST', '/finance/day-close/run', B.t.property_admin, { propertyId: B.P, arrivals: 'no_show', reason: 'לא הגיעו' });
    check('FIN-12 a second operator is refused while a run is active', r.status === 409 && r.code === 'busy', r.status);
    await DayCloseRun.updateOne({ property: B.P, businessDate: today }, { $set: { status: 'failed', 'steps.1.status': 'failed', 'steps.1.error': 'נפל באמצע' } });
    r = await call('POST', '/finance/day-close/run', B.t.property_admin, { propertyId: B.P, arrivals: 'no_show', reason: 'לא הגיעו' });
    const nightsB = (await Folio.find({ reservation: sb.r._id }).lean()).flatMap((f) => f.lines).filter((l) => l.department === 'rooms').length;
    check('FIN-12 resume continues from the failed step without posting nights twice (T33)', r.status === 200 && r.data.status === 'done' && r.data.attempts === 2 && postedFirst === 3 && nightsB === 3, JSON.stringify({ s: r.status, st: r.data?.status, a: r.data?.attempts, postedFirst, nightsB }));
    check('FIN-12 no-show decision applied on resume', (await Reservation.findById(pending.r._id).lean()).status === 'no_show');

    // Legacy night audit no longer writes.
    r = await call('POST', '/reports/night-audit', M, { propertyId: P });
    check('Legacy night audit write is closed (moved to FIN-12)', r.status === 410, r.status);
  } finally {
    const resIds = (await Reservation.find({ property: { $in: props } }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: { $in: props } }, { entityId: { $in: [...props, ...resIds] } }] });
    await removeFiscalTestFixtures(props, TAG);
    // Explicit raw cleanup of the throw-away fixture properties; runtime deletes stay guarded.
    await Folio.collection.deleteMany({ property: { $in: props } });
    await ReservationRoom.deleteMany({ property: { $in: props } });
    await Reservation.deleteMany({ property: { $in: props } });
    await DayCloseRun.deleteMany({ property: { $in: props } });
    await InventoryDate.deleteMany({ property: { $in: props } });
    await HousekeepingTask.deleteMany({ property: { $in: props } });
    await GuestProfile.deleteMany({ property: { $in: props } });
    await ChargeCode.deleteMany({ property: { $in: props } });
    await WorkItem.deleteMany({ property: { $in: props } });
    { const { default: CashierShift } = await import('../models/CashierShift.js'); const { FxRate } = await import('../models/CurrencyExchange.js'); await CashierShift.deleteMany({ property: { $in: props } }); await FxRate.deleteMany({ property: { $in: props } }); }
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
