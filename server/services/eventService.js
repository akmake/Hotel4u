// Events: spaces, bookings with a no-double-booking rule per space and time, search, and a chart of
// spaces × days. A booked event can open its own house folio (outlet "events") for billing.
import mongoose from 'mongoose';
import EventBooking, { EventSpace } from '../models/Event.js';
import Company from '../models/Company.js';
import GroupBlock from '../models/GroupBlock.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { createHouseAccount } from './financeService.js';
import { getNextSequenceValue } from '../models/Counter.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const KINDS = { conference: 'כנס', meeting: 'פגישה', wedding: 'חתונה', party: 'מסיבה / אירוע', seminar: 'סמינר', other: 'אחר' };
export const SETUPS = { theatre: 'תיאטרון', classroom: 'כיתה', banquet: 'שולחנות עגולים', cocktail: 'קוקטייל', u_shape: 'צורת U', boardroom: 'שולחן ישיבות' };
export const STATUS = { tentative: 'אופציה', confirmed: 'מאושר', cancelled: 'בוטל', done: 'התקיים' };
export const EVENT_WORK = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'sales_manager', 'revenue_manager', 'receptionist'];
export const EVENT_MANAGE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'sales_manager'];

// ── spaces ──────────────────────────────────────────────────────────────────
const spaceDto = (s) => ({ id: String(s._id), name: s.name, capacity: s.capacity || 0, setups: s.setups || [], pricePerDay: s.pricePerDay ?? null, note: s.note || null, active: s.active !== false, sortOrder: s.sortOrder || 0 });

export async function listSpaces({ propertyId, all = false }) {
  const rows = await EventSpace.find({ property: propertyId, ...(all ? {} : { active: { $ne: false } }) }).sort({ sortOrder: 1, name: 1 }).lean();
  return { rows: rows.map(spaceDto), setups: SETUPS, kinds: KINDS };
}

export async function saveSpace({ propertyId, id, input, actor, ip }) {
  if (!EVENT_MANAGE.includes(actor.role)) throw httpError('ניהול אולמות — למנהל או למכירות', 403);
  const b = input || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const errors = {};
  if (name.length < 2) errors.name = 'שם האולם';
  const capacity = Number(b.capacity || 0);
  if (!(Number.isInteger(capacity) && capacity >= 0 && capacity <= 10000)) errors.capacity = 'מספר אנשים';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי האולם', 422, { fields: errors });
  const data = { name, capacity, setups: (Array.isArray(b.setups) ? b.setups : []).filter((x) => SETUPS[x]), pricePerDay: Number(b.pricePerDay) > 0 ? round2(b.pricePerDay) : undefined, note: String(b.note || '').trim().slice(0, 300) || undefined, active: b.active !== false, sortOrder: Number(b.sortOrder || 0) };
  let doc;
  try {
    if (id) {
      if (!isId(id)) throw httpError('מזהה לא תקין', 400);
      doc = await EventSpace.findOneAndUpdate({ _id: id, property: propertyId }, { $set: data }, { new: true });
      if (!doc) throw httpError('האולם לא נמצא', 404);
    } else doc = await EventSpace.create({ ...data, property: propertyId });
  } catch (e) { if (e?.code === 11000) throw httpError('כבר יש אולם בשם הזה', 409, { fields: { name: 'קיים' } }); throw e; }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: id ? 'event_space.updated' : 'event_space.created', entityType: 'EventSpace', entityId: doc._id, after: { name, capacity }, ip });
  return spaceDto(doc.toObject());
}

// ── bookings ────────────────────────────────────────────────────────────────
function eventDto(e, spaces) {
  const sp = spaces?.get(String(e.space));
  const total = round2((e.items || []).reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0));
  return {
    id: String(e._id), number: e.number, name: e.name, kind: e.kind, kindLabel: KINDS[e.kind] || e.kind,
    spaceId: String(e.space), spaceName: sp?.name || '—', capacity: sp?.capacity || 0,
    date: e.date, start: e.start, end: e.end, attendees: e.attendees || 0, setup: e.setup || null, setupLabel: SETUPS[e.setup] || null,
    status: e.status, statusLabel: STATUS[e.status] || e.status, client: e.client || {}, companyId: e.company ? String(e.company._id || e.company) : null, companyName: e.company?.name || null,
    groupBlockId: e.groupBlock ? String(e.groupBlock._id || e.groupBlock) : null, groupName: e.groupBlock?.name || null,
    items: (e.items || []).map((i) => ({ id: String(i._id), description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: round2(i.quantity * i.unitPrice) })),
    total, notes: e.notes || null, folioId: e.folio ? String(e.folio) : null, cancelReason: e.cancelReason || null,
    createdBy: e.createdByName || null, updatedAt: e.updatedAt,
  };
}

async function spaceMap(propertyId) {
  return new Map((await EventSpace.find({ property: propertyId }).lean()).map((s) => [String(s._id), s]));
}

async function validateEvent({ propertyId, input, existing = null }) {
  const b = { ...(existing ? existing.toObject() : {}), ...(input || {}) };
  const errors = {};
  const name = String(b.name || '').trim().slice(0, 120);
  if (name.length < 2) errors.name = 'שם האירוע';
  const spaceId = input?.spaceId ?? existing?.space;
  const space = isId(spaceId) ? await EventSpace.findOne({ _id: spaceId, property: propertyId }).lean() : null;
  if (!space) errors.spaceId = 'בחרו אולם';
  else if (space.active === false && String(spaceId) !== String(existing?.space || '')) errors.spaceId = 'האולם אינו פעיל';
  if (!YMD.test(b.date || '')) errors.date = 'תאריך';
  if (!HM.test(b.start || '')) errors.start = 'שעת התחלה';
  if (!HM.test(b.end || '')) errors.end = 'שעת סיום';
  else if (HM.test(b.start || '') && b.end <= b.start) errors.end = 'אחרי ההתחלה';
  const attendees = Number(b.attendees || 0);
  if (!(Number.isInteger(attendees) && attendees >= 0 && attendees <= 10000)) errors.attendees = 'מספר משתתפים';
  else if (space?.capacity && attendees > space.capacity) errors.attendees = `האולם מכיל עד ${space.capacity}`;
  const client = { name: String(b.client?.name || '').trim().slice(0, 120), phone: String(b.client?.phone || '').trim().slice(0, 30), email: String(b.client?.email || '').trim().slice(0, 120) };
  if (client.name.length < 2) errors['client.name'] = 'שם המזמין';
  let company = existing?.company || null;
  if (input?.companyId !== undefined) {
    company = null;
    if (input.companyId) { company = isId(input.companyId) ? (await Company.findOne({ _id: input.companyId, property: propertyId }).select('_id').lean())?._id : null; if (!company) errors.companyId = 'החברה לא נמצאה'; }
  }
  let groupBlock = existing?.groupBlock || null;
  if (input?.groupBlockId !== undefined) {
    groupBlock = null;
    if (input.groupBlockId) { groupBlock = isId(input.groupBlockId) ? (await GroupBlock.findOne({ _id: input.groupBlockId, property: propertyId }).select('_id').lean())?._id : null; if (!groupBlock) errors.groupBlockId = 'הקבוצה לא נמצאה'; }
  }
  const items = (Array.isArray(input?.items) ? input.items : existing?.items || []).slice(0, 60).map((i) => ({ description: String(i.description || '').trim().slice(0, 160), quantity: Number(i.quantity || 0), unitPrice: round2(i.unitPrice || 0) })).filter((i) => i.description);
  if (items.some((i) => !(i.quantity > 0) || i.unitPrice < 0)) errors.items = 'כמות חיובית ומחיר 0 ומעלה';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי האירוע', 422, { fields: errors });
  return {
    name, kind: KINDS[b.kind] ? b.kind : 'meeting', space: space._id, date: b.date, start: b.start, end: b.end, attendees,
    setup: SETUPS[b.setup] ? b.setup : undefined, client, company, groupBlock, items, notes: String(b.notes || '').trim().slice(0, 2000) || undefined,
    status: ['tentative', 'confirmed'].includes(input?.status) ? input.status : existing?.status || 'tentative',
  };
}

async function assertFree(propertyId, data, excludeId = null) {
  const clash = await EventBooking.findOne({
    property: propertyId, space: data.space, date: data.date, status: { $in: ['tentative', 'confirmed'] },
    start: { $lt: data.end }, end: { $gt: data.start }, ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean();
  if (clash) throw httpError(`האולם תפוס ${clash.start}–${clash.end}: ${clash.name} (${clash.number})`, 409, { code: 'space_taken', fields: { start: 'חפיפה' } });
}

export async function createEvent({ propertyId, input, actor, ip }) {
  const data = await validateEvent({ propertyId, input });
  await assertFree(propertyId, data);
  const seq = await getNextSequenceValue(`event:${propertyId}`);
  const e = await EventBooking.create({ ...data, property: propertyId, number: `EV-${String(seq).padStart(5, '0')}`, createdByName: actor.name });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'event.created', entityType: 'EventBooking', entityId: e._id, after: { number: e.number, name: data.name, date: data.date, start: data.start, end: data.end }, ip });
  return getEvent({ propertyId, id: String(e._id) });
}

export async function updateEvent({ propertyId, id, input, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const e = await EventBooking.findOne({ _id: id, property: propertyId });
  if (!e) throw httpError('האירוע לא נמצא', 404);
  if (['cancelled', 'done'].includes(e.status)) throw httpError('אירוע שבוטל או התקיים אינו ניתן לעריכה', 409);
  const data = await validateEvent({ propertyId, input, existing: e });
  await assertFree(propertyId, data, e._id);
  Object.assign(e, data, { updatedByName: actor.name });
  await e.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'event.updated', entityType: 'EventBooking', entityId: e._id, after: { date: data.date, start: data.start, end: data.end, status: data.status }, ip });
  return getEvent({ propertyId, id });
}

export async function setEventStatus({ propertyId, id, status, reason, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const e = await EventBooking.findOne({ _id: id, property: propertyId });
  if (!e) throw httpError('האירוע לא נמצא', 404);
  if (status === 'cancelled') {
    const why = String(reason || '').trim().slice(0, 300);
    if (why.length < 3) throw httpError('ביטול מחייב סיבה', 422, { fields: { reason: 'סיבה' } });
    e.cancelReason = why;
  } else if (status === 'confirmed') {
    if (e.status !== 'tentative') throw httpError('רק אופציה מאושרת', 409);
  } else if (status === 'done') {
    if (e.status !== 'confirmed') throw httpError('רק אירוע מאושר מסומן כהתקיים', 409);
  } else throw httpError('מצב לא מוכר', 422);
  e.status = status; e.updatedByName = actor.name;
  await e.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `event.${status}`, entityType: 'EventBooking', entityId: e._id, reason: reason || undefined, ip });
  return getEvent({ propertyId, id });
}

export async function openEventFolio({ propertyId, id, actor, ip }) {
  const e = await EventBooking.findOne({ _id: id, property: propertyId });
  if (!e) throw httpError('האירוע לא נמצא', 404);
  if (e.folio) return { folioId: String(e.folio), duplicate: true };
  if (e.status === 'cancelled') throw httpError('האירוע בוטל', 409);
  const out = await createHouseAccount({ propertyId, input: { name: `${e.name} · ${e.client?.name || ''}`.trim(), phone: e.client?.phone, email: e.client?.email, companyId: e.company ? String(e.company) : undefined, outlet: 'events', note: `אירוע ${e.number} · ${e.date}` }, actor, ip });
  e.folio = out.id;
  await e.save();
  return { folioId: out.id, number: out.number };
}

export async function getEvent({ propertyId, id }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const e = await EventBooking.findOne({ _id: id, property: propertyId }).populate('company', 'name').populate('groupBlock', 'name groupCode').lean();
  if (!e) throw httpError('האירוע לא נמצא', 404);
  return eventDto(e, await spaceMap(propertyId));
}

export async function searchEvents({ propertyId, from, to, q, status, spaceId }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const f = YMD.test(from || '') ? from : today;
  const t = YMD.test(to || '') ? to : addDays(f, 60);
  const filter = { property: propertyId, date: { $gte: f, $lte: t } };
  if (status && STATUS[status]) filter.status = status; else filter.status = { $ne: 'cancelled' };
  if (isId(spaceId)) filter.space = spaceId;
  if (q) {
    const rx = new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { number: rx }, { 'client.name': rx }, { 'client.phone': rx }];
  }
  const [rows, spaces] = await Promise.all([EventBooking.find(filter).populate('company', 'name').sort({ date: 1, start: 1 }).limit(500).lean(), spaceMap(propertyId)]);
  return { today, from: f, to: t, rows: rows.map((e) => eventDto(e, spaces)) };
}

// Spaces × days, each cell the events in that space that day.
export async function eventsChart({ propertyId, from, days = 14 }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const start = YMD.test(from || '') ? from : today;
  const n = Math.min(42, Math.max(1, Number(days) || 14));
  const dates = Array.from({ length: n }, (_, i) => addDays(start, i));
  const [spaces, events] = await Promise.all([
    EventSpace.find({ property: propertyId, active: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).lean(),
    EventBooking.find({ property: propertyId, date: { $gte: dates[0], $lte: dates[dates.length - 1] }, status: { $ne: 'cancelled' } }).sort({ start: 1 }).lean(),
  ]);
  const sm = new Map(spaces.map((s) => [String(s._id), s]));
  return {
    today, dates,
    spaces: spaces.map((s) => ({ ...spaceDto(s), cells: dates.map((d) => events.filter((e) => String(e.space) === String(s._id) && e.date === d).map((e) => ({ id: String(e._id), name: e.name, start: e.start, end: e.end, status: e.status, attendees: e.attendees || 0, client: e.client?.name || '' }))) })),
    totals: dates.map((d) => ({ date: d, events: events.filter((e) => e.date === d).length, people: events.filter((e) => e.date === d).reduce((s, e) => s + (e.attendees || 0), 0) })),
    unplaced: events.filter((e) => !sm.has(String(e.space))).length,
  };
}
