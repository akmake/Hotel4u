import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, Hotel, Loader2, LockKeyhole, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

// Legacy sales roles land on the sales home; every PMS role lands on the front-desk "Today" screen.
const SALES_ROLES = ['admin', 'sales', 'maintenance', 'shift_manager'];
const homeFor = (role) => (SALES_ROLES.includes(role) ? '/' : '/pms');

function errorMessage(err) {
  const status = err.response?.status;
  if (status === 423) return 'החשבון ננעל זמנית לאחר ניסיונות כושלים. נסו שוב בעוד מספר דקות.';
  if (status === 401) return 'האימייל או הסיסמה שגויים.';
  if (status === 429) return 'יותר מדי ניסיונות התחברות. נסו שוב בעוד מספר דקות.';
  if (!err.response) return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.';
  return err.response?.data?.message || err.response?.data?.error || 'ההתחברות נכשלה. נסו שוב.';
}

export default function LoginPage() {
  const { login, isAuthenticated, user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const [mfa, setMfa] = useState(null); // { ticket } after the password step
  const [code, setCode] = useState('');
  const verifyMfa = useAuthStore((s) => s.verifyMfa);

  // where to return after login: router state (AuthGate) or ?next= (expired session redirect)
  const nextParam = new URLSearchParams(location.search).get('next');
  const from = location.state?.from
    ? `${location.state.from.pathname}${location.state.from.search || ''}`
    : (nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : null);

  if (isAuthenticated && user) {
    return <Navigate to={from || homeFor(user.role)} replace />;
  }

  async function doLogin(em, pw) {
    setError('');
    setLoading(true);
    try {
      const u = await login({ email: em, password: pw, rememberMe: remember });
      if (u?.mfaRequired) { setMfa({ ticket: u.ticket }); setCode(''); return; }
      navigate(from || homeFor(u?.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    if (loading) return;
    doLogin(email.trim().toLowerCase(), password);
  };

  const trackCaps = (e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  return (
    <div className="hotjar-login" dir="ltr">
      <header className="hotjar-login-header">
        <div className="hotjar-brand"><Hotel size={23} /><strong>Hotel4U</strong></div>
        <span className="hotjar-language">English <ChevronDown size={14} /></span>
      </header>
      <main className="hotjar-login-main">
        <section className="hotjar-login-form-panel" dir="ltr" aria-labelledby="login-title">
          <div className="hotjar-login-form">
            <h1 id="login-title">Sign in</h1>
            <p className="hotjar-account-caption">Need a Hotel4U account? <button type="button" onClick={() => setError("Contact your hotel administrator to create an account.")}>Sign up</button></p>
            <div className="hotjar-social-options">
              <button type="button" className="hotjar-social google" disabled title="התחברות עם Google עדיין אינה זמינה"><span className="hotjar-social-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"/><path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.97-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48Z"/></svg></span>Sign in with Google</button>
              <button type="button" className="hotjar-social sso" disabled title="התחברות ארגונית עדיין אינה זמינה"><span className="hotjar-social-icon"><LockKeyhole size={27} /></span>Sign in with SAML SSO</button>

            </div>
            <div className="hotjar-divider"><span>Or, sign in with email</span></div>
            {mfa && (
              <form onSubmit={async (e) => { e.preventDefault(); if (loading) return; setError(''); setLoading(true); try { const u = await verifyMfa(mfa.ticket, code.trim()); navigate(from || homeFor(u?.role), { replace: true }); } catch (err) { setError(errorMessage(err)); setCode(''); if (err?.response?.status === 401 && /פג תוקף|מחדש/.test(errorMessage(err))) setMfa(null); } finally { setLoading(false); } }}>
                <div className="hotjar-field">
                  <label htmlFor="login-code">קוד אימות (6 ספרות מהאפליקציה, או קוד שחזור)</label>
                  <input id="login-code" dir="ltr" autoFocus value={code} onChange={(e) => { setCode(e.target.value); setError(''); }} autoComplete="one-time-code" inputMode="numeric" maxLength={11} required aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} />
                  {error && <p id="login-error" role="alert" className="hotjar-login-error"><AlertCircle size={15} />{error}</p>}
                </div>
                <button type="submit" disabled={loading || code.trim().length < 6} className="hotjar-submit">{loading ? <><Loader2 size={18} className="animate-spin" /> בודק…</> : 'אימות'}</button>
                <button type="button" className="hotjar-forgot" onClick={() => { setMfa(null); setPassword(''); setError(''); }}>חזרה</button>
              </form>
            )}
            {!mfa && <form onSubmit={handleSubmit}>
              <div className="hotjar-field">
                <label htmlFor="login-email">Email address</label>
                <input id="login-email" type="email" dir="ltr" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} autoComplete="username" inputMode="email" required aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} />
              </div>
              <div className="hotjar-field">
                <label htmlFor="login-password">Password</label>
                <div className="hotjar-password">
                  <input id="login-password" type={showPwd ? 'text' : 'password'} dir="ltr" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} onKeyUp={trackCaps} onKeyDown={trackCaps} autoComplete="current-password" required aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} />
                  <button type="button" onClick={() => setShowPwd(v => !v)} aria-label={showPwd ? 'הסתר סיסמה' : 'הצג סיסמה'} aria-pressed={showPwd}>{showPwd ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
                {capsLock && <p className="hotjar-login-error">Caps Lock פעיל</p>}
                {error && <p id="login-error" role="alert" className="hotjar-login-error"><AlertCircle size={15} />{error}</p>}
              </div>
              <label className="hotjar-remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Keep me signed in</label>
              <Link to="/reset-password" className="hotjar-forgot">Forgot password?</Link>
              <button type="submit" disabled={loading || !email.trim() || !password} className="hotjar-submit">{loading ? <><Loader2 size={18} className="animate-spin" /> מתחבר…</> : 'Sign in'}</button>
            </form>}

          </div>
        </section>
        <aside className="hotjar-login-promo" aria-label="Dashboards: your new command center">
          <img src="/design/hotjar-login-mcp.webp" alt="Dashboards: your new command center. Create dashboards in seconds with new templates, and see your metrics and user sentiment in one place." className="hotjar-promo-source" />
        </aside>
      </main>
    </div>
  );
}
