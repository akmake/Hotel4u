// Profiles (gap-map item 16): files, relations, restriction rule, stays from a previous system, revenue by
// department, change log, turned-away requests, note types, company account manager and negotiated rates,
// group profile, source and contact profiles on a booking.
import mongoose from 'mongoose';
import GuestProfile, { GuestAttachment } from '../models/GuestProfile.js';
import Company from '../models/Company.js';
import Reservation from '../models/Reservation.js';
import Folio from '../models/Folio.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import TurnAway from '../models/TurnAway.js';
import { RatePlan } from '../models/RatePlan.js';
import { audit } from './auditService.js';
import { httpError, MANAGER_ROLES } from './frontDeskService.js';

export const PROFILE_ROLES = [...new Set([...MANAGER_ROLES, 'receptionist', 'sales_manager', 'revenue_manager', 'finance_manager', 'cashier'])];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const MAX_FILE = 2 * 1024 * 1024;
const MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'];
const mustWork = (actor) => { if (!PROFILE_ROLES.includes(actor?.role)) throw httpError('אין הרשאה לפרופילים', 403); };
const log = (propertyId, actor, ip, action, entityType, entityId, before, after, reason) => audit({ property: propertyId, actor: actor?.id, actorName: actor?.name, action, entityType, entityId, before, after, reason, ip });

async function loadGuest(propertyId, id) {
  const g = isId(id) ? await GuestProfile.findOne({ _id: id, property: propertyId }) : null;
  if (!g) throw httpError('האורח לא נמצא', 404);
  if (g.isAnonymized) throw httpError('הפרופיל עבר אנונימיזציה', 409);
  return g;
}

// ── Files ───────────────────────────────────────────────────────────────────

export async function listFiles({ propertyId, guestId }) {
  const rows = await GuestAttachment.find({ property: propertyId, guest: guestId, removed: { $ne: true } }).select('name mime size byName createdAt').sort({ createdAt: -1 }).lean();
  return rows.map((f) => ({ id: String(f._id), name: f.name, mime: f.mime, size: f.size, by: f.byName, at: f.createdAt }));
}

export async function addFile({ propertyId, guestId, body, actor, ip }) {
  mustWork(actor);
  const g = await loadGuest(propertyId, guestId);
  const name = String(body?.name || '').trim().slice(0, 120);
  const mime = String(body?.mime || '');
  const data = Buffer.from(String(body?.data || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!name) throw httpError('שם קובץ', 422, { fields: { name: 'שם' } });
  if (!MIMES.includes(mime)) throw httpError('סוג קובץ: PDF, תמונה או טקסט', 422, { fields: { file: 'סוג לא נתמך' } });
  if (!data.length || data.length > MAX_FILE) throw httpError('קובץ עד 2MB', 422, { fields: { file: 'גודל' } });
  const f = await GuestAttachment.create({ property: propertyId, guest: g._id, name, mime, size: data.length, data, byName: actor.name });
  await log(propertyId, actor, ip, 'guest.file_added', 'GuestProfile', g._id, null, { name, size: data.length });
  return { id: String(f._id), name, size: data.length };
}

export async function getFile({ propertyId, fileId }) {
  const f = isId(fileId) ? await GuestAttachment.findOne({ _id: fileId, property: propertyId, removed: { $ne: true } }).lean() : null;
  if (!f) throw httpError('הקובץ לא נמצא', 404);
  return f;
}

export async function removeFile({ propertyId, fileId, actor, ip }) {
  mustWork(actor);
  const f = isId(fileId) ? await GuestAttachment.findOne({ _id: fileId, property: propertyId, removed: { $ne: true } }) : null;
  if (!f) throw httpError('הקובץ לא נמצא', 404);
  f.removed = true; await f.save();
  await log(propertyId, actor, ip, 'guest.file_removed', 'GuestProfile', f.guest, { name: f.name }, null);
  return { removed: true };
}

// ── Relations, restriction, contact flag, past stays ──────────────────────

export async function saveRelations({ propertyId, guestId, relations, actor, ip }) {
  mustWork(actor);
  const g = await loadGuest(propertyId, guestId);
  const out = [];
  for (const r of (Array.isArray(relations) ? relations : []).slice(0, 20)) {
    const kind = ['company', 'family', 'assistant', 'colleague', 'other'].includes(r.kind) ? r.kind : null;
    if (!kind) throw httpError('סוג קשר לא מוכר', 422, { fields: { relations: 'סוג' } });
    if (kind === 'company') {
      if (!isId(r.company) || !(await Company.exists({ _id: r.company, property: propertyId }))) throw httpError('החברה לא נמצאה', 422, { fields: { relations: 'חברה' } });
      out.push({ kind, company: r.company, note: String(r.note || '').slice(0, 120) || undefined });
    } else {
      if (!isId(r.guest) || String(r.guest) === String(g._id) || !(await GuestProfile.exists({ _id: r.guest, property: propertyId }))) throw httpError('האורח המקושר לא נמצא', 422, { fields: { relations: 'אורח' } });
      out.push({ kind, guest: r.guest, note: String(r.note || '').slice(0, 120) || undefined });
    }
  }
  const before = (g.relations || []).length;
  g.relations = out; await g.save();
  await log(propertyId, actor, ip, 'guest.relations', 'GuestProfile', g._id, { count: before }, { count: out.length });
  return profileExtras({ propertyId, guestId });
}

export async function setRestriction({ propertyId, guestId, body, actor, ip }) {
  if (!MANAGER_ROLES.includes(actor?.role)) throw httpError('הגבלת לקוח — למנהל', 403);
  const g = await loadGuest(propertyId, guestId);
  const rule = body?.rule || null;
  if (rule && !['alert', 'manager_approval', 'prepay_only'].includes(rule)) throw httpError('כלל לא מוכר', 422, { fields: { rule: 'כלל' } });
  const note = String(body?.note || '').trim().slice(0, 200);
  if (rule && note.length < 3) throw httpError('הגבלה מחייבת הסבר', 422, { fields: { note: 'הסבר' } });
  const before = g.restriction?.rule || null;
  g.restriction = rule ? { rule, note, byName: actor.name, at: new Date() } : undefined;
  await g.save();
  await log(propertyId, actor, ip, 'guest.restriction', 'GuestProfile', g._id, { rule: before }, { rule }, note || undefined);
  return { restriction: g.restriction || null };
}

export async function addPastStay({ propertyId, guestId, body, actor, ip }) {
  if (!MANAGER_ROLES.includes(actor?.role) && actor?.role !== 'finance_manager') throw httpError('הזנת שהייה היסטורית — למנהל', 403);
  const g = await loadGuest(propertyId, guestId);
  const b = body || {};
  const fields = {};
  if (!YMD.test(b.arrival || '') || !YMD.test(b.departure || '') || b.departure <= b.arrival) fields.arrival = 'תאריכים תקינים';
  const amount = round2(b.amount || 0);
  if (!(amount >= 0)) fields.amount = 'סכום';
  if (Object.keys(fields).length) throw httpError('יש לתקן את השהייה', 422, { fields });
  const nights = Math.round((Date.parse(`${b.departure}T00:00:00Z`) - Date.parse(`${b.arrival}T00:00:00Z`)) / 86400000);
  g.pastStays.push({ arrival: b.arrival, departure: b.departure, nights, roomType: String(b.roomType || '').slice(0, 60), amount, source: String(b.source || 'מערכת קודמת').slice(0, 60), note: String(b.note || '').slice(0, 200), byName: actor.name, at: new Date() });
  g.totalStays = (g.totalStays || 0) + 1;
  g.totalRevenue = round2((g.totalRevenue || 0) + amount);
  if (!g.lastStay || new Date(b.departure) > new Date(g.lastStay)) g.lastStay = new Date(`${b.departure}T00:00:00Z`);
  await g.save();
  await log(propertyId, actor, ip, 'guest.past_stay', 'GuestProfile', g._id, null, { arrival: b.arrival, departure: b.departure, amount });
  return { pastStays: g.pastStays.length, totalStays: g.totalStays };
}

// Everything item 16 adds to a guest profile, in one call for the profile screen.
export async function profileExtras({ propertyId, guestId }) {
  const g = await GuestProfile.findOne({ _id: guestId, property: propertyId }).populate('relations.guest', 'firstName lastName').populate('relations.company', 'name').lean();
  if (!g) throw httpError('האורח לא נמצא', 404);
  const resIds = (await Reservation.find({ property: propertyId, primaryGuest: g._id, status: { $nin: ['deleted'] } }).select('_id').lean()).map((r) => r._id);
  const folios = await Folio.find({ reservation: { $in: resIds } }).select('lines.status lines.type lines.department lines.amount lines.taxAmount').lean();
  const byDept = new Map();
  for (const l of folios.flatMap((f) => f.lines || [])) {
    if (l.status !== 'posted' || ['payment', 'deposit', 'refund'].includes(l.type)) continue;
    const k = l.department || 'other';
    byDept.set(k, round2((byDept.get(k) || 0) + Number(l.amount || 0) + Number(l.taxAmount || 0)));
  }
  const history = await AuditLog.find({ property: propertyId, entityId: g._id }).sort({ createdAt: -1 }).limit(40).select('action actorName createdAt reason').lean();
  const turnaways = await TurnAway.find({ property: propertyId, guest: g._id }).sort({ createdAt: -1 }).limit(20).lean();
  return {
    relations: (g.relations || []).map((r) => ({ id: String(r._id), kind: r.kind, note: r.note || '', guest: r.guest ? { id: String(r.guest._id), name: `${r.guest.firstName} ${r.guest.lastName}` } : null, company: r.company ? { id: String(r.company._id), name: r.company.name } : null })),
    restriction: g.restriction || null, isContact: !!g.isContact,
    pastStays: (g.pastStays || []).map((s) => ({ id: String(s._id), arrival: s.arrival, departure: s.departure, nights: s.nights, roomType: s.roomType, amount: s.amount, source: s.source, note: s.note })),
    revenueByDepartment: [...byDept.entries()].map(([department, amount]) => ({ department, amount })).sort((a, b) => b.amount - a.amount),
    history: history.map((h) => ({ action: h.action, by: h.actorName, at: h.createdAt, reason: h.reason || null })),
    turnaways: turnaways.map((t) => ({ date: t.date, nights: t.nights, reason: t.reason, at: t.createdAt })),
    files: await listFiles({ propertyId, guestId: g._id }),
  };
}

// The rule of a restricted guest at booking: alert (passes), manager approval, or prepayment only.
export function restrictionGate(guest, { actor, input }) {
  const r = guest?.restriction;
  if (!r?.rule) return null;
  if (r.rule === 'manager_approval' && !MANAGER_ROLES.includes(actor?.role)) throw httpError(`לקוח מוגבל: ${r.note} — הזמנה באישור מנהל`, 409, { code: 'guest_restricted' });
  if (r.rule === 'prepay_only' && !['deposit'].includes(input?.guarantee) && input?.payment !== 'prepaid') throw httpError(`לקוח מוגבל: ${r.note} — רק בתשלום מראש (ערבות "מקדמה")`, 409, { code: 'guest_prepay_only' });
  return r;
}

// ── Companies: account manager, negotiated rates, group profile ──────────

export async function companyExtras({ propertyId, companyId }) {
  const c = isId(companyId) ? await Company.findOne({ _id: companyId, property: propertyId }).populate('accountManager', 'firstName lastName').lean() : null;
  if (!c) throw httpError('החברה לא נמצאה', 404);
  const plans = await RatePlan.find({ property: propertyId, $or: [{ 'pricingRules.companies': c._id }, { 'pricingRules.agents': c._id }] }).select('code name pricingRules').lean();
  const rates = plans.flatMap((p) => (p.pricingRules || []).filter((r) => (r.companies || []).some((x) => String(x) === String(c._id)) || (r.agents || []).some((x) => String(x) === String(c._id)))
    .map((r) => ({ plan: p.code, planName: p.name, rule: r.name, adjustment: r.adjustmentType === 'set' ? `מחיר ${r.adjustmentValue}` : r.adjustmentType === 'percent' ? `${r.adjustmentValue}%` : `${r.adjustmentValue} ₪`, from: r.seasonFrom || null, to: r.seasonTo || null, active: r.active !== false })));
  const contacts = await GuestProfile.find({ property: propertyId, 'relations.company': c._id }).select('firstName lastName phone email isContact').lean();
  return {
    accountManager: c.accountManager ? { id: String(c.accountManager._id), name: `${c.accountManager.firstName} ${c.accountManager.lastName}` } : null,
    negotiatedRates: rates,
    contacts: contacts.map((g) => ({ id: String(g._id), name: `${g.firstName} ${g.lastName}`, phone: g.phone || null, email: g.email || null, isContact: !!g.isContact })),
  };
}

export async function setAccountManager({ propertyId, companyId, userId, actor, ip }) {
  if (![...MANAGER_ROLES, 'sales_manager'].includes(actor?.role)) throw httpError('אחראי מכירות — למנהל או למכירות', 403);
  const c = isId(companyId) ? await Company.findOne({ _id: companyId, property: propertyId }) : null;
  if (!c) throw httpError('החברה לא נמצאה', 404);
  if (userId && !(isId(userId) && await User.exists({ _id: userId, property: propertyId, active: { $ne: false } }))) throw httpError('המשתמש לא נמצא בנכס', 422, { fields: { accountManager: 'משתמש' } });
  const before = c.accountManager ? String(c.accountManager) : null;
  c.accountManager = userId || undefined; await c.save();
  await log(propertyId, actor, ip, 'company.account_manager', 'Company', c._id, { accountManager: before }, { accountManager: userId || null });
  return companyExtras({ propertyId, companyId });
}

// A group block without a company gets a group profile of its own (company of type 'group').
export async function ensureGroupProfile({ propertyId, blockName, session = null }) {
  const name = String(blockName || 'קבוצה').trim().slice(0, 120);
  const [c] = await Company.create([{ property: propertyId, name, type: 'group' }], { session });
  return c._id;
}

export async function setBookingProfiles({ propertyId, reservationId, body, actor, ip }) {
  mustWork(actor);
  const r = isId(reservationId) ? await Reservation.findOne({ _id: reservationId, property: propertyId }) : null;
  if (!r) throw httpError('ההזמנה לא נמצאה', 404);
  if (body?.sourceProfile !== undefined) {
    if (!body.sourceProfile) r.sourceProfile = undefined;
    else {
      const c = isId(body.sourceProfile) ? await Company.findOne({ _id: body.sourceProfile, property: propertyId, type: 'source' }).lean() : null;
      if (!c) throw httpError('פרופיל מקור לא נמצא (חברה מסוג "מקור")', 422, { fields: { sourceProfile: 'לא נמצא' } });
      r.sourceProfile = c._id;
    }
  }
  if (body?.contactProfile !== undefined) {
    if (!body.contactProfile) r.contactProfile = undefined;
    else {
      const g = isId(body.contactProfile) ? await GuestProfile.findOne({ _id: body.contactProfile, property: propertyId }) : null;
      if (!g) throw httpError('איש הקשר לא נמצא', 422, { fields: { contactProfile: 'לא נמצא' } });
      if (!g.isContact) { g.isContact = true; await g.save(); }
      r.contactProfile = g._id;
    }
  }
  await r.save();
  await log(propertyId, actor, ip, 'reservation.profiles', 'Reservation', r._id, null, { sourceProfile: r.sourceProfile ? String(r.sourceProfile) : null, contactProfile: r.contactProfile ? String(r.contactProfile) : null });
  return { sourceProfile: r.sourceProfile ? String(r.sourceProfile) : null, contactProfile: r.contactProfile ? String(r.contactProfile) : null };
}
