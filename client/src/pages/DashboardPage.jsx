import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogIn, LogOut, Users, BedDouble, Sparkles, Wrench, AlertTriangle,
  AlertCircle, Info, Crown, TrendingUp, RefreshCw, Plus, Calendar, X,
  ChevronRight, Clock, DollarSign, Target, BarChart2, Star,
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
function fmtCountdown(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

/* ── live clock ──────────────────────────────────────────────────────────── */
function LiveClock() {
  const fmt = () => new Date().toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' });
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 30000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-sm text-ink-muted tabular-nums">{time}</span>;
}

/* ── stat card ───────────────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, sub, color, bgColor, urgent, onClick }) {
  return (
    <div
      className={`stat-card transition-all
        ${urgent ? 'ring-2 ring-red-300 bg-red-50/40' : ''}
        ${onClick ? 'cursor-pointer hover:shadow-card-hover' : ''}
      `}
      onClick={onClick}
    >
      <div className="stat-icon" style={{ background: bgColor }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink-muted font-medium truncate">{label}</div>
        <div className="text-2xl font-bold text-ink leading-tight text-num">{value ?? '—'}</div>
        {sub && <div className="text-xs text-ink-faint mt-0.5">{sub}</div>}
      </div>
      {urgent && <AlertCircle size={14} className="text-red-500 flex-shrink-0 self-start mt-1" />}
    </div>
  );
}

/* ── revenue kpis strip ──────────────────────────────────────────────────── */
function RevenueKpis({ todayDaily, totalRooms, occupancy }) {
  const rev     = todayDaily?.revenue    || 0;
  const arr     = todayDaily?.arrivals   || 0;
  const adr     = arr > 0 ? Math.round(rev / arr) : 0;
  const revpar  = totalRooms > 0 ? Math.round(rev / totalRooms) : 0;

  const kpis = [
    {
      icon: DollarSign,
      label: 'הכנסות היום',
      value: fmtMoney(rev),
      color: '#059669',
      bg: 'rgba(16,185,129,0.08)',
      border: 'border-emerald-200',
    },
    {
      icon: Target,
      label: 'ADR',
      value: fmtMoney(adr),
      sub: 'ממוצע לחדר',
      color: '#6366f1',
      bg: 'rgba(99,102,241,0.08)',
      border: 'border-indigo-200',
    },
    {
      icon: BarChart2,
      label: 'RevPAR',
      value: fmtMoney(revpar),
      sub: 'הכנסה לחדר זמין',
      color: '#0891b2',
      bg: 'rgba(6,182,212,0.08)',
      border: 'border-cyan-200',
    },
    {
      icon: BedDouble,
      label: 'תפוסה',
      value: `${occupancy || 0}%`,
      sub: `${todayDaily?.occupied || 0} / ${totalRooms || 0} חדרים`,
      color: '#d97706',
      bg: 'rgba(245,158,11,0.08)',
      border: 'border-amber-200',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {kpis.map(({ icon: Icon, label, value, sub, color, bg, border }) => (
        <div
          key={label}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${border}`}
          style={{ background: bg }}
        >
          <div className="rounded-lg p-2 flex-shrink-0" style={{ background: `${bg}`, border: `1px solid ${border}` }}>
            <Icon size={16} style={{ color }} />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-ink-muted font-medium">{label}</div>
            <div className="text-lg font-bold text-num leading-tight" style={{ color }}>{value}</div>
            {sub && <div className="text-xs text-ink-faint">{sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── vip callout ─────────────────────────────────────────────────────────── */
function VipCallout({ arrivals, onNavigate }) {
  const vips = arrivals.filter(r => r.isVip || (r.primaryGuest?.vipLevel && r.primaryGuest.vipLevel > 0));
  if (!vips.length) return null;

  const VIP_LEVEL_LABEL = { 1:'VIP', 2:'VIP++', 3:'SVIP', 4:'Diamond', 5:'Celebrity' };

  return (
    <div className="mb-4 rounded-xl border border-amber-300 overflow-hidden"
      style={{ background: 'linear-gradient(135deg,rgba(254,243,199,0.6) 0%,rgba(255,255,255,0.8) 100%)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200"
        style={{ background: 'rgba(245,158,11,0.08)' }}>
        <Crown size={14} className="text-amber-500" />
        <span className="font-semibold text-amber-800 text-sm">
          {vips.length} אורח{vips.length > 1 ? 'ים' : ''} VIP מגיע{vips.length > 1 ? 'ים' : ''} היום
        </span>
        <span className="mr-auto text-xs text-amber-600">טיפול מיוחד נדרש</span>
      </div>
      <div className="divide-y divide-amber-100">
        {vips.map(res => {
          const g = res.primaryGuest;
          const room = res.assignedRoom;
          const roomReady = room && ['clean','inspected'].includes(room.cleanStatus);
          const level = g?.vipLevel || 1;
          return (
            <div
              key={res._id}
              onClick={() => onNavigate('/check-in')}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-amber-50/60 transition-colors"
            >
              <div className="avatar flex-shrink-0"
                style={{ width:34, height:34, fontSize:12, background:'rgba(245,158,11,0.15)', color:'#b45309' }}>
                {initials(g)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-ink">
                    {g ? `${g.firstName} ${g.lastName}` : '—'}
                  </span>
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                    style={{ background:'rgba(245,158,11,0.15)', color:'#b45309' }}>
                    {VIP_LEVEL_LABEL[level] || 'VIP'}
                  </span>
                </div>
                <div className="text-xs text-ink-muted">{res.roomType?.name}</div>
              </div>
              <div className="flex-shrink-0 flex flex-col items-end gap-1">
                {room ? (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                    ${roomReady ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {roomReady ? `חדר ${room.number} מוכן ✓` : `חדר ${room.number} לא נקי!`}
                  </span>
                ) : (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                    ⚠ ללא חדר
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 7-day forecast strip ────────────────────────────────────────────────── */
function ForecastStrip({ daily, totalRooms }) {
  if (!daily?.length) return null;
  const todayS = todayStr();

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar size={14} className="text-brand" />
        <span className="font-semibold text-ink text-sm">תחזית 7 ימים</span>
        <span className="text-xs text-ink-muted mr-auto">הגעות / יציאות / תפוסה</span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {daily.slice(0, 7).map((d, i) => {
          const { weekday, day, month } = fmtDayMini(d.date);
          const isToday = d.date === todayS;
          const occ = d.occupancy || 0;
          const occColor = occ >= 80 ? '#059669' : occ >= 50 ? '#d97706' : '#6366f1';
          const occBg    = occ >= 80 ? 'rgba(16,185,129,0.08)' : occ >= 50 ? 'rgba(245,158,11,0.08)' : 'rgba(99,102,241,0.06)';

          return (
            <div
              key={d.date}
              className={`rounded-lg p-2 text-center border transition-all
                ${isToday
                  ? 'border-indigo-300 ring-2 ring-indigo-200'
                  : 'border-surface-border hover:border-brand/30'}
              `}
              style={{ background: isToday ? 'rgba(99,102,241,0.06)' : occBg }}
            >
              <div className={`text-xs font-medium mb-0.5 ${isToday ? 'text-indigo-600' : 'text-ink-muted'}`}>
                {isToday ? 'היום' : weekday}
              </div>
              <div className={`text-base font-bold text-num ${isToday ? 'text-indigo-700' : 'text-ink'}`}>
                {day}
              </div>
              <div className="text-xs text-ink-faint mb-1.5">{month}</div>
              <div className="text-base font-bold text-num" style={{ color: occColor }}>
                {occ}%
              </div>
              <div className="flex justify-center gap-1.5 mt-1">
                <span className="flex items-center gap-0.5 text-xs text-violet-600" title="הגעות">
                  <LogIn size={9} />
                  {d.arrivals || 0}
                </span>
                <span className="flex items-center gap-0.5 text-xs text-orange-500" title="יציאות">
                  <LogOut size={9} />
                  {d.departures || 0}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── alert banner ────────────────────────────────────────────────────────── */
const ALERT_ROUTE = a => {
  if (a.id?.startsWith('noroom-'))  return '/room-rack';
  if (a.id?.startsWith('balance-')) return '/check-out';
  if (a.id?.startsWith('hk-'))      return '/housekeeping';
  if (a.id?.startsWith('vip-'))     return '/housekeeping';
  return '/reservations';
};
function AlertBanner({ alert, onAction, onDismiss }) {
  const map = {
    warning: { cls:'alert-warning', Icon:AlertTriangle, color:'#d97706' },
    danger:  { cls:'alert-danger',  Icon:AlertCircle,   color:'#dc2626' },
    info:    { cls:'alert-info',    Icon:Info,           color:'#6366f1' },
  };
  const { cls, Icon, color } = map[alert.type] || map.info;
  return (
    <div className={`alert-banner ${cls} group`}>
      <Icon size={15} style={{ color, flexShrink:0 }} />
      <span className="flex-1 text-sm">{alert.text}</span>
      <button className="btn btn-ghost btn-sm text-xs font-semibold" style={{ color }}
        onClick={() => onAction(ALERT_ROUTE(alert))}>
        פעולה ←
      </button>
      <button className="opacity-0 group-hover:opacity-100 transition-opacity ml-1"
        onClick={() => onDismiss?.(alert.id)}>
        <X size={13} className="text-ink-faint hover:text-ink" />
      </button>
    </div>
  );
}

/* ── priority strip ──────────────────────────────────────────────────────── */
function PriorityStrip({ unassigned, openBalances, onNavigate }) {
  if (!unassigned && !openBalances) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {unassigned > 0 && (
        <button
          onClick={() => onNavigate('/room-rack')}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
        >
          <AlertCircle size={15} />
          <span>{unassigned} הגעות ללא חדר מוקצה</span>
          <ChevronRight size={13} />
        </button>
      )}
      {openBalances > 0 && (
        <button
          onClick={() => onNavigate('/check-out')}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
        >
          <AlertTriangle size={15} />
          <span>{openBalances} יציאות עם יתרה לתשלום</span>
          <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}

/* ── quick actions ───────────────────────────────────────────────────────── */
const QUICK_ACTIONS = [
  { icon: LogIn,     label: "צ'ק-אין",     route: '/check-in',     color: '#7c3aed', bg: 'rgba(139,92,246,0.1)' },
  { icon: LogOut,    label: "צ'ק-אאוט",    route: '/check-out',    color: '#ea580c', bg: 'rgba(249,115,22,0.1)' },
  { icon: Plus,      label: 'הזמנה חדשה',  route: '/reservations', color: '#059669', bg: 'rgba(16,185,129,0.1)' },
  { icon: BedDouble, label: 'שיבוץ חדרים', route: '/room-rack',    color: '#2563eb', bg: 'rgba(59,130,246,0.1)' },
  { icon: Calendar,  label: 'הזמנות',      route: '/reservations', color: '#0891b2', bg: 'rgba(6,182,212,0.1)'  },
  { icon: Sparkles,  label: 'חדרנות',      route: '/housekeeping', color: '#b45309', bg: 'rgba(180,83,9,0.1)'   },
];
function QuickActions({ onNavigate }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
      {QUICK_ACTIONS.map(({ icon: Icon, label, route, color, bg }) => (
        <button
          key={label}
          onClick={() => onNavigate(route)}
          className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-surface-border hover:border-brand/40 hover:shadow-card transition-all"
          style={{ background: bg + '40' }}
        >
          <div className="rounded-lg p-1.5" style={{ background: bg }}>
            <Icon size={16} style={{ color }} />
          </div>
          <span className="text-xs font-medium text-ink-secondary">{label}</span>
        </button>
      ))}
    </div>
  );
}

/* ── room health bar ─────────────────────────────────────────────────────── */
function RoomHealthBar({ clean, dirty, ooo, hold, occupied, total }) {
  if (!total) return null;
  const pct = n => `${Math.round(((n || 0) / total) * 100)}%`;
  const segs = [
    { label: 'נקי/פנוי', value: clean,    color: '#059669' },
    { label: 'מלוכלך',   value: dirty,    color: '#f59e0b' },
    { label: 'תפוס',     value: occupied, color: '#6366f1' },
    { label: 'OOO',      value: ooo,      color: '#dc2626' },
    { label: 'Hold',     value: hold,     color: '#94a3b8' },
  ].filter(s => s.value > 0);
  return (
    <div className="card px-4 py-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-ink-secondary">מצב חדרים — {total} סה"כ</span>
        <div className="flex gap-3 flex-wrap">
          {segs.map(s => (
            <span key={s.label} className="flex items-center gap-1 text-xs text-ink-muted">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.color }} />
              {s.label} ({s.value || 0})
            </span>
          ))}
        </div>
      </div>
      <div className="flex rounded-full overflow-hidden h-3 gap-px bg-surface-hover">
        {segs.map(s => (
          <div key={s.label} style={{ width: pct(s.value), background: s.color, minWidth: s.value > 0 ? 4 : 0 }}
            title={`${s.label}: ${s.value}`} />
        ))}
      </div>
    </div>
  );
}

/* ── occupancy chart ─────────────────────────────────────────────────────── */
function OccTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-surface-border rounded-lg shadow-card px-3 py-2 text-xs" style={{ direction:'rtl' }}>
      <div className="font-semibold text-ink mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-muted">{p.dataKey === 'occupancy' ? 'תפוסה' : 'הכנסות'}:</span>
          <span className="font-medium text-num">{p.dataKey === 'occupancy' ? `${p.value}%` : `₪${Number(p.value).toLocaleString('he-IL')}`}</span>
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
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={14} className="text-brand" />
        <span className="font-semibold text-ink text-sm">תפוסה 7 ימים אחרונים</span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={chartData} barSize={14} margin={{ top:4, right:4, bottom:0, left:-24 }}>
          <CartesianGrid vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="day" tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false} domain={[0,100]} unit="%" />
          <Tooltip content={<OccTooltip />} cursor={{ fill:'rgba(99,102,241,0.05)' }} />
          <Bar dataKey="occupancy" radius={[3,3,0,0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.date === today ? '#6366f1' : '#a5b4fc'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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
      className="flex items-center gap-3 px-4 py-3 border-b border-surface-hover hover:bg-surface-hover cursor-pointer last:border-0 transition-colors"
    >
      <div
        className="avatar text-xs font-bold flex-shrink-0"
        style={{ background: isVip ? 'rgba(245,158,11,0.15)' : 'rgba(99,102,241,0.1)', color: isVip ? '#d97706' : '#6366f1', width:30, height:30, fontSize:11 }}
      >
        {initials(g)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold text-ink truncate">
            {g ? `${g.firstName} ${g.lastName}` : '—'}
          </span>
          {isVip && <Crown size={11} className="text-amber-500 flex-shrink-0" />}
        </div>
        <div className="text-xs text-ink-muted">{res.roomType?.name} · {res.adults || 1} אורחים</div>
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
        {room ? (
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${roomClean ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            חדר {room.number}
          </span>
        ) : (
          <span className="badge badge-dirty text-xs">ללא חדר!</span>
        )}
        <span className={`badge text-xs ${res.paymentStatus === 'paid' ? 'badge-clean' : res.paymentStatus === 'balance_due' ? 'badge-dirty' : 'badge-pending'}`}>
          {res.paymentStatus === 'paid' ? 'שולם' : res.paymentStatus === 'balance_due' ? 'יתרה' : 'Pending'}
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
      className={`flex items-center gap-3 px-4 py-3 border-b border-surface-hover cursor-pointer last:border-0 transition-colors
        ${balanceDue ? 'bg-red-50/30 hover:bg-red-50/50' : 'hover:bg-surface-hover'}
      `}
    >
      <div
        className="avatar text-xs font-bold flex-shrink-0"
        style={{ background: balanceDue ? 'rgba(239,68,68,0.1)' : 'rgba(249,115,22,0.1)', color: balanceDue ? '#dc2626' : '#ea580c', width:30, height:30, fontSize:11 }}
      >
        {initials(g)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold text-ink truncate">
            {g ? `${g.firstName} ${g.lastName}` : '—'}
          </span>
          {balanceDue && <AlertCircle size={11} className="text-red-500 flex-shrink-0" />}
        </div>
        <div className="text-xs text-ink-muted">{res.roomType?.name} · חדר {res.assignedRoom?.number || '—'}</div>
      </div>
      <span className={`badge flex-shrink-0 ${res.paymentStatus === 'paid' ? 'badge-clean' : 'badge-dirty'}`}>
        {res.paymentStatus === 'paid' ? 'שולם' : 'יתרה'}
      </span>
    </div>
  );
}

/* ── HK progress bar ─────────────────────────────────────────────────────── */
function HkProgress({ pending, inProgress, completed, urgent }) {
  const total = (pending || 0) + (inProgress || 0) + (completed || 0);
  const pct = total ? Math.round(((completed || 0) / total) * 100) : 0;
  return (
    <>
      <div className="px-4 pb-3 grid grid-cols-4 gap-2">
        {[
          { label: 'פתוח',   value: pending,    color: '#ea580c' },
          { label: 'בביצוע', value: inProgress, color: '#2563eb' },
          { label: 'הושלם',  value: completed,  color: '#059669' },
          { label: 'דחוף',   value: urgent,     color: '#dc2626', ring: urgent > 0 },
        ].map(({ label, value, color, ring }) => (
          <div key={label} className={`text-center p-2 rounded-lg ${ring ? 'ring-1 ring-red-300 bg-red-50' : 'bg-surface-hover'}`}>
            <div className="text-xl font-bold text-num" style={{ color }}>{value ?? 0}</div>
            <div className="text-xs text-ink-muted">{label}</div>
          </div>
        ))}
      </div>
      {total > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
            <span>התקדמות יומית</span>
            <span className="font-semibold text-num">{pct}%</span>
          </div>
          <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </>
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

  // ── auto-refresh every 2 minutes ──────────────────────────────────────────
  const [refreshKey, setRefreshKey] = useState(0);
  const [countdown, setCountdown] = useState(120);
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { setRefreshKey(k => k + 1); return 120; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // ── data fetching ─────────────────────────────────────────────────────────
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
  const daily      = reportRaw?.daily || [];
  const forecast   = forecastRaw?.daily || [];

  const activeAlerts = (alertsRaw || []).filter(a => !dismissed.has(a.id));
  const todayDaily   = forecast[0]; // today's data from the forward-looking report

  // VIP arrivals first, then unassigned last
  const sortedArrivals = [...arrivals].sort((a, b) => {
    const score = r => (r.isVip ? 10 : 0) + (r.assignedRoom ? 5 : 0);
    return score(b) - score(a);
  });

  const todayLabel = new Date().toLocaleDateString('he-IL', {
    weekday:'long', day:'numeric', month:'long', year:'numeric',
  });
  const isRefreshing = l1 || l2 || l3 || l4 || l5 || l6 || l7;

  return (
    <div className="animate-fade-in">

      {/* ─── header ─── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title">לוח בקרה</h1>
          <p className="page-subtitle">{todayLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <LiveClock />
          {/* auto-refresh countdown */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-hover">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isRefreshing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
            <Clock size={11} className="text-ink-faint" />
            <span className="font-mono text-xs text-ink-muted tabular-nums">{fmtCountdown(countdown)}</span>
          </div>
          <button
            onClick={() => { setRefreshKey(k => k + 1); setCountdown(120); }}
            className="btn btn-ghost btn-icon"
            title="רענן עכשיו"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─── priority strip ─── */}
      <PriorityStrip
        unassigned={s.unassigned}
        openBalances={s.openBalances}
        onNavigate={navigate}
      />

      {/* ─── alert banners ─── */}
      {activeAlerts.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          {activeAlerts.map(a => (
            <AlertBanner
              key={a.id}
              alert={a}
              onAction={navigate}
              onDismiss={id => setDismissed(prev => new Set([...prev, id]))}
            />
          ))}
        </div>
      )}

      {/* ─── stat cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <StatCard icon={LogIn}      label="הגעות היום"   value={s.arrivals}    color="#7c3aed" bgColor="rgba(139,92,246,0.1)" sub={s.vipArrivals > 0 ? `${s.vipArrivals} VIP` : undefined}         onClick={() => navigate('/check-in')} />
        <StatCard icon={LogOut}     label="יציאות היום"  value={s.departures}  color="#ea580c" bgColor="rgba(249,115,22,0.1)" sub={s.openBalances > 0 ? `${s.openBalances} יתרות` : undefined}     onClick={() => navigate('/check-out')} urgent={s.openBalances > 0} />
        <StatCard icon={Users}      label="In House"     value={s.inHouse}     color="#2563eb" bgColor="rgba(59,130,246,0.1)" sub={`תפוסה ${s.occupancy || 0}%`}                                   onClick={() => navigate('/reservations')} />
        <StatCard icon={BedDouble}  label="חדרים נקיים" value={s.cleanRooms}  color="#059669" bgColor="rgba(16,185,129,0.1)" sub={`${s.dirtyRooms || 0} מלוכלכים`}                               onClick={() => navigate('/rooms')} />
        <StatCard icon={Wrench}     label="Out of Order" value={s.oooRooms}    color="#dc2626" bgColor="rgba(239,68,68,0.1)"  sub={`${s.holdRooms || 0} Hold`} urgent={s.oooRooms > 0}            onClick={() => navigate('/maintenance')} />
        <StatCard icon={TrendingUp} label="תפוסה"        value={`${s.occupancy || 0}%`} color="#0891b2" bgColor="rgba(6,182,212,0.1)" sub={`${s.inHouse || 0} / ${s.totalRooms || 0} חדרים`}     onClick={() => {}} />
      </div>

      {/* ─── revenue KPIs ─── */}
      {!l6 && (
        <RevenueKpis
          todayDaily={todayDaily}
          totalRooms={s.totalRooms}
          occupancy={s.occupancy}
        />
      )}

      {/* ─── quick actions ─── */}
      <QuickActions onNavigate={navigate} />

      {/* ─── room health bar ─── */}
      <RoomHealthBar
        clean={s.cleanRooms}
        dirty={s.dirtyRooms}
        ooo={s.oooRooms}
        hold={s.holdRooms}
        occupied={s.inHouse}
        total={s.totalRooms}
      />

      {/* ─── VIP callout ─── */}
      <VipCallout arrivals={arrivals} onNavigate={navigate} />

      {/* ─── main 3-col grid ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">

        {/* arrivals panel */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <LogIn size={15} className="text-violet-600" />
              <span className="font-semibold text-ink text-sm">הגעות היום</span>
              {arrivals.length > 0 && <span className="badge badge-inhouse">{arrivals.length}</span>}
              {s.unassigned > 0 && (
                <span className="badge badge-dirty flex items-center gap-0.5">
                  <AlertCircle size={10} /> {s.unassigned}
                </span>
              )}
            </div>
          </div>
          {!arrivals.length ? (
            <div className="empty-state py-8">
              <LogIn size={28} className="empty-state-icon" />
              <span>אין הגעות היום</span>
            </div>
          ) : (
            <>
              {sortedArrivals.slice(0, 8).map(res => (
                <ArrivalRow key={res._id} res={res} onClick={() => navigate('/check-in')} />
              ))}
              {arrivals.length > 8 && (
                <div className="px-4 py-2 text-xs text-ink-muted text-center">
                  ועוד {arrivals.length - 8} נוספים
                </div>
              )}
              <div className="px-4 py-2.5 border-t border-surface-hover">
                <button
                  className="btn btn-primary btn-sm w-full justify-center gap-1.5"
                  onClick={() => navigate('/check-in')}
                >
                  <LogIn size={13} /> לדף צ'ק-אין
                </button>
              </div>
            </>
          )}
        </div>

        {/* departures panel */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <LogOut size={15} className="text-orange-600" />
              <span className="font-semibold text-ink text-sm">יציאות היום</span>
              {departures.length > 0 && <span className="badge badge-departure">{departures.length}</span>}
              {s.openBalances > 0 && (
                <span className="badge badge-dirty">{s.openBalances} יתרה</span>
              )}
            </div>
          </div>
          {!departures.length ? (
            <div className="empty-state py-8">
              <LogOut size={28} className="empty-state-icon" />
              <span>אין יציאות היום</span>
            </div>
          ) : (
            <>
              {departures.slice(0, 8).map(res => (
                <DepartureRow key={res._id} res={res} onClick={() => navigate('/check-out')} />
              ))}
              {departures.length > 8 && (
                <div className="px-4 py-2 text-xs text-ink-muted text-center">
                  ועוד {departures.length - 8} נוספים
                </div>
              )}
              <div className="px-4 py-2.5 border-t border-surface-hover">
                <button
                  className="btn btn-secondary btn-sm w-full justify-center gap-1.5"
                  onClick={() => navigate('/check-out')}
                >
                  <LogOut size={13} /> לדף צ'ק-אאוט
                </button>
              </div>
            </>
          )}
        </div>

        {/* right column: chart + HK + maintenance */}
        <div className="flex flex-col gap-3">

          {/* 7-day occupancy chart (historical) */}
          {!l6 && daily.length > 0 && (
            <OccupancyChart daily={daily} totalRooms={s.totalRooms} />
          )}

          {/* HK widget */}
          <div
            className="card cursor-pointer hover:shadow-card-hover transition-shadow"
            onClick={() => navigate('/housekeeping')}
          >
            <div className="card-header pb-2">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-brand" />
                <span className="font-semibold text-ink text-sm">חדרנות</span>
              </div>
              <ChevronRight size={14} className="text-ink-faint" />
            </div>
            <HkProgress
              pending={s.hkPending}
              inProgress={s.hkInProgress}
              completed={s.hkCompleted}
              urgent={s.hkUrgent}
            />
          </div>

          {/* maintenance mini */}
          <div
            className="card cursor-pointer hover:shadow-card-hover transition-shadow"
            onClick={() => navigate('/maintenance')}
          >
            <div className="card-header pb-2">
              <div className="flex items-center gap-2">
                <Wrench size={14} className="text-red-500" />
                <span className="font-semibold text-ink text-sm">תחזוקה פתוחה</span>
              </div>
              <ChevronRight size={14} className="text-ink-faint" />
            </div>
            <div className="px-4 pb-3 flex items-center gap-3">
              <div className={`text-4xl font-bold text-num ${(s.maintenanceOpen || 0) > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {s.maintenanceOpen ?? 0}
              </div>
              <div className="text-sm text-ink-muted">
                {(s.maintenanceOpen || 0) > 0 ? 'תקלות דורשות טיפול' : 'הכל תקין ✓'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── 7-day forecast ─── */}
      {!l7 && forecast.length > 0 && (
        <ForecastStrip daily={forecast} totalRooms={s.totalRooms} />
      )}

      {/* ─── in-house table ─── */}
      {inhouse.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <Users size={15} className="text-blue-600" />
              <span className="font-semibold text-ink text-sm">אורחים בבית</span>
              <span className="badge badge-inhouse">{inhouse.length}</span>
            </div>
            <button className="btn btn-ghost btn-sm text-xs" onClick={() => navigate('/reservations')}>
              כל ההזמנות ←
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>אורח</th>
                <th>חדר</th>
                <th>סוג</th>
                <th>יציאה</th>
                <th>לילות נותרו</th>
                <th>תשלום</th>
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
                    className={`cursor-pointer hover:bg-surface-hover transition-colors
                      ${leavesToday ? 'bg-amber-50/30' : leavesTomorrow ? 'bg-blue-50/20' : ''}
                    `}
                    onClick={() => navigate('/folio')}
                  >
                    <td>
                      <div className="flex items-center gap-1.5">
                        {res.isVip && <Crown size={11} className="text-amber-500" />}
                        <span className="font-medium text-sm">
                          {g ? `${g.firstName} ${g.lastName}` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="text-num font-bold">{res.assignedRoom?.number || '—'}</td>
                    <td className="text-xs text-ink-muted">{res.roomType?.name}</td>
                    <td className={`text-xs text-num
                      ${leavesToday ? 'text-amber-600 font-semibold' : leavesTomorrow ? 'text-blue-600 font-medium' : ''}
                    `}>
                      {fmtDate(dep)}
                      {leavesToday    && <span className="mr-1 text-amber-600">← היום</span>}
                      {leavesTomorrow && <span className="mr-1 text-blue-600">← מחר</span>}
                    </td>
                    <td>
                      {nightsLeft !== null && (
                        <span className={`text-xs font-semibold text-num
                          ${nightsLeft === 0 ? 'text-amber-600' : nightsLeft === 1 ? 'text-blue-600' : 'text-ink-muted'}
                        `}>
                          {nightsLeft === 0 ? 'יוצא היום' : `${nightsLeft} לילות`}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${res.paymentStatus === 'paid' ? 'badge-clean' : res.paymentStatus === 'balance_due' ? 'badge-dirty' : 'badge-pending'}`}>
                        {res.paymentStatus === 'paid' ? 'שולם' : res.paymentStatus === 'balance_due' ? 'יתרה' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {inhouse.length > 10 && (
            <div className="px-4 py-3 text-xs text-ink-muted text-center border-t border-surface-hover">
              ועוד {inhouse.length - 10} אורחים —{' '}
              <button className="text-brand hover:underline" onClick={() => navigate('/reservations')}>
                לכל ההזמנות
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
