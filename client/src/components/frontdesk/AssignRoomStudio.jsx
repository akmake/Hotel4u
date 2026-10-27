// Design-page alternatives for AssignRoomDialog, each rebuilt from a chosen product reference:
//   sheet    — TravelPerk "Rate details" side sheet: radio cards, "show other" disclosure, sticky footer.
//   seatmap  — KAYAK seat selection: tabbed map of squares, legend card, summary card, confirm.
//   twopane  — Apple availability modal: filters on one side, available cards on the other.
//   quick    — Jira assignee picker: a small searchable list at the click point, one click assigns.
// All four take the dialog's own state (candidates, selection, save), so the server path is unchanged.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, Search, CalendarDays, Moon, BedDouble, Sparkles, Wrench, ChevronDown, Hash } from 'lucide-react';
import { cleanLabel, opsLabel } from '../../lib/labels';
import { formatShort } from '../../utils/date';
import { Spinner, ErrorBanner, guestInitials } from '../kit';
import './AssignRoomStudio.css';

// The quick picker opens where the user clicked ("שיבוץ חדר" in the row).
let lastPointer = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
}

// ready: can enter now · prep: free for every night but needs preparing · blocked: cannot be assigned.
function roomState(c) {
  if (c.current) return 'current';
  if (!c.assignable) return 'blocked';
  return c.readyNow ? 'ready' : 'prep';
}

function headline(c) {
  const state = roomState(c);
  if (state === 'blocked') return c.conflict ? 'תפוס' : 'חסום';
  return { current: 'משובץ כעת', ready: 'מוכן לכניסה', prep: 'פנוי לכל הלילות' }[state];
}

function endNote(c, nights) {
  const state = roomState(c);
  if (state === 'current') return 'החדר הנוכחי בהזמנה';
  if (state === 'blocked') return c.conflict ? `הזמנה ${c.conflict}` : opsLabel(c.opsStatus);
  if (state === 'prep') return c.occupiedBy ? 'אורח קודם טרם יצא' : 'דורש ניקיון לפני כניסה';
  return `${nights} לילות ללא החלפה`;
}

const byNumber = (a, b) => String(a.number).localeCompare(String(b.number), 'he', { numeric: true });
const stayOf = (data) => (data ? `${formatShort(data.range.from)}–${formatShort(data.range.to)}` : '');

function confirmLabel(p) {
  if (p.saving) return <><Spinner /> שומר…</>;
  if (p.replacing) return p.chosen ? `החלפה לחדר ${p.chosen.number}` : 'החלפת שיבוץ';
  return p.chosen && !p.chosen.current ? `שיבוץ לחדר ${p.chosen.number}` : 'שיבוץ חדר';
}

function Notices({ p }) {
  return (
    <>
      {p.loadError && <ErrorBanner error={p.loadError} onRetry={p.onRetry} />}
      {p.saveError && <ErrorBanner error={p.saveError} />}
      {p.typeChange && <p className="as-note">שיבוץ לסוג חדר אחר אינו משנה את המחיר. שינוי תעריף מתבצע בשינוי הזמנה.</p>}
    </>
  );
}

function ReasonField({ p }) {
  return (
    <label className="as-reason">
      <span>סיבת החלפת השיבוץ</span>
      <input value={p.reason} maxLength={500} onChange={(e) => p.setReason(e.target.value)} aria-invalid={!!p.fieldErrors.reason} placeholder="למשל: בקשת האורח לקומה גבוהה" />
      {p.fieldErrors.reason && <em>{p.fieldErrors.reason}</em>}
    </label>
  );
}

function Loading() {
  return <div className="as-loading"><Spinner /> טוען חדרים…</div>;
}

function Shell({ p, className, children, overlay = 'ui-overlay', style }) {
  return (
    <DialogPrimitive.Root open={p.open} onOpenChange={(v) => { if (!v && !p.saving) p.onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlay} />
        <DialogPrimitive.Content className={className} style={style} dir="rtl" aria-describedby={undefined}
          onInteractOutside={(e) => { if (p.saving) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (p.saving) e.preventDefault(); }}>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── 1. Side sheet (TravelPerk) ──────────────────────────────────────────────
function RadioCard({ c, selected, onPick, nights }) {
  const state = roomState(c);
  return (
    <button type="button" role="radio" aria-checked={selected === c.id} disabled={state === 'blocked'} className={`as-rcard is-${state}`} onClick={() => onPick(c.id)}>
      <span className="as-radio" aria-hidden="true" />
      <span className="as-rcard-main">
        <b>חדר {c.number}</b>
        <span>{c.roomType?.name} · קומה {c.floor}{!c.sameType && <em>סוג אחר</em>}</span>
        <span className="as-rcard-icons">
          <span><Sparkles size={13} aria-hidden="true" />{cleanLabel(c.cleanStatus)}</span>
          <span><Wrench size={13} aria-hidden="true" />{opsLabel(c.opsStatus)}</span>
        </span>
      </span>
      <span className="as-rcard-end"><b>{headline(c)}</b><small>{endNote(c, nights)}</small></span>
    </button>
  );
}

function SheetView({ p }) {
  const [showMore, setShowMore] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const nights = p.data?.range.nights;
  const free = p.candidates.filter((c) => roomState(c) !== 'blocked');
  const blocked = p.candidates.filter((c) => roomState(c) === 'blocked');
  const [first, ...rest] = free;
  return (
    <Shell p={p} className="as-sheet" overlay="ui-overlay is-light">
      <header className="as-sheet-top">
        <DialogPrimitive.Title className="as-sheet-title">שיבוץ חדר</DialogPrimitive.Title>
        <DialogPrimitive.Close className="as-icon-btn" aria-label="סגירה" disabled={p.saving}><X size={18} /></DialogPrimitive.Close>
      </header>
      <div className="as-sheet-body">
        <div className="as-guest">
          <span className="as-guest-av" aria-hidden="true">{guestInitials(p.row?.guest?.name || '')}</span>
          <div>
            <h3>{p.row?.guest?.name}</h3>
            <div className="as-facts">
              <span><Hash size={14} aria-hidden="true" />{p.row?.confirmationNumber}</span>
              {p.data && <span><CalendarDays size={14} aria-hidden="true" />{stayOf(p.data)}</span>}
              {p.data && <span><Moon size={14} aria-hidden="true" />{nights} לילות</span>}
              {p.data && <span><BedDouble size={14} aria-hidden="true" />{p.data.roomType?.name}</span>}
            </div>
          </div>
        </div>
        <div className="as-sheet-filters">
          <label className="as-box-check"><input type="checkbox" checked={!p.allTypes} onChange={(e) => p.setAllTypes(!e.target.checked)} />הסוג שהוזמן</label>
          <label className="as-box-check"><input type="checkbox" checked={p.allTypes} onChange={(e) => p.setAllTypes(e.target.checked)} />כל הסוגים</label>
        </div>
        <Notices p={p} />
        {p.loading && !p.data ? <Loading /> : (
          <section className="as-sheet-rooms" aria-labelledby="as-sheet-rooms-h">
            <h3 id="as-sheet-rooms-h">חדרים <span>{stayOf(p.data)} · {nights} לילות</span></h3>
            {!first && <p className="as-empty">אין חדר פנוי לכל הלילות{p.allTypes ? '' : ' מהסוג שהוזמן'}.</p>}
            <div className="as-rcards" role="radiogroup" aria-label="חדרים פנויים">
              {first && <RadioCard c={first} selected={p.selected} onPick={p.setSelected} nights={nights} />}
              {rest.length > 0 && (
                <button type="button" className="as-disclose" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
                  {showMore ? 'הסתרת חדרים נוספים' : `הצגת ${rest.length} חדרים פנויים נוספים`}<ChevronDown size={15} aria-hidden="true" />
                </button>
              )}
              {showMore && rest.map((c) => <RadioCard key={c.id} c={c} selected={p.selected} onPick={p.setSelected} nights={nights} />)}
            </div>
            {blocked.length > 0 && (
              <>
                <button type="button" className="as-disclose is-muted" aria-expanded={showBlocked} onClick={() => setShowBlocked(!showBlocked)}>
                  {showBlocked ? 'הסתרת החדרים שאינם זמינים' : `${blocked.length} חדרים אינם זמינים לטווח`}<ChevronDown size={15} aria-hidden="true" />
                </button>
                {showBlocked && <div className="as-rcards">{blocked.map((c) => <RadioCard key={c.id} c={c} selected={p.selected} onPick={p.setSelected} nights={nights} />)}</div>}
              </>
            )}
          </section>
        )}
        {p.replacing && <ReasonField p={p} />}
      </div>
      <footer className="as-sheet-foot">
        {p.disabledReason && p.selected && <span className="as-foot-note">{p.disabledReason}</span>}
        <button type="button" className="as-primary" onClick={() => p.save()} disabled={!!p.disabledReason || p.saving}>{confirmLabel(p)}</button>
      </footer>
    </Shell>
  );
}

// ── 2. Room map (KAYAK seat selection) ───────────────────────────────────────
function SeatmapView({ p }) {
  const floors = useMemo(() => [...new Set(p.candidates.map((c) => c.floor))].sort((a, b) => a - b), [p.candidates]);
  const [floor, setFloor] = useState(null);
  const firstFree = p.candidates.find((c) => roomState(c) === 'ready') || p.candidates.find((c) => roomState(c) === 'prep');
  const active = floors.includes(floor) ? floor : (p.chosen?.floor ?? firstFree?.floor ?? floors[0]);
  const rooms = p.candidates.filter((c) => c.floor === active).sort(byNumber);
  const nights = p.data?.range.nights;
  return (
    <Shell p={p} className="as-modal is-seatmap">
      <header className="as-modal-head">
        <div>
          <DialogPrimitive.Title className="as-modal-title">בחירת חדר</DialogPrimitive.Title>
          <p>{p.row?.guest?.name} · {p.row?.confirmationNumber}{p.data ? ` · ${stayOf(p.data)} · ${nights} לילות · ${p.data.roomType?.name}` : ''}</p>
        </div>
        <DialogPrimitive.Close className="as-icon-btn" aria-label="סגירה" disabled={p.saving}><X size={18} /></DialogPrimitive.Close>
      </header>
      <div className="as-map-body">
        <div className="as-map">
          <div className="as-map-tabs" role="tablist" aria-label="קומות">
            {floors.map((f) => {
              const onFloor = p.candidates.filter((c) => c.floor === f);
              const free = onFloor.filter((c) => ['ready', 'prep'].includes(roomState(c))).length;
              return (
                <button key={f} type="button" role="tab" aria-selected={f === active} className="as-map-tab" onClick={() => setFloor(f)}>
                  <b>קומה {f}</b><small>{free} פנויים מתוך {onFloor.length}</small>
                </button>
              );
            })}
          </div>
          {p.loading && !p.data ? <Loading /> : rooms.length === 0 ? <p className="as-empty">אין חדרים להצגה{p.allTypes ? '' : ' מהסוג שהוזמן'}.</p> : (
            <div className="as-map-grid" role="radiogroup" aria-label={`חדרים בקומה ${active}`}>
              {rooms.map((c) => {
                const state = roomState(c);
                return (
                  <button key={c.id} type="button" role="radio" aria-checked={p.selected === c.id} disabled={state === 'blocked'}
                    className={`as-seat is-${state}${c.sameType ? '' : ' is-other'}`} onClick={() => p.setSelected(c.id)}
                    title={`חדר ${c.number} · ${headline(c)} · ${endNote(c, nights)}`} aria-label={`חדר ${c.number}, ${headline(c)}`}>
                    {state === 'blocked' ? <X size={18} strokeWidth={2.25} aria-hidden="true" /> : c.number}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <aside className="as-map-side">
          <section className="as-card" aria-labelledby="as-legend-h">
            <h3 id="as-legend-h">מקרא</h3>
            <ul className="as-legend">
              <li><i className="is-ready" />מוכן לכניסה</li>
              <li><i className="is-prep" />דורש הכנה</li>
              <li><i className="is-blocked"><X size={10} strokeWidth={3} /></i>לא זמין</li>
              <li><i className="is-on" />נבחר</li>
              {p.data?.currentRoomId && <li><i className="is-current" />משובץ כעת</li>}
              {p.allTypes && <li><i className="is-other" />סוג חדר אחר</li>}
            </ul>
            <label className="as-check"><input type="checkbox" checked={p.allTypes} onChange={(e) => p.setAllTypes(e.target.checked)} />הצגת כל סוגי החדרים</label>
          </section>
          <section className="as-card" aria-labelledby="as-summary-h">
            <h3 id="as-summary-h">סיכום שיבוץ</h3>
            <p className="as-card-name">{p.row?.guest?.name}</p>
            <table className="as-mini">
              <thead><tr><th>חדר</th><th>סוג</th><th>מצב</th><th><span className="sr-only">פעולה</span></th></tr></thead>
              <tbody>
                {p.chosen ? (
                  <tr><td>{p.chosen.number}</td><td>{p.chosen.roomType?.name}</td><td>{headline(p.chosen)}</td><td><button type="button" className="as-link" onClick={() => p.setSelected(null)}>הסרה</button></td></tr>
                ) : <tr><td colSpan={4} className="as-mini-empty">בחרו חדר במפה</td></tr>}
              </tbody>
            </table>
            <div className="as-card-total"><span>שהייה</span><b>{stayOf(p.data)} · {nights} לילות</b></div>
            {p.replacing && <ReasonField p={p} />}
          </section>
          <Notices p={p} />
          <button type="button" className="as-primary is-block" onClick={() => p.save()} disabled={!!p.disabledReason || p.saving}>{confirmLabel(p)}</button>
          {p.disabledReason && p.selected && <span className="as-foot-note">{p.disabledReason}</span>}
        </aside>
      </div>
    </Shell>
  );
}

// ── 3. Two panes (Apple availability) ────────────────────────────────────────
function PaneCard({ c, selected, onPick }) {
  const state = roomState(c);
  return (
    <button type="button" role="radio" aria-checked={selected === c.id} className={`as-pcard is-${state}`} onClick={() => onPick(c.id)}>
      <span className="as-pcard-main"><b>חדר {c.number}</b><span>{c.roomType?.name} · קומה {c.floor}{!c.sameType && <em>סוג אחר</em>}</span></span>
      <span className="as-pcard-end">
        <b>{state === 'ready' ? 'מוכן היום' : state === 'current' ? 'משובץ כעת' : c.occupiedBy ? 'אורח טרם יצא' : 'דורש ניקיון'}</b>
        <small>{cleanLabel(c.cleanStatus)} · {opsLabel(c.opsStatus)}</small>
      </span>
    </button>
  );
}

function TwoPaneView({ p }) {
  const [query, setQuery] = useState('');
  const [floor, setFloor] = useState('all');
  const [readyOnly, setReadyOnly] = useState(false);
  const floors = useMemo(() => [...new Set(p.candidates.map((c) => c.floor))].sort((a, b) => a - b), [p.candidates]);
  const q = query.trim();
  const match = (c) => (floor === 'all' || c.floor === floor) && (!q || String(c.number).includes(q) || (c.roomType?.name || '').includes(q));
  const ready = p.candidates.filter((c) => match(c) && ['current', 'ready'].includes(roomState(c)));
  const prep = readyOnly ? [] : p.candidates.filter((c) => match(c) && roomState(c) === 'prep');
  const hidden = p.candidates.filter((c) => match(c) && roomState(c) === 'blocked').length;
  const where = floor === 'all' ? '' : ` בקומה ${floor}`;
  return (
    <Shell p={p} className="as-modal is-twopane">
      <header className="as-tp-head">
        <DialogPrimitive.Title className="as-tp-title">זמינות חדרים</DialogPrimitive.Title>
        <DialogPrimitive.Close className="as-close-round" aria-label="סגירה" disabled={p.saving}><X size={16} strokeWidth={2.5} /></DialogPrimitive.Close>
      </header>
      <div className="as-tp">
        <div className="as-tp-filters">
          <label className="as-search">
            <Search size={17} aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="מספר חדר או סוג" aria-label="חיפוש חדר" />
            {query && <button type="button" aria-label="ניקוי החיפוש" onClick={() => setQuery('')}><X size={13} strokeWidth={2.5} /></button>}
          </label>
          <label className="as-check"><input type="checkbox" checked={p.allTypes} onChange={(e) => p.setAllTypes(e.target.checked)} />כל סוגי החדרים</label>
          <div className="as-tp-group">
            <h4>קומה</h4>
            <div className="as-swatches" role="radiogroup" aria-label="קומה">
              {['all', ...floors].map((f) => (
                <button key={f} type="button" role="radio" aria-checked={floor === f} className="as-swatch" onClick={() => setFloor(f)}>{f === 'all' ? 'הכל' : f}</button>
              ))}
            </div>
            <span className="as-swatch-label">{floor === 'all' ? 'כל הקומות' : `קומה ${floor}`}</span>
          </div>
          <div className="as-tp-group">
            <h4>מוכנות</h4>
            <label className="as-check"><input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} />מוכנים לכניסה בלבד</label>
          </div>
        </div>
        <div className="as-tp-main">
          <div className="as-tp-scroll">
            <div className="as-tp-guest">
              <span className="as-guest-av is-round" aria-hidden="true">{guestInitials(p.row?.guest?.name || '')}</span>
              <div>
                <b>{p.row?.guest?.name}</b>
                <span>{p.row?.confirmationNumber}{p.data ? ` · ${stayOf(p.data)} · ${p.data.range.nights} לילות · ${p.data.roomType?.name}` : ''}</span>
              </div>
            </div>
            <Notices p={p} />
            {p.loading && !p.data ? <Loading /> : (
              <>
                <h3>מוכנים לכניסה{where}</h3>
                {ready.length ? (
                  <div className="as-pcards" role="radiogroup" aria-label={`מוכנים לכניסה${where}`}>{ready.map((c) => <PaneCard key={c.id} c={c} selected={p.selected} onPick={p.setSelected} />)}</div>
                ) : <p className="as-empty">אין חדר מוכן לכניסה{where}{q ? ' שמתאים לחיפוש' : ''}.</p>}
                {prep.length > 0 && (
                  <>
                    <h3>או חדר פנוי שדורש הכנה</h3>
                    <div className="as-pcards" role="radiogroup" aria-label="פנויים שדורשים הכנה">{prep.map((c) => <PaneCard key={c.id} c={c} selected={p.selected} onPick={p.setSelected} />)}</div>
                  </>
                )}
                {hidden > 0 && <p className="as-hidden-note">{hidden} חדרים תפוסים או חסומים{where} אינם מוצגים</p>}
                {p.replacing && <ReasonField p={p} />}
              </>
            )}
          </div>
          <div className="as-tp-foot">
            {p.disabledReason && p.selected && <span className="as-foot-note">{p.disabledReason}</span>}
            <button type="button" className="as-primary is-block is-tall" onClick={() => p.save()} disabled={!!p.disabledReason || p.saving}>{confirmLabel(p)}</button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── 4. Quick picker (Jira assignee) ─────────────────────────────────────────
function QuickView({ p }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(null);
  const anchor = useMemo(() => lastPointer, [p.open]);
  const q = query.trim();
  const free = p.candidates.filter((c) => roomState(c) !== 'blocked' && (!q || String(c.number).includes(q) || (c.roomType?.name || '').includes(q)));
  const groups = [
    { label: 'מוכנים לכניסה', rooms: free.filter((c) => ['current', 'ready'].includes(roomState(c))) },
    { label: 'פנויים, דורשים הכנה', rooms: free.filter((c) => roomState(c) === 'prep') },
  ];
  const flat = groups.flatMap((g) => g.rooms);
  const hidden = p.candidates.filter((c) => roomState(c) === 'blocked').length;
  const listRef = useRef(null);

  useEffect(() => { setActive(0); }, [q, p.allTypes]);
  useEffect(() => { listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const pick = (c) => {
    if (!c || c.current || p.saving) return;
    p.setSelected(c.id);
    if (p.data?.currentRoomId) { setPending(c); return; } // replacing needs a reason first
    p.save(c.id);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(flat[active]); }
  };

  const W = 360;
  const H = 440;
  const style = anchor && typeof window !== 'undefined'
    ? {
      left: Math.max(12, Math.min(anchor.x - 40, window.innerWidth - W - 12)),
      ...(window.innerHeight - anchor.y > H + 24 ? { top: anchor.y + 14 } : { bottom: Math.max(12, window.innerHeight - anchor.y + 14) }),
    }
    : { left: '50%', top: '18vh', transform: 'translateX(-50%)' };

  return (
    <Shell p={p} className="as-quick" overlay="as-quick-overlay" style={style}>
      <DialogPrimitive.Title className="sr-only">שיבוץ חדר ל{p.row?.guest?.name}</DialogPrimitive.Title>
      <div className="as-quick-search">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="חיפוש מספר חדר…"
          role="combobox" aria-expanded="true" aria-controls="as-quick-list" aria-label="חיפוש חדר"
          aria-activedescendant={flat[active] ? `as-q-${flat[active].id}` : undefined} />
      </div>
      <p className="as-quick-meta">{p.row?.guest?.name}{p.data ? ` · ${stayOf(p.data)} · ${p.data.roomType?.name}` : ''}</p>
      <div id="as-quick-list" className="as-quick-list" role="listbox" aria-label="חדרים פנויים" ref={listRef}>
        {p.loading && !p.data ? <Loading /> : groups.map((g) => g.rooms.length > 0 && (
          <div key={g.label} role="group" aria-label={g.label}>
            <div className="as-quick-group" aria-hidden="true">{g.label}</div>
            {g.rooms.map((c) => {
              const i = flat.indexOf(c);
              const state = roomState(c);
              return (
                <div key={c.id} id={`as-q-${c.id}`} role="option" aria-selected={i === active} aria-disabled={c.current || undefined}
                  className={`as-quick-item is-${state}${i === active ? ' is-active' : ''}${pending?.id === c.id ? ' is-pending' : ''}`}
                  onMouseEnter={() => setActive(i)} onClick={() => pick(c)}>
                  <span className="as-quick-tile">{c.number}</span>
                  <span className="as-quick-text"><b>חדר {c.number}</b><small>{c.roomType?.name} · קומה {c.floor}{!c.sameType ? ' · סוג אחר' : ''}</small></span>
                  <span className="as-quick-end">
                    {p.saving && p.selected === c.id ? <Spinner /> : state === 'current' ? 'משובץ כעת' : state === 'ready' ? 'מוכן' : c.occupiedBy ? 'אורח בחדר' : cleanLabel(c.cleanStatus)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {!(p.loading && !p.data) && !flat.length && <p className="as-quick-empty">אין חדר פנוי{q ? ' שמתאים לחיפוש' : p.allTypes ? '' : ' מהסוג שהוזמן'}.</p>}
      </div>
      {pending && (
        <div className="as-quick-reason">
          <ReasonField p={p} />
          <button type="button" className="as-primary" disabled={!!p.disabledReason || p.saving} onClick={() => p.save(pending.id)}>{confirmLabel(p)}</button>
        </div>
      )}
      {(p.saveError || p.loadError) && <p className="as-quick-error" role="alert">{p.saveError || p.loadError}</p>}
      {p.typeChange && !pending && <p className="as-quick-hint">סוג חדר אחר: המחיר אינו משתנה.</p>}
      <div className="as-quick-foot">
        <span>{hidden > 0 ? `${hidden} תפוסים לא מוצגים` : '↑↓ לבחירה · Enter לשיבוץ'}</span>
        <button type="button" className="as-link" onClick={() => p.setAllTypes(!p.allTypes)}>{p.allTypes ? 'רק הסוג שהוזמן' : 'כל סוגי החדרים'}</button>
      </div>
    </Shell>
  );
}

export default function AssignRoomStudio(props) {
  const p = props;
  if (p.variant === 'seatmap') return <SeatmapView p={p} />;
  if (p.variant === 'twopane') return <TwoPaneView p={p} />;
  if (p.variant === 'quick') return <QuickView p={p} />;
  return <SheetView p={p} />;
}
