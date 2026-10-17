import mongoose from 'mongoose';

// Fiscal writes must never be replayed outside the transaction on standalone MongoDB.
export async function runFiscalTransaction(work) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 15000 });
  } catch (err) {
    if (err?.code === 20 || String(err?.message || '').includes('Transaction numbers are only allowed on a replica set member or mongos')) {
      throw Object.assign(new Error('הנפקת מסמכים מחייבת מסד נתונים עם תמיכה בטרנזקציות (Replica Set)'), {
        status: 503, code: 'FISCAL_TRANSACTIONS_REQUIRED', cause: err,
      });
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
