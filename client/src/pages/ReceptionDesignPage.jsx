import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import DashboardPage from './DashboardPage';
import './ReceptionDesignPage.css';

const STORAGE_KEY = 'hotel4u:reception-design:v1';
const APPEARANCES = [{ value: 'soft', label: 'רך ומעוגל' }, { value: 'layered', label: 'שכבתי' },
  { value: 'flag', label: 'דגל' }, { value: 'bar', label: 'סרגל' }, { value: 'poster', label: 'כרזה' },
  { value: 'glass', label: 'זכוכית חלב' }, { value: 'ledger', label: 'מספר ופירוט' }, { value: 'ink', label: 'כרטיס פעיל כהה' }, { value: 'strip', label: 'פס מאוחד' }];
const ROW_STORAGE_KEY = 'hotel4u:reception-design:rows:v1';
const ROW_APPEARANCES = [
  { value: 'continuous', label: 'טבלה קומפקטית' },
  { value: 'table', label: 'טבלה מוגמרת' },
  { value: 'grid', label: 'כרטיסים ברשת' },
  { value: 'grouped', label: 'לפי מצב' },
  { value: 'ticket', label: 'כרטיס חדר' },
  { value: 'people', label: 'כרטיסי אורח' },
  { value: 'board', label: 'לוח לפי מצב' },
  { value: 'rail', label: 'פס צבע' },
  { value: 'split', label: 'כרטיס מפוצל' },
];
const ROOM_STORAGE_KEY = 'hotel4u:reception-design:rooms:v1';
const ROOM_APPEARANCES = [
  { value: 'soft', label: 'כרטיסים רכים' },
  { value: 'compact', label: 'רשימת חדרים' },
  { value: 'tiles', label: 'אריחי חדרים' },
  { value: 'door', label: 'שלט דלת' },
  { value: 'carousel', label: 'קרוסלה' },
  { value: 'spine', label: 'עמוד צבע' },
];
const SURFACE_STORAGE_KEY = 'hotel4u:reception-design:surfaces:v1';
const SURFACE_APPEARANCES = [
  { value: 'structured', label: 'הפרדה בין אזורים' },
  { value: 'plain', label: 'ללא הפרדה' },
  { value: 'floating', label: 'צף' },
  { value: 'tray', label: 'מגש' },
  { value: 'ruled', label: 'קווים' },
];

const ASSIGN_STORAGE_KEY = 'hotel4u:reception-design:assign:v2';
const ASSIGN_APPEARANCES = [
  { value: 'current', label: 'הנוכחי' },
  { value: 'sheet', label: 'חלונית צד · TravelPerk' },
  { value: 'seatmap', label: 'מפת חדרים · KAYAK' },
  { value: 'twopane', label: 'שני חלקים · Apple' },
  { value: 'quick', label: 'בחירה מהירה · Jira' },
];

function savedAssignAppearance() {
  try {
    const saved = localStorage.getItem(ASSIGN_STORAGE_KEY);
    return ASSIGN_APPEARANCES.some((option) => option.value === saved) ? saved : 'current';
  } catch { return 'current'; }
}

const CANVAS_STORAGE_KEY ='hotel4u:reception-design:canvas:v1';
const CANVAS_DEFAULT = { level: 12, color: '#808080' };

function savedCanvas() {
  try {
    const saved = JSON.parse(localStorage.getItem(CANVAS_STORAGE_KEY));
    if (saved && typeof saved.level === 'number' && /^#[0-9a-f]{6}$/i.test(saved.color)) return { level: Math.min(60, Math.max(0, saved.level)), color: saved.color };
  } catch { /* Fall back to the default. */ }
  return CANVAS_DEFAULT;
}

function savedAppearance() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return APPEARANCES.some((option) => option.value === saved) ? saved : 'soft';
  } catch { return 'soft'; }
}

function savedRowAppearance() {
  try {
    const saved = localStorage.getItem(ROW_STORAGE_KEY);
    return ROW_APPEARANCES.some((option) => option.value === saved) ? saved : 'continuous';
  } catch { return 'continuous'; }
}

function savedRoomAppearance() {
  try {
    const saved = localStorage.getItem(ROOM_STORAGE_KEY);
    return ROOM_APPEARANCES.some((option) => option.value === saved) ? saved : 'soft';
  } catch { return 'soft'; }
}

function savedSurfaceAppearance() {
  try {
    const saved = localStorage.getItem(SURFACE_STORAGE_KEY);
    return SURFACE_APPEARANCES.some((option) => option.value === saved) ? saved : 'structured';
  } catch { return 'structured'; }
}

// This page uses the actual reception screen and its property-scoped requests,
// dialogs and actions. Only the explicitly selected presentation varies.
export default function ReceptionDesignPage() {
  const [appearance, setAppearance] = useState(savedAppearance);
  const [rowAppearance, setRowAppearance] = useState(savedRowAppearance);
  const [roomAppearance, setRoomAppearance] = useState(savedRoomAppearance);
  const [surfaceAppearance, setSurfaceAppearance] = useState(savedSurfaceAppearance);
  const [canvas, setCanvas] = useState(savedCanvas);
  const pageRef = useRef(null);
  const canvasBackground = `color-mix(in srgb, ${canvas.color} ${canvas.level}%, white)`;
  useEffect(() => {
    const host = pageRef.current?.closest('.page-content');
    if (!host) return undefined;
    host.style.background = canvasBackground;
    return () => { host.style.background = ''; };
  }, [canvasBackground]);
  const chooseCanvas = (next) => {
    setCanvas(next);
    try { localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(next)); } catch { /* The current visit still keeps the choice. */ }
  };
  const activeSurfaceAppearance = SURFACE_APPEARANCES.some((option) => option.value === surfaceAppearance) ? surfaceAppearance : 'structured';
  const choose = (value) => {
    setAppearance(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Keep the choice for this visit when storage is unavailable. */ }
  };
  const chooseRows = (value) => {
    setRowAppearance(value);
    try { localStorage.setItem(ROW_STORAGE_KEY, value); } catch { /* The current visit still keeps the choice. */ }
  };
  const chooseRooms = (value) => {
    setRoomAppearance(value);
    try { localStorage.setItem(ROOM_STORAGE_KEY, value); } catch { /* The current visit still keeps the choice. */ }
  };
  const chooseSurfaces = (value) => {
    setSurfaceAppearance(value);
    try { localStorage.setItem(SURFACE_STORAGE_KEY, value); } catch { /* The current visit still keeps the choice. */ }
  };
  const [assignAppearance, setAssignAppearance] = useState(savedAssignAppearance);
  const chooseAssign = (value) => {
    setAssignAppearance(value);
    try { localStorage.setItem(ASSIGN_STORAGE_KEY, value); } catch { /* The current visit still keeps the choice. */ }
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
    <div className="reception-design-page" ref={pageRef} data-row-style={rowAppearance} data-room-style={roomAppearance} data-surface-style={activeSurfaceAppearance} dir="rtl">
      <button ref={settingsButtonRef} type="button" className="reception-design-fab" aria-expanded={settingsOpen} aria-controls="reception-design-settings" onClick={() => setSettingsOpen(!settingsOpen)}>
        <SlidersHorizontal size={18} /> הגדרות עיצוב
      </button>
      {settingsOpen && <section ref={settingsRef} id="reception-design-settings" className="reception-design-settings" role="dialog" aria-modal="false" aria-labelledby="reception-design-heading">
        <div className="reception-design-settings-heading">
          <div><h2 id="reception-design-heading">עיצוב מסך הקבלה</h2><p>שינויים לתצוגה בלבד · נתוני המערכת</p></div>
          <button type="button" aria-label="סגירת הגדרות העיצוב" onClick={closeSettings}><X size={18} /></button>
        </div>
        <div className="reception-design-options" role="group" aria-label="צורת הכרטיסים">
          <span>שלב 1 · כרטיסי הסיכום</span>
          {APPEARANCES.map((option) => <button key={option.value} type="button" aria-pressed={appearance === option.value} onClick={() => choose(option.value)}>{option.label}</button>)}
        </div>
        <div className="reception-design-options" role="group" aria-label="צורת רשימת האורחים">
          <span>שלב 2 · רשימת האורחים</span>
          {ROW_APPEARANCES.map((option) => <button key={option.value} type="button" aria-pressed={rowAppearance === option.value} onClick={() => chooseRows(option.value)}>{option.label}</button>)}
        </div>
        <div className="reception-design-options" role="group" aria-label="צורת אזור החדרים">
          <span>שלב 3 · החדרים<a className="reception-design-jump" href="#reception-design-rooms">הצגת החדרים ↓</a></span>
          {ROOM_APPEARANCES.map((option) => <button key={option.value} type="button" aria-pressed={roomAppearance === option.value} onClick={() => chooseRooms(option.value)}>{option.label}</button>)}
        </div>
        <div className="reception-design-options" role="group" aria-label="הפרדה מהרקע">
          <span>שלב 4 · הפרדה מהרקע</span>
          {SURFACE_APPEARANCES.map((option) => <button key={option.value} type="button" aria-pressed={activeSurfaceAppearance === option.value} onClick={() => chooseSurfaces(option.value)}>{option.label}</button>)}
        </div>
        <div className="reception-design-options" role="group" aria-label="רקע העמוד">
          <span>שלב 5 · רקע העמוד</span>
          <div className="reception-design-canvas">
            <label>אפרוריות<input type="range" min="0" max="60" value={canvas.level} onChange={(e) => chooseCanvas({ ...canvas, level: Number(e.target.value) })} /><b>{canvas.level}</b></label>
            <label>גוון<input type="color" value={canvas.color} onChange={(e) => chooseCanvas({ ...canvas, color: e.target.value })} /></label>
            <button type="button" onClick={() => chooseCanvas(CANVAS_DEFAULT)}>איפוס</button>
          </div>
        </div>
        <div className="reception-design-options" role="group" aria-label="חלון שיבוץ חדר">
          <span>שלב 6 · חלון שיבוץ חדר (נפתח מ״שיבוץ חדר״)</span>
          {ASSIGN_APPEARANCES.map((option) => <button key={option.value} type="button" aria-pressed={assignAppearance === option.value} onClick={() => chooseAssign(option.value)}>{option.label}</button>)}
        </div>
        <p className="reception-design-settings-note">הבחירות נשמרות בעמוד העיצוב. סגור את הפאנל להשוואה על המסך המלא.</p>
      </section>}
      <DashboardPage summaryAppearance={appearance} rowAppearance={rowAppearance} assignAppearance={assignAppearance} />
    </div>
  );
}
