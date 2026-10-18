// Section navigation for property administration (ADM-05 policy, ADM-06 users, ADM-07 audit,
// ADM-13 charge codes).
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

const ADMIN = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
const TABS = [
  { to: '/pms/admin/setup', label: 'הקמת מלון', roles: [...ADMIN, 'front_desk_manager', 'revenue_manager', 'auditor'] },
  { to: '/pms/admin/users', label: 'משתמשים והרשאות', roles: [...ADMIN, 'auditor'] },
  { to: '/pms/admin/policy', label: 'מדיניות', roles: [...ADMIN, 'front_desk_manager', 'finance_manager', 'auditor', 'housekeeping_manager'] },
  { to: '/pms/admin/audit', label: 'יומן ביקורת', roles: [...ADMIN, 'auditor', 'finance_manager'] },
  { to: '/pms/admin/charge-codes', label: 'קודי חיוב ותשלום', roles: [...ADMIN, 'finance_manager', 'front_desk_manager', 'auditor'] },
  { to: '/pms/admin/board', label: 'שיטת תמחור ופנסיון', roles: [...ADMIN, 'revenue_manager', 'finance_manager', 'front_desk_manager'] },
  { to: '/pms/admin/tax', label: 'מס ומזומן — אורחים מחו״ל', roles: [...ADMIN, 'finance_manager', 'auditor'] },
  { to: '/pms/admin/fiscal', label: 'מסמכים ורשות המסים', roles: [...ADMIN, 'finance_manager', 'auditor'] },
  { to: '/pms/fin/accounting', label: 'הנהלת חשבונות', roles: [...ADMIN, 'finance_manager', 'auditor'] },
  { to: '/pms/settings', label: 'הגדרות נוספות (CRM, Webhooks)', roles: ADMIN },
];

export default function AdminNav({ end }) {
  const role = useAuthStore((s) => s.user?.role);
  return (
    <div className="ui-toolbar">
      <nav className="ui-seg" aria-label="ניהול">
        {TABS.filter((t) => t.roles.includes(role)).map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'is-on' : '')}>{t.label}</NavLink>
        ))}
      </nav>
      {end && <div className="ui-toolbar-end">{end}</div>}
    </div>
  );
}
