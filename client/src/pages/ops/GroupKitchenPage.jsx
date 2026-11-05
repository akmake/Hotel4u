// Kitchen — group meals (gap-map item 6, knowledge 14 §3): every meal of every group in the week, by
// kitchen day (a meal before 06:00 belongs to the day before and shows at its end) or by group, with
// kashrut, menu, diners, hall and the requests for the kitchen. Prints on A3 for the kitchen wall.
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { groupBlocks } from '../../utils/api';
import { formatShort, formatLong } from '../../utils/date';
import { Page, Toolbar, Segmented, Tiles, ErrorBanner, Spinner, Empty, useLoader, useUrlState } from '../../components/kit';

const WEEKDAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const weekday = (d) => WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()];
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
// The week starts on Sunday, as the kitchen plans it.
const weekStart = (ymd) => addDays(ymd, -new Date(`${ymd}T12:00:00Z`).getUTCDay());

function MealRows({ meals, showGroup, showDay }) {
  return meals.map((m) => (
    <tr key={m.id}>
      {showDay && <td className="ui-nowrap">{weekday(m.kitchenDay)} {formatShort(m.kitchenDay)}</td>}
      <td className="ui-num ui-nowrap">{m.start}{m.night ? ' (לילה)' : ''}</td>
      {showGroup && <td>{m.group.name}</td>}
      <td>{m.mealTypeName || m.title}</td>
      <td>{m.kosherLabel || '—'}</td>
      <td>{m.menu || '—'}</td>
      <td className="ui-num"><b>{m.pax}</b></td>
      <td>{m.spaceName || m.location || '—'}</td>
      <td>{m.kitchenNotes || ''}</td>
    </tr>
  ));
}

export default function GroupKitchenPage() {
  const { propertyId } = useProperty();
  const url = useUrlState({ from: '', by: 'day' });
  const from = url.get('from') || weekStart(todayYmd());
  const by = url.get('by') === 'group' ? 'group' : 'day';
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? groupBlocks.kitchen(propertyId, { from, days: 7 }) : null), [propertyId, from]);
  const t = data?.totals;
  return (
    <Page wide title="מטבח — ארוחות קבוצות" back="/pms/meals">
      <Toolbar
        start={(
          <>
            <div className="ui-datenav" role="group" aria-label="בחירת שבוע">
              <button type="button" className="btn btn-secondary btn-sm btn-icon" onClick={() => url.set({ from: addDays(from, -7) })} aria-label="שבוע קודם"><ChevronRight size={15} /></button>
              <label className="ui-datebox"><span className="sr-only">שבוע מתאריך</span><input type="date" value={from} onChange={(e) => url.set({ from: e.target.value ? weekStart(e.target.value) : null })} /></label>
              <button type="button" className="btn btn-secondary btn-sm btn-icon" onClick={() => url.set({ from: addDays(from, 7) })} aria-label="שבוע הבא"><ChevronLeft size={15} /></button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => url.set({ from: null })}>השבוע</button>
            </div>
            <Segmented label="תצוגה" value={by} onChange={(v) => url.set({ by: v })} options={[{ value: 'day', label: 'לפי יום' }, { value: 'group', label: 'לפי קבוצה' }]} />
          </>
        )}
        end={(
          <>
            <Link className="btn btn-secondary btn-sm" to="/pms/meals">ארוחות שוהים</Link>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()} disabled={!t?.meals}><Printer size={14} /> הדפסה A3</button>
          </>
        )}
      />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && (
        <>
          <div className="no-print">
            <Tiles label="סיכום השבוע" items={[
              { id: 'm', static: true, label: 'ארוחות', value: t.meals },
              { id: 'd', static: true, label: 'סועדים', value: t.diners },
              { id: 'g', static: true, label: 'קבוצות', value: t.groups },
              { id: 'k1', static: true, label: 'בשרי', value: t.byKosher.meat || 0 },
              { id: 'k2', static: true, label: 'חלבי', value: t.byKosher.dairy || 0 },
              { id: 'k3', static: true, label: 'פרווה', value: t.byKosher.parve || 0 },
            ]} />
          </div>
          <div className="ops-doc is-a3">
            <div className="ops-doc-head">
              <div><h2>ארוחות קבוצות · {formatShort(data.from)} – {formatShort(data.to)}</h2><div className="ops-doc-sub">{t.meals} ארוחות · {t.diners} סועדים · {t.groups} קבוצות</div></div>
              <div className="ops-doc-meta">יום מטבח מתחיל ב־06:00</div>
            </div>
            {!t.meals && <Empty title="אין ארוחות קבוצות בשבוע הזה">ארוחות נוספות מהלו״ז של כל קבוצה (קבוצות › תוכנית).</Empty>}
            {by === 'day' && data.days.filter((d) => d.meals.length).map((d) => (
              <section key={d.date} className="ops-doc-section">
                <h3>{weekday(d.date)} · {formatLong(d.date)} · {d.diners} סועדים</h3>
                <table className="ops-table">
                  <thead><tr><th>שעה</th><th>קבוצה</th><th>ארוחה</th><th>כשרות</th><th>תפריט</th><th>סועדים</th><th>אולם</th><th>דרישות</th></tr></thead>
                  <tbody><MealRows meals={d.meals} showGroup /></tbody>
                </table>
              </section>
            ))}
            {by === 'group' && data.groups.map((g) => (
              <section key={g.id} className="ops-doc-section">
                <h3>{g.name} <span className="ui-sub">{g.code}</span> · {g.diners} סועדים</h3>
                <table className="ops-table">
                  <thead><tr><th>יום</th><th>שעה</th><th>ארוחה</th><th>כשרות</th><th>תפריט</th><th>סועדים</th><th>אולם</th><th>דרישות</th></tr></thead>
                  <tbody><MealRows meals={g.meals} showDay /></tbody>
                </table>
              </section>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
