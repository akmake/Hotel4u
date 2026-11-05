// Reservation details (gap-map item 14): composition (teens / infants), coordinator and salesperson, agent and
// company on the booking, flight, late check-out hour, special services, VIP reason, cashier note, hidden price,
// fixed rate; a different rate for part of the nights; and a summary to read to the guest on the phone.
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Property from '../models/Property.js';
import { RatePlan } from '../models/RatePlan.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf, MANAGER_ROLES } from './frontDeskService.js';
import { getList } from './codeListService.js';
import { can } from './permissionService.js';

export const DETAIL_ROLES = [...new Set([...MANAGER_ROLES, 'receptionist', 'sales_manager', 'revenue_manager'])];
const PRICE_ROLES = [...new Set([...MANAGER_ROLES, 'revenue_manager', 'sales_manager'])];
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const DEAD = ['cancelled', 'no_show', 'deleted', 'checked_out'];
const str = (v, n) => String(v ?? '').trim().slice(0, n);

async function load(propertyId, reservationId, session = null) {
  const r = isId(reservationId) ? await Reservation.findOne({ _id: reservationId, property: propertyId }).session(session) : null;
  if (!r) throw httpError('ההזמנה לא נמצאה', 404);
  return r;
}

const nameOf = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : null);

export async function getDetails({ propertyId, reservationId }) {
  const r = await Reservation.findOne({ _id: reservationId, property: propertyId })
    .populate('coordinator', 'firstName lastName').populate('salesperson', 'firstName lastName').populate('travelAgent', 'name').populate('company', 'name')
    .populate('billedRoomType', 'name').populate('createdBy', 'firstName lastName').populate('sourceProfile', 'name').populate('contactProfile', 'firstName lastName').lean();
  if (!r) throw httpError('ההזמנה לא נמצאה', 404);
  return {
    teens: r.teens || 0, infants: r.infants || 0, adults: r.adults, children: r.children,
    coordinator: r.coordinator ? { id: String(r.coordinator._id), name: nameOf(r.coordinator) } : null,
    salesperson: r.salesperson ? { id: String(r.salesperson._id), name: nameOf(r.salesperson) } : null,
    travelAgent: r.travelAgent ? { id: String(r.travelAgent._id), name: r.travelAgent.name } : null,
    company: r.company ? { id: String(r.company._id), name: r.company.name } : null,
    flight: r.flight || null, lateCheckout: r.lateCheckout || null, cashierNote: r.cashierNote || '',
    hidePrice: !!r.hidePrice, fixedRate: !!r.fixedRate, billedRoomType: r.billedRoomType ? { id: String(r.billedRoomType._id), name: r.billedRoomType.name } : null,
    isVip: !!r.isVip, vipReason: r.vipReason || '', specialServices: r.specialServices || [],
    sourceProfile: r.sourceProfile ? { id: String(r.sourceProfile._id), name: r.sourceProfile.name } : null,
    contactProfile: r.contactProfile ? { id: String(r.contactProfile._id), name: nameOf(r.contactProfile) } : null,
    source: r.source || null, marketSegment: r.marketSegment || null, createdBy: nameOf(r.createdBy), createdAt: r.createdAt,
    nightly: (r.priceSnapshot?.nightly || []).map((n) => ({ date: n.date, price: n.price, planCode: n.planCode || r.priceSnapshot?.ratePlanCode || null })),
  };
}

export async function saveDetails({ propertyId, reservationId, body, actor, ip }) {
  if (!DETAIL_ROLES.includes(actor?.role)) throw httpError('אין הרשאה לעדכן פרטי הזמנה', 403);
  const r = await load(propertyId, reservationId);
  if (['cancelled', 'no_show', 'deleted'].includes(r.status)) throw httpError('ההזמנה סגורה', 409);
  const b = body || {};
  const fields = {};
  const before = { teens: r.teens, infants: r.infants, coordinator: r.coordinator ? String(r.coordinator) : null, salesperson: r.salesperson ? String(r.salesperson) : null, travelAgent: r.travelAgent ? String(r.travelAgent) : null, isVip: r.isVip, hidePrice: r.hidePrice, fixedRate: r.fixedRate, lateCheckout: r.lateCheckout?.time || null, specialServices: (r.specialServices || []).map((s) => s.code) };
  for (const k of ['teens', 'infants']) {
    if (b[k] === undefined) continue;
    const v = Number(b[k]);
    if (!Number.isInteger(v) || v < 0 || v > (k === 'teens' ? 20 : 10)) fields[k] = 'מספר שלם'; else r[k] = v;
  }
  for (const k of ['coordinator', 'salesperson']) {
    if (b[k] === undefined) continue;
    if (!b[k]) { r[k] = undefined; continue; }
    const u = isId(b[k]) ? await User.findOne({ _id: b[k], property: propertyId, active: { $ne: false } }).select('_id').lean() : null;
    if (!u) fields[k] = 'משתמש לא קיים בנכס'; else r[k] = u._id;
  }
  for (const [k, types] of [['travelAgent', ['agency', 'tour_operator']], ['company', null]]) {
    if (b[k] === undefined) continue;
    if (!b[k]) { r[k] = undefined; continue; }
    const c = isId(b[k]) ? await Company.findOne({ _id: b[k], property: propertyId }).select('type active').lean() : null;
    if (!c) fields[k] = 'לא נמצא';
    else if (types && !types.includes(c.type)) fields[k] = 'החברה אינה סוכן';
    else r[k] = c._id;
  }
  if (b.flight !== undefined) {
    const f = b.flight || {};
    for (const t of ['arrivalTime', 'departureTime']) if (f[t] && !HM.test(f[t])) fields.flight = 'שעה בפורמט HH:MM';
    r.flight = f.arrivalNo || f.departureNo || f.arrivalTime || f.departureTime ? { arrivalNo: str(f.arrivalNo, 12).toUpperCase(), arrivalTime: f.arrivalTime || undefined, departureNo: str(f.departureNo, 12).toUpperCase(), departureTime: f.departureTime || undefined } : undefined;
    if (f.arrivalTime && !r.eta && HM.test(f.arrivalTime)) r.eta = f.arrivalTime;
  }
  if (b.lateCheckout !== undefined) {
    const t = b.lateCheckout?.time || b.lateCheckout || '';
    if (t && !HM.test(t)) fields.lateCheckout = 'שעה בפורמט HH:MM';
    else if (t) { r.lateCheckout = { time: t, byName: actor.name, at: new Date() }; r.etd = t; }
    else r.lateCheckout = undefined;
  }
  if (b.specialServices !== undefined) {
    const list = await getList(propertyId, 'special_service', { activeOnly: true });
    const codes = [...new Set((b.specialServices || []).map(String))];
    if (codes.some((c) => !list.some((x) => x.code === c))) fields.specialServices = 'שירות לא קיים ברשימה';
    else {
      const prev = new Map((r.specialServices || []).map((s) => [s.code, s]));
      r.specialServices = codes.map((c) => prev.get(c) || { code: c, label: list.find((x) => x.code === c).label, source: 'manual', byName: actor.name, at: new Date() });
    }
  }
  if (b.isVip !== undefined) {
    const on = !!b.isVip;
    if (on && !r.isVip && str(b.vipReason, 200).length < 2) fields.vipReason = 'סימון VIP מחייב סיבה';
    else { r.isVip = on; r.vipReason = on ? str(b.vipReason ?? r.vipReason, 200) : undefined; }
  }
  if (b.cashierNote !== undefined) r.cashierNote = str(b.cashierNote, 300) || undefined;
  if (b.hidePrice !== undefined) r.hidePrice = !!b.hidePrice;
  if (b.fixedRate !== undefined) {
    if (!!b.fixedRate !== !!r.fixedRate && !can(actor, 'price.override', PRICE_ROLES)) fields.fixedRate = 'מחיר קבוע — למנהל או להכנסות';
    else r.fixedRate = !!b.fixedRate;
  }
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי ההזמנה', 422, { fields });
  await r.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.details', entityType: 'Reservation', entityId: r._id, before, after: { teens: r.teens, infants: r.infants, coordinator: r.coordinator ? String(r.coordinator) : null, salesperson: r.salesperson ? String(r.salesperson) : null, travelAgent: r.travelAgent ? String(r.travelAgent) : null, isVip: r.isVip, hidePrice: r.hidePrice, fixedRate: r.fixedRate, lateCheckout: r.lateCheckout?.time || null, specialServices: (r.specialServices || []).map((s) => s.code) }, reason: b.vipReason || undefined, ip });
  return getDetails({ propertyId, reservationId });
}

// A different rate for part of the stay: those nights are re-priced on the other plan (not nights already posted).
export async function splitRate({ propertyId, reservationId, body, actor, ip }) {
  if (!can(actor, 'price.override', PRICE_ROLES)) throw httpError('שינוי תעריף ללילות — למנהל או להכנסות', 403);
  const r = await load(propertyId, reservationId);
  if (DEAD.includes(r.status)) throw httpError('ההזמנה סגורה', 409);
  const { from, to } = body || {};
  const why = str(body?.reason, 200);
  const fields = {};
  if (!YMD.test(from || '') || !YMD.test(to || '') || to < from) fields.from = 'טווח לילות תקין';
  if (why.length < 3) fields.reason = 'יש לפרט סיבה';
  const plan = isId(body?.ratePlanId) ? await RatePlan.findOne({ _id: body.ratePlanId, property: propertyId }).lean() : null;
  if (!plan) fields.ratePlanId = 'תעריף לא קיים';
  if (Object.keys(fields).length) throw httpError('יש לתקן את שינוי התעריף', 422, { fields });
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const nightly = (r.priceSnapshot?.nightly || []).map((n) => (n.toObject ? n.toObject() : n));
  const dates = nightly.map((n) => n.date).filter((d) => d >= from && d <= to);
  if (!dates.length) throw httpError('אין לילות של ההזמנה בטווח', 422, { fields: { from: 'מחוץ לשהייה' } });
  if (dates.some((d) => d < today)) throw httpError('לילות שכבר עברו לא מתומחרים מחדש', 422, { fields: { from: 'לילה שעבר' } });
  const { priceNights } = await import('./bookingService.js');
  const q = await priceNights({ roomTypeId: r.roomType, ratePlanId: plan._id, dates, adults: r.adults || 2, children: r.children || 0, rooms: r.roomsCount || 1 });
  if (q.missing.length) throw httpError(`אין מחיר בתעריף ${plan.name} ל־${q.missing.join(', ')}`, 422, { fields: { ratePlanId: 'אין מחיר' } });
  const by = new Map(q.nightly.map((n) => [n.date, round2(n.price)]));
  const beforeTotal = r.totalAmount;
  r.priceSnapshot.nightly = nightly.map((n) => (by.has(n.date) ? { date: n.date, price: by.get(n.date), planCode: plan.code } : n));
  const perRoom = round2(r.priceSnapshot.nightly.reduce((s, n) => s + Number(n.price || 0), 0));
  r.priceSnapshot.total = round2(perRoom * (r.roomsCount || 1));
  r.totalAmount = r.priceSnapshot.total;
  r.markModified('priceSnapshot');
  await r.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.split_rate', entityType: 'Reservation', entityId: r._id, before: { total: beforeTotal }, after: { total: r.totalAmount, plan: plan.code, from, to, nights: dates.length }, reason: why, ip });
  return { total: r.totalAmount, nights: dates.length, plan: plan.code };
}

// Text to read to the guest (their language when known: he / en), price left out when hidden.
export async function phoneSummary({ propertyId, reservationId }) {
  const r = await Reservation.findOne({ _id: reservationId, property: propertyId }).lean();
  if (!r) throw httpError('ההזמנה לא נמצאה', 404);
  const [g, rt, p, plan] = await Promise.all([
    GuestProfile.findById(r.primaryGuest).select('firstName lastName').lean(),
    RoomType.findById(r.roomType).select('name').lean(),
    Property.findById(propertyId).select('name phone checkInTime checkOutTime defaultCancellationHours').lean(),
    r.ratePlan ? RatePlan.findById(r.ratePlan).select('name cancellationPolicy').lean() : null,
  ]);
  const en = r.language === 'en';
  const services = (r.specialServices || []).map((s) => s.label).join(', ');
  const L = en ? {
    hello: `Hello ${g?.firstName || ''},`, conf: 'Confirmation number', stay: 'Stay', nights: 'nights', room: 'Room', rate: 'Rate', guests: 'Guests',
    adults: 'adults', kids: 'children', price: 'Total price', cancel: 'Cancellation', services: 'Arranged for you', checkIn: 'Check-in from', checkOut: 'check-out by', lco: 'Late check-out until',
  } : {
    hello: `שלום ${g?.firstName || ''},`, conf: 'מספר אישור', stay: 'שהייה', nights: 'לילות', room: 'חדר', rate: 'תעריף', guests: 'אורחים',
    adults: 'מבוגרים', kids: 'ילדים', price: 'מחיר כולל', cancel: 'ביטול', services: 'סידרנו עבורכם', checkIn: 'כניסה החל מ־', checkOut: 'יציאה עד', lco: 'יציאה מאוחרת עד',
  };
  const lines = [
    L.hello,
    `${L.conf}: ${r.confirmationNumber}`,
    `${L.stay}: ${r.arrivalDate} – ${r.departureDate} (${r.nights} ${L.nights})`,
    `${L.room}: ${rt?.name || ''}${r.roomsCount > 1 ? ` × ${r.roomsCount}` : ''}${plan ? ` · ${L.rate}: ${plan.name}` : ''}`,
    `${L.guests}: ${r.adults} ${L.adults}${r.children ? `, ${r.children} ${L.kids}` : ''}`,
    ...(r.hidePrice ? [] : [`${L.price}: ${Number(r.totalAmount || 0).toLocaleString('he-IL')} ₪`]),
    ...(services ? [`${L.services}: ${services}`] : []),
    `${L.checkIn} ${p?.checkInTime || '15:00'}, ${L.checkOut} ${p?.checkOutTime || '11:00'}${r.lateCheckout?.time ? ` · ${L.lco} ${r.lateCheckout.time}` : ''}`,
    ...(plan?.cancellationPolicy ? [`${L.cancel}: ${plan.cancellationPolicy}`] : []),
    `${p?.name || ''}${p?.phone ? ` · ${p.phone}` : ''}`,
  ];
  // The price in the currencies the cashier holds rates for (same rates as the folio).
  let foreign = [];
  if (!r.hidePrice) {
    const { folioRates } = await import('./cashierService.js');
    foreign = (await folioRates(propertyId)).filter((x) => Number(x.charge) > 0).map((x) => ({ currency: x.currency, amount: round2(Number(r.totalAmount || 0) / Number(x.charge)) }));
  }
  return { language: en ? 'en' : 'he', text: lines.join('\n'), foreign };
}

// Choices for the details form: staff, agents and companies, special services, rate plans.
export async function detailOptions({ propertyId }) {
  const contactsP = GuestProfile.find({ property: propertyId, isContact: true }).select('firstName lastName').sort({ firstName: 1 }).limit(200).lean();
  const [users, companies, services, plans] = await Promise.all([
    User.find({ property: propertyId, active: { $ne: false }, role: { $nin: ['housekeeper', 'technician', 'owner_readonly', 'admin', 'sales', 'maintenance', 'shift_manager'] } }).select('firstName lastName role').sort({ firstName: 1 }).lean(),
    Company.find({ property: propertyId, active: { $ne: false } }).select('name type').sort({ name: 1 }).lean(),
    getList(propertyId, 'special_service', { activeOnly: true }),
    RatePlan.find({ property: propertyId, active: { $ne: false } }).select('code name').sort({ sortOrder: 1, name: 1 }).lean(),
  ]);
  return {
    users: users.map((u) => ({ id: String(u._id), name: nameOf(u), role: u.role })),
    agents: companies.filter((c) => ['agency', 'tour_operator'].includes(c.type)).map((c) => ({ id: String(c._id), name: c.name })),
    companies: companies.map((c) => ({ id: String(c._id), name: c.name })),
    services: services.map((x) => ({ code: x.code, label: x.label })),
    ratePlans: plans.map((x) => ({ id: String(x._id), code: x.code, name: x.name })),
    sources: companies.filter((c) => c.type === 'source').map((c) => ({ id: String(c._id), name: c.name })),
    contacts: (await contactsP).map((g) => ({ id: String(g._id), name: nameOf(g) })),
  };
}
