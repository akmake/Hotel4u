import { Router } from 'express';
import mongoose from 'mongoose';
import { requireRoles, assertPropertyScope } from '../middleware/authContext.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { accountingOverview, setupEntity, recordCompliance, seedAccounts, createPeriod, postJournal, closePeriod, reverseJournal, trialBalance, createSeries, createTaxRule, resolveTaxRule } from '../services/accountingService.js';
import { processFiscalOutbox } from '../services/fiscalOutboxService.js';
import { DocumentArtifact } from '../models/Accounting.js';
import { createHash } from 'node:crypto';
import { createPaymentIntent, capturePayment, reconcilePayment, refundAccountingPayment, reconcileRefund } from '../services/accountingPaymentService.js';
import { PaymentOperation } from '../models/Accounting.js';

const router = Router();
const WRITE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const READ = [...WRITE, 'auditor', 'owner_readonly'];
const PROFESSIONAL_RECORD = ['super_admin', 'chain_admin', 'finance_manager'];
function context(req, roles) {
  requireRoles(req, roles);
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor.propertyId;
  if (!mongoose.isValidObjectId(propertyId)) throw Object.assign(new Error('יש לבחור נכס'), { status: 400 });
  assertPropertyScope(req, String(propertyId));
  return { propertyId: String(propertyId), actor: req.actor, input: req.body || {} };
}
const handle = (fn, roles = WRITE) => asyncHandler(async (req, res) => {
  const ctx = context(req, roles);
  for (const id of Object.values(req.params)) if (!mongoose.isValidObjectId(id)) throw Object.assign(new Error('מזהה רשומה לא תקין'), { status: 400 });
  const data = await fn(ctx, req);
  res.json({ success: true, data });
});
router.get('/', handle(({ propertyId }) => accountingOverview(propertyId), READ));
router.post('/legal-entity', handle(setupEntity));
router.post('/accounts/initialize', handle(seedAccounts));
router.post('/periods', handle((ctx) => createPeriod({ ...ctx, month: ctx.input.month })));
router.post('/periods/:id/close', handle((ctx, req) => closePeriod({ ...ctx, periodId: req.params.id, reason: ctx.input.reason })));
router.post('/journals', handle(postJournal));
router.post('/journals/:id/reverse', handle((ctx, req) => reverseJournal({ ...ctx, id: req.params.id })));
router.get('/trial-balance', handle((ctx, req) => trialBalance({ ...ctx, from: req.query.from, to: req.query.to }), READ));
router.post('/series', handle(createSeries));
router.post('/compliance', handle(recordCompliance, PROFESSIONAL_RECORD));
router.post('/tax-rules', handle(createTaxRule, PROFESSIONAL_RECORD));
router.post('/tax-rules/resolve', handle(resolveTaxRule, READ));
router.post('/recovery/run', handle(({ propertyId }) => processFiscalOutbox({ propertyId })));
router.post('/payment-intents', handle(createPaymentIntent));
router.post('/payments/:id/capture', handle((ctx, req) => capturePayment({ ...ctx, id: req.params.id })));
router.post('/payments/:id/reconcile', handle((ctx, req) => reconcilePayment({ ...ctx, id: req.params.id })));
router.post('/payments/:id/refund', handle((ctx, req) => refundAccountingPayment({ ...ctx, id: req.params.id })));
router.post('/payments/:id/refunds/:refundId/reconcile', handle((ctx, req) => reconcileRefund({ ...ctx, id: req.params.id, refundId: req.params.refundId })));
router.get('/payments', handle(({ propertyId }) => PaymentOperation.find({ property: propertyId }).sort({ createdAt: -1 }).limit(100).lean(), READ));
router.get('/documents/:id/artifact', asyncHandler(async (req, res) => {
  const { propertyId } = context(req, READ);
  if (!mongoose.isValidObjectId(req.params.id)) throw Object.assign(new Error('מזהה מסמך לא תקין'), { status: 400 });
  const artifact = await DocumentArtifact.findOne({ property: propertyId, document: req.params.id, version: 'FISCAL_RECORD_JSON_V1' }).lean();
  if (!artifact) throw Object.assign(new Error('עותק הארכיון טרם נוצר'), { status: 404 });
  if (createHash('sha256').update(artifact.content).digest('hex') !== artifact.sha256) throw Object.assign(new Error('אימות שלמות הארכיון נכשל'), { status: 409 });
  res.set('Content-Type', artifact.mime).set('Content-Disposition', `attachment; filename="document-${req.params.id}.json"`).set('X-Content-SHA256', artifact.sha256).send(artifact.content);
}));
export default router;
