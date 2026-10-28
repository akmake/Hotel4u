import { useState, useMemo, useCallback } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Users, BedDouble, DollarSign,
  Calendar, RefreshCw, Download, Printer, ChevronLeft, ChevronRight,
  ArrowUpRight, ArrowDownRight, Minus, ReceiptText, Globe,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, LineChart, Line, Legend,
} from 'recharts';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { reports as reportsApi, legalReports } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { TODAY, addDays } from '../utils/date';
import { BackArrow } from '../components/kit';

/* ── helpers ─────────────────────────────────────────────────────────────── */
const RANGES = [
  { label:'7 ימים',  days: 7  },
  { label:'30 ימים', days: 30 },
  { label:'90 ימים', days: 90 },
];
const SOURCE_FLAGS = {
  booking:'🌐', expedia:'🔷', agoda:'🟠', direct:'🏨',
  phone:'📞', walk_in:'🚶', corporate:'🏢', agent:'🤝',
};

function fmtILS(n) { return `₪${(n||0).toLocaleString('he-IL')}`; }
function pct(a, b) { if (!b) return null; return Math.round((a - b) / b * 100); }
function trendArrow(delta) {
  if (delta === null) return null;
  if (delta > 0)  return <ArrowUpRight  size={12} className="text-emerald-500"/>;
  if (delta < 0)  return <ArrowDownRight size={12} className="text-red-400"/>;
  return <Minus size={12} className="text-ink-faint"/>;
}

/* ── chart tooltip ────────────────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label, prefix = '', suffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-surface-border rounded-xl shadow-lg px-3 py-2 text-xs text-right" dir="rtl">
      <div className="font-semibold text-ink mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill || p.stroke }}/>
          <span className="text-ink-secondary">{p.name}:</span>
          <span className="font-bold" style={{ color: p.fill || p.stroke }}>
            {prefix}{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}{suffix}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── KPI card ─────────────────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, sub, color, bg, trend, trendLabel }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
        <Icon size={20} style={{ color }}/>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink-muted font-medium truncate">{label}</div>
        <div className="text-2xl font-black text-num leading-tight" style={{ color }}>{value ?? '—'}</div>
        <div className="flex items-center gap-1 mt-0.5">
          {trend !== null && trend !== undefined && (
            <>
              {trendArrow(trend)}
              <span className={`text-xs font-semibold ${trend > 0 ? 'text-emerald-500' : trend < 0 ? 'text-red-400' : 'text-ink-faint'}`}>
                {trend > 0 ? '+' : ''}{trend}%
              </span>
              {trendLabel && <span className="text-xs text-ink-faint">{trendLabel}</span>}
            </>
          )}
          {sub && !trend && <span className="text-xs text-ink-faint">{sub}</span>}
        </div>
      </div>
    </div>
  );
}

/* ── source bar ───────────────────────────────────────────────────────────── */
function SourceBar({ item, total }) {
  const p = total ? Math.round(item.count / total * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xs text-ink-secondary flex-shrink-0 truncate">
        {SOURCE_FLAGS[item.source] || '📋'} {item.source}
      </div>
      <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width:`${p}%`, background:'#6366f1' }}/>
      </div>
      <div className="text-xs font-bold text-num w-16 text-left text-ink-secondary">
        {item.count} ({p}%)
      </div>
    </div>
  );
}

/* ── VAT Report Panel ──────────────────────────────────────────────────────── */
function VatReportPanel({ propertyId }) {
  const today = TODAY;
  const [from, setFrom] = useState(today.slice(0,7) + '-01');
  const [to,   setTo]   = useState(today);

  const { data, loading, error, refetch } = useApi(
    () => legalReports.vatReport(propertyId, from, to),
    [propertyId, from, to], !propertyId,
  );

  const s = data?.summary || {};

  function downloadCsv() {
    if (!data?.list?.length) return;
    const header = ['מספר חשבונית','תאריך','סוג','שם רוכש','ח.פ./ע.מ.','נטו','מע"מ','ברוטו','מס\' הקצאה'].join(',');
    const rows = data.list.map(i => [
      i.invoiceNumber, i.issuedAt?.slice(0,10), i.type, i.buyer || '', i.buyerVat || '',
      i.totalNet, i.totalVat, i.totalGross, i.allocationNumber || '',
    ].join(','));
    const csv = '\uFEFF' + [header, ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `vat_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-bold text-ink flex items-center gap-2"><ReceiptText size={16}/> דוח מע"מ</h2>
          <p className="text-xs text-ink-muted">לפי חוק מע"מ תשל"ו-1975 | בסיס לדיווח תקופתי (טופס 1216)</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">מ</label>
            <input type="date" className="input text-sm" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">עד</label>
            <input type="date" className="input text-sm" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <button className="btn btn-ghost btn-sm gap-1" onClick={refetch}><RefreshCw size={13}/></button>
          <button className="btn btn-secondary btn-sm gap-1" onClick={downloadCsv}><Download size={13}/> CSV</button>
        </div>
      </div>

      {loading && <div className="flex justify-center py-8"><Spinner size={24}/></div>}
      {error   && <div className="text-xs text-red-500 text-center py-4">{error}</div>}

      {!loading && !error && s.totalInvoices !== undefined && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label:'מחזור עסקאות (נטו)',    val: `₪${(s.totalSalesNet||0).toLocaleString('he-IL',{minimumFractionDigits:2})}`, color:'#059669', bg:'rgba(16,185,129,0.1)' },
              { label:'מע"מ עסקאות',          val: `₪${(s.totalSalesVat||0).toLocaleString('he-IL',{minimumFractionDigits:2})}`, color:'#d97706', bg:'rgba(245,158,11,0.1)' },
              { label:'סה"כ זיכויים (מע"מ)',  val: `₪${(s.totalCreditsVat||0).toLocaleString('he-IL',{minimumFractionDigits:2})}`, color:'#dc2626', bg:'rgba(239,68,68,0.1)' },
              { label:'מע"מ לתשלום לרשות',   val: `₪${(s.netVatPayable||0).toLocaleString('he-IL',{minimumFractionDigits:2})}`, color:'#7c3aed', bg:'rgba(124,58,237,0.1)' },
            ].map(c => (
              <div key={c.label} className="card p-3">
                <div className="text-xs text-ink-muted mb-1">{c.label}</div>
                <div className="text-xl font-black text-num" style={{ color:c.color }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* By type */}
          <div className="card overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-surface-border text-xs font-bold text-ink-secondary">פירוט לפי סוג מסמך</div>
            <table className="data-table">
              <thead><tr><th>סוג</th><th>מסמכים</th><th>נטו</th><th>מע"מ</th><th>ברוטו</th></tr></thead>
              <tbody>
                {(s.byType||[]).map(r => (
                  <tr key={r.type}>
                    <td className="text-sm font-medium text-ink">{
                      {tax_invoice:'חשבונית מס', tax_invoice_receipt:'חשבונית מס/קבלה', receipt:'קבלה', credit_note:'זיכוי', debit_note:'חיוב'}[r.type] || r.type
                    }</td>
                    <td className="text-num text-sm">{r.count}</td>
                    <td className="text-num text-sm">₪{r.totalNet?.toLocaleString()}</td>
                    <td className="text-num text-sm text-amber-700">₪{r.totalVat?.toLocaleString()}</td>
                    <td className="text-num text-sm font-bold">₪{r.totalGross?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Invoice list */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-border text-xs font-bold text-ink-secondary">
              רשימת חשבוניות לביקורת ({data.list?.length || 0})
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>מספר</th><th>תאריך</th><th>סוג</th><th>רוכש</th><th>נטו</th><th>מע"מ</th><th>ברוטו</th><th>הקצאה</th></tr></thead>
                <tbody>
                  {(data.list||[]).slice(0,50).map((i,idx) => (
                    <tr key={idx}>
                      <td className="text-num font-bold text-xs">{i.invoiceNumber}</td>
                      <td className="text-xs text-ink-muted">{i.issuedAt?.slice(0,10)}</td>
                      <td className="text-xs">{i.type}</td>
                      <td className="text-xs">{i.buyer||'—'}</td>
                      <td className="text-num text-xs">₪{i.totalNet?.toLocaleString()}</td>
                      <td className="text-num text-xs text-amber-700">₪{i.totalVat?.toLocaleString()}</td>
                      <td className="text-num text-xs font-bold">₪{i.totalGross?.toLocaleString()}</td>
                      <td className="text-xs">{i.allocationNumber || <span className="text-ink-faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Tourist Registry Panel ────────────────────────────────────────────────── */
function TouristRegistryPanel({ propertyId }) {
  const [date, setDate] = useState(TODAY);

  const { data, loading, error, refetch } = useApi(
    () => legalReports.touristRegistry(propertyId, date),
    [propertyId, date], !propertyId,
  );

  function downloadCsv() {
    const list = data?.fromReservations || [];
    if (!list.length) return;
    const header = ['שם פרטי','שם משפחה','לאום','סוג מסמך','מספר מסמך','תאריך לידה','תאריך הגעה','תאריך עזיבה','חדר'].join(',');
    const rows = list.map(g => [
      g.firstName, g.lastName, g.nationality, g.idDocType, g.idDocNumber,
      g.dateOfBirth ? new Date(g.dateOfBirth).toLocaleDateString('he-IL') : '',
      g.arrivalDate, g.departureDate, g.assignedRoom || '',
    ].join(','));
    const csv = '\uFEFF' + [header, ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `registry_${date}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const allGuests = [...(data?.fromReservations || [])];
  const unsigned = data?.unsignedCards || 0;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-bold text-ink flex items-center gap-2"><Globe size={16}/> פנקס אורחים</h2>
          <p className="text-xs text-ink-muted">חובה לפי חוק בתי מלון תשי"ד-1954 | אורחים מאוכלסים ביום שנבחר</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">תאריך</label>
            <input type="date" className="input text-sm" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <button className="btn btn-ghost btn-sm gap-1" onClick={refetch}><RefreshCw size={13}/></button>
          <button className="btn btn-secondary btn-sm gap-1" onClick={downloadCsv}><Download size={13}/> CSV</button>
        </div>
      </div>

      {loading && <div className="flex justify-center py-8"><Spinner size={24}/></div>}
      {error   && <div className="text-xs text-red-500 text-center py-4">{error}</div>}

      {!loading && !error && data && (
        <>
          {/* stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="card p-3 text-center">
              <div className="text-2xl font-black text-num text-indigo-600">{data.totalInHouse}</div>
              <div className="text-xs text-ink-muted">אורחים מאוכלסים</div>
            </div>
            <div className="card p-3 text-center">
              <div className="text-2xl font-black text-num text-emerald-600">{data.formalCards?.length || 0}</div>
              <div className="text-xs text-ink-muted">כרטיסי רישום רשמיים</div>
            </div>
            <div className="card p-3 text-center" style={{ background: unsigned > 0 ? 'rgba(239,68,68,0.05)' : undefined }}>
              <div className={`text-2xl font-black text-num ${unsigned > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{unsigned}</div>
              <div className="text-xs text-ink-muted">כרטיסים לא חתומים</div>
            </div>
          </div>

          {/* table */}
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>שם מלא</th>
                  <th>לאום</th>
                  <th>סוג מסמך</th>
                  <th>מספר מסמך</th>
                  <th>תאריך הגעה</th>
                  <th>תאריך יציאה</th>
                  <th>חדר</th>
                </tr>
              </thead>
              <tbody>
                {allGuests.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-ink-muted py-6">אין אורחים מאוכלסים בתאריך זה</td></tr>
                )}
                {allGuests.map((g, i) => (
                  <tr key={i}>
                    <td className="font-semibold text-sm text-ink">{g.firstName} {g.lastName}</td>
                    <td className="text-xs text-ink-muted">{g.nationality || '—'}</td>
                    <td className="text-xs">{g.idDocType || '—'}</td>
                    <td className="text-num text-xs">{g.idDocNumber || <span className="text-red-400 font-semibold">חסר!</span>}</td>
                    <td className="text-num text-xs">{g.arrivalDate}</td>
                    <td className="text-num text-xs">{g.departureDate}</td>
                    <td className="text-num font-bold text-xs">{g.assignedRoom || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ── export CSV ───────────────────────────────────────────────────────────── */
function exportCsv(daily, from, to) {
  const header = ['תאריך', 'הגעות', 'יציאות', 'מאוכלס', 'תפוסה%', 'הכנסה', 'ADR'].join(',');
  const rows = daily.map(d =>
    [d.date, d.arrivals, d.departures ?? '', d.occupied, d.occupancy, d.revenue, d.adr ?? ''].join(',')
  );
  const csv = '\uFEFF' + [header, ...rows].join('\n'); // BOM for Excel
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `report_${from}_${to}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ── main ─────────────────────────────────────────────────────────────────── */
export default function ReportsPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;

  const [mainTab,   setMainTab]   = useState('kpi'); // kpi | vat | registry
  const [rangeIdx,  setRangeIdx]  = useState(1);
  const [customFrom,setCustomFrom]= useState('');
  const [customTo,  setCustomTo]  = useState('');
  const [chartType, setChartType] = useState('bar'); // bar | line

  const isCustom = !!(customFrom && customTo);
  const to   = isCustom ? customTo   : TODAY;
  const from = isCustom ? customFrom : addDays(TODAY, -RANGES[rangeIdx].days);
  const days = RANGES[rangeIdx].days;

  // prior period (same length, before current)
  const priorTo   = addDays(from, -1);
  const priorFrom = isCustom
    ? addDays(customFrom, -(Math.round((new Date(customTo)-new Date(customFrom))/86400000)))
    : addDays(TODAY, -days * 2);

  const { data,       loading,  error,  refetch } = useApi(
    () => reportsApi.summary(propertyId, from, to),
    [propertyId, from, to], skip
  );
  const { data: prior } = useApi(
    () => reportsApi.summary(propertyId, priorFrom, priorTo),
    [propertyId, priorFrom, priorTo], skip
  );

  const { daily = [], total = {}, bySource = [], byStatus = [], top7 = [] } = data || {};
  const priorTotal = prior?.total || {};

  const chartData = useMemo(() => daily.map(d => ({
    ...d,
    label: d.date.slice(5),
    isToday: d.date === TODAY,
  })), [daily]);

  // monthly roll-up
  const monthly = useMemo(() => {
    const map = {};
    daily.forEach(d => {
      const m = d.date.slice(0, 7);
      if (!map[m]) map[m] = { month: m, occupancy: 0, revenue: 0, arrivals: 0, count: 0 };
      map[m].occupancy += d.occupancy;
      map[m].revenue   += d.revenue;
      map[m].arrivals  += d.arrivals;
      map[m].count++;
    });
    return Object.values(map).map(m => ({ ...m, avgOcc: Math.round(m.occupancy / m.count) }))
      .sort((a,b) => a.month.localeCompare(b.month));
  }, [daily]);

  if (skip || loading) return <PageSpinner/>;
  if (error)           return <ErrorState message={error} onRetry={refetch}/>;

  const last7 = [...daily].slice(-7);
  const totRevTrend = pct(total.revenue, priorTotal.revenue);
  const totOccTrend = pct(total.avgOccupancy, priorTotal.avgOccupancy);
  const totAdrTrend = pct(total.adr, priorTotal.adr);
  const totResTrend = pct(total.reservations, priorTotal.reservations);

  return (
    <div className="animate-fade-in ui-page is-approved is-legacy">
      {/* header */}
      <div className="page-header">
        <div><BackArrow />
          <h1 className="page-title">דוחות</h1>
          <p className="page-subtitle">ניתוח ביצועים — {from} עד {to}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Main tab selector */}
          {[
            { key:'kpi',      label:'📊 ביצועים' },
            { key:'vat',      label:'🧾 מע"מ' },
            { key:'registry', label:'🌍 פנקס אורחים' },
          ].map(t => (
            <button key={t.key} onClick={() => setMainTab(t.key)}
              className={`btn btn-sm ${mainTab === t.key ? 'btn-primary' : 'btn-secondary'}`}>
              {t.label}
            </button>
          ))}
          {mainTab === 'kpi' && (
            <>
              {RANGES.map((r, i) => (
                <button key={r.label} onClick={() => { setRangeIdx(i); setCustomFrom(''); setCustomTo(''); }}
                  className={`btn btn-sm ${!isCustom && rangeIdx === i ? 'btn-primary' : 'btn-secondary'}`}>
                  {r.label}
                </button>
              ))}
              <input type="date" className="input text-xs py-1 px-2 w-36" value={customFrom}
                onChange={e => setCustomFrom(e.target.value)} title="מ-"/>
              <input type="date" className="input text-xs py-1 px-2 w-36" value={customTo}
                onChange={e => setCustomTo(e.target.value)} title="עד"/>
              <button className="btn btn-ghost btn-icon" onClick={refetch}><RefreshCw size={15}/></button>
              <button className="btn btn-secondary flex items-center gap-1.5"
                onClick={() => exportCsv(daily, from, to)}>
                <Download size={14}/> CSV
              </button>
              <button className="btn btn-secondary flex items-center gap-1.5"
                onClick={() => window.print()}>
                <Printer size={14}/> הדפס
              </button>
            </>
          )}
        </div>
      </div>

      {/* Legal reports tabs */}
      {mainTab === 'vat'      && <VatReportPanel      propertyId={propertyId} />}
      {mainTab === 'registry' && <TouristRegistryPanel propertyId={propertyId} />}

      {mainTab === 'kpi' && (<>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <KpiCard icon={BedDouble}  label="תפוסה ממוצעת" value={`${total.avgOccupancy||0}%`}           color="#6366f1" bg="rgba(99,102,241,0.1)"   trend={totOccTrend} trendLabel="לעומת תקופה קודמת"/>
        <KpiCard icon={DollarSign} label="הכנסה כוללת"  value={fmtILS(total.revenue)}                 color="#059669" bg="rgba(16,185,129,0.1)"  trend={totRevTrend} trendLabel=""/>
        <KpiCard icon={TrendingUp} label="ADR"           value={fmtILS(total.adr)}                     color="#2563eb" bg="rgba(59,130,246,0.1)"  trend={totAdrTrend} sub="ממוצע ללינה"/>
        <KpiCard icon={BarChart3}  label="RevPAR"        value={fmtILS(total.revpar)}                  color="#7c3aed" bg="rgba(124,58,237,0.1)"  trend={null}        sub="הכנסה לחדר"/>
        <KpiCard icon={Calendar}   label="הזמנות"        value={total.reservations||0}                  color="#ea580c" bg="rgba(249,115,22,0.1)"  trend={totResTrend} trendLabel=""/>
        <KpiCard icon={Users}      label="אורחים"        value={total.totalGuests||0}                   color="#0891b2" bg="rgba(8,145,178,0.1)"   trend={null}        sub="סה״כ פרופילים"/>
      </div>

      {/* chart toggle */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-ink-secondary">סוג גרף:</span>
        {['bar','line'].map(t => (
          <button key={t} onClick={() => setChartType(t)}
            className={`btn btn-sm ${chartType===t ? 'btn-primary' : 'btn-secondary'}`}>
            {t === 'bar' ? '📊 עמודות' : '📈 קו'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* occupancy chart */}
        <div className="card lg:col-span-2">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <BarChart3 size={15} className="text-brand"/>
              <span className="font-semibold text-ink text-sm">תפוסה יומית %</span>
              {priorTotal.avgOccupancy && (
                <span className="text-xs text-ink-faint">
                  (תקופה קודמת: {priorTotal.avgOccupancy}%)
                </span>
              )}
            </div>
          </div>
          <div className="px-4 pb-4 pt-2">
            <ResponsiveContainer width="100%" height={130}>
              {chartType === 'bar' ? (
                <BarChart data={chartData} barSize={chartData.length > 30 ? 4 : 8} margin={{ top:4, right:4, bottom:0, left:0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="label" tick={{ fontSize:9, fill:'#94a3b8' }} tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(chartData.length/7)-1)}/>
                  <YAxis hide domain={[0,100]}/>
                  <Tooltip content={<ChartTooltip suffix="%"/>} cursor={{ fill:'rgba(99,102,241,0.06)' }}/>
                  <Bar dataKey="occupancy" name="תפוסה" radius={[3,3,0,0]}>
                    {chartData.map((d,i) => (
                      <Cell key={i} fill={d.isToday?'#6366f1':d.occupancy>80?'#059669':d.occupancy>50?'#818cf8':'#c7d2fe'}/>
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <LineChart data={chartData} margin={{ top:4, right:4, bottom:0, left:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="label" tick={{ fontSize:9, fill:'#94a3b8' }} tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(chartData.length/7)-1)}/>
                  <YAxis hide domain={[0,100]}/>
                  <Tooltip content={<ChartTooltip suffix="%"/>}/>
                  <Line type="monotone" dataKey="occupancy" name="תפוסה" stroke="#6366f1" strokeWidth={2} dot={false}/>
                </LineChart>
              )}
            </ResponsiveContainer>
            <div className="flex justify-between text-xs text-ink-faint mt-1 px-1">
              <span>{from}</span>
              <span className="text-brand font-semibold">היום</span>
              <span>{to}</span>
            </div>
          </div>
        </div>

        {/* source */}
        <div className="card">
          <div className="card-header">
            <span className="font-semibold text-ink text-sm">מקורות הזמנה</span>
          </div>
          <div className="px-4 py-3 flex flex-col gap-3">
            {bySource.length === 0 && <div className="text-xs text-ink-faint">אין נתונים</div>}
            {bySource.map(item => (
              <SourceBar key={item.source} item={item} total={total.reservations}/>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* revenue chart */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <DollarSign size={15} className="text-emerald-600"/>
              <span className="font-semibold text-ink text-sm">הכנסות יומיות (₪)</span>
            </div>
          </div>
          <div className="px-4 pb-4 pt-2">
            <ResponsiveContainer width="100%" height={110}>
              {chartType === 'bar' ? (
                <BarChart data={chartData} barSize={chartData.length>30?4:8} margin={{ top:4, right:4, bottom:0, left:0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="label" tick={{ fontSize:9, fill:'#94a3b8' }} tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(chartData.length/5)-1)}/>
                  <YAxis hide/>
                  <Tooltip content={<ChartTooltip prefix="₪"/>} cursor={{ fill:'rgba(16,185,129,0.06)' }}/>
                  <Bar dataKey="revenue" name="הכנסה" radius={[3,3,0,0]}>
                    {chartData.map((d,i) => <Cell key={i} fill={d.isToday?'#059669':'#6ee7b7'}/>)}
                  </Bar>
                </BarChart>
              ) : (
                <LineChart data={chartData} margin={{ top:4, right:4, bottom:0, left:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="label" tick={{ fontSize:9, fill:'#94a3b8' }} tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(chartData.length/5)-1)}/>
                  <YAxis hide/>
                  <Tooltip content={<ChartTooltip prefix="₪"/>}/>
                  <Line type="monotone" dataKey="revenue" name="הכנסה" stroke="#059669" strokeWidth={2} dot={false}/>
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* last 7 days table */}
        <div className="card">
          <div className="card-header">
            <span className="font-semibold text-ink text-sm">7 ימים אחרונים</span>
          </div>
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>תפוסה</th>
                <th>הגעות</th>
                <th>הכנסה</th>
                <th>ADR</th>
              </tr>
            </thead>
            <tbody>
              {last7.map(d => (
                <tr key={d.date} className={d.date === TODAY ? 'bg-brand/5 font-semibold' : ''}>
                  <td className="text-num text-xs">{d.date === TODAY ? <span className="text-brand font-bold">היום</span> : d.date.slice(5)}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 bg-surface-hover rounded-full max-w-16 overflow-hidden">
                        <div className="h-full rounded-full"
                          style={{ width:`${d.occupancy}%`, background:d.occupancy>80?'#059669':'#6366f1' }}/>
                      </div>
                      <span className="text-xs font-bold text-num">{d.occupancy}%</span>
                    </div>
                  </td>
                  <td className="text-num text-xs">{d.arrivals}</td>
                  <td className="text-num text-xs font-semibold">{fmtILS(d.revenue)}</td>
                  <td className="text-num text-xs">{fmtILS(d.adr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* monthly roll-up */}
      {monthly.length > 1 && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="font-semibold text-ink text-sm">סיכום חודשי</span>
          </div>
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>חודש</th>
                <th>תפוסה ממוצעת</th>
                <th>הגעות</th>
                <th>הכנסה</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map(m => (
                <tr key={m.month}>
                  <td className="font-semibold text-ink text-sm">{m.month}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-surface-hover rounded-full max-w-24 overflow-hidden">
                        <div className="h-full rounded-full"
                          style={{ width:`${m.avgOcc}%`, background: m.avgOcc>80?'#059669':'#6366f1'}}/>
                      </div>
                      <span className="text-xs font-bold text-num">{m.avgOcc}%</span>
                    </div>
                  </td>
                  <td className="text-num text-sm">{m.arrivals}</td>
                  <td className="text-num text-sm font-bold">{fmtILS(m.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* top 7 days + status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {top7.length > 0 && (
          <div className="card">
            <div className="card-header">
              <span className="font-semibold text-ink text-sm">🏆 7 ימי הכנסה מובילים</span>
            </div>
            <table className="data-table w-full">
              <thead><tr><th>#</th><th>תאריך</th><th>הכנסה</th><th>תפוסה</th></tr></thead>
              <tbody>
                {top7.map((d, i) => (
                  <tr key={d.date}>
                    <td className="text-ink-faint text-xs font-bold">{i+1}</td>
                    <td className="text-num text-xs">{d.date}</td>
                    <td className="text-num text-sm font-bold text-emerald-600">{fmtILS(d.revenue)}</td>
                    <td className="text-num text-xs">{d.occupancy}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {byStatus.length > 0 && (
          <div className="card">
            <div className="card-header">
              <span className="font-semibold text-ink text-sm">סטטוס הזמנות</span>
            </div>
            <div className="px-4 py-3 flex flex-col gap-3">
              {byStatus.map(({ status, count }) => {
                const MAP = {
                  confirmed:'badge-confirmed', in_house:'badge-inhouse', checked_in:'badge-inhouse',
                  checked_out:'badge-departure', cancelled:'badge-cancelled', no_show:'badge-dirty',
                };
                const LABELS = {
                  confirmed:'מאושר', in_house:'In House', checked_in:'In House',
                  checked_out:'עזב', cancelled:'בוטל', no_show:'No Show',
                };
                const pctVal = total.reservations ? Math.round(count / total.reservations * 100) : 0;
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className={`badge ${MAP[status]||'badge-pending'} w-20 text-center`}>{LABELS[status]||status}</span>
                    <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width:`${pctVal}%`, background:'#6366f1' }}/>
                    </div>
                    <span className="text-sm font-bold text-num text-ink w-8">{count}</span>
                    <span className="text-xs text-ink-faint w-10 text-left">{pctVal}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* prior period comparison */}
      {priorTotal.revenue > 0 && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="font-semibold text-ink text-sm">📊 השוואה לתקופה קודמת ({priorFrom} — {priorTo})</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-x-reverse divide-surface-border">
            {[
              { label:'הכנסה',    curr: fmtILS(total.revenue),         prior: fmtILS(priorTotal.revenue),         trend: totRevTrend },
              { label:'תפוסה',    curr: `${total.avgOccupancy||0}%`,   prior:`${priorTotal.avgOccupancy||0}%`,    trend: totOccTrend },
              { label:'ADR',      curr: fmtILS(total.adr),             prior: fmtILS(priorTotal.adr),             trend: totAdrTrend },
              { label:'הזמנות',   curr: total.reservations||0,         prior: priorTotal.reservations||0,         trend: totResTrend },
            ].map(row => (
              <div key={row.label} className="flex flex-col items-center py-4 px-3 text-center">
                <div className="text-xs text-ink-faint mb-1">{row.label}</div>
                <div className="text-lg font-black text-num text-ink">{row.curr}</div>
                <div className="text-xs text-ink-muted mb-1">לעומת {row.prior}</div>
                <div className={`flex items-center gap-0.5 text-xs font-bold
                  ${row.trend > 0 ? 'text-emerald-600' : row.trend < 0 ? 'text-red-500' : 'text-ink-faint'}`}>
                  {trendArrow(row.trend)}
                  {row.trend !== null ? `${row.trend > 0 ? '+' : ''}${row.trend}%` : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>)} {/* end mainTab === 'kpi' */}
    </div>
  );
}
