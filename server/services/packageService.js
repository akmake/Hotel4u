// Packages (gap-map item 10): components, links to rate plans / reservations, the nightly lines day close
// posts, the allowance that absorbs outlet charges (profit / loss / excess), the per-night "what is included".
import { can } from './permissionService.js';
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import ChargeCode from '../models/ChargeCode.js';
import { RatePlan } from '../models/RatePlan.js';
import { PackageComponent, PackageUsage, SCHEDULES, CALCS, LINKS } from '../models/Package.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';
import { ensureCatalog } from './chargeCodeService.js';

export const PACKAGE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager', 'sales_manager', 'finance_manager'];
export const SCHEDULE_LABEL = { every: 'כל לילה', first: 'לילה ראשון', last: 'לילה אחרון', except_first: 'כל לילה חוץ מהראשון', except_last: 'כל לילה חוץ מהאחרון', except_ends: 'בלי הראשון ובלי האחרון', weekdays: 'ימים בשבוע', every_n: 'כל כמה לילות' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const mustManage = (actor) => { if (!can(actor, 'package.manage', PACKAGE_ROLES)) throw httpError('חבילות — למנהל, לאחראי הכנסות או לכספים', 403); };
const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
const log = (propertyId, actor, ip, action, entityType, entityId, before, after, reason) => audit({ property: propertyId, actor: actor.id, actorName: actor.name, action, entityType, entityId, before, after, reason, ip });

const dto = (c) => ({
  id: String(c._id), code: c.code, name: c.name, description: c.description || '', kind: c.kind, price: c.price, childPrice: c.childPrice ?? null, allowance: c.allowance ?? null,
  calc: c.calc, link: c.link, schedule: c.schedule, weekdays: c.weekdays || [], everyN: c.everyN || null, fromNight: c.fromNight || 1, sellable: !!c.sellable,
  chargeCode: c.chargeCode, altCodes: c.altCodes || [], overCode: c.overCode || '', validFrom: c.validFrom || '', validTo: c.validTo || '',
  seasons: (c.seasons || []).map((s) => ({ from: s.from, to: s.to, price: s.price, allowance: s.allowance ?? null })), active: c.active !== false,
});

// ── Components ──────────────────────────────────────────────────────────────

export async function listComponents({ propertyId, includeInactive = true }) {
  const rows = await PackageComponent.find({ property: propertyId, ...(includeInactive ? {} : { active: { $ne: false } }) }).sort({ name: 1 }).lean();
  return rows.map(dto);
}

async function assertCodes(propertyId, codes) {
  await ensureCatalog(propertyId);
  const found = await ChargeCode.find({ property: propertyId, kind: 'charge', code: { $in: codes }, active: true }).select('code').lean();
  const missing = codes.filter((c) => !found.some((f) => f.code === c));
  if (missing.length) throw httpError('קוד חיוב לא קיים בנכס', 422, { fields: { chargeCode: `קוד לא קיים: ${missing.join(', ')}` } });
}

export async function saveComponent({ propertyId, id, body, actor, ip }) {
  mustManage(actor);
  const b = body || {};
  const errors = {};
  const before = id ? await PackageComponent.findOne({ _id: id, property: propertyId }) : null;
  if (id && !before) throw httpError('הרכיב לא נמצא', 404);
  const code = before ? before.code : String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) errors.code = 'קוד באנגלית או ספרות, 2–20 תווים';
  const name = String(b.name || '').trim();
  if (!name) errors.name = 'שם חובה';
  const kind = b.kind === 'allowance' ? 'allowance' : 'simple';
  const price = Number(b.price);
  if (!(price >= 0)) errors.price = 'מחיר אפס ומעלה';
  const allowance = kind === 'allowance' ? Number(b.allowance ?? price) : undefined;
  if (kind === 'allowance' && !(allowance >= price)) errors.allowance = 'ההקצבה לא יכולה להיות קטנה מהמחיר';
  const calc = CALCS.includes(b.calc) ? b.calc : 'per_adult_child';
  const link = LINKS.includes(b.link) ? b.link : 'added';
  const schedule = SCHEDULES.includes(b.schedule) ? b.schedule : 'every';
  const weekdays = schedule === 'weekdays' ? [...new Set((b.weekdays || []).map(Number).filter((n) => n >= 0 && n <= 6))].sort() : [];
  if (schedule === 'weekdays' && !weekdays.length) errors.weekdays = 'בחרו לפחות יום אחד';
  const everyN = schedule === 'every_n' ? Number(b.everyN) : undefined;
  if (schedule === 'every_n' && !(everyN >= 2 && everyN <= 30)) errors.everyN = 'בין 2 ל־30 לילות';
  const fromNight = schedule === 'every_n' ? Math.max(1, Number(b.fromNight || 1)) : 1;
  const chargeCode = String(b.chargeCode || '').trim();
  if (!chargeCode) errors.chargeCode = 'קוד חיוב חובה';
  const altCodes = kind === 'allowance' ? [...new Set((b.altCodes || []).map((x) => String(x).trim()).filter(Boolean))] : [];
  const overCode = String(b.overCode || '').trim() || undefined;
  const validFrom = String(b.validFrom || ''); const validTo = String(b.validTo || '');
  if (kind === 'allowance' && (validFrom || validTo) && !(HM.test(validFrom) && HM.test(validTo) && validFrom < validTo)) errors.validFrom = 'שעות תוקף: משעה עד שעה מאוחרת יותר';
  const seasons = [];
  for (const s of (kind === 'allowance' || kind === 'simple' ? b.seasons || [] : [])) {
    if (!YMD.test(s.from || '') || !YMD.test(s.to || '') || s.to < s.from) { errors.seasons = 'עונה: תאריכים תקינים'; break; }
    const sp = Number(s.price); const sa = num(s.allowance);
    if (!(sp >= 0) || (kind === 'allowance' && sa !== undefined && sa < sp)) { errors.seasons = 'בעונה ההקצבה לא קטנה מהמחיר'; break; }
    seasons.push({ from: s.from, to: s.to, price: sp, ...(kind === 'allowance' ? { allowance: sa ?? sp } : {}) });
  }
  const childPrice = calc === 'per_adult_child' ? num(b.childPrice) : undefined;
  if (childPrice !== undefined && !(childPrice >= 0)) errors.childPrice = 'מחיר ילד אפס ומעלה';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי הרכיב', 422, { fields: errors });
  await assertCodes(propertyId, [chargeCode, ...altCodes, ...(overCode ? [overCode] : [])]);
  const set = {
    name: name.slice(0, 80), description: String(b.description || '').trim().slice(0, 300), kind, price: round2(price), childPrice, allowance: allowance !== undefined ? round2(allowance) : undefined,
    calc, link, schedule, weekdays, everyN, fromNight, sellable: !!b.sellable, chargeCode, altCodes, overCode, validFrom: kind === 'allowance' ? validFrom : '', validTo: kind === 'allowance' ? validTo : '',
    seasons, active: b.active !== false, updatedBy: actor.id, updatedByName: actor.name,
  };
  let doc;
  if (before) {
    const was = dto(before);
    Object.assign(before, set);
    await before.save();
    doc = before;
    await log(propertyId, actor, ip, 'package.component_update', 'PackageComponent', doc._id, was, dto(doc));
  } else {
    try { doc = await PackageComponent.create({ property: propertyId, code, ...set }); } catch (err) {
      if (err?.code === 11000) throw httpError('קוד הרכיב כבר קיים', 409, { fields: { code: 'כבר קיים' } });
      throw err;
    }
    await log(propertyId, actor, ip, 'package.component_create', 'PackageComponent', doc._id, null, dto(doc));
  }
  return dto(doc);
}

// ── Links: rate plans and reservations ─────────────────────────────────────

export async function listPlans({ propertyId }) {
  const [plans, comps] = await Promise.all([RatePlan.find({ property: propertyId }).sort({ sortOrder: 1, name: 1 }).lean(), PackageComponent.find({ property: propertyId }).select('name code').lean()]);
  const byId = new Map(comps.map((c) => [String(c._id), c]));
  return plans.map((p) => ({
    id: String(p._id), code: p.code, name: p.name, active: p.active !== false,
    commission: { eligible: !!p.commission?.eligible, pct: p.commission?.pct ?? null },
    components: (p.components || []).filter((x) => byId.has(String(x.component))).map((x) => ({ component: String(x.component), name: byId.get(String(x.component)).name, code: byId.get(String(x.component)).code, from: x.from || '', to: x.to || '' })),
  }));
}

export async function savePlanLinks({ propertyId, planId, body, actor, ip }) {
  mustManage(actor);
  const plan = await RatePlan.findOne({ _id: planId, property: propertyId });
  if (!plan) throw httpError('התעריף לא נמצא', 404);
  const before = { components: (plan.components || []).map((x) => ({ component: String(x.component), from: x.from, to: x.to })), commission: plan.commission || null };
  if (body.components !== undefined) {
    const list = Array.isArray(body.components) ? body.components : [];
    const ids = list.map((x) => String(x.component));
    if (ids.some((x) => !isId(x))) throw httpError('רכיב לא תקין', 422);
    if (new Set(ids).size !== ids.length) throw httpError('אותו רכיב מופיע פעמיים בתעריף', 422);
    const found = await PackageComponent.countDocuments({ _id: { $in: ids }, property: propertyId, active: { $ne: false } });
    if (found !== ids.length) throw httpError('רכיב לא קיים או לא פעיל בנכס', 422);
    for (const x of list) if ((x.from && !YMD.test(x.from)) || (x.to && !YMD.test(x.to)) || (x.from && x.to && x.to < x.from)) throw httpError('טווח תאריכים לא תקין לרכיב', 422);
    plan.components = list.map((x) => ({ component: x.component, from: x.from || undefined, to: x.to || undefined }));
  }
  if (body.commission !== undefined) {
    const eligible = !!body.commission?.eligible;
    const pct = num(body.commission?.pct);
    if (pct !== undefined && !(pct >= 0 && pct <= 100)) throw httpError('אחוז עמלה בין 0 ל־100', 422, { fields: { pct: 'בין 0 ל־100' } });
    plan.commission = { eligible, ...(eligible && pct !== undefined ? { pct } : {}) };
  }
  await plan.save();
  await log(propertyId, actor, ip, 'package.plan_links', 'RatePlan', plan._id, before, { components: (plan.components || []).map((x) => ({ component: String(x.component), from: x.from, to: x.to })), commission: plan.commission || null });
  return (await listPlans({ propertyId })).find((p) => p.id === String(plan._id));
}

const LIVE_STAY = ['confirmed', 'modified', 'pending_payment', 'hold', 'checked_in', 'in_house', 'partially_checked_in', 'partially_checked_out'];

export async function addReservationComponent({ propertyId, reservationId, body, actor, ip }) {
  if (!['receptionist', 'front_desk_manager', 'reservations_manager', ...PACKAGE_ROLES].includes(actor?.role)) throw httpError('אין הרשאה להוסיף רכיב להזמנה', 403);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId });
  if (!res || !LIVE_STAY.includes(res.status)) throw httpError('אפשר להוסיף רכיב רק להזמנה פעילה', 409);
  const comp = await PackageComponent.findOne({ _id: body.component, property: propertyId, active: { $ne: false } }).lean();
  if (!comp) throw httpError('הרכיב לא נמצא', 404);
  if (!comp.sellable) throw httpError('הרכיב הזה לא מוגדר כנמכר בנפרד', 422);
  const qty = Number(body.qty || 1);
  if (!(qty >= 1 && qty <= 50)) throw httpError('כמות בין 1 ל־50', 422, { fields: { qty: 'בין 1 ל־50' } });
  const from = body.from || res.arrivalDate; const to = body.to || res.departureDate;
  if (!YMD.test(from) || !YMD.test(to) || to < from) throw httpError('טווח תאריכים לא תקין', 422);
  if ((res.packageItems || []).some((x) => String(x.component) === String(comp._id))) throw httpError('הרכיב כבר בהזמנה — הסירו אותו והוסיפו מחדש עם כמות אחרת', 409);
  res.packageItems.push({ component: comp._id, qty, from, to, byName: actor.name, at: new Date() });
  await res.save();
  await log(propertyId, actor, ip, 'package.reservation_add', 'Reservation', res._id, null, { component: comp.code, qty, from, to });
  return { items: res.packageItems.length };
}

export async function removeReservationComponent({ propertyId, reservationId, itemId, actor, ip }) {
  if (!['receptionist', 'front_desk_manager', 'reservations_manager', ...PACKAGE_ROLES].includes(actor?.role)) throw httpError('אין הרשאה', 403);
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId });
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  const item = res.packageItems.id(itemId);
  if (!item) throw httpError('הרכיב לא נמצא בהזמנה', 404);
  const was = { component: String(item.component), qty: item.qty };
  item.deleteOne();
  await res.save();
  await log(propertyId, actor, ip, 'package.reservation_remove', 'Reservation', res._id, was, null);
  return { items: res.packageItems.length };
}

// ── Night calculation (used by roomCharges.planNights) ─────────────────────

// Components that apply to a reservation: its plan's, plus those added by hand (quantities add up).
export async function loadContext(reservation, { session = null } = {}) {
  const wanted = new Map();
  const planId = reservation.ratePlan;
  const plan = planId ? await RatePlan.findById(planId).session(session).select('components').lean() : null;
  for (const x of plan?.components || []) wanted.set(String(x.component), [{ qty: 1, from: x.from, to: x.to, source: 'plan' }]);
  for (const x of reservation.packageItems || []) {
    const k = String(x.component);
    wanted.set(k, [...(wanted.get(k) || []), { qty: x.qty || 1, from: x.from, to: x.to, source: 'reservation' }]);
  }
  if (!wanted.size) return { items: [] };
  const comps = await PackageComponent.find({ _id: { $in: [...wanted.keys()] }, active: { $ne: false } }).session(session).lean();
  return { items: comps.map((c) => ({ comp: c, uses: wanted.get(String(c._id)) })) };
}

function scheduleHit(c, date, n, total) {
  switch (c.schedule) {
    case 'first': return n === 1;
    case 'last': return n === total;
    case 'except_first': return n > 1;
    case 'except_last': return n < total;
    case 'except_ends': return n > 1 && n < total;
    case 'weekdays': return (c.weekdays || []).includes(weekday(date));
    case 'every_n': return n >= (c.fromNight || 1) && (n - (c.fromNight || 1)) % (c.everyN || 1) === 0;
    default: return true;
  }
}
function priceOn(c, date) {
  const s = (c.seasons || []).find((x) => x.from <= date && date <= x.to);
  return { price: s ? s.price : c.price, allowance: c.kind === 'allowance' ? (s ? s.allowance ?? s.price : c.allowance ?? c.price) : undefined };
}
function amountFor(c, price, { adults, children }) {
  if (c.calc === 'per_room') return price;
  if (c.calc === 'per_person') return price * (adults + children);
  return price * adults + (c.childPrice ?? price) * children;
}

// The package lines of one night: gross per component (and the allowance), `included` totals what comes off the room.
export function nightItems(ctx, { date, nightIndex, nights, adults = 1, children = 0 }) {
  const out = []; let included = 0;
  for (const { comp, uses } of ctx.items) {
    if (!scheduleHit(comp, date, nightIndex, nights)) continue;
    const qty = uses.filter((u) => (!u.from || u.from <= date) && (!u.to || date <= u.to)).reduce((s, u) => s + u.qty, 0);
    if (!qty) continue;
    const { price, allowance } = priceOn(comp, date);
    const gross = round2(qty * amountFor(comp, price, { adults, children }));
    if (!(gross > 0)) continue;
    const allowanceGross = allowance === undefined ? undefined : round2(qty * amountFor(comp, allowance, { adults, children }));
    if (comp.link === 'included') included = round2(included + gross);
    out.push({ comp, gross, allowance: allowanceGross, qty, included: comp.link === 'included' });
  }
  return { items: out, included };
}

// The night's allowance row (created when the night is posted — or earlier, when the first charge uses it).
export async function ensureUsage({ propertyId, reservationId, comp, date, price, allowance, session = null }) {
  return PackageUsage.findOneAndUpdate(
    { reservation: reservationId, component: comp._id, date },
    { $set: { price: round2(price), allowance: round2(allowance ?? price) }, $setOnInsert: { property: propertyId, componentCode: comp.code } },
    { upsert: true, new: true, session, setDefaultsOnInsert: true },
  );
}

// ── Allowance: an outlet charge absorbed by the package ────────────────────

// `charge` is the line just posted on the guest's window. Pushes a discount line (new line, never an edit)
// for the part the allowance covers; the rest is the guest's. Returns the absorbed gross.
export async function absorbCharge({ propertyId, res, folio, line, code, gross, serviceDate, session = null }) {
  if (!res || folio.ownerType !== 'guest' || !(gross > 0)) return 0;
  const reservation = await Reservation.findById(res._id).session(session).select('ratePlan packageItems arrivalDate departureDate adults children property currency').lean();
  const ctx = await loadContext(reservation, { session });
  const cands = ctx.items.filter(({ comp }) => comp.kind === 'allowance' && (comp.chargeCode === code || (comp.altCodes || []).includes(code)));
  if (!cands.length) return 0;
  const property = await Property.findById(propertyId).session(session).select('timezone').lean();
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: property?.timezone || 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const nightsList = []; for (let d = new Date(`${reservation.arrivalDate}T00:00:00Z`); d.toISOString().slice(0, 10) < reservation.departureDate; d.setUTCDate(d.getUTCDate() + 1)) nightsList.push(d.toISOString().slice(0, 10));
  const idx = nightsList.indexOf(serviceDate);
  if (idx < 0) return 0;
  let left = gross; let absorbed = 0; const parts = [];
  for (const cand of cands) {
    if (left <= 0.004) break;
    const { comp } = cand;
    if (comp.validFrom && comp.validTo && (hm < comp.validFrom || hm > comp.validTo)) continue;
    const night = nightItems({ items: [cand] }, { date: serviceDate, nightIndex: idx + 1, nights: nightsList.length, adults: reservation.adults || 1, children: reservation.children || 0 }).items[0];
    if (!night) continue;
    const usage = await ensureUsage({ propertyId, reservationId: res._id, comp, date: serviceDate, price: night.gross, allowance: night.allowance, session });
    const room = round2(night.allowance - usage.used);
    const take = round2(Math.min(left, Math.max(0, room)));
    if (take <= 0) { usage.excess = round2(usage.excess + left); await usage.save({ session }); continue; }
    left = round2(left - take); absorbed = round2(absorbed + take);
    parts.push({ comp, usage, take });
  }
  if (!parts.length) return 0;
  const ratio = absorbed / gross;
  const net = round2(Number(line.amount) * ratio); const tax = round2(Number(line.taxAmount || 0) * ratio);
  folio.lines.push({
    type: 'discount', description: `חבילה: ${parts.map((p) => p.comp.name).join(', ')} — הוקצב`.slice(0, 200), amount: -net, taxAmount: -tax, department: line.department,
    serviceDate: line.serviceDate, accountingDate: line.accountingDate, source: 'pms', status: 'posted', reference: `pkgabs:${line._id}`, discountOf: line._id,
    vatRate: line.vatRate, taxReason: line.taxReason, reason: 'הקצבת חבילה',
  });
  await folio.save({ session });
  const credit = folio.lines[folio.lines.length - 1];
  for (const p of parts) {
    p.usage.used = round2(p.usage.used + p.take);
    p.usage.lines.push({ folio: folio._id, line: credit._id, amount: p.take, code, at: new Date() });
    if (p === parts[parts.length - 1] && left > 0.004) p.usage.excess = round2(p.usage.excess + left);
    await p.usage.save({ session });
  }
  return absorbed;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export async function ledger({ propertyId, from, to }) {
  if (!YMD.test(from || '') || !YMD.test(to || '') || to < from) throw httpError('טווח תאריכים לא תקין', 422);
  const rows = await PackageUsage.find({ property: propertyId, date: { $gte: from, $lte: to } }).lean();
  const by = new Map();
  for (const u of rows) {
    const k = u.componentCode;
    const r = by.get(k) || { code: k, nights: 0, price: 0, allowance: 0, used: 0, profit: 0, loss: 0, excess: 0 };
    r.nights += 1; r.price = round2(r.price + u.price); r.allowance = round2(r.allowance + u.allowance); r.used = round2(r.used + u.used); r.excess = round2(r.excess + u.excess);
    if (u.used < u.price) r.profit = round2(r.profit + u.price - u.used); else r.loss = round2(r.loss + u.used - u.price);
    by.set(k, r);
  }
  const names = new Map((await PackageComponent.find({ property: propertyId }).select('code name').lean()).map((c) => [c.code, c.name]));
  const list = [...by.values()].map((r) => ({ ...r, name: names.get(r.code) || r.code })).sort((a, b) => a.code.localeCompare(b.code));
  const total = list.reduce((t, r) => ({ price: round2(t.price + r.price), used: round2(t.used + r.used), profit: round2(t.profit + r.profit), loss: round2(t.loss + r.loss), excess: round2(t.excess + r.excess) }), { price: 0, used: 0, profit: 0, loss: 0, excess: 0 });
  return { from, to, rows: list, total };
}

// What is included each night of a stay (to answer the guest): room price, every component, what the allowance used.
export async function breakdown({ propertyId, reservationId }) {
  const res = await Reservation.findOne({ _id: reservationId, property: propertyId }).select('ratePlan packageItems arrivalDate departureDate adults children priceSnapshot ratePerNight').lean();
  if (!res) throw httpError('ההזמנה לא נמצאה', 404);
  const ctx = await loadContext(res);
  const usages = await PackageUsage.find({ reservation: reservationId }).lean();
  const agreed = new Map((res.priceSnapshot?.nightly || []).filter((n) => n?.date && Number.isFinite(Number(n.price))).map((n) => [n.date, Number(n.price)]));
  const dates = []; for (let d = new Date(`${res.arrivalDate}T00:00:00Z`); d.toISOString().slice(0, 10) < res.departureDate; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  const nights = dates.map((date, i) => {
    const pkg = nightItems(ctx, { date, nightIndex: i + 1, nights: dates.length, adults: res.adults || 1, children: res.children || 0 });
    const total = agreed.has(date) ? agreed.get(date) : Number(res.ratePerNight || 0);
    return {
      date, total: round2(total), room: round2(Math.max(0, total - pkg.included)),
      components: pkg.items.map((x) => {
        const u = usages.find((y) => String(y.component) === String(x.comp._id) && y.date === date);
        return { code: x.comp.code, name: x.comp.name, description: x.comp.description || '', amount: x.gross, included: x.included, kind: x.comp.kind, allowance: x.allowance ?? null, used: u?.used ?? 0, excess: u?.excess ?? 0 };
      }),
    };
  });
  return { nights, components: ctx.items.map((x) => ({ code: x.comp.code, name: x.comp.name })) };
}
