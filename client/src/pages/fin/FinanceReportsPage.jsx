// FIN-11 / FIN-12 — fiscal and cash reports for the period: document journal with series integrity,
// sales VAT, receipts by method, what has no document yet, allocation numbers, cash drawers, and the
// exports the accountant / Tax Authority ask for (Excel workbook, open format "מבנה אחיד" 1.31).
// Every figure comes from the documents and folios on the server.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Download, FileArchive } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance, saveBlob } from '../../utils/api';
import { formatShort } from '../../utils/date';
import {
  Page, Toolbar, Card, Segmented, DataTable, Tag, Banner, KeyValues, Empty, ErrorBanner, Spinner, Modal, Field, Tiles,
  useUrlState, useLoader, useAction, money, formatDateTime,
} from '../../components/kit';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const monthStart = (ymd) => `${ymd.slice(0, 8)}01`;
const prevMonth = (ymd) => { const d = new Date(`${ymd.slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); const s = d.toISOString().slice(0, 10); const e = new Date(`${ymd.slice(0, 8)}01T00:00:00Z`); e.setUTCDate(0); return [s, e.toISOString().slice(0, 10)]; };
const EXPORT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager', 'auditor'];
const TABS = [
  { value: 'journal', label: 'יומן מסמכים' },
  { value: 'vat', label: 'מע״מ עסקאות' },
  { value: 'receipts', label: 'תקבולים' },
  { value: 'undocumented', label: 'ללא מסמך' },
  { value: 'allocations', label: 'מספרי הקצאה' },
  { value: 'cash', label: 'קופות' },
  { value: 'export', label: 'יצוא לרו״ח ולרשות המסים' },
];
const DEFAULTS = { tab: 'journal', from: '', to: '' };
const amt = (n) => <span className={`ui-amount ${Number(n) < 0 ? 'is-credit' : ''}`}>{money(n)}</span>;

function Journal({ data }) {
  const cols = [
    { key: 'd', label: 'תאריך', nowrap: true, render: (r) => <span className="ui-num">{formatShort(r.issueDate)}</span> },
    { key: 't', label: 'מסמך', render: (r) => <span>{r.typeLabel} <bdi className="ui-num">{r.number}</bdi></span> },
    { key: 'b', label: 'נמען', render: (r) => <div>{r.buyer || '—'}{r.buyerVat && <div className="ui-sub ui-num">ע.מ. {r.buyerVat}</div>}</div> },
    { key: 'c', label: 'הזמנה', nowrap: true, render: (r) => <bdi className="ui-sub">{r.confirmationNumber || '—'}</bdi> },
    { key: 'n', label: 'לפני מע״מ', nowrap: true, align: 'left', render: (r) => (r.type === 'receipt' ? '—' : amt(r.net)) },
    { key: 'v', label: 'מע״מ', nowrap: true, align: 'left', render: (r) => (r.type === 'receipt' ? '—' : amt(r.vat)) },
    { key: 'g', label: 'סכום', nowrap: true, align: 'left', render: (r) => amt(r.type === 'receipt' ? r.paid : r.gross) },
    { key: 'a', label: 'הקצאה', nowrap: true, render: (r) => (r.allocationNumber ? <span className="ui-num">{r.allocationNumber}</span> : r.allocation === 'pending' ? <Tag tone="warn">ממתין</Tag> : r.allocation === 'rejected' ? <Tag tone="bad">לא אושר</Tag> : '') },
  ];
  const broken = data.series.filter((x) => !x.ok);
  return (
    <>
      {broken.length > 0 ? broken.map((x) => <Banner key={x.type} tone="bad">רציפות {x.label}: {x.gaps.length ? `חסרים מספרים ${x.gaps.slice(0, 10).join(', ')}${x.gaps.length > 10 ? '…' : ''}` : ''}{x.duplicates.length ? ` · מספרים כפולים ${x.duplicates.join(', ')}` : ''}</Banner>)
        : data.series.length > 0 && <Banner tone="ok">כל סדרות המספור רציפות ({data.series.map((x) => `${x.label} ${x.first}–${x.last}`).join(' · ')})</Banner>}
      <Card title="סיכום לפי סוג מסמך" flush>
        <DataTable caption="סיכום לפי סוג" columns={[{ key: 'l', label: 'סוג מסמך', render: (r) => r.label }, { key: 'c', label: 'כמות', align: 'left', render: (r) => <span className="ui-num">{r.count}</span> }, { key: 't', label: 'סה״כ', align: 'left', render: (r) => amt(r.total) }]} rows={data.perType.map((x) => ({ ...x, id: x.type }))} />
      </Card>
      <Card title={`מסמכים (${data.rows.length})`} flush>
        <DataTable caption="יומן מסמכים" columns={cols} rows={data.rows} empty={<Empty title="אין מסמכים בתקופה" />} />
      </Card>
    </>
  );
}

function Vat({ data }) {
  const s = data.summary;
  const cols = [
    { key: 'd', label: 'תאריך', nowrap: true, render: (r) => <span className="ui-num">{formatShort(r.issueDate)}</span> },
    { key: 't', label: 'מסמך', render: (r) => <span>{r.typeLabel} <bdi className="ui-num">{r.number}</bdi></span> },
    { key: 'b', label: 'נמען', render: (r) => <div>{r.buyer || '—'}{r.buyerVat && <div className="ui-sub ui-num">ע.מ. {r.buyerVat}</div>}</div> },
    { key: 's', label: 'חייב במע״מ', nowrap: true, align: 'left', render: (r) => amt(r.standard) },
    { key: 'z', label: 'שיעור אפס', nowrap: true, align: 'left', render: (r) => (r.zero ? amt(r.zero) : '—') },
    { key: 'e', label: 'פטור', nowrap: true, align: 'left', render: (r) => (r.exempt ? amt(r.exempt) : '—') },
    { key: 'v', label: 'מע״מ', nowrap: true, align: 'left', render: (r) => amt(r.vat) },
    { key: 'a', label: 'מס׳ הקצאה', nowrap: true, render: (r) => <span className="ui-num">{r.allocationNumber || ''}</span> },
  ];
  return (
    <>
      <Card title="סיכום עסקאות לתקופה">
        <KeyValues rows={[
          ['עסקאות חייבות (לפני מע״מ)', money(s.standard)], ...data.byRate.map((x) => [`מתוכן בשיעור ${x.rate}% — מע״מ`, money(x.vat)]),
          ['עסקאות בשיעור אפס', money(s.zero)], ['עסקאות פטורות', money(s.exempt)], ['סה״כ מע״מ עסקאות', <b key="v">{money(s.vat)}</b>],
          ['מסמכים', `${s.documents}${s.credits ? ` (מתוכם ${s.credits} זיכויים, בסימן שלילי)` : ''}`],
        ]} />
        <div className="ui-sub">{data.note}</div>
      </Card>
      <Card title="מסמכי מע״מ" flush><DataTable caption="מסמכי מע״מ" columns={cols} rows={data.rows} empty={<Empty title="אין חשבוניות בתקופה" />} /></Card>
    </>
  );
}

function Receipts({ data }) {
  const cols = [
    { key: 'd', label: 'תאריך', nowrap: true, render: (r) => <span className="ui-num">{formatShort(r.date)}</span> },
    { key: 'm', label: 'אמצעי', render: (r) => <div>{r.kind === 'refund' ? 'החזר — ' : r.kind === 'deposit' ? 'מקדמה — ' : ''}{r.methodLabel}<div className="ui-sub">{r.reference}{r.details?.last4 ? ` · ****${r.details.last4}` : ''}{r.details?.installments > 1 ? ` · ${r.details.installments} תשלומים` : ''}{r.details?.dueDate ? ` · פירעון ${formatShort(r.details.dueDate)}` : ''}</div></div> },
    { key: 'g', label: 'אורח', render: (r) => <div>{r.guest || '—'}<div className="ui-sub"><bdi>{r.confirmationNumber}</bdi>{r.by ? ` · ${r.by}` : ''}</div></div> },
    { key: 'doc', label: 'מסמך', render: (r) => (r.document ? <span className="ui-sub">{r.document}</span> : <Tag tone="warn">ללא קבלה</Tag>) },
    { key: 'a', label: 'סכום', nowrap: true, align: 'left', render: (r) => amt(r.amount) },
  ];
  return (
    <>
      {data.withoutReceipt > 0 && <Banner tone="warn">{data.withoutReceipt} תקבולים/החזרים בתקופה עדיין בלי קבלה — ראו לשונית ״ללא מסמך״.</Banner>}
      <div className="ui-grid-2">
        <Card title="לפי אמצעי תשלום" flush>
          <DataTable caption="לפי אמצעי" columns={[{ key: 'l', label: 'אמצעי', render: (r) => r.label }, { key: 'c', label: 'תנועות', align: 'left', render: (r) => <span className="ui-num">{r.count}</span> }, { key: 'r', label: 'התקבל', align: 'left', render: (r) => money(r.received) }, { key: 'f', label: 'הוחזר', align: 'left', render: (r) => (r.refunded ? money(r.refunded) : '—') }, { key: 'n', label: 'נטו', align: 'left', render: (r) => <b>{money(r.net)}</b> }]} rows={data.byMethod.map((x) => ({ ...x, id: x.method }))} empty={<Empty title="אין תקבולים" />} />
        </Card>
        <Card title="כרטיסי אשראי לפי סוג ותוכנית" flush>
          <DataTable caption="כרטיסים" columns={[{ key: 'b', label: 'כרטיס', render: (r) => r.brand }, { key: 'p', label: 'תוכנית', render: (r) => r.plan }, { key: 'c', label: 'עסקאות', align: 'left', render: (r) => r.count }, { key: 'a', label: 'סכום', align: 'left', render: (r) => money(r.amount) }]} rows={data.cards.map((x, i) => ({ ...x, id: i }))} empty={<Empty title="אין עסקאות אשראי" />} />
        </Card>
      </div>
      {data.cheques.length > 0 && (
        <Card title="שיקים לפי מועד פירעון" flush>
          <DataTable caption="שיקים" columns={[{ key: 'd', label: 'פירעון', render: (r) => <span className="ui-num">{r.dueDate ? formatShort(r.dueDate) : '—'}</span> }, { key: 'n', label: 'שיק', render: (r) => <span className="ui-num">{r.reference} · בנק {r.bank}/{r.branch} · חשבון {r.account}</span> }, { key: 'g', label: 'אורח', render: (r) => r.guest }, { key: 'a', label: 'סכום', align: 'left', render: (r) => money(r.amount) }]} rows={data.cheques} />
        </Card>
      )}
      <Card title={`כל התנועות · נטו ${money(data.total)}`} flush><DataTable caption="תקבולים" columns={cols} rows={data.rows} empty={<Empty title="אין תקבולים בתקופה" />} /></Card>
    </>
  );
}

function Undocumented({ data }) {
  const nav = useNavigate();
  const cols = [
    { key: 's', label: 'דחיפות', nowrap: true, render: (r) => <Tag tone={r.severity === 'high' ? 'bad' : r.severity === 'medium' ? 'warn' : undefined}>{r.severity === 'high' ? 'יצא בלי חשבונית' : r.severity === 'medium' ? 'יצא בלי קבלה' : 'בשהייה'}</Tag> },
    { key: 'g', label: 'אורח', render: (r) => <div>{r.guest || '—'}<div className="ui-sub"><bdi>{r.confirmationNumber}</bdi>{r.departureDate ? ` · יציאה ${formatShort(r.departureDate)}` : ''}</div></div> },
    { key: 'c', label: 'חיובים בלי חשבונית', nowrap: true, align: 'left', render: (r) => (Math.abs(r.charges) > 0.005 ? amt(r.charges) : '—') },
    { key: 'p', label: 'תקבולים בלי קבלה', nowrap: true, align: 'left', render: (r) => (Math.abs(r.payments) > 0.005 ? amt(r.payments) : '—') },
    { key: 'o', label: 'הוותיק', nowrap: true, render: (r) => <span className="ui-num">{r.oldest ? `${formatShort(r.oldest)} · ${r.ageDays} ימים` : '—'}</span> },
  ];
  return (
    <>
      <Banner tone={data.totals.departedWithCharges ? 'bad' : 'info'}>
        {data.totals.departedWithCharges ? `${data.totals.departedWithCharges} שהיות שיצאו עם חיובים בלי חשבונית מס — חובה להפיק.` : 'כל חיוב שנגבה חייב בחשבונית מס וכל תקבול בקבלה. הרשימה מתעדכנת מהחשבונות עצמם.'}
        {' '}לחיצה על שורה פותחת את החשבון להפקת המסמך.
      </Banner>
      <Card title={`ללא מסמך · חיובים ${money(data.totals.charges)} · תקבולים ${money(data.totals.payments)}`} flush>
        <DataTable caption="ללא מסמך" columns={cols} rows={data.rows.map((x) => ({ ...x, id: x.folioId }))} onRowClick={(r) => nav(`/pms/folio?reservation=${r.reservationId}&folio=${r.folioId}`)} empty={<Empty title="אין חיובים או תקבולים בלי מסמך בתקופה" />} />
      </Card>
    </>
  );
}

function Allocations({ data }) {
  const nav = useNavigate();
  const cols = [
    { key: 'd', label: 'תאריך', nowrap: true, render: (r) => <span className="ui-num">{formatShort(r.issueDate)}</span> },
    { key: 't', label: 'חשבונית', render: (r) => <span>{r.typeLabel} <bdi className="ui-num">{r.number}</bdi></span> },
    { key: 'b', label: 'נמען', render: (r) => <div>{r.buyer}<div className="ui-sub ui-num">ע.מ. {r.buyerVat}</div></div> },
    { key: 'n', label: 'לפני מע״מ', align: 'left', nowrap: true, render: (r) => money(r.net) },
    { key: 'v', label: 'מע״מ', align: 'left', nowrap: true, render: (r) => money(r.vat) },
    { key: 's', label: 'מצב', render: (r) => (r.state === 'approved' ? <span className="ui-num">{r.number9}</span> : <div><Tag tone={r.state === 'rejected' ? 'bad' : 'warn'}>{r.stateLabel}{r.decision ? ` · ${{ cancel: 'ביטול', continue: 'הופקה בלי מספר', hearing: 'שימוע' }[r.decision]}` : ''}</Tag>{r.reason && <div className="ui-sub">{r.reason}</div>}</div>) },
  ];
  return (
    <>
      <Tiles label="מצב הקצאות" items={[
        { id: 'a', label: 'אושרו', value: data.counts.approved, static: true },
        { id: 'p', label: 'ממתינים', value: data.counts.pending, tone: data.counts.pending ? 'warn' : undefined, static: true },
        { id: 'r', label: 'לא אושרו', value: data.counts.rejected, tone: data.counts.rejected ? 'bad' : undefined, static: true },
        { id: 'v', label: 'מע״מ שהלקוחות לא יכולים לנכות', value: money(data.vatAtRisk, 'ILS', 0), static: true },
      ]} />
      <Card title="חשבוניות שחלה עליהן חובת הקצאה" flush><DataTable caption="הקצאות" columns={cols} rows={data.rows} onRowClick={() => nav('/pms/invoices?view=pending')} empty={<Empty title="אין חשבוניות כאלה בתקופה" />} /></Card>
    </>
  );
}

function CloseDialog({ open, onClose, propertyId, date, row, onSaved }) {
  const act = useAction();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const variance = counted === '' ? null : Math.round((Number(counted) - Number(row?.expected || 0)) * 100) / 100;
  const needNote = (variance !== null && Math.abs(variance) > 0.005) || !!row?.close;
  const why = counted === '' ? 'הזינו את הסכום שנספר' : needNote && note.trim().length < 3 ? (row?.close ? 'סגירה מתקנת — נדרשת סיבה' : 'יש הפרש — נדרש הסבר') : null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={460} title="סגירת קופה" subtitle={row ? `${row.name} · ${formatShort(date)}` : ''} footer={(
      <>
        {why && <span className="ui-foot-note">{why}</span>}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button>
        <button type="button" className="btn btn-primary" disabled={act.busy || !!why} onClick={async () => { const out = await act.run(() => finance.closeCash(propertyId, { date, userId: row.userId, counted: Number(counted), note: note.trim() || undefined })); if (out) onSaved(out); }}>{act.busy ? <Spinner /> : 'סגירה'}</button>
      </>
    )}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <KeyValues rows={[['מזומן צפוי בקופה', money(row?.expected)], ['תנועות מזומן', row?.lines ?? 0]]} />
        <Field id="cc-c" label="נספר בפועל" required><input id="cc-c" type="number" min={0} step="0.01" className="input w-full" dir="ltr" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus /></Field>
        {variance !== null && <div className={`pm-change ${Math.abs(variance) > 0.005 ? 'is-bad' : ''}`}>{Math.abs(variance) < 0.005 ? 'הקופה מאוזנת' : `הפרש ${variance > 0 ? 'עודף' : 'חוסר'} ${money(Math.abs(variance))}`}</div>}
        <Field id="cc-n" label={row?.close ? 'סיבת הסגירה המתקנת' : 'הסבר'} required={needNote} optional={!needNote}><input id="cc-n" className="input w-full" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Cash({ propertyId }) {
  const [date, setDate] = useState(today());
  const [closing, setClosing] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.cash(propertyId, date) : null), [propertyId, date]);
  const cols = [
    { key: 'n', label: 'קופאי', render: (r) => r.name },
    { key: 'l', label: 'תנועות', align: 'left', render: (r) => <span className="ui-num">{r.lines}</span> },
    { key: 'e', label: 'צפוי', align: 'left', nowrap: true, render: (r) => amt(r.expected) },
    { key: 'c', label: 'נספר', align: 'left', nowrap: true, render: (r) => (r.close ? money(r.close.counted) : '—') },
    { key: 'v', label: 'הפרש', align: 'left', nowrap: true, render: (r) => (r.close ? <span className={Math.abs(r.close.variance) > 0.005 ? 'ui-amount is-due' : 'ui-amount is-zero'}>{money(r.close.variance)}</span> : '—') },
    { key: 's', label: 'מצב', render: (r) => (r.close ? <div><Tag tone={r.close.stale ? 'warn' : undefined}>{r.close.stale ? 'נוספו תנועות אחרי הסגירה' : 'נסגרה'}</Tag><div className="ui-sub">{r.close.by} · {formatDateTime(r.close.at)}{r.close.note ? ` · ${r.close.note}` : ''}</div></div> : <Tag tone="warn">פתוחה</Tag>) },
    { key: 'a', label: 'פעולות', srOnly: true, render: (r) => <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClosing(r)}>{r.close ? 'סגירה מתקנת' : 'סגירת קופה'}</button> },
  ];
  return (
    <>
      <Toolbar start={<Field id="cash-d" label="יום עסקי"><input id="cash-d" type="date" className="input" max={today()} value={date} onChange={(e) => setDate(e.target.value || today())} /></Field>} />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && (
        <>
          <KeyValues rows={[['מזומן נטו ביום', money(data.total)], ['נספר בקופות שנסגרו', money(data.counted)], ['סה״כ הפרשים', money(data.variance)], data.unattributed ? ['מזומן ללא קופאי (רישום מערכת)', money(data.unattributed)] : null]} />
          <Card title="קופות" flush><DataTable caption="קופות" columns={cols} rows={data.rows.map((x) => ({ ...x, id: x.userId }))} empty={<Empty title="אין תנועות מזומן ביום זה" />} /></Card>
        </>
      )}
      <CloseDialog open={!!closing} onClose={() => setClosing(null)} propertyId={propertyId} date={date} row={closing} onSaved={() => { setClosing(null); reload(); }} />
    </>
  );
}

function ExportTab({ propertyId, from, to, canExport }) {
  const xls = useAction();
  const of = useAction();
  const [printout, setPrintout] = useState(null);
  if (!canExport) return <Banner tone="info">יצוא לרואה החשבון ולרשות המסים — להנהלה, לכספים ולביקורת.</Banner>;
  return (
    <>
      <Card title="חוברת לרואה החשבון (Excel)">
        <p className="ui-p">גיליונות: מסמכים, שורות מסמך, תקבולים (כולל פרטי שיק/כרטיס/העברה), מע״מ, מספרי הקצאה, ללא מסמך ורציפות סדרות — לתקופה שנבחרה.</p>
        <ErrorBanner error={xls.error} />
        <button type="button" className="btn btn-primary" disabled={xls.busy} onClick={() => xls.run(() => finance.downloadWorkbook(propertyId, { from, to }))}>{xls.busy ? <Spinner /> : <><Download size={15} /> הורדת קובץ Excel</>}</button>
      </Card>
      <Card title="קבצים במבנה אחיד (רשות המסים, הוראות 1.31)">
        <p className="ui-p">מפיק את INI.TXT ו־BKMVDATA (בתוך תיקיית OPENFRMT לפי ההוראות) לכל המסמכים שהופקו בתקופה: כותרות מסמך (C100), שורות (D110) ופרטי קבלות (D120). נמסר לרשות המסים או לרואה החשבון לפי דרישה.</p>
        <ErrorBanner error={of.error} />
        <button type="button" className="btn btn-primary" disabled={of.busy} onClick={async () => {
          const out = await of.run(() => finance.openFormat(propertyId, { from, to }));
          if (out) {
            const bin = Uint8Array.from(atob(out.zipBase64), (c) => c.charCodeAt(0));
            saveBlob(new Blob([bin], { type: 'application/zip' }), out.fileName);
            setPrintout(out.summary);
          }
        }}>{of.busy ? <Spinner /> : <><FileArchive size={15} /> הפקת קבצים במבנה אחיד</>}</button>
      </Card>
      {printout && (
        <Card title="פלט אימות — הפקת קבצים במבנה אחיד" actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}><Printer size={14} /> הדפסה</button>}>
          {printout.warnings.map((w) => <Banner key={w} tone="warn">{w}</Banner>)}
          <KeyValues rows={[
            ['מספר עוסק מורשה', printout.vatNumber], ['שם בית העסק', printout.businessName], ['ביצוע ממשק פתוח', 'הסתיים בהצלחה'],
            ['הנתונים נשמרו בנתיב', <bdi key="p" dir="ltr">{printout.folder}</bdi>], ['טווח תאריכים', `${formatShort(printout.from)} – ${formatShort(printout.to)}`],
            ['מספר רישום התוכנה', printout.softwareRegNumber || 'לא רשומה'], ['הופק', formatDateTime(printout.producedAt)], ['מזהה ראשי', <bdi key="i" className="ui-num">{printout.primaryId}</bdi>],
          ]} />
          <div className="ui-grid-2">
            <DataTable caption="רשומות" columns={[{ key: 'c', label: 'קוד רשומה', render: (r) => r.code }, { key: 'l', label: 'תיאור', render: (r) => r.label }, { key: 'n', label: 'סה״כ רשומות', align: 'left', render: (r) => r.count }]} rows={printout.records.map((x) => ({ ...x, id: x.code }))} />
            <DataTable caption="מסמכים" columns={[{ key: 'c', label: 'מספר', render: (r) => r.code }, { key: 'l', label: 'סוג המסמך', render: (r) => r.label }, { key: 'n', label: 'סה״כ כמותי', align: 'left', render: (r) => r.count }, { key: 't', label: 'סה״כ כספי', align: 'left', render: (r) => money(r.total) }]} rows={printout.documents.map((x) => ({ ...x, id: x.code }))} />
          </div>
        </Card>
      )}
    </>
  );
}

export default function FinanceReportsPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState(DEFAULTS);
  const tab = url.get('tab');
  const t0 = today();
  const from = url.get('from') || monthStart(t0);
  const to = url.get('to') || t0;
  const loadable = !['cash', 'export'].includes(tab);
  const { data: loaded, loading, error, reload } = useLoader(async () => (propertyId && loadable ? { tab, report: await finance.report(propertyId, tab, { from, to }) } : null), [propertyId, tab, from, to]);
  const data = loaded?.tab === tab ? loaded.report : null;
  const [pm0, pm1] = useMemo(() => prevMonth(t0), [t0]);
  const setRange = (f, t) => url.set({ from: f, to: t }, { resetPage: false });

  return (
    <Page wide>
      <Toolbar
        start={<Segmented label="דוח" value={tab} onChange={(v) => url.set({ tab: v }, { resetPage: false })} options={TABS} />}
        end={tab !== 'cash' && (
          <div className="ui-row" style={{ gap: 6, alignItems: 'flex-end' }}>
            <Field id="r-from" label="מתאריך"><input id="r-from" type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setRange(e.target.value, to)} /></Field>
            <Field id="r-to" label="עד תאריך"><input id="r-to" type="date" className="input" value={to} min={from} max={t0} onChange={(e) => e.target.value && setRange(from, e.target.value)} /></Field>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRange(monthStart(t0), t0)}>החודש</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRange(pm0, pm1)}>חודש קודם</button>
            {loadable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}><Printer size={14} /> הדפסה</button>}
          </div>
        )}
      />
      {loadable && <ErrorBanner error={error} onRetry={reload} />}
      {loadable && loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {loadable && data && (
        <div className="ui-stack">
          {tab === 'journal' && <Journal data={data} />}
          {tab === 'vat' && <Vat data={data} />}
          {tab === 'receipts' && <Receipts data={data} />}
          {tab === 'undocumented' && <Undocumented data={data} />}
          {tab === 'allocations' && <Allocations data={data} />}
        </div>
      )}
      {tab === 'cash' && <Cash propertyId={propertyId} />}
      {tab === 'export' && <ExportTab propertyId={propertyId} from={from} to={to} canExport={EXPORT_ROLES.includes(role)} />}
    </Page>
  );
}
