// Stay tools (gap-map item 5): Re-Instate a check-out, Split Master (a room of a multi-room booking
// becomes its own booking), and Shares (another guest in the same room with their own billing window
// and a split of the lodging). Copy of a booking is done in the booking form (prefill from the stay).
//
// Rules:
//  - Re-Instate only on the business day of the check-out, manager + reason; the room must still be
//    free. Folios closed at check-out reopen; documents issued stay as they are.
//  - Split moves the unit with its own window and price to a new booking — no stock is taken or freed
//    (same room, same nights). Both bookings are linked as a party.
//  - A Share never takes a room of its own: the second guest gets a window on the same booking. Joining
//    an existing booking cancels it (its stock is released) after checking it holds no money.
//    Separating creates a new booking for the guest (stock checked) with its own confirmation number.
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import Invoice from '../models/Invoice.js';
import GuestProfile from '../models/GuestProfile.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { withLocks } from './locks.js';
import { httpError, businessDateOf, MANAGER_ROLES, IN_HOUSE_STATUSES, occupancyMap } from './frontDeskService.js';
import { folioBalance } from './departureService.js';
import { allocateConfirmationNumber, cancelReservation, createReservation } from './reservationService.js';
import { newPartyKey } from './partyBookingService.js';

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const FRONT_ROLES = [...MANAGER_ROLES, 'receptionist'];
const OPEN_BOOKING = ['confirmed', 'modified', 'pending_payment'];
const ACTIVE = [...OPEN_BOOKING, ...IN_HOUSE_STATUSES];
export const SHARE_SPLITS = { none: 'הכול על האורח הראשי', half: 'חצי־חצי', full: 'מחיר מלא לכל אחד' };
const nightsBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
const localDate = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

function reasonOf(r, min = 3) {
  const why = String(r || '').trim().slice(0, 300);
  if (why.length < min) throw httpError('הפעולה מחייבת סיבה', 422, { fields: { reason: 'יש לפרט סיבה' } });
  return why;
}
async function loadRes(propertyId, id) {
  if (!isId(String(id || ''))) throw httpError('מזהה הזמנה לא תקין', 400);
  const res = await Reservation.findOne({ _id: id, property: propertyId });
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  return res;
}
const nameOf = (g) => (g ? `${g.firstName || ''} ${g.lastName || ''}`.trim() : '');

// ── Re-Instate a check-out ──────────────────────────────────────────────────
export async function reinstateCheckOutPreview({ propertyId, reservationId }) {
  const res = await loadRes(propertyId, reservationId);
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const blockers = [];
  const warnings = [];
  if (res.status !== 'checked_out') blockers.push('רק שהייה שיצאה ניתנת להחזרה');
  if (res.checkedOutAt && localDate(res.checkedOutAt, property?.timezone) !== today) blockers.push('החזרה אפשרית רק ביום העסקי של היציאה — אחר כך יוצרים הזמנה חדשה');
  const units = await ReservationRoom.find({ reservation: res._id, status: 'checked_out' }).populate('assignedRoom', 'number').lean();
  const roomIds = units.map((u) => u.assignedRoom?._id).filter(Boolean);
  const occ = await occupancyMap(propertyId, roomIds);
  for (const u of units) {
    const other = (occ.get(String(u.assignedRoom?._id)) || []).find((x) => x.resId !== String(res._id));
    if (other) blockers.push(`חדר ${u.assignedRoom.number} כבר תפוס (${other.label}) — יש להחזיר לחדר אחר דרך הזמנה חדשה`);
  }
  const arriving = roomIds.length ? await ReservationRoom.find({ assignedRoom: { $in: roomIds }, status: 'reserved', arrivalDate: today, reservation: { $ne: res._id } }).populate('reservation', 'confirmationNumber').populate('assignedRoom', 'number').lean() : [];
  for (const a of arriving) warnings.push(`חדר ${a.assignedRoom?.number} משובץ להגעה היום (${a.reservation?.confirmationNumber || '—'}) — יש לשבץ אותה מחדש`);
  if (res.originalDepartureDate && res.originalDepartureDate > today) warnings.push(`העזיבה המקורית הייתה ${res.originalDepartureDate} — להמשך השהייה משתמשים ב"הארכת שהייה" אחרי ההחזרה`);
  const folios = await Folio.find({ reservation: res._id }).select('status settlement').lean();
  return {
    reservationId: String(res._id), allowed: !blockers.length, blockers, warnings,
    rooms: units.map((u) => u.assignedRoom?.number).filter(Boolean),
    reopen: folios.filter((f) => f.status === 'closed' || f.settlement?.mode).length,
    note: 'מסמכים שהופקו ביציאה נשארים. חיובים חדשים יקבלו מסמך חדש.',
  };
}

export async function reinstateCheckOut({ propertyId, reservationId, reason, actor, ip }) {
  if (!MANAGER_ROLES.includes(actor.role)) throw httpError('החזרת אורח שיצא מותרת למנהל משמרת ומעלה', 403);
  const why = reasonOf(reason);
  return withLocks([`res:${reservationId}`], async () => {
    const preview = await reinstateCheckOutPreview({ propertyId, reservationId });
    if (!preview.allowed) throw httpError(preview.blockers[0], 409, { details: preview.blockers });
    const res = await loadRes(propertyId, reservationId);
    const property = await Property.findById(propertyId).select('timezone dayClose').lean();
    const today = businessDateOf(property);
    const units = await ReservationRoom.find({ reservation: res._id, status: 'checked_out' }).lean();
    const roomIds = units.map((u) => u.assignedRoom).filter(Boolean);
    await ReservationRoom.updateMany({ _id: { $in: units.map((u) => u._id) } }, { $set: { status: 'in_house' } });
    if (roomIds.length) {
      await Room.updateMany({ _id: { $in: roomIds }, property: propertyId }, { $set: { occStatus: 'occupied' } });
      await HousekeepingTask.updateMany({ room: { $in: roomIds }, reservation: res._id, type: 'checkout_clean', date: today, status: 'new' }, { $set: { status: 'cancelled' } });
    }
    const folios = await Folio.find({ reservation: res._id });
    let reopened = 0;
    for (const f of folios) {
      if (f.status !== 'closed' && !f.settlement?.mode) continue;
      if (f.status === 'closed') { f.status = 'open'; f.closedAt = undefined; f.closedBy = undefined; }
      f.set('settlement', undefined);
      await f.save();
      reopened += 1;
    }
    const before = { status: res.status, checkedOutAt: res.checkedOutAt };
    res.status = 'in_house';
    res.checkedOutAt = undefined;
    res.reversals.push({ kind: 'reinstate_check_out', from: 'checked_out', to: 'in_house', at: new Date(), by: actor.id || undefined, byName: actor.name, reason: why });
    res.lastChange = { at: new Date(), by: actor.name, reason: why, kind: 'reinstate_check_out' };
    res.updatedBy = actor.id || undefined;
    await res.save();
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.check_out_reinstated', entityType: 'Reservation', entityId: res._id, reason: why, before, after: { status: 'in_house', units: units.length, foliosReopened: reopened }, ip });
    return { reservationId: String(res._id), status: 'in_house', units: units.length, foliosReopened: reopened, warnings: preview.warnings };
  });
}

// ── Split Master: one room of a multi-room booking becomes its own booking ──
function statusFromUnits(units, fallback) {
  const live = units.filter((u) => !['cancelled', 'no_show', 'checked_out'].includes(u.status));
  const inHouse = live.filter((u) => ['in_house', 'checked_in'].includes(u.status)).length;
  const out = units.filter((u) => u.status === 'checked_out').length;
  if (!live.length) return fallback;
  if (inHouse === live.length) return out ? 'partially_checked_out' : 'in_house';
  if (inHouse) return 'partially_checked_in';
  return out ? 'partially_checked_out' : (IN_HOUSE_STATUSES.includes(fallback) ? 'confirmed' : fallback);
}

export async function splitUnit({ propertyId, reservationId, unitId, actor, ip }) {
  if (!FRONT_ROLES.includes(actor.role)) throw httpError('אין הרשאה לפצל הזמנה', 403);
  if (!isId(String(unitId || ''))) throw httpError('יש לבחור חדר לפיצול', 422, { fields: { unitId: 'חדר' } });
  return withLocks([`res:${reservationId}`], async () => {
    const res = await loadRes(propertyId, reservationId);
    if (!ACTIVE.includes(res.status)) throw httpError('אפשר לפצל רק הזמנה פעילה', 409);
    if ((res.shares || []).some((s) => s.status === 'active')) throw httpError('יש Share בהזמנה — מפרקים אותו לפני פיצול', 409);
    const units = await ReservationRoom.find({ reservation: res._id }).sort({ createdAt: 1, _id: 1 });
    const unit = units.find((u) => String(u._id) === String(unitId));
    if (!unit) throw httpError('החדר לא נמצא בהזמנה', 404);
    const others = units.filter((u) => String(u._id) !== String(unitId) && !['cancelled', 'no_show'].includes(u.status));
    if (!others.length) throw httpError('בהזמנה חדר אחד בלבד — אין מה לפצל', 409);
    if (!['reserved', 'tentative', 'in_house', 'checked_in'].includes(unit.status)) throw httpError('אפשר לפצל רק חדר שעוד לא יצא', 409);
    const dates = [];
    for (let d = unit.arrivalDate; d < unit.departureDate; d = new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)) dates.push(d);
    const agreed = new Map((res.priceSnapshot?.nightly || []).map((n) => [n.date, Number(n.price)]));
    const nightly = dates.map((d) => ({ date: d, price: agreed.has(d) ? agreed.get(d) : Number(unit.nightlyRate || res.ratePerNight || 0) }));
    const unitTotal = round2(nightly.reduce((s, n) => s + n.price, 0));
    const inHouse = ['in_house', 'checked_in'].includes(unit.status);
    const confirmationNumber = await allocateConfirmationNumber(propertyId);
    const src = res.toObject();
    const partyId = src.party?.id || newPartyKey();
    const partySize = (src.party?.size || 1) + 1;
    const snapshot = src.priceSnapshot?.nightly?.length ? { ...src.priceSnapshot, nightly, total: unitTotal } : undefined;
    const created = await Reservation.create({
      property: res.property, confirmationNumber, status: inHouse ? 'in_house' : 'confirmed',
      primaryGuest: unit.guests?.[0] || src.primaryGuest, adults: unit.adults || Math.max(1, Math.round((src.adults || 1) / Math.max(1, units.length))), children: unit.children || 0,
      arrivalDate: unit.arrivalDate, departureDate: unit.departureDate, nights: dates.length, roomsCount: 1,
      source: src.source, marketSegment: src.marketSegment, ratePlan: src.ratePlan, roomType: unit.roomTypeBooked || src.roomType, assignedRoom: unit.assignedRoom,
      ratePerNight: unit.nightlyRate || src.ratePerNight, totalAmount: unitTotal, currency: src.currency,
      guaranteeType: unit.guaranteeType && unit.guaranteeType !== 'none' ? unit.guaranteeType : src.guaranteeType,
      company: src.company, travelAgent: src.travelAgent, booker: src.booker, payerType: src.payerType, board: src.board, group: src.group, groupName: src.groupName,
      specialRequests: src.specialRequests, internalNotes: [src.internalNotes, `פוצל מהזמנה ${src.confirmationNumber}`].filter(Boolean).join('\n'),
      cancellationPolicy: src.cancellationPolicy, depositPolicy: src.depositPolicy, tourist: src.tourist, voucher: src.voucher, noPost: src.noPost,
      checkedInAt: inHouse ? src.checkedInAt : undefined, ...(snapshot ? { priceSnapshot: snapshot } : {}),
      party: { id: partyId, code: src.party?.code || src.confirmationNumber, index: partySize, size: partySize },
      splitFrom: { reservation: res._id, confirmationNumber: src.confirmationNumber, at: new Date(), byName: actor.name },
      createdBy: actor.id || undefined,
    });
    unit.reservation = created._id;
    await unit.save();
    await StaySegment.updateMany({ reservationRoom: unit._id }, { $set: { reservation: created._id } });
    const movedFolios = await Folio.updateMany({ reservation: res._id, ownerType: 'room', ownerRef: String(unit._id) }, { $set: { reservation: created._id } });
    // The booking it came from: one room less, its price less this room's nights.
    res.roomsCount = Math.max(1, (res.roomsCount || units.length) - 1);
    res.totalAmount = round2(Math.max(0, Number(res.totalAmount || 0) - unitTotal));
    if (res.priceSnapshot?.total != null) res.priceSnapshot.total = round2(Math.max(0, Number(res.priceSnapshot.total) - unitTotal));
    if (unit.adults) res.adults = Math.max(1, (res.adults || 1) - unit.adults);
    if (String(res.assignedRoom || '') === String(unit.assignedRoom || '')) res.assignedRoom = others[0]?.assignedRoom || undefined;
    res.status = statusFromUnits(others, res.status);
    if (!src.party?.id) res.party = { id: partyId, code: src.confirmationNumber, index: 1, size: partySize };
    res.lastChange = { at: new Date(), by: actor.name, reason: `חדר פוצל להזמנה ${confirmationNumber}`, kind: 'split' };
    res.updatedBy = actor.id || undefined;
    await res.save();
    if (src.party?.id) await Reservation.updateMany({ property: propertyId, 'party.id': partyId }, { $set: { 'party.size': partySize } });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.split', entityType: 'Reservation', entityId: res._id, after: { unitId: String(unit._id), newReservation: String(created._id), confirmationNumber, total: unitTotal, folios: movedFolios.modifiedCount || 0 }, ip });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.created_by_split', entityType: 'Reservation', entityId: created._id, after: { from: src.confirmationNumber, unitId: String(unit._id) }, ip });
    return { reservationId: String(res._id), newReservationId: String(created._id), confirmationNumber, total: unitTotal };
  });
}

// ── Shares ──────────────────────────────────────────────────────────────────
export async function addShare({ propertyId, reservationId, input, actor, ip }) {
  if (!FRONT_ROLES.includes(actor.role)) throw httpError('אין הרשאה להוסיף Share', 403);
  const split = SHARE_SPLITS[input.split] ? input.split : null;
  if (!split) throw httpError('יש לבחור איך מתחלק המחיר', 422, { fields: { split: 'חלוקה' } });
  // The joined booking is cancelled through cancelReservation, which takes its own lock.
  return withLocks([`res:${reservationId}`], async () => {
    const res = await loadRes(propertyId, reservationId);
    if (!ACTIVE.includes(res.status)) throw httpError('Share מתווסף רק להזמנה פעילה', 409);
    if ((res.roomsCount || 1) > 1) throw httpError('Share הוא לחדר אחד — בהזמנה של כמה חדרים מפצלים קודם (Split Master)', 409, { code: 'multi_room' });
    if ((res.shares || []).filter((s) => s.status === 'active').length >= 3) throw httpError('עד 3 אורחי Share לחדר', 409);
    let guestId; let name; let mergedFrom; let extraAdults = 1;
    if (input.mergeReservationId) {
      const other = await loadRes(propertyId, input.mergeReservationId);
      if (String(other._id) === String(res._id)) throw httpError('זו אותה הזמנה', 422);
      if (!OPEN_BOOKING.includes(other.status) || other.checkedInAt) throw httpError(`הזמנה ${other.confirmationNumber} אינה הזמנה פתוחה שלא נכנסה`, 409);
      if ((other.roomsCount || 1) > 1) throw httpError(`בהזמנה ${other.confirmationNumber} כמה חדרים`, 409);
      if (other.arrivalDate < res.arrivalDate || other.departureDate > res.departureDate) throw httpError(`התאריכים של ${other.confirmationNumber} (${other.arrivalDate}–${other.departureDate}) מחוץ לשהייה בחדר`, 409, { code: 'dates_outside' });
      const money = await Folio.find({ reservation: other._id }).select('lines.status lines.amount').lean();
      if (money.some((f) => f.lines.some((l) => l.status === 'posted' && Math.abs(Number(l.amount || 0)) > 0.005))) throw httpError(`בהזמנה ${other.confirmationNumber} יש תנועות כספיות — מטפלים בהן (החזר / העברה) לפני צירוף`, 409, { code: 'has_money' });
      if (await Invoice.exists({ reservation: other._id })) throw httpError(`להזמנה ${other.confirmationNumber} הופק מסמך`, 409);
      guestId = other.primaryGuest;
      const g = await GuestProfile.findById(guestId).select('firstName lastName').lean();
      name = nameOf(g) || other.confirmationNumber;
      mergedFrom = other.confirmationNumber;
      extraAdults = other.adults || 1;
      await cancelReservation({ reservationId: other._id, reason: `צורף כ־Share לחדר של הזמנה ${res.confirmationNumber}`, actorId: actor.id, actorName: actor.name, ip });
    } else if (isId(String(input.guestId || ''))) {
      const g = await GuestProfile.findOne({ _id: input.guestId, property: propertyId }).select('firstName lastName').lean();
      if (!g) throw httpError('האורח לא נמצא', 404);
      guestId = g._id; name = nameOf(g);
    } else {
      const ng = input.newGuest || {};
      const first = String(ng.firstName || '').trim().slice(0, 60); const last = String(ng.lastName || '').trim().slice(0, 60);
      if (first.length < 1 || last.length < 1) throw httpError('שם פרטי ושם משפחה של האורח', 422, { fields: { firstName: !first ? 'שם פרטי' : undefined, lastName: !last ? 'שם משפחה' : undefined } });
      const g = await GuestProfile.create({ property: propertyId, firstName: first, lastName: last, phone: String(ng.phone || '').trim().slice(0, 30) || undefined });
      guestId = g._id; name = nameOf(g);
    }
    if (String(guestId) === String(res.primaryGuest) || (res.shares || []).some((s) => s.status === 'active' && String(s.guest) === String(guestId))) throw httpError('האורח כבר בחדר', 409);
    const shareId = new mongoose.Types.ObjectId();
    const folio = await Folio.create({ property: propertyId, reservation: res._id, ownerType: 'guest', ownerRef: `share:${shareId}`, account: { name, openedByName: actor.name }, currency: res.currency || 'ILS', lines: [] });
    res.shares.push({ _id: shareId, guest: guestId, name, split, folio: folio._id, status: 'active', mergedFrom, at: new Date(), byName: actor.name });
    if (!(res.additionalGuests || []).some((g) => String(g) === String(guestId))) res.additionalGuests.push(guestId);
    res.adults = (res.adults || 1) + extraAdults;
    res.updatedBy = actor.id || undefined;
    await res.save();
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.share_added', entityType: 'Reservation', entityId: res._id, after: { shareId: String(shareId), name, split, mergedFrom: mergedFrom || null, folio: String(folio._id) }, ip });
    return { shareId: String(shareId), name, folioId: String(folio._id), mergedFrom: mergedFrom || null };
  });
}

export async function setShareSplit({ propertyId, reservationId, shareId, split, actor, ip }) {
  if (!FRONT_ROLES.includes(actor.role)) throw httpError('אין הרשאה', 403);
  if (!SHARE_SPLITS[split]) throw httpError('חלוקה לא מוכרת', 422);
  const res = await loadRes(propertyId, reservationId);
  const s = res.shares.id(shareId);
  if (!s || s.status !== 'active') throw httpError('ה־Share לא נמצא', 404);
  const before = s.split;
  s.split = split;
  await res.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.share_split_changed', entityType: 'Reservation', entityId: res._id, before: { split: before }, after: { shareId: String(shareId), split, note: 'חל על לילות שטרם חויבו' }, ip });
  return { shareId: String(shareId), split };
}

// remove = the guest is no longer in the room (window must be settled);
// separate = the guest becomes their own booking with a new confirmation number (stock checked).
export async function endShare({ propertyId, reservationId, shareId, input, actor, ip }) {
  if (!FRONT_ROLES.includes(actor.role)) throw httpError('אין הרשאה לפרק Share', 403);
  const mode = input.mode === 'separate' ? 'separate' : 'remove';
  const why = String(input.reason || '').trim().slice(0, 300) || undefined;
  return withLocks([`res:${reservationId}`], async () => {
    const res = await loadRes(propertyId, reservationId);
    const s = res.shares.id(shareId);
    if (!s || s.status !== 'active') throw httpError('ה־Share לא נמצא', 404);
    const folio = s.folio ? await Folio.findById(s.folio).lean() : null;
    const balance = folio ? folioBalance(folio) : 0;
    let created = null;
    if (mode === 'remove') {
      if (Math.abs(balance) > 0.005) throw httpError(`בחלון של ${s.name} יתרה של ${balance.toFixed(2)} — גובים, מחזירים או מעבירים לפני הסרה`, 409, { code: 'share_balance' });
    } else {
      const property = await Property.findById(propertyId).select('timezone dayClose').lean();
      const today = businessDateOf(property);
      const from = res.arrivalDate > today ? res.arrivalDate : today;
      if (from >= res.departureDate) throw httpError('לא נשארו לילות להזמנה נפרדת', 409);
      created = await createReservation({
        propertyId,
        data: {
          roomTypeId: String(res.roomType), arrivalDate: from, departureDate: res.departureDate, primaryGuestId: String(s.guest), adults: 1, children: 0,
          ratePlanId: res.ratePlan ? String(res.ratePlan) : undefined, ratePerNight: res.ratePerNight, source: res.source || 'direct', currency: res.currency,
          companyId: res.company ? String(res.company) : undefined, bookingStatus: 'confirmed',
          internalNotes: `פורק מ־Share בהזמנה ${res.confirmationNumber}${why ? ` — ${why}` : ''}`,
        },
        actorId: actor.id, actorName: actor.name, ip,
      });
    }
    s.status = mode === 'remove' ? 'removed' : 'separated';
    s.endedAt = new Date(); s.endedByName = actor.name; s.reason = why;
    if (created) s.newReservation = created._id;
    res.adults = Math.max(1, (res.adults || 1) - 1);
    res.additionalGuests = (res.additionalGuests || []).filter((g) => String(g) !== String(s.guest));
    await res.save();
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: mode === 'remove' ? 'reservation.share_removed' : 'reservation.share_separated', entityType: 'Reservation', entityId: res._id, reason: why, after: { shareId: String(shareId), name: s.name, windowBalance: balance, newReservation: created ? String(created._id) : null, confirmationNumber: created?.confirmationNumber || null }, ip });
    return { shareId: String(shareId), mode, windowBalance: balance, newReservationId: created ? String(created._id) : null, confirmationNumber: created?.confirmationNumber || null };
  });
}

// Bookings that can join this room as a Share: open, one room, dates inside this stay, no money.
export async function shareCandidates({ propertyId, reservationId, q }) {
  const res = await loadRes(propertyId, reservationId);
  const term = String(q || '').trim();
  const list = await Reservation.find({
    property: propertyId, _id: { $ne: res._id }, status: { $in: OPEN_BOOKING }, checkedInAt: null,
    arrivalDate: { $gte: res.arrivalDate }, departureDate: { $lte: res.departureDate }, roomsCount: { $lte: 1 },
  }).select('confirmationNumber primaryGuest arrivalDate departureDate adults').populate('primaryGuest', 'firstName lastName').limit(200).lean();
  return {
    splits: SHARE_SPLITS,
    rows: list.map((r) => ({ id: String(r._id), confirmationNumber: r.confirmationNumber, guest: nameOf(r.primaryGuest), arrivalDate: r.arrivalDate, departureDate: r.departureDate, nights: nightsBetween(r.arrivalDate, r.departureDate) }))
      .filter((r) => !term || r.guest.includes(term) || r.confirmationNumber.toLowerCase().includes(term.toLowerCase())).slice(0, 20),
  };
}
