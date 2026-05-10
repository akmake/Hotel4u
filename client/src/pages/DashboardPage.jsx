import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogIn,
  LogOut,
  Users,
  BedDouble,
  Sparkles,
  Wrench,
  AlertTriangle,
  AlertCircle,
  Info,
  Crown,
  TrendingUp,
  RefreshCw,
  Plus,
  Calendar,
  DollarSign,
  BarChart2,
  Activity,
  ArrowUpRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { dashboard, reports } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import './DashboardPage.css';

const PMS = p => `/pms${p}`;

const FONT_DISPLAY = "'EB Garamond', 'Noto Serif Hebrew', Georgia, serif";
const FONT_NUM = "'Manrope', 'Segoe UI', sans-serif";

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function addDaysStr(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split('T')[0];
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(`${d}T00:00:00`).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
  });
}

function fmtDayShort(d) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('he-IL', {
    weekday: 'short',
    day: 'numeric',
  });
}

function fmtDayMini(d) {
  const dt = new Date(`${d}T00:00:00`);
  return {
    weekday: dt.toLocaleDateString('he-IL', { weekday: 'short' }),
    day: dt.getDate(),
  };
}

function initials(g) {
  return ((g?.firstName?.[0] || '') + (g?.lastName?.[0] || '')).toUpperCase();
}

function fmtMoney(n) {
  const value = Number(n || 0);
  if (value >= 1_000_000) return `₪${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `₪${(value / 1_000).toFixed(0)}K`;
  return `₪${value.toLocaleString('he-IL')}`;
}

function useClock() {
  const fmt = () =>
    new Date().toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

const ALERT_ROUTE = a => {
  if (a.id?.startsWith('checkin-')) return PMS('/check-in');
  if (a.id?.startsWith('checkout-')) return PMS('/check-out');
  if (a.id?.startsWith('hk-')) return PMS('/housekeeping');
  return PMS('/reservations');
};

function AlertBanner({ alert, onAction, onDismiss }) {
  const cfg = {
    warning: { icon: AlertTriangle, className: 'pd-alert-warning', badge: 'אזהרה' },
    danger:  { icon: AlertCircle,   className: 'pd-alert-danger',  badge: 'דחוף'  },
    info:    { icon: Info,          className: 'pd-alert-info',    badge: 'מידע'  },
  }[alert.type] || { icon: Info, className: 'pd-alert-info', badge: 'מידע' };

  const Icon = cfg.icon;

  return (
    <div className={`pd-alert ${cfg.className}`}>
      <div className={`pd-alert-icon-wrap pd-alert-icon-${alert.type || 'info'}`}>
        <Icon size={15} />
      </div>
      <div className="pd-alert-content">
        <span className="pd-alert-badge">{cfg.badge}</span>
        <p>{alert.text}</p>
      </div>
      <button className="pd-btn pd-btn-light pd-btn-sm" onClick={() => onAction(ALERT_ROUTE(alert))}>
        לטיפול
        <ArrowUpRight size={13} />
      </button>
      <button className="pd-dismiss" onClick={() => onDismiss?.(alert.id)}>×</button>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, progress, variant = 'default', onClick }) {
  return (
    <button className={`pd-kpi-card pd-kpi-card--${variant}`} onClick={onClick}>
      <div className="pd-kpi-icon-wrap">
        <Icon size={15} />
      </div>
      <div className="pd-kpi-body">
        <span className="pd-kpi-label">{label}</span>
        <strong className="pd-kpi-value" style={{ fontFamily: FONT_DISPLAY }}>{value}</strong>
        {sub && <small className="pd-kpi-sub">{sub}</small>}
      </div>
      {progress != null && (
        <div className="pd-kpi-bar-track">
          <div className="pd-kpi-bar-fill" style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }} />
        </div>
      )}
    </button>
  );
}

function ArrivalRow({ res, onClick }) {
  const g = res.primaryGuest;
  const isVip = res.isVip || (g?.vipLevel && g.vipLevel !== 'none' && g.vipLevel > 0);
  const room = res.assignedRoom;
  const roomReady = room && ['clean', 'inspected'].includes(room.cleanStatus);
  const done = res.status === 'in_house';

  return (
    <button className={`pd-guest-row ${done ? 'pd-guest-row--done' : ''}`} onClick={onClick}>
      <div className={`pd-avatar ${isVip ? 'pd-avatar--vip' : ''} ${done ? 'pd-avatar--done' : ''}`}>
        {initials(g)}
      </div>
      <div className="pd-guest-main">
        <div className="pd-guest-name-row">
          <span className="pd-guest-name">{g ? `${g.firstName} ${g.lastName}` : 'אורח'}</span>
          {isVip && <Crown size={11} className="pd-vip-crown" />}
          {done && <span className="pd-done-badge">צ'ק-אין ✓</span>}
        </div>
        <span className="pd-guest-sub">{res.roomType?.name || 'סוג חדר לא הוגדר'}</span>
      </div>
      <div className="pd-guest-tags">
        {room ? (
          <span className={`pd-pill ${roomReady ? 'pd-pill--ok' : 'pd-pill--warn'}`}>
            חדר {room.number}
          </span>
        ) : (
          <span className="pd-pill pd-pill--danger">ללא חדר</span>
        )}
        <span className={`pd-pill ${res.paymentStatus === 'paid' ? 'pd-pill--ok' : 'pd-pill--warn'}`}>
          {res.paymentStatus === 'paid' ? 'שולם' : 'ממתין'}
        </span>
      </div>
    </button>
  );
}

function DepartureRow({ res, onClick }) {
  const g = res.primaryGuest;
  const due = res.paymentStatus === 'balance_due';
  const done = res.status === 'checked_out';

  return (
    <button className={`pd-guest-row ${done ? 'pd-guest-row--done' : ''}`} onClick={onClick}>
      <div className={`pd-avatar ${due ? 'pd-avatar--danger' : ''} ${done ? 'pd-avatar--done' : ''}`}>
        {initials(g)}
      </div>
      <div className="pd-guest-main">
        <div className="pd-guest-name-row">
          <span className="pd-guest-name">{g ? `${g.firstName} ${g.lastName}` : 'אורח'}</span>
          {done && <span className="pd-done-badge">יצא ✓</span>}
        </div>
        <span className="pd-guest-sub">
          {res.roomType?.name || 'סוג חדר'} · חדר {res.assignedRoom?.number || '—'}
        </span>
      </div>
      <span className={`pd-pill ${due ? 'pd-pill--danger' : 'pd-pill--ok'}`}>
        {due ? 'יתרה לתשלום' : 'שולם'}
      </span>
    </button>
  );
}

function OccTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="pd-chart-tooltip" dir="rtl">
      <div className="pd-chart-tooltip-title">{label}</div>
      <div>תפוסה: {payload[0]?.value}%</div>
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
    <div className="pd-card pd-chart-card">
      <div className="pd-card-head">
        <div className="pd-card-title-row">
          <TrendingUp size={15} />
          <h3>תפוסה 7 ימים</h3>
        </div>
      </div>
      <div className="pd-chart-wrap">
        <ResponsiveContainer width="100%" height={165}>
          <BarChart data={data} barSize={14} margin={{ top: 4, right: 6, bottom: 4, left: -20 }}>
            <CartesianGrid vertical={false} stroke="rgba(195,200,194,0.5)" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#63635f' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#63635f' }} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" />
            <Tooltip content={<OccTooltip />} cursor={{ fill: '#d2e8d8', opacity: 0.35 }} />
            <Bar dataKey="occupancy" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={`${d.date}-${i}`} fill={d.date === today ? '#4d6054' : '#b6ccbd'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RoomMixBar({ clean, dirty, ooo, hold, occupied, total }) {
  if (!total) return null;
  const segments = [
    { label: 'נקי',      value: clean || 0,    tone: 'ok'      },
    { label: 'תפוס',     value: occupied || 0, tone: 'busy'    },
    { label: 'מלוכלך',   value: dirty || 0,    tone: 'warn'    },
    { label: 'OOO',      value: ooo || 0,      tone: 'danger'  },
    { label: 'Hold',     value: hold || 0,     tone: 'neutral' },
  ].filter(s => s.value > 0);

  return (
    <div className="pd-card pd-room-mix">
      <div className="pd-card-head">
        <div className="pd-card-title-row">
          <BedDouble size={15} />
          <h3>מצב חדרים</h3>
        </div>
        <span className="pd-chip">{total} חדרים</span>
      </div>
      <div className="pd-room-strip">
        {segments.map(seg => (
          <div
            key={seg.label}
            className={`pd-room-strip-item pd-room-strip--${seg.tone}`}
            style={{ width: `${Math.max(4, Math.round((seg.value / total) * 100))}%` }}
            title={`${seg.label}: ${seg.value}`}
          />
        ))}
      </div>
      <div className="pd-room-legend">
        {segments.map(seg => (
          <span key={seg.label} className={`pd-legend-item pd-legend--${seg.tone}`}>
            {seg.label} <strong>{seg.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function ForecastStrip({ daily }) {
  if (!daily?.length) return null;
  const todayS = todayStr();

  return (
    <div className="pd-card pd-forecast">
      <div className="pd-card-head">
        <div className="pd-card-title-row">
          <Calendar size={15} />
          <h3>תחזית קדימה</h3>
        </div>
      </div>
      <div className="pd-forecast-grid">
        {daily.slice(0, 7).map(d => {
          const { weekday, day } = fmtDayMini(d.date);
          const isToday = d.date === todayS;
          const occ = d.occupancy || 0;
          return (
            <div key={d.date} className={`pd-day ${isToday ? 'is-today' : ''}`}>
              <div className="pd-day-week">{isToday ? 'היום' : weekday}</div>
              <div className="pd-day-num">{day}</div>
              <div className="pd-day-occ">{occ}%</div>
              <div className="pd-day-flow">
                <span>+{d.arrivals || 0}</span>
                <span>-{d.departures || 0}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ARRIVAL_TABS = [
  { id: 'all',     label: 'הכל'    },
  { id: 'pending', label: 'ממתינים' },
  { id: 'done',    label: "בוצע"   },
  { id: 'vip',     label: 'VIP'    },
];

export default function DashboardPage() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const clock = useClock();
  const skip = !propertyId;
  const today = todayStr();
  const from7 = addDaysStr(today, -6);

  const [dismissed, setDismissed]   = useState(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning]     = useState(false);
  const [arrivalTab, setArrivalTab] = useState('all');

  useEffect(() => {
    const id = setInterval(() => setRefreshKey(k => k + 1), 180_000);
    return () => clearInterval(id);
  }, []);

  const { data: statsRaw,   loading: l1, error: e1, refetch } = useApi(() => dashboard.stats(propertyId),      [propertyId, refreshKey], skip);
  const { data: alertsRaw,  loading: l2 }                     = useApi(() => dashboard.alerts(propertyId),     [propertyId, refreshKey], skip);
  const { data: arrData,    loading: l3 }                     = useApi(() => dashboard.arrivals(propertyId),   [propertyId, refreshKey], skip);
  const { data: depData,    loading: l4 }                     = useApi(() => dashboard.departures(propertyId), [propertyId, refreshKey], skip);
  const { data: inHouseData, loading: l5 }                    = useApi(() => dashboard.inhouse(propertyId),    [propertyId, refreshKey], skip);
  const { data: reportRaw,  loading: l6 }                     = useApi(() => reports.summary(propertyId, from7, addDaysStr(today, 1)),  [propertyId, refreshKey], skip);
  const { data: forecastRaw, loading: l7 }                    = useApi(() => reports.summary(propertyId, today, addDaysStr(today, 8)), [propertyId, refreshKey], skip);

  if (skip || l1 || l2 || l3 || l4 || l5) return <PageSpinner />;
  if (e1) return <ErrorState message={e1} onRetry={refetch} />;

  const s            = statsRaw || {};
  const arrivals     = arrData || [];
  const departures   = depData || [];
  const inhouse      = inHouseData || [];
  const daily        = reportRaw?.daily || [];
  const forecast     = forecastRaw?.daily || [];
  const todayDaily   = forecast[0];
  const isRefreshing = l1 || l2 || l3 || l4 || l5 || l6 || l7;
  const activeAlerts = (alertsRaw || []).filter(a => !dismissed.has(a.id));

  const sortedArrivals = [...arrivals].sort((a, b) => {
    const score = r => (r.isVip ? 10 : 0) + (r.assignedRoom ? 5 : 0);
    return score(b) - score(a);
  });

  const checkedInToday  = arrivals.filter(r => r.status === 'in_house').length;
  const checkedOutToday = departures.filter(r => r.status === 'checked_out').length;
  const vipInHouse      = inhouse.filter(r => r.isVip || (r.primaryGuest?.vipLevel > 0)).length;

  const todayRevenue = todayDaily?.revenue || 0;
  const adr = arrivals.length > 0
    ? Math.round(todayRevenue / arrivals.length)
    : (s.adr || 0);
  const revpar = s.totalRooms > 0
    ? Math.round(todayRevenue / s.totalRooms)
    : (s.revpar || 0);

  const hkTotal = (s.hkPending || 0) + (s.hkInProgress || 0) + (s.hkCompleted || 0);
  const hkPct   = hkTotal ? Math.round(((s.hkCompleted || 0) / hkTotal) * 100) : 0;

  const todayLong = new Date().toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  function handleRefresh() {
    setSpinning(true);
    setRefreshKey(k => k + 1);
    setTimeout(() => setSpinning(false), 1500);
  }

  const kpiTiles = [
    {
      icon: Activity,
      label: 'תפוסה',
      value: `${s.occupancy || 0}%`,
      sub: `${s.inHouse || 0} / ${s.totalRooms || 0} חדרים`,
      variant: 'accent',
      route: PMS('/reservations'),
    },
    {
      icon: DollarSign,
      label: 'ADR',
      value: fmtMoney(adr),
      sub: 'שיעור יומי ממוצע',
      variant: 'default',
      route: PMS('/rates'),
    },
    {
      icon: BarChart2,
      label: 'RevPAR',
      value: fmtMoney(revpar),
      sub: 'לחדר זמין',
      variant: 'default',
      route: PMS('/reports'),
    },
    {
      icon: TrendingUp,
      label: 'הכנסות היום',
      value: fmtMoney(todayRevenue),
      sub: null,
      variant: 'default',
      route: PMS('/reports'),
    },
    {
      icon: LogIn,
      label: 'הגעות',
      value: arrivals.length,
      sub: `${checkedInToday} הושלמו`,
      progress: arrivals.length ? checkedInToday / arrivals.length : null,
      variant: 'default',
      route: PMS('/check-in'),
    },
    {
      icon: LogOut,
      label: 'יציאות',
      value: departures.length,
      sub: `${checkedOutToday} הושלמו`,
      progress: departures.length ? checkedOutToday / departures.length : null,
      variant: 'default',
      route: PMS('/check-out'),
    },
    {
      icon: Users,
      label: 'אורחים בבית',
      value: s.inHouse || 0,
      sub: vipInHouse > 0 ? `${vipInHouse} VIP` : null,
      variant: 'default',
      route: PMS('/reservations'),
    },
    {
      icon: Wrench,
      label: 'תחזוקה',
      value: s.maintenanceOpen || 0,
      sub: s.maintenanceOpen > 0 ? 'פתוח לטיפול' : 'הכל תקין',
      variant: (s.maintenanceOpen || 0) > 0 ? 'warn' : 'default',
      route: PMS('/maintenance'),
    },
  ];

  const filteredArrivals = sortedArrivals.filter(res => {
    if (arrivalTab === 'pending') return res.status !== 'in_house';
    if (arrivalTab === 'done')    return res.status === 'in_house';
    if (arrivalTab === 'vip')     return res.isVip || (res.primaryGuest?.vipLevel > 0);
    return true;
  });

  const quickActions = [
    { icon: LogIn,    label: "צ'ק-אין",      route: PMS('/check-in'),        type: 'primary' },
    { icon: LogOut,   label: "צ'ק-אאוט",     route: PMS('/check-out'),       type: 'primary' },
    { icon: Plus,     label: 'הזמנה חדשה',    route: PMS('/reservations/new'), type: 'primary' },
    { icon: BedDouble, label: 'Tape Chart',   route: PMS('/tape-chart'),      type: 'secondary' },
    { icon: Calendar, label: 'הזמנות',        route: PMS('/reservations'),    type: 'secondary' },
    { icon: Sparkles, label: 'חדרנות',        route: PMS('/housekeeping'),    type: 'secondary' },
  ];

  return (
    <div className="pd-root animate-fade-in" dir="rtl" style={{ fontFamily: FONT_NUM }}>
      <header className="pd-topbar">
        <div className="pd-topbar-title">
          <h1 style={{ fontFamily: FONT_DISPLAY }}>לוח בקרה</h1>
          <p className="pd-subline">{todayLong}</p>
        </div>
        <div className="pd-topbar-tools">
          <div className="pd-live-dot-wrap">
            <span className={`pd-live-dot ${isRefreshing ? 'is-refreshing' : ''}`} />
            <span>{isRefreshing ? 'מתרענן' : 'מעודכן'}</span>
          </div>
          <button className="pd-btn pd-btn-light" onClick={handleRefresh}>
            <RefreshCw size={14} className={spinning ? 'animate-spin' : ''} />
            רענון
          </button>
          <div className="pd-clock">{clock}</div>
        </div>
      </header>

      <section className="pd-kpis">
        {kpiTiles.map(tile => (
          <KpiCard
            key={tile.label}
            icon={tile.icon}
            label={tile.label}
            value={tile.value}
            sub={tile.sub}
            progress={tile.progress}
            variant={tile.variant}
            onClick={() => navigate(tile.route)}
          />
        ))}
      </section>

      <section className="pd-actions">
        {quickActions.map(action => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              className={`pd-action-btn ${action.type === 'primary' ? 'is-primary' : 'is-secondary'}`}
              onClick={() => navigate(action.route)}
            >
              <Icon size={15} />
              <span>{action.label}</span>
            </button>
          );
        })}
      </section>

      {activeAlerts.length > 0 && (
        <section className="pd-alerts">
          {activeAlerts.map(a => (
            <AlertBanner
              key={a.id}
              alert={a}
              onAction={navigate}
              onDismiss={id => setDismissed(prev => new Set([...prev, id]))}
            />
          ))}
        </section>
      )}

      <section className="pd-grid">
        <div className="pd-col-main">
          <RoomMixBar
            clean={s.cleanRooms}
            dirty={s.dirtyRooms}
            ooo={s.oooRooms}
            hold={s.holdRooms}
            occupied={s.inHouse}
            total={s.totalRooms}
          />

          <div className="pd-two-cards">
            <article className="pd-card">
              <div className="pd-card-head">
                <div className="pd-card-title-row">
                  <LogIn size={15} />
                  <h3>הגעות היום</h3>
                </div>
                <span className="pd-chip">{checkedInToday}/{arrivals.length}</span>
              </div>

              <div className="pd-tab-bar">
                {ARRIVAL_TABS.map(tab => (
                  <button
                    key={tab.id}
                    className={`pd-tab ${arrivalTab === tab.id ? 'is-active' : ''}`}
                    onClick={() => setArrivalTab(tab.id)}
                  >
                    {tab.label}
                    {tab.id === 'vip' && arrivals.filter(r => r.isVip || (r.primaryGuest?.vipLevel > 0)).length > 0 && (
                      <span className="pd-tab-count">
                        {arrivals.filter(r => r.isVip || (r.primaryGuest?.vipLevel > 0)).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {!filteredArrivals.length ? (
                <div className="pd-empty">
                  {arrivalTab === 'all' ? 'אין הגעות היום' : 'אין תוצאות בסינון זה'}
                </div>
              ) : (
                <div className="pd-list">
                  {filteredArrivals.slice(0, 8).map(res => (
                    <ArrivalRow key={res._id} res={res} onClick={() => navigate(PMS('/check-in'))} />
                  ))}
                </div>
              )}

              <div className="pd-card-footer">
                <button className="pd-btn pd-btn-accent" onClick={() => navigate(PMS('/check-in'))}>
                  עמדת צ'ק-אין
                </button>
              </div>
            </article>

            <article className="pd-card">
              <div className="pd-card-head">
                <div className="pd-card-title-row">
                  <LogOut size={15} />
                  <h3>יציאות היום</h3>
                </div>
                <span className="pd-chip">{checkedOutToday}/{departures.length}</span>
              </div>

              {!departures.length ? (
                <div className="pd-empty">אין יציאות היום</div>
              ) : (
                <div className="pd-list">
                  {departures.slice(0, 8).map(res => (
                    <DepartureRow key={res._id} res={res} onClick={() => navigate(PMS('/check-out'))} />
                  ))}
                </div>
              )}

              <div className="pd-card-footer">
                <button className="pd-btn pd-btn-mint" onClick={() => navigate(PMS('/check-out'))}>
                  עמדת צ'ק-אאוט
                </button>
              </div>
            </article>
          </div>

          {inhouse.length > 0 && (
            <article className="pd-card pd-table-card">
              <div className="pd-card-head">
                <div className="pd-card-title-row">
                  <Users size={15} />
                  <h3>אורחים בבית</h3>
                </div>
                <span className="pd-chip">{inhouse.length}</span>
              </div>
              <div className="pd-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>אורח</th>
                      <th>חדר</th>
                      <th>יציאה</th>
                      <th>לילות</th>
                      <th>תשלום</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inhouse.slice(0, 10).map(res => {
                      const guest = res.primaryGuest;
                      const dep = res.departureDate;
                      const nightsLeft = dep
                        ? Math.max(0, Math.ceil(
                            (new Date(`${dep}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000
                          ))
                        : null;
                      return (
                        <tr key={res._id} onClick={() => navigate(PMS('/folio'))}>
                          <td>
                            <div className="pd-table-guest">
                              {res.isVip && <Crown size={12} />}
                              <span>{guest ? `${guest.firstName} ${guest.lastName}` : 'אורח'}</span>
                            </div>
                          </td>
                          <td>{res.assignedRoom?.number || '—'}</td>
                          <td>{fmtDate(dep)}</td>
                          <td>{nightsLeft === null ? '—' : nightsLeft}</td>
                          <td>
                            <span className={`pd-pill ${res.paymentStatus === 'paid' ? 'pd-pill--ok' : 'pd-pill--danger'}`}>
                              {res.paymentStatus === 'paid' ? 'שולם' : 'יתרה'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          )}
        </div>

        <aside className="pd-col-side">
          <article className="pd-card pd-side-card" onClick={() => navigate(PMS('/housekeeping'))}>
            <div className="pd-card-head">
              <div className="pd-card-title-row">
                <Sparkles size={15} />
                <h3>חדרנות</h3>
              </div>
              <span className="pd-chip">{hkPct}% הושלם</span>
            </div>
            <div className="pd-side-metrics">
              <div>
                <span>פתוח</span>
                <strong>{s.hkPending || 0}</strong>
              </div>
              <div>
                <span>בביצוע</span>
                <strong>{s.hkInProgress || 0}</strong>
              </div>
              <div>
                <span>הושלם</span>
                <strong>{s.hkCompleted || 0}</strong>
              </div>
              <div className={s.hkUrgent > 0 ? 'pd-side-metric--urgent' : ''}>
                <span>דחוף</span>
                <strong>{s.hkUrgent || 0}</strong>
              </div>
            </div>
          </article>

          <article className="pd-card pd-side-card" onClick={() => navigate(PMS('/maintenance'))}>
            <div className="pd-card-head">
              <div className="pd-card-title-row">
                <Wrench size={15} />
                <h3>תחזוקה פתוחה</h3>
              </div>
            </div>
            <div className={`pd-maintenance-number ${(s.maintenanceOpen || 0) > 0 ? 'has-issues' : ''}`}>
              {s.maintenanceOpen || 0}
            </div>
            <p className="pd-maintenance-note">
              {(s.maintenanceOpen || 0) > 0 ? 'יש תקלות לטיפול' : 'הכל תקין כרגע'}
            </p>
          </article>

          {!l6 && daily.length > 0 && <OccupancyChart daily={daily} totalRooms={s.totalRooms} />}
          {!l7 && forecast.length > 0 && <ForecastStrip daily={forecast} />}
        </aside>
      </section>
    </div>
  );
}
