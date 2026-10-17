import { PaymentOperation, PaymentEvent, PaymentRefund } from '../models/Accounting.js';
import { entityContext, emitAccountingEvent, fiscalAudit } from './accountingService.js';
import { runFiscalTransaction } from './fiscalTransaction.js';
import { minor, amount } from '../domain/money.js';
import { payloadHash, assertPaymentTransition, PAYMENT_TRANSITIONS } from '../domain/accounting.js';

const providers = new Map();
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
// Adapters live in trusted server code. Credentials and raw card data never come from clients.
export function registerAccountingProvider(name, adapter) {
  for (const method of ['capture', 'query', 'refund', 'queryRefund']) if (typeof adapter[method] !== 'function') throw new Error(`Provider missing ${method}`);
  providers.set(name, adapter);
}
const providerOf = (name) => { const adapter = providers.get(name); if (!adapter) throw fail('ספק הסליקה טרם חובר ונבדק', 503); return adapter; };
const operationKey = (v) => {
  if (!/^[A-Za-z0-9_:-]{8,120}$/.test(String(v || ''))) throw fail('נדרש מזהה פעולה תקין');
  return String(v);
};
async function scopedPayment(propertyId, id, session) {
  const { entity } = await entityContext(propertyId, session);
  const payment = await PaymentOperation.findOne({ _id: id, property: propertyId, legalEntity: entity._id }).session(session || null);
  if (!payment) throw fail('התשלום לא נמצא', 404);
  return { payment, entity };
}
export async function createPaymentIntent({ propertyId, input, actor }) {
  const key = operationKey(input.idempotencyKey), value = minor(input.amount);
  if (value <= 0n) throw fail('נדרש סכום תשלום חיובי');
  const provider = String(input.provider || '');
  const adapter = providerOf(provider);
  const hash = payloadHash({ amount: amount(value), provider, currency: 'ILS', customerReference: String(input.customerReference || '') });
  return runFiscalTransaction(async (session) => {
    const { entity } = await entityContext(propertyId, session);
    if (entity.mode !== 'live' && !adapter.sandbox) throw fail('ספק חי חסום לפני השלמת שערי השחרור', 409);
    if (entity.mode === 'live' && adapter.sandbox) throw fail('ספק בדיקות אינו מתאים לפעילות אמת', 409);
    const existing = await PaymentOperation.findOne({ legalEntity: entity._id, operationKey: key }).session(session);
    if (existing) { if (existing.payloadHash !== hash || String(existing.property) !== propertyId) throw fail('מזהה הפעולה כבר שימש לתוכן אחר', 409); return existing; }
    const [payment] = await PaymentOperation.create([{ legalEntity: entity._id, property: propertyId, provider, operationKey: key, payloadHash: hash, amount: amount(value), customerReference: String(input.customerReference || '').slice(0, 200) }], { session });
    await fiscalAudit({ propertyId, actor, action: 'accounting.payment_intent', entityId: payment._id, after: { amount: payment.amount, provider } }, session);
    return payment;
  });
}
async function recordProviderState({ propertyId, id, result, actor }) {
  return runFiscalTransaction(async (session) => {
    const { payment } = await scopedPayment(propertyId, id, session);
    if (!PAYMENT_TRANSITIONS[result.state]) throw fail('ספק החזיר מצב לא מוכר', 502);
    assertPaymentTransition(payment.state, result.state);
    const previous = payment.state;
    payment.state = result.state;
    if (result.reference) payment.providerReference = String(result.reference).slice(0, 200);
    payment.lastReconciledAt = new Date();
    await payment.save({ session });
    if (previous !== payment.state) await emitAccountingEvent({ propertyId, legalEntity: payment.legalEntity, eventKey: `payment:${id}:${payment.state}`, type: `payment.${payment.state}`, sourceId: payment._id, payload: { amount: payment.amount, state: payment.state }, topics: ['accounting.review'] }, session);
    await fiscalAudit({ propertyId, actor, action: 'accounting.payment_state', entityId: payment._id, after: { previous, state: payment.state } }, session);
    return payment;
  });
}
export async function capturePayment({ propertyId, id, actor }) {
  const { payment } = await scopedPayment(propertyId, id);
  const adapter = providerOf(payment.provider);
  if (['captured', 'settled', 'partially_refunded', 'refunded'].includes(payment.state)) return payment;
  if (payment.state !== 'created') throw fail('תשלום במצב ממתין או לא ידוע מחייב בירור לפני חיוב נוסף', 409);
  // Persist the attempt before calling the provider; crash recovery queries it using this same ID.
  const claimed = await PaymentOperation.findOneAndUpdate({ _id: id, state: 'created' }, { $set: { state: 'pending' } }, { returnDocument: 'after' });
  if (!claimed) throw fail('פעולת חיוב כבר החלה', 409);
  let result;
  try { result = await adapter.capture({ operationId: String(payment._id), amount: payment.amount, currency: payment.currency }); }
  catch { result = { state: 'unknown' }; }
  return recordProviderState({ propertyId, id, actor, result });
}
export async function reconcilePayment({ propertyId, id, actor }) {
  const { payment } = await scopedPayment(propertyId, id);
  const adapter = providerOf(payment.provider);
  // A query is the only provider operation allowed after a timeout. Never capture again here.
  const result = await adapter.query({ operationId: String(payment._id), reference: payment.providerReference });
  return recordProviderState({ propertyId, id, actor, result });
}
export async function refundAccountingPayment({ propertyId, id, input, actor }) {
  const key = operationKey(input.idempotencyKey), cents = minor(input.amount);
  if (cents <= 0n || String(input.reason || '').trim().length < 3) throw fail('החזר מחייב סכום חיובי וסיבה');
  const hash = payloadHash({ payment: id, amount: amount(cents), reason: input.reason });
  const reserved = await runFiscalTransaction(async (session) => {
    const { payment } = await scopedPayment(propertyId, id, session);
    const existing = await PaymentRefund.findOne({ legalEntity: payment.legalEntity, operationKey: key }).session(session);
    if (existing) { if (existing.payloadHash !== hash || String(existing.property) !== propertyId) throw fail('מזהה ההחזר שימש לתוכן אחר', 409); return { refund: existing, duplicate: true, payment }; }
    if (!['captured', 'settled', 'partially_refunded'].includes(payment.state)) throw fail('התשלום אינו זמין להחזר', 409);
    if (minor(payment.refunded) + cents > minor(payment.amount)) throw fail('הסכום חורג מיתרת ההחזר');
    const [refund] = await PaymentRefund.create([{ legalEntity: payment.legalEntity, property: propertyId, payment: id, operationKey: key, payloadHash: hash, amount: amount(cents), reason: String(input.reason).slice(0, 500) }], { session });
    payment.refunded = amount(minor(payment.refunded) + cents); // Reserve pending and unknown refunds too.
    await payment.save({ session });
    return { refund, duplicate: false, payment };
  });
  if (reserved.duplicate) return reserved.refund;
  const adapter = providerOf(reserved.payment.provider);
  let result;
  try { result = await adapter.refund({ operationId: String(reserved.refund._id), paymentId: id, reference: reserved.payment.providerReference, amount: reserved.refund.amount }); }
  catch { result = { state: 'unknown' }; }
  return finishRefund({ propertyId, refundId: reserved.refund._id, result, actor });
}
async function finishRefund({ propertyId, refundId, result, actor }) {
  if (!['succeeded', 'failed', 'unknown', 'pending'].includes(result.state)) throw fail('מצב החזר לא מוכר', 502);
  return runFiscalTransaction(async (session) => {
    const refund = await PaymentRefund.findOne({ _id: refundId, property: propertyId }).session(session);
    if (!refund) throw fail('ההחזר לא נמצא', 404);
    if (['succeeded', 'failed'].includes(refund.state)) return refund;
    const { payment } = await scopedPayment(propertyId, refund.payment, session);
    refund.state = result.state; refund.providerReference = result.reference ? String(result.reference).slice(0, 200) : refund.providerReference;
    await refund.save({ session });
    if (result.state === 'failed') payment.refunded = amount(minor(payment.refunded) - minor(refund.amount));
    if (result.state === 'succeeded') {
      const unresolved = await PaymentRefund.countDocuments({ payment: payment._id, state: { $in: ['pending', 'unknown'] } }).session(session);
      payment.state = minor(payment.refunded) === minor(payment.amount) && !unresolved ? 'refunded' : 'partially_refunded';
      await emitAccountingEvent({ propertyId, legalEntity: payment.legalEntity, eventKey: `refund:${refundId}`, type: 'payment.refunded', sourceId: refund._id, payload: { paymentId: String(payment._id), amount: refund.amount }, topics: ['accounting.review'] }, session);
    }
    await payment.save({ session });
    await fiscalAudit({ propertyId, actor, action: 'accounting.refund_state', entityId: refund._id, after: { state: result.state, amount: refund.amount } }, session);
    return refund;
  });
}
export async function reconcileRefund({ propertyId, id, refundId, actor }) {
  const { payment } = await scopedPayment(propertyId, id);
  const refund = await PaymentRefund.findOne({ _id: refundId, payment: id, property: propertyId }).lean();
  if (!refund) throw fail('ההחזר לא נמצא', 404);
  const result = await providerOf(payment.provider).queryRefund({ operationId: String(refund._id), paymentId: id, reference: refund.providerReference });
  return finishRefund({ propertyId, refundId, actor, result });
}

export async function applyVerifiedPaymentEvent({ propertyId, id, verified, actor }) {
  if (!verified?.verifiedAt || !verified?.eventId || !verified?.occurredAt || !verified?.payloadHash) throw fail('אירוע ספק לא אומת', 401);
  // Called by a provider adapter after signature/freshness verification, never directly from API input.
  return runFiscalTransaction(async (session) => {
    const { payment } = await scopedPayment(propertyId, id, session);
    const existing = await PaymentEvent.findOne({ legalEntity: payment.legalEntity, provider: payment.provider, providerEventId: verified.eventId }).session(session);
    if (existing) { if (existing.payloadHash !== verified.payloadHash || String(existing.payment) !== String(id)) throw fail('אירוע ספק כפול עם תוכן שונה', 409); return { duplicate: true }; }
    if (!PAYMENT_TRANSITIONS[verified.state]) throw fail('מצב אירוע לא מוכר');
    await PaymentEvent.create([{ payment: id, legalEntity: payment.legalEntity, provider: payment.provider, providerEventId: verified.eventId, type: verified.state, amount: payment.amount, occurredAt: verified.occurredAt, verifiedAt: verified.verifiedAt, payloadHash: verified.payloadHash }], { session });
    // Late authorization is retained as evidence and cannot regress a captured payment.
    const applied = PAYMENT_TRANSITIONS[payment.state]?.includes(verified.state);
    if (applied) { payment.state = verified.state; await payment.save({ session }); }
    await fiscalAudit({ propertyId, actor, action: 'accounting.payment_event', entityId: payment._id, after: { providerEventId: verified.eventId, state: verified.state, applied } }, session);
    return { duplicate: false, applied };
  });
}
