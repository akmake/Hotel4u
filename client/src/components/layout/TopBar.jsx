import { useState } from 'react';
import { Search, Bell, PanelRightOpen, PanelRightClose, RefreshCw, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { TODAY, formatLong } from '../../utils/date';

const ROLE_HE = {
  property_admin:       'מנהל נכס',
  receptionist:         'קבלן/ית',
  housekeeping_manager: 'מנהל חדרנות',
  housekeeper:          'חדרן/ית',
  technician:           'טכנאי',
  front_desk_manager:   'מנהל קבלה',
};

export default function TopBar({ collapsed, onToggle, title }) {
  const { user, logout } = useAuth();
  const [query,       setQuery]       = useState('');
  const [userMenuOpen, setUserMenu]   = useState(false);

  const initials = user ? `${user.firstName?.slice(0,1)}${user.lastName?.slice(0,1)}` : '?';

  return (
    <header className="topbar">
      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="btn btn-ghost btn-icon text-ink-muted hover:text-ink flex-shrink-0"
        title={collapsed ? 'הרחב תפריט' : 'צמצם תפריט'}
      >
        {collapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
      </button>

      {/* Title */}
      <div className="flex-1">
        {title && <span className="font-semibold text-ink text-sm">{title}</span>}
      </div>

      {/* Search */}
      <div className="relative hidden sm:flex">
        <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <input
          className="input pr-8 w-56 h-8 text-xs"
          placeholder="חיפוש אורח, הזמנה, חדר..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* Date */}
      <div className="hidden md:block text-xs text-ink-muted font-medium border-r border-surface-border pr-3 mr-1">
        {formatLong(TODAY)}
      </div>

      {/* Sync */}
      <button className="btn btn-ghost btn-icon text-ink-muted" title="רענן נתונים">
        <RefreshCw size={15} />
      </button>

      {/* Notifications */}
      <button className="btn btn-ghost btn-icon text-ink-muted relative" title="התראות">
        <Bell size={16} />
        <span className="absolute top-1 left-1 w-2 h-2 bg-status-dirty rounded-full border-2 border-white" />
      </button>

      {/* User menu */}
      <div className="relative">
        <button
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors"
          onClick={() => setUserMenu(v => !v)}
        >
          <div className="avatar text-xs font-bold flex-shrink-0"
            style={{ width:30, height:30, fontSize:11, background:'rgba(99,102,241,0.12)', color:'#6366f1' }}>
            {initials}
          </div>
          <div className="hidden md:block text-right">
            <div className="text-xs font-semibold text-ink leading-none">{user?.firstName} {user?.lastName}</div>
            <div className="text-xs text-ink-faint">{ROLE_HE[user?.role] || user?.role}</div>
          </div>
          <ChevronDown size={12} className="text-ink-faint hidden md:block" />
        </button>

        {userMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} />
            <div className="absolute left-0 top-full mt-1 w-44 bg-white border border-surface-border rounded-xl shadow-card-hover z-50 py-1 overflow-hidden">
              <div className="px-3 py-2 border-b border-surface-border">
                <div className="text-xs font-semibold text-ink">{user?.firstName} {user?.lastName}</div>
                <div className="text-xs text-ink-faint truncate">{user?.email}</div>
              </div>
              <button
                onClick={() => { setUserMenu(false); logout(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut size={13} />
                יציאה מהמערכת
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
