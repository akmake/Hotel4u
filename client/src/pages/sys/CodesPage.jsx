// Code lists the hotel manages (gap-map item 13): segments (with automatic rules), sources, reasons, special
// services, VIP levels (with automatic services), trace texts, note types, preferences, seasons, language by nationality.
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import '../ops/EventsPage.css';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { codes } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, PageBar, Card, DataTable, Empty, Modal, Field, Tag, Pill, ErrorBanner, Spinner, Banner, useLoader, useAction, useUrlState } from '../../components/kit';

const MANAGE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
const COMPANY_TYPES = { corporate: 'חברה', agency: 'סוכנות', tour_operator: 'מארגן תיירות', government: 'ממשלתי' };

function Checks({ items, value, onChange }) {
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>{items.map(([k, l]) => <label key={k} className="ui-check"><input type="checkbox" checked={value.includes(k)} onChange={() => toggle(k)} /><span>{l}</span></label>)}</div>;
}

function ItemDialog({ open, onClose, propertyId, list, item, lists, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({ code: '', label: '', active: true, sortOrder: '', extra: {} });
  useEffect(() => {
    if (!open) return;
    act.reset();
    const x = item || {};
    setF({ code: x.code || '', label: x.label || '', active: x.active ?? true, sortOrder: x.sortOrder ?? '', extra: x.extra || (list.list === 'season' ? { ranges: [{ from: '', to: '' }] } : {}) });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ex = f.extra || {};
  const setEx = (k, v) => setF((p) => ({ ...p, extra: { ...(p.extra || {}), [k]: v } }));
  const services = (lists.find((l) => l.list === 'special_service')?.items || []).filter((x) => x.active).map((x) => [x.code, x.label]);
  const sources = (lists.find((l) => l.list === 'source')?.items || []).map((x) => [x.code, x.label]);
  const hasExtra = ['vip', 'season', 'segment'].includes(list.list);
  const submit = () => act.run(async () => onSaved(await codes.save(propertyId, list.list, f.code, { label: f.label, active: f.active, sortOrder: f.sortOrder === '' ? undefined : Number(f.sortOrder), ...(hasExtra ? { extra: f.extra } : {}) })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={560} title={item ? `${list.label}: ${item.label}` : `${list.label}: פריט חדש`} subtitle={list.hint || ''}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" onClick={submit} disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="cd-code" label={list.list === 'language_by_nationality' ? 'קוד מדינה' : 'קוד'} required error={act.fields.code}><input id="cd-code" dir="ltr" className="input w-full" disabled={!!item} maxLength={40} value={f.code} onChange={(e) => setF((p) => ({ ...p, code: list.list === 'language_by_nationality' ? e.target.value.toUpperCase() : e.target.value.replace(/[^A-Za-z0-9_-]/g, '') }))} /></Field>
          <Field id="cd-label" label={list.list === 'language_by_nationality' ? 'שפה (he, en, ru…)' : 'שם'} required error={act.fields.label}><input id="cd-label" className="input w-full" maxLength={120} value={f.label} onChange={(e) => setF((p) => ({ ...p, label: e.target.value }))} /></Field>
          <Field id="cd-sort" label="סדר"><input id="cd-sort" type="number" className="input w-full" value={f.sortOrder} onChange={(e) => setF((p) => ({ ...p, sortOrder: e.target.value }))} /></Field>
          <Field id="cd-act" label="מצב"><label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} /><span>פעיל</span></label></Field>
        </div>
        {list.list === 'vip' && <fieldset className="ui-fieldset"><legend className="ui-label">שירותים שנוספים אוטומטית להזמנה</legend><Checks items={services} value={ex.services || []} onChange={(v) => setEx('services', v)} /></fieldset>}
        {list.list === 'season' && (
          <fieldset className="ui-fieldset"><legend className="ui-label">טווחי תאריכים</legend>
            {(ex.ranges || []).map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <input aria-label="מתאריך" type="date" className="input" value={r.from} onChange={(e) => setEx('ranges', ex.ranges.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
                <span className="ui-sub">עד</span>
                <input aria-label="עד תאריך" type="date" className="input" value={r.to} onChange={(e) => setEx('ranges', ex.ranges.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                <button type="button" className="ap-icon" aria-label="הסרת טווח" onClick={() => setEx('ranges', ex.ranges.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEx('ranges', [...(ex.ranges || []), { from: '', to: '' }])}><Plus size={14} /> טווח</button>
            {act.fields.extra && <div className="ui-error">{act.fields.extra}</div>}
          </fieldset>
        )}
        {list.list === 'segment' && (
          <fieldset className="ui-fieldset"><legend className="ui-label">כלל אוטומטי — הפלח נקבע כשהזמנה חדשה מגיעה</legend>
            <div className="ui-sub">ממקור:</div><Checks items={sources} value={ex.sources || []} onChange={(v) => setEx('sources', v)} />
            <div className="ui-sub" style={{ marginTop: 6 }}>מסוג חברה:</div><Checks items={Object.entries(COMPANY_TYPES)} value={ex.companyTypes || []} onChange={(v) => setEx('companyTypes', v)} />
            <Field id="cd-rp" label="מקודי תעריף" hint="מופרדים בפסיק"><input id="cd-rp" dir="ltr" className="input w-full" value={(ex.ratePlans || []).join(', ')} onChange={(e) => setEx('ratePlans', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></Field>
          </fieldset>
        )}
        {act.fields.extra && list.list !== 'season' && <div className="ui-error">{act.fields.extra}</div>}
      </div>
    </Modal>
  );
}

export default function CodesPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState({ list: 'segment' });
  const { toasts, success } = useToast();
  const [dlg, setDlg] = useState(null);
  const canManage = MANAGE.includes(role);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? codes.all(propertyId) : null), [propertyId]);
  const current = data?.find((l) => l.list === url.get('list')) || data?.[0];
  const services = new Map((data?.find((l) => l.list === 'special_service')?.items || []).map((x) => [x.code, x.label]));
  const cols = [
    { key: 'c', label: 'קוד', nowrap: true, render: (x) => <span dir="ltr" className="ui-sub">{x.code}</span> },
    { key: 'l', label: 'שם', render: (x) => <><b>{x.label}</b>{!x.builtIn && <> <Tag>של המלון</Tag></>}</> },
    { key: 'e', label: 'פרטים', render: (x) => <span className="ui-sub">
      {current?.list === 'vip' && (x.extra?.services || []).map((s) => services.get(s) || s).join(', ')}
      {current?.list === 'season' && (x.extra?.ranges || []).map((r) => `${r.from} – ${r.to}`).join(' · ')}
      {current?.list === 'segment' && [...(x.extra?.sources || []), ...(x.extra?.companyTypes || []).map((t) => COMPANY_TYPES[t]), ...(x.extra?.ratePlans || [])].join(', ')}
    </span> },
    { key: 'a', label: 'מצב', nowrap: true, render: (x) => (x.active ? <Pill tone="ok">פעיל</Pill> : <Pill tone="muted">מושבת</Pill>) },
  ];
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="רשימות קוד" meta="פלחים, מקורות, סיבות, שירותים, VIP, עונות ועוד — הרשימות שהמלון מנהל" back="/pms" />
      <ErrorBanner error={error} onRetry={reload} />
      {!canManage && <Banner tone="info">צפייה בלבד — שינוי רשימות למנהל הנכס.</Banner>}
      {loading && !data ? <Spinner /> : data && (
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
          <Card flush>
            <nav aria-label="רשימות" style={{ display: 'flex', flexDirection: 'column' }}>
              {data.map((l) => <button key={l.list} type="button" className={`btn btn-sm ${current?.list === l.list ? 'btn-primary' : 'btn-ghost'}`} style={{ justifyContent: 'flex-start', margin: 2 }} onClick={() => url.set({ list: l.list })}>{l.label} <span className="ui-sub">({l.items.filter((x) => x.active).length})</span></button>)}
            </nav>
          </Card>
          <div className="ui-stack">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span className="ui-sub">{current?.hint}{current?.fixed ? ' · הקודים ברשימה הזו קבועים — אפשר לשנות שם או להשבית' : ''}</span>
              {canManage && !current?.fixed && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg({ item: null })}><Plus size={14} /> פריט חדש</button>}
            </div>
            <Card flush>
              <DataTable caption={current?.label} columns={cols} rows={(current?.items || []).map((x) => ({ ...x, id: x.code }))} onRowClick={canManage ? (x) => setDlg({ item: x }) : undefined}
                empty={<Empty title="הרשימה ריקה">{current?.list === 'season' ? 'הגדירו עונות (למשל "קיץ", "חגים") וכללי מחיר יוכלו להפנות אליהן.' : 'הוסיפו פריט ראשון.'}</Empty>} />
            </Card>
          </div>
        </div>
      )}
      {current && <ItemDialog open={!!dlg} onClose={() => setDlg(null)} propertyId={propertyId} list={current} item={dlg?.item} lists={data || []} onSaved={() => { setDlg(null); success('נשמר'); reload(); }} />}
    </Page>
  );
}
