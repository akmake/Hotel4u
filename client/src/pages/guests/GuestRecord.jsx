// One guest's record. The same blocks (highlights, details, stays, notes, preferences, tags) composed
// three ways: Attio (details column + tabbed main), folk (portrait header + fields + underline tabs),
// SevenRooms (a centred guest card, then the history). Full editing stays in the existing profile editor.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X, Phone, Mail, Pencil, Crown, AlertTriangle, ChevronLeft, Plus, Trash2, BedDouble, Wallet,
  CalendarClock, Hash, Globe, Languages, Cake, Building2, Briefcase, IdCard, Star, Clock, StickyNote, Sparkles,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { guests as guestApi, codes as codesApi } from '../../utils/api';
import { Spinner } from '../../components/ui/Spinner';
import { GuestDrawer } from '../GuestsPage';
import ProfileExtras from './ProfileExtras';
import { Avatar } from './GuestDirectory';
import { TIER_LABELS, STATUS_LABELS, fullName, money, dateShort, monthYear, since, portrait, nightsOf } from './guestFormat';

const PREFS = [
  ['roomTypePreference', 'סוג חדר'], ['bedTypePreference', 'מיטה'], ['floorPreference', 'קומה'],
  ['smokingPreference', 'עישון'], ['pillow', 'כרית'], ['newspaper', 'עיתון'],
];
const PREF_VALUES = { any: 'ללא העדפה', high: 'קומה גבוהה', low: 'קומה נמוכה', middle: 'אמצע', 'non-smoking': 'ללא עישון', smoking: 'מעשן', feather: 'נוצות', foam: 'קצף', king: 'King', queen: 'Queen', twin: 'Twin', double: 'Double', single: 'Single' };
const NOTES_FIELDS = [['specialRequests', 'בקשות מיוחדות'], ['allergies', 'אלרגיות'], ['preferences', 'העדפות כלליות'], ['internalNotes', 'לשימוש פנימי']];
const DOC_TYPES = { passport: 'דרכון', id_card: 'ת.ז.', drivers_license: 'רישיון נהיגה', other: 'מסמך' };

export default function GuestRecord({ guestId, propertyId, look, onClose, onChanged }) {
  const { data: g, loading, error, refetch } = useApi(() => guestApi.get(guestId), [guestId]);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const reload = () => { refetch(); onChanged?.(); };

  let body;
  if (!g) body = <div className="gr-state">{error ? <>{error} <button type="button" className="gx-link" onClick={refetch}>ניסיון נוסף</button></> : <><Spinner size={18} /> טוען את הפרופיל…</>}</div>;
  else if (look === 'folk') body = <FolkRecord g={g} tab={tab} setTab={setTab} onEdit={() => setEditing(true)} reload={reload} />;
  else if (look === 'sevenrooms') body = <SevenRoomsRecord g={g} onEdit={() => setEditing(true)} reload={reload} />;
  else body = <AttioRecord g={g} tab={tab} setTab={setTab} onEdit={() => setEditing(true)} reload={reload} />;

  return (
    <Dialog.Root open onOpenChange={(v) => { if (!v && !editing) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="gr-overlay" />
        <Dialog.Content className="gr" data-look={look} dir="rtl" aria-describedby={undefined}
          onPointerDownOutside={(e) => { if (e.target.closest?.('.gx-lookswitch')) e.preventDefault(); }}>
          <Dialog.Title className="sr-only">{g ? fullName(g) : 'פרופיל אורח'}</Dialog.Title>
          {loading && g && <span className="gr-refresh"><Spinner size={12} /></span>}
          {body}
          <Dialog.Close className="gr-close" aria-label="סגירה"><X size={18} /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
      {editing && <GuestDrawer guestId={guestId} propertyId={propertyId} onClose={() => { setEditing(false); reload(); }} onUpdated={reload} />}
    </Dialog.Root>
  );
}

// ── Shared blocks ────────────────────────────────────────────────────────────
function useStats(g) {
  const s = g.stats || {};
  const stays = g.reservations || [];
  const nights = stays.filter((r) => ['checked_out', 'in_house', 'checked_in'].includes(r.status)).reduce((n, r) => n + nightsOf(r), 0);
  return { stays: s.totalStays || 0, revenue: s.totalRevenue || 0, avg: s.avgRevPerStay || 0, last: g.lastStay || s.lastStay, nights, noShow: s.noShowCount || 0 };
}

function detailRows(g) {
  return [
    [Phone, 'טלפון', g.phone && <a href={`tel:${g.phone}`} dir="ltr">{g.phone}</a>],
    [Mail, 'אימייל', g.email && <a href={`mailto:${g.email}`} dir="ltr">{g.email}</a>],
    [Building2, 'חברה', g.company],
    [Briefcase, 'תפקיד', g.jobTitle],
    [Globe, 'מדינה', g.country],
    [Languages, 'שפה', g.language],
    [Cake, 'יום הולדת', g.dateOfBirth && dateShort(g.dateOfBirth)],
    [IdCard, DOC_TYPES[g.idDocType] || 'מסמך מזהה', g.passportNumber && <span dir="ltr">{g.passportNumber}</span>],
    [Star, 'מועדון', g.loyaltyId && <span dir="ltr">{g.loyaltyId}</span>],
    [Clock, 'אורח מאז', g.createdAt && monthYear(g.createdAt)],
  ];
}

function Details({ g, variant }) {
  return (
    <dl className={`gr-details is-${variant}`}>
      {detailRows(g).map(([Icon, label, value]) => (
        <div key={label}>
          <dt><Icon size={14} aria-hidden="true" />{label}</dt>
          <dd>{value || <span className="gx-dash">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Highlights({ g }) {
  const s = useStats(g);
  const items = [
    [Hash, 'שהיות', s.stays],
    [BedDouble, 'לילות במלון', s.nights || '—'],
    [Wallet, 'סה״כ הכנסה', s.revenue ? money(s.revenue) : '—'],
    [CalendarClock, 'ביקור אחרון', s.last ? since(s.last) : '—'],
  ];
  return (
    <div className="gr-highlights">
      {items.map(([Icon, label, value]) => (
        <div key={label} className="gr-hl">
          <span className="gr-hl-label">{label}<Icon size={15} aria-hidden="true" /></span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function Stays({ g, limit }) {
  const nav = useNavigate();
  const list = g.reservations || [];
  const shown = limit ? list.slice(0, limit) : list;
  if (!list.length) return <p className="gr-empty">עדיין אין שהיות לאורח הזה.</p>;
  return (
    <ul className="gr-stays">
      {shown.map((r) => (
        <li key={r._id}>
          <button type="button" onClick={() => nav(`/pms/reservations/${r._id}`)}>
            <span className="gr-stay-dates"><b>{dateShort(r.arrivalDate)}</b><small>{nightsOf(r)} לילות</small></span>
            <span className="gr-stay-room">{r.roomType?.name || 'חדר'}{r.assignedRoom?.number ? ` · חדר ${r.assignedRoom.number}` : ''}<small dir="ltr">{r.confirmationNumber}</small></span>
            <span className={`gr-status is-${r.status}`}>{STATUS_LABELS[r.status] || r.status}</span>
            <span className="gr-stay-amount">{r.totalAmount ? money(r.totalAmount) : '—'}</span>
            <ChevronLeft size={16} className="gr-chev" aria-hidden="true" />
          </button>
        </li>
      ))}
      {limit && list.length > limit && <li className="gr-stays-more">ועוד {list.length - limit} שהיות בלשונית השהיות</li>}
    </ul>
  );
}

function Notes({ g, reload }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const notes = (g.notes || []).slice().reverse();
  async function add() {
    setBusy(true); setErr(null);
    try { await guestApi.addNote(g._id, text.trim()); setText(''); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove(id) {
    try { await guestApi.deleteNote(g._id, id); reload(); } catch (e) { setErr(e.message); }
  }
  return (
    <div className="gr-notes">
      <div className="gr-note-new">
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="הערה על האורח, למשל: אוהב חדר שקט עם נוף לים" aria-label="הערה חדשה" />
        <button type="button" className="gx-btn is-primary" disabled={busy || !text.trim()} onClick={add}>{busy ? <Spinner size={12} /> : 'הוספה'}</button>
      </div>
      {err && <p className="gr-err" role="alert">{err}</p>}
      {notes.length === 0 ? <p className="gr-empty">אין עדיין הערות.</p> : (
        <ul>
          {notes.map((n) => (
            <li key={n._id}>
              <p>{n.text}</p>
              <small>{n.createdBy || 'צוות'} · {dateShort(n.createdAt)}</small>
              <button type="button" className="gr-icon" aria-label="מחיקת הערה" onClick={() => remove(n._id)}><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Prefs({ g, reload }) {
  const rows = PREFS.map(([k, label]) => [label, g[k] ? (PREF_VALUES[g[k]] || g[k]) : null]);
  // The hotel's own preference list (gap-map item 13): toggled here, saved to the profile.
  const { data: prefList } = useApi(() => (g.property ? codesApi.list(g.property, 'preference', true) : Promise.resolve([])), [g.property]);
  const picked = g.preferenceCodes || [];
  const toggle = async (code) => { try { await guestApi.update(g._id, { preferenceCodes: picked.includes(code) ? picked.filter((x) => x !== code) : [...picked, code] }); reload?.(); } catch { /* the refresh shows the truth */ } };
  const texts = NOTES_FIELDS.filter(([k]) => g[k]);
  return (
    <div className="gr-prefs">
      <dl>
        {rows.map(([label, v]) => <div key={label}><dt>{label}</dt><dd>{v || <span className="gx-dash">—</span>}</dd></div>)}
      </dl>
      {!!prefList?.length && <div className="gr-tags is-neutral" aria-label="העדפות מהרשימה">{prefList.map((p) => <button key={p.code} type="button" className={`gx-pill ${picked.includes(p.code) ? 'is-c1' : ''}`} aria-pressed={picked.includes(p.code)} onClick={() => toggle(p.code)}>{p.label}</button>)}</div>}
      {texts.map(([k, label]) => <div key={k} className={`gr-pref-text ${k === 'allergies' ? 'is-alert' : ''}`}><b>{label}</b><p>{g[k]}</p></div>)}
      {!texts.length && <p className="gr-empty">אין בקשות, אלרגיות או הערות קבועות.</p>}
    </div>
  );
}

function TagEditor({ g, reload, tone }) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState('');
  const tags = g.tags || [];
  async function toggle(t, on) {
    try { if (on) await guestApi.addTag(g._id, t); else await guestApi.removeTag(g._id, t); reload(); } catch { /* the list refresh shows the truth */ }
  }
  return (
    <div className={`gr-tags is-${tone}`}>
      {tags.map((t, i) => (
        <span key={t} className={`gx-pill is-c${i % 5}`}>{t}<button type="button" aria-label={`הסרת התגית ${t}`} onClick={() => toggle(t, false)}><X size={11} /></button></span>
      ))}
      {adding ? (
        <input autoFocus className="gr-tag-input" value={val} onChange={(e) => setVal(e.target.value)} placeholder="תגית חדשה" aria-label="תגית חדשה"
          onKeyDown={(e) => { if (e.key === 'Enter' && val.trim()) { toggle(val.trim(), true); setVal(''); setAdding(false); } if (e.key === 'Escape') setAdding(false); }}
          onBlur={() => { if (!val.trim()) setAdding(false); }} />
      ) : <button type="button" className="gr-tag-add" onClick={() => setAdding(true)}><Plus size={12} aria-hidden="true" />תגית</button>}
    </div>
  );
}

function Flags({ g }) {
  return (
    <>
      {g.isBlacklisted && <div className="gr-flag is-blocked"><AlertTriangle size={15} aria-hidden="true" /><span><b>אורח חסום</b>{g.blacklistReason ? ` · ${g.blacklistReason}` : ''}</span></div>}
      {g.allergies && <div className="gr-flag is-allergy"><Sparkles size={15} aria-hidden="true" /><span><b>אלרגיות</b> · {g.allergies}</span></div>}
    </>
  );
}

const TABS = (g) => [
  ['overview', 'סקירה'],
  ['stays', `שהיות${(g.reservations || []).length ? ` ${g.reservations.length}` : ''}`],
  ['notes', `הערות${(g.notes || []).length ? ` ${g.notes.length}` : ''}`],
  ['prefs', 'העדפות'],
  ['more', 'קשרים, קבצים והיסטוריה'],
];

// ── Attio: details column beside a tabbed main panel ─────────────────────────
function AttioRecord({ g, tab, setTab, onEdit, reload }) {
  return (
    <div className="gr-attio">
      <header className="gr-bar">
        <span className="gr-crumb">אורחים<ChevronLeft size={14} aria-hidden="true" /><b>{fullName(g)}</b></span>
        <button type="button" className="gx-btn" onClick={onEdit}><Pencil size={14} aria-hidden="true" />עריכת פרופיל</button>
      </header>
      <div className="gr-grid">
        <aside className="gr-side">
          <div className="gr-ident">
            <Avatar g={g} size={40} />
            <div><h2>{g.title ? `${g.title} ` : ''}{fullName(g)}</h2><p>{portrait(g)}</p></div>
          </div>
          <div className="gr-quick">
            {g.phone && <a className="gx-btn is-icon" href={`tel:${g.phone}`} aria-label="התקשרות"><Phone size={15} /></a>}
            {g.email && <a className="gx-btn is-icon" href={`mailto:${g.email}`} aria-label="אימייל"><Mail size={15} /></a>}
            {g.vipLevel > 0 && <span className={`gx-tier is-${g.vipLevel}`}><Crown size={11} aria-hidden="true" />{TIER_LABELS[g.vipLevel]}</span>}
          </div>
          <Flags g={g} />
          <section><h3>פרטי האורח</h3><Details g={g} variant="attio" /></section>
          <section><h3>תגיות</h3><TagEditor g={g} reload={reload} tone="quiet" /></section>
        </aside>
        <main className="gr-main">
          <nav className="gr-tabchips" aria-label="חלקי הפרופיל">
            {TABS(g).map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
          </nav>
          {tab === 'overview' && (
            <>
              <h3 className="gr-h">נתונים בולטים</h3>
              <Highlights g={g} />
              <h3 className="gr-h">שהיות אחרונות</h3>
              <Stays g={g} limit={4} />
            </>
          )}
          {tab === 'stays' && <Stays g={g} />}
          {tab === 'notes' && <Notes g={g} reload={reload} />}
          {tab === 'prefs' && <Prefs g={g} reload={reload} />}
          {tab === 'more' && <ProfileExtras g={g} />}
        </main>
      </div>
    </div>
  );
}

// ── folk: portrait header, a column of fields, underline tabs ────────────────
function FolkRecord({ g, tab, setTab, onEdit, reload }) {
  const s = useStats(g);
  const fields = [
    [Phone, 'טלפון', g.phone && <a href={`tel:${g.phone}`} dir="ltr">{g.phone}</a>],
    [Mail, 'אימייל', g.email && <a href={`mailto:${g.email}`} dir="ltr">{g.email}</a>],
    [Building2, 'חברה', g.company],
    [Globe, 'מדינה', g.country],
    [Cake, 'יום הולדת', g.dateOfBirth && dateShort(g.dateOfBirth)],
    [BedDouble, 'שהיות', `${s.stays} שהיות · ${s.nights || 0} לילות`],
    [Wallet, 'סה״כ הכנסה', s.revenue ? money(s.revenue) : null],
    [CalendarClock, 'ביקור אחרון', s.last ? `${dateShort(s.last)} (${since(s.last)})` : null],
    [IdCard, DOC_TYPES[g.idDocType] || 'מסמך', g.passportNumber && <span dir="ltr">{g.passportNumber}</span>],
  ];
  const tabs = TABS(g).filter(([id]) => id !== 'overview');
  const current = tab === 'overview' ? 'stays' : tab;
  return (
    <div className="gr-folk">
      <header className="gr-folk-head">
        <Avatar g={g} size={64} />
        <div>
          <h2>{g.title ? `${g.title} ` : ''}{fullName(g)}</h2>
          <p>{portrait(g)}</p>
          <div className="gr-quick">
            {g.phone && <a className="gx-btn is-round" href={`tel:${g.phone}`} aria-label="התקשרות"><Phone size={14} /></a>}
            {g.email && <a className="gx-btn is-round" href={`mailto:${g.email}`} aria-label="אימייל"><Mail size={14} /></a>}
            <button type="button" className="gx-btn is-round" onClick={onEdit} aria-label="עריכת פרופיל"><Pencil size={14} /></button>
            {g.vipLevel > 0 && <span className={`gx-tier is-${g.vipLevel}`}><Crown size={11} aria-hidden="true" />{TIER_LABELS[g.vipLevel]}</span>}
          </div>
        </div>
      </header>
      <div className="gr-folk-grid">
        <aside className="gr-fields">
          <Flags g={g} />
          {fields.map(([Icon, label, value]) => (
            <div key={label} className="gr-field">
              <span className="gr-field-label"><Icon size={13} aria-hidden="true" />{label}</span>
              <span className="gr-field-value">{value || <span className="gx-dash">—</span>}</span>
            </div>
          ))}
          <div className="gr-field">
            <span className="gr-field-label"><Hash size={13} aria-hidden="true" />תגיות</span>
            <TagEditor g={g} reload={reload} tone="pastel" />
          </div>
        </aside>
        <main className="gr-main">
          <nav className="gr-underline" aria-label="חלקי הפרופיל">
            {tabs.map(([id, label]) => <button key={id} type="button" aria-pressed={current === id} onClick={() => setTab(id)}>
              {id === 'stays' ? <BedDouble size={14} aria-hidden="true" /> : id === 'notes' ? <StickyNote size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}{label}
            </button>)}
          </nav>
          {current === 'stays' && <Stays g={g} />}
          {current === 'notes' && <Notes g={g} reload={reload} />}
          {current === 'prefs' && <Prefs g={g} reload={reload} />}
          {current === 'more' && <ProfileExtras g={g} />}
        </main>
      </div>
    </div>
  );
}

// ── SevenRooms: the guest card first, the history under it ───────────────────
function SevenRoomsRecord({ g, onEdit, reload }) {
  const s = useStats(g);
  const last = (g.reservations || []).find((r) => ['checked_out', 'in_house', 'checked_in'].includes(r.status));
  const birthday = g.dateOfBirth && `יום הולדת ב${new Intl.DateTimeFormat('he-IL', { month: 'long' }).format(new Date(g.dateOfBirth))}`;
  return (
    <div className="gr-seven">
      <section className="gr-card">
        <div className="gr-card-top">
          <Avatar g={g} size={96} />
          <h2>{g.title ? `${g.title} ` : ''}{fullName(g)}</h2>
          <p>{portrait(g)}</p>
          <div className="gr-card-pills">
            {g.vipLevel > 0 && <span className="gx-pill is-vip"><Crown size={13} aria-hidden="true" />{TIER_LABELS[g.vipLevel]}</span>}
            {g.isBlacklisted && <span className="gx-pill is-blocked"><AlertTriangle size={13} aria-hidden="true" />חסום</span>}
            {g.allergies && <span className="gx-pill is-allergy">אלרגיות: {g.allergies}</span>}
            {s.stays > 1 && <span className="gx-pill is-c2">חוזר · {s.stays} שהיות</span>}
            {birthday && <span className="gx-pill is-c3">{birthday}</span>}
          </div>
          <TagEditor g={g} reload={reload} tone="bright" />
          <div className="gr-card-actions">
            {g.phone && <a className="gx-btn" href={`tel:${g.phone}`}><Phone size={14} aria-hidden="true" /><span dir="ltr">{g.phone}</span></a>}
            {g.email && <a className="gx-btn" href={`mailto:${g.email}`}><Mail size={14} aria-hidden="true" />אימייל</a>}
            <button type="button" className="gx-btn" onClick={onEdit}><Pencil size={14} aria-hidden="true" />עריכה</button>
          </div>
        </div>
        <div className="gr-card-stats">
          <div><small>סה״כ הוצאה</small><b>{s.revenue ? money(s.revenue) : '—'}</b></div>
          <div><small>שהיות</small><b>{s.stays}</b></div>
          <div><small>לילות</small><b>{s.nights || '—'}</b></div>
          <div><small>ממוצע לשהייה</small><b>{s.avg ? money(s.avg) : '—'}</b></div>
        </div>
        <div className="gr-card-last">
          {last ? (
            <>
              <div className="gr-last-head"><span><small>שהייה אחרונה</small><b>{dateShort(last.arrivalDate)} · {nightsOf(last)} לילות</b></span><b>{last.totalAmount ? money(last.totalAmount) : '—'}</b></div>
              <div className="gr-last-line"><span>{last.roomType?.name || 'חדר'}{last.assignedRoom?.number ? ` · חדר ${last.assignedRoom.number}` : ''}</span><span dir="ltr">{last.confirmationNumber}</span></div>
            </>
          ) : <p className="gr-empty">עדיין לא שהה במלון.</p>}
        </div>
      </section>
      <section className="gr-panel"><h3>היסטוריית שהיות</h3><Stays g={g} /></section>
      <div className="gr-two">
        <section className="gr-panel"><h3>הערות</h3><Notes g={g} reload={reload} /></section>
        <section className="gr-panel"><h3>העדפות</h3><Prefs g={g} reload={reload} /></section>
        <section className="gr-panel"><h3>קשרים, קבצים והיסטוריה</h3><ProfileExtras g={g} /></section>
      </div>
      <section className="gr-panel"><h3>פרטים</h3><Details g={g} variant="seven" /></section>
    </div>
  );
}
