const BASE = '/api';

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
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

export const api = {
  get:    (path)          => request('GET',    path),
  post:   (path, body)    => request('POST',   path, body),
  put:    (path, body)    => request('PUT',    path, body),
  patch:  (path, body)    => request('PATCH',  path, body),
  delete: (path)          => request('DELETE', path),
};

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  login:  (email, password) => api.post('/auth/login', { email, password }),
  logout: ()                => api.post('/auth/logout', {}),
  me:     ()                => api.get('/auth/me'),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const dashboard = {
  stats:      (propertyId) => api.get(`/dashboard/stats?propertyId=${propertyId}`),
  arrivals:   (propertyId) => api.get(`/dashboard/arrivals?propertyId=${propertyId}`),
  departures: (propertyId) => api.get(`/dashboard/departures?propertyId=${propertyId}`),
  inhouse:    (propertyId) => api.get(`/dashboard/inhouse?propertyId=${propertyId}`),
  alerts:     (propertyId) => api.get(`/dashboard/alerts?propertyId=${propertyId}`),
};

// ── Rooms ─────────────────────────────────────────────────────────────────────
export const rooms = {
  list:     (propertyId, params = {}) => api.get(`/rooms?propertyId=${propertyId}&${new URLSearchParams(params)}`),
  get:      (id)                      => api.get(`/rooms/${id}`),
  create:   (data)                    => api.post('/rooms', data),
  update:   (id, data)                => api.patch(`/rooms/${id}`, data),
  remove:   (id)                      => api.delete(`/rooms/${id}`),
  setClean: (id, cleanStatus, propertyId) => api.patch(`/rooms/${id}/clean-status`, { cleanStatus, propertyId }),
  setOps:   (id, opsStatus, reason, propertyId) => api.patch(`/rooms/${id}/ops-status`, { opsStatus, reason, propertyId }),
};

// ── Room Types ────────────────────────────────────────────────────────────────
export const roomTypes = {
  list: (propertyId) => api.get(`/properties/room-types?propertyId=${propertyId}`),
};

// ── Reservations ──────────────────────────────────────────────────────────────
export const reservations = {
  list:                (propertyId, params = {}) => api.get(`/reservations?propertyId=${propertyId}&${new URLSearchParams(params)}`),
  get:                 (id)                      => api.get(`/reservations/${id}`),
  create:              (data)                    => api.post('/reservations', data),
  update:              (id, data)                => api.patch(`/reservations/${id}`, data),
  checkIn:             (id, overrideClean)       => api.post(`/reservations/${id}/check-in`, { overrideClean }),
  checkOut:            (id, force)               => api.post(`/reservations/${id}/check-out`, { forceCheckout: force }),
  cancel:              (id, reason)              => api.post(`/reservations/${id}/cancel`, { reason }),
  noShow:              (id)                      => api.post(`/reservations/${id}/no-show`, {}),
  sendWelcome:         (id)                      => api.post(`/reservations/${id}/send-welcome`, {}),
  expressCheckoutLink: (id)                      => api.post(`/reservations/${id}/express-checkout-link`, {}),
  rooms:               (id)                      => api.get(`/reservations/${id}/rooms`),
  partialCheckIn:      (id, reservationRoomIds, overrideClean) => api.post(`/reservations/${id}/partial-check-in`, { reservationRoomIds, overrideClean }),
  partialCheckOut:     (id, reservationRoomIds)  => api.post(`/reservations/${id}/partial-check-out`, { reservationRoomIds }),
  availability:        (propertyId, roomTypeId, arrivalDate, departureDate) =>
    api.get(`/reservations/availability/check?propertyId=${propertyId}&roomTypeId=${roomTypeId}&arrivalDate=${arrivalDate}&departureDate=${departureDate}`),
  assignRoom:          (id, roomId) => api.patch(`/reservations/${id}/assign-room`, { roomId }),
};

// ── Guests ────────────────────────────────────────────────────────────────────
export const guests = {
  list:            (propertyId, params = {}) => api.get(`/guests?propertyId=${propertyId}&${new URLSearchParams(params)}`),
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
  list:          (propertyId, params = {}) => api.get(`/housekeeping?propertyId=${propertyId}&${new URLSearchParams(params)}`),
  staffSummary:  (propertyId, date)        => api.get(`/housekeeping/staff-summary?propertyId=${propertyId}${date ? `&date=${date}` : ''}`),
  generate:      (propertyId, date)        => api.post('/housekeeping/generate', { propertyId, date }),
  autoAssign:    (propertyId, date)        => api.post('/housekeeping/auto-assign', { propertyId, date }),
  assign:        (id, userId)              => api.patch(`/housekeeping/${id}/assign`, { userId }),
  start:         (id)                      => api.patch(`/housekeeping/${id}/start`, {}),
  pause:         (id, reason)              => api.patch(`/housekeeping/${id}/pause`, { reason }),
  resume:        (id)                      => api.patch(`/housekeeping/${id}/resume`, {}),
  cancel:        (id, reason)              => api.patch(`/housekeeping/${id}/cancel`, { reason }),
  complete:      (id, propertyId)          => api.post(`/housekeeping/${id}/complete`, { propertyId }),
  inspect:       (id, approved, notes, propertyId) => api.post(`/housekeeping/${id}/inspect`, { approved, notes, propertyId }),
  setDND:        (id, isDND)               => api.patch(`/housekeeping/${id}/dnd`, { isDND }),
  setNoService:  (id, isNoService)         => api.patch(`/housekeeping/${id}/no-service`, { isNoService }),
  reportIssue:   (id, data)               => api.post(`/housekeeping/${id}/report-issue`, data),
  addLostFound:  (id, data)               => api.post(`/housekeeping/${id}/lost-found`, data),
  updateLostFound:(id, itemId, status)     => api.patch(`/housekeeping/${id}/lost-found/${itemId}`, { status }),
  setSupplies:   (id, supplies)            => api.patch(`/housekeeping/${id}/supplies`, { supplies }),
};

// ── Maintenance ───────────────────────────────────────────────────────────────
export const maintenance = {
  list:   (propertyId, params = {}) => api.get(`/maintenance?propertyId=${propertyId}&${new URLSearchParams(params)}`),
  create: (data)                    => api.post('/maintenance', data),
  assign: (id, userId)              => api.patch(`/maintenance/${id}/assign`, { userId }),
  status: (id, status, propertyId)  => api.patch(`/maintenance/${id}/status`, { status, propertyId }),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reports = {
  summary:            (propertyId, from, to) => api.get(`/reports/summary?propertyId=${propertyId}${from?`&from=${from}`:''}${to?`&to=${to}`:''}`),
  nightAuditPreview:  (propertyId, date)     => api.get(`/reports/night-audit-preview?propertyId=${propertyId}&date=${date}`),
  runNightAudit:      (propertyId, date, markNoShows) => api.post('/reports/night-audit', { propertyId, date, markNoShows }),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = {
  list:   (propertyId)        => api.get(`/users?propertyId=${propertyId}`),
  create: (data)              => api.post('/users', data),
  update: (id, data)          => api.patch(`/users/${id}`, data),
};

// ── Companies ─────────────────────────────────────────────────────────────────
export const companies = {
  list:   (propertyId, q)     => api.get(`/companies?propertyId=${propertyId}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  create: (data)              => api.post('/companies', data),
  update: (id, data)          => api.patch(`/companies/${id}`, data),
};

// ── Properties ────────────────────────────────────────────────────────────────
export const properties = {
  get:              (id)             => api.get(`/properties/${id}`),
  update:           (id, data)       => api.patch(`/properties/${id}`, data),
  roomTypes:        (propertyId, all)=> api.get(`/properties/room-types?propertyId=${propertyId}${all ? '&all=1' : ''}`),
  createRoomType:   (data)           => api.post('/properties/room-types', data),
  updateRoomType:   (id, data)       => api.patch(`/properties/room-types/${id}`, data),
  deleteRoomType:   (id)             => api.delete(`/properties/room-types/${id}`),
};

// ── Rates ─────────────────────────────────────────────────────────────────────
export const rates = {
  plans:      (propertyId, all)                 => api.get(`/rates/plans?propertyId=${propertyId}${all ? '&all=1' : ''}`),
  createPlan: (data)                            => api.post('/rates/plans', data),
  updatePlan: (id, data)                        => api.patch(`/rates/plans/${id}`, data),
  grid:       (propertyId, ratePlanId, from, days) => api.get(`/rates/grid?propertyId=${propertyId}&ratePlanId=${ratePlanId}&from=${from}&days=${days}`),
  updateDate: (data)                            => api.put('/rates/date', data),
  bulk:       (data)                            => api.put('/rates/bulk', data),
};

// ── Folio ─────────────────────────────────────────────────────────────────────
export const folio = {
  getByReservation: (resId)                       => api.get(`/folio/reservation/${resId}`),
  receipt:          (resId)                       => api.get(`/folio/reservation/${resId}/receipt`),
  invoice:          (resId)                       => api.get(`/folio/reservation/${resId}/invoice`),
  charge:           (folioId, data)               => api.post(`/folio/${folioId}/charge`, data),
  payment:          (folioId, data)               => api.post(`/folio/${folioId}/payment`, data),
  deposit:          (folioId, data)               => api.post(`/folio/${folioId}/deposit`, data),
  discount:         (folioId, data)               => api.post(`/folio/${folioId}/discount`, data),
  adjustment:       (folioId, data)               => api.post(`/folio/${folioId}/adjustment`, data),
  refund:           (folioId, data)               => api.post(`/folio/${folioId}/refund`, data),
  voidLine:         (folioId, lineId, reason)      => api.post(`/folio/${folioId}/void-line`, { lineId, reason }),
  transferLine:     (folioId, lineId, targetFolioId, reason) => api.post(`/folio/${folioId}/transfer-line`, { lineId, targetFolioId, reason }),
  close:            (folioId, propertyId)         => api.post(`/folio/${folioId}/close`, { propertyId }),
  reopen:           (folioId, reason, propertyId) => api.post(`/folio/${folioId}/reopen`, { reason, propertyId }),
};
