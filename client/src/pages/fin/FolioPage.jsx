// FIN-01 — guest folio and payers. Without a reservation: the index of folios with money on them.
// With ?reservation=<id>: every folio window of the stay, its ledger (nothing is ever deleted —
// corrections are reversal/refund lines), the guarantee shown apart from money received,
// documents with their credit notes, and exceptions that need someone's attention.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Plus, FileText } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance } from '../../utils/api';
import { useChargeCodes } from '../../hooks/useChargeCodes';
import {
  LINE_TYPE_LABELS, LINE_DEPARTMENT_LABELS, GUARANTEE_LABELS, SETTLEMENT_LABELS,
} from '../../lib/labels';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Toolbar, Card, Tiles, Segmented, SearchBox, DataTable, Tag, Pill, Empty, RowMenu, Banner, ConfirmDialog, Pager, KeyValues,
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

const amountClass = (n) => (n > 0.005 ? 'is-due' : n < -0.005 ? 'is-credit' : 'is-zero');
const signed = (n) => (Math.abs(n) < 0.005 ? money(0) : money(n));

function FolioIndex({ propertyId, url, onOpen }) {
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.folios(propertyId, { view: url.get('view'), q: url.get('q') || undefined, page: url.get('page') }) : null), [propertyId, url.key]);
  const c = data?.counts || {};
  const columns = [
    {
      key: 'guest', label: 'אורח', render: (r) => (
        <div>
          <button type="button" className="ui-guest-name" onClick={() => onOpen(r)}>{r.guest}</button>
          <div className="ui-sub"><bdi>{r.confirmationNumber}</bdi>{r.reservationStatus ? ` · ${RES_STATUS[r.reservationStatus] || r.reservationStatus}` : ''}</div>
        </div>
      ),
    },
    { key: 'room', label: 'חדר', nowrap: true, render: (r) => <span className="ui-num">{r.room || '—'}</span> },
    { key: 'stay', label: 'שהייה', nowrap: true, render: (r) => (r.arrivalDate ? <span className="ui-num">{formatShort(r.arrivalDate)} – {formatShort(r.departureDate)}</span> : '—') },
    { key: 'owner', label: 'חלון', nowrap: true, render: (r) => r.owner },
    { key: 'bal', label: 'יתרה', nowrap: true, align: 'left', render: (r) => <span className={`ui-amount ${amountClass(r.balance)}`}>{r.balance < -0.005 ? `${money(Math.abs(r.balance))} זכות` : money(r.balance)}</span> },
    { key: 'st', label: 'מצב', nowrap: true, render: (r) => (r.settlement ? <Tag tone="warn">{SETTLEMENT_LABELS[r.settlement]}</Tag> : r.status === 'closed' ? <Tag>סגור</Tag> : <span className="ui-sub">פתוח</span>) },
  ];
  return (
    <>
      <Toolbar start={<SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם אורח, טלפון או מספר אישור" id="fol-q" />} />
      <Tiles
        label="סינון חשבונות"
        selected={url.get('view')}
        onSelect={(v) => url.set({ view: v })}
        items={[
          { id: 'open', label: 'חשבונות פתוחים', value: data ? c.open : undefined },
          { id: 'balance', label: 'ביתרת חובה', value: data ? c.owed : undefined, tone: c.owed ? 'warn' : undefined },
          { id: 'credit', label: 'ביתרת זכות', value: data ? c.credit : undefined, tone: c.credit ? 'bad' : undefined },
          { id: 'closed', label: 'סגורים', value: undefined },
          { id: 'sum', label: 'סה״כ חוב פתוח', value: data && url.get('view') !== 'closed' ? money(c.openBalance, 'ILS', 0) : undefined, static: true },
        ]}
      />
      <Card flush>
        <DataTable caption="חשבונות אורח" columns={columns} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} filtered={!!url.get('q')} onRowClick={onOpen} empty={<Empty title="אין חשבונות בתצוגה זו" />} />
      </Card>
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
  const canClose = WORK_ROLES.includes(role) && folio && folio.status !== 'closed' && Math.abs(folio.balance) < 0.005
    && ['checked_out', 'cancelled', 'no_show'].includes(data?.reservation?.status);
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

  const columns = [
    { key: 'date', label: 'תאריך שירות', nowrap: true, render: (l) => <div><div className="ui-num">{formatShort(l.serviceDate)}</div><div className="ui-sub">{formatDateTime(l.postedAt)}</div></div> },
    {
      key: 'desc', label: 'תיאור', render: (l) => (
        <div>
          <div>{l.description}</div>
          <div className="ui-sub">
            {LINE_TYPE_LABELS[l.type] || l.type}{l.department ? ` · ${codeName(l.department)}` : ''}
            {l.reason && l.type !== 'refund' && ` · ${l.reason}`}
          </div>
        </div>
      ),
    },
    {
      key: 'tags', label: 'סימונים', render: (l) => (
        <div className="ui-row" style={{ gap: 4 }}>
          {l.reversed && <Tag>הופך</Tag>}
          {l.reversalOf && <Tag>היפוך</Tag>}
          {l.onDocument && <Tag tone="warn">בחשבונית {l.onDocument}</Tag>}
          {l.onReceipt && <Tag>בקבלה {l.onReceipt}</Tag>}
          {l.refundable !== null && l.refundable < Math.abs(l.gross) - 0.005 && <Tag>{l.refundable > 0.005 ? `הוחזר חלקית` : 'הוחזר'}</Tag>}
          {l.status !== 'posted' && <Tag tone="bad">{l.status}</Tag>}
        </div>
      ),
    },
    { key: 'vat', label: 'מע״מ', nowrap: true, align: 'left', render: (l) => (l.tax ? <span className="ui-num ui-sub">{money(l.tax)}</span> : '') },
    { key: 'amt', label: 'סכום', nowrap: true, align: 'left', render: (l) => <span className={`ui-amount ${l.gross < 0 ? 'is-credit' : ''}`}>{signed(l.gross)}</span> },
    {
      key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (l) => (
        <RowMenu
          label={`פעולות — ${l.description}`}
          items={[
            ['charge', 'fee'].includes(l.type) && !l.reversed && !l.reversalOf && l.status === 'posted' && {
              label: 'היפוך חיוב', disabled: !canReverse || !!l.onDocument || folio.status === 'closed',
              why: l.onDocument ? `במסמך ${l.onDocument} — תיקון במסמך זיכוי` : folio.status === 'closed' ? 'החשבון סגור' : 'למנהל או לכספים', danger: true,
              onSelect: () => setDialog({ kind: 'reverse', line: l }),
            },
            ['payment', 'deposit'].includes(l.type) && l.status === 'posted' && {
              label: 'החזר מתשלום זה', disabled: !(l.refundable > 0.005) || !(folio.balance < -0.005),
              why: !(l.refundable > 0.005) ? 'הוחזר במלואו' : 'אין יתרת זכות בחשבון',
              onSelect: () => setDialog({ kind: 'refund', line: l }),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <ToastContainer toasts={toasts} />
      <Toolbar
        start={(
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => url.set({ reservation: null, folio: null })}><ArrowRight size={14} /> כל החשבונות</button>
            <span className="ui-date-label">{r.guest} · <bdi>{r.confirmationNumber}</bdi></span>
            <Tag>{RES_STATUS[r.status] || r.status}</Tag>
          </>
        )}
        end={<button type="button" className="btn btn-secondary btn-sm" onClick={() => nav(`/pms/reservations/${r.id}`)}>תיק ההזמנה</button>}
      />
      {data.exceptions.map((x) => <Banner key={`${x.code}-${x.folioId}`} tone="warn">{x.label}</Banner>)}
      <ErrorBanner error={closeAct.error} />
      <div className="ui-split">
        <div className="ui-stack">
          {data.folios.length > 1 && (
            <Segmented
              label="חלונות חשבון"
              value={folio?.id}
              onChange={(id) => url.set({ folio: id }, { resetPage: false })}
              options={data.folios.map((f) => ({ value: f.id, label: `${f.owner}${f.status === 'closed' ? ' (סגור)' : ''}`, count: money(f.balance, f.currency, 0) }))}
            />
          )}
          {!folio && <Card><Empty title="אין חשבון להזמנה זו">חשבון נפתח אוטומטית עם החיוב או התשלום הראשון בכניסה.</Empty></Card>}
          {folio && (
            <Card
              flush
              title={`חשבון ${folio.owner}${folio.status === 'closed' ? ' · סגור' : ''}`}
              actions={(canWork || canClose) && (
                <>
                  {canCharge && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'charge' })}><Plus size={14} /> חיוב</button>}
                  {canWork && departed && <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav(`/pms/reservations/${r.id}`)} title="חיוב אחרי יציאה נרשם מתיק ההזמנה (מנהל, עם סיבה)">חיוב אחרי יציאה…</button>}
                  {canWork && (!departed || folio.balance > 0.005) && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'pay' })}>תשלום</button>}
                  {canClose && <button type="button" className="btn btn-secondary btn-sm" disabled={closeAct.busy} onClick={async () => { const out = await closeAct.run(() => finance.closeFolio(propertyId, folio.id)); if (out) { success('החשבון נסגר'); reload(); } }}>סגירת חשבון</button>}
                </>
              )}
            >
              <DataTable caption="תנועות בחשבון" columns={columns} rows={folio.lines} rowClass={(l) => (l.reversed || l.reversalOf ? 'is-done' : '')} empty={<Empty title="אין תנועות בחשבון" />} />
            </Card>
          )}
        </div>
        <div className="ui-stack">
          {folio && (
            <Card title="סיכום">
              <KeyValues rows={[
                ['חיובים', money(folio.totals.charges)],
                folio.totals.adjustments ? ['תיקונים', money(folio.totals.adjustments)] : null,
                ['תשלומים ומקדמות', money(folio.totals.payments)],
                folio.totals.refunds ? ['החזרים', money(folio.totals.refunds)] : null,
                ['יתרה', <span key="b" className={`ui-amount ${amountClass(folio.balance)}`}>{folio.balance < -0.005 ? `${money(Math.abs(folio.balance))} זכות` : money(folio.balance)}</span>],
                folio.settlement && ['סגירה ביציאה', `${SETTLEMENT_LABELS[folio.settlement.mode]}${folio.settlement.by ? ` · ${folio.settlement.by}` : ''}`],
              ]} />
            </Card>
          )}
          <Card title="שהייה וערבות">
            <KeyValues rows={[
              ['חדר', r.room || '—'],
              ['תאריכים', `${formatShort(r.arrivalDate)} – ${formatShort(r.departureDate)} · ${r.nights || 0} לילות`],
              r.company && ['חברה', r.company.name],
              ['ערבות', data.guarantee.type === 'none' ? 'ללא' : GUARANTEE_LABELS[data.guarantee.type] || data.guarantee.type],
            ]} />
            <div className="ui-sub">ערבות אינה תשלום ואינה נכללת ביתרה.</div>
          </Card>
          <Card
            title="מסמכים"
            actions={folio && WORK_ROLES.includes(role) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'issue' })}><FileText size={14} /> הפקת מסמך</button>}
          >
            <ErrorBanner error={docErr} />
            {docsHere.length === 0 && <div className="ui-sub">טרם הופקו מסמכים לחשבון זה. חשבונית מס / קבלה מופקות מהחיובים והתקבולים שבחשבון.</div>}
            <DocumentList
              docs={docsHere}
              propertyId={propertyId}
              canCredit={canCredit}
              onCredit={(d) => setDialog({ kind: 'credit', doc: d })}
              onAllocate={(d) => setDialog({ kind: 'alloc', doc: d })}
              onError={setDocErr}
              onChanged={() => { success('המסמך נשלח'); reload(); }}
            />
          </Card>
        </div>
      </div>

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
    <Page wide>
      {reservationId
        ? <StayFolios propertyId={propertyId} reservationId={reservationId} folioParam={url.params.get('folio')} url={url} role={role} />
        : <FolioIndex propertyId={propertyId} url={url} onOpen={(row) => url.set({ reservation: row.reservationId, folio: row.id }, { resetPage: false })} />}
    </Page>
  );
}
