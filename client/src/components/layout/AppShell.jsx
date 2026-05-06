import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const PAGE_TITLES = {
  '/':              'לוח בקרה — Front Desk',
  '/tape-chart':    'Tape Chart',
  '/room-rack':     'Room Rack',
  '/reservations':  'הזמנות',
  '/check-in':      'צ׳ק-אין',
  '/check-out':     'צ׳ק-אאוט',
  '/housekeeping':  'חדרנות',
  '/maintenance':   'תחזוקה',
  '/guests':        'אורחים',
  '/companies':     'חברות וסוכנים',
  '/crm/leads':     'Lead Inbox',
  '/crm/opportunities': 'Opportunity Board',
  '/folio':         'Folio ותשלומים',
  '/reports':       'דוחות',
  '/bulk-jobs':     'עבודות Bulk',
  '/automation':    'כללי אוטומציה',
  '/settings':      'הגדרות',
};

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const title = PAGE_TITLES[pathname] || '';

  return (
    <div className="app-shell">
      <Sidebar collapsed={collapsed} />
      <div className={`main-content ${collapsed ? 'main-content-collapsed' : ''}`}>
        <TopBar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} title={title} />
        <main className="page-content animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
