/**
 * invoiceTemplate.js
 * מחולל HTML למסמכים ישראליים — RTL, עברית, מתאים להדפסה ולשמירה כ-PDF.
 *
 * mark: 'original' (הדפסה ראשונה של מסמך סופי) | 'copy' (העתק נאמן למקור) |
 *       'pending' (ממתין למספר הקצאה) | 'rejected' (מספר הקצאה סורב).
 * כל ערך שמגיע מהמשתמש עובר escape — שם אורח/חברה לא יכול להזריק HTML למסמך.
 */

import { INVOICE_TYPE_LABELS } from '../models/Invoice.js';

const PAYMENT_MEANS_LABELS = {
  cash:          'מזומן',
  credit_card:   'כרטיס אשראי',
  bank_transfer: 'העברה בנקאית',
  cheque:        'שיק',
  check:         'שיק',
  voucher:       'שובר',
  other:         'אחר',
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmt(num) {
  if (num === null || num === undefined) return '—';
  return Number(num).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}/.test(String(str))) return '—';
  const [y, m, d] = String(str).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function partyBlock(party, title) {
  if (!party) return '';
  return `
    <div class="party-block">
      <div class="party-title">${esc(title)}</div>
      <div class="party-name">${esc(party.legalName || party.name || '')}</div>
      ${party.vatNumber ? `<div>ע.מ. / ח.פ.: <strong>${esc(party.vatNumber)}</strong></div>` : ''}
      ${party.idNumber  ? `<div>ת.ז.: ${esc(party.idNumber)}</div>` : ''}
      ${party.address   ? `<div>${esc(party.address)}${party.city ? `, ${esc(party.city)}` : ''}</div>` : ''}
      ${party.phone     ? `<div>טל׳: ${esc(party.phone)}</div>` : ''}
      ${party.email     ? `<div>${esc(party.email)}</div>` : ''}
    </div>`;
}

// What the receipt must say about each payment (cheque: bank/branch/account/number/due date;
// transfer: reference and date; card: last 4 digits, approval, installments).
function paymentDetail(p) {
  const bits = [];
  if (p.method === 'credit_card') {
    if (p.last4) bits.push(`כרטיס ${esc(p.cardBrand ? `${p.cardBrand} ` : '')}****${esc(p.last4)}`);
    if (p.reference) bits.push(`אישור ${esc(p.reference)}`);
    if (p.installments > 1) bits.push(`${esc(p.installments)} תשלומים`);
  } else if (p.method === 'bank_transfer') {
    if (p.reference) bits.push(`אסמכתה ${esc(p.reference)}`);
    if (p.payerName) bits.push(`משלם: ${esc(p.payerName)}`);
    if (p.bank) bits.push(`בנק ${esc(p.bank)}${p.account ? ` חשבון ${esc(p.account)}` : ''}`);
  } else if (p.method === 'cheque' || p.method === 'check') {
    if (p.reference) bits.push(`שיק ${esc(p.reference)}`);
    if (p.bank) bits.push(`בנק ${esc(p.bank)} סניף ${esc(p.branch || '')} חשבון ${esc(p.account || '')}`);
    if (p.dueDate) bits.push(`פירעון ${fmtDate(p.dueDate)}`);
    if (p.payerName) bits.push(`מושך: ${esc(p.payerName)}`);
  } else if (p.reference) bits.push(esc(p.reference));
  return bits.join(' · ') || '—';
}

const MARKS = {
  original: { text: 'מקור', cls: 'mark-original' },
  copy:     { text: 'העתק נאמן למקור', cls: 'mark-copy' },
  pending:  { text: 'העתק לעיון — ממתין למספר הקצאה', cls: 'mark-warn' },
  email:    { text: 'העתק — נשלח בדוא״ל', cls: 'mark-copy' },
  rejected: { text: 'העתק לעיון — מספר הקצאה סורב', cls: 'mark-warn' },
  external: { text: 'העתק לעיון — המקור במערכת החשבוניות', cls: 'mark-copy' },
  external_sandbox: { text: 'העתק לעיון — מערכת החשבוניות בסביבת בדיקות, ללא תוקף חשבונאי', cls: 'mark-warn' },
};

export function renderInvoiceHtml(invoice, { mark = 'copy' } = {}) {
  const typeLabel    = INVOICE_TYPE_LABELS[invoice.type] || invoice.type;
  const isCreditNote = invoice.type === 'credit_note';
  const isProforma   = invoice.type === 'proforma';
  const isReceipt    = invoice.type === 'receipt';
  const m = MARKS[mark] || MARKS.copy;
  const allocState = invoice.allocationStatus || (invoice.status === 'pending_allocation' ? 'pending' : invoice.allocationNumber ? 'approved' : 'not_required');

  const linesHtml = (invoice.lines || []).map((l, i) => `
    <tr class="${i % 2 === 0 ? 'even' : ''}">
      <td>${esc(l.description || '')}</td>
      <td class="num">${fmtDate(l.serviceDate)}</td>
      <td class="num">${fmt(l.netAmount)}</td>
      <td class="num">${esc(l.vatRate)}%</td>
      <td class="num">${fmt(l.vatAmount)}</td>
      <td class="num bold">${fmt(l.grossAmount)}</td>
    </tr>`).join('');

  const paymentsHtml = (invoice.payments || []).length ? `
    <div class="section-title">פירוט התקבולים</div>
    <table class="payments-table">
      <thead><tr><th>אמצעי תשלום</th><th>פרטים</th><th>תאריך</th><th class="num">סכום</th></tr></thead>
      <tbody>
        ${invoice.payments.map((p) => `
          <tr>
            <td>${p.isRefund || p.amount < 0 ? 'החזר — ' : ''}${esc(PAYMENT_MEANS_LABELS[p.method] || p.method)}</td>
            <td>${paymentDetail(p)}</td>
            <td>${fmtDate(p.paymentDate || (p.paidAt ? new Date(p.paidAt).toISOString() : ''))}</td>
            <td class="num">${fmt(p.amount)} ₪</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '';

  const relatedInvoiceNote = invoice.relatedInvoiceId ? `
    <div class="related-note">
      מסמך זה מתייחס ל${esc(INVOICE_TYPE_LABELS[invoice.relatedInvoiceId.type] || 'חשבונית')} מס׳ <strong>${esc(invoice.relatedInvoiceId.invoiceNumber || '')}</strong>
      מתאריך ${fmtDate(invoice.relatedInvoiceId.issueDate)}
    </div>` : '';

  let allocationBlock = '';
  if (allocState === 'approved' && invoice.allocationNumber) {
    allocationBlock = `<div class="allocation-block">מספר הקצאה: <strong>${esc(invoice.allocationNumber)}</strong></div>`;
  } else if (allocState === 'pending') {
    allocationBlock = '<div class="allocation-block pending">ממתין למספר הקצאה מרשות המסים — אין לנכות מס תשומות על סמך מסמך זה עד שיתקבל המספר.</div>';
  } else if (allocState === 'rejected' && invoice.allocationDecision === 'continue') {
    // ITA §2.2.2 second alternative: printed prominently on an invoice issued without a number.
    allocationBlock = '<div class="allocation-block pending" style="font-size:14px;font-weight:bold">אין לנכות מס תשומות בגין חשבונית זו</div>';
  } else if (allocState === 'rejected') {
    allocationBlock = `<div class="allocation-block pending">בקשת מספר ההקצאה סורבה${invoice.allocationRejectReason ? `: ${esc(invoice.allocationRejectReason)}` : ''}. אין לנכות מס תשומות על סמך מסמך זה.</div>`;
  }

  const totalsHtml = isReceipt ? `
      <tr class="grand"><td class="label">${invoice.amountPaid < 0 ? 'סה״כ הוחזר:' : 'סה״כ התקבל:'}</td><td class="amount">${fmt(invoice.amountPaid)} ₪</td></tr>` : `
      <tr><td class="label">סה״כ לפני מע״מ:</td><td class="amount">${fmt(invoice.totalNet)} ₪</td></tr>
      <tr><td class="label">מע״מ:</td><td class="amount">${fmt(invoice.totalVat)} ₪</td></tr>
      <tr class="grand"><td class="label">סה״כ כולל מע״מ:</td><td class="amount">${fmt(invoice.totalGross)} ₪</td></tr>
      ${invoice.amountPaid > 0 ? `<tr><td class="label">שולם:</td><td class="amount">${fmt(invoice.amountPaid)} ₪</td></tr>` : ''}
      ${!isCreditNote && Math.abs(Number(invoice.balance || 0)) > 0.005 ? `<tr><td class="label">יתרה לתשלום:</td><td class="amount">${fmt(invoice.balance)} ₪</td></tr>` : ''}`;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(typeLabel)} ${esc(invoice.invoiceNumber || '')}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', 'Arial Hebrew', Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; direction: rtl; padding: 20px; }
    .page { max-width: 210mm; margin: 0 auto; padding: 20px 24px; border: 1px solid #e0e0e0; border-radius: 4px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; }
    .doc-title { font-size: 22px; font-weight: bold; color: #0f3d3e; }
    .doc-number { font-size: 15px; font-weight: bold; margin-top: 4px; color: #333; }
    .mark { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; border: 1.5px solid; }
    .mark-original { color: #0f3d3e; border-color: #0f3d3e; }
    .mark-copy { color: #555; border-color: #999; }
    .mark-warn { color: #8a5a00; border-color: #d4a017; background: #fff8e1; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 18px; font-size: 12px; color: #444; }
    .meta-grid .label { color: #777; margin-left: 4px; }
    .parties { display: flex; gap: 16px; margin-bottom: 20px; }
    .party-block { flex: 1; border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; background: #fafafa; }
    .party-title { font-size: 11px; color: #777; margin-bottom: 6px; }
    .party-name { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
    .party-block div { margin-bottom: 2px; line-height: 1.5; }
    .section-title { font-size: 12px; font-weight: bold; margin: 6px 0; }
    .items-table, .payments-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 12px; }
    .items-table th { background: #0f3d3e; color: #fff; padding: 7px 8px; text-align: right; font-weight: 600; font-size: 11px; }
    .payments-table th { background: #f0f0f0; padding: 6px 8px; text-align: right; }
    .items-table td, .payments-table td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .items-table tr.even td { background: #f9f9f9; }
    .num { text-align: left; } .bold { font-weight: bold; }
    .totals-block { display: flex; justify-content: flex-end; margin-bottom: 18px; }
    .totals-table { border-collapse: collapse; font-size: 13px; min-width: 240px; }
    .totals-table td { padding: 5px 12px; }
    .totals-table .label { color: #555; text-align: right; }
    .totals-table .amount { text-align: left; font-weight: 500; }
    .totals-table .grand td { font-size: 15px; font-weight: bold; border-top: 2px solid #0f3d3e; color: #0f3d3e; }
    .notes-block { background: #f9f9f9; border-right: 3px solid #0f3d3e; padding: 10px 14px; margin-bottom: 18px; font-size: 12px; color: #444; }
    .related-note { font-size: 12px; color: #555; margin-bottom: 12px; padding: 8px; background: #fffbea; border: 1px solid #ffe082; border-radius: 4px; }
    .allocation-block { font-size: 12px; color: #333; margin-bottom: 12px; padding: 8px 12px; background: #eaf6f4; border: 1px solid #b9ddd7; border-radius: 4px; }
    .allocation-block.pending { background: #fff3cd; border-color: #ffc107; color: #7a5200; }
    .footer { margin-top: 28px; border-top: 1px solid #e0e0e0; padding-top: 12px; text-align: center; font-size: 11px; color: #888; }
    @media print { body { padding: 0; } .page { border: none; max-width: 100%; } }
    ${isCreditNote ? '.doc-title { color: #b42318; }' : ''}
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="doc-title">${esc(typeLabel)}</div>
      <div class="doc-number">מס׳ ${esc(invoice.invoiceNumber || '')}</div>
      ${isProforma ? '<div style="color:#b45309;font-size:12px;margin-top:4px">חשבון עסקה — אינו חשבונית מס</div>' : ''}
    </div>
    <div style="text-align:left">
      <div class="mark ${m.cls}">${esc(m.text)}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div><span class="label">תאריך הפקה:</span>${fmtDate(invoice.issueDate)}</div>
    ${isReceipt ? '' : `<div><span class="label">מועד השירות:</span>${fmtDate(invoice.serviceDate)}</div>`}
    ${invoice.reservation?.confirmationNumber ? `<div><span class="label">הזמנה:</span>${esc(invoice.reservation.confirmationNumber)}</div>` : ''}
    ${invoice.reservation?.arrivalDate ? `<div><span class="label">שהייה:</span>${fmtDate(invoice.reservation.arrivalDate)} – ${fmtDate(invoice.reservation.departureDate)}</div>` : ''}
  </div>

  ${relatedInvoiceNote}
  ${allocationBlock}

  <div class="parties">
    ${partyBlock(invoice.seller, 'פרטי העסק')}
    ${invoice.buyer ? partyBlock(invoice.buyer, isReceipt ? 'התקבל מאת' : 'לכבוד') : ''}
  </div>

  ${(invoice.lines || []).length ? `
  <table class="items-table">
    <thead>
      <tr><th>תיאור</th><th class="num">תאריך</th><th class="num">לפני מע״מ</th><th class="num">מע״מ %</th><th class="num">מע״מ</th><th class="num">סה״כ</th></tr>
    </thead>
    <tbody>${linesHtml}</tbody>
  </table>` : ''}

  ${paymentsHtml}

  <div class="totals-block">
    <table class="totals-table">${totalsHtml}</table>
  </div>

  ${invoice.notes ? `<div class="notes-block"><strong>הערות:</strong> ${esc(invoice.notes)}</div>` : ''}

  <div class="footer">
    ${esc(invoice.seller?.name || '')}${invoice.seller?.vatNumber ? ` · ע.מ. ${esc(invoice.seller.vatNumber)}` : ''}${invoice.seller?.address ? ` · ${esc(invoice.seller.address)}${invoice.seller?.city ? `, ${esc(invoice.seller.city)}` : ''}` : ''}${invoice.seller?.phone ? ` · ${esc(invoice.seller.phone)}` : ''}
    <div>מסמך ממוחשב</div>
  </div>
</div>
<script>
  if (window.location.search.includes('print=1')) { window.onload = () => window.print(); }
</script>
</body>
</html>`;
}
