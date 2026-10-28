import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { accounting } from '../../utils/api';
import { Page, Card, Field, Banner, ErrorBanner, Spinner, Pill, Segmented, DataTable, Empty, ConfirmDialog, Modal, useLoader, useAction } from '../../components/kit';

const WRITE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const READ = [...WRITE, 'auditor', 'owner_readonly'];
const STATUSES = { APPROVED: 'אושר', NOT_APPLICABLE: 'אינו חל', UNRESOLVED: 'ממתין להכרעה', EXPIRED: 'פג תוקף' };
const CLASSES = { asset: 'נכס', liability: 'התחייבות', equity: 'הון', income: 'הכנסה', expense: 'הוצאה' };
const TYPES = { tax_invoice: 'חשבונית מס', tax_invoice_receipt: 'חשבונית מס / קבלה', receipt: 'קבלה', credit_note: 'הודעת זיכוי', debit_note: 'מסמך חיוב', proforma: 'חשבון עסקה' };
const OWNERS = { Finance: 'כספים', Legal: 'ייעוץ משפטי', Security: 'אבטחת מידע', Engineering: 'הנדסה', Product: 'מוצר' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const newKey = () => `manual:${crypto.randomUUID()}`;
const blankLine = () => ({ accountCode: '', debit: '', credit: '' });
const field = (id, label, value, onChange, props = {}) => <Field id={id} label={label} required><input id={id} name={id} className="input w-full" value={value} onInput={(e) => onChange(e.target.value)} onChange={(e) => onChange(e.target.value)} {...props} /></Field>;

function ComplianceDialog({ gate, propertyId, onClose, onSaved }) {
  const act = useAction();
  const [form, setForm] = useState(() => Object.fromEntries(['status', 'professionalName', 'legalSource', 'sourceVersion', 'evidenceReference', 'rationale', 'validFrom', 'reviewDue'].map((key) => [key, gate[key] || (key === 'status' ? 'UNRESOLVED' : '')])));
  const accepted = ['APPROVED', 'NOT_APPLICABLE'].includes(form.status);
  return <Modal open onClose={onClose} busy={act.busy} title={`תיעוד החלטה: ${gate.label}`} width={640}>
    <ErrorBanner error={act.error} /><p className="ui-p">יש לתעד החלטה קיימת של בעל סמכות ולצרף את האסמכתה. שמירת הטופס מתעדת את ההחלטה.</p>
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); act.run(async () => { await accounting.recordCompliance(propertyId, { ...form, requirementId: gate.requirementId || gate.id }); onSaved(); }); }}>
      <Field id="decision-status" label="מצב החלטה"><select id="decision-status" className="input w-full" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>{Object.entries(STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      {[['professionalName', 'בעל הסמכות המקצועית'], ['legalSource', 'מקור מחייב'], ['sourceVersion', 'גרסת המקור'], ['evidenceReference', 'אסמכתה לאישור'], ['validFrom', 'תחילת תוקף'], ['reviewDue', 'מועד בדיקה מחדש']].map(([key, label]) => <Field key={key} id={`decision-${key}`} label={label} required={accepted}><input id={`decision-${key}`} className="input w-full" value={form[key]} type={['validFrom', 'reviewDue'].includes(key) ? 'date' : 'text'} required={accepted} maxLength={300} onInput={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} /></Field>)}
      <Field id="decision-rationale" label="נימוק והיקף ההחלטה" required={accepted}><textarea id="decision-rationale" className="input w-full" value={form.rationale} required={accepted} maxLength={1000} onChange={(e) => setForm((f) => ({ ...f, rationale: e.target.value }))} /></Field>
      <div className="ui-row"><button type="button" className="btn btn-secondary" disabled={act.busy} onClick={onClose}>ביטול</button><button className="btn btn-primary" disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירת החלטה ואסמכתה'}</button></div>
    </form>
  </Modal>;
}

function AccountingWorkspace({ propertyId, canWrite, canRecord }) {
  const loader = useLoader(() => accounting.overview(propertyId), [propertyId]);
  const action = useAction();
  const [tab, setTab] = useState('books');
  const [message, setMessage] = useState('');
  const [setup, setSetup] = useState({ legalName: '', taxId: '', address: '', city: '' });
  const [month, setMonth] = useState(today().slice(0, 7));
  const [closing, setClosing] = useState(null);
  const [journal, setJournal] = useState({ accountingDate: today(), description: '', sourceEventId: newKey(), lines: [blankLine(), blankLine()] });
  const [series, setSeries] = useState({ documentType: 'tax_invoice', code: '', prefix: '', firstNumber: '1', approvalReference: '' });
  const [report, setReport] = useState(null);
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today());
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [decision, setDecision] = useState(null);
  const [reversing, setReversing] = useState(null);
  const [reverseDate, setReverseDate] = useState(today());
  useEffect(() => { if (loader.data?.defaults && !loader.data.entity) setSetup(loader.data.defaults); }, [loader.data]);
  const data = loader.data;
  const change = (setter, name) => (value) => setter((f) => ({ ...f, [name]: value }));
  async function run(fn, success, after) {
    const result = await action.run(fn);
    if (result !== undefined) { setMessage(success); after?.(); setReport(null); await loader.reload(); }
    return result;
  }
  if (loader.loading && !data) return <Page><div className="ui-empty"><Spinner /> טוען הנהלת חשבונות…</div></Page>;
  if (loader.error) return <Page><ErrorBanner error={loader.error} onRetry={loader.reload} /></Page>;
  if (!data) return null;
  const entryColumns = [
    { key: 'date', label: 'תאריך חשבונאי', render: (r) => <bdi>{r.accountingDate}</bdi> },
    { key: 'description', label: 'תיאור', render: (r) => r.description || 'פקודת יומן' },
    { key: 'source', label: 'אסמכתה', render: (r) => <bdi className="ui-sub">{r.sourceEventId.startsWith('manual:') ? 'רישום ידני' : (r.reversalOf || r.sourceEventId.startsWith('reverse:')) ? 'פקודת היפוך' : r.sourceEventId}</bdi> },
    { key: 'total', label: 'חובה = זכות', render: (r) => <bdi className="ui-num">{r.totalDebit} ₪</bdi> },
    { key: 'details', label: 'פירוט', render: (r) => <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedEntry(r)}>שורות הפקודה</button> },
    { key: 'reverse', label: 'תיקון', render: (r) => canWrite && !r.reversalOf ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setReversing(r); setReverseDate(today()); }}>היפוך פקודה</button> : '—' },
  ];
  return <Page wide title="הנהלת חשבונות" back="/pms">
    <div className="ui-toolbar"><p className="ui-sub">ישות משפטית, ספר כפול ותקופות חשבונאיות</p><div className="ui-toolbar-end"><Link className="btn btn-secondary btn-sm" to="/pms/admin/fiscal">מסמכים ורשות המסים</Link></div></div>
    <ErrorBanner error={action.error} />
    {message && <div role="status"><Banner tone="ok">{message}</Banner></div>}
    {!canWrite && <Banner tone="info">הרשאת צפייה בלבד.</Banner>}
    {!data.entity ? <Card title="הגדרת העסק שמנהל את הספרים">
      <p className="ui-p">הגדירו את הישות המשפטית שמפעילה את הנכס. הספר החדש מתחיל בסביבת בדיקה, בנפרד מהמסמכים הקיימים.</p>
      <form onSubmit={(e) => { e.preventDefault(); run(() => accounting.setup(propertyId, setup), 'הישות הוגדרה בסביבת בדיקה'); }} className="grid gap-4 sm:grid-cols-2">
        {field('ae-name', 'שם משפטי', setup.legalName, change(setSetup, 'legalName'), { required: true, disabled: !canWrite })}
        {field('ae-tax', 'מספר עוסק / ח.פ.', setup.taxId, change(setSetup, 'taxId'), { required: true, dir: 'ltr', pattern: '[0-9]{9}', maxLength: 9, disabled: !canWrite })}
        {field('ae-address', 'כתובת', setup.address, change(setSetup, 'address'), { required: true, disabled: !canWrite })}
        {field('ae-city', 'עיר', setup.city, change(setSetup, 'city'), { required: true, disabled: !canWrite })}
        <div><button className="btn btn-primary" disabled={!canWrite || action.busy}>{action.busy ? <Spinner /> : 'יצירת ישות וספר בדיקה'}</button></div>
      </form>
    </Card> : <>
      <Banner tone="info"><span><strong>{data.entity.legalName}</strong> · עוסק <bdi>{data.entity.taxId}</bdi> · ספר בדיקה. רישומים כאן אינם מחליפים את הספרים המאושרים של העסק. מעבר לפעילות אמת מחייב השלמת שערי השחרור.</span></Banner>
      <Segmented label="תצוגת הנהלת חשבונות" value={tab} onChange={(v) => { setTab(v); action.reset(); setMessage(''); }} options={[{ value: 'books', label: 'ספר ראשי' }, { value: 'periods', label: 'תקופות וחשבונות' }, { value: 'series', label: 'סדרות מנפיק' }, { value: 'readiness', label: 'מוכנות להפעלה' }]} />
      {tab === 'books' && <>
        <Card title="פקודת יומן חדשה">
          {!data.accounts.length || !data.periods.some((p) => p.state === 'open') ? <Empty title="נדרשים חשבונות ותקופה פתוחה" description="עברו לתקופות וחשבונות כדי להכין את ספר הבדיקה." action={<button className="btn btn-secondary" onClick={() => setTab('periods')}>הגדרת הספר</button>} /> : <form onSubmit={(e) => { e.preventDefault(); run(() => accounting.postJournal(propertyId, { ...journal, lines: journal.lines.map((l) => ({ ...l, debit: l.debit || '0', credit: l.credit || '0' })) }), 'פקודת היומן נרשמה', () => setJournal({ accountingDate: today(), description: '', sourceEventId: newKey(), lines: [blankLine(), blankLine()] })); }}>
            <div className="grid gap-4 sm:grid-cols-2">{field('journal-date', 'תאריך חשבונאי', journal.accountingDate, change(setJournal, 'accountingDate'), { type: 'date', required: true })}{field('journal-description', 'תיאור הפעולה', journal.description, change(setJournal, 'description'), { required: true, maxLength: 500 })}</div>
            <div className="overflow-x-auto"><table className="w-full text-sm my-4"><caption className="sr-only">שורות פקודת יומן</caption><thead><tr><th scope="col">חשבון</th><th scope="col">חובה</th><th scope="col">זכות</th><th scope="col">פעולה</th></tr></thead><tbody>{journal.lines.map((line, i) => <tr key={i}>
              <td className="p-1"><select className="input w-full" aria-label={`חשבון בשורה ${i + 1}`} required value={line.accountCode} onChange={(e) => setJournal((j) => ({ ...j, lines: j.lines.map((l, k) => k === i ? { ...l, accountCode: e.target.value } : l) }))}><option value="">בחירת חשבון</option>{data.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></td>
              {['debit', 'credit'].map((side) => <td key={side} className="p-1"><input className="input w-full" aria-label={`${side === 'debit' ? 'חובה' : 'זכות'} בשורה ${i + 1}`} inputMode="decimal" dir="ltr" value={line[side]} onChange={(e) => setJournal((j) => ({ ...j, lines: j.lines.map((l, k) => k === i ? { ...l, [side]: e.target.value } : l) }))} /></td>)}
              <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`הסרת שורה ${i + 1}`} disabled={journal.lines.length <= 2} onClick={() => setJournal((j) => ({ ...j, lines: j.lines.filter((_, k) => k !== i) }))}>הסרה</button></td>
            </tr>)}</tbody></table></div>
            <div className="ui-row"><button type="button" className="btn btn-secondary" disabled={journal.lines.length >= 500} onClick={() => setJournal((j) => ({ ...j, lines: [...j.lines, blankLine()] }))}>הוספת שורה</button><button className="btn btn-primary" disabled={!canWrite || action.busy}>{action.busy ? <Spinner /> : 'רישום פקודה מאוזנת'}</button></div>
          </form>}
        </Card>
        <Card title="מאזן בוחן">
          <form className="ui-row flex-wrap" onSubmit={(e) => { e.preventDefault(); action.run(() => accounting.trialBalance(propertyId, from, to)).then((result) => { if (result) setReport(result); }); }}>
            {field('balance-from', 'מתאריך', from, setFrom, { type: 'date', required: true })}{field('balance-to', 'עד תאריך', to, setTo, { type: 'date', required: true })}<button className="btn btn-secondary" disabled={action.busy}>הצגת מאזן</button>
          </form>
          {report && <><Banner tone={report.balanced ? 'ok' : 'bad'}><span>{report.balanced ? 'הספר מאוזן' : 'הספר אינו מאוזן'} · חובה {report.totalDebit} · זכות {report.totalCredit} · {report.entryCount} פקודות · <bdi>{report.from}–{report.to}</bdi></span></Banner><DataTable caption="מאזן בוחן" rowKey={(r) => r.code} rows={report.rows.map((r) => ({ ...r, id: r.code }))} columns={[{ key: 'code', label: 'קוד', render: (r) => r.code }, { key: 'name', label: 'חשבון', render: (r) => r.name }, ...['debit', 'credit', 'balance'].map((k) => ({ key: k, label: { debit: 'חובה', credit: 'זכות', balance: 'יתרה' }[k], render: (r) => <bdi>{r[k]}</bdi> }))]} /></>}
        </Card>
        <Card title="פקודות אחרונות — עד 100" flush><DataTable caption="פקודות יומן" rows={data.entries.map((r) => ({ ...r, id: r._id }))} columns={entryColumns} empty={<Empty title="טרם נרשמו פקודות" />} /></Card>
        {selectedEntry && <Card title={selectedEntry.description || 'שורות פקודה'} actions={<button className="btn btn-ghost" onClick={() => setSelectedEntry(null)}>סגירה</button>}><DataTable caption="שורות הפקודה" rows={selectedEntry.lines.map((l, i) => ({ ...l, id: i }))} columns={[{ key: 'accountCode', label: 'חשבון', render: (r) => r.accountCode }, { key: 'debit', label: 'חובה', render: (r) => r.debit }, { key: 'credit', label: 'זכות', render: (r) => r.credit }]} /></Card>}
      </>}
      {tab === 'periods' && <>
        <Card title="לוח חשבונות" actions={<button className="btn btn-secondary" disabled={!canWrite || action.busy} onClick={() => run(() => accounting.initializeAccounts(propertyId), 'לוח החשבונות הוכן')}>הכנת חשבונות בסיס</button>}><DataTable caption="לוח חשבונות" rows={data.accounts.map((a) => ({ ...a, id: a._id }))} columns={[{ key: 'code', label: 'קוד', render: (r) => r.code }, { key: 'name', label: 'שם חשבון', render: (r) => r.name }, { key: 'classification', label: 'סוג', render: (r) => CLASSES[r.classification] }]} empty={<Empty title="טרם הוגדרו חשבונות" />} /></Card>
        <Card title="תקופות חשבונאיות"><form className="ui-row" onSubmit={(e) => { e.preventDefault(); run(() => accounting.openPeriod(propertyId, month), 'התקופה מוכנה לרישום'); }}>{field('period-month', 'חודש', month, setMonth, { type: 'month', required: true })}<button className="btn btn-primary" disabled={!canWrite || action.busy}>פתיחת תקופה</button></form><DataTable caption="תקופות חשבונאיות" rows={data.periods.map((p) => ({ ...p, id: p._id }))} columns={[{ key: 'month', label: 'חודש', render: (r) => r.month }, { key: 'state', label: 'מצב', render: (r) => <Pill tone={r.state === 'open' ? 'ok' : 'muted'}>{r.state === 'open' ? 'פתוחה' : 'נעולה'}</Pill> }, { key: 'action', label: 'פעולה', render: (r) => r.state === 'open' && canWrite ? <button className="btn btn-secondary btn-sm" onClick={() => setClosing(r)}>נעילת תקופה</button> : r.closeReason || '—' }]} /></Card>
      </>}
      {tab === 'series' && <Card title="סדרות מסמכים של המנפיק">
        <Banner tone="info">הסדרות החדשות נשמרות להכנת המעבר. המספור הפעיל הקיים לא משתנה בעקבות יצירת סדרה כאן.</Banner>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => accounting.createSeries(propertyId, { ...series, firstNumber: Number(series.firstNumber) }), 'הסדרה נשמרה להכנת המעבר'); }}>
          <Field id="series-type" label="סוג מסמך"><select id="series-type" className="input w-full" value={series.documentType} onChange={(e) => change(setSeries, 'documentType')(e.target.value)}>{Object.entries(TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
          {field('series-code', 'קוד סדרה', series.code, change(setSeries, 'code'), { required: true, dir: 'ltr', maxLength: 30 })}
          <Field id="series-prefix" label="קידומת (רשות)"><input id="series-prefix" className="input w-full" value={series.prefix} onChange={(e) => change(setSeries, 'prefix')(e.target.value)} dir="ltr" maxLength={20} /></Field>
          {field('series-first', 'מספר ראשון', series.firstNumber, change(setSeries, 'firstNumber'), { required: true, inputMode: 'numeric' })}
          {field('series-reference', 'אסמכתה לאישור מדיניות המספור', series.approvalReference, change(setSeries, 'approvalReference'), { required: true })}
          <div><button className="btn btn-primary" disabled={!canWrite || action.busy}>שמירת סדרה להכנה</button></div>
        </form><DataTable caption="סדרות מנפיק" rows={data.series.map((s) => ({ ...s, id: s._id }))} columns={[{ key: 'code', label: 'קוד', render: (r) => r.code }, { key: 'type', label: 'סוג', render: (r) => TYPES[r.documentType] }, { key: 'next', label: 'המספר הבא', render: (r) => `${r.prefix}${r.lastNumber + 1}` }, { key: 'status', label: 'מצב', render: (r) => r.active ? 'פעילה' : 'בהכנה' }]} />
      </Card>}
      {tab === 'readiness' && <Card title="שערי שחרור לפעילות אמת">
        <p className="ui-p">אישור נרשם בצירוף בעל סמכות, מקור, גרסה ואסמכתה. בדיקות תוכנה לבדן אינן אישור מקצועי.</p>
        <DataTable caption="שערי שחרור" rows={data.gates.map((g) => ({ ...g, id: g.requirementId || g.id }))} columns={[
          { key: 'label', label: 'תחום', render: (r) => r.label },
          { key: 'owner', label: 'בעל אחריות', render: (r) => OWNERS[r.owner] || r.owner },
          { key: 'status', label: 'מצב', render: (r) => <Pill tone={['APPROVED', 'NOT_APPLICABLE'].includes(r.status) ? 'ok' : 'warn'}>{STATUSES[r.status]}</Pill> },
          { key: 'evidence', label: 'אסמכתה', render: (r) => r.evidenceReference || 'טרם הוצגה' },
          { key: 'record', label: 'תיעוד', render: (r) => canRecord ? <button className="btn btn-ghost btn-sm" onClick={() => setDecision(r)}>תיעוד החלטה</button> : 'צפייה בלבד' },
        ]} />
        <p className="ui-sub">משימות המשך ממתינות: {data.outbox.pending} · משימות שנכשלו: {data.outbox.failed}</p>
        {canWrite && <button className="btn btn-secondary" disabled={action.busy} onClick={() => run(() => accounting.recover(propertyId), 'עיבוד משימות הארכיון הושלם')}>עיבוד משימות ארכיון ממתינות</button>}
      </Card>}
      {decision && <ComplianceDialog key={decision.id} gate={decision} propertyId={propertyId} onClose={() => setDecision(null)} onSaved={() => { setDecision(null); setMessage('ההחלטה והאסמכתה תועדו'); loader.reload(); }} />}
      <ConfirmDialog open={!!reversing} onClose={() => setReversing(null)} title="היפוך פקודת יומן" confirmLabel="רישום פקודת היפוך" requireReason onConfirm={async (reason) => { await accounting.reverseJournal(propertyId, reversing._id, { reason, accountingDate: reverseDate }); setReversing(null); setMessage('פקודת ההיפוך נרשמה; פקודת המקור נשמרה'); setReport(null); await loader.reload(); }}><p>חובה וזכות יתהפכו בפקודה חדשה. נדרשת תקופה פתוחה לתאריך התיקון.</p>{field('reverse-date', 'תאריך התיקון', reverseDate, setReverseDate, { type: 'date', required: true })}</ConfirmDialog>
      <ConfirmDialog open={!!closing} onClose={() => setClosing(null)} title={`נעילת תקופה ${closing?.month || ''}`} confirmLabel="נעילת התקופה" requireReason onConfirm={async (reason) => { await accounting.closePeriod(propertyId, closing._id, reason); setClosing(null); setMessage('התקופה ננעלה לרישום'); await loader.reload(); }}><p>לא ניתן לרשום פקודות נוספות בתקופה נעולה. תיקונים יירשמו בתקופה פתוחה.</p></ConfirmDialog>
    </>}
  </Page>;
}
export default function AccountingPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  if (!READ.includes(role)) return <Page><Banner tone="warn">אין הרשאה להנהלת חשבונות.</Banner></Page>;
  if (!propertyId) return <Page><Empty title="יש לבחור נכס" /></Page>;
  return <AccountingWorkspace key={propertyId} propertyId={propertyId} canWrite={WRITE.includes(role)} canRecord={['super_admin', 'chain_admin', 'finance_manager'].includes(role)} />;
}
