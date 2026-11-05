// Custom permissions (gap-map item 11). The built-in roles stay; a permission group (and individual
// grants / denies) is an overlay on top of the user's role for the sensitive capabilities below.
//   effective = role default  +  group grants (root → leaf)  −  group denies  →  then the user's own
//   grants / denies on top (an individual grant beats a group deny; within a level a deny beats a grant).
// The overlay is read on every request (middleware/authContext.js), so a change applies at once.
// Call sites keep their role arrays: `can(actor, 'charge.reverse', REVERSE_ROLES)`.
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import User from '../models/User.js';
import PermissionGroup from '../models/PermissionGroup.js';
import ChargeCode from '../models/ChargeCode.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';
import { ensureCatalog } from './chargeCodeService.js';

export const ADMIN_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
export const CAPABILITIES = [
  { key: 'reservation.delete', area: 'הזמנות', label: 'מחיקת הזמנה שנכנסה בטעות' },
  { key: 'price.override', area: 'הזמנות', label: 'שינוי מחיר ידני בהזמנה' },
  { key: 'discount.approve', area: 'הזמנות', label: 'אישור הנחה מעל הסף' },
  { key: 'gtd.release', area: 'הזמנות', label: 'שחרור הזמנות לא מובטחות' },
  { key: 'charge.post_manager', area: 'חשבון', label: 'רישום חיוב מוגבל (קוד מנהל), חיוב אחרי יציאה ושער No Post' },
  { key: 'charge.reverse', area: 'חשבון', label: 'היפוך חיוב' },
  { key: 'refund.issue', area: 'חשבון', label: 'החזר כספי ו־Paid Out מעל הסף' },
  { key: 'credit.note', area: 'חשבון', label: 'מסמך זיכוי' },
  { key: 'day.close', area: 'כספים', label: 'סגירת יום' },
  { key: 'rates.manage', area: 'הכנסות', label: 'ניהול הכנסות: סוגי יום, מדרגות, ערוצים ואסטרטגיה' },
  { key: 'package.manage', area: 'הכנסות', label: 'הגדרת חבילות ושיוך לתעריפים' },
  { key: 'commission.manage', area: 'כספים', label: 'עריכה ותשלום של עמלות סוכנים' },
  { key: 'card.settle', area: 'כספים', label: 'הגדרות סליקה והפקדות של חברות האשראי' },
];
export const CAP_KEYS = CAPABILITIES.map((c) => c.key);
const isId = (v) => mongoose.isValidObjectId(String(v || ''));

// ── The current request's overlay ──────────────────────────────────────────
const als = new AsyncLocalStorage();
export const runAs = (actor, fn) => als.run(actor, fn);
const permsOf = (actor) => {
  if (actor?.perms) return actor.perms;
  const cur = als.getStore();
  return cur && actor?.id && cur.id === actor.id ? cur.perms : null;
};

// True when the role default (the call site's own role list) or a grant allows it and no deny removes it.
export function can(actor, key, roles = []) {
  const p = permsOf(actor);
  if (p?.denies?.includes(key)) return false;
  if (roles.includes(actor?.role)) return true;
  return !!p?.grants?.includes(key);
}
export function requireCan(req, key, roles, message = 'אין הרשאה לפעולה') {
  if (!req.actor) throw Object.assign(new Error('Authentication required'), { status: 401 });
  if (!can(req.actor, key, roles)) throw Object.assign(new Error(message), { status: 403 });
}
// For call sites that only receive the actor's role string (e.g. resolveChargeCode): the current request's overlay,
// used only when it belongs to that role.
export function canAs(role, key, roles = []) {
  const cur = als.getStore();
  const p = cur && cur.role === role ? cur.perms : null;
  if (p?.denies?.includes(key)) return false;
  return roles.includes(role) || !!p?.grants?.includes(key);
}
export function chargeCodeAllowedAs(role, code) {
  const cur = als.getStore();
  const p = cur && cur.role === role ? cur.perms : null;
  return !p?.chargeCodes?.length || p.chargeCodes.includes(code);
}
// Manual posting limited to some charge codes / report groups opened to some groups (null perms = no limit).
export function chargeCodeAllowed(actor, code) {
  const p = permsOf(actor);
  return !p?.chargeCodes?.length || p.chargeCodes.includes(code);
}
export function reportGroupAllowed(actor, group) {
  const p = permsOf(actor);
  return !p?.reportGroups?.length || p.reportGroups.includes(group);
}

// ── Resolution ─────────────────────────────────────────────────────────────
async function chainOf(groupId, propertyId) {
  const chain = []; const seen = new Set();
  let id = groupId;
  while (id && chain.length < 6 && !seen.has(String(id))) {
    seen.add(String(id));
    const g = await PermissionGroup.findOne({ _id: id, property: propertyId }).lean();
    if (!g || g.active === false) break;
    chain.unshift(g);
    id = g.parent;
  }
  return chain;
}

// user: lean doc with property, permissionGroup, perms. Returns null when the user has no overlay.
export async function resolvePerms(user) {
  if (!user?.permissionGroup && !user?.perms?.grants?.length && !user?.perms?.denies?.length) return null;
  const chain = user.permissionGroup ? await chainOf(user.permissionGroup, user.property) : [];
  const G = new Set(); const D = new Set();
  for (const g of chain) {
    for (const k of g.grants || []) { G.add(k); D.delete(k); }
    for (const k of g.denies || []) { D.add(k); G.delete(k); }
  }
  for (const k of user.perms?.grants || []) { G.add(k); D.delete(k); }
  for (const k of user.perms?.denies || []) { D.add(k); G.delete(k); }
  const nearest = (field) => [...chain].reverse().find((g) => g[field]?.length)?.[field] || [];
  return { group: chain.length ? { id: String(chain[chain.length - 1]._id), name: chain[chain.length - 1].name } : null, grants: [...G], denies: [...D], chargeCodes: nearest('chargeCodes'), reportGroups: nearest('reportGroups') };
}

// ── Administration ─────────────────────────────────────────────────────────
const mustAdmin = (actor) => { if (!ADMIN_ROLES.includes(actor?.role)) throw httpError('ניהול הרשאות — למנהל נכס בלבד', 403); };
const log = (propertyId, actor, ip, action, entityType, entityId, before, after, reason) => audit({ property: propertyId, actor: actor.id, actorName: actor.name, action, entityType, entityId, before, after, reason, ip });
const keysOf = (list, field) => {
  const arr = [...new Set((Array.isArray(list) ? list : []).map(String))];
  const bad = arr.filter((k) => !CAP_KEYS.includes(k));
  if (bad.length) throw httpError('הרשאה לא מוכרת', 422, { fields: { [field]: `לא מוכר: ${bad.join(', ')}` } });
  return arr;
};

const groupDto = (g, members = 0) => ({
  id: String(g._id), name: g.name, description: g.description || '', parent: g.parent ? String(g.parent) : null, grants: g.grants || [], denies: g.denies || [],
  chargeCodes: g.chargeCodes || [], reportGroups: g.reportGroups || [], active: g.active !== false, members,
});

export async function catalog({ propertyId, reportGroups = [] }) {
  await ensureCatalog(propertyId);
  const codes = await ChargeCode.find({ property: propertyId, kind: 'charge', active: true }).select('code name').sort({ sortOrder: 1 }).lean();
  return { capabilities: CAPABILITIES, chargeCodes: codes.map((c) => ({ code: c.code, name: c.name })), reportGroups };
}

export async function listGroups({ propertyId }) {
  const [groups, counts] = await Promise.all([
    PermissionGroup.find({ property: propertyId }).sort({ name: 1 }).lean(),
    User.aggregate([{ $match: { property: new mongoose.Types.ObjectId(String(propertyId)), permissionGroup: { $ne: null } } }, { $group: { _id: '$permissionGroup', n: { $sum: 1 } } }]),
  ]);
  const n = new Map(counts.map((c) => [String(c._id), c.n]));
  return groups.map((g) => groupDto(g, n.get(String(g._id)) || 0));
}

export async function saveGroup({ propertyId, id, body, actor, ip, reportGroupNames = null }) {
  mustAdmin(actor);
  const b = body || {};
  const before = id ? await PermissionGroup.findOne({ _id: id, property: propertyId }) : null;
  if (id && !before) throw httpError('הקבוצה לא נמצאה', 404);
  const errors = {};
  const name = String(b.name || '').trim();
  if (!name) errors.name = 'שם חובה';
  const grants = keysOf(b.grants, 'grants'); const denies = keysOf(b.denies, 'denies');
  const clash = grants.filter((k) => denies.includes(k));
  if (clash.length) errors.denies = 'אותה הרשאה לא יכולה להיות גם מוענקת וגם נשללת';
  let parent = null;
  if (b.parent) {
    if (!isId(b.parent)) errors.parent = 'קבוצה לא תקינה';
    else {
      if (before && String(b.parent) === String(before._id)) errors.parent = 'קבוצה לא יכולה לרשת את עצמה';
      const chain = await chainOf(b.parent, propertyId);
      if (!chain.length) errors.parent = 'קבוצת האב לא נמצאה או לא פעילה';
      else if (before && chain.some((g) => String(g._id) === String(before._id))) errors.parent = 'לולאה: קבוצת האב כבר יורשת מהקבוצה הזו';
      else parent = b.parent;
    }
  }
  const codes = [...new Set((b.chargeCodes || []).map(String))];
  if (codes.length) {
    await ensureCatalog(propertyId);
    const found = await ChargeCode.countDocuments({ property: propertyId, kind: 'charge', code: { $in: codes } });
    if (found !== codes.length) errors.chargeCodes = 'קוד חיוב לא קיים בנכס';
  }
  const reportGroups = [...new Set((b.reportGroups || []).map(String))];
  if (reportGroupNames && reportGroups.some((g) => !reportGroupNames.includes(g))) errors.reportGroups = 'קבוצת דוחות לא מוכרת';
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי הקבוצה', 422, { fields: errors });
  const set = { name: name.slice(0, 60), description: String(b.description || '').trim().slice(0, 300), parent, grants, denies, chargeCodes: codes, reportGroups, active: b.active !== false, updatedByName: actor.name };
  let doc;
  if (before) {
    const was = groupDto(before);
    Object.assign(before, set);
    try { await before.save(); } catch (err) { if (err?.code === 11000) throw httpError('כבר יש קבוצה בשם הזה', 409, { fields: { name: 'כבר קיים' } }); throw err; }
    doc = before;
    await log(propertyId, actor, ip, 'permission.group_update', 'PermissionGroup', doc._id, was, groupDto(doc));
  } else {
    try { doc = await PermissionGroup.create({ property: propertyId, ...set }); } catch (err) { if (err?.code === 11000) throw httpError('כבר יש קבוצה בשם הזה', 409, { fields: { name: 'כבר קיים' } }); throw err; }
    await log(propertyId, actor, ip, 'permission.group_create', 'PermissionGroup', doc._id, null, groupDto(doc));
  }
  return groupDto(doc, await User.countDocuments({ property: propertyId, permissionGroup: doc._id }));
}

const userDto = async (u, groupsById) => {
  const eff = await resolvePerms(u);
  return {
    id: String(u._id), name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), email: u.email, role: u.role, active: u.active !== false,
    locked: !!(u.lockUntil && new Date(u.lockUntil) > new Date()),
    group: u.permissionGroup ? { id: String(u.permissionGroup), name: groupsById.get(String(u.permissionGroup))?.name || '—' } : null,
    grants: u.perms?.grants || [], denies: u.perms?.denies || [],
    effective: eff ? { grants: eff.grants, denies: eff.denies, chargeCodes: eff.chargeCodes, reportGroups: eff.reportGroups } : null,
  };
};

export async function listUsers({ propertyId, q }) {
  const f = { property: propertyId, role: { $nin: ['admin', 'sales', 'maintenance', 'shift_manager'] } };
  const needle = String(q || '').trim();
  if (needle) { const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }]; }
  const [users, groups] = await Promise.all([User.find(f).select('firstName lastName email role active permissionGroup perms property lockUntil').sort({ firstName: 1 }).limit(300).lean(), PermissionGroup.find({ property: propertyId }).select('name').lean()]);
  const byId = new Map(groups.map((g) => [String(g._id), g]));
  return Promise.all(users.map((u) => userDto(u, byId)));
}

export async function assignUser({ propertyId, userId, body, actor, ip }) {
  mustAdmin(actor);
  const { canGrant } = await import('./identityService.js');
  const user = isId(userId) ? await User.findOne({ _id: userId, property: propertyId }) : null;
  if (!user) throw httpError('המשתמש לא נמצא', 404);
  if (String(user._id) === String(actor.id)) throw httpError('אי אפשר לשנות הרשאות לעצמך', 403);
  if (!canGrant(actor.role, user.role)) throw httpError('אין סמכות לשנות הרשאות למשתמש בדרגה הזו', 403);
  const b = body || {};
  const before = { group: user.permissionGroup ? String(user.permissionGroup) : null, grants: user.perms?.grants || [], denies: user.perms?.denies || [] };
  if (b.group !== undefined) {
    if (b.group) {
      const g = isId(b.group) ? await PermissionGroup.findOne({ _id: b.group, property: propertyId, active: { $ne: false } }).lean() : null;
      if (!g) throw httpError('קבוצת ההרשאות לא נמצאה או לא פעילה', 404, { fields: { group: 'לא נמצאה' } });
      user.permissionGroup = g._id;
    } else user.permissionGroup = null;
  }
  if (b.grants !== undefined || b.denies !== undefined) {
    const grants = keysOf(b.grants ?? user.perms?.grants, 'grants'); const denies = keysOf(b.denies ?? user.perms?.denies, 'denies');
    if (grants.some((k) => denies.includes(k))) throw httpError('אותה הרשאה לא יכולה להיות גם מוענקת וגם נשללת', 422, { fields: { denies: 'סתירה' } });
    user.perms = { grants, denies };
  }
  await user.save();
  await log(propertyId, actor, ip, 'permission.user_assign', 'User', user._id, before, { group: user.permissionGroup ? String(user.permissionGroup) : null, grants: user.perms?.grants || [], denies: user.perms?.denies || [] });
  const groups = await PermissionGroup.find({ property: propertyId }).select('name').lean();
  return userDto(user.toObject(), new Map(groups.map((g) => [String(g._id), g])));
}

// A locked user (3 failed sign-ins) is released by an administrator only — recorded, and every open session ends.
export async function unlockUser({ propertyId, userId, actor, ip }) {
  mustAdmin(actor);
  const { canGrant } = await import('./identityService.js');
  const user = isId(userId) ? await User.findOne({ _id: userId, property: propertyId }) : null;
  if (!user) throw httpError('המשתמש לא נמצא', 404);
  if (!(user.lockUntil && new Date(user.lockUntil) > new Date())) throw httpError('המשתמש לא נעול', 409);
  if (String(user._id) !== String(actor.id) && !canGrant(actor.role, user.role)) throw httpError('אין סמכות לשחרר משתמש בדרגה הזו', 403);
  user.lockUntil = null; user.failedLoginAttempts = 0; user.tokenVersion = Number(user.tokenVersion || 0) + 1;
  await user.save();
  await log(propertyId, actor, ip, 'user.unlock', 'User', user._id, { locked: true }, { locked: false });
  return { unlocked: true };
}
