// Folio line operations (gap-map item 2): discount, split, transfer, invoice combination, Paid Out,
// new window. Each dialog carries one operation key per opening; the server re-checks every amount,
// threshold and role. Nothing is edited — every action adds linked lines.
import { useEffect, useMemo, useState } from 'react';
import { finance } from '../../utils/api';
import { Modal, Field, ErrorBanner, Banner, Spinner, Segmented, useAction, money, newOpKey } from '../kit';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sumOf = (lines) => round2(lines.reduce((s, l) => s + (l.left ?? l.gross), 0));

function Footer({ action, onClose, label, blockedWhy }) {
  return (
    <>
      {blockedWhy && <span className="ui-foot-note">{blockedWhy}</span>}
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
      <button type="submit" form="lop-form" className="btn btn-primary" disabled={action.busy || !!blockedWhy}>
        {action.busy ? <><Spinner /> שומר…</> : label}
      </button>
    </>
  );
}

function useOpen(open, init) {
  const action = useAction();
  const [opKey, setOpKey] = useState('');
  useEffect(() => { if (open) { init(); setOpKey(newOpKey()); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return { action, opKey };
}

function LinesSummary({ lines }) {
  return (
    <ul className="lop-lines">
      {lines.slice(0, 6).map((l) => <li key={l.id}><span>{l.description}</span><b className="ui-num">{money(l.left ?? l.gross)}</b></li>)}
      {lines.length > 6 && <li className="ui-sub">ועוד {lines.length - 6} שורות</li>}
    </ul>
  );
}

// ── Discount on the selected lines ─────────────────────────────────────────
export function LineDiscountDialog({ open, onClose, propertyId, folio, lines = [], config, canApprove, onSaved }) {
  const [f, setF] = useState({});
  const { action, opKey } = useOpen(open, () => setF({ kind: 'percent', value: '', reasonCode: '', note: '' }));
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const base = sumOf(lines);
  const gross = round2(lines.reduce((s, l) => s + l.gross, 0));
  const v = Number(f.value || 0);
  const total = f.kind === 'percent' ? round2(base * v / 100) : v;
  const pct = gross > 0 ? round2(((gross - base) + total) * 100 / gross) : 0;
  const threshold = config?.discountApprovalPercent ?? 10;
  const over = pct - threshold > 0.005;
  const why = !(v > 0) ? 'נדרש ערך הנחה' : f.kind === 'percent' && v > 100 ? 'אחוז עד 100' : total - base > 0.005 ? 'ההנחה גבוהה מהיתרה' : !f.reasonCode ? 'יש לבחור סיבה' : f.reasonCode === 'other' && f.note.trim().length < 3 ? 'יש לפרט סיבה' : over && !canApprove ? `מעל ${threshold}% — מנהל צריך לאשר` : null;
  const submit = () => action.run(async () => onSaved?.(await finance.lineDiscount(propertyId, folio.id, { lineIds: lines.map((l) => l.id), kind: f.kind, value: v, reasonCode: f.reasonCode, note: f.note.trim() || undefined, idempotencyKey: opKey })));
  const e = action.fields;
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title="הנחה על שורות" subtitle={`${lines.length === 1 ? 'שורה אחת' : `${lines.length} שורות`} · ${money(base)}`} footer={<Footer action={action} onClose={onClose} label={total > 0 ? `רישום הנחה ${money(total)}` : 'רישום הנחה'} blockedWhy={why} />}>
      <form id="lop-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <LinesSummary lines={lines} />
        {lines.some((l) => l.onDocument) && <Banner tone="info">חלק מהשורות כבר בחשבונית ({[...new Set(lines.filter((l) => l.onDocument).map((l) => l.onDocument))].join(', ')}). ההנחה עליהן תופק במערכת החשבוניות כמסמך זיכוי על אותן שורות, באותה פעולה.</Banner>}
        <div className="ui-grid-2">
          <Field id="ld-kind" label="סוג">
            <Segmented label="סוג הנחה" value={f.kind} onChange={set('kind')} options={[{ value: 'percent', label: 'אחוז' }, { value: 'amount', label: 'סכום ₪' }]} />
          </Field>
          <Field id="ld-val" label={f.kind === 'percent' ? 'אחוז הנחה' : 'סכום הנחה (כולל מע״מ)'} required error={e.value} hint={lines.length > 1 && f.kind === 'amount' ? 'מתחלק בין השורות לפי הסכום' : undefined}>
            <input id="ld-val" type="number" min="0.01" step="0.01" inputMode="decimal" className="input w-full" value={f.value || ''} onChange={(ev) => set('value')(ev.target.value)} autoFocus />
          </Field>
          <Field id="ld-reason" label="סיבה" required error={e.reasonCode}>
            <select id="ld-reason" className="select w-full" value={f.reasonCode} onChange={(ev) => set('reasonCode')(ev.target.value)}>
              <option value="">בחרו סיבה</option>
              {Object.entries(config?.discountReasons || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field id="ld-note" label="פירוט" optional={f.reasonCode !== 'other'} required={f.reasonCode === 'other'} error={e.note}>
            <input id="ld-note" className="input w-full" maxLength={200} value={f.note || ''} onChange={(ev) => set('note')(ev.target.value)} />
          </Field>
        </div>
        {total > 0 && <Banner tone={over ? 'warn' : 'info'}>אחרי ההנחה: {money(round2(base - total))} · {pct}% מהשורות{over ? ` — מעל ${threshold}%, נרשם עם אישורך כמנהל` : ''}</Banner>}
      </form>
    </Modal>
  );
}

// Destination picker: another window of this stay, or a guest in another room.
function Destination({ propertyId, reservationId, windows, folio, value, onChange, allowSame = false }) {
  const [rooms, setRooms] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (value?.kind === 'room' && !rooms) finance.transferTargets(propertyId, reservationId).then((d) => setRooms(d.rooms)).catch(() => setRooms([]));
  }, [value?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = windows.filter((w) => w.id !== folio?.id && w.status !== 'closed');
  const list = useMemo(() => (rooms || []).filter((r) => !q || String(r.room || '').includes(q) || r.guest.includes(q)).slice(0, 8), [rooms, q]);
  return (
    <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
      <legend className="ui-label">לאן · חובה</legend>
      {allowSame && <label className="ui-radio"><input type="radio" name="lop-to" checked={value?.kind === 'same'} onChange={() => onChange({ kind: 'same' })} /><span>נשאר באותו חלון<span className="ui-sub" style={{ display: 'block' }}>שתי שורות נפרדות בחשבון הזה</span></span></label>}
      {others.map((w) => (
        <label key={w.id} className="ui-radio"><input type="radio" name="lop-to" checked={value?.folioId === w.id} onChange={() => onChange({ kind: 'window', folioId: w.id, label: w.owner })} /><span>חלון {w.owner}<span className="ui-sub" style={{ display: 'block' }}>יתרה {money(w.balance)}</span></span></label>
      ))}
      <label className="ui-radio"><input type="radio" name="lop-to" checked={value?.kind === 'room'} onChange={() => onChange({ kind: 'room' })} /><span>חדר אחר<span className="ui-sub" style={{ display: 'block' }}>חשבון של אורח שבבית</span></span></label>
      {value?.kind === 'room' && (
        <div className="lop-rooms">
          <input className="input w-full" placeholder="מספר חדר או שם אורח" value={q} onChange={(ev) => setQ(ev.target.value)} aria-label="חיפוש חדר" />
          {!rooms && <div className="ui-sub"><Spinner /> טוען…</div>}
          {rooms && !list.length && <div className="ui-sub">אין אורח בבית שמתאים לחיפוש</div>}
          {list.map((r) => (
            <label key={r.reservationId} className={`lop-room ${value.reservationId === r.reservationId ? 'is-on' : ''}`}>
              <input type="radio" name="lop-room" checked={value.reservationId === r.reservationId} onChange={() => onChange({ kind: 'room', reservationId: r.reservationId, label: `חדר ${r.room || '—'} · ${r.guest}` })} />
              <b>חדר {r.room || '—'}</b><span>{r.guest}</span><bdi className="ui-sub">{r.confirmationNumber}</bdi>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
const destBody = (to) => (to?.kind === 'window' ? { toFolioId: to.folioId } : to?.kind === 'room' && to.reservationId ? { toReservationId: to.reservationId } : {});
const destReady = (to, allowSame) => (to?.kind === 'same' && allowSame) || to?.kind === 'window' || (to?.kind === 'room' && !!to.reservationId);

// ── Transfer the selected lines ────────────────────────────────────────────
export function TransferDialog({ open, onClose, propertyId, reservationId, folio, windows = [], lines = [], preset, onSaved }) {
  const [to, setTo] = useState(null);
  const [reason, setReason] = useState('');
  const { action, opKey } = useOpen(open, () => { setTo(preset || null); setReason(''); });
  const otherRoom = to?.kind === 'room';
  const why = !destReady(to) ? 'יש לבחור לאן' : otherRoom && reason.trim().length < 3 ? 'העברה לחדר אחר מחייבת סיבה' : null;
  const submit = () => action.run(async () => onSaved?.(await finance.transferLines(propertyId, folio.id, { lineIds: lines.map((l) => l.id), ...destBody(to), reason: reason.trim() || undefined, idempotencyKey: opKey })));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={540} title="העברת שורות" subtitle={`${lines.length === 1 ? 'שורה אחת' : `${lines.length} שורות`} · ${money(sumOf(lines))} · מחלון ${folio?.owner || ''}`} footer={<Footer action={action} onClose={onClose} label={to?.label ? `העברה ל${to.label}` : 'העברה'} blockedWhy={why} />}>
      <form id="lop-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <LinesSummary lines={lines} />
        <Destination propertyId={propertyId} reservationId={reservationId} windows={windows} folio={folio} value={to} onChange={setTo} />
        <Field id="tr-reason" label="סיבה" required={otherRoom} optional={!otherRoom} error={action.fields.reason}>
          <input id="tr-reason" className="input w-full" maxLength={200} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={otherRoom ? 'למשל: האורח ביקש לחייב את חדר החבר' : ''} />
        </Field>
        <p className="ui-sub">בחלון הזה נרשמת שורה נגדית, וביעד שורה זהה עם קישור למקור. הנחה שניתנה על שורה עוברת יחד איתה.</p>
      </form>
    </Modal>
  );
}

// ── Split one line ─────────────────────────────────────────────────────────
export function SplitDialog({ open, onClose, propertyId, reservationId, folio, windows = [], line, onSaved }) {
  const [f, setF] = useState({});
  const [to, setTo] = useState(null);
  const { action, opKey } = useOpen(open, () => { setF({ kind: 'percent', value: '50' }); setTo(windows.some((w) => w.id !== folio?.id && w.status !== 'closed') ? null : { kind: 'same' }); });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const g = line?.gross || 0;
  const v = Number(f.value || 0);
  const part = f.kind === 'percent' ? round2(g * v / 100) : v;
  const why = !(part > 0) || part >= g ? `החלק בין 0 ל־${money(g)}` : !destReady(to, true) ? 'יש לבחור לאן הולך החלק' : null;
  const submit = () => action.run(async () => onSaved?.(await finance.splitLine(propertyId, folio.id, line.id, { kind: f.kind, value: v, ...destBody(to), idempotencyKey: opKey })));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={540} title="פיצול שורה" subtitle={line ? `${line.description} · ${money(g)}` : ''} footer={<Footer action={action} onClose={onClose} label="פיצול" blockedWhy={why} />}>
      <form id="lop-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <div className="ui-grid-2">
          <Field id="sp-kind" label="לפי">
            <Segmented label="פיצול לפי" value={f.kind} onChange={set('kind')} options={[{ value: 'percent', label: 'אחוז' }, { value: 'amount', label: 'סכום ₪' }]} />
          </Field>
          <Field id="sp-val" label={f.kind === 'percent' ? 'אחוז שעובר' : 'סכום שעובר'} required error={action.fields.value}>
            <input id="sp-val" type="number" min="0.01" step="0.01" inputMode="decimal" className="input w-full" value={f.value || ''} onChange={(ev) => set('value')(ev.target.value)} autoFocus />
          </Field>
        </div>
        {part > 0 && part < g && <Banner tone="info">נשאר כאן {money(round2(g - part))} · עובר {money(part)}</Banner>}
        <Destination propertyId={propertyId} reservationId={reservationId} windows={windows} folio={folio} value={to} onChange={setTo} allowSame />
      </form>
    </Modal>
  );
}

// ── One invoice line for several charges ───────────────────────────────────
export function CombineDialog({ open, onClose, propertyId, folio, lines = [], suggest, onSaved }) {
  const [label, setLabel] = useState('');
  const { action } = useOpen(open, () => setLabel(suggest || ''));
  const rates = new Set(lines.map((l) => (l.tax ? 'vat' : 'zero')));
  const why = lines.length < 2 ? 'לבחור לפחות שתי שורות' : rates.size > 1 ? 'יש בבחירה שורות עם מע״מ ובלי — מאחדים כל סוג לחוד' : label.trim().length < 2 ? 'שם לשורה בחשבונית' : null;
  const submit = () => action.run(async () => onSaved?.(await finance.combine(propertyId, folio.id, { lineIds: lines.map((l) => l.id), label: label.trim() })));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={500} title="איחוד שורות בחשבונית" subtitle={`${lines.length} שורות · ${money(sumOf(lines))}`} footer={<Footer action={action} onClose={onClose} label="איחוד" blockedWhy={why} />}>
      <form id="lop-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <LinesSummary lines={lines} />
        <Field id="cb-label" label="השם בחשבונית" required error={action.fields.label}>
          <input id="cb-label" className="input w-full" maxLength={80} value={label} onChange={(ev) => setLabel(ev.target.value)} autoFocus />
        </Field>
        <p className="ui-sub">בחשבונית הבאה תופיע שורה אחת בשם הזה. בחשבון עצמו השורות נשארות נפרדות, ואפשר לבטל את האיחוד עד שמפיקים חשבונית.</p>
      </form>
    </Modal>
  );
}

// ── Paid Out ───────────────────────────────────────────────────────────────
export function PaidOutDialog({ open, onClose, propertyId, folio, config, canApprove, onSaved }) {
  const [f, setF] = useState({});
  const { action, opKey } = useOpen(open, () => setF({ purpose: '', amount: '', payee: '', note: '' }));
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const amount = Number(f.amount || 0);
  const limit = config?.paidOutApprovalOver || 0;
  const why = !f.purpose ? 'עבור מה' : !(amount > 0) ? 'סכום' : f.purpose === 'other' && f.note.trim().length < 3 ? 'יש לפרט' : limit > 0 && amount > limit && !canApprove ? `מעל ${money(limit)} — מנהל או כספים` : null;
  const submit = () => action.run(async () => onSaved?.(await finance.paidOut(propertyId, folio.id, { purpose: f.purpose, amount, payee: f.payee.trim() || undefined, note: f.note.trim() || undefined, idempotencyKey: opKey })));
  const e = action.fields;
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={500} title="Paid Out — מזומן בשם האורח" subtitle={folio ? `חשבון ${folio.owner}` : ''} footer={<Footer action={action} onClose={onClose} label={amount > 0 ? `הוצאת ${money(amount)} מהקופה` : 'רישום'} blockedWhy={why} />}>
      <form id="lop-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <div className="ui-grid-2">
          <Field id="po-purpose" label="עבור" required error={e.purpose}>
            <select id="po-purpose" className="select w-full" value={f.purpose} onChange={(ev) => set('purpose')(ev.target.value)}>
              <option value="">בחרו</option>
              {Object.entries(config?.paidOutPurposes || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field id="po-amount" label="סכום במזומן" required error={e.amount}>
            <input id="po-amount" type="number" min="0.01" step="0.01" inputMode="decimal" className="input w-full" value={f.amount} onChange={(ev) => set('amount')(ev.target.value)} />
          </Field>
          <Field id="po-payee" label="שולם ל" optional>
            <input id="po-payee" className="input w-full" maxLength={120} value={f.payee} onChange={(ev) => set('payee')(ev.target.value)} placeholder="נהג המונית, השליח…" />
          </Field>
          <Field id="po-note" label="פירוט" optional={f.purpose !== 'other'} required={f.purpose === 'other'} error={e.note}>
            <input id="po-note" className="input w-full" maxLength={200} value={f.note} onChange={(ev) => set('note')(ev.target.value)} />
          </Field>
        </div>
        <p className="ui-sub">הכסף יוצא מהקופה שלך ונרשם כחוב של האורח. הוא נכלל ביתרה ובספירת המשמרת, ולא נכנס לחשבונית.</p>
      </form>
    </Modal>
  );
}

// ── New window for the stay ────────────────────────────────────────────────
export function NewWindowDialog({ open, onClose, propertyId, reservationId, existing = [], onSaved }) {
  const [label, setLabel] = useState('');
  const { action } = useOpen(open, () => setLabel(''));
  const taken = existing.includes(label.trim());
  const why = label.trim().length < 2 ? 'שם לחלון' : taken ? 'כבר יש חלון בשם הזה' : null;
  const submit = () => action.run(async () => onSaved?.(await finance.openWindow(propertyId, reservationId, label.trim())));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={440} title="חלון חשבון נוסף" subtitle="לחלוקת החיובים בתוך אותה שהייה" footer={<Footer action={action} onClose={onClose} label="פתיחת חלון" blockedWhy={why} />}>
      <form id="lop-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        <Field id="nw-label" label="שם החלון" required error={action.fields.label}>
          <input id="nw-label" className="input w-full" maxLength={60} value={label} onChange={(ev) => setLabel(ev.target.value)} autoFocus />
        </Field>
        <div className="lop-chips">
          {['עסקי', 'פרטי', 'הוצאות אישיות', 'אורח שני'].filter((s) => !existing.includes(s)).map((s) => <button key={s} type="button" className="lop-chip" onClick={() => setLabel(s)}>{s}</button>)}
        </div>
        <p className="ui-sub">לינה ממשיכה להירשם לחלון הראשי. לחלון הזה מעבירים שורות או רושמים חיוב ישירות.</p>
      </form>
    </Modal>
  );
}
