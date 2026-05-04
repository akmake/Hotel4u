import { useState, useEffect, useRef } from 'react';
import { X, Search, CalendarDays, Users, Crown, ChevronDown } from 'lucide-react';
import { guests as guestApi, roomTypes as rtApi, reservations as resApi } from '../../utils/api';
import { TODAY, addDays } from '../../utils/date';

function nights(arrival, departure) {
  if (!arrival || !departure) return 0;
  const diff = (new Date(departure) - new Date(arrival)) / 86400000;
  return diff > 0 ? diff : 0;
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
        const data = await guestApi.list(propertyId, q);
        setResults(data || []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
  }, [q, propertyId]);

  function select(g) {
    onChange(g);
    setOpen(false);
    setQ('');
  }

  return (
    <div className="relative">
      {value ? (
        <div className="flex items-center gap-2 input cursor-pointer" onClick={() => { onChange(null); setOpen(true); }}>
          <div className="avatar text-xs" style={{width:22,height:22,fontSize:9,background:'rgba(99,102,241,0.1)',color:'#6366f1'}}>
            {value.firstName?.slice(0,1)}{value.lastName?.slice(0,1)}
          </div>
          <span className="flex-1 text-sm font-medium">{value.firstName} {value.lastName}</span>
          {value.vipLevel > 0 && <Crown size={11} className="text-yellow-500" />}
          <X size={13} className="text-ink-faint" />
        </div>
      ) : (
        <div className="relative">
          <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            className="input pr-8 w-full"
            placeholder="חיפוש אורח לפי שם, אימייל..."
            value={q}
            onChange={e => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            autoComplete="off"
          />
        </div>
      )}

      {open && !value && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-full bg-white border border-surface-border rounded-xl shadow-card-hover z-20 max-h-52 overflow-y-auto">
            {loading && <div className="px-4 py-3 text-xs text-ink-muted">מחפש...</div>}
            {!loading && results.length === 0 && q.trim() && (
              <div className="px-4 py-3 text-xs text-ink-muted">לא נמצאו אורחים</div>
            )}
            {results.map(g => (
              <div key={String(g._id)}
                className="flex items-center gap-2 px-3 py-2.5 hover:bg-surface-hover cursor-pointer transition-colors"
                onClick={() => select(g)}>
                <div className="avatar text-xs flex-shrink-0"
                  style={{width:26,height:26,fontSize:10,background:'rgba(99,102,241,0.1)',color:'#6366f1'}}>
                  {g.firstName?.slice(0,1)}{g.lastName?.slice(0,1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-sm text-ink">{g.firstName} {g.lastName}</span>
                    {g.vipLevel > 0 && <Crown size={10} className="text-yellow-500" />}
                  </div>
                  <div className="text-xs text-ink-muted truncate">{g.email}</div>
                </div>
                <span className="text-xs text-ink-faint">{g.totalStays || 0} שהיות</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const SOURCES = [
  { value:'direct',   label:'ישיר' },
  { value:'booking',  label:'Booking.com' },
  { value:'expedia',  label:'Expedia' },
  { value:'agoda',    label:'Agoda' },
  { value:'phone',    label:'טלפון' },
  { value:'walk_in',  label:'Walk-in' },
];

export default function NewReservationModal({ propertyId, onClose, onCreated }) {
  const [step,      setStep]      = useState(1); // 1=guest+room, 2=dates+rate, 3=confirm
  const [guest,     setGuest]     = useState(null);
  const [rtypes,    setRtypes]    = useState([]);
  const [roomTypeId,setRoomType]  = useState('');
  const [arrival,   setArrival]   = useState(TODAY);
  const [departure, setDeparture] = useState(addDays(TODAY, 3));
  const [rate,      setRate]      = useState('');
  const [adults,    setAdults]    = useState(2);
  const [source,    setSource]    = useState('direct');
  const [notes,     setNotes]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    rtApi.list(propertyId).then(data => {
      setRtypes(data || []);
      if (data?.length) {
        setRoomType(String(data[0]._id));
        setRate(String(data[0].baseRate));
      }
    }).catch(() => {});
  }, [propertyId]);

  function onRoomTypeChange(id) {
    setRoomType(id);
    const rt = rtypes.find(t => String(t._id) === id);
    if (rt) setRate(String(rt.baseRate));
  }

  const n = nights(arrival, departure);
  const total = n * Number(rate || 0);
  const selectedRt = rtypes.find(t => String(t._id) === roomTypeId);
  const canStep1 = !!guest && !!roomTypeId;
  const canStep2 = n > 0 && Number(rate) > 0;

  async function submit() {
    setError('');
    setLoading(true);
    try {
      const res = await resApi.create({
        propertyId,
        primaryGuestId: String(guest._id),
        roomTypeId,
        arrivalDate:   arrival,
        departureDate: departure,
        ratePerNight:  Number(rate),
        adults,
        source,
        specialRequests: notes || undefined,
        isVip: guest.vipLevel > 0,
      });
      onCreated?.(res);
      onClose();
    } catch (e) {
      setError(e.message || 'שגיאה ביצירת הזמנה');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in" style={{ direction:'rtl' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div>
            <div className="font-bold text-ink">הזמנה חדשה</div>
            <div className="text-xs text-ink-muted">
              שלב {step} מתוך 3 ·
              {step === 1 && ' אורח וסוג חדר'}
              {step === 2 && ' תאריכים ותעריף'}
              {step === 3 && ' אישור סופי'}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Step indicators */}
        <div className="flex gap-0 border-b border-surface-border">
          {[1,2,3].map(s => (
            <div key={s} className="flex-1 h-1" style={{
              background: s <= step ? '#6366f1' : '#e2e8f0',
              transition: 'background 0.3s',
            }} />
          ))}
        </div>

        <div className="px-6 py-5">
          {/* ── Step 1: Guest + Room Type ── */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1.5">אורח *</label>
                <GuestSearch propertyId={propertyId} value={guest} onChange={setGuest} />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1.5">סוג חדר *</label>
                <div className="grid grid-cols-2 gap-2">
                  {rtypes.map(rt => (
                    <button
                      key={String(rt._id)}
                      onClick={() => onRoomTypeChange(String(rt._id))}
                      className={`flex flex-col gap-0.5 p-3 rounded-xl border text-right transition-all ${
                        roomTypeId === String(rt._id)
                          ? 'border-brand bg-brand/5 shadow-card'
                          : 'border-surface-border hover:border-brand/40'
                      }`}
                    >
                      <span className="font-semibold text-sm text-ink">{rt.name}</span>
                      <span className="text-xs text-ink-muted">₪{rt.baseRate}/לילה · {rt.capacityBase} אורחים</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1.5">מקור הזמנה</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {SOURCES.map(s => (
                    <button key={s.value}
                      onClick={() => setSource(s.value)}
                      className={`text-xs px-2 py-1.5 rounded-lg border transition-all ${source === s.value ? 'border-brand text-brand bg-brand/5 font-semibold' : 'border-surface-border text-ink-secondary hover:border-brand/40'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Dates + Rate ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1.5">תאריך הגעה *</label>
                  <input type="date" className="input w-full" value={arrival}
                    onChange={e => { setArrival(e.target.value); if (e.target.value >= departure) setDeparture(''); }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1.5">תאריך יציאה *</label>
                  <input type="date" className="input w-full" value={departure} min={arrival}
                    onChange={e => setDeparture(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-surface-hover rounded-xl text-sm">
                <CalendarDays size={15} className="text-brand flex-shrink-0" />
                <span className="font-bold text-num text-brand">{n}</span>
                <span className="text-ink-muted">לילות</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1.5">תעריף ללילה (₪) *</label>
                  <input type="number" className="input w-full text-num" min={0} value={rate}
                    onChange={e => setRate(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1.5">אורחים</label>
                  <div className="flex items-center gap-2 input">
                    <Users size={13} className="text-ink-faint" />
                    <input type="number" className="flex-1 bg-transparent outline-none text-num" min={1} max={6}
                      value={adults} onChange={e => setAdults(Number(e.target.value))} />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1.5">הערות מיוחדות</label>
                <textarea className="input w-full resize-none" rows={2} placeholder="בקשות מיוחדות, העדפות..."
                  value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
          )}

          {/* ── Step 3: Summary ── */}
          {step === 3 && (
            <div className="flex flex-col gap-3">
              <div className="bg-surface-hover rounded-xl p-4 flex flex-col gap-2.5">
                {[
                  { label:'אורח',      value: `${guest?.firstName} ${guest?.lastName}${guest?.vipLevel > 0 ? ' ⭐' : ''}` },
                  { label:'סוג חדר',   value: selectedRt?.name },
                  { label:'הגעה',      value: arrival },
                  { label:'יציאה',     value: departure },
                  { label:'לילות',     value: n },
                  { label:'מקור',      value: SOURCES.find(s => s.value === source)?.label },
                  { label:'אורחים',    value: adults },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">{label}</span>
                    <span className="font-medium text-ink">{value}</span>
                  </div>
                ))}
                <div className="border-t border-surface-border pt-2.5 flex items-center justify-between">
                  <span className="font-bold text-ink">סה"כ</span>
                  <span className="text-xl font-black text-num text-brand">₪{total.toLocaleString()}</span>
                </div>
              </div>

              {error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {notes && (
                <div className="text-xs text-brand bg-brand/5 border border-brand/20 rounded-lg px-3 py-2">
                  📌 {notes}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-surface-border bg-surface-hover">
          {step > 1
            ? <button className="btn btn-secondary flex-1 justify-center" onClick={() => setStep(s => s - 1)}>← חזרה</button>
            : <button className="btn btn-secondary flex-1 justify-center" onClick={onClose}>ביטול</button>
          }
          {step < 3
            ? <button
                className="btn btn-primary flex-1 justify-center"
                disabled={step === 1 ? !canStep1 : !canStep2}
                onClick={() => setStep(s => s + 1)}>
                המשך →
              </button>
            : <button
                className="btn btn-primary flex-1 justify-center"
                onClick={submit}
                disabled={loading}>
                {loading ? 'יוצר...' : 'צור הזמנה ✓'}
              </button>
          }
        </div>
      </div>
    </div>
  );
}
