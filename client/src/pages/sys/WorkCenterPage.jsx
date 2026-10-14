// SYS-06 — work center and shift handover. Items have an owner and a state, not a "read" flag:
// take (atomic), hand over to a colleague with a note, close with a resolution. The system opens
// items for events that need a person (failed day close, dangerous fault, cancellation money).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { platform } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Toolbar, Card, Tiles, Segmented, Tag, Pill, Empty, Modal, Field, ErrorBanner, Spinner, ConfirmDialog,
  useUrlState, useLoader, useAction, formatDateTime,
} from '../../components/kit';

const DEFAULTS = { status: 'open', mine: '' };
const KIND = { operations: 'תפעול', finance: 'כספים', integration: 'חיבורים', security: 'אבטחה', handover: 'העברת משמרת' };
const SEV = { urgent: { label: 'דחוף', tone: 'bad' }, action: { label: 'לטיפול', tone: 'warn' }, info: { label: 'מידע', tone: 'muted' } };
const NOTE_KIND = { note: 'הערה', take: 'קיבל טיפול', transfer: 'העביר', close: 'סגר', reopen: 'פתח מחדש' };

function NewItemDialog({ open, onClose, propertyId, staff, onSaved }) {
  const action = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ title: '', body: '', severity: 'action', kind: 'handover', ownerId: '', dueAt: '' }); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title="פריט העברת משמרת" footer={(
      <>
        {!f.title?.trim() && <span className="ui-foot-note">נדרשת כותרת</span>}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
        <button type="button" className="btn btn-primary" disabled={action.busy || !f.title?.trim()} onClick={() => action.run(async () => { const out = await platform.createWork(propertyId, { ...f, ownerId: f.ownerId || undefined, dueAt: f.dueAt || undefined }); onSaved?.(out); })}>{action.busy ? <Spinner /> : 'פתיחה'}</button>
      </>
    )}>
      <ErrorBanner error={action.error} />
      <Field id="wi-t" label="מה צריך לקרות" required error={action.fields.title}><input id="wi-t" className="input w-full" maxLength={200} value={f.title || ''} onChange={(e) => set('title')(e.target.value)} placeholder="אורח בחדר 214 מחכה לטכנאי מזגנים" /></Field>
      <Field id="wi-b" label="פרטים" optional><textarea id="wi-b" className="input w-full" rows={3} maxLength={2000} value={f.body || ''} onChange={(e) => set('body')(e.target.value)} /></Field>
      <div className="ui-grid-3">
        <Field id="wi-s" label="חומרה"><select id="wi-s" className="select w-full" value={f.severity} onChange={(e) => set('severity')(e.target.value)}>{Object.entries(SEV).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}</select></Field>
        <Field id="wi-o" label="אחראי" optional hint="ריק = לרשימה המשותפת"><select id="wi-o" className="select w-full" value={f.ownerId} onChange={(e) => set('ownerId')(e.target.value)}><option value="">ללא</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field id="wi-d" label="יעד" optional><input id="wi-d" type="datetime-local" className="input w-full" value={f.dueAt} onChange={(e) => set('dueAt')(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function TransferDialog({ open, onClose, item, staff, onTransfer }) {
  const action = useAction();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setTo(''); setNote(''); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const why = !to ? 'למי להעביר' : note.trim().length < 3 ? 'הערת העברה' : null;
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={460} title="העברת אחריות" subtitle={item?.title} footer={(
      <>
        {why && <span className="ui-foot-note">{why}</span>}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
        <button type="button" className="btn btn-primary" disabled={action.busy || !!why} onClick={() => action.run(() => onTransfer(to, note))}>{action.busy ? <Spinner /> : 'העברה'}</button>
      </>
    )}>
      <ErrorBanner error={action.error} />
      <Field id="tr-u" label="אל" required error={action.fields.toUserId}><select id="tr-u" className="select w-full" value={to} onChange={(e) => setTo(e.target.value)}><option value="">בחירה…</option>{staff.filter((u) => u.id !== item?.owner?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      <Field id="tr-n" label="מה המקבל צריך לדעת" required error={action.fields.note}><textarea id="tr-n" className="input w-full" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

export default function WorkCenterPage() {
  const { propertyId } = useProperty();
  const nav = useNavigate();
  const { toasts, success, error: toastError } = useToast();
  const url = useUrlState(DEFAULTS);
  const [dialog, setDialog] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? platform.work(propertyId, { status: url.get('status'), mine: url.get('mine') || undefined }) : null), [propertyId, url.key]);
  const staff = useLoader(async () => (propertyId ? platform.staff(propertyId) : null), [propertyId]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60000);
    return () => clearInterval(id);
  }, [reload]);
  const c = data?.counts || {};
  const staffList = staff.data || [];
  const act = async (fn, msg) => { try { await fn(); success(msg); reload(); } catch (e) { toastError(e.message); reload(); } };

  return (
    <Page>
      <ToastContainer toasts={toasts} />
      <Toolbar
        start={<Segmented label="מצב" value={url.get('status')} onChange={(v) => url.set({ status: v })} options={[{ value: 'open', label: 'פתוחים' }, { value: 'closed', label: 'נסגרו' }, { value: 'all', label: 'הכול' }]} />}
        end={(
          <>
            <label className="ui-switch"><input type="checkbox" checked={url.get('mine') === '1'} onChange={(e) => url.set({ mine: e.target.checked ? '1' : '' })} />שלי בלבד</label>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'new' })}><Plus size={14} /> העברת משמרת</button>
          </>
        )}
      />
      <Tiles label="פריטים פתוחים" items={[
        { id: 'open', label: 'פתוחים', value: data ? c.open : undefined, static: true },
        { id: 'urgent', label: 'דחופים', value: data ? c.urgent : undefined, tone: c.urgent ? 'bad' : undefined, static: true },
        { id: 'unowned', label: 'ללא אחראי', value: data ? c.unowned : undefined, tone: c.unowned ? 'warn' : undefined, static: true },
        { id: 'mine', label: 'אצלי', value: data ? c.mine : undefined, static: true },
      ]} />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && data.rows.length === 0 && <Empty title={url.get('status') === 'open' ? 'אין פריטים פתוחים' : 'אין פריטים'}>פריטי העברת משמרת וטיפול מהמערכת יופיעו כאן.</Empty>}
      <div className="ui-stack" style={{ gap: 8 }}>
        {(data?.rows || []).map((w) => (
          <Card key={w.id} className={w.status === 'closed' ? 'is-done' : ''}>
            <div className="ui-task-head">
              <div className="min-w-0">
                <div className="ui-row" style={{ gap: 6 }}>
                  <Pill tone={SEV[w.severity].tone}>{SEV[w.severity].label}</Pill>
                  <strong>{w.title}</strong>
                  <Tag>{KIND[w.kind]}</Tag>
                  {w.overdue && <Tag tone="bad">באיחור</Tag>}
                </div>
                <div className="ui-sub">
                  {w.owner ? `אחראי: ${w.owner.name}` : 'ללא אחראי'} · נפתח {formatDateTime(w.createdAt)} ע״י {w.createdBy === 'system' ? 'המערכת' : w.createdBy}{w.dueAt ? ` · יעד ${formatDateTime(w.dueAt)}` : ''}
                </div>
              </div>
              {w.status === 'closed' ? <Pill tone="muted">נסגר</Pill> : <Pill tone={w.status === 'new' ? 'warn' : 'ok'}>{w.status === 'new' ? 'חדש' : 'בטיפול'}</Pill>}
            </div>
            {w.body && <div style={{ whiteSpace: 'pre-wrap' }}>{w.body}</div>}
            {w.notes.length > 1 && (
              <details>
                <summary className="ui-sub" style={{ cursor: 'pointer' }}>היסטוריה ({w.notes.length})</summary>
                <ol className="ui-timeline" style={{ marginTop: 6 }}>{w.notes.map((n, i) => <li key={i}><span><strong>{n.by}</strong> {NOTE_KIND[n.kind]}{n.to ? ` ← ${n.to}` : ''}</span>{n.text && <span className="ui-sub">{n.text}</span>}<span className="ui-sub">{formatDateTime(n.at)}</span></li>)}</ol>
              </details>
            )}
            {w.closedReason && <div className="ui-sub">פתרון: {w.closedReason}</div>}
            {w.status !== 'closed' && (
              <div className="ui-row">
                {w.source?.link && <button type="button" className="btn btn-secondary btn-sm" onClick={() => nav(w.source.link)}>פתיחת {w.source.label || 'המקור'}</button>}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(() => platform.takeWork(propertyId, w.id), 'קיבלת את הפריט')}>קבלת טיפול</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'transfer', item: w })}>העברה</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'close', item: w })}>סגירה</button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <NewItemDialog open={dialog?.kind === 'new'} onClose={() => setDialog(null)} propertyId={propertyId} staff={staffList} onSaved={() => { setDialog(null); success('הפריט נפתח'); reload(); }} />
      <TransferDialog open={dialog?.kind === 'transfer'} onClose={() => setDialog(null)} item={dialog?.item} staff={staffList} onTransfer={async (to, note) => { await platform.transferWork(propertyId, dialog.item.id, to, note); setDialog(null); success('האחריות הועברה'); reload(); }} />
      <ConfirmDialog open={dialog?.kind === 'close'} onClose={() => setDialog(null)} title="סגירת פריט" subtitle={dialog?.item?.title} confirmLabel="סגירה" requireReason reasonLabel="מה נעשה / למה נסגר" onConfirm={async (reason) => { await platform.closeWork(propertyId, dialog.item.id, reason); setDialog(null); success('נסגר'); reload(); }}>
        {dialog?.item?.source && <p className="ui-p">ודאו שהמקור ({dialog.item.source.label}) אכן טופל — סגירת הפריט לא פותרת אותו.</p>}
      </ConfirmDialog>
    </Page>
  );
}
