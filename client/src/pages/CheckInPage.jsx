import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogIn, Crown, AlertCircle, CheckCircle2, X, Search, Plus,
  Upload, Edit3, Banknote, Key, MessageSquare, Loader2,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { dashboard, reservations as resApi, guests as guestsApi, folio as folioApi, properties as propApi } from '../utils/api';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import { TODAY, toYmd } from '../utils/date';

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
    e.preventDefault(); drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e, canvasRef.current);
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
  }
  function draw(e) {
    if (!drawing.current) return; e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
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
    <div className="flex flex-col gap-1">
      <div className="relative border border-gray-300 rounded bg-white" style={{ touchAction: 'none' }}>
        <canvas ref={canvasRef} width={440} height={100}
          style={{ display: 'block', width: '100%', height: 100, cursor: 'crosshair' }}
          onPointerDown={startDraw} onPointerMove={draw}
          onPointerUp={endDraw} onPointerLeave={endDraw} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10">
          <Edit3 size={32} className="text-gray-500" />
        </div>
      </div>
      <button type="button" className="text-xs text-gray-400 hover:text-gray-600 self-end" onClick={clear}>נקה</button>
    </div>
  );
}

// ── Check-in Modal (single screen) ────────────────────────────────────────────
function CheckInModal({ res, propertyId, onClose, onDone }) {
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

  const room      = res.assignedRoom;
  const hasRoom   = !!room;
  const roomReady = hasRoom && (room.cleanStatus === 'clean' || room.cleanStatus === 'inspected');
  const hasPay    = res.paymentStatus !== 'pending';
  const canCI     = hasRoom && (roomReady || override) && hasPay;

  const g       = res.primaryGuest || {};
  const nights  = res.nights || res.totalNights || '?';
  const total   = res.totalAmount ?? 0;
  const initial = `${g.firstName?.slice(0,1) || ''}${g.lastName?.slice(0,1) || ''}`.toUpperCase();

  function handleIdFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIdFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setIdPreview(ev.target.result);
      reader.readAsDataURL(file);
    } else { setIdPreview(null); }
  }

  async function handleDeposit() {
    if (!depositAmount || Number(depositAmount) <= 0) return;
    setDepLoading(true);
    try {
      const folioData = await folioApi.getByReservation(String(res._id));
      if (folioData?._id) {
        await folioApi.deposit(String(folioData._id), { amount: Number(depositAmount), method: depositMethod, propertyId });
        success('פיקדון נרשם');
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
      success('צ׳ק-אין בוצע!');
      setTimeout(() => { onDone(); onClose(); }, 600);
    } catch (e) { toastErr(e.message || 'שגיאה בצ׳ק-אין'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col overflow-hidden" style={{ maxHeight: '92vh' }}>
        <ToastContainer toasts={toasts} />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
              {initial}
            </div>
            <div>
              <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                {g.firstName} {g.lastName}
                {res.isVip && <Crown size={13} className="text-yellow-500" />}
              </div>
              <div className="text-xs text-gray-400">
                {res.confirmationNumber} · {res.roomType?.name} · {nights} לילות · ₪{Number(total).toLocaleString()}
              </div>
            </div>
          </div>
          <button className="text-gray-400 hover:text-gray-600" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* Status row */}
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex flex-col gap-2">
            <div className="flex gap-4 text-xs flex-wrap">
              <span className={`flex items-center gap-1 font-medium ${hasRoom ? 'text-green-700' : 'text-red-600'}`}>
                {hasRoom ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                {hasRoom ? `חדר ${room.number}` : 'אין חדר מוקצה'}
              </span>
              <span className={`flex items-center gap-1 font-medium ${roomReady || override ? 'text-green-700' : 'text-amber-600'}`}>
                {roomReady || override ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                {roomReady ? 'נקי ומוכן' : override ? 'אישור ידני' : room?.cleanStatus || 'לא מוכן'}
              </span>
              <span className={`flex items-center gap-1 font-medium ${hasPay ? 'text-green-700' : 'text-red-600'}`}>
                {hasPay ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                {hasPay ? 'תשלום תקין' : 'נדרש תשלום'}
              </span>
            </div>
            {hasRoom && !roomReady && (
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} className="rounded" />
                אישור ידני — צ׳ק-אין למרות שהחדר לא מוכן
              </label>
            )}
            {res.specialRequests && (
              <div className="text-xs text-gray-600 border-t border-gray-200 pt-2">
                📌 {res.specialRequests}
              </div>
            )}
          </div>

          <div className="px-5 py-4 flex flex-col gap-5">

            {/* ID document */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                <Upload size={12} /> מסמך מזהה <span className="font-normal text-gray-400">(רשות)</span>
              </div>
              {!idFile ? (
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded cursor-pointer hover:border-gray-400 text-sm text-gray-500">
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleIdFile} />
                  <Upload size={13} /> בחר קובץ
                </label>
              ) : (
                <div className="flex items-center gap-2">
                  {idPreview
                    ? <img src={idPreview} alt="" className="h-14 rounded border border-gray-200 object-contain" />
                    : <div className="flex items-center gap-1.5 text-xs text-green-700"><CheckCircle2 size={12} /> {idFile.name}</div>
                  }
                  <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => { setIdFile(null); setIdPreview(null); }}>
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Signature */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                <Edit3 size={12} /> חתימה דיגיטלית <span className="font-normal text-gray-400">(רשות)</span>
              </div>
              <SignatureCanvas onSigned={setSignature} />
              {signature && (
                <div className="flex items-center gap-1.5 mt-1 text-xs text-green-700">
                  <CheckCircle2 size={11} /> חתימה נקלטה
                </div>
              )}
            </div>

            {/* Deposit */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                <Banknote size={12} /> פיקדון <span className="font-normal text-gray-400">(רשות)</span>
              </div>
              <div className="flex gap-2">
                <input type="number" className="input text-sm flex-1" min={0} step={1}
                  placeholder="סכום ₪"
                  value={depositAmount} onChange={e => setDepAmt(e.target.value)} />
                <select className="select text-sm" style={{ width: 140 }}
                  value={depositMethod} onChange={e => setDepMethod(e.target.value)}>
                  <option value="credit_card">כרטיס אשראי</option>
                  <option value="cash">מזומן</option>
                  <option value="bank_transfer">העברה בנקאית</option>
                  <option value="voucher">שובר</option>
                </select>
                <button type="button" className="btn btn-secondary text-sm gap-1 flex-shrink-0"
                  disabled={!depositAmount || Number(depositAmount) <= 0 || depLoading}
                  onClick={handleDeposit}>
                  {depLoading ? <Loader2 size={12} className="animate-spin" /> : 'רשום'}
                </button>
              </div>
            </div>

            {/* Key + welcome */}
            <div className="flex flex-col gap-2 border-t border-gray-100 pt-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" checked={keyHandout} onChange={e => setKey(e.target.checked)} className="rounded border-gray-300" />
                <Key size={13} className="text-gray-400" /> מפתח / כרטיס חדר נמסר
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" checked={sendWelcome} onChange={e => setWelcome(e.target.checked)} className="rounded border-gray-300" />
                <MessageSquare size={13} className="text-gray-400" /> שלח הודעת ברוך הבא
              </label>
            </div>

            {!canCI && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold mb-0.5">לא ניתן לבצע צ׳ק-אין</div>
                  {!hasRoom && <div>חדר לא מוקצה</div>}
                  {hasRoom && !roomReady && !override && <div>החדר לא נקי — יש לאשר ידנית</div>}
                  {!hasPay && <div>תשלום לא הושלם</div>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button className="btn btn-secondary text-sm" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary text-sm gap-1.5"
            disabled={!canCI || loading} onClick={handleCheckIn}>
            {loading
              ? <><Loader2 size={13} className="animate-spin" /> מבצע...</>
              : <><LogIn size={13} /> בצע צ׳ק-אין</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Walk-in Modal (single form) ────────────────────────────────────────────────
function WalkInModal({ propertyId, onClose, onDone }) {
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

  useEffect(() => {
    const t = new Date(); t.setDate(t.getDate() + 1);
    setDeparture(toYmd(t));
  }, []);

  useEffect(() => {
    if (!roomTypeId || !arrival || !departure) return;
    setAvailLoad(true); setAvail(null);
    resApi.availability(propertyId, roomTypeId, arrival, departure)
      .then(r => { setAvail(r); if (r?.suggestedRate && !ratePerNight) setRate(String(r.suggestedRate)); })
      .catch(() => setAvail(null))
      .finally(() => setAvailLoad(false));
  }, [roomTypeId, arrival, departure]);

  function searchGuests(q) {
    setGuestQ(q); clearTimeout(debounce.current);
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

  const nights = (arrival && departure)
    ? Math.round((new Date(departure) - new Date(arrival)) / 86400000) : 0;
  const total = nights > 0 && ratePerNight ? nights * Number(ratePerNight) : 0;
  const guestOk = selectedGuest || (isNew && newGuest.firstName && newGuest.lastName);
  const canSubmit = guestOk && roomTypeId && arrival && departure && nights > 0 && Number(ratePerNight) > 0;

  async function handleSubmit() {
    setError(''); setLoading(true);
    try {
      let guestId = selectedGuest?._id;
      if (isNew || !guestId) {
        if (!newGuest.firstName || !newGuest.lastName) { setError('שם פרטי ושם משפחה נדרשים'); setLoading(false); return; }
        const created = await guestsApi.create({ ...newGuest, propertyId });
        guestId = created._id;
      }
      const reservation = await resApi.create({
        propertyId, roomTypeId,
        arrivalDate: arrival, departureDate: departure,
        primaryGuestId: String(guestId),
        adults: 1, children: 0,
        ratePerNight: Number(ratePerNight),
        source: 'walk_in', bookingStatus: 'confirmed',
      });
      await resApi.checkIn(String(reservation._id), false).catch(() => null);
      success('Walk-in בוצע בהצלחה!');
      setTimeout(() => { onDone(); onClose(); }, 600);
    } catch (e) { setError(e.message || 'שגיאה ביצירת Walk-in'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col overflow-hidden" style={{ maxHeight: '92vh' }}>
        <ToastContainer toasts={toasts} />

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <div className="font-semibold text-gray-900">Walk-in</div>
            <div className="text-xs text-gray-400">הזמנה ספונטנית + צ׳ק-אין מיידי</div>
          </div>
          <button className="text-gray-400 hover:text-gray-600" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {/* Guest */}
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-2">אורח</div>
            <div className="relative mb-2">
              <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pr-8 text-sm w-full" placeholder="חפש לפי שם / אימייל / טלפון..."
                value={guestQuery} onChange={e => searchGuests(e.target.value)} />
            </div>
            {searching && <div className="text-xs text-gray-400 pb-1">מחפש...</div>}
            {guestResults.length > 0 && (
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto border border-gray-200 rounded mb-2">
                {guestResults.map(g => (
                  <button key={String(g._id)}
                    onClick={() => { setGuest(g); setIsNew(false); setGuestQ(`${g.firstName} ${g.lastName}`); setGuestRes([]); }}
                    className={`px-3 py-2 text-right hover:bg-gray-50 text-sm border-b border-gray-100 last:border-b-0 ${selectedGuest?._id === g._id ? 'bg-blue-50' : ''}`}>
                    <div className="font-medium text-gray-900">{g.firstName} {g.lastName}</div>
                    <div className="text-xs text-gray-400">{g.email} · {g.phone}</div>
                  </button>
                ))}
              </div>
            )}
            {selectedGuest && !isNew && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-green-50 border border-green-200 rounded text-sm text-green-700">
                <span>{selectedGuest.firstName} {selectedGuest.lastName}</span>
                <button onClick={() => { setGuest(null); setGuestQ(''); }} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>
              </div>
            )}
            <button
              className={`mt-2 text-xs font-medium flex items-center gap-1 ${isNew ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => { setIsNew(v => !v); setGuest(null); }}>
              <Plus size={12} /> אורח חדש
            </button>
            {isNew && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input className="input text-sm" placeholder="שם פרטי *" value={newGuest.firstName} onChange={e => setNewGuest(g => ({ ...g, firstName: e.target.value }))} />
                <input className="input text-sm" placeholder="שם משפחה *" value={newGuest.lastName} onChange={e => setNewGuest(g => ({ ...g, lastName: e.target.value }))} />
                <input className="input text-sm col-span-2" placeholder="אימייל" type="email" value={newGuest.email} onChange={e => setNewGuest(g => ({ ...g, email: e.target.value }))} />
                <input className="input text-sm col-span-2" placeholder="טלפון" value={newGuest.phone} onChange={e => setNewGuest(g => ({ ...g, phone: e.target.value }))} />
              </div>
            )}
          </div>

          {/* Stay */}
          <div className="border-t border-gray-100 pt-4">
            <div className="text-xs font-semibold text-gray-500 mb-2">שהייה</div>
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">הגעה</label>
                  <input className="input text-sm w-full" type="date" value={arrival} min={TODAY} onChange={e => setArrival(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">יציאה</label>
                  <input className="input text-sm w-full" type="date" value={departure} min={arrival || TODAY} onChange={e => setDeparture(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">סוג חדר</label>
                <select className="select w-full text-sm" value={roomTypeId} onChange={e => setRoomType(e.target.value)}>
                  <option value="">בחר סוג חדר...</option>
                  {(roomTypes || []).map(rt => (
                    <option key={String(rt._id)} value={String(rt._id)}>{rt.name}</option>
                  ))}
                </select>
              </div>
              {availLoading && <div className="text-xs text-gray-400">בודק זמינות...</div>}
              {avail && (
                <div className={`text-xs font-medium flex items-center gap-1 ${avail.available ? 'text-green-700' : 'text-red-600'}`}>
                  {avail.available ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                  {avail.available ? `זמין — ${avail.availableCount || ''} חדרים` : `לא זמין — ${avail.reason || ''}`}
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-400 mb-1">מחיר ללילה (₪)</label>
                <input className="input text-sm" type="number" min={0} step={10} placeholder="₪"
                  style={{ width: 120 }}
                  value={ratePerNight} onChange={e => setRate(e.target.value)} />
              </div>
              {total > 0 && (
                <div className="flex items-baseline gap-2 pt-1">
                  <span className="text-base font-bold text-gray-900">₪{total.toLocaleString()}</span>
                  <span className="text-xs text-gray-400">{nights} לילות</span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
              <AlertCircle size={12} />{error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button className="btn btn-secondary text-sm" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary text-sm gap-1.5" disabled={!canSubmit || loading} onClick={handleSubmit}>
            {loading
              ? <><Loader2 size={13} className="animate-spin" /> מבצע...</>
              : <><LogIn size={13} /> בצע Walk-in</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Arrival Row (table row, not card) ─────────────────────────────────────────
function ArrivalRow({ res, onOpen }) {
  const room      = res.assignedRoom;
  const hasRoom   = !!room;
  const roomReady = hasRoom && (room.cleanStatus === 'clean' || room.cleanStatus === 'inspected');
  const hasPay    = res.paymentStatus !== 'pending';
  const ready     = hasRoom && roomReady && hasPay;

  const g      = res.primaryGuest || {};
  const nights = res.nights || res.totalNights || '?';
  const total  = res.totalAmount ?? 0;
  const initial = `${g.firstName?.slice(0,1) || ''}${g.lastName?.slice(0,1) || ''}`.toUpperCase();

  return (
    <tr className="hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
      onClick={() => onOpen(res)}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-600 flex-shrink-0">
            {initial}
          </div>
          <div>
            <div className="font-medium text-gray-900 text-sm flex items-center gap-1">
              {g.firstName} {g.lastName}
              {res.isVip && <Crown size={11} className="text-yellow-500" />}
            </div>
            <div className="text-xs text-gray-400">{res.confirmationNumber}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{res.roomType?.name || '—'}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{nights} לילות</td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium flex items-center gap-1 ${hasRoom ? 'text-green-700' : 'text-red-600'}`}>
          {hasRoom ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {hasRoom ? `חדר ${room.number}` : 'אין חדר'}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium flex items-center gap-1 ${roomReady ? 'text-green-700' : 'text-amber-600'}`}>
          {roomReady ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {roomReady ? 'נקי' : room?.cleanStatus || 'לא ידוע'}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium flex items-center gap-1 ${hasPay ? 'text-green-700' : 'text-red-600'}`}>
          {hasPay ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {hasPay ? 'שולם' : 'נדרש תשלום'}
        </span>
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-left">
        ₪{Number(total).toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <button
          className={`text-xs font-medium px-3 py-1 rounded border ${ready ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-700' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          tabIndex={-1}>
          {ready ? 'צ׳ק-אין' : 'פתח'}
        </button>
      </td>
    </tr>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CheckInPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;

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
    <div dir="rtl" className="bg-gray-50 min-h-screen">
      {selectedRes && (
        <CheckInModal res={selectedRes} propertyId={propertyId}
          onClose={() => setSelectedRes(null)} onDone={refetch} />
      )}
      {showWalkIn && (
        <WalkInModal propertyId={propertyId}
          onClose={() => setShowWalkIn(false)} onDone={refetch} />
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-900">צ׳ק-אין</h1>
          <p className="text-xs text-gray-400 mt-0.5">{list.length} אורחים מגיעים היום</p>
        </div>
        <button className="btn btn-primary text-sm gap-1.5" onClick={() => setShowWalkIn(true)}>
          <Plus size={13} /> Walk-in
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {list.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg py-16 text-center">
            <LogIn size={28} className="text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">אין הגעות להיום</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                  <th className="px-4 py-3 text-right font-medium">אורח</th>
                  <th className="px-4 py-3 text-right font-medium">סוג חדר</th>
                  <th className="px-4 py-3 text-right font-medium">לילות</th>
                  <th className="px-4 py-3 text-right font-medium">חדר</th>
                  <th className="px-4 py-3 text-right font-medium">ניקיון</th>
                  <th className="px-4 py-3 text-right font-medium">תשלום</th>
                  <th className="px-4 py-3 text-left font-medium">סכום</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(res => (
                  <ArrivalRow key={String(res._id)} res={res} onOpen={setSelectedRes} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
