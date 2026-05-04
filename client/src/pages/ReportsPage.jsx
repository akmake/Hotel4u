import { useState } from 'react';
import { BarChart3, TrendingUp, Users, BedDouble, DollarSign, Calendar, RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { reports as reportsApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { TODAY, addDays } from '../utils/date';

const RANGES = [
  { label:'7 ימים',  from: addDays(TODAY, -7),  to: TODAY },
  { label:'30 ימים', from: addDays(TODAY, -30), to: TODAY },
  { label:'90 ימים', from: addDays(TODAY, -90), to: TODAY },
];

// ── Recharts custom tooltip ───────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-surface-border rounded-lg shadow-lg px-3 py-2 text-xs text-right" dir="rtl">
      <div className="font-semibold text-ink mb-0.5">{label}</div>
      <div className="font-bold" style={{ color: payload[0].fill }}>
        {unit}{typeof payload[0].value === 'number' ? payload[0].value.toLocaleString() : payload[0].value}{unit === '' && payload[0].name === 'occupancy' ? '%' : ''}
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color, bg }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink-muted font-medium truncate">{label}</div>
        <div className="text-2xl font-black text-num leading-tight" style={{ color }}>{value ?? '—'}</div>
        {sub && <div className="text-xs text-ink-faint">{sub}</div>}
      </div>
    </div>
  );
}

// ── Source bar ────────────────────────────────────────────────────────────────
const SOURCE_FLAGS = { booking:'🌐', expedia:'🔷', agoda:'🟠', direct:'🏨', phone:'📞', walk_in:'🚶', corporate:'🏢' };

function SourceBar({ item, total }) {
  const pct = total ? Math.round(item.count / total * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-xs text-ink-secondary flex-shrink-0">
        {SOURCE_FLAGS[item.source] || '📋'} {item.source}
      </div>
      <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background:'#6366f1' }} />
      </div>
      <div className="text-xs font-bold text-num text-ink-secondary w-12 text-left">{item.count} ({pct}%)</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const [rangeIdx, setRangeIdx] = useState(1);
  const { from, to } = RANGES[rangeIdx];

  const { data, loading, error, refetch } = useApi(
    () => reportsApi.summary(propertyId, from, to),
    [propertyId, from, to], skip
  );

  if (skip || loading) return <PageSpinner />;
  if (error)           return <ErrorState message={error} onRetry={refetch} />;

  const { daily = [], total = {}, bySource = [], byStatus = [] } = data || {};
  const last7 = daily.slice(-7);

  // Prepare chart data with short labels
  const chartData = daily.map(d => ({
    ...d,
    label: d.date.slice(5), // MM-DD
    isToday: d.date === TODAY,
  }));

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">דוחות</div>
          <div className="page-subtitle">ניתוח ביצועים — {from} עד {to}</div>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r, i) => (
            <button key={r.label}
              onClick={() => setRangeIdx(i)}
              className={`btn btn-sm ${rangeIdx === i ? 'btn-primary' : 'btn-secondary'}`}>
              {r.label}
            </button>
          ))}
          <button className="btn btn-ghost btn-icon" onClick={refetch}><RefreshCw size={15} /></button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard icon={BedDouble}  label="תפוסה ממוצעת" value={`${total.avgOccupancy || 0}%`}          color="#6366f1" bg="rgba(99,102,241,0.1)"   sub={`${total.totalRooms || 0} חדרים`} />
        <KpiCard icon={DollarSign} label="הכנסה כוללת"  value={`₪${(total.revenue||0).toLocaleString()}`}  color="#059669" bg="rgba(16,185,129,0.1)" />
        <KpiCard icon={TrendingUp} label="ADR"           value={`₪${(total.adr||0).toLocaleString()}`}       color="#2563eb" bg="rgba(59,130,246,0.1)"  sub="ממוצע ללינה" />
        <KpiCard icon={BarChart3}  label="RevPAR"        value={`₪${(total.revpar||0).toLocaleString()}`}    color="#7c3aed" bg="rgba(124,58,237,0.1)"  sub="הכנסה לחדר" />
        <KpiCard icon={Calendar}   label="הזמנות"        value={total.reservations || 0}                      color="#ea580c" bg="rgba(249,115,22,0.1)" />
        <KpiCard icon={Users}      label="אורחים"        value={total.totalGuests || 0}                       color="#0891b2" bg="rgba(8,145,178,0.1)"   sub="סה״כ פרופילים" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Occupancy chart */}
        <div className="card lg:col-span-2">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <BarChart3 size={15} className="text-brand" />
              <span className="font-semibold text-ink text-sm">תפוסה יומית %</span>
            </div>
          </div>
          <div className="card-body pt-2">
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={chartData} barSize={chartData.length > 30 ? 4 : 8} margin={{ top:4, right:4, bottom:0, left:0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.max(0, Math.floor(chartData.length / 7) - 1)}
                />
                <YAxis hide domain={[0, 100]} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                <Bar dataKey="occupancy" radius={[3,3,0,0]}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.isToday ? '#6366f1' : entry.occupancy > 80 ? '#059669' : entry.occupancy > 50 ? '#818cf8' : '#c7d2fe'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-between text-xs text-ink-faint mt-1 px-1">
              <span>{from}</span>
              <span className="text-brand font-semibold">היום</span>
              <span>{to}</span>
            </div>
          </div>
        </div>

        {/* Source breakdown */}
        <div className="card">
          <div className="card-header">
            <span className="font-semibold text-ink text-sm">מקורות הזמנה</span>
          </div>
          <div className="card-body flex flex-col gap-3">
            {bySource.length === 0 && <div className="text-xs text-ink-faint">אין נתונים</div>}
            {bySource.map(item => (
              <SourceBar key={item.source} item={item} total={total.reservations} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue chart */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <DollarSign size={15} className="text-emerald-600" />
              <span className="font-semibold text-ink text-sm">הכנסות יומיות (₪)</span>
            </div>
          </div>
          <div className="card-body pt-2">
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={chartData} barSize={chartData.length > 30 ? 4 : 8} margin={{ top:4, right:4, bottom:0, left:0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                />
                <YAxis hide />
                <Tooltip content={<ChartTooltip unit="₪" />} cursor={{ fill: 'rgba(16,185,129,0.06)' }} />
                <Bar dataKey="revenue" radius={[3,3,0,0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.isToday ? '#059669' : '#6ee7b7'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-between text-xs text-ink-faint mt-1 px-1">
              <span>{from}</span>
              <span>{to}</span>
            </div>
          </div>
        </div>

        {/* Last 7 days table */}
        <div className="card">
          <div className="card-header">
            <span className="font-semibold text-ink text-sm">7 ימים אחרונים</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>תפוסה</th>
                <th>הגעות</th>
                <th>הכנסה</th>
              </tr>
            </thead>
            <tbody>
              {last7.map(d => (
                <tr key={d.date} className={d.date === TODAY ? 'bg-brand/5' : ''}>
                  <td className="text-num text-xs font-semibold">
                    {d.date === TODAY ? <span className="text-brand">היום</span> : d.date.slice(5)}
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 bg-surface-hover rounded-full max-w-16 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width:`${d.occupancy}%`, background: d.occupancy>80?'#059669':'#6366f1' }} />
                      </div>
                      <span className="text-xs font-bold text-num">{d.occupancy}%</span>
                    </div>
                  </td>
                  <td className="text-num text-xs">{d.arrivals}</td>
                  <td className="text-num text-xs font-semibold">₪{(d.revenue||0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status breakdown */}
      {byStatus.length > 0 && (
        <div className="card mt-4">
          <div className="card-header">
            <span className="font-semibold text-ink text-sm">סטטוס הזמנות</span>
          </div>
          <div className="card-body flex flex-wrap gap-3">
            {byStatus.map(({ status, count }) => {
              const map = {
                confirmed:'badge-confirmed', in_house:'badge-inhouse', checked_out:'badge-departure',
                cancelled:'badge-cancelled', no_show:'badge-dirty',
              };
              const labels = { confirmed:'מאושר', in_house:'In House', checked_out:'עזב', cancelled:'בוטל', no_show:'No Show' };
              return (
                <div key={status} className="flex items-center gap-2">
                  <span className={`badge ${map[status] || 'badge-pending'}`}>{labels[status] || status}</span>
                  <span className="text-sm font-bold text-num text-ink">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
