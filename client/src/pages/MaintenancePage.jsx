import { useState, useCallback, useEffect } from 'react';
import {
  Wrench, CheckCircle2, Clock, Plus, X, AlertTriangle, ChevronDown, ChevronRight,
  User, Calendar, Tag, MessageSquare, Play, RotateCcw, Eye, Zap, Filter,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { maintenance as mxApi, rooms as roomsApi, users as usersApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
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
  { value:'water',       label:'אינסטלציה / מים' },
  { value:'noise',       label:'רעש' },
  { value:'cleaning',    label:'ניקיון' },
  { value:'safety',      label:'בטיחות' },
  { value:'other',       label:'אחר' },
];

const STATUS_MAP = {
  new:             { label:'חדש',            bg:'rgba(148,163,184,0.1)', color:'#64748b', next:['assigned','in_progress'] },
  assigned:        { label:'מוקצה',          bg:'rgba(99,102,241,0.1)',  color:'#6366f1', next:['in_progress','waiting_parts','waiting_vendor'] },
  in_progress:     { label:'בטיפול',         bg:'rgba(59,130,246,0.1)',  color:'#2563eb', next:['waiting_parts','waiting_vendor','resolved'] },
  waiting_parts:   { label:'ממתין לחלקים',   bg:'rgba(245,158,11,0.1)',  color:'#d97706', next:['in_progress','resolved'] },
  waiting_vendor:  { label:'ממתין לקבלן',    bg:'rgba(234,179,8,0.1)',   color:'#a16207', next:['in_progress','resolved'] },
  resolved:        { label:'נסגר',           bg:'rgba(16,185,129,0.1)',  color:'#059669', next:['reopened','verified'] },
  verified:        { label:'מאומת',          bg:'rgba(5,150,105,0.15)',  color:'#047857', next:['closed','reopened'] },
  closed:          { label:'סגור',           bg:'rgba(100,116,139,0.08)',color:'#94a3b8', next:['reopened'] },
  reopened:        { label:'נפתח מחדש',      bg:'rgba(239,68,68,0.1)',   color:'#dc2626', next:['in_progress','resolved'] },
};

const STATUS_ACTION_LABEL = {
  in_progress:    'התחל טיפול',
  waiting_parts:  'ממתין לחלקים',
  waiting_vendor: 'ממתין לקבלן',
  resolved:       'סגור תקלה',
  reopened:       'פתח מחדש',
  verified:       'אמת תיקון',
  closed:         'סגור לגמרי',
};

const PRIORITY_MAP = {
  critical: { label:'קריטי',  cls:'badge-ooo',      color:'#dc2626' },
  high:     { label:'גבוהה',  cls:'badge-departure', color:'#f97316' },
  medium:   { label:'בינוני', cls:'badge-pending',   color:'#d97706' },
  low:      { label:'נמוך',   cls:'badge-clean',     color:'#16a34a' },
};

// ── New Ticket Modal ───────────────────────────────────────────────────────────
function NewTicketModal({ propertyId, onClose, onCreated }) {
  const [rooms,   setRooms]   = useState(null);
  const [form, setForm] = useState({ roomId:'', category:'hvac', description:'', priority:'medium', blocksRoom: false, estimatedCost:'', notes:'' });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    roomsApi.list(propertyId).then(d => setRooms(d || [])).catch(() => setRooms([]));
  }, [propertyId]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.description.trim()) return;
    setError(''); setLoading(true);
    try {
      await mxApi.create({ propertyId, ...form, blocksRoom: form.blocksRoom === true, estimatedCost: form.estimatedCost ? Number(form.estimatedCost) : undefined });
      onCreated(); onClose();
    } catch (err) { setError(err.message || 'שגיאה'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in" style={{ direction:'rtl' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="font-bold text-ink">תקלה חדשה</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">חדר</label>
            <select className="select w-full" value={form.roomId} onChange={e => set('roomId', e.target.value)}>
              <option value="">אזור כללי (ללא חדר ספציפי)</option>
              {(rooms || []).map(r => <option key={String(r._id)} value={String(r._id)}>חדר {r.number} — {r.roomType?.name}</option>)}
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
                {Object.entries(PRIORITY_MAP).map(([v, p]) => <option key={v} value={v}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">תיאור התקלה *</label>
            <textarea className="input w-full resize-none" rows={3} required placeholder="תאר את התקלה בפירוט..."
              value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">עלות משוערת (₪)</label>
              <input type="number" className="input w-full" placeholder="0" min={0} value={form.estimatedCost} onChange={e => set('estimatedCost', e.target.value)} />
            </div>
            <div className="flex items-end pb-1">
              {form.roomId && (
                <label className="flex items-center gap-2 cursor-pointer text-xs text-ink-secondary">
                  <input type="checkbox" checked={form.blocksRoom} onChange={e => set('blocksRoom', e.target.checked)} className="rounded" />
                  <span>סגור חדר (OOO) עד לתיקון</span>
                </label>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">הערות נוספות</label>
            <input className="input w-full" placeholder="הערות..." value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn btn-primary flex-1 justify-center" disabled={loading}>
              {loading ? <Spinner size={14} /> : 'פתח תקלה'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Ticket Drawer ─────────────────────────────────────────────────────────────
function TicketDrawer({ ticketId, propertyId, staff, onClose, onRefetch, onToast }) {
  const [noteText,  setNoteText]  = useState('');
  const [addingNote,setAddingNote]= useState(false);
  const [savingNote,setSavingNote]= useState(false);
  const [actLoading,setActLoading]= useState(null);
  const [editPri,   setEditPri]   = useState(false);
  const [newPri,    setNewPri]    = useState('');
  const [editDue,   setEditDue]   = useState(false);
  const [newDue,    setNewDue]    = useState('');
  const [assignId,  setAssignId]  = useState('');
  const [assigning, setAssigning] = useState(false);

  const { data: ticket, loading, error, refetch } = useApi(
    () => mxApi.get(ticketId),
    [ticketId], !ticketId
  );

  useEffect(() => {
    if (ticket) {
      setAssignId(ticket.assignedTo ? String(ticket.assignedTo._id) : '');
      setNewPri(ticket.priority);
      if (ticket.dueDate) setNewDue(ticket.dueDate.slice(0, 10));
    }
  }, [ticket]);

  async function doStatus(newStatus) {
    setActLoading(newStatus);
    try {
      await mxApi.status(ticketId, newStatus, propertyId);
      onToast('success', STATUS_ACTION_LABEL[newStatus] || newStatus);
      refetch(); onRefetch();
    } catch (e) { onToast('error', e.message); }
    finally { setActLoading(null); }
  }

  async function doAssign() {
    setAssigning(true);
    try {
      await mxApi.assign(ticketId, assignId || null);
      onToast('success', assignId ? 'שויך לטכנאי' : 'שיוך הוסר');
      refetch(); onRefetch();
    } catch (e) { onToast('error', e.message); }
    finally { setAssigning(false); }
  }

  async function savePriority() {
    try {
      await mxApi.priority(ticketId, newPri, propertyId);
      onToast('success', 'עדיפות עודכנה');
      setEditPri(false); refetch(); onRefetch();
    } catch (e) { onToast('error', e.message); }
  }

  async function saveDue() {
    try {
      await mxApi.due(ticketId, newDue || null, propertyId);
      onToast('success', 'תאריך יעד עודכן');
      setEditDue(false); refetch(); onRefetch();
    } catch (e) { onToast('error', e.message); }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await mxApi.addNote(ticketId, noteText.trim());
      setNoteText(''); setAddingNote(false);
      onToast('success', 'הערה נוספה');
      refetch();
    } catch (e) { onToast('error', e.message); }
    finally { setSavingNote(false); }
  }

  const s       = ticket ? (STATUS_MAP[ticket.status] || STATUS_MAP.new) : STATUS_MAP.new;
  const p       = ticket ? (PRIORITY_MAP[ticket.priority] || PRIORITY_MAP.low) : PRIORITY_MAP.low;
  const nextStatuses = ticket ? (s.next || []) : [];
  const isOverdue = ticket?.dueDate && new Date(ticket.dueDate) < new Date() && ticket.status !== 'resolved' && ticket.status !== 'closed';

  return (
    <div className="fixed inset-0 z-50 flex" style={{ direction:'rtl' }}>
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-surface-border flex items-start justify-between gap-3">
          {loading ? <div className="flex-1"><Spinner size={20} /></div> : ticket ? (
            <div className="flex-1 min-w-0">
              <div className="font-bold text-ink text-base leading-tight line-clamp-2">{ticket.description}</div>
              <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-ink-muted">
                {ticket.room && <span>חדר {ticket.room.number}</span>}
                <span>{CATEGORIES.find(c => c.value === ticket.category)?.label || ticket.category}</span>
                {ticket.blocksRoom && <span className="text-red-600 font-semibold">· OOO</span>}
              </div>
            </div>
          ) : null}
          <button className="btn btn-ghost btn-icon flex-shrink-0" onClick={onClose}><X size={18} /></button>
        </div>

        {loading && <div className="flex-1 flex justify-center items-center"><Spinner size={28} /></div>}
        {error   && <div className="flex-1 flex justify-center items-center text-xs text-red-500">{error}</div>}

        {!loading && !error && ticket && (
          <div className="flex-1 overflow-y-auto">
            {/* Status + Priority */}
            <div className="px-5 py-4 border-b border-surface-border">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                <span className={`badge ${p.cls}`}>{p.label}</span>
                {isOverdue && <span className="badge badge-ooo flex items-center gap-1"><AlertTriangle size={10} /> פגר תאריך</span>}
              </div>

              {/* Workflow actions */}
              {nextStatuses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {nextStatuses.map(ns => (
                    <button key={ns}
                      className={`btn btn-sm gap-1 ${ns === 'resolved' ? 'btn-primary' : ns === 'reopened' ? 'btn-danger' : 'btn-secondary'}`}
                      onClick={() => doStatus(ns)} disabled={actLoading === ns}>
                      {actLoading === ns ? <Spinner size={11}/> : ns === 'resolved' ? <CheckCircle2 size={11}/> : ns === 'in_progress' ? <Play size={11}/> : ns === 'reopened' ? <RotateCcw size={11}/> : null}
                      {STATUS_ACTION_LABEL[ns] || ns}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Assign */}
            <div className="px-5 py-3 border-b border-surface-border">
              <div className="text-xs font-semibold text-ink-secondary mb-2">שיוך לטכנאי</div>
              <div className="flex gap-2">
                <select className="select flex-1 text-sm" value={assignId} onChange={e => setAssignId(e.target.value)}>
                  <option value="">— לא מוקצה —</option>
                  {staff.map(u => <option key={String(u._id)} value={String(u._id)}>{u.firstName} {u.lastName}</option>)}
                </select>
                <button className="btn btn-secondary btn-sm" onClick={doAssign} disabled={assigning}>
                  {assigning ? <Spinner size={12}/> : 'שמור'}
                </button>
              </div>
            </div>

            {/* Details */}
            <div className="px-5 py-3 border-b border-surface-border">
              <div className="grid grid-cols-2 gap-3">
                {/* Priority */}
                <div>
                  <div className="text-xs font-semibold text-ink-secondary mb-1 flex items-center gap-1"><Tag size={11}/>עדיפות</div>
                  {editPri ? (
                    <div className="flex gap-1">
                      <select className="select text-xs flex-1" value={newPri} onChange={e => setNewPri(e.target.value)}>
                        {Object.entries(PRIORITY_MAP).map(([v, pm]) => <option key={v} value={v}>{pm.label}</option>)}
                      </select>
                      <button className="btn btn-primary btn-sm px-2" onClick={savePriority}>✓</button>
                      <button className="btn btn-ghost btn-sm px-1" onClick={() => setEditPri(false)}>✕</button>
                    </div>
                  ) : (
                    <button className="flex items-center gap-1 text-xs font-semibold hover:opacity-70" style={{ color: p.color }} onClick={() => setEditPri(true)}>
                      {p.label} <ChevronDown size={10}/>
                    </button>
                  )}
                </div>

                {/* Due date */}
                <div>
                  <div className="text-xs font-semibold text-ink-secondary mb-1 flex items-center gap-1"><Calendar size={11}/>תאריך יעד</div>
                  {editDue ? (
                    <div className="flex gap-1">
                      <input type="date" className="input h-7 text-xs flex-1" value={newDue} onChange={e => setNewDue(e.target.value)} />
                      <button className="btn btn-primary btn-sm px-2" onClick={saveDue}>✓</button>
                      <button className="btn btn-ghost btn-sm px-1" onClick={() => setEditDue(false)}>✕</button>
                    </div>
                  ) : (
                    <button className={`text-xs font-medium hover:opacity-70 ${isOverdue ? 'text-red-600' : 'text-ink-secondary'}`} onClick={() => setEditDue(true)}>
                      {ticket.dueDate ? new Date(ticket.dueDate).toLocaleDateString('he-IL') : '— לא הוגדר'} <ChevronDown size={10} className="inline"/>
                    </button>
                  )}
                </div>

                {/* Reported by */}
                <div>
                  <div className="text-xs font-semibold text-ink-secondary mb-1 flex items-center gap-1"><User size={11}/>דווח ע"י</div>
                  <div className="text-xs text-ink">{ticket.reportedBy ? `${ticket.reportedBy.firstName} ${ticket.reportedBy.lastName}` : '—'}</div>
                </div>

                {/* Created */}
                <div>
                  <div className="text-xs font-semibold text-ink-secondary mb-1 flex items-center gap-1"><Clock size={11}/>נפתח</div>
                  <div className="text-xs text-ink">{ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString('he-IL') : '—'}</div>
                </div>

                {/* Costs */}
                {(ticket.estimatedCost != null || ticket.actualCost != null) && (
                  <>
                    {ticket.estimatedCost != null && (
                      <div>
                        <div className="text-xs font-semibold text-ink-secondary mb-1">עלות משוערת</div>
                        <div className="text-xs text-ink text-num">₪{ticket.estimatedCost.toLocaleString()}</div>
                      </div>
                    )}
                    {ticket.actualCost != null && (
                      <div>
                        <div className="text-xs font-semibold text-ink-secondary mb-1">עלות בפועל</div>
                        <div className="text-xs text-ink text-num">₪{ticket.actualCost.toLocaleString()}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
              {ticket.notes && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-ink-secondary mb-1">הערות</div>
                  <div className="text-xs text-ink bg-surface-hover rounded-lg p-2">{ticket.notes}</div>
                </div>
              )}
            </div>

            {/* Notes Timeline */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-ink-secondary flex items-center gap-1"><MessageSquare size={11}/>הערות פנימיות ({(ticket.internalNotes || []).length})</div>
                {!addingNote && (
                  <button className="btn btn-ghost btn-sm gap-1 text-brand text-xs" onClick={() => setAddingNote(true)}>
                    <Plus size={11}/> הוסף
                  </button>
                )}
              </div>

              {addingNote && (
                <div className="mb-3 flex flex-col gap-2">
                  <textarea className="input w-full resize-none text-sm" rows={3} placeholder="כתוב הערה..." value={noteText} onChange={e => setNoteText(e.target.value)} autoFocus />
                  <div className="flex gap-2">
                    <button className="btn btn-primary btn-sm flex-1 justify-center" onClick={addNote} disabled={savingNote || !noteText.trim()}>
                      {savingNote ? <Spinner size={12}/> : 'שלח'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setAddingNote(false); setNoteText(''); }}>ביטול</button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {(ticket.internalNotes || []).slice().reverse().map(note => (
                  <div key={String(note._id)} className="bg-surface-hover rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-brand">{note.authorName || 'מערכת'}</span>
                      <span className="text-[10px] text-ink-faint">{new Date(note.createdAt).toLocaleString('he-IL')}</span>
                    </div>
                    <div className="text-xs text-ink whitespace-pre-wrap">{note.text}</div>
                  </div>
                ))}
                {(!ticket.internalNotes || ticket.internalNotes.length === 0) && (
                  <div className="text-xs text-ink-faint text-center py-4">אין הערות עדיין</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Ticket Card ───────────────────────────────────────────────────────────────
function TicketCard({ ticket, onClick }) {
  const s = STATUS_MAP[ticket.status] || STATUS_MAP.new;
  const p = PRIORITY_MAP[ticket.priority] || PRIORITY_MAP.low;
  const assignee = ticket.assignedTo;
  const createdAt = ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString('he-IL') : '';
  const isOverdue = ticket.dueDate && new Date(ticket.dueDate) < new Date() && ticket.status !== 'resolved' && ticket.status !== 'closed';
  const isUrgentOpen = ticket.status !== 'resolved' && ticket.status !== 'closed' && ticket.status !== 'verified' && ticket.priority === 'critical';

  return (
    <div className={`card p-4 cursor-pointer hover:shadow-card transition-all ${isUrgentOpen ? 'border-red-200 bg-red-50/10' : ''}`} onClick={onClick}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: s.bg }}>
            <Wrench size={15} style={{ color: s.color }} />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-ink text-sm leading-tight line-clamp-2">{ticket.description}</div>
            <div className="text-[11px] text-ink-muted">
              {CATEGORIES.find(c => c.value === ticket.category)?.label || ticket.category}
              {ticket.room ? ` · חדר ${ticket.room.number}` : ''}
              {ticket.blocksRoom && <span className="text-red-500 font-semibold"> · OOO</span>}
            </div>
          </div>
        </div>
        <span className={`badge ${p.cls} flex-shrink-0`}>{p.label}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: s.bg, color: s.color }}>{s.label}</span>
          {isOverdue && <span className="text-[10px] text-red-500 flex items-center gap-0.5"><AlertTriangle size={9}/>פגר</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-ink-muted">
          {assignee && <span className="flex items-center gap-1"><User size={10}/>{assignee.firstName}</span>}
          <span className="flex items-center gap-1"><Clock size={10}/>{createdAt}</span>
          <ChevronRight size={13} className="text-ink-faint" />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MaintenancePage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, toast, success } = useToast();
  const [showNew,      setShowNew]      = useState(false);
  const [openDrawerId, setOpenDrawerId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('open');  // 'open'|'all'|specific status
  const [catFilter,    setCatFilter]    = useState('');
  const [priFilter,    setPriFilter]    = useState('');

  const onToast = useCallback((type, msg) => toast(msg, type), [toast]);

  const { data, loading, error, refetch } = useApi(
    () => mxApi.list(propertyId, {
      ...(statusFilter === 'open' ? { status: 'new,assigned,in_progress,waiting_parts,waiting_vendor,reopened' }
        : statusFilter === 'all'  ? {}
        : { status: statusFilter }),
      ...(catFilter ? { category: catFilter } : {}),
      ...(priFilter ? { priority: priFilter } : {}),
    }),
    [propertyId, statusFilter, catFilter, priFilter], skip
  );

  const { data: statsData } = useApi(() => mxApi.stats(propertyId), [propertyId], skip);
  const { data: staffData  } = useApi(() => usersApi.list(propertyId), [propertyId], skip);
  const staff = (staffData || []).filter(u => ['technician', 'maintenance_manager', 'general_manager', 'property_admin', 'super_admin'].includes(u.role));

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const tickets = data || [];
  const stats = statsData || {};

  const countByStatus = (key) => (stats.byStatus || []).find(b => b._id === key)?.count || 0;
  const openTotal = ['new','assigned','in_progress','waiting_parts','waiting_vendor','reopened'].reduce((s, k) => s + countByStatus(k), 0);

  const STATUS_FILTERS = [
    { value:'open',    label:`פתוח (${openTotal})` },
    { value:'all',     label:'הכל' },
    { value:'new',     label:'חדש' },
    { value:'assigned',label:'מוקצה' },
    { value:'in_progress', label:'בטיפול' },
    { value:'waiting_parts', label:'ממתין חלקים' },
    { value:'resolved',label:'נסגר' },
  ];

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      {showNew && (
        <NewTicketModal propertyId={propertyId} onClose={() => setShowNew(false)} onCreated={() => { success('תקלה נפתחה!'); refetch(); }} />
      )}

      {openDrawerId && (
        <TicketDrawer
          ticketId={openDrawerId}
          propertyId={propertyId}
          staff={staff}
          onClose={() => setOpenDrawerId(null)}
          onRefetch={refetch}
          onToast={onToast}
        />
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">תחזוקה</div>
          <div className="page-subtitle">{openTotal} תקלות פתוחות{stats.overdueCount > 0 ? ` · ${stats.overdueCount} פגרו תאריך` : ''}</div>
        </div>
        <button className="btn btn-primary gap-1.5" onClick={() => setShowNew(true)}><Plus size={14}/>תקלה חדשה</button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {[
          { label:'סה"כ פתוח', value: openTotal,              color:'#6366f1' },
          { label:'חדש',       value: countByStatus('new'),   color:'#64748b' },
          { label:'בטיפול',    value: countByStatus('in_progress'), color:'#2563eb' },
          { label:'ממתין',     value: countByStatus('waiting_parts') + countByStatus('waiting_vendor'), color:'#d97706' },
          { label:'פגרו תאריך',value: stats.overdueCount || 0, color:'#dc2626' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-3 flex items-center gap-3">
            <div className="text-2xl font-black text-num" style={{ color }}>{value}</div>
            <div className="text-xs font-medium text-ink-secondary">{label}</div>
          </div>
        ))}
      </div>

      {/* Priority breakdown pills */}
      {(stats.byPriority || []).length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Filter size={12} className="text-ink-faint"/>
          {(stats.byPriority || []).map(b => {
            const pm = PRIORITY_MAP[b._id] || PRIORITY_MAP.low;
            return (
              <button key={b._id}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-all ${priFilter === b._id ? 'border-brand bg-brand/5' : 'border-surface-border hover:border-brand/40'}`}
                onClick={() => setPriFilter(priFilter === b._id ? '' : b._id)}>
                <span className={`badge ${pm.cls}`} style={{fontSize:9}}>{pm.label}</span>
                <span className="font-bold text-num">{b.count}</span>
              </button>
            );
          })}
          {priFilter && <button className="text-xs text-ink-faint hover:text-ink underline" onClick={() => setPriFilter('')}>נקה</button>}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* Status chips */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : 'btn-secondary'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Category dropdown */}
        <select className="select text-xs mr-auto" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">כל הקטגוריות</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* Ticket grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {tickets.map(ticket => (
          <TicketCard
            key={String(ticket._id)}
            ticket={ticket}
            onClick={() => setOpenDrawerId(String(ticket._id))}
          />
        ))}
        {tickets.length === 0 && (
          <div className="empty-state col-span-3 mt-4">
            <Wrench size={32} className="empty-state-icon" />
            <span>אין תקלות</span>
          </div>
        )}
      </div>
    </div>
  );
}
