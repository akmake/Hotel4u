// Demand system (Optima "Demand system"): per future night — rooms on the books, group holds,
// pickup pace, the same weekday last year, events in house, a forecast and a price recommendation
// for a reference room type / rate plan. A recommendation is applied to the rate calendar only when
// a revenue role accepts it (price only; restrictions stay as they are).
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import InventoryDate from '../models/InventoryDate.js';
import EventBooking from '../models/Event.js';
import Property from '../models/Property.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { priceNight } from './ratePricing.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { enqueueChannelUpdate } from './channelQueueService.js';
import { dayTypesFor } from './revenueService.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const LIVE = ['confirmed', 'modified', 'pending_payment', 'hold', 'checked_in', 'in_house', 'partially_checked_in', 'partially_checked_out', 'checked_out'];
export const RATE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager'];
const round10 = (n) => Math.round(n / 10) * 10;

// Rules, shown to the user as they are applied.
export const RULES = [
  { min: 0.9, pct: 15, label: 'צפי תפוסה 90%+' },
  { min: 0.75, pct: 8, label: 'צפי תפוסה 75%+' },
  { min: 0.6, pct: 0, label: 'ביקוש רגיל' },
];

function recommend({ forecastOcc, daysOut, pace, eventPeople, current }) {
  if (!(current > 0)) return null;
  let pct = 0; const why = [];
  if (forecastOcc >= 0.9) { pct += 15; why.push('צפי תפוסה 90%+'); }
  else if (forecastOcc >= 0.75) { pct += 8; why.push('צפי תפוסה 75%+'); }
  else if (forecastOcc < 0.3 && daysOut <= 14) { pct -= 10; why.push('צפי תפוסה נמוך מ־30% בשבועיים הקרובים'); }
  else if (forecastOcc < 0.45 && daysOut <= 7) { pct -= 5; why.push('צפי תפוסה נמוך מ־45% בשבוע הקרוב'); }
  if (pace >= 3 && forecastOcc >= 0.5) { pct += 5; why.push(`קצב הזמנות גבוה (${pace} בשבוע)`); }
  if (eventPeople >= 50) { pct += 5; why.push(`אירועים בבית (${eventPeople} משתתפים)`); }
  pct = Math.max(-20, Math.min(30, pct));
  if (!pct) return { price: current, pct: 0, why: why.length ? why : ['ללא שינוי'] };
  return { price: Math.max(1, round10(current * (1 + pct / 100))), pct, why };
}

async function stays(propertyId, from, to, roomTypeId) {
  return Reservation.find({ property: propertyId, status: { $in: LIVE }, arrivalDate: { $lt: to }, departureDate: { $gt: from }, ...(roomTypeId ? { roomType: roomTypeId } : {}) })
    .select('arrivalDate departureDate roomsCount createdAt roomType status').lean();
}

export async function demandCalendar({ propertyId, from, days = 60, roomTypeId, ratePlanId }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const start = YMD.test(from || '') && from >= today ? from : today;
  const n = Math.min(120, Math.max(7, Number(days) || 60));
  const dates = Array.from({ length: n }, (_, i) => addDays(start, i));
  const end = addDays(start, n);
  const type = isId(roomTypeId) ? await RoomType.findOne({ _id: roomTypeId, property: propertyId }).lean() : null;
  const types = await RoomType.find({ property: propertyId, active: { $ne: false } }).sort({ sortOrder: 1, baseRate: 1 }).lean();
  const refType = type || types[0] || null;
  const plans = await RatePlan.find({ property: propertyId, active: { $ne: false } }).sort({ sortOrder: 1, code: 1 }).lean();
  const refPlan = (isId(ratePlanId) && plans.find((p) => String(p._id) === String(ratePlanId))) || plans.find((p) => p.type === 'public') || plans[0] || null;
  const typeFilter = type ? type._id : null;
  const [rooms, now, ly, inv, evs, rds, parentRds] = await Promise.all([
    Room.countDocuments({ property: propertyId, active: { $ne: false }, ...(typeFilter ? { roomType: typeFilter } : {}) }),
    stays(propertyId, start, end, typeFilter),
    stays(propertyId, addDays(start, -364), addDays(end, -364), typeFilter),
    InventoryDate.find({ property: propertyId, date: { $gte: start, $lt: end }, ...(typeFilter ? { roomType: typeFilter } : {}) }).select('date groupAllotmentCount blockedCount').lean(),
    EventBooking.find({ property: propertyId, date: { $gte: start, $lt: end }, status: { $in: ['tentative', 'confirmed'] } }).select('date attendees').lean(),
    refPlan && refType ? RateDate.find({ ratePlan: refPlan._id, roomType: refType._id, date: { $gte: start, $lt: end } }).lean() : [],
    refPlan?.derived?.from && refType ? RateDate.find({ ratePlan: refPlan.derived.from, roomType: refType._id, date: { $gte: start, $lt: end } }).lean() : [],
  ]);
  const parentPlan = refPlan?.derived?.from ? await RatePlan.findById(refPlan.derived.from).lean() : null;
  const dayTypes = await dayTypesFor({ propertyId, dates });
  const rdBy = new Map(rds.map((r) => [r.date, r]));
  const prdBy = new Map(parentRds.map((r) => [r.date, r]));
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000);
  const count = (list, d, pred = () => true) => list.filter((s) => s.arrivalDate <= d && d < s.departureDate && pred(s)).reduce((a, s) => a + (s.roomsCount || 1), 0);
  const rows = dates.map((d) => {
    const daysOut = daysBetween(today, d);
    const onBooks = count(now, d, (s) => s.status !== 'checked_out' || d < today);
    const pace = count(now, d, (s) => new Date(s.createdAt) >= weekAgo);
    const pace14 = count(now, d, (s) => new Date(s.createdAt) >= twoWeeksAgo);
    const lastYear = count(ly, addDays(d, -364));
    const invRows = inv.filter((x) => x.date === d);
    const groupHold = invRows.reduce((a, x) => a + (x.groupAllotmentCount || 0), 0);
    const blocked = invRows.reduce((a, x) => a + (x.blockedCount || 0), 0);
    const ev = evs.filter((e) => e.date === d);
    const eventPeople = ev.reduce((a, e) => a + (e.attendees || 0), 0);
    const cap = Math.max(0, rooms - blocked);
    // Forecast: what is held now + the recent daily pickup for this night carried to the night itself.
    const expected = Math.round((pace14 / 14) * Math.max(0, daysOut));
    const forecast = Math.min(cap, onBooks + groupHold + expected);
    const occ = cap ? (onBooks + groupHold) / cap : 0;
    const forecastOcc = cap ? forecast / cap : 0;
    const p = refPlan && refType ? priceNight({ plan: refPlan, roomType: refType, rd: rdBy.get(d), date: d, adults: 2, children: 0, los: 1, today, parent: parentPlan ? { plan: parentPlan, rd: prdBy.get(d) } : null, dayType: dayTypes.get(d) || null }) : { price: null };
    const rec = recommend({ forecastOcc, daysOut, pace, eventPeople, current: p.price });
    return {
      date: d, weekday: new Date(`${d}T00:00:00Z`).getUTCDay(), daysOut, rooms: cap, onBooks, groupHold, pace, lastYear,
      occupancy: Math.round(occ * 100), forecast, forecastOcc: Math.round(forecastOcc * 100), lastYearOcc: cap ? Math.round((lastYear / cap) * 100) : 0,
      events: ev.length, eventPeople, price: p.price ?? null, priceSource: p.source || null, recommended: rec?.price ?? null, changePct: rec?.pct ?? 0, why: rec?.why || [],
    };
  });
  const avg = (k) => (rows.length ? Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length) : 0);
  return {
    today, from: start, days: n, rooms,
    roomType: refType ? { id: String(refType._id), name: refType.name } : null, ratePlan: refPlan ? { id: String(refPlan._id), name: refPlan.name } : null,
    roomTypes: types.map((t) => ({ id: String(t._id), name: t.name })), ratePlans: plans.map((p) => ({ id: String(p._id), name: p.name })),
    filteredByType: !!type,
    summary: { occupancy: avg('occupancy'), forecastOcc: avg('forecastOcc'), lastYearOcc: avg('lastYearOcc'), pace: rows.reduce((s, r) => s + r.pace, 0), toRaise: rows.filter((r) => r.changePct > 0).length, toLower: rows.filter((r) => r.changePct < 0).length },
    rows,
  };
}

// Set the price of the reference plan / room type for the chosen nights (price only).
export async function applyPrices({ propertyId, ratePlanId, roomTypeId, items, actor, ip }) {
  if (!RATE_ROLES.includes(actor.role)) throw httpError('שינוי מחירים — למנהל או להכנסות', 403);
  if (!isId(ratePlanId) || !isId(roomTypeId)) throw httpError('יש לבחור תעריף וסוג חדר', 422);
  const [plan, type] = await Promise.all([RatePlan.findOne({ _id: ratePlanId, property: propertyId }).lean(), RoomType.findOne({ _id: roomTypeId, property: propertyId }).lean()]);
  if (!plan || !type) throw httpError('התעריף או סוג החדר לא נמצאו', 404);
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const list = (Array.isArray(items) ? items : []).slice(0, 120).filter((x) => YMD.test(x?.date || '') && x.date >= today && Number(x.price) > 0);
  if (!list.length) throw httpError('לא נבחרו לילות', 422);
  const before = new Map((await RateDate.find({ ratePlan: plan._id, roomType: type._id, date: { $in: list.map((x) => x.date) } }).lean()).map((r) => [r.date, r.price]));
  for (const x of list) {
    const price = Math.round(Number(x.price) * 100) / 100;
    await RateDate.updateOne({ ratePlan: plan._id, roomType: type._id, date: x.date }, { $set: { price }, $setOnInsert: { minLos: 1, cta: false, ctd: false, stopSell: false } }, { upsert: true });
    enqueueChannelUpdate({ propertyId, channel: 'all', eventType: 'rate', payload: { action: 'upsert', ratePlanId: String(plan._id), roomTypeId: String(type._id), date: x.date, fields: { price } }, idempotencyKey: `rate:${plan._id}:${type._id}:${x.date}:${price}` }).catch(() => null);
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'rates.demand_applied', entityType: 'RatePlan', entityId: plan._id, before: Object.fromEntries(list.map((x) => [x.date, before.get(x.date) ?? null])), after: Object.fromEntries(list.map((x) => [x.date, Number(x.price)])), reason: `${type.name} · ${list.length} לילות`, ip });
  return { applied: list.length };
}
