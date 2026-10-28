// Arrival list facts. No writes, inferred allocations, or guarantee-as-payment shortcuts.
const id = (v) => String(v?._id || v || '');
const cents = (v) => Math.round((Number(v) + Number.EPSILON) * 100);
export function arrivalParty(res, unit, units) {
  const multi = Math.max(Number(res.roomsCount || 1), units.length) > 1;
  const known = (u) => Number.isInteger(u.adults) && u.adults > 0 && Number.isInteger(u.children) && u.children >= 0;
  const source = multi ? unit : res, valid = known({ ...source, children: source.children ?? (multi ? undefined : 0) });
  const complete = units.length >= Number(res.roomsCount || 1) && units.every(known);
  const mismatch = multi && complete && (units.reduce((n, u) => n + u.adults, 0) !== res.adults || units.reduce((n, u) => n + u.children, 0) !== Number(res.children || 0));
  return { scope: valid ? (multi ? 'unit' : 'reservation') : 'unknown', adults: valid ? source.adults : null, children: valid ? Number(source.children || 0) : null,
    bookingAdults: res.adults, bookingChildren: Number(res.children || 0), needsReview: !valid || !!mismatch || (multi && units.length < Number(res.roomsCount || 1)) };
}
export function arrivalPayment(res, unit, units, folios, { shared = false } = {}) {
  const own = !shared && (unit.roomPayer === 'guest' || unit.extrasPayer === 'guest');
  const selected = folios.filter((f) => own ? f.ownerType === 'room' && id(f.ownerRef) === id(unit) : f.ownerType !== 'room');
  const currency = res.currency || 'ILS';
  const monetaryLines = selected.flatMap((f) => (f.lines || []).filter((l) => l.status === 'posted'));
  const validCurrency = /^[A-Z]{3}$/.test(currency);
  let invalid = !validCurrency || selected.some((f) => (f.currency || 'ILS') !== currency) || monetaryLines.some((l) => !Number.isSafeInteger(cents(l.amount)) || !Number.isSafeInteger(cents(l.taxAmount ?? 0)));
  const sum = (types) => monetaryLines.filter((l) => !types || types.includes(l.type)).reduce((s, l) => s + cents(l.amount) + cents(l.taxAmount || 0), 0);
  const received = -sum(['payment', 'deposit']) || 0, refunds = sum(['refund']), net = (received - refunds) || 0;
  invalid ||= ![received, refunds, net, sum()].every(Number.isSafeInteger);
  // A group with self-paying room nights has no documented split of res.totalAmount.
  const allBooker = !own && units.length >= Number(res.roomsCount || 1) && units.every((u) => u.roomPayer !== 'guest');
  const invalidAgreed = allBooker && (!Number.isSafeInteger(cents(res.totalAmount)) || Number(res.totalAmount) < 0);
  const agreed = allBooker && !invalidAgreed ? cents(res.totalAmount) : null;
  const declared = !own ? Math.max(0, Number(res.depositPaid || 0)) : 0;
  const review = invalid || invalidAgreed || (!own && (cents(declared) > net || (res.paymentStatus === 'paid' && (agreed === null || net < agreed))));
  const status = review ? 'review' : agreed === null ? (net > 0 ? 'recorded' : 'unpaid') : agreed === 0 && net === 0 ? 'zero_price' : net > agreed ? 'credit' : net === agreed ? 'paid' : net > 0 ? 'partial' : 'unpaid';
  return { scope: own ? 'unit' : 'shared', currency, status, received: invalid ? null : received / 100, refunds: invalid ? null : refunds / 100,
    netPaid: invalid ? null : net / 100, ledgerBalance: invalid ? null : sum() / 100, agreedTotal: agreed === null || invalid ? null : agreed / 100,
    remainingAgreed: agreed === null || invalid ? null : Math.max(0, agreed - net) / 100, declaredPaid: validCurrency && Number.isFinite(declared) ? declared : null,
    showAmounts: true, note: invalid ? 'נתוני החשבון דורשים בירור: מטבעות שונים או סכום לא תקין' : invalidAgreed ? 'מחיר ההזמנה אינו תקין לחישוב יתרה; מוצגים רק התקבולים והיתרה הרשומה' : review ? 'הצהרת התשלום בהזמנה אינה תואמת לתקבולים הרשומים' : agreed === null ? 'חלוקת מחיר ההזמנה בין המשלמים אינה מתועדת; מוצגת יתרת החשבון הרשומה בלבד' : 'יתרת מחיר ההזמנה מתייחסת למחיר שסוכם בלבד; חיובים וזיכויים נוספים עשויים לשנות את יתרת החשבון' };
}
