/**
 * smsService.js
 *
 * Sends SMS via Twilio REST API (no SDK — plain fetch).
 * Required env vars:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER   (e.g. +15005550006)
 *
 * Usage:
 *   import { sendSms } from './smsService.js';
 *   await sendSms({ to: '+972501234567', body: 'אישור הזמנה...' });
 */

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

function isTwilioConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN  &&
    process.env.TWILIO_FROM_NUMBER
  );
}

/**
 * @param {{ to: string, body: string }} params
 * @returns {Promise<object|null>}
 */
export async function sendSms({ to, body }) {
  if (!isTwilioConfigured()) {
    console.warn(`[smsService] Twilio not configured — skipped SMS to ${to}`);
    return null;
  }

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(`${TWILIO_API}/Accounts/${sid}/Messages.json`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      Authorization:   'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Twilio error ${res.status}: ${data?.message || JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Build a short reservation confirmation SMS text.
 */
export function buildReservationConfirmationSms({ confirmationNumber, guestName, arrivalDate, departureDate, propertyName }) {
  const name = guestName ? `${guestName}, ` : '';
  return `${name}הזמנה #${confirmationNumber} ב${propertyName || 'המלון'} אושרה. הגעה: ${arrivalDate}, עזיבה: ${departureDate}. תודה!`;
}

/**
 * Build a check-in reminder SMS.
 */
export function buildCheckInReminderSms({ confirmationNumber, arrivalDate, propertyName, propertyAddress }) {
  return `תזכורת: הגעתך מחר ${arrivalDate} ל${propertyName || 'המלון'}${propertyAddress ? ` (${propertyAddress})` : ''}. הזמנה #${confirmationNumber}`;
}

/**
 * Build a payment link SMS.
 */
export function buildPaymentLinkSms({ confirmationNumber, amount, currency, paymentLink }) {
  const amtStr = amount != null ? ` — ${Number(amount).toLocaleString('he-IL')} ${currency || 'ILS'}` : '';
  return `קישור תשלום עבור הזמנה #${confirmationNumber}${amtStr}: ${paymentLink}`;
}
