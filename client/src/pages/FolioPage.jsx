import { useState, useCallback } from 'react';
import { Search, CreditCard, Plus, Slash, Receipt, ChevronDown, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { reservations as resApi, folio as folioApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

// ── Folio line type colors ────────────────────────────────────────────────────
const LINE_CONFIG = {
  charge:  { label:'חיוב',    color:'#dc2626', bg:'rgba(239,68,68,0.08)' },
  payment: { label:'תשלום',   color:'#059669', bg:'rgba(16,185,129,0.08)' },
  void:    { label:'ביטול',   color:'#94a3b8', bg:'rgba(148,163,184,0.08)' },
  tax:     { label:'מס',      color:'#d97706', bg:'rgba(245,158,11,0.08)' },
  deposit: { label:'מקדמה',   color:'#6366f1', bg:'rgba(99,102,241,0.08)' },
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

function AddPaymentPanel({ folioId, propertyId, balance, onDone }) {
  const [amount, setAmount] = useState(balance > 0 ? String(balance.toFixed(2)) : '');
  const [desc,   setDesc]   = useState('תשלום במזומן');
  const [loading,setLoading]= useState(false);
  const [error,  setError]  = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await folioApi.payment(folioId, { amount: Number(amount), description: desc, propertyId });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="bg-surface-hover rounded-xl p-4 flex flex-col gap-3 border border-surface-border">
      <div className="text-xs font-bold text-ink mb-0.5">רשום תשלום</div>
      <div className="grid grid-cols-2 gap-2">
        <input className="input text-num" type="number" placeholder={`סכום ₪ *`} min={0} step={0.01} value={amount} onChange={e=>setAmount(e.target.value)} required />
        <input className="input text-sm" placeholder="אמצעי תשלום" value={desc} onChange={e=>setDesc(e.target.value)} />
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm flex-1 justify-center" disabled={loading}>
          {loading ? '...' : 'רשום'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}

// ── Folio drawer for one reservation ─────────────────────────────────────────
function FolioDrawer({ res, propertyId, onClose }) {
  const [panel,   setPanel]   = useState(null); // 'charge' | 'payment' | null
  const [voidId,  setVoidId]  = useState(null);
  const [voidReason, setVoidR]= useState('');
  const [voidLoad,setVoidLoad]= useState(false);
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

  const lines  = data?.lines || [];
  const active = lines.filter(l => l.status === 'posted');
  const balance = data?.balance ?? 0;
  const folioId = data?._id ? String(data._id) : null;

  return (
    <div className="fixed inset-0 z-50 flex" style={{ direction:'rtl' }}>
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-xl bg-white flex flex-col shadow-2xl overflow-hidden">
        <ToastContainer toasts={toasts} />

        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-start justify-between">
          <div>
            <div className="font-bold text-ink">{res.primaryGuest?.firstName} {res.primaryGuest?.lastName}</div>
            <div className="text-xs text-ink-muted">{res.confirmationNumber} · {res.roomType?.name} · חדר {res.assignedRoom?.number || '—'}</div>
            <div className="text-xs text-ink-muted">{res.arrivalDate} → {res.departureDate}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Slash size={16} /></button>
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
              <div className="text-xs text-ink-muted">{active.length} שורות פעילות</div>
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
          {!loading && !error && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>תיאור</th>
                  <th>מחלקה</th>
                  <th>סכום</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map(line => {
                  const isVoided = line.status === 'voided';
                  const isPayment = line.type === 'payment';
                  return (
                    <tr key={String(line._id)} style={{ opacity: isVoided ? 0.4 : 1 }}>
                      <td className="text-num text-xs">{line.serviceDate}</td>
                      <td>
                        <div className="text-sm font-medium text-ink">{line.description}</div>
                        {isVoided && <div className="text-xs text-ink-faint">בוטל: {line.voidReason}</div>}
                      </td>
                      <td className="text-xs text-ink-muted">{DEPT_LABELS[line.department] || line.department || '—'}</td>
                      <td className={`text-num font-bold text-sm ${isPayment ? 'text-emerald-600' : isVoided ? 'text-ink-faint' : 'text-red-600'}`}>
                        {isPayment ? '-' : ''}₪{Math.abs(line.amount).toFixed(2)}
                      </td>
                      <td>
                        {!isVoided && !isPayment && folioId && (
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
                  <tr><td colSpan={5} className="text-center py-8 text-xs text-ink-faint">אין שורות בפוליו</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Action panels */}
        {panel && folioId && (
          <div className="px-6 py-4 border-t border-surface-border">
            {panel === 'charge' && (
              <AddChargePanel folioId={folioId} propertyId={propertyId}
                onDone={() => { setPanel(null); refetch(); success('חיוב נוסף'); }} />
            )}
            {panel === 'payment' && (
              <AddPaymentPanel folioId={folioId} propertyId={propertyId} balance={balance}
                onDone={() => { setPanel(null); refetch(); success('תשלום נרשם'); }} />
            )}
          </div>
        )}

        {/* Footer actions */}
        {!panel && folioId && data?.status !== 'closed' && (
          <div className="flex gap-2 px-6 py-4 border-t border-surface-border bg-surface-hover">
            <button className="btn btn-secondary btn-sm flex-1 justify-center gap-1" onClick={() => setPanel('charge')}>
              <Plus size={13} /> חיוב
            </button>
            <button className="btn btn-primary btn-sm flex-1 justify-center gap-1" onClick={() => setPanel('payment')}>
              <CreditCard size={13} /> תשלום
            </button>
          </div>
        )}
        {data?.status === 'closed' && (
          <div className="px-6 py-3 border-t border-surface-border text-center text-xs text-ink-muted bg-surface-hover">
            Folio סגור — לאחר צ׳ק-אאוט
          </div>
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
