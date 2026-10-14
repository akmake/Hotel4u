// FD-02-A05 — walk-in: create a same-day reservation (source walk_in), then continue in the
// check-in wizard like any other arrival. The reservation is never checked in silently.
import { useEffect, useRef, useState } from 'react';
import { reservations as resApi, guests as guestsApi, properties as propApi } from '../../utils/api';
import { addDays, diffDays } from '../../utils/date';
import { Modal, Field, Spinner, ErrorBanner } from '../kit';

export default function WalkInDialog({ open, propertyId, businessDate, onClose, onCreated }) {
  const [roomTypes, setRoomTypes] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [guest, setGuest] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [newGuest, setNewGuest] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [departure, setDeparture] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [adults, setAdults] = useState(1);
  const [rate, setRate] = useState('');
  const [avail, setAvail] = useState(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const debounce = useRef(null);
  const arrival = businessDate;

  useEffect(() => {
    if (!open || !businessDate) return;
    setQuery(''); setResults([]); setGuest(null); setIsNew(false); setNewGuest({ firstName: '', lastName: '', phone: '', email: '' });
    setDeparture(addDays(businessDate, 1)); setRoomTypeId(''); setAdults(1); setRate(''); setAvail(null); setError(null);
    propApi.roomTypes(propertyId).then((r) => setRoomTypes(Array.isArray(r) ? r : r?.data || [])).catch(() => setRoomTypes([]));
  }, [open, propertyId, businessDate]);

  useEffect(() => {
    if (!open || !roomTypeId || !departure || departure <= arrival) { setAvail(null); return; }
    let alive = true;
    setAvailLoading(true);
    resApi.availability(propertyId, roomTypeId, arrival, departure)
      .then((r) => { if (!alive) return; setAvail(r); if (r?.suggestedRate) setRate((v) => v || String(r.suggestedRate)); })
      .catch(() => alive && setAvail(null))
      .finally(() => alive && setAvailLoading(false));
    return () => { alive = false; };
  }, [open, propertyId, roomTypeId, arrival, departure]);

  function search(q) {
    setQuery(q);
    clearTimeout(debounce.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await guestsApi.list(propertyId, q.trim());
        setResults(Array.isArray(r) ? r : r?.data || []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 300);
  }

  const nights = departure && arrival ? diffDays(arrival, departure) : 0;
  const minDeparture = arrival ? addDays(arrival, 1) : undefined; // business date may still be loading
  const guestOk = guest || (isNew && newGuest.firstName.trim() && newGuest.lastName.trim());
  const missing = !guestOk ? 'יש לבחור או ליצור אורח'
    : !roomTypeId ? 'יש לבחור סוג חדר'
      : nights < 1 ? 'תאריך עזיבה חייב להיות אחרי היום'
        : !(Number(rate) > 0) ? 'יש להזין מחיר ללילה'
          : avail && avail.available === false ? 'אין זמינות לסוג החדר בתאריכים' : null;

  async function submit() {
    setSaving(true); setError(null);
    try {
      let guestId = guest?._id;
      if (!guestId) {
        const created = await guestsApi.create({ ...newGuest, propertyId });
        guestId = created._id;
      }
      const reservation = await resApi.create({
        propertyId,
        roomTypeId,
        arrivalDate: arrival,
        departureDate: departure,
        primaryGuestId: String(guestId),
        adults: Number(adults) || 1,
        children: 0,
        ratePerNight: Number(rate),
        source: 'walk_in',
        bookingStatus: 'confirmed',
      });
      onCreated?.(reservation);
    } catch (e) {
      setError(e.message || 'יצירת ההזמנה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title="הזמנת Walk-in"
      subtitle="הזמנה להיום ממקור ״קבלה״. אחרי היצירה ממשיכים לאשף הכניסה."
      footer={(
        <>
          {missing && <span className="ui-foot-note">{missing}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!!missing || saving}>
            {saving ? <><Spinner /> יוצר…</> : 'יצירה והמשך לכניסה'}
          </button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      <Field id="wi-search" label="אורח" required hint="חיפוש לפי שם, טלפון או דוא״ל — לפני יצירת אורח חדש, כדי למנוע כפילות">
        {guest ? (
          <div className="ui-picked">
            <span>{guest.firstName} {guest.lastName}{guest.phone ? ` · ${guest.phone}` : ''}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setGuest(null); setQuery(''); }}>החלפה</button>
          </div>
        ) : (
          <>
            <input id="wi-search" className="input w-full" value={query} onChange={(e) => search(e.target.value)} placeholder="לפחות 2 תווים" disabled={isNew} />
            {searching && <div className="ui-hint"><Spinner size={11} /> מחפש…</div>}
            {results.length > 0 && !isNew && (
              <ul className="ui-results" role="listbox" aria-label="תוצאות חיפוש אורחים">
                {results.slice(0, 8).map((g) => (
                  <li key={g._id}>
                    <button type="button" onClick={() => { setGuest(g); setResults([]); }}>
                      <span className="font-medium">{g.firstName} {g.lastName}</span>
                      <span className="text-[rgb(var(--fg-muted))]">{[g.phone, g.email].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim().length >= 2 && !searching && results.length === 0 && !isNew && <div className="ui-hint">לא נמצא אורח תואם.</div>}
            <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => setIsNew((v) => !v)}>{isNew ? 'חזרה לחיפוש' : '+ אורח חדש'}</button>
          </>
        )}
      </Field>
      {isNew && !guest && (
        <div className="ui-grid-2">
          <Field id="wi-first" label="שם פרטי" required><input id="wi-first" className="input w-full" maxLength={200} value={newGuest.firstName} onChange={(e) => setNewGuest((g) => ({ ...g, firstName: e.target.value }))} /></Field>
          <Field id="wi-last" label="שם משפחה" required><input id="wi-last" className="input w-full" maxLength={200} value={newGuest.lastName} onChange={(e) => setNewGuest((g) => ({ ...g, lastName: e.target.value }))} /></Field>
          <Field id="wi-phone" label="טלפון" optional><input id="wi-phone" className="input w-full" dir="ltr" value={newGuest.phone} onChange={(e) => setNewGuest((g) => ({ ...g, phone: e.target.value }))} /></Field>
          <Field id="wi-email" label="דוא״ל" optional><input id="wi-email" type="email" className="input w-full" dir="ltr" value={newGuest.email} onChange={(e) => setNewGuest((g) => ({ ...g, email: e.target.value }))} /></Field>
        </div>
      )}
      <div className="ui-grid-2">
        <Field id="wi-dep" label="עזיבה" required hint={nights > 0 ? `${nights} לילות מהיום` : undefined}>
          <input id="wi-dep" type="date" className="input w-full" min={minDeparture} value={departure} onChange={(e) => setDeparture(e.target.value)} />
        </Field>
        <Field id="wi-rt" label="סוג חדר" required>
          <select id="wi-rt" className="select w-full" value={roomTypeId} onChange={(e) => { setRoomTypeId(e.target.value); setRate(''); }}>
            <option value="">בחירה…</option>
            {roomTypes.map((rt) => <option key={rt._id} value={rt._id}>{rt.name}</option>)}
          </select>
        </Field>
        <Field id="wi-adults" label="מבוגרים" required>
          <input id="wi-adults" type="number" min={1} max={10} className="input w-full" value={adults} onChange={(e) => setAdults(e.target.value)} />
        </Field>
        <Field id="wi-rate" label="מחיר ללילה (₪)" required hint={availLoading ? 'בודק זמינות…' : avail ? (avail.available ? `זמין · ${avail.availableCount ?? ''} חדרים` : 'אין זמינות בתאריכים') : undefined}>
          <input id="wi-rate" type="number" min={1} step={1} className="input w-full" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
