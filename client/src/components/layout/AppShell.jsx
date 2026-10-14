import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, Hotel } from 'lucide-react';
import Sidebar from './Sidebar';
import { formatLong, todayYmd } from '../../utils/date';

const PAGE_TITLES = {
  '/pms':                 'היום בקבלה',
  '/pms/tape-chart':      'לוח חדרים',
  '/pms/room-rack':       'Room Rack',
  '/pms/reservations':    'הזמנות',
  '/pms/reservations/new':'הזמנה חדשה',
  '/pms/arrivals':        'הגעות',
  '/pms/arrival-queue':   'תור המתנה לחדר',
  '/pms/in-house':        'שוהים',
  '/pms/departures':      'עזיבות',
  '/pms/housekeeping':    'תכנון חדרנות',
  '/pms/housekeeping/my': 'המשימות שלי',
  '/pms/housekeeping/inspection': 'בדיקת חדרים',
  '/pms/housekeeping/rooms': 'מצב חדרים',
  '/pms/housekeeping/lost-found': 'אבידות ומציאות',
  '/pms/maintenance':     'תחזוקה',
  '/pms/rooms':           'חדרים',
  '/pms/guests':          'אורחים',
  '/pms/companies':       'חברות וסוכנים',
  '/pms/leads':           'לידים',
  '/pms/opportunities':   'הזדמנויות',
  '/pms/folio':           'חשבונות אורח',
  '/pms/invoices':        'חשבוניות',
  '/pms/reports':         'דוחות',
  '/pms/night-audit':     'סגירת יום',
  '/pms/bulk-jobs':       'פעולות מרוכזות',
  '/pms/rates':           'מחירים',
  '/pms/automation':      'אוטומציה',
  '/pms/channel-manager': 'ערוצי הפצה',
  '/pms/settings':        'הגדרות',
  '/pms/admin/users':     'משתמשים והרשאות',
  '/pms/admin/policy':    'מדיניות תפעול וביטול',
  '/pms/admin/audit':     'יומן ביקורת',
  '/pms/me':              'הפרופיל שלי',
  '/pms/work':            'מרכז משימות והעברת משמרת',
};

// Screens that lay out their own toolbar edge-to-edge inside the content panel (Linear list views).
const FLUSH_ROUTES = new Set(['/pms', '/pms/tape-chart']);

export default function AppShell() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/$/, '') || '/';
  const title = PAGE_TITLES[path] || '';
  const [navOpen, setNavOpen] = useState(false);

  // Close the off-canvas nav after navigating (small screens).
  useEffect(() => { setNavOpen(false); }, [pathname]);

  return (
    <div className="app-shell hotjar-shell">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <div className="main-content">
        <header className="content-header">
          <div className="hotjar-shell-brand"><Hotel size={22}/><strong>Hotel4U</strong></div>
          <button
            type="button"
            className="side-icon-btn lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="פתיחת תפריט"
          >
            <Menu size={16} />
          </button>
          {title && (
            <h1 className="content-title">
              <span className="truncate">{title}</span>
              {path === '/pms' && (
                <>
                  <span className="content-crumb-sep" aria-hidden="true">‹</span>
                  <span className="content-crumb truncate">{formatLong(todayYmd())}</span>
                </>
              )}
            </h1>
          )}
        </header>
        <main className={`page-content ${FLUSH_ROUTES.has(path) ? 'is-flush' : ''}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
