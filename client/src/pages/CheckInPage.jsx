import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogIn, Crown, AlertCircle, CheckCircle2, X, Search, Plus,
  Upload, Edit3, Banknote, Key, MessageSquare,
  ChevronRight, ChevronLeft, Loader2,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { dashboard, reservations as resApi, guests as guestsApi, folio as folioApi, properties as propApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import { TODAY } from '../utils/date';

// ── Signature Canvas ───────────────────────────────────────────────────────────
function SignatureCanvas({ onSigned }) {
  const canvasRef = useRef(null);
  const drawing   = useRef(false);

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e, canvasRef.current);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    const pos    = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.stroke();
  }

  function endDraw() {
    drawing.current = false;
    if (onSigned) onSigned(canvasRef.current.toDataURL());
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    if (onSigned) onSigned(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold text-ink-secondary mb-1">חתימה דיגיטלית</div>
      <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: 8, background: '#f8fafc', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={480} height={120}
          style={{ display: 'block', width: '100%', height: 120, cursor: 'crosshair', touchAction: 'none' }}
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
        />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', opacity: 0.18 }}>
          <Edit3 size={36} className="text-ink-faint" />
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm self-end text-xs" onClick={clear}>נקה</button>
    </div>
  );
}

// ── Check-in Steps Modal ───────────────────────────────────────────────────────
const CI_STEPS = [
  { label: 'מסמך זיהוי', Icon: Upload },
  { label: 'חתימה',      Icon: Edit3 },
  { label: 'פיקדון',     Icon: Banknote },
  { label: 'אישור',      Icon: Key },
];

function CheckInModal({ res, propertyId, onClose, onDone }) {
  const [step,          setStep]      = useState(0);
  const [override,      setOverride]  = useState(false);
  const [idFile,        setIdFile]    = useState(null);
  const [idPreview,     setIdPreview] = useState(null);
  const [signature,     setSignature] = useState(null);
  const [depositAmount, setDepAmt]    = useState('');
  const [depositMethod, setDepMethod] = useState('credit_card');
  const [keyHandout,    setKey]       = useState(false);
  const [sendWelcome,   setWelcome]   = useState(true);
  const [loading,       setLoading]   = useState(false);
  const [depLoading,    setDepLoading]= useState(false);
  const { toasts, success, error: toastErr } = useToast();

  const room       = res.assignedRoom;
  const hasRoom    = !!room;
  const roomReady  = hasRoom && (room.cleanStatus === 'clean' || room.cleanStatus === 'inspected');
  const hasPay     = res.paymentStatus !== 'pending';
  const canCheckIn = hasRoom && (roomReady || override) && hasPay;

  const g       = res.primaryGuest || {};
  const nights  = res.nights || res.totalNights || '?';
  const total   = res.totalAmount ?? 0;
  const initial = `${g.firstName?.slice(0,1) || ''}${g.lastName?.slice(0,1) || ''}`;

  function handleIdFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIdFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setIdPreview(ev.target.result);
      reader.readAsDataURL(file);
    } else {
      setIdPreview(null);
    }
  }

  async function handleDeposit() {
    if (!depositAmount || Number(depositAmount) <= 0) return;
    setDepLoading(true);
    try {
      const folioData = await folioApi.getByReservation(String(res._id));
      if (folioData?._id) {
        await folioApi.deposit(String(folioData._id), {
          amount: Number(depositAmount),
          method: depositMethod,
          propertyId,
        });
        success('פיקדון נרשם בהצלחה');
        setDepAmt('');
      }
    } catch (e) { toastErr(e.message); }
    finally { setDepLoading(false); }
  }

  async function handleCheckIn() {
    setLoading(true);
    try {
      await resApi.checkIn(String(res._id), override);
      if (sendWelcome) await resApi.sendWelcome(String(res._id)).catch(() => null);
      success('צ׳ק-אין בוצע בהצלחה!');
      setTimeout(() => { onDone(); onClose(); }, 700);
    } catch (e) { toastErr(e.message || 'שגיאה בביצוע צ׳ק-אין'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ direction: 'rtl' }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" style={{ maxHeight: '92vh' }}>
        <ToastContainer toasts={toasts} />

        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-surface-border">
          <div className="avatar font-bold flex-shrink-0"
            style={{ width: 44, height: 44, fontSize: 15,
              background: res.isVip ? 'rgba(234,179,8,0.15)' : 'rgba(99,102,241,0.1)',
              color: res.isVip ? '#b45309' : '#6366f1' }}>
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-ink">{g.firstName} {g.lastName}</span>
              {res.isVip && <Crown size={13} className="text-yellow-500" />}
            </div>
            <div className="text-xs text-ink-muted">{res.confirmationNumber} · {res.roomType?.name}</div>
            <div className="text-xs text-ink-muted">חדר {room?.number || '—'} · {nights} לילות · ₪{Number(total).toLocaleString()}</div>
          </div>
          <button className="btn btn-ghost btn-icon flex-shrink-0" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Checklist bar */}
        <div className="px-5 py-3 bg-surface-hover border-b border-surface-border flex flex-col gap-2">
          <div className="flex gap-3 flex-wrap text-xs">
            <span className={`flex items-center gap-1 font-medium ${hasRoom ? 'text-emerald-700' : 'text-red-600'}`}>
              {hasRoom ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
              {hasRoom ? `חדר ${room.number}` : 'אין חדר מוקצה'}
            </span>
            <span className={`flex items-center gap-1 font-medium ${roomReady || override ? 'text-emerald-700' : 'text-amber-700'}`}>
              {roomReady || override ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
              {roomReady ? 'נקי ומוכן' : override ? 'אישור ידני' : `${room?.cleanStatus || 'לא מוכן'}`}
            </span>
            <span className={`flex items-center gap-1 font-medium ${hasPay ? 'text-emerald-700' : 'text-red-600'}`}>
              {hasPay ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
              {hasPay ? 'תשלום תקין' : 'נדרש תשלום'}
            </span>
          </div>
          {hasRoom && !roomReady && (
            <label className="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
              <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} className="rounded" />
              אישור ידני — צ׳ק-אין למרות שהחדר לא מוכן
            </label>
          )}
          {res.specialRequests && <div className="text-xs text-brand">📌 {res.specialRequests}</div>}
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-surface-border">
          {CI_STEPS.map(({ label, Icon }, i) => (
            <button key={i} onClick={() => setStep(i)}
              className={`flex-1 flex flex-col items-center py-2 text-xs font-medium transition-colors ${step === i ? 'text-brand' : 'text-ink-muted hover:text-ink'}`}
              style={{ borderBottom: step === i ? '2px solid #6366f1' : '2px solid transparent' }}>
              <Icon size={13} className="mb-0.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* Step 0: ID document */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="text-xs text-ink-secondary">העלאת מסמך מזהה — תעודת זהות, דרכון או רישיון נהיגה</div>
              <label className={`flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${idFile ? 'border-brand bg-brand/5' : 'border-surface-border hover:border-brand/40'}`}>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleIdFile} />
                <Upload size={28} className={idFile ? 'text-brand' : 'text-ink-faint'} />
                {idFile
                  ? <span className="text-sm font-semibold text-brand">{idFile.name}</span>
                  : <><span className="text-sm text-ink-secondary">לחץ לבחירת קובץ</span>
                     <span className="text-xs text-ink-faint">תמונה (JPG/PNG) או PDF</span></>
                }
              </label>
              {idPreview && (
                <img src={idPreview} alt="מסמך" className="rounded-xl border border-surface-border max-h-52 object-contain" />
              )}
              {idFile && !idPreview && (
                <div className="flex items-center gap-2 text-xs text-ink-secondary bg-surface-hover rounded-lg p-3">
                  <CheckCircle2 size={14} className="text-emerald-500" />
                  PDF הועלה: {idFile.name}
                </div>
              )}
              <div className="text-xs text-ink-faint">שלב זה רשות — ניתן לדלג לשלב הבא</div>
            </div>
          )}

          {/* Step 1: Signature */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="text-xs text-ink-secondary">חתימה דיגיטלית — חתימת האורח על תנאי השהייה</div>
              <SignatureCanvas onSigned={setSignature} />
              {signature && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 rounded-lg p-2">
                  <CheckCircle2 size={13} /> חתימה נקלטה
                </div>
              )}
              <div className="text-xs text-ink-faint">שלב זה רשות — ניתן לדלג לשלב הבא</div>
            </div>
          )}

          {/* Step 2: Deposit */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="text-xs text-ink-secondary">רישום פיקדון או Pre-authorization לפני כניסה לחדר</div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="input text-num"
                  type="number" min={0} step={1}
                  placeholder="סכום ₪"
                  value={depositAmount}
                  onChange={e => setDepAmt(e.target.value)}
                />
                <select className="select" value={depositMethod} onChange={e => setDepMethod(e.target.value)}>
                  <option value="credit_card">כרטיס אשראי</option>
                  <option value="cash">מזומן</option>
                  <option value="bank_transfer">העברה בנקאית</option>
                  <option value="voucher">שובר</option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm w-full justify-center gap-1.5"
                disabled={!depositAmount || Number(depositAmount) <= 0 || depLoading}
                onClick={handleDeposit}
              >
                {depLoading ? <><Loader2 size={13} className="animate-spin" /> שומר...</> : <><Banknote size={13} /> רשום פיקדון</>}
              </button>
              <div className="text-xs text-ink-faint">שלב זה רשות — ניתן לבצע פיקדון מאוחר יותר מ-Folio</div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <label className="flex items-center gap-3 p-3 rounded-xl border border-surface-border cursor-pointer hover:bg-surface-hover">
                <input type="checkbox" checked={keyHandout} onChange={e => setKey(e.target.checked)} className="rounded w-4 h-4 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-ink flex items-center gap-1.5"><Key size={14} /> מפתח / כרטיס חדר נמסר</div>
                  <div className="text-xs text-ink-muted">סמן לאחר מסירת גישה לחדר לאורח</div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-surface-border cursor-pointer hover:bg-surface-hover">
                <input type="checkbox" checked={sendWelcome} onChange={e => setWelcome(e.target.checked)} className="rounded w-4 h-4 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-ink flex items-center gap-1.5"><MessageSquare size={14} /> שלח הודעת ברוך הבא</div>
                  <div className="text-xs text-ink-muted">הודעה תישלח ל-{g.email || 'אורח'} עם פרטי השהות</div>
                </div>
              </label>
              {!canCheckIn && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">לא ניתן לבצע צ׳ק-אין</div>
                    {!hasRoom && <div>חסר: חדר מוקצה</div>}
                    {hasRoom && !roomReady && !override && <div>חסר: אישור לחדר לא נקי</div>}
                    {!hasPay && <div>חסר: אישור תשלום</div>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center gap-2 p-4 border-t border-surface-border">
          <button className="btn btn-secondary btn-sm gap-1" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronRight size={13} /> הקודם
          </button>
          {step < CI_STEPS.length - 1 ? (
            <button className="btn btn-primary btn-sm gap-1 mr-auto" onClick={() => setStep(s => s + 1)}>
              הבא <ChevronLeft size={13} />
            </button>
          ) : (
            <button
              className={`btn btn-sm gap-1.5 mr-auto ${canCheckIn ? 'btn-primary' : 'btn-secondary'}`}
              disabled={!canCheckIn || loading}
              style={!canCheckIn ? { opacity: 0.55 } : {}}
              onClick={handleCheckIn}
            >
              <LogIn size={14} />
              {loading ? 'מבצע...' : canCheckIn ? 'בצע צ׳ק-אין' : 'לא ניתן לצ׳ק-אין'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Walk-in Modal ──────────────────────────────────────────────────────────────
function WalkInModal({ propertyId, onClose, onDone }) {
  const [step,          setStep]      = useState(0);
  const [guestQuery,    setGuestQ]    = useState('');
  const [guestResults,  setGuestRes]  = useState([]);
  const [searching,     setSearching] = useState(false);
  const [selectedGuest, setGuest]     = useState(null);
  const [isNew,         setIsNew]     = useState(false);
  const [newGuest,      setNewGuest]  = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [arrival,       setArrival]   = useState(TODAY);
  const [departure,     setDeparture] = useState('');
  const [roomTypeId,    setRoomType]  = useState('');
  const [ratePerNight,  setRate]      = useState('');
  const [avail,         setAvail]     = useState(null);
  const [availLoading,  setAvailLoad] = useState(false);
  const [loading,       setLoading]   = useState(false);
  const [error,         setError]     = useState('');
  const debounce = useRef(null);
  const { toasts, success, error: toastErr } = useToast();
  const { data: roomTypes } = useApi(() => propApi.roomTypes(propertyId), [propertyId], false);

  // Default departure = tomorrow
  useEffect(() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    setDeparture(t.toISOString().split('T')[0]);
  }, []);

  // Check availability when room type / dates change
  useEffect(() => {
    if (step !== 1 || !roomTypeId || !arrival || !departure) return;
    setAvailLoad(true);
    setAvail(null);
    resApi.availability(propertyId, roomTypeId, arrival, departure)
      .then(r => { setAvail(r); if (r?.suggestedRate && !ratePerNight) setRate(String(r.suggestedRate)); })
      .catch(() => setAvail(null))
      .finally(() => setAvailLoad(false));
  }, [step, roomTypeId, arrival, departure]);

  function searchGuests(q) {
    setGuestQ(q);
    clearTimeout(debounce.current);
    if (q.length < 2) { setGuestRes([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await guestsApi.list(propertyId, q);
        setGuestRes(Array.isArray(r) ? r : r?.data || []);
      } catch { setGuestRes([]); }
      finally { setSearching(false); }
    }, 400);
  }

  const nights = (arrival && departure) ? Math.round((new Date(departure) - new Date(arrival)) / 86400000) : 0;
  const total  = nights > 0 && ratePerNight ? nights * Number(ratePerNight) : 0;

  const step0Valid = selectedGuest || (isNew && newGuest.firstName && newGuest.lastName);
  const step1Valid = roomTypeId && arrival && departure && nights > 0 && ratePerNight;

  async function handleFinish() {
    setError('');
    setLoading(true);
    try {
      let guestId = selectedGuest?._id;
      if (isNew || !guestId) {
        if (!newGuest.firstName || !newGuest.lastName) { setError('שם פרטי ושם משפחה נדרשים'); setLoading(false); return; }
        const created = await guestsApi.create({ ...newGuest, propertyId });
        guestId = created._id;
      }

      const reservation = await resApi.create({
        propertyId,
        roomTypeId,
        arrivalDate:     arrival,
        departureDate:   departure,
        primaryGuestId:  String(guestId),
        adults:          1,
        children:        0,
        ratePerNight:    Number(ratePerNight),
        source:          'walk_in',
        bookingStatus:   'confirmed',
      });

      // Attempt immediate check-in (non-blocking on failure)
      await resApi.checkIn(String(reservation._id), false).catch(() => null);
      success('Walk-in בוצע בהצלחה!');
      setTimeout(() => { onDone(); onClose(); }, 600);
    } catch (e) { setError(e.message || 'שגיאה ביצירת Walk-in'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ direction: 'rtl' }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden" style={{ maxHeight: '92vh' }}>
        <ToastContainer toasts={toasts} />

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-border">
          <div>
            <div className="font-bold text-ink">Walk-in</div>
            <div className="text-xs text-ink-muted">הזמנה ספוטנית + צ׳ק-אין מיידי</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Steps indicator */}
        <div className="flex border-b border-surface-border">
          {['אורח', 'פרטי שהייה', 'אישור'].map((label, i) => (
            <div key={i} className={`flex-1 py-2 text-center text-xs font-semibold ${i === step ? 'text-brand' : 'text-ink-muted'}`}
              style={{ borderBottom: i === step ? '2px solid #6366f1' : '2px solid transparent' }}>
              {label}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Step 0: Guest */}
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <div className="text-xs font-semibold text-ink-secondary">חפש אורח קיים</div>
              <div className="relative">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input className="input pr-8 text-sm" placeholder="שם / אימייל / טלפון..." value={guestQuery} onChange={e => searchGuests(e.target.value)} />
              </div>
              {searching && <div className="text-xs text-ink-muted text-center py-1">מחפש...</div>}
              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                {guestResults.map(g => (
                  <button key={String(g._id)}
                    onClick={() => { setGuest(g); setIsNew(false); setGuestQ(`${g.firstName} ${g.lastName}`); setGuestRes([]); }}
                    className={`card p-3 text-right hover:bg-surface-hover cursor-pointer ${selectedGuest?._id === g._id ? 'border-brand' : ''}`}>
                    <div className="font-semibold text-sm text-ink">{g.firstName} {g.lastName}</div>
                    <div className="text-xs text-ink-muted">{g.email} · {g.phone}</div>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-surface-border" />
                <span className="text-xs text-ink-faint">או</span>
                <div className="flex-1 h-px bg-surface-border" />
              </div>
              <button className={`btn btn-sm gap-1.5 ${isNew ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setIsNew(true); setGuest(null); }}>
                <Plus size={13} /> אורח חדש
              </button>
              {isNew && (
                <div className="grid grid-cols-2 gap-2">
                  <input className="input text-sm" placeholder="שם פרטי *" value={newGuest.firstName} onChange={e => setNewGuest(g => ({ ...g, firstName: e.target.value }))} />
                  <input className="input text-sm" placeholder="שם משפחה *" value={newGuest.lastName} onChange={e => setNewGuest(g => ({ ...g, lastName: e.target.value }))} />
                  <input className="input text-sm col-span-2" placeholder="אימייל" type="email" value={newGuest.email} onChange={e => setNewGuest(g => ({ ...g, email: e.target.value }))} />
                  <input className="input text-sm col-span-2" placeholder="טלפון" value={newGuest.phone} onChange={e => setNewGuest(g => ({ ...g, phone: e.target.value }))} />
                </div>
              )}
            </div>
          )}

          {/* Step 1: Dates & Room */}
          {step === 1 && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1">הגעה</label>
                  <input className="input text-num" type="date" value={arrival} min={TODAY} onChange={e => setArrival(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1">עזיבה</label>
                  <input className="input text-num" type="date" value={departure} min={arrival || TODAY} onChange={e => setDeparture(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1">סוג חדר</label>
                <select className="select w-full" value={roomTypeId} onChange={e => setRoomType(e.target.value)}>
                  <option value="">בחר סוג חדר...</option>
                  {(roomTypes || []).map(rt => (
                    <option key={String(rt._id)} value={String(rt._id)}>{rt.name}</option>
                  ))}
                </select>
              </div>
              {availLoading && <div className="text-xs text-ink-muted text-center">בודק זמינות...</div>}
              {avail && (
                <div className={`flex items-center gap-2 p-2.5 rounded-lg text-xs font-semibold ${avail.available ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {avail.available ? <><CheckCircle2 size={12} /> זמין — {avail.availableCount} חדרים</> : <><AlertCircle size={12} /> לא זמין — {avail.reason}</>}
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-ink-secondary block mb-1">מחיר ללילה (₪)</label>
                <input className="input text-num" type="number" min={0} step={10} placeholder="₪" value={ratePerNight} onChange={e => setRate(e.target.value)} />
              </div>
              {nights > 0 && ratePerNight && (
                <div className="bg-surface-hover rounded-xl p-3 text-xs flex flex-col gap-1">
                  <div className="flex justify-between"><span className="text-ink-muted">לילות:</span><span className="font-bold text-num">{nights}</span></div>
                  <div className="flex justify-between"><span className="text-ink-muted">מחיר ללילה:</span><span className="font-bold text-num">₪{Number(ratePerNight).toLocaleString()}</span></div>
                  <div className="flex justify-between border-t border-surface-border mt-1 pt-1"><span className="font-bold text-ink">סה״כ:</span><span className="font-black text-num text-ink">₪{total.toLocaleString()}</span></div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Confirm */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="card p-4 flex flex-col gap-2 text-sm">
                <div className="text-xs font-bold text-ink-secondary mb-1">סיכום Walk-in</div>
                <div className="flex justify-between"><span className="text-ink-muted">אורח:</span><span className="font-semibold text-ink">{isNew ? `${newGuest.firstName} ${newGuest.lastName}` : `${selectedGuest?.firstName} ${selectedGuest?.lastName}`}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">הגעה:</span><span className="font-semibold text-num">{arrival}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">עזיבה:</span><span className="font-semibold text-num">{departure}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">לילות:</span><span className="font-semibold text-num">{nights}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">מחיר ללילה:</span><span className="font-semibold text-num">₪{Number(ratePerNight).toLocaleString()}</span></div>
                <div className="flex justify-between border-t border-surface-border pt-2 mt-1"><span className="font-bold text-ink">סה״כ:</span><span className="font-black text-num text-ink text-base">₪{total.toLocaleString()}</span></div>
              </div>
              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 p-4 border-t border-surface-border">
          <button className="btn btn-secondary btn-sm gap-1" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronRight size={13} /> הקודם
          </button>
          {step < 2 ? (
            <button className="btn btn-primary btn-sm gap-1 mr-auto"
              onClick={() => setStep(s => s + 1)}
              disabled={(step === 0 && !step0Valid) || (step === 1 && !step1Valid)}>
              הבא <ChevronLeft size={13} />
            </button>
          ) : (
            <button className="btn btn-primary btn-sm gap-1.5 mr-auto" onClick={handleFinish} disabled={loading || !ratePerNight}>
              <LogIn size={13} />
              {loading ? 'מבצע...' : 'בצע Walk-in וצ׳ק-אין'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Arrival Card (compact click-to-open) ──────────────────────────────────────
function ArrivalCard({ res, onOpen }) {
  const room      = res.assignedRoom;
  const hasRoom   = !!room;
  const roomReady = hasRoom && (room.cleanStatus === 'clean' || room.cleanStatus === 'inspected');
  const hasPay    = res.paymentStatus !== 'pending';
  const ready     = hasRoom && roomReady && hasPay;

  const nights  = res.nights || res.totalNights || '?';
  const total   = res.totalAmount ?? 0;
  const g       = res.primaryGuest || {};
  const initial = `${g.firstName?.slice(0,1) || ''}${g.lastName?.slice(0,1) || ''}`;

  return (
    <div
      className={`card p-4 cursor-pointer hover:shadow-card-hover transition-shadow ${res.isVip ? 'border-yellow-200 bg-yellow-50/20' : ''} ${!ready ? 'border-red-100' : ''}`}
      onClick={() => onOpen(res)}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="avatar font-bold"
          style={{ width: 40, height: 40, fontSize: 14,
            background: res.isVip ? 'rgba(234,179,8,0.15)' : 'rgba(99,102,241,0.1)',
            color:      res.isVip ? '#b45309' : '#6366f1' }}>
          {initial}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-ink">{g.firstName} {g.lastName}</span>
            {res.isVip && <Crown size={12} className="text-yellow-500" />}
          </div>
          <div className="text-xs text-ink-muted">{res.confirmationNumber} · {res.roomType?.name}</div>
          <div className="text-xs text-ink-muted">{nights} לילות · עד {res.departureDate}</div>
        </div>
        <div className="text-sm font-bold text-num text-ink">₪{Number(total).toLocaleString()}</div>
      </div>

      {/* Mini status badges */}
      <div className="flex gap-2 flex-wrap mb-3">
        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${hasRoom ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {hasRoom ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
          {hasRoom ? `חדר ${room.number}` : 'אין חדר'}
        </span>
        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${roomReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {roomReady ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
          {roomReady ? 'נקי' : room?.cleanStatus === 'dirty' ? 'מלוכלך' : room?.cleanStatus || 'לא מוכן'}
        </span>
        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${hasPay ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {hasPay ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
          {hasPay ? 'תשלום OK' : 'תשלום נדרש'}
        </span>
      </div>

      {res.specialRequests && <div className="text-xs text-brand mb-3">📌 {res.specialRequests}</div>}

      <button className={`btn w-full justify-center gap-2 text-sm ${ready ? 'btn-primary' : 'btn-secondary'}`} tabIndex={-1}>
        <LogIn size={14} />
        {ready ? 'פתח תהליך צ׳ק-אין' : 'צ׳ק-אין (יש בעיות)'}
      </button>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CheckInPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success, error: toastError } = useToast();

  const [selectedRes, setSelectedRes] = useState(null);
  const [showWalkIn,  setShowWalkIn]  = useState(false);

  const { data: arrivals, loading, error, refetch } = useApi(
    () => dashboard.arrivals(propertyId),
    [propertyId], skip
  );

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const list = arrivals || [];

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} />

      {selectedRes && (
        <CheckInModal
          res={selectedRes}
          propertyId={propertyId}
          onClose={() => setSelectedRes(null)}
          onDone={refetch}
        />
      )}

      {showWalkIn && (
        <WalkInModal
          propertyId={propertyId}
          onClose={() => setShowWalkIn(false)}
          onDone={refetch}
        />
      )}

      <div className="page-header">
        <div>
          <div className="page-title">צ׳ק-אין</div>
          <div className="page-subtitle">{list.length} אורחים מגיעים היום</div>
        </div>
        <button className="btn btn-primary gap-1.5" onClick={() => setShowWalkIn(true)}>
          <Plus size={14} /> Walk-in
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty-state mt-8">
          <LogIn size={32} className="empty-state-icon" />
          <span>אין הגעות להיום</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map(res => (
            <ArrivalCard key={String(res._id)} res={res} onOpen={setSelectedRes} />
          ))}
        </div>
      )}
    </div>
  );
}
