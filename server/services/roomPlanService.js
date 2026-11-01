// Automatic room assignment plan for a day's arrivals (INV-02 extension).
//
// The plan is a proposal only: it scores every free room of the booked type for every arrival
// unit that has no room yet, and explains each pick. Nothing is written until the desk applies
// it, and applying goes through assignRoom, which re-checks the full stay range under a lock.
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Room from '../models/Room.js';
import {
  httpError, policyOf, loadProperty, businessDateOf, implicitUnits, ensureUnits,
  conflictingRoomIds, occupancyMap, assignRoom, loadReservationInScope,
} from './frontDeskService.js';

const ARRIVING_STATUSES = ['confirmed', 'modified', 'pending_payment', 'partially_checked_in'];
const UNIT_OPEN_STATUSES = ['reserved', 'tentative'];
const ACCESSIBLE_RE = /נגיש|כיסא גלגלים|כסא גלגלים|wheelchair|accessib/i;

const idStr = (v) => (v ? String(v._id || v) : null);
const nightsBetween = (a, b) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));
const overlaps = (a, b) => a.from < b.to && b.from < a.to;

function scoreRoom({ room, need, readyClean, occupant, typeFloors, groupFloors }) {
  let score = 0;
  const reasons = [];
  const vacant = !occupant;
  if (vacant && readyClean.includes(room.cleanStatus)) { score += 50; reasons.push('מוכן עכשיו'); }
  else if (vacant) { score += 20; reasons.push('פנוי, ממתין לניקיון'); }
  else { score += 5; reasons.push(`יתפנה אחרי עזיבת ${occupant}`); }

  if (need.vip && room.isVip) { score += 15; reasons.push('חדר VIP לאורח VIP'); }
  if (!need.vip && room.isVip) score -= 10; // keep VIP rooms for VIP guests

  if (need.accessible) {
    if (room.isAccessible) { score += 40; reasons.push('חדר נגיש לפי בקשה'); }
    else score -= 30;
  } else if (room.isAccessible) score -= 15; // keep accessible rooms for guests who need them

  if (need.smoking === 'smoking' && room.isSmoking) { score += 10; reasons.push('חדר מעשנים לפי העדפה'); }
  if (need.smoking === 'non-smoking' && room.isSmoking) score -= 20;

  const { min, max } = typeFloors;
  if (max > min && ['high', 'low', 'middle'].includes(need.floor)) {
    const pos = (room.floor - min) / (max - min); // 0 = lowest floor of the type, 1 = highest
    const fit = need.floor === 'high' ? pos : need.floor === 'low' ? 1 - pos : 1 - Math.abs(pos - 0.5) * 2;
    score += Math.round(fit * 12);
    if (fit >= 0.6) reasons.push(need.floor === 'high' ? 'קומה גבוהה לפי העדפה' : need.floor === 'low' ? 'קומה נמוכה לפי העדפה' : 'קומת ביניים לפי העדפה');
  }

  if (groupFloors.size) {
    if (groupFloors.has(room.floor)) { score += 12; reasons.push('באותה קומה עם שאר חדרי ההזמנה'); }
  }
  return { score, reasons };
}

export async function proposeRoomPlan({ propertyId, date }) {
  const property = await loadProperty(propertyId);
  const policy = policyOf(property);
  const businessDate = businessDateOf(property);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : businessDate;
  const readyClean = policy.requireInspection ? ['inspected'] : ['clean', 'inspected'];

  const unitResIds = await ReservationRoom.distinct('reservation', { property: propertyId, arrivalDate: day });
  const reservations = await Reservation.find({
    property: propertyId,
    status: { $in: ARRIVING_STATUSES },
    $or: [{ arrivalDate: day }, { _id: { $in: unitResIds } }],
  })
    .populate({ path: 'primaryGuest', match: { property: propertyId }, select: 'firstName lastName vipLevel floorPreference smokingPreference specialRequests preferences' })
    .populate({ path: 'roomType', match: { property: propertyId }, select: 'name code' })
    .lean();

  const realUnits = await ReservationRoom.find({ property: propertyId, reservation: { $in: reservations.map((r) => r._id) } })
    .populate({ path: 'roomTypeBooked', match: { property: propertyId }, select: 'name code' })
    .sort({ createdAt: 1, _id: 1 }).lean();
  const unitsByRes = new Map();
  for (const u of realUnits) {
    const k = String(u.reservation);
    if (!unitsByRes.has(k)) unitsByRes.set(k, []);
    unitsByRes.get(k).push(u);
  }

  // Every unit arriving today: the open ones without a room are planned; assigned ones keep their
  // room and only tell the planner which floor the rest of their reservation is on.
  const work = [];
  const assignedByRes = new Map();
  for (const r of reservations) {
    const list = unitsByRes.get(String(r._id)) || implicitUnits(r);
    list.forEach((u, i) => {
      if ((u.arrivalDate || r.arrivalDate) !== day) return;
      if (u.assignedRoom) {
        const k = String(r._id);
        if (!assignedByRes.has(k)) assignedByRes.set(k, []);
        assignedByRes.get(k).push(idStr(u.assignedRoom));
        return;
      }
      if (!UNIT_OPEN_STATUSES.includes(u.status)) return;
      const g = r.primaryGuest || {};
      const text = `${r.specialRequests || ''} ${u.notes || ''} ${g.specialRequests || ''} ${g.preferences || ''}`;
      work.push({
        r, u, index: i + 1, unitsTotal: list.length,
        from: u.arrivalDate || r.arrivalDate,
        to: u.departureDate || r.departureDate,
        roomTypeId: idStr(u.roomTypeBooked || r.roomType),
        roomTypeName: u.roomTypeBooked?.name || r.roomType?.name || null,
        need: {
          vip: !!(r.isVip || g.vipLevel > 0),
          accessible: ACCESSIBLE_RE.test(text),
          floor: g.floorPreference || 'any',
          smoking: g.smokingPreference || 'any',
        },
        guestName: u.occupantName || `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'אורח ללא שם',
      });
    });
  }

  // VIPs and guests who need an accessible room choose first, then groups (so their rooms land
  // together), then by expected arrival time — the earliest guest gets the room that is ready now.
  work.sort((a, b) => (Number(b.need.vip) - Number(a.need.vip))
    || (Number(b.need.accessible) - Number(a.need.accessible))
    || (b.unitsTotal - a.unitsTotal)
    || String(a.r.eta || '99:99').localeCompare(String(b.r.eta || '99:99'))
    || String(a.r.confirmationNumber).localeCompare(String(b.r.confirmationNumber))
    || a.index - b.index);

  const typeIds = [...new Set(work.map((w) => w.roomTypeId).filter(Boolean))];
  const rooms = typeIds.length
    ? await Room.find({ property: propertyId, roomType: { $in: typeIds }, active: { $ne: false } }).sort({ floor: 1, number: 1 }).lean()
    : [];
  const roomsByType = new Map();
  for (const room of rooms) {
    const k = String(room.roomType);
    if (!roomsByType.has(k)) roomsByType.set(k, []);
    roomsByType.get(k).push(room);
  }
  const floorsOf = (list) => ({ min: Math.min(...list.map((x) => x.floor)), max: Math.max(...list.map((x) => x.floor)) });
  const roomById = new Map(rooms.map((x) => [String(x._id), x]));
  const occ = await occupancyMap(propertyId, rooms.map((x) => x._id));

  // Conflicts depend on the stay range and the reservation itself; cache per reservation.
  const conflictCache = new Map();
  const conflictsFor = async (w) => {
    const k = `${w.r._id}:${w.from}:${w.to}`;
    if (!conflictCache.has(k)) conflictCache.set(k, await conflictingRoomIds({ propertyId, from: w.from, to: w.to, excludeReservationId: w.r._id }));
    return conflictCache.get(k);
  };

  const planned = new Map(); // roomId → [{from,to}] proposed in this plan
  const plannedFloorsByRes = new Map();
  const rows = [];
  for (const w of work) {
    const pool = roomsByType.get(w.roomTypeId) || [];
    const conflicts = await conflictsFor(w);
    const own = new Set(assignedByRes.get(String(w.r._id)) || []);
    const groupFloors = new Set([
      ...[...own].map((id) => roomById.get(id)?.floor).filter((f) => f != null),
      ...(plannedFloorsByRes.get(String(w.r._id)) || []),
    ]);
    const scored = [];
    for (const room of pool) {
      const id = String(room._id);
      if (room.opsStatus && room.opsStatus !== 'available') continue;
      if (conflicts.has(id) || own.has(id)) continue;
      if ((planned.get(id) || []).some((p) => overlaps(p, w))) continue;
      const occupant = (occ.get(id) || []).find((x) => x.resId !== String(w.r._id))?.label || null;
      const { score, reasons } = scoreRoom({ room, need: w.need, readyClean, occupant, typeFloors: floorsOf(pool), groupFloors });
      scored.push({ room, score, reasons, ready: !occupant && readyClean.includes(room.cleanStatus) });
    }
    scored.sort((a, b) => b.score - a.score || a.room.floor - b.room.floor || String(a.room.number).localeCompare(String(b.room.number), 'he', { numeric: true }));
    const pick = scored[0] || null;
    if (pick) {
      const id = String(pick.room._id);
      if (!planned.has(id)) planned.set(id, []);
      planned.get(id).push({ from: w.from, to: w.to });
      const k = String(w.r._id);
      if (!plannedFloorsByRes.has(k)) plannedFloorsByRes.set(k, []);
      plannedFloorsByRes.get(k).push(pick.room.floor);
    }
    const dto = (s) => ({ id: String(s.room._id), number: s.room.number, floor: s.room.floor, cleanStatus: s.room.cleanStatus, ready: s.ready, score: s.score, reasons: s.reasons });
    rows.push({
      key: `${w.r._id}:${w.u._id || 'implicit'}:${w.index}`,
      reservationId: String(w.r._id),
      unitId: w.u._id ? String(w.u._id) : null,
      unitIndex: w.index,
      unitsTotal: w.unitsTotal,
      confirmationNumber: w.r.confirmationNumber,
      guest: { name: w.guestName, vip: w.need.vip },
      needs: { accessible: w.need.accessible, floor: w.need.floor, smoking: w.need.smoking },
      roomType: w.roomTypeId ? { id: w.roomTypeId, name: w.roomTypeName } : null,
      eta: w.r.eta || null,
      nights: nightsBetween(w.from, w.to),
      proposal: pick ? dto(pick) : null,
      alternatives: scored.slice(1, 4).map(dto),
      noRoomReason: pick ? null : (pool.length ? 'אין חדר פנוי מהסוג לכל הלילות' : 'אין חדרים מסוג זה בנכס'),
    });
  }

  return {
    date: day,
    businessDate,
    counts: { unassigned: rows.length, proposed: rows.filter((r) => r.proposal).length, readyNow: rows.filter((r) => r.proposal?.ready).length },
    rows,
  };
}

// Applies the rows the desk approved. Each one is a normal assignment (locked, re-checked,
// audited); one that lost its room in the meantime is reported, the rest still go through.
export async function applyRoomPlan({ propertyId, items, actor, ip }) {
  if (!Array.isArray(items) || !items.length) throw httpError('לא נבחרו שיבוצים', 422);
  if (items.length > 300) throw httpError('יותר מדי שיבוצים בבת אחת', 422);
  const applied = [];
  const failed = [];
  for (const item of items) {
    try {
      let unitId = item.unitId || null;
      if (!unitId) {
        // Implicit units (older/seeded reservations) are materialised first, in the order the plan showed them.
        const res = await loadReservationInScope(item.reservationId, propertyId);
        const units = await ensureUnits(res);
        unitId = units[Number(item.unitIndex || 1) - 1]?._id ? String(units[Number(item.unitIndex || 1) - 1]._id) : null;
        if (!unitId) throw httpError('יחידת השהייה לא נמצאה', 404);
      }
      const out = await assignRoom({ propertyId, reservationId: item.reservationId, unitId, roomId: item.roomId, actor, ip });
      applied.push({ ...out, key: item.key || null });
    } catch (err) {
      failed.push({ key: item.key || null, reservationId: item.reservationId, roomId: item.roomId, error: err.message || 'השיבוץ נכשל' });
    }
  }
  return { applied, failed };
}
