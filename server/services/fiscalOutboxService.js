import { invoicerClient } from './invoicerClient.js';
import { randomUUID, createHash } from 'node:crypto';
import Invoice from '../models/Invoice.js';
import { FiscalOutbox, AccountingEvent, DocumentArtifact } from '../models/Accounting.js';
import { canonical } from '../domain/accounting.js';

// Internal recovery worker. External adapters must supply their own idempotency contract.
export async function archiveDocument(event) {
  const version = 'FISCAL_RECORD_JSON_V1';
  if (await DocumentArtifact.exists({ document: event.sourceId, version })) return;
  const doc = await Invoice.findOne({ _id: event.sourceId, property: event.property }).lean();
  if (!doc || doc.status === 'draft') throw new Error('Issued source document missing');
  // Freeze the fiscal content. Delivery/print/allocation retries do not change these bytes.
  const content = canonical({ version, documentId: String(doc._id), type: doc.type, number: doc.invoiceNumber, seq: doc.seq,
    issuedAt: doc.issuedAt, issueDate: doc.issueDate, taxDate: doc.taxDate, serviceDate: doc.serviceDate,
    seller: doc.seller, buyer: doc.buyer, lines: doc.lines, payments: doc.payments, currency: doc.currency,
    totalNet: doc.totalNet, totalVat: doc.totalVat, totalGross: doc.totalGross, totalDiscount: doc.totalDiscount,
    amountPaid: doc.amountPaid, balance: doc.balance, notes: doc.notes, moneyPolicy: doc.moneyPolicy,
    relatedInvoiceId: doc.relatedInvoiceId ? String(doc.relatedInvoiceId) : undefined,
  });
  try {
    await DocumentArtifact.create({ property: doc.property, document: doc._id, version, mime: 'application/json', content, sha256: createHash('sha256').update(content).digest('hex') });
  } catch (err) { if (err.code !== 11000) throw err; }
}
const HANDLERS = { 'integration.invoicer': event => invoicerClient().forwardEvent(event), 'document.archive': archiveDocument, 'accounting.journal_posted': async () => {} };
export async function processFiscalOutbox({ limit = 50, propertyId, handlers = HANDLERS } = {}) {
  let done = 0, failed = 0;
  // A lease token fences completion: an expired worker cannot complete another worker's claim.
  for (let i = 0; i < Math.min(Math.max(limit, 1), 500); i += 1) {
    const now = new Date(), token = randomUUID();
    const job = await FiscalOutbox.findOneAndUpdate({
      ...(propertyId ? { property: propertyId } : {}), topic: { $in: Object.keys(handlers) },
      $or: [{ state: 'pending', availableAt: { $lte: now } }, { state: 'processing', leaseUntil: { $lt: now } }],
    }, { $set: { state: 'processing', leaseToken: token, leaseUntil: new Date(now.getTime() + 60_000) }, $inc: { attempts: 1 } }, { sort: { availableAt: 1 }, returnDocument: 'after' });
    if (!job) break;
    try {
      const event = await AccountingEvent.findById(job.event).lean();
      if (!event || String(event.property) !== String(job.property)) throw new Error('Outbox event scope mismatch');
      await handlers[job.topic](event, job);
      await FiscalOutbox.updateOne({ _id: job._id, leaseToken: token, state: 'processing' }, { $set: { state: 'done', completedAt: new Date() }, $unset: { leaseToken: '', leaseUntil: '', lastError: '' } });
      done += 1;
    } catch {
      const exhausted = job.attempts >= 10;
      await FiscalOutbox.updateOne({ _id: job._id, leaseToken: token, state: 'processing' }, { $set: { state: exhausted ? 'failed' : 'pending', availableAt: new Date(Date.now() + Math.min(3600, 2 ** job.attempts) * 1000), lastError: 'Processing failed; inspect source record and retry' }, $unset: { leaseToken: '', leaseUntil: '' } });
      failed += 1;
    }
  }
  return { done, failed };
}
