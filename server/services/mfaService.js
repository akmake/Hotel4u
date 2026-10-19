// SYS-01 two-factor sign-in (TOTP). Setup → the user scans / types the key in an authenticator app and
// confirms with a code; then every login asks for a code after the password. Secrets are sealed at rest
// (utils/secretBox), a code cannot be used twice, and ten one-time recovery codes are shown once.
// An administrator can reset a user's two-factor (lost phone); that also logs the user out everywhere.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { seal, open } from '../utils/secretBox.js';
import { newTotpSecret, verifyTotp, otpauthUrl } from '../utils/totp.js';
import { pmsJwtSecret } from '../utils/jwtSecret.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';

const hash = (c) => crypto.createHash('sha256').update(String(c).replace(/[\s-]/g, '').toUpperCase()).digest('hex');
const ADMIN_RESET_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];

export async function mfaStatus({ actor }) {
  const u = await User.findById(actor.id).select('twoFactorEnabled mfaRecovery').lean();
  return { enabled: !!u?.twoFactorEnabled, recoveryLeft: (u?.mfaRecovery || []).length };
}

export async function startSetup({ actor }) {
  const u = await User.findById(actor.id).select('email twoFactorEnabled');
  if (!u) throw httpError('המשתמש לא נמצא', 404);
  if (u.twoFactorEnabled) throw httpError('אימות דו־שלבי כבר פעיל', 409);
  const secret = newTotpSecret();
  await User.updateOne({ _id: u._id }, { $set: { totpPending: seal(secret) } });
  return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauth: otpauthUrl({ secret, account: u.email }) };
}

export async function enable({ actor, code, ip }) {
  const u = await User.findById(actor.id).select('totpPending twoFactorEnabled property');
  if (!u) throw httpError('המשתמש לא נמצא', 404);
  const secret = open(u.totpPending);
  if (!secret) throw httpError('יש להתחיל הגדרה מחדש', 409);
  const step = verifyTotp(secret, code);
  if (step === null) throw httpError('הקוד שגוי — בדקו שהשעה בטלפון מעודכנת', 422, { fields: { code: 'קוד' } });
  const recovery = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'));
  await User.updateOne({ _id: u._id }, { $set: { twoFactorEnabled: true, totpSecret: seal(secret), totpLastStep: step, mfaRecovery: recovery.map(hash) }, $unset: { totpPending: 1 } });
  await audit({ property: u.property, actor: actor.id, actorName: actor.name, action: 'user.mfa_enabled', entityType: 'User', entityId: u._id, ip }).catch(() => null);
  return { enabled: true, recoveryCodes: recovery };
}

export async function disable({ actor, password, code, ip }) {
  const u = await User.findById(actor.id).select('passwordHash totpSecret totpLastStep twoFactorEnabled property');
  if (!u?.twoFactorEnabled) throw httpError('אימות דו־שלבי אינו פעיל', 409);
  if (!password || !(await bcrypt.compare(String(password), u.passwordHash))) throw httpError('סיסמה שגויה', 422, { fields: { password: 'סיסמה' } });
  const step = verifyTotp(open(u.totpSecret), code);
  if (step === null || step <= (u.totpLastStep || 0)) throw httpError('קוד שגוי', 422, { fields: { code: 'קוד' } });
  await User.updateOne({ _id: u._id }, { $set: { twoFactorEnabled: false, totpSecret: '', mfaRecovery: [] }, $unset: { totpLastStep: 1 } });
  await audit({ property: u.property, actor: actor.id, actorName: actor.name, action: 'user.mfa_disabled', entityType: 'User', entityId: u._id, ip }).catch(() => null);
  return { enabled: false };
}

export async function adminReset({ propertyId, userId, actor, ip }) {
  if (!ADMIN_RESET_ROLES.includes(actor.role)) throw httpError('איפוס אימות דו־שלבי מותר להנהלה', 403);
  const u = await User.findOne({ _id: userId, ...(actor.role === 'super_admin' ? {} : { property: propertyId }) }).select('property twoFactorEnabled');
  if (!u) throw httpError('המשתמש לא נמצא', 404);
  if (String(u._id) === String(actor.id)) throw httpError('את האימות שלך מבטלים במסך הפרופיל', 409);
  await User.updateOne({ _id: u._id }, { $set: { twoFactorEnabled: false, totpSecret: '', mfaRecovery: [] }, $unset: { totpLastStep: 1, totpPending: 1 }, $inc: { tokenVersion: 1 } });
  await audit({ property: u.property, actor: actor.id, actorName: actor.name, action: 'user.mfa_reset', entityType: 'User', entityId: u._id, ip }).catch(() => null);
  return { reset: true };
}

// Login step 2. The short ticket proves the password step passed for this user and this token version.
export const mfaTicket = (user) => jwt.sign({ id: String(user._id), mfa: true, tv: Number(user.tokenVersion || 0) }, pmsJwtSecret(), { expiresIn: '5m' });

export async function verifyLoginCode({ ticket, code }) {
  let claim;
  try { claim = jwt.verify(String(ticket || ''), pmsJwtSecret()); } catch { throw httpError('פג תוקף שלב האימות — התחברו מחדש', 401); }
  if (!claim?.mfa) throw httpError('בקשה לא תקינה', 401);
  const user = await User.findById(claim.id);
  if (!user || user.active === false || Number(user.tokenVersion || 0) !== Number(claim.tv || 0) || !user.twoFactorEnabled) throw httpError('התחברו מחדש', 401);
  if (user.isLocked) throw httpError('החשבון נעול זמנית אחרי ניסיונות כושלים', 423);
  const raw = String(code || '').trim();
  const step = verifyTotp(open(user.totpSecret), raw);
  if (step !== null && step > (user.totpLastStep || 0)) {
    await User.updateOne({ _id: user._id }, { $set: { totpLastStep: step } });
    return user;
  }
  const h = hash(raw);
  if (raw.length >= 10 && (user.mfaRecovery || []).includes(h)) {
    await User.updateOne({ _id: user._id }, { $pull: { mfaRecovery: h } });
    return user;
  }
  await user.incrementLoginAttempts();
  throw httpError('קוד שגוי', 401);
}
