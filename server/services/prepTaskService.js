// Arrival preparation from free text: requests written in the booking, the stay unit or the guest
// profile ("extra bed", "allergic to nuts", "birthday") become a checklist for housekeeping.
//
// detectPrep() is pure and shared with the arrivals list, so the desk sees what was understood.
// syncPrepTasks() is idempotent: one arrival_prep task per room + reservation + day, created once
// the unit has a room and topped up when new requests appear; a finished task is left alone.
import Reservation from '../models/Reservation.js';
import ReservationRoom from '../models/ReservationRoom.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { implicitUnits, businessDateOf } from './frontDeskService.js';

const ARRIVING_STATUSES = ['confirmed', 'modified', 'pending_payment', 'partially_checked_in'];
const ACTIVE_HK_STATUSES = ['new', 'assigned', 'in_progress', 'paused', 'failed_inspection'];
const DONE_HK_STATUSES = ['completed', 'inspected'];

// supply: an item housekeeping brings to the room · note: an instruction · urgent: raises priority.
const RULES = [
  { code: 'extra_bed', re: /מיטה נוספת|מיטת נוער|מיטה מתקפלת|מיטה מתקפת|extra bed|rollaway/i, label: 'מיטה נוספת', supply: 'מיטה נוספת' },
  { code: 'crib', re: /לול|עריסה|מיטת תינוק|\bcrib\b|\bcot\b/i, label: 'לול לתינוק', note: 'לול — לוודא מסירה לפי מסך הלולים' },
  { code: 'twin', re: /מיטות נפרדות|להפריד (את )?המיטות|\btwin\b/i, label: 'מיטות נפרדות', note: 'להפריד מיטות' },
  { code: 'double', re: /לחבר (את )?המיטות|מיטה זוגית|\bking\b|\bdouble bed\b/i, label: 'מיטה זוגית', note: 'לחבר מיטות / מיטה זוגית' },
  { code: 'pillows', re: /כרית(ות)? (נוספ|נוספת)|כריות נוספות|extra pillow/i, label: 'כריות נוספות', supply: 'כרית נוספת' },
  { code: 'towels', re: /מגבות נוספות|מגבת נוספת|extra towel/i, label: 'מגבות נוספות', supply: 'סט מגבות נוסף' },
  { code: 'blanket', re: /שמיכה נוספת|extra blanket/i, label: 'שמיכה נוספת', supply: 'שמיכה נוספת' },
  { code: 'allergy', re: /אלרגי|אלרגיה|רגישות ל|allerg/i, label: 'אלרגיה', note: 'אלרגיה — לבדוק את פרטי הבקשה לפני הכנת החדר', urgent: true },
  { code: 'celebration', re: /יום הולדת|יום נישואין|ירח דבש|הצעת נישואין|birthday|anniversary|honeymoon|proposal/i, label: 'אירוע חגיגי', note: 'אירוע חגיגי — לתאם עם הקבלה כיבוד/הפתעה' },
  { code: 'accessible', re: /נגיש|כיסא גלגלים|כסא גלגלים|wheelchair|accessib/i, label: 'נגישות', note: 'צורך בנגישות — לוודא חדר ופריטי נגישות' },
  { code: 'early', re: /כניסה מוקדמת|הגעה מוקדמת|צ'?ק[- ]?אין מוקדם|early check/i, label: 'כניסה מוקדמת', note: 'כניסה מוקדמת — להכין את החדר ראשון', urgent: true },
  { code: 'quiet', re: /חדר שקט|שקט|רחוק מהמעלית|quiet/i, label: 'חדר שקט', note: null },
];

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function detectPrep(...texts) {
  const text = texts.filter(Boolean).join(' \n ');
  if (!text.trim()) return [];
  return RULES.filter((r) => r.re.test(text)).map(({ code, label, supply, note, urgent }) => ({ code, label, supply: supply || null, note: note || null, urgent: !!urgent }));
}

function prepFor(r, u) {
  const g = r.primaryGuest || {};
  const items = detectPrep(r.specialRequests, r.guestNotes, u.notes, g.specialRequests, g.preferences, g.allergies ? `אלרגיה ${g.allergies}` : null);
  // The guest's own words travel with the task, so nothing is lost to the keyword match.
  const source = [r.specialRequests, r.guestNotes, u.notes, g.allergies && `אלרגיה: ${g.allergies}`].filter(Boolean).join(' · ');
  return { items, source: source ? clip(String(source), 600) : null };
}

export async function syncPrepTasks({ propertyId, date, reservationId = null }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  if (!property) return { created: 0, updated: 0 };
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : businessDateOf(property);

  const filter = { property: propertyId, status: { $in: ARRIVING_STATUSES } };
  if (reservationId) filter._id = reservationId;
  else {
    const unitRes = await ReservationRoom.distinct('reservation', { property: propertyId, arrivalDate: day });
    filter.$or = [{ arrivalDate: day }, { _id: { $in: unitRes } }];
  }
  const reservations = await Reservation.find(filter)
    .populate({ path: 'primaryGuest', match: { property: propertyId }, select: 'specialRequests preferences allergies' })
    .select('confirmationNumber status arrivalDate departureDate roomsCount roomType assignedRoom specialRequests guestNotes primaryGuest eta')
    .lean();
  if (!reservations.length) return { created: 0, updated: 0 };

  const units = await ReservationRoom.find({ reservation: { $in: reservations.map((r) => r._id) } }).sort({ createdAt: 1, _id: 1 }).lean();
  const unitsByRes = new Map();
  for (const u of units) {
    const k = String(u.reservation);
    if (!unitsByRes.has(k)) unitsByRes.set(k, []);
    unitsByRes.get(k).push(u);
  }

  let created = 0;
  let updated = 0;
  for (const r of reservations) {
    for (const u of unitsByRes.get(String(r._id)) || implicitUnits(r)) {
      const arrival = u.arrivalDate || r.arrivalDate;
      if (!u.assignedRoom || (!reservationId && arrival !== day)) continue;
      if (!['reserved', 'tentative'].includes(u.status)) continue;
      const { items, source } = prepFor(r, u);
      const work = items.filter((i) => i.supply || i.note);
      if (!work.length) continue;

      const notes = [...work.filter((i) => i.note).map((i) => i.note), source && `בקשת האורח: ${source}`].filter(Boolean);
      const supplies = work.filter((i) => i.supply).map((i) => i.supply);
      const priority = work.some((i) => i.urgent) ? 'high' : 'medium';
      const key = { property: propertyId, room: u.assignedRoom, reservation: r._id, date: arrival, type: 'arrival_prep' };

      const existing = await HousekeepingTask.findOne({ ...key, status: { $in: [...ACTIVE_HK_STATUSES, ...DONE_HK_STATUSES] } }).sort({ createdAt: -1 });
      if (existing && DONE_HK_STATUSES.includes(existing.status)) continue;
      if (existing) {
        const have = new Set((existing.supplies || []).map((s) => s.item));
        const addSupplies = supplies.filter((s) => !have.has(s));
        const haveNotes = String(existing.notes || '');
        const addNotes = notes.filter((n) => !haveNotes.includes(n));
        if (!addSupplies.length && !addNotes.length) continue;
        existing.supplies.push(...addSupplies.map((item) => ({ item, qty: 1 })));
        existing.notes = [haveNotes, ...addNotes].filter(Boolean).join('\n').slice(0, 2000);
        if (priority === 'high' && ['medium', 'low'].includes(existing.priority)) existing.priority = 'high';
        await existing.save();
        updated += 1;
        continue;
      }
      const task = await HousekeepingTask.create({
        ...key,
        priority,
        dueTime: r.eta || undefined,
        supplies: supplies.map((item) => ({ item, qty: 1 })),
        notes: notes.join('\n').slice(0, 2000),
        autoCreated: true,
      });
      created += 1;
      await audit({
        property: propertyId, actor: null, actorName: 'system', action: 'housekeeping.prep_task_created',
        entityType: 'HousekeepingTask', entityId: task._id,
        after: { reservation: String(r._id), confirmationNumber: r.confirmationNumber, room: String(u.assignedRoom), date: arrival, items: work.map((i) => i.code) },
      }).catch(() => null);
    }
  }
  return { created, updated };
}

// Hourly sweep: today's and tomorrow's arrivals for every active property (requests added later
// to a booking still reach housekeeping).
export async function syncPrepTasksAllProperties() {
  const props = await Property.find({ active: { $ne: false } }).select('timezone dayClose').lean();
  for (const p of props) {
    const today = businessDateOf(p);
    const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
    for (const date of [today, d.toISOString().slice(0, 10)]) {
      await syncPrepTasks({ propertyId: String(p._id), date }).catch((err) => console.error('[prepTasks]', err.message));
    }
  }
}
