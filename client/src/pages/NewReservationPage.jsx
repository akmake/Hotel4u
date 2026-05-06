import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Crown, UserCheck, Building2, CheckCircle2,
  AlertCircle, CreditCard, Banknote, Moon, Loader2, ShieldCheck,
  BedDouble, Calendar, X, ArrowRight, ArrowLeft, ChevronRight, Link2,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import {
  guests as guestApi, roomTypes as rtApi, reservations as resApi,
  rates as ratesApi, companies as companiesApi,
} from '../utils/api';
import { TODAY, addDays } from '../utils/date';

/* ─── utils ─────────────────────────────────────────────────────────────── */
function nights(a, d) {
  if (!a || !d) return 0;
  const diff = (new Date(d) - new Date(a)) / 86400000;
  return diff > 0 ? diff : 0;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ─── constants ─────────────────────────────────────────────────────────── */
const STEPS = [
  { id: 1, label: 'אורח',           desc: 'פרטי האורח',                  icon: Users },
  { id: 2, label: 'שהייה',          desc: 'תאריכים, חדר ותפוסה',          icon: BedDouble },
  { id: 3, label: 'תעריף ומקור',    desc: 'מחיר, מקור וקטגוריית שוק',    icon: Calendar },
  { id: 4, label: 'ערבות ומדיניות', desc: 'ערבות, ביטול והערות',           icon: ShieldCheck },
  { id: 5, label: 'אישור',           desc: 'סקירה ויצירת הזמנה',           icon: CheckCircle2 },
];

const SOURCES = [
  { value: 'direct',  label: 'ישיר',    icon: '🏨' },
  { value: 'booking', label: 'Booking', icon: '🔵' },
  { value: 'expedia', label: 'Expedia', icon: '🟡' },
  { value: 'agoda',   label: 'Agoda',   icon: '🔴' },
  { value: 'airbnb',  label: 'Airbnb',  icon: '🟠' },
  { value: 'phone',   label: 'טלפון',   icon: '📞' },
  { value: 'walk_in', label: 'Walk-in', icon: '🚶' },
  { value: 'other',   label: 'אחר',     icon: '🌐' },
];

const MARKET_SEGS = [
  { value: '',     label: '— ללא —' },
  { value: 'LEIS', label: 'פנאי (Leisure)' },
  { value: 'CORP', label: 'עסקים (Corporate)' },
  { value: 'GOVT', label: 'ממשלתי' },
  { value: 'TOUR', label: 'קבוצות' },
  { value: 'CONF', label: 'כנסים (Conference)' },
  { value: 'WALK', label: 'Walk-in' },
  { value: 'OTA',  label: 'OTA' },
  { value: 'PKGE', label: 'Package' },
];

const GUARANTEE_TYPES = [
  { value: 'none',              label: 'ללא ערבות',    Icon: ShieldCheck },
  { value: 'credit_card',       label: 'כרטיס אשראי', Icon: CreditCard  },
  { value: 'deposit',           label: 'מקדמה',        Icon: Banknote    },
  { value: 'company_guarantee', label: 'חשבון חברה',   Icon: Building2   },
];

const BOOKING_STATUSES = [
  { value: 'confirmed',       label: 'מאושר',        color: '#059669', bg: 'rgba(5,150,105,0.1)'  },
  { value: 'hold',            label: 'On Hold',      color: '#d97706', bg: 'rgba(217,119,6,0.1)'  },
  { value: 'pending_payment', label: 'ממתין תשלום',  color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
];

const CANCEL_POLICIES = [
  { value: 'flexible', label: 'גמישה',         sub: 'ביטול חינם עד 24 שעות לפני הגעה' },
  { value: 'moderate', label: 'מתונה',         sub: 'ביטול חינם עד 48 שעות לפני הגעה' },
  { value: 'strict',   label: 'קשיחה',         sub: 'לא ניתן לביטול — ללא החזר'        },
  { value: 'property', label: 'מדיניות המלון', sub: 'ראה תנאים בדף ההזמנה'            },
];

const TITLES = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof'];

/* ─── atom components ────────────────────────────────────────────────────── */
function SectionCard({ title, icon: Icon, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {title && (
        <div className="card-header">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-brand flex-shrink-0" />
            {Icon && <Icon size={13} className="text-brand" />}
            <span style={{ fontSize: 11, letterSpacing: '0.07em' }}
              className="font-bold text-ink uppercase tracking-wide">{title}</span>
          </div>
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
}

function Field({ label, children, required, hint }) {
  return (
    <div className="flex flex-col gap-1">
      <label style={{ fontSize: 11, letterSpacing: '0.05em' }}
        className="font-bold text-ink-secondary uppercase tracking-wide">
        {label}{required && <span className="text-red-400 mr-0.5"> *</span>}
      </label>
      {children}
      {hint && <div className="text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}

function Counter({ value, onChange, min = 0, max = 20, label }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {label && <div className="text-xs text-ink-muted font-semibold">{label}</div>}
      <div className="flex items-center gap-2">
        <button type="button"
          className="w-8 h-8 rounded-lg border border-surface-border bg-white flex items-center justify-center text-ink-secondary hover:bg-surface-hover transition-colors font-bold"
          onClick={() => onChange(Math.max(min, value - 1))}>–</button>
        <span className="text-num font-black w-8 text-center text-lg">{value}</span>
        <button type="button"
          className="w-8 h-8 rounded-lg border border-surface-border bg-white flex items-center justify-center text-ink-secondary hover:bg-surface-hover transition-colors font-bold"
          onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </div>
  );
}

function CompanySearch({ propertyId, value, onChange }) {
  const [q, setQ]             = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const data = await companiesApi.list(propertyId, { q });
        setResults(Array.isArray(data) ? data : []);
      } catch { setResults([]); }
      finally   { setLoading(false); }
    }, 300);
  }, [q, propertyId]);

  if (value) {
    return (
      <div className="input flex items-center gap-2 cursor-pointer" onClick={() => onChange(null)}>
        <Building2 size={13} className="text-ink-faint flex-shrink-0" />
        <span className="flex-1 text-sm">{value.name}</span>
        <X size={12} className="text-ink-faint" />
      </div>
    );
  }

  return (
    <div className="relative">
      <Building2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input className="input pr-8 w-full text-sm"
        placeholder="חיפוש חברה / Travel Agent..."
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off" />
      {open && (results.length > 0 || loading) && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-full bg-white rounded-xl z-20 max-h-48 overflow-y-auto"
            style={{ border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
            {loading && <div className="px-4 py-2 text-xs text-ink-muted">מחפש...</div>}
            {results.map(c => (
              <div key={String(c._id)}
                className="flex items-center gap-2 px-4 py-2.5 hover:bg-surface-hover cursor-pointer text-sm border-b border-surface-border last:border-b-0"
                onClick={() => { onChange(c); setOpen(false); setQ(''); }}>
                <Building2 size={12} className="text-ink-faint flex-shrink-0" />{c.name}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AvailBadge({ status, count }) {
  if (!status || status === 'loading') return (
    <span className="text-xs text-ink-muted flex items-center gap-1.5">
      <Loader2 size={11} className="animate-spin" />בודק זמינות...
    </span>
  );
  const cfg = {
    available:   { color: '#059669', bg: 'rgba(5,150,105,0.1)',  icon: CheckCircle2, text: `זמין — ${count} חדרים` },
    limited:     { color: '#d97706', bg: 'rgba(217,119,6,0.1)',  icon: AlertCircle,  text: `מוגבל — ${count} חדרים` },
    unavailable: { color: '#dc2626', bg: 'rgba(239,68,68,0.1)',  icon: AlertCircle,  text: 'אין זמינות' },
  }[status];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
      style={{ background: cfg.bg, color: cfg.color }}>
      <Icon size={11} />{cfg.text}
    </span>
  );
}

/* ─── main page ─────────────────────────────────────────────────────────── */
export default function NewReservationPage() {
  const navigate = useNavigate();
  const { propertyId } = useProperty();
  const { toasts, success: toastSuccess, error: toastError } = useToast();

  const [step, setStep] = useState(1);

  /* ── guest: form fields (always editable) */
  const [guestForm, setGuestForm] = useState({
    title: 'Mr', firstName: '', lastName: '', email: '', phone: '', nationality: '',
  });
  /* linked = existing guest accepted from suggestion. null = will create new */
  const [linkedGuest,   setLinkedGuest]   = useState(null);
  /* suggestion = candidate match found in background */
  const [suggestion,    setSuggestion]    = useState(null);
  const [suggLoading,   setSuggLoading]   = useState(false);
  const [suggDismissed, setSuggDismissed] = useState(false);

  /* stay */
  const [arrival,    setArrival]    = useState(TODAY);
  const [departure,  setDeparture]  = useState(addDays(TODAY, 1));
  const [roomTypeId, setRoomTypeId] = useState('');
  const [roomsCount, setRoomsCount] = useState(1);
  const [adults,     setAdults]     = useState(2);
  const [children,   setChildren]   = useState(0);
  const [rtypes,     setRtypes]     = useState([]);
  const [avail,      setAvail]      = useState(null);
  const [availCount, setAvailCount] = useState(0);
  const availTimer = useRef(null);

  /* rate */
  const [ratePlans,    setRatePlans]    = useState([]);
  const [ratePlanId,   setRatePlanId]   = useState('');
  const [ratePerNight, setRatePerNight] = useState('');
  const [rateOverride, setRateOverride] = useState(false);
  const [source,       setSource]       = useState('direct');
  const [marketSeg,    setMarketSeg]    = useState('');
  const [company,      setCompany]      = useState(null);
  const [channelResId, setChannelResId] = useState('');

  /* guarantee */
  const [guaranteeType, setGuaranteeType] = useState('none');
  const [ccLast4,       setCcLast4]       = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [bookingStatus, setBookingStatus] = useState('confirmed');
  const [holdExpiry,    setHoldExpiry]    = useState('');
  const [cancelPolicy,  setCancelPolicy]  = useState('flexible');

  /* notes */
  const [specialReqs,   setSpecialReqs]   = useState('');
  const [guestNotes,    setGuestNotes]    = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [isVip,         setIsVip]         = useState(false);

  /* submit */
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  /* ── load room types */
  useEffect(() => {
    if (!propertyId) return;
    rtApi.list(propertyId).then(data => {
      const rt = Array.isArray(data) ? data : [];
      setRtypes(rt);
      if (rt.length) setRoomTypeId(String(rt[0]._id));
    }).catch(() => {});
  }, [propertyId]);

  /* ── load rate plans */
  useEffect(() => {
    if (!propertyId) return;
    ratesApi.plans(propertyId).then(data => {
      setRatePlans(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, [propertyId]);

  /* ── background guest matching: search as you type ─────────────────────
     Fires when firstName+lastName >= 2 chars, email has @, or phone >= 7 chars
     Shows a suggestion banner — user accepts or dismisses.                   */
  const suggTimer = useRef(null);
  useEffect(() => {
    if (suggDismissed || linkedGuest) return;
    const { firstName, lastName, email, phone } = guestForm;
    const nameQ  = `${firstName} ${lastName}`.trim();
    const emailOk = email.includes('@') && email.length > 5;
    const phoneOk = phone.replace(/\D/g, '').length >= 7;
    if (nameQ.length < 2 && !emailOk && !phoneOk) { setSuggestion(null); return; }

    const q = emailOk ? email : phoneOk ? phone : nameQ;
    if (suggTimer.current) clearTimeout(suggTimer.current);
    setSuggLoading(true);
    suggTimer.current = setTimeout(async () => {
      try {
        const results = await guestApi.list(propertyId, { q });
        const list = Array.isArray(results) ? results : [];
        if (list.length > 0) {
          setSuggestion(list[0]);
        } else {
          setSuggestion(null);
        }
      } catch { setSuggestion(null); }
      finally   { setSuggLoading(false); }
    }, 500);
  }, [guestForm.firstName, guestForm.lastName, guestForm.email, guestForm.phone, suggDismissed, linkedGuest, propertyId]);

  /* ── availability */
  useEffect(() => {
    const n = nights(arrival, departure);
    if (!roomTypeId || n <= 0) { setAvail(null); return; }
    if (availTimer.current) clearTimeout(availTimer.current);
    setAvail('loading');
    availTimer.current = setTimeout(async () => {
      try {
        const r = await resApi.availability(propertyId, roomTypeId, arrival, departure);
        const cnt = r?.availableRooms?.length ?? 0;
        if (!r?.available)  { setAvail('unavailable'); setAvailCount(0);   }
        else if (cnt <= 2)  { setAvail(cnt === 0 ? 'unavailable' : 'limited'); setAvailCount(cnt); }
        else                { setAvail('available');   setAvailCount(cnt); }
      } catch { setAvail(null); }
    }, 600);
  }, [roomTypeId, arrival, departure, propertyId]);

  /* ── auto-fill rate */
  useEffect(() => {
    if (rateOverride || !roomTypeId) return;
    if (ratePlanId && nights(arrival, departure) > 0) {
      ratesApi.quote({ propertyId, roomTypeId, ratePlanId, arrivalDate: arrival, departureDate: departure })
        .then(d => { if (d?.ratePerNight) setRatePerNight(String(d.ratePerNight)); })
        .catch(() => {
          const rt = rtypes.find(r => String(r._id) === roomTypeId);
          if (rt?.baseRate) setRatePerNight(String(rt.baseRate));
        });
    } else {
      const rt = rtypes.find(r => String(r._id) === roomTypeId);
      if (rt?.baseRate) setRatePerNight(String(rt.baseRate));
    }
  }, [ratePlanId, roomTypeId, arrival, departure, rateOverride, rtypes, propertyId]);

  /* ── VIP from linked guest */
  useEffect(() => {
    if (linkedGuest?.vipLevel > 0) setIsVip(true);
  }, [linkedGuest]);

  /* ── derived */
  const n       = nights(arrival, departure);
  const total   = n * Number(ratePerNight || 0) * roomsCount;
  const selRt   = rtypes.find(t => String(t._id) === roomTypeId);
  const bStatus = BOOKING_STATUSES.find(s => s.value === bookingStatus);

  // Step 1 can proceed if we have at least first+last name
  const guestReady = guestForm.firstName.trim().length > 0 && guestForm.lastName.trim().length > 0;
  const canNext = { 1: guestReady, 2: n > 0 && !!roomTypeId, 3: Number(ratePerNight) > 0, 4: true }[step] ?? true;

  /* display name for summary (linked guest or form) */
  const displayName = linkedGuest
    ? `${linkedGuest.firstName} ${linkedGuest.lastName}`
    : `${guestForm.firstName} ${guestForm.lastName}`.trim() || null;

  /* accept suggestion → link and copy data into form */
  function acceptSuggestion() {
    const g = suggestion;
    setLinkedGuest(g);
    setGuestForm({
      title:       g.title       || 'Mr',
      firstName:   g.firstName   || '',
      lastName:    g.lastName    || '',
      email:       g.email       || '',
      phone:       g.phone       || '',
      nationality: g.nationality || '',
    });
    setSuggestion(null);
    setSuggDismissed(true);
  }

  function dismissSuggestion() {
    setSuggestion(null);
    setSuggDismissed(true);
  }

  function unlinkGuest() {
    setLinkedGuest(null);
    setSuggDismissed(false);
    setSuggestion(null);
  }

  /* change field handler — auto-unlinks if user edits after linking */
  function changeField(field, value) {
    if (linkedGuest) unlinkGuest();
    setGuestForm(f => ({ ...f, [field]: value }));
  }

  async function submit() {
    setError(''); setLoading(true);
    try {
      let primaryGuestId;
      if (linkedGuest) {
        primaryGuestId = String(linkedGuest._id);
      } else {
        const newG = await guestApi.create({ ...guestForm, propertyId });
        primaryGuestId = String(newG._id);
      }
      await resApi.create({
        propertyId,
        primaryGuestId,
        roomTypeId,
        arrivalDate:          arrival,
        departureDate:        departure,
        adults,
        children,
        roomsCount,
        ratePlanId:           ratePlanId    || undefined,
        ratePerNight:         Number(ratePerNight),
        source,
        marketSegment:        marketSeg     || undefined,
        companyId:            company ? String(company._id) : undefined,
        channelReservationId: channelResId  || undefined,
        guaranteeType,
        cancellationPolicy:   cancelPolicy,
        bookingStatus,
        holdExpiresAt:        bookingStatus === 'hold' && holdExpiry ? holdExpiry : undefined,
        specialRequests:      specialReqs   || undefined,
        guestNotes:           guestNotes    || undefined,
        internalNotes:        internalNotes || undefined,
        isVip,
        currency: 'ILS',
        language: 'he',
      });
      toastSuccess('ההזמנה נוצרה בהצלחה!');
      navigate('/pms/reservations');
    } catch (e) {
      setError(e.message || 'שגיאה ביצירת הזמנה');
      toastError(e.message || 'שגיאה ביצירת הזמנה');
    } finally {
      setLoading(false);
    }
  }

  /* ─── render ──────────────────────────────────────────────────────────── */
  return (
    <div className="animate-fade-in" style={{ direction: 'rtl', minHeight: '100%' }}>
      <ToastContainer toasts={toasts} />

      {/* ══ PAGE HEADER ═══════════════════════════════════════════════════ */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/pms/reservations')}
            className="btn btn-ghost btn-icon">
            <ChevronRight size={18} />
          </button>
          <div>
            <h1 className="page-title">הזמנה חדשה</h1>
            <p className="page-subtitle">
              {STEPS[step - 1]?.label} — {STEPS[step - 1]?.desc}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* step progress dots */}
          <div className="flex items-center gap-1.5">
            {STEPS.map(s => (
              <div key={s.id} className="flex items-center gap-1.5 cursor-pointer"
                onClick={() => step > s.id && setStep(s.id)}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{
                    background: step > s.id ? '#6366f1' : step === s.id ? '#6366f1' : '#e2e8f0',
                    color:      step >= s.id ? 'white' : '#94a3b8',
                  }}>
                  {step > s.id ? '✓' : s.id}
                </div>
                {s.id < STEPS.length && (
                  <div className="w-6 h-px" style={{ background: step > s.id ? '#6366f1' : '#e2e8f0' }} />
                )}
              </div>
            ))}
          </div>
          <button onClick={() => navigate('/pms/reservations')} className="btn btn-secondary">
            ביטול
          </button>
        </div>
      </div>

      {/* ══ BODY ═══════════════════════════════════════════════════════════ */}
      <div className="page-content">
        <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>

          {/* ── LEFT: Step nav ────────────────────────────────────────────── */}
          <div className="flex-shrink-0" style={{ width: 200 }}>
            <div className="card overflow-hidden sticky top-20">
              {STEPS.map(s => {
                const done    = step > s.id;
                const current = step === s.id;
                const Icon    = s.icon;
                return (
                  <button key={s.id}
                    onClick={() => done && setStep(s.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-right transition-all border-b border-surface-border last:border-b-0"
                    style={{
                      cursor:      done ? 'pointer' : 'default',
                      background:  current ? 'rgba(99,102,241,0.06)' : 'white',
                      borderRight: current ? '3px solid #6366f1' : '3px solid transparent',
                    }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: done || current ? '#6366f1' : '#f1f5f9',
                        color:      done || current ? 'white' : '#94a3b8',
                      }}>
                      {done ? '✓' : s.id}
                    </div>
                    <div className="flex-1 min-w-0 text-right">
                      <div className="text-xs font-bold truncate"
                        style={{ color: current ? '#6366f1' : done ? '#0f172a' : '#64748b' }}>
                        {s.label}
                      </div>
                      <div className="text-xs truncate" style={{ color: '#94a3b8', fontSize: 10 }}>
                        {s.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── CENTER: Form ──────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">

            {/* ════════════════════════════════════════════════════════════
                STEP 1 — Guest
                ════════════════════════════════════════════════════════════ */}
            {step === 1 && (
              <>
                {/* Linked guest banner */}
                {linkedGuest && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{ background: 'rgba(5,150,105,0.06)', border: '1.5px solid rgba(5,150,105,0.3)' }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}>
                      {linkedGuest.firstName?.[0]}{linkedGuest.lastName?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link2 size={12} style={{ color: '#059669' }} />
                        <span className="text-xs font-bold" style={{ color: '#059669' }}>מקושר לאורח קיים</span>
                        {linkedGuest.vipLevel > 0 && <Crown size={11} className="text-yellow-500" />}
                        {linkedGuest.totalStays > 0 && (
                          <span className="text-xs font-semibold" style={{ color: '#059669' }}>
                            · {linkedGuest.totalStays} שהיות קודמות
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">{linkedGuest.email || linkedGuest.phone}</div>
                    </div>
                    <button className="text-xs text-ink-muted hover:text-red-500 transition-colors px-2 py-1 rounded"
                      onClick={unlinkGuest}>ניתוק</button>
                  </div>
                )}

                {linkedGuest?.isBlacklisted && (
                  <div className="alert-banner alert-danger">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <strong>אורח ברשימה השחורה</strong> — נדרש אישור מנהל לפני יצירת ההזמנה
                  </div>
                )}

                <SectionCard title="פרטי האורח" icon={Users}>
                  <div className="flex flex-col gap-4">
                    {/* Row 1: title + first + last */}
                    <div className="grid gap-2" style={{ gridTemplateColumns: '80px 1fr 1fr' }}>
                      <Field label="פנייה">
                        <select className="select w-full text-sm" value={guestForm.title}
                          onChange={e => changeField('title', e.target.value)}>
                          {TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </Field>
                      <Field label="שם פרטי" required>
                        <input className="input text-sm" autoFocus
                          placeholder="לדוגמה: דוד"
                          value={guestForm.firstName}
                          onChange={e => changeField('firstName', e.target.value)} />
                      </Field>
                      <Field label="שם משפחה" required>
                        <input className="input text-sm"
                          placeholder="לדוגמה: כהן"
                          value={guestForm.lastName}
                          onChange={e => changeField('lastName', e.target.value)} />
                      </Field>
                    </div>

                    {/* Row 2: email + phone */}
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="אימייל">
                        <input className="input text-sm" type="email"
                          placeholder="david@example.com"
                          value={guestForm.email}
                          onChange={e => changeField('email', e.target.value)} />
                      </Field>
                      <Field label="טלפון">
                        <input className="input text-sm"
                          placeholder="050-0000000"
                          value={guestForm.phone}
                          onChange={e => changeField('phone', e.target.value)} />
                      </Field>
                    </div>

                    {/* Row 3: nationality */}
                    <Field label="לאום (אופציונלי)">
                      <input className="input text-sm"
                        placeholder="IL, US, UK..."
                        value={guestForm.nationality}
                        onChange={e => changeField('nationality', e.target.value)} />
                    </Field>

                    {/* Smart suggestion banner */}
                    {suggLoading && !suggestion && !linkedGuest && (
                      <div className="flex items-center gap-2 text-xs text-ink-muted py-1">
                        <Loader2 size={11} className="animate-spin" />מחפש התאמה...
                      </div>
                    )}

                    {suggestion && !linkedGuest && (
                      <div className="rounded-xl overflow-hidden"
                        style={{ border: '1.5px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.03)' }}>
                        <div className="px-4 py-2 flex items-center gap-2"
                          style={{ background: 'rgba(99,102,241,0.08)', borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
                          <UserCheck size={13} style={{ color: '#6366f1' }} />
                          <span className="text-xs font-bold" style={{ color: '#6366f1' }}>
                            זיהינו אורח שעשוי להתאים — האם זה הוא?
                          </span>
                        </div>
                        <div className="px-4 py-3 flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0"
                            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                            {suggestion.firstName?.[0]}{suggestion.lastName?.[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-sm text-ink">
                                {suggestion.firstName} {suggestion.lastName}
                              </span>
                              {suggestion.vipLevel > 0 && <Crown size={11} className="text-yellow-500" />}
                            </div>
                            <div className="text-xs text-ink-muted mt-0.5 flex gap-3 flex-wrap">
                              {suggestion.email && <span>{suggestion.email}</span>}
                              {suggestion.phone && <span>{suggestion.phone}</span>}
                              {suggestion.totalStays > 0 && (
                                <span className="text-brand font-semibold">{suggestion.totalStays} שהיות</span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button className="btn btn-primary btn-sm text-xs gap-1"
                              onClick={acceptSuggestion}>
                              <CheckCircle2 size={11} /> כן, זה הוא
                            </button>
                            <button className="btn btn-secondary btn-sm text-xs gap-1"
                              onClick={dismissSuggestion}>
                              <X size={11} /> לא, אורח חדש
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </SectionCard>
              </>
            )}

            {/* ════════════════════════════════════════════════════════════
                STEP 2 — Stay
                ════════════════════════════════════════════════════════════ */}
            {step === 2 && (
              <>
                <SectionCard title="תאריכי שהייה" icon={Calendar}>
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="תאריך הגעה" required>
                        <input type="date" className="input w-full" value={arrival} min={TODAY}
                          onChange={e => {
                            setArrival(e.target.value);
                            if (e.target.value >= departure) setDeparture(addDays(e.target.value, 1));
                          }} />
                      </Field>
                      <Field label="תאריך יציאה" required>
                        <input type="date" className="input w-full" value={departure}
                          min={arrival ? addDays(arrival, 1) : TODAY}
                          onChange={e => setDeparture(e.target.value)} />
                      </Field>
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-xl"
                      style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.07), rgba(99,102,241,0.02))', border: '1px solid rgba(99,102,241,0.15)' }}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                          <Moon size={18} className="text-brand" />
                        </div>
                        <div>
                          <div className="text-3xl font-black text-num text-brand">{n}</div>
                          <div className="text-xs text-ink-muted">לילות שהייה</div>
                        </div>
                      </div>
                      <AvailBadge status={avail} count={availCount} />
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="סוג חדר" icon={BedDouble}>
                  <div className="grid grid-cols-2 gap-3">
                    {rtypes.length === 0 && (
                      <div className="col-span-2 py-6 text-center text-sm text-ink-muted">
                        <Loader2 size={16} className="animate-spin inline ml-2" />טוען סוגי חדרים...
                      </div>
                    )}
                    {rtypes.map(rt => {
                      const sel = roomTypeId === String(rt._id);
                      return (
                        <button key={String(rt._id)} type="button"
                          onClick={() => setRoomTypeId(String(rt._id))}
                          className="flex flex-col gap-2 p-4 rounded-xl border text-right transition-all"
                          style={{
                            borderColor: sel ? '#6366f1' : '#e2e8f0',
                            background:  sel ? 'rgba(99,102,241,0.06)' : 'white',
                            boxShadow:   sel ? '0 0 0 2px rgba(99,102,241,0.2)' : '0 1px 3px rgba(0,0,0,0.05)',
                          }}>
                          <div className="flex items-center gap-2">
                            <BedDouble size={14} style={{ color: sel ? '#6366f1' : '#94a3b8' }} />
                            <span className="font-bold text-sm text-ink">{rt.name}</span>
                          </div>
                          <div className="text-xs text-ink-muted">{rt.code} · עד {rt.capacityMax || rt.capacityBase} אורחים</div>
                          <div className="text-base font-black text-num" style={{ color: '#6366f1' }}>
                            ₪{rt.baseRate?.toLocaleString()}/לילה
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard title="תפוסה" icon={Users}>
                  <div className="flex justify-around py-2">
                    <Counter value={roomsCount} onChange={setRoomsCount} min={1} max={10} label="חדרים" />
                    <div className="w-px bg-surface-border" />
                    <Counter value={adults} onChange={setAdults} min={1} max={12} label="מבוגרים" />
                    <div className="w-px bg-surface-border" />
                    <Counter value={children} onChange={setChildren} min={0} max={8} label="ילדים" />
                  </div>
                </SectionCard>
              </>
            )}

            {/* ════════════════════════════════════════════════════════════
                STEP 3 — Rate & Revenue
                ════════════════════════════════════════════════════════════ */}
            {step === 3 && (
              <>
                {ratePlans.length > 0 && (
                  <SectionCard title="מסלול תעריף">
                    <Field label="בחר מסלול">
                      <select className="select w-full" value={ratePlanId}
                        onChange={e => { setRatePlanId(e.target.value); setRateOverride(false); }}>
                        <option value="">— ללא מסלול —</option>
                        {ratePlans.map(p => (
                          <option key={String(p._id)} value={String(p._id)}>{p.name} ({p.code})</option>
                        ))}
                      </select>
                    </Field>
                  </SectionCard>
                )}

                <SectionCard title="תעריף ומחיר">
                  <div className="grid grid-cols-2 gap-6 items-start">
                    <Field label="תעריף ללילה (₪)" required>
                      <div className="relative">
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint font-bold">₪</span>
                        <input type="number" className="input w-full pr-7 text-num font-bold text-lg" min={0} step={1}
                          value={ratePerNight}
                          onChange={e => { setRatePerNight(e.target.value); setRateOverride(true); }} />
                      </div>
                      {rateOverride && (
                        <div className="text-xs text-amber-600 font-semibold mt-1">* תעריף ידני (override)</div>
                      )}
                    </Field>
                    <div className="card p-4 text-center" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.06), white)' }}>
                      <div className="text-xs text-ink-muted mb-1">סה"כ לשהייה</div>
                      <div className="text-3xl font-black text-num" style={{ color: '#6366f1' }}>
                        ₪{total.toLocaleString()}
                      </div>
                      <div className="text-xs text-ink-muted mt-1">{n} לילות × {roomsCount} חדרים</div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="מקור הזמנה">
                  <div className="flex flex-col gap-4">
                    <Field label="ערוץ מכירה">
                      <div className="flex flex-wrap gap-2">
                        {SOURCES.map(s => (
                          <button key={s.value} type="button" onClick={() => setSource(s.value)}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border transition-all"
                            style={{
                              borderColor: source === s.value ? '#6366f1' : '#e2e8f0',
                              background:  source === s.value ? 'rgba(99,102,241,0.08)' : 'white',
                              color:       source === s.value ? '#6366f1' : '#64748b',
                              boxShadow:   source === s.value ? '0 0 0 2px rgba(99,102,241,0.15)' : 'none',
                            }}>
                            <span>{s.icon}</span>{s.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="קטגוריית שוק">
                        <select className="select w-full" value={marketSeg} onChange={e => setMarketSeg(e.target.value)}>
                          {MARKET_SEGS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </Field>
                      {['booking', 'expedia', 'agoda', 'airbnb', 'other'].includes(source) && (
                        <Field label="Channel Res ID">
                          <input className="input text-sm text-num"
                            placeholder="מספר הזמנה בערוץ"
                            value={channelResId} onChange={e => setChannelResId(e.target.value)} />
                        </Field>
                      )}
                    </div>
                    <Field label="חברה / Travel Agent (אופציונלי)">
                      <CompanySearch propertyId={propertyId} value={company} onChange={setCompany} />
                    </Field>
                  </div>
                </SectionCard>
              </>
            )}

            {/* ════════════════════════════════════════════════════════════
                STEP 4 — Guarantee & Policy
                ════════════════════════════════════════════════════════════ */}
            {step === 4 && (
              <>
                <SectionCard title="סטטוס הזמנה" icon={CheckCircle2}>
                  <div className="flex gap-3">
                    {BOOKING_STATUSES.map(s => (
                      <button key={s.value} type="button" onClick={() => setBookingStatus(s.value)}
                        className="flex-1 py-3 rounded-xl text-sm font-bold border transition-all"
                        style={{
                          background:  bookingStatus === s.value ? s.bg : 'white',
                          borderColor: bookingStatus === s.value ? s.color : '#e2e8f0',
                          color:       bookingStatus === s.value ? s.color : '#64748b',
                          boxShadow:   bookingStatus === s.value ? `0 0 0 2px ${s.color}25` : 'none',
                        }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {bookingStatus === 'hold' && (
                    <div className="mt-3">
                      <Field label="תפוגת Hold" required>
                        <input type="datetime-local" className="input w-full text-sm"
                          value={holdExpiry} onChange={e => setHoldExpiry(e.target.value)} />
                      </Field>
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="ערבות להזמנה" icon={ShieldCheck}>
                  <div className="grid grid-cols-2 gap-3">
                    {GUARANTEE_TYPES.map(({ value, label, Icon }) => {
                      const sel = guaranteeType === value;
                      return (
                        <button key={value} type="button" onClick={() => setGuaranteeType(value)}
                          className="flex items-center gap-3 p-3 rounded-xl border text-right transition-all"
                          style={{
                            borderColor: sel ? '#6366f1' : '#e2e8f0',
                            background:  sel ? 'rgba(99,102,241,0.06)' : 'white',
                            color:       sel ? '#6366f1' : '#64748b',
                            boxShadow:   sel ? '0 0 0 2px rgba(99,102,241,0.15)' : 'none',
                          }}>
                          <Icon size={15} />
                          <span className="text-sm font-semibold">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {guaranteeType === 'credit_card' && (
                    <div className="mt-3">
                      <Field label="4 ספרות אחרונות">
                        <input className="input text-num w-32" maxLength={4} placeholder="XXXX"
                          value={ccLast4} onChange={e => setCcLast4(e.target.value.replace(/\D/g, ''))} />
                      </Field>
                    </div>
                  )}
                  {guaranteeType === 'deposit' && (
                    <div className="mt-3">
                      <Field label="סכום מקדמה (₪)">
                        <input type="number" className="input text-num w-48" min={0}
                          value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
                      </Field>
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="מדיניות ביטול">
                  <div className="flex flex-col gap-2">
                    {CANCEL_POLICIES.map(p => (
                      <label key={p.value}
                        className="flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all"
                        style={{
                          borderColor: cancelPolicy === p.value ? '#6366f1' : '#e2e8f0',
                          background:  cancelPolicy === p.value ? 'rgba(99,102,241,0.04)' : 'white',
                        }}>
                        <input type="radio" className="hidden" name="cancelPolicy"
                          checked={cancelPolicy === p.value} onChange={() => setCancelPolicy(p.value)} />
                        <div className="w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all"
                          style={{ borderColor: cancelPolicy === p.value ? '#6366f1' : '#cbd5e1', background: cancelPolicy === p.value ? '#6366f1' : 'white' }}>
                          {cancelPolicy === p.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <div>
                          <div className="font-semibold text-ink">{p.label}</div>
                          <div className="text-xs text-ink-muted">{p.sub}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="הערות ובקשות">
                  <div className="flex flex-col gap-4">
                    <Field label="בקשות מיוחדות (לאורח)"
                      hint="המידע יועבר לאורח באישור ההזמנה">
                      <textarea className="input w-full resize-none text-sm" rows={3}
                        placeholder="העדפות מיטה, קומה, בקשות מיוחדות..."
                        value={specialReqs} onChange={e => setSpecialReqs(e.target.value)} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="הערות אורח (לצוות)" hint="לא מוצג לאורח">
                        <textarea className="input w-full resize-none text-sm" rows={3}
                          placeholder="מידע על האורח לצוות..."
                          value={guestNotes} onChange={e => setGuestNotes(e.target.value)} />
                      </Field>
                      <Field label="הערות פנימיות" hint="סודי — לא מוצג לאורח">
                        <textarea className="input w-full resize-none text-sm" rows={3}
                          placeholder="הערות פנימיות..."
                          value={internalNotes} onChange={e => setInternalNotes(e.target.value)} />
                      </Field>
                    </div>
                    <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all"
                      style={{ borderColor: isVip ? '#f59e0b' : '#e2e8f0', background: isVip ? 'rgba(245,158,11,0.04)' : 'white' }}>
                      <input type="checkbox" className="hidden" checked={isVip} onChange={e => setIsVip(e.target.checked)} />
                      <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all"
                        style={{ background: isVip ? '#f59e0b' : '#e2e8f0' }}>
                        {isVip && <Crown size={11} style={{ color: 'white' }} />}
                      </div>
                      <div>
                        <div className="font-bold text-ink">סמן כ-VIP</div>
                        <div className="text-xs text-ink-muted">האורח יקבל טיפול מועדף</div>
                      </div>
                    </label>
                  </div>
                </SectionCard>
              </>
            )}

            {/* ════════════════════════════════════════════════════════════
                STEP 5 — Summary & Confirm
                ════════════════════════════════════════════════════════════ */}
            {step === 5 && (
              <>
                <SectionCard title="סקירת ההזמנה" icon={CheckCircle2}>
                  {/* Guest + status */}
                  <div className="flex items-center gap-4 p-4 rounded-xl mb-4"
                    style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-black flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                      {guestForm.firstName[0]}{guestForm.lastName[0]}
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-ink text-base flex items-center gap-2">
                        {guestForm.firstName} {guestForm.lastName}
                        {isVip && <Crown size={14} style={{ color: '#f59e0b' }} />}
                        {linkedGuest && (
                          <span className="text-xs font-normal px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(5,150,105,0.1)', color: '#059669' }}>
                            אורח קיים
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-ink-muted">{guestForm.email || guestForm.phone}</div>
                    </div>
                    <span className="badge font-bold"
                      style={{ background: bStatus?.bg, color: bStatus?.color, border: 'none', fontSize: 12 }}>
                      {bStatus?.label}
                    </span>
                  </div>

                  {/* Dates strip */}
                  <div className="grid grid-cols-3 rounded-xl overflow-hidden mb-4"
                    style={{ border: '1px solid #e2e8f0' }}>
                    {[
                      { label: 'הגעה',  val: fmtDate(arrival) },
                      { label: 'לילות', val: n, big: true },
                      { label: 'יציאה', val: fmtDate(departure) },
                    ].map(({ label, val, big }) => (
                      <div key={label} className="py-4 px-3 text-center border-l border-surface-border last:border-l-0">
                        <div className="text-xs text-ink-muted mb-1">{label}</div>
                        <div className={`font-black text-ink ${big ? 'text-3xl text-num' : 'text-sm'}`}
                          style={big ? { color: '#6366f1' } : {}}>
                          {val}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Details */}
                  <div className="flex flex-col gap-2.5">
                    {[
                      { label: 'סוג חדר',       val: selRt?.name },
                      { label: 'חדרים',          val: roomsCount > 1 ? `${roomsCount} חדרים` : null },
                      { label: 'אורחים',         val: `${adults} מבוגרים${children > 0 ? ` + ${children} ילדים` : ''}` },
                      { label: 'מסלול תעריף',    val: ratePlans.find(p => String(p._id) === ratePlanId)?.name },
                      { label: 'תעריף ללילה',    val: ratePerNight ? `₪${Number(ratePerNight).toLocaleString()}` : null, mono: true },
                      { label: 'מקור',           val: SOURCES.find(s => s.value === source)?.label },
                      { label: 'קטגוריית שוק',   val: MARKET_SEGS.find(m => m.value === marketSeg && m.value)?.label },
                      { label: 'חברה',           val: company?.name },
                      { label: 'Channel Res ID', val: channelResId || null },
                      { label: 'ערבות',          val: GUARANTEE_TYPES.find(g => g.value === guaranteeType)?.label },
                      { label: 'מדיניות ביטול',  val: CANCEL_POLICIES.find(p => p.value === cancelPolicy)?.label },
                    ].filter(r => r.val).map(({ label, val, mono }) => (
                      <div key={label} className="flex items-center justify-between py-2 border-b border-surface-border last:border-b-0">
                        <span className="text-sm text-ink-muted">{label}</span>
                        <span className={`text-sm font-semibold text-ink ${mono ? 'text-num' : ''}`}>{val}</span>
                      </div>
                    ))}
                  </div>

                  {/* Total */}
                  <div className="flex items-center justify-between mt-4 pt-4 border-t-2"
                    style={{ borderColor: '#6366f1' }}>
                    <div>
                      <div className="font-black text-ink text-base">סה"כ לשהייה</div>
                      <div className="text-xs text-ink-muted">כולל מע"מ 17%</div>
                    </div>
                    <div className="text-3xl font-black text-num" style={{ color: '#6366f1' }}>
                      ₪{total.toLocaleString()}
                    </div>
                  </div>
                </SectionCard>

                {(specialReqs || guestNotes || internalNotes) && (
                  <SectionCard title="הערות ובקשות">
                    <div className="flex flex-col gap-2">
                      {specialReqs   && <div className="text-sm"><span className="font-bold text-ink">בקשות: </span><span className="text-ink-muted">{specialReqs}</span></div>}
                      {guestNotes    && <div className="text-sm"><span className="font-bold text-ink">הערות אורח: </span><span className="text-ink-muted">{guestNotes}</span></div>}
                      {internalNotes && <div className="text-sm"><span className="font-bold text-ink">פנימי: </span><span className="text-ink-muted">{internalNotes}</span></div>}
                    </div>
                  </SectionCard>
                )}

                {error && (
                  <div className="alert-banner alert-danger">
                    <AlertCircle size={14} className="flex-shrink-0" />{error}
                  </div>
                )}
              </>
            )}

            {/* ─── Navigation buttons ─── */}
            <div className="flex items-center justify-between pt-2 pb-6">
              {step > 1
                ? <button className="btn btn-secondary gap-2" onClick={() => setStep(s => s - 1)}>
                    <ArrowRight size={15} /> חזרה
                  </button>
                : <div />
              }
              {step < STEPS.length ? (
                <button className="btn btn-primary gap-2 px-6" disabled={!canNext}
                  onClick={() => setStep(s => s + 1)}>
                  המשך <ArrowLeft size={15} />
                </button>
              ) : (
                <button className="btn btn-primary gap-2 px-8" onClick={submit} disabled={loading || !guestReady}>
                  {loading
                    ? <><Loader2 size={15} className="animate-spin" /> יוצר הזמנה...</>
                    : <><CheckCircle2 size={15} /> צור הזמנה</>}
                </button>
              )}
            </div>
          </div>

          {/* ── RIGHT: Live summary sidebar ───────────────────────────────── */}
          <div className="flex-shrink-0" style={{ width: 220 }}>
            <div className="card overflow-hidden sticky top-20">
              <div className="px-4 py-3 border-b border-surface-border"
                style={{ background: '#f8fafc' }}>
                <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide" style={{ fontSize: 10 }}>
                  סיכום שוטף
                </div>
              </div>
              <div className="p-4 flex flex-col gap-3">
                {/* Guest */}
                {displayName ? (
                  <div>
                    <div className="text-xs text-ink-muted mb-0.5">אורח</div>
                    <div className="text-sm font-bold text-ink flex items-center gap-1">
                      {displayName}
                      {isVip && <Crown size={11} style={{ color: '#f59e0b' }} />}
                      {linkedGuest && <Link2 size={10} style={{ color: '#059669' }} />}
                    </div>
                    {guestForm.email && <div className="text-xs text-ink-muted truncate">{guestForm.email}</div>}
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint italic">ממלא פרטי אורח...</div>
                )}

                <div className="h-px bg-surface-border" />

                {/* Dates */}
                <div>
                  <div className="text-xs text-ink-muted mb-1">תאריכים</div>
                  <div className="text-xs text-ink">{fmtDate(arrival)} ← {fmtDate(departure)}</div>
                  <div className="text-sm font-black text-num" style={{ color: '#6366f1' }}>{n} לילות</div>
                </div>

                {/* Room type */}
                {selRt && (
                  <>
                    <div className="h-px bg-surface-border" />
                    <div>
                      <div className="text-xs text-ink-muted mb-0.5">חדר</div>
                      <div className="text-sm font-semibold text-ink">{selRt.name}</div>
                      <div className="text-xs text-ink-muted">{roomsCount} חדר · {adults} מבוגרים{children > 0 ? ` + ${children} ילדים` : ''}</div>
                    </div>
                  </>
                )}

                {/* Rate */}
                {ratePerNight && (
                  <>
                    <div className="h-px bg-surface-border" />
                    <div>
                      <div className="text-xs text-ink-muted mb-0.5">תעריף</div>
                      <div className="text-sm font-black text-num">₪{Number(ratePerNight).toLocaleString()}/לילה</div>
                    </div>
                  </>
                )}

                {/* Source */}
                <div className="h-px bg-surface-border" />
                <div className="text-xs text-ink">
                  {SOURCES.find(s => s.value === source)?.icon}{' '}
                  {SOURCES.find(s => s.value === source)?.label}
                </div>

                {/* Total */}
                {total > 0 && (
                  <>
                    <div className="h-px bg-surface-border" />
                    <div className="p-3 rounded-xl text-center"
                      style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02))', border: '1px solid rgba(99,102,241,0.15)' }}>
                      <div className="text-xs text-ink-muted mb-1">סה"כ</div>
                      <div className="text-xl font-black text-num" style={{ color: '#6366f1' }}>
                        ₪{total.toLocaleString()}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
