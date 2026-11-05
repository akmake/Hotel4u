// Revenue management (gap-map item 9): day types + hotel calendar, length-of-stay tiers, channel
// restrictions and automatic strategies. Booking reads the day type of each night (price), the channel
// rules (close / web discount) and the restrictions strategies placed (stop sell, CTA, min nights).
import { can } from './permissionService.js';
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import InventoryDate from '../models/InventoryDate.js';
import Property from '../models/Property.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { DayType, HotelDay, ChannelRule, RevenueStrategy, AutoRestriction, RestrictionLog } from '../models/Revenue.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { enqueueChannelUpdate } from './channelQueueService.js';

export const RATE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager'];
export const CHANNELS = { desk: 'קבלה / טלפון', web: 'אתר ההזמנות', ota: 'ערוצים חיצוניים' };
export const ACTIONS = { stop_sell: 'סגירה למכירה', cta: 'סגירה להגעה', min_los: 'מינימום לילות' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const ids = (list) => (Array.isArray(list) ? list.filter(isId).map(String) : []);
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const LIVE = ['confirmed', 'modified', 'pending_payment', 'hold', 'checked_in', 'in_house', 'partially_checked_in', 'partially_checked_out', 'checked_out'];
const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
const mustManage = (actor) => { if (!can(actor, 'rates.manage', RATE_ROLES)) throw httpError('ניהול הכנסות — למנהל או לאחראי הכנסות', 403); };
const log = (propertyId, actor, ip, action, entityType, entityId, before, after, reason) => audit({ property: propertyId, actor: actor.id, actorName: actor.name, action, entityType, entityId, before, after, reason, ip });

// ── Read side used by booking / pricing ─────────────────────────────────────

// date → { name, multiplier, addition, color } for the dates that have a day type.
export async function dayTypesFor({ propertyId, dates, session = null }) {
  if (!propertyId || !dates?.length) return new Map();
  const days = await HotelDay.find({ property: propertyId, date: { $in: dates }, dayType: { $ne: null } }).session(session).select('date dayType').lean();
  if (!days.length) return new Map();
  const types = new Map((await DayType.find({ _id: { $in: days.map((d) => d.dayType) }, active: { $ne: false } }).session(session).lean()).map((t) => [String(t._id), t]));
  return new Map(days.filter((d) => types.has(String(d.dayType))).map((d) => [d.date, types.get(String(d.dayType))]));
}

// Plans in the order of the arrival night's day type (its planOrder first, the rest keep their order).
export function orderPlans(plans, dayType) {
  const order = (dayType?.planOrder || []).map(String);
  if (!order.length) return plans;
  const rank = (p) => { const i = order.indexOf(String(p._id)); return i < 0 ? order.length : i; };
  return plans.map((p, i) => [p, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([p]) => p);
}

// Everything booking needs for a stay in one go.
export async function revenueContext({ propertyId, dates, session = null }) {
  const from = dates[0]; const to = dates[dates.length - 1];
  const [dayTypes, channelRules, auto] = await Promise.all([
    dayTypesFor({ propertyId, dates, session }),
    ChannelRule.find({ property: propertyId, active: { $ne: false }, from: { $lte: to }, to: { $gte: from } }).session(session).lean(),
    AutoRestriction.find({ property: propertyId, date: { $in: dates }, liftedAt: null }).session(session).lean(),
  ]);
  return { dayTypes, channelRules, auto };
}

// The channel a reservation was sold on (older site bookings have only marketSegment 'website').
export const channelOf = (r) => r?.salesChannel || (r?.marketSegment === 'website' ? 'web' : 'desk');

const inScope = (list, id) => !list?.length || list.some((x) => String(x) === String(id));

// Channel rules and strategy restrictions for one offer (plan × room type) on the stay nights.
export function restrictionsFor(ctx, { dates, channel = 'desk', planId, roomTypeId }) {
  const reasons = []; const discounts = new Map(); let minLos = 0; let minLosBy = null;
  if (!ctx) return { reasons, discounts, minLos };
  for (const r of ctx.channelRules || []) {
    if (r.channel !== channel || !inScope(r.ratePlans, planId) || !inScope(r.roomTypes, roomTypeId)) continue;
    const hit = dates.filter((d) => d >= r.from && d <= r.to);
    if (!hit.length) continue;
    if (r.action === 'close') reasons.push({ code: 'channel_closed', label: `התעריף סגור ב${CHANNELS[channel]} ל־${hit[0]}${hit.length > 1 ? ` (+${hit.length - 1})` : ''}` });
    else if (Number(r.pct) > 0) for (const d of hit) discounts.set(d, Math.max(discounts.get(d) || 0, Number(r.pct)));
  }
  // Strategy restrictions: a room-type row applies to that type; a hotel row (no type) to every type.
  const rows = (ctx.auto || []).filter((a) => (!a.roomType || String(a.roomType) === String(roomTypeId)) && inScope(a.ratePlans, planId));
  const closed = rows.filter((a) => a.action === 'stop_sell');
  if (closed.length) reasons.push({ code: 'strategy_closed', label: `סגור למכירה אוטומטית (${closed[0].strategyName}) ל־${closed[0].date}` });
  const cta = rows.find((a) => a.action === 'cta' && a.date === dates[0]);
  if (cta) reasons.push({ code: 'strategy_cta', label: `סגור להגעה אוטומטית (${cta.strategyName})` });
  for (const a of rows.filter((x) => x.action === 'min_los').sort((x, y) => (x.priority ?? 10) - (y.priority ?? 10))) {
    if (!minLos) { minLos = Number(a.minLos) || 0; minLosBy = a.strategyName; }
  }
  return { reasons, discounts, minLos, minLosBy };
}

// ── Day types + hotel calendar ──────────────────────────────────────────────

export async function listDayTypes({ propertyId }) {
  const rows = await DayType.find({ property: propertyId }).sort({ active: -1, code: 1 }).lean();
  return rows.map((t) => ({ id: String(t._id), code: t.code, name: t.name, color: t.color, multiplier: t.multiplier, addition: t.addition, planOrder: (t.planOrder || []).map(String), active: t.active !== false }));
}

function dayTypeInput(b) {
  const fields = {};
  const code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
  const name = String(b.name || '').trim().slice(0, 60);
  const multiplier = Number(b.multiplier ?? 1);
  const addition = Number(b.addition ?? 0);
  if (code.length < 2) fields.code = 'קוד של 2 תווים לפחות';
  if (name.length < 2) fields.name = 'נדרש שם';
  if (!(multiplier >= 0.1 && multiplier <= 5)) fields.multiplier = 'מכפיל בין 0.1 ל־5';
  if (!Number.isFinite(addition) || Math.abs(addition) > 10000) fields.addition = 'תוספת לא תקינה';
  if (Object.keys(fields).length) throw httpError('יש לתקן את סוג היום', 422, { fields });
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#94a3b8';
  return { code, name, color, multiplier: Math.round(multiplier * 1000) / 1000, addition: Math.round(addition * 100) / 100, active: b.active !== false };
}

export async function saveDayType({ propertyId, id, body, actor, ip }) {
  mustManage(actor);
  const input = dayTypeInput(body || {});
  input.planOrder = [...new Set(ids(body?.planOrder))].slice(0, 30);
  if (input.planOrder.length && await RatePlan.countDocuments({ _id: { $in: input.planOrder }, property: propertyId }) !== input.planOrder.length) throw httpError('תעריף לא שייך לנכס', 422, { fields: { planOrder: 'לא תקין' } });
  const dup =await DayType.findOne({ property: propertyId, code: input.code, ...(id ? { _id: { $ne: id } } : {}) }).lean();
  if (dup) throw httpError('הקוד כבר קיים', 409, { fields: { code: 'קיים' } });
  let before = null; let doc;
  if (id) {
    if (!isId(id)) throw httpError('סוג יום לא תקין', 422);
    doc = await DayType.findOne({ _id: id, property: propertyId });
    if (!doc) throw httpError('סוג היום לא נמצא', 404);
    before = doc.toObject();
    Object.assign(doc, input, { updatedByName: actor.name });
    await doc.save();
  } else doc = await DayType.create({ property: propertyId, ...input, updatedByName: actor.name });
  await log(propertyId, actor, ip, id ? 'revenue.day_type_updated' : 'revenue.day_type_created', 'DayType', doc._id, before && { multiplier: before.multiplier, addition: before.addition, active: before.active, planOrder: (before.planOrder || []).map(String) }, input, input.name);
  return { id: String(doc._id), ...input };
}

// Hotel calendar for a range: day type, note, events, occupancy and active strategy restrictions per date.
export async function hotelCalendar({ propertyId, from, days = 42 }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const start = YMD.test(from || '') ? from : today;
  const n = Math.min(370, Math.max(7, Number(days) || 42));
  const dates = Array.from({ length: n }, (_, i) => addDays(start, i));
  const [types, days_, occ, auto] = await Promise.all([
    listDayTypes({ propertyId }),
    HotelDay.find({ property: propertyId, date: { $gte: start, $lte: dates[n - 1] } }).lean(),
    occupancyByDate({ propertyId, dates }),
    AutoRestriction.find({ property: propertyId, date: { $gte: start, $lte: dates[n - 1] }, liftedAt: null }).populate('roomType', 'name').lean(),
  ]);
  const byDate = new Map(days_.map((d) => [d.date, d]));
  return {
    today, from: start, days: n, dayTypes: types,
    rows: dates.map((d) => {
      const h = byDate.get(d); const o = occ.get(d);
      return {
        date: d, weekday: weekday(d), dayTypeId: h?.dayType ? String(h.dayType) : null, note: h?.note || '', events: h?.events || [],
        occupancy: o?.hotel?.pct ?? 0, sold: o?.hotel?.sold ?? 0, rooms: o?.hotel?.rooms ?? 0,
        auto: auto.filter((a) => a.date === d).map((a) => ({ action: a.action, label: ACTIONS[a.action], minLos: a.minLos || null, strategy: a.strategyName, roomType: a.roomType?.name || null })),
      };
    }),
  };
}

// Set (or clear) the day type / note / events of a range, optionally only on some weekdays.
export async function setCalendar({ propertyId, body, actor, ip }) {
  mustManage(actor);
  const b = body || {};
  if (!YMD.test(b.from || '') || !YMD.test(b.to || '') || b.to < b.from) throw httpError('טווח תאריכים לא תקין', 422, { fields: { to: 'טווח לא תקין' } });
  if (daysBetween(b.from, b.to) > 366) throw httpError('עד שנה בפעם אחת', 422, { fields: { to: 'עד שנה' } });
  const weekdays = Array.isArray(b.weekdays) ? b.weekdays.map(Number).filter((x) => x >= 0 && x <= 6) : [];
  const set = {};
  if (b.dayTypeId !== undefined) {
    if (b.dayTypeId && !(isId(b.dayTypeId) && await DayType.exists({ _id: b.dayTypeId, property: propertyId }))) throw httpError('סוג היום לא נמצא', 422, { fields: { dayTypeId: 'לא נמצא' } });
    set.dayType = b.dayTypeId || null;
  }
  if (b.note !== undefined) set.note = String(b.note || '').trim().slice(0, 300);
  if (b.events !== undefined) set.events = (Array.isArray(b.events) ? b.events : String(b.events || '').split(',')).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 10);
  if (!Object.keys(set).length) throw httpError('לא נבחר מה לעדכן', 422);
  const dates = [];
  for (let d = b.from; d <= b.to; d = addDays(d, 1)) if (!weekdays.length || weekdays.includes(weekday(d))) dates.push(d);
  if (!dates.length) throw httpError('אין תאריכים שמתאימים לימים שנבחרו', 422, { fields: { weekdays: 'אין התאמה' } });
  const before = await HotelDay.find({ property: propertyId, date: { $in: dates } }).select('date dayType note events').lean();
  await HotelDay.bulkWrite(dates.map((date) => ({ updateOne: { filter: { property: propertyId, date }, update: { $set: { ...set, updatedByName: actor.name } }, upsert: true } })));
  await log(propertyId, actor, ip, 'revenue.calendar_set', 'Property', propertyId, { days: before.length }, { from: b.from, to: b.to, weekdays, ...set, dates: dates.length }, `${dates.length} ימים`);
  if (set.dayType !== undefined) enqueueChannelUpdate({ propertyId, channel: 'all', eventType: 'rate', payload: { action: 'reprice', from: b.from, to: b.to, reason: 'day_type' }, idempotencyKey: `daytype:${propertyId}:${b.from}:${b.to}:${Date.now()}` }).catch(() => null);
  return { updated: dates.length };
}

// ── Length-of-stay tiers (on the rate plan) ─────────────────────────────────

export async function listPlans({ propertyId }) {
  const [plans, types] = await Promise.all([
    RatePlan.find({ property: propertyId, active: { $ne: false } }).sort({ sortOrder: 1, code: 1 }).lean(),
    RoomType.find({ property: propertyId, active: { $ne: false } }).sort({ sortOrder: 1, baseRate: 1 }).select('name code baseRate').lean(),
  ]);
  return {
    roomTypes: types.map((t) => ({ id: String(t._id), name: t.name, code: t.code, baseRate: t.baseRate || null })),
    plans: plans.map((p) => ({
      id: String(p._id), code: p.code, name: p.name, type: p.type, useDayTypes: p.useDayTypes !== false, derived: !!p.derived?.from,
      tiers: (p.tiers || []).sort((a, b) => a.minNights - b.minNights).map((t) => ({ minNights: t.minNights, label: t.label || '', pct: t.pct ?? null, prices: (t.prices || []).map((x) => ({ roomTypeId: String(x.roomType), price: x.price })) })),
    })),
  };
}

export async function savePlanRevenue({ propertyId, planId, body, actor, ip }) {
  mustManage(actor);
  if (!isId(planId)) throw httpError('תעריף לא תקין', 422);
  const plan = await RatePlan.findOne({ _id: planId, property: propertyId });
  if (!plan) throw httpError('התעריף לא נמצא', 404);
  const typeIds = new Set((await RoomType.find({ property: propertyId }).select('_id').lean()).map((t) => String(t._id)));
  const raw = Array.isArray(body?.tiers) ? body.tiers.slice(0, 8) : [];
  const fields = {}; const seen = new Set();
  const tiers = raw.map((t, i) => {
    const minNights = Number(t.minNights);
    if (!(Number.isInteger(minNights) && minNights >= 2 && minNights <= 365)) fields[`tiers.${i}.minNights`] = 'מ־2 לילות ומעלה';
    if (seen.has(minNights)) fields[`tiers.${i}.minNights`] = 'מדרגה כפולה';
    seen.add(minNights);
    const pct = num(t.pct);
    if (pct !== undefined && !(pct >= -90 && pct <= 100)) fields[`tiers.${i}.pct`] = 'אחוז לא תקין';
    const prices = (Array.isArray(t.prices) ? t.prices : []).filter((x) => typeIds.has(String(x.roomTypeId)) && Number(x.price) > 0).map((x) => ({ roomType: x.roomTypeId, price: Math.round(Number(x.price) * 100) / 100 }));
    if (pct === undefined && !prices.length) fields[`tiers.${i}.pct`] = 'אחוז הנחה או מחיר לסוג חדר';
    return { minNights, label: String(t.label || '').trim().slice(0, 40) || undefined, pct, prices };
  }).sort((a, b) => a.minNights - b.minNights);
  if (Object.keys(fields).length) throw httpError('יש לתקן את המדרגות', 422, { fields });
  const before = { useDayTypes: plan.useDayTypes !== false, tiers: (plan.tiers || []).map((t) => ({ minNights: t.minNights, pct: t.pct, prices: t.prices?.length || 0 })) };
  plan.tiers = tiers;
  if (body?.useDayTypes !== undefined) plan.useDayTypes = !!body.useDayTypes;
  await plan.save();
  await log(propertyId, actor, ip, 'revenue.plan_tiers_saved', 'RatePlan', plan._id, before, { useDayTypes: plan.useDayTypes, tiers: tiers.map((t) => ({ minNights: t.minNights, pct: t.pct, prices: t.prices.length })) }, plan.code);
  return (await listPlans({ propertyId })).plans.find((p) => p.id === String(plan._id));
}

// ── Channel restrictions ────────────────────────────────────────────────────

export async function listChannelRules({ propertyId }) {
  const rows = await ChannelRule.find({ property: propertyId }).sort({ active: -1, from: 1 }).populate('ratePlans', 'code').populate('roomTypes', 'name').lean();
  return rows.map((r) => ({
    id: String(r._id), channel: r.channel, channelLabel: CHANNELS[r.channel], action: r.action, pct: r.pct ?? null, from: r.from, to: r.to, note: r.note || '', active: r.active !== false,
    ratePlans: (r.ratePlans || []).map((p) => ({ id: String(p._id), code: p.code })), roomTypes: (r.roomTypes || []).map((t) => ({ id: String(t._id), name: t.name })),
    updatedAt: r.updatedAt, updatedBy: r.updatedByName || null,
  }));
}

export async function saveChannelRule({ propertyId, id, body, actor, ip }) {
  mustManage(actor);
  const b = body || {}; const fields = {};
  if (!CHANNELS[b.channel]) fields.channel = 'בחרו ערוץ';
  if (!['close', 'discount'].includes(b.action)) fields.action = 'בחרו פעולה';
  const pct = num(b.pct);
  if (b.action === 'discount' && !(pct > 0 && pct <= 90)) fields.pct = 'אחוז בין 1 ל־90';
  if (!YMD.test(b.from || '')) fields.from = 'נדרש תאריך';
  if (!YMD.test(b.to || '') || (b.from && b.to < b.from)) fields.to = 'טווח לא תקין';
  if (Object.keys(fields).length) throw httpError('יש לתקן את ההגבלה', 422, { fields });
  const ratePlans = ids(b.ratePlans); const roomTypes = ids(b.roomTypes);
  if (ratePlans.length && await RatePlan.countDocuments({ _id: { $in: ratePlans }, property: propertyId }) !== ratePlans.length) throw httpError('תעריף לא שייך לנכס', 422);
  if (roomTypes.length && await RoomType.countDocuments({ _id: { $in: roomTypes }, property: propertyId }) !== roomTypes.length) throw httpError('סוג חדר לא שייך לנכס', 422);
  const input = { channel: b.channel, action: b.action, pct: b.action === 'discount' ? pct : undefined, from: b.from, to: b.to, ratePlans, roomTypes, note: String(b.note || '').trim().slice(0, 200), active: b.active !== false, updatedByName: actor.name };
  let doc; let before = null;
  if (id) {
    if (!isId(id)) throw httpError('הגבלה לא תקינה', 422);
    doc = await ChannelRule.findOne({ _id: id, property: propertyId });
    if (!doc) throw httpError('ההגבלה לא נמצאה', 404);
    before = { channel: doc.channel, action: doc.action, pct: doc.pct, from: doc.from, to: doc.to, active: doc.active };
    Object.assign(doc, input); await doc.save();
  } else doc = await ChannelRule.create({ property: propertyId, ...input });
  await log(propertyId, actor, ip, id ? 'revenue.channel_rule_updated' : 'revenue.channel_rule_created', 'ChannelRule', doc._id, before, { channel: input.channel, action: input.action, pct: input.pct, from: input.from, to: input.to, active: input.active }, CHANNELS[input.channel]);
  if (input.channel === 'ota') enqueueChannelUpdate({ propertyId, channel: 'all', eventType: 'restriction', payload: { action: input.active && input.action === 'close' ? 'close' : 'open', from: input.from, to: input.to, ratePlans, roomTypes }, idempotencyKey: `chrule:${doc._id}:${Date.now()}` }).catch(() => null);
  return (await listChannelRules({ propertyId })).find((r) => r.id === String(doc._id));
}

// ── Strategies ──────────────────────────────────────────────────────────────

const strategyView = (s, activeCount = 0) => ({
  id: String(s._id), name: s.name, priority: s.priority, active: s.active !== false,
  roomTypes: (s.roomTypes || []).map((t) => ({ id: String(t._id || t), name: t.name || null })), ratePlans: (s.ratePlans || []).map((p) => ({ id: String(p._id || p), code: p.code || null })),
  metric: s.metric, threshold: s.threshold, action: s.action, actionLabel: ACTIONS[s.action], minLos: s.minLos ?? null,
  stayFrom: s.stayFrom || '', stayTo: s.stayTo || '', controlFrom: s.controlFrom || '', controlTo: s.controlTo || '', daysAhead: s.daysAhead, weekdays: s.weekdays || [],
  lastRunAt: s.lastRunAt || null, activeCount, updatedBy: s.updatedByName || null,
});

export async function listStrategies({ propertyId }) {
  const rows = await RevenueStrategy.find({ property: propertyId }).sort({ active: -1, priority: 1, name: 1 }).populate('roomTypes', 'name').populate('ratePlans', 'code').lean();
  const counts = new Map((await AutoRestriction.aggregate([{ $match: { property: new mongoose.Types.ObjectId(String(propertyId)), liftedAt: null } }, { $group: { _id: '$strategy', n: { $sum: 1 } } }])).map((x) => [String(x._id), x.n]));
  return rows.map((s) => strategyView(s, counts.get(String(s._id)) || 0));
}

export async function saveStrategy({ propertyId, id, body, actor, ip }) {
  mustManage(actor);
  const b = body || {}; const fields = {};
  const name = String(b.name || '').trim().slice(0, 80);
  if (name.length < 2) fields.name = 'נדרש שם';
  const metric = b.metric === 'rooms_sold' ? 'rooms_sold' : 'occupancy_pct';
  const threshold = Number(b.threshold);
  if (!(threshold >= 1 && (metric === 'rooms_sold' ? threshold <= 5000 : threshold <= 100))) fields.threshold = metric === 'rooms_sold' ? 'מספר חדרים' : 'אחוז בין 1 ל־100';
  if (!ACTIONS[b.action]) fields.action = 'בחרו פעולה';
  const minLos = num(b.minLos);
  if (b.action === 'min_los' && !(Number.isInteger(minLos) && minLos >= 2 && minLos <= 30)) fields.minLos = 'בין 2 ל־30 לילות';
  for (const k of ['stayFrom', 'stayTo', 'controlFrom', 'controlTo']) if (b[k] && !YMD.test(b[k])) fields[k] = 'תאריך לא תקין';
  if (b.stayFrom && b.stayTo && b.stayTo < b.stayFrom) fields.stayTo = 'טווח לא תקין';
  if (b.controlFrom && b.controlTo && b.controlTo < b.controlFrom) fields.controlTo = 'טווח לא תקין';
  const daysAhead = Number(b.daysAhead ?? 90);
  if (!(Number.isInteger(daysAhead) && daysAhead >= 1 && daysAhead <= 365)) fields.daysAhead = 'בין 1 ל־365';
  const priority = Number(b.priority ?? 10);
  if (!(Number.isInteger(priority) && priority >= 1 && priority <= 999)) fields.priority = 'מספר בין 1 ל־999';
  if (Object.keys(fields).length) throw httpError('יש לתקן את האסטרטגיה', 422, { fields });
  const roomTypes = ids(b.roomTypes); const ratePlans = ids(b.ratePlans);
  if (roomTypes.length && await RoomType.countDocuments({ _id: { $in: roomTypes }, property: propertyId }) !== roomTypes.length) throw httpError('סוג חדר לא שייך לנכס', 422);
  if (ratePlans.length && await RatePlan.countDocuments({ _id: { $in: ratePlans }, property: propertyId }) !== ratePlans.length) throw httpError('תעריף לא שייך לנכס', 422);
  const input = {
    name, priority, active: b.active !== false, roomTypes, ratePlans, metric, threshold, action: b.action, minLos: b.action === 'min_los' ? minLos : undefined,
    stayFrom: b.stayFrom || undefined, stayTo: b.stayTo || undefined, controlFrom: b.controlFrom || undefined, controlTo: b.controlTo || undefined, daysAhead,
    weekdays: (Array.isArray(b.weekdays) ? b.weekdays : []).map(Number).filter((x) => x >= 0 && x <= 6), updatedByName: actor.name,
  };
  let doc; let before = null;
  if (id) {
    if (!isId(id)) throw httpError('אסטרטגיה לא תקינה', 422);
    doc = await RevenueStrategy.findOne({ _id: id, property: propertyId });
    if (!doc) throw httpError('האסטרטגיה לא נמצאה', 404);
    before = { threshold: doc.threshold, metric: doc.metric, action: doc.action, minLos: doc.minLos, active: doc.active };
    Object.assign(doc, input); await doc.save();
  } else doc = await RevenueStrategy.create({ property: propertyId, ...input });
  await log(propertyId, actor, ip, id ? 'revenue.strategy_updated' : 'revenue.strategy_created', 'RevenueStrategy', doc._id, before, { threshold, metric, action: input.action, minLos: input.minLos, active: input.active }, name);
  // Changes apply at once: lift what the old definition placed and re-check.
  await AutoRestriction.updateMany({ strategy: doc._id, liftedAt: null }, { $set: { liftedAt: new Date() } });
  await runStrategies({ propertyId });
  return (await listStrategies({ propertyId })).find((s) => s.id === String(doc._id));
}

// Rooms sold per date (hotel and per room type), the way the demand screen counts: live stays + group holds.
async function occupancyByDate({ propertyId, dates }) {
  if (!dates.length) return new Map();
  const from = dates[0]; const to = addDays(dates[dates.length - 1], 1);
  const [rooms, stays, inv] = await Promise.all([
    Room.aggregate([{ $match: { property: new mongoose.Types.ObjectId(String(propertyId)), active: { $ne: false } } }, { $group: { _id: '$roomType', n: { $sum: 1 } } }]),
    Reservation.find({ property: propertyId, status: { $in: LIVE }, arrivalDate: { $lt: to }, departureDate: { $gt: from } }).select('arrivalDate departureDate roomsCount roomType status').lean(),
    InventoryDate.find({ property: propertyId, date: { $gte: from, $lt: to } }).select('date roomType groupAllotmentCount blockedCount').lean(),
  ]);
  const roomsBy = new Map(rooms.map((r) => [String(r._id), r.n]));
  const total = rooms.reduce((s, r) => s + r.n, 0);
  const out = new Map();
  for (const d of dates) {
    const types = new Map();
    const bump = (t, k, n) => { const key = String(t); if (!types.has(key)) types.set(key, { sold: 0, blocked: 0 }); types.get(key)[k] += n; };
    for (const s of stays) if (s.arrivalDate <= d && d < s.departureDate && s.status !== 'checked_out') bump(s.roomType, 'sold', s.roomsCount || 1);
    for (const x of inv) if (x.date === d) { bump(x.roomType, 'sold', x.groupAllotmentCount || 0); bump(x.roomType, 'blocked', x.blockedCount || 0); }
    const byType = new Map();
    let sold = 0; let blocked = 0;
    for (const [t, v] of types) { sold += v.sold; blocked += v.blocked; }
    for (const [t, n] of roomsBy) {
      const v = types.get(t) || { sold: 0, blocked: 0 };
      const cap = Math.max(0, n - v.blocked);
      byType.set(t, { sold: v.sold, rooms: cap, pct: cap ? Math.round((v.sold / cap) * 100) : 0 });
    }
    const cap = Math.max(0, total - blocked);
    out.set(d, { hotel: { sold, rooms: cap, pct: cap ? Math.round((sold / cap) * 100) : 0 }, byType });
  }
  return out;
}

// Check every active strategy of a property: place restrictions on nights that meet the condition,
// lift those whose night no longer meets it (or left the window). Returns { placed, lifted }.
export async function runStrategies({ propertyId, now = new Date() }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  if (!property) return { placed: 0, lifted: 0 };
  const today = businessDateOf(property);
  const strategies = await RevenueStrategy.find({ property: propertyId }).lean();
  const open = await AutoRestriction.find({ property: propertyId, liftedAt: null }).lean();
  const maxAhead = Math.max(1, ...strategies.filter((s) => s.active !== false).map((s) => s.daysAhead || 90));
  const dates = Array.from({ length: Math.min(366, maxAhead) }, (_, i) => addDays(today, i));
  const occ = await occupancyByDate({ propertyId, dates });
  let placed = 0; let lifted = 0;
  const keyOf = (sid, date, rt) => `${sid}|${date}|${rt || ''}`;
  const openBy = new Map(open.map((a) => [keyOf(a.strategy, a.date, a.roomType), a]));
  const keep = new Set();
  for (const s of strategies) {
    const live = s.active !== false && (!s.controlFrom || today >= s.controlFrom) && (!s.controlTo || today <= s.controlTo);
    if (!live) continue;
    const window = dates.slice(0, s.daysAhead || 90).filter((d) => (!s.stayFrom || d >= s.stayFrom) && (!s.stayTo || d <= s.stayTo) && (!s.weekdays?.length || s.weekdays.includes(weekday(d))));
    const targets = s.roomTypes?.length ? s.roomTypes.map(String) : [null];
    for (const d of window) {
      const o = occ.get(d);
      for (const rt of targets) {
        const m = rt ? o?.byType.get(rt) : o?.hotel;
        if (!m) continue;
        const value = s.metric === 'rooms_sold' ? m.sold : m.pct;
        const k = keyOf(s._id, d, rt);
        if (value >= s.threshold) {
          keep.add(k);
          if (!openBy.has(k)) {
            await AutoRestriction.create({ property: propertyId, strategy: s._id, strategyName: s.name, priority: s.priority, date: d, roomType: rt || undefined, ratePlans: s.ratePlans || [], action: s.action, minLos: s.minLos, measured: value });
            placed += 1;
          }
        } else if (openBy.has(k)) {
          await AutoRestriction.updateOne({ _id: openBy.get(k)._id }, { $set: { liftedAt: now, liftedMeasured: value } });
          lifted += 1; keep.add(k);
        }
      }
    }
    await RevenueStrategy.updateOne({ _id: s._id }, { $set: { lastRunAt: now } });
  }
  // Restrictions of strategies that were turned off, or nights that left the window / passed.
  const stale = open.filter((a) => !keep.has(keyOf(a.strategy, a.date, a.roomType)));
  if (stale.length) { await AutoRestriction.updateMany({ _id: { $in: stale.map((a) => a._id) } }, { $set: { liftedAt: now } }); lifted += stale.length; }
  if (placed || lifted) {
    await audit({ property: propertyId, actor: null, actorName: 'מערכת', action: 'revenue.strategies_run', entityType: 'Property', entityId: propertyId, after: { placed, lifted }, reason: 'אסטרטגיה אוטומטית' });
    enqueueChannelUpdate({ propertyId, channel: 'all', eventType: 'restriction', payload: { action: 'strategy', placed, lifted }, idempotencyKey: `strategy:${propertyId}:${now.getTime()}` }).catch(() => null);
  }
  return { placed, lifted };
}

export async function runAllStrategies() {
  const props = await RevenueStrategy.distinct('property', { active: { $ne: false } });
  const withOpen = await AutoRestriction.distinct('property', { liftedAt: null });
  for (const p of new Set([...props, ...withOpen].map(String))) await runStrategies({ propertyId: p }).catch((e) => console.error('[revenue] strategies', p, e.message));
}

// ── Manual restriction history ("set" vs "active now") ──────────────────────

// Restriction part of a RateDate / InventoryDate row, in one shape.
export function restrictionOf(row, level) {
  if (!row) return { stopSell: false, cta: false, ctd: false, minLos: 1, maxLos: null };
  return {
    stopSell: !!row.stopSell,
    cta: !!(level === 'inventory' ? row.closedToArrival : row.cta),
    ctd: !!(level === 'inventory' ? row.closedToDeparture : row.ctd),
    minLos: Number(row.minLos) || 1,
    maxLos: Number(row.maxLos) || null,
  };
}
const sameRestriction = (a, b) => ['stopSell', 'cta', 'ctd', 'minLos', 'maxLos'].every((k) => (a[k] ?? null) === (b[k] ?? null));

// Called by the rate / inventory routes with the rows before and after a write; logs only nights that changed.
export async function logRestrictionChanges({ propertyId, level, ratePlan = null, roomType, beforeRows, afterRows, actor }) {
  const before = new Map((beforeRows || []).map((r) => [r.date, restrictionOf(r, level)]));
  const docs = [];
  for (const r of afterRows || []) {
    const a = restrictionOf(r, level); const b = before.get(r.date) || restrictionOf(null, level);
    if (!sameRestriction(a, b)) docs.push({ property: propertyId, level, ratePlan: ratePlan || undefined, roomType, date: r.date, before: b, after: a, by: isId(actor?.id) ? actor.id : undefined, byName: actor?.name || 'system' });
  }
  if (docs.length) await RestrictionLog.insertMany(docs, { ordered: false }).catch((e) => console.error('[revenue] restriction log', e.message));
  return docs.length;
}

const describe = (x) => {
  if (!x) return '—';
  const parts = [];
  if (x.stopSell) parts.push('סגור למכירה');
  if (x.cta) parts.push('סגור להגעה');
  if (x.ctd) parts.push('סגור לעזיבה');
  if (Number(x.minLos) > 1) parts.push(`מינ׳ ${x.minLos}`);
  if (Number(x.maxLos) > 0) parts.push(`מקס׳ ${x.maxLos}`);
  return parts.join(' · ') || 'פתוח';
};

export async function manualRestrictionLog({ propertyId, limit = 100 }) {
  const rows = await RestrictionLog.find({ property: propertyId }).sort({ at: -1 }).limit(Math.min(300, Number(limit) || 100)).populate('ratePlan', 'code').populate('roomType', 'name').lean();
  // What is active now on each of those nights, for the "set vs active" view.
  const rateKeys = rows.filter((r) => r.level === 'rate' && r.ratePlan && r.roomType);
  const invKeys = rows.filter((r) => r.level === 'inventory' && r.roomType);
  const [rds, invs] = await Promise.all([
    rateKeys.length ? RateDate.find({ $or: rateKeys.map((r) => ({ ratePlan: r.ratePlan._id, roomType: r.roomType._id, date: r.date })) }).lean() : [],
    invKeys.length ? InventoryDate.find({ property: propertyId, $or: invKeys.map((r) => ({ roomType: r.roomType._id, date: r.date })) }).lean() : [],
  ]);
  const rdBy = new Map(rds.map((x) => [`${x.ratePlan}|${x.roomType}|${x.date}`, x]));
  const invBy = new Map(invs.map((x) => [`${x.roomType}|${x.date}`, x]));
  return rows.map((r) => {
    const cur = r.level === 'rate' ? rdBy.get(`${r.ratePlan?._id}|${r.roomType?._id}|${r.date}`) : invBy.get(`${r.roomType?._id}|${r.date}`);
    const now = restrictionOf(cur, r.level);
    return {
      id: String(r._id), date: r.date, level: r.level, ratePlan: r.ratePlan?.code || null, roomType: r.roomType?.name || null,
      before: describe(r.before), after: describe(r.after), now: describe(now), changedSince: !sameRestriction(now, { maxLos: null, ...r.after }),
      by: r.byName || '—', at: r.at,
    };
  });
}

// History: restrictions placed by strategies (active + lifted), newest first.
export async function restrictionLog({ propertyId, limit = 200, activeOnly = false }) {
  const rows = await AutoRestriction.find({ property: propertyId, ...(activeOnly ? { liftedAt: null } : {}) }).sort({ placedAt: -1 }).limit(Math.min(500, Number(limit) || 200)).populate('roomType', 'name').lean();
  return rows.map((a) => ({
    id: String(a._id), date: a.date, strategy: a.strategyName, action: a.action, label: ACTIONS[a.action], minLos: a.minLos || null, roomType: a.roomType?.name || null,
    measured: a.measured, placedAt: a.placedAt, liftedAt: a.liftedAt || null, liftedMeasured: a.liftedMeasured ?? null,
  }));
}
