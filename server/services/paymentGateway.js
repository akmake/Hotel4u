// Payment provider for the public booking site. The guest pays on the provider's hosted page; we keep
// no card data. One interface: createSession → where to send the guest; verify → what happened.
//
// Providers: 'mock' only, for development and tests — no money moves and it refuses to run in
// production. A real Israeli clearing provider (owner's choice: CardCom / Tranzila / Grow / PayPlus …)
// is added here behind the same two functions; until then the site cannot take payments in production.
import crypto from 'crypto';

export function providerName() {
  return String(process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
}

export function paymentsAvailable() {
  const p = providerName();
  if (p === 'mock') return process.env.NODE_ENV !== 'production';
  return false; // no real provider wired yet
}

export function isTestMode() {
  return providerName() === 'mock';
}

const clientBase = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');

export async function createSession({ token }) {
  if (!paymentsAvailable()) throw Object.assign(new Error('תשלום מקוון אינו זמין כרגע'), { status: 503, code: 'payments_unavailable' });
  if (providerName() === 'mock') {
    return { providerRef: `mock_${crypto.randomBytes(6).toString('hex')}`, redirectUrl: `${clientBase()}/book/pay/${token}` };
  }
  throw Object.assign(new Error('ספק תשלום לא מוגדר'), { status: 503 });
}

// → { paid: true, last4, approval, cardBrand, installments } | { paid: false, reason } | { pending: true }
export async function verify(session) {
  if (session.provider === 'mock') {
    if (process.env.NODE_ENV === 'production') return { paid: false, reason: 'ספק בדיקה אינו פעיל בייצור' };
    if (!session.mock?.outcome) return { pending: true };
    if (session.mock.outcome !== 'approve') return { paid: false, reason: 'העסקה סורבה (בדיקה)' };
    return { paid: true, last4: '4242', approval: String(100000 + Math.floor(Math.random() * 900000)), cardBrand: 'visa', installments: 1 };
  }
  return { paid: false, reason: 'ספק תשלום לא מוכר' };
}
