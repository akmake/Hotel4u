// Code lists the hotel manages (gap-map item 13). Every list starts from the system defaults; the hotel
// renames, deactivates or adds codes. Other modules ask here instead of using their hard-coded constants:
//   reasonMap(propertyId, 'reason_discount')  → { code: label } of the active codes
//   vipServices(propertyId, level)            → special-service codes added automatically for a VIP level
//   languageFor(propertyId, nationality)      → default guest language
//   seasonRanges(propertyId)                  → { code: [{ from, to }] } used by price rules
//   autoSegment(propertyId, { source, ratePlanCode, companyType })
import mongoose from 'mongoose';
import CodeList from '../models/CodeList.js';
import Reservation from '../models/Reservation.js';
import GuestProfile from '../models/GuestProfile.js';
import Company from '../models/Company.js';
import { audit } from './auditService.js';
// No static imports of other services here: many services import this file, so it must not close an import cycle.
const httpError = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status }, extra);

export const CODE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const toMap = (o) => Object.entries(o).map(([code, label]) => ({ code, label }));

// list → { label, fixed (no new codes: the code drives logic), defaults() }
export const LISTS = {
  segment: { label: 'פלחי שוק', hint: 'עם כלל אוטומטי לפי מקור / תעריף / סוג חברה', defaults: async () => toMap({ leisure: 'פנאי', corporate: 'עסקי', group: 'קבוצות', website: 'אתר המלון', ota: 'ערוצים מקוונים', government: 'ממשלתי', wholesale: 'סיטונאים' }) },
  source: { label: 'מקורות הזמנה', fixed: true, defaults: async () => toMap({ direct: 'ישיר', phone: 'טלפון', walk_in: 'הגיע ללא הזמנה', corporate: 'חברות', agent: 'סוכנים', booking: 'Booking.com', expedia: 'Expedia', agoda: 'Agoda', airbnb: 'Airbnb', gds: 'GDS' }) },
  reason_cancel: { label: 'סיבות ביטול', defaults: async () => toMap({ customer_request: 'בקשת לקוח', regret: 'חרטה', no_availability: 'אין זמינות', ota_cancellation: 'ביטול בערוץ', service_failure: 'כשל שירות / אי־התאמה', no_payment: 'אין תשלום', duplicate: 'הזמנה כפולה', other: 'אחר' }) },
  reason_delete: { label: 'סיבות מחיקה', defaults: async () => toMap((await import('./reservationService.js')).DELETE_REASONS) },
  reason_discount: { label: 'סיבות הנחה ומחיר ידני', defaults: async () => toMap((await import('./bookingService.js')).DISCOUNT_REASONS) },
  reason_refund: { label: 'סיבות החזר', defaults: async () => toMap((await import('./financeService.js')).REFUND_REASONS) },
  reason_turnaway: { label: 'סיבות לפנייה שנדחתה', defaults: async () => toMap((await import('../models/TurnAway.js')).TURNAWAY_REASONS) },
  reason_move: { label: 'סיבות החלפת חדר ושדרוג', defaults: async () => toMap((await import('./stayChangeService.js')).MOVE_REASONS) },
  special_service: { label: 'שירותים מיוחדים', defaults: async () => toMap({ cot: 'מיטת תינוק', extra_bed: 'מיטה נוספת', flowers: 'פרחים בחדר', cake: 'עוגה ובקבוק יין', fruit: 'סלסלת פירות', transfer: 'הסעה', accessible: 'חדר נגיש', late_checkout: 'יציאה מאוחרת', early_checkin: 'כניסה מוקדמת', welcome_call: 'שיחת היכרות מהמנהל' }) },
  vip: { label: 'רמות VIP', fixed: true, hint: 'לכל רמה: שירותים שנוספים אוטומטית להזמנה', defaults: async () => [1, 2, 3, 4, 5].map((n) => ({ code: String(n), label: `VIP ${n}`, extra: { services: n >= 3 ? ['fruit', 'welcome_call'] : n >= 1 ? ['fruit'] : [] } })) },
  trace_text: { label: 'נוסחי Traces', defaults: async () => (await import('./deskService.js')).TRACE_TEMPLATES.map((label, i) => ({ code: `t${i + 1}`, label })) },
  note_type: { label: 'סוגי הערות', defaults: async () => toMap({ general: 'כללית', reservation: 'להזמנה (מועתקת לכל הזמנה חדשה)', billing: 'לחשבון', housekeeping: 'למשק בית', front_desk: 'לקבלה' }) },
  preference: { label: 'העדפות אורח', defaults: async () => toMap({ quiet_room: 'חדר שקט', high_floor: 'קומה גבוהה', near_elevator: 'קרוב למעלית', twin_beds: 'מיטות נפרדות', no_feather: 'בלי נוצות', sea_view: 'נוף לים' }) },
  season: { label: 'עונות', hint: 'טווחי תאריכים; כלל מחיר יכול להפנות לעונה', defaults: async () => [] },
  language_by_nationality: { label: 'שפה לפי לאום', hint: 'קוד מדינה (IL, US…) → שפת ברירת מחדל', defaults: async () => [{ code: 'IL', label: 'he' }, { code: 'US', label: 'en' }, { code: 'GB', label: 'en' }, { code: 'RU', label: 'ru' }, { code: 'FR', label: 'fr' }, { code: 'DE', label: 'de' }] },
};

const mustManage = async (actor) => { const { can } = await import('./permissionService.js'); if (!can(actor, 'codes.manage', CODE_ROLES)) throw httpError('רשימות קוד — למנהל הנכס', 403); };

// The merged list: defaults overridden by stored rows, plus the hotel's own codes.
export async function getList(propertyId, list, { activeOnly = false } = {}) {
  const def = LISTS[list];
  if (!def) throw httpError('רשימה לא מוכרת', 404);
  const [defaults, rows] = await Promise.all([def.defaults(), CodeList.find({ property: propertyId, list }).lean()]);
  const stored = new Map(rows.map((r) => [r.code, r]));
  const out = defaults.map((d, i) => {
    const s = stored.get(d.code);
    return { code: d.code, label: s?.label || d.label, active: s ? s.active !== false : true, sortOrder: s?.sortOrder ?? i, extra: s?.extra ?? d.extra ?? null, builtIn: true };
  });
  for (const r of rows) if (!defaults.some((d) => d.code === r.code)) out.push({ code: r.code, label: r.label, active: r.active !== false, sortOrder: r.sortOrder ?? 100, extra: r.extra ?? null, builtIn: false });
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return activeOnly ? out.filter((x) => x.active) : out;
}

export async function allLists(propertyId) {
  const out = [];
  for (const [list, def] of Object.entries(LISTS)) out.push({ list, label: def.label, hint: def.hint || '', fixed: !!def.fixed, items: await getList(propertyId, list) });
  return out;
}

export async function reasonMap(propertyId, list) {
  const items = await getList(propertyId, list, { activeOnly: true });
  return Object.fromEntries(items.map((x) => [x.code, x.label]));
}

function cleanExtra(list, extra, errors) {
  if (extra == null) return undefined;
  if (list === 'vip') return { services: [...new Set((extra.services || []).map(String))].slice(0, 20) };
  if (list === 'season') {
    const ranges = (extra.ranges || []).filter((r) => r && (r.from || r.to));
    if (!ranges.length || ranges.some((r) => !YMD.test(r.from || '') || !YMD.test(r.to || '') || r.to < r.from)) { errors.extra = 'טווח תאריכים תקין לכל עונה'; return undefined; }
    return { ranges: ranges.map((r) => ({ from: r.from, to: r.to })).slice(0, 20) };
  }
  if (list === 'segment') {
    const pick = (a) => [...new Set((a || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 30);
    return { sources: pick(extra.sources), ratePlans: pick(extra.ratePlans).map((x) => x.toUpperCase()), companyTypes: pick(extra.companyTypes) };
  }
  return undefined;
}

export async function saveItem({ propertyId, list, code, body, actor, ip }) {
  await mustManage(actor);
  const def = LISTS[list];
  if (!def) throw httpError('רשימה לא מוכרת', 404);
  const c = String(code || body?.code || '').trim();
  const errors = {};
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(c)) errors.code = 'קוד באנגלית או ספרות';
  const defaults = await def.defaults();
  const isDefault = defaults.some((d) => d.code === c);
  if (def.fixed && !isDefault) errors.code = 'ברשימה הזו אפשר רק לשנות שם או להשבית — הקודים קבועים';
  const label = String(body?.label || '').trim().slice(0, 120);
  if (!label) errors.label = 'שם חובה';
  if (list === 'language_by_nationality' && !/^[a-z]{2}$/.test(label)) errors.label = 'קוד שפה בשתי אותיות (he, en, ru…)';
  if (list === 'language_by_nationality' && !/^[A-Z]{2}$/.test(c)) errors.code = 'קוד מדינה בשתי אותיות גדולות (IL, US…)';
  const extra = cleanExtra(list, body?.extra, errors);
  if (list === 'vip' && extra) {
    const services = new Set((await getList(propertyId, 'special_service')).map((x) => x.code));
    if (extra.services.some((x) => !services.has(x))) errors.extra = 'שירות לא קיים ברשימת השירותים המיוחדים';
  }
  if (Object.keys(errors).length) throw httpError('יש לתקן את הפריט', 422, { fields: errors });
  const before = await CodeList.findOne({ property: propertyId, list, code: c }).lean();
  const set = { label, active: body?.active !== false, ...(body?.sortOrder != null ? { sortOrder: Number(body.sortOrder) } : {}), ...(extra !== undefined ? { extra } : {}), updatedByName: actor.name };
  await CodeList.updateOne({ property: propertyId, list, code: c }, { $set: set, $setOnInsert: { property: propertyId, list, code: c } }, { upsert: true });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: before ? 'codes.update' : 'codes.create', entityType: 'CodeList', entityId: undefined, before: before ? { list, code: c, label: before.label, active: before.active } : null, after: { list, code: c, label, active: set.active }, ip });
  return (await getList(propertyId, list)).find((x) => x.code === c);
}

// ── Helpers for other modules ──────────────────────────────────────────────

export async function vipServices(propertyId, level) {
  if (!(Number(level) > 0)) return [];
  const vip = (await getList(propertyId, 'vip', { activeOnly: true })).find((x) => x.code === String(level));
  const services = await getList(propertyId, 'special_service', { activeOnly: true });
  return (vip?.extra?.services || []).map((code) => services.find((s) => s.code === code)).filter(Boolean).map((s) => ({ code: s.code, label: s.label }));
}

export async function languageFor(propertyId, nationality) {
  const n = String(nationality || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(n)) return null;
  return (await getList(propertyId, 'language_by_nationality', { activeOnly: true })).find((x) => x.code === n)?.label || null;
}

export async function seasonRanges(propertyId) {
  const items = await getList(propertyId, 'season', { activeOnly: true });
  return Object.fromEntries(items.map((s) => [s.code, s.extra?.ranges || []]));
}

export async function autoSegment(propertyId, { source, ratePlanCode, companyType }) {
  const items = await getList(propertyId, 'segment', { activeOnly: true });
  const hit = items.find((s) => {
    const r = s.extra || {};
    return (source && r.sources?.includes(source)) || (ratePlanCode && r.ratePlans?.includes(String(ratePlanCode).toUpperCase())) || (companyType && r.companyTypes?.includes(companyType));
  });
  return hit?.code || null;
}

export const isId = (v) => mongoose.isValidObjectId(String(v || ''));

// After a booking is created: VIP services, guest language, market segment by rule (none overrides a value set by hand).
export async function applyBookingDefaults({ propertyId, reservationId, session = null }) {
  const r = await Reservation.findById(reservationId).session(session).select('primaryGuest language marketSegment source company specialServices priceSnapshot').lean();
  if (!r) return;
  const g = r.primaryGuest ? await GuestProfile.findById(r.primaryGuest).session(session).select('vipLevel nationality country language notes').lean() : null;
  const set = {};
  const vip = await vipServices(propertyId, g?.vipLevel);
  const have = new Set((r.specialServices || []).map((s) => s.code));
  const add = vip.filter((s) => !have.has(s.code)).map((s) => ({ ...s, source: 'vip', byName: 'מערכת', at: new Date() }));
  if (add.length) set.specialServices = [...(r.specialServices || []), ...add];
  const lang = (g?.language && g.language !== 'he' ? g.language : null) || (await languageFor(propertyId, g?.nationality || g?.country));
  if (lang && (!r.language || r.language === 'he') && lang !== r.language) set.language = lang;
  if (!r.marketSegment) {
    const companyType = r.company ? (await Company.findById(r.company).session(session).select('type').lean())?.type : null;
    const seg = await autoSegment(propertyId, { source: r.source, ratePlanCode: r.priceSnapshot?.ratePlanCode, companyType });
    if (seg) set.marketSegment = seg;
  }
  // Profile notes of type "reservation" are copied to every new booking (gap-map item 16).
  const resNotes = (g?.notes || []).filter((n) => n.type === 'reservation').map((n) => n.text);
  if (resNotes.length) {
    const cur = (await Reservation.findById(r._id).session(session).select('guestNotes').lean())?.guestNotes || '';
    const add = resNotes.filter((t) => !cur.includes(t));
    if (add.length) set.guestNotes = [cur, ...add].filter(Boolean).join(String.fromCharCode(10)).slice(0, 2000);
  }
  if (Object.keys(set).length) await Reservation.updateOne({ _id: r._id }, { $set: set }, { session });
}
