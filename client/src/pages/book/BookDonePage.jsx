// /book/done/:token — where the guest lands after paying. Finalises with the server (verify with the
// provider, confirm the stay, once), then shows the confirmation — or what went wrong and what next.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, CalendarPlus, Printer } from 'lucide-react';
import { useSite, withP } from './BookLayout';
import { bookApi, money, longDate, guestsLabel } from './bookApi';
import { useCountdown } from './BookPayPage';

function icsFor(s) {
  const b = s.booking;
  const d = (ymd) => ymd.replace(/-/g, '');
  const esc = (t) => String(t || '').replace(/[,;\\]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//hotel4u//booking//HE', 'BEGIN:VEVENT',
    `UID:${b.confirmationNumber}@hotel4u`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${d(b.arrival)}`, `DTEND;VALUE=DATE:${d(b.departure)}`,
    `SUMMARY:${esc(`${s.property?.name || 'מלון'} — ${b.roomType}`)}`, `LOCATION:${esc(s.property?.address || '')}`,
    `DESCRIPTION:${esc(`מספר הזמנה ${b.confirmationNumber}. כניסה מ־${s.property?.checkInTime}, עזיבה עד ${s.property?.checkOutTime}.`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${b.confirmationNumber}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function BookDonePage() {
  const { token } = useParams();
  const { site, p } = useSite();
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const tries = useRef(0);
  const timer = useCountdown(s?.status === 'failed' ? s?.expiresAt : null);

  useEffect(() => {
    let live = true;
    let t;
    const tick = async () => {
      try {
        let x = await bookApi.session(token);
        if (x.status === 'pending') x = await bookApi.complete(token);
        if (!live) return;
        setS(x);
        // The provider may confirm a few seconds later — keep asking for a minute.
        if (['pending', 'processing'].includes(x.status) && tries.current < 20) { tries.current += 1; t = setTimeout(tick, 3000); }
      } catch (e) { if (live) setErr(e); }
    };
    tick();
    return () => { live = false; clearTimeout(t); };
  }, [token]);

  async function retry() {
    setRetrying(true);
    try {
      const out = await bookApi.retry(token);
      if (out.redirectUrl) {
        const u = new URL(out.redirectUrl, window.location.origin);
        if (u.origin === window.location.origin) window.location.assign(`${u.pathname}${u.search}${p ? `${u.search ? '&' : '?'}p=${encodeURIComponent(p)}` : ''}`);
        else window.location.assign(out.redirectUrl);
      }
    } catch (e) { setErr(e); setRetrying(false); }
  }

  if (err) return <div className="bk-wrap bk-page"><div className="bk-center bk-alert" role="alert">{err.message} <Link className="bk-link" to={withP('/book', p)}>לחיפוש</Link></div></div>;
  if (!s) return <div className="bk-wrap bk-page"><div className="bk-center bk-skel" style={{ height: 420 }} /></div>;
  const b = s.booking;
  const phone = s.property?.phone || site.property.phone;

  if (s.status === 'paid') {
    return (
      <div className="bk-wrap bk-page">
        <div className="bk-center bk-confirm bk-fade">
          <div className="bk-seal" aria-hidden="true"><Check size={30} /></div>
          <div className="bk-eyebrow">ההזמנה אושרה</div>
          <h1>{b.guestName ? `תודה, ${b.guestName}` : 'תודה'}</h1>
          <p className="bk-lead" style={{ marginInline: 'auto' }}>שמרנו לכם את החדר. אישור נשלח ל־<span dir="ltr">{b.email}</span>.</p>
          <div className="bk-conf-no" aria-label="מספר הזמנה">{b.confirmationNumber}</div>
        </div>
        <div className="bk-center bk-panel" style={{ marginTop: 34, display: 'grid', gap: 16 }}>
          <div className="bk-rows">
            <div><span>חדר</span><span>{b.roomType}{b.board ? ` · ${b.board}` : ''}</span></div>
            <div><span>הגעה</span><span>{longDate(b.arrival)} · מ־{s.property?.checkInTime}</span></div>
            <div><span>עזיבה</span><span>{longDate(b.departure)} · עד {s.property?.checkOutTime}</span></div>
            <div><span>לילות</span><span>{b.nights}</span></div>
            <div><span>אורחים</span><span>{guestsLabel(b.adults, b.children)}</span></div>
          </div>
          <div className="bk-total"><span>סה״כ לשהייה</span><b>{money(b.total, s.currency)}</b></div>
          <div className="bk-rows">
            <div><span>{s.kind === 'deposit' ? 'שולמה מקדמה' : 'שולם'}</span><span>{money(s.amount, s.currency)}{s.card?.last4 ? ` · כרטיס ••${s.card.last4}` : ''}</span></div>
            {s.kind === 'deposit' && <div><span>יתרה לתשלום במלון</span><span>{money(b.total - s.amount, s.currency)}</span></div>}
          </div>
          {b.cancellation && <div className="bk-note"><b>ביטול:</b> {b.cancellation}</div>}
          {s.testMode && <div className="bk-test">סביבת בדיקה — לא בוצע חיוב אמיתי.</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="bk-btn bk-btn-primary bk-btn-sm" onClick={() => icsFor(s)}><CalendarPlus size={15} /> הוספה ליומן</button>
            <button type="button" className="bk-btn bk-btn-ghost bk-btn-sm" onClick={() => window.print()}><Printer size={15} /> הדפסה</button>
          </div>
          <p className="bk-note" style={{ margin: 0 }}>לשינוי או ביטול — {phone ? <>בטלפון <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} dir="ltr">{phone}</a></> : 'צרו קשר עם המלון'}{s.property?.email ? <> או ב־<a href={`mailto:${s.property.email}`}>{s.property.email}</a></> : null}, עם מספר ההזמנה.</p>
        </div>
      </div>
    );
  }

  const MSG = {
    pending: ['ממתינים לאישור התשלום', 'זה לוקח בדרך כלל כמה שניות. אל תסגרו את הדף.'],
    processing: ['מאשרים את ההזמנה', 'עוד רגע…'],
    failed: ['התשלום לא עבר', s.error || 'הכרטיס לא אושר. אפשר לנסות שוב — החדר עדיין שמור עבורכם.'],
    expired: ['זמן השמירה של החדר הסתיים', 'לא בוצע חיוב. אפשר לחפש שוב ולהזמין.'],
    needs_refund: ['התשלום התקבל — וצוות המלון ייצור אתכם קשר', 'התשלום הגיע אחרי שזמן השמירה של החדר הסתיים. צוות המלון יבדוק זמינות ויחזור אליכם: יאשר את ההזמנה או יחזיר את מלוא הסכום.'],
  }[s.status] || ['סטטוס לא ידוע', ''];
  return (
    <div className="bk-wrap bk-page">
      <div className="bk-center bk-panel" style={{ display: 'grid', gap: 16, textAlign: 'center', justifyItems: 'center' }}>
        <h2>{MSG[0]}</h2>
        <p className="bk-lead" style={{ margin: 0 }}>{MSG[1]}</p>
        {b && <p className="bk-note" style={{ margin: 0 }}>מספר הזמנה {b.confirmationNumber}</p>}
        {s.status === 'failed' && !timer?.done && (
          <>
            {timer && <span className="bk-note">החדר שמור עוד <span className="bk-timer">{timer.text}</span></span>}
            <button type="button" className="bk-btn bk-btn-brass" onClick={retry} disabled={retrying}>{retrying ? '…' : 'ניסיון תשלום נוסף'}</button>
          </>
        )}
        {(s.status === 'expired' || (s.status === 'failed' && timer?.done)) && <Link className="bk-btn bk-btn-primary" to={withP('/book', p)}>חיפוש מחדש</Link>}
        {phone && <p className="bk-note" style={{ margin: 0 }}>שאלות? <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} dir="ltr">{phone}</a></p>}
      </div>
    </div>
  );
}
