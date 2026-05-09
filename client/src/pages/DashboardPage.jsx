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
  Target,
  BarChart2,
  Activity,
  ChevronRight,
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

const PALETTE = {
  pageBg: '#F7F1E6',
  pageBgSoft: '#EFE4CE',
  card: '#FFFCF7',
  cardMuted: '#F8F2E5',
  border: '#D6C7AA',
  ink: '#201A14',
  inkSoft: '#695A46',
  accent: '#A67C2E',
  accentSoft: '#F6E8C9',
  mint: '#4E6A58',
  mintSoft: '#E4EEE7',
  warn: '#B28534',
  danger: '#A54533',
  success: '#355E4B',
};

const FONT_DISPLAY = "'Cormorant Garamond', 'Noto Serif Hebrew', 'Times New Roman', serif";
const FONT_NUM = "'Manrope', 'Space Grotesk', 'Rubik', sans-serif";

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
    warning: {
      icon: AlertTriangle,
      className: 'pd-alert-warning',
      badge: 'אזהרה',
    },
    danger: {
      icon: AlertCircle,
      className: 'pd-alert-danger',
      badge: 'דחוף',
    },
    info: {
      icon: Info,
      className: 'pd-alert-info',
      badge: 'מידע',
    },
  }[alert.type] || {
    icon: Info,
    className: 'pd-alert-info',
    badge: 'מידע',
  };

  const Icon = cfg.icon;

  return (
    <div className={`pd-alert ${cfg.className}`}>
      <div className="pd-alert-icon-wrap">
        <Icon size={15} />
      </div>
      <div className="pd-alert-content">
        <span className="pd-alert-badge">{cfg.badge}</span>
        <p>{alert.text}</p>
      </div>
      <button className="pd-btn pd-btn-light" onClick={() => onAction(ALERT_ROUTE(alert))}>
        לטיפול
        <ArrowUpRight size={14} />
      </button>
      <button className="pd-dismiss" onClick={() => onDismiss?.(alert.id)}>
        ×
      </button>
    </div>
  );
}

function ArrivalRow({ res, onClick }) {
  const g = res.primaryGuest;
  const isVip = res.isVip || (g?.vipLevel && g.vipLevel !== 'none');
  const room = res.assignedRoom;
  const roomReady = room && ['clean', 'inspected'].includes(room.cleanStatus);

  return (
    <button className="pd-guest-row" onClick={onClick}>
      <div className={`pd-avatar ${isVip ? 'pd-avatar-vip' : ''}`}>{initials(g)}</div>
      <div className="pd-guest-main">
        <div className="pd-guest-name-wrap">
          <span className="pd-guest-name">{g ? `${g.firstName} ${g.lastName}` : 'Guest'}</span>
          {isVip && <Crown size={12} />}
        </div>
        <span className="pd-guest-sub">{res.roomType?.name || 'Room type not set'}</span>
      </div>
      <div className="pd-guest-tags">
        {room ? (
          <span className={`pd-pill ${roomReady ? 'pd-pill-ok' : 'pd-pill-warn'}`}>Room {room.number}</span>
        ) : (
          <span className="pd-pill pd-pill-danger">No room</span>
        )}
        <span className={`pd-pill ${res.paymentStatus === 'paid' ? 'pd-pill-ok' : 'pd-pill-warn'}`}>
          {res.paymentStatus === 'paid' ? 'Paid' : 'Pending'}
        </span>
      </div>
    </button>
  );
}

function DepartureRow({ res, onClick }) {
  const g = res.primaryGuest;
  const due = res.paymentStatus === 'balance_due';

  return (
    <button className="pd-guest-row" onClick={onClick}>
      <div className={`pd-avatar ${due ? 'pd-avatar-danger' : ''}`}>{initials(g)}</div>
      <div className="pd-guest-main">
        <span className="pd-guest-name">{g ? `${g.firstName} ${g.lastName}` : 'Guest'}</span>
        <span className="pd-guest-sub">
          {res.roomType?.name || 'Room type'} • חדר {res.assignedRoom?.number || '—'}
        </span>
      </div>
      <span className={`pd-pill ${due ? 'pd-pill-danger' : 'pd-pill-ok'}`}>{due ? 'Balance due' : 'Paid'}</span>
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
        <div className="pd-card-title-wrap">
          <TrendingUp size={15} />
          <h3>תפוסה 7 ימים</h3>
        </div>
      </div>
      <div className="pd-chart-wrap">
        <ResponsiveContainer width="100%" height={175}>
          <BarChart data={data} barSize={16} margin={{ top: 4, right: 6, bottom: 6, left: -20 }}>
            <CartesianGrid vertical={false} stroke="#E4EEE6" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: PALETTE.inkSoft }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 10, fill: PALETTE.inkSoft }}
              axisLine={false}
              tickLine={false}
              domain={[0, 100]}
              unit="%"
            />
            <Tooltip content={<OccTooltip />} cursor={{ fill: '#F2F7EE' }} />
            <Bar dataKey="occupancy" radius={[5, 5, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={`${d.date}-${i}`} fill={d.date === today ? PALETTE.accent : PALETTE.mint} />
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
    { label: 'נקי', value: clean || 0, tone: 'ok' },
    { label: 'תפוס', value: occupied || 0, tone: 'busy' },
    { label: 'מלוכלך', value: dirty || 0, tone: 'warn' },
    { label: 'OOO', value: ooo || 0, tone: 'danger' },
    { label: 'Hold', value: hold || 0, tone: 'neutral' },
  ].filter(s => s.value > 0);

  return (
    <div className="pd-card pd-room-mix">
      <div className="pd-card-head">
        <div className="pd-card-title-wrap">
          <BedDouble size={15} />
          <h3>מצב חדרים</h3>
        </div>
        <span className="pd-chip">{total} חדרים</span>
      </div>

      <div className="pd-room-strip">
        {segments.map(seg => (
          <div
            key={seg.label}
            className={`pd-room-strip-item pd-room-strip-${seg.tone}`}
            style={{ width: `${Math.max(4, Math.round((seg.value / total) * 100))}%` }}
            title={`${seg.label}: ${seg.value}`}
          />
        ))}
      </div>

      <div className="pd-room-legend">
        {segments.map(seg => (
          <span key={seg.label} className={`pd-legend-item pd-legend-${seg.tone}`}>
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
        <div className="pd-card-title-wrap">
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

  useEffect(() => {
    const id = setInterval(() => setRefreshKey(k => k + 1), 180_000);
    return () => clearInterval(id);
  }, []);

  const { data: statsRaw, loading: l1, error: e1, refetch } = useApi(
    () => dashboard.stats(propertyId),
    [propertyId, refreshKey],
    skip,
  );
  const { data: alertsRaw, loading: l2 } = useApi(
    () => dashboard.alerts(propertyId),
    [propertyId, refreshKey],
    skip,
  );
  const { data: arrData, loading: l3 } = useApi(
    () => dashboard.arrivals(propertyId),
    [propertyId, refreshKey],
    skip,
  );
  const { data: depData, loading: l4 } = useApi(
    () => dashboard.departures(propertyId),
    [propertyId, refreshKey],
    skip,
  );
  const { data: inHouseData, loading: l5 } = useApi(
    () => dashboard.inhouse(propertyId),
    [propertyId, refreshKey],
    skip,
  );
  const { data: reportRaw, loading: l6 } = useApi(
    () => reports.summary(propertyId, from7, addDaysStr(today, 1)),
    [propertyId, refreshKey],
    skip,
  );
  const { data: forecastRaw, loading: l7 } = useApi(
    () => reports.summary(propertyId, today, addDaysStr(today, 8)),
    [propertyId, refreshKey],
    skip,
  );

  if (skip || l1 || l2 || l3 || l4 || l5) return <PageSpinner />;
  if (e1) return <ErrorState message={e1} onRetry={refetch} />;

  const s = statsRaw || {};
  const arrivals = arrData || [];
  const departures = depData || [];
  const inhouse = inHouseData || [];
  const daily = reportRaw?.daily || [];
  const forecast = forecastRaw?.daily || [];
  const todayDaily = forecast[0];
  const isRefreshing = l1 || l2 || l3 || l4 || l5 || l6 || l7;
  const activeAlerts = (alertsRaw || []).filter(a => !dismissed.has(a.id));

  const sortedArrivals = [...arrivals].sort((a, b) => {
    const score = r => (r.isVip ? 10 : 0) + (r.assignedRoom ? 5 : 0);
    return score(b) - score(a);
  });

  const hkTotal = (s.hkPending || 0) + (s.hkInProgress || 0) + (s.hkCompleted || 0);
  const hkPct = hkTotal ? Math.round(((s.hkCompleted || 0) / hkTotal) * 100) : 0;

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

  const heroStats = [
    { icon: Activity, label: 'תפוסה', value: `${s.occupancy || 0}%`, route: PMS('/reservations') },
    { icon: Users, label: 'אורחים בבית', value: s.inHouse || 0, route: PMS('/reservations') },
    { icon: LogIn, label: 'הגעות היום', value: arrivals.length, route: PMS('/check-in') },
    { icon: LogOut, label: 'יציאות היום', value: departures.length, route: PMS('/check-out') },
  ];

  const quickActions = [
    { icon: LogIn, label: "צ'ק-אין", route: PMS('/check-in'), type: 'primary' },
    { icon: LogOut, label: "צ'ק-אאוט", route: PMS('/check-out'), type: 'primary' },
    { icon: Plus, label: 'הזמנה חדשה', route: PMS('/reservations/new'), type: 'primary' },
    { icon: BedDouble, label: 'Tape Chart', route: PMS('/tape-chart'), type: 'secondary' },
    { icon: Calendar, label: 'הזמנות', route: PMS('/reservations'), type: 'secondary' },
    { icon: Sparkles, label: 'חדרנות', route: PMS('/housekeeping'), type: 'secondary' },
  ];

  return (
    <div
      className="pd-root animate-fade-in"
      dir="rtl"
      style={{
        background: `radial-gradient(circle at 10% 0%, ${PALETTE.pageBg} 0%, ${PALETTE.pageBgSoft} 46%, #F9FBF7 100%)`,
        fontFamily: FONT_DISPLAY,
      }}
    >
      <header className="pd-topbar">
        <div className="pd-topbar-title">
          <p className="pd-eyebrow">Executive Pulse</p>
          <h1>Executive Suite Dashboard</h1>
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
          <div className="pd-clock" style={{ fontFamily: FONT_NUM }}>
            {clock}
          </div>
        </div>
      </header>

      <section className="pd-kpis">
        {heroStats.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.label} className="pd-kpi-card" onClick={() => navigate(item.route)}>
              <div className="pd-kpi-icon">
                <Icon size={14} />
              </div>
              <div className="pd-kpi-meta">
                <span>{item.label}</span>
                <strong style={{ fontFamily: FONT_NUM }}>{item.value}</strong>
              </div>
              <ChevronRight size={13} />
            </button>
          );
        })}
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
                <div className="pd-card-title-wrap">
                  <LogIn size={15} />
                  <h3>הגעות היום</h3>
                </div>
                <span className="pd-chip">{arrivals.length}</span>
              </div>

              {!arrivals.length ? (
                <div className="pd-empty">אין הגעות היום</div>
              ) : (
                <div className="pd-list">
                  {sortedArrivals.slice(0, 7).map(res => (
                    <ArrivalRow key={res._id} res={res} onClick={() => navigate(PMS('/check-in'))} />
                  ))}
                </div>
              )}

              <div className="pd-card-footer">
                <button className="pd-btn pd-btn-accent" onClick={() => navigate(PMS('/check-in'))}>
                  מעבר לעמדת צ'ק-אין
                </button>
              </div>
            </article>

            <article className="pd-card">
              <div className="pd-card-head">
                <div className="pd-card-title-wrap">
                  <LogOut size={15} />
                  <h3>יציאות היום</h3>
                </div>
                <span className="pd-chip">{departures.length}</span>
              </div>

              {!departures.length ? (
                <div className="pd-empty">אין יציאות היום</div>
              ) : (
                <div className="pd-list">
                  {departures.slice(0, 7).map(res => (
                    <DepartureRow key={res._id} res={res} onClick={() => navigate(PMS('/check-out'))} />
                  ))}
                </div>
              )}

              <div className="pd-card-footer">
                <button className="pd-btn pd-btn-mint" onClick={() => navigate(PMS('/check-out'))}>
                  מעבר לעמדת צ'ק-אאוט
                </button>
              </div>
            </article>
          </div>

          {!l6 && todayDaily && (
            <article className="pd-card pd-revenue-strip">
              {[
                {
                  icon: DollarSign,
                  label: 'הכנסות היום',
                  value: fmtMoney(todayDaily.revenue || 0),
                },
                {
                  icon: Target,
                  label: 'ADR',
                  value: fmtMoney(s.arrivals > 0 ? Math.round((todayDaily.revenue || 0) / s.arrivals) : 0),
                },
                {
                  icon: BarChart2,
                  label: 'RevPAR',
                  value: fmtMoney(s.totalRooms > 0 ? Math.round((todayDaily.revenue || 0) / s.totalRooms) : 0),
                },
                {
                  icon: Activity,
                  label: 'הזמנות החודש',
                  value: s.monthReservations ?? '—',
                },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="pd-revenue-cell">
                    <Icon size={15} />
                    <div>
                      <span>{item.label}</span>
                      <strong style={{ fontFamily: FONT_NUM }}>{item.value}</strong>
                    </div>
                  </div>
                );
              })}
            </article>
          )}

          {inhouse.length > 0 && (
            <article className="pd-card pd-table-card">
              <div className="pd-card-head">
                <div className="pd-card-title-wrap">
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
                        ? Math.max(
                            0,
                            Math.ceil(
                              (new Date(`${dep}T00:00:00`) - new Date(`${today}T00:00:00`)) /
                                86400000,
                            ),
                          )
                        : null;

                      return (
                        <tr key={res._id} onClick={() => navigate(PMS('/folio'))}>
                          <td>
                            <div className="pd-table-guest">
                              {res.isVip && <Crown size={12} />}
                              <span>{guest ? `${guest.firstName} ${guest.lastName}` : 'Guest'}</span>
                            </div>
                          </td>
                          <td>{res.assignedRoom?.number || '—'}</td>
                          <td>{fmtDate(dep)}</td>
                          <td>{nightsLeft === null ? '—' : nightsLeft}</td>
                          <td>
                            <span className={`pd-pill ${res.paymentStatus === 'paid' ? 'pd-pill-ok' : 'pd-pill-danger'}`}>
                              {res.paymentStatus === 'paid' ? 'Paid' : 'Due'}
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
              <div className="pd-card-title-wrap">
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
              <div>
                <span>דחוף</span>
                <strong>{s.hkUrgent || 0}</strong>
              </div>
            </div>
          </article>

          <article className="pd-card pd-side-card" onClick={() => navigate(PMS('/maintenance'))}>
            <div className="pd-card-head">
              <div className="pd-card-title-wrap">
                <Wrench size={15} />
                <h3>תחזוקה פתוחה</h3>
              </div>
            </div>
            <div className="pd-maintenance-number" style={{ fontFamily: FONT_NUM }}>
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
