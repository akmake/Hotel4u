import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import AvailabilityPage from './inv/AvailabilityPage';
import './AvailabilityDesignPage.css';

const DAY_STORAGE_KEY = 'hotel4u:availability-design:days:v2';
const DAY_APPEARANCES = [
  { value: 'detailed', label: 'הנוכחי' },
  { value: 'numeral', label: 'ספרה' },
  { value: 'fill', label: 'מילוי' },
  { value: 'ring', label: 'טבעת' },
];

const FRAME_STORAGE_KEY = 'hotel4u:availability-design:frame:v1';
const FRAME_APPEARANCES = [
  { value: 'current', label: 'הנוכחי' },
  { value: 'tiles', label: 'אריחים' },
  { value: 'strips', label: 'פסי שבועות' },
];

function savedFrame() {
  try {
    const saved = localStorage.getItem(FRAME_STORAGE_KEY);
    return FRAME_APPEARANCES.some((option) => option.value === saved) ? saved : 'current';
  } catch { return 'current'; }
}

function savedDayAppearance() {
  try {
    const saved = localStorage.getItem(DAY_STORAGE_KEY);
    return DAY_APPEARANCES.some((option) => option.value === saved) ? saved : 'detailed';
  } catch { return 'detailed'; }
}

// Uses the real availability page (live month data, selection panel, booking and block actions).
// Only the explicitly selected presentation varies.
export default function AvailabilityDesignPage() {
  const [dayAppearance, setDayAppearance] = useState(savedDayAppearance);
  const [frame, setFrame] = useState(savedFrame);
  const chooseFrame = (value) => {
    setFrame(value);
    try { localStorage.setItem(FRAME_STORAGE_KEY, value); } catch { /* The current visit still keeps the choice. */ }
  };
  const chooseDays = (value) => {
    setDayAppearance(value);
    try { localStorage.setItem(DAY_STORAGE_KEY, value); } catch { /* The current visit still keeps the choice. */ }
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const settingsButtonRef = useRef(null);
  const closeSettings = () => { setSettingsOpen(false); settingsButtonRef.current?.focus(); };
  useEffect(() => {
    if (!settingsOpen) return undefined;
    settingsRef.current?.querySelector('button')?.focus();
    const onKey = (event) => { if (event.key === 'Escape') closeSettings(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  return (
    <div className="availability-design-page" data-day-style={dayAppearance} data-frame={frame} dir="rtl">
      <button ref={settingsButtonRef} type="button" className="availability-design-fab" aria-expanded={settingsOpen} aria-controls="availability-design-settings" onClick={() => setSettingsOpen(!settingsOpen)}>
        <SlidersHorizontal size={18} /> הגדרות עיצוב
      </button>
      {settingsOpen && <section ref={settingsRef} id="availability-design-settings" className="availability-design-settings" role="dialog" aria-modal="false" aria-labelledby="availability-design-heading">
        <div className="availability-design-settings-heading">
          <div><h2 id="availability-design-heading">עיצוב לוח הזמינות</h2><p>שינויים לתצוגה בלבד · נתוני המערכת</p></div>
          <button type="button" aria-label="סגירת הגדרות העיצוב" onClick={closeSettings}><X size={18} /></button>
        </div>
        <div className="availability-design-options" role="group" aria-label="צורת תאי הימים">
          <span>שלב 1 · תאי הימים בלוח</span>
          {DAY_APPEARANCES.map((option) => <button key={option.value} type="button" aria-pressed={dayAppearance === option.value} onClick={() => chooseDays(option.value)}>{option.label}</button>)}
        </div>
        <div className="availability-design-options" role="group" aria-label="מסגרת הלוח">
          <span>שלב 2 · מסגרת הלוח</span>
          {FRAME_APPEARANCES.map((option) => <button key={option.value} type="button" aria-pressed={frame === option.value} onClick={() => chooseFrame(option.value)}>{option.label}</button>)}
        </div>
        <p className="availability-design-settings-note">הבחירות נשמרות בעמוד העיצוב. סגור את הפאנל להשוואה על הלוח המלא.</p>
      </section>}
      <AvailabilityPage />
    </div>
  );
}
