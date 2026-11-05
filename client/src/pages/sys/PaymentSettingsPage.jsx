// Clearing settings (gap-map item 12): the property's own provider account and the authorization policy.
// Credentials are sealed on the server and never shown again — only whether they are set.
import { useEffect, useState } from 'react';
import '../ops/EventsPage.css';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { cards } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, PageBar, Card, Field, ErrorBanner, Spinner, Banner, Segmented, useLoader, useAction } from '../../components/kit';

const MANAGE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];

export default function PaymentSettingsPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const { toasts, success } = useToast();
  const act = useAction();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? cards.settings(propertyId) : null), [propertyId]);
  const [f, setF] = useState(null);
  const [creds, setCreds] = useState({});
  useEffect(() => { if (data) { setF({ provider: data.provider, mode: data.mode, authOnCheckIn: data.authOnCheckIn, authBasis: data.authBasis, authAmount: data.authAmount ?? '', incidentals: data.incidentals ?? 0 }); setCreds({}); } }, [data]);
  const canManage = MANAGE.includes(role);
  const provider = data?.providers.find((p) => p.name === f?.provider);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = () => act.run(async () => { await cards.saveSettings(propertyId, { ...f, authAmount: f.authAmount === '' ? undefined : Number(f.authAmount), incidentals: Number(f.incidentals || 0), ...(Object.keys(creds).length ? { credentials: creds } : {}) }); success('הגדרות הסליקה נשמרו'); reload(); });
  return (
    <Page approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="הגדרות סליקה" meta="ספק הסליקה של המלון ומדיניות המסגרת בצ'ק־אין" back="/pms" />
      <ErrorBanner error={error} onRetry={reload} />
      {(loading && !data) || !f ? <Spinner /> : (
        <Card>
          <div className="ui-stack">
            <ErrorBanner error={act.error} />
            {!data.available && <Banner tone="error">ספק הסליקה לא זמין — אי אפשר לבצע פעולות כרטיס.</Banner>}
            {f.provider === 'mock' && <Banner tone="warn">ספק בדיקה: כסף אמיתי לא עובר, ובייצור הוא נחסם. כרטיסי בדיקה: {data.testCards.map((t) => `${t.number} (${t.label})`).join(' · ')}</Banner>}
            <div className="ui-grid-2">
              <Field id="ps-p" label="ספק סליקה" error={act.fields.provider}><select id="ps-p" className="input w-full" disabled={!canManage} value={f.provider} onChange={set('provider')}>{data.providers.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}</select></Field>
              <Field id="ps-m" label="מצב" error={act.fields.mode}><select id="ps-m" className="input w-full" disabled={!canManage} value={f.mode} onChange={set('mode')}><option value="test">בדיקה</option><option value="live">אמיתי</option></select></Field>
            </div>
            {provider?.credentialFields?.length > 0 && (
              <fieldset className="ui-fieldset"><legend className="ui-label">פרטי החשבון אצל הספק {data.credentialsSet ? <span className="ui-sub">(שמורים — מילוי מחליף אותם)</span> : null}</legend>
                <div className="ui-grid-2">{provider.credentialFields.map((c) => <Field key={c.key} id={`cr-${c.key}`} label={c.label}><input id={`cr-${c.key}`} dir="ltr" type={c.secret ? 'password' : 'text'} autoComplete="off" className="input w-full" value={creds[c.key] || ''} onChange={(e) => setCreds((p) => ({ ...p, [c.key]: e.target.value }))} /></Field>)}</div>
              </fieldset>
            )}
            <fieldset className="ui-fieldset"><legend className="ui-label">מסגרת בצ'ק־אין</legend>
              <label className="ui-check"><input type="checkbox" disabled={!canManage} checked={!!f.authOnCheckIn} onChange={set('authOnCheckIn')} /><span>לקחת מסגרת אוטומטית בצ'ק־אין כשיש כרטיס בהזמנה</span></label>
              <Segmented label="בסיס" value={f.authBasis} onChange={(v) => canManage && setF((p) => ({ ...p, authBasis: v }))} options={[{ value: 'stay', label: 'כל עלות השהייה' }, { value: 'per_night', label: 'סכום ללילה' }, { value: 'fixed', label: 'סכום קבוע' }]} />
              <div className="ui-grid-2">
                {f.authBasis !== 'stay' && <Field id="ps-a" label={f.authBasis === 'per_night' ? 'סכום ללילה (₪)' : 'סכום (₪)'} error={act.fields.authAmount}><input id="ps-a" type="number" min="0" className="input w-full" disabled={!canManage} value={f.authAmount} onChange={set('authAmount')} /></Field>}
                <Field id="ps-i" label="תוספת להוצאות ללילה (₪)" hint="נוספת למסגרת לכל לילה שנשאר" error={act.fields.incidentals}><input id="ps-i" type="number" min="0" className="input w-full" disabled={!canManage} value={f.incidentals} onChange={set('incidentals')} /></Field>
              </div>
            </fieldset>
            {canManage ? <div><button type="button" className="btn btn-primary" onClick={save} disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button></div> : <Banner tone="info">שינוי הגדרות — למנהל או לכספים.</Banner>}
          </div>
        </Card>
      )}
    </Page>
  );
}
