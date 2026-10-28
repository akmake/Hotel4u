// G2 — kitchen report: expected diners per meal and day, from each stay's board (pension).
// One selected day in detail (meals by board, groups, guests with allergies / requests) and the
// range (week / two weeks) as a table; every number is split adults / children / infants, and
// stays still on hold are shown apart as "tentative".
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Printer } from 'lucide-react';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useProperty } from '../../context/PropertyContext';
import { ops } from '../../utils/api';
import { addDays, formatLong } from '../../utils/date';
import { Page, Toolbar, Card, Segmented, Tiles, Tag, Banner, Empty, ErrorBanner, Spinner, useLoader, useUrlState } from '../../components/kit';

const DAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MEALS = [{ key: 'breakfast', label: 'ארוחת בוקר' }, { key: 'lunch', label: 'צהריים' }, { key: 'dinner', label: 'ערב' }];
const he = (ymd) => ymd.split('-').reverse().slice(0, 2).join('.');
const weekday = (ymd) => DAY[new Date(`${ymd}T00:00:00Z`).getUTCDay()];

function split(m) {
  const parts = [`${m.adults} מבוגרים`];
  if (m.children) parts.push(`${m.children} ילדים`);
  if (m.infants) parts.push(`${m.infants} תינוקות`);
  return parts.join(' · ');
}

function MealCell({ m }) {
  if (!m.total && !m.tentative) return <span className="ui-sub">—</span>;
  return (
    <div>
      <b className="ui-num">{m.total}</b>
      {m.total > 0 && <div className="ui-sub">{split(m)}</div>}
      {m.tentative > 0 && <div className="ui-sub"><Tag tone="warn">+{m.tentative} באופציה</Tag></div>}
    </div>
  );
}

export default function MealsPage() {
  const { propertyId } = useProperty();
  const url = useUrlState({ from: '', days: '7', day: '' });
  const days = Number(url.get('days')) || 7;
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.meals(propertyId, { from: url.get('from') || undefined, days }) : null), [propertyId, url.get('from'), days]);
  useLiveRefresh(propertyId, ['Reservation'], reload);
  const from = data?.from;
  const today = data?.businessDate;
  const tomorrow = today ? addDays(today, 1) : null;
  const selected = useMemo(() => {
    if (!data) return null;
    return data.days.find((d) => d.date === url.get('day')) || data.days.find((d) => d.date === today) || data.days[0];
  }, [data, url, today]);
  const boardsUsed = useMemo(() => {
    if (!selected) return [];
    return (data.boards || []).filter((b) => b.board !== 'room_only' && MEALS.some((m) => selected[m.key].byBoard[b.board]));
  }, [data, selected]);
  const dietaryToday = useMemo(() => {
    if (!selected) return [];
    // Guests who eat on the selected day: in from the night before or arriving that day.
    return (data.dietary || []).filter((g) => g.arrivalDate <= selected.date && selected.date <= g.departureDate);
  }, [data, selected]);
  const sumRange = (key) => data.days.reduce((s, d) => s + d[key].total, 0);
  const dayName = (d) => (d === today ? 'היום' : d === tomorrow ? 'מחר' : weekday(d));

  return (
    <Page wide title="ארוחות" back="/pms">
      <Toolbar
        start={(
          <>
            <div className="ui-datenav" role="group" aria-label="בחירת טווח">
              <button type="button" className="btn btn-secondary btn-sm btn-icon" disabled={!from} onClick={() => url.set({ from: addDays(from, -days), day: null })} aria-label="טווח קודם"><ChevronRight size={15} /></button>
              <label className="ui-datebox"><span className="sr-only">מתאריך</span><input type="date" value={from || ''} onChange={(e) => url.set({ from: e.target.value || null, day: null })} /></label>
              <button type="button" className="btn btn-secondary btn-sm btn-icon" disabled={!from} onClick={() => url.set({ from: addDays(from, days), day: null })} aria-label="טווח הבא"><ChevronLeft size={15} /></button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!data || from === today} onClick={() => url.set({ from: null, day: null })}>היום</button>
            </div>
            <Segmented label="טווח" value={String(days)} onChange={(v) => url.set({ days: v })} options={[{ value: '7', label: 'שבוע' }, { value: '14', label: 'שבועיים' }]} />
          </>
        )}
        end={(
          <>
            <Link className="btn btn-primary btn-sm" to="/pms/ops-reports?r=kitchen-daily">דוחות מטבח להדפסה</Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()} disabled={!data}><Printer size={14} /> הדפסה</button>
          </>
        )}
      />
      <ErrorBanner error={error} onRetry={reload} />
      {data?.staleArrivals > 0 && (
        <Banner tone="warn">
          {data.staleArrivals} הזמנות עם תאריך הגעה שעבר ולא נקלטו — לא נספרו בדוח. יש לטפל בהן בקבלה (קליטה או אי־הגעה). <Link className="ui-link" to="/pms/arrivals">להגעות</Link>
        </Banner>
      )}
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}

      {selected && (
        <>
          <h2 className="ui-section-title">{dayName(selected.date)} · {formatLong(selected.date)}</h2>
          <Tiles
            label="סיכום היום"
            items={[
              ...MEALS.map((m) => ({ id: m.key, static: true, label: `${m.label}${selected[m.key].tentative ? ` (+${selected[m.key].tentative} באופציה)` : ''}`, value: selected[m.key].total })),
              { id: 'house', static: true, label: `שוהים בלילה · ${selected.inHouse.rooms} חדרים`, value: selected.inHouse.total },
              { id: 'arr', static: true, label: 'מגיעים', value: selected.arrivals.total },
              { id: 'dep', static: true, label: 'עוזבים', value: selected.departures.total },
            ]}
          />
          <div className="ui-grid-2">
            <Card flush title="לפי סוג אירוח">
              {boardsUsed.length === 0 ? <Empty title="אין סועדים ביום זה">אין שוהים עם ארוחות לפי ההזמנות.</Empty> : (
                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead><tr><th scope="col">סוג אירוח</th>{MEALS.map((m) => <th key={m.key} scope="col">{m.label}</th>)}</tr></thead>
                    <tbody>
                      {boardsUsed.map((b) => (
                        <tr key={b.board}>
                          <th scope="row">{b.label}</th>
                          {MEALS.map((m) => <td key={m.key} className="ui-num">{selected[m.key].byBoard[b.board]?.total || '—'}</td>)}
                        </tr>
                      ))}
                      <tr>
                        <th scope="row">סה״כ</th>
                        {MEALS.map((m) => <td key={m.key}><b className="ui-num">{selected[m.key].total}</b><div className="ui-sub">{selected[m.key].total ? split(selected[m.key]) : ''}</div></td>)}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card flush title="קבוצות">
              {selected.groups.length === 0 ? <Empty title="אין קבוצות ביום זה" /> : (
                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead><tr><th scope="col">קבוצה</th>{MEALS.map((m) => <th key={m.key} scope="col">{m.label}</th>)}</tr></thead>
                    <tbody>
                      {selected.groups.map((g) => (
                        <tr key={g.name}>
                          <th scope="row">{g.name}<div className="ui-sub">{g.board}</div></th>
                          {MEALS.map((m) => <td key={m.key} className="ui-num">{g[m.key] || '—'}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card flush title={`אלרגיות, בקשות ו־VIP${dietaryToday.length ? ` · ${dietaryToday.length}` : ''}`}>
            {dietaryToday.length === 0 ? <Empty title="אין הערות מטבח ליום זה">אלרגיות נלקחות מכרטיס האורח, בקשות — מההזמנה.</Empty> : (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead><tr><th scope="col">אורח</th><th scope="col">חדר</th><th scope="col">סוג אירוח</th><th scope="col">סועדים</th><th scope="col">שהייה</th><th scope="col">אלרגיות</th><th scope="col">בקשה</th></tr></thead>
                  <tbody>
                    {dietaryToday.map((g) => (
                      <tr key={g.id}>
                        <th scope="row">
                          <Link className="ui-link" to={`/pms/reservations/${g.id}`}>{g.guest || g.confirmationNumber}</Link>
                          {g.vip && <> <Tag tone="warn">VIP</Tag></>}
                        </th>
                        <td className="ui-nowrap">{g.room || (g.rooms > 1 ? `${g.rooms} חדרים` : 'טרם שובץ')}</td>
                        <td>{g.boardLabel}</td>
                        <td className="ui-num">{g.heads}</td>
                        <td className="ui-nowrap ui-sub">{he(g.arrivalDate)}–{he(g.departureDate)}{g.arrivalDate === selected.date ? ' · מגיע היום' : g.departureDate === selected.date ? ' · עוזב היום' : ''}</td>
                        <td>{g.allergies ? <Tag tone="bad">{g.allergies}</Tag> : <span className="ui-sub">—</span>}</td>
                        <td>{g.request || <span className="ui-sub">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {data && (
        <Card flush title={`צפי ל־${days} ימים`}>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <caption className="sr-only">צפי סועדים לפי יום — לחיצה על יום מציגה את הפירוט שלו</caption>
              <thead><tr><th scope="col">יום</th><th scope="col">שוהים בלילה</th><th scope="col">מגיעים / עוזבים</th>{MEALS.map((m) => <th key={m.key} scope="col">{m.label}</th>)}</tr></thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.date} className={`is-clickable ${selected?.date === d.date ? 'is-selected' : ''}`} onClick={() => url.set({ day: d.date })}>
                    <th scope="row" className="ui-nowrap">
                      <button type="button" className="ui-link" onClick={() => url.set({ day: d.date })} aria-pressed={selected?.date === d.date}>{dayName(d.date)} {he(d.date)}</button>
                    </th>
                    <td><b className="ui-num">{d.inHouse.total}</b><div className="ui-sub">{d.inHouse.rooms} חדרים</div></td>
                    <td className="ui-nowrap ui-num">+{d.arrivals.total} / −{d.departures.total}</td>
                    {MEALS.map((m) => <td key={m.key}><MealCell m={d[m.key]} /></td>)}
                  </tr>
                ))}
                <tr>
                  <th scope="row">סה״כ לטווח</th><td /><td />
                  {MEALS.map((m) => <td key={m.key}><b className="ui-num">{sumRange(m.key)}</b></td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="ui-foot-note ui-sub">
            בוקר — למי שלן בלילה הקודם (כל סוג אירוח מלבד לינה בלבד) · ערב — בכל לילה בחצי פנסיון ובפנסיון מלא · צהריים — בפנסיון מלא, בימים שבין ההגעה לעזיבה.
            {' '}תינוקות — עד גיל {data.infantMaxAge}, לפי גילי הילדים בהזמנה. סוג האירוח נלקח מההזמנה, ואם אין — מתוכנית המחיר.
          </div>
        </Card>
      )}
    </Page>
  );
}
