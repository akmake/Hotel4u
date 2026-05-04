import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { RatePlan, RateDate, RateOverrideLog } from '../models/RatePlan.js';
import RoomType from '../models/RoomType.js';
import Reservation from '../models/Reservation.js';
import { audit } from '../services/auditService.js';
import { enqueueChannelUpdate } from '../services/channelQueueService.js';
import { actorOrSystem, assertPropertyScope, requireRoles } from '../middleware/authContext.js';

const router = Router();
const OVERRIDE_ROLES = ['super_admin', 'property_admin', 'general_manager', 'revenue_manager'];
const HIGH_PRIV_OVERRIDE_ROLES = ['super_admin', 'property_admin', 'general_manager'];
const RATE_MANAGER_ROLES = ['super_admin', 'property_admin', 'general_manager', 'revenue_manager'];

function getStayDates(arrivalDate, departureDate) {
  const dates = [];
  const cur = new Date(`${arrivalDate}T00:00:00.000Z`);
  const end = new Date(`${departureDate}T00:00:00.000Z`);
  while (cur < end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  return Math.round((to - from) / 86400000);
}

function matchesRule(rule, ctx) {
  if (!rule.active) return false;

  if (rule.weekdays?.length && !rule.weekdays.includes(ctx.weekday)) return false;
  if (rule.seasonFrom && ctx.date < rule.seasonFrom) return false;
  if (rule.seasonTo && ctx.date > rule.seasonTo) return false;

  if (rule.minGuests != null && ctx.adults < rule.minGuests) return false;
  if (rule.maxGuests != null && ctx.adults > rule.maxGuests) return false;
  if (rule.minChildren != null && ctx.children < rule.minChildren) return false;
  if (rule.maxChildren != null && ctx.children > rule.maxChildren) return false;

  if (rule.minLos != null && ctx.los < rule.minLos) return false;
  if (rule.maxLos != null && ctx.los > rule.maxLos) return false;
  if (rule.minLeadDays != null && ctx.leadDays < rule.minLeadDays) return false;
  if (rule.maxLeadDays != null && ctx.leadDays > rule.maxLeadDays) return false;

  if (rule.channels?.length && !rule.channels.includes(ctx.channel)) return false;
  if (rule.companies?.length && (!ctx.companyId || !rule.companies.map(String).includes(String(ctx.companyId)))) return false;
  if (rule.agents?.length && (!ctx.agentId || !rule.agents.map(String).includes(String(ctx.agentId)))) return false;
  if (rule.promoCodes?.length && (!ctx.promoCode || !rule.promoCodes.includes(ctx.promoCode))) return false;
  if (rule.loyaltyTiers?.length && (!ctx.loyaltyTier || !rule.loyaltyTiers.includes(ctx.loyaltyTier))) return false;

  return true;
}

function applyRuleToPrice(basePrice, rule) {
  if (rule.adjustmentType === 'set') return Math.max(0, Number(rule.adjustmentValue) || 0);
  if (rule.adjustmentType === 'fixed') return Math.max(0, basePrice + (Number(rule.adjustmentValue) || 0));
  return Math.max(0, basePrice * (1 + (Number(rule.adjustmentValue) || 0) / 100));
}

// GET /api/rates/plans?propertyId=&all=1
router.get('/plans', asyncHandler(async (req, res) => {
  const { propertyId, all } = req.query;
  assertPropertyScope(req, propertyId);
  const filter = { property: propertyId };
  if (!all) filter.active = true;

  const plans = await RatePlan.find(filter)
    .sort({ sortOrder: 1, createdAt: 1 })
    .populate('activeRoomTypes', 'code name')
    .lean();

  res.json({ success: true, data: plans });
}));

// POST /api/rates/plans
router.post('/plans', asyncHandler(async (req, res) => {
  requireRoles(req, RATE_MANAGER_ROLES, 'Rate plan update requires revenue/manager permissions');
  const {
    propertyId,
    code,
    name,
    type,
    isRefundable,
    includesBreakfast,
    halfBoard,
    fullBoard,
    allInclusive,
    cancellationPolicy,
    depositPolicy,
    channels,
    activeRoomTypes,
    pricingRules,
    sortOrder,
  } = req.body;

  if (!propertyId || !code || !name) {
    return res.status(400).json({ success: false, error: 'Required: propertyId, code, name' });
  }
  assertPropertyScope(req, propertyId);

  const plan = await RatePlan.create({
    property: propertyId,
    code: String(code).toUpperCase(),
    name,
    type: type || 'public',
    isRefundable: isRefundable !== false,
    includesBreakfast: !!includesBreakfast,
    halfBoard: !!halfBoard,
    fullBoard: !!fullBoard,
    allInclusive: !!allInclusive,
    cancellationPolicy: cancellationPolicy || '',
    depositPolicy: depositPolicy || '',
    channels: Array.isArray(channels) ? channels : [],
    activeRoomTypes: Array.isArray(activeRoomTypes) ? activeRoomTypes : [],
    pricingRules: Array.isArray(pricingRules) ? pricingRules : [],
    sortOrder: Number(sortOrder) || 0,
  });

  res.status(201).json({ success: true, data: plan });
}));

// PATCH /api/rates/plans/:id
router.patch('/plans/:id', asyncHandler(async (req, res) => {
  requireRoles(req, RATE_MANAGER_ROLES, 'Rate plan update requires revenue/manager permissions');
  const allowed = [
    'name', 'type', 'isRefundable', 'includesBreakfast',
    'halfBoard', 'fullBoard', 'allInclusive',
    'cancellationPolicy', 'depositPolicy', 'channels', 'activeRoomTypes',
    'pricingRules', 'sortOrder', 'active',
  ];

  const update = {};
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) {
      update[k] = k === 'sortOrder' ? Number(req.body[k]) : req.body[k];
    }
  });

  const plan = await RatePlan.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!plan) return res.status(404).json({ success: false, error: 'Rate plan not found' });
  assertPropertyScope(req, plan.property);

  res.json({ success: true, data: plan });
}));

// GET /api/rates/grid?propertyId=&ratePlanId=&from=&days=14
router.get('/grid', asyncHandler(async (req, res) => {
  const { propertyId, ratePlanId } = req.query;
  assertPropertyScope(req, propertyId);
  const from = req.query.from;
  const days = Math.min(Number(req.query.days) || 14, 120);

  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(`${from}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const [roomTypes, rateDates] = await Promise.all([
    RoomType.find({ property: propertyId, active: true }).sort({ sortOrder: 1 }).lean(),
    RateDate.find({
      ratePlan: ratePlanId,
      date: { $gte: from, $lte: dates[dates.length - 1] },
    }).lean(),
  ]);

  const grid = {};
  roomTypes.forEach((rt) => { grid[String(rt._id)] = {}; });
  rateDates.forEach((rd) => {
    const key = String(rd.roomType);
    if (!grid[key]) return;

    grid[key][rd.date] = {
      id: String(rd._id),
      price: rd.price,
      stopSell: rd.stopSell,
      minLos: rd.minLos,
      maxLos: rd.maxLos || null,
      cta: rd.cta,
      ctd: rd.ctd,
      sellLimit: rd.sellLimit ?? null,
      releaseDays: rd.releaseDays ?? null,
      advancePurchaseMinDays: rd.advancePurchaseMinDays ?? null,
      lastMinuteMaxDays: rd.lastMinuteMaxDays ?? null,
      blackouts: rd.blackouts || [],
    };
  });

  res.json({ success: true, data: { roomTypes, dates, grid } });
}));

// PUT /api/rates/date (upsert single)
router.put('/date', asyncHandler(async (req, res) => {
  requireRoles(req, RATE_MANAGER_ROLES, 'Rate date update requires revenue/manager permissions');
  const {
    ratePlanId,
    roomTypeId,
    date,
    price,
    stopSell = false,
    minLos = 1,
    maxLos,
    cta = false,
    ctd = false,
    sellLimit,
    releaseDays,
    advancePurchaseMinDays,
    lastMinuteMaxDays,
    blackouts,
    weekdayAdjustmentPct,
    occupancy2Price,
    occupancy3Price,
    occupancy4Price,
    childPricePerNight,
    extraGuestPricePerNight,
  } = req.body;
  assertPropertyScope(req, req.body.propertyId);

  const setFields = {
    price: Number(price),
    stopSell: !!stopSell,
    minLos: Number(minLos) || 1,
    cta: !!cta,
    ctd: !!ctd,
  };

  if (maxLos != null) setFields.maxLos = Number(maxLos);
  if (sellLimit != null) setFields.sellLimit = Number(sellLimit);
  if (releaseDays != null) setFields.releaseDays = Number(releaseDays);
  if (advancePurchaseMinDays != null) setFields.advancePurchaseMinDays = Number(advancePurchaseMinDays);
  if (lastMinuteMaxDays != null) setFields.lastMinuteMaxDays = Number(lastMinuteMaxDays);
  if (blackouts != null) setFields.blackouts = Array.isArray(blackouts) ? blackouts : [];
  if (weekdayAdjustmentPct != null) setFields.weekdayAdjustmentPct = Number(weekdayAdjustmentPct);
  if (occupancy2Price != null) setFields.occupancy2Price = Number(occupancy2Price);
  if (occupancy3Price != null) setFields.occupancy3Price = Number(occupancy3Price);
  if (occupancy4Price != null) setFields.occupancy4Price = Number(occupancy4Price);
  if (childPricePerNight != null) setFields.childPricePerNight = Number(childPricePerNight);
  if (extraGuestPricePerNight != null) setFields.extraGuestPricePerNight = Number(extraGuestPricePerNight);

  const doc = await RateDate.findOneAndUpdate(
    { ratePlan: ratePlanId, roomType: roomTypeId, date },
    { $set: setFields },
    { upsert: true, new: true }
  );

  await enqueueChannelUpdate({
    propertyId: req.body.propertyId,
    channel: 'all',
    eventType: 'rate',
    payload: { action: 'upsert', ratePlanId, roomTypeId, date, fields: setFields },
    idempotencyKey: `rate:${ratePlanId}:${roomTypeId}:${date}`,
  }).catch(() => null);

  res.json({ success: true, data: doc });
}));

// PUT /api/rates/bulk
router.put('/bulk', asyncHandler(async (req, res) => {
  requireRoles(req, RATE_MANAGER_ROLES, 'Rate bulk update requires revenue/manager permissions');
  const {
    ratePlanId,
    roomTypeId,
    from,
    to,
    price,
    stopSell,
    minLos,
    maxLos,
    cta,
    ctd,
    sellLimit,
    releaseDays,
    advancePurchaseMinDays,
    lastMinuteMaxDays,
    blackouts,
  } = req.body;
  assertPropertyScope(req, req.body.propertyId);

  const dates = [];
  let cur = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const setFields = {
    price: Number(price),
    stopSell: !!stopSell,
    minLos: Number(minLos) || 1,
    cta: !!cta,
    ctd: !!ctd,
  };

  if (maxLos != null) setFields.maxLos = Number(maxLos);
  if (sellLimit != null) setFields.sellLimit = Number(sellLimit);
  if (releaseDays != null) setFields.releaseDays = Number(releaseDays);
  if (advancePurchaseMinDays != null) setFields.advancePurchaseMinDays = Number(advancePurchaseMinDays);
  if (lastMinuteMaxDays != null) setFields.lastMinuteMaxDays = Number(lastMinuteMaxDays);
  if (blackouts != null) setFields.blackouts = Array.isArray(blackouts) ? blackouts : [];

  const ops = dates.map((date) => ({
    updateOne: {
      filter: { ratePlan: ratePlanId, roomType: roomTypeId, date },
      update: { $set: setFields },
      upsert: true,
    },
  }));

  await RateDate.bulkWrite(ops, { ordered: false });

  await enqueueChannelUpdate({
    propertyId: req.body.propertyId,
    channel: 'all',
    eventType: 'rate',
    payload: { action: 'bulk_upsert', ratePlanId, roomTypeId, from, to, fields: setFields },
    idempotencyKey: `rate:bulk:${ratePlanId}:${roomTypeId}:${from}:${to}`,
  }).catch(() => null);

  res.json({ success: true, data: { updated: dates.length } });
}));

// POST /api/rates/override
router.post('/override', asyncHandler(async (req, res) => {
  requireRoles(req, OVERRIDE_ROLES, 'Rate override requires revenue or manager permissions');
  const {
    propertyId,
    ratePlanId,
    roomTypeId,
    date,
    newPrice,
    reason,
    afterCheckIn,
  } = req.body;
  assertPropertyScope(req, propertyId);

  if (!reason) {
    return res.status(400).json({ success: false, error: 'Reason is required for manual override' });
  }

  if (afterCheckIn) {
    requireRoles(req, HIGH_PRIV_OVERRIDE_ROLES, 'Post check-in override requires high privilege');
  }

  const current = await RateDate.findOne({ ratePlan: ratePlanId, roomType: roomTypeId, date });
  if (!current) {
    return res.status(404).json({ success: false, error: 'RateDate not found for override' });
  }

  const originalPrice = current.price;
  current.price = Number(newPrice);
  await current.save();

  const actor = actorOrSystem(req);
  const log = await RateOverrideLog.create({
    property: propertyId,
    ratePlan: ratePlanId,
    roomType: roomTypeId,
    date,
    originalPrice,
    newPrice: Number(newPrice),
    reason,
    changedBy: actor.id || undefined,
    changedByName: actor.name || 'system',
    changedByRole: actor.role || 'system',
    afterCheckIn: !!afterCheckIn,
    approvedHighPrivilege: !!afterCheckIn,
  });

  await audit({
    property: propertyId,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'rate.override',
    entityType: 'RateDate',
    entityId: current._id,
    before: { price: originalPrice },
    after: { price: current.price },
    reason,
    ip: req.ip,
  }).catch(() => null);

  await enqueueChannelUpdate({
    propertyId,
    channel: 'all',
    eventType: 'rate',
    payload: { action: 'override', ratePlanId, roomTypeId, date, newPrice: Number(newPrice), reason },
    idempotencyKey: `rate:override:${ratePlanId}:${roomTypeId}:${date}:${Date.now()}`,
  }).catch(() => null);

  res.json({ success: true, data: { rateDate: current, overrideLog: log } });
}));

// GET /api/rates/overrides?propertyId=&ratePlanId=&roomTypeId=&from=&to=
router.get('/overrides', asyncHandler(async (req, res) => {
  const { propertyId, ratePlanId, roomTypeId, from, to } = req.query;
  assertPropertyScope(req, propertyId);
  const filter = { property: propertyId };
  if (ratePlanId) filter.ratePlan = ratePlanId;
  if (roomTypeId) filter.roomType = roomTypeId;
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = from;
    if (to) filter.date.$lte = to;
  }

  const logs = await RateOverrideLog.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  res.json({ success: true, data: logs });
}));

// POST /api/rates/quote
router.post('/quote', asyncHandler(async (req, res) => {
  const {
    propertyId,
    ratePlanId,
    roomTypeId,
    arrivalDate,
    departureDate,
    adults = 2,
    children = 0,
    channel = 'direct',
    companyId,
    agentId,
    promoCode,
    loyaltyTier,
    bookingDate,
  } = req.body;
  assertPropertyScope(req, propertyId);

  const dates = getStayDates(arrivalDate, departureDate);
  if (!dates.length) return res.status(400).json({ success: false, error: 'Invalid stay dates' });

  const los = dates.length;
  const bookDate = bookingDate || new Date().toISOString().split('T')[0];
  const leadDays = Math.max(0, daysBetween(bookDate, arrivalDate));

  const [plan, rateRows] = await Promise.all([
    RatePlan.findById(ratePlanId).lean(),
    RateDate.find({ ratePlan: ratePlanId, roomType: roomTypeId, date: { $in: dates } }).lean(),
  ]);

  if (!plan || String(plan.property) !== String(propertyId)) {
    return res.status(404).json({ success: false, error: 'Rate plan not found for property' });
  }

  if (!plan.active) {
    return res.status(400).json({ success: false, error: 'Rate plan is inactive' });
  }

  if (plan.channels?.length && !plan.channels.includes(channel)) {
    return res.status(400).json({ success: false, error: 'Rate plan is not active for this channel' });
  }

  if (plan.activeRoomTypes?.length && !plan.activeRoomTypes.map(String).includes(String(roomTypeId))) {
    return res.status(400).json({ success: false, error: 'Rate plan is not active for this room type' });
  }

  const rowByDate = new Map(rateRows.map((r) => [r.date, r]));
  const nightly = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const row = rowByDate.get(date);
    if (!row) {
      return res.status(400).json({ success: false, error: `Missing rate row for ${date}` });
    }

    if (row.stopSell) return res.status(400).json({ success: false, error: `Stop-sell on ${date}` });
    if (i === 0 && row.cta) return res.status(400).json({ success: false, error: `Closed to arrival on ${date}` });
    if (i === dates.length - 1 && row.ctd) return res.status(400).json({ success: false, error: `Closed to departure on ${date}` });
    if (row.minLos && los < row.minLos) return res.status(400).json({ success: false, error: `Minimum stay is ${row.minLos}` });
    if (row.maxLos && los > row.maxLos) return res.status(400).json({ success: false, error: `Maximum stay is ${row.maxLos}` });
    if (row.advancePurchaseMinDays != null && leadDays < row.advancePurchaseMinDays) {
      return res.status(400).json({ success: false, error: `Advance purchase minimum is ${row.advancePurchaseMinDays} days` });
    }
    if (row.lastMinuteMaxDays != null && leadDays > row.lastMinuteMaxDays) {
      return res.status(400).json({ success: false, error: `Last-minute window maximum is ${row.lastMinuteMaxDays} days` });
    }
    if (row.releaseDays != null && leadDays < row.releaseDays) {
      return res.status(400).json({ success: false, error: `Release days rule blocks booking for ${date}` });
    }

    const blockedByBlackout = (row.blackouts || []).some((b) => {
      if (!b?.fromDate || !b?.toDate) return false;
      return date >= b.fromDate && date <= b.toDate;
    });
    if (blockedByBlackout) {
      return res.status(400).json({ success: false, error: `Blackout date on ${date}` });
    }

    let price = row.price;

    if (row.weekdayAdjustmentPct != null) {
      price = price * (1 + Number(row.weekdayAdjustmentPct) / 100);
    }

    if (adults >= 4 && row.occupancy4Price != null) price = row.occupancy4Price;
    else if (adults === 3 && row.occupancy3Price != null) price = row.occupancy3Price;
    else if (adults === 2 && row.occupancy2Price != null) price = row.occupancy2Price;

    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const ctx = { date, weekday, adults, children, los, leadDays, channel, companyId, agentId, promoCode, loyaltyTier };

    const rules = [...(plan.pricingRules || [])]
      .filter((r) => matchesRule(r, ctx))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    const appliedRules = [];
    for (const rule of rules) {
      const before = price;
      price = applyRuleToPrice(price, rule);

      if (children > 0 && rule.childPricePerNight != null) {
        price += Number(rule.childPricePerNight) * children;
      }
      const extraAdults = Math.max(0, adults - 2);
      if (extraAdults > 0 && rule.extraGuestPricePerNight != null) {
        price += Number(rule.extraGuestPricePerNight) * extraAdults;
      }

      appliedRules.push({ ruleId: String(rule._id), name: rule.name, before, after: price });
    }

    if (children > 0 && row.childPricePerNight != null) {
      price += Number(row.childPricePerNight) * children;
    }
    const extraAdults = Math.max(0, adults - 2);
    if (extraAdults > 0 && row.extraGuestPricePerNight != null) {
      price += Number(row.extraGuestPricePerNight) * extraAdults;
    }

    nightly.push({
      date,
      basePrice: row.price,
      finalPrice: Math.max(0, Math.round(price)),
      appliedRules,
    });
  }

  const subtotal = nightly.reduce((sum, n) => sum + n.finalPrice, 0);
  const taxAmount = Math.round(subtotal * 0.17);

  res.json({
    success: true,
    data: {
      ratePlanId,
      roomTypeId,
      arrivalDate,
      departureDate,
      nights: nightly.length,
      nightly,
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
      currency: 'ILS',
    },
  });
}));

// GET /api/rates/used-by-active-reservations?ratePlanId=
router.get('/used-by-active-reservations', asyncHandler(async (req, res) => {
  const { ratePlanId } = req.query;
  const count = await Reservation.countDocuments({
    ratePlan: ratePlanId,
    status: { $nin: ['cancelled', 'no_show', 'checked_out'] },
  });
  res.json({ success: true, data: { activeReservations: count } });
}));

export default router;
