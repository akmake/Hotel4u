// Server-only adapter to our standalone invoicing system (../invoicer). Never expose the key to a browser.
// Every fiscal document is issued there (owner decision 2026-10-19); Hotel4u keeps a mirror only.
const failure = (message, status = 503, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

export function createInvoicerClient({ baseUrl, apiKey, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!baseUrl || !apiKey) throw failure('מערכת החשבוניות לא חוברה לשרת (INVOICER_API_URL / INVOICER_API_KEY)', 503, 'invoicer_not_configured');
  let base;
  try { base = new URL(baseUrl); } catch { throw failure('כתובת מערכת החשבוניות אינה תקינה'); }
  if (base.username || base.password || base.search || base.hash || !['https:', 'http:'].includes(base.protocol)
    || (base.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) {
    throw failure('חיבור למערכת החשבוניות דורש HTTPS; HTTP מותר בפיתוח מקומי בלבד');
  }
  const root = base.href.replace(/\/$/, '');

  async function request(route, { method = 'GET', body, idempotencyKey } = {}) {
    if (!route.startsWith('/v1/')) throw failure('נתיב חיבור אינו מורשה', 422);
    let response;
    try {
      response = await fetchImpl(root + route, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: 'Bearer ' + apiKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw failure('מערכת החשבוניות אינה זמינה. אפשר לנסות שוב — הבקשה לא תופק פעמיים', 503, 'invoicer_unavailable');
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      const status = response.status >= 400 && response.status < 500 ? response.status : 503;
      throw failure(result?.error?.message || 'הפעולה במערכת החשבוניות לא הושלמה', status, result?.error?.code ? `invoicer:${result.error.code}` : 'invoicer_error');
    }
    return result.data;
  }

  const ws = (id) => '/v1/workspaces/' + encodeURIComponent(String(id));

  return {
    request,
    async findWorkspace(propertyId) {
      const rows = await request('/v1/workspaces?sourceId=' + encodeURIComponent(String(propertyId)));
      return rows[0] || null;
    },
    async requireWorkspace(propertyId) {
      const w = await this.findWorkspace(propertyId);
      if (!w) throw failure('הנכס עדיין לא חובר למערכת החשבוניות — חיבור נעשה פעם אחת בהגדרות › מסמכים', 409, 'invoicer_not_connected');
      return w;
    },
    async connectWorkspace(property, input) {
      return request('/v1/workspaces', { method: 'POST', body: { sourceId: String(property._id), name: property.name, ...input } });
    },
    async overview(propertyId) {
      const w = await this.requireWorkspace(propertyId);
      return request(ws(w._id) + '/overview');
    },
    // A customer per payer, found again by externalId so repeated stays do not pile up duplicates.
    async ensureCustomer(workspaceId, customer) {
      const rows = await request(ws(workspaceId) + '/customers?q=' + encodeURIComponent(customer.name.slice(0, 80)));
      const same = rows.find((c) => c.externalId === customer.externalId);
      if (same) {
        const changed = ['name', 'kind', 'taxId', 'email', 'phone', 'address', 'city'].some((k) => (same[k] || '') !== (customer[k] || ''));
        return changed ? request(ws(workspaceId) + '/customers/' + same._id, { method: 'PATCH', body: customer }) : same;
      }
      return request(ws(workspaceId) + '/customers', { method: 'POST', body: customer });
    },
    async createDraft(workspaceId, body, idempotencyKey) {
      return request(ws(workspaceId) + '/documents', { method: 'POST', body, idempotencyKey });
    },
    async issue(workspaceId, documentId, idempotencyKey) {
      return request(ws(workspaceId) + '/documents/' + documentId + '/issue', { method: 'POST', body: {}, idempotencyKey });
    },
    async forwardEvent(event) {
      const w = await this.requireWorkspace(event.property);
      return request(ws(w._id) + '/events', {
        method: 'POST', idempotencyKey: 'hotel4u:' + event._id,
        body: { type: event.type, sourceId: String(event.sourceId), payload: event.payload || {} },
      });
    },
  };
}

export const invoicerConfigured = () => Boolean(process.env.INVOICER_API_URL && process.env.INVOICER_API_KEY);
export const invoicerClient = () => createInvoicerClient({ baseUrl: process.env.INVOICER_API_URL, apiKey: process.env.INVOICER_API_KEY });
