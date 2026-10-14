// OPS-04 — room inspection and release. A finished clean waits here; the inspector approves
// (room → inspected), returns it to cleaning with a note, or blocks it (opens a blocking ticket).
// Approval is refused by the server while a blocking ticket is open or the room is held (T04).
import { useEffect, useMemo, useState } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops } from '../../utils/api';
import { cleanLabel, opsLabel, TASK_TYPE_LABELS } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Card, DataTable, Tag, Empty, Modal, Field, ErrorBanner, Spinner, Banner,
  useLoader, useAction, formatTime, minutesSince, formatWait,
} from '../../components/kit';
import OpsNav from '../../components/ops/OpsNav';

const DECISIONS = {
  approve: { label: 'אישור מוכנות', hint: 'החדר יסומן "נבדק" ויוצג לקבלה כמוכן' },
  return: { label: 'החזרה לניקיון', hint: 'המשימה חוזרת לעובד עם ההערה; החדר מסומן מלוכלך' },
  block: { label: 'חסימה', hint: 'נפתחת תקלה חוסמת והחדר יוצא משימוש עד שחרור מנהל' },
};

function InspectDialog({ open, onClose, propertyId, row, checklist, inspectorMustDiffer, me, onSaved }) {
  const action = useAction();
  const [items, setItems] = useState([]);
  const [defects, setDefects] = useState([]);
  const [decision, setDecision] = useState('approve');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) { setItems(checklist.map((item) => ({ item, done: false }))); setDefects([]); setDecision('approve'); setNote(''); action.reset(); }
  }, [open, row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!row) return null;
  const blocking = row.openTickets.filter((t) => t.blocking);
  const ownWork = inspectorMustDiffer && row.cleaner?.id === me;
  const heldRoom = row.room?.opsStatus && row.room.opsStatus !== 'available';
  const missing = items.filter((i) => !i.done).length;
  const seriousDefect = defects.some((d) => d.text.trim() && d.severity !== 'minor');
  let why = null;
  if (ownWork) why = 'הפרדת תפקידים: מי שניקה אינו מאשר';
  else if (decision === 'approve' && blocking.length) why = 'יש תקלה חוסמת פתוחה';
  else if (decision === 'approve' && heldRoom) why = `החדר חסום (${opsLabel(row.room.opsStatus)})`;
  else if (decision === 'approve' && missing) why = `נותרו ${missing} סעיפים`;
  else if (decision === 'approve' && seriousDefect) why = 'ליקוי מהותי — החזירו או חסמו';
  else if (decision !== 'approve' && note.trim().length < 3) why = 'נדרשת הערה';

  const submit = () => action.run(async () => {
    const out = await ops.inspect(propertyId, row.id, { decision, checklist: items, defects: defects.filter((d) => d.text.trim()), note: note.trim() || undefined });
    onSaved?.(out);
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={action.busy}
      width={600}
      title={`בדיקת חדר ${row.room?.number}`}
      subtitle={`${TASK_TYPE_LABELS[row.type] || ''} · ניקה: ${row.cleaner?.name || 'לא ידוע'} · הסתיים ${formatTime(row.completedAt)}`}
      footer={(
        <>
          {why && <span className="ui-foot-note">{why}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
          <button type="button" className={`btn ${decision === 'block' ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={action.busy || !!why}>
            {action.busy ? <><Spinner /> שומר…</> : DECISIONS[decision].label}
          </button>
        </>
      )}
    >
      <ErrorBanner error={action.error} />
      {ownWork && <Banner tone="warn">את החדר הזה ניקית בעצמך. לפי מדיניות הנכס בודק אחר צריך לאשר אותו.</Banner>}
      {blocking.length > 0 && (
        <Banner tone="error">
          תקלה חוסמת פתוחה: {blocking.map((t) => t.description).join(' · ')}. אי אפשר לאשר מוכנות עד שהתקלה תטופל והחדר ישוחרר.
        </Banner>
      )}
      {row.arrival?.waiting && <Banner tone="warn">אורח ממתין לחדר הזה בקבלה ({formatWait(minutesSince(row.arrival.waitingSince))}).</Banner>}
      <div>
        <div className="ui-section-title">רשימת בדיקה</div>
        <ul className="ui-checklist">
          {items.map((it, i) => (
            <li key={it.item}>
              <label className="ui-check">
                <input type="checkbox" checked={it.done} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
                <span>{it.item}</span>
              </label>
            </li>
          ))}
        </ul>
        {items.length > 0 && <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setItems((p) => p.map((x) => ({ ...x, done: true })))}>סימון הכול</button>}
      </div>
      <div>
        <div className="ui-section-title">ליקויים</div>
        <div className="ui-stack" style={{ gap: 6 }}>
          {defects.map((d, i) => (
            <div key={i} className="ui-defect">
              <label className="sr-only" htmlFor={`df-${i}`}>תיאור ליקוי</label>
              <input id={`df-${i}`} className="input w-full" maxLength={300} value={d.text} onChange={(e) => setDefects((p) => p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="מה נמצא" />
              <label className="sr-only" htmlFor={`dfs-${i}`}>חומרה</label>
              <select id={`dfs-${i}`} className="select" value={d.severity} onChange={(e) => setDefects((p) => p.map((x, j) => (j === i ? { ...x, severity: e.target.value } : x)))}>
                <option value="minor">קל</option>
                <option value="major">מהותי</option>
                <option value="blocking">חוסם</option>
              </select>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDefects((p) => p.filter((_, j) => j !== i))}>הסרה</button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDefects((p) => [...p, { text: '', severity: 'minor' }])}>הוספת ליקוי</button>
        </div>
      </div>
      <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
        <legend className="ui-label">החלטה · חובה</legend>
        {Object.entries(DECISIONS).map(([v, d]) => (
          <label key={v} className="ui-radio">
            <input type="radio" name="decision" value={v} checked={decision === v} onChange={() => setDecision(v)} />
            <span>{d.label}<span className="ui-sub" style={{ display: 'block' }}>{d.hint}</span></span>
          </label>
        ))}
      </fieldset>
      <Field id="ins-note" label="הערה" required={decision !== 'approve'} optional={decision === 'approve'} error={action.fields.note}>
        <textarea id="ins-note" className="input w-full" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

export default function InspectionPage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const me = user?._id || user?.id;
  const { toasts, success } = useToast();
  const [active, setActive] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.inspections(propertyId) : null), [propertyId]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60000);
    return () => clearInterval(id);
  }, [reload]);

  // Rooms with a guest waiting come first, then the longest-waiting clean.
  const rows = useMemo(() => [...(data?.rows || [])].sort((a, b) => (b.arrival?.waiting ? 1 : 0) - (a.arrival?.waiting ? 1 : 0) || new Date(a.completedAt) - new Date(b.completedAt)), [data]);

  const columns = [
    { key: 'room', label: 'חדר', nowrap: true, render: (r) => <div><div className="ui-room-n">{r.room?.number}</div><div className="ui-sub">{r.room?.type} · קומה {r.room?.floor}</div></div> },
    { key: 'type', label: 'עבודה', render: (r) => <div><div>{TASK_TYPE_LABELS[r.type]}</div><div className="ui-sub">{r.cleaner?.name || '—'}</div></div> },
    { key: 'wait', label: 'ממתין', nowrap: true, render: (r) => <div><div className="ui-num">{formatWait(minutesSince(r.completedAt))}</div><div className="ui-sub">מאז {formatTime(r.completedAt)}</div></div> },
    {
      key: 'state', label: 'מצב החדר', render: (r) => (
        <div className="ui-stack" style={{ gap: 2 }}>
          <span>{cleanLabel(r.room?.cleanStatus)}{r.room?.opsStatus !== 'available' && <Tag tone="bad">{opsLabel(r.room?.opsStatus)}</Tag>}</span>
          {r.openTickets.length > 0 && <span className={`ui-dot-label ${r.openTickets.some((t) => t.blocking) ? 'is-bad' : 'is-warn'}`}>{r.openTickets.length} תקלות פתוחות</span>}
        </div>
      ),
    },
    { key: 'arr', label: 'הגעה', nowrap: true, render: (r) => (r.arrival ? (r.arrival.waiting ? <Tag tone="bad">אורח ממתין</Tag> : <span className="ui-sub">היום{r.arrival.eta ? ` ${r.arrival.eta}` : ''}</span>) : <span className="ui-sub">—</span>) },
    { key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (r) => <div className="ui-row-actions"><button type="button" className="btn btn-primary btn-sm" onClick={() => setActive(r)}>בדיקה</button></div> },
  ];

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <OpsNav role={user?.role} end={data && <span className="ui-muted">{data.inspectorMustDiffer ? 'מדיניות: בודק שונה מהמנקה' : 'מדיניות: המנקה רשאי לאשר'}</span>} />
      <Card flush>
        <DataTable
          caption="חדרים לבדיקה"
          columns={columns}
          rows={data ? rows : undefined}
          loading={loading && !data}
          error={error}
          onRetry={reload}
          rowClass={(r) => (r.arrival?.waiting ? 'is-urgent' : '')}
          empty={<Empty title="אין חדרים שממתינים לבדיקה">חדרים יופיעו כאן כשעובד מסיים ניקיון עזיבה, יסודי או הכנה להגעה.</Empty>}
        />
      </Card>
      <InspectDialog
        open={!!active}
        onClose={() => setActive(null)}
        propertyId={propertyId}
        row={active}
        checklist={data?.checklist || []}
        inspectorMustDiffer={data?.inspectorMustDiffer}
        me={me}
        onSaved={(out) => {
          setActive(null);
          success(out.decision === 'approve' ? `חדר ${out.room.number} מוכן לאורח` : out.decision === 'return' ? `חדר ${out.room.number} הוחזר לניקיון` : `חדר ${out.room.number} נחסם ונפתחה תקלה`);
          reload();
        }}
      />
    </Page>
  );
}
