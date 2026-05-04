import { useNavigate } from 'react-router-dom';
import { LogIn, LogOut, Users, BedDouble, Sparkles, Wrench, AlertTriangle, AlertCircle, Info, CheckCircle2, Crown } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { dashboard } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';

// ─── Alert → route mapping ────────────────────────────────────────────────────
function alertRoute(alert) {
  if (alert.id?.startsWith('noroom-'))  return '/room-rack';
  if (alert.id?.startsWith('balance-')) return '/check-out';
  if (alert.id?.startsWith('hk-'))      return '/housekeeping';
  if (alert.id?.startsWith('vip-'))     return '/housekeeping';
  return '/reservations';
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color, bgColor, urgent, onClick }) {
  return (
    <div
      className={`stat-card ${urgent ? 'border-red-200 bg-red-50/30' : ''} ${onClick ? 'cursor-pointer hover:shadow-card-hover transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="stat-icon" style={{ background: bgColor }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink-muted font-medium truncate">{label}</div>
        <div className="text-2xl font-bold text-ink leading-tight text-num">{value ?? '—'}</div>
        {sub && <div className="text-xs text-ink-faint mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function AlertBanner({ alert, onAction }) {
  const map = {
    warning: { cls:'alert-warning', Icon:AlertTriangle, color:'#d97706' },
    danger:  { cls:'alert-danger',  Icon:AlertCircle,   color:'#dc2626' },
    info:    { cls:'alert-info',    Icon:Info,           color:'#6366f1' },
  };
  const { cls, Icon, color } = map[alert.type] || map.info;
  return (
    <div className={`alert-banner ${cls}`}>
      <Icon size={15} style={{ color, flexShrink:0 }} />
      <span className="flex-1">{alert.text}</span>
      <button
        className="btn btn-ghost btn-sm text-xs font-semibold"
        style={{ color }}
        onClick={() => onAction(alertRoute(alert))}
      >
        {alert.action} ←
      </button>
    </div>
  );
}

function GuestName({ res }) {
  const g = res.primaryGuest;
  return g ? `${g.firstName} ${g.lastName}` : '—';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const skip = !propertyId;

  const { data: stats,      loading: l1, error: e1, refetch: r1 } = useApi(() => dashboard.stats(propertyId),      [propertyId], skip);
  const { data: alerts,     loading: l2 }                          = useApi(() => dashboard.alerts(propertyId),     [propertyId], skip);
  const { data: arrivals,   loading: l3 }                          = useApi(() => dashboard.arrivals(propertyId),   [propertyId], skip);
  const { data: departures, loading: l4 }                          = useApi(() => dashboard.departures(propertyId), [propertyId], skip);
  const { data: inhouse,    loading: l5 }                          = useApi(() => dashboard.inhouse(propertyId),    [propertyId], skip);

  if (skip || l1 || l2 || l3 || l4 || l5) return <PageSpinner />;
  if (e1) return <ErrorState message={e1} onRetry={r1} />;

  const s = stats || {};

  return (
    <div className="animate-fade-in">
      {/* Alerts */}
      {alerts?.length > 0 && (
        <div className="flex flex-col gap-2 mb-5">
          {alerts.map(a => <AlertBanner key={a.id} alert={a} onAction={navigate} />)}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard icon={LogIn}    label="הגעות היום"   value={s.arrivals}   color="#7c3aed" bgColor="rgba(139,92,246,0.1)" sub={`${s.vipArrivals||0} VIP`}            onClick={() => navigate('/check-in')} />
        <StatCard icon={LogOut}   label="יציאות היום"  value={s.departures} color="#ea580c" bgColor="rgba(249,115,22,0.1)" sub={`${s.openBalances||0} יתרה פתוחה`}    onClick={() => navigate('/check-out')} urgent={s.openBalances > 0} />
        <StatCard icon={Users}    label="אורחים בבית"  value={s.inHouse}    color="#2563eb" bgColor="rgba(59,130,246,0.1)" sub={`תפוסה ${s.occupancy||0}%`}           onClick={() => navigate('/reservations')} />
        <StatCard icon={BedDouble} label="חדרים נקיים" value={s.cleanRooms} color="#059669" bgColor="rgba(16,185,129,0.1)" sub={`${s.dirtyRooms||0} מלוכלכים`}       onClick={() => navigate('/rooms')} />
        <StatCard icon={Wrench}   label="Out of Order" value={s.oooRooms}   color="#dc2626" bgColor="rgba(239,68,68,0.1)"  sub={`${s.holdRooms||0} Hold`} urgent={s.oooRooms > 0} onClick={() => navigate('/maintenance')} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Arrivals */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <LogIn size={15} className="text-status-arrival" />
              <span className="font-semibold text-ink text-sm">הגעות היום</span>
              <span className="badge badge-arrival">{arrivals?.length || 0}</span>
            </div>
          </div>
          {!arrivals?.length
            ? <div className="empty-state"><LogIn size={28} className="empty-state-icon"/><span>אין הגעות</span></div>
            : arrivals.map(res => (
              <div
                key={res._id}
                className="flex items-center gap-3 px-4 py-3 border-b border-surface-hover hover:bg-surface-hover cursor-pointer last:border-0 transition-colors"
                onClick={() => navigate('/check-in')}
              >
                <div className="avatar text-xs font-bold flex-shrink-0"
                  style={{ background: res.isVip ? 'rgba(139,92,246,0.12)':'rgba(99,102,241,0.1)', color: res.isVip ? '#7c3aed':'#6366f1' }}>
                  {res.primaryGuest?.firstName?.slice(0,1)}{res.primaryGuest?.lastName?.slice(0,1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-ink truncate"><GuestName res={res} /></span>
                    {res.isVip && <Crown size={11} className="text-yellow-500 flex-shrink-0" />}
                  </div>
                  <div className="text-xs text-ink-muted">{res.roomType?.name} · {res.nights} לילות</div>
                </div>
                <div className="flex-shrink-0 text-left">
                  {res.assignedRoom
                    ? <span className="text-xs font-bold text-num bg-surface-hover px-2 py-0.5 rounded">חדר {res.assignedRoom.number}</span>
                    : <span className="badge badge-dirty">ללא חדר!</span>}
                </div>
                <span className={`badge ${res.paymentStatus === 'paid' ? 'badge-clean' : res.paymentStatus === 'balance_due' ? 'badge-dirty' : 'badge-pending'}`}>
                  {res.paymentStatus === 'paid' ? 'שולם' : res.paymentStatus === 'balance_due' ? 'יתרה' : 'Pending'}
                </span>
              </div>
            ))
          }
          {arrivals?.length > 0 && (
            <div className="px-4 py-2.5 border-t border-surface-hover">
              <button
                className="btn btn-primary btn-sm w-full justify-center gap-2"
                onClick={() => navigate('/check-in')}
              >
                <LogIn size={13}/>צ׳ק-אין
              </button>
            </div>
          )}
        </div>

        {/* Departures */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <LogOut size={15} className="text-status-departure" />
              <span className="font-semibold text-ink text-sm">יציאות היום</span>
              <span className="badge badge-departure">{departures?.length || 0}</span>
            </div>
          </div>
          {!departures?.length
            ? <div className="empty-state"><LogOut size={28} className="empty-state-icon"/><span>אין יציאות</span></div>
            : departures.map(res => (
              <div
                key={res._id}
                className={`flex items-center gap-3 px-4 py-3 border-b border-surface-hover cursor-pointer last:border-0 transition-colors ${res.paymentStatus === 'balance_due' ? 'bg-red-50/40 hover:bg-red-50/60' : 'hover:bg-surface-hover'}`}
                onClick={() => navigate('/check-out')}
              >
                <div className="avatar text-xs font-bold flex-shrink-0"
                  style={{ background:'rgba(249,115,22,0.1)', color:'#ea580c' }}>
                  {res.primaryGuest?.firstName?.slice(0,1)}{res.primaryGuest?.lastName?.slice(0,1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-ink truncate"><GuestName res={res} /></span>
                    {res.paymentStatus === 'balance_due' && <AlertCircle size={11} className="text-red-500 flex-shrink-0" />}
                  </div>
                  <div className="text-xs text-ink-muted">{res.roomType?.name} · חדר {res.assignedRoom?.number}</div>
                </div>
                <span className={`badge ${res.paymentStatus === 'paid' ? 'badge-clean' : 'badge-dirty'}`}>
                  {res.paymentStatus === 'paid' ? 'שולם' : 'יתרה'}
                </span>
              </div>
            ))
          }
          {departures?.length > 0 && (
            <div className="px-4 py-2.5 border-t border-surface-hover">
              <button
                className="btn btn-secondary btn-sm w-full justify-center gap-2"
                onClick={() => navigate('/check-out')}
              >
                <LogOut size={13}/>צ׳ק-אאוט
              </button>
            </div>
          )}
        </div>

        {/* HK + Maintenance mini */}
        <div className="flex flex-col gap-4">
          <div className="card cursor-pointer hover:shadow-card-hover transition-shadow" onClick={() => navigate('/housekeeping')}>
            <div className="card-header">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-brand" />
                <span className="font-semibold text-ink text-sm">חדרנות</span>
              </div>
            </div>
            <div className="card-body grid grid-cols-2 gap-2">
              {[
                { label:'פתוח',   value: s.hkPending,    color:'#ea580c', bg:'rgba(249,115,22,0.1)' },
                { label:'בביצוע', value: s.hkInProgress, color:'#2563eb', bg:'rgba(59,130,246,0.1)' },
                { label:'הושלם',  value: s.hkCompleted,  color:'#059669', bg:'rgba(16,185,129,0.1)' },
                { label:'דחוף',   value: s.hkUrgent,     color:'#dc2626', bg:'rgba(239,68,68,0.1)', urgent: s.hkUrgent > 0 },
              ].map(({ label, value, color, bg, urgent }) => (
                <div key={label} className={`flex items-center gap-3 p-3 rounded-lg ${urgent ? 'ring-1 ring-red-300' : ''}`} style={{ background: bg }}>
                  <div className="text-2xl font-bold text-num" style={{ color }}>{value ?? 0}</div>
                  <div className="text-xs font-medium text-ink-secondary">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card cursor-pointer hover:shadow-card-hover transition-shadow" onClick={() => navigate('/maintenance')}>
            <div className="card-header">
              <div className="flex items-center gap-2">
                <Wrench size={15} className="text-status-ooo" />
                <span className="font-semibold text-ink text-sm">תחזוקה</span>
              </div>
            </div>
            <div className="card-body flex items-center gap-4">
              <div className="text-4xl font-bold text-num text-red-500">{s.maintenanceOpen ?? 0}</div>
              <div className="text-sm text-ink-muted">תקלות פתוחות</div>
            </div>
          </div>
        </div>
      </div>

      {/* In-house */}
      {inhouse?.length > 0 && (
        <div className="card mt-4">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <Users size={15} className="text-status-occupied" />
              <span className="font-semibold text-ink text-sm">אורחים בבית</span>
              <span className="badge badge-inhouse">{inhouse.length}</span>
            </div>
            <button className="btn btn-ghost btn-sm text-xs" onClick={() => navigate('/reservations')}>
              כל ההזמנות ←
            </button>
          </div>
          <table className="data-table">
            <thead><tr><th>אורח</th><th>חדר</th><th>סוג</th><th>יציאה</th><th>תשלום</th></tr></thead>
            <tbody>
              {inhouse.slice(0, 8).map(res => (
                <tr
                  key={res._id}
                  className="cursor-pointer hover:bg-surface-hover transition-colors"
                  onClick={() => navigate('/folio')}
                >
                  <td>
                    <div className="flex items-center gap-1.5">
                      {res.isVip && <Crown size={11} className="text-yellow-500" />}
                      <span className="font-medium"><GuestName res={res} /></span>
                    </div>
                  </td>
                  <td className="text-num font-bold">{res.assignedRoom?.number || '—'}</td>
                  <td className="text-xs text-ink-muted">{res.roomType?.name}</td>
                  <td className="text-num text-xs">{res.departureDate}</td>
                  <td>
                    <span className={`badge ${res.paymentStatus === 'paid' ? 'badge-clean' : res.paymentStatus === 'balance_due' ? 'badge-dirty' : 'badge-pending'}`}>
                      {res.paymentStatus === 'paid' ? 'שולם' : res.paymentStatus === 'balance_due' ? 'יתרה' : res.paymentStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
