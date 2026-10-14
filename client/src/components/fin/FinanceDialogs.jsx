// Finance dialogs (FIN-02 charge, FIN-03 payment/deposit, FIN-04 refund, FIN-07 credit note).
// Each write carries one operation key per opened dialog, so a double click or a retry after a
// timeout records the action once. The server re-checks every amount and permission.
import { useEffect, useMemo, useState } from 'react';
import { finance } from '../../utils/api';
import { Modal, Field, ErrorBanner, Banner, Spinner, KeyValues, useAction, money, newOpKey } from '../kit';
import { CHARGE_DEPARTMENT_LABELS, PAY_METHOD_LABELS, REFUND_REASON_LABELS, DOC_TYPE_LABELS } from '../../lib/labels';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const REF_REQUIRED = ['bank_transfer', 'cheque', 'voucher'];

function Footer({ action, onClose, label, blockedWhy, danger }) {
  return (
    <>
      {blockedWhy && <span className="ui-foot-note">{blockedWhy}</span>}
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
      <button type="submit" form="fin-form" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={action.busy || !!blockedWhy}>
        {action.busy ? <><Spinner /> שומר…</> : label}
      </button>
    </>
  );
}

// ── FIN-02 ──────────────────────────────────────────────────────────────────
export function ChargeDialog({ open, onClose, propertyId, folio, vatRate = 18, businessDate, onSaved }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [opKey, setOpKey] = useState('');
  useEffect(() => {
    if (open) { setF({ description: '', department: '', quantity: '1', unitPrice: '', serviceDate: businessDate || '' }); setOpKey(newOpKey()); action.reset(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const gross = round2(Number(f.quantity || 0) * Number(f.unitPrice || 0));
  const net = round2(gross / (1 + Number(vatRate) / 100));
  const e = action.fields;
  const why = !f.description?.trim() ? 'נדרש תיאור' : !f.department ? 'יש לבחור קוד שירות' : !(gross > 0) ? 'נדרשים כמות ומחיר' : null;
  const submit = () => action.run(async () => {
    const out = await finance.charge(propertyId, folio.id, { ...f, quantity: Number(f.quantity), unitPrice: Number(f.unitPrice), idempotencyKey: opKey });
    onSaved?.(out);
  });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title="רישום חיוב" subtitle={folio ? `חשבון ${folio.owner}` : ''} footer={<Footer action={action} onClose={onClose} label="רישום חיוב" blockedWhy={why} />}>
      <form id="fin-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <div className="ui-grid-2">
          <Field id="ch-desc" label="תיאור" required error={e.description}>
            <input id="ch-desc" className="input w-full" maxLength={200} value={f.description || ''} onChange={(ev) => set('description')(ev.target.value)} />
          </Field>
          <Field id="ch-dep" label="קוד שירות" required error={e.department}>
            <select id="ch-dep" className="select w-full" value={f.department || ''} onChange={(ev) => set('department')(ev.target.value)}>
              <option value="">בחירה…</option>
              {Object.entries(CHARGE_DEPARTMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field id="ch-qty" label="כמות" required error={e.quantity}>
            <input id="ch-qty" type="number" min="0.01" step="0.01" inputMode="decimal" className="input w-full" value={f.quantity || ''} onChange={(ev) => set('quantity')(ev.target.value)} />
          </Field>
          <Field id="ch-price" label="מחיר ליחידה (כולל מע״מ)" required error={e.unitPrice}>
            <input id="ch-price" type="number" min="0.01" step="0.01" inputMode="decimal" className="input w-full" value={f.unitPrice || ''} onChange={(ev) => set('unitPrice')(ev.target.value)} />
          </Field>
          <Field id="ch-date" label="מועד שירות" required error={e.serviceDate} hint="נפרד מיום הרישום; לא אחרי היום העסקי">
            <input id="ch-date" type="date" className="input w-full" max={businessDate} value={f.serviceDate || ''} onChange={(ev) => set('serviceDate')(ev.target.value)} />
          </Field>
        </div>
        {gross > 0 && <KeyValues rows={[['נטו', money(net)], [`מע״מ ${vatRate}%`, money(round2(gross - net))], ['סה״כ לחיוב', money(gross)]]} />}
      </form>
    </Modal>
  );
}

// ── FIN-03 ──────────────────────────────────────────────────────────────────
export function PaymentDialog({ open, onClose, propertyId, folio, onSaved }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [opKey, setOpKey] = useState('');
  const balance = folio?.balance || 0;
  useEffect(() => {
    if (open) {
      setF({ kind: balance > 0.005 ? 'payment' : 'deposit', amount: balance > 0.005 ? balance.toFixed(2) : '', method: 'cash', methodRef: '', note: '' });
      setOpKey(newOpKey()); action.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const amt = Number(f.amount || 0);
  const e = action.fields;
  let why = null;
  if (!(amt > 0)) why = 'נדרש סכום';
  else if (f.kind === 'payment' && amt - balance > 0.005) why = balance > 0.005 ? 'גבוה מהיתרה' : 'אין יתרה — בחרו מקדמה';
  else if (REF_REQUIRED.includes(f.method) && (f.methodRef || '').trim().length < 2) why = 'נדרשת אסמכתה';
  const submit = () => action.run(async () => {
    const out = await finance.pay(propertyId, folio.id, { kind: f.kind, amount: amt, method: f.method, methodRef: f.methodRef?.trim() || undefined, note: f.note?.trim() || undefined, idempotencyKey: opKey });
    onSaved?.(out);
  });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={500} title="רישום תשלום" subtitle={folio ? `חשבון ${folio.owner} · יתרה ${money(balance)}` : ''} footer={<Footer action={action} onClose={onClose} label={f.kind === 'deposit' ? 'רישום מקדמה' : 'רישום תשלום'} blockedWhy={why} />}>
      <form id="fin-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
          <legend className="ui-label">סוג</legend>
          <label className="ui-radio"><input type="radio" name="kind" checked={f.kind === 'payment'} onChange={() => set('kind')('payment')} /><span>תשלום על חשבון<span className="ui-sub" style={{ display: 'block' }}>עד גובה היתרה</span></span></label>
          <label className="ui-radio"><input type="radio" name="kind" checked={f.kind === 'deposit'} onChange={() => set('kind')('deposit')} /><span>מקדמה<span className="ui-sub" style={{ display: 'block' }}>תשלום מראש, עד עלות השהייה</span></span></label>
        </fieldset>
        <div className="ui-grid-2">
          <Field id="pm-amt" label="סכום" required error={e.amount}>
            <input id="pm-amt" type="number" min="0.01" step="0.01" inputMode="decimal" className="input w-full" value={f.amount || ''} onChange={(ev) => set('amount')(ev.target.value)} />
          </Field>
          <Field id="pm-m" label="אמצעי" required error={e.method}>
            <select id="pm-m" className="select w-full" value={f.method} onChange={(ev) => set('method')(ev.target.value)}>
              {Object.entries(PAY_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {REF_REQUIRED.includes(f.method) && (
            <Field id="pm-ref" label="אסמכתה" required error={e.methodRef}>
              <input id="pm-ref" className="input w-full" maxLength={80} value={f.methodRef || ''} onChange={(ev) => set('methodRef')(ev.target.value)} />
            </Field>
          )}
          <Field id="pm-note" label="הערה" optional>
            <input id="pm-note" className="input w-full" maxLength={200} value={f.note || ''} onChange={(ev) => set('note')(ev.target.value)} />
          </Field>
        </div>
        {f.method === 'credit_card' && <Banner tone="info">אין חיבור לסולק: רושמים כאן עסקה שכבר אושרה במסוף החיצוני. אין להקליד מספר כרטיס או CVV.</Banner>}
      </form>
    </Modal>
  );
}

// ── FIN-04 ──────────────────────────────────────────────────────────────────
export function RefundDialog({ open, onClose, propertyId, folio, payment, canApprove, threshold = 0, onSaved }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [opKey, setOpKey] = useState('');
  const credit = folio ? Math.max(0, -folio.balance) : 0;
  const max = payment ? round2(Math.min(payment.refundable || 0, credit)) : 0;
  useEffect(() => { if (open) { setF({ amount: max > 0 ? max.toFixed(2) : '', reasonCode: '', note: '' }); setOpKey(newOpKey()); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const amt = Number(f.amount || 0);
  let why = null;
  if (!(max > 0)) why = credit <= 0 ? 'אין יתרת זכות בחשבון' : 'התשלום הוחזר במלואו';
  else if (!(amt > 0)) why = 'נדרש סכום';
  else if (amt - max > 0.005) why = `עד ${money(max)}`;
  else if (!f.reasonCode) why = 'יש לבחור סיבה';
  else if (f.reasonCode === 'other' && (f.note || '').trim().length < 3) why = 'יש לפרט סיבה';
  else if (amt > threshold && !canApprove) why = 'מחייב מנהל או כספים';
  const submit = () => action.run(async () => { const out = await finance.refund(propertyId, folio.id, payment.id, { amount: amt, reasonCode: f.reasonCode, note: f.note?.trim() || undefined, idempotencyKey: opKey }); onSaved?.(out); });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={500} title="החזר תשלום" subtitle={payment ? payment.description : ''} footer={<Footer action={action} onClose={onClose} label="אישור החזר" blockedWhy={why} danger />}>
      <form id="fin-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        {payment && <KeyValues rows={[['תשלום מקור', money(Math.abs(payment.gross))], ['ניתן להחזיר מתשלום זה', money(payment.refundable)], ['יתרת זכות בחשבון', money(credit)], ['אמצעי החזר', PAY_METHOD_LABELS[payment.method] || 'האמצעי המקורי']]} />}
        <Field id="rf-amt" label="סכום להחזר" required error={action.fields.amount}>
          <input id="rf-amt" type="number" min="0.01" step="0.01" max={max} inputMode="decimal" className="input w-full" value={f.amount || ''} onChange={(ev) => set('amount')(ev.target.value)} />
        </Field>
        <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
          <legend className="ui-label">סיבה · חובה</legend>
          {Object.entries(REFUND_REASON_LABELS).map(([v, l]) => <label key={v} className="ui-radio"><input type="radio" name="rf-reason" checked={f.reasonCode === v} onChange={() => set('reasonCode')(v)} /><span>{l}</span></label>)}
        </fieldset>
        <Field id="rf-note" label="פירוט" required={f.reasonCode === 'other'} optional={f.reasonCode !== 'other'} error={action.fields.note}>
          <input id="rf-note" className="input w-full" maxLength={300} value={f.note || ''} onChange={(ev) => set('note')(ev.target.value)} />
        </Field>
        {!canApprove && <Banner tone="info">{threshold > 0 ? `החזר עד ${money(threshold)} מותר לך; מעל זה נדרש מנהל או כספים.` : 'החזר כספי מבוצע על ידי מנהל או כספים.'}</Banner>}
        <Banner tone="info">ההחזר נרשם בחשבון. ההעברה בפועל מתבצעת באמצעי המקורי (מסוף/בנק) — אין חיבור לספק.</Banner>
      </form>
    </Modal>
  );
}

// ── FIN-07 ──────────────────────────────────────────────────────────────────
export function CreditNoteDialog({ open, onClose, propertyId, doc, onSaved }) {
  const action = useAction();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setAmount(''); setReason(''); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const remaining = doc?.creditable || 0;
  const amt = amount === '' ? remaining : Number(amount);
  const why = useMemo(() => {
    if (!(remaining > 0)) return 'המסמך זוכה במלואו';
    if (!(amt > 0)) return 'נדרש סכום';
    if (amt - remaining > 0.005) return `עד ${money(remaining)}`;
    if (reason.trim().length < 3) return 'נדרשת סיבה';
    return null;
  }, [remaining, amt, reason]);
  const submit = () => action.run(async () => { const out = await finance.creditNote(propertyId, doc.id, { amount: amount === '' ? undefined : Number(amount), reason: reason.trim() }); onSaved?.(out); });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={480} title="מסמך זיכוי" subtitle={doc ? `${DOC_TYPE_LABELS[doc.type] || doc.type} ${doc.number}` : ''} footer={<Footer action={action} onClose={onClose} label="הפקת מסמך זיכוי" blockedWhy={why} danger />}>
      <form id="fin-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        {doc && <KeyValues rows={[['סכום המסמך', money(doc.gross)], ['זוכה עד כה', money(doc.credited)], ['ניתן לזכות', money(remaining)]]} />}
        <Field id="cn-amt" label="סכום לזיכוי" optional hint="ריק = יתרת המסמך המלאה">
          <input id="cn-amt" type="number" min="0.01" step="0.01" max={remaining} inputMode="decimal" className="input w-full" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder={remaining.toFixed(2)} />
        </Field>
        <Field id="cn-reason" label="סיבת הזיכוי" required error={action.fields.reason}>
          <input id="cn-reason" className="input w-full" maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
        <Banner tone="info">המסמך המקורי לא משתנה. מסמך הזיכוי מקבל מספר נפרד ומקושר אליו. החזר כסף הוא פעולה נפרדת.</Banner>
      </form>
    </Modal>
  );
}
