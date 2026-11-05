// Custom permissions (gap-map item 11): permission groups over the built-in roles, assigning users to a
// group with individual grants / denies on top, and releasing a locked user.
import { useEffect, useState } from 'react';
import { Plus, Unlock } from 'lucide-react';
import '../ops/EventsPage.css';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { permissions } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, DataTable, Empty, Modal, Field, Tag, Pill, ErrorBanner, Spinner, Segmented, Banner,
  useLoader, useAction, useUrlState,
} from '../../components/kit';

const ADMIN = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
const ROLE_LABEL = {
  super_admin: 'מנהל על', chain_admin: 'מנהל רשת', property_admin: 'מנהל נכס', general_manager: 'מנהל כללי', front_desk_manager: 'מנהל קבלה', receptionist: 'פקיד קבלה',
  housekeeping_manager: 'מנהל משק בית', housekeeper: 'חדרנית', maintenance_manager: 'מנהל תחזוקה', technician: 'טכנאי', finance_manager: 'כספים', cashier: 'קופאי',
  revenue_manager: 'הכנסות', sales_manager: 'מכירות', auditor: 'מבקר', owner_readonly: 'בעלים (צפייה)',
};

function Picks({ legend, hint, items, value, onChange, labelOf }) {
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <fieldset className="ui-fieldset"><legend className="ui-label">{legend} {hint ? <span className="ui-sub">({hint})</span> : null}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>{items.map((it) => <label key={it.key} className="ui-check"><input type="checkbox" checked={value.includes(it.key)} onChange={() => toggle(it.key)} /><span>{labelOf(it)}</span></label>)}</div>
    </fieldset>
  );
}

function CapPicks({ caps, grants, denies, onGrants, onDenies, canDeny = true }) {
  const areas = [...new Set(caps.map((c) => c.area))];
  const setState = (k, st) => {
    onGrants(st === 'grant' ? [...new Set([...grants, k])] : grants.filter((x) => x !== k));
    onDenies(st === 'deny' ? [...new Set([...denies, k])] : denies.filter((x) => x !== k));
  };
  return (
    <fieldset className="ui-fieldset"><legend className="ui-label">הרשאות רגישות <span className="ui-sub">(ללא סימון = לפי התפקיד של המשתמש)</span></legend>
      {areas.map((a) => (
        <div key={a}>
          <div className="ui-sub" style={{ marginTop: 6 }}><b>{a}</b></div>
          {caps.filter((c) => c.area === a).map((c) => {
            const st = grants.includes(c.key) ? 'grant' : denies.includes(c.key) ? 'deny' : 'role';
            return (
              <div key={c.key} style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 10, alignItems: 'center', padding: '3px 0' }}>
                <span>{c.label}</span>
                <select aria-label={c.label} className="input" value={st} onChange={(e) => setState(c.key, e.target.value)}>
                  <option value="role">לפי התפקיד</option><option value="grant">הענקה</option>{canDeny && <option value="deny">שלילה</option>}
                </select>
              </div>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}

function GroupDialog({ open, onClose, propertyId, initial, groups, cat, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({ name: '', description: '', parent: '', grants: [], denies: [], chargeCodes: [], reportGroups: [], active: true });
  useEffect(() => {
    if (!open) return;
    act.reset();
    const g = initial || {};
    setF({ name: g.name || '', description: g.description || '', parent: g.parent || '', grants: g.grants || [], denies: g.denies || [], chargeCodes: g.chargeCodes || [], reportGroups: g.reportGroups || [], active: g.active ?? true });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = act.fields;
  const submit = () => act.run(async () => onSaved(await permissions.saveGroup(propertyId, initial?.id, { ...f, parent: f.parent || null })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={680} title={initial ? `קבוצה ${initial.name}` : 'קבוצת הרשאות חדשה'} subtitle="מוסיפה או גורעת מהתפקיד של כל חבר בה. קבוצה יכולה לרשת קבוצה אחרת"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" onClick={submit} disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="pg-name" label="שם" required error={e.name}><input id="pg-name" className="input w-full" maxLength={60} value={f.name} onChange={(ev) => setF((p) => ({ ...p, name: ev.target.value }))} placeholder="אחראי משמרת" /></Field>
          <Field id="pg-par" label="יורשת מקבוצה" error={e.parent} hint="מקבלת את כל ההרשאות וההגבלות שלה"><select id="pg-par" className="input w-full" value={f.parent} onChange={(ev) => setF((p) => ({ ...p, parent: ev.target.value }))}><option value="">— ללא —</option>{groups.filter((g) => g.id !== initial?.id && g.active).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        </div>
        <Field id="pg-desc" label="תיאור"><input id="pg-desc" className="input w-full" maxLength={300} value={f.description} onChange={(ev) => setF((p) => ({ ...p, description: ev.target.value }))} /></Field>
        <CapPicks caps={cat.capabilities} grants={f.grants} denies={f.denies} onGrants={(v) => setF((p) => ({ ...p, grants: v }))} onDenies={(v) => setF((p) => ({ ...p, denies: v }))} />
        {e.denies && <div className="ui-error">{e.denies}</div>}
        <Picks legend="קודי חיוב מותרים לרישום ידני" hint="ללא סימון = כל הקודים" items={cat.chargeCodes.map((c) => ({ key: c.code, name: c.name }))} value={f.chargeCodes} onChange={(v) => setF((p) => ({ ...p, chargeCodes: v }))} labelOf={(c) => c.name} />
        {e.chargeCodes && <div className="ui-error">{e.chargeCodes}</div>}
        <Picks legend="קבוצות דוחות מותרות" hint="ללא סימון = כולן" items={cat.reportGroups.map((g) => ({ key: g, name: g }))} value={f.reportGroups} onChange={(v) => setF((p) => ({ ...p, reportGroups: v }))} labelOf={(g) => g.name} />
        <label className="ui-check"><input type="checkbox" checked={f.active} onChange={(ev) => setF((p) => ({ ...p, active: ev.target.checked }))} /><span>פעילה</span></label>
      </div>
    </Modal>
  );
}

function GroupsTab({ propertyId, notify }) {
  const [dlg, setDlg] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? permissions.groups(propertyId) : null), [propertyId]);
  const cat = useLoader(async () => (propertyId ? permissions.catalog(propertyId) : null), [propertyId]);
  const label = (k) => cat.data?.capabilities.find((c) => c.key === k)?.label || k;
  const name = (id) => data?.find((g) => g.id === id)?.name;
  const cols = [
    { key: 'n', label: 'קבוצה', render: (g) => <><b>{g.name}</b>{!g.active && <> <Tag>מושבתת</Tag></>}{g.description ? <div className="ui-sub">{g.description}</div> : null}</> },
    { key: 'p', label: 'יורשת מ', nowrap: true, render: (g) => (g.parent ? name(g.parent) || '—' : <span className="ui-sub">—</span>) },
    { key: 'g', label: 'מעניקה', render: (g) => (g.grants.length ? g.grants.map((k) => <Tag key={k} tone="ok">{label(k)}</Tag>) : <span className="ui-sub">—</span>) },
    { key: 'd', label: 'שוללת', render: (g) => (g.denies.length ? g.denies.map((k) => <Tag key={k}>{label(k)}</Tag>) : <span className="ui-sub">—</span>) },
    { key: 'l', label: 'הגבלות', render: (g) => <span className="ui-sub">{g.chargeCodes.length ? `${g.chargeCodes.length} קודי חיוב` : ''}{g.chargeCodes.length && g.reportGroups.length ? ' · ' : ''}{g.reportGroups.length ? `${g.reportGroups.length} קבוצות דוחות` : ''}{!g.chargeCodes.length && !g.reportGroups.length ? '—' : ''}</span> },
    { key: 'm', label: 'חברים', nowrap: true, render: (g) => <span className="ui-num">{g.members}</span> },
  ];
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg({ g: null })}><Plus size={14} /> קבוצה חדשה</button></div>
      <Card flush>
        <DataTable caption="קבוצות הרשאות" columns={cols} rows={data || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={(g) => setDlg({ g })}
          empty={<Empty title="אין קבוצות הרשאות">למשל "אחראי משמרת" = פקיד קבלה + אישור הנחות והיפוך חיוב. אחר כך משייכים אליה משתמשים בלשונית "משתמשים".</Empty>} />
      </Card>
      {cat.data && <GroupDialog open={!!dlg} onClose={() => setDlg(null)} propertyId={propertyId} initial={dlg?.g} groups={data || []} cat={cat.data} onSaved={() => { setDlg(null); notify('הקבוצה נשמרה'); reload(); }} />}
    </>
  );
}

function UserDialog({ open, onClose, propertyId, user, groups, cat, onSaved }) {
  const act = useAction();
  const [group, setGroup] = useState(''); const [grants, setGrants] = useState([]); const [denies, setDenies] = useState([]);
  useEffect(() => { if (open && user) { act.reset(); setGroup(user.group?.id || ''); setGrants(user.grants); setDenies(user.denies); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={680} title={user.name} subtitle={`${ROLE_LABEL[user.role] || user.role} · ${user.email}`}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy} onClick={() => act.run(async () => onSaved(await permissions.assign(propertyId, user.id, { group: group || null, grants, denies })))}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <Banner tone="info">התפקיד נשאר כמו שהוא. הקבוצה וההרשאות האישיות מוסיפות עליו או גורעות ממנו, ונכנסות לתוקף מיד.</Banner>
        <Field id="ua-g" label="קבוצת הרשאות" error={act.fields.group}><select id="ua-g" className="input w-full" value={group} onChange={(e) => setGroup(e.target.value)}><option value="">— ללא קבוצה —</option>{groups.filter((g) => g.active).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <CapPicks caps={cat.capabilities} grants={grants} denies={denies} onGrants={setGrants} onDenies={setDenies} />
        {act.fields.denies && <div className="ui-error">{act.fields.denies}</div>}
        <div className="ui-sub">הרשאה אישית גוברת על מה שהקבוצה מעניקה או שוללת.</div>
      </div>
    </Modal>
  );
}

function UsersTab({ propertyId, notify }) {
  const [q, setQ] = useState('');
  const [dlg, setDlg] = useState(null);
  const act = useAction();
  const me = useAuthStore((s) => s.user);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? permissions.users(propertyId, { q }) : null), [propertyId, q]);
  const groups = useLoader(async () => (propertyId ? permissions.groups(propertyId) : null), [propertyId]);
  const cat = useLoader(async () => (propertyId ? permissions.catalog(propertyId) : null), [propertyId]);
  const label = (k) => cat.data?.capabilities.find((c) => c.key === k)?.label || k;
  const cols = [
    { key: 'n', label: 'משתמש', render: (u) => <><b>{u.name}</b> <span className="ui-sub">{u.email}</span>{!u.active && <> <Tag>מושבת</Tag></>}</> },
    { key: 'r', label: 'תפקיד', nowrap: true, render: (u) => ROLE_LABEL[u.role] || u.role },
    { key: 'g', label: 'קבוצה', nowrap: true, render: (u) => (u.group ? <Pill tone="ok">{u.group.name}</Pill> : <span className="ui-sub">—</span>) },
    { key: 'e', label: 'שינויים על התפקיד', render: (u) => (u.effective ? <>{u.effective.grants.map((k) => <Tag key={`g${k}`} tone="ok">+ {label(k)}</Tag>)}{u.effective.denies.map((k) => <Tag key={`d${k}`}>− {label(k)}</Tag>)}{u.effective.chargeCodes.length ? <Tag>{u.effective.chargeCodes.length} קודי חיוב</Tag> : null}{u.effective.reportGroups.length ? <Tag>{u.effective.reportGroups.length} קבוצות דוחות</Tag> : null}</> : <span className="ui-sub">לפי התפקיד</span>) },
    { key: 'l', label: '', nowrap: true, render: (u) => (u.locked ? <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy} onClick={() => act.run(async () => { await permissions.unlock(propertyId, u.id); notify(`${u.name} שוחרר`); reload(); })}><Unlock size={14} /> נעול — שחרור</button> : null) },
  ];
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><input aria-label="חיפוש" className="input" placeholder="שם או אימייל" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ErrorBanner error={act.error} />
      <Card flush>
        <DataTable caption="משתמשים" columns={cols} rows={data || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={(u) => (u.id === me?.id ? null : setDlg(u))}
          empty={<Empty title="אין משתמשים" />} />
      </Card>
      {cat.data && <UserDialog open={!!dlg} onClose={() => setDlg(null)} propertyId={propertyId} user={dlg} groups={groups.data || []} cat={cat.data} onSaved={() => { setDlg(null); notify('ההרשאות עודכנו'); reload(); groups.reload(); }} />}
    </>
  );
}

export default function PermissionsPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState({ tab: 'groups' });
  const { toasts, success } = useToast();
  const tab = url.get('tab');
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="קבוצות הרשאות" meta="הרשאות מותאמות מעל התפקידים הקבועים: קבוצות, הרשאות אישיות, הגבלות ושחרור משתמש נעול" back="/pms" />
      {!ADMIN.includes(role) ? <Banner tone="info">ניהול הרשאות — למנהל נכס בלבד.</Banner> : (
        <>
          <Segmented label="מסך" value={tab} onChange={(v) => url.set({ tab: v })} options={[{ value: 'groups', label: 'קבוצות' }, { value: 'users', label: 'משתמשים' }]} />
          {tab === 'groups' && <GroupsTab propertyId={propertyId} notify={success} />}
          {tab === 'users' && <UsersTab propertyId={propertyId} notify={success} />}
        </>
      )}
    </Page>
  );
}
