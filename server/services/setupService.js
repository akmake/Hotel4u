// ADM-01/02/03 — setting up the hotel: property details, room types and rooms.
// Every write is scoped to the property, validated here, and audited. Nothing is deleted: a room type
// or a room leaves sale by being deactivated, and that is refused while stays depend on it.
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import Room from '../models/Room.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';

export const SETUP_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
const LIVE = ['cancelled', 'no_show', 'checked_out', 'quote', 'draft', 'waitlisted'];
const BED_TYPES = ['king', 'queen', 'twin', 'double', 'single', 'bunk', 'mixed', 'other'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const int = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

function validTaxId(v) {
  const s = digits(v);
  if (!/^\d{9}$/.test(s)) return false;
  const sum = [...s].reduce((a, ch, i) => { const x = Number(ch) * ((i % 2) + 1); return a + (x > 9 ? x - 9 : x); }, 0);
  return sum % 10 === 0;
}
const fail = (fields) => { if (Object.keys(fields).length) throw httpError('יש לתקן את השדות המסומנים', 422, { fields }); };
const guard = (actor) => { if (!SETUP_ROLES.includes(actor.role)) throw httpError('הקמת המלון מותרת להנהלה', 403); };

const PROPERTY_FIELDS = ['name', 'legalName', 'taxNumber', 'address', 'city', 'postalCode', 'phone', 'email', 'website', 'checkInTime', 'checkOutTime', 'timezone', 'vatRate', 'defaultCurrency', 'reservationPrefix', 'totalRooms'];

function propertyDto(p) {
  return Object.fromEntries(PROPERTY_FIELDS.map((k) => [k, p[k] ?? '']).concat([['id', String(p._id)]]));
}
function typeDto(t, counts) {
  return {
    id: String(t._id), code: t.code, name: t.name, shortDesc: t.shortDesc || '', baseRate: t.baseRate ?? 0,
    capacityBase: t.capacityBase ?? 2, capacityMax: t.capacityMax ?? 2, adultsMax: t.adultsMax ?? t.capacityMax ?? 2, childrenMax: t.childrenMax ?? 0,
    bedType: t.bedType || 'double', roomSizeSqm: t.roomSizeSqm ?? '', extraBedAllowed: !!t.extraBedAllowed, cribAllowed: t.cribAllowed !== false,
    sortOrder: t.sortOrder ?? 0, active: t.active !== false, rooms: counts.get(String(t._id)) || 0,
  };
}
function roomDto(r, typeName) {
  return {
    id: String(r._id), number: r.number, floor: r.floor, roomTypeId: String(r.roomType), roomType: typeName || null,
    isAccessible: !!r.isAccessible, isSmoking: !!r.isSmoking, isVip: !!r.isVip, internalNotes: r.internalNotes || '',
    active: r.active !== false, opsStatus: r.opsStatus, cleanStatus: r.cleanStatus,
  };
}

// What still stops the hotel from working (shown as a checklist).
function readiness(property, types, rooms) {
  const out = [];
  const add = (ok, label, where) => out.push({ ok, label, where });
  add(!!clip(property.legalName || property.name, 200) && validTaxId(property.taxNumber) && !!clip(property.address, 200) && !!clip(property.city, 80), 'פרטי העסק: שם משפטי, מספר עוסק / ח.פ. תקין, כתובת ועיר', 'property');
  add(/^\d{2}:\d{2}$/.test(property.checkInTime || '') && /^\d{2}:\d{2}$/.test(property.checkOutTime || ''), 'שעות כניסה ויציאה', 'property');
  const activeTypes = types.filter((t) => t.active !== false);
  add(activeTypes.length > 0, 'לפחות סוג חדר פעיל אחד', 'types');
  const activeRooms = rooms.filter((r) => r.active !== false);
  add(activeRooms.length > 0, 'לפחות חדר פעיל אחד', 'rooms');
  const empty = activeTypes.filter((t) => !activeRooms.some((r) => String(r.roomType) === String(t._id)));
  add(!empty.length, empty.length ? `סוגי חדרים בלי חדרים: ${empty.map((t) => t.name).join(', ')}` : 'לכל סוג חדר יש חדרים', 'rooms');
  const noRate = activeTypes.filter((t) => !(Number(t.baseRate) > 0));
  add(!noRate.length, noRate.length ? `סוגי חדרים בלי מחיר בסיס: ${noRate.map((t) => t.name).join(', ')}` : 'לכל סוג חדר יש מחיר בסיס', 'types');
  return out;
}

export async function setupOverview({ propertyId }) {
  const [property, types, rooms] = await Promise.all([
    Property.findById(propertyId).lean(),
    RoomType.find({ property: propertyId }).sort({ sortOrder: 1, name: 1 }).lean(),
    Room.find({ property: propertyId }).lean(),
  ]);
  if (!property) throw httpError('הנכס לא נמצא', 404);
  const counts = new Map();
  for (const r of rooms) if (r.active !== false) counts.set(String(r.roomType), (counts.get(String(r.roomType)) || 0) + 1);
  const typeName = new Map(types.map((t) => [String(t._id), t.name]));
  const sorted = rooms.sort((a, b) => (a.floor || 0) - (b.floor || 0) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  return {
    property: propertyDto(property),
    roomTypes: types.map((t) => typeDto(t, counts)),
    rooms: sorted.map((r) => roomDto(r, typeName.get(String(r.roomType)))),
    readiness: readiness(property, types, rooms),
    bedTypes: BED_TYPES,
  };
}

export async function updateProperty({ propertyId, input, actor, ip }) {
  guard(actor);
  const before = await Property.findById(propertyId).lean();
  if (!before) throw httpError('הנכס לא נמצא', 404);
  const set = {}; const f = {};
  const text = (k, n, required) => { if (input[k] === undefined) return; const v = clip(input[k], n); if (required && v.length < 2) f[k] = 'שדה חובה'; set[k] = v; };
  text('name', 120, true); text('legalName', 200); text('address', 200); text('city', 80); text('postalCode', 10); text('phone', 30); text('website', 200); text('reservationPrefix', 8);
  if (input.email !== undefined) { const v = clip(input.email, 120); if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) f.email = 'כתובת דוא״ל לא תקינה'; set.email = v; }
  if (input.taxNumber !== undefined) { const v = digits(input.taxNumber); if (v && !validTaxId(v)) f.taxNumber = 'מספר עוסק / ח.פ. — 9 ספרות עם ספרת ביקורת תקינה'; set.taxNumber = v; }
  for (const k of ['checkInTime', 'checkOutTime']) if (input[k] !== undefined) { const v = clip(input[k], 5); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) f[k] = 'שעה HH:MM'; set[k] = v; }
  if (input.vatRate !== undefined) { const v = Number(input.vatRate); if (!(v >= 0 && v <= 50)) f.vatRate = '0–50'; set.vatRate = v; }
  if (input.totalRooms !== undefined && input.totalRooms !== '') { const v = Number(input.totalRooms); if (!(Number.isInteger(v) && v >= 0)) f.totalRooms = 'מספר שלם'; set.totalRooms = v; }
  if (input.timezone !== undefined) set.timezone = clip(input.timezone, 60) || 'Asia/Jerusalem';
  if (input.defaultCurrency !== undefined) set.defaultCurrency = clip(input.defaultCurrency, 3).toUpperCase() || 'ILS';
  fail(f);
  const after = await Property.findByIdAndUpdate(propertyId, { $set: set }, { returnDocument: 'after' }).lean();
  const changed = Object.keys(set).filter((k) => String(before[k] ?? '') !== String(after[k] ?? ''));
  if (changed.length) {
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'setup.property', entityType: 'Property', entityId: propertyId,
      before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])), after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])), ip });
  }
  return propertyDto(after);
}

function typeInput(input, f, creating) {
  const set = {};
  if (creating || input.code !== undefined) { const v = clip(input.code, 10).toUpperCase(); if (!/^[A-Z0-9_-]{2,10}$/.test(v)) f.code = 'קוד 2–10 תווים: אותיות לטיניות וספרות'; set.code = v; }
  if (creating || input.name !== undefined) { const v = clip(input.name, 80); if (v.length < 2) f.name = 'שם חובה'; set.name = v; }
  if (input.shortDesc !== undefined) set.shortDesc = clip(input.shortDesc, 300);
  for (const k of ['capacityBase', 'capacityMax', 'adultsMax', 'childrenMax', 'sortOrder']) {
    const v = int(input[k]); if (v === undefined) continue;
    if (!(Number.isInteger(v) && v >= 0 && v <= 20)) f[k] = 'מספר שלם 0–20'; set[k] = v;
  }
  if (input.baseRate !== undefined) { const v = Number(input.baseRate); if (!(v >= 0)) f.baseRate = 'מחיר 0 ומעלה'; set.baseRate = Math.round(v * 100) / 100; }
  if (input.roomSizeSqm !== undefined) { const v = int(input.roomSizeSqm); if (v !== undefined && !(v > 0 && v < 1000)) f.roomSizeSqm = 'מ״ר'; set.roomSizeSqm = v; }
  if (input.bedType !== undefined) { if (!BED_TYPES.includes(input.bedType)) f.bedType = 'סוג מיטה'; set.bedType = input.bedType; }
  for (const k of ['extraBedAllowed', 'cribAllowed']) if (input[k] !== undefined) set[k] = !!input[k];
  return set;
}
function checkCapacity(t, f) {
  if (t.capacityMax < 1) f.capacityMax = 'לפחות 1';
  if (t.capacityBase > t.capacityMax) f.capacityBase = 'לא יותר מהתפוסה המרבית';
  if (t.adultsMax > t.capacityMax) f.adultsMax = 'לא יותר מהתפוסה המרבית';
  if (t.adultsMax < 1) f.adultsMax = 'לפחות מבוגר אחד';
}

async function liveStaysOfType(propertyId, typeId, today) {
  const [res, units] = await Promise.all([
    Reservation.countDocuments({ property: propertyId, roomType: typeId, status: { $nin: LIVE }, departureDate: { $gt: today } }),
    ReservationRoom.countDocuments({ property: propertyId, roomTypeBooked: typeId, status: { $in: ['reserved', 'tentative', 'checked_in', 'in_house'] }, departureDate: { $gt: today } }),
  ]);
  return res + units;
}

export async function createRoomType({ propertyId, input, actor, ip }) {
  guard(actor);
  const f = {};
  const set = typeInput(input, f, true);
  const t = { capacityBase: 2, capacityMax: 2, childrenMax: 0, baseRate: 0, bedType: 'double', ...set };
  if (t.adultsMax === undefined) t.adultsMax = t.capacityMax;
  checkCapacity(t, f);
  if (!f.code && await RoomType.exists({ property: propertyId, code: t.code })) f.code = 'הקוד כבר קיים בנכס';
  fail(f);
  const doc = await RoomType.create({ property: propertyId, ...t, active: true });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'setup.room_type_created', entityType: 'RoomType', entityId: doc._id, after: { code: doc.code, name: doc.name, baseRate: doc.baseRate }, ip });
  return typeDto(doc.toObject(), new Map());
}

export async function updateRoomType({ propertyId, typeId, input, actor, ip }) {
  guard(actor);
  if (!isId(typeId)) throw httpError('מזהה סוג חדר לא תקין', 400);
  const before = await RoomType.findOne({ _id: typeId, property: propertyId }).lean();
  if (!before) throw httpError('סוג החדר לא נמצא', 404);
  const f = {};
  const set = typeInput(input, f, false);
  checkCapacity({ ...before, ...set }, f);
  if (set.code && set.code !== before.code && await RoomType.exists({ property: propertyId, code: set.code, _id: { $ne: typeId } })) f.code = 'הקוד כבר קיים בנכס';
  fail(f);
  if (input.active !== undefined) {
    set.active = !!input.active;
    if (before.active !== false && set.active === false) {
      const property = await Property.findById(propertyId).select('timezone dayClose').lean();
      const [rooms, stays] = await Promise.all([Room.countDocuments({ property: propertyId, roomType: typeId, active: { $ne: false } }), liveStaysOfType(propertyId, typeId, businessDateOf(property))]);
      if (rooms) throw httpError(`לסוג יש ${rooms} חדרים פעילים — מעבירים אותם לסוג אחר או משביתים אותם קודם`, 409);
      if (stays) throw httpError(`יש ${stays} הזמנות פתוחות מסוג זה — אי אפשר להשבית אותו`, 409);
    }
  }
  const after = await RoomType.findOneAndUpdate({ _id: typeId, property: propertyId }, { $set: set }, { returnDocument: 'after' }).lean();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'setup.room_type_updated', entityType: 'RoomType', entityId: typeId,
    before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k] ?? null])), after: set, ip });
  const count = await Room.countDocuments({ property: propertyId, roomType: typeId, active: { $ne: false } });
  return typeDto(after, new Map([[String(typeId), count]]));
}

// "101-110, 115, 201-203" → ['101', …]. Ranges keep the width of the first number.
export function parseRoomNumbers(text) {
  const out = [];
  for (const part of String(text || '').split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^([A-Za-z]*)(\d+)(?:-\1?(\d+))?$/);
    if (!m) throw httpError(`"${part}" אינו מספר חדר או טווח (למשל 101-110)`, 422, { fields: { numbers: 'פורמט' } });
    const [, prefix, a, b] = m;
    if (!b) { out.push(prefix + a); continue; }
    const from = Number(a); const to = Number(b);
    if (to < from) throw httpError(`בטווח ${part} המספר השני קטן מהראשון`, 422, { fields: { numbers: 'טווח' } });
    if (to - from > 300) throw httpError('טווח של עד 300 חדרים', 422, { fields: { numbers: 'טווח' } });
    for (let n = from; n <= to; n += 1) out.push(prefix + String(n).padStart(a.length, '0'));
  }
  return out;
}

export async function addRooms({ propertyId, input, actor, ip }) {
  guard(actor);
  const f = {};
  if (!isId(input.roomTypeId)) f.roomTypeId = 'סוג חדר';
  const floor = int(input.floor);
  if (!(Number.isInteger(floor) && floor >= -5 && floor <= 200)) f.floor = 'קומה';
  fail(f);
  const type = await RoomType.findOne({ _id: input.roomTypeId, property: propertyId }).lean();
  if (!type) throw httpError('סוג החדר לא נמצא', 404);
  if (type.active === false) throw httpError('סוג החדר מושבת', 409);
  const numbers = [...new Set(parseRoomNumbers(input.numbers))];
  if (!numbers.length) throw httpError('יש להזין מספרי חדרים', 422, { fields: { numbers: 'מספרים' } });
  if (numbers.length > 300) throw httpError('עד 300 חדרים בפעולה אחת', 422, { fields: { numbers: 'עד 300' } });
  const taken = await Room.find({ property: propertyId, number: { $in: numbers } }).select('number active').lean();
  if (taken.length) {
    const list = taken.map((r) => r.number + (r.active === false ? ' (מושבת — אפשר להפעיל מחדש)' : '')).join(', ');
    throw httpError(`חדרים שכבר קיימים: ${list}`, 409, { fields: { numbers: 'קיימים' } });
  }
  const docs = await Room.insertMany(numbers.map((number) => ({
    property: propertyId, roomType: type._id, number, floor,
    isAccessible: !!input.isAccessible, isSmoking: !!input.isSmoking,
    opsStatus: 'available', cleanStatus: 'clean', occStatus: 'vacant', active: true,
  })));
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'setup.rooms_added', entityType: 'Room', entityId: docs[0]?._id, after: { roomType: type.code, floor, numbers }, ip });
  return { added: docs.length, rooms: docs.map((r) => roomDto(r.toObject(), type.name)) };
}

async function assignedStays(propertyId, roomId, today) {
  const [res, units] = await Promise.all([
    Reservation.find({ property: propertyId, assignedRoom: roomId, status: { $nin: LIVE }, departureDate: { $gt: today } }).select('confirmationNumber').limit(5).lean(),
    ReservationRoom.find({ property: propertyId, assignedRoom: roomId, status: { $in: ['reserved', 'tentative', 'checked_in', 'in_house'] }, departureDate: { $gt: today } }).populate('reservation', 'confirmationNumber status').limit(5).lean(),
  ]);
  const nums = new Set(res.map((r) => r.confirmationNumber));
  for (const u of units) if (u.reservation && !LIVE.includes(u.reservation.status)) nums.add(u.reservation.confirmationNumber);
  return [...nums];
}

export async function updateRoom({ propertyId, roomId, input, actor, ip }) {
  guard(actor);
  if (!isId(roomId)) throw httpError('מזהה חדר לא תקין', 400);
  const before = await Room.findOne({ _id: roomId, property: propertyId }).lean();
  if (!before) throw httpError('החדר לא נמצא', 404);
  const set = {}; const f = {};
  if (input.number !== undefined) { const v = clip(input.number, 10); if (!/^[A-Za-z0-9-]{1,10}$/.test(v)) f.number = 'מספר חדר'; else if (v !== before.number && await Room.exists({ property: propertyId, number: v, _id: { $ne: roomId } })) f.number = 'המספר כבר קיים'; set.number = v; }
  if (input.floor !== undefined) { const v = int(input.floor); if (!(Number.isInteger(v) && v >= -5 && v <= 200)) f.floor = 'קומה'; set.floor = v; }
  for (const k of ['isAccessible', 'isSmoking', 'isVip']) if (input[k] !== undefined) set[k] = !!input[k];
  if (input.internalNotes !== undefined) set.internalNotes = clip(input.internalNotes, 500);
  fail(f);
  const changesType = input.roomTypeId !== undefined && String(input.roomTypeId) !== String(before.roomType);
  const deactivates = input.active === false && before.active !== false;
  if (changesType || deactivates) {
    const property = await Property.findById(propertyId).select('timezone dayClose').lean();
    const stays = await assignedStays(propertyId, roomId, businessDateOf(property));
    if (stays.length) throw httpError(`בחדר משובצות הזמנות פתוחות (${stays.join(', ')}) — מעבירים אותן לחדר אחר קודם`, 409);
  }
  if (changesType) {
    const t = await RoomType.findOne({ _id: input.roomTypeId, property: propertyId, active: { $ne: false } }).lean();
    if (!t) throw httpError('סוג החדר לא נמצא או מושבת', 422, { fields: { roomTypeId: 'סוג' } });
    set.roomType = t._id;
  }
  if (input.active !== undefined) set.active = !!input.active;
  const after = await Room.findOneAndUpdate({ _id: roomId, property: propertyId }, { $set: set }, { returnDocument: 'after' }).lean();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'setup.room_updated', entityType: 'Room', entityId: roomId,
    before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k] ?? null])), after: set, ip });
  const t = await RoomType.findById(after.roomType).select('name').lean();
  return roomDto(after, t?.name);
}
