import { todayYmdInTimezone } from './dateHelpers.js';
export const nextBusinessDate = (date) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
export function openBusinessDate(property) {
  return property?.dayClose?.businessDate || todayYmdInTimezone(property?.timezone || 'Asia/Jerusalem');
}
