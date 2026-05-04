import { useState } from 'react';
import {
  X, LogIn, LogOut, XCircle, CreditCard, Crown, AlertCircle,
  CheckCircle2, BedDouble, Calendar, Users, Phone, Mail, Globe,
  Pencil, Save,
} from 'lucide-react';
import { reservations as resApi, properties as propApi } from '../../utils/api';
import { useApi } from '../../hooks/useApi';

const STATUS_CONFIG = {
  confirmed:   { label:'מאושר',    cls:'badge-confirmed' },
  modified:    { label:'שונה',     cls:'badge-pending' },
  in_house:    { label:'In House', cls:'badge-inhouse' },
  checked_out: { label:'עזב',      cls:'badge-departure' },
  cancelled:   { label:'בוטל',     cls:'badge-cancelled' },
  no_show:     { label:'No Show',  cls:'badge-dirty' },
};

const PAY_CONFIG = {
  paid:        { label:'שולם',   cls:'badge-clean' },
  balance_due: { label:'יתרה',   cls:'badge-dirty' },
  pending:     { label:'Pending',cls:'badge-pending' },
  unpaid:      { label:'לא שולם',cls:'badge-dirty' },
};

const SOURCE_FLAGS = { booking:'🌐', expedia:'🔷', agoda:'🟠', direct:'🏨', phone:'📞', walk_in:'🚶' };

function Spinner() {
  return <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />;
}

// ── Modify Form ───────────────────────────────────────────────────────────────
function ModifyForm({ res, propertyId, onSaved, onCancel }) {
  const [form, setForm] = useState({
    arrivalDate:        res.arrivalDate,
    departureDate:      res.departureDate,
    roomTypeId:         String(res.roomType?._id || res.roomType || ''),
    ratePerNight:       String(res.ratePerNight || ''),
    adults:             String(res.adults || 2),
    children:           String(res.children || 0),
    specialRequests:    res.specialRequests || '',
    internalNotes:      res.internalNotes || '',
    priceOverrideReason:'',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const { data: roomTypes } = useApi(
    () => propApi.roomTypes(propertyId),
    [propertyId]
  );

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.arrivalDate || !form.departureDate) return setError('תאריכים חובה');
    if (form.arrivalDate >= form.departureDate) return setError('תאריך עזיבה חייב להיות אחרי הגעה');
    setLoading(true);
    setError('');
    try {
      const payload = {
        arrivalDate:    form.arrivalDate,
        departureDate:  form.departureDate,
        roomTypeId:     form.roomTypeId || undefined,
        ratePerNight:   form.ratePerNight ? Number(form.ratePerNight) : undefined,
        adults:         Number(form.adults) || 2,
        children:       Number(form.children) || 0,
        specialRequests: form.specialRequests,
        internalNotes:   form.internalNotes,
        priceOverrideReason: form.priceOverrideReason || undefined,
      };
      const updated = await resApi.update(String(res._id), payload);
      onSaved(updated);
    } catch (e) {
      setError(e.message || 'שגיאה בשמירה');
    } finally {
      setLoading(false);
    }
  }

  const priceChanged = form.ratePerNight && Number(form.ratePerNight) !== res.ratePerNight;

  return (
    <div className="px-5 py-4 border-t border-surface-border bg-surface-hover/30 flex flex-col gap-3" dir="rtl">
      <div className="text-xs font-bold text-ink-secondary">שינוי הזמנה</div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="form-label text-[11px]">תאריך הגעה</label>
          <input type="date" className="input input-sm w-full"
            value={form.arrivalDate} onChange={e => set('arrivalDate', e.target.value)} />
        </div>
        <div>
          <label className="form-label text-[11px]">תאריך עזיבה</label>
          <input type="date" className="input input-sm w-full"
            value={form.departureDate} onChange={e => set('departureDate', e.target.value)} />
        </div>
      </div>

      <div>
        <label className="form-label text-[11px]">סוג חדר</label>
        <select className="input input-sm w-full" value={form.roomTypeId}
          onChange={e => set('roomTypeId', e.target.value)}>
          {(roomTypes || []).map(rt => (
            <option key={rt._id} value={String(rt._id)}>{rt.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="form-label text-[11px]">מחיר ללילה (₪)</label>
          <input type="number" className="input input-sm w-full text-left"
            value={form.ratePerNight} onChange={e => set('ratePerNight', e.target.value)} min={0} />
        </div>
        <div>
          <label className="form-label text-[11px]">מבוגרים</label>
          <input type="number" className="input input-sm w-full text-left"
            value={form.adults} onChange={e => set('adults', e.target.value)} min={1} max={10} />
        </div>
      </div>

      {priceChanged && (
        <div>
          <label className="form-label text-[11px]">סיבה לשינוי מחיר <span className="text-red-500">*</span></label>
          <input className="input input-sm w-full" placeholder="לדוגמה: תמחור מיוחד לאורח קבוע"
            value={form.priceOverrideReason} onChange={e => set('priceOverrideReason', e.target.value)} />
        </div>
      )}

      <div>
        <label className="form-label text-[11px]">הערות מיוחדות</label>
        <input className="input input-sm w-full" placeholder="בקשות מיוחדות"
          value={form.specialRequests} onChange={e => set('specialRequests', e.target.value)} />
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm flex-1 justify-center" onClick={onCancel} disabled={loading}>
          ביטול
        </button>
        <button className="btn btn-primary btn-sm flex-1 justify-center gap-1" onClick={save} disabled={loading}>
          {loading ? <Spinner /> : <Save size={13} />} שמור שינויים
        </button>
      </div>
    </div>
  );
}

// ── Main Drawer ───────────────────────────────────────────────────────────────
export default function ReservationDrawer({ res: initialRes, onClose, onChanged, onFolio }) {
  const [res,           setRes]          = useState(initialRes);
  const [loading,       setLoading]      = useState(null);
  const [error,         setError]        = useState('');
  const [cancelConfirm, setCancelConfirm]= useState(false);
  const [modifying,     setModifying]    = useState(false);

  const propertyId = String(res.property || '');

  const s   = STATUS_CONFIG[res.status] || STATUS_CONFIG.confirmed;
  const p   = PAY_CONFIG[res.paymentStatus] || PAY_CONFIG.pending;
  const g   = res.primaryGuest;
  const nights = res.nights || res.totalNights || '?';
  const total  = res.totalAmount ?? (res.ratePerNight * (res.nights || 1)) ?? 0;

  const canModify = ['confirmed', 'modified'].includes(res.status);

  async function act(action) {
    setError('');
    setLoading(action);
    try {
      if (action === 'checkIn')  await resApi.checkIn(String(res._id), false);
      if (action === 'checkOut') await resApi.checkOut(String(res._id), false);
      if (action === 'cancel')   await resApi.cancel(String(res._id), 'ביטול ידני');
      if (action === 'noShow')   await resApi.noShow(String(res._id));
      onChanged?.();
      onClose();
    } catch (e) { setError(e.message || 'שגיאה'); }
    finally { setLoading(null); }
  }

  function handleSaved(updated) {
    setRes(updated);
    setModifying(false);
    onChanged?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex" style={{ direction:'rtl' }}>
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-surface-border">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`badge ${s.cls}`}>{s.label}</span>
              <span className={`badge ${p.cls}`}>{p.label}</span>
              {res.isVip && <span className="flex items-center gap-0.5 text-xs text-yellow-600 font-bold"><Crown size={10} />VIP</span>}
            </div>
            <div className="font-black text-ink text-lg">{g?.firstName} {g?.lastName}</div>
            <div className="text-xs text-ink-muted font-mono">{res.confirmationNumber}</div>
          </div>
          <div className="flex items-center gap-1">
            {canModify && !modifying && (
              <button className="btn btn-ghost btn-icon" onClick={() => setModifying(true)} title="שנה הזמנה">
                <Pencil size={15} />
              </button>
            )}
            <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Key details grid */}
          <div className="grid grid-cols-2 gap-0 border-b border-surface-border">
            {[
              { icon: Calendar,   label:'הגעה',    value: res.arrivalDate },
              { icon: Calendar,   label:'יציאה',   value: res.departureDate },
              { icon: BedDouble,  label:'סוג חדר', value: res.roomType?.name },
              { icon: BedDouble,  label:'חדר',     value: res.assignedRoom ? `חדר ${res.assignedRoom.number}` : 'ללא הקצאה' },
              { icon: Users,      label:'לילות',   value: nights },
              { icon: Users,      label:'אורחים',  value: `${res.adults || 2} מבוגרים${res.children ? ` + ${res.children} ילדים` : ''}` },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-2.5 px-5 py-3 border-b border-surface-border">
                <Icon size={14} className="text-ink-faint flex-shrink-0" />
                <div>
                  <div className="text-xs text-ink-muted">{label}</div>
                  <div className="text-sm font-semibold text-ink">{value || '—'}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Financial summary */}
          <div className="px-5 py-4 border-b border-surface-border">
            <div className="text-xs font-bold text-ink-secondary mb-2">פיננסי</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-ink-muted">₪{Number(res.ratePerNight || 0).toLocaleString()}/לילה × {nights} לילות</div>
                {res.ratePlan && <div className="text-xs text-ink-muted">תכנית: {res.ratePlan.name || res.ratePlan.code}</div>}
                <div className="text-xs text-ink-muted">מקור: {SOURCE_FLAGS[res.source] || '📋'} {res.source || 'direct'}</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-black text-num text-brand">₪{Number(total).toLocaleString()}</div>
                {res.paymentStatus === 'balance_due' && (
                  <div className="flex items-center gap-1 text-xs text-red-500 font-semibold justify-end">
                    <AlertCircle size={11} /> יתרה לתשלום
                  </div>
                )}
                {res.paymentStatus === 'paid' && (
                  <div className="flex items-center gap-1 text-xs text-emerald-600 font-semibold justify-end">
                    <CheckCircle2 size={11} /> שולם במלואו
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Guest details */}
          {g && (
            <div className="px-5 py-4 border-b border-surface-border">
              <div className="text-xs font-bold text-ink-secondary mb-2">פרטי אורח</div>
              <div className="flex flex-col gap-1.5">
                {g.email   && <div className="flex items-center gap-2 text-xs text-ink-secondary"><Mail  size={12} className="text-ink-faint" />{g.email}</div>}
                {g.phone   && <div className="flex items-center gap-2 text-xs text-ink-secondary"><Phone size={12} className="text-ink-faint" />{g.phone}</div>}
                {g.country && <div className="flex items-center gap-2 text-xs text-ink-secondary"><Globe size={12} className="text-ink-faint" />{g.country}</div>}
              </div>
            </div>
          )}

          {/* Special requests */}
          {res.specialRequests && (
            <div className="px-5 py-4 border-b border-surface-border">
              <div className="text-xs font-bold text-ink-secondary mb-1">בקשות מיוחדות</div>
              <div className="text-sm text-ink bg-brand/5 border border-brand/20 rounded-lg px-3 py-2">
                📌 {res.specialRequests}
              </div>
            </div>
          )}

          {/* Internal notes */}
          {res.internalNotes && (
            <div className="px-5 py-4 border-b border-surface-border">
              <div className="text-xs font-bold text-ink-secondary mb-1">הערות פנימיות</div>
              <div className="text-xs text-ink-muted bg-surface-hover rounded-lg px-3 py-2">
                {res.internalNotes}
              </div>
            </div>
          )}

          {/* Modify form */}
          {modifying && (
            <ModifyForm
              res={res}
              propertyId={propertyId}
              onSaved={handleSaved}
              onCancel={() => setModifying(false)}
            />
          )}

          {/* Cancel confirm */}
          {cancelConfirm && (
            <div className="px-5 py-4 border-b border-surface-border bg-red-50">
              <div className="text-sm font-semibold text-red-700 mb-2">ביטול הזמנה — האם בטוח?</div>
              <div className="flex gap-2">
                <button className="btn btn-danger btn-sm flex-1 justify-center"
                  onClick={() => { setCancelConfirm(false); act('cancel'); }}
                  disabled={!!loading}>
                  {loading === 'cancel' ? <Spinner /> : 'כן, בטל'}
                </button>
                <button className="btn btn-secondary btn-sm flex-1 justify-center"
                  onClick={() => setCancelConfirm(false)}>
                  חזרה
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mx-5 my-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Action footer */}
        <div className="px-5 py-4 border-t border-surface-border bg-surface-hover flex flex-wrap gap-2">
          <button className="btn btn-secondary btn-sm flex-1 justify-center gap-1" onClick={onFolio}>
            <CreditCard size={13} /> Folio
          </button>

          {(res.status === 'confirmed' || res.status === 'modified') && (
            <>
              <button className="btn btn-primary btn-sm flex-1 justify-center gap-1"
                disabled={!!loading} onClick={() => act('checkIn')}>
                <LogIn size={13} /> {loading === 'checkIn' ? <Spinner /> : "צ'ק-אין"}
              </button>
              <button className="btn btn-sm flex-1 justify-center gap-1 text-xs"
                style={{ background:'#fee2e2', color:'#dc2626', border:'1px solid #fca5a5' }}
                disabled={!!loading} onClick={() => setCancelConfirm(true)}>
                <XCircle size={13} /> ביטול
              </button>
            </>
          )}

          {res.status === 'in_house' && (
            <button className="btn btn-primary btn-sm flex-1 justify-center gap-1"
              style={{ background:'#ea580c' }}
              disabled={!!loading} onClick={() => act('checkOut')}>
              <LogOut size={13} /> {loading === 'checkOut' ? <Spinner /> : "צ'ק-אאוט"}
            </button>
          )}

          {(res.status === 'confirmed' || res.status === 'modified') && (
            <button className="btn btn-sm justify-center gap-1 text-xs w-full"
              style={{ background:'#fef9c3', color:'#854d0e', border:'1px solid #fde047' }}
              disabled={!!loading} onClick={() => act('noShow')}>
              No Show
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
