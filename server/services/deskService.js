// Front-desk communication (gap-map item 4): guest messages, alerts, traces, wake-up calls, locators,
// the shift log book, the phone book and the operator's guest search. Everything is per property,
// audited, and a record is closed (done / no answer / cancelled) — never deleted.
import { getList } from './codeListService.js';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { DeskItem, PhoneBookEntry, DESK_KINDS } from '../models/DeskItem.js';
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf, IN_HOUSE_STATUSES, MANAGER_ROLES } from './frontDeskService.js';

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const DESK_ROLES = [...MANAGER_ROLES, 'receptionist', 'cashier'];
export const TRACE_DEPARTMENTS = { front_desk: 'קבלה', housekeeping: 'משק בית', maintenance: 'תחזוקה', fnb: 'מזון ומשקאות', concierge: 'קונסיירז׳', management: 'הנהלה', sales: 'מכירות' };
// Who sees which department's traces (a department user sees only theirs; the desk sees all).
const DEPT_OF_ROLE = { housekeeping_manager: 'housekeeping', housekeeper: 'housekeeping', maintenance_manager: 'maintenance', technician: 'maintenance', sales_manager: 'sales', revenue_manager: 'management' };
export const TRACE_TEMPLATES = ['פרחים בחדר ביום ההגעה', 'עוגה ובקבוק יין — יום הולדת', 'מיטת תינוק בחדר', 'לבדוק תעודת סטודנט', 'כרית נוספת', 'להתקשר לאורח לפני ההגעה', 'הסעה משדה התעופה'];
export const PHONE_CATEGORIES = { car_hire: 'השכרת רכב', restaurants: 'מסעדות', transport: 'תחבורה ומוניות', attractions: 'אטרקציות וסיורים', medical: 'רפואה ובתי מרקחת', emergency: 'חירום', services: 'שירותים', other: 'אחר' };
const ALERT_ON = ['check_in', 'check_out', 'open'];
const MAX_WAKE_DAYS = 31;

async function loadProperty(propertyId) {
  return Property.findById(propertyId).select('timezone dayClose').lean();
}

// Reservation in scope + the snapshot shown on the desk (room, guest).
async function stayOf(propertyId, reservationId) {
  if (!isId(String(reservationId || ''))) throw httpError('יש לבחור הזמנה', 422, { fields: { reservation: 'הזמנה' } });
  const r = await Reservation.findOne({ _id: reservationId, property: propertyId }).select('status group assignedRoom primaryGuest arrivalDate departureDate confirmationNumber')
    .populate('assignedRoom', 'number').populate('primaryGuest', 'firstName lastName').lean();
  if (!r) throw httpError('ההזמנה לא נמצאה', 404);
  return { r, roomNumber: r.assignedRoom?.number || undefined, guestName: r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : undefined };
}

export function deskDto(x) {
  return {
    id: String(x._id), kind: x.kind, reservationId: x.reservation ? String(x.reservation) : null, room: x.roomNumber || null, guest: x.guestName || null,
    text: x.text, status: x.status, from: x.from || null, fromPhone: x.fromPhone || null, deliveredHow: x.deliveredHow || null,
    on: x.on || [], department: x.department || null, fromDate: x.fromDate || null, toDate: x.toDate || null,
    date: x.date || null, time: x.time || null, series: x.series || null, until: x.until || null, important: !!x.important,
    readBy: (x.readBy || []).map((r) => r.name), createdAt: x.createdAt, createdBy: x.createdByName || null,
    closedAt: x.closedAt || null, closedBy: x.closedByName || null, closeNote: x.closeNote || null,
  };
}

const actorFields = (actor) => ({ createdBy: actor.id || undefined, createdByName: actor.name });

// ── Create (one entry point, validated per kind) ───────────────────────────
export async function createDeskItem({ propertyId, input, actor, ip }) {
  const kind = input.kind;
  if (!DESK_KINDS.includes(kind)) throw httpError('סוג רשומה לא מוכר', 422);
  const text = clip(input.text, 1000);
  const errors = {};
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  let docs = [];

  if (kind === 'logbook') {
    if (text.length < 2) errors.text = 'תוכן ההודעה';
    if (Object.keys(errors).length) throw httpError('יש להשלים את הפרטים', 422, { fields: errors });
    docs = [{ kind, text, important: !!input.important, readBy: [{ user: actor.id, name: actor.name, at: new Date() }] }];
  } else if (kind === 'trace') {
    const department = TRACE_DEPARTMENTS[input.department] ? input.department : null;
    const fromDate = YMD.test(input.fromDate || '') ? input.fromDate : today;
    const toDate = YMD.test(input.toDate || '') ? input.toDate : fromDate;
    if (!department) errors.department = 'מחלקה';
    if (text.length < 2) errors.text = 'מה לעשות';
    if (toDate < fromDate) errors.toDate = 'עד תאריך אחרי מתאריך';
    if (Object.keys(errors).length) throw httpError('יש להשלים את הפרטים', 422, { fields: errors });
    const stay = input.reservationId ? await stayOf(propertyId, input.reservationId) : null;
    docs = [{ kind, text, department, fromDate, toDate, ...(stay ? { reservation: stay.r._id, roomNumber: stay.roomNumber, guestName: stay.guestName } : {}) }];
  } else {
    // message / alert / wakeup / locator are about a stay.
    const stay = await stayOf(propertyId, input.reservationId);
    const base = { reservation: stay.r._id, roomNumber: stay.roomNumber, guestName: stay.guestName };
    if (['cancelled', 'no_show', 'deleted', 'checked_out'].includes(stay.r.status) && kind !== 'alert') throw httpError('ההזמנה אינה פעילה', 409);
    if (kind === 'message') {
      if (text.length < 2) errors.text = 'תוכן ההודעה';
      const from = clip(input.from, 120);
      if (from.length < 2) errors.from = 'מי השאיר';
      if (Object.keys(errors).length) throw httpError('יש להשלים את הפרטים', 422, { fields: errors });
      docs = [{ ...base, kind, text, from, fromPhone: clip(input.fromPhone, 30) || undefined }];
    } else if (kind === 'alert') {
      const on = [...new Set((Array.isArray(input.on) ? input.on : []).filter((x) => ALERT_ON.includes(x)))];
      if (text.length < 2) errors.text = 'תוכן ההתראה';
      if (!on.length) errors.on = 'מתי להקפיץ';
      if (Object.keys(errors).length) throw httpError('יש להשלים את הפרטים', 422, { fields: errors });
      docs = [{ ...base, kind, text, on }];
    } else if (kind === 'locator') {
      const until = input.until ? new Date(input.until) : null;
      if (text.length < 2) errors.text = 'איפה האורח';
      if (!until || Number.isNaN(until.getTime()) || until <= new Date()) errors.until = 'עד מתי (בעתיד)';
      if (Object.keys(errors).length) throw httpError('יש להשלים את הפרטים', 422, { fields: errors });
      // One active locator per stay: a new one closes the previous.
      await DeskItem.updateMany({ property: propertyId, kind: 'locator', reservation: stay.r._id, status: 'open' }, { $set: { status: 'done', closedAt: new Date(), closedByName: actor.name, closeNote: 'הוחלף' } });
      docs = [{ ...base, kind, text, until }];
    } else if (kind === 'wakeup') {
      const time = HM.test(input.time || '') ? input.time : null;
      const date = YMD.test(input.date || '') ? input.date : (time ? addDays(today, 1) : null);
      const untilDate = YMD.test(input.untilDate || '') ? input.untilDate : date;
      if (!time) errors.time = 'שעה (HH:MM)';
      if (!date) errors.date = 'תאריך';
      if (date && date < today) errors.date = 'לא לפני היום העסקי';
      if (date && untilDate < date) errors.untilDate = 'עד תאריך אחרי התאריך';
      if (date && untilDate && (Date.parse(untilDate) - Date.parse(date)) / 864e5 >= MAX_WAKE_DAYS) errors.untilDate = `עד ${MAX_WAKE_DAYS} ימים`;
      if (Object.keys(errors).length) throw httpError('יש להשלים את הפרטים', 422, { fields: errors });
      // The whole group (same Reservation.group, in house) gets the same call.
      let stays = [stay];
      if (input.wholeGroup && stay.r.group) {
        const mates = await Reservation.find({ property: propertyId, group: stay.r.group, status: { $in: IN_HOUSE_STATUSES } }).select('_id').lean();
        stays = await Promise.all(mates.map((m) => stayOf(propertyId, String(m._id))));
      }
      const series = randomUUID();
      for (const s of stays) {
        const last = s.r.departureDate && s.r.departureDate <= untilDate ? addDays(s.r.departureDate, 0) : untilDate;
        for (let d = date; d <= last; d = addDays(d, 1)) {
          docs.push({ kind, reservation: s.r._id, roomNumber: s.roomNumber, guestName: s.guestName, text: text || 'השכמה', date: d, time, series });
        }
      }
      if (!docs.length) throw httpError('אין ימים להשכמה בטווח השהייה', 422, { fields: { date: 'מחוץ לשהייה' } });
    }
  }
  const created = await DeskItem.insertMany(docs.map((d) => ({ property: propertyId, ...d, ...actorFields(actor) })));
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `desk.${kind}_created`, entityType: 'DeskItem', entityId: created[0]._id, after: { kind, count: created.length, reservation: created[0].reservation ? String(created[0].reservation) : null, text: kind === 'message' ? undefined : created[0].text }, ip });
  return { items: created.map((x) => deskDto(x.toObject())), count: created.length };
}

// ── Close: delivered / done / no answer / cancelled (one or many) ──────────
const CLOSE_TO = {
  message: ['done', 'cancelled'], alert: ['cancelled'], trace: ['done', 'cancelled'], wakeup: ['done', 'no_answer', 'cancelled', 'open'],
  locator: ['done', 'cancelled'], logbook: ['cancelled'],
};
export async function closeDeskItems({ propertyId, input, actor, ip }) {
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : [input.id]).filter(Boolean).map(String))];
  if (!ids.length || ids.length > 300 || !ids.every(isId)) throw httpError('יש לבחור רשומות', 422);
  const items = await DeskItem.find({ _id: { $in: ids }, property: propertyId });
  if (items.length !== ids.length) throw httpError('רשומה לא נמצאה', 404);
  const status = input.status;
  for (const x of items) {
    if (!CLOSE_TO[x.kind].includes(status)) throw httpError('פעולה לא מתאימה לרשומה', 422);
    if (x.kind === 'logbook' && String(x.createdBy || '') !== String(actor.id) && !MANAGER_ROLES.includes(actor.role)) throw httpError('ביטול הודעת יומן — הכותב או מנהל', 403);
  }
  const how = ['verbal', 'printed', 'phone'].includes(input.deliveredHow) ? input.deliveredHow : undefined;
  const note = clip(input.note, 300) || undefined;
  for (const x of items) {
    x.status = status;
    if (status === 'open') { x.closedAt = undefined; x.closedByName = undefined; } else { x.closedAt = new Date(); x.closedByName = actor.name; }
    if (x.kind === 'message' && status === 'done') x.deliveredHow = how || 'verbal';
    if (note) x.closeNote = note;
    await x.save();
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `desk.${items[0].kind}_${status}`, entityType: 'DeskItem', entityId: items[0]._id, after: { ids, status, deliveredHow: how }, reason: note, ip });
  return { items: items.map((x) => deskDto(x.toObject())) };
}

export async function markLogRead({ propertyId, id, actor }) {
  if (!isId(String(id || ''))) throw httpError('מזהה לא תקין', 400);
  const x = await DeskItem.findOne({ _id: id, property: propertyId, kind: 'logbook' });
  if (!x) throw httpError('ההודעה לא נמצאה', 404);
  if (!x.readBy.some((r) => String(r.user) === String(actor.id))) { x.readBy.push({ user: actor.id, name: actor.name, at: new Date() }); await x.save(); }
  return deskDto(x.toObject());
}

// ── Lists ──────────────────────────────────────────────────────────────────
export async function listDesk({ propertyId, kind, view = 'open', date, from, to, department, reservationId, actor }) {
  if (!DESK_KINDS.includes(kind)) throw httpError('סוג רשומה לא מוכר', 422);
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const q = { property: propertyId, kind };
  if (isId(String(reservationId || ''))) q.reservation = reservationId;
  if (kind === 'wakeup') {
    q.date = YMD.test(date || '') ? date : today;
    if (view === 'open') q.status = 'open';
  } else if (kind === 'trace') {
    const f = YMD.test(from || '') ? from : today;
    const t = YMD.test(to || '') ? to : f;
    q.fromDate = { $lte: t }; q.toDate = { $gte: f };
    const own = DEPT_OF_ROLE[actor.role];
    if (own) q.department = own; else if (TRACE_DEPARTMENTS[department]) q.department = department;
    if (view === 'open') q.status = 'open';
  } else if (kind === 'logbook') {
    q.createdAt = { $gte: new Date(Date.now() - 14 * 864e5) };
    q.status = { $ne: 'cancelled' };
  } else if (kind === 'locator') {
    if (view === 'open') { q.status = 'open'; q.until = { $gt: new Date() }; }
  } else if (view === 'open') q.status = 'open';
  const rows = await DeskItem.find(q).sort(kind === 'wakeup' ? { time: 1, roomNumber: 1 } : { createdAt: -1 }).limit(500).lean();
  // A message is only shown while the guest is still in the hotel (or arriving).
  let list = rows;
  if (kind === 'message' && view === 'open' && !q.reservation) {
    const live = new Set((await Reservation.find({ _id: { $in: rows.map((x) => x.reservation) }, status: { $in: [...IN_HOUSE_STATUSES, 'confirmed', 'modified'] } }).select('_id').lean()).map((r) => String(r._id)));
    list = rows.filter((x) => live.has(String(x.reservation)));
  }
  return {
    businessDate: today, kind, rows: list.map(deskDto),
    ...(kind === 'logbook' ? { unread: list.filter((x) => !(x.readBy || []).some((r) => String(r.user) === String(actor.id))).length } : {}),
    ...(kind === 'trace' ? { departments: TRACE_DEPARTMENTS, templates: (await getList(propertyId, 'trace_text', { activeOnly: true })).map((x) => x.label), ownDepartment: DEPT_OF_ROLE[actor.role] || null } : {}),
  };
}

// Everything the desk has for one stay (stay file card + pop-ups).
export async function stayDesk({ propertyId, reservationId }) {
  if (!isId(String(reservationId || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const rows = await DeskItem.find({ property: propertyId, reservation: reservationId, status: { $in: ['open', 'no_answer'] } }).sort({ date: 1, time: 1, createdAt: -1 }).lean();
  const now = new Date();
  const live = rows.filter((x) => x.kind !== 'locator' || (x.until && x.until > now));
  return {
    messages: live.filter((x) => x.kind === 'message').map(deskDto),
    alerts: live.filter((x) => x.kind === 'alert').map(deskDto),
    traces: live.filter((x) => x.kind === 'trace').map(deskDto),
    wakeups: live.filter((x) => x.kind === 'wakeup').map(deskDto),
    locator: live.filter((x) => x.kind === 'locator').map(deskDto)[0] || null,
    departments: TRACE_DEPARTMENTS, templates: (await getList(propertyId, 'trace_text', { activeOnly: true })).map((x) => x.label),
  };
}

// Open counts per stay for lists (in-house: pending message, active locator).
export async function deskFlags(propertyId, reservationIds) {
  const rows = await DeskItem.find({ property: propertyId, reservation: { $in: reservationIds }, kind: { $in: ['message', 'locator'] }, status: 'open' }).select('reservation kind text until').lean();
  const now = new Date();
  const out = new Map();
  for (const x of rows) {
    const k = String(x.reservation);
    const cur = out.get(k) || { messages: 0, locator: null };
    if (x.kind === 'message') cur.messages += 1;
    else if (x.until > now) cur.locator = { text: x.text, until: x.until };
    out.set(k, cur);
  }
  return out;
}

// ── Operator: find a guest by name or room, with where they are and what waits for them ──
export async function operatorSearch({ propertyId, q }) {
  const term = clip(q, 60).toLowerCase();
  const stays = await Reservation.find({ property: propertyId, status: { $in: IN_HOUSE_STATUSES } })
    .select('confirmationNumber assignedRoom primaryGuest departureDate adults children').populate('assignedRoom', 'number').populate('primaryGuest', 'firstName lastName phone language').lean();
  const rows = stays.map((r) => ({
    reservationId: String(r._id), confirmationNumber: r.confirmationNumber, room: r.assignedRoom?.number || null,
    guest: r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : '—', departureDate: r.departureDate, adults: r.adults, children: r.children,
  })).filter((r) => !term || r.guest.toLowerCase().includes(term) || String(r.room || '').toLowerCase() === term || String(r.room || '').startsWith(term) || String(r.confirmationNumber).toLowerCase().includes(term));
  rows.sort((a, b) => String(a.room || '~').localeCompare(String(b.room || '~'), 'he', { numeric: true }));
  const page = rows.slice(0, 60);
  const property = await loadProperty(propertyId);
  const today = businessDateOf(property);
  const ids = page.map((r) => r.reservationId);
  const [flags, wakes] = await Promise.all([
    deskFlags(propertyId, ids),
    DeskItem.find({ property: propertyId, kind: 'wakeup', reservation: { $in: ids }, date: { $in: [today, addDays(today, 1)] }, status: 'open' }).select('reservation date time').lean(),
  ]);
  const wakeBy = new Map();
  for (const w of wakes) { const k = String(w.reservation); if (!wakeBy.has(k)) wakeBy.set(k, `${w.date === today ? 'היום' : 'מחר'} ${w.time}`); }
  return { businessDate: today, total: rows.length, rows: page.map((r) => ({ ...r, messages: flags.get(r.reservationId)?.messages || 0, locator: flags.get(r.reservationId)?.locator || null, wakeup: wakeBy.get(r.reservationId) || null })) };
}

// ── Phone book ─────────────────────────────────────────────────────────────
export async function listPhoneBook({ propertyId, q }) {
  const term = clip(q, 60).toLowerCase();
  const rows = await PhoneBookEntry.find({ property: propertyId }).sort({ category: 1, name: 1 }).lean();
  const list = rows.filter((x) => !term || [x.name, x.phone, x.note, PHONE_CATEGORIES[x.category]].some((v) => String(v || '').toLowerCase().includes(term)));
  return { categories: PHONE_CATEGORIES, rows: list.map((x) => ({ id: String(x._id), category: x.category, name: x.name, phone: x.phone || null, website: x.website || null, note: x.note || null, updatedBy: x.updatedByName || null })) };
}

export async function savePhoneEntry({ propertyId, id, input, actor, ip }) {
  const errors = {};
  const name = clip(input.name, 120);
  const category = PHONE_CATEGORIES[input.category] ? input.category : null;
  const phone = clip(input.phone, 40);
  let website = clip(input.website, 300);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(website)) errors.website = 'כתובת אתר לא תקינה';
  if (name.length < 2) errors.name = 'שם';
  if (!category) errors.category = 'קטגוריה';
  if (!phone && !website) errors.phone = 'טלפון או אתר';
  if (Object.keys(errors).length) throw httpError('יש להשלים את הפרטים', 422, { fields: errors });
  const body = { category, name, phone: phone || undefined, website: website || undefined, note: clip(input.note, 300) || undefined, updatedByName: actor.name };
  let doc;
  if (id) {
    if (!isId(String(id))) throw httpError('מזהה לא תקין', 400);
    doc = await PhoneBookEntry.findOneAndUpdate({ _id: id, property: propertyId }, { $set: body }, { new: true });
    if (!doc) throw httpError('הרשומה לא נמצאה', 404);
  } else doc = await PhoneBookEntry.create({ property: propertyId, ...body });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: id ? 'desk.phone_updated' : 'desk.phone_created', entityType: 'PhoneBookEntry', entityId: doc._id, after: { name, category }, ip });
  return { id: String(doc._id) };
}

export async function removePhoneEntry({ propertyId, id, actor, ip }) {
  if (!isId(String(id || ''))) throw httpError('מזהה לא תקין', 400);
  const doc = await PhoneBookEntry.findOneAndDelete({ _id: id, property: propertyId });
  if (!doc) throw httpError('הרשומה לא נמצאה', 404);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'desk.phone_removed', entityType: 'PhoneBookEntry', entityId: doc._id, before: { name: doc.name, category: doc.category }, ip });
  return { ok: true };
}
