// /book/checkout — the chosen room and rate, re-priced on the server, guest details, terms, and on to
// secure payment. The room is held only once the guest presses "continue to payment".
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, ChevronRight } from 'lucide-react';
import { useSite, withP, RoomMedia, Modal } from './BookLayout';
import { bookApi, money, readSearch, searchQuery, longDate, guestsLabel } from './bookApi';

function opKey(id) {
  const k = `bk-key:${id}`;
  try {
    const v = sessionStorage.getItem(k);
    if (v) return v;
    const n = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(k, n);
    return n;
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

export default function BookCheckoutPage() {
  const { site, p } = useSite();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const q = useMemo(() => readSearch(sp), [sp]);
  const want = { room: sp.get('room'), plan: sp.get('plan'), board: sp.get('board') || 'room_only', sig: sp.get('sig') };
  const [state, setState] = useState({ loading: true, error: null, room: null, offer: null, currency: 'ILS', nights: 0, changed: false });
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', specialRequests: '', acceptTerms: false, marketingConsent: false });
  const [errors, setErrors] = useState({});
  const [submit, setSubmit] = useState({ busy: false, error: null });
  const [terms, setTerms] = useState(false);
  const prop = site.property;
  const backTo = withP(`/book?${searchQuery(q)}`, p);

  async function load() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await bookApi.search(p, { arrival: q.arrival, departure: q.departure, adults: q.adults, children: q.children, childAges: q.ages.join(',') });
      const room = data.rooms.find((r) => r.roomType.id === want.room);
      const offer = room?.offers.find((o) => o.ratePlanId === want.plan && o.board === want.board);
      if (!room || !offer) return setState({ loading: false, error: { message: 'החדר או התעריף שבחרתם כבר לא זמינים לתאריכים האלה.' }, room: room || null, offer: null, currency: data.currency, nights: data.nights, changed: false });
      return setState({ loading: false, error: null, room, offer, currency: data.currency, nights: data.nights, changed: !!want.sig && want.sig !== offer.priceSignature });
    } catch (error) {
      return setState((s) => ({ ...s, loading: false, error }));
    }
  }
  useEffect(() => { load(); }, [sp.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setF((x) => ({ ...x, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); };

  function validate() {
    const e = {};
    if (!f.firstName.trim()) e.firstName = 'שם פרטי';
    if (!f.lastName.trim()) e.lastName = 'שם משפחה';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'כתובת דוא״ל תקינה — לשם יישלח האישור';
    if (f.phone.replace(/\D/g, '').length < 9) e.phone = 'מספר נייד';
    if (!f.acceptTerms) e.acceptTerms = 'יש לאשר את תנאי ההזמנה';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function go(e) {
    e.preventDefault();
    if (!state.offer || !validate()) return;
    setSubmit({ busy: true, error: null });
    try {
      const out = await bookApi.start(p, {
        arrival: q.arrival, departure: q.departure, adults: q.adults, children: q.children, childAges: q.ages,
        roomTypeId: state.room.roomType.id, ratePlanId: state.offer.ratePlanId, board: state.offer.board, priceSignature: state.offer.priceSignature,
        guest: { firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone }, specialRequests: f.specialRequests,
        acceptTerms: f.acceptTerms, marketingConsent: f.marketingConsent,
        idempotencyKey: opKey(`${state.room.roomType.id}:${state.offer.key}:${q.arrival}:${q.departure}:${q.adults}:${q.children}`),
      });
      if (out.redirectUrl) {
        const u = new URL(out.redirectUrl, window.location.origin);
        if (u.origin === window.location.origin) nav(`${u.pathname}${u.search}`);
        else window.location.assign(out.redirectUrl);
      } else nav(withP(`/book/done/${out.token}`, p));
    } catch (err) {
      if (err.code === 'price_changed') { await load(); setSubmit({ busy: false, error: { message: 'המחיר עודכן מאז החיפוש — בדקו את הסכום החדש ואשרו שוב.' } }); return; }
      if (err.fields) setErrors(err.fields);
      setSubmit({ busy: false, error: err });
    }
  }

  const o = state.offer;
  const room = state.room?.roomType;
  const field = (k, label, props = {}) => (
    <label className={`bk-f ${props.wide ? 'is-wide' : ''}`}>
      <span>{label}</span>
      <input className={`bk-input ${errors[k] ? 'is-bad' : ''}`} value={f[k]} onChange={set(k)} aria-invalid={!!errors[k]} {...props.input} />
      {errors[k] && <span className="bk-err">{errors[k]}</span>}
    </label>
  );

  return (
    <div className="bk-wrap bk-page">
      <div className="bk-steps" aria-label="שלבי ההזמנה">
        <span className="is-done">1 · בחירת חדר</span><span className="is-on">2 · פרטים</span><span>3 · תשלום</span><span>4 · אישור</span>
      </div>
      <Link to={backTo} className="bk-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 22 }}><ChevronRight size={16} /> חזרה לחדרים</Link>
      {state.loading && <div className="bk-skel" style={{ height: 420 }} />}
      {!state.loading && state.error && (
        <div className="bk-empty">
          <h3>{state.error.message}</h3>
          <p className="bk-lead" style={{ marginInline: 'auto' }}>חפשו שוב ונציג את מה שפנוי עכשיו.</p>
          <Link className="bk-btn bk-btn-primary" to={backTo} style={{ marginTop: 14 }}>לחיפוש</Link>
        </div>
      )}
      {!state.loading && o && (
        <form className="bk-checkout" onSubmit={go} noValidate>
          <div className="bk-panel">
            <h2>הפרטים שלכם</h2>
            <p className="bk-note" style={{ margin: 0 }}>האישור יישלח לדוא״ל. הטלפון — לעדכונים לפני ההגעה בלבד.</p>
            <div className="bk-form">
              {field('firstName', 'שם פרטי', { input: { autoComplete: 'given-name', maxLength: 60 } })}
              {field('lastName', 'שם משפחה', { input: { autoComplete: 'family-name', maxLength: 60 } })}
              {field('email', 'דוא״ל', { input: { type: 'email', autoComplete: 'email', dir: 'ltr', maxLength: 120 } })}
              {field('phone', 'טלפון נייד', { input: { type: 'tel', autoComplete: 'tel', dir: 'ltr', maxLength: 20 } })}
              <label className="bk-f is-wide">
                <span>בקשות מיוחדות <small className="bk-note">(לא חובה)</small></span>
                <textarea className="bk-textarea" rows={3} maxLength={1000} value={f.specialRequests} onChange={set('specialRequests')} placeholder="שעת הגעה משוערת, אלרגיות, אירוע מיוחד…" />
              </label>
              <div className="is-wide" style={{ display: 'grid', gap: 10 }}>
                <label className="bk-check">
                  <input type="checkbox" checked={f.acceptTerms} onChange={set('acceptTerms')} aria-invalid={!!errors.acceptTerms} />
                  <span>קראתי ואני מסכים/ה ל<button type="button" className="bk-link" onClick={() => setTerms(true)}>תנאי ההזמנה, מדיניות הביטול ומדיניות הפרטיות</button></span>
                </label>
                {errors.acceptTerms && <span className="bk-err" style={{ color: 'var(--bad)', fontSize: 13 }}>{errors.acceptTerms}</span>}
                <label className="bk-check">
                  <input type="checkbox" checked={f.marketingConsent} onChange={set('marketingConsent')} />
                  <span>אשמח לקבל מהמלון הצעות ועדכונים בדוא״ל (לא חובה, אפשר להסיר בכל עת)</span>
                </label>
              </div>
            </div>
            {submit.error && <div className="bk-alert" role="alert" style={{ marginTop: 20 }}>{submit.error.message}</div>}
            {!site.payment.available && <div className="bk-alert is-info" style={{ marginTop: 20 }}>התשלום באתר אינו זמין כרגע. אפשר להשלים את ההזמנה בטלפון {prop.phone}.</div>}
            <button type="submit" className="bk-btn bk-btn-brass" style={{ width: '100%', marginTop: 24, padding: '18px 30px', fontSize: 16 }} disabled={submit.busy || !site.payment.available}>
              <Lock size={16} /> {submit.busy ? 'שומרים את החדר…' : `המשך לתשלום מאובטח · ${money(o.payNow.amount, state.currency)}`}
            </button>
            <div className="bk-secure"><Lock size={13} /> פרטי הכרטיס מוזנים בדף התשלום של חברת הסליקה ואינם נשמרים אצלנו</div>
          </div>

          <aside className="bk-summary" aria-label="סיכום ההזמנה">
            <RoomMedia room={room} index={Math.max(0, site.roomTypes.findIndex((r) => r.id === room.id))} />
            <div className="bk-summary-body">
              <div>
                <div className="bk-eyebrow">ההזמנה שלכם</div>
                <h3>{room.name}</h3>
                <div className="bk-note">{o.boardLabel || o.name} · {o.refundable ? 'ביטול גמיש' : 'ללא החזר'}</div>
              </div>
              {state.changed && <div className="bk-alert is-info">המחיר עודכן מאז החיפוש. זה המחיר הנוכחי.</div>}
              <div className="bk-rows">
                <div><span>הגעה</span><span>{longDate(q.arrival)} · מ־{prop.checkInTime}</span></div>
                <div><span>עזיבה</span><span>{longDate(q.departure)} · עד {prop.checkOutTime}</span></div>
                <div><span>לילות</span><span>{state.nights}</span></div>
                <div><span>אורחים</span><span>{guestsLabel(q.adults, q.children)}</span></div>
              </div>
              <details>
                <summary className="bk-note" style={{ cursor: 'pointer' }}>מחיר לפי לילה</summary>
                <div className="bk-rows" style={{ marginTop: 8 }}>
                  {o.nightly.map((n) => <div key={n.date}><span>{longDate(n.date)}</span><span>{money(n.price, state.currency)}</span></div>)}
                </div>
              </details>
              <div className="bk-total"><span>סה״כ לשהייה</span><b>{money(o.total, state.currency)}</b></div>
              <div className="bk-note" style={{ marginTop: -8 }}>כולל מע״מ</div>
              <div className="bk-paynow"><span>{o.payNow.kind === 'deposit' ? `לתשלום עכשיו — מקדמה ${o.payNow.pct}%` : 'לתשלום עכשיו'}</span><b>{money(o.payNow.amount, state.currency)}</b></div>
              {o.payNow.kind === 'deposit' && <div className="bk-note">היתרה, {money(o.total - o.payNow.amount, state.currency)}, משולמת במלון.</div>}
              <div className="bk-note"><b>ביטול:</b> {o.cancellation}</div>
            </div>
          </aside>
        </form>
      )}
      {terms && (
        <Modal title="תנאי ההזמנה" onClose={() => setTerms(false)}>
          {prop.terms ? <div style={{ whiteSpace: 'pre-line' }}>{prop.terms}</div> : null}
          {o && <p style={{ margin: 0 }}><b>מדיניות ביטול לתעריף שבחרתם:</b> {o.cancellation}</p>}
          <p style={{ margin: 0 }}><b>תשלום:</b> {site.payment.mode === 'deposit' ? `מקדמה של ${site.payment.depositPct}% בעת ההזמנה, והיתרה במלון.` : 'התשלום המלא נגבה בעת ההזמנה.'} המחירים כוללים מע״מ.</p>
          <p style={{ margin: 0 }}><b>כניסה ועזיבה:</b> כניסה מ־{prop.checkInTime}, עזיבה עד {prop.checkOutTime}.</p>
          <p style={{ margin: 0 }}><b>פרטיות:</b> אנו שומרים את השם, הדוא״ל, הטלפון והבקשות שמסרתם לצורך ההזמנה, האירוח והחובות החשבונאיות של המלון בלבד. פרטי הכרטיס מוזנים אצל חברת הסליקה ואינם נשמרים אצלנו. אפשר לבקש עיון, תיקון או מחיקה בפנייה ל־{prop.email || 'המלון'}.</p>
        </Modal>
      )}
    </div>
  );
}
