// FIN-12 reports (gap G4) — what accounting reconciles every morning: trial balance (opening +
// charges − payments + refunds = closing), the ledgers the closing splits into, revenue by charge
// code with VAT, receipts by method, and the manager flash (day / month / year). A closed day shows
// what was stored at the close; any later change to its history is flagged, never hidden.
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Printer } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { finance } from '../../utils/api';
import { formatLong, formatShort } from '../../utils/date';
import { Page, Card, DataTable, Banner, ErrorBanner, Spinner, KeyValues, Pill, useLoader, useUrlState, money, formatDateTime } from '../../components/kit';

const URL_DEFAULTS = { date: '' };
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function Checks({ checks }) {
  return (
    <ul className="ui-staff">
      {checks.map((c) => (
        <li key={c.key}>
          <div className="ui-row" style={{ gap: 8 }}>
            {c.ok === false ? <AlertTriangle size={15} className="text-[rgb(185_28_28)]" aria-hidden="true" /> : <CheckCircle2 size={15} className={c.ok ? 'text-[rgb(21_128_61)]' : 'text-[rgb(var(--fg-faint))]'} aria-hidden="true" />}
            <span>{c.label}</span>
          </div>
          <Pill tone={c.ok === false ? 'bad' : c.ok ? 'ok' : 'muted'}>{c.ok === false ? 'לבדיקה' : c.ok ? 'תקין' : 'לא נבדק'}</Pill>
        </li>
      ))}
    </ul>
  );
}

function Flash({ f }) {
  const cols = [
    { key: 'k', label: 'מדד' },
    { key: 'day', label: 'יום', align: 'left' },
    { key: 'mtd', label: 'מתחילת החודש', align: 'left' },
    { key: 'ytd', label: 'מתחילת השנה', align: 'left' },
  ];
  const row = (k, fn) => ({ id: k, k, day: fn(f.day), mtd: fn(f.mtd), ytd: fn(f.ytd) });
  const rows = [
    row('ימים סגורים', (x) => x.days),
    row('תפוסה', (x) => `${x.occupancyPct}%`),
    row('חדרים שנמכרו', (x) => `${x.roomNights} / ${x.sellable}`),
    row('הכנסות לינה (כולל מע״מ)', (x) => money(x.roomRevenue)),
    row('ADR', (x) => money(x.adr)),
    row('RevPAR', (x) => money(x.revpar)),
    row('הכנסות אחרות', (x) => money(x.otherRevenue)),
    row('הגיעו / יצאו / לא הגיעו', (x) => `${x.arrived} / ${x.departed} / ${x.noShows}`),
  ];
  return <DataTable caption="דוח מנהל" columns={cols} rows={rows} />;
}

export default function DayReportPage() {
  const { propertyId } = useProperty();
  const us = useUrlState(URL_DEFAULTS);
  const url = { date: us.get('date') };
  const setUrl = us.set;
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.dayReport(propertyId, url.date || undefined) : null), [propertyId, url.date]);
  const L = data?.ledger;
  const stored = data?.stored;
  const books = stored?.ledgers ? Object.fromEntries(Object.entries(L.ledgers).map(([k, v]) => [k, { ...v, balance: stored.ledgers[k]?.balance ?? v.balance, folios: stored.ledgers[k]?.folios ?? v.folios }])) : L?.ledgers;
  const broken = (data?.checks || []).filter((c) => c.ok === false);

  const revCols = [
    { key: 'name', label: 'קוד', render: (r) => <div><div>{r.name}</div><div className="ui-sub"><bdi dir="ltr">{r.code}</bdi>{r.glAccount ? ` · חשבון ${r.glAccount}` : ''}{!r.mapped && ' · לא בקטלוג'}</div></div> },
    { key: 'count', label: 'תנועות', align: 'left' },
    { key: 'net', label: 'נטו', align: 'left', render: (r) => <span className="ui-amount">{money(r.net)}</span> },
    { key: 'tax', label: 'מע״מ', align: 'left', render: (r) => <span className="ui-amount">{money(r.tax)}</span> },
    { key: 'gross', label: 'ברוטו', align: 'left', render: (r) => <span className="ui-amount">{money(r.gross)}</span> },
  ];
  const payCols = [
    { key: 'name', label: 'אמצעי', render: (r) => <div><div>{r.name}</div>{r.glAccount && <div className="ui-sub">חשבון {r.glAccount}</div>}</div> },
    { key: 'count', label: 'תנועות', align: 'left' },
    { key: 'amount', label: 'סכום', align: 'left', render: (r) => <span className="ui-amount">{money(r.amount)}</span> },
  ];

  return (
    <Page title="דוח סגירת יום" back="/pms/night-audit">
      <div className="ui-toolbar">
        <div>
          <div className="ui-sub"><b>{data ? formatLong(data.date) : ''}</b> ·
            {data?.closed ? `נסגר ב־${data.runNo} · ${data.closedBy || '—'} · ${formatDateTime(data.closedAt)}` : data ? 'יום פתוח — הנתונים חיים ועשויים להשתנות עד הסגירה' : ''}
          </div>
        </div>
        <div className="ui-toolbar-end ui-row">
          {data && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUrl({ date: addDays(data.date, -1) })}>יום קודם</button>}
          {data && data.date < data.openDate && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUrl({ date: addDays(data.date, 1) })}>יום הבא</button>}
          <input type="date" className="input" aria-label="תאריך" max={data?.openDate} value={url.date || data?.date || ''} onChange={(e) => setUrl({ date: e.target.value })} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}><Printer size={14} /> הדפסה</button>
          <Link className="btn btn-ghost btn-sm" to="/pms/night-audit">לסגירת יום</Link>
        </div>
      </div>
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && (
        <>
          {broken.length > 0 && <Banner tone="warn"><AlertTriangle size={14} aria-hidden="true" /> {broken.length} בדיקות דורשות טיפול של הנהלת החשבונות — פירוט למטה.</Banner>}
          <div className="ui-split">
            <Card title="מאזן בוחן">
              <KeyValues rows={[
                ['יתרת פתיחה', money(L.trial.opening)],
                ['+ חיובים', money(L.trial.charges)],
                L.trial.adjustments ? ['± תיקונים והיפוכים', money(L.trial.adjustments)] : null,
                ['− תשלומים ומקדמות', money(L.trial.payments)],
                L.trial.refunds ? ['+ החזרים', money(L.trial.refunds)] : null,
                ['= יתרת סגירה', money(L.trial.closing)],
                stored ? ['יתרת סגירה שנשמרה בסגירה', money(stored.trial.closing)] : null,
              ]} />
              <div className="ui-sub">יתרה חיובית = האורחים והחברות חייבים למלון; שלילית = כסף שהתקבל מראש.</div>
            </Card>
            <Card title="בדיקות"><Checks checks={data.checks} /></Card>
          </div>
          <Card title={`ספרי חשבונות בסוף היום${stored ? ' (כפי שנשמרו בסגירה)' : ''}`}>
            <KeyValues rows={Object.entries(books).map(([k, v]) => [v.label || k, `${money(v.balance)} · ${v.folios} חשבונות`])} />
            <div className="ui-row" style={{ marginTop: 8 }}>
              <Link className="btn btn-secondary btn-sm" to="/pms/folio?view=balance">חשבונות עם יתרה</Link>
              <Link className="btn btn-secondary btn-sm" to="/pms/folio?view=credit">חשבונות בזכות</Link>
            </div>
          </Card>
          <Card title={`הכנסות לפי קוד חיוב · ${money(L.revenue.total.gross)}`} flush>
            <DataTable caption="הכנסות לפי קוד" columns={revCols} rows={L.revenue.rows.map((r) => ({ ...r, id: r.code }))} empty={<div className="ui-empty">אין חיובים ביום זה</div>} />
            {L.revenue.groups.length > 0 && (
              <div style={{ padding: '10px 14px' }}>
                <KeyValues rows={L.revenue.groups.map((g) => [g.label, `${money(g.gross)} (נטו ${money(g.net)} · מע״מ ${money(g.tax)})`])} />
              </div>
            )}
          </Card>
          <div className="ui-split">
            <Card title={`תקבולים לפי אמצעי · ${money(L.trial.payments)}`} flush>
              <DataTable caption="תקבולים" columns={payCols} rows={L.payments.map((r) => ({ ...r, id: r.method }))} empty={<div className="ui-empty">אין תקבולים</div>} />
            </Card>
            <Card title={`החזרים · ${money(L.trial.refunds)}`} flush>
              <DataTable caption="החזרים" columns={payCols} rows={L.refunds.map((r) => ({ ...r, id: r.method }))} empty={<div className="ui-empty">אין החזרים</div>} />
            </Card>
          </div>
          <Card title={`דוח מנהל · ${formatShort(data.date)}`} flush>
            <Flash f={data.flash} />
            <div className="ui-sub" style={{ padding: '8px 14px' }}>מחושב מימים שנסגרו בלבד. תפוסה = חדרים שנמכרו / חדרים זמינים; RevPAR = הכנסות לינה / חדרים זמינים.</div>
          </Card>
        </>
      )}
    </Page>
  );
}
