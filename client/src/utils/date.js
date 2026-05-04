export const TODAY = new Date().toISOString().split('T')[0];

const HE_MONTHS_S = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];
const HE_MONTHS_F = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HE_DAYS_S   = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שב׳'];
const HE_DAYS_F   = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export function diffDays(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
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
