// Public booking site shell: fonts, header (transparent over the hero, solid on scroll), footer,
// and the site (hotel + room types + payment mode) loaded once for every page under /book.
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useOutletContext, useSearchParams } from 'react-router-dom';
import { Maximize2, BedDouble, Users, Mountain, X, Minus, Plus, ShieldCheck } from 'lucide-react';
import { bookApi, nightsBetween, addDays, guestsLabel, longDate } from './bookApi';
import { RoomArt } from './BookArt';
import './book.css';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@300;400;500;700&family=Assistant:wght@300;400;600;700&display=swap';

export function useSite() { return useOutletContext(); }

export function withP(path, p) {
  if (!p) return path;
  return `${path}${path.includes('?') ? '&' : '?'}p=${encodeURIComponent(p)}`;
}

export default function BookLayout() {
  const [sp] = useSearchParams();
  const p = sp.get('p') || '';
  const loc = useLocation();
  const [state, setState] = useState({ site: null, error: null, loading: true });
  const [solid, setSolid] = useState(false);
  const home = loc.pathname === '/book' || loc.pathname === '/book/';

  useEffect(() => {
    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = FONT_HREF;
      document.head.appendChild(l);
    }
  }, []);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    bookApi.site(p).then((site) => live && setState({ site, error: null, loading: false })).catch((error) => live && setState({ site: null, error, loading: false }));
    return () => { live = false; };
  }, [p]);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 60);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => { if (state.site) document.title = `${state.site.property.name} — הזמנת חדרים`; }, [state.site]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  const prop = state.site?.property;
  return (
    <div className="bk" dir="rtl" lang="he">
      <header className={`bk-header ${home ? (solid ? 'is-solid' : '') : 'is-page'}`}>
        <div className="bk-wrap bk-header-in">
          <Link to={withP('/book', p)} className="bk-logo">
            {prop?.name || ' '}
            <small>{prop?.city ? `${prop.city.toUpperCase()} · HOTEL` : 'HOTEL'}</small>
          </Link>
          <nav className="bk-nav" aria-label="ניווט">
            {home && <a href="#rooms">החדרים</a>}
            {home && <a href="#hotel">המלון</a>}
            <a href="#contact">יצירת קשר</a>
            {prop?.phone && <a className="bk-phone" href={`tel:${prop.phone.replace(/[^\d+]/g, '')}`}>{prop.phone}</a>}
          </nav>
        </div>
      </header>

      <main>
        {state.loading && !state.site && <div className="bk-wrap bk-page" style={{ paddingTop: 160 }}><div className="bk-skel" style={{ height: 380 }} /></div>}
        {state.error && (
          <div className="bk-wrap bk-page" style={{ paddingTop: 170 }}>
            <div className="bk-empty">
              <h3>{state.error.code === 'site_off' ? 'ההזמנה המקוונת סגורה כרגע' : 'לא הצלחנו לטעון את האתר'}</h3>
              <p className="bk-lead" style={{ marginInline: 'auto' }}>{state.error.code === 'site_off' ? 'אפשר להזמין בטלפון או בדוא״ל, נשמח לעזור.' : state.error.message}</p>
            </div>
          </div>
        )}
        {state.site && <Outlet context={{ site: state.site, p }} />}
      </main>

      {prop && (
        <footer className="bk-footer" id="contact">
          <div className="bk-wrap">
            <div className="bk-footer-grid">
              <div>
                <h3>{prop.name}</h3>
                <p style={{ maxWidth: '44ch', opacity: 0.8 }}>{prop.intro || 'מלון בוטיק עם שירות אישי.'}</p>
              </div>
              <div>
                <h4>יצירת קשר</h4>
                {prop.address && <p>{prop.address}{prop.city ? `, ${prop.city}` : ''}</p>}
                {prop.phone && <p><a href={`tel:${prop.phone.replace(/[^\d+]/g, '')}`} dir="ltr">{prop.phone}</a></p>}
                {prop.email && <p><a href={`mailto:${prop.email}`}>{prop.email}</a></p>}
              </div>
              <div>
                <h4>שעות</h4>
                <p>כניסה מ־{prop.checkInTime}</p>
                <p>עזיבה עד {prop.checkOutTime}</p>
              </div>
            </div>
            <div className="bk-footer-base">
              <span>© {new Date().getFullYear()} {prop.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={14} /> הזמנה ותשלום מאובטחים · המחירים כוללים מע״מ</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

// ── Shared pieces ──
export function RoomMedia({ room, index = 0, children }) {
  return (
    <div className="bk-room-media">
      {room.images?.length ? <img src={room.images[0]} alt={room.name} loading="lazy" /> : <RoomArt view={room.viewCode || 'garden'} index={index} label={room.name} />}
      {room.images?.length > 1 && <span className="bk-count">{room.images.length} תמונות</span>}
      {children}
    </div>
  );
}

export function Specs({ room }) {
  const c = room.capacity;
  return (
    <div className="bk-specs">
      <span><Users size={15} aria-hidden="true" /> עד {c.max} אורחים{c.children ? ` · עד ${c.children} ילדים` : ''}</span>
      {room.sizeSqm && <span><Maximize2 size={14} aria-hidden="true" /> {room.sizeSqm} מ״ר</span>}
      {room.bed && <span><BedDouble size={15} aria-hidden="true" /> {room.bed}</span>}
      {room.view && <span><Mountain size={15} aria-hidden="true" /> {room.view}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const o = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = o; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="bk-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bk-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="bk-modal-head">
          <h2>{title}</h2>
          <button type="button" className="bk-x" onClick={onClose} aria-label="סגירה"><X size={22} /></button>
        </div>
        <div className="bk-modal-body">{children}</div>
      </div>
    </div>
  );
}

function Stepper({ label, hint, value, min, max, onChange }) {
  return (
    <div className="bk-stepper">
      <div><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
      <div className="bk-stepper-c">
        <button type="button" aria-label={`פחות ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus size={15} /></button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={`יותר ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus size={15} /></button>
      </div>
    </div>
  );
}

// Dates + guests (with each child's age — prices and room limits depend on it).
export function SearchBar({ site, value, onSearch, busy }) {
  const today = site.today;
  const [s, setS] = useState(() => ({ arrival: value.arrival || today, departure: value.departure || addDays(value.arrival || today, 2), adults: value.adults || 2, children: value.children || 0, ages: value.ages || [] }));
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const maxGuests = site.maxGuests || 6;
  const childMax = site.property.childMaxAge ?? 12;
  const nights = nightsBetween(s.arrival, s.departure);
  const setArrival = (v) => setS((x) => ({ ...x, arrival: v, departure: x.departure && x.departure > v ? x.departure : addDays(v, 1) }));
  const setChildren = (n) => setS((x) => ({ ...x, children: n, ages: Array.from({ length: n }, (_, i) => (x.ages[i] ?? '')) }));
  function submit(e) {
    e.preventDefault();
    if (!s.arrival || !s.departure || nights < 1) return setErr('בחרו תאריך הגעה ותאריך עזיבה מאוחר יותר');
    if (s.arrival < today) return setErr('תאריך ההגעה עבר');
    if (s.children && s.ages.slice(0, s.children).some((a) => a === '' || a === undefined)) { setOpen(true); return setErr('ציינו את גיל כל ילד — המחיר והחדרים המתאימים תלויים בכך'); }
    setErr('');
    setOpen(false);
    onSearch({ ...s, ages: s.ages.slice(0, s.children).map(Number) });
    return undefined;
  }
  return (
    <form className="bk-search" onSubmit={submit} aria-label="חיפוש חדר">
      <div className="bk-search-card">
        <div className="bk-field">
          <label htmlFor="bk-in">הגעה</label>
          <input id="bk-in" type="date" min={today} value={s.arrival} onChange={(e) => setArrival(e.target.value)} required />
          <span className="bk-field-hint">{s.arrival ? longDate(s.arrival) : ''}</span>
        </div>
        <div className="bk-field">
          <label htmlFor="bk-out">עזיבה</label>
          <input id="bk-out" type="date" min={s.arrival ? addDays(s.arrival, 1) : today} value={s.departure} onChange={(e) => setS((x) => ({ ...x, departure: e.target.value }))} required />
          <span className="bk-field-hint">{nights > 0 ? `${nights} ${nights === 1 ? 'לילה' : 'לילות'}` : ''}</span>
        </div>
        <div className="bk-field" ref={box}>
          <span className="bk-field-l" id="bk-g-l">אורחים</span>
          <button type="button" className="bk-field-v" aria-haspopup="dialog" aria-expanded={open} aria-labelledby="bk-g-l" onClick={() => setOpen((o) => !o)}>{guestsLabel(s.adults, s.children)}</button>
          <span className="bk-field-hint">חדר אחד</span>
          {open && (
            <div className="bk-pop" role="dialog" aria-label="בחירת אורחים">
              <Stepper label="מבוגרים" value={s.adults} min={1} max={Math.max(1, maxGuests - s.children)} onChange={(v) => setS((x) => ({ ...x, adults: v }))} />
              <Stepper label="ילדים" hint={`עד גיל ${childMax}`} value={s.children} min={0} max={Math.max(0, maxGuests - s.adults)} onChange={setChildren} />
              {s.children > 0 && (
                <div className="bk-ages">
                  {Array.from({ length: s.children }).map((_, i) => (
                    <label key={i}>גיל ילד {i + 1}
                      <select className="bk-select" value={s.ages[i] ?? ''} onChange={(e) => setS((x) => { const a = [...x.ages]; a[i] = e.target.value === '' ? '' : Number(e.target.value); return { ...x, ages: a }; })}>
                        <option value="">בחרו</option>
                        {Array.from({ length: childMax + 1 }).map((__, age) => <option key={age} value={age}>{age === 0 ? 'עד שנה' : age}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <button type="button" className="bk-btn bk-btn-primary bk-btn-sm" onClick={() => setOpen(false)}>אישור</button>
            </div>
          )}
        </div>
        <button type="submit" className="bk-btn bk-btn-brass bk-search-go" disabled={busy}>{busy ? 'בודקים…' : 'בדיקת זמינות'}</button>
      </div>
      {err && <div className="bk-search-err" role="alert">{err}</div>}
    </form>
  );
}
