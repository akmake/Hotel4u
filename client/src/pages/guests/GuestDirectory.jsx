// /pms/guests — every guest the hotel has ever had. One directory and one record, in three looks taken
// from real products (Attio, folk, SevenRooms) so the owner can choose by seeing them on real data.
// Data and actions are shared; only the composition and the skin change with the look.
import { useMemo, useState } from 'react';
import { Search, Plus, Crown, Phone, Mail, AlertTriangle, Users, CalendarClock, Wallet, Hash } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useApi } from '../../hooks/useApi';
import { guests as guestApi } from '../../utils/api';
import { PageSpinner, ErrorState } from '../../components/ui/Spinner';
import { NewGuestModal } from '../GuestsPage';
import GuestRecord from './GuestRecord';
import { designToolsOn } from '../../utils/designTools';
import { TIER_LABELS, LOOKS, fullName, initials, hueOf, money, dateShort, since, portrait } from './guestFormat';
import './guests.css';

const FILTERS = [
  { id: 'all', label: 'כולם' },
  { id: 'vip', label: 'VIP' },
  { id: 'returning', label: 'חוזרים' },
  { id: 'blocked', label: 'חסומים' },
];
const SORTS = [
  { id: 'stays', label: 'הכי הרבה שהיות', fn: (a, b) => (b.totalStays || 0) - (a.totalStays || 0) },
  { id: 'recent', label: 'ביקור אחרון', fn: (a, b) => String(b.lastStay || '').localeCompare(String(a.lastStay || '')) },
  { id: 'revenue', label: 'הכנסה', fn: (a, b) => (b.totalRevenue || 0) - (a.totalRevenue || 0) },
  { id: 'name', label: 'שם', fn: (a, b) => fullName(a).localeCompare(fullName(b), 'he') },
];

function readLook() {
  try { const v = localStorage.getItem('guests-look'); return LOOKS.some((l) => l.id === v) ? v : 'attio'; } catch { return 'attio'; }
}

export function Avatar({ g, size = 32 }) {
  const h = hueOf(g?._id);
  return (
    <span className="gx-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), '--h': h }} aria-hidden="true">
      {initials(g)}
    </span>
  );
}

export function Tier({ level }) {
  if (!level) return null;
  return <span className={`gx-tier is-${level}`}><Crown size={11} aria-hidden="true" />{TIER_LABELS[level]}</span>;
}

export default function GuestDirectory() {
  const { propertyId } = useProperty();
  const [look, setLookState] = useState(readLook);
  const setLook = (v) => { setLookState(v); try { localStorage.setItem('guests-look', v); } catch { /* per-viewer only */ } };
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('stays');
  const [openId, setOpenId] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const { data, loading, error, refetch } = useApi(() => guestApi.list(propertyId, { limit: 500 }), [propertyId], !propertyId);
  const all = data || [];

  const tags = useMemo(() => [...new Set(all.flatMap((g) => g.tags || []))].sort((a, b) => a.localeCompare(b, 'he')), [all]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => all
    .filter((g) => filter === 'all' || (filter === 'vip' && g.vipLevel > 0) || (filter === 'returning' && (g.totalStays || 0) > 1) || (filter === 'blocked' && g.isBlacklisted))
    .filter((g) => !tag || (g.tags || []).includes(tag))
    .filter((g) => !q || [fullName(g), g.email, g.phone, g.company, g.passportNumber, g.loyaltyId].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort(SORTS.find((s) => s.id === sort).fn), [all, filter, tag, q, sort]);

  const counts = {
    all: all.length,
    vip: all.filter((g) => g.vipLevel > 0).length,
    returning: all.filter((g) => (g.totalStays || 0) > 1).length,
    blocked: all.filter((g) => g.isBlacklisted).length,
  };

  if (!propertyId || (loading && !data)) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div className="gx" data-look={look} dir="rtl">
      <header className="gx-head">
        <div className="gx-title">
          {look === 'folk' && <span className="gx-emoji" aria-hidden="true">🛎️</span>}{/* folk names its lists with an emoji, as on its real screens. taste-skill-ignore */}
          <h1>אורחים</h1>
          <p>{counts.all} אורחים מאז שנפתח המלון · {counts.returning} חוזרים · {counts.vip} VIP</p>
        </div>
        <button type="button" className="gx-btn is-primary" onClick={() => setShowNew(true)}><Plus size={15} aria-hidden="true" />אורח חדש</button>
      </header>

      <div className="gx-tools">
        <label className="gx-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="שם, טלפון, אימייל, חברה או דרכון" aria-label="חיפוש אורח" />
        </label>
        <div className="gx-seg" role="group" aria-label="סינון">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}<span className="gx-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        {tags.length > 0 && (
          <select className="gx-select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="סינון לפי תגית">
            <option value="">כל התגיות</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select className="gx-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="מיון">
          {SORTS.map((s) => <option key={s.id} value={s.id}>מיון: {s.label}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="gx-empty">אין אורחים שמתאימים לחיפוש{q ? ` "${query}"` : ''}.</div>
      ) : look === 'sevenrooms' ? (
        <div className="gx-cards">
          {rows.map((g) => (
            <button key={g._id} type="button" className={`gx-card ${g.isBlacklisted ? 'is-blocked' : ''}`} onClick={() => setOpenId(String(g._id))}>
              <Avatar g={g} size={64} />
              <strong className="gx-card-name">{g.title ? `${g.title} ` : ''}{fullName(g)}</strong>
              <span className="gx-card-sub">{portrait(g)}</span>
              <span className="gx-pills">
                {g.vipLevel > 0 && <span className="gx-pill is-vip"><Crown size={12} aria-hidden="true" />{TIER_LABELS[g.vipLevel]}</span>}
                {g.isBlacklisted && <span className="gx-pill is-blocked"><AlertTriangle size={12} aria-hidden="true" />חסום</span>}
                {(g.tags || []).slice(0, 3).map((t, i) => <span key={t} className={`gx-pill is-c${i % 5}`}>{t}</span>)}
              </span>
              <span className="gx-card-stats">
                <span><small>שהיות</small><b>{g.totalStays || 0}</b></span>
                <span><small>הוצאה</small><b>{g.totalRevenue ? money(g.totalRevenue) : '—'}</b></span>
                <span><small>ביקור אחרון</small><b>{g.lastStay ? since(g.lastStay) : '—'}</b></span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="gx-tablewrap">
          <table className="gx-table">
            <thead>
              <tr>
                <th><span><Users size={13} aria-hidden="true" />אורח</span></th>
                <th><span><Crown size={13} aria-hidden="true" />דרגה</span></th>
                <th className="is-num"><span><Hash size={13} aria-hidden="true" />שהיות</span></th>
                <th><span><CalendarClock size={13} aria-hidden="true" />ביקור אחרון</span></th>
                <th className="is-num"><span><Wallet size={13} aria-hidden="true" />הכנסה</span></th>
                <th><span>תגיות</span></th>
                <th><span><Phone size={13} aria-hidden="true" />קשר</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g._id} tabIndex={0} onClick={() => setOpenId(String(g._id))} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(String(g._id)); }}>
                  <td>
                    <span className="gx-person">
                      <Avatar g={g} size={look === 'folk' ? 32 : 24} />
                      <span>
                        <strong>{g.title ? `${g.title} ` : ''}{fullName(g)}{g.isBlacklisted && <AlertTriangle size={12} className="gx-warn" aria-label="חסום" />}</strong>
                        {g.company && <small>{g.company}</small>}
                      </span>
                    </span>
                  </td>
                  <td>{g.vipLevel > 0 ? <Tier level={g.vipLevel} /> : <span className="gx-dash">—</span>}</td>
                  <td className="is-num">{g.totalStays || 0}</td>
                  <td>{g.lastStay ? <span title={dateShort(g.lastStay)}>{since(g.lastStay)}</span> : <span className="gx-dash">—</span>}</td>
                  <td className="is-num">{g.totalRevenue ? money(g.totalRevenue) : <span className="gx-dash">—</span>}</td>
                  <td>
                    <span className="gx-chips">
                      {(g.tags || []).slice(0, 2).map((t) => <span key={t} className="gx-chip">{t}</span>)}
                      {(g.tags || []).length > 2 && <span className="gx-more">+{g.tags.length - 2}</span>}
                      {!(g.tags || []).length && <span className="gx-dash">—</span>}
                    </span>
                  </td>
                  <td className="gx-contact">
                    {g.phone && <span dir="ltr"><Phone size={12} aria-hidden="true" />{g.phone}</span>}
                    {!g.phone && g.email && <span dir="ltr"><Mail size={12} aria-hidden="true" />{g.email}</span>}
                    {!g.phone && !g.email && <span className="gx-dash">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {designToolsOn() && (
        <div className="gx-lookswitch" role="group" aria-label="מראה דף האורחים">
          <span>מראה אורחים</span>
          {LOOKS.map((l) => <button key={l.id} type="button" aria-pressed={look === l.id} onClick={() => setLook(l.id)}>{l.label}</button>)}
        </div>
      )}

      {openId && <GuestRecord guestId={openId} propertyId={propertyId} look={look} onClose={() => setOpenId(null)} onChanged={refetch} />}
      {showNew && <NewGuestModal propertyId={propertyId} onClose={() => setShowNew(false)} onCreated={() => refetch()} />}
    </div>
  );
}
