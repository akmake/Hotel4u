// Explicit loopback QA harness. Disposable replica + synthetic users, no application .env.
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../client/node_modules/vite/dist/node/index.js';
import react from '../../client/node_modules/@vitejs/plugin-react/dist/index.js';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import { fixture } from './roomSwapReadiness.mjs';
import User from '../models/User.js';
import Room from '../models/Room.js';
import ReservationRoom from '../models/ReservationRoom.js';
import RoomSwapOperation from '../models/RoomSwapOperation.js';
import { pmsJwtSecret } from '../utils/jwtSecret.js';
import { attachActor, requireActor } from '../middleware/authContext.js';
import stayRouter from '../routes/stay.js';

const replica = await createAccountingTestReplica();
await mongoose.connect(replica.getUri(), { dbName: `swap_browser_${Date.now()}` });
await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
let f = await fixture(), loseNextResponse = false;
const user = await User.create({ email: `swap-preview-${randomUUID()}@example.test`, passwordHash: 'synthetic-placeholder', role: 'receptionist', property: f.propertyId, firstName: 'קבלת', lastName: 'בדיקות', active: true });
const app = express(); app.use(express.json());
app.post('/__qa/reset', async (_req, res) => { f = await fixture(); user.property = f.propertyId; await user.save(); res.json({ ok: true }); });
app.get('/__qa/bootstrap', (_req, res) => { loseNextResponse = _req.query.lose === '1'; res.json({ propertyId: f.propertyId, reservationId: String(f.reservations[0]._id), token: jwt.sign({ id: String(user._id), tv: 0 }, pmsJwtSecret(), { expiresIn: '30m' }) }); });
app.get('/__qa/state', async (_req, res) => {
  const rooms = await Room.find({ property: f.propertyId }).lean(), units = await ReservationRoom.find({ property: f.propertyId }).sort({ occupantName: 1 }).lean();
  res.json({ assignments: units.map((u) => ({ guest: u.occupantName, room: rooms.find((r) => String(r._id) === String(u.assignedRoom))?.number })), swaps: await RoomSwapOperation.countDocuments({ property: f.propertyId }) });
});
app.use('/api/pms/stay', attachActor, requireActor, (req, res, next) => {
  if (req.method === 'POST' && req.path === '/room-swap' && loseNextResponse) {
    const original = res.json.bind(res);
    res.json = (body) => { if (body.success) { loseNextResponse = false; return res.status(503).send({ success: false, error: 'בדיקת דמה: תשובת ההצלחה אבדה בדרך לקבלה' }); } return original(body); };
  }
  next();
}, stayRouter);
const vite = await createServer({ root: fileURLToPath(new URL('../../client/', import.meta.url)), configFile: false, envFile: false, plugins: [react()], resolve: { alias: { '@': fileURLToPath(new URL('../../client/src/', import.meta.url)) } }, optimizeDeps: { entries: ['qa/room-swap.jsx'] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
app.get('/__qa/room-swap', async (_req, res) => res.type('html').send(await vite.transformIndexHtml('/__qa/room-swap', '<!doctype html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>בדיקת החלפת חדרים</title></head><body><div id="root"></div><script type="module" src="/qa/room-swap.jsx"></script></body></html>')));
app.use(vite.middlewares);
const server = app.listen(4898, '127.0.0.1', () => console.log('Synthetic swap browser QA: http://127.0.0.1:4898/__qa/room-swap'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await vite.close(); await mongoose.disconnect(); await replica.stop(); process.exit(0); });
