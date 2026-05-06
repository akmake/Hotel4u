import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import { audit } from '../services/auditService.js';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import GuestProfile from '../models/GuestProfile.js';
import AuditLog from '../models/AuditLog.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Invoice from '../models/Invoice.js';
import GuestRegistrationCard from '../models/GuestRegistrationCard.js';

const router = Router();
const REPORT_VIEW_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'finance_manager', 'cashier', 'revenue_manager', 'auditor', 'owner_readonly'];
const REPORT_NIGHT_AUDIT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'finance_manager'];

router.use((req, _res, next) => {
  requireRoles(req, REPORT_VIEW_ROLES, 'Reports access denied');
  next();
});

router.use((req, _res, next) => {
  const actorPropertyId = req.actor?.propertyId ? String(req.actor.propertyId) : null;
  if (actorPropertyId && !req.query.propertyId) {
    req.query.propertyId = actorPropertyId;
  }
  if (actorPropertyId && req.body && !req.body.propertyId) {
    req.body.propertyId = actorPropertyId;
  }
  next();
});

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
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
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
  assertPropertyScope(req, propertyId);
  const date = req.query.date || new Date().toISOString().split('T')[0];

  // Check if already ran today
  const alreadyRan = await AuditLog.findOne({
    property: propertyId,
    action: 'night_audit.completed',
    'after.date': date,
  }).lean();

  const [inHouse, noShows, departingToday, oooRooms] = await Promise.all([
    Reservation.find({
      property: propertyId,
      status: { $in: ['in_house', 'checked_in'] },
    }).populate('primaryGuest', 'firstName lastName').populate('roomType', 'name').populate('assignedRoom', 'number').lean(),

    Reservation.find({
      property: propertyId,
      arrivalDate: date,
      status: 'confirmed',
    }).populate('primaryGuest', 'firstName lastName').lean(),

    Reservation.find({
      property: propertyId,
      departureDate: date,
      status: { $in: ['in_house', 'checked_in'] },
    }).populate('primaryGuest', 'firstName lastName').lean(),

    Room.find({
      property: propertyId,
      opsStatus: { $in: ['out_of_order', 'out_of_service'] },
    }).populate('roomType', 'name').lean(),
  ]);

  // For each departing res, check folio balance
  const depResIds = departingToday.map(r => r._id);
  const openFolios = depResIds.length
    ? await Folio.find({ reservation: { $in: depResIds }, status: 'open' }).lean()
    : [];

  const openBalances = [];
  for (const folio of openFolios) {
    const balance = folio.lines
      .filter(l => l.status === 'posted')
      .reduce((s, l) => s + (l.amount || 0) + (l.taxAmount || 0), 0);
    if (balance > 0.01) {
      const res = departingToday.find(r => String(r._id) === String(folio.reservation));
      if (res) {
        openBalances.push({
          reservationId: String(res._id),
          confirmationNumber: res.confirmationNumber,
          guest: `${res.primaryGuest?.firstName} ${res.primaryGuest?.lastName}`,
          balance: Math.round(balance * 100) / 100,
        });
      }
    }
  }

  // For each in-house, calculate room charge to post
  const roomCharges = inHouse.map(r => ({
    reservationId: String(r._id),
    confirmationNumber: r.confirmationNumber,
    guest: `${r.primaryGuest?.firstName} ${r.primaryGuest?.lastName}`,
    room: r.assignedRoom?.number,
    roomType: r.roomType?.name,
    amount: r.ratePerNight || 0,
  }));

  const totalRoomRevenue = roomCharges.reduce((s, c) => s + c.amount, 0);

  res.json({
    success: true,
    data: {
      date,
      alreadyRan: alreadyRan ? { at: alreadyRan.createdAt, by: alreadyRan.actorName, result: alreadyRan.after } : null,
      roomCharges,
      noShows: noShows.map(r => ({
        reservationId: String(r._id),
        confirmationNumber: r.confirmationNumber,
        guest: `${r.primaryGuest?.firstName} ${r.primaryGuest?.lastName}`,
      })),
      openBalances,
      oooRooms: oooRooms.map(r => ({
        roomId: String(r._id),
        number: r.number,
        floor: r.floor,
        roomType: r.roomType?.name,
        opsStatus: r.opsStatus,
        outOfServiceUntil: r.outOfServiceUntil,
      })),
      totalRoomRevenue,
      inHouseCount: inHouse.length,
      departingCount: departingToday.length,
    },
  });
}));

// POST /api/reports/night-audit
// Runs the night audit: posts room charges + marks no-shows
router.post('/night-audit', asyncHandler(async (req, res) => {
  requireRoles(req, REPORT_NIGHT_AUDIT_ROLES, 'Night audit requires manager permissions');
  const { propertyId, date, markNoShows = false } = req.body;
  assertPropertyScope(req, propertyId);
  const auditDate = date || new Date().toISOString().split('T')[0];

  // Idempotency — refuse if already ran for this date
  const alreadyRan = await AuditLog.findOne({
    property: propertyId,
    action: 'night_audit.completed',
    'after.date': auditDate,
  }).lean();
  if (alreadyRan) {
    return res.status(409).json({
      success: false,
      error: `Night Audit ל-${auditDate} כבר הורץ ב-${new Date(alreadyRan.createdAt).toLocaleString('he-IL')}`,
    });
  }

  const inHouse = await Reservation.find({
    property: propertyId,
    status: { $in: ['in_house', 'checked_in'] },
  }).lean();

  let chargesPosted = 0;
  const errors = [];

  for (const reservation of inHouse) {
    try {
      const folio = await Folio.findOne({ reservation: reservation._id, status: 'open' });
      if (!folio) continue;
      folio.lines.push({
        type: 'charge',
        description: 'לינה — Night Audit',
        amount: reservation.ratePerNight || 0,
        taxAmount: 0,
        department: 'room',
        serviceDate: auditDate,
        source: 'night_audit',
        status: 'posted',
      });
      await folio.save();
      chargesPosted++;
    } catch (e) {
      errors.push({ reservationId: String(reservation._id), error: e.message });
    }
  }

  // Mark no-shows
  let noShowsMarked = 0;
  if (markNoShows) {
    const confirmed = await Reservation.find({
      property: propertyId,
      arrivalDate: auditDate,
      status: 'confirmed',
    });
    for (const r of confirmed) {
      r.status = 'no_show';
      await r.save();
      noShowsMarked++;
    }
  }

  // Save audit trail
  await audit({
    property: propertyId,
    action: 'night_audit.completed',
    entityType: 'Property',
    entityId: propertyId,
    after: { date: auditDate, chargesPosted, noShowsMarked, errors: errors.length },
    ip: req.ip,
  }).catch(() => null);

  res.json({
    success: true,
    data: {
      date: auditDate,
      chargesPosted,
      noShowsMarked,
      errors,
      message: `Night Audit הושלם — ${chargesPosted} חיובי לינה, ${noShowsMarked} No Show`,
    },
  });
}));

// GET /api/reports/night-audit-history?propertyId=&limit=30
router.get('/night-audit-history', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const logs = await AuditLog.find({
    property: propertyId,
    action: 'night_audit.completed',
  }).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ success: true, data: logs });
}));

// ══════════════════════════════════════════════════════════════════════════════
// פרק י"ז — דוחות תפעוליים (section 30)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/reports/cancellations?propertyId=&from=&to=
router.get('/cancellations', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);

  const cancellations = await Reservation.find({
    property: propertyId,
    status: 'cancelled',
    updatedAt: { $gte: new Date(from), $lte: new Date(to + 'T23:59:59Z') },
  })
    .populate('primaryGuest', 'firstName lastName email')
    .populate('roomType', 'name code')
    .lean();

  const total = cancellations.length;
  const feeTotal = cancellations.reduce((s, r) => s + (r.cancellationFee || 0), 0);

  // Cancellations by source
  const bySource = {};
  cancellations.forEach(r => {
    const s = r.source || 'direct';
    bySource[s] = (bySource[s] || 0) + 1;
  });

  // Cancellations by reason
  const byReason = {};
  cancellations.forEach(r => {
    const reason = r.cancellationReason || 'unspecified';
    byReason[reason] = (byReason[reason] || 0) + 1;
  });

  res.json({
    success: true,
    data: {
      from, to, total, feeTotal,
      bySource: Object.entries(bySource).map(([source, count]) => ({ source, count })),
      byReason: Object.entries(byReason).map(([reason, count]) => ({ reason, count })),
      list: cancellations.map(r => ({
        id: String(r._id),
        confirmationNumber: r.confirmationNumber,
        guest: `${r.primaryGuest?.firstName || ''} ${r.primaryGuest?.lastName || ''}`.trim(),
        guestEmail: r.primaryGuest?.email,
        roomType: r.roomType?.name,
        arrivalDate: r.arrivalDate,
        departureDate: r.departureDate,
        nights: r.nights,
        totalAmount: r.totalAmount,
        cancellationFee: r.cancellationFee || 0,
        source: r.source,
        cancelledAt: r.updatedAt,
        reason: r.cancellationReason,
      })),
    },
  });
}));

// GET /api/reports/no-shows?propertyId=&from=&to=
router.get('/no-shows', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);

  const noShows = await Reservation.find({
    property: propertyId,
    status: 'no_show',
    arrivalDate: { $gte: from, $lte: to },
  })
    .populate('primaryGuest', 'firstName lastName email phone')
    .populate('roomType', 'name code')
    .lean();

  const total = noShows.length;
  const lostRevenue = noShows.reduce((s, r) => s + (r.totalAmount || 0), 0);
  const feesCharged = noShows.reduce((s, r) => s + (r.noShowFee || r.cancellationFee || 0), 0);

  res.json({
    success: true,
    data: {
      from, to, total, lostRevenue, feesCharged,
      list: noShows.map(r => ({
        id: String(r._id),
        confirmationNumber: r.confirmationNumber,
        guest: `${r.primaryGuest?.firstName || ''} ${r.primaryGuest?.lastName || ''}`.trim(),
        guestEmail: r.primaryGuest?.email,
        guestPhone: r.primaryGuest?.phone,
        roomType: r.roomType?.name,
        arrivalDate: r.arrivalDate,
        nights: r.nights,
        totalAmount: r.totalAmount,
        noShowFee: r.noShowFee || r.cancellationFee || 0,
        source: r.source,
      })),
    },
  });
}));

// GET /api/reports/in-house?propertyId=&date=
router.get('/in-house', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const inHouse = await Reservation.find({
    property: propertyId,
    status: { $in: ['in_house', 'checked_in'] },
    arrivalDate: { $lte: date },
    departureDate: { $gt: date },
  })
    .populate('primaryGuest', 'firstName lastName nationality vipLevel')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .populate('ratePlan', 'name code')
    .lean();

  res.json({
    success: true,
    data: {
      date,
      count: inHouse.length,
      vipCount: inHouse.filter(r => r.isVip || r.primaryGuest?.vipLevel > 0).length,
      list: inHouse.map(r => ({
        id: String(r._id),
        confirmationNumber: r.confirmationNumber,
        guest: `${r.primaryGuest?.firstName || ''} ${r.primaryGuest?.lastName || ''}`.trim(),
        nationality: r.primaryGuest?.nationality,
        vipLevel: r.primaryGuest?.vipLevel,
        room: r.assignedRoom?.number,
        floor: r.assignedRoom?.floor,
        roomType: r.roomType?.name,
        ratePlan: r.ratePlan?.name,
        arrivalDate: r.arrivalDate,
        departureDate: r.departureDate,
        nights: r.nights,
        ratePerNight: r.ratePerNight,
        source: r.source,
      })),
    },
  });
}));

// GET /api/reports/housekeeping-productivity?propertyId=&from=&to=
router.get('/housekeeping-productivity', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -6);

  const tasks = await HousekeepingTask.find({
    property: propertyId,
    date: { $gte: from, $lte: to },
  }).lean();

  const total      = tasks.length;
  const completed  = tasks.filter(t => ['completed','inspected'].includes(t.status)).length;
  const failed     = tasks.filter(t => t.status === 'failed_inspection').length;
  const pending    = tasks.filter(t => ['new','assigned'].includes(t.status)).length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;

  // By attendant
  const byAttendant = {};
  tasks.forEach(t => {
    const key = t.assignedTo ? String(t.assignedTo) : 'unassigned';
    if (!byAttendant[key]) byAttendant[key] = { tasks: 0, completed: 0, failed: 0 };
    byAttendant[key].tasks++;
    if (['completed','inspected'].includes(t.status)) byAttendant[key].completed++;
    if (t.status === 'failed_inspection') byAttendant[key].failed++;
  });

  // By task type
  const byType = {};
  tasks.forEach(t => {
    const key = t.taskType || t.type || 'unknown';
    byType[key] = (byType[key] || 0) + 1;
  });

  // Avg duration (minutes) for completed tasks with times
  const durations = tasks
    .filter(t => t.startedAt && t.completedAt)
    .map(t => (new Date(t.completedAt) - new Date(t.startedAt)) / 60000);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : null;

  res.json({
    success: true,
    data: {
      from, to, total, completed, failed, pending, inProgress,
      completionRate: total ? Math.round(completed / total * 100) : 0,
      avgDurationMinutes: avgDuration,
      byType: Object.entries(byType).map(([type, count]) => ({ type, count })),
      byAttendant: Object.entries(byAttendant).map(([id, s]) => ({ attendantId: id, ...s })),
    },
  });
}));

// GET /api/reports/maintenance-tickets?propertyId=&status=&from=&to=
router.get('/maintenance-tickets', asyncHandler(async (req, res) => {
  const { propertyId, status } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);

  const filter = {
    property: propertyId,
    createdAt: { $gte: new Date(from), $lte: new Date(to + 'T23:59:59Z') },
  };
  if (status) filter.status = status;

  const tickets = await MaintenanceTicket.find(filter)
    .populate('room', 'number floor')
    .lean();

  const byStatus = {};
  const byCategory = {};
  const byPriority = {};
  tickets.forEach(t => {
    byStatus[t.status]       = (byStatus[t.status] || 0) + 1;
    byCategory[t.category]   = (byCategory[t.category] || 0) + 1;
    byPriority[t.priority]   = (byPriority[t.priority] || 0) + 1;
  });

  const resolved = tickets.filter(t => ['resolved','closed','verified'].includes(t.status));
  const avgResolutionHours = resolved.length
    ? Math.round(
        resolved
          .filter(t => t.resolvedAt && t.createdAt)
          .reduce((s, t) => s + (new Date(t.resolvedAt) - new Date(t.createdAt)) / 3600000, 0)
        / (resolved.filter(t => t.resolvedAt).length || 1)
      )
    : null;

  res.json({
    success: true,
    data: {
      from, to,
      total: tickets.length,
      open: tickets.filter(t => !['resolved','closed','verified'].includes(t.status)).length,
      resolved: resolved.length,
      avgResolutionHours,
      byStatus:    Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      byCategory:  Object.entries(byCategory).map(([category, count]) => ({ category, count })),
      byPriority:  Object.entries(byPriority).map(([priority, count]) => ({ priority, count })),
    },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// פרק י"ז — דוחות כספיים (section 31)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/reports/revenue-by-department?propertyId=&from=&to=
router.get('/revenue-by-department', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);

  const folios = await Folio.find({ property: propertyId }).lean();

  const deptMap = {};
  let totalRevenue = 0;
  let totalTax = 0;

  for (const folio of folios) {
    for (const line of (folio.lines || [])) {
      if (line.status !== 'posted') continue;
      if (!['charge', 'fee'].includes(line.type)) continue;
      const sd = line.serviceDate || line.postedAt?.toISOString()?.split('T')[0];
      if (!sd || sd < from || sd > to) continue;
      const dept = line.department || 'other';
      if (!deptMap[dept]) deptMap[dept] = { revenue: 0, tax: 0, count: 0 };
      deptMap[dept].revenue += line.amount || 0;
      deptMap[dept].tax     += line.taxAmount || 0;
      deptMap[dept].count++;
      totalRevenue += line.amount || 0;
      totalTax     += line.taxAmount || 0;
    }
  }

  const departments = Object.entries(deptMap)
    .map(([dept, s]) => ({
      department: dept,
      revenue: Math.round(s.revenue * 100) / 100,
      tax:     Math.round(s.tax * 100) / 100,
      count:   s.count,
      pct:     totalRevenue ? Math.round(s.revenue / totalRevenue * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  res.json({
    success: true,
    data: {
      from, to,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalTax:     Math.round(totalTax * 100) / 100,
      departments,
    },
  });
}));

// GET /api/reports/open-folios?propertyId=&minBalance=0
router.get('/open-folios', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const minBalance = Number(req.query.minBalance) || 0;

  const folios = await Folio.find({ property: propertyId, status: 'open' })
    .populate('reservation', 'confirmationNumber arrivalDate departureDate primaryGuest')
    .lean();

  const result = [];
  for (const folio of folios) {
    const posted = (folio.lines || []).filter(l => l.status === 'posted');
    const charges  = posted.filter(l => ['charge','fee','tax'].includes(l.type)).reduce((s, l) => s + (l.amount || 0) + (l.taxAmount || 0), 0);
    const payments = posted.filter(l => ['payment','deposit'].includes(l.type)).reduce((s, l) => s + Math.abs(l.amount || 0), 0);
    const balance  = Math.round((charges - payments) * 100) / 100;
    if (balance < minBalance) continue;
    result.push({
      folioId: String(folio._id),
      reservation: folio.reservation?.confirmationNumber,
      arrivalDate: folio.reservation?.arrivalDate,
      departureDate: folio.reservation?.departureDate,
      ownerType: folio.ownerType,
      currency: folio.currency,
      charges:  Math.round(charges * 100) / 100,
      payments: Math.round(payments * 100) / 100,
      balance,
      lineCount: posted.length,
    });
  }

  result.sort((a, b) => b.balance - a.balance);

  res.json({
    success: true,
    data: {
      count:        result.length,
      totalBalance: Math.round(result.reduce((s, f) => s + f.balance, 0) * 100) / 100,
      folios:       result,
    },
  });
}));

// GET /api/reports/tax-report?propertyId=&from=&to=
router.get('/tax-report', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);

  const folios = await Folio.find({ property: propertyId }).lean();

  let totalNet = 0;
  let totalTax = 0;
  let totalGross = 0;
  const byDay = {};

  for (const folio of folios) {
    for (const line of (folio.lines || [])) {
      if (line.status !== 'posted') continue;
      if (!['charge','fee'].includes(line.type)) continue;
      const sd = line.serviceDate || line.postedAt?.toISOString()?.split('T')[0];
      if (!sd || sd < from || sd > to) continue;
      const tax = line.taxAmount || 0;
      const net = line.amount || 0;
      totalNet   += net;
      totalTax   += tax;
      totalGross += net + tax;
      if (!byDay[sd]) byDay[sd] = { net: 0, tax: 0, gross: 0 };
      byDay[sd].net   += net;
      byDay[sd].tax   += tax;
      byDay[sd].gross += net + tax;
    }
  }

  const daily = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, s]) => ({
      date,
      net:   Math.round(s.net   * 100) / 100,
      tax:   Math.round(s.tax   * 100) / 100,
      gross: Math.round(s.gross * 100) / 100,
    }));

  res.json({
    success: true,
    data: {
      from, to,
      totalNet:   Math.round(totalNet   * 100) / 100,
      totalTax:   Math.round(totalTax   * 100) / 100,
      totalGross: Math.round(totalGross * 100) / 100,
      taxRate:    totalGross ? Math.round(totalTax / totalGross * 100 * 10) / 10 : 0,
      daily,
    },
  });
}));

// GET /api/reports/ar-aging?propertyId=
// Accounts receivable aging: company accounts grouped by 0-30, 31-60, 61-90, 90+ days
router.get('/ar-aging', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const today = new Date().toISOString().split('T')[0];

  // Find all open company/house folios
  const folios = await Folio.find({
    property: propertyId,
    status: 'open',
    ownerType: { $in: ['company', 'agent', 'house'] },
  })
    .populate('reservation', 'confirmationNumber company departureDate')
    .lean();

  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const items = [];

  for (const folio of folios) {
    const posted   = (folio.lines || []).filter(l => l.status === 'posted');
    const charges  = posted.filter(l => ['charge','fee','tax'].includes(l.type)).reduce((s, l) => s + (l.amount || 0) + (l.taxAmount || 0), 0);
    const payments = posted.filter(l => ['payment','deposit'].includes(l.type)).reduce((s, l) => s + Math.abs(l.amount || 0), 0);
    const balance  = Math.round((charges - payments) * 100) / 100;
    if (balance <= 0) continue;

    // Age from departure date or folio creation
    const refDate = folio.reservation?.departureDate || folio.createdAt?.toISOString()?.split('T')[0];
    const ageMs   = refDate ? new Date(today) - new Date(refDate) : 0;
    const ageDays = Math.max(0, Math.floor(ageMs / 86400000));

    let bucket;
    if (ageDays <= 30)      bucket = '0-30';
    else if (ageDays <= 60) bucket = '31-60';
    else if (ageDays <= 90) bucket = '61-90';
    else                    bucket = '90+';

    buckets[bucket] += balance;
    items.push({
      folioId: String(folio._id),
      ownerType: folio.ownerType,
      reservation: folio.reservation?.confirmationNumber,
      departureDate: folio.reservation?.departureDate,
      ageDays,
      bucket,
      balance,
    });
  }

  items.sort((a, b) => b.ageDays - a.ageDays);

  res.json({
    success: true,
    data: {
      total: Math.round(Object.values(buckets).reduce((s, v) => s + v, 0) * 100) / 100,
      buckets: Object.entries(buckets).map(([range, amount]) => ({ range, amount: Math.round(amount * 100) / 100 })),
      items,
    },
  });
}));

// GET /api/reports/cashier-closure?propertyId=&date=
// End-of-day cashier report: all payments collected on a given business day
router.get('/cashier-closure', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const dayStart = new Date(date + 'T00:00:00Z');
  const dayEnd   = new Date(date + 'T23:59:59Z');

  const folios = await Folio.find({ property: propertyId }).lean();

  const methodMap = {};
  let totalCollected = 0;
  let totalRefunded  = 0;

  for (const folio of folios) {
    for (const line of (folio.lines || [])) {
      if (!line.postedAt) continue;
      const at = new Date(line.postedAt);
      if (at < dayStart || at > dayEnd) continue;
      if (line.status !== 'posted') continue;

      if (line.type === 'payment') {
        const method = line.paymentMethod || line.description || 'other';
        const amt    = Math.abs(line.amount || 0);
        methodMap[method] = (methodMap[method] || 0) + amt;
        totalCollected += amt;
      }
      if (line.type === 'refund') {
        totalRefunded += Math.abs(line.amount || 0);
      }
    }
  }

  const byMethod = Object.entries(methodMap)
    .map(([method, amount]) => ({ method, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);

  res.json({
    success: true,
    data: {
      date,
      totalCollected: Math.round(totalCollected * 100) / 100,
      totalRefunded:  Math.round(totalRefunded * 100) / 100,
      net:            Math.round((totalCollected - totalRefunded) * 100) / 100,
      byMethod,
    },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// פרק י"ז — דוחות ניהול הכנסות (section 32)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/reports/channel-performance?propertyId=&from=&to=
router.get('/channel-performance', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);

  const reservations = await Reservation.find({
    property: propertyId,
    status: { $nin: ['cancelled'] },
    arrivalDate: { $gte: from, $lte: to },
  }).lean();

  const channelMap = {};
  for (const r of reservations) {
    const ch = r.source || 'direct';
    if (!channelMap[ch]) channelMap[ch] = { bookings: 0, revenue: 0, nights: 0, cancellations: 0 };
    channelMap[ch].bookings++;
    channelMap[ch].revenue += r.totalAmount || 0;
    channelMap[ch].nights  += r.nights || 0;
  }

  const cancelled = await Reservation.find({
    property: propertyId,
    status: 'cancelled',
    arrivalDate: { $gte: from, $lte: to },
  }).lean();
  for (const r of cancelled) {
    const ch = r.source || 'direct';
    if (!channelMap[ch]) channelMap[ch] = { bookings: 0, revenue: 0, nights: 0, cancellations: 0 };
    channelMap[ch].cancellations++;
  }

  const channels = Object.entries(channelMap)
    .map(([channel, s]) => ({
      channel,
      bookings:      s.bookings,
      revenue:       Math.round(s.revenue * 100) / 100,
      nights:        s.nights,
      cancellations: s.cancellations,
      adr:           s.nights ? Math.round(s.revenue / s.nights * 100) / 100 : 0,
      cancelRate:    (s.bookings + s.cancellations) ? Math.round(s.cancellations / (s.bookings + s.cancellations) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  res.json({ success: true, data: { from, to, channels } });
}));

// GET /api/reports/market-segment?propertyId=&from=&to=
router.get('/market-segment', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);

  const reservations = await Reservation.find({
    property: propertyId,
    status: { $nin: ['cancelled'] },
    arrivalDate: { $gte: from, $lte: to },
  }).lean();

  const segMap = {};
  for (const r of reservations) {
    const seg = r.marketSegment || r.source || 'transient';
    if (!segMap[seg]) segMap[seg] = { bookings: 0, revenue: 0, nights: 0 };
    segMap[seg].bookings++;
    segMap[seg].revenue += r.totalAmount || 0;
    segMap[seg].nights  += r.nights || 0;
  }

  const segments = Object.entries(segMap)
    .map(([segment, s]) => ({
      segment,
      bookings: s.bookings,
      revenue:  Math.round(s.revenue * 100) / 100,
      nights:   s.nights,
      adr:      s.nights ? Math.round(s.revenue / s.nights * 100) / 100 : 0,
      pct:      reservations.length ? Math.round(s.bookings / reservations.length * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  res.json({ success: true, data: { from, to, segments } });
}));

// GET /api/reports/pickup?propertyId=&targetFrom=&targetTo=&createdWithin=14
// Shows how many reservations were CREATED in the last N days for future arrivals
router.get('/pickup', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const today         = new Date().toISOString().split('T')[0];
  const targetFrom    = req.query.targetFrom || today;
  const targetTo      = req.query.targetTo   || addDays(today, 29);
  const createdWithin = Math.min(Number(req.query.createdWithin) || 14, 90);
  const since         = addDays(today, -createdWithin);

  const reservations = await Reservation.find({
    property: propertyId,
    status: { $nin: ['cancelled'] },
    arrivalDate: { $gte: targetFrom, $lte: targetTo },
    createdAt:   { $gte: new Date(since) },
  }).lean();

  // Daily pickup
  const pickupByDay = {};
  for (const r of reservations) {
    const createdDate = r.createdAt?.toISOString()?.split('T')[0];
    if (!createdDate) continue;
    if (!pickupByDay[createdDate]) pickupByDay[createdDate] = { bookings: 0, revenue: 0, nights: 0 };
    pickupByDay[createdDate].bookings++;
    pickupByDay[createdDate].revenue += r.totalAmount || 0;
    pickupByDay[createdDate].nights  += r.nights || 0;
  }

  const daily = daysInRange(since, today).map(date => ({
    date,
    bookings: pickupByDay[date]?.bookings || 0,
    revenue:  Math.round((pickupByDay[date]?.revenue || 0) * 100) / 100,
    nights:   pickupByDay[date]?.nights || 0,
  }));

  res.json({
    success: true,
    data: {
      targetFrom, targetTo, createdWithin,
      totalPickup: reservations.length,
      totalRevenue: Math.round(reservations.reduce((s, r) => s + (r.totalAmount || 0), 0) * 100) / 100,
      daily,
    },
  });
}));

// GET /api/reports/avg-los?propertyId=&from=&to=
router.get('/avg-los', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);

  const reservations = await Reservation.find({
    property: propertyId,
    status: { $nin: ['cancelled'] },
    arrivalDate: { $gte: from, $lte: to },
  }).lean();

  const total = reservations.length;
  if (!total) {
    return res.json({ success: true, data: { from, to, avgLos: 0, total: 0, bySegment: [], bySource: [] } });
  }

  const totalNights = reservations.reduce((s, r) => s + (r.nights || 0), 0);
  const avgLos = Math.round(totalNights / total * 10) / 10;

  // LOS by segment
  const segLos = {};
  for (const r of reservations) {
    const seg = r.marketSegment || r.source || 'transient';
    if (!segLos[seg]) segLos[seg] = { nights: 0, count: 0 };
    segLos[seg].nights += r.nights || 0;
    segLos[seg].count++;
  }

  const bySegment = Object.entries(segLos)
    .map(([segment, s]) => ({ segment, count: s.count, avgLos: Math.round(s.nights / s.count * 10) / 10 }))
    .sort((a, b) => b.avgLos - a.avgLos);

  // LOS by source
  const srcLos = {};
  for (const r of reservations) {
    const src = r.source || 'direct';
    if (!srcLos[src]) srcLos[src] = { nights: 0, count: 0 };
    srcLos[src].nights += r.nights || 0;
    srcLos[src].count++;
  }

  const bySource = Object.entries(srcLos)
    .map(([source, s]) => ({ source, count: s.count, avgLos: Math.round(s.nights / s.count * 10) / 10 }))
    .sort((a, b) => b.avgLos - a.avgLos);

  res.json({ success: true, data: { from, to, avgLos, total, totalNights, bySegment, bySource } });
}));

// GET /api/reports/arrivals?propertyId=&date=
router.get('/arrivals', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const arrivals = await Reservation.find({
    property: propertyId,
    arrivalDate: date,
    status: { $in: ['confirmed','modified','pending_payment','in_house','checked_in'] },
  })
    .populate('primaryGuest', 'firstName lastName phone email vipLevel nationality')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor cleanStatus')
    .populate('ratePlan', 'name code')
    .lean();

  const stats = {
    total:       arrivals.length,
    checkedIn:   arrivals.filter(r => ['in_house','checked_in'].includes(r.status)).length,
    pending:     arrivals.filter(r => ['confirmed','modified','pending_payment'].includes(r.status)).length,
    vip:         arrivals.filter(r => r.isVip || (r.primaryGuest?.vipLevel || 0) > 0).length,
    earlyArrival:arrivals.filter(r => r.specialRequests?.toLowerCase().includes('early')).length,
  };

  res.json({ success: true, data: { date, stats, list: arrivals } });
}));

// GET /api/reports/departures?propertyId=&date=
router.get('/departures', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const departures = await Reservation.find({
    property: propertyId,
    departureDate: date,
    status: { $in: ['in_house','checked_in','checked_out'] },
  })
    .populate('primaryGuest', 'firstName lastName phone email vipLevel')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .lean();

  // Attach open folio balances
  const resIds = departures.map(r => r._id);
  const openFolios = resIds.length
    ? await Folio.find({ reservation: { $in: resIds }, status: 'open' }).lean()
    : [];
  const balanceMap = {};
  for (const f of openFolios) {
    const balance = (f.lines || [])
      .filter(l => l.status === 'posted')
      .reduce((s, l) => s + (l.amount || 0) + (l.taxAmount || 0), 0);
    balanceMap[String(f.reservation)] = Math.round(balance * 100) / 100;
  }

  const list = departures.map(r => ({ ...r, openBalance: balanceMap[String(r._id)] || 0 }));

  const stats = {
    total:       list.length,
    checkedOut:  list.filter(r => r.status === 'checked_out').length,
    remaining:   list.filter(r => ['in_house','checked_in'].includes(r.status)).length,
    lateCheckout:list.filter(r => r.specialRequests?.toLowerCase().includes('late')).length,
    openBalances:list.filter(r => r.openBalance > 0).length,
  };

  res.json({ success: true, data: { date, stats, list } });
}));

// GET /api/reports/payments?propertyId=&from=&to=&method=
router.get('/payments', asyncHandler(async (req, res) => {
  const { propertyId, method } = req.query;
  assertPropertyScope(req, propertyId);
  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);
  const dayStart = new Date(from + 'T00:00:00Z');
  const dayEnd   = new Date(to   + 'T23:59:59Z');

  const folios = await Folio.find({ property: propertyId }).lean();

  const methodMap = {};
  let totalPayments = 0;
  let totalRefunds  = 0;
  let totalDeposits = 0;
  const transactions = [];

  for (const folio of folios) {
    for (const line of (folio.lines || [])) {
      if (!line.postedAt) continue;
      const at = new Date(line.postedAt);
      if (at < dayStart || at > dayEnd) continue;
      if (line.status !== 'posted') continue;
      if (!['payment','refund','deposit'].includes(line.type)) continue;
      if (method && line.paymentMethod !== method) continue;

      const amt = Math.abs(line.amount || 0);
      const pm  = line.paymentMethod || 'other';

      if (line.type === 'payment') {
        methodMap[pm] = (methodMap[pm] || 0) + amt;
        totalPayments += amt;
      } else if (line.type === 'refund') {
        totalRefunds += amt;
      } else if (line.type === 'deposit') {
        totalDeposits += amt;
      }

      transactions.push({
        folioId:       String(folio._id),
        type:          line.type,
        paymentMethod: pm,
        amount:        amt,
        description:   line.description,
        postedAt:      line.postedAt,
        reference:     line.reference,
      });
    }
  }

  const byMethod = Object.entries(methodMap)
    .map(([m, amount]) => ({ method: m, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);

  transactions.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  res.json({
    success: true,
    data: {
      from, to,
      totalPayments: Math.round(totalPayments * 100) / 100,
      totalRefunds:  Math.round(totalRefunds  * 100) / 100,
      totalDeposits: Math.round(totalDeposits * 100) / 100,
      net:           Math.round((totalPayments + totalDeposits - totalRefunds) * 100) / 100,
      byMethod,
      transactions,
    },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// פרק י"ז — דוחות חוקיים (מע"מ + מרשם תיירים)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/reports/vat-report?propertyId=&from=&to=
 * דוח מע"מ מפורט לפי סוג מסמך — מתאים לדיווח טופס 1216/125 לרשות המסים
 *
 * בסיס חוקי:
 *  • חוק מע"מ, תשל"ו-1975, סעיף 67 — חובת הגשת דוח תקופתי
 *  • תקנות מס ערך מוסף, תשל"ו-1976, תקנה 6 — פירוט עסקאות
 *
 * מחזיר:
 *  • סיכום לפי סוג חשבונית (חשבונית מס, קבלה, זיכוי וכו')
 *  • סה"כ עסקאות (לא כולל ביטולים ומסמכי פרופורמה)
 *  • רשימת חשבוניות לצורך ביקורת
 */
router.get('/vat-report', asyncHandler(async (req, res) => {
  requireRoles(req, ['super_admin', 'chain_admin', 'property_admin', 'general_manager',
    'finance_manager', 'owner_readonly', 'auditor'], 'VAT report requires finance access');
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);

  const to   = req.query.to   || new Date().toISOString().split('T')[0];
  const from = req.query.from || addDays(to, -29);

  const invoices = await Invoice.find({
    property: propertyId,
    status: 'issued',
    // לא כולל פרופורמה — אינה עסקה חייבת במע"מ
    type: { $in: ['tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_note', 'debit_note'] },
    issuedAt: {
      $gte: new Date(from + 'T00:00:00Z'),
      $lte: new Date(to   + 'T23:59:59Z'),
    },
  })
    .populate('issuedBy', 'firstName lastName')
    .lean();

  // אגרגציה לפי סוג מסמך
  const byType = {};
  for (const inv of invoices) {
    if (!byType[inv.type]) {
      byType[inv.type] = { count: 0, totalNet: 0, totalVat: 0, totalGross: 0 };
    }
    const s = byType[inv.type];
    s.count++;
    s.totalNet   += inv.totalNet   || 0;
    s.totalVat   += inv.totalVat   || 0;
    s.totalGross += inv.totalGross || 0;
  }

  // סיכום כולל (לא כולל הזיכויים — סכומם שלילי)
  const taxInvoiceTypes = ['tax_invoice', 'tax_invoice_receipt', 'debit_note'];
  const creditNoteTypes = ['credit_note'];

  const taxableInvoices = invoices.filter(i => taxInvoiceTypes.includes(i.type));
  const creditNotes     = invoices.filter(i => creditNoteTypes.includes(i.type));

  const totalSalesNet    = taxableInvoices.reduce((s, i) => s + (i.totalNet   || 0), 0);
  const totalSalesVat    = taxableInvoices.reduce((s, i) => s + (i.totalVat   || 0), 0);
  const totalSalesGross  = taxableInvoices.reduce((s, i) => s + (i.totalGross || 0), 0);
  const totalCreditsNet  = creditNotes.reduce((s, i) => s + Math.abs(i.totalNet   || 0), 0);
  const totalCreditsVat  = creditNotes.reduce((s, i) => s + Math.abs(i.totalVat   || 0), 0);

  const summary = {
    from, to,
    totalInvoices: invoices.length,
    // עסקאות (מכירות)
    totalSalesNet:    Math.round(totalSalesNet   * 100) / 100,
    totalSalesVat:    Math.round(totalSalesVat   * 100) / 100,
    totalSalesGross:  Math.round(totalSalesGross * 100) / 100,
    // זיכויים
    totalCreditsNet:  Math.round(totalCreditsNet * 100) / 100,
    totalCreditsVat:  Math.round(totalCreditsVat * 100) / 100,
    // נטו לתשלום
    netVatPayable:    Math.round((totalSalesVat - totalCreditsVat) * 100) / 100,
    netTaxableBase:   Math.round((totalSalesNet - totalCreditsNet) * 100) / 100,
    // לפי סוג
    byType: Object.entries(byType).map(([type, s]) => ({
      type,
      count:       s.count,
      totalNet:    Math.round(s.totalNet   * 100) / 100,
      totalVat:    Math.round(s.totalVat   * 100) / 100,
      totalGross:  Math.round(s.totalGross * 100) / 100,
    })),
  };

  // רשימת חשבוניות לצורך ביקורת
  const list = invoices.map(i => ({
    invoiceNumber:   i.invoiceNumber,
    type:            i.type,
    issuedAt:        i.issuedAt,
    buyer:           i.buyer?.name || i.buyer?.legalName,
    buyerVat:        i.buyer?.vatNumber,
    totalNet:        Math.round((i.totalNet   || 0) * 100) / 100,
    totalVat:        Math.round((i.totalVat   || 0) * 100) / 100,
    totalGross:      Math.round((i.totalGross || 0) * 100) / 100,
    allocationNumber: i.allocationNumber,
  }));

  res.json({ success: true, data: { summary, list } });
}));

/**
 * GET /api/reports/tourist-registry?propertyId=&date=
 * פנקס אורחים יומי — חובה לפי חוק בתי מלון, תשי"ד-1954
 *
 * בסיס חוקי:
 *  • חוק בתי מלון, תשי"ד-1954, סעיף 4
 *  • תקנות בתי מלון (רישום אורחים), תשט"ז-1956
 *  • מי שנרשם כבעל מלון חייב לנהל פנקס ולמסור פרטים לרשות
 *
 * מחזיר רשימת כרטיסי רישום אורחים לתאריך נתון
 * (כל הגיעות + אורחים ששוהים עדיין)
 */
router.get('/tourist-registry', asyncHandler(async (req, res) => {
  requireRoles(req, ['super_admin', 'chain_admin', 'property_admin', 'general_manager',
    'front_desk_manager', 'receptionist', 'finance_manager', 'owner_readonly', 'auditor'],
    'Tourist registry access denied');
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);
  const date = req.query.date || new Date().toISOString().split('T')[0];

  // אורחים שהגיעו ביום הנבחר OR שוהים עדיין (arrivalDate <= date < departureDate)
  const cards = await GuestRegistrationCard.find({
    property: propertyId,
    $or: [
      { arrivalDate: date },                            // הגיעו היום
      { arrivalDate: { $lte: date }, departureDate: { $gt: date } }, // שוהים עדיין
    ],
  })
    .populate('guest',       'firstName lastName email phone nationality vipLevel')
    .populate('reservation', 'confirmationNumber arrivalDate departureDate assignedRoom')
    .populate('signedBy',    'firstName lastName')
    .lean();

  // אם מערכת כרטיסי הרישום לא מאוכלסת עדיין, נחזיר מידע מהזמנות
  const resQuery = await Reservation.find({
    property: propertyId,
    arrivalDate:   { $lte: date },
    departureDate: { $gt: date },
    status: { $in: ['confirmed', 'in_house', 'checked_in'] },
  })
    .populate('primaryGuest', 'firstName lastName email phone nationality passportNumber passportExpiry dateOfBirth idType idNumber')
    .populate('assignedRoom', 'number floor')
    .lean();

  const registryFromReservations = resQuery.map(r => ({
    _source:           'reservation',
    reservationId:     String(r._id),
    confirmationNumber: r.confirmationNumber,
    firstName:         r.primaryGuest?.firstName,
    lastName:          r.primaryGuest?.lastName,
    nationality:       r.primaryGuest?.nationality,
    idDocType:         r.primaryGuest?.idType || 'id_card',
    idDocNumber:       r.primaryGuest?.passportNumber || r.primaryGuest?.idNumber,
    idDocExpiry:       r.primaryGuest?.passportExpiry,
    dateOfBirth:       r.primaryGuest?.dateOfBirth,
    arrivalDate:       r.arrivalDate,
    departureDate:     r.departureDate,
    assignedRoom:      r.assignedRoom?.number,
    floor:             r.assignedRoom?.floor,
    hasFormalCard:     false,
  }));

  res.json({
    success: true,
    data: {
      date,
      propertyId,
      formalCards: cards.map(c => ({
        _source:           'registration_card',
        cardId:            String(c._id),
        reservationId:     String(c.reservation?._id),
        confirmationNumber: c.reservation?.confirmationNumber,
        firstName:         c.firstName,
        lastName:          c.lastName,
        nationality:       c.nationality,
        idDocType:         c.idDocType,
        idDocNumber:       c.idDocNumber,
        idDocExpiry:       c.idDocExpiry,
        dateOfBirth:       c.dateOfBirth,
        arrivalDate:       c.arrivalDate,
        departureDate:     c.departureDate,
        signedAt:          c.signedAt,
        status:            c.status,
        assignedRoom:      c.assignedRoom,
        hasFormalCard:     true,
      })),
      // אורחים ללא כרטיס רישום רשמי (לצורך בקרה)
      fromReservations:  registryFromReservations,
      totalInHouse:      resQuery.length,
      unsignedCards:     cards.filter(c => c.status === 'pending').length,
    },
  });
}));

export default router;
