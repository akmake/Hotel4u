#!/usr/bin/env node
/* eslint-disable no-console */
// Platform integration suite (ADM-05 policy, SYS-05 global search, SYS-06 work items & handover).
// Runs against a live server and the same DB, on a throw-away property.
//
//   node scripts/platformIntegration.mjs [--baseUrl=http://localhost:4000/api/pms]
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Folio from '../models/Folio.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import WorkItem from '../models/WorkItem.js';
import AuditLog from '../models/AuditLog.js';
import ChannelUpdateQueue from '../models/ChannelUpdateQueue.js';
import { signPmsToken } from '../controllers/authController.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, '');
const TAG = `PLT${Date.now().toString(36).toUpperCase()}`;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info !== '' ? `  → ${info}` : ''}`); };
async function call(method, url, t, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, ...json };
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
  const today = todayYmdInTimezone('Asia/Jerusalem');
  const p = await Property.create({ name: `בדיקה ${TAG}`, timezone: 'Asia/Jerusalem', defaultCancellationHours: 24 });
  const P = String(p._id);
  try {
    const users = {};
    for (const role of ['property_admin', 'receptionist', 'housekeeper', 'technician', 'front_desk_manager']) users[role] = await User.create({ property: P, firstName: 'בדיקה', lastName: role, email: `${TAG.toLowerCase()}-${role}@test.local`, passwordHash: 'x', role, active: true });
    const t = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, signPmsToken(u)]));
    const q = (u) => `${u}${u.includes('?') ? '&' : '?'}propertyId=${P}`;

    // ── ADM-05 ──────────────────────────────────────────────────────────────
    let r = await call('GET', q('/platform/policy'), t.front_desk_manager);
    check('ADM-05 policy readable by a desk manager', r.status === 200 && r.data.version === 0 && r.data.readiness === 'clean', r.status);
    r = await call('PUT', q('/platform/policy'), t.front_desk_manager, { reason: 'ניסיון', readiness: 'inspected' });
    check('ADM-05 only a property manager publishes', r.status === 403, r.status);
    r = await call('PUT', q('/platform/policy'), t.property_admin, { readiness: 'inspected' });
    check('ADM-05 publishing requires a reason', r.status === 422 && r.fields?.reason, r.status);
    r = await call('PUT', q('/platform/policy'), t.property_admin, { reason: 'עדכון', terms: { text: 'תנאי שהייה חדשים' } });
    check('ADM-05 changing the guest terms requires a named approver', r.status === 422 && r.fields?.termsApprovedBy, r.status);
    r = await call('PUT', q('/platform/policy'), t.property_admin, { version: 0, reason: 'מעבר לבדיקת חדר וחלון ביטול 48 שעות', readiness: 'inspected', cancellation: { freeHours: 48, fee: { type: 'fixed', amount: 150 } }, terms: { text: 'תנאי שהייה מאושרים', approvedBy: 'עו״ד כהן' }, restDays: [addDays(today, 3)] });
    const pr = await Property.findById(P).lean();
    check('ADM-05 publish bumps the version and applies the rules', r.status === 200 && r.data.version === 1 && pr.checkInPolicy.requireInspection === true && pr.defaultCancellationHours === 48 && pr.defaultCancellationFee === '150' && pr.checkInPolicy.termsVersion === 'he-2' && pr.checkInPolicy.termsApprovedBy === 'עו״ד כהן', JSON.stringify(r.data?.changed || r).slice(0, 200));
    r = await call('PUT', q('/platform/policy'), t.property_admin, { version: 0, reason: 'שינוי מקביל', checkInTime: '14:00' });
    check('ADM-05 a stale version is refused', r.status === 409 && r.code === 'version_conflict', r.status);
    r = await call('GET', q('/platform/policy'), t.property_admin);
    check('ADM-05 history shows who published what', r.status === 200 && r.data.history[0]?.version === 1 && r.data.history[0].changed.includes('cancellation'));

    // The rest-day calendar is used by the cancellation engine (RSV-06).
    const rt = await RoomType.create({ property: P, code: `${TAG}S`, name: 'סטנדרט', baseRate: 400 });
    const room = await Room.create({ property: P, roomType: rt._id, number: `${TAG}1`, floor: 1 });
    const guest = await GuestProfile.create({ property: P, firstName: 'דני', lastName: `חיפוש${TAG}`, phone: '0521234567', email: `dani-${TAG.toLowerCase()}@example.com` });
    const res = await Reservation.create({ property: P, confirmationNumber: `${TAG}-1`, status: 'confirmed', primaryGuest: guest._id, adults: 2, arrivalDate: addDays(today, 8), departureDate: addDays(today, 9), nights: 1, roomsCount: 1, roomType: rt._id, ratePerNight: 400, totalAmount: 400, createdAt: new Date() });
    await ReservationRoom.create({ reservation: res._id, property: P, roomTypeBooked: rt._id, arrivalDate: res.arrivalDate, departureDate: res.departureDate, nightlyRate: 400, status: 'reserved' });
    await Folio.create({ property: P, reservation: res._id, ownerType: 'guest', lines: [] });
    r = await call('POST', q(`/stay/${res._id}/cancellation/preview`), t.receptionist, { channel: 'phone', track: 'regular', reason: 'regret' });
    check('RSV-06 counts the property\'s rest days (not only Saturdays)', r.status === 200 && r.data.lines.some((l) => l.includes('ימי מנוחה שהוגדרו')), JSON.stringify(r.data?.lines || r).slice(0, 200));

    // ── SYS-05 ──────────────────────────────────────────────────────────────
    r = await call('GET', q(`/platform/search?q=${encodeURIComponent(`חיפוש${TAG}`)}`), t.receptionist);
    const gGuest = r.data?.groups?.find((g) => g.type === 'guest');
    const gRes = r.data?.groups?.find((g) => g.type === 'reservation');
    check('SYS-05 finds the guest and their booking', r.status === 200 && gGuest?.items.length === 1 && gRes?.items[0]?.link === `/pms/reservations/${res._id}`, JSON.stringify(r.data || r).slice(0, 200));
    check('SYS-05 contact details are masked in results', !JSON.stringify(r.data).includes('0521234567') && !JSON.stringify(r.data).includes(`dani-${TAG.toLowerCase()}@`));
    r = await call('GET', q(`/platform/search?q=${encodeURIComponent(`חיפוש${TAG}`)}`), t.housekeeper);
    check('SYS-05 housekeeping does not see guests or bookings', r.status === 200 && !r.data.groups.some((g) => ['guest', 'reservation', 'company'].includes(g.type)));
    r = await call('GET', q(`/platform/search?q=${encodeURIComponent(`${TAG}1`)}`), t.housekeeper);
    check('SYS-05 housekeeping finds rooms', r.status === 200 && r.data.groups.some((g) => g.type === 'room' && g.items[0]?.title.includes(`${TAG}1`)));

    // ── SYS-06 ──────────────────────────────────────────────────────────────
    r = await call('POST', q('/platform/work'), t.receptionist, { title: 'אורח בחדר 12 ממתין לטכנאי', body: 'מזגן', severity: 'action' });
    const wid = r.data?.id;
    check('SYS-06 a handover item is opened without an owner', r.status === 200 && r.data.status === 'new' && !r.data.owner, r.error);
    const [a, b] = await Promise.all([call('POST', q(`/platform/work/${wid}/take`), t.receptionist), call('POST', q(`/platform/work/${wid}/take`), t.front_desk_manager)]);
    check('SYS-06 taking is atomic (one owner)', [a, b].filter((x) => x.status === 200).length === 1 && [a, b].some((x) => x.status === 409), `${a.status}/${b.status}`);
    r = await call('POST', q(`/platform/work/${wid}/transfer`), t.receptionist, { toUserId: String(users.technician._id) });
    check('SYS-06 a transfer requires a handover note', r.status === 422 && r.fields?.note, r.status);
    await User.updateOne({ _id: users.housekeeper._id }, { $set: { active: false } });
    r = await call('POST', q(`/platform/work/${wid}/transfer`), t.receptionist, { toUserId: String(users.housekeeper._id), note: 'בבקשה לטפל' });
    check('SYS-06 cannot transfer to an inactive user', r.status === 422, r.status);
    r = await call('POST', q(`/platform/work/${wid}/transfer`), t.receptionist, { toUserId: String(users.technician._id), note: 'המזגן בחדר 12 — להחליף שלט' });
    check('SYS-06 transfer moves ownership and keeps the note', r.status === 200 && r.data.owner.id === String(users.technician._id) && r.data.notes.some((n) => n.kind === 'transfer' && n.text.includes('שלט')), r.error);
    r = await call('POST', q(`/platform/work/${wid}/close`), t.technician, {});
    check('SYS-06 closing requires a resolution', r.status === 422, r.status);
    r = await call('POST', q(`/platform/work/${wid}/close`), t.technician, { resolution: 'הוחלף שלט, נבדק' });
    check('SYS-06 closed with its resolution', r.status === 200 && r.data.status === 'closed', r.error);
    r = await call('POST', q('/ops/tickets'), t.receptionist, { roomId: String(room._id), category: 'safety', priority: 'critical', description: 'ריח גז' });
    const tk = r.data?.id;
    r = await call('GET', q('/platform/work'), t.technician);
    const sys = r.data?.rows?.find((w) => w.source?.type === 'ticket' && w.source.id === tk);
    check('SYS-06 a dangerous fault raises an urgent item for an owner', !!sys && sys.severity === 'urgent' && sys.source.link.includes(tk), JSON.stringify(r.data?.rows?.map((w) => w.title) || r).slice(0, 200));
    r = await call('POST', q(`/stay/${res._id}/cancel`), t.receptionist, { channel: 'desk', track: 'review', reason: 'other', note: 'לבדיקה' });
    const cancelItem = await WorkItem.findOne({ property: P, dedupeKey: `cancel:${res._id}` }).lean();
    check('SYS-06 a cancellation awaiting a money decision gets an owner item', r.status === 200 && !!cancelItem && cancelItem.kind === 'finance', r.error);
  } finally {
    const resIds = (await Reservation.find({ property: P }).select('_id').lean()).map((x) => x._id);
    await AuditLog.deleteMany({ $or: [{ property: P }, { entityId: { $in: [p._id, ...resIds] } }] });
    await ChannelUpdateQueue.deleteMany({ property: P }).catch(() => null);
    await WorkItem.deleteMany({ property: P });
    await MaintenanceTicket.deleteMany({ property: P });
    await Folio.deleteMany({ property: P });
    await ReservationRoom.deleteMany({ property: P });
    await Reservation.deleteMany({ property: P });
    await GuestProfile.deleteMany({ property: P });
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
