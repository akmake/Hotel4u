// Report subscriptions — copied from Cloudbeds "Reporting → Subscriptions": a table of subscriptions
// (ID with its subject, reports, recipients, frequency, format, next send, a row menu) and an
// "Add subscription" modal (reports picked by search and listed as removable cards, frequency, days
// for weekly, hotel time, format, e-mail subject, recipients). Each run e-mails one Excel file with a
// sheet per report (CSV: one file per report). Server: services/reportSubscriptionService.js.
import { useMemo, useState } from 'react';
import { X, FileSpreadsheet, Search } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import { reportSubscriptions as api } from '../utils/api';
import { Page, Card, Modal, ConfirmDialog, RowMenu, Spinner, ErrorBanner, Empty, Tag, useLoader, useAction } from '../components/kit';
import { Link } from 'react-router-dom';
import './ReportSubscriptionsPage.css';
import './reports/reports.css';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const BLANK = { reports: [], frequency: '', days: [], time: '07:00', format: 'xlsx', subject: '', recipients: [], active: true };

function when(d, tz) {
  if (!d) return '—';
  return new Date(d).toLocaleString('he-IL', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ReportSubscriptionsPage() {
  const { propertyId } = useProperty();
  const { toasts, success, error: toastError } = useToast();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? api.list(propertyId) : null), [propertyId]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | row
  const [deleting, setDeleting] = useState(null);
  const [sending, setSending] = useState(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.rows || []).filter((r) => !term || String(r.number).includes(term) || r.subject.toLowerCase().includes(term));
  }, [data, q]);

  async function sendNow(row) {
    setSending(row.id);
    try {
      const out = await api.send(propertyId, row.id);
      if (out.lastStatus === 'sent') success(`מנוי ${row.number} נשלח עכשיו`);
      else toastError(`לא נשלח: ${out.lastError}`);
      reload();
    } catch (e) { toastError(e.message); } finally { setSending(null); }
  }
  async function toggle(row) {
    try {
      await api.update(propertyId, row.id, { ...row, reports: row.reports.map((r) => r.code), active: !row.active });
      success(row.active ? `מנוי ${row.number} הושהה` : `מנוי ${row.number} הופעל`);
      reload();
    } catch (e) { toastError(e.message); }
  }

  return (
    <Page wide title="דוחות" back="/pms/reports">
      <ToastContainer toasts={toasts} />
      <nav className="rp-tabs" aria-label="אזורי דוחות">
        <Link className="rp-tab" to="/pms/reports">כל הדוחות</Link>
        <span className="rp-tab is-on" aria-current="page">מנויים</span>
      </nav>
      <Card title="מנויים" actions={<button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')} disabled={!data}>הוספת מנוי</button>}>
        <div className="rs-tools">
          <label className="rs-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">חיפוש לפי מזהה</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי מזהה או נושא" />
          </label>
          <span className="ui-sub">הדוחות נשלחים כקובץ מצורף לדוא״ל · שעות לפי שעון המלון{data?.timezone ? ` (${data.timezone})` : ''}</span>
        </div>
        <ErrorBanner error={error} onRetry={reload} />
        {loading && !data ? <div className="ui-empty"><Spinner /> טוען…</div> : (
          <div className="ui-table-wrap">
            <table className="ui-table rs-table">
              <thead>
                <tr>
                  <th scope="col">מזהה מנוי</th>
                  <th scope="col">דוחות</th>
                  <th scope="col">נמענים</th>
                  <th scope="col">תדירות</th>
                  <th scope="col">פורמט</th>
                  <th scope="col">שליחה הבאה</th>
                  <th scope="col"><span className="sr-only">פעולות</span></th>
                </tr>
              </thead>
              <tbody>
                {!rows.length && (
                  <tr><td colSpan={7}><Empty title={q ? 'לא נמצא מנוי' : 'אין עדיין מנויים'}>{q ? null : 'מנוי שולח דוחות בדוא״ל באופן קבוע — למשל דוח מנהל והגעות היום כל בוקר ב־07:00.'}</Empty></td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className={r.active ? '' : 'is-off'}>
                    <td>
                      <button type="button" className="ui-link font-medium" onClick={() => setEditing(r)}>{r.number}</button>
                      <div className="ui-sub">{r.subject}</div>
                    </td>
                    <td><ul className="rs-list">{r.reports.map((x) => <li key={x.code}><FileSpreadsheet size={13} aria-hidden="true" /> {x.name}</li>)}</ul></td>
                    <td><ul className="rs-list">{r.recipients.map((x) => <li key={x} dir="ltr">{x}</li>)}</ul></td>
                    <td>{r.frequencyLabel}<div className="ui-sub">בשעה {r.time}</div></td>
                    <td>{r.format}</td>
                    <td>
                      {r.active ? when(r.nextRunAt, data.timezone) : <Tag>מושהה</Tag>}
                      {r.lastStatus && (
                        <div className="ui-sub">
                          {r.lastStatus === 'sent' ? `נשלח לאחרונה ${when(r.lastRunAt, data.timezone)}` : <span className="rs-failed" title={r.lastError || ''}>השליחה האחרונה נכשלה: {r.lastError}</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      {sending === r.id ? <Spinner /> : (
                        <RowMenu label={`פעולות — מנוי ${r.number}`} items={[
                          { label: 'עריכה', onSelect: () => setEditing(r) },
                          { label: 'שליחה עכשיו', onSelect: () => sendNow(r) },
                          { label: r.active ? 'השהיה' : 'הפעלה', onSelect: () => toggle(r) },
                          { separator: true },
                          { label: 'מחיקה', danger: true, onSelect: () => setDeleting(r) },
                        ]} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <SubscriptionDialog
          key={editing === 'new' ? 'new' : editing.id}
          propertyId={propertyId}
          catalog={data?.catalog || []}
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(out, isNew) => { setEditing(null); success(isNew ? `מנוי ${out.number} נוצר` : `מנוי ${out.number} עודכן`); reload(); }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={deleting ? `מחיקת מנוי ${deleting.number}` : ''}
        confirmLabel="מחיקה"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await api.remove(propertyId, deleting.id);
          success(`מנוי ${deleting.number} נמחק`);
          setDeleting(null);
          reload();
        }}
      >
        {deleting && <p className="ui-p">"{deleting.subject}" יפסיק להישלח ל־{deleting.recipients.length} נמענים. אי אפשר לבטל.</p>}
      </ConfirmDialog>
    </Page>
  );
}

function SubscriptionDialog({ propertyId, catalog, row, onClose, onSaved }) {
  const [f, setF] = useState(() => (row ? { ...row, reports: row.reports.map((r) => r.code) } : BLANK));
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [email, setEmail] = useState('');
  const save = useAction();
  const e = save.fields || {};
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const byCode = Object.fromEntries(catalog.map((c) => [c.code, c]));
  const matches = catalog.filter((c) => !f.reports.includes(c.code) && (!search.trim() || c.name.includes(search.trim()) || c.group.includes(search.trim())));
  const addEmail = () => {
    const v = email.trim().toLowerCase();
    if (!v) return;
    if (!f.recipients.includes(v)) set('recipients', [...f.recipients, v]);
    setEmail('');
  };
  const submit = () => save.run(async () => {
    const body = { ...f, recipients: email.trim() ? [...new Set([...f.recipients, email.trim().toLowerCase()])] : f.recipients };
    const out = row ? await api.update(propertyId, row.id, body) : await api.create(propertyId, body);
    onSaved(out, !row);
  });

  return (
    <Modal
      open
      onClose={onClose}
      busy={save.busy}
      width={520}
      title={row ? `עריכת מנוי ${row.number}` : 'הוספת מנוי'}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={save.busy}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={save.busy}>{save.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button>
        </>
      )}
    >
      <div className="rs-form">
        <ErrorBanner error={save.error} />
        {f.format === 'xlsx' && f.reports.length > 1 && <div className="rs-note">קובץ Excel אחד עם כל הדוחות, גיליון לכל דוח.</div>}

        <div className="rs-section-head">
          <span className="rs-label">דוחות<span className="rs-req">*</span></span>
          {f.reports.length > 0 && <button type="button" className="ui-link" onClick={() => set('reports', [])}>הסרת הכול</button>}
        </div>
        <div className="rs-picker" onBlur={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget)) setPicking(false); }}>
          <input className={`input w-full ${e.reports ? 'is-invalid' : ''}`} value={search} onFocus={() => setPicking(true)} onChange={(ev) => { setSearch(ev.target.value); setPicking(true); }} placeholder="חיפוש דוח להוספה" aria-label="חיפוש דוח להוספה" />
          {picking && matches.length > 0 && (
            <ul className="rs-options" role="listbox" aria-label="דוחות להוספה">
              {matches.map((c) => (
                <li key={c.code}><button type="button" role="option" aria-selected="false" onClick={() => { set('reports', [...f.reports, c.code]); setSearch(''); }}>{c.name}<span className="ui-sub"> · {c.group}</span></button></li>
              ))}
            </ul>
          )}
        </div>
        {f.reports.map((code) => (
          <div key={code} className="rs-chosen">
            <div><div className="font-medium">{byCode[code]?.name || code}</div><div className="ui-sub"><FileSpreadsheet size={12} aria-hidden="true" /> {byCode[code]?.group}</div></div>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`הסרת ${byCode[code]?.name || code}`} onClick={() => set('reports', f.reports.filter((x) => x !== code))}><X size={14} /></button>
          </div>
        ))}
        {e.reports && <div className="ui-error">{e.reports}</div>}

        <label className="rs-label" htmlFor="rs-freq">תדירות<span className="rs-req">*</span></label>
        <select id="rs-freq" className={`input w-full ${e.frequency ? 'is-invalid' : ''}`} value={f.frequency} onChange={(ev) => set('frequency', ev.target.value)}>
          <option value="">בחירת תדירות</option>
          <option value="daily">יומי</option>
          <option value="weekly">שבועי</option>
          <option value="monthly">ביום הראשון בחודש</option>
        </select>
        {e.frequency && <div className="ui-error">{e.frequency}</div>}

        {f.frequency === 'weekly' && (
          <>
            <span className="rs-label">ימים<span className="rs-req">*</span></span>
            <div className="rs-days">
              {DAYS.map((d, i) => (
                <label key={d} className="ui-check"><input type="checkbox" checked={f.days.includes(i)} onChange={() => set('days', f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i])} /><span>{d}</span></label>
              ))}
            </div>
            {e.days && <div className="ui-error">{e.days}</div>}
          </>
        )}

        <label className="rs-label" htmlFor="rs-time">שעה (שעון המלון)</label>
        <select id="rs-time" className="input w-full" value={f.time} onChange={(ev) => set('time', ev.target.value)}>
          {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="ui-sub">דוחות כספים וביצועים מכסים את התקופה שהסתיימה: אתמול (יומי), 7 הימים עד אתמול (שבועי) או החודש הקודם (חודשי). הגעות, עזיבות ואורחים במלון — של יום השליחה.</div>

        <label className="rs-label" htmlFor="rs-format">פורמט</label>
        <select id="rs-format" className="input w-full" value={f.format} onChange={(ev) => set('format', ev.target.value)}>
          <option value="xlsx">xlsx</option>
          <option value="csv">csv</option>
        </select>

        <label className="rs-label" htmlFor="rs-subject">שורת נושא<span className="rs-req">*</span></label>
        <input id="rs-subject" className={`input w-full ${e.subject ? 'is-invalid' : ''}`} maxLength={150} value={f.subject} onChange={(ev) => set('subject', ev.target.value)} placeholder="למשל: דוח בוקר — מלון הגליל" />
        {e.subject && <div className="ui-error">{e.subject}</div>}

        <label className="rs-label" htmlFor="rs-email">נמענים<span className="rs-req">*</span></label>
        <div className="rs-add">
          <input id="rs-email" className={`input w-full ${e.recipients ? 'is-invalid' : ''}`} dir="ltr" type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addEmail(); } }} placeholder="כתובת דוא״ל ואז 'הוספה'" />
          <button type="button" className="btn btn-secondary" onClick={addEmail} disabled={!email.trim()}>הוספה</button>
        </div>
        {f.recipients.length > 0 && (
          <div className="rs-chips">
            {f.recipients.map((r) => <span key={r} className="ui-chip" dir="ltr">{r}<button type="button" aria-label={`הסרת ${r}`} onClick={() => set('recipients', f.recipients.filter((x) => x !== r))}><X size={11} /></button></span>)}
          </div>
        )}
        {e.recipients && <div className="ui-error">{e.recipients}</div>}
      </div>
    </Modal>
  );
}
