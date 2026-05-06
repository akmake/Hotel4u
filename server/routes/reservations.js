import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import StaySegment from '../models/StaySegment.js';
import Room from '../models/Room.js';
import Folio from '../models/Folio.js';
import GuestProfile from '../models/GuestProfile.js';
import Property from '../models/Property.js';
import { checkAvailability, incrementInventory } from '../services/availabilityService.js';
import {
  createReservation,
  checkIn,
  checkOut,
  cancelReservation,
  markNoShow,
  modifyReservation,
} from '../services/reservationService.js';
import { audit } from '../services/auditService.js';
import { actorOrSystem, assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import { emit } from '../services/webhookService.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const router = Router();
const OVERRIDE_ROLES = ['super_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const HIGH_PRIV_CHECKIN_ROLES = ['super_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const HIGH_PRIV_CHECKOUT_ROLES = ['super_admin', 'property_admin', 'general_manager', 'finance_manager', 'cashier'];
const COMMERCIAL_ROLES = ['super_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'revenue_manager', 'sales_manager'];

function actorFromReq(req) {
  return actorOrSystem(req);
}

async function getReservationOr404(resId, res) {
  const row = await Reservation.findById(resId);
  if (!row) {
    res.status(404).json({ success: false, error: 'Reservation not found' });
    return null;
  }
  return row;
}

function calcNights(fromDate, toDate) {
  return Math.round((new Date(toDate) - new Date(fromDate)) / 86400000);
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function todayByPropertyTimezone(propertyId) {
  const prop = await Property.findById(propertyId).select('timezone').lean();
  return todayYmdInTimezone(prop?.timezone || 'Asia/Jerusalem');
}

async function nextDerivedConfirmation(base = 'RES-DRV') {
  for (let i = 0; i < 8; i++) {
    const candidate = `${base}-${Date.now().toString().slice(-7)}${i}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Reservation.exists({ confirmationNumber: candidate });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// GET /api/reservations/availability/check
router.get('/availability/check', asyncHandler(async (req, res) => {
  const { propertyId, roomTypeId, arrivalDate, departureDate, requiredRooms = 1 } = req.query;
  assertPropertyScope(req, propertyId);
  const result = await checkAvailability({
    propertyId,
    roomTypeId,
    arrivalDate,
    departureDate,
    requiredRooms: Number(requiredRooms) || 1,
  });
  res.json({ success: true, data: result });
}));

// GET /api/reservations?propertyId=&status=&arrivalDate=&departureDate=&q=&search=&source=&paymentStatus=&dateFrom=&dateTo=&company=&page=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const {
    propertyId, status, arrivalDate, departureDate,
    q, search, source, paymentStatus, company, groupCode,
    dateFrom, dateTo,
    page = 1, limit = 50,
  } = req.query;
  assertPropertyScope(req, propertyId);

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(200, Math.max(1, Number(limit) || 50));
  const filter = { property: propertyId };
  if (status)        filter.status = { $in: String(status).split(',') };
  if (arrivalDate)   filter.arrivalDate  = { $gte: arrivalDate };
  if (departureDate) filter.departureDate = { $lte: departureDate };
  if (dateFrom)      filter.arrivalDate  = { ...(filter.arrivalDate || {}), $gte: dateFrom };
  if (dateTo)        filter.departureDate = { ...(filter.departureDate || {}), $lte: dateTo };
  if (company)       filter.company = company;
  if (groupCode)     filter.groupCode = groupCode;
  if (source)        filter.source = source;
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  const searchTerm = String(q || search || '').trim();
  if (searchTerm) {
    const searchRegex = new RegExp(escapeRegex(searchTerm), 'i');
    const guestMatches = await GuestProfile.find({
      property: propertyId,
      $or: [
        { firstName: { $regex: searchRegex } },
        { lastName: { $regex: searchRegex } },
        { email: { $regex: searchRegex } },
        { phone: { $regex: searchRegex } },
      ],
    }).select('_id').lean();
    const guestIds = guestMatches.map((g) => g._id);

    filter.$or = [
      { confirmationNumber: { $regex: searchRegex } },
      { channelReservationId: { $regex: searchRegex } },
      { externalId: { $regex: searchRegex } },
    ];
    if (guestIds.length > 0) filter.$or.push({ primaryGuest: { $in: guestIds } });
  }

  const total = await Reservation.countDocuments(filter);
  const reservations = await Reservation.find(filter)
    .populate('primaryGuest', 'firstName lastName email phone vipLevel country')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .populate('ratePlan', 'name code')
    .populate('company', 'name code')
    .populate('travelAgent', 'name code')
    .sort({ arrivalDate: 1, createdAt: -1 })
    .skip((pageNumber - 1) * limitNumber)
    .limit(limitNumber)
    .lean();

  res.json({ success: true, data: reservations, total, page: pageNumber, limit: limitNumber });
}));

const createSchema = z.object({
  propertyId: z.string(),
  roomTypeId: z.string(),
  arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  primaryGuestId: z.string(),
  adults: z.number().min(1).default(2),
  children: z.number().min(0).default(0),
  roomsCount: z.number().min(1).default(1),
  ratePlanId: z.string().optional(),
  ratePerNight: z.number().min(0),
  source: z.string().optional(),
  marketSegment: z.string().optional(),
  companyId: z.string().optional(),
  travelAgentId: z.string().optional(),
  specialRequests: z.string().optional(),
  guestNotes: z.string().optional(),
  internalNotes: z.string().optional(),
  guaranteeType: z.string().optional(),
  language: z.string().optional(),
  currency: z.string().optional(),
  isVip: z.boolean().optional(),
  externalId: z.string().optional(),
  channelReservationId: z.string().optional(),
  idempotencyKey: z.string().min(8).optional(),
  bookingStatus: z.enum(['draft', 'quote', 'hold', 'pending_payment', 'confirmed']).optional(),
  cancellationPolicy: z.string().optional(),
  depositPolicy: z.string().optional(),
  quoteExpiresAt: z.string().optional(),
  holdExpiresAt: z.string().optional(),
  allowOverbooking: z.boolean().optional(),
});

// POST /api/reservations
router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Reservation creation requires commercial/front-desk permissions');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
  }

  const { propertyId, ...data } = parsed.data;
  assertPropertyScope(req, propertyId);

  // Overbooking requires elevated permissions (פרק כה)
  if (data.allowOverbooking) {
    requireRoles(req, OVERRIDE_ROLES, 'Overbooking override requires manager permissions');
  }

  const actor = actorFromReq(req);
  const reservation = await createReservation({
    propertyId,
    data,
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });

  res.status(201).json({ success: true, data: reservation });
}));

// POST /api/reservations/quote
router.post('/quote', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Quote creation requires commercial/front-desk permissions');
  const parsed = createSchema.partial({ primaryGuestId: true, ratePerNight: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

  const d = parsed.data;
  if (!d.propertyId || !d.roomTypeId || !d.arrivalDate || !d.departureDate) {
    return res.status(400).json({ success: false, error: 'propertyId, roomTypeId, arrivalDate, departureDate are required' });
  }
  assertPropertyScope(req, d.propertyId);

  const nights = Math.round((new Date(d.departureDate) - new Date(d.arrivalDate)) / 86400000);
  if (nights <= 0) return res.status(400).json({ success: false, error: 'Invalid dates' });

  const availability = await checkAvailability({
    propertyId: d.propertyId,
    roomTypeId: d.roomTypeId,
    arrivalDate: d.arrivalDate,
    departureDate: d.departureDate,
    requiredRooms: d.roomsCount || 1,
  });

  const rate = Number(d.ratePerNight || 0);
  const roomsCount = Math.max(1, Number(d.roomsCount || 1));
  const subtotal = rate * nights * roomsCount;
  const taxAmount = Math.round(subtotal * 0.17);

  res.json({
    success: true,
    data: {
      type: 'quote',
      available: availability.available,
      availabilityReason: availability.reason,
      nights,
      roomsCount,
      ratePerNight: rate,
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
      currency: d.currency || 'ILS',
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    },
  });
}));

// POST /api/reservations/quote/save
router.post('/quote/save', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Saving quote requires commercial/front-desk permissions');

  const parsed = createSchema
    .partial({ idempotencyKey: true, ratePlanId: true, source: true, marketSegment: true })
    .safeParse({ ...req.body, bookingStatus: req.body?.bookingStatus || 'quote' });

  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
  }

  const { propertyId, ...data } = parsed.data;
  assertPropertyScope(req, propertyId);
  const actor = actorFromReq(req);

  const saved = await createReservation({
    propertyId,
    data: {
      ...data,
      bookingStatus: data.bookingStatus === 'hold' ? 'hold' : 'quote',
      quoteExpiresAt: data.quoteExpiresAt || new Date(Date.now() + 30 * 60000).toISOString(),
    },
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });

  res.status(201).json({ success: true, data: saved });
}));

// POST /api/reservations/merge
router.post('/merge', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Merging reservations requires commercial/front-desk permissions');
  const { sourceReservationId, targetReservationId, transferCharges = true } = req.body;
  if (!sourceReservationId || !targetReservationId || sourceReservationId === targetReservationId) {
    return res.status(400).json({ success: false, error: 'sourceReservationId and targetReservationId are required' });
  }

  const source = await Reservation.findById(sourceReservationId);
  const target = await Reservation.findById(targetReservationId);
  if (!source || !target) return res.status(404).json({ success: false, error: 'Reservation not found' });
  if (String(source.property) !== String(target.property)) {
    return res.status(400).json({ success: false, error: 'Reservations must belong to same property' });
  }
  assertPropertyScope(req, source.property);

  await ReservationRoom.updateMany({ reservation: source._id }, { $set: { reservation: target._id } });
  await StaySegment.updateMany({ reservation: source._id }, { $set: { reservation: target._id } });

  if (transferCharges) {
    const [sourceFolio, targetFolio] = await Promise.all([
      Folio.findOne({ reservation: source._id, status: 'open' }),
      Folio.findOne({ reservation: target._id, status: 'open' }),
    ]);
    if (sourceFolio && targetFolio) {
      for (const line of sourceFolio.lines) {
        targetFolio.lines.push({
          ...line.toObject(),
          _id: undefined,
          description: `[Merged ${source.confirmationNumber}] ${line.description}`,
        });
      }
      sourceFolio.lines = [];
      await sourceFolio.save();
      await targetFolio.save();
    }
  }

  const targetRooms = await ReservationRoom.find({ reservation: target._id }).lean();
  const totalAmount = targetRooms.reduce((sum, rr) => {
    const nights = calcNights(rr.arrivalDate, rr.departureDate);
    return sum + Math.max(0, Number(rr.nightlyRate || 0) * Math.max(1, nights));
  }, 0);
  const taxAmount = Math.round(totalAmount * 0.17);

  await Reservation.findByIdAndUpdate(target._id, {
    $set: {
      roomsCount: targetRooms.length,
      totalAmount,
      taxAmount,
      status: 'modified',
      internalNotes: `${target.internalNotes || ''}\nMerged from ${source.confirmationNumber}`.trim(),
    },
  });

  await Reservation.findByIdAndUpdate(source._id, {
    $set: {
      status: 'cancelled',
      cancellationReason: `Merged into ${target.confirmationNumber}`,
      cancelledAt: new Date(),
      roomsCount: 0,
      totalAmount: 0,
      taxAmount: 0,
    },
  });

  const actor = actorFromReq(req);
  await audit({
    property: source.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.merged',
    entityType: 'Reservation',
    entityId: target._id,
    after: { sourceReservationId, targetReservationId },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: { mergedInto: String(target._id), mergedFrom: String(source._id) } });
}));

// POST /api/reservations/:id/split
router.post('/:id/split', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Splitting reservations requires commercial/front-desk permissions');
  const { reservationRoomIds = [], newPrimaryGuestId, notes } = req.body;
  if (!Array.isArray(reservationRoomIds) || reservationRoomIds.length === 0) {
    return res.status(400).json({ success: false, error: 'reservationRoomIds is required' });
  }

  const source = await Reservation.findById(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: 'Reservation not found' });
  assertPropertyScope(req, source.property);

  const selectedRooms = await ReservationRoom.find({
    reservation: source._id,
    _id: { $in: reservationRoomIds },
  });
  if (!selectedRooms.length) {
    return res.status(400).json({ success: false, error: 'No reservation rooms selected for split' });
  }

  const newConfirmation = await nextDerivedConfirmation('RES-SPLIT');
  const newTotals = selectedRooms.reduce((sum, rr) => {
    const nights = calcNights(rr.arrivalDate, rr.departureDate);
    return sum + Math.max(0, Number(rr.nightlyRate || 0) * Math.max(1, nights));
  }, 0);

  const newReservation = await Reservation.create({
    property: source.property,
    confirmationNumber: newConfirmation,
    status: 'confirmed',
    primaryGuest: newPrimaryGuestId || source.primaryGuest,
    adults: source.adults,
    children: source.children,
    arrivalDate: source.arrivalDate,
    departureDate: source.departureDate,
    nights: source.nights,
    roomsCount: selectedRooms.length,
    source: source.source,
    marketSegment: source.marketSegment,
    ratePlan: source.ratePlan,
    roomType: source.roomType,
    assignedRoom: selectedRooms[0]?.assignedRoom || null,
    ratePerNight: source.ratePerNight,
    totalAmount: newTotals,
    taxAmount: Math.round(newTotals * 0.17),
    paymentStatus: source.paymentStatus,
    currency: source.currency,
    guaranteeType: source.guaranteeType,
    company: source.company,
    travelAgent: source.travelAgent,
    group: source.group,
    isVip: source.isVip,
    specialRequests: source.specialRequests,
    guestNotes: source.guestNotes,
    internalNotes: notes || `Split from ${source.confirmationNumber}`,
    language: source.language,
  });

  await Folio.create({
    property: source.property,
    reservation: newReservation._id,
    ownerType: 'guest',
    status: 'open',
    currency: source.currency || 'ILS',
    lines: [],
  });

  await ReservationRoom.updateMany(
    { _id: { $in: selectedRooms.map((r) => r._id) } },
    { $set: { reservation: newReservation._id } }
  );
  await StaySegment.updateMany(
    { reservationRoom: { $in: selectedRooms.map((r) => r._id) } },
    { $set: { reservation: newReservation._id } }
  );

  const remainingRooms = await ReservationRoom.find({ reservation: source._id }).lean();
  const remainingTotal = remainingRooms.reduce((sum, rr) => {
    const nights = calcNights(rr.arrivalDate, rr.departureDate);
    return sum + Math.max(0, Number(rr.nightlyRate || 0) * Math.max(1, nights));
  }, 0);
  await Reservation.findByIdAndUpdate(source._id, {
    $set: {
      roomsCount: remainingRooms.length,
      totalAmount: remainingTotal,
      taxAmount: Math.round(remainingTotal * 0.17),
      status: 'modified',
    },
  });

  const actor = actorFromReq(req);
  await audit({
    property: source.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.split',
    entityType: 'Reservation',
    entityId: source._id,
    after: { newReservationId: newReservation._id, reservationRoomIds },
    ip: req.ip,
  }).catch(() => null);

  res.status(201).json({ success: true, data: { sourceReservationId: String(source._id), newReservationId: String(newReservation._id) } });
}));

// GET /api/reservations/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const reservation = await Reservation.findById(req.params.id)
    .populate('primaryGuest')
    .populate('roomType', 'name code baseRate')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .populate('ratePlan', 'name code')
    .populate('company', 'name code')
    .populate('travelAgent', 'name code')
    .lean();

  if (!reservation) return res.status(404).json({ success: false, error: 'Reservation not found' });
  assertPropertyScope(req, reservation.property?._id || reservation.property);

  const rooms = await ReservationRoom.find({ reservation: reservation._id })
    .populate('roomTypeBooked', 'name code')
    .populate('assignedRoom', 'number floor')
    .populate('ratePlan', 'name code')
    .populate('guests', 'firstName lastName')
    .lean();

  res.json({ success: true, data: { ...reservation, reservationRooms: rooms } });
}));

// POST /api/reservations/:id/confirm
router.post('/:id/confirm', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Confirming reservation requires commercial/front-desk permissions');
  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  if (!['draft', 'quote', 'hold', 'pending_payment', 'confirmed'].includes(reservation.status)) {
    return res.status(400).json({ success: false, error: `Cannot confirm from status ${reservation.status}` });
  }

  let assignedRoom = reservation.assignedRoom;
  if (!assignedRoom) {
    const avail = await checkAvailability({
      propertyId: String(reservation.property),
      roomTypeId: String(reservation.roomType),
      arrivalDate: reservation.arrivalDate,
      departureDate: reservation.departureDate,
      requiredRooms: Math.max(1, reservation.roomsCount || 1),
      excludeReservationId: String(reservation._id),
    });
    if (!avail.available) {
      return res.status(409).json({ success: false, error: avail.reason || 'No availability to confirm reservation' });
    }
    assignedRoom = avail.availableRooms.find((r) => ['clean', 'inspected'].includes(r.cleanStatus))?._id
      || avail.availableRooms[0]?._id
      || null;
  }

  const needsInventoryCommit = ['draft', 'quote'].includes(reservation.status);
  if (needsInventoryCommit) {
    await incrementInventory(
      reservation.property,
      reservation.roomType,
      reservation.arrivalDate,
      reservation.departureDate,
      Math.max(1, reservation.roomsCount || 1),
      {
        propertyId: reservation.property,
        actorName: actorFromReq(req).name,
        ip: req.ip,
        action: 'inventory.reservation_confirmed',
        reason: `Reservation ${reservation.confirmationNumber}`,
      }
    );
  }

  const actor = actorFromReq(req);
  const updated = await Reservation.findByIdAndUpdate(
    reservation._id,
    {
      $set: {
        status: 'confirmed',
        assignedRoom: assignedRoom || null,
        quoteExpiresAt: null,
        holdExpiresAt: null,
        holdReleasedAt: null,
        updatedBy: actor.id || undefined,
      },
    },
    { new: true }
  )
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .lean();

  const folio = await Folio.findOne({ reservation: reservation._id, status: 'open' });
  if (!folio) {
    await Folio.create({
      property: reservation.property,
      reservation: reservation._id,
      ownerType: 'guest',
      status: 'open',
      currency: reservation.currency || 'ILS',
      lines: [],
    });
  }

  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.confirmed',
    entityType: 'Reservation',
    entityId: reservation._id,
    before: { status: reservation.status },
    after: { status: 'confirmed', assignedRoom: assignedRoom || null },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: updated });
}));

// POST /api/reservations/:id/send-confirmation
router.post('/:id/send-confirmation', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Sending confirmation requires front-desk permissions');
  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  const actor = actorFromReq(req);
  const updated = await Reservation.findByIdAndUpdate(
    reservation._id,
    { $set: { confirmationSent: true, updatedBy: actor.id || undefined } },
    { new: true }
  ).lean();

  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.confirmation_sent',
    entityType: 'Reservation',
    entityId: reservation._id,
    after: { confirmationSent: true },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: updated });
}));

// PATCH /api/reservations/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Reservation update requires commercial/front-desk permissions');
  const allowed = [
    'arrivalDate', 'departureDate', 'roomTypeId', 'ratePerNight', 'ratePlanId',
    'adults', 'children', 'specialRequests', 'guestNotes', 'internalNotes',
    'marketSegment', 'companyId', 'travelAgentId', 'guaranteeType',
    'channelReservationId', 'externalId', 'priceOverrideReason', 'group',
    'cancellationPolicy', 'depositPolicy',
  ];

  const data = {};
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) data[k] = req.body[k];
  });

  const existing = await getReservationOr404(req.params.id, res);
  if (!existing) return;
  assertPropertyScope(req, existing.property);
  const actor = actorFromReq(req);

  const reservation = await modifyReservation({
    reservationId: req.params.id,
    data,
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });

  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/check-in
router.post('/:id/check-in', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Check-in requires front-desk permissions');
  const { overrideClean, overrideEarlyArrival } = req.body;
  if (overrideClean || overrideEarlyArrival) {
    requireRoles(req, HIGH_PRIV_CHECKIN_ROLES, 'Override clean/early check-in requires manager privileges');
  }
  const existing = await getReservationOr404(req.params.id, res);
  if (!existing) return;
  assertPropertyScope(req, existing.property);
  const actor = actorFromReq(req);
  const reservation = await checkIn({
    reservationId: req.params.id,
    overrideClean: !!overrideClean,
    overrideEarlyArrival: !!overrideEarlyArrival,
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });

  await ReservationRoom.updateMany(
    { reservation: reservation._id, status: { $in: ['reserved', 'tentative'] } },
    { $set: { status: 'in_house' } }
  );

  emit(String(reservation.property), 'guest.checked_in', {
    reservationId: String(reservation._id),
    confirmationNumber: reservation.confirmationNumber,
    checkedInAt: reservation.checkedInAt,
  }).catch(() => null);

  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/check-out
router.post('/:id/check-out', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Check-out requires front-desk permissions');
  const { forceCheckout } = req.body;
  if (forceCheckout) {
    requireRoles(req, HIGH_PRIV_CHECKOUT_ROLES, 'Force checkout requires finance/manager privileges');
  }
  const existing = await getReservationOr404(req.params.id, res);
  if (!existing) return;
  assertPropertyScope(req, existing.property);
  const actor = actorFromReq(req);
  const reservation = await checkOut({
    reservationId: req.params.id,
    forceCheckout: !!forceCheckout,
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });

  await ReservationRoom.updateMany(
    { reservation: reservation._id, status: { $nin: ['cancelled', 'no_show'] } },
    { $set: { status: 'checked_out' } }
  );

  emit(String(reservation.property), 'guest.checked_out', {
    reservationId: String(reservation._id),
    confirmationNumber: reservation.confirmationNumber,
    checkedOutAt: reservation.checkedOutAt,
  }).catch(() => null);

  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/cancel
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Cancellation requires commercial/front-desk permissions');
  const { reason } = req.body;
  const existing = await getReservationOr404(req.params.id, res);
  if (!existing) return;
  assertPropertyScope(req, existing.property);
  const actor = actorFromReq(req);
  const reservation = await cancelReservation({
    reservationId: req.params.id,
    reason,
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });

  await ReservationRoom.updateMany({ reservation: reservation._id }, { $set: { status: 'cancelled' } });

  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/no-show
router.post('/:id/no-show', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'No-show action requires commercial/front-desk permissions');
  const existing = await getReservationOr404(req.params.id, res);
  if (!existing) return;
  assertPropertyScope(req, existing.property);
  const allowedNoShowStatuses = new Set(['confirmed', 'modified', 'pending_payment', 'hold']);
  if (!allowedNoShowStatuses.has(existing.status)) {
    return res.status(409).json({
      success: false,
      error: `Cannot mark no-show from status ${existing.status}`,
    });
  }
  const actor = actorFromReq(req);
  const reservation = await markNoShow({
    reservationId: req.params.id,
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });

  await ReservationRoom.updateMany({ reservation: reservation._id }, { $set: { status: 'no_show' } });

  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/cancellation-fee
router.post('/:id/cancellation-fee', asyncHandler(async (req, res) => {
  requireRoles(req, HIGH_PRIV_CHECKOUT_ROLES, 'Cancellation fee requires finance/manager permissions');
  const { amount, description = 'Cancellation Fee' } = req.body;
  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);
  if (!(Number(amount) > 0)) return res.status(400).json({ success: false, error: 'amount must be positive' });

  let folio = await Folio.findOne({ reservation: reservation._id, status: 'open' });
  if (!folio) {
    folio = await Folio.create({
      property: reservation.property,
      reservation: reservation._id,
      ownerType: 'guest',
      status: 'open',
      currency: reservation.currency || 'ILS',
      lines: [],
    });
  }
  folio.lines.push({
    type: 'fee',
    description,
    amount: Number(amount),
    taxAmount: 0,
    serviceDate: await todayByPropertyTimezone(reservation.property),
    source: 'manual',
    status: 'posted',
  });
  await folio.save();
  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.cancellation_fee',
    entityType: 'Folio',
    entityId: folio._id,
    after: { amount: Number(amount), reservationId: reservation._id },
    ip: req.ip,
  }).catch(() => null);
  res.status(201).json({ success: true, data: folio });
}));

// POST /api/reservations/:id/no-show-fee
router.post('/:id/no-show-fee', asyncHandler(async (req, res) => {
  requireRoles(req, HIGH_PRIV_CHECKOUT_ROLES, 'No-show fee requires finance/manager permissions');
  const { amount, description = 'No-show Fee' } = req.body;
  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);
  if (!(Number(amount) > 0)) return res.status(400).json({ success: false, error: 'amount must be positive' });

  let folio = await Folio.findOne({ reservation: reservation._id, status: 'open' });
  if (!folio) {
    folio = await Folio.create({
      property: reservation.property,
      reservation: reservation._id,
      ownerType: 'guest',
      status: 'open',
      currency: reservation.currency || 'ILS',
      lines: [],
    });
  }
  folio.lines.push({
    type: 'fee',
    description,
    amount: Number(amount),
    taxAmount: 0,
    serviceDate: await todayByPropertyTimezone(reservation.property),
    source: 'manual',
    status: 'posted',
  });
  await folio.save();
  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.no_show_fee',
    entityType: 'Folio',
    entityId: folio._id,
    after: { amount: Number(amount), reservationId: reservation._id },
    ip: req.ip,
  }).catch(() => null);
  res.status(201).json({ success: true, data: folio });
}));

// PATCH /api/reservations/:id/assign-room
router.patch('/:id/assign-room', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Room assignment requires front-desk permissions');
  const { roomId, reservationRoomId } = req.body;
  const existing = await getReservationOr404(req.params.id, res);
  if (!existing) return;
  assertPropertyScope(req, existing.property);
  const reservation = await Reservation.findByIdAndUpdate(
    req.params.id,
    { assignedRoom: roomId || null },
    { new: true }
  ).populate('assignedRoom', 'number floor').lean();

  if (!reservation) return res.status(404).json({ success: false, error: 'Reservation not found' });

  if (reservationRoomId) {
    await ReservationRoom.findByIdAndUpdate(reservationRoomId, { assignedRoom: roomId || null });
  }

  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/partial-check-in
router.post('/:id/partial-check-in', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Partial check-in requires front-desk permissions');
  const { reservationRoomIds = [], overrideClean = false } = req.body;
  if (!Array.isArray(reservationRoomIds) || reservationRoomIds.length === 0) {
    return res.status(400).json({ success: false, error: 'reservationRoomIds is required' });
  }
  if (overrideClean) requireRoles(req, HIGH_PRIV_CHECKIN_ROLES, 'Override clean check-in requires manager privileges');

  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  const rooms = await ReservationRoom.find({
    reservation: reservation._id,
    _id: { $in: reservationRoomIds },
  }).populate('assignedRoom');

  for (const rr of rooms) {
    if (rr.assignedRoom && !overrideClean && !['clean', 'inspected'].includes(rr.assignedRoom.cleanStatus)) {
      return res.status(409).json({ success: false, error: `Room ${rr.assignedRoom.number} is not clean` });
    }
  }

  await ReservationRoom.updateMany(
    { reservation: reservation._id, _id: { $in: reservationRoomIds } },
    { $set: { status: 'in_house' } }
  );
  await Room.updateMany(
    { _id: { $in: rooms.map((r) => r.assignedRoom?._id).filter(Boolean) } },
    { $set: { occStatus: 'occupied' } }
  );

  const totalRooms = await ReservationRoom.countDocuments({ reservation: reservation._id });
  const inHouseRooms = await ReservationRoom.countDocuments({ reservation: reservation._id, status: 'in_house' });
  const status = inHouseRooms >= totalRooms ? 'in_house' : 'partially_checked_in';
  const updated = await Reservation.findByIdAndUpdate(
    reservation._id,
    { $set: { status, checkedInAt: new Date() } },
    { new: true }
  ).lean();

  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.partial_check_in',
    entityType: 'Reservation',
    entityId: reservation._id,
    after: { reservationRoomIds, status },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: updated });
}));

// POST /api/reservations/:id/partial-check-out
router.post('/:id/partial-check-out', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Partial check-out requires front-desk permissions');
  const { reservationRoomIds = [] } = req.body;
  if (!Array.isArray(reservationRoomIds) || reservationRoomIds.length === 0) {
    return res.status(400).json({ success: false, error: 'reservationRoomIds is required' });
  }

  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  const rooms = await ReservationRoom.find({
    reservation: reservation._id,
    _id: { $in: reservationRoomIds },
  }).lean();

  await ReservationRoom.updateMany(
    { reservation: reservation._id, _id: { $in: reservationRoomIds } },
    { $set: { status: 'checked_out' } }
  );
  await Room.updateMany(
    { _id: { $in: rooms.map((r) => r.assignedRoom).filter(Boolean) } },
    { $set: { occStatus: 'checked_out', cleanStatus: 'dirty' } }
  );

  const totalRooms = await ReservationRoom.countDocuments({ reservation: reservation._id });
  const checkedOutRooms = await ReservationRoom.countDocuments({ reservation: reservation._id, status: 'checked_out' });
  const status = checkedOutRooms >= totalRooms ? 'checked_out' : 'partially_checked_out';
  const updated = await Reservation.findByIdAndUpdate(
    reservation._id,
    { $set: { status, checkedOutAt: status === 'checked_out' ? new Date() : undefined } },
    { new: true }
  ).lean();

  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.partial_check_out',
    entityType: 'Reservation',
    entityId: reservation._id,
    after: { reservationRoomIds, status },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: updated });
}));

// POST /api/reservations/:id/extend
router.post('/:id/extend', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Extending stay requires front-desk permissions');
  const { newDepartureDate, nightlyRate } = req.body;
  if (!newDepartureDate) return res.status(400).json({ success: false, error: 'newDepartureDate is required' });

  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);
  if (newDepartureDate <= reservation.departureDate) {
    return res.status(400).json({ success: false, error: 'newDepartureDate must be after current departureDate' });
  }

  const av = await checkAvailability({
    propertyId: String(reservation.property),
    roomTypeId: String(reservation.roomType),
    arrivalDate: reservation.departureDate,
    departureDate: newDepartureDate,
    requiredRooms: Math.max(1, reservation.roomsCount || 1),
    excludeReservationId: String(reservation._id),
  });
  if (!av.available) return res.status(409).json({ success: false, error: av.reason || 'No availability for extension' });

  await incrementInventory(
    reservation.property,
    reservation.roomType,
    reservation.departureDate,
    newDepartureDate,
    Math.max(1, reservation.roomsCount || 1),
    {
      propertyId: reservation.property,
      actorName: actorFromReq(req).name,
      ip: req.ip,
      action: 'inventory.reservation_extension',
      reason: `Reservation ${reservation.confirmationNumber}`,
    }
  );

  const newNights = calcNights(reservation.arrivalDate, newDepartureDate);
  const rate = nightlyRate != null ? Number(nightlyRate) : Number(reservation.ratePerNight);
  const totalAmount = rate * Math.max(1, newNights) * Math.max(1, reservation.roomsCount || 1);

  const updated = await Reservation.findByIdAndUpdate(
    reservation._id,
    {
      $set: {
        departureDate: newDepartureDate,
        nights: newNights,
        ratePerNight: rate,
        totalAmount,
        taxAmount: Math.round(totalAmount * 0.17),
        status: 'modified',
      },
    },
    { new: true }
  ).lean();

  await ReservationRoom.updateMany(
    { reservation: reservation._id },
    { $set: { departureDate: newDepartureDate, nightlyRate: rate } }
  );

  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.extended',
    entityType: 'Reservation',
    entityId: reservation._id,
    after: { newDepartureDate, nights: newNights },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: updated });
}));

// POST /api/reservations/:id/early-departure
router.post('/:id/early-departure', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Early departure requires front-desk permissions');
  const { newDepartureDate } = req.body;
  if (!newDepartureDate) return res.status(400).json({ success: false, error: 'newDepartureDate is required' });

  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  if (!(newDepartureDate > reservation.arrivalDate && newDepartureDate < reservation.departureDate)) {
    return res.status(400).json({ success: false, error: 'newDepartureDate must be between arrivalDate and departureDate' });
  }

  await incrementInventory(
    reservation.property,
    reservation.roomType,
    newDepartureDate,
    reservation.departureDate,
    -(Math.max(1, reservation.roomsCount || 1)),
    {
      propertyId: reservation.property,
      actorName: actorFromReq(req).name,
      ip: req.ip,
      action: 'inventory.reservation_early_departure',
      reason: `Reservation ${reservation.confirmationNumber}`,
    }
  );

  const newNights = calcNights(reservation.arrivalDate, newDepartureDate);
  const totalAmount = Number(reservation.ratePerNight) * Math.max(1, newNights) * Math.max(1, reservation.roomsCount || 1);

  const updated = await Reservation.findByIdAndUpdate(
    reservation._id,
    {
      $set: {
        departureDate: newDepartureDate,
        nights: newNights,
        totalAmount,
        taxAmount: Math.round(totalAmount * 0.17),
        status: 'modified',
      },
    },
    { new: true }
  ).lean();

  await ReservationRoom.updateMany(
    { reservation: reservation._id },
    { $set: { departureDate: newDepartureDate } }
  );

  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.early_departure',
    entityType: 'Reservation',
    entityId: reservation._id,
    after: { newDepartureDate, nights: newNights },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: updated });
}));

// POST /api/reservations/:id/upgrade
router.post('/:id/upgrade', asyncHandler(async (req, res) => {
  requireRoles(req, OVERRIDE_ROLES, 'Upgrade action requires manager/front-desk permissions');
  const { reservationRoomId, newRoomTypeId, newRoomId, nightlyRate, reason } = req.body;
  if (!newRoomTypeId && !newRoomId && nightlyRate == null) {
    return res.status(400).json({ success: false, error: 'Provide at least one of newRoomTypeId/newRoomId/nightlyRate' });
  }

  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  const rrFilter = reservationRoomId ? { _id: reservationRoomId, reservation: reservation._id } : { reservation: reservation._id };
  const rr = await ReservationRoom.findOne(rrFilter);
  if (!rr) return res.status(404).json({ success: false, error: 'Reservation room not found' });

  const patch = {};
  if (newRoomTypeId) patch.roomTypeBooked = newRoomTypeId;
  if (newRoomId) patch.assignedRoom = newRoomId;
  if (nightlyRate != null) patch.nightlyRate = Number(nightlyRate);
  const updatedRoom = await ReservationRoom.findByIdAndUpdate(rr._id, patch, { new: true }).lean();

  const segment = await StaySegment.create({
    reservationRoom: rr._id,
    reservation: reservation._id,
    property: reservation.property,
    fromDate: await todayByPropertyTimezone(reservation.property),
    toDate: rr.departureDate,
    roomType: newRoomTypeId || rr.roomTypeBooked,
    room: newRoomId || rr.assignedRoom || null,
    ratePerNight: nightlyRate != null ? Number(nightlyRate) : rr.nightlyRate,
    ratePlan: rr.ratePlan || reservation.ratePlan || null,
    changeReason: reason || 'Room upgrade',
    createdByName: actorFromReq(req).name || 'system',
  });

  await Reservation.findByIdAndUpdate(
    reservation._id,
    {
      $set: {
        status: 'modified',
        roomType: newRoomTypeId || reservation.roomType,
        assignedRoom: newRoomId || reservation.assignedRoom,
        ratePerNight: nightlyRate != null ? Number(nightlyRate) : reservation.ratePerNight,
      },
    }
  );

  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.upgrade',
    entityType: 'ReservationRoom',
    entityId: rr._id,
    after: { reservationRoomId: rr._id, newRoomTypeId, newRoomId, nightlyRate, reason },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: { reservationRoom: updatedRoom, segment } });
}));

// POST /api/reservations/transfer-charges
router.post('/transfer-charges', asyncHandler(async (req, res) => {
  requireRoles(req, HIGH_PRIV_CHECKOUT_ROLES, 'Transferring charges requires finance/manager permissions');
  const { fromReservationId, toReservationId, lineIds = [] } = req.body;
  if (!fromReservationId || !toReservationId) {
    return res.status(400).json({ success: false, error: 'fromReservationId and toReservationId are required' });
  }
  if (!Array.isArray(lineIds) || lineIds.length === 0) {
    return res.status(400).json({ success: false, error: 'lineIds is required' });
  }

  const [fromRes, toRes] = await Promise.all([
    Reservation.findById(fromReservationId).lean(),
    Reservation.findById(toReservationId).lean(),
  ]);
  if (!fromRes || !toRes) return res.status(404).json({ success: false, error: 'Reservation not found' });
  if (String(fromRes.property) !== String(toRes.property)) {
    return res.status(400).json({ success: false, error: 'Reservations must belong to same property' });
  }
  assertPropertyScope(req, fromRes.property);

  const [fromFolio, toFolio] = await Promise.all([
    Folio.findOne({ reservation: fromReservationId, status: 'open' }),
    Folio.findOne({ reservation: toReservationId, status: 'open' }),
  ]);
  if (!fromFolio || !toFolio) return res.status(404).json({ success: false, error: 'Open folio not found' });

  const moved = [];
  for (const lineId of lineIds) {
    const line = fromFolio.lines.id(lineId);
    if (!line || line.status !== 'posted') continue;
    line.status = 'voided';
    line.voidedAt = new Date();
    line.voidReason = `Transferred to ${toRes.confirmationNumber}`;
    toFolio.lines.push({
      ...line.toObject(),
      _id: undefined,
      description: `[Transfer from ${fromRes.confirmationNumber}] ${line.description}`,
      status: 'posted',
      voidedAt: undefined,
      voidReason: undefined,
    });
    moved.push(String(lineId));
  }

  await fromFolio.save();
  await toFolio.save();
  const actor = actorFromReq(req);
  await audit({
    property: fromRes.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'folio.transfer_charges',
    entityType: 'Folio',
    entityId: toFolio._id,
    after: { fromReservationId, toReservationId, lineIds: moved },
    ip: req.ip,
  }).catch(() => null);
  res.json({ success: true, data: { movedLineIds: moved } });
}));

// GET /api/reservations/:id/rooms
router.get('/:id/rooms', asyncHandler(async (req, res) => {
  const existing = await getReservationOr404(req.params.id, res);
  if (!existing) return;
  assertPropertyScope(req, existing.property);
  const rows = await ReservationRoom.find({ reservation: req.params.id })
    .populate('roomTypeBooked', 'name code')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .populate('ratePlan', 'name code')
    .populate('guests', 'firstName lastName')
    .sort({ createdAt: 1 })
    .lean();

  res.json({ success: true, data: rows });
}));

// POST /api/reservations/:id/rooms
router.post('/:id/rooms', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Adding reservation room requires front-desk permissions');
  const {
    roomTypeId,
    assignedRoom,
    arrivalDate,
    departureDate,
    ratePlanId,
    nightlyRate,
    guests,
    notes,
  } = req.body;

  const reservation = await Reservation.findById(req.params.id);
  if (!reservation) return res.status(404).json({ success: false, error: 'Reservation not found' });
  assertPropertyScope(req, reservation.property);

  const av = await checkAvailability({
    propertyId: String(reservation.property),
    roomTypeId,
    arrivalDate,
    departureDate,
    requiredRooms: 1,
    excludeReservationId: String(reservation._id),
  });

  if (!av.available) {
    return res.status(409).json({ success: false, error: av.reason || 'No availability for reservation room' });
  }

  const rr = await ReservationRoom.create({
    reservation: reservation._id,
    property: reservation.property,
    roomTypeBooked: roomTypeId,
    assignedRoom: assignedRoom || null,
    arrivalDate,
    departureDate,
    ratePlan: ratePlanId || reservation.ratePlan || null,
    nightlyRate: Number(nightlyRate || reservation.ratePerNight),
    guests: Array.isArray(guests) ? guests : [reservation.primaryGuest],
    status: reservation.status === 'in_house' ? 'in_house' : 'reserved',
    notes,
  });

  await StaySegment.create({
    reservationRoom: rr._id,
    reservation: reservation._id,
    property: reservation.property,
    fromDate: arrivalDate,
    toDate: departureDate,
    roomType: roomTypeId,
    room: assignedRoom || null,
    ratePerNight: Number(nightlyRate || reservation.ratePerNight),
    ratePlan: ratePlanId || reservation.ratePlan || null,
    changeReason: 'Additional room added to reservation',
    createdByName: 'system',
  });

  await incrementInventory(reservation.property, roomTypeId, arrivalDate, departureDate, 1, {
    propertyId: reservation.property,
    actorName: 'system',
    ip: req.ip,
    action: 'inventory.reservation_room_added',
    reason: `Reservation ${reservation.confirmationNumber}`,
  });

  const nights = Math.round((new Date(departureDate) - new Date(arrivalDate)) / 86400000);
  const roomTotal = Math.max(0, Number(nightlyRate || reservation.ratePerNight) * Math.max(1, nights));
  const roomTax = Math.round(roomTotal * 0.17);

  await Reservation.findByIdAndUpdate(reservation._id, {
    $inc: { roomsCount: 1, totalAmount: roomTotal, taxAmount: roomTax },
    $set: { status: reservation.status === 'confirmed' ? 'modified' : reservation.status },
  });

  await audit({
    property: reservation.property,
    actor: null,
    actorName: 'system',
    action: 'reservation.room_added',
    entityType: 'ReservationRoom',
    entityId: rr._id,
    before: null,
    after: rr.toObject(),
    ip: req.ip,
  }).catch(() => null);

  res.status(201).json({ success: true, data: rr });
}));

// PATCH /api/reservations/rooms/:reservationRoomId
router.patch('/rooms/:reservationRoomId', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Editing reservation room requires front-desk permissions');
  const allowed = ['assignedRoom', 'roomTypeBooked', 'arrivalDate', 'departureDate', 'ratePlan', 'nightlyRate', 'status', 'notes', 'guests'];
  const update = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }

  const existing = await ReservationRoom.findById(req.params.reservationRoomId).lean();
  if (!existing) return res.status(404).json({ success: false, error: 'Reservation room not found' });
  assertPropertyScope(req, existing.property);
  const rr = await ReservationRoom.findByIdAndUpdate(req.params.reservationRoomId, update, { new: true }).lean();
  if (!rr) return res.status(404).json({ success: false, error: 'Reservation room not found' });

  res.json({ success: true, data: rr });
}));

// DELETE /api/reservations/rooms/:reservationRoomId
router.delete('/rooms/:reservationRoomId', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Removing reservation room requires front-desk permissions');
  const rr = await ReservationRoom.findById(req.params.reservationRoomId);
  if (!rr) return res.status(404).json({ success: false, error: 'Reservation room not found' });
  assertPropertyScope(req, rr.property);

  await incrementInventory(rr.property, rr.roomTypeBooked, rr.arrivalDate, rr.departureDate, -1, {
    propertyId: rr.property,
    actorName: 'system',
    ip: req.ip,
    action: 'inventory.reservation_room_removed',
    reason: `Remove reservation room ${rr._id}`,
  });

  await StaySegment.deleteMany({ reservationRoom: rr._id });
  await ReservationRoom.deleteOne({ _id: rr._id });

  const nights = Math.round((new Date(rr.departureDate) - new Date(rr.arrivalDate)) / 86400000);
  const roomTotal = Math.max(0, Number(rr.nightlyRate || 0) * Math.max(1, nights));
  const roomTax = Math.round(roomTotal * 0.17);

  await Reservation.findByIdAndUpdate(rr.reservation, {
    $inc: { roomsCount: -1, totalAmount: -roomTotal, taxAmount: -roomTax },
    $set: { status: 'modified' },
  });

  res.json({ success: true, data: { removed: true, reservationRoomId: String(rr._id) } });
}));

// GET /api/reservations/rooms/:reservationRoomId/segments
router.get('/rooms/:reservationRoomId/segments', asyncHandler(async (req, res) => {
  const rr = await ReservationRoom.findById(req.params.reservationRoomId).lean();
  if (!rr) return res.status(404).json({ success: false, error: 'Reservation room not found' });
  assertPropertyScope(req, rr.property);
  const segments = await StaySegment.find({ reservationRoom: req.params.reservationRoomId })
    .populate('roomType', 'name code')
    .populate('room', 'number floor')
    .populate('ratePlan', 'name code')
    .sort({ fromDate: 1, createdAt: 1 })
    .lean();
  res.json({ success: true, data: segments });
}));

// POST /api/reservations/rooms/:reservationRoomId/segments
router.post('/rooms/:reservationRoomId/segments', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Adding stay segment requires front-desk permissions');
  const {
    fromDate,
    toDate,
    roomTypeId,
    roomId,
    ratePerNight,
    ratePlanId,
    changeReason,
  } = req.body;

  const rr = await ReservationRoom.findById(req.params.reservationRoomId);
  if (!rr) return res.status(404).json({ success: false, error: 'Reservation room not found' });
  assertPropertyScope(req, rr.property);

  if (fromDate < rr.arrivalDate || toDate > rr.departureDate || fromDate >= toDate) {
    return res.status(400).json({ success: false, error: 'Segment dates must be within reservation-room stay range' });
  }

  const segment = await StaySegment.create({
    reservationRoom: rr._id,
    reservation: rr.reservation,
    property: rr.property,
    fromDate,
    toDate,
    roomType: roomTypeId || rr.roomTypeBooked,
    room: roomId || rr.assignedRoom || null,
    ratePerNight: Number(ratePerNight != null ? ratePerNight : rr.nightlyRate),
    ratePlan: ratePlanId || rr.ratePlan || null,
    changeReason: changeReason || 'Manual segment change',
    createdByName: 'system',
  });

  await Reservation.findByIdAndUpdate(rr.reservation, { $set: { status: 'modified' } });

  await audit({
    property: rr.property,
    actor: null,
    actorName: 'system',
    action: 'reservation.segment_added',
    entityType: 'StaySegment',
    entityId: segment._id,
    before: null,
    after: segment.toObject(),
    reason: segment.changeReason,
    ip: req.ip,
  }).catch(() => null);

  res.status(201).json({ success: true, data: segment });
}));

// POST /api/reservations/:id/duplicate
router.post('/:id/duplicate', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Duplicating reservation requires commercial/front-desk permissions');
  const existing = await Reservation.findById(req.params.id).lean();
  if (!existing) return res.status(404).json({ success: false, error: 'Reservation not found' });
  assertPropertyScope(req, existing.property);

  const arrivalDate = req.body.arrivalDate || existing.arrivalDate;
  const departureDate = req.body.departureDate || existing.departureDate;

  const actor = actorFromReq(req);
  const copied = await createReservation({
    propertyId: String(existing.property),
    data: {
      roomTypeId: String(existing.roomType),
      arrivalDate,
      departureDate,
      primaryGuestId: String(existing.primaryGuest),
      adults: existing.adults,
      children: existing.children,
      ratePlanId: existing.ratePlan ? String(existing.ratePlan) : undefined,
      ratePerNight: existing.ratePerNight,
      source: existing.source,
      marketSegment: existing.marketSegment,
      companyId: existing.company ? String(existing.company) : undefined,
      travelAgentId: existing.travelAgent ? String(existing.travelAgent) : undefined,
      specialRequests: existing.specialRequests,
      guestNotes: existing.guestNotes,
      internalNotes: existing.internalNotes,
      language: existing.language,
      currency: existing.currency,
      guaranteeType: existing.guaranteeType,
      roomsCount: existing.roomsCount || 1,
      isVip: existing.isVip,
    },
    actorId: actor.id,
    actorName: actor.name,
    ip: req.ip,
  });

  res.status(201).json({ success: true, data: copied });
}));

// POST /api/reservations/:id/send-welcome
router.post('/:id/send-welcome', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Send welcome requires front-desk permissions');
  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  // In production: trigger email/SMS/WhatsApp via messaging service
  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.welcome_sent',
    entityType: 'Reservation',
    entityId: reservation._id,
    after: { channel: 'email' },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: { sent: true, channel: 'email' } });
}));

// POST /api/reservations/:id/add-service — פרק כב + 11.5 + 27.3
// Add service/extra charge to reservation folio (F&B, spa, etc.)
router.post('/:id/add-service', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Adding services requires front-desk permissions');
  const { description, amount, department = 'service', quantity = 1, serviceDate, taxRate = 0.17 } = req.body;
  if (!description || !(Number(amount) > 0)) {
    return res.status(400).json({ success: false, error: 'description and amount are required' });
  }

  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  if (['cancelled', 'no_show'].includes(reservation.status)) {
    return res.status(400).json({ success: false, error: 'Cannot add services to cancelled/no-show reservation' });
  }

  let folio = await Folio.findOne({ reservation: reservation._id, status: 'open' });
  if (!folio) {
    folio = await Folio.create({
      property: reservation.property,
      reservation: reservation._id,
      ownerType: 'guest',
      status: 'open',
      currency: reservation.currency || 'ILS',
      lines: [],
    });
  }

  const unitAmount = Number(amount);
  const qty = Math.max(1, Number(quantity));
  const lineAmount = unitAmount * qty;
  const lineTax = Math.round(lineAmount * Number(taxRate));

  folio.lines.push({
    type: 'charge',
    description,
    amount: lineAmount,
    taxAmount: lineTax,
    quantity: qty,
    unitPrice: unitAmount,
    department,
    serviceDate: serviceDate || await todayByPropertyTimezone(reservation.property),
    source: 'manual',
    status: 'posted',
  });
  await folio.save();

  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'folio.service_added',
    entityType: 'Folio',
    entityId: folio._id,
    after: { description, amount: lineAmount, department, reservationId: reservation._id },
    ip: req.ip,
  }).catch(() => null);

  res.status(201).json({ success: true, data: folio });
}));

// POST /api/reservations/:id/link-group — פרק כה + 26 (Group Blocks)
// Link or unlink reservation to a group block
router.post('/:id/link-group', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Linking to group requires commercial/front-desk permissions');
  const { groupId, groupCode, groupName } = req.body;

  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  if (['cancelled', 'no_show', 'checked_out'].includes(reservation.status)) {
    return res.status(400).json({ success: false, error: 'Cannot link group to closed reservation' });
  }

  const actor = actorFromReq(req);
  const groupRef = groupId || null;

  const updated = await Reservation.findByIdAndUpdate(
    reservation._id,
    { $set: { group: groupRef, groupCode: groupCode || null, groupName: groupName || null, status: 'modified' } },
    { new: true }
  ).lean();

  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.group_linked',
    entityType: 'Reservation',
    entityId: reservation._id,
    before: { group: reservation.group },
    after: { group: groupRef, groupCode, groupName },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: updated });
}));

// POST /api/reservations/:id/express-checkout-link
router.post('/:id/express-checkout-link', asyncHandler(async (req, res) => {
  requireRoles(req, COMMERCIAL_ROLES, 'Express checkout link requires front-desk permissions');
  const reservation = await getReservationOr404(req.params.id, res);
  if (!reservation) return;
  assertPropertyScope(req, reservation.property);

  if (!['in_house', 'checked_in', 'confirmed', 'partially_checked_in'].includes(reservation.status)) {
    return res.status(400).json({ success: false, error: 'הזמנה לא מתאימה ל-Express Checkout' });
  }

  // Generate a time-limited token (in production: store in DB with expiry + signature)
  const payload = JSON.stringify({
    resId: String(reservation._id),
    conf: reservation.confirmationNumber,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  });
  const token = Buffer.from(payload).toString('base64url');
  const link = `${req.protocol}://${req.get('host')}/express-checkout/${token}`;

  const actor = actorFromReq(req);
  await audit({
    property: reservation.property,
    actor: actor.id || null,
    actorName: actor.name || 'system',
    action: 'reservation.express_checkout_link_sent',
    entityType: 'Reservation',
    entityId: reservation._id,
    after: { link },
    ip: req.ip,
  }).catch(() => null);

  res.json({ success: true, data: { link, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } });
}));

export default router;
