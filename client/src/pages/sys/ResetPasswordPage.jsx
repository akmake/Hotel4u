// SYS-02 — password recovery and first-time setup. Without a token: request a link (the answer is
// the same whether or not the address exists). With a token: set a password (one-time link);
// all other sessions end.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { passwordRecovery } from '../../utils/api';
import { Field, ErrorBanner, Banner, Spinner, useAction } from '../../components/kit';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token');
  const setup = params.get('setup') === '1';
  const action = useAction();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const pwWhy = pw.length < 8 ? 'לפחות 8 תווים' : !/\d/.test(pw) || !/[A-Za-z֐-׿]/.test(pw) ? 'אותיות וספרות' : pw !== pw2 ? 'האישור אינו זהה' : null;

  return (
    <div dir="rtl" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'rgb(var(--bg-content))' }}>
      <div className="ui-card" style={{ width: '100%', maxWidth: 420 }}>
        <div className="ui-h3">{token ? (setup ? 'הגדרת סיסמה' : 'סיסמה חדשה') : 'שחזור גישה'}</div>
        {!token && !sent && (
          <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); action.run(async () => setSent(await passwordRecovery.request(email.trim()))); }} noValidate>
            <p className="ui-p">נשלח קישור חד־פעמי לאיפוס הסיסמה לכתובת הדוא״ל של החשבון.</p>
            <ErrorBanner error={action.error && !action.fields.email ? action.error : null} />
            <Field id="rp-e" label="דוא״ל" required error={action.fields.email}><input id="rp-e" type="email" dir="ltr" autoComplete="email" className="input w-full" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <button type="submit" className="btn btn-primary" disabled={action.busy || !email.trim()}>{action.busy ? <Spinner /> : 'שליחת קישור'}</button>
          </form>
        )}
        {!token && sent && (
          <div className="ui-stack">
            <Banner tone="ok">{sent.message}</Banner>
            <p className="ui-sub">לא קיבלתם? בדקו את תיקיית הספאם, או פנו למנהל המערכת שיוכל להנפיק קישור הגדרה.</p>
          </div>
        )}
        {token && !done && (
          <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); if (!pwWhy) action.run(async () => { await passwordRecovery.reset(token, pw); setDone(true); }); }} noValidate>
            <ErrorBanner error={action.error && !action.fields.password ? action.error : null} />
            {action.error && !action.fields.password && <Link to="/reset-password">בקשת קישור חדש</Link>}
            <Field id="rp-p" label="סיסמה חדשה" required hint="8 תווים לפחות, אותיות וספרות" error={action.fields.password}><input id="rp-p" type="password" autoComplete="new-password" className="input w-full" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field id="rp-p2" label="אישור סיסמה" required><input id="rp-p2" type="password" autoComplete="new-password" className="input w-full" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
            {pw && pwWhy && <div className="ui-sub">{pwWhy}</div>}
            <button type="submit" className="btn btn-primary" disabled={action.busy || !!pwWhy}>{action.busy ? <Spinner /> : 'שמירת סיסמה'}</button>
          </form>
        )}
        {token && done && (
          <div className="ui-stack">
            <Banner tone="ok">הסיסמה נשמרה. מכשירים שהיו מחוברים נותקו.</Banner>
            <button type="button" className="btn btn-primary" onClick={() => nav('/login', { replace: true })}>להתחברות</button>
          </div>
        )}
        <div className="ui-row" style={{ justifyContent: 'center' }}><Link to="/login" className="ui-sub">חזרה להתחברות</Link></div>
      </div>
    </div>
  );
}
