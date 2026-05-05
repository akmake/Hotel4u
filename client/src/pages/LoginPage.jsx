import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Eye, EyeOff, Lock, Mail, AlertCircle, Hotel } from 'lucide-react';

const DEMO_USERS = [
  { email: 'admin@galil.co.il', initials: 'א', name: 'אדמין',  role: 'מנהל נכס', color: '#6366f1' },
  { email: 'dina@galil.co.il',  initials: 'ד', name: 'דינה',   role: 'קבלנ/ית',  color: '#0891b2' },
  { email: 'ruth@galil.co.il',  initials: 'ר', name: 'רות',    role: 'חדרנות',   color: '#059669' },
  { email: 'avi@galil.co.il',   initials: 'ב', name: 'אבי',    role: 'טכנאי',    color: '#ea580c' },
];

export default function LoginPage() {
  const { login } = useAuthStore();
  const navigate = useNavigate();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function doLogin(em, pw) {
    setError('');
    setLoading(true);
    try {
      await login({ email: em, password: pw });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'שגיאה בהתחברות');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = (e) => { e.preventDefault(); doLogin(email.trim(), password); };
  const quickLogin   = (em) => doLogin(em, 'hotel4u123');

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      direction: 'rtl',
      background: '#0c111d',
      padding: 24,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background dots */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.12) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }} />
      {/* Glow top-right */}
      <div style={{
        position: 'absolute', top: -120, right: -120, width: 480, height: 480,
        borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 65%)',
      }} />
      {/* Glow bottom-left */}
      <div style={{
        position: 'absolute', bottom: -100, left: -100, width: 360, height: 360,
        borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 65%)',
      }} />

      {/* Card */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 420,
        background: 'white',
        borderRadius: 20,
        boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        overflow: 'hidden',
      }}>
        {/* Card top strip */}
        <div style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 60%, #818cf8 100%)',
          padding: '28px 32px 24px',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Hotel size={24} style={{ color: 'white' }} />
          </div>
          <div>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 20, letterSpacing: '-0.5px' }}>Hotel4U</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 }}>Hotel Operating System</div>
          </div>
        </div>

        {/* Form body */}
        <div style={{ padding: '28px 32px' }}>
          <div style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>כניסה למערכת</h2>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>הכנס/י פרטי התחברות להמשך</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Email */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>אימייל</label>
              <div style={{ position: 'relative' }}>
                <Mail size={14} style={{
                  position: 'absolute', right: 11, top: '50%',
                  transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none',
                }} />
                <input
                  type="email"
                  className="input"
                  style={{ paddingRight: 34 }}
                  placeholder="admin@galil.co.il"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>סיסמה</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{
                  position: 'absolute', right: 11, top: '50%',
                  transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none',
                }} />
                <input
                  type={showPwd ? 'text' : 'password'}
                  className="input"
                  style={{ paddingRight: 34, paddingLeft: 34 }}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPwd(v => !v)}
                  style={{
                    position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
                    color: '#94a3b8', background: 'none', border: 'none',
                    cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center',
                  }}
                >
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 12px', borderRadius: 8, fontSize: 12,
                color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca',
              }}>
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ justifyContent: 'center', padding: '11px 20px', fontSize: 14, marginTop: 4 }}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 15, height: 15, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white',
                    display: 'inline-block', animation: 'loginSpin 0.65s linear infinite',
                  }} />
                  מתחבר...
                </span>
              ) : 'כניסה'}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 16px' }}>
            <div style={{ flex: 1, height: 1, background: '#f1f5f9' }} />
            <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>כניסה מהירה — Demo</span>
            <div style={{ flex: 1, height: 1, background: '#f1f5f9' }} />
          </div>

          {/* Demo users — click = immediate login */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {DEMO_USERS.map(u => (
              <button
                key={u.email}
                type="button"
                disabled={loading}
                onClick={() => quickLogin(u.email)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                  background: '#f8fafc', border: '1.5px solid #e2e8f0',
                  transition: 'all 0.15s ease', textAlign: 'right',
                  opacity: loading ? 0.5 : 1,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = u.color;
                  e.currentTarget.style.background = `${u.color}0c`;
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${u.color}18`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#e2e8f0';
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  background: u.color, color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 900,
                }}>
                  {u.initials}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{u.role}</div>
                </div>
              </button>
            ))}
          </div>

          <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 14 }}>
            סיסמה:{' '}
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#64748b' }}>hotel4u123</span>
          </p>
        </div>
      </div>

      <style>{`@keyframes loginSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
