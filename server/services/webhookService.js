/**
 * פרק י"ט — Webhook Service
 * Delivers outbound webhook events to all active subscribers.
 * Signs payload with HMAC-SHA256 per subscriber secret.
 * Logs every delivery attempt in IntegrationLog.
 */
import crypto from 'crypto';
import WebhookSubscription from '../models/WebhookSubscription.js';
import IntegrationLog from '../models/IntegrationLog.js';

/**
 * emit(propertyId, eventType, payload)
 * Fire-and-forget webhook delivery for all subscribers of `eventType`.
 *
 * @param {string}  propertyId
 * @param {string}  eventType   - one of WEBHOOK_EVENTS
 * @param {object}  payload     - the event data
 */
export async function emit(propertyId, eventType, payload) {
  try {
    const subs = await WebhookSubscription.find({
      property: propertyId,
      active: true,
      events: eventType,
    }).lean();

    for (const sub of subs) {
      _deliver(propertyId, sub, eventType, payload).catch(() => null);
    }
  } catch {
    // swallow — webhook delivery is always best-effort
  }
}

// ── Internal delivery ─────────────────────────────────────────────────────────
async function _deliver(propertyId, sub, eventType, payload) {
  const body      = JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), data: payload });
  const signature = crypto.createHmac('sha256', sub.secret).update(body).digest('hex');
  const logEntry  = {
    property:    propertyId,
    source:      'webhook_delivery',
    destination: sub.url,
    eventType,
    direction:   'outbound',
    payloadId:   `${eventType}:${String(sub._id)}:${Date.now()}`,
    requestBody: { event: eventType, size: body.length },
    status:      'pending',
  };

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(sub.url, {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'X-Webhook-Event':    eventType,
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    logEntry.statusCode   = resp.status;
    logEntry.durationMs   = Date.now() - start;
    logEntry.responseBody = { status: resp.status };

    if (resp.ok) {
      logEntry.status = 'success';
      await WebhookSubscription.findByIdAndUpdate(sub._id, {
        lastDeliveredAt: new Date(),
        failureCount: 0,
      });
    } else {
      logEntry.status       = 'failed';
      logEntry.errorMessage = `HTTP ${resp.status}`;
      await WebhookSubscription.findByIdAndUpdate(sub._id, { $inc: { failureCount: 1 } });
    }
  } catch (err) {
    logEntry.status       = 'failed';
    logEntry.durationMs   = Date.now() - start;
    logEntry.errorMessage = err.message;
    await WebhookSubscription.findByIdAndUpdate(sub._id, { $inc: { failureCount: 1 } });
  }

  // Disable subscription after 5 consecutive failures
  if (logEntry.status === 'failed') {
    const sub2 = await WebhookSubscription.findById(sub._id).lean();
    if (sub2 && sub2.failureCount >= 5) {
      await WebhookSubscription.findByIdAndUpdate(sub._id, { active: false });
    }
  }

  await IntegrationLog.create(logEntry).catch(() => null);
}
