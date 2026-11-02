// Hotel setup → "נגישות ופרטיות": the two statements the hotel publishes — its accessibility
// arrangements (with a contact for accessibility requests) and the privacy notice shown on the
// booking site and in the online check-in. Server: services/legalPagesService.js.
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { setup } from '../../utils/api';
import { Card, Field, ErrorBanner, Banner, Spinner, useLoader, useAction } from '../kit';

const ADMIN = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager'];

export default function PublicStatementsCard({ propertyId, role, onSaved }) {
  const canEdit = ADMIN.includes(role);
  const { data, loading, error, reload } = useLoader(async () => (propertyId && canEdit ? setup.statements(propertyId) : null), [propertyId, canEdit]);
  const [f, setF] = useState(null);
  const save = useAction();
  useEffect(() => { if (data) setF({ accessibility: { ...data.accessibility }, privacy: { ...data.privacy } }); }, [data]);
  if (!canEdit) return <Card title="נגישות ופרטיות"><Banner tone="info">ההצהרות פתוחות לעריכה להנהלה.</Banner></Card>;
  if (loading && !f) return <Card title="נגישות ופרטיות"><div className="ui-empty"><Spinner /> טוען…</div></Card>;
  if (!f || !data) return <Card title="נגישות ופרטיות"><ErrorBanner error={error} onRetry={reload} /></Card>;

  const e = save.fields || {};
  const a = f.accessibility;
  const pv = f.privacy;
  const setA = (k) => (ev) => setF((x) => ({ ...x, accessibility: { ...x.accessibility, [k]: ev.target.value } }));
  const setP = (k) => (ev) => setF((x) => ({ ...x, privacy: { ...x.privacy, [k]: ev.target.value } }));
  const toggle = (code) => setF((x) => ({ ...x, accessibility: { ...x.accessibility, features: x.accessibility.features.includes(code) ? x.accessibility.features.filter((c) => c !== code) : [...x.accessibility.features, code] } }));
  const origin = window.location.origin;
  const submit = () => save.run(async () => {
    const out = await setup.saveStatements(propertyId, { accessibility: a, privacy: pv });
    setF({ accessibility: { ...out.accessibility }, privacy: { ...out.privacy } });
    onSaved('הצהרת הנגישות ומדיניות הפרטיות נשמרו ומוצגות באתר');
  });

  return (
    <>
      <Card
        title="הצהרת נגישות"
        actions={(
          <>
            <a className="btn btn-secondary btn-sm" href={`${origin}${data.publicPaths.accessibility}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> צפייה באתר</a>
            <button type="button" className="btn btn-primary btn-sm" disabled={save.busy} onClick={submit}>{save.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button>
          </>
        )}
      >
        <div className="ui-stack">
          <ErrorBanner error={save.error} />
          {!a.configured && <Banner tone="warn">תקנות הנגישות לשירות מחייבות לפרסם את הסדרי הנגישות של המלון ואיש קשר לפניות. עד שתשמרו — האתר מציג הצהרה חסרה.</Banner>}
          <div className="ui-section-title">הסדרי נגישות קיימים במלון</div>
          <div className="ui-grid-2">
            {data.features.map((ft) => (
              <label key={ft.code} className="ui-check"><input type="checkbox" checked={a.features.includes(ft.code)} onChange={() => toggle(ft.code)} /><span>{ft.label}</span></label>
            ))}
          </div>
          <div className="ui-sub">חדרים נגישים במלון: {data.accessibleRooms} (לפי סימון "נגיש" בהגדרת החדרים — מוצג באתר אוטומטית).</div>
          <Field id="ac-details" label="פרטים נוספים" optional hint="רוחב דלתות ומעברים, גובה המיטה, מסלול נגיש מהחניה, שירותים שאינם נגישים — מה שאורח עם מוגבלות צריך לדעת מראש">
            <textarea id="ac-details" className="input w-full" rows={4} maxLength={3000} value={a.details} onChange={setA('details')} />
          </Field>
          <div className="ui-section-title">פנייה בנושא נגישות</div>
          <div className="ui-grid-2">
            <Field id="ac-name" label="רכז/ת נגישות או איש קשר" required error={e['accessibility.coordinatorName']}><input id="ac-name" className="input w-full" maxLength={120} value={a.coordinatorName} onChange={setA('coordinatorName')} /></Field>
            <Field id="ac-phone" label="טלפון" error={e['accessibility.coordinatorPhone']}><input id="ac-phone" className="input w-full" dir="ltr" maxLength={40} value={a.coordinatorPhone} onChange={setA('coordinatorPhone')} /></Field>
            <Field id="ac-email" label="דוא״ל" optional error={e['accessibility.coordinatorEmail']}><input id="ac-email" className="input w-full" dir="ltr" maxLength={120} value={a.coordinatorEmail} onChange={setA('coordinatorEmail')} /></Field>
            <Field id="ac-rev" label="בדיקת נגישות אחרונה" optional error={e['accessibility.reviewedAt']}><input id="ac-rev" type="date" className="input w-full" value={a.reviewedAt} onChange={setA('reviewedAt')} /></Field>
          </div>
        </div>
      </Card>

      <Card
        title="מדיניות פרטיות"
        actions={<a className="btn btn-secondary btn-sm" href={`${origin}${data.publicPaths.privacy}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> צפייה באתר</a>}
      >
        <div className="ui-stack">
          {!pv.configured && <Banner tone="info">מוצגת כרגע מדיניות ברירת מחדל שנבנתה מפרטי המלון ומהמידע שהמערכת אוספת בפועל. בדקו אותה (רצוי מול עו״ד) ושמרו.</Banner>}
          <div className="ui-sub">ההודעה מפרטת מה נאסף, האם חובה למסור, לאילו מטרות ולמי המידע מועבר — כפי שחוק הגנת הפרטיות מחייב לפני איסוף מידע. היא מקושרת מאתר ההזמנות ומהצ׳ק-אין המקוון.</div>
          <div className="ui-grid-2">
            <Field id="pv-ctrl" label="הגוף המחזיק במידע" required error={e['privacy.controller']} hint="השם המשפטי של בעל המלון"><input id="pv-ctrl" className="input w-full" maxLength={200} value={pv.controller} onChange={setP('controller')} /></Field>
            <Field id="pv-email" label="דוא״ל לפניות פרטיות" required error={e['privacy.contactEmail']}><input id="pv-email" className="input w-full" dir="ltr" maxLength={120} value={pv.contactEmail} onChange={setP('contactEmail')} /></Field>
          </div>
          <Field id="pv-ret" label="כמה זמן נשמר המידע"><textarea id="pv-ret" className="input w-full" rows={2} maxLength={600} value={pv.retention} onChange={setP('retention')} /></Field>
          <Field id="pv-extra" label="תוספת למדיניות" optional hint="למשל מצלמות אבטחה בשטחים הציבוריים, שימוש בעוגיות באתר"><textarea id="pv-extra" className="input w-full" rows={3} maxLength={3000} value={pv.extra} onChange={setP('extra')} /></Field>
          <div className="ui-row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary btn-sm" disabled={save.busy} onClick={submit}>{save.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button></div>
          {(data.accessibility.updatedByName || data.privacy.updatedByName) && <div className="ui-sub">עודכן לאחרונה על ידי {data.privacy.updatedByName || data.accessibility.updatedByName}</div>}
        </div>
      </Card>
    </>
  );
}
