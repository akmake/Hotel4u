import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ChevronRight, ChevronLeft, Crown, RefreshCw, Lock, Unlock, X, AlertCircle } from 'lucide-react';
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

// ── Constants ──────────────────────────────────────────────────────────────────
const COL_W   = 56;
const ROW_H   = 48;
const LABEL_W = 130;
const RESIZE_HANDLE_W = 10;

const STATUS_STYLE = {
  in_house:  { bg: 'linear-gradient(135deg,#3b82f6,#2563eb)', text: '#fff', border: '#1d4ed8' },
  due_out:   { bg: 'linear-gradient(135deg,#f97316,#ea580c)', text: '#fff', border: '#c2410c' },
  confirmed: { bg: 'linear-gradient(135deg,#7c3aed,#6d28d9)', text: '#fff', border: '#5b21b6' },
};

const OPS_BG = {
  out_of_order:     'repeating-linear-gradient(45deg,rgba(239,68,68,0.08),rgba(239,68,68,0.08) 4px,transparent 4px,transparent 12px)',
  maintenance_hold: 'repeating-linear-gradient(45deg,rgba(168,85,247,0.08),rgba(168,85,247,0.08) 4px,transparent 4px,transparent 12px)',
  out_of_service:   'repeating-linear-gradient(45deg,rgba(217,119,6,0.08),rgba(217,119,6,0.08) 4px,transparent 4px,transparent 12px)',
  internal_use:     'repeating-linear-gradient(45deg,rgba(8,145,178,0.08),rgba(8,145,178,0.08) 4px,transparent 4px,transparent 12px)',
};

const TYPE_BORDER = { STD:'#C49340', DLX:'#0891b2', FAM:'#059669', STE:'#f59e0b' };

const BLOCKED_STATUSES = new Set(['out_of_order', 'maintenance_hold', 'out_of_service', 'internal_use']);
const OPS_LABEL = {
  out_of_order:     'Out of Order',
  maintenance_hold: 'Maintenance Hold',
  out_of_service:   'Out of Service',
  internal_use:     'Internal Use',
};

const CLEAN_DOT = {
  clean:     '#059669',
  inspected: '#0891b2',
  dirty:     '#f59e0b',
  cleaning:  '#7c3aed',
};

function isBlockedStatus(s) { return BLOCKED_STATUSES.has(s); }

function buildDays(startOffset, count) {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(TODAY, startOffset + i);
    return { date, label: formatShort(date), dayLabel: formatDayLabel(date), isToday: date === TODAY, isWeekend: isWeekend(date) };
  });
}

function resPosition(res, days) {
  const first = days[0].date, last = days[days.length - 1].date;
  if (res.departureDate <= first || res.arrivalDate > last) return null;
  const clampedStart = res.arrivalDate < first ? first : res.arrivalDate;
  const clampedEnd   = res.departureDate > addDays(last, 1) ? addDays(last, 1) : res.departureDate;
  const startIdx = days.findIndex(d => d.date >= clampedStart);
  const endIdx   = days.findIndex(d => d.date >= clampedEnd);
  const start    = startIdx === -1 ? 0 : startIdx;
  const end      = endIdx   === -1 ? days.length : endIdx;
  return {
    start,
    span: Math.max(1, end - start),
    clippedRight: res.arrivalDate < first,
    clippedLeft: res.departureDate > addDays(last, 1),
  };
}

function nightsBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

function resStyle(res) {
  if (res.status === 'in_house' && res.departureDate === TODAY) return STATUS_STYLE.due_out;
  if (res.status === 'in_house') return STATUS_STYLE.in_house;
  return STATUS_STYLE.confirmed;
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
function Tooltip({ res, x, y }) {
  const g = res.primaryGuest || {};
  const s = resStyle(res);
  const nights = Math.round((new Date(res.departureDate) - new Date(res.arrivalDate)) / 86400000);
  const label = res.status === 'in_house' && res.departureDate === TODAY ? 'Due Out'
              : res.status === 'in_house' ? 'In House' : 'מאושר';
  return (
    <div style={{
      position:'fixed', zIndex:9999, pointerEvents:'none',
      left: x > window.innerWidth - 260 ? x - 250 : x + 14,
      top: y - 10,
      background:'#fff', border:'1px solid #DDD0BC',
      borderRadius:12, boxShadow:'0 12px 40px rgba(60,35,10,0.18)',
      minWidth:220, overflow:'hidden', direction:'rtl',
    }}>
      <div style={{ padding:'10px 14px 8px', background: s.bg }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
          {g.vipLevel > 0 && <Crown size={12} />}
          {g.firstName} {g.lastName}
        </div>
        <div style={{ color:'rgba(255,255,255,0.7)', fontSize:11, marginTop:2 }}>{res.confirmationNumber} · {label}</div>
      </div>
      <div style={{ padding:'10px 14px', fontSize:12, display:'flex', flexDirection:'column', gap:5 }}>
        {[
          { l:'תאריכים', v:`${formatShort(res.arrivalDate)} → ${formatShort(res.departureDate)}` },
          { l:'לילות',   v: nights },
          { l:'מחיר',    v: res.ratePerNight ? `₪${res.ratePerNight.toLocaleString('he-IL')}` : '—' },
        ].map(({ l, v }) => (
          <div key={l} style={{ display:'flex', justifyContent:'space-between', borderBottom:'1px solid #EAE0D0', paddingBottom:3 }}>
            <span style={{ color:'#7A5C42' }}>{l}</span>
            <span style={{ fontWeight:600, color:'#2A1A0E', fontFamily:'monospace' }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ padding:'4px 12px 8px', fontSize:10, color:'#B8A080' }}>גרור לחדר אחר · לחץ לפתיחה</div>
    </div>
  );
}

// ── Ghost ──────────────────────────────────────────────────────────────────────
function DragGhost({ drag }) {
  if (!drag) return null;
  const g = drag.res.primaryGuest || {};
  const s = resStyle(drag.res);
  return (
    <div style={{
      position:'fixed', zIndex:9998, pointerEvents:'none',
      left: drag.x - 60, top: drag.y - 16,
      width:150, height:32, borderRadius:8,
      background: s.bg, color:'#fff',
      display:'flex', alignItems:'center', padding:'0 10px',
      fontSize:11, fontWeight:700, opacity:0.92,
      boxShadow:'0 8px 24px rgba(0,0,0,0.3)',
      transform:'rotate(-2deg)',
    }}>
      {g.firstName} {g.lastName}
    </div>
  );
}

function StayResizeDialog({ pending, onConfirm, onCancel }) {
  const { res, oldDepartureDate, newDepartureDate } = pending;
  const oldNights = nightsBetween(res.arrivalDate, oldDepartureDate);
  const newNights = nightsBetween(res.arrivalDate, newDepartureDate);
  const delta = newNights - oldNights;
  const isExtend = delta > 0;
  const [nightlyRate, setNightlyRate] = useState(res.ratePerNight != null ? String(res.ratePerNight) : '');

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
              <label className="text-xs font-semibold text-ink-secondary block mb-1.5">מחיר חדש ללילה (רשות)</label>
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
              const parsed = Number(nightlyRate);
              onConfirm({
                nightlyRate: isExtend && nightlyRate !== '' && Number.isFinite(parsed) ? parsed : undefined,
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

// ── Block Room Modal ───────────────────────────────────────────────────────────
function BlockRoomModal({ room, propertyId, onClose, onDone }) {
  const blocked = isBlockedStatus(room.opsStatus);
  const [opsStatus, setOpsStatus] = useState(blocked ? 'available' : 'out_of_order');
  const [reason,    setReason]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const { toasts, success, error: toastErr } = useToast();

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await roomsApi.setOps(String(room._id), opsStatus, reason || undefined, propertyId);
      success(opsStatus === 'available' ? 'חדר שוחרר למכירה' : `חדר ${room.number} חסום`);
      setTimeout(() => { onDone(); onClose(); }, 600);
    } catch (e) { toastErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ direction:'rtl' }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <ToastContainer toasts={toasts} />
        <div className="flex items-center justify-between p-5 border-b border-surface-border">
          <div>
            <div className="font-bold text-ink flex items-center gap-2">
              {blocked ? <Unlock size={15}/> : <Lock size={15}/>}
              {blocked ? `שחרר חדר ${room.number}` : `חסום חדר ${room.number}`}
            </div>
            <div className="text-xs text-ink-muted">{room.roomType?.name} · קומה {room.floor}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          {!blocked && (
            <div className="grid grid-cols-2 gap-2">
              {[
                { value:'out_of_order',     label:'Out of Order',    desc:'לא ניתן למכירה', color:'#dc2626' },
                { value:'maintenance_hold', label:'On Hold',          desc:'חסום זמנית',     color:'#7c3aed' },
                { value:'out_of_service',   label:'Out of Service',  desc:'טיפול תחזוקה',   color:'#d97706' },
                { value:'internal_use',     label:'שימוש פנימי',     desc:'צוות/ניהול',     color:'#0891b2' },
              ].map(opt => (
                <label key={opt.value}
                  className={`flex flex-col p-2.5 rounded-xl border-2 cursor-pointer ${opsStatus===opt.value?'border-brand bg-brand/5':'border-surface-border'}`}>
                  <input type="radio" name="ops" value={opt.value} checked={opsStatus===opt.value} onChange={()=>setOpsStatus(opt.value)} className="hidden"/>
                  <span className="font-bold text-xs" style={{color:opt.color}}>{opt.label}</span>
                  <span className="text-xs text-ink-faint">{opt.desc}</span>
                </label>
              ))}
            </div>
          )}
          {blocked && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              החדר כרגע {OPS_LABEL[room.opsStatus]}. לחיצה תשחרר אותו למכירה.
            </div>
          )}
          <input className="input w-full text-sm" placeholder="סיבה (רשות)..." value={reason} onChange={e=>setReason(e.target.value)}/>
          <div className="flex gap-2">
            <button type="submit" className={`btn btn-sm flex-1 justify-center gap-1 ${blocked?'btn-primary':'btn-danger'}`} disabled={loading}>
              {loading?'...':blocked?<><Unlock size={13}/> שחרר</>:<><Lock size={13}/> חסום</>}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function RoomRackPage() {
  const { propertyId } = useProperty();
  const nav  = useNavigate();
  const skip = !propertyId;
  const { toasts, success, error: toastError } = useToast();

  const [startOffset, setStartOffset] = useState(-2);
  const [filterFloor, setFilterFloor] = useState('all');
  const [filterType,  setFilterType]  = useState('all');
  const [tooltip,     setTooltip]     = useState(null);
  const [blockRoom,   setBlockRoom]   = useState(null);
  const [selectedRes, setSelectedRes] = useState(null);
  const containerRef = useRef(null);

  const dayCount = 21;
  const days = useMemo(() => buildDays(startOffset, dayCount), [startOffset]);

  const { data: roomList, loading: l1, error: e1, refetch: r1 } = useApi(
    () => roomsApi.list(propertyId), [propertyId], skip
  );
  const { data: resList, loading: l2, error: e2, refetch: r2 } = useApi(
    () => resApi.list(propertyId, { status: 'confirmed,in_house', limit: 300 }), [propertyId], skip
  );

  const refetch = useCallback(() => { r1(); r2(); }, [r1, r2]);

  // Must be before early returns
  const resByRoom = useMemo(() => {
    const map = {};
    (resList || []).forEach(res => {
      const key = String(res.assignedRoom?._id || res.assignedRoom);
      if (!key || key === 'null' || key === 'undefined') return;
      (map[key] = map[key] || []).push(res);
    });
    return map;
  }, [resList]);

  const unassignedRes = useMemo(() => (resList || []).filter(res => {
    const k = String(res.assignedRoom?._id || res.assignedRoom);
    return !k || k === 'null' || k === 'undefined';
  }), [resList]);

  // ── Drag (click = open drawer, drag = reassign) ──────────────────────────
  const resolveDropRoomId = useCallback((clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const row = el?.closest('[data-room-id]');
    return row?.getAttribute('data-room-id') || null;
  }, []);

  const resolveResizeDeparture = useCallback((clientX, clientY, res) => {
    const el = document.elementFromPoint(clientX, clientY);
    const dayEl = el?.closest('[data-day-index]');
    if (!dayEl) return null;
    const dayIdx = Number(dayEl.getAttribute('data-day-index'));
    if (!Number.isFinite(dayIdx) || dayIdx < 0 || dayIdx >= days.length) return null;
    const departure = addDays(days[dayIdx].date, 1);
    const minDeparture = addDays(res.arrivalDate, 1);
    return departure < minDeparture ? minDeparture : departure;
  }, [days]);

  const {
    drag,
    dropRoomId,
    resizeDraft,
    pendingMove,
    setPendingMove,
    pendingResize,
    setPendingResize,
    startDrag: beginDrag,
    startResize: beginResize,
  } = useReservationDragResize({
    dragActivationPx: 5,
    onTapReservation: (res) => setSelectedRes(res),
    resolveDropRoomId,
    resolveResizeDepartureDate: resolveResizeDeparture,
  });

  const startDrag = useCallback((e, res, roomId) => {
    setTooltip(null);
    beginDrag(e, res, roomId);
  }, [beginDrag]);

  const startResize = useCallback((e, res) => {
    setTooltip(null);
    beginResize(e, res);
  }, [beginResize]);

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
      toastError(err.message);
    }
  }

  useEffect(() => {
    const hide = () => setTooltip(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, []);

  if (skip || l1 || l2) return <PageSpinner />;
  if (e1) return <ErrorState message={e1} onRetry={r1} />;
  if (e2) return <ErrorState message={e2} onRetry={r2} />;

  const allRooms = roomList || [];
  const allRes   = resList  || [];

  const typeMap = {};
  allRooms.forEach(r => { if (r.roomType?._id) typeMap[r.roomType._id] = r.roomType; });
  const uniqueTypes = Object.values(typeMap);
  const floors = [...new Set(allRooms.map(r => r.floor))].sort((a, b) => a - b);

  const filteredRooms = allRooms.filter(r => {
    if (filterFloor !== 'all' && r.floor !== Number(filterFloor)) return false;
    if (filterType  !== 'all' && String(r.roomType?._id) !== filterType) return false;
    return true;
  });

  const byFloor = floors
    .map(f => ({ floor: f, rooms: filteredRooms.filter(r => r.floor === f) }))
    .filter(g => g.rooms.length > 0);

  const totalWidth = LABEL_W + COL_W * dayCount;

  return (
    <div className="animate-fade-in" style={{ direction:'rtl', userSelect: drag || resizeDraft ? 'none' : 'auto' }}>
      <ToastContainer toasts={toasts} />
      <DragGhost drag={drag} />
      {tooltip && <Tooltip res={tooltip.res} x={tooltip.x} y={tooltip.y} />}

      {blockRoom && (
        <BlockRoomModal room={blockRoom} propertyId={propertyId} onClose={() => setBlockRoom(null)} onDone={refetch} />
      )}
      {selectedRes && (
        <ReservationDrawer reservationId={selectedRes._id} propertyId={propertyId} onChanged={refetch} onClose={() => { setSelectedRes(null); refetch(); }} />
      )}
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

      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="page-title">Room Rack</h1>
          <p className="page-subtitle">{days[0].label} — {days[days.length-1].label} · {filteredRooms.length} חדרים</p>
        </div>
        <div className="mr-auto flex items-center gap-2 flex-wrap">
          <select className="select text-xs" value={filterFloor} onChange={e=>setFilterFloor(e.target.value)}>
            <option value="all">כל הקומות</option>
            {floors.map(f=><option key={f} value={f}>קומה {f}</option>)}
          </select>
          <select className="select text-xs" value={filterType} onChange={e=>setFilterType(e.target.value)}>
            <option value="all">כל הסוגים</option>
            {uniqueTypes.map(t=><option key={t._id} value={String(t._id)}>{t.name}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost btn-icon btn-sm" onClick={()=>setStartOffset(o=>o-7)}><ChevronRight size={14}/></button>
            <button className="btn btn-secondary btn-sm px-3" onClick={()=>setStartOffset(-2)}>היום</button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={()=>setStartOffset(o=>o+7)}><ChevronLeft size={14}/></button>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={refetch}><RefreshCw size={14}/></button>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs items-center" style={{ color:'#7A5C42' }}>
        {[
          { bg:'linear-gradient(135deg,#3b82f6,#2563eb)', label:'In House' },
          { bg:'linear-gradient(135deg,#f97316,#ea580c)', label:'Due Out' },
          { bg:'linear-gradient(135deg,#7c3aed,#6d28d9)', label:'מאושר' },
        ].map(({ bg, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span style={{ width:28, height:12, borderRadius:4, background:bg, display:'inline-block' }} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span style={{ width:28, height:12, borderRadius:4, background: OPS_BG.out_of_order, border:'1px solid #fca5a5', display:'inline-block' }} />
          OOO
        </span>
        {unassignedRes.length > 0 && (
          <span className="flex items-center gap-1.5 mr-auto font-semibold" style={{ color:'#9A6B1A' }}>
            <AlertCircle size={12} /> {unassignedRes.length} ללא חדר
          </span>
        )}
        <span className="mr-auto" style={{ color:'#B8A080' }}>לחץ להזמנה · גרור לשינוי חדר · גרור קצה שמאלי לשינוי יציאה</span>
      </div>

      {/* ── Grid ── */}
      <div ref={containerRef} style={{
        overflowX:'auto', overflowY:'auto',
        maxHeight:'calc(100vh - 260px)',
        borderRadius:14,
        border:'1px solid #C8B89A',
        background:'#FDFAF5',
        boxShadow:'0 2px 16px rgba(60,35,10,0.08)',
      }}>
        <div style={{ minWidth: totalWidth, position:'relative' }}>

          {/* Sticky header */}
          <div style={{ display:'flex', position:'sticky', top:0, zIndex:20, background:'#FAF7F2', borderBottom:'2px solid #DDD0BC', height:50 }}>
            {/* Corner */}
            <div style={{
              width:LABEL_W, minWidth:LABEL_W, height:50,
              display:'flex', alignItems:'center', paddingRight:16, flexShrink:0,
              borderLeft:'2px solid #DDD0BC', background:'#2A1A0E',
              position:'sticky', right:0, zIndex:21,
            }}>
              <div>
                <div style={{ color:'#fff', fontWeight:800, fontSize:12 }}>{filteredRooms.length} חדרים</div>
                <div style={{ color:'rgba(196,147,64,0.6)', fontSize:10 }}>{days[0].label} – {days[days.length-1].label}</div>
              </div>
            </div>
            {/* Day columns */}
            {days.map((day, dayIdx) => (
              <div key={day.date} data-day-index={dayIdx} style={{
                width:COL_W, minWidth:COL_W, height:50, flexShrink:0,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                borderLeft:'1px solid #EAE0D0',
                background: day.isToday ? 'rgba(196,147,64,0.12)' : day.isWeekend ? '#FAF4E8' : '#FAF7F2',
                color: day.isToday ? '#9A6B1A' : day.isWeekend ? '#7A5040' : '#7A5C42',
                fontWeight: day.isToday ? 800 : 600,
                position:'relative',
              }}>
                <span style={{ fontSize:12, fontWeight:700 }}>{day.label}</span>
                <span style={{ fontSize:10, opacity:0.65 }}>{day.dayLabel}</span>
                {day.isToday && <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2, background:'#B8851A' }} />}
              </div>
            ))}
          </div>

          {/* Rows by floor */}
          {byFloor.map(({ floor, rooms }) => (
            <div key={floor}>
              {/* Floor separator */}
              <div style={{
                display:'flex', alignItems:'center',
                background:'#F2EDE4',
                borderTop:'1px solid #DDD0BC', borderBottom:'1px solid #DDD0BC',
                height:26, paddingRight:16, gap:8,
                position:'sticky', right:0, minWidth:totalWidth, zIndex:10,
              }}>
                <div style={{ width:3, height:12, borderRadius:2, background:'#C49340' }} />
                <span style={{ fontSize:10, fontWeight:800, color:'#4A3020', letterSpacing:'0.07em', textTransform:'uppercase' }}>קומה {floor}</span>
                <span style={{ fontSize:10, color:'#9A7A5A' }}>({rooms.length} חדרים)</span>
              </div>

              {rooms.map((room, ri) => {
                const roomId    = String(room._id);
                const isOoo     = room.opsStatus === 'out_of_order';
                const isHold    = room.opsStatus === 'maintenance_hold';
                const isOos     = room.opsStatus === 'out_of_service';
                const isInt     = room.opsStatus === 'internal_use';
                const blocked   = isBlockedStatus(room.opsStatus);
                const roomRes   = resByRoom[roomId] || [];
                const isDrop    = dropRoomId === roomId && drag?.sourceRoomId !== roomId;
                const typeCode  = room.roomType?.code || 'STD';
                const typeBorder = TYPE_BORDER[typeCode] || '#C49340';

                return (
                  <div
                    key={roomId}
                    data-room-id={roomId}
                    style={{
                      display:'flex', height:ROW_H, position:'relative',
                      background: isDrop ? 'rgba(196,147,64,0.08)' : ri % 2 === 0 ? '#FAF6F0' : '#FDFAF5',
                      outline: isDrop ? '2px solid #C49340' : 'none',
                      outlineOffset: -2,
                      borderBottom:'1px solid #EAE0D0',
                      transition:'background 0.12s',
                    }}
                  >
                    {/* Room label */}
                    <div style={{
                      width:LABEL_W, minWidth:LABEL_W, flexShrink:0,
                      display:'flex', flexDirection:'column', justifyContent:'center',
                      paddingRight:14, paddingLeft:8, zIndex:3,
                      position:'sticky', right:0,
                      background: isDrop ? '#F7EFE0' : isOoo ? '#FEF2F2' : isHold ? '#FAF5FF' : ri % 2 === 0 ? '#FAF6F0' : '#FDFAF5',
                      borderLeft:`3px solid ${isOoo ? '#dc2626' : isHold ? '#7c3aed' : typeBorder}`,
                      borderBottom:'1px solid #EAE0D0',
                      transition:'background 0.12s',
                    }}>
                      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                        <span style={{ fontFamily:'monospace', fontWeight:900, fontSize:15, color: isOoo ? '#dc2626' : '#2A1A0E' }}>{room.number}</span>
                        {isOoo  && <span style={{ fontSize:9, fontWeight:800, color:'#dc2626', background:'#fee2e2', padding:'1px 4px', borderRadius:3 }}>OOO</span>}
                        {isHold && <span style={{ fontSize:9, fontWeight:800, color:'#7c3aed', background:'#ede9fe', padding:'1px 4px', borderRadius:3 }}>HOLD</span>}
                        {isOos  && <span style={{ fontSize:9, fontWeight:800, color:'#b45309', background:'#fef3c7', padding:'1px 4px', borderRadius:3 }}>OOS</span>}
                        {isInt  && <span style={{ fontSize:9, fontWeight:800, color:'#0e7490', background:'#cffafe', padding:'1px 4px', borderRadius:3 }}>INT</span>}
                        <button
                          onClick={e => { e.stopPropagation(); setBlockRoom(room); }}
                          style={{ marginRight:'auto', background:'transparent', border:'none', cursor:'pointer', padding:'1px 3px', color: blocked ? '#dc2626' : '#C8B89A' }}
                        >
                          {blocked ? <Unlock size={10}/> : <Lock size={10}/>}
                        </button>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:2 }}>
                        <div style={{ width:5, height:5, borderRadius:'50%', background: CLEAN_DOT[room.cleanStatus] || '#C8B89A', flexShrink:0 }} />
                        <span style={{ fontSize:9.5, color:'#9A7A5A', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{room.roomType?.name}</span>
                      </div>
                    </div>

                    {/* Day cells */}
                    {days.map((day, dayIdx) => (
                      <div key={day.date}
                        onClick={() => !blocked && nav(`/pms/reservations/new?roomId=${roomId}&date=${day.date}`)}
                        data-day-index={dayIdx}
                        style={{
                          width:COL_W, minWidth:COL_W, height:'100%', flexShrink:0,
                          borderLeft:'1px solid #EAE0D0',
                          background: blocked
                            ? OPS_BG[room.opsStatus] || OPS_BG.out_of_order
                            : day.isToday ? 'rgba(196,147,64,0.05)' : day.isWeekend ? 'rgba(180,120,60,0.04)' : 'transparent',
                          cursor: blocked ? 'default' : 'cell',
                        }}
                      />
                    ))}

                    {/* Reservation bars */}
                    {roomRes.map(res => {
                      const resId = String(res._id);
                      const isResizingThis = resizeDraft?.resId === resId;
                      const visualRes = isResizingThis
                        ? { ...res, departureDate: resizeDraft.newDepartureDate }
                        : res;
                      const pos = resPosition(visualRes, days);
                      if (!pos) return null;
                      const s = resStyle(visualRes);
                      const g = visualRes.primaryGuest || {};
                      const isDraggingThis = drag?.resId === resId;
                      return (
                        <div
                          key={resId}
                          onPointerDown={e => startDrag(e, res, roomId)}
                          onMouseEnter={e => { if (!drag && !resizeDraft) setTooltip({ res: visualRes, x: e.clientX, y: e.clientY }); }}
                          onMouseMove={e  => { if (!drag && !resizeDraft && tooltip?.res?._id === res._id) setTooltip({ res: visualRes, x: e.clientX, y: e.clientY }); }}
                          onMouseLeave={() => setTooltip(null)}
                          style={{
                            position:'absolute',
                            right: LABEL_W + pos.start * COL_W + 3,
                            top:5, width: pos.span * COL_W - 6, height: ROW_H - 10,
                            background: s.bg,
                            borderRadius:8, border:`1px solid ${s.border}`,
                            boxShadow: isDraggingThis ? '0 8px 24px rgba(0,0,0,0.3)' : '0 2px 6px rgba(0,0,0,0.14)',
                            display:'flex', alignItems:'center', padding:'0 8px', gap:4,
                            cursor: isResizingThis ? 'ew-resize' : 'grab', zIndex: isDraggingThis ? 1 : 2,
                            opacity: isDraggingThis ? 0.35 : isResizingThis ? 0.72 : 1,
                            overflow:'hidden', color:'#fff', fontSize:11, fontWeight:700,
                            transition:'opacity 0.12s',
                            pointerEvents: isResizingThis ? 'none' : 'auto',
                          }}
                        >
                          {res.isVip && <Crown size={9} style={{ flexShrink:0, opacity:0.9 }} />}
                          {pos.span > 1 && (
                            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {g.firstName}{pos.span > 2 && <span style={{ opacity:0.7, fontWeight:400 }}> {g.lastName?.[0]}.</span>}
                            </span>
                          )}
                          {!pos.clippedLeft && (
                            <div
                              onPointerDown={e => startResize(e, res)}
                              title="גרור לשינוי יציאה"
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                width: RESIZE_HANDLE_W,
                                height: '100%',
                                cursor: 'ew-resize',
                                background: 'rgba(255,255,255,0.18)',
                                borderRight: '1px dashed rgba(255,255,255,0.5)',
                                pointerEvents: 'auto',
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Unassigned row */}
          {unassignedRes.length > 0 && (
            <div>
              <div style={{
                display:'flex', alignItems:'center', height:26,
                background:'rgba(196,147,64,0.10)', borderTop:'2px solid rgba(196,147,64,0.25)',
                paddingRight:16, gap:6, position:'sticky', right:0, minWidth:totalWidth, zIndex:10,
              }}>
                <AlertCircle size={10} style={{ color:'#9A6B1A' }} />
                <span style={{ fontSize:10, fontWeight:800, color:'#7A5C42' }}>ללא חדר ({unassignedRes.length})</span>
              </div>
              <div style={{ display:'flex', height:ROW_H, position:'relative', borderBottom:'1px solid #DDD0BC', background:'rgba(247,239,224,0.25)' }}>
                <div style={{
                  width:LABEL_W, minWidth:LABEL_W, flexShrink:0, zIndex:3,
                  display:'flex', alignItems:'center', paddingRight:14,
                  position:'sticky', right:0, background:'rgba(247,239,224,0.5)',
                  borderLeft:'3px solid #C49340', borderBottom:'1px solid #DDD0BC',
                }}>
                  <span style={{ fontSize:12, color:'#7A5C42', fontWeight:700 }}>לא שויך</span>
                </div>
                {days.map((day, dayIdx) => (
                  <div key={day.date} data-day-index={dayIdx} style={{
                    width:COL_W, minWidth:COL_W, height:'100%', flexShrink:0,
                    borderLeft:'1px solid #EAE0D0',
                    background: day.isToday ? 'rgba(196,147,64,0.05)' : 'transparent',
                  }} />
                ))}
                {unassignedRes.map(res => {
                  const resId = String(res._id);
                  const isResizingThis = resizeDraft?.resId === resId;
                  const visualRes = isResizingThis
                    ? { ...res, departureDate: resizeDraft.newDepartureDate }
                    : res;
                  const pos = resPosition(visualRes, days);
                  if (!pos) return null;
                  const s = resStyle(visualRes);
                  const g = visualRes.primaryGuest || {};
                  const isDraggingThis = drag?.resId === resId;
                  return (
                    <div
                      key={resId}
                      onPointerDown={e => startDrag(e, res, 'unassigned')}
                      onMouseEnter={e => { if (!drag && !resizeDraft) setTooltip({ res: visualRes, x: e.clientX, y: e.clientY }); }}
                      onMouseMove={e  => { if (!drag && !resizeDraft && tooltip?.res?._id === res._id) setTooltip({ res: visualRes, x: e.clientX, y: e.clientY }); }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        position:'absolute',
                        right: LABEL_W + pos.start * COL_W + 3,
                        top:5, width: pos.span * COL_W - 6, height: ROW_H - 10,
                        background: s.bg, borderRadius:8, border:`1px solid ${s.border}`,
                        boxShadow: isDraggingThis ? '0 8px 24px rgba(0,0,0,0.3)' : '0 2px 6px rgba(0,0,0,0.14)',
                        display:'flex', alignItems:'center', padding:'0 8px', gap:4,
                        cursor: isResizingThis ? 'ew-resize' : 'grab', zIndex: isDraggingThis ? 1 : 2,
                        opacity: isDraggingThis ? 0.35 : isResizingThis ? 0.72 : 1,
                        overflow:'hidden', color:'#fff', fontSize:11, fontWeight:700,
                        pointerEvents: isResizingThis ? 'none' : 'auto',
                      }}
                    >
                      {res.isVip && <Crown size={9} style={{ flexShrink:0 }} />}
                      {pos.span > 1 && <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.firstName}</span>}
                      {!pos.clippedLeft && (
                        <div
                          onPointerDown={e => startResize(e, res)}
                          title="גרור לשינוי יציאה"
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            width: RESIZE_HANDLE_W,
                            height: '100%',
                            cursor: 'ew-resize',
                            background: 'rgba(255,255,255,0.18)',
                            borderRight: '1px dashed rgba(255,255,255,0.5)',
                            pointerEvents: 'auto',
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center gap-4 text-xs flex-wrap" style={{ color:'#B8A080' }}>
        <span><strong style={{ color:'#2A1A0E' }}>{allRes.length}</strong> הזמנות פעילות</span>
        <span>·</span>
        <span><strong style={{ color:'#2A1A0E' }}>{filteredRooms.length}</strong> חדרים</span>
        <span>·</span>
        <span>לחץ על תא ריק להזמנה חדשה · גרור לשינוי שיבוץ · גרור קצה שמאלי לשינוי יציאה</span>
      </div>
    </div>
  );
}
