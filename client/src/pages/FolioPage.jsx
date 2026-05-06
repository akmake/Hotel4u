import { useState, useCallback } from 'react';
import { Search, CreditCard, Plus, Slash, Receipt, AlertCircle, CheckCircle2, Lock, Unlock, FileText, Tag, MinusCircle, ArrowLeftRight, ReceiptText, X, Printer, Download, Banknote, Building2, Ticket, Wallet } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { reservations as resApi, folio as folioApi, invoices as invApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const INVOICE_TYPES = [
  { key:'tax_invoice_receipt', label:'חשבונית מס/קבלה' },
  { key:'tax_invoice',         label:'חשבונית מס' },
  { key:'receipt',             label:'קבלה בלבד' },
];

function IssueInvoicePanel({ folioId, balance, propertyId, onClose, onIssued }) {
  const [type,      setType]      = useState('tax_invoice_receipt');
  const [buyerName, setBuyerName] = useState('');
  const [buyerVat,  setBuyerVat]  = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const inv = await invApi.issueFromFolio(folioId, {
        type,
        buyer: buyerName ? { name: buyerName, vatNumber: buyerVat || undefined } : undefined,
        propertyId,
      });
      onIssued(inv);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background:'rgba(0,0,0,0.55)', direction:'rtl' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="font-bold text-ink flex items-center gap-2"><ReceiptText size={15}/> הפקת חשבונית</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={15}/></button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1.5">סוג מסמך</label>
            <div className="flex flex-col gap-1.5">
              {INVOICE_TYPES.map(({key, label}) => (
                <label key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all
                  ${type === key ? 'border-brand bg-brand/5' : 'border-surface-border hover:border-brand/30'}`}>
                  <input type="radio" name="invType" checked={type === key} onChange={() => setType(key)} className="hidden"/>
                  <div className={`w-3 h-3 rounded-full border-2 ${type === key ? 'border-brand bg-brand' : 'border-ink-faint'}`}/>
                  <span className="text-sm text-ink">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">שם רוכש (B2B — אופציונלי)</label>
            <input className="input w-full text-sm" placeholder="חברה / אורח" value={buyerName} onChange={e => setBuyerName(e.target.value)}/>
          </div>
          {buyerName && (
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">מס' ע.מ./ח.פ. של הרוכש</label>
              <input className="input w-full text-num" placeholder="xxxxxxxxx" value={buyerVat} onChange={e => setBuyerVat(e.target.value)}/>
            </div>
          )}
          <div className="text-xs text-ink-muted bg-surface-hover rounded-lg px-3 py-2">
            סה"כ לחשבונית: <span className="font-bold text-ink">₪{(balance||0).toFixed(2)}</span>
          </div>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm flex-1" onClick={onClose}>ביטול</button>
            <button type="submit" disabled={loading} className="btn btn-primary btn-sm flex-1 justify-center gap-1.5">
              {loading && <Spinner size={12}/>} הפק
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Folio line type colors ────────────────────────────────────────────────────
const LINE_CONFIG = {
  charge:     { label:'חיוב',    color:'#dc2626', bg:'rgba(239,68,68,0.08)' },
  payment:    { label:'תשלום',   color:'#059669', bg:'rgba(16,185,129,0.08)' },
  void:       { label:'ביטול',   color:'#94a3b8', bg:'rgba(148,163,184,0.08)' },
  tax:        { label:'מס',      color:'#d97706', bg:'rgba(245,158,11,0.08)' },
  deposit:    { label:'מקדמה',   color:'#6366f1', bg:'rgba(99,102,241,0.08)' },
  discount:   { label:'הנחה',    color:'#8b5cf6', bg:'rgba(139,92,246,0.08)' },
  adjustment: { label:'תיקון',   color:'#0ea5e9', bg:'rgba(14,165,233,0.08)' },
  refund:     { label:'החזר',    color:'#f59e0b', bg:'rgba(245,158,11,0.08)' },
};

const DEPT_LABELS = {
  room:'לינה', fb:'מזון ומשקאות', spa:'ספא', parking:'חניה',
  laundry:'כביסה', minibar:'מיניבר', extras:'נוספות', tax:'מס',
};

function AddChargePanel({ folioId, propertyId, onDone }) {
  const [desc,   setDesc]   = useState('');
  const [amount, setAmount] = useState('');
  const [dept,   setDept]   = useState('extras');
  const [loading,setLoading]= useState(false);
  const [error,  setError]  = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await folioApi.charge(folioId, { description: desc, amount: Number(amount), department: dept, propertyId });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="bg-surface-hover rounded-xl p-4 flex flex-col gap-3 border border-surface-border">
      <div className="text-xs font-bold text-ink mb-0.5">הוסף חיוב</div>
      <div className="grid grid-cols-2 gap-2">
        <input className="input text-sm col-span-2" placeholder="תיאור *" value={desc} onChange={e=>setDesc(e.target.value)} required />
        <input className="input text-num" type="number" placeholder="סכום ₪ *" min={0} step={0.01} value={amount} onChange={e=>setAmount(e.target.value)} required />
        <select className="select" value={dept} onChange={e=>setDept(e.target.value)}>
          {Object.entries(DEPT_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm flex-1 justify-center" disabled={loading}>
          {loading ? '...' : 'חייב'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}

const PAY_METHODS = [
  { value: 'cash',          label: 'מזומן',    Icon: Banknote    },
  { value: 'credit',        label: 'אשראי',    Icon: CreditCard  },
  { value: 'check',         label: 'המחאה',    Icon: FileText    },
  { value: 'bank_transfer', label: 'העברה',    Icon: Building2   },
  { value: 'voucher',       label: 'שובר',     Icon: Ticket      },
  { value: 'other',         label: 'אחר',      Icon: Wallet      },
];

function AddPaymentPanel({ folioId, propertyId, balance, onDone }) {
  const [amount,  setAmount]  = useState(balance > 0 ? String(balance.toFixed(2)) : '');
  const [method,  setMethod]  = useState('cash');
  const [ref,     setRef]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const description = PAY_METHODS.find(m => m.value === method)?.label || method;
      await folioApi.payment(folioId, {
        amount: Number(amount),
        method,
        description: ref ? `${description} — אסמכתא: ${ref}` : description,
        propertyId,
      });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="bg-surface-hover rounded-xl p-4 flex flex-col gap-3 border border-surface-border">
      <div className="text-xs font-bold text-ink mb-0.5">רשום תשלום</div>

      {/* Method selector */}
      <div>
        <div className="text-xs text-ink-muted mb-1.5">אמצעי תשלום</div>
        <div className="flex flex-wrap gap-1.5">
          {PAY_METHODS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMethod(value)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                method === value
                  ? 'bg-brand text-white border-brand shadow-sm'
                  : 'bg-white text-ink-secondary border-surface-border hover:border-brand/40'
              }`}
            >
              <Icon size={11} />{label}
            </button>
          ))}
        </div>
      </div>

      {/* Amount + reference */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-xs text-ink-muted mb-1">סכום ₪ *</div>
          <input
            className="input text-num w-full"
            type="number" placeholder="0.00" min={0} step={0.01}
            value={amount} onChange={e => setAmount(e.target.value)} required
          />
        </div>
        <div>
          <div className="text-xs text-ink-muted mb-1">אסמכתא / מס' כרטיס (4 ספרות)</div>
          <input
            className="input text-sm w-full"
            placeholder={method === 'credit' ? '···· 1234' : 'אופציונלי'}
            value={ref} onChange={e => setRef(e.target.value)}
            maxLength={20}
          />
        </div>
      </div>

      {balance > 0 && Number(amount) < balance && (
        <div className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1">
          תשלום חלקי — נשאר: ₪{(balance - Number(amount || 0)).toFixed(2)}
        </div>
      )}

      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm flex-1 justify-center gap-1.5" disabled={loading}>
          {loading && <span className="animate-spin">⏳</span>} רשום תשלום
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}

function AddDiscountPanel({ folioId, propertyId, onDone }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading,setLoading]= useState(false);
  const [error,  setError]  = useState('');

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      await folioApi.discount(folioId, { amount: Number(amount), reason, propertyId });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="bg-surface-hover rounded-xl p-4 flex flex-col gap-3 border border-surface-border">
      <div className="text-xs font-bold text-ink mb-0.5">הוסף הנחה</div>
      <div className="grid grid-cols-2 gap-2">
        <input className="input text-num" type="number" placeholder="סכום הנחה ₪ *" min={0} step={0.01} value={amount} onChange={e=>setAmount(e.target.value)} required />
        <input className="input text-sm" placeholder="סיבה *" value={reason} onChange={e=>setReason(e.target.value)} required />
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm flex-1 justify-center" style={{background:'rgba(139,92,246,0.1)',color:'#7c3aed',border:'1px solid rgba(139,92,246,0.3)'}} disabled={loading}>
          {loading ? '...' : 'החל הנחה'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}

function AddAdjustmentPanel({ folioId, propertyId, onDone }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading,setLoading]= useState(false);
  const [error,  setError]  = useState('');

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      await folioApi.adjustment(folioId, { amount: Number(amount), reason, propertyId });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="bg-surface-hover rounded-xl p-4 flex flex-col gap-3 border border-surface-border">
      <div className="text-xs font-bold text-ink mb-0.5">תיקון / Adjustment</div>
      <div className="text-xs text-ink-muted mb-1">חיובי = הוספת חיוב, שלילי = הפחתה</div>
      <div className="grid grid-cols-2 gap-2">
        <input className="input text-num" type="number" placeholder="סכום ₪ (± מותר) *" step={0.01} value={amount} onChange={e=>setAmount(e.target.value)} required />
        <input className="input text-sm" placeholder="סיבה *" value={reason} onChange={e=>setReason(e.target.value)} required />
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm flex-1 justify-center" style={{background:'rgba(14,165,233,0.1)',color:'#0284c7',border:'1px solid rgba(14,165,233,0.3)'}} disabled={loading}>
          {loading ? '...' : 'בצע תיקון'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}

function AddRefundPanel({ folioId, propertyId, onDone }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [loading,setLoading]= useState(false);
  const [error,  setError]  = useState('');

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      await folioApi.refund(folioId, { amount: Number(amount), method, reason, propertyId });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="bg-surface-hover rounded-xl p-4 flex flex-col gap-3 border border-surface-border">
      <div className="text-xs font-bold text-ink mb-0.5">החזר כספי</div>
      <div className="grid grid-cols-3 gap-2">
        <input className="input text-num" type="number" placeholder="סכום ₪ *" min={0} step={0.01} value={amount} onChange={e=>setAmount(e.target.value)} required />
        <select className="select" value={method} onChange={e=>setMethod(e.target.value)}>
          <option value="cash">מזומן</option>
          <option value="credit">כרטיס אשראי</option>
          <option value="bank_transfer">העברה בנקאית</option>
        </select>
        <input className="input text-sm" placeholder="סיבה *" value={reason} onChange={e=>setReason(e.target.value)} required />
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm flex-1 justify-center" style={{background:'rgba(245,158,11,0.1)',color:'#b45309',border:'1px solid rgba(245,158,11,0.3)'}} disabled={loading}>
          {loading ? '...' : 'בצע החזר'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}

// ── Folio drawer for one reservation ─────────────────────────────────────────
function FolioDrawer({ res, propertyId, onClose }) {
  const [panel,      setPanel]      = useState(null); // 'charge'|'payment'|'discount'|'adjustment'|'refund'|null
  const [voidId,     setVoidId]     = useState(null);
  const [voidReason, setVoidR]      = useState('');
  const [voidLoad,   setVoidLoad]   = useState(false);
  const [closingFolio,  setClosing]    = useState(false);
  const [reopenFolio,   setReopening]  = useState(false);
  const [reopenReason,  setReopenR]    = useState('');
  const [showReopen,    setShowReopen] = useState(false);
  const [invoiceModal,  setInvoiceMod] = useState(null);
  const [showIssueInv,  setShowIssueInv] = useState(false);
  const [lastInvoice,   setLastInvoice]  = useState(null);
  const { toasts, success, error: toastErr } = useToast();

  const { data, loading, error, refetch } = useApi(
    () => folioApi.getByReservation(String(res._id)),
    [String(res._id)], false
  );

  async function voidLine() {
    if (!voidId || !voidReason.trim()) return;
    setVoidLoad(true);
    try {
      await folioApi.voidLine(String(data._id), voidId, voidReason);
      success('שורה בוטלה');
      setVoidId(null); setVoidR('');
      refetch();
    } catch (e) { toastErr(e.message); }
    finally { setVoidLoad(false); }
  }

  async function closeFolio() {
    setClosing(true);
    try {
      await folioApi.close(String(data._id), propertyId);
      success('Folio נסגר בהצלחה');
      refetch();
    } catch (e) { toastErr(e.message); }
    finally { setClosing(false); }
  }

  async function doReopen() {
    if (!reopenReason.trim()) { toastErr('יש להזין סיבה לפתיחת Folio'); return; }
    setReopening(true);
    try {
      await folioApi.reopen(String(data._id), reopenReason, propertyId);
      success('Folio נפתח מחדש');
      setShowReopen(false); setReopenR('');
      refetch();
    } catch (e) { toastErr(e.message); }
    finally { setReopening(false); }
  }

  async function openInvoice() {
    try {
      const inv = await folioApi.invoice(String(res._id));
      setInvoiceMod(inv);
    } catch (e) { toastErr(e.message); }
  }

  function handleInvoiceIssued(inv) {
    setLastInvoice(inv);
    setShowIssueInv(false);
    success('חשבונית הופקה! מספר: ' + (inv.invoiceNumber || '—'));
    refetch();
  }

  const lines   = data?.lines || [];
  const active  = lines.filter(l => l.status === 'posted');
  const balance = data?.balance ?? 0;
  const folioId = data?._id ? String(data._id) : null;
  const isClosed = data?.status === 'closed';

  return (
    <div className="fixed inset-0 z-50 flex" style={{ direction:'rtl' }}>
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-xl bg-white flex flex-col shadow-2xl overflow-hidden">
        <ToastContainer toasts={toasts} />

        {/* Issue real invoice panel */}
        {showIssueInv && folioId && (
          <IssueInvoicePanel
            folioId={folioId}
            balance={balance}
            propertyId={propertyId}
            onClose={() => setShowIssueInv(false)}
            onIssued={handleInvoiceIssued}
          />
        )}

        {/* Print last issued invoice */}
        {lastInvoice && (
          <div className="fixed bottom-4 left-4 z-[80] bg-white border border-surface-border rounded-xl shadow-xl p-3 flex items-center gap-3" style={{direction:'rtl'}}>
            <CheckCircle2 size={16} className="text-emerald-600"/>
            <div className="text-xs">
              <div className="font-bold text-ink">חשבונית #{lastInvoice.invoiceNumber}</div>
              <div className="text-ink-muted">₪{lastInvoice.totalGross?.toFixed(2)}</div>
            </div>
            <button className="btn btn-primary btn-sm gap-1" onClick={() => invApi.openHtml(String(lastInvoice._id))}>
              <Printer size={12}/> צפה / הדפס
            </button>
            <button className="btn btn-secondary btn-sm gap-1" onClick={() => invApi.openHtml(String(lastInvoice._id), { autoPrint: true })}>
              <Download size={12}/> PDF
            </button>
            <button className="btn btn-ghost btn-icon" onClick={() => setLastInvoice(null)}><X size={13}/></button>
          </div>
        )}

        {/* Legacy invoice modal */}
        {invoiceModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" style={{direction:'rtl'}}>
              <div className="flex items-center justify-between mb-4">
                <span className="font-bold text-ink text-lg">חשבונית מס</span>
                <div className="flex gap-2">
                  <button className="btn btn-primary btn-sm gap-1" onClick={() => window.print()}>
                    <FileText size={12}/> הדפסה
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setInvoiceMod(null)}>✕</button>
                </div>
              </div>
              <div className="border-b border-surface-border pb-4 mb-4">
                <div className="text-lg font-bold text-ink">{invoiceModal.property?.name}</div>
                <div className="text-xs text-ink-muted">{invoiceModal.property?.address}</div>
                {invoiceModal.property?.vatNumber && <div className="text-xs text-ink-muted">מע"מ: {invoiceModal.property.vatNumber}</div>}
              </div>
              <div className="text-xs text-ink-muted mb-4">
                <div>אורח: {invoiceModal.guest?.firstName} {invoiceModal.guest?.lastName}</div>
                {invoiceModal.company && <div>חברה: {invoiceModal.company?.name}</div>}
                <div>הגעה: {invoiceModal.arrivalDate} | יציאה: {invoiceModal.departureDate}</div>
              </div>
              <table className="data-table mb-4">
                <thead>
                  <tr>
                    <th>תיאור</th>
                    <th>נטו</th>
                    <th>מע"מ</th>
                    <th>ברוטו</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoiceModal.lines || []).map((l, i) => (
                    <tr key={i}>
                      <td className="text-sm">{l.description}</td>
                      <td className="text-num text-xs">₪{l.net?.toFixed(2)}</td>
                      <td className="text-num text-xs">₪{l.tax?.toFixed(2)}</td>
                      <td className="text-num text-xs font-bold">₪{l.gross?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-surface-border pt-3 flex flex-col gap-1 items-end text-sm">
                <div className="flex gap-6"><span className="text-ink-muted">סה"כ נטו</span><span className="text-num font-bold">₪{invoiceModal.totals?.net?.toFixed(2)}</span></div>
                <div className="flex gap-6"><span className="text-ink-muted">מע"מ ({invoiceModal.vatRate || 0}%)</span><span className="text-num">₪{invoiceModal.totals?.tax?.toFixed(2)}</span></div>
                <div className="flex gap-6 text-base font-black"><span>סה"כ לתשלום</span><span className="text-num text-brand">₪{invoiceModal.totals?.gross?.toFixed(2)}</span></div>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-start justify-between">
          <div>
            <div className="font-bold text-ink">{res.primaryGuest?.firstName} {res.primaryGuest?.lastName}</div>
            <div className="text-xs text-ink-muted">{res.confirmationNumber} · {res.roomType?.name} · חדר {res.assignedRoom?.number || '—'}</div>
            <div className="text-xs text-ink-muted">{res.arrivalDate} → {res.departureDate}</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-primary btn-sm gap-1" onClick={() => setShowIssueInv(true)} disabled={!folioId}>
              <ReceiptText size={12} /> חשבונית מס
            </button>
            <button className="btn btn-ghost btn-icon" onClick={onClose}><Slash size={16} /></button>
          </div>
        </div>

        {/* Balance banner */}
        {!loading && (
          <div className={`flex items-center gap-3 px-6 py-3 border-b border-surface-border ${balance > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
            {balance > 0
              ? <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
              : <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />}
            <div className="flex-1">
              <div className={`text-sm font-bold ${balance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {balance > 0 ? `יתרה לתשלום: ₪${balance.toFixed(2)}` : 'חשבון מאוזן'}
              </div>
              <div className="text-xs text-ink-muted">
                {active.length} שורות פעילות
                {isClosed && <span className="ml-2 font-semibold text-slate-500">· Folio סגור</span>}
              </div>
            </div>
            <div className="text-2xl font-black text-num" style={{ color: balance > 0 ? '#dc2626' : '#059669' }}>
              ₪{Math.abs(balance).toFixed(2)}
            </div>
          </div>
        )}

        {/* Lines */}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="flex justify-center py-12"><Spinner size={24} /></div>}
          {error && <div className="px-6 py-4 text-xs text-red-500">{error}</div>}
          {!loading && !error && (() => {
            const totalCharges  = lines.filter(l => l.status === 'posted' && l.amount > 0).reduce((s,l) => s + l.amount + (l.taxAmount||0), 0);
            const totalPayments = lines.filter(l => l.status === 'posted' && l.amount < 0).reduce((s,l) => s + Math.abs(l.amount), 0);
            return (
            <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>תיאור</th>
                  <th>סוג</th>
                  <th>מחלקה</th>
                  <th>סכום</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map(line => {
                  const isVoided  = line.status === 'voided';
                  const isPayment = line.type === 'payment' || line.type === 'refund';
                  const lconf     = LINE_CONFIG[line.type] || LINE_CONFIG.charge;
                  return (
                    <tr key={String(line._id)} style={{ opacity: isVoided ? 0.4 : 1 }}>
                      <td className="text-num text-xs">{line.serviceDate}</td>
                      <td>
                        <div className="text-sm font-medium text-ink">{line.description}</div>
                        {isVoided && <div className="text-xs text-ink-faint">בוטל: {line.voidReason}</div>}
                      </td>
                      <td>
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: lconf.bg, color: lconf.color }}>{lconf.label}</span>
                      </td>
                      <td className="text-xs text-ink-muted">{DEPT_LABELS[line.department] || line.department || '—'}</td>
                      <td className={`text-num font-bold text-sm ${isPayment ? 'text-emerald-600' : isVoided ? 'text-ink-faint' : 'text-red-600'}`}>
                        {isPayment ? '-' : ''}₪{Math.abs(line.amount).toFixed(2)}
                      </td>
                      <td>
                        {!isVoided && !isPayment && folioId && !isClosed && (
                          voidId === String(line._id)
                            ? (
                              <div className="flex items-center gap-1">
                                <input className="input h-7 text-xs w-28" placeholder="סיבה *" value={voidReason}
                                  onChange={e => setVoidR(e.target.value)} />
                                <button className="btn btn-danger btn-sm px-2" onClick={voidLine} disabled={voidLoad || !voidReason.trim()}>
                                  {voidLoad ? '...' : 'בטל'}
                                </button>
                                <button className="btn btn-ghost btn-sm px-1" onClick={() => setVoidId(null)}>✕</button>
                              </div>
                            )
                            : (
                              <button className="btn btn-ghost btn-sm text-ink-faint hover:text-red-500 transition-colors"
                                onClick={() => setVoidId(String(line._id))}>
                                <Slash size={12} />
                              </button>
                            )
                        )}
                      </td>
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-xs text-ink-faint">אין שורות בפוליו</td></tr>
                )}
              </tbody>
            </table>

            {/* Totals summary */}
            {lines.length > 0 && (
              <div className="border-t-2 border-surface-border mx-6 my-3 pt-3 flex flex-col gap-1.5">
                <div className="flex justify-between text-xs text-ink-muted">
                  <span>סה"כ חיובים</span>
                  <span className="text-num font-semibold text-red-600">₪{totalCharges.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-ink-muted">
                  <span>סה"כ תשלומים</span>
                  <span className="text-num font-semibold text-emerald-600">₪{totalPayments.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-black border-t border-surface-border pt-1.5 mt-0.5">
                  <span>יתרה לתשלום</span>
                  <span className={`text-num ${balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    ₪{Math.abs(balance).toFixed(2)}
                    {balance <= 0 && <CheckCircle2 size={12} className="inline mr-1 text-emerald-500" />}
                  </span>
                </div>
              </div>
            )}
            </>
            );
          })()}
        </div>

        {/* Action panels */}
        {panel && folioId && (
          <div className="px-6 py-4 border-t border-surface-border">
            {panel === 'charge'     && <AddChargePanel     folioId={folioId} propertyId={propertyId} onDone={() => { setPanel(null); refetch(); success('חיוב נוסף'); }} />}
            {panel === 'payment'    && <AddPaymentPanel    folioId={folioId} propertyId={propertyId} balance={balance} onDone={() => { setPanel(null); refetch(); success('תשלום נרשם'); }} />}
            {panel === 'discount'   && <AddDiscountPanel   folioId={folioId} propertyId={propertyId} onDone={() => { setPanel(null); refetch(); success('הנחה נרשמה'); }} />}
            {panel === 'adjustment' && <AddAdjustmentPanel folioId={folioId} propertyId={propertyId} onDone={() => { setPanel(null); refetch(); success('תיקון בוצע'); }} />}
            {panel === 'refund'     && <AddRefundPanel     folioId={folioId} propertyId={propertyId} onDone={() => { setPanel(null); refetch(); success('החזר נרשם'); }} />}
          </div>
        )}

        {/* Reopen reason form */}
        {showReopen && (
          <div className="px-6 py-4 border-t border-surface-border bg-amber-50">
            <div className="text-xs font-bold text-amber-800 mb-2">פתיחת Folio סגור — הזן סיבה</div>
            <div className="flex gap-2">
              <input className="input text-sm flex-1" placeholder="סיבה לפתיחה מחדש *"
                value={reopenReason} onChange={e => setReopenR(e.target.value)} />
              <button className="btn btn-sm gap-1" style={{background:'#fef3c7',color:'#92400e',border:'1px solid #fcd34d'}}
                onClick={doReopen} disabled={reopenFolio || !reopenReason.trim()}>
                {reopenFolio ? '...' : <><Unlock size={11}/> פתח</>}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowReopen(false)}>ביטול</button>
            </div>
          </div>
        )}

        {/* Footer actions */}
        {!panel && !showReopen && folioId && (
          isClosed ? (
            <div className="flex gap-2 px-6 py-4 border-t border-surface-border bg-surface-hover">
              <div className="flex-1 text-xs text-ink-muted flex items-center gap-1"><Lock size={12}/> Folio סגור</div>
              <button className="btn btn-secondary btn-sm gap-1" onClick={() => setShowReopen(true)}>
                <Unlock size={12}/> פתח מחדש
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 px-6 py-4 border-t border-surface-border bg-surface-hover">
              <button className="btn btn-secondary btn-sm gap-1" onClick={() => setPanel('charge')}>
                <Plus size={12}/> חיוב
              </button>
              <button className="btn btn-primary btn-sm gap-1" onClick={() => setPanel('payment')}>
                <CreditCard size={12}/> תשלום
              </button>
              <button className="btn btn-sm gap-1" style={{background:'rgba(139,92,246,0.1)',color:'#7c3aed',border:'1px solid rgba(139,92,246,0.25)'}}
                onClick={() => setPanel('discount')}>
                <Tag size={12}/> הנחה
              </button>
              <button className="btn btn-sm gap-1" style={{background:'rgba(14,165,233,0.1)',color:'#0284c7',border:'1px solid rgba(14,165,233,0.25)'}}
                onClick={() => setPanel('adjustment')}>
                <ArrowLeftRight size={12}/> תיקון
              </button>
              <button className="btn btn-sm gap-1" style={{background:'rgba(245,158,11,0.1)',color:'#b45309',border:'1px solid rgba(245,158,11,0.25)'}}
                onClick={() => setPanel('refund')}>
                <MinusCircle size={12}/> החזר
              </button>
              <button className="btn btn-sm gap-1 mr-auto" style={{background: balance !== 0 ? 'rgba(148,163,184,0.1)':'rgba(16,185,129,0.1)', color: balance !== 0 ? '#94a3b8':'#065f46', border: balance !== 0 ? '1px solid #e2e8f0':'1px solid rgba(16,185,129,0.3)', cursor: balance !== 0 ? 'not-allowed' : 'pointer' }}
                onClick={balance === 0 ? closeFolio : undefined}
                title={balance !== 0 ? 'יש לאזן את החשבון לפני סגירה' : ''}>
                {closingFolio ? '...' : <><Lock size={12}/> סגור Folio</>}
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FolioPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const [search,    setSearch]    = useState('');
  const [debSearch, setDebSearch] = useState('');
  const [timer,     setTimer]     = useState(null);
  const [selected,  setSelected]  = useState(null);

  function handleSearch(v) {
    setSearch(v);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setDebSearch(v.trim()), 350);
    setTimer(t);
  }

  const { data, loading, error, refetch } = useApi(
    () => resApi.list(propertyId, { status: 'confirmed,in_house,checked_out', limit: 100, ...(debSearch ? { q: debSearch } : {}) }),
    [propertyId, debSearch], skip
  );

  const list = data || [];

  return (
    <div className="animate-fade-in">
      {selected && (
        <FolioDrawer res={selected} propertyId={propertyId} onClose={() => setSelected(null)} />
      )}

      <div className="page-header">
        <div>
          <div className="page-title">Folio ותשלומים</div>
          <div className="page-subtitle">חשבונות וחיובים לפי הזמנה</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input className="input pr-8 text-xs" placeholder="חיפוש לפי שם אורח, מספר אישור..."
          value={search} onChange={e => handleSearch(e.target.value)} />
      </div>

      {loading && <PageSpinner />}
      {error   && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>אורח</th>
                <th>אישור</th>
                <th>חדר</th>
                <th>הגעה</th>
                <th>יציאה</th>
                <th>סטטוס</th>
                <th>תשלום</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map(res => {
                const payBg = res.paymentStatus === 'paid' ? 'badge-clean' : res.paymentStatus === 'balance_due' ? 'badge-dirty' : 'badge-pending';
                const payLbl = res.paymentStatus === 'paid' ? 'שולם' : res.paymentStatus === 'balance_due' ? 'יתרה' : 'Pending';
                return (
                  <tr key={String(res._id)} className="cursor-pointer hover:bg-brand/5 transition-colors"
                    onClick={() => setSelected(res)}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="avatar text-xs flex-shrink-0"
                          style={{width:26,height:26,fontSize:10,background:'rgba(99,102,241,0.1)',color:'#6366f1'}}>
                          {res.primaryGuest?.firstName?.slice(0,1)}{res.primaryGuest?.lastName?.slice(0,1)}
                        </div>
                        <span className="font-medium text-ink text-sm">
                          {res.primaryGuest?.firstName} {res.primaryGuest?.lastName}
                        </span>
                      </div>
                    </td>
                    <td><span className="font-mono text-xs text-brand font-bold">{res.confirmationNumber}</span></td>
                    <td className="text-num font-semibold">{res.assignedRoom?.number || '—'}</td>
                    <td className="text-num text-xs">{res.arrivalDate}</td>
                    <td className="text-num text-xs">{res.departureDate}</td>
                    <td>
                      <span className={`badge ${res.status === 'in_house' ? 'badge-inhouse' : res.status === 'confirmed' ? 'badge-confirmed' : 'badge-departure'}`}>
                        {res.status === 'in_house' ? 'In House' : res.status === 'confirmed' ? 'מאושר' : 'עזב'}
                      </span>
                    </td>
                    <td><span className={`badge ${payBg}`}>{payLbl}</span></td>
                    <td>
                      <button className="btn btn-ghost btn-sm gap-1 text-brand text-xs font-semibold">
                        <Receipt size={12} /> Folio
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length === 0 && (
            <div className="empty-state">
              <Receipt size={28} className="empty-state-icon" />
              <span>לא נמצאו הזמנות</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
