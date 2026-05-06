import { useState, useEffect, useCallback } from 'react';
import {
  X, LogIn, LogOut, XCircle, CreditCard, Crown, AlertCircle,
  CheckCircle2, BedDouble, Calendar, Users, Phone, Mail, Globe,
  Pencil, Save, Send, Link2, MessageSquare, RefreshCw, Plus,
  Clock, Copy, AlertTriangle, Home, ClipboardList, ChevronDown,
  UserCheck, Hash, Info, Sparkles,
} from 'lucide-react';
import {
  reservations as resApi,
  rooms as roomsApi,
  properties as propApi,
} from '../../utils/api';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../hooks/useToast';
import { Spinner } from '../ui/Spinner';
import { ToastContainer } from '../ui/Toast';
import { TODAY } from '../../utils/date';
import ReservationAdvancedTab from './ReservationAdvancedTab';

// ── Constants ──────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  confirmed:   { label: 'מאושר',    cls: 'badge-confirmed',  color: '#6366f1' },
  modified:    { label: 'שונה',     cls: 'badge-pending',    color: '#f59e0b' },
  in_house:    { label: 'In House', cls: 'badge-inhouse',    color: '#3b82f6' },
  checked_out: { label: 'עזב',      cls: 'badge-departure',  color: '#f97316' },
  cancelled:   { label: 'בוטל',     cls: 'badge-cancelled',  color: '#ef4444' },
  no_show:     { label: 'No Show',  cls: 'badge-dirty',      color: '#dc2626' },
};

const PAY_CONFIG = {
  paid:        { label: 'שולם',    cls: 'badge-clean',    icon: CheckCircle2,   color: '#059669' },
  balance_due: { label: 'יתרה',    cls: 'badge-dirty',    icon: AlertCircle,    color: '#dc2626' },
  pending:     { label: 'Pending', cls: 'badge-pending',  icon: Clock,          color: '#d97706' },
  partial:     { label: 'חלקי',   cls: 'badge-departure', icon: Info,           color: '#f97316' },
  unpaid:      { label: 'לא שולם', cls: 'badge-dirty',    icon: AlertCircle,    color: '#dc2626' },
};

const SOURCE_FLAGS = {
  booking: '🌐', expedia: '🔷', agoda: '🟠',
  direct: '🏨', phone: '📞', walk_in: '🚶', other: '📋',
};

const CANCEL_REASONS = [
  { value: 'customer_request', label: 'בקשת לקוח' },
  { value: 'no_availability',  label: 'אין זמינות' },
  { value: 'ota_cancellation', label: 'ביטול OTA' },
  { value: 'duplicate',        label: 'הזמנה כפולה' },
  { value: 'overbooking',      label: 'Overbooking' },
  { value: 'no_payment',       label: 'אין תשלום' },
  { value: 'other',            label: 'אחר' },
];

const CLEAN_STATUS_LABEL = {
  clean: 'נקי', dirty: 'מלוכלך', inspected: 'נבדק', out_of_order: 'OOO',
};
const CLEAN_STATUS_CLS = {
  clean: 'badge-clean', dirty: 'badge-dirty', inspected: 'badge-clean', out_of_order: 'badge-departure',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function nightsCount(arrival, departure) {
  if (!arrival || !departure) return 0;
  return Math.round((new Date(departure) - new Date(arrival)) / 86400000);
}

function InfoRow({ icon: Icon, label, value, mono, highlight, children }) {
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-surface-border last:border-0">
      <Icon size={13} className="text-ink-faint mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink-muted">{label}</div>
        {children
          ? <div className="mt-0.5">{children}</div>
          : <div className={`text-sm font-medium text-ink mt-0.5 ${mono ? 'font-mono' : ''} ${highlight ? 'text-brand font-bold' : ''}`}>
              {value ?? '—'}
            </div>
        }
      </div>
    </div>
  );
}

// ── Modify Form ────────────────────────────────────────────────────────────────
function ModifyForm({ res, propertyId, onSaved, onCancel }) {
  const [form, setForm] = useState({
    arrivalDate:         res.arrivalDate,
    departureDate:       res.departureDate,
    roomTypeId:          String(res.roomType?._id || res.roomType || ''),
    ratePerNight:        String(res.ratePerNight || ''),
    adults:              String(res.adults || 2),
    children:            String(res.children || 0),
    specialRequests:     res.specialRequests || '',
    internalNotes:       res.internalNotes || '',
    priceOverrideReason: '',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const { data: roomTypes } = useApi(() => propApi.roomTypes(propertyId), [propertyId]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const priceChanged = form.ratePerNight && Number(form.ratePerNight) !== res.ratePerNight;
  const n = nightsCount(form.arrivalDate, form.departureDate);

  async function save() {
    if (!form.arrivalDate || !form.departureDate) return setError('תאריכים חובה');
    if (form.arrivalDate >= form.departureDate) return setError('תאריך עזיבה חייב להיות אחרי הגעה');
    if (priceChanged && !form.priceOverrideReason.trim()) return setError('נדרשת סיבה לשינוי מחיר');
    setLoading(true); setError('');
    try {
      const updated = await resApi.update(String(res._id), {
        arrivalDate:         form.arrivalDate,
        departureDate:       form.departureDate,
        roomTypeId:          form.roomTypeId || undefined,
        ratePerNight:        form.ratePerNight ? Number(form.ratePerNight) : undefined,
        adults:              Number(form.adults) || 2,
        children:            Number(form.children) || 0,
        specialRequests:     form.specialRequests,
        internalNotes:       form.internalNotes,
        priceOverrideReason: form.priceOverrideReason || undefined,
      });
      onSaved(updated);
    } catch (e) { setError(e.message || 'שגיאה בשמירה'); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-surface-hover/40 border border-surface-border rounded-xl p-4 flex flex-col gap-3 mt-2">
      <div className="text-xs font-bold text-ink-secondary flex items-center gap-2">
        <Pencil size={11} /> שינוי הזמנה
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1">תאריך הגעה</label>
          <input type="date" className="input w-full text-sm" value={form.arrivalDate} onChange={e => set('arrivalDate', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1">תאריך עזיבה</label>
          <input type="date" className="input w-full text-sm" value={form.departureDate} min={form.arrivalDate} onChange={e => set('departureDate', e.target.value)} />
        </div>
      </div>
      {n > 0 && (
        <div className="text-xs text-brand font-semibold bg-brand/5 rounded-lg px-3 py-1.5">{n} לילות</div>
      )}
      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1">סוג חדר</label>
        <select className="select w-full text-sm" value={form.roomTypeId} onChange={e => set('roomTypeId', e.target.value)}>
          {(roomTypes || []).map(rt => (
            <option key={String(rt._id)} value={String(rt._id)}>{rt.name} — ₪{rt.baseRate}/לילה</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1">מחיר ללילה (₪)</label>
          <input type="number" className="input w-full text-sm" value={form.ratePerNight} onChange={e => set('ratePerNight', e.target.value)} min={0} />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1">מבוגרים</label>
          <input type="number" className="input w-full text-sm" value={form.adults} onChange={e => set('adults', e.target.value)} min={1} max={10} />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1">ילדים</label>
          <input type="number" className="input w-full text-sm" value={form.children} onChange={e => set('children', e.target.value)} min={0} max={8} />
        </div>
      </div>
      {priceChanged && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
          <label className="text-xs font-semibold text-amber-800 block mb-1">
            סיבה לשינוי מחיר <span className="text-red-500">*</span>
          </label>
          <input className="input w-full text-sm" placeholder="לדוגמה: תמחור מיוחד לאורח קבוע"
            value={form.priceOverrideReason} onChange={e => set('priceOverrideReason', e.target.value)} />
        </div>
      )}
      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1">בקשות מיוחדות</label>
        <input className="input w-full text-sm" placeholder="בקשות מיוחדות לאורח"
          value={form.specialRequests} onChange={e => set('specialRequests', e.target.value)} />
      </div>
      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1">הערות פנימיות</label>
        <textarea className="input w-full text-sm resize-none" rows={2} placeholder="הערות לצוות בלבד"
          value={form.internalNotes} onChange={e => set('internalNotes', e.target.value)} />
      </div>
      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm flex-1 justify-center" onClick={onCancel} disabled={loading}>ביטול</button>
        <button className="btn btn-primary btn-sm flex-1 justify-center gap-1" onClick={save} disabled={loading}>
          {loading ? <Spinner size={12} /> : <Save size={12} />} שמור שינויים
        </button>
      </div>
    </div>
  );
}

// ── Cancel Form ────────────────────────────────────────────────────────────────
function CancelForm({ onConfirm, onCancel, loading }) {
  const [reason, setReason] = useState('customer_request');
  const [note,   setNote]   = useState('');
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-3 mt-2">
      <div className="text-xs font-bold text-red-700 flex items-center gap-2">
        <XCircle size={12} /> ביטול הזמנה
      </div>
      <div>
        <label className="text-xs font-semibold text-red-800 block mb-1">סיבת ביטול</label>
        <select className="select w-full text-sm" value={reason} onChange={e => setReason(e.target.value)}>
          {CANCEL_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-semibold text-red-800 block mb-1">פירוט (רשות)</label>
        <input className="input w-full text-sm" placeholder="פירוט נוסף..." value={note} onChange={e => setNote(e.target.value)} />
      </div>
      <div className="text-xs text-red-700 bg-red-100 rounded-lg px-3 py-2">
        פעולה זו אינה הפיכה. הפוליו יישמר לאחר הביטול.
      </div>
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm flex-1 justify-center" onClick={onCancel} disabled={loading}>חזרה</button>
        <button className="btn btn-danger btn-sm flex-1 justify-center gap-1" onClick={() => onConfirm(reason, note)} disabled={loading}>
          {loading ? <Spinner size={12} /> : <XCircle size={12} />} אשר ביטול
        </button>
      </div>
    </div>
  );
}

// ── No-Show Confirm ────────────────────────────────────────────────────────────
function NoShowConfirm({ onConfirm, onCancel, loading }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col gap-3 mt-2">
      <div className="text-xs font-bold text-amber-800 flex items-center gap-2">
        <AlertTriangle size={12} /> סימון כ-No Show
      </div>
      <div className="text-xs text-amber-700">
        האורח לא הגיע למלון. הזמנה תסומן כ-No Show. ניתן לבצע חיוב לפי מדיניות הביטולים.
      </div>
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm flex-1 justify-center" onClick={onCancel} disabled={loading}>חזרה</button>
        <button className="btn btn-sm flex-1 justify-center gap-1" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}
          onClick={onConfirm} disabled={loading}>
          {loading ? <Spinner size={12} /> : null} אשר No Show
        </button>
      </div>
    </div>
  );
}

// ── Check-In Options ───────────────────────────────────────────────────────────
function CheckInOptions({ res, onConfirm, onCancel, loading }) {
  const isDirty = res.assignedRoom?.cleanStatus === 'dirty';
  const isUnassigned = !res.assignedRoom;
  const [override, setOverride] = useState(false);
  const canProceed = !isUnassigned && (!isDirty || override);

  return (
    <div className="bg-brand/5 border border-brand/20 rounded-xl p-4 flex flex-col gap-3 mt-2">
      <div className="text-xs font-bold text-brand flex items-center gap-2">
        <LogIn size={12} /> אישור צ'ק-אין
      </div>
      {isUnassigned && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <AlertCircle size={11} /> חדר לא מוקצה — יש לשבץ חדר לפני הצ'ק-אין
        </div>
      )}
      {!isUnassigned && isDirty && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-col gap-2">
          <div className="text-xs text-amber-800 font-semibold flex items-center gap-1.5">
            <AlertTriangle size={11} /> חדר {res.assignedRoom.number} אינו נקי
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-3.5 h-3.5 rounded" checked={override} onChange={e => setOverride(e.target.checked)} />
            <span className="text-xs text-amber-700">אשר צ'ק-אין בכל זאת (override)</span>
          </label>
        </div>
      )}
      {!isUnassigned && !isDirty && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <CheckCircle2 size={11} /> חדר {res.assignedRoom.number} — {CLEAN_STATUS_LABEL[res.assignedRoom.cleanStatus] || 'נקי'} ✓
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm flex-1 justify-center" onClick={onCancel} disabled={loading}>ביטול</button>
        <button className="btn btn-primary btn-sm flex-1 justify-center gap-1" onClick={() => onConfirm(override)} disabled={loading || !canProceed}>
          {loading ? <Spinner size={12} /> : <LogIn size={12} />} בצע צ'ק-אין
        </button>
      </div>
    </div>
  );
}

// ── Tab: Details ───────────────────────────────────────────────────────────────
function TabDetails({ res, propertyId, onRefresh }) {
  const [modifying,   setModifying]  = useState(false);
  const [cancelMode,  setCancelMode] = useState(false);
  const [noShowMode,  setNoShowMode] = useState(false);
  const [checkInMode, setCheckInMode]= useState(false);
  const [noteText,    setNoteText]   = useState('');
  const [addingNote,  setAddingNote] = useState(false);
  const [loading,     setLoading]    = useState(null);
  const { success, error: toastErr, toasts } = useToast();

  const n = nightsCount(res.arrivalDate, res.departureDate);
  const total = res.totalAmount ?? (res.ratePerNight * n);
  const isArrivalToday  = res.arrivalDate  === TODAY;
  const isDepartureToday = res.departureDate === TODAY;

  async function handleCancel(reason, note) {
    setLoading('cancel');
    try {
      const reasonLabel = CANCEL_REASONS.find(r => r.value === reason)?.label || reason;
      const reasonStr = note ? `${reasonLabel} — ${note}` : reasonLabel;
      await resApi.cancel(String(res._id), reasonStr);
      success('הזמנה בוטלה');
      setCancelMode(false);
      onRefresh();
    } catch (e) { toastErr(e.message); }
    finally { setLoading(null); }
  }

  async function handleNoShow() {
    setLoading('noShow');
    try {
      await resApi.noShow(String(res._id));
      success('סומן כ-No Show');
      setNoShowMode(false);
      onRefresh();
    } catch (e) { toastErr(e.message); }
    finally { setLoading(null); }
  }

  async function handleCheckIn(overrideClean) {
    setLoading('checkIn');
    try {
      await resApi.checkIn(String(res._id), overrideClean);
      success("צ'ק-אין בוצע!");
      setCheckInMode(false);
      onRefresh();
    } catch (e) { toastErr(e.message); }
    finally { setLoading(null); }
  }

  async function handleCheckOut() {
    setLoading('checkOut');
    try {
      await resApi.checkOut(String(res._id), false);
      success("צ'ק-אאוט בוצע!");
      onRefresh();
    } catch (e) { toastErr(e.message); }
    finally { setLoading(null); }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      const prev = res.internalNotes || '';
      const stamp = new Date().toLocaleDateString('he-IL');
      await resApi.update(String(res._id), {
        internalNotes: prev ? `${prev}\n[${stamp}] ${noteText}` : `[${stamp}] ${noteText}`,
      });
      setNoteText('');
      success('הערה נוספה');
      onRefresh();
    } catch (e) { toastErr(e.message); }
    finally { setAddingNote(false); }
  }

  const g = res.primaryGuest || {};
  const canModify   = ['confirmed', 'modified'].includes(res.status);
  const canCheckIn  = ['confirmed', 'modified'].includes(res.status);
  const canCheckOut = res.status === 'in_house';
  const canCancel   = ['confirmed', 'modified'].includes(res.status);
  const canNoShow   = ['confirmed', 'modified'].includes(res.status);

  return (
    <div className="flex flex-col gap-5 p-5">
      <ToastContainer toasts={toasts} />

      {/* Today alerts */}
      {isArrivalToday && res.status === 'confirmed' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2.5">
          <LogIn size={15} className="text-emerald-600 flex-shrink-0" />
          <div>
            <div className="text-xs font-bold text-emerald-700">הגעה היום!</div>
            <div className="text-xs text-emerald-600">האורח אמור להגיע היום</div>
          </div>
        </div>
      )}
      {isDepartureToday && res.status === 'in_house' && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-center gap-2.5">
          <LogOut size={15} className="text-orange-600 flex-shrink-0" />
          <div>
            <div className="text-xs font-bold text-orange-700">יציאה היום!</div>
            <div className="text-xs text-orange-600">האורח אמור לצאת היום</div>
          </div>
        </div>
      )}

      {/* Booking summary */}
      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <ClipboardList size={11} /> פרטי הזמנה
        </div>
        <div className="card p-0 overflow-hidden divide-y divide-surface-border">
          <InfoRow icon={Calendar} label="הגעה"         value={res.arrivalDate}   mono />
          <InfoRow icon={Calendar} label="עזיבה"        value={res.departureDate} mono />
          <InfoRow icon={Clock}    label="לילות"         value={`${n} לילות`}      highlight />
          <InfoRow icon={BedDouble} label="סוג חדר"     value={res.roomType?.name} />
          <InfoRow icon={Home} label="חדר מוקצה">
            {res.assignedRoom
              ? <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="font-bold text-ink">חדר {res.assignedRoom.number}</span>
                  <span className={`badge ${CLEAN_STATUS_CLS[res.assignedRoom.cleanStatus] || 'badge-pending'} text-[10px]`}>
                    {CLEAN_STATUS_LABEL[res.assignedRoom.cleanStatus] || '—'}
                  </span>
                  {res.assignedRoom.floor && <span className="text-xs text-ink-muted">קומה {res.assignedRoom.floor}</span>}
                </div>
              : <span className="text-xs text-red-500 font-medium flex items-center gap-1 mt-0.5">
                  <AlertCircle size={10} /> ללא הקצאה
                </span>
            }
          </InfoRow>
          <InfoRow icon={Users} label="אורחים" value={`${res.adults || 2} מבוגרים${res.children ? ` · ${res.children} ילדים` : ''}`} />
          <InfoRow icon={Hash} label="מקור" value={`${SOURCE_FLAGS[res.source] || '📋'} ${res.source || 'direct'}`} />
          {res.ratePlan && <InfoRow icon={CreditCard} label="תכנית תמחור" value={res.ratePlan?.name || res.ratePlan?.code || '—'} />}
        </div>
      </section>

      {/* Financial */}
      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <CreditCard size={11} /> פיננסי
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-ink-muted">₪{Number(res.ratePerNight || 0).toLocaleString()} × {n} לילות</span>
            {res.priceOverrideReason && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                שינוי מחיר
              </span>
            )}
          </div>
          <div className="flex items-end justify-between gap-2">
            <span className="text-2xl font-black text-brand text-num">₪{Number(total || 0).toLocaleString()}</span>
            <div className="flex flex-col items-end gap-1">
              {(() => {
                const pc = PAY_CONFIG[res.paymentStatus] || PAY_CONFIG.pending;
                const Icon = pc.icon;
                return <span className={`badge ${pc.cls} flex items-center gap-1`}><Icon size={9} />{pc.label}</span>;
              })()}
              {res.priceOverrideReason && <div className="text-xs text-ink-faint italic">{res.priceOverrideReason}</div>}
            </div>
          </div>
        </div>
      </section>

      {/* Guest */}
      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <UserCheck size={11} /> אורח
        </div>
        <div className="card p-0 overflow-hidden divide-y divide-surface-border">
          {g.email    && <InfoRow icon={Mail}  label="אימייל" value={g.email} />}
          {g.phone    && <InfoRow icon={Phone} label="טלפון"  value={g.phone} />}
          {g.country  && <InfoRow icon={Globe} label="מדינה"  value={g.country} />}
          {(g.vipLevel || 0) > 0 && (
            <InfoRow icon={Crown} label="VIP">
              <span className="badge badge-pending flex items-center gap-1 mt-0.5 w-fit">
                <Crown size={9} className="text-yellow-500" /> VIP Level {g.vipLevel}
              </span>
            </InfoRow>
          )}
          {g.loyaltyId   && <InfoRow icon={Hash}           label="Loyalty ID"  value={g.loyaltyId}   mono />}
          {g.preferences && <InfoRow icon={MessageSquare}  label="העדפות"      value={g.preferences} />}
          {g.allergies && (
            <div className="flex items-start gap-2.5 p-2.5 bg-red-50/60">
              <AlertTriangle size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-xs text-red-600 font-semibold">אלרגיות</div>
                <div className="text-xs text-red-700 mt-0.5">{g.allergies}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Special Requests */}
      {res.specialRequests && (
        <section>
          <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
            <MessageSquare size={11} /> בקשות מיוחדות
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            📌 {res.specialRequests}
          </div>
        </section>
      )}

      {/* Internal Notes */}
      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <ClipboardList size={11} /> הערות פנימיות
        </div>
        {res.internalNotes
          ? <div className="text-xs text-ink-muted bg-surface-hover rounded-xl px-4 py-3 whitespace-pre-line mb-2">{res.internalNotes}</div>
          : <div className="text-xs text-ink-faint italic mb-2">אין הערות פנימיות</div>
        }
        <div className="flex gap-2">
          <input className="input text-xs flex-1" placeholder="הוסף הערה פנימית..."
            value={noteText} onChange={e => setNoteText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); } }} />
          <button className="btn btn-secondary btn-sm gap-1" onClick={addNote} disabled={addingNote || !noteText.trim()}>
            {addingNote ? <Spinner size={12} /> : <Plus size={12} />}
          </button>
        </div>
      </section>

      {/* Modify form */}
      {canModify && !modifying && !cancelMode && !noShowMode && !checkInMode && (
        <button className="btn btn-secondary btn-sm gap-1.5 self-start" onClick={() => setModifying(true)}>
          <Pencil size={12} /> שנה הזמנה
        </button>
      )}
      {modifying && (
        <ModifyForm res={res} propertyId={propertyId}
          onSaved={() => { setModifying(false); onRefresh(); }}
          onCancel={() => setModifying(false)} />
      )}

      {/* Cancel flow */}
      {cancelMode && (
        <CancelForm onConfirm={handleCancel} onCancel={() => setCancelMode(false)} loading={loading === 'cancel'} />
      )}

      {/* No-show flow */}
      {noShowMode && (
        <NoShowConfirm onConfirm={handleNoShow} onCancel={() => setNoShowMode(false)} loading={loading === 'noShow'} />
      )}

      {/* Check-in flow */}
      {checkInMode && (
        <CheckInOptions res={res} onConfirm={handleCheckIn} onCancel={() => setCheckInMode(false)} loading={loading === 'checkIn'} />
      )}

      {/* Action buttons */}
      {!cancelMode && !noShowMode && !checkInMode && !modifying && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-surface-border">
          {canCheckIn && (
            <button className="btn btn-primary btn-sm gap-1.5 flex-1 justify-center" onClick={() => setCheckInMode(true)}>
              <LogIn size={13} /> צ'ק-אין
            </button>
          )}
          {canCheckOut && (
            <button className="btn btn-sm gap-1.5 flex-1 justify-center"
              style={{ background: '#ea580c', color: '#fff', border: 'none' }}
              onClick={handleCheckOut} disabled={loading === 'checkOut'}>
              {loading === 'checkOut' ? <Spinner size={12} /> : <LogOut size={13} />} צ'ק-אאוט
            </button>
          )}
          {canCancel && (
            <button className="btn btn-sm gap-1.5 flex-1 justify-center"
              style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5' }}
              onClick={() => setCancelMode(true)}>
              <XCircle size={12} /> ביטול
            </button>
          )}
          {canNoShow && (
            <button className="btn btn-sm gap-1.5 flex-1 justify-center"
              style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047' }}
              onClick={() => setNoShowMode(true)}>
              No Show
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab: Room Assignment ───────────────────────────────────────────────────────
function TabRoom({ res, propertyId, onRefresh }) {
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [assigning,      setAssigning]      = useState(false);
  const { success, error: toastErr, toasts } = useToast();

  const { data: allRooms, loading: roomsLoading } = useApi(
    () => roomsApi.list(propertyId, { limit: 200 }),
    [propertyId]
  );

  const resRtId = String(res.roomType?._id || res.roomType || '');
  const compatibleRooms = (allRooms || []).filter(r =>
    !resRtId || String(r.roomType?._id || r.roomType || '') === resRtId
  );
  const cleanAvailable = compatibleRooms.filter(r =>
    r.opsStatus === 'available' && (r.cleanStatus === 'clean' || r.cleanStatus === 'inspected')
  );
  const dirtyAvailable = compatibleRooms.filter(r =>
    r.opsStatus === 'available' && r.cleanStatus === 'dirty'
  );

  async function assignRoom() {
    if (!selectedRoomId) return;
    setAssigning(true);
    try {
      await resApi.assignRoom(String(res._id), selectedRoomId);
      success('חדר שובץ בהצלחה');
      setSelectedRoomId('');
      onRefresh();
    } catch (e) { toastErr(e.message); }
    finally { setAssigning(false); }
  }

  const current  = res.assignedRoom;
  const cleanCls = CLEAN_STATUS_CLS[current?.cleanStatus] || 'badge-pending';
  const cleanLbl = CLEAN_STATUS_LABEL[current?.cleanStatus] || '—';

  return (
    <div className="flex flex-col gap-5 p-5">
      <ToastContainer toasts={toasts} />

      {/* Current assignment */}
      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <Home size={11} /> חדר נוכחי
        </div>
        {current
          ? (
            <div className="card p-4 flex items-center gap-4">
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BedDouble size={22} className="text-brand" />
              </div>
              <div className="flex-1">
                <div className="font-black text-2xl text-num text-ink">חדר {current.number}</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`badge ${cleanCls}`}>{cleanLbl}</span>
                  {current.floor && <span className="text-xs text-ink-muted">קומה {current.floor}</span>}
                  {res.roomType?.name && <span className="text-xs text-ink-secondary">{res.roomType.name}</span>}
                </div>
              </div>
            </div>
          )
          : (
            <div className="card p-4 flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.03)', borderColor: '#fca5a5' }}>
              <AlertCircle size={20} className="text-red-400" />
              <div>
                <div className="text-sm font-semibold text-red-700">ללא הקצאת חדר</div>
                <div className="text-xs text-red-500 mt-0.5">יש לשבץ חדר לפני הצ'ק-אין</div>
              </div>
            </div>
          )
        }
      </section>

      {/* Room selector */}
      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <RefreshCw size={11} /> {current ? 'שינוי חדר' : 'שיבוץ חדר'}
        </div>
        {roomsLoading
          ? <div className="flex justify-center py-6"><Spinner size={20} /></div>
          : (
            <div className="flex flex-col gap-2">
              <select className="select w-full text-sm" value={selectedRoomId} onChange={e => setSelectedRoomId(e.target.value)}>
                <option value="">בחר חדר...</option>
                {cleanAvailable.length > 0 && (
                  <optgroup label={`זמין ונקי (${cleanAvailable.length})`}>
                    {cleanAvailable.map(r => (
                      <option key={String(r._id)} value={String(r._id)}>
                        חדר {r.number} — {r.roomType?.name} — קומה {r.floor} — {CLEAN_STATUS_LABEL[r.cleanStatus]}
                      </option>
                    ))}
                  </optgroup>
                )}
                {dirtyAvailable.length > 0 && (
                  <optgroup label={`זמין (לא נקי) (${dirtyAvailable.length})`}>
                    {dirtyAvailable.map(r => (
                      <option key={String(r._id)} value={String(r._id)}>
                        חדר {r.number} — {r.roomType?.name} — קומה {r.floor} — מלוכלך
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button className="btn btn-primary btn-sm gap-1.5 justify-center"
                onClick={assignRoom} disabled={!selectedRoomId || assigning}>
                {assigning ? <Spinner size={12} /> : <CheckCircle2 size={12} />}
                {current ? 'שנה שיבוץ' : 'שבץ חדר'}
              </button>
            </div>
          )
        }
      </section>

      {/* Availability summary */}
      {allRooms && (
        <section>
          <div className="text-xs font-bold text-ink-secondary mb-2">סיכום זמינות מלון</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'זמין נקי',   count: (allRooms||[]).filter(r => r.opsStatus==='available' && (r.cleanStatus==='clean'||r.cleanStatus==='inspected')).length, color:'#059669' },
              { label: 'זמין מלוכלך', count: (allRooms||[]).filter(r => r.opsStatus==='available' && r.cleanStatus==='dirty').length, color:'#d97706' },
              { label: 'חסום/OOO',   count: (allRooms||[]).filter(r => r.opsStatus!=='available').length, color:'#dc2626' },
            ].map(({ label, count, color }) => (
              <div key={label} className="card py-3 px-1">
                <div className="text-xl font-black text-num" style={{ color }}>{count}</div>
                <div className="text-xs text-ink-muted mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Tab: Communication ─────────────────────────────────────────────────────────
function TabComms({ res }) {
  const [loading,     setLoading]     = useState(null);
  const [linkResult,  setLinkResult]  = useState(null);
  const [linkCopied,  setLinkCopied]  = useState(false);
  const { success, error: toastErr, toasts } = useToast();

  async function sendWelcome() {
    setLoading('welcome');
    try {
      await resApi.sendWelcome(String(res._id));
      success('מייל ברוכים הבאים נשלח!');
    } catch (e) { toastErr(e.message); }
    finally { setLoading(null); }
  }

  async function getExpressLink() {
    setLoading('expressLink');
    try {
      const result = await resApi.expressCheckoutLink(String(res._id));
      setLinkResult(result?.link || String(result));
    } catch (e) { toastErr(e.message); }
    finally { setLoading(null); }
  }

  async function copyLink() {
    if (!linkResult) return;
    try {
      await navigator.clipboard.writeText(linkResult);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { toastErr('לא ניתן להעתיק'); }
  }

  const canSend = !!res.primaryGuest?.email;
  const isActive = ['confirmed', 'modified', 'in_house'].includes(res.status);
  const pc = PAY_CONFIG[res.paymentStatus] || PAY_CONFIG.pending;

  return (
    <div className="flex flex-col gap-4 p-5">
      <ToastContainer toasts={toasts} />

      {/* Welcome Email */}
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center flex-shrink-0">
            <Send size={18} className="text-brand" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-ink text-sm">מייל ברוכים הבאים</div>
            <div className="text-xs text-ink-muted mt-0.5 mb-3">
              שלח אישור הזמנה ופרטי הגעה ל{res.primaryGuest?.email || 'האורח'}
            </div>
            {!canSend && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2 flex items-center gap-1.5">
                <AlertTriangle size={10} /> אין כתובת אימייל בפרופיל האורח
              </div>
            )}
            <button className="btn btn-primary btn-sm gap-1.5"
              onClick={sendWelcome}
              disabled={!canSend || !isActive || loading === 'welcome'}>
              {loading === 'welcome' ? <Spinner size={12} /> : <Send size={12} />}
              {loading === 'welcome' ? 'שולח...' : 'שלח מייל'}
            </button>
          </div>
        </div>
      </div>

      {/* Express Checkout Link */}
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Link2 size={18} className="text-emerald-600" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-ink text-sm">Express Checkout</div>
            <div className="text-xs text-ink-muted mt-0.5 mb-3">
              קישור לצ'ק-אאוט עצמאי — אורח יוכל לשלם ולאשר יציאה ללא תור
            </div>
            {linkResult
              ? (
                <div className="flex flex-col gap-2">
                  <div className="bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-xs font-mono text-ink-secondary break-all">
                    {linkResult}
                  </div>
                  <button className="btn btn-secondary btn-sm gap-1.5" onClick={copyLink}>
                    {linkCopied ? <><CheckCircle2 size={12} className="text-emerald-500" /> הועתק!</> : <><Copy size={12} /> העתק קישור</>}
                  </button>
                </div>
              )
              : (
                <button className="btn btn-secondary btn-sm gap-1.5"
                  onClick={getExpressLink}
                  disabled={!isActive || loading === 'expressLink'}>
                  {loading === 'expressLink' ? <Spinner size={12} /> : <Link2 size={12} />}
                  {loading === 'expressLink' ? 'מפיק...' : 'הפק קישור'}
                </button>
              )
            }
          </div>
        </div>
      </div>

      {/* Folio status */}
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
            <CreditCard size={18} className="text-purple-600" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-ink text-sm">סטטוס פוליו</div>
            <div className="text-xs text-ink-muted mt-0.5 mb-2">
              תשלום נוכחי: <span style={{ color: pc.color }} className="font-bold">{pc.label}</span>
            </div>
            {res.paymentStatus === 'balance_due' && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <AlertCircle size={10} /> יש יתרה לגביה — פתח פוליו לביצוע תשלום
              </div>
            )}
            {res.paymentStatus === 'paid' && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <CheckCircle2 size={10} /> הפוליו שולם במלואו
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick summary */}
      <div>
        <div className="text-xs font-bold text-ink-secondary mb-2">סיכום להעברה</div>
        <div className="bg-surface-hover rounded-xl p-3 text-xs text-ink-secondary space-y-1 font-mono leading-relaxed">
          <div>מס' אישור: <span className="text-brand font-bold">{res.confirmationNumber}</span></div>
          <div>אורח: {res.primaryGuest?.firstName} {res.primaryGuest?.lastName}</div>
          <div>הגעה: {res.arrivalDate} | יציאה: {res.departureDate}</div>
          <div>חדר: {res.assignedRoom ? `חדר ${res.assignedRoom.number}` : 'טרם שובץ'}</div>
          <div>סה"כ: ₪{Number(res.totalAmount || res.ratePerNight || 0).toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

// ── Main Drawer ────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'details', label: 'פרטים',   icon: ClipboardList },
  { key: 'room',    label: 'חדר',     icon: BedDouble },
  { key: 'advanced', label: 'פעולות', icon: Sparkles },
  { key: 'comms',   label: 'תקשורת', icon: Send },
];

export default function ReservationDrawer({
  res: initialRes,
  reservationId,
  propertyId: propertyIdProp,
  onClose,
  onChanged,
  onUpdated,
  onFolio,
}) {
  const resId = String(initialRes?._id || reservationId || '');
  const [tab,     setTab]     = useState('details');

  const { data: freshRes, loading, error, refetch } = useApi(
    () => resApi.get(resId),
    [resId],
    !resId
  );

  const res = freshRes || initialRes;
  const propertyId = String(res?.property?._id || res?.property || propertyIdProp || '');

  const handleRefresh = useCallback(() => {
    refetch();
    onChanged?.();
    onUpdated?.();
  }, [refetch, onChanged, onUpdated]);

  if (!res) {
    return (
      <div className="fixed inset-0 z-50 flex" style={{ direction: 'rtl' }}>
        <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
        <div className="w-full max-w-xl bg-white flex flex-col shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
            <div className="text-sm font-semibold text-ink">טוען הזמנה...</div>
            <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="p-6 flex items-center justify-center">
            <Spinner size={18} />
          </div>
        </div>
      </div>
    );
  }

  const s = STATUS_CONFIG[res.status] || STATUS_CONFIG.confirmed;
  const n = nightsCount(res.arrivalDate, res.departureDate);
  const g = res.primaryGuest || {};
  const isVip = (g.vipLevel || 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex" style={{ direction: 'rtl' }}>
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-xl bg-white flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-surface-border bg-gradient-to-l from-brand/5 to-white flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`badge ${s.cls}`}>{s.label}</span>
              {PAY_CONFIG[res.paymentStatus] && (
                <span className={`badge ${PAY_CONFIG[res.paymentStatus].cls}`}>
                  {PAY_CONFIG[res.paymentStatus].label}
                </span>
              )}
              {isVip && (
                <span className="badge badge-pending flex items-center gap-0.5">
                  <Crown size={9} className="text-yellow-500" /> VIP
                </span>
              )}
            </div>
            <div className="font-black text-xl text-ink truncate">{g.firstName} {g.lastName}</div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="text-xs text-brand font-mono font-bold">{res.confirmationNumber}</span>
              <span className="text-xs text-ink-muted">{n} לילות · {res.arrivalDate} → {res.departureDate}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 mr-3">
            {loading && <Spinner size={14} />}
            <button className="btn btn-secondary btn-sm gap-1" onClick={onFolio}>
              <CreditCard size={12} /> פוליו
            </button>
            <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex border-b border-surface-border flex-shrink-0">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold border-b-2 transition-all ${
                tab === key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink-muted hover:text-ink hover:bg-surface-hover'
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'details' && <TabDetails res={res} propertyId={propertyId} onRefresh={handleRefresh} />}
          {tab === 'room'    && <TabRoom    res={res} propertyId={propertyId} onRefresh={handleRefresh} />}
          {tab === 'advanced' && <ReservationAdvancedTab res={res} propertyId={propertyId} onRefresh={handleRefresh} />}
          {tab === 'comms'   && <TabComms   res={res} />}
        </div>
      </div>
    </div>
  );
}
