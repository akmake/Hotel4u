// Cashier shifts and currency exchange.
//  - one open shift per user; it opens with a float and closes with a blind count (ILS + foreign);
//  - expected ILS = float + cash this user took/returned on folios since the shift opened
//    + shekels received selling foreign cash − shekels paid out buying it;
//  - a currency exchange needs the cashier's open shift and the property's posted rate;
//  - an exchange is voided (manager, reason), never deleted.
import mongoose from 'mongoose';
import CashierShift from '../models/CashierShift.js';
import CurrencyExchange, { FxRate } from '../models/CurrencyExchange.js';
import Folio from '../models/Folio.js';
import Property from '../models/Property.js';
import Reservation from '../models/Reservation.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf, MANAGER_ROLES } from './frontDeskService.js';
import { getNextSequenceValue } from '../models/Counter.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
export const SUPERVISORS = [...MANAGER_ROLES, 'finance_manager'];
export const CURRENCIES = { USD: 'דולר ארה״ב', EUR: 'אירו', GBP: 'לירה שטרלינג', CHF: 'פרנק שווייצרי', JPY: 'ין יפני', CAD: 'דולר קנדי', AUD: 'דולר אוסטרלי', RUB: 'רובל', UAH: 'הריבנה', JOD: 'דינר ירדני', EGP: 'לירה מצרית', TRY: 'לירה טורקית' };

async function nextNo(prefix, propertyId) {
  const n = await getNextSequenceValue(`${prefix}:${propertyId}`);
  return `${prefix}-${String(n).padStart(5, '0')}`;
}

// Cash that went through this user's hands on folios since the shift opened.
async function folioCash(propertyId, userId, from, to) {
  const folios = await Folio.find({ property: propertyId, lines: { $elemMatch: { createdBy: userId, method: 'cash', status: 'posted', postedAt: { $gte: from, ...(to ? { $lte: to } : {}) } } } })
    .select('lines account reservation').lean();
  const rows = [];
  for (const f of folios) {
    for (const l of f.lines) {
      if (String(l.createdBy || '') !== String(userId) || l.method !== 'cash' || l.status !== 'posted') continue;
      if (!['payment', 'deposit', 'refund'].includes(l.type)) continue;
      const at = new Date(l.postedAt);
      if (at < from || (to && at > to)) continue;
      rows.push({ folioId: String(f._id), at, type: l.type, description: l.description, amount: round2(l.type === 'refund' ? -Math.abs(l.amount) : Math.abs(l.amount)) });
    }
  }
  return rows.sort((a, b) => a.at - b.at);
}

async function shiftFigures(shift, until = null) {
  const to = until || shift.closedAt || null;
  const [cash, fx] = await Promise.all([
    folioCash(shift.property, shift.user, shift.openedAt, to),
    CurrencyExchange.find({ shift: shift._id, status: 'done' }).sort({ createdAt: 1 }).lean(),
  ]);
  const cashIn = round2(cash.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
  const cashOut = round2(-cash.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0));
  const exchangeIn = round2(fx.filter((x) => x.direction === 'sell').reduce((s, x) => s + x.ilsAmount, 0));
  const exchangeOut = round2(fx.filter((x) => x.direction === 'buy').reduce((s, x) => s + x.ilsAmount, 0));
  const expected = round2(Number(shift.openingFloat || 0) + cashIn - cashOut + exchangeIn - exchangeOut);
  const foreign = new Map();
  for (const x of fx) foreign.set(x.currency, round2((foreign.get(x.currency) || 0) + (x.direction === 'buy' ? x.foreignAmount : -x.foreignAmount)));
  return {
    expected, movement: { cashIn, cashOut, exchangeIn, exchangeOut, receipts: cash.length },
    foreign: [...foreign.entries()].map(([currency, amount]) => ({ currency, expected: amount })),
    cash, exchanges: fx,
  };
}

function shiftDto(s, figures = null) {
  return {
    id: String(s._id), number: s.number, userId: String(s.user), userName: s.userName || '—', status: s.status, businessDate: s.businessDate,
    openedAt: s.openedAt, openingFloat: s.openingFloat || 0, openNote: s.openNote || null, closedAt: s.closedAt || null, closedByName: s.closedByName || null,
    expected: figures ? figures.expected : s.expected ?? null, counted: s.counted ?? null, variance: s.variance ?? null,
    movement: figures ? figures.movement : s.movement || null,
    foreign: figures ? figures.foreign : (s.foreign || []), note: s.note || null, handedTo: s.handedTo || null,
  };
}

function exchangeDto(x) {
  return {
    id: String(x._id), number: x.number, at: x.createdAt, userName: x.userName || '—', direction: x.direction, currency: x.currency,
    foreignAmount: x.foreignAmount, rate: x.rate, ilsAmount: x.ilsAmount, guestName: x.guestName || null, roomNumber: x.roomNumber || null,
    status: x.status, voidReason: x.voidReason || null, voidedByName: x.voidedByName || null, shiftId: String(x.shift),
  };
}

// ── shifts ──────────────────────────────────────────────────────────────────
export async function cashierOverview({ propertyId, actor, from, to }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const mine = await CashierShift.findOne({ property: propertyId, user: actor.id, status: 'open' }).lean();
  const supervisor = SUPERVISORS.includes(actor.role);
  const f = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : today;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : today;
  const listFilter = { property: propertyId, $or: [{ status: 'open' }, { businessDate: { $gte: f, $lte: t } }], ...(supervisor ? {} : { user: actor.id }) };
  const shifts = await CashierShift.find(listFilter).sort({ openedAt: -1 }).limit(200).lean();
  const rows = [];
  for (const s of shifts) rows.push(shiftDto(s, s.status === 'open' ? await shiftFigures(s, new Date()) : null));
  let current = null;
  if (mine) {
    const fig = await shiftFigures(mine, new Date());
    current = { ...shiftDto(mine, fig), cash: fig.cash.map((c) => ({ ...c, at: c.at })), exchanges: fig.exchanges.map(exchangeDto) };
  }
  return { businessDate: today, from: f, to: t, supervisor, current, rows };
}

export async function openShift({ propertyId, input, actor, ip }) {
  if (!actor.id) throw httpError('נדרש משתמש מחובר', 401);
  const open = await CashierShift.findOne({ property: propertyId, user: actor.id, status: 'open' }).lean();
  if (open) throw httpError(`כבר פתוחה לך משמרת ${open.number}`, 409, { code: 'shift_open' });
  const float = round2(input?.openingFloat ?? 0);
  if (!Number.isFinite(float) || float < 0 || float > 1000000) throw httpError('קרן פתיחה לא תקינה', 422, { fields: { openingFloat: 'סכום 0 ומעלה' } });
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const shift = await CashierShift.create({
    property: propertyId, number: await nextNo('SH', propertyId), user: actor.id, userName: actor.name, status: 'open',
    businessDate: businessDateOf(property), openedAt: new Date(), openingFloat: float, openNote: String(input?.note || '').trim().slice(0, 300) || undefined,
  });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'cashier.shift_opened', entityType: 'CashierShift', entityId: shift._id, after: { number: shift.number, openingFloat: float }, ip });
  return shiftDto(shift.toObject(), await shiftFigures(shift, new Date()));
}

export async function closeShift({ propertyId, shiftId, input, actor, ip }) {
  if (!isId(shiftId)) throw httpError('מזהה משמרת לא תקין', 400);
  const shift = await CashierShift.findOne({ _id: shiftId, property: propertyId });
  if (!shift) throw httpError('המשמרת לא נמצאה', 404);
  if (shift.status === 'closed') throw httpError('המשמרת כבר נסגרה', 409);
  if (String(shift.user) !== String(actor.id) && !SUPERVISORS.includes(actor.role)) throw httpError('סגירת משמרת של עובד אחר — למנהל או לכספים', 403);
  const counted = Number(input?.counted);
  if (!Number.isFinite(counted) || counted < 0) throw httpError('יש להזין את סכום השקלים שנספר', 422, { fields: { counted: 'סכום' } });
  const now = new Date();
  const fig = await shiftFigures(shift, now);
  const variance = round2(counted - fig.expected);
  const countedForeign = input?.foreign && typeof input.foreign === 'object' ? input.foreign : {};
  const foreign = fig.foreign.map((x) => {
    const c = Number(countedForeign[x.currency]);
    const cnt = Number.isFinite(c) && c >= 0 ? round2(c) : 0;
    return { currency: x.currency, expected: x.expected, counted: cnt, variance: round2(cnt - x.expected) };
  });
  const note = String(input?.note || '').trim().slice(0, 300);
  const anyVariance = Math.abs(variance) > 0.005 || foreign.some((x) => Math.abs(x.variance) > 0.005);
  if (anyVariance && note.length < 3) throw httpError('יש הפרש בספירה — נדרש הסבר', 422, { fields: { note: 'הסבר להפרש' } });
  Object.assign(shift, {
    status: 'closed', closedAt: now, closedByName: actor.name, expected: fig.expected, counted: round2(counted), variance, movement: fig.movement,
    foreign, note: note || undefined, handedTo: String(input?.handedTo || '').trim().slice(0, 80) || undefined,
  });
  await shift.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'cashier.shift_closed', entityType: 'CashierShift', entityId: shift._id, after: { number: shift.number, expected: fig.expected, counted: round2(counted), variance, foreign }, reason: note || undefined, ip });
  return shiftDto(shift.toObject());
}

export async function shiftDetail({ propertyId, shiftId, actor }) {
  if (!isId(shiftId)) throw httpError('מזהה משמרת לא תקין', 400);
  const s = await CashierShift.findOne({ _id: shiftId, property: propertyId }).lean();
  if (!s) throw httpError('המשמרת לא נמצאה', 404);
  if (String(s.user) !== String(actor.id) && !SUPERVISORS.includes(actor.role) && actor.role !== 'auditor') throw httpError('אין הרשאה למשמרת של עובד אחר', 403);
  const fig = await shiftFigures(s, s.status === 'open' ? new Date() : s.closedAt);
  return { ...shiftDto(s, s.status === 'open' ? fig : null), cash: fig.cash, exchanges: fig.exchanges.map(exchangeDto) };
}

// ── currency exchange ───────────────────────────────────────────────────────
export async function listRates({ propertyId }) {
  const rates = await FxRate.find({ property: propertyId }).sort({ currency: 1 }).lean();
  return {
    currencies: CURRENCIES,
    rates: rates.map((r) => ({ currency: r.currency, name: CURRENCIES[r.currency] || r.currency, buy: r.buy, sell: r.sell, active: r.active, updatedAt: r.updatedAt, updatedBy: r.updatedByName || null })),
  };
}

export async function setRate({ propertyId, currency, input, actor, ip }) {
  if (!SUPERVISORS.includes(actor.role)) throw httpError('עדכון שערים — למנהל או לכספים', 403);
  const cur = String(currency || '').toUpperCase();
  if (!CURRENCIES[cur]) throw httpError('מטבע לא נתמך', 422);
  const buy = round4(input?.buy); const sell = round4(input?.sell);
  const errors = {};
  if (!(buy > 0)) errors.buy = 'שער קנייה חיובי';
  if (!(sell > 0)) errors.sell = 'שער מכירה חיובי';
  if (buy > 0 && sell > 0 && buy > sell) errors.buy = 'שער הקנייה לא יכול להיות גבוה משער המכירה';
  if (Object.keys(errors).length) throw httpError('יש לתקן את השערים', 422, { fields: errors });
  const before = await FxRate.findOne({ property: propertyId, currency: cur }).lean();
  await FxRate.updateOne({ property: propertyId, currency: cur }, { $set: { buy, sell, active: input?.active !== false, updatedByName: actor.name } }, { upsert: true });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'fx.rate_set', entityType: 'FxRate', entityId: cur, before: before ? { buy: before.buy, sell: before.sell } : undefined, after: { buy, sell }, ip });
  return listRates({ propertyId });
}

export async function exchange({ propertyId, input, actor, ip }) {
  const shift = await CashierShift.findOne({ property: propertyId, user: actor.id, status: 'open' });
  if (!shift) throw httpError('המרת מט״ח מתבצעת מתוך משמרת קופה פתוחה — פתחו משמרת', 409, { code: 'no_shift' });
  const direction = input?.direction === 'sell' ? 'sell' : 'buy';
  const cur = String(input?.currency || '').toUpperCase();
  const rate = await FxRate.findOne({ property: propertyId, currency: cur, active: true }).lean();
  if (!rate) throw httpError('אין שער מעודכן למטבע זה', 422, { fields: { currency: 'אין שער' } });
  const foreignAmount = round2(input?.foreignAmount);
  if (!(foreignAmount > 0) || foreignAmount > 100000) throw httpError('סכום מט״ח לא תקין', 422, { fields: { foreignAmount: 'סכום חיובי' } });
  const applied = direction === 'buy' ? rate.buy : rate.sell;
  const ilsAmount = round2(foreignAmount * applied);
  if (direction === 'sell') {
    const fig = await shiftFigures(shift, new Date());
    const held = fig.foreign.find((x) => x.currency === cur)?.expected || 0;
    if (foreignAmount - held > 0.005) throw httpError(`בקופה יש ${held.toFixed(2)} ${cur} בלבד`, 422, { fields: { foreignAmount: 'מעל מה שבקופה' } });
  } else {
    const fig = await shiftFigures(shift, new Date());
    if (ilsAmount - fig.expected > 0.005) throw httpError(`בקופה יש ${fig.expected.toFixed(2)} ₪ בלבד — אין מספיק שקלים לתשלום`, 422, { fields: { foreignAmount: 'אין מספיק שקלים בקופה' } });
  }
  let reservation = null; let roomNumber;
  if (input?.reservationId && isId(input.reservationId)) {
    reservation = await Reservation.findOne({ _id: input.reservationId, property: propertyId }).select('_id assignedRoom').populate('assignedRoom', 'number').lean();
    roomNumber = reservation?.assignedRoom?.number;
  }
  const guestName = String(input?.guestName || '').trim().slice(0, 120);
  if (guestName.length < 2) throw httpError('יש לרשום את שם הלקוח', 422, { fields: { guestName: 'שם' } });
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const x = await CurrencyExchange.create({
    property: propertyId, number: await nextNo('EX', propertyId), shift: shift._id, user: actor.id, userName: actor.name, businessDate: businessDateOf(property),
    direction, currency: cur, foreignAmount, rate: applied, ilsAmount, guestName, reservation: reservation?._id, roomNumber: roomNumber || String(input?.roomNumber || '').trim().slice(0, 10) || undefined,
    docLast4: String(input?.docLast4 || '').replace(/\D/g, '').slice(-4) || undefined,
  });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'fx.exchanged', entityType: 'CurrencyExchange', entityId: x._id, after: { number: x.number, direction, currency: cur, foreignAmount, rate: applied, ilsAmount }, ip });
  return exchangeDto(x.toObject());
}

export async function voidExchange({ propertyId, id, reason, actor, ip }) {
  if (!SUPERVISORS.includes(actor.role)) throw httpError('ביטול המרה — למנהל או לכספים', 403);
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('ביטול מחייב סיבה', 422, { fields: { reason: 'סיבה' } });
  if (!isId(id)) throw httpError('מזהה לא תקין', 400);
  const x = await CurrencyExchange.findOne({ _id: id, property: propertyId });
  if (!x) throw httpError('ההמרה לא נמצאה', 404);
  if (x.status === 'voided') throw httpError('ההמרה כבר בוטלה', 409);
  const shift = await CashierShift.findById(x.shift).select('status').lean();
  if (shift?.status === 'closed') throw httpError('המשמרת כבר נסגרה — אי אפשר לבטל המרה ממנה', 409);
  Object.assign(x, { status: 'voided', voidReason: why, voidedByName: actor.name, voidedAt: new Date() });
  await x.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'fx.voided', entityType: 'CurrencyExchange', entityId: x._id, reason: why, ip });
  return exchangeDto(x.toObject());
}

export async function listExchanges({ propertyId, from, to }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const f = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : today;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : today;
  const rows = await CurrencyExchange.find({ property: propertyId, businessDate: { $gte: f, $lte: t } }).sort({ createdAt: -1 }).limit(500).lean();
  const totals = {};
  for (const x of rows.filter((r) => r.status === 'done')) {
    const k = x.currency;
    totals[k] = totals[k] || { currency: k, bought: 0, sold: 0, ilsOut: 0, ilsIn: 0 };
    if (x.direction === 'buy') { totals[k].bought = round2(totals[k].bought + x.foreignAmount); totals[k].ilsOut = round2(totals[k].ilsOut + x.ilsAmount); }
    else { totals[k].sold = round2(totals[k].sold + x.foreignAmount); totals[k].ilsIn = round2(totals[k].ilsIn + x.ilsAmount); }
  }
  return { from: f, to: t, rows: rows.map(exchangeDto), totals: Object.values(totals) };
}
