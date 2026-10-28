// FIN-06 / FIN-10 / FIN-11 set-up — the issuing business, document series, software registration
// and the connection to the Tax Authority (allocation numbers). Connecting sends the manager to the
// Tax Authority personal area (OAuth); the server keeps the tokens sealed. Nothing here is typed into
// a document afterwards — documents take these values when they are issued.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, Card, Field, ErrorBanner, Banner, Spinner, Pill, KeyValues, DataTable, useLoader, useAction, formatDateTime } from '../../components/kit';
import AdminNav from '../../components/sys/AdminNav';

const ADMIN_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];

function SeriesRow({ row, propertyId, canEdit, onSaved }) {
  const [next, setNext] = useState(String(row.next));
  const act = useAction();
  useEffect(() => setNext(String(row.next)), [row.next]);
  if (!row.editable || !canEdit) return <span className="ui-num">{row.next}</span>;
  return (
    <div className="ui-row" style={{ gap: 6 }}>
      <input className="input" style={{ width: 120 }} dir="ltr" inputMode="numeric" aria-label={`מספר ראשון — ${row.label}`} value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 9))} />
      <button type="button" className="btn btn-secondary btn-sm" disabled={act.busy || !Number(next) || Number(next) === row.next} onClick={async () => { const out = await act.run(() => finance.setSeries(propertyId, row.type, Number(next))); if (out) onSaved(); }}>{act.busy ? <Spinner /> : 'קביעה'}</button>
      {act.error && <span className="ui-error">{act.error}</span>}
    </div>
  );
}

export default function FiscalSettingsPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = ADMIN_ROLES.includes(role);
  const [params, setParams] = useSearchParams();
  const { toasts, success } = useToast();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.fiscal(propertyId) : null), [propertyId]);
  const [f, setF] = useState({ softwareRegNumber: '', operatorId: '', emailFrom: '' });
  const save = useAction();
  const conn = useAction();
  const itaResult = params.get('ita');

  useEffect(() => {
    if (data) setF({ softwareRegNumber: data.ita.softwareRegNumber || '', operatorId: data.ita.operatorId || '', emailFrom: data.emailFrom || '' });
  }, [data]);

  if (loading && !data) return <Page><div className="ui-empty"><Spinner /> טוען…</div></Page>;
  if (error) return <Page><ErrorBanner error={error} onRetry={reload} /></Page>;
  if (!data) return null;
  const ita = data.ita;
  const s = data.seller;
  const sellerMissing = [!s.name && 'שם העסק', !/^\d{9}$/.test(s.taxNumber || '') && 'מספר עוסק / ח.פ.', !s.address && 'כתובת', !s.city && 'עיר'].filter(Boolean);
  const changed = f.softwareRegNumber !== (ita.softwareRegNumber || '') || f.operatorId !== (ita.operatorId || '') || f.emailFrom !== (data.emailFrom || '');
  const e = save.fields;

  const seriesCols = [
    { key: 'label', label: 'סוג מסמך', render: (r) => r.label },
    { key: 'count', label: 'הופקו', nowrap: true, align: 'left', render: (r) => <span className="ui-num">{r.count}</span> },
    { key: 'range', label: 'טווח', nowrap: true, render: (r) => (r.count ? <span className="ui-num">{r.first}–{r.last}</span> : <span className="ui-sub">—</span>) },
    { key: 'next', label: 'המספר הבא', render: (r) => <SeriesRow row={r} propertyId={propertyId} canEdit={canEdit} onSaved={() => { success('המספור נקבע'); reload(); }} /> },
  ];

  return (
    <Page title="מסמכים ורשות המסים" back="/pms">
      <ToastContainer toasts={toasts} />
      <AdminNav />
      {itaResult === 'connected' && <Banner tone="ok">החיבור לרשות המסים הושלם — מספרי הקצאה יתבקשו אוטומטית בהפקת חשבונית. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>סגירה</button></Banner>}
      {itaResult === 'failed' && <Banner tone="warn">החיבור לרשות המסים לא הושלם{params.get('reason') ? `: ${params.get('reason')}` : ''}. אפשר לנסות שוב. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>סגירה</button></Banner>}
      {!canEdit && <Banner tone="info">צפייה בלבד — הגדרות המסמכים מותרות להנהלה ולכספים.</Banner>}

      <Card title="העסק המנפיק" actions={<Pill tone={sellerMissing.length ? 'bad' : 'ok'}>{sellerMissing.length ? 'חסרים פרטים' : 'תקין'}</Pill>}>
        <KeyValues rows={[['שם משפטי', s.name || '—'], ['מספר עוסק / ח.פ.', s.taxNumber || '—'], ['כתובת', [s.address, s.city].filter(Boolean).join(', ') || '—']]} />
        {sellerMissing.length > 0 && <Banner tone="warn">בלי {sellerMissing.join(', ')} אי אפשר להפיק חשבוניות ואי אפשר להפיק קובץ במבנה אחיד. <Link to="/pms/settings" className="ui-link">להגדרות הנכס</Link></Banner>}
      </Card>

      <Card title="חיבור לרשות המסים — מספרי הקצאה" actions={<Pill tone={ita.connected ? 'ok' : 'muted'}>{ita.connected ? `מחובר · ${ita.env === 'production' ? 'ייצור' : 'סביבת בדיקות'}` : 'לא מחובר'}</Pill>}>
        <ErrorBanner error={conn.error} />
        <p className="ui-p">כשמחוברים, כל חשבונית לעוסק מורשה מעל הסף (5,000 ₪ לפני מע״מ מ־1.6.2026) או שהלקוח ביקש עבורה מספר — נשלחת לרשות המסים בעת ההפקה, ומספר ההקצאה נרשם עליה. תקלה זמנית — נשלח שוב אוטומטית כל 10 דקות.</p>
        {!ita.configured && <Banner tone="warn">החיבור טרם הוגדר בשרת: יש לרשום את התוכנה כאפליקציה בפורטל המפתחים של רשות המסים ולהגדיר בשרת ITA_CLIENT_ID, ITA_CLIENT_SECRET ו־ITA_REDIRECT_URI. עד אז מזינים את מספרי ההקצאה ידנית ממערכת ״חשבוניות ישראל״.</Banner>}
        {ita.lastError && <Banner tone="warn">{ita.lastError}{ita.lastErrorAt ? ` · ${formatDateTime(ita.lastErrorAt)}` : ''}</Banner>}
        <KeyValues rows={[
          ['אופן קבלת המספר', ita.mode === 'api' ? 'אוטומטי מול רשות המסים' : 'הזנה ידנית'],
          ita.connected && ['חובר על ידי', `${ita.connectedBy || '—'}${ita.connectedAt ? ` · ${formatDateTime(ita.connectedAt)}` : ''}`],
        ]} />
        {canEdit && (
          <div className="ui-row">
            {!ita.connected && <button type="button" className="btn btn-primary" disabled={!ita.configured || conn.busy || sellerMissing.length > 0} title={sellerMissing.length ? 'יש להשלים את פרטי העסק' : undefined} onClick={async () => { const out = await conn.run(() => finance.itaConnect(propertyId)); if (out?.url) window.location.assign(out.url); }}>{conn.busy ? <Spinner /> : 'התחברות לרשות המסים'}</button>}
            {ita.connected && <button type="button" className="btn btn-secondary" disabled={conn.busy} onClick={async () => { const out = await conn.run(() => finance.itaRetry(propertyId)); if (out) success(out.tried ? `נשלחו ${out.tried} מסמכים ממתינים · אושרו ${out.approved}` : 'אין מסמכים ממתינים לשליחה'); }}>שליחת מסמכים ממתינים עכשיו</button>}
            {ita.connected && <button type="button" className="btn btn-ghost" disabled={conn.busy} onClick={async () => { const out = await conn.run(() => finance.itaDisconnect(propertyId)); if (out) { success('נותק — חזרה להזנה ידנית'); reload(); } }}>ניתוק</button>}
          </div>
        )}
      </Card>

      <Card title="תוכנה ומפעיל">
        <ErrorBanner error={save.error} />
        <div className="ui-grid-2">
          <Field id="fs-reg" label="מספר רישום התוכנה ברשות המסים" optional hint="8 ספרות — מתעודת רישום התוכנה. נכנס לקובץ במבנה אחיד ולבקשות ההקצאה" error={e.softwareRegNumber}>
            <input id="fs-reg" className="input w-full" dir="ltr" inputMode="numeric" disabled={!canEdit} value={f.softwareRegNumber} onChange={(ev) => setF((p) => ({ ...p, softwareRegNumber: ev.target.value.replace(/\D/g, '').slice(0, 8) }))} />
          </Field>
          <Field id="fs-op" label="ת.ז. של מפעיל השירות" optional hint="מי שההרשאה מול רשות המסים רשומה עליו (user_id בבקשה)" error={e.operatorId}>
            <input id="fs-op" className="input w-full" dir="ltr" inputMode="numeric" disabled={!canEdit} value={f.operatorId} onChange={(ev) => setF((p) => ({ ...p, operatorId: ev.target.value.replace(/\D/g, '').slice(0, 9) }))} />
          </Field>
          <Field id="fs-mail" label="כתובת תשובה למסמכים שנשלחים בדוא״ל" optional error={e.emailFrom}>
            <input id="fs-mail" type="email" className="input w-full" dir="ltr" disabled={!canEdit} value={f.emailFrom} onChange={(ev) => setF((p) => ({ ...p, emailFrom: ev.target.value }))} />
          </Field>
        </div>
        {!ita.softwareRegNumber && <Banner tone="info">התוכנה עדיין לא רשומה ברשות המסים. רישום נעשה על ידי יצרן התוכנה (כולל בדיקת קובץ במבנה אחיד בסימולטור של רשות המסים); עד אז השדה נשאר ריק.</Banner>}
        {canEdit && <div className="ui-row"><button type="button" className="btn btn-primary" disabled={!changed || save.busy} onClick={async () => { const out = await save.run(() => finance.setFiscal(propertyId, f)); if (out) { success('נשמר'); reload(); } }}>{save.busy ? <Spinner /> : 'שמירה'}</button></div>}
      </Card>

      <Card title="סדרות מספור" flush>
        <div className="ui-sub" style={{ padding: '10px 14px 0' }}>לכל סוג מסמך סדרה רצה משלו. את המספר הראשון אפשר לקבוע רק לפני המסמך הראשון מאותו סוג — כדי להמשיך את המספור של התוכנה הקודמת. אחרי זה הסדרה רציפה ונעולה.</div>
        <DataTable caption="סדרות מספור" columns={seriesCols} rows={data.series.map((r) => ({ ...r, id: r.type }))} />
      </Card>
    </Page>
  );
}
