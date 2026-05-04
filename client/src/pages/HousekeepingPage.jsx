import { useState, useCallback } from 'react';
import { Sparkles, AlertTriangle, Clock, CheckCircle2, Circle, Play, User, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { housekeeping as hkApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import { TODAY } from '../utils/date';

const TYPE_LABELS = {
  checkout:'Checkout Clean', stayover:'Stayover', arrival:'Arrival',
  deep:'Deep Clean', turndown:'Turndown',
};

const STATUS_CONFIG = {
  new:                { label:'חדש',        Icon: Circle,       color:'#94a3b8', bg:'rgba(148,163,184,0.1)' },
  assigned:           { label:'מוקצה',      Icon: User,         color:'#6366f1', bg:'rgba(99,102,241,0.1)' },
  in_progress:        { label:'בביצוע',     Icon: Play,         color:'#3b82f6', bg:'rgba(59,130,246,0.1)' },
  completed:          { label:'הושלם',      Icon: CheckCircle2, color:'#10b981', bg:'rgba(16,185,129,0.1)' },
  failed:             { label:'נכשל',       Icon: AlertTriangle,color:'#ef4444', bg:'rgba(239,68,68,0.1)' },
  failed_inspection:  { label:'נכשל בדיקה',Icon: AlertTriangle,color:'#ef4444', bg:'rgba(239,68,68,0.1)' },
};

const PRIORITY_CONFIG = {
  urgent: { label:'דחוף',   cls:'badge-ooo' },
  high:   { label:'גבוהה',  cls:'badge-departure' },
  medium: { label:'בינוני', cls:'badge-pending' },
  low:    { label:'נמוך',   cls:'badge-clean' },
};

function TaskCard({ task, propertyId, onRefetch, onToast }) {
  const [actLoading, setActLoading] = useState(null);
  const [inspecting, setInspecting] = useState(false);

  const s = STATUS_CONFIG[task.status] || STATUS_CONFIG.new;
  const p = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.low;
  const { Icon: StatusIcon } = s;
  const assignee = task.assignedTo;
  const assigneeName = assignee ? `${assignee.firstName} ${assignee.lastName}` : null;

  async function act(action) {
    setActLoading(action);
    try {
      if (action === 'start')    await hkApi.start(String(task._id));
      if (action === 'complete') await hkApi.complete(String(task._id), propertyId);
      if (action === 'approve')  await hkApi.inspect(String(task._id), true,  '', propertyId);
      if (action === 'reject')   await hkApi.inspect(String(task._id), false, 'נדרשת עבודה נוספת', propertyId);
      onToast(action === 'reject' ? 'warning' : 'success',
        action === 'start'    ? 'משימה התחילה' :
        action === 'complete' ? 'משימה הושלמה!' :
        action === 'approve'  ? 'חדר אושר — נקי' :
                                'חדר נכשל בדיקה');
      onRefetch();
    } catch (e) {
      onToast('error', e.message || 'שגיאה');
    } finally {
      setActLoading(null);
      setInspecting(false);
    }
  }

  return (
    <div className={`card p-3 ${task.priority === 'urgent' ? 'border-red-200 bg-red-50/20' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg font-bold text-num text-sm flex items-center justify-center flex-shrink-0"
            style={{ background:'rgba(99,102,241,0.1)', color:'#6366f1' }}>
            {task.room?.number}
          </div>
          <div>
            <div className="text-xs font-bold text-ink">{TYPE_LABELS[task.type] || task.type}</div>
            <div className="text-xs text-ink-muted">{task.room?.floor ? `קומה ${task.room.floor}` : ''}</div>
          </div>
        </div>
        <span className={`badge ${p.cls} flex-shrink-0`}>{p.label}</span>
      </div>

      {/* Status + time */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg flex-1" style={{ background: s.bg }}>
          <StatusIcon size={12} style={{ color: s.color }} />
          <span className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</span>
        </div>
        {task.dueTime && (
          <div className="flex items-center gap-1 text-xs text-ink-muted">
            <Clock size={11} /> {task.dueTime}
          </div>
        )}
      </div>

      {/* Assignee */}
      <div className="flex items-center justify-between mb-2">
        {assigneeName
          ? <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <div className="avatar text-xs" style={{width:20,height:20,fontSize:9,background:'rgba(99,102,241,0.1)',color:'#6366f1'}}>
                {assigneeName.slice(0,2)}
              </div>
              {assigneeName}
            </div>
          : <span className="text-xs text-ink-faint italic">לא מוקצה</span>
        }
        {task.notes && <span className="text-xs text-red-500 font-medium truncate max-w-28">{task.notes}</span>}
      </div>

      {/* Inspect inline */}
      {inspecting && (
        <div className="flex gap-2 mb-2">
          <button className="btn btn-sm flex-1 gap-1 justify-center" style={{background:'#f0fdf4',color:'#166534',border:'1px solid #bbf7d0'}}
            onClick={() => act('approve')} disabled={!!actLoading}>
            <ThumbsUp size={11} /> אישור
          </button>
          <button className="btn btn-sm flex-1 gap-1 justify-center" style={{background:'#fef2f2',color:'#991b1b',border:'1px solid #fecaca'}}
            onClick={() => act('reject')} disabled={!!actLoading}>
            <ThumbsDown size={11} /> דחייה
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setInspecting(false)}>ביטול</button>
        </div>
      )}

      {/* Action buttons */}
      {!inspecting && (
        <div className="flex gap-1.5">
          {task.status === 'new' && (
            <button className="btn btn-primary btn-sm flex-1 justify-center gap-1"
              onClick={() => act('start')} disabled={!!actLoading}>
              <Play size={11} /> {actLoading === 'start' ? '...' : 'התחל'}
            </button>
          )}
          {task.status === 'in_progress' && (
            <button className="btn btn-primary btn-sm flex-1 justify-center gap-1"
              onClick={() => act('complete')} disabled={!!actLoading}>
              <CheckCircle2 size={11} /> {actLoading === 'complete' ? '...' : 'סיים'}
            </button>
          )}
          {task.status === 'completed' && (
            <button className="btn btn-secondary btn-sm flex-1 justify-center gap-1"
              onClick={() => setInspecting(true)}>
              <CheckCircle2 size={11} /> בדוק
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function HousekeepingPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, toast } = useToast();
  const [filter, setFilter] = useState('all');

  const { data, loading, error, refetch } = useApi(
    () => hkApi.list(propertyId, { date: TODAY }),
    [propertyId], skip
  );

  const onToast = useCallback((type, msg) => toast(msg, type), [toast]);

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const tasks = data || [];

  const counts = {
    all:         tasks.length,
    new:         tasks.filter(t => t.status === 'new' || t.status === 'assigned').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    completed:   tasks.filter(t => t.status === 'completed' || t.status === 'failed_inspection').length,
    urgent:      tasks.filter(t => t.priority === 'urgent').length,
  };

  const filtered = tasks.filter(t => {
    if (filter === 'urgent') return t.priority === 'urgent';
    if (filter === 'all')    return true;
    if (filter === 'new')    return t.status === 'new' || t.status === 'assigned';
    if (filter === 'completed') return t.status === 'completed' || t.status === 'failed_inspection';
    return t.status === filter;
  });

  const grouped = {
    new:         filtered.filter(t => t.status === 'new' || t.status === 'assigned'),
    in_progress: filtered.filter(t => t.status === 'in_progress'),
    completed:   filtered.filter(t => t.status === 'completed' || t.status === 'failed_inspection'),
  };

  // Staff summary: group by assignedTo
  const staffMap = {};
  tasks.forEach(t => {
    if (!t.assignedTo) return;
    const key = String(t.assignedTo._id);
    if (!staffMap[key]) staffMap[key] = { name: `${t.assignedTo.firstName} ${t.assignedTo.lastName}`, tasks: [], done: 0 };
    staffMap[key].tasks.push(t);
    if (t.status === 'completed') staffMap[key].done++;
  });
  const staffList = Object.values(staffMap);
  const unassigned = tasks.filter(t => !t.assignedTo).length;

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      <div className="page-header">
        <div>
          <div className="page-title">לוח חדרנות</div>
          <div className="page-subtitle">ניהול משימות ניקיון וסטטוס חדרים</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm gap-1"><Sparkles size={13} />שלח הכל</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { key:'all',         label:'סה"כ משימות', color:'#6366f1' },
          { key:'new',         label:'ממתין',        color:'#94a3b8' },
          { key:'in_progress', label:'בביצוע',       color:'#3b82f6' },
          { key:'completed',   label:'הושלם',        color:'#10b981' },
        ].map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-right ${filter === key ? 'border-brand shadow-card' : 'border-surface-border bg-white hover:border-brand/40'}`}
          >
            <div className="text-2xl font-bold text-num flex-shrink-0" style={{ color }}>{counts[key]}</div>
            <div className="text-xs font-medium text-ink-secondary">{label}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Kanban / filtered list */}
        <div className="lg:col-span-3">
          {filter === 'all' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(grouped).map(([status, taskList]) => {
                const s = STATUS_CONFIG[status] || STATUS_CONFIG.new;
                const { Icon: SIcon } = s;
                return (
                  <div key={status}>
                    <div className="flex items-center gap-2 mb-3">
                      <SIcon size={14} style={{ color: s.color }} />
                      <span className="font-semibold text-sm text-ink">{s.label}</span>
                      <span className="badge" style={{ background: s.bg, color: s.color }}>{taskList.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {taskList.map(t => (
                        <TaskCard key={String(t._id)} task={t} propertyId={propertyId} onRefetch={refetch} onToast={onToast} />
                      ))}
                      {taskList.length === 0 && (
                        <div className="empty-state" style={{ padding: 24 }}>
                          <CheckCircle2 size={24} className="empty-state-icon" />
                          <span className="text-xs">אין משימות</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {filtered.map(t => (
                <TaskCard key={String(t._id)} task={t} propertyId={propertyId} onRefetch={refetch} onToast={onToast} />
              ))}
              {filtered.length === 0 && (
                <div className="empty-state col-span-3 mt-4">
                  <Sparkles size={28} className="empty-state-icon" />
                  <span>אין משימות</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Staff sidebar */}
        <div className="lg:col-span-1">
          <div className="card">
            <div className="card-header">
              <span className="font-semibold text-ink text-sm">צוות חדרנות</span>
            </div>
            <div className="divide-y divide-surface-hover">
              {staffList.map(({ name, tasks: st, done }) => (
                <div key={name} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="avatar text-xs" style={{width:26,height:26,fontSize:10,background:'rgba(99,102,241,0.1)',color:'#6366f1'}}>
                        {name.slice(0,2)}
                      </div>
                      <span className="text-sm font-medium text-ink">{name}</span>
                    </div>
                    <span className="text-xs text-ink-muted">{done}/{st.length}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-hover rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: st.length ? `${(done/st.length)*100}%` : '0%',
                        background: done === st.length && st.length > 0 ? '#10b981' : '#6366f1',
                      }}
                    />
                  </div>
                  <div className="text-xs text-ink-faint mt-1">
                    {st.length - done} נותרו
                  </div>
                </div>
              ))}
              {staffList.length === 0 && (
                <div className="px-4 py-3 text-xs text-ink-faint">אין עובדים מוקצים</div>
              )}
              <div className="px-4 py-3">
                <div className="text-xs font-semibold text-red-500 mb-1">לא מוקצה</div>
                <div className="text-2xl font-bold text-num text-red-500">{unassigned}</div>
                <div className="text-xs text-ink-muted">משימות ממתינות להקצאה</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
