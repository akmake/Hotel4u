// /api/pms/proposals — multi-option quotations (one customer, several room/rate alternatives).
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import { listProposals, getProposal, createProposal, markSent, closeLost, acceptOption, printProposal } from '../services/proposalService.js';

const router = Router();
const WORK = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'revenue_manager', 'sales_manager'];
const READ = [...WORK, 'finance_manager', 'auditor', 'owner_readonly'];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[proposals]', err);
    res.status(safe).json({ success: false, error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.details ? { details: err.details } : {}), ...(typeof err.code === 'string' ? { code: err.code } : {}) });
  }
};
function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}
function actorOf(req) { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; }

router.get('/', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return listProposals({ propertyId: scope(req), view: req.query.view, q: req.query.q }); }));
router.get('/:id', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return getProposal({ propertyId: scope(req), id: req.params.id }); }));
router.post('/', handle(async (req) => { requireRoles(req, WORK, 'אין הרשאה ליצור הצעה'); return createProposal({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/sent', handle(async (req) => { requireRoles(req, WORK, 'אין הרשאה'); return markSent({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/lost', handle(async (req) => { requireRoles(req, WORK, 'אין הרשאה'); return closeLost({ propertyId: scope(req), id: req.params.id, reason: req.body?.reason, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/accept', handle(async (req) => { requireRoles(req, WORK, 'אין הרשאה'); return acceptOption({ propertyId: scope(req), id: req.params.id, optionId: req.body?.optionId, acceptNewPrice: req.body?.acceptNewPrice === true, idempotencyKey: req.body?.idempotencyKey, actor: actorOf(req), ip: req.ip }); }));
router.get('/:id/print', async (req, res) => {
  try {
    requireRoles(req, READ, 'אין הרשאה');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await printProposal({ propertyId: scope(req), id: req.params.id }));
  } catch (err) { res.status(Number(err?.status) || 500).send(String(err?.message || 'שגיאה').replace(/[<>&]/g, '')); }
});

export default router;
