import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogIn, LogOut, Users, BedDouble, Sparkles, Wrench,
  AlertTriangle, AlertCircle, Info, Crown, TrendingUp,
  RefreshCw, Plus, Calendar, DollarSign, Target,
  BarChart2, Activity, ChevronRight,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { dashboard, reports } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';

const PMS = p => `/pms${p}`;
function todayStr() { return new Date().toISOString().split('T')[0]; }
function addDaysStr(d, n) { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split('T')[0]; }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }); }
function fmtDayShort(d) { return new Date(d + 'T00:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric' }); }
function fmtDayMini(d) { const dt = new Date(d + 'T00:00:00'); return { weekday: dt.toLocaleDateString('he-IL', { weekday: 'short' }), day: dt.getDate() }; }
function initials(g) { return ((g?.firstName?.[0] || '') + (g?.lastName?.[0] || '')).toUpperCase(); }
function fmtMoney(n) { if (!n) return '₪0'; return '₪' + Number(n).toLocaleString('he-IL'); }

/* ─── Design Tokens — warm cream · brown · gold. Zero blue. ─────────────── */
const T = {
  bg:        '#EDE8DF',  // parchment page background
  card:      '#FDFAF5',  // warm white card surface
  border:    '#C8B89A',  // visible warm beige border
  dark:      '#2A1A0E',  // very dark warm brown — top bar, dominant headings
  brown:     '#4A3020',  // medium-dark brown — body text
  sub:       '#7A5C42',  // warm muted brown — secondary text
  gold:      '#9A6B1A',  // dark gold — safe for text (contrast-passing)
  goldMid:   '#C49340',  // mid gold — icons, decorative lines
  goldBg:    '#F7EFE0',  // warm gold tint background
  light:     '#E5DDD0',  // lightest warm tint — hover, row lines
  danger:    '#B42318',
  success:   '#1A6B3F',
};

/* ─── Clock ─────────────────────────────────────────────────────────────── */
function useClock() {
  const fmt = () => new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const [t, setT] = useState(fmt);
  useEffect(() => { const id = setInterval(() => setT(fmt()), 1000); return () => clearInterval(id); }, []);
  return t;
}

/* ─── Alert banner ──────────────────────────────────────────────────────── */
const ALERT_ROUTE = a => {
  if (a.id?.startsWith('checkin-'))  return PMS('/check-in');
  if (a.id?.startsWith('checkout-')) return PMS('/check-out');
  if (a.id?.startsWith('hk-'))       return PMS('/housekeeping');
  return PMS('/reservations');
};
function AlertBanner({ alert, onAction, onDismiss }) {
  const cfg = {
    warning: { bg: '#FFFBEB', border: '#F5D68A', icon: AlertTriangle, color: '#92400E' },
    danger:  { bg: '#FFF1F1', border: '#FBBABA', icon: AlertCircle,   color: '#B42318' },
    info:    { bg: '#FBF5E8', border: T.border,   icon: Info,          color: T.brown  },
  }[alert.type] || { bg: T.goldBg, border: T.border, icon: Info, color: T.sub };
  const Icon = cfg.icon;
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm mb-2"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      <Icon size={14} style={{ color: cfg.color, flexShrink: 0 }} />
      <span className="flex-1 font-semibold" style={{ color: cfg.color }}>{alert.text}</span>
      <button className="text-xs font-bold px-3 py-1 rounded-lg"
        style={{ background: T.card, border: `1px solid ${cfg.border}`, color: cfg.color }}
        onClick={() => onAction(ALERT_ROUTE(alert))}>לטיפול ←</button>
      <button onClick={() => onDismiss?.(alert.id)} style={{ color: T.border }}>✕</button>
    </div>
  );
}

/* ─── Arrival row ───────────────────────────────────────────────────────── */
function ArrivalRow({ res, onClick }) {
  const g = res.primaryGuest;
  const isVip = res.isVip || (g?.vipLevel && g.vipLevel !== 'none');
  const room = res.assignedRoom;
  const roomOk = room && ['clean', 'inspected'].includes(room.cleanStatus);
  return (
    <div onClick={onClick} className="flex items-center gap-3 px-5 py-3 cursor-pointer"
      style={{ borderBottom: `1px solid ${T.light}` }}
      onMouseEnter={e => e.currentTarget.style.background = T.goldBg}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0"
        style={{ background: isVip ? T.goldBg : T.light, color: isVip ? T.gold : T.brown, border: `1px solid ${isVip ? T.goldMid : T.border}` }}>
        {initials(g)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm truncate" style={{ color: T.dark }}>{g ? `${g.firstName} ${g.lastName}` : '—'}</span>
          {isVip && <Crown size={11} style={{ color: T.goldMid, flexShrink: 0 }} />}
        </div>
        <div className="text-xs" style={{ color: T.sub }}>{res.roomType?.name}</div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {room
          ? <span className="text-xs font-bold px-2 py-0.5 rounded-lg"
              style={roomOk
                ? { background: '#EDF7F1', color: T.success, border: '1px solid #A7D7B7' }
                : { background: T.goldBg,  color: T.gold,    border: `1px solid ${T.border}` }}>
              {roomOk ? `✓ ${room.number}` : `⚠ ${room.number}`}
            </span>
          : <span className="text-xs font-bold px-2 py-0.5 rounded-lg"
              style={{ background: '#FFF1F1', color: T.danger, border: '1px solid #F5B5B5' }}>ללא חדר</span>
        }
        <span className="text-xs font-medium" style={{ color: res.paymentStatus === 'paid' ? T.success : T.gold }}>
          {res.paymentStatus === 'paid' ? 'שולם ✓' : 'ממתין'}
        </span>
      </div>
    </div>
  );
}

/* ─── Departure row ─────────────────────────────────────────────────────── */
function DepartureRow({ res, onClick }) {
  const g = res.primaryGuest;
  const due = res.paymentStatus === 'balance_due';
  return (
    <div onClick={onClick} className="flex items-center gap-3 px-5 py-3 cursor-pointer"
      style={{ borderBottom: `1px solid ${T.light}` }}
      onMouseEnter={e => e.currentTarget.style.background = T.goldBg}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0"
        style={{ background: due ? '#FFF1F1' : T.light, color: due ? T.danger : T.brown, border: `1px solid ${due ? '#F5B5B5' : T.border}` }}>
        {initials(g)}
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-sm truncate block" style={{ color: T.dark }}>{g ? `${g.firstName} ${g.lastName}` : '—'}</span>
        <div className="text-xs" style={{ color: T.sub }}>{res.roomType?.name} · חדר {res.assignedRoom?.number || '—'}</div>
      </div>
      <span className="text-xs font-bold px-2.5 py-1 rounded-lg flex-shrink-0"
        style={res.paymentStatus === 'paid'
          ? { background: '#EDF7F1', color: T.success, border: '1px solid #A7D7B7' }
          : { background: '#FFF1F1', color: T.danger,  border: '1px solid #F5B5B5' }}>
        {res.paymentStatus === 'paid' ? 'שולם ✓' : 'יתרה ⚠'}
      </span>
    </div>
  );
}

/* ─── Occupancy chart ───────────────────────────────────────────────────── */
function OccTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 12px', fontSize: 12 }} dir="rtl">
      <div style={{ fontWeight: 700, color: T.dark, marginBottom: 2 }}>{label}</div>
      <span style={{ color: T.sub }}>תפוסה: </span>
      <strong style={{ color: T.brown }}>{payload[0]?.value}%</strong>
    </div>
  );
}
function OccupancyChart({ daily, totalRooms }) {
  if (!daily?.length) return null;
  const today = todayStr();
  const data = daily.map(d => ({
    day: fmtDayShort(d.date),
    occupancy: totalRooms ? Math.round((d.occupied / totalRooms) * 100) : d.occupancy || 0,
    date: d.date,
  }));
  return (
    <div style={{ background: T.card, borderRadius: '0.875rem', border: `1px solid ${T.border}`, padding: '1.25rem' }}>
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} style={{ color: T.goldMid }} />
        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: T.dark }}>תפוסה — 7 ימים אחרונים</span>
      </div>
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} barSize={11} margin={{ top: 2, right: 2, bottom: 0, left: -30 }}>
          <CartesianGrid vertical={false} stroke={T.light} />
          <XAxis dataKey="day" tick={{ fontSize: 9, fill: T.sub }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: T.sub }} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" />
          <Tooltip content={<OccTooltip />} cursor={{ fill: T.goldBg }} />
          <Bar dataKey="occupancy" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.date === today ? T.dark : T.border} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Room health strip ─────────────────────────────────────────────────── */
function RoomHealthBar({ clean, dirty, ooo, hold, occupied, total }) {
  if (!total) return null;
  const pct = n => `${Math.round(((n || 0) / total) * 100)}%`;
  const segs = [
    { label: 'נקי/פנוי', value: clean,    color: T.success },
    { label: 'תפוס',     value: occupied, color: T.dark    },
    { label: 'מלוכלך',   value: dirty,    color: T.goldMid },
    { label: 'OOO',      value: ooo,      color: T.danger  },
    { label: 'Hold',     value: hold,     color: T.sub     },
  ].filter(s => s.value > 0);
  return (
    <div style={{ background: T.card, borderRadius: '0.875rem', border: `1px solid ${T.border}`, padding: '1.25rem', marginBottom: '1.25rem' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BedDouble size={14} style={{ color: T.goldMid }} />
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: T.dark }}>מצב חדרים — {total} סה"כ</span>
        </div>
        <div className="flex gap-4 flex-wrap">
          {segs.map(s => (
            <span key={s.label} className="flex items-center gap-1.5 text-xs" style={{ color: T.sub }}>
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: s.color }} />
              {s.label} <strong style={{ color: T.brown }}>{s.value}</strong>
            </span>
          ))}
        </div>
      </div>
      <div className="flex rounded-lg overflow-hidden" style={{ height: 10, background: T.light }}>
        {segs.map(s => <div key={s.label} style={{ width: pct(s.value), background: s.color, minWidth: s.value > 0 ? 4 : 0 }} />)}
      </div>
    </div>
  );
}

/* ─── Forecast strip ────────────────────────────────────────────────────── */
function ForecastStrip({ daily }) {
  if (!daily?.length) return null;
  const todayS = todayStr();
  return (
    <div style={{ background: T.card, borderRadius: '0.875rem', border: `1px solid ${T.border}`, padding: '1.25rem', marginBottom: '1.25rem' }}>
      <div className="flex items-center gap-2 mb-4">
        <Calendar size={14} style={{ color: T.goldMid }} />
        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: T.dark }}>תחזית 7 ימים</span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {daily.slice(0, 7).map(d => {
          const { weekday, day } = fmtDayMini(d.date);
          const isToday = d.date === todayS;
          const occ = d.occupancy || 0;
          const occColor = occ >= 80 ? T.success : occ >= 50 ? T.gold : T.sub;
          return (
            <div key={d.date} className="rounded-xl p-2 text-center"
              style={isToday
                ? { background: T.dark, border: `1px solid ${T.dark}` }
                : { background: T.bg,   border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: isToday ? 'rgba(255,255,255,0.55)' : T.sub }}>
                {isToday ? 'היום' : weekday}
              </div>
              <div style={{ fontSize: '1.125rem', fontWeight: 900, color: isToday ? 'white' : T.dark, lineHeight: 1.2 }}>{day}</div>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: isToday ? '#C8A86A' : occColor, marginTop: 2 }}>{occ}%</div>
              {(d.arrivals > 0 || d.departures > 0) && (
                <div className="flex justify-center gap-1 mt-1">
                  {d.arrivals  > 0 && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isToday ? 'rgba(255,255,255,0.65)' : T.brown }}>+{d.arrivals}</span>}
                  {d.departures > 0 && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isToday ? '#C8A86A' : T.gold }}>-{d.departures}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN PAGE
════════════════════════════════════════════════════════════════════════════ */
export default function DashboardPage() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const clock = useClock();
  const skip = !propertyId;
  const today = todayStr();
  const from7 = addDaysStr(today, -6);

  const [dismissed, setDismissed] = useState(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => { const id = setInterval(() => setRefreshKey(k => k + 1), 180_000); return () => clearInterval(id); }, []);

  const { data: statsRaw,    loading: l1, error: e1, refetch } = useApi(() => dashboard.stats(propertyId),      [propertyId, refreshKey], skip);
  const { data: alertsRaw,   loading: l2 }                     = useApi(() => dashboard.alerts(propertyId),     [propertyId, refreshKey], skip);
  const { data: arrData,     loading: l3 }                     = useApi(() => dashboard.arrivals(propertyId),   [propertyId, refreshKey], skip);
  const { data: depData,     loading: l4 }                     = useApi(() => dashboard.departures(propertyId), [propertyId, refreshKey], skip);
  const { data: inHouseData, loading: l5 }                     = useApi(() => dashboard.inhouse(propertyId),    [propertyId, refreshKey], skip);
  const { data: reportRaw,   loading: l6 }                     = useApi(() => reports.summary(propertyId, from7, addDaysStr(today, 1)), [propertyId, refreshKey], skip);
  const { data: forecastRaw, loading: l7 }                     = useApi(() => reports.summary(propertyId, today, addDaysStr(today, 8)), [propertyId, refreshKey], skip);

  if (skip || l1 || l2 || l3 || l4 || l5) return <PageSpinner />;
  if (e1) return <ErrorState message={e1} onRetry={refetch} />;

  const s           = statsRaw     || {};
  const arrivals    = arrData      || [];
  const departures  = depData      || [];
  const inhouse     = inHouseData  || [];
  const daily       = reportRaw?.daily   || [];
  const forecast    = forecastRaw?.daily || [];
  const todayDaily  = forecast[0];
  const isRefreshing = l1 || l2 || l3 || l4 || l5 || l6 || l7;
  const activeAlerts = (alertsRaw || []).filter(a => !dismissed.has(a.id));

  const sortedArrivals = [...arrivals].sort((a, b) => {
    const score = r => (r.isVip ? 10 : 0) + (r.assignedRoom ? 5 : 0);
    return score(b) - score(a);
  });

  const todayLong = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  function handleRefresh() { setSpinning(true); setRefreshKey(k => k + 1); setTimeout(() => setSpinning(false), 1500); }

  const card = { background: T.card, borderRadius: '0.875rem', border: `1px solid ${T.border}`, overflow: 'hidden' };

  return (
    /* ── Parchment warm background ── */
    <div className="animate-fade-in" dir="rtl"
      style={{ background: T.bg, margin: '-1.5rem', padding: '1.5rem', minHeight: '100vh' }}>

      {/* ══════════════════════════════════════════════════════════════════
          HERO — warm dark brown top bar + large occupancy
      ══════════════════════════════════════════════════════════════════ */}
      <div style={{ ...card, marginBottom: '1.25rem' }}>

        {/* dark brown top bar */}
        <div className="flex items-center justify-between px-7 py-4" style={{ background: T.dark }}>
          <div>
            <div style={{ color: T.goldMid, fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 3 }}>
              Hotel Management System
            </div>
            <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: '1rem', fontWeight: 600 }}>{todayLong}</div>
          </div>
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <span style={{
                width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                background: isRefreshing ? '#F5D68A' : '#7BC59A',
              }} />
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>{isRefreshing ? 'מרענן…' : 'עדכני'}</span>
              <button onClick={handleRefresh}
                style={{ color: 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.8rem', cursor: 'pointer' }}>
                <RefreshCw size={10} className={spinning ? 'animate-spin' : ''} /> רענן
              </button>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '2rem', fontWeight: 300, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.05em', lineHeight: 1 }}>
              {clock}
            </div>
          </div>
        </div>

        {/* thin gold separator */}
        <div style={{ height: 2, background: `linear-gradient(90deg, ${T.goldMid} 0%, ${T.goldBg} 100%)` }} />

        {/* stats row */}
        <div className="flex flex-wrap items-stretch">

          {/* occupancy — dominant */}
          <div className="flex flex-col justify-center px-8 py-7"
            style={{ borderLeft: `1px solid ${T.border}`, minWidth: 200 }}>
            <div style={{
              fontSize: '5.5rem', fontWeight: 900, color: T.dark, lineHeight: 0.85,
              letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
            }}>
              {s.occupancy || 0}%
            </div>
            <div style={{ marginTop: '0.8rem', display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 32, height: 2, background: T.goldMid, borderRadius: 2 }} />
              <span style={{ color: T.gold, fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>OCCUPANCY</span>
            </div>
            <div style={{ color: T.sub, fontSize: '0.9rem', marginTop: '0.35rem' }}>
              {s.inHouse || 0} מתוך {s.totalRooms || 0} חדרים
            </div>
          </div>

          {/* 3 secondary stats */}
          {[
            { label: 'הגעות',    value: s.arrivals   || 0, sub: s.vipArrivals > 0 ? `${s.vipArrivals} VIP` : 'ציפויים', route: PMS('/check-in')    },
            { label: 'In House', value: s.inHouse    || 0, sub: 'אורחים כעת',                                            route: PMS('/reservations') },
            { label: 'יציאות',   value: s.departures || 0, sub: s.openBalances > 0 ? `${s.openBalances} יתרות` : 'יוצאים', route: PMS('/check-out') },
          ].map(({ label, value, sub, route }, i, arr) => (
            <button key={label}
              onClick={() => navigate(route)}
              className="flex flex-col justify-center px-8 py-7 text-right flex-1 cursor-pointer"
              style={{ borderLeft: i < arr.length - 1 ? `1px solid ${T.border}` : 'none', minWidth: 130, transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = T.goldBg}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{
                fontSize: '3.25rem', fontWeight: 900, color: T.dark, lineHeight: 0.88,
                letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
              }}>{value}</div>
              <div style={{ marginTop: '0.65rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 18, height: 2, background: T.border, borderRadius: 2 }} />
                <span style={{ color: T.sub, fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
              </div>
              <div style={{ color: T.gold, fontSize: '0.875rem', fontWeight: 600, marginTop: '0.25rem' }}>{sub}</div>
            </button>
          ))}

          {/* revenue tile */}
          {!l6 && todayDaily && (
            <div className="flex flex-col justify-center px-8 py-7"
              style={{ borderLeft: `1px solid ${T.border}`, background: T.goldBg, minWidth: 170 }}>
              <div style={{
                fontSize: '2rem', fontWeight: 900, color: T.dark, lineHeight: 0.88,
                letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
              }}>
                {fmtMoney(todayDaily.revenue || 0)}
              </div>
              <div style={{ marginTop: '0.65rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 18, height: 2, background: T.goldMid, borderRadius: 2 }} />
                <span style={{ color: T.gold, fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>הכנסות היום</span>
              </div>
              <div style={{ color: T.sub, fontSize: '0.875rem', fontWeight: 600, marginTop: '0.25rem' }}>
                RevPAR {s.totalRooms > 0 ? fmtMoney(Math.round((todayDaily.revenue || 0) / s.totalRooms)) : '—'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Alerts ── */}
      {activeAlerts.length > 0 && (
        <div className="mb-4">
          {activeAlerts.map(a => (
            <AlertBanner key={a.id} alert={a} onAction={navigate}
              onDismiss={id => setDismissed(prev => new Set([...prev, id]))} />
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          QUICK ACTIONS — clean, warm, no gradient explosion
      ══════════════════════════════════════════════════════════════════ */}
      <div style={{ ...card, marginBottom: '1.25rem', padding: '0.875rem 1.25rem' }}>
        <div className="flex gap-2 flex-wrap">
          {[
            { icon: LogIn,     label: "צ'ק-אין",    route: PMS('/check-in'),         primary: true  },
            { icon: LogOut,    label: "צ'ק-אאוט",   route: PMS('/check-out'),        primary: true  },
            { icon: Plus,      label: 'הזמנה חדשה', route: PMS('/reservations/new'), primary: true  },
            { icon: BedDouble, label: 'Tape Chart',  route: PMS('/tape-chart'),       primary: false },
            { icon: Calendar,  label: 'הזמנות',     route: PMS('/reservations'),     primary: false },
            { icon: Sparkles,  label: 'חדרנות',     route: PMS('/housekeeping'),     primary: false },
          ].map(({ icon: Icon, label, route, primary }) => (
            <button key={label}
              onClick={() => navigate(route)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
              style={primary
                ? { background: T.dark, color: 'white', border: `1px solid ${T.dark}` }
                : { background: 'transparent', color: T.brown, border: `1px solid ${T.border}` }}
              onMouseEnter={e => {
                e.currentTarget.style.background = T.goldMid;
                e.currentTarget.style.borderColor = T.goldMid;
                e.currentTarget.style.color = 'white';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = primary ? T.dark : 'transparent';
                e.currentTarget.style.borderColor = primary ? T.dark : T.border;
                e.currentTarget.style.color = primary ? 'white' : T.brown;
              }}>
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Room health ── */}
      <RoomHealthBar clean={s.cleanRooms} dirty={s.dirtyRooms} ooo={s.oooRooms} hold={s.holdRooms} occupied={s.inHouse} total={s.totalRooms} />

      {/* ══════════════════════════════════════════════════════════════════
          ARRIVALS | DEPARTURES | SIDEBAR
      ══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">

        {/* Arrivals */}
        <div style={card}>
          <div className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: `3px solid ${T.dark}`, background: T.bg }}>
            <div className="flex items-center gap-2">
              <LogIn size={14} style={{ color: T.dark }} />
              <span style={{ fontWeight: 800, fontSize: '0.95rem', color: T.dark, letterSpacing: '0.02em' }}>הגעות היום</span>
              <span style={{ background: T.dark, color: 'white', fontSize: '0.8rem', fontWeight: 900, borderRadius: 999, padding: '1px 9px' }}>
                {arrivals.length}
              </span>
            </div>
            {arrivals.length > 0 && (
              <button className="flex items-center gap-1 text-xs font-bold" style={{ color: T.gold }}
                onClick={() => navigate(PMS('/check-in'))}>
                לצ'ק-אין <ChevronRight size={11} />
              </button>
            )}
          </div>
          {!arrivals.length
            ? <div className="flex flex-col items-center justify-center py-12">
                <LogIn size={32} style={{ color: T.border }} className="mb-2" />
                <span style={{ color: T.sub, fontSize: '0.875rem' }}>אין הגעות היום</span>
              </div>
            : <>
                {[...arrivals].sort((a, b) => { const sc = r => (r.isVip ? 10 : 0) + (r.assignedRoom ? 5 : 0); return sc(b) - sc(a); }).slice(0, 7).map(res => (
                  <ArrivalRow key={res._id} res={res} onClick={() => navigate(PMS('/check-in'))} />
                ))}
                {arrivals.length > 7 && (
                  <div className="text-xs text-center py-2" style={{ color: T.sub, borderTop: `1px solid ${T.light}` }}>
                    ועוד {arrivals.length - 7} הגעות
                  </div>
                )}
                <div className="px-5 py-3" style={{ borderTop: `1px solid ${T.light}` }}>
                  <button className="w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2"
                    style={{ background: T.dark, color: 'white' }}
                    onClick={() => navigate(PMS('/check-in'))}>
                    <LogIn size={14} /> לדף צ'ק-אין
                  </button>
                </div>
              </>
          }
        </div>

        {/* Departures */}
        <div style={card}>
          <div className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: `3px solid ${T.goldMid}`, background: T.bg }}>
            <div className="flex items-center gap-2">
              <LogOut size={14} style={{ color: T.goldMid }} />
              <span style={{ fontWeight: 800, fontSize: '0.95rem', color: T.dark, letterSpacing: '0.02em' }}>יציאות היום</span>
              <span style={{ background: T.goldMid, color: 'white', fontSize: '0.8rem', fontWeight: 900, borderRadius: 999, padding: '1px 9px' }}>
                {departures.length}
              </span>
            </div>
            {departures.length > 0 && (
              <button className="flex items-center gap-1 text-xs font-bold" style={{ color: T.gold }}
                onClick={() => navigate(PMS('/check-out'))}>
                לצ'ק-אאוט <ChevronRight size={11} />
              </button>
            )}
          </div>
          {!departures.length
            ? <div className="flex flex-col items-center justify-center py-12">
                <LogOut size={32} style={{ color: T.border }} className="mb-2" />
                <span style={{ color: T.sub, fontSize: '0.875rem' }}>אין יציאות היום</span>
              </div>
            : <>
                {departures.slice(0, 7).map(res => (
                  <DepartureRow key={res._id} res={res} onClick={() => navigate(PMS('/check-out'))} />
                ))}
                {departures.length > 7 && (
                  <div className="text-xs text-center py-2" style={{ color: T.sub, borderTop: `1px solid ${T.light}` }}>
                    ועוד {departures.length - 7} יציאות
                  </div>
                )}
                <div className="px-5 py-3" style={{ borderTop: `1px solid ${T.light}` }}>
                  <button className="w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2"
                    style={{ background: T.goldMid, color: 'white' }}
                    onClick={() => navigate(PMS('/check-out'))}>
                    <LogOut size={14} /> לדף צ'ק-אאוט
                  </button>
                </div>
              </>
          }
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          {/* HK */}
          <div style={card} onClick={() => navigate(PMS('/housekeeping'))} className="cursor-pointer">
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${T.border}` }}>
              <div className="flex items-center gap-2">
                <Sparkles size={14} style={{ color: T.goldMid }} />
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: T.dark }}>חדרנות</span>
              </div>
              {(() => {
                const total = (s.hkPending || 0) + (s.hkInProgress || 0) + (s.hkCompleted || 0);
                const pct = total ? Math.round(((s.hkCompleted || 0) / total) * 100) : 0;
                return <span style={{ fontSize: '0.875rem', fontWeight: 700, color: T.success }}>{pct}% הושלם</span>;
              })()}
            </div>
            <div className="grid grid-cols-4 gap-2 p-4">
              {[
                { label: 'פתוח',   value: s.hkPending,    color: T.gold    },
                { label: 'בביצוע', value: s.hkInProgress, color: T.brown   },
                { label: 'הושלם',  value: s.hkCompleted,  color: T.success },
                { label: 'דחוף',   value: s.hkUrgent,     color: T.danger  },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center rounded-xl py-2.5"
                  style={{ background: T.bg, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color, fontVariantNumeric: 'tabular-nums' }}>{value ?? 0}</div>
                  <div style={{ fontSize: '0.8rem', color: T.sub, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
            {(() => {
              const total = (s.hkPending || 0) + (s.hkInProgress || 0) + (s.hkCompleted || 0);
              const pct = total ? Math.round(((s.hkCompleted || 0) / total) * 100) : 0;
              return total > 0
                ? <div className="px-4 pb-4">
                    <div style={{ height: 7, background: T.light, borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: T.goldMid, borderRadius: 99, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                : null;
            })()}
          </div>

          {/* Maintenance */}
          <div style={card} onClick={() => navigate(PMS('/maintenance'))} className="cursor-pointer"
            onMouseEnter={e => e.currentTarget.style.background = T.goldBg}
            onMouseLeave={e => e.currentTarget.style.background = T.card}>
            <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${T.border}` }}>
              <Wrench size={14} style={{ color: T.goldMid }} />
              <span style={{ fontWeight: 700, fontSize: '0.95rem', color: T.dark }}>תחזוקה פתוחה</span>
            </div>
            <div className="px-5 py-4 flex items-end gap-3">
              <span style={{
                fontSize: '4rem', fontWeight: 900, lineHeight: 0.85,
                color: (s.maintenanceOpen || 0) > 0 ? T.danger : T.success,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {s.maintenanceOpen ?? 0}
              </span>
              <span style={{ color: T.sub, fontSize: '0.9rem', paddingBottom: '0.5rem' }}>
                {(s.maintenanceOpen || 0) > 0 ? 'תקלות פתוחות' : 'הכל תקין ✓'}
              </span>
            </div>
          </div>

          {/* Chart */}
          {!l6 && daily.length > 0 && <OccupancyChart daily={daily} totalRooms={s.totalRooms} />}
        </div>
      </div>

      {/* ── Revenue KPIs ── */}
      {!l6 && todayDaily && (
        <div style={{ ...card, marginBottom: '1.25rem' }}>
          <div className="grid grid-cols-2 md:grid-cols-4">
            {[
              { icon: DollarSign, label: 'הכנסות היום',  value: fmtMoney(todayDaily.revenue || 0) },
              { icon: Target,     label: 'ADR',            value: fmtMoney(s.arrivals > 0 ? Math.round((todayDaily.revenue||0)/s.arrivals) : 0) },
              { icon: BarChart2,  label: 'RevPAR',         value: fmtMoney(s.totalRooms > 0 ? Math.round((todayDaily.revenue||0)/s.totalRooms) : 0) },
              { icon: Activity,   label: 'הזמנות החודש',   value: s.monthReservations ?? '—' },
            ].map(({ icon: Icon, label, value }, idx, arr) => (
              <div key={label} className="flex items-center gap-3 px-6 py-4"
                style={{ borderRight: idx < arr.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                <Icon size={15} style={{ color: T.goldMid, flexShrink: 0 }} />
                <div>
                  <div style={{ color: T.sub, fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                  <div style={{ color: T.dark, fontSize: '1.375rem', fontWeight: 900, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Forecast ── */}
      {!l7 && forecast.length > 0 && <ForecastStrip daily={forecast} />}

      {/* ══════════════════════════════════════════════════════════════════
          IN-HOUSE TABLE
      ══════════════════════════════════════════════════════════════════ */}
      {inhouse.length > 0 && (
        <div style={{ ...card, marginBottom: '1.5rem' }}>
          <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${T.border}` }}>
            <div className="flex items-center gap-2">
              <Users size={14} style={{ color: T.goldMid }} />
              <span style={{ fontWeight: 700, fontSize: '0.95rem', color: T.dark }}>אורחים בבית</span>
              <span style={{ background: T.goldBg, color: T.gold, border: `1px solid ${T.border}`, fontSize: '0.8rem', fontWeight: 900, borderRadius: 999, padding: '1px 9px' }}>
                {inhouse.length}
              </span>
            </div>
            <button className="flex items-center gap-1 text-xs font-bold" style={{ color: T.gold }}
              onClick={() => navigate(PMS('/reservations'))}>
              כל ההזמנות <ChevronRight size={11} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
                  {['אורח', 'חדר', 'סוג חדר', 'יציאה', 'נותרו', 'תשלום'].map(h => (
                    <th key={h} className="px-5 py-3 text-right"
                      style={{ fontSize: '0.8rem', fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inhouse.slice(0, 10).map(res => {
                  const g = res.primaryGuest;
                  const dep = res.departureDate;
                  const leavesToday    = dep === today;
                  const leavesTomorrow = dep === addDaysStr(today, 1);
                  const nightsLeft = dep ? Math.max(0, Math.ceil((new Date(dep+'T00:00:00') - new Date(today+'T00:00:00')) / 86400000)) : null;
                  return (
                    <tr key={res._id} style={{ borderBottom: `1px solid ${T.bg}`, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = T.goldBg}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={() => navigate(PMS('/folio'))}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          {res.isVip && <Crown size={11} style={{ color: T.goldMid }} />}
                          <span style={{ fontWeight: 600, fontSize: '0.875rem', color: T.dark }}>{g ? `${g.firstName} ${g.lastName}` : '—'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span style={{ fontWeight: 900, fontSize: '0.875rem', color: T.gold, fontVariantNumeric: 'tabular-nums' }}>
                          {res.assignedRoom?.number || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3" style={{ fontSize: '0.9rem', color: T.sub }}>{res.roomType?.name}</td>
                      <td className="px-5 py-3">
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: leavesToday ? T.danger : leavesTomorrow ? T.brown : T.sub }}>
                          {fmtDate(dep)}
                          {leavesToday    && <span className="mr-2 text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: '#FFF1F1', color: T.danger }}>היום</span>}
                          {leavesTomorrow && <span className="mr-2 text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: T.goldBg, color: T.gold }}>מחר</span>}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {nightsLeft !== null && (
                          <span style={{ fontWeight: 900, fontSize: '0.875rem', fontVariantNumeric: 'tabular-nums', color: nightsLeft === 0 ? T.danger : nightsLeft === 1 ? T.gold : T.border }}>
                            {nightsLeft === 0 ? 'יוצא היום' : `${nightsLeft}`}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span style={{
                          fontSize: '0.82rem', fontWeight: 700, padding: '3px 10px', borderRadius: 8,
                          ...(res.paymentStatus === 'paid'
                            ? { background: '#EDF7F1', color: T.success, border: `1px solid #A7D7B7` }
                            : res.paymentStatus === 'balance_due'
                              ? { background: '#FFF1F1', color: T.danger, border: '1px solid #F5B5B5' }
                              : { background: T.bg, color: T.sub, border: `1px solid ${T.border}` }),
                        }}>
                          {res.paymentStatus === 'paid' ? 'שולם' : res.paymentStatus === 'balance_due' ? 'יתרה' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {inhouse.length > 10 && (
            <div className="text-xs text-center py-3" style={{ color: T.sub, borderTop: `1px solid ${T.border}` }}>
              ועוד {inhouse.length - 10} אורחים —{' '}
              <button style={{ color: T.gold, fontWeight: 700 }} onClick={() => navigate(PMS('/reservations'))}>לכל ההזמנות</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
