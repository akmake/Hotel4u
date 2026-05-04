import { useState, useRef, useCallback } from 'react';
import {
  BriefcaseBusiness, Plus, Search, Phone, Mail,
  Building2, X, CreditCard, Percent,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { companies as companiesApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const TYPE_HE    = { corporate: 'חברה',   agency: 'סוכנות', tour_operator: 'מפעיל סיורים', government: 'ממשלתי' };
const TYPE_COLOR = { corporate: '#6366f1', agency: '#0891b2', tour_operator: '#059669',       government: '#ea580c' };
const TYPES      = Object.keys(TYPE_HE);

// ── New / Edit Company Modal ──────────────────────────────────────────────────
function CompanyModal({ propertyId, company, onClose, onSaved }) {
  const isEdit = !!company;
  const [form, setForm] = useState({
    name: company?.name || '', type: company?.type || 'corporate',
    contactName: company?.contactName || '', email: company?.email || '',
    phone: company?.phone || '', address: company?.address || '',
    taxId: company?.taxId || '', creditLimit: company?.creditLimit ?? 0,
    discountPct: company?.discountPct ?? 0, notes: company?.notes || '',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isEdit) {
        await companiesApi.update(company._id, form);
      } else {
        await companiesApi.create({ propertyId, ...form });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-lg" dir="rtl">
        <div className="modal-header">
          <span className="font-bold text-ink">{isEdit ? 'עריכת חברה' : 'חברה / סוכנות חדשה'}</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="modal-body flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="form-label">שם *</label>
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
              <input type="number" className="input w-full" value={form.creditLimit} onChange={e => set('creditLimit', e.target.value)} min={0} />
            </div>
            <div>
              <label className="form-label">הנחה (%)</label>
              <input type="number" className="input w-full" value={form.discountPct} onChange={e => set('discountPct', e.target.value)} min={0} max={100} />
            </div>
            <div className="col-span-2">
              <label className="form-label">הערות</label>
              <textarea className="input w-full" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
        </form>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary gap-2" onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} />}
            {isEdit ? 'שמור' : 'צור חברה'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Company Card ──────────────────────────────────────────────────────────────
function CompanyCard({ company, onClick }) {
  const color = TYPE_COLOR[company.type] || '#6366f1';
  return (
    <div
      className="card p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}15` }}>
          <BriefcaseBusiness size={18} style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-ink text-sm truncate">{company.name}</div>
          <span className="badge mt-0.5" style={{ background: `${color}12`, color }}>
            {TYPE_HE[company.type]}
          </span>
        </div>
      </div>

      {company.contactName && (
        <div className="text-xs text-ink-secondary mb-1 flex items-center gap-1.5">
          <Building2 size={11} className="text-ink-faint" />
          {company.contactName}
        </div>
      )}
      {company.phone && (
        <div className="text-xs text-ink-secondary mb-1 flex items-center gap-1.5">
          <Phone size={11} className="text-ink-faint" />
          {company.phone}
        </div>
      )}
      {company.email && (
        <div className="text-xs text-ink-secondary mb-2 flex items-center gap-1.5">
          <Mail size={11} className="text-ink-faint" />
          {company.email}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2 border-t border-surface-border">
        {company.creditLimit > 0 && (
          <div className="flex items-center gap-1 text-xs text-ink-muted">
            <CreditCard size={11} />
            <span className="font-mono font-semibold">₪{company.creditLimit.toLocaleString()}</span>
          </div>
        )}
        {company.discountPct > 0 && (
          <div className="flex items-center gap-1 text-xs text-ink-muted">
            <Percent size={11} />
            <span className="font-mono font-semibold">{company.discountPct}%</span>
          </div>
        )}
        {company.taxId && (
          <div className="text-xs text-ink-faint font-mono mr-auto">{company.taxId}</div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CompaniesPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success, error: toastError } = useToast();

  const [q,       setQ]       = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const debounceRef = useRef(null);

  const [search, setSearch] = useState('');
  const handleSearch = useCallback((val) => {
    setQ(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 350);
  }, []);

  const { data: list, loading, error, refetch } = useApi(
    () => companiesApi.list(propertyId, search),
    [propertyId, search], skip
  );

  async function deactivate(company) {
    try {
      await companiesApi.update(company._id, { active: false });
      success('חברה הוסרה');
      refetch();
    } catch (e) { toastError(e.message); }
  }

  if (skip || loading) return <PageSpinner />;
  if (error)           return <ErrorState message={error} onRetry={refetch} />;

  const companies = list || [];

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      <div className="page-header">
        <div>
          <div className="page-title flex items-center gap-2">
            <BriefcaseBusiness size={22} className="text-brand" />
            חברות וסוכנים
          </div>
          <div className="page-subtitle">{companies.length} רשומות</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
            <input
              className="input pr-9 w-52"
              placeholder="חיפוש חברה..."
              value={q}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-primary gap-2" onClick={() => setShowNew(true)}>
            <Plus size={15} /> חברה חדשה
          </button>
        </div>
      </div>

      {/* Filter by type */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {TYPES.map(t => (
          <span key={t} className="badge cursor-default"
            style={{ background: `${TYPE_COLOR[t]}12`, color: TYPE_COLOR[t] }}>
            {TYPE_HE[t]} ({companies.filter(c => c.type === t).length})
          </span>
        ))}
      </div>

      {companies.length === 0 ? (
        <div className="card p-16 text-center">
          <BriefcaseBusiness size={40} className="text-ink-faint/30 mx-auto mb-3" />
          <div className="text-ink-muted text-sm">אין חברות או סוכנים עדיין</div>
          <button className="btn btn-primary mt-4 gap-2" onClick={() => setShowNew(true)}>
            <Plus size={15} /> הוסף ראשון
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {companies.map(c => (
            <CompanyCard key={c._id} company={c} onClick={() => setEditing(c)} />
          ))}
        </div>
      )}

      {showNew && (
        <CompanyModal
          propertyId={propertyId}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); success('חברה נוצרה'); refetch(); }}
        />
      )}
      {editing && (
        <CompanyModal
          propertyId={propertyId}
          company={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); success('חברה עודכנה'); refetch(); }}
        />
      )}
    </div>
  );
}
