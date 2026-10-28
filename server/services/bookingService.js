// Booking (spec W01: INV-03 availability & price, RSV-02 create, RSV-04 quote, RSV-01 list,
// RSV-03 stay file).
//
// Rules enforced here (server-side):
//  - the price is computed on the server from the rate calendar — never taken from the client;
//    a manual price is a manager decision with a reason;
//  - availability and price are re-checked at confirmation; if the price the user saw has changed
//    the booking is refused with the new price (T02); selling the last room is serialised (T01);
//  - a night without inventory or without a rate is not sellable — no silent fallback;
//  - restrictions (stop-sell, closed to arrival/departure, min/max stay) are checked per night;
//  - the agreed price and terms are frozen on the reservation (snapshot);
//  - a quote is not a booking: it holds inventory only when asked, until its validity ends;
//    an expired hold releases its inventory.
import crypto from 'crypto';
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import RoomType from '../models/RoomType.js';
import Property from '../models/Property.js';
import GuestProfile from '../models/GuestProfile.js';
import Company from '../models/Company.js';
import Folio from '../models/Folio.js';
import Invoice from '../models/Invoice.js';
import GuestRequest from '../models/GuestRequest.js';
import AuditLog from '../models/AuditLog.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import { priceNight } from './ratePricing.js';
import { audit } from './auditService.js';
import { nightlyAvailability, getStayDates, incrementInventory, checkAvailability } from './availabilityService.js';
import { createReservation } from './reservationService.js';
import { withLocks } from './locks.js';
import { runStayTransaction } from './stayTransaction.js';
import { payloadHash } from '../domain/accounting.js';
import { httpError, businessDateOf, MANAGER_ROLES, IN_HOUSE_STATUSES } from './frontDeskService.js';
import { folioBalance } from './departureService.js';
import { partyMembers } from './partyBookingService.js';
import { boardOfPlan, supplementPerNight, BOARD_LABELS, BOARDS } from './boardService.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NIGHTS = 60;
const OFFER_TTL_MIN = 15;

export const BOOKING_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'sales_manager', 'revenue_manager'];
export const PRICE_OVERRIDE_ROLES = [...new Set([...MANAGER_ROLES, 'revenue_manager', 'sales_manager'])];
export const SOURCES = ['direct', 'phone', 'walk_in', 'corporate', 'agent', 'booking', 'expedia', 'agoda', 'airbnb', 'gds'];

function signature(nightly) {
  return crypto.createHash('sha1').update(nightly.map((n) => `${n.date}:${round2(n.price)}`).join('|')).digest('hex').slice(0, 16);
}

function policyText(property, plan) {
  if (plan && plan.isRefundable === false) return { code: 'non_refundable', text: 'ללא החזר — לפי תנאי התעריף, בכפוף לזכויות לפי דין' };
  const hours = Number(property?.defaultCancellationHours ?? 24);
  const setting = property?.defaultCancellationFee;
  const fixed = setting !== 'first_night' && setting !== 'none' && Number(setting) > 0 ? Number(setting) : 0;
  const after = setting === 'none' ? '' : fixed ? `; לאחר מכן דמי ביטול ${fixed} ש״ח` : '; לאחר מכן חיוב הלילה הראשון';
  return { code: `free_${hours}h_${setting || 'first_night'}`, text: `ביטול ללא חיוב עד ${hours} שעות לפני ההגעה${after} (בכפוף לזכויות לפי דין)` };
}

function depositText(plan) {
  if (plan?.depositPolicy) return plan.depositPolicy;
  return plan && plan.isRefundable === false ? 'תשלום מלא בעת ההזמנה' : 'ללא מקדמה חובה; ערבות לפי מדיניות הכניסה';
}

function validateStay({ arrival, departure, adults, children, rooms, today }) {
  const fields = {};
  if (!YMD.test(arrival || '')) fields.arrival = 'תאריך כניסה נדרש';
  if (!YMD.test(departure || '')) fields.departure = 'תאריך יציאה נדרש';
  const nights = YMD.test(arrival || '') && YMD.test(departure || '') ? getStayDates(arrival, departure).length : 0;
  if (!fields.arrival && !fields.departure && nights < 1) fields.departure = 'היציאה חייבת להיות אחרי הכניסה (לילה אחד לפחות)';
  if (nights > MAX_NIGHTS) fields.departure = `עד ${MAX_NIGHTS} לילות בהזמנה אחת`;
  if (!fields.arrival && arrival < today) fields.arrival = 'לא ניתן להזמין לתאריך שעבר';
  const a = Number(adults); const c = Number(children || 0); const r = Number(rooms || 1);
  if (!(Number.isInteger(a) && a >= 1 && a <= 40)) fields.adults = 'לפחות מבוגר אחד';
  if (!(Number.isInteger(c) && c >= 0 && c <= 20)) fields.children = 'מספר ילדים לא תקין';
  if (!(Number.isInteger(r) && r >= 1 && r <= 20)) fields.rooms = '1 עד 20 יחידות';
  if (Number.isInteger(a) && Number.isInteger(r) && r > a) fields.rooms = 'כל יחידה צריכה מבוגר אחד לפחות';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי השהייה', 422, { fields });
  return { nights, adults: a, children: c, rooms: r };
}

async function offersFor({ propertyId, property, roomType, plans, arrival, departure, adults, children, rooms, nights, board, childAges, session = null, excludeReservationId = null }) {
  const dates = getStayDates(arrival, departure);
  const perRoomAdults = Math.ceil(adults / rooms);
  const perRoomChildren = Math.ceil(children / rooms);
  // childrenMax 0 means "no separate child limit" (older room types); capacityMax always applies.
  const capMax = roomType.capacityMax || 2;
  const adultMax = roomType.adultsMax || capMax;
  const capacityIssue = perRoomAdults > adultMax || perRoomAdults + perRoomChildren > capMax
    || (roomType.childrenMax > 0 && perRoomChildren > roomType.childrenMax);
  const inv = await nightlyAvailability({ propertyId, roomTypeId: roomType._id, arrivalDate: arrival, departureDate: departure, session, excludeReservationId });
  const nightsAvail = inv.nights;
  const minAvail = Math.min(inv.freeRooms, ...nightsAvail.map((n) => (n.missing ? 0 : n.available)));
  const invReasons = [];
  const missingInv = nightsAvail.filter((n) => n.missing).map((n) => n.date);
  if (missingInv.length) invReasons.push({ code: 'missing_inventory', label: `אין מלאי מוגדר ל־${missingInv.slice(0, 3).join(', ')}${missingInv.length > 3 ? '…' : ''}` });
  if (nightsAvail.some((n) => n.stopSell)) invReasons.push({ code: 'stop_sell', label: 'סגור למכירה בחלק מהלילות' });
  if (nightsAvail[0]?.closedToArrival) invReasons.push({ code: 'cta', label: 'סגור להגעה בתאריך הכניסה' });
  if (!missingInv.length && minAvail < rooms) invReasons.push({ code: 'sold_out', label: minAvail > 0 ? `נותרו ${minAvail} יחידות בלבד` : 'אין מקום פנוי בכל הלילות' });
  if (capacityIssue) invReasons.push({ code: 'capacity', label: `הרכב של ${perRoomAdults} מבוגרים${perRoomChildren ? ` ו־${perRoomChildren} ילדים` : ''} ליחידה חורג מקיבולת החדר` });

  // Parents of derived rates take part in pricing even when they are not offered here.
  const parentIds = [...new Set(plans.map((p) => p.derived?.from && String(p.derived.from)).filter(Boolean))];
  const missingParents = parentIds.filter((id) => !plans.some((p) => String(p._id) === id));
  const parents = new Map([...plans, ...(missingParents.length ? await RatePlan.find({ _id: { $in: missingParents } }).lean() : [])].map((p) => [String(p._id), p]));
  const rds = await RateDate.find({ roomType: roomType._id, ratePlan: { $in: [...plans.map((p) => p._id), ...missingParents] }, date: { $in: [...dates, departure] } }).lean();
  const byPlan = new Map();
  for (const rd of rds) {
    const k = String(rd.ratePlan);
    if (!byPlan.has(k)) byPlan.set(k, new Map());
    byPlan.get(k).set(rd.date, rd);
  }
  return plans
    .filter((p) => !p.activeRoomTypes?.length || p.activeRoomTypes.some((id) => String(id) === String(roomType._id)))
    .map((plan) => {
      const cal = byPlan.get(String(plan._id)) || new Map();
      const reasons = [...invReasons];
      const nightly = [];
      const missingRate = [];
      const today = businessDateOf(property);
      for (const d of dates) {
        const rd = cal.get(d);
        if (rd?.stopSell) reasons.push({ code: 'rate_closed', label: `התעריף סגור ל־${d}` });
        const parentPlan = plan.derived?.from ? parents.get(String(plan.derived.from)) : null;
        const parent = parentPlan ? { plan: parentPlan, rd: byPlan.get(String(parentPlan._id))?.get(d) } : null;
        const p = priceNight({ plan, roomType, rd, date: d, adults: perRoomAdults, children: perRoomChildren, los: nights, today, parent });
        if (p.price === null) { missingRate.push(d); continue; }
        nightly.push({ date: d, price: p.price });
      }
      if (missingRate.length) reasons.push({ code: 'missing_rate', label: `אין מחיר ל־${missingRate.slice(0, 3).join(', ')}${missingRate.length > 3 ? '…' : ''} — אין מחיר בלוח התעריפים ואין מחיר בסיס לסוג החדר` });
      const first = cal.get(arrival);
      if (first?.cta) reasons.push({ code: 'cta', label: 'התעריף סגור להגעה בתאריך זה' });
      if (cal.get(departure)?.ctd) reasons.push({ code: 'ctd', label: 'התעריף סגור ליציאה בתאריך זה' });
      const minLos = Math.max(Number(first?.minLos || 1), Number(nightsAvail[0]?.minLos || 1));
      const maxLos = Number(first?.maxLos || nightsAvail[0]?.maxLos || 0);
      if (nights < minLos) reasons.push({ code: 'min_los', label: `מינימום ${minLos} לילות` });
      if (maxLos && nights > maxLos) reasons.push({ code: 'max_los', label: `מקסימום ${maxLos} לילות` });
      // G2 board: included in the plan ("by rate") or a per-person supplement on a room-only plan ("by board").
      const planBoard = boardOfPlan(plan);
      const wanted = BOARDS.includes(board) ? board : planBoard;
      let supp = 0;
      if (planBoard !== 'room_only' && wanted !== planBoard) reasons.push({ code: 'board_in_plan', label: `התעריף כולל ${BOARD_LABELS[planBoard]} — לאירוח אחר בחרו תעריף "לינה בלבד"` });
      if (planBoard === 'room_only' && wanted !== 'room_only') {
        supp = supplementPerNight({ property, board: wanted, adults: perRoomAdults, children: perRoomChildren, childAges: rooms === 1 ? childAges : undefined });
        if (supp === null) { reasons.push({ code: 'board_unpriced', label: `לא הוגדר מחיר ל${BOARD_LABELS[wanted]} (הגדרות ← סוגי אירוח)` }); supp = 0; }
      }
      const boardNightly = supp > 0 ? nightly.map((n) => ({ date: n.date, price: supp })) : [];
      const roomPerRoom = round2(nightly.reduce((s, n) => s + n.price, 0));
      const perRoom = round2(roomPerRoom + supp * nightly.length);
      const total = round2(perRoom * rooms);
      const seen = new Set();
      const uniq = reasons.filter((r) => (seen.has(r.label) ? false : seen.add(r.label)));
      return {
        roomType: { id: String(roomType._id), code: roomType.code, name: roomType.name, capacityMax: roomType.capacityMax, bedType: roomType.bedType || null, view: roomType.view || null },
        ratePlan: { id: String(plan._id), code: plan.code, name: plan.name, type: plan.type, refundable: plan.isRefundable !== false, breakfast: planBoard !== 'room_only', board: planBoard },
        board: { type: wanted, source: planBoard !== 'room_only' ? 'plan' : (supp > 0 ? 'supplement' : 'none'), perNight: supp, total: round2(supp * nightly.length), nightly: boardNightly },
        roomPerRoom,
        nightly, perRoom, total, averageNight: nightly.length ? round2(perRoom / nightly.length) : 0,
        available: Math.max(0, minAvail), availability: nightsAvail.map((n) => ({ date: n.date, available: n.missing ? null : n.available })),
        bookable: uniq.length === 0 && nightly.length === dates.length,
        reasons: uniq,
        vatIncluded: true, vatRate: property?.vatRate ?? 18,
        cancellation: policyText(property, plan), deposit: depositText(plan),
        priceSignature: signature(nightly.map((n) => ({ date: n.date, price: n.price + supp }))),
      };
    });
}

// ── INV-03 ──────────────────────────────────────────────────────────────────
export async function searchAvailability({ propertyId, query, session = null, excludeReservationId = null }) {
  const property = await Property.findById(propertyId).session(session).select('timezone vatRate defaultCancellationHours defaultCancellationFee defaultCurrency boardPricing childMaxAge dayClose').lean();
  if (!property) throw httpError('הנכס לא נמצא', 404);
  const today = businessDateOf(property);
  const stay = validateStay({ arrival: query.arrival, departure: query.departure, adults: Number(query.adults ?? 2), children: Number(query.children ?? 0), rooms: Number(query.rooms ?? 1), today });
  // Expiry maintenance belongs outside an in-progress booking transaction.
  if (!session) await releaseExpiredHolds({ propertyId }).catch(() => null);
  const rtFilter = { property: propertyId, active: { $ne: false }, sellable: { $ne: false }, closedToSale: { $ne: true } };
  if (isId(String(query.roomTypeId || ''))) rtFilter._id = query.roomTypeId;
  const planFilter = { property: propertyId, active: { $ne: false } };
  if (isId(String(query.ratePlanId || ''))) planFilter._id = query.ratePlanId;
  const roomTypes = await RoomType.find(rtFilter).session(session).sort({ sortOrder: 1, baseRate: 1 }).lean();
  const plans = await RatePlan.find(planFilter).session(session).sort({ sortOrder: 1, code: 1 }).lean();
  const offers = [];
  const childAges = Array.isArray(query.childAges) ? query.childAges.map(Number) : String(query.childAges || '').split(',').filter((x) => x !== '').map(Number);
  for (const rt of roomTypes) offers.push(...await offersFor({ propertyId, property, roomType: rt, plans, arrival: query.arrival, departure: query.departure, ...stay, board: query.board, childAges, session, excludeReservationId }));
  return {
    arrival: query.arrival, departure: query.departure, nights: stay.nights, adults: stay.adults, children: stay.children, rooms: stay.rooms,
    currency: property.defaultCurrency || 'ILS', businessDate: today,
    validUntil: new Date(Date.now() + OFFER_TTL_MIN * 60000).toISOString(),
    offers,
  };
}

export async function resolveOffer({ propertyId, input, session = null, excludeReservationId = null }) {
  if (!isId(String(input.roomTypeId || '')) || !isId(String(input.ratePlanId || ''))) throw httpError('יש לבחור סוג חדר ותעריף', 422, { fields: { offer: 'בחירה נדרשת' } });
  const res = await searchAvailability({ propertyId, query: { ...input, arrival: input.arrival, departure: input.departure }, session, excludeReservationId });
  const offer = res.offers.find((o) => o.roomType.id === String(input.roomTypeId) && o.ratePlan.id === String(input.ratePlanId));
  if (!offer) throw httpError('התעריף אינו זמין לסוג החדר שנבחר', 422);
  return { search: res, offer };
}

// Guest: an existing profile in scope, or a new one — possible duplicates are surfaced first.
export async function resolveGuest({ propertyId, input, actor, ip, session = null, afterCommit = null }) {
  if (input.guestId) {
    if (!isId(String(input.guestId))) throw httpError('אורח לא תקין', 422);
    const g = await GuestProfile.findOne({ _id: input.guestId, property: propertyId }).session(session).lean();
    if (!g) throw httpError('האורח לא נמצא בנכס', 422, { fields: { guest: 'לא נמצא' } });
    if (g.isBlacklisted) throw httpError(`האורח ברשימה השחורה${g.blacklistReason ? `: ${g.blacklistReason}` : ''} — נדרש אישור מנהל`, 409, { code: 'blacklisted' });
    return g;
  }
  const n = input.newGuest || {};
  const firstName = String(n.firstName || '').trim().slice(0, 60);
  const lastName = String(n.lastName || '').trim().slice(0, 60);
  const phone = String(n.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
  const email = String(n.email || '').trim().toLowerCase().slice(0, 120);
  const fields = {};
  if (!firstName) fields.firstName = 'שם פרטי נדרש';
  if (!lastName) fields.lastName = 'שם משפחה נדרש';
  if (!phone && !email) fields.phone = 'טלפון או דוא״ל ליצירת קשר';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'כתובת לא תקינה';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי האורח', 422, { fields });
  if (!input.forceNewGuest) {
    const or = [];
    if (email) or.push({ email });
    if (phone) or.push({ phone });
    const dups = or.length ? await GuestProfile.find({ property: propertyId, isAnonymized: { $ne: true }, $or: or }).select('firstName lastName phone email').limit(5).lean() : [];
    if (dups.length) {
      throw httpError('נמצא אורח קיים עם אותו טלפון או דוא״ל', 409, {
        code: 'possible_duplicate',
        details: dups.map((d) => ({ id: String(d._id), name: `${d.firstName} ${d.lastName}`, phone: d.phone || null, email: d.email || null })),
      });
    }
  }
  const [g] = await GuestProfile.create([{ property: propertyId, firstName, lastName, phone: phone || undefined, email: email || undefined, language: n.language || 'he' }], { session });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'guest.created', entityType: 'GuestProfile', entityId: g._id, after: { source: 'booking' }, ip, session, afterCommit });
  return g.toObject();
}

// ── RSV-02 / RSV-04 create ──────────────────────────────────────────────────
export async function createBooking({ propertyId, input, actor, ip, session = null, afterCommit = null, preferredRoomId = null, excludedRoomIds = [] }) {
  const key = String(input.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw httpError('חסר מזהה פעולה (idempotency key)', 422);
  // A party owns the inventory locks and transaction for all its members.
  if (session) return createBookingLocked({ propertyId, input, actor, ip, session, afterCommit, preferredRoomId, excludedRoomIds });
  return withLocks([`booking:${propertyId}:${key}`, `inv:${propertyId}:${input.roomTypeId}`],
    (lease) => runStayTransaction((session, afterCommit) => createBookingLocked({ propertyId, input, actor, ip, session, afterCommit }), lease, { operation: 'יצירת הזמנה' }), { waitMs: 4000 });
}

async function createBookingLocked({ propertyId, input, actor, ip, session, afterCommit, preferredRoomId = null, excludedRoomIds = [] }) {
  const mode = ['confirm', 'hold', 'draft', 'quote'].includes(input.mode) ? input.mode : 'confirm';
  const key = String(input.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw httpError('חסר מזהה פעולה (idempotency key)', 422);
  // Client totals are ignored by pricing and therefore must not change retry identity.
  const { idempotencyKey: ignoredKey, propertyId: ignoredProperty, ratePerNight: ignoredRate, totalAmount: ignoredTotal, ...body } = input;
  const requestHash = payloadHash(body);
  const existing = await Reservation.findOne({ property: propertyId, idempotencyKey: key }).session(session).select('_id confirmationNumber status totalAmount bookingRequestHash').lean();
  if (existing) {
    if (existing.bookingRequestHash !== requestHash) throw httpError('מזהה הפעולה כבר שימש להזמנה עם פרטים אחרים או ללא זיהוי תוכן — יש לפתוח את ההזמנה הקיימת', 409, { code: 'request_conflict' });
    return { id: String(existing._id), confirmationNumber: existing.confirmationNumber, status: existing.status, total: existing.totalAmount, duplicate: true };
  }

  const { offer, search } = await resolveOffer({ propertyId, input, session });
  const property = await Property.findById(propertyId).select('timezone vatRate dayClose').lean();
  const fields = {};
  if (!SOURCES.includes(input.source || 'direct')) fields.source = 'ערוץ לא מוכר';
  if (search.children > 0) {
    const ages = Array.isArray(input.childAges) ? input.childAges.map(Number) : [];
    if (ages.length !== search.children || ages.some((a) => !Number.isInteger(a) || a < 0 || a > 17)) fields.childAges = 'יש לציין גיל לכל ילד (0–17)';
  }
  let company = null;
  if (input.companyId) {
    if (!isId(String(input.companyId))) fields.companyId = 'חברה לא תקינה';
    else company = await Company.findOne({ _id: input.companyId, property: propertyId, active: { $ne: false } }).select('name creditLimit').lean();
    if (input.companyId && !company) fields.companyId = 'החברה לא נמצאה או אינה פעילה';
  }
  if (input.payerType === 'company' && !company) fields.companyId = 'משלם חברה מחייב בחירת חברה';
  let validUntil = null;
  let holdUntil = null;
  if (mode === 'quote') {
    validUntil = input.validUntil && !Number.isNaN(Date.parse(input.validUntil)) ? new Date(input.validUntil) : null;
    if (!validUntil || validUntil <= new Date()) fields.validUntil = 'תוקף ההצעה חייב להיות בעתיד';
    else if (validUntil > new Date(Date.now() + 30 * 86400000)) fields.validUntil = 'תוקף עד 30 יום';
  }
  if (mode === 'hold') {
    const minutes = Math.min(7 * 24 * 60, Math.max(15, Number(input.holdMinutes) || 0));
    if (!Number(input.holdMinutes)) fields.holdMinutes = 'יש לקבוע עד מתי להחזיק';
    holdUntil = new Date(Date.now() + minutes * 60000);
  }
  if (mode === 'draft' && offer.nightly.length !== search.nights) fields.offer = 'אין מחיר לכל הלילות — לא ניתן לשמור';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי ההזמנה', 422, { fields });

  // Price: the server's, unless a permitted manager overrides it with a reason.
  let nightly = offer.nightly; // lodging per night (room only); the board is kept apart
  let override = null;
  if (input.override?.ratePerNight !== undefined && input.override?.ratePerNight !== null && input.override?.ratePerNight !== '') {
    if (!PRICE_OVERRIDE_ROLES.includes(actor.role)) throw httpError('שינוי מחיר ידני מותר למנהל או להכנסות', 403);
    const rate = round2(input.override.ratePerNight);
    const why = String(input.override.reason || '').trim().slice(0, 300);
    if (!(rate > 0)) throw httpError('מחיר לא תקין', 422, { fields: { override: 'מחיר חיובי' } });
    if (why.length < 3) throw httpError('מחיר ידני מחייב סיבה', 422, { fields: { overrideReason: 'יש לפרט סיבה' } });
    nightly = offer.nightly.map((n) => ({ date: n.date, price: rate }));
    override = { by: actor.name, reason: why };
  } else if (input.priceSignature && input.priceSignature !== offer.priceSignature) {
    // T02: the price shown is no longer the price — never commit on an old snapshot.
    throw httpError('המחיר השתנה מאז שהוצג — יש לאשר את המחיר החדש', 409, { code: 'price_changed', details: [{ total: offer.total, perRoom: offer.perRoom, priceSignature: offer.priceSignature, nightly: offer.nightly }] });
  }
  // Only a draft may be saved for something that cannot be sold right now (it holds nothing).
  if (mode !== 'draft' && !offer.bookable) {
    throw httpError(offer.reasons[0]?.label || 'לא ניתן למכור את ההצעה', 409, { code: 'not_bookable', details: offer.reasons });
  }

  const guest = await resolveGuest({ propertyId, input, actor, ip, session, afterCommit });
  const roomPerRoom = round2(nightly.reduce((s, n) => s + n.price, 0));
  const perRoom = round2(roomPerRoom + Number(offer.board?.total || 0));
  const total = round2(perRoom * search.rooms);
  const avgRate = round2(roomPerRoom / search.nights);
  const status = { confirm: 'confirmed', hold: 'hold', draft: 'draft', quote: input.holdInventory ? 'hold' : 'quote' }[mode];
  let res;
  try {
    res = await createReservation({
      propertyId, session, afterCommit, preferredRoomId, excludedRoomIds,
      actorId: actor.id,
      actorName: actor.name,
      ip,
      data: {
        roomTypeId: offer.roomType.id, ratePlanId: offer.ratePlan.id, arrivalDate: search.arrival, departureDate: search.departure,
        primaryGuestId: guest._id, adults: search.adults, children: search.children, roomsCount: search.rooms,
        ratePerNight: avgRate, source: input.source || 'direct', specialRequests: input.specialRequests ? String(input.specialRequests).slice(0, 1000) : undefined,
        internalNotes: input.internalNotes ? String(input.internalNotes).slice(0, 1000) : undefined,
        companyId: company?._id, idempotencyKey: key, bookingStatus: status,
        cancellationPolicy: offer.cancellation.text, depositPolicy: offer.deposit,
        holdExpiresAt: status === 'hold' ? (holdUntil || validUntil) : undefined,
        quoteExpiresAt: validUntil || undefined, language: input.language || 'he',
        guaranteeType: company && input.payerType === 'company' ? 'company_guarantee' : 'none',
      },
    });
  } catch (e) {
    if (/No availability/i.test(e?.message || '')) throw httpError('היחידה האחרונה נמכרה בינתיים — בדקו זמינות מחדש', 409, { code: 'sold_out' });
    throw e;
  }
  await Reservation.updateOne({ _id: res._id }, {
    $set: {
      totalAmount: total,
      taxAmount: round2(total - total / (1 + Number(property?.vatRate ?? 18) / 100)),
      bookingRequestHash: requestHash,
      priceSnapshot: { ratePlanCode: offer.ratePlan.code, ratePlanName: offer.ratePlan.name, nightly, total, vatRate: property?.vatRate ?? 18, refundable: offer.ratePlan.refundable, computedAt: new Date(), ...(override ? { override } : {}), board: { type: offer.board.type, source: offer.board.source, nightly: offer.board.nightly } },
      board: offer.board.type,
      ...(input.residency === 'tourist' ? { tourist: { nonResident: true } } : {}),
      booker: input.booker && (input.booker.name || input.booker.phone || input.booker.email) ? { name: String(input.booker.name || '').slice(0, 120), phone: String(input.booker.phone || '').slice(0, 30), email: String(input.booker.email || '').slice(0, 120) } : undefined,
      payerType: ['guest', 'company', 'booker'].includes(input.payerType) ? input.payerType : 'guest',
      childAges: search.children ? input.childAges.map(Number) : [],
      ...(mode === 'quote' ? { quote: { version: 1, validUntil, language: input.language || 'he', channel: ['email', 'link', 'print'].includes(input.channel) ? input.channel : 'email' } } : {}),
    },
  }, { session });
  if (override) await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.price_override', entityType: 'Reservation', entityId: res._id, reason: override.reason, before: { total: offer.total }, after: { total }, ip, session, afterCommit });
  return { id: String(res._id), confirmationNumber: res.confirmationNumber, status, total, duplicate: false };
}

// ── RSV-04 quote lifecycle ──────────────────────────────────────────────────
async function loadQuote(propertyId, id, session = null) {
  if (!isId(String(id || ''))) throw httpError('מזהה לא תקין', 400);
  const r = await Reservation.findOne({ _id: id, property: propertyId }).session(session);
  if (!r) throw httpError('ההצעה לא נמצאה', 404);
  return r;
}

async function quoteTransaction(propertyId, id, work) {
  const first = await loadQuote(propertyId, id);
  return withLocks([`res:${id}`, `inv:${propertyId}:${first.roomType}`],
    (lease) => runStayTransaction(async (session, afterCommit) => {
      const current = await loadQuote(propertyId, id, session);
      if (String(current.roomType) !== String(first.roomType)) throw httpError('סוג החדר השתנה — רעננו את ההצעה', 409, { code: 'version_conflict' });
      return work(current, session, afterCommit);
    }, lease, { operation: 'עדכון הצעה או אופציה' }), { waitMs: 4000 });
}

export async function markQuoteSent({ propertyId, id, channel, actor, ip }) {
  return quoteTransaction(propertyId, id, async (r, session, afterCommit) => {
    if (!r.quote?.version) throw httpError('הרשומה אינה הצעת מחיר', 422);
    if (!['quote', 'hold'].includes(r.status)) throw httpError('ההצעה כבר הומרה או נסגרה', 409);
    if (r.quote.validUntil && r.quote.validUntil < new Date()) throw httpError('תוקף ההצעה עבר — יש ליצור הצעה חדשה', 409, { code: 'expired' });
    r.quote.channel = ['email', 'link', 'print'].includes(channel) ? channel : r.quote.channel;
    r.quote.sentAt = new Date(); r.quote.sentBy = actor.name;
    await r.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'quote.sent', entityType: 'Reservation', entityId: r._id, after: { channel: r.quote.channel, version: r.quote.version }, ip, session, afterCommit });
    return { id: String(r._id), sentAt: r.quote.sentAt };
  });
}

export async function closeQuote({ propertyId, id, reason, actor, ip }) {
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('סגירת הצעה מחייבת סיבת אובדן', 422, { fields: { reason: 'נדרש' } });
  return quoteTransaction(propertyId, id, async (r, session, afterCommit) => {
    if (!r.quote?.version) throw httpError('הרשומה אינה הצעת מחיר — לביטול הזמנה השתמשו בביטול', 422);
    if (!['quote', 'hold'].includes(r.status)) throw httpError('ההצעה כבר הומרה או נסגרה', 409);
    const held = r.status === 'hold';
    r.status = 'cancelled'; r.cancelledAt = new Date(); r.quote.lostReason = why; r.quote.closedAt = new Date();
    await r.save({ session });
    await ReservationRoom.updateMany({ reservation: r._id, status: { $in: ['reserved', 'tentative'] } }, { $set: { status: 'cancelled' } }, { session });
    if (held) await incrementInventory(r.property, r.roomType, r.arrivalDate, r.departureDate, -(r.roomsCount || 1), { propertyId, actorId: actor.id, actorName: actor.name, ip, action: 'inventory.quote_closed', reason: `Quote ${r.confirmationNumber}` }, { session, afterCommit });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'quote.closed', entityType: 'Reservation', entityId: r._id, reason: why, ip, session, afterCommit });
    return { id: String(r._id), status: 'cancelled' };
  });
}

// Conversion, closing and expiry serialize on the same reservation and inventory locks.
export async function convertQuote({ propertyId, id, priceSignature, actor, ip }) {
  return quoteTransaction(propertyId, id, async (r, session, afterCommit) => {
    if (!['quote', 'hold'].includes(r.status) || (r.status === 'quote' && !r.quote?.version)) throw httpError('ההצעה כבר הומרה או נסגרה', 409);
    const now = new Date();
    if ((r.quote?.validUntil && r.quote.validUntil < now) || (r.status === 'hold' && r.holdExpiresAt && r.holdExpiresAt < now)) throw httpError('תוקף ההצעה או האופציה עבר — יש לבדוק מחדש', 409, { code: 'expired' });
    const { offer } = await resolveOffer({ propertyId, input: { arrival: r.arrivalDate, departure: r.departureDate, adults: r.adults, children: r.children || 0, rooms: r.roomsCount || 1, roomTypeId: String(r.roomType), ratePlanId: String(r.ratePlan), board: r.board || undefined, childAges: r.childAges || [] }, session, excludeReservationId: r._id });
    if (!offer.bookable) throw httpError(offer.reasons[0]?.label || 'ההצעה אינה זמינה לאישור', 409, { code: 'not_bookable', details: offer.reasons });
    const boardByDate = new Map((r.priceSnapshot?.board?.nightly || []).map((n) => [n.date, Number(n.price)]));
    const agreed = r.priceSnapshot?.override?.reason ? null : signature((r.priceSnapshot?.nightly || []).map((n) => ({ date: n.date, price: round2(Number(n.price) + (boardByDate.get(n.date) || 0)) })));
    if (agreed && agreed !== offer.priceSignature && priceSignature !== offer.priceSignature) throw httpError('המחיר השתנה מאז ההצעה — יש לאשר את המחיר החדש', 409, { code: 'price_changed', details: [{ total: offer.total, priceSignature: offer.priceSignature, nightly: offer.nightly }] });
    if (r.status !== 'hold') await incrementInventory(r.property, r.roomType, r.arrivalDate, r.departureDate, r.roomsCount || 1, { propertyId, actorId: actor.id, actorName: actor.name, ip, action: 'inventory.quote_converted', reason: `Quote ${r.confirmationNumber}` }, { session, afterCommit });
    const set = { status: 'confirmed', holdExpiresAt: null, quoteExpiresAt: null, ...(r.quote?.version ? { 'quote.convertedAt': now } : {}), updatedBy: actor.id || undefined };
    if (agreed && agreed !== offer.priceSignature) {
      const roomRate = round2(offer.nightly.reduce((sum, n) => sum + Number(n.price), 0) / offer.nightly.length);
      const property = await Property.findById(propertyId).session(session).select('vatRate').lean();
      const vat = Number(property?.vatRate ?? 18) / 100;
      set['priceSnapshot.vatRate'] = property?.vatRate ?? 18;
      Object.assign(set, { 'priceSnapshot.nightly': offer.nightly, 'priceSnapshot.total': offer.total, 'priceSnapshot.computedAt': now, 'priceSnapshot.board': { type: offer.board.type, source: offer.board.source, nightly: offer.board.nightly }, totalAmount: offer.total, ratePerNight: roomRate, taxAmount: round2(offer.total - offer.total / (1 + vat)) });
      await ReservationRoom.updateMany({ reservation: r._id }, { $set: { nightlyRate: roomRate } }, { session });
      await StaySegment.updateMany({ reservation: r._id }, { $set: { ratePerNight: roomRate } }, { session });
    }
    await Reservation.updateOne({ _id: r._id, status: { $in: ['quote', 'hold'] } }, { $set: set }, { session });
    await ReservationRoom.updateMany({ reservation: r._id, status: 'tentative' }, { $set: { status: 'reserved' } }, { session });
    if (!(await Folio.exists({ reservation: r._id }).session(session))) await Folio.create([{ property: r.property, reservation: r._id, ownerType: 'guest', currency: r.currency || 'ILS', lines: [] }], { session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'quote.converted', entityType: 'Reservation', entityId: r._id, after: { confirmationNumber: r.confirmationNumber }, ip, session, afterCommit });
    return { id: String(r._id), status: 'confirmed', confirmationNumber: r.confirmationNumber };
  });
}

// Each expired reservation is a separate atomic operation, safe to retry after a batch failure.
export async function releaseExpiredHolds({ propertyId } = {}) {
  const filter = { status: 'hold', holdExpiresAt: { $lt: new Date() } };
  if (propertyId) filter.property = propertyId;
  const expired = await Reservation.find(filter).limit(200).select('_id property').lean();
  let released = 0;
  for (const candidate of expired) {
    const changed = await quoteTransaction(String(candidate.property), String(candidate._id), async (r, session, afterCommit) => {
      const now = new Date();
      if (r.status !== 'hold' || !r.holdExpiresAt || r.holdExpiresAt >= now) return false;
      if (await ReservationRoom.exists({ reservation: r._id, status: { $in: ['in_house', 'checked_in'] } }).session(session)) throw httpError('האופציה כוללת יחידה שוהה — נדרשת בדיקה לפני שחרור', 409);
      const keepQuote = !!r.quote?.version && r.quote.validUntil > now;
      await incrementInventory(r.property, r.roomType, r.arrivalDate, r.departureDate, -(r.roomsCount || 1), { propertyId: r.property, actorName: 'system', action: 'inventory.hold_expired', reason: `Hold ${r.confirmationNumber}` }, { session, afterCommit });
      await ReservationRoom.updateMany({ reservation: r._id, status: { $in: ['reserved', 'tentative'] } }, { $set: { status: keepQuote ? 'tentative' : 'cancelled', assignedRoom: null } }, { session });
      await StaySegment.updateMany({ reservation: r._id }, { $set: { room: null } }, { session });
      await Reservation.updateOne({ _id: r._id, status: 'hold' }, { $set: { status: keepQuote ? 'quote' : 'cancelled', holdReleasedAt: now, holdExpiresAt: null, assignedRoom: null, ...(!keepQuote ? { cancelledAt: now } : {}) } }, { session });
      await audit({ property: r.property, actorName: 'system', action: 'reservation.hold_expired', entityType: 'Reservation', entityId: r._id, before: { assignedRoom: r.assignedRoom }, after: { confirmationNumber: r.confirmationNumber, status: keepQuote ? 'quote' : 'cancelled' }, session, afterCommit });
      return true;
    });
    if (changed) released++;
  }
  return { released };
}

// ── RSV-01 list ─────────────────────────────────────────────────────────────
const STATUS_GROUPS = {
  upcoming: ['confirmed', 'modified', 'pending_payment', 'hold'],
  inhouse: IN_HOUSE_STATUSES,
  departed: ['checked_out'],
  cancelled: ['cancelled', 'no_show'],
  quotes: ['quote', 'draft'],
};

export async function listReservations({ propertyId, q }) {
  const filter = { property: propertyId };
  const from = YMD.test(q.from || '') ? q.from : null;
  const to = YMD.test(q.to || '') ? q.to : null;
  const field = ['arrival', 'stay', 'created', 'departure'].includes(q.dateField) ? q.dateField : 'arrival';
  if (from || to) {
    if (field === 'arrival') filter.arrivalDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    else if (field === 'departure') filter.departureDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    else if (field === 'stay') { if (to) filter.arrivalDate = { $lte: to }; if (from) filter.departureDate = { $gt: from }; }
    else filter.createdAt = { ...(from ? { $gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59Z`) } : {}) };
  }
  if (q.status && STATUS_GROUPS[q.status]) filter.status = { $in: STATUS_GROUPS[q.status] };
  if (q.source && SOURCES.includes(q.source)) filter.source = q.source;
  if (isId(String(q.companyId || ''))) filter.company = q.companyId;
  if (q.q) {
    const term = String(q.q).trim().slice(0, 60);
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const guests = await GuestProfile.find({ property: propertyId, $or: [{ firstName: rx }, { lastName: rx }, { phone: rx }, { email: rx }] }).select('_id').limit(300).lean();
    filter.$or = [{ confirmationNumber: rx }, { externalId: rx }, { channelReservationId: rx }, { primaryGuest: { $in: guests.map((g) => g._id) } }];
  }
  const sortKey = { arrival: 'arrivalDate', departure: 'departureDate', created: 'createdAt', guest: 'arrivalDate', total: 'totalAmount' }[q.sort] || (field === 'created' ? 'createdAt' : 'arrivalDate');
  const dir = q.dir === 'desc' ? -1 : 1;
  const pageSize = Math.min(100, Math.max(10, Number(q.pageSize) || 50));
  const total = await Reservation.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const rows = await Reservation.find(filter).sort({ [sortKey]: dir, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize)
    .select('confirmationNumber status arrivalDate departureDate nights roomsCount adults children source totalAmount currency primaryGuest roomType assignedRoom company isVip createdAt quote.validUntil quote.sentAt externalId')
    .populate('primaryGuest', 'firstName lastName vipLevel').populate('roomType', 'name code').populate('assignedRoom', 'number').populate('company', 'name').lean();
  const ids = rows.map((r) => r._id);
  const [units, folios] = await Promise.all([
    ReservationRoom.find({ reservation: { $in: ids } }).select('reservation assignedRoom status').populate('assignedRoom', 'number').lean(),
    Folio.find({ reservation: { $in: ids } }).select('reservation lines.amount lines.taxAmount lines.status').lean(),
  ]);
  const unitsBy = new Map();
  for (const u of units) { const k = String(u.reservation); if (!unitsBy.has(k)) unitsBy.set(k, []); unitsBy.get(k).push(u); }
  const balBy = new Map();
  for (const f of folios) { const k = String(f.reservation); balBy.set(k, round2((balBy.get(k) || 0) + folioBalance(f))); }
  // aggregate() does not cast ids like find() does.
  const aggMatch = { ...filter, property: new mongoose.Types.ObjectId(propertyId), ...(filter.company ? { company: new mongoose.Types.ObjectId(String(filter.company)) } : {}) };
  const unitTotal = await Reservation.aggregate([{ $match: aggMatch }, { $group: { _id: null, units: { $sum: { $ifNull: ['$roomsCount', 1] } } } }]);
  return {
    total, units: unitTotal[0]?.units || 0, page, pages, pageSize,
    rows: rows.map((r) => {
      const us = unitsBy.get(String(r._id)) || [];
      return {
        id: String(r._id), confirmationNumber: r.confirmationNumber, externalId: r.externalId || null, status: r.status,
        guest: r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : '—', vip: !!(r.isVip || r.primaryGuest?.vipLevel > 0),
        arrivalDate: r.arrivalDate, departureDate: r.departureDate, nights: r.nights, rooms: r.roomsCount || 1,
        roomNumbers: (us.length ? us.map((u) => u.assignedRoom?.number).filter(Boolean) : [r.assignedRoom?.number].filter(Boolean)),
        roomType: r.roomType?.name || null, guests: (r.adults || 0) + (r.children || 0), source: r.source,
        total: r.totalAmount, currency: r.currency || 'ILS', balance: balBy.has(String(r._id)) ? balBy.get(String(r._id)) : null,
        company: r.company?.name || null, createdAt: r.createdAt,
        quote: r.quote?.validUntil ? { validUntil: r.quote.validUntil, sentAt: r.quote.sentAt || null } : null,
      };
    }),
  };
}

// ── RSV-03 stay file ────────────────────────────────────────────────────────
const ACTION_LABELS = {
  'reservation.created': 'נוצרה', 'reservation.updated': 'עודכנה', 'reservation.cancelled': 'בוטלה', 'reservation.no_show': 'סומנה אי הגעה',
  'reservation.check_in': 'כניסה', 'reservation.check_out': 'יציאה', 'reservation.price_override': 'מחיר ידני', 'quote.sent': 'הצעה נשלחה',
  'quote.closed': 'הצעה נסגרה', 'quote.converted': 'הצעה הומרה להזמנה', 'reservation.hold_expired': 'החזקה פגה',
  'reservation.reinstated': 'שוחזרה', 'reservation.check_in_reversed': 'כניסה בוטלה',
};

export async function getStayFile({ propertyId, id, role }) {
  if (!isId(String(id || ''))) throw httpError('מזהה לא תקין', 400);
  const r = await Reservation.findOne({ _id: id, property: propertyId })
    .populate('primaryGuest', 'firstName lastName phone email vipLevel isBlacklisted language country')
    .populate('additionalGuests', 'firstName lastName')
    .populate('roomType', 'name code').populate('ratePlan', 'code name').populate('company', 'name').populate('assignedRoom', 'number').lean();
  if (!r) throw httpError('ההזמנה לא נמצאה', 404);
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const [units, folios, docs, requests, history] = await Promise.all([
    ReservationRoom.find({ reservation: r._id }).populate('assignedRoom', 'number floor cleanStatus opsStatus').populate('roomTypeBooked', 'name').sort({ createdAt: 1, _id: 1 }).lean(),
    Folio.find({ reservation: r._id }).select('ownerType status lines.amount lines.taxAmount lines.status settlement').lean(),
    Invoice.find({ reservation: r._id }).select('type invoiceNumber status totalGross issueDate').lean(),
    GuestRequest.find({ reservation: r._id, status: { $nin: ['closed', 'cancelled'] } }).select('category description status priority').lean(),
    AuditLog.find({ entityType: 'Reservation', entityId: r._id }).sort({ createdAt: -1 }).limit(40).select('action actorName createdAt reason').lean(),
  ]);
  const financeVisible = !['housekeeper', 'housekeeping_manager', 'technician', 'maintenance_manager'].includes(role);
  const balance = round2(folios.reduce((s, f) => s + folioBalance(f), 0));
  const unitRows = (units.length ? units : [{ _id: null, assignedRoom: r.assignedRoom, roomTypeBooked: r.roomType, arrivalDate: r.arrivalDate, departureDate: r.departureDate, status: null, nightlyRate: r.ratePerNight }]).map((u, i) => ({
    id: u._id ? String(u._id) : null, index: i + 1, room: u.assignedRoom ? { id: String(u.assignedRoom._id), number: u.assignedRoom.number, cleanStatus: u.assignedRoom.cleanStatus || null, opsStatus: u.assignedRoom.opsStatus || null } : null,
    roomType: u.roomTypeBooked?.name || r.roomType?.name || null, arrivalDate: u.arrivalDate, departureDate: u.departureDate, status: u.status, nightlyRate: financeVisible ? u.nightlyRate : undefined,
  }));
  const canCheckIn = ['confirmed', 'modified', 'pending_payment', 'partially_checked_in'].includes(r.status) && r.arrivalDate <= today && r.departureDate > today;
  const canCheckOut = IN_HOUSE_STATUSES.includes(r.status);
  return {
    id: String(r._id), confirmationNumber: r.confirmationNumber, externalId: r.externalId || null, channelReservationId: r.channelReservationId || null,
    status: r.status, source: r.source, createdAt: r.createdAt, businessDate: today,
    guest: r.primaryGuest ? { id: String(r.primaryGuest._id), name: `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim(), phone: r.primaryGuest.phone || null, email: r.primaryGuest.email || null, vip: (r.primaryGuest.vipLevel || 0) > 0 || !!r.isVip, blacklisted: !!r.primaryGuest.isBlacklisted, language: r.primaryGuest.language || null } : null,
    additionalGuests: (r.additionalGuests || []).map((g) => ({ id: String(g._id), name: `${g.firstName} ${g.lastName}` })),
    booker: r.booker?.name || r.booker?.phone ? r.booker : null, payerType: r.payerType || 'guest',
    company: r.company ? { id: String(r.company._id), name: r.company.name } : null,
    arrivalDate: r.arrivalDate, departureDate: r.departureDate, nights: r.nights, adults: r.adults, children: r.children || 0, childAges: r.childAges || [],
    roomType: r.roomType?.name || null, ratePlan: r.ratePlan ? { code: r.ratePlan.code, name: r.ratePlan.name } : null,
    units: unitRows,
    price: financeVisible ? { total: r.totalAmount, ratePerNight: r.ratePerNight, currency: r.currency || 'ILS', snapshot: r.priceSnapshot?.nightly?.length ? r.priceSnapshot : null } : null,
    terms: { cancellation: r.cancellationPolicy || null, deposit: r.depositPolicy || null, guarantee: r.guaranteeType || 'none' },
    quote: r.quote?.version ? { ...r.quote, expired: !!(r.quote.validUntil && new Date(r.quote.validUntil) < new Date()) } : null,
    holdExpiresAt: r.status === 'hold' ? r.holdExpiresAt : null,
    confirmation: { sent: !!r.confirmationSent, at: r.confirmationSentAt || null, to: r.confirmationSentTo || null, guestEmail: r.primaryGuest?.email || null },
    money: financeVisible ? { balance, folios: folios.length, documents: docs.map((d) => ({ id: String(d._id), type: d.type, number: d.invoiceNumber, status: d.status, gross: d.totalGross })) } : null,
    requests: requests.map((q) => ({ id: String(q._id), category: q.category, description: q.description, status: q.status, priority: q.priority })),
    specialRequests: r.specialRequests || null, internalNotes: financeVisible ? r.internalNotes || null : null,
    history: history.map((h) => ({ action: ACTION_LABELS[h.action] || h.action, by: h.actorName || '—', at: h.createdAt, reason: h.reason || null })),
    actions: {
      checkIn: canCheckIn ? { ok: true } : { ok: false, why: r.arrivalDate > today ? 'הגעה עתידית' : 'לא בסטטוס הגעה' },
      checkOut: canCheckOut ? { ok: true } : { ok: false, why: 'האורח לא בבית' },
      noShow: ['confirmed', 'modified', 'pending_payment'].includes(r.status) && r.arrivalDate === today ? { ok: true } : { ok: false, why: 'רק ביום ההגעה ולהזמנה שלא נכנסה' },
      cancel: ['confirmed', 'modified', 'pending_payment', 'hold', 'draft'].includes(r.status) ? { ok: true } : { ok: false, why: 'לא ניתן לבטל בסטטוס הנוכחי' },
      // G6 — shown when the status allows it; the server preview gives the exact blockers.
      reinstate: ['cancelled', 'no_show'].includes(r.status) && r.departureDate > today && (r.status === 'no_show' || r.arrivalDate >= today)
        ? { ok: true, managerOnly: r.status === 'no_show' } : { ok: false, why: ['cancelled', 'no_show'].includes(r.status) ? 'מועד השהייה עבר — יוצרים הזמנה חדשה' : 'רק הזמנה שבוטלה או לא הגיעה' },
      reverseCheckIn: IN_HOUSE_STATUSES.includes(r.status) && r.status !== 'partially_checked_out' && r.checkedInAt
        && new Intl.DateTimeFormat('en-CA', { timeZone: property?.timezone || 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.checkedInAt)) === today
        ? { ok: true } : { ok: false, why: 'רק ביום העסקי של הכניסה' },
      postStay: r.status === 'checked_out' ? { ok: true } : { ok: false, why: 'רק אחרי יציאה' },
    },
    reversals: (r.reversals || []).map((x) => ({ kind: x.kind, from: x.from, at: x.at, by: x.byName || '—', reason: x.reason || null })),
    party: r.party?.id ? { id: r.party.id, code: r.party.code, index: r.party.index, size: r.party.size, members: await partyMembers({ propertyId, partyId: r.party.id }) } : null,
  };
}

// Price of given nights (used by stay changes: extension, modification) — same engine as booking.
// A night that cannot be priced (no calendar row and no base price) is returned as missing, never invented.
export async function priceNights({ roomTypeId, ratePlanId, dates, adults = 2, children = 0, rooms = 1, session = null }) {
  const perRoomAdults = Math.ceil(adults / rooms);
  const perRoomChildren = Math.ceil(children / rooms);
  const rds = ratePlanId ? await RateDate.find({ roomType: roomTypeId, ratePlan: ratePlanId, date: { $in: dates } }).session(session).lean() : [];
  const plan = ratePlanId ? await RatePlan.findById(ratePlanId).session(session).lean() : null;
  const roomType = await RoomType.findById(roomTypeId).session(session).lean();
  const by = new Map(rds.map((rd) => [rd.date, rd]));
  const parentPlan = plan?.derived?.from ? await RatePlan.findById(plan.derived.from).session(session).lean() : null;
  const parentRows = parentPlan ? new Map((await RateDate.find({ roomType: roomTypeId, ratePlan: parentPlan._id, date: { $in: dates } }).session(session).lean()).map((r) => [r.date, r])) : new Map();
  const nightly = [];
  const missing = [];
  const closed = [];
  for (const d of dates) {
    const rd = by.get(d);
    if (rd?.stopSell) closed.push(d);
    const p = priceNight({ plan, roomType, rd, date: d, adults: perRoomAdults, children: perRoomChildren, los: dates.length, parent: parentPlan ? { plan: parentPlan, rd: parentRows.get(d) } : null });
    if (p.price === null) { missing.push(d); continue; }
    nightly.push({ date: d, price: p.price });
  }
  return { nightly, missing, closed, perRoom: round2(nightly.reduce((s, n) => s + n.price, 0)), signature: signature(nightly) };
}

export { signature as priceSignatureOf };
