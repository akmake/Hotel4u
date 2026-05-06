import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../components/ui/Dialog';
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
const BULK_ACTION_OPTIONS = [
  { value: 'send_confirmation', label: 'שליחת אישור' },
  { value: 'cancel', label: 'ביטול הזמנות' },
  { value: 'mark_no_show', label: 'סימון No Show' },
  { value: 'check_in', label: "צ'ק-אין מרובה" },
  { value: 'check_out', label: "צ'ק-אאוט מרובה" },
  { value: 'link_group', label: 'שיוך לקבוצה' },
  { value: 'unlink_group', label: 'ניתוק מקבוצה' },
];
const BULK_BACKGROUND_UI_THRESHOLD = 80;
function getBulkActionLabel(action) {
  return BULK_ACTION_OPTIONS.find((o) => o.value === action)?.label || action || '';
}

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
  const [selectedReservationIds, setSelectedReservationIds] = useState([]);
  const [bulkAction, setBulkAction]     = useState('');
  const [bulkReason, setBulkReason]     = useState('');
  const [bulkGroupId, setBulkGroupId]   = useState('');
  const [bulkGroupCode, setBulkGroupCode] = useState('');
  const [bulkGroupName, setBulkGroupName] = useState('');
  const [bulkOverrideClean, setBulkOverrideClean] = useState(false);
  const [bulkForceCheckout, setBulkForceCheckout] = useState(false);
  const [bulkLoading, setBulkLoading]   = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkResultSummary, setBulkResultSummary] = useState(null);
  const [bulkJob, setBulkJob] = useState(null);
  const navigate = useNavigate();
  const [drawerRes, setDrawerRes]       = useState(null);
  const debounceRef = useRef(null);
  const bulkPollRef = useRef(null);

  /* ── debounce search ── */
  const handleSearch = useCallback(v => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(v), 350);
  }, []);

  const stopBulkJobPolling = useCallback(() => {
    if (bulkPollRef.current) {
      clearInterval(bulkPollRef.current);
      bulkPollRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    stopBulkJobPolling();
  }, [stopBulkJobPolling]);

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
  const filteredIds = useMemo(
    () => filteredRes.map((r) => String(r._id)),
    [filteredRes]
  );

  useEffect(() => {
    const allIds = new Set(allRes.map((r) => String(r._id)));
    setSelectedReservationIds((prev) => {
      const next = prev.filter((id) => allIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [allRes]);

  /* ── total revenue ── */
  const totalRevenue = useMemo(() =>
    filteredRes.reduce((s, r) => s + (r.totalAmount || 0), 0), [filteredRes]
  );
  const allVisibleSelected = filteredIds.length > 0
    && filteredIds.every((id) => selectedReservationIds.includes(id));
  const selectedCount = selectedReservationIds.length;
  const bulkActionLabel = useMemo(() => getBulkActionLabel(bulkAction), [bulkAction]);
  const reservationLabelsMap = useMemo(() => {
    const map = new Map();
    allRes.forEach((r) => {
      map.set(String(r._id), r.confirmationNumber || String(r._id).slice(-6).toUpperCase());
    });
    return map;
  }, [allRes]);

  /* ── calendar nav ── */
  const handleCalPrev = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };
  const handleCalNext = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  const toggleSelectOne = useCallback((reservationId) => {
    setSelectedReservationIds((prev) => (
      prev.includes(reservationId)
        ? prev.filter((id) => id !== reservationId)
        : [...prev, reservationId]
    ));
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedReservationIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !filteredIds.includes(id));
      }
      const nextSet = new Set(prev);
      filteredIds.forEach((id) => nextSet.add(id));
      return Array.from(nextSet);
    });
  }, [allVisibleSelected, filteredIds]);

  const clearSelection = useCallback(() => {
    setSelectedReservationIds([]);
  }, []);

  const finalizeBulkJobResult = useCallback((jobSnapshot) => {
    const failedRows = (jobSnapshot?.results || []).filter((row) => !row?.success);
    const summary = {
      action: jobSnapshot?.action || bulkAction,
      actionLabel: getBulkActionLabel(jobSnapshot?.action || bulkAction),
      total: Number(jobSnapshot?.total || 0),
      processed: Number(jobSnapshot?.processed || 0),
      succeeded: Number(jobSnapshot?.succeeded || 0),
      failed: Number(jobSnapshot?.failed || 0),
      failedRows,
      completedAt: jobSnapshot?.completedAt || new Date().toISOString(),
    };
    setBulkResultSummary(summary);

    if (summary.failed > 0) {
      const firstErr = failedRows[0]?.error;
      toastError(`בוצעו ${summary.succeeded} הצלחות, ${summary.failed} כשלונות${firstErr ? `: ${firstErr}` : ''}`);
      setSelectedReservationIds(failedRows.map((row) => String(row.reservationId)).filter(Boolean));
    } else {
      toastSuccess(`בוצעה פעולה בהצלחה על ${summary.succeeded} הזמנות`);
      setSelectedReservationIds([]);
    }
  }, [bulkAction, toastError, toastSuccess]);

  const startBulkJobPolling = useCallback((jobId) => {
    if (!propertyId || !jobId) return;
    stopBulkJobPolling();

    bulkPollRef.current = setInterval(async () => {
      try {
        const payload = await resApi.bulkJobStatus(jobId, propertyId, true);
        const jobSnapshot = payload?.job;
        if (!jobSnapshot) return;

        setBulkJob(jobSnapshot);
        if (['completed', 'failed', 'cancelled'].includes(jobSnapshot.status)) {
          stopBulkJobPolling();
          setBulkLoading(false);
          setBulkJob(null);

          if (jobSnapshot.status === 'failed') {
            toastError(jobSnapshot.error || 'פעולת רקע נכשלה');
          } else if (jobSnapshot.status === 'cancelled') {
            toastError('פעולת bulk בוטלה');
          } else {
            finalizeBulkJobResult(jobSnapshot);
          }

          refetch();
        }
      } catch (err) {
        stopBulkJobPolling();
        setBulkLoading(false);
        setBulkJob(null);
        toastError(err.message || 'שגיאה במעקב סטטוס פעולת bulk');
      }
    }, 1200);
  }, [finalizeBulkJobResult, propertyId, refetch, stopBulkJobPolling, toastError]);

  const cancelBulkJob = useCallback(async () => {
    if (!bulkJob?.jobId || !propertyId) return;
    try {
      await resApi.cancelBulkJob(bulkJob.jobId, propertyId);
      toastSuccess('בקשת ביטול נשלחה למשימה');
    } catch (err) {
      toastError(err.message || 'שגיאה בביטול משימה');
    }
  }, [bulkJob, propertyId, toastError, toastSuccess]);

  const getBulkValidationError = useCallback(() => {
    if (!propertyId) return 'Property לא זמין';
    if (!bulkAction) return 'בחר פעולה מרובה';
    if (selectedReservationIds.length === 0) return 'לא נבחרו הזמנות';
    if (bulkAction === 'cancel' && !bulkReason.trim()) return 'נדרשת סיבת ביטול לפעולת ביטול מרובה';
    if (bulkAction === 'link_group' && !bulkGroupId && !bulkGroupCode && !bulkGroupName) {
      return 'מלא לפחות שדה קבוצה אחד (ID / Code / Name)';
    }
    return null;
  }, [
    propertyId,
    bulkAction,
    selectedReservationIds,
    bulkReason,
    bulkGroupId,
    bulkGroupCode,
    bulkGroupName,
  ]);

  const requestBulkActionConfirmation = useCallback(() => {
    const validationError = getBulkValidationError();
    if (validationError) {
      toastError(validationError);
      return;
    }
    setBulkConfirmOpen(true);
  }, [getBulkValidationError, toastError]);

  const runBulkAction = useCallback(async () => {
    const validationError = getBulkValidationError();
    if (validationError) {
      toastError(validationError);
      return;
    }

    setBulkConfirmOpen(false);
    const payload = {
      propertyId,
      reservationIds: selectedReservationIds,
      action: bulkAction,
      background: selectedReservationIds.length >= BULK_BACKGROUND_UI_THRESHOLD,
    };
    if (bulkAction === 'cancel') payload.reason = bulkReason.trim();
    if (bulkAction === 'check_in') payload.overrideClean = bulkOverrideClean;
    if (bulkAction === 'check_out') payload.forceCheckout = bulkForceCheckout;
    if (bulkAction === 'link_group') {
      payload.groupId = bulkGroupId || undefined;
      payload.groupCode = bulkGroupCode || undefined;
      payload.groupName = bulkGroupName || undefined;
    }

    setBulkLoading(true);
    setBulkResultSummary(null);
    setBulkJob(null);
    let delegatedToBackground = false;
    try {
      const result = await resApi.bulkActions(payload);
      if (result?.mode === 'background' && result?.job?.jobId) {
        delegatedToBackground = true;
        setBulkJob(result.job);
        toastSuccess(`הפעולה עברה לרקע. מזהה משימה: ${result.job.jobId.slice(-8)}`);
        startBulkJobPolling(result.job.jobId);
        return;
      }

      const total = Number(result?.total || selectedReservationIds.length || 0);
      const processed = Number(result?.processed || 0);
      const succeeded = Number(result?.succeeded || 0);
      const failed = Number(result?.failed || 0);
      const resultRows = Array.isArray(result?.results) ? result.results : [];
      const failedRows = resultRows.filter((row) => !row?.success);

      setBulkResultSummary({
        action: bulkAction,
        actionLabel: bulkActionLabel,
        total,
        processed,
        succeeded,
        failed,
        failedRows,
        completedAt: new Date().toISOString(),
      });

      if (failed > 0) {
        const firstErr = failedRows[0]?.error;
        toastError(`בוצעו ${succeeded} הצלחות, ${failed} כשלונות${firstErr ? `: ${firstErr}` : ''}`);
        setSelectedReservationIds(failedRows.map((row) => String(row.reservationId)).filter(Boolean));
      } else {
        toastSuccess(`בוצעה פעולה בהצלחה על ${succeeded} הזמנות`);
        setSelectedReservationIds([]);
      }
      refetch();
    } catch (err) {
      toastError(err.message || 'שגיאה בפעולת bulk');
    } finally {
      if (!delegatedToBackground) setBulkLoading(false);
    }
  }, [
    propertyId,
    bulkAction,
    bulkActionLabel,
    selectedReservationIds,
    bulkReason,
    bulkOverrideClean,
    bulkForceCheckout,
    bulkGroupId,
    bulkGroupCode,
    bulkGroupName,
    getBulkValidationError,
    finalizeBulkJobResult,
    refetch,
    startBulkJobPolling,
    toastError,
    toastSuccess,
  ]);

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
    const rowId = String(r._id);
    const isSelected = selectedReservationIds.includes(rowId);
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
        {/* בחירה מרובה */}
        <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelectOne(rowId)}
            disabled={bulkLoading}
            className="w-4 h-4 rounded"
            aria-label={`בחר הזמנה ${r.confirmationNumber || rowId}`}
          />
        </td>
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
            onClick={() => navigate('/pms/reservations/new')}
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

      {/* ─── bulk actions ─── */}
      {selectedReservationIds.length > 0 && (
        <div className="card p-3 flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-ink-secondary">
            נבחרו {selectedReservationIds.length} הזמנות
          </span>

          <select
            className="select text-sm py-1"
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            disabled={bulkLoading}
          >
            <option value="">בחר פעולה מרובה...</option>
            {BULK_ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {bulkAction === 'cancel' && (
            <input
              className="input text-sm py-1 px-2 min-w-56"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="סיבת ביטול..."
              disabled={bulkLoading}
            />
          )}
          {bulkAction === 'check_in' && (
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 rounded"
                checked={bulkOverrideClean}
                onChange={(e) => setBulkOverrideClean(e.target.checked)}
                disabled={bulkLoading}
              />
              Override ניקיון
            </label>
          )}
          {bulkAction === 'check_out' && (
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 rounded"
                checked={bulkForceCheckout}
                onChange={(e) => setBulkForceCheckout(e.target.checked)}
                disabled={bulkLoading}
              />
              Force checkout
            </label>
          )}
          {bulkAction === 'link_group' && (
            <>
              <input
                className="input text-sm py-1 px-2 min-w-36"
                value={bulkGroupId}
                onChange={(e) => setBulkGroupId(e.target.value)}
                placeholder="Group ID"
                disabled={bulkLoading}
              />
              <input
                className="input text-sm py-1 px-2 min-w-28"
                value={bulkGroupCode}
                onChange={(e) => setBulkGroupCode(e.target.value)}
                placeholder="Group Code"
                disabled={bulkLoading}
              />
              <input
                className="input text-sm py-1 px-2 min-w-40"
                value={bulkGroupName}
                onChange={(e) => setBulkGroupName(e.target.value)}
                placeholder="Group Name"
                disabled={bulkLoading}
              />
            </>
          )}

          <button
            onClick={requestBulkActionConfirmation}
            disabled={bulkLoading || !bulkAction}
            className="btn btn-primary btn-sm flex items-center gap-1"
          >
            {bulkLoading ? <Spinner size="xs" /> : <CheckCircle2 size={12} />}
            {bulkLoading ? 'מריץ...' : 'בצע'}
          </button>
          <button onClick={clearSelection} disabled={bulkLoading} className="btn btn-ghost btn-sm text-red-500 disabled:opacity-50">
            נקה בחירה
          </button>

          {bulkLoading && (
            <div className="w-full flex items-center gap-2 text-xs text-brand">
              <Spinner size="xs" />
              {bulkJob
                ? `משימה ברקע: ${bulkJob.processed || 0}/${bulkJob.total || selectedCount} (${bulkJob.status})`
                : `מריץ "${bulkActionLabel}" על ${selectedCount} הזמנות...`}
              {bulkJob?.jobId && !['completed', 'failed', 'cancelled'].includes(String(bulkJob.status || '')) && (
                <button
                  className="btn btn-ghost btn-sm text-red-600 ml-2"
                  onClick={cancelBulkJob}
                >
                  בטל משימה
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {bulkResultSummary && (
        <div className={`card p-3 ${bulkResultSummary.failed > 0 ? 'border border-amber-300 bg-amber-50/50' : 'border border-emerald-300 bg-emerald-50/50'}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-semibold text-ink">סיכום פעולה:</span>{' '}
              <span className="text-ink-secondary">{bulkResultSummary.actionLabel || bulkResultSummary.action}</span>{' '}
              <span className="text-ink-muted">({new Date(bulkResultSummary.completedAt).toLocaleTimeString('he-IL')})</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setBulkResultSummary(null)} disabled={bulkLoading}>
              הסתר
            </button>
          </div>

          <div className="mt-2 text-xs text-ink-secondary flex flex-wrap gap-x-4 gap-y-1">
            <span>סה"כ: <strong className="text-ink">{bulkResultSummary.total}</strong></span>
            <span>טופלו: <strong className="text-ink">{bulkResultSummary.processed}</strong></span>
            <span>הצלחות: <strong className="text-emerald-700">{bulkResultSummary.succeeded}</strong></span>
            <span>כשלונות: <strong className={bulkResultSummary.failed > 0 ? 'text-red-700' : 'text-ink'}>{bulkResultSummary.failed}</strong></span>
          </div>

          {bulkResultSummary.failedRows?.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-medium text-red-700 mb-1">פרטי כשלים:</div>
              <div className="space-y-1">
                {bulkResultSummary.failedRows.slice(0, 6).map((row) => {
                  const rid = String(row?.reservationId || '');
                  const label = reservationLabelsMap.get(rid) || rid || '—';
                  return (
                    <div key={rid} className="text-xs text-red-700">
                      #{label}: {row?.error || 'שגיאה לא ידועה'}
                    </div>
                  );
                })}
              </div>
              {bulkResultSummary.failedRows.length > 6 && (
                <div className="text-xs text-red-700 mt-1">
                  ועוד {bulkResultSummary.failedRows.length - 6} כשלים...
                </div>
              )}
            </div>
          )}
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
                <th className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    disabled={bulkLoading}
                    className="w-4 h-4 rounded"
                    aria-label="בחר הכל"
                  />
                </th>
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
      <Dialog open={bulkConfirmOpen} onOpenChange={(open) => { if (!bulkLoading) setBulkConfirmOpen(open); }}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>אישור פעולה מרובה</DialogTitle>
            <DialogDescription>
              עומדים לבצע "{bulkActionLabel}" על {selectedCount} הזמנות. הפעולה עשויה להשפיע על סטטוס ההזמנה ולא תמיד ניתנת לשחזור.
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm text-ink-secondary space-y-1">
            {bulkAction === 'cancel' && <div>סיבת ביטול: <strong className="text-ink">{bulkReason.trim() || '—'}</strong></div>}
            {bulkAction === 'check_in' && <div>Override ניקיון: <strong className="text-ink">{bulkOverrideClean ? 'כן' : 'לא'}</strong></div>}
            {bulkAction === 'check_out' && <div>Force checkout: <strong className="text-ink">{bulkForceCheckout ? 'כן' : 'לא'}</strong></div>}
            {bulkAction === 'link_group' && (
              <div>
                קבוצה:
                {' '}
                <strong className="text-ink">
                  {bulkGroupName || bulkGroupCode || bulkGroupId || '—'}
                </strong>
              </div>
            )}
          </div>

          <DialogFooter>
            <button
              className="btn btn-ghost"
              onClick={() => setBulkConfirmOpen(false)}
              disabled={bulkLoading}
            >
              ביטול
            </button>
            <button
              className="btn btn-primary flex items-center gap-2"
              onClick={runBulkAction}
              disabled={bulkLoading}
            >
              {bulkLoading ? <Spinner size="xs" /> : <CheckCircle2 size={14} />}
              {bulkLoading ? 'מבצע...' : 'אישור וביצוע'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {drawerRes && (
        <ReservationDrawer
          res={drawerRes}
          onClose={() => setDrawerRes(null)}
          onChanged={() => { refetch(); setDrawerRes(null); }}
        />
      )}
    </div>
  );
}
