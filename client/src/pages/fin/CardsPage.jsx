// Cards (gap-map item 12): authorizations of in-house stays against what they may still cost (top-up),
// card companies as debtors per day and brand until the deposit arrives, and the card transactions log.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../ops/EventsPage.css';
import { useProperty } from '../../context/PropertyContext';
import { cards } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, DataTable, Empty, Modal, Field, Pill, ErrorBanner, Spinner, Segmented, Banner,
  useLoader, useAction, useUrlState, money, formatDateTime,
} from '../../components/kit';

const BRAND = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', isracard: 'ישראכרט', diners: 'Diners', other: 'אחר' };
const STATUS = { open: ['warn', 'פתוח'], partial: ['warn', 'חלקי'], settled: ['ok', 'נסגר'] };
const KIND = { capture: 'חיוב מהמסגרת', sale: 'חיוב', refund: 'החזר' };
const ymd = (d) => d.toISOString().slice(0, 10);

function AuthTab({ propertyId, notify }) {
  const nav = useNavigate();
  const act = useAction();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? cards.board(propertyId) : null), [propertyId]);
  const cols = [
    { key: 'g', label: 'אורח / הזמנה', render: (r) => <><b>{r.guestName}</b> <span className="ui-sub" dir="ltr">{r.confirmationNumber}</span></> },
    { key: 'c', label: 'כרטיס', nowrap: true, render: (r) => r.card || '—' },
    { key: 'd', label: 'עזיבה', nowrap: true, render: (r) => formatShort(r.departureDate) },
    { key: 'a', label: 'מסגרת פנויה', nowrap: true, render: (r) => <span className="ui-num">{r.hasAuth ? money(r.available) : 'אין'}</span> },
    { key: 'e', label: 'עוד עלול לעלות', nowrap: true, render: (r) => <span className="ui-num">{money(r.exposure)}</span> },
    { key: 's', label: 'מצב', nowrap: true, render: (r) => (r.gap > 0.005 ? <Pill tone="bad">חסר {money(r.gap)}</Pill> : <Pill tone="ok">מכוסה</Pill>) },
    { key: 'x', label: '', nowrap: true, render: (r) => (r.gap > 0.005 && r.card ? <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy} onClick={() => act.run(async () => { await cards.topUp(propertyId, r.reservation); notify('המסגרת הושלמה'); reload(); })}>{r.hasAuth ? 'השלמת מסגרת' : 'לקיחת מסגרת'}</button> : null) },
  ];
  return (
    <>
      <ErrorBanner error={act.error} />
      <Card flush>
        <DataTable caption="מסגרות" columns={cols} rows={(data || []).map((r) => ({ ...r, id: r.reservation }))} loading={loading && !data} error={error} onRetry={reload} onRowClick={(r) => nav(`/pms/reservations/${r.reservation}`)}
          empty={<Empty title="אין שוהים עם כרטיס">מסגרת נלקחת בצ'ק־אין לאורח שיש לו כרטיס בהזמנה. כשהשהייה עלולה לעלות יותר מהמסגרת, השורה מסומנת "חסר".</Empty>} />
      </Card>
    </>
  );
}

function DepositDialog({ open, onClose, propertyId, row, onDone }) {
  const act = useAction();
  const [amount, setAmount] = useState(''); const [fee, setFee] = useState(''); const [ref, setRef] = useState('');
  useEffect(() => { if (open && row) { act.reset(); setAmount(row.open); setFee(''); setRef(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!row) return null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={440} title={`הפקדה · ${BRAND[row.brand] || row.brand} · ${formatShort(row.date)}`} subtitle={`נשאר לקבל ${money(row.open)}`}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy} onClick={() => act.run(async () => { await cards.deposit(propertyId, row.id, { amount: Number(amount), fee: Number(fee || 0), ref }); onDone(); })}>{act.busy ? <Spinner /> : 'רישום'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="dp-a" label="הופקד בבנק (₪)" error={act.fields.amount}><input id="dp-a" type="number" min="0" step="0.01" className="input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field id="dp-f" label="עמלת חברת האשראי (₪)"><input id="dp-f" type="number" min="0" step="0.01" className="input w-full" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
        </div>
        <Field id="dp-r" label="אסמכתא"><input id="dp-r" className="input w-full" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function SettleTab({ propertyId, notify }) {
  const [status, setStatus] = useState('open');
  const [dlg, setDlg] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? cards.settlements(propertyId, { status }) : null), [propertyId, status]);
  const cols = [
    { key: 'd', label: 'יום', nowrap: true, render: (r) => formatShort(r.date) },
    { key: 'b', label: 'סוג כרטיס', nowrap: true, render: (r) => BRAND[r.brand] || r.brand },
    { key: 'e', label: 'חייבים לנו', nowrap: true, render: (r) => <span className="ui-num">{money(r.expected)}</span> },
    { key: 'p', label: 'הופקד', nowrap: true, render: (r) => <span className="ui-num">{money(r.deposited)}</span> },
    { key: 'f', label: 'עמלה', nowrap: true, render: (r) => <span className="ui-num">{money(r.fees)}</span> },
    { key: 'o', label: 'נשאר', nowrap: true, render: (r) => <span className="ui-num"><b>{money(r.open)}</b></span> },
    { key: 's', label: 'מצב', nowrap: true, render: (r) => <Pill tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Pill> },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Segmented label="מצב" value={status} onChange={setStatus} options={[{ value: 'open', label: 'פתוחים' }, { value: 'settled', label: 'נסגרו' }, { value: '', label: 'הכול' }]} />
        {data && <span className="ui-sub">חברות האשראי חייבות כרגע {money(data.openTotal)}</span>}
      </div>
      {data?.attention?.length > 0 && <Banner tone="error">עסקאות שדורשות טיפול ידני: {data.attention.map((a) => `${KIND[a.kind]} ${money(a.amount)} ••${a.last4} — ${a.message}`).join(' · ')}</Banner>}
      <Card flush>
        <DataTable caption="חברות האשראי כחייב" columns={cols} rows={data?.rows || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={(r) => (r.status !== 'settled' ? setDlg(r) : null)}
          empty={<Empty title="אין חובות פתוחים של חברות האשראי">כל חיוב כרטיס נצבר כאן לפי יום וסוג כרטיס, עד שההפקדה מגיעה לבנק ונרשמת.</Empty>} />
      </Card>
      <DepositDialog open={!!dlg} onClose={() => setDlg(null)} propertyId={propertyId} row={dlg} onDone={() => { setDlg(null); notify('ההפקדה נרשמה'); reload(); }} />
    </>
  );
}

function TxTab({ propertyId }) {
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 7 * 86400000)));
  const [to, setTo] = useState(ymd(new Date()));
  const { data, loading, error, reload } = useLoader(async () => (propertyId && to >= from ? cards.transactions(propertyId, { from, to }) : null), [propertyId, from, to]);
  const cols = [
    { key: 't', label: 'מתי', nowrap: true, render: (r) => <span className="ui-sub">{formatDateTime(r.at)}</span> },
    { key: 'k', label: 'פעולה', nowrap: true, render: (r) => KIND[r.kind] },
    { key: 'a', label: 'סכום', nowrap: true, render: (r) => <span className="ui-num">{r.kind === 'refund' ? '−' : ''}{money(r.amount)}</span> },
    { key: 'c', label: 'כרטיס', nowrap: true, render: (r) => `${BRAND[r.brand] || ''} ••${r.last4}` },
    { key: 'p', label: 'אישור', nowrap: true, render: (r) => <span dir="ltr">{r.approval}</span> },
    { key: 'r', label: 'הזמנה', nowrap: true, render: (r) => <span dir="ltr">{r.confirmationNumber || '—'}</span> },
    { key: 'b', label: 'בוצע ע״י', nowrap: true, render: (r) => <span className="ui-sub">{r.by}{r.attention ? ` · ${r.attention}` : ''}</span> },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="ui-sub">מתאריך <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="ui-sub">עד <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <Card flush><DataTable caption="עסקאות כרטיס" columns={cols} rows={data || []} loading={loading && !data} error={error} onRetry={reload} empty={<Empty title="אין עסקאות בטווח" />} /></Card>
    </>
  );
}

export default function CardsPage() {
  const { propertyId } = useProperty();
  const url = useUrlState({ tab: 'auth' });
  const { toasts, success } = useToast();
  const settings = useLoader(async () => (propertyId ? cards.settings(propertyId) : null), [propertyId]);
  const tab = url.get('tab');
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="כרטיסי אשראי" meta="מסגרות של שוהים, חברות האשראי כחייב עד ההפקדה, ועסקאות" back="/pms" />
      {settings.data?.provider === 'mock' && <Banner tone="warn">הנכס עובד מול ספק בדיקה — כסף אמיתי לא עובר. חיבור ספק סליקה במסך "הגדרות סליקה".</Banner>}
      <Segmented label="מסך" value={tab} onChange={(v) => url.set({ tab: v })} options={[{ value: 'auth', label: 'מסגרות' }, { value: 'settle', label: 'הפקדות' }, { value: 'tx', label: 'עסקאות' }]} />
      {tab === 'auth' && <AuthTab propertyId={propertyId} notify={success} />}
      {tab === 'settle' && <SettleTab propertyId={propertyId} notify={success} />}
      {tab === 'tx' && <TxTab propertyId={propertyId} />}
    </Page>
  );
}
