// Report centre: every hotel report defined once — how to build it from today's models, its
// columns and its summary — so one screen shows any of them (period, summary strip, table with
// totals), one export writes Excel/CSV, and report subscriptions can e-mail them.
//
// A definition: { code, name, group, description, period, build(ctx) }
//   period: 'range' (from–to), 'month', 'ahead' (days from today) or 'none' (as of now)
//   build → { summary: [{label, value, type}], columns: [{key, label, type, total}], rows, note }
//   type: text · int · money · pct · date · datetime;  total: 'sum' | 'avg' (shown in the totals row)
//
// Room revenue is the booking's price spread over its nights (the nightly breakdown when the booking
// has one, else total ÷ nights) — the same "on the books" figure for past and future nights.
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';
import Room from '../models/Room.js';
import RoomBlock from '../models/RoomBlock.js';
import { RatePlan } from '../models/RatePlan.js';
import Company from '../models/Company.js';
import GuestProfile from '../models/GuestProfile.js';
import Folio from '../models/Folio.js';
import AuditLog from '../models/AuditLog.js';
import HousekeepingTask from '../models/HousekeepingTask.js';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import ReservationRoom from '../models/ReservationRoom.js';
import GuestRegistrationCard from '../models/GuestRegistrationCard.js';
import User from '../models/User.js';
import Property from '../models/Property.js';
import { folioBalance } from './departureService.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const SOLD = ['pending_payment', 'confirmed', 'modified', 'checked_in', 'in_house', 'checked_out', 'partially_checked_in', 'partially_checked_out'];
const SOURCE_LABEL = { direct: 'ישיר', booking: 'Booking.com', expedia: 'Expedia', agoda: 'Agoda', airbnb: 'Airbnb', gds: 'GDS', walk_in: 'Walk-in', corporate: 'חברות', agent: 'סוכנים', phone: 'טלפון', website: 'אתר המלון' };
const STATUS_LABEL = { confirmed: 'מאושרת', modified: 'שונתה', pending_payment: 'ממתינה לתשלום', in_house: 'במלון', checked_in: 'במלון', checked_out: 'עזבה', partially_checked_in: 'נכנסה חלקית', partially_checked_out: 'עזבה חלקית', cancelled: 'בוטלה', no_show: 'לא הגיעה', hold: 'שמורה', quote: 'הצעה' };
const METHOD_LABEL = { cash: 'מזומן', credit_card: 'כרטיס אשראי', bank_transfer: 'העברה בנקאית', cheque: 'שיק', voucher: 'שובר', company_account: 'חשבון חברה', ota_virtual_card: 'כרטיס וירטואלי OTA', loyalty_points: 'נקודות', other: 'אחר' };
const DEPT_LABEL = { rooms: 'לינה', fb: 'מזון ומשקאות', f_and_b: 'מזון ומשקאות', spa: 'ספא', parking: 'חניה', minibar: 'מיני־בר', laundry: 'כביסה', telephone: 'טלפון', late_checkout: 'יציאה מאוחרת', no_show_fee: 'דמי אי הגעה', cancellation_fee: 'דמי ביטול', damage: 'נזק', board: 'אירוח (ארוחות)', other: 'שונות' };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (a, b) => (b ? r2((a / b) * 100) : 0);
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const nameOf = (g) => (g ? `${g.firstName || ''} ${g.lastName || ''}`.trim() : '') || '—';
const ymdOf = (d, tz) => (d ? new Date(d).toLocaleDateString('en-CA', { timeZone: tz }) : null);
const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const id = (v) => (v ? String(v._id || v) : null);
function eachDay(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }

// Nights of a booking that fall in [from, to], each with its share of the booking price.
function nightsIn(r, from, to) {
  const out = [];
  const nightly = r.priceSnapshot?.nightly || [];
  const nightlySum = nightly.reduce((s, n) => s + Number(n.price || 0), 0);
  const scale = nightlySum > 0 ? Number(r.totalAmount || 0) / nightlySum : 0;
  const nights = Math.max(1, daysBetween(r.arrivalDate, r.departureDate));
  const flat = Number(r.totalAmount || 0) / nights;
  const byDate = new Map(nightly.map((n) => [n.date, Number(n.price || 0) * scale]));
  for (let d = r.arrivalDate; d < r.departureDate; d = addDays(d, 1)) {
    if (d < from || d > to) continue;
    out.push({ date: d, rooms: Math.max(1, Number(r.roomsCount || 1)), revenue: byDate.has(d) ? byDate.get(d) : flat });
  }
  return out;
}

async function soldInRange(propertyId, from, to, extra = {}) {
  return Reservation.find({ property: propertyId, status: { $in: SOLD }, arrivalDate: { $lte: to }, departureDate: { $gt: from }, ...extra })
    .select('confirmationNumber status arrivalDate departureDate nights roomsCount adults children totalAmount priceSnapshot source marketSegment ratePlan company travelAgent primaryGuest createdAt tourist roomType')
    .lean();
}

// Rooms that can be sold each night: active rooms minus dated blocks and rooms out of order now.
async function sellableByDay(propertyId, days, tz) {
  const rooms = await Room.find({ property: propertyId, active: { $ne: false } }).select('opsStatus outOfServiceUntil').lean();
  const blocks = days.length ? await RoomBlock.find({ property: propertyId, status: 'active', from: { $lte: days[days.length - 1] }, to: { $gt: days[0] } }).select('room from to').lean() : [];
  const today = todayYmdInTimezone(tz);
  const out = new Map();
  for (const d of days) {
    const blocked = new Set(blocks.filter((b) => b.from <= d && b.to > d).map((b) => String(b.room)));
    let n = 0;
    for (const r of rooms) {
      if (blocked.has(String(r._id))) continue;
      const opsOut = r.opsStatus && r.opsStatus !== 'available' && d >= today && d <= (r.outOfServiceUntil || today);
      if (!opsOut) n += 1;
    }
    out.set(d, n);
  }
  return out;
}

// Continent of residence, as the CBS tourism tables group guests (Europe, America, Asia, Africa, Oceania).
const CONTINENTS = {
  'אירופה': 'AL AD AM AT AZ BY BE BA BG HR CY CZ DK EE FI FR GE DE GR HU IS IE IT KZ XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA',
  'אמריקה': 'US CA MX GT BZ SV HN NI CR PA CU DO HT JM BS BB TT AR BO BR CL CO EC GY PY PE SR UY VE PR',
  'אסיה': 'AF BH BD BT BN KH CN IN ID IR IQ JP JO KW KG LA LB MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TM AE UZ VN YE HK MO',
  'אפריקה': 'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW',
  'אוקיאניה': 'AU NZ FJ PG WS TO VU SB KI FM MH NR PW TV',
};
const CONTINENT_BY_CC = Object.fromEntries(Object.entries(CONTINENTS).flatMap(([c, list]) => list.split(' ').map((cc) => [cc, c])));
const CONTINENT_ORDER = ['ישראל', 'אירופה', 'אמריקה', 'אסיה', 'אפריקה', 'אוקיאניה', 'אחר'];
const continentOf = (cc) => CONTINENT_BY_CC[cc] || 'אחר';

// One production report: room nights, revenue, ADR and share, grouped by a key of the booking.
async function production({ propertyId, from, to }, keyOf, labelOf, groupLabel) {
  const res = await soldInRange(propertyId, from, to);
  const groups = new Map();
  for (const r of res) {
    const nights = nightsIn(r, from, to);
    if (!nights.length) continue;
    const k = await keyOf(r);
    if (!groups.has(k)) groups.set(k, { key: k, bookings: 0, roomNights: 0, revenue: 0 });
    const g = groups.get(k);
    g.bookings += 1;
    for (const n of nights) { g.roomNights += n.rooms; g.revenue += n.revenue; }
  }
  const totalNights = [...groups.values()].reduce((s, g) => s + g.roomNights, 0);
  const totalRevenue = [...groups.values()].reduce((s, g) => s + g.revenue, 0);
  const rows = [...groups.values()].sort((a, b) => b.revenue - a.revenue).map((g) => ({
    name: await_label(labelOf, g.key), bookings: g.bookings, roomNights: g.roomNights, revenue: r2(g.revenue),
    adr: g.roomNights ? r2(g.revenue / g.roomNights) : 0, share: pct(g.revenue, totalRevenue),
  }));
  return {
    summary: [
      { label: 'לילות חדר', value: totalNights, type: 'int' },
      { label: 'הכנסות לינה', value: r2(totalRevenue), type: 'money' },
      { label: 'ADR', value: totalNights ? r2(totalRevenue / totalNights) : 0, type: 'money' },
      { label: groupLabel === 'מקור' ? 'מקורות' : 'קבוצות', value: rows.length, type: 'int' },
    ],
    columns: [
      { key: 'name', label: groupLabel, type: 'text' },
      { key: 'bookings', label: 'הזמנות', type: 'int', total: 'sum' },
      { key: 'roomNights', label: 'לילות חדר', type: 'int', total: 'sum' },
      { key: 'revenue', label: 'הכנסות לינה', type: 'money', total: 'sum' },
      { key: 'adr', label: 'ADR', type: 'money' },
      { key: 'share', label: 'נתח מההכנסה', type: 'pct' },
    ],
    rows,
    note: 'הכנסה לפי מחיר ההזמנה, מחולקת על לילות התקופה. כולל הזמנות עתידיות מאושרות, לא כולל ביטולים ואי הגעה.',
  };
}
function await_label(labelOf, key) { return labelOf(key); }

// ── Definitions ──────────────────────────────────────────────────────────
export const REPORTS = [
  // ── קבלה ──
  {
    code: 'cancellations', name: 'ביטולים', group: 'קבלה', period: 'range', defaultPeriod: 'last30',
    description: 'הזמנות שבוטלו בתקופה — לפי תאריך הביטול.',
    async build({ propertyId, from, to, tz }) {
      const res = await Reservation.find({ property: propertyId, status: 'cancelled' }).populate('primaryGuest', 'firstName lastName').select('confirmationNumber arrivalDate nights roomsCount totalAmount source cancelledAt updatedAt createdAt cancellation cancellationReason primaryGuest').lean();
      const rows = res.map((r) => ({ ...r, day: ymdOf(r.cancelledAt || r.updatedAt, tz) })).filter((r) => r.day >= from && r.day <= to)
        .sort((a, b) => (a.day < b.day ? 1 : -1))
        .map((r) => ({
          cancelledOn: r.day, confirmation: r.confirmationNumber, guest: nameOf(r.primaryGuest), arrival: r.arrivalDate,
          nights: r.nights * (r.roomsCount || 1), source: SOURCE_LABEL[r.source] || r.source || '—', amount: r2(r.totalAmount),
          leadDays: Math.max(0, daysBetween(r.day, r.arrivalDate)),
          reason: r.cancellationReason || r.cancellation?.note || { regret: 'חרטה', service_failure: 'תקלה בשירות', other: 'אחר' }[r.cancellation?.reason] || '—',
        }));
      return {
        summary: [
          { label: 'ביטולים', value: rows.length, type: 'int' },
          { label: 'לילות חדר שבוטלו', value: sum(rows, 'nights'), type: 'int' },
          { label: 'הכנסה שבוטלה', value: r2(sum(rows, 'amount')), type: 'money' },
          { label: 'ימים ממוצעים לפני ההגעה', value: rows.length ? Math.round(sum(rows, 'leadDays') / rows.length) : 0, type: 'int' },
        ],
        columns: [
          { key: 'cancelledOn', label: 'בוטל ב', type: 'date' }, { key: 'confirmation', label: 'הזמנה', type: 'text' }, { key: 'guest', label: 'אורח', type: 'text' },
          { key: 'arrival', label: 'הגעה', type: 'date' }, { key: 'nights', label: 'לילות חדר', type: 'int', total: 'sum' }, { key: 'source', label: 'מקור', type: 'text' },
          { key: 'amount', label: 'סכום ההזמנה', type: 'money', total: 'sum' }, { key: 'leadDays', label: 'ימים לפני ההגעה', type: 'int' }, { key: 'reason', label: 'סיבה', type: 'text' },
        ],
        rows,
      };
    },
  },
  {
    code: 'no_shows', name: 'אי הגעה', group: 'קבלה', period: 'range', defaultPeriod: 'last30',
    description: 'הזמנות שסומנו כאי הגעה, לפי יום ההגעה, ומה נגבה עליהן.',
    async build({ propertyId, from, to }) {
      const res = await Reservation.find({ property: propertyId, status: 'no_show', arrivalDate: { $gte: from, $lte: to } }).populate('primaryGuest', 'firstName lastName').select('confirmationNumber arrivalDate nights roomsCount totalAmount source guaranteeType primaryGuest').sort({ arrivalDate: -1 }).lean();
      const folios = await Folio.find({ reservation: { $in: res.map((r) => r._id) } }).select('reservation lines').lean();
      const fee = new Map();
      for (const f of folios) for (const l of f.lines || []) if (l.status === 'posted' && l.department === 'no_show_fee') fee.set(String(f.reservation), (fee.get(String(f.reservation)) || 0) + Number(l.amount) + Number(l.taxAmount || 0));
      const rows = res.map((r) => ({
        arrival: r.arrivalDate, confirmation: r.confirmationNumber, guest: nameOf(r.primaryGuest), nights: r.nights * (r.roomsCount || 1),
        source: SOURCE_LABEL[r.source] || r.source || '—', guarantee: { credit_card: 'כרטיס אשראי', deposit: 'מקדמה', voucher: 'שובר', company_guarantee: 'ערבות חברה', none: 'ללא' }[r.guaranteeType] || '—',
        amount: r2(r.totalAmount), fee: r2(fee.get(String(r._id)) || 0),
      }));
      return {
        summary: [
          { label: 'אי הגעה', value: rows.length, type: 'int' }, { label: 'לילות חדר', value: sum(rows, 'nights'), type: 'int' },
          { label: 'הכנסה שאבדה', value: r2(sum(rows, 'amount')), type: 'money' }, { label: 'דמי אי הגעה שנגבו', value: r2(sum(rows, 'fee')), type: 'money' },
        ],
        columns: [
          { key: 'arrival', label: 'יום ההגעה', type: 'date' }, { key: 'confirmation', label: 'הזמנה', type: 'text' }, { key: 'guest', label: 'אורח', type: 'text' },
          { key: 'nights', label: 'לילות חדר', type: 'int', total: 'sum' }, { key: 'source', label: 'מקור', type: 'text' }, { key: 'guarantee', label: 'ערבות', type: 'text' },
          { key: 'amount', label: 'סכום ההזמנה', type: 'money', total: 'sum' }, { key: 'fee', label: 'דמי אי הגעה', type: 'money', total: 'sum' },
        ],
        rows,
      };
    },
  },
  {
    code: 'room_moves', name: 'מעברי חדר ושינויי שיבוץ', group: 'קבלה', period: 'range', defaultPeriod: 'last30',
    description: 'כל העברה של אורח בין חדרים וכל החלפת שיבוץ, עם הסיבה ומי ביצע.',
    async build({ propertyId, from, to, tz }) {
      const logs = await AuditLog.find({ property: propertyId, action: { $in: ['stay.room_moved', 'reservation.room_reassigned'] }, createdAt: { $gte: new Date(`${addDays(from, -1)}T00:00:00Z`), $lte: new Date(`${addDays(to, 1)}T23:59:59Z`) } }).sort({ createdAt: -1 }).lean();
      const resIds = [...new Set(logs.map((l) => String(l.entityId)))];
      const res = new Map((await Reservation.find({ _id: { $in: resIds } }).populate('primaryGuest', 'firstName lastName').select('confirmationNumber primaryGuest').lean()).map((r) => [String(r._id), r]));
      const roomIds = logs.flatMap((l) => [l.before?.room, l.after?.room]).filter((x) => x && mongoose.isValidObjectId(String(x)) && String(x).length === 24);
      const rooms = new Map((await Room.find({ _id: { $in: roomIds } }).select('number').lean()).map((r) => [String(r._id), r.number]));
      const num = (v) => (v ? rooms.get(String(v)) || String(v) : '—');
      const rows = logs.map((l) => ({ ...l, day: ymdOf(l.createdAt, tz) })).filter((l) => l.day >= from && l.day <= to).map((l) => {
        const r = res.get(String(l.entityId));
        return {
          at: l.createdAt, kind: l.action === 'stay.room_moved' ? 'מעבר חדר (אורח במלון)' : 'החלפת שיבוץ', confirmation: r?.confirmationNumber || '—', guest: nameOf(r?.primaryGuest),
          fromRoom: num(l.before?.room), toRoom: l.after?.number || num(l.after?.room), by: l.actorName || '—', reason: l.reason || '—',
        };
      });
      return {
        summary: [{ label: 'מעברים', value: rows.filter((r) => r.kind.startsWith('מעבר')).length, type: 'int' }, { label: 'החלפות שיבוץ', value: rows.filter((r) => !r.kind.startsWith('מעבר')).length, type: 'int' }],
        columns: [
          { key: 'at', label: 'מתי', type: 'datetime' }, { key: 'kind', label: 'סוג', type: 'text' }, { key: 'confirmation', label: 'הזמנה', type: 'text' }, { key: 'guest', label: 'אורח', type: 'text' },
          { key: 'fromRoom', label: 'מחדר', type: 'text' }, { key: 'toRoom', label: 'לחדר', type: 'text' }, { key: 'by', label: 'בוצע ע״י', type: 'text' }, { key: 'reason', label: 'סיבה', type: 'text' },
        ],
        rows,
      };
    },
  },

  // ── משק בית ותחזוקה ──
  {
    code: 'out_of_order', name: 'חדרים מושבתים', group: 'משק בית ותחזוקה', period: 'range', defaultPeriod: 'mtd',
    description: 'חדרים שהוצאו ממכירה בתקופה (חסימות מתוזמנות ומצב תפעולי), וכמה לילות חדר הפסדנו.',
    async build({ propertyId, from, to, tz }) {
      const blocks = await RoomBlock.find({ property: propertyId, from: { $lte: to }, to: { $gt: from } }).populate('room', 'number').lean();
      const today = todayYmdInTimezone(tz);
      const opsRooms = await Room.find({ property: propertyId, active: { $ne: false }, opsStatus: { $nin: ['available', null] } }).select('number opsStatus outOfServiceUntil').lean();
      const OPS = { out_of_order: 'מושבת (OOO)', out_of_service: 'מחוץ לשירות (OOS)', maintenance_hold: 'המתנה לתחזוקה', owner_hold: 'שמור לבעלים', internal_use: 'שימוש פנימי' };
      const overlap = (a, b) => Math.max(0, daysBetween(a > from ? a : from, b < addDays(to, 1) ? b : addDays(to, 1)));
      const rows = [
        ...blocks.map((b) => ({ room: b.room?.number || '—', kind: { out_of_order: 'מושבת (OOO)', out_of_service: 'מחוץ לשירות (OOS)' }[b.kind] || b.kind || 'חסימה', from: b.from, to: b.to, nights: overlap(b.from, b.to), reason: b.reason || '—', state: b.status === 'active' ? 'פעילה' : 'שוחררה' })),
        ...opsRooms.map((r) => ({ room: r.number, kind: OPS[r.opsStatus] || r.opsStatus, from: today, to: addDays(r.outOfServiceUntil || today, 1), nights: overlap(today, addDays(r.outOfServiceUntil || today, 1)), reason: 'מצב תפעולי של החדר', state: 'פעילה' })),
      ].filter((r) => r.nights > 0).sort((a, b) => b.nights - a.nights);
      return {
        summary: [{ label: 'חדרים', value: new Set(rows.map((r) => r.room)).size, type: 'int' }, { label: 'לילות חדר שהוצאו ממכירה', value: sum(rows, 'nights'), type: 'int' }],
        columns: [
          { key: 'room', label: 'חדר', type: 'text' }, { key: 'kind', label: 'סוג', type: 'text' }, { key: 'from', label: 'מ', type: 'date' }, { key: 'to', label: 'עד (לא כולל)', type: 'date' },
          { key: 'nights', label: 'לילות בתקופה', type: 'int', total: 'sum' }, { key: 'reason', label: 'סיבה', type: 'text' }, { key: 'state', label: 'מצב', type: 'text' },
        ],
        rows,
      };
    },
  },
  {
    code: 'hk_productivity', name: 'פריון משק בית', group: 'משק בית ותחזוקה', period: 'range', defaultPeriod: 'last7',
    description: 'משימות שהושלמו לכל חדרנית, זמן ממוצע למשימה והחזרות מביקורת.',
    async build({ propertyId, from, to }) {
      const tasks = await HousekeepingTask.find({ property: propertyId, date: { $gte: from, $lte: to } }).select('assignedTo type status startedAt completedAt returnReason').lean();
      const users = new Map((await User.find({ _id: { $in: [...new Set(tasks.map((t) => id(t.assignedTo)).filter(Boolean))] } }).select('firstName lastName').lean()).map((u) => [String(u._id), nameOf(u)]));
      const g = new Map();
      for (const t of tasks) {
        const k = id(t.assignedTo) || 'none';
        if (!g.has(k)) g.set(k, { name: k === 'none' ? 'לא שובצה' : users.get(k) || '—', total: 0, done: 0, checkout: 0, stayover: 0, other: 0, minutes: 0, timed: 0, returned: 0 });
        const x = g.get(k);
        x.total += 1;
        if (['completed', 'inspected'].includes(t.status)) {
          x.done += 1;
          if (t.type === 'checkout_clean') x.checkout += 1; else if (t.type === 'stayover') x.stayover += 1; else x.other += 1;
          if (t.startedAt && t.completedAt) { const m = (new Date(t.completedAt) - new Date(t.startedAt)) / 60000; if (m > 0 && m < 600) { x.minutes += m; x.timed += 1; } }
        }
        if (t.status === 'failed_inspection' || t.returnReason) x.returned += 1;
      }
      const rows = [...g.values()].sort((a, b) => b.done - a.done).map((x) => ({ name: x.name, total: x.total, done: x.done, checkout: x.checkout, stayover: x.stayover, other: x.other, avgMinutes: x.timed ? Math.round(x.minutes / x.timed) : null, returned: x.returned }));
      return {
        summary: [{ label: 'משימות', value: sum(rows, 'total'), type: 'int' }, { label: 'הושלמו', value: sum(rows, 'done'), type: 'int' }, { label: 'הוחזרו מביקורת', value: sum(rows, 'returned'), type: 'int' }],
        columns: [
          { key: 'name', label: 'חדרנית', type: 'text' }, { key: 'total', label: 'משימות', type: 'int', total: 'sum' }, { key: 'done', label: 'הושלמו', type: 'int', total: 'sum' },
          { key: 'checkout', label: 'ניקיון עזיבה', type: 'int', total: 'sum' }, { key: 'stayover', label: 'סידור שהייה', type: 'int', total: 'sum' }, { key: 'other', label: 'אחר', type: 'int', total: 'sum' },
          { key: 'avgMinutes', label: 'דקות למשימה', type: 'int' }, { key: 'returned', label: 'הוחזרו', type: 'int', total: 'sum' },
        ],
        rows,
        note: 'זמן ממוצע מחושב רק למשימות שנרשמו בהן התחלה וסיום.',
      };
    },
  },
  {
    code: 'maintenance', name: 'קריאות תחזוקה', group: 'משק בית ותחזוקה', period: 'range', defaultPeriod: 'last30',
    description: 'קריאות שנפתחו בתקופה, מצבן וכמה זמן לקח לטפל בהן.',
    async build({ propertyId, from, to, tz }) {
      const tickets = await MaintenanceTicket.find({ property: propertyId, createdAt: { $gte: new Date(`${addDays(from, -1)}T00:00:00Z`), $lte: new Date(`${addDays(to, 1)}T23:59:59Z`) } }).populate('room', 'number').sort({ createdAt: -1 }).lean();
      const CAT = { electricity: 'חשמל', water: 'מים', hvac: 'מיזוג', furniture: 'ריהוט', cleaning: 'ניקיון', safety: 'בטיחות', lock: 'מנעול', internet: 'אינטרנט', tv: 'טלוויזיה', noise: 'רעש', other: 'אחר' };
      const ST = { new: 'חדשה', assigned: 'שובצה', in_progress: 'בטיפול', waiting_parts: 'ממתינה לחלקים', waiting_vendor: 'ממתינה לספק', resolved: 'טופלה', verified: 'אומתה', closed: 'נסגרה', reopened: 'נפתחה מחדש' };
      const PR = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה', urgent: 'דחופה' };
      const rows = tickets.map((t) => ({ ...t, day: ymdOf(t.createdAt, tz) })).filter((t) => t.day >= from && t.day <= to).map((t) => {
        const end = t.resolvedAt || t.closedAt;
        return { opened: t.createdAt, room: t.room?.number || t.areaId || '—', category: CAT[t.category] || t.category, description: t.description, priority: PR[t.priority] || t.priority, status: ST[t.status] || t.status, hours: end ? r2((new Date(end) - new Date(t.createdAt)) / 3600000) : null, cost: t.actualCost ?? null };
      });
      const solved = rows.filter((r) => r.hours !== null);
      return {
        summary: [
          { label: 'קריאות', value: rows.length, type: 'int' }, { label: 'פתוחות', value: rows.filter((r) => r.hours === null).length, type: 'int' },
          { label: 'שעות טיפול ממוצעות', value: solved.length ? r2(sum(solved, 'hours') / solved.length) : 0, type: 'int' }, { label: 'עלות בפועל', value: r2(sum(rows, 'cost')), type: 'money' },
        ],
        columns: [
          { key: 'opened', label: 'נפתחה', type: 'datetime' }, { key: 'room', label: 'חדר / אזור', type: 'text' }, { key: 'category', label: 'תחום', type: 'text' }, { key: 'description', label: 'תיאור', type: 'text' },
          { key: 'priority', label: 'דחיפות', type: 'text' }, { key: 'status', label: 'מצב', type: 'text' }, { key: 'hours', label: 'שעות עד טיפול', type: 'int' }, { key: 'cost', label: 'עלות', type: 'money', total: 'sum' },
        ],
        rows,
      };
    },
  },
  {
    code: 'lost_found', name: 'אבידות ומציאות', group: 'משק בית ותחזוקה', period: 'range', defaultPeriod: 'last30',
    description: 'פריטים שנמצאו בחדרים בתקופה ומה נעשה בהם.',
    async build({ propertyId, from, to, tz }) {
      const tasks = await HousekeepingTask.find({ property: propertyId, 'lostFound.0': { $exists: true } }).populate('room', 'number').populate('reservation', 'confirmationNumber').select('room reservation lostFound').lean();
      const ST = { found: 'נמצא — במחסן', claimed: 'נמסר לבעלים', donated: 'נתרם', discarded: 'הושלך' };
      const rows = tasks.flatMap((t) => (t.lostFound || []).map((x) => ({ found: x.reportedAt, day: ymdOf(x.reportedAt, tz), room: t.room?.number || '—', confirmation: t.reservation?.confirmationNumber || '—', item: x.itemDescription, where: x.foundLocation || '—', by: x.reportedBy || '—', status: ST[x.status] || x.status })))
        .filter((r) => r.day >= from && r.day <= to).sort((a, b) => (a.found < b.found ? 1 : -1)).map(({ day, ...r }) => r);
      return {
        summary: [{ label: 'פריטים', value: rows.length, type: 'int' }, { label: 'ממתינים לבעלים', value: rows.filter((r) => r.status.startsWith('נמצא')).length, type: 'int' }],
        columns: [
          { key: 'found', label: 'נמצא', type: 'datetime' }, { key: 'room', label: 'חדר', type: 'text' }, { key: 'confirmation', label: 'הזמנה', type: 'text' }, { key: 'item', label: 'פריט', type: 'text' },
          { key: 'where', label: 'מיקום', type: 'text' }, { key: 'by', label: 'דווח ע״י', type: 'text' }, { key: 'status', label: 'מצב', type: 'text' },
        ],
        rows,
      };
    },
  },

  // ── כספים ──
  {
    code: 'revenue_by_code', name: 'הכנסות לפי קוד חיוב', group: 'כספים', period: 'range', defaultPeriod: 'mtd',
    description: 'כל החיובים שנרשמו בחשבונות בתקופה, לפי קוד חיוב — לפני מע״מ, מע״מ וכולל.',
    async build({ propertyId, from, to }) {
      const agg = await Folio.aggregate([
        { $match: { property: new mongoose.Types.ObjectId(propertyId) } }, { $unwind: '$lines' },
        { $match: { 'lines.status': 'posted', 'lines.type': { $in: ['charge', 'fee', 'tax', 'adjustment', 'discount'] }, 'lines.serviceDate': { $gte: from, $lte: to } } },
        { $group: { _id: { d: '$lines.department', t: '$lines.type' }, net: { $sum: '$lines.amount' }, tax: { $sum: '$lines.taxAmount' }, n: { $sum: 1 } } },
      ]);
      const g = new Map();
      for (const a of agg) {
        const k = a._id.t === 'discount' ? 'הנחות' : a._id.t === 'adjustment' ? 'התאמות' : DEPT_LABEL[a._id.d] || a._id.d || 'ללא קוד';
        if (!g.has(k)) g.set(k, { code: k, lines: 0, net: 0, tax: 0 });
        const x = g.get(k); x.lines += a.n; x.net += a.net; x.tax += a.tax || 0;
      }
      const rows = [...g.values()].map((x) => ({ ...x, net: r2(x.net), tax: r2(x.tax), gross: r2(x.net + x.tax) })).sort((a, b) => b.gross - a.gross);
      const gross = sum(rows, 'gross');
      rows.forEach((x) => { x.share = pct(x.gross, gross); });
      return {
        summary: [{ label: 'לפני מע״מ', value: r2(sum(rows, 'net')), type: 'money' }, { label: 'מע״מ', value: r2(sum(rows, 'tax')), type: 'money' }, { label: 'סה״כ כולל מע״מ', value: r2(gross), type: 'money' }],
        columns: [
          { key: 'code', label: 'קוד חיוב', type: 'text' }, { key: 'lines', label: 'שורות', type: 'int', total: 'sum' }, { key: 'net', label: 'לפני מע״מ', type: 'money', total: 'sum' },
          { key: 'tax', label: 'מע״מ', type: 'money', total: 'sum' }, { key: 'gross', label: 'כולל מע״מ', type: 'money', total: 'sum' }, { key: 'share', label: 'נתח', type: 'pct' },
        ],
        rows,
        note: 'לפי יום השירות של החיוב. חיובים שבוטלו אינם נכללים.',
      };
    },
  },
  {
    code: 'payments_by_method', name: 'תשלומים לפי אמצעי', group: 'כספים', period: 'range', defaultPeriod: 'mtd',
    description: 'כמה התקבל בכל אמצעי תשלום בתקופה, והחזרים בנפרד.',
    async build({ propertyId, from, to }) {
      const agg = await Folio.aggregate([
        { $match: { property: new mongoose.Types.ObjectId(propertyId) } }, { $unwind: '$lines' },
        { $match: { 'lines.status': 'posted', 'lines.type': { $in: ['payment', 'deposit', 'refund'] }, 'lines.serviceDate': { $gte: from, $lte: to } } },
        { $group: { _id: { m: '$lines.method', t: '$lines.type' }, amount: { $sum: '$lines.amount' }, n: { $sum: 1 } } },
      ]);
      const g = new Map();
      for (const a of agg) {
        const k = METHOD_LABEL[a._id.m] || a._id.m || 'לא צוין';
        if (!g.has(k)) g.set(k, { method: k, count: 0, received: 0, refunded: 0 });
        const x = g.get(k);
        if (a._id.t === 'refund') x.refunded += Math.abs(a.amount); else { x.received += -a.amount; x.count += a.n; }
      }
      const rows = [...g.values()].map((x) => ({ ...x, received: r2(x.received), refunded: r2(x.refunded), net: r2(x.received - x.refunded) })).sort((a, b) => b.net - a.net);
      return {
        summary: [{ label: 'התקבל', value: r2(sum(rows, 'received')), type: 'money' }, { label: 'הוחזר', value: r2(sum(rows, 'refunded')), type: 'money' }, { label: 'נטו', value: r2(sum(rows, 'net')), type: 'money' }],
        columns: [
          { key: 'method', label: 'אמצעי תשלום', type: 'text' }, { key: 'count', label: 'תשלומים', type: 'int', total: 'sum' }, { key: 'received', label: 'התקבל', type: 'money', total: 'sum' },
          { key: 'refunded', label: 'הוחזר', type: 'money', total: 'sum' }, { key: 'net', label: 'נטו', type: 'money', total: 'sum' },
        ],
        rows,
      };
    },
  },
  {
    code: 'open_balances', name: 'יתרות פתוחות', group: 'כספים', period: 'none',
    description: 'כל חשבון עם יתרה לתשלום — אורחים במלון ואורחים שעזבו — מהגבוה לנמוך.',
    async build({ propertyId }) {
      const res = await Reservation.find({ property: propertyId, status: { $in: ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out', 'checked_out'] } }).populate('primaryGuest', 'firstName lastName').populate('company', 'name').select('confirmationNumber status arrivalDate departureDate primaryGuest company').lean();
      const folios = await Folio.find({ property: propertyId, reservation: { $in: res.map((r) => r._id) }, status: { $ne: 'closed' } }).lean();
      const byRes = new Map();
      for (const f of folios) {
        const b = folioBalance(f);
        if (Math.abs(b) < 0.01) continue;
        const k = String(f.reservation);
        if (!byRes.has(k)) byRes.set(k, { balance: 0, charges: 0, payments: 0, company: f.settlement?.mode === 'company_ar' });
        const x = byRes.get(k);
        x.balance += b;
        for (const l of f.lines || []) if (l.status === 'posted') { if (['payment', 'deposit', 'refund'].includes(l.type)) x.payments -= Number(l.amount); else x.charges += Number(l.amount) + Number(l.taxAmount || 0); }
      }
      const rows = res.filter((r) => byRes.has(String(r._id)) && byRes.get(String(r._id)).balance > 0.009).map((r) => {
        const x = byRes.get(String(r._id));
        return { confirmation: r.confirmationNumber, guest: nameOf(r.primaryGuest), company: r.company?.name || '—', status: STATUS_LABEL[r.status] || r.status, departure: r.departureDate, charges: r2(x.charges), payments: r2(x.payments), balance: r2(x.balance) };
      }).sort((a, b) => b.balance - a.balance);
      return {
        summary: [{ label: 'חשבונות עם יתרה', value: rows.length, type: 'int' }, { label: 'סה״כ יתרות', value: r2(sum(rows, 'balance')), type: 'money' }, { label: 'מתוכן של אורחים שעזבו', value: r2(sum(rows.filter((r) => r.status === 'עזבה'), 'balance')), type: 'money' }],
        columns: [
          { key: 'confirmation', label: 'הזמנה', type: 'text' }, { key: 'guest', label: 'אורח', type: 'text' }, { key: 'company', label: 'חברה', type: 'text' }, { key: 'status', label: 'מצב', type: 'text' },
          { key: 'departure', label: 'עזיבה', type: 'date' }, { key: 'charges', label: 'חיובים', type: 'money', total: 'sum' }, { key: 'payments', label: 'תשלומים', type: 'money', total: 'sum' }, { key: 'balance', label: 'יתרה', type: 'money', total: 'sum' },
        ],
        rows,
      };
    },
  },
  {
    code: 'advance_deposits', name: 'מקדמות על הגעות עתידיות', group: 'כספים', period: 'none',
    description: 'כסף שהתקבל על הזמנות שעוד לא הגיעו — כמה שולם מכל הזמנה.',
    async build({ propertyId, tz }) {
      const today = todayYmdInTimezone(tz);
      const res = await Reservation.find({ property: propertyId, status: { $in: ['confirmed', 'modified', 'pending_payment', 'hold'] }, arrivalDate: { $gte: today } }).populate('primaryGuest', 'firstName lastName').select('confirmationNumber arrivalDate nights totalAmount source primaryGuest').sort({ arrivalDate: 1 }).lean();
      const folios = await Folio.find({ property: propertyId, reservation: { $in: res.map((r) => r._id) } }).select('reservation lines').lean();
      const paid = new Map();
      for (const f of folios) for (const l of f.lines || []) if (l.status === 'posted' && ['payment', 'deposit', 'refund'].includes(l.type)) paid.set(String(f.reservation), (paid.get(String(f.reservation)) || 0) - Number(l.amount));
      const rows = res.filter((r) => (paid.get(String(r._id)) || 0) > 0.009).map((r) => {
        const p = r2(paid.get(String(r._id)));
        return { arrival: r.arrivalDate, confirmation: r.confirmationNumber, guest: nameOf(r.primaryGuest), source: SOURCE_LABEL[r.source] || r.source || '—', total: r2(r.totalAmount), paid: p, paidPct: pct(p, r.totalAmount), balance: r2(r.totalAmount - p) };
      });
      return {
        summary: [{ label: 'הזמנות עם מקדמה', value: rows.length, type: 'int' }, { label: 'סה״כ מקדמות', value: r2(sum(rows, 'paid')), type: 'money' }, { label: 'יתרה לגבייה בהגעה', value: r2(sum(rows, 'balance')), type: 'money' }],
        columns: [
          { key: 'arrival', label: 'הגעה', type: 'date' }, { key: 'confirmation', label: 'הזמנה', type: 'text' }, { key: 'guest', label: 'אורח', type: 'text' }, { key: 'source', label: 'מקור', type: 'text' },
          { key: 'total', label: 'סכום ההזמנה', type: 'money', total: 'sum' }, { key: 'paid', label: 'שולם', type: 'money', total: 'sum' }, { key: 'paidPct', label: '% ששולם', type: 'pct' }, { key: 'balance', label: 'יתרה', type: 'money', total: 'sum' },
        ],
        rows,
      };
    },
  },
  {
    code: 'discounts_overrides', name: 'הנחות ושינויי מחיר', group: 'כספים', period: 'range', defaultPeriod: 'mtd',
    description: 'כל מחיר שנקבע ידנית, הנחה בהזמנה והנחה או התאמה בחשבון — מי עשה ולמה.',
    async build({ propertyId, from, to, tz }) {
      const res = await Reservation.find({ property: propertyId, $or: [{ 'priceSnapshot.override.by': { $exists: true } }, { discountAmount: { $gt: 0 } }] }).populate('primaryGuest', 'firstName lastName').select('confirmationNumber createdAt priceSnapshot discountAmount totalAmount primaryGuest').lean();
      const rowsA = res.map((r) => ({ at: r.createdAt, day: ymdOf(r.createdAt, tz), kind: r.priceSnapshot?.override?.by ? 'מחיר ידני בהזמנה' : 'הנחה בהזמנה', confirmation: r.confirmationNumber, guest: nameOf(r.primaryGuest), amount: r2(-(r.discountAmount || 0)), by: r.priceSnapshot?.override?.by || '—', reason: r.priceSnapshot?.override?.reason || '—' }));
      const folios = await Folio.aggregate([
        { $match: { property: new mongoose.Types.ObjectId(propertyId) } }, { $unwind: '$lines' },
        { $match: { 'lines.status': 'posted', 'lines.type': { $in: ['discount', 'adjustment'] }, 'lines.serviceDate': { $gte: from, $lte: to } } },
        { $lookup: { from: 'reservations', localField: 'reservation', foreignField: '_id', as: 'r' } },
        { $project: { line: '$lines', conf: { $arrayElemAt: ['$r.confirmationNumber', 0] } } },
      ]);
      const rowsB = folios.map((f) => ({ at: f.line.postedAt, day: f.line.serviceDate, kind: f.line.type === 'discount' ? 'הנחה בחשבון' : 'התאמה בחשבון', confirmation: f.conf || '—', guest: '—', amount: r2(Number(f.line.amount) + Number(f.line.taxAmount || 0)), by: '—', reason: f.line.reason || f.line.description || '—' }));
      const rows = [...rowsA, ...rowsB].filter((r) => r.day >= from && r.day <= to).sort((a, b) => (a.at < b.at ? 1 : -1)).map(({ day, ...r }) => r);
      return {
        summary: [{ label: 'פעולות', value: rows.length, type: 'int' }, { label: 'סה״כ הנחות והתאמות', value: r2(sum(rows, 'amount')), type: 'money' }],
        columns: [
          { key: 'at', label: 'מתי', type: 'datetime' }, { key: 'kind', label: 'סוג', type: 'text' }, { key: 'confirmation', label: 'הזמנה', type: 'text' }, { key: 'guest', label: 'אורח', type: 'text' },
          { key: 'amount', label: 'סכום', type: 'money', total: 'sum' }, { key: 'by', label: 'ע״י', type: 'text' }, { key: 'reason', label: 'סיבה', type: 'text' },
        ],
        rows,
      };
    },
  },

  // ── הכנסות וסטטיסטיקה ──
  {
    code: 'forecast', name: 'תחזית תפוסה והכנסות', group: 'הכנסות וסטטיסטיקה', period: 'ahead', defaultPeriod: 'next30',
    description: 'לכל לילה קדימה: חדרים שנמכרו, פנויים, תפוסה, הגעות, עזיבות והכנסה — לפי ההזמנות הקיימות.',
    async build({ propertyId, from, to, tz }) {
      const days = eachDay(from, to);
      const sellable = await sellableByDay(propertyId, days, tz);
      const res = await soldInRange(propertyId, from, to);
      const per = new Map(days.map((d) => [d, { sold: 0, revenue: 0, arrivals: 0, departures: 0 }]));
      for (const r of res) {
        for (const n of nightsIn(r, from, to)) { const x = per.get(n.date); x.sold += n.rooms; x.revenue += n.revenue; }
        if (per.has(r.arrivalDate)) per.get(r.arrivalDate).arrivals += r.roomsCount || 1;
        if (per.has(r.departureDate)) per.get(r.departureDate).departures += r.roomsCount || 1;
      }
      const deps = await Reservation.find({ property: propertyId, status: { $in: SOLD }, departureDate: { $gte: from, $lte: to }, arrivalDate: { $lt: from } }).select('departureDate roomsCount').lean();
      for (const r of deps) per.get(r.departureDate).departures += r.roomsCount || 1;
      const rows = days.map((d) => { const x = per.get(d); const av = sellable.get(d) || 0; return { date: d, sellable: av, sold: x.sold, free: Math.max(0, av - x.sold), occupancy: pct(x.sold, av), arrivals: x.arrivals, departures: x.departures, revenue: r2(x.revenue), adr: x.sold ? r2(x.revenue / x.sold) : 0 }; });
      const soldT = sum(rows, 'sold'); const avT = sum(rows, 'sellable'); const revT = sum(rows, 'revenue');
      return {
        summary: [{ label: 'תפוסה צפויה', value: pct(soldT, avT), type: 'pct' }, { label: 'לילות חדר שנמכרו', value: soldT, type: 'int' }, { label: 'הכנסות לינה צפויות', value: r2(revT), type: 'money' }, { label: 'ADR', value: soldT ? r2(revT / soldT) : 0, type: 'money' }],
        columns: [
          { key: 'date', label: 'לילה', type: 'date' }, { key: 'sellable', label: 'חדרים למכירה', type: 'int', total: 'sum' }, { key: 'sold', label: 'נמכרו', type: 'int', total: 'sum' }, { key: 'free', label: 'פנויים', type: 'int', total: 'sum' },
          { key: 'occupancy', label: 'תפוסה', type: 'pct' }, { key: 'arrivals', label: 'הגעות', type: 'int', total: 'sum' }, { key: 'departures', label: 'עזיבות', type: 'int', total: 'sum' }, { key: 'revenue', label: 'הכנסות לינה', type: 'money', total: 'sum' }, { key: 'adr', label: 'ADR', type: 'money' },
        ],
        rows,
      };
    },
  },
  {
    code: 'pace', name: 'קצב הזמנות מול שנה שעברה', group: 'הכנסות וסטטיסטיקה', period: 'none',
    description: 'לחודשים הקרובים: מה כבר מוזמן היום, מול מה שהיה מוזמן באותו יום בשנה שעברה לאותם חודשים.',
    async build({ propertyId, tz }) {
      const today = todayYmdInTimezone(tz);
      const cutoffLY = new Date(`${addDays(today, -364)}T23:59:59Z`);
      const rows = [];
      for (let i = 0; i < 6; i += 1) {
        const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + i);
        const from = d.toISOString().slice(0, 10); const e = new Date(d); e.setUTCMonth(e.getUTCMonth() + 1); const to = addDays(e.toISOString().slice(0, 10), -1);
        const lyFrom = `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`; const lyTo = addDays(`${Number(to.slice(0, 4)) - 1}${addDays(to, 1).slice(4)}`, -1);
        const now = await soldInRange(propertyId, from, to);
        // Last year as it stood a year ago: booked by then, and not yet cancelled by then.
        const ly = (await Reservation.find({ property: propertyId, arrivalDate: { $lte: lyTo }, departureDate: { $gt: lyFrom }, createdAt: { $lte: cutoffLY }, status: { $in: [...SOLD, 'cancelled', 'no_show'] } })
          .select('arrivalDate departureDate roomsCount totalAmount priceSnapshot status cancelledAt').lean()).filter((r) => r.status !== 'cancelled' || (r.cancelledAt && r.cancelledAt > cutoffLY));
        const tot = (list, f, t) => list.reduce((acc, r) => { for (const n of nightsIn(r, f, t)) { acc.n += n.rooms; acc.rev += n.revenue; } return acc; }, { n: 0, rev: 0 });
        const a = tot(now, from, to); const b = tot(ly, lyFrom, lyTo);
        rows.push({ month: from.slice(0, 7), nightsNow: a.n, nightsLY: b.n, nightsDiff: a.n - b.n, revenueNow: r2(a.rev), revenueLY: r2(b.rev), revenueDiffPct: b.rev ? pct(a.rev - b.rev, b.rev) : null });
      }
      return {
        summary: [{ label: 'לילות מוזמנים (6 חודשים)', value: sum(rows, 'nightsNow'), type: 'int' }, { label: 'באותו יום אשתקד', value: sum(rows, 'nightsLY'), type: 'int' }, { label: 'הכנסה מוזמנת', value: r2(sum(rows, 'revenueNow')), type: 'money' }],
        columns: [
          { key: 'month', label: 'חודש', type: 'text' }, { key: 'nightsNow', label: 'לילות מוזמנים היום', type: 'int', total: 'sum' }, { key: 'nightsLY', label: 'אשתקד באותו יום', type: 'int', total: 'sum' }, { key: 'nightsDiff', label: 'הפרש', type: 'int', total: 'sum' },
          { key: 'revenueNow', label: 'הכנסה מוזמנת', type: 'money', total: 'sum' }, { key: 'revenueLY', label: 'הכנסה אשתקד', type: 'money', total: 'sum' }, { key: 'revenueDiffPct', label: 'שינוי בהכנסה', type: 'pct' },
        ],
        rows,
        note: 'אשתקד = הזמנות שכבר היו קיימות לפני שנה בדיוק לאותם חודשים, כולל כאלה שבוטלו אחר כך.',
      };
    },
  },
  {
    code: 'pickup', name: 'הזמנות שנכנסו (Pickup)', group: 'הכנסות וסטטיסטיקה', period: 'range', defaultPeriod: 'last7',
    description: 'הזמנות שנוצרו בתקופה — לאיזה חודשי שהייה הן נכנסו ומאיזה מקור.',
    async build({ propertyId, from, to }) {
      const res = await Reservation.find({ property: propertyId, createdAt: { $gte: new Date(`${from}T00:00:00Z`), $lte: new Date(`${to}T23:59:59Z`) }, status: { $nin: ['draft', 'quote'] } }).select('arrivalDate nights roomsCount totalAmount status source').lean();
      const g = new Map();
      for (const r of res) {
        const k = r.arrivalDate.slice(0, 7);
        if (!g.has(k)) g.set(k, { month: k, bookings: 0, cancelled: 0, roomNights: 0, revenue: 0, web: 0, ota: 0 });
        const x = g.get(k);
        x.bookings += 1;
        if (['cancelled', 'no_show'].includes(r.status)) { x.cancelled += 1; continue; }
        x.roomNights += (r.nights || 0) * (r.roomsCount || 1); x.revenue += Number(r.totalAmount || 0);
        if (['booking', 'expedia', 'agoda', 'airbnb'].includes(r.source)) x.ota += 1; else x.web += 1;
      }
      const rows = [...g.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map((x) => ({ ...x, revenue: r2(x.revenue) }));
      return {
        summary: [{ label: 'הזמנות חדשות', value: sum(rows, 'bookings'), type: 'int' }, { label: 'לילות חדר', value: sum(rows, 'roomNights'), type: 'int' }, { label: 'הכנסה שנכנסה', value: r2(sum(rows, 'revenue')), type: 'money' }],
        columns: [
          { key: 'month', label: 'חודש השהייה', type: 'text' }, { key: 'bookings', label: 'הזמנות', type: 'int', total: 'sum' }, { key: 'cancelled', label: 'מהן בוטלו', type: 'int', total: 'sum' },
          { key: 'roomNights', label: 'לילות חדר', type: 'int', total: 'sum' }, { key: 'revenue', label: 'הכנסה', type: 'money', total: 'sum' }, { key: 'ota', label: 'מ-OTA', type: 'int', total: 'sum' }, { key: 'web', label: 'ישיר ואחר', type: 'int', total: 'sum' },
        ],
        rows,
      };
    },
  },
  {
    code: 'production_source', name: 'ביצועים לפי מקור הזמנה', group: 'הכנסות וסטטיסטיקה', period: 'range', defaultPeriod: 'mtd',
    description: 'לילות, הכנסה ו-ADR לכל ערוץ: ישיר, Booking, Expedia, Walk-in ועוד.',
    build: (ctx) => production(ctx, (r) => r.source || 'direct', (k) => SOURCE_LABEL[k] || k, 'מקור'),
  },
  {
    code: 'production_segment', name: 'ביצועים לפי פלח שוק', group: 'הכנסות וסטטיסטיקה', period: 'range', defaultPeriod: 'mtd',
    description: 'לילות, הכנסה ו-ADR לפי פלח השוק שנרשם בהזמנה.',
    build: (ctx) => production(ctx, (r) => r.marketSegment || '', (k) => k || 'לא הוגדר פלח', 'פלח שוק'),
  },
  {
    code: 'production_rate_plan', name: 'ביצועים לפי תעריף', group: 'הכנסות וסטטיסטיקה', period: 'range', defaultPeriod: 'mtd',
    description: 'אילו תעריפים מוכרים: לילות, הכנסה ו-ADR לכל תוכנית תעריף.',
    async build(ctx) {
      const plans = new Map((await RatePlan.find({ property: ctx.propertyId }).select('name code').lean()).map((p) => [String(p._id), p.name || p.code]));
      return production(ctx, (r) => id(r.ratePlan) || r.priceSnapshot?.ratePlanName || '', (k) => plans.get(k) || k || 'ללא תעריף', 'תעריף');
    },
  },
  {
    code: 'production_company', name: 'ביצועים לפי חברה וסוכן', group: 'הכנסות וסטטיסטיקה', period: 'range', defaultPeriod: 'mtd',
    description: 'מי מביא עבודה: לילות, הכנסה ו-ADR לכל חברה וסוכן נסיעות.',
    async build(ctx) {
      const comps = new Map((await Company.find({ property: ctx.propertyId }).select('name').lean()).map((c) => [String(c._id), c.name]));
      return production(ctx, (r) => (r.company ? `c:${id(r.company)}` : r.travelAgent ? `a:${id(r.travelAgent)}` : ''), (k) => (!k ? 'פרטיים (ללא חברה)' : `${comps.get(k.slice(2)) || '—'}${k.startsWith('a:') ? ' (סוכן)' : ''}`), 'חברה / סוכן');
    },
  },
  {
    code: 'lead_time', name: 'זמן הזמנה מראש ומשך שהייה', group: 'הכנסות וסטטיסטיקה', period: 'range', defaultPeriod: 'last90',
    description: 'כמה זמן לפני ההגעה מזמינים, וכמה לילות נשארים — להזמנות שהגיעו בתקופה.',
    async build({ propertyId, from, to, tz }) {
      const res = await Reservation.find({ property: propertyId, status: { $in: SOLD }, arrivalDate: { $gte: from, $lte: to } }).select('arrivalDate nights createdAt totalAmount').lean();
      const B = [['אותו יום', 0, 0], ['1–3 ימים', 1, 3], ['4–7 ימים', 4, 7], ['8–14 ימים', 8, 14], ['15–30 ימים', 15, 30], ['31–60 ימים', 31, 60], ['61–90 ימים', 61, 90], ['מעל 90 ימים', 91, 100000]];
      const rows = B.map(([label]) => ({ bucket: label, bookings: 0, nights: 0, revenue: 0 }));
      let leadSum = 0;
      for (const r of res) {
        const lead = Math.max(0, daysBetween(ymdOf(r.createdAt, tz) || r.arrivalDate, r.arrivalDate));
        leadSum += lead;
        const i = B.findIndex(([, a, b]) => lead >= a && lead <= b);
        rows[i].bookings += 1; rows[i].nights += r.nights || 0; rows[i].revenue += Number(r.totalAmount || 0);
      }
      const n = res.length;
      rows.forEach((x) => { x.revenue = r2(x.revenue); x.avgLos = x.bookings ? r2(x.nights / x.bookings) : 0; x.share = pct(x.bookings, n); });
      return {
        summary: [{ label: 'הזמנות', value: n, type: 'int' }, { label: 'ימים ממוצעים מראש', value: n ? Math.round(leadSum / n) : 0, type: 'int' }, { label: 'לילות ממוצעים לשהייה', value: n ? r2(sum(rows, 'nights') / n) : 0, type: 'int' }],
        columns: [
          { key: 'bucket', label: 'הוזמן לפני ההגעה', type: 'text' }, { key: 'bookings', label: 'הזמנות', type: 'int', total: 'sum' }, { key: 'share', label: 'נתח', type: 'pct' },
          { key: 'avgLos', label: 'לילות ממוצעים', type: 'int' }, { key: 'revenue', label: 'הכנסה', type: 'money', total: 'sum' },
        ],
        rows,
      };
    },
  },
  {
    code: 'cbs', name: 'דוח חודשי ללמ״ס', group: 'הכנסות וסטטיסטיקה', period: 'month', defaultPeriod: 'lastMonth',
    description: 'הנתונים לסקר בתי המלון של הלשכה המרכזית לסטטיסטיקה: חדרים, לינות, אורחים ישראלים ותיירים לפי מדינה, והכנסות.',
    async build({ propertyId, from, to, tz }) {
      const days = eachDay(from, to);
      const sellable = await sellableByDay(propertyId, days, tz);
      const res = await soldInRange(propertyId, from, to);
      const guests = new Map((await GuestProfile.find({ _id: { $in: res.map((r) => r.primaryGuest) } }).select('citizenship country').lean()).map((g) => [String(g._id), g]));
      const countryName = new Intl.DisplayNames(['he'], { type: 'region' });
      const by = new Map();
      let roomNights = 0; let revenue = 0;
      for (const r of res) {
        const nights = nightsIn(r, from, to);
        if (!nights.length) continue;
        const g = guests.get(String(r.primaryGuest)) || {};
        const raw = (r.tourist?.nonResident ? r.tourist.passportCountry : null) || g.citizenship || g.country || 'IL';
        const cc = /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : 'IL';
        const people = Number(r.adults || 1) + Number(r.children || 0);
        if (!by.has(cc)) by.set(cc, { cc, arrivals: 0, guestNights: 0, roomNights: 0 });
        const x = by.get(cc);
        if (r.arrivalDate >= from && r.arrivalDate <= to) x.arrivals += people;
        for (const n of nights) { x.guestNights += people; x.roomNights += n.rooms; roomNights += n.rooms; revenue += n.revenue; }
      }
      let name = (cc) => cc;
      try { name = (cc) => countryName.of(cc) || cc; } catch { /* old runtime */ }
      const rows = [...by.values()].sort((a, b) => (a.cc === 'IL' ? -1 : b.cc === 'IL' ? 1 : (CONTINENT_ORDER.indexOf(continentOf(a.cc)) - CONTINENT_ORDER.indexOf(continentOf(b.cc))) || b.guestNights - a.guestNights))
        .map((x) => ({ continent: x.cc === 'IL' ? 'ישראל' : continentOf(x.cc), country: x.cc === 'IL' ? 'ישראל (תושבים)' : name(x.cc), arrivals: x.arrivals, guestNights: x.guestNights, roomNights: x.roomNights }));
      const il = by.get('IL') || { arrivals: 0, guestNights: 0 };
      const av = [...sellable.values()].reduce((s, n) => s + n, 0);
      const rooms = await Room.countDocuments({ property: propertyId, active: { $ne: false } });
      return {
        summary: [
          { label: 'חדרים במלון', value: rooms, type: 'int' }, { label: 'לילות חדר זמינים', value: av, type: 'int' }, { label: 'לילות חדר תפוסים', value: roomNights, type: 'int' }, { label: 'תפוסה', value: pct(roomNights, av), type: 'pct' },
          { label: 'לינות ישראלים', value: il.guestNights, type: 'int' }, { label: 'לינות תיירים', value: sum(rows, 'guestNights') - il.guestNights, type: 'int' }, { label: 'הכנסות לינה', value: r2(revenue), type: 'money' },
        ],
        columns: [{ key: 'continent', label: 'יבשת', type: 'text' }, { key: 'country', label: 'מדינת מגורים', type: 'text' }, { key: 'arrivals', label: 'אורחים שהגיעו', type: 'int', total: 'sum' }, { key: 'guestNights', label: 'לינות (אורח × לילה)', type: 'int', total: 'sum' }, { key: 'roomNights', label: 'לילות חדר', type: 'int', total: 'sum' }],
        rows,
        note: 'מדינה לפי רישום התייר בהזמנה, אחרת לפי אזרחות האורח בכרטיס; ללא נתון — ישראל. הכנסה לפי מחיר ההזמנה כולל מע״מ.',
      };
    },
  },

  // ── חוקי ובטיחות ──
  {
    code: 'guest_register', name: 'פנקס אורחים (כל האורחים)', group: 'חוקי ובטיחות', period: 'range', defaultPeriod: 'mtd',
    roles: ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'auditor'],
    description: 'רישום כל אורח שנכנס בתקופה — ישראלים ותיירים — עם פרטי מסמך הזיהוי, להצגה בביקורת. שהיות בלי רישום מאומת מסומנות.',
    async build({ propertyId, from, to }) {
      const res = await Reservation.find({ property: propertyId, status: { $in: ['in_house', 'checked_in', 'checked_out', 'partially_checked_in', 'partially_checked_out'] }, arrivalDate: { $gte: from, $lte: to } })
        .populate('primaryGuest', 'firstName lastName').populate('assignedRoom', 'number').select('confirmationNumber arrivalDate departureDate checkedInAt checkedOutAt primaryGuest assignedRoom adults children').sort({ arrivalDate: 1 }).lean();
      const cards = await GuestRegistrationCard.find({ reservation: { $in: res.map((r) => r._id) }, supersededBy: { $exists: false } }).sort({ createdAt: 1 }).lean();
      const byRes = new Map();
      for (const c of cards) { const k = String(c.reservation); if (!byRes.has(k)) byRes.set(k, []); byRes.get(k).push(c); }
      const DOC = { passport: 'דרכון', id_card: 'תעודת זהות', drivers_license: 'רישיון נהיגה', other: 'אחר' };
      const country = new Intl.DisplayNames(['he'], { type: 'region' });
      const cn = (cc) => { try { return /^[A-Z]{2}$/.test(cc || '') ? country.of(cc) : cc || '—'; } catch { return cc || '—'; } };
      const rows = [];
      for (const r of res) {
        const list = byRes.get(String(r._id)) || [];
        const verified = list.filter((c) => c.idVerified);
        const use = verified.length ? verified : list;
        if (!use.length) {
          rows.push({ arrival: r.arrivalDate, departure: r.departureDate, room: r.assignedRoom?.number || '—', confirmation: r.confirmationNumber, name: nameOf(r.primaryGuest), birth: null, nationality: '—', docType: '—', docNumber: '—', verified: 'אין רישום', signed: '—' });
          continue;
        }
        for (const c of use) {
          rows.push({
            arrival: c.arrivalDate || r.arrivalDate, departure: c.departureDate || r.departureDate, room: c.assignedRoom || r.assignedRoom?.number || '—', confirmation: r.confirmationNumber,
            name: `${c.firstName} ${c.lastName}`.trim(), birth: c.dateOfBirth ? new Date(c.dateOfBirth).toISOString().slice(0, 10) : null, nationality: cn(c.nationality),
            docType: DOC[c.idDocType] || c.idDocType, docNumber: c.idDocNumber || '—', verified: c.idVerified ? 'נבדק בקבלה' : 'לא נבדק (מקוון)', signed: c.signedAt ? 'כן' : 'לא',
          });
        }
      }
      const missing = rows.filter((r) => r.verified !== 'נבדק בקבלה').length;
      return {
        summary: [{ label: 'שהיות', value: res.length, type: 'int' }, { label: 'רשומות בפנקס', value: rows.filter((r) => r.verified !== 'אין רישום').length, type: 'int' }, { label: 'בלי רישום מאומת', value: missing, type: 'int' }],
        columns: [
          { key: 'arrival', label: 'הגעה', type: 'date' }, { key: 'departure', label: 'עזיבה', type: 'date' }, { key: 'room', label: 'חדר', type: 'text' }, { key: 'confirmation', label: 'הזמנה', type: 'text' },
          { key: 'name', label: 'שם', type: 'text' }, { key: 'birth', label: 'תאריך לידה', type: 'date' }, { key: 'nationality', label: 'אזרחות', type: 'text' },
          { key: 'docType', label: 'מסמך', type: 'text' }, { key: 'docNumber', label: 'מספר מסמך', type: 'ltr' }, { key: 'verified', label: 'אימות', type: 'text' }, { key: 'signed', label: 'חתם', type: 'text' },
        ],
        rows,
        note: 'כולל רק שהיות שנכנסו בפועל. "בלי רישום מאומת" — שהייה שאין לה כרטיס רישום שנבדק בקבלה; יש להשלים.',
      };
    },
  },
  {
    code: 'evacuation', name: 'רשימת פינוי חירום', group: 'חוקי ובטיחות', period: 'none',
    description: 'מי נמצא עכשיו בכל חדר, כמה אנשים ומי צריך עזרה בפינוי — לפי קומה וחדר, להדפסה מיידית.',
    async build({ propertyId }) {
      const units = await ReservationRoom.find({ property: propertyId, status: { $in: ['in_house', 'checked_in'] }, assignedRoom: { $ne: null } }).populate('assignedRoom', 'number floor building').lean();
      const resIds = [...new Set(units.map((u) => String(u.reservation)))];
      const resList = await Reservation.find({ property: propertyId, $or: [{ _id: { $in: resIds } }, { status: { $in: ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'] }, assignedRoom: { $ne: null } }] })
        .populate('primaryGuest', 'firstName lastName phone').populate('assignedRoom', 'number floor building').select('confirmationNumber status adults children specialRequests isVip primaryGuest assignedRoom departureDate').lean();
      const resById = new Map(resList.map((r) => [String(r._id), r]));
      const withUnits = new Set(units.map((u) => String(u.reservation)));
      const ACCESS = /נגיש|כיסא גלגלים|כסא גלגלים|wheelchair|accessib|מוגבלות|הליכון|עיוור|חירש/i;
      const rows = [];
      const push = (room, r, u) => rows.push({
        floor: room?.floor ?? null, room: room?.number || '—', building: room?.building || '', guest: u?.occupantName || nameOf(r?.primaryGuest),
        adults: u?.adults ?? r?.adults ?? null, children: u?.children ?? r?.children ?? null, phone: u?.occupantPhone || r?.primaryGuest?.phone || '—',
        help: ACCESS.test(`${r?.specialRequests || ''} ${u?.notes || ''}`) ? 'כן — לבדוק' : '', confirmation: r?.confirmationNumber || '—', departure: r?.departureDate || null,
      });
      for (const u of units) if (['in_house', 'checked_in'].includes(u.status)) push(u.assignedRoom, resById.get(String(u.reservation)), u);
      for (const r of resList) if (!withUnits.has(String(r._id)) && ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'].includes(r.status)) push(r.assignedRoom, r, null);
      rows.sort((a, b) => (a.floor ?? 999) - (b.floor ?? 999) || String(a.room).localeCompare(String(b.room), 'he', { numeric: true }));
      const people = rows.reduce((s, r) => s + (Number(r.adults) || 0) + (Number(r.children) || 0), 0);
      return {
        summary: [{ label: 'חדרים תפוסים', value: rows.length, type: 'int' }, { label: 'אנשים במלון', value: people, type: 'int' }, { label: 'מתוכם ילדים', value: sum(rows, 'children'), type: 'int' }, { label: 'צריכים עזרה בפינוי', value: rows.filter((r) => r.help).length, type: 'int' }],
        columns: [
          { key: 'floor', label: 'קומה', type: 'int' }, { key: 'room', label: 'חדר', type: 'text' }, { key: 'guest', label: 'אורח', type: 'text' }, { key: 'adults', label: 'מבוגרים', type: 'int', total: 'sum' },
          { key: 'children', label: 'ילדים', type: 'int', total: 'sum' }, { key: 'help', label: 'עזרה בפינוי', type: 'text' }, { key: 'phone', label: 'טלפון', type: 'ltr' }, { key: 'confirmation', label: 'הזמנה', type: 'text' },
        ],
        rows,
        note: '"עזרה בפינוי" מזוהה מהבקשות בהזמנה (נגישות, כיסא גלגלים וכו׳) — לא מחליף בדיקה. לא כולל צוות ומבקרים.',
      };
    },
  },

  // ── אורחים ושיווק ──
  {
    code: 'repeat_guests', name: 'אורחים חוזרים', group: 'אורחים ושיווק', period: 'range', defaultPeriod: 'last90',
    description: 'אורחים שהיו אצלנו יותר מפעם אחת ושהו בתקופה — כמה פעמים, כמה לילות וכמה הכנסה.',
    async build({ propertyId, from, to }) {
      const inRange = await soldInRange(propertyId, from, to);
      const ids = [...new Set(inRange.map((r) => String(r.primaryGuest)))];
      const all = await Reservation.find({ property: propertyId, primaryGuest: { $in: ids }, status: { $in: ['checked_out', 'in_house', 'checked_in', 'partially_checked_out'] } }).select('primaryGuest nights totalAmount departureDate').lean();
      const per = new Map();
      for (const r of all) { const k = String(r.primaryGuest); if (!per.has(k)) per.set(k, { stays: 0, nights: 0, revenue: 0, last: '' }); const x = per.get(k); x.stays += 1; x.nights += r.nights || 0; x.revenue += Number(r.totalAmount || 0); if (r.departureDate > x.last) x.last = r.departureDate; }
      const guests = new Map((await GuestProfile.find({ _id: { $in: ids } }).select('firstName lastName vipLevel marketingConsent email phone').lean()).map((g) => [String(g._id), g]));
      const rows = [...per.entries()].filter(([, x]) => x.stays >= 2).map(([k, x]) => { const g = guests.get(k) || {}; return { guest: nameOf(g), stays: x.stays, nights: x.nights, revenue: r2(x.revenue), lastStay: x.last, vip: g.vipLevel > 0 ? 'כן' : '', consent: g.marketingConsent ? 'כן' : 'לא', contact: g.marketingConsent ? g.email || g.phone || '—' : '—' }; }).sort((a, b) => b.stays - a.stays || b.revenue - a.revenue);
      return {
        summary: [{ label: 'אורחים חוזרים', value: rows.length, type: 'int' }, { label: 'מכלל האורחים בתקופה', value: pct(rows.length, ids.length), type: 'pct' }, { label: 'הכנסה מאורחים חוזרים', value: r2(sum(rows, 'revenue')), type: 'money' }],
        columns: [
          { key: 'guest', label: 'אורח', type: 'text' }, { key: 'stays', label: 'שהיות', type: 'int', total: 'sum' }, { key: 'nights', label: 'לילות', type: 'int', total: 'sum' }, { key: 'revenue', label: 'הכנסה כוללת', type: 'money', total: 'sum' },
          { key: 'lastStay', label: 'שהייה אחרונה', type: 'date' }, { key: 'vip', label: 'VIP', type: 'text' }, { key: 'consent', label: 'הסכמה לדיוור', type: 'text' }, { key: 'contact', label: 'פרטי קשר (רק עם הסכמה)', type: 'ltr' },
        ],
        rows,
      };
    },
  },
  {
    code: 'birthdays', name: 'ימי הולדת קרובים', group: 'אורחים ושיווק', period: 'ahead', defaultPeriod: 'next30',
    description: 'אורחים שיש להם יום הולדת בתקופה — לברכה או להצעה. פרטי קשר מוצגים רק למי שהסכים לדיוור.',
    async build({ propertyId, from, to }) {
      const guests = await GuestProfile.find({ property: propertyId, dateOfBirth: { $ne: null } }).select('firstName lastName dateOfBirth marketingConsent email phone vipLevel lastStay').lean();
      const days = eachDay(from, to);
      const mmdd = new Map(days.map((d) => [d.slice(5), d]));
      const upcoming = await Reservation.find({ property: propertyId, status: { $in: SOLD }, primaryGuest: { $in: guests.map((g) => g._id) }, departureDate: { $gt: from }, arrivalDate: { $lte: to } }).select('primaryGuest arrivalDate departureDate').lean();
      const stayBy = new Map(upcoming.map((r) => [String(r.primaryGuest), r]));
      const rows = guests.map((g) => { const b = new Date(g.dateOfBirth).toISOString().slice(0, 10); const d = mmdd.get(b.slice(5)); if (!d) return null; const s = stayBy.get(String(g._id)); return { date: d, guest: nameOf(g), age: Number(d.slice(0, 4)) - Number(b.slice(0, 4)), inHouse: s && s.arrivalDate <= d && s.departureDate > d ? 'שוהה במלון ביום ההולדת' : s ? 'יש הזמנה בתקופה' : '—', vip: g.vipLevel > 0 ? 'כן' : '', contact: g.marketingConsent ? g.email || g.phone || '—' : 'ללא הסכמה' }; }).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));
      return {
        summary: [{ label: 'ימי הולדת', value: rows.length, type: 'int' }, { label: 'שוהים במלון ביום ההולדת', value: rows.filter((r) => r.inHouse.startsWith('שוהה')).length, type: 'int' }],
        columns: [{ key: 'date', label: 'תאריך', type: 'date' }, { key: 'guest', label: 'אורח', type: 'text' }, { key: 'age', label: 'גיל', type: 'int' }, { key: 'inHouse', label: 'שהייה', type: 'text' }, { key: 'vip', label: 'VIP', type: 'text' }, { key: 'contact', label: 'פרטי קשר', type: 'text' }],
        rows,
      };
    },
  },
];

// Screens that already exist elsewhere — listed on the reports home so everything is in one place.
export const LINKED = [
  { name: 'הגעות היום', group: 'קבלה', to: '/pms/arrivals' },
  { name: 'עזיבות היום', group: 'קבלה', to: '/pms/departures' },
  { name: 'אורחים במלון', group: 'קבלה', to: '/pms/in-house' },
  { name: 'תור המתנה לחדר', group: 'קבלה', to: '/pms/arrival-queue' },
  { name: 'לוח זמינות חודשי', group: 'קבלה', to: '/pms/availability' },
  { name: 'מצב חדרים למשק בית', group: 'משק בית ותחזוקה', to: '/pms/housekeeping/status' },
  { name: 'דפי עבודה לחדרניות', group: 'משק בית ותחזוקה', to: '/pms/ops-reports?r=hk-sheets' },
  { name: 'תנועת חדרים', group: 'משק בית ותחזוקה', to: '/pms/ops-reports?r=hk-movement' },
  { name: 'תכנון כוח אדם', group: 'משק בית ותחזוקה', to: '/pms/ops-reports?r=hk-staffing' },
  { name: 'ארוחות היום', group: 'מטבח', to: '/pms/ops-reports?r=kitchen-daily' },
  { name: 'תחזית ארוחות', group: 'מטבח', to: '/pms/ops-reports?r=kitchen-forecast' },
  { name: 'רשימת סועדים', group: 'מטבח', to: '/pms/ops-reports?r=dining-list' },
  { name: 'אלרגיות ותזונה', group: 'מטבח', to: '/pms/ops-reports?r=dietary' },
  { name: 'קבוצות', group: 'מטבח', to: '/pms/ops-reports?r=groups' },
  { name: 'סגירת יום ודוח מנהל', group: 'כספים', to: '/pms/night-audit/report' },
  { name: 'יומן מסמכים, מע״מ, תקבולים וקופות', group: 'כספים', to: '/pms/fin/reports' },
  { name: 'חובות חברות (גיול)', group: 'כספים', to: '/pms/fin/receivables' },
  { name: 'ביצועים: הכנסה, תפוסה, ADR', group: 'הכנסות וסטטיסטיקה', to: '/pms/reports/performance' },
  { name: 'פנקס תיירים (מע״מ 0%)', group: 'חוקי ובטיחות', to: '/pms/reports/performance?tab=registry' },
  { name: 'ספריית אורחים', group: 'אורחים ושיווק', to: '/pms/guests' },
  { name: 'יומן פעולות במערכת', group: 'אורחים ושיווק', to: '/pms/admin/audit' },
];

export const GROUPS = ['קבלה', 'משק בית ותחזוקה', 'מטבח', 'כספים', 'הכנסות וסטטיסטיקה', 'חוקי ובטיחות', 'אורחים ושיווק'];

// ── Period resolution ─────────────────────────────────────────────────────
export function resolvePeriod(def, q, tz) {
  const today = todayYmdInTimezone(tz);
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  if (def.period === 'none') return { from: today, to: today };
  if (ok(q.from) && ok(q.to) && q.from <= q.to && daysBetween(q.from, q.to) <= 731) return { from: q.from, to: q.to };
  const p = q.preset || def.defaultPeriod;
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const presets = {
    today: [today, today], yesterday: [addDays(today, -1), addDays(today, -1)],
    last7: [addDays(today, -7), addDays(today, -1)], last30: [addDays(today, -30), addDays(today, -1)], last90: [addDays(today, -90), addDays(today, -1)],
    mtd: [monthStart, today], lastMonth: [`${lastMonthEnd.slice(0, 7)}-01`, lastMonthEnd],
    ytd: [`${today.slice(0, 4)}-01-01`, today],
    next7: [today, addDays(today, 6)], next30: [today, addDays(today, 29)], next90: [today, addDays(today, 89)],
  };
  const [from, to] = presets[p] || presets[def.defaultPeriod] || presets.mtd;
  return { from, to, preset: p };
}

// Reports with full ID numbers (the guest register) are for managers and audit only.
export const allowed = (def, role) => !def.roles || (role && def.roles.includes(role));

export function catalog(role = null) {
  return {
    groups: GROUPS,
    reports: REPORTS.filter((r) => allowed(r, role)).map((r) => ({ code: r.code, name: r.name, group: r.group, description: r.description, period: r.period, defaultPeriod: r.defaultPeriod || null })),
    linked: LINKED,
  };
}

export async function runReport({ propertyId, code, query = {}, role }) {
  const def = REPORTS.find((r) => r.code === code);
  if (!def) { const err = new Error('הדוח לא נמצא'); err.status = 404; throw err; }
  if (role !== 'system' && !allowed(def, role)) { const err = new Error('הדוח הזה פתוח להנהלה ולביקורת בלבד'); err.status = 403; throw err; }
  const property = await Property.findById(propertyId).select('name timezone').lean();
  const tz = property?.timezone || 'Asia/Jerusalem';
  const period = resolvePeriod(def, query, tz);
  const data = await def.build({ propertyId: String(propertyId), from: period.from, to: period.to, tz });
  return { code, name: def.name, group: def.group, description: def.description, periodType: def.period, period, generatedAt: new Date(), propertyName: property?.name || '', ...data };
}

// Flat rows for files: header row of labels, then values in column order (numbers stay numbers).
export function toTable(report) {
  const header = report.columns.map((c) => c.label);
  const body = report.rows.map((r) => report.columns.map((c) => {
    const v = r[c.key];
    if (v === null || v === undefined) return '';
    if (c.type === 'datetime') return new Date(v).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
    if (c.type === 'date') return String(v).split('-').reverse().join('/');
    return v;
  }));
  const totals = report.columns.some((c) => c.total) ? [report.columns.map((c, i) => (i === 0 ? 'סה״כ' : c.total === 'sum' ? r2(sum(report.rows, c.key)) : ''))] : [];
  return [header, ...body, ...totals];
}
