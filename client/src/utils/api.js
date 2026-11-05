import axios from 'axios';

// ── Axios instance (default export) — used by ziporiclass pages ───────────────
// Uses withCredentials for HttpOnly cookie auth + CSRF support
const axiosApi = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// CSRF token management
let csrfPromise = null;
const fetchCsrf = () => {
  if (!csrfPromise) {
    csrfPromise = axiosApi.get('/csrf-token')
      .then(r => {
        const token = r.data?.csrfToken;
        if (token) axiosApi.defaults.headers.common['X-CSRF-Token'] = token;
        return token;
      })
      .catch(() => { csrfPromise = null; });
  }
  return csrfPromise;
};

axiosApi.interceptors.request.use(async (config) => {
  if (['post','put','patch','delete'].includes(config.method)) await fetchCsrf();
  return config;
});

export default axiosApi;

export const accounting = {
  overview: (propertyId) => request('GET', `/accounting?propertyId=${encodeURIComponent(propertyId)}`),
  setup: (propertyId, body) => request('POST', '/accounting/legal-entity', { ...body, propertyId }),
  initializeAccounts: (propertyId) => request('POST', '/accounting/accounts/initialize', { propertyId }),
  openPeriod: (propertyId, month) => request('POST', '/accounting/periods', { propertyId, month }),
  closePeriod: (propertyId, id, reason) => request('POST', `/accounting/periods/${id}/close`, { propertyId, reason }),
  postJournal: (propertyId, body) => request('POST', '/accounting/journals', { ...body, propertyId }),
  reverseJournal: (propertyId, id, body) => request('POST', `/accounting/journals/${id}/reverse`, { ...body, propertyId }),
  trialBalance: (propertyId, from, to) => request('GET', `/accounting/trial-balance?${new URLSearchParams({ propertyId, from, to })}`),
  createSeries: (propertyId, body) => request('POST', '/accounting/series', { ...body, propertyId }),
  recordCompliance: (propertyId, body) => request('POST', '/accounting/compliance', { ...body, propertyId }),
  recover: (propertyId) => request('POST', '/accounting/recovery/run', { propertyId }),
};

// ── Legacy fetch-based helpers (named exports) — used by hotel4u PMS pages ───
const PMS_BASE  = '/api/pms'; // PMS routes (hotel4u) — ראוטר נפרד ב-app.js
const AUTH_BASE = '/api';     // Auth routes (זהה לשני הצדדים)

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function getToken() {
  return localStorage.getItem('hotel4u_token');
}

async function request(method, path, body) {
  const token = getToken();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${PMS_BASE}${path}`, opts);
  if (res.status === 401) {
    endSessionAndRedirect();
    throw new Error('פג תוקף ההתחברות — יש להתחבר מחדש');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    if (data.fields) err.fields = data.fields;   // field-level validation messages
    if (data.details) err.details = data.details; // per-record reasons (e.g. per stay unit)
    if (data.code) err.code = data.code;
    throw err;
  }
  return data.data;
}

// Multipart upload to the PMS (photos). Same auth and error shape as request().
async function uploadForm(path, form) {
  const token = getToken();
  const res = await fetch(`${PMS_BASE}${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (res.status === 401) { endSessionAndRedirect(); throw new Error('פג תוקף ההתחברות — יש להתחבר מחדש'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; if (data.fields) err.fields = data.fields; throw err; }
  return data.data;
}

// Expired/invalid PMS session: clear local auth state and send the user to login,
// remembering the page they were on.
let redirecting = false;
function endSessionAndRedirect() {
  if (redirecting || window.location.pathname.startsWith('/login')) return;
  redirecting = true;
  localStorage.removeItem('hotel4u_token');
  localStorage.removeItem('user');
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

async function authRequest(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${AUTH_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

function qs(params) {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? '&' + new URLSearchParams(p).toString() : '';
}

export const api = {
  get:    (path)       => request('GET',    path),
  post:   (path, body) => request('POST',   path, body),
  put:    (path, body) => request('PUT',    path, body),
  patch:  (path, body) => request('PATCH',  path, body),
  delete: (path)       => request('DELETE', path),
  // A protected file (e.g. a profile attachment) as a Blob, with the bearer token.
  blob: async (path) => { const token = getToken(); const res = await fetch(`${PMS_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' }); if (!res.ok) throw new Error('הקובץ לא נפתח'); return res.blob(); },
};

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  login:          (email, password) => authRequest('POST', '/auth/login', { email, password }),
  logout:         ()                => authRequest('POST', '/auth/logout', {}),
  me:             ()                => authRequest('GET',  '/auth/me'),
  refresh:        (refreshToken)    => authRequest('POST', '/auth/refresh', { refreshToken }),
  changePassword: (current, next)   => authRequest('POST', '/auth/change-password', { currentPassword: current, newPassword: next }),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const dashboard = {
  stats:      (propertyId) => api.get(`/dashboard/stats?propertyId=${propertyId}`),
  arrivals:   (propertyId) => api.get(`/dashboard/arrivals?propertyId=${propertyId}`),
  departures: (propertyId) => api.get(`/dashboard/departures?propertyId=${propertyId}`),
  inhouse:    (propertyId) => api.get(`/dashboard/inhouse?propertyId=${propertyId}`),
  alerts:     (propertyId) => api.get(`/dashboard/alerts?propertyId=${propertyId}`),
};

// ── Front desk: arrivals, check-in, room assignment, waiting queue ───────────
export const frontdesk = {
  // Home screen & quick looks (gap-map item 8)
  homeCounters:   (propertyId) => api.get(`/frontdesk/home/counters?propertyId=${propertyId}`),
  homeWeek:       (propertyId, params = {}) => api.get(`/frontdesk/home/week?propertyId=${propertyId}${qs(params)}`),
  homeHouse:      (propertyId, params = {}) => api.get(`/frontdesk/home/house?propertyId=${propertyId}${qs(params)}`),
  freeRooms:      (propertyId, params = {}) => api.get(`/frontdesk/home/free-rooms?propertyId=${propertyId}${qs(params)}`),
  turnAway:       (propertyId, body) => api.post('/frontdesk/home/turnaways', { ...body, propertyId }),
  cribDesk:       (propertyId, q) => api.get(`/frontdesk/cribs?propertyId=${propertyId}${qs({ q })}`),
  cribContext:    (propertyId, id, unitId) => api.get(`/frontdesk/reservations/${id}/units/${unitId}/cribs?propertyId=${propertyId}`),
  cribAction:     (propertyId, id, unitId, body) => api.post(`/frontdesk/reservations/${id}/units/${unitId}/cribs`, { ...body, propertyId }),
  cribStock:      (propertyId, body) => api.post('/frontdesk/cribs/stock', { ...body, propertyId }),
  arrivals:        (propertyId, params = {}) => api.get(`/frontdesk/arrivals?propertyId=${propertyId}${qs(params)}`),
  setEta:          (propertyId, resId, eta)  => api.patch(`/frontdesk/reservations/${resId}/eta`, { propertyId, eta }),
  noShow:          (propertyId, resId)       => api.post(`/frontdesk/reservations/${resId}/no-show`, { propertyId }),
  nonGuaranteed:   (propertyId)              => api.get(`/frontdesk/arrivals/non-guaranteed?propertyId=${propertyId}`),
  releaseNonGuaranteed: (propertyId, ids)    => api.post('/frontdesk/arrivals/release-non-guaranteed', { propertyId, ids }),
  checkInContext:  (propertyId, resId)       => api.get(`/frontdesk/reservations/${resId}/check-in?propertyId=${propertyId}`),
  saveRegistration:(propertyId, resId, body) => api.post(`/frontdesk/reservations/${resId}/registration`, { ...body, propertyId }),
  checkIn:         (propertyId, resId, body) => api.post(`/frontdesk/reservations/${resId}/check-in`, { ...body, propertyId }),
  roomCandidates:  (propertyId, resId, params = {}) => api.get(`/frontdesk/reservations/${resId}/room-candidates?propertyId=${propertyId}${qs(params)}`),
  assignRoom:      (propertyId, resId, body) => api.post(`/frontdesk/reservations/${resId}/assign-room`, { ...body, propertyId }),
  roomPlan:        (propertyId, date)        => api.get(`/frontdesk/room-plan?propertyId=${propertyId}${qs({ date })}`),
  onlineCheckIn:   (propertyId, resId)       => api.get(`/frontdesk/reservations/${resId}/online-checkin?propertyId=${propertyId}`),
  onlineCheckInLink: (propertyId, resId, via) => api.post(`/frontdesk/reservations/${resId}/online-checkin/link`, { propertyId, via }),
  decideUpsell:    (propertyId, resId, upsellId, decision, reason) => api.post(`/frontdesk/reservations/${resId}/online-checkin/upsells/${upsellId}`, { propertyId, decision, reason }),
  applyRoomPlan:   (propertyId, items)       => api.post('/frontdesk/room-plan/apply', { propertyId, items }),
  staff:           (propertyId)              => api.get(`/frontdesk/staff?propertyId=${propertyId}`),
  queue:           (propertyId, status)      => api.get(`/frontdesk/queue?propertyId=${propertyId}${qs({ status })}`),
  addToQueue:      (propertyId, body)        => api.post('/frontdesk/queue', { ...body, propertyId }),
  takeQueue:       (propertyId, id, version) => api.post(`/frontdesk/queue/${id}/take`, { propertyId, version }),
  updateQueue:     (propertyId, id, body)    => api.patch(`/frontdesk/queue/${id}`, { ...body, propertyId }),
  prioritizeQueue: (propertyId, id)          => api.post(`/frontdesk/queue/${id}/prioritize`, { propertyId }),
  removeFromQueue: (propertyId, id, reason, version) => api.post(`/frontdesk/queue/${id}/remove`, { propertyId, reason, version }),
  inHouse:         (propertyId, params = {}) => api.get(`/frontdesk/in-house?propertyId=${propertyId}${qs(params)}`),
  departures:      (propertyId, params = {}) => api.get(`/frontdesk/departures?propertyId=${propertyId}${qs(params)}`),
  setEtd:          (propertyId, resId, etd)  => api.patch(`/frontdesk/reservations/${resId}/etd`, { propertyId, etd }),
  roomBilling:     (propertyId, resId, unitIndex, body) => api.patch(`/frontdesk/reservations/${resId}/units/${unitIndex}/billing`, { ...body, propertyId }),
  groupBilling:    (propertyId, resId, mode)  => api.post(`/frontdesk/reservations/${resId}/billing`, { propertyId, mode }),
  checkOutContext: (propertyId, resId)       => api.get(`/frontdesk/reservations/${resId}/check-out?propertyId=${propertyId}`),
  checkOut:        (propertyId, resId, body) => api.post(`/frontdesk/reservations/${resId}/check-out`, { ...body, propertyId }),
  postCharge:      (propertyId, resId, body) => api.post(`/frontdesk/reservations/${resId}/charges`, { ...body, propertyId }),
  postNights:      (propertyId, resId)       => api.post(`/frontdesk/reservations/${resId}/post-nights`, { propertyId }),
  payFolio:        (propertyId, folioId, body) => api.post(`/frontdesk/folios/${folioId}/payments`, { ...body, propertyId }),
  refundFolio:     (propertyId, folioId, body) => api.post(`/frontdesk/folios/${folioId}/refunds`, { ...body, propertyId }),
};

// ── Operations: housekeeping, room status, inspection, lost & found, maintenance (OPS-01…06) ──
const withP = (propertyId, body = {}) => ({ ...body, propertyId });
export const setup = {
  get:            (propertyId)              => api.get(`/setup?propertyId=${propertyId}`),
  updateProperty: (propertyId, body)        => api.patch('/setup/property', withP(propertyId, body)),
  createType:     (propertyId, body)        => api.post('/setup/room-types', withP(propertyId, body)),
  updateType:     (propertyId, id, body)    => api.patch(`/setup/room-types/${id}`, withP(propertyId, body)),
  addRooms:       (propertyId, body)        => api.post('/setup/rooms', withP(propertyId, body)),
  updateRoom:     (propertyId, id, body)    => api.patch(`/setup/rooms/${id}`, withP(propertyId, body)),
  typePhoto:      (propertyId, id, file)    => { const f = new FormData(); f.append('photo', file); return uploadForm(`/setup/room-types/${id}/photos?propertyId=${propertyId}`, f); },
  typePhotos:     (propertyId, id, images)  => api.put(`/setup/room-types/${id}/photos`, withP(propertyId, { images })),
  online:         (propertyId)              => api.get(`/setup/online-booking?propertyId=${propertyId}`),
  saveOnline:     (propertyId, body)        => api.put('/setup/online-booking', withP(propertyId, body)),
  checkin:        (propertyId)              => api.get(`/setup/online-checkin?propertyId=${propertyId}`),
  statements:     (propertyId)              => api.get(`/setup/public-statements?propertyId=${propertyId}`),
  saveStatements: (propertyId, body)        => api.put('/setup/public-statements', withP(propertyId, body)),
  saveCheckin:    (propertyId, body)        => api.put('/setup/online-checkin', withP(propertyId, body)),
};

export const ops = {
  board:          (propertyId, params = {}) => api.get(`/ops/board?propertyId=${propertyId}${qs(params)}`),
  generate:       (propertyId, date)        => api.post('/ops/tasks/generate', withP(propertyId, { date })),
  createTask:     (propertyId, body)        => api.post('/ops/tasks', withP(propertyId, body)),
  assign:         (propertyId, taskIds, assigneeId) => api.post('/ops/tasks/assign', withP(propertyId, { taskIds, assigneeId })),
  priority:       (propertyId, id, priority, reason) => api.post(`/ops/tasks/${id}/priority`, withP(propertyId, { priority, reason })),
  cancelTask:     (propertyId, id, reason)  => api.post(`/ops/tasks/${id}/cancel`, withP(propertyId, { reason })),
  myTasks:        (propertyId, params = {}) => api.get(`/ops/my-tasks?propertyId=${propertyId}${qs(params)}`),
  start:          (propertyId, id)          => api.post(`/ops/tasks/${id}/start`, withP(propertyId)),
  pause:          (propertyId, id, reason, note) => api.post(`/ops/tasks/${id}/pause`, withP(propertyId, { reason, note })),
  dnd:            (propertyId, id, on)      => api.post(`/ops/tasks/${id}/dnd`, withP(propertyId, { on })),
  complete:       (propertyId, id, checklist, note) => api.post(`/ops/tasks/${id}/complete`, withP(propertyId, { checklist, note })),
  inspections:    (propertyId)              => api.get(`/ops/inspections?propertyId=${propertyId}`),
  inspect:        (propertyId, id, body)    => api.post(`/ops/tasks/${id}/inspect`, withP(propertyId, body)),
  rooms:          (propertyId, params = {}) => api.get(`/ops/rooms?propertyId=${propertyId}${qs(params)}`),
  setClean:       (propertyId, roomId, body) => api.post(`/ops/rooms/${roomId}/clean-status`, withP(propertyId, body)),
  unblock:        (propertyId, roomId, reason) => api.post(`/ops/rooms/${roomId}/unblock`, withP(propertyId, { reason })),
  roomsLite:      (propertyId)              => api.get(`/ops/rooms-lite?propertyId=${propertyId}`),
  availability:   (propertyId, params = {}) => api.get(`/ops/availability?propertyId=${propertyId}${qs(params)}`),
  roomChart:      (propertyId, params = {}) => api.get(`/ops/room-chart?propertyId=${propertyId}${qs(params)}`),
  meals:          (propertyId, params = {}) => api.get(`/ops/meals?propertyId=${propertyId}${qs(params)}`),
  hkOverview:     (propertyId, params = {}) => api.get(`/ops/hk-overview?propertyId=${propertyId}${qs(params)}`),
  diningList:     (propertyId, params = {}) => api.get(`/ops/reports/dining-list?propertyId=${propertyId}${qs(params)}`),
  hkSheets:       (propertyId, params = {}) => api.get(`/ops/reports/hk-sheets?propertyId=${propertyId}${qs(params)}`),
  preventive:     (propertyId)              => api.get(`/ops/preventive?propertyId=${propertyId}`),
  createPreventive: (propertyId, body)      => api.post('/ops/preventive', withP(propertyId, body)),
  updatePreventive: (propertyId, id, body)  => api.patch(`/ops/preventive/${id}`, withP(propertyId, body)),
  runPreventive:  (propertyId, id)          => api.post(`/ops/preventive/${id}/run`, withP(propertyId, {})),
  roomBlocks:     (propertyId, params = {}) => api.get(`/ops/room-blocks?propertyId=${propertyId}${qs(params)}`),
  createBlock:    (propertyId, roomId, body) => api.post(`/ops/rooms/${roomId}/blocks`, withP(propertyId, body)),
  releaseBlock:   (propertyId, blockId, reason) => api.post(`/ops/room-blocks/${blockId}/release`, withP(propertyId, { reason })),
  staff:          (propertyId, kind)        => api.get(`/ops/staff?propertyId=${propertyId}${qs({ kind })}`),
  lostItems:      (propertyId, params = {}) => api.get(`/ops/lost-items?propertyId=${propertyId}${qs(params)}`),
  createLost:     (propertyId, body)        => api.post('/ops/lost-items', withP(propertyId, body)),
  transferLost:   (propertyId, id, body)    => api.post(`/ops/lost-items/${id}/transfer`, withP(propertyId, body)),
  releaseLost:    (propertyId, id, body)    => api.post(`/ops/lost-items/${id}/release`, withP(propertyId, body)),
  disposeLost:    (propertyId, id, body)    => api.post(`/ops/lost-items/${id}/dispose`, withP(propertyId, body)),
  tickets:        (propertyId, params = {}) => api.get(`/ops/tickets?propertyId=${propertyId}${qs(params)}`),
  ticket:         (propertyId, id)          => api.get(`/ops/tickets/${id}?propertyId=${propertyId}`),
  ticketPhoto:    (propertyId, id, file, caption) => { const f = new FormData(); f.append('photo', file); if (caption) f.append('caption', caption); f.append('propertyId', propertyId); return uploadForm(`/ops/tickets/${id}/photos?propertyId=${propertyId}`, f); },
  createTicket:   (propertyId, body)        => api.post('/ops/tickets', withP(propertyId, body)),
  takeTicket:     (propertyId, id)          => api.post(`/ops/tickets/${id}/take`, withP(propertyId)),
  updateTicket:   (propertyId, id, body)    => api.patch(`/ops/tickets/${id}`, withP(propertyId, body)),
  resolveTicket:  (propertyId, id, note)    => api.post(`/ops/tickets/${id}/resolve`, withP(propertyId, { note })),
  closeTicket:    (propertyId, id, note)    => api.post(`/ops/tickets/${id}/close`, withP(propertyId, { note })),
  reopenTicket:   (propertyId, id, reason)  => api.post(`/ops/tickets/${id}/reopen`, withP(propertyId, { reason })),
};

// ── Finance: folio, charges, payments, refunds, credit notes, day close (FIN-01…04, 07, 12) ──
export const finance = {
  folios:      (propertyId, params = {}) => api.get(`/finance/folios?propertyId=${propertyId}${qs(params)}`),
  stay:        (propertyId, resId)       => api.get(`/finance/stays/${resId}?propertyId=${propertyId}`),
  charge:      (propertyId, folioId, body) => api.post(`/finance/folios/${folioId}/charges`, { ...body, propertyId }),
  reverse:     (propertyId, folioId, lineId, reason) => api.post(`/finance/folios/${folioId}/lines/${lineId}/reverse`, { propertyId, reason }),
  ensureFolio: (propertyId, resId)       => api.post(`/finance/stays/${resId}/folio`, { propertyId }),
  pay:         (propertyId, folioId, body) => api.post(`/finance/folios/${folioId}/payments`, { ...body, propertyId }),
  refund:      (propertyId, folioId, lineId, body) => api.post(`/finance/folios/${folioId}/payments/${lineId}/refund`, { ...body, propertyId }),
  creditNote:  (propertyId, invoiceId, body) => api.post(`/finance/invoices/${invoiceId}/credit-note`, { ...body, propertyId }),
  dayClose:    (propertyId)              => api.get(`/finance/day-close?propertyId=${propertyId}`),
  runDayClose: (propertyId, body)        => api.post('/finance/day-close/run', { ...body, propertyId }),
  setAutoDayClose: (propertyId, body)    => api.put('/finance/day-close/auto', { ...body, propertyId }),
  receivables: (propertyId)               => api.get(`/finance/receivables?propertyId=${propertyId}`),
  receivePayment: (propertyId, companyId, body) => api.post(`/finance/receivables/${companyId}/payments`, { ...body, propertyId }),
  // Receivables / city ledger (gap-map item 7)
  arAccount:     (pid, cid, params = {})   => api.get(`/finance/receivables/${cid}?propertyId=${pid}${qs(params)}`),
  arSaveAccount: (pid, cid, body)          => api.put(`/finance/receivables/${cid}/account`, { ...body, propertyId: pid }),
  arDebt:        (pid, fid)                => api.get(`/finance/receivables/debts/${fid}?propertyId=${pid}`),
  arDebtCharge:  (pid, fid, body)          => api.post(`/finance/receivables/debts/${fid}/charge`, { ...body, propertyId: pid }),
  arAdjust:      (pid, fid, body)          => api.post(`/finance/receivables/debts/${fid}/adjust`, { ...body, propertyId: pid }),
  arTransfer:    (pid, fid, body)          => api.post(`/finance/receivables/debts/${fid}/transfer`, { ...body, propertyId: pid }),
  arUnconsolidate: (pid, fid)              => api.post(`/finance/receivables/debts/${fid}/unconsolidate`, { propertyId: pid }),
  arUnallocate:  (pid, fid, lineId)        => api.post(`/finance/receivables/debts/${fid}/unallocate`, { lineId, propertyId: pid }),
  arNewDebt:     (pid, cid, body)          => api.post(`/finance/receivables/${cid}/debts`, { ...body, propertyId: pid }),
  arConsolidate: (pid, cid, body)          => api.post(`/finance/receivables/${cid}/consolidate`, { ...body, propertyId: pid }),
  arAllocate:    (pid, cid, body)          => api.post(`/finance/receivables/${cid}/allocate`, { ...body, propertyId: pid }),
  arVoidPayment: (pid, cid, lineId, body)  => api.post(`/finance/receivables/${cid}/payments/${lineId}/void`, { ...body, propertyId: pid }),
  arNote:        (pid, cid, body)          => api.post(`/finance/receivables/${cid}/notes`, { ...body, propertyId: pid }),
  arRecurring:   (pid, cid, body)          => api.post(`/finance/receivables/${cid}/recurring`, { ...body, propertyId: pid }),
  arTraces:      (pid, view)               => api.get(`/finance/receivables/traces?propertyId=${pid}${qs({ view })}`),
  arTraceDone:   (pid, id, done)           => api.put(`/finance/receivables/traces/${id}`, { done, propertyId: pid }),
  arSearch:      (pid, params = {})        => api.get(`/finance/receivables/search?propertyId=${pid}${qs(params)}`),
  arChecklist:   (pid)                     => api.get(`/finance/receivables/checklist?propertyId=${pid}`),
  arCandidates:  (pid, params = {})        => api.get(`/finance/receivables/letters?propertyId=${pid}${qs(params)}`),
  arLetters:     (pid, ids)                => api.get(`/finance/receivables/letters?propertyId=${pid}${qs({ ids })}`),
  arSendLetters: (pid, body)               => api.post('/finance/receivables/letters', { ...body, propertyId: pid }),
  arPolicy:      (pid, body)               => api.put('/finance/receivables/policy', { ...body, propertyId: pid }),
  arApproveBin:  (pid, folioIds)           => api.post('/finance/receivables/bin/approve', { folioIds, propertyId: pid }),
  arMassCharge:  (pid, body)               => api.post('/finance/receivables/mass-charge', { ...body, propertyId: pid }),
  arRunRecurring:(pid)                     => api.post('/finance/receivables/recurring/run', { propertyId: pid }),
  dayReport:   (propertyId, date)        => api.get(`/finance/day-close/report?propertyId=${propertyId}${qs({ date })}`),
  closeFolio:  (propertyId, folioId)     => api.post(`/finance/folios/${folioId}/close`, { propertyId }),
  // Folio line operations (gap-map item 2)
  lineDiscount: (propertyId, folioId, body) => api.post(`/finance/folios/${folioId}/lines/discount`, { ...body, propertyId }),
  splitLine:   (propertyId, folioId, lineId, body) => api.post(`/finance/folios/${folioId}/lines/${lineId}/split`, { ...body, propertyId }),
  transferLines: (propertyId, folioId, body) => api.post(`/finance/folios/${folioId}/lines/transfer`, { ...body, propertyId }),
  combine:     (propertyId, folioId, body) => api.post(`/finance/folios/${folioId}/combos`, { ...body, propertyId }),
  uncombine:   (propertyId, folioId, comboId) => api.post(`/finance/folios/${folioId}/combos/${comboId}/remove`, { propertyId }),
  paidOut:     (propertyId, folioId, body) => api.post(`/finance/folios/${folioId}/paid-out`, { ...body, propertyId }),
  openWindow:  (propertyId, resId, label) => api.post(`/finance/stays/${resId}/windows`, { propertyId, label }),
  transferTargets: (propertyId, resId)   => api.get(`/finance/stays/${resId}/transfer-targets?propertyId=${propertyId}`),
  postNightAhead: (propertyId, resId)    => api.post(`/frontdesk/reservations/${resId}/post-nights`, { propertyId, ahead: true }),
  // NR folio — passer-by / house accounts (no reservation)
  houseAccounts: (propertyId, params = {}) => api.get(`/finance/house-accounts?propertyId=${propertyId}${qs(params)}`),
  houseAccount:  (propertyId, id)          => api.get(`/finance/house-accounts/${id}?propertyId=${propertyId}`),
  openHouseAccount: (propertyId, body)     => api.post('/finance/house-accounts', { ...body, propertyId }),
  // FIN-06 / FIN-10 documents from a folio and the allocation centre
  docContext:  (propertyId, folioId)     => api.get(`/finance/folios/${folioId}/documents/context?propertyId=${propertyId}`),
  issueDoc:    (propertyId, folioId, body) => api.post(`/finance/folios/${folioId}/documents`, { ...body, propertyId }),
  documents:   (propertyId, params = {}) => api.get(`/finance/documents?propertyId=${propertyId}${qs(params)}`),
  setAllocation: (propertyId, docId, body) => api.patch(`/finance/documents/${docId}/allocation?propertyId=${propertyId}`, body),
  sendDoc:     (propertyId, docId, to)   => api.post(`/finance/documents/${docId}/send?propertyId=${propertyId}`, { to }),
  // FIN-11 reports / exports, FIN-12 cash drawer, fiscal set-up
  report:      (propertyId, name, params = {}) => api.get(`/finance/reports/${name}?propertyId=${propertyId}${qs(params)}`),
  openFormat:  (propertyId, body)        => api.post(`/finance/open-format?propertyId=${propertyId}`, body),
  cash:        (propertyId, date)        => api.get(`/finance/cash?propertyId=${propertyId}${qs({ date })}`),
  closeCash:   (propertyId, body)        => api.post(`/finance/cash/close?propertyId=${propertyId}`, body),
  fiscal:      (propertyId)              => api.get(`/finance/fiscal?propertyId=${propertyId}`),
  setFiscal:   (propertyId, body)        => api.put(`/finance/fiscal?propertyId=${propertyId}`, body),
  setSeries:   (propertyId, type, next)  => api.put(`/finance/fiscal/series/${type}?propertyId=${propertyId}`, { next }),
  itaConnect:  (propertyId, env)         => api.post(`/finance/fiscal/ita/connect?propertyId=${propertyId}`, { env }),
  itaDisconnect: (propertyId)            => api.post(`/finance/fiscal/ita/disconnect?propertyId=${propertyId}`, {}),
  itaRetry:    (propertyId)              => api.post(`/finance/fiscal/ita/retry?propertyId=${propertyId}`, {}),
  // The standalone invoicing system (every fiscal document is issued there).
  invoicerStatus:   (propertyId)         => api.get(`/invoicer/status?propertyId=${propertyId}`),
  invoicerOverview: (propertyId)         => api.get(`/invoicer/overview?propertyId=${propertyId}`),
  invoicerConnect:  (propertyId, body)   => api.post(`/invoicer/connect`, { ...body, propertyId }),
  invoicerSync:     (propertyId)         => api.post(`/invoicer/sync`, { propertyId }),
  // Binary download (Excel workbook) with the bearer token; saves under the server's file name.
  downloadWorkbook: async (propertyId, params = {}) => {
    const token = getToken();
    const res = await fetch(`${PMS_BASE}/finance/reports/workbook?propertyId=${propertyId}${qs(params)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
    if (!res.ok) { let msg = 'שגיאה בהפקת הקובץ'; try { msg = (await res.json()).error || msg; } catch { /* binary */ } throw new Error(msg); }
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'accounting.xlsx';
    saveBlob(await res.blob(), name);
  },
  // Opens the printable document in a new tab (the first print of a final document is the original).
  printDoc: async (propertyId, docId) => {
    const win = window.open('', '_blank');
    const token = getToken();
    const res = await fetch(`${PMS_BASE}/finance/documents/${docId}/print?propertyId=${propertyId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
    if (!res.ok) {
      if (win) win.close();
      let msg = 'שגיאה בפתיחת המסמך';
      try { msg = (await res.json()).error || msg; } catch { /* not json */ }
      throw new Error(msg);
    }
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html; charset=utf-8' }));
    if (win) { win.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 60000); } else window.location.href = url;
  },
  // ADM-13 (G1) charge codes & payment methods
  codes:       (propertyId, params = {}) => api.get(`/finance/charge-codes?propertyId=${propertyId}${qs(params)}`),
  createCode:  (propertyId, body)        => api.post('/finance/charge-codes', { ...body, propertyId }),
  updateCode:  (propertyId, id, body)    => api.patch(`/finance/charge-codes/${id}`, { ...body, propertyId }),
  taxPolicy:   (propertyId)              => api.get(`/finance/tax-policy?propertyId=${propertyId}`),
  setTaxPolicy:(propertyId, body)        => api.put('/finance/tax-policy', { ...body, propertyId }),
};

// ── Booking: availability & price, create booking/quote, list, stay file (INV-03, RSV-01…04) ──
export const booking = {
  availability: (propertyId, params)       => api.get(`/booking/availability?propertyId=${propertyId}${qs(params)}`),
  create:       (propertyId, body)         => api.post('/booking/reservations', { ...body, propertyId }),
  party:        (propertyId, body)         => api.post('/booking/party', { ...body, propertyId }),
  sendConfirmation: (propertyId, id, to)  => api.post(`/booking/reservations/${id}/confirmation`, { to, propertyId }),
  freeRooms:    (propertyId, params)       => api.get(`/booking/free-rooms?propertyId=${propertyId}${qs(params)}`),
  boardConfig:  (propertyId)               => api.get(`/booking/board-config?propertyId=${propertyId}`),
  setBoardConfig: (propertyId, body)       => api.put('/booking/board-config', { ...body, propertyId }),
  list:         (propertyId, params = {})  => api.get(`/booking/reservations?propertyId=${propertyId}${qs(params)}`),
  get:          (propertyId, id)           => api.get(`/booking/reservations/${id}?propertyId=${propertyId}`),
  cancel:       (propertyId, id, reason)   => api.post(`/booking/reservations/${id}/cancel`, { propertyId, reason }),
  discountConfig: (propertyId)             => api.get(`/booking/discount-config?propertyId=${propertyId}`),
  setNoPost:     (propertyId, id, on, reason) => api.post(`/booking/reservations/${id}/no-post`, { propertyId, on, reason }),
  setVoucher:    (propertyId, id, body)     => api.post(`/booking/reservations/${id}/voucher`, { propertyId, ...body }),
  // Stay tools (gap-map item 5): Re-Instate check-out, Split Master, Shares
  reinstateCheckoutPreview: (propertyId, id) => api.get(`/booking/reservations/${id}/reinstate-checkout?propertyId=${propertyId}`),
  reinstateCheckout: (propertyId, id, reason) => api.post(`/booking/reservations/${id}/reinstate-checkout`, { propertyId, reason }),
  splitUnit:     (propertyId, id, unitId)   => api.post(`/booking/reservations/${id}/split`, { propertyId, unitId }),
  shareCandidates: (propertyId, id, q)      => api.get(`/booking/reservations/${id}/share-candidates?propertyId=${propertyId}${qs({ q })}`),
  addShare:      (propertyId, id, body)     => api.post(`/booking/reservations/${id}/shares`, { propertyId, ...body }),
  setShareSplit: (propertyId, id, shareId, split) => api.post(`/booking/reservations/${id}/shares/${shareId}/split`, { propertyId, split }),
  endShare:      (propertyId, id, shareId, body) => api.post(`/booking/reservations/${id}/shares/${shareId}/end`, { propertyId, ...body }),
  setGuarantee:  (propertyId, id, body)     => api.post(`/booking/reservations/${id}/guarantee`, { propertyId, ...body }),
  deleteReasons: (propertyId)              => api.get(`/booking/delete-reasons?propertyId=${propertyId}`),
  remove:       (propertyId, id, reason, note) => api.post(`/booking/reservations/${id}/delete`, { propertyId, reason, note }),
  guests:       (propertyId, q)            => api.get(`/booking/guests?propertyId=${propertyId}${qs({ q })}`),
  companies:    (propertyId, q)            => api.get(`/booking/companies?propertyId=${propertyId}${qs({ q })}`),
  quoteSent:    (propertyId, id, channel)  => api.post(`/booking/quotes/${id}/sent`, { propertyId, channel }),
  quoteClose:   (propertyId, id, reason)   => api.post(`/booking/quotes/${id}/close`, { propertyId, reason }),
  quoteConvert: (propertyId, id, priceSignature) => api.post(`/booking/quotes/${id}/convert`, { propertyId, priceSignature }),
  // The PMS API authenticates with a bearer token, so the printable quote is fetched and opened locally.
  quotePreview: async (propertyId, id) => {
    const token = getToken();
    const res = await fetch(`${PMS_BASE}/booking/quotes/${id}/preview?propertyId=${propertyId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const html = await res.text();
    if (!res.ok) throw new Error(html || `HTTP ${res.status}`);
    return html;
  },
};

// ── Stay changes: move, extend, early departure, booking change, cancellation (FD-09…11, RSV-05/06) ──
export const stay = {
  swapOptions:    (propertyId, reservationId, q) => api.get(`/stay/room-swap/options?propertyId=${propertyId}${qs({ reservationId, q })}`),
  swapPreview:    (propertyId, body)       => api.post('/stay/room-swap/preview', { ...body, propertyId }),
  swap:           (propertyId, body)       => api.post('/stay/room-swap', { ...body, propertyId }),
  moveCandidates: (propertyId, id, unitId, fromRoomId, until) => api.get(`/stay/${id}/move-candidates?propertyId=${propertyId}${qs({ unitId, fromRoomId, until })}`),
  move:           (propertyId, id, body)   => api.post(`/stay/${id}/move`, { ...body, propertyId }),
  extension:      (propertyId, id, newDeparture) => api.get(`/stay/${id}/extension?propertyId=${propertyId}${qs({ newDeparture })}`),
  extend:         (propertyId, id, body)   => api.post(`/stay/${id}/extend`, { ...body, propertyId }),
  extendWithMove: (propertyId, id, body)   => api.post(`/stay/${id}/extend-with-move`, { ...body, propertyId }),
  early:          (propertyId, id)         => api.get(`/stay/${id}/early-departure?propertyId=${propertyId}`),
  modifyPreview:  (propertyId, id, changes) => api.post(`/stay/${id}/modification/preview`, { propertyId, changes }),
  modify:         (propertyId, id, body)   => api.post(`/stay/${id}/modify`, { ...body, propertyId }),
  cancelPreview:  (propertyId, id, body)   => api.post(`/stay/${id}/cancellation/preview`, { ...body, propertyId }),
  cancel:         (propertyId, id, body)   => api.post(`/stay/${id}/cancel`, { ...body, propertyId }),
  // G6: walking a stay back
  reinstatePreview: (propertyId, id)       => api.get(`/stay/${id}/reinstate?propertyId=${propertyId}`),
  reinstate:      (propertyId, id, reason) => api.post(`/stay/${id}/reinstate`, { propertyId, reason }),
  reverseCheckInPreview: (propertyId, id)  => api.get(`/stay/${id}/reverse-check-in?propertyId=${propertyId}`),
  reverseCheckIn: (propertyId, id, body)   => api.post(`/stay/${id}/reverse-check-in`, { ...body, propertyId }),
  postStayCharge: (propertyId, id, body)   => api.post(`/stay/${id}/post-stay-charge`, { ...body, propertyId }),
  // EXT-04 non-resident guest
  tourist:        (propertyId, id)         => api.get(`/stay/${id}/tourist?propertyId=${propertyId}`),
  recordTourist:  (propertyId, id, body)   => api.post(`/stay/${id}/tourist`, { ...body, propertyId }),
};

// ── Identity (ADM-06, SYS-04) ────────────────────────────────────────────────
export const identity = {
  mfaStatus:  ()                        => api.get('/identity/me/mfa'),
  mfaSetup:   ()                        => api.post('/identity/me/mfa/setup', {}),
  mfaEnable:  (code)                    => api.post('/identity/me/mfa/enable', { code }),
  mfaDisable: (password, code)          => api.post('/identity/me/mfa/disable', { password, code }),
  mfaReset:   (propertyId, userId)      => api.post(`/identity/users/${userId}/mfa/reset`, { propertyId }),
  users:      (propertyId, params = {}) => api.get(`/identity/users?propertyId=${propertyId}${qs(params)}`),
  roles:      (propertyId)              => api.get(`/identity/roles?propertyId=${propertyId}`),
  create:     (propertyId, body)        => api.post('/identity/users', { ...body, propertyId }),
  update:     (propertyId, id, body)    => api.patch(`/identity/users/${id}`, { ...body, propertyId }),
  deactivate: (propertyId, id, reason)  => api.post(`/identity/users/${id}/deactivate`, { propertyId, reason }),
  reactivate: (propertyId, id)          => api.post(`/identity/users/${id}/reactivate`, { propertyId }),
  setupLink:  (propertyId, id)          => api.post(`/identity/users/${id}/setup-link`, { propertyId }),
  me:         ()                        => api.get('/identity/me'),
  updateMe:   (body)                    => api.patch('/identity/me', body),
  password:   (current, next)           => api.post('/identity/me/password', { current, next }),
  logoutAll:  ()                        => api.post('/identity/me/logout-all', {}),
};

// ── Platform: policy (ADM-05), search (SYS-05), work items (SYS-06) ────────────
export const platform = {
  policy:        (propertyId)             => api.get(`/platform/policy?propertyId=${propertyId}`),
  publishPolicy: (propertyId, body)       => api.put('/platform/policy', { ...body, propertyId }),
  search:        (propertyId, q)          => api.get(`/platform/search?propertyId=${propertyId}${qs({ q })}`),
  staff:         (propertyId)             => api.get(`/platform/staff?propertyId=${propertyId}`),
  work:          (propertyId, params = {}) => api.get(`/platform/work?propertyId=${propertyId}${qs(params)}`),
  createWork:    (propertyId, body)       => api.post('/platform/work', { ...body, propertyId }),
  takeWork:      (propertyId, id)         => api.post(`/platform/work/${id}/take`, { propertyId }),
  transferWork:  (propertyId, id, toUserId, note) => api.post(`/platform/work/${id}/transfer`, { propertyId, toUserId, note }),
  closeWork:     (propertyId, id, resolution) => api.post(`/platform/work/${id}/close`, { propertyId, resolution }),
  noteWork:      (propertyId, id, text)   => api.post(`/platform/work/${id}/note`, { propertyId, text }),
};

// ── Audit log (ADM-07) ────────────────────────────────────────────────────────
export const audit = {
  list:   (propertyId, params = {}) => api.get(`/audit-log?propertyId=${propertyId}${qs(params)}`),
  get:    (id)                      => api.get(`/audit-log/${id}`),
  // CSV is fetched with the bearer token and saved locally.
  exportCsv: async (propertyId, params = {}) => {
    const token = getToken();
    const res = await fetch(`${PMS_BASE}/audit-log/export?propertyId=${propertyId}${qs(params)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return { blob: await res.blob(), name: (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'audit.csv' };
  },
};

// ── Password recovery (SYS-02) — public ───────────────────────────────────────
export const passwordRecovery = {
  request: async (email) => {
    const res = await fetch(`${AUTH_BASE}/auth/password/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) { const e = new Error(data.error || data.message || `HTTP ${res.status}`); e.fields = data.fields; throw e; }
    return data.data;
  },
  reset: async (token, password) => {
    const res = await fetch(`${AUTH_BASE}/auth/password/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) { const e = new Error(data.error || data.message || `HTTP ${res.status}`); e.fields = data.fields; e.code = data.code; throw e; }
    return data.data;
  },
};

// ── Rooms ─────────────────────────────────────────────────────────────────────
export const rooms = {
  list:     (propertyId, params = {}) => api.get(`/rooms?propertyId=${propertyId}${qs(params)}`),
  get:      (id)                      => api.get(`/rooms/${id}`),
  create:   (data)                    => api.post('/rooms', data),
  update:   (id, data)                => api.patch(`/rooms/${id}`, data),
  remove:   (id)                      => api.delete(`/rooms/${id}`),
  setClean: (id, cleanStatus, propertyId) =>
    api.patch(`/rooms/${id}/clean-status`, { cleanStatus, propertyId }),
  setOps:   (id, opsStatus, reason, propertyId) =>
    api.patch(`/rooms/${id}/ops-status`, { opsStatus, reason, propertyId }),
};

// ── Room Types ────────────────────────────────────────────────────────────────
export const roomTypes = {
  list: (propertyId) => api.get(`/properties/room-types?propertyId=${propertyId}`),
};

// ── Reservations ──────────────────────────────────────────────────────────────
export const reservations = {
  // Listing & lookup
  list:             (propertyId, params = {}) => api.get(`/reservations?propertyId=${propertyId}${qs(params)}`),
  get:              (id)                      => api.get(`/reservations/${id}`),
  availability:     (propertyId, roomTypeId, arrivalDate, departureDate, excludeId) =>
    api.get(`/reservations/availability/check?propertyId=${propertyId}&roomTypeId=${roomTypeId}&arrivalDate=${arrivalDate}&departureDate=${departureDate}${excludeId ? `&excludeReservationId=${excludeId}` : ''}`),

  // Create & lifecycle
  create:           (data)           => api.post('/reservations', data),
  quote:            (data)           => api.post('/reservations/quote', data),
  saveQuote:        (data)           => api.post('/reservations/quote/save', data),
  confirm:          (id)             => api.post(`/reservations/${id}/confirm`, {}),
  update:           (id, data)       => api.patch(`/reservations/${id}`, data),
  sendConfirmation: (id)             => api.post(`/reservations/${id}/send-confirmation`, {}),
  duplicate:        (id, data)       => api.post(`/reservations/${id}/duplicate`, data),
  merge:            (targetReservationId, sourceReservationId, transferCharges = true) =>
    api.post('/reservations/merge', { targetReservationId, sourceReservationId, transferCharges }),
  bulkActions:      (data)           => api.post('/reservations/bulk-actions', data),
  bulkJobsPreferences: (propertyId) =>
    api.get(`/reservations/bulk-actions/preferences?propertyId=${propertyId}`),
  saveBulkJobsPreferences: (propertyId, defaultPreset = '', filterBundles) => {
    const payload = { propertyId, defaultPreset };
    if (Array.isArray(filterBundles)) payload.filterBundles = filterBundles;
    return api.put('/reservations/bulk-actions/preferences', payload);
  },
  bulkJobsList:     (propertyId, filters = {}) => {
    const { preset, status, action, from, to, hasFailures, focusJobId, page = 1, limit = 20 } = filters;
    const q = new URLSearchParams({ propertyId, page, limit });
    if (preset) q.set('preset', preset);
    if (status) q.set('status', status);
    if (action) q.set('action', action);
    if (from)   q.set('from', from);
    if (to)     q.set('to', to);
    if (hasFailures) q.set('hasFailures', '1');
    if (focusJobId) q.set('focusJobId', focusJobId);
    return api.get(`/reservations/bulk-actions/jobs?${q.toString()}`);
  },
  bulkJobStatus:    (jobId, propertyId, includeResults = false) =>
    api.get(`/reservations/bulk-actions/jobs/${jobId}?propertyId=${propertyId}${includeResults ? '&includeResults=1' : ''}`),
  cancelBulkJob:    (jobId, propertyId) =>
    api.post(`/reservations/bulk-actions/jobs/${jobId}/cancel`, { propertyId }),
  retryBulkJobFailed: (jobId, propertyId) =>
    api.post(`/reservations/bulk-actions/jobs/${jobId}/retry-failed`, { propertyId }),
  split:            (id, roomIdsOrPayload, extras = {}) => {
    const payload = Array.isArray(roomIdsOrPayload)
      ? { reservationRoomIds: roomIdsOrPayload, ...extras }
      : (roomIdsOrPayload || {});
    return api.post(`/reservations/${id}/split`, payload);
  },

  // Operations
  checkIn:          (id, overrideClean, overrideEarlyArrival) => api.post(`/reservations/${id}/check-in`, { overrideClean, overrideEarlyArrival }),
  checkOut:         (id, force)         => api.post(`/reservations/${id}/check-out`, { forceCheckout: force }),
  partialCheckIn:   (id, reservationRoomIds, overrideClean) =>
    api.post(`/reservations/${id}/partial-check-in`, { reservationRoomIds, overrideClean }),
  partialCheckOut:  (id, reservationRoomIds) =>
    api.post(`/reservations/${id}/partial-check-out`, { reservationRoomIds }),
  cancel:           (id, reason)    => api.post(`/reservations/${id}/cancel`, { reason }),
  noShow:           (id)            => api.post(`/reservations/${id}/no-show`, {}),
  cancellationFee:  (id, amount)    => api.post(`/reservations/${id}/cancellation-fee`, { amount }),
  noShowFee:        (id, amount)    => api.post(`/reservations/${id}/no-show-fee`, { amount }),
  extend:           (id, data)      => api.post(`/reservations/${id}/extend`, data),
  earlyDeparture:   (id, data)      => api.post(`/reservations/${id}/early-departure`, data),
  upgrade:          (id, data)      => api.post(`/reservations/${id}/upgrade`, data),
  addService:       (id, data)      => api.post(`/reservations/${id}/add-service`, data),
  transferCharges:  (fromId, toId, lineIds) =>
    api.post('/reservations/transfer-charges', { fromReservationId: fromId, toReservationId: toId, lineIds }),
  linkGroup:        (id, groupOrPayload) => {
    const payload = typeof groupOrPayload === 'string'
      ? { groupId: groupOrPayload }
      : (groupOrPayload || {});
    return api.post(`/reservations/${id}/link-group`, payload);
  },
  assignRoom:       (id, roomId, adjustment) => api.patch(`/reservations/${id}/assign-room`, { roomId, ...adjustment }),

  // Communication
  sendWelcome:         (id) => api.post(`/reservations/${id}/send-welcome`, {}),
  expressCheckoutLink: (id) => api.post(`/reservations/${id}/express-checkout-link`, {}),

  // Rooms & segments
  rooms:        (id)                => api.get(`/reservations/${id}/rooms`),
  addRoom:      (id, data)          => api.post(`/reservations/${id}/rooms`, data),
  updateRoom:   (roomId, data)      => api.patch(`/reservations/rooms/${roomId}`, data),
  removeRoom:   (roomId)            => api.delete(`/reservations/rooms/${roomId}`),
  segments:     (roomId)            => api.get(`/reservations/rooms/${roomId}/segments`),
  addSegment:   (roomId, data)      => api.post(`/reservations/rooms/${roomId}/segments`, data),
};

// ── Guests ────────────────────────────────────────────────────────────────────
export const guests = {
  list:            (propertyId, params = {}) => api.get(`/guests?propertyId=${propertyId}${qs(params)}`),
  get:             (id)                      => api.get(`/guests/${id}`),
  create:          (data)                    => api.post('/guests', data),
  update:          (id, data)                => api.patch(`/guests/${id}`, data),
  addTag:          (id, tag)                 => api.post(`/guests/${id}/tags`, { action: 'add', tag }),
  removeTag:       (id, tag)                 => api.post(`/guests/${id}/tags`, { action: 'remove', tag }),
  addNote:         (id, text, createdBy)     => api.post(`/guests/${id}/notes`, { text, createdBy }),
  deleteNote:      (id, noteId)              => api.delete(`/guests/${id}/notes/${noteId}`),
  merge:           (targetId, sourceId)      => api.post(`/guests/${targetId}/merge`, { sourceId }),
  anonymize:       (id, reason)              => api.post(`/guests/${id}/anonymize`, { reason }),
  detectReturning: (propertyId, email, phone)=> api.post('/guests/detect-returning', { propertyId, email, phone }),
};

// ── Housekeeping ──────────────────────────────────────────────────────────────
export const housekeeping = {
  list:           (propertyId, params = {}) => api.get(`/housekeeping?propertyId=${propertyId}${qs(params)}`),
  staffSummary:   (propertyId, date)        => api.get(`/housekeeping/staff-summary?propertyId=${propertyId}${date ? `&date=${date}` : ''}`),
  generate:       (propertyId, date)        => api.post('/housekeeping/generate', { propertyId, date }),
  autoAssign:     (propertyId, date)        => api.post('/housekeeping/auto-assign', { propertyId, date }),
  assign:         (id, userId)              => api.patch(`/housekeeping/${id}/assign`, { userId }),
  start:          (id)                      => api.patch(`/housekeeping/${id}/start`, {}),
  pause:          (id, reason)              => api.patch(`/housekeeping/${id}/pause`, { reason }),
  resume:         (id)                      => api.patch(`/housekeeping/${id}/resume`, {}),
  cancel:         (id, reason)              => api.patch(`/housekeeping/${id}/cancel`, { reason }),
  complete:       (id, propertyId)          => api.post(`/housekeeping/${id}/complete`, { propertyId }),
  inspect:        (id, approved, notes, propertyId) =>
    api.post(`/housekeeping/${id}/inspect`, { approved, notes, propertyId }),
  setDND:         (id, isDND)               => api.patch(`/housekeeping/${id}/dnd`, { isDND }),
  setNoService:   (id, isNoService)         => api.patch(`/housekeeping/${id}/no-service`, { isNoService }),
  reportIssue:    (id, data)                => api.post(`/housekeeping/${id}/report-issue`, data),
  addLostFound:   (id, data)                => api.post(`/housekeeping/${id}/lost-found`, data),
  updateLostFound:(id, itemId, status)      => api.patch(`/housekeeping/${id}/lost-found/${itemId}`, { status }),
  setSupplies:    (id, supplies)            => api.patch(`/housekeeping/${id}/supplies`, { supplies }),
};

// ── Maintenance ───────────────────────────────────────────────────────────────
export const maintenance = {
  list:     (propertyId, params = {}) => api.get(`/maintenance?propertyId=${propertyId}${qs(params)}`),
  stats:    (propertyId)              => api.get(`/maintenance/stats?propertyId=${propertyId}`),
  get:      (id)                      => api.get(`/maintenance/${id}`),
  create:   (data)                    => api.post('/maintenance', data),
  assign:   (id, userId)              => api.patch(`/maintenance/${id}/assign`, { userId }),
  status:   (id, status, propertyId)  => api.patch(`/maintenance/${id}/status`, { status, propertyId }),
  priority: (id, priority, propertyId)=> api.patch(`/maintenance/${id}/priority`, { priority, propertyId }),
  due:      (id, dueDate, propertyId) => api.patch(`/maintenance/${id}/due`, { dueDate, propertyId }),
  addNote:      (id, text, authorName)       => api.post(`/maintenance/${id}/notes`, { text, authorName }),
  approveClose: (id)                         => api.post(`/maintenance/${id}/approve-close`, {}),
  addPhoto:     (id, url, caption)           => api.post(`/maintenance/${id}/photos`, { url, caption }),
  updateParts:  (id, parts)                  => api.patch(`/maintenance/${id}/parts`, { parts }),
  setVendor:    (id, name, phone, email)     => api.patch(`/maintenance/${id}/vendor`, { name, phone, email }),
};

// ── Report centre (every hotel report: catalogue, data, Excel/CSV) ────────────
export const reportCenter = {
  catalog: (propertyId)               => api.get(`/report-center/catalog?propertyId=${propertyId}`),
  run:     (propertyId, code, params) => api.get(`/report-center/${code}?propertyId=${propertyId}${qs(params || {})}`),
  download: async (propertyId, code, params = {}, format = 'xlsx') => {
    const token = getToken();
    const res = await fetch(`${PMS_BASE}/report-center/${code}/export?propertyId=${propertyId}${qs({ ...params, format })}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { let msg = 'שגיאה בהפקת הקובץ'; try { msg = (await res.json()).error || msg; } catch { /* binary */ } throw new Error(msg); }
    saveBlob(await res.blob(), (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${code}.${format}`);
  },
};

// ── Report subscriptions (scheduled e-mails) ──────────────────────────────────
export const reportSubscriptions = {
  list:   (propertyId)           => api.get(`/report-subscriptions?propertyId=${propertyId}`),
  create: (propertyId, body)     => api.post('/report-subscriptions', { ...body, propertyId }),
  update: (propertyId, id, body) => api.put(`/report-subscriptions/${id}`, { ...body, propertyId }),
  remove: (propertyId, id)       => api.delete(`/report-subscriptions/${id}?propertyId=${propertyId}`),
  send:   (propertyId, id)       => api.post(`/report-subscriptions/${id}/send`, { propertyId }),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reports = {
  // Summary KPIs
  summary:              (propertyId, from, to) =>
    api.get(`/reports/summary?propertyId=${propertyId}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`),

  // Night Audit
  nightAuditPreview:    (propertyId, date) =>
    api.get(`/reports/night-audit-preview?propertyId=${propertyId}&date=${date}`),
  runNightAudit:        (propertyId, date, markNoShows) =>
    api.post('/reports/night-audit', { propertyId, date, markNoShows }),
  nightAuditHistory:    (propertyId) =>
    api.get(`/reports/night-audit-history?propertyId=${propertyId}`),

  // Operational
  arrivals:             (propertyId, date) =>
    api.get(`/reports/arrivals?propertyId=${propertyId}&date=${date}`),
  departures:           (propertyId, date) =>
    api.get(`/reports/departures?propertyId=${propertyId}&date=${date}`),
  inhouse:              (propertyId, date) =>
    api.get(`/reports/in-house?propertyId=${propertyId}&date=${date}`),
  cancellations:        (propertyId, from, to) =>
    api.get(`/reports/cancellations?propertyId=${propertyId}&from=${from}&to=${to}`),
  noShows:              (propertyId, from, to) =>
    api.get(`/reports/no-shows?propertyId=${propertyId}&from=${from}&to=${to}`),
  hkProductivity:       (propertyId, date) =>
    api.get(`/reports/housekeeping-productivity?propertyId=${propertyId}&date=${date}`),
  maintenanceTickets:   (propertyId, from, to) =>
    api.get(`/reports/maintenance-tickets?propertyId=${propertyId}&from=${from}&to=${to}`),

  // Financial
  revenueByDepartment:  (propertyId, from, to) =>
    api.get(`/reports/revenue-by-department?propertyId=${propertyId}&from=${from}&to=${to}`),
  openFolios:           (propertyId) =>
    api.get(`/reports/open-folios?propertyId=${propertyId}`),
  taxReport:            (propertyId, from, to) =>
    api.get(`/reports/tax-report?propertyId=${propertyId}&from=${from}&to=${to}`),
  arAging:              (propertyId) =>
    api.get(`/reports/ar-aging?propertyId=${propertyId}`),
  cashierClosure:       (propertyId, date) =>
    api.get(`/reports/cashier-closure?propertyId=${propertyId}&date=${date}`),
  paymentReport:        (propertyId, from, to) =>
    api.get(`/reports/payments?propertyId=${propertyId}&from=${from}&to=${to}`),

  // Revenue Management
  channelPerformance:   (propertyId, from, to) =>
    api.get(`/reports/channel-performance?propertyId=${propertyId}&from=${from}&to=${to}`),
  marketSegment:        (propertyId, from, to) =>
    api.get(`/reports/market-segment?propertyId=${propertyId}&from=${from}&to=${to}`),
  pickup:               (propertyId, from, to) =>
    api.get(`/reports/pickup?propertyId=${propertyId}&from=${from}&to=${to}`),
  avgLos:               (propertyId, from, to) =>
    api.get(`/reports/avg-los?propertyId=${propertyId}&from=${from}&to=${to}`),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = {
  list:   (propertyId)    => api.get(`/users?propertyId=${propertyId}`),
  get:    (id)            => api.get(`/users/${id}`),
  create: (data)          => api.post('/users', data),
  update: (id, data)      => api.patch(`/users/${id}`, data),
  deactivate: (id)        => api.patch(`/users/${id}`, { active: false }),
};

// ── Companies ─────────────────────────────────────────────────────────────────
export const companies = {
  list:         (propertyId, params = {}) => api.get(`/companies?propertyId=${propertyId}${qs(params)}`),
  get:          (id)                      => api.get(`/companies/${id}`),
  reservations: (id)                      => api.get(`/companies/${id}/reservations`),
  balance:      (id)                      => api.get(`/companies/${id}/balance`),
  create:       (data)                    => api.post('/companies', data),
  update:       (id, data)                => api.patch(`/companies/${id}`, data),
  remove:       (id)                      => api.delete(`/companies/${id}`),
};

// ── Group blocks (allotments that hold inventory) ───────────────────────────
export const groupBlocks = {
  list:    (propertyId, params = {}) => api.get(`/group-blocks?propertyId=${propertyId}${qs(params)}`),
  get:     (propertyId, id)          => api.get(`/group-blocks/${id}?propertyId=${propertyId}`),
  create:  (propertyId, body)        => api.post('/group-blocks', { ...body, propertyId }),
  update:  (propertyId, id, body)    => api.patch(`/group-blocks/${id}`, { ...body, propertyId }),
  act:     (propertyId, id, action, body = {}) => api.post(`/group-blocks/${id}/${action}`, { ...body, propertyId }),
  pickup:  (propertyId, id, body)    => api.post(`/group-blocks/${id}/pickup`, { ...body, propertyId }),
  roster:  (propertyId, id, entries) => api.put(`/group-blocks/${id}/rooming-list`, { entries, propertyId }),
  move:    (propertyId, id, body)    => api.post(`/group-blocks/${id}/move`, { ...body, propertyId }),
  grid:    (propertyId, id, body)    => api.put(`/group-blocks/${id}/grid`, { ...body, propertyId }),
  rosterStatus: (propertyId, id, body) => api.post(`/group-blocks/${id}/rooming-status`, { ...body, propertyId }),
  rosterFill:   (propertyId, id)       => api.post(`/group-blocks/${id}/rooming-fill`, { propertyId }),
  rosterBook:   (propertyId, id)       => api.post(`/group-blocks/${id}/rooming-book`, { propertyId }),
  assignRooms:  (propertyId, id, body = {}) => api.post(`/group-blocks/${id}/assign-rooms`, { ...body, propertyId }),
  checkIn:      (propertyId, id)       => api.post(`/group-blocks/${id}/check-in`, { propertyId }),
  copy:         (propertyId, id, body) => api.post(`/group-blocks/${id}/copy`, { ...body, propertyId }),
  // Programme (schedule, meals) and the kitchen's week
  program:      (propertyId, id)               => api.get(`/group-blocks/${id}/program?propertyId=${propertyId}`),
  addItem:      (propertyId, id, body)         => api.post(`/group-blocks/${id}/program`, { ...body, propertyId }),
  updateItem:   (propertyId, id, itemId, body) => api.patch(`/group-blocks/${id}/program/${itemId}`, { ...body, propertyId }),
  removeItem:   (propertyId, id, itemId)       => api.delete(`/group-blocks/${id}/program/${itemId}?propertyId=${propertyId}`),
  duplicateDay: (propertyId, id, body)         => api.post(`/group-blocks/${id}/program/duplicate-day`, { ...body, propertyId }),
  mealTypes:    (propertyId, all = false)      => api.get(`/group-blocks/meal-types?propertyId=${propertyId}${all ? '&all=1' : ''}`),
  saveMealType: (propertyId, id, body)         => (id ? api.patch(`/group-blocks/meal-types/${id}`, { ...body, propertyId }) : api.post('/group-blocks/meal-types', { ...body, propertyId })),
  kitchen:      (propertyId, params = {})      => api.get(`/group-blocks/kitchen?propertyId=${propertyId}${qs(params)}`),
  // Money: billing profile, payments with proof, finance approval
  money:        (propertyId, id)               => api.get(`/group-blocks/${id}/money?propertyId=${propertyId}`),
  suggestBilling: (propertyId, id)             => api.get(`/group-blocks/${id}/billing/suggest?propertyId=${propertyId}`),
  saveBilling:  (propertyId, id, body)         => api.put(`/group-blocks/${id}/billing`, { ...body, propertyId }),
  addPayment:   (propertyId, id, body)         => api.post(`/group-blocks/${id}/payments`, { ...body, propertyId }),
  decidePayment: (propertyId, id, paymentId, decision, body = {}) => api.post(`/group-blocks/${id}/payments/${paymentId}/${decision}`, { ...body, propertyId }),
  attach: (propertyId, id, paymentId, file) => { const form = new FormData(); form.append('file', file); return uploadForm(`/group-blocks/${id}/payments/${paymentId}/attachments?propertyId=${propertyId}`, form); },
  // Opens a payment proof (photo / PDF) in a new tab — served only with the session's token.
  openAttachment: async (propertyId, id, attachmentId) => {
    const win = window.open('', '_blank');
    const token = getToken();
    const res = await fetch(`${PMS_BASE}/group-blocks/${id}/attachments/${attachmentId}?propertyId=${propertyId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
    if (!res.ok) { if (win) win.close(); let msg = 'הקובץ לא נפתח'; try { msg = (await res.json()).error || msg; } catch { /* binary */ } throw new Error(msg); }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};

// ── Multi-option quotations ─────────────────────────────────────────────────
export const proposals = {
  list:    (propertyId, params = {}) => api.get(`/proposals?propertyId=${propertyId}${qs(params)}`),
  get:     (propertyId, id)          => api.get(`/proposals/${id}?propertyId=${propertyId}`),
  create:  (propertyId, body)        => api.post('/proposals', { ...body, propertyId }),
  sent:    (propertyId, id)          => api.post(`/proposals/${id}/sent`, { propertyId }),
  lost:    (propertyId, id, reason)  => api.post(`/proposals/${id}/lost`, { reason, propertyId }),
  accept:  (propertyId, id, body)    => api.post(`/proposals/${id}/accept`, { ...body, propertyId }),
  print: async (propertyId, id) => {
    const token = getToken();
    const res = await fetch(`${PMS_BASE}/proposals/${id}/print?propertyId=${propertyId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const html = await res.text();
    if (!res.ok) throw new Error(html || `HTTP ${res.status}`);
    return html;
  },
};

// ── Events & function spaces ────────────────────────────────────────────────
export const events = {
  spaces:     (propertyId, all)          => api.get(`/events/spaces?propertyId=${propertyId}${all ? '&all=1' : ''}`),
  saveSpace:  (propertyId, id, body)     => (id ? api.patch(`/events/spaces/${id}`, { ...body, propertyId }) : api.post('/events/spaces', { ...body, propertyId })),
  chart:      (propertyId, params = {})  => api.get(`/events/chart?propertyId=${propertyId}${qs(params)}`),
  search:     (propertyId, params = {})  => api.get(`/events?propertyId=${propertyId}${qs(params)}`),
  get:        (propertyId, id)           => api.get(`/events/${id}?propertyId=${propertyId}`),
  create:     (propertyId, body)         => api.post('/events', { ...body, propertyId }),
  update:     (propertyId, id, body)     => api.patch(`/events/${id}`, { ...body, propertyId }),
  status:     (propertyId, id, status, reason) => api.post(`/events/${id}/status`, { status, reason, propertyId }),
  openFolio:  (propertyId, id)           => api.post(`/events/${id}/folio`, { propertyId }),
};

// ── Demand system (forecast + price advice) ─────────────────────────────────
export const demand = {
  calendar: (propertyId, params = {}) => api.get(`/demand?propertyId=${propertyId}${qs(params)}`),
  apply:    (propertyId, body)        => api.post('/demand/apply', { ...body, propertyId }),
};

// ── Revenue management (day types, LOS tiers, channel rules, strategies) ────
export const revenue = {
  calendar:      (propertyId, params = {}) => api.get(`/revenue/calendar?propertyId=${propertyId}${qs(params)}`),
  setCalendar:   (propertyId, body)        => api.put('/revenue/calendar', { ...body, propertyId }),
  dayTypes:      (propertyId)              => api.get(`/revenue/day-types?propertyId=${propertyId}`),
  saveDayType:   (propertyId, id, body)    => (id ? api.patch(`/revenue/day-types/${id}`, { ...body, propertyId }) : api.post('/revenue/day-types', { ...body, propertyId })),
  plans:         (propertyId)              => api.get(`/revenue/plans?propertyId=${propertyId}`),
  savePlan:      (propertyId, id, body)    => api.put(`/revenue/plans/${id}`, { ...body, propertyId }),
  channelRules:  (propertyId)              => api.get(`/revenue/channel-rules?propertyId=${propertyId}`),
  saveChannelRule: (propertyId, id, body)  => (id ? api.patch(`/revenue/channel-rules/${id}`, { ...body, propertyId }) : api.post('/revenue/channel-rules', { ...body, propertyId })),
  strategies:    (propertyId)              => api.get(`/revenue/strategies?propertyId=${propertyId}`),
  saveStrategy:  (propertyId, id, body)    => (id ? api.patch(`/revenue/strategies/${id}`, { ...body, propertyId }) : api.post('/revenue/strategies', { ...body, propertyId })),
  runStrategies: (propertyId)              => api.post('/revenue/strategies/run', { propertyId }),
  restrictions:  (propertyId, params = {}) => api.get(`/revenue/restrictions?propertyId=${propertyId}${qs(params)}`),
  manualRestrictions: (propertyId, params = {}) => api.get(`/revenue/restrictions/manual?propertyId=${propertyId}${qs(params)}`),
};

// ── Packages (components, plan links, ledger) and agent commissions (gap-map item 10) ──
export const packages = {
  components:  (propertyId)              => api.get(`/packages/components?propertyId=${propertyId}`),
  saveComponent: (propertyId, id, body)  => (id ? api.patch(`/packages/components/${id}`, { ...body, propertyId }) : api.post('/packages/components', { ...body, propertyId })),
  plans:       (propertyId)              => api.get(`/packages/plans?propertyId=${propertyId}`),
  savePlan:    (propertyId, id, body)    => api.put(`/packages/plans/${id}`, { ...body, propertyId }),
  ledger:      (propertyId, params = {}) => api.get(`/packages/ledger?propertyId=${propertyId}${qs(params)}`),
  breakdown:   (propertyId, reservationId) => api.get(`/packages/reservations/${reservationId}?propertyId=${propertyId}`),
  addItem:     (propertyId, reservationId, body) => api.post(`/packages/reservations/${reservationId}/items`, { ...body, propertyId }),
  removeItem:  (propertyId, reservationId, itemId) => api.delete(`/packages/reservations/${reservationId}/items/${itemId}?propertyId=${propertyId}`),
};
export const commissions = {
  list:        (propertyId, params = {}) => api.get(`/commissions?propertyId=${propertyId}${qs(params)}`),
  agents:      (propertyId)              => api.get(`/commissions/agents?propertyId=${propertyId}`),
  process:     (propertyId, body = {})   => api.post('/commissions/process', { ...body, propertyId }),
  manual:      (propertyId, body)        => api.post('/commissions/manual', { ...body, propertyId }),
  hold:        (propertyId, body)        => api.post('/commissions/hold', { ...body, propertyId }),
  release:     (propertyId, body)        => api.post('/commissions/release', { ...body, propertyId }),
  edit:        (propertyId, id, body)    => api.patch(`/commissions/${id}`, { ...body, propertyId }),
  detach:      (propertyId, body)        => api.post('/commissions/detach', { ...body, propertyId }),
  prePayment:  (propertyId, params = {}) => api.get(`/commissions/pre-payment?propertyId=${propertyId}${qs(params)}`),
  pay:         (propertyId, body)        => api.post('/commissions/pay', { ...body, propertyId }),
  payments:    (propertyId, params = {}) => api.get(`/commissions/payments?propertyId=${propertyId}${qs(params)}`),
  payment:     (propertyId, id)          => api.get(`/commissions/payments/${id}?propertyId=${propertyId}`),
  setPaymentStatus: (propertyId, id, body) => api.post(`/commissions/payments/${id}/status`, { ...body, propertyId }),
  printPayment: (propertyId, id)         => api.post(`/commissions/payments/${id}/print`, { propertyId }),
  report:      (propertyId, params = {}) => api.get(`/commissions/report?propertyId=${propertyId}${qs(params)}`),
  forReservation: (propertyId, id)       => api.get(`/commissions/reservation/${id}?propertyId=${propertyId}`),
};

// Code lists the hotel manages (gap-map item 13)
export const codes = {
  all:  (propertyId)                 => api.get(`/codes?propertyId=${propertyId}`),
  list: (propertyId, list, active)   => api.get(`/codes?propertyId=${propertyId}&list=${list}${active ? '&active=1' : ''}`),
  save: (propertyId, list, code, body) => api.put(`/codes/${list}/${encodeURIComponent(code)}`, { ...body, propertyId }),
};

// Reservation details (gap-map item 14)
export const resDetails = {
  options:   (propertyId)              => api.get(`/res-details/options?propertyId=${propertyId}`),
  get:       (propertyId, id)          => api.get(`/res-details/${id}?propertyId=${propertyId}`),
  save:      (propertyId, id, body)    => api.patch(`/res-details/${id}`, { ...body, propertyId }),
  splitRate: (propertyId, id, body)    => api.post(`/res-details/${id}/split-rate`, { ...body, propertyId }),
  summary:   (propertyId, id)          => api.get(`/res-details/${id}/summary?propertyId=${propertyId}`),
};

// Waitlist, deposits, confirmations, items, stay rules (gap-map item 15)
export const resExtras = {
  waitlist:      (propertyId)            => api.get(`/res-extras/waitlist?propertyId=${propertyId}`),
  addWaitlist:   (propertyId, body)      => api.post('/res-extras/waitlist', { ...body, propertyId }),
  promote:       (propertyId, id, body = {}) => api.post(`/res-extras/waitlist/${id}/promote`, { ...body, propertyId }),
  removeWait:    (propertyId, id, reason) => api.post(`/res-extras/waitlist/${id}/remove`, { reason, propertyId }),
  deposits:      (propertyId)            => api.get(`/res-extras/deposits?propertyId=${propertyId}`),
  setDeposit:    (propertyId, id, body)  => api.put(`/res-extras/deposits/${id}`, { ...body, propertyId }),
  remind:        (propertyId, id)        => api.post(`/res-extras/deposits/${id}/remind`, { propertyId }),
  unconfirmed:   (propertyId, from, to)  => api.get(`/res-extras/confirmations?propertyId=${propertyId}&from=${from}&to=${to}`),
  sendConfirmations: (propertyId, ids)   => api.post('/res-extras/confirmations', { ids, propertyId }),
  items:         (propertyId)            => api.get(`/res-extras/items?propertyId=${propertyId}`),
  saveItem:      (propertyId, id, body)  => (id ? api.patch(`/res-extras/items/${id}`, { ...body, propertyId }) : api.post('/res-extras/items', { ...body, propertyId })),
  itemAvailability: (propertyId, from, to) => api.get(`/res-extras/items/availability?propertyId=${propertyId}&from=${from}&to=${to}`),
  bookItem:      (propertyId, resId, body) => api.post(`/res-extras/reservations/${resId}/items`, { ...body, propertyId }),
  releaseItem:   (propertyId, bookingId) => api.post(`/res-extras/item-bookings/${bookingId}/release`, { propertyId }),
  rules:         (propertyId, resId)     => api.get(`/res-extras/reservations/${resId}/rules?propertyId=${propertyId}`),
  saveRules:     (propertyId, resId, body) => api.put(`/res-extras/reservations/${resId}/rules`, { ...body, propertyId }),
};

// Profiles (gap-map item 16)
export const profiles = {
  guest:          (propertyId, id)        => api.get(`/profiles/guests/${id}?propertyId=${propertyId}`),
  saveRelations:  (propertyId, id, relations) => api.put(`/profiles/guests/${id}/relations`, { relations, propertyId }),
  setRestriction: (propertyId, id, body)  => api.put(`/profiles/guests/${id}/restriction`, { ...body, propertyId }),
  addPastStay:    (propertyId, id, body)  => api.post(`/profiles/guests/${id}/past-stays`, { ...body, propertyId }),
  addFile:        (propertyId, id, body)  => api.post(`/profiles/guests/${id}/files`, { ...body, propertyId }),
  removeFile:     (propertyId, fileId)    => api.post(`/profiles/files/${fileId}/remove`, { propertyId }),
  company:        (propertyId, id)        => api.get(`/profiles/companies/${id}?propertyId=${propertyId}`),
  setAccountManager: (propertyId, id, userId) => api.put(`/profiles/companies/${id}/account-manager`, { userId, propertyId }),
  setBookingProfiles: (propertyId, resId, body) => api.put(`/profiles/reservations/${resId}`, { ...body, propertyId }),
};

// Card clearing (gap-map item 12)
export const cards = {
  settings:     (propertyId)                 => api.get(`/cards/settings?propertyId=${propertyId}`),
  saveSettings: (propertyId, body)           => api.put('/cards/settings', { ...body, propertyId }),
  startCapture: (propertyId, body)           => api.post('/cards/capture', { ...body, propertyId }),
  finishCapture:(propertyId, token, payload) => api.post(`/cards/capture/${token}`, { payload, propertyId }),
  list:         (propertyId, params = {})    => api.get(`/cards?propertyId=${propertyId}${qs(params)}`),
  verify:       (propertyId, id)             => api.post(`/cards/${id}/verify`, { propertyId }),
  remove:       (propertyId, id)             => api.post(`/cards/${id}/remove`, { propertyId }),
  state:        (propertyId, reservationId)  => api.get(`/cards/reservations/${reservationId}?propertyId=${propertyId}`),
  setCard:      (propertyId, reservationId, card) => api.post(`/cards/reservations/${reservationId}/card`, { card, propertyId }),
  authorize:    (propertyId, reservationId, body = {}) => api.post(`/cards/reservations/${reservationId}/authorize`, { ...body, propertyId }),
  topUp:        (propertyId, reservationId)  => api.post(`/cards/reservations/${reservationId}/top-up`, { propertyId }),
  release:      (propertyId, reservationId)  => api.post(`/cards/reservations/${reservationId}/release`, { propertyId }),
  board:        (propertyId)                 => api.get(`/cards/authorizations?propertyId=${propertyId}`),
  charge:       (propertyId, folioId, body)  => api.post(`/cards/folios/${folioId}/charge`, { ...body, propertyId }),
  refund:       (propertyId, folioId, body)  => api.post(`/cards/folios/${folioId}/refund`, { ...body, propertyId }),
  settlements:  (propertyId, params = {})    => api.get(`/cards/settlements?propertyId=${propertyId}${qs(params)}`),
  deposit:      (propertyId, id, body)       => api.post(`/cards/settlements/${id}/deposit`, { ...body, propertyId }),
  transactions: (propertyId, params = {})    => api.get(`/cards/transactions?propertyId=${propertyId}${qs(params)}`),
};

// Custom permissions (gap-map item 11)
export const permissions = {
  catalog:   (propertyId)           => api.get(`/permissions/catalog?propertyId=${propertyId}`),
  groups:    (propertyId)           => api.get(`/permissions/groups?propertyId=${propertyId}`),
  saveGroup: (propertyId, id, body) => (id ? api.patch(`/permissions/groups/${id}`, { ...body, propertyId }) : api.post('/permissions/groups', { ...body, propertyId })),
  users:     (propertyId, params = {}) => api.get(`/permissions/users?propertyId=${propertyId}${qs(params)}`),
  assign:    (propertyId, id, body) => api.patch(`/permissions/users/${id}`, { ...body, propertyId }),
  unlock:    (propertyId, id)       => api.post(`/permissions/users/${id}/unlock`, { propertyId }),
};

// ── Promotions (promo codes) ─────────────────────────────────────────────────
export const promotions = {
  list:   (propertyId)           => api.get(`/promotions?propertyId=${propertyId}`),
  create: (propertyId, body)     => api.post('/promotions', { ...body, propertyId }),
  update: (propertyId, id, body) => api.patch(`/promotions/${id}`, { ...body, propertyId }),
};

// ── Cashier shifts + currency exchange ───────────────────────────────────────
// Front-desk communication (gap-map item 4): messages, alerts, traces, wake-ups, locators, log book, phone book.
export const desk = {
  items:     (propertyId, params = {}) => api.get(`/desk/items?propertyId=${propertyId}${qs(params)}`),
  create:    (propertyId, body)        => api.post('/desk/items', { ...body, propertyId }),
  close:     (propertyId, body)        => api.post('/desk/items/close', { ...body, propertyId }),
  read:      (propertyId, id)          => api.post(`/desk/items/${id}/read`, { propertyId }),
  stay:      (propertyId, resId)       => api.get(`/desk/stays/${resId}?propertyId=${propertyId}`),
  operator:  (propertyId, q)           => api.get(`/desk/operator?propertyId=${propertyId}${qs({ q })}`),
  phoneBook: (propertyId, q)           => api.get(`/desk/phone-book?propertyId=${propertyId}${qs({ q })}`),
  savePhone: (propertyId, id, body)    => (id ? api.put(`/desk/phone-book/${id}`, { ...body, propertyId }) : api.post('/desk/phone-book', { ...body, propertyId })),
  removePhone: (propertyId, id)        => api.delete(`/desk/phone-book/${id}?propertyId=${propertyId}`),
};

export const cashier = {
  shifts:       (propertyId, params = {}) => api.get(`/cashier/shifts?propertyId=${propertyId}${qs(params)}`),
  shift:        (propertyId, id)          => api.get(`/cashier/shifts/${id}?propertyId=${propertyId}`),
  open:         (propertyId, body)        => api.post('/cashier/shifts', { ...body, propertyId }),
  close:        (propertyId, id, body)    => api.post(`/cashier/shifts/${id}/close`, { ...body, propertyId }),
  rates:        (propertyId)              => api.get(`/cashier/fx/rates?propertyId=${propertyId}`),
  setRate:      (propertyId, cur, body)   => api.put(`/cashier/fx/rates/${cur}`, { ...body, propertyId }),
  exchanges:    (propertyId, params = {}) => api.get(`/cashier/fx?propertyId=${propertyId}${qs(params)}`),
  exchange:     (propertyId, body)        => api.post('/cashier/fx', { ...body, propertyId }),
  voidExchange: (propertyId, id, reason)  => api.post(`/cashier/fx/${id}/void`, { reason, propertyId }),
};

// ── Groups ────────────────────────────────────────────────────────────────────
export const groups = {
  list:         (propertyId, params = {}) => api.get(`/groups?propertyId=${propertyId}${qs(params)}`),
  get:          (id)                      => api.get(`/groups/${id}`),
  create:       (data)                    => api.post('/groups', data),
  update:       (id, data)                => api.patch(`/groups/${id}`, data),
  confirm:      (id)                      => api.post(`/groups/${id}/confirm`, {}),
  cancel:       (id, reason)              => api.post(`/groups/${id}/cancel`, { reason }),
  pickup:       (id, roomTypeId, count)   => api.post(`/groups/${id}/pickup`, { roomTypeId, count }),
  release:      (id, roomTypeId)          => api.post(`/groups/${id}/release`, { roomTypeId }),
  reservations: (id)                      => api.get(`/groups/${id}/reservations`),
  pickupReport: (id)                      => api.get(`/groups/${id}/pickup-report`),
  importRoomingList: (id, entries)        => api.post(`/groups/${id}/rooming-list`, { entries }),
  remove:       (id)                      => api.delete(`/groups/${id}`),
};

// ── Properties ────────────────────────────────────────────────────────────────
export const properties = {
  get:            (id)              => api.get(`/properties/${id}`),
  update:         (id, data)        => api.patch(`/properties/${id}`, data),
  roomTypes:      (propertyId, all) => api.get(`/properties/room-types?propertyId=${propertyId}${all ? '&all=1' : ''}`),
  createRoomType: (data)            => api.post('/properties/room-types', data),
  updateRoomType: (id, data)        => api.patch(`/properties/room-types/${id}`, data),
  deleteRoomType: (id)              => api.delete(`/properties/room-types/${id}`),
};

// ── Invoices ──────────────────────────────────────────────────────────────────
export const invoices = {
  list:           (propertyId, params = {}) =>
    api.get(`/invoices?propertyId=${propertyId}${qs(params)}`),
  get:            (id)            => api.get(`/invoices/${id}`),

  /** פתח את החשבונית כ-HTML בטאב חדש עם Bearer token (ולא window.open ישיר) */
  openHtml: async (id, { autoPrint = false } = {}) => {
    const token = getToken();
    const res = await fetch(`${PMS_BASE}/invoices/${id}/html`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('שגיאה בטעינת החשבונית');
    let html = await res.text();
    // הפעל הדפסה אוטומטית כש-autoPrint=true
    if (autoPrint) {
      html = html.replace(
        "if (window.location.search.includes('print=1'))",
        'if (true)',
      );
    }
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (win) win.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    else URL.revokeObjectURL(url);
  },

  issueFromFolio: (folioId, data) => api.post(`/invoices/folio/${folioId}`, data),
  issueManual:    (data)          => api.post('/invoices/manual', data),
  creditNote:     (id, data)      => api.post(`/invoices/${id}/credit-note`, data),
  setAllocation:  (id, allocationNumber) =>
    api.patch(`/invoices/${id}/allocation`, { allocationNumber }),
};

// ── Guest Data Export ─────────────────────────────────────────────────────────
export const guestDataExport = {
  request: (id, reason) => api.get(`/guests/${id}/data-export${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`),
};

// ── Legal Reports (new) ───────────────────────────────────────────────────────
export const legalReports = {
  vatReport:       (propertyId, from, to) =>
    api.get(`/reports/vat-report?propertyId=${propertyId}&from=${from}&to=${to}`),
  touristRegistry: (propertyId, date) =>
    api.get(`/reports/tourist-registry?propertyId=${propertyId}&date=${date}`),
};
export const rates = {
  // Plans
  plans:         (propertyId, all)                      => api.get(`/rates/plans?propertyId=${propertyId}${all ? '&all=1' : ''}`),
  createPlan:    (data)                                 => api.post('/rates/plans', data),
  updatePlan:    (id, data)                             => api.patch(`/rates/plans/${id}`, data),

  // Rate grid
  grid:          (propertyId, ratePlanId, from, days)   => api.get(`/rates/grid?propertyId=${propertyId}&ratePlanId=${ratePlanId}&from=${from}&days=${days}`),
  updateDate:    (data)                                 => api.put('/rates/date', data),
  bulk:          (data)                                 => api.put('/rates/bulk', data),

  // Quote
  quote:         (data)                                 => api.post('/rates/quote', data),

  // Overrides
  override:      (data)                                 => api.post('/rates/override', data),
  overrides:     (propertyId, params = {})              => api.get(`/rates/overrides?propertyId=${propertyId}${qs(params)}`),
};

// ── Inventory ─────────────────────────────────────────────────────────────────
export const inventory = {
  list:            (propertyId, from, to, roomTypeId) =>
    api.get(`/inventory?propertyId=${propertyId}&from=${from}&to=${to}${roomTypeId ? `&roomTypeId=${roomTypeId}` : ''}`),
  update:          (id, data)                         => api.patch(`/inventory/${id}`, data),
  bulkUpdate:      (data)                             => api.put('/inventory/bulk', data),
  checkAvailability:(propertyId, roomTypeId, from, to)=>
    api.post('/inventory/availability/check', { propertyId, roomTypeId, arrivalDate: from, departureDate: to }),
  createLock:      (data)                             => api.post('/inventory/locks', data),
  consumeLock:     (key, propertyId)                  => api.post('/inventory/locks/consume', { idempotencyKey: key, propertyId }),
  releaseLock:     (key, propertyId)                  => api.post('/inventory/locks/release', { idempotencyKey: key, propertyId }),
};

// ── Folio ─────────────────────────────────────────────────────────────────────
export const folio = {
  getByReservation: (resId)                          => api.get(`/folio/reservation/${resId}`),
  receipt:          (resId)                          => api.get(`/folio/reservation/${resId}/receipt`),
  invoice:          (resId)                          => api.get(`/folio/reservation/${resId}/invoice`),
  charge:           (folioId, data)                  => api.post(`/folio/${folioId}/charge`, data),
  payment:          (folioId, data)                  => api.post(`/folio/${folioId}/payment`, data),  // data: { amount, method, description?, serviceDate? }
  deposit:          (folioId, data)                  => api.post(`/folio/${folioId}/deposit`, data),
  discount:         (folioId, data)                  => api.post(`/folio/${folioId}/discount`, data),
  adjustment:       (folioId, data)                  => api.post(`/folio/${folioId}/adjustment`, data),
  refund:           (folioId, data)                  => api.post(`/folio/${folioId}/refund`, data),
  voidLine:         (folioId, lineId, reason)         => api.post(`/folio/${folioId}/void-line`, { lineId, reason }),
  transferLine:     (folioId, lineId, targetFolioId, reason) =>
    api.post(`/folio/${folioId}/transfer-line`, { lineId, targetFolioId, reason }),
  close:            (folioId, propertyId)            => api.post(`/folio/${folioId}/close`, { propertyId }),
  reopen:           (folioId, reason, propertyId)    => api.post(`/folio/${folioId}/reopen`, { reason, propertyId }),
  postCheckoutCharge:(folioId, data)                 => api.post(`/folio/${folioId}/post-checkout-charge`, data),
  checkCompanyCredit:(folioId, companyId, amount)    => api.post(`/folio/${folioId}/check-company-credit`, { companyId, amount }),
};

// ── Payments ──────────────────────────────────────────────────────────────────
export const payments = {
  list:    (propertyId, params = {}) => api.get(`/payments?propertyId=${propertyId}${qs(params)}`),
  get:     (id)                      => api.get(`/payments/${id}`),
  methods: (propertyId)              => api.get(`/payments/methods?propertyId=${propertyId}`),
  create:  (data)                    => api.post('/payments', data),
};

// ── Notifications ─────────────────────────────────────────────────────────────
export const notifications = {
  list:        (propertyId, params = {}) => api.get(`/notifications?propertyId=${propertyId}${qs(params)}`),
  unreadCount: (propertyId)              => api.get(`/notifications/unread-count?propertyId=${propertyId}`),
  types:       ()                        => api.get('/notifications/types'),
  create:      (data)                    => api.post('/notifications', data),
  broadcast:   (data)                    => api.post('/notifications/broadcast', data),
  markRead:    (id)                      => api.patch(`/notifications/${id}/read`, {}),
  markAllRead: (propertyId)              => api.patch(`/notifications/read-all?propertyId=${propertyId}`, {}),
  dismiss:     (id)                      => api.patch(`/notifications/${id}/dismiss`, {}),
  remove:      (id)                      => api.delete(`/notifications/${id}`),
};

// ── Audit Log ─────────────────────────────────────────────────────────────────
export const auditLog = {
  list:      (propertyId, params = {}) => api.get(`/audit-log?propertyId=${propertyId}${qs(params)}`),
  forEntity: (type, id)                => api.get(`/audit-log/entity/${type}/${id}`),
};

// ── CRM Core ────────────────────────────────────────────────────────────────
export const crm = {
  overview: (propertyId) => api.get(`/crm/overview?propertyId=${propertyId}`),

  // Leads
  leads: (propertyId, params = {}) =>
    api.get(`/crm/leads?propertyId=${propertyId}${qs(params)}`),
  updateLead: (leadId, data) =>
    api.patch(`/crm/leads/${leadId}`, data),
  routeLead: (leadId, data = {}) =>
    api.post(`/crm/leads/${leadId}/route`, data),
  convertLead: (leadId, data = {}) =>
    api.post(`/crm/leads/${leadId}/convert`, data),

  // Lead routing rules
  leadRoutingRules: (propertyId) =>
    api.get(`/crm/lead-routing-rules?propertyId=${propertyId}`),
  createLeadRoutingRule: (data) =>
    api.post('/crm/lead-routing-rules', data),
  updateLeadRoutingRule: (id, data) =>
    api.patch(`/crm/lead-routing-rules/${id}`, data),
  removeLeadRoutingRule: (id) =>
    api.delete(`/crm/lead-routing-rules/${id}`),

  // Opportunities
  opportunities: (propertyId, params = {}) =>
    api.get(`/crm/opportunities?propertyId=${propertyId}${qs(params)}`),
  updateOpportunity: (id, data) =>
    api.patch(`/crm/opportunities/${id}`, data),
  changeOpportunityStage: (id, data) =>
    api.post(`/crm/opportunities/${id}/stage`, data),
  closeOpportunityWon: (id, data = {}) =>
    api.post(`/crm/opportunities/${id}/close-won`, data),
  closeOpportunityLost: (id, data = {}) =>
    api.post(`/crm/opportunities/${id}/close-lost`, data),
  recalcOpportunityHealth: (id) =>
    api.post(`/crm/opportunities/${id}/health/recalculate`, {}),

  // Pipelines + Forecast
  pipelines: (propertyId) =>
    api.get(`/crm/pipelines?propertyId=${propertyId}`),
  createPipeline: (data) =>
    api.post('/crm/pipelines', data),
  updatePipeline: (id, data) =>
    api.patch(`/crm/pipelines/${id}`, data),
  removePipeline: (id) =>
    api.delete(`/crm/pipelines/${id}`),
  forecast: (propertyId, params = {}) =>
    api.get(`/crm/forecast?propertyId=${propertyId}${qs(params)}`),

  // Timeline
  timeline: (propertyId, params = {}) =>
    api.get(`/crm/timeline?propertyId=${propertyId}${qs(params)}`),
  addTimelineEvent: (data) =>
    api.post('/crm/timeline', data),
};

// ── Automation & Command Center ───────────────────────────────────────────────
export const automation = {
  // Command Center
  alerts:          (propertyId)       => api.get(`/automation/alerts?propertyId=${propertyId}`),
  recommendations: (propertyId)       => api.get(`/automation/recommendations?propertyId=${propertyId}`),
  triggers:        ()                 => api.get('/automation/triggers'),

  // Automation Rules
  rules:           (propertyId)       => api.get(`/automation/rules?propertyId=${propertyId}`),
  getRule:         (id)               => api.get(`/automation/rules/${id}`),
  createRule:      (data)             => api.post('/automation/rules', data),
  updateRule:      (id, data)         => api.patch(`/automation/rules/${id}`, data),
  toggleRule:      (id, active)       => api.patch(`/automation/rules/${id}`, { active }),
  deleteRule:      (id)               => api.delete(`/automation/rules/${id}`),
};

// ── Guest Requests ────────────────────────────────────────────────────────────
export const guestRequests = {
  list:        (propertyId, params = {}) => api.get(`/guest-requests?propertyId=${propertyId}${qs(params)}`),
  stats:       (propertyId)              => api.get(`/guest-requests/stats?propertyId=${propertyId}`),
  meta:        ()                        => api.get('/guest-requests/meta'),
  get:         (id)                      => api.get(`/guest-requests/${id}`),
  create:      (data)                    => api.post('/guest-requests', data),
  assign:      (id, userId, department)  => api.patch(`/guest-requests/${id}/assign`, { userId, department }),
  start:       (id)                      => api.patch(`/guest-requests/${id}/start`, {}),
  resolve:     (id, notes, score)        => api.post(`/guest-requests/${id}/resolve`, { resolutionNotes: notes, satisfactionScore: score }),
  close:       (id)                      => api.post(`/guest-requests/${id}/close`, {}),
  notifyGuest: (id)                      => api.patch(`/guest-requests/${id}/notify-guest`, {}),
  cancel:      (id)                      => api.delete(`/guest-requests/${id}`),
};

// ── Folio Routing ─────────────────────────────────────────────────────────────
export const folioRouting = {
  list:   (propertyId, reservationId) =>
    api.get(`/folio-routing?propertyId=${propertyId}${reservationId ? `&reservationId=${reservationId}` : ''}`),
  create: (data)      => api.post('/folio-routing', data),
  update: (id, data)  => api.patch(`/folio-routing/${id}`, data),
  remove: (id)        => api.delete(`/folio-routing/${id}`),
  apply:  (data)      => api.post('/folio-routing/apply', data),
};

// ── Integrations ──────────────────────────────────────────────────────────────
export const integrations = {
  log:       (propertyId, params = {}) => api.get(`/integrations/log?propertyId=${propertyId}${qs(params)}`),
  logStats:  (propertyId)              => api.get(`/integrations/log/stats?propertyId=${propertyId}`),
  logClear:  (propertyId, before)      => api.delete(`/integrations/log?propertyId=${propertyId}${before ? `&before=${before}` : ''}`),
  webhooks: {
    list:          (propertyId)  => api.get(`/integrations/webhooks?propertyId=${propertyId}`),
    events:        ()            => api.get('/integrations/webhooks/events'),
    create:        (data)        => api.post('/integrations/webhooks', data),
    update:        (id, data)    => api.patch(`/integrations/webhooks/${id}`, data),
    rotateSecret:  (id)          => api.post(`/integrations/webhooks/${id}/rotate-secret`, {}),
    remove:        (id)          => api.delete(`/integrations/webhooks/${id}`),
  },
  channelQueue: {
    stats:        (propertyId)                 => api.get(`/integrations/channel-queue/stats?propertyId=${propertyId}`),
    list:         (propertyId, status, limit)  => api.get(`/integrations/channel-queue?propertyId=${propertyId}${status ? `&status=${status}` : ''}${limit ? `&limit=${limit}` : ''}`),
    requeueDead:  (propertyId)                 => api.post(`/integrations/channel-queue/requeue-dead`, { propertyId }),
  },
};
