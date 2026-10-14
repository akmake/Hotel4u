// FD-08 — stay closing. Steps: units leaving → every folio of the stay (guest, companions, company;
// lodging nights not yet posted are included) → settlement → confirm.
// Leaving the room and settling the money are separate: a folio that still owes money is never
// closed silently — it is paid, moved to the company's receivables within its limit, or left open
// by a manager with a reason (and stays visible). The server re-checks everything.
import { useCallback, useEffect, useState } from 'react';
import { Check, LogOut } from 'lucide-react';
import { frontdesk } from '../../utils/api';
import { PAY_METHOD_LABELS, SETTLEMENT_LABELS } from '../../lib/labels';
import { formatShort } from '../../utils/date';
import { Modal, Field, Spinner, ErrorBanner, Banner, KeyValues, Tag, money, newOpKey } from '../kit';

const STEPS = [
  { id: 'units', label: 'יחידות ליציאה' },
  { id: 'folios', label: 'חשבונות' },
  { id: 'confirm', label: 'סיכום ואישור' },
];
const isZero = (n) => Math.abs(Number(n || 0)) < 0.005;

function amountClass(n) {
  if (isZero(n)) return 'ui-amount is-zero';
  return n > 0 ? 'ui-amount is-due' : 'ui-amount is-credit';
}

export default function CheckOutWizard({ open, propertyId, reservationId, isManager, canRefund, onClose, onDone, initialEarlyReason = '' }) {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [step, setStep] = useState('units');
  const [selected, setSelected] = useState([]);
  const [settle, setSettle] = useState({}); // folioId → { mode, reason }
  const [earlyReason, setEarlyReason] = useState(initialEarlyReason);
  useEffect(() => { if (open) setEarlyReason(initialEarlyReason || ''); }, [open, initialEarlyReason]);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    if (!reservationId) return null;
    setLoading(true); setLoadError(null);
    try {
      const d = await frontdesk.checkOutContext(propertyId, reservationId);
      setCtx(d);
      return d;
    } catch (e) { setLoadError(e.message); return null; } finally { setLoading(false); }
  }, [propertyId, reservationId]);

  useEffect(() => {
    if (!open) return;
    setCtx(null); setStep('units'); setResult(null); setSettle({}); setEarlyReason('');
    load().then((d) => {
      if (!d) return;
      // Everyone in the house leaves by default; deselect to let one room stay.
      setSelected(d.units.filter((u) => ['in_house', 'checked_in'].includes(u.status)).map((u) => u.index));
    });
  }, [open, load]);

  const inHouse = (ctx?.units || []).filter((u) => ['in_house', 'checked_in'].includes(u.status));
  const chosen = inHouse.filter((u) => selected.includes(u.index));
  const final = chosen.length > 0 && chosen.length === inHouse.length;
  const early = !!ctx?.reservation?.early;
  const openFolios = (ctx?.folios || []).filter((f) => f.status !== 'closed');
  const needsSettlement = final ? openFolios.filter((f) => !isZero(f.balance)) : [];
  const unsettled = needsSettlement.filter((f) => !settle[f.id]?.mode || (settle[f.id].mode === 'approved_open' && (settle[f.id].reason || '').trim().length < 3));

  const stepDone = {
    units: chosen.length > 0 && (!early || earlyReason.trim().length >= 3),
    folios: final ? unsettled.length === 0 : true,
    confirm: !!result,
  };

  const title = ctx ? `יציאה — ${ctx.guest.name}` : 'יציאה';
  const subtitle = ctx ? `${ctx.reservation.confirmationNumber} · ${formatShort(ctx.reservation.arrivalDate)}–${formatShort(ctx.reservation.departureDate)} · ${ctx.reservation.nights} לילות` : '';

  return (
    <Modal open={open} onClose={result ? onDone : onClose} width={920} title={title} subtitle={subtitle}>
      {loadError && <ErrorBanner error={loadError} onRetry={load} />}
      {!ctx && loading && <div className="ui-empty"><Spinner /> טוען חשבונות…</div>}
      {ctx && result ? (
        <div className="ui-result" role="status">
          <div className="ui-result-icon"><LogOut size={20} /></div>
          <h3 className="ui-h3">{result.status === 'checked_out' ? 'השהייה נסגרה' : 'היציאה החלקית נרשמה'}</h3>
          <p className="ui-p">
            {result.checkedOutUnits.length} {result.checkedOutUnits.length === 1 ? 'יחידה יצאה' : 'יחידות יצאו'}
            {result.remainingUnits > 0 && ` · ${result.remainingUnits} נשארות בבית`}
            {result.housekeepingTasks > 0 && ` · ${result.housekeepingTasks} משימות ניקיון נפתחו`}
            {result.nightsPosted > 0 && ` · ${result.nightsPosted} לילות נרשמו לחשבון`}
          </p>
          {result.openFolios?.length > 0 && (
            <Banner tone="warn">
              {result.openFolios.length} {result.openFolios.length === 1 ? 'חשבון נשאר פתוח' : 'חשבונות נשארו פתוחים'} — מופיעים ברשימת העזיבות עם הסיבה ומי אישר.
            </Banner>
          )}
          <div className="ui-step-foot"><button type="button" className="btn btn-primary" onClick={onDone}>חזרה לעזיבות</button></div>
        </div>
      ) : ctx && (
        <div className="ui-wizard">
          <nav className="ui-steps" aria-label="שלבי היציאה">
            <ol>
              {STEPS.map((s, i) => (
                <li key={s.id}>
                  <button type="button" className={`ui-step ${step === s.id ? 'is-current' : ''} ${stepDone[s.id] ? 'is-done' : ''}`} aria-current={step === s.id ? 'step' : undefined} onClick={() => setStep(s.id)}>
                    <span className="ui-step-n" aria-hidden="true">{stepDone[s.id] && step !== s.id ? <Check size={12} /> : i + 1}</span>
                    <span>{s.label}</span>
                  </button>
                </li>
              ))}
            </ol>
            {ctx.openRequests > 0 && (
              <div className="ui-note-box"><div className="ui-note-k">בקשות פתוחות</div><div>{ctx.openRequests} בקשות אורח עדיין פתוחות</div></div>
            )}
          </nav>
          <section className="ui-step-body">
            {step === 'units' && (
              <div className="ui-stack">
                <h3 className="ui-h3">מי יוצא עכשיו?</h3>
                <div className="ui-units">
                  {ctx.units.map((u) => {
                    const here = ['in_house', 'checked_in'].includes(u.status);
                    return (
                      <label key={u.index} className={`ui-unit ${selected.includes(u.index) ? 'is-selected' : ''} ${!here ? 'is-done' : ''}`}>
                        <span className="ui-unit-main">
                          <input type="checkbox" disabled={!here} checked={here && selected.includes(u.index)} onChange={() => setSelected((s) => (s.includes(u.index) ? s.filter((x) => x !== u.index) : [...s, u.index]))} />
                          <span>
                            <span className="font-medium">יחידה {u.index}</span>
                            <span className="ui-sub"> · {u.room ? `חדר ${u.room.number}` : 'ללא חדר'} · {here ? 'בבית' : u.status === 'checked_out' ? 'יצאה' : 'לא נכנסה'}</span>
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {!final && chosen.length > 0 && <Banner tone="info">יציאה חלקית: החשבונות המשותפים נשארים פתוחים עד שהיחידה האחרונה יוצאת. החדרים שיוצאים עוברים לניקיון.</Banner>}
                {early && (
                  <div className="ui-sub-card">
                    <Banner tone="warn">עזיבה לפני מועד היציאה ({formatShort(ctx.reservation.departureDate)}). הלילות שלא נוצלו יחזרו למלאי. לילות שכבר חויבו נשארים בחשבון — החזר או זיכוי הם פעולה כספית נפרדת.</Banner>
                    <Field id="early-reason" label="סיבת העזיבה המוקדמת" required>
                      <input id="early-reason" className="input w-full" maxLength={300} value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)} />
                    </Field>
                  </div>
                )}
                <div className="ui-step-foot"><button type="button" className="btn btn-primary" onClick={() => setStep('folios')}>הבא</button></div>
              </div>
            )}
            {step === 'folios' && (
              <FoliosStep ctx={ctx} propertyId={propertyId} reload={load} final={final} settle={settle} setSettle={setSettle} isManager={isManager} canRefund={canRefund} onNext={() => setStep('confirm')} />
            )}
            {step === 'confirm' && (
              <ConfirmStep
                ctx={ctx}
                chosen={chosen}
                final={final}
                settle={settle}
                needsSettlement={needsSettlement}
                unsettled={unsettled}
                early={early}
                earlyReason={earlyReason}
                propertyId={propertyId}
                reload={load}
                goTo={setStep}
                onSuccess={setResult}
              />
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function FoliosStep({ ctx, propertyId, reload, final, settle, setSettle, isManager, canRefund, onNext }) {
  const folios = ctx.folios;
  return (
    <div className="ui-stack">
      <h3 className="ui-h3">כל החשבונות של השהייה</h3>
      <p className="ui-p">כולל חשבונות נלווים וחברה. יתרה כוללת לילות שעדיין לא נרשמו — הם יירשמו בעת היציאה.</p>
      {folios.length === 0 && <Banner tone="info">אין חשבונות לשהייה הזו.</Banner>}
      {folios.map((f) => (
        <FolioCard
          key={f.id}
          folio={f}
          ctx={ctx}
          propertyId={propertyId}
          reload={reload}
          final={final}
          value={settle[f.id]}
          onChange={(v) => setSettle((s) => ({ ...s, [f.id]: v }))}
          isManager={isManager}
          canRefund={canRefund}
        />
      ))}
      {ctx.documents?.length > 0 && (
        <div>
          <div className="ui-section-title">מסמכים שהופקו</div>
          <div className="ui-row">
            {ctx.documents.map((d) => <Tag key={d.id} tone={d.status === 'issued' ? undefined : 'warn'}>{d.number || 'טיוטה'} · {d.status === 'issued' ? 'הונפק' : d.status === 'draft' ? 'טיוטה' : 'ממתין להקצאה'}</Tag>)}
          </div>
        </div>
      )}
      <div className="ui-step-foot"><button type="button" className="btn btn-primary" onClick={onNext}>הבא</button></div>
    </div>
  );
}

function FolioCard({ folio, ctx, propertyId, reload, final, value, onChange, isManager, canRefund }) {
  const [pay, setPay] = useState({ amount: '', method: 'cash', ref: '', key: newOpKey() });
  const needsRef = ['bank_transfer', 'cheque', 'voucher'].includes(pay.method);
  const [refund, setRefund] = useState({ amount: '', method: 'cash', reason: '', key: newOpKey() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const due = folio.balance;
  const closed = folio.status === 'closed';
  const company = folio.company;

  async function doPay() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await frontdesk.payFolio(propertyId, folio.id, { amount: Number(pay.amount), method: pay.method, methodRef: pay.ref.trim() || undefined, idempotencyKey: pay.key });
      setNotice(`נרשם תשלום ${money(pay.amount)}`);
      setPay({ amount: '', method: pay.method, ref: '', key: newOpKey() });
      await reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function doRefund() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await frontdesk.refundFolio(propertyId, folio.id, { amount: Number(refund.amount), method: refund.method, reason: refund.reason, idempotencyKey: refund.key });
      setNotice(`נרשם החזר ${money(refund.amount)}`);
      setRefund({ amount: '', method: refund.method, reason: '', key: newOpKey() });
      await reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  // Payment can only cover what is posted; nights still to be posted are added at departure.
  const payable = Math.max(0, Number(folio.postedBalance || 0));

  return (
    <div className="ui-sub-card" style={{ marginTop: 0 }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold">{folio.ownerLabel}{closed && <Tag>סגור</Tag>}{folio.settlement && <Tag tone="warn">{SETTLEMENT_LABELS[folio.settlement.mode]}</Tag>}</div>
          <div className="ui-sub">חיובים {money(folio.charges)} · תשלומים {money(folio.payments)}{folio.pendingNights?.count ? ` · ${folio.pendingNights.count} לילות טרם נרשמו (${money(folio.pendingNights.gross)})` : ''}</div>
        </div>
        <div className="text-left">
          <div className="ui-sub">יתרה ליציאה</div>
          <div className={amountClass(due)} style={{ fontSize: 18 }}>{money(Math.abs(due))}{due < -0.005 ? ' זכות' : ''}</div>
        </div>
      </div>

      {folio.recent?.length > 0 && (
        <details>
          <summary className="ui-sub" style={{ cursor: 'pointer' }}>תנועות אחרונות{folio.todayCharges ? ` · ${folio.todayCharges} חיובים מהיום` : ''}</summary>
          <table className="ui-table" style={{ marginTop: 6 }}>
            <tbody>
              {folio.recent.map((l) => (
                <tr key={l.id}>
                  <td className="ui-nowrap ui-num">{formatShort(l.serviceDate)}</td>
                  <td>{l.description}</td>
                  <td className={`ui-amount ${l.amount < 0 ? 'is-credit' : ''}`} style={{ textAlign: 'left' }}>{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <ErrorBanner error={error} />
      {notice && <Banner tone="ok">{notice}</Banner>}

      {!closed && folio.pendingNights?.count > 0 && (
        <div className="ui-row">
          <span className="ui-sub">{folio.pendingNights.count} לילות שכבר נוצלו טרם נרשמו לחשבון. כדי לגבות את מלוא הסכום עכשיו — רשמו אותם.</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { const r = await frontdesk.postNights(propertyId, ctx.reservation.id); setNotice(`נרשמו ${r.posted} לילות`); await reload(); }
            catch (e) { setError(e.message); } finally { setBusy(false); }
          }}>רישום הלילות לחשבון</button>
        </div>
      )}

      {!closed && payable > 0.005 && (
        <div className="ui-row" style={{ alignItems: 'flex-end' }}>
          <Field id={`pay-${folio.id}`} label="גבייה">
            <input id={`pay-${folio.id}`} type="number" min={0.01} step={0.01} className="input" style={{ width: 130 }} placeholder={payable.toFixed(2)} value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} />
          </Field>
          <Field id={`paym-${folio.id}`} label="אמצעי">
            <select id={`paym-${folio.id}`} className="select" value={pay.method} onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}>
              {Object.entries(PAY_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {needsRef && (
            <Field id={`payr-${folio.id}`} label="אסמכתה">
              <input id={`payr-${folio.id}`} className="input" style={{ width: 150 }} maxLength={80} value={pay.ref} onChange={(e) => setPay((p) => ({ ...p, ref: e.target.value }))} placeholder="מספר העברה / שיק / שובר" />
            </Field>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPay((p) => ({ ...p, amount: payable.toFixed(2) }))}>מלוא היתרה</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !(Number(pay.amount) > 0) || (needsRef && pay.ref.trim().length < 2)} title={needsRef && pay.ref.trim().length < 2 ? 'נדרשת אסמכתה' : undefined} onClick={doPay}>{busy ? <Spinner /> : 'רישום תשלום'}</button>
        </div>
      )}

      {!closed && due < -0.005 && (
        canRefund ? (
          <div className="ui-row" style={{ alignItems: 'flex-end' }}>
            <Field id={`ref-${folio.id}`} label="החזר יתרת זכות">
              <input id={`ref-${folio.id}`} type="number" min={0.01} step={0.01} max={Math.abs(due)} className="input" style={{ width: 130 }} placeholder={Math.abs(due).toFixed(2)} value={refund.amount} onChange={(e) => setRefund((r) => ({ ...r, amount: e.target.value }))} />
            </Field>
            <Field id={`refm-${folio.id}`} label="אמצעי">
              <select id={`refm-${folio.id}`} className="select" value={refund.method} onChange={(e) => setRefund((r) => ({ ...r, method: e.target.value }))}>
                {Object.entries(PAY_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field id={`refr-${folio.id}`} label="סיבה">
              <input id={`refr-${folio.id}`} className="input" style={{ width: 200 }} maxLength={300} value={refund.reason} onChange={(e) => setRefund((r) => ({ ...r, reason: e.target.value }))} />
            </Field>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !(Number(refund.amount) > 0) || refund.reason.trim().length < 3} onClick={doRefund}>{busy ? <Spinner /> : 'רישום החזר'}</button>
          </div>
        ) : <Banner tone="info">יתרת זכות — החזר כספי מבוצע על ידי מנהל או כספים.</Banner>
      )}

      {final && !closed && !isZero(due) && (
        <fieldset className="ui-fieldset" style={{ marginTop: 4 }}>
          <legend className="ui-label">אופן סגירת היתרה ביציאה</legend>
          {due > 0 && company && (
            <label className={`ui-radio ${!company.active ? 'is-disabled' : ''}`}>
              <input type="radio" name={`settle-${folio.id}`} checked={value?.mode === 'company_ar'} disabled={!company.active} onChange={() => onChange({ mode: 'company_ar', reason: value?.reason || '' })} />
              <span>
                {SETTLEMENT_LABELS.company_ar} — {company.name}
                <span className="ui-hint"> · {company.creditLimit > 0 ? `מסגרת ${money(company.creditLimit)}, ניצול ${money(company.exposure)}` : 'אין מסגרת אשראי — דורש מנהל וסיבה'}</span>
              </span>
            </label>
          )}
          <label className={`ui-radio ${!isManager ? 'is-disabled' : ''}`}>
            <input type="radio" name={`settle-${folio.id}`} checked={value?.mode === 'approved_open'} disabled={!isManager} onChange={() => onChange({ mode: 'approved_open', reason: value?.reason || '' })} />
            <span>{SETTLEMENT_LABELS.approved_open}{!isManager && <span className="ui-hint"> — מנהל משמרת או כספים בלבד</span>}</span>
          </label>
          {(value?.mode === 'approved_open' || (value?.mode === 'company_ar' && !(company?.creditLimit > 0))) && (
            <Field id={`sr-${folio.id}`} label="סיבה" required>
              <input id={`sr-${folio.id}`} className="input w-full" maxLength={300} value={value?.reason || ''} onChange={(e) => onChange({ ...value, reason: e.target.value })} />
            </Field>
          )}
          {due > 0 && !value?.mode && <div className="ui-hint">אם האורח משלם — רשמו את התשלום למעלה, והיתרה תתאפס.</div>}
        </fieldset>
      )}
    </div>
  );
}

function ConfirmStep({ ctx, chosen, final, settle, needsSettlement, unsettled, early, earlyReason, propertyId, reload, goTo, onSuccess }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [details, setDetails] = useState(null);

  const issues = [];
  if (!chosen.length) issues.push({ text: 'לא נבחרה יחידה ליציאה', step: 'units' });
  if (early && earlyReason.trim().length < 3) issues.push({ text: 'חסרה סיבת עזיבה מוקדמת', step: 'units' });
  for (const f of unsettled) issues.push({ text: `${f.ownerLabel}: יתרה ${money(Math.abs(f.balance))}${f.balance < 0 ? ' זכות' : ''} — לא נבחר אופן סגירה`, step: 'folios' });

  async function submit() {
    setSaving(true); setError(null); setDetails(null);
    try {
      const out = await frontdesk.checkOut(propertyId, ctx.reservation.id, {
        unitIds: chosen.map((u) => u.unitId).filter(Boolean),
        unitIndexes: chosen.map((u) => u.index),
        settlements: needsSettlement.map((f) => ({ folioId: f.id, mode: settle[f.id]?.mode, reason: settle[f.id]?.reason })),
        early: early ? { reason: earlyReason } : undefined,
      });
      onSuccess(out);
    } catch (e) {
      setError(e.message);
      if (e.details) setDetails(e.details);
      await reload();
    } finally { setSaving(false); }
  }

  return (
    <div className="ui-stack">
      <h3 className="ui-h3">סיכום ואישור</h3>
      <KeyValues rows={[
        ['יוצאים', chosen.map((u) => (u.room ? `חדר ${u.room.number}` : `יחידה ${u.index}`)).join(' · ') || '—'],
        ['סוג יציאה', final ? 'סגירת השהייה' : 'יציאה חלקית — החשבונות נשארים פתוחים'],
        early && ['עזיבה מוקדמת', `במקום ${formatShort(ctx.reservation.departureDate)} · ${earlyReason || '—'}`],
        final && ['חשבונות', ctx.folios.filter((f) => f.status !== 'closed').map((f) => `${f.ownerLabel}: ${isZero(f.balance) ? 'ייסגר' : SETTLEMENT_LABELS[settle[f.id]?.mode] || 'לא נבחר'}`).join(' · ') || '—'],
        ['אחרי היציאה', `החדרים עוברים ל"מלוכלך" ונפתחת משימת ניקיון יציאה`],
      ]} />
      {issues.length > 0 && (
        <div className="ui-issues">
          <div className="ui-label">פריטים פתוחים</div>
          <ul>{issues.map((i, k) => <li key={k} className="is-blocked"><span>{i.text}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => goTo(i.step)}>לטיפול</button></li>)}</ul>
        </div>
      )}
      {error && (
        <div className="ui-banner is-error" role="alert">
          <div>
            <div className="font-medium">{error}</div>
            {details?.length > 0 && <ul className="mt-1 list-disc pr-4">{details.map((d, i) => <li key={i}>{d.label}</li>)}</ul>}
          </div>
        </div>
      )}
      <div className="ui-step-foot">
        {issues.length > 0 && <span className="ui-foot-note">יש פריטים פתוחים</span>}
        <button type="button" className="btn btn-primary" disabled={issues.length > 0 || saving} onClick={submit}>
          {saving ? <><Spinner /> מבצע יציאה…</> : final ? 'סגירת השהייה' : `יציאת ${chosen.length} ${chosen.length === 1 ? 'יחידה' : 'יחידות'}`}
        </button>
      </div>
    </div>
  );
}
