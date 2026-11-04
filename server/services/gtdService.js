// GTD — a non-guaranteed booking is held only until a set time on its arrival day. After that time
// the desk releases all of them in one action (each one is cancelled with a fixed reason and its
// stock goes back). A booking with money already paid is never released here — it is handled by hand.
import Reservation from '../models/Reservation.js';
import Folio from '../models/Folio.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { cancelReservation } from './reservationService.js';
import { httpError, businessDateOf } from './frontDeskService.js';

export const GTD_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const OPEN = ['confirmed', 'modified', 'pending_payment'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const RELEASE_REASON = 'שחרור הזמנה לא מובטחת — עבר מועד השמירה';

function nowHHMM(tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

export function defaultHoldTime(property) {
  return HHMM.test(property?.nonGuaranteedReleaseTime || '') ? property.nonGuaranteedReleaseTime : '18:00';
}

async function paidOf(resId) {
  const folios = await Folio.find({ reservation: resId }).select('lines.type lines.amount lines.status').lean();
  return folios.flatMap((f) => f.lines || []).filter((l) => l.status === 'posted' && ['payment', 'deposit'].includes(l.type)).reduce((s, l) => s - Number(l.amount || 0), 0);
}

// Non-guaranteed arrivals of the business day: which are past their time and may be released.
export async function nonGuaranteedToday({ propertyId }) {
  const property = await Property.findById(propertyId).select('timezone dayClose nonGuaranteedReleaseTime').lean();
  if (!property) throw httpError('הנכס לא נמצא', 404);
  const date = businessDateOf(property);
  const now = nowHHMM(property.timezone);
  const rows = await Reservation.find({ property: propertyId, arrivalDate: date, status: { $in: OPEN }, guaranteeType: 'non_guaranteed' })
    .populate('primaryGuest', 'firstName lastName').select('confirmationNumber primaryGuest holdUntilTime roomsCount eta').lean();
  const out = [];
  for (const r of rows) {
    const until = r.holdUntilTime || defaultHoldTime(property);
    const paid = await paidOf(r._id);
    out.push({
      id: String(r._id), confirmationNumber: r.confirmationNumber, rooms: r.roomsCount || 1, eta: r.eta || null,
      guest: r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : '—',
      holdUntil: until, due: until <= now, blocked: paid > 0.005 ? 'התקבל תשלום — מטפלים ידנית' : null,
    });
  }
  out.sort((a, b) => (a.holdUntil < b.holdUntil ? -1 : 1));
  return { date, now, defaultTime: defaultHoldTime(property), rows: out, dueCount: out.filter((x) => x.due && !x.blocked).length };
}

// Release every non-guaranteed arrival whose time passed (or only the ids given, all re-checked).
export async function releaseNonGuaranteed({ propertyId, ids, actor, ip }) {
  const view = await nonGuaranteedToday({ propertyId });
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
  const targets = view.rows.filter((r) => r.due && !r.blocked && (!wanted || wanted.has(r.id)));
  if (!targets.length) throw httpError('אין הזמנות לא מובטחות שעבר מועד השמירה שלהן', 409);
  const released = []; const failed = [];
  for (const t of targets) {
    try {
      await cancelReservation({ reservationId: t.id, reason: `${RELEASE_REASON} (${t.holdUntil})`, actorId: actor.id, actorName: actor.name, ip });
      await Reservation.updateOne({ _id: t.id, property: propertyId }, { $set: { cancellation: { receivedAt: new Date(), channel: 'desk', track: 'regular', reason: 'other', note: `GTD — נשמרה עד ${t.holdUntil}`, decidedBy: actor.name } } });
      released.push(t);
    } catch (e) {
      failed.push({ ...t, error: e.message });
    }
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'reservation.gtd_release', entityType: 'Property', entityId: propertyId, after: { date: view.date, at: view.now, released: released.map((r) => r.confirmationNumber), failed: failed.map((r) => r.confirmationNumber) }, reason: RELEASE_REASON, ip });
  return { released: released.length, failed, rows: released.map((r) => r.confirmationNumber) };
}

// Mark a booking as non-guaranteed (held until a time on arrival day) or as a regular booking again.
export async function setNonGuaranteed({ propertyId, reservationId, on, holdUntilTime, actor, ip }) {
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId });
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  if (!OPEN.includes(res.status) && res.status !== 'hold') throw httpError('רק הזמנה פתוחה שלא נכנסה', 409);
  const before = { guaranteeType: res.guaranteeType, holdUntilTime: res.holdUntilTime || null };
  if (on) {
    if (res.guaranteeType === 'company_guarantee') throw httpError('להזמנה יש ערבות חברה — היא מובטחת', 409);
    const property = await Property.findById(propertyId).select('nonGuaranteedReleaseTime').lean();
    const t = holdUntilTime || defaultHoldTime(property);
    if (!HHMM.test(t)) throw httpError('שעה לא תקינה', 422, { fields: { holdUntilTime: 'HH:MM' } });
    res.guaranteeType = 'non_guaranteed'; res.holdUntilTime = t;
  } else {
    if (res.guaranteeType !== 'non_guaranteed') return { guaranteeType: res.guaranteeType };
    res.guaranteeType = 'none'; res.holdUntilTime = undefined;
  }
  res.updatedBy = actor.id;
  await res.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: on ? 'reservation.non_guaranteed' : 'reservation.guaranteed', entityType: 'Reservation', entityId: res._id, before, after: { guaranteeType: res.guaranteeType, holdUntilTime: res.holdUntilTime || null }, ip });
  return { guaranteeType: res.guaranteeType, holdUntilTime: res.holdUntilTime || null };
}
