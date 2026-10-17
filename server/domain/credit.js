import { minor, amount, divideRounded, distributeMinor, legacyNumber } from './money.js';
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
export function creditLines(original, prior, { creditAmount, selections } = {}) {
  const balances = original.lines.map((l) => ({ line: l, id: String(l._id), net: minor(l.netAmount), tax: minor(l.vatAmount), gross: minor(l.grossAmount) }));
  for (const [field, key] of [['totalNet', 'net'], ['totalVat', 'tax'], ['totalGross', 'gross']]) {
    if (original[field] != null && minor(original[field]) !== balances.reduce((sum, b) => sum + b[key], 0n)) throw fail('סיכומי חשבונית המקור אינם תואמים לשורות; נדרשת בדיקה', 409);
  }
  for (const credit of prior) for (const l of credit.lines) {
    if (!l.sourceInvoiceLineId) throw Object.assign(fail('זיכוי היסטורי ללא קישור לשורת מקור מחייב בדיקה לפני זיכוי נוסף', 409), { code: 'CREDIT_HISTORY_REVIEW_REQUIRED' });
    const b = balances.find((x) => x.id === String(l.sourceInvoiceLineId));
    if (!b) throw fail('שורת מקור בזיכוי הקודם לא נמצאה', 409);
    b.net += minor(l.netAmount); b.tax += minor(l.vatAmount); b.gross += minor(l.grossAmount);
  }
  if (balances.some((b) => b.net < 0n || b.tax < 0n || b.gross < 0n || b.net + b.tax !== b.gross)) throw fail('יתרות שורות המקור דורשות בדיקה', 409);
  let grossCredits;
  if (selections !== undefined) {
    if (!Array.isArray(selections) || !selections.length || creditAmount != null) throw fail('יש לבחור סכום כולל או שורות לזיכוי');
    const seen = new Set();
    grossCredits = balances.map(() => 0n);
    for (const s of selections) {
      if (!s || typeof s !== 'object') throw fail('שורת זיכוי לא תקינה');
      const index = balances.findIndex((b) => b.id === String(s.sourceLineId));
      if (index < 0 || seen.has(index)) throw fail('שורת זיכוי לא תקינה או כפולה');
      seen.add(index);
      const value = minor(s.grossAmount);
      if (value <= 0n || value > balances[index].gross) throw fail('סכום הזיכוי חורג מיתרת השורה');
      grossCredits[index] = value;
    }
  } else {
    const available = balances.reduce((sum, b) => sum + b.gross, 0n);
    if (available <= 0n) throw fail('החשבונית כבר זוכתה במלואה', 409);
    const requested = creditAmount == null ? available : minor(creditAmount);
    if (requested <= 0n || requested > available) throw fail(`ניתן לזכות עד ${amount(available)}`);
    grossCredits = distributeMinor(requested, balances.map((b) => b.gross));
  }
  return balances.flatMap((b, i) => {
    const gross = grossCredits[i]; if (!gross) return [];
    const net = gross === b.gross ? b.net : divideRounded(gross * b.net, b.gross);
    const tax = gross - net;
    if (net > b.net || tax > b.tax) throw fail('הקצאת המס חורגת מיתרת השורה');
    const l = b.line;
    return [{ description: l.description, quantity: 1, unitPrice: legacyNumber(amount(-net)), discountPct: 0,
      netAmount: legacyNumber(amount(-net)), vatAmount: legacyNumber(amount(-tax)), grossAmount: legacyNumber(amount(-gross)),
      vatRate: l.vatRate, serviceDate: l.serviceDate, department: l.department, sourceInvoiceLineId: l._id,
      taxCode: l.taxCode, taxRuleVersion: l.taxRuleVersion,
    }];
  });
}
