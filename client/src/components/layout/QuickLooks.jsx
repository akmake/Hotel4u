// Home screen & quick looks (gap-map item 8): live menu counters, keyboard shortcuts (F-keys, Ctrl+Z,
// Alt+F7, Shift+?), and the quick looks that open in place from any screen — weekly control panel,
// house status with maximum availability, vacant room search, currency rates, shortcuts list, help,
// and a temporary user switch (a manager steps in and the clerk returns to the same place).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarRange, Building, BedDouble, Coins, Keyboard, HelpCircle, UserRoundCog, ChevronLeft, ChevronRight } from 'lucide-react';
import api, { frontdesk, cashier } from '../../utils/api';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { useHomeStore } from '../../stores/homeStore';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { SHORTCUTS, BROWSER_KEYS, keyOf, shortcutFor } from '../../lib/shortcuts';
import { helpFor } from '../../lib/screenHelp';
import { roleLabel } from '../../lib/labels';
import { Modal, Field, Spinner, ErrorBanner, Banner, Segmented, Tag, useLoader, useAction } from '../kit';

const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const he = (ymd) => (ymd ? ymd.split('-').reverse().join('.') : '');
const dow = (ymd) => new Intl.DateTimeFormat('he-IL', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
const SWITCH_KEY = 'hotel4u_switch';
const inField = (el) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
const LIVE = ['Reservation', 'ReservationRoom', 'Room', 'HousekeepingTask', 'DeskItem', 'ArrivalQueueEntry', 'Folio'];

// ── Counters + keys + panels (mounted once in the PMS shell) ───────────────
export default function QuickLooks() {
  const { propertyId } = useProperty() || {};
  const nav = useNavigate();
  const { pathname } = useLocation();
  const setCounters = useHomeStore((s) => s.setCounters);
  const look = useHomeStore((s) => s.look);
  const open = useHomeStore((s) => s.open);
  const close = useHomeStore((s) => s.close);

  const load = useCallback(() => { if (propertyId) frontdesk.homeCounters(propertyId).then(setCounters).catch(() => {}); }, [propertyId, setCounters]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useLiveRefresh(propertyId, LIVE, load, { delay: 3000 });

  useEffect(() => {
    const onKey = (e) => {
      const k = keyOf(e);
      const s = SHORTCUTS.find((x) => x.key === k);
      if (!s || s.action === 'search') return;
      if (['Ctrl+Z', 'Shift+?'].includes(k) && inField(e.target)) return;
      e.preventDefault();
      if (s.path) { close(); nav(s.path); } else open(s.action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, open, close]);

  return (
    <>
      <WeekPanel open={look === 'week'} propertyId={propertyId} onClose={close} />
      <HousePanel open={look === 'house'} propertyId={propertyId} onClose={close} />
      <FreeRoomsPanel open={look === 'free'} propertyId={propertyId} onClose={close} onBook={(q) => { close(); nav(`/pms/reservations/new?${new URLSearchParams(q)}`); }} />
      <RatesPanel open={look === 'rates'} propertyId={propertyId} onClose={close} onManage={() => { close(); nav('/pms/currency'); }} />
      <ShortcutsPanel open={look === 'shortcuts'} onClose={close} onRun={(s) => { close(); if (s.path) nav(s.path); else if (s.action === 'search') window.dispatchEvent(new Event('hotel4u:search')); else setTimeout(() => open(s.action), 0); }} />
      <HelpPanel open={look === 'help'} pathname={pathname} onClose={close} onShortcuts={() => open('shortcuts')} />
      <SwitchUserDialog open={look === 'switch'} onClose={close} />
    </>
  );
}

// ── Header quick bar: the quick looks as visible buttons (keys are for the experienced clerk) ─
const BAR = [
  { action: 'week', label: 'מבט שבועי', icon: CalendarRange },
  { action: 'house', label: 'מצב הבית', icon: Building },
  { action: 'free', label: 'חדר פנוי', icon: BedDouble },
  { action: 'rates', label: 'שערים', icon: Coins },
  { action: 'switch', label: 'החלפת משתמש', icon: UserRoundCog },
  { action: 'shortcuts', label: 'קיצורים', icon: Keyboard },
  { action: 'help', label: 'עזרה', icon: HelpCircle },
];
export function QuickBar() {
  const open = useHomeStore((s) => s.open);
  return (
    <div className="qb" role="toolbar" aria-label="מבטים מהירים">
      {BAR.map(({ action, label, icon: Icon }) => {
        const key = shortcutFor(action);
        return (
          <button key={action} type="button" className="qb-btn" onClick={() => open(action)} title={`${label}${key ? ` (${key})` : ''}`} aria-label={`${label}${key ? `, קיצור ${key}` : ''}`}>
            <Icon size={17} aria-hidden="true" /><span className="qb-l">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Temporary user banner ───────────────────────────────────────────────────
export function SwitchBanner() {
  const user = useAuthStore((s) => s.user);
  const nav = useNavigate();
  const [saved, setSaved] = useState(() => { try { return JSON.parse(sessionStorage.getItem(SWITCH_KEY) || 'null'); } catch { return null; } });
  useEffect(() => {
    const sync = () => { try { setSaved(JSON.parse(sessionStorage.getItem(SWITCH_KEY) || 'null')); } catch { setSaved(null); } };
    window.addEventListener('hotel4u:switch', sync);
    return () => window.removeEventListener('hotel4u:switch', sync);
  }, []);
  const back = useCallback(() => {
    const s = (() => { try { return JSON.parse(sessionStorage.getItem(SWITCH_KEY) || 'null'); } catch { return null; } })();
    if (!s) return;
    localStorage.setItem('hotel4u_token', s.token);
    localStorage.setItem('user', JSON.stringify(s.user));
    sessionStorage.removeItem(SWITCH_KEY);
    useAuthStore.setState({ user: s.user, isAuthenticated: true });
    window.dispatchEvent(new Event('hotel4u:switch'));
    nav(s.path || '/pms');
  }, [nav]);
  // Back automatically after 15 minutes — a manager's session never stays on the clerk's desk.
  useEffect(() => {
    if (!saved) return undefined;
    const left = Math.max(0, saved.at + 15 * 60000 - Date.now());
    const t = setTimeout(back, left);
    return () => clearTimeout(t);
  }, [saved, back]);
  if (!saved) return null;
  return (
    <div className="qb-switch" role="status">
      <UserRoundCog size={16} aria-hidden="true" />
      <span>מחובר זמנית: <b>{user?.name || ''}</b> ({roleLabel(user?.role)}) — במקום {saved.user?.name}. חזרה אוטומטית אחרי 15 דקות.</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={back}>חזרה ל{saved.user?.name || 'משתמש הקודם'}</button>
    </div>
  );
}

function SwitchUserDialog({ open, onClose }) {
  const { pathname, search } = useLocation();
  const user = useAuthStore((s) => s.user);
  const action = useAction();
  const [f, setF] = useState({ email: '', password: '', code: '' });
  const [ticket, setTicket] = useState(null);
  const already = !!sessionStorage.getItem(SWITCH_KEY);
  useEffect(() => { if (open) { setF({ email: '', password: '', code: '' }); setTicket(null); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (payload) => {
    if (!payload?.token || !payload?.user) throw new Error('ההתחברות נכשלה');
    sessionStorage.setItem(SWITCH_KEY, JSON.stringify({ token: localStorage.getItem('hotel4u_token'), user, path: `${pathname}${search}`, at: Date.now() }));
    localStorage.setItem('hotel4u_token', payload.token);
    const u = payload.user;
    localStorage.setItem('user', JSON.stringify({ _id: u._id, name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(), role: u.role, propertyId: u.propertyId || null }));
    useAuthStore.setState({ user: u, isAuthenticated: true });
    window.dispatchEvent(new Event('hotel4u:switch'));
    onClose();
  };
  const go = () => action.run(async () => {
    const unwrap = (r) => { const o = r?.data || r; return o?.data || o; };
    if (ticket) return finish(unwrap(await api.post('/auth/mfa', { ticket, code: f.code })));
    const p = unwrap(await api.post('/auth/login', { email: f.email.trim(), password: f.password }));
    if (p?.mfaRequired) { setTicket(p.mfaTicket); return null; }
    return finish(p);
  });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={440} title="החלפת משתמש זמנית" subtitle={`עכשיו מחובר: ${user?.name || ''}. אחרי הפעולה חוזרים בדיוק לכאן.`}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
        <button type="button" className="btn btn-primary" disabled={action.busy || already || (ticket ? f.code.length < 6 : !(f.email && f.password))} onClick={go}>{action.busy ? <Spinner /> : ticket ? 'אימות' : 'כניסה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={action.error} />
        {already && <Banner tone="warn">כבר מחובר משתמש זמני — קודם חוזרים למשתמש הקבוע.</Banner>}
        {!ticket ? (
          <>
            <Field id="sw-email" label="דוא״ל" required><input id="sw-email" className="input w-full" type="email" autoComplete="off" value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} /></Field>
            <Field id="sw-pass" label="סיסמה" required><input id="sw-pass" className="input w-full" type="password" autoComplete="off" value={f.password} onChange={(e) => setF((p) => ({ ...p, password: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} /></Field>
          </>
        ) : (
          <Field id="sw-code" label="קוד אימות דו־שלבי" required><input id="sw-code" className="input w-full" inputMode="numeric" autoComplete="one-time-code" value={f.code} onChange={(e) => setF((p) => ({ ...p, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))} /></Field>
        )}
        <p className="ui-sub">כל פעולה נרשמת ביומן הביקורת על שם המשתמש הזמני. חזרה מהפס העליון, או אוטומטית אחרי 15 דקות.</p>
      </div>
    </Modal>
  );
}

// ── Weekly control panel ────────────────────────────────────────────────────
function WeekPanel({ open, propertyId, onClose }) {
  const [from, setFrom] = useState(null);
  const [adding, setAdding] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (open && propertyId ? frontdesk.homeWeek(propertyId, { from: from || undefined }) : null), [open, propertyId, from]);
  useEffect(() => { if (!open) { setFrom(null); setAdding(null); } }, [open]);
  const rows = data?.rows || [];
  const line = (label, get, opts = {}) => (
    <tr className={opts.className || ''}><th scope="row">{label}</th>{rows.map((r) => <td key={r.date} className={`ui-num ${opts.tone ? opts.tone(r) : ''}`}>{get(r)}</td>)}</tr>
  );
  return (
    <Modal open={open} onClose={onClose} width={1020} title="מבט שבועי" subtitle={data ? `${he(data.from)} – ${he(rows[rows.length - 1]?.date)}` : ''}
      footer={<>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFrom(addDays(data?.from || data?.today, -7))} disabled={!data}><ChevronRight size={15} /> שבוע קודם</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFrom(null)} disabled={!data || data.from === data.today}>היום</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFrom(addDays(data?.from || data?.today, 7))} disabled={!data}>שבוע הבא <ChevronLeft size={15} /></button>
      </>}>
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /></div>}
      {data && (
        <div className="ui-stack">
          <div className="ui-table-wrap">
            <table className="ui-table qb-week">
              <thead><tr><th scope="col"><span className="sr-only">מדד</span></th>{rows.map((r) => <th key={r.date} scope="col" className={r.isToday ? 'is-today' : ''}>{dow(r.date)}<div className="ui-sub">{he(r.date).slice(0, 5)}</div></th>)}</tr></thead>
              <tbody>
                {line('פנויים פיזית', (r) => r.physicalFree, { tone: (r) => (r.physicalFree < 0 ? 'qb-bad' : r.physicalFree <= 2 ? 'qb-warn' : '') })}
                {line('למכירה (כולל אוברבוקינג)', (r) => r.available)}
                {line('תפוסה', (r) => `${r.occupancyPct}%`)}
                {line('סופי / אופציות', (r) => `${r.definite}${r.tentative ? ` / ${r.tentative}` : ''}`)}
                {line('אורחים בבית', (r) => r.guests)}
                {line('הגעות', (r) => r.arrivals)}
                {line('עזיבות', (r) => r.departures)}
                {line('בלוקים שלא נאספו', (r) => r.groupHold || '—')}
                {line('אוברבוקינג', (r) => (r.overbooked ? r.overbooked : '—'), { tone: (r) => (r.overbooked ? 'qb-bad' : '') })}
                <tr><th scope="row">קבוצות</th>{rows.map((r) => <td key={r.date} className="qb-groups">{r.groups.length ? r.groups.map((g) => <div key={g.id} title={`${g.name} · ${g.picked}/${g.blocked} חדרים`}>{g.arrives ? '▸ ' : ''}{g.name}</div>) : <span className="ui-sub">—</span>}</td>)}</tr>
                <tr><th scope="row">פניות שנדחו</th>{rows.map((r) => <td key={r.date}><button type="button" className="qb-ta" onClick={() => setAdding(r.date)} title="רישום פנייה שנדחתה">{r.turnaways.count ? `${r.turnaways.count} (${r.turnaways.rooms} חד׳)` : '+'}</button></td>)}</tr>
              </tbody>
            </table>
          </div>
          {adding && <TurnAwayForm date={adding} reasons={data.reasons} propertyId={propertyId} onDone={() => { setAdding(null); reload(); }} onCancel={() => setAdding(null)} />}
        </div>
      )}
    </Modal>
  );
}

function TurnAwayForm({ date, reasons, propertyId, onDone, onCancel }) {
  const action = useAction();
  const [f, setF] = useState({ rooms: '1', nights: '1', reason: 'full', note: '' });
  return (
    <div className="qb-ta-form" role="group" aria-label={`פנייה שנדחתה ל־${he(date)}`}>
      <b>פנייה שנדחתה · הגעה {he(date)}</b>
      <label>חדרים <input className="input" inputMode="numeric" value={f.rooms} onChange={(e) => setF((p) => ({ ...p, rooms: e.target.value }))} /></label>
      <label>לילות <input className="input" inputMode="numeric" value={f.nights} onChange={(e) => setF((p) => ({ ...p, nights: e.target.value }))} /></label>
      <select className="input" aria-label="סיבה" value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))}>{Object.entries(reasons || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input className="input qb-ta-note" aria-label="הערה" placeholder="הערה (רשות)" maxLength={300} value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} />
      <button type="button" className="btn btn-primary btn-sm" disabled={action.busy} onClick={() => action.run(async () => { await frontdesk.turnAway(propertyId, { date, rooms: Number(f.rooms), nights: Number(f.nights), reason: f.reason, note: f.note || undefined }); onDone(); })}>רישום</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>ביטול</button>
      {action.error && <span className="qb-bad">{action.error.message || String(action.error)}</span>}
    </div>
  );
}

// ── House status of a day ───────────────────────────────────────────────────
function HousePanel({ open, propertyId, onClose }) {
  const [date, setDate] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (open && propertyId ? frontdesk.homeHouse(propertyId, { date: date || undefined }) : null), [open, propertyId, date]);
  useEffect(() => { if (!open) setDate(null); }, [open]);
  const d = data;
  const kv = (rows) => <dl className="qb-kv">{rows.filter(Boolean).map(([k, v, tone]) => <div key={k}><dt>{k}</dt><dd className={tone || ''}>{v}</dd></div>)}</dl>;
  return (
    <Modal open={open} onClose={onClose} width={760} title="מצב הבית" subtitle={d ? `${dow(d.date)} ${he(d.date)}${d.isToday ? ' · היום' : ''}` : ''}
      footer={d && <>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDate(addDays(d.date, -1))}><ChevronRight size={15} /> יום קודם</button>
        <input type="date" className="input" aria-label="תאריך" value={d.date} onChange={(e) => setDate(e.target.value || null)} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDate(addDays(d.date, 1))}>יום הבא <ChevronLeft size={15} /></button>
      </>}>
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !d && <div className="ui-empty"><Spinner /></div>}
      {d && (
        <div className="qb-house">
          <section><h3>חדרים</h3>{kv([['סך הכול', d.rooms.total], ['מושבתים / חסומים', d.rooms.outOfSale, d.rooms.outOfSale ? 'qb-warn' : ''], ['למכירה', d.rooms.sellable]])}</section>
          <section><h3>תנועה (צפוי / בוצע)</h3>{kv([['הגעות', `${d.movement.arrivals.expected} / ${d.movement.arrivals.done}`], ['עזיבות', `${d.movement.departures.expected} / ${d.movement.departures.done}`]])}</section>
          <section><h3>חינם ושימוש בית</h3>{kv([['חינם (Comp)', `${d.use.comp.rooms} חד׳ · ${d.use.comp.guests} אורחים`], ['שימוש בית', `${d.use.houseUse.rooms} חד׳ · ${d.use.houseUse.guests} אורחים`], ['משלמים', `${d.use.paying.rooms} חד׳`]])}<p className="ui-sub">לפי שימוש התעריף (מחירים › קוד תעריף).</p></section>
          <section><h3>תחזית לסוף היום</h3>{kv([['תפוסים', `${d.forecast.occupied} (${d.forecast.occupancyPct}%)`], ['אופציות', d.forecast.tentative], ['חדרי קבוצה שלא נרשמו', d.forecast.groupNotPicked, d.forecast.groupNotPicked ? 'qb-warn' : ''], ['כולל קבוצות', `${d.forecast.withGroupsPct}%`], ['אורחים', d.forecast.guests]])}</section>
          <section><h3>זמינות מקסימלית</h3>{kv([['למכירה (רגיל)', d.maxAvailability.regular], ['עם אוברבוקינג', d.maxAvailability.withOverbooking], ['אם האופציות ישתחררו', d.maxAvailability.ifOptionsReleased], ['סך ההתחייבויות', d.maxAvailability.committed]])}</section>
          <section><h3>משק בית עכשיו</h3>{d.housekeeping ? kv([['פנוי נקי (VC)', d.housekeeping.vc], ['פנוי מלוכלך (VD)', d.housekeeping.vd, d.housekeeping.vd ? 'qb-warn' : ''], ['תפוס נקי (OC)', d.housekeeping.oc], ['תפוס מלוכלך (OD)', d.housekeeping.od], ['מושבת', d.housekeeping.ooo]]) : <p className="ui-sub">ביום אחר מהיום אין מצב משק.</p>}</section>
        </div>
      )}
    </Modal>
  );
}

// ── Vacant room search ──────────────────────────────────────────────────────
function FreeRoomsPanel({ open, propertyId, onClose, onBook }) {
  const [q, setQ] = useState({ from: '', to: '', roomTypeId: '', status: 'ready' });
  const { data, loading, error, reload } = useLoader(async () => (open && propertyId ? frontdesk.freeRooms(propertyId, { from: q.from || undefined, to: q.to || undefined, roomTypeId: q.roomTypeId || undefined, status: q.status }) : null), [open, propertyId, q.from, q.to, q.roomTypeId, q.status]);
  useEffect(() => { if (!open) setQ({ from: '', to: '', roomTypeId: '', status: 'ready' }); }, [open]);
  const set = (k) => (e) => setQ((p) => ({ ...p, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} width={760} title="חיפוש חדר פנוי" subtitle={data ? `${he(data.from)} – ${he(data.to)} · ${data.nights} לילות · ${data.readyFree} מוכנים מתוך ${data.totalFree} פנויים` : ''}>
      <div className="ui-stack">
        <div className="qb-filters">
          <label>מ־<input type="date" className="input" value={q.from || data?.from || ''} onChange={set('from')} /></label>
          <label>עד <input type="date" className="input" value={q.to || data?.to || ''} onChange={set('to')} /></label>
          <select className="input" aria-label="סוג חדר" value={q.roomTypeId} onChange={set('roomTypeId')}><option value="">כל הסוגים</option>{(data?.types || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <Segmented label="מצב ניקיון" value={q.status} onChange={(status) => setQ((p) => ({ ...p, status }))} options={[{ value: 'ready', label: 'נקיים ובדוקים' }, { value: 'all', label: 'כל הפנויים' }]} />
        </div>
        <ErrorBanner error={error} onRetry={reload} />
        {loading && !data && <div className="ui-empty"><Spinner /></div>}
        {data && (
          <>
            <div className="qb-types">{data.byType.map((t) => <span key={t.id}><b>{t.name}</b> {t.ready}/{t.free}</span>)}</div>
            {!data.rooms.length ? <p className="ui-sub">{q.status === 'ready' && data.totalFree ? `אין חדר מוכן — ${data.totalFree} פנויים שעדיין לא נוקו (בחרו "כל הפנויים").` : 'אין חדר פנוי לכל הלילות האלה.'}</p> : (
              <div className="qb-rooms">
                {data.rooms.map((r) => (
                  <button key={r.id} type="button" className={`qb-room ${r.ready ? 'is-ready' : 'is-dirty'}`} onClick={() => onBook({ arrival: data.from, departure: data.to, roomTypeId: r.roomTypeId, roomId: r.id })} title="הזמנה חדשה בחדר הזה">
                    <b>{r.number}</b><span>{r.roomType}</span><small>{r.floor != null ? `קומה ${r.floor} · ` : ''}{r.ready ? 'מוכן' : 'לא נוקה'}</small>
                  </button>
                ))}
              </div>
            )}
            <p className="ui-sub">לחיצה על חדר פותחת הזמנה חדשה בו, לתאריכים שנבחרו.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Currency rates ──────────────────────────────────────────────────────────
function RatesPanel({ open, propertyId, onClose, onManage }) {
  const { data, loading, error } = useLoader(async () => (open && propertyId ? cashier.rates(propertyId) : null), [open, propertyId]);
  const rows = (data?.rates || []).filter((r) => r.active !== false);
  return (
    <Modal open={open} onClose={onClose} width={560} title="שערי מטבע" subtitle="השערים של הנכס — לקופה ולחשבון האורח"
      footer={<button type="button" className="btn btn-secondary btn-sm" onClick={onManage}>לקופה ומט״ח</button>}>
      <ErrorBanner error={error} />
      {loading && !data && <div className="ui-empty"><Spinner /></div>}
      {data && (!rows.length ? <p className="ui-sub">לא הוגדרו שערים. מגדירים בקופה ומט״ח.</p> : (
        <table className="ui-table">
          <thead><tr><th scope="col">מטבע</th><th scope="col">קנייה</th><th scope="col">מכירה</th><th scope="col">תשלום בחשבון</th><th scope="col">חיוב במט״ח</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.currency}><th scope="row"><b>{r.currency}</b> <span className="ui-sub">{r.name}</span></th><td className="ui-num">{r.buy}</td><td className="ui-num">{r.sell}</td><td className="ui-num">{r.pay ?? r.buy}</td><td className="ui-num">{r.charge ?? r.sell}</td></tr>)}</tbody>
        </table>
      ))}
    </Modal>
  );
}

// ── Shortcuts list ──────────────────────────────────────────────────────────
function ShortcutsPanel({ open, onClose, onRun }) {
  return (
    <Modal open={open} onClose={onClose} width={620} title="קיצורי מקלדת" subtitle="פועלים מכל מסך. לחיצה על שורה מפעילה אותה.">
      <table className="ui-table qb-keys">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.key} className="is-clickable" onClick={() => onRun(s)}><th scope="row"><kbd>{s.key}</kbd></th><td>{s.label}{s.note && <div className="ui-sub">{s.note}</div>}</td></tr>
          ))}
          {BROWSER_KEYS.map((s) => <tr key={s.key} className="is-muted"><th scope="row"><kbd>{s.key}</kbd></th><td>{s.label}</td></tr>)}
        </tbody>
      </table>
    </Modal>
  );
}

// ── Help for the current screen ─────────────────────────────────────────────
function HelpPanel({ open, pathname, onClose, onShortcuts }) {
  const h = useMemo(() => helpFor(pathname), [pathname]);
  const keys = SHORTCUTS.filter((s) => s.path && (pathname === s.path || pathname.startsWith(`${s.path}/`)));
  return (
    <Modal open={open} onClose={onClose} width={520} title={`עזרה — ${h.title}`}
      footer={<button type="button" className="btn btn-secondary btn-sm" onClick={onShortcuts}>כל הקיצורים</button>}>
      <div className="ui-stack">
        <p>{h.what}</p>
        <ul className="qb-help">{h.steps.map((s) => <li key={s}>{s}</li>)}</ul>
        {keys.length > 0 && <p className="ui-sub">המסך הזה נפתח גם ב־{keys.map((k) => <Tag key={k.key}>{k.key}</Tag>)}</p>}
      </div>
    </Modal>
  );
}
