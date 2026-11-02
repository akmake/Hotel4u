// Guest online check-in (/checkin/:token) — no login; the link is the guest's handle on the stay.
// Screens copied from the Mews Guest Portal online check-in (welcome with the property picture,
// then one titled step per screen on a white sheet, a dark Continue pinned to the bottom, extras as
// cards with "+ Add" and a running total, a done screen). The desk still sees the ID document at
// arrival; extras are requests until the hotel approves them, nothing is charged online.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronRight, X, Plus, Check, IdCard, BookOpen, Car, FileText, KeyRound } from 'lucide-react';
import { money } from '../book/bookApi';
import { RoomArt } from '../book/BookArt';
import { countryOptions } from '../../lib/countries';
import './checkin.css';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&display=swap';
const BASE = `${import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '') : '/api'}/public/checkin`;

async function call(method, token, body) {
  let res;
  try {
    res = await fetch(`${BASE}/${encodeURIComponent(token)}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' });
  } catch {
    throw Object.assign(new Error('אין חיבור לאינטרנט — נסו שוב'), { status: 0 });
  }
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok || json?.success === false) throw Object.assign(new Error(json?.error || 'אירעה תקלה — נסו שוב'), { status: res.status, code: json?.code, fields: json?.fields || {} });
  return json?.data;
}

const DOC_TYPES = [{ v: 'id_card', l: 'תעודת זהות', Icon: IdCard }, { v: 'passport', l: 'דרכון', Icon: BookOpen }, { v: 'drivers_license', l: 'רישיון נהיגה', Icon: Car }, { v: 'other', l: 'אחר', Icon: FileText }];
const DOC_LABEL = Object.fromEntries(DOC_TYPES.map((d) => [d.v, d.l]));
const ETA_CHOICES = ['12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
const QUICK = ['מיטה נוספת', 'לול לתינוק', 'כריות נוספות', 'חדר שקט', 'חוגגים אירוע', 'אלרגיה'];
const UPSELL_STATE = { requested: 'ממתין לאישור המלון', approved: 'אושר', posted: 'אושר', declined: 'לא זמין בתאריכים שלכם' };
const STEP_TITLE = { details: 'פרטים אישיים', document: 'מסמך זיהוי', arrival: 'פרטי ההגעה', extras: 'לשדרג את השהייה', review: 'אישור וחתימה' };
const FIELD_STEP = { firstName: 'details', lastName: 'details', email: 'details', phone: 'details', dateOfBirth: 'details', nationality: 'details', address: 'details', idDocType: 'document', idDocNumber: 'document', idDocExpiry: 'document', eta: 'arrival', upsells: 'extras', signature: 'review', acceptTerms: 'review' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const store = {
  read(key) { try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; } },
  write(key, v) { try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } },
  drop(key) { try { window.localStorage.removeItem(key); } catch { /* private mode */ } },
};

// "2–4 בנובמבר" (isolated so RTL does not print "4–2"), or across months "30 בנובמבר – 2 בדצמבר".
const MONTH = new Intl.DateTimeFormat('he-IL', { month: 'long', timeZone: 'UTC' });
const ymd = (s) => new Date(`${s}T00:00:00Z`);
function stayRange(stay) {
  const a = ymd(stay.arrivalDate); const b = ymd(stay.departureDate);
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `⁦${a.getUTCDate()}–${b.getUTCDate()}⁩ ב${MONTH.format(a)}`;
  return `${a.getUTCDate()} ב${MONTH.format(a)} – ${b.getUTCDate()} ב${MONTH.format(b)}`;
}
const dmy = (s) => (s ? s.split('-').reverse().join('.') : '—');

function SignaturePad({ onChange, invalid }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const drew = useRef(false);
  const [has, setHas] = useState(false);
  const pos = (e) => {
    const c = ref.current; const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const down = (e) => { e.preventDefault(); ref.current.setPointerCapture?.(e.pointerId); drawing.current = true; const ctx = ref.current.getContext('2d'); const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = ref.current.getContext('2d'); const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.strokeStyle = '#262626'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    drew.current = true;
  };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (drew.current) { setHas(true); onChange(ref.current.toDataURL('image/png')); } };
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); drew.current = false; setHas(false); onChange(null); };
  return (
    <div className={`ci-sign ${invalid ? 'is-bad' : ''}`}>
      <canvas ref={ref} width={1000} height={320} role="img" aria-label="משטח חתימה" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <div className="ci-sign-row"><span>{has ? 'נחתם' : 'חתמו באצבע או בעכבר'}</span>{has && <button type="button" className="ci-link" onClick={clear}>ניקוי</button>}</div>
    </div>
  );
}

function F({ id, label, req, opt, error, hint, children }) {
  return (
    <div className="ci-f">
      <label className="ci-label" htmlFor={id}>{label}{req && <span className="req" aria-hidden="true">*</span>}{opt && <span className="opt"> (לא חובה)</span>}</label>
      {children}
      {hint && !error && <span className="ci-hint">{hint}</span>}
      {error && <span className="ci-err" id={`${id}-err`} role="alert">{error}</span>}
    </div>
  );
}

export default function OnlineCheckInPage() {
  const { token } = useParams();
  const draftKey = `ci:${token}`;
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [f, setF] = useState(null);
  const [step, setStep] = useState(-1); // -1 = welcome
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [otherEta, setOtherEta] = useState(false);
  const headRef = useRef(null);
  const countries = useMemo(() => countryOptions(), []);

  useEffect(() => {
    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_HREF; document.head.appendChild(l);
    }
  }, []);

  const fill = (d, draft = null) => {
    const base = {
      firstName: d.guest.firstName, lastName: d.guest.lastName, email: d.guest.email, phone: d.guest.phone,
      dateOfBirth: d.guest.dateOfBirth, nationality: d.guest.nationality || 'IL', address: d.guest.address || '', idDocType: d.guest.idDocType || 'id_card',
      idDocNumber: '', keepDoc: !!d.guest.idDocLast4, idDocExpiry: d.guest.idDocExpiry, eta: d.eta, requests: d.requests,
      upsells: d.upsells.filter((u) => u.status === 'requested').map((u) => u.key),
      signature: null, acceptTerms: false, marketingConsent: false,
    };
    // A half-filled form survives a closed tab; the document number and the signature stay off the phone.
    const next = draft ? { ...base, ...draft, idDocNumber: '', signature: null } : base;
    setF(next);
    setOtherEta(!!next.eta && !ETA_CHOICES.includes(next.eta));
  };

  useEffect(() => {
    let live = true;
    call('GET', token)
      .then((data) => {
        if (!live) return;
        setState({ loading: false, error: null, data });
        const draft = data.status === 'submitted' ? null : store.read(draftKey);
        fill(data, draft?.f || null);
        if (draft && draft.step >= 0) setStep(draft.step);
        document.title = `צ׳ק-אין מקוון — ${data.hotel.name}`;
      })
      .catch((error) => live && setState({ loading: false, error, data: null }));
    return () => { live = false; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = state.data;
  const steps = useMemo(() => (d ? ['details', 'document', 'arrival', ...(d.offers.length ? ['extras'] : []), 'review'] : []), [d]);
  const current = steps[step] || null;
  const done = d?.status === 'submitted' && !editing;

  useEffect(() => {
    if (!f || !d || done) return;
    const { idDocNumber: _n, signature: _s, ...safe } = f;
    store.write(draftKey, { step, f: safe });
  }, [f, step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { headRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }, [step, done]);
  useEffect(() => { if (steps.length && step >= steps.length) setStep(steps.length - 1); }, [steps, step]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const put = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const decided = new Map((d?.upsells || []).filter((u) => u.status !== 'requested').map((u) => [u.key, u]));
  const chosenOffers = (d?.offers || []).filter((o) => f?.upsells.includes(o.key) && !decided.has(o.key));
  const chosenTotal = chosenOffers.reduce((s, o) => s + Number(o.price || 0), 0);
  const countryName = (code) => countries.find((c) => c.code === code)?.name || code || '—';
  const telHref = d?.hotel.phone ? `tel:${d.hotel.phone.replace(/[^\d+]/g, '')}` : null;

  function check(id) {
    const e = {};
    if (id === 'details') {
      if (!f.nationality) e.nationality = 'נא לבחור אזרחות';
      if (!f.firstName?.trim()) e.firstName = 'נא למלא שם פרטי';
      if (!f.lastName?.trim()) e.lastName = 'נא למלא שם משפחה';
      if (!f.dateOfBirth) e.dateOfBirth = 'נא למלא תאריך לידה';
      if (String(f.address || '').trim().length < 4) e.address = 'נא למלא כתובת מגורים (רחוב, עיר, מדינה)';
      if (f.email && !EMAIL.test(f.email)) e.email = 'כתובת הדוא״ל לא נראית תקינה';
    }
    if (id === 'document') {
      const keeping = f.keepDoc && d.guest.idDocLast4 && !f.idDocNumber;
      if (!keeping && !f.idDocNumber?.trim()) e.idDocNumber = 'נא למלא את מספר המסמך';
      else if (f.idDocNumber && !/^[A-Za-z0-9-\s]{4,40}$/.test(f.idDocNumber)) e.idDocNumber = 'ספרות ואותיות בלבד';
      if (f.idDocType === 'passport' && !f.idDocExpiry) e.idDocExpiry = 'בדרכון נדרש תאריך תוקף';
    }
    if (id === 'review') {
      if (d.terms.requireSignature && !f.signature) e.signature = 'נא לחתום';
      if (d.terms.text && !f.acceptTerms) e.acceptTerms = 'נא לאשר את תנאי האירוח';
    }
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function next(e) {
    e?.preventDefault();
    setSubmitError(null);
    if (!check(current)) return;
    if (current !== 'review') { setStep((s) => s + 1); return; }
    setBusy(true);
    try {
      const data = await call('POST', token, { ...f, idDocNumber: (f.idDocNumber || '').replace(/\s+/g, ''), keepDoc: f.keepDoc && !f.idDocNumber });
      store.drop(draftKey);
      setState({ loading: false, error: null, data });
      fill(data);
      setEditing(false);
      setStep(-1);
    } catch (err) {
      const fields = err.fields || {};
      setErrors(fields);
      setSubmitError(err);
      const first = steps.find((s) => Object.keys(fields).some((k) => FIELD_STEP[k] === s));
      if (first && first !== 'review') setStep(steps.indexOf(first));
    } finally {
      setBusy(false);
    }
  }

  const parts = () => (f?.requests || '').split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
  const quickOn = (q) => parts().includes(q);
  const toggleQuick = (q) => put('requests', (quickOn(q) ? parts().filter((p) => p !== q) : [...parts(), q]).join(' · '));
  const input = (k, extra = {}) => ({
    id: `ci-${k}`, className: `ci-input ${errors[k] ? 'is-bad' : ''}`, value: f[k] || '', onChange: set(k),
    'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `ci-${k}-err` : undefined, ...extra,
  });

  // ── Frame: back · progress · close, hotel, title, white sheet, pinned footer ──
  const frame = ({ title, progress = null, onBack = null, onClose = null, body, foot }) => (
    <div className="ci" dir="rtl" lang="he">
      <div className="ci-col">
        <div className="ci-top">
          <button type="button" className="ci-sq" aria-label="חזרה" hidden={!onBack} onClick={onBack || undefined}><ChevronRight size={20} /></button>
          {progress !== null ? <div className="ci-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="התקדמות"><span style={{ width: `${Math.max(8, progress * 100)}%` }} /></div> : <span />}
          <button type="button" className="ci-sq" aria-label="סגירה" hidden={!onClose} onClick={onClose || undefined}><X size={20} /></button>
        </div>
        <div className="ci-head">
          <div className="ci-hotel">{d?.hotel.name || ' '}</div>
          <h1 ref={headRef} tabIndex={-1}>{title}</h1>
        </div>
        <form className="ci-sheet" onSubmit={next} noValidate>
          <div className="ci-body">{body}</div>
          {foot && <div className="ci-foot">{foot}</div>}
        </form>
      </div>
    </div>
  );

  if (state.loading) {
    return (
      <div className="ci" dir="rtl" lang="he" aria-busy="true">
        <div className="ci-col"><div className="ci-head" style={{ paddingTop: 84 }}><div className="ci-ghost" style={{ height: 30, width: 220, margin: '0 auto' }} /></div>
          <div className="ci-sheet"><div className="ci-body"><div className="ci-ghost" style={{ height: 54 }} /><div className="ci-ghost" style={{ height: 54 }} /><div className="ci-ghost" style={{ height: 54 }} /></div></div></div>
      </div>
    );
  }

  if (state.error) {
    const e = state.error;
    return frame({
      title: e.code === 'expired' ? 'הקישור כבר לא בתוקף' : e.code === 'bad_link' ? 'הקישור לא תקף' : e.code === 'off' ? 'הצ׳ק-אין המקוון סגור כרגע' : 'לא הצלחנו לפתוח את הצ׳ק-אין',
      body: <p className="ci-lead">{e.code === 'expired' ? 'תוקף הקישור הסתיים יחד עם ההזמנה.' : e.code ? 'ייתכן שנשלח אליכם קישור חדש יותר. אפשר גם להשלים הכול בקבלה בהגעה.' : e.message}</p>,
      foot: !e.code ? <button type="button" className="ci-btn" onClick={() => window.location.reload()}>לנסות שוב</button> : null,
    });
  }

  // ── Done ──
  if (done) {
    const mapUrl = d.hotel.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.hotel.name} ${d.hotel.address}`)}` : null;
    return frame({
      title: 'הכול מוכן לשהייה',
      progress: 1,
      body: (
        <>
          <div className="ci-done-art" aria-hidden="true"><KeyRound /></div>
          <p className="ci-done-title">מקבלים מפתח בקבלה</p>
          <p className="ci-lead" style={{ marginTop: -14 }}>מציגים את מסמך הזיהוי, וזהו. בלי טפסים ובלי חתימות.</p>
          <dl className="ci-rows">
            <div className="ci-row"><dt>תאריכים</dt><dd>{stayRange(d.stay)} · {d.stay.nights} לילות</dd></div>
            <div className="ci-row"><dt>הגעה משוערת</dt><dd>{d.eta || 'לא צוין'}{d.hotel.checkInTime ? ` · החדר מוכן מ־${d.hotel.checkInTime}` : ''}</dd></div>
            {d.requests && <div className="ci-row"><dt>הבקשות שלכם</dt><dd>{d.requests}</dd></div>}
            {d.upsells.map((u) => <div key={u.key} className="ci-row"><dt>{u.label}{u.time ? ` · ${u.time}` : ''}</dt><dd>{money(u.price)} · {UPSELL_STATE[u.status] || u.status}</dd></div>)}
            {d.hotel.address && <div className="ci-row"><dt>כתובת</dt><dd>{d.hotel.address}</dd></div>}
            {telHref && <div className="ci-row"><dt>טלפון המלון</dt><dd><a className="ci-link" href={telHref}><bdi>{d.hotel.phone}</bdi></a></dd></div>}
          </dl>
          {d.upsells.some((u) => u.status === 'requested') && <p className="ci-small" style={{ margin: 0 }}>התוספות מאושרות לפי זמינות. החיוב נעשה במלון, רק על מה שאושר.</p>}
        </>
      ),
      foot: (
        <>
          {mapUrl && <a className="ci-btn" href={mapUrl} target="_blank" rel="noreferrer">ניווט למלון</a>}
          {d.stay.open && !d.stay.checkedIn && <button type="button" className="ci-btn is-outline" onClick={() => { setEditing(true); setStep(0); }}>עדכון הפרטים</button>}
        </>
      ),
    });
  }

  if (!d.stay.open) {
    return frame({ title: 'ההזמנה סגורה לעדכון', body: <p className="ci-lead">לשאלות על השהייה אפשר לפנות למלון{d.hotel.phone ? ` בטלפון ${d.hotel.phone}` : ''}.</p> });
  }

  // ── Welcome: the room picture, the sheet over it ──
  if (step < 0) {
    return (
      <div className="ci" dir="rtl" lang="he">
        <div className="ci-col">
          <div className="ci-welcome">
            <div className="ci-hero">{d.stay.roomImage ? <img src={d.stay.roomImage} alt={d.stay.roomType || ''} /> : <RoomArt view={d.stay.roomView || 'garden'} index={1} label={d.stay.roomType || ''} />}</div>
            <div className="ci-sheet">
              <div className="ci-body">
                <div>
                  <div className="ci-welcome-to">ברוכים הבאים ל</div>
                  <h1 ref={headRef} tabIndex={-1}>{d.hotel.name}</h1>
                  <p className="ci-stayline">{f.firstName ? `${f.firstName}, ` : ''}{d.stay.roomType ? `${d.stay.roomType} · ` : ''}{stayRange(d.stay)} · {d.stay.nights} לילות</p>
                </div>
                <p className="ci-lead">ממלאים את הצ׳ק-אין עכשיו, כשתי דקות, ובהגעה רק מציגים תעודה ומקבלים מפתח.</p>
                <p className="ci-small" style={{ margin: 0 }}>
                  {d.hotel.privacyUrl && <><a className="ci-link" href={d.hotel.privacyUrl} target="_blank" rel="noreferrer">מדיניות פרטיות</a> · </>}
                  {d.hotel.accessibilityUrl && <><a className="ci-link" href={d.hotel.accessibilityUrl} target="_blank" rel="noreferrer">הצהרת נגישות</a></>}
                  {telHref && <> · צריכים עזרה? <a className="ci-link" href={telHref}><bdi>{d.hotel.phone}</bdi></a></>}
                </p>
              </div>
              <div className="ci-foot"><button type="button" className="ci-btn" onClick={() => setStep(0)}>מתחילים</button></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Steps ──
  let body = null;
  if (current === 'details') {
    body = (
      <>
        <F id="ci-nationality" label="אזרחות" req error={errors.nationality}>
          <select {...input('nationality')}>
            <option value="">בחרו אזרחות</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </F>
        <F id="ci-firstName" label="שם פרטי" req error={errors.firstName}><input {...input('firstName', { autoComplete: 'given-name', maxLength: 60 })} /></F>
        <F id="ci-lastName" label="שם משפחה" req error={errors.lastName}><input {...input('lastName', { autoComplete: 'family-name', maxLength: 60 })} /></F>
        <F id="ci-phone" label="טלפון" error={errors.phone}><input {...input('phone', { type: 'tel', dir: 'ltr', autoComplete: 'tel', maxLength: 20, placeholder: '050-0000000' })} /></F>
        <F id="ci-dateOfBirth" label="תאריך לידה" req error={errors.dateOfBirth}><input {...input('dateOfBirth', { type: 'date', autoComplete: 'bday', max: new Date().toISOString().slice(0, 10) })} /></F>
        <F id="ci-address" label="כתובת מגורים קבועה" req error={errors.address} hint="רחוב ומספר, עיר ומדינה — נדרש לרישום האורחים במלון"><input {...input('address', { autoComplete: 'street-address', maxLength: 300 })} /></F>
        <F id="ci-email" label="דוא״ל" error={errors.email}><input {...input('email', { type: 'email', dir: 'ltr', autoComplete: 'email', maxLength: 120 })} /></F>
        <p className="ci-small" style={{ margin: 0 }}>
          שם, תאריך לידה, אזרחות, מען ומסמך זיהוי נדרשים לפי דין לרישום אורחים במלון ולניהול ספרים, ובלעדיהם לא ניתן להשלים את הכניסה. טלפון ודוא״ל — לבחירתכם, לעדכונים על השהייה.
          {d.hotel.privacyUrl && <> <a className="ci-link" href={d.hotel.privacyUrl} target="_blank" rel="noreferrer">מדיניות הפרטיות המלאה</a></>}
        </p>
      </>
    );
  } else if (current === 'document') {
    const keeping = f.keepDoc && d.guest.idDocLast4;
    body = (
      <>
        <div className="ci-f">
          <span className="ci-label" id="ci-doc-l">סוג המסמך<span className="req" aria-hidden="true">*</span></span>
          <div className="ci-tiles" style={{ '--n': 2 }} role="radiogroup" aria-labelledby="ci-doc-l">
            {DOC_TYPES.map(({ v, l, Icon }) => <button key={v} type="button" role="radio" aria-checked={f.idDocType === v} className="ci-tile" onClick={() => put('idDocType', v)}><Icon />{l}</button>)}
          </div>
        </div>
        <F id="ci-idDocNumber" label={`מספר ה${DOC_LABEL[f.idDocType] || 'מסמך'}`} req={!keeping} error={errors.idDocNumber} hint={keeping ? `כבר שלחתם מסמך שמסתיים ב־${d.guest.idDocLast4}. השאירו ריק כדי להשתמש בו.` : 'את המסמך עצמו מציגים בקבלה.'}>
          <input {...input('idDocNumber', { dir: 'ltr', inputMode: f.idDocType === 'id_card' ? 'numeric' : 'text', autoComplete: 'off', maxLength: 40 })} />
        </F>
        <F id="ci-idDocExpiry" label="בתוקף עד" req={f.idDocType === 'passport'} error={errors.idDocExpiry}><input {...input('idDocExpiry', { type: 'date', min: d.stay.arrivalDate })} /></F>
      </>
    );
  } else if (current === 'arrival') {
    body = (
      <>
        <div className="ci-f">
          <span className="ci-label" id="ci-eta-l">שעת הגעה משוערת</span>
          <div className="ci-tiles" role="radiogroup" aria-labelledby="ci-eta-l">
            {ETA_CHOICES.map((t) => <button key={t} type="button" role="radio" aria-checked={!otherEta && f.eta === t} className="ci-tile is-small" onClick={() => { setOtherEta(false); put('eta', t); }}><bdi>{t}</bdi></button>)}
            <button type="button" role="radio" aria-checked={otherEta} className="ci-tile is-small" onClick={() => setOtherEta(true)}>שעה אחרת</button>
            <button type="button" role="radio" aria-checked={!otherEta && !f.eta} className="ci-tile is-small" style={{ gridColumn: 'span 2' }} onClick={() => { setOtherEta(false); put('eta', ''); }}>עוד לא יודעים</button>
          </div>
          {otherEta && <input {...input('eta', { type: 'time', 'aria-label': 'שעה מדויקת' })} />}
          {d.hotel.checkInTime && <span className="ci-hint">החדרים מוכנים מ־{d.hotel.checkInTime}.</span>}
        </div>
        <div className="ci-f">
          <span className="ci-label" id="ci-req-l">משהו שנכין לכם בחדר?</span>
          <div className="ci-tiles" aria-labelledby="ci-req-l">
            {QUICK.map((q) => <button key={q} type="button" aria-pressed={quickOn(q)} className="ci-tile is-small" onClick={() => toggleQuick(q)}>{q}</button>)}
          </div>
          <textarea {...input('requests', { rows: 3, maxLength: 1000, 'aria-label': 'בקשות לחדר', placeholder: 'אלרגיות, אירוע מיוחד, כל דבר שחשוב לכם' })} />
        </div>
      </>
    );
  } else if (current === 'extras') {
    body = (
      <>
        <p className="ci-lead">לא משלמים עכשיו. המלון מאשר לפי זמינות, והחיוב נעשה במלון רק על מה שאושר.</p>
        {d.offers.map((o) => {
          const prior = decided.get(o.key);
          const on = f.upsells.includes(o.key) || ['approved', 'posted'].includes(prior?.status);
          return (
            <div key={o.key} className="ci-card">
              <div className="ci-card-name">{o.label}</div>
              {o.description && <div className="ci-card-desc">{o.description}</div>}
              <div>
                <div className="ci-card-price">{money(o.price, o.currency)}</div>
                <div className="ci-card-unit">{prior ? UPSELL_STATE[prior.status] : o.time ? (o.kind === 'early_checkin' ? `כניסה מ־${o.time}` : `יציאה עד ${o.time}`) : 'לשהייה'}</div>
              </div>
              <button type="button" className={`ci-add ${on ? 'is-on' : ''}`} disabled={!!prior} aria-pressed={on}
                onClick={() => put('upsells', f.upsells.includes(o.key) ? f.upsells.filter((k) => k !== o.key) : [...f.upsells, o.key])}>
                {on ? <><Check size={18} /> נוסף</> : <><Plus size={18} /> הוספה</>}
              </button>
            </div>
          );
        })}
        {errors.upsells && <div className="ci-alert" role="alert">{errors.upsells}</div>}
      </>
    );
  } else if (current === 'review') {
    const go = (s) => () => { setErrors({}); setStep(steps.indexOf(s)); };
    const docShown = f.idDocNumber ? `···${f.idDocNumber.replace(/\s+/g, '').slice(-4)}` : d.guest.idDocLast4 ? `···${d.guest.idDocLast4}` : '—';
    const row = (label, value, s) => <div className="ci-row"><dt>{label}</dt><dd>{value}</dd><button type="button" className="ci-link ci-edit" onClick={go(s)}>עריכה</button></div>;
    body = (
      <>
        <dl className="ci-rows">
          {row('שם', `${f.firstName} ${f.lastName}`, 'details')}
          {row('תאריך לידה ואזרחות', `${dmy(f.dateOfBirth)} · ${countryName(f.nationality)}`, 'details')}
          {row('כתובת', f.address || '—', 'details')}
          {row(DOC_LABEL[f.idDocType], <bdi>{docShown}</bdi>, 'document')}
          {row('הגעה', `${f.eta || 'שעה לא צוינה'}${f.requests ? ` · ${f.requests}` : ''}`, 'arrival')}
          {steps.includes('extras') && row('תוספות', chosenOffers.length ? `${chosenOffers.map((o) => o.label).join(', ')} · ${money(chosenTotal)}` : 'בלי תוספות', 'extras')}
        </dl>
        <div className="ci-f">
          <span className="ci-label">חתימה{d.terms.requireSignature ? <span className="req" aria-hidden="true">*</span> : <span className="opt"> (לא חובה)</span>}</span>
          <SignaturePad onChange={(v) => put('signature', v)} invalid={!!errors.signature} />
          {errors.signature && <span className="ci-err" role="alert">{errors.signature}</span>}
        </div>
        {d.terms.text && (
          <div className="ci-f">
            <label className="ci-check"><input type="checkbox" checked={f.acceptTerms} onChange={set('acceptTerms')} aria-invalid={errors.acceptTerms ? true : undefined} /><span>אני מסכים/ה ל<details style={{ display: 'inline' }}><summary className="ci-link" style={{ display: 'inline' }}>תנאי האירוח</summary><div className="ci-terms">{d.terms.text}</div></details></span></label>
            {errors.acceptTerms && <span className="ci-err" role="alert">{errors.acceptTerms}</span>}
          </div>
        )}
        {!d.guest.marketingConsent && <label className="ci-check"><input type="checkbox" checked={f.marketingConsent} onChange={set('marketingConsent')} /><span>אשמח לקבל מהמלון הצעות ועדכונים</span></label>}
        {submitError && !Object.keys(submitError.fields || {}).length && <div className="ci-alert" role="alert">{submitError.message}</div>}
      </>
    );
  }

  return frame({
    title: STEP_TITLE[current],
    progress: (step + 1) / (steps.length + 1),
    onBack: () => { setErrors({}); setStep((s) => s - 1); },
    onClose: () => { setErrors({}); setStep(-1); },
    body,
    foot: (
      <>
        {current === 'extras' && (
          <div className="ci-total" aria-live="polite"><div><small>סה״כ לבקשה</small><b>{money(chosenTotal)}</b></div></div>
        )}
        <button type="submit" className="ci-btn" disabled={busy}>{current === 'review' ? (busy ? 'שולחים…' : 'סיום הצ׳ק-אין') : 'המשך'}</button>
      </>
    ),
  });
}
