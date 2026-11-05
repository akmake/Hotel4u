// Card clearing providers (gap-map item 12). One adapter per provider behind the same functions, chosen
// per property (Property.payments.provider) with the property's own sealed credentials — so every hotel
// that buys the system clears through its own merchant account.
//
// An adapter implements:
//   startCapture({ cfg, sessionToken, returnUrl }) → { url }            the provider's hosted card page
//   finishCapture({ cfg, payload })              → { token, last4, brand, expMonth, expYear, holderName }
//   verify({ cfg, token })                       → { ok, message }      card check (zero / minimal amount)
//   authorize({ cfg, token, amount })            → { ok, ref, approval, message }
//   increment({ cfg, token, ref, amount, total })→ { ok, approval, message }   add to an authorization
//   capture({ cfg, token, ref, amount })         → { ok, ref, approval, message }
//   release({ cfg, ref })                        → { ok }
//   sale({ cfg, token, amount })                 → { ok, ref, approval, message }
//   refund({ cfg, ref, amount })                 → { ok, ref, approval, message }
//
// Only the 'mock' adapter exists today: deterministic test cards, no money moves, refused in production.
// A real provider (CardCom, Tranzila, PayPlus, Grow, Stripe …) is one more adapter in PROVIDERS.
import crypto from 'crypto';
import { open as unseal } from '../utils/secretBox.js';

const rnd = () => crypto.randomBytes(6).toString('hex');
const approval = () => String(100000 + Math.floor(Math.random() * 900000));
const prod = () => process.env.NODE_ENV === 'production';

// Test cards: number → behaviour. Nothing else is accepted, so a real card number never enters the test provider.
export const MOCK_CARDS = {
  '4242424242424242': { brand: 'visa', kind: 'ok', label: 'מאושר תמיד' },
  '5555555555554444': { brand: 'mastercard', kind: 'ok', label: 'מאושר תמיד' },
  '4000000000000002': { brand: 'visa', kind: 'decline', label: 'נדחה תמיד' },
  '4000000000009995': { brand: 'visa', kind: 'limit', label: 'מאושר עד 1,000 ₪ לעסקה / מסגרת' },
};
const LIMIT = 1000;
const kindOf = (token) => String(token || '').split(':')[1] || 'decline';

const mock = {
  name: 'mock', label: 'ספק בדיקה (ללא כסף אמיתי)', credentialFields: [],
  startCapture({ sessionToken, returnUrl }) { return { url: `${returnUrl}?capture=${sessionToken}` }; },
  finishCapture({ payload }) {
    const pan = String(payload?.number || '').replace(/\D/g, '');
    const t = MOCK_CARDS[pan];
    if (!t) throw Object.assign(new Error('בספק הבדיקה מותרים רק כרטיסי בדיקה'), { status: 422, fields: { number: 'כרטיס בדיקה בלבד' } });
    const m = Number(payload?.expMonth); const y = Number(payload?.expYear);
    if (!(m >= 1 && m <= 12) || !(y >= 2024 && y <= 2100)) throw Object.assign(new Error('תוקף לא תקין'), { status: 422, fields: { exp: 'חודש ושנה' } });
    const now = new Date();
    if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) throw Object.assign(new Error('פג תוקף הכרטיס'), { status: 422, fields: { exp: 'פג תוקף' } });
    return { token: `mocktok:${t.kind}:${rnd()}`, last4: pan.slice(-4), brand: t.brand, expMonth: m, expYear: y, holderName: String(payload?.holderName || '').trim().slice(0, 80) || undefined };
  },
  verify({ token }) { return kindOf(token) === 'decline' ? { ok: false, message: 'הכרטיס נדחה (בדיקה)' } : { ok: true, message: 'הכרטיס תקין (בדיקה)' }; },
  authorize({ token, amount }) {
    const k = kindOf(token);
    if (k === 'decline' || (k === 'limit' && amount > LIMIT)) return { ok: false, message: k === 'limit' ? 'אין מסגרת מספקת בכרטיס (בדיקה)' : 'העסקה סורבה (בדיקה)' };
    return { ok: true, ref: `mockauth:${rnd()}`, approval: approval() };
  },
  increment({ token, total }) {
    const k = kindOf(token);
    if (k === 'decline' || (k === 'limit' && total > LIMIT)) return { ok: false, message: 'השלמת המסגרת סורבה (בדיקה)' };
    return { ok: true, approval: approval() };
  },
  capture({ ref }) { return { ok: true, ref: `${ref}:cap:${rnd()}`, approval: approval() }; },
  release() { return { ok: true }; },
  sale({ token, amount }) {
    const k = kindOf(token);
    if (k === 'decline' || (k === 'limit' && amount > LIMIT)) return { ok: false, message: 'העסקה סורבה (בדיקה)' };
    return { ok: true, ref: `mocksale:${rnd()}`, approval: approval() };
  },
  refund({ ref }) { return { ok: true, ref: `${ref}:ref:${rnd()}`, approval: approval() }; },
};

export const PROVIDERS = { mock };
export const providerList = () => Object.values(PROVIDERS).map((p) => ({ name: p.name, label: p.label, credentialFields: p.credentialFields }));

// The property's adapter + its unsealed configuration. Throws 503 when clearing is not available.
export function adapterFor(property) {
  const cfg = property?.payments || { provider: 'mock', mode: 'test' };
  const adapter = PROVIDERS[cfg.provider || 'mock'];
  if (!adapter) throw Object.assign(new Error('ספק הסליקה של הנכס לא מחובר במערכת'), { status: 503, code: 'provider_missing' });
  if (adapter.name === 'mock' && prod()) throw Object.assign(new Error('ספק הבדיקה לא פעיל בייצור — יש לחבר ספק סליקה'), { status: 503, code: 'mock_in_production' });
  let credentials = {};
  if (cfg.credentials) { try { credentials = JSON.parse(unseal(cfg.credentials) || '{}'); } catch { credentials = {}; } }
  return { adapter, cfg: { ...cfg, credentials } };
}
