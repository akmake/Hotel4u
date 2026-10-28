import { withLocks } from './locks.js';
import { runStayTransaction } from './stayTransaction.js';
export function financialWrite(key, work, propertyId = null) {
  return withLocks([key, ...(propertyId ? [`dayclose:${propertyId}`] : [])], (lease) => runStayTransaction((session, afterCommit) => {
    if (propertyId) session.financialDayCloseLease = lease;
    return work(session, afterCommit);
  }, lease, { operation: 'רישום כספי' }), { waitMs: 4000 });
}
