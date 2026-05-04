import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import Reservation from '../models/Reservation.js';
import { checkAvailability } from '../services/availabilityService.js';
import { createReservation, checkIn, checkOut, cancelReservation, markNoShow, modifyReservation } from '../services/reservationService.js';

const router = Router();

// GET /api/reservations?propertyId=&status=&arrivalDate=&departureDate=&guestName=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, status, arrivalDate, departureDate, q, page = 1, limit = 50 } = req.query;
  const filter = { property: propertyId };
  if (status) filter.status = { $in: status.split(',') };
  if (arrivalDate) filter.arrivalDate = { $gte: arrivalDate };
  if (departureDate) filter.departureDate = { $lte: departureDate };

  let query = Reservation.find(filter)
    .populate('primaryGuest', 'firstName lastName email phone vipLevel country')
    .populate('roomType', 'name code')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .populate('ratePlan', 'name code')
    .sort({ arrivalDate: 1, createdAt: -1 });

  const total = await Reservation.countDocuments(filter);
  const reservations = await query.skip((page - 1) * limit).limit(Number(limit)).lean();

  // Text search filter (post-query for simplicity — use MongoDB Atlas Search in prod)
  const filtered = q
    ? reservations.filter(r => {
        const name = `${r.primaryGuest?.firstName} ${r.primaryGuest?.lastName}`.toLowerCase();
        return name.includes(q.toLowerCase()) || r.confirmationNumber.toLowerCase().includes(q.toLowerCase());
      })
    : reservations;

  res.json({ success: true, data: filtered, total, page: Number(page), limit: Number(limit) });
}));

// GET /api/reservations/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const res_ = await Reservation.findById(req.params.id)
    .populate('primaryGuest')
    .populate('roomType', 'name code baseRate')
    .populate('assignedRoom', 'number floor cleanStatus opsStatus')
    .populate('ratePlan', 'name code')
    .lean();
  if (!res_) return res.status(404).json({ success:false, error:'הזמנה לא נמצאה' });
  res.json({ success: true, data: res_ });
}));

// POST /api/reservations
const createSchema = z.object({
  propertyId:     z.string(),
  roomTypeId:     z.string(),
  arrivalDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departureDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  primaryGuestId: z.string(),
  adults:         z.number().min(1).default(2),
  children:       z.number().min(0).default(0),
  ratePlanId:     z.string().optional(),
  ratePerNight:   z.number().min(0),
  source:         z.string().optional(),
  specialRequests:z.string().optional(),
  isVip:          z.boolean().optional(),
});

router.post('/', asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success:false, error: parsed.error.errors[0].message });
  }
  const { propertyId, ...data } = parsed.data;
  const reservation = await createReservation({ propertyId, data, actorId: null, actorName: 'system', ip: req.ip });
  res.status(201).json({ success: true, data: reservation });
}));

// PATCH /api/reservations/:id — modify reservation (dates, room type, price, notes)
router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = [
    'arrivalDate', 'departureDate', 'roomTypeId', 'ratePerNight', 'ratePlanId',
    'adults', 'children', 'specialRequests', 'internalNotes', 'priceOverrideReason',
  ];
  const data = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });

  const reservation = await modifyReservation({
    reservationId: req.params.id, data,
    actorId: null, actorName: 'system', ip: req.ip,
  });
  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/check-in
router.post('/:id/check-in', asyncHandler(async (req, res) => {
  const { overrideClean } = req.body;
  const reservation = await checkIn({
    reservationId: req.params.id, overrideClean: !!overrideClean,
    actorId: null, actorName: 'system', ip: req.ip,
  });
  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/check-out
router.post('/:id/check-out', asyncHandler(async (req, res) => {
  const { forceCheckout } = req.body;
  const reservation = await checkOut({
    reservationId: req.params.id, forceCheckout: !!forceCheckout,
    actorId: null, actorName: 'system', ip: req.ip,
  });
  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/cancel
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const reservation = await cancelReservation({
    reservationId: req.params.id, reason,
    actorId: null, actorName: 'system', ip: req.ip,
  });
  res.json({ success: true, data: reservation });
}));

// POST /api/reservations/:id/no-show
router.post('/:id/no-show', asyncHandler(async (req, res) => {
  const reservation = await markNoShow({
    reservationId: req.params.id, actorId: null, actorName: 'system', ip: req.ip,
  });
  res.json({ success: true, data: reservation });
}));

// PATCH /api/reservations/:id/assign-room
router.patch('/:id/assign-room', asyncHandler(async (req, res) => {
  const { roomId } = req.body;
  const reservation = await Reservation.findByIdAndUpdate(
    req.params.id,
    { assignedRoom: roomId || null },
    { new: true }
  ).populate('assignedRoom', 'number floor').lean();
  if (!reservation) return res.status(404).json({ success: false, error: 'הזמנה לא נמצאה' });
  res.json({ success: true, data: reservation });
}));

// GET /api/reservations/availability/check
router.get('/availability/check', asyncHandler(async (req, res) => {
  const { propertyId, roomTypeId, arrivalDate, departureDate } = req.query;
  const result = await checkAvailability({ propertyId, roomTypeId, arrivalDate, departureDate });
  res.json({ success: true, data: result });
}));

export default router;
