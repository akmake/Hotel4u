// NR folio — accounts for people who do not stay (restaurant, spa, bar, a visitor's purchase).
// Index of open/closed accounts, "new account", and one account's ledger with charge / payment /
// refund / reversal / document / close — the same money core as a guest folio.
import { useEffect, useState } from 'react';
import { Plus, FileText, CreditCard, Undo2, ShoppingBag, Tag as TagIcon, Phone, Mail } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance, companies as companiesApi } from '../../utils/api';
import { useChargeCodes } from '../../hooks/useChargeCodes';
import { LINE_TYPE_LABELS, LINE_DEPARTMENT_LABELS } from '../../lib/labels';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, BackArrow, Card, Segmented, SearchBox, DataTable, Empty, ConfirmDialog, Modal, Field,
  ErrorBanner, Spinner, useUrlState, useLoader, useAction, money, formatDateTime,
} from '../../components/kit';
import { ChargeDialog, PaymentDialog, RefundDialog, CreditNoteDialog } from '../../components/fin/FinanceDialogs';
import { IssueDocumentDialog, AllocationDialog, DocumentList } from '../../components/fin/DocumentDialogs';

const EPS = 0.005;
const WORK_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'finance_manager', 'cashier'];
const REVERSE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'finance_manager'];
const CREDIT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const OUTLETS = { restaurant: 'מסעדה', bar: 'בר', spa: 'ספא', events: 'אירועים', shop: 'חנות', other: 'אחר' };
const DEFAULTS = { view: 'open', q: '', account: '' };

function NewAccountDialog({ open, onClose, propertyId, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const [cos, setCos] = useState([]);
  useEffect(() => {
    if (!open) return;
    setF({ name: '', phone: '', email: '', outlet: 'restaurant', companyId: '', taxId: '', note: '' }); act.reset();
    companiesApi.list(propertyId, { limit: 200 }).then((r) => setCos(Array.isArray(r) ? r : r?.companies || [])).catch(() => setCos([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (ev) => setF((p) => ({ ...p, [k]: ev.target.value }));
  const why = (f.name || '').trim().length < 2 ? 'נדרש שם' : null;
  const e = act.fields;
  const submit = () => act.run(async () => {
    const out = await finance.openHouseAccount(propertyId, { ...f, companyId: f.companyId || undefined });
    onSaved?.(out);
  });
  return (
    <Modal
      open={open} onClose={onClose} busy={act.busy} width={540} title="פתיחת חשבון מזדמן" subtitle="לקוח שלא לן במלון — מסעדה, ספא, בר, אירוע או רכישה"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button>
          <button type="submit" form="nr-form" className="btn btn-primary" disabled={!!why || act.busy} title={why || undefined}>{act.busy ? <Spinner /> : 'פתיחת חשבון'}</button>
        </>
      )}
    >
      <form id="nr-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="nr-name" label="שם" required error={e.name}><input id="nr-name" className="input w-full" maxLength={120} value={f.name || ''} onChange={set('name')} autoFocus /></Field>
          <Field id="nr-outlet" label="נקודת מכירה" required>
            <select id="nr-outlet" className="select w-full" value={f.outlet} onChange={set('outlet')}>{Object.entries(OUTLETS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
          <Field id="nr-phone" label="טלפון" optional error={e.phone}><input id="nr-phone" dir="ltr" className="input w-full" maxLength={30} value={f.phone || ''} onChange={set('phone')} /></Field>
          <Field id="nr-email" label="דוא״ל" optional error={e.email}><input id="nr-email" dir="ltr" type="email" className="input w-full" maxLength={120} value={f.email || ''} onChange={set('email')} /></Field>
          <Field id="nr-co" label="חברה משלמת" optional error={e.companyId} hint="המסמך יוצע על שם החברה">
            <select id="nr-co" className="select w-full" value={f.companyId} onChange={set('companyId')}>
              <option value="">— ללא —</option>
              {(Array.isArray(cos) ? cos : []).map((c) => <option key={c._id || c.id} value={c._id || c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field id="nr-tax" label="ת״ז / ח״פ" optional><input id="nr-tax" dir="ltr" inputMode="numeric" className="input w-full" maxLength={9} value={f.taxId || ''} onChange={set('taxId')} /></Field>
        </div>
        <Field id="nr-note" label="הערה" optional><input id="nr-note" className="input w-full" maxLength={300} value={f.note || ''} onChange={set('note')} /></Field>
      </form>
    </Modal>
  );
}

function AccountIndex({ propertyId, url, canWork, onOpen }) {
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.houseAccounts(propertyId, { view: url.get('view'), q: url.get('q') || undefined }) : null), [propertyId, url.key]);
  const c = data?.counts || {};
  const columns = [
    { key: 'num', label: 'מספר', nowrap: true, render: (r) => <bdi className="ui-num">{r.number}</bdi> },
    { key: 'name', label: 'לקוח', render: (r) => (<div><button type="button" className="ui-guest-name" onClick={() => onOpen(r)}>{r.name}</button>{r.phone && <div className="ui-sub" dir="ltr">{r.phone}</div>}</div>) },
    { key: 'outlet', label: 'נקודה', nowrap: true, render: (r) => r.outletLabel },
    { key: 'opened', label: 'נפתח', nowrap: true, render: (r) => <span className="ui-num">{formatDateTime(r.openedAt)}</span> },
    { key: 'money', label: 'תנועות', nowrap: true, render: (r) => <span className="ui-num">חויב {money(r.totals.charges, 'ILS', 0)} · שולם {money(r.totals.payments, 'ILS', 0)}</span> },
    {
      key: 'bal', label: 'יתרה', nowrap: true, align: 'left', render: (r) => (
        <div className="fo-amt">
          <span className={`fo-money ${r.balance > EPS ? 'is-due' : r.balance < -EPS ? 'is-credit' : ''}`}>{money(Math.abs(r.balance))}</span>
          <span className="ui-sub">{r.status === 'closed' ? 'סגור' : r.balance > EPS ? 'לתשלום' : r.balance < -EPS ? 'זכות ללקוח' : 'מאוזן'}</span>
        </div>
      ),
    },
  ];
  return (
    <>
      <PageBar
        title="חשבונות מזדמנים"
        meta={data && url.get('view') !== 'closed' ? `${money(c.openBalance, 'ILS', 0)} לגבייה ב־${c.owed} חשבונות` : undefined}
        back="/pms"
        tools={(
          <>
            <SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם, טלפון או מספר חשבון" id="nr-q" />
            {canWork && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> חשבון חדש</button>}
          </>
        )}
      />
      <Segmented label="סינון" value={url.get('view')} onChange={(v) => url.set({ view: v })} options={[{ value: 'open', label: 'פתוחים', count: data ? c.open : undefined }, { value: 'closed', label: 'סגורים', count: data ? c.closed : undefined }]} />
      <Card flush>
        <DataTable caption="חשבונות מזדמנים" columns={columns} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} onRowClick={onOpen} filtered={!!url.get('q')}
          empty={<Empty title={url.get('view') === 'closed' ? 'אין חשבונות סגורים' : 'אין חשבונות פתוחים'}>חשבון מזדמן נפתח ללקוח שלא לן במלון — ארוחה, ספא, בר או רכישה.</Empty>} />
      </Card>
      <NewAccountDialog open={creating} onClose={() => setCreating(false)} propertyId={propertyId} onSaved={(o) => { setCreating(false); onOpen({ id: o.id }); }} />
    </>
  );
}

function AccountView({ propertyId, id, role }) {
  const { toasts, success } = useToast();
  const [dialog, setDialog] = useState(null);
  const [docErr, setDocErr] = useState(null);
  const closeAct = useAction();
  const { charges: codeList } = useChargeCodes(propertyId);
  const codeName = (k) => codeList.find((c) => c.code === k)?.name || LINE_DEPARTMENT_LABELS[k] || k;
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.houseAccount(propertyId, id) : null), [propertyId, id]);
  if (loading && !data) return <div className="ui-empty"><Spinner /> טוען…</div>;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;
  const a = data.account;
  const folio = data.folio;
  const open = folio.status !== 'closed';
  const canWork = WORK_ROLES.includes(role) && open;
  const isCharge = (l) => ['charge', 'fee', 'tax'].includes(l.type);
  const isPayment = (l) => ['payment', 'deposit'].includes(l.type);
  const posted = folio.lines.filter((l) => l.status === 'posted');
  const unreceipted = posted.filter((l) => isPayment(l) && !l.onReceipt && !l.onDocument).reduce((s, l) => s + Math.abs(l.gross), 0);
  const canClose = canWork && Math.abs(folio.balance) < EPS && posted.length > 0;
  const closeFolio = async () => { const out = await closeAct.run(() => finance.closeFolio(propertyId, folio.id)); if (out) { success('החשבון נסגר'); reload(); } };
  const days = [];
  for (const l of [...folio.lines].reverse()) {
    const d = days.find((x) => x.date === l.serviceDate);
    if (d) d.lines.push(l); else days.push({ date: l.serviceDate, lines: [l] });
  }
  const Icon = (l) => (isPayment(l) ? CreditCard : l.type === 'refund' ? Undo2 : ['adjustment', 'discount'].includes(l.type) ? TagIcon : ShoppingBag);

  return (
    <>
      <ToastContainer toasts={toasts} />
      <header className="fo-panel fo-head">
        <div className="fo-head-who">
          <BackArrow to="/pms/house-accounts" />
          <span className="fo-avatar" aria-hidden="true">{(a.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
          <div className="fo-head-id">
            <h1 className="fo-head-name">{a.name}<bdi className="fo-head-res">{a.number}</bdi></h1>
            <div className="fo-head-contact">
              {a.phone && <a href={`tel:${a.phone}`} dir="ltr"><Phone size={13} aria-hidden="true" />{a.phone}</a>}
              {a.email && <a href={`mailto:${a.email}`} dir="ltr"><Mail size={13} aria-hidden="true" />{a.email}</a>}
              {!a.phone && !a.email && <span>אין פרטי קשר</span>}
            </div>
          </div>
        </div>
        <div className="fo-head-actions">
          {canClose && <button type="button" className="btn btn-secondary" disabled={closeAct.busy} onClick={closeFolio}>סגירת חשבון</button>}
          {WORK_ROLES.includes(role) && <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'issue' })}><FileText size={16} /> הפקת מסמך</button>}
          {canWork && <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'charge' })}><Plus size={16} /> חיוב</button>}
          {canWork && folio.balance > EPS && <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'pay' })}>תשלום</button>}
        </div>
        <div className="fo-head-stay">
          <span className={`fo-status is-${open ? 'in' : 'out'}`}>{open ? 'פתוח' : 'סגור'}</span>
          <dl className="fo-strip-facts">
            <div><dt>נקודה</dt><dd>{a.outletLabel}</dd></div>
            <div><dt>נפתח</dt><dd className="ui-num">{formatDateTime(a.openedAt)}{a.openedBy ? ` · ${a.openedBy}` : ''}</dd></div>
            {a.company && <div><dt>חברה</dt><dd>{a.company.name}</dd></div>}
            {a.taxId && <div><dt>ת״ז / ח״פ</dt><dd className="ui-num">{a.taxId}</dd></div>}
            {a.note && <div><dt>הערה</dt><dd>{a.note}</dd></div>}
          </dl>
        </div>
      </header>
      <ErrorBanner error={closeAct.error} />
      <div className="fo-layout">
        <section className="fo-panel fo-ledger" aria-label="תנועות בחשבון">
          <header className="fo-ledger-h"><h2 className="fo-panel-h">תנועות{open ? '' : ' · סגור'}</h2></header>
          {folio.lines.length === 0 && <Empty title="אין תנועות">התחילו ברישום חיוב — ארוחה, טיפול, משקה או מוצר.</Empty>}
          {days.map((d) => (
            <div key={d.date} className="fo-day">
              <div className="fo-day-h"><span>{formatShort(d.date)}</span><span>{d.lines.length === 1 ? 'תנועה אחת' : `${d.lines.length} תנועות`}</span></div>
              <ul className="fo-lines">
                {d.lines.map((l) => {
                  const canRev = isCharge(l) && l.type !== 'tax' && !l.reversed && !l.reversalOf && l.status === 'posted' && REVERSE_ROLES.includes(role) && !l.onDocument && open;
                  const canRef = isPayment(l) && l.status === 'posted' && l.refundable > EPS && folio.balance < -EPS;
                  const I = Icon(l);
                  return (
                    <li key={l.id} className={`fo-line ${l.reversed || l.reversalOf ? 'is-done' : ''}`}>
                      <span className={`fo-ico ${isPayment(l) ? 'is-pay' : ''}`}><I size={15} aria-hidden="true" /></span>
                      <div className="fo-line-main">
                        <div className="fo-line-t">{l.description}</div>
                        <div className="fo-line-meta">
                          <span>{LINE_TYPE_LABELS[l.type] || l.type}{l.department ? ` · ${codeName(l.department)}` : ''}</span>
                          <span className="ui-num">{formatDateTime(l.postedAt)}</span>
                          {l.onDocument && <span className="fo-doc">חשבונית {l.onDocument}</span>}
                          {l.onReceipt && <span className="fo-doc">קבלה {l.onReceipt}</span>}
                          {l.reversed && <span className="fo-doc is-none">בוטל בהיפוך</span>}
                        </div>
                      </div>
                      {(canRev || canRef) && <button type="button" className="fo-line-act" onClick={() => setDialog(canRev ? { kind: 'reverse', line: l } : { kind: 'refund', line: l })}>{canRev ? 'היפוך' : 'החזר'}</button>}
                      <div className="fo-line-amt"><span className={`ui-num ${l.gross < 0 ? 'is-credit' : ''}`}>{l.gross < 0 ? `−${money(Math.abs(l.gross))}` : money(l.gross)}</span></div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
        <aside className="fo-col">
          <section className="fo-panel fo-stmt" aria-label="סיכום">
            <h3 className="fo-panel-h">סיכום</h3>
            <dl className="fo-kv">
              <div className="is-total"><dt>חיובים</dt><dd className="ui-num">{money(folio.totals.charges + folio.totals.adjustments)}</dd></div>
              <div><dt>תשלומים</dt><dd className="ui-num is-credit">−{money(folio.totals.payments)}</dd></div>
              {folio.totals.refunds ? <div><dt>החזרים</dt><dd className="ui-num">{money(folio.totals.refunds)}</dd></div> : null}
            </dl>
            <div className={`fo-due ${folio.balance > EPS ? 'is-due' : folio.balance < -EPS ? 'is-credit' : ''}`}>
              <span>{folio.balance > EPS ? 'יתרה לתשלום' : folio.balance < -EPS ? 'זכות ללקוח' : 'יתרה'}</span>
              <b className="ui-num">{money(Math.abs(folio.balance))}</b>
            </div>
            {open && Math.abs(folio.balance) < EPS && posted.length > 0 && <p className="ui-sub">{unreceipted > EPS ? `התקבלו ${money(unreceipted)} בלי קבלה — הפיקו מסמך לפני הסגירה` : 'החשבון מאוזן — אפשר לסגור'}</p>}
          </section>
          <section className="fo-panel" aria-label="מסמכים">
            <h3 className="fo-panel-h">מסמכים <span className="ui-sub">{data.documents.length || ''}</span></h3>
            <ErrorBanner error={docErr} />
            <DocumentList docs={data.documents} propertyId={propertyId} canCredit={CREDIT_ROLES.includes(role)} onCredit={(d) => setDialog({ kind: 'credit', doc: d })} onAllocate={(d) => setDialog({ kind: 'alloc', doc: d })} onError={setDocErr} onChanged={() => { success('המסמך נשלח'); reload(); }} />
          </section>
        </aside>
      </div>

      <ChargeDialog open={dialog?.kind === 'charge'} onClose={() => setDialog(null)} propertyId={propertyId} folio={folio} vatRate={data.vatRate} businessDate={data.businessDate} onSaved={() => { setDialog(null); success('החיוב נרשם'); reload(); }} />
      <PaymentDialog noDeposit open={dialog?.kind === 'pay'} onClose={() => setDialog(null)} propertyId={propertyId} folio={folio} onSaved={(o) => { setDialog(null); success(o?.change ? `התשלום נרשם · עודף ${money(o.change)}` : 'התשלום נרשם'); reload(); }} />
      <RefundDialog open={dialog?.kind === 'refund'} onClose={() => setDialog(null)} propertyId={propertyId} folio={folio} payment={dialog?.line} canApprove={REVERSE_ROLES.includes(role)} threshold={data.policy.refundApprovalOver} onSaved={() => { setDialog(null); success('ההחזר נרשם'); reload(); }} />
      <IssueDocumentDialog open={dialog?.kind === 'issue'} onClose={() => setDialog(null)} propertyId={propertyId} folioId={folio.id} subtitle={`${a.name} · ${a.number}`} onIssued={() => reload()} />
      <AllocationDialog open={dialog?.kind === 'alloc'} onClose={() => setDialog(null)} propertyId={propertyId} doc={dialog?.doc} onSaved={() => { setDialog(null); reload(); }} />
      <CreditNoteDialog open={dialog?.kind === 'credit'} onClose={() => setDialog(null)} propertyId={propertyId} doc={dialog?.doc} onSaved={() => { setDialog(null); reload(); }} />
      <ConfirmDialog open={dialog?.kind === 'reverse'} onClose={() => setDialog(null)} title="היפוך חיוב" subtitle={dialog?.line ? `${dialog.line.description} · ${money(dialog.line.gross)}` : ''} confirmLabel="רישום היפוך" danger requireReason
        onConfirm={async (reason) => { await finance.reverse(propertyId, folio.id, dialog.line.id, reason); setDialog(null); success('החיוב הופך'); reload(); }}>
        <p className="ui-p">נרשמת שורה נגדית מקושרת. החיוב המקורי נשאר בחשבון לתיעוד.</p>
      </ConfirmDialog>
    </>
  );
}

export default function HouseAccountsPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState(DEFAULTS);
  const id = url.get('account');
  return (
    <Page wide approved>
      {id
        ? <AccountView propertyId={propertyId} id={id} role={role} />
        : <AccountIndex propertyId={propertyId} url={url} canWork={WORK_ROLES.includes(role)} onOpen={(r) => url.set({ account: r.id }, { resetPage: false })} />}
    </Page>
  );
}
