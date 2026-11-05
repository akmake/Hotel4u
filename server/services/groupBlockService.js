// Group blocks (allotments) that really hold inventory.
//  - a live block (tentative/confirmed) holds, per room type and night, blocked − picked − released;
//    that number is written to InventoryDate.groupAllotmentCount, which availability subtracts;
//  - picked = the block's live reservations of that room type (a cancelled pickup goes back to the block);
//  - a pickup books a real reservation (createBooking) at the block's negotiated price, linked to the block;
//  - after the cut-off date a block with auto-release gives its unpicked rooms back to sale.
import mongoose from 'mongoose';
import GroupBlock from '../models/GroupBlock.js';
import Reservation from '../models/Reservation.js';
import RoomType from '../models/RoomType.js';
import Company from '../models/Company.js';
import Property from '../models/Property.js';
import InventoryDate from '../models/InventoryDate.js';
import { RatePlan } from '../models/RatePlan.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { getStayDates, nightlyAvailability } from './availabilityService.js';
import { createBooking } from './bookingService.js';
import { getNextSequenceValue } from '../models/Counter.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const LIVE_BLOCK = ['tentative', 'confirmed', 'active'];
const DEAD_RES = ['cancelled', 'no_show', 'deleted', 'draft'];
export const GROUP_WORK = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'sales_manager', 'revenue_manager', 'receptionist'];
export const GROUP_MANAGE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'sales_manager', 'revenue_manager'];
export const STATUS_LABELS = { tentative: 'טנטטיבי', confirmed: 'מאושר', active: 'בשהייה', completed: 'הסתיים', cancelled: 'בוטל' };

async function pickedByType(block, session = null) {
  const rows = await Reservation.aggregate([
    { $match: { property: new mongoose.Types.ObjectId(String(block.property)), group: String(block._id), status: { $nin: DEAD_RES } } },
    { $group: { _id: '$roomType', n: { $sum: { $ifNull: ['$roomsCount', 1] } } } },
  ]).session(session);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

// Free places for the agent: a set number, or one for every N paying participants.
export const freePaxOf = (b) => (b.freePaxCount != null && b.freePaxCount >= 0 && b.freePaxCount !== '' ? Number(b.freePaxCount) : b.freePaxPer > 0 ? Math.floor((b.pax || 0) / (b.freePaxPer + 1)) : 0);

// ── Per-night grid ──────────────────────────────────────────────────────────────────────────
// A night may hold its own number (allotment.nightly); any other night holds `blocked`.
export const blockedOn = (a, d) => { const n = (a.nightly || []).find((x) => x.date === d); return n ? n.blocked : (a.blocked || 0); };
// A type is released when the desk gave its rest back (releasedAll) — or, for blocks released before
// the grid existed, when `released` covers everything that was not picked.
const isReleased = (a, pickedFlat) => !!a.releasedAll || ((a.released || 0) > 0 && (a.released || 0) >= (a.blocked || 0) - (pickedFlat || 0));

// Rooms of each type the block's live reservations use on each night: `${type}|${date}` → rooms.
async function pickedByNight(block, session = null) {
  const rows = await Reservation.find({ property: block.property, group: String(block._id), status: { $nin: DEAD_RES } })
    .select('roomType arrivalDate departureDate roomsCount').session(session).lean();
  const out = new Map();
  for (const r of rows) {
    for (const d of getStayDates(r.arrivalDate, r.departureDate)) {
      const k = `${r.roomType}|${d}`;
      out.set(k, (out.get(k) || 0) + (r.roomsCount || 1));
    }
  }
  return out;
}

// What is still held, per type and night.
function remainingByNight(block, pickedN, pickedFlat) {
  const out = new Map();
  if (!LIVE_BLOCK.includes(block.status)) return out;
  const nights = getStayDates(block.arrivalDate, block.departureDate);
  for (const a of block.allotments || []) {
    const t = String(a.roomTypeId);
    const gone = isReleased(a, pickedFlat.get(t) || 0);
    for (const d of nights) out.set(`${t}|${d}`, gone ? 0 : Math.max(0, blockedOn(a, d) - (pickedN.get(`${t}|${d}`) || 0)));
  }
  return out;
}

// Per type: the most rooms still held on any night (what the desk can still book from the block).
function remainingOf(block, picked, pickedN = null) {
  if (!LIVE_BLOCK.includes(block.status)) return new Map();
  const out = new Map();
  if (!pickedN) {
    for (const a of block.allotments || []) {
      const k = String(a.roomTypeId);
      out.set(k, (out.get(k) || 0) + (isReleased(a, picked.get(k) || 0) ? 0 : Math.max(0, (a.blocked || 0) - (picked.get(k) || 0))));
    }
    return out;
  }
  const rem = remainingByNight(block, pickedN, picked);
  for (const a of block.allotments || []) {
    const t = String(a.roomTypeId);
    out.set(t, Math.max(0, ...getStayDates(block.arrivalDate, block.departureDate).map((d) => rem.get(`${t}|${d}`) || 0)));
  }
  return out;
}

// Recompute the group hold for every night/room type a block touches (all live blocks contribute).
export async function syncGroupHold(propertyId, { from, to, roomTypeIds }) {
  if (!from || !to || !roomTypeIds?.length) return;
  const dates = getStayDates(from, to);
  const blocks = await GroupBlock.find({ property: propertyId, status: { $in: LIVE_BLOCK }, arrivalDate: { $lt: to }, departureDate: { $gt: from } }).lean();
  const held = new Map(); // `${type}|${date}` → rooms
  for (const b of blocks) {
    const picked = await pickedByType(b);
    const rem = remainingByNight(b, await pickedByNight(b), picked);
    const pending = b.pickupPending || {};
    for (const [k, n] of rem) {
      const type = k.split('|')[0];
      held.set(k, (held.get(k) || 0) + Math.max(0, n - Math.max(0, Number(pending[type] || 0))));
    }
  }
  const ops = [];
  for (const type of roomTypeIds.map(String)) {
    for (const d of dates) {
      ops.push({ updateOne: { filter: { property: propertyId, roomType: type, date: d }, update: { $set: { groupAllotmentCount: held.get(`${type}|${d}`) || 0 } }, upsert: true } });
    }
  }
  if (ops.length) await InventoryDate.bulkWrite(ops, { ordered: false });
}

export async function resyncBlockOf(propertyId, blockId) {
  if (!isId(blockId)) return;
  const b = await GroupBlock.findOne({ _id: blockId, property: propertyId }).lean();
  if (b) await syncBlock(b);
}

const syncBlock = (b) => syncGroupHold(b.property, { from: b.arrivalDate, to: b.departureDate, roomTypeIds: (b.allotments || []).map((a) => a.roomTypeId) });

// Cut-off passed → give unpicked rooms back (once).
async function autoRelease(propertyId, today) {
  const due = await GroupBlock.find({ property: propertyId, status: { $in: LIVE_BLOCK }, autoReleaseOnCutoff: { $ne: false }, cutoffDate: { $lt: today }, releasedAt: null });
  for (const b of due) {
    const picked = await pickedByType(b);
    for (const a of b.allotments) { a.released = Math.max(0, (a.blocked || 0) - (picked.get(String(a.roomTypeId)) || 0)); a.releasedAll = true; }
    b.releasedAt = new Date();
    await b.save();
    await syncBlock(b);
    await audit({ property: propertyId, actorName: 'system', action: 'group.auto_released', entityType: 'GroupBlock', entityId: b._id, after: { cutoffDate: b.cutoffDate } }).catch(() => null);
  }
}

async function blockDto(b, { withRes = false } = {}) {
  const picked = await pickedByType(b);
  const pickedN = await pickedByNight(b);
  const rem = remainingByNight(b, pickedN, picked);
  const nights = getStayDates(b.arrivalDate, b.departureDate);
  const allotments = (b.allotments || []).map((a) => {
    const t = String(a.roomTypeId);
    const p = picked.get(t) || 0;
    const grid = nights.map((d) => ({ date: d, blocked: blockedOn(a, d), picked: pickedN.get(`${t}|${d}`) || 0, remaining: rem.get(`${t}|${d}`) || 0 }));
    return {
      roomTypeId: t, roomTypeName: a.roomTypeName || '—', blocked: a.blocked || 0, picked: p, released: a.released || 0,
      remaining: Math.max(0, ...grid.map((g) => g.remaining)), negotiatedRate: a.negotiatedRate ?? null,
      varies: (a.nightly || []).some((x) => x.blocked !== (a.blocked || 0)), grid,
    };
  });
  const sum = (k) => allotments.reduce((s, a) => s + a[k], 0);
  const out = {
    id: String(b._id), name: b.name, groupCode: b.groupCode, description: b.description || null, status: b.status, statusLabel: STATUS_LABELS[b.status] || b.status,
    arrivalDate: b.arrivalDate, departureDate: b.departureDate, nights: b.nights || getStayDates(b.arrivalDate, b.departureDate).length, cutoffDate: b.cutoffDate || null,
    autoReleaseOnCutoff: b.autoReleaseOnCutoff !== false, releasedAt: b.releasedAt || null,
    company: b.company ? { id: String(b.company._id || b.company), name: b.company.name || null } : null,
    contactName: b.contactName || null, contactPhone: b.contactPhone || null, contactEmail: b.contactEmail || null,
    ratePlanId: b.ratePlan ? String(b.ratePlan) : null, depositAmount: b.depositAmount || 0, depositDueDate: b.depositDueDate || null,
    cancellationPolicy: b.cancellationPolicy || null, internalNotes: b.internalNotes || null, cancellationReason: b.cancellationReason || null,
    stayType: b.stayType || 'lodging', pax: b.pax || 0, minPax: b.minPax || 0,
    roomingStatus: b.roomingStatus || 'none', roomingDueDate: b.roomingDueDate || null,
    freePaxPer: b.freePaxPer || 0, freePaxCount: b.freePaxCount ?? null, freePax: freePaxOf(b),
    seriesOf: b.seriesOf ? String(b.seriesOf) : null, copiedFrom: b.copiedFrom ? String(b.copiedFrom) : null,
    allotments, totals: { blocked: sum('blocked'), picked: sum('picked'), released: sum('released'), remaining: sum('remaining') },
    pickupPct: sum('blocked') ? Math.round((sum('picked') / sum('blocked')) * 100) : 0,
    roomingList: (b.roomingList || []).map((r) => ({ id: String(r._id), guestName: r.guestName || '', guestPhone: r.guestPhone || '', guestEmail: r.guestEmail || '', roomTypeId: r.roomTypeId ? String(r.roomTypeId) : null, roomTypeName: r.roomTypeName || null, reservationId: r.reservationId ? String(r.reservationId) : null, notes: r.notes || null, adults: r.adults || null, children: r.children || 0, share: !!r.share, arrivalDate: r.arrivalDate || null, departureDate: r.departureDate || null })),
  };
  if (withRes) {
    out.arrival = await arrivalState(b);
    const master = b.seriesOf || (await GroupBlock.exists({ property: b.property, seriesOf: b._id }) ? b._id : null);
    out.series = master ? (await GroupBlock.find({ property: b.property, $or: [{ _id: master }, { seriesOf: master }] }).select('groupCode arrivalDate departureDate status').sort({ arrivalDate: 1 }).lean()).map((x) => ({ id: String(x._id), groupCode: x.groupCode, arrivalDate: x.arrivalDate, departureDate: x.departureDate, status: STATUS_LABELS[x.status] || x.status, master: String(x._id) === String(master), current: String(x._id) === String(b._id) })) : [];
    const res = await Reservation.find({ property: b.property, group: String(b._id) }).select('confirmationNumber status arrivalDate departureDate totalAmount roomType assignedRoom primaryGuest roomsCount')
      .populate('primaryGuest', 'firstName lastName phone').populate('roomType', 'name').populate('assignedRoom', 'number').sort({ createdAt: 1 }).lean();
    out.reservations = res.map((r) => ({ id: String(r._id), confirmationNumber: r.confirmationNumber, status: r.status, arrivalDate: r.arrivalDate, departureDate: r.departureDate, total: r.totalAmount || 0, roomType: r.roomType?.name || '—', room: r.assignedRoom?.number || null, guest: r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : '—', phone: r.primaryGuest?.phone || null }));
    out.revenue = round2(res.filter((r) => !DEAD_RES.includes(r.status)).reduce((s, r) => s + (r.totalAmount || 0), 0));
  }
  return out;
}

export async function listBlocks({ propertyId, view = 'upcoming', q }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  await autoRelease(propertyId, today);
  const filter = { property: propertyId };
  if (view === 'cancelled') filter.status = 'cancelled';
  else if (view === 'past') { filter.status = { $ne: 'cancelled' }; filter.departureDate = { $lte: today }; }
  else { filter.status = { $in: LIVE_BLOCK }; filter.departureDate = { $gt: today }; }
  if (q) {
    const rx = new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { groupCode: rx }, { contactName: rx }];
  }
  const blocks = await GroupBlock.find(filter).populate('company', 'name').sort(view === 'upcoming' ? { arrivalDate: 1 } : { arrivalDate: -1 }).limit(200).lean();
  const rows = [];
  for (const b of blocks) rows.push(await blockDto(b));
  return { today, rows };
}

export async function getBlock({ propertyId, id }) {
  if (!isId(id)) throw httpError('מזהה קבוצה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId }).populate('company', 'name').lean();
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  const [types, plans] = await Promise.all([
    RoomType.find({ property: propertyId, active: { $ne: false } }).select('name').sort({ sortOrder: 1 }).lean(),
    RatePlan.find({ property: propertyId, active: { $ne: false } }).select('name code type').sort({ sortOrder: 1 }).lean(),
  ]);
  return { ...(await blockDto(b, { withRes: true })), options: { roomTypes: types.map((t) => ({ id: String(t._id), name: t.name })), ratePlans: plans.map((p) => ({ id: String(p._id), name: p.name, type: p.type })) } };
}

async function validateInput({ propertyId, input, existing = null }) {
  const b = input || {};
  const errors = {};
  const name = String(b.name ?? existing?.name ?? '').trim().slice(0, 120);
  if (name.length < 2) errors.name = 'שם הקבוצה';
  const arrivalDate = existing ? existing.arrivalDate : b.arrivalDate;
  const departureDate = existing ? existing.departureDate : b.departureDate;
  if (!existing) {
    if (!YMD.test(arrivalDate || '')) errors.arrivalDate = 'תאריך הגעה';
    if (!YMD.test(departureDate || '')) errors.departureDate = 'תאריך עזיבה';
    else if (arrivalDate && departureDate <= arrivalDate) errors.departureDate = 'אחרי ההגעה';
  }
  const cutoffDate = b.cutoffDate === undefined ? existing?.cutoffDate : (YMD.test(b.cutoffDate || '') ? b.cutoffDate : null);
  if (cutoffDate && arrivalDate && cutoffDate > arrivalDate) errors.cutoffDate = 'תאריך השחרור לפני ההגעה';
  let allotments = existing?.allotments?.map((a) => a.toObject?.() || a) || [];
  if (Array.isArray(b.allotments)) {
    const typeIds = b.allotments.map((a) => a.roomTypeId).filter(isId);
    const types = new Map((await RoomType.find({ _id: { $in: typeIds }, property: propertyId }).select('name').lean()).map((t) => [String(t._id), t]));
    const seen = new Set();
    allotments = [];
    for (const a of b.allotments) {
      const t = types.get(String(a.roomTypeId));
      if (!t || seen.has(String(t._id))) continue;
      seen.add(String(t._id));
      const blocked = Number(a.blocked);
      if (!(Number.isInteger(blocked) && blocked >= 0 && blocked <= 500)) { errors.allotments = 'מספר חדרים שלם'; continue; }
      const prev = existing?.allotments?.find((x) => String(x.roomTypeId) === String(t._id));
      // The per-night grid stays while the base number stays; a new base number starts the grid again.
      const keepGrid = prev && Number(prev.blocked) === blocked ? (prev.nightly?.toObject?.() || prev.nightly) : undefined;
      allotments.push({ roomTypeId: t._id, roomTypeName: t.name, blocked, picked: 0, released: prev?.released || 0, releasedAll: !!prev?.releasedAll, ...(keepGrid?.length ? { nightly: keepGrid } : {}), negotiatedRate: a.negotiatedRate !== '' && a.negotiatedRate != null && Number(a.negotiatedRate) > 0 ? round2(a.negotiatedRate) : undefined });
    }
  }
  // A day seminar holds no rooms; a lodging group needs at least one room type.
  const stayType = b.stayType === undefined ? existing?.stayType || 'lodging' : (b.stayType === 'day' ? 'day' : 'lodging');
  if (stayType === 'day') allotments = []; // a type with reservations is refused by updateBlock
  else if (Array.isArray(b.allotments) || !existing) { if (!allotments.some((a) => a.blocked > 0)) errors.allotments = 'לפחות סוג חדר אחד עם חדרים'; }
  const pax = b.pax === undefined ? existing?.pax || 0 : Math.max(0, Math.round(Number(b.pax) || 0));
  const minPax = b.minPax === undefined ? existing?.minPax || 0 : Math.max(0, Math.round(Number(b.minPax) || 0));
  if (pax > 5000) errors.pax = 'עד 5,000 משתתפים';
  if (minPax > pax && pax > 0) errors.minPax = 'ההתחייבות גבוהה ממספר המשתתפים';
  const freePaxPer = b.freePaxPer === undefined ? existing?.freePaxPer || 0 : Math.max(0, Math.round(Number(b.freePaxPer) || 0));
  const freePaxCount = b.freePaxCount === undefined ? existing?.freePaxCount : (b.freePaxCount === '' || b.freePaxCount === null ? undefined : Math.max(0, Math.round(Number(b.freePaxCount) || 0)));
  const roomingDueDate = b.roomingDueDate === undefined ? existing?.roomingDueDate : (YMD.test(String(b.roomingDueDate || '')) ? b.roomingDueDate : undefined);
  let company;
  if (b.companyId !== undefined) {
    if (b.companyId) {
      company = isId(b.companyId) ? await Company.findOne({ _id: b.companyId, property: propertyId }).select('_id').lean() : null;
      if (!company) errors.companyId = 'החברה לא נמצאה';
    } else company = null;
  }
  let ratePlan;
  if (b.ratePlanId !== undefined) {
    if (b.ratePlanId) {
      ratePlan = isId(b.ratePlanId) ? await RatePlan.findOne({ _id: b.ratePlanId, property: propertyId }).select('_id').lean() : null;
      if (!ratePlan) errors.ratePlanId = 'התעריף לא נמצא';
    } else ratePlan = null;
  }
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי הקבוצה', 422, { fields: errors });
  const text = (k, n = 300) => (b[k] === undefined ? existing?.[k] : String(b[k] || '').trim().slice(0, n) || undefined);
  return {
    name, arrivalDate, departureDate, cutoffDate: cutoffDate || undefined, allotments, stayType, pax, minPax, freePaxPer, freePaxCount, roomingDueDate,
    ...(company !== undefined ? { company: company?._id || null } : {}), ...(ratePlan !== undefined ? { ratePlan: ratePlan?._id || null } : {}),
    contactName: text('contactName', 120), contactPhone: text('contactPhone', 30), contactEmail: text('contactEmail', 120), description: text('description', 500),
    cancellationPolicy: text('cancellationPolicy', 500), internalNotes: text('internalNotes', 1000),
    depositAmount: b.depositAmount === undefined ? existing?.depositAmount || 0 : Math.max(0, round2(b.depositAmount || 0)),
    depositDueDate: b.depositDueDate === undefined ? existing?.depositDueDate : (YMD.test(b.depositDueDate || '') ? b.depositDueDate : undefined),
    autoReleaseOnCutoff: b.autoReleaseOnCutoff === undefined ? existing?.autoReleaseOnCutoff !== false : b.autoReleaseOnCutoff !== false,
  };
}

// The extra rooms a block asks for must be free on every night (the block's own hold is already out).
async function assertRoomsFree(propertyId, arrival, departure, wanted) {
  const short = [];
  for (const [typeId, extra] of wanted) {
    if (extra <= 0) continue;
    const inv = await nightlyAvailability({ propertyId, roomTypeId: typeId, arrivalDate: arrival, departureDate: departure });
    const min = Math.min(...inv.nights.map((n) => n.available));
    if (min < extra) short.push({ typeId, extra, min });
  }
  if (short.length) {
    const names = new Map((await RoomType.find({ _id: { $in: short.map((s) => s.typeId) } }).select('name').lean()).map((t) => [String(t._id), t.name]));
    throw httpError(`אין מספיק חדרים פנויים: ${short.map((s) => `${names.get(String(s.typeId)) || 'סוג'} — ביקשתם ${s.extra}, פנויים ${Math.max(0, s.min)}`).join(' · ')}`, 409, { code: 'not_enough_rooms', fields: { allotments: 'אין מספיק חדרים' } });
  }
}

export async function createBlock({ propertyId, input, actor, ip }) {
  const data = await validateInput({ propertyId, input });
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  if (data.arrivalDate < businessDateOf(property)) throw httpError('לא ניתן לפתוח בלוק לתאריך שעבר', 422, { fields: { arrivalDate: 'תאריך עבר' } });
  await assertRoomsFree(propertyId, data.arrivalDate, data.departureDate, new Map(data.allotments.map((a) => [String(a.roomTypeId), a.blocked])));
  const n = await getNextSequenceValue(`group-block:${propertyId}`);
  const code = String(input?.groupCode || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || `G${data.arrivalDate.slice(2, 4)}${data.arrivalDate.slice(5, 7)}-${String(n).padStart(3, '0')}`;
  if (await GroupBlock.exists({ groupCode: code })) throw httpError('קוד הקבוצה כבר קיים', 409, { fields: { groupCode: 'קיים' } });
  const b = await GroupBlock.create({ ...data, property: propertyId, groupCode: code, status: 'tentative', createdBy: actor.id || undefined });
  await syncBlock(b);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.created', entityType: 'GroupBlock', entityId: b._id, after: { code, name: data.name, rooms: b.totalRoomsBlocked, arrivalDate: data.arrivalDate, departureDate: data.departureDate }, ip });
  return getBlock({ propertyId, id: String(b._id) });
}

export async function updateBlock({ propertyId, id, input, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId });
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  if (['completed', 'cancelled'].includes(b.status)) throw httpError('קבוצה שהסתיימה או בוטלה אינה ניתנת לעריכה', 409);
  const data = await validateInput({ propertyId, input, existing: b });
  const picked = await pickedByType(b);
  for (const a of data.allotments) {
    const p = picked.get(String(a.roomTypeId)) || 0;
    if (a.blocked < p) throw httpError(`ל־${a.roomTypeName} כבר נרשמו ${p} הזמנות — אי אפשר לחסום פחות`, 422, { fields: { allotments: 'פחות מהנרשמים' } });
  }
  for (const a of b.allotments) if (!data.allotments.some((x) => String(x.roomTypeId) === String(a.roomTypeId)) && (picked.get(String(a.roomTypeId)) || 0) > 0) throw httpError(`ל־${a.roomTypeName} יש הזמנות — אי אפשר להסיר את סוג החדר`, 422);
  const before = remainingOf(b, picked);
  const after = remainingOf({ status: b.status, allotments: data.allotments }, picked);
  await assertRoomsFree(propertyId, b.arrivalDate, b.departureDate, new Map([...after].map(([k, v]) => [k, v - (before.get(k) || 0)])));
  const oldTypes = b.allotments.map((a) => a.roomTypeId);
  Object.assign(b, data);
  await b.save();
  await syncGroupHold(propertyId, { from: b.arrivalDate, to: b.departureDate, roomTypeIds: [...oldTypes, ...b.allotments.map((a) => a.roomTypeId)] });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.modified', entityType: 'GroupBlock', entityId: b._id, after: { rooms: b.totalRoomsBlocked, cutoffDate: b.cutoffDate }, ip });
  return getBlock({ propertyId, id });
}

// Move the group to other dates (knowledge 05 §8, 14 §1). Only while it has no live reservations —
// with reservations the group is copied and moved instead. Same length → the whole programme moves
// with it; a different length → the programme stays and the desk is told. dryRun shows the check and
// the other groups on the new dates (not this one) before anything is changed.
export async function moveBlock({ propertyId, id, input, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId });
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  if (!LIVE_BLOCK.includes(b.status)) throw httpError('קבוצה שהסתיימה או בוטלה אינה זזה', 409);
  const arrivalDate = String(input?.arrivalDate || '');
  const departureDate = String(input?.departureDate || '');
  if (!YMD.test(arrivalDate) || !YMD.test(departureDate) || departureDate <= arrivalDate) throw httpError('תאריכים לא תקינים', 422, { fields: { departureDate: 'אחרי ההגעה' } });
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  if (arrivalDate < businessDateOf(property)) throw httpError('לא מזיזים קבוצה לתאריך שעבר', 422, { fields: { arrivalDate: 'תאריך עבר' } });
  const live = await Reservation.countDocuments({ property: propertyId, group: String(b._id), status: { $nin: DEAD_RES } });
  if (live) throw httpError(`בקבוצה ${live} הזמנות פעילות — מזיזים רק קבוצה בלי הזמנות (אפשר לשכפל אותה לתאריכים החדשים)`, 409, { code: 'has_reservations' });
  const { shiftProgram, programCount, daysBetween } = await import('./groupProgramService.js');
  const sameLength = daysBetween(arrivalDate, departureDate) === daysBetween(b.arrivalDate, b.departureDate);
  const delta = daysBetween(b.arrivalDate, arrivalDate);
  const items = await programCount(propertyId, b._id);
  // Rooms on the new nights: the group's own hold on nights it already covers counts as free.
  const short = [];
  const oldNights = new Set(getStayDates(b.arrivalDate, b.departureDate));
  for (const a of b.allotments) {
    const need = Math.max(0, (a.blocked || 0) - (a.released || 0));
    if (!need) continue;
    const inv = await nightlyAvailability({ propertyId, roomTypeId: a.roomTypeId, arrivalDate, departureDate });
    const worst = Math.min(...inv.nights.map((nt) => nt.available + (oldNights.has(nt.date) ? need : 0)));
    if (worst < need) short.push(`${a.roomTypeName}: צריך ${need}, פנויים ${Math.max(0, worst)}`);
  }
  const others = await GroupBlock.find({ property: propertyId, _id: { $ne: b._id }, status: { $in: LIVE_BLOCK }, arrivalDate: { $lt: departureDate }, departureDate: { $gt: arrivalDate } })
    .select('name groupCode arrivalDate departureDate totalRoomsBlocked pax status').sort({ arrivalDate: 1 }).limit(20).lean();
  const preview = {
    arrivalDate, departureDate, sameLength, delta, programItems: items, programMoves: sameLength && items > 0, roomsShort: short,
    others: others.map((o) => ({ id: String(o._id), name: o.name, groupCode: o.groupCode, arrivalDate: o.arrivalDate, departureDate: o.departureDate, rooms: o.totalRoomsBlocked || 0, pax: o.pax || 0, status: STATUS_LABELS[o.status] || o.status })),
  };
  if (input?.dryRun) return preview;
  if (short.length) throw httpError(`אין מספיק חדרים בתאריכים החדשים — ${short.join(' · ')}`, 409, { code: 'not_enough_rooms' });
  const before = { arrivalDate: b.arrivalDate, departureDate: b.departureDate, cutoffDate: b.cutoffDate };
  const from = before.arrivalDate < arrivalDate ? before.arrivalDate : arrivalDate;
  const to = before.departureDate > departureDate ? before.departureDate : departureDate;
  b.arrivalDate = arrivalDate;
  b.departureDate = departureDate;
  if (b.cutoffDate) { const c = new Date(`${b.cutoffDate}T00:00:00Z`); c.setUTCDate(c.getUTCDate() + delta); b.cutoffDate = c.toISOString().slice(0, 10) > arrivalDate ? arrivalDate : c.toISOString().slice(0, 10); }
  if (b.depositDueDate) { const c = new Date(`${b.depositDueDate}T00:00:00Z`); c.setUTCDate(c.getUTCDate() + delta); b.depositDueDate = c.toISOString().slice(0, 10); }
  await b.save();
  await syncGroupHold(propertyId, { from, to, roomTypeIds: b.allotments.map((a) => a.roomTypeId) });
  const moved = sameLength ? await shiftProgram({ propertyId, groupId: b._id, delta }) : 0;
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.moved', entityType: 'GroupBlock', entityId: b._id, before, after: { arrivalDate, departureDate, cutoffDate: b.cutoffDate, programMoved: moved, programKept: sameLength ? 0 : items }, ip });
  return { ...(await getBlock({ propertyId, id })), moved: { programMoved: moved, programKept: sameLength ? 0 : items } };
}

// Per-night quantities for one room type (knowledge 05 §4): e.g. 20 rooms the first night, 15 the second.
// A night may not hold fewer than its bookings; extra rooms must be free that night.
export async function saveGrid({ propertyId, id, input, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId });
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  if (!LIVE_BLOCK.includes(b.status)) throw httpError('קבוצה שהסתיימה או בוטלה אינה ניתנת לעריכה', 409);
  const a = b.allotments.find((x) => String(x.roomTypeId) === String(input?.roomTypeId));
  if (!a) throw httpError('סוג החדר אינו בבלוק', 422, { fields: { roomTypeId: 'לא בבלוק' } });
  const nights = getStayDates(b.arrivalDate, b.departureDate);
  const want = new Map();
  for (const d of nights) {
    const v = input?.nights?.[d];
    const n = v === undefined || v === '' ? blockedOn(a, d) : Number(v);
    if (!(Number.isInteger(n) && n >= 0 && n <= 500)) throw httpError(`מספר חדרים שלם ללילה ${d}`, 422, { fields: { nights: d } });
    want.set(d, n);
  }
  const picked = await pickedByType(b);
  const pickedN = await pickedByNight(b);
  const rem = remainingByNight(b, pickedN, picked);
  const t = String(a.roomTypeId);
  const low = nights.filter((d) => want.get(d) < (pickedN.get(`${t}|${d}`) || 0));
  if (low.length) throw httpError(`יש יותר הזמנות מהכמות בלילות ${low.join(', ')}`, 422, { code: 'below_picked' });
  const inv = await nightlyAvailability({ propertyId, roomTypeId: a.roomTypeId, arrivalDate: b.arrivalDate, departureDate: b.departureDate });
  const short = [];
  for (const nt of inv.nights) {
    const extra = (want.get(nt.date) - (pickedN.get(`${t}|${nt.date}`) || 0)) - (rem.get(`${t}|${nt.date}`) || 0);
    if (extra > nt.available) short.push(`${nt.date}: ביקשתם עוד ${extra}, פנויים ${nt.available}`);
  }
  if (short.length) throw httpError(`אין מספיק חדרים פנויים — ${short.join(' · ')}`, 409, { code: 'not_enough_rooms' });
  const before = nights.map((d) => blockedOn(a, d));
  // The base stays the most common number; nights that differ are listed.
  const counts = new Map();
  for (const n of want.values()) counts.set(n, (counts.get(n) || 0) + 1);
  const base = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];
  a.blocked = base;
  a.nightly = nights.filter((d) => want.get(d) !== base).map((d) => ({ date: d, blocked: want.get(d) }));
  a.releasedAll = false;
  b.markModified('allotments');
  await b.save();
  await syncBlock(b);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.grid_saved', entityType: 'GroupBlock', entityId: b._id, before: { roomType: a.roomTypeName, nights: before }, after: { nights: nights.map((d) => want.get(d)) }, ip });
  return getBlock({ propertyId, id });
}

export async function setBlockStatus({ propertyId, id, action, reason, roomTypeId, actor, ip }) {
  if (!GROUP_MANAGE.includes(actor.role)) throw httpError('פעולה זו — למנהל או למכירות', 403);
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId });
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  const picked = await pickedByType(b);
  if (action === 'confirm') {
    if (b.status !== 'tentative') throw httpError('רק קבוצה טנטטיבית מאושרת', 409);
    b.status = 'confirmed';
  } else if (action === 'cancel') {
    if (['cancelled', 'completed'].includes(b.status)) throw httpError('הקבוצה כבר סגורה', 409);
    const live = [...picked.values()].reduce((s, n) => s + n, 0);
    if (live > 0) throw httpError(`יש ${live} הזמנות פעילות בקבוצה — בטלו אותן קודם או שחררו את היתרה`, 409);
    const why = String(reason || '').trim().slice(0, 300);
    if (why.length < 3) throw httpError('ביטול מחייב סיבה', 422, { fields: { reason: 'סיבה' } });
    Object.assign(b, { status: 'cancelled', cancelledAt: new Date(), cancellationReason: why });
  } else if (action === 'release') {
    for (const a of b.allotments) if (!roomTypeId || String(a.roomTypeId) === String(roomTypeId)) { a.released = Math.max(0, (a.blocked || 0) - (picked.get(String(a.roomTypeId)) || 0)); a.releasedAll = true; }
    b.releasedAt = new Date();
  } else throw httpError('פעולה לא מוכרת', 422);
  await b.save();
  await syncBlock(b);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: `group.${action === 'release' ? 'rooms_released' : action === 'confirm' ? 'confirmed' : 'cancelled'}`, entityType: 'GroupBlock', entityId: b._id, reason: reason || undefined, after: { status: b.status, roomTypeId: roomTypeId || null }, ip });
  return getBlock({ propertyId, id });
}

// Book one room from the block at the block price, linked to the group.
export async function pickupFromBlock({ propertyId, id, input, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId });
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  if (!LIVE_BLOCK.includes(b.status)) throw httpError('הקבוצה אינה פעילה', 409);
  const a = b.allotments.find((x) => String(x.roomTypeId) === String(input?.roomTypeId));
  if (!a) throw httpError('סוג החדר אינו בבלוק', 422, { fields: { roomTypeId: 'לא בבלוק' } });
  const picked = await pickedByType(b);
  const arrival = YMD.test(input?.arrival || '') ? input.arrival : b.arrivalDate;
  const departure = YMD.test(input?.departure || '') ? input.departure : b.departureDate;
  if (arrival < b.arrivalDate || departure > b.departureDate || departure <= arrival) throw httpError(`תאריכי ההזמנה בתוך תאריכי הקבוצה (${b.arrivalDate} – ${b.departureDate})`, 422, { fields: { arrival: 'מחוץ לטווח' } });
  // Every night of the booking needs a room of this type still held by the block.
  const rem = remainingByNight(b, await pickedByNight(b), picked);
  const full = getStayDates(arrival, departure).filter((d) => (rem.get(`${a.roomTypeId}|${d}`) || 0) < 1);
  if (full.length) throw httpError(`לא נותרו חדרים מסוג ${a.roomTypeName} בבלוק בלילות ${full.join(', ')}`, 409, { code: 'block_full' });
  let planId = b.ratePlan;
  if (!planId) planId = (await RatePlan.findOne({ property: propertyId, active: { $ne: false }, type: 'group' }).select('_id').lean())?._id
    || (await RatePlan.findOne({ property: propertyId, active: { $ne: false } }).sort({ sortOrder: 1 }).select('_id').lean())?._id;
  if (!planId) throw httpError('אין תעריף פעיל לרישום ההזמנה', 409);
  const entry = input?.rosterId ? b.roomingList.id(input.rosterId) : null;
  if (input?.rosterId && !entry) throw httpError('השורה ברשימת השמות לא נמצאה', 404);
  if (entry?.reservationId) throw httpError('לשורה זו כבר נרשמה הזמנה', 409);
  // Free the unit from the hold while the booking is made (restored on failure).
  const pendingKey = `pickupPending.${String(a.roomTypeId)}`;
  await GroupBlock.updateOne({ _id: b._id }, { $inc: { [pendingKey]: 1 } });
  await syncBlock(b);
  let out;
  try {
    out = await createBooking({
      propertyId, actor, ip, groupRate: a.negotiatedRate || null,
      input: {
        idempotencyKey: String(input?.idempotencyKey || ''), mode: 'confirm', source: 'corporate',
        arrival, departure, adults: Number(input?.adults || 2), children: Number(input?.children || 0), childAges: Array.isArray(input?.childAges) ? input.childAges : [], rooms: 1,
        roomTypeId: String(a.roomTypeId), ratePlanId: String(planId), groupReason: `מחיר קבוצה ${b.groupCode}`,
        ...(input?.guestId ? { guestId: input.guestId } : { newGuest: input?.newGuest || {}, forceNewGuest: !!input?.forceNewGuest }),
        companyId: b.company ? String(b.company) : undefined, payerType: input?.payerType === 'company' && b.company ? 'company' : 'guest',
        specialRequests: input?.specialRequests || entry?.specialRequests || undefined, internalNotes: `קבוצה ${b.groupCode} · ${b.name}`,
      },
    });
  } finally {
    await GroupBlock.updateOne({ _id: b._id }, { $inc: { [pendingKey]: -1 } });
    await syncBlock(b);
  }
  await Reservation.updateOne({ _id: out.id, property: propertyId }, { $set: { group: String(b._id), groupCode: b.groupCode, groupName: b.name, marketSegment: 'group' } });
  if (entry) await GroupBlock.updateOne({ _id: b._id, 'roomingList._id': entry._id }, { $set: { 'roomingList.$.reservationId': out.id } });
  await syncBlock(await GroupBlock.findById(b._id).lean());
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.pickup', entityType: 'GroupBlock', entityId: b._id, after: { reservationId: out.id, confirmationNumber: out.confirmationNumber, roomTypeId: String(a.roomTypeId) }, ip });
  return { reservationId: out.id, confirmationNumber: out.confirmationNumber, duplicate: !!out.duplicate };
}

export async function saveRoster({ propertyId, id, entries, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId });
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  if (!Array.isArray(entries)) throw httpError('רשימת שמות לא תקינה', 422);
  if (b.roomingStatus === 'final') throw httpError('רשימת השמות סופית — שינוי נעשה בהזמנה של כל אורח (או מחזירים את הרשימה ל״ראשונית״)', 409, { code: 'rooming_final' });
  const types = new Map(b.allotments.map((a) => [String(a.roomTypeId), a.roomTypeName]));
  // A room type may also be named (import from a file): matched by name.
  const byName = new Map(b.allotments.map((a) => [String(a.roomTypeName || '').trim(), String(a.roomTypeId)]));
  const keep = new Map(b.roomingList.filter((r) => r.reservationId).map((r) => [String(r._id), r]));
  const next = [...keep.values()];
  const day = (v) => (YMD.test(String(v || '')) && v >= b.arrivalDate && v <= b.departureDate ? v : undefined);
  for (const e of entries.slice(0, 500)) {
    if (e.id && keep.has(String(e.id))) continue;
    const name = String(e.guestName || '').trim().slice(0, 120);
    if (!name) continue;
    const typeId = types.has(String(e.roomTypeId)) ? String(e.roomTypeId) : byName.get(String(e.roomTypeName || '').trim());
    const arrivalDate = day(e.arrivalDate);
    const departureDate = day(e.departureDate);
    const adults = Number.isInteger(Number(e.adults)) && Number(e.adults) >= 1 && Number(e.adults) <= 10 ? Number(e.adults) : undefined;
    const children = Number.isInteger(Number(e.children)) && Number(e.children) >= 0 && Number(e.children) <= 10 ? Number(e.children) : undefined;
    next.push({
      guestName: name, guestPhone: String(e.guestPhone || '').trim().slice(0, 30) || undefined, guestEmail: String(e.guestEmail || '').trim().slice(0, 120) || undefined,
      roomTypeId: typeId, roomTypeName: typeId ? types.get(typeId) : undefined, notes: String(e.notes || '').trim().slice(0, 300) || undefined,
      arrivalDate, departureDate: departureDate && (!arrivalDate || departureDate > arrivalDate) ? departureDate : undefined, adults, children,
      share: !!e.share && next.length > 0,
    });
  }
  b.roomingList = next;
  await b.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.rooming_list_saved', entityType: 'GroupBlock', entityId: b._id, after: { count: next.length, shares: next.filter((r) => r.share).length }, ip });
  return getBlock({ propertyId, id });
}

// none → preliminary → final (and back to preliminary by a manager). Final is what allows check-in.
export async function setRoomingStatus({ propertyId, id, input, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId });
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  const status = ['none', 'preliminary', 'final'].includes(input?.status) ? input.status : null;
  if (!status) throw httpError('סטטוס רשימה לא מוכר', 422);
  if (b.roomingStatus === 'final' && status !== 'final' && !GROUP_MANAGE.includes(actor.role)) throw httpError('החזרת רשימה סופית — למנהל', 403);
  if (status === 'final' && !b.roomingList.length) throw httpError('אין שמות ברשימה', 422);
  const before = b.roomingStatus;
  b.roomingStatus = status;
  if (input?.dueDate !== undefined) b.roomingDueDate = YMD.test(String(input.dueDate || '')) ? input.dueDate : undefined;
  await b.save();
  const unbooked = b.roomingList.filter((r) => !r.reservationId).length;
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.rooming_status', entityType: 'GroupBlock', entityId: b._id, before: { status: before }, after: { status, dueDate: b.roomingDueDate || null, unbooked }, ip });
  return getBlock({ propertyId, id });
}

// Rows from the block itself (Optima): one row per room still held, by type — only names are left to type.
export async function fillRosterFromBlock({ propertyId, id, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId });
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  if (b.roomingStatus === 'final') throw httpError('רשימת השמות סופית', 409);
  const picked = await pickedByType(b);
  const rem = remainingOf(b, picked, await pickedByNight(b));
  const waiting = new Map();
  for (const r of b.roomingList.filter((x) => !x.reservationId && !x.share && x.roomTypeId)) waiting.set(String(r.roomTypeId), (waiting.get(String(r.roomTypeId)) || 0) + 1);
  let n = b.roomingList.length;
  let added = 0;
  for (const a of b.allotments) {
    const need = Math.max(0, (rem.get(String(a.roomTypeId)) || 0) - (waiting.get(String(a.roomTypeId)) || 0));
    for (let i = 0; i < need; i += 1) { n += 1; added += 1; b.roomingList.push({ guestName: `אורח ${n} · ${b.name}`.slice(0, 120), roomTypeId: a.roomTypeId, roomTypeName: a.roomTypeName }); }
  }
  if (!added) throw httpError('כל החדרים בבלוק כבר ברשימה', 409);
  await b.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.rooming_filled', entityType: 'GroupBlock', entityId: b._id, after: { added }, ip });
  return getBlock({ propertyId, id });
}

// ── Receiving the group ────────────────────────────────────────────────────────────────────
const BOOKED = ['confirmed', 'modified', 'pending_payment', 'hold'];

// Assign rooms to every booking of the group that has none: rooms ready now first, kept together on
// the floor the group already uses (or the floor asked for), lowest number first.
export async function assignGroupRooms({ propertyId, id, input, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId }).lean();
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  const { roomCandidates, assignRoom } = await import('./frontDeskService.js');
  const res = await Reservation.find({ property: propertyId, group: String(b._id), status: { $in: BOOKED } }).select('confirmationNumber assignedRoom roomsCount arrivalDate').sort({ arrivalDate: 1, createdAt: 1 }).lean();
  const todo = res.filter((r) => !r.assignedRoom && (r.roomsCount || 1) === 1);
  const floors = new Map();
  for (const r of res.filter((x) => x.assignedRoom)) {
    const room = await mongoose.model('Room').findById(r.assignedRoom).select('floor').lean();
    if (room) floors.set(room.floor, (floors.get(room.floor) || 0) + 1);
  }
  const wantFloor = input?.floor !== undefined && input.floor !== '' ? Number(input.floor) : null;
  const taken = new Set();
  const done = [];
  const failed = [];
  for (const r of todo) {
    try {
      const { candidates } = await roomCandidates({ propertyId, reservationId: String(r._id) });
      const ok = candidates.filter((c) => c.assignable && c.sameType && !taken.has(c.id) && (wantFloor === null || c.floor === wantFloor));
      if (!ok.length) throw httpError(wantFloor === null ? 'אין חדר פנוי מהסוג בתאריכים' : `אין חדר פנוי מהסוג בקומה ${wantFloor}`, 409);
      const topFloor = [...floors.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      ok.sort((x, y) => (y.readyNow - x.readyNow) || ((y.floor === topFloor) - (x.floor === topFloor)) || (x.floor - y.floor) || String(x.number).localeCompare(String(y.number), 'he', { numeric: true }));
      const pick = ok[0];
      await assignRoom({ propertyId, reservationId: String(r._id), roomId: pick.id, reason: `שיבוץ קבוצתי ${b.groupCode}`, actor, ip });
      taken.add(pick.id);
      floors.set(pick.floor, (floors.get(pick.floor) || 0) + 1);
      done.push({ confirmationNumber: r.confirmationNumber, room: pick.number, floor: pick.floor });
    } catch (err) { failed.push({ confirmationNumber: r.confirmationNumber, reason: err.message }); }
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.rooms_assigned', entityType: 'GroupBlock', entityId: b._id, after: { assigned: done.length, failed: failed.length, floor: wantFloor }, ip });
  return { done, failed, block: await getBlock({ propertyId, id }) };
}

// Where the group stands for arrival today: assigned, ready, waiting.
async function arrivalState(b) {
  const property = await Property.findById(b.property).select('timezone dayClose frontDeskPolicy').lean();
  const today = businessDateOf(property);
  const res = await Reservation.find({ property: b.property, group: String(b._id), status: { $nin: DEAD_RES } }).select('status arrivalDate assignedRoom').populate('assignedRoom', 'number cleanStatus floor').lean();
  const arriving = res.filter((r) => BOOKED.includes(r.status) && r.arrivalDate <= today);
  const ready = arriving.filter((r) => r.assignedRoom && ['clean', 'inspected'].includes(r.assignedRoom.cleanStatus));
  return { today, total: res.length, arriving: arriving.length, assigned: arriving.filter((r) => r.assignedRoom).length, ready: ready.length, inHouse: res.filter((r) => ['checked_in', 'in_house'].includes(r.status)).length };
}

// Check in every booking of the group that arrives today, has its room and the room is ready.
// The list must be final; each booking goes through the normal check-in (a guest without a guarantee
// stops there and is reported, not skipped silently).
export async function groupCheckIn({ propertyId, id, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId }).lean();
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  if (b.roomingStatus !== 'final') throw httpError('רשימת השמות עוד לא סופית — מסמנים אותה כסופית ואז מכניסים את הקבוצה', 409, { code: 'rooming_not_final' });
  const { completeCheckIn } = await import('./frontDeskService.js');
  const st = await arrivalState(b);
  const res = await Reservation.find({ property: propertyId, group: String(b._id), status: { $in: BOOKED }, arrivalDate: { $lte: st.today } }).select('confirmationNumber assignedRoom primaryGuest').populate('assignedRoom', 'number cleanStatus').populate('primaryGuest', 'firstName lastName').lean();
  const done = [];
  const failed = [];
  for (const r of res) {
    const who = r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : r.confirmationNumber;
    if (!r.assignedRoom) { failed.push({ guest: who, confirmationNumber: r.confirmationNumber, reason: 'אין חדר משובץ' }); continue; }
    if (!['clean', 'inspected'].includes(r.assignedRoom.cleanStatus)) { failed.push({ guest: who, confirmationNumber: r.confirmationNumber, reason: `חדר ${r.assignedRoom.number} עוד לא נקי` }); continue; }
    try {
      await completeCheckIn({ propertyId, reservationId: String(r._id), actor, ip });
      done.push({ guest: who, confirmationNumber: r.confirmationNumber, room: r.assignedRoom.number });
    } catch (err) { failed.push({ guest: who, confirmationNumber: r.confirmationNumber, reason: err.message }); }
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.checked_in', entityType: 'GroupBlock', entityId: b._id, after: { checkedIn: done.length, stopped: failed.length }, ip });
  return { done, failed, block: await getBlock({ propertyId, id }) };
}

// ── Copy / series ──────────────────────────────────────────────────────────────────────────
// Copy the group to other dates — a group that comes back, or a series (one master, copies on dates).
// A copy opens tentative, with the grid, notes and (by choice) the programme, the rooming-list rows
// and the billing profile; its rooms must be free on its own dates.
export async function copyGroup({ propertyId, id, input, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const src = await GroupBlock.findOne({ _id: id, property: propertyId }).lean();
  if (!src) throw httpError('הקבוצה לא נמצאה', 404);
  const dates = [...new Set((Array.isArray(input?.arrivalDates) ? input.arrivalDates : []).filter((d) => YMD.test(String(d))))].sort();
  if (!dates.length) throw httpError('יש לבחור תאריך הגעה לעותק', 422, { fields: { arrivalDates: 'תאריך' } });
  if (dates.length > 12) throw httpError('עד 12 עותקים בפעולה אחת', 422);
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  if (dates.some((d) => d < today)) throw httpError('תאריך שעבר', 422, { fields: { arrivalDates: 'תאריך עבר' } });
  const { daysBetween, addDays } = await import('./groupProgramService.js');
  const { GroupProgramItem } = await import('../models/GroupProgram.js');
  const { kitchenDayOf } = await import('./groupProgramService.js');
  const len = daysBetween(src.arrivalDate, src.departureDate);
  const shift = (d, delta) => (d ? addDays(d, delta) : d);
  const master = input?.asSeries ? (src.seriesOf || src._id) : undefined;
  const created = [];
  for (const arrival of dates) {
    const delta = daysBetween(src.arrivalDate, arrival);
    const departure = addDays(arrival, len);
    const allotments = (src.allotments || []).map((a) => ({
      roomTypeId: a.roomTypeId, roomTypeName: a.roomTypeName, blocked: a.blocked || 0, picked: 0, released: 0, releasedAll: false, negotiatedRate: a.negotiatedRate,
      ...(a.nightly?.length ? { nightly: a.nightly.map((x) => ({ date: addDays(x.date, delta), blocked: x.blocked })) } : {}),
    }));
    const need = new Map(allotments.map((a) => [String(a.roomTypeId), Math.max(a.blocked, ...(a.nightly || []).map((x) => x.blocked))]));
    await assertRoomsFree(propertyId, arrival, departure, need);
    const n = await getNextSequenceValue(`group-block:${propertyId}`);
    const code = `G${arrival.slice(2, 4)}${arrival.slice(5, 7)}-${String(n).padStart(3, '0')}`;
    const copy = await GroupBlock.create({
      property: propertyId, name: src.name, groupCode: code, description: src.description, status: 'tentative',
      arrivalDate: arrival, departureDate: departure, cutoffDate: shift(src.cutoffDate, delta), autoReleaseOnCutoff: src.autoReleaseOnCutoff !== false,
      allotments, ratePlan: src.ratePlan, company: src.company, contactName: src.contactName, contactEmail: src.contactEmail, contactPhone: src.contactPhone,
      cancellationPolicy: src.cancellationPolicy, depositPolicy: src.depositPolicy, depositAmount: src.depositAmount || 0, depositDueDate: shift(src.depositDueDate, delta),
      internalNotes: src.internalNotes, guestNotes: src.guestNotes, stayType: src.stayType, pax: src.pax, minPax: src.minPax, freePaxPer: src.freePaxPer, freePaxCount: src.freePaxCount,
      roomingList: input?.withRoster ? (src.roomingList || []).map((r) => ({ guestName: r.guestName, guestPhone: r.guestPhone, guestEmail: r.guestEmail, roomTypeId: r.roomTypeId, roomTypeName: r.roomTypeName, adults: r.adults, children: r.children, share: r.share, notes: r.notes, arrivalDate: shift(r.arrivalDate, delta), departureDate: shift(r.departureDate, delta) })) : [],
      roomingStatus: 'none',
      billing: input?.withBilling && src.billing ? { ...src.billing, dueDate: shift(src.billing.dueDate, delta), updatedByName: actor.name, updatedAt: new Date() } : undefined,
      seriesOf: master, copiedFrom: src._id, createdBy: actor.id || undefined,
    });
    await syncBlock(copy);
    let items = 0;
    if (input?.withProgram) {
      const prog = await GroupProgramItem.find({ property: propertyId, group: src._id }).lean();
      if (prog.length) {
        await GroupProgramItem.insertMany(prog.map(({ _id, createdAt, updatedAt, __v, ...rest }) => { const date = addDays(rest.date, delta); return { ...rest, group: copy._id, date, kitchenDay: kitchenDayOf(date, rest.start), createdByName: actor.name, updatedByName: undefined }; }));
        items = prog.length;
      }
    }
    created.push({ id: String(copy._id), groupCode: code, arrivalDate: arrival, departureDate: departure, programItems: items });
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: input?.asSeries ? 'group.series_created' : 'group.copied', entityType: 'GroupBlock', entityId: src._id, after: { copies: created.map((c) => c.groupCode), withProgram: !!input?.withProgram, withRoster: !!input?.withRoster, withBilling: !!input?.withBilling }, ip });
  return { created };
}

const splitName = (full, fallback) => {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] || fallback, lastName: fallback };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
};

// Book every row that has no booking yet: a row books a room from the block; a Share row joins the
// room of the row above it (its own window in that booking). Each row is its own operation, so one
// refusal does not stop the rest — the result says what was done and what was not, and why.
export async function bookRoster({ propertyId, id, actor, ip }) {
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const b = await GroupBlock.findOne({ _id: id, property: propertyId }).lean();
  if (!b) throw httpError('הקבוצה לא נמצאה', 404);
  if (!LIVE_BLOCK.includes(b.status)) throw httpError('הקבוצה אינה פעילה', 409);
  const { addShare } = await import('./stayToolsService.js');
  const done = [];
  const failed = [];
  let lastRes = null;
  for (const r of b.roomingList) {
    if (r.reservationId) { lastRes = r.share ? lastRes : String(r.reservationId); continue; }
    const label = r.guestName;
    try {
      if (r.share) {
        if (!lastRes) throw httpError('אין חדר מעליו לחלוק', 422);
        await addShare({ propertyId, reservationId: lastRes, input: { newGuest: { ...splitName(r.guestName, b.name), phone: r.guestPhone }, split: 'none' }, actor, ip });
        await GroupBlock.updateOne({ _id: b._id, 'roomingList._id': r._id }, { $set: { 'roomingList.$.reservationId': lastRes } });
        done.push({ guest: label, share: true });
        continue;
      }
      if (!r.roomTypeId) throw httpError('לא נבחר סוג חדר', 422);
      const out = await pickupFromBlock({
        propertyId, id, actor, ip,
        input: {
          roomTypeId: String(r.roomTypeId), rosterId: String(r._id), arrival: r.arrivalDate, departure: r.departureDate, adults: r.adults || 2, children: r.children || 0,
          // A participant without a phone or e-mail is reached through the group's contact.
          newGuest: { ...splitName(r.guestName, b.name), phone: r.guestPhone || b.contactPhone, email: r.guestEmail || (!r.guestPhone && !b.contactPhone ? b.contactEmail : undefined) }, forceNewGuest: true, idempotencyKey: `roster-${r._id}`,
        },
      });
      lastRes = out.reservationId;
      done.push({ guest: label, confirmationNumber: out.confirmationNumber });
    } catch (err) {
      const why = err.fields?.phone ? 'חסר טלפון או דוא״ל — לאורח או לאיש הקשר של הקבוצה' : err.fields ? `${err.message}: ${Object.values(err.fields).join(', ')}` : err.message;
      failed.push({ guest: label, reason: why });
      if (!r.share) lastRes = null;
    }
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.rooming_booked', entityType: 'GroupBlock', entityId: b._id, after: { booked: done.length, failed: failed.length }, ip });
  return { done, failed, block: await getBlock({ propertyId, id }) };
}
