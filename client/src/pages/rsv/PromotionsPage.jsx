// Promotions (Optima "Promotion"): promo codes the desk and the booking site enter at booking time.
// List with what each code brought in (bookings, revenue, discount given) and a form to define one.
import { useEffect, useState } from 'react';
import { Plus, Megaphone } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { promotions, rates, roomTypes } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, DataTable, Empty, Modal, Field, Tag, ErrorBanner, Spinner, Segmented, GlassTiles,
  useLoader, useAction, money, formatDateTime,
} from '../../components/kit';
import { formatShort } from '../../utils/date';

const MANAGE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager', 'sales_manager', 'front_desk_manager'];
const KIND = { percent: 'אחוז הנחה', amount: 'הנחה ללילה (₪)', stay_pay: 'שהייה N — תשלום M' };
const CHANNELS = { desk: 'קבלה / טלפון', web: 'אתר ההזמנות' };
const label = (p) => (p.kind === 'percent' ? `${p.value}%` : p.kind === 'amount' ? `${money(p.value, 'ILS', 0)} ללילה` : `${p.stayNights} במחיר ${p.payNights}`);
const range = (a, b) => (a || b ? `${a ? formatShort(a) : '…'} – ${b ? formatShort(b) : '…'}` : 'ללא הגבלה');

function PromoDialog({ open, onClose, propertyId, initial, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const [types, setTypes] = useState([]);
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    if (!open) return;
    act.reset();
    const p = initial || {};
    setF({
      code: p.code || '', name: p.name || '', description: p.description || '', kind: p.kind || 'percent', value: p.value ?? '', stayNights: p.stayNights ?? 3, payNights: p.payNights ?? 2,
      bookFrom: p.bookFrom || '', bookTo: p.bookTo || '', stayFrom: p.stayFrom || '', stayTo: p.stayTo || '', minNights: p.minNights ?? '', minLeadDays: p.minLeadDays ?? '',
      roomTypes: p.roomTypes || [], ratePlans: p.ratePlans || [], channels: p.channels || ['desk', 'web'], maxUses: p.maxUses ?? '', active: p.active ?? true,
    });
    roomTypes.list(propertyId).then((r) => setTypes(Array.isArray(r) ? r : [])).catch(() => setTypes([]));
    rates.plans(propertyId).then((r) => setPlans(Array.isArray(r) ? r : [])).catch(() => setPlans([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggle = (k, v) => setF((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] }));
  const e = act.fields;
  const why = (f.code || '').trim().length < 3 ? 'קוד של 3 תווים לפחות' : (f.name || '').trim().length < 2 ? 'נדרש שם' : !f.channels?.length ? 'בחרו ערוץ' : null;
  const submit = () => act.run(async () => {
    const body = { ...f, value: Number(f.value || 0), stayNights: Number(f.stayNights), payNights: Number(f.payNights), minNights: f.minNights || undefined, minLeadDays: f.minLeadDays || undefined, maxUses: f.maxUses || undefined };
    onSaved(initial ? await promotions.update(propertyId, initial.id, body) : await promotions.create(propertyId, body));
  });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={640} title={initial ? `מבצע ${initial.code}` : 'מבצע חדש'} subtitle="ההנחה חלה על מחיר הלינה בלבד, בקבלה ובאתר"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button>
          <button type="submit" form="promo-form" className="btn btn-primary" disabled={!!why || act.busy} title={why || undefined}>{act.busy ? <Spinner /> : 'שמירה'}</button>
        </>
      )}>
      <form id="promo-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="pr-code" label="קוד" required error={e.code} hint="אותיות באנגלית וספרות"><input id="pr-code" dir="ltr" className="input w-full" maxLength={30} value={f.code || ''} onChange={(ev) => setF((p) => ({ ...p, code: ev.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))} /></Field>
          <Field id="pr-name" label="שם המבצע" required error={e.name}><input id="pr-name" className="input w-full" maxLength={120} value={f.name || ''} onChange={set('name')} /></Field>
        </div>
        <Field id="pr-desc" label="תיאור לאורח" optional hint="מוצג באתר כשהקוד מוחל"><input id="pr-desc" className="input w-full" maxLength={400} value={f.description || ''} onChange={set('description')} /></Field>
        <div className="ui-grid-2">
          <Field id="pr-kind" label="סוג ההטבה" required><select id="pr-kind" className="select w-full" value={f.kind} onChange={set('kind')}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {f.kind !== 'stay_pay'
            ? <Field id="pr-val" label={f.kind === 'percent' ? 'אחוז' : 'סכום ללילה (₪)'} required error={e.value}><input id="pr-val" type="number" min="0" step="0.01" className="input w-full" value={f.value} onChange={set('value')} /></Field>
            : (
              <div className="ui-grid-2">
                <Field id="pr-sn" label="לילות שהייה" required error={e.stayNights}><input id="pr-sn" type="number" min="2" className="input w-full" value={f.stayNights} onChange={set('stayNights')} /></Field>
                <Field id="pr-pn" label="משלמים על" required error={e.payNights}><input id="pr-pn" type="number" min="1" className="input w-full" value={f.payNights} onChange={set('payNights')} /></Field>
              </div>
            )}
          <Field id="pr-bf" label="הזמנה מתאריך" optional><input id="pr-bf" type="date" className="input w-full" value={f.bookFrom} onChange={set('bookFrom')} /></Field>
          <Field id="pr-bt" label="הזמנה עד תאריך" optional error={e.bookTo}><input id="pr-bt" type="date" className="input w-full" value={f.bookTo} onChange={set('bookTo')} /></Field>
          <Field id="pr-sf" label="הגעה מתאריך" optional><input id="pr-sf" type="date" className="input w-full" value={f.stayFrom} onChange={set('stayFrom')} /></Field>
          <Field id="pr-st" label="הגעה עד תאריך" optional error={e.stayTo}><input id="pr-st" type="date" className="input w-full" value={f.stayTo} onChange={set('stayTo')} /></Field>
          <Field id="pr-mn" label="מינימום לילות" optional><input id="pr-mn" type="number" min="1" className="input w-full" value={f.minNights} onChange={set('minNights')} /></Field>
          <Field id="pr-ml" label="הזמנה מוקדמת — ימים מראש" optional><input id="pr-ml" type="number" min="1" className="input w-full" value={f.minLeadDays} onChange={set('minLeadDays')} /></Field>
          <Field id="pr-mu" label="מקסימום הזמנות" optional error={e.maxUses} hint="ריק = ללא הגבלה"><input id="pr-mu" type="number" min="1" className="input w-full" value={f.maxUses} onChange={set('maxUses')} /></Field>
        </div>
        <fieldset className="ui-fieldset"><legend className="ui-label">ערוצים</legend>
          {Object.entries(CHANNELS).map(([k, v]) => <label key={k} className="ui-check"><input type="checkbox" checked={f.channels?.includes(k) || false} onChange={() => toggle('channels', k)} /><span>{v}</span></label>)}
        </fieldset>
        <fieldset className="ui-fieldset"><legend className="ui-label">סוגי חדרים <span className="ui-sub">(ללא סימון = כולם)</span></legend>
          {types.map((t) => <label key={t._id} className="ui-check"><input type="checkbox" checked={f.roomTypes?.includes(String(t._id)) || false} onChange={() => toggle('roomTypes', String(t._id))} /><span>{t.name}</span></label>)}
        </fieldset>
        <fieldset className="ui-fieldset"><legend className="ui-label">תעריפים <span className="ui-sub">(ללא סימון = כולם)</span></legend>
          {plans.map((t) => <label key={t._id} className="ui-check"><input type="checkbox" checked={f.ratePlans?.includes(String(t._id)) || false} onChange={() => toggle('ratePlans', String(t._id))} /><span>{t.name}</span></label>)}
        </fieldset>
        <label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={set('active')} /><span>פעיל</span></label>
      </form>
    </Modal>
  );
}

export default function PromotionsPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const { toasts, success } = useToast();
  const [view, setView] = useState('active');
  const [dialog, setDialog] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? promotions.list(propertyId) : null), [propertyId]);
  const all = data?.rows || [];
  const rows = all.filter((p) => (view === 'active' ? p.active : !p.active));
  const canManage = MANAGE.includes(role);
  const sum = (k) => all.reduce((s, p) => s + (p.usage?.[k] || 0), 0);
  const cols = [
    { key: 'code', label: 'קוד', nowrap: true, render: (p) => <bdi className="ui-num"><b>{p.code}</b></bdi> },
    { key: 'name', label: 'מבצע', render: (p) => (<div><div>{p.name}</div>{p.description && <div className="ui-sub">{p.description}</div>}</div>) },
    { key: 'deal', label: 'הטבה', nowrap: true, render: (p) => label(p) },
    { key: 'when', label: 'הזמנה · הגעה', render: (p) => <div className="ui-sub ui-num">{range(p.bookFrom, p.bookTo)}<br />{range(p.stayFrom, p.stayTo)}</div> },
    { key: 'ch', label: 'ערוצים', render: (p) => p.channels.map((c) => <Tag key={c}>{CHANNELS[c]}</Tag>) },
    { key: 'use', label: 'הזמנות', nowrap: true, render: (p) => <span className="ui-num">{p.usage.bookings}{p.maxUses ? ` / ${p.maxUses}` : ''}</span> },
    { key: 'rev', label: 'הכנסה · הנחה', nowrap: true, align: 'left', render: (p) => <div className="ui-num">{money(p.usage.revenue, 'ILS', 0)}<div className="ui-sub">הנחה {money(p.usage.saving, 'ILS', 0)}</div></div> },
    { key: 'upd', label: 'עודכן', nowrap: true, render: (p) => <span className="ui-sub">{formatDateTime(p.updatedAt)}{p.updatedBy ? ` · ${p.updatedBy}` : ''}</span> },
  ];
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="מבצעים וקודי הנחה" back="/pms" tools={canManage ? <button type="button" className="btn btn-primary" onClick={() => setDialog({ p: null })}><Plus size={16} /> מבצע חדש</button> : null} />
      <GlassTiles label="סיכום מבצעים" items={[
        { id: 'a', label: 'מבצעים פעילים', value: all.filter((p) => p.active).length, icon: Megaphone },
        { id: 'b', label: 'הזמנות עם קוד', value: sum('bookings') },
        { id: 'r', label: 'הכנסה מהזמנות עם קוד', value: money(sum('revenue'), 'ILS', 0) },
        { id: 's', label: 'סך ההנחות שניתנו', value: money(sum('saving'), 'ILS', 0) },
      ]} />
      <Segmented label="סינון" value={view} onChange={setView} options={[{ value: 'active', label: 'פעילים', count: all.filter((p) => p.active).length }, { value: 'off', label: 'מושבתים', count: all.filter((p) => !p.active).length }]} />
      <Card flush>
        <DataTable caption="מבצעים" columns={cols} rows={rows} loading={loading && !data} error={error} onRetry={reload} onRowClick={canManage ? (p) => setDialog({ p }) : undefined}
          empty={<Empty title={view === 'active' ? 'אין מבצעים פעילים' : 'אין מבצעים מושבתים'}>מבצע הוא קוד שהאורח או הפקיד מזינים בהזמנה — אחוז הנחה, הנחה ללילה או "3 לילות במחיר 2".</Empty>} />
      </Card>
      <PromoDialog open={!!dialog} onClose={() => setDialog(null)} propertyId={propertyId} initial={dialog?.p} onSaved={(o) => { setDialog(null); success(`המבצע ${o.code} נשמר`); reload(); }} />
    </Page>
  );
}
