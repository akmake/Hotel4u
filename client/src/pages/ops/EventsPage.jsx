// Events (Optima "Event search" + "Events chart"): halls × days board, a search over bookings,
// the halls themselves, and one dialog to book / edit an event with its catering lines.
import { useEffect, useMemo, useState } from 'react';
import './EventsPage.css';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronRight, ChevronLeft } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { events as api, booking, groupBlocks } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, Segmented, SearchBox, DataTable, Empty, Modal, Field, ConfirmDialog, Tag, KeyValues,
  ErrorBanner, Spinner, useUrlState, useLoader, useAction, money,
} from '../../components/kit';

const WORK = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'sales_manager', 'revenue_manager', 'receptionist'];
const MANAGE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'sales_manager'];
const DEFAULTS = { tab: 'chart', from: '', q: '', status: '' };
const TONE = { tentative: 'warn', confirmed: 'ok', cancelled: 'bad' };
const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function EventDialog({ open, onClose, propertyId, initial, preset, spaces, kinds, setups, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const [cos, setCos] = useState([]);
  const [blocks, setBlocks] = useState([]);
  useEffect(() => {
    if (!open) return;
    act.reset();
    const e = initial || {};
    setF({
      name: e.name || '', kind: e.kind || 'meeting', spaceId: e.spaceId || preset?.spaceId || spaces[0]?.id || '', date: e.date || preset?.date || '', start: e.start || '09:00', end: e.end || '13:00',
      attendees: e.attendees ?? '', setup: e.setup || '', status: e.status || 'tentative', clientName: e.client?.name || '', clientPhone: e.client?.phone || '', clientEmail: e.client?.email || '',
      companyId: e.companyId || '', groupBlockId: e.groupBlockId || '', notes: e.notes || '', items: (e.items || []).map((i) => ({ description: i.description, quantity: String(i.quantity), unitPrice: String(i.unitPrice) })),
    });
    booking.companies(propertyId).then((r) => setCos(Array.isArray(r) ? r : [])).catch(() => setCos([]));
    groupBlocks.list(propertyId, {}).then((r) => setBlocks(r?.rows || [])).catch(() => setBlocks([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (ev) => setF((p) => ({ ...p, [k]: ev.target.value }));
  const setItem = (i, k, v) => setF((p) => ({ ...p, items: p.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const space = spaces.find((s) => s.id === f.spaceId);
  const total = (f.items || []).reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0);
  const e = act.fields;
  const why = (f.name || '').trim().length < 2 ? 'שם האירוע' : !f.spaceId ? 'בחרו אולם' : !f.date ? 'תאריך' : !(f.start < f.end) ? 'שעת סיום אחרי ההתחלה' : (f.clientName || '').trim().length < 2 ? 'שם המזמין' : space?.capacity && Number(f.attendees) > space.capacity ? `האולם מכיל עד ${space.capacity}` : null;
  const submit = () => act.run(async () => {
    const body = {
      name: f.name, kind: f.kind, spaceId: f.spaceId, date: f.date, start: f.start, end: f.end, attendees: Number(f.attendees || 0), setup: f.setup || undefined, status: f.status,
      client: { name: f.clientName, phone: f.clientPhone, email: f.clientEmail }, companyId: f.companyId || '', groupBlockId: f.groupBlockId || '', notes: f.notes,
      items: (f.items || []).filter((i) => i.description.trim()).map((i) => ({ description: i.description, quantity: Number(i.quantity || 0), unitPrice: Number(i.unitPrice || 0) })),
    };
    onSaved(initial ? await api.update(propertyId, initial.id, body) : await api.create(propertyId, body));
  });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={760} title={initial ? `אירוע ${initial.number}` : 'אירוע חדש'} subtitle="אולם תפוס באותן שעות לא יוזמן פעמיים"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button>
          <button type="submit" form="ev-form" className="btn btn-primary" disabled={!!why || act.busy} title={why || undefined}>{act.busy ? <Spinner /> : 'שמירה'}</button>
        </>
      )}>
      <form id="ev-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="ev-name" label="שם האירוע" required error={e.name}><input id="ev-name" className="input w-full" maxLength={120} value={f.name || ''} onChange={set('name')} /></Field>
          <Field id="ev-kind" label="סוג" required><select id="ev-kind" className="select w-full" value={f.kind} onChange={set('kind')}>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="ev-space" label="אולם" required error={e.spaceId}><select id="ev-space" className="select w-full" value={f.spaceId} onChange={set('spaceId')}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}{s.capacity ? ` · עד ${s.capacity}` : ''}</option>)}</select></Field>
          <Field id="ev-date" label="תאריך" required error={e.date}><input id="ev-date" type="date" className="input w-full" value={f.date} onChange={set('date')} /></Field>
          <Field id="ev-s" label="משעה" required error={e.start}><input id="ev-s" type="time" className="input w-full" value={f.start} onChange={set('start')} /></Field>
          <Field id="ev-e" label="עד שעה" required error={e.end}><input id="ev-e" type="time" className="input w-full" value={f.end} onChange={set('end')} /></Field>
          <Field id="ev-att" label="משתתפים" optional error={e.attendees} hint={space?.capacity ? `קיבולת ${space.capacity}` : undefined}><input id="ev-att" type="number" min="0" className="input w-full" value={f.attendees} onChange={set('attendees')} /></Field>
          <Field id="ev-setup" label="סידור" optional><select id="ev-setup" className="select w-full" value={f.setup} onChange={set('setup')}><option value="">—</option>{Object.entries(setups).filter(([k]) => !space?.setups?.length || space.setups.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="ev-cn" label="מזמין" required error={e['client.name']}><input id="ev-cn" className="input w-full" maxLength={120} value={f.clientName} onChange={set('clientName')} /></Field>
          <Field id="ev-cp" label="טלפון" optional><input id="ev-cp" dir="ltr" className="input w-full" maxLength={30} value={f.clientPhone} onChange={set('clientPhone')} /></Field>
          <Field id="ev-co" label="חברה" optional error={e.companyId}><select id="ev-co" className="select w-full" value={f.companyId} onChange={set('companyId')}><option value="">— ללא —</option>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field id="ev-gb" label="קבוצת לינה" optional error={e.groupBlockId}><select id="ev-gb" className="select w-full" value={f.groupBlockId} onChange={set('groupBlockId')}><option value="">— ללא —</option>{blocks.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.groupCode}</option>)}</select></Field>
          {!initial || initial.status === 'tentative' ? (
            <Field id="ev-st" label="מצב" required><select id="ev-st" className="select w-full" value={f.status} onChange={set('status')}><option value="tentative">אופציה</option><option value="confirmed">מאושר</option></select></Field>
          ) : null}
        </div>
        <fieldset className="ui-fieldset">
          <legend className="ui-label">מזון, ציוד ושירותים {total > 0 && <span className="ui-sub">· {money(total)}</span>}</legend>
          {e.items && <p className="ui-sub" style={{ color: 'rgb(185 28 28)' }}>{e.items}</p>}
          {(f.items || []).map((i, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 120px auto', gap: 8, marginBottom: 6 }}>
              <input className="input" aria-label="תיאור" placeholder="ארוחת צהריים, מקרן, הפסקת קפה…" value={i.description} onChange={(ev) => setItem(idx, 'description', ev.target.value)} />
              <input className="input" aria-label="כמות" type="number" min="0" value={i.quantity} onChange={(ev) => setItem(idx, 'quantity', ev.target.value)} />
              <input className="input" aria-label="מחיר ליחידה" type="number" min="0" step="0.01" placeholder="מחיר ליחידה" value={i.unitPrice} onChange={(ev) => setItem(idx, 'unitPrice', ev.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF((p) => ({ ...p, items: p.items.filter((_, j) => j !== idx) }))}>הסרה</button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setF((p) => ({ ...p, items: [...(p.items || []), { description: '', quantity: String(Number(p.attendees) || 1), unitPrice: '' }] }))}>הוספת שורה</button>
        </fieldset>
        <Field id="ev-notes" label="הערות תפעול" optional hint="תפריט, ציוד, שילוט, לוח זמנים"><textarea id="ev-notes" className="input w-full" rows={3} maxLength={2000} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}

function EventSheet({ open, onClose, propertyId, id, role, onEdit, onChanged }) {
  const nav = useNavigate();
  const [dialog, setDialog] = useState(null);
  const folioAct = useAction();
  const { data: e, loading, error, reload } = useLoader(async () => (open && id && propertyId ? api.get(propertyId, id) : null), [open, id, propertyId]);
  const canWork = WORK.includes(role);
  const live = e && ['tentative', 'confirmed'].includes(e.status);
  const done = () => { setDialog(null); reload(); onChanged?.(); };
  const openFolio = async () => { const out = await folioAct.run(() => api.openFolio(propertyId, e.id)); if (out) nav(`/pms/house-accounts?account=${out.folioId}`); };
  return (
    <Modal open={open} onClose={onClose} width={620} title={e ? `${e.name}` : 'אירוע'} subtitle={e ? `${e.number} · ${e.kindLabel}` : ''}
      footer={e && (
        <>
          {live && canWork && <button type="button" className="btn btn-ghost" onClick={() => setDialog('cancel')}>ביטול האירוע</button>}
          {e.status === 'confirmed' && canWork && <button type="button" className="btn btn-secondary" onClick={() => api.status(propertyId, e.id, 'done').then(done)}>סימון כהתקיים</button>}
          {e.status === 'tentative' && canWork && <button type="button" className="btn btn-secondary" onClick={() => api.status(propertyId, e.id, 'confirmed').then(done)}>אישור</button>}
          {e.status !== 'cancelled' && <button type="button" className="btn btn-secondary" disabled={folioAct.busy} onClick={openFolio}>{e.folioId ? 'לחשבון האירוע' : 'פתיחת חשבון'}</button>}
          {live && canWork && <button type="button" className="btn btn-primary" onClick={() => onEdit(e)}>עריכה</button>}
        </>
      )}>
      {loading && !e && <div className="ui-empty"><Spinner /></div>}
      <ErrorBanner error={error || folioAct.error} />
      {e && (
        <div className="ui-stack">
          <div><Tag tone={TONE[e.status]}>{e.statusLabel}</Tag></div>
          <KeyValues rows={[
            ['מתי', `${formatShort(e.date)} · ${e.start}–${e.end}`],
            ['אולם', `${e.spaceName}${e.capacity ? ` (עד ${e.capacity})` : ''}`],
            ['משתתפים', `${e.attendees || '—'}${e.setupLabel ? ` · ${e.setupLabel}` : ''}`],
            ['מזמין', `${e.client.name || '—'}${e.client.phone ? ` · ${e.client.phone}` : ''}${e.companyName ? ` · ${e.companyName}` : ''}`],
            e.groupName ? ['קבוצת לינה', e.groupName] : null,
            e.total ? ['סה״כ שירותים', money(e.total)] : null,
            e.cancelReason ? ['סיבת ביטול', e.cancelReason] : null,
          ]} />
          {e.items.length > 0 && (
            <table className="ui-table" style={{ width: '100%' }}>
              <thead><tr><th>פריט</th><th>כמות</th><th>מחיר</th><th>סה״כ</th></tr></thead>
              <tbody>{e.items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="ui-num">{i.quantity}</td><td className="ui-num">{money(i.unitPrice)}</td><td className="ui-num">{money(i.total)}</td></tr>)}</tbody>
            </table>
          )}
          {e.notes && <p className="ui-p" style={{ whiteSpace: 'pre-wrap' }}>{e.notes}</p>}
        </div>
      )}
      <ConfirmDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title="ביטול האירוע" confirmLabel="ביטול" danger requireReason onConfirm={(reason) => api.status(propertyId, e.id, 'cancelled', reason).then(done)}>
        <p className="ui-p">האולם יתפנה למועד זה.</p>
      </ConfirmDialog>
    </Modal>
  );
}

function Chart({ propertyId, url, onOpen, onNew }) {
  const from = url.get('from');
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? api.chart(propertyId, { from: from || undefined, days: 14 }) : null), [propertyId, from]);
  if (loading && !data) return <div className="ui-empty"><Spinner /> טוען…</div>;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;
  const start = data.dates[0];
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="btn btn-ghost btn-sm" aria-label="שבוע קודם" onClick={() => url.set({ from: addDays(start, -7) })}><ChevronRight size={16} /></button>
        <input type="date" className="input" aria-label="מתאריך" value={start} onChange={(e) => url.set({ from: e.target.value })} />
        <button type="button" className="btn btn-ghost btn-sm" aria-label="שבוע הבא" onClick={() => url.set({ from: addDays(start, 7) })}><ChevronLeft size={16} /></button>
        {from && <button type="button" className="btn btn-ghost btn-sm" onClick={() => url.set({ from: '' })}>היום</button>}
      </div>
      {!data.spaces.length ? (
        <Card><Empty title="אין אולמות">הוסיפו אולמות בלשונית "אולמות" כדי להזמין אירועים.</Empty></Card>
      ) : (
        <div className="ev-chart" style={{ overflowX: 'auto' }}>
          <table className="ev-grid">
            <thead>
              <tr>
                <th className="ev-sticky">אולם</th>
                {data.dates.map((d, i) => {
                  const t = data.totals[i];
                  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                  return <th key={d} className={`${d === data.today ? 'is-today' : ''} ${wd === 5 || wd === 6 ? 'is-weekend' : ''}`}><div>{DOW[wd]} {formatShort(d)}</div>{t.events ? <div className="ui-sub">{t.events} · {t.people} איש</div> : null}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {data.spaces.map((s) => (
                <tr key={s.id}>
                  <th className="ev-sticky"><div>{s.name}</div><div className="ui-sub">{s.capacity ? `עד ${s.capacity}` : ''}</div></th>
                  {s.cells.map((cell, i) => (
                    <td key={data.dates[i]} className={data.dates[i] === data.today ? 'is-today' : ''}>
                      {cell.map((e) => (
                        <button key={e.id} type="button" className={`ev-chip is-${e.status}`} onClick={() => onOpen(e.id)} title={`${e.name} · ${e.client}`}>
                          <b>{e.start}–{e.end}</b><span>{e.name}</span>{e.attendees ? <small>{e.attendees} איש</small> : null}
                        </button>
                      ))}
                      <button type="button" className="ev-add" aria-label={`אירוע ב${s.name} ${data.dates[i]}`} onClick={() => onNew({ spaceId: s.id, date: data.dates[i] })}>+</button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Search({ propertyId, url, onOpen, spaces }) {
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? api.search(propertyId, { q: url.get('q') || undefined, status: url.get('status') || undefined, from: url.get('from') || undefined }) : null), [propertyId, url.key]);
  const sm = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם אירוע, מזמין, טלפון או מספר" id="ev-q" />
        <input type="date" className="input" aria-label="מתאריך" value={url.get('from') || data?.from || ''} onChange={(e) => url.set({ from: e.target.value })} />
        <select className="select" aria-label="מצב" value={url.get('status')} onChange={(e) => url.set({ status: e.target.value })}><option value="">כל הפעילים</option><option value="tentative">אופציה</option><option value="confirmed">מאושר</option><option value="done">התקיים</option><option value="cancelled">בוטל</option></select>
      </div>
      <Card flush>
        <DataTable caption="אירועים" rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} onRowClick={(e) => onOpen(e.id)} filtered={!!url.get('q')}
          columns={[
            { key: 'd', label: 'מתי', nowrap: true, render: (e) => <span className="ui-num">{formatShort(e.date)} · {e.start}–{e.end}</span> },
            { key: 'n', label: 'אירוע', render: (e) => (<div>{e.name}<div className="ui-sub"><bdi>{e.number}</bdi> · {e.kindLabel}</div></div>) },
            { key: 's', label: 'אולם', nowrap: true, render: (e) => sm.get(e.spaceId)?.name || e.spaceName },
            { key: 'c', label: 'מזמין', render: (e) => `${e.client.name || '—'}${e.companyName ? ` · ${e.companyName}` : ''}` },
            { key: 'a', label: 'משתתפים', nowrap: true, render: (e) => <span className="ui-num">{e.attendees || '—'}</span> },
            { key: 't', label: 'שירותים', nowrap: true, align: 'left', render: (e) => (e.total ? <span className="ui-num">{money(e.total, 'ILS', 0)}</span> : '—') },
            { key: 'st', label: 'מצב', nowrap: true, render: (e) => <Tag tone={TONE[e.status]}>{e.statusLabel}</Tag> },
          ]}
          empty={<Empty title="אין אירועים בטווח" />} />
      </Card>
    </>
  );
}

function SpaceDialog({ open, onClose, propertyId, initial, setups, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { act.reset(); setF({ name: initial?.name || '', capacity: initial?.capacity ?? '', pricePerDay: initial?.pricePerDay ?? '', setups: initial?.setups || [], note: initial?.note || '', active: initial?.active ?? true }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const why = (f.name || '').trim().length < 2 ? 'שם האולם' : null;
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={520} title={initial ? `אולם ${initial.name}` : 'אולם חדש'}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button>
          <button type="submit" form="sp-form" className="btn btn-primary" disabled={!!why || act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button>
        </>
      )}>
      <form id="sp-form" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) act.run(async () => onSaved(await api.saveSpace(propertyId, initial?.id, { ...f, capacity: Number(f.capacity || 0) }))); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="sp-n" label="שם" required error={act.fields.name}><input id="sp-n" className="input w-full" maxLength={80} value={f.name || ''} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} /></Field>
          <Field id="sp-c" label="קיבולת (איש)" optional error={act.fields.capacity}><input id="sp-c" type="number" min="0" className="input w-full" value={f.capacity} onChange={(e) => setF((p) => ({ ...p, capacity: e.target.value }))} /></Field>
          <Field id="sp-p" label="מחיר ליום (₪)" optional><input id="sp-p" type="number" min="0" className="input w-full" value={f.pricePerDay} onChange={(e) => setF((p) => ({ ...p, pricePerDay: e.target.value }))} /></Field>
        </div>
        <fieldset className="ui-fieldset"><legend className="ui-label">סידורים אפשריים</legend>
          {Object.entries(setups).map(([k, v]) => <label key={k} className="ui-check"><input type="checkbox" checked={f.setups?.includes(k) || false} onChange={() => setF((p) => ({ ...p, setups: p.setups.includes(k) ? p.setups.filter((x) => x !== k) : [...p.setups, k] }))} /><span>{v}</span></label>)}
        </fieldset>
        <Field id="sp-note" label="הערה" optional><input id="sp-note" className="input w-full" maxLength={300} value={f.note || ''} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field>
        <label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} /><span>פעיל</span></label>
      </form>
    </Modal>
  );
}

export default function EventsPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState(DEFAULTS);
  const { toasts, success } = useToast();
  const [dialog, setDialog] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [tick, setTick] = useState(0);
  const sp = useLoader(async () => (propertyId ? api.spaces(propertyId, true) : null), [propertyId, tick]);
  const spaces = (sp.data?.rows || []).filter((s) => s.active);
  const tab = url.get('tab');
  const refresh = () => setTick((t) => t + 1);
  const canWork = WORK.includes(role);
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="אירועים ואולמות" back="/pms" tools={canWork && spaces.length ? <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'event' })}><Plus size={16} /> אירוע חדש</button> : null} />
      <Segmented label="לשוניות" value={tab} onChange={(v) => url.set({ tab: v })} options={[{ value: 'chart', label: 'לוח אולמות' }, { value: 'search', label: 'חיפוש אירועים' }, { value: 'spaces', label: 'אולמות' }]} />
      {tab === 'chart' && <Chart key={tick} propertyId={propertyId} url={url} onOpen={(id) => setSheet(id)} onNew={(preset) => canWork && setDialog({ kind: 'event', preset })} />}
      {tab === 'search' && <Search key={tick} propertyId={propertyId} url={url} spaces={sp.data?.rows || []} onOpen={(id) => setSheet(id)} />}
      {tab === 'spaces' && (
        <>
          {MANAGE.includes(role) && <div><button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'space' })}>הוספת אולם</button></div>}
          <Card flush>
            <DataTable caption="אולמות" rows={sp.data?.rows} loading={sp.loading && !sp.data} error={sp.error} onRetry={sp.reload} onRowClick={MANAGE.includes(role) ? (s) => setDialog({ kind: 'space', space: s }) : undefined}
              columns={[
                { key: 'n', label: 'אולם', render: (s) => s.name },
                { key: 'c', label: 'קיבולת', nowrap: true, render: (s) => <span className="ui-num">{s.capacity || '—'}</span> },
                { key: 's', label: 'סידורים', render: (s) => s.setups.map((x) => sp.data.setups[x]).join(' · ') || '—' },
                { key: 'p', label: 'מחיר ליום', nowrap: true, render: (s) => (s.pricePerDay ? money(s.pricePerDay, 'ILS', 0) : '—') },
                { key: 'a', label: 'מצב', nowrap: true, render: (s) => (s.active ? <Tag tone="ok">פעיל</Tag> : <Tag>מושבת</Tag>) },
              ]}
              empty={<Empty title="אין אולמות">הוסיפו אולם — שם, קיבולת וסידורים אפשריים.</Empty>} />
          </Card>
        </>
      )}
      <EventDialog open={dialog?.kind === 'event'} onClose={() => setDialog(null)} propertyId={propertyId} initial={dialog?.event} preset={dialog?.preset} spaces={spaces} kinds={sp.data?.kinds || {}} setups={sp.data?.setups || {}}
        onSaved={(o) => { setDialog(null); success(`האירוע ${o.number} נשמר`); refresh(); }} />
      <SpaceDialog open={dialog?.kind === 'space'} onClose={() => setDialog(null)} propertyId={propertyId} initial={dialog?.space} setups={sp.data?.setups || {}} onSaved={() => { setDialog(null); success('האולם נשמר'); refresh(); }} />
      <EventSheet open={!!sheet} onClose={() => setSheet(null)} propertyId={propertyId} id={sheet} role={role} onChanged={refresh} onEdit={(e) => { setSheet(null); setDialog({ kind: 'event', event: e }); }} />
    </Page>
  );
}
