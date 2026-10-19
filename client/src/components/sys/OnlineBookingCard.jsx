// Public booking site settings (hotel setup → "אתר ההזמנות"): on/off, payment at booking (full or a
// deposit), how long the room is held while the guest pays, which rate plans are sold, and the texts.
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { setup } from '../../utils/api';
import { Card, Field, ErrorBanner, Banner, Spinner, Segmented, useLoader, useAction } from '../kit';

const ADMIN = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager'];

export default function OnlineBookingCard({ propertyId, role, onSaved }) {
  const canEdit = ADMIN.includes(role);
  const { data, loading, error, reload } = useLoader(async () => (propertyId && canEdit ? setup.online(propertyId) : null), [propertyId, canEdit]);
  const [f, setF] = useState(null);
  const save = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!canEdit) return <Card title="אתר ההזמנות"><Banner tone="info">הגדרות אתר ההזמנות פתוחות להנהלה ולמנהל ההכנסות.</Banner></Card>;
  if (loading && !f) return <Card title="אתר ההזמנות"><div className="ui-empty"><Spinner /> טוען…</div></Card>;
  if (!f) return <Card title="אתר ההזמנות"><ErrorBanner error={error} onRetry={reload} /></Card>;

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const usesDefault = !f.ratePlanCodes.length;
  const sold = (code) => (usesDefault ? f.plans.find((x) => x.code === code)?.publicByDefault : f.ratePlanCodes.includes(code));
  const togglePlan = (code) => setF((x) => {
    const base = x.ratePlanCodes.length ? x.ratePlanCodes : x.plans.filter((pl) => pl.publicByDefault).map((pl) => pl.code);
    return { ...x, ratePlanCodes: base.includes(code) ? base.filter((c) => c !== code) : [...base, code] };
  });
  const e = save.fields;
  const siteUrl = `${window.location.origin}${f.url}`;
  const submit = () => save.run(async () => {
    const out = await setup.saveOnline(propertyId, { enabled: f.enabled, payment: f.payment, depositPct: f.depositPct, holdMinutes: f.holdMinutes, ratePlanCodes: f.ratePlanCodes, headline: f.headline, intro: f.intro, termsText: f.termsText });
    setF(out);
    onSaved(out.enabled ? 'אתר ההזמנות פעיל ונשמר' : 'ההגדרות נשמרו — האתר כבוי');
  });

  return (
    <Card
      title="אתר ההזמנות"
      actions={(
        <>
          <a className="btn btn-secondary btn-sm" href={siteUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> פתיחת האתר</a>
          <button type="button" className="btn btn-primary btn-sm" disabled={save.busy} onClick={submit}>{save.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button>
        </>
      )}
    >
      <div className="ui-stack">
        <ErrorBanner error={save.error} />
        {!f.paymentsAvailable && <Banner tone="error">אין ספק סליקה מחובר — האתר לא יכול לגבות תשלום, ולכן לא ניתן להזמין בו. יש לבחור חברת סליקה ולחבר אותה.</Banner>}
        {f.paymentsAvailable && f.testMode && <Banner tone="warn">מצב בדיקה: התשלום מדומה ולא נגבה כסף. לפני עלייה לאוויר יש לחבר חברת סליקה אמיתית.</Banner>}
        <label className="ui-check"><input type="checkbox" checked={f.enabled} onChange={set('enabled')} /><span><b>האתר פעיל</b> — אורחים יכולים לחפש, להזמין ולשלם</span></label>
        <div className="ui-sub">כתובת האתר: <a className="ui-link" href={siteUrl} target="_blank" rel="noreferrer" dir="ltr">{siteUrl}</a></div>

        <div className="ui-section-title">תשלום בעת ההזמנה</div>
        <Segmented label="תשלום" value={f.payment} onChange={(v) => setF((x) => ({ ...x, payment: v }))} options={[{ value: 'full', label: 'מלוא הסכום' }, { value: 'deposit', label: 'מקדמה' }]} />
        <div className="ui-grid-2">
          {f.payment === 'deposit' && (
            <Field id="ob-pct" label="אחוז המקדמה" error={e.depositPct} hint="היתרה משולמת במלון"><input id="ob-pct" className="input w-full" inputMode="numeric" value={f.depositPct} onChange={set('depositPct')} /></Field>
          )}
          <Field id="ob-hold" label="כמה זמן החדר שמור בזמן התשלום (דקות)" error={e.holdMinutes} hint="15–60. אחרי זה החדר משתחרר למכירה"><input id="ob-hold" className="input w-full" inputMode="numeric" value={f.holdMinutes} onChange={set('holdMinutes')} /></Field>
        </div>

        <div className="ui-section-title">תעריפים שנמכרים באתר</div>
        <div className="ui-sub">{usesDefault ? 'כרגע: כל התעריפים הציבוריים (לא חברות, OTA או קבוצות). סימון ידני קובע רשימה קבועה.' : 'רשימה קבועה.'}</div>
        <div className="ui-row" style={{ gap: 16, flexWrap: 'wrap' }}>
          {f.plans.map((pl) => (
            <label key={pl.code} className="ui-check"><input type="checkbox" checked={!!sold(pl.code)} onChange={() => togglePlan(pl.code)} /><span>{pl.name} <span className="ui-sub ui-num">{pl.code}</span></span></label>
          ))}
        </div>
        {!usesDefault && <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'fit-content' }} onClick={() => setF((x) => ({ ...x, ratePlanCodes: [] }))}>חזרה לברירת המחדל</button>}

        <div className="ui-section-title">טקסטים</div>
        <Field id="ob-head" label="כותרת ראשית" optional hint="ריק = שם המלון"><input id="ob-head" className="input w-full" maxLength={120} value={f.headline} onChange={set('headline')} /></Field>
        <Field id="ob-intro" label="פסקת פתיחה" optional><textarea id="ob-intro" className="input w-full" rows={2} maxLength={600} value={f.intro} onChange={set('intro')} /></Field>
        <Field id="ob-terms" label="תנאי ההזמנה" optional hint="מוצג לאורח לפני התשלום, יחד עם מדיניות הביטול של התעריף ומדיניות הפרטיות"><textarea id="ob-terms" className="input w-full" rows={4} maxLength={4000} value={f.termsText} onChange={set('termsText')} /></Field>
        {f.updatedByName && <div className="ui-sub">עודכן לאחרונה על ידי {f.updatedByName}</div>}
      </div>
    </Card>
  );
}
