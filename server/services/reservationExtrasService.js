// Waitlist, deposit due dates, confirmations, items, payment methods, privileges and housekeeping of a stay
// (gap-map item 15).
//  - Waitlist: a 'waitlisted' reservation holds no inventory. "Promote" books it for real (createBooking) when
//    the room type is free; the waitlist entry leaves every statistic (deleted, reason "promoted"). Day close
//    removes entries whose arrival has passed.
//  - Deposit: amount + due date on the booking; open / overdue list; reminder e-mail (manual + automatic 2 days before).
//  - Confirmations: in the guest's language; batch send for arrivals in a range that were not confirmed yet.
//  - Items: stock per type, booked per night, availability checked.
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import GuestProfile from '../models/GuestProfile.js';
import RoomType from '../models/RoomType.js';
import Folio from '../models/Folio.js';
import Company from '../models/Company.js';
import Property from '../models/Property.js';
import { RatePlan } from '../models/RatePlan.js';
import { ItemType, ItemBooking } from '../models/Items.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf, MANAGER_ROLES } from './frontDeskService.js';

export const EXTRA_ROLES = [...new Set([...MANAGER_ROLES, 'receptionist', 'sales_manager', 'revenue_manager', 'finance_manager'])];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const nightsBetween = (a, b) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));
const mustWork = (actor) => { if (!EXTRA_ROLES.includes(actor?.role)) throw httpError('אין הרשאה', 403); };
const log = (propertyId, actor, ip, action, entityId, after, reason) => audit({ property: propertyId, actor: actor?.id, actorName: actor?.name || 'מערכת', action, entityType: 'Reservation', entityId, after, reason, ip });
const nameOf = (g) => (g ? `${g.firstName || ''} ${g.lastName || ''}`.trim() : '');

async function loadRes(propertyId, id) {
  const r = isId(id) ? await Reservation.findOne({ _id: id, property: propertyId }) : null;
  if (!r) throw httpError('ההזמנה לא נמצאה', 404);
  return r;
}

// ── Waitlist ────────────────────────────────────────────────────────────────

async function freeFor(propertyId, roomTypeId, from, to) {
  const { nightlyAvailability } = await import('./availabilityService.js');
  const a = await nightlyAvailability({ propertyId, roomTypeId, arrivalDate: from, departureDate: to });
  return a.nights.every((n) => !n.missing && !n.stopSell && n.available > 0);
}

export async function addToWaitlist({ propertyId, body, actor, ip }) {
  mustWork(actor);
  const b = body || {};
  const fields = {};
  if (!YMD.test(b.arrival || '') || !YMD.test(b.departure || '') || b.departure <= b.arrival) fields.arrival = 'תאריכים תקינים';
  const rt = isId(b.roomTypeId) ? await RoomType.findOne({ _id: b.roomTypeId, property: propertyId }).select('name').lean() : null;
  if (!rt) fields.roomTypeId = 'סוג חדר';
  const plan = b.ratePlanId ? (isId(b.ratePlanId) ? await RatePlan.findOne({ _id: b.ratePlanId, property: propertyId }).select('code').lean() : null) : null;
  if (b.ratePlanId && !plan) fields.ratePlanId = 'תעריף';
  const adults = Number(b.adults || 2); const children = Number(b.children || 0);
  if (!(adults >= 1 && adults <= 10)) fields.adults = '1–10';
  const priority = Math.min(5, Math.max(1, Number(b.priority || 3)));
  if (Object.keys(fields).length) throw httpError('יש להשלים את פרטי ההמתנה', 422, { fields });
  const { resolveGuest } = await import('./bookingService.js');
  const guest = await resolveGuest({ propertyId, input: { guestId: b.guestId, newGuest: b.newGuest, forceNewGuest: b.forceNewGuest }, actor, ip });
  const { allocateConfirmationNumber } = await import('./reservationService.js');
  const nights = nightsBetween(b.arrival, b.departure);
  let total = 0; let rate = 0;
  if (plan) {
    const { priceNights } = await import('./bookingService.js');
    const q = await priceNights({ roomTypeId: rt._id, ratePlanId: plan._id, dates: Array.from({ length: nights }, (_, i) => { const d = new Date(`${b.arrival}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); }), adults, children });
    total = round2(q.perRoom || 0); rate = nights ? round2(total / nights) : 0;
  }
  const r = await Reservation.create({
    property: propertyId, confirmationNumber: await allocateConfirmationNumber(propertyId), status: 'waitlisted', primaryGuest: guest._id,
    adults, children, arrivalDate: b.arrival, departureDate: b.departure, nights, roomsCount: 1, roomType: rt._id, ratePlan: plan?._id, ratePerNight: rate, totalAmount: total,
    source: b.source || 'phone', guaranteeType: 'none', createdBy: actor.id || undefined,
    waitlist: { priority, note: String(b.note || '').slice(0, 300), byName: actor.name, at: new Date() },
  });
  await log(propertyId, actor, ip, 'reservation.waitlisted', r._id, { arrival: b.arrival, departure: b.departure, roomType: rt.name, priority });
  return { id: String(r._id), confirmationNumber: r.confirmationNumber };
}

export async function listWaitlist({ propertyId }) {
  const rows = await Reservation.find({ property: propertyId, status: 'waitlisted' }).sort({ 'waitlist.priority': 1, createdAt: 1 })
    .populate('primaryGuest', 'firstName lastName phone').populate('roomType', 'name').populate('ratePlan', 'code name').lean();
  const out = [];
  for (const r of rows) {
    out.push({
      id: String(r._id), confirmationNumber: r.confirmationNumber, guest: nameOf(r.primaryGuest), phone: r.primaryGuest?.phone || null, arrival: r.arrivalDate, departure: r.departureDate, nights: r.nights,
      adults: r.adults, children: r.children, roomType: r.roomType?.name || '', ratePlan: r.ratePlan?.code || null, total: r.totalAmount || 0, priority: r.waitlist?.priority || 3, note: r.waitlist?.note || '', since: r.createdAt,
      available: r.roomType ? await freeFor(propertyId, r.roomType._id, r.arrivalDate, r.departureDate) : false,
    });
  }
  return out;
}

// Book a waitlisted request for real once its room type is free on every night.
export async function promoteWaitlist({ propertyId, id, body, actor, ip }) {
  mustWork(actor);
  const w = await loadRes(propertyId, id);
  if (w.status !== 'waitlisted') throw httpError('ההזמנה כבר לא ברשימת ההמתנה', 409);
  if (!w.ratePlan && !body?.ratePlanId) throw httpError('בחרו תעריף לפני קבלה מרשימת ההמתנה', 422, { fields: { ratePlanId: 'תעריף' } });
  if (!(await freeFor(propertyId, w.roomType, w.arrivalDate, w.departureDate))) throw httpError('סוג החדר עדיין לא פנוי בכל הלילות', 409, { code: 'no_availability' });
  const { createBooking } = await import('./bookingService.js');
  const booked = await createBooking({
    propertyId, actor, ip,
    input: {
      guestId: String(w.primaryGuest), roomTypeId: String(w.roomType), ratePlanId: String(body?.ratePlanId || w.ratePlan), arrival: w.arrivalDate, departure: w.departureDate,
      adults: w.adults, children: w.children || 0, childAges: Array.from({ length: w.children || 0 }, () => 8), source: w.source || 'phone', mode: 'confirm',
      guarantee: body?.guarantee || 'credit_card', idempotencyKey: `waitlist-${w._id}`,
    },
  });
  w.status = 'deleted';
  w.deletion = { at: new Date(), by: actor.id || undefined, byName: actor.name, reason: 'promoted', note: `התקבל מרשימת ההמתנה — ${booked.confirmationNumber}` };
  w.waitlist.promotedTo = booked.id;
  await w.save();
  await log(propertyId, actor, ip, 'reservation.waitlist_promoted', w._id, { to: booked.confirmationNumber });
  return booked;
}

export async function removeFromWaitlist({ propertyId, id, reason, actor, ip }) {
  mustWork(actor);
  const w = await loadRes(propertyId, id);
  if (w.status !== 'waitlisted') throw httpError('ההזמנה כבר לא ברשימת ההמתנה', 409);
  w.status = 'deleted';
  w.deletion = { at: new Date(), by: actor.id || undefined, byName: actor.name, reason: 'waitlist_removed', note: String(reason || '').slice(0, 200) };
  await w.save();
  await log(propertyId, actor, ip, 'reservation.waitlist_removed', w._id, null, reason);
  return { removed: true };
}

// Day close: requests whose arrival already passed leave the list (and every statistic).
export async function cleanupWaitlist({ propertyId, actor = null }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const old = await Reservation.find({ property: propertyId, status: 'waitlisted', arrivalDate: { $lt: today } }).select('_id');
  for (const r of old) {
    await Reservation.updateOne({ _id: r._id }, { $set: { status: 'deleted', deletion: { at: new Date(), byName: actor?.name || 'סגירת יום', reason: 'waitlist_expired', note: 'תאריך ההגעה עבר' } } });
  }
  if (old.length) await audit({ property: propertyId, actor: actor?.id, actorName: actor?.name || 'סגירת יום', action: 'reservation.waitlist_cleanup', entityType: 'Property', entityId: propertyId, after: { removed: old.length } });
  return old.length;
}

// ── Deposit due date ────────────────────────────────────────────────────────

async function paidOn(reservationId) {
  const folios = await Folio.find({ reservation: reservationId }).select('lines').lean();
  const lines = folios.flatMap((f) => f.lines || []).filter((l) => l.status === 'posted');
  return round2(lines.filter((l) => ['payment', 'deposit'].includes(l.type)).reduce((s, l) => s - Number(l.amount || 0), 0) - lines.filter((l) => l.type === 'refund').reduce((s, l) => s + Number(l.amount || 0), 0));
}

export async function setDepositDue({ propertyId, id, body, actor, ip }) {
  mustWork(actor);
  const r = await loadRes(propertyId, id);
  if (['cancelled', 'no_show', 'deleted', 'checked_out'].includes(r.status)) throw httpError('ההזמנה סגורה', 409);
  if (body?.amount === null || body?.amount === 0) { r.depositDue = undefined; await r.save(); return { cleared: true }; }
  const amount = round2(body?.amount);
  const fields = {};
  if (!(amount > 0)) fields.amount = 'סכום חיובי';
  else if (amount - Number(r.totalAmount || 0) > 0.005 && Number(r.totalAmount) > 0) fields.amount = 'לא יותר ממחיר השהייה';
  if (!YMD.test(body?.dueDate || '')) fields.dueDate = 'תאריך יעד';
  else if (body.dueDate > r.arrivalDate) fields.dueDate = 'לפני תאריך ההגעה';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי המקדמה', 422, { fields });
  r.depositDue = { amount, dueDate: body.dueDate, note: String(body?.note || '').slice(0, 200), byName: actor.name };
  r.depositAmount = amount;
  await r.save();
  await log(propertyId, actor, ip, 'reservation.deposit_due', r._id, { amount, dueDate: body.dueDate });
  return { amount, dueDate: body.dueDate };
}

export async function depositList({ propertyId }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const rows = await Reservation.find({ property: propertyId, 'depositDue.amount': { $gt: 0 }, status: { $in: ['confirmed', 'modified', 'pending_payment', 'hold'] } })
    .populate('primaryGuest', 'firstName lastName email phone').select('confirmationNumber arrivalDate depositDue primaryGuest totalAmount language').sort({ 'depositDue.dueDate': 1 }).lean();
  const out = [];
  for (const r of rows) {
    const paid = await paidOn(r._id);
    const open = round2(r.depositDue.amount - paid);
    if (open <= 0.005) continue;
    out.push({ id: String(r._id), confirmationNumber: r.confirmationNumber, guest: nameOf(r.primaryGuest), email: r.primaryGuest?.email || null, arrival: r.arrivalDate, amount: r.depositDue.amount, paid, open, dueDate: r.depositDue.dueDate, overdue: r.depositDue.dueDate < today, remindedAt: r.depositDue.remindedAt || null });
  }
  return { today, rows: out };
}

export async function remindDeposit({ propertyId, id, actor, ip, automatic = false }) {
  const r = await Reservation.findOne({ _id: id, property: propertyId }).populate('primaryGuest', 'firstName lastName email emails language').lean();
  if (!r?.depositDue?.amount) throw httpError('אין מקדמה מוגדרת', 404);
  const open = round2(r.depositDue.amount - (await paidOn(r._id)));
  if (open <= 0.005) throw httpError('המקדמה כבר שולמה', 409);
  const to = String(r.primaryGuest?.email || r.primaryGuest?.emails?.[0]?.address || '').trim();
  if (!to) throw httpError('אין לאורח כתובת דוא״ל', 422);
  const property = await Property.findById(propertyId).select('name phone email').lean();
  const en = r.language === 'en';
  const { sendEmail } = await import('./emailService.js');
  const subject = en ? `Deposit due ${r.depositDue.dueDate} — reservation ${r.confirmationNumber}` : `תזכורת מקדמה עד ${r.depositDue.dueDate} — הזמנה ${r.confirmationNumber}`;
  const text = en
    ? `Dear ${r.primaryGuest?.firstName || 'guest'},\nA deposit of ${open.toFixed(2)} ILS for reservation ${r.confirmationNumber} (arrival ${r.arrivalDate}) is due by ${r.depositDue.dueDate}.\n${property?.name || ''} ${property?.phone || ''}`
    : `שלום ${r.primaryGuest?.firstName || ''},\nתזכורת: מקדמה של ${open.toFixed(2)} ₪ להזמנה ${r.confirmationNumber} (הגעה ${r.arrivalDate}) לתשלום עד ${r.depositDue.dueDate}.\n${property?.name || ''} ${property?.phone || ''}`;
  const info = await sendEmail({ to, subject, text, html: `<div dir="${en ? 'ltr' : 'rtl'}" style="white-space:pre-line">${text}</div>`, replyTo: property?.email || undefined });
  if (!info) throw httpError('שליחת דוא״ל אינה מוגדרת בשרת (EMAIL_USER / EMAIL_PASS)', 409, { code: 'email_not_configured' });
  await Reservation.updateOne({ _id: r._id }, { $set: { 'depositDue.remindedAt': new Date() } });
  await log(propertyId, actor, ip, 'reservation.deposit_reminder', r._id, { automatic, open });
  return { sent: true };
}

// Daily: a reminder two days before the due date, once.
export async function autoRemindDeposits({ propertyId }) {
  const { rows, today } = await depositList({ propertyId });
  const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 2);
  const limit = soon.toISOString().slice(0, 10);
  let sent = 0;
  for (const r of rows.filter((x) => !x.remindedAt && x.dueDate <= limit)) {
    try { await remindDeposit({ propertyId, id: r.id, actor: { name: 'מערכת' }, automatic: true }); sent += 1; } catch { /* no address / no mail server */ }
  }
  return sent;
}

// ── Confirmations ───────────────────────────────────────────────────────────

export async function unconfirmedArrivals({ propertyId, from, to }) {
  if (!YMD.test(from || '') || !YMD.test(to || '') || to < from) throw httpError('טווח הגעות לא תקין', 422);
  const rows = await Reservation.find({ property: propertyId, arrivalDate: { $gte: from, $lte: to }, status: { $in: ['confirmed', 'modified', 'pending_payment'] }, confirmationSent: { $ne: true } })
    .populate('primaryGuest', 'firstName lastName email emails').select('confirmationNumber arrivalDate primaryGuest language').sort({ arrivalDate: 1 }).lean();
  return rows.map((r) => ({ id: String(r._id), confirmationNumber: r.confirmationNumber, guest: nameOf(r.primaryGuest), arrival: r.arrivalDate, language: r.language || 'he', email: r.primaryGuest?.email || r.primaryGuest?.emails?.[0]?.address || null }));
}

export async function sendConfirmations({ propertyId, ids, actor, ip }) {
  mustWork(actor);
  const list = (Array.isArray(ids) ? ids : []).filter(isId).slice(0, 200);
  if (!list.length) throw httpError('לא נבחרו הזמנות', 422);
  const { sendConfirmation } = await import('./confirmationService.js');
  const out = [];
  for (const id of list) {
    try { const r = await sendConfirmation({ propertyId, reservationId: id, actor, ip }); out.push({ id, sent: true, to: r.to }); } catch (err) { out.push({ id, sent: false, error: err.message }); }
  }
  return { sent: out.filter((x) => x.sent).length, failed: out.filter((x) => !x.sent).length, rows: out };
}

// ── Items (rollaway beds, high chairs …) ────────────────────────────────────

export async function listItemTypes({ propertyId }) {
  return (await ItemType.find({ property: propertyId }).sort({ name: 1 }).lean()).map((t) => ({ id: String(t._id), code: t.code, name: t.name, total: t.total, price: t.price ?? null, active: t.active !== false }));
}

export async function saveItemType({ propertyId, id, body, actor, ip }) {
  if (!MANAGER_ROLES.includes(actor?.role) && actor?.role !== 'housekeeping_manager') throw httpError('הגדרת פריטים — למנהל', 403);
  const code = String(body?.code || '').trim().toUpperCase(); const name = String(body?.name || '').trim(); const total = Number(body?.total);
  const fields = {};
  if (!id && !/^[A-Z0-9_-]{2,30}$/.test(code)) fields.code = 'קוד באנגלית';
  if (!name) fields.name = 'שם';
  if (!(Number.isInteger(total) && total >= 0 && total <= 500)) fields.total = 'מלאי 0–500';
  if (Object.keys(fields).length) throw httpError('יש לתקן את הפריט', 422, { fields });
  let t;
  if (id) {
    t = await ItemType.findOne({ _id: id, property: propertyId });
    if (!t) throw httpError('הפריט לא נמצא', 404);
    Object.assign(t, { name, total, price: body?.price === '' || body?.price == null ? undefined : Number(body.price), active: body?.active !== false });
    await t.save();
  } else {
    try { t = await ItemType.create({ property: propertyId, code, name, total, price: body?.price === '' || body?.price == null ? undefined : Number(body.price) }); } catch (err) { if (err?.code === 11000) throw httpError('הקוד כבר קיים', 409); throw err; }
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'items.type_saved', entityType: 'ItemType', entityId: t._id, after: { code: t.code, total: t.total }, ip });
  return (await listItemTypes({ propertyId })).find((x) => x.id === String(t._id));
}

async function itemUse(propertyId, itemId, from, to, excludeBooking = null) {
  const rows = await ItemBooking.find({ property: propertyId, item: itemId, status: 'booked', from: { $lt: to }, to: { $gt: from }, ...(excludeBooking ? { _id: { $ne: excludeBooking } } : {}) }).lean();
  const peak = {};
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) < to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    peak[day] = rows.filter((r) => r.from <= day && day < r.to).reduce((s, r) => s + r.qty, 0);
  }
  return peak;
}

export async function itemAvailability({ propertyId, from, to }) {
  if (!YMD.test(from || '') || !YMD.test(to || '') || to <= from) throw httpError('טווח תאריכים לא תקין', 422);
  const types = await ItemType.find({ property: propertyId, active: { $ne: false } }).lean();
  const out = [];
  for (const t of types) {
    const use = await itemUse(propertyId, t._id, from, to);
    out.push({ id: String(t._id), name: t.name, total: t.total, minFree: Math.min(...Object.values(use).map((u) => t.total - u)) });
  }
  return out;
}

export async function bookItem({ propertyId, reservationId, body, actor, ip }) {
  mustWork(actor);
  const r = await loadRes(propertyId, reservationId);
  if (['cancelled', 'no_show', 'deleted', 'checked_out'].includes(r.status)) throw httpError('ההזמנה סגורה', 409);
  const t = isId(body?.item) ? await ItemType.findOne({ _id: body.item, property: propertyId, active: { $ne: false } }).lean() : null;
  if (!t) throw httpError('הפריט לא נמצא', 404);
  const qty = Number(body?.qty || 1);
  const from = body?.from || r.arrivalDate; const to = body?.to || r.departureDate;
  if (!(Number.isInteger(qty) && qty >= 1 && qty <= 20)) throw httpError('כמות 1–20', 422, { fields: { qty: '1–20' } });
  if (!YMD.test(from) || !YMD.test(to) || to <= from || from < r.arrivalDate || to > r.departureDate) throw httpError('טווח בתוך השהייה', 422, { fields: { from: 'בתוך השהייה' } });
  const use = await itemUse(propertyId, t._id, from, to);
  const short = Object.entries(use).filter(([, u]) => u + qty > t.total).map(([d]) => d);
  if (short.length) throw httpError(`אין מספיק ${t.name} ב־${short.slice(0, 3).join(', ')}`, 409, { code: 'item_unavailable' });
  const b = await ItemBooking.create({ property: propertyId, reservation: r._id, item: t._id, qty, from, to, byName: actor.name });
  await log(propertyId, actor, ip, 'reservation.item_booked', r._id, { item: t.code, qty, from, to });
  return { id: String(b._id) };
}

export async function releaseItem({ propertyId, bookingId, actor, ip }) {
  mustWork(actor);
  const b = isId(bookingId) ? await ItemBooking.findOne({ _id: bookingId, property: propertyId, status: 'booked' }) : null;
  if (!b) throw httpError('הפריט לא נמצא בהזמנה', 404);
  b.status = 'released'; await b.save();
  await log(propertyId, actor, ip, 'reservation.item_released', b.reservation, { booking: String(b._id) });
  return { released: true };
}

// ── Payment methods, privileges, housekeeping ──────────────────────────────

export async function getRules({ propertyId, reservationId }) {
  const r = await Reservation.findOne({ _id: reservationId, property: propertyId }).select('paymentMethods privileges housekeeping depositDue arrivalDate departureDate totalAmount card').populate('paymentMethods.company', 'name').lean();
  if (!r) throw httpError('ההזמנה לא נמצאה', 404);
  const items = await ItemBooking.find({ property: propertyId, reservation: reservationId, status: 'booked' }).populate('item', 'name').lean();
  return {
    paymentMethods: (r.paymentMethods || []).map((m) => ({ ...m, company: m.company ? { id: String(m.company._id), name: m.company.name } : null })),
    privileges: r.privileges || {}, housekeeping: r.housekeeping || {}, depositDue: r.depositDue || null, card: r.card || null,
    items: items.map((i) => ({ id: String(i._id), name: i.item?.name || '', qty: i.qty, from: i.from, to: i.to })),
    paid: await paidOn(r._id),
  };
}

export async function saveRules({ propertyId, reservationId, body, actor, ip }) {
  mustWork(actor);
  const r = await loadRes(propertyId, reservationId);
  if (['cancelled', 'no_show', 'deleted'].includes(r.status)) throw httpError('ההזמנה סגורה', 409);
  const b = body || {};
  const fields = {};
  if (b.paymentMethods !== undefined) {
    const list = Array.isArray(b.paymentMethods) ? b.paymentMethods.slice(0, 6) : [];
    const out = [];
    for (const [i, m] of list.entries()) {
      const method = ['credit_card', 'cash', 'company', 'voucher', 'bank_transfer'].includes(m.method) ? m.method : null;
      if (!method) { fields.paymentMethods = `אמצעי ${i + 1}: לא מוכר`; break; }
      const rule = ['none', 'authorization', 'manager', 'voucher_number'].includes(m.rule) ? m.rule : 'none';
      let company;
      if (method === 'company') {
        company = isId(m.company) ? await Company.findOne({ _id: m.company, property: propertyId }).select('ar active').lean() : null;
        if (!company) { fields.paymentMethods = `אמצעי ${i + 1}: יש לבחור חברה`; break; }
        if (!company.ar?.active) { fields.paymentMethods = `אמצעי ${i + 1}: לחברה אין חשבון חייבים פעיל`; break; }
      }
      if (method === 'credit_card' && rule === 'authorization' && !r.card?.ref) { fields.paymentMethods = `אמצעי ${i + 1}: אין כרטיס שמור בהזמנה למסגרת`; break; }
      if (rule === 'voucher_number' && String(m.ref || '').trim().length < 2) { fields.paymentMethods = `אמצעי ${i + 1}: מספר שובר`; break; }
      const limit = m.limit === '' || m.limit == null ? undefined : round2(m.limit);
      if (limit !== undefined && !(limit > 0)) { fields.paymentMethods = `אמצעי ${i + 1}: תקרה חיובית`; break; }
      out.push({ method, covers: ['all', 'room', 'extras'].includes(m.covers) ? m.covers : 'all', limit, rule, ref: String(m.ref || '').slice(0, 40) || undefined, company: company?._id });
    }
    if (out.filter((m) => m.covers === 'all').length > 1) fields.paymentMethods = 'רק אמצעי אחד יכול לכסות "הכול"';
    if (!fields.paymentMethods) r.paymentMethods = out;
  }
  if (b.privileges !== undefined) {
    const p = b.privileges || {};
    const tri = (v) => (v === true || v === false ? v : undefined);
    if (p.postStayCharges === true && !MANAGER_ROLES.includes(actor.role)) fields.privileges = 'חיוב אחרי עזיבה — מנהל מאשר';
    else r.privileges = { preArrivalCharges: tri(p.preArrivalCharges), postStayCharges: tri(p.postStayCharges), selfCheckout: tri(p.selfCheckout) };
  }
  if (b.housekeeping !== undefined) {
    const h = b.housekeeping || {};
    if (h.turndownTime && !HM.test(h.turndownTime)) fields.housekeeping = 'שעת ערב HH:MM';
    const every = h.cleaningEvery === '' || h.cleaningEvery == null ? undefined : Number(h.cleaningEvery);
    const linen = h.linenEvery === '' || h.linenEvery == null ? undefined : Number(h.linenEvery);
    if ((every !== undefined && !(every >= 1 && every <= 14)) || (linen !== undefined && !(linen >= 1 && linen <= 14))) fields.housekeeping = 'כל 1–14 ימים';
    if (!fields.housekeeping) r.housekeeping = { turndown: !!h.turndown, turndownTime: h.turndownTime || undefined, cleaningEvery: every, linenEvery: linen, note: String(h.note || '').slice(0, 200) || undefined };
  }
  if (Object.keys(fields).length) throw httpError('יש לתקן את כללי ההזמנה', 422, { fields });
  await r.save();
  await log(propertyId, actor, ip, 'reservation.rules', r._id, { paymentMethods: (r.paymentMethods || []).map((m) => m.method), privileges: r.privileges || null, housekeeping: r.housekeeping || null });
  return getRules({ propertyId, reservationId });
}
