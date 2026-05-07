import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Users, MessageSquare, Phone,
  Wrench, BarChart3, Settings, Hotel, ClipboardList, CalendarDays,
  BedDouble, UserCheck, Megaphone, GitBranch, Bot, FileText,
  BadgeDollarSign, Search, TrendingUp, Building2, Star, PackagePlus,
  LogOut, Calendar, Sparkles, Tag, BookOpen, Funnel, CreditCard,
  LogIn, Moon, ReceiptText, ListChecks, Zap, Radio,
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
      { path: '/pms/tape-chart',   icon: CalendarDays,    label: 'Tape Chart' },
      { path: '/pms/room-rack',    icon: Calendar,        label: 'Room Rack' },
      { path: '/pms/reservations', icon: ClipboardList,   label: 'הזמנות' },
      { path: '/pms/check-in',     icon: LogIn,           label: "צ'ק-אין" },
      { path: '/pms/check-out',    icon: LogOut,          label: "צ'ק-אאוט" },
      { path: '/pms/guests',       icon: Users,           label: 'אורחים' },
      { path: '/pms/folio',        icon: CreditCard,      label: 'Folio' },
      { path: '/pms/invoices',     icon: ReceiptText,     label: 'חשבוניות' },
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
      { path: '/pms/bulk-jobs',    icon: ListChecks,    label: 'עבודות Bulk' },
      { path: '/pms/automation',       icon: Zap,           label: 'אוטומציה' },
      { path: '/pms/channel-manager',  icon: Radio,         label: 'Channel Manager' },
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
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: '1px solid #DDD0BC', minHeight: 62 }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: '#F0E4CC', border: '1px solid #C8A870' }}
        >
          <Hotel size={17} style={{ color: '#9A6B1A' }} />
        </div>
        {!collapsed && (
          <div className="overflow-hidden animate-fade-in">
            <div className="font-bold leading-tight truncate" style={{ color: '#2A1A0E', fontSize: '0.95rem' }}>
              {isPMS ? 'קבלה' : 'Hotel4U'}
            </div>
            <div style={{ color: '#9A7A50', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em' }}>
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
      <div className="p-3" style={{ borderTop: '1px solid #DDD0BC', background: '#F5EFE5' }}>
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          <div
            className="flex-shrink-0 flex items-center justify-center font-bold rounded-xl"
            style={{
              width: 36, height: 36,
              background: '#F0E4CC',
              border: '1px solid #C8A870',
              color: '#9A6B1A',
              fontSize: '0.875rem',
            }}
          >
            {user?.name?.[0] || 'U'}
          </div>
          {!collapsed && (
            <div className="flex-1 overflow-hidden animate-fade-in">
              <div className="font-semibold truncate" style={{ color: '#2A1A0E', fontSize: '0.85rem' }}>
                {user?.name || 'משתמש'}
              </div>
              <div style={{ color: '#7A5C42', fontSize: '0.72rem', fontWeight: 600 }}>
                {user?.role || ''}
              </div>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={logout}
              style={{ color: '#B8A080' }}
              className="transition-colors hover:!text-red-600"
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
