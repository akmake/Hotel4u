// Reservation details (gap-map item 14): composition, coordinator / salesperson, agent / company, flight,
// late check-out, special services, VIP with reason, cashier note, hidden price, fixed rate; a different rate
// for part of the nights; and a summary to read to the guest on the phone.
import { useEffect, useState } from 'react';
import { resDetails, profiles } from '../../utils/api';
import { Modal, Field, ErrorBanner, Banner, Spinner, Tag, useAction, useLoader, money } from '../kit';
import { formatShort } from '../../utils/date';

function DetailsDialog({ open, onClose, propertyId, reservationId, data, onDone }) {
  const act = useAction();
  const opts = useLoader(async () => (open ? resDetails.options(propertyId) : null), [open, propertyId]);
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!open || !data) return;
    act.reset();
    setF({
      teens: data.teens, infants: data.infants, coordinator: data.coordinator?.id || '', salesperson: data.salesperson?.id || '', travelAgent: data.travelAgent?.id || '', company: data.company?.id || '',
      flight: { arrivalNo: data.flight?.arrivalNo || '', arrivalTime: data.flight?.arrivalTime || '', departureNo: data.flight?.departureNo || '', departureTime: data.flight?.departureTime || '' },
      sourceProfile: data.sourceProfile?.id || '', contactProfile: data.contactProfile?.id || '', lateCheckout: data.lateCheckout?.time || '', specialServices: data.specialServices.map((s) => s.code), isVip: data.isVip, vipReason: data.vipReason, cashierNote: data.cashierNote, hidePrice: data.hidePrice, fixedRate: data.fixedRate,
    });
  }, [open, data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const o = opts.data || { users: [], agents: [], companies: [], services: [], sources: [], contacts: [] };
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setFl = (k) => (e) => setF((p) => ({ ...p, flight: { ...p.flight, [k]: e.target.value } }));
  const toggleSvc = (c) => setF((p) => ({ ...p, specialServices: p.specialServices.includes(c) ? p.specialServices.filter((x) => x !== c) : [...p.specialServices, c] }));
  const e = act.fields;
  const submit = () => act.run(async () => {
    const { sourceProfile, contactProfile, ...rest } = f;
    await resDetails.save(propertyId, reservationId, { ...rest, teens: Number(f.teens || 0), infants: Number(f.infants || 0) });
    if (sourceProfile !== (data.sourceProfile?.id || '') || contactProfile !== (data.contactProfile?.id || '')) await profiles.setBookingProfiles(propertyId, reservationId, { sourceProfile: sourceProfile || null, contactProfile: contactProfile || null });
    onDone('פרטי ההזמנה עודכנו');
  });
  const sel = (id, label, k, list, err) => <Field id={id} label={label} error={err}><select id={id} className="input w-full" value={f[k]} onChange={set(k)}><option value="">—</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={700} title="פרטי הזמנה" subtitle="הרכב, אנשים, טיסה, שירותים והגדרות מחיר"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" onClick={submit} disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <div className="ui-grid-3">
          <Field id="dt-teens" label="נוער" error={e.teens}><input id="dt-teens" type="number" min="0" max="20" className="input w-full" value={f.teens} onChange={set('teens')} /></Field>
          <Field id="dt-inf" label="תינוקות" error={e.infants}><input id="dt-inf" type="number" min="0" max="10" className="input w-full" value={f.infants} onChange={set('infants')} /></Field>
          <Field id="dt-lco" label="יציאה מאוחרת עד" error={e.lateCheckout}><input id="dt-lco" type="time" className="input w-full" value={f.lateCheckout} onChange={set('lateCheckout')} /></Field>
          {sel('dt-coord', 'רכז הזמנה', 'coordinator', o.users, e.coordinator)}
          {sel('dt-sales', 'איש מכירות', 'salesperson', o.users, e.salesperson)}
          {sel('dt-agent', 'סוכן', 'travelAgent', o.agents, e.travelAgent)}
          {sel('dt-comp', 'חברה', 'company', o.companies, e.company)}
          {sel('dt-src', 'פרופיל מקור', 'sourceProfile', o.sources || [], e.sourceProfile)}
          {sel('dt-cnt', 'איש קשר (לא לן)', 'contactProfile', o.contacts || [], e.contactProfile)}
        </div>
        <fieldset className="ui-fieldset"><legend className="ui-label">טיסה</legend>
          <div className="ui-grid-4">
            <Field id="dt-fa" label="טיסת הגעה" error={e.flight}><input id="dt-fa" dir="ltr" className="input w-full" value={f.flight.arrivalNo} onChange={setFl('arrivalNo')} placeholder="LY001" /></Field>
            <Field id="dt-fat" label="נחיתה"><input id="dt-fat" type="time" className="input w-full" value={f.flight.arrivalTime} onChange={setFl('arrivalTime')} /></Field>
            <Field id="dt-fd" label="טיסת יציאה"><input id="dt-fd" dir="ltr" className="input w-full" value={f.flight.departureNo} onChange={setFl('departureNo')} /></Field>
            <Field id="dt-fdt" label="המראה"><input id="dt-fdt" type="time" className="input w-full" value={f.flight.departureTime} onChange={setFl('departureTime')} /></Field>
          </div>
        </fieldset>
        <fieldset className="ui-fieldset"><legend className="ui-label">שירותים מיוחדים</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>{o.services.map((s) => <label key={s.code} className="ui-check"><input type="checkbox" checked={f.specialServices.includes(s.code)} onChange={() => toggleSvc(s.code)} /><span>{s.label}</span></label>)}</div>
          {e.specialServices && <div className="ui-error">{e.specialServices}</div>}
        </fieldset>
        <div className="ui-grid-2">
          <Field id="dt-vip" label="VIP" error={e.vipReason}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><label className="ui-check"><input type="checkbox" checked={!!f.isVip} onChange={set('isVip')} /><span>אורח VIP</span></label>
              {f.isVip && <input aria-label="סיבת VIP" className="input" placeholder="סיבה" value={f.vipReason} onChange={set('vipReason')} />}</div>
          </Field>
          <Field id="dt-cn" label="הערה לקופה" hint="מוצגת במסך החשבון"><input id="dt-cn" className="input w-full" maxLength={300} value={f.cashierNote} onChange={set('cashierNote')} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label className="ui-check"><input type="checkbox" checked={!!f.hidePrice} onChange={set('hidePrice')} /><span>הסתרת מחיר מהאורח (אישור, סיכום, כרטיס רישום)</span></label>
          <label className="ui-check"><input type="checkbox" checked={!!f.fixedRate} onChange={set('fixedRate')} /><span>מחיר קבוע — לילות שנוספים במחיר הלילה הראשון</span></label>
        </div>
        {e.fixedRate && <div className="ui-error">{e.fixedRate}</div>}
      </div>
    </Modal>
  );
}

function SplitRateDialog({ open, onClose, propertyId, reservation, onDone }) {
  const act = useAction();
  const opts = useLoader(async () => (open ? resDetails.options(propertyId) : null), [open, propertyId]);
  const [f, setF] = useState({ from: '', to: '', ratePlanId: '', reason: '' });
  useEffect(() => { if (open) { act.reset(); setF({ from: reservation.arrivalDate, to: reservation.arrivalDate, ratePlanId: '', reason: '' }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={480} title="תעריף אחר לחלק מהלילות" subtitle="הלילות בטווח מתומחרים מחדש לפי התעריף שנבחר. לילות שעברו לא משתנים"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="button" className="btn btn-primary" disabled={act.busy} onClick={() => act.run(async () => { const r = await resDetails.splitRate(propertyId, reservation.id, f); onDone(`${r.nights} לילות בתעריף ${r.plan} · סה״כ ${money(r.total)}`); })}>{act.busy ? <Spinner /> : 'החלה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="sr-f" label="מלילה" error={act.fields.from}><input id="sr-f" type="date" className="input w-full" min={reservation.arrivalDate} value={f.from} onChange={set('from')} /></Field>
          <Field id="sr-t" label="עד לילה (כולל)"><input id="sr-t" type="date" className="input w-full" value={f.to} onChange={set('to')} /></Field>
        </div>
        <Field id="sr-p" label="תעריף" error={act.fields.ratePlanId}><select id="sr-p" className="input w-full" value={f.ratePlanId} onChange={set('ratePlanId')}><option value="">בחירה…</option>{(opts.data?.ratePlans || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}</select></Field>
        <Field id="sr-r" label="סיבה" error={act.fields.reason}><input id="sr-r" className="input w-full" value={f.reason} onChange={set('reason')} /></Field>
      </div>
    </Modal>
  );
}

function SummaryDialog({ open, onClose, propertyId, reservationId }) {
  const s = useLoader(async () => (open ? resDetails.summary(propertyId, reservationId) : null), [open, reservationId]);
  const [copied, setCopied] = useState(false);
  return (
    <Modal open={open} onClose={onClose} width={520} title="סיכום להקראה" subtitle="בשפת האורח (עברית / אנגלית); בלי מחיר כשהמחיר מוסתר"
      footer={<><button type="button" className="btn btn-secondary" onClick={() => { navigator.clipboard?.writeText(s.data?.text || ''); setCopied(true); }}>{copied ? 'הועתק' : 'העתקה'}</button><button type="button" className="btn btn-primary" onClick={onClose}>סגירה</button></>}>
      {!s.data ? <Spinner /> : (
        <div className="ui-stack">
          <pre dir={s.data.language === 'en' ? 'ltr' : 'rtl'} style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{s.data.text}</pre>
          {s.data.foreign.length > 0 && <div className="ui-sub">במטבע זר (שער החשבון): {s.data.foreign.map((x) => `${x.amount.toFixed(2)} ${x.currency}`).join(' · ')}</div>}
        </div>
      )}
    </Modal>
  );
}

export function DetailsCard({ propertyId, reservation, canWork, onChanged }) {
  const [dlg, setDlg] = useState(null);
  const d = useLoader(async () => resDetails.get(propertyId, reservation.id), [propertyId, reservation.id]);
  const x = d.data;
  const live = !['cancelled', 'no_show', 'deleted'].includes(reservation.status);
  const done = (m) => { setDlg(null); d.reload(); onChanged?.(m); };
  const parts = x ? [
    x.teens ? `${x.teens} נוער` : null, x.infants ? `${x.infants} תינוקות` : null,
    x.sourceProfile ? `מקור: ${x.sourceProfile.name}` : null, x.contactProfile ? `איש קשר: ${x.contactProfile.name}` : null,
    x.coordinator ? `רכז: ${x.coordinator.name}` : null, x.salesperson ? `מכירות: ${x.salesperson.name}` : null, x.travelAgent ? `סוכן: ${x.travelAgent.name}` : null,
    x.flight?.arrivalNo ? `טיסה ${x.flight.arrivalNo}${x.flight.arrivalTime ? ` ${x.flight.arrivalTime}` : ''}` : null,
    x.lateCheckout ? `יציאה מאוחרת עד ${x.lateCheckout.time}` : null, x.billedRoomType ? `מחויב כ־${x.billedRoomType.name}` : null,
    x.createdBy ? `נקלטה ע״י ${x.createdBy}` : null,
  ].filter(Boolean) : [];
  const split = x?.nightly?.some((n) => n.planCode && n.planCode !== x.nightly[0]?.planCode);
  return (
    <section className="rsv-card" aria-labelledby="rsv-details">
      <div className="rsv-card-head">
        <h2 id="rsv-details">פרטים נוספים</h2>
        <span style={{ display: 'inline-flex', gap: 12 }}>
          <button type="button" className="rsv-link" onClick={() => setDlg('summary')}>סיכום להקראה</button>
          {canWork && live && <button type="button" className="rsv-link" onClick={() => setDlg('edit')}>עריכה</button>}
        </span>
      </div>
      <ErrorBanner error={d.error} />
      {x && <p className="ui-sub">{parts.length ? parts.join(' · ') : 'אין פרטים נוספים.'}</p>}
      {x && (x.specialServices.length > 0 || x.isVip || x.hidePrice || x.fixedRate) && (
        <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {x.isVip && <Tag tone="warn">VIP{x.vipReason ? ` · ${x.vipReason}` : ''}</Tag>}
          {x.specialServices.map((s) => <Tag key={s.code}>{s.label}{s.source === 'vip' ? ' (VIP)' : ''}</Tag>)}
          {x.hidePrice && <Tag>מחיר מוסתר</Tag>}{x.fixedRate && <Tag>מחיר קבוע</Tag>}
        </p>
      )}
      {split && <p className="ui-sub">תעריף לפי לילה: {x.nightly.map((n) => `${formatShort(n.date)} ${n.planCode}`).join(' · ')}</p>}
      {canWork && live && <p><button type="button" className="rsv-link" onClick={() => setDlg('split')}>תעריף אחר לחלק מהלילות</button></p>}
      <DetailsDialog open={dlg === 'edit'} onClose={() => setDlg(null)} propertyId={propertyId} reservationId={reservation.id} data={x} onDone={done} />
      <SplitRateDialog open={dlg === 'split'} onClose={() => setDlg(null)} propertyId={propertyId} reservation={reservation} onDone={done} />
      <SummaryDialog open={dlg === 'summary'} onClose={() => setDlg(null)} propertyId={propertyId} reservationId={reservation.id} />
      {!x && !d.error && <Banner tone="info"><Spinner /> טוען…</Banner>}
    </section>
  );
}
