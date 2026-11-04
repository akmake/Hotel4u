// Cashier shifts + currency exchange (Optima "Cashier shifts" / "Currency exch.").
// "My shift": open with a float, see what passed through the drawer, exchange currency, blind count
// at close. "Shifts": every shift in a date range (supervisors see all). "Rates": posted buy/sell
// rates per currency and the exchange log.
import { useEffect, useMemo, useState } from 'react';
import { Coins, ArrowLeftRight, Lock, Wallet } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { cashier } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, Segmented, DataTable, Empty, Modal, Field, ConfirmDialog, KeyValues, Banner, Tag,
  ErrorBanner, Spinner, GlassTiles, useUrlState, useLoader, useAction, money, formatDateTime, formatTime,
} from '../../components/kit';

const EPS = 0.005;
const SUPERVISORS = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'finance_manager'];
const WORK = [...SUPERVISORS, 'receptionist', 'cashier'];
const DEFAULTS = { tab: 'mine', from: '', to: '' };
const fx = (n, cur) => `${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

function Footer({ onClose, busy, label, why, form }) {
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ביטול</button>
      <button type="submit" form={form} className="btn btn-primary" disabled={!!why || busy} title={why || undefined}>{busy ? <Spinner /> : label}</button>
    </>
  );
}

function OpenShiftDialog({ open, onClose, propertyId, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({ openingFloat: '', note: '' });
  useEffect(() => { if (open) { setF({ openingFloat: '', note: '' }); act.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const amt = Number(f.openingFloat || 0);
  const why = f.openingFloat === '' ? 'יש להזין קרן פתיחה (0 אם אין)' : !(amt >= 0) ? 'סכום לא תקין' : null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={440} title="פתיחת משמרת קופה" subtitle="ספרו את המזומן במגירה לפני שמתחילים" footer={<Footer onClose={onClose} busy={act.busy} label="פתיחת משמרת" why={why} form="sh-open" />}>
      <form id="sh-open" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) act.run(async () => onSaved(await cashier.open(propertyId, { openingFloat: amt, note: f.note }))); }}>
        <ErrorBanner error={act.error} />
        <Field id="sh-float" label="קרן פתיחה (₪)" required error={act.fields.openingFloat}><input id="sh-float" type="number" min="0" step="0.01" inputMode="decimal" className="input w-full" value={f.openingFloat} onChange={(e) => setF((p) => ({ ...p, openingFloat: e.target.value }))} autoFocus /></Field>
        <Field id="sh-note" label="הערה" optional><input id="sh-note" className="input w-full" maxLength={300} value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field>
      </form>
    </Modal>
  );
}

function CloseShiftDialog({ open, onClose, propertyId, shift, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ counted: '', note: '', handedTo: '', foreign: {} }); act.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shift) return null;
  const counted = Number(f.counted || 0);
  const variance = f.counted === '' ? null : counted - shift.expected;
  const fVar = shift.foreign.map((x) => ({ ...x, counted: f.foreign?.[x.currency], variance: f.foreign?.[x.currency] === undefined || f.foreign?.[x.currency] === '' ? null : Number(f.foreign[x.currency]) - x.expected }));
  const anyVar = (variance !== null && Math.abs(variance) > EPS) || fVar.some((x) => x.variance !== null && Math.abs(x.variance) > EPS);
  const why = f.counted === '' ? 'יש להזין את סכום השקלים שנספר' : fVar.some((x) => x.variance === null) ? 'יש לספור גם את המט״ח' : anyVar && (f.note || '').trim().length < 3 ? 'יש הפרש — נדרש הסבר' : null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={520} title={`סגירת משמרת ${shift.number}`} subtitle="ספירה עיוורת: ספרו את המגירה ורשמו מה יש בפועל" footer={<Footer onClose={onClose} busy={act.busy} label="סגירת משמרת" why={why} form="sh-close" />}>
      <form id="sh-close" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) act.run(async () => onSaved(await cashier.close(propertyId, shift.id, { counted, note: f.note, handedTo: f.handedTo, foreign: Object.fromEntries(Object.entries(f.foreign || {}).map(([k, v]) => [k, Number(v)])) }))); }}>
        <ErrorBanner error={act.error} />
        <Field id="sc-ils" label="שקלים במגירה (₪)" required error={act.fields.counted}><input id="sc-ils" type="number" min="0" step="0.01" inputMode="decimal" className="input w-full" value={f.counted} onChange={(e) => setF((p) => ({ ...p, counted: e.target.value }))} autoFocus /></Field>
        {shift.foreign.map((x) => (
          <Field key={x.currency} id={`sc-${x.currency}`} label={`${x.currency} במגירה`} required>
            <input id={`sc-${x.currency}`} type="number" min="0" step="0.01" inputMode="decimal" className="input w-full" value={f.foreign?.[x.currency] ?? ''} onChange={(e) => setF((p) => ({ ...p, foreign: { ...p.foreign, [x.currency]: e.target.value } }))} />
          </Field>
        ))}
        {variance !== null && (
          <KeyValues rows={[['צפוי', money(shift.expected)], ['נספר', money(counted)], ['הפרש', <b key="v" className={Math.abs(variance) > EPS ? 'is-due' : ''}>{variance > 0 ? '+' : ''}{money(variance)}</b>],
            ...fVar.filter((x) => x.variance !== null).map((x) => [`הפרש ${x.currency}`, `${x.variance > 0 ? '+' : ''}${fx(x.variance, x.currency)}`])]} />
        )}
        <Field id="sc-note" label="הערה / הסבר להפרש" optional={!anyVar} required={anyVar} error={act.fields.note}><input id="sc-note" className="input w-full" maxLength={300} value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field>
        <Field id="sc-to" label="המגירה נמסרה ל־" optional><input id="sc-to" className="input w-full" maxLength={80} value={f.handedTo} onChange={(e) => setF((p) => ({ ...p, handedTo: e.target.value }))} /></Field>
      </form>
    </Modal>
  );
}

function ExchangeDialog({ open, onClose, propertyId, rates, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const active = rates.filter((r) => r.active);
  useEffect(() => { if (open) { setF({ direction: 'buy', currency: active[0]?.currency || '', foreignAmount: '', guestName: '', roomNumber: '', docLast4: '' }); act.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const rate = active.find((r) => r.currency === f.currency);
  const applied = rate ? (f.direction === 'buy' ? rate.buy : rate.sell) : 0;
  const amt = Number(f.foreignAmount || 0);
  const ils = Math.round(amt * applied * 100) / 100;
  const why = !rate ? 'אין שער למטבע' : !(amt > 0) ? 'נדרש סכום' : (f.guestName || '').trim().length < 2 ? 'נדרש שם הלקוח' : null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={520} title="המרת מט״ח" subtitle="המזומן נכנס ויוצא מהמגירה של המשמרת שלכם" footer={<Footer onClose={onClose} busy={act.busy} label="ביצוע המרה" why={why} form="fx-form" />}>
      <form id="fx-form" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) act.run(async () => onSaved(await cashier.exchange(propertyId, { ...f, foreignAmount: amt }))); }}>
        <ErrorBanner error={act.error} />
        {!active.length && <Banner tone="warn">אין שערים פעילים. מנהל מעדכן שערים בלשונית "מט״ח ושערים".</Banner>}
        <Segmented label="כיוון" value={f.direction} onChange={(v) => setF((p) => ({ ...p, direction: v }))} options={[{ value: 'buy', label: 'הלקוח מוכר מט״ח (מקבל ₪)' }, { value: 'sell', label: 'הלקוח קונה מט״ח (משלם ₪)' }]} />
        <div className="ui-grid-2">
          <Field id="fx-cur" label="מטבע" required error={act.fields.currency}>
            <select id="fx-cur" className="select w-full" value={f.currency} onChange={set('currency')}>{active.map((r) => <option key={r.currency} value={r.currency}>{r.currency} — {r.name}</option>)}</select>
          </Field>
          <Field id="fx-amt" label={`סכום ב־${f.currency || 'מט״ח'}`} required error={act.fields.foreignAmount}><input id="fx-amt" type="number" min="0.01" step="0.01" inputMode="decimal" className="input w-full" value={f.foreignAmount} onChange={set('foreignAmount')} /></Field>
          <Field id="fx-name" label="שם הלקוח" required error={act.fields.guestName}><input id="fx-name" className="input w-full" maxLength={120} value={f.guestName} onChange={set('guestName')} /></Field>
          <Field id="fx-room" label="חדר" optional><input id="fx-room" className="input w-full" maxLength={10} value={f.roomNumber} onChange={set('roomNumber')} /></Field>
          <Field id="fx-doc" label="4 ספרות אחרונות של הדרכון" optional hint="לעולם לא המספר המלא"><input id="fx-doc" inputMode="numeric" maxLength={4} className="input w-full" value={f.docLast4} onChange={set('docLast4')} /></Field>
        </div>
        {rate && amt > 0 && <KeyValues rows={[['שער', `${applied} ₪ ל־1 ${f.currency}`], [f.direction === 'buy' ? 'לשלם ללקוח' : 'לגבות מהלקוח', <b key="i">{money(ils)}</b>]]} />}
      </form>
    </Modal>
  );
}

function RateDialog({ open, onClose, propertyId, currencies, initial, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ currency: initial?.currency || 'USD', buy: initial?.buy ?? '', sell: initial?.sell ?? '', active: initial?.active ?? true }); act.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const why = !(Number(f.buy) > 0) || !(Number(f.sell) > 0) ? 'נדרשים שני השערים' : Number(f.buy) > Number(f.sell) ? 'שער קנייה גבוה ממכירה' : null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={440} title={initial ? `שער ${initial.currency}` : 'שער חדש'} footer={<Footer onClose={onClose} busy={act.busy} label="שמירה" why={why} form="rate-form" />}>
      <form id="rate-form" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) act.run(async () => onSaved(await cashier.setRate(propertyId, f.currency, { buy: Number(f.buy), sell: Number(f.sell), active: f.active }))); }}>
        <ErrorBanner error={act.error} />
        {!initial && (
          <Field id="rt-cur" label="מטבע" required><select id="rt-cur" className="select w-full" value={f.currency} onChange={set('currency')}>{Object.entries(currencies || {}).map(([k, n]) => <option key={k} value={k}>{k} — {n}</option>)}</select></Field>
        )}
        <div className="ui-grid-2">
          <Field id="rt-buy" label="קנייה (המלון משלם ₪)" required error={act.fields.buy}><input id="rt-buy" type="number" min="0" step="0.0001" className="input w-full" value={f.buy} onChange={set('buy')} /></Field>
          <Field id="rt-sell" label="מכירה (המלון גובה ₪)" required error={act.fields.sell}><input id="rt-sell" type="number" min="0" step="0.0001" className="input w-full" value={f.sell} onChange={set('sell')} /></Field>
        </div>
        <label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} /><span>פעיל להמרה</span></label>
      </form>
    </Modal>
  );
}

function MyShift({ propertyId, data, reload, rates, role, success }) {
  const [dialog, setDialog] = useState(null);
  const s = data.current;
  const canWork = WORK.includes(role);
  if (!s) {
    return (
      <Card>
        <Empty title="אין לך משמרת קופה פתוחה">פותחים משמרת עם קרן הפתיחה שבמגירה. כל תשלום במזומן שתרשמו וכל המרת מט״ח נספרים בה עד הסגירה.</Empty>
        {canWork && <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 16 }}><button type="button" className="btn btn-primary" onClick={() => setDialog('open')}><Wallet size={16} /> פתיחת משמרת</button></div>}
        <OpenShiftDialog open={dialog === 'open'} onClose={() => setDialog(null)} propertyId={propertyId} onSaved={() => { setDialog(null); success('המשמרת נפתחה'); reload(); }} />
      </Card>
    );
  }
  const m = s.movement || {};
  const tiles = [
    { id: 'float', label: 'קרן פתיחה', value: money(s.openingFloat, 'ILS', 0), icon: Wallet },
    { id: 'in', label: 'מזומן שהתקבל', value: money(m.cashIn, 'ILS', 0), details: [{ label: 'תקבולים', value: m.receipts }] },
    { id: 'out', label: 'החזרים ומט״ח ששולם', value: money((m.cashOut || 0) + (m.exchangeOut || 0), 'ILS', 0), icon: ArrowLeftRight },
    { id: 'exp', label: 'צפוי במגירה', value: money(s.expected, 'ILS', 0), icon: Coins, details: s.foreign.map((x) => ({ label: x.currency, value: Number(x.expected).toFixed(2) })) },
  ];
  const rows = [
    ...s.cash.map((c, i) => ({ id: `c${i}`, at: c.at, kind: c.type === 'refund' ? 'החזר במזומן' : 'תקבול במזומן', what: c.description, ils: c.amount })),
    ...s.exchanges.map((x) => ({ id: x.id, at: x.at, kind: x.direction === 'buy' ? `קניית ${x.currency}` : `מכירת ${x.currency}`, what: `${x.number} · ${x.guestName || ''}${x.roomNumber ? ` · חדר ${x.roomNumber}` : ''} · ${fx(x.foreignAmount, x.currency)} × ${x.rate}`, ils: x.status === 'voided' ? 0 : x.direction === 'buy' ? -x.ilsAmount : x.ilsAmount, voided: x.status === 'voided', x })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  return (
    <>
      <div className="ui-row" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div><b>משמרת {s.number}</b> <span className="ui-sub">נפתחה {formatDateTime(s.openedAt)}{s.openNote ? ` · ${s.openNote}` : ''}</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog('fx')}><ArrowLeftRight size={16} /> המרת מט״ח</button>
          <button type="button" className="btn btn-primary" onClick={() => setDialog('close')}><Lock size={16} /> סגירת משמרת</button>
        </div>
      </div>
      <GlassTiles items={tiles} label="מצב המגירה" />
      <Card flush>
        <DataTable caption="תנועות מזומן במשמרת" rows={rows} columns={[
          { key: 'at', label: 'שעה', nowrap: true, render: (r) => <span className="ui-num">{formatTime(r.at)}</span> },
          { key: 'kind', label: 'פעולה', nowrap: true, render: (r) => <>{r.kind}{r.voided && <> <Tag tone="bad">בוטל</Tag></>}</> },
          { key: 'what', label: 'פרטים', render: (r) => r.what },
          { key: 'ils', label: '₪ במגירה', align: 'left', nowrap: true, render: (r) => <span className={`ui-num ${r.ils < 0 ? 'is-due' : ''}`}>{r.ils > 0 ? '+' : ''}{money(r.ils)}</span> },
          { key: 'act', label: 'פעולה', srOnly: true, nowrap: true, render: (r) => (r.x && !r.voided && SUPERVISORS.includes(role) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ void: r.x })}>ביטול</button> : null) },
        ]} empty={<Empty title="עוד אין תנועות במשמרת" />} />
      </Card>
      <CloseShiftDialog open={dialog === 'close'} onClose={() => setDialog(null)} propertyId={propertyId} shift={s} onSaved={(o) => { setDialog(null); success(Math.abs(o.variance || 0) > EPS ? `המשמרת נסגרה עם הפרש ${money(o.variance)}` : 'המשמרת נסגרה — מאוזנת'); reload(); }} />
      <ExchangeDialog open={dialog === 'fx'} onClose={() => setDialog(null)} propertyId={propertyId} rates={rates} onSaved={(o) => { setDialog(null); success(`המרה ${o.number} בוצעה · ${money(o.ilsAmount)}`); reload(); }} />
      <ConfirmDialog open={!!dialog?.void} onClose={() => setDialog(null)} title="ביטול המרה" subtitle={dialog?.void ? `${dialog.void.number} · ${fx(dialog.void.foreignAmount, dialog.void.currency)}` : ''} confirmLabel="ביטול ההמרה" danger requireReason
        onConfirm={async (reason) => { await cashier.voidExchange(propertyId, dialog.void.id, reason); setDialog(null); success('ההמרה בוטלה'); reload(); }}>
        <p className="ui-p">ההמרה נשארת ביומן כמבוטלת, והמגירה מחושבת בלעדיה.</p>
      </ConfirmDialog>
    </>
  );
}

function ShiftList({ data, url }) {
  const cols = [
    { key: 'n', label: 'משמרת', nowrap: true, render: (s) => <bdi className="ui-num">{s.number}</bdi> },
    { key: 'u', label: 'קופאי', render: (s) => s.userName },
    { key: 'o', label: 'נפתחה', nowrap: true, render: (s) => <span className="ui-num">{formatDateTime(s.openedAt)}</span> },
    { key: 'c', label: 'נסגרה', nowrap: true, render: (s) => (s.closedAt ? <span className="ui-num">{formatDateTime(s.closedAt)}</span> : <Tag tone="ok">פתוחה</Tag>) },
    { key: 'f', label: 'קרן', nowrap: true, render: (s) => <span className="ui-num">{money(s.openingFloat, 'ILS', 0)}</span> },
    { key: 'e', label: 'צפוי', nowrap: true, render: (s) => <span className="ui-num">{s.expected != null ? money(s.expected) : '—'}</span> },
    { key: 'k', label: 'נספר', nowrap: true, render: (s) => <span className="ui-num">{s.counted != null ? money(s.counted) : '—'}</span> },
    { key: 'v', label: 'הפרש', nowrap: true, align: 'left', render: (s) => (s.variance == null ? '—' : <span className={`ui-num ${Math.abs(s.variance) > EPS ? 'is-due' : ''}`}>{s.variance > 0 ? '+' : ''}{money(s.variance)}</span>) },
    { key: 'x', label: 'הערה', render: (s) => [s.foreign?.filter((x) => Math.abs(x.variance || 0) > EPS).map((x) => `${x.currency} ${x.variance > 0 ? '+' : ''}${x.variance}`).join(' · '), s.note, s.handedTo ? `נמסרה ל־${s.handedTo}` : null].filter(Boolean).join(' · ') || '—' },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="ui-sub" htmlFor="sh-from">מתאריך</label>
        <input id="sh-from" type="date" className="input" value={url.get('from') || data.from} onChange={(e) => url.set({ from: e.target.value })} />
        <label className="ui-sub" htmlFor="sh-to">עד</label>
        <input id="sh-to" type="date" className="input" value={url.get('to') || data.to} onChange={(e) => url.set({ to: e.target.value })} />
        {!data.supervisor && <span className="ui-sub">מוצגות המשמרות שלך בלבד</span>}
      </div>
      <Card flush><DataTable caption="משמרות קופה" columns={cols} rows={data.rows} empty={<Empty title="אין משמרות בטווח" />} /></Card>
    </>
  );
}

function RatesTab({ propertyId, role, success }) {
  const [dialog, setDialog] = useState(null);
  const rates = useLoader(async () => (propertyId ? cashier.rates(propertyId) : null), [propertyId]);
  const log = useLoader(async () => (propertyId ? cashier.exchanges(propertyId, {}) : null), [propertyId]);
  const canSet = SUPERVISORS.includes(role);
  return (
    <>
      <Card flush>
        <DataTable caption="שערי מט״ח" rows={(rates.data?.rates || []).map((r) => ({ ...r, id: r.currency }))} loading={rates.loading && !rates.data} error={rates.error} onRetry={rates.reload}
          columns={[
            { key: 'c', label: 'מטבע', nowrap: true, render: (r) => <><b>{r.currency}</b> <span className="ui-sub">{r.name}</span></> },
            { key: 'b', label: 'קנייה', nowrap: true, render: (r) => <span className="ui-num">{r.buy} ₪</span> },
            { key: 's', label: 'מכירה', nowrap: true, render: (r) => <span className="ui-num">{r.sell} ₪</span> },
            { key: 'a', label: 'מצב', nowrap: true, render: (r) => (r.active ? <Tag tone="ok">פעיל</Tag> : <Tag>מושבת</Tag>) },
            { key: 'u', label: 'עודכן', render: (r) => <span className="ui-sub">{formatDateTime(r.updatedAt)}{r.updatedBy ? ` · ${r.updatedBy}` : ''}</span> },
            { key: 'e', label: 'עריכה', srOnly: true, render: (r) => (canSet ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ rate: r })}>עדכון</button> : null) },
          ]}
          empty={<Empty title="עוד לא הוגדרו שערים">{canSet ? 'הוסיפו מטבע ושערי קנייה ומכירה.' : 'מנהל מגדיר את השערים.'}</Empty>} />
      </Card>
      {canSet && <div><button type="button" className="btn btn-secondary" onClick={() => setDialog({ rate: null })}>הוספת מטבע</button></div>}
      <h2 className="fo-panel-h">המרות היום</h2>
      {log.data?.totals?.length > 0 && <KeyValues rows={log.data.totals.map((t) => [t.currency, `נקנו ${fx(t.bought, t.currency)} (שולמו ${money(t.ilsOut)}) · נמכרו ${fx(t.sold, t.currency)} (התקבלו ${money(t.ilsIn)})`])} />}
      <Card flush>
        <DataTable caption="יומן המרות" rows={log.data?.rows} loading={log.loading && !log.data} error={log.error} onRetry={log.reload}
          columns={[
            { key: 'n', label: 'מספר', nowrap: true, render: (x) => <bdi className="ui-num">{x.number}</bdi> },
            { key: 't', label: 'שעה', nowrap: true, render: (x) => <span className="ui-num">{formatTime(x.at)}</span> },
            { key: 'd', label: 'פעולה', nowrap: true, render: (x) => <>{x.direction === 'buy' ? 'קנייה' : 'מכירה'} {x.currency}{x.status === 'voided' && <> <Tag tone="bad">בוטל</Tag></>}</> },
            { key: 'a', label: 'סכום', nowrap: true, render: (x) => <span className="ui-num">{fx(x.foreignAmount, x.currency)} × {x.rate}</span> },
            { key: 'i', label: '₪', nowrap: true, render: (x) => <span className="ui-num">{money(x.ilsAmount)}</span> },
            { key: 'g', label: 'לקוח', render: (x) => `${x.guestName || '—'}${x.roomNumber ? ` · חדר ${x.roomNumber}` : ''}` },
            { key: 'u', label: 'קופאי', render: (x) => x.userName },
          ]}
          empty={<Empty title="אין המרות היום" />} />
      </Card>
      <RateDialog open={!!dialog} onClose={() => setDialog(null)} propertyId={propertyId} currencies={rates.data?.currencies} initial={dialog?.rate} onSaved={() => { setDialog(null); success('השער נשמר'); rates.reload(); }} />
    </>
  );
}

export default function CashierPage({ initialTab }) {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState({ ...DEFAULTS, tab: initialTab || DEFAULTS.tab });
  const { toasts, success } = useToast();
  const tab = url.get('tab');
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? cashier.shifts(propertyId, { from: url.get('from') || undefined, to: url.get('to') || undefined }) : null), [propertyId, url.key]);
  const rates = useLoader(async () => (propertyId ? cashier.rates(propertyId) : null), [propertyId, tab]);
  const meta = useMemo(() => (data?.current ? `משמרת ${data.current.number} פתוחה · צפוי ${money(data.current.expected, 'ILS', 0)}` : 'אין משמרת פתוחה'), [data]);
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="קופה ומט״ח" meta={data ? meta : undefined} back="/pms" />
      <Segmented label="לשוניות" value={tab} onChange={(v) => url.set({ tab: v })} options={[{ value: 'mine', label: 'המשמרת שלי' }, { value: 'shifts', label: 'משמרות קופה' }, { value: 'fx', label: 'מט״ח ושערים' }]} />
      {tab !== 'fx' && loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {tab !== 'fx' && error && <ErrorBanner error={error} onRetry={reload} />}
      {tab === 'mine' && data && <MyShift propertyId={propertyId} data={data} reload={reload} rates={rates.data?.rates || []} role={role} success={success} />}
      {tab === 'shifts' && data && <ShiftList data={data} url={url} />}
      {tab === 'fx' && <RatesTab propertyId={propertyId} role={role} success={success} />}
    </Page>
  );
}
