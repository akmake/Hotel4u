import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import Folio from '../models/Folio.js';
import Invoice from '../models/Invoice.js';
import GuestRegistrationCard from '../models/GuestRegistrationCard.js';
import { audit } from '../services/auditService.js';

const router = Router();

const GUEST_READ_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'receptionist',
  'sales_manager',
  'auditor',
];
const GUEST_WRITE_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'receptionist',
  'sales_manager',
];
const GUEST_PRIVACY_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
];

function requirePropertyScope(req, explicitPropertyId) {
  const propertyId = explicitPropertyId || req.query.propertyId || req.body.propertyId || req.actor?.propertyId;
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}

// GET /api/guests - list with filters
router.get('/', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_READ_ROLES);

  const propertyId = requirePropertyScope(req);
  const { q, vip, blacklisted, tag } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

  const filter = {
    property: propertyId,
    isAnonymized: { $ne: true },
    mergedInto: { $exists: false },
  };

  if (vip === 'true') filter.vipLevel = { $gt: 0 };
  if (blacklisted === 'true') filter.isBlacklisted = true;
  if (tag) filter.tags = tag;
  if (q) {
    filter.$or = [
      { firstName: new RegExp(q, 'i') },
      { lastName: new RegExp(q, 'i') },
      { email: new RegExp(q, 'i') },
      { phone: new RegExp(q, 'i') },
      { passportNumber: new RegExp(q, 'i') },
      { loyaltyId: new RegExp(q, 'i') },
    ];
  }

  const guests = await GuestProfile.find(filter)
    .sort({ totalStays: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  res.json({ success: true, data: guests });
}));

// GET /api/guests/:id - profile + reservation history
router.get('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_READ_ROLES);

  const guest = await GuestProfile.findById(req.params.id).lean();
  if (!guest) return res.status(404).json({ success: false, error: 'Guest not found' });
  assertPropertyScope(req, String(guest.property));

  const reservations = await Reservation.find({
    primaryGuest: guest._id,
    property: guest.property,
  })
    .populate('roomType', 'name')
    .populate('assignedRoom', 'number')
    .sort({ arrivalDate: -1 })
    .limit(50)
    .lean();

  const stats = {
    totalStays: guest.totalStays || 0,
    totalRevenue: guest.totalRevenue || 0,
    noShowCount: guest.noShowCount || 0,
    cancellationCount: guest.cancellationCount || 0,
    lastStay: guest.lastStay || null,
    avgRevPerStay: guest.totalStays > 0 ? (guest.totalRevenue / guest.totalStays) : 0,
  };

  res.json({ success: true, data: { ...guest, reservations, stats } });
}));

// POST /api/guests - create
router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_WRITE_ROLES);

  const {
    propertyId,
    firstName,
    lastName,
    email,
    phone,
    country,
    citizenship,
    language,
    vipLevel,
    gender,
    dateOfBirth,
    passportNumber,
    passportExpiry,
    loyaltyId,
    preferences,
    allergies,
    internalNotes,
    tags,
    marketingConsent,
    privacyConsent,
  } = req.body;

  const scopedPropertyId = requirePropertyScope(req, propertyId);

  let existing = null;
  if (email) {
    existing = await GuestProfile.findOne({
      property: scopedPropertyId,
      email: email.toLowerCase().trim(),
      isAnonymized: { $ne: true },
    });
  }

  if (existing) {
    return res.status(200).json({ success: true, data: existing, returning: true });
  }

  const guest = await GuestProfile.create({
    property: scopedPropertyId,
    firstName,
    lastName,
    email: email?.toLowerCase().trim(),
    phone,
    country,
    citizenship,
    language: language || 'he',
    vipLevel: Number(vipLevel) || 0,
    gender: gender || 'unknown',
    dateOfBirth,
    passportNumber,
    passportExpiry,
    loyaltyId,
    preferences,
    allergies,
    internalNotes,
    tags: tags || [],
    marketingConsent: !!marketingConsent,
    privacyConsent: !!privacyConsent,
  });

  res.status(201).json({ success: true, data: guest });
}));

// PATCH /api/guests/:id - update
router.patch('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_WRITE_ROLES);

  const allowed = [
    'firstName', 'lastName', 'email', 'phone',
    'country', 'citizenship', 'language', 'gender',
    'title', 'company', 'jobTitle',
    'phones', 'emails', 'addresses',
    'vipLevel', 'preferences', 'allergies', 'internalNotes',
    'marketingConsent', 'privacyConsent',
    'dateOfBirth', 'passportNumber', 'passportExpiry', 'idDocType',
    'loyaltyId', 'membershipTier', 'membershipPoints',
    'isBlacklisted', 'blacklistReason',
    'address',
    'roomTypePreference', 'bedTypePreference', 'floorPreference',
    'smokingPreference', 'pillow', 'newspaper', 'specialRequests',
  ];

  const guest = await GuestProfile.findById(req.params.id);
  if (!guest) return res.status(404).json({ success: false, error: 'Guest not found' });
  assertPropertyScope(req, String(guest.property));

  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => allowed.includes(key))
  );
  if (updates.email) updates.email = updates.email.toLowerCase().trim();

  Object.assign(guest, updates);
  await guest.save();

  res.json({ success: true, data: guest });
}));

// POST /api/guests/:id/tags - add or remove tag
router.post('/:id/tags', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_WRITE_ROLES);

  const { action, tag } = req.body;
  if (!tag) return res.status(400).json({ success: false, error: 'tag is required' });

  const guest = await GuestProfile.findById(req.params.id);
  if (!guest) return res.status(404).json({ success: false, error: 'Guest not found' });
  assertPropertyScope(req, String(guest.property));

  if (action === 'remove') {
    guest.tags = (guest.tags || []).filter((entry) => entry !== tag);
  } else {
    guest.tags = Array.from(new Set([...(guest.tags || []), tag]));
  }

  await guest.save();
  res.json({ success: true, data: guest });
}));

// POST /api/guests/:id/notes - add internal note
router.post('/:id/notes', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_WRITE_ROLES);

  const { text, createdBy } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'text is required' });

  const guest = await GuestProfile.findById(req.params.id);
  if (!guest) return res.status(404).json({ success: false, error: 'Guest not found' });
  assertPropertyScope(req, String(guest.property));

  guest.notes = guest.notes || [];
  guest.notes.push({
    text: text.trim(),
    createdBy: createdBy || req.actor?.name || req.actor?.email || 'system',
  });
  await guest.save();

  res.json({ success: true, data: guest });
}));

// DELETE /api/guests/:id/notes/:noteId - remove note
router.delete('/:id/notes/:noteId', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_WRITE_ROLES);

  const guest = await GuestProfile.findById(req.params.id);
  if (!guest) return res.status(404).json({ success: false, error: 'Guest not found' });
  assertPropertyScope(req, String(guest.property));

  guest.notes = (guest.notes || []).filter((n) => String(n._id) !== String(req.params.noteId));
  await guest.save();

  res.json({ success: true, data: guest });
}));

// POST /api/guests/:id/merge - merge sourceId into this profile
router.post('/:id/merge', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_PRIVACY_ROLES);

  const { sourceId } = req.body;
  if (!sourceId) return res.status(400).json({ success: false, error: 'sourceId is required' });
  if (sourceId === req.params.id) {
    return res.status(400).json({ success: false, error: 'Cannot merge a guest into itself' });
  }

  const [target, source] = await Promise.all([
    GuestProfile.findById(req.params.id),
    GuestProfile.findById(sourceId),
  ]);

  if (!target || !source) return res.status(404).json({ success: false, error: 'Guest not found' });
  assertPropertyScope(req, String(target.property));

  if (String(target.property) !== String(source.property)) {
    return res.status(400).json({ success: false, error: 'Guests must belong to the same property' });
  }

  target.totalStays = (target.totalStays || 0) + (source.totalStays || 0);
  target.totalRevenue = (target.totalRevenue || 0) + (source.totalRevenue || 0);
  target.noShowCount = (target.noShowCount || 0) + (source.noShowCount || 0);
  target.cancellationCount = (target.cancellationCount || 0) + (source.cancellationCount || 0);
  target.tags = Array.from(new Set([...(target.tags || []), ...(source.tags || [])]));
  if (source.notes?.length) {
    target.notes = [...(target.notes || []), ...source.notes];
  }

  await target.save();

  await Reservation.updateMany(
    { primaryGuest: source._id, property: target.property },
    { primaryGuest: target._id }
  );

  source.mergedInto = target._id;
  await source.save();

  await audit({
    property: target.property,
    action: 'guest.merged',
    entityType: 'GuestProfile',
    entityId: target._id,
    after: { mergedFrom: sourceId },
    ip: req.ip,
  });

  res.json({ success: true, data: target });
}));

// POST /api/guests/:id/anonymize - GDPR anonymization
router.post('/:id/anonymize', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_PRIVACY_ROLES);

  const { reason } = req.body;
  const guest = await GuestProfile.findById(req.params.id);
  if (!guest) return res.status(404).json({ success: false, error: 'Guest not found' });
  assertPropertyScope(req, String(guest.property));

  if (guest.isAnonymized) {
    return res.status(400).json({ success: false, error: 'Guest is already anonymized' });
  }

  const active = await Reservation.countDocuments({
    property: guest.property,
    primaryGuest: guest._id,
    status: { $in: ['confirmed', 'in_house', 'checked_in'] },
  });

  if (active > 0) {
    return res.status(400).json({
      success: false,
      error: 'Cannot anonymize a guest with active reservations',
    });
  }

  guest.firstName = '***';
  guest.lastName = '***';
  guest.email = `anon_${guest._id}@deleted.local`;
  guest.phone = null;
  guest.passportNumber = null;
  guest.passportExpiry = null;
  guest.dateOfBirth = null;
  guest.loyaltyId = null;
  guest.address = {};
  guest.internalNotes = null;
  guest.preferences = null;
  guest.allergies = null;
  guest.notes = [];
  guest.isAnonymized = true;

  await guest.save();

  await audit({
    property: guest.property,
    action: 'guest.anonymized',
    entityType: 'GuestProfile',
    entityId: guest._id,
    after: { reason },
    ip: req.ip,
  });

  res.json({ success: true, data: { _id: guest._id, isAnonymized: true } });
}));

/**
 * GET /api/guests/:id/data-export
 * ייצוא נתונים אישיים מלא — זכות עיון לפי חוק הגנת הפרטיות, תשמ"א-1981, סעיף 13
 *
 * מחזיר: פרופיל אורח + כל ההזמנות + פוליות + חשבוניות + כרטיסי רישום
 * (כל הנתונים שהמלון מחזיק על הנבדק)
 */
router.get('/:id/data-export', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_PRIVACY_ROLES, 'Data export requires privacy role');

  const guest = await GuestProfile.findById(req.params.id).lean();
  if (!guest) return res.status(404).json({ success: false, error: 'Guest not found' });
  assertPropertyScope(req, String(guest.property));

  // שלב 1: כל ההזמנות של האורח
  const reservations = await Reservation.find({
    property:     guest.property,
    primaryGuest: guest._id,
  })
    .populate('roomType',    'name code')
    .populate('assignedRoom','number floor')
    .populate('ratePlan',    'name code')
    .lean();

  const reservationIds = reservations.map(r => r._id);

  // שלב 2: כל הפוליות (כולל שורות)
  const folios = reservationIds.length
    ? await Folio.find({ reservation: { $in: reservationIds } }).lean()
    : [];

  // שלב 3: כל החשבוניות
  const invoices = reservationIds.length
    ? await Invoice.find({
        property:    guest.property,
        reservation: { $in: reservationIds },
      }).lean()
    : [];

  // שלב 4: כרטיסי רישום אורח
  const registrationCards = await GuestRegistrationCard.find({
    property: guest.property,
    guest:    guest._id,
  }).lean();

  // רישום ביקורת — מעקב אחר כל בקשת עיון
  await audit({
    property:   guest.property,
    action:     'guest.data_export',
    entityType: 'GuestProfile',
    entityId:   guest._id,
    after: { requestedBy: req.actor?._id, reason: req.query.reason || null },
    ip: req.ip,
  });

  res.json({
    success: true,
    exportedAt: new Date().toISOString(),
    dataSubject: {
      id:          String(guest._id),
      property:    String(guest.property),
    },
    data: {
      profile:           guest,
      reservations:      reservations,
      folios:            folios,
      invoices:          invoices,
      registrationCards: registrationCards,
    },
    legalBasis: {
      law:     'חוק הגנת הפרטיות, תשמ"א-1981, סעיף 13',
      right:   'זכות עיון בנתונים אישיים',
      contact: 'ממונה הגנת הפרטיות של המלון',
    },
  });
}));
router.post('/detect-returning', asyncHandler(async (req, res) => {
  requireRoles(req, GUEST_READ_ROLES);

  const { propertyId, email, phone } = req.body;
  const scopedPropertyId = requirePropertyScope(req, propertyId);

  const filter = {
    property: scopedPropertyId,
    isAnonymized: { $ne: true },
    mergedInto: { $exists: false },
  };

  const orClauses = [];
  if (email) orClauses.push({ email: email.toLowerCase().trim() });
  if (phone) orClauses.push({ phone });
  if (!orClauses.length) return res.json({ success: true, data: null });

  filter.$or = orClauses;
  const guest = await GuestProfile.findOne(filter).lean();

  res.json({ success: true, data: guest || null });
}));

export default router;
