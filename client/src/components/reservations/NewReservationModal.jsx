import { useState, useEffect, useRef } from 'react';
import {
  X, Search, Users, Crown, UserPlus, Building2,
  CheckCircle2, AlertCircle, CreditCard, Banknote,
  Moon, Loader2, ShieldCheck, BedDouble, Calendar,
} from 'lucide-react';
import {
  guests as guestApi,
  roomTypes as rtApi,
  reservations as resApi,
  rates as ratesApi,
  companies as companiesApi,
} from '../../utils/api';
import { TODAY, addDays } from '../../utils/date';

/* ─── utils ─────────────────────────────────────────────────────────────── */
function nights(a, d) {
  if (!a || !d) return 0;
  const diff = (new Date(d) - new Date(a)) / 86400000;
  return diff > 0 ? diff : 0;
}

/* ─── constants ─────────────────────────────────────────────────────────── */
const STEPS = [
  { id: 1, label: 'אורח',    short: '1' },
  { id: 2, label: 'שהייה',   short: '2' },
  { id: 3, label: 'תעריף',   short: '3' },
  { id: 4, label: 'ערבות',   short: '4' },
  { id: 5, label: 'אישור',   short: '5' },
];

const SOURCES = [
  { value: 'direct',   label: 'ישיר',    icon: '🏨' },
  { value: 'booking',  label: 'Booking', icon: '🔵' },
  { value: 'expedia',  label: 'Expedia', icon: '🟡' },
  { value: 'agoda',    label: 'Agoda',   icon: '🔴' },
  { value: 'airbnb',   label: 'Airbnb',  icon: '🟠' },
  { value: 'phone',    label: 'טלפון',   icon: '📞' },
  { value: 'walk_in',  label: 'Walk-in', icon: '🚶' },
  { value: 'other',    label: 'אחר',     icon: '🌐' },
];

const MARKET_SEGS = [
  { value: '',     label: '— ללא —' },
  { value: 'LEIS', label: 'פנאי (Leisure)' },
  { value: 'CORP', label: 'עסקים (Corporate)' },
  { value: 'GOVT', label: 'ממשלתי (Government)' },
  { value: 'TOUR', label: 'קבוצות (Tour Group)' },
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
  { value: 'confirmed',       label: 'מאושר',         color: '#059669', bg: 'rgba(5,150,105,0.1)'  },
  { value: 'hold',            label: 'On Hold',       color: '#d97706', bg: 'rgba(217,119,6,0.1)'   },
  { value: 'pending_payment', label: 'ממתין תשלום',   color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
];

const CANCEL_POLICIES = [
  { value: 'flexible',  label: 'גמישה',    sub: 'ביטול חינם עד 24 שעות לפני הגעה' },
  { value: 'moderate',  label: 'מתונה',    sub: 'ביטול חינם עד 48 שעות לפני הגעה' },
  { value: 'strict',    label: 'קשיחה',    sub: 'לא ניתן לביטול — ללא החזר'        },
  { value: 'property',  label: 'מדיניות המלון', sub: 'ראה תנאים בדף ההזמנה'       },
];

const TITLES = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof'];

/* ─── sub-components ─────────────────────────────────────────────────────── */
function Field({ label, children, required }) {
  return (
    <div className="flex flex-col gap-1">
      <label style={{ fontSize: 11, letterSpacing: '0.05em' }}
        className="font-bold text-ink-secondary uppercase tracking-wide">
        {label}{required && <span className="text-red-400 mr-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function SectionTitle({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-4 rounded-full bg-brand flex-shrink-0" />
      {Icon && <Icon size={13} className="text-brand" />}
      <span style={{ fontSize: 11, letterSpacing: '0.07em' }}
        className="font-bold text-ink uppercase tracking-wide">{title}</span>
    </div>
  );
}

function Counter({ value, onChange, min = 0, max = 20, label }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {label && <div className="text-xs text-ink-muted font-semibold">{label}</div>}
      <div className="flex items-center gap-1">
        <button type="button"
          className="w-7 h-7 rounded-lg border border-surface-border bg-white flex items-center justify-center text-ink-secondary hover:bg-surface-hover transition-colors text-sm font-bold"
          onClick={() => onChange(Math.max(min, value - 1))}>–</button>
        <span className="text-num font-black w-8 text-center text-base">{value}</span>
        <button type="button"
          className="w-7 h-7 rounded-lg border border-surface-border bg-white flex items-center justify-center text-ink-secondary hover:bg-surface-hover transition-colors text-sm font-bold"
          onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </div>
  );
}

function GuestSearch({ propertyId, value, onChange }) {
  const [q,       setQ]       = useState('');
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const data = await guestApi.list(propertyId, { q });
        setResults(Array.isArray(data) ? data : []);
      } catch { setResults([]); }
      finally   { setLoading(false); }
    }, 300);
  }, [q, propertyId]);

  if (value && !value._new) {
    return (
      <div className="border border-brand/40 rounded-xl p-3 bg-brand/5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-brand/15 flex items-center justify-center text-brand font-black text-sm flex-shrink-0">
          {value.firstName?.[0]}{value.lastName?.[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-ink">{value.firstName} {value.lastName}</span>
            {value.vipLevel > 0 && <Crown size={12} className="text-yellow-500" />}
            {value.isBlacklisted && <AlertCircle size={12} className="text-red-500" />}
          </div>
          <div className="text-xs text-ink-muted flex gap-3 flex-wrap mt-0.5">
            {value.email && <span>{value.email}</span>}
            {value.phone && <span>{value.phone}</span>}
            {value.totalStays > 0 && (
              <span className="text-brand font-semibold">{value.totalStays} שהיות</span>
            )}
          </div>
        </div>
        <button className="btn btn-ghost btn-icon flex-shrink-0" onClick={() => onChange(null)}>
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
      <input
        className="input pr-8 w-full"
        placeholder="חיפוש לפי שם, אימייל, טלפון..."
        value={q}
        autoFocus
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-full bg-white border border-surface-border rounded-xl shadow-card-hover z-20 max-h-56 overflow-y-auto">
            {loading && (
              <div className="px-4 py-3 text-xs text-ink-muted flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" />מחפש...
              </div>
            )}
            {!loading && q.trim() && results.length === 0 && (
              <div className="px-4 py-3 text-xs text-ink-muted">לא נמצאו אורחים</div>
            )}
            {results.map(g => (
              <div key={String(g._id)}
                className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-hover cursor-pointer transition-colors"
                onClick={() => { onChange(g); setOpen(false); setQ(''); }}>
                <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center text-brand text-xs font-bold flex-shrink-0">
                  {g.firstName?.[0]}{g.lastName?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-sm text-ink">{g.firstName} {g.lastName}</span>
                    {g.vipLevel > 0 && <Crown size={10} className="text-yellow-500" />}
                  </div>
                  <div className="text-xs text-ink-muted truncate">
                    {g.email} · {g.totalStays || 0} שהיות
                  </div>
                </div>
              </div>
            ))}
            <div className="border-t border-surface-border">
              <button
                className="flex items-center gap-2 w-full px-3 py-2.5 text-brand text-xs font-semibold hover:bg-brand/5 transition-colors"
                onClick={() => { setOpen(false); onChange({ _new: true }); }}>
                <UserPlus size={13} /> + צור אורח חדש
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CompanySearch({ propertyId, value, onChange }) {
  const [q,       setQ]       = useState('');
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
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
          <div className="absolute right-0 top-full mt-1 w-full bg-white border border-surface-border rounded-xl shadow-card-hover z-20 max-h-40 overflow-y-auto">
            {loading && <div className="px-4 py-2 text-xs text-ink-muted">מחפש...</div>}
            {results.map(c => (
              <div key={String(c._id)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-surface-hover cursor-pointer text-sm"
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
  if (status === 'available') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ background: 'rgba(5,150,105,0.1)', color: '#059669' }}>
      <CheckCircle2 size={11} />זמין — {count} חדרים
    </span>
  );
  if (status === 'limited') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ background: 'rgba(217,119,6,0.1)', color: '#d97706' }}>
      <AlertCircle size={11} />מוגבל — {count} חדרים
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626' }}>
      <AlertCircle size={11} />אין זמינות
    </span>
  );
}

/* ─── main component ─────────────────────────────────────────────────────── */
export default function NewReservationModal({ propertyId, onClose, onCreated }) {
  const [step, setStep] = useState(1);

  /* guest */
  const [guest,     setGuest]    = useState(null);
  const [newGuest,  setNewGuest] = useState({ title: 'Mr', firstName: '', lastName: '', email: '', phone: '', nationality: '' });
  const [creatingG, setCreatingG] = useState(false);
  const [guestErr,  setGuestErr]  = useState('');

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
    rtApi.list(propertyId).then(data => {
      const rt = Array.isArray(data) ? data : [];
      setRtypes(rt);
      if (rt.length) setRoomTypeId(String(rt[0]._id));
    }).catch(() => {});
  }, [propertyId]);

  /* ── load rate plans */
  useEffect(() => {
    ratesApi.plans(propertyId).then(data => {
      setRatePlans(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, [propertyId]);

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

  /* ── VIP auto-detect */
  useEffect(() => {
    if (guest && !guest._new && guest.vipLevel > 0) setIsVip(true);
  }, [guest]);

  /* ── derived */
  const n     = nights(arrival, departure);
  const total = n * Number(ratePerNight || 0) * roomsCount;
  const selRt = rtypes.find(t => String(t._id) === roomTypeId);
  const canNext = {
    1: !!guest && !guest._new,
    2: n > 0 && !!roomTypeId,
    3: Number(ratePerNight) > 0,
    4: true,
    5: true,
  }[step] ?? true;

  async function createNewGuest() {
    if (!newGuest.firstName || !newGuest.lastName) {
      setGuestErr('שם פרטי ושם משפחה נדרשים');
      return;
    }
    setGuestErr(''); setCreatingG(true);
    try {
      const g = await guestApi.create({ ...newGuest, propertyId });
      setGuest(g);
    } catch (e) { setGuestErr(e.message || 'שגיאה ביצירת אורח'); }
    finally     { setCreatingG(false); }
  }

  async function submit() {
    setError(''); setLoading(true);
    try {
      const res = await resApi.create({
        propertyId,
        primaryGuestId:       String(guest._id),
        roomTypeId,
        arrivalDate:          arrival,
        departureDate:        departure,
        adults,
        children,
        roomsCount,
        ratePlanId:           ratePlanId   || undefined,
        ratePerNight:         Number(ratePerNight),
        source,
        marketSegment:        marketSeg    || undefined,
        companyId:            company ? String(company._id) : undefined,
        channelReservationId: channelResId || undefined,
        guaranteeType,
        cancellationPolicy:   cancelPolicy,
        bookingStatus,
        holdExpiresAt:        bookingStatus === 'hold' && holdExpiry ? holdExpiry : undefined,
        specialRequests:      specialReqs  || undefined,
        guestNotes:           guestNotes   || undefined,
        internalNotes:        internalNotes|| undefined,
        isVip,
        currency: 'ILS',
        language: 'he',
      });
      onCreated?.(res);
      onClose();
    } catch (e) {
      setError(e.message || 'שגיאה ביצירת הזמנה');
      setStep(5);
    } finally {
      setLoading(false);
    }
  }

  /* ── render ─────────────────────────────────────────────────────────────── */
  const bStatus = BOOKING_STATUSES.find(s => s.value === bookingStatus);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(6px)', direction: 'rtl' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col"
        style={{ maxHeight: '92vh', overflow: 'hidden' }}>

        {/* ══ HEADER ══════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #1e2840 0%, #0f172a 100%)', borderRadius: '16px 16px 0 0' }}>
          <div className="w-9 h-9 rounded-xl bg-brand/20 flex items-center justify-center flex-shrink-0">
            <BedDouble size={18} style={{ color: '#818cf8' }} />
          </div>
          <div className="flex-1">
            <div className="font-bold text-white text-base">הזמנה חדשה</div>
            <div className="text-xs" style={{ color: '#94a3b8' }}>
              {STEPS[step - 1]?.label} · שלב {step} מתוך {STEPS.length}
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#94a3b8' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}>
            <X size={15} />
          </button>
        </div>

        {/* ══ STEP BAR ════════════════════════════════════════════════════ */}
        <div className="flex flex-shrink-0" style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          {STEPS.map((s, i) => {
            const done    = step > s.id;
            const current = step === s.id;
            return (
              <button key={s.id}
                className="flex-1 flex flex-col items-center gap-1.5 py-3 transition-all relative"
                style={{ cursor: done ? 'pointer' : 'default' }}
                onClick={() => done && setStep(s.id)}>
                {/* connector line */}
                {i < STEPS.length - 1 && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 h-px w-1/2"
                    style={{ background: step > s.id + 1 ? '#6366f1' : '#e2e8f0' }} />
                )}
                {i > 0 && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 h-px w-1/2"
                    style={{ background: done ? '#6366f1' : '#e2e8f0' }} />
                )}
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black z-10 transition-all"
                  style={{
                    background: done ? '#6366f1' : current ? '#6366f1' : 'white',
                    color:      done || current ? 'white' : '#94a3b8',
                    border:     done || current ? 'none' : '2px solid #e2e8f0',
                    boxShadow:  current ? '0 0 0 3px rgba(99,102,241,0.15)' : 'none',
                  }}>
                  {done ? '✓' : s.id}
                </div>
                <span className="text-xs font-semibold"
                  style={{ color: current ? '#6366f1' : done ? '#6366f1' : '#94a3b8' }}>
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* ══ BODY ════════════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Step 1: Guest ── */}
          {step === 1 && (
            <div className="flex flex-col gap-5">
              <SectionTitle icon={Users} title="פרטי האורח" />

              <Field label="חיפוש אורח" required>
                <GuestSearch propertyId={propertyId}
                  value={guest?._new ? null : guest}
                  onChange={g => { setGuest(g); setGuestErr(''); }} />
              </Field>

              {/* New guest form */}
              {guest?._new && (
                <div className="rounded-xl border border-brand/30 bg-brand/5 p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <UserPlus size={13} className="text-brand" />
                    <span className="text-xs font-bold text-brand">יצירת אורח חדש</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <select className="select col-span-1 text-sm" value={newGuest.title}
                      onChange={e => setNewGuest(g => ({ ...g, title: e.target.value }))}>
                      {TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input className="input col-span-2 text-sm" placeholder="שם פרטי *"
                      value={newGuest.firstName}
                      onChange={e => setNewGuest(g => ({ ...g, firstName: e.target.value }))} />
                    <input className="input col-span-2 text-sm" placeholder="שם משפחה *"
                      value={newGuest.lastName}
                      onChange={e => setNewGuest(g => ({ ...g, lastName: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input text-sm" type="email" placeholder="אימייל"
                      value={newGuest.email}
                      onChange={e => setNewGuest(g => ({ ...g, email: e.target.value }))} />
                    <input className="input text-sm" placeholder="טלפון"
                      value={newGuest.phone}
                      onChange={e => setNewGuest(g => ({ ...g, phone: e.target.value }))} />
                  </div>
                  <input className="input text-sm" placeholder="לאום (אופציונלי)"
                    value={newGuest.nationality}
                    onChange={e => setNewGuest(g => ({ ...g, nationality: e.target.value }))} />
                  {guestErr && <div className="text-xs text-red-600">{guestErr}</div>}
                  <div className="flex gap-2">
                    <button className="btn btn-primary btn-sm gap-1.5"
                      disabled={creatingG || !newGuest.firstName || !newGuest.lastName}
                      onClick={createNewGuest}>
                      {creatingG ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                      {creatingG ? 'יוצר...' : 'צור אורח'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setGuest(null)}>ביטול</button>
                  </div>
                </div>
              )}

              {/* Alerts */}
              {guest && !guest._new && guest.isBlacklisted && (
                <div className="alert-banner alert-danger">
                  <AlertCircle size={14} className="flex-shrink-0" />
                  <div><strong>אורח ברשימה השחורה</strong> — נדרש אישור מנהל לפני יצירת ההזמנה</div>
                </div>
              )}
              {guest && !guest._new && guest.vipLevel > 0 && (
                <div className="alert-banner alert-warning">
                  <Crown size={14} className="flex-shrink-0" />
                  <div>אורח VIP דרגה {guest.vipLevel} — יש לוודא העדפות ובקשות מיוחדות</div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Stay ── */}
          {step === 2 && (
            <div className="flex flex-col gap-5">
              <SectionTitle icon={Calendar} title="פרטי השהייה" />

              <div className="grid grid-cols-2 gap-3">
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

              {/* nights + availability strip */}
              <div className="flex items-center justify-between p-4 rounded-xl"
                style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(99,102,241,0.02) 100%)', border: '1px solid rgba(99,102,241,0.15)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                    <Moon size={16} className="text-brand" />
                  </div>
                  <div>
                    <div className="text-3xl font-black text-num text-brand leading-none">{n}</div>
                    <div className="text-xs text-ink-muted mt-0.5">לילות</div>
                  </div>
                </div>
                <AvailBadge status={avail} count={availCount} />
              </div>

              <Field label="סוג חדר" required>
                <div className="grid grid-cols-2 gap-2">
                  {rtypes.length === 0 && (
                    <div className="col-span-2 text-xs text-ink-muted text-center py-4">
                      <Loader2 size={14} className="animate-spin inline ml-1" />טוען סוגי חדרים...
                    </div>
                  )}
                  {rtypes.map(rt => {
                    const sel = roomTypeId === String(rt._id);
                    return (
                      <button key={String(rt._id)} type="button"
                        onClick={() => setRoomTypeId(String(rt._id))}
                        className="flex flex-col gap-1 p-3 rounded-xl border text-right transition-all"
                        style={{
                          borderColor: sel ? '#6366f1' : '#e2e8f0',
                          background:  sel ? 'rgba(99,102,241,0.06)' : 'white',
                          boxShadow:   sel ? '0 0 0 2px rgba(99,102,241,0.2)' : 'none',
                        }}>
                        <div className="flex items-center gap-2">
                          <BedDouble size={13} style={{ color: sel ? '#6366f1' : '#94a3b8' }} />
                          <span className="font-bold text-sm text-ink">{rt.name}</span>
                        </div>
                        <div className="text-xs text-ink-muted">{rt.code} · עד {rt.capacityMax || rt.capacityBase} אורחים</div>
                        <div className="text-sm font-black text-num" style={{ color: '#6366f1' }}>
                          ₪{rt.baseRate?.toLocaleString()}/לילה
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* occupancy */}
              <div className="card p-4">
                <div className="text-xs font-bold text-ink-secondary uppercase tracking-wide mb-3"
                  style={{ fontSize: 10, letterSpacing: '0.07em' }}>תפוסה</div>
                <div className="flex justify-around">
                  <Counter value={roomsCount} onChange={setRoomsCount} min={1} max={10} label="חדרים" />
                  <div style={{ width: 1, background: '#e2e8f0' }} />
                  <Counter value={adults} onChange={setAdults} min={1} max={12} label="מבוגרים" />
                  <div style={{ width: 1, background: '#e2e8f0' }} />
                  <Counter value={children} onChange={setChildren} min={0} max={8} label="ילדים" />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Rate & Revenue ── */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              <SectionTitle title="תעריף ומקור הזמנה" />

              {ratePlans.length > 0 && (
                <Field label="מסלול תעריף">
                  <select className="select w-full" value={ratePlanId}
                    onChange={e => { setRatePlanId(e.target.value); setRateOverride(false); }}>
                    <option value="">— ללא מסלול —</option>
                    {ratePlans.map(p => (
                      <option key={String(p._id)} value={String(p._id)}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3 items-end">
                <Field label="תעריף ללילה (₪)" required>
                  <div className="relative">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm font-bold">₪</span>
                    <input type="number" className="input w-full pr-7 text-num font-bold" min={0} step={1}
                      value={ratePerNight}
                      onChange={e => { setRatePerNight(e.target.value); setRateOverride(true); }} />
                  </div>
                  {rateOverride && (
                    <div className="text-xs text-amber-600 font-semibold">* תעריף ידני</div>
                  )}
                </Field>
                <div className="card p-3 text-center">
                  <div className="text-xs text-ink-muted mb-1">סה"כ לשהייה</div>
                  <div className="text-2xl font-black text-num" style={{ color: '#6366f1' }}>
                    ₪{total.toLocaleString()}
                  </div>
                  <div className="text-xs text-ink-muted">{n} לילות × {roomsCount} חדרים</div>
                </div>
              </div>

              <Field label="מקור הזמנה">
                <div className="flex flex-wrap gap-1.5">
                  {SOURCES.map(s => (
                    <button key={s.value} type="button" onClick={() => setSource(s.value)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                      style={{
                        borderColor: source === s.value ? '#6366f1' : '#e2e8f0',
                        background:  source === s.value ? 'rgba(99,102,241,0.08)' : 'white',
                        color:       source === s.value ? '#6366f1' : '#64748b',
                      }}>
                      <span>{s.icon}</span>{s.label}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="קטגוריית שוק">
                  <select className="select w-full" value={marketSeg}
                    onChange={e => setMarketSeg(e.target.value)}>
                    {MARKET_SEGS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </Field>
                {['booking', 'expedia', 'agoda', 'airbnb', 'other'].includes(source) && (
                  <Field label="Channel Res ID">
                    <input className="input text-sm text-num" placeholder="מספר הזמנה בערוץ"
                      value={channelResId} onChange={e => setChannelResId(e.target.value)} />
                  </Field>
                )}
              </div>

              <Field label="חברה / Travel Agent (אופציונלי)">
                <CompanySearch propertyId={propertyId} value={company} onChange={setCompany} />
              </Field>
            </div>
          )}

          {/* ── Step 4: Guarantee & Policy ── */}
          {step === 4 && (
            <div className="flex flex-col gap-5">
              <SectionTitle icon={ShieldCheck} title="ערבות ומדיניות" />

              <Field label="סטטוס הזמנה">
                <div className="flex gap-2">
                  {BOOKING_STATUSES.map(s => (
                    <button key={s.value} type="button" onClick={() => setBookingStatus(s.value)}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all"
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
              </Field>

              {bookingStatus === 'hold' && (
                <Field label="תפוגת Hold" required>
                  <input type="datetime-local" className="input w-full text-sm"
                    value={holdExpiry} onChange={e => setHoldExpiry(e.target.value)} />
                </Field>
              )}

              <Field label="סוג ערבות">
                <div className="grid grid-cols-2 gap-2">
                  {GUARANTEE_TYPES.map(({ value, label, Icon }) => {
                    const sel = guaranteeType === value;
                    return (
                      <button key={value} type="button" onClick={() => setGuaranteeType(value)}
                        className="flex items-center gap-2.5 p-3 rounded-xl border text-right transition-all"
                        style={{
                          borderColor: sel ? '#6366f1' : '#e2e8f0',
                          background:  sel ? 'rgba(99,102,241,0.06)' : 'white',
                          color:       sel ? '#6366f1' : '#64748b',
                        }}>
                        <Icon size={14} />
                        <span className="text-xs font-semibold">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {guaranteeType === 'credit_card' && (
                <Field label="4 ספרות אחרונות של הכרטיס">
                  <input className="input text-num w-28" maxLength={4} placeholder="XXXX"
                    value={ccLast4} onChange={e => setCcLast4(e.target.value.replace(/\D/g, ''))} />
                </Field>
              )}
              {guaranteeType === 'deposit' && (
                <Field label="סכום מקדמה (₪)">
                  <input type="number" className="input text-num w-40" min={0}
                    value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
                </Field>
              )}

              <Field label="מדיניות ביטול">
                <div className="flex flex-col gap-1.5">
                  {CANCEL_POLICIES.map(p => (
                    <label key={p.value}
                      className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all"
                      style={{
                        borderColor: cancelPolicy === p.value ? '#6366f1' : '#e2e8f0',
                        background:  cancelPolicy === p.value ? 'rgba(99,102,241,0.04)' : 'white',
                      }}>
                      <input type="radio" name="cancelPolicy" className="hidden"
                        checked={cancelPolicy === p.value}
                        onChange={() => setCancelPolicy(p.value)} />
                      <div className="w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all"
                        style={{
                          borderColor: cancelPolicy === p.value ? '#6366f1' : '#cbd5e1',
                          background:  cancelPolicy === p.value ? '#6366f1' : 'white',
                        }}>
                        {cancelPolicy === p.value && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-ink">{p.label}</div>
                        <div className="text-xs text-ink-muted">{p.sub}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="בקשות מיוחדות (לאורח)">
                <textarea className="input w-full resize-none text-sm" rows={2}
                  placeholder="העדפות מיטה, קומה, בקשות מיוחדות שיועברו לאורח..."
                  value={specialReqs} onChange={e => setSpecialReqs(e.target.value)} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="הערות אורח (לצוות)">
                  <textarea className="input w-full resize-none text-sm" rows={2}
                    placeholder="מידע על האורח לצוות..."
                    value={guestNotes} onChange={e => setGuestNotes(e.target.value)} />
                </Field>
                <Field label="הערות פנימיות">
                  <textarea className="input w-full resize-none text-sm" rows={2}
                    placeholder="הערות לא יוצגו לאורח..."
                    value={internalNotes} onChange={e => setInternalNotes(e.target.value)} />
                </Field>
              </div>

              {/* VIP toggle */}
              <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all"
                style={{
                  borderColor: isVip ? '#f59e0b' : '#e2e8f0',
                  background:  isVip ? 'rgba(245,158,11,0.05)' : 'white',
                }}>
                <input type="checkbox" className="hidden" checked={isVip}
                  onChange={e => setIsVip(e.target.checked)} />
                <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all"
                  style={{ background: isVip ? '#f59e0b' : '#e2e8f0' }}>
                  {isVip && <Crown size={11} style={{ color: 'white' }} />}
                </div>
                <div>
                  <div className="text-sm font-bold text-ink">סמן כ-VIP</div>
                  <div className="text-xs text-ink-muted">האורח יקבל טיפול מועדף בלוח הקבלה</div>
                </div>
              </label>
            </div>
          )}

          {/* ── Step 5: Summary ── */}
          {step === 5 && (
            <div className="flex flex-col gap-4">
              <SectionTitle icon={CheckCircle2} title="אישור פרטי ההזמנה" />

              {/* Guest + status card */}
              <div className="card overflow-hidden">
                <div className="flex items-center gap-3 p-4 border-b border-surface-border"
                  style={{ background: '#fafbfc' }}>
                  <div className="w-10 h-10 rounded-full bg-brand/15 flex items-center justify-center text-brand font-black flex-shrink-0">
                    {guest?.firstName?.[0]}{guest?.lastName?.[0]}
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-ink flex items-center gap-1.5">
                      {guest?.firstName} {guest?.lastName}
                      {isVip && <Crown size={13} style={{ color: '#f59e0b' }} />}
                    </div>
                    <div className="text-xs text-ink-muted">{guest?.email || guest?.phone}</div>
                  </div>
                  <span className="badge text-xs font-bold"
                    style={{ background: bStatus?.bg, color: bStatus?.color, border: 'none' }}>
                    {bStatus?.label}
                  </span>
                </div>

                {/* Dates strip */}
                <div className="grid grid-cols-3 border-b border-surface-border text-center">
                  {[
                    { label: 'הגעה',  val: new Date(arrival  + 'T00:00:00').toLocaleDateString('he-IL') },
                    { label: 'לילות', val: n,   big: true },
                    { label: 'יציאה', val: new Date(departure + 'T00:00:00').toLocaleDateString('he-IL') },
                  ].map(({ label, val, big }) => (
                    <div key={label} className="py-3 px-2 border-l border-surface-border last:border-l-0">
                      <div className="text-xs text-ink-muted mb-0.5">{label}</div>
                      <div className={`font-black text-ink ${big ? 'text-3xl text-num' : 'text-sm'}`}
                        style={big ? { color: '#6366f1' } : {}}>
                        {val}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Details */}
                <div className="p-4 flex flex-col gap-2">
                  {[
                    { label: 'סוג חדר',        val: selRt?.name },
                    { label: 'חדרים',           val: roomsCount > 1 ? `${roomsCount} חדרים` : null },
                    { label: 'אורחים',          val: `${adults} מבוגרים${children > 0 ? ` + ${children} ילדים` : ''}` },
                    { label: 'מסלול תעריף',     val: ratePlans.find(p => String(p._id) === ratePlanId)?.name },
                    { label: 'תעריף ללילה',     val: ratePerNight ? `₪${Number(ratePerNight).toLocaleString()}` : null, mono: true },
                    { label: 'מקור',            val: SOURCES.find(s => s.value === source)?.label },
                    { label: 'קטגוריית שוק',    val: MARKET_SEGS.find(m => m.value === marketSeg)?.label },
                    { label: 'חברה',            val: company?.name },
                    { label: 'Channel Res ID',  val: channelResId || null },
                    { label: 'ערבות',           val: GUARANTEE_TYPES.find(g => g.value === guaranteeType)?.label },
                    { label: 'מדיניות ביטול',   val: CANCEL_POLICIES.find(p => p.value === cancelPolicy)?.label },
                  ].filter(r => r.val).map(({ label, val, mono }) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-ink-muted">{label}</span>
                      <span className={`font-semibold text-ink ${mono ? 'text-num' : ''}`}>{val}</span>
                    </div>
                  ))}
                </div>

                {/* Total */}
                <div className="flex items-center justify-between px-4 py-3 border-t-2"
                  style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}>
                  <div>
                    <div className="font-bold text-ink">סה"כ לשהייה</div>
                    <div className="text-xs text-ink-muted">כולל מע"מ 17%</div>
                  </div>
                  <div className="text-2xl font-black text-num" style={{ color: '#6366f1' }}>
                    ₪{total.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Notes preview */}
              {(specialReqs || guestNotes || internalNotes) && (
                <div className="card p-3 flex flex-col gap-2">
                  {specialReqs   && <div className="text-xs"><span className="font-bold text-ink">בקשות: </span><span className="text-ink-muted">{specialReqs}</span></div>}
                  {guestNotes    && <div className="text-xs"><span className="font-bold text-ink">הערות: </span><span className="text-ink-muted">{guestNotes}</span></div>}
                  {internalNotes && <div className="text-xs"><span className="font-bold text-ink">פנימי: </span><span className="text-ink-muted">{internalNotes}</span></div>}
                </div>
              )}

              {error && (
                <div className="alert-banner alert-danger">
                  <AlertCircle size={14} className="flex-shrink-0" />{error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ══ FOOTER ══════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
          {step > 1
            ? <button className="btn btn-secondary gap-1" onClick={() => setStep(s => s - 1)}>← חזרה</button>
            : <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          }

          {/* progress mini */}
          <div className="flex-1 flex gap-1">
            {STEPS.map(s => (
              <div key={s.id} className="flex-1 h-1 rounded-full transition-all"
                style={{ background: step >= s.id ? '#6366f1' : '#e2e8f0' }} />
            ))}
          </div>

          {step < STEPS.length ? (
            <button className="btn btn-primary gap-1" disabled={!canNext}
              onClick={() => setStep(s => s + 1)}>
              המשך ←
            </button>
          ) : (
            <button className="btn btn-primary gap-1.5 px-5" onClick={submit} disabled={loading}>
              {loading
                ? <><Loader2 size={14} className="animate-spin" /> יוצר...</>
                : <><CheckCircle2 size={14} /> צור הזמנה</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
