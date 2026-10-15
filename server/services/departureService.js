// In-house, departures and stay closing (spec W06: FD-06 / FD-07 / FD-08, reading FIN-01).
//
// Rules this file enforces (all server-side):
//  - every folio of the reservation is checked, not just one (T11);
//  - leaving the room and settling the money are separate: a unit can leave with an open balance
//    only through an explicit settlement (company receivable within limit, or a manager exception
//    with a reason) — the folio then stays open and visible, it is never closed with money on it;
//  - a credit balance is not "paid": it must be refunded or approved;
//  - payments and refunds are idempotent per client key, refunds are capped at the credit balance;
//  - partial departure of a multi-room stay leaves the shared folios open.
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Room from '../models/Room.js';
import { resolveChargeCode, taxFor } from './chargeCodeService.js';
import { vatForLine } from './touristService.js';
import Folio from '../models/Folio.js';
import Company from '../models/Company.js';
import Invoice from '../models/Invoice.js';
import GuestRequest from '../models/GuestRequest.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { incrementInventory } from './availabilityService.js';
import { planNights, postPlannedNights, lodgingFolio, postNightsUntil } from './roomCharges.js';
import { fireEvent } from './automationEngine.js';
import { recordFolioPayment } from './financeService.js';
import {
  httpError, loadProperty, businessDateOf, ensureUnits, loadReservationInScope, guaranteeState,
  MANAGER_ROLES, IN_HOUSE_STATUSES, withLocks,
} from './frontDeskService.js';

const FINANCE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const REFUND_ROLES = [...new Set([...MANAGER_ROLES, ...FINANCE_ROLES, 'chain_admin'])];
const OPEN_REQUEST = ['open', 'assigned', 'in_progress'];
const OPEN_TICKET = ['new', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor', 'reopened'];
const PAY_METHODS = ['cash', 'credit_card', 'bank_transfer', 'cheque', 'voucher'];

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const idStr = (v) => (v ? String(v._id || v) : null);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isZero = (n) => Math.abs(round2(n)) < 0.005;
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function folioBalance(folio) {
  return round2((folio?.lines || [])
    .filter((l) => l.status === 'posted')
    .reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0));
}

function folioOwnerLabel(f, companiesById) {
  if (f.ownerType === 'company') return companiesById.get(String(f.ownerRef))?.name || 'חברה';
  return { guest: 'אורח', room: 'חדר', group: 'קבוצה', house: 'בית' }[f.ownerType] || f.ownerType;
}

// Summary of every folio on a set of reservations: balance per folio, owner and settlement.
async function folioSummaries(resIds) {
  const folios = await Folio.find({ reservation: { $in: resIds } }).lean();
  const companyIds = folios.filter((f) => f.ownerType === 'company' && isId(String(f.ownerRef || ''))).map((f) => f.ownerRef);
  const companies = await Company.find({ _id: { $in: companyIds } }).select('name creditLimit active').lean();
  const byId = new Map(companies.map((c) => [String(c._id), c]));
  const byRes = new Map();
  for (const f of folios) {
    const k = String(f.reservation);
    if (!byRes.has(k)) byRes.set(k, []);
    byRes.get(k).push({
      id: String(f._id),
      ownerType: f.ownerType,
      ownerLabel: folioOwnerLabel(f, byId),
      status: f.status,
      balance: folioBalance(f),
      settlement: f.settlement?.mode ? { mode: f.settlement.mode, reason: f.settlement.reason || null, by: f.settlement.approvedByName || null } : null,
    });
  }
  return byRes;
}

function moneyState(folios) {
  const owed = round2(folios.filter((f) => f.status !== 'closed' && !f.settlement && f.balance > 0).reduce((s, f) => s + f.balance, 0));
  const credit = round2(folios.filter((f) => f.status !== 'closed' && f.balance < 0).reduce((s, f) => s + f.balance, 0));
  const settledOpen = folios.filter((f) => f.status !== 'closed' && f.settlement && !isZero(f.balance));
  const total = round2(folios.reduce((s, f) => s + f.balance, 0));
  return { total, owed, credit, settledOpen: settledOpen.length, folioCount: folios.length };
}

// ── FD-06 in-house ──────────────────────────────────────────────────────────
export async function listInHouse({ propertyId, q, departure, view, page = 1, pageSize = 50 }) {
  const property = await loadProperty(propertyId);
  const businessDate = businessDateOf(property);
  const filter = { property: propertyId, status: { $in: IN_HOUSE_STATUSES } };
  if (/^\d{4}-\d{2}-\d{2}$/.test(departure || '')) filter.departureDate = departure;
  let reservations = await Reservation.find(filter)
    .populate('primaryGuest', 'firstName lastName vipLevel')
    .populate('roomType', 'name')
    .populate('company', 'name')
    .lean();

  const resIds = reservations.map((r) => r._id);
  const units = await ReservationRoom.find({ reservation: { $in: resIds } }).sort({ createdAt: 1, _id: 1 }).lean();
  const unitsByRes = new Map();
  for (const u of units) {
    const k = String(u.reservation);
    if (!unitsByRes.has(k)) unitsByRes.set(k, []);
    unitsByRes.get(k).push(u);
  }
  const roomIds = new Set();
  for (const r of reservations) {
    const list = unitsByRes.get(String(r._id));
    if (list?.length) list.filter((u) => ['in_house', 'checked_in'].includes(u.status)).forEach((u) => u.assignedRoom && roomIds.add(String(u.assignedRoom)));
    else if (r.assignedRoom) roomIds.add(String(r.assignedRoom));
  }
  const [rooms, folios, requests, dndTasks, tickets] = await Promise.all([
    Room.find({ _id: { $in: [...roomIds] } }).select('number floor opsStatus cleanStatus').lean(),
    folioSummaries(resIds),
    GuestRequest.aggregate([{ $match: { reservation: { $in: resIds }, status: { $in: OPEN_REQUEST } } }, { $group: { _id: '$reservation', n: { $sum: 1 } } }]),
    HousekeepingTask.find({ property: propertyId, room: { $in: [...roomIds] }, date: businessDate, isDND: true }).select('room').lean(),
    MaintenanceTicket.find({ room: { $in: [...roomIds] }, status: { $in: OPEN_TICKET }, priority: { $in: ['critical', 'high'] } }).select('room priority').lean(),
  ]);
  const roomById = new Map(rooms.map((x) => [String(x._id), x]));
  const reqByRes = new Map(requests.map((x) => [String(x._id), x.n]));
  const dnd = new Set(dndTasks.map((t) => String(t.room)));
  const ticketRooms = new Set(tickets.map((t) => String(t.room)));

  const term = String(q || '').trim().toLowerCase();
  let rows = reservations.map((r) => {
    const g = r.primaryGuest || {};
    const list = unitsByRes.get(String(r._id));
    const inUnits = list?.length ? list.filter((u) => ['in_house', 'checked_in'].includes(u.status)) : [{ assignedRoom: r.assignedRoom }];
    const unitRooms = inUnits.map((u) => roomById.get(idStr(u.assignedRoom))).filter(Boolean);
    const f = folios.get(String(r._id)) || [];
    const money = moneyState(f);
    const exceptions = [];
    if (r.departureDate < businessDate) exceptions.push({ code: 'overdue', label: `מועד היציאה (${r.departureDate}) עבר` });
    for (const room of unitRooms) {
      if (room.opsStatus && room.opsStatus !== 'available') exceptions.push({ code: 'room_blocked', label: `חדר ${room.number} חסום תפעולית` });
      if (ticketRooms.has(String(room._id))) exceptions.push({ code: 'ticket', label: `תקלה דחופה בחדר ${room.number}` });
    }
    const guarantee = guaranteeState(r, null);
    if (!guarantee.ok && money.owed > 0) exceptions.push({ code: 'guarantee', label: 'יתרה פתוחה ללא ערבות' });
    if (r.status === 'partially_checked_in' || r.status === 'partially_checked_out') exceptions.push({ code: 'partial', label: 'הזמנה חלקית — חלק מהיחידות לא בבית' });
    return {
      reservationId: String(r._id),
      confirmationNumber: r.confirmationNumber,
      status: r.status,
      guest: { name: `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'אורח', vip: !!(r.isVip || g.vipLevel > 0) },
      company: r.company ? { id: idStr(r.company), name: r.company.name } : null,
      rooms: unitRooms.map((x) => ({ id: String(x._id), number: x.number, dnd: dnd.has(String(x._id)) })),
      unitsInHouse: inUnits.length,
      unitsTotal: list?.length || 1,
      roomType: r.roomType?.name || null,
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      etd: r.etd || null,
      adults: r.adults,
      children: r.children,
      openRequests: reqByRes.get(String(r._id)) || 0,
      money,
      guarantee: { ok: guarantee.ok, label: guarantee.label },
      exceptions,
    };
  });
  if (term) {
    rows = rows.filter((r) => r.guest.name.toLowerCase().includes(term)
      || String(r.confirmationNumber).toLowerCase().includes(term)
      || r.rooms.some((x) => String(x.number).toLowerCase() === term));
  }
  rows.sort((a, b) => (a.rooms[0]?.number || '~').localeCompare(b.rooms[0]?.number || '~', 'he', { numeric: true }) || (a.reservationId < b.reservationId ? -1 : 1));
  const counts = {
    all: rows.length,
    departingToday: rows.filter((r) => r.departureDate === businessDate).length,
    overdue: rows.filter((r) => r.departureDate < businessDate).length,
    withBalance: rows.filter((r) => r.money.owed > 0).length,
  };
  if (view === 'today') rows = rows.filter((r) => r.departureDate === businessDate);
  else if (view === 'overdue') rows = rows.filter((r) => r.departureDate < businessDate);
  else if (view === 'balance') rows = rows.filter((r) => r.money.owed > 0);
  const size = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 50;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return { businessDate, counts, total: rows.length, page: current, pages, pageSize: size, rows: rows.slice((current - 1) * size, current * size) };
}

// ── FD-07 departures ────────────────────────────────────────────────────────
export async function listDepartures({ propertyId, date, status = 'all', q }) {
  const property = await loadProperty(propertyId);
  const businessDate = businessDateOf(property);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : businessDate;
  const or = [{ departureDate: day, status: { $in: [...IN_HOUSE_STATUSES, 'checked_out'] } }];
  // Late departures (still in the house after their date) belong to today's work list.
  if (day === businessDate) or.push({ departureDate: { $lt: day }, status: { $in: IN_HOUSE_STATUSES } });
  let reservations = await Reservation.find({ property: propertyId, $or: or })
    .populate('primaryGuest', 'firstName lastName vipLevel')
    .populate('company', 'name')
    .lean();
  const term = String(q || '').trim().toLowerCase();
  if (term) {
    reservations = reservations.filter((r) => `${r.primaryGuest?.firstName || ''} ${r.primaryGuest?.lastName || ''}`.toLowerCase().includes(term)
      || String(r.confirmationNumber).toLowerCase().includes(term));
  }
  const resIds = reservations.map((r) => r._id);
  const [units, folios, invoices] = await Promise.all([
    ReservationRoom.find({ reservation: { $in: resIds } }).populate('assignedRoom', 'number').sort({ createdAt: 1, _id: 1 }).lean(),
    folioSummaries(resIds),
    Invoice.find({ reservation: { $in: resIds } }).select('reservation status type invoiceNumber').lean(),
  ]);
  const roomIds = reservations.filter((r) => r.assignedRoom).map((r) => r.assignedRoom);
  const resRooms = new Map((await Room.find({ _id: { $in: roomIds } }).select('number').lean()).map((x) => [String(x._id), x.number]));
  const unitsByRes = new Map();
  for (const u of units) {
    const k = String(u.reservation);
    if (!unitsByRes.has(k)) unitsByRes.set(k, []);
    unitsByRes.get(k).push(u);
  }
  const invByRes = new Map();
  for (const inv of invoices) {
    const k = String(inv.reservation);
    if (!invByRes.has(k)) invByRes.set(k, []);
    invByRes.get(k).push({ status: inv.status, type: inv.type, number: inv.invoiceNumber || null });
  }

  let rows = reservations.map((r) => {
    const g = r.primaryGuest || {};
    const list = unitsByRes.get(String(r._id));
    const unitRows = list?.length
      ? list.filter((u) => !['cancelled', 'no_show', 'reserved', 'tentative'].includes(u.status)).map((u) => ({ id: String(u._id), room: u.assignedRoom?.number || null, status: u.status }))
      : [{ id: null, room: resRooms.get(String(r.assignedRoom)) || null, status: r.status === 'checked_out' ? 'checked_out' : 'in_house' }];
    const f = folios.get(String(r._id)) || [];
    const money = moneyState(f);
    const done = r.status === 'checked_out';
    const late = !done && r.departureDate < businessDate;
    const state = done ? 'completed' : late ? 'late' : 'expected';
    const docs = invByRes.get(String(r._id)) || [];
    return {
      reservationId: String(r._id),
      confirmationNumber: r.confirmationNumber,
      status: r.status,
      state,
      guest: { name: `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'אורח', vip: !!(r.isVip || g.vipLevel > 0) },
      company: r.company ? { id: idStr(r.company), name: r.company.name } : null,
      units: unitRows,
      departureDate: r.departureDate,
      etd: r.etd || null,
      checkedOutAt: r.checkedOutAt || null,
      folios: f,
      money,
      documents: {
        issued: docs.filter((d) => d.status === 'issued').length,
        draft: docs.filter((d) => d.status === 'draft').length,
        pending: docs.filter((d) => d.status === 'pending_allocation').length,
      },
    };
  });
  const counts = { all: rows.length, expected: 0, late: 0, completed: 0, openMoney: 0 };
  for (const r of rows) {
    counts[r.state] += 1;
    if (r.money.owed > 0 || r.money.credit < 0 || r.money.settledOpen > 0) counts.openMoney += 1;
  }
  if (status && status !== 'all') rows = rows.filter((r) => r.state === status);
  const order = { late: 0, expected: 1, completed: 2 };
  rows.sort((a, b) => order[a.state] - order[b.state] || (a.etd || '99:99').localeCompare(b.etd || '99:99') || a.guest.name.localeCompare(b.guest.name, 'he'));
  return { date: day, businessDate, counts, rows };
}

export async function setEtd({ propertyId, reservationId, etd, actor, ip }) {
  const res = await loadReservationInScope(reservationId, propertyId);
  const value = etd ? String(etd) : null;
  if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw httpError('שעה לא תקינה (HH:MM)', 422);
  const before = res.etd || null;
  res.etd = value || undefined;
  await res.save();
  await audit({ property: res.property, actor: actor.id, actorName: actor.name, action: 'reservation.etd_set', entityType: 'Reservation', entityId: res._id, before: { etd: before }, after: { etd: value }, ip });
  return { etd: value };
}

// ── FD-08 context ───────────────────────────────────────────────────────────
async function companyExposure(companyId, propertyId) {
  const company = await Company.findOne({ _id: companyId, property: propertyId }).select('name creditLimit active').lean();
  if (!company) return null;
  const open = await Folio.find({ property: propertyId, ownerType: 'company', ownerRef: String(companyId), status: { $ne: 'closed' } }).select('lines').lean();
  const exposure = round2(open.reduce((s, f) => s + Math.max(0, folioBalance(f)), 0));
  return { id: String(company._id), name: company.name, active: company.active !== false, creditLimit: Number(company.creditLimit || 0), exposure };
}

export async function getCheckOutContext({ propertyId, reservationId }) {
  const property = await loadProperty(propertyId);
  const res = await loadReservationInScope(reservationId, propertyId);
  const units = await ReservationRoom.find({ reservation: res._id }).populate('assignedRoom', 'number').sort({ createdAt: 1, _id: 1 }).lean();
  const unitList = units.length
    ? units.map((u, i) => ({ unitId: String(u._id), index: i + 1, status: u.status, room: u.assignedRoom ? { id: idStr(u.assignedRoom), number: u.assignedRoom.number } : null }))
    : [{ unitId: null, index: 1, status: IN_HOUSE_STATUSES.includes(res.status) && res.status !== 'partially_checked_in' ? 'in_house' : res.status === 'checked_out' ? 'checked_out' : 'reserved', room: res.assignedRoom ? { id: idStr(res.assignedRoom), number: (await Room.findById(res.assignedRoom).select('number').lean())?.number } : null }];

  const businessDateEarly = businessDateOf(property);
  // The lodging folio is a container the desk needs in order to take payment; creating an empty one
  // for an in-house stay changes no balance.
  const lodging = IN_HOUSE_STATUSES.includes(res.status) ? await lodgingFolio(res) : await lodgingFolio(res, { create: false });
  const pending = IN_HOUSE_STATUSES.includes(res.status) ? await planNights({ reservation: res, until: businessDateEarly }) : { items: [], count: 0, gross: 0 };
  const folios = await Folio.find({ reservation: res._id }).sort({ createdAt: 1 }).lean();
  const companyIds = [...new Set(folios.filter((f) => f.ownerType === 'company' && f.ownerRef).map((f) => String(f.ownerRef)))];
  const companies = new Map();
  for (const cid of companyIds) if (isId(cid)) companies.set(cid, await companyExposure(cid, propertyId));
  const businessDate = businessDateOf(property);

  const folioDtos = folios.map((f) => {
    const posted = (f.lines || []).filter((l) => l.status === 'posted');
    const company = f.ownerType === 'company' ? companies.get(String(f.ownerRef)) || null : null;
    const isLodging = lodging && String(lodging._id) === String(f._id);
    const pendingGross = isLodging ? pending.gross : 0;
    return {
      id: String(f._id),
      ownerType: f.ownerType,
      ownerLabel: company?.name || folioOwnerLabel(f, new Map()),
      status: f.status,
      currency: f.currency || 'ILS',
      // Balance as it will be at departure: posted lines plus lodging nights not yet posted.
      balance: round2(folioBalance(f) + pendingGross),
      postedBalance: folioBalance(f),
      pendingNights: isLodging ? { count: pending.count, gross: pending.gross } : null,
      charges: round2(posted.filter((l) => Number(l.amount) > 0).reduce((s, l) => s + Number(l.amount) + Number(l.taxAmount || 0), 0)),
      payments: round2(-posted.filter((l) => Number(l.amount) < 0).reduce((s, l) => s + Number(l.amount), 0)),
      // Last postings first — late POS/service charges are what the desk must check (FD-08-F03).
      recent: posted.slice(-8).reverse().map((l) => ({
        id: String(l._id), type: l.type, description: l.description, amount: round2(Number(l.amount) + Number(l.taxAmount || 0)),
        department: l.department || null, serviceDate: l.serviceDate, source: l.source,
      })),
      todayCharges: posted.filter((l) => l.type === 'charge' && l.serviceDate === businessDate).length,
      settlement: f.settlement?.mode ? { mode: f.settlement.mode, reason: f.settlement.reason || null, by: f.settlement.approvedByName || null, at: f.settlement.at } : null,
      company,
    };
  });
  const invoices = await Invoice.find({ reservation: res._id }).select('status type invoiceNumber totalGross issuedAt').lean();
  const openRequests = await GuestRequest.countDocuments({ reservation: res._id, status: { $in: OPEN_REQUEST } });
  const g = res.primaryGuest || {};
  return {
    businessDate,
    reservation: {
      id: String(res._id), confirmationNumber: res.confirmationNumber, status: res.status,
      arrivalDate: res.arrivalDate, departureDate: res.departureDate, nights: res.nights,
      adults: res.adults, children: res.children, currency: res.currency || 'ILS', etd: res.etd || null,
      company: res.company ? { id: idStr(res.company), name: res.company.name } : null,
      early: res.departureDate > businessDate,
    },
    guest: { id: idStr(g), name: `${g.firstName || ''} ${g.lastName || ''}`.trim() },
    units: unitList,
    folios: folioDtos,
    documents: invoices.map((i) => ({ id: String(i._id), status: i.status, type: i.type, number: i.invoiceNumber || null, total: i.totalGross })),
    openRequests,
    nextCleaning: 'ניקיון יציאה (checkout_clean) לחדרים שיוצאים — עדיפות גבוהה',
  };
}

// ── FIN-03 / FIN-04 at the desk (manual methods, idempotent) ────────────────
async function loadFolioInScope(folioId, propertyId) {
  if (!isId(String(folioId || ''))) throw httpError('מזהה חשבון לא תקין', 400);
  const folio = await Folio.findById(folioId);
  if (!folio) throw httpError('החשבון לא נמצא', 404);
  if (String(folio.property) !== String(propertyId)) throw httpError('החשבון אינו שייך לנכס הפעיל', 403);
  return folio;
}

function idemRef(key) {
  const k = String(key || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(k)) throw httpError('חסר מזהה פעולה (idempotency key)', 422);
  return `op:${k}`;
}

// Desk payments pass the same gate as the folio screen (FIN-03): idempotent, never above the
// balance, reference required for transfer/cheque/voucher, cumulative cash policy.
export async function recordPayment({ propertyId, folioId, input, actor, ip }) {
  return recordFolioPayment({ propertyId, folioId, input: { ...input, kind: 'payment' }, actor, ip });
}

export async function refundCredit({ propertyId, folioId, input, actor, ip }) {
  if (!REFUND_ROLES.includes(actor.role)) throw httpError('החזר כספי מותר למנהל או לכספים בלבד', 403);
  const folio = await loadFolioInScope(folioId, propertyId);
  const reference = idemRef(input.idempotencyKey);
  const existing = folio.lines.find((l) => l.reference === reference);
  if (existing) return { folioId: String(folio._id), lineId: String(existing._id), balance: folioBalance(folio), duplicate: true };
  const amount = round2(input.amount);
  const reasonText = String(input.reason || '').trim().slice(0, 300);
  if (!(amount > 0)) throw httpError('סכום חייב להיות חיובי', 422, { fields: { amount: 'סכום לא תקין' } });
  if (!PAY_METHODS.includes(input.method)) throw httpError('אמצעי החזר לא מוכר', 422, { fields: { method: 'יש לבחור אמצעי' } });
  if (reasonText.length < 3) throw httpError('החזר מחייב סיבה', 422, { fields: { reason: 'יש לפרט סיבה' } });
  const credit = -folioBalance(folio);
  // Cumulative cap (T16): only the credit that actually exists can be returned.
  if (amount - credit > 0.005) throw httpError(credit > 0 ? `ניתן להחזיר עד ${credit.toFixed(2)}` : 'אין יתרת זכות להחזר', 422, { fields: { amount: 'מעל יתרת הזכות' } });
  // A refund pays money out, so it is a positive line that brings the credit back toward zero.
  folio.lines.push({
    type: 'refund',
    description: `החזר — ${reasonText}`,
    amount,
    taxAmount: 0,
    serviceDate: businessDateOf(await loadProperty(propertyId)),
    source: 'manual',
    status: 'posted',
    reference,
    createdBy: actor.id || undefined,
  });
  await folio.save();
  const line = folio.lines[folio.lines.length - 1];
  await audit({ property: folio.property, actor: actor.id, actorName: actor.name, action: 'folio.refund', entityType: 'Folio', entityId: folio._id, reason: reasonText, after: { amount, method: input.method, lineId: String(line._id) }, ip });
  return { folioId: String(folio._id), lineId: String(line._id), balance: folioBalance(folio), duplicate: false };
}

// FD-06-A06 / FIN-02 (light): a service charge typed as the price the guest pays. VAT is
// extracted from the gross with the property's configured rate (T22: 118 at 18% → 100 + 18).
export async function postServiceCharge({ propertyId, reservationId, input, actor, ip }) {
  const property = await Property.findById(propertyId).select('vatRate timezone').lean();
  const res = await loadReservationInScope(reservationId, propertyId);
  if (!IN_HOUSE_STATUSES.includes(res.status)) throw httpError('חיוב שירות נרשם רק לשהייה פעילה', 409);
  // G1: code from the property catalogue (price lock, VAT class, who may post).
  const code = await resolveChargeCode({ propertyId, code: input.department, actorRole: actor.role, unitPrice: input.amount });
  const description = String(input.description || '').trim().slice(0, 200) || code.name;
  const gross = round2(code.unitPrice ?? input.amount);
  const errors = {};
  if (!(gross > 0)) errors.amount = 'סכום לא תקין';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי החיוב', 422, { fields: errors });
  const folios = await Folio.find({ reservation: res._id, status: { $ne: 'closed' } });
  let folio = input.folioId ? folios.find((f) => String(f._id) === String(input.folioId)) : folios.find((f) => f.ownerType === 'guest') || folios[0];
  if (input.folioId && !folio) throw httpError('החשבון שנבחר אינו פתוח בהזמנה זו', 422);
  if (!folio) {
    folio = await Folio.create({ property: res.property, reservation: res._id, ownerType: 'guest', currency: res.currency || 'ILS', lines: [] });
  }
  const reference = idemRef(input.idempotencyKey);
  const existing = folio.lines.find((l) => l.reference === reference);
  if (existing) return { folioId: String(folio._id), lineId: String(existing._id), duplicate: true };
  const lineVat = code.vatClass !== 'standard' ? { rate: 0, reason: `code_${code.vatClass}` } : await vatForLine({ reservation: res, code: code.code, propertyVatRate: property?.vatRate ?? 18 });
  const { net } = lineVat.strip ? { net: taxFor(gross, 'standard', lineVat.propertyVatRate).net } : taxFor(gross, lineVat.rate === 0 ? 'zero' : 'standard', lineVat.rate);
  folio.lines.push({
    type: 'charge', description, amount: net, taxAmount: lineVat.rate === 0 ? 0 : round2(gross - net), department: code.code, vatRate: lineVat.rate, taxReason: lineVat.reason || undefined,
    serviceDate: businessDateOf(property), source: 'manual', status: 'posted', reference, createdBy: actor.id || undefined,
  });
  await folio.save();
  const line = folio.lines[folio.lines.length - 1];
  await audit({ property: res.property, actor: actor.id, actorName: actor.name, action: 'folio.charge', entityType: 'Folio', entityId: folio._id, after: { gross, net, tax: round2(gross - net), vatRate: property?.vatRate, vatClass: code.vatClass, department: code.code, lineId: String(line._id) }, ip });
  return { folioId: String(folio._id), lineId: String(line._id), net, tax: round2(gross - net), duplicate: false };
}

// ── FD-08 complete ──────────────────────────────────────────────────────────
export async function completeCheckOut(args) {
  if (!isId(String(args.reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  return withLocks([`res:${args.reservationId}`], () => checkOutLocked(args));
}

async function checkOutLocked({ propertyId, reservationId, unitIds, unitIndexes, settlements = [], early: earlyInput, actor, ip }) {
  const property = await loadProperty(propertyId);
  const businessDate = businessDateOf(property);
  const res = await loadReservationInScope(reservationId, propertyId);
  if (!IN_HOUSE_STATUSES.includes(res.status)) throw httpError(`לא ניתן לבצע יציאה מהזמנה במצב ${res.status}`, 409);
  const isManager = MANAGER_ROLES.includes(actor.role) || FINANCE_ROLES.includes(actor.role);

  const units = await ensureUnits(res);
  const inHouse = units.filter((u) => ['in_house', 'checked_in'].includes(u.status));
  let wanted;
  if (Array.isArray(unitIds) && unitIds.filter(Boolean).length) wanted = inHouse.filter((u) => unitIds.map(String).includes(String(u._id)));
  else if (Array.isArray(unitIndexes) && unitIndexes.length) wanted = unitIndexes.map((i) => units[Number(i) - 1]).filter((u) => u && inHouse.includes(u));
  else wanted = inHouse.length === 1 ? inHouse : [];
  if (!wanted.length) throw httpError('יש לבחור לפחות יחידה אחת שנמצאת בבית', 422);
  const remaining = inHouse.length - wanted.length;
  const finalDeparture = remaining === 0;

  // Nights the departing units used but that day close has not posted yet. They are part of the
  // balance being settled, and are posted only once the checkout passes.
  const wantedIds = new Set(wanted.map((u) => String(u._id)));
  const nightPlan = await planNights({ reservation: res, until: businessDate, unitFilter: (u) => wantedIds.has(String(u._id)) });
  const lodging = await lodgingFolio(res);

  // Money: only the final departure settles folios. Every folio is checked (T11).
  const folios = await Folio.find({ reservation: res._id });
  const plan = [];
  const problems = [];
  if (finalDeparture) {
    for (const f of folios) {
      if (f.status === 'closed') continue;
      const balance = round2(folioBalance(f) + (String(f._id) === String(lodging._id) ? nightPlan.gross : 0));
      const chosen = settlements.find((s) => String(s.folioId) === String(f._id));
      if (isZero(balance)) { plan.push({ folio: f, mode: 'paid', balance }); continue; }
      if (balance < 0) {
        // A credit is not "paid" — it needs a refund (FIN-04) or an approved open folio.
        if (chosen?.mode === 'approved_open') {
          if (!isManager) problems.push({ folioId: String(f._id), label: 'השארת יתרת זכות פתוחה דורשת מנהל' });
          else if (String(chosen.reason || '').trim().length < 3) problems.push({ folioId: String(f._id), label: 'נדרשת סיבה להשארת יתרת זכות' });
          else plan.push({ folio: f, mode: 'approved_open', balance, reason: String(chosen.reason).trim().slice(0, 300) });
        } else problems.push({ folioId: String(f._id), label: `יתרת זכות ${Math.abs(balance).toFixed(2)} — יש להחזיר לאורח או לאשר השארה` });
        continue;
      }
      if (chosen?.mode === 'company_ar') {
        if (f.ownerType !== 'company' || !isId(String(f.ownerRef || ''))) { problems.push({ folioId: String(f._id), label: 'רק חשבון של חברה יכול לעבור לחייבים' }); continue; }
        const exp = await companyExposure(f.ownerRef, propertyId);
        if (!exp || !exp.active) { problems.push({ folioId: String(f._id), label: 'החברה אינה פעילה בנכס' }); continue; }
        if (!(exp.creditLimit > 0)) {
          // T13 / "חברה ללא מסגרת": no credit line means no automatic receivable.
          if (!isManager || String(chosen.reason || '').trim().length < 3) { problems.push({ folioId: String(f._id), label: `ל${exp.name} אין מסגרת אשראי — העברה לחייבים דורשת מנהל וסיבה` }); continue; }
        } else if (exp.exposure > exp.creditLimit + 0.005) {
          if (!isManager || String(chosen.reason || '').trim().length < 3) { problems.push({ folioId: String(f._id), label: `חריגה ממסגרת האשראי של ${exp.name} (${exp.exposure.toFixed(2)} מתוך ${exp.creditLimit.toFixed(2)}) — דורש מנהל וסיבה` }); continue; }
        }
        plan.push({ folio: f, mode: 'company_ar', balance, reason: String(chosen.reason || '').trim().slice(0, 300) || undefined });
        continue;
      }
      if (chosen?.mode === 'approved_open') {
        if (!isManager) { problems.push({ folioId: String(f._id), label: 'יציאה עם יתרה פתוחה דורשת אישור מנהל' }); continue; }
        if (String(chosen.reason || '').trim().length < 3) { problems.push({ folioId: String(f._id), label: 'נדרשת סיבה ליציאה עם יתרה פתוחה' }); continue; }
        plan.push({ folio: f, mode: 'approved_open', balance, reason: String(chosen.reason).trim().slice(0, 300) });
        continue;
      }
      problems.push({ folioId: String(f._id), label: `יתרה לתשלום ${balance.toFixed(2)} ב${f.ownerType === 'company' ? 'חשבון החברה' : 'חשבון'} — יש לגבות או לבחור אופן סגירה מורשה` });
    }
  }
  // Early departure: unused future nights go back to inventory; nights already charged stay on the
  // folio — any refund or credit is a separate financial decision (W05, FD-11).
  const earlyUnits = wanted.filter((u) => (u.departureDate || res.departureDate) > businessDate);
  const earlyReason = String(earlyInput?.reason || '').trim().slice(0, 300);
  if (earlyUnits.length && earlyReason.length < 3) {
    problems.push({ folioId: null, label: 'עזיבה לפני מועד היציאה — יש לציין סיבה (הלילות שחויבו נשארים בחשבון)' });
  }
  if (problems.length) throw httpError('היציאה לא בוצעה — יש פריטים פתוחים', 409, { details: problems });

  await postPlannedNights({ reservation: res, items: nightPlan.items, source: 'pms', actorId: actor.id });
  if (nightPlan.count) {
    // Folio documents in `plan` were loaded before posting: reload them so saves keep the new lines.
    for (const p of plan) p.folio = await Folio.findById(p.folio._id);
  }

  // Units, rooms and housekeeping move together.
  const now = new Date();
  for (const u of earlyUnits) {
    const to = u.departureDate || res.departureDate;
    await incrementInventory(res.property, u.roomTypeBooked || res.roomType, businessDate, to, -1, {
      propertyId: res.property, actorId: actor.id, actorName: actor.name, ip,
      action: 'inventory.early_departure', reason: `${res.confirmationNumber}: ${earlyReason}`,
    });
    u.departureDate = businessDate;
    await u.save();
  }
  const roomIds = wanted.map((u) => u.assignedRoom).filter(Boolean);
  await ReservationRoom.updateMany({ _id: { $in: wanted.map((u) => u._id) } }, { $set: { status: 'checked_out' } });
  await Room.updateMany({ _id: { $in: roomIds } }, { $set: { occStatus: 'checked_out', cleanStatus: 'dirty' } });
  for (const roomId of roomIds) {
    const exists = await HousekeepingTask.exists({ room: roomId, reservation: res._id, type: 'checkout_clean', date: businessDate, status: { $ne: 'cancelled' } });
    if (!exists) {
      await HousekeepingTask.create({
        property: res.property, room: roomId, reservation: res._id, type: 'checkout_clean', priority: 'high',
        status: 'new', date: businessDate, autoCreated: true, notes: `יציאה: ${res.confirmationNumber}`,
      });
    }
  }

  for (const p of plan) {
    if (p.mode === 'paid') {
      p.folio.status = 'closed';
      p.folio.closedAt = now;
      p.folio.closedBy = actor.id || undefined;
      p.folio.settlement = { mode: 'paid', balance: 0, at: now, approvedBy: actor.id || undefined, approvedByName: actor.name };
    } else {
      // Money still open: the folio stays open and visible with who decided and why.
      p.folio.settlement = { mode: p.mode, balance: p.balance, reason: p.reason, at: now, approvedBy: actor.id || undefined, approvedByName: actor.name };
    }
    await p.folio.save();
  }

  const before = { status: res.status };
  res.status = finalDeparture ? 'checked_out' : 'partially_checked_out';
  if (finalDeparture) res.checkedOutAt = now;
  if (finalDeparture && res.departureDate > businessDate) {
    res.originalDepartureDate = res.departureDate;
    res.departureDate = businessDate;
  }
  res.updatedBy = actor.id || undefined;
  await res.save();

  await audit({
    property: res.property, actor: actor.id, actorName: actor.name,
    action: finalDeparture ? 'reservation.check_out' : 'reservation.units_check_out',
    entityType: 'Reservation', entityId: res._id, before,
    after: {
      status: res.status, unitIds: wanted.map((u) => String(u._id)),
      settlements: plan.map((p) => ({ folio: String(p.folio._id), mode: p.mode, balance: p.balance })),
      early: earlyUnits.length ? { units: earlyUnits.length, originalDeparture: res.originalDepartureDate || null } : false,
    },
    reason: [earlyReason, ...plan.map((p) => p.reason)].filter(Boolean).join(' | ') || undefined,
    ip,
  });

  if (finalDeparture) {
    fireEvent('checkout.completed', {
      property: String(res.property),
      reservation: res.toObject(),
      actor: { id: actor.id, name: actor.name },
    }).catch(() => null);
  }

  return {
    reservationId: String(res._id),
    status: res.status,
    checkedOutUnits: wanted.map((u) => String(u._id)),
    remainingUnits: remaining,
    housekeepingTasks: roomIds.length,
    nightsPosted: nightPlan.count,
    openFolios: plan.filter((p) => p.mode !== 'paid').map((p) => ({ folioId: String(p.folio._id), mode: p.mode, balance: p.balance })),
    early: earlyUnits.length > 0,
  };
}

// Post the lodging nights already used (up to today) so the guest can pay the full amount now.
export async function postPendingNights({ propertyId, reservationId, actor, ip }) {
  const property = await loadProperty(propertyId);
  const res = await loadReservationInScope(reservationId, propertyId);
  if (!IN_HOUSE_STATUSES.includes(res.status)) throw httpError('רישום לילות רק לשהייה פעילה', 409);
  return withLocks([`res:${res._id}`], async () => {
    await ensureUnits(res);
    const posted = await postNightsUntil({ reservation: res, until: businessDateOf(property), source: 'pms', actorId: actor.id });
    await audit({ property: res.property, actor: actor.id, actorName: actor.name, action: 'folio.nights_posted', entityType: 'Reservation', entityId: res._id, after: { nights: posted }, ip });
    return { posted };
  });
}

export { addDays };
