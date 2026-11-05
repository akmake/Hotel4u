// Group programme (gap-map item 6, knowledge 14): the day-by-day schedule of a group, the meal
// catalog, copying a day, and the kitchen's weekly report.
//  - a meal comes from the catalog, in a kashrut the catalog allows for it, and must be in a hall;
//    an activity or a general item may be in a hall or in a free location (yard, lobby, bus);
//  - a hall used by something else at the same time is a warning, never a block (two groups do
//    share a hall sometimes);
//  - the kitchen day starts at 06:00: a meal between 00:00 and 05:59 belongs to the day before.
import mongoose from 'mongoose';
import GroupBlock from '../models/GroupBlock.js';
import EventBooking, { EventSpace } from '../models/Event.js';
import { MealType, GroupProgramItem, KOSHER, KOSHER_LABELS, PROGRAM_KINDS, PROGRAM_KIND_LABELS } from '../models/GroupProgram.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';

const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
export const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
export const kitchenDayOf = (date, start) => (start < '06:00' ? addDays(date, -1) : date);
const mins = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
// [start, end) in minutes from the item's date; an end at or before the start runs past midnight.
const span = (start, end) => { const s = mins(start); let e = mins(end); if (e <= s) e += 1440; return [s, e]; };
const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

// The days a group's programme may use: arrival to departure, both included.
export function groupDays(g) {
  const out = [];
  for (let d = g.arrivalDate; d <= g.departureDate; d = addDays(d, 1)) out.push(d);
  return out;
}

// ── Meal catalog ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_MEALS = [
  { name: 'ארוחת בוקר', kosher: ['dairy', 'parve'] },
  { name: 'ארוחת צהריים', kosher: ['meat', 'dairy', 'parve'] },
  { name: 'ארוחת ערב', kosher: ['meat', 'dairy', 'parve'] },
  { name: 'ארוחה קלה', kosher: ['dairy', 'parve'] },
  { name: 'ארוחה קלה בערב', kosher: ['dairy', 'parve'] },
  { name: 'פינוקי לילה', kosher: ['dairy', 'parve'] },
];

export async function listMealTypes({ propertyId, all = false }) {
  if (!(await MealType.exists({ property: propertyId }))) {
    await MealType.insertMany(DEFAULT_MEALS.map((m, i) => ({ ...m, property: propertyId, sortOrder: i + 1 })), { ordered: false }).catch(() => null);
  }
  const rows = await MealType.find({ property: propertyId, ...(all ? {} : { active: true }) }).sort({ sortOrder: 1, name: 1 }).lean();
  return rows.map((m) => ({ id: String(m._id), name: m.name, kosher: m.kosher || [], menus: m.menus || [], sortOrder: m.sortOrder || 0, active: m.active !== false }));
}

export async function saveMealType({ propertyId, id, input, actor, ip }) {
  const name = clip(input.name, 60);
  const kosher = [...new Set((Array.isArray(input.kosher) ? input.kosher : []).filter((k) => KOSHER.includes(k)))];
  const menus = [...new Set((Array.isArray(input.menus) ? input.menus : String(input.menus || '').split('\n')).map((m) => clip(m, 80)).filter(Boolean))].slice(0, 40);
  const errors = {};
  if (name.length < 2) errors.name = 'שם הארוחה';
  if (!kosher.length) errors.kosher = 'לפחות כשרות אחת';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי הארוחה', 422, { fields: errors });
  const data = { name, kosher, menus, active: input.active !== false, sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0 };
  let row;
  try {
    if (id) {
      if (!isId(id)) throw httpError('מזהה לא תקין', 400);
      row = await MealType.findOneAndUpdate({ _id: id, property: propertyId }, { $set: data }, { new: true });
      if (!row) throw httpError('הארוחה לא נמצאה', 404);
    } else row = await MealType.create({ ...data, property: propertyId });
  } catch (err) {
    if (err?.code === 11000) throw httpError('יש כבר ארוחה בשם הזה', 409, { fields: { name: 'קיים' } });
    throw err;
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: id ? 'meal_type.updated' : 'meal_type.created', entityType: 'MealType', entityId: row._id, after: data, ip });
  return listMealTypes({ propertyId, all: true });
}

// ── Schedule ────────────────────────────────────────────────────────────────────────────────
async function loadGroup(propertyId, groupId) {
  if (!isId(groupId)) throw httpError('מזהה קבוצה לא תקין', 400);
  const g = await GroupBlock.findOne({ _id: groupId, property: propertyId }).lean();
  if (!g) throw httpError('הקבוצה לא נמצאה', 404);
  return g;
}

function itemDto(i, spaces, meals) {
  const space = i.space ? spaces.get(String(i.space)) : null;
  const meal = i.mealType ? meals.get(String(i.mealType)) : null;
  return {
    id: String(i._id), date: i.date, start: i.start, end: i.end, kind: i.kind, kindLabel: PROGRAM_KIND_LABELS[i.kind] || i.kind, title: i.title,
    spaceId: i.space ? String(i.space) : null, spaceName: space?.name || null, location: i.location || null,
    mealTypeId: i.mealType ? String(i.mealType) : null, mealTypeName: meal?.name || null, kosher: i.kosher || null, kosherLabel: KOSHER_LABELS[i.kosher] || null, menu: i.menu || null,
    pax: i.pax || 0, pricePerPax: i.pricePerPax || 0, total: round2((i.pax || 0) * (i.pricePerPax || 0)),
    kitchenNotes: i.kitchenNotes || null, notes: i.notes || null, kitchenDay: i.kitchenDay,
  };
}

async function lookups(propertyId) {
  const [spaces, meals] = await Promise.all([
    EventSpace.find({ property: propertyId }).select('name capacity active sortOrder').sort({ sortOrder: 1, name: 1 }).lean(),
    listMealTypes({ propertyId, all: true }),
  ]);
  return { spaces: new Map(spaces.map((s) => [String(s._id), s])), meals: new Map(meals.map((m) => [m.id, m])), spaceList: spaces, mealList: meals };
}

export async function getProgram({ propertyId, groupId }) {
  const g = await loadGroup(propertyId, groupId);
  const { spaces, meals, spaceList, mealList } = await lookups(propertyId);
  const items = await GroupProgramItem.find({ property: propertyId, group: g._id }).sort({ date: 1, start: 1 }).lean();
  const dtos = items.map((i) => itemDto(i, spaces, meals));
  const days = groupDays(g).map((d) => {
    const mine = dtos.filter((x) => x.date === d);
    return { date: d, items: mine, meals: mine.filter((x) => x.kind === 'meal').length, diners: mine.filter((x) => x.kind === 'meal').reduce((s, x) => s + x.pax, 0) };
  });
  return {
    group: { id: String(g._id), name: g.name, groupCode: g.groupCode, arrivalDate: g.arrivalDate, departureDate: g.departureDate, pax: g.pax || 0, minPax: g.minPax || 0, stayType: g.stayType || 'lodging', status: g.status },
    days,
    totals: { items: dtos.length, meals: dtos.filter((x) => x.kind === 'meal').length, diners: dtos.filter((x) => x.kind === 'meal').reduce((s, x) => s + x.pax, 0), amount: round2(dtos.reduce((s, x) => s + x.total, 0)) },
    options: {
      spaces: spaceList.filter((s) => s.active !== false).map((s) => ({ id: String(s._id), name: s.name, capacity: s.capacity || 0 })),
      mealTypes: mealList.filter((m) => m.active),
      kinds: PROGRAM_KINDS.map((k) => ({ value: k, label: PROGRAM_KIND_LABELS[k] })),
      kosher: KOSHER.map((k) => ({ value: k, label: KOSHER_LABELS[k] })),
    },
  };
}

// Others in the same hall at the same time: another programme item (any group) or an event booking.
export async function spaceConflicts({ propertyId, spaceId, date, start, end, excludeId }) {
  if (!isId(spaceId)) return [];
  const mine = span(start, end);
  const out = [];
  // An item that ran past midnight the day before can still be in the hall.
  const items = await GroupProgramItem.find({ property: propertyId, space: spaceId, date: { $in: [addDays(date, -1), date] }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .populate('group', 'name groupCode status').lean();
  for (const i of items) {
    if (['cancelled'].includes(i.group?.status)) continue;
    const s = span(i.start, i.end).map((m) => m + (i.date < date ? -1440 : 0));
    if (overlaps(mine, s)) out.push({ kind: 'group', label: `${i.group?.name || 'קבוצה'} · ${i.title}`, start: i.start, end: i.end });
  }
  const events = await EventBooking.find({ property: propertyId, space: spaceId, date, status: { $ne: 'cancelled' } }).select('name start end').lean();
  for (const e of events) if (overlaps(mine, span(e.start, e.end))) out.push({ kind: 'event', label: `אירוע: ${e.name}`, start: e.start, end: e.end });
  return out;
}

async function cleanItem({ propertyId, g, input, existing }) {
  const v = { ...(existing || {}), ...input };
  const errors = {};
  const days = groupDays(g);
  const date = String(v.date || '');
  if (!YMD.test(date) || !days.includes(date)) errors.date = `תאריך בתוך ימי הקבוצה (${g.arrivalDate} – ${g.departureDate})`;
  if (!HM.test(String(v.start || ''))) errors.start = 'שעת התחלה HH:MM';
  if (!HM.test(String(v.end || ''))) errors.end = 'שעת סיום HH:MM';
  else if (HM.test(String(v.start || '')) && v.end === v.start) errors.end = 'אחרי ההתחלה';
  const kind = PROGRAM_KINDS.includes(v.kind) ? v.kind : 'general';
  const { spaces, meals } = await lookups(propertyId);
  const spaceId = v.spaceId === undefined ? (existing?.space ? String(existing.space) : null) : (v.spaceId || null);
  const space = spaceId ? spaces.get(String(spaceId)) : null;
  if (spaceId && !space) errors.spaceId = 'האולם לא נמצא';
  const location = space ? undefined : clip(v.location, 80) || undefined;
  let mealType = null;
  let kosher;
  let menu;
  if (kind === 'meal') {
    const mid = v.mealTypeId === undefined ? (existing?.mealType ? String(existing.mealType) : null) : v.mealTypeId;
    mealType = mid ? meals.get(String(mid)) : null;
    if (!mealType || !mealType.active) errors.mealTypeId = 'סוג ארוחה מהקטלוג';
    kosher = v.kosher;
    if (mealType && !mealType.kosher.includes(kosher)) errors.kosher = `כשרות לארוחה זו: ${mealType.kosher.map((k) => KOSHER_LABELS[k]).join(' / ')}`;
    menu = clip(v.menu, 120) || undefined;
    if (!space) errors.spaceId = 'ארוחה מוגשת באולם';
  }
  const title = clip(v.title, 120) || mealType?.name || '';
  if (title.length < 2) errors.title = 'כותרת';
  const pax = v.pax === undefined || v.pax === '' ? (g.pax || 0) : Math.round(Number(v.pax));
  if (!(Number.isInteger(pax) && pax >= 0 && pax <= 5000)) errors.pax = 'מספר משתתפים';
  const pricePerPax = v.pricePerPax === undefined || v.pricePerPax === '' ? 0 : round2(v.pricePerPax);
  if (!(pricePerPax >= 0 && pricePerPax <= 100000)) errors.pricePerPax = 'מחיר לא תקין';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי הפריט', 422, { fields: errors });
  return {
    date, start: v.start, end: v.end, kind, title, space: space ? space._id : null, location,
    mealType: kind === 'meal' ? mealType.id : null, kosher: kind === 'meal' ? kosher : undefined, menu: kind === 'meal' ? menu : undefined,
    pax, pricePerPax, kitchenNotes: clip(v.kitchenNotes, 500) || undefined, notes: clip(v.notes, 500) || undefined,
    kitchenDay: kitchenDayOf(date, v.start),
  };
}

export async function saveProgramItem({ propertyId, groupId, itemId, input, actor, ip }) {
  const g = await loadGroup(propertyId, groupId);
  if (g.status === 'cancelled') throw httpError('הקבוצה בוטלה', 409);
  let existing = null;
  if (itemId) {
    if (!isId(itemId)) throw httpError('מזהה לא תקין', 400);
    existing = await GroupProgramItem.findOne({ _id: itemId, property: propertyId, group: g._id }).lean();
    if (!existing) throw httpError('הפריט לא נמצא', 404);
  }
  const data = await cleanItem({ propertyId, g, input: input || {}, existing });
  const row = existing
    ? await GroupProgramItem.findOneAndUpdate({ _id: existing._id }, { $set: { ...data, updatedByName: actor.name }, ...(data.location ? {} : { $unset: { location: '' } }) }, { new: true }).lean()
    : await GroupProgramItem.create({ ...data, property: propertyId, group: g._id, createdByName: actor.name });
  const warnings = data.space ? await spaceConflicts({ propertyId, spaceId: data.space, date: data.date, start: data.start, end: data.end, excludeId: row._id }) : [];
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: existing ? 'group.program_updated' : 'group.program_added', entityType: 'GroupBlock', entityId: g._id, after: { item: String(row._id), date: data.date, start: data.start, kind: data.kind, title: data.title, pax: data.pax, overlaps: warnings.length }, ip });
  const { spaces, meals } = await lookups(propertyId);
  return { item: itemDto(row.toObject?.() || row, spaces, meals), warnings };
}

export async function deleteProgramItem({ propertyId, groupId, itemId, actor, ip }) {
  const g = await loadGroup(propertyId, groupId);
  if (!isId(itemId)) throw httpError('מזהה לא תקין', 400);
  const row = await GroupProgramItem.findOneAndDelete({ _id: itemId, property: propertyId, group: g._id }).lean();
  if (!row) throw httpError('הפריט לא נמצא', 404);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.program_removed', entityType: 'GroupBlock', entityId: g._id, before: { date: row.date, start: row.start, title: row.title, kind: row.kind }, ip });
  return { removed: true };
}

// Copy chosen items of one day to another day of the group (never onto the same day).
export async function duplicateDay({ propertyId, groupId, input, actor, ip }) {
  const g = await loadGroup(propertyId, groupId);
  const { from, to } = input || {};
  const days = groupDays(g);
  if (!days.includes(from)) throw httpError('יום המקור אינו מימי הקבוצה', 422, { fields: { from: 'יום' } });
  if (!days.includes(to)) throw httpError('יום היעד אינו מימי הקבוצה', 422, { fields: { to: 'יום' } });
  if (from === to) throw httpError('אי אפשר לשכפל לאותו יום', 422, { fields: { to: 'יום אחר' } });
  const ids = Array.isArray(input.itemIds) ? input.itemIds.filter(isId) : null;
  const src = await GroupProgramItem.find({ property: propertyId, group: g._id, date: from, ...(ids ? { _id: { $in: ids } } : {}) }).lean();
  if (!src.length) throw httpError('אין פריטים לשכפול ביום שנבחר', 422);
  const copies = src.map(({ _id, createdAt, updatedAt, __v, ...rest }) => ({ ...rest, date: to, kitchenDay: kitchenDayOf(to, rest.start), createdByName: actor.name, updatedByName: undefined }));
  await GroupProgramItem.insertMany(copies);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.program_day_copied', entityType: 'GroupBlock', entityId: g._id, after: { from, to, items: copies.length }, ip });
  return { copied: copies.length };
}

// Group dates moved by the same number of days: the whole programme moves with them.
export async function shiftProgram({ propertyId, groupId, delta }) {
  if (!delta) return 0;
  const items = await GroupProgramItem.find({ property: propertyId, group: groupId }).select('date start').lean();
  if (!items.length) return 0;
  await GroupProgramItem.bulkWrite(items.map((i) => {
    const date = addDays(i.date, delta);
    return { updateOne: { filter: { _id: i._id }, update: { $set: { date, kitchenDay: kitchenDayOf(date, i.start) } } } };
  }));
  return items.length;
}
export const programCount = (propertyId, groupId) => GroupProgramItem.countDocuments({ property: propertyId, group: groupId });
export { daysBetween };

// ── Kitchen ─────────────────────────────────────────────────────────────────────────────────
// Every meal of every live group in the week, by kitchen day (06:00) or by group, with totals.
export async function kitchenReport({ propertyId, from, days = 7, by = 'day' }) {
  if (!YMD.test(String(from || ''))) throw httpError('תאריך התחלה', 422, { fields: { from: 'תאריך' } });
  const n = Math.min(31, Math.max(1, Number(days) || 7));
  const to = addDays(from, n - 1);
  const rows = await GroupProgramItem.find({ property: propertyId, kind: 'meal', kitchenDay: { $gte: from, $lte: to } })
    .populate('group', 'name groupCode status contactName').sort({ kitchenDay: 1, date: 1, start: 1 }).lean();
  const { spaces, meals } = await lookups(propertyId);
  const live = rows.filter((r) => r.group && r.group.status !== 'cancelled');
  // A night meal (before 06:00) shows at the end of its kitchen day.
  const order = (r) => `${r.kitchenDay}|${r.date === r.kitchenDay ? '0' : '1'}${r.start}`;
  live.sort((a, b) => order(a).localeCompare(order(b)));
  const meal = (r) => ({ ...itemDto(r, spaces, meals), group: { id: String(r.group._id), name: r.group.name, code: r.group.groupCode }, night: r.date !== r.kitchenDay });
  const list = live.map(meal);
  const dayList = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const mine = list.filter((m) => m.kitchenDay === d);
    dayList.push({ date: d, meals: mine, diners: mine.reduce((s, m) => s + m.pax, 0) });
  }
  const groups = [...new Map(list.map((m) => [m.group.id, m.group])).values()].map((gr) => {
    const mine = list.filter((m) => m.group.id === gr.id);
    return { ...gr, meals: mine, diners: mine.reduce((s, m) => s + m.pax, 0) };
  });
  const byKosher = Object.fromEntries(KOSHER.map((k) => [k, list.filter((m) => m.kosher === k).reduce((s, m) => s + m.pax, 0)]));
  return {
    from, to, by: by === 'group' ? 'group' : 'day',
    days: dayList, groups,
    totals: { meals: list.length, diners: list.reduce((s, m) => s + m.pax, 0), groups: groups.length, byKosher },
  };
}
