import { useState, useRef, useCallback, useMemo } from 'react';
import {
  BriefcaseBusiness, Plus, Search, Phone, Mail, Building2, X,
  CreditCard, Percent, ChevronRight, Pencil, Trash2, Calendar,
  ReceiptText, TrendingUp, Users, FileText, RefreshCw, ChevronDown,
  ExternalLink, CheckCircle2, Clock,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { companies as companiesApi, reservations as resApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const TYPE_HE    = { corporate:'חברה', agency:'סוכנות', tour_operator:'מפעיל סיורים', government:'ממשלתי' };
const TYPE_COLOR = { corporate:'#6366f1', agency:'#0891b2', tour_operator:'#059669', government:'#ea580c' };
const TYPES      = Object.keys(TYPE_HE);

const STATUS_BADGE = {
  confirmed:     { label:'מאושר',   cls:'badge-confirmed' },
  in_house:      { label:'In House',cls:'badge-inhouse'   },
  checked_in:    { label:'In House',cls:'badge-inhouse'   },
  checked_out:   { label:'עזב',     cls:'badge-departure' },
  cancelled:     { label:'בוטל',    cls:'badge-cancelled' },
  no_show:       { label:'No Show', cls:'badge-dirty'     },
  pending_payment:{ label:'ממתין',  cls:'badge-pending'   },
};

/* ── Company Modal ────────────────────────────────────────────────────────── */
function CompanyModal({ propertyId, company, onClose, onSaved }) {
  const isEdit = !!company;
  const [form, setForm] = useState({
    name:        company?.name        || '',
    type:        company?.type        || 'corporate',
    contactName: company?.contactName || '',
    email:       company?.email       || '',
    phone:       company?.phone       || '',
    address:     company?.address     || '',
    taxId:       company?.taxId       || '',
    creditLimit: company?.creditLimit ?? 0,
    discountPct: company?.discountPct ?? 0,
    notes:       company?.notes       || '',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('שם חברה נדרש'); return; }
    setError(''); setLoading(true);
    try {
      isEdit ? await companiesApi.update(company._id, form)
             : await companiesApi.create({ propertyId, ...form });
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background:'rgba(0,0,0,0.55)', backdropFilter:'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in" style={{ direction:'rtl' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="font-bold text-ink">{isEdit ? `עריכת ${company.name}` : 'חברה / סוכנות חדשה'}</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <form onSubmit={submit}>
          <div className="px-6 py-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="form-label">שם חברה *</label>
                <input className="input w-full" value={form.name} onChange={e => set('name', e.target.value)} required />
              </div>
              <div>
                <label className="form-label">סוג</label>
                <select className="input w-full" value={form.type} onChange={e => set('type', e.target.value)}>
                  {TYPES.map(t => <option key={t} value={t}>{TYPE_HE[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">איש קשר</label>
                <input className="input w-full" value={form.contactName} onChange={e => set('contactName', e.target.value)} />
              </div>
              <div>
                <label className="form-label">אימייל</label>
                <input type="email" className="input w-full" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div>
                <label className="form-label">טלפון</label>
                <input className="input w-full" value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="form-label">כתובת</label>
                <input className="input w-full" value={form.address} onChange={e => set('address', e.target.value)} />
              </div>
              <div>
                <label className="form-label">ח.פ. / ע.מ.</label>
                <input className="input w-full" value={form.taxId} onChange={e => set('taxId', e.target.value)} />
              </div>
              <div>
                <label className="form-label">מסגרת אשראי (₪)</label>
                <input type="number" className="input w-full" value={form.creditLimit} onChange={e => set('creditLimit', Number(e.target.value))} min={0} />
              </div>
              <div>
                <label className="form-label">הנחה (%)</label>
                <input type="number" className="input w-full" value={form.discountPct} onChange={e => set('discountPct', Number(e.target.value))} min={0} max={100} />
              </div>
              <div className="col-span-2">
                <label className="form-label">הערות</label>
                <textarea className="input w-full" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          </div>
          <div className="flex gap-2 px-6 py-4 border-t border-surface-border">
            <button type="button" className="btn btn-secondary flex-1 justify-center" onClick={onClose}>ביטול</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 justify-center gap-2">
              {loading && <Spinner size={14}/>}
              {isEdit ? 'שמור שינויים' : 'צור חברה'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Company Drawer ───────────────────────────────────────────────────────── */
function CompanyDrawer({ propertyId, company, onClose, onEdit, onDeleted }) {
  const [tab, setTab] = useState('details');
  const color = TYPE_COLOR[company.type] || '#6366f1';

  const { data: resData, loading: resLoading } = useApi(
    () => resApi.list(propertyId, { company: String(company._id), limit: 50 }),
    [company._id], false
  );

  const reservations = useMemo(() => {
    const list = resData?.reservations || resData || [];
    return [...list].sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate));
  }, [resData]);

  const stats = useMemo(() => {
    const totalSpend    = reservations.reduce((s, r) => s + (r.totalAmount || 0), 0);
    const activeCount   = reservations.filter(r => ['confirmed','in_house','checked_in'].includes(r.status)).length;
    const nightsTotal   = reservations.reduce((s, r) => s + (r.nights || 0), 0);
    return { totalSpend, activeCount, nightsTotal, totalRes: reservations.length };
  }, [reservations]);

  async function handleDelete() {
    if (!confirm(`למחוק את ${company.name}?`)) return;
    try {
      await companiesApi.update(company._id, { active: false });
      onDeleted();
    } catch(e) { alert(e.message); }
  }

  const TABS = [
    { id:'details',      label:'פרטים',   icon: Building2  },
    { id:'reservations', label:'הזמנות',  icon: Calendar   },
  ];

  return (
    <>
      {/* backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      {/* drawer */}
      <div className="fixed inset-y-0 left-0 z-50 w-[480px] max-w-full bg-white shadow-2xl flex flex-col animate-fade-in"
        style={{ direction:'rtl' }}>
        {/* header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background:`${color}18` }}>
            <BriefcaseBusiness size={22} style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-ink text-base truncate">{company.name}</div>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background:`${color}15`, color }}>{TYPE_HE[company.type]}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn btn-secondary btn-sm flex items-center gap-1" onClick={onEdit}>
              <Pencil size={13}/> עריכה
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={handleDelete}>
              <Trash2 size={14} className="text-red-400"/>
            </button>
            <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
          </div>
        </div>

        {/* stats strip */}
        <div className="grid grid-cols-4 divide-x divide-x-reverse divide-surface-border border-b border-surface-border">
          {[
            { label:'הזמנות',    value: stats.totalRes,                         color:'#6366f1' },
            { label:'הכנסה כוללת',value:`₪${stats.totalSpend.toLocaleString()}`, color:'#059669' },
            { label:'לינות',     value: stats.nightsTotal,                      color:'#0891b2' },
            { label:'פעיל',      value: stats.activeCount,                      color:'#ea580c' },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center py-3 px-2 text-center">
              <div className="text-xl font-black text-num" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs text-ink-muted mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* tabs */}
        <div className="flex border-b border-surface-border px-4">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${tab === t.id ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink'}`}>
              <t.icon size={13}/> {t.label}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'details' && (
            <div className="px-5 py-4 flex flex-col gap-4">
              {/* contact info */}
              <div className="card p-4 flex flex-col gap-2.5">
                <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-1">פרטי קשר</div>
                {company.contactName && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <Users size={14} className="text-ink-faint flex-shrink-0"/>
                    <span className="text-ink">{company.contactName}</span>
                  </div>
                )}
                {company.phone && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <Phone size={14} className="text-ink-faint flex-shrink-0"/>
                    <a href={`tel:${company.phone}`} className="text-brand hover:underline">{company.phone}</a>
                  </div>
                )}
                {company.email && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <Mail size={14} className="text-ink-faint flex-shrink-0"/>
                    <a href={`mailto:${company.email}`} className="text-brand hover:underline truncate">{company.email}</a>
                  </div>
                )}
                {company.address && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <Building2 size={14} className="text-ink-faint flex-shrink-0"/>
                    <span className="text-ink-secondary">{company.address}</span>
                  </div>
                )}
              </div>

              {/* commercial terms */}
              <div className="card p-4">
                <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-3">תנאים מסחריים</div>
                <div className="grid grid-cols-3 gap-3">
                  {company.taxId && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-ink-faint">ח.פ / ע.מ.</span>
                      <span className="text-sm font-mono font-semibold text-ink">{company.taxId}</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-ink-faint">מסגרת אשראי</span>
                    <span className="text-sm font-bold text-num text-ink">
                      ₪{(company.creditLimit || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-ink-faint">הנחה</span>
                    <span className="text-sm font-bold text-num" style={{ color:'#059669' }}>
                      {company.discountPct || 0}%
                    </span>
                  </div>
                </div>
              </div>

              {/* notes */}
              {company.notes && (
                <div className="card p-4">
                  <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-2">הערות</div>
                  <p className="text-sm text-ink-secondary leading-relaxed whitespace-pre-line">{company.notes}</p>
                </div>
              )}

              {/* credit utilisation */}
              {(company.creditLimit || 0) > 0 && (
                <div className="card p-4">
                  <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-2">ניצול אשראי</div>
                  <div className="flex items-center justify-between text-xs text-ink-muted mb-1.5">
                    <span>נוצל: ₪{stats.totalSpend.toLocaleString()}</span>
                    <span>מסגרת: ₪{(company.creditLimit).toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-surface-hover rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, Math.round(stats.totalSpend / company.creditLimit * 100))}%`,
                        background: stats.totalSpend > company.creditLimit * 0.9 ? '#dc2626' : '#6366f1',
                      }}/>
                  </div>
                  <div className="text-xs text-ink-faint mt-1 text-left">
                    {Math.min(100, Math.round(stats.totalSpend / company.creditLimit * 100))}% נוצל
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'reservations' && (
            <div className="px-5 py-4">
              {resLoading ? (
                <div className="flex justify-center py-10"><Spinner size={24}/></div>
              ) : reservations.length === 0 ? (
                <div className="text-center py-10 text-ink-muted">
                  <Calendar size={32} className="mx-auto mb-2 text-ink-faint/40"/>
                  <p className="text-sm">אין הזמנות לחברה זו</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {reservations.map(r => {
                    const st = STATUS_BADGE[r.status] || { label: r.status, cls:'badge-pending' };
                    return (
                      <div key={r._id} className="card p-3 flex items-center gap-3 hover:bg-surface-hover transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-mono font-bold text-ink">{r.confirmationNumber}</span>
                            <span className={`badge ${st.cls} text-xs`}>{st.label}</span>
                          </div>
                          <div className="text-xs text-ink-secondary truncate">
                            {r.primaryGuest?.firstName} {r.primaryGuest?.lastName}
                            {r.roomType && <span className="text-ink-faint"> · {r.roomType.name}</span>}
                          </div>
                          <div className="text-xs text-ink-faint mt-0.5 flex items-center gap-1">
                            <Calendar size={10}/>
                            {r.arrivalDate} → {r.departureDate}
                            <span className="text-ink-faint/60">({r.nights} לילות)</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-black text-num text-ink">₪{(r.totalAmount||0).toLocaleString()}</div>
                          <div className="text-xs text-ink-faint">{r.adults || 1} אורחים</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Company Card ─────────────────────────────────────────────────────────── */
function CompanyCard({ company, onClick }) {
  const color = TYPE_COLOR[company.type] || '#6366f1';
  return (
    <div className="card p-4 cursor-pointer hover:shadow-md transition-all hover:scale-[1.01] active:scale-[0.99]"
      onClick={onClick}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background:`${color}15` }}>
          <BriefcaseBusiness size={18} style={{ color }}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-ink text-sm truncate">{company.name}</div>
          <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold"
            style={{ background:`${color}12`, color }}>{TYPE_HE[company.type]}</span>
        </div>
        <ChevronRight size={14} className="text-ink-faint mt-1 flex-shrink-0"/>
      </div>
      {company.contactName && (
        <div className="text-xs text-ink-secondary mb-1 flex items-center gap-1.5">
          <Users size={11} className="text-ink-faint"/> {company.contactName}
        </div>
      )}
      {company.phone && (
        <div className="text-xs text-ink-secondary mb-1 flex items-center gap-1.5">
          <Phone size={11} className="text-ink-faint"/> {company.phone}
        </div>
      )}
      {company.email && (
        <div className="text-xs text-ink-secondary mb-2 flex items-center gap-1.5 truncate">
          <Mail size={11} className="text-ink-faint flex-shrink-0"/> <span className="truncate">{company.email}</span>
        </div>
      )}
      <div className="flex items-center gap-3 pt-2 border-t border-surface-border">
        {(company.creditLimit || 0) > 0 && (
          <div className="flex items-center gap-1 text-xs text-ink-muted">
            <CreditCard size={11}/>
            <span className="font-mono font-semibold">₪{company.creditLimit.toLocaleString()}</span>
          </div>
        )}
        {(company.discountPct || 0) > 0 && (
          <div className="flex items-center gap-1 text-xs" style={{ color:'#059669' }}>
            <Percent size={11}/>
            <span className="font-semibold">{company.discountPct}%</span>
          </div>
        )}
        {company.taxId && (
          <div className="text-xs text-ink-faint font-mono mr-auto truncate">{company.taxId}</div>
        )}
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
export default function CompaniesPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success, error: toastError } = useToast();

  const [q,         setQ]         = useState('');
  const [search,    setSearch]    = useState('');
  const [typeFilter,setTypeFilter]= useState('all');
  const [showNew,   setShowNew]   = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [drawer,    setDrawer]    = useState(null);
  const debRef = useRef(null);

  const handleSearch = useCallback(val => {
    setQ(val);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setSearch(val), 350);
  }, []);

  const { data: list, loading, error, refetch } = useApi(
    () => companiesApi.list(propertyId, search),
    [propertyId, search], skip
  );

  const companies = useMemo(() => {
    const all = list || [];
    return typeFilter === 'all' ? all : all.filter(c => c.type === typeFilter);
  }, [list, typeFilter]);

  async function handleDeactivate(company) {
    try {
      await companiesApi.update(company._id, { active: false });
      success('חברה הוסרה');
      setDrawer(null); refetch();
    } catch(e) { toastError(e.message); }
  }

  if (skip || loading) return <PageSpinner/>;
  if (error)           return <ErrorState message={error} onRetry={refetch}/>;

  const drawerCompany = drawer ? (list || []).find(c => c._id === drawer) : null;

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts}/>

      {/* modals */}
      {showNew && (
        <CompanyModal propertyId={propertyId} onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); success('חברה נוצרה'); refetch(); }}/>
      )}
      {editing && (
        <CompanyModal propertyId={propertyId} company={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); success('חברה עודכנה'); refetch(); if(drawerCompany) refetch(); }}/>
      )}

      {/* drawer */}
      {drawerCompany && (
        <CompanyDrawer
          propertyId={propertyId}
          company={drawerCompany}
          onClose={() => setDrawer(null)}
          onEdit={() => setEditing(drawerCompany)}
          onDeleted={() => { handleDeactivate(drawerCompany); }}
        />
      )}

      {/* header */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <BriefcaseBusiness size={22} className="text-brand"/> חברות וסוכנים
          </h1>
          <p className="page-subtitle">{(list||[]).length} רשומות</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"/>
            <input className="input pr-9 w-52" placeholder="חיפוש חברה..."
              value={q} onChange={e => handleSearch(e.target.value)}/>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={refetch}><RefreshCw size={15}/></button>
          <button className="btn btn-primary flex items-center gap-2" onClick={() => setShowNew(true)}>
            <Plus size={15}/> חברה חדשה
          </button>
        </div>
      </div>

      {/* type filter chips */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <button onClick={() => setTypeFilter('all')}
          className={`badge cursor-pointer transition-all ${typeFilter==='all' ? 'ring-2 ring-brand/40 bg-brand/10 text-brand' : ''}`}>
          הכל ({(list||[]).length})
        </button>
        {TYPES.map(t => {
          const count = (list||[]).filter(c => c.type === t).length;
          if (!count) return null;
          return (
            <button key={t} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
              className={`badge cursor-pointer transition-all`}
              style={{
                background: typeFilter===t ? `${TYPE_COLOR[t]}20` : `${TYPE_COLOR[t]}10`,
                color: TYPE_COLOR[t],
                outline: typeFilter===t ? `2px solid ${TYPE_COLOR[t]}50` : 'none',
              }}>
              {TYPE_HE[t]} ({count})
            </button>
          );
        })}
      </div>

      {/* grid */}
      {companies.length === 0 ? (
        <div className="empty-state mt-10">
          <BriefcaseBusiness size={40} className="empty-state-icon"/>
          <p className="text-ink-muted text-sm">{search ? 'לא נמצאו חברות' : 'אין חברות או סוכנים עדיין'}</p>
          {!search && (
            <button className="btn btn-primary mt-4 flex items-center gap-2" onClick={() => setShowNew(true)}>
              <Plus size={15}/> הוסף ראשון
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {companies.map(c => (
            <CompanyCard key={c._id} company={c} onClick={() => setDrawer(c._id)}/>
          ))}
        </div>
      )}
    </div>
  );
}
