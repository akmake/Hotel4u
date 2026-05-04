/**
 * פרק כ — Automation & Command Center Route
 * Spec sections 40.1 (Alerts) + 40.2 (Recommendations) + 40.3 (Automation Rules)
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope } from '../middleware/authContext.js';
import { audit, auditCtxFromReq } from '../services/auditService.js';
import AutomationRule, { TRIGGER_TYPES, ACTION_TYPES } from '../models/AutomationRule.js';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Folio from '../models/Folio.js';
import InventoryDate from '../models/InventoryDate.js';
import RoomType from '../models/RoomType.js';

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// פרק כ סעיף 40.1 — Computed Alerts (Command Center)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/automation/alerts?propertyId=
router.get('/alerts', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);

  const now        = new Date();
  const today      = now.toISOString().split('T')[0];
  const twoHrsLater = new Date(now.getTime() + 2 * 3600_000).toISOString().split('T')[0];

  const alerts = [];

  const [arrivals, inHouse, rooms, hkTasks, maintenanceTickets, openFolios] = await Promise.all([
    Reservation.find({
      property: propertyId,
      arrivalDate: today,
      status: { $in: ['confirmed', 'modified'] },
    }).populate('assignedRoom', 'number cleanStatus opsStatus')
      .populate('primaryGuest', 'firstName lastName vipLevel')
      .lean(),

    Reservation.find({
      property: propertyId,
      status: { $in: ['in_house', 'checked_in'] },
    }).populate('primaryGuest', 'firstName lastName')
      .lean(),

    Room.find({ property: propertyId, active: true }).lean(),

    HousekeepingTask.find({
      property: propertyId,
      status: { $nin: ['completed', 'inspected', 'cancelled'] },
      date: today,
    }).populate('room', 'number').lean(),

    MaintenanceTicket.find({
      property: propertyId,
      status: { $nin: ['resolved', 'closed', 'verified'] },
    }).populate('room', 'number').lean(),

    Folio.find({ property: propertyId, status: 'open' }).lean(),
  ]);

  // ── 40.1 a) Arrival without assigned room ─────────────────────────────────
  const unassigned = arrivals.filter(r => !r.assignedRoom);
  if (unassigned.length) {
    alerts.push({
      level: 'error',
      type: 'arrival_no_room',
      title: `${unassigned.length} אורח${unassigned.length > 1 ? 'ים' : ''} מגיעים ואין חדר מוקצה`,
      count: unassigned.length,
      items: unassigned.map(r => ({ id: String(r._id), confirmationNumber: r.confirmationNumber, guest: `${r.primaryGuest?.firstName} ${r.primaryGuest?.lastName}` })),
    });
  }

  // ── 40.1 b) Arrival room not clean ────────────────────────────────────────
  const dirtyArrivals = arrivals.filter(r => r.assignedRoom && !['clean', 'inspected'].includes(r.assignedRoom.cleanStatus));
  if (dirtyArrivals.length) {
    alerts.push({
      level: 'warning',
      type: 'arrival_dirty_room',
      title: `${dirtyArrivals.length} חדר${dirtyArrivals.length > 1 ? 'ים' : ''} של arrivals היום לא נקיים`,
      count: dirtyArrivals.length,
      items: dirtyArrivals.map(r => ({ id: String(r._id), room: r.assignedRoom?.number, cleanStatus: r.assignedRoom?.cleanStatus })),
    });
  }

  // ── 40.1 c) VIP arrival ──────────────────────────────────────────────────
  const vipArrivals = arrivals.filter(r => r.isVip || r.primaryGuest?.vipLevel > 0);
  if (vipArrivals.length) {
    alerts.push({
      level: 'info',
      type: 'vip_arrival',
      title: `${vipArrivals.length} הגעת VIP היום`,
      count: vipArrivals.length,
      items: vipArrivals.map(r => ({ id: String(r._id), guest: `${r.primaryGuest?.firstName} ${r.primaryGuest?.lastName}`, vipLevel: r.primaryGuest?.vipLevel })),
    });
  }

  // ── 40.1 d) Departures with open balance ─────────────────────────────────
  const departures = inHouse.filter(r => {
    const dep = r.departureDate || '';
    return dep === today;
  });
  const depIds     = departures.map(r => r._id);
  const depFolios  = depIds.length ? openFolios.filter(f => depIds.some(id => String(id) === String(f.reservation))) : [];
  const withBalance = depFolios.filter(f => {
    const bal = (f.lines || []).filter(l => l.status === 'posted').reduce((s, l) => s + (l.amount || 0), 0);
    return bal > 0.01;
  });
  if (withBalance.length) {
    alerts.push({
      level: 'error',
      type: 'checkout_open_balance',
      title: `${withBalance.length} checkout${withBalance.length > 1 ? 'ים' : ''} עם יתרה פתוחה`,
      count: withBalance.length,
      items: withBalance.map(f => ({ folioId: String(f._id), reservation: String(f.reservation) })),
    });
  }

  // ── 40.1 e) OOO room with future reservation ─────────────────────────────
  const oooRooms = rooms.filter(r => r.opsStatus === 'out_of_order');
  const oooIds   = oooRooms.map(r => r._id);
  if (oooIds.length) {
    const futureRes = await Reservation.find({
      property: propertyId,
      assignedRoom: { $in: oooIds },
      arrivalDate: { $gte: today },
      status: { $in: ['confirmed', 'modified'] },
    }).populate('assignedRoom', 'number').lean();
    if (futureRes.length) {
      alerts.push({
        level: 'error',
        type: 'ooo_room_with_future_reservation',
        title: `${futureRes.length} הזמנה${futureRes.length > 1 ? 'ות' : ''} על חדר${futureRes.length > 1 ? 'ים' : ''} out of order`,
        count: futureRes.length,
        items: futureRes.map(r => ({ id: String(r._id), confirmationNumber: r.confirmationNumber, room: r.assignedRoom?.number, arrivalDate: r.arrivalDate })),
      });
    }
  }

  // ── 40.1 f) Delayed housekeeping tasks ────────────────────────────────────
  const overdueHk = hkTasks.filter(t => {
    if (!t.dueAt) return false;
    return new Date(t.dueAt) < now && t.status !== 'in_progress';
  });
  if (overdueHk.length) {
    alerts.push({
      level: 'warning',
      type: 'housekeeping_delayed',
      title: `${overdueHk.length} משימת ניקיון באיחור`,
      count: overdueHk.length,
      items: overdueHk.map(t => ({ id: String(t._id), room: t.room?.number, dueAt: t.dueAt })),
    });
  }

  // ── 40.1 g) Critical maintenance SLA breach ───────────────────────────────
  const criticalTickets = maintenanceTickets.filter(t => {
    if (t.priority !== 'critical') return false;
    const age = (now - new Date(t.createdAt)) / 3600_000; // hours
    return age > 4;
  });
  if (criticalTickets.length) {
    alerts.push({
      level: 'error',
      type: 'maintenance_sla_breach',
      title: `${criticalTickets.length} תקלה קריטית חרגה מה-SLA`,
      count: criticalTickets.length,
      items: criticalTickets.map(t => ({ id: String(t._id), room: t.room?.number, description: t.description })),
    });
  }

  // ── 40.1 h) Unsynced / pending payment reservations ───────────────────────
  const pendingPayment = await Reservation.countDocuments({
    property: propertyId,
    paymentStatus: 'pending',
    arrivalDate: { $gte: today },
    status: { $in: ['confirmed', 'modified'] },
  });
  if (pendingPayment) {
    alerts.push({
      level: 'warning',
      type: 'pending_payment',
      title: `${pendingPayment} הזמנה${pendingPayment > 1 ? 'ות' : ''} ממתינות לתשלום`,
      count: pendingPayment,
    });
  }

  res.json({ success: true, data: { count: alerts.length, alerts } });
}));

// ══════════════════════════════════════════════════════════════════════════════
// פרק כ סעיף 40.2 — Recommendations
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/automation/recommendations?propertyId=
router.get('/recommendations', asyncHandler(async (req, res) => {
  const { propertyId } = req.query;
  assertPropertyScope(req, propertyId);

  const today = new Date().toISOString().split('T')[0];
  const recs  = [];

  const [rooms, roomTypes, inHouse] = await Promise.all([
    Room.find({ property: propertyId, active: true }).lean(),
    RoomType.find({ property: propertyId, active: true }).lean(),
    Reservation.find({ property: propertyId, status: { $in: ['in_house', 'checked_in'] } }).lean(),
  ]);

  const totalRooms    = rooms.length;
  const occupiedRooms = inHouse.length;
  const occupancy     = totalRooms ? occupiedRooms / totalRooms : 0;

  // High occupancy → suggest price increase
  if (occupancy >= 0.85) {
    // Check inventory for next 7 days
    const next7 = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      next7.push(d.toISOString().split('T')[0]);
    }
    const highDates = await InventoryDate.find({
      property: propertyId,
      date: { $in: next7 },
      $expr: {
        $gte: ['$bookedCount', { $multiply: ['$sellableCount', 0.85] }],
      },
    }).lean();
    if (highDates.length >= 3) {
      recs.push({
        type: 'price_increase',
        priority: 'high',
        title: 'תפוסה גבוהה — מומלץ להעלות מחיר',
        detail: `תפוסה ${Math.round(occupancy * 100)}% היום; ${highDates.length} תאריכים מעל 85% ב-7 ימים הקרובים.`,
        dates: highDates.map(d => d.date),
      });
    }
  }

  // Low occupancy → suggest price drop / open channels
  if (occupancy <= 0.40 && occupancy >= 0) {
    recs.push({
      type: 'price_decrease',
      priority: 'medium',
      title: 'תפוסה נמוכה — מומלץ להוריד מחיר או לפתוח ערוצים',
      detail: `תפוסה ${Math.round(occupancy * 100)}% היום.`,
    });
  }

  // Dirty rooms that have an arrival today
  const dirtyRooms = rooms.filter(r => r.cleanStatus === 'dirty');
  const arrivals   = await Reservation.find({
    property: propertyId,
    arrivalDate: today,
    assignedRoom: { $in: dirtyRooms.map(r => r._id) },
    status: { $in: ['confirmed', 'modified'] },
  }).lean();
  if (arrivals.length) {
    recs.push({
      type: 'room_move',
      priority: 'high',
      title: `הצע העברת חדר — ${arrivals.length} אורח${arrivals.length > 1 ? 'ים' : ''} צפויים לחדר מלוכלך`,
      detail: 'שקול להקצות חדר נקי זמין לאורחים אלה.',
      count: arrivals.length,
    });
  }

  // Available clean rooms that could be offered as upgrades (paid)
  const cleanAvailable = rooms.filter(r =>
    ['clean', 'inspected'].includes(r.cleanStatus) &&
    r.opsStatus === 'available' &&
    r.occStatus === 'vacant'
  );
  if (cleanAvailable.length >= 2) {
    recs.push({
      type: 'paid_upgrade',
      priority: 'low',
      title: `${cleanAvailable.length} חדרים נקיים פנויים — הצע שדרוג בתשלום`,
      detail: 'ניתן להציע שדרוג לאורחים שכבר צ\'ק-אין.',
      availableRooms: cleanAvailable.length,
    });
  }

  res.json({ success: true, data: { count: recs.length, recommendations: recs } });
}));

// ══════════════════════════════════════════════════════════════════════════════
// פרק כ סעיף 40.3 — Automation Rules CRUD
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/automation/rules?propertyId=&trigger=&active=
router.get('/rules', asyncHandler(async (req, res) => {
  const { propertyId, trigger, active } = req.query;
  assertPropertyScope(req, propertyId);
  const filter = { property: propertyId };
  if (trigger) filter.trigger = trigger;
  if (active !== undefined) filter.active = active === 'true';
  const rules = await AutomationRule.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: rules });
}));

// GET /api/automation/rules/:id
router.get('/rules/:id', asyncHandler(async (req, res) => {
  const rule = await AutomationRule.findById(req.params.id).lean();
  if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
  assertPropertyScope(req, String(rule.property));
  res.json({ success: true, data: rule });
}));

// POST /api/automation/rules
router.post('/rules', asyncHandler(async (req, res) => {
  const { propertyId, name, description, trigger, conditions, action, actionParams, exceptions } = req.body;
  assertPropertyScope(req, propertyId);

  if (!name || !trigger || !action) {
    return res.status(400).json({ success: false, error: 'name, trigger and action are required' });
  }

  const rule = await AutomationRule.create({
    property: propertyId,
    name, description, trigger, conditions, action, actionParams, exceptions,
    createdBy: req.actor?._id,
    owner:     req.actor?._id,
  });

  await audit({
    property: propertyId, ...auditCtxFromReq(req),
    action: 'automation_rule.created',
    entityType: 'AutomationRule', entityId: rule._id,
    after: { name, trigger, action },
  });

  res.status(201).json({ success: true, data: rule });
}));

// PATCH /api/automation/rules/:id
router.patch('/rules/:id', asyncHandler(async (req, res) => {
  const rule = await AutomationRule.findById(req.params.id);
  if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
  assertPropertyScope(req, String(rule.property));
  const before = rule.toObject();

  const fields = ['name', 'description', 'active', 'trigger', 'conditions', 'action', 'actionParams', 'exceptions'];
  fields.forEach(f => { if (req.body[f] !== undefined) rule[f] = req.body[f]; });
  await rule.save();

  await audit({
    property: String(rule.property), ...auditCtxFromReq(req),
    action: 'automation_rule.updated',
    entityType: 'AutomationRule', entityId: rule._id,
    before, after: rule.toObject(),
  });

  res.json({ success: true, data: rule });
}));

// DELETE /api/automation/rules/:id
router.delete('/rules/:id', asyncHandler(async (req, res) => {
  const rule = await AutomationRule.findById(req.params.id);
  if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
  assertPropertyScope(req, String(rule.property));
  await rule.deleteOne();
  await audit({
    property: String(rule.property), ...auditCtxFromReq(req),
    action: 'automation_rule.deleted',
    entityType: 'AutomationRule', entityId: rule._id,
  });
  res.json({ success: true, data: { deleted: true } });
}));

// GET /api/automation/triggers — list available trigger types
router.get('/triggers', (req, res) => {
  res.json({ success: true, data: { triggers: TRIGGER_TYPES, actions: ACTION_TYPES } });
});

export default router;
