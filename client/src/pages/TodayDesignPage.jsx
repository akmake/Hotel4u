import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import DashboardPage from './DashboardPage';
import './ReceptionDesignPage.css';
import './TodayDesignPage.css';

const SKIN_STORAGE_KEY = 'hotel4u:today-design:skin:v3';
const SKINS = [
  { value: 'buttons', label: 'העיצוב שלך + כפתורי Material', note: 'הכול כמו שעיצבת; רק הכפתורים בנויים כמו ב־Material 3, בצבעים שבחרת' },
  { value: 'base', label: 'העיצוב שלך כמו שהוא', note: 'כרטיסי זכוכית, טבלה בכרטיסים וכפתור פעולה אחד, בלי שינוי' },
  { value: 'material', label: 'Material 3 מלא', note: 'כל הדף בצבעים, בטיפוגרפיה ובצורות של Material 3' },
];

const CHECKIN_STORAGE_KEY = 'hotel4u:today-design:checkin:v1';
const CHECKINS = [
  { value: 'current', label: 'הנוכחי', note: 'החלון הקיים, להשוואה' },
  { value: 'accordion', label: 'אקורדיון', note: 'המבנה הקיים — חלקים שנפתחים — בעיצוב המאושר' },
  { value: 'stepper', label: 'שלבים', note: 'פס התקדמות למעלה, שלב אחד בכל פעם' },
  { value: 'split', label: 'שלבים וסיכום', note: 'רשימת שלבים בצד, השלב באמצע, סיכום השהייה קבוע בצד השני' },
  { value: 'sheet', label: 'חלונית צד', note: 'נפתחת מהצד, כל החלקים פתוחים בגלילה אחת, האישור קבוע למטה' },
];

function savedCheckin() {
  try {
    const saved = localStorage.getItem(CHECKIN_STORAGE_KEY);
    return CHECKINS.some((c) => c.value === saved) ? saved : 'accordion';
  } catch { return 'accordion'; }
}

function savedSkin() {
  try {
    const saved = localStorage.getItem(SKIN_STORAGE_KEY);
    return SKINS.some((s) => s.value === saved) ? saved : 'buttons';
  } catch { return 'buttons'; }
}

// The real "today" screen (live data, dialogs, actions) in the configuration picked on the reception
// design page — glass summary, card-row table, one action per row — optionally in Material 3.
export default function TodayDesignPage() {
  const [skin, setSkin] = useState(savedSkin);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);
  const choose = (value) => {
    setSkin(value);
    try { localStorage.setItem(SKIN_STORAGE_KEY, value); } catch { /* The current visit still keeps the choice. */ }
  };
  const [checkin, setCheckin] = useState(savedCheckin);
  const chooseCheckin = (value) => {
    setCheckin(value);
    try { localStorage.setItem(CHECKIN_STORAGE_KEY, value); } catch { /* The current visit still keeps the choice. */ }
  };
  const close = () => { setOpen(false); buttonRef.current?.focus(); };
  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.querySelector('button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="reception-design-page today-skin" data-skin={skin} data-row-style="table" data-room-style="soft" data-surface-style="plain" dir="rtl">
      <button ref={buttonRef} type="button" className="today-skin-fab" aria-expanded={open} aria-controls="today-skin-panel" onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={18} /> מערכת עיצוב
      </button>
      {open && (
        <section ref={panelRef} id="today-skin-panel" className="today-skin-panel" role="dialog" aria-modal="false" aria-labelledby="today-skin-heading">
          <div className="today-skin-panel-head">
            <div><h2 id="today-skin-heading">דף "היום"</h2><p>נתוני המערכת · שינוי תצוגה בלבד</p></div>
            <button type="button" aria-label="סגירה" onClick={close}><X size={18} /></button>
          </div>
          <div className="today-skin-options" role="radiogroup" aria-label="מערכת עיצוב">
            {SKINS.map((s) => (
              <button key={s.value} type="button" role="radio" aria-checked={skin === s.value} onClick={() => choose(s.value)}>
                <strong>{s.label}</strong><small>{s.note}</small>
              </button>
            ))}
          </div>
          <div className="today-skin-options is-checkin" role="radiogroup" aria-label="מסך צ׳ק-אין">
            <span>מסך צ׳ק-אין (נפתח מ״צ׳ק-אין״ בשורת אורח)</span>
            {CHECKINS.map((c) => (
              <button key={c.value} type="button" role="radio" aria-checked={checkin === c.value} onClick={() => chooseCheckin(c.value)}>
                <strong>{c.label}</strong><small>{c.note}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      <DashboardPage summaryAppearance="glass" rowAppearance="table" assignAppearance="today" checkinAppearance={checkin} />
    </div>
  );
}
