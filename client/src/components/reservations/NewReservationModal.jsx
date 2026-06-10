import { useState, useEffect, useRef } from 'react';
import {
  X, Search, Crown, UserPlus, Building2, ChevronDown,
  Loader2, AlertCircle, CheckCircle2, BedDouble,
} from 'lucide-react';
import {
  guests as guestApi,
  roomTypes as rtApi,
  reservations as resApi,
  rates as ratesApi,
  companies as companiesApi,
} from '../../utils/api';
import { TODAY, addDays } from '../../utils/date';

function nights(a, d) {
  if (!a || !d) return 0;
  const n = (new Date(d) - new Date(a)) / 86400000;
  return n > 0 ? n : 0;
}

/* ── Guest search ─────────────────────────────────────────────────────────── */
function GuestSearch({ propertyId, value, onChange }) {
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
        const d = await guestApi.list(propertyId, { q });
        setResults(Array.isArray(d) ? d : []);
      } catch { setResults([]); }
      finally   { setLoading(false); }
    }, 300);
  }, [q, propertyId]);

  /* selected state */
  if (value && !value._new) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-700 flex-shrink-0">
          {value.firstName?.[0]}{value.lastName?.[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-gray-900">{value.firstName} {value.lastName}</span>
            {value.vipLevel > 0 && <Crown size={12} className="text-amber-500" />}
            {value.isBlacklisted && (
              <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-1.5">RL</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {[value.phone, value.email, value.totalStays > 0 && `${value.totalStays} שהיות`].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button onClick={() => onChange(null)} className="text-gray-400 hover:text-gray-600 p-1">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        className="w-full border border-gray-300 rounded-lg py-2.5 pr-9 pl-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-400"
        placeholder="חיפוש לפי שם, טלפון, אימייל..."
        value={q}
        autoFocus
        autoComplete="off"
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
            {loading && (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-500">
                <Loader2 size={13} className="animate-spin" /> מחפש...
              </div>
            )}
            {!loading && q && !results.length && (
              <div className="px-4 py-3 text-sm text-gray-400">לא נמצאו תוצאות</div>
            )}
            <div className="max-h-52 overflow-y-auto">
              {results.map(g => (
                <button
                  key={g._id}
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-right"
                  onClick={() => { onChange(g); setOpen(false); setQ(''); }}
                >
                  <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">
                    {g.firstName?.[0]}{g.lastName?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 text-sm">
                      <span className="font-medium text-gray-900">{g.firstName} {g.lastName}</span>
                      {g.vipLevel > 0 && <Crown size={10} className="text-amber-500" />}
                    </div>
                    <div className="text-xs text-gray-400 truncate">{g.phone || g.email}</div>
                  </div>
                  {g.totalStays > 0 && (
                    <span className="text-xs text-gray-400 flex-shrink-0">{g.totalStays} שהיות</span>
                  )}
                </button>
              ))}
            </div>
            <div className="border-t border-gray-100">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                onClick={() => { setOpen(false); onChange({ _new: true }); }}
              >
                <UserPlus size={13} />
                אורח חדש
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── New guest inline form ────────────────────────────────────────────────── */
function NewGuestForm({ onSave, onCancel, propertyId }) {
  const [form, setForm]   = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr]     = useState('');

  async function save() {
    if (!form.firstName || !form.lastName) { setErr('שם פרטי ושם משפחה חובה'); return; }
    setLoading(true); setErr('');
    try {
      const g = await guestApi.create({ ...form, propertyId });
      onSave(g);
    } catch (e) { setErr(e.message || 'שגיאה'); }
    finally { setLoading(false); }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 flex flex-col gap-3">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">אורח חדש</div>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          placeholder="שם פרטי *"
          value={form.firstName}
          onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
        />
        <input
          className="border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          placeholder="שם משפחה *"
          value={form.lastName}
          onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
        />
        <input
          className="border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          placeholder="טלפון"
          value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
        />
        <input
          className="border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          placeholder="אימייל"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
        />
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          שמור
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">
          ביטול
        </button>
      </div>
    </div>
  );
}

/* ── Main modal ───────────────────────────────────────────────────────────── */
const SOURCES = [
  { value: 'direct',  label: 'ישיר'    },
  { value: 'booking', label: 'Booking' },
  { value: 'expedia', label: 'Expedia' },
  { value: 'agoda',   label: 'Agoda'   },
  { value: 'phone',   label: 'טלפון'   },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'other',   label: 'אחר'     },
];

const BOOKING_STATUSES = [
  { value: 'confirmed',       label: 'מאושר'      },
  { value: 'hold',            label: 'On Hold'    },
  { value: 'pending_payment', label: 'ממתין תשלום' },
];

export default function NewReservationModal({ propertyId, onClose, onCreated }) {
  const [guest,      setGuest]      = useState(null);
  const [arrival,    setArrival]    = useState(TODAY);
  const [departure,  setDeparture]  = useState(addDays(TODAY, 1));
  const [roomTypeId, setRoomTypeId] = useState('');
  const [adults,     setAdults]     = useState(2);
  const [children,   setChildren]   = useState(0);
  const [ratePerNight, setRatePerNight] = useState('');
  const [ratePlanId,   setRatePlanId]   = useState('');
  const [source,     setSource]     = useState('direct');
  const [status,     setStatus]     = useState('confirmed');
  const [rtypes,     setRtypes]     = useState([]);
  const [ratePlans,  setRatePlans]  = useState([]);
  const [avail,      setAvail]      = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [specialReqs,  setSpecialReqs]  = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [isVip,      setIsVip]      = useState(false);
  const [company,    setCompany]    = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const availTimer = useRef(null);

  useEffect(() => {
    rtApi.list(propertyId).then(d => {
      const rt = Array.isArray(d) ? d : [];
      setRtypes(rt);
      if (rt.length) { setRoomTypeId(String(rt[0]._id)); }
    }).catch(() => {});
    ratesApi.plans(propertyId).then(d => setRatePlans(Array.isArray(d) ? d : [])).catch(() => {});
  }, [propertyId]);

  /* availability check */
  useEffect(() => {
    const n = nights(arrival, departure);
    if (!roomTypeId || n <= 0) { setAvail(null); return; }
    if (availTimer.current) clearTimeout(availTimer.current);
    setAvail('loading');
    availTimer.current = setTimeout(async () => {
      try {
        const r = await resApi.availability(propertyId, roomTypeId, arrival, departure);
        const cnt = r?.availableRooms?.length ?? 0;
        setAvail(!r?.available ? 'unavailable' : cnt <= 2 ? 'limited' : 'ok');
      } catch { setAvail(null); }
    }, 600);
  }, [roomTypeId, arrival, departure, propertyId]);

  /* auto-rate */
  useEffect(() => {
    if (!roomTypeId) return;
    const n = nights(arrival, departure);
    if (ratePlanId && n > 0) {
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
  }, [ratePlanId, roomTypeId, arrival, departure, rtypes, propertyId]);

  useEffect(() => {
    if (guest && !guest._new && guest.vipLevel > 0) setIsVip(true);
  }, [guest]);

  const n     = nights(arrival, departure);
  const total = n * Number(ratePerNight || 0);
  const selRt = rtypes.find(t => String(t._id) === roomTypeId);

  const canSubmit = guest && !guest._new && n > 0 && roomTypeId && Number(ratePerNight) > 0;

  async function submit() {
    if (!canSubmit) return;
    setError(''); setLoading(true);
    try {
      const res = await resApi.create({
        propertyId,
        primaryGuestId: String(guest._id),
        roomTypeId,
        arrivalDate: arrival,
        departureDate: departure,
        adults, children,
        ratePlanId: ratePlanId || undefined,
        ratePerNight: Number(ratePerNight),
        source,
        bookingStatus: status,
        specialRequests: specialReqs || undefined,
        internalNotes: internalNotes || undefined,
        companyId: company ? String(company._id) : undefined,
        isVip,
        currency: 'ILS',
        language: 'he',
      });
      onCreated?.(res);
      onClose();
    } catch (e) { setError(e.message || 'שגיאה ביצירת הזמנה'); }
    finally { setLoading(false); }
  }

  const availColor = avail === 'ok' ? 'text-emerald-600' : avail === 'limited' ? 'text-amber-600' : avail === 'unavailable' ? 'text-red-600' : 'text-gray-400';
  const availText  = avail === 'ok' ? 'זמין' : avail === 'limited' ? 'מוגבל' : avail === 'unavailable' ? 'אין זמינות' : avail === 'loading' ? '...' : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col" style={{ maxHeight: '92vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">הזמנה חדשה</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">

          {/* Guest */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">אורח</label>
            {guest?._new ? (
              <NewGuestForm propertyId={propertyId} onSave={g => setGuest(g)} onCancel={() => setGuest(null)} />
            ) : (
              <GuestSearch propertyId={propertyId} value={guest} onChange={setGuest} />
            )}
            {guest && !guest._new && guest.isBlacklisted && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                <AlertCircle size={12} /> אורח ברשימה השחורה — נדרש אישור מנהל
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">תאריכים</label>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">הגעה</span>
                <input
                  type="date"
                  value={arrival}
                  min={TODAY}
                  className="border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                  onChange={e => {
                    setArrival(e.target.value);
                    if (e.target.value >= departure) setDeparture(addDays(e.target.value, 1));
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">יציאה</span>
                <input
                  type="date"
                  value={departure}
                  min={arrival ? addDays(arrival, 1) : TODAY}
                  className="border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                  onChange={e => setDeparture(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">לילות</span>
                <div className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-2 bg-gray-50">
                  <span className="text-xl font-bold text-gray-900">{n}</span>
                  {availText && (
                    <span className={`text-xs font-medium ${availColor}`}>{availText}</span>
                  )}
                  {avail === 'loading' && <Loader2 size={11} className="animate-spin text-gray-400" />}
                </div>
              </div>
            </div>
          </div>

          {/* Room Type */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">סוג חדר</label>
            {rtypes.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                <Loader2 size={13} className="animate-spin" /> טוען...
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {rtypes.map(rt => {
                  const sel = roomTypeId === String(rt._id);
                  return (
                    <button
                      key={rt._id}
                      type="button"
                      onClick={() => setRoomTypeId(String(rt._id))}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-right transition-colors
                        ${sel
                          ? 'border-gray-900 bg-gray-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                    >
                      <BedDouble size={15} className={sel ? 'text-gray-900' : 'text-gray-400'} />
                      <span className={`text-sm font-medium flex-1 ${sel ? 'text-gray-900' : 'text-gray-600'}`}>
                        {rt.name}
                      </span>
                      <span className={`text-sm font-semibold tabular-nums ${sel ? 'text-gray-900' : 'text-gray-500'}`}>
                        ₪{rt.baseRate?.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Occupancy + Rate */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">אורחים</label>
              <div className="flex items-center gap-3 border border-gray-200 rounded-md px-3 py-2 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">מבוגרים</span>
                  <button type="button" onClick={() => setAdults(a => Math.max(1, a - 1))} className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200 text-sm font-bold">−</button>
                  <span className="text-sm font-semibold text-gray-900 w-4 text-center">{adults}</span>
                  <button type="button" onClick={() => setAdults(a => Math.min(12, a + 1))} className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200 text-sm font-bold">+</button>
                </div>
                <div className="w-px h-4 bg-gray-200" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">ילדים</span>
                  <button type="button" onClick={() => setChildren(c => Math.max(0, c - 1))} className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200 text-sm font-bold">−</button>
                  <span className="text-sm font-semibold text-gray-900 w-4 text-center">{children}</span>
                  <button type="button" onClick={() => setChildren(c => Math.min(8, c + 1))} className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200 text-sm font-bold">+</button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">תעריף ללילה</label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₪</span>
                <input
                  type="number"
                  min={0}
                  value={ratePerNight}
                  onChange={e => setRatePerNight(e.target.value)}
                  className="w-full border border-gray-300 rounded-md py-2 pr-7 pl-3 text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                />
              </div>
            </div>
          </div>

          {/* Advanced toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              <ChevronDown size={13} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              {showAdvanced ? 'הסתר' : 'אפשרויות נוספות'} — מקור, מסלול תעריף, הערות
            </button>

            {showAdvanced && (
              <div className="mt-3 flex flex-col gap-3 border-t border-gray-100 pt-3">
                {/* Source */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">מקור</label>
                  <div className="flex flex-wrap gap-1">
                    {SOURCES.map(s => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setSource(s.value)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors
                          ${source === s.value
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rate plan */}
                {ratePlans.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">מסלול תעריף</label>
                    <select
                      value={ratePlanId}
                      onChange={e => setRatePlanId(e.target.value)}
                      className="border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                    >
                      <option value="">ללא מסלול</option>
                      {ratePlans.map(p => (
                        <option key={p._id} value={String(p._id)}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Notes */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">בקשות מיוחדות</label>
                    <textarea
                      rows={2}
                      value={specialReqs}
                      onChange={e => setSpecialReqs(e.target.value)}
                      placeholder="העדפות האורח..."
                      className="border border-gray-300 rounded-md py-2 px-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">הערות פנימיות</label>
                    <textarea
                      rows={2}
                      value={internalNotes}
                      onChange={e => setInternalNotes(e.target.value)}
                      placeholder="לא יוצג לאורח..."
                      className="border border-gray-300 rounded-md py-2 px-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                    />
                  </div>
                </div>

                {/* VIP */}
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <div
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                      ${isVip ? 'bg-amber-400 border-amber-400' : 'border-gray-300'}`}
                    onClick={() => setIsVip(v => !v)}
                  >
                    {isVip && <Crown size={9} className="text-white" />}
                  </div>
                  <span className="text-sm text-gray-700">סמן כ-VIP</span>
                </label>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
          {/* Total */}
          <div className="flex-1">
            {total > 0 && (
              <div>
                <span className="text-xs text-gray-400">{n} לילות · סה"כ </span>
                <span className="text-base font-bold text-gray-900">₪{total.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Status */}
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="border border-gray-300 rounded-md py-2 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          >
            {BOOKING_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          <button
            onClick={submit}
            disabled={!canSubmit || loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            צור הזמנה
          </button>
        </div>
      </div>
    </div>
  );
}
