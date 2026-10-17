// Finance dialogs (FIN-02 charge, FIN-03 payment/deposit, FIN-04 refund, FIN-07 credit note).
// Each write carries one operation key per opened dialog, so a double click or a retry after a
// timeout records the action once. The server re-checks every amount and permission.
import { useEffect, useMemo, useState } from 'react';
import { finance } from '../../utils/api';
import { Modal, Field, ErrorBanner, Banner, Spinner, KeyValues, useAction, money, newOpKey } from '../kit';
import { PAY_METHOD_LABELS, REFUND_REASON_LABELS, DOC_TYPE_LABELS } from '../../lib/labels';
import ChargeCodeSelect, { vatPreview } from './ChargeCodeSelect';
import { useChargeCodes } from '../../hooks/useChargeCodes';
import PaymentMethodFields, { emptyDetails, detailsMissing, detailsPayload } from './PaymentMethodFields';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
// The code comes from the property catalogue (G1): it may lock the price, be VAT-free or need a
// manager. Description is optional — the code name is used when it is left empty.
export function ChargeDialog({ open, onClose, propertyId, folio, vatRate = 18, businessDate, onSaved }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [code, setCode] = useState(null);
  const [opKey, setOpKey] = useState('');
  useEffect(() => {
    if (open) { setF({ description: '', quantity: '1', unitPrice: '', serviceDate: businessDate || '' }); setCode(null); setOpKey(newOpKey()); action.reset(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const pick = (c) => {
    setCode(c);
    if (c?.defaultPrice) set('unitPrice')(String(c.defaultPrice));
  };
  const locked = code && code.priceEditable === false;
  const gross = round2(Number(f.quantity || 0) * Number(f.unitPrice || 0));
  const { net, tax, exempt } = vatPreview(gross, code, vatRate);
  const e = action.fields;
  const why = !code ? 'יש לבחור קוד חיוב' : !(gross > 0) ? 'נדרשים כמות ומחיר' : null;
  const submit = () => action.run(async () => {
    const out = await finance.charge(propertyId, folio.id, { description: f.description?.trim() || undefined, department: code.code, quantity: Number(f.quantity), unitPrice: Number(f.unitPrice), serviceDate: f.serviceDate, idempotencyKey: opKey });
    onSaved?.(out);
  });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title="רישום חיוב" subtitle={folio ? `חשבון ${folio.owner}` : ''} footer={<Footer action={action} onClose={onClose} label="רישום חיוב" blockedWhy={why} />}>
      <form id="fin-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <div className="ui-grid-2">
          <Field id="ch-dep" label="קוד חיוב" required error={e.department}>
            <ChargeCodeSelect id="ch-dep" propertyId={propertyId} value={code?.code} onChange={pick} />
          </Field>
          <Field id="ch-desc" label="תיאור" optional hint={code ? `ריק = "${code.name}"` : undefined} error={e.description}>
            <input id="ch-desc" className="input w-full" maxLength={200} value={f.description || ''} onChange={(ev) => set('description')(ev.target.value)} />
          </Field>
          <Field id="ch-qty" label="כמות" required error={e.quantity}>
            <input id="ch-qty" type="number" min="0.01" step="0.01" inputMode="decimal" className="input w-full" value={f.quantity || ''} onChange={(ev) => set('quantity')(ev.target.value)} />
          </Field>
          <Field id="ch-price" label={exempt ? 'מחיר ליחידה (ללא מע״מ)' : 'מחיר ליחידה (כולל מע״מ)'} required error={e.unitPrice} hint={locked ? 'מחיר קבוע לפי הקטלוג' : undefined}>
            <input id="ch-price" type="number" min="0.01" step="0.01" inputMode="decimal" className="input w-full" disabled={locked} value={f.unitPrice || ''} onChange={(ev) => set('unitPrice')(ev.target.value)} />
          </Field>
          <Field id="ch-date" label="מועד שירות" required error={e.serviceDate} hint="נפרד מיום הרישום; לא אחרי היום העסקי">
            <input id="ch-date" type="date" className="input w-full" max={businessDate} value={f.serviceDate || ''} onChange={(ev) => set('serviceDate')(ev.target.value)} />
          </Field>
        </div>
        {code?.postLevel === 'manager' && <Banner tone="info">קוד זה נרשם על ידי מנהל משמרת או כספים.</Banner>}
        {gross > 0 && <KeyValues rows={[['נטו', money(net)], [exempt ? 'מע״מ (קוד פטור)' : `מע״מ ${vatRate}%`, money(tax)], ['סה״כ לחיוב', money(gross)]]} />}
      </form>
    </Modal>
  );
}

// ── FIN-03 ──────────────────────────────────────────────────────────────────
export function PaymentDialog({ open, onClose, propertyId, folio, onSaved }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [details, setDetails] = useState({});
  const [opKey, setOpKey] = useState('');
  const balance = folio?.balance || 0;
  useEffect(() => {
    if (open) {
      setF({ kind: balance > 0.005 ? 'payment' : 'deposit', amount: balance > 0.005 ? balance.toFixed(2) : '', method: 'cash', methodRef: '', note: '' });
      setDetails(emptyDetails('cash'));
      setOpKey(newOpKey()); action.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const setMethod = (m) => { set('method')(m); setDetails(emptyDetails(m)); };
  const { payments: methods } = useChargeCodes(propertyId);
  const active = methods.filter((m) => m.active);
  const options = active.length ? active.map((m) => [m.code, m.name]) : Object.entries(PAY_METHOD_LABELS);
  // A catalogue may ask for a reference on cash too (e.g. a cash-register slip number).
  const cashRef = f.method === 'cash' && !!methods.find((m) => m.code === 'cash')?.requireReference;
  const amt = Number(f.amount || 0);
  const e = action.fields;
  let why = null;
  if (!(amt > 0)) why = 'נדרש סכום';
  else if (f.kind === 'payment' && amt - balance > 0.005) why = balance > 0.005 ? 'גבוה מהיתרה' : 'אין יתרה — בחרו מקדמה';
  else if (!options.some(([v]) => v === f.method)) why = 'יש לבחור אמצעי תשלום פעיל';
  else why = detailsMissing(f.method, details, amt) || (cashRef && (f.methodRef || '').trim().length < 2 ? 'נדרשת אסמכתה' : null);
  const submit = () => action.run(async () => {
    const out = await finance.pay(propertyId, folio.id, { kind: f.kind, amount: amt, method: f.method, details: detailsPayload(f.method, details), methodRef: cashRef ? f.methodRef?.trim() : undefined, note: f.note?.trim() || undefined, idempotencyKey: opKey });
    onSaved?.(out);
  });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={560} title="רישום תשלום" subtitle={folio ? `חשבון ${folio.owner} · יתרה ${money(balance)}` : ''} footer={<Footer action={action} onClose={onClose} label={f.kind === 'deposit' ? 'רישום מקדמה' : 'רישום תשלום'} blockedWhy={why} />}>
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
            <select id="pm-m" className="select w-full" value={f.method} onChange={(ev) => setMethod(ev.target.value)}>
              {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <PaymentMethodFields idPrefix="pmd" method={f.method} amount={amt} value={details} onChange={setDetails} errors={e} />
        <div className="ui-grid-2">
          {cashRef && (
            <Field id="pm-ref" label="אסמכתה" required error={e.methodRef}>
              <input id="pm-ref" className="input w-full" maxLength={80} value={f.methodRef || ''} onChange={(ev) => set('methodRef')(ev.target.value)} />
            </Field>
          )}
          <Field id="pm-note" label="הערה" optional>
            <input id="pm-note" className="input w-full" maxLength={200} value={f.note || ''} onChange={(ev) => set('note')(ev.target.value)} />
          </Field>
        </div>
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
  const [idempotencyKey, setIdempotencyKey] = useState(newOpKey);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setAmount(''); setReason(''); setIdempotencyKey(newOpKey()); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const remaining = doc?.creditable || 0;
  const amt = amount === '' ? remaining : Number(amount);
  const why = useMemo(() => {
    if (!(remaining > 0)) return 'המסמך זוכה במלואו';
    if (!(amt > 0)) return 'נדרש סכום';
    if (amt - remaining > 0.005) return `עד ${money(remaining)}`;
    if (reason.trim().length < 3) return 'נדרשת סיבה';
    return null;
  }, [remaining, amt, reason]);
  const submit = () => action.run(async () => { const out = await finance.creditNote(propertyId, doc.id, { amount: amount === '' ? undefined : amount, reason: reason.trim(), idempotencyKey }); onSaved?.(out); });
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
