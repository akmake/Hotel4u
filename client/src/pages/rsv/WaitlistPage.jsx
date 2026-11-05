// Waitlist, deposits due, confirmations to send and items (gap-map item 15).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import '../ops/EventsPage.css';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { resExtras, resDetails, roomTypes as roomTypesApi } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, PageBar, Card, DataTable, Empty, Modal, Field, Pill, ErrorBanner, Spinner, Segmented, useLoader, useAction, useUrlState, money, formatDateTime } from '../../components/kit';

const MANAGERS = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'housekeeping_manager'];
const ymd = (d) => d.toISOString().slice(0, 10);
const plus = (n) => ymd(new Date(Date.now() + n * 86400000));

function AddWaitDialog({ open, onClose, propertyId, onDone }) {
  const act = useAction();
  const types = useLoader(async () => (open ? roomTypesApi.list(propertyId) : null), [open, propertyId]);
  const opts = useLoader(async () => (open ? resDetails.options(propertyId) : null), [open, propertyId]);
  const [f, setF] = useState({});
  useEffect(() => { if (open) { act.reset(); setF({ firstName: '', lastName: '', phone: '', roomTypeId: '', ratePlanId: '', arrival: plus(7), departure: plus(9), adults: 2, children: 0, priority: 3, note: '' }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const e = act.fields;
  const typeList = (Array.isArray(types.data) ? types.data : types.data?.rows || types.data?.roomTypes || []);
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={560} title="בקשה לרשימת ההמתנה" subtitle="לא תופסת מלאי. כשסוג החדר מתפנה — מקבלים אותה בלחיצה"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy} onClick={() => act.run(async () => { const r = await resExtras.addWaitlist(propertyId, { newGuest: { firstName: f.firstName, lastName: f.lastName, phone: f.phone }, roomTypeId: f.roomTypeId, ratePlanId: f.ratePlanId || undefined, arrival: f.arrival, departure: f.departure, adults: Number(f.adults), children: Number(f.children), priority: Number(f.priority), note: f.note }); onDone(`נרשם להמתנה · ${r.confirmationNumber}`); })}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <div className="ui-grid-3">
          <Field id="wl-fn" label="שם פרטי" required error={e.firstName}><input id="wl-fn" className="input w-full" value={f.firstName || ''} onChange={set('firstName')} /></Field>
          <Field id="wl-ln" label="שם משפחה" required error={e.lastName}><input id="wl-ln" className="input w-full" value={f.lastName || ''} onChange={set('lastName')} /></Field>
          <Field id="wl-ph" label="טלפון" error={e.phone}><input id="wl-ph" dir="ltr" className="input w-full" value={f.phone || ''} onChange={set('phone')} /></Field>
          <Field id="wl-a" label="הגעה" error={e.arrival}><input id="wl-a" type="date" className="input w-full" value={f.arrival || ''} onChange={set('arrival')} /></Field>
          <Field id="wl-d" label="עזיבה"><input id="wl-d" type="date" className="input w-full" value={f.departure || ''} onChange={set('departure')} /></Field>
          <Field id="wl-p" label="עדיפות (1 = ראשון)"><input id="wl-p" type="number" min="1" max="5" className="input w-full" value={f.priority} onChange={set('priority')} /></Field>
          <Field id="wl-rt" label="סוג חדר" required error={e.roomTypeId}><select id="wl-rt" className="input w-full" value={f.roomTypeId || ''} onChange={set('roomTypeId')}><option value="">בחירה…</option>{typeList.map((t) => <option key={t._id || t.id} value={t._id || t.id}>{t.name}</option>)}</select></Field>
          <Field id="wl-pl" label="תעריף"><select id="wl-pl" className="input w-full" value={f.ratePlanId || ''} onChange={set('ratePlanId')}><option value="">—</option>{(opts.data?.ratePlans || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field id="wl-ad" label="מבוגרים / ילדים"><div style={{ display: 'flex', gap: 6 }}><input aria-label="מבוגרים" type="number" min="1" className="input w-full" value={f.adults} onChange={set('adults')} /><input aria-label="ילדים" type="number" min="0" className="input w-full" value={f.children} onChange={set('children')} /></div></Field>
        </div>
        <Field id="wl-n" label="הערה"><input id="wl-n" className="input w-full" value={f.note || ''} onChange={set('note')} /></Field>
      </div>
    </Modal>
  );
}

function WaitTab({ propertyId, notify }) {
  const nav = useNavigate();
  const [add, setAdd] = useState(false);
  const act = useAction();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? resExtras.waitlist(propertyId) : null), [propertyId]);
  const cols = [
    { key: 'p', label: 'עדיפות', nowrap: true, render: (r) => <span className="ui-num">{r.priority}</span> },
    { key: 'g', label: 'אורח', render: (r) => <><b>{r.guest}</b> <span className="ui-sub" dir="ltr">{r.phone || ''}</span>{r.note ? <div className="ui-sub">{r.note}</div> : null}</> },
    { key: 'd', label: 'תאריכים', nowrap: true, render: (r) => `${formatShort(r.arrival)} – ${formatShort(r.departure)}` },
    { key: 't', label: 'חדר', nowrap: true, render: (r) => `${r.roomType}${r.ratePlan ? ` · ${r.ratePlan}` : ''}` },
    { key: 'a', label: 'זמינות', nowrap: true, render: (r) => (r.available ? <Pill tone="ok">פנוי עכשיו</Pill> : <Pill tone="muted">מלא</Pill>) },
    { key: 'x', label: '', nowrap: true, render: (r) => <span style={{ display: 'inline-flex', gap: 6 }}>
      <button type="button" className="btn btn-primary btn-sm" disabled={!r.available || act.busy} onClick={() => act.run(async () => { const b = await resExtras.promote(propertyId, r.id); notify(`נקלטה הזמנה ${b.confirmationNumber}`); reload(); nav(`/pms/reservations/${b.id}`); })}>קבלה להזמנה</button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy} onClick={() => act.run(async () => { await resExtras.removeWait(propertyId, r.id, 'הוסר ידנית'); notify('הוסר מהרשימה'); reload(); })}>הסרה</button>
    </span> },
  ];
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary btn-sm" onClick={() => setAdd(true)}><Plus size={14} /> בקשה חדשה</button></div>
      <ErrorBanner error={act.error} />
      <Card flush><DataTable caption="רשימת המתנה" columns={cols} rows={data || []} loading={loading && !data} error={error} onRetry={reload} empty={<Empty title="רשימת ההמתנה ריקה">אורח שביקש תאריכים מלאים נרשם כאן. בקשה שתאריך ההגעה שלה עבר יורדת בסגירת היום.</Empty>} /></Card>
      <AddWaitDialog open={add} onClose={() => setAdd(false)} propertyId={propertyId} onDone={(m) => { setAdd(false); notify(m); reload(); }} />
    </>
  );
}

function DepositsTab({ propertyId, notify }) {
  const nav = useNavigate();
  const act = useAction();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? resExtras.deposits(propertyId) : null), [propertyId]);
  const cols = [
    { key: 'g', label: 'אורח / הזמנה', render: (r) => <><b>{r.guest}</b> <span className="ui-sub" dir="ltr">{r.confirmationNumber}</span></> },
    { key: 'a', label: 'הגעה', nowrap: true, render: (r) => formatShort(r.arrival) },
    { key: 'd', label: 'יעד', nowrap: true, render: (r) => (r.overdue ? <Pill tone="bad">{formatShort(r.dueDate)} — עבר</Pill> : formatShort(r.dueDate)) },
    { key: 'm', label: 'מקדמה / שולם / פתוח', nowrap: true, render: (r) => <span className="ui-num">{money(r.amount)} / {money(r.paid)} / <b>{money(r.open)}</b></span> },
    { key: 'r', label: 'תזכורת', nowrap: true, render: (r) => <span className="ui-sub">{r.remindedAt ? formatDateTime(r.remindedAt) : '—'}</span> },
    { key: 'x', label: '', nowrap: true, render: (r) => <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy || !r.email} title={r.email ? '' : 'אין דוא״ל לאורח'} onClick={() => act.run(async () => { await resExtras.remind(propertyId, r.id); notify('התזכורת נשלחה'); reload(); })}>תזכורת</button> },
  ];
  return (
    <>
      <ErrorBanner error={act.error} />
      <Card flush><DataTable caption="מקדמות פתוחות" columns={cols} rows={data?.rows || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={(r) => nav(`/pms/reservations/${r.id}`)} empty={<Empty title="אין מקדמות פתוחות">מקדמה עם תאריך יעד נקבעת בתיק ההזמנה (כרטיס "תשלום, משק ופריטים"). תזכורת אוטומטית נשלחת יומיים לפני היעד.</Empty>} /></Card>
    </>
  );
}

function ConfirmTab({ propertyId, notify }) {
  const [range, setRange] = useState({ from: ymd(new Date()), to: plus(14) });
  const [sel, setSel] = useState([]);
  const act = useAction();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? resExtras.unconfirmed(propertyId, range.from, range.to) : null), [propertyId, range.from, range.to]);
  const rows = data || [];
  const cols = [
    { key: 's', label: '', nowrap: true, render: (r) => <input type="checkbox" aria-label={`בחירת ${r.confirmationNumber}`} checked={sel.includes(r.id)} onChange={() => setSel((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))} /> },
    { key: 'g', label: 'אורח', render: (r) => <><b>{r.guest}</b> <span className="ui-sub" dir="ltr">{r.confirmationNumber}</span></> },
    { key: 'a', label: 'הגעה', nowrap: true, render: (r) => formatShort(r.arrival) },
    { key: 'l', label: 'שפה', nowrap: true, render: (r) => (r.language === 'en' ? 'אנגלית' : 'עברית') },
    { key: 'e', label: 'דוא״ל', render: (r) => (r.email ? <span dir="ltr">{r.email}</span> : <Pill tone="bad">אין</Pill>) },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <label className="ui-sub">הגעות מ־ <input type="date" className="input" value={range.from} onChange={(e) => setRange((p) => ({ ...p, from: e.target.value }))} /></label>
          <label className="ui-sub">עד <input type="date" className="input" value={range.to} onChange={(e) => setRange((p) => ({ ...p, to: e.target.value }))} /></label>
        </div>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSel(rows.filter((r) => r.email).map((r) => r.id))}>בחירת כל מי שיש לו דוא״ל</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!sel.length || act.busy} onClick={() => act.run(async () => { const r = await resExtras.sendConfirmations(propertyId, sel); notify(`נשלחו ${r.sent}${r.failed ? `, נכשלו ${r.failed}: ${r.rows.find((x) => !x.sent)?.error || ''}` : ''}`); setSel([]); reload(); })}>שליחת אישורים ({sel.length})</button>
        </span>
      </div>
      <ErrorBanner error={act.error} />
      <Card flush><DataTable caption="אישורים שלא נשלחו" columns={cols} rows={rows} loading={loading && !data} error={error} onRetry={reload} empty={<Empty title="כל ההזמנות בטווח קיבלו אישור" />} /></Card>
    </>
  );
}

function ItemsTab({ propertyId, notify, canManage }) {
  const [dlg, setDlg] = useState(null);
  const [f, setF] = useState({});
  const act = useAction();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? resExtras.items(propertyId) : null), [propertyId]);
  const av = useLoader(async () => (propertyId ? resExtras.itemAvailability(propertyId, ymd(new Date()), plus(1)) : null), [propertyId, data]);
  useEffect(() => { if (dlg) { act.reset(); setF({ code: dlg.item?.code || '', name: dlg.item?.name || '', total: dlg.item?.total ?? 1, price: dlg.item?.price ?? '', active: dlg.item?.active ?? true }); } }, [dlg]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = [
    { key: 'n', label: 'פריט', render: (t) => <><b>{t.name}</b> <span className="ui-sub" dir="ltr">{t.code}</span></> },
    { key: 't', label: 'מלאי', nowrap: true, render: (t) => <span className="ui-num">{t.total}</span> },
    { key: 'f', label: 'פנוי הלילה', nowrap: true, render: (t) => <span className="ui-num">{av.data?.find((x) => x.id === t.id)?.minFree ?? '—'}</span> },
    { key: 'p', label: 'מחיר ללילה', nowrap: true, render: (t) => (t.price != null ? money(t.price) : '—') },
    { key: 'a', label: 'מצב', nowrap: true, render: (t) => (t.active ? <Pill tone="ok">פעיל</Pill> : <Pill tone="muted">מושבת</Pill>) },
  ];
  return (
    <>
      {canManage && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg({ item: null })}><Plus size={14} /> פריט</button></div>}
      <Card flush><DataTable caption="פריטים" columns={cols} rows={data || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={canManage ? (t) => setDlg({ item: t }) : undefined} empty={<Empty title="אין פריטים">מיטה מתקפלת, כיסא תינוק, תנור… כל פריט עם מלאי, ונתפס לפי לילה בהזמנה.</Empty>} /></Card>
      <Modal open={!!dlg} onClose={() => setDlg(null)} busy={act.busy} width={420} title={dlg?.item ? dlg.item.name : 'פריט חדש'}
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setDlg(null)} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy} onClick={() => act.run(async () => { await resExtras.saveItem(propertyId, dlg.item?.id, { ...f, total: Number(f.total) }); setDlg(null); notify('נשמר'); reload(); })}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
        <div className="ui-stack">
          <ErrorBanner error={act.error} />
          <div className="ui-grid-2">
            <Field id="it-c" label="קוד" error={act.fields.code}><input id="it-c" dir="ltr" className="input w-full" disabled={!!dlg?.item} value={f.code || ''} onChange={(e) => setF((p) => ({ ...p, code: e.target.value.toUpperCase() }))} /></Field>
            <Field id="it-n" label="שם" error={act.fields.name}><input id="it-n" className="input w-full" value={f.name || ''} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} /></Field>
            <Field id="it-t" label="מלאי" error={act.fields.total}><input id="it-t" type="number" min="0" className="input w-full" value={f.total ?? ''} onChange={(e) => setF((p) => ({ ...p, total: e.target.value }))} /></Field>
            <Field id="it-p" label="מחיר ללילה (מידע)"><input id="it-p" type="number" min="0" className="input w-full" value={f.price ?? ''} onChange={(e) => setF((p) => ({ ...p, price: e.target.value }))} /></Field>
          </div>
          <label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} /><span>פעיל</span></label>
        </div>
      </Modal>
    </>
  );
}

export default function WaitlistPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState({ tab: 'wait' });
  const { toasts, success } = useToast();
  const tab = url.get('tab');
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="המתנה, מקדמות ואישורים" meta="רשימת המתנה עם קבלה להזמנה, מקדמות לפי תאריך יעד, אישורים שלא נשלחו ופריטים" back="/pms" />
      <Segmented label="מסך" value={tab} onChange={(v) => url.set({ tab: v })} options={[{ value: 'wait', label: 'רשימת המתנה' }, { value: 'deposits', label: 'מקדמות' }, { value: 'confirm', label: 'אישורים' }, { value: 'items', label: 'פריטים' }]} />
      {tab === 'wait' && <WaitTab propertyId={propertyId} notify={success} />}
      {tab === 'deposits' && <DepositsTab propertyId={propertyId} notify={success} />}
      {tab === 'confirm' && <ConfirmTab propertyId={propertyId} notify={success} />}
      {tab === 'items' && <ItemsTab propertyId={propertyId} notify={success} canManage={MANAGERS.includes(role)} />}
    </Page>
  );
}
