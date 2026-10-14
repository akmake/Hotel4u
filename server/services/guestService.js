// Guests (spec GST-01 list & duplicates, GST-02 profile, GST-03 controlled merge).
//
// Rules enforced here (server-side):
//  - a guest is never identified by name alone; possible duplicates (same email / phone) are shown,
//    never merged automatically;
//  - contact details are masked in lists; identity documents are masked except for managers;
//    health/allergy notes, internal notes and blacklist reasons are restricted to managers;
//  - search by document number is for managers only;
//  - a merge needs a reason and a choice for every conflicting field; two different identity
//    documents block it; the narrower marketing consent wins; final documents are not rewritten;
//    the source profile stays as an alias pointing at the target (evidence kept).
import mongoose from 'mongoose';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import GuestRequest from '../models/GuestRequest.js';
import GuestMessage from '../models/GuestMessage.js';
import PrivacyRequest from '../models/PrivacyRequest.js';
import LostItem from '../models/LostItem.js';
import GuestRegistrationCard from '../models/GuestRegistrationCard.js';
import { audit } from './auditService.js';

function httpError(message, status = 400, extra = {}) { const e = new Error(message); e.status = status; Object.assign(e, extra); return e; }
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const esc = (q) => String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const FRONT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist'];
export const GUEST_READ = [...FRONT_ROLES, 'sales_manager', 'revenue_manager', 'finance_manager', 'cashier', 'auditor'];
export const GUEST_WRITE = [...FRONT_ROLES, 'sales_manager'];
export const GUEST_MANAGERS = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
export const PRIVACY_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
const MONEY_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'finance_manager', 'cashier', 'auditor', 'revenue_manager', 'sales_manager'];

export const maskPhone = (p) => (p ? `${'•'.repeat(Math.max(0, String(p).replace(/\D/g, '').length - 3))}${String(p).replace(/\D/g, '').slice(-3)}` : null);
export const maskEmail = (e) => (e ? String(e).replace(/^(.)[^@]*(@.*)$/, '$1•••$2') : null);
const maskDoc = (d) => (d ? `•••${String(d).slice(-4)}` : null);
const normPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^972/, '0');
const PHONE_OK = /^\+?[0-9\s\-()]{7,20}$/;
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function loadGuest(propertyId, id, { allowMerged = false } = {}) {
  if (!isId(String(id || ''))) throw httpError('מזהה אורח לא תקין', 400);
  const g = await GuestProfile.findOne({ _id: id, property: propertyId });
  if (!g) throw httpError('האורח לא נמצא', 404);
  if (!allowMerged && g.mergedInto) throw httpError('הפרופיל מוזג לפרופיל אחר', 409, { code: 'merged', details: [{ mergedInto: String(g.mergedInto) }] });
  return g;
}

// Candidates that may be the same person (same email or same phone), never merged automatically.
async function duplicateCandidates(propertyId, g) {
  const or = [];
  if (g.email && !String(g.email).endsWith('@deleted.local')) or.push({ email: String(g.email).toLowerCase() });
  const ph = normPhone(g.phone);
  if (ph.length >= 7) or.push({ phone: new RegExp(`${ph.slice(-7)}$`) });
  if (!or.length) return [];
  const list = await GuestProfile.find({ property: propertyId, _id: { $ne: g._id }, mergedInto: { $exists: false }, isAnonymized: { $ne: true }, $or: or }).select('firstName lastName email phone totalStays lastStay').limit(8).lean();
  return list.map((d) => ({ id: String(d._id), name: `${d.firstName} ${d.lastName}`, email: maskEmail(d.email), phone: maskPhone(d.phone), stays: d.totalStays || 0, sameEmail: !!(g.email && d.email && d.email.toLowerCase() === String(g.email).toLowerCase()) }));
}

// ── GST-01 ──────────────────────────────────────────────────────────────────
export async function listGuests({ propertyId, q, view = 'all', page = 1, pageSize = 50, role }) {
  const filter = { property: propertyId, mergedInto: { $exists: false }, isAnonymized: { $ne: true } };
  if (view === 'vip') filter.vipLevel = { $gt: 0 };
  if (view === 'blacklisted') filter.isBlacklisted = true;
  if (view === 'returning') filter.totalStays = { $gt: 1 };
  if (q) {
    const r = new RegExp(esc(q), 'i');
    const or = [{ firstName: r }, { lastName: r }, { email: r }, { phone: r }, { loyaltyId: r }];
    const digits = String(q).replace(/\D/g, '');
    if (digits.length >= 7) or.push({ phone: new RegExp(`${digits.slice(-7)}$`) });
    // Document number search is for managers only (GST-01-F03) and exact.
    if (GUEST_MANAGERS.includes(role) && String(q).trim().length >= 5) or.push({ passportNumber: String(q).trim() });
    const parts = String(q).trim().split(/\s+/);
    if (parts.length >= 2) or.push({ firstName: new RegExp(`^${esc(parts[0])}`, 'i'), lastName: new RegExp(`^${esc(parts.slice(1).join(' '))}`, 'i') });
    filter.$or = or;
  }
  let ids = null;
  if (view === 'duplicates') {
    // Groups of active profiles sharing an email or the last 7 phone digits.
    const byEmail = await GuestProfile.aggregate([
      { $match: { property: new mongoose.Types.ObjectId(propertyId), mergedInto: { $exists: false }, isAnonymized: { $ne: true }, email: { $nin: [null, ''] } } },
      { $group: { _id: { $toLower: '$email' }, ids: { $push: '$_id' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 200 },
    ]);
    const all = await GuestProfile.find({ property: propertyId, mergedInto: { $exists: false }, isAnonymized: { $ne: true }, phone: { $nin: [null, ''] } }).select('phone').lean();
    const byPhone = new Map();
    for (const g of all) { const k = normPhone(g.phone).slice(-7); if (k.length < 7) continue; if (!byPhone.has(k)) byPhone.set(k, []); byPhone.get(k).push(g._id); }
    ids = [...byEmail.flatMap((x) => x.ids), ...[...byPhone.values()].filter((v) => v.length > 1).flat()];
    filter._id = { $in: ids };
  }
  const size = Math.min(100, Math.max(10, Number(pageSize) || 50));
  const total = await GuestProfile.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(pages, Math.max(1, Number(page) || 1));
  const rows = await GuestProfile.find(filter).select('firstName lastName email phone vipLevel isBlacklisted totalStays lastStay language tags country').sort(view === 'duplicates' ? { email: 1, lastName: 1 } : { lastStay: -1, createdAt: -1 }).skip((p - 1) * size).limit(size).lean();
  // Flag rows that share an email/phone with another row on the page.
  const keyCount = new Map();
  for (const g of rows) for (const k of [g.email && `e:${g.email.toLowerCase()}`, normPhone(g.phone).length >= 7 && `p:${normPhone(g.phone).slice(-7)}`].filter(Boolean)) keyCount.set(k, (keyCount.get(k) || 0) + 1);
  return {
    total, page: p, pages, pageSize: size,
    rows: rows.map((g) => ({
      id: String(g._id), name: `${g.firstName} ${g.lastName}`, vip: (g.vipLevel || 0) > 0, blacklisted: !!g.isBlacklisted,
      phone: maskPhone(g.phone), email: maskEmail(g.email), stays: g.totalStays || 0, lastStay: g.lastStay || null, language: g.language || null, country: g.country || null,
      tags: g.tags || [],
      possibleDuplicate: [g.email && `e:${g.email.toLowerCase()}`, normPhone(g.phone).length >= 7 && `p:${normPhone(g.phone).slice(-7)}`].filter(Boolean).some((k) => keyCount.get(k) > 1) || view === 'duplicates',
    })),
  };
}

// ── GST-02 ──────────────────────────────────────────────────────────────────
function profileDto(g, role) {
  const manager = GUEST_MANAGERS.includes(role);
  return {
    id: String(g._id), firstName: g.firstName, lastName: g.lastName, name: `${g.firstName} ${g.lastName}`,
    email: g.email || null, phone: g.phone || null, language: g.language || 'he', gender: g.gender || 'unknown',
    address: g.address || {}, country: g.country || null, citizenship: g.citizenship || null, residency: g.residency || null,
    dateOfBirth: g.dateOfBirth || null,
    idDoc: { type: g.idDocType || null, country: g.idDocCountry || null, number: manager ? g.passportNumber || null : maskDoc(g.passportNumber), expiry: g.passportExpiry || null, verifiedBy: g.idVerifiedBy || null, verifiedAt: g.idVerifiedAt || null, masked: !manager },
    vipLevel: g.vipLevel || 0, blacklisted: !!g.isBlacklisted, blacklistReason: manager ? g.blacklistReason || null : null,
    preferences: { room: g.roomTypePreference || '', bed: g.bedTypePreference || '', floor: g.floorPreference || 'any', smoking: g.smokingPreference || 'non-smoking', notes: g.preferences || '', specialRequests: g.specialRequests || '' },
    sensitive: manager ? { allergies: g.allergies || '', internalNotes: g.internalNotes || '' } : { restricted: true, hasData: !!(g.allergies || g.internalNotes) },
    consents: {
      marketing: !!g.marketingConsent && !g.marketingOptOutAt, marketingAt: g.marketingConsentAt || null, marketingVersion: g.marketingConsentFormVer || null, marketingOptOutAt: g.marketingOptOutAt || null,
      privacy: !!g.privacyConsent, privacyAt: g.privacyConsentAt || null, privacyVersion: g.privacyPolicyVersion || null,
    },
    tags: g.tags || [], loyaltyId: g.loyaltyId || null,
    stats: { stays: g.totalStays || 0, revenue: MONEY_ROLES.includes(role) ? g.totalRevenue || 0 : null, noShows: g.noShowCount || 0, cancellations: g.cancellationCount || 0, lastStay: g.lastStay || null },
    retentionDeleteAfter: g.retentionDeleteAfter || null, anonymized: !!g.isAnonymized,
    version: g.updatedAt ? new Date(g.updatedAt).toISOString() : null, createdAt: g.createdAt,
  };
}

export async function getGuest({ propertyId, id, role }) {
  const g = await loadGuest(propertyId, id);
  const [reservations, requests, messages, privacy, duplicates] = await Promise.all([
    Reservation.find({ property: propertyId, $or: [{ primaryGuest: g._id }, { additionalGuests: g._id }] }).select('confirmationNumber status arrivalDate departureDate totalAmount currency roomType assignedRoom').populate('roomType', 'name').populate('assignedRoom', 'number').sort({ arrivalDate: -1 }).limit(50).lean(),
    GuestRequest.find({ property: propertyId, guest: g._id }).select('category description status priority createdAt').sort({ createdAt: -1 }).limit(20).lean(),
    GuestMessage.find({ property: propertyId, guest: g._id }).select('purpose channel template subject status createdAt byName').sort({ createdAt: -1 }).limit(20).lean(),
    PRIVACY_ROLES.includes(role) ? PrivacyRequest.find({ property: propertyId, guest: g._id }).select('code type status createdAt').sort({ createdAt: -1 }).lean() : [],
    duplicateCandidates(propertyId, g),
  ]);
  const money = MONEY_ROLES.includes(role);
  return {
    ...profileDto(g.toObject(), role),
    reservations: reservations.map((r) => ({ id: String(r._id), confirmationNumber: r.confirmationNumber, status: r.status, arrivalDate: r.arrivalDate, departureDate: r.departureDate, roomType: r.roomType?.name || null, room: r.assignedRoom?.number || null, total: money ? r.totalAmount : null, currency: r.currency || 'ILS' })),
    requests: requests.map((x) => ({ id: String(x._id), category: x.category, description: x.description, status: x.status, priority: x.priority, at: x.createdAt })),
    messages: messages.map((m) => ({ id: String(m._id), purpose: m.purpose, channel: m.channel, template: m.template, subject: m.subject, status: m.status, at: m.createdAt, by: m.byName })),
    privacyRequests: privacy.map((x) => ({ id: String(x._id), code: x.code, type: x.type, status: x.status, at: x.createdAt })),
    duplicates,
  };
}

function validateContact(input, fields) {
  if (input.email !== undefined && input.email !== null && String(input.email).trim() && !EMAIL_OK.test(String(input.email).trim())) fields.email = 'כתובת לא תקינה';
  if (input.phone !== undefined && input.phone !== null && String(input.phone).trim() && !PHONE_OK.test(String(input.phone).trim())) fields.phone = 'מספר בפורמט בינלאומי (+972…) או מקומי';
}

export async function createGuest({ propertyId, input, actor, ip }) {
  const fields = {};
  const firstName = String(input.firstName || '').trim().slice(0, 60);
  const lastName = String(input.lastName || '').trim().slice(0, 60);
  if (!firstName) fields.firstName = 'נדרש';
  if (!lastName) fields.lastName = 'נדרש';
  validateContact(input, fields);
  if (input.language && !['he', 'en', 'ar', 'ru', 'fr', 'de', 'es'].includes(input.language)) fields.language = 'שפה לא נתמכת';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי האורח', 422, { fields });
  const email = input.email ? String(input.email).trim().toLowerCase() : undefined;
  const phone = input.phone ? String(input.phone).trim() : undefined;
  if (!input.force) {
    const dups = await duplicateCandidates(propertyId, { _id: null, email, phone });
    if (dups.length) throw httpError('נמצא אורח קיים עם אותו טלפון או דוא״ל', 409, { code: 'possible_duplicate', details: dups });
  }
  const g = await GuestProfile.create({ property: propertyId, firstName, lastName, email, phone, language: input.language || 'he', country: input.country || undefined });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'guest.created', entityType: 'GuestProfile', entityId: g._id, ip });
  return { id: String(g._id) };
}

export async function updateGuest({ propertyId, id, input, actor, ip }) {
  const g = await loadGuest(propertyId, id);
  if (g.isAnonymized) throw httpError('הפרופיל עבר אנונימיזציה ואינו ניתן לעריכה', 409);
  if (input.version && g.updatedAt && new Date(g.updatedAt).toISOString() !== String(input.version)) throw httpError('הפרופיל עודכן בינתיים — רעננו ובדקו שוב', 409, { code: 'version_conflict' });
  const manager = GUEST_MANAGERS.includes(actor.role);
  const fields = {};
  validateContact(input, fields);
  const before = { email: g.email, phone: g.phone, vipLevel: g.vipLevel, isBlacklisted: g.isBlacklisted, firstName: g.firstName, lastName: g.lastName };
  const str = (v, n = 200) => (v === undefined ? undefined : String(v ?? '').trim().slice(0, n));
  if (input.firstName !== undefined) { const v = str(input.firstName, 60); if (!v) fields.firstName = 'נדרש'; else g.firstName = v; }
  if (input.lastName !== undefined) { const v = str(input.lastName, 60); if (!v) fields.lastName = 'נדרש'; else g.lastName = v; }
  if (input.email !== undefined) g.email = str(input.email, 120)?.toLowerCase() || undefined;
  if (input.phone !== undefined) g.phone = str(input.phone, 30) || undefined;
  if (input.language !== undefined) g.language = str(input.language, 5) || 'he';
  for (const k of ['country', 'citizenship', 'residency']) if (input[k] !== undefined) g[k] = str(input[k], 60) || undefined;
  if (input.address !== undefined) g.address = { line1: str(input.address?.line1, 200), city: str(input.address?.city, 80), zip: str(input.address?.zip, 20), country: str(input.address?.country, 60) };
  if (input.dateOfBirth !== undefined) {
    if (input.dateOfBirth && Number.isNaN(Date.parse(input.dateOfBirth))) fields.dateOfBirth = 'תאריך לא תקין';
    else g.dateOfBirth = input.dateOfBirth ? new Date(input.dateOfBirth) : undefined;
  }
  if (input.idDoc) {
    if (input.idDoc.type !== undefined) { if (input.idDoc.type && !['passport', 'id_card', 'drivers_license', 'other'].includes(input.idDoc.type)) fields.idDocType = 'סוג לא מוכר'; else g.idDocType = input.idDoc.type || undefined; }
    if (input.idDoc.country !== undefined) g.idDocCountry = str(input.idDoc.country, 60) || undefined;
    if (input.idDoc.number !== undefined && !String(input.idDoc.number).startsWith('•')) { g.passportNumber = str(input.idDoc.number, 40) || undefined; g.idVerifiedBy = undefined; g.idVerifiedAt = undefined; }
    if (input.idDoc.expiry !== undefined) g.passportExpiry = input.idDoc.expiry ? new Date(input.idDoc.expiry) : undefined;
  }
  if (input.preferences) {
    const pr = input.preferences;
    if (pr.room !== undefined) g.roomTypePreference = str(pr.room, 60);
    if (pr.bed !== undefined && ['king', 'queen', 'twin', 'double', 'single', ''].includes(pr.bed)) g.bedTypePreference = pr.bed;
    if (pr.floor !== undefined && ['high', 'low', 'middle', 'any'].includes(pr.floor)) g.floorPreference = pr.floor;
    if (pr.smoking !== undefined && ['smoking', 'non-smoking', 'any'].includes(pr.smoking)) g.smokingPreference = pr.smoking;
    if (pr.notes !== undefined) g.preferences = str(pr.notes, 500);
    if (pr.specialRequests !== undefined) g.specialRequests = str(pr.specialRequests, 500);
  }
  if (input.sensitive) {
    if (!manager) throw httpError('מידע רגיש נערך על ידי מנהל בלבד', 403);
    if (input.sensitive.allergies !== undefined) g.allergies = str(input.sensitive.allergies, 500);
    if (input.sensitive.internalNotes !== undefined) g.internalNotes = str(input.sensitive.internalNotes, 1000);
  }
  if (input.vipLevel !== undefined) {
    if (!manager) throw httpError('דרגת VIP נקבעת על ידי מנהל', 403);
    const v = Number(input.vipLevel);
    if (!(Number.isInteger(v) && v >= 0 && v <= 5)) fields.vipLevel = '0 עד 5'; else g.vipLevel = v;
  }
  if (input.blacklisted !== undefined) {
    if (!manager) throw httpError('רשימה שחורה מנוהלת על ידי מנהל', 403);
    const why = str(input.blacklistReason, 300);
    if (input.blacklisted && (!why || why.length < 3)) fields.blacklistReason = 'סיבה נדרשת';
    else { g.isBlacklisted = !!input.blacklisted; g.blacklistReason = input.blacklisted ? why : undefined; }
  }
  if (input.tags !== undefined) g.tags = (Array.isArray(input.tags) ? input.tags : []).map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 20);
  if (Object.keys(fields).length) throw httpError('יש לתקן את הפרופיל', 422, { fields });
  const contactChanged = (before.email || '') !== (g.email || '') || (before.phone || '') !== (g.phone || '');
  if (contactChanged && !input.force) {
    const dups = await duplicateCandidates(propertyId, g);
    if (dups.length) throw httpError('הטלפון או הדוא״ל כבר רשומים לאורח אחר', 409, { code: 'possible_duplicate', details: dups });
  }
  await g.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'guest.updated', entityType: 'GuestProfile', entityId: g._id, before: { email: before.email, phone: before.phone, vipLevel: before.vipLevel, isBlacklisted: before.isBlacklisted }, after: { email: g.email, phone: g.phone, vipLevel: g.vipLevel, isBlacklisted: g.isBlacklisted, fields: Object.keys(input).filter((k) => k !== 'version' && k !== 'propertyId') }, ip });
  return profileDto(g.toObject(), actor.role);
}

export async function verifyDocument({ propertyId, id, actor, ip }) {
  const g = await loadGuest(propertyId, id);
  if (!g.passportNumber) throw httpError('אין מספר מסמך לאימות', 422);
  g.idVerifiedBy = actor.name;
  g.idVerifiedAt = new Date();
  await g.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'guest.document_verified', entityType: 'GuestProfile', entityId: g._id, after: { type: g.idDocType }, ip });
  return { verifiedBy: g.idVerifiedBy, verifiedAt: g.idVerifiedAt };
}

// ── GST-03 ──────────────────────────────────────────────────────────────────
const MERGE_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'language', 'dateOfBirth', 'citizenship', 'country', 'idDocType', 'passportNumber'];
const show = (k, v, role) => {
  if (v === undefined || v === null || v === '') return null;
  if (k === 'passportNumber') return GUEST_MANAGERS.includes(role) ? v : maskDoc(v);
  if (k === 'dateOfBirth') return new Date(v).toISOString().slice(0, 10);
  return String(v);
};

export async function mergePreview({ propertyId, sourceId, targetId, role }) {
  if (String(sourceId) === String(targetId)) throw httpError('יש לבחור שני פרופילים שונים', 422);
  const [source, target] = await Promise.all([loadGuest(propertyId, sourceId), loadGuest(propertyId, targetId)]);
  if (source.isAnonymized || target.isAnonymized) throw httpError('אי אפשר למזג פרופיל שעבר אנונימיזציה', 409);
  const conflicts = [];
  for (const k of MERGE_FIELDS) {
    const a = source[k]; const b = target[k];
    const sa = a instanceof Date ? a.toISOString().slice(0, 10) : String(a ?? '').trim().toLowerCase();
    const sb = b instanceof Date ? b.toISOString().slice(0, 10) : String(b ?? '').trim().toLowerCase();
    if (sa && sb && sa !== sb) conflicts.push({ field: k, source: show(k, a, role), target: show(k, b, role) });
  }
  const blockers = [];
  if (source.passportNumber && target.passportNumber && String(source.passportNumber).trim() !== String(target.passportNumber).trim()) blockers.push({ code: 'different_document', label: 'שני מסמכי זיהוי שונים — כנראה שני אנשים. לא ממזגים.' });
  const warnings = [];
  if (source.email && target.email && source.email.toLowerCase() === target.email.toLowerCase() && (source.firstName !== target.firstName)) warnings.push('אותו דוא״ל עם שמות שונים — ייתכן דוא״ל משפחתי');
  const [srcStays, tgtStays] = await Promise.all([Reservation.countDocuments({ property: propertyId, primaryGuest: source._id }), Reservation.countDocuments({ property: propertyId, primaryGuest: target._id })]);
  const marketing = !!source.marketingConsent && !!target.marketingConsent && !source.marketingOptOutAt && !target.marketingOptOutAt;
  return {
    source: { id: String(source._id), name: `${source.firstName} ${source.lastName}`, stays: srcStays }, target: { id: String(target._id), name: `${target.firstName} ${target.lastName}`, stays: tgtStays },
    conflicts, blockers, warnings, canMerge: blockers.length === 0,
    resultingConsent: { marketing, note: marketing ? 'שני הפרופילים הסכימו לשיווק' : 'ההסכמה הצרה גוברת — לא תהיה הסכמה שיווקית אחרי המיזוג' },
    note: 'הזמנות, בקשות והודעות יעברו לפרופיל היעד. חשבוניות וחשבונות שהופקו לא משתנים. פרופיל המקור יישמר כהפניה.',
  };
}

export async function mergeGuests({ propertyId, sourceId, targetId, choices = {}, reason, actor, ip }) {
  if (!GUEST_MANAGERS.includes(actor.role)) throw httpError('מיזוג פרופילים מותר למנהל', 403);
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('מיזוג מחייב סיבה', 422, { fields: { reason: 'נדרש' } });
  const preview = await mergePreview({ propertyId, sourceId, targetId, role: actor.role });
  if (!preview.canMerge) throw httpError(preview.blockers[0].label, 409, { code: 'blocked', details: preview.blockers });
  const missing = preview.conflicts.filter((c) => !['source', 'target'].includes(choices[c.field]));
  if (missing.length) throw httpError('יש לבחור ערך לכל שדה מתנגש', 422, { fields: { choices: missing.map((m) => m.field).join(', ') } });
  const [source, target] = await Promise.all([loadGuest(propertyId, sourceId), loadGuest(propertyId, targetId)]);
  const before = { source: preview.source, target: preview.target, conflicts: preview.conflicts };
  for (const k of MERGE_FIELDS) {
    if (choices[k] === 'source') target[k] = source[k];
    else if (!target[k] && source[k]) target[k] = source[k];
  }
  target.totalStays = (target.totalStays || 0) + (source.totalStays || 0);
  target.totalRevenue = (target.totalRevenue || 0) + (source.totalRevenue || 0);
  target.noShowCount = (target.noShowCount || 0) + (source.noShowCount || 0);
  target.cancellationCount = (target.cancellationCount || 0) + (source.cancellationCount || 0);
  if (source.lastStay && (!target.lastStay || source.lastStay > target.lastStay)) target.lastStay = source.lastStay;
  target.tags = [...new Set([...(target.tags || []), ...(source.tags || [])])];
  if (source.notes?.length) target.notes = [...(target.notes || []), ...source.notes];
  target.vipLevel = Math.max(target.vipLevel || 0, source.vipLevel || 0);
  if (source.isBlacklisted && !target.isBlacklisted) { target.isBlacklisted = true; target.blacklistReason = source.blacklistReason; }
  // The narrower marketing consent wins (GST-03-F04).
  if (!preview.resultingConsent.marketing) { target.marketingConsent = false; target.marketingOptOutAt = target.marketingOptOutAt || source.marketingOptOutAt || undefined; }
  await target.save();
  await Promise.all([
    Reservation.updateMany({ property: propertyId, primaryGuest: source._id }, { $set: { primaryGuest: target._id } }),
    Reservation.updateMany({ property: propertyId, additionalGuests: source._id }, { $set: { 'additionalGuests.$[g]': target._id } }, { arrayFilters: [{ g: source._id }] }),
    GuestRequest.updateMany({ property: propertyId, guest: source._id }, { $set: { guest: target._id } }),
    GuestMessage.updateMany({ property: propertyId, guest: source._id }, { $set: { guest: target._id } }),
    PrivacyRequest.updateMany({ property: propertyId, guest: source._id }, { $set: { guest: target._id } }),
    LostItem.updateMany({ property: propertyId, claimant: source._id }, { $set: { claimant: target._id } }),
    GuestRegistrationCard.updateMany({ guest: source._id }, { $set: { guest: target._id } }).catch(() => null),
  ]);
  source.mergedInto = target._id;
  source.mergedAt = new Date();
  await source.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'guest.merged', entityType: 'GuestProfile', entityId: target._id, reason: why, before, after: { mergedFrom: String(source._id), choices }, ip });
  return { id: String(target._id), mergedFrom: String(source._id) };
}
