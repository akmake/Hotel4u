import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Users, MessageSquare, Phone,
  Wrench, BarChart3, Settings, Hotel, ClipboardList, CalendarDays,
  BedDouble, UserCheck, Megaphone, GitBranch, Bot, FileText,
  BadgeDollarSign, Search, TrendingUp, Building2, Star, PackagePlus,
  LogOut, Calendar, Sparkles, Tag, BookOpen, Funnel, CreditCard,
  LogIn, Hourglass, BedSingle, Moon, ReceiptText, ListChecks, Printer, Zap, Radio,
  ChevronDown, SquarePen, CalendarRange, Coins, Keyboard, HelpCircle, UserRoundCog,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { roleLabel } from '../../lib/labels';
import GlobalSearch from '../sys/GlobalSearch';
import { useProperty } from '../../context/PropertyContext';
import { useNavStyle } from '../../stores/navStyleStore';
import NavVariant from './NavVariants';
import { designToolsOn } from '../../utils/designTools';
import { useHomeStore } from '../../stores/homeStore';
import { shortcutFor } from '../../lib/shortcuts';

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
      { path: '/pms',              icon: LayoutDashboard, label: 'היום בקבלה' },
      { path: '/pms/work',        icon: ListChecks,      label: 'מרכז משימות' },
      { path: '/pms/availability', icon: CalendarDays,    label: 'זמינות' },
      { path: '/pms/tape-chart-classic', icon: CalendarDays, label: 'לוח חדרים הקודם' },
      { path: '/pms/reservations', icon: ClipboardList,   label: 'הזמנות' },
      { path: '/pms/waitlist',     icon: Hourglass,       label: 'המתנה, מקדמות ואישורים' },
      { path: '/pms/groups',       icon: Users,           label: 'קבוצות ובלוקים' },
      { path: '/pms/quotes',       icon: FileText,        label: 'הצעות מחיר' },
      { path: '/pms/arrivals',     icon: LogIn,           label: 'הגעות' },
      { path: '/pms/arrival-queue',icon: Hourglass,       label: 'תור המתנה' },
      { path: '/pms/in-house',     icon: BedSingle,       label: 'שוהים' },
      { path: '/pms/departures',   icon: LogOut,          label: 'עזיבות' },
      { path: '/pms/guests',       icon: Users,           label: 'אורחים' },
      { path: '/pms/desk',         icon: MessageSquare,   label: 'תקשורת קבלה' },
      { path: '/pms/folio',        icon: CreditCard,      label: 'חשבונות אורח' },
      { path: '/pms/house-accounts', icon: ReceiptText,   label: 'חשבונות מזדמנים' },
      { path: '/pms/cashier',      icon: BadgeDollarSign, label: 'קופה ומט״ח' },
      { path: '/pms/invoices',     icon: ReceiptText,     label: 'חשבוניות' },
    ],
  },
  {
    group: 'תפעול',
    items: [
      { path: '/pms/housekeeping', icon: Sparkles,     label: 'חדרנות' },
      { path: '/pms/maintenance',  icon: Wrench,        label: 'תחזוקה' },
      { path: '/pms/meals',        icon: ListChecks,    label: 'מטבח — סועדים' },
      { path: '/pms/ops-reports',  icon: Printer,       label: 'דוחות תפעול' },
      { path: '/pms/rooms',        icon: BedDouble,     label: 'חדרים' },
      { path: '/pms/events',       icon: Calendar,      label: 'אירועים ואולמות' },
    ],
  },
  {
    group: 'ניהול',
    items: [
      { path: '/pms/rates',            icon: Tag,        label: 'מחירים' },
      { path: '/pms/demand',           icon: TrendingUp, label: 'מערכת ביקוש' },
      { path: '/pms/revenue',          icon: CalendarRange, label: 'ניהול הכנסות' },
      { path: '/pms/packages',         icon: PackagePlus, label: 'חבילות' },
      { path: '/pms/promotions',       icon: Megaphone,  label: 'מבצעים וקודי הנחה' },
      { path: '/pms/reports',          icon: BarChart3,  label: 'דוחות' },
      { path: '/pms/night-audit',      icon: Moon,       label: 'סגירת יום' },
      { path: '/pms/night-audit/report', icon: BarChart3, label: 'מאזן בוחן וספרים' },
      { path: '/pms/fin/receivables',  icon: Building2,  label: 'חייבים' },
      { path: '/pms/fin/commissions',  icon: BadgeDollarSign, label: 'עמלות סוכנים' },
      { path: '/pms/fin/cards',        icon: BadgeDollarSign, label: 'כרטיסי אשראי' },
      { path: '/pms/fin/reports',      icon: ReceiptText, label: 'דוחות כספיים ומע״מ' },
      { path: '/pms/fin/accounting',   icon: ReceiptText, label: 'הנהלת חשבונות' },
      { path: '/pms/bulk-jobs',        icon: ListChecks, label: 'פעולות מרוכזות' },
      { path: '/pms/automation',       icon: Zap,        label: 'אוטומציה' },
      { path: '/pms/channel-manager',  icon: Radio,      label: 'ערוצי הפצה' },
      { path: '/pms/companies',        icon: Building2,  label: 'חברות וסוכנים' },
      { path: '/pms/admin/setup',      icon: Building2,  label: 'הקמת מלון: חדרים וסוגים' },
      { path: '/pms/admin/users',      icon: Users,      label: 'משתמשים והרשאות' },
      { path: '/pms/admin/permissions', icon: Users,     label: 'קבוצות הרשאות' },
      { path: '/pms/admin/payments',   icon: BadgeDollarSign, label: 'הגדרות סליקה' },
      { path: '/pms/admin/codes',      icon: ListChecks, label: 'רשימות קוד' },
      { path: '/pms/admin/policy',     icon: FileText,   label: 'מדיניות' },
      { path: '/pms/admin/audit',      icon: ClipboardList, label: 'יומן ביקורת' },
      { path: '/pms/admin/charge-codes', icon: ListChecks, label: 'קודי חיוב ותשלום' },
      { path: '/pms/admin/board',      icon: Tag,        label: 'שיטת תמחור ופנסיון' },
      { path: '/pms/admin/tax',        icon: FileText,   label: 'מס ומזומן — מחו״ל' },
      { path: '/pms/admin/fiscal',     icon: ReceiptText, label: 'מסמכים ורשות המסים' },
      { path: '/pms/settings',         icon: Settings,   label: 'הגדרות' },
    ],
  },
  {
    group: 'עיצוב',
    items: [
      { path: '/pms/design',       icon: SquarePen, label: 'עמוד העיצוב' },
      { path: '/pms/design/availability', icon: SquarePen, label: 'עיצוב זמינות' },
      { path: '/pms/design/room-calendar', icon: SquarePen, label: 'עיצוב לוח חדרים' },
    ],
  },
];

// Quick looks (gap-map item 8): open in place from any screen — '#action' is not a route.
const QUICK_GROUP = {
  group: 'מבטים',
  items: [
    { path: '#week',      icon: CalendarRange, label: 'מבט שבועי' },
    { path: '#house',     icon: Building2,     label: 'מצב הבית וזמינות מקסימלית' },
    { path: '#free',      icon: BedDouble,     label: 'חיפוש חדר פנוי' },
    { path: '#rates',     icon: Coins,         label: 'שערי מטבע' },
    { path: '#switch',    icon: UserRoundCog,  label: 'החלפת משתמש זמנית' },
    { path: '#shortcuts', icon: Keyboard,      label: 'קיצורי מקלדת' },
    { path: '#help',      icon: HelpCircle,    label: 'עזרה למסך הזה' },
  ],
};

// Roles restricted to specific PMS sections only
const PMS_ROLE_PATHS = {
  maintenance: ['/pms/maintenance', '/pms/work'],
  technician:  ['/pms/maintenance', '/pms/housekeeping', '/pms/work'],
  housekeeper: ['/pms/housekeeping', '/pms/work'],
};

function isActivePath(pathname, path) {
  if (path === '/' || path === '/pms') return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function Sidebar({ open, onClose }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuthStore();
  const { property, propertyId } = useProperty() || {};

  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef(null);

  const isAdmin = user?.role === 'admin';
  const isPMS = pathname.startsWith('/pms');
  const navGroups = isPMS ? (PMS_ROLE_PATHS[user?.role] ? PMS_NAV : [...PMS_NAV.slice(0, 1), QUICK_GROUP, ...PMS_NAV.slice(1)]) : SALES_NAV;
  const openLook = useHomeStore((s) => s.open);
  const pmsAllowedPaths = isPMS ? PMS_ROLE_PATHS[user?.role] : undefined;
  const workspace = isPMS ? (property?.name || 'Hotel4U') : 'Hotel4U מכירות';
  const wsInitial = workspace.replace(/^מלון\s+/, '').trim().charAt(0);
  // Live counters on the menu entries + the shortcut in each tooltip (gap-map item 8).
  const counters = useHomeStore((s) => s.counters);
  const decorate = (item) => ({ ...item, badge: isPMS ? counters?.nav?.[item.path] ?? null : null, keyHint: isPMS ? shortcutFor(item.path.startsWith('#') ? item.path.slice(1) : item.path) : null });
  const allowedGroups0 = navGroups.filter(section => (section.group !== 'עיצוב' || designToolsOn()) && (!section.adminOnly || isAdmin) && (!pmsAllowedPaths || section.items.some(item => pmsAllowedPaths.includes(item.path))));
  const allowedGroups = allowedGroups0.map((section) => ({ ...section, items: section.items.map(decorate) }));
  const visibleItems = allowedGroups.flatMap(section => section.items.map(item => ({ ...item, group: section.group }))).filter(item => !pmsAllowedPaths || pmsAllowedPaths.includes(item.path));

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
    const onOpen = () => setSearchOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('hotel4u:search', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('hotel4u:search', onOpen); };
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

  const go = (path) => { setMenuOpen(false); onClose?.(); if (path.startsWith('#')) { if (path === '#search') setSearchOpen(true); else openLook(path.slice(1)); return; } nav(path); };
  const navStyle = useNavStyle((s) => s.style);

  if (navStyle !== 'current') {
    const itemActive = (path) => isActivePath(pathname, path) && !visibleItems.some(item => item.path !== path && item.path.startsWith(`${path}/`) && isActivePath(pathname, item.path));
    const variantGroups = allowedGroups
      .map(section => ({ group: section.group, items: section.items.filter(item => !pmsAllowedPaths || pmsAllowedPaths.includes(item.path)).map(item => ({ ...item, active: itemActive(item.path) })) }))
      .filter(section => section.items.length);
    const account = {
      name: user?.name || workspace, role: roleLabel(user?.role), initial: wsInitial,
      onProfile: isPMS ? () => go('/pms/me') : null,
      onLogout: logout,
    };
    return (
      <>
        <NavVariant variant={navStyle} groups={variantGroups} go={go} onSearch={isPMS ? () => setSearchOpen(true) : null} account={account} />
        {isPMS && <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} propertyId={propertyId} />}
      </>
    );
  }

  return (
    <aside className={`sidebar hotjar-sidebar ${expanded ? 'is-expanded' : 'is-collapsed'} ${open ? 'is-open' : ''}`} aria-label="ניווט ראשי">
      <div className="hotjar-nav-panel" dir="rtl">
        <button type="button" className="hotjar-sidebar-toggle" onClick={() => { setExpanded(v => !v); setMenuOpen(false); }} aria-label={expanded ? 'צמצום סרגל הצד' : 'פתיחת סרגל הצד'} aria-expanded={expanded} title={expanded ? 'צמצום סרגל הצד' : 'פתיחת סרגל הצד'}><ChevronDown size={18} /><span className="hotjar-nav-heading"><strong>{isPMS ? 'ניהול המלון' : 'מכירות ותפעול'}</strong><small>Hotel4U · מרחב העבודה</small></span></button>
        {isPMS && <button type="button" className="hotjar-sidebar-search" onClick={() => setSearchOpen(true)} aria-label="חיפוש" title="חיפוש"><Search size={18} /><span>חיפוש במערכת</span><kbd>/</kbd></button>}
        <nav className="hotjar-context-nav" aria-label="תפריט ראשי">
          {visibleItems.map(({path, label, icon: Icon, group, badge, keyHint}, index) => {
            const active = isActivePath(pathname, path) && !visibleItems.some(item => item.path !== path && item.path.startsWith(`${path}/`) && isActivePath(pathname, item.path));
            return <div key={path} className="hotjar-nav-entry">{(index === 0 || visibleItems[index - 1].group !== group) && <div className="hotjar-section-caption">{group}</div>}<button type="button" className={`hotjar-context-item ${active ? 'active' : ''}`} onClick={() => go(path)} aria-label={`${label}${badge != null ? ` (${badge})` : ''}`} title={`${label}${keyHint ? ` · ${keyHint}` : ''}`} aria-current={active ? 'page' : undefined}><span className="hotjar-item-icon"><Icon size={18} /></span><span>{label}</span>{badge != null && <span className="nv-badge">{badge}</span>}</button></div>;
          })}
        </nav>
        <div className="hotjar-workspace" ref={menuRef}>
          <button type="button" onClick={() => setMenuOpen(v => !v)} aria-label={workspace} title={workspace} aria-haspopup="menu" aria-expanded={menuOpen}><span className="ws-avatar">{wsInitial}</span><span className="hotjar-account-text"><strong>{user?.name || workspace}</strong><small>{roleLabel(user?.role)}</small></span><ChevronDown size={14}/></button>
          {menuOpen && <div role="menu" className="menu">
            <div className="px-2 py-1.5">{user?.name}<div className="text-ink-muted text-xs">{roleLabel(user?.role)}</div></div>
            {isPMS && <button type="button" role="menuitem" className="menu-item" onClick={() => go('/pms/me')}>הפרופיל שלי</button>}
            <button type="button" role="menuitem" className="menu-item" onClick={logout}><LogOut size={14}/>יציאה מהמערכת</button>
          </div>}
        </div>
      </div>
      {isPMS && <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} propertyId={propertyId} />}
    </aside>
  );
}
