// OPS-02 — personal housekeeping tasks, built for a phone in the corridor: big targets, one card
// per room, only what the work needs (no guest details). Start/pause/finish are server transitions;
// a failed request is shown as failed, never as done.
import { useEffect, useState } from 'react';
import { BellOff, Play, Pause, CheckCircle2, Wrench, PackageSearch } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops } from '../../utils/api';
import { cleanLabel, TASK_TYPE_LABELS, TASK_STATUS_LABELS, PRIORITY_LABELS } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, Tag, Pill, Empty, ErrorBanner, Spinner, Segmented, useUrlState, useLoader, formatTime } from '../../components/kit';
import OpsNav, { HK_MANAGER_ROLES } from '../../components/ops/OpsNav';
import { PauseDialog, CompleteDialog, TicketDialog, LostItemDialog } from '../../components/ops/OpsDialogs';

const DEFAULTS = { show: 'open', all: '' };
const STATUS_TONE = { in_progress: 'warn', paused: 'bad', failed_inspection: 'bad', assigned: 'muted', new: 'muted', completed: 'ok', inspected: 'ok' };
const OPEN = ['new', 'assigned', 'in_progress', 'paused', 'failed_inspection'];

export default function MyTasksPage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const isSupervisor = HK_MANAGER_ROLES.includes(user?.role);
  const { toasts, success } = useToast();
  const url = useUrlState(DEFAULTS);
  const [dialog, setDialog] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const showAll = isSupervisor && url.get('all') === '1';

  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.myTasks(propertyId, { all: showAll ? '1' : undefined }) : null), [propertyId, showAll]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60000);
    return () => clearInterval(id);
  }, [reload]);

  const tasks = (data?.tasks || []).filter((t) => (url.get('show') === 'open' ? OPEN.includes(t.status) : true));
  const openCount = (data?.tasks || []).filter((t) => OPEN.includes(t.status)).length;
  const doneCount = (data?.tasks || []).filter((t) => ['completed', 'inspected'].includes(t.status)).length;

  async function act(task, fn, okMsg) {
    setBusyId(task.id); setActionError(null);
    try { await fn(); success(okMsg); await reload(); }
    catch (e) { setActionError(`חדר ${task.room?.number}: ${e.message}`); }
    finally { setBusyId(null); }
  }

  return (
    <Page>
      <ToastContainer toasts={toasts} />
      <OpsNav role={user?.role} />
      <div className="ui-toolbar">
        <Segmented
          label="תצוגה"
          value={url.get('show')}
          onChange={(v) => url.set({ show: v })}
          options={[{ value: 'open', label: 'לביצוע', count: data ? openCount : undefined }, { value: 'all', label: 'כל היום', count: data ? data.tasks.length : undefined }]}
        />
        <div className="ui-toolbar-end">
          {data && <span className="ui-muted">{doneCount} הושלמו היום</span>}
          {isSupervisor && (
            <label className="ui-switch"><input type="checkbox" checked={showAll} onChange={(e) => url.set({ all: e.target.checked ? '1' : '' })} />כל הצוות</label>
          )}
        </div>
      </div>
      <ErrorBanner error={actionError} />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && tasks.length === 0 && (
        <Empty title={url.get('show') === 'open' ? 'אין משימות פתוחות' : 'אין משימות להיום'}>
          {url.get('show') === 'open' && openCount === 0 && data.tasks.length > 0 ? 'כל המשימות שלך להיום הושלמו.' : 'משימות חדשות יופיעו כאן כשהמפקח ישבץ אותן.'}
        </Empty>
      )}
      <div className="ui-task-cards">
        {tasks.map((t) => {
          const busy = busyId === t.id;
          const canStart = ['new', 'assigned', 'paused', 'failed_inspection'].includes(t.status) && !t.isDND;
          const done = ['completed', 'inspected'].includes(t.status);
          return (
            <article key={t.id} className={`ui-task-card ${t.status === 'in_progress' ? 'is-active' : ''} ${done ? 'is-done' : ''} ${t.priority === 'urgent' && !done ? 'is-urgent' : ''}`} aria-label={`חדר ${t.room?.number}`}>
              <div className="ui-task-head">
                <div>
                  <div className="ui-row" style={{ gap: 6 }}>
                    <span className="ui-room-n" style={{ fontSize: 22 }}>{t.room?.number}</span>
                    {['urgent', 'high'].includes(t.priority) && <Tag tone={t.priority === 'urgent' ? 'bad' : 'warn'}>{PRIORITY_LABELS[t.priority]}</Tag>}
                    {t.isDND && <Tag tone="warn">DND</Tag>}
                  </div>
                  <div className="ui-sub">{TASK_TYPE_LABELS[t.type]} · {t.room?.type || ''} · קומה {t.room?.floor}</div>
                </div>
                <Pill tone={STATUS_TONE[t.status] || 'muted'}>{TASK_STATUS_LABELS[t.status]}</Pill>
              </div>
              {showAll && t.assignee && <div className="ui-sub">עובד: {t.assignee}</div>}
              {t.returnReason && <div className="ui-banner is-warn">הוחזר מבדיקה: {t.returnReason}</div>}
              {t.status === 'paused' && t.pauseReason && <div className="ui-banner is-info">נעצר: {t.pauseReason}</div>}
              {t.notes && <div className="ui-sub">הערה: {t.notes}</div>}
              <div className="ui-sub">
                ניקיון: {cleanLabel(t.room?.cleanStatus)}
                {t.startedAt && ` · התחיל ${formatTime(t.startedAt)}`}
                {t.completedAt && ` · הסתיים ${formatTime(t.completedAt)}`}
              </div>
              {!done && (
                <div className="ui-task-actions">
                  {t.status === 'in_progress' ? (
                    <>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setDialog({ kind: 'complete', task: t })}><CheckCircle2 size={15} /> סיום</button>
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDialog({ kind: 'pause', task: t })}><Pause size={15} /> עצירה</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !canStart}
                      title={t.isDND ? 'האורח ביקש לא להפריע — הסירו DND רק אחרי שהשלט הוסר' : undefined}
                      onClick={() => act(t, () => ops.start(propertyId, t.id), `התחלת חדר ${t.room?.number}`)}
                    >
                      {busy ? <Spinner /> : <Play size={15} />} {t.status === 'paused' || t.status === 'failed_inspection' ? 'המשך' : 'התחלה'}
                    </button>
                  )}
                  <button type="button" className="btn btn-secondary" disabled={busy} aria-pressed={t.isDND} onClick={() => act(t, () => ops.dnd(propertyId, t.id, !t.isDND), t.isDND ? 'DND הוסר' : 'סומן DND')}>
                    <BellOff size={15} /> {t.isDND ? 'הסרת DND' : 'DND'}
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDialog({ kind: 'ticket', task: t })}><Wrench size={15} /> תקלה</button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDialog({ kind: 'lost', task: t })}><PackageSearch size={15} /> חפץ שנמצא</button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <PauseDialog open={dialog?.kind === 'pause'} onClose={() => setDialog(null)} propertyId={propertyId} task={dialog?.task} onSaved={() => { setDialog(null); success('המשימה נעצרה'); reload(); }} />
      <CompleteDialog
        open={dialog?.kind === 'complete'}
        onClose={() => setDialog(null)}
        propertyId={propertyId}
        task={dialog?.task}
        onSaved={(out) => { setDialog(null); success(out?.awaitsInspection ? 'החדר נקי — ממתין לבדיקה' : 'החדר נקי'); reload(); }}
      />
      <TicketDialog open={dialog?.kind === 'ticket'} onClose={() => setDialog(null)} propertyId={propertyId} room={dialog?.task?.room ? { id: dialog.task.room.id, number: dialog.task.room.number } : null} taskId={dialog?.task?.id} onSaved={() => { setDialog(null); success('התקלה דווחה — החדר לא סומן מוכן'); reload(); }} />
      <LostItemDialog open={dialog?.kind === 'lost'} onClose={() => setDialog(null)} propertyId={propertyId} room={dialog?.task?.room ? { id: dialog.task.room.id, number: dialog.task.room.number } : null} taskId={dialog?.task?.id} onSaved={(out) => { setDialog(null); success(`נרשם ${out?.code || ''}`); }} />
    </Page>
  );
}
