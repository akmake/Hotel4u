import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Crown, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { dashboard, reservations as resApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

function ChecklistItem({ ok, label }) {
  return (
    <div className={`flex items-center gap-2 text-xs ${ok ? 'text-ink-secondary' : 'text-red-500 font-semibold'}`}>
      {ok
        ? <CheckCircle2 size={13} className="text-status-clean flex-shrink-0" />
        : <AlertCircle size={13} className="flex-shrink-0" />}
      {label}
    </div>
  );
}

function ArrivalCard({ res, onCheckIn }) {
  const [loading, setLoading]   = useState(false);
  const [override, setOverride] = useState(false);

  const room      = res.assignedRoom;
  const hasRoom   = !!room;
  const roomReady = hasRoom && (room.cleanStatus === 'clean' || room.cleanStatus === 'inspected');
  const hasPay    = res.paymentStatus !== 'pending';
  const canCheckIn = hasRoom && (roomReady || override) && hasPay;

  async function handleCheckIn() {
    setLoading(true);
    try {
      await onCheckIn(String(res._id), override);
    } finally {
      setLoading(false);
    }
  }

  const total   = res.totalAmount ?? res.ratePerNight ?? 0;
  const nights  = res.nights || res.totalNights || '?';
  const initial = `${res.primaryGuest?.firstName?.slice(0,1) || ''}${res.primaryGuest?.lastName?.slice(0,1) || ''}`;

  return (
    <div className={`card p-4 ${res.isVip ? 'border-yellow-200 bg-yellow-50/20' : ''} ${!canCheckIn && !loading ? 'border-red-100' : ''}`}>
      {/* Guest header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="avatar font-bold"
          style={{ width:40, height:40, fontSize:14,
            background: res.isVip ? 'rgba(234,179,8,0.15)':'rgba(99,102,241,0.1)',
            color: res.isVip ? '#b45309':'#6366f1' }}>
          {initial}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-ink">{res.primaryGuest?.firstName} {res.primaryGuest?.lastName}</span>
            {res.isVip && <Crown size={12} className="text-yellow-500" />}
          </div>
          <div className="text-xs text-ink-muted">{res.confirmationNumber} · {res.roomType?.name}</div>
          <div className="text-xs text-ink-muted">{nights} לילות · עד {res.departureDate}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-num text-ink">₪{Number(total).toLocaleString()}</div>
        </div>
      </div>

      {/* Checklist */}
      <div className="bg-surface-hover rounded-lg p-3 mb-3 flex flex-col gap-1.5">
        <ChecklistItem
          ok={hasRoom}
          label={hasRoom ? `חדר ${room.number} מוקצה` : 'אין חדר מוקצה!'}
        />
        <ChecklistItem
          ok={roomReady}
          label={roomReady
            ? `חדר ${room?.number} נקי ומוכן`
            : `חדר ${room?.number || '—'} — ${room?.cleanStatus === 'dirty' ? 'מלוכלך!' : room?.cleanStatus || 'לא מוכן'}`}
        />
        <ChecklistItem
          ok={hasPay}
          label={hasPay ? 'תשלום / פיקדון תקין' : 'נדרש תשלום!'}
        />
        {res.specialRequests && (
          <div className="text-xs text-brand mt-1 border-t border-surface-border pt-1">
            📌 {res.specialRequests}
          </div>
        )}
      </div>

      {/* Override dirty room */}
      {hasRoom && !roomReady && (
        <label className="flex items-center gap-2 text-xs text-ink-secondary mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={override}
            onChange={e => setOverride(e.target.checked)}
            className="rounded"
          />
          אישור ידני — בצע צ׳ק-אין למרות שהחדר לא מוכן
        </label>
      )}

      {/* Action */}
      <button
        className={`btn w-full justify-center gap-2 ${canCheckIn ? 'btn-primary' : 'btn-secondary'}`}
        disabled={!canCheckIn || loading}
        style={!canCheckIn ? { opacity: 0.55 } : {}}
        onClick={handleCheckIn}
      >
        <LogIn size={14} />
        {loading ? 'מבצע...' : canCheckIn ? 'בצע צ׳ק-אין' : 'לא ניתן לצ׳ק-אין'}
      </button>
    </div>
  );
}

export default function CheckInPage() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const skip = !propertyId;
  const { toasts, success, error: toastError } = useToast();

  const { data: arrivals, loading, error, refetch } = useApi(
    () => dashboard.arrivals(propertyId),
    [propertyId], skip
  );

  const handleCheckIn = useCallback(async (resId, overrideClean) => {
    try {
      await resApi.checkIn(resId, overrideClean);
      success('צ׳ק-אין בוצע בהצלחה!');
      refetch();
    } catch (e) {
      toastError(e.message || 'שגיאה בביצוע צ׳ק-אין');
    }
  }, [refetch, success, toastError]);

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const list = arrivals || [];

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      <div className="page-header">
        <div>
          <div className="page-title">צ׳ק-אין</div>
          <div className="page-subtitle">{list.length} אורחים מגיעים היום</div>
        </div>
        <button className="btn btn-primary gap-1.5" onClick={() => navigate('/reservations')}><LogIn size={14} />Walk-in</button>
      </div>

      {list.length === 0
        ? (
          <div className="empty-state mt-8">
            <LogIn size={32} className="empty-state-icon" />
            <span>אין הגעות להיום</span>
          </div>
        )
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {list.map(res => (
              <ArrivalCard key={String(res._id)} res={res} onCheckIn={handleCheckIn} />
            ))}
          </div>
        )
      }
    </div>
  );
}
