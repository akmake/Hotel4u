// FD-08 — stay closing, one screen. The screen's question: what does the guest still owe, and can
// they leave? Each account of the stay is shown as the bill itself (lines, then the sum that gives the
// balance) beside what to do about it (take payment, refund, or — only if it stays unpaid — how to
// leave it). Leaving the room and settling the money are separate: an account that still owes money is
// never closed silently. The server re-checks everything.
import { useCallback, useEffect, useState } from 'react';
import { DeskAlerts } from '../desk/DeskParts';
import { LogOut, FileText, Check } from 'lucide-react';
import { frontdesk } from '../../utils/api';
import { PAY_METHOD_LABELS, SETTLEMENT_LABELS, DOC_TYPE_LABELS } from '../../lib/labels';
import { formatShort } from '../../utils/date';
import { Field, Spinner, ErrorBanner, Banner, Tag, money, newOpKey } from '../kit';
import PaymentMethodFields, { emptyDetails, detailsMissing, detailsPayload } from '../fin/PaymentMethodFields';
import { IssueDocumentDialog } from '../fin/DocumentDialogs';
import { CheckInFrame } from './CheckInWizard';
import './CheckInWizard.css';

const isZero = (n) => Math.abs(Number(n || 0)) < 0.005;
const HERE = ['in_house', 'checked_in'];
const LINES_SHOWN = 5;

function CheckOutWizardBody({ open, propertyId, reservationId, isManager, canRefund, onClose, onDone, initialEarlyReason = '' }) {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState([]);
  const [settle, setSettle] = useState({}); // folioId → { mode, reason }
  const [earlyReason, setEarlyReason] = useState(initialEarlyReason);
  const [result, setResult] = useState(null);
  const [docFolio, setDocFolio] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [details, setDetails] = useState(null);

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
    setCtx(null); setResult(null); setSettle({}); setEarlyReason(initialEarlyReason || ''); setError(null); setDetails(null);
    load().then((d) => {
      if (!d) return;
      // Everyone in the house leaves by default; deselect to let one room stay.
      setSelected(d.units.filter((u) => HERE.includes(u.status)).map((u) => u.index));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load]);

  const inHouse = (ctx?.units || []).filter((u) => HERE.includes(u.status));
  const chosen = inHouse.filter((u) => selected.includes(u.index));
  const final = chosen.length > 0 && chosen.length === inHouse.length;
  const early = !!ctx?.reservation?.early;
  const openFolios = (ctx?.folios || []).filter((f) => f.status !== 'closed');
  // The final departure settles every account; a room that pays for itself settles its own account
  // when it leaves, while the rest of the group stays.
  const settlesNow = (f) => final || (!!f.unitId && chosen.some((u) => u.unitId === f.unitId));
  const needsSettlement = openFolios.filter((f) => settlesNow(f) && !isZero(f.balance));
  const unsettled = needsSettlement.filter((f) => !settle[f.id]?.mode || (settle[f.id].mode === 'approved_open' && (settle[f.id].reason || '').trim().length < 3));
  const multi = (ctx?.folios || []).length > 1;

  const issues = [];
  if (ctx) {
    if (!chosen.length) issues.push('לא נבחר חדר ליציאה');
    if (early && earlyReason.trim().length < 3) issues.push('חסרה סיבה לעזיבה המוקדמת');
    for (const f of unsettled) {
      const who = multi ? `${f.ownerLabel}: ` : '';
      issues.push(f.balance > 0
        ? `${who}נשארו ${money(f.balance)} לתשלום. קבלו תשלום, או בחרו מה לעשות עם היתרה.`
        : `${who}לאורח מגיע החזר של ${money(Math.abs(f.balance))}. החזירו אותו, או בחרו מה לעשות איתו.`);
    }
  }

  async function submit() {
    setSaving(true); setError(null); setDetails(null);
    try {
      const out = await frontdesk.checkOut(propertyId, ctx.reservation.id, {
        // One way of naming the leaving units: the server refuses ids and indexes together.
        unitIndexes: chosen.map((u) => u.index),
        settlements: needsSettlement.map((f) => ({ folioId: f.id, mode: settle[f.id]?.mode, reason: settle[f.id]?.reason })),
        early: early ? { reason: earlyReason } : undefined,
      });
      setResult(out);
    } catch (e) {
      setError(e.message);
      if (e.details) setDetails(e.details);
      await load();
    } finally { setSaving(false); }
  }

  const rooms = inHouse.map((u) => (u.room ? u.room.number : `יחידה ${u.index}`)).join(', ');
  const title = ctx ? `צ׳ק-אאוט — ${ctx.guest.name}` : 'צ׳ק-אאוט';
  const subtitle = ctx
    ? [rooms && `${inHouse.length > 1 ? 'חדרים' : 'חדר'} ${rooms}`, `${formatShort(ctx.reservation.arrivalDate)}–${formatShort(ctx.reservation.departureDate)}`, `${ctx.reservation.nights} לילות`, ctx.reservation.confirmationNumber].filter(Boolean).join(' · ')
    : '';

  const footer = ctx && !result && (
    <div className="co-foot">
      {error && (
        <div className="ui-banner is-error" role="alert">
          <div>
            <div className="font-medium">{error}</div>
            {details?.length > 0 && <ul className="mt-1 list-disc pr-4">{details.map((d, i) => <li key={i}>{d.label}</li>)}</ul>}
          </div>
        </div>
      )}
      <div className="co-foot-row">
        <p className={`co-foot-msg ${issues.length ? 'is-todo' : 'is-ready'}`}>
          {issues.length
            ? <>{issues[0]}{issues.length > 1 && ` (ועוד ${issues.length - 1})`}</>
            : !final ? 'יציאה חלקית: שאר החדרים נשארים, והחשבון הכללי נשאר פתוח.'
              : needsSettlement.length ? 'היתרה תטופל כפי שבחרת. אחרי הצ׳ק-אאוט החדר עובר לניקיון.'
                : <><Check size={16} aria-hidden="true" />הכל שולם. אחרי הצ׳ק-אאוט החדר עובר לניקיון.</>}
        </p>
        <button type="button" className="btn btn-primary" disabled={issues.length > 0 || saving} onClick={submit}>
          {saving ? <><Spinner /> מבצע…</> : final ? 'סיום צ׳ק-אאוט' : `צ׳ק-אאוט ל${chosen.length === 1 ? 'חדר אחד' : `־${chosen.length} חדרים`}`}
        </button>
      </div>
    </div>
  );

  return (
    <CheckInFrame className="co" variant="accordion" open={open} onClose={result ? onDone : onClose} title={title} subtitle={subtitle} footer={footer}>
      {loadError && <ErrorBanner error={loadError} onRetry={load} />}
      {!ctx && loading && <div className="ui-empty"><Spinner /> טוען את החשבון…</div>}
      {ctx && result ? (
        <div className="ui-result" role="status">
          <div className="ui-result-icon"><LogOut size={20} /></div>
          <h3 className="ui-h3">{result.status === 'checked_out' ? 'הצ׳ק-אאוט הושלם' : 'היציאה החלקית נרשמה'}</h3>
          <p className="ui-p">
            {result.checkedOutUnits.length} {result.checkedOutUnits.length === 1 ? 'חדר יצא' : 'חדרים יצאו'}
            {result.remainingUnits > 0 && ` · ${result.remainingUnits} נשארים`}
            {result.housekeepingTasks > 0 && ` · נפתחו ${result.housekeepingTasks} משימות ניקיון`}
            {result.nightsPosted > 0 && ` · ${result.nightsPosted} לילות נרשמו לחשבון`}
          </p>
          {result.openFolios?.length > 0 && (
            <Banner tone="warn">
              {result.openFolios.length} {result.openFolios.length === 1 ? 'חשבון נשאר פתוח' : 'חשבונות נשארו פתוחים'}. הם מופיעים ברשימת העזיבות, עם הסיבה ומי אישר.
            </Banner>
          )}
          {ctx.folios?.length > 0 && (
            <div className="ui-row" style={{ justifyContent: 'center' }}>
              {ctx.folios.map((f) => (
                <button key={f.id} type="button" className="btn btn-secondary btn-sm" onClick={() => setDocFolio(f)}><FileText size={14} />חשבונית / קבלה{multi ? ` · ${f.ownerLabel}` : ''}</button>
              ))}
            </div>
          )}
          <div className="ui-step-foot"><button type="button" className="btn btn-primary" onClick={onDone}>חזרה לעזיבות</button></div>
        </div>
      ) : ctx && (
        <>
          {inHouse.length > 1 && (
            <section className="co-panel" aria-labelledby="co-units-h">
              <h3 id="co-units-h" className="co-h">מי עוזב עכשיו?</h3>
              <div className="co-units">
                {ctx.units.map((u) => {
                  const here = HERE.includes(u.status);
                  const on = here && selected.includes(u.index);
                  return (
                    <label key={u.index} className={`co-unit ${on ? 'is-on' : ''} ${here ? '' : 'is-gone'}`}>
                      <input type="checkbox" disabled={!here} checked={on} onChange={() => setSelected((s) => (s.includes(u.index) ? s.filter((x) => x !== u.index) : [...s, u.index]))} />
                      <strong>{u.room ? `חדר ${u.room.number}` : `יחידה ${u.index}`}</strong>
                      <small>{here ? 'בבית' : u.status === 'checked_out' ? 'כבר יצא' : 'לא נכנס'}</small>
                    </label>
                  );
                })}
              </div>
              {!final && chosen.length > 0 && <p className="co-note">יציאה חלקית: החשבון הכללי נשאר פתוח עד שהחדר האחרון יוצא. חדר שהאורח בו משלם בעצמו נסגר עכשיו.</p>}
            </section>
          )}

          {early && (
            <section className="co-panel" aria-labelledby="co-early-h">
              <h3 id="co-early-h" className="co-h">עזיבה לפני התאריך</h3>
              <p className="co-note">היציאה המתוכננת: {formatShort(ctx.reservation.departureDate)}. הלילות שלא נוצלו חוזרים למלאי. לילות שכבר חויבו נשארים בחשבון, והחזר עליהם נעשה בנפרד.</p>
              <Field id="early-reason" label="למה האורח עוזב מוקדם?" required>
                <input id="early-reason" className="input w-full" maxLength={300} value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)} />
              </Field>
            </section>
          )}

          {ctx.openRequests > 0 && <p className="co-flag">יש {ctx.openRequests} בקשות אורח שעדיין פתוחות.</p>}

          {ctx.folios.length === 0 && <section className="co-panel"><p className="co-note">אין חשבונות לשהייה הזו.</p></section>}
          {ctx.folios.map((f) => (
            <FolioBlock
              key={f.id}
              folio={f}
              ctx={ctx}
              propertyId={propertyId}
              reload={load}
              final={settlesNow(f)}
              value={settle[f.id]}
              onChange={(v) => setSettle((s) => ({ ...s, [f.id]: v }))}
              isManager={isManager}
              canRefund={canRefund}
              onIssue={setDocFolio}
              multi={multi}
            />
          ))}

          {ctx.documents?.length > 0 && (
            <div className="co-docs">
              <span>מסמכים שהופקו:</span>
              {ctx.documents.map((d) => <Tag key={d.id} tone={d.allocation === 'pending' || d.allocation === 'rejected' ? 'warn' : undefined}>{DOC_TYPE_LABELS[d.type] || d.type} {d.number || ''}{d.allocation === 'pending' ? ' · ממתין למספר הקצאה' : d.allocation === 'rejected' ? ' · הקצאה סורבה' : ''}</Tag>)}
            </div>
          )}
        </>
      )}
      <IssueDocumentDialog open={!!docFolio} onClose={() => setDocFolio(null)} propertyId={propertyId} folioId={docFolio?.id} subtitle={docFolio ? `${ctx?.reservation?.confirmationNumber || ''} · ${docFolio.ownerLabel}` : ''} onIssued={() => { if (!result) load(); }} />
    </CheckInFrame>
  );
}

// One account: the bill on one side (its latest lines and the sum that gives the balance), and what to
// do about the balance on the other.
function FolioBlock({ folio, ctx, propertyId, reload, final, value, onChange, isManager, canRefund, onIssue, multi }) {
  const due = folio.balance;
  const closed = folio.status === 'closed';
  const owes = due > 0.005;
  const credit = due < -0.005;
  const pending = folio.pendingNights?.count > 0 ? folio.pendingNights : null;
  const [allLines, setAllLines] = useState(false);
  // A bill reads in date order; collapsed, it shows the latest lines.
  const lines = [...(folio.recent || [])].sort((a, b) => String(a.serviceDate).localeCompare(String(b.serviceDate)));
  const hidden = allLines ? 0 : Math.max(0, lines.length - LINES_SHOWN);
  const shown = lines.slice(hidden);

  return (
    <section className="co-folio" aria-labelledby={`co-f-${folio.id}`}>
      <div className="co-bill">
        <header className="co-bill-head">
          <h3 id={`co-f-${folio.id}`} className="co-h">{multi ? folio.ownerLabel : 'החשבון'}</h3>
          {closed && <Tag>סגור</Tag>}
          {folio.settlement && <Tag tone="warn">{SETTLEMENT_LABELS[folio.settlement.mode]}</Tag>}
        </header>
        {lines.length > 0 ? (
          <>
            {lines.length > LINES_SHOWN && (
              <button type="button" className="co-link" onClick={() => setAllLines((v) => !v)}>{allLines ? 'רק התנועות האחרונות' : `עוד ${hidden} תנועות קודמות`}</button>
            )}
            <table className="co-lines">
              <caption className="sr-only">תנועות אחרונות בחשבון</caption>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id}>
                    <td className="co-date">{formatShort(l.serviceDate)}</td>
                    <td className="co-desc">{l.description}</td>
                    <td className={`co-num ${l.amount < 0 ? 'is-pay' : ''}`}>{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <p className="co-note">אין עדיין תנועות בחשבון.</p>}
        <dl className="co-sum">
          <div><dt>סה״כ חיובים</dt><dd className="co-num">{money(folio.charges)}</dd></div>
          <div><dt>שולם</dt><dd className="co-num">{money(isZero(folio.payments) ? 0 : -folio.payments)}</dd></div>
          {pending && <div><dt>{pending.count} לילות שיירשמו בצ׳ק-אאוט</dt><dd className="co-num">+{money(pending.gross)}</dd></div>}
          <div className="is-total">
            <dt>{credit ? 'זכות לאורח' : 'נשאר לתשלום'}</dt>
            <dd className={`co-num ${owes ? 'is-due' : credit ? 'is-credit' : 'is-zero'}`}>{money(Math.abs(due))}</dd>
          </div>
        </dl>
      </div>

      <div className="co-act">
        {closed ? (
          <p className="co-note">החשבון סגור.</p>
        ) : owes ? (
          <PayPanel folio={folio} ctx={ctx} propertyId={propertyId} reload={reload} pending={pending} />
        ) : credit ? (
          <RefundPanel folio={folio} propertyId={propertyId} reload={reload} canRefund={canRefund} />
        ) : (
          <div className="co-paid">
            <Check size={20} aria-hidden="true" />
            <div><strong>שולם במלואו</strong><span>אין מה לגבות בחשבון הזה.</span></div>
          </div>
        )}

        {final && !closed && !isZero(due) && <SettleChoice folio={folio} owes={owes} value={value} onChange={onChange} isManager={isManager} />}

        {(folio.undocumented?.charges > 0.005 || folio.undocumented?.payments > 0.005) && onIssue && (
          <button type="button" className="co-link co-doc" onClick={() => onIssue(folio)}><FileText size={14} aria-hidden="true" />הפקת חשבונית / קבלה</button>
        )}
      </div>
    </section>
  );
}

function PayPanel({ folio, ctx, propertyId, reload, pending }) {
  // Payment covers what is posted; nights still to be posted join the bill at check-out.
  const payable = Math.max(0, Number(folio.postedBalance || 0));
  const [amount, setAmount] = useState(null); // null = the whole payable balance
  const [method, setMethod] = useState('cash');
  const [key, setKey] = useState(newOpKey);
  const [payDetails, setPayDetails] = useState(emptyDetails('cash'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const value = amount ?? (payable > 0.005 ? payable.toFixed(2) : '');
  const num = Number(value);
  const payMissing = detailsMissing(method, payDetails, num);

  async function pay() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const out = await frontdesk.payFolio(propertyId, folio.id, { amount: num, method, details: detailsPayload(method, payDetails), idempotencyKey: key });
      setNotice(`התקבלו ${money(num)}${out?.change ? ` · עודף לאורח ${money(out.change)}` : ''}`);
      setAmount(null); setKey(newOpKey()); setPayDetails(emptyDetails(method));
      await reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function postNights() {
    setBusy(true); setError(null);
    try { const r = await frontdesk.postNights(propertyId, ctx.reservation.id); setNotice(`${r.posted} לילות נרשמו לחשבון`); setAmount(null); await reload(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="co-pay">
      <h4 className="co-h4">קבלת תשלום</h4>
      <ErrorBanner error={error} />
      {notice && <p className="co-ok"><Check size={14} aria-hidden="true" />{notice}</p>}
      {pending && (
        <p className="co-note">
          {payable > 0.005 ? `אפשר לגבות עכשיו ${money(payable)}. ` : ''}{pending.count} הלילות ({money(pending.gross)}) נרשמים לחשבון בצ׳ק-אאוט.
          {' '}<button type="button" className="co-link" disabled={busy} onClick={postNights}>לרשום אותם עכשיו ולגבות הכל</button>
        </p>
      )}
      {payable > 0.005 && (
        <>
          <div className="co-fields">
            <Field id={`pay-${folio.id}`} label="סכום">
              <input id={`pay-${folio.id}`} type="number" inputMode="decimal" min={0.01} step={0.01} max={payable} className="input" value={value} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field id={`paym-${folio.id}`} label="אמצעי תשלום">
              <select id={`paym-${folio.id}`} className="select" value={method} onChange={(e) => { setMethod(e.target.value); setPayDetails(emptyDetails(e.target.value)); }}>
                {Object.entries(PAY_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
          {(method !== 'cash' || num > 0) && (
            <PaymentMethodFields idPrefix={`payd-${folio.id}`} method={method} amount={num} value={payDetails} onChange={setPayDetails} />
          )}
          <button type="button" className="btn btn-primary co-wide" disabled={busy || !(num > 0) || !!payMissing} title={payMissing || undefined} onClick={pay}>
            {busy ? <Spinner /> : `קבלת ${money(num > 0 ? num : 0)}`}
          </button>
          {payMissing && <p className="co-note">{payMissing}</p>}
        </>
      )}
    </div>
  );
}

function RefundPanel({ folio, propertyId, reload, canRefund }) {
  const sources = folio.refundable || [];
  const [source, setSource] = useState(sources[0]?.id || '');
  const picked = sources.find((p) => p.id === source) || null;
  const max = Math.min(Math.abs(folio.balance), picked ? picked.refundable : Infinity);
  const [amount, setAmount] = useState(null);
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newOpKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const value = amount ?? max.toFixed(2);
  const num = Number(value);

  if (!canRefund) return <p className="co-note">לאורח מגיע החזר של {money(max)}. את ההחזר מבצע מנהל משמרת או כספים.</p>;

  async function refund() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await frontdesk.refundFolio(propertyId, folio.id, picked ? { amount: num, paymentLineId: picked.id, reason, idempotencyKey: key } : { amount: num, method, reason, idempotencyKey: key });
      setNotice(`הוחזרו ${money(num)}`);
      setAmount(null); setReason(''); setKey(newOpKey());
      await reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="co-pay">
      <h4 className="co-h4">החזר לאורח</h4>
      <ErrorBanner error={error} />
      {notice && <p className="co-ok"><Check size={14} aria-hidden="true" />{notice}</p>}
      <div className="co-fields">
        <Field id={`ref-${folio.id}`} label="סכום">
          <input id={`ref-${folio.id}`} type="number" inputMode="decimal" min={0.01} step={0.01} max={max} className="input" value={value} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {sources.length > 0 ? (
          <Field id={`refs-${folio.id}`} label="מאיזה תשלום">
            <select id={`refs-${folio.id}`} className="select" value={source} onChange={(e) => { setSource(e.target.value); setAmount(null); }}>
              {sources.map((p) => (
                <option key={p.id} value={p.id}>
                  {PAY_METHOD_LABELS[p.method] || 'תשלום'}{p.last4 ? ` ••${p.last4}` : ''} · {money(p.amount)}{p.refundable < p.amount ? ` (נותרו ${money(p.refundable)})` : ''}
                </option>
              ))}
              <option value="">אחר — בלי תשלום מקור</option>
            </select>
          </Field>
        ) : null}
        {!picked && (
          <Field id={`refm-${folio.id}`} label="אמצעי החזר">
            <select id={`refm-${folio.id}`} className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(PAY_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field id={`refr-${folio.id}`} label="סיבה">
        <input id={`refr-${folio.id}`} className="input w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <button type="button" className="btn btn-primary co-wide" disabled={busy || !(num > 0) || reason.trim().length < 3} onClick={refund}>{busy ? <Spinner /> : `החזר של ${money(num > 0 ? num : 0)}`}</button>
    </div>
  );
}

// Only when the balance stays: how the account is left at check-out.
function SettleChoice({ folio, owes, value, onChange, isManager }) {
  const company = folio.company;
  const [open, setOpen] = useState(!!value?.mode);
  const needsReason = value?.mode === 'approved_open' || (value?.mode === 'company_ar' && !(company?.creditLimit > 0));
  if (!open) {
    return <button type="button" className="co-link" onClick={() => setOpen(true)}>{owes ? 'האורח לא משלם עכשיו?' : 'לא מחזירים עכשיו?'}</button>;
  }
  return (
    <fieldset className="co-settle">
      <legend>{owes ? 'אם האורח לא משלם עכשיו' : 'אם לא מחזירים עכשיו'}</legend>
      {owes && company && (
        <label className={`co-radio ${!company.active ? 'is-disabled' : ''}`}>
          <input type="radio" name={`settle-${folio.id}`} checked={value?.mode === 'company_ar'} disabled={!company.active} onChange={() => onChange({ mode: 'company_ar', reason: value?.reason || '' })} />
          <span>
            <strong>לחייב את {company.name}</strong>
            <small>{company.creditLimit > 0 ? `מסגרת ${money(company.creditLimit)}, מנוצל ${money(company.exposure)}` : 'אין לחברה מסגרת אשראי, לכן צריך מנהל וסיבה'}</small>
          </span>
        </label>
      )}
      <label className={`co-radio ${!isManager ? 'is-disabled' : ''}`}>
        <input type="radio" name={`settle-${folio.id}`} checked={value?.mode === 'approved_open'} disabled={!isManager} onChange={() => onChange({ mode: 'approved_open', reason: value?.reason || '' })} />
        <span>
          <strong>{owes ? 'להשאיר את החוב פתוח' : 'להשאיר את הזכות פתוחה'}</strong>
          <small>{isManager ? 'החשבון יופיע ברשימת העזיבות עם הסיבה' : 'רק מנהל משמרת או כספים'}</small>
        </span>
      </label>
      {needsReason && (
        <Field id={`sr-${folio.id}`} label="סיבה" required>
          <input id={`sr-${folio.id}`} className="input w-full" maxLength={300} value={value?.reason || ''} onChange={(e) => onChange({ ...value, reason: e.target.value })} />
        </Field>
      )}
      {value?.mode && <button type="button" className="co-link" onClick={() => { onChange(undefined); setOpen(false); }}>ביטול הבחירה</button>}
    </fieldset>
  );
}

// Alerts set on the reservation pop up when the wizard opens (gap-map item 4).
export default function CheckOutWizard(props) {
  return (
    <>
      <CheckOutWizardBody {...props} />
      <DeskAlerts open={!!props.open} propertyId={props.propertyId} reservationId={props.reservationId} moment="check_out" />
    </>
  );
}
