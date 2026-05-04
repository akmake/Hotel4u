import { useState } from 'react';
import {
  Settings, Users, BedDouble, Building2, Plus, Trash2,
  CheckCircle2, XCircle, Pencil, Save, X, Eye, EyeOff, Home,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { users as usersApi, properties as propertiesApi, rooms as roomsApi, roomTypes as rtApi } from '../utils/api';
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

const BED_TYPES = [
  { value:'king',   label:'King' },
  { value:'queen',  label:'Queen' },
  { value:'twin',   label:'Twin' },
  { value:'double', label:'Double' },
  { value:'single', label:'Single' },
  { value:'bunk',   label:'Bunk' },
  { value:'mixed',  label:'Mixed' },
  { value:'other',  label:'אחר' },
];

const VIEWS = [
  { value:'sea',       label:'ים' },
  { value:'garden',    label:'גינה' },
  { value:'city',      label:'עיר' },
  { value:'mountain',  label:'הר' },
  { value:'pool',      label:'בריכה' },
  { value:'interior',  label:'פנימי' },
  { value:'courtyard', label:'חצר' },
  { value:'other',     label:'אחר' },
];

const AMENITIES_LIST = [
  'WiFi', 'מזגן', 'טלוויזיה', 'מקרר', 'כספת', 'מרפסת', 'ג׳קוזי', 'אמבטיה',
  'מקלחת', 'שירותים נפרדים', 'קפסולות קפה', 'מיני בר', 'כניסה נפרדת', 'נוף לים',
];

const TABS = [
  { id:'property',  label:'פרטי הנכס',   icon: Building2 },
  { id:'roomtypes', label:'סוגי חדרים',  icon: BedDouble },
  { id:'rooms',     label:'חדרים',       icon: Home },
  { id:'users',     label:'משתמשים',     icon: Users },
];

// ── Shared helpers ────────────────────────────────────────────────────────────
function Field({ label, children, half, span2 }) {
  return (
    <div className={span2 ? 'col-span-2' : half ? '' : 'col-span-2'}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

function ConfirmModal({ message, onConfirm, onClose, danger }) {
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-sm" dir="rtl">
        <div className="modal-body text-center py-6">
          <div className="text-ink font-semibold text-base mb-2">{message}</div>
          <div className="text-xs text-ink-muted">פעולה זו אינה ניתנת לביטול</div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary flex-1 justify-center" onClick={onClose}>ביטול</button>
          <button className={`btn flex-1 justify-center ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>אישור</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Property Tab
// ══════════════════════════════════════════════════════════════════════════════
function PropertyTab({ propertyId, success, toastError }) {
  const { data: prop, loading, error, refetch } = useApi(
    () => propertiesApi.get(propertyId), [propertyId], !propertyId
  );
  const [form,   setForm]   = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...(f || prop || {}), [k]: v }));

  if (loading) return <PageSpinner />;
  if (error)   return <ErrorState message={error} onRetry={refetch} />;

  const f = form || prop || {};

  async function save() {
    setSaving(true);
    try {
      await propertiesApi.update(propertyId, form);
      success('פרטי הנכס עודכנו');
      setForm(null);
      refetch();
    } catch (e) { toastError(e.message); }
    finally { setSaving(false); }
  }

  const inp = (k, type = 'text') => (
    <input
      type={type}
      className="input w-full"
      value={f[k] ?? ''}
      onChange={e => set(k, type === 'number' ? Number(e.target.value) : e.target.value)}
    />
  );

  const sel = (k, opts) => (
    <select className="input w-full" value={f[k] ?? ''} onChange={e => set(k, e.target.value)}>
      {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* General */}
      <div className="card p-6">
        <div className="text-sm font-bold text-ink mb-4 pb-2 border-b border-surface-border">פרטים כלליים</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="שם המלון" span2>{inp('name')}</Field>
          <Field label="שם משפטי" span2>{inp('legalName')}</Field>
          <Field label="עיר" half>{inp('city')}</Field>
          <Field label="כתובת" half>{inp('address')}</Field>
          <Field label="טלפון" half>{inp('phone', 'tel')}</Field>
          <Field label="אימייל" half>{inp('email', 'email')}</Field>
          <Field label="אתר" span2>{inp('website', 'url')}</Field>
          <Field label="שעת צ׳ק-אין" half>{inp('checkInTime')}</Field>
          <Field label="שעת צ׳ק-אאוט" half>{inp('checkOutTime')}</Field>
        </div>
      </div>

      {/* Tax & billing */}
      <div className="card p-6">
        <div className="text-sm font-bold text-ink mb-4 pb-2 border-b border-surface-border">מס וחיוב</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="ח.פ. / מספר עוסק" half>{inp('taxNumber')}</Field>
          <Field label="אחוז מע״מ (%)" half>{inp('vatRate', 'number')}</Field>
          <Field label="קידומת חשבונית" half>{inp('invoicePrefix')}</Field>
          <Field label="מספר התחלתי" half>{inp('invoiceSequence', 'number')}</Field>
        </div>
      </div>

      {/* Policies */}
      <div className="card p-6">
        <div className="text-sm font-bold text-ink mb-4 pb-2 border-b border-surface-border">מדיניות</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="שעות ביטול חינם (לפני הגעה)" half>{inp('defaultCancellationHours', 'number')}</Field>
          <Field label="דמי ביטול" half>{inp('defaultCancellationFee')}</Field>
          <Field label="מדיניות חיות" half>
            {sel('petPolicy', [
              { v:'not_allowed', l:'לא מותר' },
              { v:'on_request',  l:'בתיאום מראש' },
              { v:'allowed',     l:'מותר' },
            ])}
          </Field>
          <Field label="מדיניות עישון" half>
            {sel('smokingPolicy', [
              { v:'non_smoking',       l:'אין עישון' },
              { v:'designated_areas',  l:'אזורים מיועדים' },
              { v:'allowed',           l:'מותר' },
            ])}
          </Field>
          <Field label="מדיניות ילדים" span2>
            <textarea className="input w-full h-20 resize-none" value={f.childrenPolicy ?? ''}
              onChange={e => set('childrenPolicy', e.target.value)} />
          </Field>
        </div>
      </div>

      {form && (
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={() => setForm(null)}>ביטול</button>
          <button className="btn btn-primary gap-2" onClick={save} disabled={saving}>
            {saving && <Spinner size={14} />} שמור שינויים
          </button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Room Type Modal
// ══════════════════════════════════════════════════════════════════════════════
function RoomTypeModal({ propertyId, existing, onClose, onSaved }) {
  const blank = {
    code:'', name:'', shortDesc:'', baseRate:'', capacityBase:'2', capacityMax:'2',
    bedType:'double', extraBedAllowed:false, cribAllowed:true,
    roomSizeSqm:'', view:'', amenities:[],
    sellable:true, showInEngine:true, overbookingAllowed:false, overbookingLimit:'0',
  };
  const [form,    setForm]    = useState(existing ? { ...existing, amenities: existing.amenities || [] } : blank);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isEdit = !!existing;

  function toggleAmenity(a) {
    setForm(f => ({
      ...f,
      amenities: f.amenities.includes(a) ? f.amenities.filter(x => x !== a) : [...f.amenities, a],
    }));
  }

  async function submit() {
    if (!form.code || !form.name || !form.baseRate) { setError('קוד, שם ותעריף בסיס הם שדות חובה'); return; }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await propertiesApi.updateRoomType(existing._id, form);
      } else {
        await propertiesApi.createRoomType({ propertyId, ...form });
      }
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-2xl" dir="rtl">
        <div className="modal-header">
          <span className="font-bold text-ink">{isEdit ? `עריכת ${existing.name}` : 'סוג חדר חדש'}</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body flex flex-col gap-5 max-h-[70vh] overflow-y-auto">
          {/* Basic */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">קוד *</label>
              <input className="input w-full font-mono uppercase" value={form.code}
                onChange={e => set('code', e.target.value.toUpperCase())} disabled={isEdit} maxLength={6} />
            </div>
            <div>
              <label className="form-label">שם *</label>
              <input className="input w-full" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div>
              <label className="form-label">תעריף בסיס (₪) *</label>
              <input type="number" className="input w-full" value={form.baseRate} onChange={e => set('baseRate', e.target.value)} min={0} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="form-label">כמות בסיס</label>
                <input type="number" className="input w-full" value={form.capacityBase} onChange={e => set('capacityBase', e.target.value)} min={1} />
              </div>
              <div>
                <label className="form-label">כמות מקס׳</label>
                <input type="number" className="input w-full" value={form.capacityMax} onChange={e => set('capacityMax', e.target.value)} min={1} />
              </div>
            </div>
          </div>

          {/* Descriptions */}
          <div className="flex flex-col gap-3">
            <div>
              <label className="form-label">תיאור קצר</label>
              <input className="input w-full" value={form.shortDesc || ''} onChange={e => set('shortDesc', e.target.value)} />
            </div>
          </div>

          {/* Physical */}
          <div>
            <div className="text-xs font-bold text-ink-secondary mb-2 uppercase tracking-wide">פרטים פיזיים</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="form-label">סוג מיטה</label>
                <select className="input w-full" value={form.bedType} onChange={e => set('bedType', e.target.value)}>
                  {BED_TYPES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">נוף</label>
                <select className="input w-full" value={form.view || ''} onChange={e => set('view', e.target.value)}>
                  <option value="">ללא</option>
                  {VIEWS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">גודל (מ״ר)</label>
                <input type="number" className="input w-full" value={form.roomSizeSqm || ''} onChange={e => set('roomSizeSqm', e.target.value)} min={0} />
              </div>
            </div>
            <div className="flex gap-4 mt-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                <input type="checkbox" className="rounded" checked={form.extraBedAllowed} onChange={e => set('extraBedAllowed', e.target.checked)} />
                מיטה נוספת אפשרית
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                <input type="checkbox" className="rounded" checked={form.cribAllowed} onChange={e => set('cribAllowed', e.target.checked)} />
                עריסת תינוק
              </label>
            </div>
          </div>

          {/* Amenities */}
          <div>
            <div className="text-xs font-bold text-ink-secondary mb-2 uppercase tracking-wide">מתקנים ושירותים</div>
            <div className="flex flex-wrap gap-2">
              {AMENITIES_LIST.map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleAmenity(a)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                    form.amenities.includes(a)
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white text-ink-muted border-surface-border hover:border-brand/40'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Sales */}
          <div>
            <div className="text-xs font-bold text-ink-secondary mb-2 uppercase tracking-wide">כללי מכירה</div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                <input type="checkbox" className="rounded" checked={form.sellable} onChange={e => set('sellable', e.target.checked)} />
                פתוח למכירה
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                <input type="checkbox" className="rounded" checked={form.showInEngine} onChange={e => set('showInEngine', e.target.checked)} />
                מוצג במנוע הזמנות
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                <input type="checkbox" className="rounded" checked={form.overbookingAllowed} onChange={e => set('overbookingAllowed', e.target.checked)} />
                Overbooking מותר
              </label>
              {form.overbookingAllowed && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">מקסימום</span>
                  <input type="number" className="input input-sm w-16 text-center" value={form.overbookingLimit}
                    onChange={e => set('overbookingLimit', e.target.value)} min={0} />
                </div>
              )}
            </div>
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary gap-2" onClick={submit} disabled={saving}>
            {saving && <Spinner size={14} />} {isEdit ? 'שמור שינויים' : 'צור סוג חדר'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Room Types Tab
// ══════════════════════════════════════════════════════════════════════════════
function RoomTypesTab({ propertyId, success, toastError }) {
  const { data: types, loading, error, refetch } = useApi(
    () => propertiesApi.roomTypes(propertyId, true), [propertyId], !propertyId
  );
  const [modal,   setModal]   = useState(null); // null | 'new' | roomType object
  const [confirm, setConfirm] = useState(null); // { id, name }

  if (loading) return <PageSpinner />;
  if (error)   return <ErrorState message={error} onRetry={refetch} />;

  async function deactivate(id) {
    try {
      await propertiesApi.deleteRoomType(id);
      success('סוג חדר הושבת');
      setConfirm(null);
      refetch();
    } catch (e) { toastError(e.message); }
  }

  const BED_LABEL = Object.fromEntries(BED_TYPES.map(b => [b.value, b.label]));
  const VIEW_LABEL = Object.fromEntries(VIEWS.map(v => [v.value, v.label]));

  return (
    <div>
      {modal && (
        <RoomTypeModal
          propertyId={propertyId}
          existing={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); success(modal === 'new' ? 'סוג חדר נוצר' : 'סוג חדר עודכן'); refetch(); }}
        />
      )}
      {confirm && (
        <ConfirmModal
          message={`להשבית את "${confirm.name}"?`}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => deactivate(confirm.id)}
        />
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-ink-muted">{types?.length || 0} סוגי חדרים</div>
        <button className="btn btn-primary gap-2" onClick={() => setModal('new')}>
          <Plus size={15} /> סוג חדר חדש
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {(types || []).map(rt => (
          <div key={rt._id} className={`card p-4 ${!rt.active ? 'opacity-50' : ''}`}>
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-sm"
                style={{ background:'rgba(99,102,241,0.1)', color:'#6366f1' }}>
                {rt.code}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-ink">{rt.name}</span>
                  {!rt.active && <span className="badge badge-cancelled">מושבת</span>}
                  {!rt.sellable && <span className="badge badge-dirty">סגור למכירה</span>}
                </div>
                {rt.shortDesc && <div className="text-xs text-ink-muted mb-2">{rt.shortDesc}</div>}
                <div className="flex flex-wrap gap-3 text-xs text-ink-secondary">
                  <span>₪{rt.baseRate} / לילה</span>
                  <span>{rt.capacityBase}–{rt.capacityMax} אורחים</span>
                  {rt.bedType && <span>{BED_LABEL[rt.bedType] || rt.bedType}</span>}
                  {rt.roomSizeSqm && <span>{rt.roomSizeSqm} מ״ר</span>}
                  {rt.view && <span>נוף: {VIEW_LABEL[rt.view] || rt.view}</span>}
                </div>
                {rt.amenities?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {rt.amenities.map(a => (
                      <span key={a} className="text-xs bg-surface-hover px-2 py-0.5 rounded-full text-ink-muted">{a}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button className="btn btn-ghost btn-icon" onClick={() => setModal(rt)} title="עריכה">
                  <Pencil size={14} />
                </button>
                {rt.active && (
                  <button className="btn btn-ghost btn-icon text-red-400 hover:text-red-600"
                    onClick={() => setConfirm({ id: rt._id, name: rt.name })} title="השבת">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Room Modal
// ══════════════════════════════════════════════════════════════════════════════
function RoomModal({ propertyId, roomTypesList, existing, onClose, onSaved }) {
  const blank = {
    number:'', floor:'1', roomTypeId:'', building:'', wing:'',
    isVip:false, isSmoking:false, isAccessible:false, internalNotes:'',
  };
  const [form,   setForm]   = useState(existing
    ? { number:existing.number, floor:String(existing.floor), roomTypeId:String(existing.roomType?._id || existing.roomType || ''),
        building:existing.building||'', wing:existing.wing||'',
        isVip:existing.isVip||false, isSmoking:existing.isSmoking||false,
        isAccessible:existing.isAccessible||false, internalNotes:existing.internalNotes||'' }
    : blank);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isEdit = !!existing;

  async function submit() {
    if (!form.number || !form.floor || !form.roomTypeId) { setError('מספר חדר, קומה וסוג חדר הם שדות חובה'); return; }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await roomsApi.update(existing._id, { ...form, roomType: form.roomTypeId });
      } else {
        await roomsApi.create({ propertyId, roomTypeId: form.roomTypeId, ...form, floor: Number(form.floor) });
      }
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-lg" dir="rtl">
        <div className="modal-header">
          <span className="font-bold text-ink">{isEdit ? `עריכת חדר ${existing.number}` : 'חדר חדש'}</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">מספר חדר *</label>
              <input className="input w-full font-mono" value={form.number} onChange={e => set('number', e.target.value)} />
            </div>
            <div>
              <label className="form-label">קומה *</label>
              <input type="number" className="input w-full" value={form.floor} onChange={e => set('floor', e.target.value)} min={0} />
            </div>
            <div className="col-span-2">
              <label className="form-label">סוג חדר *</label>
              <select className="input w-full" value={form.roomTypeId} onChange={e => set('roomTypeId', e.target.value)}>
                <option value="">בחר סוג חדר...</option>
                {(roomTypesList || []).map(rt => (
                  <option key={rt._id} value={String(rt._id)}>{rt.code} — {rt.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">בניין</label>
              <input className="input w-full" value={form.building} onChange={e => set('building', e.target.value)} />
            </div>
            <div>
              <label className="form-label">אגף</label>
              <input className="input w-full" value={form.wing} onChange={e => set('wing', e.target.value)} />
            </div>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
              <input type="checkbox" className="rounded" checked={form.isVip} onChange={e => set('isVip', e.target.checked)} />
              VIP
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
              <input type="checkbox" className="rounded" checked={form.isSmoking} onChange={e => set('isSmoking', e.target.checked)} />
              עישון
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
              <input type="checkbox" className="rounded" checked={form.isAccessible} onChange={e => set('isAccessible', e.target.checked)} />
              נגיש
            </label>
          </div>
          <div>
            <label className="form-label">הערות פנימיות</label>
            <textarea className="input w-full h-16 resize-none" value={form.internalNotes}
              onChange={e => set('internalNotes', e.target.value)} />
          </div>
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary gap-2" onClick={submit} disabled={saving}>
            {saving && <Spinner size={14} />} {isEdit ? 'שמור שינויים' : 'צור חדר'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Rooms Tab
// ══════════════════════════════════════════════════════════════════════════════
const CLEAN_LABEL = { clean:'נקי', dirty:'מלוכלך', inspected:'נבדק', pickup:'Pickup', turndown_required:'Turndown' };
const OPS_LABEL   = { available:'זמין', out_of_order:'OOO', out_of_service:'OOS', maintenance_hold:'HOLD', owner_hold:'Owner' };
const OCC_LABEL   = { vacant:'פנוי', occupied:'מאוכלס', due_in:'הגעה', due_out:'יציאה', checked_out:'עזב' };

function RoomsTab({ propertyId, success, toastError }) {
  const { data: roomList, loading, error, refetch } = useApi(
    () => roomsApi.list(propertyId, { limit: 500 }), [propertyId], !propertyId
  );
  const { data: rtList } = useApi(
    () => propertiesApi.roomTypes(propertyId, true), [propertyId], !propertyId
  );
  const [modal,    setModal]    = useState(null);
  const [confirm,  setConfirm]  = useState(null);
  const [filterRt, setFilterRt] = useState('all');

  if (loading) return <PageSpinner />;
  if (error)   return <ErrorState message={error} onRetry={refetch} />;

  async function deactivate(id) {
    try {
      await roomsApi.remove(id);
      success('חדר הושבת');
      setConfirm(null);
      refetch();
    } catch (e) { toastError(e.message); }
  }

  const allRooms = roomList || [];
  const displayed = filterRt === 'all' ? allRooms : allRooms.filter(r => String(r.roomType?._id) === filterRt);
  const byFloor = {};
  displayed.forEach(r => { if (!byFloor[r.floor]) byFloor[r.floor] = []; byFloor[r.floor].push(r); });

  return (
    <div>
      {modal && (
        <RoomModal
          propertyId={propertyId}
          roomTypesList={rtList}
          existing={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); success(modal === 'new' ? 'חדר נוצר' : 'חדר עודכן'); refetch(); }}
        />
      )}
      {confirm && (
        <ConfirmModal
          message={`להשבית את חדר ${confirm.number}?`}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => deactivate(confirm.id)}
        />
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="text-sm text-ink-muted">{allRooms.length} חדרים</div>
          <select className="input input-sm text-xs" value={filterRt} onChange={e => setFilterRt(e.target.value)}>
            <option value="all">כל הסוגים</option>
            {(rtList || []).map(rt => <option key={rt._id} value={String(rt._id)}>{rt.code} — {rt.name}</option>)}
          </select>
        </div>
        <button className="btn btn-primary gap-2" onClick={() => setModal('new')}>
          <Plus size={15} /> חדר חדש
        </button>
      </div>

      {Object.entries(byFloor)
        .sort(([a],[b]) => Number(a) - Number(b))
        .map(([floor, rooms]) => (
          <div key={floor} className="mb-5">
            <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-2 flex items-center gap-2">
              <span>קומה {floor}</span>
              <span className="text-ink-faint font-normal">({rooms.length})</span>
            </div>
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>חדר</th>
                    <th>סוג</th>
                    <th>ניקיון</th>
                    <th>תפעולי</th>
                    <th>תפוסה</th>
                    <th>מאפיינים</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map(room => (
                    <tr key={room._id}>
                      <td className="font-black text-num text-brand">{room.number}</td>
                      <td className="text-xs text-ink-muted">{room.roomType?.code} — {room.roomType?.name}</td>
                      <td>
                        <span className={`badge ${
                          room.cleanStatus === 'clean' ? 'badge-clean' :
                          room.cleanStatus === 'inspected' ? 'badge-confirmed' :
                          'badge-dirty'
                        }`}>{CLEAN_LABEL[room.cleanStatus] || room.cleanStatus}</span>
                      </td>
                      <td>
                        <span className={`badge ${
                          room.opsStatus === 'available' ? 'badge-clean' :
                          room.opsStatus === 'out_of_order' ? 'badge-cancelled' :
                          'badge-dirty'
                        }`}>{OPS_LABEL[room.opsStatus] || room.opsStatus}</span>
                      </td>
                      <td className="text-xs text-ink-muted">{OCC_LABEL[room.occStatus] || room.occStatus}</td>
                      <td>
                        <div className="flex items-center gap-1.5 text-xs text-ink-faint">
                          {room.isVip        && <span className="text-yellow-600 font-bold">VIP</span>}
                          {room.isAccessible && <span>♿</span>}
                          {room.isSmoking    && <span>🚬</span>}
                          {room.building     && <span>{room.building}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button className="btn btn-ghost btn-icon" onClick={() => setModal(room)} title="עריכה">
                            <Pencil size={13} />
                          </button>
                          <button className="btn btn-ghost btn-icon text-red-400 hover:text-red-600"
                            onClick={() => setConfirm({ id: room._id, number: room.number })} title="השבת">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {displayed.length === 0 && (
        <div className="empty-state mt-4">
          <Home size={32} className="empty-state-icon" />
          <span>אין חדרים</span>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Users Tab (unchanged)
// ══════════════════════════════════════════════════════════════════════════════
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
export default function SettingsPage() {
  const { propertyId } = useProperty();
  const [tab, setTab] = useState('property');
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
          <div className="page-subtitle">ניהול נכס, חדרים, סוגי חדרים ומשתמשים</div>
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

      {tab === 'property'  && <PropertyTab  propertyId={propertyId} success={success} toastError={toastError} />}
      {tab === 'roomtypes' && <RoomTypesTab propertyId={propertyId} success={success} toastError={toastError} />}
      {tab === 'rooms'     && <RoomsTab     propertyId={propertyId} success={success} toastError={toastError} />}
      {tab === 'users'     && <UsersTab     propertyId={propertyId} success={success} toastError={toastError} />}
    </div>
  );
}
