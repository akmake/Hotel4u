import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import AvailabilityPage from './inv/AvailabilityPage';
import './AvailabilityDesignPage.css';

// The three calendar structures from the impeccable round (2026-11-01), side by side with the current board.
const LAYOUT_STORAGE_KEY = 'hotel4u:availability-design:layout:v1';
const LAYOUTS = [
  { value: 'current', label: 'הנוכחי' },
  { value: 'original', label: 'המקורי + עקומת החודש' },
  { value: 'curve', label: 'עקומת החודש מעל הלוח' },
  { value: 'weeks', label: 'שבועות עם סיכום שבועי' },
  { value: 'two-months', label: 'שני חודשים זה לצד זה' },
];

function savedLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return LAYOUTS.some((option) => option.value === saved) ? saved : 'current';
  } catch { return 'current'; }
}

// Uses the real availability page (live month data, selection panel, booking and block actions).
// Only the chosen structure varies.
export default function AvailabilityDesignPage() {
  const [layout, setLayout] = useState(savedLayout);
  const chooseLayout = (value) => {
    setLayout(value);
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, value); } catch { /* The current visit still keeps the choice. */ }
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
    <div className="availability-design-page" dir="rtl">
      <button ref={settingsButtonRef} type="button" className="availability-design-fab" aria-expanded={settingsOpen} aria-controls="availability-design-settings" onClick={() => setSettingsOpen(!settingsOpen)}>
        <SlidersHorizontal size={18} /> הגדרות עיצוב
      </button>
      {settingsOpen && <section ref={settingsRef} id="availability-design-settings" className="availability-design-settings" role="dialog" aria-modal="false" aria-labelledby="availability-design-heading">
        <div className="availability-design-settings-heading">
          <div><h2 id="availability-design-heading">עיצוב לוח הזמינות</h2><p>שינויים לתצוגה בלבד · נתוני המערכת</p></div>
          <button type="button" aria-label="סגירת הגדרות העיצוב" onClick={closeSettings}><X size={18} /></button>
        </div>
        <div className="availability-design-options" role="group" aria-label="מבנה הלוח">
          <span>מבנה הלוח</span>
          {LAYOUTS.map((option) => <button key={option.value} type="button" aria-pressed={layout === option.value} onClick={() => chooseLayout(option.value)}>{option.label}</button>)}
        </div>
        <p className="availability-design-settings-note">הבחירה נשמרת בעמוד העיצוב. סגור את הפאנל להשוואה על הלוח המלא.</p>
      </section>}
      <AvailabilityPage layout={layout} />
    </div>
  );
}
