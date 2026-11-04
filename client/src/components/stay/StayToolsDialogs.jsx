// Stay tools (gap-map item 5): Re-Instate a check-out, Copy a booking, Split Master (a room becomes its
// own booking) and Shares (another guest in the room with a window of their own). The server re-checks
// every rule; these dialogs show what will happen before it does.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { booking } from '../../utils/api';
import { Modal, Field, ErrorBanner, Banner, Spinner, useAction, useLoader, money } from '../kit';
import { formatShort } from '../../utils/date';

export const SHARE_SPLIT_LABELS = { none: 'הכול על האורח הראשי', half: 'חצי־חצי', full: 'מחיר מלא לכל אחד' };
const SHARE_SPLIT_HINTS = { none: 'האורח הנוסף משלם רק על התוספות שלו', half: 'כל לילה מתחלק שווה בשווה בין החלונות', full: 'כל אחד משלם לילה מלא (חדר לשני אורחים עם חשבון נפרד)' };

function Foot({ action, onClose, label, why, danger }) {
  return (
    <>
      {why && <span className="ui-foot-note">{why}</span>}
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
      <button type="submit" form="st-form" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={action.busy || !!why}>{action.busy ? <><Spinner /> שומר…</> : label}</button>
    </>
  );
}

// ── Re-Instate a check-out ──────────────────────────────────────────────────
export function ReinstateCheckOutDialog({ open, onClose, propertyId, reservation, onDone }) {
  const action = useAction();
  const [reason, setReason] = useState('');
  const pv = useLoader(async () => (open && reservation ? booking.reinstateCheckoutPreview(propertyId, reservation.id) : null), [open, reservation?.id]);
  useEffect(() => { if (open) { setReason(''); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = pv.data;
  const why = pv.loading ? 'בודק…' : !p ? 'לא נטען' : !p.allowed ? 'לא ניתן להחזיר' : reason.trim().length < 3 ? 'נדרשת סיבה' : null;
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={500} title="החזרת אורח שיצא" subtitle={reservation?.confirmationNumber} footer={<Foot action={action} onClose={onClose} label="החזרה לשהייה" why={why} />}>
      <form id="st-form" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) action.run(async () => onDone?.(await booking.reinstateCheckout(propertyId, reservation.id, reason.trim()))); }}>
        <ErrorBanner error={pv.error || action.error} />
        {pv.loading && <div className="ui-empty"><Spinner /> בודק…</div>}
        {p && !p.allowed && <Banner tone="error">{p.blockers.join(' · ')}</Banner>}
        {p?.allowed && (
          <>
            <p className="ui-p">השהייה תחזור ל"בבית"{p.rooms.length ? `, חדר ${p.rooms.join(', ')} יסומן תפוס` : ''}{p.reopen ? ` ו־${p.reopen === 1 ? 'חשבון אחד ייפתח' : `${p.reopen} חשבונות ייפתחו`} מחדש` : ''}. {p.note}</p>
            {p.warnings.map((w) => <Banner key={w} tone="warn">{w}</Banner>)}
            <Field id="ric-reason" label="סיבה" required error={action.fields.reason}>
              <input id="ric-reason" className="input w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="יציאה נרשמה בטעות / האורח נשאר" autoFocus />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

// ── Copy a booking → the booking form, pre-filled with what was chosen ─────
export function CopyBookingDialog({ open, onClose, reservation }) {
  const nav = useNavigate();
  const [f, setF] = useState({});
  useEffect(() => {
    if (open && reservation) setF({ guest: true, company: !!reservation.company, notes: true, room: true, arrival: reservation.arrivalDate, departure: reservation.departureDate });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const why = !f.arrival || !f.departure ? 'תאריכים' : f.departure <= f.arrival ? 'היציאה אחרי ההגעה' : null;
  const go = () => {
    const q = new URLSearchParams({ copyFrom: reservation.id, arrival: f.arrival, departure: f.departure });
    const what = ['guest', 'company', 'notes'].filter((k) => f[k]);
    if (what.length) q.set('copy', what.join(','));
    if (f.room && reservation.roomTypeId) { q.set('roomTypeId', reservation.roomTypeId); q.set('adults', String(reservation.adults || 2)); q.set('children', String(reservation.children || 0)); }
    nav(`/pms/reservations/new?${q.toString()}`);
  };
  const box = (k, label, disabled = false) => <label className="ui-check"><input type="checkbox" checked={!!f[k]} disabled={disabled} onChange={(e) => set(k)(e.target.checked)} /> {label}</label>;
  return (
    <Modal open={open} onClose={onClose} width={480} title="העתקת הזמנה" subtitle={`הזמנה חדשה עם מספר אישור משלה · מתוך ${reservation?.confirmationNumber || ''}`}
      footer={<>{why && <span className="ui-foot-note">{why}</span>}<button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button><button type="button" className="btn btn-primary" disabled={!!why} onClick={go}>המשך לטופס ההזמנה</button></>}>
      <div className="ui-stack">
        <div className="ui-grid-2">
          <Field id="cp-arr" label="הגעה" required><input id="cp-arr" type="date" className="input w-full" value={f.arrival || ''} onChange={(e) => set('arrival')(e.target.value)} /></Field>
          <Field id="cp-dep" label="יציאה" required><input id="cp-dep" type="date" className="input w-full" min={f.arrival} value={f.departure || ''} onChange={(e) => set('departure')(e.target.value)} /></Field>
        </div>
        <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
          <legend className="ui-label">מה להעתיק</legend>
          {box('guest', `האורח — ${reservation?.guest?.name || ''}`)}
          {box('room', `סוג חדר והרכב — ${reservation?.roomType || ''}, ${reservation?.adults || 0} מבוגרים${reservation?.children ? `, ${reservation.children} ילדים` : ''}`)}
          {box('company', reservation?.company ? `חברה — ${reservation.company.name}` : 'חברה (אין בהזמנה)', !reservation?.company)}
          {box('notes', 'בקשות והערות פנימיות')}
        </fieldset>
        <p className="ui-sub">המחיר והזמינות נבדקים מחדש בטופס לתאריכים שבחרתם.</p>
      </div>
    </Modal>
  );
}

// ── Split Master ────────────────────────────────────────────────────────────
export function SplitUnitDialog({ open, onClose, propertyId, reservation, onDone }) {
  const action = useAction();
  const [unitId, setUnitId] = useState('');
  const units = (reservation?.units || []).filter((u) => u.id && !['cancelled', 'no_show', 'checked_out'].includes(u.status));
  useEffect(() => { if (open) { setUnitId(units.length > 1 ? units[units.length - 1].id : ''); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const why = units.length < 2 ? 'בהזמנה חדר אחד' : !unitId ? 'בחרו חדר' : null;
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={500} title="פיצול חדר להזמנה נפרדת" subtitle={reservation?.confirmationNumber} footer={<Foot action={action} onClose={onClose} label="פיצול" why={why} />}>
      <form id="st-form" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) action.run(async () => onDone?.(await booking.splitUnit(propertyId, reservation.id, unitId))); }}>
        <ErrorBanner error={action.error} />
        <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
          <legend className="ui-label">איזה חדר יוצא להזמנה משלו</legend>
          {units.map((u) => (
            <label key={u.id} className="ui-radio"><input type="radio" name="st-unit" checked={unitId === u.id} onChange={() => setUnitId(u.id)} />
              <span>חדר {u.room?.number || `#${u.index} (טרם שובץ)`} · {u.roomType}<span className="ui-sub" style={{ display: 'block' }}>{formatShort(u.arrivalDate)} – {formatShort(u.departureDate)}{u.nightlyRate != null ? ` · ${money(u.nightlyRate)} ללילה` : ''}</span></span>
            </label>
          ))}
        </fieldset>
        <p className="ui-sub">ההזמנה החדשה מקבלת מספר אישור משלה, את המחיר של החדר הזה ואת החשבון שלו. שתי ההזמנות נשארות מקושרות כקבוצת חדרים. המלאי לא משתנה.</p>
      </form>
    </Modal>
  );
}

// ── Add a Share ─────────────────────────────────────────────────────────────
export function AddShareDialog({ open, onClose, propertyId, reservation, onDone }) {
  const action = useAction();
  const [mode, setMode] = useState('new');
  const [split, setSplit] = useState('half');
  const [g, setG] = useState({ firstName: '', lastName: '', phone: '' });
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const cands = useLoader(async () => (open && mode === 'merge' ? booking.shareCandidates(propertyId, reservation.id, q || undefined) : null), [open, mode, q]);
  useEffect(() => { if (open) { setMode('new'); setSplit('half'); setG({ firstName: '', lastName: '', phone: '' }); setQ(''); setPick(null); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const why = mode === 'new' && (!g.firstName.trim() || !g.lastName.trim()) ? 'שם האורח' : mode === 'merge' && !pick ? 'בחרו הזמנה לצירוף' : null;
  const submit = () => action.run(async () => onDone?.(await booking.addShare(propertyId, reservation.id, { split, ...(mode === 'merge' ? { mergeReservationId: pick.id } : { newGuest: { firstName: g.firstName.trim(), lastName: g.lastName.trim(), phone: g.phone.trim() || undefined } }) })));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={540} title="אורח נוסף בחדר (Share)" subtitle={`${reservation?.confirmationNumber || ''} · חשבון נפרד לאורח הנוסף`} footer={<Foot action={action} onClose={onClose} label="הוספה לחדר" why={why} />}>
      <form id="st-form" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={action.error} />
        <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
          <legend className="ui-label">מי</legend>
          <label className="ui-radio"><input type="radio" name="st-mode" checked={mode === 'new'} onChange={() => setMode('new')} /><span>אורח חדש בחדר</span></label>
          <label className="ui-radio"><input type="radio" name="st-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} /><span>חיבור הזמנה קיימת<span className="ui-sub" style={{ display: 'block' }}>ההזמנה השנייה תבוטל והמלאי שלה ישתחרר</span></span></label>
        </fieldset>
        {mode === 'new' ? (
          <div className="ui-grid-2">
            <Field id="sh-fn" label="שם פרטי" required><input id="sh-fn" className="input w-full" maxLength={60} value={g.firstName} onChange={(e) => setG((p) => ({ ...p, firstName: e.target.value }))} autoFocus /></Field>
            <Field id="sh-ln" label="שם משפחה" required><input id="sh-ln" className="input w-full" maxLength={60} value={g.lastName} onChange={(e) => setG((p) => ({ ...p, lastName: e.target.value }))} /></Field>
            <Field id="sh-ph" label="טלפון" optional><input id="sh-ph" className="input w-full" dir="ltr" maxLength={30} value={g.phone} onChange={(e) => setG((p) => ({ ...p, phone: e.target.value }))} /></Field>
          </div>
        ) : (
          <div className="st-merge">
            <input className="input w-full" placeholder="שם אורח או מספר הזמנה" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} aria-label="חיפוש הזמנה" />
            {cands.loading && <div className="ui-sub"><Spinner /> טוען…</div>}
            {cands.data && !cands.data.rows.length && <div className="ui-sub">אין הזמנה פתוחה בתאריכים של החדר</div>}
            {(cands.data?.rows || []).map((c) => (
              <label key={c.id} className={`st-cand ${pick?.id === c.id ? 'is-on' : ''}`}><input type="radio" name="st-cand" checked={pick?.id === c.id} onChange={() => setPick(c)} /><b>{c.guest}</b><bdi className="ui-sub">{c.confirmationNumber}</bdi><span className="ui-sub">{formatShort(c.arrivalDate)}–{formatShort(c.departureDate)}</span></label>
            ))}
          </div>
        )}
        <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
          <legend className="ui-label">חלוקת מחיר הלינה</legend>
          {Object.entries(SHARE_SPLIT_LABELS).map(([k, l]) => <label key={k} className="ui-radio"><input type="radio" name="st-split" checked={split === k} onChange={() => setSplit(k)} /><span>{l}<span className="ui-sub" style={{ display: 'block' }}>{SHARE_SPLIT_HINTS[k]}</span></span></label>)}
        </fieldset>
      </form>
    </Modal>
  );
}

// ── End a Share (remove / separate) ─────────────────────────────────────────
export function EndShareDialog({ open, onClose, propertyId, reservation, share, onDone }) {
  const action = useAction();
  const [mode, setMode] = useState('separate');
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setMode('separate'); setReason(''); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={480} title={`פירוק Share — ${share?.name || ''}`} subtitle={reservation?.confirmationNumber} footer={<Foot action={action} onClose={onClose} label={mode === 'separate' ? 'פתיחת הזמנה נפרדת' : 'הסרה מהחדר'} why={null} />}>
      <form id="st-form" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); action.run(async () => onDone?.(await booking.endShare(propertyId, reservation.id, share.id, { mode, reason: reason.trim() || undefined }))); }}>
        <ErrorBanner error={action.error} />
        <label className="ui-radio"><input type="radio" name="st-end" checked={mode === 'separate'} onChange={() => setMode('separate')} /><span>הזמנה נפרדת לאורח<span className="ui-sub" style={{ display: 'block' }}>מספר אישור חדש, מהיום ועד היציאה. המלאי נבדק. משבצים לו חדר אחר</span></span></label>
        <label className="ui-radio"><input type="radio" name="st-end" checked={mode === 'remove'} onChange={() => setMode('remove')} /><span>האורח כבר לא בחדר<span className="ui-sub" style={{ display: 'block' }}>רק כשהחלון שלו מאוזן</span></span></label>
        <Field id="es-reason" label="סיבה" optional><input id="es-reason" className="input w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="ui-sub">החלון של האורח נשאר בהזמנה הזו עם מה שכבר נרשם בו, ונסגר ביציאה.</p>
      </form>
    </Modal>
  );
}

// ── Stay-file card: who shares the room ─────────────────────────────────────
export function SharesCard({ propertyId, reservation, canWork, onAdd, onEnd, onChanged, onOpenFolio }) {
  const [err, setErr] = useState(null);
  const active = (reservation.shares || []).filter((s) => s.status === 'active');
  const past = (reservation.shares || []).filter((s) => s.status !== 'active');
  const multi = (reservation.units || []).filter((u) => !['cancelled', 'no_show'].includes(u.status)).length > 1;
  if (!active.length && !past.length && !canWork) return null;
  const change = async (s, split) => { setErr(null); try { await booking.setShareSplit(propertyId, reservation.id, s.id, split); onChanged?.('החלוקה עודכנה ללילות הבאים'); } catch (e) { setErr(e); } };
  return (
    <section className="rsv-card" aria-labelledby="rsv-shares">
      <div className="rsv-card-head">
        <h2 id="rsv-shares">חולקים את החדר (Share)</h2>
        {canWork && !multi && <button type="button" className="rsv-link" onClick={onAdd}>הוספת אורח</button>}
      </div>
      <ErrorBanner error={err} />
      {!active.length && <p className="ui-sub">{multi ? 'בהזמנה כמה חדרים — Share מוסיפים אחרי פיצול החדר להזמנה משלו.' : 'אורח אחד בחדר.'}</p>}
      {active.map((s) => (
        <div key={s.id} className="st-share">
          <div className="st-share-main">
            <b>{s.name}</b>{s.mergedFrom && <span className="ui-sub"> · צורף מהזמנה {s.mergedFrom}</span>}
            {canWork ? (
              <select className="select st-split" value={s.split} onChange={(e) => change(s, e.target.value)} aria-label={`חלוקת מחיר — ${s.name}`}>
                {Object.entries(SHARE_SPLIT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            ) : <div className="ui-sub">{SHARE_SPLIT_LABELS[s.split]}</div>}
          </div>
          <span className="st-share-acts">
            {s.folioId && <button type="button" className="rsv-link" onClick={() => onOpenFolio(s.folioId)}>החשבון שלו</button>}
            {canWork && <button type="button" className="rsv-link" onClick={() => onEnd(s)}>פירוק</button>}
          </span>
        </div>
      ))}
      {past.map((s) => <p key={s.id} className="ui-sub">{s.name} — {s.status === 'separated' ? 'הופרד להזמנה נפרדת' : 'יצא מהחדר'}</p>)}
    </section>
  );
}
