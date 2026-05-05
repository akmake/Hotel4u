import express from 'express';
import { requireAuth, requireAdmin } from '../middlewares/authMiddleware.js';
import { getFlows,updateFlow, createFlow, deleteFlow, triggerScan, getLogs } from '../controllers/admin/autoReplyController.js';

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', getFlows);
router.post('/', createFlow);
router.put('/:id', updateFlow); // <--- שורה חדשה לעדכון
router.delete('/:id', deleteFlow);
router.post('/scan', triggerScan);
router.get('/logs', getLogs);

export default router;