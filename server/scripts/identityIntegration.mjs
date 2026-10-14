#!/usr/bin/env node
/* eslint-disable no-console */
// Identity & audit integration suite (SYS-01 sign-in gate, SYS-02 recovery, SYS-04 sessions,
// ADM-06 users/roles/access, ADM-07 audit log). Runs against a live server and the same DB, on a
// throw-away property; everything created is removed at the end.
//
//   node scripts/identityIntegration.mjs [--baseUrl=http://localhost:4000]
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Property from '../models/Property.js';
import AuthToken from '../models/AuthToken.js';
import AuditLog from '../models/AuditLog.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import { signPmsToken } from '../controllers/authController.js';
import { audit } from '../services/auditService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const ROOT = (args.baseUrl || process.env.API_ROOT || 'http://localhost:4000').replace(/\/+$/, '');
const TAG = `IDN${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
async function call(method, url, t, body) {
  const res = await fetch(`${ROOT}${url}`, { method, headers: { Accept: 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, headers: res.headers, ...json };
}
const login = (email, password) => call('POST', '/api/auth/login', null, { email, password });

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem' });
  const P = String(p._id);
  const mail = (r) => `${TAG.toLowerCase()}-${r}@test.local`;
  try {
    const hash = await bcrypt.hash('Passw0rd!', 10);
    const mk = (role, extra = {}) => User.create({ property: P, firstName: 'בדיקה', lastName: role, email: mail(role), passwordHash: hash, role, active: true, ...extra });
    const uAdmin = await mk('property_admin', { totpSecret: 'SUPERSECRETTOTP' });
    const uGM = await mk('general_manager');
    const uRec = await mk('receptionist');
    const uHk = await mk('housekeeper');
    const uAud = await mk('auditor');
    const A = signPmsToken(uAdmin); const GM = signPmsToken(uGM); const RC = signPmsToken(uRec); const HK = signPmsToken(uHk); const AU = signPmsToken(uAud);
    const pms = (u) => `/api/pms${u}${u.includes('?') ? '&' : '?'}propertyId=${P}`;

    // ── ADM-06 reads never leak secrets ─────────────────────────────────────
    let r = await call('GET', pms('/identity/users'), A);
    check('ADM-06 user list for an admin', r.status === 200 && r.data.rows.length === 5, r.status);
    check('ADM-06 no 2FA secret or password hash in the response', !JSON.stringify(r).includes('SUPERSECRETTOTP') && !JSON.stringify(r).includes('passwordHash'));
    r = await call('GET', pms('/users'), RC);
    check('Legacy /users no longer leaks the 2FA secret', r.status === 200 && !JSON.stringify(r).includes('SUPERSECRETTOTP'), r.status);
    r = await call('GET', pms('/identity/users'), HK);
    check('RBAC: housekeeper cannot list users', r.status === 403, r.status);

    // ── Privilege rules ─────────────────────────────────────────────────────
    r = await call('PATCH', pms(`/users/${uAdmin._id}`), RC, { email: `hijack-${TAG.toLowerCase()}@test.local` });
    check('A receptionist cannot edit another user through the legacy route (was possible)', r.status === 403 && (await User.findById(uAdmin._id).lean()).email === mail('property_admin'), r.status);
    r = await call('PATCH', pms(`/users/${uAdmin._id}`), RC, { password: 'Hacked123' });
    check('Nobody sets another user\'s password directly', r.status === 422 || r.status === 403, r.status);
    r = await call('PATCH', pms(`/identity/users/${uAdmin._id}`), GM, { firstName: 'שונה' });
    check('A general manager cannot edit a property admin (higher rank)', r.status === 403, r.status);
    r = await call('POST', pms('/identity/users'), GM, { firstName: 'חדש', lastName: 'משתמש', email: mail('new1'), role: 'super_admin' });
    check('A manager cannot grant a role above their own', r.status === 422 && r.fields?.role, r.status);
    r = await call('GET', pms('/identity/roles'), GM);
    check('Grantable roles exclude equal and higher ranks', r.status === 200 && !r.data.some((x) => ['general_manager', 'property_admin', 'super_admin'].includes(x.role)) && r.data.some((x) => x.role === 'receptionist'));

    // ── Invite → one-time setup link (no admin-chosen password) ─────────────
    r = await call('POST', pms('/identity/users'), A, { firstName: 'נועה', lastName: 'חדשה', email: mail('invitee'), role: 'receptionist' });
    const inviteeId = r.data?.user?.id;
    const setupToken = new URLSearchParams((r.data?.setupPath || '').split('?')[1] || '').get('token');
    check('ADM-06 invite creates the user and a one-time setup link', r.status === 200 && !!setupToken && r.data.expiresInHours === 72, r.error);
    let lg = await login(mail('invitee'), 'whatever1');
    check('SYS-01 the invited account cannot sign in before setting a password', lg.status === 401, lg.status);
    r = await call('POST', '/api/auth/password/reset', null, { token: setupToken, password: 'short' });
    check('SYS-02 weak password refused by policy', r.status === 422, r.status);
    r = await call('POST', '/api/auth/password/reset', null, { token: setupToken, password: 'Welcome123' });
    check('SYS-02 setup link sets the password', r.status === 200, r.error);
    r = await call('POST', '/api/auth/password/reset', null, { token: setupToken, password: 'Another123' });
    check('SYS-02 the link works once', r.status === 410 && r.code === 'used', r.status);
    lg = await login(mail('invitee'), 'Welcome123');
    check('SYS-01 sign-in with the new password', lg.status === 200 && !!lg.data?.token, lg.status);

    // ── SYS-02 recovery does not reveal accounts ────────────────────────────
    const before = await AuthToken.countDocuments({ user: uRec._id, kind: 'reset' });
    const known = await call('POST', '/api/auth/password/request', null, { email: mail('receptionist') });
    const unknown = await call('POST', '/api/auth/password/request', null, { email: `nobody-${TAG.toLowerCase()}@test.local` });
    check('SYS-02 same answer for a known and an unknown address', known.status === 200 && unknown.status === 200 && known.data.message === unknown.data.message);
    check('SYS-02 a reset link was created only for the real account', (await AuthToken.countDocuments({ user: uRec._id, kind: 'reset' })) === before + 1);
    const raw = crypto.randomBytes(16).toString('hex');
    await AuthToken.create({ user: uRec._id, kind: 'reset', tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() - 1000) });
    r = await call('POST', '/api/auth/password/reset', null, { token: raw, password: 'Expired123' });
    check('SYS-02 an expired link is refused', r.status === 410 && r.code === 'expired', r.status);

    // ── Sessions: role change, logout everywhere, password change ───────────
    await User.updateOne({ _id: uGM._id }, { $set: { role: 'receptionist' } });
    r = await call('GET', pms('/identity/users'), GM);
    check('A role change applies on the next request (role read from the DB, not the token)', r.status === 403, r.status);
    await User.updateOne({ _id: uGM._id }, { $set: { role: 'general_manager' } });
    r = await call('POST', pms('/identity/me/logout-all'), RC);
    const RC2 = r.data?.token;
    const oldRc = await call('GET', pms('/identity/me'), RC);
    const newRc = await call('GET', pms('/identity/me'), RC2);
    check('SYS-04 "log out everywhere" ends old sessions; the current one gets a fresh token', r.status === 200 && oldRc.status === 401 && newRc.status === 200, `${oldRc.status}/${newRc.status}`);
    r = await call('POST', pms('/identity/me/password'), RC2, { current: 'wrong', next: 'NewPass123' });
    check('SYS-04 password change needs the current password', r.status === 422, r.status);
    r = await call('POST', pms('/identity/me/password'), RC2, { current: 'Passw0rd!', next: 'NewPass123' });
    const RC3 = r.data?.token;
    check('SYS-04 password change revokes other sessions', r.status === 200 && (await call('GET', pms('/identity/me'), RC2)).status === 401 && (await call('GET', pms('/identity/me'), RC3)).status === 200, r.status);
    r = await call('PATCH', pms('/identity/me'), RC3, { displayName: 'דנה מהקבלה', language: 'en' });
    check('SYS-04 personal preferences saved', r.status === 200 && r.data.displayName === 'דנה מהקבלה' && r.data.language === 'en', r.error);

    // ── Deactivation & access window ────────────────────────────────────────
    const rt = await RoomType.create({ property: P, code: `${TAG}S`, name: 'סטנדרט', baseRate: 400 });
    const room = await Room.create({ property: P, roomType: rt._id, number: `${TAG}1`, floor: 1 });
    await HousekeepingTask.create({ property: P, room: room._id, type: 'checkout_clean', date: '2099-01-01', status: 'assigned', assignedTo: uHk._id });
    r = await call('POST', pms(`/identity/users/${uHk._id}/deactivate`), A, {});
    check('ADM-06 deactivation requires a reason', r.status === 422, r.status);
    r = await call('POST', pms(`/identity/users/${uHk._id}/deactivate`), A, { reason: 'סיום העסקה' });
    check('ADM-06 deactivation returns open work to the pool', r.status === 200 && r.data.tasksReturned === 1 && !(await HousekeepingTask.findOne({ room: room._id }).lean()).assignedTo, JSON.stringify(r.data || r).slice(0, 120));
    r = await call('GET', pms('/ops/my-tasks'), HK);
    check('ADM-06 a deactivated user\'s open session stops working immediately', r.status === 401, r.status);
    lg = await login(mail('housekeeper'), 'Passw0rd!');
    check('SYS-01 a deactivated user cannot sign in (was possible)', lg.status === 403, lg.status);
    await User.updateOne({ _id: uAud._id }, { $set: { accessUntil: new Date(Date.now() - 60000) } });
    check('ADM-06 an expired access window blocks the session and sign-in', (await call('GET', pms('/audit-log'), AU)).status === 401 && (await login(mail('auditor'), 'Passw0rd!')).status === 403);
    await User.updateOne({ _id: uAud._id }, { $set: { accessUntil: null } });

    // ── ADM-07 audit log ────────────────────────────────────────────────────
    await audit({ property: P, actor: uAdmin._id, actorName: 'בדיקה', action: 'user.test_secret', entityType: 'User', entityId: uAdmin._id, before: { password: 'x1', totpSecret: 'abc', name: 'גלוי' }, after: { idNumber: '123456789', note: 'גלוי' } });
    await audit({ property: P, actorName: 'system', action: 'housekeeping.assigned', entityType: 'HousekeepingTask', entityId: null, after: { ok: 3 } });
    check('Audit entries without a single record are kept (were silently dropped)', !!(await AuditLog.findOne({ property: P, action: 'housekeeping.assigned' }).lean()));
    r = await call('GET', pms('/audit-log'), RC3);
    check('ADM-07 receptionist cannot read the audit log (was open to everyone)', r.status === 403, r.status);
    r = await call('GET', pms('/audit-log?group=permissions'), A);
    const evt = r.data?.rows?.find((x) => x.action === 'user.test_secret');
    check('ADM-07 manager sees filtered events (permissions group)', r.status === 200 && !!evt && r.data.rows.every((x) => /^(user|role)/i.test(x.action)), r.status);
    r = await call('GET', `/api/pms/audit-log/${evt?.id}`, A);
    check('ADM-07 before/after shown with secrets and ID numbers masked', r.status === 200 && r.data.before.password === '••••' && r.data.before.totpSecret === '••••' && r.data.after.idNumber === '••••' && r.data.before.name === 'גלוי', JSON.stringify(r.data || r).slice(0, 200));
    const exp = await fetch(`${ROOT}${pms('/audit-log/export')}`, { headers: { Authorization: `Bearer ${A}` } });
    const bytes = Buffer.from(await exp.arrayBuffer());
    const csv = bytes.toString('utf8');
    const bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF; // Excel needs it for Hebrew
    check('ADM-07 CSV export works and is itself recorded', exp.status === 200 && bom && csv.includes('פעולה') && !!(await AuditLog.findOne({ property: P, action: 'audit.exported' }).lean()), exp.status);
  } finally {
    const users = (await User.find({ property: P }).select('_id').lean()).map((u) => u._id);
    await AuthToken.deleteMany({ user: { $in: users } });
    await AuditLog.deleteMany({ $or: [{ property: P }, { actor: { $in: users } }, { entityId: { $in: users } }] });
    await HousekeepingTask.deleteMany({ property: P });
    await Room.deleteMany({ property: P });
    await RoomType.deleteMany({ property: P });
    await User.deleteMany({ property: P });
    await Property.deleteOne({ _id: P });
    await mongoose.disconnect();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\nSummary: PASS=${results.length - failed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
