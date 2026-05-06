import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, RefreshCw, Crown, AlertCircle,
  Sparkles, Wrench, LogIn, LogOut, X, Search, Filter,
  Calendar, BedDouble, Moon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { rooms as roomsApi, reservations as resApi } from '../utils/api';
import { TODAY, addDays, formatShort, formatDayLabel, isWeekend } from '../utils/date';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import ReservationDrawer from '../components/reservations/ReservationDrawer';

/* ─────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
const COL_W    = 52;   // px per day column
const ROW_H    = 44;   // px per room row
const LABEL_W  = 196;  // px for the left room-label panel
const HEADER_H = 68;   // px for the sticky date header (month + day)

/* Status visual config — matches OPERA palette */
const STATUS_CFG = {
  confirmed:       { bg:'#6366f1', text:'#fff', border:'#4f46e5', label:'מאושר' },
  in_house:        { bg:'#2563eb', text:'#fff', border:'#1d4ed8', label:'In House' },
  due_out:         { bg:'#f97316', text:'#fff', border:'#ea580c', label:'יציאה היום' },
  checked_out:     { bg:'#94a3b8', text:'#fff', border:'#64748b', label:'עזב' },
  cancelled:       { bg:'#dc2626', text:'#fff', border:'#b91c1c', label:'בוטל', striped: true },
  no_show:         { bg:'#991b1b', text:'#fff', border:'#7f1d1d', label:'No Show', striped: true },
  pending_payment: { bg:'#d97706', text:'#fff', border:'#b45309', label:'ממתין לתשלום' },
  modified:        { bg:'#7c3aed', text:'#fff', border:'#6d28d9', label:'שונה' },
};

function getStatusCfg(res) {
  if (res.status === 'in_house' && res.departureDate === TODAY) return STATUS_CFG.due_out;
  return STATUS_CFG[res.status] || STATUS_CFG.confirmed;
}

/* Clean-status dot colors */
const CLEAN_DOT = {
  clean:     '#059669',
  inspected: '#0891b2',
  dirty:     '#f59e0b',
  cleaning:  '#7c3aed',
};

/* OOO diagonal stripe */
const OOO_BG = 'repeating-linear-gradient(45deg,rgba(239,68,68,0.12),rgba(239,68,68,0.12) 4px,transparent 4px,transparent 12px)';
const HOLD_BG = 'repeating-linear-gradient(45deg,rgba(168,85,247,0.10),rgba(168,85,247,0.10) 4px,transparent 4px,transparent 12px)';

const STATUS_OPTIONS = [
  { value: 'active',   label: 'הזמנות פעילות' },
  { value: 'all',      label: 'כולל עזבו/בוטל' },
];

/* ─────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */
function buildDays(startDate, count) {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(startDate, i);
    const d    = new Date(date + 'T00:00:00');
    return {
      date,
      day:     d.getDate(),
      month:   d.getMonth(),
      year:    d.getFullYear(),
      weekday: formatDayLabel(date),
      isToday: date === TODAY,
      isWeekend: isWeekend(date),
    };
  });
}

/* Group consecutive days by month, return [{month,year,span}] */
function monthGroups(days) {
  const groups = [];
  days.forEach(d => {
    const last = groups[groups.length - 1];
    if (last && last.month === d.month && last.year === d.year) {
      last.span++;
    } else {
      groups.push({ month: d.month, year: d.year, span: 1 });
    }
  });
  return groups;
}

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

/* Calculate left offset + width for a reservation block within visible days */
function resLayout(res, days) {
  const first = days[0].date;
  const last  = days[days.length - 1].date;
  if (res.departureDate <= first || res.arrivalDate > last) return null;
  // clamp to visible range
  const clampedStart = res.arrivalDate < first ? first : res.arrivalDate;
  const clampedEnd   = res.departureDate > addDays(last, 1) ? addDays(last, 1) : res.departureDate;
  const startIdx = days.findIndex(d => d.date >= clampedStart);
  const endIdx   = days.findIndex(d => d.date >= clampedEnd);
  const start    = startIdx === -1 ? 0 : startIdx;
  const end      = endIdx   === -1 ? days.length : endIdx;
  const span     = Math.max(1, end - start);
  const clippedLeft  = res.arrivalDate < first;
  const clippedRight = res.departureDate > addDays(last, 1);
  return { left: start * COL_W, width: span * COL_W - 2, span, clippedLeft, clippedRight };
}

function nightsBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

function initials(g) {
  return ((g?.firstName?.[0] || '') + (g?.lastName?.[0] || '')).toUpperCase();
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Tooltip                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */
function ResTooltip({ res, x, y }) {
  const cfg    = getStatusCfg(res);
  const g      = res.primaryGuest || {};
  const nights = nightsBetween(res.arrivalDate, res.departureDate);
  const flipX  = x > window.innerWidth - 280;

  return (
    <div style={{
      position: 'fixed', zIndex: 9999, pointerEvents: 'none',
      left: flipX ? x - 264 : x + 14,
      top:  y - 8,
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 14,
      boxShadow: '0 16px 48px rgba(15,23,42,0.18)',
      minWidth: 248,
      overflow: 'hidden',
      direction: 'rtl',
    }}>
      {/* coloured header */}
      <div style={{ padding:'12px 14px 10px', background: cfg.bg }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, color:'#fff', fontWeight:800, fontSize:13 }}>
          {g.vipLevel > 0 && <Crown size={12} />}
          {g.firstName} {g.lastName}
        </div>
        <div style={{ color:'rgba(255,255,255,0.7)', fontSize:11, marginTop:2 }}>
          {res.confirmationNumber} · {cfg.label}
        </div>
      </div>
      {/* details */}
      <div style={{ padding:'10px 14px', display:'flex', flexDirection:'column', gap:5, fontSize:12 }}>
        {[
          { label:'כניסה',       value: formatShort(res.arrivalDate)   },
          { label:'יציאה',       value: formatShort(res.departureDate) },
          { label:'לילות',       value: nights                          },
          { label:'חדר',         value: res.assignedRoom?.number || '—' },
          { label:'מחיר ללילה',  value: res.ratePerNight ? `₪${res.ratePerNight.toLocaleString('he-IL')}` : '—' },
          { label:'סה"כ',        value: res.totalAmount   ? `₪${res.totalAmount.toLocaleString('he-IL')}` : '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{ display:'flex', justifyContent:'space-between', borderBottom:'1px solid #f1f5f9', paddingBottom:3 }}>
            <span style={{ color:'#64748b' }}>{label}</span>
            <span style={{ fontWeight:600, color:'#0f172a', fontFamily:'monospace' }}>{value}</span>
          </div>
        ))}
        {res.specialRequests && (
          <div style={{ marginTop:2, fontSize:11, color:'#64748b', fontStyle:'italic' }}>
            ★ {res.specialRequests}
          </div>
        )}
        {res.isVip && (
          <div style={{ background:'#fef3c7', color:'#92400e', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, textAlign:'center' }}>
            👑 VIP Guest
          </div>
        )}
      </div>
      <div style={{ padding:'6px 14px 10px', fontSize:11, color:'#94a3b8' }}>
        לחץ לפתיחת ההזמנה
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Reservation block                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */
function ResBlock({ res, layout, onHover, onLeave, onClick }) {
  const cfg  = getStatusCfg(res);
  const g    = res.primaryGuest || {};
  const isNarrow = layout.span < 2;

  const stripedBg = cfg.striped
    ? `repeating-linear-gradient(45deg,${cfg.bg},${cfg.bg} 5px,${cfg.border} 5px,${cfg.border} 10px)`
    : cfg.bg;

  return (
    <div
      onMouseEnter={e => onHover(res, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      onMouseMove={e  => onHover(res, e.clientX, e.clientY)}
      onClick={() => onClick(res)}
      style={{
        position:   'absolute',
        left:       layout.left + 1,
        top:        5,
        width:      layout.width,
        height:     ROW_H - 10,
        background: stripedBg,
        borderRadius: 6,
        borderLeft:  layout.clippedLeft  ? 'none' : `3px solid ${cfg.border}`,
        borderRight: layout.clippedRight ? 'none' : undefined,
        borderTopLeftRadius:     layout.clippedLeft  ? 0 : 6,
        borderBottomLeftRadius:  layout.clippedLeft  ? 0 : 6,
        borderTopRightRadius:    layout.clippedRight ? 0 : 6,
        borderBottomRightRadius: layout.clippedRight ? 0 : 6,
        cursor: 'pointer',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        paddingInline: '6px 4px',
        gap: 4,
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        zIndex: 2,
        transition: 'filter 0.1s, box-shadow 0.1s',
      }}
      onMouseEnterCapture={e => { e.currentTarget.style.filter = 'brightness(1.08)'; e.currentTarget.style.boxShadow = '0 3px 10px rgba(0,0,0,0.25)'; }}
      onMouseLeaveCapture={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.15)'; }}
    >
      {g.vipLevel > 0 && !isNarrow && (
        <Crown size={10} style={{ color:'#fde68a', flexShrink:0 }} />
      )}
      {!isNarrow && (
        <span style={{
          color: cfg.text, fontSize: 11, fontWeight: 700,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex:1,
        }}>
          {g.firstName} {g.lastName?.[0]}.
        </span>
      )}
      {layout.span >= 3 && (
        <span style={{ color:'rgba(255,255,255,0.6)', fontSize:10, flexShrink:0 }}>
          {nightsBetween(res.arrivalDate, res.departureDate)}ל
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Main Component                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */
export default function TapeChartPage() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const skip = !propertyId;
  const { toasts, success, error: toastErr } = useToast();

  /* ── view state ────────────────────────────────────────────────────────── */
  const [startDate,   setStartDate]   = useState(() => addDays(TODAY, -3));
  const [dayCount,    setDayCount]    = useState(21);
  const [filterFloor, setFilterFloor] = useState('all');
  const [filterType,  setFilterType]  = useState('all');
  const [filterStatus,setFilterStatus]= useState('active');
  const [tooltip,     setTooltip]     = useState(null); // { res, x, y }
  const [selectedRes, setSelectedRes] = useState(null); // for drawer
  const containerRef = useRef(null);

  /* ── data ──────────────────────────────────────────────────────────────── */
  const statusFilter = filterStatus === 'all'
    ? 'confirmed,in_house,checked_out,cancelled,no_show,modified,pending_payment'
    : 'confirmed,in_house,modified,pending_payment';

  const { data: roomList, loading: l1, error: e1, refetch: r1 } = useApi(
    () => roomsApi.list(propertyId),
    [propertyId], skip
  );
  const { data: resList, loading: l2, error: e2, refetch: r2 } = useApi(
    () => resApi.list(propertyId, { status: statusFilter, limit: 500 }),
    [propertyId, statusFilter], skip
  );

  const refetch = useCallback(() => { r1(); r2(); }, [r1, r2]);

  /* ── derived ───────────────────────────────────────────────────────────── */
  const days   = useMemo(() => buildDays(startDate, dayCount), [startDate, dayCount]);
  const months = useMemo(() => monthGroups(days), [days]);

  const allRooms = useMemo(() => roomList || [], [roomList]);
  const allRes   = useMemo(() => resList  || [], [resList]);

  const typeMap = useMemo(() => {
    const m = {};
    allRooms.forEach(r => { if (r.roomType?._id) m[r.roomType._id] = r.roomType; });
    return m;
  }, [allRooms]);
  const uniqueTypes = useMemo(() => Object.values(typeMap), [typeMap]);
  const floors      = useMemo(() => [...new Set(allRooms.map(r => r.floor))].sort((a,b)=>a-b), [allRooms]);

  const filteredRooms = useMemo(() => allRooms.filter(r => {
    if (filterFloor !== 'all' && r.floor !== Number(filterFloor)) return false;
    if (filterType  !== 'all' && String(r.roomType?._id) !== filterType) return false;
    return true;
  }), [allRooms, filterFloor, filterType]);

  const byFloor = useMemo(() => floors
    .map(f => ({ floor: f, rooms: filteredRooms.filter(r => r.floor === f) }))
    .filter(g => g.rooms.length > 0),
    [floors, filteredRooms]
  );

  /* index reservations by assigned room */
  const resByRoom = useMemo(() => {
    const map = {};
    allRes.forEach(res => {
      const key = String(res.assignedRoom?._id || res.assignedRoom || '');
      if (!key || key === 'null' || key === 'undefined') return;
      (map[key] = map[key] || []).push(res);
    });
    return map;
  }, [allRes]);

  /* Unassigned reservations in current view */
  const unassignedRes = useMemo(() => {
    return allRes.filter(res => {
      const hasRoom = res.assignedRoom && String(res.assignedRoom) !== 'null';
      if (hasRoom) return false;
      return res.departureDate > days[0].date && res.arrivalDate <= days[days.length - 1].date;
    });
  }, [allRes, days]);

  /* ── navigation ────────────────────────────────────────────────────────── */
  const goBack    = () => setStartDate(d => addDays(d, -7));
  const goForward = () => setStartDate(d => addDays(d,  7));
  const goToday   = () => setStartDate(addDays(TODAY, -3));

  /* ── tooltip ───────────────────────────────────────────────────────────── */
  const handleHover   = useCallback((res, x, y) => setTooltip({ res, x, y }), []);
  const handleUnhover = useCallback(() => setTooltip(null), []);

  /* ── cell click → new reservation ─────────────────────────────────────── */
  function handleCellClick(room, date) {
    navigate(`/pms/reservations?newRoom=${room._id}&newDate=${date}`);
  }

  /* ── block click → open drawer ─────────────────────────────────────────── */
  function handleResClick(res) {
    setTooltip(null);
    setSelectedRes(res);
  }

  /* ── close tooltip on scroll ───────────────────────────────────────────── */
  useEffect(() => {
    const hide = () => setTooltip(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, []);

  /* ── today column index ────────────────────────────────────────────────── */
  const todayIdx = days.findIndex(d => d.isToday);

  /* ── scroll today into view on mount ──────────────────────────────────── */
  useEffect(() => {
    if (todayIdx > 0 && containerRef.current) {
      containerRef.current.scrollLeft = Math.max(0, todayIdx * COL_W - 80);
    }
  }, []);

  if (skip || l1 || l2) return <PageSpinner />;
  if (e1) return <ErrorState message={e1} onRetry={r1} />;

  const totalWidth = LABEL_W + days.length * COL_W;

  return (
    <div className="animate-fade-in" style={{ direction:'rtl' }}>
      <ToastContainer toasts={toasts} />

      {/* ── tooltip ── */}
      {tooltip && <ResTooltip res={tooltip.res} x={tooltip.x} y={tooltip.y} />}

      {/* ── reservation drawer ── */}
      {selectedRes && (
        <ReservationDrawer
          reservationId={selectedRes._id}
          propertyId={propertyId}
          onClose={() => { setSelectedRes(null); refetch(); }}
        />
      )}

      {/* ─── HEADER BAR ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="page-title">Tape Chart</h1>
          <p className="page-subtitle">תצוגת חדרים × תאריכים</p>
        </div>

        <div className="mr-auto flex items-center gap-2 flex-wrap">
          {/* Status filter */}
          <select
            className="select text-sm"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Floor filter */}
          <select className="select text-sm" value={filterFloor} onChange={e => setFilterFloor(e.target.value)}>
            <option value="all">כל הקומות</option>
            {floors.map(f => <option key={f} value={f}>קומה {f}</option>)}
          </select>

          {/* Room type filter */}
          <select className="select text-sm" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">כל הסוגים</option>
            {uniqueTypes.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>

          {/* Day range selector */}
          <div className="flex rounded-lg border border-surface-border overflow-hidden text-xs">
            {[14, 21, 30].map(n => (
              <button
                key={n}
                onClick={() => setDayCount(n)}
                className={`px-3 py-1.5 font-medium transition-colors ${dayCount === n ? 'bg-brand text-white' : 'bg-white text-ink-secondary hover:bg-surface-hover'}`}
              >
                {n}י
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1">
            <button onClick={goBack}    className="btn btn-ghost btn-icon btn-sm"><ChevronRight size={16} /></button>
            <button onClick={goToday}   className="btn btn-secondary btn-sm">היום</button>
            <button onClick={goForward} className="btn btn-ghost btn-icon btn-sm"><ChevronLeft size={16} /></button>
          </div>

          <button onClick={refetch} className="btn btn-ghost btn-icon" title="רענן">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* ─── LEGEND ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-3 flex-wrap">
        {[
          { key:'confirmed',       label:'מאושר' },
          { key:'in_house',        label:'In House' },
          { key:'due_out',         label:'יציאה היום' },
          { key:'pending_payment', label:'ממתין לתשלום' },
          { key:'checked_out',     label:'עזב' },
          { key:'cancelled',       label:'בוטל' },
        ].map(({ key, label }) => {
          const cfg = STATUS_CFG[key];
          return (
            <div key={key} className="flex items-center gap-1.5 text-xs text-ink-muted">
              <div style={{ width:24, height:12, borderRadius:3, background:cfg.bg }} />
              {label}
            </div>
          );
        })}
        <div className="flex items-center gap-1.5 text-xs text-ink-muted mr-2">
          <div style={{ width:16, height:12, borderRadius:3, background:'rgba(99,102,241,0.08)', border:'1.5px solid #6366f1' }} />
          היום
        </div>
        {unassignedRes.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-700 font-semibold mr-auto">
            <AlertCircle size={12} />
            {unassignedRes.length} הזמנות ללא חדר
          </div>
        )}
      </div>

      {/* ─── GRID ───────────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 240px)',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          background: '#fff',
          position: 'relative',
        }}
      >
        <div style={{ minWidth: totalWidth, position: 'relative' }}>

          {/* ── STICKY DATE HEADER ─── */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 30,
            background: '#fff',
            borderBottom: '2px solid #e2e8f0',
            display: 'flex',
            height: HEADER_H,
          }}>
            {/* Corner cell */}
            <div style={{
              width: LABEL_W, flexShrink: 0,
              position: 'sticky', left: 0, zIndex: 40,
              background: '#1a2235',
              display: 'flex', alignItems: 'center', paddingInline: 14,
              borderBottom: '2px solid #0f172a',
            }}>
              <div>
                <div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{filteredRooms.length} חדרים</div>
                <div style={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>
                  {formatShort(days[0].date)} — {formatShort(days[days.length - 1].date)}
                </div>
              </div>
            </div>

            {/* Date columns header */}
            <div style={{ position:'relative', flex:1 }}>
              {/* Month labels row */}
              <div style={{ display:'flex', height:22, borderBottom:'1px solid #f1f5f9' }}>
                {months.map((m, i) => (
                  <div key={i} style={{
                    width: m.span * COL_W,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center',
                    paddingInline: 8,
                    fontSize: 11, fontWeight: 700, color: '#475569',
                    borderLeft: i > 0 ? '1px solid #f1f5f9' : 'none',
                  }}>
                    {HE_MONTHS[m.month]} {m.year}
                  </div>
                ))}
              </div>

              {/* Day labels row */}
              <div style={{ display:'flex', height: HEADER_H - 22 }}>
                {days.map((d, i) => (
                  <div
                    key={d.date}
                    style={{
                      width: COL_W, flexShrink: 0,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 1,
                      borderLeft: '1px solid #f1f5f9',
                      background: d.isToday
                        ? 'rgba(99,102,241,0.08)'
                        : d.isWeekend
                          ? 'rgba(0,0,0,0.015)'
                          : 'transparent',
                      position: 'relative',
                    }}
                  >
                    {d.isToday && (
                      <div style={{
                        position:'absolute', bottom:0, left:'50%', transform:'translateX(-50%)',
                        width:3, height:3, borderRadius:'50%', background:'#6366f1'
                      }} />
                    )}
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: d.isToday ? '#6366f1' : d.isWeekend ? '#7c3aed' : '#94a3b8',
                    }}>{d.weekday}</span>
                    <span style={{
                      fontSize: 14,
                      fontWeight: d.isToday ? 800 : 600,
                      color: d.isToday ? '#6366f1' : d.isWeekend ? '#6d28d9' : '#0f172a',
                      lineHeight: 1,
                    }}>{d.day}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── ROOM ROWS ─── */}
          {byFloor.map(({ floor, rooms }) => (
            <div key={floor}>
              {/* Floor separator */}
              <div style={{
                display: 'flex',
                position: 'sticky', left: 0,
                background: '#1a2235',
                height: 28,
                alignItems: 'center',
                zIndex: 20,
                minWidth: totalWidth,
              }}>
                <div style={{
                  position: 'sticky', left: 0,
                  paddingInline: 14,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Moon size={11} style={{ color:'rgba(255,255,255,0.4)' }} />
                  <span style={{ color:'rgba(255,255,255,0.7)', fontSize:11, fontWeight:700 }}>
                    קומה {floor}
                  </span>
                  <span style={{ color:'rgba(255,255,255,0.35)', fontSize:10 }}>
                    ({rooms.length} חדרים)
                  </span>
                </div>
              </div>

              {/* Room rows */}
              {rooms.map((room, ri) => {
                const isOOO  = ['out_of_order','out_of_service'].includes(room.opsStatus);
                const isHold = room.opsStatus === 'maintenance_hold';
                const roomResArr = resByRoom[String(room._id)] || [];
                const rowBg = isOOO  ? OOO_BG
                            : isHold ? HOLD_BG
                            : ri % 2 === 0 ? '#fafbfd' : '#fff';

                return (
                  <div
                    key={room._id}
                    data-room-id={String(room._id)}
                    style={{
                      display: 'flex',
                      height: ROW_H,
                      borderBottom: '1px solid #f1f5f9',
                    }}
                  >
                    {/* Room label — sticky left */}
                    <div style={{
                      position: 'sticky', left: 0, zIndex: 10,
                      width: LABEL_W, flexShrink: 0,
                      display: 'flex', alignItems: 'center', gap: 8,
                      paddingInline: 12,
                      background: isOOO ? 'rgba(254,226,226,0.6)' : isHold ? 'rgba(245,208,254,0.4)' : ri % 2 === 0 ? '#fafbfd' : '#fff',
                      borderLeft: '3px solid ' + (isOOO ? '#dc2626' : isHold ? '#7c3aed' : (room.roomType?.code ? '#6366f1' : '#e2e8f0')),
                      borderRight: '1px solid #e2e8f0',
                    }}>
                      {/* Room number */}
                      <div style={{
                        width: 40, flexShrink: 0,
                        fontWeight: 800, fontSize: 15,
                        color: isOOO ? '#dc2626' : '#0f172a',
                        lineHeight: 1,
                      }}>{room.number}</div>

                      {/* Room type + status */}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:10, fontWeight:600, color:'#6366f1', truncate:'ellipsis', overflow:'hidden', whiteSpace:'nowrap' }}>
                          {room.roomType?.code || room.roomType?.name || '—'}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:1 }}>
                          <div style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: CLEAN_DOT[room.cleanStatus] || '#94a3b8',
                            flexShrink: 0,
                          }} />
                          {isOOO && <span style={{ fontSize:9, color:'#dc2626', fontWeight:700 }}>OOO</span>}
                          {isHold && <span style={{ fontSize:9, color:'#7c3aed', fontWeight:700 }}>Hold</span>}
                        </div>
                      </div>
                    </div>

                    {/* Grid area */}
                    <div style={{ position:'relative', flex:1, background: rowBg }}>
                      {/* Day grid lines + clickable cells */}
                      {days.map((d, i) => (
                        <div
                          key={d.date}
                          onClick={() => !isOOO && handleCellClick(room, d.date)}
                          style={{
                            position: 'absolute',
                            left: i * COL_W, top: 0,
                            width: COL_W, height: ROW_H,
                            borderLeft: '1px solid #f1f5f9',
                            background: d.isToday
                              ? 'rgba(99,102,241,0.04)'
                              : d.isWeekend
                                ? 'rgba(99,102,241,0.015)'
                                : 'transparent',
                            cursor: isOOO ? 'default' : 'cell',
                            zIndex: 1,
                          }}
                        />
                      ))}

                      {/* Today vertical highlight line */}
                      {todayIdx >= 0 && (
                        <div style={{
                          position: 'absolute',
                          left: todayIdx * COL_W + COL_W / 2 - 0.5,
                          top: 0, bottom: 0,
                          width: 1,
                          background: 'rgba(99,102,241,0.25)',
                          zIndex: 1, pointerEvents:'none',
                        }} />
                      )}

                      {/* Reservation blocks */}
                      {roomResArr.map(res => {
                        const layout = resLayout(res, days);
                        if (!layout) return null;
                        return (
                          <ResBlock
                            key={res._id}
                            res={res}
                            layout={layout}
                            onHover={handleHover}
                            onLeave={handleUnhover}
                            onClick={handleResClick}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* ── UNASSIGNED ROW ─── */}
          {unassignedRes.length > 0 && (
            <div>
              <div style={{
                display:'flex', position:'sticky', left:0,
                background:'rgba(245,158,11,0.1)',
                height:28, alignItems:'center', zIndex:20,
                minWidth: totalWidth,
                borderTop:'2px solid rgba(245,158,11,0.3)',
              }}>
                <div style={{ position:'sticky', left:0, paddingInline:14, display:'flex', alignItems:'center', gap:6 }}>
                  <AlertCircle size={11} style={{ color:'#d97706' }} />
                  <span style={{ color:'#92400e', fontSize:11, fontWeight:700 }}>
                    ללא חדר ({unassignedRes.length})
                  </span>
                </div>
              </div>
              <div style={{ display:'flex', height: ROW_H, borderBottom:'1px solid #fde68a' }}>
                <div style={{
                  position:'sticky', left:0, zIndex:10, width: LABEL_W, flexShrink:0,
                  display:'flex', alignItems:'center', gap:8, paddingInline:12,
                  background:'rgba(254,243,199,0.5)', borderLeft:'3px solid #d97706', borderRight:'1px solid #e2e8f0',
                }}>
                  <span style={{ fontSize:12, color:'#92400e', fontWeight:700 }}>לא שויך</span>
                </div>
                <div style={{ position:'relative', flex:1, background:'rgba(254,243,199,0.15)' }}>
                  {days.map((d,i) => (
                    <div key={d.date} style={{
                      position:'absolute', left:i*COL_W, top:0, width:COL_W, height:ROW_H,
                      borderLeft:'1px solid #fde68a',
                      background: d.isToday ? 'rgba(99,102,241,0.04)' : 'transparent',
                    }} />
                  ))}
                  {unassignedRes.map(res => {
                    const layout = resLayout(res, days);
                    if (!layout) return null;
                    return (
                      <ResBlock
                        key={res._id}
                        res={res}
                        layout={layout}
                        onHover={handleHover}
                        onLeave={handleUnhover}
                        onClick={handleResClick}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ─── FOOTER STATS ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-6 mt-3 text-xs text-ink-muted flex-wrap">
        <span><strong className="text-ink">{filteredRooms.length}</strong> חדרים מוצגים</span>
        <span><strong className="text-ink">{allRes.filter(r => ['confirmed','in_house','modified'].includes(r.status)).length}</strong> הזמנות פעילות</span>
        {byFloor.length > 0 && (
          <span><strong className="text-ink">{byFloor.length}</strong> קומות</span>
        )}
        <span className="mr-auto">לחץ על תא ריק להוספת הזמנה · לחץ על הזמנה לפתיחתה</span>
      </div>
    </div>
  );
}
