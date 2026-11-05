// Travel-agent commissions (gap-map item 10): records per departure with holds and manual changes,
// payment (cheque / transfer) with a pre-payment review, the payments list with each cheque's life, reports.
import { useEffect, useState } from 'react';
import { Play, Plus, Printer } from 'lucide-react';
import '../ops/EventsPage.css';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { commissions } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, DataTable, Empty, Modal, Field, Tag, Pill, ErrorBanner, Spinner, Segmented, Banner,
  useLoader, useAction, useUrlState, money, formatDateTime,
} from '../../components/kit';

const MANAGE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager', 'sales_manager'];
const HOLDS = { review: 'לבירור', until_paid: 'עד שהחייב ישלם', offset: 'כבר קוזזה' };
const STATUS = { ready: ['ok', 'מוכנה'], held: ['warn', 'מושהית'], paid: ['muted', 'שולמה'], cancelled: ['bad', 'בוטלה'] };
const PAYSTAT = { issued: ['warn', 'יצא'], cleared: ['ok', 'נפרע'], not_presented: ['bad', 'לא הוצג לבנק'], voided: ['muted', 'בוטל'] };
const METHOD = { cheque: 'שיק', transfer: 'העברה', file: 'קובץ' };
const ymd = (d) => d.toISOString().slice(0, 10);
const monthAgo = () => ymd(new Date(Date.now() - 30 * 86400000));

function RecordDialog({ open, onClose, propertyId, rec, canManage, onDone }) {
  const act = useAction();
  const [amount, setAmount] = useState(''); const [note, setNote] = useState(''); const [kind, setKind] = useState('review'); const [reason, setReason] = useState('');
  useEffect(() => { if (open && rec) { act.reset(); setAmount(rec.amount); setNote(''); setKind(rec.hold?.kind || 'review'); setReason(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rec) return null;
  const open_ = ['ready', 'held'].includes(rec.status);
  const run = (fn, msg) => act.run(async () => { await fn(); onDone(msg); });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={560} title={`עמלה · ${rec.guestName || rec.confirmationNumber}`} subtitle={`${rec.agentName} · הזמנה ${rec.confirmationNumber} · עזיבה ${formatShort(rec.departureDate)}`}
      footer={<button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>סגירה</button>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <div className="ui-sub">בסיס {money(rec.base)} × {rec.pct}% ({{ plan: 'לפי התעריף', agent: 'לפי הסוכן', reservation: 'לפי ההזמנה', manual: 'ידנית' }[rec.source]}) = {money(rec.calculated)}{rec.edited ? ` · שונתה ידנית מ־${money(rec.edited.from)} (${rec.edited.by}: ${rec.edited.note})` : ''}</div>
        <div><Pill tone={STATUS[rec.status][0]}>{STATUS[rec.status][1]}</Pill> {rec.hold ? <Tag>{rec.hold.label}{rec.hold.note ? ` · ${rec.hold.note}` : ''}</Tag> : null}</div>
        {canManage && open_ && (
          <>
            <fieldset className="ui-fieldset"><legend className="ui-label">שינוי ידני של הסכום</legend>
              <div className="ui-grid-2">
                <Field id="cm-amt" label="סכום (₪)" error={act.fields.amount}><input id="cm-amt" type="number" min="0" step="0.01" className="input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field id="cm-note" label="הערה (חובה)" error={act.fields.note}><input id="cm-note" className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy} onClick={() => run(() => commissions.edit(propertyId, rec.id, { amount: Number(amount), note }), 'הסכום עודכן')}>שמירת שינוי</button>
            </fieldset>
            <fieldset className="ui-fieldset"><legend className="ui-label">השהיה</legend>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                <Field id="cm-kind" label="סוג"><select id="cm-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(HOLDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy} onClick={() => run(() => commissions.hold(propertyId, { id: rec.id, kind, note }), 'העמלה הושהתה')}>השהיה</button>
                {rec.status === 'held' && <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy} onClick={() => run(() => commissions.release(propertyId, { id: rec.id }), 'העמלה שוחררה')}>שחרור לתשלום</button>}
              </div>
            </fieldset>
            <fieldset className="ui-fieldset"><legend className="ui-label">ניתוק ההזמנה מהסוכן</legend>
              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                <Field id="cm-rsn" label="סיבה (חובה)" error={act.fields.reason}><input id="cm-rsn" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy} onClick={() => run(() => commissions.detach(propertyId, { reservation: rec.reservation, reason }), 'ההזמנה נותקה מהסוכן')}>ניתוק</button>
              </div>
            </fieldset>
          </>
        )}
        {rec.history.length > 0 && <div className="ui-sub">{rec.history.map((h, i) => <div key={i}>{formatDateTime(h.at)} · {h.by} · {h.action}{h.note ? ` — ${h.note}` : ''}</div>)}</div>}
      </div>
    </Modal>
  );
}

function ManualDialog({ open, onClose, propertyId, agents, onDone }) {
  const act = useAction();
  const [f, setF] = useState({ reservation: '', agent: '', amount: '', note: '' });
  useEffect(() => { if (open) { act.reset(); setF({ reservation: '', agent: '', amount: '', note: '' }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={480} title="רשומת עמלה ידנית" subtitle="להזמנה ששכחו לחבר אליה סוכן. נכנסת מושהית עד בדיקה"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy} onClick={() => act.run(async () => { await commissions.manual(propertyId, { ...f, amount: Number(f.amount) }); onDone('הרשומה נוספה והושהתה לבירור'); })}>{act.busy ? <Spinner /> : 'הוספה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <Field id="mn-res" label="מספר אישור הזמנה" required error={act.fields.reservation}><input id="mn-res" dir="ltr" className="input w-full" value={f.reservation} onChange={set('reservation')} /></Field>
        <Field id="mn-ag" label="סוכן" required error={act.fields.agent}><select id="mn-ag" className="input w-full" value={f.agent} onChange={set('agent')}><option value="">בחרו…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <div className="ui-grid-2">
          <Field id="mn-amt" label="סכום (₪)" required error={act.fields.amount}><input id="mn-amt" type="number" min="0" step="0.01" className="input w-full" value={f.amount} onChange={set('amount')} /></Field>
          <Field id="mn-note" label="הערה" required error={act.fields.note}><input id="mn-note" className="input w-full" value={f.note} onChange={set('note')} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function RecordsTab({ propertyId, canManage, notify }) {
  const [status, setStatus] = useState('open');
  const [agent, setAgent] = useState('');
  const [q, setQ] = useState('');
  const [dlg, setDlg] = useState(null);
  const [manual, setManual] = useState(false);
  const act = useAction();
  const agents = useLoader(async () => (propertyId ? commissions.agents(propertyId) : []), [propertyId]);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? commissions.list(propertyId, { status, agent, q }) : null), [propertyId, status, agent, q]);
  const cols = [
    { key: 'g', label: 'אורח / הזמנה', render: (r) => <><b>{r.guestName || '—'}</b> <span className="ui-sub" dir="ltr">{r.confirmationNumber}</span></> },
    { key: 'a', label: 'סוכן', nowrap: true, render: (r) => r.agentName },
    { key: 'd', label: 'עזיבה', nowrap: true, render: (r) => <span className="ui-num">{formatShort(r.departureDate)}</span> },
    { key: 'b', label: 'בסיס', nowrap: true, render: (r) => <span className="ui-num">{money(r.base)}</span> },
    { key: 'p', label: '%', nowrap: true, render: (r) => <span className="ui-num">{r.pct}%</span> },
    { key: 'm', label: 'עמלה', nowrap: true, render: (r) => <span className="ui-num"><b>{money(r.amount)}</b>{r.edited ? ' ✎' : ''}</span> },
    { key: 's', label: 'מצב', nowrap: true, render: (r) => <><Pill tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Pill>{r.hold ? <> <Tag>{r.hold.label}</Tag></> : null}{r.manual ? <> <Tag>ידנית</Tag></> : null}</> },
  ];
  const t = data?.totals;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Segmented label="סינון" value={status} onChange={setStatus} options={[{ value: 'open', label: 'פתוחות', count: t ? t.ready.n + t.held.n : undefined }, { value: 'ready', label: 'מוכנות לתשלום', count: t?.ready.n }, { value: 'held', label: 'מושהות', count: t?.held.n }, { value: 'paid', label: 'שולמו' }, { value: 'cancelled', label: 'בוטלו' }]} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="סוכן" className="input" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">כל הסוכנים</option>{(agents.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input aria-label="חיפוש" className="input" placeholder="אורח או מספר הזמנה" value={q} onChange={(e) => setQ(e.target.value)} />
          {canManage && <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy} onClick={() => act.run(async () => { const r = await commissions.process(propertyId, {}); notify(`עובדו עזיבות: ${r.created} רשומות חדשות${r.released ? `, ${r.released} שוחררו` : ''}`); reload(); })}><Play size={14} /> עיבוד עזיבות</button>}
          {canManage && <button type="button" className="btn btn-primary btn-sm" onClick={() => setManual(true)}><Plus size={14} /> רשומה ידנית</button>}
        </div>
      </div>
      <ErrorBanner error={act.error} />
      {t && <div className="ui-sub">מוכנות {money(t.ready.total)} ({t.ready.n}) · מושהות {money(t.held.total)} ({t.held.n}){data.heldByKind.length ? ` — ${data.heldByKind.map((h) => `${h.label} ${money(h.total)}`).join(' · ')}` : ''} · שולמו {money(t.paid.total)}</div>}
      <Card flush>
        <DataTable caption="עמלות סוכנים" columns={cols} rows={data?.rows || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={(r) => setDlg(r)}
          empty={<Empty title="אין עמלות">עמלה נוצרת בעזיבה של הזמנה מחוברת לסוכן, בתעריף שמזכה בעמלה. "עיבוד עזיבות" יוצר את מה שנוצר מאז העיבוד האחרון.</Empty>} />
      </Card>
      <RecordDialog open={!!dlg} onClose={() => setDlg(null)} propertyId={propertyId} rec={dlg} canManage={canManage} onDone={(m) => { setDlg(null); notify(m); reload(); }} />
      <ManualDialog open={manual} onClose={() => setManual(false)} propertyId={propertyId} agents={agents.data || []} onDone={(m) => { setManual(false); notify(m); reload(); }} />
    </>
  );
}

function PayDialog({ open, onClose, propertyId, range, onDone }) {
  const act = useAction();
  const [method, setMethod] = useState('cheque'); const [start, setStart] = useState(''); const [ref, setRef] = useState('');
  useEffect(() => { if (open) { act.reset(); setMethod('cheque'); setStart(''); setRef(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={460} title="הפקת תשלום עמלות" subtitle={`עזיבות ${formatShort(range.from)} – ${formatShort(range.to)} · רק עמלות מוכנות; המושהות לא נכללות`}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy} onClick={() => act.run(async () => onDone(await commissions.pay(propertyId, { ...range, method, startNumber: method === 'cheque' ? Number(start) : undefined, reference: ref || undefined })))}>{act.busy ? <Spinner /> : 'הפקה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <Segmented label="אמצעי" value={method} onChange={setMethod} options={[{ value: 'cheque', label: 'שיקים' }, { value: 'transfer', label: 'העברה' }]} />
        {method === 'cheque' ? <Field id="py-n" label="מספר שיק התחלתי" required error={act.fields.startNumber} hint="שיק לכל סוכן, במספרים עוקבים"><input id="py-n" type="number" min="1" className="input w-full" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          : <Field id="py-r" label="אסמכתת העברה"><input id="py-r" dir="ltr" className="input w-full" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

function PayTab({ propertyId, canManage, notify, goPayments }) {
  const [range, setRange] = useState({ from: monthAgo(), to: ymd(new Date()) });
  const [dlg, setDlg] = useState(false);
  const { data, loading, error, reload } = useLoader(async () => (propertyId && range.to >= range.from ? commissions.prePayment(propertyId, range) : null), [propertyId, range.from, range.to]);
  const cols = [
    { key: 'a', label: 'סוכן', render: (r) => <b>{r.agentName}</b> },
    { key: 'p', label: 'לתשלום', nowrap: true, render: (r) => <span className="ui-num">{money(r.payable)} <span className="ui-sub">({r.payableCount})</span></span> },
    { key: 'h', label: 'מושהות (לא ישולמו)', nowrap: true, render: (r) => <span className="ui-num">{money(r.held)} <span className="ui-sub">({r.heldCount})</span></span> },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="ui-sub">עזיבות מ־ <input type="date" className="input" value={range.from} onChange={(e) => setRange((p) => ({ ...p, from: e.target.value }))} /></label>
          <label className="ui-sub">עד <input type="date" className="input" value={range.to} onChange={(e) => setRange((p) => ({ ...p, to: e.target.value }))} /></label>
        </div>
        {canManage && <button type="button" className="btn btn-primary btn-sm" disabled={!data || !(data.payable > 0)} onClick={() => setDlg(true)}>הפקת תשלום ({data ? money(data.payable) : '…'})</button>}
      </div>
      <Banner tone="info">דוח לפני תשלום: כולל גם מושהות, כדי לבדוק אותן לפני שיוצא שיק. רק עמלות מוכנות נכנסות לתשלום.</Banner>
      <Card flush>
        <DataTable caption="דוח לפני תשלום" columns={cols} rows={(data?.agents || []).map((a) => ({ ...a, id: a.agent }))} loading={loading && !data} error={error} onRetry={reload} empty={<Empty title="אין עמלות פתוחות בטווח" />} />
      </Card>
      <PayDialog open={dlg} onClose={() => setDlg(false)} propertyId={propertyId} range={range} onDone={(r) => { setDlg(false); notify(`הופקו ${r.payments.length} תשלומים בסך ${money(r.total)}`); reload(); goPayments(); }} />
    </>
  );
}

function PaymentDialog({ open, onClose, propertyId, id, canManage, onDone }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const { data, reload } = useLoader(async () => (open && id ? commissions.payment(propertyId, id) : null), [open, id, propertyId]);
  useEffect(() => { if (open) { act.reset(); setNote(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (status) => act.run(async () => { await commissions.setPaymentStatus(propertyId, id, { status, note }); setNote(''); onDone(); reload(); });
  const print = () => act.run(async () => { await commissions.printPayment(propertyId, id); window.print(); reload(); });
  const next = { issued: ['cleared', 'not_presented', 'voided'], cleared: ['issued'], not_presented: ['issued', 'voided'], voided: [] };
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={640} title={data ? `${METHOD[data.method]} ${data.number} · ${data.agentName}` : 'תשלום'} subtitle={data ? `${money(data.amount)} · ${data.count} הזמנות · עזיבות ${formatShort(data.from)} – ${formatShort(data.to)}` : ''}
      footer={<><button type="button" className="btn btn-secondary" onClick={print} disabled={act.busy || !data}><Printer size={14} /> הדפסה</button><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>סגירה</button></>}>
      {!data ? <Spinner /> : (
        <div className="ui-stack">
          <ErrorBanner error={act.error} />
          <div><Pill tone={PAYSTAT[data.status][0]}>{PAYSTAT[data.status][1]}</Pill> {data.printedAt ? <span className="ui-sub">הודפס {formatDateTime(data.printedAt)}</span> : null}</div>
          {canManage && next[data.status].length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <Field id="ps-note" label="הערה / סיבה (חובה בביטול)" error={act.fields.note}><input id="ps-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              {next[data.status].map((s) => <button key={s} type="button" className="btn btn-secondary btn-sm" disabled={act.busy} onClick={() => go(s)}>{{ cleared: 'נפרע', issued: 'חזרה ליצא', not_presented: 'לא הוצג לבנק', voided: 'ביטול התשלום' }[s]}</button>)}
            </div>
          )}
          {data.status === 'voided' && <Banner tone="info">התשלום בוטל — העמלות חזרו לעיבוד. אי אפשר לבטל ביטול.</Banner>}
          <table className="ui-table"><thead><tr><th>אורח</th><th>הזמנה</th><th>עזיבה</th><th>עמלה</th></tr></thead>
            <tbody>{data.records.map((r) => <tr key={r.id}><td>{r.guestName}</td><td dir="ltr">{r.confirmationNumber}</td><td>{formatShort(r.departureDate)}</td><td className="ui-num">{money(r.amount)}</td></tr>)}</tbody></table>
          <div className="ui-sub">{data.history.map((h, i) => <div key={i}>{formatDateTime(h.at)} · {h.by} · {h.action}{h.note ? ` — ${h.note}` : ''}</div>)}</div>
        </div>
      )}
    </Modal>
  );
}

function PaymentsTab({ propertyId, canManage, notify }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? commissions.payments(propertyId, { status, q }) : null), [propertyId, status, q]);
  const cols = [
    { key: 'n', label: 'מספר', nowrap: true, render: (p) => <b dir="ltr">{p.number}</b> },
    { key: 'm', label: 'אמצעי', nowrap: true, render: (p) => METHOD[p.method] },
    { key: 'a', label: 'סוכן', render: (p) => p.agentName },
    { key: 'c', label: 'סכום', nowrap: true, render: (p) => <span className="ui-num"><b>{money(p.amount)}</b> <span className="ui-sub">({p.count})</span></span> },
    { key: 'r', label: 'עזיבות', nowrap: true, render: (p) => <span className="ui-sub">{formatShort(p.from)} – {formatShort(p.to)}</span> },
    { key: 's', label: 'מצב', nowrap: true, render: (p) => <Pill tone={PAYSTAT[p.status][0]}>{PAYSTAT[p.status][1]}</Pill> },
    { key: 'd', label: 'הופק', nowrap: true, render: (p) => <span className="ui-sub">{formatDateTime(p.createdAt)}</span> },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Segmented label="מצב" value={status} onChange={setStatus} options={[{ value: '', label: 'הכול' }, { value: 'issued', label: 'יצאו' }, { value: 'cleared', label: 'נפרעו' }, { value: 'not_presented', label: 'לא הוצגו' }, { value: 'voided', label: 'בוטלו' }]} />
        <input aria-label="חיפוש מספר" className="input" placeholder="מספר שיק / אסמכתא" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card flush>
        <DataTable caption="תשלומי עמלות" columns={cols} rows={data || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={(p) => setOpen(p.id)}
          empty={<Empty title="עוד לא שולמו עמלות">תשלום מופק בלשונית "תשלום". כאן עוקבים אחרי כל שיק: יצא, נפרע, לא הוצג או בוטל.</Empty>} />
      </Card>
      <PaymentDialog open={!!open} onClose={() => setOpen(null)} propertyId={propertyId} id={open} canManage={canManage} onDone={() => { notify('התשלום עודכן'); reload(); }} />
    </>
  );
}

function ReportsTab({ propertyId }) {
  const [kind, setKind] = useState('payable');
  const [range, setRange] = useState({ from: monthAgo(), to: ymd(new Date()) });
  const { data, loading, error, reload } = useLoader(async () => (propertyId && range.to >= range.from ? commissions.report(propertyId, { kind, ...range }) : null), [propertyId, kind, range.from, range.to]);
  const cols = [
    { key: 'a', label: 'סוכן', render: (r) => r.agentName },
    { key: 'g', label: 'אורח', render: (r) => <>{r.guestName} <span className="ui-sub" dir="ltr">{r.confirmationNumber}</span></> },
    { key: 'd', label: 'עזיבה', nowrap: true, render: (r) => formatShort(r.departureDate) },
    { key: 'p', label: '%', nowrap: true, render: (r) => `${r.pct}%` },
    { key: 'm', label: 'עמלה', nowrap: true, render: (r) => <span className="ui-num">{money(r.amount)}</span> },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented label="דוח" value={kind} onChange={setKind} options={[{ value: 'payable', label: 'עמלות לתשלום (בלי מושהות)' }, { value: 'paid', label: 'עמלות שהועברו' }]} />
        <label className="ui-sub">עזיבות מ־ <input type="date" className="input" value={range.from} onChange={(e) => setRange((p) => ({ ...p, from: e.target.value }))} /></label>
        <label className="ui-sub">עד <input type="date" className="input" value={range.to} onChange={(e) => setRange((p) => ({ ...p, to: e.target.value }))} /></label>
        {data && <span className="ui-sub">סה״כ {money(data.total)}</span>}
      </div>
      <Card flush><DataTable caption="דוח עמלות" columns={cols} rows={data?.rows || []} loading={loading && !data} error={error} onRetry={reload} empty={<Empty title="אין עמלות בטווח" />} /></Card>
    </>
  );
}

export default function CommissionsPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState({ tab: 'records' });
  const { toasts, success } = useToast();
  const canManage = MANAGE.includes(role);
  const tab = url.get('tab');
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="עמלות סוכנים" meta="עמלה לכל עזיבה, השהיות, תשלום בשיקים או בהעברה ומעקב אחרי כל שיק" back="/pms" />
      <Segmented label="מסך" value={tab} onChange={(v) => url.set({ tab: v })} options={[{ value: 'records', label: 'עמלות' }, { value: 'pay', label: 'תשלום' }, { value: 'payments', label: 'שיקים ותשלומים' }, { value: 'reports', label: 'דוחות' }]} />
      {!canManage && <Banner tone="info">צפייה בלבד — שינוי ותשלום עמלות למנהל, לכספים או למכירות.</Banner>}
      {tab === 'records' && <RecordsTab propertyId={propertyId} canManage={canManage} notify={success} />}
      {tab === 'pay' && <PayTab propertyId={propertyId} canManage={canManage} notify={success} goPayments={() => url.set({ tab: 'payments' })} />}
      {tab === 'payments' && <PaymentsTab propertyId={propertyId} canManage={canManage} notify={success} />}
      {tab === 'reports' && <ReportsTab propertyId={propertyId} />}
    </Page>
  );
}
