// OPS-07 — preventive maintenance. A plan says what is checked, where (all rooms, a room type, chosen
// rooms or a public area) and how often. When a round falls due (minus its lead days) one ticket per
// room is opened in the maintenance queue — never twice for the same plan, round and room — and the
// plan moves to its next round. Nothing here blocks a room; the ticket follows the usual workflow.
import mongoose from 'mongoose';
import PreventivePlan from '../models/PreventivePlan.js';
import MaintenanceTicket, { MT_CATEGORY, MT_PRIORITY } from '../models/MaintenanceTicket.js';
import Room from '../models/Room.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';

export const PREVENTIVE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'maintenance_manager'];
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

function dto(p) {
  return {
    id: String(p._id), title: p.title, category: p.category, priority: p.priority, scope: p.scope,
    roomTypeId: p.roomType ? String(p.roomType) : null, roomIds: (p.rooms || []).map(String), area: p.area || null,
    everyDays: p.everyDays, leadDays: p.leadDays, nextDue: p.nextDue, active: p.active !== false,
    lastRunAt: p.lastRunAt || null, lastOpened: p.lastOpened ?? null, checklist: p.checklist || [],
  };
}

function validate(input, f) {
  const out = {};
  if (input.title !== undefined) { out.title = clip(input.title, 120); if (out.title.length < 3) f.title = 'שם הבדיקה'; }
  if (input.category !== undefined) { if (!MT_CATEGORY.includes(input.category)) f.category = 'קטגוריה'; out.category = input.category; }
  if (input.priority !== undefined) { if (!MT_PRIORITY.includes(input.priority)) f.priority = 'עדיפות'; out.priority = input.priority; }
  if (input.scope !== undefined) { if (!['all_rooms', 'room_type', 'rooms', 'area'].includes(input.scope)) f.scope = 'היקף'; out.scope = input.scope; }
  if (input.roomTypeId !== undefined) out.roomType = mongoose.isValidObjectId(String(input.roomTypeId || '')) ? input.roomTypeId : null;
  if (input.roomIds !== undefined) out.rooms = (Array.isArray(input.roomIds) ? input.roomIds : []).filter((x) => mongoose.isValidObjectId(String(x)));
  if (input.area !== undefined) out.area = clip(input.area, 80) || undefined;
  if (input.everyDays !== undefined) { const v = Number(input.everyDays); if (!(Number.isInteger(v) && v >= 1 && v <= 730)) f.everyDays = '1–730 ימים'; out.everyDays = v; }
  if (input.leadDays !== undefined) { const v = Number(input.leadDays); if (!(Number.isInteger(v) && v >= 0 && v <= 60)) f.leadDays = '0–60'; out.leadDays = v; }
  if (input.nextDue !== undefined) { if (!isYmd(input.nextDue)) f.nextDue = 'תאריך'; out.nextDue = input.nextDue; }
  if (input.checklist !== undefined) out.checklist = (Array.isArray(input.checklist) ? input.checklist : String(input.checklist).split('\n')).map((x) => clip(x, 160)).filter(Boolean).slice(0, 30);
  if (input.active !== undefined) out.active = !!input.active;
  return out;
}
function checkScope(p, f) {
  if (p.scope === 'room_type' && !p.roomType) f.roomTypeId = 'סוג חדר';
  if (p.scope === 'rooms' && !(p.rooms || []).length) f.roomIds = 'לפחות חדר אחד';
  if (p.scope === 'area' && !p.area) f.area = 'שם האזור';
}

export async function listPlans({ propertyId }) {
  const rows = await PreventivePlan.find({ property: propertyId }).sort({ active: -1, nextDue: 1 }).lean();
  return rows.map(dto);
}

export async function savePlan({ propertyId, id, input, actor, ip }) {
  if (!PREVENTIVE_ROLES.includes(actor.role)) throw httpError('תחזוקה מונעת מוגדרת על ידי מנהל תחזוקה', 403);
  const f = {};
  const set = validate(input, f);
  let before = null;
  if (id) {
    before = await PreventivePlan.findOne({ _id: id, property: propertyId }).lean();
    if (!before) throw httpError('התכנית לא נמצאה', 404);
  } else {
    for (const k of ['title', 'category', 'everyDays', 'nextDue']) if (set[k] === undefined && !f[k]) f[k] = 'שדה חובה';
  }
  const merged = { scope: 'all_rooms', priority: 'low', leadDays: 0, ...(before || {}), ...set };
  checkScope(merged, f);
  if (Object.keys(f).length) throw httpError('יש לתקן את השדות המסומנים', 422, { fields: f });
  const doc = id
    ? await PreventivePlan.findOneAndUpdate({ _id: id, property: propertyId }, { $set: set }, { returnDocument: 'after' }).lean()
    : (await PreventivePlan.create({ property: propertyId, ...merged, createdBy: actor.id || undefined })).toObject();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: id ? 'preventive.updated' : 'preventive.created', entityType: 'PreventivePlan', entityId: doc._id, after: set, ip }).catch(() => null);
  return dto(doc);
}

async function roomsOf(plan) {
  if (plan.scope === 'area') return [null];
  const q = { property: plan.property, active: { $ne: false } };
  if (plan.scope === 'room_type') q.roomType = plan.roomType;
  if (plan.scope === 'rooms') q._id = { $in: plan.rooms };
  return (await Room.find(q).select('_id').lean()).map((r) => r._id);
}

// Opens the tickets of every round that is due. Safe to run any number of times.
export async function runDuePlans({ propertyId = null, force = null } = {}) {
  const q = { active: { $ne: false } };
  if (propertyId) q.property = propertyId;
  if (force) q._id = force;
  const plans = await PreventivePlan.find(q).lean();
  let opened = 0;
  const today = new Map();
  for (const plan of plans) {
    const key = String(plan.property);
    if (!today.has(key)) today.set(key, businessDateOf(await Property.findById(plan.property).select('timezone dayClose').lean()));
    const t = today.get(key);
    let due = plan.nextDue;
    let rounds = 0;
    let made = 0;
    while (due && (force ? rounds === 0 : addDays(due, -(plan.leadDays || 0)) <= t) && rounds < 24) {
      for (const room of await roomsOf(plan)) {
        const exists = await MaintenanceTicket.exists({ property: plan.property, 'preventive.plan': plan._id, 'preventive.due': due, room: room || null });
        if (exists) continue;
        await MaintenanceTicket.create({
          property: plan.property, room: room || undefined, areaId: plan.scope === 'area' ? plan.area : undefined,
          category: plan.category, priority: plan.priority || 'low', status: 'new',
          description: `תחזוקה מונעת: ${plan.title}${plan.checklist?.length ? ` — ${plan.checklist.join(' · ')}` : ''}`.slice(0, 1000),
          dueDate: new Date(`${due}T12:00:00Z`), preventive: { plan: plan._id, due },
        });
        made += 1;
      }
      due = addDays(due, plan.everyDays);
      rounds += 1;
    }
    if (rounds) {
      await PreventivePlan.updateOne({ _id: plan._id }, { $set: { nextDue: due, lastRunAt: new Date(), lastOpened: made } });
      if (made) await audit({ property: plan.property, actor: null, actorName: 'system', action: 'preventive.tickets_opened', entityType: 'PreventivePlan', entityId: plan._id, after: { tickets: made, nextDue: due } }).catch(() => null);
      opened += made;
    }
  }
  return { opened };
}

export async function runPlanNow({ propertyId, id, actor }) {
  if (!PREVENTIVE_ROLES.includes(actor.role)) throw httpError('אין הרשאה', 403);
  const plan = await PreventivePlan.findOne({ _id: id, property: propertyId }).lean();
  if (!plan) throw httpError('התכנית לא נמצאה', 404);
  return runDuePlans({ propertyId, force: plan._id });
}
