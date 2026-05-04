import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  BedDouble, Calendar, Users, LogIn, LogOut, Wrench, Sparkles,
  BarChart3, BriefcaseBusiness, Settings, Moon, Home,
  ArrowLeft, CheckCircle2, AlertTriangle, Clock,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { dashboard } from '../utils/api';
import { PageSpinner } from '../components/ui/Spinner';

const TODAY_STR = new Date().toISOString().split('T')[0];

function pad(n) { return String(n).padStart(2, '0'); }

function LiveClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 30000); return () => clearInterval(id); }, []);
  const days = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return (
    <div className="text-left" dir="ltr">
      <div className="text-4xl font-black text-num text-ink leading-none">
        {pad(t.getHours())}:{pad(t.getMinutes())}
      </div>
      <div className="text-sm text-ink-muted mt-1">
        {days[t.getDay()]}, {t.getDate()} {months[t.getMonth()]} {t.getFullYear()}
      </div>
    </div>
  );
}

const QUICK_LINKS = [
  { to:'/dashboard',    label:'לוח בקרה',   Icon: Home,            color:'#6366f1', bg:'rgba(99,102,241,0.1)'  },
  { to:'/reservations', label:'הזמנות',      Icon: Calendar,        color:'#0891b2', bg:'rgba(8,145,178,0.1)'   },
  { to:'/room-rack',    label:'Room Rack',   Icon: BedDouble,       color:'#7c3aed', bg:'rgba(124,58,237,0.1)'  },
  { to:'/check-in',     label:'צ׳ק-אין',     Icon: LogIn,           color:'#059669', bg:'rgba(16,185,129,0.1)'  },
  { to:'/check-out',    label:'צ׳ק-אאוט',    Icon: LogOut,          color:'#ea580c', bg:'rgba(249,115,22,0.1)'  },
  { to:'/housekeeping', label:'חדרנות',      Icon: Sparkles,        color:'#d97706', bg:'rgba(217,119,6,0.1)'   },
  { to:'/guests',       label:'אורחים',      Icon: Users,           color:'#be185d', bg:'rgba(190,24,93,0.1)'   },
  { to:'/maintenance',  label:'תחזוקה',      Icon: Wrench,          color:'#6b7280', bg:'rgba(107,114,128,0.1)' },
  { to:'/reports',      label:'דוחות',       Icon: BarChart3,       color:'#065f46', bg:'rgba(6,95,70,0.1)'     },
  { to:'/companies',    label:'חברות',       Icon: BriefcaseBusiness,color:'#1d4ed8',bg:'rgba(29,78,216,0.1)'  },
  { to:'/night-audit',  label:'ביקורת לילה', Icon: Moon,            color:'#4c1d95', bg:'rgba(76,29,149,0.1)'  },
  { to:'/settings',     label:'הגדרות',      Icon: Settings,        color:'#374151', bg:'rgba(55,65,81,0.1)'    },
];

function StatChip({ label, value, color, bg, to }) {
  const inner = (
    <div className="flex flex-col items-center gap-1 py-3 px-3 rounded-xl border border-surface-border text-center transition-all hover:shadow-card hover:scale-[1.02]"
      style={{ background: bg }}>
      <div className="text-2xl font-black text-num" style={{ color }}>{value ?? '—'}</div>
      <div className="text-xs font-medium text-ink-secondary">{label}</div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export default function HomePage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;

  const { data: stats, loading } = useApi(
    () => dashboard.stats(propertyId), [propertyId], skip
  );
  const { data: arrivals } = useApi(
    () => dashboard.arrivals(propertyId), [propertyId], skip
  );
  const { data: alerts } = useApi(
    () => dashboard.alerts(propertyId), [propertyId], skip
  );

  const s   = stats || {};
  const arr = (arrivals || []).slice(0, 5);
  const urgentAlerts = (alerts || []).filter(a => a.severity === 'high' || a.type === 'danger');

  return (
    <div className="animate-fade-in max-w-5xl mx-auto" dir="rtl">
      {/* hero */}
      <div className="card p-6 mb-5 flex items-center justify-between flex-wrap gap-4"
        style={{ background:'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(16,185,129,0.04) 100%)' }}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-1">Hotel4U PMS</p>
          <h1 className="text-3xl font-black text-ink">שלום! 👋</h1>
          <p className="text-ink-muted text-sm mt-1">
            {loading ? 'טוען נתונים...' : !propertyId ? 'בחר מלון מהתפריט כדי לראות נתונים' : `היום ${TODAY_STR}`}
          </p>
        </div>
        <LiveClock/>
      </div>

      {/* urgent alerts */}
      {urgentAlerts.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          {urgentAlerts.slice(0, 3).map((a, i) => (
            <div key={i} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm">
              <AlertTriangle size={14} className="flex-shrink-0"/>
              <span>{a.message || a.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* stats row */}
      {propertyId && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 mb-5">
          <StatChip label="הגעות היום"  value={s.arrivals}   color="#7c3aed" bg="rgba(124,58,237,0.07)" to="/check-in"/>
          <StatChip label="יציאות היום" value={s.departures} color="#ea580c" bg="rgba(249,115,22,0.07)"  to="/check-out"/>
          <StatChip label="In House"    value={s.inHouse}    color="#2563eb" bg="rgba(37,99,235,0.07)"   to="/room-rack"/>
          <StatChip label="תפוסה"       value={s.occupancyPct != null ? `${s.occupancyPct}%` : '—'} color="#059669" bg="rgba(16,185,129,0.07)"/>
          <StatChip label="לא מוקצה"    value={s.unassigned} color="#dc2626" bg="rgba(220,38,38,0.07)"   to="/reservations"/>
        </div>
      )}

      {/* quick links grid */}
      <div className="mb-5">
        <h2 className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-3">ניווט מהיר</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {QUICK_LINKS.map(({ to, label, Icon, color, bg }) => (
            <Link key={to} to={to}
              className="flex flex-col items-center gap-2 py-4 px-2 rounded-xl border border-surface-border text-center
                transition-all hover:shadow-card hover:scale-[1.04] active:scale-[0.97]"
              style={{ background: bg }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: `${color}20` }}>
                <Icon size={18} style={{ color }}/>
              </div>
              <span className="text-xs font-semibold text-ink-secondary leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* upcoming arrivals */}
      {arr.length > 0 && (
        <div className="card mb-4">
          <div className="card-header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-violet-500"/>
              <span className="font-semibold text-ink text-sm">הגעות קרובות</span>
            </div>
            <Link to="/check-in" className="text-xs text-brand hover:underline flex items-center gap-0.5">
              הכל <ArrowLeft size={11}/>
            </Link>
          </div>
          <div className="flex flex-col divide-y divide-surface-border">
            {arr.map(r => (
              <div key={r._id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-violet-600">
                  {(r.primaryGuest?.firstName || '?')[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink truncate">
                    {r.primaryGuest?.firstName} {r.primaryGuest?.lastName}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {r.roomType?.name} · {r.nights} לילות
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs font-mono text-ink-faint">{r.arrivalDate}</div>
                  <Link to="/check-in"
                    className="text-xs text-brand font-semibold hover:underline flex items-center gap-0.5 justify-end mt-0.5">
                    צ׳ק-אין <ArrowLeft size={10}/>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!propertyId && (
        <div className="card p-10 text-center">
          <Home size={40} className="mx-auto mb-3 text-ink-faint/40"/>
          <p className="text-ink-muted text-sm">בחר מלון מהתפריט הצדדי כדי להתחיל</p>
        </div>
      )}
    </div>
  );
}
