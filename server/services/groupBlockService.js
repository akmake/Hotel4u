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
const DEAD_RES = ['cancelled', 'no_show', 'draft'];
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

function remainingOf(block, picked) {
  if (!LIVE_BLOCK.includes(block.status)) return new Map();
  const out = new Map();
  for (const a of block.allotments || []) {
    const k = String(a.roomTypeId);
    const left = Math.max(0, (a.blocked || 0) - (picked.get(k) || 0) - (a.released || 0));
    out.set(k, (out.get(k) || 0) + left);
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
    const rem = remainingOf(b, picked);
    const pending = b.pickupPending || {};
    for (const d of getStayDates(b.arrivalDate, b.departureDate)) {
      for (const [type, n] of rem) {
        const k = `${type}|${d}`;
        held.set(k, (held.get(k) || 0) + Math.max(0, n - Math.max(0, Number(pending[type] || 0))));
      }
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
    for (const a of b.allotments) a.released = Math.max(0, (a.blocked || 0) - (picked.get(String(a.roomTypeId)) || 0));
    b.releasedAt = new Date();
    await b.save();
    await syncBlock(b);
    await audit({ property: propertyId, actorName: 'system', action: 'group.auto_released', entityType: 'GroupBlock', entityId: b._id, after: { cutoffDate: b.cutoffDate } }).catch(() => null);
  }
}

async function blockDto(b, { withRes = false } = {}) {
  const picked = await pickedByType(b);
  const allotments = (b.allotments || []).map((a) => {
    const p = picked.get(String(a.roomTypeId)) || 0;
    return {
      roomTypeId: String(a.roomTypeId), roomTypeName: a.roomTypeName || '—', blocked: a.blocked || 0, picked: p, released: a.released || 0,
      remaining: LIVE_BLOCK.includes(b.status) ? Math.max(0, (a.blocked || 0) - p - (a.released || 0)) : 0, negotiatedRate: a.negotiatedRate ?? null,
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
    allotments, totals: { blocked: sum('blocked'), picked: sum('picked'), released: sum('released'), remaining: sum('remaining') },
    pickupPct: sum('blocked') ? Math.round((sum('picked') / sum('blocked')) * 100) : 0,
    roomingList: (b.roomingList || []).map((r) => ({ id: String(r._id), guestName: r.guestName || '', guestPhone: r.guestPhone || '', guestEmail: r.guestEmail || '', roomTypeId: r.roomTypeId ? String(r.roomTypeId) : null, roomTypeName: r.roomTypeName || null, reservationId: r.reservationId ? String(r.reservationId) : null, notes: r.notes || null })),
  };
  if (withRes) {
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
      allotments.push({ roomTypeId: t._id, roomTypeName: t.name, blocked, picked: 0, released: prev?.released || 0, negotiatedRate: a.negotiatedRate !== '' && a.negotiatedRate != null && Number(a.negotiatedRate) > 0 ? round2(a.negotiatedRate) : undefined });
    }
    if (!allotments.some((a) => a.blocked > 0)) errors.allotments = 'לפחות סוג חדר אחד עם חדרים';
  }
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
    name, arrivalDate, departureDate, cutoffDate: cutoffDate || undefined, allotments,
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
    for (const a of b.allotments) if (!roomTypeId || String(a.roomTypeId) === String(roomTypeId)) a.released = Math.max(0, (a.blocked || 0) - (picked.get(String(a.roomTypeId)) || 0));
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
  const left = Math.max(0, (a.blocked || 0) - (picked.get(String(a.roomTypeId)) || 0) - (a.released || 0));
  if (left < 1) throw httpError(`לא נותרו חדרים מסוג ${a.roomTypeName} בבלוק`, 409, { code: 'block_full' });
  const arrival = YMD.test(input?.arrival || '') ? input.arrival : b.arrivalDate;
  const departure = YMD.test(input?.departure || '') ? input.departure : b.departureDate;
  if (arrival < b.arrivalDate || departure > b.departureDate || departure <= arrival) throw httpError(`תאריכי ההזמנה בתוך תאריכי הקבוצה (${b.arrivalDate} – ${b.departureDate})`, 422, { fields: { arrival: 'מחוץ לטווח' } });
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
  const types = new Map(b.allotments.map((a) => [String(a.roomTypeId), a.roomTypeName]));
  const keep = new Map(b.roomingList.filter((r) => r.reservationId).map((r) => [String(r._id), r]));
  const next = [...keep.values()];
  for (const e of entries.slice(0, 500)) {
    if (e.id && keep.has(String(e.id))) continue;
    const name = String(e.guestName || '').trim().slice(0, 120);
    if (!name) continue;
    const typeId = types.has(String(e.roomTypeId)) ? e.roomTypeId : undefined;
    next.push({ guestName: name, guestPhone: String(e.guestPhone || '').trim().slice(0, 30) || undefined, guestEmail: String(e.guestEmail || '').trim().slice(0, 120) || undefined, roomTypeId: typeId, roomTypeName: typeId ? types.get(String(typeId)) : undefined, notes: String(e.notes || '').trim().slice(0, 300) || undefined });
  }
  b.roomingList = next;
  await b.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'group.rooming_list_saved', entityType: 'GroupBlock', entityId: b._id, after: { count: next.length }, ip });
  return getBlock({ propertyId, id });
}
