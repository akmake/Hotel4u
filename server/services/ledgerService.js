// Gap G4 — day-close ledgers, trial balance and manager flash report (FIN-12 reports).
//
// Accounting date of a line = the business day whose close it was posted before: a line posted
// after day D was closed belongs to D+1, never to D. Lines posted before the first close fall on
// the local calendar date of their posting. With that rule the books of a closed day can only
// change if a stored line is edited or removed afterwards — which is exactly what the opening
// check catches (opening of D must equal the closing stored when D-1 was closed).
//
// Ledgers at the end of a day (balance of each folio, by what the folio is at that moment):
//   guest   — stays in house, and departed stays whose balance was not moved to a company;
//   deposit — reservations that have not arrived yet (money received in advance);
//   ar      — balances moved to a company account at departure (city ledger);
//   void    — balances left on cancelled / no-show reservations (should be refunded or settled).
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import DayCloseRun from '../models/DayCloseRun.js';
import { codeMap, REVENUE_GROUP_LABELS } from './chargeCodeService.js';
import { httpError } from './frontDeskService.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const PRE_ARRIVAL = ['draft', 'quote', 'hold', 'pending_payment', 'confirmed', 'modified', 'waitlisted'];
const IN_HOUSE = ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'];
const VOID_STATUSES = ['cancelled', 'no_show'];
export const LEDGER_LABELS = { guest: 'יתרות שוהים ועוזבים (Guest Ledger)', deposit: 'הזמנות שטרם הגיעו — מקדמות וחיובים מראש (Deposit Ledger)', ar: 'חייבים — חברות (AR / City Ledger)', void: 'יתרות בהזמנות שבוטלו / לא הגיעו' };

function localDate(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}

// Returns (line) → business date, plus the open business date.
//  - a line falls on the local date it was posted;
//  - if that day was already closed when the line was posted, it moves to the next open day
//    (closing at 23:30 and posting at 23:45 → tomorrow), so a closed day never gains lines;
//  - room nights posted by a day-close run belong to the day that run closed.
export async function businessDateResolver(propertyId) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  if (!property) throw httpError('הנכס לא נמצא', 404);
  const tz = property.timezone || 'Asia/Jerusalem';
  const runs = await DayCloseRun.find({ property: propertyId, status: 'done' }).select('businessDate finishedAt updatedAt').sort({ businessDate: 1 }).lean();
  const closedAt = new Map(runs.map((r) => [r.businessDate, new Date(r.finishedAt || r.updatedAt).getTime()]));
  const byTime = [...closedAt.entries()].map(([date, at]) => ({ date, at })).sort((a, b) => a.at - b.at);
  const last = property.dayClose?.lastClosedDate || (runs.length ? runs[runs.length - 1].businessDate : null);
  const today = localDate(new Date(), tz);
  const nextToClose = last ? addDays(last, 1) : today;
  const openDate = nextToClose > today ? nextToClose : today;
  const resolve = (line) => {
    const t = new Date(line.postedAt || 0).getTime();
    if (line.source === 'night_audit') {
      const run = byTime.find((c) => c.at >= t);
      return run ? run.date : nextToClose;
    }
    let d = localDate(line.postedAt || new Date(0), tz);
    for (let guard = 0; guard < 400 && closedAt.has(d) && closedAt.get(d) < t; guard += 1) d = addDays(d, 1);
    return d;
  };
  return { resolve, openDate, nextToClose, lastClosed: last, tz };
}

const grossOf = (l) => Number(l.amount || 0) + Number(l.taxAmount || 0);

// Live computation of the books for one business date.
export async function computeLedger(propertyId, date) {
  if (!YMD.test(String(date || ''))) throw httpError('תאריך לא תקין', 422);
  const { resolve, openDate } = await businessDateResolver(propertyId);
  if (date > openDate) throw httpError('לא מפיקים דוח ליום עתידי', 422);
  const [folios, codes] = await Promise.all([
    Folio.find({ property: propertyId }).select('reservation ownerType status settlement lines.type lines.amount lines.taxAmount lines.status lines.postedAt lines.source lines.department lines.method lines.reversalOf').lean(),
    codeMap(propertyId),
  ]);
  const resIds = [...new Set(folios.map((f) => String(f.reservation)))];
  const reservations = await Reservation.find({ _id: { $in: resIds } }).select('status').lean();
  const statusOf = new Map(reservations.map((r) => [String(r._id), r.status]));

  let opening = 0; let closing = 0;
  const ledgers = { guest: 0, deposit: 0, ar: 0, void: 0 };
  const ledgerCounts = { guest: 0, deposit: 0, ar: 0, void: 0 };
  const revenue = new Map(); // code → { net, tax, gross, count }
  const paymentsBy = new Map(); // method → { amount, count }
  const refundsBy = new Map();
  const activity = { charges: 0, adjustments: 0, payments: 0, refunds: 0 };

  for (const f of folios) {
    let bal = 0;
    for (const l of f.lines || []) {
      if (l.status !== 'posted') continue;
      const bd = resolve(l);
      const g = grossOf(l);
      if (bd < date) opening += g;
      if (bd <= date) { closing += g; bal += g; }
      if (bd !== date) continue;
      if (['charge', 'fee', 'tax', 'adjustment', 'discount'].includes(l.type)) {
        const code = codes.alias(l.department || 'other');
        const r = revenue.get(code) || { net: 0, tax: 0, gross: 0, count: 0 };
        r.net += Number(l.amount || 0); r.tax += Number(l.taxAmount || 0); r.gross += g; r.count += 1;
        revenue.set(code, r);
        if (['adjustment', 'discount'].includes(l.type)) activity.adjustments += g; else activity.charges += g;
      } else if (['payment', 'deposit'].includes(l.type)) {
        const m = l.method || 'unknown';
        const p = paymentsBy.get(m) || { amount: 0, count: 0 };
        p.amount += -g; p.count += 1; paymentsBy.set(m, p);
        activity.payments += g;
      } else if (l.type === 'refund') {
        const m = l.method || 'unknown';
        const p = refundsBy.get(m) || { amount: 0, count: 0 };
        p.amount += g; p.count += 1; refundsBy.set(m, p);
        activity.refunds += g;
      }
    }
    bal = round2(bal);
    if (Math.abs(bal) < 0.005) continue;
    const st = statusOf.get(String(f.reservation));
    let book = 'guest';
    if (f.settlement?.mode === 'company_ar' || (f.ownerType === 'company' && st === 'checked_out')) book = 'ar';
    else if (VOID_STATUSES.includes(st)) book = 'void';
    else if (PRE_ARRIVAL.includes(st)) book = 'deposit';
    else if (IN_HOUSE.includes(st) || st === 'checked_out') book = 'guest';
    ledgers[book] += bal; ledgerCounts[book] += 1;
  }

  const revenueRows = [...revenue.entries()].map(([code, r]) => {
    const c = codes.charges.get(code);
    return { code, name: c?.name || code, revenueGroup: c?.revenueGroup || null, glAccount: c?.glAccount || null, mapped: !!c, net: round2(r.net), tax: round2(r.tax), gross: round2(r.gross), count: r.count };
  }).sort((a, b) => (a.revenueGroup || 'zz').localeCompare(b.revenueGroup || 'zz') || b.gross - a.gross);
  const groups = {};
  for (const r of revenueRows) {
    const k = r.revenueGroup || 'unmapped';
    groups[k] = groups[k] || { key: k, label: REVENUE_GROUP_LABELS[k] || 'לא מקוטלג', net: 0, tax: 0, gross: 0 };
    groups[k].net = round2(groups[k].net + r.net); groups[k].tax = round2(groups[k].tax + r.tax); groups[k].gross = round2(groups[k].gross + r.gross);
  }
  const methodRows = (map) => [...map.entries()].map(([m, p]) => ({ method: m, name: codes.payments.get(m)?.name || (m === 'unknown' ? 'לא צוין' : m), glAccount: codes.payments.get(m)?.glAccount || null, amount: round2(p.amount), count: p.count }))
    .sort((a, b) => b.amount - a.amount);

  const act = Object.fromEntries(Object.entries(activity).map(([k, v]) => [k, round2(v)]));
  return {
    date,
    trial: {
      opening: round2(opening),
      charges: act.charges, adjustments: act.adjustments,
      payments: round2(-act.payments), refunds: act.refunds,
      closing: round2(closing),
      // opening + charges + adjustments − payments + refunds must equal closing
      difference: round2(closing - (opening + act.charges + act.adjustments + act.payments + act.refunds)),
    },
    ledgers: Object.fromEntries(Object.entries(ledgers).map(([k, v]) => [k, { label: LEDGER_LABELS[k], balance: round2(v), folios: ledgerCounts[k] }])),
    revenue: { rows: revenueRows, groups: Object.values(groups), total: { net: round2(revenueRows.reduce((s, r) => s + r.net, 0)), tax: round2(revenueRows.reduce((s, r) => s + r.tax, 0)), gross: round2(revenueRows.reduce((s, r) => s + r.gross, 0)) } },
    payments: methodRows(paymentsBy),
    refunds: methodRows(refundsBy),
    unmappedCodes: revenueRows.filter((r) => !r.mapped).map((r) => r.code),
  };
}

// What day close stores (totals only — enough to compare the next opening against).
export function storedFrom(ledger) {
  return {
    trial: ledger.trial,
    ledgers: Object.fromEntries(Object.entries(ledger.ledgers).map(([k, v]) => [k, { balance: v.balance, folios: v.folios }])),
    revenue: { groups: ledger.revenue.groups, total: ledger.revenue.total },
    payments: ledger.payments.map(({ method, amount, count }) => ({ method, amount, count })),
    refunds: ledger.refunds.map(({ method, amount, count }) => ({ method, amount, count })),
    unmappedCodes: ledger.unmappedCodes,
  };
}

async function storedLedgerOf(propertyId, date) {
  const run = await DayCloseRun.findOne({ property: propertyId, businessDate: date, status: 'done' }).lean();
  const step = run?.steps?.find((s) => s.key === 'ledgers');
  return step?.result?.trial ? { run, stored: step.result } : { run, stored: null };
}

// Checks shown on the report and used by the day-close step.
export async function ledgerChecks(propertyId, ledger) {
  const checks = [];
  const prev = await storedLedgerOf(propertyId, addDays(ledger.date, -1));
  if (prev.stored) {
    const diff = round2(ledger.trial.opening - prev.stored.trial.closing);
    checks.push({
      key: 'opening', ok: Math.abs(diff) < 0.005, amount: diff,
      label: Math.abs(diff) < 0.005 ? 'יתרת הפתיחה שווה ליתרת הסגירה של היום הקודם' : `יתרת הפתיחה שונה ב־${diff.toFixed(2)} מהסגירה שנשמרה ב־${prev.run.runNo} — שורות של יום סגור שונו או נמחקו`,
    });
  } else {
    checks.push({ key: 'opening', ok: null, label: 'אין סגירה שמורה ליום הקודם — בדיקת פתיחה לא בוצעה' });
  }
  checks.push({ key: 'trial', ok: Math.abs(ledger.trial.difference) < 0.005, amount: ledger.trial.difference, label: Math.abs(ledger.trial.difference) < 0.005 ? 'מאזן הבוחן מאוזן' : `מאזן הבוחן לא מאוזן (${ledger.trial.difference.toFixed(2)})` });
  checks.push({ key: 'codes', ok: ledger.unmappedCodes.length === 0, label: ledger.unmappedCodes.length ? `חיובים בקודים שאינם בקטלוג: ${ledger.unmappedCodes.join(', ')}` : 'כל החיובים בקודים מהקטלוג' });
  checks.push({ key: 'void', ok: Math.abs(ledger.ledgers.void.balance) < 0.005, amount: ledger.ledgers.void.balance, label: Math.abs(ledger.ledgers.void.balance) < 0.005 ? 'אין יתרות בהזמנות שבוטלו' : `יתרה של ${ledger.ledgers.void.balance.toFixed(2)} ב־${ledger.ledgers.void.folios} הזמנות שבוטלו/לא הגיעו — להחזיר או לחייב` });
  return checks;
}

// Manager flash: day, month-to-date, year-to-date from the snapshots stored by day close.
async function flashFor(propertyId, date) {
  const runs = await DayCloseRun.find({ property: propertyId, status: 'done', businessDate: { $gte: `${date.slice(0, 4)}-01-01`, $lte: date } }).select('businessDate steps').lean();
  const sum = (from) => {
    const t = { days: 0, roomNights: 0, sellable: 0, roomRevenue: 0, otherRevenue: 0, arrived: 0, departed: 0, noShows: 0 };
    for (const r of runs) {
      if (r.businessDate < from) continue;
      const s = r.steps?.find((x) => x.key === 'snapshot')?.result;
      if (!s) continue;
      t.days += 1;
      for (const k of ['roomNights', 'sellable', 'roomRevenue', 'otherRevenue', 'arrived', 'departed', 'noShows']) t[k] += Number(s[k] || 0);
    }
    return {
      ...t, roomRevenue: round2(t.roomRevenue), otherRevenue: round2(t.otherRevenue),
      occupancyPct: t.sellable ? round2((t.roomNights / t.sellable) * 100) : 0,
      adr: t.roomNights ? round2(t.roomRevenue / t.roomNights) : 0,
      revpar: t.sellable ? round2(t.roomRevenue / t.sellable) : 0,
    };
  };
  return { day: sum(date), mtd: sum(`${date.slice(0, 7)}-01`), ytd: sum(`${date.slice(0, 4)}-01-01`) };
}

export async function dayReport({ propertyId, date }) {
  const { openDate, lastClosed } = await businessDateResolver(propertyId);
  const day = YMD.test(String(date || '')) ? date : (lastClosed || openDate);
  const { run, stored } = await storedLedgerOf(propertyId, day);
  const live = await computeLedger(propertyId, day);
  const checks = await ledgerChecks(propertyId, live);
  if (stored) {
    const diff = round2(live.trial.closing - stored.trial.closing);
    checks.push({ key: 'closed_changed', ok: Math.abs(diff) < 0.005, amount: diff, label: Math.abs(diff) < 0.005 ? 'הנתונים זהים למה שנשמר בסגירה' : `יתרת הסגירה שונה ב־${diff.toFixed(2)} ממה שנשמר בסגירה — היסטוריה שונתה` });
  }
  return {
    date: day, openDate, lastClosed,
    closed: !!run, runNo: run?.runNo || null, closedAt: run?.finishedAt || null, closedBy: run?.startedByName || null,
    ledger: live, stored, checks,
    flash: await flashFor(propertyId, day),
  };
}
