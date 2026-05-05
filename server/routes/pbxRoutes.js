// server/routes/pbxRoutes.js

import express from 'express';
import CustomerCard from '../models/CustomerCard.js';

const router = express.Router();

// מאגר שיחות פעילות בזיכרון
let activeCalls = [];

// פונקציה לניקוי טלפון
const normalizePhone = (phone) => {
    if (!phone) return '';
    let clean = phone.toString().replace(/\D/g, '');
    if (clean.startsWith('972')) clean = '0' + clean.slice(3);
    if (!clean.startsWith('0') && clean.length === 9) clean = '0' + clean;
    return clean;
};

/**
 * POST /api/pbx/calls
 * המרכזיה שולחת את רשימת השיחות הפעילות
 *
 * Body אפשרי (תלוי בספק):
 * {
 *   "calls": [
 *     { "callId": "abc123", "callerNumber": "0501234567", "direction": "inbound", "status": "ringing", "duration": 0 },
 *     { "callId": "def456", "callerNumber": "0527654321", "direction": "inbound", "status": "answered", "duration": 45 }
 *   ]
 * }
 *
 * או אירוע בודד:
 * { "callId": "abc123", "callerNumber": "0501234567", "event": "ringing" }
 */
router.post('/calls', async (req, res) => {
    try {
        const { calls, callId, callerNumber, event, direction, duration } = req.body;

        if (calls && Array.isArray(calls)) {
            // מצב 1: המרכזיה שולחת את כל השיחות הפעילות בבת אחת
            activeCalls = calls.map(c => ({
                callId: c.callId || c.id || String(Date.now()),
                callerNumber: normalizePhone(c.callerNumber || c.caller || c.number || c.phone),
                direction: c.direction || 'inbound',
                status: c.status || 'ringing',
                duration: c.duration || 0,
                startTime: c.startTime || new Date().toISOString()
            }));
        } else if (callId || callerNumber) {
            // מצב 2: אירוע בודד
            const normalized = normalizePhone(callerNumber);

            if (event === 'hangup' || event === 'ended') {
                // שיחה נגמרה — הסרה
                activeCalls = activeCalls.filter(c => c.callId !== callId);
            } else {
                // שיחה חדשה או עדכון
                const existing = activeCalls.find(c => c.callId === callId);
                if (existing) {
                    existing.status = event || existing.status;
                    existing.duration = duration || existing.duration;
                } else {
                    activeCalls.push({
                        callId: callId || String(Date.now()),
                        callerNumber: normalized,
                        direction: direction || 'inbound',
                        status: event || 'ringing',
                        duration: duration || 0,
                        startTime: new Date().toISOString()
                    });
                }
            }
        }

        // שידור לכל המשתמשים המחוברים ב-Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.emit('active-calls', activeCalls);
        }

        res.json({ ok: true, activeCalls: activeCalls.length });

    } catch (error) {
        console.error('PBX webhook error:', error);
        res.status(500).json({ message: 'שגיאה בעיבוד שיחה' });
    }
});

/**
 * GET /api/pbx/calls
 * שליפת שיחות פעילות (לטעינה ראשונית)
 */
router.get('/calls', (req, res) => {
    res.json(activeCalls);
});

/**
 * DELETE /api/pbx/calls/:callId
 * סיום שיחה ידני
 */
router.delete('/calls/:callId', (req, res) => {
    activeCalls = activeCalls.filter(c => c.callId !== req.params.callId);

    const io = req.app.get('io');
    if (io) io.emit('active-calls', activeCalls);

    res.json({ ok: true });
});

// Socket.IO setup — צריך לקרוא מ-app.js
export function setupPbxSocket(io) {
    io.on('connection', (socket) => {
        // כשמשתמש מבקש שיחות פעילות
        socket.on('get-active-calls', () => {
            socket.emit('active-calls', activeCalls);
        });
    });
}

export default router;