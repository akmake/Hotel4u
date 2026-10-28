// Read-only UI QA with real ArrivalsPage, real authenticated arrivals router and synthetic data.
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../client/node_modules/vite/dist/node/index.js';
import react from '../../client/node_modules/@vitejs/plugin-react/dist/index.js';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import { fixture } from './arrivalDisplayReadiness.mjs';
import Folio from '../models/Folio.js';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import User from '../models/User.js';
import { pmsJwtSecret } from '../utils/jwtSecret.js';
import { attachActor, requireActor, assertPropertyScope } from '../middleware/authContext.js';
import frontdeskRouter from '../routes/frontdesk.js';
const replica = await createAccountingTestReplica(); await mongoose.connect(replica.getUri(), { dbName: `arrival_ui_${Date.now()}` }); await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
const f = await fixture({ multi: true });
await Folio.collection.updateOne({ _id: f.folio._id }, { $set: { lines: [{ _id: new mongoose.Types.ObjectId(), type: 'payment', amount: -600, taxAmount: 0, status: 'posted', description: 'Synthetic receipt', serviceDate: f.today }] } });
const user = await User.create({ property: f.propertyId, role: 'receptionist', email: `${randomUUID()}@example.test`, passwordHash: 'synthetic-placeholder', firstName: 'QA', lastName: 'Arrival' });
const app = express(); app.use(express.json());
app.get('/__qa/bootstrap', (_req, res) => res.json({ token: jwt.sign({ id: String(user._id), tv: 0 }, pmsJwtSecret(), { expiresIn: '30m' }), user: { _id: String(user._id), propertyId: f.propertyId, role: user.role } }));
app.use('/api/pms', attachActor, requireActor, (req, res, next) => { if (req.method !== 'GET') return res.status(403).json({ success: false, error: 'שרת בדיקה לקריאה בלבד' }); next(); });
app.get('/api/pms/properties', async (_req, res) => res.json({ success: true, data: [await Property.findById(f.propertyId).lean()] }));
app.get('/api/pms/properties/room-types', async (req, res) => { assertPropertyScope(req, req.query.propertyId); res.json({ success: true, data: await RoomType.find({ property: f.propertyId }).lean() }); });
app.use('/api/pms/frontdesk', async (req, _res, next) => {
  // Only the slow first search is delayed; allows a real UI check that its late reply is ignored.
  if (req.path === '/arrivals' && req.query.q === 'דני') await new Promise((resolve) => setTimeout(resolve, 3500));
  next();
}, frontdeskRouter);
const clientRoot = fileURLToPath(new URL('../../client/', import.meta.url));
const vite = await createServer({ root: clientRoot, configFile: false, envFile: false, plugins: [react()], css: { postcss: clientRoot }, resolve: { alias: { '@': `${clientRoot}src` } }, optimizeDeps: { entries: ['qa/arrival-display.jsx'] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
app.get('/__qa/arrival-display', async (_req, res) => res.type('html').send(await vite.transformIndexHtml('/__qa/arrival-display', '<!doctype html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>בדיקת הגעות</title></head><body><div id="root"></div><script type="module" src="/qa/arrival-display.jsx"></script></body></html>')));
app.use(vite.middlewares);
const server = app.listen(4899, '127.0.0.1', () => console.log('Synthetic read-only arrivals UI: http://127.0.0.1:4899/__qa/arrival-display'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await vite.close(); await mongoose.disconnect(); await replica.stop(); process.exit(0); });
