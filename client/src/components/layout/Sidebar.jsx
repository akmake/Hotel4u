import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, BedDouble, LogIn, LogOut,
  Sparkles, Wrench, Users, BarChart3, Settings,
  Hotel, BriefcaseBusiness, CreditCard, ClipboardList, Building2, Moon, Tag,
} from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useApi } from '../../hooks/useApi';
import { dashboard } from '../../utils/api';

function useBadges() {
  const { propertyId } = useProperty();
  const { data } = useApi(
    () => dashboard.stats(propertyId),
    [propertyId], !propertyId
  );
  if (!data) return {};
  return {
    '/check-in':    data.arrivals   > 0 ? String(data.arrivals)   : null,
    '/check-out':   data.departures > 0 ? String(data.departures) : null,
    '/housekeeping':data.hkPending  > 0 ? String(data.hkPending)  : null,
    '/maintenance': data.maintenanceOpen > 0 ? String(data.maintenanceOpen) : null,
    '/reservations':data.inHouse    > 0 ? String(data.inHouse)    : null,
  };
}

const NAV = [
  {
    group: 'תפעול',
    items: [
      { path: '/',              icon: LayoutDashboard,  label: 'לוח בקרה' },
      { path: '/room-rack',     icon: Calendar,         label: 'Room Rack' },
      { path: '/reservations',  icon: ClipboardList,    label: 'הזמנות' },
      { path: '/check-in',      icon: LogIn,            label: 'צ׳ק-אין' },
      { path: '/check-out',     icon: LogOut,           label: 'צ׳ק-אאוט' },
    ],
  },
  {
    group: 'ניהול חדרים',
    items: [
      { path: '/rooms',         icon: Building2,        label: 'סטטוס חדרים' },
      { path: '/housekeeping',  icon: Sparkles,         label: 'חדרנות' },
      { path: '/maintenance',   icon: Wrench,           label: 'תחזוקה' },
    ],
  },
  {
    group: 'קהל לקוחות',
    items: [
      { path: '/guests',        icon: Users,            label: 'אורחים' },
      { path: '/companies',     icon: BriefcaseBusiness,label: 'חברות וסוכנים' },
      { path: '/folio',         icon: CreditCard,       label: 'Folio & תשלומים' },
    ],
  },
  {
    group: 'ניהול',
    items: [
      { path: '/rates',         icon: Tag,              label: 'מחירים' },
      { path: '/reports',       icon: BarChart3,        label: 'דוחות' },
      { path: '/night-audit',   icon: Moon,             label: 'Night Audit' },
      { path: '/settings',      icon: Settings,         label: 'הגדרות' },
    ],
  },
];

export default function Sidebar({ collapsed }) {
  const { pathname } = useLocation();
  const nav    = useNavigate();
  const badges = useBadges();

  return (
    <aside className={`sidebar sidebar-scroll ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-4 py-4 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.06)', minHeight: 56 }}
      >
        <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center flex-shrink-0">
          <Hotel size={16} className="text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden animate-fade-in">
            <div className="text-sm font-bold text-white leading-tight truncate">מלון הגליל</div>
            <div className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Hotel OS v1</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto sidebar-scroll py-2">
        {NAV.map(({ group, items }) => (
          <div key={group}>
            {!collapsed && (
              <div className="nav-group-label">{group}</div>
            )}
            {items.map(({ path, icon: Icon, label }) => {
              const active = pathname === path;
              const badge  = badges[path];
              return (
                <button
                  key={path}
                  onClick={() => nav(path)}
                  className={`nav-item w-full ${active ? 'active' : ''} ${collapsed ? 'justify-center px-0 mx-0 rounded-none' : ''}`}
                  data-tooltip={collapsed ? label : undefined}
                  style={collapsed ? { margin: 0, borderRadius: 0, padding: '10px 0', width: '100%' } : {}}
                >
                  <Icon size={16} className="nav-icon flex-shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-right">{label}</span>
                      {badge && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-brand/20 text-brand-light">
                          {badge}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t p-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          <div className="avatar bg-brand/20 text-brand-light flex-shrink-0">יד</div>
          {!collapsed && (
            <div className="flex-1 overflow-hidden animate-fade-in">
              <div className="text-xs font-semibold text-white/80 truncate">מלון הגליל</div>
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Hotel OS v1</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
