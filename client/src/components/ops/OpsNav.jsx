// Section navigation for housekeeping (OPS-01…OPS-05). Each tab is a real route so filters, back
// and refresh behave like every other list; tabs the user's role cannot use are not shown.
import { NavLink } from 'react-router-dom';

export const HK_MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'housekeeping_manager'];
export const MT_MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'maintenance_manager'];
export const FRONT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist'];
export const HK_STAFF = ['housekeeper', 'housekeeping_manager'];
export const MT_STAFF = ['technician', 'maintenance_manager'];
export const UNBLOCK_ROLES = [...MT_MANAGER_ROLES, 'front_desk_manager', 'housekeeping_manager'];

const TABS = [
  { to: '/pms/housekeeping', end: true, label: 'תכנון', roles: [...HK_MANAGER_ROLES, ...FRONT_ROLES, 'auditor', 'owner_readonly'] },
  { to: '/pms/housekeeping/my', label: 'המשימות שלי', roles: [...HK_MANAGER_ROLES, ...HK_STAFF] },
  { to: '/pms/housekeeping/inspection', label: 'בדיקת חדרים', roles: HK_MANAGER_ROLES },
  { to: '/pms/housekeeping/rooms', label: 'מצב חדרים', roles: null },
  { to: '/pms/housekeeping/lost-found', label: 'אבידות ומציאות', roles: [...HK_MANAGER_ROLES, ...HK_STAFF, ...FRONT_ROLES] },
];

export function opsTabsFor(role) {
  return TABS.filter((t) => !t.roles || t.roles.includes(role));
}

export default function OpsNav({ role, end }) {
  const tabs = opsTabsFor(role);
  return (
    <div className="ui-toolbar">
      <nav className="ui-seg" aria-label="חדרנות">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'is-on' : '')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      {end && <div className="ui-toolbar-end">{end}</div>}
    </div>
  );
}
