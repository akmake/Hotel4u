import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ListChecks, RefreshCw, XCircle, RotateCcw, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Clock, Loader2, Ban, Filter, X,
  ChevronLeft, ChevronRight as ChevronRightIcon,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../hooks/useToast';
import { reservations as reservationsApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  send_confirmation: 'שליחת אישורים',
  cancel:            'ביטול הזמנות',
  mark_no_show:      'סימון No-Show',
  check_in:          "צ'ק-אין",
  check_out:         "צ'ק-אאוט",
  link_group:        'קישור לקבוצה',
  unlink_group:      'ניתוק מקבוצה',
};

const STATUS_CFG = {
  queued:    { label: 'ממתין',     bg: 'rgba(99,102,241,0.1)',   color: '#6366f1', icon: Clock        },
  running:   { label: 'רץ',        bg: 'rgba(59,130,246,0.12)',  color: '#2563eb', icon: Loader2      },
  completed: { label: 'הושלם',     bg: 'rgba(16,185,129,0.1)',   color: '#059669', icon: CheckCircle2 },
  failed:    { label: 'נכשל',      bg: 'rgba(239,68,68,0.1)',    color: '#dc2626', icon: AlertCircle  },
  cancelled: { label: 'בוטל',      bg: 'rgba(100,116,139,0.1)',  color: '#64748b', icon: Ban          },
};

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const POLL_INTERVAL_MS = 4000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(job) {
  const start = job.startedAt ? new Date(job.startedAt) : null;
  const end   = job.completedAt ? new Date(job.completedAt) : null;
  if (!start) return '—';
  const ms = (end || Date.now()) - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function shortId(id) {
  return id ? `…${String(id).slice(-6)}` : '—';
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, bg: 'rgba(0,0,0,0.05)', color: '#64748b', icon: Clock };
  const Icon = cfg.icon;
  const isRunning = status === 'running';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <Icon size={11} className={isRunning ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({ processed, total, succeeded, failed }) {
  if (!total) return <span className="text-ink-faint text-xs">—</span>;
  const pct = Math.round((processed / total) * 100);
  const successPct = Math.round((succeeded / total) * 100);
  const failPct    = Math.round((failed    / total) * 100);
  return (
    <div className="flex flex-col gap-0.5 min-w-[80px]">
      <div className="flex items-center gap-1 text-xs text-ink-secondary">
        <span className="text-emerald-600 font-semibold">{succeeded}</span>
        <span className="text-ink-faint">/</span>
        <span>{total}</span>
        {failed > 0 && <span className="text-red-500 font-semibold">({failed} נכשלו)</span>}
      </div>
      <div className="h-1.5 rounded-full bg-surface-muted w-full overflow-hidden">
        <div
          className="h-full flex"
          style={{ width: `${pct}%`, transition: 'width 0.4s ease' }}
        >
          <div className="bg-emerald-500 flex-1" style={{ flex: successPct }}/>
          <div className="bg-red-400"            style={{ flex: failPct    }}/>
        </div>
      </div>
    </div>
  );
}

// ── Job Result Drill-Down ─────────────────────────────────────────────────────

function JobResultsPanel({ jobId, propertyId }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reservationsApi.bulkJobStatus(jobId, propertyId, true)
      .then(d => { if (!cancelled) setResults(d?.job?.results || []); })
      .catch(e => { if (!cancelled) setError(e.message || 'שגיאה בטעינה'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jobId, propertyId]);

  if (loading) return <div className="py-4 flex justify-center"><Loader2 size={18} className="animate-spin text-ink-faint" /></div>;
  if (error)   return <div className="py-3 text-xs text-red-500 px-4">{error}</div>;
  if (!results?.length) return <div className="py-3 text-xs text-ink-faint px-4">אין נתוני תוצאות</div>;

  const failures = results.filter(r => !r.success);
  const successes = results.filter(r => r.success);

  return (
    <div className="px-4 pb-4 space-y-3" dir="rtl">
      {failures.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-red-600 mb-1.5 flex items-center gap-1">
            <AlertCircle size={13}/> {failures.length} כשלים
          </div>
          <div className="space-y-1">
            {failures.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 bg-red-50 border border-red-100">
                <span className="text-ink-secondary font-mono">{shortId(r.reservationId)}</span>
                <span className="text-red-700 flex-1">{r.error || 'שגיאה לא ידועה'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {successes.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-emerald-600 mb-1.5 flex items-center gap-1">
            <CheckCircle2 size={13}/> {successes.length} הצלחות
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {successes.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs rounded-lg px-3 py-1.5 bg-emerald-50 border border-emerald-100">
                <span className="text-ink-secondary font-mono">{shortId(r.reservationId)}</span>
                {r.status && <span className="text-emerald-700">{r.status}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Job Row ───────────────────────────────────────────────────────────────────

function JobRow({ job, propertyId, onCancel, onRetry, onRetryFailed, busy = false, autoExpand = false, highlighted = false }) {
  const [expanded, setExpanded] = useState(false);
  const isActive   = ACTIVE_STATUSES.has(job.status);
  const canCancel  = ACTIVE_STATUSES.has(job.status) && !job.cancelRequested;
  const canRetry   = job.status === 'failed';
  const canRetryFailed = canRetry && Number(job.failed || 0) > 0;

  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  return (
    <>
      <tr className={`border-b border-surface-border hover:bg-surface-muted/40 transition-colors ${isActive ? 'bg-blue-50/30' : ''} ${highlighted ? 'bg-indigo-50/60' : ''}`}>
        <td className="px-4 py-3">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-ink-secondary hover:text-ink transition-colors"
          >
            {expanded
              ? <ChevronDown size={14} />
              : <ChevronRight size={14} />
            }
            <span className="font-mono text-xs text-ink-faint">{shortId(job.jobId)}</span>
          </button>
        </td>
        <td className="px-4 py-3">
          <span className="text-sm font-medium text-ink">
            {ACTION_LABELS[job.action] || job.action}
          </span>
        </td>
        <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
        <td className="px-4 py-3">
          <ProgressBar
            processed={job.processed}
            total={job.total}
            succeeded={job.succeeded}
            failed={job.failed}
          />
        </td>
        <td className="px-4 py-3 text-xs text-ink-secondary">{job.actorName || '—'}</td>
        <td className="px-4 py-3 text-xs text-ink-secondary">{fmtDate(job.queuedAt)}</td>
        <td className="px-4 py-3 text-xs text-ink-secondary">{fmtDuration(job)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            {canCancel && (
              <button
                onClick={() => onCancel(job.jobId)}
                disabled={busy}
                className="btn-ghost text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                title="בטל עבודה"
              >
                <XCircle size={13}/> בטל
              </button>
            )}
            {canRetry && (
              <button
                onClick={() => onRetry(job)}
                disabled={busy}
                className="btn-ghost text-xs text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                title="הרץ מחדש"
              >
                {busy ? <Loader2 size={13} className="animate-spin"/> : <RotateCcw size={13}/>} Retry
              </button>
            )}
            {canRetryFailed && (
              <button
                onClick={() => onRetryFailed(job)}
                disabled={busy}
                className="btn-ghost text-xs text-violet-700 hover:bg-violet-50 px-2 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Retry failed reservations only"
              >
                <RotateCcw size={13}/> Retry Failed
              </button>
            )}
            {job.cancelRequested && ACTIVE_STATUSES.has(job.status) && (
              <span className="text-xs text-amber-600 flex items-center gap-1">
                <Clock size={11}/> מבטל…
              </span>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface-muted/20">
          <td colSpan={8} className="p-0">
            <JobResultsPanel jobId={job.jobId} propertyId={propertyId} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange }) {
  function set(k, v) { onChange({ ...filters, [k]: v, page: 1 }); }

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-surface rounded-xl border border-surface-border" dir="rtl">
      <Filter size={15} className="text-ink-faint flex-shrink-0"/>

      {/* Status */}
      <select
        value={filters.status || ''}
        onChange={e => set('status', e.target.value)}
        className="input text-sm py-1.5 px-2 min-w-[130px]"
      >
        <option value="">כל הסטטוסים</option>
        {Object.entries(STATUS_CFG).map(([v, { label }]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>

      {/* Action */}
      <select
        value={filters.action || ''}
        onChange={e => set('action', e.target.value)}
        className="input text-sm py-1.5 px-2 min-w-[160px]"
      >
        <option value="">כל הפעולות</option>
        {Object.entries(ACTION_LABELS).map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>

      {/* Date range */}
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-ink-secondary">מ-</label>
        <input
          type="date"
          value={filters.from || ''}
          onChange={e => set('from', e.target.value)}
          className="input text-sm py-1.5 px-2"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-ink-secondary">עד</label>
        <input
          type="date"
          value={filters.to || ''}
          onChange={e => set('to', e.target.value)}
          className="input text-sm py-1.5 px-2"
        />
      </div>

      {/* Clear */}
      {(filters.status || filters.action || filters.from || filters.to) && (
        <button
          onClick={() => onChange({ page: 1, limit: filters.limit })}
          className="btn-ghost text-xs text-ink-secondary flex items-center gap-1 px-2 py-1.5 rounded-lg"
        >
          <X size={12}/> נקה פילטרים
        </button>
      )}
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ pagination, onChange }) {
  if (!pagination || pagination.pages <= 1) return null;
  const { page, pages, total, limit } = pagination;
  const from = (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border" dir="rtl">
      <span className="text-xs text-ink-secondary">{from}–{to} מתוך {total}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="btn-ghost p-1.5 rounded-lg disabled:opacity-40"
        >
          <ChevronRightIcon size={14}/>
        </button>
        <span className="text-xs text-ink px-2">{page} / {pages}</span>
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= pages}
          className="btn-ghost p-1.5 rounded-lg disabled:opacity-40"
        >
          <ChevronLeft size={14}/>
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BulkJobsPage() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { propertyId } = useProperty();
  const { toasts, success, error: toastError } = useToast();

  const [filters,    setFilters]    = useState({ page: 1, limit: 20 });
  const [jobs,       setJobs]       = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(null);
  const [actionBusy, setActionBusy] = useState(new Set());
  const [focusedJob, setFocusedJob] = useState(null);
  const [focusedJobLoading, setFocusedJobLoading] = useState(false);
  const [focusedJobError, setFocusedJobError] = useState(null);
  const [focusMeta, setFocusMeta] = useState(null);

  const pollingRef  = useRef(null);
  const filtersRef  = useRef(filters);
  const focusFilterAutoAppliedRef = useRef(new Set());
  filtersRef.current = filters;
  const focusJobId = useMemo(() => {
    const value = new URLSearchParams(search).get('jobId');
    return value ? String(value) : '';
  }, [search]);

  const fetchJobs = useCallback(async (opts = {}) => {
    if (!propertyId) return;
    const f = opts.filters ?? filtersRef.current;
    const requestedPage = Number(f.page || 1);
    if (!opts.silent) setLoading(true);
    setLoadError(null);
    try {
      const res = await reservationsApi.bulkJobsList(propertyId, {
        ...f,
        focusJobId: focusJobId || undefined,
      });
      setJobs(res?.jobs || []);
      setPagination(res?.pagination || null);
      const focusMeta = res?.focus || null;
      setFocusMeta(focusMeta);
      const shouldAutoJump = (
        !opts.preventAutoJump
        && focusJobId
        && focusMeta
        && focusMeta.matchesFilters
        && !focusMeta.inPage
        && Number(focusMeta.page || 0) > 0
        && Number(focusMeta.page) !== requestedPage
      );
      if (shouldAutoJump) {
        setFilters((prev) => {
          const targetPage = Number(focusMeta.page);
          if (Number(prev.page || 1) === targetPage) return prev;
          return { ...prev, page: targetPage };
        });
      }
    } catch (e) {
      setFocusMeta(null);
      setLoadError(e.message || 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }, [propertyId, focusJobId]);

  const fetchFocusedJob = useCallback(async (opts = {}) => {
    if (!propertyId || !focusJobId) {
      setFocusedJob(null);
      setFocusedJobError(null);
      setFocusedJobLoading(false);
      setFocusMeta(null);
      return;
    }
    if (!opts.silent) setFocusedJobLoading(true);
    setFocusedJobError(null);
    try {
      const res = await reservationsApi.bulkJobStatus(focusJobId, propertyId, false);
      setFocusedJob(res?.job || null);
    } catch (e) {
      setFocusedJob(null);
      setFocusedJobError(e.message || 'שגיאה בטעינת משימה ממוקדת');
    } finally {
      setFocusedJobLoading(false);
    }
  }, [focusJobId, propertyId]);

  // Initial fetch + re-fetch on filter change
  useEffect(() => {
    fetchJobs({ filters });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchJobs, filters.page, filters.limit, filters.status, filters.action, filters.from, filters.to]);

  useEffect(() => {
    fetchFocusedJob({});
  }, [fetchFocusedJob]);

  // Auto-poll while any job is active
  useEffect(() => {
    const hasActiveList = jobs.some(j => ACTIVE_STATUSES.has(j.status));
    const hasActiveFocused = focusedJob && ACTIVE_STATUSES.has(focusedJob.status);
    const shouldPoll = hasActiveList || hasActiveFocused;
    if (shouldPoll && !pollingRef.current) {
      pollingRef.current = setInterval(() => {
        fetchJobs({ silent: true });
        if (focusJobId) fetchFocusedJob({ silent: true });
      }, POLL_INTERVAL_MS);
    } else if (!shouldPoll && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, [jobs, focusedJob, focusJobId, fetchJobs, fetchFocusedJob]);

  function setBusy(jobId, busy) {
    setActionBusy(s => {
      const n = new Set(s);
      busy ? n.add(jobId) : n.delete(jobId);
      return n;
    });
  }

  function buildRetryPayload(job, reservationIds) {
    return {
      propertyId,
      reservationIds,
      action: job.action,
      background: true,
      ...(job.requestPayload || {}),
    };
  }

  function focusOnJob(jobId) {
    if (!jobId) return false;
    const next = String(jobId);
    navigate(`/pms/bulk-jobs?jobId=${encodeURIComponent(next)}`, { replace: true });
    return true;
  }

  async function handleCancel(jobId) {
    if (actionBusy.has(jobId)) return;
    setBusy(jobId, true);
    try {
      await reservationsApi.cancelBulkJob(jobId, propertyId);
      success('העבודה בוטלה');
      await Promise.all([
        fetchJobs({ silent: true }),
        focusJobId ? fetchFocusedJob({ silent: true }) : Promise.resolve(),
      ]);
    } catch (e) {
      toastError(e.message || 'שגיאה בביטול');
    } finally {
      setBusy(jobId, false);
    }
  }

  async function handleRetry(job) {
    if (actionBusy.has(job.jobId)) return;
    setBusy(job.jobId, true);
    try {
      const payload = buildRetryPayload(job, job.reservationIds || []);
      const created = await reservationsApi.bulkActions(payload);
      const createdJobId = created?.job?.jobId ? String(created.job.jobId) : '';
      if (createdJobId) {
        success(`עבודה חדשה נוצרה (${shortId(createdJobId)})`);
        focusOnJob(createdJobId);
      } else {
        success('עבודה חדשה נוצרה');
        await Promise.all([
          fetchJobs({ silent: true }),
          focusJobId ? fetchFocusedJob({ silent: true }) : Promise.resolve(),
        ]);
      }
    } catch (e) {
      toastError(e.message || 'שגיאה ב-Retry');
    } finally {
      setBusy(job.jobId, false);
    }
  }

  async function handleRetryFailed(job) {
    if (actionBusy.has(job.jobId)) return;
    setBusy(job.jobId, true);
    try {
      const created = await reservationsApi.retryBulkJobFailed(job.jobId, propertyId);
      const createdJobId = created?.job?.jobId ? String(created.job.jobId) : '';
      const failedCount = Number(created?.failedCount || created?.job?.total || job.failed || 0);
      if (createdJobId) {
        success(`Retry job created for ${failedCount} failed reservations (${shortId(createdJobId)})`);
        focusOnJob(createdJobId);
      } else {
        success(`Retry job created for ${failedCount} failed reservations`);
        await Promise.all([
          fetchJobs({ silent: true }),
          focusJobId ? fetchFocusedJob({ silent: true }) : Promise.resolve(),
        ]);
      }
    } catch (e) {
      toastError(e.message || 'Retry Failed error');
    } finally {
      setBusy(job.jobId, false);
    }
  }

  const activeCount = useMemo(() => {
    const activeIds = new Set(
      jobs.filter(j => ACTIVE_STATUSES.has(j.status)).map(j => String(j.jobId))
    );
    if (focusedJob && ACTIVE_STATUSES.has(focusedJob.status)) {
      activeIds.add(String(focusedJob.jobId));
    }
    return activeIds.size;
  }, [jobs, focusedJob]);
  const focusInTable = useMemo(() => (
    !!focusJobId && jobs.some((job) => String(job.jobId) === String(focusJobId))
  ), [focusJobId, jobs]);
  const canAlignFocusedFilters = Boolean(
    focusJobId
    && focusedJob
    && focusMeta
    && focusMeta.matchesFilters === false
  );
  const showDetachedFocusedJob = Boolean(focusJobId && focusedJob && !focusInTable);

  const alignFiltersToFocusedJob = useCallback(() => {
    if (!focusedJob) return;
    const nextStatus = focusedJob.status || '';
    const nextAction = focusedJob.action || '';
    setFilters((prev) => {
      const next = {
        ...prev,
        status: nextStatus,
        action: nextAction,
        from: '',
        to: '',
        page: 1,
      };
      const unchanged = (
        prev.status === next.status
        && prev.action === next.action
        && (prev.from || '') === (next.from || '')
        && (prev.to || '') === (next.to || '')
        && Number(prev.page || 1) === Number(next.page || 1)
      );
      return unchanged ? prev : next;
    });
  }, [focusedJob]);

  useEffect(() => {
    if (!canAlignFocusedFilters || !focusJobId) return;
    const key = String(focusJobId);
    if (focusFilterAutoAppliedRef.current.has(key)) return;
    focusFilterAutoAppliedRef.current.add(key);
    alignFiltersToFocusedJob();
    success('בוצעה התאמת פילטרים אוטומטית למשימה הממוקדת');
  }, [canAlignFocusedFilters, focusJobId, alignFiltersToFocusedJob, success]);

  async function refreshAll(opts = {}) {
    await Promise.all([
      fetchJobs(opts),
      focusJobId ? fetchFocusedJob(opts) : Promise.resolve(),
    ]);
  }

  if (!propertyId) return <PageSpinner />;

  return (
    <div className="page-container" dir="rtl">
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <ListChecks size={18} className="text-indigo-600"/>
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink">עבודות Bulk</h1>
            <p className="text-xs text-ink-secondary mt-0.5">היסטוריה ומעקב אחר פעולות אצווה</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {focusJobId && (
            <button
              onClick={() => navigate('/pms/bulk-jobs', { replace: true })}
              className="btn-ghost text-xs px-2.5 py-1.5 rounded-lg"
              title="נקה מיקוד משימה"
            >
              מיקוד: {shortId(focusJobId)} ✕
            </button>
          )}
          {activeCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-full px-2.5 py-1">
              <Loader2 size={11} className="animate-spin"/> {activeCount} פעיל{activeCount !== 1 ? 'ות' : ''}
            </span>
          )}
          <button
            onClick={() => refreshAll({})}
            disabled={loading || focusedJobLoading}
            className="btn-ghost p-2 rounded-lg"
            title="רענן"
          >
            <RefreshCw
              size={15}
              className={(loading || focusedJobLoading) ? 'animate-spin text-ink-faint' : 'text-ink-secondary'}
            />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar filters={filters} onChange={setFilters} />

      {focusJobId && !loading && !focusedJobLoading && !focusedJob && focusedJobError && (
        <div className="card mt-4 px-4 py-3 text-sm border border-red-200 bg-red-50/60 text-red-700">
          לא הצלחנו לטעון את המשימה הממוקדת {shortId(focusJobId)}: {focusedJobError}
        </div>
      )}

      {focusJobId && !loading && !focusedJobLoading && !focusInTable && !focusedJob && !focusedJobError && (
        <div className="card mt-4 px-4 py-3 text-sm border border-amber-200 bg-amber-50/60 text-amber-800">
          המשימה {shortId(focusJobId)} לא נמצאה בעמוד הנוכחי או תחת המסננים הפעילים.
          <button
            className="btn btn-ghost btn-sm mr-2"
            onClick={() => setFilters({ page: 1, limit: 20 })}
          >
            נקה מסננים
          </button>
        </div>
      )}

      {showDetachedFocusedJob && (
        <div className="card mt-4 overflow-hidden border border-indigo-200">
          <div className="px-4 py-2.5 text-xs text-indigo-700 bg-indigo-50/70 border-b border-indigo-100 flex items-center justify-between gap-2">
            <span>משימה ממוקדת מוצגת כאן גם אם אינה חלק מהעמוד/פילטרים הפעילים כרגע.</span>
            {canAlignFocusedFilters && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={alignFiltersToFocusedJob}
              >
                התאם פילטרים למשימה
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="border-b border-surface-border bg-surface-muted/60 text-xs text-ink-secondary">
                  <th className="px-4 py-2.5 font-semibold">ID</th>
                  <th className="px-4 py-2.5 font-semibold">פעולה</th>
                  <th className="px-4 py-2.5 font-semibold">סטטוס</th>
                  <th className="px-4 py-2.5 font-semibold">התקדמות</th>
                  <th className="px-4 py-2.5 font-semibold">מבצע</th>
                  <th className="px-4 py-2.5 font-semibold">נוצר</th>
                  <th className="px-4 py-2.5 font-semibold">משך</th>
                  <th className="px-4 py-2.5 font-semibold">פעולות</th>
                </tr>
              </thead>
              <tbody>
                <JobRow
                  key={focusedJob.jobId}
                  job={focusedJob}
                  propertyId={propertyId}
                  onCancel={handleCancel}
                  onRetry={handleRetry}
                  onRetryFailed={handleRetryFailed}
                  busy={actionBusy.has(focusedJob.jobId)}
                  autoExpand
                  highlighted
                />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card mt-4 overflow-hidden">
        {loadError ? (
          <ErrorState message={loadError} onRetry={() => refreshAll({})} />
        ) : loading && jobs.length === 0 ? (
          <div className="py-16"><PageSpinner /></div>
        ) : jobs.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-ink-faint">
            <ListChecks size={36} className="opacity-20"/>
            <p className="text-sm">אין עבודות bulk להצגה</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-muted/60 text-xs text-ink-secondary">
                    <th className="px-4 py-2.5 font-semibold">ID</th>
                    <th className="px-4 py-2.5 font-semibold">פעולה</th>
                    <th className="px-4 py-2.5 font-semibold">סטטוס</th>
                    <th className="px-4 py-2.5 font-semibold">התקדמות</th>
                    <th className="px-4 py-2.5 font-semibold">מבצע</th>
                    <th className="px-4 py-2.5 font-semibold">נוצר</th>
                    <th className="px-4 py-2.5 font-semibold">משך</th>
                    <th className="px-4 py-2.5 font-semibold">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(job => (
                    <JobRow
                      key={job.jobId}
                      job={job}
                      propertyId={propertyId}
                      onCancel={handleCancel}
                      onRetry={handleRetry}
                      onRetryFailed={handleRetryFailed}
                      busy={actionBusy.has(job.jobId)}
                      autoExpand={focusInTable && String(job.jobId) === String(focusJobId)}
                      highlighted={focusInTable && String(job.jobId) === String(focusJobId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              pagination={pagination}
              onChange={p => setFilters(f => ({ ...f, page: p }))}
            />
          </>
        )}
      </div>
    </div>
  );
}
