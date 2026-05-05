import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Users, MessageSquare, Phone,
  Wrench, BarChart3, Settings, Hotel, ClipboardList, CalendarDays,
  BedDouble, UserCheck, Megaphone, GitBranch, Bot, FileText,
  BadgeDollarSign, Search, TrendingUp, Building2, Star, PackagePlus,
  LogOut, Calendar, Sparkles, Tag, BookOpen, Funnel, CreditCard,
  LogIn, Moon,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

// ── תפריט מכירות/תפעול ───────────────────────────────────────────────────────
const SALES_NAV = [
  {
    group: 'ראשי',
    items: [
      { path: '/',     icon: LayoutDashboard, label: 'דף הבית' },
      { path: '/chat', icon: MessageSquare,   label: "צ'אט" },
    ],
  },
  {
    group: 'מכירות',
    items: [
      { path: '/new-order',      icon: ShoppingCart,  label: 'הזמנה חדשה' },
      { path: '/orders-history', icon: ClipboardList, label: 'היסטוריית הזמנות' },
      { path: '/leads',          icon: Funnel,         label: 'לידים' },
      { path: '/whatsapp',       icon: Phone,          label: 'WhatsApp' },
      { path: '/sales-guide',    icon: BookOpen,       label: 'מדריך מכירות' },
    ],
  },
  {
    group: 'תפעול',
    items: [
      { path: '/bookings',          icon: BedDouble, label: 'שיבוץ חדרים' },
      { path: '/housekeeping-mgr',  icon: Sparkles,  label: 'חדרנות' },
      { path: '/manage-pricelists', icon: Tag,       label: 'מחירונים' },
    ],
  },
  {
    group: 'ניהול',
    adminOnly: true,
    items: [
      { path: '/admin',                  icon: LayoutDashboard, label: 'לוח ניהול' },
      { path: '/admin/daily-plan',       icon: CalendarDays,    label: 'תוכנית יומית' },
      { path: '/admin/calendar',         icon: Calendar,        label: 'לוח שנה' },
      { path: '/admin/orders',           icon: ClipboardList,   label: 'ניהול הזמנות' },
      { path: '/admin/users',            icon: Users,           label: 'משתמשים' },
      { path: '/admin/hotels',           icon: Hotel,           label: 'מלונות' },
      { path: '/admin/rooms-status',     icon: Building2,       label: 'סטטוס חדרים' },
      { path: '/admin/room-assignment',  icon: UserCheck,       label: 'שיבוץ חדרים' },
      { path: '/admin/announcements',    icon: Megaphone,       label: 'הודעות' },
      { path: '/admin/referrers',        icon: GitBranch,       label: 'מפנים' },
      { path: '/admin/extras',           icon: PackagePlus,     label: 'תוספות' },
      { path: '/admin/triggers',         icon: Settings,        label: 'טריגרים' },
      { path: '/admin/auto-replies',     icon: Bot,             label: 'תגובות אוטומטיות' },
      { path: '/admin/commissions',      icon: BadgeDollarSign, label: 'עמלות' },
      { path: '/admin/affiliates',       icon: Star,            label: 'שותפים' },
      { path: '/admin/performance',      icon: TrendingUp,      label: 'ביצועי מכירות' },
      { path: '/admin/customer-lookup',  icon: Search,          label: 'חיפוש לקוח' },
      { path: '/admin/maintenance',      icon: Wrench,          label: 'תחזוקה' },
      { path: '/admin/audit-logs',       icon: FileText,        label: 'לוג פעילויות' },
    ],
  },
];

// ── תפריט קבלה / PMS ─────────────────────────────────────────────────────────
const PMS_NAV = [
  {
    group: 'קבלה',
    items: [
      { path: '/pms',              icon: LayoutDashboard, label: 'לוח בקרה' },
      { path: '/pms/room-rack',    icon: Calendar,        label: 'Room Rack' },
      { path: '/pms/reservations', icon: ClipboardList,   label: 'הזמנות' },
      { path: '/pms/check-in',     icon: LogIn,           label: "צ'ק-אין" },
      { path: '/pms/check-out',    icon: LogOut,          label: "צ'ק-אאוט" },
      { path: '/pms/guests',       icon: Users,           label: 'אורחים' },
      { path: '/pms/folio',        icon: CreditCard,      label: 'Folio' },
    ],
  },
  {
    group: 'תפעול',
    items: [
      { path: '/pms/housekeeping', icon: Sparkles,     label: 'חדרנות' },
      { path: '/pms/maintenance',  icon: Wrench,        label: 'תחזוקה' },
      { path: '/pms/rooms',        icon: BedDouble,     label: 'חדרים' },
    ],
  },
  {
    group: 'דוחות וניהול',
    items: [
      { path: '/pms/rates',        icon: Tag,           label: 'מחירים' },
      { path: '/pms/reports',      icon: BarChart3,     label: 'דוחות' },
      { path: '/pms/night-audit',  icon: Moon,          label: 'Night Audit' },
      { path: '/pms/companies',    icon: Building2,     label: 'חברות' },
      { path: '/pms/settings',     icon: Settings,      label: 'הגדרות' },
    ],
  },
];

// Roles restricted to specific PMS sections only
const PMS_ROLE_PATHS = {
  maintenance: ['/pms/maintenance'],
  housekeeper: ['/pms/housekeeping'],
};

export default function Sidebar({ collapsed }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuthStore();

  const isAdmin = user?.role === 'admin';
  const isPMS = pathname.startsWith('/pms');
  const navGroups = isPMS ? PMS_NAV : SALES_NAV;
  const pmsAllowedPaths = isPMS ? PMS_ROLE_PATHS[user?.role] : undefined;

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
            <div className="text-sm font-bold text-white leading-tight truncate">
              {isPMS ? 'קבלה' : 'Hotel4U'}
            </div>
            <div className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {isPMS ? 'PMS' : 'v2.0'}
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto sidebar-scroll py-2">
        {navGroups.map(({ group, adminOnly, items }) => {
          if (adminOnly && !isAdmin) return null;
          const visibleItems = pmsAllowedPaths
            ? items.filter(item => pmsAllowedPaths.includes(item.path))
            : items;
          if (visibleItems.length === 0) return null;
          return (
            <div key={group}>
              {!collapsed && (
                <div className="nav-group-label">{group}</div>
              )}
              {visibleItems.map(({ path, icon: Icon, label }) => {
                const active = pathname === path || (path !== '/' && path !== '/pms' && pathname.startsWith(path))
                  || (path === '/pms' && pathname === '/pms');
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
                      <span className="flex-1 text-right">{label}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          <div className="avatar bg-brand/20 text-brand-light flex-shrink-0">
            {user?.name?.[0] || 'U'}
          </div>
          {!collapsed && (
            <div className="flex-1 overflow-hidden animate-fade-in">
              <div className="text-xs font-semibold text-white/80 truncate">{user?.name || 'משתמש'}</div>
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{user?.role || ''}</div>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={logout}
              className="text-white/40 hover:text-white/80 transition-colors"
              title="יציאה"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
