// Promotions: definition, validation of a code for a stay, and the discount on an offer's nightly
// lodging prices. Booking (desk and /book) prices through applyPromotion, so the price shown, the
// price signature and the price stored on the reservation are the same.
import mongoose from 'mongoose';
import Promotion from '../models/Promotion.js';
import Reservation from '../models/Reservation.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const PROMO_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager', 'sales_manager', 'front_desk_manager'];
const LIVE = { status: { $nin: ['cancelled', 'no_show', 'deleted', 'draft'] } };

export function cleanCode(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
}

function validate(input) {
  const b = input || {};
  const errors = {};
  const out = {
    code: cleanCode(b.code), name: String(b.name || '').trim().slice(0, 120), description: String(b.description || '').trim().slice(0, 400) || undefined,
    kind: ['percent', 'amount', 'stay_pay'].includes(b.kind) ? b.kind : 'percent',
    value: Number(b.value || 0), stayNights: b.stayNights ? Number(b.stayNights) : undefined, payNights: b.payNights !== undefined && b.payNights !== '' ? Number(b.payNights) : undefined,
    bookFrom: YMD.test(b.bookFrom || '') ? b.bookFrom : undefined, bookTo: YMD.test(b.bookTo || '') ? b.bookTo : undefined,
    stayFrom: YMD.test(b.stayFrom || '') ? b.stayFrom : undefined, stayTo: YMD.test(b.stayTo || '') ? b.stayTo : undefined,
    minNights: b.minNights ? Number(b.minNights) : undefined, minLeadDays: b.minLeadDays ? Number(b.minLeadDays) : undefined,
    roomTypes: (Array.isArray(b.roomTypes) ? b.roomTypes : []).filter(isId), ratePlans: (Array.isArray(b.ratePlans) ? b.ratePlans : []).filter(isId),
    channels: (Array.isArray(b.channels) ? b.channels : ['desk', 'web']).filter((c) => ['desk', 'web'].includes(c)),
    maxUses: b.maxUses ? Number(b.maxUses) : undefined, active: b.active !== false,
  };
  if (out.code.length < 3) errors.code = 'קוד באנגלית/ספרות, 3 תווים לפחות';
  if (out.name.length < 2) errors.name = 'שם המבצע';
  if (out.kind === 'percent' && !(out.value > 0 && out.value <= 100)) errors.value = 'אחוז בין 1 ל־100';
  if (out.kind === 'amount' && !(out.value > 0)) errors.value = 'סכום הנחה ללילה';
  if (out.kind === 'stay_pay') {
    if (!(Number.isInteger(out.stayNights) && out.stayNights >= 2 && out.stayNights <= 30)) errors.stayNights = 'לילות שהייה (2 ומעלה)';
    if (!(Number.isInteger(out.payNights) && out.payNights >= 1 && out.payNights < (out.stayNights || 0))) errors.payNights = 'לילות לתשלום — פחות מלילות השהייה';
    out.value = 0;
  }
  if (out.bookFrom && out.bookTo && out.bookFrom > out.bookTo) errors.bookTo = 'סוף לפני התחלה';
  if (out.stayFrom && out.stayTo && out.stayFrom > out.stayTo) errors.stayTo = 'סוף לפני התחלה';
  if (!out.channels.length) errors.channels = 'לפחות ערוץ אחד';
  if (out.maxUses !== undefined && !(Number.isInteger(out.maxUses) && out.maxUses > 0)) errors.maxUses = 'מספר שלם חיובי';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי המבצע', 422, { fields: errors });
  return out;
}

async function usage(propertyId, codes) {
  if (!codes.length) return new Map();
  const rows = await Reservation.aggregate([
    { $match: { property: new mongoose.Types.ObjectId(String(propertyId)), 'priceSnapshot.promotion.code': { $in: codes }, ...LIVE } },
    { $group: { _id: '$priceSnapshot.promotion.code', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' }, saving: { $sum: '$priceSnapshot.promotion.saving' }, nights: { $sum: '$nights' } } },
  ]);
  return new Map(rows.map((r) => [r._id, { bookings: r.bookings, revenue: round2(r.revenue), saving: round2(r.saving), nights: r.nights }]));
}

function dto(p, use) {
  return {
    id: String(p._id), code: p.code, name: p.name, description: p.description || null, kind: p.kind, value: p.value, stayNights: p.stayNights ?? null, payNights: p.payNights ?? null,
    bookFrom: p.bookFrom || null, bookTo: p.bookTo || null, stayFrom: p.stayFrom || null, stayTo: p.stayTo || null,
    minNights: p.minNights ?? null, minLeadDays: p.minLeadDays ?? null, roomTypes: (p.roomTypes || []).map(String), ratePlans: (p.ratePlans || []).map(String),
    channels: p.channels || [], maxUses: p.maxUses ?? null, active: p.active !== false, updatedAt: p.updatedAt, updatedBy: p.updatedByName || p.createdByName || null,
    usage: use || { bookings: 0, revenue: 0, saving: 0, nights: 0 },
  };
}

export async function listPromotions({ propertyId }) {
  const list = await Promotion.find({ property: propertyId }).sort({ active: -1, updatedAt: -1 }).lean();
  const use = await usage(propertyId, list.map((p) => p.code));
  return { rows: list.map((p) => dto(p, use.get(p.code))) };
}

export async function savePromotion({ propertyId, id, input, actor, ip }) {
  if (!PROMO_ROLES.includes(actor.role)) throw httpError('ניהול מבצעים — למנהל או להכנסות', 403);
  const data = validate(input);
  let doc;
  if (id) {
    if (!isId(id)) throw httpError('מזהה לא תקין', 400);
    doc = await Promotion.findOne({ _id: id, property: propertyId });
    if (!doc) throw httpError('המבצע לא נמצא', 404);
    const before = doc.toObject();
    if (before.code !== data.code && (await usage(propertyId, [before.code])).get(before.code)?.bookings) throw httpError('הקוד כבר שימש בהזמנות — אי אפשר לשנות אותו (אפשר להשבית וליצור חדש)', 409, { fields: { code: 'בשימוש' } });
    Object.assign(doc, data, { updatedByName: actor.name });
    try { await doc.save(); } catch (e) { if (e?.code === 11000) throw httpError('קוד זה כבר קיים', 409, { fields: { code: 'קיים' } }); throw e; }
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'promotion.updated', entityType: 'Promotion', entityId: doc._id, before: { code: before.code, kind: before.kind, value: before.value, active: before.active }, after: { code: data.code, kind: data.kind, value: data.value, active: data.active }, ip });
  } else {
    try { doc = await Promotion.create({ ...data, property: propertyId, createdByName: actor.name }); } catch (e) { if (e?.code === 11000) throw httpError('קוד זה כבר קיים', 409, { fields: { code: 'קיים' } }); throw e; }
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'promotion.created', entityType: 'Promotion', entityId: doc._id, after: { code: data.code, kind: data.kind, value: data.value }, ip });
  }
  return dto(doc.toObject(), (await usage(propertyId, [doc.code])).get(doc.code));
}

// Is this code usable for this stay? Returns { ok, promo, why }.
export async function resolvePromotion({ propertyId, code, arrival, nights, today, channel = 'desk', session = null }) {
  const c = cleanCode(code);
  if (!c) return null;
  const p = await Promotion.findOne({ property: propertyId, code: c }).session(session).lean();
  const no = (why) => ({ ok: false, code: c, why });
  if (!p || p.active === false) return no('קוד מבצע לא קיים או לא פעיל');
  if (!(p.channels || []).includes(channel)) return no(channel === 'web' ? 'המבצע אינו זמין בהזמנה באתר' : 'המבצע זמין רק בהזמנה באתר');
  if (p.bookFrom && today < p.bookFrom) return no(`המבצע מתחיל ב־${p.bookFrom}`);
  if (p.bookTo && today > p.bookTo) return no('תקופת המבצע הסתיימה');
  if (p.stayFrom && arrival < p.stayFrom) return no(`המבצע לשהייה מ־${p.stayFrom}`);
  if (p.stayTo && arrival > p.stayTo) return no(`המבצע לשהייה עד ${p.stayTo}`);
  if (p.minNights && nights < p.minNights) return no(`המבצע ממינימום ${p.minNights} לילות`);
  if (p.kind === 'stay_pay' && nights < p.stayNights) return no(`המבצע לשהייה של ${p.stayNights} לילות לפחות`);
  if (p.minLeadDays && daysBetween(today, arrival) < p.minLeadDays) return no(`המבצע להזמנה ${p.minLeadDays} ימים מראש לפחות`);
  if (p.maxUses) {
    const used = await Reservation.countDocuments({ property: propertyId, 'priceSnapshot.promotion.code': c, ...LIVE }).session(session);
    if (used >= p.maxUses) return no('המבצע מוצה');
  }
  return { ok: true, code: c, promo: p, name: p.name, description: p.description || null };
}

// Discounted nightly prices for one offer (room type × rate plan), or null when it does not apply.
export function applyPromotion(promo, { roomTypeId, ratePlanId, nightly }) {
  if (!promo?.ok) return null;
  const p = promo.promo;
  if (p.roomTypes?.length && !p.roomTypes.map(String).includes(String(roomTypeId))) return null;
  if (p.ratePlans?.length && !p.ratePlans.map(String).includes(String(ratePlanId))) return null;
  let out = nightly.map((n) => ({ ...n }));
  if (p.kind === 'percent') out = out.map((n) => ({ date: n.date, price: round2(n.price * (1 - p.value / 100)) }));
  else if (p.kind === 'amount') out = out.map((n) => ({ date: n.date, price: round2(Math.max(0, n.price - p.value)) }));
  else if (p.kind === 'stay_pay') {
    // In each block of N nights, the (N − M) cheapest are free.
    const free = p.stayNights - p.payNights;
    for (let i = 0; i + p.stayNights <= out.length; i += p.stayNights) {
      const block = out.slice(i, i + p.stayNights).map((n, k) => ({ k: i + k, price: n.price })).sort((a, b) => a.price - b.price).slice(0, free);
      for (const b of block) out[b.k].price = 0;
    }
  }
  const saving = round2(nightly.reduce((s, n) => s + n.price, 0) - out.reduce((s, n) => s + n.price, 0));
  if (!(saving > 0)) return null;
  return { nightly: out, saving, label: promoLabel(p) };
}

export function promoLabel(p) {
  if (p.kind === 'percent') return `${p.value}% הנחה`;
  if (p.kind === 'amount') return `${p.value} ₪ הנחה ללילה`;
  return `${p.stayNights} לילות במחיר ${p.payNights}`;
}
