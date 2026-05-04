import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';

const MAX_ATTEMPTS  = 5;
const RETRY_DELAYS  = [1, 5, 15, 60, 240]; // minutes after each failure

// ─── Write ──────────────────────────────────────────────────────────────────

export async function enqueueChannelUpdate({
  property, channel, eventType, payload, idempotencyKey,
}) {
  try {
    await ChannelUpdateQueue.create({
      property, channel, eventType, payload, idempotencyKey,
      status: 'pending', attempts: 0, nextAttemptAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) return; // idempotency key already exists — skip duplicate
    throw err;
  }
}

export async function markChannelEventSent(id) {
  await ChannelUpdateQueue.findByIdAndUpdate(id, {
    status: 'sent', sentAt: new Date(),
  });
}

export async function markChannelEventFailed(id, errorMsg) {
  const item = await ChannelUpdateQueue.findById(id);
  if (!item) return;

  const attempts = item.attempts + 1;
  const isDeadLetter = attempts >= MAX_ATTEMPTS;
  const delayMin = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)];
  const nextAttemptAt = isDeadLetter
    ? undefined
    : new Date(Date.now() + delayMin * 60 * 1000);

  await ChannelUpdateQueue.findByIdAndUpdate(id, {
    status:      isDeadLetter ? 'dead_letter' : 'failed',
    attempts,
    lastError:   errorMsg,
    nextAttemptAt,
  });
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getQueueStats(propertyId) {
  const counts = await ChannelUpdateQueue.aggregate([
    { $match: { property: propertyId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const stats = { pending: 0, processing: 0, sent: 0, failed: 0, dead_letter: 0 };
  counts.forEach(({ _id, count }) => { stats[_id] = count; });
  return stats;
}

// ─── Worker ──────────────────────────────────────────────────────────────────

/**
 * Pick up to `batchSize` due items and try to dispatch them.
 * `dispatch` is an async fn(item) → must throw on failure.
 * Returns { processed, succeeded, failed }
 */
export async function processQueue(propertyId, dispatch, { batchSize = 10 } = {}) {
  const now = new Date();
  const items = await ChannelUpdateQueue.find({
    property:      propertyId,
    status:        { $in: ['pending', 'failed'] },
    nextAttemptAt: { $lte: now },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(batchSize);

  if (items.length === 0) return { processed: 0, succeeded: 0, failed: 0 };

  // Claim items: set status=processing atomically per item
  const ids = items.map(i => i._id);
  await ChannelUpdateQueue.updateMany(
    { _id: { $in: ids }, status: { $in: ['pending', 'failed'] } },
    { $set: { status: 'processing' } }
  );

  let succeeded = 0, failed = 0;
  for (const item of items) {
    try {
      await dispatch(item);
      await markChannelEventSent(item._id);
      succeeded++;
    } catch (err) {
      await markChannelEventFailed(item._id, err.message);
      failed++;
    }
  }

  return { processed: items.length, succeeded, failed };
}

/**
 * Requeue dead-letter items (manual retry from admin UI).
 */
export async function requeueDeadLetters(propertyId) {
  const result = await ChannelUpdateQueue.updateMany(
    { property: propertyId, status: 'dead_letter' },
    { $set: { status: 'pending', attempts: 0, nextAttemptAt: new Date() } }
  );
  return result.modifiedCount;
}
