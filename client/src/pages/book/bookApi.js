// Public booking site API — plain fetch (no login, no cookies). Errors keep the server's message and fields.
const BASE = `${import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '') : '/api'}/public/booking`;

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' });
  } catch {
    throw Object.assign(new Error('אין חיבור לאינטרנט — נסו שוב'), { status: 0 });
  }
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok || json?.success === false) {
    throw Object.assign(new Error(json?.error || 'אירעה תקלה — נסו שוב'), { status: res.status, code: json?.code, fields: json?.fields || {}, details: json?.details });
  }
  return json?.data;
}

const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

export const bookApi = {
  site: (p) => call('GET', `/site?${qs({ p })}`),
  search: (p, q) => call('GET', `/search?${qs({ p, ...q })}`),
  start: (p, body) => call('POST', `/start?${qs({ p })}`, body),
  session: (token) => call('GET', `/session/${encodeURIComponent(token)}`),
  complete: (token) => call('POST', `/session/${encodeURIComponent(token)}/complete`, {}),
  retry: (token) => call('POST', `/session/${encodeURIComponent(token)}/retry`, {}),
  mockPay: (token, outcome) => call('POST', `/session/${encodeURIComponent(token)}/mock-pay`, { outcome }),
};

export function money(n, currency = 'ILS') {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n || 0));
}
export const longDate = (ymd) => (ymd ? new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`)) : '');
export const shortDate = (ymd) => (ymd ? new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`)) : '');
export const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const nightsBetween = (a, b) => (a && b ? Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) : 0);
export const guestsLabel = (adults, children) => `${adults} ${Number(adults) === 1 ? 'מבוגר' : 'מבוגרים'}${Number(children) ? ` · ${children} ${Number(children) === 1 ? 'ילד' : 'ילדים'}` : ''}`;

// Search parameters live in the URL so a search can be shared, refreshed and reached back.
export function readSearch(sp) {
  const ages = (sp.get('ages') || '').split(',').filter((x) => x !== '').map(Number);
  return {
    arrival: sp.get('arrival') || '', departure: sp.get('departure') || '',
    adults: Math.max(1, Number(sp.get('adults')) || 2), children: Math.max(0, Number(sp.get('children')) || 0), ages,
  };
}
export function searchQuery(s, extra = {}) {
  return qs({ arrival: s.arrival, departure: s.departure, adults: s.adults, children: s.children || undefined, ages: s.children ? s.ages.slice(0, s.children).join(',') : undefined, ...extra });
}
