import { useState } from 'react';
import { BedDouble, Crown, CheckCircle2, AlertTriangle, X, Sparkles, Wrench, Users } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { rooms as roomsApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

// ── Status definitions ────────────────────────────────────────────────────────
const CLEAN_CONFIG = {
  clean:     { label:'נקי',      bg:'#f0fdf4', border:'#86efac', dot:'#22c55e',  text:'#166534' },
  dirty:     { label:'מלוכלך',   bg:'#fffbeb', border:'#fcd34d', dot:'#f59e0b',  text:'#92400e' },
  inspected: { label:'נבדק',     bg:'#eff6ff', border:'#93c5fd', dot:'#3b82f6',  text:'#1e40af' },
  pickup:    { label:'Pickup',   bg:'#fef9c3', border:'#fde047', dot:'#eab308',  text:'#854d0e' },
};

const OCC_CONFIG = {
  vacant:    { label:'פנוי',     color:'#64748b' },
  occupied:  { label:'מאוכלס',  color:'#2563eb' },
  departure: { label:'יציאה',   color:'#ea580c' },
};

const OPS_CONFIG = {
  available: null,
  ooo:  { label:'OOO',  bg:'rgba(239,68,68,0.1)',   border:'#fca5a5',  text:'#dc2626' },
  hold: { label:'HOLD', bg:'rgba(168,85,247,0.1)',  border:'#d8b4fe',  text:'#7c3aed' },
};

const CLEAN_ACTIONS = [
  { value:'clean',     label:'נקי ✓',    color:'#166534', bg:'#dcfce7', border:'#86efac' },
  { value:'dirty',     label:'מלוכלך',   color:'#92400e', bg:'#fffbeb', border:'#fcd34d' },
  { value:'inspected', label:'נבדק ★',   color:'#1e40af', bg:'#eff6ff', border:'#93c5fd' },
  { value:'pickup',    label:'Pickup',   color:'#854d0e', bg:'#fef9c3', border:'#fde047' },
];

const OPS_ACTIONS = [
  { value:'available', label:'זמין',     color:'#166534', bg:'#dcfce7', border:'#86efac' },
  { value:'ooo',       label:'OOO',      color:'#dc2626', bg:'#fee2e2', border:'#fca5a5' },
  { value:'hold',      label:'HOLD',     color:'#7c3aed', bg:'#f3e8ff', border:'#d8b4fe' },
];

// ── Room card popup ───────────────────────────────────────────────────────────
function RoomPopup({ room, propertyId, onClose, onChanged, toast }) {
  const [loading, setLoading] = useState(null);

  async function setClean(status) {
    if (status === room.cleanStatus) return;
    setLoading(`clean_${status}`);
    try {
      await roomsApi.setClean(String(room._id), status, propertyId);
      toast('success', `חדר ${room.number} — ${CLEAN_CONFIG[status]?.label}`);
      onChanged();
    } catch (e) { toast('error', e.message); }
    finally { setLoading(null); }
  }

  async function setOps(status) {
    if (status === room.opsStatus) return;
    setLoading(`ops_${status}`);
    try {
      await roomsApi.setOps(String(room._id), status, status !== 'available' ? `${status} — ידני` : '', propertyId);
      toast('success', `חדר ${room.number} — ${OPS_ACTIONS.find(o=>o.value===status)?.label}`);
      onChanged();
    } catch (e) { toast('error', e.message); }
    finally { setLoading(null); }
  }

  const clean = CLEAN_CONFIG[room.cleanStatus] || CLEAN_CONFIG.dirty;
  const occ   = OCC_CONFIG[room.occStatus]     || OCC_CONFIG.vacant;
  const ops   = OPS_CONFIG[room.opsStatus];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.45)', backdropFilter:'blur(3px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-72 overflow-hidden animate-fade-in" style={{ direction:'rtl' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-xl text-num"
              style={{ background:'rgba(99,102,241,0.1)', color:'#6366f1' }}>
              {room.number}
            </div>
            <div>
              <div className="font-bold text-ink text-sm">{room.roomType?.name}</div>
              <div className="text-xs text-ink-muted">קומה {room.floor} · {occ.label}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {/* Clean status */}
          <div>
            <div className="text-xs font-semibold text-ink-secondary mb-2 flex items-center gap-1.5">
              <Sparkles size={11} /> סטטוס ניקיון
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {CLEAN_ACTIONS.map(a => (
                <button
                  key={a.value}
                  disabled={!!loading}
                  onClick={() => setClean(a.value)}
                  className="text-xs px-2 py-1.5 rounded-lg border font-semibold transition-all"
                  style={{
                    background: room.cleanStatus === a.value ? a.bg : 'white',
                    border: `1px solid ${room.cleanStatus === a.value ? a.border : '#e2e8f0'}`,
                    color: room.cleanStatus === a.value ? a.color : '#64748b',
                    opacity: loading === `clean_${a.value}` ? 0.6 : 1,
                  }}
                >
                  {loading === `clean_${a.value}` ? '...' : a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Ops status */}
          <div>
            <div className="text-xs font-semibold text-ink-secondary mb-2 flex items-center gap-1.5">
              <Wrench size={11} /> סטטוס תפעולי
            </div>
            <div className="flex gap-1.5">
              {OPS_ACTIONS.map(a => (
                <button
                  key={a.value}
                  disabled={!!loading}
                  onClick={() => setOps(a.value)}
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg border font-semibold transition-all"
                  style={{
                    background: room.opsStatus === a.value ? a.bg : 'white',
                    border: `1px solid ${room.opsStatus === a.value ? a.border : '#e2e8f0'}`,
                    color: room.opsStatus === a.value ? a.color : '#64748b',
                    opacity: loading === `ops_${a.value}` ? 0.6 : 1,
                  }}
                >
                  {loading === `ops_${a.value}` ? '...' : a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Room card ─────────────────────────────────────────────────────────────────
function RoomCard({ room, onClick }) {
  const clean = CLEAN_CONFIG[room.cleanStatus] || CLEAN_CONFIG.dirty;
  const occ   = OCC_CONFIG[room.occStatus]     || OCC_CONFIG.vacant;
  const ops   = OPS_CONFIG[room.opsStatus];

  const isOccupied  = room.occStatus === 'occupied';
  const isDeparture = room.occStatus === 'departure';
  const isOoo       = room.opsStatus === 'ooo';
  const isHold      = room.opsStatus === 'hold';

  return (
    <button
      onClick={onClick}
      className="relative flex flex-col gap-1.5 p-3 rounded-xl border text-right transition-all hover:shadow-card hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
      style={{
        background: isOoo ? 'rgba(239,68,68,0.05)' : isHold ? 'rgba(168,85,247,0.05)' : clean.bg,
        borderColor: isOoo ? '#fca5a5' : isHold ? '#d8b4fe' : clean.border,
      }}
    >
      {/* Room number + VIP */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {room.isVip && <Crown size={9} className="text-yellow-500" />}
          {(isOoo || isHold) && (
            <span className="text-xs font-bold" style={{ color: isOoo ? '#dc2626' : '#7c3aed' }}>
              {isOoo ? 'OOO' : 'HOLD'}
            </span>
          )}
        </div>
        <span className="font-black text-num text-lg" style={{ color: clean.text }}>{room.number}</span>
      </div>

      {/* Room type */}
      <div className="text-xs text-ink-muted leading-tight truncate">{room.roomType?.name}</div>

      {/* Status dot + label */}
      <div className="flex items-center gap-1 mt-0.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: clean.dot }} />
        <span className="text-xs font-medium" style={{ color: clean.text }}>{clean.label}</span>
      </div>

      {/* Occ badge */}
      {(isOccupied || isDeparture) && (
        <div className="flex items-center gap-1 text-xs font-semibold"
          style={{ color: occ.color }}>
          <Users size={9} />
          {occ.label}
        </div>
      )}
    </button>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function RoomsPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, toast } = useToast();

  const [filterClean, setFilterClean] = useState('all');
  const [filterFloor, setFilterFloor] = useState('all');
  const [selected,    setSelected]    = useState(null);

  const { data, loading, error, refetch } = useApi(
    () => roomsApi.list(propertyId),
    [propertyId], skip
  );

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const allRooms = data || [];
  const floors   = [...new Set(allRooms.map(r => r.floor))].sort((a, b) => a - b);

  const filtered = allRooms.filter(r => {
    if (filterFloor !== 'all' && r.floor !== Number(filterFloor)) return false;
    if (filterClean !== 'all') {
      if (filterClean === 'ooo')  return r.opsStatus === 'ooo';
      if (filterClean === 'hold') return r.opsStatus === 'hold';
      return r.cleanStatus === filterClean;
    }
    return true;
  });

  // Stats
  const counts = {
    clean:     allRooms.filter(r => r.cleanStatus === 'clean').length,
    dirty:     allRooms.filter(r => r.cleanStatus === 'dirty').length,
    inspected: allRooms.filter(r => r.cleanStatus === 'inspected').length,
    occupied:  allRooms.filter(r => r.occStatus === 'occupied').length,
    ooo:       allRooms.filter(r => r.opsStatus === 'ooo').length,
  };

  // Group by floor
  const byFloor = {};
  filtered.forEach(r => {
    if (!byFloor[r.floor]) byFloor[r.floor] = [];
    byFloor[r.floor].push(r);
  });

  const selectedRoom = allRooms.find(r => String(r._id) === selected);

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />
      {selectedRoom && (
        <RoomPopup
          room={selectedRoom}
          propertyId={propertyId}
          onClose={() => setSelected(null)}
          onChanged={() => { setSelected(null); refetch(); }}
          toast={(type, msg) => { toast(msg, type); }}
        />
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">סטטוס חדרים</div>
          <div className="page-subtitle">לוח מצב — ניקיון ותפעול</div>
        </div>
        <div className="flex items-center gap-2">
          <select className="select text-xs" value={filterFloor} onChange={e => setFilterFloor(e.target.value)}>
            <option value="all">כל הקומות</option>
            {floors.map(f => <option key={f} value={f}>קומה {f}</option>)}
          </select>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-5 gap-2 mb-5">
        {[
          { key:'all',      label:'הכל',         value: allRooms.length, color:'#6366f1', bg:'rgba(99,102,241,0.1)' },
          { key:'clean',    label:'נקי',          value: counts.clean,     color:'#22c55e', bg:'#f0fdf4' },
          { key:'dirty',    label:'מלוכלך',       value: counts.dirty,     color:'#f59e0b', bg:'#fffbeb' },
          { key:'inspected',label:'נבדק',         value: counts.inspected, color:'#3b82f6', bg:'#eff6ff' },
          { key:'ooo',      label:'OOO/HOLD',     value: counts.ooo,       color:'#dc2626', bg:'#fee2e2', urgent: counts.ooo > 0 },
        ].map(({ key, label, value, color, bg, urgent }) => (
          <button
            key={key}
            onClick={() => setFilterClean(key)}
            className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-center transition-all ${
              filterClean === key ? 'shadow-card' : 'hover:border-surface-border'
            } ${urgent ? 'border-red-200' : ''}`}
            style={{
              background: filterClean === key ? bg : 'white',
              borderColor: filterClean === key ? color : undefined,
            }}
          >
            <div className="text-2xl font-black text-num" style={{ color }}>{value}</div>
            <div className="text-xs font-medium text-ink-secondary">{label}</div>
          </button>
        ))}
      </div>

      {/* Room grid by floor */}
      {Object.entries(byFloor)
        .sort(([a],[b]) => Number(a) - Number(b))
        .map(([floor, rooms]) => (
          <div key={floor} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-ink">קומה {floor}</span>
              <span className="text-xs text-ink-muted bg-surface-hover px-2 py-0.5 rounded-full">{rooms.length} חדרים</span>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
              {rooms.map(room => (
                <RoomCard
                  key={String(room._id)}
                  room={room}
                  onClick={() => setSelected(String(room._id))}
                />
              ))}
            </div>
          </div>
        ))
      }

      {filtered.length === 0 && (
        <div className="empty-state mt-8">
          <BedDouble size={32} className="empty-state-icon" />
          <span>אין חדרים להצגה</span>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4 text-xs text-ink-muted items-center">
        {Object.entries(CLEAN_CONFIG).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: v.dot }} />
            {v.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 mr-2">
          <span className="text-red-500 font-bold text-xs">OOO</span> = Out of Order
        </span>
      </div>
    </div>
  );
}
