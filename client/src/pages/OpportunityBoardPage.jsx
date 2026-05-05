import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Kanban,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { crm } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const HEALTH_BADGE = {
  healthy: 'badge-clean',
  at_risk: 'badge-dirty',
  stalled: 'badge-cancelled',
};

const HEALTH_LABEL = {
  healthy: 'תקין',
  at_risk: 'בסיכון',
  stalled: 'תקוע',
};

function fmtMoney(amount, currency = 'ILS') {
  try {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: currency || 'ILS',
      maximumFractionDigits: 0,
    }).format(Number(amount || 0));
  } catch {
    return `₪${Number(amount || 0).toLocaleString('he-IL')}`;
  }
}

function parseAnyDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return new Date(`${value}T00:00:00Z`);
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function daysAgo(value) {
  const dt = parseAnyDate(value);
  if (!dt) return null;
  return Math.floor((Date.now() - dt.getTime()) / 86400000);
}

function isoDate(value) {
  const dt = parseAnyDate(value);
  if (!dt) return '';
  return dt.toISOString().slice(0, 10);
}

function isClosed(stage) {
  return stage === 'closed_won' || stage === 'closed_lost';
}

function attentionScore(opportunity) {
  let score = 0;
  if (opportunity.healthStatus === 'stalled') score += 35;
  if (opportunity.healthStatus === 'at_risk') score += 22;

  const inactive = daysAgo(opportunity.lastActivityAt || opportunity.updatedAt) || 0;
  if (inactive >= 21) score += 28;
  else if (inactive >= 14) score += 18;
  else if (inactive >= 7) score += 8;

  const closeDate = parseAnyDate(opportunity.expectedCloseDate);
  if (closeDate && closeDate.getTime() < Date.now() && !isClosed(opportunity.stage)) score += 24;
  if (Number(opportunity.probability || 0) >= 70 && inactive >= 10) score += 12;
  if (Number(opportunity.amount || 0) >= 100000 && inactive >= 5) score += 9;

  if (isClosed(opportunity.stage)) score -= 40;
  return score;
}

function opportunityFlags(opportunity) {
  const flags = [];
  const inactive = daysAgo(opportunity.lastActivityAt || opportunity.updatedAt) || 0;
  const closeDate = parseAnyDate(opportunity.expectedCloseDate);
  const overdueClose = closeDate && closeDate.getTime() < Date.now() && !isClosed(opportunity.stage);

  if (overdueClose) flags.push('סגירה צפויה באיחור');
  if (inactive >= 14) flags.push(`אין פעילות ${inactive} ימים`);
  if (opportunity.healthStatus === 'at_risk') flags.push('בריאות בסיכון');
  if (opportunity.healthStatus === 'stalled') flags.push('בריאות תקועה');
  return flags;
}

export default function OpportunityBoardPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success, error: toastError, warn } = useToast();

  const [pipelineKey, setPipelineKey] = useState('default');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState('all');
  const [showClosed, setShowClosed] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editProbability, setEditProbability] = useState('');
  const [editCloseDate, setEditCloseDate] = useState('');
  const [editHealth, setEditHealth] = useState('healthy');
  const [dragOpportunityId, setDragOpportunityId] = useState('');
  const [dragOverStage, setDragOverStage] = useState('');
  const debounceRef = useRef(null);

  const onSearch = useCallback((value) => {
    setQ(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 260);
  }, []);

  const {
    data: pipelineList,
    loading: loadingPipelines,
    error: pipelinesError,
    refetch: refetchPipelines,
  } = useApi(() => crm.pipelines(propertyId), [propertyId], skip);

  const {
    data: oppResp,
    loading: loadingOpps,
    error: oppError,
    refetch: refetchOpps,
  } = useApi(
    () => crm.opportunities(propertyId, { q: search, limit: 300, page: 1 }),
    [propertyId, search],
    skip
  );

  const {
    data: forecast,
    loading: loadingForecast,
    refetch: refetchForecast,
  } = useApi(
    () => crm.forecast(propertyId, { pipelineKey }),
    [propertyId, pipelineKey],
    skip
  );

  const pipelines = pipelineList || [];
  const selectedPipeline = useMemo(() => {
    const exact = pipelines.find((p) => p.key === pipelineKey && p.active !== false);
    if (exact) return exact;
    return pipelines.find((p) => p.active !== false) || null;
  }, [pipelines, pipelineKey]);

  const stages = useMemo(() => {
    if (selectedPipeline?.stages?.length) {
      return [...selectedPipeline.stages]
        .filter((s) => s.active !== false)
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    }
    return [
      { key: 'qualification', name: 'Qualification', order: 1 },
      { key: 'discovery', name: 'Discovery', order: 2 },
      { key: 'proposal', name: 'Proposal', order: 3 },
      { key: 'negotiation', name: 'Negotiation', order: 4 },
      { key: 'contract', name: 'Contract', order: 5 },
      { key: 'closed_won', name: 'Closed Won', order: 6 },
      { key: 'closed_lost', name: 'Closed Lost', order: 7 },
    ];
  }, [selectedPipeline]);

  const opportunities = useMemo(() => {
    const all = oppResp?.items || [];
    let items = all.filter((op) => (pipelineKey ? op.pipelineKey === pipelineKey : true));

    if (!showClosed) items = items.filter((op) => !isClosed(op.stage));
    if (healthFilter !== 'all') items = items.filter((op) => op.healthStatus === healthFilter);
    if (attentionOnly) items = items.filter((op) => attentionScore(op) >= 24);
    return items;
  }, [oppResp, pipelineKey, showClosed, healthFilter, attentionOnly]);

  const grouped = useMemo(() => {
    const bucket = {};
    stages.forEach((s) => { bucket[s.key] = []; });
    opportunities.forEach((op) => {
      if (!bucket[op.stage]) bucket[op.stage] = [];
      bucket[op.stage].push(op);
    });
    Object.keys(bucket).forEach((k) => {
      bucket[k] = bucket[k].sort((a, b) => {
        const att = attentionScore(b) - attentionScore(a);
        if (att !== 0) return att;
        return Number(b.amount || 0) - Number(a.amount || 0);
      });
    });
    return bucket;
  }, [stages, opportunities]);

  const selectedOpportunity = useMemo(
    () => opportunities.find((op) => op._id === selectedOpportunityId) || opportunities[0] || null,
    [opportunities, selectedOpportunityId]
  );

  useEffect(() => {
    if (!selectedOpportunity) {
      setSelectedOpportunityId('');
      setSelectedStage('');
      return;
    }
    setSelectedOpportunityId(selectedOpportunity._id);
    setSelectedStage(selectedOpportunity.stage || '');
    setEditAmount(String(Number(selectedOpportunity.amount || 0)));
    setEditProbability(String(Number(selectedOpportunity.probability || 0)));
    setEditCloseDate(isoDate(selectedOpportunity.expectedCloseDate));
    setEditHealth(selectedOpportunity.healthStatus || 'healthy');
  }, [selectedOpportunity?._id]);

  const summary = useMemo(() => {
    const open = opportunities.filter((op) => !isClosed(op.stage));
    const won = opportunities.filter((op) => op.stage === 'closed_won');
    const lost = opportunities.filter((op) => op.stage === 'closed_lost');
    const openAmount = open.reduce((sum, op) => sum + Number(op.amount || 0), 0);
    const weighted = open.reduce((sum, op) => sum + (Number(op.amount || 0) * Number(op.probability || 0) / 100), 0);
    const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
    const attentionCount = open.filter((op) => attentionScore(op) >= 24).length;
    return { openAmount, weighted, winRate, attentionCount };
  }, [opportunities]);

  const attentionDeals = useMemo(
    () => opportunities.filter((op) => attentionScore(op) >= 24).slice(0, 6),
    [opportunities]
  );

  async function refreshAll() {
    await Promise.all([refetchOpps(), refetchForecast(), refetchPipelines()]);
  }

  async function moveStage(opportunity, toStage) {
    if (!toStage || opportunity.stage === toStage) return;
    const key = `stage:${opportunity._id}`;
    setBusyKey(key);
    try {
      await crm.changeOpportunityStage(opportunity._id, { stage: toStage });
      success('שלב העסקה עודכן');
      refreshAll();
    } catch (e) {
      toastError(e.message || 'מעבר שלב נכשל');
    } finally {
      setBusyKey('');
    }
  }

  async function closeWon(opportunity) {
    const key = `won:${opportunity._id}`;
    setBusyKey(key);
    try {
      await crm.closeOpportunityWon(opportunity._id, {});
      success('העסקה נסגרה כ-Won');
      refreshAll();
    } catch (e) {
      toastError(e.message || 'סגירת העסקה נכשלה');
    } finally {
      setBusyKey('');
    }
  }

  async function closeLost(opportunity) {
    const reason = prompt('סיבת הפסד:');
    if (!reason) return;
    const key = `lost:${opportunity._id}`;
    setBusyKey(key);
    try {
      await crm.closeOpportunityLost(opportunity._id, { reason });
      success('העסקה נסגרה כ-Lost');
      refreshAll();
    } catch (e) {
      toastError(e.message || 'סגירה כ-Lost נכשלה');
    } finally {
      setBusyKey('');
    }
  }

  async function recalcHealth(opportunity) {
    const key = `health:${opportunity._id}`;
    setBusyKey(key);
    try {
      await crm.recalcOpportunityHealth(opportunity._id);
      success('בריאות העסקה חושבה מחדש');
      refetchOpps();
      refetchForecast();
    } catch (e) {
      toastError(e.message || 'חישוב בריאות נכשל');
    } finally {
      setBusyKey('');
    }
  }

  async function saveOpportunityProfile(opportunity) {
    const key = `save:${opportunity._id}`;
    setBusyKey(key);
    try {
      await crm.updateOpportunity(opportunity._id, {
        amount: Number(editAmount || 0),
        probability: Number(editProbability || 0),
        expectedCloseDate: editCloseDate || null,
        healthStatus: editHealth,
      });
      success('פרטי העסקה נשמרו');
      refetchOpps();
      refetchForecast();
    } catch (e) {
      toastError(e.message || 'שמירה נכשלה');
    } finally {
      setBusyKey('');
    }
  }

  async function onDropToStage(stageKey) {
    if (!dragOpportunityId) return;
    const dragged = opportunities.find((op) => op._id === dragOpportunityId);
    setDragOverStage('');
    setDragOpportunityId('');
    if (!dragged) return;
    if (dragged.stage === stageKey) return;
    await moveStage(dragged, stageKey);
  }

  if (skip || loadingPipelines || loadingOpps || loadingForecast) return <PageSpinner />;
  if (pipelinesError) return <ErrorState message={pipelinesError} onRetry={refreshAll} />;
  if (oppError) return <ErrorState message={oppError} onRetry={refreshAll} />;

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Kanban size={20} className="text-brand" />
            Opportunity Board
          </h1>
          <p className="page-subtitle">
            {opportunities.length} עסקאות לאחר סינון • Pipeline: {selectedPipeline?.name || pipelineKey}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
            <input className="input pr-9 w-56" placeholder="חיפוש עסקה..." value={q} onChange={(e) => onSearch(e.target.value)} />
          </div>
          <button className="btn btn-ghost btn-icon" onClick={refreshAll}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {attentionDeals.length > 0 && (
        <div className="card p-3 mb-4 border-red-200 bg-red-50/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-red-700 text-sm font-semibold">
              <AlertTriangle size={15} />
              עסקאות שדורשות טיפול עכשיו ({summary.attentionCount})
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setAttentionOnly((v) => !v)}>
              {attentionOnly ? 'הצג הכל' : 'סנן לדחופות'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {attentionDeals.map((op) => (
              <button key={op._id} className="badge badge-dirty" onClick={() => setSelectedOpportunityId(op._id)}>
                {op.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div>
            <label className="text-xs text-ink-muted mb-1 block">Pipeline</label>
            <select className="select w-full" value={pipelineKey} onChange={(e) => setPipelineKey(e.target.value)}>
              {(pipelines || []).map((pipeline) => (
                <option key={pipeline._id} value={pipeline.key}>{pipeline.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted mb-1 block">בריאות</label>
            <select className="select w-full" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
              <option value="all">הכל</option>
              <option value="healthy">תקין</option>
              <option value="at_risk">בסיכון</option>
              <option value="stalled">תקוע</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-ink-secondary">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
              להציג גם סגורות
            </label>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.12)' }}>
              <TrendingUp size={16} className="text-brand" />
            </div>
            <div><div className="text-xs text-ink-muted">Weighted</div><div className="text-sm font-bold text-num">{fmtMoney(forecast?.totals?.weightedForecast || summary.weighted)}</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.12)' }}>
              <CircleDollarSign size={16} className="text-emerald-600" />
            </div>
            <div><div className="text-xs text-ink-muted">Open Amount</div><div className="text-sm font-bold text-num">{fmtMoney(summary.openAmount)}</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(2,132,199,0.12)' }}>
              <Activity size={16} className="text-cyan-700" />
            </div>
            <div><div className="text-xs text-ink-muted">Win Rate</div><div className="text-sm font-bold text-num">{summary.winRate}%</div></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8">
          <div className="overflow-x-auto pb-2">
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(3, stages.length)}, minmax(250px, 1fr))`, minWidth: 950 }}>
              {stages.map((stage) => {
                const column = grouped[stage.key] || [];
                const columnAmount = column.reduce((sum, item) => sum + Number(item.amount || 0), 0);
                const highlighted = dragOverStage === stage.key;
                return (
                  <div
                    key={stage.key}
                    className={`card overflow-hidden ${highlighted ? 'ring-2 ring-brand/40' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverStage(stage.key);
                    }}
                    onDragLeave={() => setDragOverStage((prev) => (prev === stage.key ? '' : prev))}
                    onDrop={(e) => {
                      e.preventDefault();
                      onDropToStage(stage.key);
                    }}
                  >
                    <div className="card-header">
                      <div>
                        <div className="font-semibold text-ink text-sm">{stage.name}</div>
                        <div className="text-xs text-ink-muted">{column.length} עסקאות</div>
                      </div>
                      <div className="text-xs text-num text-ink-muted">{fmtMoney(columnAmount)}</div>
                    </div>

                    <div className="p-3 flex flex-col gap-2 max-h-[72vh] overflow-y-auto">
                      {!column.length ? (
                        <div className="text-center text-xs text-ink-faint py-5">גרור עסקה לכאן</div>
                      ) : column.map((op) => {
                        const stale = daysAgo(op.lastActivityAt || op.updatedAt) || 0;
                        const selected = selectedOpportunity?._id === op._id;
                        const flags = opportunityFlags(op);
                        return (
                          <div
                            key={op._id}
                            draggable
                            onDragStart={(e) => {
                              setDragOpportunityId(op._id);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                              setDragOpportunityId('');
                              setDragOverStage('');
                            }}
                            className={`border rounded-xl p-3 transition-all cursor-grab active:cursor-grabbing ${selected ? 'border-brand bg-brand/5 shadow-card' : 'border-surface-border hover:bg-surface-hover'}`}
                            onClick={() => setSelectedOpportunityId(op._id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') setSelectedOpportunityId(op._id);
                            }}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="min-w-0">
                                <div className="font-semibold text-ink text-sm truncate">{op.name}</div>
                                <div className="text-xs text-ink-muted truncate">{op.account?.name || 'ללא חשבון'}</div>
                              </div>
                              <span className={`badge ${HEALTH_BADGE[op.healthStatus] || 'badge-pending'}`}>{HEALTH_LABEL[op.healthStatus] || op.healthStatus}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs mt-2">
                              <span className="font-bold text-num">{fmtMoney(op.amount, op.currency)}</span>
                              <span className={`badge ${Number(op.probability || 0) >= 70 ? 'badge-arrival' : 'badge-pending'}`}>{Number(op.probability || 0)}%</span>
                            </div>
                            <div className="text-xs text-ink-faint mt-2">אחרון: {stale} ימים • סגירה: {op.expectedCloseDate || '—'}</div>
                            {flags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {flags.slice(0, 2).map((flag) => (
                                  <span key={`${op._id}:${flag}`} className="badge badge-dirty">{flag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="xl:col-span-4">
          {!selectedOpportunity ? (
            <div className="card h-full">
              <div className="empty-state min-h-[320px]">
                <Activity size={28} className="empty-state-icon" />
                <span>בחר עסקה כדי לעבוד עליה בעומק</span>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="font-semibold text-ink">{selectedOpportunity.name}</div>
                  <div className="text-xs text-ink-muted">{selectedOpportunity.account?.name || 'ללא חשבון'}</div>
                </div>
                <span className={`badge ${HEALTH_BADGE[selectedOpportunity.healthStatus] || 'badge-pending'}`}>
                  {HEALTH_LABEL[selectedOpportunity.healthStatus] || selectedOpportunity.healthStatus}
                </span>
              </div>

              <div className="p-4 flex flex-col gap-3">
                <div className="card p-3">
                  <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-2">Stage Control</div>
                  <div className="flex gap-2">
                    <select className="select flex-1" value={selectedStage} onChange={(e) => setSelectedStage(e.target.value)}>
                      {stages.map((s) => <option key={`${selectedOpportunity._id}:${s.key}`} value={s.key}>{s.name}</option>)}
                    </select>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => moveStage(selectedOpportunity, selectedStage)}
                      disabled={busyKey === `stage:${selectedOpportunity._id}` || selectedStage === selectedOpportunity.stage}
                    >
                      {busyKey === `stage:${selectedOpportunity._id}` ? <Spinner size={12} /> : 'עדכן'}
                    </button>
                  </div>
                </div>

                <div className="card p-3">
                  <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-2">Deal Profile</div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-ink-muted mb-1 block">סכום</label>
                      <input className="input" type="number" min="0" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-ink-muted mb-1 block">Probability (%)</label>
                      <input className="input" type="number" min="0" max="100" value={editProbability} onChange={(e) => setEditProbability(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-ink-muted mb-1 block">תאריך סגירה צפוי</label>
                      <input className="input" type="date" value={editCloseDate} onChange={(e) => setEditCloseDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-ink-muted mb-1 block">Health</label>
                      <select className="select w-full" value={editHealth} onChange={(e) => setEditHealth(e.target.value)}>
                        <option value="healthy">תקין</option>
                        <option value="at_risk">בסיכון</option>
                        <option value="stalled">תקוע</option>
                      </select>
                    </div>
                    <button className="btn btn-primary w-full justify-center" onClick={() => saveOpportunityProfile(selectedOpportunity)} disabled={busyKey === `save:${selectedOpportunity._id}`}>
                      {busyKey === `save:${selectedOpportunity._id}` ? <Spinner size={12} /> : 'שמור פרופיל עסקה'}
                    </button>
                  </div>
                </div>

                <div className="card p-3">
                  <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-2">Resolution Actions</div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary btn-sm flex-1 justify-center gap-1" disabled={busyKey === `won:${selectedOpportunity._id}`} onClick={() => closeWon(selectedOpportunity)}>
                      {busyKey === `won:${selectedOpportunity._id}` ? <Spinner size={12} /> : <CheckCircle2 size={13} />}
                      Won
                    </button>
                    <button className="btn btn-danger btn-sm flex-1 justify-center gap-1" disabled={busyKey === `lost:${selectedOpportunity._id}`} onClick={() => closeLost(selectedOpportunity)}>
                      {busyKey === `lost:${selectedOpportunity._id}` ? <Spinner size={12} /> : <XCircle size={13} />}
                      Lost
                    </button>
                  </div>
                  <button className="btn btn-ghost btn-sm w-full justify-center gap-1 mt-2" disabled={busyKey === `health:${selectedOpportunity._id}`} onClick={() => recalcHealth(selectedOpportunity)}>
                    {busyKey === `health:${selectedOpportunity._id}` ? <Spinner size={12} /> : <ShieldAlert size={13} />}
                    חשב בריאות מחדש
                  </button>
                </div>

                <div className="card p-3">
                  <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-2">Signals & SLA</div>
                  <div className="text-sm text-ink-secondary flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1"><CalendarClock size={13} /> ימים ללא פעילות</span>
                    <span className="font-semibold text-num">{daysAgo(selectedOpportunity.lastActivityAt || selectedOpportunity.updatedAt) || 0}</span>
                  </div>
                  <div className="text-sm text-ink-secondary flex items-center justify-between mb-2">
                    <span>Forecast Contribution</span>
                    <span className="font-semibold text-num">{fmtMoney((Number(selectedOpportunity.amount || 0) * Number(selectedOpportunity.probability || 0)) / 100, selectedOpportunity.currency)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {opportunityFlags(selectedOpportunity).map((flag) => (
                      <span key={`${selectedOpportunity._id}:${flag}`} className="badge badge-dirty">{flag}</span>
                    ))}
                    {opportunityFlags(selectedOpportunity).length === 0 && (
                      <span className="badge badge-clean">אין חריגות SLA כרגע</span>
                    )}
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
