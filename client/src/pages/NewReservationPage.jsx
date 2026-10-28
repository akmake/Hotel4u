import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Crown, UserCheck, Building2, CheckCircle2,
  AlertCircle, Loader2, ChevronRight, X, Link2, ChevronDown, Plus, Trash2,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import {
  guests as guestApi, roomTypes as rtApi, reservations as resApi,
  rates as ratesApi, companies as companiesApi,
} from '../utils/api';
import { TODAY, addDays } from '../utils/date';
import { BackArrow } from '../components/kit';

function nights(a, d) {
  if (!a || !d) return 0;
  const diff = (new Date(d) - new Date(a)) / 86400000;
  return diff > 0 ? diff : 0;
}

const SOURCES = [
  { value: 'direct',    label: 'ישיר' },
  { value: 'booking',   label: 'Booking.com' },
  { value: 'expedia',   label: 'Expedia' },
  { value: 'agoda',     label: 'Agoda' },
  { value: 'airbnb',    label: 'Airbnb' },
  { value: 'phone',     label: 'טלפון' },
  { value: 'walk_in',   label: 'Walk-in' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'other',     label: 'אחר' },
];

const MARKET_SEGS = [
  { value: '',     label: '— ללא —' },
  { value: 'LEIS', label: 'Leisure' },
  { value: 'CORP', label: 'Corporate' },
  { value: 'GOVT', label: 'ממשלתי' },
  { value: 'TOUR', label: 'קבוצות' },
  { value: 'CONF', label: 'Conference' },
  { value: 'WALK', label: 'Walk-in' },
  { value: 'OTA',  label: 'OTA' },
  { value: 'PKGE', label: 'Package' },
];

const GUARANTEE_TYPES = [
  { value: 'none',              label: 'ללא ערבות' },
  { value: 'credit_card',       label: 'כרטיס אשראי' },
  { value: 'deposit',           label: 'מקדמה' },
  { value: 'company_guarantee', label: 'חשבון חברה' },
];

const CANCEL_POLICIES = [
  { value: 'flexible', label: 'גמישה — ביטול חינם עד 24 שעות' },
  { value: 'moderate', label: 'מתונה — ביטול חינם עד 48 שעות' },
  { value: 'strict',   label: 'קשיחה — ללא החזר' },
  { value: 'property', label: 'מדיניות המלון' },
];

const BOOKING_STATUSES = [
  { value: 'confirmed',       label: 'מאושר' },
  { value: 'hold',            label: 'On Hold' },
  { value: 'pending_payment', label: 'ממתין תשלום' },
];

const TITLES = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof'];

function newRoom(rtypes) {
  return {
    _key:        Math.random().toString(36).slice(2),
    roomTypeId:  rtypes?.[0] ? String(rtypes[0]._id) : '',
    adults:      2,
    children:    0,
    ratePerNight: rtypes?.[0]?.baseRate ? String(rtypes[0].baseRate) : '',
    rateOverride: false,
  };
}

function FormField({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 mr-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function SectionBox({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">{title}</span>
      </div>
      <div className="p-4">{children}</div>
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
        <Building2 size={13} className="text-gray-400 flex-shrink-0" />
        <span className="flex-1 text-sm">{value.name}</span>
        <X size={12} className="text-gray-400" />
      </div>
    );
  }

  return (
    <div className="relative">
      <Building2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input className="input pr-8 w-full text-sm"
        placeholder="חיפוש חברה / Travel Agent..."
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off" />
      {open && (results.length > 0 || loading) && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-lg z-20 max-h-48 overflow-y-auto shadow-md">
            {loading && <div className="px-4 py-2 text-xs text-gray-400">מחפש...</div>}
            {results.map(c => (
              <div key={String(c._id)}
                className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                onClick={() => { onChange(c); setOpen(false); setQ(''); }}>
                <Building2 size={12} className="text-gray-400 flex-shrink-0" />{c.name}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function NewReservationPage() {
  const navigate    = useNavigate();
  const { propertyId } = useProperty();
  const { toasts, success: toastSuccess, error: toastError } = useToast();

  // Guest
  const [guestForm, setGuestForm] = useState({
    title: 'Mr', firstName: '', lastName: '', email: '', phone: '', nationality: '',
  });
  const [linkedGuest,   setLinkedGuest]   = useState(null);
  const [suggestion,    setSuggestion]    = useState(null);
  const [suggLoading,   setSuggLoading]   = useState(false);
  const [suggDismissed, setSuggDismissed] = useState(false);

  // Stay — dates
  const [arrival,   setArrival]   = useState(TODAY);
  const [departure, setDeparture] = useState(addDays(TODAY, 1));

  // Rooms list
  const [rtypes, setRtypes] = useState([]);
  const [rooms,  setRooms]  = useState([]);   // populated after rtypes load

  // Rate plans
  const [ratePlans,  setRatePlans]  = useState([]);
  const [ratePlanId, setRatePlanId] = useState('');

  // Source & booking meta
  const [source,        setSource]        = useState('direct');
  const [marketSeg,     setMarketSeg]     = useState('');
  const [company,       setCompany]       = useState(null);
  const [channelResId,  setChannelResId]  = useState('');
  const [bookingStatus, setBookingStatus] = useState('confirmed');
  const [holdExpiry,    setHoldExpiry]    = useState('');

  // Advanced (collapsed)
  const [guaranteeType, setGuaranteeType] = useState('none');
  const [ccLast4,       setCcLast4]       = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [cancelPolicy,  setCancelPolicy]  = useState('flexible');
  const [specialReqs,   setSpecialReqs]   = useState('');
  const [guestNotes,    setGuestNotes]    = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [isVip,         setIsVip]         = useState(false);
  const [showAdvanced,  setShowAdvanced]  = useState(false);

  // Submit
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // Load room types → seed first room
  useEffect(() => {
    if (!propertyId) return;
    rtApi.list(propertyId).then(data => {
      const rt = Array.isArray(data) ? data : [];
      setRtypes(rt);
      setRooms([newRoom(rt)]);
    }).catch(() => {});
  }, [propertyId]);

  // Load rate plans
  useEffect(() => {
    if (!propertyId) return;
    ratesApi.plans(propertyId).then(data => {
      setRatePlans(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, [propertyId]);

  // Auto-fill rates when arrival/departure/ratePlan change
  const n = nights(arrival, departure);
  useEffect(() => {
    if (!propertyId || !n) return;
    setRooms(prev => prev.map(room => {
      if (room.rateOverride || !room.roomTypeId) return room;
      if (ratePlanId) {
        ratesApi.quote({ propertyId, roomTypeId: room.roomTypeId, ratePlanId, arrivalDate: arrival, departureDate: departure })
          .then(d => {
            if (d?.ratePerNight) {
              setRooms(cur => cur.map(r => r._key === room._key && !r.rateOverride
                ? { ...r, ratePerNight: String(d.ratePerNight) } : r));
            }
          }).catch(() => {});
        return room;
      }
      const rt = rtypes.find(r => String(r._id) === room.roomTypeId);
      if (rt?.baseRate) return { ...room, ratePerNight: String(rt.baseRate) };
      return room;
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratePlanId, arrival, departure, n, propertyId]);

  // Background guest suggestion
  const suggTimer = useRef(null);
  useEffect(() => {
    if (suggDismissed || linkedGuest) return;
    const { firstName, lastName, email, phone } = guestForm;
    const nameQ   = `${firstName} ${lastName}`.trim();
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
        setSuggestion(list.length > 0 ? list[0] : null);
      } catch { setSuggestion(null); }
      finally   { setSuggLoading(false); }
    }, 500);
  }, [guestForm.firstName, guestForm.lastName, guestForm.email, guestForm.phone, suggDismissed, linkedGuest, propertyId]);

  // VIP from linked guest
  useEffect(() => {
    if (linkedGuest?.vipLevel > 0) setIsVip(true);
  }, [linkedGuest]);

  // ── Room CRUD ────────────────────────────────────────────────────────────
  function addRoom() {
    setRooms(prev => [...prev, newRoom(rtypes)]);
  }

  function removeRoom(key) {
    setRooms(prev => prev.length > 1 ? prev.filter(r => r._key !== key) : prev);
  }

  function updateRoom(key, patch) {
    setRooms(prev => prev.map(r => {
      if (r._key !== key) return r;
      const updated = { ...r, ...patch };
      // auto-fill rate when room type changes (unless user already overrode)
      if (patch.roomTypeId && !r.rateOverride) {
        const rt = rtypes.find(x => String(x._id) === patch.roomTypeId);
        if (rt?.baseRate) updated.ratePerNight = String(rt.baseRate);
      }
      return updated;
    }));
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const guestOk  = guestForm.firstName.trim().length > 0 && guestForm.lastName.trim().length > 0;
  const roomsOk  = rooms.every(r => r.roomTypeId && Number(r.ratePerNight) > 0);
  const canSubmit = guestOk && n > 0 && roomsOk;

  const grandTotal = rooms.reduce((s, r) => s + Number(r.ratePerNight || 0) * n, 0);
  const totalAdults   = rooms.reduce((s, r) => s + (r.adults   || 0), 0);
  const totalChildren = rooms.reduce((s, r) => s + (r.children || 0), 0);

  // ── Guest helpers ─────────────────────────────────────────────────────────
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

  function changeField(field, value) {
    if (linkedGuest) { setLinkedGuest(null); setSuggDismissed(false); }
    setGuestForm(f => ({ ...f, [field]: value }));
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  async function submit() {
    if (!canSubmit) return;
    setError(''); setLoading(true);
    try {
      let primaryGuestId;
      if (linkedGuest) {
        primaryGuestId = String(linkedGuest._id);
      } else {
        const newG = await guestApi.create({ ...guestForm, propertyId });
        primaryGuestId = String(newG._id);
      }

      const common = {
        propertyId,
        primaryGuestId,
        arrivalDate:          arrival,
        departureDate:        departure,
        ratePlanId:           ratePlanId    || undefined,
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
      };

      // Create one reservation per room
      for (const room of rooms) {
        await resApi.create({
          ...common,
          roomTypeId:   room.roomTypeId,
          adults:       room.adults,
          children:     room.children,
          roomsCount:   1,
          ratePerNight: Number(room.ratePerNight),
        });
      }

      toastSuccess(rooms.length > 1
        ? `${rooms.length} הזמנות נוצרו בהצלחה!`
        : 'ההזמנה נוצרה בהצלחה!');
      navigate('/pms/reservations');
    } catch (e) {
      setError(e.message || 'שגיאה ביצירת הזמנה');
      toastError(e.message || 'שגיאה ביצירת הזמנה');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="ui-page is-approved is-legacy">
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div className="ap-bar">
        <div className="ap-bar-start">
          <BackArrow to="/pms/reservations" />
          <h1 className="ap-title">הזמנה חדשה</h1>
        </div>
        <div className="ap-bar-end">
          <button onClick={() => navigate('/pms/reservations')}
            className="btn btn-secondary">ביטול</button>
          <button onClick={submit} disabled={loading || !canSubmit}
            className="btn btn-primary gap-2">
            {loading
              ? <><Loader2 size={13} className="animate-spin" /> יוצר...</>
              : <><CheckCircle2 size={13} /> {rooms.length > 1 ? `צור ${rooms.length} הזמנות` : 'צור הזמנה'}</>}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            <AlertCircle size={14} className="flex-shrink-0" />{error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 items-start">

          {/* ── LEFT: Guest + Advanced ── */}
          <div className="flex flex-col gap-4">
            <SectionBox title="פרטי אורח">

              {linkedGuest && (
                <div className="flex items-center justify-between px-3 py-2 bg-green-50 border border-green-200 rounded mb-3 text-sm">
                  <div className="flex items-center gap-2 text-green-700">
                    <Link2 size={12} />
                    <span className="font-medium">{linkedGuest.firstName} {linkedGuest.lastName}</span>
                    {linkedGuest.vipLevel > 0 && <Crown size={11} className="text-yellow-500" />}
                    {linkedGuest.totalStays > 0 && (
                      <span className="text-green-600 text-xs">· {linkedGuest.totalStays} שהיות</span>
                    )}
                  </div>
                  <button onClick={() => { setLinkedGuest(null); setSuggDismissed(false); }}
                    className="text-gray-400 hover:text-gray-600">
                    <X size={13} />
                  </button>
                </div>
              )}

              {linkedGuest?.isBlacklisted && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded mb-3 text-red-700 text-sm">
                  <AlertCircle size={13} className="flex-shrink-0" />
                  אורח ברשימה השחורה — נדרש אישור מנהל
                </div>
              )}

              <div className="flex flex-col gap-3">
                <div className="grid gap-2" style={{ gridTemplateColumns: '76px 1fr 1fr' }}>
                  <FormField label="פנייה">
                    <select className="select w-full text-sm" value={guestForm.title}
                      onChange={e => changeField('title', e.target.value)}>
                      {TITLES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </FormField>
                  <FormField label="שם פרטי" required>
                    <input className="input text-sm" autoFocus placeholder="דוד"
                      value={guestForm.firstName}
                      onChange={e => changeField('firstName', e.target.value)} />
                  </FormField>
                  <FormField label="שם משפחה" required>
                    <input className="input text-sm" placeholder="כהן"
                      value={guestForm.lastName}
                      onChange={e => changeField('lastName', e.target.value)} />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="אימייל">
                    <input className="input text-sm" type="email" placeholder="david@example.com"
                      value={guestForm.email}
                      onChange={e => changeField('email', e.target.value)} />
                  </FormField>
                  <FormField label="טלפון">
                    <input className="input text-sm" placeholder="050-0000000"
                      value={guestForm.phone}
                      onChange={e => changeField('phone', e.target.value)} />
                  </FormField>
                </div>
                <FormField label="לאום">
                  <input className="input text-sm" placeholder="IL, US, UK..."
                    value={guestForm.nationality}
                    onChange={e => changeField('nationality', e.target.value)} />
                </FormField>
              </div>

              {suggLoading && !linkedGuest && (
                <div className="flex items-center gap-1.5 mt-3 text-xs text-gray-400">
                  <Loader2 size={11} className="animate-spin" />מחפש אורח קיים...
                </div>
              )}
              {suggestion && !linkedGuest && (
                <div className="mt-3 flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm">
                  <div className="flex items-center gap-2 text-gray-700">
                    <UserCheck size={13} className="text-blue-500 flex-shrink-0" />
                    <span>{suggestion.firstName} {suggestion.lastName}</span>
                    {suggestion.vipLevel > 0 && <Crown size={11} className="text-yellow-500" />}
                    {suggestion.totalStays > 0 && (
                      <span className="text-gray-400 text-xs">· {suggestion.totalStays} שהיות</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={acceptSuggestion}
                      className="text-xs text-blue-600 font-medium hover:underline">קשר אורח</button>
                    <button onClick={() => { setSuggestion(null); setSuggDismissed(true); }}
                      className="text-gray-400 hover:text-gray-600">
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}
            </SectionBox>

            {/* Advanced */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <button type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50 border-b border-gray-100">
                <span>אפשרויות נוספות</span>
                <ChevronDown size={14}
                  className={`text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </button>
              {showAdvanced && (
                <div className="p-4 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="ערבות">
                      <select className="select w-full text-sm" value={guaranteeType}
                        onChange={e => setGuaranteeType(e.target.value)}>
                        {GUARANTEE_TYPES.map(g => (
                          <option key={g.value} value={g.value}>{g.label}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="מדיניות ביטול">
                      <select className="select w-full text-sm" value={cancelPolicy}
                        onChange={e => setCancelPolicy(e.target.value)}>
                        {CANCEL_POLICIES.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                  {guaranteeType === 'credit_card' && (
                    <FormField label="4 ספרות אחרונות">
                      <input className="input text-sm" style={{ width: 100 }}
                        maxLength={4} placeholder="XXXX"
                        value={ccLast4}
                        onChange={e => setCcLast4(e.target.value.replace(/\D/g, ''))} />
                    </FormField>
                  )}
                  {guaranteeType === 'deposit' && (
                    <FormField label="סכום מקדמה (₪)">
                      <input type="number" className="input text-sm" style={{ width: 130 }}
                        min={0} value={depositAmount}
                        onChange={e => setDepositAmount(e.target.value)} />
                    </FormField>
                  )}
                  <FormField label="בקשות מיוחדות">
                    <textarea className="input w-full resize-none text-sm" rows={2}
                      placeholder="העדפות מיטה, קומה..."
                      value={specialReqs}
                      onChange={e => setSpecialReqs(e.target.value)} />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="הערות אורח" hint="לא מוצג לאורח">
                      <textarea className="input w-full resize-none text-sm" rows={2}
                        value={guestNotes}
                        onChange={e => setGuestNotes(e.target.value)} />
                    </FormField>
                    <FormField label="הערות פנימיות" hint="סודי">
                      <textarea className="input w-full resize-none text-sm" rows={2}
                        value={internalNotes}
                        onChange={e => setInternalNotes(e.target.value)} />
                    </FormField>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={isVip}
                      onChange={e => setIsVip(e.target.checked)}
                      className="rounded border-gray-300" />
                    <Crown size={13} className={isVip ? 'text-yellow-500' : 'text-gray-400'} />
                    <span className="text-sm text-gray-700">סמן כ-VIP</span>
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Stay + Rate ── */}
          <div className="flex flex-col gap-4">

            {/* Dates */}
            <SectionBox title="תאריכי שהייה">
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="הגעה" required>
                    <input type="date" className="input w-full text-sm" value={arrival} min={TODAY}
                      onChange={e => {
                        setArrival(e.target.value);
                        if (e.target.value >= departure) setDeparture(addDays(e.target.value, 1));
                      }} />
                  </FormField>
                  <FormField label="יציאה" required>
                    <input type="date" className="input w-full text-sm" value={departure}
                      min={arrival ? addDays(arrival, 1) : TODAY}
                      onChange={e => setDeparture(e.target.value)} />
                  </FormField>
                </div>
                <div className="text-sm text-gray-500">
                  {n > 0
                    ? <><span className="font-semibold text-gray-900">{n}</span> לילות</>
                    : <span className="text-gray-400">בחר תאריכים</span>}
                </div>
              </div>
            </SectionBox>

            {/* Rooms table */}
            <SectionBox title="חדרים">
              <div className="flex flex-col gap-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-right font-medium pb-2" style={{ width: '35%' }}>סוג חדר</th>
                      <th className="text-center font-medium pb-2" style={{ width: '14%' }}>מבוגרים</th>
                      <th className="text-center font-medium pb-2" style={{ width: '14%' }}>ילדים</th>
                      <th className="text-center font-medium pb-2" style={{ width: '22%' }}>₪/לילה</th>
                      <th className="text-center font-medium pb-2" style={{ width: '12%' }}>סה&quot;כ</th>
                      <th style={{ width: '3%' }}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rooms.map((room, idx) => {
                      const roomTotal = Number(room.ratePerNight || 0) * n;
                      return (
                        <tr key={room._key} className="group">
                          <td className="py-2 pl-1">
                            <select className="select w-full text-xs"
                              value={room.roomTypeId}
                              onChange={e => updateRoom(room._key, { roomTypeId: e.target.value, rateOverride: false })}>
                              {rtypes.map(rt => (
                                <option key={String(rt._id)} value={String(rt._id)}>{rt.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-1 text-center">
                            <input type="number" className="input text-xs text-center w-full"
                              min={1} max={12} value={room.adults}
                              onChange={e => updateRoom(room._key, { adults: Number(e.target.value) || 1 })} />
                          </td>
                          <td className="py-2 px-1 text-center">
                            <input type="number" className="input text-xs text-center w-full"
                              min={0} max={8} value={room.children}
                              onChange={e => updateRoom(room._key, { children: Number(e.target.value) || 0 })} />
                          </td>
                          <td className="py-2 px-1">
                            <input type="number" className="input text-xs text-center w-full"
                              min={0} step={1} value={room.ratePerNight}
                              onChange={e => updateRoom(room._key, { ratePerNight: e.target.value, rateOverride: true })} />
                          </td>
                          <td className="py-2 pl-1 text-center text-xs font-semibold text-gray-700">
                            {roomTotal > 0 ? `₪${roomTotal.toLocaleString()}` : '—'}
                          </td>
                          <td className="py-2 text-center">
                            {rooms.length > 1 && (
                              <button type="button"
                                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all"
                                onClick={() => removeRoom(room._key)}>
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {rooms.length > 1 && (
                    <tfoot>
                      <tr className="border-t border-gray-200">
                        <td className="pt-2 text-xs text-gray-400">
                          {rooms.length} חדרים · {totalAdults} מבוגרים
                          {totalChildren > 0 ? ` · ${totalChildren} ילדים` : ''}
                        </td>
                        <td colSpan={3}></td>
                        <td className="pt-2 text-center text-sm font-bold text-gray-900">
                          {grandTotal > 0 ? `₪${grandTotal.toLocaleString()}` : ''}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                <button type="button"
                  onClick={addRoom}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 pt-1">
                  <Plus size={13} />הוסף חדר
                </button>
              </div>
            </SectionBox>

            {/* Rate & source */}
            <SectionBox title="תעריף ומקור">
              <div className="flex flex-col gap-3">
                {ratePlans.length > 0 && (
                  <FormField label="מסלול תעריף">
                    <select className="select w-full text-sm" value={ratePlanId}
                      onChange={e => {
                        setRatePlanId(e.target.value);
                        setRooms(prev => prev.map(r => ({ ...r, rateOverride: false })));
                      }}>
                      <option value="">— ללא מסלול —</option>
                      {ratePlans.map(p => (
                        <option key={String(p._id)} value={String(p._id)}>{p.name}</option>
                      ))}
                    </select>
                  </FormField>
                )}

                {grandTotal > 0 && n > 0 && (
                  <div className="flex items-baseline gap-2 py-1">
                    <span className="text-xl font-bold text-gray-900">₪{grandTotal.toLocaleString()}</span>
                    <span className="text-xs text-gray-400">
                      סה&quot;כ · {n} לילות{rooms.length > 1 ? ` · ${rooms.length} חדרים` : ''}
                    </span>
                  </div>
                )}

                <div className="border-t border-gray-100 pt-3 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="ערוץ מכירה">
                      <select className="select w-full text-sm" value={source}
                        onChange={e => setSource(e.target.value)}>
                        {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </FormField>
                    <FormField label="קטגוריית שוק">
                      <select className="select w-full text-sm" value={marketSeg}
                        onChange={e => setMarketSeg(e.target.value)}>
                        {MARKET_SEGS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </FormField>
                  </div>

                  <FormField label="סטטוס הזמנה">
                    <select className="select w-full text-sm" value={bookingStatus}
                      onChange={e => setBookingStatus(e.target.value)}>
                      {BOOKING_STATUSES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </FormField>

                  {bookingStatus === 'hold' && (
                    <FormField label="תפוגת Hold">
                      <input type="datetime-local" className="input w-full text-sm"
                        value={holdExpiry} onChange={e => setHoldExpiry(e.target.value)} />
                    </FormField>
                  )}

                  {['booking', 'expedia', 'agoda', 'airbnb', 'other'].includes(source) && (
                    <FormField label="Channel Res ID">
                      <input className="input text-sm w-full" placeholder="מספר הזמנה בערוץ"
                        value={channelResId} onChange={e => setChannelResId(e.target.value)} />
                    </FormField>
                  )}

                  <FormField label="חברה / Travel Agent">
                    <CompanySearch propertyId={propertyId} value={company} onChange={setCompany} />
                  </FormField>
                </div>
              </div>
            </SectionBox>
          </div>
        </div>
      </div>
    </div>
  );
}
