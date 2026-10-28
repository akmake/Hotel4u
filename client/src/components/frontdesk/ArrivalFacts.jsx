import { Tag, money } from '../kit';
import { Baby, User } from 'lucide-react';

const statuses = { review: 'לבירור', paid: 'מחיר ההזמנה שולם', partial: 'שולם חלקית', unpaid: 'אין תשלום נטו רשום', recorded: 'נרשם תשלום', credit: 'תקבולים מעל מחיר ההזמנה', zero_price: 'מחיר ההזמנה אפס' };
function PaymentSummary({ summary }) {
  if (!summary) return null;
  const shared = summary.scope === 'shared';
  if (!summary.showAmounts) return <div className="ui-sub">חשבון משותף להזמנה — הסכומים מוצגים פעם אחת ברשימה זו</div>;
  return <div className="ui-stack" style={{ gap: 3, minWidth: 180, maxWidth: 260 }}>
    <div className="ui-sub">{shared ? 'חשבון המזמין / ההזמנה' : 'חשבון יחידה זו'}</div>
    <div><Tag tone={summary.status === 'review' ? 'warn' : summary.status === 'paid' ? 'good' : undefined}>{statuses[summary.status] || 'לבירור'}</Tag></div>
    {summary.netPaid !== null && <div>תקבולים נטו: <bdi className="ui-num">{money(summary.netPaid, summary.currency)}</bdi></div>}
    {summary.refunds > 0 && <div className="ui-sub">כולל החזר של <bdi>{money(summary.refunds, summary.currency)}</bdi></div>}
    {summary.remainingAgreed !== null && <div>יתרת מחיר הזמנה: <bdi className="ui-num">{money(summary.remainingAgreed, summary.currency)}</bdi></div>}
    {summary.remainingAgreed === null && summary.ledgerBalance !== null && <div>יתרת חשבון רשומה: <bdi className="ui-num">{money(summary.ledgerBalance, summary.currency)}</bdi></div>}
    {summary.declaredPaid > 0 && summary.status === 'review' && <div className="ui-sub">מקדמה שהוצהרה בהזמנה: <bdi>{money(summary.declaredPaid, summary.currency)}</bdi></div>}
    <details><summary className="ui-link">הסבר הסכומים</summary><div className="ui-sub" style={{ whiteSpace: 'normal' }}>{summary.note} היתרה הרשומה עשויה להיות זכות ממקדמה; לינות עתידיות אינן בהכרח מחויבות עדיין.</div>
      {summary.remainingAgreed !== null && summary.ledgerBalance !== null && <div className="ui-sub">יתרת חשבון רשומה: <bdi>{money(summary.ledgerBalance, summary.currency)}</bdi></div>}
    </details>
  </div>;
}
export function ArrivalPaymentInfo({ row }) {
  if (!row.payment) return <span className="ui-sub">מידע כספי מוגבל לפי תפקיד</span>;
  return <div className="ui-stack" style={{ gap: 8 }}><PaymentSummary summary={row.payment} /><PaymentSummary summary={row.sharedPayment} /></div>;
}
export function ArrivalPartyInfo({ row }) {
  const known = Number.isInteger(row.adults) && Number.isInteger(row.children);
  return <>
    {known ? <>
      <span className="ui-mini" title="מבוגרים ביחידה"><User size={11} aria-hidden="true" />{row.adults}<span className="sr-only"> מבוגרים</span></span>
      <span className="ui-mini" title="ילדים ביחידה"><Baby size={11} aria-hidden="true" />{row.children}<span className="sr-only"> ילדים</span></span>
    </> : <span className="ui-sub">לא הוזן הרכב ליחידה</span>}
    {row.party?.needsReview && <span className="ui-tag is-warn">הרכב לבירור</span>}
  </>;
}
export function ArrivalPreparationInfo({ row, onCribs }) {
  const notes = [row.specialRequests && ['בקשה בהזמנה', row.specialRequests], row.unitNotes && ['הערה ליחידה', row.unitNotes]].filter(Boolean);
  return <div style={{ minWidth: 150, maxWidth: 260, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
    <div className="ui-sub">{row.cribs?.requested === null || row.cribs?.requested === undefined ? 'לולים: לא מתועד' : `לולים: התבקשו ${row.cribs.requested} · נמסרו וטרם הוחזרו ${row.cribs.delivered}`}</div>
    {row.cribs?.status === 'collection_required' && <Tag tone="warn">נדרש איסוף / בירור</Tag>}
    {onCribs && <button type="button" className="ui-link" onClick={onCribs} disabled={!row.unitId} title={!row.unitId ? 'תחילה השלימו שיבוץ יחידה' : undefined}>ניהול לולים</button>}
    {notes.length ? <details><summary className="ui-link">הערות מיוחדות ({notes.length})</summary>
      {notes.map(([label, text]) => <div key={label} style={{ marginTop: 6 }}><strong>{label}: </strong><span style={{ whiteSpace: 'pre-wrap' }}>{text}</span></div>)}
    </details> : <div className="ui-sub">אין הערות גלויות</div>}
  </div>;
}
