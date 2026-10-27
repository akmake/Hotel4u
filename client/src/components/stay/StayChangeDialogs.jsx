// Stay-change dialogs: FD-09 room move, FD-10 extension, FD-11 early departure (preview, then the
// checkout wizard), RSV-05 booking change and RSV-06 cancellation notice. Each shows the
// consequences from the server first; the commit re-checks everything.
import { useEffect, useMemo, useState } from 'react';
import { stay } from '../../utils/api';
import { Modal, Field, ErrorBanner, Banner, Spinner, KeyValues, Tag, useAction, useLoader, money } from '../kit';
import { formatShort, formatLong, addDays } from '../../utils/date';
import { cleanLabel, TICKET_CATEGORY_LABELS } from '../../lib/labels';

// Fallback only — the server sends the reasons with who initiated them (pricing rule).
const MOVE_REASONS_FALLBACK = [
  { value: 'guest_request', label: 'בקשת האורח', guestInitiated: true }, { value: 'upgrade_sold', label: 'שדרוג בתשלום (האורח ביקש)', guestInitiated: true, onlyUp: true },
  { value: 'maintenance', label: 'תקלה בחדר', guestInitiated: false }, { value: 'hotel_need', label: 'צורך של המלון (תפוסה/שיבוץ)', guestInitiated: false },
  { value: 'upgrade_free', label: 'שדרוג מטעם המלון', guestInitiated: false, onlyUp: true }, { value: 'other', label: 'אחר', guestInitiated: false },
];
const EARLY_REASONS = { guest_request: 'בקשת האורח', service_issue: 'תקלה או שירות', event: 'אירוע אישי', other: 'אחר' };
const CHANNELS = { phone: 'טלפון', email: 'דוא״ל', web: 'אתר', desk: 'בדלפק', ota: 'ערוץ הזמנות (OTA)', company: 'חברה', other: 'אחר' };
const TRACKS = {
  regular: { label: 'רגיל', hint: 'צרכן שרכש מרחוק' },
  protected: { label: 'אוכלוסייה מוגנת', hint: 'אזרח ותיק, אדם עם מוגבלות, עולה חדש — תנאים מורחבים, נדרשת בדיקה' },
  contractual: { label: 'חוזי', hint: 'מכירה בדלפק/לחברה או לפי תנאי ההזמנה' },
  review: { label: 'לבירור', hint: 'לא ברור — ההחלטה תועבר לבדיקה' },
};
const CANCEL_REASONS = { regret: 'חרטה', service_failure: 'כשל שירות / אי־התאמה', other: 'אחר' };

function Footer({ action, onClose, label, why, danger, onSubmit }) {
  return (
    <>
      {why && <span className="ui-foot-note">{why}</span>}
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
      <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={action.busy || !!why} onClick={onSubmit}>{action.busy ? <><Spinner /> שומר…</> : label}</button>
    </>
  );
}

function localNow() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── FD-09 ───────────────────────────────────────────────────────────────────
// Pricing rule (hotel practice): the agreed price stays by default. Only the remaining nights can be
// repriced; a hotel-initiated move never costs the guest more; a higher price needs the guest's
// consent; any change is a manager decision with a reason. The server enforces the same.
// The price follows the reason: choosing who initiated the move pre-selects the price that fits it
// (hotel → agreed price; guest → the new room's rate), and every hint speaks about this exact move.
const nightsLabel = (n) => (n === 1 ? 'הלילה שנותר' : `${n} הלילות שנותרו`);

export function MoveRoomDialog({ open, onClose, propertyId, reservationId, unitId, fromRoomId, initialRoomId, canChangePrice, onDone }) {
  const action = useAction();
  const { data, loading, error } = useLoader(() => (open ? stay.moveCandidates(propertyId, reservationId, unitId, fromRoomId) : null), [open, reservationId, unitId, fromRoomId]);
  const [f, setF] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [picking, setPicking] = useState(!initialRoomId);
  const [priceTouched, setPriceTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setF({ requestKey: crypto.randomUUID(), roomId: initialRoomId || '', reason: '', note: '', faultCategory: '', faultBlock: true, keyRequested: true, priceMode: 'keep', rate: '', rateReason: '', guestConsentRef: '' });
      setShowAll(false); setPicking(!initialRoomId); setPriceTouched(false); action.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const rooms = (data?.rooms || []).filter((r) => showAll || r.available || r.id === f.roomId);
  const allReasons = data?.pricing?.reasons || MOVE_REASONS_FALLBACK;
  const target0 = (data?.rooms || []).find((r) => r.id === f.roomId) || null;
  // "Upgrade" reasons exist only when the target is a higher category than the room left.
  const reasons = allReasons.filter((r) => !r.onlyUp || target0?.direction === 'up');
  const reason = reasons.find((r) => r.value === f.reason);
  useEffect(() => { if (f.reason && !reason) setF((p) => ({ ...p, reason: '' })); }, [f.reason, reason]); // eslint-disable-line react-hooks/exhaustive-deps
  const guestInitiated = !!reason?.guestInitiated;
  const target = (data?.rooms || []).find((r) => r.id === f.roomId) || null;
  const pricing = data?.pricing;
  const agreed = pricing?.agreed?.total ?? null;
  const targetPrice = target?.roomType ? pricing?.byType?.[target.roomType.id] : null;
  const targetTotal = targetPrice?.total ?? null;
  const nights = pricing?.nights || 0;
  const targetDiff = targetTotal !== null && agreed !== null ? Math.round((targetTotal - agreed) * 100) / 100 : null;
  const pricier = targetDiff !== null && targetDiff > 0.005;
  const cheaper = targetDiff !== null && targetDiff < -0.005;
  const manualTotal = f.rate ? Math.round(Number(f.rate) * nights * 100) / 100 : null;
  const newTotal = f.priceMode === 'target' ? targetTotal : f.priceMode === 'manual' ? manualTotal : agreed;
  const diff = agreed !== null && newTotal !== null ? Math.round((newTotal - agreed) * 100) / 100 : 0;
  const increase = f.priceMode !== 'keep' && diff > 0.005;
  const targetWhy = targetTotal === null ? (pricing?.ratePlan ? 'אין מחיר בלוח התעריפים לחדר היעד בכל הלילות' : 'להזמנה אין תעריף — אין מחיר להשוואה')
    : !pricier && !cheaper ? 'אותו מחיר כמו שהוסכם'
      : pricier && target?.direction !== 'up' ? 'החדר אינו בקטגוריה גבוהה יותר — לא מחייבים יותר מהמחיר שהוסכם'
      : pricier && !f.reason ? 'בחרו קודם מי יזם את המעבר'
        : pricier && !guestInitiated ? 'המעבר ביוזמת המלון — לא מחייבים את האורח יותר' : null;

  // Sync: the reason (and the room) decide the suggested price, until the user picks a price by hand.
  useEffect(() => {
    if (!data || priceTouched) return;
    let mode = 'keep';
    if (f.reason && guestInitiated && canChangePrice && !targetWhy && (pricier || cheaper)) mode = 'target';
    setF((p) => (p.priceMode === mode ? p : { ...p, priceMode: mode }));
  }, [f.reason, f.roomId, data, priceTouched, targetWhy]); // eslint-disable-line react-hooks/exhaustive-deps
  // A rule change can make the chosen price illegal (e.g. switched to a hotel-initiated reason).
  useEffect(() => { if (f.priceMode === 'target' && targetWhy) setF((p) => ({ ...p, priceMode: 'keep' })); }, [targetWhy]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickPrice = (mode) => { setPriceTouched(true); set('priceMode')(mode); };

  // Hints that describe this move, not the rule in general.
  const dir = target?.direction || 'same';
  const keepHint = !f.reason ? 'ברירת המחדל — בחרו מי יזם את המעבר'
    : dir === 'same' ? 'אותה קטגוריה — המחיר לא משתנה'
      : !guestInitiated && dir === 'up' ? 'שדרוג חינם — האורח לא משלם יותר'
        : !guestInitiated ? 'האורח ממשיך לשלם כפי שהוסכם (אפשר להוריד כפיצוי — מחיר ידני)'
          : dir === 'up' ? 'האורח עובר לקטגוריה גבוהה יותר בלי תוספת'
            : 'האורח ממשיך לשלם את המחיר המקורי למרות הקטגוריה הנמוכה';
  const targetHint = !canChangePrice ? 'שינוי מחיר — מנהל משמרת ומעלה' : targetWhy || (cheaper ? 'האורח משלם פחות על הלילות שנותרו' : 'האורח משלם יותר — נדרש אישור שלו');
  const soldWithoutPrice = f.reason === 'upgrade_sold' && f.priceMode === 'keep';

  const noNights = !!data && nights <= 0;
  const isFault = f.reason === 'maintenance';
  let why = null;
  if (noNights) why = 'אין לילות שנותרו';
  else if (!f.roomId) why = 'יש לבחור חדר יעד';
  else if (target && !target.available) why = 'חדר היעד אינו זמין';
  else if (!f.reason) why = 'יש לבחור מי יזם את המעבר';
  else if (f.reason === 'other' && f.note.trim().length < 3) why = 'יש לפרט';
  else if (isFault && !f.faultCategory) why = 'יש לבחור סוג תקלה';
  else if (isFault && f.note.trim().length < 3) why = 'מה התקלה?';
  else if (f.priceMode === 'manual' && !(Number(f.rate) > 0)) why = 'יש להזין מחיר ללילה';
  else if (increase && target?.direction !== 'up') why = 'בלי שדרוג לא מעלים מחיר';
  else if (increase && !guestInitiated) why = 'במעבר ביוזמת המלון לא מעלים מחיר';
  else if (f.priceMode !== 'keep' && f.rateReason.trim().length < 3) why = 'סיבה לשינוי המחיר';
  else if (increase && f.guestConsentRef.trim().length < 2) why = 'נדרש אישור האורח להעלאת המחיר';
  const submit = () => action.run(async () => {
    const out = await stay.move(propertyId, reservationId, {
      requestKey: f.requestKey, fromRoomId: data.current, unitId: data.unitId, roomId: f.roomId, reason: f.reason, note: f.note || undefined, keyRequested: f.keyRequested,
      ...(isFault ? { fault: { category: f.faultCategory, block: f.faultBlock } } : {}),
      priceMode: f.priceMode,
      ...(f.priceMode === 'manual' ? { rate: Number(f.rate) } : {}),
      ...(f.priceMode !== 'keep' ? { rateReason: f.rateReason, guestConsentRef: f.guestConsentRef || undefined } : {}),
    });
    onDone?.(out);
  });
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  const cur = data?.currentRoom;
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={640} title="מעבר חדר" subtitle={data && !noNights ? `${formatShort(data.from)} – ${formatShort(data.to)} · ${nightsLabel(nights)} · לילות שהושלמו לא משתנים` : ''} footer={<Footer action={action} onClose={onClose} label={target ? `העברה לחדר ${target.number}` : 'אישור מעבר'} why={why} onSubmit={submit} />}>
      <ErrorBanner error={error || action.error} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען חדרים ומחירים…</div>}
      {noNights && (
        <Banner tone="warn">
          {data.to < data.from ? `מועד העזיבה של האורח (${formatShort(data.to)}) כבר עבר והוא עדיין בבית.` : 'האורח עוזב היום — אין לילה להעביר.'}
          {' '}אם הוא נשאר: קודם "הארכת שהייה" בתיק ההזמנה, ואז מעבר חדר.
        </Banner>
      )}
      {data && !noNights && (
        <>
          <div className="ui-summary">
            <div className="ui-sum-row"><span>מחדר</span><strong>{cur ? `${cur.number} · ${cur.roomType?.name || ''}` : '—'}</strong></div>
            <div className="ui-sum-row">
              <span>לחדר</span>
              <strong>
                {target ? `${target.number} · ${target.roomType?.name || ''}${target.direction === 'up' ? ' · קטגוריה גבוהה יותר' : target.direction === 'down' ? ' · קטגוריה נמוכה יותר' : ''}${target.available ? '' : ` — ${target.why}`}` : 'לא נבחר'}
                {target && targetDiff !== null && Math.abs(targetDiff) > 0.005 && <span className="ui-sub"> · לפי לוח התעריפים {signed(targetDiff)}</span>}
              </strong>
            </div>
            {!picking && <div className="ui-sum-row"><span /><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>בחירת חדר אחר</button></div>}
          </div>
          {picking && (
            <>
              <div className="ui-row" style={{ justifyContent: 'space-between' }}>
                <span className="ui-label">חדר יעד · חובה</span>
                <label className="ui-switch"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />הצגת חדרים לא זמינים</label>
              </div>
              {rooms.length === 0 && <div className="ui-sub">אין חדר פנוי ומוכן לכל הטווח.</div>}
              <ul className="ui-results" style={{ maxHeight: 200 }}>
                {rooms.map((r) => {
                  const t = r.roomType ? pricing?.byType?.[r.roomType.id] : null;
                  const d = t?.total != null && agreed != null ? Math.round((t.total - agreed) * 100) / 100 : null;
                  return (
                    <li key={r.id}>
                      <button type="button" disabled={!r.available} aria-pressed={f.roomId === r.id} style={f.roomId === r.id ? { background: 'rgb(var(--accent-50))' } : undefined} onClick={() => { set('roomId')(r.id); setPicking(false); }}>
                        <span>חדר {r.number} · {r.roomType?.name}{r.direction === 'up' ? <Tag>קטגוריה גבוהה יותר</Tag> : r.direction === 'down' ? <Tag tone="warn">קטגוריה נמוכה יותר</Tag> : !r.sameType ? <Tag>סוג אחר</Tag> : null}</span>
                        <span className="ui-sub">{r.available ? `קומה ${r.floor} · ${cleanLabel(r.cleanStatus)}${d !== null && Math.abs(d) > 0.005 ? ` · ${signed(d)}` : ''}` : r.why}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="ui-grid-2">
            <Field id="mv-r" label="מי יזם את המעבר ולמה" required error={action.fields.reason}>
              <select id="mv-r" className="select w-full" value={f.reason} onChange={(e) => set('reason')(e.target.value)}>
                <option value="">בחירה…</option>
                <optgroup label="ביוזמת האורח">{reasons.filter((r) => r.guestInitiated).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</optgroup>
                <optgroup label="ביוזמת המלון">{reasons.filter((r) => !r.guestInitiated).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</optgroup>
              </select>
            </Field>
            <Field id="mv-n" label={isFault ? 'מה התקלה?' : 'פירוט'} required={f.reason === 'other' || isFault} optional={f.reason !== 'other' && !isFault} error={action.fields.note}>
              <input id="mv-n" className="input w-full" maxLength={300} value={f.note} onChange={(e) => set('note')(e.target.value)} placeholder={isFault ? 'למשל: המזגן לא מקרר' : undefined} />
            </Field>
          </div>
          {isFault && (
            <div className="ui-sub-card">
              <div className="ui-label">תקלה בחדר {data.currentRoom?.number || ''} — תיפתח תקלה בתחזוקה</div>
              <div className="ui-grid-2">
                <Field id="mv-fc" label="סוג התקלה" required error={action.fields.faultCategory}>
                  <select id="mv-fc" className="select w-full" value={f.faultCategory} onChange={(e) => set('faultCategory')(e.target.value)}>
                    <option value="">בחירה…</option>
                    {Object.entries(TICKET_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <label className="ui-check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.faultBlock} onChange={(e) => set('faultBlock')(e.target.checked)} /><span>לחסום את החדר למכירה עד התיקון</span></label>
              </div>
              <div className="ui-sub">{f.faultBlock ? 'החדר יסומן "לא תקין" ולא יימכר ולא ישובץ עד שמנהל תחזוקה ישחרר אותו.' : 'החדר יישאר זמין למכירה — רק אם התקלה לא מפריעה לאורח הבא.'} אם כבר פתוחה תקלה לחדר — המעבר יירשם בה ולא תיפתח כפולה.</div>
            </div>
          )}

          {target && agreed !== null && (
            <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
              <legend className="ui-label">מחיר ל{nightsLabel(nights)}</legend>
              <label className="ui-radio">
                <input type="radio" name="mv-price" checked={f.priceMode === 'keep'} onChange={() => pickPrice('keep')} />
                <span>המחיר שהוסכם נשמר · {money(agreed)}<span className="ui-sub" style={{ display: 'block' }}>{keepHint}</span></span>
              </label>
              <label className={`ui-radio ${!canChangePrice || targetWhy ? 'is-disabled' : ''}`}>
                <input type="radio" name="mv-price" disabled={!canChangePrice || !!targetWhy} checked={f.priceMode === 'target'} onChange={() => pickPrice('target')} />
                <span>
                  מחיר החדר החדש לפי לוח התעריפים{targetTotal !== null ? ` · ${money(targetTotal)}${targetDiff ? ` (${signed(targetDiff)})` : ''}` : ''}
                  <span className="ui-sub" style={{ display: 'block' }}>{targetHint}</span>
                </span>
              </label>
              <label className={`ui-radio ${!canChangePrice ? 'is-disabled' : ''}`}>
                <input type="radio" name="mv-price" disabled={!canChangePrice} checked={f.priceMode === 'manual'} onChange={() => pickPrice('manual')} />
                <span>מחיר ידני ללילה<span className="ui-sub" style={{ display: 'block' }}>{canChangePrice ? (guestInitiated && target?.direction === 'up' ? 'מחיר מוסכם אחר עם האורח' : 'פיצוי — רק מחיר נמוך יותר') : 'מנהל משמרת ומעלה'}</span></span>
              </label>
              {soldWithoutPrice && <Banner tone="warn">נבחר "שדרוג בתשלום" אבל המחיר לא משתנה. אם זה שדרוג חינם — בחרו "שדרוג מטעם המלון".</Banner>}
              {!canChangePrice && guestInitiated && (pricier || cheaper) && <Banner tone="info">שינוי המחיר דורש מנהל משמרת. אפשר להעביר עכשיו במחיר שהוסכם, או לבקש ממנהל לבצע את המעבר.</Banner>}
              {f.priceMode === 'manual' && (
                <Field id="mv-rate" label="מחיר ללילה (כולל מע״מ)" required error={action.fields.rate}><input id="mv-rate" type="number" min="1" step="0.01" className="input w-full" value={f.rate} onChange={(e) => set('rate')(e.target.value)} /></Field>
              )}
              {f.priceMode !== 'keep' && (
                <div className="ui-grid-2">
                  <Field id="mv-rr" label="סיבת שינוי המחיר" required error={action.fields.rateReason}><input id="mv-rr" className="input w-full" maxLength={300} value={f.rateReason} onChange={(e) => set('rateReason')(e.target.value)} placeholder={guestInitiated ? 'למשל: שדרוג לחדר משפחה לבקשת האורח' : 'למשל: פיצוי על תקלה'} /></Field>
                  {increase && <Field id="mv-gc" label="אישור האורח" required error={action.fields.guestConsentRef} hint="איך ומתי אישר (טלפון, חתימה, הודעה)"><input id="mv-gc" className="input w-full" maxLength={120} value={f.guestConsentRef} onChange={(e) => set('guestConsentRef')(e.target.value)} /></Field>}
                </div>
              )}
              {f.priceMode !== 'keep' && newTotal !== null && (
                <KeyValues rows={[['שהוסכם', money(agreed)], ['חדש', money(newTotal)], ['הפרש לאורח', signed(diff)]]} />
              )}
            </fieldset>
          )}
          <label className="ui-check"><input type="checkbox" checked={f.keyRequested} onChange={(e) => set('keyRequested')(e.target.checked)} /><span>נדרש מפתח לחדר החדש (אין ספק מפתחות מחובר — יופיע כמשימה)</span></label>
          <div className="ui-sub">החדר הקודם יעבור לניקיון ותיפתח משימת חדרנות. המחיר החדש נכנס למחיר הלילה — סגירת היום תחייב לפיו.</div>
        </>
      )}
    </Modal>
  );
}

// ── FD-10 ───────────────────────────────────────────────────────────────────
export function ExtendDialog({ open, onClose, propertyId, reservationId, departureDate, canManualPrice, onDone, onMoveInstead }) {
  const action = useAction();
  const check = useAction();
  const [f, setF] = useState({});
  const [preview, setPreview] = useState(null);
  useEffect(() => { if (open) { setF({ newDeparture: departureDate ? addDays(departureDate, 1) : '', paymentArrangement: '', guestConfirmation: '', manualRate: '', reason: '' }); setPreview(null); action.reset(); check.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    if (!open || !f.newDeparture || !departureDate || f.newDeparture <= departureDate) { setPreview(null); return; }
    check.run(async () => setPreview(await stay.extension(propertyId, reservationId, f.newDeparture)));
  }, [open, f.newDeparture]); // eslint-disable-line react-hooks/exhaustive-deps
  const manual = f.manualRate !== '' && Number(f.manualRate) > 0;
  let why = null;
  if (!preview) why = 'בחרו תאריך יציאה חדש';
  else if (!preview.canExtend) why = preview.blockers[0]?.label;
  else if (preview.needsManualPrice && !manual) why = 'אין מחיר בלוח — נדרש מחיר ידני של מנהל';
  else if (manual && f.reason.trim().length < 3) why = 'סיבת חריג מחיר';
  else if (f.paymentArrangement.trim().length < 2) why = 'הסדר תשלום / ערבות';
  else if (f.guestConfirmation.trim().length < 2) why = 'אסמכתה לאישור האורח';
  const total = preview ? (manual ? Number(f.manualRate) * preview.nights * preview.units : preview.total) : null;
  const submit = () => action.run(async () => { const out = await stay.extend(propertyId, reservationId, { newDeparture: f.newDeparture, priceSignature: preview.priceSignature, paymentArrangement: f.paymentArrangement, guestConfirmation: f.guestConfirmation, ...(manual ? { manualRate: Number(f.manualRate), reason: f.reason } : {}) }); onDone?.(out); });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={560} title="הארכת שהייה" subtitle={departureDate ? `יציאה נוכחית: ${formatLong(departureDate)}` : ''} footer={<Footer action={action} onClose={onClose} label="אישור הארכה" why={why} onSubmit={submit} />}>
      <ErrorBanner error={action.error} />
      <Field id="ex-d" label="יציאה חדשה" required>
        <input id="ex-d" type="date" className="input" min={departureDate ? addDays(departureDate, 1) : undefined} value={f.newDeparture} onChange={(e) => set('newDeparture')(e.target.value)} />
      </Field>
      {check.busy && <div className="ui-sub"><Spinner /> בודק זמינות ומחיר…</div>}
      <ErrorBanner error={check.error} />
      {preview && (
        <>
          {!preview.canExtend && (
            <Banner tone="error">
              <div className="ui-stack" style={{ gap: 4 }}>
                {preview.blockers.map((b) => <span key={b.label}>{b.label}</span>)}
                {preview.suggestion && <span className="ui-sub">{preview.suggestion}</span>}
                {preview.suggestion && onMoveInstead && <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onMoveInstead}>מעבר לחדר פנוי</button>}
              </div>
            </Banner>
          )}
          <KeyValues rows={[
            ...preview.nightly.map((n) => [formatLong(n.date), money(manual ? Number(f.manualRate) : n.price)]),
            preview.missingRates.length ? ['ללא מחיר בלוח', preview.missingRates.map(formatShort).join(', ')] : null,
            preview.units > 1 ? ['יחידות', `× ${preview.units}`] : null,
            ['תוספת', total != null ? money(total) : '—'],
          ]} />
          {canManualPrice && (
            <div className="ui-grid-2">
              <Field id="ex-m" label="מחיר ידני ללילה" optional={!preview.needsManualPrice} required={preview.needsManualPrice}><input id="ex-m" type="number" min="1" step="0.01" className="input w-full" value={f.manualRate} onChange={(e) => set('manualRate')(e.target.value)} /></Field>
              {manual && <Field id="ex-mr" label="סיבת חריג מחיר" required error={action.fields.reason}><input id="ex-mr" className="input w-full" maxLength={300} value={f.reason} onChange={(e) => set('reason')(e.target.value)} /></Field>}
            </div>
          )}
          <div className="ui-grid-2">
            <Field id="ex-p" label="הסדר תשלום / ערבות" required error={action.fields.paymentArrangement}><input id="ex-p" className="input w-full" maxLength={200} value={f.paymentArrangement} onChange={(e) => set('paymentArrangement')(e.target.value)} placeholder="כרטיס בקובץ, מזומן בעזיבה…" /></Field>
            <Field id="ex-g" label="אישור האורח" required error={action.fields.guestConfirmation}><input id="ex-g" className="input w-full" maxLength={200} value={f.guestConfirmation} onChange={(e) => set('guestConfirmation')(e.target.value)} placeholder="בעל־פה בדלפק, מייל…" /></Field>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── FD-11 ───────────────────────────────────────────────────────────────────
export function EarlyDepartureDialog({ open, onClose, propertyId, reservationId, onContinue }) {
  const { data, loading, error } = useLoader(() => (open ? stay.early(propertyId, reservationId) : null), [open, reservationId]);
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={520}
      title="עזיבה מוקדמת"
      subtitle={data ? `במקום ${formatLong(data.departureDate)} — היום` : ''}
      footer={(
        <>
          {!reason && <span className="ui-foot-note">יש לבחור סיבה</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button>
          <button type="button" className="btn btn-primary" disabled={!data || !reason} onClick={() => onContinue(EARLY_REASONS[reason])}>המשך ליציאה</button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      {loading && !data && <div className="ui-empty"><Spinner /> מחשב השלכות…</div>}
      {data && (
        <>
          <KeyValues rows={[
            ['לילות שישתחררו', `${data.nightsReleased}${data.units > 1 ? ` × ${data.units} יחידות` : ''}`],
            ['מדיניות שנרכשה', data.policy || 'לא נשמרה בהזמנה'],
            data.documents.length ? ['מסמכים שהונפקו', data.documents.map((d) => d.number).join(', ')] : null,
          ]} />
          <ul className="ui-reasons">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
            <legend className="ui-label">סיבת העזיבה · חובה</legend>
            {Object.entries(EARLY_REASONS).map(([v, l]) => <label key={v} className="ui-radio"><input type="radio" name="er" checked={reason === v} onChange={() => setReason(v)} /><span>{l}</span></label>)}
          </fieldset>
        </>
      )}
    </Modal>
  );
}

// ── RSV-05 ──────────────────────────────────────────────────────────────────
export function ModifyBookingDialog({ open, onClose, propertyId, reservation, roomTypes, onDone }) {
  const action = useAction();
  const check = useAction();
  const [f, setF] = useState({});
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (open && reservation) {
      setF({ arrival: reservation.arrivalDate, departure: reservation.departureDate, adults: String(reservation.adults), children: String(reservation.children || 0), childAges: (reservation.childAges || []).map(String), roomTypeId: '', reason: '', confirmationRef: '' });
      setPreview(null); action.reset(); check.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => { setF((p) => ({ ...p, [k]: v })); setPreview(null); };
  const kids = Number(f.children || 0);
  useEffect(() => { setF((p) => ({ ...p, childAges: Array.from({ length: kids }, (_, i) => p.childAges?.[i] ?? '') })); }, [kids]);
  const changes = useMemo(() => {
    if (!reservation) return {};
    const c = {};
    if (f.arrival !== reservation.arrivalDate) c.arrival = f.arrival;
    if (f.departure !== reservation.departureDate) c.departure = f.departure;
    if (Number(f.adults) !== reservation.adults) c.adults = Number(f.adults);
    if (Number(f.children) !== (reservation.children || 0)) c.children = Number(f.children);
    if (kids > 0) c.childAges = (f.childAges || []).map(Number);
    if (f.roomTypeId) c.roomTypeId = f.roomTypeId;
    return c;
  }, [f, reservation, kids]);
  const hasChange = Object.keys(changes).some((k) => k !== 'childAges') || (kids > 0 && JSON.stringify(changes.childAges) !== JSON.stringify(reservation?.childAges || []));
  const doPreview = () => check.run(async () => setPreview(await stay.modifyPreview(propertyId, reservation.id, changes)));
  let why = null;
  if (!hasChange) why = 'לא שונה דבר';
  else if (!preview) why = 'יש לבדוק את ההשלכות';
  else if (!preview.canApply) why = preview.blockers[0]?.label;
  else if (f.reason.trim().length < 3) why = 'סיבת שינוי';
  else if (f.confirmationRef.trim().length < 2) why = 'אסמכתה לאישור הלקוח';
  const submit = () => action.run(async () => { const out = await stay.modify(propertyId, reservation.id, { changes, reason: f.reason, confirmationRef: f.confirmationRef, version: preview.version, priceSignature: preview.priceSignature }); onDone?.(out); });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={620} title="שינוי הזמנה" subtitle={reservation ? `${reservation.confirmationNumber} · ${reservation.guest?.name || ''}` : ''} footer={<Footer action={action} onClose={onClose} label="אישור השינוי" why={why} onSubmit={submit} />}>
      <ErrorBanner error={action.error} />
      <div className="ui-grid-3">
        <Field id="md-a" label="כניסה" required error={check.fields.dates}><input id="md-a" type="date" className="input w-full" value={f.arrival || ''} onChange={(e) => { set('arrival')(e.target.value); if (f.departure <= e.target.value) set('departure')(addDays(e.target.value, 1)); }} /></Field>
        <Field id="md-d" label="יציאה" required><input id="md-d" type="date" className="input w-full" min={f.arrival ? addDays(f.arrival, 1) : undefined} value={f.departure || ''} onChange={(e) => set('departure')(e.target.value)} /></Field>
        <Field id="md-rt" label="סוג חדר" optional hint="ריק = ללא שינוי">
          <select id="md-rt" className="select w-full" value={f.roomTypeId || ''} onChange={(e) => set('roomTypeId')(e.target.value)}>
            <option value="">{reservation?.roomType || 'ללא שינוי'}</option>
            {(roomTypes || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field id="md-ad" label="מבוגרים" required error={check.fields.adults}><input id="md-ad" type="number" min="1" className="input w-full" value={f.adults || ''} onChange={(e) => set('adults')(e.target.value)} /></Field>
        <Field id="md-ch" label="ילדים" error={check.fields.children}><input id="md-ch" type="number" min="0" className="input w-full" value={f.children || ''} onChange={(e) => set('children')(e.target.value)} /></Field>
      </div>
      {kids > 0 && (
        <div className="ui-row">
          <span className="ui-label">גילי ילדים</span>
          {(f.childAges || []).map((a, i) => <input key={i} type="number" min="0" max="17" className="input" style={{ width: 70 }} aria-label={`גיל ילד ${i + 1}`} value={a} onChange={(e) => set('childAges')(f.childAges.map((x, j) => (j === i ? e.target.value : x)))} />)}
        </div>
      )}
      <div className="ui-row"><button type="button" className="btn btn-secondary btn-sm" disabled={!hasChange || check.busy} onClick={doPreview}>{check.busy ? <Spinner /> : 'בדיקת השלכות'}</button></div>
      <ErrorBanner error={check.error} />
      {preview && (
        <>
          {!preview.canApply && <Banner tone="error">{preview.blockers.map((b) => b.label).join(' · ')}</Banner>}
          <KeyValues rows={[
            ['תאריכים', `${formatShort(preview.before.arrival)}–${formatShort(preview.before.departure)} ← ${formatShort(preview.after.arrival)}–${formatShort(preview.after.departure)}`],
            ['הרכב', `${preview.before.adults}+${preview.before.children} ← ${preview.after.adults}+${preview.after.children}`],
            ['סוג חדר', preview.after.roomType],
            ['סכום', `${money(preview.before.total)} ← ${money(preview.after.total)}`],
            ['הפרש', <span key="d" className={`ui-amount ${preview.difference > 0 ? 'is-due' : preview.difference < 0 ? 'is-credit' : 'is-zero'}`}>{money(preview.difference)}</span>],
          ]} />
          {preview.creditNoteNeeded && <Banner tone="warn">הונפקו מסמכים ({preview.documents.map((d) => d.number).join(', ')}) והסכום יורד — נדרש מסמך זיכוי במסך החשבון.</Banner>}
          <div className="ui-grid-2">
            <Field id="md-why" label="סיבת השינוי" required error={action.fields.reason}><input id="md-why" className="input w-full" maxLength={300} value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))} /></Field>
            <Field id="md-ref" label="אישור הלקוח" required error={action.fields.confirmationRef}><input id="md-ref" className="input w-full" maxLength={200} value={f.confirmationRef} onChange={(e) => setF((p) => ({ ...p, confirmationRef: e.target.value }))} placeholder="טלפון, מייל…" /></Field>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── RSV-06 ──────────────────────────────────────────────────────────────────
export function CancelBookingDialog({ open, onClose, propertyId, reservation, onDone }) {
  const action = useAction();
  const check = useAction();
  const [f, setF] = useState({});
  const [preview, setPreview] = useState(null);
  useEffect(() => { if (open) { setF({ channel: '', track: '', reason: '', note: '', receivedAt: localNow(), transactionAt: '', disclosureAt: '', priorCall: false }); setPreview(null); action.reset(); check.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => { setF((p) => ({ ...p, [k]: v })); setPreview(null); };
  const body = () => ({
    channel: f.channel, track: f.track, reason: f.reason, note: f.note || undefined, priorCall: f.priorCall,
    receivedAt: f.receivedAt ? new Date(f.receivedAt).toISOString() : undefined,
    transactionAt: f.transactionAt ? new Date(f.transactionAt).toISOString() : undefined,
    disclosureAt: f.disclosureAt ? new Date(f.disclosureAt).toISOString() : undefined,
  });
  const ready = f.channel && f.track && f.reason && (f.reason !== 'other' || f.note.trim().length >= 3);
  let why = null;
  if (!ready) why = 'יש להשלים ערוץ, מסלול וסיבה';
  else if (!preview) why = 'יש לבדוק זכאות';
  const submit = () => action.run(async () => { const out = await stay.cancel(propertyId, reservation.id, body()); onDone?.(out); });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={640} title="ביטול הזמנה — קליטת הודעה ובדיקת זכאות" subtitle={reservation ? `${reservation.confirmationNumber} · הגעה ${formatShort(reservation.arrivalDate)}` : ''} footer={<Footer action={action} onClose={onClose} label="רישום הביטול" why={why} danger onSubmit={submit} />}>
      <ErrorBanner error={action.error} />
      <Banner tone="info">קבלת הודעת ביטול לא מותנית באישור. הכסף (דמי ביטול, החזר) ומסמך הזיכוי — פעולות נפרדות אחרי הביטול.</Banner>
      <div className="ui-grid-3">
        <Field id="cx-ch" label="ערוץ ההודעה" required error={check.fields.channel || action.fields.channel}>
          <select id="cx-ch" className="select w-full" value={f.channel} onChange={(e) => set('channel')(e.target.value)}><option value="">בחירה…</option>{Object.entries(CHANNELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
        <Field id="cx-at" label="מועד קבלת ההודעה" required hint="מתי האורח הודיע — לא מתי מטפלים" error={check.fields.receivedAt || action.fields.receivedAt}>
          <input id="cx-at" type="datetime-local" className="input w-full" max={localNow()} value={f.receivedAt} onChange={(e) => set('receivedAt')(e.target.value)} />
        </Field>
        <Field id="cx-r" label="סיבה" required error={check.fields.reason}>
          <select id="cx-r" className="select w-full" value={f.reason} onChange={(e) => set('reason')(e.target.value)}><option value="">בחירה…</option>{Object.entries(CANCEL_REASONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
        <Field id="cx-tx" label="מועד העסקה" optional hint="ריק = מועד יצירת ההזמנה"><input id="cx-tx" type="datetime-local" className="input w-full" value={f.transactionAt} onChange={(e) => set('transactionAt')(e.target.value)} /></Field>
        <Field id="cx-dc" label="מועד מסירת גילוי/תנאים" optional hint="ריק = מועד העסקה"><input id="cx-dc" type="datetime-local" className="input w-full" value={f.disclosureAt} onChange={(e) => set('disclosureAt')(e.target.value)} /></Field>
        <Field id="cx-n" label="פירוט" required={f.reason === 'other'} optional={f.reason !== 'other'} error={check.fields.note}><input id="cx-n" className="input w-full" maxLength={500} value={f.note} onChange={(e) => set('note')(e.target.value)} /></Field>
      </div>
      <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
        <legend className="ui-label">מסלול זכאות · חובה</legend>
        {Object.entries(TRACKS).map(([v, t]) => <label key={v} className="ui-radio"><input type="radio" name="trk" checked={f.track === v} onChange={() => set('track')(v)} /><span>{t.label}<span className="ui-sub" style={{ display: 'block' }}>{t.hint}</span></span></label>)}
      </fieldset>
      {f.track === 'protected' && <label className="ui-check"><input type="checkbox" checked={f.priorCall} onChange={(e) => set('priorCall')(e.target.checked)} /><span>התקיימה שיחה טלפונית לפני הרכישה</span></label>}
      <div className="ui-row"><button type="button" className="btn btn-secondary btn-sm" disabled={!ready || check.busy} onClick={() => check.run(async () => setPreview(await stay.cancelPreview(propertyId, reservation.id, body())))}>{check.busy ? <Spinner /> : 'בדיקת זכאות'}</button></div>
      <ErrorBanner error={check.error} />
      {preview && (
        <div className="ui-sub-card">
          <ul className="ui-reasons">{preview.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <KeyValues rows={[
            ['דמי ביטול מוצעים', preview.proposedFee === null ? 'לבירור' : money(preview.proposedFee)],
            ['שולם עד כה', money(preview.paid)],
            ['החזר מוצע', preview.proposedRefund === null ? 'לבירור' : money(preview.proposedRefund)],
            ['מקור הכלל', preview.sources.join(' · ')],
          ]} />
          {preview.documents?.length > 0 && <Banner tone="warn">הונפקו מסמכים ({preview.documents.map((d) => d.number).join(', ')}) — תיקון במסמך זיכוי.</Banner>}
          <Tag tone="warn">{preview.gate}</Tag>
        </div>
      )}
    </Modal>
  );
}
