/**
 * InvoicesPage.jsx
 * ניהול חשבוניות — הפקה, צפייה, הדפסה וזיכויים
 * לפי חוק מע"מ תשל"ו-1975 + תקנות ניהול ספרים
 */
import { useState, useCallback } from 'react';
import {
  FileText, Printer, Search, Filter, Download, Plus,
  ChevronLeft, ChevronRight, X, AlertCircle, CheckCircle2,
  ExternalLink, ReceiptText, Minus, RefreshCw,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { invoices as invApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

/* ── constants ───────────────────────────────────────────────────────────── */
const TYPE_LABELS = {
  tax_invoice:         'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס/קבלה',
  receipt:             'קבלה',
  proforma:            'חשבונית פרופורמה',
  credit_note:         'הודעת זיכוי',
  debit_note:          'הודעת חיוב',
};
const TYPE_COLORS = {
  tax_invoice:         { bg:'#eff6ff', color:'#1d4ed8', border:'#bfdbfe' },
  tax_invoice_receipt: { bg:'#f0fdf4', color:'#166534', border:'#86efac' },
  receipt:             { bg:'#f0fdf4', color:'#15803d', border:'#86efac' },
  proforma:            { bg:'#fef9c3', color:'#854d0e', border:'#fde047' },
  credit_note:         { bg:'#fef2f2', color:'#dc2626', border:'#fca5a5' },
  debit_note:          { bg:'#fff7ed', color:'#c2410c', border:'#fed7aa' },
};
const STATUS_LABELS = {
  draft:               'טיוטה',
  issued:              'הונפקה',
  cancelled:           'בוטלה',
  pending_allocation:  'ממתין מספר הקצאה',
};
const STATUS_COLORS = {
  draft:               { bg:'#f8fafc', color:'#64748b', border:'#e2e8f0' },
  issued:              { bg:'#f0fdf4', color:'#166534', border:'#86efac' },
  cancelled:           { bg:'#fef2f2', color:'#dc2626', border:'#fca5a5' },
  pending_allocation:  { bg:'#fffbeb', color:'#92400e', border:'#fcd34d' },
};

function fmtILS(n) { return `₪${(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('he-IL') : '—'; }

/* ── Badge ───────────────────────────────────────────────────────────────── */
function Badge({ cfg, label }) {
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
      {label}
    </span>
  );
}

/* ── Issue Invoice Modal ─────────────────────────────────────────────────── */
function IssueModal({ folioId, folioBalance, propertyId, onClose, onIssued }) {
  const [type,        setType]        = useState('tax_invoice_receipt');
  const [buyerName,   setBuyerName]   = useState('');
  const [buyerVat,    setBuyerVat]    = useState('');
  const [notes,       setNotes]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const { success, error: toastErr }  = useToast();

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const inv = await invApi.issueFromFolio(folioId, {
        type,
        buyer: buyerName ? { name: buyerName, vatNumber: buyerVat || undefined } : undefined,
        notes: notes || undefined,
        propertyId,
      });
      success('חשבונית הופקה בהצלחה');
      onIssued(inv);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', direction:'rtl' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="font-bold text-ink flex items-center gap-2"><ReceiptText size={16}/> הפקת חשבונית</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4">
          {/* type */}
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-2">סוג מסמך *</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(TYPE_LABELS).filter(([k]) => !['proforma','credit_note','debit_note'].includes(k)).map(([k,v]) => (
                <button key={k} type="button"
                  onClick={() => setType(k)}
                  className={`text-xs font-medium px-3 py-2 rounded-xl border text-center transition-all
                    ${type === k ? 'border-brand bg-brand/5 text-brand' : 'border-surface-border hover:border-brand/30 text-ink-secondary'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* buyer */}
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">שם רוכש (ל-B2B, אופציונלי)</label>
            <input className="input w-full text-sm" placeholder="שם חברה / אורח" value={buyerName} onChange={e => setBuyerName(e.target.value)} />
          </div>
          {buyerName && (
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">מספר ע.מ. / ח.פ. של הרוכש</label>
              <input className="input w-full text-num" placeholder="xxxxxxxxx" value={buyerVat} onChange={e => setBuyerVat(e.target.value)} />
            </div>
          )}

          {/* notes */}
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">הערות</label>
            <textarea className="input w-full resize-none text-sm" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {/* balance hint */}
          <div className="text-xs text-ink-muted bg-surface-hover rounded-lg px-3 py-2">
            סה"כ לחשבונית: <span className="font-bold text-ink">{fmtILS(folioBalance)}</span>
            {folioBalance === 0 && <span className="text-amber-600"> · Folio מאוזן — ייתכן שאין מה לחייב</span>}
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex gap-2 pt-1">
            <button type="button" className="btn btn-secondary flex-1 justify-center" onClick={onClose}>ביטול</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 justify-center gap-2">
              {loading && <Spinner size={13}/>} הפק חשבונית
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Allocation Number Modal ─────────────────────────────────────────────── */
function AllocationModal({ invoice, onClose, onSaved }) {
  const [num,     setNum]    = useState(invoice.allocationNumber || '');
  const [loading, setLoading]= useState(false);
  const [error,   setError]  = useState('');
  const { success } = useToast();

  async function submit(e) {
    e.preventDefault();
    if (!num.trim()) { setError('יש להזין מספר הקצאה'); return; }
    setLoading(true);
    try {
      await invApi.setAllocation(String(invoice._id), num.trim());
      success('מספר הקצאה נשמר');
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4"
      style={{ background:'rgba(0,0,0,0.5)', direction:'rtl' }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="font-bold text-ink text-sm">מספר הקצאה — רשות המסים</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={14}/></button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 flex flex-col gap-3">
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            חשבונית זו מעל ₪25,000 — נדרש מספר הקצאה מרשות המסים לפי תיקון 2024 לחוק מע"מ.
          </div>
          <input className="input w-full text-num font-bold tracking-widest" placeholder="מספר הקצאה" value={num} onChange={e => setNum(e.target.value)} required />
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm flex-1" onClick={onClose}>ביטול</button>
            <button type="submit" disabled={loading} className="btn btn-primary btn-sm flex-1 justify-center gap-1">
              {loading && <Spinner size={12}/>} שמור
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Credit Note Modal ───────────────────────────────────────────────────── */
function CreditNoteModal({ invoice, onClose, onIssued }) {
  const [amount,  setAmount]  = useState('');
  const [reason,  setReason]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const { success } = useToast();

  async function submit(e) {
    e.preventDefault();
    if (!amount || !reason.trim()) { setError('סכום וסיבה חובה'); return; }
    setLoading(true);
    try {
      await invApi.creditNote(String(invoice._id), { creditAmount: Number(amount), reason });
      success('הודעת זיכוי הופקה');
      onIssued();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4"
      style={{ background:'rgba(0,0,0,0.5)', direction:'rtl' }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="font-bold text-ink text-sm">הפקת הודעת זיכוי</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={14}/></button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 flex flex-col gap-3">
          <div className="text-xs text-ink-muted">
            זיכוי לחשבונית מס&nbsp;<span className="font-bold text-ink">#{invoice.invoiceNumber}</span>
            &nbsp;({fmtILS(invoice.totalGross)})
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">סכום לזיכוי (₪) *</label>
            <input type="number" className="input w-full text-num" min={0.01} step={0.01}
              max={invoice.totalGross} placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">סיבת הזיכוי *</label>
            <input className="input w-full text-sm" value={reason} onChange={e => setReason(e.target.value)} required />
          </div>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm flex-1" onClick={onClose}>ביטול</button>
            <button type="submit" disabled={loading} className="btn btn-primary btn-sm flex-1 justify-center gap-1" style={{background:'#dc2626'}}>
              {loading && <Spinner size={12}/>} הפק זיכוי
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */
export default function InvoicesPage() {
  const { propertyId } = useProperty();
  const { toasts, success, error: toastErr } = useToast();

  const [page,     setPage]     = useState(1);
  const [typeF,    setTypeF]    = useState('');
  const [statusF,  setStatusF]  = useState('');
  const [fromF,    setFromF]    = useState('');
  const [toF,      setToF]      = useState('');
  const [selected, setSelected] = useState(null);   // invoice detail
  const [modal,    setModal]    = useState(null);    // 'allocation' | 'credit'

  const { data, loading, error, refetch } = useApi(
    () => invApi.list(propertyId, {
      type:   typeF   || undefined,
      status: statusF || undefined,
      dateFrom: fromF || undefined,
      dateTo:   toF   || undefined,
      page,
      limit: 25,
    }),
    [propertyId, page, typeF, statusF, fromF, toF],
    !propertyId,
  );

  const invoiceList  = data?.invoices || data || [];
  const totalCount   = data?.total || invoiceList.length;
  const totalPages   = data?.pages || Math.ceil(totalCount / 25) || 1;

  async function openPrint(inv) {
    try { await invApi.openHtml(String(inv._id)); }
    catch (e) { toastErr(e.message); }
  }

  if (!propertyId) return <div className="p-8 text-center text-ink-muted">בחר נכס כדי לראות חשבוניות</div>;
  if (loading && !data) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div className="p-6 max-w-6xl mx-auto" dir="rtl">
      <ToastContainer toasts={toasts} />

      {/* allocation / credit modals */}
      {modal === 'allocation' && selected && (
        <AllocationModal
          invoice={selected}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setSelected(null); refetch(); }}
        />
      )}
      {modal === 'credit' && selected && (
        <CreditNoteModal
          invoice={selected}
          onClose={() => setModal(null)}
          onIssued={() => { setModal(null); setSelected(null); refetch(); }}
        />
      )}

      {/* header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">חשבוניות</h1>
          <p className="text-sm text-ink-muted mt-0.5">מסמכי מס לפי חוק מע"מ תשל"ו-1975</p>
        </div>
        <button className="btn btn-ghost btn-sm gap-1.5" onClick={refetch}>
          <RefreshCw size={14}/> רענן
        </button>
      </div>

      {/* filters */}
      <div className="card p-4 mb-5 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1">מ-תאריך</label>
          <input type="date" className="input text-sm" value={fromF}
            onChange={e => { setFromF(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1">עד תאריך</label>
          <input type="date" className="input text-sm" value={toF}
            onChange={e => { setToF(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1">סוג מסמך</label>
          <select className="select text-sm" value={typeF}
            onChange={e => { setTypeF(e.target.value); setPage(1); }}>
            <option value="">הכל</option>
            {Object.entries(TYPE_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1">סטטוס</label>
          <select className="select text-sm" value={statusF}
            onChange={e => { setStatusF(e.target.value); setPage(1); }}>
            <option value="">הכל</option>
            {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {(typeF || statusF || fromF || toF) && (
          <button className="btn btn-ghost btn-sm gap-1 self-end" onClick={() => {
            setTypeF(''); setStatusF(''); setFromF(''); setToF(''); setPage(1);
          }}><X size={12}/> נקה</button>
        )}
      </div>

      {/* table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>מספר</th>
              <th>תאריך</th>
              <th>סוג</th>
              <th>סטטוס</th>
              <th>רוכש</th>
              <th>נטו</th>
              <th>מע"מ</th>
              <th>ברוטו</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoiceList.length === 0 && (
              <tr><td colSpan={9} className="text-center text-ink-muted py-8">אין חשבוניות</td></tr>
            )}
            {invoiceList.map(inv => {
              const tCfg = TYPE_COLORS[inv.type]   || TYPE_COLORS.tax_invoice;
              const sCfg = STATUS_COLORS[inv.status] || STATUS_COLORS.issued;
              const needsAlloc = inv.status === 'pending_allocation';
              return (
                <tr key={String(inv._id)} className="hover:bg-surface-hover cursor-pointer"
                  onClick={() => setSelected(s => s && String(s._id) === String(inv._id) ? null : inv)}>
                  <td className="text-num font-bold text-sm">
                    {inv.invoiceNumber || <span className="text-ink-faint text-xs">טיוטה</span>}
                    {needsAlloc && <AlertCircle size={12} className="text-amber-500 mr-1 inline" />}
                  </td>
                  <td className="text-xs text-ink-muted">{fmtDate(inv.issuedAt)}</td>
                  <td><Badge cfg={tCfg} label={TYPE_LABELS[inv.type] || inv.type} /></td>
                  <td><Badge cfg={sCfg} label={STATUS_LABELS[inv.status] || inv.status} /></td>
                  <td className="text-sm text-ink">{inv.buyer?.name || inv.buyer?.legalName || '—'}</td>
                  <td className="text-num text-sm">{fmtILS(inv.totalNet)}</td>
                  <td className="text-num text-sm text-amber-700">{fmtILS(inv.totalVat)}</td>
                  <td className="text-num font-bold text-sm">{fmtILS(inv.totalGross)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button className="btn btn-ghost btn-icon" title="צפה / הדפס"
                        onClick={() => openPrint(inv)}>
                        <Printer size={13}/>
                      </button>
                      <button className="btn btn-ghost btn-icon" title="הורד PDF (הדפס לקובץ)"
                        onClick={() => invApi.openHtml(String(inv._id), { autoPrint: true }).catch(e => toastErr(e.message))}>
                        <Download size={13}/>
                      </button>
                      {inv.status === 'issued' && !['credit_note','proforma'].includes(inv.type) && (
                        <button className="btn btn-ghost btn-icon" title="הפק זיכוי"
                          onClick={() => { setSelected(inv); setModal('credit'); }}>
                          <Minus size={13}/>
                        </button>
                      )}
                      {needsAlloc && (
                        <button className="btn btn-ghost btn-icon" title="מספר הקצאה"
                          onClick={() => { setSelected(inv); setModal('allocation'); }}>
                          <AlertCircle size={13} className="text-amber-500"/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-ink-muted">
          <span>עמוד {page} מתוך {totalPages} · סה"כ {totalCount}</span>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronRight size={14}/>
            </button>
            <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronLeft size={14}/>
            </button>
          </div>
        </div>
      )}

      {/* detail panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex" style={{ direction:'rtl' }} onClick={e => e.target === e.currentTarget && setSelected(null)}>
          <div className="flex-1 bg-black/40" onClick={() => setSelected(null)} />
          <div className="w-full max-w-sm bg-white flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <div>
                <div className="font-bold text-ink text-sm">{TYPE_LABELS[selected.type]}</div>
                <div className="text-xs text-ink-muted">#{selected.invoiceNumber || 'טיוטה'}</div>
              </div>
              <div className="flex gap-1.5">
                <button className="btn btn-primary btn-sm gap-1" onClick={() => openPrint(selected)}>
                  <Printer size={12}/> הדפס
                </button>
                <button className="btn btn-ghost btn-icon" onClick={() => setSelected(null)}>
                  <X size={16}/>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4 text-sm">
              {/* status alert */}
              {selected.status === 'pending_allocation' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex gap-2">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
                  חשבונית זו מעל ₪25,000 ומחייבת מספר הקצאה מרשות המסים.
                  <button className="underline font-semibold ml-auto" onClick={() => setModal('allocation')}>הוסף</button>
                </div>
              )}

              {/* seller */}
              <div className="bg-surface-hover rounded-xl p-3">
                <div className="text-xs font-bold text-ink-secondary mb-2">מוכר</div>
                <div className="font-semibold text-ink">{selected.seller?.name}</div>
                {selected.seller?.vatNumber && <div className="text-xs text-ink-muted">מע"מ: {selected.seller.vatNumber}</div>}
                {selected.seller?.address && <div className="text-xs text-ink-muted">{selected.seller.address}</div>}
              </div>

              {/* buyer */}
              {selected.buyer?.name && (
                <div className="bg-surface-hover rounded-xl p-3">
                  <div className="text-xs font-bold text-ink-secondary mb-2">רוכש</div>
                  <div className="font-semibold text-ink">{selected.buyer.name}</div>
                  {selected.buyer.vatNumber && <div className="text-xs text-ink-muted">ע.מ./ח.פ.: {selected.buyer.vatNumber}</div>}
                </div>
              )}

              {/* lines */}
              <div>
                <div className="text-xs font-bold text-ink-secondary mb-2">פירוט</div>
                <div className="flex flex-col gap-1">
                  {(selected.lines || []).map((l, i) => (
                    <div key={i} className="flex justify-between text-xs border-b border-surface-hover pb-1">
                      <span className="text-ink flex-1 pl-2">{l.description}</span>
                      <span className="text-num text-ink-muted">{fmtILS(l.grossAmount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* totals */}
              <div className="bg-surface-hover rounded-xl p-3 flex flex-col gap-1">
                <div className="flex justify-between text-xs text-ink-muted">
                  <span>נטו</span><span className="text-num">{fmtILS(selected.totalNet)}</span>
                </div>
                <div className="flex justify-between text-xs text-ink-muted">
                  <span>מע"מ 18%</span><span className="text-num text-amber-700">{fmtILS(selected.totalVat)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-ink border-t border-surface-border pt-1 mt-1">
                  <span>סה"כ</span><span className="text-num">{fmtILS(selected.totalGross)}</span>
                </div>
              </div>

              {/* allocation */}
              {selected.allocationNumber && (
                <div className="text-xs text-ink-muted bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-green-600"/>
                  מספר הקצאה: <span className="font-bold text-green-700">{selected.allocationNumber}</span>
                </div>
              )}

              {/* actions */}
              <div className="flex flex-col gap-2">
                {selected.status === 'issued' && !['credit_note','proforma'].includes(selected.type) && (
                  <button className="btn btn-sm gap-1.5 justify-center"
                    style={{ background:'#fee2e2', color:'#dc2626', border:'1px solid #fca5a5' }}
                    onClick={() => setModal('credit')}>
                    <Minus size={12}/> הפק הודעת זיכוי
                  </button>
                )}
                {selected.status === 'pending_allocation' && (
                  <button className="btn btn-sm gap-1.5 justify-center btn-primary"
                    onClick={() => setModal('allocation')}>
                    <AlertCircle size={12}/> הזן מספר הקצאה
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
