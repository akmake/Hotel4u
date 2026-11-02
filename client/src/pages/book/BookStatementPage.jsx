// Public statements of the hotel — the accessibility statement (/book/accessibility) and the privacy
// notice (/book/privacy). In the booking site's look, but standalone: they load even when online
// booking is off, because they describe the hotel. Text comes from hotel setup (server:
// services/legalPagesService.js); until the hotel saves its own, a default built from its details.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { bookApi, longDate } from './bookApi';
import './book.css';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@300;400;500;700&family=Assistant:wght@300;400;600;700&display=swap';
const dmy = (v) => (v ? new Date(v).toLocaleDateString('he-IL') : '');

export default function BookStatementPage({ kind }) {
  const [sp] = useSearchParams();
  const p = sp.get('p') || '';
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_HREF; document.head.appendChild(l);
    }
  }, []);
  useEffect(() => {
    let live = true;
    bookApi.statements(p).then((data) => live && setState({ loading: false, error: null, data })).catch((error) => live && setState({ loading: false, error, data: null }));
    return () => { live = false; };
  }, [p]);

  const d = state.data;
  const title = kind === 'accessibility' ? 'הצהרת נגישות' : 'מדיניות פרטיות';
  useEffect(() => { if (d) document.title = `${title} — ${d.hotel.name}`; }, [d, title]);
  const other = kind === 'accessibility' ? { to: 'privacy', label: 'מדיניות פרטיות' } : { to: 'accessibility', label: 'הצהרת נגישות' };

  return (
    <div className="bk" dir="rtl" lang="he">
      <header className="bk-header is-page">
        <div className="bk-wrap bk-header-in">
          <Link to={`/book?p=${encodeURIComponent(p)}`} className="bk-logo">{d?.hotel.name || ' '}</Link>
          <nav className="bk-nav" aria-label="ניווט">
            <Link to={`/book/${other.to}?p=${encodeURIComponent(p)}`}>{other.label}</Link>
            {d?.hotel.phone && <a className="bk-phone" href={`tel:${d.hotel.phone.replace(/[^\d+]/g, '')}`}>{d.hotel.phone}</a>}
          </nav>
        </div>
      </header>
      <main className="bk-wrap bk-page bk-statement">
        {state.loading && <div className="bk-skel" style={{ height: 320 }} />}
        {state.error && <div className="bk-empty"><h3>הדף לא נמצא</h3><p className="bk-lead" style={{ marginInline: 'auto' }}>{state.error.message}</p></div>}
        {d && kind === 'accessibility' && <Accessibility d={d} title={title} />}
        {d && kind === 'privacy' && <Privacy d={d} title={title} />}
      </main>
    </div>
  );
}

function Accessibility({ d, title }) {
  const a = d.accessibility;
  return (
    <article className="bk-panel">
      <h1>{title}</h1>
      <p className="bk-lead">{d.hotel.name} פועל להנגשת השירות והמלון לאנשים עם מוגבלות, בהתאם לחוק שוויון זכויות לאנשים עם מוגבלות ולתקנות הנגישות לשירות.</p>
      <h2>הסדרי הנגישות במלון</h2>
      {a.features.length ? <ul>{a.features.map((f) => <li key={f}>{f}</li>)}</ul> : <p>פרטי הסדרי הנגישות יעודכנו בקרוב. לבירור, פנו לאיש הקשר למטה.</p>}
      {a.accessibleRooms > 0 && <p>במלון {a.accessibleRooms} {a.accessibleRooms === 1 ? 'חדר נגיש' : 'חדרים נגישים'}. מומלץ לציין את הצורך בעת ההזמנה, כדי שנשמור לכם חדר מתאים.</p>}
      {a.details && <><h2>פרטים נוספים</h2><p style={{ whiteSpace: 'pre-line' }}>{a.details}</p></>}
      <h2>פנייה בנושא נגישות</h2>
      <p>
        {a.coordinator.name ? <>רכז/ת הנגישות: {a.coordinator.name}<br /></> : null}
        {a.coordinator.phone && <>טלפון: <a href={`tel:${a.coordinator.phone.replace(/[^\d+]/g, '')}`} dir="ltr">{a.coordinator.phone}</a><br /></>}
        {a.coordinator.email && <>דוא״ל: <a href={`mailto:${a.coordinator.email}`}>{a.coordinator.email}</a></>}
      </p>
      <p className="bk-note">
        {a.reviewedAt ? `הסדרי הנגישות נבדקו לאחרונה ב־${longDate(a.reviewedAt)}. ` : ''}
        {a.updatedAt ? `ההצהרה עודכנה ב־${dmy(a.updatedAt)}.` : ''}
      </p>
    </article>
  );
}

function Privacy({ d, title }) {
  const pv = d.privacy;
  return (
    <article className="bk-panel">
      <h1>{title}</h1>
      <p className="bk-lead">כך אנחנו אוספים, שומרים ומשתמשים במידע שאתם מוסרים לנו בהזמנה, בצ׳ק-אין ובמהלך השהייה.</p>
      {pv.sections.map((s) => <section key={s.title}><h2>{s.title}</h2><p>{s.body}</p></section>)}
      <h2>כמה זמן נשמר המידע</h2>
      <p>{pv.retention}</p>
      {pv.extra && <><h2>עוד</h2><p style={{ whiteSpace: 'pre-line' }}>{pv.extra}</p></>}
      <h2>יצירת קשר</h2>
      <p>לשאלות, לעיון במידע או לבקשת תיקון: {pv.contactEmail ? <a href={`mailto:${pv.contactEmail}`}>{pv.contactEmail}</a> : d.hotel.phone}</p>
      {pv.updatedAt && <p className="bk-note">עודכן ב־{dmy(pv.updatedAt)}.</p>}
    </article>
  );
}
