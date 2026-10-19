// G2 — kitchen report: expected diners per meal and day, from the board each stay was sold with.
// Rule (stated on the screen): breakfast the morning after a night (any board but room only);
// dinner on every night of half / full board; lunch on full-board days between arrival and departure.
// A stay's board: Reservation.board, else the board in its price snapshot, else the rate plan's board.
// Heads are split adults / children / infants (child ages vs. the property's infant age); stays still
// on hold or waiting for payment are counted apart as "tentative" so the kitchen sees what is sure.
// A stay that checked out early stops counting from the day it left.
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import { boardOfPlan, BOARD_LABELS, BOARDS } from './boardService.js';
import { businessDateOf } from './frontDeskService.js';
import { ymdInTimezone } from '../utils/dateHelpers.js';

const COUNTED = ['confirmed', 'modified', 'in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out', 'checked_out'];
const TENTATIVE = ['hold', 'pending_payment'];
const MEALS = ['breakfast', 'lunch', 'dinner'];
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const heads = () => ({ adults: 0, children: 0, infants: 0, total: 0, rooms: 0 });
const meal = () => ({ ...heads(), tentative: 0, byBoard: {} });
const guestName = (g) => (g ? `${g.firstName || ''} ${g.lastName || ''}`.trim() : '');

function split(r, infantMax) {
  const adults = Number(r.adults || 0);
  const kids = Number(r.children || 0);
  const ages = Array.isArray(r.childAges) && r.childAges.length === kids ? r.childAges.map(Number) : null;
  const infants = ages ? ages.filter((a) => a <= infantMax).length : 0;
  return { adults, children: kids - infants, infants, total: adults + kids, rooms: Math.max(1, Number(r.roomsCount || 1)) };
}
function addTo(slot, h) { slot.adults += h.adults; slot.children += h.children; slot.infants += h.infants; slot.total += h.total; slot.rooms += h.rooms; }

export async function mealCount({ propertyId, from, days = 7 }) {
  const property = await Property.findById(propertyId).select('timezone dayClose boardPricing').lean();
  const tz = property?.timezone || 'Asia/Jerusalem';
  const businessDate = businessDateOf(property);
  const start = isYmd(from) ? from : businessDate;
  const n = Math.min(31, Math.max(1, Number(days) || 7));
  const dates = Array.from({ length: n }, (_, i) => addDays(start, i));
  const infantMax = Number(property?.boardPricing?.infantMaxAge ?? 2);
  const rows = await Reservation.find({
    property: propertyId, status: { $in: [...COUNTED, ...TENTATIVE] }, arrivalDate: { $lte: dates[n - 1] }, departureDate: { $gte: start },
  }).select('confirmationNumber arrivalDate departureDate adults children childAges roomsCount board priceSnapshot.board.type ratePlan status checkedOutAt groupName groupCode group isVip specialRequests primaryGuest assignedRoom')
    .populate('ratePlan', 'includesBreakfast halfBoard fullBoard allInclusive')
    .populate('primaryGuest', 'firstName lastName allergies vipLevel')
    .populate('assignedRoom', 'number')
    .lean();

  const out = dates.map((date) => ({
    date,
    inHouse: heads(), arrivals: heads(), departures: heads(),
    breakfast: meal(), lunch: meal(), dinner: meal(),
    groups: {},
  }));
  const dietary = [];
  const ARRIVING = ['confirmed', 'modified', 'pending_payment', 'hold'];
  let stale = 0;
  for (const r of rows) {
    // Arrival day passed without check-in: the guest is not here (a no-show for the desk to clear).
    if (ARRIVING.includes(r.status) && r.arrivalDate < businessDate) { stale += 1; continue; }
    const board = r.board || r.priceSnapshot?.board?.type || boardOfPlan(r.ratePlan);
    const tentative = TENTATIVE.includes(r.status);
    // Early check-out: nights end on the day the guest actually left.
    let dep = r.departureDate;
    if (r.status === 'checked_out' && r.checkedOutAt) { const left = ymdInTimezone(r.checkedOutAt, tz); if (left < dep) dep = left; }
    const h = split(r, infantMax);
    const night = (d) => r.arrivalDate <= d && d < dep;
    const takes = {
      breakfast: (d) => board !== 'room_only' && night(addDays(d, -1)),
      lunch: (d) => board === 'full_board' && r.arrivalDate < d && d < dep,
      dinner: (d) => ['half_board', 'full_board'].includes(board) && night(d),
    };
    let anyMeal = false;
    for (const day of out) {
      const d = day.date;
      if (!tentative) {
        if (night(d)) addTo(day.inHouse, h);
        if (r.arrivalDate === d) addTo(day.arrivals, h);
        if (dep === d) addTo(day.departures, h);
      }
      const group = r.groupName || r.groupCode || r.group || null;
      for (const m of MEALS) {
        if (!takes[m](d)) continue;
        anyMeal = true;
        const slot = day[m];
        if (tentative) { slot.tentative += h.total; continue; }
        addTo(slot, h);
        const b = (slot.byBoard[board] ||= { board, label: BOARD_LABELS[board], total: 0 });
        b.total += h.total;
        if (group) {
          const g = (day.groups[group] ||= { name: group, rooms: h.rooms, breakfast: 0, lunch: 0, dinner: 0, board: BOARD_LABELS[board] });
          g[m] += h.total;
        }
      }
    }
    // Guests the kitchen must know by name: allergies on the profile or a special request.
    const allergies = String(r.primaryGuest?.allergies || '').trim();
    const request = String(r.specialRequests || '').trim();
    if (!tentative && anyMeal && (allergies || request || r.isVip || Number(r.primaryGuest?.vipLevel) > 0)) {
      dietary.push({
        id: String(r._id), confirmationNumber: r.confirmationNumber,
        guest: guestName(r.primaryGuest), room: r.assignedRoom?.number || null, rooms: h.rooms,
        arrivalDate: r.arrivalDate, departureDate: dep, board, boardLabel: BOARD_LABELS[board],
        heads: h.total, allergies: allergies || null, request: request || null,
        vip: !!r.isVip || Number(r.primaryGuest?.vipLevel) > 0,
      });
    }
  }
  const sum = (m) => out.reduce((s, d) => s + d[m].total, 0);
  return {
    from: start,
    businessDate,
    infantMaxAge: infantMax,
    boards: BOARDS.map((b) => ({ board: b, label: BOARD_LABELS[b] })),
    dates,
    days: out.map((d) => ({ ...d, groups: Object.values(d.groups).sort((a, b) => a.name.localeCompare(b.name, 'he')) })),
    staleArrivals: stale,
    totals: { breakfast: sum('breakfast'), lunch: sum('lunch'), dinner: sum('dinner') },
    dietary: dietary.sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate)),
  };
}

// Dining-room list for one day: one row per room that eats that day, with who, how many, which
// board and which meals — the hostess checks room numbers against it; the kitchen sees allergies.
// A multi-room booking is spread over its rooms (adults / children divided as evenly as possible).
export async function diningList({ propertyId, date }) {
  const { default: ReservationRoom } = await import('../models/ReservationRoom.js');
  const { implicitUnits } = await import('./frontDeskService.js');
  const property = await Property.findById(propertyId).select('timezone dayClose boardPricing').lean();
  const tz = property?.timezone || 'Asia/Jerusalem';
  const businessDate = businessDateOf(property);
  const day = isYmd(date) ? date : businessDate;
  const infantMax = Number(property?.boardPricing?.infantMaxAge ?? 2);
  const rows = await Reservation.find({
    property: propertyId, status: { $in: COUNTED }, arrivalDate: { $lte: day }, departureDate: { $gte: day },
  }).select('confirmationNumber arrivalDate departureDate adults children childAges roomsCount roomType board priceSnapshot.board.type ratePlan status checkedOutAt groupName groupCode group isVip specialRequests primaryGuest assignedRoom')
    .populate('ratePlan', 'includesBreakfast halfBoard fullBoard allInclusive')
    .populate('primaryGuest', 'firstName lastName allergies vipLevel')
    .lean();
  const units = await ReservationRoom.find({ reservation: { $in: rows.map((r) => r._id) }, status: { $nin: ['cancelled', 'no_show'] } })
    .populate('assignedRoom', 'number floor').sort({ createdAt: 1, _id: 1 }).lean();
  const byRes = new Map();
  for (const u of units) { const k = String(u.reservation); if (!byRes.has(k)) byRes.set(k, []); byRes.get(k).push(u); }
  const { default: Room } = await import('../models/Room.js');
  const implicitRoomIds = rows.filter((r) => !byRes.has(String(r._id)) && r.assignedRoom).map((r) => r.assignedRoom);
  const roomById = new Map((await Room.find({ _id: { $in: implicitRoomIds } }).select('number floor').lean()).map((x) => [String(x._id), x]));

  const out = [];
  let stale = 0;
  for (const r of rows) {
    if (['confirmed', 'modified'].includes(r.status) && r.arrivalDate < businessDate) { stale += 1; continue; }
    const board = r.board || r.priceSnapshot?.board?.type || boardOfPlan(r.ratePlan);
    if (board === 'room_only') continue;
    let resDep = r.departureDate;
    if (r.status === 'checked_out' && r.checkedOutAt) { const left = ymdInTimezone(r.checkedOutAt, tz); if (left < resDep) resDep = left; }
    const list = byRes.get(String(r._id)) || implicitUnits(r).map((u) => ({ ...u, assignedRoom: u.assignedRoom ? roomById.get(String(u.assignedRoom)) : null }));
    const h = split(r, infantMax);
    const nUnits = list.length || 1;
    // Even split of heads over the rooms; the first rooms take the remainder.
    const share = (total, i) => Math.floor(total / nUnits) + (i < total % nUnits ? 1 : 0);
    list.forEach((u, i) => {
      const arr = u.arrivalDate || r.arrivalDate;
      const dep = u.status === 'checked_out' ? (u.departureDate < resDep ? u.departureDate : resDep) : (u.departureDate || resDep);
      const night = (d) => arr <= d && d < dep;
      const meals = {
        breakfast: night(addDays(day, -1)),
        lunch: board === 'full_board' && arr < day && day < dep,
        dinner: ['half_board', 'full_board'].includes(board) && night(day),
      };
      if (!meals.breakfast && !meals.lunch && !meals.dinner) return;
      const adults = share(h.adults, i); const children = share(h.children, i); const infants = share(h.infants, i);
      out.push({
        id: `${r._id}:${i}`, reservationId: String(r._id), confirmationNumber: r.confirmationNumber,
        room: u.assignedRoom?.number || null, floor: u.assignedRoom?.floor ?? null,
        guest: u.occupantName || guestName(r.primaryGuest),
        adults, children, infants, total: adults + children + infants,
        board, boardLabel: BOARD_LABELS[board], meals,
        arrivalDate: arr, departureDate: dep, arrivesToday: arr === day, leavesToday: dep === day,
        group: r.groupName || r.groupCode || r.group || null,
        vip: !!r.isVip || Number(r.primaryGuest?.vipLevel) > 0,
        allergies: String(r.primaryGuest?.allergies || '').trim() || null,
        request: String(r.specialRequests || '').trim() || null,
      });
    });
  }
  out.sort((a, b) => (a.room ? 0 : 1) - (b.room ? 0 : 1) || String(a.room || '').localeCompare(String(b.room || ''), 'he', { numeric: true }) || a.guest.localeCompare(b.guest, 'he'));
  return { date: day, businessDate, infantMaxAge: infantMax, staleArrivals: stale, rows: out };
}
