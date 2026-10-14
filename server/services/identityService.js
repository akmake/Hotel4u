// Identity (spec SYS-02 password recovery, SYS-04 profile & sessions, ADM-06 users, roles and
// access).
//
// Rules enforced here (server-side):
//  - a manager can grant or change only roles below their own, and cannot edit someone above them;
//  - no password is created by an admin: a new user gets a one-time setup link (72 h);
//  - deactivation revokes every session at once (tokenVersion) and returns the person's open work;
//  - a password reset never reveals whether an address exists, the link works once and expires,
//    and setting the password revokes all other sessions;
//  - responses never include password hashes, 2FA secrets or lockout counters.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User, { ROLES } from '../models/User.js';
import AuthToken from '../models/AuthToken.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { sendEmail } from './emailService.js';
import { signPmsToken } from '../controllers/authController.js';

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
function httpError(message, status = 400, extra = {}) { const e = new Error(message); e.status = status; Object.assign(e, extra); return e; }

// Authority ranks (spec 05). Equal ranks cannot manage each other; only super admin manages its peers.
export const ROLE_RANK = {
  super_admin: 100, chain_admin: 90, property_admin: 80, admin: 80, general_manager: 70,
  front_desk_manager: 50, finance_manager: 50, housekeeping_manager: 50, maintenance_manager: 50, revenue_manager: 50, sales_manager: 50, shift_manager: 50,
  auditor: 40, receptionist: 30, cashier: 30, housekeeper: 30, technician: 30, sales: 30, maintenance: 30, owner_readonly: 20,
};
const rank = (role) => ROLE_RANK[role] ?? 0;
export const ADMIN_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
export function canGrant(actorRole, targetRole) {
  if (actorRole === 'super_admin') return true;
  return rank(targetRole) < rank(actorRole);
}

const SETUP_TTL_H = 72;
const RESET_TTL_H = 1;

export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'לפחות 8 תווים';
  if (s.length > 128) return 'עד 128 תווים';
  if (!/[A-Za-z֐-׿]/.test(s) || !/\d/.test(s)) return 'אותיות וספרות';
  return null;
}

function safeUser(u) {
  return {
    id: String(u._id), firstName: u.firstName || '', lastName: u.lastName || '', name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
    displayName: u.displayName || null, email: u.email, role: u.role, active: u.active !== false,
    accessUntil: u.accessUntil || null, lastLoginAt: u.lastLoginAt || null, twoFactorEnabled: !!u.twoFactorEnabled,
    language: u.language || 'he', createdAt: u.createdAt, deactivatedAt: u.deactivatedAt || null, deactivatedBy: u.deactivatedBy || null,
    locked: !!(u.lockUntil && new Date(u.lockUntil) > new Date()),
  };
}
const SAFE_FIELDS = 'firstName lastName displayName email role active accessUntil lastLoginAt twoFactorEnabled language createdAt deactivatedAt deactivatedBy lockUntil property tokenVersion';

async function newToken(userId, kind, hours, createdBy) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  // Older unused links of the same kind stop working when a new one is issued.
  await AuthToken.updateMany({ user: userId, kind, usedAt: null }, { $set: { usedAt: new Date() } });
  await AuthToken.create({ user: userId, kind, tokenHash, expiresAt: new Date(Date.now() + hours * 3600_000), createdBy });
  return raw;
}

async function loadInScope(propertyId, id) {
  if (!isId(String(id || ''))) throw httpError('מזהה משתמש לא תקין', 400);
  const u = await User.findById(id);
  if (!u || String(u.property || '') !== String(propertyId)) throw httpError('המשתמש לא נמצא בנכס', 404);
  return u;
}

// ── ADM-06 ──────────────────────────────────────────────────────────────────
export async function listUsers({ propertyId, q, status, actor }) {
  const filter = { property: propertyId };
  if (status === 'active') filter.active = { $ne: false };
  if (status === 'inactive') filter.active = false;
  if (q) {
    const rx = new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
  }
  const users = await User.find(filter).select(SAFE_FIELDS).sort({ active: -1, firstName: 1 }).lean();
  return {
    rows: users.map((u) => ({ ...safeUser(u), manageable: String(u._id) !== String(actor.id) && canGrant(actor.role, u.role) })),
    counts: { active: users.filter((u) => u.active !== false).length, inactive: users.filter((u) => u.active === false).length },
  };
}

export function grantableRoles(actorRole) {
  return ROLES.filter((r) => canGrant(actorRole, r)).map((r) => ({ role: r, rank: rank(r) }));
}

export async function createUser({ propertyId, input, actor, ip }) {
  if (!ADMIN_ROLES.includes(actor.role)) throw httpError('הוספת משתמשים מותרת למנהל נכס', 403);
  const fields = {};
  const firstName = String(input.firstName || '').trim().slice(0, 60);
  const lastName = String(input.lastName || '').trim().slice(0, 60);
  const email = String(input.email || '').trim().toLowerCase().slice(0, 120);
  if (!firstName) fields.firstName = 'שם פרטי נדרש';
  if (!lastName) fields.lastName = 'שם משפחה נדרש';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'כתובת דוא״ל אישית נדרשת';
  if (!ROLES.includes(input.role)) fields.role = 'יש לבחור תפקיד';
  else if (!canGrant(actor.role, input.role)) fields.role = 'אינך רשאי להעניק תפקיד זה';
  const accessUntil = input.accessUntil ? new Date(input.accessUntil) : null;
  if (accessUntil && (Number.isNaN(accessUntil.getTime()) || accessUntil <= new Date())) fields.accessUntil = 'תאריך בעתיד';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי המשתמש', 422, { fields });
  if (await User.exists({ email })) throw httpError('כתובת הדוא״ל כבר בשימוש', 409, { fields: { email: 'בשימוש' } });
  // No password is chosen by the admin; the account is unusable until the person sets one.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
  const user = await User.create({ property: propertyId, firstName, lastName, email, passwordHash, role: input.role, active: true, accessUntil: accessUntil || null });
  const token = await newToken(user._id, 'setup', SETUP_TTL_H, actor.name);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'user.invited', entityType: 'User', entityId: user._id, after: { email, role: input.role, accessUntil }, ip });
  return { user: safeUser(user.toObject()), setupPath: `/reset-password?token=${token}&setup=1`, expiresInHours: SETUP_TTL_H };
}

export async function updateUser({ propertyId, id, input, actor, ip }) {
  const u = await loadInScope(propertyId, id);
  const self = String(u._id) === String(actor.id);
  const before = safeUser(u.toObject());
  if (!self) {
    if (!ADMIN_ROLES.includes(actor.role)) throw httpError('עריכת משתמשים אחרים מותרת למנהל נכס', 403);
    if (!canGrant(actor.role, u.role)) throw httpError('אינך רשאי לערוך משתמש בדרג שווה או גבוה משלך', 403);
  }
  const fields = {};
  if (input.firstName !== undefined) { const v = String(input.firstName).trim().slice(0, 60); if (!v) fields.firstName = 'נדרש'; else u.firstName = v; }
  if (input.lastName !== undefined) { const v = String(input.lastName).trim().slice(0, 60); if (!v) fields.lastName = 'נדרש'; else u.lastName = v; }
  if (input.role !== undefined && input.role !== u.role) {
    if (self) fields.role = 'לא ניתן לשנות את התפקיד של עצמך';
    else if (!ROLES.includes(input.role) || !canGrant(actor.role, input.role)) fields.role = 'אינך רשאי להעניק תפקיד זה';
    else u.role = input.role;
  }
  if (input.email !== undefined && String(input.email).trim().toLowerCase() !== u.email) {
    if (self) fields.email = 'שינוי דוא״ל — דרך מנהל';
    else {
      const email = String(input.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'כתובת לא תקינה';
      else if (await User.exists({ email, _id: { $ne: u._id } })) fields.email = 'בשימוש';
      else { u.email = email; u.tokenVersion = Number(u.tokenVersion || 0) + 1; }
    }
  }
  if (input.accessUntil !== undefined && !self) {
    if (input.accessUntil === null || input.accessUntil === '') u.accessUntil = null;
    else {
      const d = new Date(input.accessUntil);
      if (Number.isNaN(d.getTime())) fields.accessUntil = 'תאריך לא תקין';
      else u.accessUntil = d;
    }
  }
  if (Object.keys(fields).length) throw httpError('יש לתקן את השינוי', 422, { fields });
  const roleChanged = before.role !== u.role;
  if (roleChanged) u.tokenVersion = Number(u.tokenVersion || 0) + 1; // new permissions → new session
  await u.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: roleChanged ? 'user.role_changed' : 'user.updated', entityType: 'User', entityId: u._id, before: { role: before.role, email: before.email, accessUntil: before.accessUntil }, after: { role: u.role, email: u.email, accessUntil: u.accessUntil }, ip });
  return safeUser(u.toObject());
}

export async function deactivateUser({ propertyId, id, reason, actor, ip }) {
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw httpError('השבתה מחייבת סיבה', 422, { fields: { reason: 'נדרש' } });
  if (!ADMIN_ROLES.includes(actor.role)) throw httpError('השבתת משתמשים מותרת למנהל נכס', 403);
  const u = await loadInScope(propertyId, id);
  if (String(u._id) === String(actor.id)) throw httpError('לא ניתן להשבית את עצמך', 422);
  if (!canGrant(actor.role, u.role)) throw httpError('אינך רשאי להשבית משתמש בדרג שווה או גבוה משלך', 403);
  if (u.active === false) throw httpError('המשתמש כבר מושבת', 409);
  u.active = false;
  u.tokenVersion = Number(u.tokenVersion || 0) + 1; // every open session ends now
  u.deactivatedAt = new Date();
  u.deactivatedBy = actor.name;
  await u.save();
  await AuthToken.updateMany({ user: u._id, usedAt: null }, { $set: { usedAt: new Date() } });
  // Open work goes back to the pool instead of waiting on someone who left.
  const hk = await HousekeepingTask.updateMany({ property: propertyId, assignedTo: u._id, status: { $in: ['new', 'assigned', 'paused', 'failed_inspection'] } }, { $set: { status: 'new' }, $unset: { assignedTo: 1, assignedAt: 1 } });
  const mt = await MaintenanceTicket.updateMany({ property: propertyId, assignedTo: u._id, status: { $in: ['new', 'assigned', 'reopened', 'in_progress', 'waiting_parts', 'waiting_vendor'] } }, { $unset: { assignedTo: 1 } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'user.deactivated', entityType: 'User', entityId: u._id, reason: why, after: { tasksReturned: hk.modifiedCount, ticketsReturned: mt.modifiedCount }, ip });
  return { id: String(u._id), active: false, tasksReturned: hk.modifiedCount, ticketsReturned: mt.modifiedCount };
}

export async function reactivateUser({ propertyId, id, actor, ip }) {
  if (!ADMIN_ROLES.includes(actor.role)) throw httpError('הפעלת משתמשים מותרת למנהל נכס', 403);
  const u = await loadInScope(propertyId, id);
  if (!canGrant(actor.role, u.role)) throw httpError('אינך רשאי להפעיל משתמש בדרג שווה או גבוה משלך', 403);
  if (u.active !== false) throw httpError('המשתמש פעיל', 409);
  u.active = true;
  u.deactivatedAt = undefined;
  u.deactivatedBy = undefined;
  await u.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'user.reactivated', entityType: 'User', entityId: u._id, ip });
  return safeUser(u.toObject());
}

// A new setup/reset link an admin hands over in person (no email delivery is assumed).
export async function issueSetupLink({ propertyId, id, actor, ip }) {
  if (!ADMIN_ROLES.includes(actor.role)) throw httpError('הנפקת קישור מותרת למנהל נכס', 403);
  const u = await loadInScope(propertyId, id);
  if (String(u._id) !== String(actor.id) && !canGrant(actor.role, u.role)) throw httpError('אינך רשאי לנהל משתמש בדרג שווה או גבוה משלך', 403);
  if (u.active === false) throw httpError('המשתמש מושבת — יש להפעיל אותו קודם', 409);
  const token = await newToken(u._id, 'setup', SETUP_TTL_H, actor.name);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'user.setup_link_issued', entityType: 'User', entityId: u._id, ip });
  return { setupPath: `/reset-password?token=${token}&setup=1`, expiresInHours: SETUP_TTL_H };
}

// ── SYS-02 ──────────────────────────────────────────────────────────────────
const UNIFORM = 'אם הכתובת רשומה במערכת, נשלח אליה קישור לאיפוס הסיסמה. הקישור תקף לשעה.';

export async function requestPasswordReset({ email, origin, ip }) {
  const address = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw httpError('כתובת דוא״ל לא תקינה', 422, { fields: { email: 'כתובת לא תקינה' } });
  const user = await User.findOne({ email: address, active: { $ne: false } }).select('firstName property accessUntil').lean();
  if (user && !(user.accessUntil && new Date(user.accessUntil) < new Date())) {
    const token = await newToken(user._id, 'reset', RESET_TTL_H, 'self');
    const link = `${String(origin || '').replace(/\/+$/, '')}/reset-password?token=${token}`;
    // Delivery is best-effort: an unconfigured mail server must not change the answer.
    await sendEmail({ to: address, subject: 'איפוס סיסמה — Hotel4U', html: `<div dir="rtl">שלום ${user.firstName || ''},<br>לאיפוס הסיסמה: <a href="${link}">${link}</a><br>הקישור תקף לשעה ולשימוש אחד. אם לא ביקשת — אפשר להתעלם.</div>` }).catch(() => null);
    await audit({ property: user.property, actor: String(user._id), actorName: 'self', action: 'auth.reset_requested', entityType: 'User', entityId: user._id, ip });
  }
  return { message: UNIFORM };
}

export async function resetPassword({ token, password, ip }) {
  const problem = passwordProblem(password);
  if (problem) throw httpError(`הסיסמה אינה עומדת במדיניות: ${problem}`, 422, { fields: { password: problem } });
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const rec = await AuthToken.findOne({ tokenHash });
  if (!rec || rec.usedAt) throw httpError('הקישור כבר נוצל או אינו תקף — בקשו קישור חדש', 410, { code: 'used' });
  if (rec.expiresAt < new Date()) throw httpError('תוקף הקישור פג — בקשו קישור חדש', 410, { code: 'expired' });
  const used = await AuthToken.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
  if (!used) throw httpError('הקישור כבר נוצל', 410, { code: 'used' });
  const user = await User.findById(rec.user);
  if (!user || user.active === false) throw httpError('המשתמש אינו פעיל', 403);
  user.passwordHash = await bcrypt.hash(String(password), 12);
  user.tokenVersion = Number(user.tokenVersion || 0) + 1;
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  await user.save();
  await audit({ property: user.property, actor: String(user._id), actorName: `${user.firstName} ${user.lastName}`, action: rec.kind === 'setup' ? 'auth.password_set' : 'auth.password_reset', entityType: 'User', entityId: user._id, ip });
  return { ok: true, email: user.email };
}

// ── SYS-04 ──────────────────────────────────────────────────────────────────
export async function getMe({ actor }) {
  const u = await User.findById(actor.id).select(SAFE_FIELDS).lean();
  if (!u) throw httpError('המשתמש לא נמצא', 404);
  const property = u.property ? await Property.findById(u.property).select('name timezone').lean() : null;
  const recent = await (await import('../models/AuditLog.js')).default.find({ actor: u._id, action: { $in: ['LOGIN', 'auth.login', 'auth.logout_all', 'auth.password_changed', 'auth.password_reset', 'auth.password_set'] } })
    .sort({ createdAt: -1 }).limit(10).select('action createdAt ipAddress ip userAgent').lean();
  return {
    ...safeUser(u),
    property: property ? { id: String(property._id), name: property.name, timezone: property.timezone } : null,
    // Sessions are stateless tokens: the list shows recent sign-ins; "log out everywhere" ends all.
    recentAccess: recent.map((a) => ({ action: a.action, at: a.createdAt, ip: a.ipAddress || a.ip || null, device: a.userAgent ? String(a.userAgent).slice(0, 80) : null })),
  };
}

export async function updateMe({ actor, input, ip }) {
  const u = await User.findById(actor.id);
  if (!u) throw httpError('המשתמש לא נמצא', 404);
  const fields = {};
  if (input.displayName !== undefined) { const v = String(input.displayName || '').trim(); if (v.length > 100) fields.displayName = 'עד 100 תווים'; else u.displayName = v || undefined; }
  if (input.language !== undefined) { if (!['he', 'en'].includes(input.language)) fields.language = 'he או en'; else u.language = input.language; }
  if (input.firstName !== undefined) { const v = String(input.firstName).trim().slice(0, 60); if (!v) fields.firstName = 'נדרש'; else u.firstName = v; }
  if (input.lastName !== undefined) { const v = String(input.lastName).trim().slice(0, 60); if (!v) fields.lastName = 'נדרש'; else u.lastName = v; }
  if (Object.keys(fields).length) throw httpError('יש לתקן את הפרטים', 422, { fields });
  await u.save();
  await audit({ property: u.property, actor: actor.id, actorName: actor.name, action: 'user.profile_updated', entityType: 'User', entityId: u._id, ip });
  return safeUser(u.toObject());
}

export async function changeMyPassword({ actor, current, next, ip }) {
  const u = await User.findById(actor.id);
  if (!u) throw httpError('המשתמש לא נמצא', 404);
  if (!(await bcrypt.compare(String(current || ''), u.passwordHash))) throw httpError('הסיסמה הנוכחית שגויה', 422, { fields: { current: 'שגויה' } });
  const problem = passwordProblem(next);
  if (problem) throw httpError(`הסיסמה אינה עומדת במדיניות: ${problem}`, 422, { fields: { next: problem } });
  u.passwordHash = await bcrypt.hash(String(next), 12);
  u.tokenVersion = Number(u.tokenVersion || 0) + 1; // other devices sign in again
  await u.save();
  await audit({ property: u.property, actor: actor.id, actorName: actor.name, action: 'auth.password_changed', entityType: 'User', entityId: u._id, ip });
  return { token: signPmsToken(u) };
}

export async function logoutEverywhere({ actor, ip }) {
  const u = await User.findByIdAndUpdate(actor.id, { $inc: { tokenVersion: 1 } }, { returnDocument: 'after' });
  if (!u) throw httpError('המשתמש לא נמצא', 404);
  await audit({ property: u.property, actor: actor.id, actorName: actor.name, action: 'auth.logout_all', entityType: 'User', entityId: u._id, ip });
  return { token: signPmsToken(u) };
}
