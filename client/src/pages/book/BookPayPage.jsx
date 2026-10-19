// /book/pay/:token — the TEST payment provider's page (development only). With a real clearing
// provider the guest is sent to the provider's own hosted page instead and comes back to /book/done.
// No card fields here on purpose: card data must never pass through our pages or server.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useSite, withP } from './BookLayout';
import { bookApi, money, longDate } from './bookApi';

export function useCountdown(until) {
  const [left, setLeft] = useState(() => (until ? new Date(until) - Date.now() : null));
  useEffect(() => {
    if (!until) return undefined;
    const t = setInterval(() => setLeft(new Date(until) - Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (left === null) return null;
  const s = Math.max(0, Math.floor(left / 1000));
  return { done: s === 0, text: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` };
}

export default function BookPayPage() {
  const { token } = useParams();
  const { p } = useSite();
  const nav = useNavigate();
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const timer = useCountdown(s?.expiresAt);

  useEffect(() => {
    bookApi.session(token).then((x) => { if (x.status !== 'pending') nav(withP(`/book/done/${token}`, p), { replace: true }); else setS(x); }).catch(setErr);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay(outcome) {
    setBusy(outcome);
    try { await bookApi.mockPay(token, outcome); } catch (e) { setErr(e); setBusy(''); return; }
    nav(withP(`/book/done/${token}`, p), { replace: true });
  }

  if (err) return <div className="bk-wrap bk-page"><div className="bk-center bk-alert" role="alert">{err.message}</div></div>;
  if (!s) return <div className="bk-wrap bk-page"><div className="bk-center bk-skel" style={{ height: 360 }} /></div>;
  const b = s.booking;
  return (
    <div className="bk-wrap bk-page">
      <div className="bk-steps" aria-label="שלבי ההזמנה" style={{ justifyContent: 'center' }}>
        <span className="is-done">1 · בחירת חדר</span><span className="is-done">2 · פרטים</span><span className="is-on">3 · תשלום</span><span>4 · אישור</span>
      </div>
      <div className="bk-center bk-panel" style={{ display: 'grid', gap: 18 }}>
        {s.testMode && <div className="bk-test"><b>סביבת בדיקה</b> — זהו דף תשלום מדומה. לא מתבצע חיוב ולא מוזנים פרטי כרטיס.</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Lock size={22} /> תשלום מאובטח</h2>
          {timer && <span className="bk-note">החדר שמור עבורכם עוד <span className="bk-timer">{timer.text}</span></span>}
        </div>
        <div className="bk-rows">
          <div><span>הזמנה</span><span>{b.confirmationNumber}</span></div>
          <div><span>חדר</span><span>{b.roomType}{b.board ? ` · ${b.board}` : ''}</span></div>
          <div><span>תאריכים</span><span>{longDate(b.arrival)} – {longDate(b.departure)}</span></div>
        </div>
        <div className="bk-paynow"><span>{s.kind === 'deposit' ? 'מקדמה לתשלום' : 'סכום לתשלום'}</span><b>{money(s.amount, s.currency)}</b></div>
        {timer?.done ? (
          <div className="bk-alert">זמן השמירה הסתיים. <button type="button" className="bk-link" onClick={() => nav(withP('/book', p))}>חיפוש מחדש</button></div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <button type="button" className="bk-btn bk-btn-brass" disabled={!!busy} onClick={() => pay('approve')}>{busy === 'approve' ? 'מאשרים…' : `אישור תשלום${s.testMode ? ' (בדיקה)' : ''}`}</button>
            {s.testMode && <button type="button" className="bk-btn bk-btn-ghost" disabled={!!busy} onClick={() => pay('decline')}>{busy === 'decline' ? '…' : 'דחיית כרטיס (בדיקה)'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
