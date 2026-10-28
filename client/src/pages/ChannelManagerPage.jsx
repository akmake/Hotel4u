import { useState, useCallback, useEffect } from 'react';
import {
  Radio, RefreshCw, AlertCircle, CheckCircle, Clock,
  RotateCcw, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../hooks/useToast';
import { integrations } from '../utils/api';
import { PageSpinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import { BackArrow } from '../components/kit';

const STATUS_CONFIG = {
  pending:     { label: 'ממתין',      color: '#2563eb', bg: '#eff6ff', icon: Clock },
  processing:  { label: 'בעיבוד',     color: '#d97706', bg: '#fffbeb', icon: Loader2 },
  sent:        { label: 'נשלח',       color: '#059669', bg: '#f0fdf4', icon: CheckCircle },
  failed:      { label: 'כשל',        color: '#dc2626', bg: '#fef2f2', icon: AlertCircle },
  dead_letter: { label: 'מת (Dead)',  color: '#7c3aed', bg: '#f5f3ff', icon: AlertCircle },
};

const EVENT_LABELS = {
  availability: 'זמינות',
  rate:         'מחירים',
  restriction:  'הגבלות',
  reservation:  'הזמנה',
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: '#94a3b8', bg: '#f8fafc' };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ color: cfg.color, background: cfg.bg }}>
      <Icon size={11} className={status === 'processing' ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  );
}

function StatCard({ label, value, status }) {
  const cfg = STATUS_CONFIG[status] || { color: '#475569', bg: '#f8fafc' };
  const hasAlert = (status === 'failed' || status === 'dead_letter') && value > 0;
  return (
    <div className={`bg-white border rounded-xl px-4 py-3 text-center shadow-sm transition-shadow hover:shadow-md ${hasAlert ? 'border-red-200' : 'border-slate-200'}`}>
      <div className="text-2xl font-bold tabular-nums" style={{ color: cfg.color }}>{value ?? 0}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function QueueItemRow({ item }) {
  const [open, setOpen] = useState(false);
  const ts = item.createdAt ? new Date(item.createdAt).toLocaleString('he-IL') : '—';
  const lastErr = item.lastError;

  return (
    <div className="border rounded-lg bg-white overflow-hidden hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <StatusBadge status={item.status} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-700">
            {item.channel} — {EVENT_LABELS[item.eventType] || item.eventType}
          </div>
          <div className="text-xs text-slate-400">{ts} · ניסיון {item.attempts || 0}</div>
        </div>
        {lastErr && (
          <span className="text-xs text-red-500 truncate max-w-xs hidden md:block">{lastErr}</span>
        )}
        {open ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
      </div>
      {open && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs space-y-1">
          {lastErr && <p className="text-red-600 flex gap-1"><AlertCircle size={12} className="mt-0.5 shrink-0" />{lastErr}</p>}
          {item.nextAttemptAt && <p className="text-slate-500">ניסיון הבא: {new Date(item.nextAttemptAt).toLocaleString('he-IL')}</p>}
          <pre className="overflow-x-auto text-slate-600 bg-white border border-slate-200 rounded px-2 py-1">
            {JSON.stringify(item.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function ChannelManagerPage() {
  const { propertyId } = useProperty();
  const { showToast, toasts, removeToast } = useToast();

  const [stats,   setStats]   = useState(null);
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [statusFilter, setStatusFilter] = useState('failed,dead_letter');

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const [statsRes, itemsRes] = await Promise.all([
        integrations.channelQueue.stats(propertyId),
        integrations.channelQueue.list(propertyId, statusFilter, 100),
      ]);
      setStats(statsRes.data?.data || {});
      setItems(itemsRes.data?.data || []);
    } catch (err) {
      showToast(err.response?.data?.error || 'שגיאה בטעינה', 'error');
    } finally {
      setLoading(false);
    }
  }, [propertyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleRequeue() {
    setRetrying(true);
    try {
      await integrations.channelQueue.requeueDead(propertyId);
      showToast('Dead-letter items הוחזרו לתור', 'success');
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'שגיאה', 'error');
    } finally {
      setRetrying(false);
    }
  }

  const deadCount = stats?.dead_letter || 0;
  const failedCount = stats?.failed || 0;

  if (loading) return <PageSpinner />;

  return (
    <div className="ui-page is-approved is-legacy" dir="rtl">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><BackArrow />
          <Radio size={20} className="text-indigo-500" />
          <h1 className="text-xl font-semibold text-slate-800">Channel Manager</h1>
        </div>
        <div className="flex items-center gap-2">
          {deadCount > 0 && (
            <button onClick={handleRequeue} disabled={retrying}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50">
              <RotateCcw size={14} className={retrying ? 'animate-spin' : ''} />
              {retrying ? 'מעבד...' : `Retry ${deadCount} Dead`}
            </button>
          )}
          <button onClick={load} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg border border-slate-200">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <StatCard key={key} label={cfg.label} value={stats[key] || 0} status={key} />
          ))}
        </div>
      )}

      {/* Alert for failures */}
      {(failedCount > 0 || deadCount > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            {failedCount > 0 && <span>{failedCount} פריטים נכשלו ויינסו אוטומטית. </span>}
            {deadCount > 0 && <span>{deadCount} פריטים ב-dead-letter ודורשים retry ידני.</span>}
          </div>
        </div>
      )}

      {/* Filter + list */}
      <div>
        <div className="flex flex-wrap gap-2 mb-3">
          {[
            { value: 'failed,dead_letter', label: 'כשלים בלבד' },
            { value: 'pending,processing', label: 'בתור' },
            { value: 'sent',               label: 'נשלחו' },
            { value: '',                   label: 'הכל' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                statusFilter === f.value
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
            <CheckCircle size={28} className="mx-auto mb-3 text-emerald-400" />
            <p className="text-sm text-slate-500">אין פריטים בסינון זה</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <QueueItemRow key={item._id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
