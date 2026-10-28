import { useState, useEffect, useCallback } from 'react';
import {
  Zap, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, AlertCircle, CheckCircle, Clock, X,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../hooks/useToast';
import { automation as automationApi } from '../utils/api';
import { PageSpinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import { BackArrow } from '../components/kit';

// ── Constants ─────────────────────────────────────────────────────────────────

const TRIGGER_LABELS = {
  'reservation.created':   'הזמנה נוצרה',
  'reservation.modified':  'הזמנה עודכנה',
  'reservation.cancelled': 'הזמנה בוטלה',
  'reservation.noshow':    'אי-הגעה',
  'checkin.completed':     'צ׳ק-אין הושלם',
  'checkout.completed':    'צ׳ק-אאוט הושלם',
  'room.status_changed':   'סטטוס חדר שונה',
  'payment.failed':        'תשלום נכשל',
  'payment.succeeded':     'תשלום הצליח',
  'housekeeping.completed':'ניקיון הושלם',
  'maintenance.created':   'תקלה נפתחה',
  'maintenance.sla_breach':'הפרת SLA',
  'schedule.daily':        'יומי (00:05)',
  'schedule.hourly':       'שעתי',
};

const ACTION_LABELS = {
  'create_alert':              'התראה למערכת',
  'notify_staff':              'הודעה לצוות',
  'create_housekeeping_task':  'משימת ניקיון',
  'create_maintenance_ticket': 'כרטיס תחזוקה',
  'update_room_status':        'עדכון סטטוס חדר',
  'update_reservation':        'עדכון הזמנה',
  'post_charge':               'הוספת חיוב לפוליו',
  'send_message':              'שליחת הודעה לאורח',
  'send_confirmation':         'אישור הזמנה במייל',
  'send_payment_link':         'שליחת קישור תשלום',
  'webhook':                   'Webhook חיצוני',
};

const OPERATORS = [
  { value: 'eq',       label: '=' },
  { value: 'ne',       label: '≠' },
  { value: 'gt',       label: '>' },
  { value: 'lt',       label: '<' },
  { value: 'gte',      label: '≥' },
  { value: 'lte',      label: '≤' },
  { value: 'contains', label: 'מכיל' },
  { value: 'in',       label: 'אחד מ...' },
  { value: 'nin',      label: 'לא אחד מ...' },
];

const TRIGGER_OPTIONS = Object.entries(TRIGGER_LABELS).map(([value, label]) => ({ value, label }));
const ACTION_OPTIONS  = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }));

// ── Condition Row ─────────────────────────────────────────────────────────────

function ConditionRow({ cond, onChange, onRemove }) {
  return (
    <div className="flex gap-2 items-center">
      <input
        className="input flex-1 text-sm"
        placeholder="שדה (למשל reservation.isVip)"
        value={cond.field}
        onChange={e => onChange({ ...cond, field: e.target.value })}
      />
      <select
        className="input w-24 text-sm"
        value={cond.operator}
        onChange={e => onChange({ ...cond, operator: e.target.value })}
      >
        {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input
        className="input flex-1 text-sm"
        placeholder="ערך"
        value={cond.value}
        onChange={e => onChange({ ...cond, value: e.target.value })}
      />
      <button onClick={onRemove} className="text-red-400 hover:text-red-600 p-1">
        <X size={14} />
      </button>
    </div>
  );
}

function emptyCondition() {
  return { field: '', operator: 'eq', value: '' };
}

// ── Action Params Form ────────────────────────────────────────────────────────

function ActionParamsForm({ action, params, onChange }) {
  const set = (k, v) => onChange({ ...params, [k]: v });

  if (!action) return null;

  const textField = (key, label, placeholder = '') => (
    <div key={key}>
      <label className="text-xs text-slate-500 mb-1 block">{label}</label>
      <input className="input w-full text-sm" placeholder={placeholder}
        value={params[key] || ''} onChange={e => set(key, e.target.value)} />
    </div>
  );

  const textareaField = (key, label, placeholder = '') => (
    <div key={key}>
      <label className="text-xs text-slate-500 mb-1 block">{label}</label>
      <textarea className="input w-full text-sm" rows={3} placeholder={placeholder}
        value={params[key] || ''} onChange={e => set(key, e.target.value)} />
    </div>
  );

  const numField = (key, label) => (
    <div key={key}>
      <label className="text-xs text-slate-500 mb-1 block">{label}</label>
      <input type="number" className="input w-full text-sm text-left tabular-nums"
        value={params[key] ?? ''} onChange={e => set(key, e.target.value)} />
    </div>
  );

  switch (action) {
    case 'create_alert':
    case 'notify_staff':
      return (
        <div className="space-y-3">
          {textField('title', 'כותרת', 'הזמנה חדשה: {{reservation.confirmationNumber}}')}
          {textareaField('body', 'גוף ההודעה')}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">עדיפות</label>
            <select className="input w-full text-sm" value={params.priority || 'normal'} onChange={e => set('priority', e.target.value)}>
              {['low','normal','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {textField('recipientRole', 'תפקיד מקבל (אופציונלי)', 'receptionist')}
        </div>
      );

    case 'create_housekeeping_task':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">סוג משימה</label>
            <select className="input w-full text-sm" value={params.type || 'clean'} onChange={e => set('type', e.target.value)}>
              {['clean','deep_clean','turndown','inspection','maintenance'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">עדיפות</label>
            <select className="input w-full text-sm" value={params.priority || 'normal'} onChange={e => set('priority', e.target.value)}>
              {['low','normal','high','urgent'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {textField('notes', 'הערות')}
        </div>
      );

    case 'create_maintenance_ticket':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">קטגוריה</label>
            <select className="input w-full text-sm" value={params.category || 'other'} onChange={e => set('category', e.target.value)}>
              {['plumbing','electrical','hvac','furniture','appliance','safety','cleaning','other'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {textareaField('description', 'תיאור', 'תיאור התקלה...')}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">עדיפות</label>
            <select className="input w-full text-sm" value={params.priority || 'medium'} onChange={e => set('priority', e.target.value)}>
              {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!params.blocksRoom} onChange={e => set('blocksRoom', e.target.checked)} />
            חוסם חדר
          </label>
        </div>
      );

    case 'update_room_status':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">סטטוס תפעולי (opsStatus)</label>
            <select className="input w-full text-sm" value={params.opsStatus || ''} onChange={e => set('opsStatus', e.target.value)}>
              <option value="">— ללא שינוי —</option>
              {['available','occupied','out_of_order','out_of_service'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">סטטוס ניקיון (cleanStatus)</label>
            <select className="input w-full text-sm" value={params.cleanStatus || ''} onChange={e => set('cleanStatus', e.target.value)}>
              <option value="">— ללא שינוי —</option>
              {['clean','dirty','inspected','in_progress'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      );

    case 'update_reservation':
      return (
        <div className="space-y-3">
          {textareaField('internalNotes', 'הערות פנימיות')}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!params.isVip} onChange={e => set('isVip', e.target.checked)} />
            סמן כ-VIP
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!params.isFlagged} onChange={e => set('isFlagged', e.target.checked)} />
            דגל אזהרה
          </label>
          {textField('flagReason', 'סיבת הדגל')}
        </div>
      );

    case 'post_charge':
      return (
        <div className="space-y-3">
          {textField('description', 'תיאור החיוב', 'דמי גני שמחה אוטומטי')}
          {numField('amount', 'סכום (ILS)')}
          {numField('taxAmount', 'מע"מ (אופציונלי)')}
        </div>
      );

    case 'send_message':
      return (
        <div className="space-y-3">
          {textField('subject', 'נושא/כותרת', 'הודעה מ{{property.name}}')}
          {textareaField('body', 'תוכן ההודעה')}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">ערוץ</label>
            <select className="input w-full text-sm" value={params.channel || 'email'} onChange={e => set('channel', e.target.value)}>
              {['email','sms','both'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      );

    case 'send_confirmation':
      return (
        <p className="text-sm text-slate-500">
          ישלח מייל אישור הזמנה מעוצב לאורח — אין פרמטרים נוספים.
        </p>
      );

    case 'send_payment_link':
      return (
        <div className="space-y-3">
          {numField('amount', 'סכום (ILS)')}
          {textField('paymentLink', 'קישור תשלום')}
        </div>
      );

    case 'webhook':
      return (
        <div className="space-y-3">
          {textField('eventType', 'סוג אירוע', 'automation.triggered')}
        </div>
      );

    default:
      return <p className="text-sm text-slate-400 italic">בחר פעולה</p>;
  }
}

// ── Rule Modal ────────────────────────────────────────────────────────────────

function RuleModal({ rule, propertyId, onClose, onSaved }) {
  const isEdit = !!rule;
  const [tab, setTab] = useState('basic');
  const [form, setForm] = useState({
    name:        rule?.name        || '',
    description: rule?.description || '',
    trigger:     rule?.trigger     || '',
    action:      rule?.action      || '',
    actionParams: rule?.actionParams || {},
    conditions:  rule?.conditions  || [],
    exceptions:  rule?.exceptions  || [],
    active:      rule?.active      ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function addCondition(key) {
    set(key, [...form[key], emptyCondition()]);
  }
  function updateCondition(key, idx, val) {
    const arr = [...form[key]];
    arr[idx] = val;
    set(key, arr);
  }
  function removeCondition(key, idx) {
    set(key, form[key].filter((_, i) => i !== idx));
  }

  async function save() {
    if (!form.name.trim() || !form.trigger || !form.action) {
      return setError('שם, טריגר ופעולה חובה');
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        property: propertyId,
        conditions: form.conditions.filter(c => c.field.trim()),
        exceptions: form.exceptions.filter(c => c.field.trim()),
      };
      if (isEdit) {
        await automationApi.updateRule(rule._id, payload);
      } else {
        await automationApi.createRule(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'שגיאה');
    } finally {
      setSaving(false);
    }
  }

  const TABS = [
    { key: 'basic',      label: 'בסיסי' },
    { key: 'conditions', label: `תנאים (${form.conditions.length})` },
    { key: 'action',     label: 'פרמטרי פעולה' },
    { key: 'exceptions', label: `חריגים (${form.exceptions.length})` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">
            {isEdit ? 'עריכת כלל אוטומציה' : 'כלל אוטומציה חדש'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-4 gap-1 pt-2">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded-t font-medium transition-colors ${
                tab === t.key ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'basic' && (
            <>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">שם הכלל *</label>
                <input className="input w-full" placeholder="שלח אישור על הזמנה חדשה"
                  value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">תיאור (אופציונלי)</label>
                <input className="input w-full" placeholder="כלל זה..."
                  value={form.description} onChange={e => set('description', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">טריגר *</label>
                <select className="input w-full" value={form.trigger} onChange={e => set('trigger', e.target.value)}>
                  <option value="">— בחר טריגר —</option>
                  {TRIGGER_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">פעולה *</label>
                <select className="input w-full" value={form.action} onChange={e => { set('action', e.target.value); set('actionParams', {}); }}>
                  <option value="">— בחר פעולה —</option>
                  {ACTION_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
                כלל פעיל
              </label>
            </>
          )}

          {tab === 'conditions' && (
            <>
              <p className="text-xs text-slate-500">כל התנאים חייבים להתקיים יחד (AND). שדות לפי dot-notation, למשל: <code className="bg-slate-100 px-1 rounded">reservation.isVip</code></p>
              <div className="space-y-2">
                {form.conditions.map((c, i) => (
                  <ConditionRow key={i} cond={c}
                    onChange={v => updateCondition('conditions', i, v)}
                    onRemove={() => removeCondition('conditions', i)}
                  />
                ))}
              </div>
              <button onClick={() => addCondition('conditions')} className="btn-secondary text-sm flex items-center gap-1">
                <Plus size={14} /> הוסף תנאי
              </button>
            </>
          )}

          {tab === 'action' && (
            <ActionParamsForm
              action={form.action}
              params={form.actionParams}
              onChange={v => set('actionParams', v)}
            />
          )}

          {tab === 'exceptions' && (
            <>
              <p className="text-xs text-slate-500">אם אחד מתנאי החריג מתקיים, הכלל <strong>לא</strong> יופעל.</p>
              <div className="space-y-2">
                {form.exceptions.map((c, i) => (
                  <ConditionRow key={i} cond={c}
                    onChange={v => updateCondition('exceptions', i, v)}
                    onRemove={() => removeCondition('exceptions', i)}
                  />
                ))}
              </div>
              <button onClick={() => addCondition('exceptions')} className="btn-secondary text-sm flex items-center gap-1">
                <Plus size={14} /> הוסף חריג
              </button>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} />{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex justify-between">
          <button onClick={onClose} className="btn-secondary text-sm">ביטול</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm">
            {saving ? 'שומר...' : isEdit ? 'שמור שינויים' : 'צור כלל'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rule Row ──────────────────────────────────────────────────────────────────

function RuleRow({ rule, onEdit, onToggle, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  const hasError = !!rule.lastError;
  const condCount = rule.conditions?.length || 0;
  const excCount  = rule.exceptions?.length || 0;

  return (
    <div className={`border rounded-lg bg-white overflow-hidden transition-shadow hover:shadow-sm ${rule.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        {/* Active toggle */}
        <button
          onClick={e => { e.stopPropagation(); onToggle(rule, !rule.active); }}
          className={`transition-colors ${rule.active ? 'text-indigo-500 hover:text-indigo-700' : 'text-slate-300 hover:text-slate-500'}`}
          title={rule.active ? 'לחץ לכבות' : 'לחץ להפעיל'}
        >
          {rule.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
        </button>

        {/* Name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-800 text-sm">{rule.name}</span>
            {hasError && <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full"><AlertCircle size={10} />שגיאה</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{TRIGGER_LABELS[rule.trigger] || rule.trigger}</span>
            <span className="text-xs">→</span>
            <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">{ACTION_LABELS[rule.action] || rule.action}</span>
            {condCount > 0 && <span className="text-xs text-slate-400">{condCount} תנאי{condCount !== 1 ? 'ם' : ''}</span>}
          </div>
        </div>

        {/* Stats */}
        <div className="hidden md:flex items-center gap-3 text-xs text-slate-400">
          {rule.runCount > 0 && (
            <span className="flex items-center gap-1">
              <CheckCircle size={12} className="text-emerald-400" />{rule.runCount}
            </span>
          )}
          {rule.lastRunAt && (
            <span className="flex items-center gap-1">
              <Clock size={12} />{new Date(rule.lastRunAt).toLocaleDateString('he-IL')}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button onClick={e => { e.stopPropagation(); onEdit(rule); }}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded">
            <Pencil size={14} />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(rule); }}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
            <Trash2 size={14} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 text-xs space-y-2">
          {rule.description && <p className="text-slate-600">{rule.description}</p>}

          {condCount > 0 && (
            <div>
              <p className="font-medium text-slate-500 mb-1">תנאים:</p>
              {rule.conditions.map((c, i) => (
                <code key={i} className="block bg-white border border-slate-200 rounded px-2 py-1 mb-1 text-slate-700">
                  {c.field} {OPERATORS.find(o => o.value === c.operator)?.label || c.operator} {String(c.value)}
                </code>
              ))}
            </div>
          )}

          {excCount > 0 && (
            <div>
              <p className="font-medium text-slate-500 mb-1">חריגים:</p>
              {rule.exceptions.map((c, i) => (
                <code key={i} className="block bg-white border border-slate-200 rounded px-2 py-1 mb-1 text-slate-700">
                  {c.field} {OPERATORS.find(o => o.value === c.operator)?.label || c.operator} {String(c.value)}
                </code>
              ))}
            </div>
          )}

          {rule.actionParams && Object.keys(rule.actionParams).length > 0 && (
            <div>
              <p className="font-medium text-slate-500 mb-1">פרמטרי פעולה:</p>
              <pre className="bg-white border border-slate-200 rounded px-2 py-1 overflow-x-auto text-slate-600">
                {JSON.stringify(rule.actionParams, null, 2)}
              </pre>
            </div>
          )}

          {hasError && (
            <p className="text-red-600 flex items-start gap-1"><AlertCircle size={12} className="mt-0.5 shrink-0" />{rule.lastError}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AutomationRulesPage() {
  const { propertyId } = useProperty();
  const { showToast, toasts, removeToast } = useToast();

  const [rules,   setRules]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [modal,   setModal]   = useState(null); // null | { mode:'create'} | { mode:'edit', rule }
  const [delTarget, setDelTarget] = useState(null);
  const [filterTrigger, setFilterTrigger] = useState('');
  const [filterActive,  setFilterActive]  = useState('all'); // all | active | inactive

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const res = await automationApi.rules(propertyId);
      setRules(res.data?.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(rule, active) {
    try {
      await automationApi.toggleRule(rule._id, active);
      setRules(rs => rs.map(r => r._id === rule._id ? { ...r, active } : r));
    } catch (err) {
      showToast(err.response?.data?.error || 'שגיאה בעדכון', 'error');
    }
  }

  async function handleDelete() {
    if (!delTarget) return;
    try {
      await automationApi.deleteRule(delTarget._id);
      setRules(rs => rs.filter(r => r._id !== delTarget._id));
      showToast('הכלל נמחק', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'שגיאה במחיקה', 'error');
    } finally {
      setDelTarget(null);
    }
  }

  function handleSaved() {
    setModal(null);
    load();
    showToast('הכלל נשמר', 'success');
  }

  const filtered = rules.filter(r => {
    if (filterTrigger && r.trigger !== filterTrigger) return false;
    if (filterActive === 'active'   && !r.active)  return false;
    if (filterActive === 'inactive' &&  r.active)  return false;
    return true;
  });

  const activeCount   = rules.filter(r =>  r.active).length;
  const errorCount    = rules.filter(r => !!r.lastError).length;

  if (loading) return <PageSpinner />;

  return (
    <div className="ui-page is-approved is-legacy" dir="rtl">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><BackArrow />
          <Zap size={20} className="text-indigo-500" />
          <h1 className="text-xl font-semibold text-slate-800">כללי אוטומציה</h1>
        </div>
        <button onClick={() => setModal({ mode: 'create' })} className="btn-primary flex items-center gap-1.5">
          <Plus size={16} /> כלל חדש
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'סה"כ כללים',  value: rules.length,  color: 'text-slate-700' },
          { label: 'פעילים',       value: activeCount,   color: 'text-indigo-600' },
          { label: 'עם שגיאות',    value: errorCount,    color: errorCount > 0 ? 'text-red-600' : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-center shadow-sm">
            <div className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          className="input text-sm"
          value={filterTrigger}
          onChange={e => setFilterTrigger(e.target.value)}
        >
          <option value="">כל הטריגרים</option>
          {TRIGGER_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select
          className="input text-sm"
          value={filterActive}
          onChange={e => setFilterActive(e.target.value)}
        >
          <option value="all">כל הכללים</option>
          <option value="active">פעילים בלבד</option>
          <option value="inactive">כבויים בלבד</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {/* Rules list */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
          <Zap size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-slate-500">{rules.length === 0 ? 'אין כללי אוטומציה' : 'אין כללים לפי הסינון'}</p>
          {rules.length === 0 && (
            <p className="text-xs mt-1">צור כלל ראשון כדי להתחיל לאוטמטי פעולות במלון</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(rule => (
            <RuleRow
              key={rule._id}
              rule={rule}
              onEdit={r => setModal({ mode: 'edit', rule: r })}
              onToggle={handleToggle}
              onDelete={r => setDelTarget(r)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {modal && (
        <RuleModal
          rule={modal.mode === 'edit' ? modal.rule : null}
          propertyId={propertyId}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Delete confirm */}
      {delTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6" dir="rtl">
            <h3 className="font-semibold text-slate-800 mb-2">מחיקת כלל</h3>
            <p className="text-sm text-slate-600 mb-4">
              האם למחוק את <strong>"{delTarget.name}"</strong>? פעולה זו אינה הפיכה.
            </p>
            <div className="flex justify-between">
              <button onClick={() => setDelTarget(null)} className="btn-secondary">ביטול</button>
              <button onClick={handleDelete} className="btn-primary bg-red-600 hover:bg-red-700 border-red-600">מחק</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
