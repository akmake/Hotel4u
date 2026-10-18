import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

// Covers the legacy in-app numbering; live documents are issued by the invoicing system (qa:invoicer).
process.env.LEGACY_LOCAL_DOCUMENTS = '1';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import Property from '../models/Property.js';
import Invoice from '../models/Invoice.js';
import Folio from '../models/Folio.js';
import AuditLog from '../models/AuditLog.js';
import OperationLock from '../models/OperationLock.js';
import * as models from '../models/Accounting.js';
import { setupEntity, seedAccounts, createPeriod, postJournal, closePeriod, trialBalance, reverseJournal, recordCompliance, createTaxRule, resolveTaxRule, accountingOverview } from '../services/accountingService.js';
import { issueManualInvoice, issueCreditNote } from '../services/invoiceService.js';
import { issueDocument } from '../services/documentService.js';
import { processFiscalOutbox } from '../services/fiscalOutboxService.js';
import { registerAccountingProvider, createPaymentIntent, capturePayment, reconcilePayment, refundAccountingPayment, reconcileRefund, applyVerifiedPaymentEvent } from '../services/accountingPaymentService.js';
import { payloadHash } from '../domain/accounting.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import accountingRouter from '../routes/accounting.js';

test('accounting engine against isolated MongoDB Replica Set', { timeout: 240000 }, async (t) => {
  const repl = await createAccountingTestReplica();
  t.after(async () => { await mongoose.disconnect(); await repl.stop(); });
  await mongoose.connect(repl.getUri(), { dbName: `accounting_qa_${Date.now()}` });
  await Promise.all([Property, Invoice, Folio, AuditLog, OperationLock, ...Object.values(models)].map((m) => m.init()));
  const actor = { id: String(new mongoose.Types.ObjectId()), name: 'בודק', role: 'finance_manager' };
  const p = await Property.create({ name: 'מלון בדיקות', legalName: 'חברת בדיקות', taxNumber: '123456789', address: 'רחוב בדיקה 1', city: 'חיפה', vatRate: 18, timezone: 'Asia/Jerusalem' });
  const propertyId = String(p._id);
  await setupEntity({ propertyId, input: { legalName: p.legalName, taxId: p.taxNumber, address: p.address, city: p.city }, actor });
  await seedAccounts({ propertyId, actor });
  const period = await createPeriod({ propertyId, month: '2026-10', actor });
  const journal = (key, value = '1.00') => ({ propertyId, actor, input: { accountingDate: '2026-10-18', sourceEventId: key, description: 'בדיקה', lines: [{ accountCode: '1000', debit: value }, { accountCode: '1300', credit: value }] } });

  await t.test('source-event retries post exactly one balanced journal; changed payload is rejected', async () => {
    const [a, b] = await Promise.all([postJournal(journal('event:test:01')), postJournal(journal('event:test:01'))]);
    assert.equal(String(a.entry._id), String(b.entry._id));
    assert.equal(await models.JournalEntry.countDocuments({ sourceEventId: 'event:test:01' }), 1);
    await assert.rejects(postJournal(journal('event:test:01', '2.00')), (e) => e.status === 409);
    const tb = await trialBalance({ propertyId, from: '2026-10-01', to: '2026-10-31' });
    assert.equal(tb.totalDebit, '1.00'); assert.equal(tb.totalCredit, '1.00'); assert.equal(tb.balanced, true);
  });
  await t.test('full journal reversal is idempotent and preserves original', async () => {
    const original = await models.JournalEntry.findOne({ sourceEventId: 'event:test:01' }).lean();
    const input = { accountingDate: '2026-10-18', reason: 'תיקון בדיקה' };
    const a = await reverseJournal({ propertyId, id: original._id, input, actor });
    const b = await reverseJournal({ propertyId, id: original._id, input, actor });
    assert.equal(String(a.entry._id), String(b.entry._id));
    assert.equal((await trialBalance({ propertyId, from: '2026-10-01', to: '2026-10-31' })).rows.find((r) => r.code === '1000').balance, '0.00');
  });
  await t.test('locked month rejects new posting and cannot be silently reopened', async () => {
    await closePeriod({ propertyId, periodId: period._id, reason: 'סגירת בדיקה', actor });
    await assert.rejects(postJournal(journal('event:test:locked')), (e) => e.status === 409);
    await assert.rejects(createPeriod({ propertyId, month: '2026-10', actor }), (e) => e.status === 409);
    assert.equal((await models.AccountingPeriod.findById(period._id)).state, 'locked');
  });
  const issue = (description = 'לינה') => issueManualInvoice({ propertyId, type: 'tax_invoice', buyer: { name: 'אורח בדיקה' }, lines: [{ description, unitPrice: 100, quantity: 1 }], issuedBy: actor.id, idempotencyKey: randomUUID() });
  await t.test('DOC-T03: failure after numbering rolls back number, document, audit and outbox', async () => {
    const before = (await Property.findById(propertyId)).docSequences?.tax_invoice || 0;
    const count = await Invoice.countDocuments({ property: propertyId });
    const mock = t.mock.method(AuditLog, 'create', async () => { throw new Error('injected audit failure'); });
    try { await assert.rejects(issue('כשל מבוקר'), /injected audit/); } finally { mock.mock.restore(); }
    assert.equal((await Property.findById(propertyId)).docSequences?.tax_invoice || 0, before);
    assert.equal(await Invoice.countDocuments({ property: propertyId }), count);
    assert.equal(await models.AccountingEvent.countDocuments({ type: 'document.issued' }), 0);
  });
  await t.test('DOC-T01: concurrent issuance has unique contiguous sequence numbers', async () => {
    const docs = await Promise.all(Array.from({ length: 100 }, (_, i) => issue(`לינה ${i}`)));
    const seq = docs.map((d) => d.seq).sort((a, b) => a - b);
    assert.deepEqual(seq, Array.from({ length: 100 }, (_, i) => i + 1));
  });
  await t.test('DOC-T08: concurrent credits cannot exceed source-line remaining balance', async () => {
    const doc = await issue();
    const requests = await Promise.allSettled(Array.from({ length: 3 }, () => issueCreditNote({ originalInvoiceId: doc._id, creditAmount: '50', reason: 'זיכוי בדיקה', issuedBy: actor.id, idempotencyKey: randomUUID() })));
    assert.equal(requests.filter((r) => r.status === 'fulfilled').length, 2, requests.filter((r) => r.status === 'rejected').map((r) => r.reason.message).join('; '));
    const credits = await Invoice.find({ relatedInvoiceId: doc._id }).lean();
    assert.equal(credits.reduce((s, c) => s + Math.round(c.totalGross * 100), 0), -10000);
    assert.ok(credits.every((c) => c.lines.every((l) => l.sourceInvoiceLineId)));
  });
  await t.test('DOC-T02: manual and credit retries return the same document; changed request is rejected', async () => {
    const input = { propertyId, type: 'tax_invoice', buyer: { name: 'בדיקה' }, lines: [{ description: 'שירות', unitPrice: '100', quantity: 1 }], issuedBy: actor.id, idempotencyKey: randomUUID() };
    const [first, second] = await Promise.all([issueManualInvoice(input), issueManualInvoice(input)]);
    assert.equal(String(first._id), String(second._id));
    await assert.rejects(issueManualInvoice({ ...input, notes: 'changed' }), (e) => e.status === 409);
    const credit = { originalInvoiceId: first._id, creditAmount: '10', reason: 'זיכוי חוזר', issuedBy: actor.id, idempotencyKey: randomUUID() };
    const [a, b] = await Promise.all([issueCreditNote(credit), issueCreditNote(credit)]);
    assert.equal(String(a._id), String(b._id));
    await assert.rejects(issueCreditNote({ ...credit, creditAmount: '11' }), (e) => e.status === 409);
  });
  await t.test('Folio issuance retries preserve one document; changed payload returns 409', async () => {
    const f = await Folio.create({ property: propertyId, reservation: new mongoose.Types.ObjectId(), lines: [{ type: 'charge', description: 'חדר', amount: 100, taxAmount: 18, vatRate: 18, serviceDate: '2026-10-18' }] });
    const input = { type: 'tax_invoice', idempotencyKey: 'test_folio_issue_01', buyer: { kind: 'private', name: 'אורח בדיקה' } };
    const first = await issueDocument({ propertyId, folioId: String(f._id), input, actor });
    const second = await issueDocument({ propertyId, folioId: String(f._id), input, actor });
    assert.equal(first.id, second.id); assert.equal(second.duplicate, true);
    await assert.rejects(issueDocument({ propertyId, folioId: String(f._id), input: { ...input, notes: 'different' }, actor }), (e) => e.status === 409);
  });
  await t.test('DOC-T07: save status downgrade, query content mutation and deletion are blocked', async () => {
    const doc = await issue();
    doc.status = 'draft'; doc.totalGross = 0;
    await assert.rejects(doc.save(), /מסמך סופי/);
    await assert.rejects(Invoice.updateOne({ _id: doc._id }, { $set: { totalGross: 0 } }), /מסמך סופי/);
    await assert.rejects(Invoice.deleteOne({ _id: doc._id }), /מסמך סופי/);
    await assert.rejects(doc.deleteOne(), /מסמך סופי/);
    await assert.rejects(Invoice.bulkWrite([{ updateOne: { filter: { _id: doc._id }, update: { $set: { totalGross: 0 } } } }]), /מסמך סופי/);
    assert.equal((await Invoice.findById(doc._id)).totalGross, 118);
  });
  await t.test('DR-T02: archive worker replay preserves exactly one artifact and identical bytes', async () => {
    const doc = await issue();
    await processFiscalOutbox({ propertyId, limit: 500 });
    const first = await models.DocumentArtifact.findOne({ document: doc._id }).lean();
    assert.ok(first); assert.equal(first.signatureStatus, 'unsigned');
    await models.FiscalOutbox.updateMany({ property: propertyId, topic: 'document.archive' }, { $set: { state: 'pending', availableAt: new Date(0) } });
    await processFiscalOutbox({ propertyId, limit: 500 });
    const again = await models.DocumentArtifact.find({ document: doc._id }).lean();
    assert.equal(again.length, 1); assert.equal(first.content, again[0].content); assert.equal(first.sha256, again[0].sha256);
  });
  let captureCalls = 0, queryCalls = 0, refundCalls = 0;
  registerAccountingProvider('qa', { sandbox: true,
    capture: async () => { captureCalls += 1; throw new Error('timeout after successful provider capture'); },
    query: async () => { queryCalls += 1; return { state: 'captured', reference: 'qa-capture' }; },
    refund: async () => { refundCalls += 1; return { state: 'unknown' }; },
    queryRefund: async () => ({ state: 'succeeded', reference: 'qa-refund' }),
  });
  let payment;
  await t.test('PAY-T02: timeout becomes unknown; recovery queries instead of charging again', async () => {
    payment = await createPaymentIntent({ propertyId, input: { provider: 'qa', amount: '100.00', idempotencyKey: 'payment:qa:01' }, actor });
    assert.equal((await capturePayment({ propertyId, id: payment._id, actor })).state, 'unknown');
    await assert.rejects(capturePayment({ propertyId, id: payment._id, actor }), (e) => e.status === 409);
    assert.equal((await reconcilePayment({ propertyId, id: payment._id, actor })).state, 'captured');
    assert.equal(captureCalls, 1); assert.equal(queryCalls, 1);
  });
  await t.test('PAY-T04: unknown refund reserves the balance; duplicate request does not call provider twice', async () => {
    const input = { amount: '60', reason: 'החזר בדיקה', idempotencyKey: 'refund:qa:01' };
    const first = await refundAccountingPayment({ propertyId, id: payment._id, input, actor });
    const again = await refundAccountingPayment({ propertyId, id: payment._id, input, actor });
    assert.equal(String(first._id), String(again._id)); assert.equal(refundCalls, 1);
    await assert.rejects(refundAccountingPayment({ propertyId, id: payment._id, input: { ...input, amount: '50', idempotencyKey: 'refund:qa:02' }, actor }), (e) => e.status === 422);
    await reconcileRefund({ propertyId, id: payment._id, refundId: first._id, actor });
    assert.equal((await models.PaymentOperation.findById(payment._id)).state, 'partially_refunded');
  });
  await t.test('PAY-T01: verified duplicate and late authorization never regress a captured payment', async () => {
    const p2 = await createPaymentIntent({ propertyId, input: { provider: 'qa', amount: '1.00', idempotencyKey: 'payment:qa:02' }, actor });
    await capturePayment({ propertyId, id: p2._id, actor }); await reconcilePayment({ propertyId, id: p2._id, actor });
    const verified = { verifiedAt: new Date(), occurredAt: new Date(), eventId: 'late-auth', state: 'authorized', payloadHash: payloadHash({ id: 'late-auth' }) };
    const a = await applyVerifiedPaymentEvent({ propertyId, id: p2._id, verified, actor });
    const b = await applyVerifiedPaymentEvent({ propertyId, id: p2._id, verified, actor });
    assert.equal(a.applied, false); assert.equal(b.duplicate, true);
    assert.equal((await models.PaymentOperation.findById(p2._id)).state, 'captured');
  });
  await t.test('SEC-T01: API blocks anonymous users, read-only writes and cross-property access', async () => {
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { if (req.headers['x-qa-role']) req.actor = { ...actor, propertyId: req.headers['x-qa-property'] || propertyId, role: req.headers['x-qa-role'] }; next(); });
    app.use('/accounting', accountingRouter);
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}/accounting`;
      assert.equal((await fetch(`${base}?propertyId=${propertyId}`)).status, 401);
      assert.equal((await fetch(`${base}?propertyId=${new mongoose.Types.ObjectId()}`, { headers: { 'x-qa-role': 'finance_manager' } })).status, 403);
      assert.equal((await fetch(`${base}/periods`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-qa-role': 'auditor' }, body: JSON.stringify({ propertyId, month: '2026-11' }) })).status, 403);
      const overview = await fetch(`${base}?propertyId=${propertyId}`, { headers: { 'x-qa-role': 'auditor' } });
      assert.equal(overview.status, 200);
      const body = await overview.json(); assert.equal(body.data.entity.mode, 'shadow'); assert.equal(body.data.readyForLive, false);
      assert.equal((await fetch(`${base}/compliance`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-qa-role': 'property_admin' }, body: JSON.stringify({ propertyId }) })).status, 403);
      const other = await Property.create({ name: 'נכס אחר', address: 'בדיקה', city: 'בדיקה' });
      const issued = await Invoice.findOne({ property: propertyId }).lean();
      // An authenticated user assigned to the other property cannot retrieve this artifact.
      assert.equal((await fetch(`${base}/documents/${issued._id}/artifact?propertyId=${other._id}`, { headers: { 'x-qa-role': 'finance_manager', 'x-qa-property': String(other._id) } })).status, 404);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
  await t.test('tax decisions require current professional evidence and reject missing or ambiguous rules', async () => {
    const scope = { code: 'QA_STANDARD', serviceCategory: 'rooms', customerClassification: 'private', serviceDate: '2026-10-18' };
    await assert.rejects(resolveTaxRule({ propertyId, input: scope }), (e) => e.status === 409);
    await assert.rejects(recordCompliance({ propertyId, actor, input: { requirementId: 'TAX_TIMING', status: 'APPROVED' } }), (e) => e.status === 422);
    const decision = await recordCompliance({ propertyId, actor, input: { requirementId: 'TAX_TIMING', status: 'APPROVED', professionalName: 'בודק QA בלבד', legalSource: 'qa-only-source', sourceVersion: 'qa-v1', evidenceReference: 'disposable-test-evidence', rationale: 'אישור דמה לבדיקות בלבד', validFrom: '2026-01-01', reviewDue: '2099-01-01' } });
    const rule = { ...scope, version: '1', classification: 'standard', rate: '18', validFrom: '2026-01-01', decisionId: decision._id };
    await createTaxRule({ propertyId, actor, input: rule });
    const result = await resolveTaxRule({ propertyId, input: scope });
    assert.equal(result.ratePercent, '18'); assert.equal(result.version, '1');
    await createTaxRule({ propertyId, actor, input: { ...rule, version: '2' } });
    await assert.rejects(resolveTaxRule({ propertyId, input: scope }), /יותר מכלל/);
    await recordCompliance({ propertyId, actor, input: { requirementId: 'SIGNING', status: 'APPROVED', professionalName: 'QA', legalSource: 'QA', sourceVersion: 'QA', evidenceReference: 'QA', rationale: 'בדיקת אישור עתידי', validFrom: '2098-01-01', reviewDue: '2099-01-01' } });
    assert.equal((await accountingOverview(propertyId)).gates.find((g) => g.id === 'SIGNING').status, 'UNRESOLVED');
  });
});
