// /api/pms/ops — housekeeping planning (OPS-01), personal tasks (OPS-02), room status (OPS-03),
// inspection (OPS-04), lost & found (OPS-05) and maintenance tickets (OPS-06).
// Business rules live in services/operationsService.js; this file only gates roles and scope.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import {
  HK_MANAGER_ROLES, INSPECTOR_ROLES, MT_MANAGER_ROLES,
  housekeepingBoard, generateTasks, createTask, assignTasks, setTaskPriority, cancelTask,
  myTasks, startTask, pauseTask, setDnd, completeTask,
  inspectionQueue, inspectTask,
  roomStatusList, setCleanStatus,
  listLostItems, createLostItem, transferLostItem, releaseLostItem, disposeLostItem,
  listTickets, getTicket, createTicket, takeTicket, updateTicket, resolveTicket, closeTicket, reopenTicket, unblockRoom,
  opsStaff, roomsLite,
} from '../services/operationsService.js';
import { listBlocks, createBlock, releaseBlock, availabilityGrid } from '../services/roomBlockService.js';
import { roomChart } from '../services/roomChartService.js';

const router = Router();

const FRONT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist'];
const HK_STAFF = ['housekeeper', 'housekeeping_manager'];
const MT_STAFF = ['technician', 'maintenance_manager'];
// Planning board: housekeeping supervisors plan; the desk reads it to know what is ready.
const BOARD_READ = [...new Set([...HK_MANAGER_ROLES, ...FRONT_ROLES, 'auditor', 'owner_readonly'])];
const TASK_WORK = [...new Set([...HK_MANAGER_ROLES, ...HK_STAFF])];
const ROOM_STATUS_READ = [...new Set([...BOARD_READ, ...HK_STAFF, ...MT_STAFF, ...MT_MANAGER_ROLES])];
const ROOM_STATUS_WRITE = [...new Set([...HK_MANAGER_ROLES, ...HK_STAFF, ...FRONT_ROLES])];
const LOST_ROLES = [...new Set([...HK_MANAGER_ROLES, ...HK_STAFF, ...FRONT_ROLES])];
const TICKET_READ = [...new Set([...MT_MANAGER_ROLES, ...MT_STAFF, ...HK_MANAGER_ROLES, ...FRONT_ROLES, 'auditor', 'owner_readonly'])];
// Anyone working in the building may report a fault (OPS-02-A03, front desk, maintenance).
const TICKET_REPORT = [...new Set([...MT_MANAGER_ROLES, ...MT_STAFF, ...HK_MANAGER_ROLES, ...HK_STAFF, ...FRONT_ROLES])];
const TICKET_WORK = [...new Set([...MT_MANAGER_ROLES, ...MT_STAFF])];
const TICKET_REOPEN = [...new Set([...MT_MANAGER_ROLES, ...MT_STAFF, 'housekeeping_manager', 'front_desk_manager'])];
const UNBLOCK_ROLES = [...new Set([...MT_MANAGER_ROLES, 'front_desk_manager', 'housekeeping_manager'])];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[ops]', err);
    res.status(safe).json({
      success: false,
      error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message,
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.details ? { details: err.details } : {}),
      ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}),
    });
  }
};

function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) {
    const err = new Error('יש לבחור נכס');
    err.status = 400;
    throw err;
  }
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}

function actorOf(req) {
  const a = actorOrSystem(req);
  return { id: a.id, name: a.name, role: a.role };
}

// ── OPS-01 planning ─────────────────────────────────────────────────────────
router.get('/board', handle(async (req) => {
  requireRoles(req, BOARD_READ, 'אין הרשאה לצפות בתכנון החדרנות');
  return housekeepingBoard({ propertyId: scope(req), date: req.query.date, floor: req.query.floor, zone: req.query.zone });
}));

router.post('/tasks/generate', handle(async (req) => {
  requireRoles(req, HK_MANAGER_ROLES, 'יצירת משימות מותרת למפקח חדרנות');
  return generateTasks({ propertyId: scope(req), date: req.body?.date, actor: actorOf(req), ip: req.ip });
}));

router.post('/tasks', handle(async (req) => {
  requireRoles(req, HK_MANAGER_ROLES, 'יצירת משימה מותרת למפקח חדרנות');
  return createTask({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/tasks/assign', handle(async (req) => {
  requireRoles(req, HK_MANAGER_ROLES, 'שיוך משימות מותר למפקח חדרנות');
  return assignTasks({ propertyId: scope(req), taskIds: req.body?.taskIds, assigneeId: req.body?.assigneeId || null, actor: actorOf(req), ip: req.ip });
}));

router.post('/tasks/:id/priority', handle(async (req) => {
  requireRoles(req, HK_MANAGER_ROLES, 'שינוי עדיפות מותר למפקח חדרנות');
  return setTaskPriority({ propertyId: scope(req), taskId: req.params.id, priority: req.body?.priority, reason: req.body?.reason, actor: actorOf(req), ip: req.ip });
}));

router.post('/tasks/:id/cancel', handle(async (req) => {
  requireRoles(req, HK_MANAGER_ROLES, 'ביטול משימה מותר למפקח חדרנות');
  return cancelTask({ propertyId: scope(req), taskId: req.params.id, reason: req.body?.reason, actor: actorOf(req), ip: req.ip });
}));

// ── OPS-02 personal tasks ───────────────────────────────────────────────────
router.get('/my-tasks', handle(async (req) => {
  requireRoles(req, TASK_WORK, 'אין הרשאה למשימות חדרנות');
  return myTasks({ propertyId: scope(req), actor: actorOf(req), date: req.query.date, all: req.query.all === '1' });
}));

router.post('/tasks/:id/start', handle(async (req) => {
  requireRoles(req, TASK_WORK, 'אין הרשאה לבצע משימה');
  return startTask({ propertyId: scope(req), taskId: req.params.id, actor: actorOf(req), ip: req.ip });
}));

router.post('/tasks/:id/pause', handle(async (req) => {
  requireRoles(req, TASK_WORK, 'אין הרשאה לבצע משימה');
  return pauseTask({ propertyId: scope(req), taskId: req.params.id, reason: req.body?.reason, note: req.body?.note, actor: actorOf(req), ip: req.ip });
}));

router.post('/tasks/:id/dnd', handle(async (req) => {
  requireRoles(req, TASK_WORK, 'אין הרשאה לעדכן משימה');
  return setDnd({ propertyId: scope(req), taskId: req.params.id, on: !!req.body?.on, actor: actorOf(req), ip: req.ip });
}));

router.post('/tasks/:id/complete', handle(async (req) => {
  requireRoles(req, TASK_WORK, 'אין הרשאה לבצע משימה');
  return completeTask({ propertyId: scope(req), taskId: req.params.id, checklist: req.body?.checklist, note: req.body?.note, actor: actorOf(req), ip: req.ip });
}));

// ── OPS-04 inspection ───────────────────────────────────────────────────────
router.get('/inspections', handle(async (req) => {
  requireRoles(req, INSPECTOR_ROLES, 'בדיקת חדרים מותרת למפקח חדרנות');
  return inspectionQueue({ propertyId: scope(req) });
}));

router.post('/tasks/:id/inspect', handle(async (req) => {
  requireRoles(req, INSPECTOR_ROLES, 'בדיקת חדרים מותרת למפקח חדרנות');
  const b = req.body || {};
  return inspectTask({ propertyId: scope(req), taskId: req.params.id, decision: b.decision, checklist: b.checklist, defects: b.defects, note: b.note, actor: actorOf(req), ip: req.ip });
}));

// ── OPS-03 room status ──────────────────────────────────────────────────────
router.get('/rooms', handle(async (req) => {
  requireRoles(req, ROOM_STATUS_READ, 'אין הרשאה לצפות במצב החדרים');
  return roomStatusList({ propertyId: scope(req), floor: req.query.floor, clean: req.query.clean, q: req.query.q });
}));

router.post('/rooms/:id/clean-status', handle(async (req) => {
  requireRoles(req, ROOM_STATUS_WRITE, 'אין הרשאה לעדכן ניקיון');
  const b = req.body || {};
  return setCleanStatus({ propertyId: scope(req), roomId: req.params.id, cleanStatus: b.cleanStatus, reason: b.reason, version: b.version, actor: actorOf(req), ip: req.ip });
}));

router.post('/rooms/:id/unblock', handle(async (req) => {
  requireRoles(req, UNBLOCK_ROLES, 'שחרור חסימת חדר מותר למנהל');
  return unblockRoom({ propertyId: scope(req), roomId: req.params.id, reason: req.body?.reason, actor: actorOf(req), ip: req.ip });
}));

// INV-04 room blocks by dates, INV-01 availability grid.
router.get('/room-blocks', handle(async (req) => {
  requireRoles(req, ROOM_STATUS_READ, 'אין הרשאה');
  const q = req.query;
  return listBlocks({ propertyId: scope(req), from: q.from, to: q.to, roomId: q.roomId, includeReleased: q.includeReleased === '1' });
}));
router.post('/rooms/:id/blocks', handle(async (req) => createBlock({ propertyId: scope(req), roomId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip })));
router.post('/room-blocks/:id/release', handle(async (req) => releaseBlock({ propertyId: scope(req), blockId: req.params.id, reason: req.body?.reason, actor: actorOf(req), ip: req.ip })));
router.get('/availability', handle(async (req) => {
  requireRoles(req, ROOM_STATUS_READ, 'אין הרשאה');
  return availabilityGrid({ propertyId: scope(req), from: req.query.from, days: req.query.days });
}));

router.get('/room-chart', handle(async (req) => {
  requireRoles(req, ROOM_STATUS_READ, 'אין הרשאה');
  return roomChart({ propertyId: scope(req), from: req.query.from, days: req.query.days });
}));

router.get('/rooms-lite', handle(async (req) => {
  requireRoles(req, ROOM_STATUS_READ, 'אין הרשאה');
  return roomsLite({ propertyId: scope(req) });
}));

router.get('/staff', handle(async (req) => {
  requireRoles(req, ROOM_STATUS_READ, 'אין הרשאה');
  return opsStaff({ propertyId: scope(req), kind: req.query.kind === 'maintenance' ? 'maintenance' : 'housekeeping' });
}));

// ── OPS-05 lost & found ─────────────────────────────────────────────────────
router.get('/lost-items', handle(async (req) => {
  requireRoles(req, LOST_ROLES, 'אין הרשאה לאבידות ומציאות');
  return listLostItems({ propertyId: scope(req), status: req.query.status, q: req.query.q });
}));

router.post('/lost-items', handle(async (req) => {
  requireRoles(req, LOST_ROLES, 'אין הרשאה לאבידות ומציאות');
  return createLostItem({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/lost-items/:id/transfer', handle(async (req) => {
  requireRoles(req, LOST_ROLES, 'אין הרשאה לאבידות ומציאות');
  const b = req.body || {};
  return transferLostItem({ propertyId: scope(req), id: req.params.id, storage: b.storage, toName: b.toName, note: b.note, actor: actorOf(req), ip: req.ip });
}));

router.post('/lost-items/:id/release', handle(async (req) => {
  requireRoles(req, [...new Set([...HK_MANAGER_ROLES, ...FRONT_ROLES])], 'מסירת חפץ מותרת לקבלה או למפקח');
  const b = req.body || {};
  return releaseLostItem({ propertyId: scope(req), id: req.params.id, guestId: b.guestId, recipientName: b.recipientName, evidence: b.evidence, note: b.note, actor: actorOf(req), ip: req.ip });
}));

router.post('/lost-items/:id/dispose', handle(async (req) => {
  requireRoles(req, LOST_ROLES, 'אין הרשאה לאבידות ומציאות');
  const b = req.body || {};
  return disposeLostItem({ propertyId: scope(req), id: req.params.id, method: b.method, note: b.note, actor: actorOf(req), ip: req.ip });
}));

// ── OPS-06 maintenance ──────────────────────────────────────────────────────
router.get('/tickets', handle(async (req) => {
  requireRoles(req, TICKET_READ, 'אין הרשאה לצפות בתקלות');
  const q = req.query;
  return listTickets({ propertyId: scope(req), status: q.status || 'open', priority: q.priority, roomId: q.roomId, q: q.q, mine: q.mine === '1', actor: actorOf(req) });
}));

router.get('/tickets/:id', handle(async (req) => {
  requireRoles(req, TICKET_READ, 'אין הרשאה לצפות בתקלות');
  return getTicket({ propertyId: scope(req), id: req.params.id });
}));

router.post('/tickets', handle(async (req) => {
  requireRoles(req, TICKET_REPORT, 'אין הרשאה לדווח תקלה');
  return createTicket({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/tickets/:id/take', handle(async (req) => {
  requireRoles(req, TICKET_WORK, 'קבלת טיפול מותרת לצוות תחזוקה');
  return takeTicket({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip });
}));

router.patch('/tickets/:id', handle(async (req) => {
  requireRoles(req, TICKET_WORK, 'עדכון תקלה מותר לצוות תחזוקה');
  return updateTicket({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.post('/tickets/:id/resolve', handle(async (req) => {
  requireRoles(req, TICKET_WORK, 'סיום תיקון מותר לצוות תחזוקה');
  return resolveTicket({ propertyId: scope(req), id: req.params.id, note: req.body?.note, actor: actorOf(req), ip: req.ip });
}));

router.post('/tickets/:id/close', handle(async (req) => {
  requireRoles(req, TICKET_WORK, 'סגירת תקלה מותרת לצוות תחזוקה');
  return closeTicket({ propertyId: scope(req), id: req.params.id, note: req.body?.note, actor: actorOf(req), ip: req.ip });
}));

router.post('/tickets/:id/reopen', handle(async (req) => {
  requireRoles(req, TICKET_REOPEN, 'פתיחה מחדש מותרת לתחזוקה או למנהל');
  return reopenTicket({ propertyId: scope(req), id: req.params.id, reason: req.body?.reason, actor: actorOf(req), ip: req.ip });
}));

export default router;
