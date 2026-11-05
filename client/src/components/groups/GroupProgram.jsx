// Group programme (gap-map item 6, knowledge 14): the day-by-day schedule of a group — meals from the
// catalog (kashrut, menu, diners, price, notes for the kitchen) and activities in a hall or a free
// location. A hall that is busy at the same time is a warning, not a block. A day can be copied to
// another day; the whole schedule prints for the client.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Copy, Printer, Pencil, Trash2, UtensilsCrossed, MapPin } from 'lucide-react';
import { groupBlocks } from '../../utils/api';
import { formatShort, formatLong } from '../../utils/date';
import { Modal, Field, Segmented, Banner, ErrorBanner, Spinner, Empty, Tag, ConfirmDialog, useLoader, useAction, money } from '../kit';

const WEEKDAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const weekday = (d) => WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()];
const KIND_TONE = { meal: 'ok', activity: undefined, general: undefined };

function Foot({ onClose, busy, label, why, form }) {
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ביטול</button>
      <button type="submit" form={form} className="btn btn-primary" disabled={!!why || busy} title={why || undefined}>{busy ? <Spinner /> : label}</button>
    </>
  );
}

function ItemDialog({ open, onClose, propertyId, groupId, program, item, day, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const opts = program?.options || { spaces: [], mealTypes: [], kosher: [] };
  useEffect(() => {
    if (!open) return;
    act.reset();
    const i = item || {};
    setF({
      kind: i.kind || 'meal', title: i.title || '', date: i.date || day || program?.group.arrivalDate || '', start: i.start || '12:30', end: i.end || '13:30',
      where: i.spaceId ? 'space' : i.location ? 'free' : 'space', spaceId: i.spaceId || opts.spaces[0]?.id || '', location: i.location || '',
      mealTypeId: i.mealTypeId || '', kosher: i.kosher || '', menu: i.menu || '',
      pax: i.pax ?? program?.group.pax ?? '', pricePerPax: i.pricePerPax || '', kitchenNotes: i.kitchenNotes || '', notes: i.notes || '',
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const meal = f.kind === 'meal';
  const mt = opts.mealTypes.find((m) => m.id === f.mealTypeId);
  // Kashrut follows the meal chosen; the first allowed one is preselected.
  useEffect(() => { if (mt && !mt.kosher.includes(f.kosher)) setF((p) => ({ ...p, kosher: mt.kosher[0] || '' })); }, [f.mealTypeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = program?.days?.map((d) => d.date) || [];
  const e = act.fields;
  const why = !f.date ? 'נדרש תאריך' : !f.start || !f.end ? 'נדרשות שעות' : meal && !f.mealTypeId ? 'בחרו סוג ארוחה' : meal && f.where !== 'space' ? 'ארוחה מוגשת באולם' : meal && !f.spaceId ? 'בחרו אולם' : !meal && (f.title || '').trim().length < 2 ? 'נדרשת כותרת' : null;
  const submit = () => act.run(async () => {
    const body = {
      kind: f.kind, title: f.title.trim() || undefined, date: f.date, start: f.start, end: f.end,
      spaceId: f.where === 'space' ? f.spaceId || null : null, location: f.where === 'free' ? f.location : undefined,
      mealTypeId: meal ? f.mealTypeId : undefined, kosher: meal ? f.kosher : undefined, menu: meal ? f.menu : undefined,
      pax: f.pax === '' ? undefined : Number(f.pax), pricePerPax: f.pricePerPax === '' ? 0 : Number(f.pricePerPax), kitchenNotes: f.kitchenNotes, notes: f.notes,
    };
    onSaved(item ? await groupBlocks.updateItem(propertyId, groupId, item.id, body) : await groupBlocks.addItem(propertyId, groupId, body));
  });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={640} title={item ? 'עריכת פריט בלו״ז' : 'פריט חדש בלו״ז'} subtitle={program?.group.name} footer={<Foot onClose={onClose} busy={act.busy} label={item ? 'שמירה' : 'הוספה'} why={why} form="gp-form" />}>
      <form id="gp-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <Segmented label="סוג" value={f.kind} onChange={(v) => setF((p) => ({ ...p, kind: v, where: v === 'meal' ? 'space' : p.where }))} options={(opts.kinds || []).map((k) => ({ value: k.value, label: k.label }))} />
        <div className="ui-grid-3">
          <Field id="gp-date" label="יום" required error={e.date}>
            <select id="gp-date" className="select w-full" value={f.date} onChange={set('date')}>{days.map((d) => <option key={d} value={d}>{weekday(d)} {formatShort(d)}</option>)}</select>
          </Field>
          <Field id="gp-start" label="התחלה" required error={e.start}><input id="gp-start" type="time" className="input w-full" value={f.start} onChange={set('start')} /></Field>
          <Field id="gp-end" label="סיום" required error={e.end} hint={f.end && f.start && f.end <= f.start ? 'אחרי חצות' : undefined}><input id="gp-end" type="time" className="input w-full" value={f.end} onChange={set('end')} /></Field>
        </div>
        {meal ? (
          <div className="ui-grid-3">
            <Field id="gp-meal" label="ארוחה" required error={e.mealTypeId}>
              <select id="gp-meal" className="select w-full" value={f.mealTypeId} onChange={set('mealTypeId')}><option value="">— בחרו —</option>{opts.mealTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            </Field>
            <Field id="gp-kosher" label="כשרות" required error={e.kosher}>
              <select id="gp-kosher" className="select w-full" value={f.kosher} onChange={set('kosher')} disabled={!mt}>{(mt?.kosher || []).map((k) => <option key={k} value={k}>{opts.kosher.find((x) => x.value === k)?.label || k}</option>)}</select>
            </Field>
            <Field id="gp-menu" label="תפריט" optional>
              <input id="gp-menu" className="input w-full" list="gp-menus" maxLength={120} value={f.menu} onChange={set('menu')} />
              <datalist id="gp-menus">{(mt?.menus || []).map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
          </div>
        ) : null}
        <Field id="gp-title" label="כותרת" required={!meal} optional={meal} hint={meal ? 'ריק = שם הארוחה' : undefined} error={e.title}><input id="gp-title" className="input w-full" maxLength={120} value={f.title} onChange={set('title')} /></Field>
        <div className="ui-grid-2">
          <Field id="gp-where" label="מיקום" error={e.spaceId}>
            <div style={{ display: 'flex', gap: 6 }}>
              {!meal && <select className="select" aria-label="סוג מיקום" value={f.where} onChange={set('where')}><option value="space">אולם</option><option value="free">מיקום חופשי</option></select>}
              {f.where === 'space'
                ? <select id="gp-where" className="select w-full" value={f.spaceId} onChange={set('spaceId')}><option value="">— בחרו אולם —</option>{opts.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}{s.capacity ? ` (${s.capacity})` : ''}</option>)}</select>
                : <input id="gp-where" className="input w-full" placeholder="חצר, לובי, אוטובוס…" maxLength={80} value={f.location} onChange={set('location')} />}
            </div>
          </Field>
          <div className="ui-grid-2">
            <Field id="gp-pax" label={meal ? 'סועדים' : 'משתתפים'} optional error={e.pax}><input id="gp-pax" type="number" min="0" className="input w-full" value={f.pax} onChange={set('pax')} /></Field>
            <Field id="gp-price" label="מחיר לאדם (₪)" optional error={e.pricePerPax}><input id="gp-price" type="number" min="0" step="0.01" className="input w-full" value={f.pricePerPax} onChange={set('pricePerPax')} /></Field>
          </div>
        </div>
        {meal && <Field id="gp-kn" label="דרישות למטבח" optional><input id="gp-kn" className="input w-full" maxLength={500} placeholder="צמחוניים, ללא גלוטן, הגשה לשולחנות…" value={f.kitchenNotes} onChange={set('kitchenNotes')} /></Field>}
        <Field id="gp-notes" label="הערה" optional><input id="gp-notes" className="input w-full" maxLength={500} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}

function DuplicateDialog({ open, onClose, propertyId, groupId, program, from, onSaved }) {
  const act = useAction();
  const src = program?.days.find((d) => d.date === from)?.items || [];
  const others = (program?.days || []).filter((d) => d.date !== from);
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState(new Set());
  useEffect(() => { if (open) { act.reset(); setTo(others[0]?.date || ''); setPicked(new Set(src.map((i) => i.id))); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const why = !to ? 'בחרו יום יעד' : !picked.size ? 'סמנו פריטים' : null;
  const submit = () => act.run(async () => onSaved(await groupBlocks.duplicateDay(propertyId, groupId, { from, to, itemIds: [...picked] })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={520} title="שכפול יום" subtitle={from ? `מ${weekday(from)} ${formatShort(from)}` : ''} footer={<Foot onClose={onClose} busy={act.busy} label={`שכפול ${picked.size || ''} פריטים`} why={why} form="gd-form" />}>
      <form id="gd-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <Field id="gd-to" label="ליום" required>
          <select id="gd-to" className="select w-full" value={to} onChange={(e) => setTo(e.target.value)}>{others.map((d) => <option key={d.date} value={d.date}>{weekday(d.date)} {formatShort(d.date)}{d.items.length ? ` · כבר ${d.items.length} פריטים` : ''}</option>)}</select>
        </Field>
        <ul className="gp-pick">
          {src.map((i) => (
            <li key={i.id}><label className="ui-check"><input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} /><span className="ui-num">{i.start}</span> <span>{i.title}</span></label></li>
          ))}
        </ul>
        <div className="ui-sub">מועתקים: כותרת, שעות, אולם או מיקום, סוג, ארוחה וכשרות, משתתפים, מחיר והערות.</div>
      </form>
    </Modal>
  );
}

// Meal catalog (managers): name, the kashrut it may be served in, menu options, active.
const KOSHER_OPTS = [{ value: 'meat', label: 'בשרי' }, { value: 'dairy', label: 'חלבי' }, { value: 'parve', label: 'פרווה' }];
export function MealCatalogDialog({ open, onClose, propertyId, onSaved }) {
  const act = useAction();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  useEffect(() => { if (open) { act.reset(); setEdit(null); groupBlocks.mealTypes(propertyId, true).then(setRows).catch(() => setRows([])); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const startEdit = (m) => setEdit(m ? { id: m.id, name: m.name, kosher: m.kosher, menus: m.menus.join('\n'), active: m.active, sortOrder: m.sortOrder } : { name: '', kosher: ['meat', 'dairy', 'parve'], menus: '', active: true, sortOrder: (rows?.length || 0) + 1 });
  const toggleK = (k) => setEdit((e) => ({ ...e, kosher: e.kosher.includes(k) ? e.kosher.filter((x) => x !== k) : [...e.kosher, k] }));
  const why = !edit ? 'בחרו ארוחה לעריכה' : edit.name.trim().length < 2 ? 'נדרש שם' : !edit.kosher.length ? 'לפחות כשרות אחת' : null;
  const submit = () => act.run(async () => { const out = await groupBlocks.saveMealType(propertyId, edit.id, { ...edit, menus: edit.menus.split('\n') }); setRows(out); setEdit(null); onSaved?.(); });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={640} title="קטלוג ארוחות" subtitle="ממנו בוחרים ארוחה בלו״ז של קבוצה" footer={<Foot onClose={onClose} busy={act.busy} label="שמירת הארוחה" why={why} form="mc-form" />}>
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        {!rows ? <div className="ui-empty"><Spinner /></div> : (
          <ul className="fo-lines">
            {rows.map((m) => (
              <li key={m.id} className="fo-line">
                <div className="fo-line-main">
                  <div className="fo-line-t">{m.name} {!m.active && <Tag tone="bad">לא פעיל</Tag>}</div>
                  <div className="fo-line-meta"><span>{m.kosher.map((k) => KOSHER_OPTS.find((x) => x.value === k)?.label).join(' / ')}</span>{m.menus.length > 0 && <span>{m.menus.length} תפריטים</span>}</div>
                </div>
                <button type="button" className="fo-line-act" onClick={() => startEdit(m)}>עריכה</button>
              </li>
            ))}
          </ul>
        )}
        {!edit && <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(null)}><Plus size={14} /> ארוחה חדשה</button></div>}
        {edit && (
          <form id="mc-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
            <div className="ui-grid-2">
              <Field id="mc-name" label="שם" required error={act.fields.name}><input id="mc-name" className="input w-full" maxLength={60} value={edit.name} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} /></Field>
              <Field id="mc-k" label="כשרויות אפשריות" required error={act.fields.kosher}>
                <div style={{ display: 'flex', gap: 12 }}>{KOSHER_OPTS.map((k) => <label key={k.value} className="ui-check"><input type="checkbox" checked={edit.kosher.includes(k.value)} onChange={() => toggleK(k.value)} /><span>{k.label}</span></label>)}</div>
              </Field>
            </div>
            <Field id="mc-menus" label="אפשרויות תפריט" optional hint="שורה לכל תפריט"><textarea id="mc-menus" rows={4} className="input w-full" value={edit.menus} onChange={(e) => setEdit((x) => ({ ...x, menus: e.target.value }))} /></Field>
            <label className="ui-check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit((x) => ({ ...x, active: e.target.checked }))} /><span>פעיל</span></label>
          </form>
        )}
      </div>
    </Modal>
  );
}

// Printable schedule for the client / coordinator.
function SchedulePrint({ program, hotel }) {
  return (
    <div className="ops-doc print-only" aria-hidden="true">
      <div className="ops-doc-head">
        <div><div className="ops-doc-hotel">{hotel || ''}</div><h2>לו״ז הקבוצה · {program.group.name}</h2><div className="ops-doc-sub">{formatShort(program.group.arrivalDate)} – {formatShort(program.group.departureDate)}{program.group.pax ? ` · ${program.group.pax} משתתפים` : ''}</div></div>
        <div className="ops-doc-meta">{program.group.groupCode}</div>
      </div>
      {program.days.filter((d) => d.items.length).map((d) => (
        <section key={d.date} className="ops-doc-section">
          <h3>{weekday(d.date)} · {formatLong(d.date)}</h3>
          <table className="ops-table">
            <thead><tr><th>שעה</th><th>מה</th><th>היכן</th><th>משתתפים</th></tr></thead>
            <tbody>{d.items.map((i) => <tr key={i.id}><td className="ui-num">{i.start}–{i.end}</td><td>{i.title}{i.kind === 'meal' && i.kosherLabel ? ` (${i.kosherLabel})` : ''}{i.menu ? ` · ${i.menu}` : ''}</td><td>{i.spaceName || i.location || '—'}</td><td className="ui-num">{i.pax || ''}</td></tr>)}</tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

export default function GroupProgram({ propertyId, groupId, canWork, onToast }) {
  const { data: p, loading, error, reload } = useLoader(async () => (propertyId ? groupBlocks.program(propertyId, groupId) : null), [propertyId, groupId]);
  const [day, setDay] = useState('');
  const [dialog, setDialog] = useState(null);
  const [warn, setWarn] = useState(null);
  const sel = useMemo(() => p?.days.find((d) => d.date === day) || p?.days.find((d) => d.items.length) || p?.days[0], [p, day]);
  if (loading && !p) return <div className="ui-empty"><Spinner /> טוען…</div>;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!p) return null;
  const live = !['cancelled', 'completed'].includes(p.group.status);
  const saved = (out) => {
    setDialog(null);
    setWarn(out?.warnings?.length ? out.warnings : null);
    onToast(out?.copied ? `שוכפלו ${out.copied} פריטים` : 'הלו״ז עודכן');
    reload();
  };
  const remove = async () => { await groupBlocks.removeItem(propertyId, groupId, dialog.item.id); setDialog(null); onToast('הפריט הוסר'); reload(); };
  const under = p.group.minPax && p.totals.meals ? p.days.some((d) => d.items.some((i) => i.kind === 'meal' && i.pax < p.group.minPax)) : false;
  return (
    <div className="gp">
      <div className="gp-days no-print" role="tablist" aria-label="ימי הקבוצה">
        {p.days.map((d) => (
          <button key={d.date} type="button" role="tab" aria-selected={sel?.date === d.date} className={`gp-day ${sel?.date === d.date ? 'is-on' : ''}`} onClick={() => setDay(d.date)}>
            <b>{weekday(d.date)}</b><span className="ui-num">{formatShort(d.date)}</span>
            <small>{d.items.length ? `${d.items.length} פריטים${d.diners ? ` · ${d.diners} סועדים` : ''}` : 'ריק'}</small>
          </button>
        ))}
      </div>
      <div className="gp-bar no-print">
        <div className="ui-sub">
          {p.totals.items} פריטים · {p.totals.meals} ארוחות · {p.totals.diners} מנות{p.totals.amount ? ` · ${money(p.totals.amount, 'ILS', 0)}` : ''}
          {p.group.minPax ? ` · התחייבות מינימום ${p.group.minPax}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()} disabled={!p.totals.items}><Printer size={14} /> הדפסת לו״ז</button>
          {live && canWork && sel && <button type="button" className="btn btn-secondary btn-sm" disabled={!sel.items.length || p.days.length < 2} onClick={() => setDialog({ kind: 'dup' })}><Copy size={14} /> שכפול היום</button>}
          {live && canWork && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'item' })}><Plus size={14} /> פריט ללו״ז</button>}
        </div>
      </div>
      {warn && <Banner tone="warn">האולם תפוס באותן שעות: {warn.map((w) => `${w.label} (${w.start}–${w.end})`).join(' · ')}. הפריט נשמר. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWarn(null)}>סגירה</button></Banner>}
      {under && <Banner tone="info">יש ארוחה עם פחות סועדים מההתחייבות ({p.group.minPax}). החיוב לפי ההתחייבות.</Banner>}
      {sel && (
        <section className="fo-panel no-print" aria-label={`לו״ז ${formatLong(sel.date)}`}>
          <h2 className="fo-panel-h">{weekday(sel.date)} · {formatLong(sel.date)}</h2>
          {!sel.items.length && <Empty title="אין פריטים ביום הזה" action={live && canWork ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'item' })}><Plus size={14} /> פריט ללו״ז</button> : null}>ארוחות, הרצאות, סיורים — כל מה שהקבוצה עושה ביום הזה.</Empty>}
          <ul className="fo-lines">
            {sel.items.map((i) => (
              <li key={i.id} className="fo-line">
                <span className="gp-time ui-num">{i.start}<small>{i.end}</small></span>
                <div className="fo-line-main">
                  <div className="fo-line-t">{i.kind === 'meal' && <UtensilsCrossed size={13} aria-hidden="true" />} {i.title} <Tag tone={KIND_TONE[i.kind]}>{i.kind === 'meal' ? i.kosherLabel : i.kindLabel}</Tag></div>
                  <div className="fo-line-meta">
                    <span><MapPin size={12} aria-hidden="true" /> {i.spaceName || i.location || 'ללא מיקום'}</span>
                    {i.menu && <span>{i.menu}</span>}
                    {i.pax > 0 && <span className="ui-num">{i.pax} {i.kind === 'meal' ? 'סועדים' : 'משתתפים'}</span>}
                    {i.total > 0 && <span className="ui-num">{money(i.total, 'ILS', 0)}</span>}
                    {i.kitchenNotes && <span>למטבח: {i.kitchenNotes}</span>}
                  </div>
                </div>
                {live && canWork && (
                  <span className="gp-acts">
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="עריכה" onClick={() => setDialog({ kind: 'item', item: i })}><Pencil size={14} /></button>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="הסרה" onClick={() => setDialog({ kind: 'remove', item: i })}><Trash2 size={14} /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <SchedulePrint program={p} />
      <ItemDialog open={dialog?.kind === 'item'} onClose={() => setDialog(null)} propertyId={propertyId} groupId={groupId} program={p} item={dialog?.item} day={sel?.date} onSaved={saved} />
      <DuplicateDialog open={dialog?.kind === 'dup'} onClose={() => setDialog(null)} propertyId={propertyId} groupId={groupId} program={p} from={sel?.date} onSaved={saved} />
      <ConfirmDialog open={dialog?.kind === 'remove'} onClose={() => setDialog(null)} title="הסרת פריט מהלו״ז" confirmLabel="הסרה" danger onConfirm={remove}><p className="ui-p">{dialog?.item?.title} · {dialog?.item?.start}</p></ConfirmDialog>
    </div>
  );
}
