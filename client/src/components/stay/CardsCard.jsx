// Card on the stay (gap-map item 12): the guest's cards (token + last 4 only), card check, the authorization
// ("מסגרת") against what the stay may still cost, charge a folio to the card and refund to the same card.
import { useEffect, useState } from 'react';
import { cards } from '../../utils/api';
import { Modal, Field, ErrorBanner, Banner, Spinner, useAction, useLoader, money } from '../kit';
import { formatShort } from '../../utils/date';

const BRAND = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', isracard: 'ישראכרט', diners: 'Diners', other: 'כרטיס' };
const KIND = { capture: 'חיוב מהמסגרת', sale: 'חיוב', refund: 'החזר' };
const REASONS = { overpayment: 'תשלום עודף', cancellation: 'ביטול', complaint: 'תלונה', other: 'אחר' };
const label = (c) => `${BRAND[c.brand] || 'כרטיס'} ••${c.last4}`;

function AddCardDialog({ open, onClose, propertyId, reservationId, onDone }) {
  const act = useAction();
  const [session, setSession] = useState(null);
  const [f, setF] = useState({ number: '', expMonth: '', expYear: '', holderName: '' });
  useEffect(() => {
    if (!open) return;
    act.reset(); setSession(null); setF({ number: '', expMonth: '', expYear: '', holderName: '' });
    act.run(async () => setSession(await cards.startCapture(propertyId, { reservation: reservationId, returnUrl: `${window.location.origin}/pms/card-capture` })));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const mock = session?.provider === 'mock';
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = () => act.run(async () => { await cards.finishCapture(propertyId, session.sessionToken, { ...f, expMonth: Number(f.expMonth), expYear: Number(f.expYear) }); onDone('הכרטיס נשמר (טוקן וארבע ספרות בלבד)'); });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={480} title="הוספת כרטיס" subtitle="המספר עובר לספק הסליקה. במערכת נשמרים רק טוקן וארבע ספרות אחרונות"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button>{mock && <button type="button" className="btn btn-primary" onClick={submit} disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button>}</>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        {!session && !act.error && <Spinner />}
        {session && !mock && <Banner tone="info">הכרטיס מוזן בדף המאובטח של ספק הסליקה. <a href={session.url} target="_blank" rel="noreferrer">פתיחת הדף</a></Banner>}
        {mock && (
          <>
            <Banner tone="warn">ספק בדיקה: כסף אמיתי לא עובר, ומותרים רק כרטיסי הבדיקה: {session.testCards.map((t) => `${t.number} (${t.label})`).join(' · ')}</Banner>
            <Field id="cc-num" label="מספר כרטיס בדיקה" required error={act.fields.number}><input id="cc-num" dir="ltr" inputMode="numeric" autoComplete="off" className="input w-full" value={f.number} onChange={set('number')} /></Field>
            <div className="ui-grid-2">
              <Field id="cc-m" label="חודש" required error={act.fields.exp}><input id="cc-m" dir="ltr" type="number" min="1" max="12" className="input w-full" value={f.expMonth} onChange={set('expMonth')} /></Field>
              <Field id="cc-y" label="שנה" required><input id="cc-y" dir="ltr" type="number" min="2024" className="input w-full" value={f.expYear} onChange={set('expYear')} /></Field>
            </div>
            <Field id="cc-h" label="שם בעל הכרטיס"><input id="cc-h" className="input w-full" value={f.holderName} onChange={set('holderName')} /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}

function ChargeDialog({ open, onClose, propertyId, state, onDone }) {
  const act = useAction();
  const [folio, setFolio] = useState(''); const [amount, setAmount] = useState('');
  const owing = (state?.folios || []).filter((f) => f.balance > 0.005);
  useEffect(() => { if (open) { act.reset(); const f = owing[0] || state?.folios?.[0]; setFolio(f?.id || ''); setAmount(f ? Math.max(0, f.balance) : ''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (id) => { setFolio(id); const f = state.folios.find((x) => x.id === id); if (f) setAmount(Math.max(0, f.balance)); };
  const free = state?.auth ? state.auth.available : 0;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={460} title={`חיוב ${state?.card ? label(state.card) : 'כרטיס'}`} subtitle={state?.auth ? `נלקח מהמסגרת (פנוי ${money(free)}); מעבר לזה המסגרת מושלמת אוטומטית` : 'חיוב ישיר, בלי מסגרת'}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy || !folio} onClick={() => act.run(async () => { const r = await cards.charge(propertyId, folio, { amount: Number(amount) }); onDone(`חויב ${money(Number(amount))} · אישור ${r.approval}`); })}>{act.busy ? <Spinner /> : 'חיוב'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <Field id="ch-f" label="חשבון"><select id="ch-f" className="input w-full" value={folio} onChange={(e) => pick(e.target.value)}>{(state?.folios || []).map((f) => <option key={f.id} value={f.id}>{f.label} · יתרה {money(f.balance)}</option>)}</select></Field>
        <Field id="ch-a" label="סכום (₪)" error={act.fields.amount}><input id="ch-a" type="number" min="0" step="0.01" className="input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RefundDialog({ open, onClose, propertyId, tx, onDone }) {
  const act = useAction();
  const [amount, setAmount] = useState(''); const [reasonCode, setReason] = useState('overpayment'); const [note, setNote] = useState('');
  useEffect(() => { if (open && tx) { act.reset(); setAmount(Math.max(0, tx.amount - tx.refunded)); setReason('overpayment'); setNote(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tx) return null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={440} title="החזר לכרטיס" subtitle={`לאותו כרטיס ••${tx.last4} · מתשלום של ${money(tx.amount)}${tx.refunded ? `, הוחזרו כבר ${money(tx.refunded)}` : ''}`}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy} onClick={() => act.run(async () => { await cards.refund(propertyId, tx.folio, { paymentLineId: tx.folioLine, amount: Number(amount), reasonCode, note }); onDone('ההחזר בוצע לכרטיס'); })}>{act.busy ? <Spinner /> : 'החזר'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <Field id="rf-a" label="סכום (₪)" error={act.fields.amount}><input id="rf-a" type="number" min="0" step="0.01" className="input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field id="rf-r" label="סיבה" error={act.fields.reasonCode}><select id="rf-r" className="input w-full" value={reasonCode} onChange={(e) => setReason(e.target.value)}>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field id="rf-n" label="פירוט" error={act.fields.note}><input id="rf-n" className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function CardsCard({ propertyId, reservation, canWork, onChanged }) {
  const [dlg, setDlg] = useState(null);
  const act = useAction();
  const live = !['cancelled', 'no_show', 'deleted'].includes(reservation.status);
  const st = useLoader(async () => cards.state(propertyId, reservation.id), [propertyId, reservation.id]);
  const list = useLoader(async () => cards.list(propertyId, { reservation: reservation.id }), [propertyId, reservation.id]);
  if (st.error?.message?.includes('אין הרשאה')) return null;
  const s = st.data; const mine = list.data?.cards || [];
  const reload = () => { st.reload(); list.reload(); };
  const done = (m) => { setDlg(null); reload(); onChanged?.(m); };
  const run = (fn, m) => act.run(async () => { await fn(); done(m); });
  const auth = s?.auth;
  return (
    <section className="rsv-card" aria-labelledby="rsv-cards">
      <div className="rsv-card-head">
        <h2 id="rsv-cards">כרטיס אשראי ומסגרת</h2>
        {canWork && live && <button type="button" className="rsv-link" onClick={() => setDlg({ kind: 'add' })}>הוספת כרטיס</button>}
      </div>
      <ErrorBanner error={act.error || st.error} />
      {!mine.length && <p className="ui-sub">אין כרטיס שמור לאורח.</p>}
      {mine.map((c) => (
        <p key={c.id} className="ui-sub" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <b>{label(c)}</b> <span>{String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}</span>
          {c.onReservation ? <span>· על ההזמנה</span> : canWork && live && <button type="button" className="rsv-link" onClick={() => run(() => cards.setCard(propertyId, reservation.id, c.id), 'הכרטיס שויך להזמנה')}>שיוך להזמנה</button>}
          {c.lastCheck && <span>· בדיקה {c.lastCheck.ok ? 'תקינה' : 'נכשלה'} ({formatShort(String(c.lastCheck.at).slice(0, 10))})</span>}
          {canWork && <button type="button" className="rsv-link" onClick={() => run(() => cards.verify(propertyId, c.id), 'הכרטיס נבדק')}>בדיקת כרטיס</button>}
          {canWork && <button type="button" className="rsv-link" onClick={() => run(() => cards.remove(propertyId, c.id), 'הכרטיס הוסר')}>הסרה</button>}
        </p>
      ))}
      {s?.card && live && (
        <p className="ui-sub">
          {auth ? <>מסגרת {money(auth.amount)} · נוצל {money(auth.captured)} · פנוי {money(auth.available)}{s.exposure ? ` · השהייה עוד עלולה לעלות ${money(s.exposure.total)}` : ''}{auth.over ? <b> · המסגרת לא מכסה</b> : null}</> : <>אין מסגרת{s.exposure ? ` · השהייה עוד עלולה לעלות ${money(s.exposure.total)}` : ''}</>}
          {canWork && <span style={{ display: 'inline-flex', gap: 12, marginInlineStart: 8, flexWrap: 'wrap' }}>
            {!auth && <button type="button" className="rsv-link" onClick={() => run(() => cards.authorize(propertyId, reservation.id), 'נלקחה מסגרת')}>לקיחת מסגרת</button>}
            {auth?.over && <button type="button" className="rsv-link" onClick={() => run(() => cards.topUp(propertyId, reservation.id), 'המסגרת הושלמה')}>השלמת מסגרת</button>}
            {auth && <button type="button" className="rsv-link" onClick={() => run(() => cards.release(propertyId, reservation.id), 'המסגרת שוחררה')}>שחרור</button>}
            <button type="button" className="rsv-link" onClick={() => setDlg({ kind: 'charge' })}>חיוב כרטיס</button>
          </span>}
        </p>
      )}
      {(s?.transactions || []).map((t) => (
        <p key={t.id} className="ui-sub">
          {KIND[t.kind]} {money(t.amount)} · ••{t.last4} · אישור {t.approval}{t.refunded ? ` · הוחזרו ${money(t.refunded)}` : ''}{t.attention ? <b> · {t.attention}</b> : null}
          {canWork && t.kind !== 'refund' && t.folioLine && t.amount - t.refunded > 0.005 && <> · <button type="button" className="rsv-link" onClick={() => setDlg({ kind: 'refund', tx: t })}>החזר לכרטיס</button></>}
        </p>
      ))}
      <AddCardDialog open={dlg?.kind === 'add'} onClose={() => setDlg(null)} propertyId={propertyId} reservationId={reservation.id} onDone={done} />
      <ChargeDialog open={dlg?.kind === 'charge'} onClose={() => setDlg(null)} propertyId={propertyId} state={s} onDone={done} />
      <RefundDialog open={dlg?.kind === 'refund'} onClose={() => setDlg(null)} propertyId={propertyId} tx={dlg?.tx} onDone={done} />
    </section>
  );
}
