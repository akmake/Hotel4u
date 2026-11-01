import { create } from 'zustand';

// Design-time choice of how the main navigation looks. Kept in the browser only.
const KEY = 'hotel4u:nav-style:v1';

export const NAV_STYLES = [
  { value: 'rail', label: 'מסילה' },
  { value: 'launcher', label: 'משגר' },
];

const read = () => {
  try {
    const saved = localStorage.getItem(KEY);
    return NAV_STYLES.some((o) => o.value === saved) ? saved : 'rail';
  } catch { return 'rail'; }
};

export const useNavStyle = create((set) => ({
  style: read(),
  setStyle: (style) => {
    try { localStorage.setItem(KEY, style); } catch { /* The current visit still keeps the choice. */ }
    set({ style });
  },
}));
