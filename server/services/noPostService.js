// Cash Basis / No Post — a guest who may not charge services to the room (pays on the spot).
// Lodging and board keep posting (night audit / package); any other manual charge is refused
// unless a shift manager approves that charge with a reason. Default at check-in follows the
// guarantee method (cash/deposit/none → no post; card, voucher, company → may charge).
import Reservation from '../models/Reservation.js';
import { audit } from './auditService.js';
import { httpError, MANAGER_ROLES } from './frontDeskService.js';

export const LODGING_CODES = ['rooms', 'board'];
const OPEN = ['confirmed', 'modified', 'pending_payment', 'hold', 'checked_in', 'in_house', 'partially_checked_in', 'partially_checked_out'];

export function defaultNoPost(guaranteeType, payerType) {
  if (payerType === 'company') return false;
  return !['credit_card', 'voucher', 'company_guarantee'].includes(guaranteeType || 'none');
}

export async function setNoPost({ propertyId, reservationId, on, reason, source = 'manual', actor, ip, session = null, afterCommit = null }) {
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).session(session);
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  if (!OPEN.includes(res.status)) throw httpError('רק הזמנה פתוחה או שוהה', 409);
  const was = !!res.noPost?.on;
  if (was === !!on) return { on: was };
  // Opening the room for charges is a credit decision: shift manager and up (unless it is the check-in default).
  if (!on && source === 'manual' && !MANAGER_ROLES.includes(actor.role)) throw httpError('פתיחת חיוב לחדר מותרת למנהל משמרת ומעלה', 403);
  const why = String(reason || '').trim().slice(0, 300);
  res.noPost = { on: !!on, source, by: actor.id || undefined, byName: actor.name, at: new Date(), reason: why || undefined };
  res.updatedBy = actor.id || undefined;
  await res.save({ session });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: on ? 'reservation.no_post_on' : 'reservation.no_post_off', entityType: 'Reservation', entityId: res._id, before: { noPost: was }, after: { noPost: !!on, source }, reason: why || undefined, ip, session, afterCommit });
  return { on: !!on };
}

// Called by postCharge: returns the approval to record, or throws when the charge is not allowed.
export function noPostGate({ res, code, input, actor }) {
  if (!res?.noPost?.on) return null;
  if (LODGING_CODES.includes(code.code)) return null;
  const approve = input.noPostApproval;
  if (!approve) throw httpError('האורח מסומן "ללא חיוב לחדר" — גובים במקום, או שמנהל מאשר את החיוב', 409, { code: 'no_post' });
  if (!MANAGER_ROLES.includes(actor.role)) throw httpError('אישור חיוב לחדר של אורח "ללא חיוב" — מנהל משמרת ומעלה', 403, { code: 'no_post' });
  const why = String(approve.reason || '').trim();
  if (why.length < 3) throw httpError('אישור החיוב מחייב סיבה', 422, { fields: { noPostReason: 'יש לפרט' } });
  return { by: actor.name, reason: why.slice(0, 300) };
}
