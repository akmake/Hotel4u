import { Link } from 'react-router-dom';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
// OPS-06 — maintenance tickets. Taking a ticket is atomic; "fixed" and "closed" are separate steps
// with a note each; fixing never makes a room available or clean — unblocking is a manager decision
// that the server refuses while any other blocking ticket is open.
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops } from '../../utils/api';
import {
  TICKET_STATUS_LABELS, TICKET_PRIORITY_LABELS, TICKET_CATEGORY_LABELS, GUEST_IMPACT_LABELS, opsLabel,
} from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Toolbar, Card, Tiles, Segmented, SearchBox, DataTable, Tag, Pill, Empty, RowMenu, Drawer, KeyValues,
  ConfirmDialog, Field, ErrorBanner, Spinner, useUrlState, useLoader, useAction, formatDateTime, money,
} from '../../components/kit';
import { MT_MANAGER_ROLES, MT_STAFF, UNBLOCK_ROLES } from '../../components/ops/OpsNav';
import { TicketDialog } from '../../components/ops/OpsDialogs';

const DEFAULTS = { status: 'open', priority: '', q: '', mine: '' };
const PRIORITY_TONE = { critical: 'bad', high: 'warn', medium: 'muted', low: 'muted' };
const STATUS_TONE = { new: 'warn', assigned: 'muted', in_progress: 'warn', waiting_parts: 'warn', waiting_vendor: 'warn', resolved: 'ok', verified: 'ok', closed: 'muted', reopened: 'bad' };
const OPEN = ['new', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor', 'reopened'];
const REOPEN_ROLES = [...MT_MANAGER_ROLES, ...MT_STAFF, 'housekeeping_manager', 'front_desk_manager'];

function TicketDrawer({ id, propertyId, role, me, onClose, onChanged }) {
  const isWorker = [...MT_MANAGER_ROLES, ...MT_STAFF].includes(role);
  const isMgr = MT_MANAGER_ROLES.includes(role);
  const { data: t, loading, error, reload } = useLoader(() => (id ? ops.ticket(propertyId, id) : null), [id, propertyId]);
  const staff = useLoader(() => (id && isMgr ? ops.staff(propertyId, 'maintenance') : null), [id, isMgr, propertyId]);
  const save = useAction();
  const [f, setF] = useState({});
  const [confirm, setConfirm] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState(null);
  useEffect(() => {
    if (t) setF({ status: '', priority: t.priority, dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 16) : '', vendor: t.vendor || '', estimatedCost: t.estimatedCost ?? '', actualCost: t.actualCost ?? '', note: '', assigneeId: t.assignee?.id || '' });
  }, [t]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const isOpen = t && OPEN.includes(t.status);

  async function submit() {
    const body = { version: t.version };
    if (f.status && f.status !== t.status) body.status = f.status;
    if (f.priority !== t.priority) body.priority = f.priority;
    const due = t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 16) : '';
    if (f.dueDate !== due) body.dueDate = f.dueDate || null;
    if ((f.vendor || '') !== (t.vendor || '')) body.vendor = f.vendor;
    if (isMgr && String(f.estimatedCost) !== String(t.estimatedCost ?? '')) body.estimatedCost = f.estimatedCost === '' ? null : Number(f.estimatedCost);
    if (isMgr && String(f.actualCost) !== String(t.actualCost ?? '')) body.actualCost = f.actualCost === '' ? null : Number(f.actualCost);
    if (isMgr && (f.assigneeId || '') !== (t.assignee?.id || '')) body.assigneeId = f.assigneeId || null;
    if (f.note.trim()) body.note = f.note.trim();
    if (Object.keys(body).length === 1) return;
    const out = await save.run(() => ops.updateTicket(propertyId, t.id, body));
    if (out) { await reload(); onChanged('התקלה עודכנה'); }
    else if (save.error) reload();
  }

  const run = async (fn, msg) => { await fn(); setConfirm(null); await reload(); onChanged(msg); };

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      busy={save.busy}
      width={600}
      title={t ? `${TICKET_CATEGORY_LABELS[t.category] || t.category} · ${t.room ? `חדר ${t.room.number}` : t.area || ''}` : 'תקלה'}
      subtitle={t ? `${TICKET_STATUS_LABELS[t.status]} · נפתחה ${formatDateTime(t.createdAt)}${t.reportedBy ? ` ע״י ${t.reportedBy}` : ''}` : ''}
      footer={t && (
        <>
          {isWorker && ['new', 'assigned', 'reopened'].includes(t.status) && (!t.assignee || t.assignee.id === me) && (
            <button type="button" className="btn btn-secondary" onClick={() => run(() => ops.takeTicket(propertyId, t.id), 'קיבלת את התקלה לטיפול')}>קבלת טיפול</button>
          )}
          {isWorker && isOpen && <button type="button" className="btn btn-secondary" onClick={() => setConfirm('resolve')}>סיום תיקון</button>}
          {isWorker && ['resolved', 'verified'].includes(t.status) && (
            <button type="button" className="btn btn-secondary" disabled={t.priority === 'critical' && !isMgr} title={t.priority === 'critical' && !isMgr ? 'תקלה מסוכנת נסגרת ע״י מנהל תחזוקה' : undefined} onClick={() => setConfirm('close')}>סגירה</button>
          )}
          {REOPEN_ROLES.includes(role) && ['resolved', 'verified', 'closed'].includes(t.status) && <button type="button" className="btn btn-secondary" onClick={() => setConfirm('reopen')}>פתיחה מחדש</button>}
          {isWorker && isOpen && <button type="button" className="btn btn-primary" onClick={submit} disabled={save.busy}>{save.busy ? <><Spinner /> שומר…</> : 'שמירת שינויים'}</button>}
        </>
      )}
    >
      <ErrorBanner error={error} onRetry={reload} />
      <ErrorBanner error={save.error} />
      {loading && !t && <div className="ui-empty"><Spinner /> טוען…</div>}
      {t && (
        <>
          {t.room && t.room.opsStatus !== 'available' && (
            <div className="ui-banner is-warn">
              החדר {opsLabel(t.room.opsStatus)}. {['resolved', 'verified', 'closed'].includes(t.status) ? 'התיקון לא משחרר אותו — שחרור חסימה הוא החלטת מנהל (מצב חדרים).' : 'הוא יישאר חסום עד שחרור מנהל.'}
            </div>
          )}
          <KeyValues rows={[
            ['תיאור', t.description],
            ['חומרה', <Pill key="p" tone={PRIORITY_TONE[t.priority]}>{TICKET_PRIORITY_LABELS[t.priority]}</Pill>],
            ['השפעה על אירוח', GUEST_IMPACT_LABELS[t.guestImpact]],
            ['אחראי', t.assignee?.name || 'לא שובץ'],
            ['מועד יעד', t.dueDate ? <span key="d" className={t.overdue ? 'ui-error' : ''}>{formatDateTime(t.dueDate)}{t.overdue ? ' · באיחור' : ''}</span> : '—'],
            t.resolvedAt && ['תוקן', formatDateTime(t.resolvedAt)],
            t.closingNote && ['הערת סגירה', t.closingNote],
            t.reopenReason && ['סיבת פתיחה מחדש', t.reopenReason],
            isMgr && (t.estimatedCost != null || t.actualCost != null) && ['עלות', `${t.estimatedCost != null ? `הערכה ${money(t.estimatedCost)}` : ''}${t.actualCost != null ? ` · בפועל ${money(t.actualCost)}` : ''}`],
          ]} />

          {isWorker && isOpen && (
            <div className="ui-stack" style={{ gap: 10 }}>
              <div className="ui-section-title">עדכון</div>
              <div className="ui-grid-2">
                <Field id="td-st" label="מצב">
                  <select id="td-st" className="select w-full" value={f.status || ''} onChange={(e) => set('status')(e.target.value)}>
                    <option value="">{TICKET_STATUS_LABELS[t.status]} (ללא שינוי)</option>
                    {['in_progress', 'waiting_parts', 'waiting_vendor'].filter((s) => s !== t.status).map((s) => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}
                  </select>
                </Field>
                <Field id="td-pr" label="חומרה">
                  <select id="td-pr" className="select w-full" value={f.priority || ''} onChange={(e) => set('priority')(e.target.value)}>
                    {Object.entries(TICKET_PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                {isMgr && (
                  <Field id="td-as" label="אחראי">
                    <select id="td-as" className="select w-full" value={f.assigneeId || ''} onChange={(e) => set('assigneeId')(e.target.value)}>
                      <option value="">לא שובץ</option>
                      {(staff.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </Field>
                )}
                <Field id="td-due" label="מועד יעד" optional>
                  <input id="td-due" type="datetime-local" className="input w-full" value={f.dueDate || ''} onChange={(e) => set('dueDate')(e.target.value)} />
                </Field>
                <Field id="td-ven" label="ספק" optional hint="שם הספק בלבד — אישורים מהספק נשמרים כהערה">
                  <input id="td-ven" className="input w-full" maxLength={120} value={f.vendor || ''} onChange={(e) => set('vendor')(e.target.value)} />
                </Field>
                {isMgr && (
                  <>
                    <Field id="td-ec" label="עלות משוערת" optional>
                      <input id="td-ec" type="number" min="0" step="0.01" inputMode="decimal" className="input w-full" value={f.estimatedCost} onChange={(e) => set('estimatedCost')(e.target.value)} />
                    </Field>
                    <Field id="td-ac" label="עלות בפועל" optional>
                      <input id="td-ac" type="number" min="0" step="0.01" inputMode="decimal" className="input w-full" value={f.actualCost} onChange={(e) => set('actualCost')(e.target.value)} />
                    </Field>
                  </>
                )}
              </div>
              <Field id="td-note" label="הוספת הערה" optional>
                <textarea id="td-note" className="input w-full" rows={2} maxLength={1000} value={f.note || ''} onChange={(e) => set('note')(e.target.value)} />
              </Field>
            </div>
          )}

          {t.parts.length > 0 && (
            <div>
              <div className="ui-section-title">חלקים</div>
              <ul className="ui-staff">{t.parts.map((p, i) => <li key={i}><span>{p.name} × {p.quantity}</span><span className="ui-sub">{p.ordered ? 'הוזמן' : 'טרם הוזמן'}</span></li>)}</ul>
            </div>
          )}
          <div>
            <div className="ui-section-title">תמונות ({t.photos?.length || 0})</div>
            <div className="ticket-photos">
              {(t.photos || []).map((p) => <a key={p.url} href={p.url} target="_blank" rel="noreferrer" title={p.caption || formatDateTime(p.at)}><img src={p.url} alt={p.caption || 'תמונת תקלה'} loading="lazy" /></a>)}
              {(t.photos?.length || 0) < 10 && (
                <label className="ticket-photo-add">
                  {photoBusy ? <Spinner /> : '+ תמונה'}
                  <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={photoBusy}
                    onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setPhotoBusy(true); setPhotoErr(null); try { await ops.ticketPhoto(propertyId, t.id, file); reload(); } catch (err) { setPhotoErr(err.message); } finally { setPhotoBusy(false); } }} />
                </label>
              )}
            </div>
            <ErrorBanner error={photoErr} />
          </div>
          <div>
            <div className="ui-section-title">הערות והיסטוריה</div>
            <ol className="ui-timeline">
              {t.notes.map((n, i) => <li key={`n${i}`}><span>{n.text}</span><span className="ui-sub">{n.by || '—'} · {formatDateTime(n.at)}</span></li>)}
              {t.notes.length === 0 && <li><span className="ui-sub">אין הערות</span></li>}
            </ol>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirm === 'resolve'}
        onClose={() => setConfirm(null)}
        title="סיום תיקון"
        subtitle={t ? `${TICKET_CATEGORY_LABELS[t.category]} · ${t.room ? `חדר ${t.room.number}` : t.area || ''}` : ''}
        confirmLabel="סימון כתוקן"
        requireReason
        reasonLabel="מה תוקן"
        onConfirm={(note) => run(() => ops.resolveTicket(propertyId, t.id, note), 'התקלה סומנה כתוקנה')}
      >
        <p className="ui-p">אם התקלה בחדר, נוצרת משימת סידור לחדרנות. החדר לא משתחרר ולא מסומן נקי אוטומטית.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'close'} onClose={() => setConfirm(null)} title="סגירת תקלה" confirmLabel="סגירה" requireReason reasonLabel="תיעוד הסגירה" onConfirm={(note) => run(() => ops.closeTicket(propertyId, t.id, note), 'התקלה נסגרה')} />
      <ConfirmDialog open={confirm === 'reopen'} onClose={() => setConfirm(null)} title="פתיחה מחדש" confirmLabel="פתיחה מחדש" requireReason onConfirm={(reason) => run(() => ops.reopenTicket(propertyId, t.id, reason), 'התקלה נפתחה מחדש')} />
    </Drawer>
  );
}

export default function MaintenancePage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const me = user?._id || user?.id;
  const isWorker = [...MT_MANAGER_ROLES, ...MT_STAFF].includes(role);
  const { toasts, success, error: toastError } = useToast();
  const url = useUrlState(DEFAULTS);
  const [dialog, setDialog] = useState(null);
  const openId = url.params.get('ticket');

  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.tickets(propertyId, {
    status: url.get('status'), priority: url.get('priority') || undefined, q: url.get('q') || undefined, mine: url.get('mine') || undefined,
  }) : null), [propertyId, url.get('status'), url.get('priority'), url.get('q'), url.get('mine')]);
  useLiveRefresh(propertyId, ['MaintenanceTicket', 'Room'], reload);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60000);
    return () => clearInterval(id);
  }, [reload]);
  const c = data?.counts || {};

  const take = async (t) => {
    try { await ops.takeTicket(propertyId, t.id); success('קיבלת את התקלה לטיפול'); }
    catch (e) { toastError(e.message); }
    reload();
  };

  const columns = useMemo(() => [
    { key: 'pri', label: 'חומרה', nowrap: true, render: (t) => <Pill tone={PRIORITY_TONE[t.priority]}>{TICKET_PRIORITY_LABELS[t.priority]}</Pill> },
    {
      key: 'what', label: 'תקלה', render: (t) => (
        <div>
          <button type="button" className="ui-link font-medium" onClick={() => url.set({ ticket: t.id }, { resetPage: false })}>{TICKET_CATEGORY_LABELS[t.category] || t.category}</button>
          <div className="ui-sub" style={{ maxWidth: 360 }}>{t.description}</div>
        </div>
      ),
    },
    {
      key: 'where', label: 'מיקום', nowrap: true, render: (t) => (
        <div>
          <div>{t.room ? `חדר ${t.room.number}` : t.area || '—'}</div>
          {t.room && t.room.opsStatus !== 'available' && <Tag tone="bad">{opsLabel(t.room.opsStatus)}</Tag>}
          {t.guestImpact === 'move' && <Tag tone="warn">מעבר אורח</Tag>}
        </div>
      ),
    },
    { key: 'who', label: 'אחראי', nowrap: true, render: (t) => t.assignee?.name || <span className="ui-sub">לא שובץ</span> },
    { key: 'due', label: 'יעד', nowrap: true, render: (t) => (t.dueDate ? <span className={t.overdue ? 'ui-error' : 'ui-num'}>{formatDateTime(t.dueDate)}{t.overdue ? ' · באיחור' : ''}</span> : <span className="ui-sub">—</span>) },
    { key: 'st', label: 'מצב', nowrap: true, render: (t) => <Pill tone={STATUS_TONE[t.status] || 'muted'}>{TICKET_STATUS_LABELS[t.status]}</Pill> },
    {
      key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (t) => (
        <div className="ui-row-actions">
          {isWorker && ['new', 'assigned', 'reopened'].includes(t.status) && (!t.assignee || t.assignee.id === me) && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => take(t)}>קבלת טיפול</button>
          )}
          <RowMenu
            label={`פעולות — ${t.description.slice(0, 30)}`}
            items={[
              { label: 'פתיחת התיק', onSelect: () => url.set({ ticket: t.id }, { resetPage: false }) },
              t.room && t.room.opsStatus !== 'available' && ['resolved', 'verified', 'closed'].includes(t.status) && {
                label: 'שחרור חסימת החדר', disabled: !UNBLOCK_ROLES.includes(role), why: 'למנהל בלבד', onSelect: () => setDialog({ kind: 'unblock', ticket: t }),
              },
            ]}
          />
        </div>
      ),
    },
  ], [isWorker, me, role, url]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page wide title="תחזוקה" back="/pms">
      <ToastContainer toasts={toasts} />
      <Toolbar
        start={(
          <>
            <Segmented
              label="מצב"
              value={url.get('status')}
              onChange={(v) => url.set({ status: v })}
              options={[{ value: 'open', label: 'פתוחות' }, { value: 'resolved', label: 'תוקנו' }, { value: 'closed', label: 'סגורות' }, { value: 'all', label: 'הכול' }]}
            />
            <SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="חיפוש בתיאור" id="mt-q" />
            <label className="sr-only" htmlFor="mt-pri">חומרה</label>
            <select id="mt-pri" className="select select-sm" value={url.get('priority')} onChange={(e) => url.set({ priority: e.target.value })}>
              <option value="">כל החומרות</option>
              {Object.entries(TICKET_PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {isWorker && <label className="ui-switch"><input type="checkbox" checked={url.get('mine') === '1'} onChange={(e) => url.set({ mine: e.target.checked ? '1' : '' })} />שלי</label>}
          </>
        )}
        end={<><Link to="/pms/maintenance/preventive" className="btn btn-secondary btn-sm">תחזוקה מונעת</Link><button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'new' })}><Plus size={14} /> תקלה חדשה</button></>}
      />
      <Tiles
        label="תקלות פתוחות"
        items={[
          { id: 'open', label: 'פתוחות', value: data ? c.open : undefined, static: true },
          { id: 'critical', label: 'מסוכנות', value: data ? c.critical : undefined, tone: c.critical ? 'bad' : undefined, static: true },
          { id: 'blocking', label: 'חוסמות חדר', value: data ? c.blocking : undefined, tone: c.blocking ? 'warn' : undefined, static: true },
          { id: 'unassigned', label: 'לא שובצו', value: data ? c.unassigned : undefined, tone: c.unassigned ? 'warn' : undefined, static: true },
          { id: 'overdue', label: 'באיחור', value: data ? c.overdue : undefined, tone: c.overdue ? 'bad' : undefined, static: true },
        ]}
      />
      <Card flush>
        <DataTable
          caption="תקלות"
          columns={columns}
          rows={data?.rows}
          loading={loading && !data}
          error={error}
          onRetry={reload}
          filtered={!!(url.get('priority') || url.get('q') || url.get('mine'))}
          rowClass={(t) => (t.priority === 'critical' && OPEN.includes(t.status) ? 'is-urgent' : ['closed'].includes(t.status) ? 'is-done' : '')}
          empty={<Empty title={url.get('status') === 'open' ? 'אין תקלות פתוחות' : 'אין תקלות'} />}
        />
      </Card>

      <TicketDrawer
        id={openId}
        propertyId={propertyId}
        role={role}
        me={me}
        onClose={() => { url.set({ ticket: null }, { resetPage: false }); reload(); }}
        onChanged={(msg) => { success(msg); reload(); }}
      />
      <TicketDialog open={dialog?.kind === 'new'} onClose={() => setDialog(null)} propertyId={propertyId} canAssign={MT_MANAGER_ROLES.includes(role)} onSaved={(out) => { setDialog(null); success('התקלה נפתחה'); reload(); if (out?.id) url.set({ ticket: out.id }, { resetPage: false }); }} />
      <ConfirmDialog
        open={dialog?.kind === 'unblock'}
        onClose={() => setDialog(null)}
        title={`שחרור חסימת חדר ${dialog?.ticket?.room?.number || ''}`}
        confirmLabel="שחרור לשימוש"
        requireReason
        onConfirm={async (reason) => { await ops.unblock(propertyId, dialog.ticket.room.id, reason); setDialog(null); success('החדר שוחרר לשימוש'); reload(); }}
      >
        <p className="ui-p">השרת יסרב אם יש לחדר תקלה חוסמת פתוחה אחרת. השחרור לא מסמן את החדר נקי.</p>
      </ConfirmDialog>
    </Page>
  );
}
