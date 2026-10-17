// Isolated, loopback-only QA server. Never imports app.js or the application .env.
import express from 'express';
import mongoose from 'mongoose';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import Property from '../models/Property.js';
import * as models from '../models/Accounting.js';
import AuditLog from '../models/AuditLog.js';
import accountingRouter from '../routes/accounting.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { setupEntity, seedAccounts, createPeriod } from '../services/accountingService.js';

const repl = await createAccountingTestReplica();
await mongoose.connect(repl.getUri(), { dbName: 'accounting_preview_disposable' });
await Promise.all([Property, AuditLog, ...Object.values(models)].map((m) => m.init()));
const actor = { id: String(new mongoose.Types.ObjectId()), name: 'משתמש בדיקות', role: 'finance_manager' };
const property = await Property.create({ name: 'מלון בדיקות — הנהלת חשבונות', legalName: 'חברת בדיקות בלבד', taxNumber: '123456789', address: 'רחוב בדיקה 1', city: 'חיפה', vatRate: 18 });
actor.propertyId = String(property._id);
await setupEntity({ propertyId: actor.propertyId, input: { legalName: property.legalName, taxId: property.taxNumber, address: property.address, city: property.city }, actor });
await seedAccounts({ propertyId: actor.propertyId, actor });
await createPeriod({ propertyId: actor.propertyId, month: '2026-10', actor });
const app = express();
app.use(express.json());
app.get('/api/pms/qa/bootstrap', (req, res) => res.json({ actor }));
app.get('/api/pms/properties', (req, res) => res.json({ success: true, data: [property] }));
app.use('/api/pms/accounting', (req, res, next) => { req.actor = actor; next(); }, accountingRouter);
app.use(errorHandler);
const server = app.listen(4897, '127.0.0.1', () => console.log('QA accounting API ready on loopback port 4897 (disposable data only)'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await mongoose.disconnect(); await repl.stop(); process.exit(0); });
