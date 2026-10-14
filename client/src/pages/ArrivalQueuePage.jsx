// FD-04 — waiting-for-room queue. Guests who are physically here, ordered by priority and wait
// time, with the owner, the delay reason and the room's live readiness. Every change is atomic on
// the server (version check); a stale view gets a conflict instead of a silent overwrite.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw, Crown } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useAuthStore } from '../stores/authStore';
import { frontdesk } from '../utils/api';
import { QUEUE_REASON_LABELS, cleanLabel, opsLabel } from '../lib/labels';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import { Modal, Field, Spinner, ErrorBanner, ReadinessBadge, ReasonList, formatTime, formatWait, minutesSince } from '../components/frontdesk/ui';
import AssignRoomDialog from '../components/frontdesk/AssignRoomDialog';

const MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const FRONT_ROLES = [...MANAGER_ROLES, 'receptionist'];
const HK_STATUS_LABELS = { new: 'חדשה', assigned: 'שובצה', in_progress: 'בביצוע', paused: 'מושהית', failed_inspection: 'נכשלה בבדיקה' };

export default function ArrivalQueuePage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const isManager = MANAGER_ROLES.includes(user?.role);
  const isFront = FRONT_ROLES.includes(user?.role);
  const navigate = useNavigate();
  const { toasts, success, error: toastError } = useToast();
  const [view, setView] = useState('active');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [removeRow, setRemoveRow] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [assignRow, setAssignRow] = useState(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true); setError(null);
    try { setData(await frontdesk.queue(propertyId, view === 'active' ? undefined : 'resolved')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [propertyId, view]);

  useEffect(() => { load(); }, [load]);
  // Wait times tick every minute; data refreshes every 2 minutes so "ready now" surfaces.
  useEffect(() => {
    const a = setInterval(() => setTick((t) => t + 1), 60000);
    const b = setInterval(() => { if (view === 'active' && document.visibilityState === 'visible') load(); }, 120000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [load, view]);

  async function act(row, fn, okMsg) {
    setBusyId(row.id);
    try { await fn(); success(okMsg); }
    catch (e) { toastError(e.message); }
    finally { setBusyId(null); load(); }
  }

  const rows = data?.rows || [];

  return (
    <div className="fd-page" dir="rtl">
      <ToastContainer toasts={toasts} />
      <div className="fd-toolbar">
        <div className="fd-seg" role="tablist" aria-label="תצוגה">
          <button type="button" role="tab" aria-selected={view === 'active'} className={view === 'active' ? 'is-on' : ''} onClick={() => setView('active')}>ממתינים{view === 'active' && data ? ` · ${rows.length}` : ''}</button>
          <button type="button" role="tab" aria-selected={view === 'resolved'} className={view === 'resolved' ? 'is-on' : ''} onClick={() => setView('resolved')}>טופלו לאחרונה</button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} aria-label="רענון"><RefreshCw size={14} /></button>
          <Link to="/pms/arrivals" className="btn btn-secondary btn-sm">להגעות</Link>
        </div>
      </div>

      <section className="fd-card" aria-label="תור המתנה לחדר">
        <ErrorBanner error={error} onRetry={load} />
        <div className="fd-table-wrap" aria-busy={loading}>
          <table className="fd-table">
            <thead>
              <tr>
                <th scope="col">אורח</th>
                <th scope="col">חדר</th>
                <th scope="col">המתנה</th>
                <th scope="col">סיבה</th>
                <th scope="col">אחראי</th>
                <th scope="col">{view === 'active' ? 'מצב החדר עכשיו' : 'תוצאה'}</th>
                <th scope="col"><span className="sr-only">פעולות</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && <tr><td colSpan={7}><div className="fd-empty"><Spinner /> טוען…</div></td></tr>}
              {data && rows.length === 0 && (
                <tr><td colSpan={7}><div className="fd-empty">
                  <strong>{view === 'active' ? 'אין אורחים בהמתנה' : 'לא טופלו רשומות ב־36 השעות האחרונות'}</strong>
                  {view === 'active' && 'אורח שהגיע וחדרו לא מוכן נוסף לתור ממסך ההגעות.'}
                </div></td></tr>
              )}
              {rows.map((r) => {
                const wait = view === 'active' ? minutesSince(r.arrivedAt) : Math.round((new Date(r.resolvedAt) - new Date(r.arrivedAt)) / 60000);
                const late = r.readyEta && new Date(r.readyEta) < new Date();
                const mine = r.owner?.id === user?._id;
                const ready = r.readiness?.state === 'ready';
                return (
                  <tr key={r.id} className={r.priority === 'urgent' ? 'is-urgent' : ''}>
                    <td>
                      <div className="font-medium flex items-center gap-1">
                        {r.guest.name}
                        {r.guest.vip && <Crown size={12} className="text-amber-600" aria-label="VIP" />}
                        {r.priority === 'urgent' && <span className="fd-tag is-bad">דחוף</span>}
                      </div>
                      <div className="fd-sub"><bdi>{r.confirmationNumber}</bdi> · הגיע {formatTime(r.arrivedAt)}</div>
                    </td>
                    <td>
                      {r.room ? (
                        <>
                          <div className="tabular-nums font-medium">{r.room.number}</div>
                          <div className="fd-sub">{cleanLabel(r.room.cleanStatus)} · {opsLabel(r.room.opsStatus)}</div>
                        </>
                      ) : <span className="text-[rgb(var(--fg-muted))]">ללא שיבוץ</span>}
                    </td>
                    <td className="tabular-nums">
                      <div className={wait >= 30 && view === 'active' ? 'text-[rgb(185_28_28)] font-medium' : ''}>{formatWait(wait)}</div>
                      {r.readyEta && <div className={`fd-sub ${late ? 'text-[rgb(185_28_28)]' : ''}`}>הערכה {formatTime(r.readyEta)}{late ? ' · עבר' : ''}</div>}
                      {!r.readyEta && view === 'active' && <div className="fd-sub">אין הערכת מוכנות</div>}
                    </td>
                    <td>
                      <div>{QUEUE_REASON_LABELS[r.reason] || r.reason}</div>
                      {r.housekeepingTask && <div className="fd-sub">משימת חדרנות: {HK_STATUS_LABELS[r.housekeepingTask.status] || r.housekeepingTask.status}{r.housekeepingTask.priority === 'urgent' ? ' · דחופה' : ''}</div>}
                      {r.notes && <div className="fd-sub">{r.notes}</div>}
                    </td>
                    <td>
                      <div>{r.owner?.name || '—'}{mine && <span className="fd-sub"> (אני)</span>}</div>
                      {r.guestContact && <div className="fd-sub">עדכון אורח: {r.guestContact === 'desk' ? 'בדלפק' : 'בהודעה'}</div>}
                    </td>
                    <td style={{ minWidth: 200 }}>
                      {view === 'active' ? (
                        <>
                          {r.readiness ? <ReadinessBadge state={r.readiness.state === 'queued' ? 'waiting' : r.readiness.state} /> : '—'}
                          <ReasonList reasons={(r.readiness?.reasons || []).filter((x) => x.code !== 'guarantee')} compact />
                        </>
                      ) : (
                        <div>
                          {r.status === 'checked_in' ? 'נכנס' : 'הוסר'} · {formatTime(r.resolvedAt)}
                          {r.removalReason && <div className="fd-sub">{r.removalReason}</div>}
                        </div>
                      )}
                    </td>
                    <td>
                      {view === 'active' && (
                        <div className="fd-row-actions">
                          {isFront && (
                            <button
                              type="button"
                              className={`btn btn-sm ${ready ? 'btn-primary' : 'btn-secondary'}`}
                              onClick={() => navigate(`/pms/arrivals?date=${encodeURIComponent(data.businessDate)}&checkin=${r.reservationId}`)}
                              title={ready ? undefined : 'האשף יבדוק מחדש את מוכנות החדר'}
                            >כניסה</button>
                          )}
                          {!mine && (
                            <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === r.id} onClick={() => act(r, () => frontdesk.takeQueue(propertyId, r.id, r.version), 'האחריות הועברה אליך')}>קבלת אחריות</button>
                          )}
                          {r.room && r.housekeepingTask?.priority !== 'urgent' && (
                            <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === r.id} onClick={() => act(r, () => frontdesk.prioritizeQueue(propertyId, r.id), 'נשלחה בקשת עדיפות לחדרנות')}>עדיפות לחדרנות</button>
                          )}
                          {isFront && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssignRow({ key: r.id, reservationId: r.reservationId, unitId: r.unitId, confirmationNumber: r.confirmationNumber, guest: r.guest })}>חלופה</button>
                          )}
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditRow(r)}>עדכון</button>
                          {isFront && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoveRow(r)}>הסרה</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="fd-foot">
          <span className="text-[13px] text-[rgb(var(--fg-muted))]">
            ״עדיפות לחדרנות״ מסמנת את משימת הניקיון כדחופה — היא אינה מסמנת את החדר כמוכן.
          </span>
        </div>
      </section>

      <RemoveDialog row={removeRow} propertyId={propertyId} onClose={() => setRemoveRow(null)} onDone={() => { setRemoveRow(null); success('הוסר מהתור'); load(); }} />
      <EditDialog row={editRow} propertyId={propertyId} isManager={isManager} onClose={() => setEditRow(null)} onDone={() => { setEditRow(null); success('עודכן'); load(); }} />
      <AssignRoomDialog
        open={!!assignRow}
        propertyId={propertyId}
        row={assignRow}
        onClose={() => setAssignRow(null)}
        onAssigned={(out) => { setAssignRow(null); success(`שובץ חדר ${out.room.number}`); load(); }}
      />
    </div>
  );
}

function RemoveDialog({ row, propertyId, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setReason(''); setError(null); }, [row]);
  async function submit() {
    setSaving(true); setError(null);
    try { await frontdesk.removeFromQueue(propertyId, row.id, reason, row.version); onDone(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      busy={saving}
      width={460}
      title="הסרה מתור ההמתנה"
      subtitle={row ? `${row.guest.name} · ${row.confirmationNumber}` : ''}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving || reason.trim().length < 3}>{saving ? <><Spinner /> מסיר…</> : 'הסרה מהתור'}</button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      <p className="fd-p">ההסרה אינה מבטלת את ההזמנה ואינה משנה את החדר.</p>
      <Field id="rm-reason" label="סיבת ההסרה" required hint="לדוגמה: האורח יצא ויחזור בערב">
        <input id="rm-reason" className="input w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditDialog({ row, propertyId, isManager, onClose, onDone }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (row) setForm({ reason: row.reason, priority: row.priority, guestContact: row.guestContact || '', readyEta: toLocalInput(row.readyEta), notes: row.notes || '' });
    setError(null);
  }, [row]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit() {
    setSaving(true); setError(null);
    try {
      await frontdesk.updateQueue(propertyId, row.id, {
        version: row.version,
        reason: form.reason,
        priority: form.priority,
        guestContact: form.guestContact || null,
        readyEta: form.readyEta ? new Date(form.readyEta).toISOString() : null,
        notes: form.notes || null,
      });
      onDone();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      busy={saving}
      title="עדכון רשומת המתנה"
      subtitle={row ? `${row.guest.name} · ${row.confirmationNumber}` : ''}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? <><Spinner /> שומר…</> : 'שמירה'}</button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      <div className="fd-grid-2">
        <Field id="ed-reason" label="סיבת עיכוב" required>
          <select id="ed-reason" className="select w-full" value={form.reason || ''} onChange={set('reason')}>
            {Object.entries(QUEUE_REASON_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field id="ed-pri" label="עדיפות" hint={!isManager ? 'העלאה לדחוף דורשת מנהל משמרת' : undefined}>
          <select id="ed-pri" className="select w-full" value={form.priority || 'normal'} onChange={set('priority')}>
            <option value="normal">רגילה</option>
            <option value="urgent" disabled={!isManager && row?.priority !== 'urgent'}>דחופה</option>
          </select>
        </Field>
        <Field id="ed-eta" label="הערכת מוכנות" optional hint="הערכה בלבד">
          <input id="ed-eta" type="datetime-local" className="input w-full" value={form.readyEta || ''} onChange={set('readyEta')} />
        </Field>
        <Field id="ed-contact" label="עדכון האורח" optional>
          <select id="ed-contact" className="select w-full" value={form.guestContact || ''} onChange={set('guestContact')}>
            <option value="">לא הוגדר</option>
            <option value="desk">בדלפק</option>
            <option value="message">בהודעה</option>
          </select>
        </Field>
      </div>
      <Field id="ed-notes" label="הערה" optional>
        <textarea id="ed-notes" className="input w-full" rows={2} maxLength={2000} value={form.notes || ''} onChange={set('notes')} style={{ height: 'auto', paddingBlock: 8 }} />
      </Field>
    </Modal>
  );
}
