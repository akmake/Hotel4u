import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, RefreshCw, Crown, AlertCircle,
  Sparkles, Wrench, LogIn, LogOut, X, Search, Filter,
  Calendar, BedDouble, Moon, Lock, Unlock,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import useReservationDragResize from '../hooks/useReservationDragResize';
import { rooms as roomsApi, reservations as resApi } from '../utils/api';
import { TODAY, addDays, formatShort, formatDayLabel, isWeekend } from '../utils/date';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import ReservationDrawer from '../components/reservations/ReservationDrawer';
import RoomMoveDialog from '../components/reservations/RoomMoveDialog';

/* ─────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
const COL_W    = 54;   // px per day column
const ROW_H    = 54;   // px per room row
const LABEL_W  = 232;  // px for the left room-label panel
const HEADER_H = 72;   // px for the sticky date header (month + day)
const RESIZE_HANDLE_W = 10;

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
/* BlockRoomModal                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */
const OPS_LABEL = {
  out_of_order:     'Out of Order',
  maintenance_hold: 'Maintenance Hold',
  out_of_service:   'Out of Service',
  internal_use:     'Internal Use',
};
const BLOCKED_OPS = new Set(['out_of_order', 'maintenance_hold', 'out_of_service', 'internal_use']);

function BlockRoomModal({ room, propertyId, onClose, onDone }) {
  const isBlocked = BLOCKED_OPS.has(room.opsStatus);
  const [opsStatus, setOpsStatus] = useState(isBlocked ? 'available' : 'out_of_order');
  const [reason,    setReason]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const { toasts, success, error: toastErr } = useToast();

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await roomsApi.setOps(String(room._id), opsStatus, reason || undefined, propertyId);
      const targetLabel = OPS_LABEL[opsStatus] || opsStatus;
      success(opsStatus === 'available' ? 'חדר שוחרר למכירה' : `חדר ${room.number} חסום — ${targetLabel}`);
      setTimeout(() => { onDone(); onClose(); }, 600);
    } catch (e) { toastErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ direction: 'rtl' }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <ToastContainer toasts={toasts} />
        <div className="flex items-center justify-between p-5 border-b border-surface-border">
          <div>
            <div className="font-bold text-ink flex items-center gap-2">
              {isBlocked ? <Unlock size={15} /> : <Lock size={15} />}
              {isBlocked ? `שחרר חדר ${room.number}` : `חסום חדר ${room.number}`}
            </div>
            <div className="text-xs text-ink-muted">{room.roomType?.name} · קומה {room.floor}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          {!isBlocked && (
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1.5">סוג חסימה</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'out_of_order',     label: 'Out of Order',    desc: 'לא ניתן למכירה', color: '#dc2626' },
                  { value: 'maintenance_hold', label: 'On Hold',          desc: 'חסום זמנית',     color: '#7c3aed' },
                  { value: 'out_of_service',   label: 'Out of Service',  desc: 'טיפול תחזוקה',   color: '#d97706' },
                  { value: 'internal_use',     label: 'שימוש פנימי',    desc: 'צוות/ניהול',      color: '#0891b2' },
                ].map(opt => (
                  <label key={opt.value}
                    className={`flex flex-col p-2.5 rounded-xl border-2 cursor-pointer transition-colors ${opsStatus === opt.value ? 'border-brand bg-brand/5' : 'border-surface-border hover:border-ink-faint'}`}>
                    <input type="radio" name="opsStatus" value={opt.value} checked={opsStatus === opt.value} onChange={() => setOpsStatus(opt.value)} className="hidden" />
                    <span className="font-bold text-xs" style={{ color: opt.color }}>{opt.label}</span>
                    <span className="text-xs text-ink-faint">{opt.desc}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {isBlocked && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              החדר כרגע {OPS_LABEL[room.opsStatus] || room.opsStatus}. לחיצה על אישור תשחרר אותו למכירה.
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1.5">
              {isBlocked ? 'סיבת שחרור (רשות)' : 'סיבה (רשות)'}
            </label>
            <input className="input w-full text-sm" placeholder="תיאור..." value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className={`btn btn-sm flex-1 justify-center gap-1 ${isBlocked ? 'btn-primary' : 'btn-danger'}`} disabled={loading}>
              {loading ? '...' : isBlocked ? <><Unlock size={13} /> שחרר חדר</> : <><Lock size={13} /> חסום חדר</>}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* DragGhost                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function DragGhost({ drag }) {
  if (!drag) return null;
  const g = drag.res.primaryGuest || {};
  const cfg = getStatusCfg(drag.res);
  return (
    <div style={{
      position: 'fixed', zIndex: 9998, pointerEvents: 'none',
      left: drag.x - 60, top: drag.y - 16,
      width: 160, height: 32,
      background: cfg.bg, color: cfg.text,
      borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'center', padding: '0 10px',
      fontSize: 11, fontWeight: 700, opacity: 0.92,
      transform: 'rotate(-2deg)',
    }}>
      {g.firstName} {g.lastName}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* StayResizeDialog                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */
function StayResizeDialog({ pending, onConfirm, onCancel }) {
  const { res, oldDepartureDate, newDepartureDate } = pending;
  const oldNights = nightsBetween(res.arrivalDate, oldDepartureDate);
  const newNights = nightsBetween(res.arrivalDate, newDepartureDate);
  const delta = newNights - oldNights;
  const isExtend = delta > 0;
  const [nightlyRate, setNightlyRate] = useState(
    res.ratePerNight != null ? String(res.ratePerNight) : ''
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ direction: 'rtl' }}>
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-surface-border">
          <div className="font-bold text-ink">עדכון משך שהייה</div>
          <div className="text-xs text-ink-muted mt-1">
            {res.primaryGuest?.firstName} {res.primaryGuest?.lastName} · {res.confirmationNumber}
          </div>
        </div>

        <div className="p-5 text-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-ink-secondary">יציאה נוכחית</span>
            <span className="font-semibold text-ink">{formatShort(oldDepartureDate)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-secondary">יציאה חדשה</span>
            <span className="font-semibold text-ink">{formatShort(newDepartureDate)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-secondary">שינוי לילות</span>
            <span className={`font-bold ${delta > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {delta > 0 ? '+' : ''}{delta}
            </span>
          </div>

          {isExtend && (
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1.5">
                מחיר חדש ללילה (רשות)
              </label>
              <input
                type="number"
                className="input w-full text-sm"
                value={nightlyRate}
                onChange={e => setNightlyRate(e.target.value)}
                placeholder="ללא שינוי"
              />
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <button
            className="btn btn-primary flex-1 justify-center"
            onClick={() => {
              const parsedRate = Number(nightlyRate);
              onConfirm({
                nightlyRate: isExtend && nightlyRate !== '' && Number.isFinite(parsedRate) ? parsedRate : undefined,
              });
            }}
          >
            אשר שינוי
          </button>
          <button className="btn btn-secondary" onClick={onCancel}>ביטול</button>
        </div>
      </div>
    </div>
  );
}

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

/* Offset from the grid's inline-start (right edge in RTL) + width for a reservation block */
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
      border: '1px solid #DDD0BC',
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
          <div key={label} style={{ display:'flex', justifyContent:'space-between', borderBottom:'1px solid #EAE0D0', paddingBottom:3 }}>
            <span style={{ color:'#7A5C42' }}>{label}</span>
            <span style={{ fontWeight:600, color:'#2A1A0E', fontFamily:'monospace' }}>{value}</span>
          </div>
        ))}
        {res.specialRequests && (
          <div style={{ marginTop:2, fontSize:11, color:'#7A5C42', fontStyle:'italic' }}>
            ★ {res.specialRequests}
          </div>
        )}
        {res.isVip && (
          <div style={{ background:'#fef3c7', color:'#92400e', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, textAlign:'center' }}>
            👑 VIP Guest
          </div>
        )}
      </div>
      <div style={{ padding:'6px 14px 10px', fontSize:11, color:'#B8A080' }}>
        לחץ לפתיחת ההזמנה
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Reservation block                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */
function ResBlock({
  res,
  layout,
  onHover,
  onLeave,
  onClick,
  onPointerDown,
  onResizePointerDown,
  isDragging,
  isResizing,
}) {
  const cfg  = getStatusCfg(res);
  const g    = res.primaryGuest || {};
  const nights = nightsBetween(res.arrivalDate, res.departureDate);
  const ini  = initials(g);

  const stripedBg = cfg.striped
    ? `repeating-linear-gradient(45deg,${cfg.bg},${cfg.bg} 5px,${cfg.border} 5px,${cfg.border} 10px)`
    : cfg.bg;

  return (
    <div
      onMouseEnter={e => onHover(res, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      onMouseMove={e  => onHover(res, e.clientX, e.clientY)}
      onClick={() => onClick(res)}
      onPointerDown={onPointerDown}
      style={{
        position:   'absolute',
        // Logical properties: day 0 sits at the inline-start (right edge in RTL)
        insetInlineStart: layout.left + 2,
        top:        6,
        width:      layout.width - 2,
        height:     ROW_H - 12,
        background: stripedBg,
        borderStartStartRadius: layout.clippedLeft  ? 0 : 8,
        borderEndStartRadius:   layout.clippedLeft  ? 0 : 8,
        borderStartEndRadius:   layout.clippedRight ? 0 : 8,
        borderEndEndRadius:     layout.clippedRight ? 0 : 8,
        borderInlineStart: layout.clippedLeft ? 'none' : `3px solid ${cfg.border}`,
        cursor: isResizing ? 'ew-resize' : 'grab',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        paddingInline: layout.span === 1 ? '4px' : '7px 6px',
        gap: 5,
        boxShadow: isDragging
          ? '0 10px 28px rgba(0,0,0,0.32)'
          : '0 2px 6px rgba(0,0,0,0.18)',
        zIndex: isDragging ? 1 : 2,
        opacity: isDragging ? 0.3 : isResizing ? 0.72 : 1,
        transition: 'opacity 0.12s, box-shadow 0.12s',
      }}
      onMouseEnterCapture={e => { if (!isDragging) { e.currentTarget.style.filter='brightness(1.07)'; e.currentTarget.style.boxShadow='0 4px 14px rgba(0,0,0,0.28)'; }}}
      onMouseLeaveCapture={e => { e.currentTarget.style.filter=''; e.currentTarget.style.boxShadow='0 2px 6px rgba(0,0,0,0.18)'; }}
    >
      {/* Initials circle — only when wide enough */}
      {layout.span >= 2 && ini && (
        <div style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(255,255,255,0.22)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 800, color: cfg.text,
          border: '1px solid rgba(255,255,255,0.3)',
        }}>
          {ini}
        </div>
      )}
      {g.vipLevel > 0 && layout.span < 2 && (
        <Crown size={9} style={{ color:'#fde68a', flexShrink:0 }} />
      )}
      {layout.span >= 2 && (
        <span style={{
          color: cfg.text, fontSize: 11, fontWeight: 700,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex:1,
        }}>
          {g.vipLevel > 0 && '★ '}{g.firstName} {layout.span >= 3 ? g.lastName?.[0] + '.' : ''}
        </span>
      )}
      {layout.span >= 4 && (
        <span style={{
          color: 'rgba(255,255,255,0.65)', fontSize: 9.5, flexShrink: 0,
          background: 'rgba(0,0,0,0.12)', borderRadius: 4, padding: '1px 5px',
        }}>
          {nights}ל
        </span>
      )}

      {!layout.clippedRight && (
        <div
          onPointerDown={e => {
            e.stopPropagation();
            onResizePointerDown?.(e, res);
          }}
          title="גרור לשינוי יציאה"
          style={{
            position: 'absolute',
            insetInlineEnd: 0,
            top: 0,
            width: RESIZE_HANDLE_W,
            height: '100%',
            cursor: 'ew-resize',
            background: 'rgba(255,255,255,0.18)',
            borderInlineStart: '1px dashed rgba(255,255,255,0.5)',
          }}
        />
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
  const [blockRoom,   setBlockRoom]   = useState(null);
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

  const resolveDropRoomId = useCallback((clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const row = el?.closest('[data-room-id]');
    return row?.getAttribute('data-room-id') || null;
  }, []);

  const resolveResizeDeparture = useCallback((clientX, _clientY, res) => {
    if (!containerRef.current || !days.length) return null;
    const viewport = containerRef.current.getBoundingClientRect();
    // RTL: columns grow leftwards from the right edge; scrollLeft is <= 0 in RTL
    const contentX = viewport.right - clientX + Math.abs(containerRef.current.scrollLeft) - LABEL_W;
    const col = Math.floor(contentX / COL_W);
    const clampedCol = Math.max(0, Math.min(days.length - 1, col));
    const visualDeparture = addDays(days[clampedCol].date, 1);
    const minDeparture = addDays(res.arrivalDate, 1);
    return visualDeparture < minDeparture ? minDeparture : visualDeparture;
  }, [days]);

  const {
    drag,
    dropRoomId,
    resizeDraft,
    pendingMove,
    setPendingMove,
    pendingResize,
    setPendingResize,
    suppressClickRef,
    startDrag: beginDrag,
    startResize: beginResize,
  } = useReservationDragResize({
    dragActivationPx: 0,
    resolveDropRoomId,
    resolveResizeDepartureDate: resolveResizeDeparture,
  });

  const startDrag = useCallback((e, res, roomId) => {
    setTooltip(null);
    beginDrag(e, res, roomId);
  }, [beginDrag]);

  const startResize = useCallback((e, res) => {
    if (drag) return;
    setTooltip(null);
    beginResize(e, res);
  }, [beginResize, drag]);

  /* ── move confirm ─────────────────────────────────────────────────────── */
  async function handleMoveConfirm({ amount, note }) {
    const { resId, targetRoomId } = pendingMove;
    setPendingMove(null);
    try {
      const adjustment = amount !== 0 ? { priceAdjustment: amount, adjustmentNote: note } : {};
      await resApi.assignRoom(resId, targetRoomId, adjustment);
      success('חדר שוּנה בהצלחה');
      refetch();
    } catch (err) { toastErr(err.message); }
  }

  async function handleResizeConfirm({ nightlyRate }) {
    if (!pendingResize) return;
    const op = pendingResize;
    setPendingResize(null);
    try {
      if (op.newDepartureDate > op.oldDepartureDate) {
        await resApi.extend(op.resId, {
          newDepartureDate: op.newDepartureDate,
          ...(nightlyRate !== undefined ? { nightlyRate } : {}),
        });
        success('השהייה הוארכה בהצלחה');
      } else {
        await resApi.earlyDeparture(op.resId, { newDepartureDate: op.newDepartureDate });
        success('תאריך היציאה קוצר בהצלחה');
      }
      refetch();
    } catch (err) {
      toastErr(err.message);
    }
  }

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
    if (suppressClickRef.current || drag || resizeDraft) return;
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
      // RTL scroll offsets are negative (moving towards the left)
      containerRef.current.scrollLeft = -Math.max(0, todayIdx * COL_W - 80);
    }
  }, []);

  if (skip || l1 || l2) return <PageSpinner />;
  if (e1) return <ErrorState message={e1} onRetry={r1} />;

  const totalWidth = LABEL_W + days.length * COL_W;

  return (
    <div className="animate-fade-in" style={{ direction:'rtl', userSelect: drag || resizeDraft ? 'none' : 'auto' }}>
      <ToastContainer toasts={toasts} />
      <DragGhost drag={drag} />

      {/* ── tooltip ── */}
      {tooltip && <ResTooltip res={tooltip.res} x={tooltip.x} y={tooltip.y} />}

      {/* ── reservation drawer ── */}
      {selectedRes && (
        <ReservationDrawer
          reservationId={selectedRes._id}
          propertyId={propertyId}
          onChanged={refetch}
          onClose={() => { setSelectedRes(null); refetch(); }}
        />
      )}

      {/* ── room move dialog ── */}
      {pendingMove && (
        <RoomMoveDialog
          pending={pendingMove}
          allRooms={allRooms}
          onConfirm={handleMoveConfirm}
          onCancel={() => setPendingMove(null)}
        />
      )}

      {pendingResize && (
        <StayResizeDialog
          pending={pendingResize}
          onConfirm={handleResizeConfirm}
          onCancel={() => setPendingResize(null)}
        />
      )}

      {/* ── block room modal ── */}
      {blockRoom && (
        <BlockRoomModal
          room={blockRoom}
          propertyId={propertyId}
          onClose={() => setBlockRoom(null)}
          onDone={refetch}
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
          <div style={{ width:16, height:12, borderRadius:3, background:'rgba(196,147,64,0.10)', border:'1.5px solid #B8851A' }} />
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
          border: '1px solid #C8B89A',
          background: '#FDFAF5',
          position: 'relative',
        }}
      >
        <div style={{ minWidth: totalWidth, position: 'relative' }}>

          {/* ── STICKY DATE HEADER ─── */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 30,
            background: '#FDFAF5',
            borderBottom: '2px solid #DDD0BC',
            display: 'flex',
            height: HEADER_H,
          }}>
            {/* Corner cell */}
            <div style={{
              width: LABEL_W, flexShrink: 0,
              position: 'sticky', insetInlineStart: 0, zIndex: 40,
              background: '#2A1A0E',
              display: 'flex', alignItems: 'center', paddingInline: 14,
              borderBottom: '2px solid #1A0E06',
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
              <div style={{ display:'flex', height:22, borderBottom:'1px solid #E8DFCF' }}>
                {months.map((m, i) => (
                  <div key={i} style={{
                    width: m.span * COL_W,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center',
                    paddingInline: 8,
                    fontSize: 11, fontWeight: 700, color: '#6B4C30',
                    borderLeft: i > 0 ? '1px solid #E8DFCF' : 'none',
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
                      borderLeft: '1px solid #E8DFCF',
                      background: d.isToday
                        ? 'rgba(196,147,64,0.10)'
                        : d.isWeekend
                          ? 'rgba(180,120,60,0.04)'
                          : 'transparent',
                      position: 'relative',
                    }}
                  >
                    {d.isToday && (
                      <div style={{
                        position:'absolute', bottom:0, left:'50%', transform:'translateX(-50%)',
                        width:3, height:3, borderRadius:'50%', background:'#B8851A'
                      }} />
                    )}
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: d.isToday ? '#9A6B1A' : d.isWeekend ? '#7A5040' : '#94a3b8',
                    }}>{d.weekday}</span>
                    <span style={{
                      fontSize: 14,
                      fontWeight: d.isToday ? 800 : 600,
                      color: d.isToday ? '#9A6B1A' : d.isWeekend ? '#5A3820' : '#0f172a',
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
              {/* Floor separator — slim elegant divider */}
              <div style={{
                display: 'flex',
                position: 'sticky', insetInlineStart: 0,
                height: 32,
                alignItems: 'center',
                zIndex: 20,
                minWidth: totalWidth,
                background: '#F5EFE6',
                borderTop: '1px solid #DDD0BC',
                borderBottom: '1px solid #DDD0BC',
              }}>
                <div style={{
                  position: 'sticky', insetInlineStart: 0,
                  paddingInline: 16,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{ width: 3, height: 14, borderRadius: 2, background: '#C49340', flexShrink: 0 }} />
                  <span style={{ color:'#4A3020', fontSize:11, fontWeight:800, letterSpacing:'0.06em' }}>
                    קומה {floor}
                  </span>
                  <span style={{ color:'#9A7A5A', fontSize:10, fontWeight:500 }}>
                    — {rooms.length} חדרים
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
                            : ri % 2 === 0 ? '#FAF6F0' : '#FDFAF5';
                const isDrop = dropRoomId === String(room._id) && drag?.sourceRoomId !== String(room._id);

                return (
                  <div
                    key={room._id}
                    data-room-id={String(room._id)}
                    style={{
                      display: 'flex',
                      height: ROW_H,
                      borderBottom: '1px solid #EAE0D0',
                      background: isDrop ? 'rgba(196,147,64,0.07)' : 'inherit',
                      outline: isDrop ? '2px solid #C49340' : 'none',
                      outlineOffset: -2,
                    }}
                  >
                    {/* Room label — sticky left */}
                    <div style={{
                      position: 'sticky', insetInlineStart: 0, zIndex: 10,
                      width: LABEL_W, flexShrink: 0,
                      display: 'flex', alignItems: 'center', gap: 10,
                      paddingInline: '14px 10px',
                      background: isOOO ? '#FEF2F2' : isHold ? '#FAF5FF' : ri % 2 === 0 ? '#FAF6F0' : '#FDFAF5',
                      borderLeft: '4px solid ' + (isOOO ? '#dc2626' : isHold ? '#7c3aed' : (room.roomType?.code ? '#C49340' : '#DDD0BC')),
                      borderRight: '1px solid #DDD0BC',
                    }}>
                      {/* Room number — large */}
                      <div style={{
                        fontFamily: 'monospace', fontWeight: 900, fontSize: 18,
                        color: isOOO ? '#dc2626' : '#2A1A0E',
                        lineHeight: 1, flexShrink: 0, minWidth: 38,
                      }}>{room.number}</div>

                      {/* Middle: type badge + clean */}
                      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:3 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                          {room.roomType?.code && (
                            <span style={{ fontSize:9, fontWeight:800, color:'#9A6B1A', background:'#F7EFE0', padding:'1px 5px', borderRadius:4, letterSpacing:'0.05em', flexShrink:0 }}>
                              {room.roomType.code}
                            </span>
                          )}
                          {isOOO  && <span style={{ fontSize:9, fontWeight:800, color:'#dc2626', background:'#fee2e2', padding:'1px 5px', borderRadius:4 }}>OOO</span>}
                          {isHold && <span style={{ fontSize:9, fontWeight:800, color:'#7c3aed', background:'#ede9fe', padding:'1px 5px', borderRadius:4 }}>Hold</span>}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                          <div style={{ width:5, height:5, borderRadius:'50%', background: CLEAN_DOT[room.cleanStatus] || '#C8B89A', flexShrink:0 }} />
                          <span style={{ fontSize:9.5, color:'#9A7A5A', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {room.roomType?.name || '—'}
                          </span>
                        </div>
                      </div>

                      {/* Lock button */}
                      <button
                        onClick={e => { e.stopPropagation(); setBlockRoom(room); }}
                        title={isOOO || isHold ? 'שחרר חדר' : 'חסום חדר'}
                        style={{ background:'transparent', border:'none', cursor:'pointer', padding:'2px 3px', color: isOOO ? '#dc2626' : isHold ? '#7c3aed' : '#C8B89A', flexShrink:0 }}
                      >
                        {(isOOO || isHold) ? <Unlock size={11} /> : <Lock size={11} />}
                      </button>
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
                            insetInlineStart: i * COL_W, top: 0,
                            width: COL_W, height: ROW_H,
                            borderLeft: '1px solid #EAE0D0',
                            background: d.isToday
                              ? 'rgba(196,147,64,0.06)'
                              : d.isWeekend
                                ? 'rgba(180,120,60,0.03)'
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
                          insetInlineStart: todayIdx * COL_W + COL_W / 2 - 0.5,
                          top: 0, bottom: 0,
                          width: 1,
                          background: 'rgba(184,133,26,0.35)',
                          zIndex: 1, pointerEvents:'none',
                        }} />
                      )}

                      {/* Reservation blocks */}
                      {roomResArr.map(res => {
                        const isResizing = resizeDraft?.resId === String(res._id);
                        const visualRes = isResizing
                          ? { ...res, departureDate: resizeDraft.newDepartureDate }
                          : res;
                        const layout = resLayout(visualRes, days);
                        if (!layout) return null;
                        return (
                          <ResBlock
                            key={res._id}
                            res={visualRes}
                            layout={layout}
                            isDragging={drag?.resId === String(res._id)}
                            isResizing={isResizing}
                            onPointerDown={e => startDrag(e, res, room._id)}
                            onResizePointerDown={e => startResize(e, res)}
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
                display:'flex', position:'sticky', insetInlineStart:0,
                background:'rgba(196,147,64,0.10)',
                height:28, alignItems:'center', zIndex:20,
                minWidth: totalWidth,
                borderTop:'2px solid rgba(196,147,64,0.25)',
              }}>
                <div style={{ position:'sticky', insetInlineStart:0, paddingInline:14, display:'flex', alignItems:'center', gap:6 }}>
                  <AlertCircle size={11} style={{ color:'#9A6B1A' }} />
                  <span style={{ color:'#7A5C42', fontSize:11, fontWeight:700 }}>
                    ללא חדר ({unassignedRes.length})
                  </span>
                </div>
              </div>
              <div style={{ display:'flex', height: ROW_H, borderBottom:'1px solid #DDD0BC' }}>
                <div style={{
                  position:'sticky', insetInlineStart:0, zIndex:10, width: LABEL_W, flexShrink:0,
                  display:'flex', alignItems:'center', gap:8, paddingInline:12,
                  background:'rgba(247,239,224,0.5)', borderLeft:'3px solid #C49340', borderRight:'1px solid #E8DFCF',
                }}>
                  <span style={{ fontSize:12, color:'#7A5C42', fontWeight:700 }}>לא שויך</span>
                </div>
                <div style={{ position:'relative', flex:1, background:'rgba(247,239,224,0.3)' }}>
                  {days.map((d,i) => (
                    <div key={d.date} style={{
                      position:'absolute', insetInlineStart:i*COL_W, top:0, width:COL_W, height:ROW_H,
                      borderLeft:'1px solid #DDD0BC',
                      background: d.isToday ? 'rgba(196,147,64,0.06)' : 'transparent',
                    }} />
                  ))}
                  {unassignedRes.map(res => {
                    const isResizing = resizeDraft?.resId === String(res._id);
                    const visualRes = isResizing
                      ? { ...res, departureDate: resizeDraft.newDepartureDate }
                      : res;
                    const layout = resLayout(visualRes, days);
                    if (!layout) return null;
                    return (
                      <ResBlock
                        key={res._id}
                        res={visualRes}
                        layout={layout}
                        isDragging={drag?.resId === String(res._id)}
                        isResizing={isResizing}
                        onPointerDown={e => startDrag(e, res, 'unassigned')}
                        onResizePointerDown={e => startResize(e, res)}
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
        <span className="mr-auto">גרור הזמנה להעברת חדר · גרור את הקצה הימני לעדכון תאריך יציאה</span>
      </div>
    </div>
  );
}
