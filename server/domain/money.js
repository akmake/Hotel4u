// Exact decimal arithmetic. Only the legacy adapter at the boundary returns Numbers.
export const ROUNDING_POLICY = 'ILS_HALF_AWAY_FROM_ZERO_LINE_V1';
export function decimal(value) {
  const text = String(value ?? '').trim();
  if (!/^-?\d{1,18}(\.\d{1,8})?$/.test(text)) throw Object.assign(new Error('סכום עשרוני לא תקין'), { status: 422 });
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  return { n: BigInt(whole + fraction) * (negative ? -1n : 1n), d: 10n ** BigInt(fraction.length) };
}
export function divideRounded(n, d) {
  if (d <= 0n) throw new Error('Positive denominator required');
  const sign = n < 0n ? -1n : 1n;
  const abs = n * sign;
  return sign * (abs / d + ((abs % d) * 2n >= d ? 1n : 0n));
}
export function minor(value) { const { n, d } = decimal(value); return divideRounded(n * 100n, d); }
export function amount(cents) {
  const n = BigInt(cents); const abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
export function sumMoney(values) { return amount(values.reduce((sum, v) => sum + minor(v), 0n)); }
export function legacyNumber(value) {
  const cents = minor(value);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) throw Object.assign(new Error('סכום גדול מדי לממשק הישן'), { status: 422 });
  return Number(cents) / 100;
}
export function calculateLine({ unitPrice, quantity = '1', discountPct = '0', vatRate, pricesIncludeVat = false }) {
  const p = decimal(unitPrice), q = decimal(quantity), disc = decimal(discountPct), rate = decimal(vatRate);
  if (q.n <= 0n || disc.n < 0n || disc.n > 100n * disc.d || rate.n < 0n || rate.n > 100n * rate.d) throw Object.assign(new Error('כמות, הנחה או שיעור מס לא תקינים'), { status: 422 });
  const baseN = p.n * q.n * (100n * disc.d - disc.n);
  const baseD = p.d * q.d * 100n * disc.d;
  let net, tax, gross;
  if (pricesIncludeVat) {
    gross = divideRounded(baseN * 100n, baseD);
    net = divideRounded(gross * 100n * rate.d, 100n * rate.d + rate.n);
    tax = gross - net;
  } else {
    net = divideRounded(baseN * 100n, baseD);
    tax = divideRounded(net * rate.n, 100n * rate.d);
    gross = net + tax;
  }
  return { net: amount(net), tax: amount(tax), gross: amount(gross), discount: amount(divideRounded(p.n * q.n * disc.n * 100n, p.d * q.d * 100n * disc.d)), roundingPolicy: ROUNDING_POLICY };
}

// Largest-remainder allocation conserves every agora; ties follow stable source order.
export function distributeMinor(total, weights) {
  total = BigInt(total); weights = weights.map(BigInt);
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (total < 0n || weights.some((w) => w < 0n) || total > sum) throw Object.assign(new Error('סכום חלוקה לא תקין'), { status: 422 });
  if (!sum) return weights.map(() => 0n);
  const result = weights.map((w) => total * w / sum);
  const order = weights.map((w, i) => ({ i, rest: total * w % sum })).sort((a, b) => a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1);
  const remainder = total - result.reduce((a, b) => a + b, 0n);
  for (let i = 0; i < Number(remainder); i += 1) result[order[i].i] += 1n;
  return result;
}
