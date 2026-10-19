// Operational reports to print and hand out (kitchen, housekeeping). Each report is a document:
// hotel + report name + date + printed-at header, tables with totals, the counting rule in the foot.
// Every table is described once (columns + rows + foot) and the same description is printed and
// exported to Excel, so the paper and the file always agree.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Printer, FileSpreadsheet, ChevronRight, ChevronLeft } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { ops } from '../../utils/api';
import { addDays, formatLong } from '../../utils/date';
import { cleanLabel, TASK_TYPE_LABELS, TASK_STATUS_LABELS } from '../../lib/labels';
import { Page, Banner, Empty, ErrorBanner, Spinner, useLoader, useUrlState } from '../../components/kit';

const DAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MEALS = [{ key: 'breakfast', label: 'ארוחת בוקר' }, { key: 'lunch', label: 'צהריים' }, { key: 'dinner', label: 'ערב' }];
const dmy = (ymd) => (ymd ? ymd.split('-').reverse().join('.') : '');
const dm = (ymd) => (ymd ? ymd.split('-').reverse().slice(0, 2).join('.') : '');
const wd = (ymd) => DAY[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const dash = (n) => (n ? n : '—');
const KIND = {
  departure: 'ניקוי יציאה', turn: 'יציאה + הגעה', arrival: 'הכנה להגעה', stayover: 'סידור שוהה', vacant: 'חדר פנוי', arrived: 'הגיע היום',
};

const REPORTS = [
  { id: 'kitchen-daily', group: 'מטבח', title: 'דוח מטבח יומי', desc: 'כמה סועדים בכל ארוחה, לפי גילאים, סוג אירוח וקבוצות, ואלרגיות', params: ['date'] },
  { id: 'kitchen-forecast', group: 'מטבח', title: 'צפי סועדים לשבוע', desc: 'כל יום: שוהים, מגיעים, עוזבים וסועדים בכל ארוחה', params: ['from', 'days'], landscape: true },
  { id: 'dining-list', group: 'מטבח', title: 'רשימת חדר אוכל', desc: 'לפי מספר חדר: מי אוכל, כמה, איזה פנסיון — לסימון בכניסה', params: ['date', 'meal', 'sort'] },
  { id: 'dietary', group: 'מטבח', title: 'אלרגיות ובקשות מיוחדות', desc: 'אורחים עם אלרגיה, בקשה או VIP בטווח', params: ['from', 'days'] },
  { id: 'groups', group: 'מטבח', title: 'קבוצות — ארוחות', desc: 'כל קבוצה, כל יום: כמה בבוקר, בצהריים ובערב', params: ['from', 'days'] },
  { id: 'hk-sheets', group: 'חדרנות', title: 'דף עבודה לחדרנית', desc: 'דף לכל עובדת: החדרים שלה לפי סדר העדיפות, עם מקום לשעה וחתימה', params: ['date', 'floor', 'worker'] },
  { id: 'hk-movement', group: 'חדרנות', title: 'יציאות, הגעות ושוהים לפי חדר', desc: 'כל חדר: מי יוצא, מי מגיע ומתי, מי נשאר, מצב ניקיון', params: ['date', 'floor'] },
  { id: 'hk-staffing', group: 'חדרנות', title: 'צפי עבודה וכוח אדם', desc: 'כמה חדרים לנקות כל יום וכמה חדרניות צריך', params: ['from', 'days', 'minutes'] },
];

// ── Table description → print + Excel ──
function Table({ t }) {
  return (
    <section className="ops-doc-section">
      {t.title && <h3>{t.title}</h3>}
      {t.rows.length === 0 ? <p className="ops-doc-empty">{t.empty || 'אין נתונים'}</p> : (
        <table className="ops-table">
          <thead>
            {t.groups && <tr>{t.groups.map(([label, span], i) => <th key={i} colSpan={span} scope="colgroup">{label}</th>)}</tr>}
            <tr>{t.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>{t.rows.map((r, i) => <tr key={i} className={t.rowClass?.[i] || ''}>{r.map((v, j) => <td key={j}>{v === null || v === undefined || v === '' ? '' : v}</td>)}</tr>)}</tbody>
          {t.foot && <tfoot><tr>{t.foot.map((v, j) => <td key={j}>{v}</td>)}</tr></tfoot>}
        </table>
      )}
    </section>
  );
}

function exportExcel(fileName, doc) {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const used = new Set();
  const addSheet = (name, tables) => {
    const aoa = [[doc.title], [doc.subtitle], []];
    for (const t of tables) {
      if (t.title) aoa.push([t.title]);
      if (t.groups) aoa.push(t.groups.flatMap(([label, span]) => [label, ...Array(span - 1).fill('')]));
      aoa.push(t.columns, ...t.rows);
      if (t.foot) aoa.push(t.foot);
      aoa.push([]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!views'] = [{ RTL: true }];
    let n = String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'דוח';
    while (used.has(n)) n = `${n.slice(0, 28)}_${used.size}`;
    used.add(n);
    XLSX.utils.book_append_sheet(wb, ws, n);
  };
  if (doc.pages) doc.pages.forEach((p) => addSheet(p.name, p.tables));
  else addSheet(doc.title, doc.tables);
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

// ── Builders: data → document ──
function kitchenDaily(data) {
  const d = data.days[0];
  const boards = (data.boards || []).filter((b) => b.board !== 'room_only' && MEALS.some((m) => d[m.key].byBoard[b.board]));
  const diet = (data.dietary || []).filter((g) => g.arrivalDate <= d.date && d.date <= g.departureDate);
  return {
    tables: [
      {
        title: 'סועדים לפי ארוחה',
        columns: ['ארוחה', 'מבוגרים', 'ילדים', 'תינוקות', 'סה״כ', 'באופציה (לא נספרו)'],
        rows: MEALS.map((m) => [m.label, d[m.key].adults, d[m.key].children, d[m.key].infants, d[m.key].total, dash(d[m.key].tentative)]),
        foot: ['סה״כ מנות ביום', MEALS.reduce((s, m) => s + d[m.key].adults, 0), MEALS.reduce((s, m) => s + d[m.key].children, 0), MEALS.reduce((s, m) => s + d[m.key].infants, 0), MEALS.reduce((s, m) => s + d[m.key].total, 0), ''],
      },
      {
        title: 'לפי סוג אירוח',
        columns: ['ארוחה', ...boards.map((b) => b.label)],
        rows: boards.length ? MEALS.map((m) => [m.label, ...boards.map((b) => dash(d[m.key].byBoard[b.board]?.total))]) : [],
        empty: 'אין סועדים ביום זה',
      },
      {
        title: 'תנועת אורחים',
        columns: ['', 'אורחים', 'מבוגרים', 'ילדים', 'תינוקות', 'חדרים'],
        rows: [['ישנים במלון הלילה', d.inHouse], ['מגיעים היום', d.arrivals], ['עוזבים היום', d.departures]].map(([l, h]) => [l, h.total, h.adults, h.children, h.infants, h.rooms]),
      },
      {
        title: 'קבוצות',
        columns: ['קבוצה', 'סוג אירוח', 'בוקר', 'צהריים', 'ערב'],
        rows: d.groups.map((g) => [g.name, g.board, dash(g.breakfast), dash(g.lunch), dash(g.dinner)]),
        empty: 'אין קבוצות ביום זה',
      },
      {
        title: 'אלרגיות, בקשות ו־VIP',
        columns: ['אורח', 'חדר', 'סוג אירוח', 'סועדים', 'שהייה', 'אלרגיות', 'בקשה', 'VIP'],
        rows: diet.map((g) => [g.guest, g.room || (g.rooms > 1 ? `${g.rooms} חדרים` : 'טרם שובץ'), g.boardLabel, g.heads, `${dm(g.arrivalDate)}–${dm(g.departureDate)}`, g.allergies || '', g.request || '', g.vip ? 'VIP' : '']),
        rowClass: diet.map((g) => (g.allergies ? 'is-alert' : '')),
        empty: 'אין הערות מטבח ליום זה',
      },
    ],
  };
}

function kitchenForecast(data) {
  const cols = ['יום', 'תאריך', 'ישנים', 'מגיעים', 'עוזבים'];
  const rows = data.days.map((d) => [wd(d.date), dm(d.date), d.inHouse.total, d.arrivals.total, d.departures.total,
    ...MEALS.flatMap((m) => [d[m.key].total, d[m.key].adults, d[m.key].children, d[m.key].infants, dash(d[m.key].tentative)])]);
  const sum = (m, k) => data.days.reduce((s, d) => s + (d[m][k] || 0), 0);
  return {
    tables: [{
      groups: [['', 5], ...MEALS.map((m) => [m.label, 5])],
      columns: [...cols, ...MEALS.flatMap(() => ['סה״כ', 'מבוגרים', 'ילדים', 'תינוקות', 'אופציה'])],
      rows,
      foot: ['סה״כ', '', '', '', '', ...MEALS.flatMap((m) => [sum(m.key, 'total'), sum(m.key, 'adults'), sum(m.key, 'children'), sum(m.key, 'infants'), dash(sum(m.key, 'tentative'))])],
    }],
  };
}

function diningListDoc(data, meal, sort) {
  let rows = data.rows.filter((r) => r.meals[meal]);
  if (sort === 'group') rows = [...rows].sort((a, b) => String(a.group || 'תתת').localeCompare(String(b.group || 'תתת'), 'he') || String(a.room || '').localeCompare(String(b.room || ''), 'he', { numeric: true }));
  const note = (r) => [r.vip && 'VIP', r.allergies && `אלרגיה: ${r.allergies}`, r.request, r.arrivesToday && 'מגיע היום', r.leavesToday && 'עוזב היום'].filter(Boolean).join(' · ');
  const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
  return {
    tables: [{
      columns: ['חדר', 'אורח', 'מבוגרים', 'ילדים', 'תינוקות', 'סוג אירוח', 'עד', 'קבוצה', 'הערות', 'הגיע'],
      rows: rows.map((r) => [r.room || 'טרם שובץ', r.guest, r.adults, dash(r.children), dash(r.infants), r.boardLabel, dm(r.departureDate), r.group || '', note(r), '☐']),
      rowClass: rows.map((r) => (r.allergies ? 'is-alert' : '')),
      foot: [`${rows.length} חדרים`, '', tot('adults'), tot('children'), tot('infants'), `סה״כ ${tot('total')} סועדים`, '', '', '', ''],
      empty: 'אף אחד לא אוכל בארוחה זו לפי ההזמנות',
    }],
  };
}

function dietaryDoc(data) {
  return {
    tables: [{
      columns: ['אורח', 'חדר', 'מתאריך', 'עד', 'סוג אירוח', 'סועדים', 'אלרגיות', 'בקשה', 'VIP'],
      rows: data.dietary.map((g) => [g.guest, g.room || (g.rooms > 1 ? `${g.rooms} חדרים` : 'טרם שובץ'), dmy(g.arrivalDate), dmy(g.departureDate), g.boardLabel, g.heads, g.allergies || '', g.request || '', g.vip ? 'VIP' : '']),
      rowClass: data.dietary.map((g) => (g.allergies ? 'is-alert' : '')),
      empty: 'אין אורחים עם אלרגיה, בקשה או VIP בטווח',
    }],
  };
}

function groupsDoc(data) {
  const rows = data.days.flatMap((d) => d.groups.map((g) => [`${wd(d.date)} ${dm(d.date)}`, g.name, g.board, dash(g.breakfast), dash(g.lunch), dash(g.dinner)]));
  return { tables: [{ columns: ['יום', 'קבוצה', 'סוג אירוח', 'בוקר', 'צהריים', 'ערב'], rows, empty: 'אין קבוצות בטווח' }] };
}

function workLabel(r) {
  if (r.taskType) return TASK_TYPE_LABELS[r.taskType] || r.taskType;
  return KIND[r.kind] || '';
}
function workNote(r) {
  return [
    r.waiting && 'אורח ממתין בקבלה',
    r.vip && 'VIP',
    r.kind === 'departure' || r.kind === 'turn' ? (r.left ? 'האורח יצא' : 'טרם יצא') : null,
    r.eta && `הגעה ${r.eta}`,
    r.stayUntil && `שוהה עד ${dm(r.stayUntil)}`,
    r.dnd && 'DND',
    r.notes,
  ].filter(Boolean).join(' · ');
}

function hkSheetsDoc(data) {
  return {
    pages: data.sheets.map((s) => ({
      name: s.name,
      heading: `${s.name} — ${s.summary.rooms} חדרים${s.summary.departures ? ` · ${s.summary.departures} יציאות` : ''}${s.summary.stayovers ? ` · ${s.summary.stayovers} שוהים` : ''}${s.summary.arrivals ? ` · ${s.summary.arrivals} הגעות` : ''}`,
      tables: [{
        columns: ['סדר', 'חדר', 'קומה', 'עבודה', 'עדיפות', 'הערות', 'ניקיון בהדפסה', 'התחלה', 'סיום', 'חתימה'],
        rows: s.rows.map((r) => [r.priority?.order ?? '', r.number, r.floor, workLabel(r), r.priority?.label || '', workNote(r), cleanLabel(r.cleanStatus) + (r.taskStatus && !['new', 'assigned'].includes(r.taskStatus) ? ` · ${TASK_STATUS_LABELS[r.taskStatus] || r.taskStatus}` : ''), '', '', '']),
        rowClass: s.rows.map((r) => (r.priority?.rank <= 2 ? 'is-alert' : '')),
      }],
    })),
  };
}

function hkMovementDoc(data, floor) {
  const rooms = data.rooms.filter((r) => floor === '' || String(r.floor) === floor);
  const c = data.counts;
  return {
    tables: [
      {
        title: 'סיכום היום',
        columns: ['', 'סה״כ', 'פירוט'],
        rows: [
          ['יציאות', c.departures.total, `${c.departures.left} יצאו · ${c.departures.pending} עוד בחדר${c.departures.noRoom ? ` · ${c.departures.noRoom} בלי חדר משובץ` : ''}`],
          ['הגעות', c.arrivals.total, `${c.arrivals.arrived} הגיעו · ${c.arrivals.assigned} שובצו (${c.arrivals.roomReady} מוכנים) · ${c.arrivals.unassigned} בלי חדר${c.arrivals.vip ? ` · ${c.arrivals.vip} VIP` : ''}`],
          ['שוהים', c.stayovers.total, `${c.stayovers.serviced} סודרו${c.stayovers.dnd ? ` · ${c.stayovers.dnd} DND / ויתרו` : ''}`],
          ['יציאה + הגעה באותו חדר', c.turns, ''],
          ['פנויים', c.vacant.ready + c.vacant.dirty, `${c.vacant.ready} מוכנים · ${c.vacant.dirty} מלוכלכים`],
          ['חסומים', c.blocked, ''],
          ['אורחים במלון עכשיו', c.guestsInHouse, ''],
        ],
      },
      {
        title: 'לפי חדר',
        columns: ['חדר', 'קומה', 'סוג חדר', 'היום', 'יוצאים', 'מגיעים', 'שוהה עד', 'ניקיון', 'עדיפות'],
        rows: rooms.map((r) => [
          r.number, r.floor, r.roomType?.name || '', KIND[r.movement] || '',
          r.departure ? `${r.departure.guests} אורחים · ${r.departure.left ? 'יצא' : `עד ${data.checkOutTime}`}` : '',
          r.arrival ? `${r.arrival.eta || 'היום'} · ${r.arrival.guests} אורחים${r.arrival.vip ? ' · VIP' : ''}${r.arrival.waitingSince ? ' · ממתין' : ''}` : '',
          r.stay ? dm(r.stay.departureDate) : '',
          `${cleanLabel(r.cleanStatus)}${r.blocking ? ' · חסום' : ''}`,
          r.priority ? `${r.priority.order}. ${r.priority.label}` : '',
        ]),
        rowClass: rooms.map((r) => (r.priority?.rank <= 2 ? 'is-alert' : '')),
      },
      ...(data.unassignedArrivals.length ? [{
        title: 'הגעות שעדיין אין להן חדר',
        columns: ['סוג חדר', 'הגעות', 'חדרים מוכנים', 'חסרים'],
        rows: data.shortage.map((s) => [s.roomType?.name || '', s.arrivals, s.readyRooms, dash(s.missing)]),
      }] : []),
    ],
  };
}

function hkStaffingDoc(data, m) {
  const shiftMin = Math.max(60, Math.round(m.shift * 60));
  const rows = data.forecast.map((d) => {
    const minutes = d.departures * m.checkout + d.stayovers * m.stayover + d.arrivals * m.arrival;
    return [wd(d.date), dm(d.date), d.departures, d.stayovers, d.arrivals, dash(d.tentativeArrivals), minutes, (minutes / 60).toFixed(1), Math.ceil(minutes / shiftMin)];
  });
  const sum = (i) => rows.reduce((s, r) => s + Number(r[i] || 0), 0);
  return {
    tables: [{
      columns: ['יום', 'תאריך', 'ניקויי יציאה', 'סידורי שוהים', 'הגעות', 'הגעות באופציה', 'דקות עבודה', 'שעות', 'חדרניות נדרשות'],
      rows,
      foot: ['סה״כ', '', sum(2), sum(3), sum(4), '', sum(6), (sum(6) / 60).toFixed(1), ''],
    }],
    note: `חישוב: ניקוי יציאה ${m.checkout} דק׳ · סידור שוהה ${m.stayover} דק׳ · הכנה להגעה ${m.arrival} דק׳ · משמרת ${m.shift} שעות עבודה בפועל. ניקוי יציאה נספר ביום העזיבה; הגעה לחדר שהתפנה באותו יום כבר כלולה בניקוי היציאה, ולכן זמן ההכנה להגעה מיועד לבדיקה וסידור אחרון. הגעות באופציה לא נספרו.`,
  };
}

// ── Page ──
const DEFAULTS = { r: 'kitchen-daily', date: '', from: '', days: '7', meal: 'breakfast', sort: 'room', floor: '', worker: '', mco: '30', mst: '15', mar: '10', shift: '7.5' };

export default function OpsReportsPage() {
  const { propertyId, property } = useProperty();
  const url = useUrlState(DEFAULTS);
  const report = REPORTS.find((x) => x.id === url.get('r')) || REPORTS[0];
  const has = (p) => report.params.includes(p);
  const date = url.get('date');
  const from = url.get('from');
  const days = Number(url.get('days')) || 7;

  const { data, loading, error, reload } = useLoader(async () => {
    if (!propertyId) return null;
    switch (report.id) {
      case 'kitchen-daily': return ops.meals(propertyId, { from: date || undefined, days: 1 });
      case 'kitchen-forecast': case 'dietary': case 'groups': return ops.meals(propertyId, { from: from || undefined, days });
      case 'dining-list': return ops.diningList(propertyId, { date: date || undefined });
      case 'hk-sheets': return ops.hkSheets(propertyId, { date: date || undefined, floor: url.get('floor') || undefined });
      case 'hk-movement': return ops.hkOverview(propertyId, { date: date || undefined, days: 1 });
      case 'hk-staffing': return ops.hkOverview(propertyId, { date: from || undefined, days: Math.min(days, 14) });
      default: return null;
    }
  }, [propertyId, report.id, date, from, days, url.get('floor')]);

  const minutes = { checkout: Number(url.get('mco')) || 30, stayover: Number(url.get('mst')) || 15, arrival: Number(url.get('mar')) || 0, shift: Number(url.get('shift')) || 7.5 };
  const doc = useMemo(() => {
    if (!data) return null;
    const dayOf = data.date || data.from;
    const rangeEnd = data.days ? data.days[data.days.length - 1]?.date : data.forecast ? data.forecast[data.forecast.length - 1]?.date : null;
    const isRange = has('from');
    const subtitle = isRange ? `${dmy(dayOf)} – ${dmy(rangeEnd)}` : `יום ${wd(dayOf)}, ${formatLong(dayOf)}`;
    const meal = MEALS.find((m) => m.key === url.get('meal')) || MEALS[0];
    let body;
    switch (report.id) {
      case 'kitchen-daily': body = kitchenDaily(data); break;
      case 'kitchen-forecast': body = kitchenForecast(data); break;
      case 'dining-list': body = diningListDoc(data, meal.key, url.get('sort')); break;
      case 'dietary': body = dietaryDoc(data); break;
      case 'groups': body = groupsDoc(data); break;
      case 'hk-sheets': {
        body = hkSheetsDoc(data);
        const w = url.get('worker');
        if (w) body.pages = body.pages.filter((p, i) => data.sheets[i].id === w);
        break;
      }
      case 'hk-movement': body = hkMovementDoc(data, url.get('floor')); break;
      case 'hk-staffing': body = hkStaffingDoc(data, minutes); break;
      default: body = { tables: [] };
    }
    const title = report.id === 'dining-list' ? `${report.title} — ${meal.label}` : report.title;
    const floorNote = has('floor') && url.get('floor') ? ` · קומה ${url.get('floor')}` : '';
    return { ...body, title, subtitle: subtitle + floorNote, stale: data.staleArrivals ?? data.counts?.staleArrivals ?? 0 };
  }, [data, report, url]); // eslint-disable-line react-hooks/exhaustive-deps

  const printedAt = new Date().toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  const baseDay = data?.date || data?.from || '';
  const shift = (n) => (has('from') ? url.set({ from: addDays(baseDay, n) }) : url.set({ date: addDays(baseDay, n) }));
  const groups = [...new Set(REPORTS.map((x) => x.group))];
  const floors = useMemo(() => [...new Set((data?.rooms || data?.sheets?.flatMap((s) => s.rows) || []).map((r) => r.floor))].filter((f) => f !== undefined && f !== null).sort((a, b) => a - b), [data]);

  return (
    <Page wide>
      {report.landscape && <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } }'}</style>}
      {!report.landscape && <style>{'@media print { @page { size: A4 portrait; margin: 10mm; } }'}</style>}
      <div className="ops-reports">
        <nav className="ops-reports-list no-print" aria-label="דוחות">
          {groups.map((g) => (
            <div key={g}>
              <div className="ui-section-title">{g}</div>
              {REPORTS.filter((x) => x.group === g).map((x) => (
                <button key={x.id} type="button" className={`ops-reports-item ${x.id === report.id ? 'is-on' : ''}`} aria-current={x.id === report.id ? 'page' : undefined} onClick={() => url.set({ r: x.id })}>
                  <strong>{x.title}</strong>
                  <span>{x.desc}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="ops-reports-main">
          <div className="ops-reports-params no-print" role="group" aria-label="פרמטרים לדוח">
            <div className="ui-datenav">
              <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="קודם" disabled={!baseDay} onClick={() => shift(has('from') ? -days : -1)}><ChevronRight size={15} /></button>
              <label className="ui-datebox"><span className="sr-only">{has('from') ? 'מתאריך' : 'תאריך'}</span>
                <input type="date" value={baseDay} onChange={(e) => url.set(has('from') ? { from: e.target.value || null } : { date: e.target.value || null })} />
              </label>
              <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="הבא" disabled={!baseDay} onClick={() => shift(has('from') ? days : 1)}><ChevronLeft size={15} /></button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => url.set({ date: null, from: null })}>היום</button>
              {has('date') && data?.businessDate && <button type="button" className="btn btn-secondary btn-sm" onClick={() => url.set({ date: addDays(data.businessDate, 1) })}>מחר</button>}
            </div>
            {has('days') && (
              <select className="select select-sm" aria-label="טווח" value={String(days)} onChange={(e) => url.set({ days: e.target.value })}>
                <option value="7">שבוע</option><option value="14">שבועיים</option>{report.id !== 'hk-staffing' && <option value="31">חודש</option>}
              </select>
            )}
            {has('meal') && (
              <select className="select select-sm" aria-label="ארוחה" value={url.get('meal')} onChange={(e) => url.set({ meal: e.target.value })}>
                {MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            )}
            {has('sort') && (
              <select className="select select-sm" aria-label="מיון" value={url.get('sort')} onChange={(e) => url.set({ sort: e.target.value })}>
                <option value="room">לפי מספר חדר</option><option value="group">לפי קבוצה</option>
              </select>
            )}
            {has('floor') && (
              <select className="select select-sm" aria-label="קומה" value={url.get('floor')} onChange={(e) => url.set({ floor: e.target.value })}>
                <option value="">כל הקומות</option>{floors.map((f) => <option key={f} value={f}>קומה {f}</option>)}
              </select>
            )}
            {has('worker') && data?.sheets && (
              <select className="select select-sm" aria-label="עובד" value={url.get('worker')} onChange={(e) => url.set({ worker: e.target.value })}>
                <option value="">כל הדפים ({data.sheets.length})</option>
                {data.sheets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.summary.rooms}</option>)}
              </select>
            )}
            {has('minutes') && (
              <>
                <label className="ops-num">יציאה <input type="number" min="5" max="120" value={url.get('mco')} onChange={(e) => url.set({ mco: e.target.value })} /> דק׳</label>
                <label className="ops-num">שוהה <input type="number" min="0" max="120" value={url.get('mst')} onChange={(e) => url.set({ mst: e.target.value })} /> דק׳</label>
                <label className="ops-num">הגעה <input type="number" min="0" max="120" value={url.get('mar')} onChange={(e) => url.set({ mar: e.target.value })} /> דק׳</label>
                <label className="ops-num">משמרת <input type="number" min="1" max="12" step="0.5" value={url.get('shift')} onChange={(e) => url.set({ shift: e.target.value })} /> ש׳</label>
              </>
            )}
            <span className="ops-reports-actions">
              <button type="button" className="btn btn-secondary btn-sm" disabled={!doc} onClick={() => exportExcel(`${doc.title} ${baseDay}`, doc)}><FileSpreadsheet size={14} /> Excel</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!doc} onClick={() => window.print()}><Printer size={14} /> הדפסה</button>
            </span>
          </div>

          <ErrorBanner error={error} onRetry={reload} />
          {doc?.stale > 0 && (
            <div className="no-print"><Banner tone="warn">{doc.stale} הזמנות עם תאריך הגעה שעבר ולא נקלטו — לא נכללו בדוח. <Link className="ui-link" to="/pms/arrivals">לטיפול בקבלה</Link></Banner></div>
          )}
          {loading && !doc && <div className="ui-empty"><Spinner /> מכין את הדוח…</div>}

          {doc && (
            <article className="ops-doc" aria-label={doc.title}>
              {(doc.pages || [{ tables: doc.tables }]).map((p, i, all) => (
                <div key={i} className={i < all.length - 1 ? 'ops-break' : ''}>
                  <header className="ops-doc-head">
                    <div>
                      <div className="ops-doc-hotel">{property?.name || ''}</div>
                      <h2>{doc.title}</h2>
                      <div className="ops-doc-sub">{doc.subtitle}</div>
                    </div>
                    <div className="ops-doc-meta">הודפס {printedAt}{all.length > 1 ? ` · דף ${i + 1} מתוך ${all.length}` : ''}</div>
                  </header>
                  {p.heading && <h3 className="ops-doc-heading">{p.heading}</h3>}
                  {p.tables.map((t, j) => <Table key={j} t={t} />)}
                </div>
              ))}
              {doc.pages && doc.pages.length === 0 && <Empty title="אין משימות לחדרנות ביום זה">יוצרים משימות ליום במסך התכנון.</Empty>}
              {doc.note && <p className="ops-doc-note">{doc.note}</p>}
              {report.group === 'מטבח' && (
                <p className="ops-doc-note">
                  כלל הספירה: ארוחת בוקר — למי שלן בלילה הקודם (כל סוג אירוח מלבד לינה בלבד) · ערב — בכל לילה בחצי פנסיון ובפנסיון מלא · צהריים — בפנסיון מלא, בימים שבין ההגעה לעזיבה.
                  {' '}תינוקות — עד גיל {data?.infantMaxAge ?? 2}, לפי גילי הילדים בהזמנה. הזמנות באופציה (בהמתנה / לפני תשלום) לא נספרו בסה״כ.
                </p>
              )}
            </article>
          )}
        </div>
      </div>
    </Page>
  );
}
