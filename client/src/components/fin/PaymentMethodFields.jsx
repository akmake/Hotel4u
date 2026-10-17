// FIN-03: what a receipt must show for each payment method, entered once at the moment the money is
// taken. Shared by every place that records a payment (stay dialog, folio, check-in deposit,
// check-out). The server re-validates everything (financeService.paymentDetails).
//   cash          — amount handed over (optional) → change
//   credit_card   — last 4 digits + approval number from the terminal + installments (never the full number)
//   bank_transfer — transfer reference + value date + payer
//   cheque        — number, bank, branch, account, due date
//   voucher       — voucher number + issuer
import { Field } from '../kit';

export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const onlyDigits = (v, n) => String(v || '').replace(/\D/g, '').slice(0, n);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const CARD_BRANDS = [['', 'לא צוין'], ['visa', 'ויזה'], ['mastercard', 'מאסטרקארד'], ['isracard', 'ישראכרט'], ['amex', 'אמריקן אקספרס'], ['diners', 'דיינרס'], ['other', 'אחר']];

export function emptyDetails(method, today = todayLocal()) {
  if (method === 'bank_transfer') return { reference: '', payDate: today, payerName: '' };
  if (method === 'cheque') return { number: '', bank: '', branch: '', account: '', dueDate: today, payerName: '' };
  if (method === 'credit_card') return { last4: '', approval: '', installments: '1', cardBrand: '' };
  if (method === 'voucher') return { number: '', issuer: '' };
  return { tendered: '' };
}

// Client mirror of the server rules — the reason the submit button is disabled (null = complete).
export function detailsMissing(method, d = {}, amount = 0) {
  if (method === 'credit_card') {
    if (onlyDigits(d.last4, 4).length !== 4) return 'נדרשות 4 הספרות האחרונות של הכרטיס';
    if (!/^[A-Za-z0-9-]{2,20}$/.test(String(d.approval || '').trim())) return 'נדרש מספר אישור מהמסוף';
    const n = Number(d.installments || 1);
    if (!Number.isInteger(n) || n < 1 || n > 36) return 'מספר תשלומים 1–36';
  }
  if (method === 'bank_transfer') {
    if (String(d.reference || '').trim().length < 2) return 'נדרשת אסמכתת ההעברה';
    if (!d.payDate) return 'נדרש תאריך ההעברה';
  }
  if (method === 'cheque') {
    if (onlyDigits(d.number, 12).length < 3) return 'נדרש מספר השיק';
    if (onlyDigits(d.bank, 3).length < 2 || onlyDigits(d.branch, 4).length < 3 || onlyDigits(d.account, 12).length < 4) return 'נדרשים בנק, סניף וחשבון';
    if (!d.dueDate) return 'נדרש תאריך פירעון';
  }
  if (method === 'voucher' && String(d.number || '').trim().length < 2) return 'נדרש מספר השובר';
  if (method === 'cash' && d.tendered !== '' && d.tendered !== undefined && Number(d.tendered) < Number(amount || 0) - 0.005) return 'הסכום שהתקבל קטן מהסכום לרישום';
  return null;
}

export function detailsPayload(method, d = {}) {
  if (method === 'cash') return d.tendered !== '' && d.tendered !== undefined && Number(d.tendered) > 0 ? { tendered: Number(d.tendered) } : {};
  if (method === 'credit_card') return { last4: onlyDigits(d.last4, 4), approval: String(d.approval || '').trim(), installments: Number(d.installments || 1), cardBrand: d.cardBrand || undefined };
  if (method === 'bank_transfer') return { reference: String(d.reference || '').trim(), payDate: d.payDate, payerName: String(d.payerName || '').trim() || undefined };
  if (method === 'cheque') return { number: onlyDigits(d.number, 12), bank: onlyDigits(d.bank, 3), branch: onlyDigits(d.branch, 4), account: onlyDigits(d.account, 12), dueDate: d.dueDate, payerName: String(d.payerName || '').trim() || undefined };
  if (method === 'voucher') return { number: String(d.number || '').trim(), issuer: String(d.issuer || '').trim() || undefined };
  return {};
}

export default function PaymentMethodFields({ idPrefix = 'pm', method, amount, value, onChange, errors = {}, today = todayLocal() }) {
  const d = value || {};
  const set = (k) => (ev) => onChange({ ...d, [k]: ev.target.value });
  const id = (k) => `${idPrefix}-${k}`;
  const inp = (k, props = {}) => <input id={id(k)} className={`input w-full ${errors[k] ? 'is-invalid' : ''}`} value={d[k] ?? ''} onChange={set(k)} autoComplete="off" {...props} />;

  if (method === 'cash') {
    const change = d.tendered !== '' && Number(d.tendered) > 0 ? round2(Number(d.tendered) - Number(amount || 0)) : null;
    return (
      <div className="pm-fields">
        <Field id={id('tendered')} label="התקבל מהאורח" optional hint="למזומן — כדי לחשב עודף" error={errors.tendered}>
          {inp('tendered', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal', dir: 'ltr' })}
        </Field>
        {change !== null && (
          <div className={`pm-change ${change < -0.005 ? 'is-bad' : ''}`} role="status">
            {change < -0.005 ? `חסרים ${Math.abs(change).toFixed(2)} ₪` : <>עודף לאורח <b>{change.toFixed(2)} ₪</b></>}
          </div>
        )}
      </div>
    );
  }
  if (method === 'credit_card') {
    return (
      <div className="pm-fields">
        <Field id={id('last4')} label="4 ספרות אחרונות" required error={errors.last4}>
          {inp('last4', { inputMode: 'numeric', dir: 'ltr', maxLength: 4, placeholder: '••••', onChange: (ev) => onChange({ ...d, last4: onlyDigits(ev.target.value, 4) }) })}
        </Field>
        <Field id={id('approval')} label="מספר אישור" required hint="מהשובר של המסוף" error={errors.approval}>
          {inp('approval', { dir: 'ltr', maxLength: 20 })}
        </Field>
        <Field id={id('inst')} label="תשלומים" error={errors.installments}>
          <input id={id('inst')} type="number" min={1} max={36} step={1} className="input w-full" dir="ltr" value={d.installments ?? '1'} onChange={set('installments')} />
        </Field>
        <Field id={id('brand')} label="סוג כרטיס" optional>
          <select id={id('brand')} className="select w-full" value={d.cardBrand || ''} onChange={set('cardBrand')}>
            {CARD_BRANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <p className="pm-note">רישום עסקה שכבר אושרה במסוף החיצוני. אין להקליד מספר כרטיס מלא או CVV.</p>
      </div>
    );
  }
  if (method === 'bank_transfer') {
    return (
      <div className="pm-fields">
        <Field id={id('ref')} label="אסמכתת העברה" required error={errors.reference}>
          {inp('reference', { dir: 'ltr', maxLength: 40 })}
        </Field>
        <Field id={id('date')} label="תאריך ההעברה" required error={errors.payDate}>
          {inp('payDate', { type: 'date', max: today })}
        </Field>
        <Field id={id('payer')} label="שם המשלם" optional hint="אם שילם מישהו אחר (חברה, קרוב)">
          {inp('payerName', { maxLength: 80 })}
        </Field>
      </div>
    );
  }
  if (method === 'cheque') {
    return (
      <div className="pm-fields">
        <Field id={id('num')} label="מספר שיק" required error={errors.number}>{inp('number', { inputMode: 'numeric', dir: 'ltr', maxLength: 12 })}</Field>
        <Field id={id('bank')} label="בנק" required error={errors.bank}>{inp('bank', { inputMode: 'numeric', dir: 'ltr', maxLength: 3, placeholder: '12' })}</Field>
        <Field id={id('branch')} label="סניף" required error={errors.branch}>{inp('branch', { inputMode: 'numeric', dir: 'ltr', maxLength: 4 })}</Field>
        <Field id={id('acc')} label="חשבון" required error={errors.account}>{inp('account', { inputMode: 'numeric', dir: 'ltr', maxLength: 12 })}</Field>
        <Field id={id('due')} label="תאריך פירעון" required error={errors.dueDate}>{inp('dueDate', { type: 'date' })}</Field>
        <Field id={id('drawer')} label="מושך השיק" optional>{inp('payerName', { maxLength: 80 })}</Field>
      </div>
    );
  }
  if (method === 'voucher') {
    return (
      <div className="pm-fields">
        <Field id={id('vnum')} label="מספר שובר" required error={errors.number}>{inp('number', { dir: 'ltr', maxLength: 40 })}</Field>
        <Field id={id('issuer')} label="מנפיק" optional hint="סוכנות / ספק השובר">{inp('issuer', { maxLength: 80 })}</Field>
      </div>
    );
  }
  return null;
}
