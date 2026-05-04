import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import { audit } from '../services/auditService.js';

const router = Router();

// GET /api/guests — list with filters
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, q, vip, blacklisted, tag, limit = 200 } = req.query;
  const filter = { property: propertyId, isAnonymized: { $ne: true }, mergedInto: { $exists: false } };
  if (vip === 'true')         filter.vipLevel    = { $gt: 0 };
  if (blacklisted === 'true') filter.isBlacklisted = true;
  if (tag)                    filter.tags = tag;
  if (q) filter.$or = [
    { firstName: new RegExp(q, 'i') },
    { lastName:  new RegExp(q, 'i') },
    { email:     new RegExp(q, 'i') },
    { phone:     new RegExp(q, 'i') },
    { passportNumber: new RegExp(q, 'i') },
    { loyaltyId:  new RegExp(q, 'i') },
  ];
  const guests = await GuestProfile.find(filter).sort({ totalStays: -1, createdAt: -1 }).limit(Number(limit)).lean();
  res.json({ success: true, data: guests });
}));

// GET /api/guests/:id — profile + reservation history
router.get('/:id', asyncHandler(async (req, res) => {
  const guest = await GuestProfile.findById(req.params.id).lean();
  if (!guest) return res.status(404).json({ success:false, error:'אורח לא נמצא' });
  const reservations = await Reservation.find({ primaryGuest: guest._id })
    .populate('roomType','name').populate('assignedRoom','number')
    .sort({ arrivalDate: -1 }).limit(50).lean();
  const stats = {
    totalStays:        guest.totalStays || 0,
    totalRevenue:      guest.totalRevenue || 0,
    noShowCount:       guest.noShowCount || 0,
    cancellationCount: guest.cancellationCount || 0,
    lastStay:          guest.lastStay || null,
    avgRevPerStay:     guest.totalStays > 0 ? (guest.totalRevenue / guest.totalStays) : 0,
  };
  res.json({ success: true, data: { ...guest, reservations, stats } });
}));

// POST /api/guests — create
router.post('/', asyncHandler(async (req, res) => {
  const { propertyId, firstName, lastName, email, phone, country, citizenship, language, vipLevel, gender, dateOfBirth, passportNumber, passportExpiry, loyaltyId, preferences, allergies, internalNotes, tags, marketingConsent, privacyConsent } = req.body;
  // Auto-detect returning guest by email
  let existing = null;
  if (email) existing = await GuestProfile.findOne({ property: propertyId, email: email.toLowerCase().trim(), isAnonymized: { $ne: true } });
  if (existing) return res.status(200).json({ success: true, data: existing, returning: true });

  const guest = await GuestProfile.create({ property: propertyId, firstName, lastName, email: email?.toLowerCase().trim(), phone, country, citizenship, language: language || 'he', vipLevel: Number(vipLevel) || 0, gender: gender || 'unknown', dateOfBirth, passportNumber, passportExpiry, loyaltyId, preferences, allergies, internalNotes, tags: tags || [], marketingConsent: !!marketingConsent, privacyConsent: !!privacyConsent });
  res.status(201).json({ success: true, data: guest });
}));

// PATCH /api/guests/:id — update
router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = ['firstName','lastName','email','phone','country','citizenship','language','gender','vipLevel','preferences','allergies','internalNotes','marketingConsent','privacyConsent','dateOfBirth','passportNumber','passportExpiry','loyaltyId','isBlacklisted','blacklistReason','address'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const guest = await GuestProfile.findByIdAndUpdate(req.params.id, updates, { new: true });
  if (!guest) return res.status(404).json({ success:false, error:'אורח לא נמצא' });
  res.json({ success: true, data: guest });
}));

// POST /api/guests/:id/tags — add or remove tag
router.post('/:id/tags', asyncHandler(async (req, res) => {
  const { action, tag } = req.body; // action: 'add' | 'remove'
  if (!tag) return res.status(400).json({ success:false, error:'tag required' });
  const update = action === 'remove' ? { $pull: { tags: tag } } : { $addToSet: { tags: tag } };
  const guest = await GuestProfile.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!guest) return res.status(404).json({ success:false, error:'אורח לא נמצא' });
  res.json({ success: true, data: guest });
}));

// POST /api/guests/:id/notes — add internal note
router.post('/:id/notes', asyncHandler(async (req, res) => {
  const { text, createdBy } = req.body;
  if (!text?.trim()) return res.status(400).json({ success:false, error:'text required' });
  const guest = await GuestProfile.findByIdAndUpdate(req.params.id, { $push: { notes: { text: text.trim(), createdBy: createdBy || 'system' } } }, { new: true });
  if (!guest) return res.status(404).json({ success:false, error:'אורח לא נמצא' });
  res.json({ success: true, data: guest });
}));

// DELETE /api/guests/:id/notes/:noteId — remove note
router.delete('/:id/notes/:noteId', asyncHandler(async (req, res) => {
  const guest = await GuestProfile.findByIdAndUpdate(req.params.id, { $pull: { notes: { _id: req.params.noteId } } }, { new: true });
  res.json({ success: true, data: guest });
}));

// POST /api/guests/:id/merge — merge sourceId into this profile
router.post('/:id/merge', asyncHandler(async (req, res) => {
  const { sourceId } = req.body;
  if (sourceId === req.params.id) return res.status(400).json({ success:false, error:'לא ניתן למזג עם עצמו' });

  const [target, source] = await Promise.all([
    GuestProfile.findById(req.params.id),
    GuestProfile.findById(sourceId),
  ]);
  if (!target || !source) return res.status(404).json({ success:false, error:'אורח לא נמצא' });

  // Merge stats
  target.totalStays         = (target.totalStays || 0) + (source.totalStays || 0);
  target.totalRevenue       = (target.totalRevenue || 0) + (source.totalRevenue || 0);
  target.noShowCount        = (target.noShowCount || 0) + (source.noShowCount || 0);
  target.cancellationCount  = (target.cancellationCount || 0) + (source.cancellationCount || 0);
  // Merge tags
  const mergedTags = [...new Set([...(target.tags || []), ...(source.tags || [])])];
  target.tags = mergedTags;
  // Merge notes
  if (source.notes?.length) target.notes.push(...source.notes);

  await target.save();

  // Redirect all reservations from source to target
  await Reservation.updateMany({ primaryGuest: source._id }, { primaryGuest: target._id });

  // Mark source as merged
  source.mergedInto = target._id;
  await source.save();

  await audit({ property: target.property, action: 'guest.merged', entityType: 'GuestProfile', entityId: target._id, after: { mergedFrom: sourceId }, ip: req.ip });
  res.json({ success: true, data: target });
}));

// POST /api/guests/:id/anonymize — GDPR anonymization
router.post('/:id/anonymize', asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const guest = await GuestProfile.findById(req.params.id);
  if (!guest) return res.status(404).json({ success:false, error:'אורח לא נמצא' });
  if (guest.isAnonymized) return res.status(400).json({ success:false, error:'כבר אנונימי' });

  // Check no active reservations
  const active = await Reservation.countDocuments({ primaryGuest: guest._id, status: { $in: ['confirmed','in_house','checked_in'] } });
  if (active > 0) return res.status(400).json({ success:false, error:'לא ניתן לאנונם אורח עם הזמנות פעילות' });

  guest.firstName      = '***';
  guest.lastName       = '***';
  guest.email          = `anon_${guest._id}@deleted.local`;
  guest.phone          = null;
  guest.passportNumber = null;
  guest.passportExpiry = null;
  guest.dateOfBirth    = null;
  guest.loyaltyId      = null;
  guest.address        = {};
  guest.internalNotes  = null;
  guest.preferences    = null;
  guest.allergies      = null;
  guest.notes          = [];
  guest.isAnonymized   = true;

  await guest.save();
  await audit({ property: guest.property, action: 'guest.anonymized', entityType: 'GuestProfile', entityId: guest._id, after: { reason }, ip: req.ip });
  res.json({ success: true, data: { _id: guest._id, isAnonymized: true } });
}));

// POST /api/guests/detect-returning — check by email/phone
router.post('/detect-returning', asyncHandler(async (req, res) => {
  const { propertyId, email, phone } = req.body;
  const filter = { property: propertyId, isAnonymized: { $ne: true }, mergedInto: { $exists: false } };
  const orClauses = [];
  if (email) orClauses.push({ email: email.toLowerCase().trim() });
  if (phone) orClauses.push({ phone });
  if (!orClauses.length) return res.json({ success: true, data: null });

  filter.$or = orClauses;
  const guest = await GuestProfile.findOne(filter).lean();
  res.json({ success: true, data: guest || null });
}));

export default router;

