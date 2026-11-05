// Packages (gap-map item 10): components (simple / allowance), which rate plans carry them and whether a plan
// qualifies for agent commission, and the package ledger (profit / loss / excess per component).
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import '../ops/EventsPage.css';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { packages } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, DataTable, Empty, Modal, Field, Tag, Pill, ErrorBanner, Spinner, Segmented, Banner,
  useLoader, useAction, useUrlState, money,
} from '../../components/kit';

const MANAGE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager', 'sales_manager', 'finance_manager'];
const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const SCHEDULES = { every: 'כל לילה', first: 'לילה ראשון', last: 'לילה אחרון', except_first: 'כל לילה חוץ מהראשון', except_last: 'כל לילה חוץ מהאחרון', except_ends: 'בלי הראשון ובלי האחרון', weekdays: 'ימים בשבוע', every_n: 'כל כמה לילות' };
const CALCS = { per_adult_child: 'לכל מבוגר וילד', per_person: 'לאדם', per_room: 'סכום קבוע לחדר' };
const LINKS = { included: 'כלול בתעריף (יורד ממחיר החדר)', added: 'נוסף בשורה נפרדת' };
const CODES = [['board', 'אירוח (ארוחות)'], ['f_and_b', 'מזון ומשקאות'], ['minibar', 'מיני־בר'], ['spa', 'ספא'], ['parking', 'חניה'], ['laundry', 'כביסה'], ['other', 'שונות']];
const ymd = (d) => d.toISOString().slice(0, 10);

function ComponentDialog({ open, onClose, propertyId, initial, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({ price: '', childPrice: '', allowance: '', everyN: 2, fromNight: 1, weekdays: [], altCodes: '', validFrom: '', validTo: '', kind: 'simple', calc: 'per_adult_child', link: 'added', schedule: 'every', chargeCode: 'board' });
  useEffect(() => {
    if (!open) return;
    act.reset();
    const c = initial || {};
    setF({
      code: c.code || '', name: c.name || '', description: c.description || '', kind: c.kind || 'simple', price: c.price ?? '', childPrice: c.childPrice ?? '', allowance: c.allowance ?? '',
      calc: c.calc || 'per_adult_child', link: c.link || 'added', schedule: c.schedule || 'every', weekdays: c.weekdays || [], everyN: c.everyN || 2, fromNight: c.fromNight || 1,
      sellable: !!c.sellable, chargeCode: c.chargeCode || 'board', altCodes: (c.altCodes || []).join(', '), validFrom: c.validFrom || '', validTo: c.validTo || '', active: c.active ?? true,
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const e = act.fields;
  const allowance = f.kind === 'allowance';
  const toggleDay = (i) => setF((p) => ({ ...p, weekdays: p.weekdays.includes(i) ? p.weekdays.filter((x) => x !== i) : [...p.weekdays, i].sort() }));
  const submit = () => act.run(async () => onSaved(await packages.saveComponent(propertyId, initial?.id, {
    ...f, price: Number(f.price), childPrice: f.childPrice === '' ? undefined : Number(f.childPrice), allowance: allowance ? Number(f.allowance || f.price) : undefined,
    altCodes: String(f.altCodes || '').split(',').map((x) => x.trim()).filter(Boolean), everyN: Number(f.everyN), fromNight: Number(f.fromNight || 1),
  })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={620} title={initial ? `רכיב ${initial.name}` : 'רכיב חבילה חדש'} subtitle="פריט שנמכר עם השהייה: ארוחה, כרטיס, סיור"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="submit" form="pc-form" className="btn btn-primary" disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <form id="pc-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="pc-code" label="קוד" required error={e.code} hint={initial ? 'הקוד לא משתנה' : 'באנגלית או ספרות'}><input id="pc-code" dir="ltr" className="input w-full" maxLength={20} disabled={!!initial} value={f.code || ''} onChange={(ev) => setF((p) => ({ ...p, code: ev.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))} /></Field>
          <Field id="pc-name" label="שם קצר (לדוחות)" required error={e.name}><input id="pc-name" className="input w-full" maxLength={80} value={f.name || ''} onChange={set('name')} placeholder="ארוחת בוקר" /></Field>
        </div>
        <Field id="pc-desc" label="תיאור מלא (לפקיד שמסביר לאורח)"><input id="pc-desc" className="input w-full" maxLength={300} value={f.description || ''} onChange={set('description')} placeholder="מזנון בוקר 07:00–10:30" /></Field>
        <Segmented label="סוג" value={f.kind} onChange={(v) => setF((p) => ({ ...p, kind: v }))} options={[{ value: 'simple', label: 'פשוט — מחיר קבוע' }, { value: 'allowance', label: 'עם הקצבה — האורח מנצל סכום' }]} />
        <div className="ui-grid-2">
          <Field id="pc-price" label={allowance ? 'מחיר החבילה (₪, כולל מע״מ)' : 'מחיר (₪, כולל מע״מ)'} required error={e.price}><input id="pc-price" type="number" min="0" step="0.01" className="input w-full" value={f.price} onChange={set('price')} /></Field>
          {allowance
            ? <Field id="pc-allow" label="הקצבה לניצול (₪)" required error={e.allowance} hint="לא קטנה מהמחיר. ניצל פחות = רווח; יותר מהמחיר = הפסד; יותר מההקצבה = חריגה לאורח"><input id="pc-allow" type="number" min="0" step="0.01" className="input w-full" value={f.allowance} onChange={set('allowance')} /></Field>
            : <Field id="pc-child" label="מחיר ילד (₪)" error={e.childPrice} hint="ריק = כמו מבוגר"><input id="pc-child" type="number" min="0" step="0.01" className="input w-full" disabled={f.calc !== 'per_adult_child'} value={f.childPrice} onChange={set('childPrice')} /></Field>}
        </div>
        <div className="ui-grid-2">
          <Field id="pc-calc" label="איך מחושב הסכום"><select id="pc-calc" className="input w-full" value={f.calc} onChange={set('calc')}>{Object.entries(CALCS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="pc-link" label="חיבור למחיר"><select id="pc-link" className="input w-full" value={f.link} onChange={set('link')}>{Object.entries(LINKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="pc-sch" label="מתי נרשם" error={e.weekdays || e.everyN}><select id="pc-sch" className="input w-full" value={f.schedule} onChange={set('schedule')}>{Object.entries(SCHEDULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="pc-code2" label="קוד חיוב" required error={e.chargeCode} hint="הקוד שנרשם בחשבון (והקצבה בולעת חיובים בו)"><select id="pc-code2" className="input w-full" value={f.chargeCode} onChange={set('chargeCode')}>{CODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        {f.schedule === 'weekdays' && <div className="ui-sub" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{DOW.map((d, i) => <label key={d} className="ui-check"><input type="checkbox" checked={f.weekdays.includes(i)} onChange={() => toggleDay(i)} /><span>{d}</span></label>)}</div>}
        {f.schedule === 'every_n' && <div className="ui-grid-2"><Field id="pc-n" label="כל כמה לילות"><input id="pc-n" type="number" min="2" max="30" className="input w-full" value={f.everyN} onChange={set('everyN')} /></Field><Field id="pc-from" label="החל מלילה"><input id="pc-from" type="number" min="1" className="input w-full" value={f.fromNight} onChange={set('fromNight')} /></Field></div>}
        {allowance && (
          <div className="ui-grid-2">
            <Field id="pc-alt" label="קודים חלופיים שמותר לנצל" hint="למשל f_and_b, minibar — מופרדים בפסיק" error={e.altCodes}><input id="pc-alt" dir="ltr" className="input w-full" value={f.altCodes} onChange={set('altCodes')} /></Field>
            <Field id="pc-hrs" label="שעות תוקף (ריק = כל היום)" error={e.validFrom}><div style={{ display: 'flex', gap: 6 }}><input aria-label="משעה" type="time" className="input w-full" value={f.validFrom} onChange={set('validFrom')} /><input aria-label="עד שעה" type="time" className="input w-full" value={f.validTo} onChange={set('validTo')} /></div></Field>
          </div>
        )}
        <label className="ui-check"><input type="checkbox" checked={!!f.sellable} onChange={set('sellable')} /><span>אפשר להוסיף להזמנה גם בתעריף רגיל (נמכר בנפרד)</span></label>
        <label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={set('active')} /><span>פעיל</span></label>
      </form>
    </Modal>
  );
}

function ComponentsTab({ propertyId, canManage, notify }) {
  const [dlg, setDlg] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? packages.components(propertyId) : null), [propertyId]);
  const cols = [
    { key: 'n', label: 'רכיב', render: (c) => <><b>{c.name}</b> <span className="ui-sub" dir="ltr">{c.code}</span>{c.description ? <div className="ui-sub">{c.description}</div> : null}</> },
    { key: 'k', label: 'סוג', nowrap: true, render: (c) => (c.kind === 'allowance' ? <Pill tone="ok">הקצבה</Pill> : <Pill tone="muted">פשוט</Pill>) },
    { key: 'p', label: 'מחיר', nowrap: true, render: (c) => <span className="ui-num">{money(c.price, 'ILS', 0)}{c.kind === 'allowance' ? ` / הקצבה ${money(c.allowance, 'ILS', 0)}` : ''}</span> },
    { key: 'c', label: 'חישוב', nowrap: true, render: (c) => <span className="ui-sub">{CALCS[c.calc]}</span> },
    { key: 'l', label: 'חיבור', nowrap: true, render: (c) => <Tag tone={c.link === 'included' ? 'ok' : undefined}>{c.link === 'included' ? 'כלול' : 'נוסף'}</Tag> },
    { key: 's', label: 'מתי נרשם', render: (c) => <span className="ui-sub">{c.schedule === 'weekdays' ? c.weekdays.map((d) => DOW[d]).join(' ') : c.schedule === 'every_n' ? `כל ${c.everyN} לילות מלילה ${c.fromNight}` : SCHEDULES[c.schedule]}</span> },
    { key: 'x', label: '', nowrap: true, render: (c) => <>{c.sellable && <Tag>נמכר בנפרד</Tag>}{!c.active && <Tag>מושבת</Tag>}</> },
  ];
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{canManage && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg({ c: null })}><Plus size={14} /> רכיב חדש</button>}</div>
      <Card flush>
        <DataTable caption="רכיבי חבילה" columns={cols} rows={data || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={canManage ? (c) => setDlg({ c }) : undefined}
          empty={<Empty title="אין רכיבי חבילה">למשל ארוחת בוקר (כלולה בתעריף), ארוחת ערב עם הקצבה או כרטיס למופע. אחר כך משייכים אותם לתעריף בלשונית "תעריפים".</Empty>} />
      </Card>
      <ComponentDialog open={!!dlg} onClose={() => setDlg(null)} propertyId={propertyId} initial={dlg?.c} onSaved={() => { setDlg(null); notify('הרכיב נשמר'); reload(); }} />
    </>
  );
}

function PlanDialog({ open, onClose, propertyId, plan, comps, onSaved }) {
  const act = useAction();
  const [sel, setSel] = useState({});
  const [elig, setElig] = useState(false);
  const [pct, setPct] = useState('');
  useEffect(() => {
    if (!open || !plan) return;
    act.reset();
    setSel(Object.fromEntries(plan.components.map((c) => [c.component, { from: c.from, to: c.to }])));
    setElig(plan.commission.eligible); setPct(plan.commission.pct ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => setSel((p) => { const n = { ...p }; if (n[id]) delete n[id]; else n[id] = { from: '', to: '' }; return n; });
  const submit = () => act.run(async () => onSaved(await packages.savePlan(propertyId, plan.id, {
    components: Object.entries(sel).map(([component, v]) => ({ component, from: v.from || undefined, to: v.to || undefined })),
    commission: { eligible: elig, pct: elig && pct !== '' ? Number(pct) : undefined },
  })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={560} title={plan ? `תעריף ${plan.name}` : ''} subtitle="רכיבי חבילה וזכאות לעמלת סוכן"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" onClick={submit} disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <fieldset className="ui-fieldset"><legend className="ui-label">רכיבים שכל הזמנה בתעריף מקבלת</legend>
          {comps.filter((c) => c.active).map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0' }}>
              <label className="ui-check" style={{ minWidth: 200 }}><input type="checkbox" checked={!!sel[c.id]} onChange={() => toggle(c.id)} /><span>{c.name} <span className="ui-sub">({money(c.price, 'ILS', 0)})</span></span></label>
              {sel[c.id] && <><input aria-label="מתאריך" type="date" className="input" value={sel[c.id].from || ''} onChange={(ev) => setSel((p) => ({ ...p, [c.id]: { ...p[c.id], from: ev.target.value } }))} /><span className="ui-sub">עד</span><input aria-label="עד תאריך" type="date" className="input" value={sel[c.id].to || ''} onChange={(ev) => setSel((p) => ({ ...p, [c.id]: { ...p[c.id], to: ev.target.value } }))} /></>}
            </div>
          ))}
          {!comps.some((c) => c.active) && <span className="ui-sub">אין רכיבים פעילים — הגדירו קודם בלשונית "רכיבים".</span>}
        </fieldset>
        <fieldset className="ui-fieldset"><legend className="ui-label">עמלת סוכן</legend>
          <label className="ui-check"><input type="checkbox" checked={elig} onChange={(ev) => setElig(ev.target.checked)} /><span>התעריף מזכה בעמלה</span></label>
          {elig && <Field id="pl-pct" label="אחוז עמלה" hint="ריק = האחוז של הסוכן עצמו. אחוז כאן גובר עליו" error={act.fields.pct}><input id="pl-pct" type="number" min="0" max="100" step="0.5" className="input" value={pct} onChange={(ev) => setPct(ev.target.value)} /></Field>}
        </fieldset>
      </div>
    </Modal>
  );
}

function PlansTab({ propertyId, canManage, notify }) {
  const [dlg, setDlg] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? packages.plans(propertyId) : null), [propertyId]);
  const comps = useLoader(async () => (propertyId ? packages.components(propertyId) : null), [propertyId]);
  const cols = [
    { key: 'n', label: 'תעריף', nowrap: true, render: (p) => <><b>{p.name}</b> <span className="ui-sub" dir="ltr">{p.code}</span></> },
    { key: 'c', label: 'רכיבי חבילה', render: (p) => (p.components.length ? p.components.map((c) => <Tag key={c.component}>{c.name}{c.from || c.to ? ` · ${c.from || '…'}–${c.to || '…'}` : ''}</Tag>) : <span className="ui-sub">—</span>) },
    { key: 'm', label: 'עמלת סוכן', nowrap: true, render: (p) => (p.commission.eligible ? <Pill tone="ok">{p.commission.pct != null ? `${p.commission.pct}%` : 'לפי הסוכן'}</Pill> : <span className="ui-sub">לא מזכה</span>) },
  ];
  return (
    <>
      <Card flush>
        <DataTable caption="תעריפים" columns={cols} rows={data || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={canManage ? (p) => setDlg({ p }) : undefined}
          empty={<Empty title="אין תעריפים">התעריפים מוגדרים במסך המחירים.</Empty>} />
      </Card>
      <PlanDialog open={!!dlg} onClose={() => setDlg(null)} propertyId={propertyId} plan={dlg?.p} comps={comps.data || []} onSaved={() => { setDlg(null); notify('התעריף עודכן'); reload(); }} />
    </>
  );
}

function LedgerTab({ propertyId }) {
  const today = ymd(new Date());
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(today);
  const { data, loading, error, reload } = useLoader(async () => (propertyId && from && to && to >= from ? packages.ledger(propertyId, { from, to }) : null), [propertyId, from, to]);
  const cols = [
    { key: 'n', label: 'רכיב', render: (r) => <><b>{r.name}</b> <span className="ui-sub" dir="ltr">{r.code}</span></> },
    { key: 'a', label: 'לילות', nowrap: true, render: (r) => <span className="ui-num">{r.nights}</span> },
    { key: 'p', label: 'נרשם בחבילה', nowrap: true, render: (r) => <span className="ui-num">{money(r.price)}</span> },
    { key: 'u', label: 'נוצל', nowrap: true, render: (r) => <span className="ui-num">{money(r.used)}</span> },
    { key: 'pr', label: 'רווח חבילה', nowrap: true, render: (r) => <span className="ui-num">{money(r.profit)}</span> },
    { key: 'l', label: 'הפסד חבילה', nowrap: true, render: (r) => <span className="ui-num">{money(r.loss)}</span> },
    { key: 'e', label: 'חריגה לאורח', nowrap: true, render: (r) => <span className="ui-num">{money(r.excess)}</span> },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="ui-sub">מתאריך <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="ui-sub">עד <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {data && <span className="ui-sub">סה״כ: נרשם {money(data.total.price)} · נוצל {money(data.total.used)} · רווח {money(data.total.profit)} · הפסד {money(data.total.loss)}</span>}
      </div>
      <Card flush>
        <DataTable caption="ספר החבילות" columns={cols} rows={(data?.rows || []).map((r) => ({ ...r, id: r.code }))} loading={loading && !data} error={error} onRetry={reload}
          empty={<Empty title="אין תנועות חבילה בטווח">שורת חבילה נרשמת בסגירת היום, והקצבה נוצרת בניצול הראשון שלה.</Empty>} />
      </Card>
    </>
  );
}

export default function PackagesPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState({ tab: 'components' });
  const { toasts, success } = useToast();
  const canManage = MANAGE.includes(role);
  const tab = url.get('tab');
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="חבילות" meta="רכיבי חבילה, שיוך לתעריפים וספר חבילות" back="/pms" />
      <Segmented label="מסך" value={tab} onChange={(v) => url.set({ tab: v })} options={[{ value: 'components', label: 'רכיבים' }, { value: 'plans', label: 'תעריפים' }, { value: 'ledger', label: 'ספר חבילות' }]} />
      {!canManage && <Banner tone="info">צפייה בלבד — שינוי חבילות למנהל, לאחראי הכנסות או לכספים.</Banner>}
      {tab === 'components' && <ComponentsTab propertyId={propertyId} canManage={canManage} notify={success} />}
      {tab === 'plans' && <PlansTab propertyId={propertyId} canManage={canManage} notify={success} />}
      {tab === 'ledger' && <LedgerTab propertyId={propertyId} />}
    </Page>
  );
}
