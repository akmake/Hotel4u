// Short DB-backed locks for read-check-write sequences (check-in, room assignment, selling the
// last room). A second concurrent request gets a clear 409 instead of interleaving with the first;
// the TTL frees a lock left behind by a crash.
import OperationLock from '../models/OperationLock.js';

function busyError() {
  const err = new Error('פעולה אחרת מתבצעת כרגע על אותה רשומה — נסו שוב בעוד רגע');
  err.status = 409;
  err.code = 'busy';
  return err;
}

// waitMs > 0 retries for a short while before giving up (used where two clerks selling at the
// same moment should queue, not fail).
export async function withLocks(keys, fn, { ttlMs = 30_000, waitMs = 0 } = {}) {
  const taken = [];
  try {
    for (const key of [...new Set(keys)].sort()) {
      const deadline = Date.now() + waitMs;
      for (;;) {
        await OperationLock.deleteOne({ key, expiresAt: { $lt: new Date() } });
        try {
          await OperationLock.create({ key, expiresAt: new Date(Date.now() + ttlMs) });
          break;
        } catch (err) {
          if (err?.code !== 11000) throw err;
          if (Date.now() >= deadline) throw busyError();
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      taken.push(key);
    }
    return await fn();
  } finally {
    if (taken.length) await OperationLock.deleteMany({ key: { $in: taken } }).catch(() => null);
  }
}
