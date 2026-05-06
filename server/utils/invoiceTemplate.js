/**
 * invoiceTemplate.js
 * מחולל HTML לחשבוניות ישראליות — RTL, עברית, מתאים להדפסה ולשמירה כ-PDF.
 *
 * הלקוח יכול לפתוח את ה-URL של /html ולהדפיס עם Ctrl+P,
 * או להשתמש ב-window.open(url).print() מתוך React.
 */

import { INVOICE_TYPE_LABELS } from '../models/Invoice.js';

const PAYMENT_MEANS_LABELS = {
  cash:          'מזומן',
  credit_card:   'כרטיס אשראי',
  bank_transfer: 'העברה בנקאית',
  check:         'המחאה',
  voucher:       'שובר',
  other:         'אחר',
};

function fmt(num) {
  if (num === null || num === undefined) return '—';
  return Number(num).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(str) {
  if (!str) return '—';
  // YYYY-MM-DD → DD/MM/YYYY
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function partyBlock(party, title) {
  if (!party) return '';
  return `
    <div class="party-block">
      <div class="party-title">${title}</div>
      <div class="party-name">${party.legalName || party.name || ''}</div>
      ${party.vatNumber ? `<div>מס' עוסק: <strong>${party.vatNumber}</strong></div>` : ''}
      ${party.idNumber  ? `<div>ת.ז: ${party.idNumber}</div>` : ''}
      ${party.address   ? `<div>${party.address}${party.city ? `, ${party.city}` : ''}</div>` : ''}
      ${party.phone     ? `<div>טל': ${party.phone}</div>` : ''}
      ${party.email     ? `<div>${party.email}</div>` : ''}
    </div>`;
}

function statusBadge(invoice) {
  if (invoice.status === 'cancelled') return '<span class="badge cancelled">מבוטלת</span>';
  if (invoice.status === 'pending_allocation') return '<span class="badge pending">ממתינה למספר הקצאה</span>';
  return '';
}

export function renderInvoiceHtml(invoice) {
  const typeLabel   = INVOICE_TYPE_LABELS[invoice.type] || invoice.type;
  const isCreditNote = invoice.type === 'credit_note';
  const isProforma   = invoice.type === 'proforma';

  const linesHtml = (invoice.lines || []).map((l, i) => `
    <tr class="${i % 2 === 0 ? 'even' : ''}">
      <td>${l.description || ''}</td>
      <td class="num">${fmt(l.quantity)}</td>
      <td class="num">${fmt(l.unitPrice)}</td>
      <td class="num">${l.discountPct ? `${l.discountPct}%` : '—'}</td>
      <td class="num">${fmt(l.netAmount)}</td>
      <td class="num">${l.vatRate}%</td>
      <td class="num">${fmt(l.vatAmount)}</td>
      <td class="num bold">${fmt(l.grossAmount)}</td>
    </tr>`).join('');

  const paymentsHtml = (invoice.payments || []).length ? `
    <table class="payments-table">
      <thead><tr><th>אמצעי תשלום</th><th>אסמכתא</th><th>סכום</th></tr></thead>
      <tbody>
        ${invoice.payments.map(p => `
          <tr>
            <td>${PAYMENT_MEANS_LABELS[p.method] || p.method}</td>
            <td>${p.reference || '—'}</td>
            <td class="num">${fmt(p.amount)} ₪</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '';

  const relatedInvoiceNote = invoice.relatedInvoiceId ? `
    <div class="related-note">
      מסמך זה מתייחס לחשבונית מס' <strong>${invoice.relatedInvoiceId.invoiceNumber || ''}</strong>
      מתאריך ${fmtDate(invoice.relatedInvoiceId.issueDate)}
    </div>` : '';

  const allocationBlock = invoice.allocationNumber ? `
    <div class="allocation-block">
      מספר הקצאה: <strong>${invoice.allocationNumber}</strong>
    </div>` : (invoice.requiresAllocation ? `
    <div class="allocation-block pending">
      <em>ממתין למספר הקצאה מרשות המסים</em>
    </div>` : '');

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${typeLabel} מס' ${invoice.invoiceNumber || 'טיוטה'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', 'Arial Hebrew', Arial, sans-serif;
      font-size: 13px;
      color: #1a1a1a;
      background: #fff;
      direction: rtl;
      padding: 20px;
    }
    .page {
      max-width: 210mm;
      margin: 0 auto;
      padding: 20px 24px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
    }
    /* ── כותרת ──────────────────────────────────── */
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .doc-title { font-size: 24px; font-weight: bold; color: #0a3d62; }
    .doc-number { font-size: 15px; font-weight: bold; margin-top: 4px; color: #333; }
    .logo-placeholder { color: #888; font-size: 12px; text-align: left; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; }
    .badge.cancelled { background: #fdecea; color: #c0392b; }
    .badge.pending   { background: #fff3cd; color: #856404; }
    /* ── פרטי מסמך ─────────────────────────────── */
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 20px; font-size: 12px; color: #444; }
    .meta-grid .label { color: #777; margin-left: 4px; }
    /* ── צדדים ──────────────────────────────────── */
    .parties { display: flex; gap: 24px; margin-bottom: 24px; }
    .party-block { flex: 1; border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; background: #fafafa; }
    .party-title { font-size: 11px; color: #777; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    .party-name { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
    .party-block div { margin-bottom: 2px; line-height: 1.5; }
    /* ── טבלת פריטים ────────────────────────────── */
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    .items-table th { background: #0a3d62; color: #fff; padding: 7px 8px; text-align: right; font-weight: 600; font-size: 11px; }
    .items-table td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .items-table tr.even td { background: #f9f9f9; }
    .items-table .num { text-align: left; }
    .items-table .bold { font-weight: bold; }
    /* ── סיכום ──────────────────────────────────── */
    .totals-block { display: flex; justify-content: flex-end; margin-bottom: 20px; }
    .totals-table { border-collapse: collapse; font-size: 13px; min-width: 220px; }
    .totals-table td { padding: 5px 12px; }
    .totals-table .label { color: #555; text-align: right; }
    .totals-table .amount { text-align: left; font-weight: 500; }
    .totals-table .grand { font-size: 15px; font-weight: bold; border-top: 2px solid #0a3d62; color: #0a3d62; }
    /* ── תשלומים ────────────────────────────────── */
    .payments-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    .payments-table th { background: #f0f0f0; padding: 6px 8px; text-align: right; }
    .payments-table td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }
    .payments-table .num { text-align: left; }
    /* ── הערות ──────────────────────────────────── */
    .notes-block { background: #f9f9f9; border-right: 3px solid #0a3d62; padding: 10px 14px; margin-bottom: 20px; font-size: 12px; color: #444; }
    .related-note { font-size: 12px; color: #555; margin-bottom: 12px; padding: 8px; background: #fffbea; border: 1px solid #ffe082; border-radius: 4px; }
    .allocation-block { font-size: 12px; color: #333; margin-bottom: 12px; padding: 8px 12px; background: #eaf6fb; border: 1px solid #bee3f8; border-radius: 4px; }
    .allocation-block.pending { background: #fff3cd; border-color: #ffc107; color: #856404; }
    /* ── כותרת תחתונה ───────────────────────────── */
    .footer { margin-top: 32px; border-top: 1px solid #e0e0e0; padding-top: 12px; text-align: center; font-size: 11px; color: #999; }
    .original-mark { text-align: center; font-size: 11px; color: #aaa; margin-top: 8px; }
    /* ── הדפסה ──────────────────────────────────── */
    @media print {
      body { padding: 0; }
      .page { border: none; max-width: 100%; }
      .no-print { display: none; }
    }
    ${isCreditNote ? '.doc-title { color: #c0392b; }' : ''}
  </style>
</head>
<body>
<div class="page">

  <!-- כותרת -->
  <div class="header">
    <div>
      <div class="doc-title">${typeLabel} ${statusBadge(invoice)}</div>
      <div class="doc-number">
        מס' ${invoice.invoiceNumber || '<em>טיוטה</em>'}
        ${isProforma ? '<span style="color:#e67e22;font-size:11px;margin-right:8px">מסמך זה אינו חשבונית מס לצורכי מע"מ</span>' : ''}
      </div>
    </div>
    <div class="logo-placeholder">${invoice.seller?.name || ''}</div>
  </div>

  <!-- פרטי מסמך -->
  <div class="meta-grid">
    <div><span class="label">תאריך הנפקה:</span>${fmtDate(invoice.issueDate)}</div>
    <div><span class="label">תאריך מס:</span>${fmtDate(invoice.taxDate)}</div>
    <div><span class="label">תאריך שירות:</span>${fmtDate(invoice.serviceDate)}</div>
    <div><span class="label">מטבע:</span>${invoice.currency || 'ILS'}</div>
    ${invoice.reservation?.confirmationNumber
      ? `<div><span class="label">מס' הזמנה:</span>${invoice.reservation.confirmationNumber}</div>`
      : ''}
  </div>

  ${relatedInvoiceNote}
  ${allocationBlock}

  <!-- מוכר / קונה -->
  <div class="parties">
    ${partyBlock(invoice.seller, 'פרטי המוציא')}
    ${invoice.buyer ? partyBlock(invoice.buyer, 'פרטי הקונה') : '<div class="party-block" style="background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px;">עסקה ישירה (B2C)</div>'}
  </div>

  <!-- פריטים -->
  <table class="items-table">
    <thead>
      <tr>
        <th>תיאור</th>
        <th class="num">כמות</th>
        <th class="num">מחיר יח' (נטו)</th>
        <th class="num">הנחה</th>
        <th class="num">סכום נטו</th>
        <th class="num">מע"מ%</th>
        <th class="num">סכום מע"מ</th>
        <th class="num">סה"כ</th>
      </tr>
    </thead>
    <tbody>
      ${linesHtml}
    </tbody>
  </table>

  <!-- סיכום -->
  <div class="totals-block">
    <table class="totals-table">
      ${invoice.totalDiscount > 0
        ? `<tr><td class="label">הנחה:</td><td class="amount">${fmt(invoice.totalDiscount)} ₪</td></tr>`
        : ''}
      <tr><td class="label">סה"כ נטו:</td><td class="amount">${fmt(invoice.totalNet)} ₪</td></tr>
      <tr><td class="label">מע"מ (${invoice.vatRate}%):</td><td class="amount">${fmt(invoice.totalVat)} ₪</td></tr>
      <tr class="grand">
        <td class="label">סה"כ לתשלום:</td>
        <td class="amount">${fmt(invoice.totalGross)} ₪</td>
      </tr>
      ${invoice.amountPaid > 0
        ? `<tr><td class="label">שולם:</td><td class="amount">${fmt(invoice.amountPaid)} ₪</td></tr>`
        : ''}
      ${invoice.balance && invoice.balance !== invoice.totalGross
        ? `<tr><td class="label">יתרה:</td><td class="amount" style="color:${invoice.balance > 0 ? '#c0392b' : '#27ae60'}">${fmt(invoice.balance)} ₪</td></tr>`
        : ''}
    </table>
  </div>

  <!-- תשלומים -->
  ${invoice.payments?.length ? `<div style="font-size:12px;font-weight:bold;margin-bottom:6px;">פירוט תשלומים:</div>${paymentsHtml}` : ''}

  <!-- הערות -->
  ${invoice.notes ? `<div class="notes-block"><strong>הערות:</strong> ${invoice.notes}</div>` : ''}

  <!-- כותרת תחתונה -->
  <div class="footer">
    ${invoice.seller?.name || ''} | ${invoice.seller?.vatNumber ? `מס' עוסק: ${invoice.seller.vatNumber}` : ''}
    ${invoice.seller?.address || ''} | ${invoice.seller?.phone || ''} | ${invoice.seller?.email || ''}
  </div>
  <div class="original-mark">מסמך ממוחשב — מקור</div>

</div>
<script>
  // הדפסה אוטומטית אם נדרש
  if (window.location.search.includes('print=1')) {
    window.onload = () => window.print();
  }
</script>
</body>
</html>`;
}
