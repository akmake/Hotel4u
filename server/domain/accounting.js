import { createHash } from 'node:crypto';
import { minor, amount } from './money.js';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export const payloadHash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw Object.assign(new Error('תאריך לא תקין'), { status: 422 });
  return value;
}
export function validateJournal(lines) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 500) throw Object.assign(new Error('פקודת יומן מחייבת בין 2 ל־500 שורות'), { status: 422 });
  let debit = 0n, credit = 0n;
  const result = lines.map((l) => {
    const d = minor(l.debit ?? '0'), c = minor(l.credit ?? '0');
    if (!l.accountCode || d < 0n || c < 0n || (d > 0n) === (c > 0n)) throw Object.assign(new Error('כל שורה חייבת סכום חיובי בצד חובה או זכות בלבד'), { status: 422 });
    debit += d; credit += c;
    return { accountCode: String(l.accountCode), debit: amount(d), credit: amount(c), description: String(l.description || '').slice(0, 200) };
  });
  if (debit !== credit) throw Object.assign(new Error('פקודת היומן אינה מאוזנת'), { status: 422 });
  return { lines: result, totalDebit: amount(debit), totalCredit: amount(credit) };
}
export const PAYMENT_TRANSITIONS = {
  created: ['pending', 'failed'], pending: ['authorized', 'captured', 'failed', 'unknown'],
  authorized: ['captured', 'voided', 'unknown'], unknown: ['authorized', 'captured', 'failed', 'voided'],
  captured: ['settled', 'partially_refunded', 'refunded', 'disputed'], settled: ['partially_refunded', 'refunded', 'disputed'],
  partially_refunded: ['partially_refunded', 'refunded', 'disputed'], disputed: ['chargeback', 'captured', 'settled'],
  failed: [], voided: [], refunded: [], chargeback: [],
};
export function assertPaymentTransition(from, to) {
  if (from === to) return;
  if (!PAYMENT_TRANSITIONS[from]?.includes(to)) throw Object.assign(new Error(`מעבר מצב תשלום אסור: ${from} → ${to}`), { status: 409 });
}
