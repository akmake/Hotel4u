// Israel Tax Authority — "Israel invoices" allocation numbers (spec FIN-10; ITA "Israel Invoice Model
// API Description" v2.0 7/2024).
//
//  - OAuth2 authorization-code flow ("long time access"): the business authorises once in its
//    personal area; the refresh token is kept sealed (utils/secretBox) on the property.
//  - Approval v2: one request per invoice, invoice_id = our document id (single-value id), all field
//    names lower-case, invoice_reference_number mandatory. 200 + approved → the confirmation
//    number is stored (the 9 right-most digits are printed under "מספר הקצאה"). 200 + code
//    460/461 → the invoice is HELD: the business must choose cancel / continue without a number /
//    hearing, and the choice is reported (InvoiceDecisionApi). 400 → data error (no automatic retry).
//    401 → refresh the token once. 5xx / network → stays pending and the scheduler retries.
//  - Nothing here invents a number: without an approved response the document stays pending.
//
// Configuration (server env): ITA_CLIENT_ID, ITA_CLIENT_SECRET, ITA_REDIRECT_URI, ITA_SCOPE (default
// "scope"), ITA_ENV (sandbox|production, default sandbox), optional ITA_AUTH_BASE / ITA_API_BASE
// overrides, SOFTWARE_VENDOR_ID (company number of the software producer — used as
// accounting_software_number until the software has a registration certificate).
import crypto from 'crypto';
import Property from '../models/Property.js';
import Invoice from '../models/Invoice.js';
import ItaAuthState from '../models/ItaAuthState.js';
import { seal, open } from '../utils/secretBox.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';
import { raiseWork } from './platformService.js';

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const ITA_DOC_CODES = { tax_invoice: 305, tax_invoice_receipt: 320, credit_note: 330, proforma: 332 };
export const HEARING_PORTAL_URL = 'https://secapp.taxes.gov.il/srRishum/main/openPage';
const RETRY_MINUTES = [5, 15, 60, 180, 720];

export function itaConfig(env) {
  const e = env === 'production' ? 'production' : 'sandbox';
  const seg = e === 'production' ? 'production' : 'tsandbox';
  return {
    env: e,
    clientId: process.env.ITA_CLIENT_ID || '',
    clientSecret: process.env.ITA_CLIENT_SECRET || '',
    redirectUri: process.env.ITA_REDIRECT_URI || '',
    scope: process.env.ITA_SCOPE || 'scope',
    authBase: (process.env.ITA_AUTH_BASE || `https://openapi.taxes.gov.il/shaam/${seg}`).replace(/\/+$/, ''),
    apiBase: (process.env.ITA_API_BASE || `https://ita-api.taxes.gov.il/shaam/${seg}`).replace(/\/+$/, ''),
    vendorId: digits(process.env.SOFTWARE_VENDOR_ID),
  };
}

export function itaConfigured() {
  const c = itaConfig();
  return !!(c.clientId && c.clientSecret && c.redirectUri);
}

async function postForm(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}

// ── Connection (FIN-10-A03) ─────────────────────────────────────────────────
export async function connectUrl({ propertyId, actor, env }) {
  const c = itaConfig(env);
  if (!c.clientId || !c.clientSecret || !c.redirectUri) {
    throw httpError('החיבור לרשות המסים לא הוגדר בשרת (ITA_CLIENT_ID / ITA_CLIENT_SECRET / ITA_REDIRECT_URI) — יש לרשום אפליקציה בפורטל המפתחים של רשות המסים', 409, { code: 'ita_not_configured' });
  }
  const state = crypto.randomBytes(24).toString('hex');
  await ItaAuthState.create({ state, property: propertyId, user: actor.id || undefined, userName: actor.name, expiresAt: new Date(Date.now() + 15 * 60000) });
  await Property.updateOne({ _id: propertyId }, { $set: { 'fiscal.ita.env': c.env } });
  const q = new URLSearchParams({ response_type: 'code', client_id: c.clientId, scope: c.scope, redirect_uri: c.redirectUri, state });
  return { url: `${c.authBase}/longtimetoken/oauth2/authorize?${q.toString()}` };
}

function tokenUpdate(json, prev = {}) {
  const set = { 'fiscal.ita.connected': true, 'fiscal.ita.lastError': null };
  if (json.access_token) set['fiscal.ita.accessToken'] = seal(json.access_token);
  if (json.refresh_token) set['fiscal.ita.refreshToken'] = seal(json.refresh_token);
  else if (prev.refreshToken) set['fiscal.ita.refreshToken'] = prev.refreshToken;
  const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600;
  set['fiscal.ita.expiresAt'] = new Date(Date.now() + (ttl - 60) * 1000);
  return set;
}

// OAuth redirect target (public route — the state proves who started it).
export async function completeConnect({ state, code, error }) {
  const row = state ? await ItaAuthState.findOneAndDelete({ state: String(state), expiresAt: { $gt: new Date() } }).lean() : null;
  if (!row) throw httpError('קישור החיבור פג תוקף או אינו תקף — התחילו שוב מהגדרות', 400);
  const property = await Property.findById(row.property).select('fiscal').lean();
  if (error || !code) {
    await Property.updateOne({ _id: row.property }, { $set: { 'fiscal.ita.lastError': `ההזדהות בוטלה או נכשלה${error ? ` (${String(error).slice(0, 60)})` : ''}`, 'fiscal.ita.lastErrorAt': new Date() } });
    return { propertyId: String(row.property), ok: false };
  }
  const c = itaConfig(property?.fiscal?.ita?.env);
  const r = await postForm(`${c.authBase}/longtimetoken/oauth2/token`, { grant_type: 'authorization_code', code: String(code), redirect_uri: c.redirectUri, scope: c.scope }, {
    Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,
  });
  if (r.status !== 200 || !r.json?.access_token) {
    await Property.updateOne({ _id: row.property }, { $set: { 'fiscal.ita.connected': false, 'fiscal.ita.lastError': `קבלת אסימון נכשלה (${r.status})`, 'fiscal.ita.lastErrorAt': new Date() } });
    return { propertyId: String(row.property), ok: false };
  }
  await Property.updateOne({ _id: row.property }, { $set: { ...tokenUpdate(r.json), 'fiscal.ita.connectedAt': new Date(), 'fiscal.ita.connectedBy': row.userName || null, 'fiscal.allocationMode': 'api' } });
  await audit({ property: row.property, actor: row.user, actorName: row.userName, action: 'fiscal.ita_connected', entityType: 'Property', entityId: row.property, after: { env: c.env } });
  // Documents that waited for the connection are requested now.
  retryPending({ propertyId: String(row.property), force: true }).catch(() => null);
  return { propertyId: String(row.property), ok: true };
}

export async function disconnect({ propertyId, actor, ip }) {
  await Property.updateOne({ _id: propertyId }, { $set: { 'fiscal.ita.connected': false, 'fiscal.allocationMode': 'manual' }, $unset: { 'fiscal.ita.accessToken': 1, 'fiscal.ita.refreshToken': 1, 'fiscal.ita.expiresAt': 1 } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'fiscal.ita_disconnected', entityType: 'Property', entityId: propertyId, ip });
  return { connected: false };
}

async function connectionLost(propertyId, why) {
  await Property.updateOne({ _id: propertyId }, { $set: { 'fiscal.ita.connected': false, 'fiscal.ita.lastError': why, 'fiscal.ita.lastErrorAt': new Date() } });
  await raiseWork({ propertyId, kind: 'finance', severity: 'urgent', title: 'החיבור לרשות המסים נותק — מספרי הקצאה לא מתקבלים', body: why, source: { type: 'fiscal', id: String(propertyId), label: 'רשות המסים', link: '/pms/admin/fiscal' }, dedupeKey: 'ita:connection' }).catch(() => null);
}

async function accessToken(propertyId) {
  const p = await Property.findById(propertyId).select('fiscal').lean();
  const ita = p?.fiscal?.ita || {};
  if (!ita.connected) return null;
  const token = open(ita.accessToken);
  if (token && ita.expiresAt && new Date(ita.expiresAt) > new Date()) return token;
  return refreshToken(propertyId, ita);
}

async function refreshToken(propertyId, ita) {
  const c = itaConfig(ita.env);
  const rt = open(ita.refreshToken);
  if (!rt) { await connectionLost(propertyId, 'אין אסימון רענון — יש להתחבר מחדש'); return null; }
  const r = await postForm(`${c.authBase}/longtimetoken/oauth2/token`, { grant_type: 'refresh_token', refresh_token: rt, client_id: c.clientId, client_secret: c.clientSecret, scope: c.scope });
  if (r.status !== 200 || !r.json?.access_token) {
    await connectionLost(propertyId, `רענון האסימון נכשל (${r.status}) — יש להתחבר מחדש לרשות המסים`);
    return null;
  }
  await Property.updateOne({ _id: propertyId }, { $set: tokenUpdate(r.json, ita) });
  return r.json.access_token;
}

export async function connectionStatus(propertyId) {
  const p = await Property.findById(propertyId).select('fiscal taxNumber').lean();
  const f = p?.fiscal || {};
  return {
    configured: itaConfigured(),
    mode: f.allocationMode || 'manual',
    connected: !!f.ita?.connected,
    env: f.ita?.env || itaConfig().env,
    connectedAt: f.ita?.connectedAt || null,
    connectedBy: f.ita?.connectedBy || null,
    lastError: f.ita?.lastError || null,
    lastErrorAt: f.ita?.lastErrorAt || null,
    operatorId: f.operatorId || null,
    softwareRegNumber: f.softwareRegNumber || null,
    hearingPortal: HEARING_PORTAL_URL,
  };
}

// ── Approval v2 (Table 2.1 / 2.2) ───────────────────────────────────────────
export function approvalPayload(doc, property, actor) {
  const c = itaConfig(property?.fiscal?.ita?.env);
  const operator = digits(property?.fiscal?.operatorId);
  const body = {
    invoice_id: String(doc._id),
    invoice_type: ITA_DOC_CODES[doc.type] || 305,
    vat_number: Number(digits(doc.seller?.vatNumber || property?.taxNumber)),
    invoice_reference_number: String(doc.invoiceNumber),
    customer_vat_number: Number(digits(doc.buyer?.vatNumber)),
    customer_name: String(doc.buyer?.name || '').slice(0, 25),
    invoice_date: doc.issueDate,
    invoice_issuance_date: doc.issueDate,
    accounting_software_number: Number(digits(property?.fiscal?.softwareRegNumber) || c.vendorId || digits(property?.taxNumber)),
    amount_before_discount: round2(doc.totalNet + (doc.totalDiscount || 0)),
    discount: round2(Math.abs(doc.totalDiscount || 0)),
    payment_amount: round2(doc.totalNet),
    vat_amount: round2(doc.totalVat),
    payment_amount_including_vat: round2(doc.totalGross),
    items: (doc.lines || []).slice(0, 999).map((l, i) => ({
      index: i + 1,
      category: 2, // services
      description: String(l.description || '').slice(0, 30),
      quantity: round2(l.quantity || 1),
      price_per_unit: round2(l.unitPrice),
      discount: 0,
      total_amount: round2(l.netAmount),
      vat_rate: round2(l.vatRate),
      vat_amount: round2(l.vatAmount),
    })),
  };
  if (operator.length === 9) body.user_id = Number(operator);
  else body.user_name = String(actor?.name || 'hotel4u').slice(0, 25);
  if (doc.notes) body.invoice_note = String(doc.notes).slice(0, 100);
  return body;
}

function firstError(json) {
  const errs = json?.message?.errors;
  if (Array.isArray(errs) && errs.length) return { code: Number(errs[0].code), text: `${errs[0].code} — ${errs[0].message}${errs[0].param ? ` (${errs[0].param})` : ''}` };
  return null;
}

// Ask the Tax Authority for this document's allocation number. Returns the decision applied.
export async function requestAllocation({ invoiceId, actor = {} }) {
  const doc = await Invoice.findById(invoiceId).lean();
  if (!doc) return { outcome: 'missing' };
  if (doc.allocationStatus === 'approved') return { outcome: 'approved', number: doc.allocationNumber };
  const property = await Property.findById(doc.property).select('taxNumber fiscal').lean();
  if (property?.fiscal?.allocationMode !== 'api') return { outcome: 'manual' };
  const c = itaConfig(property?.fiscal?.ita?.env);
  const now = new Date();
  const attempts = Number(doc.allocationAttempts || 0) + 1;
  const later = (why, retry = true) => Invoice.updateOne({ _id: doc._id }, { $set: {
    allocationStatus: 'pending', allocationLastError: why, allocationAttempts: attempts, allocationRetry: retry, allocationRequestedAt: now,
    allocationNextTryAt: retry ? new Date(Date.now() + RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)] * 60000) : null,
  } });
  let token = await accessToken(doc.property);
  if (!token) { await later('אין חיבור פעיל לרשות המסים'); return { outcome: 'not_connected' }; }
  const payload = approvalPayload(doc, property, actor);
  const send = (t) => fetch(`${c.apiBase}/Invoices/v2/Approval`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  let res;
  try {
    res = await send(token);
    if (res.status === 401) {
      const p2 = await Property.findById(doc.property).select('fiscal').lean();
      token = await refreshToken(doc.property, p2?.fiscal?.ita || {});
      if (!token) { await later('ההרשאה מול רשות המסים פגה — יש להתחבר מחדש'); return { outcome: 'not_connected' }; }
      res = await send(token);
    }
  } catch (e) {
    await later(`תקלת תקשורת: ${String(e?.message || e).slice(0, 120)}`);
    return { outcome: 'retry' };
  }
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  const err = firstError(json);
  if (res.status === 200 && json?.approved === true && json.confirmation_number && String(json.confirmation_number) !== '0') {
    const full = String(json.confirmation_number);
    const short = full.slice(-9);
    await Invoice.updateOne({ _id: doc._id }, { $set: {
      allocationStatus: 'approved', allocationNumber: short, allocationFullNumber: full, allocationSource: 'api', allocationReceivedAt: new Date(),
      allocationRequestedAt: now, allocationAttempts: attempts, allocationLastError: null, allocationNextTryAt: null, allocationRejectReason: null,
    } });
    await audit({ property: doc.property, actor: actor.id, actorName: actor.name || 'system', action: 'invoice.allocation_set', entityType: 'Invoice', entityId: doc._id, after: { number: doc.invoiceNumber, allocationNumber: short, source: 'api' } });
    return { outcome: 'approved', number: short };
  }
  if (res.status === 200 && err && [460, 461, 462].includes(err.code)) {
    // Held for substantive reasons — the business must choose how to continue (§2.2.2).
    await Invoice.updateOne({ _id: doc._id }, { $set: {
      allocationStatus: 'rejected', allocationRejectReason: err.code === 460 ? 'רשות המסים לא אישרה את החשבונית (460)' : err.text, allocationLastError: err.text,
      allocationRequestedAt: now, allocationAttempts: attempts, allocationRetry: false, allocationNextTryAt: null,
      ...(err.code === 462 ? { allocationDecisionSent: true } : {}),
    } });
    await audit({ property: doc.property, actor: actor.id, actorName: actor.name || 'system', action: 'invoice.allocation_rejected', entityType: 'Invoice', entityId: doc._id, reason: err.text, after: { number: doc.invoiceNumber, source: 'api' } });
    await raiseWork({ propertyId: String(doc.property), kind: 'finance', severity: 'urgent', title: `חשבונית ${doc.invoiceNumber} לא קיבלה מספר הקצאה — נדרשת החלטה`, body: err.text, source: { type: 'invoice', id: String(doc._id), label: doc.invoiceNumber, link: '/pms/invoices?view=rejected' }, dedupeKey: `alloc:${doc._id}` }).catch(() => null);
    return { outcome: 'held', reason: err.text };
  }
  if (res.status === 400 || res.status === 422) {
    await later(`הבקשה נדחתה בגלל נתונים: ${err?.text || res.status}`, false);
    return { outcome: 'data_error', reason: err?.text || String(res.status) };
  }
  if (res.status === 403 || res.status === 406) {
    await later(`אין הרשאה לשירות עבור העוסק (${res.status}) — בדקו את ההרשאה באזור האישי`, false);
    return { outcome: 'forbidden' };
  }
  await later(`השירות לא זמין (${res.status})`);
  return { outcome: 'retry' };
}

// Scheduler + "connected now": retry pending documents whose retry time came.
export async function retryPending({ propertyId, force = false } = {}) {
  const filter = { allocationStatus: 'pending', allocationRetry: { $ne: false } };
  if (propertyId) filter.property = propertyId;
  if (!force) filter.$or = [{ allocationNextTryAt: null }, { allocationNextTryAt: { $exists: false } }, { allocationNextTryAt: { $lte: new Date() } }];
  const apiProps = await Property.find({ 'fiscal.allocationMode': 'api', 'fiscal.ita.connected': true, ...(propertyId ? { _id: propertyId } : {}) }).select('_id').lean();
  if (!apiProps.length) return { tried: 0 };
  filter.property = propertyId || { $in: apiProps.map((p) => p._id) };
  const docs = await Invoice.find(filter).select('_id').sort({ createdAt: 1 }).limit(50).lean();
  let approved = 0;
  for (const d of docs) {
    const r = await requestAllocation({ invoiceId: d._id }).catch(() => ({ outcome: 'error' }));
    if (r.outcome === 'approved') approved += 1;
  }
  return { tried: docs.length, approved };
}

// §4: report the business's decision on a held invoice.
export async function sendDecision({ doc, decision, actor }) {
  const property = await Property.findById(doc.property).select('taxNumber fiscal').lean();
  if (property?.fiscal?.allocationMode !== 'api') return { sent: false, reason: 'manual' };
  const c = itaConfig(property?.fiscal?.ita?.env);
  const token = await accessToken(doc.property);
  if (!token) return { sent: false, reason: 'not_connected' };
  const path = { cancel: 'Cancel', continue: 'Continue', hearing: 'FurtherObjection' }[decision];
  const operator = digits(property?.fiscal?.operatorId);
  const body = {
    invoice_id: String(doc._id), vat_number: Number(digits(doc.seller?.vatNumber || property?.taxNumber)),
    accounting_software_number: Number(digits(property?.fiscal?.softwareRegNumber) || c.vendorId || digits(property?.taxNumber)),
    ...(operator.length === 9 ? { user_id: Number(operator) } : { user_name: String(actor?.name || 'hotel4u').slice(0, 25) }),
  };
  try {
    const res = await fetch(`${c.apiBase}/InvoiceDecisionApi/v1/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    let json = null;
    try { json = await res.json(); } catch { /* not json */ }
    return { sent: res.status === 200, reason: res.status === 200 ? null : (firstError(json)?.text || String(res.status)) };
  } catch (e) {
    return { sent: false, reason: String(e?.message || e).slice(0, 120) };
  }
}
