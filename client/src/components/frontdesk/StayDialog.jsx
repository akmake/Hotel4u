// Reservation details for the desk, as a proper dialog: the stay, the room (with its state), the
// money, the guest and every note on one screen — and the next action (check-in / check-out).
import { useEffect, useState } from 'react';
import { LogIn, LogOut, Moon, User, Baby, Mail, Phone, Banknote, Check, FileText } from 'lucide-react';
import { reservations as resApi, finance } from '../../utils/api';
import { useChargeCodes } from '../../hooks/useChargeCodes';
import { cleanLabel, opsLabel } from '../../lib/labels';
import { formatShort } from '../../utils/date';
import { Modal, Spinner, ErrorBanner, newOpKey } from '../kit';
import PaymentMethodFields, { emptyDetails, detailsMissing, detailsPayload } from '../fin/PaymentMethodFields';
import { IssueDocumentDialog } from '../fin/DocumentDialogs';

const money = (n) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(Number(n || 0));
const STATUS = {
  confirmed: ['מאושרת', ''], modified: ['עודכנה', ''], pending_payment: ['ממתינה לתשלום', 'warn'],
  in_house: ['שוהה', 'ok'], checked_in: ['שוהה', 'ok'], partially_checked_in: ['כניסה חלקית', 'warn'], partially_checked_out: ['יציאה חלקית', 'warn'],
  checked_out: ['יצא', ''], cancelled: ['בוטלה', 'bad'], no_show: ['לא הגיע', 'bad'],
};
const PAY = { paid: ['שולם', 'ok'], partial: ['שולם חלקית', 'warn'], balance_due: ['יתרה פתוחה', 'warn'], unpaid: ['לא שולם', 'bad'], pending: ['ממתין', 'warn'], refunded: ['הוחזר', ''] };
const nights = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));

function KV({ label, children }) {
  return <div className="sd-kv"><span>{label}</span><div>{children}</div></div>;
}

// Money of the stay and taking a payment in the middle of it. A payment against posted charges is a
// payment; paying ahead of nights not yet charged is a deposit — the server enforces both caps.
function PaymentCard({ res, propertyId, total, onChanged }) {
  const [stay, setStay] = useState(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  const [details, setDetails] = useState(emptyDetails('cash'));
  const [docFor, setDocFor] = useState(null);
  const [key, setKey] = useState(newOpKey());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [done, setDone] = useState(null);
  const { payments } = useChargeCodes(propertyId);
  const methods = payments.filter((m) => m.active);

  const load = () => finance.stay(propertyId, res._id).then(setStay).catch(() => setStay(null));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [res._id]);

  const windows = stay?.folios || [];
  // A group may have several accounts: the booker's and rooms that pay for themselves.
  const accounts = windows.filter((w) => w.status !== 'closed');
  const [accountId, setAccountId] = useState(null);
  const fallback = accounts.find((w) => w.ownerType === 'guest') || accounts[0];
  const target = accounts.find((w) => w.id === accountId) || fallback;
  const paid = windows.reduce((a, w) => a + Number(w.totals?.payments || 0), 0);
  const balance = Math.max(0, Number(target?.balance || 0));
  const remaining = Math.max(0, Number(total || 0) - paid);
  const suggested = Math.round((balance > 0.005 ? balance : accounts.length > 1 ? 0 : remaining) * 100) / 100;
  // Transfer / card / cheque / voucher details come from PaymentMethodFields; a catalogue may also
  // ask for a reference on cash (e.g. a cash-register slip).
  const needRef = method === 'cash' && !!methods.find((m) => m.code === 'cash')?.requireReference;
  const missing = detailsMissing(method, details, Number(amount));
  const closedStay = ['cancelled', 'no_show', 'checked_out'].includes(res.status) && !target;

  const startOpen = () => { setAmount(String(suggested || '')); setDetails(emptyDetails(method)); setError(null); setFields({}); setDone(null); setOpen(true); };

  async function submit() {
    setSaving(true); setError(null); setFields({});
    try {
      const amt = Number(amount);
      const kind = balance > 0.005 && amt <= balance + 0.005 ? 'payment' : 'deposit';
      const folioId = target?.id || (await finance.ensureFolio(propertyId, res._id)).folioId;
      const out = await finance.pay(propertyId, folioId, { kind, amount: amt, method, details: detailsPayload(method, details), methodRef: needRef ? ref.trim() : undefined, idempotencyKey: key });
      setDone({ text: `התקבל תשלום של ${money(amt)}${out?.change ? ` · עודף לאורח ${money(out.change)}` : ''}`, folioId });
      setOpen(false); setRef(''); setDetails(emptyDetails(method)); setKey(newOpKey());
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message); setFields(e.fields || {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="sd-card">
      <h3>תשלום</h3>
      <div className="sd-total"><b>{money(total)}</b><span>{money(res.ratePerNight)} × {nights(res.arrivalDate, res.departureDate)} לילות{Number(res.roomsCount) > 1 ? ` × ${res.roomsCount} חדרים` : ''}</span></div>
      <KV label="שולם עד כה"><b>{money(paid)}</b></KV>
      <KV label="יתרה לתשלום"><b className={remaining > 0.005 ? 'sd-due' : 'sd-okc'}>{money(remaining)}</b></KV>
      {accounts.length > 1 && (
        <div className="sd-accounts" role="radiogroup" aria-label="חשבון">
          {accounts.map((w) => (
            <button type="button" key={w.id} role="radio" aria-checked={target?.id === w.id} className={`sd-acc ${target?.id === w.id ? 'is-on' : ''}`} onClick={() => { setAccountId(w.id); if (open) setAmount(String(Math.max(0, Math.round(Number(w.balance || 0) * 100) / 100) || '')); }}>
              <span>{w.ownerType === 'guest' ? 'המזמין' : w.owner}</span>
              <b className={Number(w.balance) > 0.005 ? 'sd-due' : 'sd-okc'}>{money(Math.max(0, Number(w.balance || 0)))}</b>
              <small>חויב {money(w.totals?.charges)} · שולם {money(w.totals?.payments)}</small>
            </button>
          ))}
        </div>
      )}
      {done && (
        <div className="sd-done">
          <Check size={14} />{done.text}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginInlineStart: 'auto' }} onClick={() => setDocFor(done.folioId)}><FileText size={14} />הפקת קבלה / חשבונית</button>
        </div>
      )}
      {!open && !closedStay && (
        <div className="sd-payact">
          <button type="button" className="btn btn-primary" onClick={startOpen} disabled={remaining <= 0.005 && balance <= 0.005}><Banknote size={15} />קבלת תשלום</button>
        </div>
      )}
      {open && (
        <div className="sd-payform">
          <ErrorBanner error={error} />
          {accounts.length > 1 && <div className="sd-hint">לחשבון: <b>{target?.ownerType === 'guest' ? 'המזמין' : target?.owner}</b></div>}
          <div className="sd-payrow">
            <label>סכום
              <input type="number" min={1} step="any" className={`input ${fields.amount ? 'is-invalid' : ''}`} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </label>
            <label>אמצעי תשלום
              <select className="select" value={method} onChange={(e) => { setMethod(e.target.value); setDetails(emptyDetails(e.target.value)); }}>
                {(methods.length ? methods.map((m) => [m.code, m.name]) : [['cash', 'מזומן'], ['credit_card', 'כרטיס אשראי (מסוף חיצוני)'], ['bank_transfer', 'העברה בנקאית']]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <PaymentMethodFields idPrefix={`sd-${res._id}`} method={method} amount={Number(amount)} value={details} onChange={setDetails} errors={fields} />
          {needRef && (
            <label className="sd-ref">אסמכתה
              <input className="input" dir="ltr" maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
          )}
          {fields.amount && <small className="sd-err">{fields.amount}</small>}
          {balance <= 0.005 && <small className="sd-hint">אין יתרה פתוחה לפי הלילות שחויבו — הסכום יירשם כמקדמה על חשבון הלילות הבאים.</small>}
          <div className="sd-payfoot">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={saving}>ביטול</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={saving || !(Number(amount) > 0) || !!missing || (needRef && ref.trim().length < 2)} title={missing || undefined}>{saving ? <><Spinner /> רושם…</> : 'רישום תשלום'}</button>
          </div>
        </div>
      )}
      {!open && accounts.length > 0 && (
        <div className="sd-payact">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDocFor(target?.id)}><FileText size={14} />מסמכים: חשבונית / קבלה</button>
        </div>
      )}
      <IssueDocumentDialog open={!!docFor} onClose={() => setDocFor(null)} propertyId={propertyId} folioId={docFor} subtitle={`${res.confirmationNumber}`} onIssued={() => load()} />
    </section>
  );
}

export default function StayDialog({ open, propertyId, reservationId, onClose, onChanged, onCheckIn, onCheckOut }) {
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !reservationId) return undefined;
    let live = true;
    setRes(null); setError(null);
    resApi.get(reservationId).then((r) => { if (live) setRes(r?.data || r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [open, reservationId]);

  const g = res?.primaryGuest || {};
  const room = res?.assignedRoom;
  const n = res ? nights(res.arrivalDate, res.departureDate) : 0;
  const total = res ? (res.totalAmount ?? (res.ratePerNight || 0) * n) : 0;
  const [statusText, statusTone] = STATUS[res?.status] || [res?.status || '', ''];
  const [payText, payTone] = PAY[res?.paymentStatus] || ['—', ''];
  const inHouse = ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'].includes(res?.status);
  const arriving = ['confirmed', 'modified', 'pending_payment'].includes(res?.status);
  const clean = room && ['clean', 'inspected'].includes(room.cleanStatus);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={780}
      title={res ? `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'אורח' : 'פרטי שהייה'}
      subtitle={res ? `${res.confirmationNumber} · ${formatShort(res.arrivalDate)} – ${formatShort(res.departureDate)} · ${n} לילות` : ''}
      footer={res && (
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>סגירה</button>
          {inHouse && <button type="button" className="btn btn-primary" onClick={() => onCheckOut(res._id)}><LogOut size={15} />צ׳ק-אאוט</button>}
          {arriving && <button type="button" className="btn btn-primary" onClick={() => onCheckIn(res._id)}><LogIn size={15} />צ׳ק-אין</button>}
        </>
      )}
    >
      <ErrorBanner error={error} />
      {!res && !error && <div className="ui-empty"><Spinner /> טוען פרטי הזמנה…</div>}
      {res && (
        <div className="sd">
          <div className="sd-badges">
            <span className={`dk-chip ${statusTone}`}>{statusText}</span>
            <span className={`dk-chip ${payTone}`}>{payText}</span>
            {res.isVip && <span className="dk-chip warn">VIP</span>}
            {res.company?.name && <span className="dk-chip">{res.company.name}</span>}
          </div>

          <div className="sd-grid">
            <section className="sd-card">
              <h3>השהייה</h3>
              <KV label="חדר">
                {room ? (
                  <div className="sd-room">
                    <b>{room.number}</b>
                    <span>קומה {room.floor ?? '—'} · {res.roomType?.name}</span>
                    <div className="dk-chips">
                      <span className={`dk-chip ${clean ? 'ok' : 'warn'}`}>{cleanLabel(room.cleanStatus)}</span>
                      {room.opsStatus && room.opsStatus !== 'available' && <span className="dk-chip bad">{opsLabel(room.opsStatus)}</span>}
                    </div>
                  </div>
                ) : <span className="dk-chip bad">לא משובץ חדר</span>}
              </KV>
              <KV label="תאריכים"><b>{formatShort(res.arrivalDate)}</b> ← <b>{formatShort(res.departureDate)}</b></KV>
              <KV label="אורחים">
                <div className="sd-icons"><span><Moon size={13} />{n} לילות</span><span><User size={13} />{res.adults} מבוגרים</span><span><Baby size={13} />{res.children || 0} ילדים</span></div>
              </KV>
              {res.ratePlan && <KV label="תכנית תמחור">{res.ratePlan.name || res.ratePlan.code}</KV>}
              {res.source && <KV label="מקור">{res.source}</KV>}
            </section>

            <div className="sd-col">
              <PaymentCard res={res} propertyId={propertyId} total={total} onChanged={() => { resApi.get(reservationId).then((r) => setRes(r?.data || r)).catch(() => {}); onChanged?.(); }} />
              <section className="sd-card">
                <h3>אורח</h3>
                <KV label="טלפון">{g.phone ? <a href={`tel:${g.phone}`} className="sd-link"><Phone size={13} />{g.phone}</a> : '—'}</KV>
                <KV label="אימייל">{g.email ? <a href={`mailto:${g.email}`} className="sd-link"><Mail size={13} />{g.email}</a> : '—'}</KV>
              </section>
            </div>
          </div>

          <section className="sd-card">
            <h3>בקשות והערות</h3>
            <KV label="בקשות מיוחדות">{res.specialRequests ? <span className="dk-req">{res.specialRequests}</span> : <span className="dk-muted">אין בקשות מיוחדות בהזמנה</span>}</KV>
            <KV label="הערות פנימיות">{res.internalNotes ? <span className="sd-notes">{res.internalNotes}</span> : <span className="dk-muted">אין הערות פנימיות</span>}</KV>
          </section>
        </div>
      )}
    </Modal>
  );
}
