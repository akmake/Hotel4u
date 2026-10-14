import { useState, useMemo, useRef, useCallback } from 'react';
import {
  BedDouble, Plus, Search, X, Sparkles, Wrench, Users, Crown,
  Pencil, Trash2, CheckCircle2, AlertTriangle, ChevronDown,
  Cigarette, Accessibility, Star, RefreshCw, Filter,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { rooms as roomsApi, roomTypes as rtApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

/* ── status configs ──────────────────────────────────────────────────────── */
const CLEAN_CFG = {
  clean:     { label:'נקי',    bg:'#f0fdf4', border:'#86efac', dot:'#22c55e', text:'#166534' },
  dirty:     { label:'מלוכלך', bg:'#fffbeb', border:'#fcd34d', dot:'#f59e0b', text:'#92400e' },
  inspected: { label:'נבדק',   bg:'#eff6ff', border:'#93c5fd', dot:'#3b82f6', text:'#1e40af' },
  pickup:    { label:'Pickup', bg:'#fef9c3', border:'#fde047', dot:'#eab308', text:'#854d0e' },
};
const OCC_CFG = {
  vacant:    { label:'פנוי',    color:'#64748b' },
  occupied:  { label:'מאוכלס', color:'#2563eb' },
  departure: { label:'יציאה',  color:'#ea580c' },
  due_in:    { label:'הגעה',   color:'#7c3aed' },
};
const OPS_CFG = {
  out_of_order:     { label:'OOO',  bg:'rgba(239,68,68,0.1)',   border:'#fca5a5', text:'#dc2626' },
  maintenance_hold: { label:'HOLD', bg:'rgba(168,85,247,0.1)',  border:'#d8b4fe', text:'#7c3aed' },
  out_of_service:   { label:'OOS',  bg:'rgba(251,191,36,0.15)', border:'#fcd34d', text:'#b45309' },
  internal_use:     { label:'INT',  bg:'rgba(103,232,249,0.18)',border:'#67e8f9', text:'#0e7490' },
};

const CLEAN_ACTIONS = [
  { value:'clean',     label:'נקי ✓',  color:'#166534', bg:'#dcfce7', border:'#86efac' },
  { value:'dirty',     label:'מלוכלך', color:'#92400e', bg:'#fffbeb', border:'#fcd34d' },
  { value:'pickup',    label:'Pickup', color:'#854d0e', bg:'#fef9c3', border:'#fde047' },
];
const OPS_ACTIONS = [
  { value:'available',        label:'זמין', color:'#166534', bg:'#dcfce7', border:'#86efac' },
  { value:'out_of_order',     label:'OOO',  color:'#dc2626', bg:'#fee2e2', border:'#fca5a5' },
  { value:'maintenance_hold', label:'HOLD', color:'#7c3aed', bg:'#f3e8ff', border:'#d8b4fe' },
  { value:'out_of_service',   label:'OOS',  color:'#b45309', bg:'#fef3c7', border:'#fcd34d' },
  { value:'internal_use',     label:'INT',  color:'#0e7490', bg:'#cffafe', border:'#67e8f9' },
];

const isBlocked = s => ['out_of_order','maintenance_hold','out_of_service','internal_use','ooo','hold'].includes(s);

/* ── create/edit room modal ──────────────────────────────────────────────── */
function RoomModal({ propertyId, room, roomTypes, onClose, onSaved }) {
  const isEdit = !!room;
  const [form, setForm] = useState({
    number:          room?.number || '',
    floor:           room?.floor ?? '',
    roomTypeId:      room?.roomType?._id ? String(room.roomType._id) : (roomTypes[0]?._id ? String(roomTypes[0]._id) : ''),
    building:        room?.building || '',
    wing:            room?.wing || '',
    housekeepingZone:room?.housekeepingZone || '',
    isVip:           room?.isVip || false,
    isSmoking:       room?.isSmoking || false,
    isAccessible:           room?.isAccessible || false,
    accessibilityFeatures:  room?.accessibilityFeatures || [],
    internalNotes:   room?.internalNotes || '',
    lastRenovatedAt: room?.lastRenovatedAt ? room.lastRenovatedAt.slice(0, 10) : '',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    if (!form.number || form.floor === '') { setError('מספר חדר וקומה חובה'); return; }
    setError('');
    setLoading(true);
    try {
      const payload = {
        ...form,
        floor: Number(form.floor),
        lastRenovatedAt: form.lastRenovatedAt || undefined,
      };
      if (isEdit) {
        const { roomTypeId, ...rest } = payload;
        await roomsApi.update(room._id, { ...rest, roomType: roomTypeId });
      } else {
        await roomsApi.create({ propertyId, ...payload });
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'שגיאה');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in" style={{ direction:'rtl' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div>
            <div className="font-bold text-ink">{isEdit ? `עריכת חדר ${room.number}` : 'חדר חדש'}</div>
            <div className="text-xs text-ink-muted">{isEdit ? 'עדכון פרטי חדר' : 'הוספת חדר למלון'}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={submit}>
          <div className="px-6 py-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
            {/* basic */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1">מספר חדר *</label>
                <input className="input w-full text-num font-bold" value={form.number}
                  onChange={e => set('number', e.target.value)} required placeholder="101" />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1">קומה *</label>
                <input type="number" className="input w-full text-num" value={form.floor}
                  onChange={e => set('floor', e.target.value)} required min={0} max={99} placeholder="1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1">אגף / כנף</label>
                <input className="input w-full" value={form.wing}
                  onChange={e => set('wing', e.target.value)} placeholder="A" />
              </div>
            </div>

            {/* room type */}
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">סוג חדר *</label>
              <div className="grid grid-cols-2 gap-2">
                {roomTypes.map(rt => (
                  <button key={String(rt._id)} type="button"
                    onClick={() => set('roomTypeId', String(rt._id))}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-right transition-all text-sm
                      ${form.roomTypeId === String(rt._id) ? 'border-brand bg-brand/5 shadow-sm' : 'border-surface-border hover:border-brand/30'}`}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${form.roomTypeId === String(rt._id) ? 'bg-brand' : 'bg-surface-border'}`} />
                    <div>
                      <div className="font-semibold text-ink text-xs">{rt.name}</div>
                      <div className="text-xs text-ink-muted">₪{rt.baseRate}/לילה</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* extra */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1">בניין</label>
                <input className="input w-full" value={form.building}
                  onChange={e => set('building', e.target.value)} placeholder="Main" />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1">אזור חדרנות</label>
                <input className="input w-full" value={form.housekeepingZone}
                  onChange={e => set('housekeepingZone', e.target.value)} placeholder="North" />
              </div>
            </div>

            {/* flags */}
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-2">תכונות</label>
              <div className="flex gap-3 flex-wrap">
                {[
                  { key:'isVip',       Icon: Star,          label:'VIP',      color:'text-amber-500' },
                  { key:'isSmoking',   Icon: Cigarette,     label:'מעשנים',   color:'text-gray-500'  },
                  { key:'isAccessible',Icon: Accessibility, label:'נגיש',     color:'text-blue-500'  },
                ].map(({ key, Icon, label, color }) => (
                  <label key={key} className={`flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border transition-all
                    ${form[key] ? 'border-brand bg-brand/5' : 'border-surface-border hover:border-brand/20'}`}>
                    <input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} className="hidden" />
                    <Icon size={14} className={form[key] ? 'text-brand' : color} />
                    <span className="text-xs font-medium text-ink-secondary">{label}</span>
                    {form[key] && <CheckCircle2 size={12} className="text-brand" />}
                  </label>
                ))}
              </div>
            </div>

            {/* accessibility detail — shown only when isAccessible is checked */}
            {form.isAccessible && (
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-2">תכונות נגישות מפורטות</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key:'wheelchair_accessible', label:'נגיש לכיסא גלגלים' },
                    { key:'roll_in_shower',         label:'מקלחת נגישה' },
                    { key:'grab_bars',              label:'מוטות אחיזה' },
                    { key:'lowered_bed',            label:'מיטה נמוכה' },
                    { key:'lowered_switches',       label:'מתגים בגובה נגיש' },
                    { key:'visual_fire_alarm',      label:'אזעקת אש חזותית' },
                    { key:'hearing_loop',           label:'לולאת השראה' },
                    { key:'wide_doorway',           label:'פתח רחב' },
                    { key:'elevator_access',        label:'גישה במעלית' },
                    { key:'accessible_bathroom',    label:'שירותים נגישים' },
                    { key:'braille_signage',        label:'שלטים בברייל' },
                    { key:'pool_lift',              label:'מעלית לבריכה' },
                  ].map(({ key, label }) => {
                    const checked = form.accessibilityFeatures.includes(key);
                    return (
                      <label key={key} className={`flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg border text-xs transition-all
                        ${checked ? 'border-blue-400 bg-blue-50' : 'border-surface-border hover:border-blue-300'}`}>
                        <input type="checkbox" checked={checked}
                          onChange={e => {
                            const arr = form.accessibilityFeatures;
                            set('accessibilityFeatures', e.target.checked ? [...arr, key] : arr.filter(k => k !== key));
                          }}
                          className="hidden" />
                        <span className={`font-medium ${checked ? 'text-blue-700' : 'text-ink-secondary'}`}>{label}</span>
                        {checked && <CheckCircle2 size={11} className="text-blue-500 mr-auto" />}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* renovation + notes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1">שיפוץ אחרון</label>
                <input type="date" className="input w-full text-sm" value={form.lastRenovatedAt}
                  onChange={e => set('lastRenovatedAt', e.target.value)} />
              </div>
              <div className="col-span-1 row-span-1">
                <label className="text-xs font-semibold text-ink-secondary block mb-1">הערות פנימיות</label>
                <textarea className="input w-full resize-none text-sm" rows={2}
                  value={form.internalNotes} onChange={e => set('internalNotes', e.target.value)}
                  placeholder="הערות לצוות..." />
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}
          </div>

          <div className="flex gap-2 px-6 py-4 border-t border-surface-border bg-surface-hover">
            <button type="button" className="btn btn-secondary flex-1 justify-center" onClick={onClose}>ביטול</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 justify-center gap-2">
              {loading && <Spinner size={14} />}
              {isEdit ? 'שמור שינויים' : 'צור חדר'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── room popup (status + actions) ──────────────────────────────────────── */
function RoomPopup({ room, propertyId, onClose, onEdit, onDeactivate, onChanged, toastFn }) {
  const [loading, setLoading] = useState(null);

  async function setClean(status) {
    if (status === room.cleanStatus) return;
    setLoading(`c_${status}`);
    try {
      await roomsApi.setClean(String(room._id), status, propertyId);
      toastFn('success', `חדר ${room.number} — ${CLEAN_CFG[status]?.label}`);
      onChanged();
    } catch (e) { toastFn('error', e.message); }
    finally { setLoading(null); }
  }

  async function setOps(status) {
    if (status === room.opsStatus) return;
    setLoading(`o_${status}`);
    try {
      const reason = status !== 'available' ? `${status} — ידני` : '';
      await roomsApi.setOps(String(room._id), status, reason, propertyId);
      toastFn('success', `חדר ${room.number} — ${OPS_ACTIONS.find(a=>a.value===status)?.label}`);
      onChanged();
    } catch (e) { toastFn('error', e.message); }
    finally { setLoading(null); }
  }

  const clean = CLEAN_CFG[room.cleanStatus] || CLEAN_CFG.dirty;
  const occ   = OCC_CFG[room.occStatus]     || OCC_CFG.vacant;
  const opsLabel = OPS_CFG[room.opsStatus]?.label;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background:'rgba(0,0,0,0.45)', backdropFilter:'blur(3px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-80 overflow-hidden animate-fade-in" style={{ direction:'rtl' }}>
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-2xl text-num"
              style={{ background:'rgba(99,102,241,0.1)', color:'#6366f1' }}>
              {room.number}
            </div>
            <div>
              <div className="font-bold text-ink text-sm">{room.roomType?.name}</div>
              <div className="text-xs text-ink-muted flex items-center gap-1.5">
                קומה {room.floor}
                <span className="text-ink-faint">·</span>
                <span style={{ color: occ.color }}>{occ.label}</span>
                {opsLabel && <span className="badge badge-dirty text-xs">{opsLabel}</span>}
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {/* attributes */}
          {(room.isVip || room.isSmoking || room.isAccessible) && (
            <div className="flex gap-1.5 flex-wrap">
              {room.isVip       && <span className="badge badge-inhouse flex items-center gap-1"><Star size={10}/>VIP</span>}
              {room.isSmoking   && <span className="badge badge-pending flex items-center gap-1"><Cigarette size={10}/>מעשנים</span>}
              {room.isAccessible && <span className="badge badge-clean flex items-center gap-1"><Accessibility size={10}/>נגיש</span>}
            </div>
          )}

          {/* notes */}
          {room.internalNotes && (
            <div className="text-xs text-ink-secondary bg-surface-hover rounded-lg px-3 py-2">
              📌 {room.internalNotes}
            </div>
          )}

          {/* clean status */}
          <div>
            <div className="text-xs font-semibold text-ink-secondary mb-1.5 flex items-center gap-1">
              <Sparkles size={11} /> ניקיון
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {CLEAN_ACTIONS.map(a => (
                <button key={a.value} disabled={!!loading} onClick={() => setClean(a.value)}
                  className="text-xs px-2 py-1.5 rounded-lg border font-semibold transition-all"
                  style={{
                    background: room.cleanStatus === a.value ? a.bg : 'white',
                    borderColor: room.cleanStatus === a.value ? a.border : '#e2e8f0',
                    color: room.cleanStatus === a.value ? a.color : '#64748b',
                    opacity: loading === `c_${a.value}` ? 0.5 : 1,
                  }}>
                  {loading === `c_${a.value}` ? '...' : a.label}
                </button>
              ))}
            </div>
          </div>

          {/* ops status */}
          <div>
            <div className="text-xs font-semibold text-ink-secondary mb-1.5 flex items-center gap-1">
              <Wrench size={11} /> תפעול
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {OPS_ACTIONS.map(a => (
                <button key={a.value} disabled={!!loading} onClick={() => setOps(a.value)}
                  className="flex-1 min-w-fit text-xs px-2 py-1.5 rounded-lg border font-semibold transition-all"
                  style={{
                    background: room.opsStatus === a.value ? a.bg : 'white',
                    borderColor: room.opsStatus === a.value ? a.border : '#e2e8f0',
                    color: room.opsStatus === a.value ? a.color : '#64748b',
                    opacity: loading === `o_${a.value}` ? 0.5 : 1,
                  }}>
                  {loading === `o_${a.value}` ? '...' : a.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* footer actions */}
        <div className="flex gap-2 px-4 py-3 border-t border-surface-border">
          <button className="btn btn-secondary btn-sm flex-1 justify-center gap-1.5 flex" onClick={onEdit}>
            <Pencil size={13} /> עריכה
          </button>
          <button
            onClick={() => { if (confirm(`להשבית חדר ${room.number}?`)) onDeactivate(); }}
            className="btn btn-sm flex items-center gap-1 text-red-500 hover:bg-red-50 border border-surface-border px-2">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── room card ───────────────────────────────────────────────────────────── */
function RoomCard({ room, onClick, selected }) {
  const clean   = CLEAN_CFG[room.cleanStatus] || CLEAN_CFG.dirty;
  const isOcc   = room.occStatus === 'occupied';
  const isDep   = room.occStatus === 'due_out' || room.occStatus === 'departure';
  const isDueIn = room.occStatus === 'due_in';
  const blocked = isBlocked(room.opsStatus);
  const opsInfo = OPS_CFG[room.opsStatus];

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col gap-1 p-2.5 rounded-xl border text-right transition-all
        hover:shadow-card hover:scale-[1.03] active:scale-[0.98]
        ${selected ? 'ring-2 ring-brand' : ''}
      `}
      style={{
        background: blocked ? opsInfo?.bg : clean.bg,
        borderColor: blocked ? opsInfo?.border : clean.border,
      }}
    >
      {/* number + flags */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          {room.isVip       && <Star size={8} className="text-amber-500" />}
          {room.isAccessible && <Accessibility size={8} className="text-blue-500" />}
          {room.isSmoking   && <Cigarette size={8} className="text-gray-400" />}
        </div>
        <span className="font-black text-num text-base" style={{ color: blocked ? opsInfo?.text : clean.text }}>
          {room.number}
        </span>
      </div>

      {/* type */}
      <div className="text-xs text-ink-faint leading-tight truncate">{room.roomType?.code || '—'}</div>

      {/* status indicator */}
      {blocked ? (
        <div className="text-xs font-bold" style={{ color: opsInfo?.text }}>{opsInfo?.label}</div>
      ) : (
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: clean.dot }} />
          <span className="text-xs font-medium" style={{ color: clean.text }}>{clean.label}</span>
        </div>
      )}

      {/* occupancy dot */}
      {(isOcc || isDep || isDueIn) && (
        <div className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full"
          style={{ background: isDep ? '#ea580c' : isDueIn ? '#7c3aed' : '#2563eb' }}
          title={isDep ? 'יציאה' : isDueIn ? 'הגעה' : 'מאוכלס'} />
      )}
    </button>
  );
}

/* ── bulk action bar ─────────────────────────────────────────────────────── */
function BulkBar({ count, propertyId, roomIds, onDone }) {
  const [loading, setLoading] = useState(false);

  async function bulkClean(status) {
    setLoading(true);
    try {
      await Promise.all(roomIds.map(id => roomsApi.setClean(id, status, propertyId)));
      onDone(`${count} חדרים עודכנו לסטטוס ${CLEAN_CFG[status]?.label}`);
    } catch (e) { onDone(null, e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-brand/5 border border-brand/20 rounded-xl mb-3 animate-fade-in">
      <span className="text-sm font-semibold text-brand">{count} חדרים נבחרו</span>
      <div className="flex gap-2 flex-wrap">
        {CLEAN_ACTIONS.map(a => (
          <button key={a.value} disabled={loading} onClick={() => bulkClean(a.value)}
            className="text-xs px-3 py-1.5 rounded-lg border font-medium transition-all hover:shadow-sm"
            style={{ background: a.bg, borderColor: a.border, color: a.color }}>
            {a.label}
          </button>
        ))}
      </div>
      {loading && <Spinner size={14} />}
    </div>
  );
}

/* ── main page ───────────────────────────────────────────────────────────── */
export default function RoomsPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, toast, success: toastSuccess, error: toastError } = useToast();

  /* filters */
  const [search,       setSearch]       = useState('');
  const [filterClean,  setFilterClean]  = useState('all');
  const [filterType,   setFilterType]   = useState('all');
  const [filterFloor,  setFilterFloor]  = useState('all');
  const [filterOps,    setFilterOps]    = useState('all');
  const [groupByFloor, setGroupByFloor] = useState(true);
  const debRef = useRef(null);

  /* modal state */
  const [popup,     setPopup]     = useState(null); // room id → popup
  const [editRoom,  setEditRoom]  = useState(null); // room obj → modal
  const [showNew,   setShowNew]   = useState(false);

  /* bulk select */
  const [selected, setSelected] = useState(new Set());
  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /* data */
  const { data: roomData, loading, error, refetch } = useApi(
    () => roomsApi.list(propertyId), [propertyId], skip
  );
  const { data: rtData } = useApi(
    () => rtApi.list(propertyId), [propertyId], skip
  );

  const allRooms = useMemo(() => roomData || [], [roomData]);
  const roomTypes = useMemo(() => rtData || [], [rtData]);

  /* floors + types for filter dropdowns */
  const floors    = useMemo(() => [...new Set(allRooms.map(r => r.floor))].sort((a,b)=>a-b), [allRooms]);
  const typeNames = useMemo(() => [...new Set(allRooms.map(r => r.roomType?.name).filter(Boolean))].sort(), [allRooms]);

  /* stats */
  const stats = useMemo(() => ({
    total:     allRooms.length,
    clean:     allRooms.filter(r => r.cleanStatus === 'clean').length,
    dirty:     allRooms.filter(r => r.cleanStatus === 'dirty').length,
    inspected: allRooms.filter(r => r.cleanStatus === 'inspected').length,
    occupied:  allRooms.filter(r => r.occStatus === 'occupied').length,
    blocked:   allRooms.filter(r => isBlocked(r.opsStatus)).length,
  }), [allRooms]);

  /* filtered rooms */
  const filtered = useMemo(() => {
    let list = allRooms;
    if (search)             list = list.filter(r => r.number.toLowerCase().includes(search.toLowerCase()) || r.roomType?.name?.toLowerCase().includes(search.toLowerCase()));
    if (filterClean !== 'all') {
      if (filterClean === 'blocked') list = list.filter(r => isBlocked(r.opsStatus));
      else                            list = list.filter(r => r.cleanStatus === filterClean && !isBlocked(r.opsStatus));
    }
    if (filterType  !== 'all') list = list.filter(r => r.roomType?.name === filterType);
    if (filterFloor !== 'all') list = list.filter(r => r.floor === Number(filterFloor));
    if (filterOps   !== 'all') list = list.filter(r => r.opsStatus === filterOps);
    return list;
  }, [allRooms, search, filterClean, filterType, filterFloor, filterOps]);

  /* group by floor */
  const byFloor = useMemo(() => {
    const map = {};
    filtered.forEach(r => { if (!map[r.floor]) map[r.floor] = []; map[r.floor].push(r); });
    return Object.entries(map).sort(([a],[b]) => Number(a)-Number(b));
  }, [filtered]);

  /* deactivate */
  async function deactivate(room) {
    try {
      await roomsApi.update(room._id, { active: false });
      toastSuccess(`חדר ${room.number} הושבת`);
      setPopup(null); refetch();
    } catch (e) { toastError(e.message); }
  }

  const hasFilters = filterClean !== 'all' || filterType !== 'all' || filterFloor !== 'all' || filterOps !== 'all' || search;
  const clearFilters = () => { setFilterClean('all'); setFilterType('all'); setFilterFloor('all'); setFilterOps('all'); setSearch(''); };

  if (skip || loading) return <PageSpinner />;
  if (error)           return <ErrorState message={error} onRetry={refetch} />;

  const popupRoom    = popup     ? allRooms.find(r => String(r._id) === popup) : null;
  const editRoomData = editRoom  ? allRooms.find(r => String(r._id) === editRoom) : null;

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      {/* ─── modals ─── */}
      {(showNew || editRoomData) && (
        <RoomModal
          propertyId={propertyId}
          room={editRoomData || undefined}
          roomTypes={roomTypes}
          onClose={() => { setShowNew(false); setEditRoom(null); }}
          onSaved={() => {
            toastSuccess(editRoomData ? `חדר עודכן` : 'חדר נוצר');
            setShowNew(false); setEditRoom(null); refetch();
          }}
        />
      )}
      {popupRoom && (
        <RoomPopup
          room={popupRoom}
          propertyId={propertyId}
          onClose={() => setPopup(null)}
          onEdit={() => { setPopup(null); setEditRoom(String(popupRoom._id)); }}
          onDeactivate={() => deactivate(popupRoom)}
          onChanged={() => { setPopup(null); refetch(); }}
          toastFn={(type, msg) => type === 'success' ? toastSuccess(msg) : toastError(msg)}
        />
      )}

      {/* ─── header ─── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">סטטוס חדרים</h1>
          <p className="page-subtitle">לוח מצב — {allRooms.length} חדרים</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setGroupByFloor(v => !v)}
            className={`btn btn-secondary flex items-center gap-1.5 ${groupByFloor ? 'ring-2 ring-brand/30' : ''}`}>
            <Filter size={14} /> {groupByFloor ? 'לפי קומה' : 'רשימה'}
          </button>
          <button onClick={refetch} className="btn btn-ghost btn-icon"><RefreshCw size={15} /></button>
          <button onClick={() => setShowNew(true)} className="btn btn-primary flex items-center gap-2">
            <Plus size={15} /> חדר חדש
          </button>
        </div>
      </div>

      {/* ─── stat chips ─── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        {[
          { key:'all',     label:'הכל',     value: stats.total,    color:'#6366f1', bg:'rgba(99,102,241,0.1)' },
          { key:'clean',   label:'נקי',     value: stats.clean,    color:'#22c55e', bg:'#f0fdf4' },
          { key:'dirty',   label:'מלוכלך',  value: stats.dirty,    color:'#f59e0b', bg:'#fffbeb' },
          { key:'inspected',label:'נבדק',   value: stats.inspected,color:'#3b82f6', bg:'#eff6ff' },
          { key:'occupied', label:'מאוכלס', value: stats.occupied, color:'#7c3aed', bg:'rgba(124,58,237,0.1)' },
          { key:'blocked',  label:'חסום',   value: stats.blocked,  color:'#dc2626', bg:'#fee2e2', urgent: stats.blocked > 0 },
        ].map(({ key, label, value, color, bg, urgent }) => (
          <button key={key} onClick={() => setFilterClean(key)}
            className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-center transition-all
              ${filterClean === key ? 'shadow-card ring-2' : 'hover:border-brand/20'}
              ${urgent ? 'border-red-200' : 'border-surface-border'}
            `}
            style={{
              background: filterClean === key ? bg : 'white',
              ringColor: filterClean === key ? color : undefined,
            }}>
            <div className="text-2xl font-black text-num" style={{ color }}>{value}</div>
            <div className="text-xs font-medium text-ink-secondary">{label}</div>
          </button>
        ))}
      </div>

      {/* ─── filters row ─── */}
      <div className="card p-3 flex flex-wrap gap-2 items-center mb-3">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input pr-8 w-full text-sm" placeholder="חיפוש לפי מספר..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="select text-sm py-1" value={filterFloor} onChange={e => setFilterFloor(e.target.value)}>
          <option value="all">כל הקומות</option>
          {floors.map(f => <option key={f} value={f}>קומה {f}</option>)}
        </select>
        <select className="select text-sm py-1" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">כל הסוגים</option>
          {typeNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select className="select text-sm py-1" value={filterOps} onChange={e => setFilterOps(e.target.value)}>
          <option value="all">כל הסטטוסים</option>
          <option value="available">זמין</option>
          <option value="out_of_order">OOO</option>
          <option value="maintenance_hold">HOLD</option>
          <option value="out_of_service">OOS</option>
          <option value="internal_use">Internal</option>
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="btn btn-ghost btn-sm flex items-center gap-1 text-red-500">
            <X size={13} /> נקה
          </button>
        )}
        <span className="text-xs text-ink-muted mr-auto">{filtered.length} חדרים</span>
      </div>

      {/* ─── bulk bar ─── */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          propertyId={propertyId}
          roomIds={[...selected]}
          onDone={(msg, err) => {
            if (err) toastError(err); else toastSuccess(msg);
            setSelected(new Set()); refetch();
          }}
        />
      )}

      {/* ─── room grid ─── */}
      {filtered.length === 0 ? (
        <div className="empty-state mt-10">
          <BedDouble size={36} className="empty-state-icon" />
          <p className="text-ink-secondary">אין חדרים להצגה</p>
          {hasFilters && <button onClick={clearFilters} className="btn btn-secondary btn-sm mt-2">נקה מסננים</button>}
        </div>
      ) : groupByFloor ? (
        byFloor.map(([floor, rooms]) => (
          <div key={floor} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold text-ink">קומה {floor}</span>
              <span className="text-xs text-ink-muted bg-surface-hover px-2 py-0.5 rounded-full">{rooms.length} חדרים</span>
              <button className="text-xs text-brand hover:underline mr-1"
                onClick={() => {
                  const floorIds = rooms.map(r => String(r._id));
                  setSelected(prev => {
                    const next = new Set(prev);
                    const allSelected = floorIds.every(id => next.has(id));
                    floorIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
                    return next;
                  });
                }}>
                בחר קומה
              </button>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
              {rooms.map(room => (
                <div key={String(room._id)} className="relative group">
                  <RoomCard
                    room={room}
                    selected={selected.has(String(room._id))}
                    onClick={() => setPopup(String(room._id))}
                  />
                  <button
                    onClick={e => toggleSelect(String(room._id), e)}
                    className="absolute top-1 right-1 w-4 h-4 rounded-full border-2 border-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: selected.has(String(room._id)) ? '#6366f1' : 'rgba(255,255,255,0.85)' }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        /* flat list view */
        <div className="card overflow-auto">
          <table className="data-table w-full">
            <thead>
              <tr className="text-xs text-ink-muted">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={e => setSelected(e.target.checked ? new Set(filtered.map(r=>String(r._id))) : new Set())}
                  />
                </th>
                <th className="px-3 py-2 text-right">מספר</th>
                <th className="px-3 py-2 text-right">קומה</th>
                <th className="px-3 py-2 text-right">סוג</th>
                <th className="px-3 py-2 text-right">ניקיון</th>
                <th className="px-3 py-2 text-right">תפוסה</th>
                <th className="px-3 py-2 text-right">תפעול</th>
                <th className="px-3 py-2 text-right">תכונות</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(room => {
                const clean   = CLEAN_CFG[room.cleanStatus] || CLEAN_CFG.dirty;
                const occ     = OCC_CFG[room.occStatus]     || OCC_CFG.vacant;
                const opsInfo = OPS_CFG[room.opsStatus];
                return (
                  <tr key={String(room._id)}
                    className="hover:bg-surface-hover transition-colors cursor-pointer"
                    onClick={() => setPopup(String(room._id))}>
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(String(room._id))}
                        onChange={e => toggleSelect(String(room._id), e)} />
                    </td>
                    <td className="px-3 py-2 font-black text-num text-base" style={{ color: clean.text }}>{room.number}</td>
                    <td className="px-3 py-2 text-sm text-ink-secondary">{room.floor}</td>
                    <td className="px-3 py-2 text-sm text-ink">{room.roomType?.name || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: clean.text }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: clean.dot }} />
                        {clean.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-medium" style={{ color: occ.color }}>{occ.label}</td>
                    <td className="px-3 py-2">
                      {opsInfo
                        ? <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: opsInfo.bg, color: opsInfo.text }}>{opsInfo.label}</span>
                        : <span className="text-xs text-emerald-600">זמין</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {room.isVip        && <Star size={11} className="text-amber-500" title="VIP" />}
                        {room.isAccessible && <Accessibility size={11} className="text-blue-500" title="נגיש" />}
                        {room.isSmoking    && <Cigarette size={11} className="text-gray-400" title="מעשנים" />}
                      </div>
                    </td>
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => { setEditRoom(String(room._id)); }}>
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── legend ─── */}
      <div className="flex flex-wrap gap-3 mt-4 text-xs text-ink-muted items-center">
        {Object.entries(CLEAN_CFG).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: v.dot }} />
            {v.label}
          </span>
        ))}
        <span className="mr-2 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" /> מאוכלס</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500" /> יציאה</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-500" /> הגעה</span>
      </div>
    </div>
  );
}
