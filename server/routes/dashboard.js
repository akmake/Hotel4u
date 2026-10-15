import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Folio from '../models/Folio.js';
import Payment from '../models/Payment.js';
import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';
import Property from '../models/Property.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

// The property's calendar day (Israel is UTC+2/3 — the server's UTC day is wrong after midnight).
async function propertyToday(propertyId) {
  const p = await Property.findById(propertyId).select('timezone').lean();
  return todayYmdInTimezone(p?.timezone || 'Asia/Jerusalem');
}

const router = Router();

const DASHBOARD_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'receptionist',
  'housekeeping_manager',
  'housekeeper',
  'maintenance_manager',
  'technician',
  'finance_manager',
  'cashier',
  'revenue_manager',
  'auditor',
  'owner_readonly',
];

function requirePropertyScope(req, explicitPropertyId) {
  const propertyId = explicitPropertyId || req.query.propertyId || req.body.propertyId || req.actor?.propertyId;
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}

// GET /api/dashboard/stats
router.get('/stats', asyncHandler(async (req, res) => {
  requireRoles(req, DASHBOARD_ROLES);

  const propertyId = requirePropertyScope(req);
  const today = await propertyToday(propertyId);

  const [rooms, reservations, hkTasks, maintenanceTickets, failedPayments, unsyncedCount] = await Promise.all([
    Room.find({ property: propertyId, active: true }),
    Reservation.find({ property: propertyId, status: { $nin: ['cancelled', 'no_show'] } })
      .populate('primaryGuest', 'firstName lastName vipLevel')
      .populate('roomType', 'name code')
      .populate('assignedRoom', 'number floor cleanStatus')
      .lean(),
    HousekeepingTask.find({ property: propertyId, date: today }),
    MaintenanceTicket.find({ property: propertyId, status: { $nin: ['resolved', 'closed', 'verified'] } }),
    Payment.countDocuments({ property: propertyId, status: 'failed', createdAt: { $gte: new Date(Date.now() - 86_400_000) } }),
    ChannelUpdateQueue.countDocuments({ property: propertyId, status: { $in: ['pending', 'failed', 'retrying'] } }),
  ]);

  const arrivals = reservations.filter((r) => r.arrivalDate === today && ['confirmed', 'modified', 'pending_payment'].includes(r.status));
  const departures = reservations.filter((r) => r.departureDate === today && ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'].includes(r.status));
  const inHouse = reservations.filter((r) => ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'].includes(r.status));
  const unassigned = arrivals.filter((r) => !r.assignedRoom);

  const earlyCheckInRequests = arrivals.filter((r) =>
    r.specialRequests && /early.?check.?in|early arrival/i.test(r.specialRequests)
  );
  const lateCheckoutRequests = departures.filter((r) =>
    r.specialRequests && /late.?check.?out|late departure/i.test(r.specialRequests)
  );

  // Vacant = no stay is in the room now (from the stays themselves, not the stored occStatus flag).
  const occupiedRoomIds = new Set(inHouse.map((r) => String(r.assignedRoom?._id || r.assignedRoom || '')).filter(Boolean));
  const cleanRooms = rooms.filter((r) =>
    ['clean', 'inspected'].includes(r.cleanStatus) &&
    r.opsStatus === 'available' &&
    !occupiedRoomIds.has(String(r._id))
  );
  const dirtyRooms = rooms.filter((r) => r.cleanStatus === 'dirty');
  const oooRooms = rooms.filter((r) => r.opsStatus === 'out_of_order');
  const holdRooms = rooms.filter((r) => r.opsStatus === 'maintenance_hold');

  const openFolios = await Folio.find({ property: propertyId, status: 'open' }).lean();
  const foliosWithBalance = openFolios.filter((folio) => {
    const balance = (folio.lines || [])
      .filter((line) => line.status === 'posted')
      .reduce((sum, line) => sum + (line.amount || 0) + (line.taxAmount || 0), 0);
    return balance > 0.01;
  });

  res.json({
    success: true,
    data: {
      arrivals: arrivals.length,
      departures: departures.length,
      inHouse: inHouse.length,
      vipArrivals: arrivals.filter((r) => r.isVip).length,
      unassigned: unassigned.length,
      earlyCheckInRequests: earlyCheckInRequests.length,
      lateCheckoutRequests: lateCheckoutRequests.length,
      cleanRooms: cleanRooms.length,
      dirtyRooms: dirtyRooms.length,
      oooRooms: oooRooms.length,
      holdRooms: holdRooms.length,
      openBalances: foliosWithBalance.length,
      failedPayments,
      unsyncedReservations: unsyncedCount,
      totalRooms: rooms.length,
      occupancy: rooms.length ? Math.round((inHouse.length / rooms.length) * 100) : 0,
      hkPending: hkTasks.filter((t) => t.status === 'new').length,
      hkInProgress: hkTasks.filter((t) => t.status === 'in_progress').length,
      hkCompleted: hkTasks.filter((t) => t.status === 'completed').length,
      hkUrgent: hkTasks.filter((t) => t.priority === 'urgent').length,
      maintenanceOpen: maintenanceTickets.length,
      maintenanceCritical: maintenanceTickets.filter((t) => t.priority === 'critical').length,
    },
  });
}));

// GET /api/dashboard/arrivals
router.get('/arrivals', asyncHandler(async (req, res) => {
  requireRoles(req, DASHBOARD_ROLES);

  const propertyId = requirePropertyScope(req);
  const today = await propertyToday(propertyId);

  const arrivals = await Reservation.find({
    property: propertyId,
    arrivalDate: today,
    status: { $in: ['confirmed', 'modified', 'pending_payment'] },
  })
    .populate('primaryGuest', 'firstName lastName vipLevel country')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .lean();

  res.json({ success: true, data: arrivals });
}));

// GET /api/dashboard/departures
router.get('/departures', asyncHandler(async (req, res) => {
  requireRoles(req, DASHBOARD_ROLES);

  const propertyId = requirePropertyScope(req);
  const today = await propertyToday(propertyId);

  const departures = await Reservation.find({
    property: propertyId,
    departureDate: today,
    status: { $in: ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'] },
  })
    .populate('primaryGuest', 'firstName lastName vipLevel')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .lean();

  res.json({ success: true, data: departures });
}));

// GET /api/dashboard/inhouse
router.get('/inhouse', asyncHandler(async (req, res) => {
  requireRoles(req, DASHBOARD_ROLES);

  const propertyId = requirePropertyScope(req);

  const inhouse = await Reservation.find({
    property: propertyId,
    status: { $in: ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'] },
  })
    .populate('primaryGuest', 'firstName lastName vipLevel')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .lean();

  res.json({ success: true, data: inhouse });
}));

// GET /api/dashboard/alerts
router.get('/alerts', asyncHandler(async (req, res) => {
  requireRoles(req, DASHBOARD_ROLES);

  const propertyId = requirePropertyScope(req);
  const today = await propertyToday(propertyId);
  const alerts = [];

  const [todayArrivals, todayDepartures, criticalMaintenance, failedPayments, unsyncedItems] = await Promise.all([
    Reservation.find({ property: propertyId, arrivalDate: today, status: { $in: ['confirmed', 'modified', 'pending_payment'] } })
      .populate('assignedRoom', 'number cleanStatus opsStatus')
      .populate('primaryGuest', 'firstName lastName')
      .lean(),
    Reservation.find({ property: propertyId, departureDate: today, status: { $in: ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'] } })
      .populate('primaryGuest', 'firstName lastName')
      .lean(),
    MaintenanceTicket.find({ property: propertyId, priority: 'critical', status: { $in: ['new', 'assigned', 'in_progress'] }, blocksRoom: true })
      .populate('room', 'number')
      .lean(),
    Payment.find({ property: propertyId, status: 'failed', createdAt: { $gte: new Date(Date.now() - 86_400_000) } })
      .populate('reservation', 'confirmationNumber')
      .lean(),
    ChannelUpdateQueue.find({ property: propertyId, status: { $in: ['pending', 'failed'] } })
      .limit(10)
      .lean(),
  ]);

  for (const reservation of todayArrivals.filter((r) => r.isVip)) {
    if (reservation.assignedRoom && !['clean', 'inspected'].includes(reservation.assignedRoom.cleanStatus)) {
      alerts.push({
        id: `vip-${reservation._id}`,
        type: 'danger',
        category: 'housekeeping',
        text: `VIP ${reservation.primaryGuest.firstName} ${reservation.primaryGuest.lastName} — חדר ${reservation.assignedRoom.number} לא נקי`,
        action: 'שליחת חדרנית',
        reservationId: reservation._id,
      });
    }
  }

  for (const reservation of todayArrivals.filter((r) => !r.isVip)) {
    if (reservation.assignedRoom && !['clean', 'inspected'].includes(reservation.assignedRoom.cleanStatus)) {
      alerts.push({
        id: `dirty-${reservation._id}`,
        type: 'warning',
        category: 'housekeeping',
        text: `${reservation.confirmationNumber} — חדר ${reservation.assignedRoom.number} לא מוכן עבור ${reservation.primaryGuest.firstName} ${reservation.primaryGuest.lastName}`,
        action: 'שליחת חדרנית',
        reservationId: reservation._id,
      });
    }
  }

  for (const reservation of todayArrivals.filter((r) => !r.assignedRoom)) {
    alerts.push({
      id: `noroom-${reservation._id}`,
      type: 'danger',
      category: 'rooms',
      text: `${reservation.confirmationNumber} — לא שובץ חדר עבור ${reservation.primaryGuest.firstName} ${reservation.primaryGuest.lastName}`,
      action: 'שיבוץ חדר',
      reservationId: reservation._id,
    });
  }

  for (const reservation of todayArrivals.filter((r) => r.status === 'pending_payment')) {
    alerts.push({
      id: `pendpay-${reservation._id}`,
      type: 'warning',
      category: 'payments',
      text: `${reservation.confirmationNumber} — תשלום ממתין להגעה היום`,
      action: 'גביית תשלום',
      reservationId: reservation._id,
    });
  }

  const departureIds = todayDepartures.map((r) => r._id);
  const departureFolios = departureIds.length
    ? await Folio.find({ reservation: { $in: departureIds }, status: 'open' }).lean()
    : [];

  const balanceByReservation = new Map();
  for (const folio of departureFolios) {
    const balance = (folio.lines || [])
      .filter((line) => line.status === 'posted')
      .reduce((sum, line) => sum + (line.amount || 0) + (line.taxAmount || 0), 0);

    balanceByReservation.set(String(folio.reservation), balance);
  }

  for (const reservation of todayDepartures) {
    const balance = balanceByReservation.get(String(reservation._id)) || 0;
    if (balance > 0.01) {
      alerts.push({
        id: `balance-${reservation._id}`,
        type: 'warning',
        category: 'payments',
        text: `${reservation.confirmationNumber} — יתרה פתוחה ₪${balance.toFixed(2)}`,
        action: 'פתיחת חשבון',
        reservationId: reservation._id,
      });
    }
  }

  const arrivalRoomIds = todayArrivals
    .filter((reservation) => reservation.assignedRoom)
    .map((reservation) => String(reservation.assignedRoom._id));

  for (const ticket of criticalMaintenance) {
    if (ticket.room && arrivalRoomIds.includes(String(ticket.room._id))) {
      alerts.push({
        id: `maint-${ticket._id}`,
        type: 'danger',
        category: 'maintenance',
        text: `תקלה קריטית בחדר ${ticket.room.number}: ${ticket.description}`,
        action: 'פתיחת קריאה',
        ticketId: ticket._id,
      });
    }
  }

  for (const payment of failedPayments) {
    alerts.push({
      id: `failpay-${payment._id}`,
      type: 'danger',
      category: 'payments',
      text: `תשלום נכשל — ${payment.reservation?.confirmationNumber || ''} — ₪${payment.amount}`,
      action: 'ניסיון חוזר',
      reservationId: payment.reservation?._id,
    });
  }

  if (unsyncedItems.length > 0) {
    alerts.push({
      id: 'channel-sync',
      type: 'warning',
      category: 'channels',
      text: `${unsyncedItems.length} עדכוני ערוצים ממתינים לסנכרון`,
      action: 'בדיקת עדכוני ערוצים',
    });
  }

  alerts.sort((left, right) => {
    if (left.type === right.type) return 0;
    return left.type === 'danger' ? -1 : 1;
  });

  res.json({ success: true, data: alerts });
}));

export default router;
