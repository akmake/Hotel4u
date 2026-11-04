// Demand system (Optima "Demand system"): every future night — what is on the books, group holds,
// booking pace, the same weekday last year, events, the forecast, and a price recommendation for a
// reference room type / rate. Revenue roles pick nights and apply the advice to the rate calendar.
import { useMemo, useState } from 'react';
import '../ops/EventsPage.css';
import { TrendingUp, TrendingDown, Gauge, CalendarRange } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { demand } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, PageBar, Card, Segmented, GlassTiles, ErrorBanner, Spinner, Banner, ConfirmDialog, useUrlState, useLoader, money } from '../../components/kit';

const RATE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager'];
const DEFAULTS = { days: '60', roomTypeId: '', ratePlanId: '', from: '' };
const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const heat = (p) => (p >= 90 ? 'is-hot' : p >= 75 ? 'is-high' : p >= 50 ? 'is-mid' : p >= 30 ? 'is-low' : 'is-cold');

export default function DemandPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState(DEFAULTS);
  const { toasts, success } = useToast();
  const [sel, setSel] = useState({});
  const [confirm, setConfirm] = useState(false);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? demand.calendar(propertyId, { days: url.get('days'), roomTypeId: url.get('roomTypeId') || undefined, ratePlanId: url.get('ratePlanId') || undefined, from: url.get('from') || undefined }) : null), [propertyId, url.key]);
  const canApply = RATE_ROLES.includes(role);
  const picked = useMemo(() => (data?.rows || []).filter((r) => sel[r.date]), [data, sel]);
  const pickAll = (dir) => setSel(Object.fromEntries((data?.rows || []).filter((r) => (dir > 0 ? r.changePct > 0 : r.changePct < 0)).map((r) => [r.date, r.recommended])));
  const apply = async () => {
    await demand.apply(propertyId, { ratePlanId: data.ratePlan.id, roomTypeId: data.roomType.id, items: picked.map((r) => ({ date: r.date, price: Number(sel[r.date]) })) });
    setConfirm(false); setSel({}); success(`עודכנו מחירים ל־${picked.length} לילות`); reload();
  };
  const s = data?.summary;
  return (
    <Page wide approved>
      <ToastContainer toasts={toasts} />
      <PageBar title="מערכת ביקוש" meta={data ? `${data.rooms} חדרים${data.filteredByType ? ` · ${data.roomType?.name}` : ' · כל המלון'} · מחיר ייחוס: ${data.roomType?.name || '—'} / ${data.ratePlan?.name || '—'}` : undefined} back="/pms"
        tools={data && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="date" className="input" aria-label="מתאריך" value={url.get('from') || data.from} min={data.today} onChange={(e) => url.set({ from: e.target.value })} />
            <select className="select" aria-label="סוג חדר" value={url.get('roomTypeId')} onChange={(e) => { setSel({}); url.set({ roomTypeId: e.target.value }); }}><option value="">כל המלון (מחיר: {data.roomTypes[0]?.name})</option>{data.roomTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <select className="select" aria-label="תעריף ייחוס" value={url.get('ratePlanId') || data.ratePlan?.id || ''} onChange={(e) => { setSel({}); url.set({ ratePlanId: e.target.value }); }}>{data.ratePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </div>
        )} />
      <Segmented label="טווח" value={url.get('days')} onChange={(v) => url.set({ days: v })} options={[{ value: '30', label: '30 יום' }, { value: '60', label: '60 יום' }, { value: '90', label: '90 יום' }]} />
      {loading && !data && <div className="ui-empty"><Spinner /> מחשב ביקוש…</div>}
      <ErrorBanner error={error} onRetry={reload} />
      {data && (
        <>
          <GlassTiles label="סיכום ביקוש" items={[
            { id: 'o', label: 'תפוסה על הספרים', value: `${s.occupancy}%`, icon: Gauge, details: [{ label: 'שנה שעברה', value: `${s.lastYearOcc}%` }] },
            { id: 'f', label: 'צפי תפוסה', value: `${s.forecastOcc}%`, icon: CalendarRange },
            { id: 'p', label: 'הזמנות לילה בשבוע האחרון', value: s.pace, icon: TrendingUp },
            { id: 'u', label: 'המלצה להעלות', value: s.toRaise, icon: TrendingUp, details: [{ label: 'להוריד', value: s.toLower }] },
          ]} />
          {canApply && data.ratePlan && data.roomType && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => pickAll(1)}><TrendingUp size={14} /> סימון כל ההעלאות</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => pickAll(-1)}><TrendingDown size={14} /> סימון כל ההורדות</button>
              {picked.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel({})}>ניקוי</button>}
              <button type="button" className="btn btn-primary btn-sm" disabled={!picked.length} onClick={() => setConfirm(true)}>החלת מחירים ({picked.length})</button>
              <span className="ui-sub">משנה רק את המחיר של {data.roomType.name} בתעריף {data.ratePlan.name}; ההגבלות נשארות.</span>
            </div>
          )}
          {!data.rooms && <Banner tone="warn">אין חדרים פעילים — הגדירו חדרים בהקמת המלון.</Banner>}
          <Card flush>
            <div style={{ overflowX: 'auto' }}>
              <table className="ui-table dm-table">
                <thead>
                  <tr>
                    {canApply && <th aria-label="בחירה" />}
                    <th>לילה</th><th>על הספרים</th><th>קבוצות</th><th>תפוסה</th><th>קצב 7 ימים</th><th>שנה שעברה</th><th>אירועים</th><th>צפי</th><th>מחיר היום</th><th>המלצה</th><th>למה</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.date} className={r.weekday === 5 || r.weekday === 6 ? 'is-weekend' : ''}>
                      {canApply && <td><input type="checkbox" aria-label={`בחירת ${r.date}`} disabled={!r.recommended} checked={!!sel[r.date]} onChange={() => setSel((p) => { const n = { ...p }; if (n[r.date]) delete n[r.date]; else n[r.date] = r.recommended; return n; })} /></td>}
                      <td className="ui-num" style={{ whiteSpace: 'nowrap' }}>{DOW[r.weekday]} {formatShort(r.date)}{r.daysOut <= 1 && <span className="ui-sub"> · {r.daysOut === 0 ? 'הלילה' : 'מחר'}</span>}</td>
                      <td className="ui-num">{r.onBooks} / {r.rooms}</td>
                      <td className="ui-num">{r.groupHold || '—'}</td>
                      <td><span className={`dm-heat ${heat(r.occupancy)}`}>{r.occupancy}%</span></td>
                      <td className="ui-num">{r.pace ? `+${r.pace}` : '—'}</td>
                      <td className="ui-num">{r.lastYearOcc}%</td>
                      <td className="ui-num">{r.events ? `${r.events} · ${r.eventPeople} איש` : '—'}</td>
                      <td><span className={`dm-heat ${heat(r.forecastOcc)}`}>{r.forecastOcc}%</span></td>
                      <td className="ui-num">{r.price != null ? money(r.price, 'ILS', 0) : '—'}</td>
                      <td className="ui-num">
                        {r.recommended == null ? '—' : sel[r.date] !== undefined && canApply
                          ? <input type="number" min="1" className="input" style={{ width: 92 }} aria-label={`מחיר ל־${r.date}`} value={sel[r.date]} onChange={(e) => setSel((p) => ({ ...p, [r.date]: e.target.value }))} />
                          : <b className={r.changePct > 0 ? 'dm-up' : r.changePct < 0 ? 'dm-down' : ''}>{money(r.recommended, 'ILS', 0)}{r.changePct ? ` (${r.changePct > 0 ? '+' : ''}${r.changePct}%)` : ''}</b>}
                      </td>
                      <td className="ui-sub">{r.why.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="ui-sub">צפי = על הספרים + חדרים מוחזקים לקבוצות + קצב ההזמנות היומי של השבועיים האחרונים לאותו לילה, עד הלילה עצמו. השוואה לשנה שעברה: אותו יום בשבוע לפני 52 שבועות.</p>
        </>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="החלת מחירים" subtitle={data ? `${data.roomType?.name} · ${data.ratePlan?.name} · ${picked.length} לילות` : ''} confirmLabel="עדכון יומן התעריפים" onConfirm={apply}>
        <p className="ui-p">המחירים יעודכנו ביומן התעריפים ויישלחו לערוצי ההפצה. אפשר לשנות אותם שוב במסך המחירים.</p>
      </ConfirmDialog>
    </Page>
  );
}
