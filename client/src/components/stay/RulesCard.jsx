// Payment methods, privileges, housekeeping, deposit due date and items of a stay (gap-map item 15).
import { useEffect, useState } from 'react';
import { resExtras, resDetails } from '../../utils/api';
import { Modal, Field, ErrorBanner, Spinner, Tag, useAction, useLoader, money } from '../kit';
import { formatShort } from '../../utils/date';

const METHOD = { credit_card: 'כרטיס אשראי', cash: 'מזומן', company: 'חברה (חייבים)', voucher: 'שובר', bank_transfer: 'העברה' };
const COVERS = { all: 'הכול', room: 'לינה', extras: 'תוספות' };
const RULE = { none: 'ללא', authorization: 'מסגרת בכרטיס', manager: 'אישור מנהל', voucher_number: 'מספר שובר' };

function RulesDialog({ open, onClose, propertyId, reservation, data, onDone }) {
  const act = useAction();
  const opts = useLoader(async () => (open ? resDetails.options(propertyId) : null), [open, propertyId]);
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!open || !data) return;
    act.reset();
    setF({
      paymentMethods: data.paymentMethods.map((m) => ({ ...m, company: m.company?.id || '' })),
      privileges: { preArrivalCharges: data.privileges.preArrivalCharges ?? null, postStayCharges: !!data.privileges.postStayCharges, selfCheckout: !!data.privileges.selfCheckout },
      housekeeping: { turndown: !!data.housekeeping.turndown, turndownTime: data.housekeeping.turndownTime || '', cleaningEvery: data.housekeeping.cleaningEvery || '', linenEvery: data.housekeeping.linenEvery || '', note: data.housekeeping.note || '' },
      deposit: { amount: data.depositDue?.amount || '', dueDate: data.depositDue?.dueDate || '' },
    });
  }, [open, data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const setPM = (i, k, v) => setF((p) => ({ ...p, paymentMethods: p.paymentMethods.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));
  const setH = (k, v) => setF((p) => ({ ...p, housekeeping: { ...p.housekeeping, [k]: v } }));
  const setPr = (k, v) => setF((p) => ({ ...p, privileges: { ...p.privileges, [k]: v } }));
  const submit = () => act.run(async () => {
    await resExtras.saveRules(propertyId, reservation.id, { paymentMethods: f.paymentMethods.map((m) => ({ ...m, limit: m.limit === '' ? undefined : m.limit })), privileges: f.privileges, housekeeping: f.housekeeping });
    if (f.deposit.amount !== '' && f.deposit.dueDate) await resExtras.setDeposit(propertyId, reservation.id, { amount: Number(f.deposit.amount), dueDate: f.deposit.dueDate });
    else if (f.deposit.amount === '' && data.depositDue) await resExtras.setDeposit(propertyId, reservation.id, { amount: 0 });
    onDone('הכללים נשמרו');
  });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={720} title="תשלום, משק והרשאות" subtitle="אמצעי תשלום וכללים, מקדמה עם תאריך יעד, הרשאות חיוב ומשק בית לשהייה"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" onClick={submit} disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <fieldset className="ui-fieldset"><legend className="ui-label">אמצעי תשלום</legend>
          {f.paymentMethods.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
              <select aria-label="אמצעי" className="input" value={m.method} onChange={(e) => setPM(i, 'method', e.target.value)}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select aria-label="מכסה" className="input" value={m.covers} onChange={(e) => setPM(i, 'covers', e.target.value)}>{Object.entries(COVERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select aria-label="כלל" className="input" value={m.rule} onChange={(e) => setPM(i, 'rule', e.target.value)}>{Object.entries(RULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {m.method === 'company' && <select aria-label="חברה" className="input" value={m.company} onChange={(e) => setPM(i, 'company', e.target.value)}><option value="">חברה…</option>{(opts.data?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
              <input aria-label="תקרה" type="number" min="0" className="input" style={{ width: 100 }} placeholder="תקרה" value={m.limit ?? ''} onChange={(e) => setPM(i, 'limit', e.target.value)} />
              <input aria-label="אסמכתא" className="input" style={{ width: 110 }} placeholder="אסמכתא" value={m.ref || ''} onChange={(e) => setPM(i, 'ref', e.target.value)} />
              <button type="button" className="rsv-link" onClick={() => setF((p) => ({ ...p, paymentMethods: p.paymentMethods.filter((_, j) => j !== i) }))}>הסרה</button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setF((p) => ({ ...p, paymentMethods: [...p.paymentMethods, { method: 'credit_card', covers: p.paymentMethods.length ? 'extras' : 'all', rule: 'none', limit: '', ref: '', company: '' }] }))}>הוספת אמצעי</button>
          {act.fields.paymentMethods && <div className="ui-error">{act.fields.paymentMethods}</div>}
        </fieldset>
        <div className="ui-grid-2">
          <fieldset className="ui-fieldset"><legend className="ui-label">מקדמה</legend>
            <div style={{ display: 'flex', gap: 6 }}><input aria-label="סכום מקדמה" type="number" min="0" className="input" placeholder="סכום" value={f.deposit.amount} onChange={(e) => setF((p) => ({ ...p, deposit: { ...p.deposit, amount: e.target.value } }))} /><input aria-label="תאריך יעד" type="date" className="input" max={reservation.arrivalDate} value={f.deposit.dueDate} onChange={(e) => setF((p) => ({ ...p, deposit: { ...p.deposit, dueDate: e.target.value } }))} /></div>
            <div className="ui-sub">שולם עד עכשיו: {money(data.paid)}</div>
          </fieldset>
          <fieldset className="ui-fieldset"><legend className="ui-label">הרשאות</legend>
            <label className="ui-check"><input type="checkbox" checked={f.privileges.preArrivalCharges === false} onChange={(e) => setPr('preArrivalCharges', e.target.checked ? false : null)} /><span>אסור לחייב לפני ההגעה</span></label>
            <label className="ui-check"><input type="checkbox" checked={f.privileges.postStayCharges} onChange={(e) => setPr('postStayCharges', e.target.checked)} /><span>מותר לחייב אחרי העזיבה (מנהל)</span></label>
            <label className="ui-check"><input type="checkbox" checked={f.privileges.selfCheckout} onChange={(e) => setPr('selfCheckout', e.target.checked)} /><span>יציאה עצמית (צ'ק־אאוט מקוון)</span></label>
            {act.fields.privileges && <div className="ui-error">{act.fields.privileges}</div>}
          </fieldset>
        </div>
        <fieldset className="ui-fieldset"><legend className="ui-label">משק בית לשהייה</legend>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="ui-check"><input type="checkbox" checked={f.housekeeping.turndown} onChange={(e) => setH('turndown', e.target.checked)} /><span>ערב (Turndown)</span></label>
            {f.housekeeping.turndown && <input aria-label="שעת ערב" type="time" className="input" value={f.housekeeping.turndownTime} onChange={(e) => setH('turndownTime', e.target.value)} />}
            <label className="ui-sub">ניקיון כל <input aria-label="ניקיון כל ימים" type="number" min="1" max="14" className="input" style={{ width: 64 }} value={f.housekeeping.cleaningEvery} onChange={(e) => setH('cleaningEvery', e.target.value)} /> ימים</label>
            <label className="ui-sub">מצעים כל <input aria-label="מצעים כל ימים" type="number" min="1" max="14" className="input" style={{ width: 64 }} value={f.housekeeping.linenEvery} onChange={(e) => setH('linenEvery', e.target.value)} /> ימים</label>
            <input aria-label="הערה למשק" className="input" placeholder="הערה למשק" value={f.housekeeping.note} onChange={(e) => setH('note', e.target.value)} />
          </div>
          {act.fields.housekeeping && <div className="ui-error">{act.fields.housekeeping}</div>}
        </fieldset>
      </div>
    </Modal>
  );
}

function ItemDialog({ open, onClose, propertyId, reservation, onDone }) {
  const act = useAction();
  const types = useLoader(async () => (open ? resExtras.items(propertyId) : null), [open, propertyId]);
  const av = useLoader(async () => (open ? resExtras.itemAvailability(propertyId, reservation.arrivalDate, reservation.departureDate) : null), [open, propertyId]);
  const [f, setF] = useState({ item: '', qty: 1 });
  useEffect(() => { if (open) { act.reset(); setF({ item: '', qty: 1 }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={420} title="פריט לשהייה" subtitle={`${formatShort(reservation.arrivalDate)} – ${formatShort(reservation.departureDate)}`}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy || !f.item} onClick={() => act.run(async () => { await resExtras.bookItem(propertyId, reservation.id, { item: f.item, qty: Number(f.qty) }); onDone('הפריט נשמר לשהייה'); })}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <Field id="ri-i" label="פריט"><select id="ri-i" className="input w-full" value={f.item} onChange={(e) => setF((p) => ({ ...p, item: e.target.value }))}><option value="">בחירה…</option>{(types.data || []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name} · פנוי {av.data?.find((x) => x.id === t.id)?.minFree ?? '…'}</option>)}</select></Field>
        <Field id="ri-q" label="כמות"><input id="ri-q" type="number" min="1" max="20" className="input w-full" value={f.qty} onChange={(e) => setF((p) => ({ ...p, qty: e.target.value }))} /></Field>
      </div>
    </Modal>
  );
}

export function RulesCard({ propertyId, reservation, canWork, onChanged }) {
  const [dlg, setDlg] = useState(null);
  const act = useAction();
  const d = useLoader(async () => resExtras.rules(propertyId, reservation.id), [propertyId, reservation.id]);
  const x = d.data;
  const live = !['cancelled', 'no_show', 'deleted'].includes(reservation.status);
  const done = (m) => { setDlg(null); d.reload(); onChanged?.(m); };
  if (d.error?.message?.includes('אין הרשאה')) return null;
  return (
    <section className="rsv-card" aria-labelledby="rsv-rules">
      <div className="rsv-card-head">
        <h2 id="rsv-rules">תשלום, משק ופריטים</h2>
        {canWork && live && <span style={{ display: 'inline-flex', gap: 12 }}><button type="button" className="rsv-link" onClick={() => setDlg('item')}>פריט</button><button type="button" className="rsv-link" onClick={() => setDlg('rules')}>עריכה</button></span>}
      </div>
      <ErrorBanner error={d.error || act.error} />
      {x && (
        <div className="ui-sub" style={{ display: 'grid', gap: 4 }}>
          {x.paymentMethods.length > 0 && <div>תשלום: {x.paymentMethods.map((m) => `${METHOD[m.method]}${m.company ? ` (${m.company.name})` : ''} · ${COVERS[m.covers]}${m.limit ? ` עד ${money(m.limit)}` : ''}${m.rule !== 'none' ? ` · ${RULE[m.rule]}` : ''}`).join(' ; ')}</div>}
          {x.depositDue && <div>מקדמה {money(x.depositDue.amount)} עד {formatShort(x.depositDue.dueDate)} · שולם {money(x.paid)}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {x.privileges.preArrivalCharges === false && <Tag>אסור לחייב לפני ההגעה</Tag>}
            {x.privileges.postStayCharges && <Tag>חיוב אחרי עזיבה</Tag>}
            {x.privileges.selfCheckout && <Tag>יציאה עצמית</Tag>}
            {x.housekeeping.turndown && <Tag>ערב {x.housekeeping.turndownTime || ''}</Tag>}
            {x.housekeeping.cleaningEvery > 1 && <Tag>ניקיון כל {x.housekeeping.cleaningEvery} ימים</Tag>}
            {x.housekeeping.linenEvery > 0 && <Tag>מצעים כל {x.housekeeping.linenEvery}</Tag>}
          </div>
          {x.items.map((i) => <div key={i.id}>{i.name} × {i.qty} · {formatShort(i.from)}–{formatShort(i.to)}{canWork && live && <> · <button type="button" className="rsv-link" onClick={() => act.run(async () => { await resExtras.releaseItem(propertyId, i.id); done('הפריט שוחרר'); })}>שחרור</button></>}</div>)}
          {!x.paymentMethods.length && !x.depositDue && !x.items.length && !Object.values(x.privileges).some((v) => v !== undefined && v !== null) && !x.housekeeping.turndown && !x.housekeeping.cleaningEvery && <div>אין כללים מיוחדים.</div>}
        </div>
      )}
      {x && <RulesDialog open={dlg === 'rules'} onClose={() => setDlg(null)} propertyId={propertyId} reservation={reservation} data={x} onDone={done} />}
      <ItemDialog open={dlg === 'item'} onClose={() => setDlg(null)} propertyId={propertyId} reservation={reservation} onDone={done} />
    </section>
  );
}
