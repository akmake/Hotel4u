// Front-desk communication (gap-map item 4) — one screen with tabs: the operator (find a guest by name
// or room: where they are, messages, wake-up), guest messages, wake-up calls of the day, traces by
// department, the shift log book and the phone book.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Plus, Phone, Globe, Star } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useAuthStore } from '../stores/authStore';
import { desk } from '../utils/api';
import { formatShort } from '../utils/date';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import {
  Page, PageBar, Segmented, Card, DataTable, Tag, Empty, SearchBox, Modal, Field, ErrorBanner, Spinner, ConfirmDialog,
  useUrlState, useLoader, useAction, formatTime, formatDateTime,
} from '../components/kit';
import { DeskItemDialog, printMessageSlip, WAKE_STATUS } from '../components/desk/DeskParts';

const DESK_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'cashier'];
const DEFAULTS = { tab: 'operator', q: '', view: 'open', date: '', dept: '' };
const TABS = [
  { value: 'operator', label: 'מרכזנית' },
  { value: 'messages', label: 'הודעות לאורחים' },
  { value: 'wakeups', label: 'השכמות' },
  { value: 'traces', label: 'Traces' },
  { value: 'logbook', label: 'יומן משמרת' },
  { value: 'phones', label: 'ספר טלפונים' },
];
const DEPT_ROLES = ['housekeeping_manager', 'housekeeper', 'maintenance_manager', 'technician'];

export default function DeskPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState(DEFAULTS);
  const { toasts, success } = useToast();
  const [dialog, setDialog] = useState(null);
  const canWork = DESK_ROLES.includes(role);
  const tab = DEPT_ROLES.includes(role) ? 'traces' : url.get('tab');
  const tabs = DEPT_ROLES.includes(role) ? TABS.filter((t) => t.value === 'traces') : TABS;
  const done = (msg) => { setDialog(null); success(msg); setTick((n) => n + 1); };
  const [tick, setTick] = useState(0);
  const common = { propertyId, url, canWork, tick, onAdd: (kind, stay, meta) => setDialog({ kind, stay, businessDate: meta?.businessDate, departments: meta?.departments, templates: meta?.templates, ownDepartment: meta?.ownDepartment }), onToast: success };
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="תקשורת קבלה" back="/pms" />
      <Segmented label="אזורי תקשורת" value={tab} onChange={(v) => url.set({ tab: v, q: '', view: 'open', date: '', dept: '' })} options={tabs} />
      {tab === 'operator' && <OperatorTab {...common} />}
      {tab === 'messages' && <MessagesTab {...common} />}
      {tab === 'wakeups' && <WakeupsTab {...common} />}
      {tab === 'traces' && <TracesTab {...common} role={role} />}
      {tab === 'logbook' && <LogbookTab {...common} />}
      {tab === 'phones' && <PhonesTab {...common} />}
      <DeskItemDialog open={!!dialog} kind={dialog?.kind} stay={dialog?.stay} onClose={() => setDialog(null)} propertyId={propertyId} businessDate={dialog?.businessDate}
        departments={dialog?.departments} templates={dialog?.templates} ownDepartment={dialog?.ownDepartment}
        onSaved={(o) => done(o.count > 1 ? `נשמרו ${o.count} רשומות` : 'נשמר')} />
    </Page>
  );
}

function useClose(propertyId, reload, onToast) {
  const [err, setErr] = useState(null);
  const run = async (ids, status, extra = {}, msg = 'עודכן') => {
    setErr(null);
    try { await desk.close(propertyId, { ids, status, ...extra }); onToast(msg); reload(); } catch (e) { setErr(e); }
  };
  return { err, run };
}

// ── Operator ───────────────────────────────────────────────────────────────
function OperatorTab({ propertyId, url, canWork, tick, onAdd }) {
  const nav = useNavigate();
  const { data, loading, error, reload } = useLoader(() => desk.operator(propertyId, url.get('q') || undefined), [propertyId, url.key, tick]);
  const stayOf = (r) => ({ reservationId: r.reservationId, room: r.room, guest: r.guest });
  const columns = [
    { key: 'room', label: 'חדר', nowrap: true, render: (r) => <span className="ui-room-n">{r.room || '—'}</span> },
    { key: 'guest', label: 'אורח', render: (r) => <div><button type="button" className="ui-guest-name" onClick={() => nav(`/pms/reservations/${r.reservationId}`)}>{r.guest}</button><div className="ui-sub">עד {formatShort(r.departureDate)} · {r.adults || 0} מבוגרים{r.children ? ` · ${r.children} ילדים` : ''}</div></div> },
    { key: 'where', label: 'איפה עכשיו', render: (r) => (r.locator ? <span><b>{r.locator.text}</b> <span className="ui-sub">עד {formatTime(r.locator.until)}</span></span> : <span className="ui-sub">—</span>) },
    { key: 'flags', label: 'ממתין', render: (r) => <div className="ui-row" style={{ gap: 4 }}>{r.messages > 0 && <Tag tone="bad">{r.messages === 1 ? 'הודעה' : `${r.messages} הודעות`}</Tag>}{r.wakeup && <Tag>השכמה {r.wakeup}</Tag>}</div> },
    canWork && { key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (r) => (
      <div className="ui-row" style={{ gap: 4 }}>
        <button type="button" className="dk-link" onClick={() => onAdd('message', stayOf(r))}>הודעה</button>
        <button type="button" className="dk-link" onClick={() => onAdd('wakeup', stayOf(r))}>השכמה</button>
        <button type="button" className="dk-link" onClick={() => onAdd('locator', stayOf(r))}>איפה</button>
      </div>
    ) },
  ].filter(Boolean);
  return (
    <Card flush title={data ? `${data.total} אורחים בבית` : 'אורחים בבית'} actions={<SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם, חדר או מספר הזמנה" id="dk-q" />}>
      <DataTable caption="מרכזנית — אורחים בבית" columns={columns} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} filtered={!!url.get('q')} empty={<Empty title="אין אורחים בבית" />} />
    </Card>
  );
}

// ── Messages ───────────────────────────────────────────────────────────────
function MessagesTab({ propertyId, url, canWork, tick, onAdd, onToast }) {
  const { data, loading, error, reload } = useLoader(() => desk.items(propertyId, { kind: 'message', view: url.get('view') }), [propertyId, url.key, tick]);
  const { err, run } = useClose(propertyId, reload, onToast);
  const open = url.get('view') === 'open';
  const columns = [
    { key: 'room', label: 'חדר', nowrap: true, render: (m) => <span className="ui-room-n">{m.room || '—'}</span> },
    { key: 'guest', label: 'לאורח', render: (m) => m.guest || '—' },
    { key: 'from', label: 'מאת', render: (m) => <div>{m.from}{m.fromPhone && <div className="ui-sub"><bdi dir="ltr">{m.fromPhone}</bdi></div>}</div> },
    { key: 'text', label: 'ההודעה', render: (m) => <span className="dk-text">{m.text}</span> },
    { key: 'at', label: 'התקבלה', nowrap: true, render: (m) => <div className="ui-num">{formatDateTime(m.createdAt)}<div className="ui-sub">{m.createdBy}</div></div> },
    { key: 'st', label: 'מצב', nowrap: true, render: (m) => (m.status === 'open' ? <Tag tone="bad">ממתינה</Tag> : m.status === 'done' ? <span className="ui-sub">נמסרה {m.deliveredHow === 'printed' ? 'בהדפסה' : 'בעל פה'} · {m.closedBy}</span> : <span className="ui-sub">בוטלה</span>) },
    canWork && open && { key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (m) => (
      <div className="ui-row" style={{ gap: 4 }}>
        <button type="button" className="dk-link" onClick={() => run([m.id], 'done', { deliveredHow: 'verbal' }, 'סומנה כנמסרה')}>נמסרה</button>
        <button type="button" className="dk-link" onClick={() => { if (printMessageSlip(m)) run([m.id], 'done', { deliveredHow: 'printed' }, 'הודפסה ונמסרה'); }}><Printer size={13} aria-hidden="true" /> הדפסה</button>
        <button type="button" className="dk-link is-muted" onClick={() => run([m.id], 'cancelled', {}, 'בוטלה')}>ביטול</button>
      </div>
    ) },
  ].filter(Boolean);
  return (
    <>
      <div className="dk-bar">
        <Segmented label="תצוגה" value={url.get('view')} onChange={(v) => url.set({ view: v })} options={[{ value: 'open', label: 'ממתינות', count: open ? data?.rows.length : undefined }, { value: 'all', label: 'הכול' }]} />
        {canWork && <button type="button" className="btn btn-primary" onClick={() => onAdd('message')}><Plus size={16} /> הודעה חדשה</button>}
      </div>
      <ErrorBanner error={err} />
      <Card flush><DataTable caption="הודעות לאורחים" columns={columns} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} empty={<Empty title={open ? 'אין הודעות שממתינות למסירה' : 'אין הודעות'} />} /></Card>
    </>
  );
}

// ── Wake-up calls ──────────────────────────────────────────────────────────
function WakeupsTab({ propertyId, url, canWork, tick, onAdd, onToast }) {
  const { data, loading, error, reload } = useLoader(() => desk.items(propertyId, { kind: 'wakeup', view: url.get('view'), date: url.get('date') || undefined }), [propertyId, url.key, tick]);
  const { err, run } = useClose(propertyId, reload, onToast);
  const date = url.get('date') || data?.businessDate || '';
  const columns = [
    { key: 'time', label: 'שעה', nowrap: true, render: (w) => <b className="ui-num dk-time">{w.time}</b> },
    { key: 'room', label: 'חדר', nowrap: true, render: (w) => <span className="ui-room-n">{w.room || '—'}</span> },
    { key: 'guest', label: 'אורח', render: (w) => <div>{w.guest || '—'}{w.text && w.text !== 'השכמה' && <div className="ui-sub">{w.text}</div>}</div> },
    { key: 'st', label: 'מצב', nowrap: true, render: (w) => <span>{w.status === 'open' ? <Tag>ממתינה</Tag> : <Tag tone={w.status === 'no_answer' ? 'bad' : w.status === 'done' ? 'ok' : undefined}>{WAKE_STATUS[w.status]}</Tag>}{w.closedAt && <span className="ui-sub"> {formatTime(w.closedAt)} · {w.closedBy}</span>}{w.closeNote && <div className="ui-sub">{w.closeNote}</div>}</span> },
    canWork && { key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (w) => (w.status === 'open' ? (
      <div className="ui-row dk-noprint" style={{ gap: 4 }}>
        <button type="button" className="dk-link" onClick={() => run([w.id], 'done', {}, 'ההשכמה בוצעה')}>בוצעה</button>
        <button type="button" className="dk-link" onClick={() => run([w.id], 'no_answer', {}, 'סומן: לא ענה')}>לא ענה</button>
        <button type="button" className="dk-link is-muted" onClick={() => run([w.id], 'cancelled', {}, 'בוטלה')}>ביטול</button>
      </div>
    ) : w.status === 'no_answer' ? <button type="button" className="dk-link dk-noprint" onClick={() => run([w.id], 'done', { note: 'ענה בניסיון חוזר' }, 'ההשכמה בוצעה')}>ענה בניסיון חוזר</button> : null) },
  ].filter(Boolean);
  return (
    <>
      <div className="dk-bar">
        <input type="date" className="input dk-date" value={date} onChange={(e) => url.set({ date: e.target.value })} aria-label="תאריך" />
        <Segmented label="תצוגה" value={url.get('view')} onChange={(v) => url.set({ view: v })} options={[{ value: 'open', label: 'ממתינות' }, { value: 'all', label: 'כל ההשכמות (דוח)' }]} />
        <span className="dk-bar-end">
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}><Printer size={16} /> הדפסת דוח</button>
          {canWork && <button type="button" className="btn btn-primary" onClick={() => onAdd('wakeup', null, data)}><Plus size={16} /> השכמה</button>}
        </span>
      </div>
      <ErrorBanner error={err} />
      <Card flush title={`השכמות ל־${date ? formatShort(date) : ''}`}><DataTable caption="השכמות" columns={columns} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} empty={<Empty title="אין השכמות ליום הזה" />} /></Card>
    </>
  );
}

// ── Traces ─────────────────────────────────────────────────────────────────
function TracesTab({ propertyId, url, tick, onAdd, onToast }) {
  const { data, loading, error, reload } = useLoader(() => desk.items(propertyId, { kind: 'trace', view: url.get('view'), from: url.get('date') || undefined, department: url.get('dept') || undefined }), [propertyId, url.key, tick]);
  const { err, run } = useClose(propertyId, reload, onToast);
  const [sel, setSel] = useState(() => new Set());
  const rows = data?.rows || [];
  const openRows = rows.filter((t) => t.status === 'open');
  const toggle = (id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const resolve = (ids) => run(ids, 'done', {}, ids.length > 1 ? `${ids.length} משימות סומנו כטופלו` : 'סומן כטופל').then(() => setSel(new Set()));
  const date = url.get('date') || data?.businessDate || '';
  const columns = [
    { key: 'sel', label: 'בחירה', srOnly: true, render: (t) => (t.status === 'open' ? <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label={`בחירת ${t.text}`} /> : null) },
    { key: 'dept', label: 'מחלקה', nowrap: true, render: (t) => <Tag>{data?.departments?.[t.department] || t.department}</Tag> },
    { key: 'text', label: 'משימה', render: (t) => <div><b>{t.text}</b>{t.room && <div className="ui-sub">חדר {t.room} · {t.guest}</div>}</div> },
    { key: 'when', label: 'תאריכים', nowrap: true, render: (t) => <span className="ui-num">{formatShort(t.fromDate)}{t.toDate !== t.fromDate ? ` – ${formatShort(t.toDate)}` : ''}</span> },
    { key: 'by', label: 'נרשם', nowrap: true, render: (t) => <span className="ui-sub">{t.createdBy}</span> },
    { key: 'st', label: 'מצב', nowrap: true, render: (t) => (t.status === 'open' ? <button type="button" className="dk-link" onClick={() => resolve([t.id])}>טופל</button> : <span className="ui-sub">{t.status === 'done' ? `טופל · ${t.closedBy}` : 'בוטל'}</span>) },
  ];
  return (
    <>
      <div className="dk-bar">
        <input type="date" className="input dk-date" value={date} onChange={(e) => url.set({ date: e.target.value })} aria-label="תאריך" />
        {!data?.ownDepartment && (
          <select className="select dk-sel" value={url.get('dept')} onChange={(e) => url.set({ dept: e.target.value })} aria-label="מחלקה">
            <option value="">כל המחלקות</option>
            {Object.entries(data?.departments || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        <Segmented label="תצוגה" value={url.get('view')} onChange={(v) => url.set({ view: v })} options={[{ value: 'open', label: 'לטיפול' }, { value: 'all', label: 'הכול' }]} />
        <span className="dk-bar-end">
          {sel.size > 0 && <button type="button" className="btn btn-secondary" onClick={() => resolve([...sel])}>סימון {sel.size} כטופלו</button>}
          {sel.size === 0 && openRows.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => resolve(openRows.map((t) => t.id))}>כולן טופלו</button>}
          <button type="button" className="btn btn-primary" onClick={() => onAdd('trace', null, data)}><Plus size={16} /> Trace</button>
        </span>
      </div>
      <ErrorBanner error={err} />
      <Card flush title={data?.ownDepartment ? `משימות ${data.departments?.[data.ownDepartment] || ''}` : undefined}>
        <DataTable caption="Traces" columns={columns} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} empty={<Empty title="אין משימות פתוחות ליום הזה" />} />
      </Card>
    </>
  );
}

// ── Log book ───────────────────────────────────────────────────────────────
function LogbookTab({ propertyId, canWork, tick, onAdd, onToast }) {
  const user = useAuthStore((s) => s.user);
  const { data, loading, error, reload } = useLoader(() => desk.items(propertyId, { kind: 'logbook' }), [propertyId, tick]);
  const { err, run } = useClose(propertyId, reload, onToast);
  const me = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  const markRead = async (id) => { await desk.read(propertyId, id); reload(); };
  return (
    <>
      <div className="dk-bar">
        <span className="ui-sub">הודעות בין משמרות — 14 הימים האחרונים{data?.unread ? ` · ${data.unread} לא נקראו` : ''}</span>
        {canWork && <span className="dk-bar-end"><button type="button" className="btn btn-primary" onClick={() => onAdd('logbook')}><Plus size={16} /> הודעה למשמרת</button></span>}
      </div>
      <ErrorBanner error={err || error} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && !data.rows.length && <Card><Empty title="היומן ריק">כתבו כאן מה המשמרת הבאה צריכה לדעת.</Empty></Card>}
      <div className="dk-log">
        {(data?.rows || []).map((x) => {
          const unread = !x.readBy.includes(me);
          return (
            <article key={x.id} className={`dk-log-item ${x.important ? 'is-important' : ''} ${unread ? 'is-unread' : ''}`}>
              <header>
                {x.important && <Star size={14} aria-label="חשוב" />}
                <b>{x.createdBy}</b><span className="ui-sub ui-num">{formatDateTime(x.createdAt)}</span>
                <span className="dk-bar-end">
                  {unread && canWork && <button type="button" className="dk-link" onClick={() => markRead(x.id)}>קראתי</button>}
                  {x.createdBy === me && <button type="button" className="dk-link is-muted" onClick={() => run([x.id], 'cancelled', {}, 'ההודעה הוסרה')}>הסרה</button>}
                </span>
              </header>
              <p>{x.text}</p>
              <footer className="ui-sub">נקרא על ידי: {x.readBy.join(', ')}</footer>
            </article>
          );
        })}
      </div>
    </>
  );
}

// ── Phone book ─────────────────────────────────────────────────────────────
function PhonesTab({ propertyId, url, canWork, onToast }) {
  const { data, loading, error, reload } = useLoader(() => desk.phoneBook(propertyId, url.get('q') || undefined), [propertyId, url.key]);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const cats = data?.categories || {};
  const groups = Object.keys(cats).map((k) => ({ k, label: cats[k], rows: (data?.rows || []).filter((x) => x.category === k) })).filter((g) => g.rows.length);
  return (
    <>
      <div className="dk-bar">
        <SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם, טלפון או קטגוריה" id="dk-pq" />
        {canWork && <span className="dk-bar-end"><button type="button" className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} /> רשומה</button></span>}
      </div>
      <ErrorBanner error={error} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && !groups.length && <Card><Empty title={url.get('q') ? 'לא נמצא' : 'ספר הטלפונים ריק'}>{!url.get('q') && 'הוסיפו השכרת רכב, מוניות, מסעדות ומספרי חירום.'}</Empty></Card>}
      <div className="dk-phones">
        {groups.map((g) => (
          <section key={g.k} className="fo-panel dk-phone-group" aria-label={g.label}>
            <h3 className="fo-panel-h">{g.label}</h3>
            <ul>
              {g.rows.map((x) => (
                <li key={x.id}>
                  <div className="dk-phone-main"><b>{x.name}</b>{x.note && <span className="ui-sub">{x.note}</span>}</div>
                  {x.phone && <a href={`tel:${x.phone}`} dir="ltr" className="dk-link"><Phone size={13} aria-hidden="true" /> {x.phone}</a>}
                  {x.website && <a href={x.website} target="_blank" rel="noopener noreferrer" className="dk-link"><Globe size={13} aria-hidden="true" /> אתר</a>}
                  {canWork && <span className="dk-row-acts"><button type="button" className="dk-link is-muted" onClick={() => setEdit(x)}>עריכה</button><button type="button" className="dk-link is-muted" onClick={() => setDel(x)}>הסרה</button></span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <PhoneDialog open={!!edit} entry={edit} categories={cats} propertyId={propertyId} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onToast('נשמר'); reload(); }} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="הסרה מספר הטלפונים" subtitle={del?.name} confirmLabel="הסרה" danger onConfirm={async () => { await desk.removePhone(propertyId, del.id); setDel(null); onToast('הוסר'); reload(); }}>
        <p className="ui-p">הרשומה תוסר מספר הטלפונים של המלון.</p>
      </ConfirmDialog>
    </>
  );
}

function PhoneDialog({ open, entry, categories, propertyId, onClose, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  useEffect(() => {
    if (open) { setF({ category: entry?.category || 'car_hire', name: entry?.name || '', phone: entry?.phone || '', website: entry?.website || '', note: entry?.note || '' }); act.reset(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const why = f.name?.trim().length < 2 ? 'שם' : !f.phone?.trim() && !f.website?.trim() ? 'טלפון או אתר' : null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={480} title={entry?.id ? 'עריכת רשומה' : 'רשומה חדשה בספר הטלפונים'}
      footer={<>{why && <span className="ui-foot-note">{why}</span>}<button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button><button type="submit" form="pb-form" className="btn btn-primary" disabled={act.busy || !!why}>שמירה</button></>}>
      <form id="pb-form" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) act.run(async () => onSaved(await desk.savePhone(propertyId, entry?.id, f))); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="pb-cat" label="קטגוריה" required><select id="pb-cat" className="select w-full" value={f.category} onChange={set('category')}>{Object.entries(categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field id="pb-name" label="שם" required error={act.fields.name}><input id="pb-name" className="input w-full" maxLength={120} value={f.name || ''} onChange={set('name')} /></Field>
          <Field id="pb-phone" label="טלפון" error={act.fields.phone}><input id="pb-phone" className="input w-full" dir="ltr" maxLength={40} value={f.phone || ''} onChange={set('phone')} /></Field>
          <Field id="pb-web" label="אתר" optional error={act.fields.website}><input id="pb-web" className="input w-full" dir="ltr" maxLength={300} value={f.website || ''} onChange={set('website')} placeholder="example.co.il" /></Field>
        </div>
        <Field id="pb-note" label="הערה" optional><input id="pb-note" className="input w-full" maxLength={300} value={f.note || ''} onChange={set('note')} placeholder="שעות פתיחה, איש קשר…" /></Field>
      </form>
    </Modal>
  );
}
