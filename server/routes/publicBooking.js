// Public booking site API (/api/public/booking) — no login, no cookies; rate-limited.
// The session token is the guest's only handle on their booking.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getSite, search, startBooking, sessionStatus, mockPay, completePayment, retryPayment } from '../services/publicBookingService.js';

const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'יותר מדי בקשות — נסו שוב בעוד דקה' } });
const bookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'יותר מדי ניסיונות הזמנה — נסו שוב מאוחר יותר' } });
router.use(limiter);

const handle = (fn) => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[public-booking]', err);
    res.status(status).json({ success: false, error: status >= 500 && !err.code ? 'אירעה תקלה — נסו שוב' : err.message, code: err.code, fields: err.fields, details: err.details });
  }
};

router.get('/site', handle((req) => getSite({ p: req.query.p })));
router.get('/search', handle((req) => search({ p: req.query.p, query: req.query })));
router.post('/start', bookLimiter, handle((req) => startBooking({ p: req.query.p || req.body?.p, input: req.body || {}, ip: req.ip })));
router.get('/session/:token', handle((req) => sessionStatus({ token: req.params.token })));
router.post('/session/:token/complete', handle((req) => completePayment({ token: req.params.token })));
router.post('/session/:token/retry', handle((req) => retryPayment({ token: req.params.token })));
router.post('/session/:token/mock-pay', handle((req) => mockPay({ token: req.params.token, outcome: req.body?.outcome })));

export default router;
