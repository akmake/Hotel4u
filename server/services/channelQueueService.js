import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';

export async function enqueueChannelUpdate({ propertyId, channel, eventType, payload, idempotencyKey }) {
  if (!propertyId || !channel || !eventType) throw new Error('propertyId, channel, eventType are required');

  if (idempotencyKey) {
    const exists = await ChannelUpdateQueue.findOne({ property: propertyId, channel, idempotencyKey });
    if (exists) return exists;
  }

  return ChannelUpdateQueue.create({
    property: propertyId,
    channel,
    eventType,
    payload,
    idempotencyKey,
    status: 'pending',
    attempts: 0,
  });
}

export async function markChannelEventSent(id) {
  return ChannelUpdateQueue.findByIdAndUpdate(
    id,
    { status: 'sent', sentAt: new Date() },
    { new: true }
  );
}

export async function markChannelEventFailed(id, errorMessage, retryInSeconds = 60) {
  return ChannelUpdateQueue.findByIdAndUpdate(
    id,
    {
      $inc: { attempts: 1 },
      $set: {
        status: 'failed',
        lastError: String(errorMessage || ''),
        nextAttemptAt: new Date(Date.now() + retryInSeconds * 1000),
      },
    },
    { new: true }
  );
}
