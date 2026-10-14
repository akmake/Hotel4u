// Charge codes and payment methods of the active property (ADM-13, gap G1). Posting dialogs read
// them from the server instead of a hard-coded list; the server re-checks every code anyway.
// One fetch per property per page load, refreshed after the catalogue is edited.
import { useEffect, useState } from 'react';
import { finance } from '../utils/api';

const cache = new Map();

export function invalidateChargeCodes(propertyId) {
  if (propertyId) cache.delete(propertyId); else cache.clear();
}

export function useChargeCodes(propertyId) {
  const [state, setState] = useState(() => cache.get(propertyId) || { charges: [], payments: [], loading: !!propertyId, error: null });
  useEffect(() => {
    let alive = true;
    if (!propertyId) return undefined;
    if (cache.has(propertyId)) { setState(cache.get(propertyId)); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    finance.codes(propertyId).then((data) => {
      const codes = data?.codes || [];
      const next = { charges: codes.filter((c) => c.kind === 'charge'), payments: codes.filter((c) => c.kind === 'payment'), revenueGroups: data?.revenueGroups || {}, loading: false, error: null };
      cache.set(propertyId, next);
      if (alive) setState(next);
    }).catch((e) => { if (alive) setState({ charges: [], payments: [], loading: false, error: e }); });
    return () => { alive = false; };
  }, [propertyId]);
  return state;
}

// Codes a person may pick for a manual charge (the lodging code is posted by the system only).
export const manualCodes = (charges) => charges.filter((c) => c.active && c.postLevel !== 'system');
