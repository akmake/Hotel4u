// /api/pms/group-blocks — group allotments that hold inventory, pickups at the group price, rooming list.
import { Router } from 'express';
import multer from 'multer';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import { listBlocks, getBlock, createBlock, updateBlock, setBlockStatus, pickupFromBlock, saveRoster, moveBlock, saveGrid, setRoomingStatus, fillRosterFromBlock, bookRoster, assignGroupRooms, groupCheckIn, copyGroup, GROUP_WORK, GROUP_MANAGE } from '../services/groupBlockService.js';
import { getMoney, saveBilling, suggestBilling, recordPayment, addAttachment, getAttachment, decidePayment } from '../services/groupMoneyService.js';
import { listMealTypes, saveMealType, getProgram, saveProgramItem, deleteProgramItem, duplicateDay, kitchenReport } from '../services/groupProgramService.js';

const router = Router();
// Payment proof: kept in memory and stored in the database, never on the public uploads folder.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const READ = [...GROUP_WORK, 'finance_manager', 'auditor', 'owner_readonly'];
// Group money: the desk records, finance approves (both may work on it).
const MONEY_WORK = [...GROUP_WORK, 'finance_manager'];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[group-blocks]', err);
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

// Programme: meal catalog and the kitchen's week (before /:id).
router.get('/meal-types', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return listMealTypes({ propertyId: scope(req), all: req.query.all === '1' }); }));
router.post('/meal-types', handle(async (req) => { requireRoles(req, GROUP_MANAGE, 'קטלוג הארוחות מנוהל על ידי מנהל'); return saveMealType({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.patch('/meal-types/:mealId', handle(async (req) => { requireRoles(req, GROUP_MANAGE, 'קטלוג הארוחות מנוהל על ידי מנהל'); return saveMealType({ propertyId: scope(req), id: req.params.mealId, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.get('/kitchen', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return kitchenReport({ propertyId: scope(req), from: req.query.from, days: req.query.days, by: req.query.by }); }));

router.get('/', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה לקבוצות'); return listBlocks({ propertyId: scope(req), view: req.query.view, q: req.query.q }); }));
router.get('/:id', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה לקבוצות'); return getBlock({ propertyId: scope(req), id: req.params.id }); }));
router.post('/', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה לפתוח קבוצה'); return createBlock({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.patch('/:id', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return updateBlock({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/:action(confirm|cancel|release)', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return setBlockStatus({ propertyId: scope(req), id: req.params.id, action: req.params.action, reason: req.body?.reason, roomTypeId: req.body?.roomTypeId, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/pickup', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return pickupFromBlock({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.put('/:id/grid', handle(async (req) => { requireRoles(req, GROUP_MANAGE, 'כמות לפי לילה — למנהל או למכירות'); return saveGrid({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/rooming-status', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return setRoomingStatus({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/rooming-fill', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return fillRosterFromBlock({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/rooming-book', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return bookRoster({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/assign-rooms', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return assignGroupRooms({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/check-in', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return groupCheckIn({ propertyId: scope(req), id: req.params.id, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/copy', handle(async (req) => { requireRoles(req, GROUP_MANAGE, 'שכפול קבוצה — למנהל או למכירות'); return copyGroup({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/move', handle(async (req) => { requireRoles(req, GROUP_MANAGE, 'הזזת קבוצה מותרת למנהל'); return moveBlock({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.get('/:id/program', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return getProgram({ propertyId: scope(req), groupId: req.params.id }); }));
router.post('/:id/program', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return saveProgramItem({ propertyId: scope(req), groupId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/program/duplicate-day', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return duplicateDay({ propertyId: scope(req), groupId: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.patch('/:id/program/:itemId', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return saveProgramItem({ propertyId: scope(req), groupId: req.params.id, itemId: req.params.itemId, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.delete('/:id/program/:itemId', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return deleteProgramItem({ propertyId: scope(req), groupId: req.params.id, itemId: req.params.itemId, actor: actorOf(req), ip: req.ip }); }));
// Money: billing profile, payments with proof, approval into the group's account.
router.get('/:id/money', handle(async (req) => { requireRoles(req, READ, 'אין הרשאה'); return getMoney({ propertyId: scope(req), id: req.params.id }); }));
router.get('/:id/billing/suggest', handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה'); return suggestBilling({ propertyId: scope(req), id: req.params.id }); }));
router.put('/:id/billing', handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה'); return saveBilling({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/payments', handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה'); return recordPayment({ propertyId: scope(req), id: req.params.id, input: req.body || {}, actor: actorOf(req), ip: req.ip }); }));
router.post('/:id/payments/:paymentId/attachments', (req, res, next) => upload.single('file')(req, res, (err) => { if (err) return res.status(422).json({ success: false, error: err.code === 'LIMIT_FILE_SIZE' ? 'עד 5MB לקובץ' : 'הקובץ לא התקבל' }); next(); }),
  handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה'); return addAttachment({ propertyId: scope(req), id: req.params.id, paymentId: req.params.paymentId, file: req.file, actor: actorOf(req), ip: req.ip }); }));
router.get('/:id/attachments/:attachmentId', async (req, res) => {
  try {
    requireRoles(req, READ, 'אין הרשאה');
    const a = await getAttachment({ propertyId: scope(req), id: req.params.id, attachmentId: req.params.attachmentId });
    res.set({ 'Content-Type': a.mime, 'Content-Length': a.size, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(a.data);
  } catch (err) { res.status(Number(err.status) || 500).json({ success: false, error: err.status ? err.message : 'שגיאת שרת' }); }
});
router.post('/:id/payments/:paymentId/:decision(approve|reject|cancel)', handle(async (req) => { requireRoles(req, MONEY_WORK, 'אין הרשאה'); return decidePayment({ propertyId: scope(req), id: req.params.id, paymentId: req.params.paymentId, decision: req.params.decision, reason: req.body?.reason, actor: actorOf(req), ip: req.ip }); }));
router.put('/:id/rooming-list', handle(async (req) => { requireRoles(req, GROUP_WORK, 'אין הרשאה'); return saveRoster({ propertyId: scope(req), id: req.params.id, entries: req.body?.entries, actor: actorOf(req), ip: req.ip }); }));

export default router;
