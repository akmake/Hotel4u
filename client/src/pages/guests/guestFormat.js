// Shared words and formats for the guest directory and record, whatever the look.
export const TIER_LABELS = { 0: '', 1: 'VIP', 2: 'VVIP', 3: 'VVVIP', 4: 'Diamond', 5: 'Elite' };
export const STATUS_LABELS = {
  checked_out: 'עזב', in_house: 'בבית', checked_in: 'בבית', confirmed: 'מאושרת', tentative: 'טנטטיבית',
  cancelled: 'בוטלה', no_show: 'לא הגיע', partially_checked_in: 'בבית חלקית', partially_checked_out: 'יצא חלקית',
};
export const LOOKS = [
  { id: 'attio', label: 'Attio' },
  { id: 'folk', label: 'folk' },
  { id: 'sevenrooms', label: 'SevenRooms' },
];

export const fullName = (g) => `${g?.firstName || ''} ${g?.lastName || ''}`.trim() || 'אורח ללא שם';
export const initials = (g) => `${g?.firstName?.[0] || ''}${g?.lastName?.[0] || ''}` || '?';

// Each guest keeps one pale identity hue (stable from the id), so the same person looks the same everywhere.
export function hueOf(id) {
  let h = 0;
  for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
export const money = (n) => ILS.format(Number(n || 0));
export const dateShort = (d) => (d ? new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) : '—');
export const monthYear = (d) => (d ? new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(new Date(d)) : '—');

export function nightsOf(r) {
  if (!r?.arrivalDate || !r?.departureDate) return 0;
  return Math.max(0, Math.round((new Date(r.departureDate) - new Date(r.arrivalDate)) / 86400000));
}

// How long ago, in words a desk would use.
export function since(d) {
  if (!d) return 'לא ביקר עדיין';
  const days = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (days < 1) return 'היום';
  if (days < 31) return `לפני ${days} ימים`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return months === 1 ? 'לפני חודש' : `לפני ${months} חודשים`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'לפני שנה' : `לפני ${years} שנים`;
}

// A one-line portrait of the guest from what we know.
export function portrait(g) {
  const stays = g?.totalStays || 0;
  const bits = [];
  if (g?.company) bits.push(g.company);
  bits.push(stays > 1 ? `אורח חוזר · ${stays} שהיות` : stays === 1 ? 'שהייה אחת' : 'טרם שהה');
  return bits.join(' · ');
}
