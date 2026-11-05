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
const CONNECT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'finance_manager'];
const GATE_DONE = ['APPROVED', 'NOT_APPLICABLE'];
const DOC_COUNT_LABELS = { tax_invoice: 'חשבוניות מס', tax_invoice_receipt: 'חשבוניות מס/קבלה', receipt: 'קבלות', credit_note: 'זיכויים', refund_receipt: 'קבלות החזר', proforma: 'חשבונות עסקה' };

// Every fiscal document is issued by the standalone invoicing system. Here the property is connected
// to it once (a workspace there, keyed by this property), and its readiness for real documents is shown.
function InvoicerCards({ propertyId, canConnect, onToast }) {
  const { data: st, loading, error, reload } = useLoader(async () => (propertyId ? finance.invoicerStatus(propertyId) : null), [propertyId]);
  const { data: ov } = useLoader(async () => (propertyId && st?.connected ? finance.invoicerOverview(propertyId) : null), [propertyId, st?.connected]);
  const [f, setF] = useState(null);
  const conn = useAction();
  const sync = useAction();
  useEffect(() => { if (st && !f) setF({ ...st.defaults }); }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !st) return <Card title="מערכת החשבוניות"><div className="ui-empty"><Spinner /> בודק חיבור…</div></Card>;
  if (error) return <Card title="מערכת החשבוניות"><ErrorBanner error={error} onRetry={reload} /></Card>;
  if (!st) return null;
  const w = st.workspace;
  const live = w?.environment === 'live';
  const tone = !st.configured ? 'bad' : !st.reachable ? 'bad' : st.connected ? (live ? 'ok' : 'warn') : 'muted';
  const state = !st.configured ? 'השרת לא מחובר' : !st.reachable ? 'לא זמינה' : st.connected ? (live ? 'מחובר · הפקה חיה' : 'מחובר · סביבת בדיקות') : 'הנכס לא חובר';
  const url = st.host ? `https://${st.host}` : null;
  const docs = Object.entries(st.documents || {}).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${DOC_COUNT_LABELS[t] || t}`).join(' · ');
  const missing = f ? [!String(f.legalName || '').trim() && 'שם משפטי', !/^\d{9}$/.test(String(f.taxId || '').replace(/\D/g, '')) && 'מספר עוסק / ח.פ. (9 ספרות)', !String(f.address || '').trim() && 'כתובת', !String(f.city || '').trim() && 'עיר'].filter(Boolean) : [];
  const gates = ov?.gates || [];
  const open = gates.filter((g) => !GATE_DONE.includes(g.status));
  const set = (k) => (ev) => setF((p) => ({ ...p, [k]: ev.target.value }));

  return (
    <>
      <Card title="מערכת החשבוניות" actions={<Pill tone={tone}>{state}</Pill>}>
        <p className="ui-p">כל חשבונית, קבלה, זיכוי וקבלת החזר מופקים במערכת החשבוניות שלנו וממוספרים בה. Hotel4u בונה את המסמך מהחשבון של האורח, שולח אותו בחיבור שרת־לשרת ושומר העתק עם המספר שחזר.</p>
        {!st.configured && <Banner tone="warn">השרת עדיין לא מחובר למערכת החשבוניות. יוצרים מפתח במערכת החשבוניות (״חיבורים ו־API״, מערכת מקור hotel4u) ומגדירים בשרת INVOICER_API_URL ו־INVOICER_API_KEY. המפתח נשמר בשרת בלבד.</Banner>}
        {st.configured && !st.reachable && <Banner tone="bad">אין תשובה ממערכת החשבוניות{st.error ? `: ${st.error}` : ''}. אי אפשר להפיק מסמכים עד שהחיבור יחזור.</Banner>}
        {st.connected && (
          <>
            <KeyValues rows={[
              ['סביבת עבודה', w.name],
              ['העסק המנפיק', [w.legalName, w.taxNumber && `ח.פ. ${w.taxNumber}`].filter(Boolean).join(' · ') || '—'],
              ['כתובת העסק', [w.address, w.city].filter(Boolean).join(', ') || '—'],
              ['סוג המסמכים', live ? 'מסמכים אמיתיים במספור מאושר' : 'מסמכי בדיקה, בלי תוקף חשבונאי'],
              ['מסמכים שהופקו מכאן', docs || 'עדיין לא הופקו'],
              ['חובר', w.connectedAt ? formatDateTime(w.connectedAt) : '—'],
            ]} />
            {!live && <Banner tone="warn">מסמכים שהופקו עכשיו הם מסמכי בדיקה. מעבר להפקה חיה נעשה במערכת החשבוניות על ידי בעל העסק, אחרי שכל שלבי המוכנות למטה הושלמו.</Banner>}
            <ErrorBanner error={sync.error} />
            <div className="ui-row">
              {canConnect && <button type="button" className="btn btn-secondary" disabled={sync.busy} onClick={async () => { const out = await sync.run(() => finance.invoicerSync(propertyId)); if (out) { onToast(out.added || out.updated ? `עודכנו ${out.added || 0} זיכויים/החזרים ו־${out.updated || 0} מספרי הקצאה` : 'הכול מעודכן — אין שינויים במערכת החשבוניות'); reload(); } }}>{sync.busy ? <Spinner /> : 'סנכרון עכשיו'}</button>}
              {url && <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">פתיחת מערכת החשבוניות</a>}
            </div>
            <div className="ui-sub">זיכויים וקבלות החזר שהופקו ישירות במערכת החשבוניות נמשכים לכאן אוטומטית כל 5 דקות, ובכל פתיחה של חלון ״הפקת מסמך״.</div>
          </>
        )}
        {st.configured && st.reachable && !st.connected && f && (
          <>
            <ErrorBanner error={conn.error} />
            <p className="ui-p">חיבור נעשה פעם אחת לכל נכס: נפתחת לו סביבת עבודה במערכת החשבוניות עם פרטי העסק המנפיק. הפרטים נלקחים מהגדרות הנכס, ואפשר לתקן אותם כאן.</p>
            <div className="ui-grid-2">
              <Field id="iv-name" label="שם משפטי של העסק" required><input id="iv-name" className="input w-full" disabled={!canConnect} value={f.legalName} onChange={set('legalName')} /></Field>
              <Field id="iv-tax" label="מספר עוסק / ח.פ." required hint="9 ספרות"><input id="iv-tax" className="input w-full" dir="ltr" inputMode="numeric" disabled={!canConnect} value={f.taxId} onChange={(ev) => setF((p) => ({ ...p, taxId: ev.target.value.replace(/\D/g, '').slice(0, 9) }))} /></Field>
              <Field id="iv-addr" label="כתובת" required><input id="iv-addr" className="input w-full" disabled={!canConnect} value={f.address} onChange={set('address')} /></Field>
              <Field id="iv-city" label="עיר" required><input id="iv-city" className="input w-full" disabled={!canConnect} value={f.city} onChange={set('city')} /></Field>
            </div>
            {canConnect ? (
              <div className="ui-row">
                <button type="button" className="btn btn-primary" disabled={conn.busy || missing.length > 0} title={missing.length ? `חסר: ${missing.join(', ')}` : undefined} onClick={async () => { const out = await conn.run(() => finance.invoicerConnect(propertyId, f)); if (out) { onToast('הנכס חובר למערכת החשבוניות'); reload(); } }}>{conn.busy ? <Spinner /> : 'חיבור הנכס'}</button>
                {missing.length > 0 && <span className="ui-sub">חסר: {missing.join(', ')}</span>}
              </div>
            ) : <Banner tone="info">חיבור הנכס מותר למנהל הנכס או לכספים.</Banner>}
          </>
        )}
      </Card>

      {st.connected && (
        <Card title="מוכנות להפקה חיה" actions={ov ? <Pill tone={open.length ? 'warn' : 'ok'}>{open.length ? `${gates.length - open.length} מתוך ${gates.length} הושלמו` : 'הכול הושלם'}</Pill> : null}>
          {!ov && <div className="ui-empty"><Spinner /> טוען…</div>}
          {ov && (
            <>
              <p className="ui-p">לפני שמפיקים מסמכים אמיתיים צריך להשלים במערכת החשבוניות את השלבים האלה. חלק מהם החלטות של רואה החשבון, וחלק תלויים ברישום התוכנה ברשות המסים. המעבר עצמו נעשה שם, על ידי בעל העסק.</p>
              <ul className="ui-list">
                {gates.map((g) => (
                  <li key={g._id || g.id} className="ui-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div className="min-w-0">
                      <div className="font-medium">{g.label}</div>
                      <div className="ui-sub">{g.need}{g.owner ? ` · באחריות ${g.owner}` : ''}</div>
                    </div>
                    <Pill tone={GATE_DONE.includes(g.status) ? 'ok' : g.status === 'EXPIRED' ? 'bad' : 'muted'}>{GATE_DONE.includes(g.status) ? (g.status === 'NOT_APPLICABLE' ? 'לא רלוונטי' : 'הושלם') : g.status === 'EXPIRED' ? 'פג תוקף' : 'פתוח'}</Pill>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </>
  );
}

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

      <InvoicerCards propertyId={propertyId} canConnect={CONNECT_ROLES.includes(role)} onToast={success} />

      {data.issuer !== 'invoicer' && <>
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
      </>}
    </Page>
  );
}
