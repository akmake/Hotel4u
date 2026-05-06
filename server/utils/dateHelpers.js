// server/utils/dateHelpers.js

/**
 * מוסיף מספר חודשים לתאריך נתון.
 * מטפל במקרי קצה כמו הוספת חודש ל-31 בינואר.
 * @param {Date} baseDate - תאריך ההתחלה
 * @param {number} months - מספר החודשים להוספה
 * @returns {Date} - התאריך החדש
 */
export function add_months(baseDate, months) {
  const d = new Date(baseDate);
  const originalDay = d.getDate();

  // setMonth מטפל אוטומטית במעבר לשנה הבאה
  d.setMonth(d.getMonth() + months);

  // אם היום בחודש השתנה (למשל, הוספת חודש ל-31.1 הפכה ל-2.3 במקום סוף פברואר),
  // אנחנו מתקנים את זה ליום האחרון של החודש הקודם.
  if (d.getDate() !== originalDay) {
    d.setDate(0);
  }
  return d;
}

/**
 * Format a date as YYYY-MM-DD in a specific IANA timezone.
 * Falls back to UTC ISO date if timezone formatting fails.
 */
export function ymdInTimezone(dateValue = new Date(), timezone = 'UTC') {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().split('T')[0];
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch (err) {
    // Invalid timezone or Intl failure; fallback below.
  }

  return date.toISOString().split('T')[0];
}

export function todayYmdInTimezone(timezone = 'UTC') {
  return ymdInTimezone(new Date(), timezone);
}
