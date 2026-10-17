// Group billing — who pays for each room of a multi-room booking.
//
// Every room (stay unit) has two switches: who pays its nights (roomPayer) and who pays its extras
// (extrasPayer), each 'booker' (the reservation's main account) or 'guest' (the room's own account).
// The whole group can be set at once with one of the three standard routings hotels use:
//   all       — everything on the booker
//   room_only — nights on the booker, extras on each room's guest
//   none      — each room pays everything itself
// and any single room can then differ. A change applies from now on: nights already posted stay on
// the account they were posted to; the next nights follow the new setting.
import ReservationRoom from '../models/ReservationRoom.js';
import { audit } from './auditService.js';
import { httpError, loadReservationInScope, ensureUnits, withLocks, unitBilling } from './frontDeskService.js';
import { unitFolio } from './roomCharges.js';

const PAYERS = ['booker', 'guest'];
const MODES = {
  all: { roomPayer: 'booker', extrasPayer: 'booker' },
  room_only: { roomPayer: 'booker', extrasPayer: 'guest' },
  none: { roomPayer: 'guest', extrasPayer: 'guest' },
};
const CLOSED = ['checked_out', 'cancelled', 'no_show'];
const LIVE_RES = ['hold', 'pending_payment', 'confirmed', 'modified', 'checked_in', 'in_house', 'partially_checked_in', 'partially_checked_out'];

export function groupMode(units) {
  const live = units.filter((u) => !CLOSED.includes(u.status));
  if (!live.length) return null;
  const hit = Object.entries(MODES).find(([, m]) => live.every((u) => (u.roomPayer || 'booker') === m.roomPayer && (u.extrasPayer || 'booker') === m.extrasPayer));
  return hit ? hit[0] : 'mixed';
}

async function loadLive(propertyId, reservationId) {
  const res = await loadReservationInScope(reservationId, propertyId);
  if (!LIVE_RES.includes(res.status)) throw httpError('לא ניתן לשנות חיוב בהזמנה שנסגרה או בוטלה', 409);
  return res;
}

async function openOwnAccount(res, unit) {
  if (unit.roomPayer === 'guest' || unit.extrasPayer === 'guest') await unitFolio(res, unit._id);
}

export async function setRoomBilling({ propertyId, reservationId, unitIndex, input = {}, actor, ip }) {
  const res = await loadLive(propertyId, reservationId);
  return withLocks([`res:${res._id}`], async () => {
    const units = await ensureUnits(res);
    const unit = units[Number(unitIndex) - 1];
    if (!unit) throw httpError('החדר לא נמצא בהזמנה', 404);
    if (CLOSED.includes(unit.status)) throw httpError('החדר כבר יצא — לא ניתן לשנות את החיוב שלו', 409);
    const before = unitBilling(unit);
    const errors = {};
    if (input.roomPayer !== undefined && !PAYERS.includes(input.roomPayer)) errors.roomPayer = 'ערך לא תקין';
    if (input.extrasPayer !== undefined && !PAYERS.includes(input.extrasPayer)) errors.extrasPayer = 'ערך לא תקין';
    if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי החיוב', 422, { fields: errors });
    if (input.roomPayer !== undefined) unit.roomPayer = input.roomPayer;
    if (input.extrasPayer !== undefined) unit.extrasPayer = input.extrasPayer;
    if (input.occupantName !== undefined) unit.occupantName = String(input.occupantName || '').trim().slice(0, 120) || undefined;
    if (input.occupantPhone !== undefined) unit.occupantPhone = String(input.occupantPhone || '').trim().slice(0, 40) || undefined;
    await unit.save();
    await openOwnAccount(res, unit);
    await audit({
      property: res.property, actor: actor.id, actorName: actor.name, action: 'reservation.room_billing_set',
      entityType: 'ReservationRoom', entityId: unit._id, before, after: { reservation: String(res._id), unitIndex: Number(unitIndex), ...unitBilling(unit), occupantPhone: undefined }, ip,
    });
    return { unitIndex: Number(unitIndex), billing: unitBilling(unit), groupMode: groupMode(units) };
  });
}

export async function setGroupBilling({ propertyId, reservationId, mode, actor, ip }) {
  const m = MODES[mode];
  if (!m) throw httpError('אופן חיוב לא מוכר', 422, { fields: { mode: 'יש לבחור אופן חיוב' } });
  const res = await loadLive(propertyId, reservationId);
  return withLocks([`res:${res._id}`], async () => {
    const units = await ensureUnits(res);
    const before = groupMode(units);
    for (const u of units) {
      if (CLOSED.includes(u.status)) continue;
      u.roomPayer = m.roomPayer;
      u.extrasPayer = m.extrasPayer;
      await u.save();
      await openOwnAccount(res, u);
    }
    await audit({
      property: res.property, actor: actor.id, actorName: actor.name, action: 'reservation.group_billing_set',
      entityType: 'Reservation', entityId: res._id, before: { mode: before }, after: { mode }, ip,
    });
    return { mode, units: units.map((u, i) => ({ unitIndex: i + 1, billing: unitBilling(u) })) };
  });
}
