// "היום" — front-desk home. Layout is a 1:1 replica of Linear's project Issues view:
// pill tabs → status-grouped dense list → Properties / Milestones / Progress side panel.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, Crown } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { dashboard, reports } from '../utils/api';
import { addDays, formatDayLabel, formatShort, todayYmd } from '../utils/date';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';

const READY_CLEAN = ['clean', 'inspected'];
const IN_HOUSE = ['in_house', 'checked_in'];

// ── Linear status glyphs (14px) ──────────────────────────────────────────────
function StatusIcon({ kind }) {
  const c = 'rgb(var(--fg-muted))';
  if (kind === 'backlog') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="1.6 1.6" />
      </svg>
    );
  }
  if (kind === 'todo') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="none" stroke={c} strokeWidth="1.5" />
      </svg>
    );
  }
  if (kind === 'warn') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="none" stroke="rgb(var(--danger))" strokeWidth="1.5" />
        <path d="M7 3.6v4" stroke="rgb(var(--danger))" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="10" r="0.9" fill="rgb(var(--danger))" />
      </svg>
    );
  }
  if (kind === 'progress') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="none" stroke="rgb(234 179 8)" strokeWidth="1.5" />
        <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="rgb(234 179 8)" />
      </svg>
    );
  }
  // done
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="7" fill="rgb(var(--accent-600))" />
      <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Linear's "No priority" glyph; VIP takes the priority slot.
function PrioritySlot({ vip }) {
  if (vip) return <Crown size={13} className="text-amber-600" aria-label="VIP" />;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2 7h2M6 7h2M10 7h2" stroke="rgb(var(--fg-faint))" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Diamond({ tone }) {
  const color = tone === 'danger' ? 'rgb(var(--danger))' : tone === 'warning' ? 'rgb(234 179 8)' : 'rgb(var(--fg-faint))';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 1.5L12.5 7 7 12.5 1.5 7z" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

const isVip = r => Boolean(r.isVip || r.primaryGuest?.vipLevel > 0);
const guestName = r => (r.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : 'אורח');
const initials = r => ((r.primaryGuest?.firstName?.[0] || '') + (r.primaryGuest?.lastName?.[0] || '')) || '?';
const isPaid = r => r.paymentStatus === 'paid';

function roomDot(room) {
  if (!room) return 'dot-red';
  if (room.opsStatus && room.opsStatus !== 'available') return 'dot-red';
  return READY_CLEAN.includes(room.cleanStatus) ? 'dot-green' : 'dot-amber';
}

// ── Tabs & grouping ─────────────────────────────────────────────────────────
const VIEWS = [
  { id: 'arrivals',   label: 'הגעות' },
  { id: 'departures', label: 'עזיבות' },
  { id: 'inhouse',    label: 'שוהים' },
];

function groupsFor(view, { arrivals, departures, inhouse }) {
  if (view === 'departures') {
    return [
      { id: 'due',  label: 'יתרה לתשלום',    icon: 'warn',     rows: departures.filter(r => IN_HOUSE.includes(r.status) && !isPaid(r)) },
      { id: 'out',  label: 'ממתינים ליציאה', icon: 'progress', rows: departures.filter(r => IN_HOUSE.includes(r.status) && isPaid(r)) },
      { id: 'done', label: 'יצאו',           icon: 'done',     rows: departures.filter(r => r.status === 'checked_out') },
    ];
  }
  if (view === 'inhouse') {
    return [
      { id: 'due',  label: 'יתרה פתוחה', icon: 'warn', rows: inhouse.filter(r => !isPaid(r)) },
      { id: 'paid', label: 'שולם',       icon: 'done', rows: inhouse.filter(isPaid) },
    ];
  }
  const pending = arrivals.filter(r => !IN_HOUSE.includes(r.status));
  return [
    { id: 'ready',  label: "מוכנים לצ'ק-אין", icon: 'progress', rows: pending.filter(r => r.assignedRoom && roomDot(r.assignedRoom) === 'dot-green') },
    { id: 'dirty',  label: 'חדר לא מוכן',     icon: 'todo',     rows: pending.filter(r => r.assignedRoom && roomDot(r.assignedRoom) !== 'dot-green') },
    { id: 'noroom', label: 'ללא שיבוץ חדר',   icon: 'backlog',  rows: pending.filter(r => !r.assignedRoom) },
    { id: 'done',   label: 'נכנסו',            icon: 'done',     rows: arrivals.filter(r => IN_HOUSE.includes(r.status)) },
  ];
}

// ── Alerts → "Milestones" ───────────────────────────────────────────────────
const ALERT_KINDS = [
  { prefix: 'noroom',   label: 'שיבוץ חדרים להגעות',  unit: 'הזמנות', route: '/pms/tape-chart' },
  { prefix: 'vip',      label: 'חדר VIP לא נקי',       unit: 'חדרים',  route: '/pms/housekeeping' },
  { prefix: 'dirty',    label: 'חדרים לא מוכנים',      unit: 'חדרים',  route: '/pms/housekeeping' },
  { prefix: 'maint',    label: 'תקלה קריטית בחדר',     unit: 'קריאות', route: '/pms/maintenance' },
  { prefix: 'pendpay',  label: 'תשלום ממתין להגעה',    unit: 'הזמנות', route: '/pms/reservations' },
  { prefix: 'balance',  label: 'יתרה פתוחה ביציאה',    unit: 'הזמנות', route: '/pms/check-out' },
  { prefix: 'failpay',  label: 'תשלומים שנכשלו',       unit: 'תשלומים', route: '/pms/folio' },
  { prefix: 'channel',  label: 'סנכרון ערוצי הפצה',    unit: 'עדכונים', route: '/pms/channel-manager' },
];

function summarizeAlerts(alerts) {
  return ALERT_KINDS.map(kind => {
    const items = alerts.filter(a => String(a.id || '').startsWith(kind.prefix));
    const tone = items.some(a => a.type === 'danger') ? 'danger' : 'warning';
    return { ...kind, count: items.length, tone };
  }).filter(k => k.count > 0);
}

// ── Pieces ──────────────────────────────────────────────────────────────────
function Row({ r, view, onOpen, icon }) {
  const room = r.assignedRoom;
  const done = icon === 'done';
  const dateValue = view === 'departures' ? r.arrivalDate : r.departureDate;
  const dateTitle = view === 'departures' ? 'תאריך הגעה' : 'תאריך יציאה';
  return (
    <button type="button" className={`lin-row ${done ? 'is-done' : ''}`} onClick={() => onOpen(r)}>
      <span className="slot"><PrioritySlot vip={isVip(r)} /></span>
      <span className="rid">{r.confirmationNumber}</span>
      <span className="slot"><StatusIcon kind={icon} /></span>
      <span className="title">{guestName(r)}</span>
      {r.roomType?.name && <span className="sub">‹ {r.roomType.name}</span>}
      <span className="spacer" />
      <span className="meta">
        <span className="lin-chip chip-optional">{r.nights || 0} לילות</span>
        <span className="lin-chip">
          <span className={`dot ${roomDot(room)}`} />
          {room ? `חדר ${room.number}` : 'ללא חדר'}
        </span>
      </span>
      <span className="lin-avatar" aria-hidden="true">{initials(r)}</span>
      <span className="date" title={dateTitle}>{dateValue ? formatShort(dateValue) : '—'}</span>
    </button>
  );
}

function Group({ group, view, collapsed, onToggle, onOpen }) {
  return (
    <div>
      <button type="button" className="lin-group" aria-expanded={!collapsed} onClick={onToggle}>
        <ChevronDown size={12} className="caret" />
        <StatusIcon kind={group.icon} />
        <span>{group.label}</span>
        <span className="count">{group.rows.length}</span>
      </button>
      {!collapsed && (
        <div className="lin-rows">
          {group.rows.map(r => <Row key={r._id} r={r} view={view} icon={group.icon} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

function Prop({ label, children, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className="lin-prop" onClick={onClick}>
      <span className="k">{label}</span>
      <span className="v">{children}</span>
    </Tag>
  );
}

function Ring({ value }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  const r = 6;
  const len = 2 * Math.PI * r;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" stroke="rgb(var(--neutral-200))" strokeWidth="2" />
      <circle
        cx="8" cy="8" r={r} fill="none" stroke="rgb(var(--accent-600))" strokeWidth="2"
        strokeDasharray={`${(pct / 100) * len} ${len}`} transform="rotate(-90 8 8)" strokeLinecap="round"
      />
    </svg>
  );
}

function ForecastChart({ days, today }) {
  if (!days.length) return <div className="px-[10px] pb-2 text-[12.5px] text-ink-muted">אין נתוני תחזית</div>;
  const h = 72;
  return (
    <div className="px-[10px] pb-1">
      <div className="flex items-end gap-[6px]" style={{ height: h }} role="img" aria-label="תפוסה צפויה לשבוע הקרוב">
        {days.map(d => (
          <div key={d.date} className="flex-1 flex flex-col justify-end h-full" title={`${formatShort(d.date)} · ${d.occupancy || 0}%`}>
            <div
              className="rounded-[3px]"
              style={{
                height: `${Math.max(3, ((d.occupancy || 0) / 100) * h)}px`,
                background: d.date === today ? 'rgb(var(--accent-600))' : 'rgb(var(--neutral-300))',
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[6px] mt-1.5">
        {days.map(d => (
          <div key={d.date} className={`flex-1 text-center text-[11px] ${d.date === today ? 'text-ink font-medium' : 'text-ink-muted'}`}>
            {d.date === today ? 'היום' : formatDayLabel(d.date)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { propertyId } = useProperty() || {};
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(v => v.id === params.get('view')) ? params.get('view') : 'arrivals';
  const [collapsed, setCollapsed] = useState(() => new Set(['done', 'paid']));
  const [refreshKey, setRefreshKey] = useState(0);
  const skip = !propertyId;
  const today = todayYmd();

  // Quiet background refresh every 3 minutes (no spinner once data is on screen).
  useEffect(() => {
    const id = setInterval(() => setRefreshKey(k => k + 1), 180_000);
    return () => clearInterval(id);
  }, []);

  const deps = [propertyId, refreshKey];
  const stats    = useApi(() => dashboard.stats(propertyId), deps, skip);
  const arrQ     = useApi(() => dashboard.arrivals(propertyId), deps, skip);
  const depQ     = useApi(() => dashboard.departures(propertyId), deps, skip);
  const inQ      = useApi(() => dashboard.inhouse(propertyId), deps, skip);
  const alertsQ  = useApi(() => dashboard.alerts(propertyId), deps, skip);
  const forecastQ = useApi(() => reports.summary(propertyId, today, addDays(today, 7)), deps, skip);

  const data = useMemo(() => ({
    arrivals: arrQ.data || [],
    departures: depQ.data || [],
    inhouse: inQ.data || [],
  }), [arrQ.data, depQ.data, inQ.data]);

  const firstLoad = !stats.data && !stats.error;
  if (skip || (firstLoad && stats.loading)) return <PageSpinner />;
  if (stats.error && !stats.data) return <ErrorState message={stats.error} onRetry={stats.refetch} />;

  const s = stats.data || {};
  const counts = { arrivals: data.arrivals.length, departures: data.departures.length, inhouse: data.inhouse.length };
  const groups = groupsFor(view, data).filter(g => g.rows.length > 0);
  const listLoading = (view === 'arrivals' && arrQ.loading && !arrQ.data)
    || (view === 'departures' && depQ.loading && !depQ.data)
    || (view === 'inhouse' && inQ.loading && !inQ.data);
  const listError = { arrivals: arrQ, departures: depQ, inhouse: inQ }[view].error;

  const checkedIn = data.arrivals.filter(r => IN_HOUSE.includes(r.status)).length;
  const checkedOut = data.departures.filter(r => r.status === 'checked_out').length;
  const hkTotal = (s.hkPending || 0) + (s.hkInProgress || 0) + (s.hkCompleted || 0);
  const issues = summarizeAlerts(alertsQ.data || []);
  const forecast = (forecastQ.data?.daily || []).slice(0, 7);
  const tomorrow = forecast.find(d => d.date === addDays(today, 1));
  const avg = forecast.length ? Math.round(forecast.reduce((t, d) => t + (d.occupancy || 0), 0) / forecast.length) : null;

  const setView = (id) => {
    const next = new URLSearchParams(params);
    if (id === 'arrivals') next.delete('view'); else next.set('view', id);
    setParams(next, { replace: true });
  };
  const toggle = (id) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openReservation = (r) => navigate(`/pms/reservations?q=${encodeURIComponent(r.confirmationNumber || guestName(r))}`);

  return (
    <div>
      <div className="lin-toolbar" role="tablist" aria-label="תצוגה">
        {VIEWS.map(v => (
          <button
            key={v.id}
            type="button"
            role="tab"
            className="lin-tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
          >
            {v.label}
            <span className="count">{counts[v.id]}</span>
          </button>
        ))}
      </div>

      <div className="lin-body">
        <section className="lin-list" aria-label={VIEWS.find(v => v.id === view).label}>
          {listLoading && <div className="lin-empty">טוען…</div>}
          {!listLoading && listError && (
            <div className="lin-empty"><strong>הרשימה לא נטענה</strong>{listError}</div>
          )}
          {!listLoading && !listError && groups.length === 0 && (
            <div className="lin-empty">
              <strong>
                {view === 'arrivals' ? 'אין הגעות היום' : view === 'departures' ? 'אין עזיבות היום' : 'אין אורחים שוהים'}
              </strong>
              הרשימה מתעדכנת אוטומטית
            </div>
          )}
          {!listLoading && !listError && groups.map(g => (
            <Group
              key={`${view}-${g.id}`}
              group={g}
              view={view}
              collapsed={collapsed.has(g.id)}
              onToggle={() => toggle(g.id)}
              onOpen={openReservation}
            />
          ))}
        </section>

        <aside className="lin-side" aria-label="סיכום">
          <div className="lin-panel">
            <div className="lin-panel-head">מצב המלון</div>
            <Prop label="תפוסה" onClick={() => navigate('/pms/tape-chart')}>
              <Ring value={s.occupancy} />
              {s.occupancy ?? 0}%
              <span className="muted">{s.inHouse || 0} מתוך {s.totalRooms || 0} חדרים</span>
            </Prop>
            <Prop label="הגעות" onClick={() => navigate('/pms/arrivals')}>
              {checkedIn} / {counts.arrivals}
              <span className="muted">נכנסו</span>
            </Prop>
            <Prop label="עזיבות" onClick={() => navigate('/pms/check-out')}>
              {checkedOut} / {counts.departures}
              <span className="muted">יצאו</span>
            </Prop>
            <Prop label="מצב חדרים" onClick={() => navigate('/pms/rooms')}>
              <span className="inline-flex items-center gap-1.5"><span className="dot dot-green w-2 h-2 rounded-full inline-block" />{s.cleanRooms || 0}<span className="muted">נקי</span></span>
              <span className="inline-flex items-center gap-1.5"><span className="dot dot-amber w-2 h-2 rounded-full inline-block" />{s.dirtyRooms || 0}<span className="muted">מלוכלך</span></span>
              <span className="inline-flex items-center gap-1.5"><span className="dot dot-red w-2 h-2 rounded-full inline-block" />{(s.oooRooms || 0) + (s.holdRooms || 0)}<span className="muted">מושבת</span></span>
            </Prop>
            <Prop label="חדרנות" onClick={() => navigate('/pms/housekeeping')}>
              {s.hkCompleted || 0} / {hkTotal}
              <span className="muted">{s.hkUrgent ? `${s.hkUrgent} דחופות` : 'משימות הושלמו'}</span>
            </Prop>
            <Prop label="תחזוקה" onClick={() => navigate('/pms/maintenance')}>
              {s.maintenanceOpen || 0}
              <span className="muted">קריאות פתוחות</span>
            </Prop>
            <Prop label="יתרות פתוחות" onClick={() => navigate('/pms/folio')}>
              {s.openBalances || 0}
              <span className="muted">חשבונות</span>
            </Prop>
          </div>

          <div className="lin-panel">
            <div className="lin-panel-head">
              דורש טיפול
              {issues.length > 0 && <span className="text-ink-muted font-normal">{issues.reduce((t, i) => t + i.count, 0)}</span>}
            </div>
            {alertsQ.error && !alertsQ.data && (
              <div className="lin-ms is-quiet"><Diamond /><span className="label">ההתראות לא נטענו</span></div>
            )}
            {!alertsQ.error && issues.length === 0 && (
              <div className="lin-ms is-quiet"><Diamond /><span className="label">אין פריטים פתוחים</span></div>
            )}
            {issues.map(i => (
              <button key={i.prefix} type="button" className="lin-ms" onClick={() => navigate(i.route)}>
                <Diamond tone={i.tone} />
                <span className="label">{i.label}</span>
                <span className="count">{i.count} {i.unit}</span>
                <span className="go">לטיפול ←</span>
              </button>
            ))}
          </div>

          <div className="lin-panel">
            <div className="lin-panel-head">תפוסה צפויה</div>
            <div className="lin-stats">
              <div className="lin-stat">
                <div className="k"><i style={{ background: 'rgb(var(--accent-600))' }} />היום</div>
                <div className="v">{s.occupancy ?? 0}%</div>
              </div>
              <div className="lin-stat">
                <div className="k"><i style={{ background: 'rgb(var(--neutral-300))' }} />מחר</div>
                <div className="v">{tomorrow ? `${tomorrow.occupancy || 0}%` : '—'}</div>
              </div>
              <div className="lin-stat">
                <div className="k"><i style={{ background: 'rgb(var(--neutral-400))' }} />ממוצע 7 ימים</div>
                <div className="v">{avg != null ? `${avg}%` : '—'}</div>
              </div>
            </div>
            <ForecastChart days={forecast} today={today} />
          </div>
        </aside>
      </div>
    </div>
  );
}
