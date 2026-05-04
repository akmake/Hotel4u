import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Crown, RefreshCw, LogIn, Eye, Lock, Unlock, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { rooms as roomsApi, reservations as resApi } from '../utils/api';
import { TODAY, addDays, formatShort, formatDayLabel, isWeekend } from '../utils/date';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

// ── Constants ──────────────────────────────────────────────────────────────────
const COL_W   = 56;
const ROW_H   = 46;
const LABEL_W = 116;

const STATUS_STYLE = {
  in_house:  { bg: 'linear-gradient(135deg,#3b82f6,#2563eb)', text: '#fff', border: '#1d4ed8' },
  due_out:   { bg: 'linear-gradient(135deg,#f97316,#ea580c)', text: '#fff', border: '#c2410c' },
  confirmed: { bg: 'linear-gradient(135deg,#7c3aed,#6d28d9)', text: '#fff', border: '#5b21b6' },
};

const OPS_BG = {
  ooo:  'repeating-linear-gradient(45deg,rgba(239,68,68,0.08),rgba(239,68,68,0.08) 4px,transparent 4px,transparent 12px)',
  hold: 'repeating-linear-gradient(45deg,rgba(168,85,247,0.08),rgba(168,85,247,0.08) 4px,transparent 4px,transparent 12px)',
};

const TYPE_BORDER = { STD:'#6366f1', DLX:'#0891b2', FAM:'#059669', STE:'#f59e0b' };

// ── Block Room Modal ───────────────────────────────────────────────────────────
function BlockRoomModal({ room, propertyId, onClose, onDone }) {
  const isBlocked = room.opsStatus === 'ooo' || room.opsStatus === 'hold';
  const [opsStatus, setOpsStatus] = useState(isBlocked ? 'available' : 'ooo');
  const [reason,    setReason]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const { toasts, success, error: toastErr } = useToast();

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await roomsApi.setOps(String(room._id), opsStatus, reason || undefined, propertyId);
      success(opsStatus === 'available' ? 'חדר שוחרר למכירה' : `חדר ${room.number} חסום — ${opsStatus.toUpperCase()}`);
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
                  { value: 'ooo',  label: 'Out of Order', desc: 'לא ניתן למכירה', color: '#dc2626' },
                  { value: 'hold', label: 'On Hold',      desc: 'חסום זמנית',     color: '#7c3aed' },
                  { value: 'oos',  label: 'Out of Service', desc: 'טיפול תחזוקה', color: '#d97706' },
                  { value: 'internal', label: 'שימוש פנימי', desc: 'צוות/ניהול', color: '#0891b2' },
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
              החדר כרגע {room.opsStatus === 'ooo' ? 'Out of Order' : 'On Hold'}. לחיצה על אישור תשחרר אותו למכירה.
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

// ── Helpers ────────────────────────────────────────────────────────────────────
function buildDays(startOffset, count) {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(TODAY, startOffset + i);
    return { date, label: formatShort(date), dayLabel: formatDayLabel(date), isToday: date === TODAY, isWeekend: isWeekend(date) };
  });
}

function resPosition(res, days) {
  const first = days[0].date, last = days[days.length - 1].date;
  if (res.departureDate <= first || res.arrivalDate > last) return null;
  const startIdx = days.findIndex(d => d.date >= res.arrivalDate);
  const endIdx   = days.findIndex(d => d.date >= res.departureDate);
  const start    = startIdx === -1 ? 0 : startIdx;
  const end      = endIdx   === -1 ? days.length : endIdx;
  return { start, span: Math.max(1, end - start) };
}

function resStyle(res) {
  const today = TODAY;
  if (res.status === 'in_house' && res.departureDate === today) return STATUS_STYLE.due_out;
  if (res.status === 'in_house') return STATUS_STYLE.in_house;
  return STATUS_STYLE.confirmed;
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
function Tooltip({ res, x, y }) {
  const g = res.primaryGuest || {};
  const style = resStyle(res);
  const nights = Math.round((new Date(res.departureDate) - new Date(res.arrivalDate)) / 86400000);
  const statusLabel = { in_house:'In House', confirmed:'מאושר', due_out:'יציאה היום' };
  const label = res.departureDate === TODAY && res.status === 'in_house' ? 'due_out' : res.status;

  return (
    <div style={{
      position: 'fixed', zIndex: 9999, pointerEvents: 'none',
      left: x + 16, top: y - 10,
      background: 'white', border: '1px solid #e2e8f0',
      borderRadius: 12, boxShadow: '0 12px 40px rgba(15,23,42,0.18)',
      minWidth: 220, overflow: 'hidden',
      transform: x > window.innerWidth - 260 ? 'translateX(-110%)' : 'none',
    }}>
      <div style={{ padding: '10px 14px 8px', background: style.bg }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
          {g.vipLevel > 0 && <Crown size={12} />}
          {g.firstName} {g.lastName}
        </div>
        <div style={{ color:'rgba(255,255,255,0.75)', fontSize:11, marginTop:2 }}>{res.confirmationNumber}</div>
      </div>
      <div style={{ padding:'10px 14px', display:'flex', flexDirection:'column', gap:5, fontSize:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#64748b' }}>תאריכים</span>
          <span style={{ fontWeight:600, color:'#0f172a' }}>{formatShort(res.arrivalDate)} → {formatShort(res.departureDate)}</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#64748b' }}>לילות</span>
          <span style={{ fontWeight:600, color:'#0f172a' }}>{nights}</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#64748b' }}>מחיר ללילה</span>
          <span style={{ fontWeight:700, color:'#059669', fontFamily:'monospace' }}>₪{res.ratePerNight?.toLocaleString()}</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#64748b' }}>סטטוס</span>
          <span style={{ fontWeight:600, fontSize:11, padding:'1px 6px', borderRadius:4, background: `${style.border}18`, color: style.border }}>
            {statusLabel[label] || label}
          </span>
        </div>
        {res.isVip && (
          <div style={{ background:'#fef3c7', color:'#92400e', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:600 }}>
            ★ VIP Guest
          </div>
        )}
        {res.specialRequests && (
          <div style={{ color:'#64748b', fontSize:11, borderTop:'1px solid #f1f5f9', paddingTop:6, marginTop:2 }}>
            {res.specialRequests}
          </div>
        )}
      </div>
      <div style={{ padding:'4px 8px 8px', display:'flex', gap:4 }}>
        <span style={{ fontSize:10, color:'#94a3b8', padding:'2px 6px', background:'#f8fafc', borderRadius:4 }}>
          גרור לחדר אחר לשינוי שיבוץ
        </span>
      </div>
    </div>
  );
}

// ── Ghost bar (shown while dragging) ──────────────────────────────────────────
function DragGhost({ drag }) {
  if (!drag) return null;
  const g = drag.res.primaryGuest || {};
  const style = resStyle(drag.res);
  return (
    <div style={{
      position: 'fixed', zIndex: 9998, pointerEvents: 'none',
      left: drag.x - 60, top: drag.y - 16,
      width: 140, height: 32,
      background: style.bg, color: '#fff',
      borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'center', padding: '0 10px',
      fontSize: 11, fontWeight: 700, opacity: 0.9,
      transform: 'rotate(-2deg)',
    }}>
      {g.firstName} {g.lastName}
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
  const [tooltip,     setTooltip]     = useState(null); // { res, x, y }
  const [drag,        setDrag]        = useState(null); // { res, resId, sourceRoomId, x, y }
  const [dropRoomId,  setDropRoomId]  = useState(null);
  const [blockRoom,   setBlockRoom]   = useState(null); // room object

  const dragRef    = useRef(null);
  const dropRef    = useRef(null);
  const tooltipRef = useRef(null);

  const dayCount = 21;
  const days = buildDays(startOffset, dayCount);

  const { data: roomList, loading: l1, error: e1, refetch: r1 } = useApi(() => roomsApi.list(propertyId), [propertyId], skip);
  const { data: resList,  loading: l2, error: e2, refetch: r2 } = useApi(
    () => resApi.list(propertyId, { status: 'confirmed,in_house', limit: 300 }),
    [propertyId], skip
  );

  const refetch = useCallback(() => { r1(); r2(); }, [r1, r2]);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const startDrag = useCallback((e, res, roomId) => {
    e.preventDefault();
    setTooltip(null);
    const info = { res, resId: String(res._id), sourceRoomId: roomId };
    dragRef.current = info;
    setDrag({ ...info, x: e.clientX, y: e.clientY });

    function onMove(ev) {
      setDrag(d => d ? { ...d, x: ev.clientX, y: ev.clientY } : null);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest('[data-room-id]');
      const rid = row?.getAttribute('data-room-id') || null;
      dropRef.current = rid;
      setDropRoomId(rid);
    }

    async function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const targetRoomId = dropRef.current;
      const dragData = dragRef.current;
      setDrag(null);
      setDropRoomId(null);
      dragRef.current = null;
      dropRef.current = null;
      if (targetRoomId && targetRoomId !== dragData.sourceRoomId) {
        try {
          await resApi.assignRoom(dragData.resId, targetRoomId);
          success('חדר שוּנה בהצלחה');
          refetch();
        } catch (err) {
          toastError(err.message);
        }
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [refetch, success, toastError]);

  // ── Close tooltip on scroll ────────────────────────────────────────────────
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

  const resByRoom = {};
  allRes.forEach(res => {
    const key = String(res.assignedRoom?._id || res.assignedRoom);
    if (!key || key === 'null' || key === 'undefined') return;
    (resByRoom[key] = resByRoom[key] || []).push(res);
  });

  // Group by floor
  const byFloor = floors.map(f => ({
    floor: f,
    rooms: filteredRooms.filter(r => r.floor === f),
  })).filter(g => g.rooms.length > 0);

  return (
    <div className="animate-fade-in" style={{ userSelect: drag ? 'none' : 'auto' }}>
      <ToastContainer toasts={toasts} />
      <DragGhost drag={drag} />
      {tooltip && <Tooltip res={tooltip.res} x={tooltip.x} y={tooltip.y} />}
      {blockRoom && (
        <BlockRoomModal
          room={blockRoom}
          propertyId={propertyId}
          onClose={() => setBlockRoom(null)}
          onDone={() => { r1(); r2(); }}
        />
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Room Rack</div>
          <div className="page-subtitle">{days[0].label} — {days[days.length - 1].label} · {filteredRooms.length} חדרים</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="select text-xs" value={filterFloor} onChange={e => setFilterFloor(e.target.value)}>
            <option value="all">כל הקומות</option>
            {floors.map(f => <option key={f} value={f}>קומה {f}</option>)}
          </select>
          <select className="select text-xs" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">כל סוגי החדרים</option>
            {uniqueTypes.map(t => <option key={t._id} value={String(t._id)}>{t.name}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setStartOffset(o => o - 7)}><ChevronRight size={14} /></button>
            <button className="btn btn-primary btn-sm px-3" onClick={() => setStartOffset(-2)}>היום</button>
            <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setStartOffset(o => o + 7)}><ChevronLeft size={14} /></button>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={refetch}><RefreshCw size={14} /></button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs text-ink-muted items-center">
        {[
          { bg:'linear-gradient(135deg,#3b82f6,#2563eb)', label:'In House' },
          { bg:'linear-gradient(135deg,#f97316,#ea580c)', label:'Due Out' },
          { bg:'linear-gradient(135deg,#7c3aed,#6d28d9)', label:'מאושר' },
        ].map(({ bg, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="w-8 h-3 rounded" style={{ background: bg }} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="w-8 h-3 rounded" style={{ background: OPS_BG.ooo, border: '1px solid #fca5a5' }} />
          OOO
        </span>
        <span className="mr-auto text-xs text-brand font-medium">{allRes.length} הזמנות פעילות · גרור שורה לשינוי חדר</span>
      </div>

      {/* Grid */}
      <div className="card overflow-hidden" style={{ boxShadow: '0 2px 16px rgba(15,23,42,0.08)' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
          <div style={{ minWidth: LABEL_W + COL_W * dayCount, position: 'relative' }}>

            {/* Sticky header */}
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 20, background: '#fafafa', borderBottom: '2px solid #e2e8f0' }}>
              <div style={{ width: LABEL_W, minWidth: LABEL_W, height: 48, display:'flex', alignItems:'center', paddingRight: 16, flexShrink: 0, borderLeft: '2px solid #e2e8f0', background: '#fafafa', position: 'sticky', right: 0, zIndex: 21 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>חדר</span>
              </div>
              {days.map(day => (
                <div key={day.date} style={{
                  width: COL_W, minWidth: COL_W, height: 48,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, borderLeft: '1px solid #f1f5f9', flexShrink: 0,
                  background: day.isToday ? 'rgba(99,102,241,0.08)' : day.isWeekend ? '#fdf9f0' : '#fafafa',
                  color: day.isToday ? '#6366f1' : day.isWeekend ? '#d97706' : '#64748b',
                  fontWeight: day.isToday ? 800 : 600,
                  position: 'relative',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{day.label}</span>
                  <span style={{ fontSize: 10, opacity: 0.65 }}>{day.dayLabel}</span>
                  {day.isToday && <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2, background:'#6366f1' }} />}
                </div>
              ))}
            </div>

            {/* Rows by floor */}
            {byFloor.map(({ floor, rooms }) => (
              <div key={floor}>
                {/* Floor separator */}
                <div style={{ display:'flex', alignItems:'center', background:'#f8fafc', borderBottom:'1px solid #e2e8f0', borderTop:'1px solid #e2e8f0', height:24, paddingRight:16, gap:8, position:'sticky', right:0 }}>
                  <span style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:'0.08em', textTransform:'uppercase' }}>קומה {floor}</span>
                  <div style={{ flex:1, height:1, background:'#e2e8f0', marginLeft:8 }} />
                </div>

                {rooms.map(room => {
                  const roomId  = String(room._id);
                  const isOoo   = room.opsStatus === 'ooo';
                  const isHold  = room.opsStatus === 'hold';
                  const roomRes = resByRoom[roomId] || [];
                  const isDrop  = dropRoomId === roomId && drag?.sourceRoomId !== roomId;
                  const typeCode = room.roomType?.code || 'STD';
                  const typeBorder = TYPE_BORDER[typeCode] || '#6366f1';

                  return (
                    <div
                      key={roomId}
                      data-room-id={roomId}
                      style={{
                        display: 'flex', height: ROW_H, position: 'relative',
                        background: isDrop ? 'rgba(99,102,241,0.06)' : 'white',
                        outline: isDrop ? '2px solid #6366f1' : 'none',
                        outlineOffset: -2,
                        transition: 'background 0.12s, outline 0.12s',
                        borderBottom: '1px solid #f8fafc',
                      }}
                    >
                      {/* Label */}
                      <div style={{
                        width: LABEL_W, minWidth: LABEL_W, display:'flex', flexDirection:'column', justifyContent:'center',
                        paddingRight: 14, paddingLeft: 8, flexShrink: 0, zIndex: 3,
                        position: 'sticky', right: 0, background: isDrop ? '#f0f0ff' : 'white',
                        borderLeft: `3px solid ${typeBorder}`,
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background 0.12s',
                      }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                          <span style={{ fontWeight:800, fontSize:13, color:'#0f172a', fontFamily:'monospace' }}>{room.number}</span>
                          {room.isVip && <Crown size={10} style={{ color:'#f59e0b' }} />}
                          {isOoo  && <span style={{ fontSize:9, fontWeight:800, color:'#dc2626', background:'#fee2e2', padding:'1px 4px', borderRadius:3 }}>OOO</span>}
                          {isHold && <span style={{ fontSize:9, fontWeight:800, color:'#7c3aed', background:'#ede9fe', padding:'1px 4px', borderRadius:3 }}>HOLD</span>}
                          <button
                            onClick={e => { e.stopPropagation(); setBlockRoom(room); }}
                            title={isOoo || isHold ? 'שחרר חדר' : 'חסום חדר'}
                            style={{
                              marginRight: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px 3px',
                              color: isOoo ? '#dc2626' : isHold ? '#7c3aed' : '#94a3b8',
                              borderRadius: 3, display: 'flex', alignItems: 'center',
                            }}
                          >
                            {isOoo || isHold ? <Unlock size={10} /> : <Lock size={10} />}
                          </button>
                        </div>
                        <span style={{ fontSize:10, color:'#94a3b8' }}>{room.roomType?.name}</span>
                      </div>

                      {/* Day cells */}
                      {days.map(day => (
                        <div key={day.date} style={{
                          width: COL_W, minWidth: COL_W, height: '100%', flexShrink: 0,
                          borderLeft: '1px solid #f8fafc',
                          background: day.isToday ? 'rgba(99,102,241,0.03)' : day.isWeekend ? 'rgba(251,191,36,0.04)' : 'transparent',
                          ...(isOoo || isHold ? { background: isOoo ? OPS_BG.ooo : OPS_BG.hold } : {}),
                        }} />
                      ))}

                      {/* Reservation bars */}
                      {roomRes.map(res => {
                        const pos = resPosition(res, days);
                        if (!pos) return null;
                        const s = resStyle(res);
                        const resId = String(res._id);
                        const g = res.primaryGuest || {};
                        const isDraggingThis = drag?.resId === resId;

                        return (
                          <div
                            key={resId}
                            onPointerDown={e => startDrag(e, res, roomId)}
                            onMouseEnter={e => { if (!drag) setTooltip({ res, x: e.clientX, y: e.clientY }); }}
                            onMouseMove={e => { if (!drag && tooltip?.res?._id === res._id) setTooltip({ res, x: e.clientX, y: e.clientY }); }}
                            onMouseLeave={() => setTooltip(null)}
                            style={{
                              position: 'absolute',
                              right: LABEL_W + pos.start * COL_W + 3,
                              top: 5, width: pos.span * COL_W - 6, height: ROW_H - 10,
                              background: s.bg,
                              borderRadius: 7,
                              boxShadow: isDraggingThis ? '0 8px 24px rgba(0,0,0,0.3)' : '0 1px 4px rgba(0,0,0,0.14)',
                              display: 'flex', alignItems: 'center', padding: '0 8px',
                              cursor: 'grab', zIndex: isDraggingThis ? 1 : 2,
                              opacity: isDraggingThis ? 0.4 : 1,
                              overflow: 'hidden', gap: 4,
                              border: `1px solid ${s.border}`,
                              transition: 'box-shadow 0.15s, opacity 0.15s',
                              color: '#fff', fontSize: 11, fontWeight: 700,
                            }}
                          >
                            {res.isVip && <Crown size={9} style={{ flexShrink: 0, opacity: 0.9 }} />}
                            {pos.span > 1 && (
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {g.firstName}
                                {pos.span > 2 && <span style={{ opacity: 0.7, fontWeight: 400 }}> {g.lastName?.slice(0,1)}.</span>}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Today indicator line */}
      <div className="mt-3 flex items-center gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-0.5 bg-brand inline-block rounded" />
          היום — {TODAY}
        </span>
        <span className="text-ink-faint">·</span>
        <span>{allRes.length} הזמנות · {filteredRooms.length} חדרים</span>
        <span className="text-ink-faint">·</span>
        <span className="text-ink-faint">גרור הזמנה בין שורות לשינוי שיבוץ</span>
      </div>
    </div>
  );
}
