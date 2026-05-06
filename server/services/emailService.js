/**
 * emailService.js
 *
 * Sends transactional emails via nodemailer.
 * Provider: Gmail SMTP (EMAIL_USER / EMAIL_PASS) by default.
 * Override with EMAIL_HOST / EMAIL_PORT for SendGrid or any SMTP relay.
 *
 * Usage:
 *   import { sendEmail, buildReservationConfirmationEmail } from './emailService.js';
 *   await sendEmail({ to: 'guest@example.com', subject: '...', html: '...' });
 */

import nodemailer from 'nodemailer';

// ── Transport singleton ───────────────────────────────────────────────────────

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT) || (host ? 587 : 465);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    console.warn('[emailService] EMAIL_USER / EMAIL_PASS not set — email sending disabled');
    return null;
  }

  _transporter = nodemailer.createTransport(
    host
      ? { host, port, secure: port === 465, auth: { user, pass } }
      : {
          service: 'gmail',
          auth: { user, pass },
        },
  );

  return _transporter;
}

export const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@hotel4u.app';
export const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Hotel4U';

// ── Core send ─────────────────────────────────────────────────────────────────

/**
 * @param {{ to: string|string[], subject: string, html?: string, text?: string, replyTo?: string }} params
 */
export async function sendEmail({ to, subject, html, text, replyTo }) {
  const transport = getTransporter();
  if (!transport) {
    console.warn(`[emailService] Skipped email to ${to}: no transport configured`);
    return null;
  }

  const info = await transport.sendMail({
    from:    `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
    to:      Array.isArray(to) ? to.join(', ') : to,
    subject,
    html:    html || undefined,
    text:    text || (html ? undefined : subject),
    replyTo: replyTo || undefined,
  });

  return info;
}

// ── HTML wrapper ──────────────────────────────────────────────────────────────

function baseTemplate({ title, preheader, body, footer, accentColor = '#2563eb' }) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;direction:rtl;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:${accentColor};padding:28px 32px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${title}</h1>
      ${preheader ? `<p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">${preheader}</p>` : ''}
    </div>
    <!-- Body -->
    <div style="padding:32px;">${body}</div>
    <!-- Footer -->
    <div style="background:#f1f5f9;padding:16px 32px;font-size:12px;color:#94a3b8;text-align:center;">
      ${footer || 'Hotel4U &bull; מערכת ניהול מלון'}
    </div>
  </div>
</body>
</html>`;
}

function row(label, value) {
  return `<tr>
    <td style="padding:6px 0;color:#64748b;font-size:14px;width:40%;">${label}</td>
    <td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:600;">${value || '—'}</td>
  </tr>`;
}

// ── Email templates ───────────────────────────────────────────────────────────

export function buildReservationConfirmationEmail({ guestName, confirmationNumber, arrivalDate, departureDate, roomType, nights, totalAmount, currency, propertyName, propertyPhone, propertyEmail }) {
  const cur = currency || 'ILS';
  const amount = totalAmount != null ? `${Number(totalAmount).toLocaleString('he-IL')} ${cur}` : '—';

  const body = `
    <p style="font-size:16px;color:#1e293b;margin:0 0 20px;">שלום ${guestName || 'אורח יקר'},</p>
    <p style="color:#475569;margin:0 0 24px;">הזמנתך ב<strong>${propertyName || 'המלון'}</strong> אושרה. מצורף אישור ההזמנה.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      ${row('מספר אישור',  confirmationNumber)}
      ${row('סוג חדר',      roomType)}
      ${row('תאריך הגעה',   arrivalDate)}
      ${row('תאריך עזיבה',  departureDate)}
      ${row('מספר לילות',   nights)}
      ${row('סכום כולל',    amount)}
    </table>
    ${propertyPhone || propertyEmail ? `
    <p style="color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:0;">
      לפרטים נוספים:
      ${propertyPhone ? `<a href="tel:${propertyPhone}" style="color:#2563eb;">${propertyPhone}</a>` : ''}
      ${propertyPhone && propertyEmail ? ' &bull; ' : ''}
      ${propertyEmail ? `<a href="mailto:${propertyEmail}" style="color:#2563eb;">${propertyEmail}</a>` : ''}
    </p>` : ''}
  `;

  const html = baseTemplate({
    title:    `אישור הזמנה #${confirmationNumber}`,
    preheader: `${arrivalDate} — ${departureDate} | ${roomType || ''}`,
    body,
    footer:   propertyName || 'Hotel4U',
  });

  return {
    subject: `אישור הזמנה #${confirmationNumber} — ${propertyName || 'המלון'}`,
    html,
    text: `אישור הזמנה #${confirmationNumber}\nהגעה: ${arrivalDate}\nעזיבה: ${departureDate}\nחדר: ${roomType}\nסכום: ${amount}`,
  };
}

export function buildCheckInReminderEmail({ guestName, confirmationNumber, arrivalDate, propertyName, propertyAddress, checkInTime }) {
  const body = `
    <p style="font-size:16px;color:#1e293b;margin:0 0 20px;">שלום ${guestName || 'אורח יקר'},</p>
    <p style="color:#475569;margin:0 0 24px;">מחכים לך ב<strong>${propertyName || 'המלון'}</strong> מחר!</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      ${row('מספר אישור', confirmationNumber)}
      ${row('תאריך הגעה', arrivalDate)}
      ${checkInTime ? row('שעת צ׳ק-אין', checkInTime) : ''}
      ${propertyAddress ? row('כתובת', propertyAddress) : ''}
    </table>
  `;
  const html = baseTemplate({
    title:    `נתראה מחר! — ${propertyName || 'המלון'}`,
    preheader: `תזכורת: הגעה מחר ${arrivalDate}`,
    body,
    footer:   propertyName || 'Hotel4U',
    accentColor: '#059669',
  });
  return {
    subject: `תזכורת הגעה מחר — ${propertyName || 'המלון'}`,
    html,
    text: `תזכורת: הגעתך מחר ${arrivalDate} ל${propertyName}`,
  };
}

export function buildPaymentLinkEmail({ guestName, confirmationNumber, amount, currency, paymentLink, expiresAt, propertyName }) {
  const cur  = currency || 'ILS';
  const amtStr = amount != null ? `${Number(amount).toLocaleString('he-IL')} ${cur}` : '';
  const body = `
    <p style="font-size:16px;color:#1e293b;margin:0 0 20px;">שלום ${guestName || 'אורח יקר'},</p>
    <p style="color:#475569;margin:0 0 8px;">לתשלום עבור הזמנה <strong>#${confirmationNumber}</strong>${amtStr ? ` בסך <strong>${amtStr}</strong>` : ''}, אנא לחץ על הכפתור:</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${paymentLink}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700;display:inline-block;">לתשלום מאובטח</a>
    </div>
    ${expiresAt ? `<p style="color:#94a3b8;font-size:12px;text-align:center;">הקישור בתוקף עד ${expiresAt}</p>` : ''}
  `;
  const html = baseTemplate({
    title:    `קישור תשלום — ${propertyName || 'המלון'}`,
    preheader: amtStr ? `סכום לתשלום: ${amtStr}` : 'קישור לתשלום מאובטח',
    body,
    footer:   propertyName || 'Hotel4U',
    accentColor: '#7c3aed',
  });
  return {
    subject: `קישור תשלום — הזמנה #${confirmationNumber}`,
    html,
    text: `קישור תשלום: ${paymentLink}`,
  };
}

export function buildGenericEmail({ guestName, subject, message, propertyName }) {
  const body = `
    ${guestName ? `<p style="font-size:16px;color:#1e293b;margin:0 0 20px;">שלום ${guestName},</p>` : ''}
    <div style="color:#475569;line-height:1.7;">${message || ''}</div>
  `;
  const html = baseTemplate({
    title:    subject,
    body,
    footer:   propertyName || 'Hotel4U',
  });
  return { subject, html, text: message || subject };
}
