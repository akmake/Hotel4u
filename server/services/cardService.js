// Cards through the property's clearing provider (gap-map item 12): card on file (token + last 4 only),
// card check, authorization at check-in with top-up when the stay's exposure passes it, charging the
// folio (capture from the authorization, or a sale), refund to the same card, and card companies as
// debtors (what the provider owes per day and brand until the deposit arrives).
// Money rule: the provider moves money first; the folio line is then written through financeService.
// If that write fails, the provider action is reversed — or the transaction is flagged for a manual fix.
import crypto from 'crypto';
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import Reservation from '../models/Reservation.js';
import Folio from '../models/Folio.js';
import GuestProfile from '../models/GuestProfile.js';
import { PaymentCard, CardAuthorization, CardTransaction, CardSettlement } from '../models/Payments.js';
import { adapterFor, PROVIDERS, providerList, MOCK_CARDS } from './cardGateway.js';
import { recordFolioPayment, refundPayment, REFUND_ROLES } from './financeService.js';
import { planNights } from './roomCharges.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf, MANAGER_ROLES } from './frontDeskService.js';
import { can } from './permissionService.js';
import { seal, open as unseal } from '../utils/secretBox.js';

export const CARD_ROLES = [...new Set([...MANAGER_ROLES, 'receptionist', 'cashier', 'finance_manager'])];
export const SETTLE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const mustWork = (actor) => { if (!CARD_ROLES.includes(actor?.role)) throw httpError('פעולות כרטיס — לקבלה, לקופה או לכספים', 403); };
const mustSettle = (actor) => { if (!can(actor, 'card.settle', SETTLE_ROLES)) throw httpError('הגדרות סליקה והפקדות — למנהל או לכספים', 403); };
const log = (propertyId, actor, ip, action, entityType, entityId, before, after, reason) => audit({ property: propertyId, actor: actor?.id, actorName: actor?.name, action, entityType, entityId, before, after, reason, ip });
// financeService idempotency keys allow letters, digits, - and _ (8–80).
const opKey = (kind, ref) => `${kind}-${String(ref).replace(/[^A-Za-z0-9_-]/g, '-')}`.slice(0, 80);
const declined = (msg) => httpError(msg || 'העסקה סורבה', 402, { code: 'declined' });
const nightsBetween = (a, b) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));

async function loadProperty(propertyId) {
  const p = await Property.findById(propertyId).select('payments timezone dayClose').lean();
  if (!p) throw httpError('הנכס לא נמצא', 404);
  return p;
}
const cardDto = (c) => ({
  id: String(c._id), last4: c.last4, brand: c.brand, expMonth: c.expMonth, expYear: c.expYear, holderName: c.holderName || '', status: c.status, provider: c.provider,
  guest: c.guest ? String(c.guest) : null, lastCheck: c.lastCheck ? { at: c.lastCheck.at, ok: c.lastCheck.ok, message: c.lastCheck.message } : null, createdAt: c.createdAt,
});
const tokenOf = (card) => unseal(card.token);

// ── Settings ────────────────────────────────────────────────────────────────

export async function getSettings({ propertyId }) {
  const p = await loadProperty(propertyId);
  const cfg = p.payments || {};
  const provider = cfg.provider || 'mock';
  return {
    provider, mode: cfg.mode || 'test', credentialsSet: !!cfg.credentials, authOnCheckIn: cfg.authOnCheckIn !== false,
    authBasis: cfg.authBasis || 'stay', authAmount: cfg.authAmount ?? null, incidentals: cfg.incidentals ?? 0,
    providers: providerList(), available: (() => { try { adapterFor(p); return true; } catch { return false; } })(),
    testCards: provider === 'mock' ? Object.entries(MOCK_CARDS).map(([number, t]) => ({ number, brand: t.brand, label: t.label })) : [],
  };
}

export async function saveSettings({ propertyId, body, actor, ip }) {
  mustSettle(actor);
  const b = body || {};
  const prop = await Property.findById(propertyId);
  if (!prop) throw httpError('הנכס לא נמצא', 404);
  const provider = String(b.provider || 'mock');
  const adapter = PROVIDERS[provider];
  if (!adapter) throw httpError('ספק לא מוכר', 422, { fields: { provider: 'לא מחובר במערכת' } });
  const mode = b.mode === 'live' ? 'live' : 'test';
  if (provider === 'mock' && mode === 'live') throw httpError('ספק הבדיקה אינו יכול לעבוד במצב אמיתי', 422, { fields: { mode: 'בדיקה בלבד' } });
  const basis = ['stay', 'per_night', 'fixed'].includes(b.authBasis) ? b.authBasis : 'stay';
  const amount = b.authAmount === '' || b.authAmount == null ? undefined : Number(b.authAmount);
  if (basis !== 'stay' && !(amount > 0)) throw httpError('סכום מסגרת חובה', 422, { fields: { authAmount: 'סכום חיובי' } });
  const incidentals = Number(b.incidentals || 0);
  if (!(incidentals >= 0)) throw httpError('תוספת לא תקינה', 422, { fields: { incidentals: 'אפס ומעלה' } });
  const before = prop.payments ? { provider: prop.payments.provider, mode: prop.payments.mode, authBasis: prop.payments.authBasis } : null;
  const next = { ...(prop.payments?.toObject?.() || {}), provider, mode, authOnCheckIn: b.authOnCheckIn !== false, authBasis: basis, authAmount: amount, incidentals, updatedByName: actor.name };
  if (b.credentials && typeof b.credentials === 'object') {
    const clean = Object.fromEntries(adapter.credentialFields.map((f) => [f.key, String(b.credentials[f.key] || '').trim()]).filter(([, v]) => v));
    next.credentials = Object.keys(clean).length ? seal(JSON.stringify(clean)) : undefined;
  }
  if (before?.provider && before.provider !== provider) next.credentials = b.credentials ? next.credentials : undefined;
  prop.payments = next;
  await prop.save();
  await log(propertyId, actor, ip, 'card.settings', 'Property', propertyId, before, { provider, mode, authBasis: basis, authAmount: amount, incidentals, credentialsChanged: !!b.credentials });
  return getSettings({ propertyId });
}

// ── Cards on file ───────────────────────────────────────────────────────────

export async function startCapture({ propertyId, guestId, reservationId, returnUrl, actor }) {
  mustWork(actor);
  const property = await loadProperty(propertyId);
  const { adapter, cfg } = adapterFor(property);
  let guest = guestId;
  if (reservationId) {
    const r = isId(reservationId) ? await Reservation.findOne({ _id: reservationId, property: propertyId }).select('primaryGuest').lean() : null;
    if (!r) throw httpError('ההזמנה לא נמצאה', 404);
    guest = r.primaryGuest;
  }
  if (!guest || !(await GuestProfile.exists({ _id: guest, property: propertyId }))) throw httpError('האורח לא נמצא', 404);
  const sessionToken = crypto.randomBytes(16).toString('hex');
  const card = await PaymentCard.create({ property: propertyId, guest, provider: adapter.name, status: 'pending', capture: { token: sessionToken, expiresAt: new Date(Date.now() + 15 * 60000), reservation: reservationId || undefined }, addedByName: actor.name });
  const { url } = adapter.startCapture({ cfg, sessionToken, returnUrl: returnUrl || '/pms/card-capture' });
  return { sessionToken, url, provider: adapter.name, cardId: String(card._id), testCards: adapter.name === 'mock' ? Object.entries(MOCK_CARDS).map(([number, t]) => ({ number, label: t.label })) : [] };
}

export async function finishCapture({ propertyId, sessionToken, payload, actor, ip }) {
  mustWork(actor);
  const card = await PaymentCard.findOne({ property: propertyId, 'capture.token': String(sessionToken || ''), status: 'pending' });
  if (!card) throw httpError('חלון הוספת הכרטיס לא נמצא או כבר הושלם', 404);
  if (card.capture.expiresAt < new Date()) throw httpError('פג תוקף חלון הוספת הכרטיס — פתחו מחדש', 410);
  const property = await loadProperty(propertyId);
  const { adapter, cfg } = adapterFor(property);
  const got = await adapter.finishCapture({ cfg, payload });
  Object.assign(card, { token: seal(got.token), last4: got.last4, brand: got.brand, expMonth: got.expMonth, expYear: got.expYear, holderName: got.holderName, status: 'active' });
  const resId = card.capture.reservation;
  card.capture = undefined;
  await card.save();
  if (resId) await Reservation.updateOne({ _id: resId, property: propertyId }, { $set: { card: { ref: card._id, last4: card.last4, brand: card.brand } } });
  await log(propertyId, actor, ip, 'card.add', 'PaymentCard', card._id, null, { last4: card.last4, brand: card.brand, reservation: resId ? String(resId) : null });
  return cardDto(card);
}

export async function listCards({ propertyId, guestId, reservationId }) {
  let guest = guestId; let current = null;
  if (reservationId) {
    const r = isId(reservationId) ? await Reservation.findOne({ _id: reservationId, property: propertyId }).select('primaryGuest card').lean() : null;
    if (!r) throw httpError('ההזמנה לא נמצאה', 404);
    guest = r.primaryGuest; current = r.card?.ref ? String(r.card.ref) : null;
  }
  if (!isId(guest)) throw httpError('אורח לא תקין', 422);
  const rows = await PaymentCard.find({ property: propertyId, guest, status: 'active' }).sort({ createdAt: -1 }).lean();
  return { cards: rows.map((c) => ({ ...cardDto(c), onReservation: current === String(c._id) })), reservationCard: current };
}

async function loadCard(propertyId, id) {
  const c = isId(id) ? await PaymentCard.findOne({ _id: id, property: propertyId, status: 'active' }) : null;
  if (!c) throw httpError('הכרטיס לא נמצא', 404);
  return c;
}

export async function setReservationCard({ propertyId, reservationId, cardId, actor, ip }) {
  mustWork(actor);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId });
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  const card = await loadCard(propertyId, cardId);
  if (String(card.guest) !== String(res.primaryGuest)) throw httpError('הכרטיס שייך לאורח אחר', 422);
  if (await CardAuthorization.exists({ reservation: res._id, status: 'active', card: { $ne: card._id } })) throw httpError('יש מסגרת פעילה על כרטיס אחר — שחררו אותה קודם', 409);
  res.card = { ref: card._id, last4: card.last4, brand: card.brand };
  await res.save();
  await log(propertyId, actor, ip, 'card.reservation_set', 'Reservation', res._id, null, { last4: card.last4 });
  return { ok: true };
}

export async function removeCard({ propertyId, cardId, actor, ip }) {
  mustWork(actor);
  const card = await loadCard(propertyId, cardId);
  if (await CardAuthorization.exists({ card: card._id, status: 'active' })) throw httpError('יש על הכרטיס מסגרת פעילה — שחררו אותה קודם', 409);
  card.status = 'removed'; card.token = undefined; card.removedByName = actor.name;
  await card.save();
  await Reservation.updateMany({ property: propertyId, 'card.ref': card._id }, { $unset: { card: 1 } });
  await log(propertyId, actor, ip, 'card.remove', 'PaymentCard', card._id, { last4: card.last4 }, null);
  return { removed: true };
}

export async function verifyCard({ propertyId, cardId, actor, ip }) {
  mustWork(actor);
  const card = await loadCard(propertyId, cardId);
  const { adapter, cfg } = adapterFor(await loadProperty(propertyId));
  const r = await adapter.verify({ cfg, token: tokenOf(card) });
  card.lastCheck = { at: new Date(), ok: !!r.ok, message: r.message || '', by: actor.name };
  await card.save();
  await log(propertyId, actor, ip, 'card.verify', 'PaymentCard', card._id, null, { ok: !!r.ok });
  return cardDto(card);
}

// ── Authorization ("מסגרת") ────────────────────────────────────────────────

// What the stay may still cost: open balance on the guest's windows + nights not yet posted + extras allowance.
export async function exposureOf(res, property) {
  const folios = await Folio.find({ reservation: res._id, ownerType: { $in: ['guest', 'room'] } }).select('lines status').lean();
  const balance = round2(folios.flatMap((f) => f.lines || []).filter((l) => l.status === 'posted').reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0));
  const today = businessDateOf(property);
  const inHouse = ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'].includes(res.status);
  // In house: what is open now + nights not yet posted. Before arrival: the stay's price minus what was paid.
  const future = inHouse ? (await planNights({ reservation: res, until: res.departureDate })).gross : 0;
  const due = inHouse ? balance + future : Math.max(0, Number(res.totalAmount || 0) + balance);
  const nightsLeft = nightsBetween(today > res.arrivalDate ? today : res.arrivalDate, res.departureDate) || 1;
  const extras = round2(Number(property.payments?.incidentals || 0) * nightsLeft);
  return { balance, future: round2(future), extras, total: round2(Math.max(0, due + extras)), nightsLeft };
}

function policyAmount(property, res, exposure) {
  const p = property.payments || {};
  const nights = nightsBetween(res.arrivalDate, res.departureDate) || 1;
  if (p.authBasis === 'fixed') return round2(Number(p.authAmount || 0));
  if (p.authBasis === 'per_night') return round2((Number(p.authAmount || 0) + Number(p.incidentals || 0)) * nights);
  return exposure.total;
}

export async function authorize({ propertyId, reservationId, cardId, amount, actor, ip }) {
  mustWork(actor);
  const property = await loadProperty(propertyId);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).lean();
  if (!res || ['cancelled', 'no_show', 'deleted', 'checked_out'].includes(res.status)) throw httpError('מסגרת נלקחת רק להזמנה פעילה', 409);
  const card = await loadCard(propertyId, cardId || res.card?.ref);
  if (String(card.guest) !== String(res.primaryGuest)) throw httpError('הכרטיס שייך לאורח אחר', 422);
  const exposure = await exposureOf(res, property);
  const target = round2(amount != null && amount !== '' ? Number(amount) : policyAmount(property, res, exposure));
  if (!(target > 0)) throw httpError('אין סכום למסגרת', 422, { fields: { amount: 'סכום חיובי' } });
  const { adapter, cfg } = adapterFor(property);
  let auth = await CardAuthorization.findOne({ reservation: res._id, status: 'active' });
  if (auth && String(auth.card) !== String(card._id)) throw httpError('יש מסגרת פעילה על כרטיס אחר', 409);
  if (auth) {
    const add = round2(target - auth.amount);
    if (add <= 0) return authDto(auth, exposure);
    const r = await adapter.increment({ cfg, token: tokenOf(card), ref: auth.providerRef, amount: add, total: target });
    auth.history.push({ at: new Date(), kind: 'increment', amount: add, approval: r.approval, ok: !!r.ok, message: r.message, by: actor.name });
    if (r.ok) auth.amount = target;
    await auth.save();
    await log(propertyId, actor, ip, r.ok ? 'card.auth_increment' : 'card.auth_declined', 'CardAuthorization', auth._id, null, { add, total: target });
    if (!r.ok) throw declined(r.message);
    return authDto(auth, exposure);
  }
  const r = await adapter.authorize({ cfg, token: tokenOf(card), amount: target });
  await log(propertyId, actor, ip, r.ok ? 'card.auth' : 'card.auth_declined', 'Reservation', res._id, null, { amount: target, last4: card.last4 });
  if (!r.ok) throw declined(r.message);
  auth = await CardAuthorization.create({ property: propertyId, reservation: res._id, card: card._id, providerRef: r.ref, amount: target, history: [{ at: new Date(), kind: 'authorize', amount: target, approval: r.approval, ok: true, by: actor.name }] });
  if (!res.card?.ref) await Reservation.updateOne({ _id: res._id }, { $set: { card: { ref: card._id, last4: card.last4, brand: card.brand } } });
  return authDto(auth, exposure);
}

const authDto = (a, exposure) => ({
  id: String(a._id), reservation: String(a.reservation), card: String(a.card), amount: a.amount, captured: a.captured, available: round2(a.amount - a.captured), status: a.status,
  exposure: exposure || null, over: exposure ? round2(exposure.total - (a.amount - a.captured)) > 0.005 : false,
  history: (a.history || []).map((h) => ({ at: h.at, kind: h.kind, amount: h.amount, approval: h.approval, ok: h.ok, message: h.message, by: h.by })),
});

export async function reservationCardState({ propertyId, reservationId }) {
  const property = await loadProperty(propertyId);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).lean();
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  const auth = await CardAuthorization.findOne({ reservation: res._id, status: 'active' }).lean();
  const live = !['cancelled', 'no_show', 'deleted', 'checked_out'].includes(res.status);
  const exposure = live ? await exposureOf(res, property) : null;
  const tx = await CardTransaction.find({ property: propertyId, reservation: res._id }).sort({ createdAt: -1 }).limit(20).lean();
  const refunded = new Map();
  for (const t of tx.filter((x) => x.kind === 'refund' && x.of)) refunded.set(String(t.of), round2((refunded.get(String(t.of)) || 0) + t.amount));
  const folios = await Folio.find({ reservation: res._id, ownerType: { $in: ['guest', 'room'] }, status: { $ne: 'closed' } }).select('ownerType ownerRef account lines').sort({ createdAt: 1 }).lean();
  return {
    folios: folios.map((f, i) => ({ id: String(f._id), label: String(f.ownerRef || '').startsWith('share:') ? `Share · ${f.account?.name || ''}` : String(f.ownerRef || '').startsWith('extra:') ? (f.account?.name || 'חלון נוסף') : f.ownerType === 'room' ? 'חשבון חדר' : (i === 0 ? 'חשבון האורח' : 'חשבון אורח'), balance: round2((f.lines || []).filter((l) => l.status === 'posted').reduce((s2, l) => s2 + Number(l.amount || 0) + Number(l.taxAmount || 0), 0)) })),
    card: res.card?.ref ? { id: String(res.card.ref), last4: res.card.last4, brand: res.card.brand } : null,
    auth: auth ? authDto(auth, exposure) : null, exposure,
    transactions: tx.map((t) => ({ id: String(t._id), kind: t.kind, amount: t.amount, approval: t.approval, last4: t.last4, at: t.createdAt, folio: t.folio ? String(t.folio) : null, folioLine: t.folioLine ? String(t.folioLine) : null, refunded: refunded.get(String(t._id)) || 0, attention: t.attention || null })),
  };
}

// In-house stays: authorization against exposure — which ones passed their authorization and need a top-up.
export async function authBoard({ propertyId }) {
  const property = await loadProperty(propertyId);
  const stays = await Reservation.find({ property: propertyId, status: { $in: ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'] } })
    .select('confirmationNumber primaryGuest arrivalDate departureDate status card ratePerNight totalAmount priceSnapshot shares voucher property tourist ratePlan packageItems adults children currency').populate('primaryGuest', 'firstName lastName').lean();
  const auths = new Map((await CardAuthorization.find({ property: propertyId, status: 'active', reservation: { $in: stays.map((s) => s._id) } }).lean()).map((a) => [String(a.reservation), a]));
  const rows = [];
  for (const s of stays) {
    const a = auths.get(String(s._id));
    if (!a && !s.card?.ref) continue;
    const exposure = await exposureOf(s, property);
    const available = a ? round2(a.amount - a.captured) : 0;
    rows.push({
      reservation: String(s._id), confirmationNumber: s.confirmationNumber, guestName: s.primaryGuest ? `${s.primaryGuest.firstName} ${s.primaryGuest.lastName}` : '', departureDate: s.departureDate,
      card: s.card?.last4 ? `${s.card.brand || ''} ••${s.card.last4}` : null, authorized: a?.amount || 0, available, exposure: exposure.total, gap: round2(exposure.total - available), hasAuth: !!a,
    });
  }
  return rows.sort((x, y) => y.gap - x.gap);
}

export async function topUp({ propertyId, reservationId, actor, ip }) {
  const property = await loadProperty(propertyId);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).lean();
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  const auth = await CardAuthorization.findOne({ reservation: res._id, status: 'active' }).lean();
  const exposure = await exposureOf(res, property);
  const target = round2((auth?.captured || 0) + exposure.total);
  return authorize({ propertyId, reservationId, cardId: auth?.card || res.card?.ref, amount: target, actor, ip });
}

export async function releaseAuth({ propertyId, reservationId, actor, ip, reason = 'שחרור ידני' }) {
  const auth = await CardAuthorization.findOne({ property: propertyId, reservation: reservationId, status: 'active' });
  if (!auth) throw httpError('אין מסגרת פעילה', 404);
  const { adapter, cfg } = adapterFor(await loadProperty(propertyId));
  const r = await adapter.release({ cfg, ref: auth.providerRef });
  auth.history.push({ at: new Date(), kind: 'release', amount: round2(auth.amount - auth.captured), ok: !!r.ok, message: reason, by: actor?.name || 'מערכת' });
  if (r.ok) auth.status = auth.captured > 0 ? 'closed' : 'released';
  await auth.save();
  await log(propertyId, actor || { name: 'מערכת' }, ip, 'card.auth_release', 'CardAuthorization', auth._id, null, { released: round2(auth.amount - auth.captured), reason });
  return authDto(auth);
}

// Stays that left or were cancelled keep no authorization: released automatically (scheduler).
export async function releaseFinished({ propertyId } = {}) {
  const active = await CardAuthorization.find({ ...(propertyId ? { property: propertyId } : {}), status: 'active' }).select('property reservation').lean();
  let n = 0;
  for (const a of active) {
    const r = await Reservation.findById(a.reservation).select('status').lean();
    if (!r || ['checked_out', 'cancelled', 'no_show', 'deleted'].includes(r.status)) {
      try { await releaseAuth({ propertyId: a.property, reservationId: a.reservation, reason: 'השהייה הסתיימה' }); n += 1; } catch { /* next run */ }
    }
  }
  return n;
}

// Check-in: place the authorization when the property asks for one and the stay has a card. Never blocks check-in.
export async function authorizeOnCheckIn({ propertyId, reservationId, actor, ip }) {
  try {
    const property = await loadProperty(propertyId);
    if (property.payments?.authOnCheckIn === false) return null;
    const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).select('card').lean();
    if (!res?.card?.ref) return null;
    const a = await authorize({ propertyId, reservationId, actor, ip });
    return { ok: true, amount: a.amount };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// ── Money ──────────────────────────────────────────────────────────────────

async function bumpSettlement(propertyId, date, brand, delta) {
  const s = await CardSettlement.findOneAndUpdate({ property: propertyId, date, brand: brand || 'other' }, { $inc: { expected: round2(delta) } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  s.status = statusOf(s); await s.save();
}
const statusOf = (s) => (round2(s.deposited + s.fees) >= round2(s.expected) - 0.005 && s.expected > 0 ? 'settled' : s.deposited + s.fees > 0.005 ? 'partial' : 'open');

// Charge a folio to a card: capture from the stay's authorization (topping it up if short) or a sale.
export async function chargeFolio({ propertyId, folioId, cardId, amount, kind = 'payment', actor, ip }) {
  mustWork(actor);
  const folio = isId(folioId) ? await Folio.findOne({ _id: folioId, property: propertyId }).lean() : null;
  if (!folio) throw httpError('החשבון לא נמצא', 404);
  const res = folio.reservation ? await Reservation.findById(folio.reservation).lean() : null;
  const value = round2(amount);
  if (!(value > 0)) throw httpError('סכום חיובי', 422, { fields: { amount: 'סכום חיובי' } });
  const balance = round2((folio.lines || []).filter((l) => l.status === 'posted').reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0));
  if (kind !== 'deposit' && value - balance > 0.005) throw httpError(balance > 0.005 ? `הסכום גבוה מהיתרה (${balance.toFixed(2)})` : 'אין יתרה לתשלום', 422, { fields: { amount: 'גבוה מהיתרה' } });
  const card = await loadCard(propertyId, cardId || res?.card?.ref);
  if (res && String(card.guest) !== String(res.primaryGuest)) throw httpError('הכרטיס שייך לאורח אחר', 422);
  const property = await loadProperty(propertyId);
  const { adapter, cfg } = adapterFor(property);
  const token = tokenOf(card);
  const auth = res ? await CardAuthorization.findOne({ reservation: res._id, status: 'active', card: card._id }) : null;
  let r; let txKind;
  if (auth) {
    const free = round2(auth.amount - auth.captured);
    if (value - free > 0.005) {
      const total = round2(auth.captured + value);
      const inc = await adapter.increment({ cfg, token, ref: auth.providerRef, amount: round2(value - free), total });
      auth.history.push({ at: new Date(), kind: 'increment', amount: round2(value - free), approval: inc.approval, ok: !!inc.ok, message: inc.message, by: actor.name });
      if (!inc.ok) { await auth.save(); throw declined(inc.message); }
      auth.amount = total;
    }
    r = await adapter.capture({ cfg, token, ref: auth.providerRef, amount: value });
    txKind = 'capture';
    auth.history.push({ at: new Date(), kind: 'capture', amount: value, approval: r.approval, ok: !!r.ok, message: r.message, by: actor.name });
    if (r.ok) auth.captured = round2(auth.captured + value);
    await auth.save();
  } else {
    r = await adapter.sale({ cfg, token, amount: value });
    txKind = 'sale';
  }
  if (!r.ok) { await log(propertyId, actor, ip, 'card.charge_declined', 'Folio', folio._id, null, { amount: value, last4: card.last4 }); throw declined(r.message); }
  const businessDate = businessDateOf(property);
  let line;
  try {
    line = await recordFolioPayment({ propertyId, folioId: String(folio._id), input: { kind, amount: value, method: 'credit_card', details: { last4: card.last4, cardBrand: card.brand, approval: r.approval, installments: 1 }, idempotencyKey: opKey('card', r.ref) }, actor, ip });
  } catch (err) {
    // The provider took the money but the folio refused the line: give it back, or flag it.
    const back = await Promise.resolve().then(() => adapter.refund({ cfg, ref: r.ref, amount: value })).catch(() => ({ ok: false }));
    await CardTransaction.create({ property: propertyId, kind: txKind, card: card._id, reservation: res?._id, folio: folio._id, providerRef: r.ref, approval: r.approval, amount: value, brand: card.brand, last4: card.last4, businessDate, byName: actor.name, attention: back.ok ? `הוחזר לכרטיס: ${err.message}` : `לא נרשם בחשבון ולא הוחזר: ${err.message}` });
    throw err;
  }
  const tx = await CardTransaction.create({ property: propertyId, kind: txKind, card: card._id, reservation: res?._id, folio: folio._id, folioLine: line.lineId, providerRef: r.ref, approval: r.approval, amount: value, brand: card.brand, last4: card.last4, businessDate, byName: actor.name });
  await bumpSettlement(propertyId, businessDate, card.brand, value);
  await log(propertyId, actor, ip, `card.${txKind}`, 'Folio', folio._id, null, { amount: value, last4: card.last4, lineId: line.lineId });
  // A stay that already left keeps no authorization.
  if (auth && res && ['checked_out'].includes(res.status)) await releaseAuth({ propertyId, reservationId: res._id, actor, ip, reason: 'השהייה הסתיימה' }).catch(() => null);
  return { transactionId: String(tx._id), lineId: line.lineId, approval: r.approval, kind: txKind, balance: line.balance };
}

// Refund a card payment to the same card. Checks that would refuse the folio line run before money moves.
export async function refundToCard({ propertyId, folioId, paymentLineId, amount, reasonCode, note, actor, ip }) {
  mustWork(actor);
  const tx = await CardTransaction.findOne({ property: propertyId, folio: folioId, folioLine: paymentLineId, kind: { $in: ['sale', 'capture'] } });
  if (!tx) throw httpError('התשלום לא בוצע דרך ספק הסליקה — החזר רגיל מהחשבון', 404);
  const value = round2(amount);
  if (!(value > 0)) throw httpError('סכום חיובי', 422, { fields: { amount: 'סכום חיובי' } });
  const already = round2((await CardTransaction.find({ of: tx._id, kind: 'refund' }).lean()).reduce((s, t) => s + t.amount, 0));
  if (value - (tx.amount - already) > 0.005) throw httpError(`ניתן להחזיר לכרטיס עד ${round2(tx.amount - already).toFixed(2)}`, 422, { fields: { amount: 'מעל הסכום' } });
  const folio = await Folio.findOne({ _id: folioId, property: propertyId }).lean();
  const credit = -round2((folio?.lines || []).filter((l) => l.status === 'posted').reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0));
  if (value - credit > 0.005) throw httpError(credit > 0.005 ? `יתרת הזכות בחשבון היא ${credit.toFixed(2)}` : 'אין יתרת זכות בחשבון — קודם יש לבטל או לזכות חיוב', 422, { fields: { amount: 'מעל יתרת הזכות' } });
  const property = await Property.findById(propertyId).select('payments financePolicy timezone dayClose').lean();
  const threshold = Number(property?.financePolicy?.refundApprovalOver ?? 0);
  if (value > threshold && !can(actor, 'refund.issue', REFUND_ROLES)) throw httpError('החזר כספי מחייב מנהל או כספים', 403, { code: 'approval_required' });
  const { adapter, cfg } = adapterFor(property);
  const r = await adapter.refund({ cfg, ref: tx.providerRef, amount: value });
  if (!r.ok) throw declined(r.message || 'ההחזר נדחה בספק');
  const businessDate = businessDateOf(property);
  let out;
  try {
    out = await refundPayment({ propertyId, folioId, paymentLineId, input: { amount: value, reasonCode, note, idempotencyKey: opKey('cardref', r.ref) }, actor, ip });
  } catch (err) {
    await CardTransaction.create({ property: propertyId, kind: 'refund', of: tx._id, card: tx.card, reservation: tx.reservation, folio: tx.folio, providerRef: r.ref, approval: r.approval, amount: value, brand: tx.brand, last4: tx.last4, businessDate, byName: actor.name, attention: `הוחזר לכרטיס אך לא נרשם בחשבון: ${err.message}` });
    await bumpSettlement(propertyId, businessDate, tx.brand, -value);
    throw err;
  }
  await CardTransaction.create({ property: propertyId, kind: 'refund', of: tx._id, card: tx.card, reservation: tx.reservation, folio: tx.folio, folioLine: out.lineId, providerRef: r.ref, approval: r.approval, amount: value, brand: tx.brand, last4: tx.last4, businessDate, byName: actor.name });
  await bumpSettlement(propertyId, businessDate, tx.brand, -value);
  await log(propertyId, actor, ip, 'card.refund', 'Folio', folioId, null, { amount: value, last4: tx.last4, lineId: out.lineId });
  return { lineId: out.lineId, approval: r.approval, balance: out.balance };
}

// Payments of a folio that went through the provider (so the folio screen can offer "refund to card").
export async function folioCardPayments({ propertyId, folioId }) {
  const rows = await CardTransaction.find({ property: propertyId, folio: folioId, kind: { $in: ['sale', 'capture'] } }).lean();
  const refunds = await CardTransaction.find({ of: { $in: rows.map((r) => r._id) }, kind: 'refund' }).lean();
  return rows.map((t) => ({ lineId: t.folioLine ? String(t.folioLine) : null, amount: t.amount, refunded: round2(refunds.filter((x) => String(x.of) === String(t._id)).reduce((s, x) => s + x.amount, 0)), last4: t.last4, approval: t.approval }));
}

// ── Card companies as debtors ──────────────────────────────────────────────

export async function settlements({ propertyId, from, to, status }) {
  const f = { property: propertyId };
  if (YMD.test(from || '') || YMD.test(to || '')) f.date = { ...(YMD.test(from || '') ? { $gte: from } : {}), ...(YMD.test(to || '') ? { $lte: to } : {}) };
  if (status === 'open') f.status = { $in: ['open', 'partial'] };
  else if (['open', 'partial', 'settled'].includes(status)) f.status = status;
  const rows = await CardSettlement.find(f).sort({ date: -1, brand: 1 }).limit(500).lean();
  const list = rows.map((s) => ({ id: String(s._id), date: s.date, brand: s.brand, expected: s.expected, deposited: s.deposited, fees: s.fees, open: round2(s.expected - s.deposited - s.fees), status: s.status, deposits: (s.deposits || []).map((d) => ({ at: d.at, amount: d.amount, fee: d.fee, ref: d.ref, by: d.byName })) }));
  const attention = await CardTransaction.find({ property: propertyId, attention: { $exists: true, $ne: null } }).sort({ createdAt: -1 }).limit(50).lean();
  return { rows: list, openTotal: round2(list.filter((s) => s.status !== 'settled').reduce((t, s) => t + s.open, 0)), attention: attention.map((t) => ({ id: String(t._id), kind: t.kind, amount: t.amount, last4: t.last4, at: t.createdAt, message: t.attention })) };
}

export async function recordDeposit({ propertyId, id, amount, fee, ref, actor, ip }) {
  mustSettle(actor);
  const s = isId(id) ? await CardSettlement.findOne({ _id: id, property: propertyId }) : null;
  if (!s) throw httpError('הרשומה לא נמצאה', 404);
  const a = round2(amount); const f = round2(fee || 0);
  if (!(a >= 0) || !(f >= 0) || !(a + f > 0)) throw httpError('סכום הפקדה או עמלה חיוביים', 422, { fields: { amount: 'סכום חיובי' } });
  const open = round2(s.expected - s.deposited - s.fees);
  if (a + f - open > 0.005) throw httpError(`נשאר לקבל ${open.toFixed(2)} — ההפקדה והעמלה גבוהות יותר`, 422, { fields: { amount: 'מעל היתרה' } });
  s.deposits.push({ at: new Date(), amount: a, fee: f, ref: String(ref || '').slice(0, 60), byName: actor.name });
  s.deposited = round2(s.deposited + a); s.fees = round2(s.fees + f); s.status = statusOf(s);
  await s.save();
  await log(propertyId, actor, ip, 'card.deposit', 'CardSettlement', s._id, null, { date: s.date, brand: s.brand, amount: a, fee: f });
  return { id: String(s._id), status: s.status, open: round2(s.expected - s.deposited - s.fees) };
}

export async function transactions({ propertyId, from, to }) {
  const f = { property: propertyId };
  if (YMD.test(from || '') || YMD.test(to || '')) f.businessDate = { ...(YMD.test(from || '') ? { $gte: from } : {}), ...(YMD.test(to || '') ? { $lte: to } : {}) };
  const rows = await CardTransaction.find(f).sort({ createdAt: -1 }).limit(300).populate('reservation', 'confirmationNumber').lean();
  return rows.map((t) => ({ id: String(t._id), kind: t.kind, amount: t.amount, brand: t.brand, last4: t.last4, approval: t.approval, businessDate: t.businessDate, at: t.createdAt, by: t.byName, confirmationNumber: t.reservation?.confirmationNumber || null, attention: t.attention || null }));
}
