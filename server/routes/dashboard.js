import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Folio from '../models/Folio.js';

const router = Router();

router.get('/stats', asyncHandler(async (req, res) => {
  const propertyId = req.query.propertyId;
  const today = new Date().toISOString().split('T')[0];

  const [rooms, reservations, hkTasks, maintenanceTickets] = await Promise.all([
    Room.find({ property: propertyId, active: true }),
    Reservation.find({ property: propertyId, status: { $nin: ['cancelled','no_show'] } })
      .populate('primaryGuest', 'firstName lastName vipLevel')
      .populate('roomType', 'name code')
      .populate('assignedRoom', 'number floor')
      .lean(),
    HousekeepingTask.find({ property: propertyId, date: today }),
    MaintenanceTicket.find({ property: propertyId, status: { $nin: ['resolved','closed'] } }),
  ]);

  const arrivals   = reservations.filter(r => r.arrivalDate === today && ['confirmed','modified'].includes(r.status));
  const departures = reservations.filter(r => r.departureDate === today && ['in_house','checked_in'].includes(r.status));
  const inHouse    = reservations.filter(r => ['in_house','checked_in'].includes(r.status));
  const vipArrivals = arrivals.filter(r => r.isVip);
  const unassigned  = arrivals.filter(r => !r.assignedRoom);

  const cleanRooms = rooms.filter(r => ['clean','inspected'].includes(r.cleanStatus) && r.opsStatus === 'available' && r.occStatus === 'vacant');
  const dirtyRooms = rooms.filter(r => r.cleanStatus === 'dirty');
  const oooRooms   = rooms.filter(r => r.opsStatus === 'out_of_order');
  const holdRooms  = rooms.filter(r => r.opsStatus === 'maintenance_hold');

  // Folios with balance due
  const openFolios = await Folio.find({ property: propertyId, status: 'open' }).lean();
  const foliosWithBalance = openFolios.filter(f => {
    const bal = f.lines.filter(l => l.status === 'posted').reduce((s, l) => s + l.amount + l.taxAmount, 0);
    return bal > 0;
  });

  res.json({
    success: true,
    data: {
      arrivals:       arrivals.length,
      departures:     departures.length,
      inHouse:        inHouse.length,
      vipArrivals:    vipArrivals.length,
      unassigned:     unassigned.length,
      cleanRooms:     cleanRooms.length,
      dirtyRooms:     dirtyRooms.length,
      oooRooms:       oooRooms.length,
      holdRooms:      holdRooms.length,
      openBalances:   foliosWithBalance.length,
      totalRooms:     rooms.length,
      occupancy:      rooms.length ? Math.round((inHouse.length + arrivals.length) / rooms.length * 100) : 0,
      hkPending:      hkTasks.filter(t => t.status === 'new').length,
      hkInProgress:   hkTasks.filter(t => t.status === 'in_progress').length,
      hkCompleted:    hkTasks.filter(t => t.status === 'completed').length,
      hkUrgent:       hkTasks.filter(t => t.priority === 'urgent').length,
      maintenanceOpen:maintenanceTickets.length,
    },
  });
}));

router.get('/arrivals', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const arrivals = await Reservation.find({
    property: propertyId,
    arrivalDate: today,
    status: { $in: ['confirmed','modified'] },
  })
    .populate('primaryGuest', 'firstName lastName vipLevel country')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .lean();
  res.json({ success: true, data: arrivals });
}));

router.get('/departures', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const departures = await Reservation.find({
    property: propertyId,
    departureDate: today,
    status: { $in: ['in_house','checked_in'] },
  })
    .populate('primaryGuest', 'firstName lastName vipLevel')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .lean();
  res.json({ success: true, data: departures });
}));

router.get('/inhouse', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const inhouse = await Reservation.find({
    property: propertyId,
    status: { $in: ['in_house','checked_in'] },
  })
    .populate('primaryGuest', 'firstName lastName vipLevel')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor')
    .lean();
  res.json({ success: true, data: inhouse });
}));

router.get('/alerts', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const alerts = [];

  // 1. VIP arrivals with room not clean
  const vipArrivals = await Reservation.find({ property: propertyId, arrivalDate: today, isVip: true, status: 'confirmed' })
    .populate('assignedRoom', 'number cleanStatus').populate('primaryGuest','firstName lastName').lean();
  for (const r of vipArrivals) {
    if (r.assignedRoom && !['clean','inspected'].includes(r.assignedRoom.cleanStatus)) {
      alerts.push({ id: `vip-${r._id}`, type: 'danger', text: `VIP ${r.primaryGuest.firstName} ${r.primaryGuest.lastName} — חדר ${r.assignedRoom.number} לא נקי!`, action: 'שלח לחדרנות' });
    }
  }

  // 2. Arrivals with no room assigned
  const noRoom = await Reservation.find({ property: propertyId, arrivalDate: today, status: 'confirmed', assignedRoom: null })
    .populate('primaryGuest','firstName lastName').lean();
  for (const r of noRoom) {
    alerts.push({ id: `noroom-${r._id}`, type: 'danger', text: `${r.confirmationNumber} — אין חדר מוקצה ל-${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`, action: 'הקצה חדר' });
  }

  // 3. Departures with open balance
  const departures = await Reservation.find({ property: propertyId, departureDate: today, status: { $in:['in_house','checked_in'] } }).lean();
  for (const r of departures) {
    const folio = await Folio.findOne({ reservation: r._id, status:'open' }).lean();
    if (folio) {
      const bal = folio.lines.filter(l => l.status==='posted').reduce((s,l)=>s+l.amount+l.taxAmount,0);
      if (bal > 0) alerts.push({ id: `balance-${r._id}`, type:'warning', text:`${r.confirmationNumber} — יתרה פתוחה ₪${bal.toFixed(0)} לפני צ'ק-אאוט`, action:"פתח Folio" });
    }
  }

  // 4. Urgent HK tasks
  const urgentHk = await HousekeepingTask.find({ property: propertyId, priority:'urgent', status:'new', date: today }).populate('room','number').lean();
  for (const t of urgentHk) {
    alerts.push({ id:`hk-${t._id}`, type:'warning', text:`חדר ${t.room?.number} — משימת חדרנות דחופה: ${t.notes||'ניקיון'}`, action:'שלח לחדרנות' });
  }

  res.json({ success: true, data: alerts });
}));

export default router;
