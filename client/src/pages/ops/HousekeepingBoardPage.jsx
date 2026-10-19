// OPS-01 — housekeeping planning. One row per room for the day: occupancy (derived from stays),
// cleanliness, blocking, the day's task and who has it, and minimal arrival info (time / waiting at
// the desk, never guest identity). Supervisors generate, assign in bulk, re-prioritise with a reason.
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Wand2 } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops } from '../../utils/api';
import { addDays, formatLong } from '../../utils/date';
import { cleanLabel, opsLabel, TASK_TYPE_LABELS, TASK_STATUS_LABELS, PRIORITY_LABELS } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Toolbar, Card, Tiles, DataTable, Tag, Pill, Empty, RowMenu, ConfirmDialog, ErrorBanner, Spinner,
  useUrlState, useLoader, useAction, formatTime, minutesSince, formatWait,
} from '../../components/kit';
import OpsNav, { HK_MANAGER_ROLES } from '../../components/ops/OpsNav';
import { CreateTaskDialog, PriorityDialog, TicketDialog } from '../../components/ops/OpsDialogs';

const DEFAULTS = { view: 'all', floor: '', date: '' };
const CLEAN_TONE = { dirty: 'bad', pickup: 'warn', cleaning: 'warn', clean: 'ok', inspected: 'ok', turndown_required: 'warn' };
const TASK_TONE = { new: 'warn', assigned: 'muted', in_progress: 'warn', paused: 'bad', completed: 'ok', failed_inspection: 'bad', inspected: 'ok' };

const VIEWS = {
  all: () => true,
  dirty: (r) => ['dirty', 'pickup'].includes(r.cleanStatus),
  unassigned: (r) => r.tasks.some((t) => !t.assignee && ['new', 'assigned', 'failed_inspection'].includes(t.status)),
  inspection: (r) => r.tasks.some((t) => t.awaitsInspection),
  blocked: (r) => r.opsStatus !== 'available' || r.tickets.blocking,
  waiting: (r) => !!r.arrival?.waiting,
};

const activeTask = (r) => r.tasks.find((t) => !['inspected', 'cancelled'].includes(t.status)) || r.tasks[0] || null;

export default function HousekeepingBoardPage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const canPlan = HK_MANAGER_ROLES.includes(user?.role);
  const { toasts, success } = useToast();
  const url = useUrlState(DEFAULTS);
  const nav = useNavigate();
  const [selected, setSelected] = useState(() => new Set());
  const [assignee, setAssignee] = useState('');
  const [dialog, setDialog] = useState(null);
  const bulk = useAction();
  const gen = useAction();

  const { data, loading, error, reload } = useLoader(async () => {
    if (!propertyId) return null;
    return ops.board(propertyId, { date: url.get('date') || undefined, floor: url.get('floor') || undefined });
  }, [propertyId, url.get('date'), url.get('floor')]);
  useLiveRefresh(propertyId, ['HousekeepingTask', 'Room', 'Reservation'], reload);

  // The board is shared between stations: refresh every minute while visible.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60000);
    return () => clearInterval(id);
  }, [reload]);
  useEffect(() => { setSelected(new Set()); }, [url.key]);

  const viewDate = data?.date;
  const isToday = data && data.date === data.businessDate;
  const c = data?.counts || {};
  const rows = useMemo(() => (data?.rooms || []).filter(VIEWS[url.get('view')] || VIEWS.all), [data, url]);
  const selectableIds = rows.map(activeTask).filter((t) => t && ['new', 'assigned', 'failed_inspection'].includes(t.status)).map((t) => t.id);
  const allOn = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggle = (id) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function assignSelected() {
    const out = await bulk.run(() => ops.assign(propertyId, [...selected], assignee || null));
    if (!out) return;
    setSelected(new Set());
    success(out.failed.length ? `שובצו ${out.assigned}; ${out.failed.length} לא שובצו (בביצוע או הסתיימו)` : `שובצו ${out.assigned} משימות`);
    reload();
  }

  async function generate() {
    const out = await gen.run(() => ops.generate(propertyId, viewDate));
    if (!out) return;
    success(out.created ? `נוצרו ${out.created} משימות` : 'אין משימות חדשות ליצור — הכול כבר קיים');
    reload();
  }

  const columns = useMemo(() => [
    ...(canPlan ? [{
      key: 'sel', label: 'בחירה', srOnly: true, width: 36, render: (r) => {
        const t = activeTask(r);
        const can = t && ['new', 'assigned', 'failed_inspection'].includes(t.status);
        return <input type="checkbox" aria-label={`בחירת חדר ${r.number}`} disabled={!can} checked={!!t && selected.has(t.id)} onChange={() => toggle(t.id)} />;
      },
    }] : []),
    {
      key: 'room', label: 'חדר', nowrap: true, render: (r) => (
        <div>
          <div className="ui-room-n">{r.number}</div>
          <div className="ui-sub">{r.roomType?.name || '—'} · קומה {r.floor}</div>
        </div>
      ),
    },
    {
      key: 'occ', label: 'תפוסה', nowrap: true, render: (r) => (
        <div>
          <div>{r.occupancy.label}</div>
          {r.arrival && (
            <div className="ui-sub">
              {r.arrival.waiting ? <Tag tone="bad">אורח ממתין · {formatWait(minutesSince(r.arrival.waitingSince))}</Tag> : `הגעה${r.arrival.eta ? ` ${r.arrival.eta}` : ' היום'}`}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'clean', label: 'ניקיון', nowrap: true, render: (r) => (
        <div>
          <Pill tone={CLEAN_TONE[r.cleanStatus] || 'muted'}>{cleanLabel(r.cleanStatus)}</Pill>
          {r.ready && <div className="ui-sub">מוכן לאורח</div>}
        </div>
      ),
    },
    {
      key: 'ops', label: 'חסימה', nowrap: true, render: (r) => (
        <div className="ui-stack" style={{ gap: 2 }}>
          {r.opsStatus !== 'available' && <Tag tone="bad">{opsLabel(r.opsStatus)}</Tag>}
          {r.tickets.open > 0 && <span className={`ui-dot-label ${r.tickets.blocking ? 'is-bad' : 'is-warn'}`}>{r.tickets.open} תקלות{r.tickets.blocking ? ' · חוסמת' : ''}</span>}
          {r.dnd && <Tag tone="warn">DND</Tag>}
          {r.opsStatus === 'available' && !r.tickets.open && !r.dnd && <span className="ui-sub">—</span>}
        </div>
      ),
    },
    {
      key: 'task', label: 'משימה', render: (r) => {
        const t = activeTask(r);
        if (!t) return <span className="ui-sub">אין משימה</span>;
        return (
          <div>
            <div className="ui-row" style={{ gap: 6 }}>
              <span>{TASK_TYPE_LABELS[t.type] || t.type}</span>
              {['urgent', 'high'].includes(t.priority) && <Tag tone={t.priority === 'urgent' ? 'bad' : 'warn'}>{PRIORITY_LABELS[t.priority]}</Tag>}
            </div>
            <div className="ui-sub">
              <span className={`ui-dot-label is-${TASK_TONE[t.status] || 'muted'}`}>{t.awaitsInspection ? 'ממתין לבדיקה' : (TASK_STATUS_LABELS[t.status] || t.status)}</span>
              {t.status === 'in_progress' && t.startedAt && ` · מ־${formatTime(t.startedAt)}`}
              {t.status === 'paused' && t.pauseReason && ` · ${t.pauseReason}`}
            </div>
          </div>
        );
      },
    },
    {
      key: 'who', label: 'עובד', nowrap: true, render: (r) => {
        const t = activeTask(r);
        return t?.assignee ? t.assignee.name : <span className="ui-sub">{t ? 'לא שובץ' : '—'}</span>;
      },
    },
    {
      key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (r) => {
        const t = activeTask(r);
        return (
          <div className="ui-row-actions">
            {t?.awaitsInspection && canPlan && <Link className="btn btn-secondary btn-sm" to="/pms/housekeeping/inspection">לבדיקה</Link>}
            <RowMenu
              label={`פעולות — חדר ${r.number}`}
              items={[
                canPlan && { label: 'משימה חדשה לחדר', onSelect: () => setDialog({ kind: 'task', room: r }) },
                canPlan && t && !['inspected', 'completed'].includes(t.status) && { label: 'שינוי עדיפות', hint: 'נדרשת סיבה', onSelect: () => setDialog({ kind: 'priority', task: { ...t, roomNumber: r.number } }) },
                canPlan && t && !['inspected', 'in_progress', 'cancelled'].includes(t.status) && { label: 'ביטול משימה', hint: 'מצב הניקיון לא משתנה', danger: true, onSelect: () => setDialog({ kind: 'cancel', task: t, room: r }) },
                { separator: true },
                { label: 'דיווח תקלה', onSelect: () => setDialog({ kind: 'ticket', room: r }) },
                { label: 'מצב החדר', onSelect: () => nav(`/pms/housekeeping/rooms?q=${encodeURIComponent(r.number)}`) },
              ]}
            />
          </div>
        );
      },
    },
  ], [canPlan, selected, nav]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <OpsNav
        role={user?.role}
        end={canPlan && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'task' })}><Plus size={14} /> משימה</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={generate} disabled={gen.busy || !viewDate} title="יוצר משימות לפי עזיבות, שוהים וחדרים מלוכלכים — בלי כפילויות">
              {gen.busy ? <Spinner /> : <Wand2 size={14} />} יצירת משימות ליום
            </button>
          </>
        )}
      />
      <ErrorBanner error={gen.error} />
      <Toolbar
        start={(
          <>
            <div className="ui-datenav" role="group" aria-label="בחירת יום">
              <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="יום קודם" disabled={!viewDate} onClick={() => url.set({ date: addDays(viewDate, -1) })}><ChevronRight size={15} /></button>
              <label className="ui-datebox"><span className="sr-only">יום</span><input type="date" value={viewDate || ''} onChange={(e) => url.set({ date: e.target.value || null })} /></label>
              <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="יום הבא" disabled={!viewDate} onClick={() => url.set({ date: addDays(viewDate, 1) })}><ChevronLeft size={15} /></button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={isToday} onClick={() => url.set({ date: null })}>היום</button>
            </div>
            {viewDate && <span className="ui-date-label">{formatLong(viewDate)}{data && !isToday && <Tag tone="warn">לא היום העסקי</Tag>}</span>}
          </>
        )}
        end={(
          <>
            <label className="sr-only" htmlFor="hk-floor">קומה</label>
            <select id="hk-floor" className="select select-sm" value={url.get('floor')} onChange={(e) => url.set({ floor: e.target.value })}>
              <option value="">כל הקומות</option>
              {(data?.floors || []).map((f) => <option key={f} value={f}>קומה {f}</option>)}
            </select>
          </>
        )}
      />
      <Tiles
        label="סינון חדרים"
        selected={url.get('view')}
        onSelect={(v) => url.set({ view: v })}
        items={[
          { id: 'all', label: 'כל החדרים', value: data ? c.rooms : undefined },
          { id: 'dirty', label: 'מלוכלכים', value: data ? c.dirty : undefined, tone: c.dirty ? 'warn' : undefined },
          { id: 'unassigned', label: 'משימות לא משובצות', value: data ? c.unassigned : undefined, tone: c.unassigned ? 'warn' : undefined },
          { id: 'inspection', label: 'ממתינים לבדיקה', value: data ? c.awaitingInspection : undefined },
          { id: 'blocked', label: 'חסומים', value: data ? c.blocked : undefined, tone: c.blocked ? 'bad' : undefined },
          { id: 'waiting', label: 'אורח ממתין לחדר', value: data ? c.arrivalsWaiting : undefined, tone: c.arrivalsWaiting ? 'bad' : undefined },
        ]}
      />

      {canPlan && selected.size > 0 && (
        <div className="ui-bulkbar" role="region" aria-label="שיוך מרוכז">
          <strong>{selected.size} נבחרו</strong>
          <label htmlFor="bulk-asg" className="sr-only">עובד</label>
          <select id="bulk-asg" className="select select-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">ללא שיוך (החזרה לרשימה)</option>
            {(data?.staff || []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.total - s.done} פתוחות</option>)}
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={assignSelected} disabled={bulk.busy}>{bulk.busy ? <Spinner /> : null} שיוך</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>ניקוי בחירה</button>
          {bulk.error && <span className="ui-error">{bulk.error}</span>}
        </div>
      )}

      <div className="ui-split">
        <Card flush>
          {canPlan && selectableIds.length > 0 && (
            <div className="ui-card-head">
              <label className="ui-check" style={{ alignItems: 'center' }}>
                <input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(selectableIds))} />
                <span className="ui-sub">בחירת כל המשימות שניתן לשבץ ({selectableIds.length})</span>
              </label>
            </div>
          )}
          <DataTable
            caption="תכנון חדרנות"
            columns={columns}
            rows={data ? rows : undefined}
            loading={loading && !data}
            error={error}
            onRetry={reload}
            filtered={url.get('view') !== 'all' || !!url.get('floor')}
            rowClass={(r) => [r.arrival?.waiting ? 'is-urgent' : '', activeTask(r) && selected.has(activeTask(r).id) ? 'is-selected' : ''].join(' ')}
            empty={<Empty title="אין חדרים פעילים בנכס" />}
          />
        </Card>
        <Card title="צוות היום">
          {!data && loading && <div className="ui-empty"><Spinner /> טוען…</div>}
          {data && data.staff.length === 0 && <Empty title="אין עובדי חדרנות פעילים">משתמשים בתפקיד חדרן/ית מוגדרים בניהול משתמשים.</Empty>}
          {data && data.staff.length > 0 && (
            <ul className="ui-staff">
              {data.staff.map((s) => (
                <li key={s.id}>
                  <div className="min-w-0">
                    <div className="font-medium">{s.name}</div>
                    <div className="ui-sub">{s.total ? `${s.done}/${s.total} הושלמו${s.active ? ' · בחדר עכשיו' : ''}` : 'אין משימות'}</div>
                  </div>
                  <span className="ui-meter" aria-hidden="true"><i style={{ width: `${s.total ? Math.round((s.done / s.total) * 100) : 0}%` }} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CreateTaskDialog open={dialog?.kind === 'task'} onClose={() => setDialog(null)} propertyId={propertyId} room={dialog?.room ? { id: dialog.room.id, number: dialog.room.number } : null} date={viewDate} onSaved={() => { setDialog(null); success('המשימה נוצרה'); reload(); }} />
      <PriorityDialog open={dialog?.kind === 'priority'} onClose={() => setDialog(null)} propertyId={propertyId} task={dialog?.task} onSaved={() => { setDialog(null); success('העדיפות עודכנה'); reload(); }} />
      <TicketDialog open={dialog?.kind === 'ticket'} onClose={() => setDialog(null)} propertyId={propertyId} room={dialog?.room ? { id: dialog.room.id, number: dialog.room.number } : null} onSaved={() => { setDialog(null); success('התקלה נפתחה'); reload(); }} />
      <ConfirmDialog
        open={dialog?.kind === 'cancel'}
        onClose={() => setDialog(null)}
        title="ביטול משימה"
        subtitle={dialog?.room ? `חדר ${dialog.room.number} · ${TASK_TYPE_LABELS[dialog.task?.type] || ''}` : ''}
        confirmLabel="ביטול המשימה"
        danger
        requireReason
        onConfirm={async (reason) => { await ops.cancelTask(propertyId, dialog.task.id, reason); setDialog(null); success('המשימה בוטלה'); reload(); }}
      >
        <p className="ui-p">מצב הניקיון של החדר לא ישתנה — חדר מלוכלך נשאר מלוכלך.</p>
      </ConfirmDialog>
    </Page>
  );
}
