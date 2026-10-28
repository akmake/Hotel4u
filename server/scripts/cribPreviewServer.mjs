// Explicit loopback-only QA: actual arrivals page + crib routes, synthetic disposable replica.
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../client/node_modules/vite/dist/node/index.js';
import react from '../../client/node_modules/@vitejs/plugin-react/dist/index.js';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import { fixture } from './arrivalDisplayReadiness.mjs';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import User from '../models/User.js';
import { pmsJwtSecret } from '../utils/jwtSecret.js';
import { attachActor, requireActor, assertPropertyScope } from '../middleware/authContext.js';
import frontdeskRouter from '../routes/frontdesk.js';
const replica = await createAccountingTestReplica(); await mongoose.connect(replica.getUri(), { dbName: `crib_ui_${Date.now()}` }); await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
const f = await fixture(), user = await User.create({ property: f.propertyId, role: 'general_manager', email: `${randomUUID()}@example.test`, passwordHash: 'synthetic-placeholder', firstName: 'QA', lastName: 'Crib' });
let loseFirstDelivery = true;
const app = express(); app.use(express.json());
app.get('/__qa/bootstrap', (_req, res) => res.json({ token: jwt.sign({ id: String(user._id), tv: 0 }, pmsJwtSecret(), { expiresIn: '30m' }), user: { _id: String(user._id), propertyId: f.propertyId, role: user.role } }));
app.use('/api/pms', attachActor, requireActor, (req, res, next) => { if (req.method !== 'GET' && !req.path.endsWith('/cribs') && req.path !== '/frontdesk/cribs/stock') return res.status(403).json({ success: false, error: 'שרת בדיקת לולים בלבד' }); next(); });
app.get('/api/pms/properties', async (_req, res) => res.json({ success: true, data: [await Property.findById(f.propertyId).lean()] }));
app.get('/api/pms/properties/room-types', async (req, res) => { assertPropertyScope(req, req.query.propertyId); res.json({ success: true, data: await RoomType.find({ property: f.propertyId }).lean() }); });
app.use('/api/pms/frontdesk', (req, res, next) => {
  if (req.method === 'POST' && req.path.endsWith('/cribs') && req.body.action === 'deliver' && loseFirstDelivery) {
    const original = res.json.bind(res);
    res.json = (body) => { if (body.success) { loseFirstDelivery = false; return res.status(503).send({ success: false, error: 'בדיקת דמה: תשובת המסירה אבדה לאחר השמירה' }); } return original(body); };
  }
  next();
}, frontdeskRouter);
const clientRoot = fileURLToPath(new URL('../../client/', import.meta.url));
const vite = await createServer({ root: clientRoot, configFile: false, envFile: false, plugins: [react()], css: { postcss: clientRoot }, resolve: { alias: { '@': `${clientRoot}src` } }, optimizeDeps: { entries: ['qa/arrival-display.jsx'] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
app.get('/__qa/cribs', async (_req, res) => res.type('html').send(await vite.transformIndexHtml('/__qa/cribs', '<!doctype html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>בדיקת לולים — נתוני דמה</title></head><body><div id="root"></div><script type="module" src="/qa/arrival-display.jsx"></script></body></html>')));
app.use(vite.middlewares);
const server = app.listen(4900, '127.0.0.1', () => console.log('Synthetic crib UI: http://127.0.0.1:4900/__qa/cribs (first delivery returns simulated 503 after commit)'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await vite.close(); await mongoose.disconnect(); await replica.stop(); process.exit(0); });
