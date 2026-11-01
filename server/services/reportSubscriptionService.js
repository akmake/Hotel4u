// Scheduled report e-mails (copied from Cloudbeds "Reporting → Subscriptions"): pick reports, a
// frequency (daily / weekly on chosen days / first day of the month), a send time in the hotel's own
// time zone, a format and recipients. Each run builds the reports from the same services the screens
// use and sends one e-mail with an Excel file (a sheet per report) or one CSV per report.
//
// Period rule: arrivals, departures and in-house are "today" at the hotel when the e-mail goes out;
// the money and performance reports cover what is finished — yesterday (daily), the 7 days up to
// yesterday (weekly), or the previous calendar month (monthly).
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import ReportSubscription, { RS_FREQUENCIES, RS_FORMATS } from '../models/ReportSubscription.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { sendEmail, buildReportSubscriptionEmail } from './emailService.js';
import { httpError, listArrivals } from './frontDeskService.js';
import { listDepartures, listInHouse } from './departureService.js';
import { receiptsReport, vatReport } from './financeReportsService.js';
import { dayReport } from './ledgerService.js';
import { REPORTS as CENTER, runReport as runCenter, toTable } from './reportCenter.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREQ_LABEL = { daily: 'יומי', weekly: 'שבועי', monthly: 'ביום הראשון בחודש' };
const DAY_LABEL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const dmy = (ymd) => (ymd ? ymd.split('-').reverse().join('/') : '');

// ── Time zone ─────────────────────────────────────────────────────────────
function tzOffsetMinutes(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime()) / 60000;
}
// The UTC instant of a wall-clock time at the hotel (handles daylight saving on both sides).
function zonedToUtc(ymd, hhmm, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  let t = Date.UTC(y, m - 1, d, h, mi);
  t -= tzOffsetMinutes(new Date(t), tz) * 60000;
  t = Date.UTC(y, m - 1, d, h, mi) - tzOffsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

export function nextRunAt(sub, tz, after = new Date()) {
  const today = todayYmdInTimezone(tz);
  for (let i = -1; i < 400; i += 1) {
    const day = addDays(today, i);
    const due = sub.frequency === 'daily'
      || (sub.frequency === 'weekly' && (sub.days || []).includes(weekday(day)))
      || (sub.frequency === 'monthly' && day.endsWith('-01'));
    if (!due) continue;
    const at = zonedToUtc(day, sub.time, tz);
    if (at > after) return at;
  }
  return null;
}

function periodFor(frequency, sendDay) {
  const yesterday = addDays(sendDay, -1);
  if (frequency === 'weekly') return { from: addDays(sendDay, -7), to: yesterday };
  if (frequency === 'monthly') {
    const firstThis = `${sendDay.slice(0, 7)}-01`;
    const lastPrev = addDays(firstThis, -1);
    return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
  }
  return { from: yesterday, to: yesterday };
}

// ── Report catalogue: each returns { columns, rows } ready for a sheet ────────
async function allPages(fetchPage) {
  const out = [];
  for (let page = 1; page < 50; page += 1) {
    const d = await fetchPage(page);
    out.push(...(d.rows || []));
    if (!d.pages || page >= d.pages) break;
  }
  return out;
}

export const REPORTS = {
  arrivals: {
    name: 'הגעות היום', group: 'יומי',
    async build({ propertyId, sendDay }) {
      const rows = await allPages((page) => listArrivals({ propertyId, date: sendDay, includeCheckedIn: true, page, pageSize: 100 }));
      return {
        columns: ['מספר הזמנה', 'אורח', 'VIP', 'סוג חדר', 'חדר', 'לילות', 'מבוגרים', 'ילדים', 'הגעה משוערת', 'מצב', 'בקשות'],
        rows: rows.map((r) => [r.confirmationNumber, r.guest.name, r.guest.vip ? 'כן' : '', r.roomType?.name || '', r.room?.number || '', r.nights, r.adults ?? '', r.children ?? '', r.eta || '', { ready: 'מוכן', waiting: 'ממתין', queued: 'בתור', blocked: 'חסום', checked_in: 'נכנס' }[r.readiness?.state] || '', [r.specialRequests, r.unitNotes].filter(Boolean).join(' · ')]),
      };
    },
  },
  departures: {
    name: 'עזיבות היום', group: 'יומי',
    async build({ propertyId, sendDay }) {
      const d = await listDepartures({ propertyId, date: sendDay });
      return {
        columns: ['מספר הזמנה', 'אורח', 'חדרים', 'עזיבה משוערת', 'יתרה לתשלום', 'יצא'],
        rows: (d.rows || []).map((r) => [r.confirmationNumber, r.guest?.name || '', (r.units || []).map((u) => u.room).filter(Boolean).join(', '), r.etd || '', Number(r.money?.owed || 0), r.checkedOutAt ? 'כן' : '']),
      };
    },
  },
  in_house: {
    name: 'אורחים במלון', group: 'יומי',
    async build({ propertyId }) {
      const rows = await allPages((page) => listInHouse({ propertyId, page, pageSize: 100 }));
      return {
        columns: ['מספר הזמנה', 'אורח', 'VIP', 'חדרים', 'סוג חדר', 'הגעה', 'עזיבה', 'מבוגרים', 'ילדים', 'יתרה'],
        rows: rows.map((r) => [r.confirmationNumber, r.guest?.name || '', r.guest?.vip ? 'כן' : '', (r.rooms || []).map((x) => x.number).join(', '), r.roomType || '', dmy(r.arrivalDate), dmy(r.departureDate), r.adults ?? '', r.children ?? '', Number(r.money?.owed ?? r.money?.balance ?? 0)]),
      };
    },
  },
  manager_flash: {
    name: 'דוח מנהל', group: 'ביצועים',
    async build({ propertyId, period }) {
      const r = await dayReport({ propertyId, date: period.to });
      const f = r.flash;
      const line = (label, k) => [label, f.day[k], f.mtd[k], f.ytd[k]];
      return {
        columns: [`נכון ל־${dmy(r.date)}`, 'היום', 'מתחילת החודש', 'מתחילת השנה'],
        rows: [
          line('ימים סגורים', 'days'), line('לילות שנמכרו', 'roomNights'), line('חדרים זמינים', 'sellable'), line('תפוסה %', 'occupancyPct'),
          line('ADR (מחיר ממוצע ללילה)', 'adr'), line('RevPAR', 'revpar'), line('הכנסות לינה', 'roomRevenue'), line('הכנסות אחרות', 'otherRevenue'),
          line('הגעות', 'arrived'), line('עזיבות', 'departed'), line('אי הגעה', 'noShows'),
        ],
        note: r.flash.day.days ? null : 'היום לא נסגר בסגירת יום — הנתונים מתעדכנים רק אחרי סגירה',
      };
    },
  },
  receipts: {
    name: 'תקבולים', group: 'כספים',
    async build({ propertyId, period }) {
      const r = await receiptsReport({ propertyId, from: period.from, to: period.to });
      return {
        columns: ['תאריך', 'סוג', 'אמצעי', 'סכום', 'אסמכתא', 'מספר הזמנה', 'אורח', 'נרשם ע״י'],
        rows: (r.rows || []).map((x) => [dmy(x.date), x.kind === 'refund' ? 'החזר' : 'תשלום', x.methodLabel || x.method, Number(x.amount || 0), x.reference || '', x.confirmationNumber || '', x.guest || '', x.by || '']),
      };
    },
  },
  vat: {
    name: 'עסקאות ומע״מ', group: 'כספים',
    async build({ propertyId, period }) {
      const r = await vatReport({ propertyId, from: period.from, to: period.to });
      const s = r.summary || {};
      return {
        columns: ['רכיב', 'סכום'],
        rows: [['עסקאות חייבות', s.standard || 0], ['עסקאות בשיעור אפס', s.zero || 0], ['פטורות', s.exempt || 0], ['מע״מ', s.vat || 0], ['סה״כ ברוטו', s.gross || 0], ['מסמכים', s.documents || 0], ['זיכויים', s.credits || 0]],
        note: r.note || null,
      };
    },
  },
};

export function catalog() {
  return [
    ...Object.entries(REPORTS).map(([code, r]) => ({ code, name: r.name, group: r.group })),
    ...CENTER.filter((r) => !REPORTS[r.code] && !r.roles).map((r) => ({ code: r.code, name: r.name, group: r.group })),
  ];
}
const reportName = (code) => REPORTS[code]?.name || CENTER.find((r) => r.code === code)?.name || code;

// A report-centre report inside a subscription: money/period reports take the subscription's
// period, forward-looking ones keep their own (next 30 days), "as of now" ones run as of now.
async function buildCenter(code, propertyId, period) {
  const def = CENTER.find((r) => r.code === code);
  const query = ['range', 'month'].includes(def.period) ? { from: period.from, to: period.to } : {};
  const report = await runCenter({ propertyId, code, query, role: 'system' });
  const [columns, ...rows] = toTable(report);
  return { columns, rows, note: report.note || null };
}

// ── Files ─────────────────────────────────────────────────────────────────
export async function buildFiles(sub, property, sendDay) {
  const period = periodFor(sub.frequency, sendDay);
  const built = [];
  for (const code of sub.reports) {
    const def = REPORTS[code];
    if (def) {
      built.push({ code, name: def.name, ...(await def.build({ propertyId: String(property._id), sendDay, period })) });
    } else if (CENTER.some((r) => r.code === code)) {
      built.push({ code, name: reportName(code), ...(await buildCenter(code, String(property._id), period)) });
    }
  }
  const stamp = sendDay.replace(/-/g, '');
  const aoa = (b) => [[b.name], ...(b.note ? [[b.note]] : []), [], b.columns, ...b.rows];
  if (sub.format === 'csv') {
    return {
      period, built,
      files: built.map((b) => ({ filename: `${b.code}-${stamp}.csv`, content: Buffer.from(`﻿${XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(aoa(b)))}`, 'utf8'), contentType: 'text/csv; charset=utf-8' })),
    };
  }
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const used = new Set();
  for (const b of built) {
    let sheet = b.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    while (used.has(sheet)) sheet = `${sheet.slice(0, 28)} ${used.size}`;
    used.add(sheet);
    const ws = XLSX.utils.aoa_to_sheet(aoa(b));
    ws['!cols'] = b.columns.map((c, i) => ({ wch: Math.min(40, Math.max(String(c).length, ...b.rows.map((r) => String(r[i] ?? '').length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, sheet);
  }
  return { period, built, files: [{ filename: `reports-${stamp}.xlsx`, content: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] };
}

// ── Run ───────────────────────────────────────────────────────────────────
export async function runSubscription(sub, { manual = false, actor = null } = {}) {
  const property = await Property.findById(sub.property).select('name timezone').lean();
  const tz = property?.timezone || 'Asia/Jerusalem';
  const sendDay = todayYmdInTimezone(tz);
  try {
    const { period, built, files } = await buildFiles(sub, property, sendDay);
    const msg = buildReportSubscriptionEmail({
      propertyName: property?.name, subject: sub.subject, number: sub.number,
      reports: built.map((b) => ({ name: b.name, count: b.rows.length })),
      periodLabel: period.from === period.to ? dmy(period.to) : `${dmy(period.from)}–${dmy(period.to)}`,
      sendDayLabel: dmy(sendDay), format: sub.format,
    });
    const out = await sendEmail({ to: sub.recipients.join(', '), ...msg, attachments: files });
    if (!out) throw new Error('שרת הדוא״ל לא מוגדר — לא נשלח');
    sub.lastStatus = 'sent'; sub.lastError = undefined;
  } catch (err) {
    sub.lastStatus = 'failed'; sub.lastError = String(err.message || err).slice(0, 300);
  }
  sub.lastRunAt = new Date();
  if (!manual) sub.nextRunAt = nextRunAt(sub, tz, new Date(Date.now() + 60000));
  await sub.save();
  await audit({ property: sub.property, actor: actor?.id || null, actorName: actor?.name || 'system', action: `report_subscription.${sub.lastStatus}`, entityType: 'ReportSubscription', entityId: sub._id, after: { number: sub.number, manual, error: sub.lastError || null, recipients: sub.recipients.length } }).catch(() => null);
  return sub;
}

// Scheduler tick: every subscription whose time came. A missed run (server down) goes once, late.
export async function runDueSubscriptions() {
  const due = await ReportSubscription.find({ active: true, nextRunAt: { $lte: new Date() } }).limit(50);
  for (const sub of due) await runSubscription(sub).catch((err) => console.error('[report-subscriptions]', err.message));
  return due.length;
}

// ── CRUD ──────────────────────────────────────────────────────────────────
function dto(s, tz) {
  return {
    id: String(s._id), number: s.number, subject: s.subject, reports: s.reports.map((code) => ({ code, name: reportName(code) })),
    frequency: s.frequency, frequencyLabel: s.frequency === 'weekly' ? `שבועי · ${s.days.slice().sort().map((d) => DAY_LABEL[d]).join(', ')}` : FREQ_LABEL[s.frequency],
    days: s.days, time: s.time, format: s.format, recipients: s.recipients, active: s.active,
    nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, lastStatus: s.lastStatus, lastError: s.lastError || null, timezone: tz,
  };
}

function validate(input) {
  const fields = {};
  const reports = Array.isArray(input.reports) ? [...new Set(input.reports.filter((c) => REPORTS[c] || CENTER.some((r) => r.code === c && !r.roles)))] : [];
  if (!reports.length) fields.reports = 'יש לבחור לפחות דוח אחד';
  if (reports.length > 15) fields.reports = 'עד 15 דוחות במנוי';
  if (!RS_FREQUENCIES.includes(input.frequency)) fields.frequency = 'יש לבחור תדירות';
  const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [];
  if (input.frequency === 'weekly' && !days.length) fields.days = 'יש לבחור לפחות יום אחד';
  if (!HHMM.test(String(input.time || ''))) fields.time = 'יש לבחור שעה';
  if (!RS_FORMATS.includes(input.format)) fields.format = 'יש לבחור פורמט';
  const subject = String(input.subject || '').trim().slice(0, 150);
  if (!subject) fields.subject = 'נדרשת שורת נושא';
  const recipients = Array.isArray(input.recipients) ? [...new Set(input.recipients.map((x) => String(x).trim().toLowerCase()).filter(Boolean))] : [];
  if (!recipients.length) fields.recipients = 'יש להוסיף לפחות נמען אחד';
  else if (recipients.some((r) => !EMAIL.test(r))) fields.recipients = 'כתובת דוא״ל לא תקינה';
  else if (recipients.length > 20) fields.recipients = 'עד 20 נמענים';
  if (Object.keys(fields).length) throw httpError('יש לתקן את פרטי המנוי', 422, { fields });
  return { reports, frequency: input.frequency, days: input.frequency === 'weekly' ? days : [], time: input.time, format: input.format, subject, recipients, active: input.active !== false };
}

async function tzOf(propertyId) {
  return (await Property.findById(propertyId).select('timezone').lean())?.timezone || 'Asia/Jerusalem';
}

export async function listSubscriptions({ propertyId }) {
  const tz = await tzOf(propertyId);
  const rows = await ReportSubscription.find({ property: propertyId }).sort({ number: -1 }).lean();
  return { catalog: catalog(), timezone: tz, rows: rows.map((s) => dto(s, tz)) };
}

export async function createSubscription({ propertyId, input, actor, ip }) {
  const v = validate(input);
  const tz = await tzOf(propertyId);
  const last = await ReportSubscription.findOne({ property: propertyId }).sort({ number: -1 }).select('number').lean();
  const sub = new ReportSubscription({ ...v, property: propertyId, number: (last?.number || 1000) + 1, createdByName: actor.name, updatedByName: actor.name });
  sub.nextRunAt = v.active ? nextRunAt(sub, tz) : null;
  await sub.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'report_subscription.created', entityType: 'ReportSubscription', entityId: sub._id, after: { number: sub.number, reports: v.reports, frequency: v.frequency, time: v.time, recipients: v.recipients.length }, ip });
  return dto(sub.toObject(), tz);
}

async function loadSub(propertyId, id) {
  if (!mongoose.isValidObjectId(String(id || ''))) throw httpError('מזהה לא תקין', 400);
  const sub = await ReportSubscription.findOne({ _id: id, property: propertyId });
  if (!sub) throw httpError('המנוי לא נמצא', 404);
  return sub;
}

export async function updateSubscription({ propertyId, id, input, actor, ip }) {
  const sub = await loadSub(propertyId, id);
  const v = validate(input);
  const tz = await tzOf(propertyId);
  Object.assign(sub, v, { updatedByName: actor.name });
  sub.nextRunAt = v.active ? nextRunAt(sub, tz) : null;
  await sub.save();
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'report_subscription.updated', entityType: 'ReportSubscription', entityId: sub._id, after: { number: sub.number, reports: v.reports, frequency: v.frequency, time: v.time, active: v.active }, ip });
  return dto(sub.toObject(), tz);
}

export async function deleteSubscription({ propertyId, id, actor, ip }) {
  const sub = await loadSub(propertyId, id);
  await ReportSubscription.deleteOne({ _id: sub._id });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'report_subscription.deleted', entityType: 'ReportSubscription', entityId: sub._id, before: { number: sub.number, recipients: sub.recipients.length }, ip });
  return { deleted: true };
}

export async function sendNow({ propertyId, id, actor }) {
  const sub = await loadSub(propertyId, id);
  await runSubscription(sub, { manual: true, actor });
  return dto(sub.toObject(), await tzOf(propertyId));
}
