const id = (v) => String(v?._id || v || '');
export const CRIB_ACTIVE_RES = ['confirmed', 'modified', 'pending_payment', 'in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'];
export const CRIB_ACTIVE_UNIT = ['reserved', 'checked_in', 'in_house'];
export function cribFacts(record, unit, reservation) {
  if (!record) return { requested: null, confirmed: null, status: 'not_recorded' };
  const needsReturn = record.outstandingQty > 0 && (!CRIB_ACTIVE_UNIT.includes(unit.status) || !CRIB_ACTIVE_RES.includes(reservation.status) || id(record.deliveryRoom) !== id(unit.assignedRoom) || record.requestedQty < record.outstandingQty);
  return { requested: record.requestedQty, confirmed: record.outstandingQty, delivered: record.outstandingQty, pending: Math.max(0, record.requestedQty - record.outstandingQty), revision: record.revision,
    status: needsReturn ? 'collection_required' : record.outstandingQty >= record.requestedQty ? (record.outstandingQty ? 'delivered' : 'none_requested') : record.outstandingQty ? 'partly_delivered' : 'requested', futureReserved: false };
}
