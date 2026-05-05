import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import {
  Menu, X, LogOut, Home, PlusCircle, FileText, ListOrdered,
  Mail, Calculator, MessageCircle, LayoutDashboard,
  Shield, Trophy, FileSpreadsheet, Search, ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "@/stores/authStore.js";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/Dropdown-menu";
import { LeadsBell } from './LeadsBell';

const GOLD = '#bfa15f';

const getSections = (role, canManagePriceLists) => {
  const sections = [];

  if (role === 'admin' || role === 'sales') {
    sections.push({
      label: 'מכירות',
      items: [
        { to: '/', label: 'ראשי', icon: Home, end: true },
        { to: '/new-order', label: 'הזמנה חדשה', icon: PlusCircle },
        { to: '/orders-history', label: 'הזמנות והצעות', icon: FileText },
        { to: '/leads', label: 'תיבת פניות', icon: Mail },
        { to: '/whatsapp', label: 'וואטסאפ', icon: MessageCircle },
        { to: '/sales-guide', label: 'מחשבון ומדריך', icon: Calculator },
        ...(canManagePriceLists || role === 'admin'
          ? [{ to: '/manage-pricelists', label: 'מחירונים', icon: ListOrdered }]
          : []),
      ],
    });
  }

  if (role === 'admin') {
    sections.push({
      label: 'ניהול',
      items: [
        { to: '/admin', label: 'דשבורד ניהולי', icon: LayoutDashboard },
        { to: '/admin/customer-lookup', label: 'איתור לקוח', icon: Search },
        { to: '/admin/orders', label: 'ניהול הזמנות', icon: Shield },
        { to: '/admin/performance', label: 'ביצועי נציגים', icon: Trophy },
        { to: '/admin/commissions', label: 'דוח עמלות', icon: FileSpreadsheet },
      ],
    });
  }

  sections.push({
    items: [{ to: '/chat', label: "צ'אט", icon: MessageCircle }],
  });

  return sections;
};

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { isAuthenticated, user, logout } = useAuthStore();
  const sections = isAuthenticated ? getSections(user?.role, user?.canManagePriceLists) : [];

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:flex md:w-56 md:flex-col md:fixed md:inset-y-0">
        <SidebarContent sections={sections} user={user} isAuthenticated={isAuthenticated} logout={logout} />
      </div>

      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between h-14 px-4 bg-white border-b">
        <Link to="/" className="text-lg font-extrabold" style={{ color: GOLD }}>ZIPORI CLASS</Link>
        <div className="flex items-center gap-3">
          {isAuthenticated && <LeadsBell />}
          <button onClick={() => setOpen(true)} className="p-1 text-gray-600"><Menu size={22} /></button>
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black md:hidden" onClick={() => setOpen(false)} />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 right-0 z-50 w-56 md:hidden">
              <SidebarContent sections={sections} user={user} isAuthenticated={isAuthenticated}
                logout={logout} onClose={() => setOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarContent({ sections, user, isAuthenticated, logout, onClose }) {
  const handleLogout = () => { logout(); onClose?.(); };

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-100 shadow-sm overflow-hidden">
      {/* לוגו */}
      <div className="flex items-center justify-between h-14 px-4 border-b border-gray-100 shrink-0">
        <Link to="/" onClick={onClose} className="text-lg font-extrabold" style={{ color: GOLD }}>
          ZIPORI CLASS
        </Link>
        <div className="flex items-center gap-2">
          {isAuthenticated && <LeadsBell />}
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
          )}
        </div>
      </div>

      {/* ניווט */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-6">
        {sections.map((section, i) => (
          <div key={i}>
            {section.label && (
              <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(item => (
                <NavItem key={item.to} item={item} onClick={onClose} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* משתמש */}
      <div className="shrink-0 border-t border-gray-100 px-2 py-3">
        {isAuthenticated ? (
          <UserNav user={user} logout={handleLogout} />
        ) : (
          <Link to="/login" onClick={onClose} className="block px-3 py-2 text-sm text-gray-600 hover:text-gray-900">
            כניסה
          </Link>
        )}
      </div>
    </div>
  );
}

function NavItem({ item, onClick }) {
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? 'text-gray-900 bg-amber-50'
            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
        }`
      }
      style={({ isActive }) => isActive ? { borderRight: `3px solid ${GOLD}`, color: '#92400e' } : {}}
    >
      <item.icon size={16} className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function UserNav({ user, logout }) {
  const initials = (name = '') => {
    const parts = name.trim().split(' ');
    return parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : (name[0] || 'U').toUpperCase();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full outline-none">
        <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-gray-50 transition-colors cursor-pointer">
          <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
            style={{ background: GOLD }}>
            {initials(user?.name)}
          </div>
          <div className="text-start flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{user?.name || 'משתמש'}</p>
            <p className="text-[11px] text-gray-400 truncate">{user?.email}</p>
          </div>
          <ChevronDown size={14} className="text-gray-400 shrink-0" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52" align="end" side="top">
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="text-red-500 focus:text-red-600 focus:bg-red-50 cursor-pointer">
          <LogOut className="mr-2 h-4 w-4" /> התנתק
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
