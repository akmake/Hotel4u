// Monthly availability board (docs/product/monthly-availability-board.md, stage 1).
// Adds to the INV-01 grid, per night and per room type: rooms sold definite vs options (hold /
// pending payment), arrivals, departures, stayovers and guests in house, plus a summary of the range.
// Past nights count what really happened: a stay that left early stops on the day it left, and a
// booking whose arrival day passed without check-in does not count for the nights already gone.
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import { ymdInTimezone } from '../utils/dateHelpers.js';

const STAY_STATUSES = ['hold', 'pending_payment', 'confirmed', 'modified', 'in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out', 'checked_out'];
const TENTATIVE = ['hold', 'pending_payment'];
const IN_HOUSE = ['in_house', 'checked_in'];
const RES_ARRIVED = ['in_house', 'checked_in', 'checked_out', 'partially_checked_out'];

export const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
export const daysInMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

// Stay units touching [from, last] — ReservationRoom where it exists, else the reservation as its rooms.
async function loadUnits({ propertyId, from, last, tz }) {
  const res = await Reservation.find({ property: propertyId, status: { $in: STAY_STATUSES }, arrivalDate: { $lte: last }, departureDate: { $gte: from } })
    .select('status arrivalDate departureDate adults children roomsCount roomType checkedOutAt').lean();
  if (!res.length) return [];
  const units = await ReservationRoom.find({ reservation: { $in: res.map((r) => r._id) } }).select('reservation roomTypeBooked arrivalDate departureDate status').lean();
  const byRes = new Map();
  for (const u of units) byRes.set(String(u.reservation), [...(byRes.get(String(u.reservation)) || []), u]);
  const out = [];
  for (const r of res) {
    const list = byRes.get(String(r._id)) || Array.from({ length: Math.max(1, Number(r.roomsCount) || 1) }, () => ({ roomTypeBooked: r.roomType, status: null }));
    const share = list.length;
    for (const u of list) {
      if (['cancelled', 'no_show'].includes(u.status)) continue;
      const status = u.status || (r.status === 'checked_out' ? 'checked_out' : IN_HOUSE.includes(r.status) ? 'in_house' : 'reserved');
      const arrival = u.arrivalDate || r.arrivalDate;
      let departure = u.departureDate || r.departureDate;
      if (status === 'checked_out' && r.checkedOutAt) {
        const leftOn = ymdInTimezone(r.checkedOutAt, tz);
        if (leftOn > arrival && leftOn < departure) departure = leftOn;
      }
      out.push({
        type: String(u.roomTypeBooked || r.roomType),
        arrival, departure,
        arrived: IN_HOUSE.includes(status) || status === 'checked_out' || (!u.status && RES_ARRIVED.includes(r.status)) || (u.status === 'reserved' && RES_ARRIVED.includes(r.status) && share === 1),
        tentative: TENTATIVE.includes(r.status) && !IN_HOUSE.includes(status),
        // Heads spread over the reservation's rooms (rounded up), as in the housekeeping overview.
        guests: Math.ceil(Number(r.adults || 0) / share) + Math.ceil(Number(r.children || 0) / share),
      });
    }
  }
  return out;
}

const blank = () => ({ definite: 0, tentative: 0, arrivals: 0, departures: 0, stayovers: 0, guests: 0 });

// Movement per room type per date: { [typeId]: Map(date → counts) }.
function movement(units, dates, today) {
  const byType = new Map();
  const cell = (type, date) => {
    if (!byType.has(type)) byType.set(type, new Map(dates.map((d) => [d, blank()])));
    return byType.get(type).get(date);
  };
  for (const u of units) {
    for (const d of dates) {
      // A booking that never arrived does not fill nights that are already gone.
      const stale = !u.arrived && d < today;
      if (u.arrival <= d && d < u.departure && !stale) {
        const c = cell(u.type, d);
        if (u.tentative) { c.tentative += 1; continue; }
        c.definite += 1; c.guests += u.guests;
        if (u.arrival === d) c.arrivals += 1; else c.stayovers += 1;
      }
      if (u.departure === d && u.arrival < d && !u.tentative && (u.arrived || d >= today)) cell(u.type, d).departures += 1;
    }
  }
  return byType;
}

const pct = (n, of) => (of > 0 ? Math.round((Math.min(n, of) / of) * 100) : 0);

function summarize(nights) {
  const s = nights.reduce((a, n) => {
    a.sellableNights += Math.max(0, n.total - n.outOfSale);
    a.outOfSaleNights += n.outOfSale; a.definite += n.definite; a.tentative += n.tentative;
    a.arrivals += n.arrivals; a.departures += n.departures; a.guestNights += n.guests;
    a.minAvailable = Math.min(a.minAvailable, n.available);
    return a;
  }, { sellableNights: 0, outOfSaleNights: 0, definite: 0, tentative: 0, arrivals: 0, departures: 0, guestNights: 0, minAvailable: Infinity });
  return {
    ...s, minAvailable: Number.isFinite(s.minAvailable) ? s.minAvailable : 0,
    occupancyPct: pct(s.definite, s.sellableNights), occupancyWithOptionsPct: pct(s.definite + s.tentative, s.sellableNights),
  };
}

// grid = availabilityGrid() output. Returns the grid with the board fields merged in.
export async function enrichBoard({ propertyId, grid, tz, today }) {
  const { dates } = grid;
  if (!dates.length) return grid;
  const units = await loadUnits({ propertyId, from: dates[0], last: dates[dates.length - 1], tz });
  const byType = movement(units, dates, today);
  const rows = grid.rows.map((r) => {
    const mv = byType.get(r.roomType.id);
    const nights = r.nights.map((n) => {
      const m = mv?.get(n.date) || blank();
      const sellable = Math.max(0, n.total - n.outOfSale);
      return { ...n, ...m, occupancyPct: pct(m.definite, sellable), occupancyWithOptionsPct: pct(m.definite + m.tentative, sellable) };
    });
    return { ...r, nights, summary: summarize(nights) };
  });
  const totals = dates.map((date, i) => {
    const t = { date, total: 0, available: 0, outOfSale: 0, stopSell: false, ...blank() };
    for (const r of rows) {
      const n = r.nights[i];
      for (const k of ['total', 'available', 'outOfSale', 'definite', 'tentative', 'arrivals', 'departures', 'stayovers', 'guests']) t[k] += n[k] || 0;
    }
    // Rooms sold as a type no longer on sale still fill the house.
    for (const [type, mv] of byType) if (!rows.some((r) => r.roomType.id === type)) { const m = mv.get(date); for (const k of Object.keys(m)) t[k] += m[k]; }
    t.stopSell = rows.length > 0 && rows.every((r) => r.nights[i].stopSell);
    const sellable = Math.max(0, t.total - t.outOfSale);
    t.sold = t.definite + t.tentative;
    t.occupancyPct = pct(t.definite, sellable);
    t.occupancyWithOptionsPct = pct(t.definite + t.tentative, sellable);
    return t;
  });
  // Bookings whose arrival day passed without check-in still hold rooms — the desk must clear them.
  // Counted on the business date, whatever month is shown.
  const staleArrivals = await Reservation.countDocuments({ property: propertyId, status: { $in: ['confirmed', 'modified'] }, arrivalDate: { $lt: today }, departureDate: { $gt: today } });
  return { ...grid, rows, totals, summary: summarize(totals), staleArrivals };
}
