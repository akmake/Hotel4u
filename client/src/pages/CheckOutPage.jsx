import { useState, useCallback, useEffect } from 'react';
import {
  LogOut, Crown, AlertCircle, CheckCircle2, CreditCard,
  Plus, Slash, X, ExternalLink, Copy, Receipt,
  MessageSquare, Loader2, ChevronDown, ChevronUp, Printer,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { dashboard, reservations as resApi, folio as folioApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const DEPT_LABELS = {
  room:'לינה', fb:'מזון ומשקאות', spa:'ספא', parking:'חניה',
  laundry:'כביסה', minibar:'מיניבר', extras:'נוספות', tax:'מס',
};

// ── Inline Folio Section ───────────────────────────────────────────────────────
function FolioSection({ res, propertyId }) {
  const [panel,    setPanel]   = useState(null); // 'charge' | 'payment'
  const [voidId,   setVoidId]  = useState(null);
  const [voidR,    setVoidR]   = useState('');
  const [voidLoad, setVoidLoad]= useState(false);
  const [chargeF,  setChargeF] = useState({ desc: '', amount: '', dept: 'extras' });
  const [chargeL,  setChargeL] = useState(false);
  const [payF,     setPayF]    = useState({ amount: '', desc: 'תשלום במזומן' });
  const [payL,     setPayL]    = useState(false);
  const { toasts, success, error: toastErr } = useToast();

  const { data, loading, error, refetch } = useApi(
    () => folioApi.getByReservation(String(res._id)),
    [String(res._id)], false
  );

  async function submitCharge(e) {
    e.preventDefault();
    setChargeL(true);
    try {
      await folioApi.charge(String(data._id), { description: chargeF.desc, amount: Number(chargeF.amount), department: chargeF.dept, propertyId });
      success('חיוב נרשם'); setPanel(null); setChargeF({ desc: '', amount: '', dept: 'extras' }); refetch();
    } catch (err) { toastErr(err.message); }
    finally { setChargeL(false); }
  }

  async function submitPayment(e) {
    e.preventDefault();
    setPayL(true);
    try {
      await folioApi.payment(String(data._id), { amount: Number(payF.amount), description: payF.desc, propertyId });
      success('תשלום נרשם'); setPanel(null); setPayF({ amount: '', desc: 'תשלום במזומן' }); refetch();
    } catch (err) { toastErr(err.message); }
    finally { setPayL(false); }
  }

  async function voidLine() {
    if (!voidId || !voidR.trim()) return;
    setVoidLoad(true);
    try {
      await folioApi.voidLine(String(data._id), voidId, voidR);
      success('שורה בוטלה'); setVoidId(null); setVoidR(''); refetch();
    } catch (e) { toastErr(e.message); }
    finally { setVoidLoad(false); }
  }

  const lines   = data?.lines || [];
  const balance = data?.balance ?? 0;
  const folioId = data?._id ? String(data._id) : null;

  if (loading) return <div className="flex justify-center py-4"><Spinner size={18} /></div>;
  if (error)   return <div className="text-xs text-red-500 py-2">{error}</div>;

  return (
    <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-surface-border">
      <ToastContainer toasts={toasts} />

      {/* Balance banner */}
      <div className={`flex items-center gap-2 p-2 rounded-lg text-xs font-semibold ${balance > 0 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
        {balance > 0 ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
        <span className="flex-1">{balance > 0 ? 'יתרה לתשלום' : 'חשבון מאוזן'}</span>
        <span className="font-black text-num">₪{Math.abs(balance).toFixed(2)}</span>
      </div>

      {/* Lines table */}
      {lines.length > 0 && (
        <div className="rounded-lg border border-surface-border overflow-hidden">
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: '#64748b' }}>תאריך</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: '#64748b' }}>תיאור</th>
                <th style={{ padding: '4px 8px', textAlign: 'left',  fontWeight: 700, color: '#64748b' }}>סכום</th>
                <th style={{ padding: '4px 4px', width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map(line => {
                const isVoided = line.status === 'voided';
                const isCredit = line.amount < 0;
                return (
                  <tr key={String(line._id)} style={{ opacity: isVoided ? 0.4 : 1, borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '4px 8px', color: '#64748b', whiteSpace: 'nowrap' }}>{line.serviceDate}</td>
                    <td style={{ padding: '4px 8px', maxWidth: 100 }}>
                      <div style={{ fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.description}</div>
                      {isVoided && <div style={{ color: '#94a3b8', fontSize: 10 }}>בוטל: {line.voidReason}</div>}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap', color: isCredit ? '#059669' : isVoided ? '#94a3b8' : '#dc2626' }}>
                      {isCredit ? '-' : ''}₪{Math.abs(line.amount).toFixed(2)}
                    </td>
                    <td style={{ padding: '4px 4px' }}>
                      {!isVoided && !isCredit && folioId && (
                        voidId === String(line._id) ? (
                          <div className="flex items-center gap-1">
                            <input className="input h-6 text-xs" style={{ width: 72 }} placeholder="סיבה" value={voidR} onChange={e => setVoidR(e.target.value)} />
                            <button className="btn btn-danger" style={{ height: 24, fontSize: 10, padding: '0 5px' }} onClick={voidLine} disabled={voidLoad || !voidR.trim()}>בטל</button>
                            <button className="btn btn-ghost" style={{ height: 24, fontSize: 10, padding: '0 4px' }} onClick={() => setVoidId(null)}>✕</button>
                          </div>
                        ) : (
                          <button className="btn btn-ghost btn-icon" style={{ height: 22, width: 22 }} title="בטל שורה" onClick={() => setVoidId(String(line._id))}>
                            <Slash size={10} />
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Charge/payment forms */}
      {panel === 'charge' && folioId && (
        <form onSubmit={submitCharge} className="bg-surface-hover rounded-lg p-3 flex flex-col gap-2 border border-surface-border">
          <div className="text-xs font-bold text-ink">הוסף חיוב</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="input text-sm col-span-2" placeholder="תיאור *" value={chargeF.desc} onChange={e => setChargeF(f => ({ ...f, desc: e.target.value }))} required />
            <input className="input text-num" type="number" placeholder="סכום ₪ *" min={0} step={0.01} value={chargeF.amount} onChange={e => setChargeF(f => ({ ...f, amount: e.target.value }))} required />
            <select className="select" value={chargeF.dept} onChange={e => setChargeF(f => ({ ...f, dept: e.target.value }))}>
              {Object.entries(DEPT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm flex-1 justify-center" disabled={chargeL}>{chargeL ? '...' : 'חייב'}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanel(null)}>ביטול</button>
          </div>
        </form>
      )}

      {panel === 'payment' && folioId && (
        <form onSubmit={submitPayment} className="bg-surface-hover rounded-lg p-3 flex flex-col gap-2 border border-surface-border">
          <div className="text-xs font-bold text-ink">רשום תשלום</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="input text-num" type="number" placeholder="סכום ₪ *" min={0} step={0.01} value={payF.amount} onChange={e => setPayF(f => ({ ...f, amount: e.target.value }))} required />
            <input className="input text-sm" placeholder="אמצעי תשלום" value={payF.desc} onChange={e => setPayF(f => ({ ...f, desc: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm flex-1 justify-center" disabled={payL}>{payL ? '...' : 'רשום'}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanel(null)}>ביטול</button>
          </div>
        </form>
      )}

      {/* Action buttons */}
      {!panel && folioId && (
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm gap-1 flex-1 justify-center" onClick={() => setPanel('charge')}>
            <Plus size={11} /> חיוב
          </button>
          <button className="btn btn-secondary btn-sm gap-1 flex-1 justify-center"
            onClick={() => { setPayF(f => ({ ...f, amount: balance > 0 ? balance.toFixed(2) : '' })); setPanel('payment'); }}>
            <CreditCard size={11} /> תשלום
          </button>
        </div>
      )}
    </div>
  );
}

// ── Express Checkout Modal ────────────────────────────────────────────────────
function ExpressCheckoutModal({ res, onClose }) {
  const [loading, setLoading] = useState(false);
  const [link,    setLink]    = useState('');
  const [copied,  setCopied]  = useState(false);
  const { toasts, error: toastErr } = useToast();

  const g = res.primaryGuest || {};

  async function generateLink() {
    setLoading(true);
    try {
      const result = await resApi.expressCheckoutLink(String(res._id));
      setLink(result.link);
    } catch (e) { toastErr(e.message); }
    finally { setLoading(false); }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ direction: 'rtl' }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <ToastContainer toasts={toasts} />
        <div className="flex items-center justify-between p-5 border-b border-surface-border">
          <div>
            <div className="font-bold text-ink">Express Checkout</div>
            <div className="text-xs text-ink-muted">{g.firstName} {g.lastName} · {res.confirmationNumber}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div className="text-xs text-ink-secondary">
            שלח לאורח קישור לביצוע צ׳ק-אאוט עצמאי — הוא יוכל לאשר את החשבון ולבצע תשלום ללא מעבר בקבלה.
          </div>
          {!link ? (
            <button className="btn btn-primary w-full justify-center gap-2" onClick={generateLink} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              {loading ? 'יוצר קישור...' : 'צור קישור'}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="p-2.5 bg-surface-hover rounded-lg border border-surface-border">
                <span className="text-xs text-ink-secondary break-all">{link}</span>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary btn-sm flex-1 justify-center gap-1" onClick={copyLink}>
                  <Copy size={12} /> {copied ? 'הועתק!' : 'העתק'}
                </button>
                <a href={`mailto:${g.email || ''}?subject=Express Checkout&body=${link}`}
                  className="btn btn-secondary btn-sm justify-center gap-1" target="_blank" rel="noreferrer">
                  <MessageSquare size={12} /> שלח
                </a>
              </div>
              <div className="text-xs text-ink-faint text-center">תקף ל-24 שעות</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Receipt Modal ─────────────────────────────────────────────────────────────
function ReceiptModal({ res, onClose }) {
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    folioApi.receipt(String(res._id))
      .then(r => setReceipt(r))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const g     = res.primaryGuest || {};
  const folio = receipt?.folio;
  const lines = folio?.lines?.filter(l => l.status === 'posted') || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ direction: 'rtl' }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between p-4 border-b border-surface-border">
          <div className="font-bold text-ink flex items-center gap-2"><Receipt size={16} /> קבלה / חשבונית</div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm gap-1" onClick={() => window.print()}>
              <Printer size={13} /> הדפס
            </button>
            <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5" id="receipt-content">
          {loading && <div className="flex justify-center py-8"><Spinner size={24} /></div>}
          {error   && <div className="text-xs text-red-500 text-center py-4">{error}</div>}
          {!loading && !error && receipt && (
            <div className="flex flex-col gap-4">
              {/* Header */}
              <div className="text-center">
                <div className="font-black text-xl text-ink mb-1">קבלה</div>
                <div className="text-xs text-ink-muted">{new Date(receipt.generatedAt).toLocaleDateString('he-IL')}</div>
              </div>

              {/* Guest & reservation */}
              <div className="bg-surface-hover rounded-xl p-4 text-sm">
                <div className="font-bold text-ink mb-2">{g.firstName} {g.lastName}</div>
                <div className="grid grid-cols-2 gap-y-1 text-xs">
                  <span className="text-ink-muted">מספר הזמנה:</span><span className="font-medium text-num">{res.confirmationNumber}</span>
                  <span className="text-ink-muted">הגעה:</span><span className="font-medium text-num">{res.arrivalDate}</span>
                  <span className="text-ink-muted">עזיבה:</span><span className="font-medium text-num">{res.departureDate}</span>
                  <span className="text-ink-muted">חדר:</span><span className="font-medium">{res.assignedRoom?.number || '—'} · {res.roomType?.name}</span>
                </div>
              </div>

              {/* Lines */}
              <div className="rounded-xl border border-surface-border overflow-hidden">
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#64748b' }}>פריט</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left',  fontWeight: 700, color: '#64748b' }}>סכום</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => (
                      <tr key={String(l._id)} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '5px 10px', color: '#0f172a' }}>{l.description}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'left', fontFamily: 'monospace', fontWeight: 700, color: l.amount < 0 ? '#059669' : '#dc2626' }}>
                          {l.amount < 0 ? '-' : ''}₪{Math.abs(l.amount).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="bg-surface-hover rounded-xl p-4 text-sm flex flex-col gap-1.5">
                <div className="flex justify-between text-ink-muted"><span>סה״כ חיובים:</span><span className="font-semibold text-num text-red-600">₪{receipt.totalCharges?.toFixed(2)}</span></div>
                <div className="flex justify-between text-ink-muted"><span>סה״כ תשלומים:</span><span className="font-semibold text-num text-emerald-600">₪{receipt.totalPayments?.toFixed(2)}</span></div>
                <div className="flex justify-between border-t border-surface-border pt-1.5 mt-1">
                  <span className="font-bold text-ink">יתרה:</span>
                  <span className={`font-black text-num text-lg ${receipt.balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    ₪{Math.abs(receipt.balance).toFixed(2)}
                    {receipt.balance === 0 ? ' ✓' : receipt.balance > 0 ? ' לחיוב' : ' לזיכוי'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Departure Card ─────────────────────────────────────────────────────────────
function DepartureCard({ res, propertyId, onCheckOut }) {
  const [loading,    setLoading]   = useState(false);
  const [forcing,    setForcing]   = useState(false);
  const [showFolio,  setShowFolio] = useState(false);
  const [showExpress,setShowExp]   = useState(false);
  const [showReceipt,setShowReceipt] = useState(false);
  const [checkedOut, setCheckedOut]= useState(false);

  const hasBalance = res.paymentStatus === 'balance_due';
  const room   = res.assignedRoom;
  const nights = res.nights || res.totalNights || '?';
  const total  = res.totalAmount ?? 0;
  const g      = res.primaryGuest || {};
  const initial = `${g.firstName?.slice(0,1) || ''}${g.lastName?.slice(0,1) || ''}`;

  async function handleCheckOut(force = false) {
    setLoading(true);
    try {
      await onCheckOut(String(res._id), force);
      setCheckedOut(true);
      setShowReceipt(true);
    } finally {
      setLoading(false);
      setForcing(false);
    }
  }

  return (
    <div className={`card p-4 ${hasBalance ? 'border-red-200 bg-red-50/20' : ''} ${checkedOut ? 'opacity-70' : ''}`}>
      {showExpress && <ExpressCheckoutModal res={res} onClose={() => setShowExp(false)} />}
      {showReceipt && <ReceiptModal res={res} onClose={() => setShowReceipt(false)} />}

      {/* Guest header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="avatar font-bold"
          style={{ width: 40, height: 40, fontSize: 14, background: 'rgba(249,115,22,0.1)', color: '#ea580c' }}>
          {initial}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-ink">{g.firstName} {g.lastName}</span>
            {res.isVip && <Crown size={12} className="text-yellow-500" />}
          </div>
          <div className="text-xs text-ink-muted">{res.confirmationNumber} · חדר {room?.number || '—'} · {res.roomType?.name}</div>
          <div className="text-xs text-ink-muted">{nights} לילות מ-{res.arrivalDate}</div>
        </div>
        <div className="text-sm font-bold text-num text-ink">₪{Number(total).toLocaleString()}</div>
      </div>

      {/* Balance status */}
      <div className={`flex items-center gap-2 p-2.5 rounded-lg mb-3 text-xs font-semibold ${
        hasBalance ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
        {hasBalance
          ? <><AlertCircle size={13} /> יתרה פתוחה — יש לגבות לפני יציאה</>
          : <><CheckCircle2 size={13} /> חשבון מאוזן — מוכן לצ׳ק-אאוט</>}
      </div>

      {/* Inline Folio */}
      <button
        className="btn btn-ghost btn-sm w-full justify-between text-xs mb-2 gap-1"
        onClick={() => setShowFolio(v => !v)}
      >
        <span className="flex items-center gap-1"><CreditCard size={12} /> Folio / חיובים</span>
        {showFolio ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {showFolio && <FolioSection res={res} propertyId={propertyId} />}

      {/* Force confirm */}
      {forcing && !checkedOut && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 text-xs text-red-700">
          <div className="font-semibold mb-1">אישור יציאה עם יתרה פתוחה</div>
          <div className="mb-2">יציאה תתבצע גם ללא תשלום מלא. האם להמשיך?</div>
          <div className="flex gap-2">
            <button className="btn btn-danger btn-sm flex-1 justify-center" onClick={() => handleCheckOut(true)}>כן, בצע יציאה</button>
            <button className="btn btn-secondary btn-sm flex-1 justify-center" onClick={() => setForcing(false)}>ביטול</button>
          </div>
        </div>
      )}

      {/* Actions */}
      {!forcing && !checkedOut && (
        <div className="flex gap-2 mt-2 flex-wrap">
          <button className="btn btn-secondary btn-sm gap-1 flex-1 justify-center min-w-0" onClick={() => setShowExp(true)}>
            <ExternalLink size={12} /> Express
          </button>
          <button className="btn btn-secondary btn-sm gap-1 flex-1 justify-center min-w-0" onClick={() => setShowReceipt(true)}>
            <Receipt size={12} /> קבלה
          </button>
          <button
            className={`btn btn-sm gap-1 flex-1 justify-center min-w-0 ${hasBalance ? 'btn-danger' : 'btn-primary'}`}
            disabled={loading}
            onClick={() => hasBalance ? setForcing(true) : handleCheckOut(false)}
          >
            <LogOut size={12} />
            {loading ? 'מבצע...' : hasBalance ? 'גבה ויצא' : 'בצע יציאה'}
          </button>
        </div>
      )}

      {/* Post-checkout */}
      {checkedOut && (
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 rounded-lg p-2">
            <CheckCircle2 size={13} /> יציאה בוצעה בהצלחה
          </div>
          <button className="btn btn-secondary btn-sm gap-1" onClick={() => setShowReceipt(true)}>
            <Printer size={12} /> קבלה
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CheckOutPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success, error: toastError } = useToast();

  const { data: departures, loading, error, refetch } = useApi(
    () => dashboard.departures(propertyId),
    [propertyId], skip
  );

  const handleCheckOut = useCallback(async (resId, force) => {
    try {
      await resApi.checkOut(resId, force);
      success('צ׳ק-אאוט בוצע בהצלחה!');
      refetch();
    } catch (e) {
      toastError(e.message || 'שגיאה בביצוע צ׳ק-אאוט');
    }
  }, [refetch, success, toastError]);

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const list = departures || [];

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      <div className="page-header">
        <div>
          <div className="page-title">צ׳ק-אאוט</div>
          <div className="page-subtitle">{list.length} אורחים עוזבים היום</div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty-state mt-8">
          <LogOut size={32} className="empty-state-icon" />
          <span>אין יציאות להיום</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map(res => (
            <DepartureCard
              key={String(res._id)}
              res={res}
              propertyId={propertyId}
              onCheckOut={handleCheckOut}
            />
          ))}
        </div>
      )}
    </div>
  );
}
