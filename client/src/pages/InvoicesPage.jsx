// FIN-06 / FIN-10 — every fiscal document of the property and the allocation-number centre.
// Documents are issued from the guest folio (stay dialog, folio, check-out); here they are found,
// printed (first print = original, later = copy) and completed with the Tax Authority allocation
// number when "Israel invoices" requires one.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Send } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useAuthStore } from '../stores/authStore';
import { finance } from '../utils/api';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import { DOC_TYPE_LABELS, ALLOCATION_LABELS } from '../lib/labels';
import { formatShort } from '../utils/date';
import {
  Page, Toolbar, Card, Tiles, SearchBox, DataTable, Tag, Empty, Banner, Pager, ErrorBanner, useUrlState, useLoader, money,
} from '../components/kit';
import { AllocationDialog, SendDocumentDialog, ALLOCATION_ROLES, openPrint } from '../components/fin/DocumentDialogs';

const DEFAULTS = { view: 'all', q: '', type: '', page: '1' };
const TYPES = ['', 'tax_invoice_receipt', 'tax_invoice', 'receipt', 'credit_note', 'proforma'];

export default function InvoicesPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const nav = useNavigate();
  const url = useUrlState(DEFAULTS);
  const { toasts, success } = useToast();
  const [alloc, setAlloc] = useState(null);
  const [sending, setSending] = useState(null);
  const [err, setErr] = useState(null);
  const canAllocate = ALLOCATION_ROLES.includes(role);
  const { data, loading, error, reload } = useLoader(
    async () => (propertyId ? finance.documents(propertyId, { view: url.get('view'), q: url.get('q') || undefined, type: url.get('type') || undefined, page: url.get('page') }) : null),
    [propertyId, url.key],
  );
  const c = data?.counts || {};

  const columns = [
    {
      key: 'doc', label: 'מסמך', render: (d) => (
        <div>
          <div className="font-medium">{DOC_TYPE_LABELS[d.type] || d.type} <bdi>{d.number}</bdi></div>
          <div className="ui-sub">{formatShort(d.issueDate)}{d.confirmationNumber ? <> · <bdi>{d.confirmationNumber}</bdi></> : ''}</div>
        </div>
      ),
    },
    { key: 'buyer', label: 'נמען', render: (d) => <div><div>{d.buyer?.name || '—'}</div>{d.buyer?.vatNumber && <div className="ui-sub ui-num">ע.מ. {d.buyer.vatNumber}</div>}</div> },
    { key: 'net', label: 'לפני מע״מ', nowrap: true, align: 'left', render: (d) => (d.type === 'receipt' ? <span className="ui-sub">—</span> : <span className="ui-num">{money(d.net)}</span>) },
    { key: 'gross', label: 'סכום', nowrap: true, align: 'left', render: (d) => <span className="ui-amount">{money(d.type === 'receipt' ? d.paid : d.gross)}</span> },
    {
      key: 'alloc', label: 'מספר הקצאה', render: (d) => {
        const a = d.allocation?.status;
        if (d.issuer === 'invoicer' && a !== 'approved') return <span className="ui-sub">במערכת החשבוניות</span>;
        if (a === 'approved') return <span className="ui-num">{d.allocation.number}</span>;
        if (a === 'pending') return <Tag tone="warn">{ALLOCATION_LABELS.pending}</Tag>;
        if (a === 'rejected') {
          const dec = { continue: 'הופקה בלי מספר', hearing: 'בשימוע', cancel: 'לביטול במסמך זיכוי' }[d.allocation.decision];
          return <span><Tag tone={dec ? 'warn' : 'bad'}>{dec || `${ALLOCATION_LABELS.rejected} — נדרשת החלטה`}</Tag>{d.allocation.rejectReason && <div className="ui-sub">{d.allocation.rejectReason}</div>}</span>;
        }
        if (a === 'pending' && d.allocation.lastError) return <span><Tag tone="warn">{ALLOCATION_LABELS.pending}</Tag><div className="ui-sub">{d.allocation.lastError}</div></span>;
        return <span className="ui-sub">לא נדרש</span>;
      },
    },
    {
      key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (d) => (
        <div className="doc-acts">
          <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openPrint(propertyId, d.id, setErr); }}><Printer size={14} />{d.printed ? 'העתק' : 'הדפסה'}</button>
          {d.issuer !== 'invoicer' && <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setSending(d); }}><Send size={14} />שליחה</button>}
          {d.issuer !== 'invoicer' && ['pending', 'rejected'].includes(d.allocation?.status) && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={!canAllocate} title={canAllocate ? undefined : 'כספים או הנהלה'} onClick={(e) => { e.stopPropagation(); setAlloc(d); }}>מספר הקצאה</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <Toolbar
        start={<SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="מספר מסמך, נמען, ע.מ., מספר הזמנה או הקצאה" id="doc-q" />}
        end={(
          <select className="select" aria-label="סוג מסמך" value={url.get('type')} onChange={(e) => url.set({ type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{t ? DOC_TYPE_LABELS[t] : 'כל הסוגים'}</option>)}
          </select>
        )}
      />
      <Tiles
        label="תצוגת מסמכים"
        selected={url.get('view')}
        onSelect={(v) => url.set({ view: v })}
        items={[
          { id: 'all', label: 'כל המסמכים', value: data && url.get('view') === 'all' ? data.total : undefined },
          { id: 'pending', label: 'ממתינים למספר הקצאה', value: data ? c.pending : undefined, tone: c.pending ? 'warn' : undefined },
          { id: 'rejected', label: 'הקצאה סורבה', value: data ? c.rejected : undefined, tone: c.rejected ? 'bad' : undefined },
        ]}
      />
      {c.pending > 0 && url.get('view') !== 'pending' && (
        <Banner tone="warn">{c.pending} חשבוניות לעוסקים מעל הסף ממתינות למספר הקצאה מרשות המסים — עד שיוזן המספר הלקוח לא יכול לנכות מהן מע״מ.</Banner>
      )}
      <ErrorBanner error={err} />
      <Card flush>
        <DataTable
          caption="מסמכים"
          columns={columns}
          rows={data?.rows}
          loading={loading && !data}
          error={error}
          onRetry={reload}
          filtered={!!url.get('q') || !!url.get('type') || url.get('view') !== 'all'}
          onRowClick={(d) => d.reservationId && nav(`/pms/folio?reservation=${d.reservationId}${d.folioId ? `&folio=${d.folioId}` : ''}`)}
          empty={<Empty title={url.get('view') === 'pending' ? 'אין מסמכים שממתינים למספר הקצאה' : 'אין מסמכים בתצוגה זו'}>מסמכים מופקים מחשבון האורח — בחלון ההזמנה, בחשבון או ביציאה.</Empty>}
        />
      </Card>
      {data && data.pages > 1 && <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => url.set({ page: p }, { resetPage: false })} unit="מסמכים" />}
      <SendDocumentDialog open={!!sending} onClose={() => setSending(null)} propertyId={propertyId} doc={sending} onSent={() => { setSending(null); success('המסמך נשלח'); reload(); }} />
      <AllocationDialog open={!!alloc} onClose={() => setAlloc(null)} propertyId={propertyId} doc={alloc} onSaved={() => { setAlloc(null); success('מספר ההקצאה נשמר'); reload(); }} />
    </Page>
  );
}
