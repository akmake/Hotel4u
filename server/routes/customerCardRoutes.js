// server/routes/customerCardRoutes.js
import express from 'express';
import { getCustomerCard, addManualInteraction, getCalendarOrders } from '../controllers/customerCardController.js';
import requireAuth from '../middlewares/requireAuth.js';

const router = express.Router();

// GET /api/customer-card
router.get('/', requireAuth, getCustomerCard);

// ✅ חדש: GET /api/customer-card/calendar?year=2026&month=2
router.get('/calendar', requireAuth, getCalendarOrders);

// POST /api/customer-card/:id/timeline
router.post('/:id/timeline', requireAuth, addManualInteraction);

export default router;