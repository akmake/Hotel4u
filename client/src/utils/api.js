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
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
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
};

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  login:          (email, password) => api.post('/auth/login', { email, password }),
  logout:         ()                => api.post('/auth/logout', {}),
  me:             ()                => api.get('/auth/me'),
  refresh:        (refreshToken)    => api.post('/auth/refresh', { refreshToken }),
  changePassword: (current, next)   => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
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
  merge:            (id, sourceId)   => api.post('/reservations/merge', { targetId: id, sourceId }),
  split:            (id, roomIds)    => api.post(`/reservations/${id}/split`, { reservationRoomIds: roomIds }),

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
  linkGroup:        (id, groupId)   => api.post(`/reservations/${id}/link-group`, { groupId }),
  assignRoom:       (id, roomId)    => api.patch(`/reservations/${id}/assign-room`, { roomId }),

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

// ── Rates ─────────────────────────────────────────────────────────────────────
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
  payment:          (folioId, data)                  => api.post(`/folio/${folioId}/payment`, data),
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
};
