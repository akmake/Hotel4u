// Voucher — who pays for what. One choice: it opens the payer's window and routes the next
// charges (nights/board, and extras when the payer pays everything). The server re-checks.
import { useEffect, useState } from 'react';
import { booking } from '../../utils/api';
import { Modal, Field, ErrorBanner, Banner, Spinner, useAction } from '../kit';

const EFFECT = {
  agent_all: 'לינה, אירוח ותוספות ינותבו לחשבון המשלם.',
  agent_room: 'לינה ואירוח לחשבון המשלם; תוספות (מסעדה, מיני־בר) נשארות על האורח.',
  deposit: 'לינה ואירוח לחשבון המשלם עד הסכום; מה שמעבר — על האורח.',
  guest_all: 'הכול בחשבון האורח. ה־Voucher נשמר כאסמכתה בלבד.',
};

export default function VoucherDialog({ open, onClose, propertyId, reservation, onDone }) {
  const action = useAction();
  const v = reservation?.voucher;
  const [f, setF] = useState({ type: '', payerId: '', number: '', amount: '' });
  useEffect(() => {
    if (!open || !v) return;
    const cur = v.current;
    setF({ type: cur?.type || 'agent_room', payerId: cur?.payerId || v.payers[0]?.id || '', number: cur?.number || '', amount: cur?.amount ?? '' });
    action.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return null;
  const payer = v.payers.find((p) => p.id === f.payerId);
  const needsPayer = f.type && f.type !== 'guest_all';
  const why = !f.type ? 'יש לבחור חלוקה'
    : needsPayer && !payer ? 'אין סוכן או חברה בהזמנה — יש לשייך קודם'
      : payer?.voucherRequired && !f.number.trim() ? `מספר Voucher חובה אצל ${payer.name}`
        : f.type === 'deposit' && !(Number(f.amount) > 0) ? 'יש לרשום את סכום הסוכן' : null;
  const e = action.fields;
  const submit = () => action.run(async () => {
    await booking.setVoucher(propertyId, reservation.id, { type: f.type, payerId: needsPayer ? f.payerId : undefined, number: f.number.trim() || undefined, amount: f.type === 'deposit' ? Number(f.amount) : undefined });
    onDone?.();
  });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title="Voucher — מי משלם על מה" subtitle={reservation?.confirmationNumber}
      footer={(
        <>
          {why && <span className="ui-foot-note">{why}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
          <button type="submit" form="vc-form" className="btn btn-primary" disabled={action.busy || !!why}>{action.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button>
        </>
      )}>
      <form id="vc-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <Field id="vc-type" label="חלוקה" required error={e.voucherType}>
          <select id="vc-type" className="select w-full" value={f.type} onChange={(ev) => setF((p) => ({ ...p, type: ev.target.value }))}>
            {v.types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
        </Field>
        {needsPayer && v.payers.length > 1 && (
          <Field id="vc-payer" label="מי המשלם" required error={e.voucherPayer} hint="בהזמנה יש גם סוכן וגם חברה">
            <select id="vc-payer" className="select w-full" value={f.payerId} onChange={(ev) => setF((p) => ({ ...p, payerId: ev.target.value }))}>
              {v.payers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role === 'agent' ? 'סוכן' : 'חברה'})</option>)}
            </select>
          </Field>
        )}
        {needsPayer && v.payers.length === 1 && <div className="ui-sub">משלם: {v.payers[0].name} ({v.payers[0].role === 'agent' ? 'סוכן' : 'חברה'})</div>}
        <div className="ui-grid-2">
          <Field id="vc-num" label="מספר Voucher" required={!!payer?.voucherRequired} optional={!payer?.voucherRequired} error={e.voucherNumber}>
            <input id="vc-num" className="input w-full" maxLength={40} value={f.number} onChange={(ev) => setF((p) => ({ ...p, number: ev.target.value }))} />
          </Field>
          {f.type === 'deposit' && (
            <Field id="vc-amt" label="סכום שהסוכן מכסה" required error={e.voucherAmount}>
              <input id="vc-amt" type="number" min="1" step="0.01" className="input w-full" value={f.amount} onChange={(ev) => setF((p) => ({ ...p, amount: ev.target.value }))} />
            </Field>
          )}
        </div>
        {f.type && <Banner tone="info">{EFFECT[f.type]} השינוי חל מעכשיו: מה שכבר נרשם נשאר בחשבון שבו הוא נמצא.</Banner>}
      </form>
    </Modal>
  );
}
