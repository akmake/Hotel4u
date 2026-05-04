import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Folio from '../models/Folio.js';
import Payment from '../models/Payment.js';
import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';

const router = Router();

// ── /stats ────────────────────────────────────────────────────────────────────
router.get('/stats', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const today = new Date().toISOString().split('T')[0];

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

  const arrivals   = reservations.filter(r => r.arrivalDate === today && ['confirmed', 'modified', 'pending_payment'].includes(r.status));
  const departures = reservations.filter(r => r.departureDate === today && ['in_house', 'checked_in'].includes(r.status));
  const inHouse    = reservations.filter(r => ['in_house', 'checked_in'].includes(r.status));
  const unassigned = arrivals.filter(r => !r.assignedRoom);

  const earlyCheckInRequests = arrivals.filter(r =>
    r.specialRequests && /early.?check.?in|early arrival/i.test(r.specialRequests)
  );
  const lateCheckoutRequests = departures.filter(r =>
    r.specialRequests && /late.?check.?out|late departure/i.test(r.specialRequests)
  );

  const cleanRooms = rooms.filter(r =>
    ['clean', 'inspected'].includes(r.cleanStatus) &&
    r.opsStatus === 'available' &&
    r.occStatus === 'vacant'
  );
  const dirtyRooms = rooms.filter(r => r.cleanStatus === 'dirty');
  const oooRooms   = rooms.filter(r => r.opsStatus === 'out_of_order');
  const holdRooms  = rooms.filter(r => r.opsStatus === 'maintenance_hold');

  const openFolios = await Folio.find({ property: propertyId, status: 'open' }).lean();
  const foliosWithBalance = openFolios.filter(f => {
    const bal = f.lines
      .filter(l => l.status === 'posted')
      .reduce((s, l) => s + l.amount + l.taxAmount, 0);
    return bal > 0;
  });

  res.json({
    success: true,
    data: {
      arrivals:             arrivals.length,
      departures:           departures.length,
      inHouse:              inHouse.length,
      vipArrivals:          arrivals.filter(r => r.isVip).length,
      unassigned:           unassigned.length,
      earlyCheckInRequests: earlyCheckInRequests.length,
      lateCheckoutRequests: lateCheckoutRequests.length,
      cleanRooms:           cleanRooms.length,
      dirtyRooms:           dirtyRooms.length,
      oooRooms:             oooRooms.length,
      holdRooms:            holdRooms.length,
      openBalances:         foliosWithBalance.length,
      failedPayments,
      unsyncedReservations: unsyncedCount,
      totalRooms:           rooms.length,
      occupancy:            rooms.length ? Math.round((inHouse.length + arrivals.length) / rooms.length * 100) : 0,
      hkPending:            hkTasks.filter(t => t.status === 'new').length,
      hkInProgress:         hkTasks.filter(t => t.status === 'in_progress').length,
      hkCompleted:          hkTasks.filter(t => t.status === 'completed').length,
      hkUrgent:             hkTasks.filter(t => t.priority === 'urgent').length,
      maintenanceOpen:      maintenanceTickets.length,
      maintenanceCritical:  maintenanceTickets.filter(t => t.priority === 'critical').length,
    },
  });
}));

// ── /arrivals ─────────────────────────────────────────────────────────────────
router.get('/arrivals', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const today = new Date().toISOString().split('T')[0];
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

// ── /departures ───────────────────────────────────────────────────────────────
router.get('/departures', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const departures = await Reservation.find({
    property: propertyId,
    departureDate: today,
    status: { $in: ['in_house', 'checked_in'] },
  })
    .populate('primaryGuest', 'firstName lastName vipLevel')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .lean();
  res.json({ success: true, data: departures });
}));

// ── /inhouse ──────────────────────────────────────────────────────────────────
router.get('/inhouse', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const inhouse = await Reservation.find({
    property: propertyId,
    status: { $in: ['in_house', 'checked_in'] },
  })
    .populate('primaryGuest', 'firstName lastName vipLevel')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .lean();
  res.json({ success: true, data: inhouse });
}));

// ── /alerts ───────────────────────────────────────────────────────────────────
router.get('/alerts', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const alerts = [];

  const [todayArrivals, todayDepartures, criticalMaintenance, failedPayments, unsyncedItems] = await Promise.all([
    Reservation.find({ property: propertyId, arrivalDate: today, status: { $in: ['confirmed', 'modified', 'pending_payment'] } })
      .populate('assignedRoom', 'number cleanStatus opsStatus')
      .populate('primaryGuest', 'firstName lastName')
      .lean(),
    Reservation.find({ property: propertyId, departureDate: today, status: { $in: ['in_house', 'checked_in'] } })
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

  // 1. VIP arrivals with room not clean
  for (const r of todayArrivals.filter(r => r.isVip)) {
    if (r.assignedRoom && !['clean', 'inspected'].includes(r.assignedRoom.cleanStatus)) {
      alerts.push({
        id: `vip-${r._id}`,
        type: 'danger',
        category: 'housekeeping',
        text: `VIP ${r.primaryGuest.firstName} ${r.primaryGuest.lastName} — חדר ${r.assignedRoom.number} לא נקי`,
        action: 'שלח לחדרנות',
        reservationId: r._id,
      });
    }
  }

  // 2. All arrivals with dirty/unclean assigned room
  for (const r of todayArrivals.filter(r => !r.isVip)) {
    if (r.assignedRoom && !['clean', 'inspected'].includes(r.assignedRoom.cleanStatus)) {
      alerts.push({
        id: `dirty-${r._id}`,
        type: 'warning',
        category: 'housekeeping',
        text: `${r.confirmationNumber} — חדר ${r.assignedRoom.number} מלוכלך לפני הגעת ${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
        action: 'שלח לחדרנות',
        reservationId: r._id,
      });
    }
  }

  // 3. Arrivals with no room assigned
  for (const r of todayArrivals.filter(r => !r.assignedRoom)) {
    alerts.push({
      id: `noroom-${r._id}`,
      type: 'danger',
      category: 'rooms',
      text: `${r.confirmationNumber} — אין חדר מוקצה ל-${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
      action: 'הקצה חדר',
      reservationId: r._id,
    });
  }

  // 4. Arrivals with pending payment
  for (const r of todayArrivals.filter(r => r.status === 'pending_payment')) {
    alerts.push({
      id: `pendpay-${r._id}`,
      type: 'warning',
      category: 'payments',
      text: `${r.confirmationNumber} — ${r.primaryGuest.firstName} ${r.primaryGuest.lastName} מגיע היום ותשלום עדיין לא התקבל`,
      action: 'גבה תשלום',
      reservationId: r._id,
    });
  }

  // 5. Departures with open balance
  for (const r of todayDepartures) {
    const folio = await Folio.findOne({ reservation: r._id, status: 'open' }).lean();
    if (folio) {
      const bal = folio.lines
        .filter(l => l.status === 'posted')
        .reduce((s, l) => s + l.amount + l.taxAmount, 0);
      if (bal > 0) {
        alerts.push({
          id: `balance-${r._id}`,
          type: 'warning',
          category: 'payments',
          text: `${r.confirmationNumber} — יתרה פתוחה ₪${bal.toFixed(0)} לפני יציאת ${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
          action: 'פתח Folio',
          reservationId: r._id,
        });
      }
    }
  }

  // 6. Critical maintenance blocking rooms assigned to today's arrivals
  const arrivalRoomIds = todayArrivals
    .filter(r => r.assignedRoom)
    .map(r => String(r.assignedRoom._id));
  for (const ticket of criticalMaintenance) {
    if (ticket.room && arrivalRoomIds.includes(String(ticket.room._id))) {
      alerts.push({
        id: `maint-${ticket._id}`,
        type: 'danger',
        category: 'maintenance',
        text: `חדר ${ticket.room.number} — תקלה קריטית פתוחה: ${ticket.description}`,
        action: 'פתח תקלה',
        ticketId: ticket._id,
      });
    }
  }

  // 7. Failed payments in last 24h
  for (const p of failedPayments) {
    alerts.push({
      id: `failpay-${p._id}`,
      type: 'danger',
      category: 'payments',
      text: `תשלום נכשל — ${p.reservation?.confirmationNumber || ''} — ₪${p.amount}`,
      action: 'נסה שוב',
      reservationId: p.reservation?._id,
    });
  }

  // 8. Unsynced channel updates
  if (unsyncedItems.length > 0) {
    alerts.push({
      id: 'channel-sync',
      type: 'warning',
      category: 'channels',
      text: `${unsyncedItems.length} עדכוני ערוץ ממתינים לסנכרון`,
      action: 'בדוק ערוצים',
    });
  }

  // Sort: danger first, then warning
  alerts.sort((a, b) => (a.type === 'danger' ? -1 : 1));

  res.json({ success: true, data: alerts });
}));

export default router;
