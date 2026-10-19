// OPS-07 — preventive maintenance plans: what is checked, where, how often. Due rounds open tickets
// in the maintenance queue automatically every morning (or now, from here).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Play } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops, setup } from '../../utils/api';
import { TICKET_CATEGORY_LABELS, TICKET_PRIORITY_LABELS } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, Toolbar, Card, DataTable, Empty, Modal, Field, ErrorBanner, Spinner, Tag, useLoader, useAction } from '../../components/kit';

const ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'maintenance_manager'];
const SCOPES = { all_rooms: 'כל החדרים', room_type: 'סוג חדר', rooms: 'חדרים נבחרים', area: 'אזור ציבורי' };
const he = (ymd) => (ymd ? ymd.split('-').reverse().join('.') : '—');
const EMPTY = { title: '', category: 'hvac', priority: 'low', scope: 'all_rooms', roomTypeId: '', roomIds: [], area: '', everyDays: 90, leadDays: 3, nextDue: '', checklist: '', active: true };

export default function PreventivePage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = ROLES.includes(role);
  const { toasts, success, error: toastError } = useToast();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.preventive(propertyId) : null), [propertyId]);
  const meta = useLoader(async () => (propertyId ? setup.get(propertyId) : null), [propertyId]);
  const [edit, setEdit] = useState(null);
  const typeName = (id) => meta.data?.roomTypes.find((t) => t.id === id)?.name || '—';
  const where = (p) => (p.scope === 'room_type' ? `סוג: ${typeName(p.roomTypeId)}` : p.scope === 'rooms' ? `${p.roomIds.length} חדרים` : p.scope === 'area' ? p.area : SCOPES.all_rooms);
  const run = async (p) => { try { const out = await ops.runPreventive(propertyId, p.id); success(out.opened ? `נפתחו ${out.opened} תקלות` : 'אין מה לפתוח — הסבב כבר נפתח'); reload(); } catch (e) { toastError(e.message); } };
  const columns = [
    { key: 't', label: 'בדיקה', render: (p) => <div><b>{p.title}</b><div className="ui-sub">{TICKET_CATEGORY_LABELS[p.category] || p.category} · {TICKET_PRIORITY_LABELS[p.priority] || p.priority}</div></div> },
    { key: 'w', label: 'היכן', render: where },
    { key: 'e', label: 'תדירות', nowrap: true, render: (p) => `כל ${p.everyDays} ימים` },
    { key: 'n', label: 'הסבב הבא', nowrap: true, render: (p) => <span className="ui-num">{he(p.nextDue)}</span> },
    { key: 's', label: 'מצב', nowrap: true, render: (p) => (p.active ? <span className="ui-sub">פעיל{p.lastOpened != null ? ` · נפתחו ${p.lastOpened} בפעם האחרונה` : ''}</span> : <Tag>מושהה</Tag>) },
    { key: 'a', label: 'פעולות', srOnly: true, render: (p) => canEdit && (
      <div className="ui-row-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(p)} title="פתיחת הסבב הבא עכשיו"><Play size={13} />עכשיו</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...p, checklist: p.checklist.join('\n') })}><Pencil size={13} />עריכה</button>
      </div>
    ) },
  ];
  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <Toolbar start={<Link to="/pms/maintenance" className="btn btn-ghost btn-sm">← תחזוקה</Link>} end={canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdit({ ...EMPTY, id: null })}><Plus size={14} />תכנית חדשה</button>} />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && (
        <Card flush title="תחזוקה מונעת" actions={<span className="ui-sub">סבבים שהגיע זמנם נפתחים כתקלות כל בוקר ב־06:00</span>}>
          {data.length ? <DataTable columns={columns} rows={data} rowKey={(p) => p.id} /> : <Empty title="אין תכניות">למשל: ניקוי מסנני מזגן כל 90 יום, בדיקת גלאי עשן כל 180 יום.</Empty>}
        </Card>
      )}
      <PlanDialog value={edit} onClose={() => setEdit(null)} propertyId={propertyId} meta={meta.data} onSaved={(m) => { setEdit(null); success(m); reload(); }} />
    </Page>
  );
}

function PlanDialog({ value, onClose, propertyId, meta, onSaved }) {
  const save = useAction();
  const [f, setF] = useState(EMPTY);
  useEffect(() => { if (value) { setF(value); save.reset(); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const e = save.fields;
  const submit = () => save.run(async () => {
    const body = { title: f.title, category: f.category, priority: f.priority, scope: f.scope, roomTypeId: f.roomTypeId || null, roomIds: f.roomIds, area: f.area, everyDays: Number(f.everyDays), leadDays: Number(f.leadDays), nextDue: f.nextDue, checklist: f.checklist, active: f.active };
    if (value.id) await ops.updatePreventive(propertyId, value.id, body); else await ops.createPreventive(propertyId, body);
    onSaved(value.id ? 'התכנית נשמרה' : 'התכנית נוצרה');
  });
  return (
    <Modal open={!!value} onClose={onClose} busy={save.busy} width={640} title={value?.id ? 'עריכת תכנית' : 'תכנית תחזוקה מונעת'}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={save.busy}>ביטול</button><button type="button" className="btn btn-primary" onClick={submit} disabled={save.busy}>{save.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={save.error} />
        <Field id="pp-title" label="מה בודקים" required error={e.title}><input id="pp-title" className="input w-full" maxLength={120} value={f.title} onChange={set('title')} placeholder="ניקוי מסנני מזגן" /></Field>
        <div className="ui-grid-2">
          <Field id="pp-cat" label="קטגוריה" error={e.category}><select id="pp-cat" className="input w-full" value={f.category} onChange={set('category')}>{Object.entries(TICKET_CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field id="pp-pri" label="עדיפות" error={e.priority}><select id="pp-pri" className="input w-full" value={f.priority} onChange={set('priority')}>{Object.entries(TICKET_PRIORITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field id="pp-scope" label="היכן" error={e.scope}><select id="pp-scope" className="input w-full" value={f.scope} onChange={set('scope')}>{Object.entries(SCOPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {f.scope === 'room_type' && <Field id="pp-rt" label="סוג חדר" error={e.roomTypeId}><select id="pp-rt" className="input w-full" value={f.roomTypeId || ''} onChange={set('roomTypeId')}><option value="">בחירה…</option>{(meta?.roomTypes || []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
          {f.scope === 'area' && <Field id="pp-area" label="שם האזור" error={e.area}><input id="pp-area" className="input w-full" value={f.area || ''} onChange={set('area')} placeholder="לובי, חדר כושר…" /></Field>}
          {f.scope === 'rooms' && (
            <Field id="pp-rooms" label="חדרים" error={e.roomIds} hint="Ctrl לבחירה מרובה">
              <select id="pp-rooms" multiple className="input w-full" style={{ height: 110 }} value={f.roomIds} onChange={(ev) => setF((p) => ({ ...p, roomIds: [...ev.target.selectedOptions].map((o) => o.value) }))}>
                {(meta?.rooms || []).filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}
              </select>
            </Field>
          )}
          <Field id="pp-every" label="כל כמה ימים" required error={e.everyDays}><input id="pp-every" className="input w-full" inputMode="numeric" value={f.everyDays} onChange={set('everyDays')} /></Field>
          <Field id="pp-due" label="הסבב הבא" required error={e.nextDue}><input id="pp-due" type="date" className="input w-full" value={f.nextDue || ''} onChange={set('nextDue')} /></Field>
          <Field id="pp-lead" label="לפתוח ימים לפני" error={e.leadDays}><input id="pp-lead" className="input w-full" inputMode="numeric" value={f.leadDays} onChange={set('leadDays')} /></Field>
        </div>
        <Field id="pp-check" label="רשימת בדיקה" optional hint="שורה לכל סעיף"><textarea id="pp-check" className="input w-full" rows={3} value={f.checklist} onChange={set('checklist')} /></Field>
        <label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={set('active')} /><span>פעילה</span></label>
      </div>
    </Modal>
  );
}
