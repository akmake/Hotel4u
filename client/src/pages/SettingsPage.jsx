import { useState, useEffect, useCallback } from 'react';
import {
  Settings, Users, Building2, Plus, Trash2,
  CheckCircle2, XCircle, Pencil, Save, X, Eye, EyeOff, SlidersHorizontal,
  Webhook, RefreshCw, ToggleLeft, ToggleRight, Copy, AlertCircle,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { users as usersApi, properties as propertiesApi, integrations as integrationsApi } from '../utils/api';
import { normalizeCrmSla } from '../utils/crmSla';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

// ── Constants ─────────────────────────────────────────────────────────────────
const ROLE_HE = {
  property_admin: 'מנהל נכס', general_manager: 'מנהל כללי',
  front_desk_manager: 'מנהל קבלה', receptionist: 'קבלן/ית',
  housekeeping_manager: 'מנהל חדרנות', housekeeper: 'חדרן/ית',
  maintenance_manager: 'מנהל תחזוקה', technician: 'טכנאי',
  finance_manager: 'כספים', revenue_manager: 'Revenue',
  auditor: 'מבקר', owner_readonly: 'בעלים (צפייה)',
};
const ROLES = Object.keys(ROLE_HE);

const ROLE_COLORS = {
  property_admin:'#6366f1', general_manager:'#7c3aed',
  front_desk_manager:'#0891b2', receptionist:'#0891b2',
  housekeeping_manager:'#059669', housekeeper:'#059669',
  maintenance_manager:'#ea580c', technician:'#ea580c',
  finance_manager:'#ca8a04', revenue_manager:'#ca8a04',
  auditor:'#475569', owner_readonly:'#475569',
};

const TABS = [
  { id:'setup',     label:'נכס וחדרים',   icon: Building2 },
  { id:'crm-sla',   label:'CRM SLA',      icon: SlidersHorizontal },
  { id:'users',     label:'משתמשים',     icon: Users },
  { id:'webhooks',  label:'Webhooks',     icon: Webhook },
];

// ── Shared helpers ────────────────────────────────────────────────────────────
// פרטי הנכס, סוגי חדרים וחדרים עברו למסך 'הקמת מלון' (/pms/admin/setup) — מקום אחד, עם בדיקות ויומן ביקורת.

function NewUserModal({ propertyId, onClose, onCreated }) {
  const [form, setForm] = useState({ firstName:'', lastName:'', email:'', password:'', role:'receptionist' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await usersApi.create({ propertyId, ...form });
      onCreated();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-md" dir="rtl">
        <div className="modal-header">
          <span className="font-bold text-ink">משתמש חדש</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="modal-body flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">שם פרטי</label>
              <input className="input w-full" value={form.firstName} onChange={e => set('firstName', e.target.value)} required />
            </div>
            <div>
              <label className="form-label">שם משפחה</label>
              <input className="input w-full" value={form.lastName} onChange={e => set('lastName', e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="form-label">אימייל</label>
            <input type="email" className="input w-full" value={form.email} onChange={e => set('email', e.target.value)} required />
          </div>
          <div>
            <label className="form-label">סיסמה</label>
            <div className="relative">
              <input type={showPwd ? 'text' : 'password'} className="input w-full pl-9"
                value={form.password} onChange={e => set('password', e.target.value)} required minLength={6} />
              <button type="button" tabIndex={-1} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                onClick={() => setShowPwd(v => !v)}>
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="form-label">תפקיד</label>
            <select className="input w-full" value={form.role} onChange={e => set('role', e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_HE[r]}</option>)}
            </select>
          </div>
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        </form>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary gap-2" onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} />} צור משתמש
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersTab({ propertyId, success, toastError }) {
  const [showNew,   setShowNew]   = useState(false);
  const [editId,    setEditId]    = useState(null);
  const [editRole,  setEditRole]  = useState('');
  const [saving,    setSaving]    = useState(null);

  const { data: userList, loading, error, refetch } = useApi(
    () => usersApi.list(propertyId), [propertyId], !propertyId
  );

  async function toggleActive(user) {
    setSaving(user._id);
    try {
      await usersApi.update(user._id, { active: !user.active });
      success(user.active ? 'משתמש הושבת' : 'משתמש הופעל');
      refetch();
    } catch (e) { toastError(e.message); }
    finally { setSaving(null); }
  }

  async function saveRole(userId) {
    setSaving(userId);
    try {
      await usersApi.update(userId, { role: editRole });
      success('תפקיד עודכן');
      setEditId(null);
      refetch();
    } catch (e) { toastError(e.message); }
    finally { setSaving(null); }
  }

  if (loading) return <PageSpinner />;
  if (error)   return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-ink-muted">{userList?.length || 0} משתמשים</div>
        <button className="btn btn-primary gap-2" onClick={() => setShowNew(true)}>
          <Plus size={15} /> משתמש חדש
        </button>
      </div>
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr><th>משתמש</th><th>אימייל</th><th>תפקיד</th><th>כניסה אחרונה</th><th>סטטוס</th><th></th></tr>
          </thead>
          <tbody>
            {(userList || []).map(u => (
              <tr key={u._id} className={!u.active ? 'opacity-50' : ''}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <div className="avatar flex-shrink-0"
                      style={{ background:`${ROLE_COLORS[u.role]||'#6366f1'}20`, color:ROLE_COLORS[u.role]||'#6366f1' }}>
                      {u.firstName?.[0]}{u.lastName?.[0]}
                    </div>
                    <span className="font-medium text-sm">{u.firstName} {u.lastName}</span>
                  </div>
                </td>
                <td className="text-xs text-ink-muted font-mono">{u.email}</td>
                <td>
                  {editId === u._id ? (
                    <div className="flex items-center gap-1">
                      <select className="input input-sm" value={editRole} onChange={e => setEditRole(e.target.value)}>
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_HE[r]}</option>)}
                      </select>
                      <button className="btn btn-ghost btn-icon" onClick={() => saveRole(u._id)} disabled={saving===u._id}>
                        {saving===u._id ? <Spinner size={13}/> : <Save size={13}/>}
                      </button>
                      <button className="btn btn-ghost btn-icon" onClick={() => setEditId(null)}><X size={13}/></button>
                    </div>
                  ) : (
                    <button className="flex items-center gap-1.5 group" onClick={() => { setEditId(u._id); setEditRole(u.role); }}>
                      <span className="badge" style={{ background:`${ROLE_COLORS[u.role]||'#6366f1'}15`, color:ROLE_COLORS[u.role]||'#6366f1' }}>
                        {ROLE_HE[u.role]||u.role}
                      </span>
                      <Pencil size={11} className="text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )}
                </td>
                <td className="text-xs text-ink-muted">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('he-IL') : '—'}
                </td>
                <td>
                  {u.active ? <span className="badge badge-clean">פעיל</span> : <span className="badge badge-cancelled">מושבת</span>}
                </td>
                <td>
                  <button className={`btn btn-sm ${u.active ? 'btn-danger' : 'btn-secondary'} gap-1`}
                    onClick={() => toggleActive(u)} disabled={saving===u._id}>
                    {saving===u._id ? <Spinner size={12}/> : u.active ? <XCircle size={13}/> : <CheckCircle2 size={13}/>}
                    {u.active ? 'השבת' : 'הפעל'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showNew && (
        <NewUserModal
          propertyId={propertyId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); success('משתמש נוצר בהצלחה'); refetch(); }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════
function CrmSlaTab({ propertyId, success, toastError }) {
  const { data: prop, loading, error, refetch } = useApi(
    () => propertiesApi.get(propertyId), [propertyId], !propertyId
  );
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  if (loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const source = form || prop || {};
  const sla = normalizeCrmSla(source.crmSla || {});

  function setSla(field, rawValue) {
    setForm((prev) => {
      const base = prev || prop || {};
      const current = normalizeCrmSla(base.crmSla || {});
      return {
        ...base,
        crmSla: {
          ...current,
          [field]: Number(rawValue),
        },
      };
    });
  }

  async function save() {
    setSaving(true);
    try {
      await propertiesApi.update(propertyId, { crmSla: normalizeCrmSla((form || prop || {}).crmSla || {}) });
      success('CRM SLA settings updated');
      setForm(null);
      refetch();
    } catch (e) {
      toastError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function NumberField({ label, field, min = 0, max = 365, help }) {
    return (
      <div>
        <label className="form-label">{label}</label>
        <input
          className="input w-full"
          type="number"
          min={min}
          max={max}
          value={sla[field]}
          onChange={(e) => setSla(field, e.target.value)}
        />
        {help && <div className="text-xs text-ink-faint mt-1">{help}</div>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="card p-6">
        <div className="text-sm font-bold text-ink mb-4 pb-2 border-b border-surface-border">Lead SLA</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberField
            label="Stale lead days"
            field="leadStaleDays"
            min={1}
            max={365}
            help="Lead becomes stale after this many days without activity."
          />
          <NumberField
            label="Next action grace (hours)"
            field="leadDueGraceHours"
            min={0}
            max={168}
            help="Grace period before a due next-action is marked late."
          />
          <NumberField
            label="High score threshold"
            field="leadHighScoreThreshold"
            min={0}
            max={100}
            help="Lead score considered high value."
          />
          <NumberField
            label="Unassigned escalation (hours)"
            field="leadHighScoreUnassignedEscalationHours"
            min={0}
            max={168}
            help="High-score unassigned lead escalates after this delay."
          />
          <NumberField
            label="Attention score threshold"
            field="leadAttentionScoreThreshold"
            min={0}
            max={200}
            help="Priority score threshold for urgent queue."
          />
        </div>
      </div>

      <div className="card p-6">
        <div className="text-sm font-bold text-ink mb-4 pb-2 border-b border-surface-border">Opportunity SLA</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberField
            label="At-risk inactive days"
            field="oppAtRiskInactiveDays"
            min={1}
            max={365}
            help="No activity window to mark a deal at risk."
          />
          <NumberField
            label="Stalled inactive days"
            field="oppStalledInactiveDays"
            min={1}
            max={365}
            help="No activity window to mark a deal stalled."
          />
          <NumberField
            label="Overdue close escalation days"
            field="oppOverdueCloseEscalationDays"
            min={0}
            max={365}
            help="Days after expected close date before escalation."
          />
          <NumberField
            label="Attention score threshold"
            field="oppAttentionScoreThreshold"
            min={0}
            max={300}
            help="Score threshold for urgent opportunity queue."
          />
        </div>
      </div>

      {form && (
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn btn-primary gap-2" onClick={save} disabled={saving}>
            {saving && <Spinner size={14} />}
            Save SLA Settings
          </button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Webhooks Tab
// ══════════════════════════════════════════════════════════════════════════════
function WebhooksTab({ propertyId, success: showSuccess, toastError }) {
  const [webhooks, setWebhooks] = useState([]);
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null); // null | 'create' | { webhook }
  const [secret,   setSecret]   = useState(null); // revealed secret after create/rotate
  const [form, setForm] = useState({ url: '', description: '', events: [] });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const [whRes, evRes] = await Promise.all([
        integrationsApi.webhooks.list(propertyId),
        integrationsApi.webhooks.events(),
      ]);
      setWebhooks(whRes.data?.data || []);
      setEvents(evRes.data?.data || []);
    } catch (e) {
      toastError(e.response?.data?.error || 'שגיאה בטעינת webhooks');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ url: '', description: '', events: [] });
    setSecret(null);
    setModal('create');
  }

  function toggleEvent(ev) {
    setForm(f => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter(e => e !== ev) : [...f.events, ev],
    }));
  }

  async function handleCreate() {
    if (!form.url || !form.events.length) return toastError('URL ואירוע אחד לפחות חובה');
    setSaving(true);
    try {
      const res = await integrationsApi.webhooks.create({ propertyId, ...form });
      setSecret(res.data?.data?.secret || null);
      showSuccess('Webhook נוצר');
      load();
      setModal('reveal-secret');
    } catch (e) {
      toastError(e.response?.data?.error || 'שגיאה ביצירת webhook');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(wh) {
    try {
      await integrationsApi.webhooks.update(wh._id, { active: !wh.active });
      setWebhooks(ws => ws.map(w => w._id === wh._id ? { ...w, active: !wh.active } : w));
    } catch (e) {
      toastError(e.response?.data?.error || 'שגיאה');
    }
  }

  async function handleRotate(wh) {
    try {
      const res = await integrationsApi.webhooks.rotateSecret(wh._id);
      setSecret(res.data?.data?.secret || null);
      setModal('reveal-secret');
      showSuccess('Secret הוחלף');
    } catch (e) {
      toastError(e.response?.data?.error || 'שגיאה');
    }
  }

  async function handleDelete(wh) {
    if (!window.confirm(`למחוק את ה-Webhook ל-${wh.url}?`)) return;
    try {
      await integrationsApi.webhooks.remove(wh._id);
      setWebhooks(ws => ws.filter(w => w._id !== wh._id));
      showSuccess('Webhook נמחק');
    } catch (e) {
      toastError(e.response?.data?.error || 'שגיאה במחיקה');
    }
  }

  function copySecret() {
    navigator.clipboard.writeText(secret || '').catch(() => null);
    showSuccess('הועתק ללוח');
  }

  if (loading) return <div className="p-6 text-center text-ink-muted text-sm">טוען...</div>;

  return (
    <div className="max-w-3xl space-y-5" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-ink">Webhooks</h2>
          <p className="text-xs text-ink-muted mt-0.5">קבל התראות HTTP ל-URL חיצוני כשמתרחשים אירועים במלון</p>
        </div>
        <button onClick={openCreate} className="btn btn-primary flex items-center gap-1.5">
          <Plus size={15} /> Webhook חדש
        </button>
      </div>

      {webhooks.length === 0 ? (
        <div className="bg-surface-alt border border-surface-border rounded-xl p-10 text-center">
          <Webhook size={28} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-sm text-ink-muted">אין webhooks רשומים עדיין</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map(wh => (
            <div key={wh._id} className={`bg-white border rounded-xl p-4 ${wh.active ? 'border-surface-border' : 'border-surface-border opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-medium text-ink truncate">{wh.url}</code>
                    {!wh.active && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">כבוי</span>}
                    {wh.failureCount > 0 && (
                      <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded flex items-center gap-1">
                        <AlertCircle size={10} />{wh.failureCount} כשלים
                      </span>
                    )}
                  </div>
                  {wh.description && <p className="text-xs text-ink-muted mt-0.5">{wh.description}</p>}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(wh.events || []).map(ev => (
                      <span key={ev} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{ev}</span>
                    ))}
                  </div>
                  {wh.lastCalledAt && (
                    <p className="text-xs text-ink-faint mt-1">שיחה אחרונה: {new Date(wh.lastCalledAt).toLocaleString('he-IL')}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handleToggle(wh)} title={wh.active ? 'כבה' : 'הפעל'}
                    className={`transition-colors ${wh.active ? 'text-indigo-500 hover:text-indigo-700' : 'text-slate-300 hover:text-slate-500'}`}>
                    {wh.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                  </button>
                  <button onClick={() => handleRotate(wh)} title="החלף secret"
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded">
                    <RefreshCw size={14} />
                  </button>
                  <button onClick={() => handleDelete(wh)} title="מחק"
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {modal === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" dir="rtl">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-slate-800">Webhook חדש</h3>
              <button onClick={() => setModal(null)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="form-label">URL (https) *</label>
                <input className="input w-full" placeholder="https://myapp.com/webhooks/hotel"
                  value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">תיאור (אופציונלי)</label>
                <input className="input w-full" placeholder="שם מערכת..."
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">אירועים *</label>
                <div className="grid grid-cols-2 gap-1 max-h-44 overflow-y-auto border border-surface-border rounded-lg p-2">
                  {events.map(ev => (
                    <label key={ev} className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5">
                      <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)} />
                      <span className="truncate">{ev}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t flex justify-between">
              <button onClick={() => setModal(null)} className="btn btn-secondary">ביטול</button>
              <button onClick={handleCreate} disabled={saving} className="btn btn-primary">
                {saving ? 'יוצר...' : 'צור Webhook'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Secret reveal Modal */}
      {modal === 'reveal-secret' && secret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" dir="rtl">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Signing Secret</h3>
              <button onClick={() => { setModal(null); setSecret(null); }}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-600 mb-3">שמור את ה-secret הזה — הוא יוצג פעם אחת בלבד.</p>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <code className="flex-1 text-xs break-all text-slate-700">{secret}</code>
                <button onClick={copySecret} className="text-slate-400 hover:text-slate-700 shrink-0">
                  <Copy size={14} />
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">השתמש ב-secret לאימות חתימת HMAC-SHA256 על ה-payload.</p>
            </div>
            <div className="px-5 py-3 border-t">
              <button onClick={() => { setModal(null); setSecret(null); }} className="btn btn-primary w-full">הבנתי, סגור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { propertyId } = useProperty();
  const [tab, setTab] = useState('setup');
  const { toasts, success, error: toastError } = useToast();

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      <div className="page-header">
        <div>
          <div className="page-title flex items-center gap-2">
            <Settings size={22} className="text-brand" />
            הגדרות
          </div>
          <div className="page-subtitle">CRM SLA ו־Webhooks · הנכס והחדרים — במסך הקמת מלון</div>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-6 border-b border-surface-border">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px ${
                active ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'setup' && (
        <div className="card p-5" dir="rtl">
          <div className="font-semibold mb-1">פרטי הנכס, סוגי חדרים וחדרים עברו למסך הקמת מלון</div>
          <div className="text-[13px] text-ink-muted mb-3">כולל הוספת חדרים בטווח, בדיקת מספר עוסק, יומן ביקורת ורשימת מה שעוד חסר.</div>
          <a href="/pms/admin/setup" className="btn btn-primary btn-sm">למסך הקמת מלון</a>
        </div>
      )}
      {tab === 'crm-sla'   && <CrmSlaTab     propertyId={propertyId} success={success} toastError={toastError} />}
      {tab === 'users'     && (
        <div className="card p-5" dir="rtl">
          <div className="font-semibold mb-1">משתמשים והרשאות עברו למסך ניהול משתמשים</div>
          <div className="text-[13px] text-ink-muted mb-3">הזמנה עם קישור הגדרת סיסמה, תפקידים לפי סמכות, תוקף גישה והשבתה שמנתקת מושבים.</div>
          <a href="/pms/admin/users" className="btn btn-primary btn-sm">למסך המשתמשים</a>
        </div>
      )}
      {tab === 'webhooks'  && <WebhooksTab   propertyId={propertyId} success={success} toastError={toastError} />}
    </div>
  );
}
