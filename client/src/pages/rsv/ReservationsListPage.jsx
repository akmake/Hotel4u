// RSV-01 — reservations list. Finds a booking in any state (incl. cancelled, no-show, quotes):
// date range by arrival / stay / departure / creation, free search by guest, phone or
// confirmation (internal or channel), status groups, source and company. Counts units, not only
// bookings. Filter, sort and page live in the URL.
// Layout: master–detail. Left of the panel = the list, grouped by day when sorted by arrival or
// departure (a day header says how many land that day), two-line rows (guest · stay · room · money ·
// status). Selecting a row docks the booking summary beside the list (overlay on narrow screens).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Crown, StickyNote, MessageSquareText, ShieldCheck, TriangleAlert, X, Phone, ArrowUpLeft, ArrowDown, ArrowUp, LayoutGrid, List } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { booking } from '../../utils/api';
import { RES_STATUS_LABELS, SOURCE_LABELS, BOARD_LABELS, GUARANTEE_LABELS } from '../../lib/labels';
import { formatShort, todayYmd } from '../../utils/date';
import {
  Page, SearchBox, Pill, Empty, Pager, FilterChips, ErrorBanner, Spinner,
  useUrlState, useLoader, money, formatDateTime,
} from '../../components/kit';
import { hueOf } from '../guests/guestFormat';
import './ReservationsListPage.css';

const DEFAULTS = { status: 'all', q: '', from: '', to: '', dateField: 'arrival', source: '', sort: 'arrival', dir: 'asc', page: '1' };
const STATUS_TONE = {
  confirmed: 'ok', modified: 'ok', in_house: 'ok', checked_in: 'ok', partially_checked_in: 'ok', partially_checked_out: 'warn',
  hold: 'warn', pending_payment: 'warn', quote: 'muted', draft: 'muted', checked_out: 'muted', cancelled: 'bad', no_show: 'bad', deleted: 'muted',
};
const DATE_FIELDS = { arrival: 'הגעה', stay: 'שהייה', departure: 'יציאה', created: 'יצירה' };
const NEEDS_ROOM = ['confirmed', 'modified', 'pending_payment', 'hold', 'in_house', 'checked_in'];
const TABS = [
  { id: 'all', label: 'הכול' }, { id: 'upcoming', label: 'עתידיות' }, { id: 'inhouse', label: 'בבית' },
  { id: 'departed', label: 'יצאו' }, { id: 'quotes', label: 'הצעות' }, { id: 'cancelled', label: 'בוטלו' },
  { id: 'deleted', label: 'נמחקו' },
];
const SORTS = [{ id: 'arrival', label: 'הגעה' }, { id: 'departure', label: 'יציאה' }, { id: 'guest', label: 'אורח' }, { id: 'total', label: 'סכום' }];

const ymdToDate = (ymd) => new Date(`${ymd}T00:00:00`);
function dayLabel(ymd, today) {
  const diff = Math.round((ymdToDate(ymd) - ymdToDate(today)) / 86400000);
  const rel = diff === 0 ? 'היום' : diff === 1 ? 'מחר' : diff === -1 ? 'אתמול' : null;
  const full = ymdToDate(ymd).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  return { rel, full, isToday: diff === 0 };
}
const Item = (props) => (props.view === 'rows' ? <Line {...props} /> : <Row {...props} />);
const initialsOf = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const balanceOf = (r) => {
  if (r.balance === null) return { text: '—', cls: 'is-none' };
  if (r.balance > 0.005) return { text: `יתרה ${money(r.balance, r.currency, 0)}`, cls: 'is-due' };
  if (r.balance < -0.005) return { text: `זכות ${money(-r.balance, r.currency, 0)}`, cls: 'is-credit' };
  return { text: 'שולם', cls: 'is-paid' };
};

function Row({ r, on, onPick }) {
  const bal = balanceOf(r);
  const channel = [SOURCE_LABELS[r.source] || r.source, r.company || r.group].filter(Boolean).join(' · ');
  const needsRoom = r.roomNumbers.length === 0 && r.unassigned > 0 && NEEDS_ROOM.includes(r.status);
  const tone = STATUS_TONE[r.status] || 'muted';
  return (
    <li>
      <button type="button" className={`rv-card ${on ? 'is-selected' : ''} ${['cancelled', 'no_show', 'deleted'].includes(r.status) ? 'is-done' : ''}`} onClick={() => onPick(r)} aria-pressed={on}>
        <bdi className="rv-conf ui-num" title={r.externalId || undefined}>{r.confirmationNumber}</bdi>
        <span className="rv-flags">
          {r.overbooking && <span className="rv-ic is-bad" title="עודף הזמנה"><TriangleAlert size={13} /></span>}
          {r.notes.requests && <span className="rv-ic" title="בקשות אורח"><MessageSquareText size={13} /></span>}
          {r.notes.internal && <span className="rv-ic" title="הערה פנימית"><StickyNote size={13} /></span>}
          {r.guarantee !== 'none' && <span className="rv-ic" title={`ערובה: ${GUARANTEE_LABELS[r.guarantee]}`}><ShieldCheck size={13} /></span>}
        </span>
        <span className="rv-av" style={{ '--h': hueOf(r.guest) }} aria-hidden="true">{initialsOf(r.guest)}</span>
        <span className="rv-name">{r.guest}</span>
        <span className="rv-mail" title={r.email || undefined}>{r.email ? <bdi>{r.email}</bdi> : r.phone ? <bdi className="ui-num">{r.phone}</bdi> : channel || '—'}</span>
        <span className="rv-pills">
          <span className={`rv-pill is-${tone}`}>{RES_STATUS_LABELS[r.status] || r.status}</span>
          <span className={`rv-pill ${r.roomNumbers.length ? 'is-room' : needsRoom ? 'is-warn' : 'is-muted'}`}>{r.roomNumbers.length ? `חדר ${r.roomNumbers.join(', ')}` : needsRoom ? 'לא שובץ' : (r.roomType || 'חדר')}</span>
          {r.vip && <span className="rv-pill is-vip">VIP <Crown size={12} /></span>}
        </span>
        <span className="rv-when ui-num">{formatShort(r.arrivalDate)} ← {formatShort(r.departureDate)}<i> · {r.nights} לילות</i></span>
        <span className="rv-card-stats">
          <span><small>אורחים</small><b className="ui-num">{r.adults}{r.children ? `+${r.children}` : ''}</b></span>
          <span><small>סכום</small><b className="ui-num">{money(r.total, r.currency, 0)}</b></span>
          <span><small>יתרה</small><b className={`ui-num rv-bal ${bal.cls}`}>{bal.text.replace('יתרה ', '')}</b></span>
        </span>
      </button>
    </li>
  );
}

function Line({ r, on, onPick }) {
  const bal = balanceOf(r);
  const channel = [SOURCE_LABELS[r.source] || r.source, r.company || r.group].filter(Boolean).join(' · ');
  const needsRoom = r.roomNumbers.length === 0 && r.unassigned > 0 && NEEDS_ROOM.includes(r.status);
  const tone = STATUS_TONE[r.status] || 'muted';
  const arr = ymdToDate(r.arrivalDate);
  return (
    <li>
      <button type="button" className={`rv-item ${on ? 'is-selected' : ''} ${['cancelled', 'no_show', 'deleted'].includes(r.status) ? 'is-done' : ''}`} onClick={() => onPick(r)} aria-pressed={on}>
        <span className="rv-date" aria-label={`הגעה ${formatShort(r.arrivalDate)}`}>
          <b className="ui-num">{arr.getDate()}</b>
          <small>{arr.toLocaleDateString('he-IL', { month: 'short' })}</small>
        </span>
        <span className="rv-guest">
          <span className="rv-l1">
            <b className="rv-name">{r.guest}</b>
            {r.vip && <Crown size={14} className="rv-vip" aria-label="VIP" />}
            {r.overbooking && <span className="rv-ic is-bad" title="עודף הזמנה"><TriangleAlert size={12} /></span>}
            {r.notes.requests && <span className="rv-ic" title="בקשות אורח"><MessageSquareText size={12} /></span>}
            {r.notes.internal && <span className="rv-ic" title="הערה פנימית"><StickyNote size={12} /></span>}
            {r.guarantee !== 'none' && <span className="rv-ic" title={`ערובה: ${GUARANTEE_LABELS[r.guarantee]}`}><ShieldCheck size={12} /></span>}
          </span>
          <span className="rv-sub" title={r.email || undefined}>{r.email ? <bdi>{r.email}</bdi> : r.phone ? <bdi className="ui-num">{r.phone}</bdi> : channel || '—'}</span>
        </span>
        <span className="rv-stay">
          <span className="rv-l1 ui-num">{formatShort(r.arrivalDate)} ← {formatShort(r.departureDate)}</span>
          <span className="rv-sub">{r.nights} לילות · {r.adults}{r.children ? `+${r.children}` : ''} אורחים{channel ? ` · ${channel}` : ''}</span>
        </span>
        <span className="rv-roomc">
          <span className="rv-l1">{r.roomNumbers.length ? <>חדר <b className="ui-num">{r.roomNumbers.join(', ')}</b></> : needsRoom ? <span className="rv-warn">לא שובץ</span> : (r.roomType || '—')}</span>
          <span className="rv-sub">{r.roomType || ''}{r.dirtyRooms > 0 ? ' · לא מוכן' : ''}</span>
        </span>
        <span className={`rv-st is-${tone}`}>{RES_STATUS_LABELS[r.status] || r.status}</span>
        <span className="rv-pay">
          <b className="ui-num">{money(r.total, r.currency, 0)}</b>
          <span className={`rv-bal ui-num ${bal.cls}`}>{bal.text}</span>
        </span>
      </button>
    </li>
  );
}

export default function ReservationsListPage() {
  const { propertyId } = useProperty();
  const nav = useNavigate();
  const url = useUrlState(DEFAULTS);
  const params = useMemo(() => {
    const o = {};
    for (const k of Object.keys(DEFAULTS)) { const v = url.get(k); if (v && !(k === 'status' && v === 'all')) o[k] = v; }
    return o;
  }, [url]);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? booking.list(propertyId, params) : null), [propertyId, url.key]);
  const open = (r) => nav(`/pms/reservations/${r.id}`);
  const [selId, setSelId] = useState(null);
  const [view, setView] = useState(() => { try { return localStorage.getItem('rv-view') === 'rows' ? 'rows' : 'cards'; } catch { return 'cards'; } });
  const pickView = (v) => { setView(v); try { localStorage.setItem('rv-view', v); } catch { /* per-viewer convenience only */ } };
  const sel = data?.rows?.find((r) => r.id === selId) || null;
  useEffect(() => {
    if (!selId) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSelId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selId]);
  const today = todayYmd();
  const preset = (dateField) => url.set({ dateField, from: today, to: today, status: 'all' });
  const presetOn = (dateField) => url.get('from') === today && url.get('to') === today && url.get('dateField') === dateField;
  const reset = () => url.set({ q: '', from: '', to: '', source: '', status: 'all' });
  const sortKey = url.get('sort');
  const dir = url.get('dir');
  const pickSort = (k) => url.set({ sort: k, dir: sortKey === k && dir === 'asc' ? 'desc' : 'asc' });

  const groups = useMemo(() => {
    const rows = data?.rows || [];
    const by = sortKey === 'arrival' ? 'arrivalDate' : sortKey === 'departure' ? 'departureDate' : null;
    if (!by) return [{ key: 'all', rows }];
    const out = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.key === r[by]) last.rows.push(r); else out.push({ key: r[by], rows: [r] });
    }
    return out;
  }, [data, sortKey]);
  const groupVerb = sortKey === 'departure' ? 'יוצאים' : 'מגיעים';

  const chips = [
    (url.get('from') || url.get('to')) && { key: 'range', label: `${DATE_FIELDS[url.get('dateField')]}: ${url.get('from') ? formatShort(url.get('from')) : '…'} – ${url.get('to') ? formatShort(url.get('to')) : '…'}` },
    url.get('source') && { key: 'source', label: `ערוץ: ${SOURCE_LABELS[url.get('source')] || url.get('source')}` },
    url.get('q') && { key: 'q', label: `חיפוש: ${url.get('q')}` },
  ].filter(Boolean);
  const filtered = chips.length > 0 || url.get('status') !== 'all';
  const empty = data && data.rows.length === 0;

  return (
    <Page wide title="הזמנות" back="/pms" meta={data ? `${data.total} תוצאות` : undefined}
      primary={<button type="button" className="btn btn-primary" onClick={() => nav('/pms/reservations/new')}><Plus size={16} /> הזמנה חדשה</button>}>
      <div className={`rv ${sel ? 'has-sel' : ''}`}>
        <section className="rv-list" aria-label="הזמנות">
          <header className="rv-top">
            <div className="rv-tabs" role="tablist" aria-label="מצב הזמנה">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={url.get('status') === t.id} className={`rv-tabbtn ${url.get('status') === t.id ? 'is-on' : ''}`} onClick={() => url.set({ status: t.id })}>
                  {t.label}<b className="ui-num">{data?.counts?.[t.id] ?? '·'}</b>
                </button>
              ))}
            </div>
            <div className="rv-find"><SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם, טלפון, מספר אישור או אסמכתת ערוץ" id="rsv-q" /></div>
          </header>
          <div className="rv-filters">
            <button type="button" className={`rv-chip ${presetOn('arrival') ? 'is-on' : ''}`} onClick={() => (presetOn('arrival') ? url.set({ from: '', to: '' }) : preset('arrival'))}>מגיעים היום</button>
            <button type="button" className={`rv-chip ${presetOn('departure') ? 'is-on' : ''}`} onClick={() => (presetOn('departure') ? url.set({ from: '', to: '' }) : preset('departure'))}>יוצאים היום</button>
            <span className="rv-sep" aria-hidden="true" />
            <div className="rv-range" role="group" aria-label="טווח תאריכים">
              <label className="sr-only" htmlFor="rsv-df">סוג תאריך</label>
              <select id="rsv-df" className="select select-sm" value={url.get('dateField')} onChange={(e) => url.set({ dateField: e.target.value })}>
                {Object.entries(DATE_FIELDS).map(([v, l]) => <option key={v} value={v}>לפי {l}</option>)}
              </select>
              <label className="ui-datebox"><span className="sr-only">מתאריך</span><input type="date" value={url.get('from')} onChange={(e) => url.set({ from: e.target.value })} /></label>
              <span className="rv-to">עד</span>
              <label className="ui-datebox"><span className="sr-only">עד תאריך</span><input type="date" value={url.get('to')} min={url.get('from') || undefined} onChange={(e) => url.set({ to: e.target.value })} /></label>
            </div>
            <label className="sr-only" htmlFor="rsv-src">ערוץ</label>
            <select id="rsv-src" className="select select-sm" value={url.get('source')} onChange={(e) => url.set({ source: e.target.value })}>
              <option value="">כל הערוצים</option>
              {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div className="rv-view" role="group" aria-label="תצוגה">
              <button type="button" className={view === 'cards' ? 'is-on' : ''} onClick={() => pickView('cards')} aria-pressed={view === 'cards'}><LayoutGrid size={15} /> כרטיסים</button>
              <button type="button" className={view === 'rows' ? 'is-on' : ''} onClick={() => pickView('rows')} aria-pressed={view === 'rows'}><List size={15} /> שורות</button>
            </div>
            <div className="rv-sort" role="group" aria-label="מיון">
              <span>מיון</span>
              {SORTS.map((s) => (
                <button key={s.id} type="button" className={sortKey === s.id ? 'is-on' : ''} onClick={() => pickSort(s.id)} aria-pressed={sortKey === s.id}>
                  {s.label}{sortKey === s.id && (dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                </button>
              ))}
            </div>
          </div>
          {chips.length > 0 && <div className="rv-active"><FilterChips chips={chips} onRemove={(k) => url.set(k === 'range' ? { from: '', to: '' } : { [k]: '' })} onReset={reset} /></div>}

          <ErrorBanner error={error} onRetry={reload} />
          <div className="rv-scroll" aria-busy={!!loading}>
            {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
            {empty && (filtered
              ? <div className="ui-empty"><strong>אין תוצאות לסינון הנוכחי</strong><button type="button" className="btn btn-ghost btn-sm" onClick={reset}>איפוס סינון</button></div>
              : <Empty title="אין הזמנות" action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => nav('/pms/reservations/new')}>הזמנה חדשה</button>} />)}
            {groups.map((g) => {
              const label = g.key !== 'all' ? dayLabel(g.key, today) : null;
              return (
                <div key={g.key} className="rv-group">
                  {label && (
                    <h3 className={`rv-day ${label.isToday ? 'is-today' : ''}`}>
                      {label.isToday && <i className="rv-dot" aria-hidden="true" />}
                      {label.rel && <b>{label.rel}</b>}<span>{label.full}</span>
                      <em className="ui-num">{g.rows.length} {groupVerb}</em>
                    </h3>
                  )}
                  <ul className={view === 'rows' ? 'rv-items' : 'rv-cards'}>{g.rows.map((r) => <Item key={r.id} view={view} r={r} on={r.id === selId} onPick={(x) => setSelId(x.id === selId ? null : x.id)} />)}</ul>
                </div>
              );
            })}
          </div>
          {data && (
            <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => url.set({ page: p }, { resetPage: false })} unit={`הזמנות · ${data.units} יחידות`} />
          )}
        </section>

        {sel && (
          <aside className="rv-peek" aria-label={`פרטי הזמנה ${sel.confirmationNumber}`}>
            <header className="rv-peek-head">
              <div>
                <h2>{sel.guest}{sel.vip && <Crown size={15} className="rv-vip" aria-label="VIP" />}</h2>
                <div className="ui-sub"><bdi>{sel.confirmationNumber}</bdi>{sel.externalId ? <> · <bdi>{sel.externalId}</bdi></> : null}</div>
              </div>
              <button type="button" className="rv-x" onClick={() => setSelId(null)} aria-label="סגור"><X size={18} /></button>
            </header>
            <div className="rv-peek-body">
              <div className="rv-peek-status"><Pill tone={STATUS_TONE[sel.status] || 'muted'}>{RES_STATUS_LABELS[sel.status] || sel.status}</Pill>{sel.overbooking && <span className="rv-warn is-bad">עודף הזמנה</span>}</div>
              {sel.phone && <a className="rv-phone" href={`tel:${sel.phone}`}><Phone size={14} /> <bdi>{sel.phone}</bdi></a>}
              <dl className="rv-kv">
                <div><dt>שהייה</dt><dd><span className="ui-num">{formatShort(sel.arrivalDate)} ← {formatShort(sel.departureDate)}</span> · {sel.nights} לילות{sel.eta ? ` · הגעה ${sel.eta}` : ''}</dd></div>
                <div><dt>חדר</dt><dd>{sel.rooms > 1 ? `${sel.rooms} × ` : ''}{sel.roomType || '—'}{sel.roomNumbers.length ? ` · חדר ${sel.roomNumbers.join(', ')}` : (sel.unassigned > 0 && NEEDS_ROOM.includes(sel.status) ? ' · לא שובץ' : '')}{sel.dirtyRooms > 0 ? ' · לא מוכן' : ''}</dd></div>
                <div><dt>אורחים</dt><dd>{sel.adults} מבוגרים{sel.children ? `, ${sel.children} ילדים` : ''}{sel.board ? ` · ${BOARD_LABELS[sel.board]}` : ''}</dd></div>
                <div><dt>ערוץ</dt><dd>{SOURCE_LABELS[sel.source] || sel.source || '—'}{[sel.company, sel.travelAgent, sel.group].filter(Boolean).map((x) => ` · ${x}`)}</dd></div>
                <div><dt>ערובה</dt><dd>{GUARANTEE_LABELS[sel.guarantee]}</dd></div>
                <div><dt>נוצרה</dt><dd>{formatDateTime(sel.createdAt)}</dd></div>
              </dl>
              <div className="rv-money">
                <div><span>סכום</span><b className="ui-num">{money(sel.total, sel.currency, 0)}</b></div>
                {sel.depositAmount > 0 && <div><span>מקדמה</span><b className="ui-num">{money(sel.depositPaid, sel.currency, 0)} / {money(sel.depositAmount, sel.currency, 0)}</b></div>}
                <div className="is-balance"><span>יתרה</span>{sel.balance === null ? <b>ללא חשבון</b> : <b className={`ui-num ${sel.balance > 0.005 ? 'is-due' : 'is-paid'}`}>{sel.balance > 0.005 ? money(sel.balance, sel.currency, 0) : sel.balance < -0.005 ? `זכות ${money(-sel.balance, sel.currency, 0)}` : 'שולם'}</b>}</div>
              </div>
              {sel.noteText.requests && <div className="rv-note"><span>בקשות אורח</span><p>{sel.noteText.requests}</p></div>}
              {sel.noteText.internal && <div className="rv-note is-internal"><span>הערה פנימית</span><p>{sel.noteText.internal}</p></div>}
            </div>
            <footer className="rv-peek-foot">
              <button type="button" className="btn btn-primary" onClick={() => open(sel)}>פתח תיק הזמנה <ArrowUpLeft size={16} /></button>
            </footer>
          </aside>
        )}
      </div>
    </Page>
  );
}
