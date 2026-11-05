// Revenue management (gap-map item 9): hotel calendar with day types, length-of-stay tiers per rate
// plan, channel restrictions (close / web discount) and automatic strategies by occupancy.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Play, ChevronRight, ChevronLeft, Trash2 } from 'lucide-react';
import '../ops/EventsPage.css';
import './RevenuePage.css';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { revenue, rates, roomTypes as roomTypesApi } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, DataTable, Empty, Modal, Field, Tag, Pill, ErrorBanner, Spinner, Segmented, Banner,
  useLoader, useAction, useUrlState, money, formatDateTime,
} from '../../components/kit';

const MANAGE = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager'];
const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const CHANNELS = { desk: 'קבלה / טלפון', web: 'אתר ההזמנות', ota: 'ערוצים חיצוניים' };
const ACTIONS = { stop_sell: 'סגירה למכירה', cta: 'סגירה להגעה', min_los: 'מינימום לילות' };
const heat = (p) => (p >= 90 ? 'is-hot' : p >= 75 ? 'is-high' : p >= 50 ? 'is-mid' : p >= 30 ? 'is-low' : 'is-cold');
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStart = (ymd) => addDays(ymd, -new Date(`${ymd}T00:00:00Z`).getUTCDay());
const range = (a, b) => (a || b ? `${a ? formatShort(a) : '…'} – ${b ? formatShort(b) : '…'}` : 'ללא הגבלה');

function Weekdays({ value, onChange }) {
  const toggle = (i) => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort());
  return <div className="rv-wd">{DOW.map((d, i) => <label key={d} className="ui-check"><input type="checkbox" checked={value.includes(i)} onChange={() => toggle(i)} /><span>{d}</span></label>)}</div>;
}

function Picks({ legend, items, value, onChange }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className="ui-fieldset"><legend className="ui-label">{legend} <span className="ui-sub">(ללא סימון = כולם)</span></legend>
      <div className="rv-wd">{items.map((t) => <label key={t.id} className="ui-check"><input type="checkbox" checked={value.includes(t.id)} onChange={() => toggle(t.id)} /><span>{t.name}</span></label>)}</div>
    </fieldset>
  );
}

// ── Hotel calendar ──────────────────────────────────────────────────────────

function DayTypeDialog({ open, onClose, propertyId, initial, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const lists = useLists(propertyId, open);
  useEffect(() => { if (open) { act.reset(); const t = initial || {}; setF({ code: t.code || '', name: t.name || '', color: t.color || '#f59e0b', multiplier: t.multiplier ?? 1, addition: t.addition ?? 0, planOrder: t.planOrder || [], active: t.active ?? true }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const order = f.planOrder || [];
  const toggleOrder = (id) => setF((p) => ({ ...p, planOrder: order.includes(id) ? order.filter((x) => x !== id) : [...order, id] }));
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const e = act.fields;
  const sample = Math.round((1000 + Number(f.addition || 0)) * Number(f.multiplier || 1));
  const submit = () => act.run(async () => onSaved(await revenue.saveDayType(propertyId, initial?.id, { ...f, multiplier: Number(f.multiplier), addition: Number(f.addition || 0) })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={480} title={initial ? `סוג יום ${initial.name}` : 'סוג יום חדש'} subtitle="המחיר ביום הזה = (מחיר + תוספת) × מכפיל, בכל תעריף שמשתתף בסוגי יום"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="submit" form="dt-form" className="btn btn-primary" disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <form id="dt-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="dt-code" label="קוד" required error={e.code}><input id="dt-code" dir="ltr" className="input w-full" maxLength={12} value={f.code || ''} onChange={(ev) => setF((p) => ({ ...p, code: ev.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))} /></Field>
          <Field id="dt-name" label="שם" required error={e.name}><input id="dt-name" className="input w-full" maxLength={60} value={f.name || ''} onChange={set('name')} placeholder="שיא, שפל, כנס…" /></Field>
          <Field id="dt-mul" label="מכפיל" required error={e.multiplier} hint="1.2 = ‎+20%‏ · 0.9 = ‎−10%‏"><input id="dt-mul" type="number" step="0.01" min="0.1" max="5" className="input w-full" value={f.multiplier} onChange={set('multiplier')} /></Field>
          <Field id="dt-add" label="תוספת (₪) לפני המכפיל" error={e.addition}><input id="dt-add" type="number" step="1" className="input w-full" value={f.addition} onChange={set('addition')} /></Field>
          <Field id="dt-col" label="צבע בלוח"><input id="dt-col" type="color" className="input w-full" value={f.color} onChange={set('color')} /></Field>
          <Field id="dt-ex" label="דוגמה"><div className="ui-sub" style={{ paddingTop: 8 }}>חדר ב־{money(1000, 'ILS', 0)} ← <b>{money(sample, 'ILS', 0)}</b></div></Field>
        </div>
        <fieldset className="ui-fieldset"><legend className="ui-label">תעריפים שמוצגים ראשונים <span className="ui-sub">(כשההגעה ביום מהסוג הזה; לפי סדר הסימון)</span></legend>
          <div className="rv-wd">{lists.plans.map((pl) => { const i = order.indexOf(pl.id); return <label key={pl.id} className="ui-check"><input type="checkbox" checked={i >= 0} onChange={() => toggleOrder(pl.id)} /><span>{i >= 0 ? <b>{i + 1}. </b> : null}{pl.name}</span></label>; })}</div>
        </fieldset>
        <label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={set('active')} /><span>פעיל</span></label>
      </form>
    </Modal>
  );
}

function DaysDialog({ open, onClose, propertyId, initial, dayTypes, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { act.reset(); const d = initial || {}; setF({ from: d.from, to: d.to, weekdays: [], dayTypeId: d.dayTypeId || '', note: d.note || '', events: (d.events || []).join(', ') }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const e = act.fields;
  const submit = () => act.run(async () => onSaved(await revenue.setCalendar(propertyId, { from: f.from, to: f.to, weekdays: f.weekdays, dayTypeId: f.dayTypeId || null, note: f.note, events: f.events })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={540} title="לוח המלון — ימים" subtitle="סוג היום משנה את המחיר; ההערה והאירועים מוצגים לצוות בלוח"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="submit" form="days-form" className="btn btn-primary" disabled={act.busy || !f.from || !f.to}>{act.busy ? <Spinner /> : 'עדכון הימים'}</button></>}>
      <form id="days-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="dd-from" label="מתאריך" required error={e.from}><input id="dd-from" type="date" className="input w-full" value={f.from || ''} onChange={(ev) => setF((p) => ({ ...p, from: ev.target.value, to: p.to && p.to >= ev.target.value ? p.to : ev.target.value }))} /></Field>
          <Field id="dd-to" label="עד תאריך" required error={e.to}><input id="dd-to" type="date" className="input w-full" min={f.from} value={f.to || ''} onChange={set('to')} /></Field>
        </div>
        <fieldset className="ui-fieldset"><legend className="ui-label">רק בימים <span className="ui-sub">(ללא סימון = כל הימים)</span></legend><Weekdays value={f.weekdays || []} onChange={(v) => setF((p) => ({ ...p, weekdays: v }))} /></fieldset>
        <Field id="dd-type" label="סוג יום" error={e.dayTypeId}>
          <select id="dd-type" className="select w-full" value={f.dayTypeId} onChange={set('dayTypeId')}>
            <option value="">רגיל (ללא סוג יום)</option>
            {dayTypes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name} · ×{t.multiplier}{t.addition ? ` +${t.addition}₪` : ''}</option>)}
          </select>
        </Field>
        <Field id="dd-ev" label="אירועים" optional hint="מופרדים בפסיק — כנס, חג, אירוע בעיר"><input id="dd-ev" className="input w-full" value={f.events || ''} onChange={set('events')} /></Field>
        <Field id="dd-note" label="הערה ליום" optional><input id="dd-note" className="input w-full" maxLength={300} value={f.note || ''} onChange={set('note')} /></Field>
      </form>
    </Modal>
  );
}

function CalendarTab({ propertyId, canManage, notify }) {
  const [from, setFrom] = useState('');
  const [days, setDays] = useState(null);
  const [typeDlg, setTypeDlg] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? revenue.calendar(propertyId, { from: from || undefined, days: 42 }) : null), [propertyId, from]);
  const types = data?.dayTypes || [];
  const typeBy = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const start = data ? weekStart(data.from) : null;
  const cells = useMemo(() => {
    if (!data) return [];
    const by = new Map(data.rows.map((r) => [r.date, r]));
    return Array.from({ length: 42 }, (_, i) => { const d = addDays(start, i); return by.get(d) || { date: d, out: true }; });
  }, [data, start]);
  const go = (n) => setFrom(addDays(data.from, n));
  return (
    <div className="rv-layout">
      <Card flush title={data ? `${formatShort(cells[0]?.date)} – ${formatShort(cells[41]?.date)}` : 'לוח המלון'}
        actions={data && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="שבועות קודמים" onClick={() => go(-28)}><ChevronRight size={16} /></button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFrom('')}>היום</button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="שבועות הבאים" onClick={() => go(28)}><ChevronLeft size={16} /></button>
            {canManage && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDays({ from: data.from, to: addDays(data.from, 6) })}>עדכון טווח</button>}
          </div>
        )}>
        <ErrorBanner error={error} onRetry={reload} />
        {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
        {data && (
          <div className="rv-cal" role="grid" aria-label="לוח המלון">
            {DOW.map((d) => <div key={d} className="rv-dow">{d}</div>)}
            {cells.map((c) => {
              const t = c.dayTypeId ? typeBy.get(c.dayTypeId) : null;
              const past = c.date < data.today;
              return (
                <button type="button" key={c.date} className={`rv-day${past ? ' is-past' : ''}${c.date === data.today ? ' is-today' : ''}`} disabled={!canManage || c.out}
                  title={[t?.name, ...(c.events || []), c.note, ...(c.auto || []).map((a) => `${a.label}${a.minLos ? ` ${a.minLos}` : ''} · ${a.strategy}${a.roomType ? ` · ${a.roomType}` : ''}`)].filter(Boolean).join('\n') || undefined}
                  onClick={() => setDays({ from: c.date, to: c.date, dayTypeId: c.dayTypeId, note: c.note, events: c.events })}>
                  {t && <span className="rv-day-band" style={{ background: t.color }} />}
                  <span className="rv-day-top"><span className="rv-day-num">{formatShort(c.date)}</span>{!c.out && <span className={`dm-heat rv-day-occ ${heat(c.occupancy)}`}>{c.occupancy}%</span>}</span>
                  {t && <span className="rv-day-type" style={{ color: t.color }}>{t.name}</span>}
                  {c.events?.length > 0 && <span className="rv-day-line">{c.events.join(' · ')}</span>}
                  {c.note && <span className="rv-day-line">{c.note}</span>}
                  {c.auto?.length > 0 && <span className="rv-day-auto">{c.auto.map((a) => (a.action === 'min_los' ? `מינ׳ ${a.minLos}` : a.label)).join(' · ')}</span>}
                </button>
              );
            })}
          </div>
        )}
      </Card>
      <Card flush title="סוגי יום" actions={canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTypeDlg({ t: null })}><Plus size={14} /> חדש</button>}>
        <div className="rv-types">
          {!types.length && <p className="ui-sub">אין סוגי יום. סוג יום (שיא, שפל, כנס) מעלה או מוריד את המחיר בימים שמשויכים אליו.</p>}
          {types.map((t) => (
            <button type="button" key={t.id} className={`rv-type${t.active ? '' : ' is-off'}`} disabled={!canManage} onClick={() => setTypeDlg({ t })}>
              <span className="rv-swatch" style={{ background: t.color }} />
              <span style={{ flex: 1 }}><b>{t.name}</b> <span className="ui-sub">{t.code}</span></span>
              <span className="ui-num ui-sub">×{t.multiplier}{t.addition ? ` ${t.addition > 0 ? '+' : ''}${t.addition}₪` : ''}</span>
            </button>
          ))}
          <p className="ui-sub">לחיצה על יום בלוח משייכת לו סוג יום, אירועים והערה. אחוז = תפוסה על הספרים (כולל הקצאות לקבוצות). אדום = הגבלה שאסטרטגיה הפעילה.</p>
        </div>
      </Card>
      <DayTypeDialog open={!!typeDlg} onClose={() => setTypeDlg(null)} propertyId={propertyId} initial={typeDlg?.t} onSaved={(t) => { setTypeDlg(null); notify(`סוג היום ${t.name} נשמר`); reload(); }} />
      <DaysDialog open={!!days} onClose={() => setDays(null)} propertyId={propertyId} initial={days} dayTypes={types} onSaved={(r) => { setDays(null); notify(`עודכנו ${r.updated} ימים`); reload(); }} />
    </div>
  );
}

// ── Length-of-stay tiers ────────────────────────────────────────────────────

function TiersTab({ propertyId, canManage, notify }) {
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? revenue.plans(propertyId) : null), [propertyId]);
  const [planId, setPlanId] = useState('');
  const [f, setF] = useState(null);
  const act = useAction();
  const plan = data?.plans.find((p) => p.id === planId) || data?.plans[0];
  useEffect(() => {
    if (!plan) return;
    act.reset();
    setF({ useDayTypes: plan.useDayTypes, tiers: plan.tiers.map((t) => ({ minNights: t.minNights, label: t.label, pct: t.pct ?? '', prices: Object.fromEntries(t.prices.map((x) => [x.roomTypeId, x.price])) })) });
  }, [plan?.id, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const types = data?.roomTypes || [];
  const setTier = (i, k, v) => setF((p) => ({ ...p, tiers: p.tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) }));
  const setPrice = (i, rt, v) => setF((p) => ({ ...p, tiers: p.tiers.map((t, j) => (j === i ? { ...t, prices: { ...t.prices, [rt]: v } } : t)) }));
  const add = () => setF((p) => { const last = p.tiers[p.tiers.length - 1]; return { ...p, tiers: [...p.tiers, { minNights: last ? Number(last.minNights) + 7 : 7, label: '', pct: '', prices: {} }] }; });
  const save = () => act.run(async () => {
    await revenue.savePlan(propertyId, plan.id, { useDayTypes: f.useDayTypes, tiers: f.tiers.map((t) => ({ minNights: Number(t.minNights), label: t.label, pct: t.pct === '' ? undefined : Number(t.pct), prices: Object.entries(t.prices).filter(([, v]) => v !== '' && Number(v) > 0).map(([roomTypeId, price]) => ({ roomTypeId, price: Number(price) })) })) });
    notify(`התעריף ${plan.code} נשמר`); reload();
  });
  if (loading && !data) return <div className="ui-empty"><Spinner /> טוען…</div>;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!plan) return <Empty title="אין תעריפים פעילים">הגדירו תעריף במסך המחירים.</Empty>;
  const e = act.fields;
  return (
    <div className="rv-layout" style={{ gridTemplateColumns: '220px minmax(0, 1fr)' }}>
      <Card flush title="תעריפים">
        <div className="rv-plan-list">
          {data.plans.map((p) => (
            <button type="button" key={p.id} className={`rv-plan${p.id === plan.id ? ' is-on' : ''}`} onClick={() => setPlanId(p.id)}>
              <b>{p.code}</b> <span className="ui-sub">{p.name}</span>
              <div className="ui-sub">{p.tiers.length ? `${p.tiers.length} מדרגות` : 'ללא מדרגות'}{p.useDayTypes ? '' : ' · לא בסוגי יום'}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title={`${plan.code} — מחיר לפי משך שהייה`} actions={canManage && f && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={add} disabled={f.tiers.length >= 8}><Plus size={14} /> מדרגה</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button>
        </div>
      )}>
        {f && (
          <div className="ui-stack">
            <ErrorBanner error={act.error} />
            <p className="ui-sub">מהמדרגה ומעלה, כל לילה בשהייה מתומחר לפי המדרגה: מחיר לסוג חדר (מחליף את מחיר הלילה) או אחוז הנחה. השהייה מקבלת את המדרגה הגבוהה שהיא מגיעה אליה.{plan.derived ? ' תעריף נגזר: מחיר מדרגה שלו גובר על הגזירה.' : ''}</p>
            {f.tiers.length === 0 ? <Banner tone="info">אין מדרגות — כל שהייה בתעריף הזה מתומחרת לפי לוח המחירים.</Banner> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="ui-table rv-tiers">
                  <thead><tr><th>מ־לילות</th><th>שם</th><th>הנחה %</th>{types.map((t) => <th key={t.id}>{t.name} ₪</th>)}<th aria-label="מחיקה" /></tr></thead>
                  <tbody>
                    {f.tiers.map((t, i) => (
                      <tr key={i}>
                        <td><input type="number" min="2" className="input" aria-label="מינימום לילות" aria-invalid={!!e[`tiers.${i}.minNights`]} title={e[`tiers.${i}.minNights`]} disabled={!canManage} value={t.minNights} onChange={(ev) => setTier(i, 'minNights', ev.target.value)} /></td>
                        <td><input className="input" aria-label="שם המדרגה" disabled={!canManage} placeholder={`${t.minNights}+ לילות`} value={t.label || ''} onChange={(ev) => setTier(i, 'label', ev.target.value)} /></td>
                        <td><input type="number" step="1" className="input" aria-label="אחוז הנחה" aria-invalid={!!e[`tiers.${i}.pct`]} title={e[`tiers.${i}.pct`]} disabled={!canManage} value={t.pct} onChange={(ev) => setTier(i, 'pct', ev.target.value)} /></td>
                        {types.map((rt) => <td key={rt.id}><input type="number" min="0" className="input" aria-label={`מחיר ${rt.name}`} disabled={!canManage} placeholder={rt.baseRate ? String(rt.baseRate) : '—'} value={t.prices[rt.id] ?? ''} onChange={(ev) => setPrice(i, rt.id, ev.target.value)} /></td>)}
                        <td>{canManage && <button type="button" className="btn btn-ghost btn-sm" aria-label="מחיקת מדרגה" onClick={() => setF((p) => ({ ...p, tiers: p.tiers.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <label className="ui-check"><input type="checkbox" disabled={!canManage} checked={!!f.useDayTypes} onChange={(ev) => setF((p) => ({ ...p, useDayTypes: ev.target.checked }))} /><span>התעריף משתתף בסוגי יום (שיא / שפל משנים את המחיר שלו)</span></label>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Channel restrictions ────────────────────────────────────────────────────

function useLists(propertyId, open) {
  const [lists, setLists] = useState({ types: [], plans: [] });
  useEffect(() => {
    if (!open || !propertyId) return;
    Promise.all([roomTypesApi.list(propertyId).catch(() => []), rates.plans(propertyId).catch(() => [])])
      .then(([t, p]) => setLists({ types: (Array.isArray(t) ? t : []).map((x) => ({ id: String(x._id), name: x.name })), plans: (Array.isArray(p) ? p : []).map((x) => ({ id: String(x._id), name: x.code })) }));
  }, [open, propertyId]);
  return lists;
}

function ChannelDialog({ open, onClose, propertyId, initial, today, onSaved }) {
  const act = useAction();
  const lists = useLists(propertyId, open);
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open) return; act.reset(); const r = initial || {};
    setF({ channel: r.channel || 'web', action: r.action || 'discount', pct: r.pct ?? 5, from: r.from || today, to: r.to || addDays(today, 30), ratePlans: (r.ratePlans || []).map((x) => x.id), roomTypes: (r.roomTypes || []).map((x) => x.id), note: r.note || '', active: r.active ?? true });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const e = act.fields;
  const submit = () => act.run(async () => onSaved(await revenue.saveChannelRule(propertyId, initial?.id, { ...f, pct: f.action === 'discount' ? Number(f.pct) : undefined })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={600} title={initial ? 'הגבלת ערוץ' : 'הגבלת ערוץ חדשה'} subtitle="סגירת תעריף בערוץ אחד, או הנחה בערוץ (למשל ‎5%‏ באתר) — לטווח לילות"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="submit" form="ch-form" className="btn btn-primary" disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <form id="ch-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="ch-c" label="ערוץ" required error={e.channel}><select id="ch-c" className="select w-full" value={f.channel} onChange={set('channel')}>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="ch-a" label="פעולה" required error={e.action}><select id="ch-a" className="select w-full" value={f.action} onChange={set('action')}><option value="discount">הנחה בערוץ</option><option value="close">סגירה בערוץ</option></select></Field>
          <Field id="ch-f" label="לילות מתאריך" required error={e.from}><input id="ch-f" type="date" className="input w-full" value={f.from || ''} onChange={set('from')} /></Field>
          <Field id="ch-t" label="עד תאריך" required error={e.to}><input id="ch-t" type="date" className="input w-full" min={f.from} value={f.to || ''} onChange={set('to')} /></Field>
          {f.action === 'discount' && <Field id="ch-p" label="אחוז הנחה" required error={e.pct}><input id="ch-p" type="number" min="1" max="90" className="input w-full" value={f.pct} onChange={set('pct')} /></Field>}
          <Field id="ch-n" label="הערה" optional><input id="ch-n" className="input w-full" maxLength={200} value={f.note || ''} onChange={set('note')} /></Field>
        </div>
        <Picks legend="תעריפים" items={lists.plans} value={f.ratePlans || []} onChange={(v) => setF((p) => ({ ...p, ratePlans: v }))} />
        <Picks legend="סוגי חדרים" items={lists.types} value={f.roomTypes || []} onChange={(v) => setF((p) => ({ ...p, roomTypes: v }))} />
        {f.channel === 'ota' && <Banner tone="info">ההגבלה נשלחת לתור ערוצי ההפצה; היא נאכפת במלואה רק אחרי חיבור למנהל ערוצים.</Banner>}
        <label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={set('active')} /><span>פעילה</span></label>
      </form>
    </Modal>
  );
}

function ChannelsTab({ propertyId, canManage, notify, today }) {
  const [dlg, setDlg] = useState(null);
  const [view, setView] = useState('active');
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? revenue.channelRules(propertyId) : null), [propertyId]);
  const all = data || [];
  const rows = all.filter((r) => (view === 'active' ? r.active && r.to >= today : !r.active || r.to < today));
  const cols = [
    { key: 'ch', label: 'ערוץ', nowrap: true, render: (r) => <b>{r.channelLabel}</b> },
    { key: 'a', label: 'פעולה', nowrap: true, render: (r) => (r.action === 'close' ? <Pill tone="bad">סגור</Pill> : <Pill tone="ok">הנחה {r.pct}%</Pill>) },
    { key: 'd', label: 'לילות', nowrap: true, render: (r) => <span className="ui-num">{range(r.from, r.to)}</span> },
    { key: 'p', label: 'תעריפים', render: (r) => (r.ratePlans.length ? r.ratePlans.map((p) => <Tag key={p.id}>{p.code}</Tag>) : <span className="ui-sub">כולם</span>) },
    { key: 't', label: 'סוגי חדרים', render: (r) => (r.roomTypes.length ? r.roomTypes.map((t) => <Tag key={t.id}>{t.name}</Tag>) : <span className="ui-sub">כולם</span>) },
    { key: 'n', label: 'הערה', render: (r) => <span className="ui-sub">{r.note || '—'}</span> },
    { key: 'u', label: 'עודכן', nowrap: true, render: (r) => <span className="ui-sub">{formatDateTime(r.updatedAt)}{r.updatedBy ? ` · ${r.updatedBy}` : ''}</span> },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Segmented label="סינון" value={view} onChange={setView} options={[{ value: 'active', label: 'פעילות', count: all.filter((r) => r.active && r.to >= today).length }, { value: 'off', label: 'הסתיימו / מושבתות' }]} />
        {canManage && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg({ r: null })}><Plus size={14} /> הגבלת ערוץ</button>}
      </div>
      <Card flush>
        <DataTable caption="הגבלות לפי ערוץ" columns={cols} rows={rows} loading={loading && !data} error={error} onRetry={reload} onRowClick={canManage ? (r) => setDlg({ r }) : undefined}
          empty={<Empty title="אין הגבלות ערוץ">סגירת תעריף באתר בלבד, או הנחה לאתר ההזמנות — בלי לגעת במחיר בקבלה.</Empty>} />
      </Card>
      <ChannelDialog open={!!dlg} onClose={() => setDlg(null)} propertyId={propertyId} initial={dlg?.r} today={today} onSaved={() => { setDlg(null); notify('ההגבלה נשמרה'); reload(); }} />
    </>
  );
}

// ── Strategies ──────────────────────────────────────────────────────────────

function StrategyDialog({ open, onClose, propertyId, initial, onSaved }) {
  const act = useAction();
  const lists = useLists(propertyId, open);
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open) return; act.reset(); const s = initial || {};
    setF({ name: s.name || '', priority: s.priority ?? 10, metric: s.metric || 'occupancy_pct', threshold: s.threshold ?? 85, action: s.action || 'min_los', minLos: s.minLos ?? 2, daysAhead: s.daysAhead ?? 90, stayFrom: s.stayFrom || '', stayTo: s.stayTo || '', controlFrom: s.controlFrom || '', controlTo: s.controlTo || '', weekdays: s.weekdays || [], roomTypes: (s.roomTypes || []).map((x) => x.id), ratePlans: (s.ratePlans || []).map((x) => x.id), active: s.active ?? true });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const e = act.fields;
  const submit = () => act.run(async () => onSaved(await revenue.saveStrategy(propertyId, initial?.id, { ...f, priority: Number(f.priority), threshold: Number(f.threshold), minLos: f.action === 'min_los' ? Number(f.minLos) : undefined, daysAhead: Number(f.daysAhead) })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={660} title={initial ? `אסטרטגיה: ${initial.name}` : 'אסטרטגיה חדשה'} subtitle="כשהתפוסה בלילה מגיעה לסף — ההגבלה מופעלת לבד, ומוסרת כשהתפוסה יורדת. נבדק כל 15 דקות."
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button><button type="submit" form="st-form" className="btn btn-primary" disabled={act.busy}>{act.busy ? <Spinner /> : 'שמירה והפעלה'}</button></>}>
      <form id="st-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-3">
          <Field id="st-n" label="שם" required error={e.name}><input id="st-n" className="input w-full" maxLength={80} value={f.name || ''} onChange={set('name')} placeholder="סוף שבוע מלא" /></Field>
          <Field id="st-m" label="תנאי" required><select id="st-m" className="select w-full" value={f.metric} onChange={set('metric')}><option value="occupancy_pct">תפוסה מגיעה ל־%</option><option value="rooms_sold">נמכרו חדרים</option></select></Field>
          <Field id="st-th" label={f.metric === 'rooms_sold' ? 'מספר חדרים' : 'אחוז תפוסה'} required error={e.threshold}><input id="st-th" type="number" min="1" className="input w-full" value={f.threshold} onChange={set('threshold')} /></Field>
          <Field id="st-a" label="פעולה" required error={e.action}><select id="st-a" className="select w-full" value={f.action} onChange={set('action')}>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {f.action === 'min_los' ? <Field id="st-ml" label="מינימום לילות" required error={e.minLos}><input id="st-ml" type="number" min="2" max="30" className="input w-full" value={f.minLos} onChange={set('minLos')} /></Field> : <div />}
          <Field id="st-p" label="עדיפות" error={e.priority} hint="1 = הכי גבוהה"><input id="st-p" type="number" min="1" className="input w-full" value={f.priority} onChange={set('priority')} /></Field>
          <Field id="st-da" label="ימים מראש" error={e.daysAhead} hint="חלון שזז עם הלוח"><input id="st-da" type="number" min="1" max="365" className="input w-full" value={f.daysAhead} onChange={set('daysAhead')} /></Field>
          <Field id="st-sf" label="לילות מתאריך" optional error={e.stayFrom}><input id="st-sf" type="date" className="input w-full" value={f.stayFrom} onChange={set('stayFrom')} /></Field>
          <Field id="st-st" label="לילות עד תאריך" optional error={e.stayTo}><input id="st-st" type="date" className="input w-full" value={f.stayTo} onChange={set('stayTo')} /></Field>
          <Field id="st-cf" label="בודקים מתאריך" optional error={e.controlFrom}><input id="st-cf" type="date" className="input w-full" value={f.controlFrom} onChange={set('controlFrom')} /></Field>
          <Field id="st-ct" label="בודקים עד תאריך" optional error={e.controlTo}><input id="st-ct" type="date" className="input w-full" value={f.controlTo} onChange={set('controlTo')} /></Field>
        </div>
        <fieldset className="ui-fieldset"><legend className="ui-label">רק בלילות <span className="ui-sub">(ללא סימון = כל הימים)</span></legend><Weekdays value={f.weekdays || []} onChange={(v) => setF((p) => ({ ...p, weekdays: v }))} /></fieldset>
        <Picks legend="סוגי חדרים — התפוסה נמדדת לכל סוג בנפרד" items={lists.types} value={f.roomTypes || []} onChange={(v) => setF((p) => ({ ...p, roomTypes: v }))} />
        <Picks legend="תעריפים שההגבלה חלה עליהם" items={lists.plans} value={f.ratePlans || []} onChange={(v) => setF((p) => ({ ...p, ratePlans: v }))} />
        <label className="ui-check"><input type="checkbox" checked={!!f.active} onChange={set('active')} /><span>פעילה</span></label>
      </form>
    </Modal>
  );
}

function StrategyTab({ propertyId, canManage, notify }) {
  const [dlg, setDlg] = useState(null);
  const [logView, setLogView] = useState('1');
  const act = useAction();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? revenue.strategies(propertyId) : null), [propertyId]);
  const lg = useLoader(async () => {
    if (!propertyId) return null;
    return logView === 'm' ? revenue.manualRestrictions(propertyId, { limit: 60 }) : revenue.restrictions(propertyId, { active: logView === '1' ? '1' : undefined, limit: 60 });
  }, [propertyId, logView]);
  const manualCols = [
    { key: 'd', label: 'לילה', nowrap: true, render: (a) => <span className="ui-num">{formatShort(a.date)}</span> },
    { key: 'o', label: 'על', render: (a) => <span>{a.level === 'rate' ? `תעריף ${a.ratePlan || '—'}` : 'מלאי המלון'}<span className="ui-sub"> · {a.roomType || '—'}</span></span> },
    { key: 'b', label: 'לפני', render: (a) => <span className="ui-sub">{a.before}</span> },
    { key: 'a', label: 'הוגדר', render: (a) => <b>{a.after}</b> },
    { key: 'n', label: 'פעיל עכשיו', render: (a) => (a.changedSince ? <Pill tone="warn">{a.now} (שונה מאז)</Pill> : <span>{a.now}</span>) },
    { key: 'w', label: 'מי ומתי', nowrap: true, render: (a) => <span className="ui-sub">{a.by} · {formatDateTime(a.at)}</span> },
  ];
  const run = () => act.run(async () => { const r = await revenue.runStrategies(propertyId); notify(`נבדק: ${r.placed} הופעלו, ${r.lifted} הוסרו`); reload(); lg.reload(); });
  const cols = [
    { key: 'n', label: 'אסטרטגיה', render: (s) => <div><b>{s.name}</b>{!s.active && <> <Pill>מושבתת</Pill></>}<div className="ui-sub">עדיפות {s.priority}</div></div> },
    { key: 'c', label: 'תנאי', nowrap: true, render: (s) => (s.metric === 'rooms_sold' ? `נמכרו ${s.threshold} חדרים` : `תפוסה ${s.threshold}%`) },
    { key: 'a', label: 'פעולה', nowrap: true, render: (s) => <b>{s.actionLabel}{s.minLos ? ` ${s.minLos}` : ''}</b> },
    { key: 'o', label: 'על', render: (s) => <span className="ui-sub">{s.roomTypes.length ? s.roomTypes.map((t) => t.name).join(', ') : 'כל המלון'}{s.ratePlans.length ? ` · ${s.ratePlans.map((p) => p.code).join(', ')}` : ''}</span> },
    { key: 'w', label: 'חלון', render: (s) => <span className="ui-sub">{s.daysAhead} ימים מראש{s.stayFrom || s.stayTo ? ` · ${range(s.stayFrom, s.stayTo)}` : ''}{s.weekdays.length ? ` · ${s.weekdays.map((d) => DOW[d]).join(' ')}` : ''}</span> },
    { key: 'x', label: 'פעילות עכשיו', nowrap: true, render: (s) => (s.activeCount ? <Pill tone="warn">{s.activeCount} לילות</Pill> : <span className="ui-sub">—</span>) },
    { key: 'r', label: 'נבדק', nowrap: true, render: (s) => <span className="ui-sub">{s.lastRunAt ? formatDateTime(s.lastRunAt) : '—'}</span> },
  ];
  const logCols = [
    { key: 'd', label: 'לילה', nowrap: true, render: (a) => <span className="ui-num">{formatShort(a.date)}</span> },
    { key: 'a', label: 'הגבלה', nowrap: true, render: (a) => <b>{a.label}{a.minLos ? ` ${a.minLos}` : ''}</b> },
    { key: 's', label: 'אסטרטגיה', render: (a) => <span>{a.strategy}{a.roomType ? <span className="ui-sub"> · {a.roomType}</span> : null}</span> },
    { key: 'm', label: 'נמדד', nowrap: true, render: (a) => <span className="ui-num">{a.measured}{a.liftedMeasured != null ? ` → ${a.liftedMeasured}` : ''}</span> },
    { key: 'p', label: 'הופעלה', nowrap: true, render: (a) => <span className="ui-sub">{formatDateTime(a.placedAt)}</span> },
    { key: 'l', label: 'הוסרה', nowrap: true, render: (a) => (a.liftedAt ? <span className="ui-sub">{formatDateTime(a.liftedAt)}</span> : <Pill tone="warn">פעילה</Pill>) },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {canManage && <button type="button" className="btn btn-secondary btn-sm" onClick={run} disabled={act.busy}>{act.busy ? <Spinner /> : <Play size={14} />} בדיקה עכשיו</button>}
        {canManage && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg({ s: null })}><Plus size={14} /> אסטרטגיה</button>}
      </div>
      <ErrorBanner error={act.error} />
      <Card flush>
        <DataTable caption="אסטרטגיות" columns={cols} rows={data || []} loading={loading && !data} error={error} onRetry={reload} onRowClick={canManage ? (s) => setDlg({ s }) : undefined}
          empty={<Empty title="אין אסטרטגיות">למשל: "כשסוף השבוע מגיע ל־85% — מינימום 2 לילות". המערכת בודקת כל 15 דקות ומסירה את ההגבלה כשהתפוסה יורדת.</Empty>} />
      </Card>
      <Card flush title="היסטוריית הגבלות" actions={<Segmented label="הגבלות" value={logView} onChange={setLogView} options={[{ value: '1', label: 'אוטומטיות פעילות' }, { value: '0', label: 'אוטומטיות — היסטוריה' }, { value: 'm', label: 'ידניות' }]} />}>
        <DataTable caption="היסטוריית הגבלות" columns={logView === 'm' ? manualCols : logCols} rows={lg.data || []} loading={lg.loading && !lg.data} error={lg.error} onRetry={lg.reload}
          empty={<Empty title={logView === '1' ? 'אין הגבלות פעילות' : logView === 'm' ? 'לא שונו הגבלות ידנית' : 'אין היסטוריה'}>{logView === 'm' ? 'כל שינוי של סגירה, סגירה להגעה/לעזיבה או מינימום/מקסימום לילות במסך המחירים או במלאי נרשם כאן, מול מה שפעיל עכשיו.' : null}</Empty>} />
      </Card>
      <StrategyDialog open={!!dlg} onClose={() => setDlg(null)} propertyId={propertyId} initial={dlg?.s} onSaved={(s) => { setDlg(null); notify(`האסטרטגיה ${s?.name || ''} נשמרה ונבדקה`); reload(); lg.reload(); }} />
    </>
  );
}

export default function RevenuePage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState({ tab: 'calendar' });
  const { toasts, success } = useToast();
  const canManage = MANAGE.includes(role);
  const today = new Date().toISOString().slice(0, 10);
  const tab = url.get('tab');
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="ניהול הכנסות" meta="סוגי יום, מדרגות שהייה, הגבלות לפי ערוץ ואסטרטגיה אוטומטית" back="/pms" />
      <Segmented label="מסך" value={tab} onChange={(v) => url.set({ tab: v })} options={[
        { value: 'calendar', label: 'לוח המלון וסוגי יום' }, { value: 'tiers', label: 'מדרגות שהייה' }, { value: 'channels', label: 'הגבלות לפי ערוץ' }, { value: 'strategy', label: 'אסטרטגיה אוטומטית' },
      ]} />
      {tab === 'calendar' && <CalendarTab propertyId={propertyId} canManage={canManage} notify={success} />}
      {tab === 'tiers' && <TiersTab propertyId={propertyId} canManage={canManage} notify={success} />}
      {tab === 'channels' && <ChannelsTab propertyId={propertyId} canManage={canManage} notify={success} today={today} />}
      {tab === 'strategy' && <StrategyTab propertyId={propertyId} canManage={canManage} notify={success} />}
    </Page>
  );
}
