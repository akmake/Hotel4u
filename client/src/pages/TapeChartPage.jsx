import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, RefreshCw, Crown, AlertCircle,
  Sparkles, Wrench, LogIn, LogOut, X, Search, Filter,
  Calendar, BedDouble, Moon, Lock, Unlock, SlidersHorizontal,
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
import DragMoveDialog from '../components/stay/DragMoveDialog';
import RoomCalendarView from './RoomCalendarViews';
import './TapeChartPage.css';

/* ─────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
const LOOK_ROW_H = { current: 56, finished: 44, mews: 40, cloudbeds: 46, hostaway: 50, innroad: 40 };
const LOOK_LABEL_W = { current: 200, finished: 200, mews: 180, cloudbeds: 210, hostaway: 230, innroad: 200 };
const MIN_COL_W = 72;  // px per day column (design mode stretches columns to fill the width)
const ROW_H    = 56;   // px per room row
const LABEL_W  = 200;  // px for the left room-label panel
const HEADER_H = 64;   // px for the sticky date header (month + day)
const RESIZE_HANDLE_W = 10;

/* Status visual config — matches OPERA palette */
const STATUS_CFG = {
  confirmed: { bg:'#536578', surface:'#edf1f5', text:'#33465a', border:'#d2dbe4', label:'מאושר' },
  in_house: { bg:'#496f9d', surface:'#e7eff8', text:'#305477', border:'#c6d7e9', label:'שוהה במלון' },
  due_out: { bg:'#ae7d36', surface:'#faf1df', text:'#785523', border:'#e8d6b4', label:'יציאה היום' },
  checked_out: { bg:'#929aa4', surface:'#f0f1f3', text:'#68717d', border:'#dddfe3', label:'עזב' },
  cancelled: { bg:'#ad6464', surface:'#f9eded', text:'#8e4d4d', border:'#edcece', label:'בוטל' },
  no_show: { bg:'#ad6464', surface:'#f9eded', text:'#8e4d4d', border:'#edcece', label:'לא הגיע' },
  pending_payment: { bg:'#ae7d36', surface:'#faf1df', text:'#785523', border:'#e8d6b4', label:'ממתין לתשלום' },
  modified: { bg:'#7c70a6', surface:'#f0edf7', text:'#625581', border:'#d9d3e8', label:'שונה' },
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
const CLEAN_LABEL = { clean: 'נקי', inspected: 'נבדק', dirty: 'מלוכלך', cleaning: 'בניקיון' };
const OOO_BG = '#fcf4f4';
const HOLD_BG = '#f5f3fa';

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

function firstOfMonth(dateStr, delta) {
  let y = Number(dateStr.slice(0, 4));
  let m = Number(dateStr.slice(5, 7)) - 1 + delta;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

/* Offset from the grid's inline-start (right edge in RTL) + width for a reservation block */
function resLayout(res, days, colW = MIN_COL_W) {
  const start = nightsBetween(days[0].date, res.arrivalDate) + 0.5;
  const end = nightsBetween(days[0].date, res.departureDate) + 0.5;
  if (end <= 0 || start >= days.length || end <= start) return null;
  const visibleStart = Math.max(0, start);
  const visibleEnd = Math.min(days.length, end);
  return {
    left: visibleStart * colW,
    width: (visibleEnd - visibleStart) * colW,
    span: visibleEnd - visibleStart,
    clippedLeft: start < 0,
    clippedRight: end > days.length,
  };
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
      border: '1px solid #e8e8ea',
      borderRadius: 14,
      boxShadow: '0 16px 48px rgba(15,23,42,0.18)',
      minWidth: 248,
      overflow: 'hidden',
      direction: 'rtl',
    }}>
      {/* coloured header */}
      <div style={{ padding:'12px 14px 10px', background: cfg.bg }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, color:'#505a69', fontWeight:600, fontSize:12 }}>
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
          <div key={label} style={{ display:'flex', justifyContent:'space-between', borderBottom:'1px solid #ededf0', paddingBottom:3 }}>
            <span style={{ color:'#67676f' }}>{label}</span>
            <span style={{ fontWeight:600, color:'#252525', fontFamily:'monospace' }}>{value}</span>
          </div>
        ))}
        {res.specialRequests && (
          <div style={{ marginTop:2, fontSize:11, color:'#67676f', fontStyle:'italic' }}>
            ★ {res.specialRequests}
          </div>
        )}
        {res.isVip && (
          <div style={{ background:'#fef3c7', color:'#92400e', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, textAlign:'center' }}>
            👑 VIP Guest
          </div>
        )}
      </div>
      <div style={{ padding:'6px 14px 10px', fontSize:11, color:'#93939b' }}>
        לחץ לפתיחת ההזמנה
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Reservation block                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */
function ResBlock({ res, layout, onHover, onLeave, onClick, onPointerDown, onResizePointerDown, isDragging, isResizing, verticalOffset = 0, stayVariant = 'current', rowH = ROW_H, overlap = false }) {
  const guest = res.primaryGuest || {};
  const name = [guest.firstName, guest.lastName].filter(Boolean).join(' ') || 'הזמנה';
  const cfg = getStatusCfg(res);
  const statusKey = res.status === 'in_house' && res.departureDate === TODAY ? 'due_out' : res.status;
  const nights = nightsBetween(res.arrivalDate, res.departureDate);
  const shortBar = layout.width < 100;
  const actionKind = res.status === 'no_show' || (res.status === 'confirmed' && res.arrivalDate < TODAY) || (res.status === 'in_house' && res.departureDate < TODAY) ? 'urgent'
    : (res.status === 'confirmed' && res.arrivalDate === TODAY) || (res.status === 'in_house' && res.departureDate === TODAY) ? 'today'
    : res.status === 'in_house' ? 'inhouse' : 'quiet';
  const lastFirst = [guest.lastName, guest.firstName].filter(Boolean).join(', ') || name;
  const balanceDue = ['unpaid', 'partial', 'balance_due'].includes(res.paymentStatus) && !['cancelled', 'no_show'].includes(res.status);
  const hasNote = Boolean(res.specialRequests || res.internalNotes);
  return <div className={`turo-booking room-stay-card stay-v-${stayVariant} ${isDragging ? 'is-dragging' : ''}`} data-status={statusKey} data-action={actionKind} data-overlap={overlap ? '1' : undefined} role="button" tabIndex={0}
    aria-label={`${name}, ${formatShort(res.arrivalDate)} עד ${formatShort(res.departureDate)}, ${cfg.label}`}
    title={`${name} · כניסה: ${formatShort(res.arrivalDate)} · יציאה: ${formatShort(res.departureDate)} · ${cfg.label}`}
    onMouseEnter={e => onHover(res, e.clientX, e.clientY)} onMouseMove={e => onHover(res, e.clientX, e.clientY)} onMouseLeave={onLeave}
    onClick={() => onClick(res)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(res); } }} onPointerDown={onPointerDown}
    style={{position:'absolute', insetInlineStart:layout.left + 3, top:verticalOffset + Math.round(rowH * 0.16), width:Math.max(16, layout.width - 4), height:rowH - 2 * Math.round(rowH * 0.16), '--row-h':rowH + 'px', '--vo':verticalOffset + 'px', background:cfg.surface, borderColor:cfg.border, color:cfg.text, '--stay-accent':cfg.bg, zIndex:2, opacity:isDragging ? .3 : isResizing ? .65 : 1}}>
    {stayVariant === 'current' ? <>
    <span className="room-stay-name" data-lastfirst={lastFirst}>{name}</span>
    {(balanceDue || hasNote) && <span className="stay-icons">{balanceDue && <i className="si-balance" title="יתרה לתשלום" />}{hasNote && <i className="si-note" title="יש הערה" />}</span>}
    {layout.width >= 190 && <span className="room-stay-period">כניסה {res.arrivalDate.slice(8,10)+'/'+res.arrivalDate.slice(5,7)} · יציאה {res.departureDate.slice(8,10)+'/'+res.departureDate.slice(5,7)}</span>}
    </> : <>
      <span className="stay-text">
        <span className="room-stay-name">{stayVariant === 'marks' && shortBar ? (initials(guest) || name) : name}</span>
        {stayVariant === 'rich' && <span className="stay-sub">{nights} לילות{res.totalAmount ? ` · ₪${res.totalAmount.toLocaleString('he-IL')}` : ''}</span>}
      </span>
      {stayVariant === 'marks' && !shortBar && nights > 0 && <span className="stay-nights">{nights} ל׳</span>}
      {stayVariant === 'track' && <i className="stay-line" />}
    </>}
    {!layout.clippedRight && <span className="turo-booking-resize" title="גרור לשינוי תאריך יציאה" onPointerDown={e => { e.stopPropagation(); onResizePointerDown?.(e,res); }} />}
  </div>;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Main Component                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */
export default function TapeChartPage({ designMode = false }) {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const skip = !propertyId;
  const { toasts, success, error: toastErr } = useToast();

  /* ── view state ────────────────────────────────────────────────────────── */
  const [startDate,   setStartDate]   = useState(() => addDays(TODAY, -3));
  const [dayCount,    setDayCount]    = useState(14);
  const [roomSearch, setRoomSearch] = useState('');
  const [filterFloor, setFilterFloor] = useState('all');
  const [filterType,  setFilterType]  = useState('all');
  const [filterStatus,setFilterStatus]= useState('active');
  const [toolbarVariant, setToolbarVariant] = useState(() => {
    if (!designMode) return 'inline';
    try {
      const saved = localStorage.getItem('hotel4u:calendar-design:toolbar:v1');
      return ['inline', 'split', 'disclosure'].includes(saved) ? saved : 'inline';
    } catch { return 'inline'; }
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateVariant, setDateVariant] = useState(() => {
    try {
      const saved = designMode && localStorage.getItem('hotel4u:calendar-design:dates:v1');
      return ['classic', 'tiles', 'compact'].includes(saved) ? saved : 'classic';
    } catch { return 'classic'; }
  });
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:dates:v1', dateVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, dateVariant]);
  const [cornerVariant, setCornerVariant] = useState(() => {
    try {
      const saved = designMode && localStorage.getItem('hotel4u:calendar-design:corner:v1');
      return ['context', 'month', 'live'].includes(saved) ? saved : 'context';
    } catch { return 'context'; }
  });
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:corner:v1', cornerVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, cornerVariant]);
  const [viewVariant, setViewVariant] = useState(() => {
    try {
      const saved = designMode && localStorage.getItem('hotel4u:calendar-design:view:v1');
      return ['board', 'matrix', 'agenda', 'tiles', 'focus'].includes(saved) ? saved : 'board';
    } catch { return 'board'; }
  });
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:view:v1', viewVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, viewVariant]);
  const [labelVariant, setLabelVariant] = useState(() => {
    try {
      const saved = designMode && localStorage.getItem('hotel4u:calendar-design:rooms:v1');
      return ['current', 'inline', 'stacked', 'tile', 'table'].includes(saved) ? saved : 'current';
    } catch { return 'current'; }
  });
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:rooms:v1', labelVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, labelVariant]);
  const [gridVariant, setGridVariant] = useState(() => {
    try {
      const saved = designMode && localStorage.getItem('hotel4u:calendar-design:grid:v1');
      return ['current', 'ruled', 'bands', 'tiles'].includes(saved) ? saved : 'current';
    } catch { return 'current'; }
  });
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:grid:v1', gridVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, gridVariant]);
  const [stayVariant, setStayVariant] = useState(() => {
    try {
      const saved = designMode && localStorage.getItem('hotel4u:calendar-design:stay:v1');
      return ['current', 'marks', 'track', 'rich'].includes(saved) ? saved : 'current';
    } catch { return 'current'; }
  });
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:stay:v1', stayVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, stayVariant]);
  const [lookVariant, setLookVariant] = useState(() => {
    try {
      const saved = designMode && localStorage.getItem('hotel4u:calendar-design:look:v1');
      return ['current', 'finished', 'mews', 'cloudbeds', 'hostaway', 'innroad'].includes(saved) ? saved : 'current';
    } catch { return 'current'; }
  });
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:look:v1', lookVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, lookVariant]);
  const [monthVariant, setMonthVariant] = useState(() => {
    try {
      const saved = designMode && localStorage.getItem('hotel4u:calendar-design:month:v1');
      return ['pinned', 'occupancy', 'now'].includes(saved) ? saved : 'pinned';
    } catch { return 'pinned'; }
  });
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:month:v1', monthVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, monthVariant]);
  const [legendVariant, setLegendVariant] = useState(() => {
    try {
      const saved = designMode && localStorage.getItem('hotel4u:calendar-design:legend:v1');
      return ['dots', 'badges', 'lines'].includes(saved) ? saved : 'dots';
    } catch { return 'dots'; }
  });
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:legend:v1', legendVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, legendVariant]);
  const [designSettingsOpen, setDesignSettingsOpen] = useState(false);
  const designSettingsRef = useRef(null);
  const designSettingsButtonRef = useRef(null);
  useEffect(() => {
    if (!designSettingsOpen) return;
    designSettingsRef.current?.querySelector('button')?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setDesignSettingsOpen(false);
        designSettingsButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [designSettingsOpen]);
  useEffect(() => {
    if (designMode) {
      try { localStorage.setItem('hotel4u:calendar-design:toolbar:v1', toolbarVariant); } catch { /* Preview works without storage. */ }
    }
  }, [designMode, toolbarVariant]);
  const [tooltip,     setTooltip]     = useState(null); // { res, x, y }
  const [selectedRes, setSelectedRes] = useState(null); // for drawer
  const [blockRoom,   setBlockRoom]   = useState(null);
  const containerRef = useRef(null);
  const LABEL_W = designMode ? (LOOK_LABEL_W[lookVariant] ?? 200) : 200;
  const ROW_H = designMode ? (LOOK_ROW_H[lookVariant] ?? 56) : 56;
  const [boxW, setBoxW] = useState(0);
  const COL_W = designMode && boxW ? Math.max(MIN_COL_W, Math.floor((boxW - LABEL_W) / dayCount)) : MIN_COL_W;

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
  const weeks = useMemo(() => {
    const groups = [];
    days.forEach((day) => {
      if (!groups.length || new Date(`${day.date}T00:00:00Z`).getUTCDay() === 0) groups.push([]);
      groups[groups.length - 1].push(day);
    });
    return groups;
  }, [days]);

  const allRooms = useMemo(() => roomList || [], [roomList]);
  const allRes   = useMemo(() => resList  || [], [resList]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !designMode) return undefined;
    const update = () => setBoxW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designMode, skip, l1, l2]);

  const typeMap = useMemo(() => {
    const m = {};
    allRooms.forEach(r => { if (r.roomType?._id) m[r.roomType._id] = r.roomType; });
    return m;
  }, [allRooms]);
  const uniqueTypes = useMemo(() => Object.values(typeMap), [typeMap]);
  const floors      = useMemo(() => [...new Set(allRooms.map(r => r.floor))].sort((a,b)=>a-b), [allRooms]);

  const filteredRooms = useMemo(() => allRooms.filter(r => {
    if (roomSearch.trim() && !`${r.number} ${r.roomType?.name || ''}`.toLowerCase().includes(roomSearch.trim().toLowerCase())) return false;
    if (filterFloor !== 'all' && r.floor !== Number(filterFloor)) return false;
    if (filterType  !== 'all' && String(r.roomType?._id) !== filterType) return false;
    return true;
  }), [allRooms, filterFloor, filterType, roomSearch]);

  const byFloor = useMemo(() => {
    if (designMode && (lookVariant === 'mews' || lookVariant === 'innroad')) {
      const groups = new Map();
      filteredRooms.forEach(r => {
        const key = r.roomType?.name || '—';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      });
      return [...groups].map(([floor, rooms]) => ({ floor, rooms, isType: true }));
    }
    return floors
      .map(f => ({ floor: f, rooms: filteredRooms.filter(r => r.floor === f) }))
      .filter(g => g.rooms.length > 0);
  }, [floors, filteredRooms, designMode, lookVariant]);

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
  const overlapIds = useMemo(() => {
    const ids = new Set();
    const live = ['confirmed', 'in_house', 'modified', 'pending_payment'];
    Object.values(resByRoom).forEach(list => {
      const stays = list.filter(r => live.includes(r.status));
      for (let i = 0; i < stays.length; i++) {
        for (let j = i + 1; j < stays.length; j++) {
          if (stays[i].arrivalDate < stays[j].departureDate && stays[j].arrivalDate < stays[i].departureDate) {
            ids.add(String(stays[i]._id)); ids.add(String(stays[j]._id));
          }
        }
      }
    });
    return ids;
  }, [resByRoom]);

  /* Unassigned reservations in current view */
  const unassignedRes = useMemo(() => {
    return allRes.filter(res => {
      const hasRoom = res.assignedRoom && String(res.assignedRoom) !== 'null';
      if (hasRoom) return false;
      return res.departureDate >= days[0].date && res.arrivalDate <= days[days.length - 1].date;
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
    const col = Math.round(contentX / COL_W - 0.5);
    const clampedCol = Math.max(0, Math.min(days.length - 1, col));
    const visualDeparture = days[clampedCol].date;
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
  const dayStats = designMode && (lookVariant === 'cloudbeds' || lookVariant === 'innroad') ? (() => {
    const live = ['confirmed', 'in_house', 'modified', 'pending_payment'];
    const roomIds = new Set(filteredRooms.map(r => String(r._id)));
    const assigned = allRes.filter(r => live.includes(r.status) && roomIds.has(String(r.assignedRoom?._id || r.assignedRoom)));
    const waiting = unassignedRes.filter(r => live.includes(r.status));
    return days.map(d => {
      const covers = r => r.arrivalDate <= d.date && r.departureDate > d.date;
      const occupied = assigned.filter(covers).length;
      return { pct: filteredRooms.length ? Math.round(occupied / filteredRooms.length * 100) : 0, free: Math.max(0, filteredRooms.length - occupied), unassigned: waiting.filter(covers).length };
    });
  })() : null;
  const monthRowH = designMode && dateVariant === 'classic' ? ({ line: 0, bands: 22, nav: 30 }[monthVariant] ?? 22) : 22;
  const dateHeaderHeight = designMode && dateVariant === 'compact' ? 54 : designMode && dateVariant === 'classic' ? 42 + monthRowH + (lookVariant === 'cloudbeds' ? 18 : 0) : HEADER_H;

  return (
    <div className="turo-room-calendar classic-room-calendar" data-toolbar={designMode && lookVariant !== 'finished' ? toolbarVariant : undefined} data-legend={designMode && lookVariant !== 'finished' ? legendVariant : undefined} data-dates={designMode ? dateVariant : undefined} data-months={designMode ? monthVariant : undefined} data-look={designMode ? lookVariant : undefined} data-grid={designMode && lookVariant === 'current' ? gridVariant : undefined} data-rl={designMode && lookVariant === 'current' ? labelVariant : undefined} style={{ direction:'rtl', userSelect: drag || resizeDraft ? 'none' : 'auto' }}>
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
        <DragMoveDialog
          pending={pendingMove}
          rooms={allRooms}
          propertyId={propertyId}
          onClose={() => setPendingMove(null)}
          onDone={(msg) => { setPendingMove(null); success(msg); refetch(); }}
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
      {designMode && <>
        <button ref={designSettingsButtonRef} type="button" className="calendar-design-fab" aria-expanded={designSettingsOpen} aria-controls="calendar-design-settings" onClick={() => setDesignSettingsOpen(!designSettingsOpen)}>
          <SlidersHorizontal size={18} /> הגדרות עיצוב
        </button>
        {designSettingsOpen && <section ref={designSettingsRef} id="calendar-design-settings" className="calendar-design-settings" role="dialog" aria-modal="false" aria-labelledby="calendar-design-heading">
          <div className="calendar-design-settings-heading">
            <div><h2 id="calendar-design-heading">עיצוב לוח החדרים</h2><p>שינויים לתצוגה בלבד · לבחינה</p></div>
            <button type="button" aria-label="סגירת הגדרות העיצוב" onClick={() => { setDesignSettingsOpen(false); designSettingsButtonRef.current?.focus(); }}><X size={18} /></button>
          </div>
          <div className="calendar-toolbar-options calendar-legend-options" role="group" aria-label="עיצוב לפי מערכת קיימת">
            <span>מראה הלוח · כאן נמצא "גמור"</span>
            {[
              ['current', 'הנוכחי', 'להשוואה'],
              ['finished', 'גמור', 'אותו מבנה, גמור: כותרת "לוח חדרים", סרגל כלים בשורה אחת, סינון נפתח, מקרא שקט, שורות 44px, טיפוגרפיה מסודרת, סימון לפי סטטוס'],
              ['mews', 'בסגנון Mews', 'צבע לפי מה שצריך לעשות: כתום דחוף, כחול היום, אפור כהה שוהה, אפור בהיר שקט · מספר החדר בצבע הניקיון · קבוצות לפי סוג חדר · "משפחה, פרטי"'],
              ['cloudbeds', 'בסגנון Cloudbeds', 'צבע לפי סטטוס: ירוק שוהה, תכלת מאושר, טורקיז ממתין · תפוסה % מתחת לכל תאריך · בועה כחולה ללא שיבוץ · נקודת יתרה ונקודת הערה'],
              ['innroad', 'בסגנון innRoad', 'לוח קלאסי: רקע לפי סטטוס (טורקיז מאושר, סגול שוהה, צהוב בהמתנה, אפור עזב) · מסגרת ירוקה תקין, אדומה הזמנה כפולה · קבוצות לפי סוג עם תפוסה · שורת פנויים ותפוסה בתחתית'],
              ['hostaway', 'בסגנון Hostaway', 'גלולות: ירוק מאושר, ורוד לא שולם, צהוב שונה, אדום הזמנה כפולה · משבצת קוד לכל חדר'],
            ].map(([value, label, description]) => (
              <button key={value} type="button" aria-pressed={lookVariant === value} onClick={() => { setLookVariant(value); setViewVariant('board'); }}>
                <span className={`calendar-look-preview is-${value}`} aria-hidden="true"><b /><i /><i /></span>
                <span><strong>{label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <div className="calendar-toolbar-options calendar-legend-options" role="group" aria-label="מבנה התצוגה">
            <span>מבנה התצוגה · מבנים שונים לגמרי</span>
            {[
              ['board', 'לוח פסים', 'הלוח הנוכחי: חדרים בשורות, ימים בעמודות, הזמנות כפסים'],
              ['matrix', 'זמינות לפי סוג', 'בלי פסים: סוגי חדרים בשורות, בכל תא כמה חדרים פנויים · כהה יותר = מלא יותר · שורת סיכום'],
              ['agenda', 'יום אחר יום', 'כל יום שורה: מי מגיע, מי עוזב, מי נשאר ואחוז תפוסה'],
              ['tiles', 'מפת המלון ביום', 'בוחרים תאריך ורואים משבצת לכל חדר לפי קומה: פנוי, מגיע, שוהה, יוצא, חסום וניקיון'],
              ['focus', 'חדר בפוקוס', 'רשימת חדרים בצד, ולחדר הנבחר: לילות בטווח וטבלת ההזמנות שלו'],
            ].map(([value, label, description]) => (
              <button key={value} type="button" aria-pressed={viewVariant === value} onClick={() => setViewVariant(value)}>
                <span className={`calendar-view-preview is-${value}`} aria-hidden="true"><b /><i /><i /><i /></span>
                <span><strong>{label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <div className="calendar-design-reset">
            <p>עיצוב לפי מערכת קיימת מחליף את כל הלוח. כשהוא על "הנוכחי", אפשר לבחור בנפרד עמודת חדרים, רשת ובלוק.</p>
            <button type="button" onClick={() => { setLookVariant('current'); setLabelVariant('current'); setGridVariant('current'); setStayVariant('current'); }}>איפוס הכל להנוכחי</button>
          </div>
          <div className="calendar-toolbar-options calendar-legend-options" role="group" aria-label="עמודת החדרים">
            <span>עמודת החדרים וכותרות הקומות</span>
            {[
              ['current', 'הנוכחי', 'להשוואה'],
              ['inline', '1. שורה אחת', 'מספר · סוג · נקודת ניקיון · המנעול רק במעבר עכבר · הקומה כשורת טקסט'],
              ['stacked', '2. מספר גדול', 'מספר 22px, ומתחתיו סוג ומצב ניקיון במילים · הקומה ככותרת עם קו'],
              ['tile', '3. משבצת מצב', 'המספר בתוך משבצת שצבעה הוא מצב הניקיון · הקומה כתגית'],
              ['table', '4. טבלה', 'עמודות מיושרות: מספר · קוד · ניקיון · מנעול · הקומה ככותרת טבלה'],
            ].map(([value, label, description]) => (
              <button key={value} type="button" aria-pressed={labelVariant === value} onClick={() => setLabelVariant(value)}>
                <span className={`calendar-rl-preview is-${value}`} aria-hidden="true"><b /><i /><i /></span>
                <span><strong>{label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <div className="calendar-toolbar-options calendar-legend-options" role="group" aria-label="רשת הלוח">
            <span>רשת הלוח · הימים והחדרים עצמם</span>
            {[
              ['current', 'הנוכחי', 'להשוואה'],
              ['ruled', 'דף מסורגל', 'קווי יום חלשים · סוף שבוע גוון כהה יותר · קו "היום" דק · קומה ככותרת משנה'],
              ['bands', 'פסי סוף שבוע', 'אפס קווים · רק פס עמודה לסופי שבוע · החדר מוארך במעבר עכבר'],
              ['tiles', 'משבצות לילה', 'כל לילה פנוי הוא משבצת נפרדת · הפנויים נספרים בעין'],
            ].map(([value, label, description], index) => (
              <button key={value} type="button" aria-pressed={gridVariant === value} onClick={() => setGridVariant(value)}>
                <span className={`calendar-grid-preview is-${value}`} aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
                <span><strong>{index + 1}. {label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <div className="calendar-toolbar-options calendar-legend-options" role="group" aria-label="בלוק ההזמנה">
            <span>בלוק ההזמנה · האלמנט המרכזי של הלוח</span>
            {[
              ['current', 'הנוכחי', 'להשוואה'],
              ['marks', 'סימון לפי סוג', 'פס 24px · לכל סטטוס סימון משלו: מלא, מקווקו, קו אלכסוני · לילות בקצה · בפס קצר רק ראשי תיבות'],
              ['track', 'קו עם שם מעליו', 'בלי קופסה · השם כטקסט פשוט על השורה והשהייה היא קו דק מתחתיו'],
              ['rich', 'שורה עם פרטים', 'שתי שורות בפס 42px · שם, ומתחתיו לילות וסכום'],
            ].map(([value, label, description], index) => (
              <button key={value} type="button" aria-pressed={stayVariant === value} onClick={() => setStayVariant(value)}>
                <span className={`calendar-stay-preview is-${value}`} aria-hidden="true"><i /><i /><i /></span>
                <span><strong>{index + 1}. {label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <div className="calendar-toolbar-options" role="group" aria-label="חלופות עיצוב לסרגל הכלים">
            <span>שלב 1 · סרגל הכלים והכפתורים</span>
            {[
              ['inline', 'קווי ומדויק', 'מסגרות ישרות · כל הכלים גלויים'],
              ['split', 'רך ומופרד', 'כפתורים רכים · תאריכים וסינונים בשתי שורות'],
              ['disclosure', 'עגול ומצומצם', 'כפתורי גלולה · סינונים נפתחים'],
            ].map(([value, label, description], index) => (
              <button key={value} type="button" aria-pressed={toolbarVariant === value} onClick={() => setToolbarVariant(value)}>
                <span className={`calendar-option-preview is-${value}`} aria-hidden="true"><i /><i /><i /></span>
                <span><strong>{index + 1}. {label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <div className="calendar-toolbar-options calendar-legend-options" role="group" aria-label="חלופות עיצוב למקרא">
            <span>שלב 2 · המקרא</span>
            {[
              ['dots', 'נקודות צבע', 'סימונים קטנים וטקסט על רקע לבן'],
              ['badges', 'תגיות צבעוניות', 'כל מצב בתוך תגית בגוון של ההזמנה'],
              ['lines', 'סימוני קו', 'קו צבעוני ליד כל מצב · הפרדה בין הפריטים'],
            ].map(([value, label, description], index) => (
              <button key={value} type="button" aria-pressed={legendVariant === value} onClick={() => setLegendVariant(value)}>
                <span className={`calendar-legend-preview is-${value}`} aria-hidden="true"><i /><i /><i /></span>
                <span><strong>{index + 1}. {label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <div className="calendar-toolbar-options calendar-legend-options" role="group" aria-label="חלופות עיצוב לכותרת התאריכים">
            <span>שלב 3 · כותרת התאריכים</span>
            {[
              ['classic', 'חודש משותף', 'חודש מעל רצף ימים · המבנה המקורי להשוואה'],
              ['tiles', 'תאריך מלא בעמודה', 'ללא שורת חודש · מספר גדול ופרטי היום לצדו'],
              ['compact', 'מקטעים שבועיים', 'טווח לכל שבוע · תאריכים על סרגל משותף'],
            ].map(([value, label, description], index) => (
              <button key={value} type="button" aria-pressed={dateVariant === value} onClick={() => setDateVariant(value)}>
                <span className={`calendar-dates-preview is-${value}`} aria-hidden="true"><i>26</i><i>27</i><i>28</i></span>
                <span><strong>{index + 1}. {label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <div className="calendar-toolbar-options calendar-legend-options" role="group" aria-label="חלופות עיצוב לפינת הלוח">
            <span>שלב 4 · פינת הלוח</span>
            {[
              ['context', 'הקשר התצוגה', 'כמה חדרים מוצגים מתוך הכול · סינונים פעילים · ניקוי בלחיצה'],
              ['month', 'עוגן חודש', 'שם החודש כעוגן · כפתור קפיצה להיום'],
              ['live', 'תפוסה חיה', 'תפוסה, כניסות ויציאות להיום עם פס התקדמות'],
            ].map(([value, label, description], index) => (
              <button key={value} type="button" aria-pressed={cornerVariant === value} onClick={() => setCornerVariant(value)}>
                <span className={`calendar-corner-preview is-${value}`} aria-hidden="true"><b /><i /></span>
                <span><strong>{index + 1}. {label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <div className="calendar-toolbar-options calendar-legend-options" role="group" aria-label="חלופות עיצוב לכותרת החודש">
            <span>שלב 5 · סימון החודשים (במבנה "חודש משותף")</span>
            {[
              ['line', 'קו חודש דרך הלוח', 'בלי שורת חודש · קו עבה בכל הגובה במעבר חודש, ושם החודש על היום הראשון'],
              ['bands', 'פסי חודש', 'חודשים לסירוגין בגוון שונה לאורך כל הלוח · שורת שמות מעל'],
              ['nav', 'בורר חודש', 'במקום שורת שמות: חצים לקפיצה לחודש הקודם והבא'],
            ].map(([value, label, description], index) => (
              <button key={value} type="button" aria-pressed={monthVariant === value} onClick={() => setMonthVariant(value)}>
                <span className={`calendar-month-preview is-${value}`} aria-hidden="true"><b /><i /></span>
                <span><strong>{index + 1}. {label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
          <p className="calendar-design-settings-note">הבחירות נשמרות בעמוד העיצוב. סגור את הפאנל להשוואה על הלוח המלא.</p>
        </section>}
      </>}
      <div className="turo-calendar-toolbar">
        <div className="turo-calendar-controls">
          {designMode && lookVariant === 'finished' && (
            <div className="cal-heading">
              <h2>לוח חדרים</h2>
              <span>{formatShort(days[0].date)} – {formatShort(days[days.length - 1].date)}</span>
            </div>
          )}
          <label className="turo-room-search"><Search size={15}/><input aria-label="חיפוש חדר" placeholder="חיפוש מספר חדר או סוג…" value={roomSearch} onChange={e => setRoomSearch(e.target.value)} /></label>
          {designMode && (toolbarVariant === 'disclosure' || lookVariant === 'finished') && (
            <button type="button" className="btn btn-secondary calendar-filter-toggle" aria-expanded={filtersOpen} aria-controls="classic-calendar-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
              <Filter size={14} /> סינונים
              {(filterFloor !== 'all' || filterType !== 'all' || filterStatus !== 'active') && <span className="calendar-filter-count">{Number(filterFloor !== 'all') + Number(filterType !== 'all') + Number(filterStatus !== 'active')}</span>}
            </button>
          )}
          <div id="classic-calendar-filters" className="calendar-filter-group" hidden={designMode && (toolbarVariant === 'disclosure' || lookVariant === 'finished') && !filtersOpen}>
          {/* Status filter */}
          <select
            aria-label="סינון סטטוס הזמנה"
            className="select text-sm"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Floor filter */}
          <select aria-label="סינון לפי קומה" className="select text-sm" value={filterFloor} onChange={e => setFilterFloor(e.target.value)}>
            <option value="all">כל הקומות</option>
            {floors.map(f => <option key={f} value={f}>קומה {f}</option>)}
          </select>

          {/* Room type filter */}
          <select aria-label="סינון לפי סוג חדר" className="select text-sm" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">כל הסוגים</option>
            {uniqueTypes.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>

          {/* Day range selector */}
          </div>
          <div className="calendar-range-group flex rounded-lg border border-surface-border overflow-hidden text-xs">
            {[14, 21, 30].map(n => (
              <button
                key={n}
                onClick={() => setDayCount(n)}
                className={`px-3 py-1.5 font-medium transition-colors ${dayCount === n ? 'bg-brand text-white' : 'bg-white text-ink-secondary hover:bg-surface-hover'}`}
              >
                {n} ימים
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="calendar-date-group flex items-center gap-1">
            {designMode && toolbarVariant === 'split' && <span className="calendar-visible-period">{formatShort(days[0].date)} – {formatShort(days[days.length - 1].date)}</span>}
            <button aria-label="תקופה קודמת" onClick={goBack}    className="btn btn-ghost btn-icon btn-sm"><ChevronRight size={16} /></button>
            <button onClick={goToday}   className="btn btn-secondary btn-sm">היום</button>
            <button aria-label="תקופה הבאה" onClick={goForward} className="btn btn-ghost btn-icon btn-sm"><ChevronLeft size={16} /></button>
          </div>

          <button onClick={refetch} className="btn btn-ghost btn-icon" title="רענן">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* ─── LEGEND ─────────────────────────────────────────────────────── */}
      <div className="turo-calendar-legend" aria-label="מקרא מצבי הזמנה">
        {[
          { key:'confirmed',       label:'מאושר' },
          { key:'in_house',        label:'שוהה במלון' },
          { key:'due_out',         label:'יציאה היום' },
          { key:'pending_payment', label:'ממתין לתשלום' },
          { key:'checked_out',     label:'עזב' },
          { key:'cancelled',       label:'בוטל' },
        ].map(({ key, label }) => {
          const cfg = STATUS_CFG[key];
          return (
            <div key={key} data-status={key} className="calendar-legend-item flex items-center gap-1.5 text-xs text-ink-muted" style={{ '--legend-color': cfg.bg, '--legend-surface': cfg.surface, '--legend-text': cfg.text, '--legend-border': cfg.border }}>
              <div className="calendar-legend-mark" style={{ width:7, height:7, borderRadius:'50%', background:cfg.bg }} />
              {label}
            </div>
          );
        })}
        <div className="calendar-legend-today flex items-center gap-1.5 text-xs text-ink-muted mr-2">
          <div style={{ width:16, height:12, borderRadius:3, background:'rgba(89,60,251,0.06)', border:'1.5px solid #252525' }} />
          היום
        </div>
        {unassignedRes.length > 0 && (
          <div className="calendar-legend-unassigned flex items-center gap-1.5 text-xs text-amber-700 font-semibold mr-auto">
            <AlertCircle size={12} />
            {unassignedRes.length} הזמנות ללא חדר
          </div>
        )}
      </div>

      {designMode && viewVariant !== 'board' ? (
        <RoomCalendarView
          variant={viewVariant}
          rooms={filteredRooms}
          reservations={allRes}
          resByRoom={resByRoom}
          days={days}
          onOpen={handleResClick}
          onNew={handleCellClick}
        />
      ) : <>
      {/* ─── GRID ───────────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="turo-calendar-grid"
        style={{
          overflowX: 'auto',
          overflowY: 'auto',
          minHeight: 0,
          borderRadius: 0,
          border: '1px solid #d8d9dc',
          background: '#ffffff',
          position: 'relative',
        }}
      >
        <div style={{ width: totalWidth, minWidth: '100%', position: 'relative' }}>

          {/* ── STICKY DATE HEADER ─── */}
          <div className="calendar-date-header" style={{
            position: 'sticky', top: 0, zIndex: 30,
            background: '#ffffff',
            borderBottom: '1px solid #e8e8ea',
            display: 'flex',
            height: dateHeaderHeight,
          }}>
            {/* Corner cell */}
            <div style={{
              width: LABEL_W, flexShrink: 0,
              position: 'sticky', insetInlineStart: 0, zIndex: 40,
              background: '#ffffff',
              display: 'flex', alignItems: 'center', paddingInline: 14,
              borderBottom: '1px solid #e8e8ea',
            }}>
              {designMode && cornerVariant === 'month' ? (
                <div className="calendar-corner is-month">
                  <strong>{HE_MONTHS[Number(days[0].date.slice(5, 7)) - 1]} <small>{days[0].date.slice(0, 4)}</small></strong>
                  <button type="button" onClick={goToday}>היום</button>
                </div>
              ) : designMode && cornerVariant === 'live' ? (() => {
                const roomIds = new Set(filteredRooms.map(r => String(r._id)));
                const live = ['confirmed', 'in_house', 'modified', 'pending_payment'];
                const todays = allRes.filter(r => live.includes(r.status) && roomIds.has(String(r.assignedRoom?._id || r.assignedRoom)));
                const occupied = todays.filter(r => r.arrivalDate <= TODAY && r.departureDate > TODAY).length;
                const pct = filteredRooms.length ? Math.round(occupied / filteredRooms.length * 100) : 0;
                return (
                  <div className="calendar-corner is-live">
                    <div><strong>{pct}%</strong><span>תפוסה היום</span></div>
                    <i style={{ '--fill': `${pct}%` }} />
                    <p><b>{todays.filter(r => r.arrivalDate === TODAY).length}</b> כניסות · <b>{todays.filter(r => r.departureDate === TODAY).length}</b> יציאות</p>
                  </div>
                );
              })() : (
                <div className={`calendar-corner${designMode ? ' is-context' : ''}`}>
                  {designMode ? (() => {
                    const chips = [
                      roomSearch.trim() && `“${roomSearch.trim()}”`,
                      filterFloor !== 'all' && `קומה ${filterFloor}`,
                      filterType !== 'all' && uniqueTypes.find(t => t._id === filterType)?.name,
                      filterStatus !== 'active' && 'כולל עזבו/בוטל',
                    ].filter(Boolean);
                    const clearFilters = () => { setRoomSearch(''); setFilterFloor('all'); setFilterType('all'); setFilterStatus('active'); };
                    return <>
                      <div className="calendar-corner-count"><strong>{filteredRooms.length}</strong><span>{chips.length ? `מתוך ${allRooms.length} חדרים` : 'חדרים'}</span></div>
                      {chips.length > 0 ? (
                        <div className="calendar-corner-filters">
                          <span>{chips.join(' · ')}</span>
                          <button type="button" onClick={clearFilters}>נקה</button>
                        </div>
                      ) : <small>{formatShort(days[0].date)} – {formatShort(days[days.length - 1].date)}</small>}
                    </>;
                  })() : <>
                    <div style={{ color:'#505a69', fontWeight:600, fontSize:12 }}>{filteredRooms.length} חדרים</div>
                    <div style={{ color:'#85858c', fontSize:11 }}>{formatShort(days[0].date)} — {formatShort(days[days.length - 1].date)}</div>
                  </>}
                </div>
              )}
            </div>

            {/* Date columns header */}
            <div style={{ position:'relative', flex:1 }}>
              {designMode && dateVariant === 'tiles' ? (
                <div className="calendar-full-date-row">
                  {days.map((d) => (
                    <div key={d.date} className={`calendar-full-date${d.isToday ? ' is-today' : ''}${d.isWeekend ? ' is-weekend' : ''}`} style={{ width: COL_W }} aria-current={d.isToday ? 'date' : undefined}>
                      <strong>{d.day}</strong>
                      <div><span>{d.isToday ? 'היום' : `יום ${d.weekday}`}</span><small>{HE_MONTHS[Number(d.date.slice(5, 7)) - 1]}</small></div>
                    </div>
                  ))}
                </div>
              ) : designMode && dateVariant === 'compact' ? (
                <div className="calendar-weeks">
                  {weeks.map((week) => (
                    <div className="calendar-week" key={week[0].date} style={{ width: week.length * COL_W }}>
                      <div className="calendar-week-heading">{week.length === 1 ? formatShort(week[0].date) : `${formatShort(week[0].date)} – ${formatShort(week[week.length - 1].date)}`}</div>
                      <div className="calendar-week-days">
                        {week.map((d) => <div key={d.date} className={`calendar-week-tick${d.isToday ? ' is-today' : ''}${d.isWeekend ? ' is-weekend' : ''}`} style={{ width: COL_W }} aria-current={d.isToday ? 'date' : undefined}><span>{d.weekday}</span><strong>{d.day}</strong></div>)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <>
              {/* Month labels row */}
              <div className="calendar-month-row" style={{ display: monthRowH ? 'flex' : 'none', height: monthRowH, borderBottom:'1px solid #ececef' }}>
                {designMode ? (monthVariant === 'nav' ? (
                  <div className="calendar-month-nav">
                    <button type="button" aria-label="חודש קודם" onClick={() => setStartDate(firstOfMonth(days[0].date, -1))}><ChevronRight size={14} /></button>
                    <strong>{months.map(m => HE_MONTHS[m.month]).join(' – ')} {months[months.length - 1].year}</strong>
                    <button type="button" aria-label="חודש הבא" onClick={() => setStartDate(firstOfMonth(days[days.length - 1].date, 1))}><ChevronLeft size={14} /></button>
                  </div>
                ) : monthVariant === 'bands' ? months.map((m, i) => (
                  <div key={i} className={`calendar-month-cell${i % 2 ? ' is-alt' : ''}`} style={{ width: m.span * COL_W }}>
                    <span>{HE_MONTHS[m.month]} {m.year}</span>
                  </div>
                )) : null) : months.map((m, i) => (
                  <div key={i} style={{
                    width: m.span * COL_W,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center',
                    paddingInline: 8,
                    fontSize: 11, fontWeight: 700, color: '#6b6b70',
                    borderLeft: i > 0 ? '1px solid #ececef' : 'none',
                  }}>
                    {HE_MONTHS[m.month]} {m.year}
                  </div>
                ))}
              </div>

              {/* Day labels row */}
              <div className="calendar-day-row" style={{ display:'flex', height: dateHeaderHeight - monthRowH }}>
                {days.map((d, i) => (
                  <div
                    key={d.date}
                    className={`calendar-day-cell${d.isToday ? ' is-today' : ''}${d.isWeekend ? ' is-weekend' : ''}`}
                    aria-current={d.isToday ? 'date' : undefined}
                    style={{
                      width: COL_W, flexShrink: 0,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 1,
                      borderLeft: '1px solid #ececef',
                      background: d.isToday
                        ? 'rgba(89,60,251,0.06)'
                        : d.isWeekend
                          ? '#fafafb'
                          : 'transparent',
                      position: 'relative',
                    }}
                  >
                    {d.isToday && (
                      <div className="calendar-today-dot" style={{
                        position:'absolute', bottom:0, left:'50%', transform:'translateX(-50%)',
                        width:3, height:3, borderRadius:'50%', background:'#252525'
                      }} />
                    )}
                    <span className="calendar-weekday" style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: d.isToday ? '#6550b8' : d.isWeekend ? '#77777d' : '#94a3b8',
                    }}>{d.weekday}{designMode && dateVariant === 'classic' && monthVariant === 'line' && (i === 0 || d.day === 1) ? ` · ${HE_MONTHS[d.month]}` : ''}</span>
                    <span className="calendar-day-number" style={{
                      fontSize: 13, fontWeight: 500,
                      color: d.isToday ? '#fff' : '#252525',
                      background: d.isToday ? '#252525' : 'transparent',
                      borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center',
                    }}>{d.day}</span>
                    {dayStats && lookVariant === 'cloudbeds' && <span className="cb-occ">{dayStats[i].pct}%{dayStats[i].unassigned > 0 && <b className="cb-bubble" title="הזמנות ללא חדר">{dayStats[i].unassigned}</b>}</span>}
                  </div>
                ))}
              </div>
              </>}
            </div>
          </div>

          {designMode && dateVariant === 'classic' && (monthVariant === 'line' || monthVariant === 'bands') && (() => {
            let off = 0;
            return months.map((m, i) => {
              const start = off; off += m.span;
              if (monthVariant === 'line') return i > 0 ? <div key={i} className="calendar-month-line" style={{ insetInlineStart: LABEL_W + start * COL_W - 1, top: dateHeaderHeight }} /> : null;
              return i % 2 ? <div key={i} className="calendar-month-band" style={{ insetInlineStart: LABEL_W + start * COL_W, width: m.span * COL_W, top: dateHeaderHeight }} /> : null;
            });
          })()}

          {/* ── ROOM ROWS ─── */}
          {byFloor.map(({ floor, rooms, isType }) => (
            <div key={floor}>
              {/* Floor separator — slim elegant divider */}
              <div className="calendar-floor-bar" style={{
                display: 'flex',
                position: 'sticky', insetInlineStart: 0,
                height: 32,
                alignItems: 'center',
                zIndex: 20,
                minWidth: totalWidth,
                background: '#f7f7f8',
                borderTop: '1px solid #e8e8ea',
                borderBottom: '1px solid #e8e8ea',
              }}>
                <div style={{
                  position: 'sticky', insetInlineStart: 0,
                  paddingInline: 16,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{ width: 3, height: 14, borderRadius: 2, background: '#c3c8d0', flexShrink: 0 }} />
                  <span style={{ color:'#505057', fontSize:11, fontWeight:800, letterSpacing:'0.06em' }}>
                    {isType ? floor : `קומה ${floor}`}
                  </span>
                  <span style={{ color:'#8a8a91', fontSize:10, fontWeight:500 }}>
                    {designMode && labelVariant !== 'current' ? '·' : '—'} {rooms.length} חדרים
                  </span>
                  {designMode && lookVariant === 'innroad' && (() => {
                    const live = ['confirmed', 'in_house', 'modified', 'pending_payment'];
                    const busy = rooms.filter(r => (resByRoom[String(r._id)] || []).some(x => live.includes(x.status) && x.arrivalDate <= TODAY && x.departureDate > TODAY)).length;
                    return <span className="ir-class-occ">{rooms.length ? Math.round(busy / rooms.length * 100) : 0}% תפוסה היום</span>;
                  })()}
                </div>
              </div>

              {/* Room rows */}
              {rooms.map((room, ri) => {
                const isOOO  = ['out_of_order','out_of_service'].includes(room.opsStatus);
                const isHold = room.opsStatus === 'maintenance_hold';
                const roomResArr = resByRoom[String(room._id)] || [];
                const rowBg = isOOO  ? OOO_BG
                            : isHold ? HOLD_BG
                            : ri % 2 === 0 ? '#ffffff' : '#ffffff';
                const isDrop = dropRoomId === String(room._id) && drag?.sourceRoomId !== String(room._id);

                return (
                  <div
                    key={room._id}
                    data-room-id={String(room._id)}
                    className="calendar-room-row"
                    style={{
                      display: 'flex',
                      height: ROW_H,
                      borderBottom: '1px solid #ededf0',
                      background: isDrop ? 'rgba(89,60,251,0.06)' : 'inherit',
                      outline: isDrop ? '2px solid #593cfb' : 'none',
                      outlineOffset: -2,
                    }}
                  >
                    {/* Room label — sticky left */}
                    {!designMode || (labelVariant === 'current' && lookVariant === 'current') ? (
                    <div className="calendar-room-label" style={{
                      position: 'sticky', insetInlineStart: 0, zIndex: 10,
                      width: LABEL_W, flexShrink: 0,
                      display: 'flex', alignItems: 'center', gap: 10,
                      paddingInline: '14px 10px',
                      background: isOOO ? '#FEF2F2' : isHold ? '#FAF5FF' : ri % 2 === 0 ? '#ffffff' : '#ffffff',
                      borderLeft: '1px solid #e8e8ea',
                      borderRight: '1px solid #e8e8ea',
                    }}>
                      {/* Room number — large */}
                      <div style={{
                        fontFamily: 'inherit', fontWeight: 600, fontSize: 14,
                        color: isOOO ? '#dc2626' : '#252525',
                        lineHeight: 1, flexShrink: 0, minWidth: 38,
                      }}>{room.number}</div>

                      {/* Middle: type badge + clean */}
                      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:3 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                          {room.roomType?.code && (
                            <span style={{ fontSize:9, fontWeight:800, color:'#6550b8', background:'#f3f3f5', padding:'1px 5px', borderRadius:4, letterSpacing:'0.05em', flexShrink:0 }}>
                              {room.roomType.code}
                            </span>
                          )}
                          {isOOO  && <span style={{ fontSize:9, fontWeight:800, color:'#dc2626', background:'#fee2e2', padding:'1px 5px', borderRadius:4 }}>OOO</span>}
                          {isHold && <span style={{ fontSize:9, fontWeight:800, color:'#7c3aed', background:'#ede9fe', padding:'1px 5px', borderRadius:4 }}>Hold</span>}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                          <div style={{ width:5, height:5, borderRadius:'50%', background: CLEAN_DOT[room.cleanStatus] || '#d8d9dc', flexShrink:0 }} />
                          <span style={{ fontSize:9.5, color:'#8a8a91', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {room.roomType?.name || '—'}
                          </span>
                        </div>
                      </div>

                      {/* Lock button */}
                      <button
                        onClick={e => { e.stopPropagation(); setBlockRoom(room); }}
                        title={isOOO || isHold ? 'שחרר חדר' : 'חסום חדר'}
                        style={{ background:'transparent', border:'none', cursor:'pointer', padding:'2px 3px', color: isOOO ? '#dc2626' : isHold ? '#7c3aed' : '#d8d9dc', flexShrink:0 }}
                      >
                        {(isOOO || isHold) ? <Unlock size={11} /> : <Lock size={11} />}
                      </button>
                    </div>
                    ) : (
                    <div className="calendar-room-label rl-v" data-clean={room.cleanStatus} data-blocked={isOOO || isHold ? '1' : undefined} style={{
                      position: 'sticky', insetInlineStart: 0, zIndex: 10,
                      width: LABEL_W, flexShrink: 0,
                      background: isOOO ? '#FEF2F2' : isHold ? '#FAF5FF' : '#ffffff',
                      borderLeft: '1px solid #e8e8ea', borderRight: '1px solid #e8e8ea',
                    }}>
                      <span className="rl-num" style={isOOO ? { color: '#dc2626' } : undefined}>{room.number}</span>
                      <span className="rl-name">{room.roomType?.name || '—'}</span>
                      {room.roomType?.code && <span className="rl-code">{room.roomType.code}</span>}
                      <span className="rl-state"><i className="rl-dot" style={{ background: CLEAN_DOT[room.cleanStatus] || '#d8d9dc' }} /><span className="rl-state-txt">{CLEAN_LABEL[room.cleanStatus] || '—'}</span></span>
                      {(isOOO || isHold) && <span className="rl-tags">{isOOO ? 'OOO' : 'Hold'}</span>}
                      <button type="button" className="rl-lock" title={isOOO || isHold ? 'שחרר חדר' : 'חסום חדר'} onClick={e => { e.stopPropagation(); setBlockRoom(room); }}>
                        {(isOOO || isHold) ? <Unlock size={13} /> : <Lock size={13} />}
                      </button>
                    </div>
                    )}

                    {/* Grid area */}
                    <div style={{ position:'relative', flex:1, background: rowBg }}>
                      {/* Day grid lines + clickable cells */}
                      {days.map((d, i) => (
                        <div
                          key={d.date}
                          onClick={() => !isOOO && handleCellClick(room, d.date)}
                          className={`calendar-day-bg${d.isWeekend ? ' is-weekend' : ''}${d.isToday ? ' is-today' : ''}`}
                          style={{
                            position: 'absolute',
                            insetInlineStart: i * COL_W, top: 0,
                            width: COL_W, height: ROW_H,
                            borderLeft: '1px solid #ededf0',
                            background: d.isToday
                              ? 'rgba(89,60,251,0.025)'
                              : d.isWeekend
                                ? '#fafafb'
                                : 'transparent',
                            cursor: isOOO ? 'default' : 'cell',
                            zIndex: 1,
                          }}
                        />
                      ))}

                      {/* Today vertical highlight line */}
                      {todayIdx >= 0 && (
                        <div className="calendar-today-line" style={{
                          position: 'absolute',
                          insetInlineStart: todayIdx * COL_W + COL_W / 2 - 0.5,
                          top: 0, bottom: 0,
                          width: 1,
                          background: 'rgba(89,60,251,0.18)',
                          zIndex: 1, pointerEvents:'none',
                        }} />
                      )}

                      {/* Reservation blocks */}
                      {roomResArr.map(res => {
                        const isResizing = resizeDraft?.resId === String(res._id);
                        const visualRes = isResizing
                          ? { ...res, departureDate: resizeDraft.newDepartureDate }
                          : res;
                        const layout = resLayout(visualRes, days, COL_W);
                        if (!layout) return null;
                        return (
                          <ResBlock
                            stayVariant={designMode && lookVariant === 'current' ? stayVariant : 'current'}
                            rowH={ROW_H}
                            overlap={overlapIds.has(String(res._id))}
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

          {filteredRooms.length === 0 && <div className="turo-calendar-empty"><BedDouble size={24}/><strong>לא נמצאו חדרים</strong><span>נסו לשנות את החיפוש או את הסינון</span></div>}
          {/* ── UNASSIGNED ROW ─── */}
          {unassignedRes.length > 0 && (
            <div>
              <div style={{
                display:'flex', position:'sticky', insetInlineStart:0,
                background:'rgba(89,60,251,0.06)',
                height:28, alignItems:'center', zIndex:20,
                minWidth: totalWidth,
                borderTop:'2px solid rgba(196,147,64,0.25)',
              }}>
                <div style={{ position:'sticky', insetInlineStart:0, paddingInline:14, display:'flex', alignItems:'center', gap:6 }}>
                  <AlertCircle size={11} style={{ color:'#6550b8' }} />
                  <span style={{ color:'#67676f', fontSize:11, fontWeight:700 }}>
                    ללא חדר ({unassignedRes.length})
                  </span>
                </div>
              </div>
              <div style={{ display:'flex', height: ROW_H * unassignedRes.length, borderBottom:'1px solid #e8e8ea' }}>
                <div style={{
                  position:'sticky', insetInlineStart:0, zIndex:10, width: LABEL_W, flexShrink:0,
                  display:'flex', alignItems:'center', gap:8, paddingInline:12,
                  background:'rgba(247,239,224,0.5)', borderLeft:'3px solid #593cfb', borderRight:'1px solid #ececef',
                }}>
                  <span style={{ fontSize:12, color:'#67676f', fontWeight:700 }}>לא שויך</span>
                </div>
                <div style={{ position:'relative', flex:1, background:'rgba(247,239,224,0.3)' }}>
                  {days.map((d,i) => (
                    <div key={d.date} style={{
                      position:'absolute', insetInlineStart:i*COL_W, top:0, width:COL_W, height:ROW_H,
                      borderLeft:'1px solid #e8e8ea',
                      background: d.isToday ? 'rgba(89,60,251,0.025)' : 'transparent',
                    }} />
                  ))}
                  {unassignedRes.map((res, reservationIndex) => {
                    const isResizing = resizeDraft?.resId === String(res._id);
                    const visualRes = isResizing
                      ? { ...res, departureDate: resizeDraft.newDepartureDate }
                      : res;
                    const layout = resLayout(visualRes, days, COL_W);
                    if (!layout) return null;
                    return (
                      <ResBlock
                            stayVariant={designMode && lookVariant === 'current' ? stayVariant : 'current'}
                            rowH={ROW_H}
                            overlap={overlapIds.has(String(res._id))}
                        key={res._id}
                        res={visualRes}
                        verticalOffset={reservationIndex * ROW_H}
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

          {designMode && lookVariant === 'innroad' && dayStats && (
            <div className="ir-foot" style={{ display: 'flex', height: 40, position: 'sticky', bottom: 0, zIndex: 25 }}>
              <div className="ir-foot-label" style={{ width: LABEL_W, flexShrink: 0, position: 'sticky', insetInlineStart: 0, zIndex: 26 }}>פנויים · תפוסה</div>
              <div style={{ display: 'flex' }}>
                {dayStats.map((f, i) => (
                  <div key={days[i].date} className={`ir-foot-cell${days[i].isToday ? ' is-today' : ''}`} style={{ width: COL_W }}>
                    <b>{f.free}</b><span>{f.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      </>}

      {/* ─── FOOTER STATS ────────────────────────────────────────────────── */}
      <div className="turo-calendar-footer">
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
