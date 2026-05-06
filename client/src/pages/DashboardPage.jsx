import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogIn, LogOut, Users, BedDouble, Sparkles, Wrench, AlertTriangle,
  AlertCircle, Info, Crown, TrendingUp, RefreshCw, Plus, Calendar,
  ChevronRight, Clock, DollarSign, Target, BarChart2, Star,
  Activity, ArrowUpRight,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { dashboard, reports } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';

/* ── helpers ─────────────────────────────────────────────────────────────── */
const PMS = p => `/pms${p}`;

function todayStr() { return new Date().toISOString().split('T')[0]; }
function addDaysStr(d, n) {
  const dt = new Date(d); dt.setDate(dt.getDate() + n);
  return dt.toISOString().split('T')[0];
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit' });
}
function fmtDayShort(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('he-IL', { weekday:'short', day:'numeric' });
}
function fmtDayMini(d) {
  const date = new Date(d + 'T00:00:00');
  return {
    weekday: date.toLocaleDateString('he-IL', { weekday:'short' }),
    day: date.getDate(),
    month: date.toLocaleDateString('he-IL', { month:'short' }),
  };
}
function initials(g) {
  return ((g?.firstName?.[0] || '') + (g?.lastName?.[0] || '')).toUpperCase();
}
function fmtMoney(n) {
  if (!n) return '₪0';
  return '₪' + Number(n).toLocaleString('he-IL');
}

/* ── live clock ──────────────────────────────────────────────────────────── */
function LiveClock() {
  const fmt = () => new Date().toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-2xl font-light tracking-widest text-white/90 tabular-nums">{time}</span>;
}

/* ── KPI card ────────────────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, sub, accentColor, urgent, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-right bg-white rounded-xl border transition-all duration-150 group
        ${urgent
          ? 'border-red-300 shadow-sm hover:shadow-md hover:border-red-400'
          : 'border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300'}
        ${onClick ? 'cursor-pointer' : 'cursor-default'}
      `}
      style={{ borderTopWidth: 3, borderTopColor: accentColor }}
    >
      <div className="px-4 pt-3 pb-3 flex items-start gap-3">
        <div
          className="mt-0.5 rounded-lg p-2 flex-shrink-0"
          style={{ background: accentColor + '18' }}
        >
          <Icon size={16} style={{ color: accentColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-500 font-medium mb-0.5">{label}</div>
          <div className="text-2xl font-bold text-slate-800 leading-none tabular-nums" style={{ color: urgent ? '#dc2626' : undefined }}>{value ?? '—'}</div>
          {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
        </div>
        {onClick && (
          <ArrowUpRight size={13} className="text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0 mt-1" />
        )}
      </div>
    </button>
  );
}

/* ── alert banner ────────────────────────────────────────────────────────── */
const ALERT_ROUTE = a => {
  if (a.id?.startsWith('checkin-'))  return PMS('/check-in');
  if (a.id?.startsWith('checkout-')) return PMS('/check-out');
  if (a.id?.startsWith('hk-'))       return PMS('/housekeeping');
  if (a.id?.startsWith('vip-'))      return PMS('/housekeeping');
  return PMS('/reservations');
};

function AlertBanner({ alert, onAction, onDismiss }) {
  const cfg = {
    warning: { bg:'#fffbeb', border:'#fcd34d', icon: AlertTriangle, color:'#b45309', textColor:'#78350f' },
    danger:  { bg:'#fef2f2', border:'#fca5a5', icon: AlertCircle,   color:'#dc2626', textColor:'#7f1d1d' },
    info:    { bg:'#eff6ff', border:'#93c5fd', icon: Info,           color:'#2563eb', textColor:'#1e3a8a' },
  }[alert.type] || { bg:'#f8fafc', border:'#cbd5e1', icon: Info, color:'#475569', textColor:'#1e293b' };
  const Icon = cfg.icon;
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl border text-sm"
      style={{ background: cfg.bg, borderColor: cfg.border }}
    >
      <Icon size={15} style={{ color: cfg.color, flexShrink:0 }} />
      <span className="flex-1 font-medium" style={{ color: cfg.textColor }}>{alert.text}</span>
      <button
        className="text-xs font-semibold px-3 py-1 rounded-lg border transition-colors hover:opacity-80"
        style={{ color: cfg.color, borderColor: cfg.border, background: 'white' }}
        onClick={() => onAction(ALERT_ROUTE(alert))}
      >
        לטיפול ←
      </button>
      <button onClick={() => onDismiss?.(alert.id)} className="text-slate-300 hover:text-slate-500 transition-colors">
        ✕
      </button>
    </div>
  );
}

/* ── section header ──────────────────────────────────────────────────────── */
function SectionHeader({ icon: Icon, title, badge, action, onAction, iconColor = '#475569' }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
      <div className="flex items-center gap-2.5">
        <Icon size={15} style={{ color: iconColor }} />
        <span className="font-semibold text-slate-700 text-sm">{title}</span>
        {badge != null && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 tabular-nums">{badge}</span>
        )}
      </div>
      {action && (
        <button
          onClick={onAction}
          className="text-xs text-indigo-600 font-medium hover:text-indigo-700 flex items-center gap-1 transition-colors"
        >
          {action} <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}

/* ── arrival row ─────────────────────────────────────────────────────────── */
function ArrivalRow({ res, onClick }) {
  const g = res.primaryGuest;
  const isVip = res.isVip || (g?.vipLevel && g.vipLevel !== 'none');
  const room = res.assignedRoom;
  const roomClean = room && ['clean','inspected'].includes(room.cleanStatus);
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50/70 cursor-pointer last:border-0 transition-colors"
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{
          background: isVip ? 'rgba(245,158,11,0.12)' : 'rgba(99,102,241,0.08)',
          color: isVip ? '#b45309' : '#6366f1',
        }}
      >
        {initials(g)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm text-slate-800 truncate">
            {g ? `${g.firstName} ${g.lastName}` : '—'}
          </span>
          {isVip && <Crown size={11} className="text-amber-500 flex-shrink-0" />}
        </div>
        <div className="text-xs text-slate-400">{res.roomType?.name}</div>
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        {room ? (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-md
            ${roomClean ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
            {roomClean ? `✓ ${room.number}` : `⚠ ${room.number}`}
          </span>
        ) : (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200">
            ללא חדר
          </span>
        )}
        <span className={`text-xs px-1.5 py-0.5 rounded
          ${res.paymentStatus === 'paid' ? 'text-emerald-600' : 'text-amber-600'}`}>
          {res.paymentStatus === 'paid' ? 'שולם' : 'Pending'}
        </span>
      </div>
    </div>
  );
}

/* ── departure row ───────────────────────────────────────────────────────── */
function DepartureRow({ res, onClick }) {
  const g = res.primaryGuest;
  const balanceDue = res.paymentStatus === 'balance_due';
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-5 py-3 border-b border-slate-50 cursor-pointer last:border-0 transition-colors
        ${balanceDue ? 'hover:bg-red-50/40' : 'hover:bg-slate-50/70'}`}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{
          background: balanceDue ? 'rgba(239,68,68,0.08)' : 'rgba(249,115,22,0.08)',
          color: balanceDue ? '#dc2626' : '#ea580c',
        }}
      >
        {initials(g)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm text-slate-800 truncate">
            {g ? `${g.firstName} ${g.lastName}` : '—'}
          </span>
          {balanceDue && <AlertCircle size={11} className="text-red-500 flex-shrink-0" />}
        </div>
        <div className="text-xs text-slate-400">{res.roomType?.name} · חדר {res.assignedRoom?.number || '—'}</div>
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border flex-shrink-0
        ${res.paymentStatus === 'paid'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-red-50 text-red-600 border-red-200'}`}>
        {res.paymentStatus === 'paid' ? 'שולם' : 'יתרה'}
      </span>
    </div>
  );
}

/* ── forecast strip ──────────────────────────────────────────────────────── */
function ForecastStrip({ daily, totalRooms }) {
  if (!daily?.length) return null;
  const todayS = todayStr();
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-5">
      <SectionHeader icon={Calendar} title="תחזית 7 ימים" iconColor="#6366f1" />
      <div className="p-4 grid grid-cols-7 gap-2">
        {daily.slice(0, 7).map((d) => {
          const { weekday, day } = fmtDayMini(d.date);
          const isToday = d.date === todayS;
          const occ = d.occupancy || 0;
          const occColor = occ >= 80 ? '#059669' : occ >= 50 ? '#d97706' : '#6366f1';
          return (
            <div
              key={d.date}
              className={`rounded-lg p-2 text-center border transition-all
                ${isToday ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-100 hover:border-slate-200 bg-slate-50/40'}
              `}
            >
              <div className={`text-xs font-semibold mb-0.5 ${isToday ? 'text-indigo-600' : 'text-slate-400'}`}>
                {isToday ? 'היום' : weekday}
              </div>
              <div className={`text-base font-bold tabular-nums ${isToday ? 'text-indigo-700' : 'text-slate-700'}`}>{day}</div>
              <div className="text-sm font-bold tabular-nums mt-1" style={{ color: occColor }}>{occ}%</div>
              <div className="text-xs text-slate-400">תפוסה</div>
              {(d.arrivals > 0 || d.departures > 0) && (
                <div className="flex justify-center gap-1 mt-1.5">
                  {d.arrivals  > 0 && <span className="text-xs text-indigo-600 font-medium">+{d.arrivals}</span>}
                  {d.departures > 0 && <span className="text-xs text-orange-500 font-medium">-{d.departures}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── HK mini ─────────────────────────────────────────────────────────────── */
function HkMini({ pending, inProgress, completed, urgent }) {
  const total = (pending || 0) + (inProgress || 0) + (completed || 0);
  const pct = total ? Math.round(((completed || 0) / total) * 100) : 0;
  return (
    <div className="p-4">
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'פתוח',   value: pending,    color: '#ea580c', bg: '#fff7ed' },
          { label: 'בביצוע', value: inProgress, color: '#2563eb', bg: '#eff6ff' },
          { label: 'הושלם',  value: completed,  color: '#059669', bg: '#f0fdf4' },
          { label: 'דחוף',   value: urgent,     color: '#dc2626', bg: '#fef2f2' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="text-center rounded-lg py-2" style={{ background: bg }}>
            <div className="text-xl font-bold tabular-nums" style={{ color }}>{value ?? 0}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>
      {total > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>התקדמות יומית</span>
            <span className="font-semibold tabular-nums">{pct}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

/* ── room health bar ─────────────────────────────────────────────────────── */
function RoomHealthBar({ clean, dirty, ooo, hold, occupied, total }) {
  if (!total) return null;
  const pct = n => `${Math.round(((n || 0) / total) * 100)}%`;
  const segs = [
    { label: 'נקי/פנוי', value: clean,    color: '#10b981' },
    { label: 'תפוס',     value: occupied, color: '#6366f1' },
    { label: 'מלוכלך',   value: dirty,    color: '#f59e0b' },
    { label: 'OOO',      value: ooo,      color: '#ef4444' },
    { label: 'Hold',     value: hold,     color: '#94a3b8' },
  ].filter(s => s.value > 0);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BedDouble size={14} className="text-slate-500" />
          <span className="font-semibold text-slate-700 text-sm">מצב חדרים — {total} סה"כ</span>
        </div>
        <div className="flex gap-4 flex-wrap">
          {segs.map(s => (
            <span key={s.label} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: s.color }} />
              {s.label} <span className="font-semibold tabular-nums text-slate-700">{s.value}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex rounded-lg overflow-hidden h-2.5 bg-slate-100">
        {segs.map(s => (
          <div
            key={s.label}
            style={{ width: pct(s.value), background: s.color, minWidth: s.value > 0 ? 4 : 0 }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
    </div>
  );
}

/* ── occupancy chart ─────────────────────────────────────────────────────── */
function OccTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs" dir="rtl">
      <div className="font-semibold text-slate-700 mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-slate-500">{p.dataKey === 'occupancy' ? 'תפוסה' : 'הכנסות'}:</span>
          <span className="font-semibold tabular-nums">{p.dataKey === 'occupancy' ? `${p.value}%` : `₪${Number(p.value).toLocaleString('he-IL')}`}</span>
        </div>
      ))}
    </div>
  );
}

function OccupancyChart({ daily, totalRooms }) {
  if (!daily?.length) return null;
  const today = todayStr();
  const chartData = daily.map(d => ({
    day: fmtDayShort(d.date),
    occupancy: totalRooms ? Math.round((d.occupied / totalRooms) * 100) : d.occupancy || 0,
    date: d.date,
  }));
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={14} className="text-indigo-500" />
        <span className="font-semibold text-slate-700 text-sm">תפוסה — 7 ימים אחרונים</span>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={chartData} barSize={14} margin={{ top:4, right:4, bottom:0, left:-24 }}>
          <CartesianGrid vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="day" tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false} domain={[0,100]} unit="%" />
          <Tooltip content={<OccTooltip />} cursor={{ fill:'rgba(99,102,241,0.04)' }} />
          <Bar dataKey="occupancy" radius={[3,3,0,0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.date === today ? '#6366f1' : '#c7d2fe'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── main page ───────────────────────────────────────────────────────────── */
export default function DashboardPage() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const skip = !propertyId;
  const today = todayStr();
  const from7 = addDaysStr(today, -6);

  const [dismissed, setDismissed] = useState(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  // auto-refresh every 3 minutes
  useEffect(() => {
    const id = setInterval(() => setRefreshKey(k => k + 1), 180000);
    return () => clearInterval(id);
  }, []);

  const { data: statsRaw,    loading: l1, error: e1, refetch } = useApi(() => dashboard.stats(propertyId),      [propertyId, refreshKey], skip);
  const { data: alertsRaw,   loading: l2 }                     = useApi(() => dashboard.alerts(propertyId),     [propertyId, refreshKey], skip);
  const { data: arrData,     loading: l3 }                     = useApi(() => dashboard.arrivals(propertyId),   [propertyId, refreshKey], skip);
  const { data: depData,     loading: l4 }                     = useApi(() => dashboard.departures(propertyId), [propertyId, refreshKey], skip);
  const { data: inHouseData, loading: l5 }                     = useApi(() => dashboard.inhouse(propertyId),    [propertyId, refreshKey], skip);
  const { data: reportRaw,   loading: l6 }                     = useApi(() => reports.summary(propertyId, from7, addDaysStr(today, 1)), [propertyId, refreshKey], skip);
  const { data: forecastRaw, loading: l7 }                     = useApi(() => reports.summary(propertyId, today, addDaysStr(today, 8)), [propertyId, refreshKey], skip);

  if (skip || l1 || l2 || l3 || l4 || l5) return <PageSpinner />;
  if (e1) return <ErrorState message={e1} onRetry={refetch} />;

  const s          = statsRaw || {};
  const arrivals   = arrData    || [];
  const departures = depData    || [];
  const inhouse    = inHouseData || [];
  const daily      = reportRaw?.daily  || [];
  const forecast   = forecastRaw?.daily || [];
  const todayDaily = forecast[0];

  const activeAlerts  = (alertsRaw || []).filter(a => !dismissed.has(a.id));
  const isRefreshing  = l1 || l2 || l3 || l4 || l5 || l6 || l7;

  const sortedArrivals = [...arrivals].sort((a, b) => {
    const score = r => (r.isVip ? 10 : 0) + (r.assignedRoom ? 5 : 0);
    return score(b) - score(a);
  });

  const todayLong = new Date().toLocaleDateString('he-IL', {
    weekday:'long', day:'numeric', month:'long', year:'numeric',
  });

  function handleRefresh() {
    setIsManualRefresh(true);
    setRefreshKey(k => k + 1);
    setTimeout(() => setIsManualRefresh(false), 1500);
  }

  return (
    <div className="animate-fade-in" dir="rtl">

      {/* ══════════════════════════════════════════════════════════════════════
          HEADER STRIP — dark slate, professional
      ══════════════════════════════════════════════════════════════════════ */}
      <div
        className="rounded-2xl mb-6 px-6 py-5 flex items-center justify-between"
        style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          boxShadow: '0 4px 24px rgba(15,23,42,0.18)',
        }}
      >
        {/* Left: date + property */}
        <div>
          <div className="text-white/50 text-xs font-medium uppercase tracking-widest mb-1">לוח בקרה תפעולי</div>
          <div className="text-white text-lg font-semibold">{todayLong}</div>
          <div className="flex items-center gap-3 mt-2">
            <span className="flex items-center gap-1.5 text-white/60 text-xs">
              <span className={`w-2 h-2 rounded-full ${isRefreshing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
              {isRefreshing ? 'מרענן…' : 'עדכני'}
            </span>
          </div>
        </div>

        {/* Center: key live numbers */}
        <div className="hidden md:flex items-center gap-8">
          {[
            { label: 'הגעות', value: s.arrivals   || 0, color: '#a78bfa' },
            { label: 'In House', value: s.inHouse  || 0, color: '#60a5fa' },
            { label: 'יציאות', value: s.departures || 0, color: '#fb923c' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <div className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</div>
              <div className="text-white/50 text-xs mt-0.5">{label}</div>
            </div>
          ))}
          <div className="h-10 w-px bg-white/10" />
          <div className="text-center">
            <div className="text-3xl font-bold tabular-nums text-emerald-400">{s.occupancy || 0}%</div>
            <div className="text-white/50 text-xs mt-0.5">תפוסה</div>
          </div>
        </div>

        {/* Right: clock + refresh */}
        <div className="flex flex-col items-end gap-3">
          <LiveClock />
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors text-xs"
          >
            <RefreshCw size={12} className={isManualRefresh ? 'animate-spin' : ''} />
            רענן
          </button>
        </div>
      </div>

      {/* ── alerts ── */}
      {activeAlerts.length > 0 && (
        <div className="flex flex-col gap-2 mb-5">
          {activeAlerts.map(a => (
            <AlertBanner key={a.id} alert={a} onAction={navigate} onDismiss={id => setDismissed(prev => new Set([...prev, id]))} />
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          KPI GRID
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <KpiCard icon={LogIn}     label="הגעות היום"    value={s.arrivals}   accentColor="#7c3aed"
          sub={s.vipArrivals > 0 ? `${s.vipArrivals} VIP` : 'ציפויים היום'}
          onClick={() => navigate(PMS('/check-in'))} />
        <KpiCard icon={LogOut}    label="יציאות היום"   value={s.departures} accentColor="#ea580c"
          sub={s.openBalances > 0 ? `${s.openBalances} יתרות פתוחות` : 'לתשלום'}
          urgent={s.openBalances > 0}
          onClick={() => navigate(PMS('/check-out'))} />
        <KpiCard icon={Users}     label="In House"      value={s.inHouse}    accentColor="#2563eb"
          sub={`תפוסה ${s.occupancy || 0}%`}
          onClick={() => navigate(PMS('/reservations'))} />
        <KpiCard icon={BedDouble} label="חדרים נקיים"  value={s.cleanRooms} accentColor="#059669"
          sub={`${s.dirtyRooms || 0} ממתינים לניקיון`}
          onClick={() => navigate(PMS('/rooms'))} />
        <KpiCard icon={Sparkles}  label="משימות HK"     value={s.hkPending}  accentColor="#b45309"
          sub={s.hkUrgent > 0 ? `${s.hkUrgent} דחופות` : 'משימות פתוחות'}
          urgent={s.hkUrgent > 0}
          onClick={() => navigate(PMS('/housekeeping'))} />
        <KpiCard icon={Wrench}    label="Out of Order"  value={s.oooRooms}   accentColor="#dc2626"
          sub={`${s.maintenanceOpen || 0} תקלות פתוחות`}
          urgent={s.oooRooms > 0}
          onClick={() => navigate(PMS('/maintenance'))} />
      </div>

      {/* ── Revenue KPIs ── */}
      {!l6 && todayDaily && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { icon: DollarSign, label: 'הכנסות היום',      value: fmtMoney(todayDaily.revenue || 0),                                            color: '#059669' },
            { icon: Target,     label: 'ADR',               value: fmtMoney(s.arrivals > 0 ? Math.round((todayDaily.revenue||0)/s.arrivals) : 0), color: '#6366f1' },
            { icon: BarChart2,  label: 'RevPAR',            value: fmtMoney(s.totalRooms > 0 ? Math.round((todayDaily.revenue||0)/s.totalRooms) : 0), color: '#0891b2' },
            { icon: Activity,   label: 'הזמנות החודש',      value: s.monthReservations ?? '—',                                                   color: '#d97706' },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3">
              <div className="rounded-lg p-2 flex-shrink-0" style={{ background: color + '12' }}>
                <Icon size={15} style={{ color }} />
              </div>
              <div>
                <div className="text-xs text-slate-400 font-medium">{label}</div>
                <div className="text-lg font-bold tabular-nums text-slate-800">{value}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-5">
        <SectionHeader icon={Star} title="פעולות מהירות" iconColor="#6366f1" />
        <div className="p-4 grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { icon: LogIn,     label: "צ'ק-אין",     route: PMS('/check-in'),     color: '#7c3aed', bg: 'rgba(139,92,246,0.08)' },
            { icon: LogOut,    label: "צ'ק-אאוט",    route: PMS('/check-out'),    color: '#ea580c', bg: 'rgba(249,115,22,0.08)' },
            { icon: Plus,      label: 'הזמנה חדשה',  route: PMS('/reservations/new'), color: '#059669', bg: 'rgba(16,185,129,0.08)' },
            { icon: BedDouble, label: 'Tape Chart',   route: PMS('/tape-chart'),   color: '#2563eb', bg: 'rgba(59,130,246,0.08)' },
            { icon: Calendar,  label: 'הזמנות',      route: PMS('/reservations'), color: '#0891b2', bg: 'rgba(6,182,212,0.08)'  },
            { icon: Sparkles,  label: 'חדרנות',      route: PMS('/housekeeping'), color: '#b45309', bg: 'rgba(180,83,9,0.08)'   },
          ].map(({ icon: Icon, label, route, color, bg }) => (
            <button
              key={label}
              onClick={() => navigate(route)}
              className="flex flex-col items-center gap-2 p-3 rounded-xl border border-slate-100 hover:border-slate-300 hover:shadow-sm transition-all"
              style={{ background: bg }}
            >
              <div className="rounded-lg p-2" style={{ background: bg, border: `1px solid ${color}22` }}>
                <Icon size={16} style={{ color }} />
              </div>
              <span className="text-xs font-medium text-slate-600">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Room Health ── */}
      <RoomHealthBar
        clean={s.cleanRooms}
        dirty={s.dirtyRooms}
        ooo={s.oooRooms}
        hold={s.holdRooms}
        occupied={s.inHouse}
        total={s.totalRooms}
      />

      {/* ══════════════════════════════════════════════════════════════════════
          ARRIVALS | DEPARTURES | RIGHT COLUMN
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">

        {/* Arrivals */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <SectionHeader
            icon={LogIn} title="הגעות היום" iconColor="#7c3aed"
            badge={arrivals.length}
            action={arrivals.length > 0 ? "לדף צ'ק-אין" : undefined}
            onAction={() => navigate(PMS('/check-in'))}
          />
          {!arrivals.length ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-300">
              <LogIn size={30} className="mb-2 opacity-40" />
              <span className="text-sm">אין הגעות היום</span>
            </div>
          ) : (
            <>
              {sortedArrivals.slice(0, 7).map(res => (
                <ArrivalRow key={res._id} res={res} onClick={() => navigate(PMS('/check-in'))} />
              ))}
              {arrivals.length > 7 && (
                <div className="px-5 py-2 text-xs text-slate-400 text-center border-t border-slate-50">
                  ועוד {arrivals.length - 7} הגעות נוספות
                </div>
              )}
              <div className="px-5 py-3 border-t border-slate-100">
                <button
                  className="w-full py-2 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90"
                  style={{ background: '#7c3aed' }}
                  onClick={() => navigate(PMS('/check-in'))}
                >
                  <LogIn size={14} /> לדף צ'ק-אין
                </button>
              </div>
            </>
          )}
        </div>

        {/* Departures */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <SectionHeader
            icon={LogOut} title="יציאות היום" iconColor="#ea580c"
            badge={departures.length}
            action={departures.length > 0 ? "לדף צ'ק-אאוט" : undefined}
            onAction={() => navigate(PMS('/check-out'))}
          />
          {!departures.length ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-300">
              <LogOut size={30} className="mb-2 opacity-40" />
              <span className="text-sm">אין יציאות היום</span>
            </div>
          ) : (
            <>
              {departures.slice(0, 7).map(res => (
                <DepartureRow key={res._id} res={res} onClick={() => navigate(PMS('/check-out'))} />
              ))}
              {departures.length > 7 && (
                <div className="px-5 py-2 text-xs text-slate-400 text-center border-t border-slate-50">
                  ועוד {departures.length - 7} יציאות נוספות
                </div>
              )}
              <div className="px-5 py-3 border-t border-slate-100">
                <button
                  className="w-full py-2 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90"
                  style={{ background: '#ea580c' }}
                  onClick={() => navigate(PMS('/check-out'))}
                >
                  <LogOut size={14} /> לדף צ'ק-אאוט
                </button>
              </div>
            </>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">

          {/* Chart */}
          {!l6 && daily.length > 0 && (
            <OccupancyChart daily={daily} totalRooms={s.totalRooms} />
          )}

          {/* HK widget */}
          <div
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(PMS('/housekeeping'))}
          >
            <SectionHeader
              icon={Sparkles} title="חדרנות" iconColor="#b45309"
              action="לניהול"
              onAction={() => navigate(PMS('/housekeeping'))}
            />
            <HkMini
              pending={s.hkPending}
              inProgress={s.hkInProgress}
              completed={s.hkCompleted}
              urgent={s.hkUrgent}
            />
          </div>

          {/* Maintenance mini */}
          <div
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(PMS('/maintenance'))}
          >
            <SectionHeader icon={Wrench} title="תחזוקה פתוחה" iconColor="#dc2626" action="לניהול" onAction={() => navigate(PMS('/maintenance'))} />
            <div className="px-5 py-4 flex items-center gap-4">
              <div className={`text-4xl font-bold tabular-nums ${(s.maintenanceOpen || 0) > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {s.maintenanceOpen ?? 0}
              </div>
              <div className="text-sm text-slate-500">
                {(s.maintenanceOpen || 0) > 0 ? 'תקלות פתוחות הדורשות טיפול' : 'כל התקלות טופלו ✓'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 7-day forecast ── */}
      {!l7 && forecast.length > 0 && (
        <ForecastStrip daily={forecast} totalRooms={s.totalRooms} />
      )}

      {/* ── In-House Table ── */}
      {inhouse.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <SectionHeader
            icon={Users} title="אורחים בבית" iconColor="#2563eb"
            badge={inhouse.length}
            action="כל ההזמנות"
            onAction={() => navigate(PMS('/reservations'))}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100">
                  {['אורח', 'חדר', 'סוג חדר', 'יציאה', 'נותרו', 'תשלום'].map(h => (
                    <th key={h} className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inhouse.slice(0, 10).map(res => {
                  const g = res.primaryGuest;
                  const dep = res.departureDate;
                  const leavesToday    = dep === today;
                  const leavesTomorrow = dep === addDaysStr(today, 1);
                  const nightsLeft = dep
                    ? Math.max(0, Math.ceil((new Date(dep + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000))
                    : null;
                  return (
                    <tr
                      key={res._id}
                      className={`border-b border-slate-50 cursor-pointer transition-colors
                        ${leavesToday ? 'bg-amber-50/30 hover:bg-amber-50/50' : leavesTomorrow ? 'hover:bg-blue-50/20' : 'hover:bg-slate-50/60'}
                      `}
                      onClick={() => navigate(PMS('/folio'))}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          {res.isVip && <Crown size={11} className="text-amber-500" />}
                          <span className="font-medium text-sm text-slate-800">
                            {g ? `${g.firstName} ${g.lastName}` : '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-bold text-sm tabular-nums text-slate-700">{res.assignedRoom?.number || '—'}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">{res.roomType?.name}</td>
                      <td className={`px-5 py-3 text-sm tabular-nums
                        ${leavesToday ? 'text-amber-600 font-semibold' : leavesTomorrow ? 'text-blue-600 font-medium' : 'text-slate-600'}`}>
                        {fmtDate(dep)}
                        {leavesToday    && <span className="mr-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">היום</span>}
                        {leavesTomorrow && <span className="mr-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">מחר</span>}
                      </td>
                      <td className="px-5 py-3">
                        {nightsLeft !== null && (
                          <span className={`text-sm font-semibold tabular-nums
                            ${nightsLeft === 0 ? 'text-amber-600' : nightsLeft === 1 ? 'text-blue-600' : 'text-slate-400'}`}>
                            {nightsLeft === 0 ? 'יוצא היום' : `${nightsLeft}`}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border
                          ${res.paymentStatus === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : res.paymentStatus === 'balance_due'
                              ? 'bg-red-50 text-red-600 border-red-200'
                              : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
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
            <div className="px-5 py-3 text-xs text-slate-400 text-center border-t border-slate-100">
              ועוד {inhouse.length - 10} אורחים —{' '}
              <button className="text-indigo-500 hover:text-indigo-600 font-medium transition-colors" onClick={() => navigate(PMS('/reservations'))}>
                לכל ההזמנות
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
