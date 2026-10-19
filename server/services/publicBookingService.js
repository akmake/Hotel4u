// Public booking site (/book): guests search, choose a room and a rate, and pay at booking time.
//
// Built on the same engine as the desk (bookingService): price and availability come from the server,
// are re-checked when the booking is made, and the agreed price is frozen. Flow:
//   search → start (guest details + consent → a HOLD on the stock for holdMinutes + a payment session)
//   → the guest pays at the provider → complete (verify with the provider, once) → the hold becomes a
//   confirmed stay, the amount is posted as a deposit, the confirmation e-mail goes out.
// A payment that arrives after the hold was released is never lost: the session is marked
// 'needs_refund' and an urgent work item asks the desk to rebook or refund.
// Nothing here reveals other guests: a web booking always creates its own guest profile (the desk
// merges duplicates later).
import crypto from 'crypto';
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import GuestProfile from '../models/GuestProfile.js';
import OnlinePayment from '../models/OnlinePayment.js';
import { RatePlan } from '../models/RatePlan.js';
import { searchAvailability, createBooking } from './bookingService.js';
import { recordFolioPayment, ensureGuestFolio } from './financeService.js';
import { autoSendConfirmation } from './confirmationService.js';
import { raiseWork } from './platformService.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { BOARD_LABELS } from './boardService.js';
import * as gateway from './paymentGateway.js';

const WEB = { id: null, name: 'אתר ההזמנות', role: 'system' };
const PUBLIC_PLAN_TYPES = ['public', 'package', 'promo'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BED = { king: 'מיטת קינג', queen: 'מיטה זוגית רחבה', double: 'מיטה זוגית', twin: 'שתי מיטות נפרדות', single: 'מיטת יחיד', bunk: 'מיטת קומותיים', mixed: 'מיטות משולבות', other: 'מיטות' };
const VIEW = { sea: 'נוף לים', garden: 'נוף לגן', city: 'נוף לעיר', mountain: 'נוף להרים', pool: 'נוף לבריכה', interior: 'פונה לחצר פנימית', courtyard: 'נוף לחצר', other: '' };

// The property the site sells: ?p=<id|propertyCode>, else the only property with the site on.
async function loadSite(p) {
  const fields = 'name city address phone email website logoUrl checkInTime checkOutTime defaultCurrency vatRate onlineBooking defaultCancellationHours petPolicy smokingPolicy childMaxAge timezone dayClose';
  let property = null;
  if (p && isId(String(p))) property = await Property.findOne({ _id: p, active: { $ne: false } }).select(fields).lean();
  else if (p) property = await Property.findOne({ propertyCode: clip(p, 30), active: { $ne: false } }).select(fields).lean();
  else {
    const on = await Property.find({ active: { $ne: false }, 'onlineBooking.enabled': true }).select(fields).limit(2).lean();
    property = on.length === 1 ? on[0] : null;
    if (on.length > 1) throw httpError('יש לבחור מלון', 400, { code: 'choose_property' });
  }
  if (!property || !property.onlineBooking?.enabled) throw httpError('ההזמנה המקוונת אינה פעילה כרגע', 404, { code: 'site_off' });
  return property;
}

function roomTypeCard(rt) {
  const capMax = rt.capacityMax || 2;
  return {
    id: String(rt._id), code: rt.code, name: rt.name,
    shortDesc: rt.shortDesc || '', fullDesc: rt.fullDesc || '',
    sizeSqm: rt.roomSizeSqm || null, bed: rt.bedType ? BED[rt.bedType] : null, view: rt.view ? VIEW[rt.view] || null : null, viewCode: rt.view || null,
    capacity: { max: capMax, adults: rt.adultsMax || capMax, children: rt.childrenMax > 0 ? rt.childrenMax : Math.max(0, capMax - 1), base: rt.capacityBase || 2 },
    extraBed: !!rt.extraBedAllowed, crib: !!rt.cribAllowed, accessible: false,
    amenities: (rt.amenities || []).slice(0, 16),
    images: (rt.images || []).filter((u) => /^\/(api\/)?uploads\//.test(u) || /^data:image\//.test(u)).slice(0, 8),
  };
}

async function sellable(property) {
  const codes = property.onlineBooking?.ratePlanCodes || [];
  const plans = await RatePlan.find({ property: property._id, active: { $ne: false } }).select('code name type channels').lean();
  return plans.filter((p) => (codes.length ? codes.includes(p.code) : PUBLIC_PLAN_TYPES.includes(p.type || 'public') && (!p.channels?.length || p.channels.some((c) => ['direct', 'web', 'website'].includes(c)))));
}

function payNow(property, total) {
  const ob = property.onlineBooking || {};
  if (ob.payment === 'deposit') {
    const pct = Math.min(100, Math.max(10, Number(ob.depositPct) || 30));
    return { kind: pct >= 100 ? 'full' : 'deposit', pct, amount: round2((total * pct) / 100) };
  }
  return { kind: 'full', pct: 100, amount: round2(total) };
}

export async function getSite({ p }) {
  const property = await loadSite(p);
  const roomTypes = await RoomType.find({ property: property._id, active: { $ne: false }, sellable: { $ne: false }, showInEngine: { $ne: false }, closedToSale: { $ne: true } }).sort({ sortOrder: 1, baseRate: 1 }).lean();
  const ob = property.onlineBooking || {};
  return {
    property: {
      id: String(property._id), name: property.name, city: property.city || '', address: property.address || '', phone: property.phone || '', email: property.email || '',
      checkInTime: property.checkInTime || '15:00', checkOutTime: property.checkOutTime || '11:00', currency: property.defaultCurrency || 'ILS',
      headline: ob.headline || '', intro: ob.intro || '', terms: ob.termsText || '', childMaxAge: property.childMaxAge ?? 12,
      petPolicy: property.petPolicy || null, smokingPolicy: property.smokingPolicy || null,
    },
    payment: { mode: ob.payment || 'full', depositPct: ob.depositPct ?? 30, available: gateway.paymentsAvailable(), testMode: gateway.isTestMode() },
    today: businessDateOf(property),
    maxGuests: Math.max(2, ...roomTypes.map((r) => r.capacityMax || 2)),
    roomTypes: roomTypes.map(roomTypeCard),
  };
}

export async function search({ p, query }) {
  const property = await loadSite(p);
  const plans = await sellable(property);
  const q = { arrival: query.arrival, departure: query.departure, adults: query.adults, children: query.children, childAges: query.childAges, rooms: 1 };
  const res = await searchAvailability({ propertyId: property._id, query: q });
  // Meal plans priced "by board" (a supplement on a room-only rate) are offered as extra options.
  const boards = ((await Property.findById(property._id).select('boardPricing').lean())?.boardPricing?.supplements || [])
    .filter((x) => x.active !== false && Number(x.adult) >= 0 && x.board).map((x) => x.board);
  for (const board of boards) {
    const more = await searchAvailability({ propertyId: property._id, query: { ...q, board } });
    res.offers.push(...more.offers.filter((o) => o.board.source === 'supplement'));
  }
  const allowed = new Set(plans.map((x) => String(x._id)));
  const roomTypes = await RoomType.find({ property: property._id, active: { $ne: false }, showInEngine: { $ne: false } }).lean();
  const typeById = new Map(roomTypes.map((r) => [String(r._id), r]));
  const groups = new Map();
  for (const o of res.offers) {
    const rt = typeById.get(o.roomType.id);
    if (!rt || !allowed.has(o.ratePlan.id)) continue;
    if (!groups.has(o.roomType.id)) groups.set(o.roomType.id, { roomType: roomTypeCard(rt), offers: [], reasons: new Set() });
    const g = groups.get(o.roomType.id);
    if (!o.bookable) { o.reasons.forEach((r) => g.reasons.add(r.code)); continue; }
    if (g.offers.some((x) => x.ratePlanId === o.ratePlan.id && x.board === o.board.type)) continue;
    g.offers.push({
      key: `${o.ratePlan.id}:${o.board.type}`, ratePlanId: o.ratePlan.id, name: o.ratePlan.name, refundable: o.ratePlan.refundable,
      board: o.board.type, boardLabel: BOARD_LABELS[o.board.type] || '', total: o.total, averageNight: o.averageNight,
      nightly: o.nightly.map((n) => ({ date: n.date, price: round2(n.price + (o.board.perNight || 0)) })),
      cancellation: o.cancellation.text, priceSignature: o.priceSignature, left: o.available <= 3 ? o.available : null,
      payNow: payNow(property, o.total),
    });
  }
  const rooms = [...groups.values()].map((g) => {
    g.offers.sort((a, b) => a.total - b.total);
    const why = g.reasons.has('capacity') ? 'capacity' : g.reasons.has('sold_out') || g.reasons.has('stop_sell') ? 'sold_out' : g.reasons.has('min_los') ? 'min_los' : g.reasons.size ? 'closed' : null;
    return { roomType: g.roomType, offers: g.offers, from: g.offers[0]?.total ?? null, unavailable: g.offers.length ? null : why || 'closed' };
  }).sort((a, b) => (a.from === null) - (b.from === null) || (a.from ?? 0) - (b.from ?? 0));
  return { arrival: res.arrival, departure: res.departure, nights: res.nights, adults: res.adults, children: res.children, currency: res.currency, rooms };
}

export async function startBooking({ p, input, ip }) {
  const property = await loadSite(p);
  if (!gateway.paymentsAvailable()) throw httpError('לא ניתן לשלם באתר כרגע — אפשר להזמין בטלפון', 503, { code: 'payments_unavailable' });
  const g = input.guest || {};
  const firstName = clip(g.firstName, 60); const lastName = clip(g.lastName, 60);
  const email = clip(g.email, 120).toLowerCase(); const phone = String(g.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
  const fields = {};
  if (!firstName) fields.firstName = 'שם פרטי';
  if (!lastName) fields.lastName = 'שם משפחה';
  if (!EMAIL_RX.test(email)) fields.email = 'כתובת דוא״ל תקינה — לשם יישלח האישור';
  if (phone.replace(/\D/g, '').length < 9) fields.phone = 'מספר טלפון לנייד';
  if (input.acceptTerms !== true) fields.acceptTerms = 'יש לאשר את תנאי ההזמנה ומדיניות הפרטיות';
  const key = clip(input.idempotencyKey, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) fields.form = 'רעננו את הדף ונסו שוב';
  if (Object.keys(fields).length) throw httpError('יש להשלים את הפרטים', 422, { fields });
  const plans = await sellable(property);
  if (!plans.some((x) => String(x._id) === String(input.ratePlanId))) throw httpError('התעריף אינו זמין באתר', 422);

  // Same request twice (double click, refresh): return the session already made.
  const webKey = `web_${key}`;
  const existing = await Reservation.findOne({ property: property._id, idempotencyKey: webKey }).select('_id').lean();
  if (existing) {
    const s = await OnlinePayment.findOne({ reservation: existing._id }).sort({ createdAt: -1 }).lean();
    if (s) return { token: s.token, redirectUrl: s.status === 'pending' ? (await gateway.createSession({ token: s.token })).redirectUrl : null, status: s.status };
  }

  const now = new Date();
  const guest = await GuestProfile.create({
    property: property._id, firstName, lastName, email, phone, language: input.language === 'en' ? 'en' : 'he',
    privacyConsent: true, privacyConsentAt: now, privacyConsentIp: ip,
    marketingConsent: input.marketingConsent === true, marketingConsentAt: input.marketingConsent === true ? now : undefined, marketingConsentIp: input.marketingConsent === true ? ip : undefined,
  });
  const holdMinutes = Math.min(60, Math.max(15, Number(property.onlineBooking?.holdMinutes) || 20));
  let booked;
  try {
    booked = await createBooking({
      propertyId: property._id,
      actor: WEB,
      ip,
      input: {
        mode: 'hold', holdMinutes, idempotencyKey: webKey, source: 'direct',
        arrival: input.arrival, departure: input.departure, adults: Number(input.adults), children: Number(input.children || 0),
        childAges: Array.isArray(input.childAges) ? input.childAges.map(Number) : [], rooms: 1,
        roomTypeId: String(input.roomTypeId || ''), ratePlanId: String(input.ratePlanId || ''), priceSignature: input.priceSignature,
        board: ['room_only', 'breakfast', 'half_board', 'full_board'].includes(input.board) ? input.board : undefined,
        guestId: String(guest._id), specialRequests: clip(input.specialRequests, 1000) || undefined, language: input.language === 'en' ? 'en' : 'he',
      },
    });
  } catch (e) {
    await GuestProfile.deleteOne({ _id: guest._id, totalStays: { $in: [0, null] } }).catch(() => null);
    throw e;
  }
  const res = await Reservation.findById(booked.id).select('totalAmount holdExpiresAt currency confirmationNumber').lean();
  await Reservation.updateOne({ _id: booked.id }, { $set: { marketSegment: 'website', booker: { name: `${firstName} ${lastName}`, phone, email } } });
  const pay = payNow(property, res.totalAmount);
  const token = crypto.randomBytes(24).toString('base64url');
  const session = await OnlinePayment.create({
    property: property._id, reservation: booked.id, token, provider: gateway.providerName(), amount: pay.amount, stayTotal: res.totalAmount,
    currency: res.currency || 'ILS', kind: pay.kind, expiresAt: res.holdExpiresAt, ip,
  });
  const out = await gateway.createSession({ token, amount: pay.amount, currency: session.currency, description: `${property.name} — ${res.confirmationNumber}` });
  await OnlinePayment.updateOne({ _id: session._id }, { $set: { providerRef: out.providerRef } });
  await audit({ property: property._id, actorName: WEB.name, action: 'web.booking_started', entityType: 'Reservation', entityId: booked.id, after: { confirmationNumber: res.confirmationNumber, amount: pay.amount, kind: pay.kind }, ip }).catch(() => null);
  return { token, redirectUrl: out.redirectUrl, status: 'pending', expiresAt: res.holdExpiresAt };
}

async function loadSession(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) throw httpError('קישור לא תקין', 404);
  const s = await OnlinePayment.findOne({ token });
  if (!s) throw httpError('ההזמנה לא נמצאה', 404);
  return s;
}

const mask = (e) => String(e || '').replace(/(^.).*(@.*$)/, '$1***$2');

export async function sessionStatus({ token }) {
  const s = await loadSession(token);
  if (s.status === 'pending' && s.expiresAt && s.expiresAt < new Date()) {
    const r = await Reservation.findById(s.reservation).select('status').lean();
    if (r?.status !== 'hold') { s.status = 'expired'; await s.save(); }
  }
  const [r, property] = await Promise.all([
    Reservation.findById(s.reservation).populate('roomType', 'name').populate('ratePlan', 'name').populate('primaryGuest', 'firstName email').lean(),
    Property.findById(s.property).select('name phone email address city checkInTime checkOutTime').lean(),
  ]);
  return {
    status: s.status, amount: s.amount, currency: s.currency, kind: s.kind, stayTotal: s.stayTotal, expiresAt: s.expiresAt, testMode: s.provider === 'mock',
    card: s.status === 'paid' ? { last4: s.result?.last4, brand: s.result?.cardBrand } : null,
    error: s.status === 'failed' ? s.error : null,
    booking: r ? {
      confirmationNumber: r.confirmationNumber, status: r.status, arrival: r.arrivalDate, departure: r.departureDate, nights: r.nights,
      adults: r.adults, children: r.children || 0, roomType: r.roomType?.name || '', ratePlan: r.ratePlan?.name || '', board: BOARD_LABELS[r.board] || '',
      total: r.totalAmount, cancellation: r.cancellationPolicy || '', guestName: r.primaryGuest?.firstName || '', email: mask(r.primaryGuest?.email),
    } : null,
    property: property ? { name: property.name, phone: property.phone || '', email: property.email || '', address: [property.address, property.city].filter(Boolean).join(', '), checkInTime: property.checkInTime || '15:00', checkOutTime: property.checkOutTime || '11:00' } : null,
  };
}

// Test provider only: the guest's choice on the simulated payment page.
export async function mockPay({ token, outcome }) {
  if (!gateway.isTestMode() || process.env.NODE_ENV === 'production') throw httpError('לא זמין', 404);
  const s = await loadSession(token);
  if (s.status !== 'pending') return { status: s.status };
  s.mock = { outcome: outcome === 'approve' ? 'approve' : 'decline', at: new Date() };
  await s.save();
  return completePayment({ token });
}

// Finalise once: verify with the provider, then confirm the held stay and post the payment.
export async function completePayment({ token }) {
  const s0 = await loadSession(token);
  if (s0.status !== 'pending') return sessionStatus({ token });
  const v = await gateway.verify(s0);
  if (v.pending) return sessionStatus({ token });
  if (!v.paid) {
    await OnlinePayment.updateOne({ _id: s0._id, status: 'pending' }, { $set: { status: 'failed', error: v.reason || 'התשלום לא אושר' } });
    return sessionStatus({ token });
  }
  const s = await OnlinePayment.findOneAndUpdate({ _id: s0._id, status: 'pending' }, { $set: { status: 'processing', result: { last4: v.last4, approval: v.approval, cardBrand: v.cardBrand, installments: v.installments || 1 } } }, { returnDocument: 'after' });
  if (!s) return sessionStatus({ token });

  const r = await Reservation.findById(s.reservation);
  const confirmed = await Reservation.updateOne({ _id: s.reservation, status: 'hold' }, { $set: { status: 'confirmed', holdExpiresAt: null, guaranteeType: 'credit_card' } });
  if (!confirmed.modifiedCount) {
    // Paid after the hold was released (or the stay changed): money in, no room held — the desk decides.
    await OnlinePayment.updateOne({ _id: s._id }, { $set: { status: 'needs_refund', paidAt: new Date(), error: 'התשלום התקבל לאחר שפג זמן ההחזקה' } });
    await raiseWork({ propertyId: s.property, kind: 'finance', severity: 'urgent', title: `תשלום מהאתר ללא חדר מוחזק — ${r?.confirmationNumber || ''}`, body: `התקבל תשלום של ${s.amount} ${s.currency} (אישור ${v.approval}, כרטיס ${v.last4}) אחרי שפג זמן ההחזקה. יש להזמין מחדש או להחזיר את הכסף.`, source: 'web', dedupeKey: `web-pay-${s._id}` });
    await audit({ property: s.property, actorName: WEB.name, action: 'web.payment_orphaned', entityType: 'Reservation', entityId: s.reservation, after: { amount: s.amount } }).catch(() => null);
    return sessionStatus({ token });
  }
  await ReservationRoom.updateMany({ reservation: s.reservation, status: 'tentative' }, { $set: { status: 'reserved' } });
  try {
    const { folioId } = await ensureGuestFolio({ propertyId: s.property, reservationId: String(s.reservation) });
    const out = await recordFolioPayment({
      propertyId: s.property, folioId, actor: WEB, ip: s.ip,
      input: { kind: 'deposit', method: 'credit_card', amount: s.amount, idempotencyKey: `web-${s._id}`, details: { last4: v.last4, approval: v.approval, cardBrand: v.cardBrand, installments: v.installments || 1 }, note: 'תשלום באתר ההזמנות' },
    });
    const paidFull = s.amount + 0.005 >= Number(s.stayTotal || 0);
    await Reservation.updateOne({ _id: s.reservation }, { $set: { depositPaid: s.amount, depositAmount: s.amount, paymentStatus: paidFull ? 'paid' : 'partial' } });
    await OnlinePayment.updateOne({ _id: s._id }, { $set: { status: 'paid', paidAt: new Date(), folioLineId: out.lineId } });
  } catch (e) {
    console.error('[public-booking] posting failed:', e.message);
    // The stay is confirmed and the money taken; only the posting failed — keep it visible to the desk.
    await OnlinePayment.updateOne({ _id: s._id }, { $set: { status: 'paid', paidAt: new Date(), error: `רישום התשלום בחשבון נכשל: ${e.message}` } });
    await raiseWork({ propertyId: s.property, kind: 'finance', severity: 'action', title: `לרשום תשלום מהאתר — ${r?.confirmationNumber || ''}`, body: `${s.amount} ${s.currency}, אישור ${v.approval}, כרטיס ${v.last4}. ${e.message}`, source: 'web', dedupeKey: `web-post-${s._id}` });
  }
  await audit({ property: s.property, actorName: WEB.name, action: 'web.payment_completed', entityType: 'Reservation', entityId: s.reservation, after: { amount: s.amount, kind: s.kind, last4: v.last4 } }).catch(() => null);
  autoSendConfirmation({ propertyId: s.property, reservationId: s.reservation, actor: WEB });
  return sessionStatus({ token });
}

// Declined card: another try while the stock is still held.
export async function retryPayment({ token }) {
  const s = await loadSession(token);
  if (s.status !== 'failed') return { status: s.status, redirectUrl: null };
  const r = await Reservation.findById(s.reservation).select('status holdExpiresAt').lean();
  if (r?.status !== 'hold' || (r.holdExpiresAt && r.holdExpiresAt < new Date())) {
    s.status = 'expired'; await s.save();
    throw httpError('זמן ההחזקה של החדר הסתיים — יש לבצע חיפוש מחדש', 409, { code: 'expired' });
  }
  const out = await gateway.createSession({ token: s.token, amount: s.amount, currency: s.currency });
  s.status = 'pending'; s.error = undefined; s.mock = undefined; s.attempts += 1; s.providerRef = out.providerRef;
  await s.save();
  return { status: 'pending', redirectUrl: out.redirectUrl };
}

// ── Manager settings ──
export const ONLINE_ADMIN_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager'];

export async function getOnlineSettings({ propertyId }) {
  const p = await Property.findById(propertyId).select('onlineBooking').lean();
  const plans = await RatePlan.find({ property: propertyId, active: { $ne: false } }).select('code name type').sort({ sortOrder: 1, code: 1 }).lean();
  const ob = p?.onlineBooking || {};
  return {
    enabled: !!ob.enabled, payment: ob.payment || 'full', depositPct: ob.depositPct ?? 30, holdMinutes: ob.holdMinutes ?? 20,
    ratePlanCodes: ob.ratePlanCodes || [], headline: ob.headline || '', intro: ob.intro || '', termsText: ob.termsText || '',
    plans: plans.map((x) => ({ code: x.code, name: x.name, type: x.type, publicByDefault: PUBLIC_PLAN_TYPES.includes(x.type || 'public') })),
    provider: gateway.providerName(), paymentsAvailable: gateway.paymentsAvailable(), testMode: gateway.isTestMode(),
    url: `/book?p=${propertyId}`, updatedByName: ob.updatedByName || null, updatedAt: ob.updatedAt || null,
  };
}

export async function saveOnlineSettings({ propertyId, input, actor, ip }) {
  const before = (await Property.findById(propertyId).select('onlineBooking').lean())?.onlineBooking || {};
  const codes = Array.isArray(input.ratePlanCodes) ? [...new Set(input.ratePlanCodes.map((c) => clip(c, 20)).filter(Boolean))] : before.ratePlanCodes || [];
  const fields = {};
  const pct = Number(input.depositPct ?? before.depositPct ?? 30);
  if (!(pct >= 10 && pct <= 100)) fields.depositPct = '10% עד 100%';
  const hold = Number(input.holdMinutes ?? before.holdMinutes ?? 20);
  if (!(hold >= 15 && hold <= 60)) fields.holdMinutes = '15 עד 60 דקות';
  if (Object.keys(fields).length) throw httpError('יש לתקן את ההגדרות', 422, { fields });
  const set = {
    enabled: input.enabled === true, payment: input.payment === 'deposit' ? 'deposit' : 'full', depositPct: pct, holdMinutes: hold, ratePlanCodes: codes,
    headline: clip(input.headline, 120), intro: clip(input.intro, 600), termsText: clip(input.termsText, 4000), updatedByName: actor.name, updatedAt: new Date(),
  };
  await Property.updateOne({ _id: propertyId }, { $set: { onlineBooking: set } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'property.online_booking', entityType: 'Property', entityId: propertyId, before: { enabled: !!before.enabled, payment: before.payment, depositPct: before.depositPct }, after: { enabled: set.enabled, payment: set.payment, depositPct: set.depositPct, plans: codes }, ip });
  return getOnlineSettings({ propertyId });
}
