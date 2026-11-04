// Group blocks (Optima "New group"): rooms held for a group per room type, the negotiated price,
// a cut-off for unpicked rooms, the rooming list, and pickups that book real reservations from the block.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, CalendarClock, BedDouble } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { groupBlocks, booking, roomTypes as roomTypesApi, rates as ratesApi } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, Segmented, SearchBox, DataTable, Empty, Modal, Field, ConfirmDialog, Tag, Banner,
  ErrorBanner, Spinner, GlassTiles, useUrlState, useLoader, useAction, money, newOpKey,
} from '../../components/kit';

const WORK = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'sales_manager', 'revenue_manager', 'receptionist'];
const MANAGE = WORK.filter((r) => r !== 'receptionist');
const DEFAULTS = { view: 'upcoming', q: '', block: '' };
const TONE = { tentative: 'warn', confirmed: 'ok', active: 'ok', cancelled: 'bad' };
const RES_LABEL = { confirmed: 'מאושרת', checked_in: 'בבית', in_house: 'בבית', checked_out: 'יצא', cancelled: 'בוטלה', no_show: 'לא הגיע', hold: 'בהמתנה', modified: 'עודכנה' };

function Foot({ onClose, busy, label, why, form }) {
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ביטול</button>
      <button type="submit" form={form} className="btn btn-primary" disabled={!!why || busy} title={why || undefined}>{busy ? <Spinner /> : label}</button>
    </>
  );
}

function BlockDialog({ open, onClose, propertyId, initial, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const [types, setTypes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [cos, setCos] = useState([]);
  useEffect(() => {
    if (!open) return;
    act.reset();
    const b = initial || {};
    setF({
      name: b.name || '', groupCode: '', arrivalDate: b.arrivalDate || '', departureDate: b.departureDate || '', cutoffDate: b.cutoffDate || '', autoReleaseOnCutoff: b.autoReleaseOnCutoff ?? true,
      companyId: b.company?.id || '', ratePlanId: b.ratePlanId || '', contactName: b.contactName || '', contactPhone: b.contactPhone || '', contactEmail: b.contactEmail || '',
      depositAmount: b.depositAmount || '', depositDueDate: b.depositDueDate || '', internalNotes: b.internalNotes || '',
      allot: Object.fromEntries((b.allotments || []).map((a) => [a.roomTypeId, { blocked: String(a.blocked), rate: a.negotiatedRate ?? '' }])),
    });
    roomTypesApi.list(propertyId).then((r) => setTypes(Array.isArray(r) ? r : [])).catch(() => setTypes([]));
    ratesApi.plans(propertyId).then((r) => setPlans(Array.isArray(r) ? r : [])).catch(() => setPlans([]));
    booking.companies(propertyId).then((r) => setCos(Array.isArray(r) ? r : r?.rows || [])).catch(() => setCos([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setAllot = (id, k, v) => setF((p) => ({ ...p, allot: { ...p.allot, [id]: { ...(p.allot?.[id] || {}), [k]: v } } }));
  const allotments = Object.entries(f.allot || {}).filter(([, a]) => Number(a.blocked) > 0 || initial).map(([roomTypeId, a]) => ({ roomTypeId, blocked: Number(a.blocked || 0), negotiatedRate: a.rate === '' ? undefined : Number(a.rate) }));
  const rooms = allotments.reduce((s, a) => s + a.blocked, 0);
  const e = act.fields;
  const why = (f.name || '').trim().length < 2 ? 'נדרש שם' : !initial && (!f.arrivalDate || !f.departureDate) ? 'נדרשים תאריכים' : !rooms ? 'חסמו לפחות חדר אחד' : null;
  const submit = () => act.run(async () => {
    const body = { ...f, allotments, depositAmount: Number(f.depositAmount || 0) };
    delete body.allot;
    onSaved(initial ? await groupBlocks.update(propertyId, initial.id, body) : await groupBlocks.create(propertyId, body));
  });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={720} title={initial ? `עריכת קבוצה ${initial.groupCode}` : 'קבוצה חדשה'} subtitle="החדרים שנחסמים יורדים מהזמינות עד שנרשמות הזמנות או עד תאריך השחרור" footer={<Foot onClose={onClose} busy={act.busy} label={initial ? 'שמירה' : 'פתיחת קבוצה'} why={why} form="gb-form" />}>
      <form id="gb-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="gb-name" label="שם הקבוצה" required error={e.name}><input id="gb-name" className="input w-full" maxLength={120} value={f.name || ''} onChange={set('name')} /></Field>
          {!initial && <Field id="gb-code" label="קוד קבוצה" optional hint="ריק = יוקצה אוטומטית" error={e.groupCode}><input id="gb-code" dir="ltr" className="input w-full" maxLength={20} value={f.groupCode || ''} onChange={(ev) => setF((p) => ({ ...p, groupCode: ev.target.value.toUpperCase() }))} /></Field>}
          {!initial && <Field id="gb-arr" label="הגעה" required error={e.arrivalDate}><input id="gb-arr" type="date" className="input w-full" value={f.arrivalDate} onChange={set('arrivalDate')} /></Field>}
          {!initial && <Field id="gb-dep" label="עזיבה" required error={e.departureDate}><input id="gb-dep" type="date" className="input w-full" min={f.arrivalDate || undefined} value={f.departureDate} onChange={set('departureDate')} /></Field>}
          <Field id="gb-cut" label="תאריך שחרור (cut-off)" optional error={e.cutoffDate} hint="אחריו חדרים שלא נרשמו חוזרים למכירה"><input id="gb-cut" type="date" className="input w-full" max={f.arrivalDate || initial?.arrivalDate || undefined} value={f.cutoffDate} onChange={set('cutoffDate')} /></Field>
          <Field id="gb-plan" label="תעריף להזמנות" optional error={e.ratePlanId} hint="ריק = תעריף קבוצות או הראשון">
            <select id="gb-plan" className="select w-full" value={f.ratePlanId} onChange={set('ratePlanId')}><option value="">— אוטומטי —</option>{plans.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
          </Field>
          <Field id="gb-co" label="חברה" optional error={e.companyId}>
            <select id="gb-co" className="select w-full" value={f.companyId} onChange={set('companyId')}><option value="">— ללא —</option>{cos.map((c) => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}</select>
          </Field>
          <Field id="gb-cn" label="איש קשר" optional><input id="gb-cn" className="input w-full" maxLength={120} value={f.contactName || ''} onChange={set('contactName')} /></Field>
          <Field id="gb-cp" label="טלפון" optional><input id="gb-cp" dir="ltr" className="input w-full" maxLength={30} value={f.contactPhone || ''} onChange={set('contactPhone')} /></Field>
          <Field id="gb-ce" label="דוא״ל" optional><input id="gb-ce" dir="ltr" className="input w-full" maxLength={120} value={f.contactEmail || ''} onChange={set('contactEmail')} /></Field>
          <Field id="gb-dep-a" label="מקדמה נדרשת (₪)" optional><input id="gb-dep-a" type="number" min="0" className="input w-full" value={f.depositAmount} onChange={set('depositAmount')} /></Field>
          <Field id="gb-dep-d" label="מקדמה עד" optional><input id="gb-dep-d" type="date" className="input w-full" value={f.depositDueDate} onChange={set('depositDueDate')} /></Field>
        </div>
        <fieldset className="ui-fieldset">
          <legend className="ui-label">חדרים בבלוק {rooms ? <span className="ui-sub">· {rooms} חדרים</span> : null}</legend>
          {e.allotments && <Banner tone="warn">{e.allotments}</Banner>}
          <table className="ui-table" style={{ width: '100%' }}>
            <thead><tr><th>סוג חדר</th><th>חדרים</th><th>מחיר ללילה (₪, כולל מע״מ)</th></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t._id}>
                  <td>{t.name}</td>
                  <td><input type="number" min="0" className="input" style={{ width: 90 }} aria-label={`חדרים ${t.name}`} value={f.allot?.[t._id]?.blocked ?? ''} onChange={(ev) => setAllot(t._id, 'blocked', ev.target.value)} /></td>
                  <td><input type="number" min="0" step="0.01" className="input" style={{ width: 130 }} aria-label={`מחיר ${t.name}`} placeholder="לפי התעריף" value={f.allot?.[t._id]?.rate ?? ''} onChange={(ev) => setAllot(t._id, 'rate', ev.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
        <label className="ui-check"><input type="checkbox" checked={!!f.autoReleaseOnCutoff} onChange={set('autoReleaseOnCutoff')} /><span>לשחרר אוטומטית חדרים שלא נרשמו בתאריך השחרור</span></label>
        <Field id="gb-notes" label="הערה פנימית" optional><input id="gb-notes" className="input w-full" maxLength={1000} value={f.internalNotes || ''} onChange={set('internalNotes')} /></Field>
      </form>
    </Modal>
  );
}

function PickupDialog({ open, onClose, propertyId, block, roster, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const [key, setKey] = useState('');
  useEffect(() => {
    if (!open || !block) return;
    act.reset(); setKey(newOpKey());
    const [first, ...rest] = String(roster?.guestName || '').trim().split(/\s+/);
    const firstOpen = block.allotments.find((a) => a.remaining > 0);
    setF({ roomTypeId: roster?.roomTypeId || firstOpen?.roomTypeId || '', firstName: first || '', lastName: rest.join(' '), phone: roster?.guestPhone || '', email: roster?.guestEmail || '', adults: '2', arrival: block.arrivalDate, departure: block.departureDate, payerType: block.company ? 'company' : 'guest' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!block) return null;
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const a = block.allotments.find((x) => x.roomTypeId === f.roomTypeId);
  const why = !a ? 'בחרו סוג חדר' : a.remaining < 1 ? 'לא נותרו חדרים מסוג זה' : !(f.firstName || '').trim() || !(f.lastName || '').trim() ? 'שם פרטי ומשפחה' : !(f.phone || '').trim() && !(f.email || '').trim() ? 'טלפון או דוא״ל' : null;
  const submit = () => act.run(async () => onSaved(await groupBlocks.pickup(propertyId, block.id, {
    idempotencyKey: key, roomTypeId: f.roomTypeId, adults: Number(f.adults || 1), arrival: f.arrival, departure: f.departure, payerType: f.payerType, rosterId: roster?.id,
    newGuest: { firstName: f.firstName.trim(), lastName: f.lastName.trim(), phone: f.phone.trim(), email: f.email.trim() }, forceNewGuest: true,
  })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={560} title="רישום הזמנה מהבלוק" subtitle={`${block.name} · ${block.groupCode}`} footer={<Foot onClose={onClose} busy={act.busy} label="רישום הזמנה" why={why} form="pk-form" />}>
      <form id="pk-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="pk-type" label="סוג חדר" required error={act.fields.roomTypeId}>
            <select id="pk-type" className="select w-full" value={f.roomTypeId} onChange={set('roomTypeId')}>
              {block.allotments.map((x) => <option key={x.roomTypeId} value={x.roomTypeId} disabled={x.remaining < 1}>{x.roomTypeName} · נותרו {x.remaining}{x.negotiatedRate ? ` · ${money(x.negotiatedRate, 'ILS', 0)}` : ''}</option>)}
            </select>
          </Field>
          <Field id="pk-ad" label="מבוגרים" required><input id="pk-ad" type="number" min="1" max="10" className="input w-full" value={f.adults} onChange={set('adults')} /></Field>
          <Field id="pk-fn" label="שם פרטי" required error={act.fields.firstName}><input id="pk-fn" className="input w-full" maxLength={60} value={f.firstName || ''} onChange={set('firstName')} /></Field>
          <Field id="pk-ln" label="שם משפחה" required error={act.fields.lastName}><input id="pk-ln" className="input w-full" maxLength={60} value={f.lastName || ''} onChange={set('lastName')} /></Field>
          <Field id="pk-ph" label="טלפון" error={act.fields.phone}><input id="pk-ph" dir="ltr" className="input w-full" maxLength={20} value={f.phone || ''} onChange={set('phone')} /></Field>
          <Field id="pk-em" label="דוא״ל" optional error={act.fields.email}><input id="pk-em" dir="ltr" className="input w-full" maxLength={120} value={f.email || ''} onChange={set('email')} /></Field>
          <Field id="pk-a" label="הגעה" required error={act.fields.arrival}><input id="pk-a" type="date" className="input w-full" min={block.arrivalDate} max={block.departureDate} value={f.arrival} onChange={set('arrival')} /></Field>
          <Field id="pk-d" label="עזיבה" required><input id="pk-d" type="date" className="input w-full" min={block.arrivalDate} max={block.departureDate} value={f.departure} onChange={set('departure')} /></Field>
          {block.company && (
            <Field id="pk-pay" label="משלם" required>
              <select id="pk-pay" className="select w-full" value={f.payerType} onChange={set('payerType')}><option value="company">{block.company.name}</option><option value="guest">האורח</option></select>
            </Field>
          )}
        </div>
        {a && <p className="ui-sub">{a.negotiatedRate ? `מחיר קבוצה ${money(a.negotiatedRate)} ללילה` : 'מחיר לפי התעריף של הקבוצה'}</p>}
      </form>
    </Modal>
  );
}

function RosterDialog({ open, onClose, propertyId, block, onSaved }) {
  const act = useAction();
  const [text, setText] = useState('');
  const [typeId, setTypeId] = useState('');
  useEffect(() => { if (open) { setText(''); setTypeId(block?.allotments[0]?.roomTypeId || ''); act.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!block) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const submit = () => act.run(async () => {
    const keep = block.roomingList.map((r) => ({ ...r }));
    const added = lines.map((l) => { const [guestName, guestPhone, guestEmail] = l.split(/[,\t;]/).map((x) => (x || '').trim()); return { guestName, guestPhone, guestEmail, roomTypeId: typeId }; });
    onSaved(await groupBlocks.roster(propertyId, block.id, [...keep, ...added]));
  });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={560} title="הוספה לרשימת השמות" subtitle="שורה לכל אורח: שם, טלפון, דוא״ל (מופרדים בפסיק)" footer={<Foot onClose={onClose} busy={act.busy} label={`הוספת ${lines.length || ''} שמות`} why={!lines.length ? 'הדביקו שמות' : null} form="rs-form" />}>
      <form id="rs-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (lines.length) submit(); }}>
        <ErrorBanner error={act.error} />
        <Field id="rs-type" label="סוג חדר" required>
          <select id="rs-type" className="select w-full" value={typeId} onChange={(e) => setTypeId(e.target.value)}>{block.allotments.map((a) => <option key={a.roomTypeId} value={a.roomTypeId}>{a.roomTypeName}</option>)}</select>
        </Field>
        <Field id="rs-text" label="שמות" required><textarea id="rs-text" className="input w-full" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'ישראל ישראלי, 0501234567\nדנה כהן, 0527654321, dana@mail.com'} /></Field>
      </form>
    </Modal>
  );
}

function BlockView({ propertyId, id, role }) {
  const nav = useNavigate();
  const { toasts, success } = useToast();
  const [dialog, setDialog] = useState(null);
  const { data: b, loading, error, reload } = useLoader(async () => (propertyId ? groupBlocks.get(propertyId, id) : null), [propertyId, id]);
  const canWork = WORK.includes(role);
  const canManage = MANAGE.includes(role);
  if (loading && !b) return <div className="ui-empty"><Spinner /> טוען…</div>;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!b) return null;
  const live = ['tentative', 'confirmed', 'active'].includes(b.status);
  const act = (action, body) => groupBlocks.act(propertyId, b.id, action, body).then(() => { setDialog(null); success(action === 'confirm' ? 'הקבוצה אושרה' : action === 'release' ? 'החדרים שוחררו למכירה' : 'הקבוצה בוטלה'); reload(); });
  return (
    <>
      <ToastContainer toasts={toasts} />
      <PageBar
        back="/pms/groups"
        title={<>{b.name} <bdi className="ui-sub">{b.groupCode}</bdi> <Tag tone={TONE[b.status]}>{b.statusLabel}</Tag></>}
        meta={`${formatShort(b.arrivalDate)} – ${formatShort(b.departureDate)} · ${b.nights} לילות${b.company ? ` · ${b.company.name}` : ''}${b.contactName ? ` · ${b.contactName}` : ''}${b.contactPhone ? ` ${b.contactPhone}` : ''}`}
        tools={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {live && canWork && <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'edit' })}>עריכה</button>}
            {b.status === 'tentative' && canManage && <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'confirm' })}>אישור קבוצה</button>}
            {live && canManage && b.totals.remaining > 0 && <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'release' })}>שחרור יתרה</button>}
            {live && canManage && <button type="button" className="btn btn-ghost" onClick={() => setDialog({ kind: 'cancel' })}>ביטול קבוצה</button>}
            {live && canWork && b.totals.remaining > 0 && <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'pickup' })}><Plus size={16} /> רישום הזמנה</button>}
          </div>
        )}
      />
      {b.status === 'cancelled' && <Banner tone="warn">הקבוצה בוטלה{b.cancellationReason ? `: ${b.cancellationReason}` : ''}</Banner>}
      <GlassTiles label="מצב הבלוק" items={[
        { id: 'b', label: 'חדרים בבלוק', value: b.totals.blocked, icon: BedDouble },
        { id: 'p', label: 'נרשמו', value: `${b.totals.picked} (${b.pickupPct}%)`, icon: Users },
        { id: 'r', label: 'נותרו מוחזקים', value: b.totals.remaining, details: b.totals.released ? [{ label: 'שוחררו', value: b.totals.released }] : [] },
        { id: 'c', label: 'תאריך שחרור', value: b.cutoffDate ? formatShort(b.cutoffDate) : '—', icon: CalendarClock, details: b.depositAmount ? [{ label: 'מקדמה', value: money(b.depositAmount, 'ILS', 0) }] : [] },
        { id: 'v', label: 'הכנסה מהזמנות', value: money(b.revenue || 0, 'ILS', 0) },
      ]} />
      <Card flush>
        <DataTable caption="חדרים לפי סוג" rows={b.allotments.map((a) => ({ ...a, id: a.roomTypeId }))} columns={[
          { key: 't', label: 'סוג חדר', render: (a) => a.roomTypeName },
          { key: 'b', label: 'בבלוק', nowrap: true, render: (a) => <span className="ui-num">{a.blocked}</span> },
          { key: 'p', label: 'נרשמו', nowrap: true, render: (a) => <span className="ui-num">{a.picked}</span> },
          { key: 'x', label: 'שוחררו', nowrap: true, render: (a) => <span className="ui-num">{a.released}</span> },
          { key: 'r', label: 'נותרו', nowrap: true, render: (a) => <b className="ui-num">{a.remaining}</b> },
          { key: 'n', label: 'מחיר ללילה', nowrap: true, align: 'left', render: (a) => (a.negotiatedRate ? money(a.negotiatedRate) : <span className="ui-sub">לפי התעריף</span>) },
        ]} />
      </Card>
      <div className="fo-layout">
        <section className="fo-panel" aria-label="הזמנות בקבוצה">
          <h2 className="fo-panel-h">הזמנות <span className="ui-sub">{b.reservations.length || ''}</span></h2>
          <DataTable caption="הזמנות בקבוצה" rows={b.reservations} onRowClick={(r) => nav(`/pms/reservations/${r.id}`)} columns={[
            { key: 'g', label: 'אורח', render: (r) => (<div>{r.guest}<div className="ui-sub"><bdi>{r.confirmationNumber}</bdi></div></div>) },
            { key: 't', label: 'חדר', nowrap: true, render: (r) => `${r.roomType}${r.room ? ` · ${r.room}` : ''}` },
            { key: 'd', label: 'תאריכים', nowrap: true, render: (r) => <span className="ui-num">{formatShort(r.arrivalDate)} – {formatShort(r.departureDate)}</span> },
            { key: 's', label: 'מצב', nowrap: true, render: (r) => <Tag tone={['cancelled', 'no_show'].includes(r.status) ? 'bad' : undefined}>{RES_LABEL[r.status] || r.status}</Tag> },
            { key: 'm', label: 'סכום', nowrap: true, align: 'left', render: (r) => <span className="ui-num">{money(r.total, 'ILS', 0)}</span> },
          ]} empty={<Empty title="עוד לא נרשמו הזמנות">רשמו הזמנה מהבלוק או מרשימת השמות.</Empty>} />
        </section>
        <aside className="fo-panel" aria-label="רשימת שמות">
          <h2 className="fo-panel-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>רשימת שמות <span className="ui-sub">{b.roomingList.length || ''}</span></span>
            {live && canWork && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'roster' })}>הוספת שמות</button>}
          </h2>
          {!b.roomingList.length && <Empty title="אין רשימת שמות">הדביקו את הרשימה שהתקבלה מהקבוצה ורשמו הזמנה לכל שורה.</Empty>}
          <ul className="fo-lines">
            {b.roomingList.map((r) => (
              <li key={r.id} className={`fo-line ${r.reservationId ? 'is-done' : ''}`}>
                <div className="fo-line-main">
                  <div className="fo-line-t">{r.guestName}</div>
                  <div className="fo-line-meta"><span>{r.roomTypeName || '—'}</span>{r.guestPhone && <span dir="ltr">{r.guestPhone}</span>}</div>
                </div>
                {r.reservationId
                  ? <button type="button" className="fo-line-act" onClick={() => nav(`/pms/reservations/${r.reservationId}`)}>להזמנה</button>
                  : live && canWork && <button type="button" className="fo-line-act" onClick={() => setDialog({ kind: 'pickup', roster: r })}>רישום</button>}
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <BlockDialog open={dialog?.kind === 'edit'} onClose={() => setDialog(null)} propertyId={propertyId} initial={b} onSaved={() => { setDialog(null); success('הקבוצה עודכנה'); reload(); }} />
      <PickupDialog open={dialog?.kind === 'pickup'} onClose={() => setDialog(null)} propertyId={propertyId} block={b} roster={dialog?.roster} onSaved={(o) => { setDialog(null); success(`נרשמה הזמנה ${o.confirmationNumber}`); reload(); }} />
      <RosterDialog open={dialog?.kind === 'roster'} onClose={() => setDialog(null)} propertyId={propertyId} block={b} onSaved={() => { setDialog(null); success('רשימת השמות עודכנה'); reload(); }} />
      <ConfirmDialog open={dialog?.kind === 'confirm'} onClose={() => setDialog(null)} title="אישור קבוצה" confirmLabel="אישור" onConfirm={() => act('confirm')}><p className="ui-p">הקבוצה תסומן כמאושרת. החדרים כבר מוחזקים.</p></ConfirmDialog>
      <ConfirmDialog open={dialog?.kind === 'release'} onClose={() => setDialog(null)} title="שחרור יתרה למכירה" confirmLabel="שחרור" onConfirm={() => act('release')}><p className="ui-p">{b.totals.remaining} חדרים שלא נרשמו יחזרו לזמינות הכללית.</p></ConfirmDialog>
      <ConfirmDialog open={dialog?.kind === 'cancel'} onClose={() => setDialog(null)} title="ביטול קבוצה" confirmLabel="ביטול הקבוצה" danger requireReason onConfirm={(reason) => act('cancel', { reason })}><p className="ui-p">כל החדרים המוחזקים ישוחררו. קבוצה עם הזמנות פעילות לא תבוטל.</p></ConfirmDialog>
    </>
  );
}

function BlockIndex({ propertyId, url, canWork, onOpen }) {
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? groupBlocks.list(propertyId, { view: url.get('view'), q: url.get('q') || undefined }) : null), [propertyId, url.key]);
  const cols = [
    { key: 'n', label: 'קבוצה', render: (g) => (<div><button type="button" className="ui-guest-name" onClick={() => onOpen(g)}>{g.name}</button><div className="ui-sub"><bdi>{g.groupCode}</bdi>{g.company ? ` · ${g.company.name}` : ''}</div></div>) },
    { key: 'd', label: 'תאריכים', nowrap: true, render: (g) => <span className="ui-num">{formatShort(g.arrivalDate)} – {formatShort(g.departureDate)} · {g.nights} לילות</span> },
    { key: 's', label: 'מצב', nowrap: true, render: (g) => <Tag tone={TONE[g.status]}>{g.statusLabel}</Tag> },
    { key: 'b', label: 'חדרים', nowrap: true, render: (g) => <span className="ui-num">{g.totals.picked} / {g.totals.blocked} נרשמו</span> },
    { key: 'r', label: 'מוחזקים', nowrap: true, render: (g) => <span className="ui-num">{g.totals.remaining}</span> },
    { key: 'c', label: 'שחרור', nowrap: true, render: (g) => (g.cutoffDate ? <span className="ui-num">{formatShort(g.cutoffDate)}</span> : '—') },
  ];
  return (
    <>
      <PageBar title="קבוצות ובלוקים" back="/pms"
        tools={(
          <>
            <SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם קבוצה, קוד או איש קשר" id="gb-q" />
            {canWork && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> קבוצה חדשה</button>}
          </>
        )} />
      <Segmented label="סינון" value={url.get('view')} onChange={(v) => url.set({ view: v })} options={[{ value: 'upcoming', label: 'פעילות ועתידיות' }, { value: 'past', label: 'הסתיימו' }, { value: 'cancelled', label: 'בוטלו' }]} />
      <Card flush>
        <DataTable caption="קבוצות" columns={cols} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} onRowClick={onOpen} filtered={!!url.get('q')}
          empty={<Empty title="אין קבוצות בתצוגה זו">קבוצה חוסמת חדרים לאירוע, כנס או טיול, במחיר מוסכם, עד תאריך שחרור.</Empty>} />
      </Card>
      <BlockDialog open={creating} onClose={() => setCreating(false)} propertyId={propertyId} onSaved={(o) => { setCreating(false); onOpen(o); }} />
    </>
  );
}

export default function GroupBlocksPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState(DEFAULTS);
  const id = url.get('block');
  return (
    <Page wide approved>
      {id
        ? <BlockView propertyId={propertyId} id={id} role={role} />
        : <BlockIndex propertyId={propertyId} url={url} canWork={WORK.includes(role)} onOpen={(g) => url.set({ block: g.id }, { resetPage: false })} />}
    </Page>
  );
}
