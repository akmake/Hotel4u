import { useState, useCallback } from 'react';
import { Search, Plus, Crown, Globe, Phone, Mail, X } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { guests as guestApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const COUNTRIES = ['ישראל','ארצות הברית','בריטניה','צרפת','גרמניה','איטליה','ספרד','הולנד','שוויץ','רוסיה','יפן','סין','הודו','ברזיל','אוסטרליה'];

function NewGuestModal({ propertyId, onClose, onCreated }) {
  const [form, setForm] = useState({ firstName:'', lastName:'', email:'', phone:'', country:'ישראל', language:'he', vipLevel:0 });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const g = await guestApi.create({ propertyId, ...form, vipLevel: Number(form.vipLevel) });
      onCreated(g);
      onClose();
    } catch (err) { setError(err.message || 'שגיאה'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in" style={{ direction:'rtl' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="font-bold text-ink">אורח חדש</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">שם פרטי *</label>
              <input className="input w-full" required value={form.firstName} onChange={e => set('firstName', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">שם משפחה *</label>
              <input className="input w-full" required value={form.lastName} onChange={e => set('lastName', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">אימייל</label>
            <input className="input w-full" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">טלפון</label>
            <input className="input w-full" value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">מדינה</label>
              <select className="select w-full" value={form.country} onChange={e => set('country', e.target.value)}>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">רמת VIP</label>
              <select className="select w-full" value={form.vipLevel} onChange={e => set('vipLevel', e.target.value)}>
                <option value={0}>רגיל</option>
                <option value={1}>VIP</option>
                <option value={2}>VVIP</option>
              </select>
            </div>
          </div>
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn btn-primary flex-1 justify-center" disabled={loading}>
              {loading ? 'שומר...' : 'צור אורח'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const VIP_LABELS = { 0:'', 1:'VIP', 2:'VVIP', 3:'VVVIP' };

function VipBadge({ level }) {
  if (!level) return <span className="text-ink-faint text-xs">—</span>;
  return (
    <span className="flex items-center gap-1 badge badge-pending">
      <Crown size={9} className="text-yellow-500" />
      {VIP_LABELS[level] || `VIP ${level}`}
    </span>
  );
}

export default function GuestsPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success } = useToast();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [timer,   setTimer]   = useState(null);
  const [showNew, setShowNew] = useState(false);

  const handleSearch = useCallback((val) => {
    setSearch(val);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setDebouncedSearch(val.trim()), 350);
    setTimer(t);
  }, [timer]);

  const { data, loading, error, refetch } = useApi(
    () => guestApi.list(propertyId, debouncedSearch || undefined),
    [propertyId, debouncedSearch], skip
  );

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const list = data || [];

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />
      {showNew && (
        <NewGuestModal
          propertyId={propertyId}
          onClose={() => setShowNew(false)}
          onCreated={() => { success('אורח נוצר בהצלחה!'); refetch(); }}
        />
      )}
      <div className="page-header">
        <div>
          <div className="page-title">אורחים</div>
          <div className="page-subtitle">{list.length} פרופילים</div>
        </div>
        <button className="btn btn-primary gap-1.5" onClick={() => setShowNew(true)}><Plus size={14} />אורח חדש</button>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          className="input pr-8 text-xs"
          placeholder="חיפוש לפי שם, אימייל, טלפון..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>אורח</th>
              <th>פרטי קשר</th>
              <th>מדינה</th>
              <th>שהיות</th>
              <th>הכנסה</th>
              <th>VIP</th>
            </tr>
          </thead>
          <tbody>
            {list.map(g => {
              const initials = `${g.firstName?.slice(0,1) || ''}${g.lastName?.slice(0,1) || ''}`;
              const isVip = g.vipLevel > 0;
              return (
                <tr key={String(g._id)} className="cursor-pointer">
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="avatar text-xs font-bold"
                        style={{ width:30, height:30, fontSize:11,
                          background: isVip ? 'rgba(234,179,8,0.15)' : 'rgba(99,102,241,0.1)',
                          color: isVip ? '#b45309' : '#6366f1' }}>
                        {initials}
                      </div>
                      <div>
                        <div className="flex items-center gap-1 font-semibold text-ink">
                          {g.firstName} {g.lastName}
                          {isVip && <Crown size={11} className="text-yellow-500" />}
                        </div>
                        {g.preferences && <div className="text-xs text-ink-faint truncate max-w-40">{g.preferences}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {g.email && (
                      <div className="flex items-center gap-1 text-xs text-ink-secondary">
                        <Mail size={10} className="text-ink-faint" /> {g.email}
                      </div>
                    )}
                    {g.phone && (
                      <div className="flex items-center gap-1 text-xs text-ink-muted">
                        <Phone size={10} className="text-ink-faint" /> {g.phone}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="flex items-center gap-1 text-xs">
                      <Globe size={11} className="text-ink-faint" />
                      {g.country || '—'}
                    </span>
                  </td>
                  <td className="text-num font-semibold">{g.totalStays ?? 0}</td>
                  <td className="text-num text-xs">
                    {g.totalRevenue ? `₪${Number(g.totalRevenue).toLocaleString()}` : '—'}
                  </td>
                  <td><VipBadge level={g.vipLevel} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && !loading && (
          <div className="empty-state">
            <Search size={28} className="empty-state-icon" />
            <span>לא נמצאו אורחים</span>
          </div>
        )}
      </div>
    </div>
  );
}
