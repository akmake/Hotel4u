import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Crown, AlertCircle, CheckCircle2, CreditCard } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { dashboard, reservations as resApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

function DepartureCard({ res, onCheckOut }) {
  const [loading,  setLoading]  = useState(false);
  const [forcing,  setForcing]  = useState(false);

  const hasBalance = res.paymentStatus === 'balance_due';
  const room    = res.assignedRoom;
  const nights  = res.nights || res.totalNights || '?';
  const total   = res.totalAmount ?? res.ratePerNight ?? 0;
  const initial = `${res.primaryGuest?.firstName?.slice(0,1) || ''}${res.primaryGuest?.lastName?.slice(0,1) || ''}`;

  async function handleCheckOut(force = false) {
    setLoading(true);
    try {
      await onCheckOut(String(res._id), force);
    } finally {
      setLoading(false);
      setForcing(false);
    }
  }

  return (
    <div className={`card p-4 ${hasBalance ? 'border-red-200 bg-red-50/20' : ''}`}>
      {/* Guest header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="avatar font-bold"
          style={{ width:40, height:40, fontSize:14, background:'rgba(249,115,22,0.1)', color:'#ea580c' }}>
          {initial}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-ink">
              {res.primaryGuest?.firstName} {res.primaryGuest?.lastName}
            </span>
            {res.isVip && <Crown size={12} className="text-yellow-500" />}
          </div>
          <div className="text-xs text-ink-muted">
            {res.confirmationNumber} · חדר {room?.number || '—'} · {res.roomType?.name}
          </div>
          <div className="text-xs text-ink-muted">{nights} לילות מ-{res.arrivalDate}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-num text-ink">₪{Number(total).toLocaleString()}</div>
        </div>
      </div>

      {/* Balance status */}
      <div className={`flex items-center gap-2 p-2.5 rounded-lg mb-3 text-xs font-semibold ${
        hasBalance
          ? 'bg-red-50 text-red-700 border border-red-200'
          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      }`}>
        {hasBalance
          ? <><AlertCircle size={13} /> יתרה פתוחה — יש לגבות לפני יציאה</>
          : <><CheckCircle2 size={13} /> חשבון מאוזן — מוכן לצ׳ק-אאוט</>}
      </div>

      {/* Force confirm prompt */}
      {forcing && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 text-xs text-red-700">
          <div className="font-semibold mb-1">אישור יציאה עם יתרה פתוחה</div>
          <div className="mb-2">פעולה זו תבצע יציאה גם ללא תשלום מלא. האם להמשיך?</div>
          <div className="flex gap-2">
            <button className="btn btn-danger btn-sm flex-1 justify-center" onClick={() => handleCheckOut(true)}>
              כן, בצע יציאה
            </button>
            <button className="btn btn-secondary btn-sm flex-1 justify-center" onClick={() => setForcing(false)}>
              ביטול
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {!forcing && (
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm flex-1 gap-1 justify-center" onClick={() => navigate('/folio')}>
            <CreditCard size={13} /> Folio
          </button>
          <button
            className={`btn btn-sm flex-1 gap-1 justify-center ${hasBalance ? 'btn-danger' : 'btn-primary'}`}
            disabled={loading}
            onClick={() => hasBalance ? setForcing(true) : handleCheckOut(false)}
          >
            <LogOut size={13} />
            {loading ? 'מבצע...' : hasBalance ? 'גבה ויצא' : 'בצע יציאה'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function CheckOutPage() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
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

      {list.length === 0
        ? (
          <div className="empty-state mt-8">
            <LogOut size={32} className="empty-state-icon" />
            <span>אין יציאות להיום</span>
          </div>
        )
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {list.map(res => (
              <DepartureCard key={String(res._id)} res={res} onCheckOut={handleCheckOut} />
            ))}
          </div>
        )
      }
    </div>
  );
}
