// Keyboard shortcuts of the PMS (gap-map item 8). One table drives the key handler, the shortcuts
// screen, the menu tooltips and the quick bar. F5 / F11 / F12 stay with the browser (refresh, full
// screen, developer tools); F7 too, since the browser keeps it for caret browsing.
// action → a quick look opened in place; path → a screen.
export const SHORTCUTS = [
  { key: 'F1', label: 'עזרה למסך הזה', action: 'help' },
  { key: 'F2', label: 'חיפוש הזמנה', path: '/pms/reservations' },
  { key: 'F3', label: 'זמינות', path: '/pms/availability' },
  { key: 'F4', label: 'שוהים', path: '/pms/in-house' },
  { key: 'F6', label: 'הגעות', path: '/pms/arrivals' },
  { key: 'F8', label: 'עזיבות', path: '/pms/departures' },
  { key: 'F9', label: 'חיפוש חדר פנוי', action: 'free' },
  { key: 'F10', label: 'הזמנה חדשה', path: '/pms/reservations/new' },
  { key: 'Shift+F2', label: 'חשבונות אורח', path: '/pms/folio' },
  { key: 'Shift+F3', label: 'מבט שבועי', action: 'week' },
  { key: 'Shift+F4', label: 'מצב הבית וזמינות מקסימלית', action: 'house' },
  { key: 'Shift+F6', label: 'תור המתנה לחדר', path: '/pms/arrival-queue' },
  { key: 'Shift+F8', label: 'לוח חדרים', path: '/pms/tape-chart-classic' },
  { key: 'Shift+F9', label: 'חדרנות', path: '/pms/housekeeping' },
  { key: 'Shift+F10', label: 'תקשורת קבלה ומרכזנית', path: '/pms/desk' },
  { key: 'Ctrl+Z', label: 'שערי מטבע', action: 'rates', note: 'כשהסמן לא בשדה הקלדה (בשדה — ביטול הקלדה כרגיל)' },
  { key: 'Alt+F7', label: 'החלפת משתמש זמנית', action: 'switch' },
  { key: '/', label: 'חיפוש אורח או הזמנה', action: 'search', note: 'כשהסמן לא בשדה הקלדה' },
  { key: 'Shift+?', label: 'רשימת הקיצורים', action: 'shortcuts', note: 'כשהסמן לא בשדה הקלדה' },
];

export const BROWSER_KEYS = [
  { key: 'F5', label: 'רענון הדף (של הדפדפן)' },
  { key: 'F7', label: 'נשאר לדפדפן' },
  { key: 'F11', label: 'מסך מלא (של הדפדפן)' },
  { key: 'F12', label: 'כלי מפתחים (של הדפדפן)' },
];

// The key of an event in the table's notation.
export function keyOf(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  const k = e.key === '?' ? '?' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.shiftKey && (/^F\d+$/.test(k) || k === '?')) parts.push('Shift');
  parts.push(k);
  return parts.join('+');
}

export const shortcutFor = (pathOrAction) => SHORTCUTS.find((s) => s.path === pathOrAction || s.action === pathOrAction)?.key || null;
