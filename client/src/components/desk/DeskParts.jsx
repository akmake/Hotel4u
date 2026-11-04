// Front-desk communication parts (gap-map item 4): the "new item" dialog for every kind, a stay picker,
// the stay-file card, the alert pop-up for check-in / check-out / opening, and the message slip print.
import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, AlarmClock, MapPin, ListTodo, BellRing, Plus } from 'lucide-react';
import { desk } from '../../utils/api';
import { Modal, Field, ErrorBanner, Spinner, useAction, useLoader, formatTime } from '../kit';
import { formatShort } from '../../utils/date';

export const KIND_LABELS = { message: 'הודעה לאורח', alert: 'התראה', trace: 'Trace — משימה למחלקה', wakeup: 'השכמה', locator: 'איפה האורח (Locator)', logbook: 'הודעה ביומן המשמרת' };
export const ALERT_ON_LABELS = { check_in: 'בצ׳ק־אין', check_out: 'בצ׳ק־אאוט', open: 'בכל פתיחה של ההזמנה' };
export const WAKE_STATUS = { open: 'ממתינה', done: 'בוצעה', no_answer: 'לא ענה', cancelled: 'בוטלה' };
const NEEDS_STAY = ['message', 'alert', 'wakeup', 'locator'];
const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Print a message slip for the guest (then the desk marks it delivered "printed").
export function printMessageSlip(m) {
  const w = window.open('', '_blank', 'width=420,height=560');
  if (!w) return false;
  w.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>הודעה לאורח</title><style>body{font-family:Arial,sans-serif;padding:24px;font-size:15px}h1{font-size:18px;margin:0 0 12px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0 0 16px}dt{color:#555}p{white-space:pre-wrap;border-top:1px solid #ccc;padding-top:12px}</style></head><body>
<h1>הודעה עבורך</h1><dl><dt>לכבוד</dt><dd>${esc(m.guest || '')}${m.room ? ` · חדר ${esc(m.room)}` : ''}</dd><dt>מאת</dt><dd>${esc(m.from || '')}${m.fromPhone ? ` · ${esc(m.fromPhone)}` : ''}</dd><dt>התקבלה</dt><dd>${esc(new Date(m.createdAt).toLocaleString('he-IL'))} · ${esc(m.createdBy || '')}</dd></dl><p>${esc(m.text)}</p>
<script>window.onload=function(){window.print();}</script></body></html>`);
  w.document.close();
  return true;
}

// In-house guest picker (operator search) for items created outside a stay file.
export function StayPicker({ propertyId, value, onChange }) {
  const [q, setQ] = useState('');
  const { data, loading } = useLoader(() => desk.operator(propertyId, q || undefined), [propertyId, q]);
  if (value) {
    return (
      <div className="dk-picked">
        <b>חדר {value.room || '—'}</b><span>{value.guest}</span>
        <button type="button" className="dk-link" onClick={() => onChange(null)}>החלפה</button>
      </div>
    );
  }
  return (
    <div className="dk-picker">
      <input className="input w-full" placeholder="מספר חדר או שם אורח" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש אורח בבית" autoFocus />
      {loading && !data && <div className="ui-sub"><Spinner /> טוען…</div>}
      <div className="dk-picker-list">
        {(data?.rows || []).slice(0, 6).map((r) => (
          <button key={r.reservationId} type="button" className="dk-pick" onClick={() => onChange({ reservationId: r.reservationId, room: r.room, guest: r.guest })}>
            <b>חדר {r.room || '—'}</b><span>{r.guest}</span><span className="ui-sub">עד {formatShort(r.departureDate)}</span>
          </button>
        ))}
        {data && !data.rows.length && <div className="ui-sub">אין אורח בבית שמתאים</div>}
      </div>
    </div>
  );
}

// One dialog for every kind. `stay` pre-fills the guest when opened from a stay file / the operator.
export function DeskItemDialog({ open, onClose, propertyId, kind, stay, businessDate, departments = {}, templates = [], ownDepartment, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const [who, setWho] = useState(null);
  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setWho(stay || null);
    setF({
      text: '', from: '', fromPhone: '', on: ['check_in'], department: ownDepartment || 'housekeeping', fromDate: businessDate || '', toDate: businessDate || '',
      time: '07:00', date: '', untilDate: '', wholeGroup: false, until: localInput(new Date(now.getTime() + 2 * 3600e3)), important: false,
    });
    act.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const e = act.fields;
  const needStay = NEEDS_STAY.includes(kind);
  const why = needStay && !who ? 'לבחור אורח'
    : kind === 'message' && f.from?.trim().length < 2 ? 'מי השאיר את ההודעה'
      : ['message', 'alert', 'trace', 'locator', 'logbook'].includes(kind) && f.text?.trim().length < 2 ? 'תוכן'
        : kind === 'alert' && !f.on?.length ? 'מתי להקפיץ'
          : kind === 'wakeup' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time || '') ? 'שעה' : null;
  const submit = () => act.run(async () => {
    const body = { kind, reservationId: who?.reservationId, text: f.text?.trim() };
    if (kind === 'message') Object.assign(body, { from: f.from.trim(), fromPhone: f.fromPhone.trim() || undefined });
    if (kind === 'alert') body.on = f.on;
    if (kind === 'trace') Object.assign(body, { department: f.department, fromDate: f.fromDate, toDate: f.toDate || f.fromDate });
    if (kind === 'wakeup') Object.assign(body, { time: f.time, date: f.date || undefined, untilDate: f.untilDate || undefined, wholeGroup: f.wholeGroup });
    if (kind === 'locator') body.until = new Date(f.until).toISOString();
    if (kind === 'logbook') body.important = f.important;
    onSaved?.(await desk.create(propertyId, body));
  });
  const toggleOn = (k) => set('on')(f.on.includes(k) ? f.on.filter((x) => x !== k) : [...f.on, k]);
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={520} title={KIND_LABELS[kind] || ''} subtitle={who ? `חדר ${who.room || '—'} · ${who.guest}` : undefined}
      footer={<>{why && <span className="ui-foot-note">{why}</span>}<button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="submit" form="dk-form" className="btn btn-primary" disabled={act.busy || !!why}>{act.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button></>}>
      <form id="dk-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        {needStay && !stay && <Field id="dk-who" label="אורח" required error={e.reservation}><StayPicker propertyId={propertyId} value={who} onChange={setWho} /></Field>}
        {kind === 'trace' && !stay && <Field id="dk-who" label="אורח" optional hint="ריק = משימה כללית, לא לאורח מסוים"><StayPicker propertyId={propertyId} value={who} onChange={setWho} /></Field>}
        {kind === 'message' && (
          <div className="ui-grid-2">
            <Field id="dk-from" label="מי השאיר" required error={e.from}><input id="dk-from" className="input w-full" maxLength={120} value={f.from} onChange={(ev) => set('from')(ev.target.value)} /></Field>
            <Field id="dk-phone" label="טלפון לחזרה" optional><input id="dk-phone" className="input w-full" dir="ltr" maxLength={30} value={f.fromPhone} onChange={(ev) => set('fromPhone')(ev.target.value)} /></Field>
          </div>
        )}
        {kind === 'wakeup' && (
          <>
            <div className="ui-grid-2">
              <Field id="dk-time" label="שעה" required error={e.time}><input id="dk-time" type="time" className="input w-full" value={f.time} onChange={(ev) => set('time')(ev.target.value)} /></Field>
              <Field id="dk-date" label="תאריך" optional hint="ריק = מחר" error={e.date}><input id="dk-date" type="date" className="input w-full" min={businessDate} value={f.date} onChange={(ev) => set('date')(ev.target.value)} /></Field>
            </div>
            <Field id="dk-until" label="כל יום עד" optional hint="השכמה יומית עד התאריך (לא אחרי העזיבה)" error={e.untilDate}><input id="dk-until" type="date" className="input w-full" min={f.date || businessDate} value={f.untilDate} onChange={(ev) => set('untilDate')(ev.target.value)} /></Field>
            <label className="ui-check"><input type="checkbox" checked={f.wholeGroup} onChange={(ev) => set('wholeGroup')(ev.target.checked)} /> לכל הקבוצה של האורח (השוהים בבית)</label>
          </>
        )}
        {kind === 'locator' && (
          <Field id="dk-untilat" label="עד מתי" required error={e.until}><input id="dk-untilat" type="datetime-local" className="input w-full" value={f.until} onChange={(ev) => set('until')(ev.target.value)} /></Field>
        )}
        {kind === 'trace' && (
          <div className="ui-grid-2">
            <Field id="dk-dept" label="מחלקה" required error={e.department}>
              <select id="dk-dept" className="select w-full" value={f.department} onChange={(ev) => set('department')(ev.target.value)} disabled={!!ownDepartment}>
                {Object.entries(departments).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <div className="ui-grid-2">
              <Field id="dk-fd" label="מתאריך" required><input id="dk-fd" type="date" className="input w-full" value={f.fromDate} onChange={(ev) => set('fromDate')(ev.target.value)} /></Field>
              <Field id="dk-td" label="עד" error={e.toDate}><input id="dk-td" type="date" className="input w-full" min={f.fromDate} value={f.toDate} onChange={(ev) => set('toDate')(ev.target.value)} /></Field>
            </div>
          </div>
        )}
        {kind === 'alert' && (
          <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
            <legend className="ui-label">מתי להקפיץ · חובה</legend>
            {Object.entries(ALERT_ON_LABELS).map(([k, l]) => <label key={k} className="ui-check"><input type="checkbox" checked={f.on?.includes(k)} onChange={() => toggleOn(k)} /> {l}</label>)}
          </fieldset>
        )}
        {kind !== 'wakeup' && (
          <Field id="dk-text" label={{ message: 'ההודעה', alert: 'מה להזכיר', trace: 'מה לעשות', locator: 'איפה האורח', logbook: 'ההודעה למשמרת' }[kind]} required error={e.text}>
            {kind === 'locator'
              ? <input id="dk-text" className="input w-full" maxLength={200} value={f.text} onChange={(ev) => set('text')(ev.target.value)} placeholder="בבריכה, בספא, במסעדה…" autoFocus={!!stay} />
              : <textarea id="dk-text" className="input w-full" rows={3} maxLength={1000} value={f.text} onChange={(ev) => set('text')(ev.target.value)} autoFocus={!!stay} />}
          </Field>
        )}
        {kind === 'trace' && templates.length > 0 && (
          <div className="dk-chips">{templates.map((t) => <button key={t} type="button" className="dk-chip" onClick={() => set('text')(t)}>{t}</button>)}</div>
        )}
        {kind === 'logbook' && <label className="ui-check"><input type="checkbox" checked={f.important} onChange={(ev) => set('important')(ev.target.checked)} /> חשוב — להבליט למשמרת הבאה</label>}
      </form>
    </Modal>
  );
}

// Pop-up of a stay's alerts at a moment (check_in / check_out / open). Shown once per opening.
export function DeskAlerts({ open, propertyId, reservationId, moment }) {
  const [alerts, setAlerts] = useState([]);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open || !reservationId || !propertyId) { setShown(false); setAlerts([]); return; }
    let live = true;
    desk.stay(propertyId, reservationId).then((d) => { if (live) setAlerts((d.alerts || []).filter((a) => a.on.includes(moment))); }).catch(() => {});
    return () => { live = false; };
  }, [open, reservationId, propertyId, moment]);
  const visible = open && alerts.length > 0 && !shown;
  return (
    <Modal open={visible} onClose={() => setShown(true)} width={460} title={alerts.length === 1 ? 'התראה על ההזמנה' : `${alerts.length} התראות על ההזמנה`}
      footer={<button type="button" className="btn btn-primary" onClick={() => setShown(true)}>הבנתי</button>}>
      <ul className="dk-alerts">
        {alerts.map((a) => <li key={a.id}><BellRing size={16} aria-hidden="true" /><div><b>{a.text}</b><span className="ui-sub">{a.createdBy} · {formatShort(String(a.createdAt).slice(0, 10))}</span></div></li>)}
      </ul>
    </Modal>
  );
}

// Stay-file card: what the desk holds for this stay, with quick add and close actions.
export function StayDeskCard({ propertyId, reservation, canWork, businessDate, onToast }) {
  const rid = reservation.id;
  const { data, reload } = useLoader(() => desk.stay(propertyId, rid), [propertyId, rid]);
  const [dialog, setDialog] = useState(null);
  const [err, setErr] = useState(null);
  const stay = useMemo(() => ({ reservationId: rid, room: reservation.room || null, guest: reservation.guest || '' }), [rid, reservation.room, reservation.guest]);
  const close = async (ids, status, extra = {}) => { setErr(null); try { await desk.close(propertyId, { ids, status, ...extra }); onToast?.(status === 'done' ? 'עודכן' : 'בוטל'); reload(); } catch (e) { setErr(e); } };
  const deliverPrinted = (m) => { if (printMessageSlip(m)) close([m.id], 'done', { deliveredHow: 'printed' }); };
  const d = data || { messages: [], alerts: [], traces: [], wakeups: [], locator: null };
  const empty = !d.messages.length && !d.alerts.length && !d.traces.length && !d.wakeups.length && !d.locator;
  return (
    <section className="rsv-card dk-card" aria-labelledby="rsv-desk">
      <div className="rsv-card-h">
        <h2 id="rsv-desk">תקשורת קבלה</h2>
      </div>
      <ErrorBanner error={err} />
      {empty && <p className="ui-sub">אין הודעות, השכמות או התראות.</p>}
      {d.messages.map((m) => (
        <div key={m.id} className="dk-row is-msg">
          <MessageSquare size={15} aria-hidden="true" />
          <div className="dk-row-main"><b>הודעה מ{m.from}</b>{m.fromPhone && <bdi dir="ltr"> {m.fromPhone}</bdi>}<div className="dk-row-text">{m.text}</div></div>
          {canWork && <span className="dk-row-acts"><button type="button" className="dk-link" onClick={() => close([m.id], 'done', { deliveredHow: 'verbal' })}>נמסרה</button><button type="button" className="dk-link" onClick={() => deliverPrinted(m)}>הדפסה</button></span>}
        </div>
      ))}
      {d.locator && <div className="dk-row"><MapPin size={15} aria-hidden="true" /><div className="dk-row-main"><b>{d.locator.text}</b> <span className="ui-sub">עד {formatTime(d.locator.until)}</span></div>{canWork && <button type="button" className="dk-link" onClick={() => close([d.locator.id], 'done')}>חזר</button>}</div>}
      {d.wakeups.slice(0, 3).map((w) => <div key={w.id} className="dk-row"><AlarmClock size={15} aria-hidden="true" /><div className="dk-row-main"><b>השכמה {w.time}</b> <span className="ui-sub">{formatShort(w.date)}{w.status === 'no_answer' ? ' · לא ענה' : ''}</span></div>{canWork && <button type="button" className="dk-link" onClick={() => close([w.id], 'cancelled')}>ביטול</button>}</div>)}
      {d.wakeups.length > 3 && <p className="ui-sub">ועוד {d.wakeups.length - 3} השכמות</p>}
      {d.alerts.map((a) => <div key={a.id} className="dk-row"><BellRing size={15} aria-hidden="true" /><div className="dk-row-main"><b>{a.text}</b> <span className="ui-sub">{a.on.map((o) => ALERT_ON_LABELS[o]).join(', ')}</span></div>{canWork && <button type="button" className="dk-link" onClick={() => close([a.id], 'cancelled')}>הסרה</button>}</div>)}
      {d.traces.map((t) => <div key={t.id} className="dk-row"><ListTodo size={15} aria-hidden="true" /><div className="dk-row-main"><b>{t.text}</b> <span className="ui-sub">{d.departments?.[t.department] || t.department} · {formatShort(t.fromDate)}{t.toDate !== t.fromDate ? `–${formatShort(t.toDate)}` : ''}</span></div>{canWork && <button type="button" className="dk-link" onClick={() => close([t.id], 'done')}>טופל</button>}</div>)}
      {canWork && (
        <div className="dk-add" aria-label="הוספה">
          {[['message', 'הודעה'], ['wakeup', 'השכמה'], ['locator', 'איפה האורח'], ['alert', 'התראה'], ['trace', 'Trace']].map(([k, l]) => (
            <button key={k} type="button" className="dk-chip" onClick={() => setDialog(k)}><Plus size={12} aria-hidden="true" /> {l}</button>
          ))}
        </div>
      )}
      <DeskItemDialog open={!!dialog} kind={dialog} onClose={() => setDialog(null)} propertyId={propertyId} stay={stay} businessDate={businessDate} departments={d.departments} templates={d.templates} onSaved={(o) => { setDialog(null); onToast?.(o.count > 1 ? `נשמרו ${o.count} רשומות` : 'נשמר'); reload(); }} />
    </section>
  );
}
