// Israeli rest days (ימי מנוחה) other than Saturday, from the Hebrew calendar: Rosh Hashanah (2 days),
// Yom Kippur, Sukkot (first day), Shemini Atzeret, Passover (first and seventh day) and Shavuot —
// the festivals the Days of Rest Ordinance lists. Used where a law counts "days that are not rest
// days" (consumer cancellation). Computed with the runtime's Hebrew calendar, no table to maintain.
const HEBREW = new Intl.DateTimeFormat('en-u-ca-hebrew', { month: 'long', day: 'numeric', timeZone: 'UTC' });
const FESTIVALS = new Set(['1 Tishri', '2 Tishri', '10 Tishri', '15 Tishri', '22 Tishri', '15 Nisan', '21 Nisan', '6 Sivan']);

export function hebrewDayOf(ymd) {
  return HEBREW.format(new Date(`${ymd}T12:00:00Z`));
}

export function isIsraeliHoliday(ymd) {
  return FESTIVALS.has(hebrewDayOf(ymd));
}

// Every festival rest day between two dates (inclusive), as YYYY-MM-DD.
export function israeliHolidaysBetween(from, to) {
  const out = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    const ymd = d.toISOString().slice(0, 10);
    if (isIsraeliHoliday(ymd)) out.push(ymd);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
