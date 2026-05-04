import { useState, useCallback } from 'react';
import {
  Sparkles, AlertTriangle, Clock, CheckCircle2, Circle, Play, User,
  ThumbsUp, ThumbsDown, Pause, X, Bug, Package, MapPin, Zap,
  RotateCcw, BellOff, ShieldOff, Plus, RefreshCw, UserPlus,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { housekeeping as hkApi, users as usersApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import { TODAY } from '../utils/date';

const TYPE_LABELS = {
  checkout_clean:'Checkout Clean', stayover:'Stayover', arrival_prep:'Arrival Prep',
  deep_clean:'Deep Clean', turndown:'Turndown', pickup:'Pickup',
};

const STATUS_CONFIG = {
  new:               { label:'חדש',        Icon: Circle,       color:'#94a3b8', bg:'rgba(148,163,184,0.1)' },
  assigned:          { label:'מוקצה',      Icon: User,         color:'#6366f1', bg:'rgba(99,102,241,0.1)' },
  in_progress:       { label:'בביצוע',     Icon: Play,         color:'#3b82f6', bg:'rgba(59,130,246,0.1)' },
  paused:            { label:'מושהה',      Icon: Pause,        color:'#f59e0b', bg:'rgba(245,158,11,0.1)' },
  completed:         { label:'הושלם',      Icon: CheckCircle2, color:'#10b981', bg:'rgba(16,185,129,0.1)' },
  failed_inspection: { label:'נכשל בדיקה',Icon: AlertTriangle,color:'#ef4444', bg:'rgba(239,68,68,0.1)' },
  inspected:         { label:'נבדק',       Icon: CheckCircle2, color:'#059669', bg:'rgba(5,150,105,0.1)' },
  cancelled:         { label:'בוטל',       Icon: X,            color:'#6b7280', bg:'rgba(107,114,128,0.1)' },
};

const PRIORITY_CONFIG = {
  urgent: { label:'דחוף',   cls:'badge-ooo' },
  high:   { label:'גבוהה',  cls:'badge-departure' },
  medium: { label:'בינוני', cls:'badge-pending' },
  low:    { label:'נמוך',   cls:'badge-clean' },
};

function TaskCard({ task, propertyId, staff, onRefetch, onToast }) {
  const [actLoading,  setActLoading]  = useState(null);
  const [inspecting,  setInspecting]  = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [showPause,   setShowPause]   = useState(false);
  const [showLF,      setShowLF]      = useState(false);
  const [lfDesc,      setLfDesc]      = useState('');
  const [lfLoc,       setLfLoc]       = useState('');
  const [showIssue,   setShowIssue]   = useState(false);
  const [issueDesc,   setIssueDesc]   = useState('');
  const [issuePri,    setIssuePri]    = useState('medium');
  const [showCancel,  setShowCancel]  = useState(false);
  const [cancelReason,setCancelReason]= useState('');

  const s = STATUS_CONFIG[task.status] || STATUS_CONFIG.new;
  const p = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.low;
  const { Icon: StatusIcon } = s;
  const assignee = task.assignedTo;

  const isCancelled = task.status === 'cancelled';
  const isInspected = task.status === 'inspected';

  async function act(action, payload = {}) {
    setActLoading(action);
    try {
      if (action === 'start')    await hkApi.start(String(task._id));
      if (action === 'pause')    await hkApi.pause(String(task._id), pauseReason);
      if (action === 'resume')   await hkApi.resume(String(task._id));
      if (action === 'complete') await hkApi.complete(String(task._id), propertyId);
      if (action === 'approve')  await hkApi.inspect(String(task._id), true, '', propertyId);
      if (action === 'reject')   await hkApi.inspect(String(task._id), false, 'נדרשת עבודה נוספת', propertyId);
      if (action === 'assign')   await hkApi.assign(String(task._id), payload.userId);
      if (action === 'cancel')   await hkApi.cancel(String(task._id), cancelReason);
      if (action === 'dnd')      await hkApi.setDND(String(task._id), !task.isDND);
      if (action === 'noservice')await hkApi.setNoService(String(task._id), !task.isNoService);
      if (action === 'lostfound')await hkApi.addLostFound(String(task._id), { itemDescription: lfDesc, foundLocation: lfLoc });
      if (action === 'issue')    await hkApi.reportIssue(String(task._id), { description: issueDesc, priority: issuePri, propertyId });
      onToast('success', {
        start:'משימה התחילה', pause:'משימה מושהית', resume:'משימה חזרה לביצוע',
        complete:'משימה הושלמה!', approve:'חדר אושר — נקי', reject:'חדר נכשל בדיקה',
        assign:'צוות הוקצה', cancel:'משימה בוטלה', dnd:task.isDND?'DND בוטל':'DND הופעל',
        noservice:task.isNoService?'No Service בוטל':'No Service הופעל',
        lostfound:'פריט אבידה נרשם', issue:'תקלה דווחה',
      }[action] || 'בוצע');
      onRefetch();
      setShowPause(false); setShowLF(false); setShowIssue(false); setShowCancel(false);
      setInspecting(false); setPauseReason(''); setLfDesc(''); setLfLoc(''); setIssueDesc('');
    } catch (e) {
      onToast('error', e.message || 'שגיאה');
    } finally {
      setActLoading(null);
    }
  }

  return (
    <div className={`card p-3 ${task.priority==='urgent'?'border-red-200 bg-red-50/20':''} ${isCancelled?'opacity-60':''}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg font-bold text-num text-sm flex items-center justify-center flex-shrink-0"
            style={{ background:'rgba(99,102,241,0.1)', color:'#6366f1' }}>
            {task.room?.number}
          </div>
          <div>
            <div className="text-xs font-bold text-ink">{TYPE_LABELS[task.type] || task.type}</div>
            <div className="text-xs text-ink-muted">{task.room?.floor?`קומה ${task.room.floor}`:''}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {task.isDND      && <span className="badge badge-dirty text-xs py-0">DND</span>}
          {task.isNoService && <span className="badge badge-ooo text-xs py-0">No Svc</span>}
          <span className={`badge ${p.cls} flex-shrink-0`}>{p.label}</span>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg flex-1" style={{ background: s.bg }}>
          <StatusIcon size={12} style={{ color: s.color }} />
          <span className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</span>
        </div>
        {task.dueTime && <div className="flex items-center gap-1 text-xs text-ink-muted"><Clock size={11}/>{task.dueTime}</div>}
      </div>

      {/* Assignee selector */}
      {!isCancelled && !isInspected && (
        <div className="mb-2">
          <select className="select w-full text-xs"
            value={assignee?String(assignee._id):''}
            onChange={e => act('assign', { userId: e.target.value || null })}>
            <option value="">לא מוקצה</option>
            {(staff||[]).map(u => <option key={String(u._id)} value={String(u._id)}>{u.firstName} {u.lastName}</option>)}
          </select>
        </div>
      )}

      {/* Supplies */}
      {(task.supplies||[]).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.supplies.map((s,i) => <span key={i} className="text-xs bg-surface-hover px-1.5 py-0.5 rounded"><Package size={9} className="inline mr-0.5"/>{s.item} ×{s.qty}</span>)}
        </div>
      )}

      {/* Lost+Found items */}
      {(task.lostFound||[]).length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {task.lostFound.map(lf => (
            <span key={String(lf._id)} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5"><MapPin size={9} className="inline mr-0.5"/>{lf.itemDescription}</span>
          ))}
        </div>
      )}

      {/* Issue reported indicator */}
      {task.issueReported?.description && (
        <div className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1 mb-2 flex items-center gap-1">
          <Bug size={10}/> תקלה: {task.issueReported.description}
        </div>
      )}

      {/* Inspect inline */}
      {inspecting && (
        <div className="flex gap-2 mb-2">
          <button className="btn btn-sm flex-1 gap-1 justify-center" style={{background:'#f0fdf4',color:'#166534',border:'1px solid #bbf7d0'}} onClick={()=>act('approve')} disabled={!!actLoading}><ThumbsUp size={11}/>אישור</button>
          <button className="btn btn-sm flex-1 gap-1 justify-center" style={{background:'#fef2f2',color:'#991b1b',border:'1px solid #fecaca'}} onClick={()=>act('reject')} disabled={!!actLoading}><ThumbsDown size={11}/>דחייה</button>
          <button className="btn btn-secondary btn-sm" onClick={()=>setInspecting(false)}>ביטול</button>
        </div>
      )}

      {/* Pause form */}
      {showPause && (
        <div className="mb-2 flex flex-col gap-1.5">
          <input className="input text-xs" placeholder="סיבת השהייה..." value={pauseReason} onChange={e=>setPauseReason(e.target.value)} />
          <div className="flex gap-1">
            <button className="btn btn-primary btn-sm flex-1 justify-center" onClick={()=>act('pause')} disabled={!!actLoading||!pauseReason.trim()}>{actLoading==='pause'?<Spinner size={12}/>:<Pause size={11}/>} השהה</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowPause(false)}>ביטול</button>
          </div>
        </div>
      )}

      {/* Cancel form */}
      {showCancel && (
        <div className="mb-2 flex flex-col gap-1.5">
          <input className="input text-xs" placeholder="סיבת ביטול..." value={cancelReason} onChange={e=>setCancelReason(e.target.value)} />
          <div className="flex gap-1">
            <button className="btn btn-danger btn-sm flex-1 justify-center" onClick={()=>act('cancel')} disabled={!!actLoading}>{actLoading==='cancel'?<Spinner size={12}/>:<X size={11}/>} בטל משימה</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowCancel(false)}>ביטול</button>
          </div>
        </div>
      )}

      {/* Lost+Found form */}
      {showLF && (
        <div className="mb-2 flex flex-col gap-1.5 bg-amber-50 border border-amber-200 rounded-lg p-2">
          <div className="text-xs font-bold text-amber-800">רישום אבידה</div>
          <input className="input text-xs" placeholder="תיאור הפריט..." value={lfDesc} onChange={e=>setLfDesc(e.target.value)} />
          <input className="input text-xs" placeholder="מיקום (אופציונלי)" value={lfLoc} onChange={e=>setLfLoc(e.target.value)} />
          <div className="flex gap-1">
            <button className="btn btn-primary btn-sm flex-1 justify-center" onClick={()=>act('lostfound')} disabled={!!actLoading||!lfDesc.trim()}>{actLoading==='lostfound'?<Spinner size={12}/>:<MapPin size={11}/>} שמור</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowLF(false)}>ביטול</button>
          </div>
        </div>
      )}

      {/* Issue report form */}
      {showIssue && (
        <div className="mb-2 flex flex-col gap-1.5 bg-orange-50 border border-orange-200 rounded-lg p-2">
          <div className="text-xs font-bold text-orange-800">דיווח תקלה</div>
          <textarea className="input text-xs resize-none" rows={2} placeholder="תיאור התקלה..." value={issueDesc} onChange={e=>setIssueDesc(e.target.value)} />
          <select className="select text-xs" value={issuePri} onChange={e=>setIssuePri(e.target.value)}>
            <option value="low">נמוך</option><option value="medium">בינוני</option><option value="high">גבוה</option><option value="critical">קריטי</option>
          </select>
          <div className="flex gap-1">
            <button className="btn btn-primary btn-sm flex-1 justify-center" onClick={()=>act('issue')} disabled={!!actLoading||!issueDesc.trim()}>{actLoading==='issue'?<Spinner size={12}/>:<Bug size={11}/>} דווח</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowIssue(false)}>ביטול</button>
          </div>
        </div>
      )}

      {/* Main action buttons */}
      {!inspecting && !showPause && !showCancel && !showLF && !showIssue && !isCancelled && !isInspected && (
        <div className="flex flex-wrap gap-1">
          {task.status==='new'&&<button className="btn btn-primary btn-sm flex-1 justify-center gap-1" onClick={()=>act('start')} disabled={!!actLoading}><Play size={11}/>{actLoading==='start'?'...':'התחל'}</button>}
          {task.status==='in_progress'&&<button className="btn btn-primary btn-sm flex-1 justify-center gap-1" onClick={()=>act('complete')} disabled={!!actLoading}><CheckCircle2 size={11}/>{actLoading==='complete'?'...':'סיים'}</button>}
          {task.status==='in_progress'&&<button className="btn btn-secondary btn-sm gap-1" onClick={()=>setShowPause(true)}><Pause size={11}/>השהה</button>}
          {task.status==='paused'&&<button className="btn btn-primary btn-sm flex-1 justify-center gap-1" onClick={()=>act('resume')} disabled={!!actLoading}><RotateCcw size={11}/>{actLoading==='resume'?'...':'המשך'}</button>}
          {(task.status==='completed'||task.status==='failed_inspection')&&<button className="btn btn-secondary btn-sm flex-1 justify-center gap-1" onClick={()=>setInspecting(true)}><CheckCircle2 size={11}/>בדוק</button>}
          {task.status!=='cancelled'&&<button className="btn btn-ghost btn-sm gap-0.5 text-ink-faint hover:text-red-500" onClick={()=>setShowCancel(true)}><X size={10}/>בטל</button>}
        </div>
      )}

      {/* Secondary actions: DND, No-Service, Lost+Found, Issue */}
      {!isCancelled && !isInspected && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          <button className={`btn btn-sm gap-0.5 text-xs ${task.isDND?'btn-danger':'btn-ghost text-ink-faint'}`} onClick={()=>act('dnd')} disabled={!!actLoading}><BellOff size={10}/>DND</button>
          <button className={`btn btn-sm gap-0.5 text-xs ${task.isNoService?'btn-danger':'btn-ghost text-ink-faint'}`} onClick={()=>act('noservice')} disabled={!!actLoading}><ShieldOff size={10}/>No Svc</button>
          <button className="btn btn-ghost btn-sm gap-0.5 text-xs text-ink-faint hover:text-amber-600" onClick={()=>setShowLF(v=>!v)}><MapPin size={10}/>אבידה</button>
          <button className="btn btn-ghost btn-sm gap-0.5 text-xs text-ink-faint hover:text-orange-600" onClick={()=>setShowIssue(v=>!v)}><Bug size={10}/>תקלה</button>
        </div>
      )}
    </div>
  );
}
  }

export default function HousekeepingPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, toast } = useToast();
  const [filter,      setFilter]      = useState('all');
  const [generating,  setGenerating]  = useState(false);
  const [autoAssigning,setAutoAssign] = useState(false);

  const { data, loading, error, refetch } = useApi(
    () => hkApi.list(propertyId, { date: TODAY }),
    [propertyId], skip
  );

  // Load housekeeping staff for assign dropdowns
  const { data: usersData } = useApi(
    () => usersApi.list(propertyId),
    [propertyId], skip
  );
  const staff = (usersData || []).filter(u => ['housekeeper','housekeeping_manager','manager','admin'].includes(u.role));

  const onToast = useCallback((type, msg) => toast(msg, type), [toast]);

  async function generate() {
    setGenerating(true);
    try {
      const r = await hkApi.generate(propertyId, TODAY);
      toast(`נוצרו ${r.created} משימות חדשות (${r.checkouts} יציאות, ${r.stayovers} שהיות)`, 'success');
      refetch();
    } catch (e) { toast(e.message, 'error'); }
    finally { setGenerating(false); }
  }

  async function autoAssign() {
    setAutoAssign(true);
    try {
      const r = await hkApi.autoAssign(propertyId, TODAY);
      toast(`שויכו ${r.assigned} משימות ל-${r.staffCount} עובדים`, 'success');
      refetch();
    } catch (e) { toast(e.message, 'error'); }
    finally { setAutoAssign(false); }
  }

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const tasks = data || [];

  const counts = {
    all:         tasks.filter(t=>t.status!=='cancelled').length,
    new:         tasks.filter(t=>t.status==='new'||t.status==='assigned').length,
    in_progress: tasks.filter(t=>t.status==='in_progress'||t.status==='paused').length,
    completed:   tasks.filter(t=>t.status==='completed'||t.status==='failed_inspection'||t.status==='inspected').length,
    dnd:         tasks.filter(t=>t.isDND||t.isNoService).length,
  };

  const filtered = tasks.filter(t => {
    if (t.status === 'cancelled' && filter !== 'cancelled') return false;
    if (filter === 'all')        return t.status !== 'cancelled';
    if (filter === 'new')        return t.status === 'new' || t.status === 'assigned';
    if (filter === 'in_progress')return t.status === 'in_progress' || t.status === 'paused';
    if (filter === 'completed')  return t.status === 'completed' || t.status === 'failed_inspection' || t.status === 'inspected';
    if (filter === 'dnd')        return t.isDND || t.isNoService;
    if (filter === 'cancelled')  return t.status === 'cancelled';
    return true;
  });

  const grouped = {
    new:         filtered.filter(t => t.status==='new'||t.status==='assigned'),
    in_progress: filtered.filter(t => t.status==='in_progress'||t.status==='paused'),
    completed:   filtered.filter(t => t.status==='completed'||t.status==='failed_inspection'||t.status==='inspected'),
  };

  // Staff sidebar
  const staffMap = {};
  tasks.forEach(t => {
    if (!t.assignedTo) return;
    const key = String(t.assignedTo._id);
    if (!staffMap[key]) staffMap[key] = { name: `${t.assignedTo.firstName} ${t.assignedTo.lastName}`, total: 0, done: 0 };
    staffMap[key].total++;
    if (t.status === 'completed' || t.status === 'inspected') staffMap[key].done++;
  });
  const staffList = Object.values(staffMap);
  const unassigned = tasks.filter(t => !t.assignedTo && t.status !== 'cancelled').length;

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      <div className="page-header">
        <div><div className="page-title">לוח חדרנות</div><div className="page-subtitle">ניהול משימות ניקיון</div></div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm gap-1" onClick={refetch}><RefreshCw size={12}/>רענן</button>
          <button className="btn btn-secondary btn-sm gap-1" onClick={autoAssign} disabled={autoAssigning}>
            {autoAssigning?<Spinner size={12}/>:<UserPlus size={12}/>} שיוך אוטומטי
          </button>
          <button className="btn btn-primary btn-sm gap-1" onClick={generate} disabled={generating}>
            {generating?<Spinner size={12}/>:<Zap size={12}/>} צור משימות היום
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {[
          { key:'all',          label:'סה"כ',    color:'#6366f1' },
          { key:'new',          label:'ממתין',   color:'#94a3b8' },
          { key:'in_progress',  label:'בביצוע',  color:'#3b82f6' },
          { key:'completed',    label:'הושלם',   color:'#10b981' },
          { key:'dnd',          label:'DND/NoSvc',color:'#ef4444' },
        ].map(({ key, label, color }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-right ${filter===key?'border-brand shadow-card':'border-surface-border bg-white hover:border-brand/40'}`}>
            <div className="text-2xl font-bold text-num flex-shrink-0" style={{ color }}>{counts[key]}</div>
            <div className="text-xs font-medium text-ink-secondary">{label}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
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
                      {taskList.map(t => <TaskCard key={String(t._id)} task={t} propertyId={propertyId} staff={staff} onRefetch={refetch} onToast={onToast} />)}
                      {!taskList.length && <div className="empty-state" style={{padding:24}}><CheckCircle2 size={24} className="empty-state-icon"/><span className="text-xs">אין משימות</span></div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {filtered.map(t => <TaskCard key={String(t._id)} task={t} propertyId={propertyId} staff={staff} onRefetch={refetch} onToast={onToast} />)}
              {!filtered.length && <div className="empty-state col-span-3 mt-4"><Sparkles size={28} className="empty-state-icon"/><span>אין משימות</span></div>}
            </div>
          )}
        </div>

        {/* Staff sidebar */}
        <div className="lg:col-span-1">
          <div className="card">
            <div className="px-4 py-3 border-b border-surface-border">
              <span className="font-semibold text-ink text-sm">צוות חדרנות</span>
            </div>
            <div className="divide-y divide-surface-hover">
              {staffList.map(({ name, total, done }) => (
                <div key={name} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="avatar text-xs" style={{width:26,height:26,fontSize:10,background:'rgba(99,102,241,0.1)',color:'#6366f1'}}>{name.slice(0,2)}</div>
                      <span className="text-sm font-medium text-ink truncate max-w-28">{name}</span>
                    </div>
                    <span className="text-xs text-ink-muted">{done}/{total}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-hover rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: total ? `${(done/total)*100}%` : '0%', background: done===total&&total>0?'#10b981':'#6366f1' }} />
                  </div>
                  <div className="text-xs text-ink-faint mt-1">{total-done} נותרו</div>
                </div>
              ))}
              {!staffList.length && <div className="px-4 py-3 text-xs text-ink-faint">אין עובדים מוקצים</div>}
              <div className="px-4 py-3">
                <div className="text-xs font-semibold text-red-500 mb-1">לא מוקצה</div>
                <div className="text-2xl font-bold text-num text-red-500">{unassigned}</div>
                <div className="text-xs text-ink-muted">ממתינות להקצאה</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
