// FIN-01 — guest folio and payers. Without a reservation: the index of folios with money on them,
// grouped by how urgent the collection is. With ?reservation=<id>: every folio window of the stay —
// what is owed now and by departure, whether it is covered, whether the money is documented, the
// next step, and the ledger (nothing is ever deleted — corrections are reversal/refund lines).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, AlertTriangle, CheckCircle2, CreditCard, Undo2, Percent, Tag as TagIcon, BedDouble, ShoppingBag, Moon, Phone, Mail } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance } from '../../utils/api';
import { useChargeCodes } from '../../hooks/useChargeCodes';
import {
  LINE_TYPE_LABELS, LINE_DEPARTMENT_LABELS, GUARANTEE_LABELS, SETTLEMENT_LABELS, SOURCE_LABELS,
} from '../../lib/labels';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, BackArrow, Card, Segmented, SearchBox, DataTable, Tag, Empty, Banner, ConfirmDialog, Pager,
  ErrorBanner, Spinner, useUrlState, useLoader, useAction, money, formatDateTime,
} from '../../components/kit';
import { ChargeDialog, PaymentDialog, RefundDialog, CreditNoteDialog } from '../../components/fin/FinanceDialogs';
import { IssueDocumentDialog, AllocationDialog, DocumentList } from '../../components/fin/DocumentDialogs';

const MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const REVERSE_ROLES = [...MANAGER_ROLES, 'finance_manager'];
const CREDIT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const WORK_ROLES = [...MANAGER_ROLES, 'receptionist', 'finance_manager', 'cashier'];
const DEFAULTS = { view: 'open', q: '', page: '1' };
const RES_STATUS = { in_house: 'בבית', checked_in: 'בבית', checked_out: 'יצא', confirmed: 'מאושרת', cancelled: 'בוטלה', no_show: 'לא הגיע', partially_checked_in: 'נכנס חלקית', partially_checked_out: 'יצא חלקית', modified: 'עודכנה', pending_payment: 'ממתינה לתשלום' };
const IN_HOUSE = ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'];
const FUTURE = ['confirmed', 'modified', 'pending_payment'];

const EPS = 0.005;
const daysBetween = (from, to) => (from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 864e5) : null);
const nightsLabel = (n) => (n === 1 ? 'לילה אחד' : `${n || 0} לילות`);
const daysLabel = (n) => (n === 1 ? 'יום' : n === 2 ? 'יומיים' : `${n} ימים`);

// Where the stay stands relative to the business date, in the words the desk uses.
function whenLabel(row, today) {
  const toDep = daysBetween(today, row.departureDate);
  const toArr = daysBetween(today, row.arrivalDate);
  if (row.reservationStatus === 'checked_out') return toDep === 0 ? 'יצא היום' : `יצא לפני ${daysLabel(Math.abs(toDep))}`;
  if (IN_HOUSE.includes(row.reservationStatus)) return toDep <= 0 ? 'עוזב היום' : toDep === 1 ? 'עוזב מחר' : `עוזב בעוד ${daysLabel(toDep)}`;
  if (toArr === 0) return 'מגיע היום';
  if (toArr === 1) return 'מגיע מחר';
  if (toArr > 1) return `מגיע בעוד ${daysLabel(toArr)}`;
  return RES_STATUS[row.reservationStatus] || '';
}

const GROUPS = [
  { id: 'leaving', title: 'עוזבים היום עם יתרה', hint: 'לגבות לפני היציאה', tone: 'due' },
  { id: 'departed', title: 'עזבו עם חוב פתוח', hint: 'גבייה אחרי יציאה', tone: 'due' },
  { id: 'credit', title: 'יתרת זכות', hint: 'להחזיר לאורח או לאשר', tone: 'warn' },
  { id: 'inhouse', title: 'בבית', hint: 'חשבונות פתוחים של שוהים' },
  { id: 'future', title: 'הזמנות עתידיות', hint: 'מקדמות וחיובים מראש' },
  { id: 'other', title: 'אחרים', hint: '' },
];

function groupOf(row, today) {
  if (row.balance < -EPS) return 'credit';
  if (row.reservationStatus === 'checked_out') return row.balance > EPS ? 'departed' : 'other';
  if (IN_HOUSE.includes(row.reservationStatus)) return row.balance > EPS && daysBetween(today, row.departureDate) <= 0 ? 'leaving' : 'inhouse';
  if (FUTURE.includes(row.reservationStatus)) return 'future';
  return 'other';
}

function FolioIndex({ propertyId, url, onOpen }) {
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.folios(propertyId, { view: url.get('view'), q: url.get('q') || undefined, page: url.get('page') }) : null), [propertyId, url.key]);
  const c = data?.counts || {};
  const today = data?.businessDate;
  const groups = useMemo(() => {
    const by = new Map(GROUPS.map((g) => [g.id, []]));
    for (const row of data?.rows || []) by.get(groupOf(row, today)).push(row);
    return GROUPS.map((g) => ({ ...g, rows: by.get(g.id), sum: by.get(g.id).reduce((s, r) => s + r.balance, 0) })).filter((g) => g.rows.length);
  }, [data, today]);

  const columns = [
    { key: 'room', label: 'חדר', nowrap: true, render: (r) => (r.room ? <span className="fo-room">{r.room}</span> : <span className="fo-room is-none">ללא חדר</span>) },
    {
      key: 'guest', label: 'אורח', render: (r) => (
        <div>
          <button type="button" className="ui-guest-name" onClick={() => onOpen(r)}>{r.guest}</button>
          <div className="ui-sub"><bdi>{r.confirmationNumber}</bdi>{r.ownerType && r.ownerType !== 'guest' ? ` · חשבון ${r.owner}` : ''}</div>
        </div>
      ),
    },
    {
      key: 'when', label: 'שהייה', nowrap: true, render: (r) => (
        <div>
          {groupOf(r, today) !== 'leaving' && <div className="fo-when">{whenLabel(r, today)}</div>}
          <div className="ui-sub ui-num">{r.arrivalDate ? `${formatShort(r.arrivalDate)} – ${formatShort(r.departureDate)} · ${nightsLabel(r.nights ?? daysBetween(r.arrivalDate, r.departureDate))}` : '—'}</div>
        </div>
      ),
    },
    {
      key: 'money', label: 'תשלומים', nowrap: true, render: (r) => {
        const missingDeposit = r.depositRequired > EPS && (r.totals?.payments || 0) < r.depositRequired - EPS;
        return (
          <div>
            <div className="ui-num">שולם {money(r.totals?.payments || 0, 'ILS', 0)} <span className="ui-sub">מתוך {money(r.totals?.charges || 0, 'ILS', 0)}</span></div>
            {missingDeposit
              ? <div className="fo-flag is-warn">חסרה מקדמה {money(r.depositRequired - (r.totals?.payments || 0), 'ILS', 0)}</div>
              : r.guarantee && r.guarantee !== 'none' && <div className="ui-sub">ערבות: {GUARANTEE_LABELS[r.guarantee] || r.guarantee}</div>}
          </div>
        );
      },
    },
    {
      key: 'bal', label: 'יתרה', nowrap: true, align: 'left', render: (r) => (
        <div className="fo-amt">
          <span className={`fo-money ${r.balance > EPS ? 'is-due' : r.balance < -EPS ? 'is-credit' : ''}`}>{money(Math.abs(r.balance))}</span>
          <span className="ui-sub">{r.balance > EPS ? 'לתשלום' : r.balance < -EPS ? 'זכות לאורח' : 'מאוזן'}{r.settlement ? ` · ${SETTLEMENT_LABELS[r.settlement]}` : ''}</span>
        </div>
      ),
    },
    {
      key: 'go', label: 'פעולה', srOnly: true, nowrap: true, render: (r) => (
        <button type="button" className={`fo-go ${['leaving', 'departed'].includes(groupOf(r, today)) ? 'is-primary' : ''}`} onClick={(e) => { e.stopPropagation(); onOpen(r); }}>
          {['leaving', 'departed'].includes(groupOf(r, today)) ? 'לגבייה' : r.balance < -EPS ? 'להחזר' : 'לחשבון'}
        </button>
      ),
    },
  ];

  return (
    <>
      <PageBar
        title="חשבונות אורח"
        meta={data && url.get('view') !== 'closed' ? `${money(c.openBalance, 'ILS', 0)} חוב פתוח ב־${c.owed} חשבונות` : undefined}
        back="/pms"
        tools={<SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם אורח, טלפון או מספר אישור" id="fol-q" />}
      />
      <Segmented
        label="סינון חשבונות"
        value={url.get('view')}
        onChange={(v) => url.set({ view: v })}
        options={[
          { value: 'open', label: 'כל הפתוחים', count: data ? c.open : undefined },
          { value: 'balance', label: 'חייבים', count: data ? c.owed : undefined },
          { value: 'credit', label: 'זכות לאורח', count: data ? c.credit : undefined },
          { value: 'closed', label: 'סגורים' },
        ]}
      />
      {(loading && !data) || error || !groups.length ? (
        <Card flush>
          <DataTable caption="חשבונות אורח" columns={columns} rows={data ? [] : undefined} loading={loading && !data} error={error} onRetry={reload} filtered={!!url.get('q')} empty={<Empty title="אין חשבונות בתצוגה זו" />} />
        </Card>
      ) : groups.map((g) => (
        <section key={g.id} className={`fo-panel ap-list fo-group ${g.tone ? `is-${g.tone}` : ''}`} aria-label={g.title}>
          <h2 className={`fo-gh ${g.tone ? `is-${g.tone}` : ''}`}>
            <span>{g.title}</span>
            <span className="fo-gh-n">{g.rows.length}</span>
            {g.hint && <span className="fo-gh-hint">{g.hint}</span>}
            {Math.abs(g.sum) > EPS && <span className="fo-gh-sum">{money(Math.abs(g.sum), 'ILS', 0)}</span>}
          </h2>
          <DataTable caption={g.title} columns={columns} rows={g.rows} onRowClick={onOpen} />
        </section>
      ))}
      {data && data.pages > 1 && <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => url.set({ page: p }, { resetPage: false })} unit="חשבונות" />}
    </>
  );
}

function StayFolios({ propertyId, reservationId, folioParam, url, role }) {
  const nav = useNavigate();
  const { toasts, success } = useToast();
  const [dialog, setDialog] = useState(null);
  const [docErr, setDocErr] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.stay(propertyId, reservationId) : null), [propertyId, reservationId]);
  const folio = useMemo(() => data?.folios.find((f) => f.id === folioParam) || data?.folios[0] || null, [data, folioParam]);
  const departed = data?.reservation?.status === 'checked_out';
  const canWork = WORK_ROLES.includes(role) && data?.canPost && folio?.status !== 'closed';
  // G6: after departure a charge is a post-stay charge (from the stay file); payments still allowed.
  const canCharge = canWork && !departed;
  const canClose = WORK_ROLES.includes(role) && folio && folio.status !== 'closed' && Math.abs(folio.balance) < EPS
    && ['checked_out', 'cancelled', 'no_show'].includes(data?.reservation?.status);
  const canPay = canWork && folio && (!departed || folio.balance > EPS);
  const canIssue = folio && WORK_ROLES.includes(role);
  const closeAct = useAction();
  const { charges: codeList } = useChargeCodes(propertyId);
  const codeName = (k) => codeList.find((c) => c.code === k)?.name || LINE_DEPARTMENT_LABELS[k] || k;
  const canReverse = REVERSE_ROLES.includes(role);
  const canCredit = CREDIT_ROLES.includes(role);
  const canApproveRefund = REVERSE_ROLES.includes(role);

  if (loading && !data) return <div className="ui-empty"><Spinner /> טוען…</div>;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;
  const r = data.reservation;
  const docsHere = data.documents.filter((d) => !d.folioId || d.folioId === folio?.id);
  const closeFolio = async () => { const out = await closeAct.run(() => finance.closeFolio(propertyId, folio.id)); if (out) { success('החשבון נסגר'); reload(); } };

  // ── What the desk needs to know about this window ──
  const lines = folio?.lines || [];
  const posted = lines.filter((l) => l.status === 'posted');
  const isCharge = (l) => ['charge', 'fee', 'tax'].includes(l.type);
  const isPayment = (l) => ['payment', 'deposit'].includes(l.type);
  const unreceipted = posted.filter((l) => isPayment(l) && !l.onReceipt && !l.onDocument && !l.reversed);
  const unreceiptedSum = unreceipted.reduce((s, l) => s + Math.abs(l.gross), 0);
  const uninvoiced = posted.filter((l) => isCharge(l) && !l.onDocument && !l.reversed && !l.reversalOf);
  const uninvoicedSum = uninvoiced.reduce((s, l) => s + l.gross, 0);
  const toDeparture = daysBetween(data.businessDate, r.departureDate);
  const stayTotal = folio?.ownerType === 'guest' && r.totalAmount ? r.totalAmount : null;
  const notYetCharged = !departed && stayTotal ? Math.max(0, stayTotal - (folio?.totals.charges || 0)) : 0;
  const atDeparture = (folio?.balance || 0) + notYetCharged;
  const depositRequired = data.guarantee.depositRequired || 0;
  const paid = folio?.totals.payments || 0;
  const depositMissing = depositRequired > EPS && paid < depositRequired - EPS ? depositRequired - paid : 0;
  const departureWords = departed ? 'האורח כבר יצא' : toDeparture <= 0 ? 'היציאה היום' : toDeparture === 1 ? 'היציאה מחר' : `היציאה ב־${formatShort(r.departureDate)}`;

  // One next step, in the order the desk would deal with it.
  let next = null;
  if (folio && folio.status !== 'closed') {
    if (folio.balance > EPS && (departed || toDeparture <= 0)) next = { tone: 'due', text: `לגבות ${money(folio.balance)} — ${departureWords}`, label: 'גבייה', run: canPay && (() => setDialog({ kind: 'pay' })) };
    else if (depositMissing) next = { tone: 'warn', text: `חסרה מקדמה של ${money(depositMissing)} (נדרשו ${money(depositRequired)})`, label: 'קבלת מקדמה', run: canPay && (() => setDialog({ kind: 'pay' })) };
    else if (unreceiptedSum > EPS) next = { tone: 'warn', text: `התקבלו ${money(unreceiptedSum)} בלי קבלה`, label: 'הפקת קבלה', run: canIssue && (() => setDialog({ kind: 'issue' })) };
    else if (folio.balance < -EPS) next = { tone: 'warn', text: `יתרת זכות של ${money(Math.abs(folio.balance))} — להחזיר לאורח`, label: null };
    else if ((departed || toDeparture <= 0) && uninvoicedSum > EPS) next = { tone: 'warn', text: `חיובים של ${money(uninvoicedSum)} עוד לא בחשבונית`, label: 'הפקת חשבונית', run: canIssue && (() => setDialog({ kind: 'issue' })) };
    else if (canClose) next = { tone: 'ok', text: 'החשבון מאוזן ומתועד — אפשר לסגור', label: 'סגירת חשבון', run: closeFolio };
    else if (folio.balance > EPS) next = { tone: 'plain', text: `יתרה פתוחה ${money(folio.balance)} · ${departureWords}`, label: 'גבייה', run: canPay && (() => setDialog({ kind: 'pay' })) };
    else next = { tone: 'ok', text: notYetCharged > EPS ? `החשבון מאוזן כרגע · עוד ${money(notYetCharged)} יחויבו עד היציאה` : 'החשבון מאוזן ומתועד', label: null };
  }

  const docBadge = (l) => {
    if (l.status !== 'posted') return <span className="fo-flag is-bad">{l.status}</span>;
    if (l.reversed) return <span className="fo-doc is-none">בוטל בהיפוך</span>;
    if (l.reversalOf) return <span className="fo-doc is-none">היפוך</span>;
    if (l.onDocument) return <span className="fo-doc">חשבונית {l.onDocument}</span>;
    if (l.onReceipt) return <span className="fo-doc">קבלה {l.onReceipt}</span>;
    if (isPayment(l)) return <span className="fo-flag is-warn">ללא קבלה</span>;
    if (isCharge(l)) return <span className="fo-doc is-none">טרם בחשבונית</span>;
    return null;
  };
  const LineIcon = ({ l }) => {
    const Icon = isPayment(l) ? CreditCard : l.type === 'refund' ? Undo2 : l.type === 'tax' ? Percent : ['adjustment', 'discount'].includes(l.type) ? TagIcon : l.department === 'room' || l.department === 'lodging' || /לינה/.test(l.description || '') ? BedDouble : ShoppingBag;
    return <span className={`fo-ico ${isPayment(l) ? 'is-pay' : ''}`}><Icon size={15} aria-hidden="true" /></span>;
  };
  // Lines grouped by service night, newest first, like a folio statement.
  const days = [];
  for (const l of [...lines].reverse()) {
    const d = days.find((x) => x.date === l.serviceDate);
    if (d) d.lines.push(l); else days.push({ date: l.serviceDate, lines: [l] });
  }
  const chargeLines = posted.filter((l) => isCharge(l) || ['adjustment', 'discount'].includes(l.type));
  const net = chargeLines.reduce((s, l) => s + (l.net || 0), 0);
  const vat = chargeLines.reduce((s, l) => s + (l.tax || 0), 0);
  const stepsDone = [true, IN_HOUSE.includes(r.status) || departed, departed];

  return (
    <>
      <ToastContainer toasts={toasts} />
      {/* one guest card: who + actions, then the stay in a single row */}
      <header className="fo-panel fo-head">
        <div className="fo-head-who">
          <BackArrow to="/pms/folio" />
          <span className="fo-avatar" aria-hidden="true">{(r.guest || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
          <div className="fo-head-id">
            <h1 className="fo-head-name">{r.guest}<bdi className="fo-head-res">{r.confirmationNumber}</bdi>{r.vipLevel ? <span className="fo-vip">VIP {r.vipLevel}</span> : null}</h1>
            <div className="fo-head-contact">
              {r.phone && <a href={`tel:${r.phone}`} dir="ltr"><Phone size={13} aria-hidden="true" />{r.phone}</a>}
              {r.email && <a href={`mailto:${r.email}`} dir="ltr"><Mail size={13} aria-hidden="true" />{r.email}</a>}
              {!r.phone && !r.email && <span>אין פרטי קשר</span>}
            </div>
          </div>
        </div>
        <div className="fo-head-actions">
          <button type="button" className="btn btn-secondary" onClick={() => nav(`/pms/reservations/${r.id}`)}>תיק ההזמנה</button>
          {canWork && departed && <button type="button" className="btn btn-secondary" onClick={() => nav(`/pms/reservations/${r.id}`)} title="חיוב אחרי יציאה נרשם מתיק ההזמנה (מנהל, עם סיבה)">חיוב אחרי יציאה</button>}
          {canIssue && <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'issue' })}><FileText size={16} /> הפקת מסמך</button>}
          {canCharge && <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'charge' })}><Plus size={16} /> חיוב</button>}
          {canPay && <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'pay' })}>תשלום</button>}
        </div>
        <div className="fo-head-stay">
          <span className={`fo-status is-${departed ? 'out' : IN_HOUSE.includes(r.status) ? 'in' : 'future'}`}>{RES_STATUS[r.status] || r.status}</span>
          <span className="fo-guest-room">חדר <b>{r.room || '—'}</b>{r.roomType ? ` · ${r.roomType}` : ''}</span>
          <ol className="fo-steps" aria-label="מהלך השהייה">
            {[['הזמנה', null], ['כניסה', r.arrivalDate], ['יציאה', r.departureDate]].map(([k, d], i) => (
              <li key={k} className={stepsDone[i] ? 'is-done' : ''}><span className="fo-step-dot" /><b>{k}</b><span className="ui-num">{d ? formatShort(d) : ''}</span></li>
            ))}
          </ol>
          <dl className="fo-strip-facts">
            <div><dt>שהייה</dt><dd>{nightsLabel(r.nights)}</dd></div>
            <div><dt>אורחים</dt><dd>{r.adults ?? '—'} מבוגרים{r.children ? ` · ${r.children} ילדים` : ''}</dd></div>
            <div><dt>מקור</dt><dd>{SOURCE_LABELS[r.source] || r.source || '—'}</dd></div>
            {r.ratePlan && <div><dt>תעריף</dt><dd>{r.ratePlan}</dd></div>}
            {r.company && <div><dt>חברה</dt><dd>{r.company.name}</dd></div>}
            <div><dt>ערבות</dt><dd>{data.guarantee.type === 'none' ? 'ללא' : GUARANTEE_LABELS[data.guarantee.type] || data.guarantee.type}</dd></div>
            <div className={depositMissing ? 'is-warn' : ''}><dt>{depositMissing ? 'מקדמה חסרה' : 'מקדמה נדרשת'}</dt><dd className="ui-num">{depositMissing ? money(depositMissing) : depositRequired ? money(depositRequired) : '—'}</dd></div>
          </dl>
        </div>
      </header>
      {data.exceptions.map((x) => <Banner key={`${x.code}-${x.folioId}`} tone="warn">{x.label}</Banner>)}
      <ErrorBanner error={closeAct.error} />
      {!folio && <Card><Empty title="אין חשבון להזמנה זו">חשבון נפתח אוטומטית עם החיוב או התשלום הראשון בכניסה.</Empty></Card>}
      {folio && (
        <>
        <div className="fo-layout">

          {/* the ledger */}
          <section className="fo-panel fo-ledger" aria-label="תנועות בחשבון">
            <header className="fo-ledger-h">
              {data.folios.length > 1 ? (
                <Segmented
                  label="חלונות חשבון"
                  value={folio.id}
                  onChange={(id) => url.set({ folio: id }, { resetPage: false })}
                  options={data.folios.map((f) => ({ value: f.id, label: `${f.owner}${f.status === 'closed' ? ' (סגור)' : ''}`, count: money(f.balance, f.currency, 0) }))}
                />
              ) : <h2 className="fo-panel-h">חשבון {folio.owner}{folio.status === 'closed' ? ' · סגור' : ''}</h2>}
            </header>
            {lines.length === 0 && <Empty title="אין תנועות בחשבון" />}
            {days.map((d) => (
              <div key={d.date} className="fo-day">
                <div className="fo-day-h"><span>{formatShort(d.date)}</span><span>{d.lines.length === 1 ? 'תנועה אחת' : `${d.lines.length} תנועות`}</span></div>
                <ul className="fo-lines">
                  {d.lines.map((l) => {
                    const canRev = isCharge(l) && l.type !== 'tax' && !l.reversed && !l.reversalOf && l.status === 'posted' && canReverse && !l.onDocument && folio.status !== 'closed';
                    const canRef = isPayment(l) && l.status === 'posted' && l.refundable > EPS && folio.balance < -EPS;
                    return (
                      <li key={l.id} className={`fo-line ${l.reversed || l.reversalOf ? 'is-done' : ''}`}>
                        <LineIcon l={l} />
                        <div className="fo-line-main">
                          <div className="fo-line-t">{l.description}</div>
                          <div className="fo-line-meta">
                            <span>{LINE_TYPE_LABELS[l.type] || l.type}{l.department ? ` · ${codeName(l.department)}` : ''}</span>
                            <span className="ui-num">{formatDateTime(l.postedAt)}</span>
                            {l.reason && l.type !== 'refund' && <span>{l.reason}</span>}
                            {docBadge(l)}
                            {l.refundable !== null && l.refundable < Math.abs(l.gross) - EPS && <span className="fo-doc is-none">{l.refundable > EPS ? 'הוחזר חלקית' : 'הוחזר'}</span>}
                          </div>
                        </div>
                        {(canRev || canRef) && (
                          <button type="button" className="fo-line-act" onClick={() => setDialog(canRev ? { kind: 'reverse', line: l } : { kind: 'refund', line: l })}>{canRev ? 'היפוך' : 'החזר'}</button>
                        )}
                        <div className="fo-line-amt">
                          <span className={`ui-num ${l.gross < 0 ? 'is-credit' : ''}`}>{l.gross < 0 ? `−${money(Math.abs(l.gross))}` : money(l.gross)}</span>
                          {l.tax ? <span className="ui-sub ui-num">מע״מ {money(l.tax)}</span> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {lines.length > 0 && (
              <footer className="fo-ledger-f ui-num">
                <span>{lines.length} תנועות</span>
                <span>חיובים <b>{money(net + vat)}</b></span>
                <span>תשלומים <b className="is-credit">−{money(paid)}</b></span>
                <span>יתרה <b className={folio.balance > EPS ? 'is-due' : ''}>{money(folio.balance)}</b></span>
              </footer>
            )}
          </section>

          {/* the statement */}
          <aside className="fo-col">
            {next && (
              <section className={`fo-panel fo-next is-${next.tone}`} role="status" aria-label="הצעד הבא">
                <div className="fo-next-row">
                  {next.tone === 'ok' ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
                  <div className="fo-next-txt"><span>הצעד הבא</span><b>{next.text}</b></div>
                </div>
                {next.label && next.run && <button type="button" className="btn btn-primary" disabled={closeAct.busy} onClick={next.run}>{next.label}</button>}
              </section>
            )}
            <section className="fo-panel fo-stmt" aria-label="סיכום חשבון">
              <h3 className="fo-panel-h">סיכום</h3>
              <dl className="fo-kv">
                <div><dt>חיובים לפני מע״מ</dt><dd className="ui-num">{money(net)}</dd></div>
                <div><dt>מע״מ</dt><dd className="ui-num">{money(vat)}</dd></div>
                <div className="is-total"><dt>סה״כ חיובים</dt><dd className="ui-num">{money(net + vat)}</dd></div>
                <div><dt>תשלומים</dt><dd className="ui-num is-credit">−{money(paid)}</dd></div>
                {folio.totals.refunds ? <div><dt>החזרים</dt><dd className="ui-num">{money(folio.totals.refunds)}</dd></div> : null}
              </dl>
              <div className={`fo-due ${folio.balance > EPS ? 'is-due' : folio.balance < -EPS ? 'is-credit' : ''}`}>
                <span>{folio.balance > EPS ? 'יתרה לתשלום' : folio.balance < -EPS ? 'זכות לאורח' : 'יתרה'}</span>
                <b className="ui-num">{money(Math.abs(folio.balance))}</b>
              </div>
              {stayTotal ? (
                <dl className="fo-kv fo-kv-sub">
                  <div><dt>מחיר השהייה</dt><dd className="ui-num">{money(stayTotal)}</dd></div>
                  <div><dt>עוד יחויב עד היציאה</dt><dd className="ui-num">{money(notYetCharged)}</dd></div>
                  <div className="is-total"><dt>צפוי ביציאה</dt><dd className="ui-num">{money(Math.max(0, atDeparture))}</dd></div>
                </dl>
              ) : null}
              {folio.settlement && <p className="ui-sub">סגירה ביציאה: {SETTLEMENT_LABELS[folio.settlement.mode]}{folio.settlement.by ? ` · ${folio.settlement.by}` : ''}</p>}
            </section>
            <section className="fo-panel" aria-label="מסמכים">
              <h3 className="fo-panel-h">מסמכים <span className="ui-sub">{docsHere.length || ''}</span></h3>
              <dl className="fo-kv">
                <div className={unreceiptedSum > EPS ? 'is-warn' : ''}><dt>תשלומים בלי קבלה</dt><dd className="ui-num">{unreceiptedSum > EPS ? money(unreceiptedSum) : 'אין'}</dd></div>
                <div><dt>חיובים שטרם בחשבונית</dt><dd className="ui-num">{uninvoicedSum > EPS ? money(uninvoicedSum) : 'אין'}</dd></div>
              </dl>
              <ErrorBanner error={docErr} />
              <DocumentList
                docs={docsHere}
                propertyId={propertyId}
                canCredit={canCredit}
                onCredit={(d) => setDialog({ kind: 'credit', doc: d })}
                onAllocate={(d) => setDialog({ kind: 'alloc', doc: d })}
                onError={setDocErr}
                onChanged={() => { success('המסמך נשלח'); reload(); }}
              />
            </section>
          </aside>
        </div>
        </>
      )}

      <ChargeDialog open={dialog?.kind === 'charge'} onClose={() => setDialog(null)} propertyId={propertyId} folio={folio} vatRate={data.vatRate} businessDate={data.businessDate} onSaved={() => { setDialog(null); success('החיוב נרשם'); reload(); }} />
      <PaymentDialog open={dialog?.kind === 'pay'} onClose={() => setDialog(null)} propertyId={propertyId} folio={folio} onSaved={(o) => { setDialog(null); success(o?.duplicate ? 'התשלום כבר נרשם' : o?.change ? `התשלום נרשם · עודף ${money(o.change)}` : 'התשלום נרשם'); reload(); }} />
      <RefundDialog open={dialog?.kind === 'refund'} onClose={() => setDialog(null)} propertyId={propertyId} folio={folio} payment={dialog?.line} canApprove={canApproveRefund} threshold={data.policy.refundApprovalOver} onSaved={() => { setDialog(null); success('ההחזר נרשם'); reload(); }} />
      <IssueDocumentDialog open={dialog?.kind === 'issue'} onClose={() => setDialog(null)} propertyId={propertyId} folioId={folio?.id} subtitle={folio ? `${r.guest} · חשבון ${folio.owner}` : ''} onIssued={() => reload()} />
      <AllocationDialog open={dialog?.kind === 'alloc'} onClose={() => setDialog(null)} propertyId={propertyId} doc={dialog?.doc} onSaved={() => { setDialog(null); success('מספר ההקצאה נשמר'); reload(); }} />
      <CreditNoteDialog open={dialog?.kind === 'credit'} onClose={() => setDialog(null)} propertyId={propertyId} doc={dialog?.doc} onSaved={(o) => { setDialog(null); success(`הופק מסמך זיכוי ${o?.number || ''}`); reload(); }} />
      <ConfirmDialog
        open={dialog?.kind === 'reverse'}
        onClose={() => setDialog(null)}
        title="היפוך חיוב"
        subtitle={dialog?.line ? `${dialog.line.description} · ${money(dialog.line.gross)}` : ''}
        confirmLabel="רישום היפוך"
        danger
        requireReason
        onConfirm={async (reason) => { await finance.reverse(propertyId, folio.id, dialog.line.id, reason); setDialog(null); success('החיוב הופך'); reload(); }}
      >
        <p className="ui-p">נרשמת שורה נגדית מקושרת. החיוב המקורי נשאר בחשבון לתיעוד.</p>
      </ConfirmDialog>
    </>
  );
}

export default function FolioPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState(DEFAULTS);
  const reservationId = url.params.get('reservation');
  return (
    <Page wide approved>
      {reservationId
        ? <StayFolios propertyId={propertyId} reservationId={reservationId} folioParam={url.params.get('folio')} url={url} role={role} />
        : <FolioIndex propertyId={propertyId} url={url} onOpen={(row) => url.set({ reservation: row.reservationId, folio: row.id }, { resetPage: false })} />}
    </Page>
  );
}
