// Dates are plain "YYYY-MM-DD" strings (hotel calendar days), never UTC instants.
// Converting a local Date with toISOString() shifts the day in Israel (UTC+2/+3), so
// format from local parts and do day arithmetic in UTC.

/** Local calendar day of a Date as YYYY-MM-DD. */
export function toYmd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's local calendar day. Prefer this over TODAY in long-lived screens (it rolls over at midnight). */
export function todayYmd() {
  return toYmd(new Date());
}

export const TODAY = todayYmd();

const HE_MONTHS_S = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];
const HE_MONTHS_F = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HE_DAYS_S   = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שב׳'];
const HE_DAYS_F   = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

export function formatLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${HE_MONTHS_F[d.getMonth()]} ${d.getFullYear()}, יום ${HE_DAYS_F[d.getDay()]}`;
}

export function formatShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${HE_MONTHS_S[d.getMonth()]}`;
}

export function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return HE_DAYS_S[d.getDay()];
}

export function isWeekend(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  return dow === 5 || dow === 6;
}

export function rangeFromToday(daysBack, daysForward) {
  return { from: addDays(TODAY, -daysBack), to: addDays(TODAY, daysForward) };
}
