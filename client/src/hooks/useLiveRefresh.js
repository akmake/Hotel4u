// PMS live updates: one shared Socket.IO connection (namespace /pms, signed in with the PMS token, joined
// to the selected property). A screen passes the entity types it shows; when one of them changes in the
// property (another clerk, the scheduler) the screen reloads through the API, debounced. Polling stays
// as the fallback when the socket is down.
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace(/\/api\/?$/, '') : window.location.origin;
let shared = null;
let sharedKey = '';
const listeners = new Set();

function connect(propertyId) {
  const token = localStorage.getItem('hotel4u_token');
  const key = `${token}|${propertyId}`;
  if (shared && sharedKey === key) return shared;
  if (shared) shared.disconnect();
  sharedKey = key;
  shared = io(`${SERVER}/pms`, { auth: { token, propertyId }, transports: ['websocket', 'polling'], reconnectionDelay: 2000, reconnectionDelayMax: 30000 });
  shared.on('pms:change', (msg) => { for (const fn of listeners) fn(msg); });
  return shared;
}

export function useLiveRefresh(propertyId, entities, reload, { delay = 1200 } = {}) {
  const fn = useRef(reload);
  fn.current = reload;
  const want = (entities || []).join('|');
  useEffect(() => {
    if (!propertyId || !localStorage.getItem('hotel4u_token')) return undefined;
    connect(String(propertyId));
    let timer = null;
    const set = new Set(want.split('|').filter(Boolean));
    const listener = (msg) => {
      if (set.size && !set.has(msg?.entity)) return;
      clearTimeout(timer);
      timer = setTimeout(() => fn.current?.(), delay);
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); clearTimeout(timer); };
  }, [propertyId, want, delay]);
}
