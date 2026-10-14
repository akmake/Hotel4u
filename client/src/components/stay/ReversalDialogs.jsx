// Gap G6 — walking a stay back: reinstate a cancellation / no-show, reverse a check-in, and post a
// late charge after departure. Each dialog loads the server preview first (blockers, money that
// moved, room that was taken) and asks for a reason; the server re-checks everything on submit.
import { useEffect, useState } from 'react';
import { stay } from '../../utils/api';
import ChargeCodeSelect, { vatPreview } from '../fin/ChargeCodeSelect';
import { Modal, Field, ErrorBanner, Banner, Spinner, KeyValues, useAction, useLoader, money, newOpKey } from '../kit';

function Foot({ action, onClose, label, why, danger }) {
  return (
    <>
      {why && <span className="ui-foot-note">{why}</span>}
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
      <button type="submit" form="rv-form" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={action.busy || !!why}>{action.busy ? <><Spinner /> שומר…</> : label}</button>
    </>
  );
}

function Blockers({ list }) {
  if (!list?.length) return null;
  return <Banner tone="error"><ul className="ui-reasons">{list.map((b) => <li key={b} className="is-blocked">{b}</li>)}</ul></Banner>;
}

export function ReinstateDialog({ open, onClose, propertyId, reservation, onDone }) {
  const action = useAction();
  const [reason, setReason] = useState('');
  const pv = useLoader(async () => (open && reservation ? stay.reinstatePreview(propertyId, reservation.id) : null), [open, reservation?.id]);
  useEffect(() => { if (open) { setReason(''); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = pv.data;
  const why = pv.loading ? 'בודק זמינות…' : !p ? 'לא נטען' : !p.allowed ? 'לא ניתן לשחזר' : reason.trim().length < 3 ? 'נדרשת סיבה' : null;
  const submit = () => action.run(async () => { const out = await stay.reinstate(propertyId, reservation.id, reason.trim()); onDone?.(out); });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title={reservation?.status === 'no_show' ? 'שחזור "לא הגיע"' : 'שחזור הזמנה שבוטלה'} subtitle={reservation?.confirmationNumber} footer={<Foot action={action} onClose={onClose} label="שחזור ההזמנה" why={why} />}>
      <form id="rv-form" className="ui-stack" onSubmit={(e) => { e.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={pv.error || action.error} />
        {pv.loading && <div className="ui-empty"><Spinner /> בודק מלאי לכל לילה…</div>}
        {p && <Blockers list={p.blockers} />}
        {p?.allowed && (
          <KeyValues rows={[
            ['מלאי', 'פנוי לכל הלילות — יילקח מחדש'],
            ['מחיר', p.price.note],
            p.roomWarning ? ['חדר', p.roomWarning] : null,
            p.money.refunds ? ['הוחזר לאורח אחרי הביטול', money(p.money.refunds)] : null,
            p.money.creditNotes.length ? ['מסמכי זיכוי שהופקו', p.money.creditNotes.map((c) => `${c.number} (${money(c.gross)})`).join(', ')] : null,
          ]} />
        )}
        {p?.allowed && (p.money.refunds > 0 || p.money.creditNotes.length > 0) && <Banner tone="warn">כסף הוחזר או זוכה אחרי הביטול — השחזור לא משנה את זה. יש לגבות מחדש בחשבון.</Banner>}
        {p?.managerOnly && <Banner tone="info">שחזור "לא הגיע" מותר למנהל משמרת ומעלה.</Banner>}
        <Field id="rv-reason" label="סיבה" required error={action.fields.reason}>
          <input id="rv-reason" className="input w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: האורח הגיע בשתיים בלילה / ביקש לחדש" />
        </Field>
      </form>
    </Modal>
  );
}

export function ReverseCheckInDialog({ open, onClose, propertyId, reservation, onDone }) {
  const action = useAction();
  const [reason, setReason] = useState('');
  const [roomUsed, setRoomUsed] = useState(false);
  const pv = useLoader(async () => (open && reservation ? stay.reverseCheckInPreview(propertyId, reservation.id) : null), [open, reservation?.id]);
  useEffect(() => { if (open) { setReason(''); setRoomUsed(false); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = pv.data;
  const why = pv.loading ? 'בודק…' : !p ? 'לא נטען' : !p.allowed ? 'לא ניתן לבטל כניסה' : reason.trim().length < 3 ? 'נדרשת סיבה' : null;
  const submit = () => action.run(async () => { const out = await stay.reverseCheckIn(propertyId, reservation.id, { reason: reason.trim(), roomUsed }); onDone?.(out); });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={500} title="ביטול כניסה" subtitle={reservation?.confirmationNumber} footer={<Foot action={action} onClose={onClose} label="ביטול הכניסה" why={why} danger />}>
      <form id="rv-form" className="ui-stack" onSubmit={(e) => { e.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={pv.error || action.error} />
        {pv.loading && <div className="ui-empty"><Spinner /> בודק…</div>}
        {p && <Blockers list={p.blockers} />}
        {p?.allowed && (
          <>
            <KeyValues rows={[['יחידות שיחזרו ל"שמורה"', p.units.map((u) => (u.room ? `חדר ${u.room}` : 'ללא חדר')).join(', ') || '—'], ['ההזמנה', 'תחזור ל"מאושרת" — אפשר לבצע כניסה מחדש']]} />
            <label className="ui-check"><input type="checkbox" checked={roomUsed} onChange={(e) => setRoomUsed(e.target.checked)} /><span>האורח השתמש בחדר — לסמן אותו "מלוכלך"</span></label>
            <div className="ui-sub">{p.note}</div>
          </>
        )}
        <Field id="rv-reason" label="סיבה" required error={action.fields.reason}>
          <input id="rv-reason" className="input w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: נכנס לחדר הלא נכון / נרשם בטעות" />
        </Field>
      </form>
    </Modal>
  );
}

export function PostStayChargeDialog({ open, onClose, propertyId, reservation, vatRate = 18, onDone }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [code, setCode] = useState(null);
  const [opKey, setOpKey] = useState('');
  useEffect(() => {
    if (open) { setF({ description: '', quantity: '1', unitPrice: '', serviceDate: reservation?.departureDate || '', reason: '' }); setCode(null); setOpKey(newOpKey()); action.reset(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const gross = Math.round(Number(f.quantity || 0) * Number(f.unitPrice || 0) * 100) / 100;
  const { net, tax, exempt } = vatPreview(gross, code, vatRate);
  const why = !code ? 'יש לבחור קוד חיוב' : !(gross > 0) ? 'נדרשים כמות ומחיר' : (f.reason || '').trim().length < 3 ? 'נדרשת סיבה' : null;
  const submit = () => action.run(async () => {
    const out = await stay.postStayCharge(propertyId, reservation.id, { department: code.code, description: f.description.trim() || undefined, quantity: Number(f.quantity), unitPrice: Number(f.unitPrice), serviceDate: f.serviceDate, reason: f.reason.trim(), idempotencyKey: opKey });
    onDone?.(out);
  });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={540} title="חיוב אחרי יציאה" subtitle={reservation?.confirmationNumber} footer={<Foot action={action} onClose={onClose} label="רישום החיוב" why={why} />}>
      <form id="rv-form" className="ui-stack" onSubmit={(e) => { e.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <Banner tone="info">החיוב נרשם בחשבון נפרד "חיובים אחרי יציאה". מסמכים שכבר הופקו לשהייה לא משתנים. אחרי הגבייה סוגרים את החשבון במסך החשבון.</Banner>
        <div className="ui-grid-2">
          <Field id="ps-code" label="קוד חיוב" required error={action.fields.department}>
            <ChargeCodeSelect id="ps-code" propertyId={propertyId} value={code?.code} onChange={(c) => { setCode(c); if (c?.defaultPrice) set('unitPrice')(String(c.defaultPrice)); }} />
          </Field>
          <Field id="ps-desc" label="תיאור" optional hint={code ? `ריק = "${code.name}"` : undefined}>
            <input id="ps-desc" className="input w-full" maxLength={200} value={f.description || ''} onChange={(e) => set('description')(e.target.value)} />
          </Field>
          <Field id="ps-qty" label="כמות" required error={action.fields.quantity}>
            <input id="ps-qty" type="number" min="0.01" step="0.01" className="input w-full" value={f.quantity || ''} onChange={(e) => set('quantity')(e.target.value)} />
          </Field>
          <Field id="ps-price" label={exempt ? 'מחיר ליחידה (ללא מע״מ)' : 'מחיר ליחידה (כולל מע״מ)'} required error={action.fields.unitPrice}>
            <input id="ps-price" type="number" min="0.01" step="0.01" className="input w-full" disabled={code?.priceEditable === false} value={f.unitPrice || ''} onChange={(e) => set('unitPrice')(e.target.value)} />
          </Field>
          <Field id="ps-date" label="מועד השירות" required error={action.fields.serviceDate} hint="בדרך כלל יום העזיבה">
            <input id="ps-date" type="date" className="input w-full" value={f.serviceDate || ''} onChange={(e) => set('serviceDate')(e.target.value)} />
          </Field>
        </div>
        <Field id="ps-reason" label="סיבה" required error={action.fields.reason}>
          <input id="ps-reason" className="input w-full" maxLength={300} value={f.reason || ''} onChange={(e) => set('reason')(e.target.value)} placeholder="למשל: מיני־בר שנמצא בבדיקת החדר אחרי היציאה" />
        </Field>
        {gross > 0 && <KeyValues rows={[['נטו', money(net)], [exempt ? 'מע״מ (קוד פטור)' : `מע״מ ${vatRate}%`, money(tax)], ['סה״כ', money(gross)]]} />}
      </form>
    </Modal>
  );
}
