import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, BarChart3, ChevronDown, LayoutDashboard, LogOut, Menu, Search, ShoppingCart, Wrench, X } from 'lucide-react';
import { NAV_STYLES, useNavStyle } from '../../stores/navStyleStore';
import './NavVariants.css';

// Alternative looks for the same navigation (same items, same permissions, same routes).
const GROUP_ICONS = { 'ראשי': LayoutDashboard, 'קבלה': LayoutDashboard, 'מכירות': ShoppingCart, 'תפעול': Wrench, 'ניהול': BarChart3 };
const groupIcon = (name) => GROUP_ICONS[name] || LayoutDashboard;

function useDismiss(ref, onDismiss, active) {
  useEffect(() => {
    if (!active) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onDismiss(); };
    const key = (e) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
}

function AccountMenu({ account, placement, inline, onDone }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  const run = (fn) => () => { setOpen(false); onDone?.(); fn(); };
  const actions = (
    <>
      {account.onProfile && <button type="button" role="menuitem" className="nv-act" onClick={run(account.onProfile)}>הפרופיל שלי</button>}
      <button type="button" role="menuitem" className="nv-act" onClick={run(account.onSwitch)}><ArrowLeftRight size={15} />{account.switchLabel}</button>
      <button type="button" role="menuitem" className="nv-act" onClick={run(account.onLogout)}><LogOut size={15} />יציאה מהמערכת</button>
    </>
  );
  if (inline) {
    return (
      <div className="nv-account-inline">
        <div className="nv-who-row"><span className="nv-avatar">{account.initial}</span><span className="nv-who"><strong>{account.name}</strong><small>{account.role}</small></span></div>
        <div className="nv-account-acts">{actions}</div>
      </div>
    );
  }
  return (
    <div className="nv-account" ref={ref}>
      <button type="button" className="nv-avatar-btn" aria-haspopup="menu" aria-expanded={open} title={account.name} onClick={() => setOpen((v) => !v)}>
        <span className="nv-avatar">{account.initial}</span>
        {placement === 'below' && <span className="nv-who"><strong>{account.name}</strong><small>{account.role}</small></span>}
      </button>
      {open && (
        <div className={`nv-pop is-${placement}`} role="menu">
          <div className="nv-pop-who"><strong>{account.name}</strong><small>{account.role}</small></div>
          {actions}
        </div>
      )}
    </div>
  );
}

function NavItem({ item, onPick }) {
  const Icon = item.icon;
  return (
    <button type="button" role="menuitem" className={`nv-item ${item.active ? 'is-active' : ''}`} aria-current={item.active ? 'page' : undefined} onClick={() => onPick(item.path)}>
      <span className="nv-item-ic"><Icon size={18} /></span><span>{item.label}</span>
    </button>
  );
}

/* 1. Rail — a slim icon rail; each group opens a panel of its screens beside it. */
function Rail({ groups, go, onSearch, account }) {
  const [open, setOpen] = useState(null);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(null), !!open);
  const current = groups.find((g) => g.items.some((i) => i.active))?.group;
  const openGroup = groups.find((g) => g.group === open);
  const pick = (path) => { setOpen(null); go(path); };
  return (
    <aside className="nv-rail" ref={ref} dir="rtl" aria-label="ניווט ראשי">
      <div className="nv-rail-bar">
        {groups.map((g) => {
          const Icon = groupIcon(g.group);
          return (
            <button key={g.group} type="button" className={`nv-rail-btn ${current === g.group ? 'is-current' : ''} ${open === g.group ? 'is-open' : ''}`} aria-expanded={open === g.group} onClick={() => setOpen(open === g.group ? null : g.group)}>
              <Icon size={22} /><span>{g.group}</span>
            </button>
          );
        })}
        <div className="nv-grow" />
        {onSearch && <button type="button" className="nv-rail-btn" onClick={onSearch}><Search size={22} /><span>חיפוש</span></button>}
        <AccountMenu account={account} placement="side" />
      </div>
      {openGroup && (
        <div className="nv-flyout" role="menu" aria-label={openGroup.group}>
          <h3>{openGroup.group}</h3>
          {openGroup.items.map((item) => <NavItem key={item.path} item={item} onPick={pick} />)}
        </div>
      )}
    </aside>
  );
}

/* 2. Top — navigation moves to a bar under the header; groups open as a wide panel of tiles. */
function Top({ groups, go, onSearch, account }) {
  const [open, setOpen] = useState(null);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(null), !!open);
  const current = groups.find((g) => g.items.some((i) => i.active))?.group;
  const openGroup = groups.find((g) => g.group === open);
  const pick = (path) => { setOpen(null); go(path); };
  return (
    <nav className="nv-top" ref={ref} dir="rtl" aria-label="ניווט ראשי">
      <div className="nv-top-tabs">
        {groups.map((g) => (
          <button key={g.group} type="button" className={`nv-tab ${current === g.group ? 'is-current' : ''} ${open === g.group ? 'is-open' : ''}`} aria-expanded={open === g.group} onClick={() => setOpen(open === g.group ? null : g.group)}>
            {g.group}<ChevronDown size={14} />
          </button>
        ))}
      </div>
      <div className="nv-top-tools">
        {onSearch && <button type="button" className="nv-icon-btn" onClick={onSearch} aria-label="חיפוש" title="חיפוש"><Search size={18} /></button>}
        <AccountMenu account={account} placement="below" />
      </div>
      {openGroup && (
        <div className="nv-mega" role="menu" aria-label={openGroup.group}>
          <div className="nv-mega-grid">
            {openGroup.items.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.path} type="button" role="menuitem" className={`nv-card ${item.active ? 'is-active' : ''}`} aria-current={item.active ? 'page' : undefined} onClick={() => pick(item.path)}>
                  <span className="nv-card-ic"><Icon size={20} /></span><span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}

/* 3. Launcher — no permanent navigation: a floating pill names the current screen and opens a full menu with search. */
function Launcher({ groups, go, onSearch, account }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = groups.flatMap((g) => g.items).find((i) => i.active);
  const term = q.trim();
  const shown = groups.map((g) => ({ ...g, items: term ? g.items.filter((i) => i.label.includes(term)) : g.items })).filter((g) => g.items.length);
  const close = () => { setOpen(false); setQ(''); };
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);
  const pick = (path) => { close(); go(path); };
  return (
    <>
      <button type="button" className="nv-pill" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Menu size={18} /><span>{current?.label || 'תפריט'}</span>
      </button>
      {open && (
        <div className="nv-launch" role="dialog" aria-label="תפריט ראשי" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="nv-launch-card" dir="rtl">
            <div className="nv-launch-search">
              <Search size={18} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) pick(shown[0].items[0].path); }} placeholder="לאן עוברים?" aria-label="חיפוש מסך" />
              {onSearch && <button type="button" className="nv-launch-global" onClick={() => { close(); onSearch(); }}>חיפוש אורחים והזמנות</button>}
              <button type="button" className="nv-icon-btn" onClick={close} aria-label="סגירה"><X size={18} /></button>
            </div>
            <div className="nv-launch-body">
              {shown.length === 0 && <p className="nv-none">לא נמצא מסך בשם הזה</p>}
              {shown.map((g) => (
                <section key={g.group}>
                  <h3>{g.group}</h3>
                  <div className="nv-tiles">
                    {g.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button key={item.path} type="button" className={`nv-tile ${item.active ? 'is-active' : ''}`} aria-current={item.active ? 'page' : undefined} onClick={() => pick(item.path)}>
                          <span className="nv-tile-ic"><Icon size={22} /></span><span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <footer className="nv-launch-foot"><AccountMenu account={account} inline onDone={close} /></footer>
          </div>
        </div>
      )}
    </>
  );
}

export default function NavVariant({ variant, ...props }) {
  if (variant === 'rail') return <Rail {...props} />;
  if (variant === 'top') return <Top {...props} />;
  return <Launcher {...props} />;
}

// Temporary design-time switch, available on every screen.
export function NavStyleSwitch() {
  const style = useNavStyle((s) => s.style);
  const setStyle = useNavStyle((s) => s.setStyle);
  return (
    <div className="nv-switch" role="group" aria-label="מראה הניווט" dir="rtl">
      <span>מראה ניווט</span>
      {NAV_STYLES.map((o) => <button key={o.value} type="button" aria-pressed={style === o.value} onClick={() => setStyle(o.value)}>{o.label}</button>)}
    </div>
  );
}
