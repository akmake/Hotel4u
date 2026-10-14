import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Users, MessageSquare, Phone,
  Wrench, BarChart3, Settings, Hotel, ClipboardList, CalendarDays,
  BedDouble, UserCheck, Megaphone, GitBranch, Bot, FileText,
  BadgeDollarSign, Search, TrendingUp, Building2, Star, PackagePlus,
  LogOut, Calendar, Sparkles, Tag, BookOpen, Funnel, CreditCard,
  LogIn, Hourglass, BedSingle, Moon, ReceiptText, ListChecks, Zap, Radio,
  ChevronDown, SquarePen, ArrowLeftRight,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { roleLabel } from '../../lib/labels';
import GlobalSearch from '../sys/GlobalSearch';
import { useProperty } from '../../context/PropertyContext';

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
      { path: '/pms',              icon: LayoutDashboard, label: 'היום' },
      { path: '/pms/work',         icon: ListChecks,      label: 'מרכז משימות' },
      { path: '/pms/tape-chart',   icon: CalendarDays,    label: 'לוח חדרים' },
      { path: '/pms/room-rack',    icon: Calendar,        label: 'Room Rack' },
      { path: '/pms/reservations', icon: ClipboardList,   label: 'הזמנות' },
      { path: '/pms/arrivals',     icon: LogIn,           label: 'הגעות' },
      { path: '/pms/arrival-queue',icon: Hourglass,       label: 'תור המתנה' },
      { path: '/pms/in-house',     icon: BedSingle,       label: 'שוהים' },
      { path: '/pms/departures',   icon: LogOut,          label: 'עזיבות' },
      { path: '/pms/guests',       icon: Users,           label: 'אורחים' },
      { path: '/pms/folio',        icon: CreditCard,      label: 'חשבונות אורח' },
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
    group: 'ניהול',
    items: [
      { path: '/pms/rates',            icon: Tag,        label: 'מחירים' },
      { path: '/pms/reports',          icon: BarChart3,  label: 'דוחות' },
      { path: '/pms/night-audit',      icon: Moon,       label: 'סגירת יום' },
      { path: '/pms/bulk-jobs',        icon: ListChecks, label: 'פעולות מרוכזות' },
      { path: '/pms/automation',       icon: Zap,        label: 'אוטומציה' },
      { path: '/pms/channel-manager',  icon: Radio,      label: 'ערוצי הפצה' },
      { path: '/pms/companies',        icon: Building2,  label: 'חברות וסוכנים' },
      { path: '/pms/admin/users',      icon: Users,      label: 'משתמשים והרשאות' },
      { path: '/pms/admin/policy',     icon: FileText,   label: 'מדיניות' },
      { path: '/pms/admin/audit',      icon: ClipboardList, label: 'יומן ביקורת' },
      { path: '/pms/settings',         icon: Settings,   label: 'הגדרות' },
    ],
  },
];

// Roles restricted to specific PMS sections only
const PMS_ROLE_PATHS = {
  maintenance: ['/pms/maintenance', '/pms/work'],
  technician:  ['/pms/maintenance', '/pms/housekeeping', '/pms/work'],
  housekeeper: ['/pms/housekeeping', '/pms/work'],
};

const COLLAPSE_KEY = 'hotel4u_nav_collapsed';

function isActivePath(pathname, path) {
  if (path === '/' || path === '/pms') return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function readCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); }
  catch { return new Set(); }
}

export default function Sidebar({ open, onClose }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuthStore();
  const { property, propertyId } = useProperty() || {};

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(readCollapsed);
  const menuRef = useRef(null);

  const isAdmin = user?.role === 'admin';
  const isPMS = pathname.startsWith('/pms');
  const navGroups = isPMS ? PMS_NAV : SALES_NAV;
  const pmsAllowedPaths = isPMS ? PMS_ROLE_PATHS[user?.role] : undefined;
  const workspace = isPMS ? (property?.name || 'Hotel4U') : 'Hotel4U מכירות';
  const wsInitial = workspace.replace(/^מלון\s+/, '').trim().charAt(0);

  // "/" opens search (PMS), like Linear.
  useEffect(() => {
    if (!isPMS) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !e.target?.isContentEditable) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPMS]);


  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const toggleGroup = (group) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* storage unavailable */ }
      return next;
    });
  };


  const go = (path) => { setMenuOpen(false); nav(path); onClose?.(); };

  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="ניווט ראשי">
      {/* Workspace row: name (account menu) · search · compose */}
      <div className="ws-row relative" ref={menuRef}>
        <button
          type="button"
          className="ws-button"
          onClick={() => setMenuOpen(v => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="ws-avatar" aria-hidden="true">{wsInitial}</span>
          <span className="truncate">{workspace}</span>
          <ChevronDown size={13} className="text-ink-muted shrink-0" />
        </button>
        {isPMS && (
          <button
            type="button"
            className="side-icon-btn"
            onClick={() => setSearchOpen(v => !v)}
            aria-label="חיפוש"
            aria-expanded={searchOpen}
            title="חיפוש ( / )"
          >
            <Search size={15} />
          </button>
        )}
        <button
          type="button"
          className="side-icon-btn is-raised"
          onClick={() => go(isPMS ? '/pms/reservations/new' : '/new-order')}
          aria-label="הזמנה חדשה"
          title="הזמנה חדשה"
        >
          <SquarePen size={14} />
        </button>

        {menuOpen && (
          <div role="menu" className="menu top-[34px] right-[10px]">
            <div className="px-2 py-1.5">
              <div className="text-[13px] font-medium text-ink truncate">{user?.name || 'משתמש'}</div>
              <div className="text-[12px] text-ink-muted truncate">{roleLabel(user?.role)}</div>
            </div>
            <div className="menu-sep" />
            {isPMS && (
              <button type="button" role="menuitem" className="menu-item" onClick={() => go('/pms/me')}>
                <Users size={14} className="text-ink-muted" />
                הפרופיל שלי
              </button>
            )}
            <button type="button" role="menuitem" className="menu-item" onClick={() => go(isPMS ? '/' : '/pms')}>
              <ArrowLeftRight size={14} className="text-ink-muted" />
              {isPMS ? 'מעבר לאזור מכירות' : 'מעבר לאזור קבלה'}
            </button>
            <div className="menu-sep" />
            <button
              type="button"
              role="menuitem"
              className="menu-item !text-red-600"
              onClick={() => { setMenuOpen(false); logout(); }}
            >
              <LogOut size={14} />
              יציאה מהמערכת
            </button>
          </div>
        )}
      </div>

      {isPMS && <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} propertyId={propertyId} />}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto pb-3">
        {navGroups.map(({ group, adminOnly, items }, gi) => {
          if (adminOnly && !isAdmin) return null;
          const visibleItems = pmsAllowedPaths
            ? items.filter(item => pmsAllowedPaths.includes(item.path))
            : items;
          if (visibleItems.length === 0) return null;
          // First group is the unlabeled top block (Linear's Inbox / My issues).
          const labeled = gi > 0;
          const collapsed = labeled && collapsedGroups.has(group);
          const listId = `nav-group-${gi}`;
          return (
            <div key={group} className={labeled ? 'nav-group' : 'mt-2'}>
              {labeled && (
                <button
                  type="button"
                  className="nav-group-label"
                  onClick={() => toggleGroup(group)}
                  aria-expanded={!collapsed}
                  aria-controls={listId}
                >
                  {group}
                  <ChevronDown size={11} className="caret" />
                </button>
              )}
              {!collapsed && (
                <div id={listId}>
                  {visibleItems.map(({ path, icon: Icon, label }) => {
                    const active = isActivePath(pathname, path);
                    return (
                      <button
                        key={path}
                        type="button"
                        onClick={() => go(path)}
                        aria-current={active ? 'page' : undefined}
                        className={`nav-item ${active ? 'active' : ''}`}
                      >
                        <Icon size={16} strokeWidth={1.75} className="nav-icon shrink-0" />
                        <span className="flex-1 text-right truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
