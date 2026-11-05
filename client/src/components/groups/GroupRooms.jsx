// Group rooms (gap-map item 6, knowledge 05): per-night grid, rooming-list status / import / booking,
// receiving the group (rooms, check-in), and copying it to other dates (a series).
import { useEffect, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { groupBlocks } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { Modal, Field, Banner, ErrorBanner, Spinner, useAction } from '../kit';

const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const wd = (d) => WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()];
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function Foot({ onClose, busy, label, why, form }) {
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ביטול</button>
      <button type="submit" form={form} className="btn btn-primary" disabled={!!why || busy} title={why || undefined}>{busy ? <Spinner /> : label}</button>
    </>
  );
}

// Rooms per night for one room type; "fill" sets a number on a range of nights.
export function GridDialog({ open, onClose, propertyId, block, allotment, onSaved }) {
  const act = useAction();
  const [n, setN] = useState({});
  const [fill, setFill] = useState({ from: '', to: '', value: '' });
  useEffect(() => {
    if (!open || !allotment) return;
    act.reset();
    setN(Object.fromEntries(allotment.grid.map((g) => [g.date, String(g.blocked)])));
    setFill({ from: allotment.grid[0]?.date || '', to: allotment.grid[allotment.grid.length - 1]?.date || '', value: '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!allotment) return null;
  const low = allotment.grid.filter((g) => Number(n[g.date] || 0) < g.picked);
  const applyFill = () => { if (fill.value === '') return; setN((p) => { const x = { ...p }; for (const g of allotment.grid) if (g.date >= fill.from && g.date <= fill.to) x[g.date] = String(fill.value); return x; }); };
  const why = low.length ? `פחות מההזמנות בלילה ${formatShort(low[0].date)}` : null;
  const submit = () => act.run(async () => onSaved(await groupBlocks.grid(propertyId, block.id, { roomTypeId: allotment.roomTypeId, nights: Object.fromEntries(Object.entries(n).map(([d, v]) => [d, Number(v || 0)])) })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={720} title={`כמות לפי לילה · ${allotment.roomTypeName}`} subtitle={`${block.name} · ${formatShort(block.arrivalDate)} – ${formatShort(block.departureDate)}`} footer={<Foot onClose={onClose} busy={act.busy} label="שמירה" why={why} form="gg-form" />}>
      <form id="gg-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead><tr><th>לילה</th>{allotment.grid.map((g) => <th key={g.date} className="ui-num">{wd(g.date)} {formatShort(g.date)}</th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">חדרים</th>{allotment.grid.map((g) => <td key={g.date}><input className="input" style={{ width: 64 }} type="number" min={g.picked} max="500" aria-label={`חדרים ${g.date}`} value={n[g.date] ?? ''} onChange={(e) => setN((p) => ({ ...p, [g.date]: e.target.value }))} /></td>)}</tr>
              <tr><th scope="row">נרשמו</th>{allotment.grid.map((g) => <td key={g.date} className="ui-num">{g.picked}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="ui-row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field id="gg-from" label="מילוי מלילה"><select id="gg-from" className="select" value={fill.from} onChange={(e) => setFill((p) => ({ ...p, from: e.target.value }))}>{allotment.grid.map((g) => <option key={g.date} value={g.date}>{formatShort(g.date)}</option>)}</select></Field>
          <Field id="gg-to" label="עד לילה"><select id="gg-to" className="select" value={fill.to} onChange={(e) => setFill((p) => ({ ...p, to: e.target.value }))}>{allotment.grid.map((g) => <option key={g.date} value={g.date}>{formatShort(g.date)}</option>)}</select></Field>
          <Field id="gg-v" label="חדרים"><input id="gg-v" className="input" style={{ width: 80 }} type="number" min="0" value={fill.value} onChange={(e) => setFill((p) => ({ ...p, value: e.target.value }))} /></Field>
          <button type="button" className="btn btn-secondary" onClick={applyFill} disabled={fill.value === ''}>מילוי</button>
        </div>
        <div className="ui-sub">חדרים נוספים צריכים להיות פנויים באותו לילה. לילה לא יכול להחזיק פחות מההזמנות שבו.</div>
      </form>
    </Modal>
  );
}

// Excel import in fixed columns (knowledge 05 §6). A template can be downloaded.
const COLS = ['שם משפחה', 'שם פרטי', 'מבוגרים', 'ילדים', 'Share', 'הגעה', 'עזיבה', 'סוג חדר', 'טלפון', 'דוא״ל'];
const toYmd = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};
const yes = (v) => /^(כן|v|x|yes|1|true|✓)$/i.test(String(v || '').trim());

export function ImportDialog({ open, onClose, propertyId, block, onSaved }) {
  const act = useAction();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { act.reset(); setRows(null); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const template = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([COLS, ['כהן', 'משה', 2, 0, '', block.arrivalDate, block.departureDate, block.allotments[0]?.roomTypeName || '', '', ''], ['כהן', 'רבקה', 1, 0, 'כן', '', '', '', '', '']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'רשימת שמות');
    XLSX.writeFile(wb, `rooming-${block.groupCode}.xlsx`);
  };
  const read = async (file) => {
    setErr(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer());
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const head = (data[0] || []).map((h) => String(h).trim());
      const col = (name) => head.indexOf(name);
      if (col('שם משפחה') < 0 && col('שם פרטי') < 0) throw new Error(`העמודות בקובץ לא תואמות. בשורה הראשונה: ${COLS.join(' · ')}`);
      const out = data.slice(1).map((r) => {
        const v = (name) => (col(name) >= 0 ? r[col(name)] : '');
        const name = `${String(v('שם פרטי')).trim()} ${String(v('שם משפחה')).trim()}`.trim();
        return name ? { guestName: name, adults: Number(v('מבוגרים')) || undefined, children: Number(v('ילדים')) || 0, share: yes(v('Share')), arrivalDate: toYmd(v('הגעה')), departureDate: toYmd(v('עזיבה')), roomTypeName: String(v('סוג חדר')).trim() || undefined, guestPhone: String(v('טלפון')).trim() || undefined, guestEmail: String(v('דוא״ל')).trim() || undefined } : null;
      }).filter(Boolean);
      if (!out.length) throw new Error('לא נמצאו שורות עם שם');
      setRows(out);
    } catch (e) { setErr(e); setRows(null); }
  };
  const types = new Set(block.allotments.map((a) => a.roomTypeName));
  const unknown = (rows || []).filter((r) => !r.share && r.roomTypeName && !types.has(r.roomTypeName));
  const submit = () => act.run(async () => {
    const keep = block.roomingList.map((r) => ({ id: r.id, guestName: r.guestName, guestPhone: r.guestPhone, guestEmail: r.guestEmail, roomTypeId: r.roomTypeId, adults: r.adults, children: r.children, share: r.share, arrivalDate: r.arrivalDate, departureDate: r.departureDate, notes: r.notes }));
    onSaved(await groupBlocks.roster(propertyId, block.id, [...keep, ...rows]));
  });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={760} title="ייבוא רשימת שמות מאקסל" subtitle={`${block.name} · עמודות קבועות`} footer={<Foot onClose={onClose} busy={act.busy} label={rows ? `הוספת ${rows.length} שורות` : 'ייבוא'} why={!rows ? 'בחרו קובץ' : null} form="gi-form" />}>
      <form id="gi-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (rows) submit(); }}>
        <ErrorBanner error={act.error || err} />
        <div className="ui-sub">העמודות בשורה הראשונה: {COLS.join(' · ')}. ב־Share כותבים ״כן״ — האורח חולק את החדר עם השורה שמעליו.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={template}><Download size={14} /> הורדת תבנית</button>
          <label className="btn btn-primary btn-sm"><Upload size={14} /> בחירת קובץ<input type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && read(e.target.files[0])} /></label>
        </div>
        {unknown.length > 0 && <Banner tone="warn">סוג חדר לא מוכר ב־{unknown.length} שורות ({[...new Set(unknown.map((r) => r.roomTypeName))].join(', ')}) — יישמרו בלי סוג חדר. סוגים בבלוק: {[...types].join(', ')}</Banner>}
        {rows && (
          <div className="ui-table-wrap" style={{ maxHeight: 320 }}>
            <table className="ui-table">
              <thead><tr><th>שם</th><th>הרכב</th><th>Share</th><th>תאריכים</th><th>סוג חדר</th><th>טלפון</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}><td>{r.guestName}</td><td className="ui-num">{r.adults || '—'}{r.children ? `+${r.children}` : ''}</td><td>{r.share ? 'כן' : ''}</td><td className="ui-num">{r.arrivalDate ? `${formatShort(r.arrivalDate)}–${formatShort(r.departureDate || block.departureDate)}` : 'כל הקבוצה'}</td><td>{r.roomTypeName || '—'}</td><td dir="ltr">{r.guestPhone || ''}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </form>
    </Modal>
  );
}

// What a bulk action did and what it could not do, row by row.
export function ResultDialog({ result, onClose }) {
  if (!result) return null;
  return (
    <Modal open={!!result} onClose={onClose} width={560} title={result.title} footer={<button type="button" className="btn btn-primary" onClick={onClose}>סגירה</button>}>
      <div className="ui-stack">
        {result.done.length > 0 && <Banner tone="ok">בוצע: {result.done.length}</Banner>}
        <ul className="gp-pick">{result.done.map((d, i) => <li key={`d${i}`} className="ui-sub">✓ {d.guest || d.confirmationNumber}{d.confirmationNumber && d.guest ? ` · ${d.confirmationNumber}` : ''}{d.room ? ` · חדר ${d.room}` : ''}{d.share ? ' · Share' : ''}</li>)}</ul>
        {result.failed.length > 0 && <Banner tone="warn">לא בוצע: {result.failed.length}</Banner>}
        <ul className="gp-pick">{result.failed.map((f, i) => <li key={`f${i}`}><b>{f.guest || f.confirmationNumber}</b> — {f.reason}</li>)}</ul>
        {!result.done.length && !result.failed.length && <div className="ui-sub">לא היה מה לעשות.</div>}
      </div>
    </Modal>
  );
}

// Copy the group to other dates; as a series the copies stay linked to the master.
export function CopyDialog({ open, onClose, propertyId, block, onSaved }) {
  const act = useAction();
  const [dates, setDates] = useState([]);
  const [one, setOne] = useState('');
  const [rep, setRep] = useState({ every: 4, count: 3 });
  const [opt, setOpt] = useState({ asSeries: false, withProgram: true, withRoster: false, withBilling: true });
  useEffect(() => { if (open) { act.reset(); setDates([]); setOne(''); setOpt({ asSeries: false, withProgram: true, withRoster: false, withBilling: true }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (d) => d && setDates((p) => [...new Set([...p, d])].sort());
  const repeat = () => { const out = []; for (let i = 1; i <= Number(rep.count || 0); i += 1) out.push(addDays(block.arrivalDate, i * 7 * Number(rep.every || 1))); setDates((p) => [...new Set([...p, ...out])].sort()); setOpt((o) => ({ ...o, asSeries: true })); };
  const why = !dates.length ? 'הוסיפו תאריך הגעה' : dates.length > 12 ? 'עד 12 עותקים' : null;
  const submit = () => act.run(async () => onSaved(await groupBlocks.copy(propertyId, block.id, { arrivalDates: dates, ...opt })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={600} title="שכפול קבוצה" subtitle={`${block.name} · ${block.nights} לילות — העותק נפתח כטנטטיבי`} footer={<Foot onClose={onClose} busy={act.busy} label={`יצירת ${dates.length || ''} עותקים`} why={why} form="gc-form" />}>
      <form id="gc-form" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field id="gc-one" label="תאריך הגעה"><input id="gc-one" type="date" className="input" value={one} onChange={(e) => setOne(e.target.value)} /></Field>
          <button type="button" className="btn btn-secondary" onClick={() => { add(one); setOne(''); }} disabled={!one}>הוספה</button>
          <span className="ui-sub">או סדרה:</span>
          <Field id="gc-every" label="כל (שבועות)"><input id="gc-every" type="number" min="1" className="input" style={{ width: 70 }} value={rep.every} onChange={(e) => setRep((p) => ({ ...p, every: e.target.value }))} /></Field>
          <Field id="gc-count" label="פעמים"><input id="gc-count" type="number" min="1" max="12" className="input" style={{ width: 70 }} value={rep.count} onChange={(e) => setRep((p) => ({ ...p, count: e.target.value }))} /></Field>
          <button type="button" className="btn btn-secondary" onClick={repeat}>הוספת סדרה</button>
        </div>
        {dates.length > 0 && <div className="gm-files">{dates.map((d) => <button key={d} type="button" className="btn btn-ghost btn-sm" onClick={() => setDates((p) => p.filter((x) => x !== d))} title="הסרה">{formatShort(d)} ✕</button>)}</div>}
        <label className="ui-check"><input type="checkbox" checked={opt.asSeries} onChange={(e) => setOpt((o) => ({ ...o, asSeries: e.target.checked }))} /><span>סדרה — העותקים מקושרים לקבוצה הזו</span></label>
        <label className="ui-check"><input type="checkbox" checked={opt.withProgram} onChange={(e) => setOpt((o) => ({ ...o, withProgram: e.target.checked }))} /><span>עם הלו״ז והארוחות</span></label>
        <label className="ui-check"><input type="checkbox" checked={opt.withBilling} onChange={(e) => setOpt((o) => ({ ...o, withBilling: e.target.checked }))} /><span>עם פרופיל החיוב</span></label>
        <label className="ui-check"><input type="checkbox" checked={opt.withRoster} onChange={(e) => setOpt((o) => ({ ...o, withRoster: e.target.checked }))} /><span>עם רשימת השמות (בלי הזמנות)</span></label>
        <div className="ui-sub">החדרים בבלוק (כולל כמות לפי לילה) עוברים לכל עותק, וצריכים להיות פנויים בתאריכים שלו.</div>
      </form>
    </Modal>
  );
}
