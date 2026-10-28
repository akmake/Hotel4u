// FIN-12 — business day close. Readiness first (nothing is charged by looking), explicit decisions
// for what is still open, then one run per day with visible steps. A failed run resumes from the
// step that failed; nights are never posted twice (T33). Days close in order.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance } from '../../utils/api';
import { DAY_STEP_LABELS, RUN_STATUS_LABELS } from '../../lib/labels';
import { formatLong, formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Card, DataTable, Pill, Tag, Empty, Banner, Field, ErrorBanner, Spinner, KeyValues, Modal,
  useLoader, useAction, money, formatDateTime,
} from '../../components/kit';

const NIGHT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'finance_manager'];
const STEP_TONE = { done: 'ok', skipped: 'muted', running: 'warn', failed: 'bad', pending: 'muted' };
const RUN_TONE = { done: 'ok', failed: 'bad', running: 'warn', pending: 'muted' };

function Steps({ run }) {
  return (
    <ol className="ui-timeline">
      {run.steps.map((s) => (
        <li key={s.key}>
          <span className="ui-row" style={{ gap: 6 }}><strong>{DAY_STEP_LABELS[s.key] || s.key}</strong><Pill tone={STEP_TONE[s.status]}>{RUN_STATUS_LABELS[s.status] || s.status}</Pill></span>
          {s.error && <span className="ui-error">{s.error}</span>}
          {s.key === 'post_nights' && s.result?.posted !== undefined && <span className="ui-sub">נרשמו {s.result.posted} לילות</span>}
          {s.key === 'no_shows' && s.result?.marked !== undefined && <span className="ui-sub">סומנו {s.result.marked} כלא הגיעו</span>}
          {s.key === 'ledgers' && s.result?.trial && (
            <span className="ui-sub">
              יתרת סגירה {money(s.result.trial.closing)}
              {(s.result.checks || []).some((c) => c.ok === false) ? ` · ${(s.result.checks || []).filter((c) => c.ok === false).length} בדיקות לטיפול` : ' · הבדיקות תקינות'}
              {' · '}<Link to={`/pms/night-audit/report?date=${run.businessDate}`}>לדוח המלא</Link>
            </span>
          )}
          {s.finishedAt && <span className="ui-sub">{formatDateTime(s.finishedAt)}</span>}
        </li>
      ))}
    </ol>
  );
}

function Snapshot({ s }) {
  if (!s) return null;
  return (
    <KeyValues rows={[
      ['תפוסה', `${s.occupancyPct}% · ${s.roomNights} חדרים מתוך ${s.sellable} זמינים`],
      ['הכנסות לינה', money(s.roomRevenue)],
      ['ADR', money(s.adr)],
      ['הכנסות אחרות', money(s.otherRevenue)],
      ['תשלומים שהתקבלו', money(s.payments)],
      s.refunds ? ['החזרים', money(s.refunds)] : null,
      ['הגיעו / יצאו / לא הגיעו', `${s.arrived} / ${s.departed} / ${s.noShows}`],
    ]} />
  );
}

export default function DayClosePage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canRun = NIGHT_ROLES.includes(role);
  const { toasts, success } = useToast();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.dayClose(propertyId) : null), [propertyId]);
  const [arrivals, setArrivals] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const run = useAction();
  useEffect(() => { setArrivals(''); setReason(''); }, [data?.dateToClose]);

  const rd = data?.readiness;
  const current = data?.current;
  const resuming = current && ['failed', 'running'].includes(current.status);
  const needArrivals = rd && rd.arrivals.length > 0;
  const needReason = rd && (rd.departures.length > 0 || (needArrivals && arrivals === 'keep'));
  let why = null;
  if (!canRun) why = 'למנהל משמרת/לילה או לכספים';
  else if (needArrivals && !arrivals) why = 'יש להחליט על ההגעות הפתוחות';
  else if (needReason && reason.trim().length < 3) why = 'נדרשת סיבה';

  async function go() {
    const out = await run.run(() => finance.runDayClose(propertyId, { date: data.dateToClose, arrivals: needArrivals ? arrivals : undefined, reason: reason.trim() || undefined }));
    setConfirm(false);
    if (out) {
      if (out.status === 'done') success(`היום ${formatShort(out.businessDate)} נסגר`);
      await reload();
    } else {
      reload();
    }
  }

  const history = (data?.runs || []).map((r) => ({ ...r, snap: r.steps.find((s) => s.key === 'snapshot')?.result || null }));
  const columns = [
    { key: 'd', label: 'יום עסקי', nowrap: true, render: (r) => <div><div className="ui-num font-medium">{formatShort(r.businessDate)}</div><div className="ui-sub"><bdi>{r.runNo}</bdi></div></div> },
    { key: 's', label: 'מצב', nowrap: true, render: (r) => <Pill tone={RUN_TONE[r.status]}>{RUN_STATUS_LABELS[r.status]}</Pill> },
    { key: 'occ', label: 'תפוסה', nowrap: true, render: (r) => (r.snap ? `${r.snap.occupancyPct}%` : '—') },
    { key: 'rev', label: 'הכנסות לינה', nowrap: true, align: 'left', render: (r) => (r.snap ? <span className="ui-amount">{money(r.snap.roomRevenue)}</span> : '—') },
    { key: 'adr', label: 'ADR', nowrap: true, align: 'left', render: (r) => (r.snap ? <span className="ui-amount">{money(r.snap.adr)}</span> : '—') },
    { key: 'by', label: 'הריץ', nowrap: true, render: (r) => <div><div>{r.startedBy || '—'}</div><div className="ui-sub">{r.attempts > 1 ? `${r.attempts} ניסיונות · ` : ''}{formatDateTime(r.finishedAt || r.createdAt)}</div></div> },
    { key: 'rep', label: 'דוחות', srOnly: true, nowrap: true, render: (r) => (r.status === 'done' ? <Link className="btn btn-ghost btn-sm" to={`/pms/night-audit/report?date=${r.businessDate}`}>דוחות</Link> : null) },
  ];

  return (
    <Page title="סגירת יום" back="/pms">
      <ToastContainer toasts={toasts} />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && !data.dateToClose && (
        <Banner tone="ok"><CheckCircle2 size={14} aria-hidden="true" /> היום העסקי {formatLong(data.lastClosedDate)} נסגר. היום הבא ייפתח לסגירה מחר.</Banner>
      )}
      {data && data.dateToClose && (
        <>
          <div className="ui-toolbar">
            <div>
              <div className="ui-h3">סגירת יום · {formatLong(data.dateToClose)}</div>
              <div className="ui-sub">{data.lastClosedDate ? `היום האחרון שנסגר: ${formatShort(data.lastClosedDate)}` : 'עדיין לא נסגר אף יום בנכס'}{data.dateToClose < data.today && ' · יש לסגור ימים לפי הסדר'}</div>
            </div>
          </div>
          {resuming && (
            <Banner tone="warn">
              <AlertTriangle size={14} aria-hidden="true" /> ריצה {current.runNo} {current.status === 'failed' ? 'נכשלה' : 'פעילה'}. הרצה נוספת תמשיך מהשלב שלא הושלם — לילות שכבר נרשמו לא יירשמו שוב.
            </Banner>
          )}
          <div className="ui-split">
            <Card title="מוכנות לסגירה">
              <ul className="ui-staff">
                <li>
                  <div><div className="font-medium">הגעות שלא נכנסו</div><div className="ui-sub">{rd.arrivals.length ? rd.arrivals.slice(0, 4).map((a) => a.guest).join(', ') + (rd.arrivals.length > 4 ? '…' : '') : 'אין'}</div></div>
                  {rd.arrivals.length ? <Link className="btn btn-secondary btn-sm" to={`/pms/arrivals?date=${data.dateToClose}`}>{rd.arrivals.length} לטיפול</Link> : <Pill tone="ok">תקין</Pill>}
                </li>
                <li>
                  <div><div className="font-medium">עזיבות שלא נסגרו</div><div className="ui-sub">{rd.departures.length ? rd.departures.slice(0, 4).map((d) => `${d.guest}${d.room ? ` (${d.room})` : ''}`).join(', ') : 'אין'}</div></div>
                  {rd.departures.length ? <Link className="btn btn-secondary btn-sm" to={`/pms/departures?date=${data.dateToClose}`}>{rd.departures.length} לטיפול</Link> : <Pill tone="ok">תקין</Pill>}
                </li>
                <li>
                  <div><div className="font-medium">תור המתנה לחדר</div><div className="ui-sub">אורחים שמחכים בקבלה</div></div>
                  {rd.queueOpen ? <Link className="btn btn-secondary btn-sm" to="/pms/arrival-queue">{rd.queueOpen} בתור</Link> : <Pill tone="ok">ריק</Pill>}
                </li>
                <li>
                  <div><div className="font-medium">יתרות אחרי יציאה</div><div className="ui-sub">יצאו עם חוב בלי הסדר מאושר (30 ימים)</div></div>
                  {rd.unsettledDepartures ? <Link className="btn btn-secondary btn-sm" to="/pms/folio?view=balance">{rd.unsettledDepartures}</Link> : <Pill tone="ok">אין</Pill>}
                </li>
                <li>
                  <div><div className="font-medium">חיובי לינה שיירשמו</div><div className="ui-sub">{rd.nights.inHouse} שהיות בבית · כל לילה נרשם פעם אחת</div></div>
                  <span className="ui-num font-medium">{rd.nights.count} · {money(rd.nights.amount)}</span>
                </li>
              </ul>
            </Card>
            <Card title={resuming ? 'המשך ריצה' : 'הרצת סגירה'}>
              <ErrorBanner error={run.error} />
              {needArrivals && (
                <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
                  <legend className="ui-label">{rd.arrivals.length} הגעות פתוחות · חובה להחליט</legend>
                  <label className="ui-radio"><input type="radio" name="arr" checked={arrivals === 'no_show'} onChange={() => setArrivals('no_show')} /><span>סימון כ"לא הגיע"<span className="ui-sub" style={{ display: 'block' }}>המלאי משתחרר; דמי אי־הגעה לפי מדיניות — בנפרד</span></span></label>
                  <label className="ui-radio"><input type="radio" name="arr" checked={arrivals === 'keep'} onChange={() => setArrivals('keep')} /><span>להשאיר פתוחות<span className="ui-sub" style={{ display: 'block' }}>אורח שמגיע אחרי חצות — נדרשת סיבה</span></span></label>
                </fieldset>
              )}
              {needReason && (
                <Field id="dc-reason" label="סיבה" required error={run.fields.reason} hint={rd.departures.length ? `${rd.departures.length} עזיבות עדיין בבית — הן יופיעו כ"עבר מועד" בשוהים` : undefined}>
                  <input id="dc-reason" className="input w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              )}
              {!needArrivals && !needReason && <p className="ui-p">אין פריטים פתוחים שמחייבים החלטה.</p>}
              <div className="ui-step-foot">
                {why && <span className="ui-foot-note">{why}</span>}
                <button type="button" className="btn btn-primary" disabled={!!why || run.busy} onClick={() => setConfirm(true)}>
                  {resuming ? 'המשך מהשלב שנכשל' : `סגירת ${formatShort(data.dateToClose)}`}
                </button>
              </div>
              {current && (
                <div>
                  <div className="ui-section-title">{current.runNo} · ניסיון {current.attempts}</div>
                  <Steps run={current} />
                </div>
              )}
            </Card>
          </div>
        </>
      )}
      {history.length > 0 && history[0].status === 'done' && history[0].snap && (
        <Card title={`דוח יום ${formatShort(history[0].businessDate)}`} actions={<Link className="btn btn-secondary btn-sm" to={`/pms/night-audit/report?date=${history[0].businessDate}`}>מאזן בוחן וספרים</Link>}><Snapshot s={history[0].snap} /></Card>
      )}
      <Card title="היסטוריית סגירות" flush>
        <DataTable caption="סגירות יום" columns={columns} rows={data ? history : undefined} loading={loading && !data} empty={<Empty title="עדיין לא נסגר אף יום" />} />
      </Card>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        busy={run.busy}
        width={460}
        title={resuming ? 'המשך סגירת יום' : 'אישור סגירת יום'}
        subtitle={data?.dateToClose ? formatLong(data.dateToClose) : ''}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)} disabled={run.busy}>ביטול</button>
            <button type="button" className="btn btn-primary" onClick={go} disabled={run.busy}>{run.busy ? <><Spinner /> מריץ…</> : 'הרצה'}</button>
          </>
        )}
      >
        {rd && (
          <KeyValues rows={[
            ['חיובי לינה', `${rd.nights.count} · ${money(rd.nights.amount)}`],
            needArrivals && ['הגעות פתוחות', `${rd.arrivals.length} · ${arrivals === 'no_show' ? 'יסומנו "לא הגיע"' : 'יישארו פתוחות'}`],
            rd.departures.length > 0 && ['עזיבות שלא נסגרו', String(rd.departures.length)],
          ]} />
        )}
        <p className="ui-p">אחרי הסגירה תיקון נעשה ברשומה מתקנת (חיוב/היפוך/זיכוי) — לא בשינוי שקט.</p>
        {run.error && <Tag tone="bad">{run.error}</Tag>}
      </Modal>
      {data?.auto && <AutoCloseCard auto={data.auto} canEdit={canRun} propertyId={propertyId} onSaved={() => { success('הגדרות הסגירה האוטומטית נשמרו'); reload(); }} />}
    </Page>
  );
}

// Automatic close: closes the previous business day at a set hour; open departures stop it and open a work item.
function AutoCloseCard({ auto, canEdit, propertyId, onSaved }) {
  const save = useAction();
  const [f, setF] = useState(auto);
  useEffect(() => setF(auto), [auto]);
  const changed = JSON.stringify({ e: f.enabled, t: f.time, a: f.arrivals }) !== JSON.stringify({ e: auto.enabled, t: auto.time, a: auto.arrivals });
  return (
    <Card title="סגירה אוטומטית" actions={canEdit && <button type="button" className="btn btn-primary btn-sm" disabled={!changed || save.busy} onClick={() => save.run(async () => { await finance.setAutoDayClose(propertyId, { enabled: f.enabled, time: f.time, arrivals: f.arrivals }); onSaved(); })}>{save.busy ? <Spinner /> : 'שמירה'}</button>}>
      <div className="ui-stack">
        <ErrorBanner error={save.error} />
        <label className="ui-check"><input type="checkbox" checked={!!f.enabled} disabled={!canEdit} onChange={(e) => setF((p) => ({ ...p, enabled: e.target.checked }))} /><span>לסגור את היום הקודם אוטומטית</span></label>
        <div className="ui-grid-2">
          <Field id="ac-time" label="בשעה" error={save.fields.time}><input id="ac-time" type="time" className="input w-full" disabled={!canEdit || !f.enabled} value={f.time} onChange={(e) => setF((p) => ({ ...p, time: e.target.value }))} /></Field>
          <Field id="ac-arr" label="הגעות שלא נכנסו">
            <select id="ac-arr" className="input w-full" disabled={!canEdit || !f.enabled} value={f.arrivals} onChange={(e) => setF((p) => ({ ...p, arrivals: e.target.value }))}>
              <option value="keep">להשאיר פתוחות (יירשם בסגירה)</option>
              <option value="no_show">לסמן "לא הגיע"</option>
            </select>
          </Field>
        </div>
        <p className="ui-sub">עזיבות שלא נסגרו עוצרות את הסגירה האוטומטית — נפתחת משימה דחופה במרכז המשימות, וסוגרים ידנית.{auto.by ? ` · עודכן על ידי ${auto.by}` : ''}</p>
      </div>
    </Card>
  );
}
