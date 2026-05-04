import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { RatePlan, RateDate } from '../models/RatePlan.js';
import RoomType from '../models/RoomType.js';

const router = Router();

// GET /api/rates/plans?propertyId=&all=1
router.get('/plans', asyncHandler(async (req, res) => {
  const { propertyId, all } = req.query;
  const filter = { property: propertyId };
  if (!all) filter.active = true;
  const plans = await RatePlan.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean();
  res.json({ success: true, data: plans });
}));

// POST /api/rates/plans
router.post('/plans', asyncHandler(async (req, res) => {
  const {
    propertyId, code, name, type,
    isRefundable, includesBreakfast, halfBoard, fullBoard, allInclusive,
    cancellationPolicy, depositPolicy, channels, sortOrder,
  } = req.body;

  if (!propertyId || !code || !name) {
    return res.status(400).json({ success: false, error: 'נדרשים: propertyId, code, name' });
  }

  const plan = await RatePlan.create({
    property: propertyId,
    code: code.toUpperCase(),
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
    sortOrder: Number(sortOrder) || 0,
  });

  res.status(201).json({ success: true, data: plan });
}));

// PATCH /api/rates/plans/:id
router.patch('/plans/:id', asyncHandler(async (req, res) => {
  const allowed = [
    'name', 'type', 'isRefundable', 'includesBreakfast',
    'halfBoard', 'fullBoard', 'allInclusive',
    'cancellationPolicy', 'depositPolicy', 'channels', 'sortOrder', 'active',
  ];
  const update = {};
  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      update[k] = k === 'sortOrder' ? Number(req.body[k]) : req.body[k];
    }
  });

  const plan = await RatePlan.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!plan) return res.status(404).json({ success: false, error: 'תכנית לא נמצאה' });
  res.json({ success: true, data: plan });
}));

// GET /api/rates/grid?propertyId=&ratePlanId=&from=&days=14
router.get('/grid', asyncHandler(async (req, res) => {
  const { propertyId, ratePlanId } = req.query;
  const from = req.query.from;
  const days = Math.min(Number(req.query.days) || 14, 60);

  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const [roomTypes, rateDates] = await Promise.all([
    RoomType.find({ property: propertyId, active: true }).sort({ sortOrder: 1 }).lean(),
    RateDate.find({
      ratePlan: ratePlanId,
      date:     { $gte: from, $lte: dates[dates.length - 1] },
    }).lean(),
  ]);

  const grid = {};
  roomTypes.forEach(rt => { grid[String(rt._id)] = {}; });
  rateDates.forEach(rd => {
    const key = String(rd.roomType);
    if (grid[key]) {
      grid[key][rd.date] = {
        id: String(rd._id),
        price: rd.price,
        stopSell: rd.stopSell,
        minLos: rd.minLos,
        maxLos: rd.maxLos || null,
        cta: rd.cta,
        ctd: rd.ctd,
      };
    }
  });

  res.json({ success: true, data: { roomTypes, dates, grid } });
}));

// PUT /api/rates/date — upsert a single rate date
router.put('/date', asyncHandler(async (req, res) => {
  const {
    ratePlanId, roomTypeId, date,
    price, stopSell = false, minLos = 1, maxLos, cta = false, ctd = false,
  } = req.body;

  const setFields = { price: Number(price), stopSell, minLos };
  if (maxLos != null) setFields.maxLos = maxLos;
  if (cta !== undefined) setFields.cta = cta;
  if (ctd !== undefined) setFields.ctd = ctd;

  const doc = await RateDate.findOneAndUpdate(
    { ratePlan: ratePlanId, roomType: roomTypeId, date },
    setFields,
    { upsert: true, new: true }
  );
  res.json({ success: true, data: doc });
}));

// PUT /api/rates/bulk — update a range for a room type
router.put('/bulk', asyncHandler(async (req, res) => {
  const {
    ratePlanId, roomTypeId, from, to,
    price, stopSell, minLos, maxLos, cta, ctd,
  } = req.body;

  const dates = [];
  let cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }

  const setFields = { price: Number(price), stopSell: !!stopSell, minLos: minLos || 1 };
  if (maxLos != null) setFields.maxLos = maxLos;
  if (cta !== undefined) setFields.cta = !!cta;
  if (ctd !== undefined) setFields.ctd = !!ctd;

  const ops = dates.map(date => ({
    updateOne: {
      filter: { ratePlan: ratePlanId, roomType: roomTypeId, date },
      update: { $set: setFields },
      upsert: true,
    },
  }));
  await RateDate.bulkWrite(ops);
  res.json({ success: true, data: { updated: dates.length } });
}));

export default router;
