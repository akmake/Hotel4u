import { useState, useCallback } from 'react';
import { Wrench, CheckCircle2, Clock, Plus, X } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { maintenance as mxApi, rooms as roomsApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const CATEGORIES = [
  { value:'hvac',        label:'מיזוג / חימום' },
  { value:'plumbing',    label:'אינסטלציה' },
  { value:'electricity', label:'חשמל' },
  { value:'internet',    label:'WiFi / אינטרנט' },
  { value:'lock',        label:'מנעול / כרטיס' },
  { value:'furniture',   label:'ריהוט' },
  { value:'tv',          label:'טלויזיה' },
  { value:'elevator',    label:'מעלית' },
  { value:'other',       label:'אחר' },
];

function NewTicketModal({ propertyId, onClose, onCreated }) {
  const [rooms,   setRooms]   = useState(null);
  const [form, setForm] = useState({ roomId:'', category:'hvac', description:'', priority:'medium', blocksRoom: false });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // Load rooms once on open
  useState(() => {
    roomsApi.list(propertyId).then(d => setRooms(d || [])).catch(() => setRooms([]));
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.description.trim()) return;
    setError('');
    setLoading(true);
    try {
      await mxApi.create({ propertyId, ...form, blocksRoom: form.blocksRoom === true });
      onCreated();
      onClose();
    } catch (err) { setError(err.message || 'שגיאה'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in" style={{ direction:'rtl' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="font-bold text-ink">תקלה חדשה</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">חדר</label>
            <select className="select w-full" value={form.roomId} onChange={e => set('roomId', e.target.value)}>
              <option value="">אזור כללי (ללא חדר ספציפי)</option>
              {(rooms || []).map(r => (
                <option key={String(r._id)} value={String(r._id)}>חדר {r.number} — {r.roomType?.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">קטגוריה</label>
              <select className="select w-full" value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">עדיפות</label>
              <select className="select w-full" value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option value="low">נמוכה</option>
                <option value="medium">בינונית</option>
                <option value="high">גבוהה</option>
                <option value="urgent">דחוף</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">תיאור התקלה *</label>
            <textarea className="input w-full resize-none" rows={3} required
              placeholder="תאר את התקלה בפירוט..."
              value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          {form.roomId && (
            <label className="flex items-center gap-2 cursor-pointer text-xs text-ink-secondary">
              <input type="checkbox" checked={form.blocksRoom}
                onChange={e => set('blocksRoom', e.target.checked)} className="rounded" />
              <span>סגור חדר (OOO) עד לתיקון</span>
            </label>
          )}
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn btn-primary flex-1 justify-center" disabled={loading}>
              {loading ? 'שומר...' : 'פתח תקלה'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const STATUS_MAP = {
  new:         { label:'חדש',     bg:'rgba(148,163,184,0.1)', color:'#64748b' },
  assigned:    { label:'מוקצה',   bg:'rgba(99,102,241,0.1)',  color:'#6366f1' },
  in_progress: { label:'בטיפול',  bg:'rgba(59,130,246,0.1)',  color:'#2563eb' },
  resolved:    { label:'נפתר',    bg:'rgba(16,185,129,0.1)',  color:'#059669' },
  waiting:     { label:'ממתין',   bg:'rgba(245,158,11,0.1)',  color:'#d97706' },
};

const PRIORITY_MAP = {
  urgent: { label:'דחוף',   cls:'badge-ooo' },
  high:   { label:'גבוהה',  cls:'badge-departure' },
  medium: { label:'בינוני', cls:'badge-pending' },
  low:    { label:'נמוך',   cls:'badge-clean' },
};

function TicketCard({ ticket, propertyId, onRefetch, onToast }) {
  const [loading, setLoading] = useState(false);
  const s = STATUS_MAP[ticket.status] || STATUS_MAP.new;
  const p = PRIORITY_MAP[ticket.priority] || PRIORITY_MAP.low;
  const assignee = ticket.assignedTo;
  const assigneeName = assignee ? `${assignee.firstName} ${assignee.lastName}` : null;
  const createdAt = ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString('he-IL') : '';

  async function resolve() {
    setLoading(true);
    try {
      await mxApi.status(String(ticket._id), 'resolved', propertyId);
      onToast('success', 'תקלה נסגרה!');
      onRefetch();
    } catch (e) {
      onToast('error', e.message || 'שגיאה');
    } finally {
      setLoading(false);
    }
  }

  const isUrgentOpen = ticket.status !== 'resolved' && (ticket.priority === 'urgent' || ticket.priority === 'high');

  return (
    <div className={`card p-4 ${isUrgentOpen ? 'border-red-200' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: s.bg }}>
            <Wrench size={16} style={{ color: s.color }} />
          </div>
          <div>
            <div className="font-bold text-ink">{ticket.description}</div>
            <div className="text-xs text-ink-muted">
              {ticket.category}{ticket.room ? ` · חדר ${ticket.room.number}` : ''}
              {ticket.blocksRoom && <span className="text-red-500 font-semibold"> · OOO</span>}
            </div>
          </div>
        </div>
        <span className={`badge ${p.cls} flex-shrink-0`}>{p.label}</span>
      </div>

      <div className="flex items-center gap-3 text-xs text-ink-muted mb-3">
        <span className="flex items-center gap-1">
          <Clock size={11} /> {createdAt}
        </span>
        {assigneeName && <span>→ {assigneeName}</span>}
      </div>

      <div className="flex items-center justify-between">
        <div className="px-2 py-1 rounded-lg text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
          {s.label}
        </div>
        {ticket.status !== 'resolved' && (
          <button className="btn btn-primary btn-sm gap-1" onClick={resolve} disabled={loading}>
            <CheckCircle2 size={12} /> {loading ? '...' : 'סגור תקלה'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function MaintenancePage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, toast, success } = useToast();
  const [showResolved, setShowResolved] = useState(false);
  const [showNew,      setShowNew]      = useState(false);

  const { data, loading, error, refetch } = useApi(
    () => mxApi.list(propertyId),
    [propertyId], skip
  );

  const onToast = useCallback((type, msg) => toast(msg, type), [toast]);

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const tickets = data || [];
  const open     = tickets.filter(t => t.status !== 'resolved');
  const resolved = tickets.filter(t => t.status === 'resolved');
  const displayed = showResolved ? tickets : open;

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />
      {showNew && (
        <NewTicketModal
          propertyId={propertyId}
          onClose={() => setShowNew(false)}
          onCreated={() => { success('תקלה נפתחה!'); refetch(); }}
        />
      )}

      <div className="page-header">
        <div>
          <div className="page-title">תחזוקה</div>
          <div className="page-subtitle">{open.length} תקלות פתוחות</div>
        </div>
        <div className="flex gap-2">
          <button
            className={`btn btn-sm ${showResolved ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowResolved(v => !v)}
          >
            {showResolved ? 'הסתר סגורות' : `הצג סגורות (${resolved.length})`}
          </button>
          <button className="btn btn-primary gap-1.5" onClick={() => setShowNew(true)}><Plus size={14} />תקלה חדשה</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {displayed.map(ticket => (
          <TicketCard
            key={String(ticket._id)}
            ticket={ticket}
            propertyId={propertyId}
            onRefetch={refetch}
            onToast={onToast}
          />
        ))}
        {displayed.length === 0 && (
          <div className="empty-state col-span-2 mt-4">
            <Wrench size={32} className="empty-state-icon" />
            <span>אין תקלות פתוחות</span>
          </div>
        )}
      </div>
    </div>
  );
}
