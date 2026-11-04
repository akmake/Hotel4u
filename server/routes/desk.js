// /api/pms/desk — front-desk communication (gap-map item 4): guest messages, alerts, traces,
// wake-up calls, locators, shift log book, phone book, operator search. Rules in services/deskService.js.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import {
  DESK_ROLES, createDeskItem, closeDeskItems, markLogRead, listDesk, stayDesk, operatorSearch,
  listPhoneBook, savePhoneEntry, removePhoneEntry,
} from '../services/deskService.js';

const router = Router();
// Department users (housekeeping, maintenance…) read and resolve the traces of their department.
const TRACE_ROLES = [...DESK_ROLES, 'housekeeping_manager', 'housekeeper', 'maintenance_manager', 'technician', 'finance_manager', 'revenue_manager', 'sales_manager'];
const READ_ROLES = [...new Set([...TRACE_ROLES, 'auditor', 'owner_readonly'])];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[desk]', err);
    res.status(safe).json({ success: false, error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}), ...(typeof err.code === 'string' ? { code: err.code } : {}) });
  }
};
function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
function actorOf(req) { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; }
const writeRoles = (kind) => (kind === 'trace' ? TRACE_ROLES : DESK_ROLES);

router.get('/items', handle(async (req) => {
  requireRoles(req, req.query.kind === 'trace' ? READ_ROLES : [...DESK_ROLES, 'auditor', 'owner_readonly'], 'אין הרשאה');
  const q = req.query;
  return listDesk({ propertyId: scope(req), kind: q.kind, view: q.view, date: q.date, from: q.from, to: q.to, department: q.department, reservationId: q.reservationId, actor: actorOf(req) });
}));
router.post('/items', handle(async (req) => {
  requireRoles(req, writeRoles(req.body?.kind), 'אין הרשאה');
  return createDeskItem({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));
router.post('/items/close', handle(async (req) => {
  requireRoles(req, TRACE_ROLES, 'אין הרשאה');
  return closeDeskItems({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));
router.post('/items/:id/read', handle(async (req) => {
  requireRoles(req, DESK_ROLES, 'אין הרשאה');
  return markLogRead({ propertyId: scope(req), id: req.params.id, actor: actorOf(req) });
}));
router.get('/stays/:reservationId', handle(async (req) => {
  requireRoles(req, READ_ROLES, 'אין הרשאה');
  return stayDesk({ propertyId: scope(req), reservationId: req.params.reservationId });
}));
router.get('/operator', handle(async (req) => {
  requireRoles(req, [...DESK_ROLES, 'auditor'], 'אין הרשאה');
  return operatorSearch({ propertyId: scope(req), q: req.query.q });
}));
router.get('/phone-book', handle(async (req) => {
  requireRoles(req, READ_ROLES, 'אין הרשאה');
  return listPhoneBook({ propertyId: scope(req), q: req.query.q });
}));
router.post('/phone-book', handle(async (req) => {
  requireRoles(req, DESK_ROLES, 'אין הרשאה');
  return savePhoneEntry({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));
router.put('/phone-book/:id', handle(async (req) => {
  requireRoles(req, DESK_ROLES, 'אין הרשאה');
  return savePhoneEntry({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));
router.delete('/phone-book/:id', handle(async (req) => {
  requireRoles(req, DESK_ROLES, 'אין הרשאה');
  return removePhoneEntry({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip });
}));

export default router;
