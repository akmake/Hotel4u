import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, Hotel, Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

// Legacy sales roles land on the sales home; every PMS role lands on the front-desk "Today" screen.
const SALES_ROLES = ['admin', 'sales', 'maintenance', 'shift_manager'];
const homeFor = (role) => (SALES_ROLES.includes(role) ? '/' : '/pms');

// Seeded demo accounts — shown in local development only, never in a production build.
const DEMO_USERS = import.meta.env.DEV
  ? [
      { email: 'admin@galil.co.il', name: 'מנהל נכס' },
      { email: 'dina@galil.co.il',  name: 'קבלה' },
      { email: 'ruth@galil.co.il',  name: 'חדרנות' },
      { email: 'avi@galil.co.il',   name: 'אחזקה' },
    ]
  : [];
const DEMO_PASSWORD = import.meta.env.DEV ? 'hotel4u123' : '';

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
      const u = await login({ email: em, password: pw });
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
    <div className="min-h-screen w-full flex flex-col bg-surface">
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-[360px]">
          {/* Brand */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-10 h-10 rounded-lg bg-accent-600 text-white flex items-center justify-center mb-4">
              <Hotel size={20} strokeWidth={2.25} />
            </div>
            <h1 className="text-xl font-semibold text-ink">כניסה ל־<bdi>Hotel4U</bdi></h1>
            <p className="text-[13px] text-ink-muted mt-1">מערכת ניהול המלון</p>
          </div>

          {/* Form */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-6 shadow-card">
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-email" className="text-[13px] font-medium text-ink-secondary">אימייל</label>
                <input
                  id="login-email"
                  type="email"
                  dir="ltr"
                  className="input !h-10 text-right"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(''); }}
                  autoComplete="username"
                  inputMode="email"
                  autoFocus
                  required
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-password" className="text-[13px] font-medium text-ink-secondary">סיסמה</label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPwd ? 'text' : 'password'}
                    dir="ltr"
                    className="input !h-10 text-right !pl-10"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    onKeyUp={trackCaps}
                    onKeyDown={trackCaps}
                    autoComplete="current-password"
                    required
                    aria-invalid={!!error}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute left-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm btn-icon"
                    aria-label={showPwd ? 'הסתר סיסמה' : 'הצג סיסמה'}
                    aria-pressed={showPwd}
                  >
                    {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {capsLock && (
                  <p className="text-xs text-amber-700">Caps Lock פעיל</p>
                )}
              </div>

              {error && (
                <div id="login-error" role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
                  <AlertCircle size={15} className="shrink-0 mt-px" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim() || !password}
                className="btn btn-primary !h-10 w-full text-sm mt-1"
              >
                {loading ? <><Loader2 size={15} className="animate-spin" /> מתחבר…</> : 'כניסה'}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-ink-muted mt-5">
            שכחת סיסמה? מנהל המערכת יכול לאפס אותה עבורך.
          </p>

          {DEMO_USERS.length > 0 && (
            <div className="mt-8 border-t border-dashed border-surface-border pt-5">
              <p className="text-[11px] font-medium text-ink-faint text-center mb-3">סביבת פיתוח · כניסה מהירה</p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_USERS.map(u => (
                  <button
                    key={u.email}
                    type="button"
                    disabled={loading}
                    onClick={() => doLogin(u.email, DEMO_PASSWORD)}
                    className="btn btn-secondary btn-sm justify-start"
                    title={u.email}
                  >
                    {u.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="py-4 text-center text-[11px] text-ink-faint">
        <span dir="ltr">© {new Date().getFullYear()} Hotel4U</span>
      </footer>
    </div>
  );
}
