import mongoose from 'mongoose';

// No standalone fallback: a partial room move is worse than refusing the move.
export async function runStayTransaction(work, lease, { operation = 'מעבר חדר' } = {}) {
  const session = await mongoose.startSession();
  let effects = [];
  let result;
  try {
    result = await session.withTransaction(async () => {
      effects = []; // A driver retry must not replay notifications from an aborted attempt.
      const value = await work(session, effects);
      await lease.assertOwned(session);
      return value;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 15000 });
  } catch (err) {
    if (err?.code === 20 || String(err?.message || '').includes('Transaction numbers are only allowed')) {
      throw Object.assign(new Error(`${operation} מחייב מסד נתונים עם תמיכה בטרנזקציות`), { status: 503, code: 'STAY_TRANSACTIONS_REQUIRED', cause: err });
    }
    throw err;
  } finally {
    await session.endSession();
  }
  // The move has committed. A notification failure must not turn success into a failed move.
  for (const effect of effects) {
    try { await effect(); } catch (err) { console.error('[stay] post-commit notification failed:', err.message); }
  }
  return result;
}
