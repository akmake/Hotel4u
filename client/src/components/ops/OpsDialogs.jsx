// Dialogs shared by the operations screens (OPS-01…OPS-06). Each one validates on the server and
// shows field errors on the field; nothing here decides a business rule on its own.
import { useEffect, useState } from 'react';
import { ops } from '../../utils/api';
import { Modal, Field, ErrorBanner, Spinner, useAction, useLoader } from '../kit';
import {
  TASK_TYPE_LABELS, PRIORITY_LABELS, PAUSE_REASON_LABELS, TICKET_CATEGORY_LABELS, TICKET_PRIORITY_LABELS,
  GUEST_IMPACT_LABELS, LOST_CATEGORY_LABELS, DISPOSAL_LABELS,
} from '../../lib/labels';

// Modal with a form: Enter submits, the primary button names the action, disabled says why.
function FormModal({ open, onClose, title, subtitle, action, submitLabel, onSubmit, blockedWhy, children, width = 520, danger = false }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={action.busy}
      width={width}
      title={title}
      subtitle={subtitle}
      footer={(
        <>
          {blockedWhy && <span className="ui-foot-note">{blockedWhy}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
          <button type="submit" form="ops-form" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={action.busy || !!blockedWhy}>
            {action.busy ? <><Spinner /> שומר…</> : submitLabel}
          </button>
        </>
      )}
    >
      <form id="ops-form" className="ui-stack" onSubmit={(e) => { e.preventDefault(); if (!blockedWhy) onSubmit(); }} noValidate>
        <ErrorBanner error={action.error} />
        {children}
      </form>
    </Modal>
  );
}

const Select = ({ id, value, onChange, options, placeholder, invalid }) => (
  <select id={id} className="select w-full" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid ? 'true' : undefined}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {Object.entries(options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);

function useRoomsAndStaff(propertyId, open, kind) {
  const rooms = useLoader(() => (open && propertyId ? ops.roomsLite(propertyId) : null), [open, propertyId]);
  const staff = useLoader(() => (open && propertyId && kind ? ops.staff(propertyId, kind) : null), [open, propertyId, kind]);
  return { rooms: rooms.data || [], staff: staff.data || [] };
}

// ── OPS-06: report a fault (from anywhere: board, my tasks, room status, maintenance) ─────
export function TicketDialog({ open, onClose, propertyId, room, taskId, canAssign = false, onSaved }) {
  const action = useAction();
  const { rooms, staff } = useRoomsAndStaff(propertyId, open, canAssign ? 'maintenance' : null);
  const [f, setF] = useState({});
  useEffect(() => {
    if (open) { setF({ roomId: room?.id || '', area: '', category: '', priority: 'medium', guestImpact: 'none', description: '', assigneeId: '', dueDate: '' }); action.reset(); }
  }, [open, room?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const e = action.fields;
  const submit = () => action.run(async () => {
    const out = await ops.createTicket(propertyId, { ...f, roomId: f.roomId || undefined, area: f.roomId ? undefined : f.area, taskId, dueDate: f.dueDate || undefined, assigneeId: f.assigneeId || undefined });
    onSaved?.(out);
  });
  return (
    <FormModal open={open} onClose={onClose} action={action} title="דיווח תקלה" subtitle={room ? `חדר ${room.number}` : 'חדר, אזור או ציוד'} submitLabel="פתיחת תקלה" onSubmit={submit} width={560}>
      <div className="ui-grid-2">
        <Field id="tk-room" label="חדר" error={e.roomId} hint={!f.roomId ? 'או מלאו אזור' : undefined}>
          <select id="tk-room" className="select w-full" value={f.roomId || ''} onChange={(ev) => set('roomId')(ev.target.value)} disabled={!!room}>
            <option value="">ללא חדר (אזור ציבורי)</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>חדר {r.number} · קומה {r.floor}</option>)}
          </select>
        </Field>
        <Field id="tk-area" label="אזור / ציוד" optional={!!f.roomId}>
          <input id="tk-area" className="input w-full" maxLength={120} value={f.area || ''} disabled={!!f.roomId} onChange={(ev) => set('area')(ev.target.value)} placeholder="לובי, מעלית 2…" />
        </Field>
        <Field id="tk-cat" label="קטגוריה" required error={e.category}>
          <Select id="tk-cat" value={f.category || ''} onChange={set('category')} options={TICKET_CATEGORY_LABELS} placeholder="בחירה…" invalid={e.category} />
        </Field>
        <Field id="tk-pri" label="חומרה" required hint={f.priority === 'critical' ? 'מסוכנת: החדר נחסם והסגירה דורשת מנהל תחזוקה' : undefined}>
          <Select id="tk-pri" value={f.priority} onChange={(v) => setF((p) => ({ ...p, priority: v, guestImpact: v === 'critical' ? 'block' : p.guestImpact }))} options={TICKET_PRIORITY_LABELS} />
        </Field>
      </div>
      <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
        <legend className="ui-label">השפעה על אירוח · חובה</legend>
        {Object.entries(GUEST_IMPACT_LABELS).map(([v, l]) => (
          <label key={v} className="ui-radio">
            <input type="radio" name="tk-impact" value={v} checked={f.guestImpact === v} onChange={() => set('guestImpact')(v)} />
            <span>
              {l}
              <span className="ui-sub" style={{ display: 'block' }}>
                {v === 'none' && 'אפשר להמשיך למכור ולאכלס את החדר'}
                {v === 'block' && 'החדר יוצא משימוש (OOO) עד שמנהל ישחרר אותו — סיום התיקון לא משחרר אוטומטית'}
                {v === 'move' && 'הקבלה תטפל במעבר האורח; החדר לא נחסם אוטומטית'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field id="tk-desc" label="תיאור" required error={e.description}>
        <textarea id="tk-desc" className="input w-full" rows={3} maxLength={2000} value={f.description || ''} onChange={(ev) => set('description')(ev.target.value)} aria-invalid={e.description ? 'true' : undefined} />
      </Field>
      {canAssign && (
        <div className="ui-grid-2">
          <Field id="tk-asg" label="אחראי" optional>
            <select id="tk-asg" className="select w-full" value={f.assigneeId || ''} onChange={(ev) => set('assigneeId')(ev.target.value)}>
              <option value="">לא שובץ</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field id="tk-due" label="מועד יעד" optional hint="ריק = לפי החומרה">
            <input id="tk-due" type="datetime-local" className="input w-full" value={f.dueDate || ''} onChange={(ev) => set('dueDate')(ev.target.value)} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

// ── OPS-01: create a task by hand ───────────────────────────────────────────
export function CreateTaskDialog({ open, onClose, propertyId, room, date, onSaved }) {
  const action = useAction();
  const { rooms, staff } = useRoomsAndStaff(propertyId, open, 'housekeeping');
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ roomId: room?.id || '', type: 'checkout_clean', priority: 'medium', assigneeId: '', notes: '' }); action.reset(); } }, [open, room?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const submit = () => action.run(async () => { await ops.createTask(propertyId, { ...f, date, assigneeId: f.assigneeId || undefined }); onSaved?.(); });
  return (
    <FormModal open={open} onClose={onClose} action={action} title="משימת חדרנות חדשה" subtitle={room ? `חדר ${room.number}` : undefined} submitLabel="יצירת משימה" onSubmit={submit} blockedWhy={!f.roomId ? 'יש לבחור חדר' : null}>
      <div className="ui-grid-2">
        <Field id="ct-room" label="חדר" required error={action.fields.roomId}>
          <select id="ct-room" className="select w-full" value={f.roomId || ''} onChange={(ev) => set('roomId')(ev.target.value)} disabled={!!room}>
            <option value="">בחירה…</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>חדר {r.number} · קומה {r.floor}</option>)}
          </select>
        </Field>
        <Field id="ct-type" label="סוג ניקיון" required error={action.fields.type}>
          <Select id="ct-type" value={f.type} onChange={set('type')} options={TASK_TYPE_LABELS} />
        </Field>
        <Field id="ct-pri" label="עדיפות">
          <Select id="ct-pri" value={f.priority} onChange={set('priority')} options={PRIORITY_LABELS} />
        </Field>
        <Field id="ct-asg" label="עובד" optional error={action.fields.assigneeId}>
          <select id="ct-asg" className="select w-full" value={f.assigneeId || ''} onChange={(ev) => set('assigneeId')(ev.target.value)}>
            <option value="">לא שובץ</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <Field id="ct-notes" label="הערה לעובד" optional hint="רק מה שדרוש לעבודה — בלי פרטי אורח">
        <input id="ct-notes" className="input w-full" maxLength={500} value={f.notes || ''} onChange={(ev) => set('notes')(ev.target.value)} />
      </Field>
    </FormModal>
  );
}

export function PriorityDialog({ open, onClose, propertyId, task, onSaved }) {
  const action = useAction();
  const [priority, setPriority] = useState('medium');
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setPriority(task?.priority || 'medium'); setReason(''); action.reset(); } }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => action.run(async () => { await ops.priority(propertyId, task.id, priority, reason.trim()); onSaved?.(); });
  return (
    <FormModal open={open} onClose={onClose} action={action} title="שינוי עדיפות" subtitle={task?.roomNumber ? `חדר ${task.roomNumber}` : undefined} submitLabel="שמירת עדיפות" onSubmit={submit} blockedWhy={reason.trim().length < 3 ? 'נדרשת סיבה' : null} width={440}>
      <Field id="pr-p" label="עדיפות" required>
        <Select id="pr-p" value={priority} onChange={setPriority} options={PRIORITY_LABELS} />
      </Field>
      <Field id="pr-r" label="סיבה" required error={action.fields.reason}>
        <input id="pr-r" className="input w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="אורח ממתין בקבלה…" />
      </Field>
    </FormModal>
  );
}

// ── OPS-02: pause and finish ────────────────────────────────────────────────
export function PauseDialog({ open, onClose, propertyId, task, onSaved }) {
  const action = useAction();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setReason(''); setNote(''); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => action.run(async () => { await ops.pause(propertyId, task.id, reason, note.trim() || undefined); onSaved?.(); });
  return (
    <FormModal open={open} onClose={onClose} action={action} title="עצירת משימה" subtitle={task ? `חדר ${task.room?.number}` : undefined} submitLabel="עצירה" onSubmit={submit} blockedWhy={!reason ? 'יש לבחור סיבה' : null} width={440}>
      <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
        <legend className="ui-label">סיבת עצירה · חובה</legend>
        {Object.entries(PAUSE_REASON_LABELS).map(([v, l]) => (
          <label key={v} className="ui-radio"><input type="radio" name="pause" value={v} checked={reason === v} onChange={() => setReason(v)} /><span>{l}</span></label>
        ))}
      </fieldset>
      {reason === 'issue' && <div className="ui-banner is-info">אחרי העצירה אפשר לדווח את התקלה מכרטיס המשימה.</div>}
      <Field id="pause-note" label="פירוט" optional>
        <input id="pause-note" className="input w-full" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormModal>
  );
}

export function CompleteDialog({ open, onClose, propertyId, task, onSaved }) {
  const action = useAction();
  const [items, setItems] = useState([]);
  const [note, setNote] = useState('');
  useEffect(() => { if (open && task) { setItems(task.checklist.map((c) => ({ item: c.item, done: !!c.done }))); setNote(''); action.reset(); } }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = items.filter((i) => !i.done).length;
  const submit = () => action.run(async () => { const out = await ops.complete(propertyId, task.id, items, note.trim() || undefined); onSaved?.(out); });
  return (
    <FormModal open={open} onClose={onClose} action={action} title="סיום ניקיון" subtitle={task ? `חדר ${task.room?.number} · יעבור לבדיקה לפי מדיניות הנכס` : undefined} submitLabel="סיום והעברה לבדיקה" onSubmit={submit} blockedWhy={missing ? `נותרו ${missing} סעיפים` : null} width={480}>
      <ul className="ui-checklist" aria-label="רשימת בדיקה">
        {items.map((it, i) => (
          <li key={it.item}>
            <label className="ui-check">
              <input type="checkbox" checked={it.done} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
              <span>{it.item}</span>
            </label>
          </li>
        ))}
      </ul>
      <Field id="cmp-note" label="הערה" optional>
        <input id="cmp-note" className="input w-full" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormModal>
  );
}

// ── OPS-05 ──────────────────────────────────────────────────────────────────
export function LostItemDialog({ open, onClose, propertyId, room, taskId, onSaved }) {
  const action = useAction();
  const { rooms } = useRoomsAndStaff(propertyId, open, null);
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ roomId: room?.id || '', location: '', description: '', category: 'other', storage: '', note: '' }); action.reset(); } }, [open, room?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const e = action.fields;
  const submit = () => action.run(async () => { const out = await ops.createLost(propertyId, { ...f, roomId: f.roomId || undefined, taskId }); onSaved?.(out); });
  return (
    <FormModal open={open} onClose={onClose} action={action} title="רישום חפץ שנמצא" submitLabel="רישום" onSubmit={submit}>
      <div className="ui-grid-2">
        <Field id="lf-room" label="חדר" error={e.location} hint={!f.roomId ? 'או מלאו מקום' : undefined}>
          <select id="lf-room" className="select w-full" value={f.roomId || ''} onChange={(ev) => set('roomId')(ev.target.value)} disabled={!!room}>
            <option value="">לא בחדר</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>חדר {r.number}</option>)}
          </select>
        </Field>
        <Field id="lf-loc" label="מקום" optional={!!f.roomId}>
          <input id="lf-loc" className="input w-full" maxLength={200} value={f.location || ''} disabled={!!f.roomId} onChange={(ev) => set('location')(ev.target.value)} placeholder="לובי, בריכה…" />
        </Field>
      </div>
      <Field id="lf-desc" label="תיאור" required error={e.description} hint="בלי פרטים מזהים (מספר מסמך, שם) — אלה מאומתים במסירה">
        <input id="lf-desc" className="input w-full" maxLength={500} value={f.description || ''} onChange={(ev) => set('description')(ev.target.value)} aria-invalid={e.description ? 'true' : undefined} />
      </Field>
      <div className="ui-grid-2">
        <Field id="lf-cat" label="סוג">
          <Select id="lf-cat" value={f.category} onChange={set('category')} options={LOST_CATEGORY_LABELS} />
        </Field>
        <Field id="lf-sto" label="מקום אחסון" required error={e.storage}>
          <input id="lf-sto" className="input w-full" maxLength={200} value={f.storage || ''} onChange={(ev) => set('storage')(ev.target.value)} placeholder="כספת קבלה" aria-invalid={e.storage ? 'true' : undefined} />
        </Field>
      </div>
      {f.category === 'hazardous' && <div className="ui-banner is-warn">חפץ מסוכן: אין לאחסן עם שאר המציאות — יש לעדכן מנהל משמרת.</div>}
      {f.category === 'document' && <div className="ui-banner is-info">מסמך זיהוי נשמר בכספת ונמסר רק לבעליו או למשטרה.</div>}
    </FormModal>
  );
}

export function ReleaseLostDialog({ open, onClose, propertyId, item, onSaved }) {
  const action = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ recipientName: '', evidence: '', note: '' }); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const submit = () => action.run(async () => { await ops.releaseLost(propertyId, item.id, f); onSaved?.(); });
  return (
    <FormModal open={open} onClose={onClose} action={action} title="מסירת חפץ" subtitle={item ? `${item.code} · ${item.description}` : undefined} submitLabel="אישור מסירה" onSubmit={submit}>
      <div className="ui-banner is-info">לא מוסרים לפי מספר חדר בלבד — יש לאמת את המקבל ולתעד איך.</div>
      <Field id="rl-name" label="שם המקבל" required error={action.fields.recipientName}>
        <input id="rl-name" className="input w-full" maxLength={120} value={f.recipientName || ''} onChange={(e) => set('recipientName')(e.target.value)} />
      </Field>
      <Field id="rl-ev" label="אופן האימות" required error={action.fields.evidence} hint="למשל: תעודה מזהה נבדקה ותיאור החפץ תאם">
        <input id="rl-ev" className="input w-full" maxLength={300} value={f.evidence || ''} onChange={(e) => set('evidence')(e.target.value)} />
      </Field>
      <Field id="rl-note" label="הערה" optional>
        <input id="rl-note" className="input w-full" maxLength={300} value={f.note || ''} onChange={(e) => set('note')(e.target.value)} />
      </Field>
    </FormModal>
  );
}

export function TransferLostDialog({ open, onClose, propertyId, item, onSaved }) {
  const action = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ storage: '', toName: '', note: '' }); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const submit = () => action.run(async () => { await ops.transferLost(propertyId, item.id, f); onSaved?.(); });
  return (
    <FormModal open={open} onClose={onClose} action={action} title="העברת אחזקה" subtitle={item ? `${item.code} · כעת ב: ${item.storage}` : undefined} submitLabel="העברה" onSubmit={submit} width={460}>
      <Field id="tr-sto" label="מקום אחסון חדש" required error={action.fields.storage}>
        <input id="tr-sto" className="input w-full" maxLength={200} value={f.storage || ''} onChange={(e) => set('storage')(e.target.value)} />
      </Field>
      <Field id="tr-to" label="מקבל האחזקה" optional>
        <input id="tr-to" className="input w-full" maxLength={120} value={f.toName || ''} onChange={(e) => set('toName')(e.target.value)} />
      </Field>
      <Field id="tr-note" label="הערה" optional>
        <input id="tr-note" className="input w-full" maxLength={300} value={f.note || ''} onChange={(e) => set('note')(e.target.value)} />
      </Field>
    </FormModal>
  );
}

export function DisposeLostDialog({ open, onClose, propertyId, item, onSaved }) {
  const action = useAction();
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setMethod(item?.category === 'document' ? 'police' : ''); setNote(''); action.reset(); } }, [open, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => action.run(async () => { await ops.disposeLost(propertyId, item.id, { method, note: note.trim() }); onSaved?.(); });
  const isDoc = item?.category === 'document';
  return (
    <FormModal open={open} onClose={onClose} action={action} title="טיפול סופי בפריט" subtitle={item ? `${item.code} · ${item.description}` : undefined} submitLabel="אישור טיפול" danger onSubmit={submit} blockedWhy={!method ? 'יש לבחור אופן טיפול' : note.trim().length < 3 ? 'נדרש נימוק' : null} width={460}>
      <div className="ui-banner is-warn">רק לפי מדיניות שמירה מאושרת של הנכס. פעולה זו סוגרת את הפריט.</div>
      <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
        <legend className="ui-label">אופן הטיפול · חובה</legend>
        {Object.entries(DISPOSAL_LABELS).map(([v, l]) => (
          <label key={v} className={`ui-radio ${isDoc && v !== 'police' ? 'is-disabled' : ''}`}>
            <input type="radio" name="disp" value={v} checked={method === v} disabled={isDoc && v !== 'police'} onChange={() => setMethod(v)} />
            <span>{l}{isDoc && v !== 'police' && <span className="ui-sub" style={{ display: 'block' }}>מסמך זיהוי — רק לבעליו או למשטרה</span>}</span>
          </label>
        ))}
      </fieldset>
      <Field id="dp-note" label="נימוק" required error={action.fields.note}>
        <input id="dp-note" className="input w-full" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormModal>
  );
}
