// SYS-04 — personal profile and sessions: display name and language (they do not change hotel
// settings), password change (ends other sessions), "log out everywhere", recent sign-ins.
import { useEffect, useState } from 'react';
import { identity } from '../../utils/api';
import { roleLabel } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, Card, Field, ErrorBanner, Banner, Spinner, KeyValues, ConfirmDialog, Tag, useLoader, useAction, formatDateTime } from '../../components/kit';

const ACCESS_LABELS = { LOGIN: 'כניסה', 'auth.login': 'כניסה', 'auth.logout_all': 'ניתוק מכל המכשירים', 'auth.password_changed': 'שינוי סיסמה', 'auth.password_reset': 'איפוס סיסמה', 'auth.password_set': 'הגדרת סיסמה' };

export default function ProfilePage() {
  const { toasts, success } = useToast();
  const { data, loading, error, reload } = useLoader(() => identity.me(), []);
  const [f, setF] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [confirmAll, setConfirmAll] = useState(false);
  const save = useAction();
  const pass = useAction();
  useEffect(() => { if (data) setF({ displayName: data.displayName || '', language: data.language || 'he', firstName: data.firstName, lastName: data.lastName }); }, [data]);

  if (loading && !data) return <Page><div className="ui-empty"><Spinner /> טוען…</div></Page>;
  if (error) return <Page><ErrorBanner error={error} onRetry={reload} /></Page>;
  if (!f) return null;
  const dirty = f.displayName !== (data.displayName || '') || f.language !== (data.language || 'he') || f.firstName !== data.firstName || f.lastName !== data.lastName;
  const pwWhy = !pw.current ? 'הסיסמה הנוכחית' : pw.next.length < 8 ? 'לפחות 8 תווים' : !/\d/.test(pw.next) || !/[A-Za-z֐-׿]/.test(pw.next) ? 'אותיות וספרות' : pw.next !== pw.confirm ? 'האישור אינו זהה' : null;
  // A new token for this device after the server ended all other sessions.
  const keepThisSession = (token) => { if (token) localStorage.setItem('hotel4u_token', token); };

  return (
    <Page>
      <ToastContainer toasts={toasts} />
      <div className="ui-toolbar"><div className="ui-h3">הפרופיל שלי</div></div>
      <div className="ui-split">
        <div className="ui-stack">
          <Card title="פרטים והעדפות">
            <ErrorBanner error={save.error} />
            <div className="ui-grid-2">
              <Field id="me-f" label="שם פרטי" required error={save.fields.firstName}><input id="me-f" className="input w-full" maxLength={60} value={f.firstName} onChange={(e) => setF((p) => ({ ...p, firstName: e.target.value }))} /></Field>
              <Field id="me-l" label="שם משפחה" required error={save.fields.lastName}><input id="me-l" className="input w-full" maxLength={60} value={f.lastName} onChange={(e) => setF((p) => ({ ...p, lastName: e.target.value }))} /></Field>
              <Field id="me-d" label="שם תצוגה" optional hint="עד 100 תווים" error={save.fields.displayName}><input id="me-d" className="input w-full" maxLength={100} value={f.displayName} onChange={(e) => setF((p) => ({ ...p, displayName: e.target.value }))} /></Field>
              <Field id="me-lang" label="שפה" required>
                <select id="me-lang" className="select w-full" value={f.language} onChange={(e) => setF((p) => ({ ...p, language: e.target.value }))}><option value="he">עברית</option><option value="en">English</option></select>
              </Field>
            </div>
            <div className="ui-sub">היום העסקי ואזור הזמן נקבעים לפי הנכס{data.property ? ` (${data.property.timezone})` : ''} — לא משתנים כאן.</div>
            <div className="ui-row"><button type="button" className="btn btn-primary btn-sm" disabled={!dirty || save.busy} onClick={() => save.run(async () => { await identity.updateMe(f); success('נשמר'); reload(); })}>{save.busy ? <Spinner /> : 'שמירה'}</button></div>
          </Card>
          <Card title="שינוי סיסמה">
            <ErrorBanner error={pass.error} />
            <div className="ui-grid-3">
              <Field id="pw-c" label="סיסמה נוכחית" required error={pass.fields.current}><input id="pw-c" type="password" autoComplete="current-password" className="input w-full" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} /></Field>
              <Field id="pw-n" label="סיסמה חדשה" required hint="8+ תווים, אותיות וספרות" error={pass.fields.next}><input id="pw-n" type="password" autoComplete="new-password" className="input w-full" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} /></Field>
              <Field id="pw-k" label="אישור סיסמה" required><input id="pw-k" type="password" autoComplete="new-password" className="input w-full" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} /></Field>
            </div>
            <div className="ui-row">
              <button type="button" className="btn btn-primary btn-sm" disabled={!!pwWhy || pass.busy} title={pwWhy || undefined} onClick={() => pass.run(async () => { const out = await identity.password(pw.current, pw.next); keepThisSession(out.token); setPw({ current: '', next: '', confirm: '' }); success('הסיסמה שונתה — מכשירים אחרים ינותקו'); reload(); })}>{pass.busy ? <Spinner /> : 'שינוי סיסמה'}</button>
              {pwWhy && (pw.next || pw.current) && <span className="ui-sub">{pwWhy}</span>}
            </div>
          </Card>
        </div>
        <div className="ui-stack">
          <Card title="חשבון">
            <KeyValues rows={[
              ['דוא״ל', <bdi key="e">{data.email}</bdi>],
              ['תפקיד', roleLabel(data.role)],
              ['נכס', data.property?.name || '—'],
              ['אימות דו־שלבי', data.twoFactorEnabled ? 'מופעל' : 'לא מופעל'],
              data.accessUntil && ['גישה עד', formatDateTime(data.accessUntil)],
            ]} />
          </Card>
          <MfaCard enabled={!!data.twoFactorEnabled} onChanged={(m) => { success(m); reload(); }} />
          <Card title="מושבים וכניסות אחרונות" actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmAll(true)}>ניתוק מכל המכשירים</button>}>
            {data.recentAccess.length === 0 ? <div className="ui-sub">אין רשומות</div> : (
              <ul className="ui-timeline">
                {data.recentAccess.map((a, i) => <li key={i}><strong>{ACCESS_LABELS[a.action] || a.action}</strong><span className="ui-sub">{formatDateTime(a.at)}{a.ip ? ` · ${a.ip}` : ''}</span>{a.device && <span className="ui-sub" dir="ltr" style={{ textAlign: 'right' }}>{a.device}</span>}</li>)}
              </ul>
            )}
            <Tag>המכשיר הנוכחי יישאר מחובר</Tag>
          </Card>
        </div>
      </div>
      <ConfirmDialog open={confirmAll} onClose={() => setConfirmAll(false)} title="ניתוק מכל המכשירים" confirmLabel="ניתוק" danger onConfirm={async () => { const out = await identity.logoutAll(); keepThisSession(out.token); setConfirmAll(false); success('כל המושבים האחרים נותקו'); reload(); }}>
        <Banner tone="info">כל מכשיר אחר שמחובר בשם שלך ינותק מיד ויצטרך להתחבר מחדש.</Banner>
      </ConfirmDialog>
    </Page>
  );
}

// SYS-01 two-factor: set up with an authenticator app (key + otpauth link), confirm with a code, keep the recovery codes.
function MfaCard({ enabled, onChanged }) {
  const act = useAction();
  const [setupData, setSetupData] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [disabling, setDisabling] = useState(false);
  return (
    <Card title="אימות דו־שלבי">
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        {recovery && (
          <Banner tone="warn">
            <div><b>קודי שחזור — מוצגים פעם אחת בלבד.</b> שמרו אותם במקום בטוח; כל קוד משמש פעם אחת אם הטלפון לא זמין.</div>
            <div className="ui-num" dir="ltr" style={{ columns: 2, marginTop: 6 }}>{recovery.map((c) => <div key={c}>{c}</div>)}</div>
          </Banner>
        )}
        {!enabled && !setupData && (
          <>
            <p className="ui-sub">אחרי הסיסמה תתבקשו קוד מאפליקציית אימות (Google Authenticator, Microsoft Authenticator וכדומה).</p>
            <button type="button" className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(async () => { setSetupData(await identity.mfaSetup()); setCode(''); })}>הפעלה</button>
          </>
        )}
        {!enabled && setupData && (
          <>
            <p className="ui-sub">באפליקציה: הוספת חשבון ← הזנת מפתח ידנית. בטלפון אפשר גם ללחוץ על הקישור.</p>
            <KeyValues rows={[['מפתח', <bdi key="k" className="ui-num" dir="ltr">{setupData.secret}</bdi>], ['קישור', <a key="l" href={setupData.otpauth} dir="ltr">פתיחה באפליקציה</a>]]} />
            <Field id="mfa-code" label="קוד מהאפליקציה" required error={act.fields.code}><input id="mfa-code" className="input w-full" dir="ltr" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
            <button type="button" className="btn btn-primary btn-sm" disabled={act.busy || code.length !== 6} onClick={() => act.run(async () => { const out = await identity.mfaEnable(code); setRecovery(out.recoveryCodes); setSetupData(null); onChanged('אימות דו־שלבי הופעל'); })}>אישור והפעלה</button>
          </>
        )}
        {enabled && !disabling && (
          <>
            <p className="ui-sub">מופעל. בכל כניסה תתבקשו קוד מהאפליקציה.</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setDisabling(true); setCode(''); setPassword(''); act.reset(); }}>ביטול אימות דו־שלבי</button>
          </>
        )}
        {enabled && disabling && (
          <>
            <Field id="mfa-pw" label="סיסמה" required error={act.fields.password}><input id="mfa-pw" type="password" className="input w-full" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field id="mfa-code2" label="קוד מהאפליקציה" required error={act.fields.code}><input id="mfa-code2" className="input w-full" dir="ltr" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
            <div className="ui-row">
              <button type="button" className="btn btn-danger btn-sm" disabled={act.busy || !password || code.length !== 6} onClick={() => act.run(async () => { await identity.mfaDisable(password, code); setDisabling(false); onChanged('אימות דו־שלבי בוטל'); })}>ביטול</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDisabling(false)}>חזרה</button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
