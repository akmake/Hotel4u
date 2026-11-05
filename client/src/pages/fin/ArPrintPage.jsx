// Statements / reminders as they were sent (gap-map item 7): one A4 page per letter, from the stored
// snapshot — a reprint shows exactly what the company received. Print or save as PDF from the browser.
import { useSearchParams } from 'react-router-dom';
import { useProperty } from '../../context/PropertyContext';
import { finance } from '../../utils/api';
import { PAY_METHOD_LABELS } from '../../lib/labels';
import { Page, ErrorBanner, Spinner, Empty, useLoader, money } from '../../components/kit';
import { he } from '../../components/fin/ArDialogs';

export default function ArPrintPage() {
  const [params] = useSearchParams();
  const ids = params.get('letters') || '';
  const { propertyId } = useProperty();
  const { data, loading, error, reload } = useLoader(async () => (propertyId && ids ? finance.arLetters(propertyId, ids) : null), [propertyId, ids]);
  const first = data?.[0];
  return (
    <Page wide title={data?.length > 1 ? `${data.length} מכתבים להדפסה` : first ? `${first.kind === 'reminder' ? 'תזכורת' : 'דף חשבון'} — ${first.snapshot?.account?.name || ''}` : 'הדפסה'}
      back={first?.snapshot ? '/pms/fin/receivables' : '/pms/fin/receivables'}
      primary={data?.length > 0 && <button type="button" className="btn btn-primary btn-sm no-print" onClick={() => window.print()}>הדפסה / PDF</button>}>
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && !data.length && <Empty title="לא נמצאו מכתבים" />}
      {data?.map((l, i) => <Letter key={l.id} l={l} last={i === data.length - 1} />)}
    </Page>
  );
}

function Letter({ l, last }) {
  const s = l.snapshot || {};
  const title = l.kind === 'reminder' ? `תזכורת תשלום${l.level > 1 ? ` — שלב ${l.level}` : ''}` : 'דף חשבון';
  const debts = s.debts || [];
  return (
    <article className={`ops-doc ar-letter ${last ? '' : 'ops-break'}`} aria-label={`${title} ${s.account?.name || ''}`}>
      <header className="ops-doc-head">
        <div>
          <div className="ops-doc-hotel">{s.property?.name}{s.property?.taxNumber ? ` · ע.מ./ח.פ. ${s.property.taxNumber}` : ''}</div>
          <div className="ops-doc-hotel">{[s.property?.address, s.property?.phone, s.property?.email].filter(Boolean).join(' · ')}</div>
          <h2>{title}</h2>
          <div className="ops-doc-sub">{s.from ? `לתקופה ${he(s.from)}–${he(s.to)}` : `נכון ל־${he(s.to || s.issuedOn)}`}</div>
        </div>
        <div className="ops-doc-meta">הופק {he(s.issuedOn)} · {l.byName}{l.via === 'email' ? ` · נשלח ל־${l.email}` : ''}</div>
      </header>
      <section className="ops-doc-section ar-letter-to">
        <div><b>לכבוד:</b> {s.account?.name}{s.account?.taxId ? ` · ח.פ. ${s.account.taxId}` : ''}</div>
        {s.account?.billing?.name && <div>לידי {s.account.billing.name}</div>}
        {s.account?.billing?.address && <div>{s.account.billing.address}</div>}
        <div>מספר חשבון: <b>{s.account?.number}</b> · תנאי תשלום: {s.account?.termsLabel}</div>
      </section>
      {s.text && <p className="ar-letter-text">{s.text}</p>}
      <section className="ops-doc-section">
        <h3>{l.kind === 'reminder' ? 'חובות שעברו את מועד התשלום' : 'חובות'}</h3>
        {!debts.length ? <p className="ops-doc-empty">אין חובות לתקופה.</p> : (
          <table className="ops-table">
            <thead><tr><th>תאריך</th><th>מספר</th><th>אורח / תיאור</th><th>סכום</th><th>שולם</th><th>יתרה</th><th>לתשלום עד</th></tr></thead>
            <tbody>
              {debts.map((d) => (
                <tr key={d.folioId} className={d.overdueDays > 0 ? 'is-alert' : ''}>
                  <td>{he(d.date)}</td><td>{d.number}</td><td>{d.guest || ''}</td><td>{money(d.charged)}</td><td>{d.paid ? money(d.paid) : ''}</td><td>{money(d.balance)}</td>
                  <td>{he(d.dueDate)}{d.overdueDays > 0 ? ` (${d.overdueDays} ימי איחור)` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {l.kind === 'statement' && s.payments?.length > 0 && (
        <section className="ops-doc-section">
          <h3>תשלומים שהתקבלו</h3>
          <table className="ops-table">
            <thead><tr><th>תאריך</th><th>סכום</th><th>אמצעי</th><th>אסמכתה</th><th>שויך ל</th></tr></thead>
            <tbody>{s.payments.map((p, i) => <tr key={i}><td>{he(p.date)}</td><td>{money(p.amount)}</td><td>{PAY_METHOD_LABELS[p.method] || p.method || ''}</td><td>{p.methodRef || ''}</td><td>{p.where}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      {s.copies && Object.keys(s.copies).length > 0 && (
        <section className="ops-doc-section">
          <h3>פירוט החשבונות</h3>
          {debts.filter((d) => s.copies[d.folioId]).map((d) => (
            <div key={d.folioId} className="ar-copy">
              <b>{d.number}{d.guest ? ` · ${d.guest}` : ''}</b>
              <table className="ops-table"><tbody>{s.copies[d.folioId].map((c, i) => <tr key={i}><td>{he(c.date)}</td><td>{c.description}</td><td>{money(c.gross)}</td></tr>)}</tbody></table>
            </div>
          ))}
        </section>
      )}
      <section className="ar-letter-total">
        {s.summary?.unapplied > 0 && <div>זיכוי על החשבון: {money(s.summary.unapplied)}</div>}
        <div className="ar-letter-sum">יתרה לתשלום: {money(s.summary?.total)}</div>
        {s.summary?.overdue > 0 && <div>מתוכה באיחור: {money(s.summary.overdue)}</div>}
      </section>
      <p className="ops-doc-note">קבלה על התשלום תופק עם קבלתו. לבירורים: {s.property?.phone || s.property?.email || 'הנהלת החשבונות'}.</p>
    </article>
  );
}
