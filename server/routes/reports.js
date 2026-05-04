import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import GuestProfile from '../models/GuestProfile.js';

const router = Router();

// ── Helper: YYYY-MM-DD arithmetic ─────────────────────────────────────────────
function addDays(ymd, n) {
  const d = new Date(ymd);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function daysInRange(from, to) {
  const days = [];
  let cur = from;
  while (cur < to) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

// GET /api/reports/summary?propertyId=&from=&to=
// Returns occupancy + revenue stats for a date range
router.get('/summary', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const to   = req.query.to   || '2026-05-05';
  const from = req.query.from || addDays(to, -29);

  const [allRooms, reservations, guests] = await Promise.all([
    Room.countDocuments({ property: propertyId, active: true }),
    Reservation.find({
      property: propertyId,
      status: { $in: ['confirmed','in_house','checked_in','checked_out'] },
      // reservations that overlap the range
      arrivalDate:   { $lt: to },
      departureDate: { $gt: from },
    }).lean(),
    GuestProfile.countDocuments({ property: propertyId }),
  ]);

  const days = daysInRange(from, to);

  // Daily metrics
  const daily = days.map(date => {
    const occupied = reservations.filter(r => r.arrivalDate <= date && r.departureDate > date);
    const arrivals = reservations.filter(r => r.arrivalDate === date);
    const departures = reservations.filter(r => r.departureDate === date);
    const revenue = arrivals.reduce((s, r) => s + (r.totalAmount || 0), 0);
    return {
      date,
      occupied:   occupied.length,
      arrivals:   arrivals.length,
      departures: departures.length,
      occupancy:  allRooms ? Math.round(occupied.length / allRooms * 100) : 0,
      revenue,
      adr: arrivals.length ? Math.round(revenue / arrivals.length) : 0,
    };
  });

  // Totals for the range
  const total = {
    reservations: reservations.length,
    revenue:      reservations.reduce((s, r) => s + (r.totalAmount || 0), 0),
    nights:       reservations.reduce((s, r) => s + (r.nights || 0), 0),
    avgOccupancy: daily.length ? Math.round(daily.reduce((s, d) => s + d.occupancy, 0) / daily.length) : 0,
    totalRooms:   allRooms,
    totalGuests:  guests,
  };
  total.adr    = total.nights ? Math.round(total.revenue / total.nights) : 0;
  total.revpar = allRooms && days.length ? Math.round(total.revenue / (allRooms * days.length)) : 0;

  // Source breakdown
  const sourceMap = {};
  reservations.forEach(r => {
    const s = r.source || 'direct';
    sourceMap[s] = (sourceMap[s] || 0) + 1;
  });
  const bySource = Object.entries(sourceMap)
    .map(([source, count]) => ({ source, count, pct: Math.round(count / reservations.length * 100) }))
    .sort((a, b) => b.count - a.count);

  // Status breakdown
  const statusMap = {};
  reservations.forEach(r => { statusMap[r.status] = (statusMap[r.status] || 0) + 1; });
  const byStatus = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

  // Top 7 days by revenue
  const top7 = [...daily].sort((a, b) => b.revenue - a.revenue).slice(0, 7);

  res.json({ success: true, data: { daily, total, bySource, byStatus, top7, from, to } });
}));

// GET /api/reports/night-audit-preview?propertyId=&date=
// Returns what the night audit would do (preview before running)
router.get('/night-audit-preview', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const date = req.query.date || '2026-05-04';

  const inHouse = await Reservation.find({
    property: propertyId,
    status: { $in: ['in_house','checked_in'] },
  }).populate('primaryGuest','firstName lastName').populate('roomType','name').populate('assignedRoom','number').lean();

  const noShows = await Reservation.find({
    property: propertyId,
    arrivalDate: date,
    status: 'confirmed',
  }).populate('primaryGuest','firstName lastName').lean();

  // For each in-house, calculate room charge to post
  const roomCharges = inHouse.map(r => ({
    reservationId: String(r._id),
    confirmationNumber: r.confirmationNumber,
    guest: `${r.primaryGuest?.firstName} ${r.primaryGuest?.lastName}`,
    room: r.assignedRoom?.number,
    roomType: r.roomType?.name,
    amount: r.ratePerNight,
  }));

  const totalRoomRevenue = roomCharges.reduce((s, c) => s + c.amount, 0);

  res.json({
    success: true,
    data: {
      date,
      roomCharges,
      noShows: noShows.map(r => ({
        reservationId: String(r._id),
        confirmationNumber: r.confirmationNumber,
        guest: `${r.primaryGuest?.firstName} ${r.primaryGuest?.lastName}`,
      })),
      totalRoomRevenue,
      inHouseCount: inHouse.length,
    },
  });
}));

// POST /api/reports/night-audit
// Runs the night audit: posts room charges + marks no-shows
router.post('/night-audit', asyncHandler(async (req, res) => {
  const { propertyId, date = '2026-05-04', markNoShows = false } = req.body;

  const inHouse = await Reservation.find({
    property: propertyId,
    status: { $in: ['in_house','checked_in'] },
  }).lean();

  let chargesPosted = 0;
  let errors = [];

  for (const res of inHouse) {
    try {
      const folio = await Folio.findOne({ reservation: res._id, status: 'open' });
      if (!folio) continue;
      folio.lines.push({
        type: 'charge',
        description: 'לינה — Night Audit',
        amount: res.ratePerNight,
        taxAmount: 0,
        department: 'room',
        serviceDate: date,
        source: 'night_audit',
        status: 'posted',
      });
      await folio.save();
      chargesPosted++;
    } catch (e) {
      errors.push({ reservationId: String(res._id), error: e.message });
    }
  }

  // Mark no-shows
  let noShowsMarked = 0;
  if (markNoShows) {
    const confirmed = await Reservation.find({
      property: propertyId,
      arrivalDate: date,
      status: 'confirmed',
    });
    for (const r of confirmed) {
      r.status = 'no_show';
      await r.save();
      noShowsMarked++;
    }
  }

  res.json({
    success: true,
    data: {
      date,
      chargesPosted,
      noShowsMarked,
      errors,
      message: `Night Audit הושלם — ${chargesPosted} חיובי לינה, ${noShowsMarked} No Show`,
    },
  });
}));

export default router;
