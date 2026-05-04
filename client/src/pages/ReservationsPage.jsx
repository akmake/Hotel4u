import { useState, useCallback } from 'react';
import { Search, Plus, Crown, AlertCircle, Calendar } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { reservations as resApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import NewReservationModal from '../components/reservations/NewReservationModal';
import ReservationDrawer from '../components/reservations/ReservationDrawer';

const STATUS_LABELS = {
  in_house:     'In House',
  confirmed:    'מאושר',
  checked_out:  'עזב',
  cancelled:    'בוטל',
  no_show:      'No Show',
};

const STATUS_BADGE = {
  in_house:    'badge-inhouse',
  confirmed:   'badge-confirmed',
  checked_out: 'badge-departure',
  cancelled:   'badge-cancelled',
  no_show:     'badge-dirty',
};

const PAY_BADGE = {
  paid:        'badge-clean',
  balance_due: 'badge-dirty',
  pending:     'badge-pending',
  partial:     'badge-departure',
};

const PAY_LABEL = {
  paid: 'שולם', balance_due: 'יתרה', pending: 'Pending', partial: 'חלקי',
};

const SOURCE_FLAGS = { booking:'🌐', expedia:'🔷', agoda:'🟠', direct:'🏨' };

function StatusBadge({ status }) {
  return <span className={`badge ${STATUS_BADGE[status] || 'badge-pending'}`}>{STATUS_LABELS[status] || status}</span>;
}

function PayBadge({ status }) {
  return <span className={`badge ${PAY_BADGE[status] || 'badge-pending'}`}>{PAY_LABEL[status] || status}</span>;
}

const FILTER_STATUSES = ['all','confirmed','in_house','checked_out','cancelled'];

export default function ReservationsPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success } = useToast();

  const [search,       setSearch]   = useState('');
  const [filterStatus, setFilter]   = useState('all');
  const [showNew,      setShowNew]  = useState(false);
  const [drawerRes,    setDrawer]   = useState(null);

  const buildParams = useCallback(() => {
    const p = { limit: 200 };
    if (filterStatus !== 'all') p.status = filterStatus;
    if (search.trim()) p.q = search.trim();
    return p;
  }, [filterStatus, search]);

  const { data, loading, error, refetch } = useApi(
    () => resApi.list(propertyId, buildParams()),
    [propertyId, filterStatus, search],
    skip
  );

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const list = data || [];

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />
      {drawerRes && (
        <ReservationDrawer
          res={drawerRes}
          onClose={() => setDrawer(null)}
          onChanged={() => { setDrawer(null); refetch(); success('הזמנה עודכנה'); }}
          onFolio={() => setDrawer(null)}
        />
      )}
      {showNew && (
        <NewReservationModal
          propertyId={propertyId}
          onClose={() => setShowNew(false)}
          onCreated={() => { success('הזמנה נוצרה בהצלחה!'); refetch(); }}
        />
      )}
      <div className="page-header">
        <div>
          <div className="page-title">הזמנות</div>
          <div className="page-subtitle">{list.length} הזמנות מוצגות</div>
        </div>
        <button className="btn btn-primary gap-1.5" onClick={() => setShowNew(true)}><Plus size={14} /> הזמנה חדשה</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <input
            className="input pr-8 text-xs"
            placeholder="חיפוש לפי שם אורח, מספר אישור..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {FILTER_STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`btn btn-sm ${filterStatus === s ? 'btn-primary' : 'btn-secondary'}`}
          >
            {s === 'all' ? 'הכל' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>מספר אישור</th>
              <th>אורח</th>
              <th>חדר / סוג</th>
              <th>הגעה</th>
              <th>עזיבה</th>
              <th>לילות</th>
              <th>סה"כ</th>
              <th>סטטוס</th>
              <th>תשלום</th>
              <th>מקור</th>
            </tr>
          </thead>
          <tbody>
            {list.map(res => {
              const guest    = res.primaryGuest;
              const initials = `${guest?.firstName?.slice(0,1) || ''}${guest?.lastName?.slice(0,1) || ''}`;
              const nights   = res.nights || res.totalNights || '—';
              const total    = res.totalAmount ?? res.ratePerNight;

              return (
                <tr key={String(res._id)} className="cursor-pointer" onClick={() => setDrawer(res)}>
                  <td>
                    <span className="font-mono text-xs font-bold text-brand">{res.confirmationNumber}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="avatar text-xs flex-shrink-0"
                        style={{ width:28, height:28, fontSize:10,
                          background: res.isVip ? 'rgba(139,92,246,0.12)':'rgba(99,102,241,0.1)',
                          color: res.isVip ? '#7c3aed':'#6366f1' }}>
                        {initials}
                      </div>
                      <div>
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-ink">
                            {guest?.firstName} {guest?.lastName}
                          </span>
                          {res.isVip && <Crown size={10} className="text-yellow-500" />}
                        </div>
                        <div className="text-xs text-ink-muted">{guest?.country || guest?.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {res.assignedRoom
                      ? <div className="font-semibold text-num">חדר {res.assignedRoom.number}</div>
                      : <span className="text-xs text-red-500 font-medium">ללא הקצאה</span>}
                    <div className="text-xs text-ink-muted">{res.roomType?.name}</div>
                  </td>
                  <td className="text-num text-xs">{res.arrivalDate}</td>
                  <td className="text-num text-xs">{res.departureDate}</td>
                  <td className="text-num text-xs">{nights}</td>
                  <td className="text-num font-semibold">
                    {total != null ? `₪${Number(total).toLocaleString()}` : '—'}
                  </td>
                  <td><StatusBadge status={res.status} /></td>
                  <td>
                    <div className="flex items-center gap-1">
                      <PayBadge status={res.paymentStatus} />
                      {res.paymentStatus === 'balance_due' && <AlertCircle size={11} className="text-red-500" />}
                    </div>
                  </td>
                  <td>
                    <span className="text-xs text-ink-muted">
                      {SOURCE_FLAGS[res.source] || '📋'} {res.source || 'direct'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && (
          <div className="empty-state">
            <Calendar size={28} className="empty-state-icon" />
            <span>לא נמצאו הזמנות</span>
          </div>
        )}
      </div>
    </div>
  );
}
