// Guest online check-in API (/api/public/checkin) — no login, no cookies; rate-limited.
// The link token is the guest's only handle on their stay.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { guestView, guestSubmit } from '../services/onlineCheckInService.js';

const router = express.Router();
router.use(rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'יותר מדי בקשות — נסו שוב בעוד דקה' } }));
const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'יותר מדי ניסיונות — נסו שוב מאוחר יותר' } });

const handle = (fn) => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[public-checkin]', err);
    res.status(status).json({ success: false, error: status >= 500 ? 'אירעה תקלה — נסו שוב' : err.message, code: err.code, fields: err.fields });
  }
};

router.get('/:token', handle((req) => guestView({ token: req.params.token })));
router.post('/:token', express.json({ limit: '600kb' }), submitLimiter, handle((req) => guestSubmit({ token: req.params.token, input: req.body || {}, ip: req.ip })));

export default router;
