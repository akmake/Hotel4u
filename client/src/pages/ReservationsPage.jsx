import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Search, Plus, Crown, AlertCircle, Calendar, ChevronLeft, ChevronRight,
  X, Filter, TrendingUp, Users, DoorOpen, DoorClosed, BedDouble,
  LogIn, LogOut, Plane, CheckCircle2,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { reservations as resApi, dashboard } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import NewReservationModal from '../components/reservations/NewReservationModal';
import ReservationDrawer from '../components/reservations/ReservationDrawer';

/* ── constants ─────────────────────────────────────── */
const STATUS_LABELS = {
  all:          'הכל',
  in_house:     'In House',
  confirmed:    'מאושר',
  checked_out:  'עזב',
  cancelled:    'בוטל',
  no_show:      'No Show',
  modified:     'שונה',
};
const STATUS_BADGE = {
  in_house:    'badge-inhouse',
  confirmed:   'badge-confirmed',
  checked_out: 'badge-departure',
  cancelled:   'badge-cancelled',
  no_show:     'badge-dirty',
  modified:    'badge-confirmed',
};
const PAY_BADGE = {
  paid:        'badge-clean',
  balance_due: 'badge-dirty',
  pending:     'badge-pending',
  invoiced:    'badge-inhouse',
};
const PAY_LABELS = {
  all:         'כל תשלומים',
  paid:        'שולם',
  balance_due: 'יתרה לתשלום',
  pending:     'ממתין',
  invoiced:    'חשבונית',
};
const SOURCE_FLAGS = {
  direct:   '🏨', booking: '🔵', expedia: '🟡', agoda: '🔴',
  airbnb:   '🟠', phone:   '📞', walk_in: '🚶', other:   '🌐',
};
const SOURCE_LABELS = {
  all: 'כל מקורות', direct: 'ישיר', booking: 'Booking', expedia: 'Expedia',
  agoda: 'Agoda', airbnb: 'Airbnb', phone: 'טלפון', walk_in: 'Walk-in',
};

function todayStr() {
  return new Date().toISOString().split('T')[0];
}
function nightsBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function initials(first, last) {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase();
}
function avatarBg(vip, blacklisted) {
  if (blacklisted) return 'bg-red-200 text-red-800';
  if (vip === 'vvip') return 'bg-amber-200 text-amber-800';
  if (vip === 'vip')  return 'bg-purple-200 text-purple-800';
  return 'bg-brand/10 text-brand';
}

/* ── stat card ─────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, color, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`card flex items-center gap-3 px-4 py-3 text-right transition-all hover:shadow-card ${active ? 'ring-2 ring-brand' : ''}`}
    >
      <span className={`rounded-lg p-2 ${color}`}><Icon size={18} /></span>
      <div>
        <div className={`text-2xl font-bold text-num ${color.replace('bg-','text-').split(' ')[0]}`}>{value ?? '—'}</div>
        <div className="text-xs text-ink-muted">{label}</div>
      </div>
    </button>
  );
}

/* ── calendar view ─────────────────────────────────── */
function CalendarView({ month, year, onPrev, onNext, onDayClick, arrivals, departures, activeDateFilter }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun

  const arrMap = {};
  const depMap = {};
  (arrivals || []).forEach(r => {
    const d = r.arrivalDate?.slice(0, 10);
    if (d) arrMap[d] = (arrMap[d] || 0) + 1;
  });
  (departures || []).forEach(r => {
    const d = r.departureDate?.slice(0, 10);
    if (d) depMap[d] = (depMap[d] || 0) + 1;
  });

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthNames = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
    'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

  return (
    <div className="card p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onPrev} className="btn-icon"><ChevronRight size={16} /></button>
        <span className="font-semibold text-ink">{monthNames[month]} {year}</span>
        <button onClick={onNext} className="btn-icon"><ChevronLeft size={16} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-ink-muted mb-1">
        {['א','ב','ג','ד','ה','ו','ש'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const ds = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const arr = arrMap[ds] || 0;
          const dep = depMap[ds] || 0;
          const isToday = ds === todayStr();
          const isActive = activeDateFilter === ds;
          return (
            <button
              key={i}
              onClick={() => onDayClick(ds)}
              className={`rounded p-1 text-xs flex flex-col items-center transition-all hover:bg-surface-hover
                ${isToday ? 'ring-2 ring-brand' : ''}
                ${isActive ? 'bg-brand/10' : ''}
              `}
            >
              <span className={`font-medium ${isToday ? 'text-brand' : 'text-ink'}`}>{day}</span>
              <div className="flex gap-0.5 mt-0.5">
                {arr > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title={`${arr} הגעות`} />}
                {dep > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title={`${dep} יציאות`} />}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-4 mt-3 text-xs text-ink-muted justify-center">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"/>הגעות</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"/>יציאות</span>
      </div>
    </div>
  );
}

/* ── quick check-in button ─────────────────────────── */
function QuickCheckIn({ resId, roomAssigned, roomClean, onDone }) {
  const { error: toastError, success: toastSuccess } = useToast();
  const [loading, setLoading] = useState(false);
  const [override, setOverride] = useState(false);

  if (!roomAssigned) return (
    <span className="flex items-center gap-1 text-red-500 text-xs">
      <AlertCircle size={12} /> ללא חדר
    </span>
  );

  const canCheckIn = roomClean || override;

  return (
    <div className="flex items-center gap-1">
      {!roomClean && (
        <label className="flex items-center gap-0.5 text-xs text-amber-600 cursor-pointer">
          <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} className="rounded" />
          דרוס
        </label>
      )}
      <button
        disabled={!canCheckIn || loading}
        onClick={async e => {
          e.stopPropagation();
          setLoading(true);
          try {
            await resApi.checkIn(resId, override);
            toastSuccess('צ\'ק-אין בוצע');
            onDone();
          } catch(err) {
            toastError(err.message || 'שגיאה בצ\'ק-אין');
          } finally { setLoading(false); }
        }}
        className="btn btn-primary btn-sm flex items-center gap-1"
      >
        {loading ? <Spinner size="xs" /> : <LogIn size={12} />}
        צ'ק-אין
      </button>
    </div>
  );
}

/* ── main page ─────────────────────────────────────── */
export default function ReservationsPage() {
  const { propertyId } = useProperty();
  const { toasts, success: toastSuccess, error: toastError } = useToast();
  const today = todayStr();

  /* ── state ── */
  const [search, setSearch]             = useState('');
  const [debouncedSearch, setDebounced] = useState('');
  const [statusFilter, setStatus]       = useState('all');
  const [payFilter, setPay]             = useState('all');
  const [sourceFilter, setSource]       = useState('all');
  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');
  const [calOpen, setCalOpen]           = useState(false);
  const [calMonth, setCalMonth]         = useState(new Date().getMonth());
  const [calYear, setCalYear]           = useState(new Date().getFullYear());
  const [dayFilter, setDayFilter]       = useState('');
  const [showNew, setShowNew]           = useState(false);
  const [drawerRes, setDrawerRes]       = useState(null);
  const debounceRef = useRef(null);

  /* ── debounce search ── */
  const handleSearch = useCallback(v => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(v), 350);
  }, []);

  /* ── data ── */
  const statsKey = [propertyId];
  const { data: statsData, loading: statsLoading } = useApi(
    () => dashboard.stats(propertyId), [propertyId], !propertyId
  );
  const stats = statsData?.data || {};

  const listParams = useMemo(() => {
    const p = {};
    if (statusFilter !== 'all') p.status = statusFilter;
    if (payFilter !== 'all')    p.paymentStatus = payFilter;
    if (sourceFilter !== 'all') p.source = sourceFilter;
    if (debouncedSearch)        p.search = debouncedSearch;
    if (dateFrom)               p.dateFrom = dateFrom;
    if (dateTo)                 p.dateTo = dateTo;
    return p;
  }, [statusFilter, payFilter, sourceFilter, debouncedSearch, dateFrom, dateTo]);

  const { data: listData, loading: listLoading, error: listError, refetch } = useApi(
    () => resApi.list(propertyId, listParams), [propertyId, JSON.stringify(listParams)], !propertyId
  );

  const allRes = useMemo(() => listData?.data || [], [listData]);

  /* ── day filter from calendar ── */
  const filteredRes = useMemo(() => {
    if (!dayFilter) return allRes;
    return allRes.filter(r => r.arrivalDate === dayFilter || r.departureDate === dayFilter);
  }, [allRes, dayFilter]);

  /* ── total revenue ── */
  const totalRevenue = useMemo(() =>
    filteredRes.reduce((s, r) => s + (r.totalAmount || 0), 0), [filteredRes]
  );

  /* ── calendar nav ── */
  const handleCalPrev = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };
  const handleCalNext = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  /* ── clear all filters ── */
  const hasFilters = statusFilter !== 'all' || payFilter !== 'all' || sourceFilter !== 'all'
    || debouncedSearch || dateFrom || dateTo || dayFilter;
  const clearFilters = () => {
    setSearch(''); setDebounced(''); setStatus('all'); setPay('all'); setSource('all');
    setDateFrom(''); setDateTo(''); setDayFilter('');
  };

  /* ── stat card filter ── */
  const handleStatClick = (key) => {
    if (key === 'arrivals')   { setStatus('confirmed'); setDateFrom(today); setDateTo(today); }
    if (key === 'departures') { setStatus('in_house');  setDateFrom(today); setDateTo(today); }
    if (key === 'inHouse')    { setStatus('in_house');  setDateFrom('');    setDateTo(''); }
    if (key === 'unassigned') { setStatus('confirmed'); }
  };

  /* ── table row ── */
  function ResRow({ r }) {
    const gFirst = r.primaryGuest?.firstName || '';
    const gLast  = r.primaryGuest?.lastName  || '';
    const vip    = r.primaryGuest?.vipLevel;
    const blk    = r.primaryGuest?.isBlacklisted;
    const nights = nightsBetween(r.arrivalDate, r.departureDate);
    const isArrivalToday   = r.arrivalDate === today && ['confirmed','modified'].includes(r.status);
    const isDepartureToday = r.departureDate === today && ['in_house','checked_in'].includes(r.status);
    const room = r.assignedRoom;

    return (
      <tr
        onClick={() => setDrawerRes(r)}
        className={`cursor-pointer hover:bg-surface-hover transition-colors
          ${isArrivalToday ? 'border-r-4 border-r-emerald-500' : ''}
          ${isDepartureToday ? 'border-r-4 border-r-amber-500' : ''}
        `}
      >
        {/* אישור */}
        <td className="px-3 py-2 text-xs font-mono text-ink-secondary">
          {r.confirmationNumber || r._id?.slice(-6).toUpperCase()}
        </td>
        {/* אורח */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <div className={`avatar text-xs ${avatarBg(vip, blk)}`}>
              {initials(gFirst, gLast)}
            </div>
            <div>
              <div className="flex items-center gap-1 text-sm font-medium text-ink">
                {gFirst} {gLast}
                {(vip === 'vip' || vip === 'vvip') && <Crown size={12} className="text-amber-500" />}
                {blk && <AlertCircle size={12} className="text-red-500" />}
              </div>
              {r.primaryGuest?.country && (
                <div className="text-xs text-ink-faint">{r.primaryGuest.country}</div>
              )}
            </div>
          </div>
        </td>
        {/* חדר */}
        <td className="px-3 py-2 text-sm">
          {room ? (
            <div>
              <div className="font-medium text-ink">{room.number}</div>
              <div className="text-xs text-ink-muted">{r.roomType?.name || '—'}</div>
            </div>
          ) : (
            <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
              <AlertCircle size={12} /> ללא הקצאה
            </span>
          )}
        </td>
        {/* הגעה */}
        <td className="px-3 py-2 text-sm text-ink-secondary">{fmtDate(r.arrivalDate)}</td>
        {/* עזיבה */}
        <td className="px-3 py-2 text-sm text-ink-secondary">{fmtDate(r.departureDate)}</td>
        {/* לילות */}
        <td className="px-3 py-2 text-center text-sm text-num">{nights}</td>
        {/* סה"כ */}
        <td className="px-3 py-2 text-sm text-num text-right">
          {r.totalAmount != null ? `₪${r.totalAmount.toLocaleString('he-IL')}` : '—'}
        </td>
        {/* סטטוס */}
        <td className="px-3 py-2">
          <span className={`badge ${STATUS_BADGE[r.status] || 'badge-pending'}`}>
            {STATUS_LABELS[r.status] || r.status}
          </span>
        </td>
        {/* תשלום */}
        <td className="px-3 py-2">
          {r.paymentStatus && (
            <span className={`badge ${PAY_BADGE[r.paymentStatus] || 'badge-pending'}`}>
              {PAY_LABELS[r.paymentStatus] || r.paymentStatus}
            </span>
          )}
        </td>
        {/* מקור */}
        <td className="px-3 py-2 text-base text-center">
          <span title={SOURCE_LABELS[r.source] || r.source}>
            {SOURCE_FLAGS[r.source] || '🌐'}
          </span>
        </td>
        {/* פעולה מהירה */}
        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
          {isArrivalToday && (
            <QuickCheckIn
              resId={r._id}
              roomAssigned={!!room}
              roomClean={['clean','inspected'].includes(room?.cleanStatus)}
              onDone={refetch}
            />
          )}
          {isDepartureToday && (
            <button
              onClick={async e => {
                e.stopPropagation();
                try {
                  await resApi.checkOut(r._id);
                  toastSuccess('צ\'ק-אאוט בוצע');
                  refetch();
                } catch(err) {
                  toastError(err.message || 'שגיאה');
                }
              }}
              className="btn btn-secondary btn-sm flex items-center gap-1"
            >
              <LogOut size={12} /> צ'ק-אאוט
            </button>
          )}
        </td>
      </tr>
    );
  }

  /* ── render ── */
  return (
    <div className="flex flex-col gap-4 h-full animate-fade-in">
      <ToastContainer toasts={toasts} />

      {/* ─── header ─── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">הזמנות</h1>
          <p className="page-subtitle">ניהול כל ההזמנות והגעות</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCalOpen(v => !v)}
            className={`btn btn-secondary flex items-center gap-2 ${calOpen ? 'ring-2 ring-brand' : ''}`}
          >
            <Calendar size={16} />
            לוח שנה
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="btn btn-primary flex items-center gap-2"
          >
            <Plus size={16} /> הזמנה חדשה
          </button>
        </div>
      </div>

      {/* ─── stats bar ─── */}
      {!statsLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard icon={LogIn}    label="הגעות היום"   value={stats.arrivals}    color="bg-emerald-100 text-emerald-700" onClick={() => handleStatClick('arrivals')}   active={statusFilter==='confirmed' && dateFrom===today} />
          <StatCard icon={LogOut}   label="יציאות היום"  value={stats.departures}  color="bg-amber-100 text-amber-700"    onClick={() => handleStatClick('departures')} active={statusFilter==='in_house'  && dateFrom===today} />
          <StatCard icon={BedDouble} label="In House"    value={stats.inHouse}     color="bg-blue-100 text-blue-700"     onClick={() => handleStatClick('inHouse')}    active={statusFilter==='in_house'  && !dateFrom} />
          <StatCard icon={AlertCircle} label="ללא חדר"  value={stats.unassigned}  color="bg-red-100 text-red-700"       onClick={() => handleStatClick('unassigned')} active={false} />
          <StatCard icon={TrendingUp} label="תפוסה"     value={stats.occupancy != null ? `${stats.occupancy}%` : '—'} color="bg-violet-100 text-violet-700" onClick={() => {}} active={false} />
        </div>
      )}

      {/* ─── calendar ─── */}
      {calOpen && (
        <CalendarView
          month={calMonth}
          year={calYear}
          onPrev={handleCalPrev}
          onNext={handleCalNext}
          onDayClick={d => { setDayFilter(prev => prev === d ? '' : d); }}
          arrivals={allRes}
          departures={allRes}
          activeDateFilter={dayFilter}
        />
      )}

      {/* ─── filters ─── */}
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        {/* search */}
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            className="input pr-8 w-full text-sm"
            placeholder="שם, מספר אישור, טלפון..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>

        {/* status chips */}
        <div className="flex gap-1 flex-wrap">
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setStatus(k)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all
                ${statusFilter === k ? 'bg-brand text-white border-brand' : 'border-surface-border text-ink-secondary hover:bg-surface-hover'}`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* date range */}
        <div className="flex items-center gap-1 text-sm">
          <span className="text-ink-muted text-xs">מ:</span>
          <input type="date" className="input text-xs py-1 px-2" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className="text-ink-muted text-xs">עד:</span>
          <input type="date" className="input text-xs py-1 px-2" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>

        {/* pay filter */}
        <select className="select text-sm py-1" value={payFilter} onChange={e => setPay(e.target.value)}>
          {Object.entries(PAY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {/* source filter */}
        <select className="select text-sm py-1" value={sourceFilter} onChange={e => setSource(e.target.value)}>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {/* clear */}
        {hasFilters && (
          <button onClick={clearFilters} className="btn btn-ghost btn-sm flex items-center gap-1 text-red-500">
            <X size={14} /> נקה
          </button>
        )}
      </div>

      {/* ─── day filter badge ─── */}
      {dayFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="bg-brand/10 text-brand px-3 py-1 rounded-full flex items-center gap-1">
            <Calendar size={13} />
            מסנן לתאריך: {fmtDate(dayFilter)}
            <button onClick={() => setDayFilter('')} className="mr-1 hover:text-red-500"><X size={12} /></button>
          </span>
        </div>
      )}

      {/* ─── table ─── */}
      {listLoading ? (
        <div className="flex-1 flex items-center justify-center"><PageSpinner /></div>
      ) : listError ? (
        <ErrorState message={listError} onRetry={refetch} />
      ) : filteredRes.length === 0 ? (
        <div className="empty-state flex-1">
          <Calendar size={48} className="empty-state-icon" />
          <p className="text-ink-secondary">לא נמצאו הזמנות</p>
          {hasFilters && <button onClick={clearFilters} className="btn btn-secondary btn-sm mt-2">נקה מסננים</button>}
        </div>
      ) : (
        <div className="card overflow-auto flex-1">
          <table className="data-table w-full">
            <thead>
              <tr className="text-xs text-ink-muted">
                <th className="px-3 py-2 text-right">אישור</th>
                <th className="px-3 py-2 text-right">אורח</th>
                <th className="px-3 py-2 text-right">חדר / סוג</th>
                <th className="px-3 py-2 text-right">הגעה</th>
                <th className="px-3 py-2 text-right">עזיבה</th>
                <th className="px-3 py-2 text-center">לילות</th>
                <th className="px-3 py-2 text-right">סה"כ</th>
                <th className="px-3 py-2 text-right">סטטוס</th>
                <th className="px-3 py-2 text-right">תשלום</th>
                <th className="px-3 py-2 text-center">מקור</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredRes.map(r => <ResRow key={r._id} r={r} />)}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── footer ─── */}
      {filteredRes.length > 0 && (
        <div className="flex items-center justify-between text-sm text-ink-muted px-1 pb-2">
          <span>{filteredRes.length} הזמנות</span>
          <span className="text-num font-medium">
            סה"כ הכנסות: ₪{totalRevenue.toLocaleString('he-IL')}
          </span>
        </div>
      )}

      {/* ─── modals ─── */}
      {showNew && (
        <NewReservationModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refetch(); toastSuccess('הזמנה נוצרה בהצלחה'); }}
        />
      )}
      {drawerRes && (
        <ReservationDrawer
          res={drawerRes}
          onClose={() => setDrawerRes(null)}
          onUpdated={() => { refetch(); setDrawerRes(null); }}
        />
      )}
    </div>
  );
}
