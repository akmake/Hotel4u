// Platform services: SYS-05 global search and SYS-06 work items / shift handover.
//
// Search returns only identifying, minimal fields and only what the caller's role may open;
// contact details are masked. Work items have an owner and a state: taking is atomic, a transfer
// needs an active target in the same property and a note, closing needs a resolution.
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import GuestProfile from '../models/GuestProfile.js';
import Company from '../models/Company.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import WorkItem from '../models/WorkItem.js';
import { audit } from './auditService.js';

function httpError(message, status = 400, extra = {}) { const e = new Error(message); e.status = status; Object.assign(e, extra); return e; }
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const rx = (q) => new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const maskPhone = (p) => (p ? `•••${String(p).replace(/\D/g, '').slice(-3)}` : null);
const maskEmail = (e) => (e ? String(e).replace(/^(.).*(@.*)$/, '$1•••$2') : null);

const GUEST_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'sales_manager', 'revenue_manager', 'finance_manager', 'cashier'];
const OPS_ROLES = ['housekeeping_manager', 'housekeeper', 'maintenance_manager', 'technician'];

// ── SYS-05 ──────────────────────────────────────────────────────────────────
export async function globalSearch({ propertyId, q, role }) {
  const term = String(q || '').trim();
  if (term.length < 2) return { query: term, groups: [] };
  const r = rx(term);
  const guestSide = GUEST_ROLES.includes(role) || role === 'auditor' || role === 'owner_readonly';
  const groups = [];
  if (guestSide) {
    const guests = await GuestProfile.find({ property: propertyId, isAnonymized: { $ne: true }, $or: [{ firstName: r }, { lastName: r }, { phone: r }, { email: r }] }).select('firstName lastName phone email').limit(6).lean();
    const resFilter = { property: propertyId, $or: [{ confirmationNumber: r }, { externalId: r }, { channelReservationId: r }, { primaryGuest: { $in: guests.map((g) => g._id) } }] };
    const reservations = await Reservation.find(resFilter).select('confirmationNumber status arrivalDate departureDate primaryGuest').populate('primaryGuest', 'firstName lastName').sort({ arrivalDate: -1 }).limit(6).lean();
    groups.push({ type: 'reservation', label: 'הזמנות', items: reservations.map((x) => ({ id: String(x._id), title: `${x.primaryGuest ? `${x.primaryGuest.firstName} ${x.primaryGuest.lastName}` : '—'} · ${x.confirmationNumber}`, subtitle: `${x.arrivalDate} – ${x.departureDate}`, status: x.status, link: `/pms/reservations/${x._id}` })) });
    groups.push({ type: 'guest', label: 'אורחים', items: guests.map((g) => ({ id: String(g._id), title: `${g.firstName} ${g.lastName}`, subtitle: [maskPhone(g.phone), maskEmail(g.email)].filter(Boolean).join(' · '), link: `/pms/reservations?q=${encodeURIComponent(`${g.firstName} ${g.lastName}`)}` })) });
    const companies = await Company.find({ property: propertyId, name: r }).select('name type').limit(5).lean();
    groups.push({ type: 'company', label: 'חברות', items: companies.map((c) => ({ id: String(c._id), title: c.name, subtitle: c.type || '', link: `/pms/reservations?q=${encodeURIComponent(c.name)}` })) });
  }
  if (guestSide || OPS_ROLES.includes(role)) {
    const rooms = await Room.find({ property: propertyId, active: { $ne: false }, number: r }).select('number floor cleanStatus opsStatus').limit(6).lean();
    groups.push({ type: 'room', label: 'חדרים', items: rooms.map((x) => ({ id: String(x._id), title: `חדר ${x.number}`, subtitle: `קומה ${x.floor}`, link: `/pms/housekeeping/rooms?q=${encodeURIComponent(x.number)}` })) });
    const roomIds = rooms.map((x) => x._id);
    const tickets = await MaintenanceTicket.find({ property: propertyId, $or: [{ description: r }, { room: { $in: roomIds } }] }).select('description status priority room').populate('room', 'number').sort({ createdAt: -1 }).limit(5).lean();
    groups.push({ type: 'ticket', label: 'תקלות', items: tickets.map((t) => ({ id: String(t._id), title: t.description.slice(0, 80), subtitle: `${t.room ? `חדר ${t.room.number} · ` : ''}${t.status}`, link: `/pms/maintenance?ticket=${t._id}` })) });
  }
  return { query: term, groups: groups.filter((g) => g.items.length) };
}

// ── SYS-06 ──────────────────────────────────────────────────────────────────
function itemDto(w) {
  return {
    id: String(w._id), kind: w.kind, severity: w.severity, title: w.title, body: w.body || null, source: w.source?.type ? w.source : null,
    owner: w.owner ? { id: String(w.owner), name: w.ownerName || null } : null, status: w.status, dueAt: w.dueAt || null,
    overdue: !!(w.dueAt && w.status !== 'closed' && new Date(w.dueAt) < new Date()),
    notes: (w.notes || []).map((n) => ({ at: n.at, by: n.by, kind: n.kind, text: n.text || null, to: n.to || null })),
    closedReason: w.closedReason || null, closedAt: w.closedAt || null, createdBy: w.createdBy || null, createdAt: w.createdAt,
  };
}

export async function listWork({ propertyId, status = 'open', mine, actor }) {
  const filter = { property: propertyId };
  if (status === 'open') filter.status = { $in: ['new', 'in_progress'] };
  else if (status === 'closed') filter.status = 'closed';
  if (mine) filter.owner = actor.id;
  const rank = { urgent: 0, action: 1, info: 2 };
  const items = (await WorkItem.find(filter).sort({ createdAt: -1 }).limit(200).lean()).map(itemDto)
    .sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || rank[a.severity] - rank[b.severity] || (b.overdue - a.overdue) || new Date(b.createdAt) - new Date(a.createdAt));
  const open = await WorkItem.find({ property: propertyId, status: { $in: ['new', 'in_progress'] } }).select('severity owner').lean();
  return {
    counts: { open: open.length, urgent: open.filter((w) => w.severity === 'urgent').length, unowned: open.filter((w) => !w.owner).length, mine: open.filter((w) => String(w.owner || '') === String(actor.id)).length },
    rows: items,
  };
}

export async function createWork({ propertyId, input, actor, ip }) {
  const fields = {};
  const title = String(input.title || '').trim().slice(0, 200);
  if (!title) fields.title = 'כותרת נדרשת';
  if (input.kind && !['operations', 'finance', 'integration', 'security', 'handover'].includes(input.kind)) fields.kind = 'סוג לא מוכר';
  if (input.severity && !['info', 'action', 'urgent'].includes(input.severity)) fields.severity = 'חומרה לא מוכרת';
  let owner = null;
  if (input.ownerId) {
    if (!isId(String(input.ownerId))) fields.ownerId = 'משתמש לא תקין';
    else owner = await User.findOne({ _id: input.ownerId, property: propertyId, active: { $ne: false } }).select('firstName lastName').lean();
    if (input.ownerId && !owner) fields.ownerId = 'המשתמש אינו פעיל בנכס';
  }
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) fields.dueAt = 'מועד לא תקין';
  if (Object.keys(fields).length) throw httpError('יש לתקן את הפריט', 422, { fields });
  const w = await WorkItem.create({
    property: propertyId, kind: input.kind || 'handover', severity: input.severity || 'action', title, body: input.body ? String(input.body).slice(0, 2000) : undefined,
    owner: owner?._id, ownerName: owner ? `${owner.firstName} ${owner.lastName}` : undefined, status: owner ? 'in_progress' : 'new', dueAt: dueAt || undefined, createdBy: actor.name,
    notes: [{ by: actor.name, kind: 'note', text: 'נפתח' }],
  });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'work.created', entityType: 'WorkItem', entityId: w._id, after: { title, kind: w.kind, severity: w.severity, owner: w.ownerName || null }, ip });
  return itemDto(w.toObject());
}

async function loadWork(propertyId, id) {
  if (!isId(String(id || ''))) throw httpError('מזהה לא תקין', 400);
  const w = await WorkItem.findOne({ _id: id, property: propertyId });
  if (!w) throw httpError('הפריט לא נמצא', 404);
  return w;
}

export async function takeWork({ propertyId, id, actor, ip }) {
  await loadWork(propertyId, id);
  // Atomic: only an unowned (or own) open item can be taken; a second taker gets a conflict.
  const w = await WorkItem.findOneAndUpdate(
    { _id: id, property: propertyId, status: { $in: ['new', 'in_progress'] }, $or: [{ owner: null }, { owner: { $exists: false } }, { owner: actor.id }] },
    { $set: { owner: actor.id, ownerName: actor.name, status: 'in_progress' }, $push: { notes: { by: actor.name, kind: 'take' } } },
    { returnDocument: 'after' },
  );
  if (!w) throw httpError('הפריט כבר בטיפול של מישהו אחר או נסגר', 409, { code: 'taken' });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'work.taken', entityType: 'WorkItem', entityId: w._id, ip });
  return itemDto(w.toObject());
}

export async function transferWork({ propertyId, id, toUserId, note, actor, ip }) {
  const text = String(note || '').trim().slice(0, 1000);
  const fields = {};
  if (!isId(String(toUserId || ''))) fields.toUserId = 'יש לבחור למי להעביר';
  if (text.length < 3) fields.note = 'הערת העברה נדרשת';
  if (Object.keys(fields).length) throw httpError('יש להשלים את ההעברה', 422, { fields });
  const w = await loadWork(propertyId, id);
  if (w.status === 'closed') throw httpError('הפריט נסגר', 409);
  const to = await User.findOne({ _id: toUserId, property: propertyId, active: { $ne: false } }).select('firstName lastName accessUntil').lean();
  if (!to || (to.accessUntil && new Date(to.accessUntil) < new Date())) throw httpError('המשתמש אינו פעיל בנכס', 422, { fields: { toUserId: 'לא פעיל' } });
  const fromName = w.ownerName || 'ללא אחראי';
  w.owner = to._id;
  w.ownerName = `${to.firstName} ${to.lastName}`;
  w.status = 'in_progress';
  w.notes.push({ by: actor.name, kind: 'transfer', text, to: w.ownerName });
  await w.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'work.transferred', entityType: 'WorkItem', entityId: w._id, before: { owner: fromName }, after: { owner: w.ownerName }, reason: text, ip });
  return itemDto(w.toObject());
}

export async function closeWork({ propertyId, id, resolution, actor, ip }) {
  const text = String(resolution || '').trim().slice(0, 1000);
  if (text.length < 3) throw httpError('סגירה מחייבת פתרון או סיבה', 422, { fields: { resolution: 'נדרש' } });
  const w = await loadWork(propertyId, id);
  if (w.status === 'closed') throw httpError('הפריט כבר נסגר', 409);
  w.status = 'closed';
  w.closedReason = text;
  w.closedAt = new Date();
  w.notes.push({ by: actor.name, kind: 'close', text });
  await w.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'work.closed', entityType: 'WorkItem', entityId: w._id, reason: text, ip });
  return itemDto(w.toObject());
}

export async function noteWork({ propertyId, id, text, actor }) {
  const t = String(text || '').trim().slice(0, 1000);
  if (t.length < 2) throw httpError('הערה ריקה', 422, { fields: { text: 'נדרש' } });
  const w = await loadWork(propertyId, id);
  if (w.status === 'closed') throw httpError('הפריט נסגר', 409);
  w.notes.push({ by: actor.name, kind: 'note', text: t });
  await w.save();
  return itemDto(w.toObject());
}

// System sources raise an item once per event (dedupeKey); a repeat while open is ignored.
export async function raiseWork({ propertyId, kind, severity, title, body, source, dedupeKey }) {
  try {
    await WorkItem.create({ property: propertyId, kind, severity, title: String(title).slice(0, 200), body: body ? String(body).slice(0, 2000) : undefined, source, dedupeKey, createdBy: 'system', notes: [{ by: 'system', kind: 'note', text: 'נפתח אוטומטית' }] });
  } catch (e) {
    if (e?.code !== 11000) console.error('[work] raise failed:', e.message);
  }
}
