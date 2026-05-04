import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, q, vip } = req.query;
  const filter = { property: propertyId };
  if (vip === 'true') filter.vipLevel = { $gt: 0 };
  if (q) filter.$or = [
    { firstName: new RegExp(q, 'i') },
    { lastName:  new RegExp(q, 'i') },
    { email:     new RegExp(q, 'i') },
    { phone:     new RegExp(q, 'i') },
  ];
  const guests = await GuestProfile.find(filter).sort({ totalStays: -1 }).limit(200).lean();
  res.json({ success: true, data: guests });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const guest = await GuestProfile.findById(req.params.id).lean();
  if (!guest) return res.status(404).json({ success:false, error:'אורח לא נמצא' });
  const reservations = await Reservation.find({ primaryGuest: guest._id })
    .populate('roomType','name').populate('assignedRoom','number').lean();
  res.json({ success: true, data: { ...guest, reservations } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { propertyId, firstName, lastName, email, phone, country, language, vipLevel } = req.body;
  const guest = await GuestProfile.create({ property: propertyId, firstName, lastName, email, phone, country, language, vipLevel: vipLevel || 0 });
  res.status(201).json({ success: true, data: guest });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = ['firstName','lastName','email','phone','country','language','vipLevel','preferences','allergies','internalNotes','marketingConsent'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const guest = await GuestProfile.findByIdAndUpdate(req.params.id, updates, { new: true });
  res.json({ success: true, data: guest });
}));

export default router;
