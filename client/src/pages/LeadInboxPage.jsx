import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Clock3,
  Funnel,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  UserCheck,
  UserRoundX,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { crm, properties as propertiesApi } from '../utils/api';
import { normalizeCrmSla } from '../utils/crmSla';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const STATUS_HE = {
  new: '׳—׳“׳©',
  working: '׳‘׳˜׳™׳₪׳•׳',
  qualified: '׳׳•׳›׳©׳¨',
  disqualified: '׳׳ ׳׳×׳׳™׳',
  converted: '׳”׳•׳׳¨',
  lost: '׳׳‘׳•׳“',
};

const SOURCE_HE = {
  website_form: '׳˜׳•׳₪׳¡ ׳׳×׳¨',
  import: '׳™׳™׳‘׳•׳',
  manual: '׳™׳“׳ ׳™',
  referral: '׳”׳₪׳ ׳™׳”',
  event: '׳׳™׳¨׳•׳¢',
  partner: '׳©׳•׳×׳£',
  ad: '׳§׳׳₪׳™׳™׳',
  api: 'API',
  other: '׳׳—׳¨',
};

const ACTIONABLE_STATUSES = ['new', 'working', 'qualified'];

function toDate(value) {
  return value ? new Date(value) : null;
}

function daysAgo(value) {
  const dt = toDate(value);
  if (!dt) return null;
  return Math.floor((Date.now() - dt.getTime()) / 86400000);
}

function isoDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}

function isNextActionOverdue(lead, sla) {
  if (!lead.nextActionAt) return false;
  const graceMs = Number(sla?.leadDueGraceHours || 0) * 3600000;
  return new Date(lead.nextActionAt).getTime() + graceMs < Date.now();
}

function leadPriority(lead, sla) {
  const total = Number(lead?.score?.total || 0);
  const staleBy = daysAgo(lead.lastActivityAt || lead.createdAt) ?? 0;
  const overdueNextAction = isNextActionOverdue(lead, sla);
  const inActionableState = ACTIONABLE_STATUSES.includes(lead.status);
  const staleLimit = Number(sla?.leadStaleDays || 7);

  let score = total;
  if (!lead.owner) score += 20;
  if (lead.status === 'new') score += 14;
  if (lead.status === 'working') score += 8;
  if (staleBy >= staleLimit) score += Math.min(25, staleBy);
  if (overdueNextAction) score += 18;
  if (!lead.owner && total >= Number(sla?.leadHighScoreThreshold || 65)) score += 8;
  if (!inActionableState) score -= 40;
  return score;
}

function isNeedsAttentionLead(lead, sla) {
  if (!ACTIONABLE_STATUSES.includes(lead.status)) return false;
  const score = Number(lead?.score?.total || 0);
  const staleBy = daysAgo(lead.lastActivityAt || lead.createdAt) ?? 0;
  const overdue = isNextActionOverdue(lead, sla);
  const staleLimit = Number(sla?.leadStaleDays || 7);
  const hotScore = Number(sla?.leadHighScoreThreshold || 65);
  const attentionThreshold = Number(sla?.leadAttentionScoreThreshold || 85);
  if (overdue) return true;
  if (!lead.owner && score >= hotScore) return true;
  if (staleBy >= staleLimit) return true;
  if (leadPriority(lead, sla) >= attentionThreshold) return true;
  return false;
}

function urgencyBadge(lead, sla) {
  const staleDays = daysAgo(lead.lastActivityAt || lead.createdAt) ?? 0;
  const total = Number(lead?.score?.total || 0);
  const overdue = isNextActionOverdue(lead, sla);
  const staleLimit = Number(sla?.leadStaleDays || 7);
  const hotScore = Number(sla?.leadHighScoreThreshold || 65);

  if (overdue) return { cls: 'badge-dirty', label: '׳₪׳¢׳•׳׳” ׳‘׳׳™׳—׳•׳¨' };
  if (total >= hotScore && !lead.owner) return { cls: 'badge-arrival', label: '׳—׳ ׳׳ ׳׳©׳•׳™׳' };
  if (staleDays >= staleLimit) return { cls: 'badge-pending', label: `׳×׳§׳•׳¢ ${staleDays} ׳™׳׳™׳` };
  if (lead.status === 'new') return { cls: 'badge-inhouse', label: '׳›׳ ׳™׳¡׳” ׳—׳“׳©׳”' };
  return { cls: 'badge-clean', label: '׳‘׳×׳ ׳•׳¢׳”' };
}

function statusBadge(status) {
  if (status === 'converted') return 'badge-clean';
  if (status === 'qualified') return 'badge-arrival';
  if (status === 'working') return 'badge-inhouse';
  if (status === 'disqualified' || status === 'lost') return 'badge-cancelled';
  return 'badge-pending';
}

function scoreTone(total) {
  if (total >= 80) return { cls: 'badge-clean', label: '׳—׳' };
  if (total >= 55) return { cls: 'badge-arrival', label: '׳’׳‘׳•׳”' };
  if (total >= 30) return { cls: 'badge-pending', label: '׳‘׳™׳ ׳•׳ ׳™' };
  return { cls: 'badge-cancelled', label: '׳ ׳׳•׳' };
}

function metricBar(value, max = 100, good = true) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(value || 0) / max) * 100)));
  const bg = good ? '#6366f1' : '#ef4444';
  return (
    <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bg }} />
    </div>
  );
}

export default function LeadInboxPage() {
  const { propertyId } = useProperty();
  const { user } = useAuth();
  const skip = !propertyId;
  const { toasts, success, error: toastError, warn } = useToast();

  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [ownershipFilter, setOwnershipFilter] = useState('all');
  const [queueMode, setQueueMode] = useState('all');
  const [sortBy, setSortBy] = useState('priority');
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [bulkStatus, setBulkStatus] = useState('working');
  const [busyKey, setBusyKey] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkUndo, setBulkUndo] = useState(null);
  const [nextStatus, setNextStatus] = useState('working');
  const [nextActionDate, setNextActionDate] = useState('');
  const debounceRef = useRef(null);
  const undoTimerRef = useRef(null);

  const onSearch = useCallback((value) => {
    setQ(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 260);
  }, []);

  const {
    data: leadResp,
    loading,
    error,
    refetch,
  } = useApi(
    () => crm.leads(propertyId, {
      q: search,
      status: statusFilter === 'all' ? '' : statusFilter,
      source: sourceFilter === 'all' ? '' : sourceFilter,
      limit: 200,
      page: 1,
    }),
    [propertyId, search, statusFilter, sourceFilter],
    skip
  );

  const { data: overview, refetch: refetchOverview } = useApi(
    () => crm.overview(propertyId),
    [propertyId],
    skip
  );

  const { data: routingRules } = useApi(
    () => crm.leadRoutingRules(propertyId),
    [propertyId],
    skip
  );

  const { data: propertyDetails } = useApi(
    () => propertiesApi.get(propertyId),
    [propertyId],
    skip
  );

  const crmSla = useMemo(
    () => normalizeCrmSla(propertyDetails?.crmSla || {}),
    [propertyDetails?.crmSla]
  );

  const leads = useMemo(() => leadResp?.items || [], [leadResp]);

  const filteredLeads = useMemo(() => {
    let items = [...leads];

    if (ownershipFilter === 'unassigned') items = items.filter((l) => !l.owner);
    if (ownershipFilter === 'assigned') items = items.filter((l) => !!l.owner);
    if (ownershipFilter === 'mine') items = items.filter((l) => String(l.owner?._id || l.owner?.id || '') === String(user?.id || ''));

    if (queueMode === 'hot') items = items.filter((l) => Number(l?.score?.total || 0) >= Number(crmSla.leadHighScoreThreshold || 65));
    if (queueMode === 'stale') items = items.filter((l) => (daysAgo(l.lastActivityAt || l.createdAt) || 0) >= Number(crmSla.leadStaleDays || 7));
    if (queueMode === 'due') items = items.filter((l) => isNextActionOverdue(l, crmSla));
    if (queueMode === 'unassigned') items = items.filter((l) => !l.owner);
    if (queueMode === 'attention') items = items.filter((l) => isNeedsAttentionLead(l, crmSla));

    if (sortBy === 'priority') items.sort((a, b) => leadPriority(b, crmSla) - leadPriority(a, crmSla));
    if (sortBy === 'score') items.sort((a, b) => Number(b?.score?.total || 0) - Number(a?.score?.total || 0));
    if (sortBy === 'newest') items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (sortBy === 'stale') items.sort((a, b) => (daysAgo(b.lastActivityAt || b.createdAt) || 0) - (daysAgo(a.lastActivityAt || a.createdAt) || 0));

    return items;
  }, [leads, ownershipFilter, queueMode, sortBy, user?.id, crmSla]);

  const selectedIdSet = useMemo(() => new Set(selectedLeadIds), [selectedLeadIds]);

  const selectedLead = useMemo(
    () => filteredLeads.find((l) => l._id === selectedLeadId) || filteredLeads[0] || null,
    [filteredLeads, selectedLeadId]
  );

  useEffect(() => {
    setSelectedLeadIds((prev) => {
      const valid = new Set(filteredLeads.map((lead) => lead._id));
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredLeads]);

  useEffect(() => {
    if (!selectedLead) {
      setSelectedLeadId('');
      setNextActionDate('');
      return;
    }
    setSelectedLeadId(selectedLead._id);
    setNextStatus(selectedLead.status || 'working');
    setNextActionDate(isoDate(selectedLead.nextActionAt));
  }, [selectedLead?._id]);

  useEffect(() => () => {
    clearTimeout(undoTimerRef.current);
  }, []);

  const stats = useMemo(() => {
    const counts = {
      new: 0,
      working: 0,
      qualified: 0,
      converted: 0,
      hotUnassigned: 0,
      stale: 0,
      due: 0,
      attention: 0,
    };
    leads.forEach((lead) => {
      if (counts[lead.status] !== undefined) counts[lead.status] += 1;
      if (Number(lead?.score?.total || 0) >= Number(crmSla.leadHighScoreThreshold || 65) && !lead.owner) counts.hotUnassigned += 1;
      if ((daysAgo(lead.lastActivityAt || lead.createdAt) || 0) >= Number(crmSla.leadStaleDays || 7)) counts.stale += 1;
      if (isNextActionOverdue(lead, crmSla)) counts.due += 1;
      if (isNeedsAttentionLead(lead, crmSla)) counts.attention += 1;
    });
    return counts;
  }, [leads, crmSla]);

  const needsAttention = useMemo(
    () => filteredLeads.filter((lead) => isNeedsAttentionLead(lead, crmSla)).slice(0, 6),
    [filteredLeads, crmSla]
  );

  async function refreshAll() {
    await Promise.all([refetch(), refetchOverview()]);
  }

  function toggleLeadSelection(leadId) {
    setSelectedLeadIds((prev) => (
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]
    ));
  }

  function clearSelection() {
    setSelectedLeadIds([]);
  }

  function toggleSelectAllFiltered() {
    const ids = filteredLeads.map((lead) => lead._id);
    if (!ids.length) return;
    const allSelected = ids.every((id) => selectedIdSet.has(id));
    setSelectedLeadIds(allSelected ? [] : ids);
  }

  function ownerIdFromLead(lead) {
    if (!lead?.owner) return null;
    if (typeof lead.owner === 'string') return lead.owner;
    return lead.owner._id || lead.owner.id || null;
  }

  function findLeadById(leadId) {
    return leads.find((lead) => lead._id === leadId) || null;
  }

  function setBulkUndoWindow(payload) {
    clearTimeout(undoTimerRef.current);
    if (!payload) {
      setBulkUndo(null);
      return;
    }
    setBulkUndo({
      ...payload,
      expiresAt: Date.now() + 10000,
    });
    undoTimerRef.current = setTimeout(() => setBulkUndo(null), 10000);
  }

  async function runBulkAction(actionLabel, task, options = {}) {
    if (!selectedLeadIds.length) return;
    setBulkBusy(true);
    try {
      const outcomes = await Promise.allSettled(selectedLeadIds.map((id) => task(id)));
      const ok = outcomes.filter((o) => o.status === 'fulfilled').length;
      const fail = outcomes.length - ok;
      if (ok) success(`${actionLabel}: ${ok} ׳¢׳•׳“׳›׳ ׳•`);
      if (fail) warn(`${actionLabel}: ${fail} ׳ ׳›׳©׳׳•`);
      if (ok > 0 && options.undoItems?.length) {
        setBulkUndoWindow({ label: options.undoLabel || actionLabel, items: options.undoItems });
      } else {
        setBulkUndoWindow(null);
      }
      clearSelection();
      refreshAll();
    } finally {
      setBulkBusy(false);
    }
  }

  async function undoLastBulk() {
    if (!bulkUndo?.items?.length) return;
    setBulkBusy(true);
    try {
      const outcomes = await Promise.allSettled(
        bulkUndo.items.map((item) => crm.updateLead(item.id, item.patch))
      );
      const ok = outcomes.filter((o) => o.status === 'fulfilled').length;
      const fail = outcomes.length - ok;
      if (ok) success(`Undo completed: ${ok}`);
      if (fail) warn(`Undo failed: ${fail}`);
      setBulkUndoWindow(null);
      refreshAll();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleRoute(leadId) {
    setBusyKey(`route:${leadId}`);
    try {
      await crm.routeLead(leadId, {});
      success('׳”׳׳™׳“ ׳ ׳•׳×׳‘ ׳‘׳”׳¦׳׳—׳”');
      refreshAll();
    } catch (e) {
      toastError(e.message || '׳ ׳™׳×׳•׳‘ ׳ ׳›׳©׳');
    } finally {
      setBusyKey('');
    }
  }

  async function handleConvert(lead) {
    if (!lead || lead.status === 'converted') return;
    setBusyKey(`convert:${lead._id}`);
    try {
      await crm.convertLead(lead._id, {
        createAccount: true,
        createContact: true,
        createOpportunity: true,
        pipelineKey: 'default',
      });
      success('׳”׳׳™׳“ ׳”׳•׳׳¨ ׳׳”׳–׳“׳׳ ׳•׳×');
      refreshAll();
    } catch (e) {
      toastError(e.message || '׳”׳׳¨׳× ׳׳™׳“ ׳ ׳›׳©׳׳”');
    } finally {
      setBusyKey('');
    }
  }

  async function handleStatusUpdate() {
    if (!selectedLead) return;
    setBusyKey(`status:${selectedLead._id}`);
    try {
      await crm.updateLead(selectedLead._id, { status: nextStatus });
      success('׳¡׳˜׳˜׳•׳¡ ׳”׳׳™׳“ ׳¢׳•׳“׳›׳');
      refreshAll();
    } catch (e) {
      toastError(e.message || '׳¢׳“׳›׳•׳ ׳¡׳˜׳˜׳•׳¡ ׳ ׳›׳©׳');
    } finally {
      setBusyKey('');
    }
  }

  async function handleTakeOwnership() {
    if (!selectedLead || !user?.id) return;
    setBusyKey(`owner:${selectedLead._id}`);
    try {
      await crm.updateLead(selectedLead._id, { owner: user.id });
      success('׳”׳׳™׳“ ׳©׳•׳™׳ ׳׳׳™׳');
      refreshAll();
    } catch (e) {
      toastError(e.message || '׳©׳™׳•׳ ׳ ׳›׳©׳');
    } finally {
      setBusyKey('');
    }
  }

  async function handleSetNextAction() {
    if (!selectedLead) return;
    setBusyKey(`next:${selectedLead._id}`);
    try {
      await crm.updateLead(selectedLead._id, {
        nextActionAt: nextActionDate ? `${nextActionDate}T09:00:00.000Z` : null,
      });
      success('׳₪׳¢׳•׳׳” ׳”׳‘׳׳” ׳¢׳•׳“׳›׳ ׳”');
      refreshAll();
    } catch (e) {
      toastError(e.message || '׳¢׳“׳›׳•׳ ׳₪׳¢׳•׳׳” ׳”׳‘׳׳” ׳ ׳›׳©׳');
    } finally {
      setBusyKey('');
    }
  }

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Funnel size={20} className="text-brand" />
            Lead Inbox
          </h1>
          <p className="page-subtitle">
            {filteredLeads.length} ׳‘׳×׳•׳¨ ׳”׳¢׳‘׳•׳“׳” ג€¢ {overview?.leads || leads.length} ׳׳™׳“׳™׳ ׳‘׳¡׳ ׳”׳›׳
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
            <input
              className="input pr-9 w-56"
              placeholder="׳—׳™׳₪׳•׳© ׳׳™׳“..."
              value={q}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-ghost btn-icon" onClick={refreshAll} title="׳¨׳¢׳ ׳">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.1)' }}>
            <Target size={16} className="text-brand" />
          </div>
          <div><div className="text-xs text-ink-muted">׳‘׳×׳•׳¨</div><div className="text-xl font-bold text-num">{filteredLeads.length}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(250,204,21,0.15)' }}>
            <Sparkles size={16} className="text-yellow-600" />
          </div>
          <div><div className="text-xs text-ink-muted">׳—׳“׳©׳™׳</div><div className="text-xl font-bold text-num">{stats.new}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(59,130,246,0.12)' }}>
            <Activity size={16} className="text-blue-600" />
          </div>
          <div><div className="text-xs text-ink-muted">׳‘׳˜׳™׳₪׳•׳</div><div className="text-xl font-bold text-num">{stats.working}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(249,115,22,0.12)' }}>
            <Clock3 size={16} className="text-orange-600" />
          </div>
          <div><div className="text-xs text-ink-muted">׳×׳§׳•׳¢׳™׳</div><div className="text-xl font-bold text-num">{stats.stale}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239,68,68,0.12)' }}>
            <UserRoundX size={16} className="text-red-600" />
          </div>
          <div><div className="text-xs text-ink-muted">׳—׳ ׳׳ ׳׳©׳•׳™׳</div><div className="text-xl font-bold text-num">{stats.hotUnassigned}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(2,132,199,0.12)' }}>
            <ArrowRightLeft size={16} className="text-cyan-700" />
          </div>
          <div><div className="text-xs text-ink-muted">׳”׳•׳׳¨׳•</div><div className="text-xl font-bold text-num">{stats.converted}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(220,38,38,0.12)' }}>
            <AlertTriangle size={16} className="text-red-600" />
          </div>
          <div><div className="text-xs text-ink-muted">Needs Attention</div><div className="text-xl font-bold text-num">{stats.attention}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.12)' }}>
            <UserCheck size={16} className="text-emerald-600" />
          </div>
          <div><div className="text-xs text-ink-muted">׳›׳׳׳™ ׳ ׳™׳×׳•׳‘</div><div className="text-xl font-bold text-num">{routingRules?.length || 0}</div></div>
        </div>
      </div>

      {needsAttention.length > 0 && (
        <div className="card p-3 mb-4 border-red-200 bg-red-50/30">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 text-red-700 text-sm font-semibold">
              <AlertTriangle size={15} />
              ׳×׳•׳¨ ׳“׳—׳•׳£ ׳׳˜׳™׳₪׳•׳ ({needsAttention.length})
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setQueueMode('attention')}>
              ׳¡׳ ׳ ׳׳“׳—׳•׳₪׳™׳
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {needsAttention.map((lead) => (
              <button
                key={lead._id}
                className="badge badge-dirty"
                onClick={() => {
                  setSelectedLeadId(lead._id);
                  setQueueMode('all');
                }}
              >
                {lead.fullName}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-ink-muted mb-1 block">׳¡׳˜׳˜׳•׳¡</label>
            <select className="select w-full" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">׳”׳›׳</option>
              {Object.entries(STATUS_HE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted mb-1 block">׳׳§׳•׳¨</label>
            <select className="select w-full" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">׳”׳›׳</option>
              {Object.entries(SOURCE_HE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted mb-1 block">׳©׳™׳•׳</label>
            <select className="select w-full" value={ownershipFilter} onChange={(e) => setOwnershipFilter(e.target.value)}>
              <option value="all">׳”׳›׳</option>
              <option value="mine">׳©׳׳™</option>
              <option value="unassigned">׳׳ ׳׳©׳•׳™׳</option>
              <option value="assigned">׳׳©׳•׳™׳</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted mb-1 block">׳×׳•׳¨ ׳¢׳‘׳•׳“׳”</label>
            <select className="select w-full" value={queueMode} onChange={(e) => setQueueMode(e.target.value)}>
              <option value="all">׳›׳ ׳”׳×׳•׳¨</option>
              <option value="attention">Needs Attention</option>
              <option value="hot">׳—׳׳™׳ ׳‘׳׳‘׳“</option>
              <option value="stale">׳×׳§׳•׳¢׳™׳</option>
              <option value="due">׳₪׳¢׳•׳׳” ׳‘׳׳™׳—׳•׳¨</option>
              <option value="unassigned">׳׳ ׳׳©׳•׳™׳›׳™׳</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted mb-1 block">׳׳™׳•׳</label>
            <select className="select w-full" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="priority">׳¢׳“׳™׳₪׳•׳× ׳¢׳¡׳§׳™׳×</option>
              <option value="score">׳¦׳™׳•׳</option>
              <option value="newest">׳—׳“׳© ׳׳™׳©׳</option>
              <option value="stale">׳”׳›׳™ ׳×׳§׳•׳¢</option>
            </select>
          </div>
        </div>
      </div>

      {selectedLeadIds.length > 0 && (
        <div className="card p-4 mb-4 border-brand/30 bg-brand/5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">׳ ׳‘׳—׳¨׳• {selectedLeadIds.length} ׳׳™׳“׳™׳</span>
            <button className="btn btn-secondary btn-sm" onClick={toggleSelectAllFiltered} disabled={bulkBusy}>
              {filteredLeads.length > 0 && filteredLeads.every((lead) => selectedIdSet.has(lead._id)) ? '׳‘׳˜׳ ׳‘׳—׳™׳¨׳× ׳”׳›׳' : '׳‘׳—׳¨ ׳”׳›׳ ׳‘׳׳¡׳ ׳'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={clearSelection} disabled={bulkBusy}>
              ׳ ׳§׳” ׳‘׳—׳™׳¨׳”
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { if (!confirm(`לנתב ${selectedLeadIds.length} לידים?`)) return; runBulkAction('Bulk route', (id) => crm.routeLead(id, {})); }} disabled={bulkBusy}>
              {bulkBusy && <Spinner size={11} />}
              ׳ ׳™׳×׳•׳‘ ׳§׳‘׳•׳¦׳×׳™
            </button>
            <div className="flex items-center gap-2">
              <select className="select" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} disabled={bulkBusy}>
                {Object.entries(STATUS_HE).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={() => runBulkAction('Bulk status update', (id) => crm.updateLead(id, { status: bulkStatus }), { undoLabel: 'Bulk status update', undoItems: selectedLeadIds.map((id) => { const lead = findLeadById(id); return lead ? { id, patch: { status: lead.status } } : null; }).filter(Boolean) })} disabled={bulkBusy}>
                ׳¢׳“׳›׳ ׳¡׳˜׳˜׳•׳¡
              </button>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => runBulkAction('Bulk assignment', (id) => crm.updateLead(id, { owner: user?.id }), { undoLabel: 'Bulk assignment', undoItems: selectedLeadIds.map((id) => { const lead = findLeadById(id); return lead ? { id, patch: { owner: ownerIdFromLead(lead) } } : null; }).filter(Boolean) })} disabled={bulkBusy || !user?.id}>
              ׳©׳™׳•׳ ׳׳׳™׳™
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (!confirm(`׳׳”׳׳™׳¨ ${selectedLeadIds.length} ׳׳™׳“׳™׳ ׳׳”׳–׳“׳׳ ׳•׳™׳•׳×?`)) return;
                runBulkAction('׳”׳׳¨׳” ׳§׳‘׳•׳¦׳×׳™׳×', (id) => crm.convertLead(id, {
                  createAccount: true,
                  createContact: true,
                  createOpportunity: true,
                  pipelineKey: 'default',
                }));
              }}
              disabled={bulkBusy}
            >
              ׳”׳׳¨ ׳׳”׳–׳“׳׳ ׳•׳™׳•׳×
            </button>
          </div>
        </div>
      )}

      {bulkUndo?.items?.length > 0 && (
        <div className="card p-3 mb-4 border-emerald-300 bg-emerald-50/40">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-emerald-900">
              <span className="font-semibold">Bulk action applied.</span> You can undo {bulkUndo.items.length} updates.
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary btn-sm" onClick={undoLastBulk} disabled={bulkBusy}>
                {bulkBusy ? <Spinner size={12} /> : 'Undo'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setBulkUndoWindow(null)} disabled={bulkBusy}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5">
          <div className="card">
            <div className="card-header">
              <span className="font-semibold text-sm text-ink">׳×׳•׳¨ ׳׳™׳“׳™׳ ׳׳×׳•׳¢׳“׳£</span>
            </div>
            <div className="max-h-[72vh] overflow-y-auto p-3 flex flex-col gap-2">
              {!filteredLeads.length ? (
                <div className="empty-state py-8">
                  <UserRoundX size={26} className="empty-state-icon" />
                  <span>׳׳ ׳ ׳׳¦׳׳• ׳׳™׳“׳™׳ ׳׳₪׳™ ׳”׳¡׳™׳ ׳•׳</span>
                </div>
              ) : filteredLeads.map((lead) => {
                const selected = selectedLead?._id === lead._id;
                const checked = selectedIdSet.has(lead._id);
                const total = Number(lead?.score?.total || 0);
                const tone = scoreTone(total);
                const urgent = urgencyBadge(lead, crmSla);
                const stale = daysAgo(lead.lastActivityAt || lead.createdAt);
                return (
                  <div
                    key={lead._id}
                    className={`border rounded-xl p-3 transition-all cursor-pointer ${selected ? 'border-brand bg-brand/5 shadow-card' : 'border-surface-border hover:bg-surface-hover'}`}
                    onClick={() => setSelectedLeadId(lead._id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setSelectedLeadId(lead._id);
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <div className="font-semibold text-ink text-sm truncate">{lead.fullName}</div>
                        <div className="text-xs text-ink-muted truncate">{lead.companyName || '׳׳׳ ׳—׳‘׳¨׳”'}{lead.email ? ` ג€¢ ${lead.email}` : ''}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`badge ${tone.cls}`}>{total}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLeadSelection(lead._id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <span className={`badge ${statusBadge(lead.status)}`}>{STATUS_HE[lead.status] || lead.status}</span>
                      <span className="badge badge-pending">{SOURCE_HE[lead.source] || lead.source || 'ג€”'}</span>
                      <span className={`badge ${urgent.cls}`}>{urgent.label}</span>
                      {!lead.owner && <span className="badge badge-dirty">׳׳ ׳׳©׳•׳™׳</span>}
                    </div>
                    <div className="text-xs text-ink-faint mt-2">
                      ׳¢׳•׳“׳›׳ {stale ?? 0} ׳™׳׳™׳ ג€¢ owner: {lead.owner ? `${lead.owner.firstName || ''} ${lead.owner.lastName || ''}`.trim() : 'ג€”'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="xl:col-span-7">
          {!selectedLead ? (
            <div className="card h-full">
              <div className="empty-state min-h-[340px]">
                <Target size={30} className="empty-state-icon" />
                <span>׳‘׳—׳¨ ׳׳™׳“ ׳׳”׳¨׳©׳™׳׳” ׳›׳“׳™ ׳׳¨׳׳•׳× ׳¢׳•׳׳§ ׳•׳׳‘׳¦׳¢ ׳₪׳¢׳•׳׳•׳×</span>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="font-semibold text-ink">{selectedLead.fullName}</div>
                  <div className="text-xs text-ink-muted">{selectedLead.companyName || '׳׳׳ ׳—׳‘׳¨׳”'} {selectedLead.title ? `ג€¢ ${selectedLead.title}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${statusBadge(selectedLead.status)}`}>{STATUS_HE[selectedLead.status] || selectedLead.status}</span>
                  <span className={`badge ${scoreTone(Number(selectedLead?.score?.total || 0)).cls}`}>Score {Number(selectedLead?.score?.total || 0)}</span>
                </div>
              </div>

              <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card p-3">
                  <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-2">׳¦׳™׳•׳ ׳׳™׳“</div>
                  <div className="space-y-2 text-xs">
                    <div><div className="flex justify-between mb-1"><span>Fit</span><span className="text-num">{Number(selectedLead?.score?.fit || 0)}</span></div>{metricBar(selectedLead?.score?.fit || 0)}</div>
                    <div><div className="flex justify-between mb-1"><span>Engagement</span><span className="text-num">{Number(selectedLead?.score?.engagement || 0)}</span></div>{metricBar(selectedLead?.score?.engagement || 0)}</div>
                    <div><div className="flex justify-between mb-1"><span>Intent</span><span className="text-num">{Number(selectedLead?.score?.intent || 0)}</span></div>{metricBar(selectedLead?.score?.intent || 0)}</div>
                    <div><div className="flex justify-between mb-1"><span>Negative</span><span className="text-num">{Number(selectedLead?.score?.negative || 0)}</span></div>{metricBar(selectedLead?.score?.negative || 0, 100, false)}</div>
                  </div>
                </div>

                <div className="card p-3">
                  <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-2">׳§׳•׳ ׳˜׳§׳¡׳˜ ׳×׳₪׳¢׳•׳׳™</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between"><span className="text-ink-muted">׳‘׳¢׳׳™׳</span><span>{selectedLead.owner ? `${selectedLead.owner.firstName || ''} ${selectedLead.owner.lastName || ''}`.trim() : '׳׳ ׳׳©׳•׳™׳'}</span></div>
                    <div className="flex items-center justify-between"><span className="text-ink-muted">׳׳§׳•׳¨</span><span>{SOURCE_HE[selectedLead.source] || selectedLead.source || 'ג€”'}</span></div>
                    <div className="flex items-center justify-between"><span className="text-ink-muted">׳₪׳¢׳•׳׳” ׳”׳‘׳׳”</span><span>{selectedLead.nextActionAt ? isoDate(selectedLead.nextActionAt) : '׳׳ ׳”׳•׳’׳“׳¨׳”'}</span></div>
                    <div className="flex items-center justify-between"><span className="text-ink-muted">׳₪׳¢׳™׳׳•׳× ׳׳—׳¨׳•׳ ׳”</span><span>{selectedLead.lastActivityAt ? `${daysAgo(selectedLead.lastActivityAt)} ׳™׳׳™׳` : '׳׳™׳ ׳׳™׳“׳¢'}</span></div>
                  </div>
                </div>

                <div className="card p-3 lg:col-span-2">
                  <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-3">׳₪׳¢׳•׳׳•׳× ׳¢׳‘׳•׳“׳”</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                    <button className="btn btn-secondary justify-center gap-2" onClick={() => handleRoute(selectedLead._id)} disabled={busyKey === `route:${selectedLead._id}` || busyKey.startsWith('convert:') || bulkBusy}>
                      {busyKey === `route:${selectedLead._id}` ? <Spinner size={12} /> : <ArrowRightLeft size={14} />}
                      ׳ ׳™׳×׳•׳‘ ׳׳•׳˜׳•׳׳˜׳™
                    </button>
                    <button className="btn btn-primary justify-center gap-2" onClick={() => handleConvert(selectedLead)} disabled={selectedLead.status === 'converted' || busyKey === `convert:${selectedLead._id}` || bulkBusy}>
                      {busyKey === `convert:${selectedLead._id}` ? <Spinner size={12} /> : <Sparkles size={14} />}
                      ׳”׳׳¨׳” ׳׳”׳–׳“׳׳ ׳•׳×
                    </button>
                    <button className="btn btn-ghost justify-center gap-2" onClick={handleTakeOwnership} disabled={busyKey === `owner:${selectedLead._id}` || !user?.id || bulkBusy}>
                      {busyKey === `owner:${selectedLead._id}` ? <Spinner size={12} /> : <UserCheck size={14} />}
                      ׳©׳™׳•׳ ׳׳׳™׳™
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <select className="select" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                      {Object.entries(STATUS_HE).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <button className="btn btn-secondary justify-center" onClick={handleStatusUpdate} disabled={busyKey === `status:${selectedLead._id}` || bulkBusy}>
                      {busyKey === `status:${selectedLead._id}` ? <Spinner size={12} /> : '׳¢׳“׳›׳ ׳¡׳˜׳˜׳•׳¡'}
                    </button>
                    <div className="flex gap-2">
                      <input type="date" className="input" value={nextActionDate} onChange={(e) => setNextActionDate(e.target.value)} />
                      <button className="btn btn-secondary" onClick={handleSetNextAction} disabled={busyKey === `next:${selectedLead._id}` || bulkBusy}>
                        {busyKey === `next:${selectedLead._id}` ? <Spinner size={12} /> : '׳©׳׳•׳¨'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}




