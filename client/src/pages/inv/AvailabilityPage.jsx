// INV-01 availability as a monthly calendar (docs/product/monthly-availability-board.md) — one calendar card
// (month header, legend, days) with the details panel beside it.
// Every day shows free rooms, an occupancy bar, arrivals and departures; clicking a day — or dragging over
// several (Shift extends) — fills the panel: the numbers, per room type what can be sold for every night,
// day by day, and the actions (book these nights, block a room, arrivals list).
// INV-04 room blocks by dates stay at the bottom. All numbers come from the server (GET /ops/availability?month).
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Card, ErrorBanner, Banner, Spinner, Modal, Field, Segmented, ConfirmDialog, Tag, useLoader, useAction, useUrlState } from '../../components/kit';
import './AvailabilityPage.css';

const BLOCK_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'maintenance_manager', 'revenue_manager'];
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (ym, n) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const localMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthName = (ym) => new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
const dm = (ymd) => `${Number(ymd.slice(8))}.${Number(ymd.slice(5, 7))}`;
const dayMonth = (ymd) => new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
const he = (ymd) => ymd.split('-').reverse().join('.');
const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const lvl = (p) => (p >= 100 ? 'is-max' : p >= 80 ? 'is-hi' : '');
const freeTone = (a) => (a <= 0 ? 'is-full' : a <= 2 ? 'is-low' : '');
const sumOf = (list, k) => list.reduce((s, x) => s + (x[k] || 0), 0);

export default function AvailabilityPage({ layout = 'current' }) {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canBlock = BLOCK_ROLES.includes(role);
  const navigate = useNavigate();
  const { toasts, success } = useToast();
  const url = useUrlState({ month: '' });
  const month = url.get('month') || localMonth();
  const [sel, setSel] = useState(null); // { a, b } day indexes in the month
  const [blockRange, setBlockRange] = useState(null);
  const [release, setRelease] = useState(null);
  const dragging = useRef(false);
  const dragged = useRef(false);
  const downAt = useRef(null); // where the press started: a layout shift under a still pointer must not count as a drag
  const selectTodayOnLoad = useRef(false);

  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.availability(propertyId, { month }) : null), [propertyId, month]);
  useLiveRefresh(propertyId, ['Reservation', 'ReservationRoom', 'Room', 'RoomBlock'], reload);
  // The two-months layout also reads the following month.
  const next = useLoader(async () => (propertyId && layout === 'two-months' ? ops.availability(propertyId, { month: addMonths(month, 1) }) : null), [propertyId, month, layout]);
  useEffect(() => { setSel(null); }, [month, propertyId]);
  useEffect(() => {
    if (!selectTodayOnLoad.current || !data?.dates[0]?.startsWith(month)) return;
    const i = data.dates.indexOf(data.today);
    if (i >= 0) { setSel({ a: i, b: i }); selectTodayOnLoad.current = false; }
  }, [data, month]);
  useEffect(() => {
    const up = () => { dragging.current = false; };
    const esc = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); window.addEventListener('blur', up); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('blur', up); window.removeEventListener('keydown', esc); };
  }, []);

  const today = data?.today || '';
  const pick = (i, extend) => setSel((s) => (extend && s ? { a: s.a, b: i } : { a: i, b: i }));
  const range = sel ? [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)] : null;
  const book = (from, to, typeId) => navigate(`/pms/reservations/new?arrival=${from}&departure=${to}${typeId ? `&roomTypeId=${typeId}` : ''}`);
  const goToday = () => {
    if (today && month !== today.slice(0, 7)) { selectTodayOnLoad.current = true; url.set({ month: today.slice(0, 7) }); return; }
    const i = data?.dates.indexOf(today) ?? -1;
    if (i >= 0) setSel({ a: i, b: i });
  };
  const s = data?.summary;
  // The month's finding: the fullest night still ahead (the earliest one on a tie).
  const peak = data?.dates.reduce((best, d, i) => (d >= today && (best < 0 || data.totals[i].occupancyPct > data.totals[best].occupancyPct) ? i : best), -1) ?? -1;
  const goBack = () => { if ((window.history.state?.idx || 0) > 0) navigate(-1); else navigate('/pms'); };

  return (
    <div className="ac-workspace avl-page" data-layout={layout} dir="rtl">
      <ToastContainer toasts={toasts} />
      <header className="avl-head">
        <button type="button" className="avl-icon" onClick={goBack} aria-label="חזרה" title="חזרה"><ArrowRight size={20} /></button>
        <div className="avl-title"><h1>לוח זמינות</h1></div>
        <div className="avl-nav" role="group" aria-label="ניווט בין חודשים">
          <button type="button" className="avl-icon" onClick={() => url.set({ month: addMonths(month, -1) })} aria-label="חודש קודם"><ChevronRight size={20} /></button>
          <span className="avl-month" aria-live="polite">{monthName(month)}</span>
          <button type="button" className="avl-icon" onClick={() => url.set({ month: addMonths(month, 1) })} aria-label="חודש הבא"><ChevronLeft size={20} /></button>
          <button type="button" className="avl-btn" onClick={goToday}>היום</button>
          {loading && <Spinner />}
        </div>
        {data?.staleArrivals > 0 && (
          <button type="button" className="avl-alert" onClick={() => navigate('/pms/arrivals')} title="הזמנות שתאריך ההגעה שלהן עבר ולא נקלטו">
            <AlertTriangle size={15} aria-hidden="true" />{data.staleArrivals} הזמנות לטיפול
          </button>
        )}
        {s && (
          <dl className="avl-sum" aria-label={`סיכום ${monthName(month)}`}>
            <div><dt>תפוסה בחודש</dt><dd className="ui-num">{s.occupancyPct}%</dd></div>
            <div><dt>לילות חדר נמכרו</dt><dd className="ui-num">{s.definite.toLocaleString('he-IL')}</dd></div>
            <div><dt>הגעות בחודש</dt><dd className="ui-num">{s.arrivals.toLocaleString('he-IL')}</dd></div>
            {peak >= 0 && (
              <div><dt>הלילה העמוס שלפנינו</dt><dd>
                <button type="button" className="avl-peak ui-num" onClick={() => setSel({ a: peak, b: peak })} title="פתיחת פרטי הלילה">
                  {data.totals[peak].occupancyPct}%<small>{DAYS[dow(data.dates[peak])]} {dm(data.dates[peak])}</small>
                </button>
              </dd></div>
            )}
          </dl>
        )}
      </header>
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && !data.rows.length && <Banner tone="info">אין עדיין סוגי חדרים — מגדירים אותם בהגדרות המלון.</Banner>}
      {data && data.rows.length > 0 && (() => {
        const lead = dow(data.dates[0]);
        const tail = (7 - ((lead + data.dates.length) % 7)) % 7;
        const outCell = (key) => <div key={key} className="ac-day is-out" aria-hidden="true" />;
        const dayCell = (d, i) => {
                const t = data.totals[i];
                const past = d < today;
                const inSel = range && i >= range[0] && i <= range[1];
                const closed = t.stopSell && !past;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`ac-day ${dow(d) >= 5 ? 'is-wk' : ''} ${past ? 'is-past' : ''} ${!past && t.occupancyPct >= 100 ? 'is-occ-max' : !past && t.occupancyPct >= 80 ? 'is-occ-hi' : ''} ${d === today ? 'is-today' : ''} ${inSel ? 'is-sel' : ''} ${inSel && i === range[0] ? 'is-range-start' : ''} ${inSel && i === range[1] ? 'is-range-end' : ''} ${closed ? 'is-closed' : ''}`}
                    data-dow={DAYS[dow(d)]}
                    style={{ '--occ': closed ? 100 : Math.min(100, t.occupancyPct) }}
                    aria-pressed={!!inSel}
                    aria-current={d === today ? 'date' : undefined}
                    aria-label={`${DAYS[dow(d)]} ${dm(d)}: ${closed ? 'סגור למכירה' : `${t.available} פנויים`}, תפוסה ${t.occupancyPct}%, ${t.arrivals} מגיעים, ${t.departures} עוזבים`}
                    onPointerDown={(e) => { dragged.current = false; if (e.button !== 0 || e.pointerType === 'touch') return; dragging.current = true; downAt.current = { x: e.clientX, y: e.clientY }; pick(i, e.shiftKey); }}
                    onPointerEnter={(e) => { if (e.pointerType === 'touch' || !dragging.current) return; const m = downAt.current; if (m && Math.hypot(e.clientX - m.x, e.clientY - m.y) < 8) return; dragged.current = true; setSel((x) => (x ? { a: x.a, b: i } : x)); }}
                    onClick={(e) => { if (!dragged.current || e.detail === 0) pick(i, e.shiftKey); dragged.current = false; }}
                  >
                    {closed && <span className="ac-fill" aria-hidden="true" />}
                    {layout === 'original' ? (
                      // The day card as it was at the start of the 2026-11-01 session: date badge, free rooms, occupancy bar, arrivals/departures footer.
                      <>
                        <span className="ac-d-top">
                          <span className="ac-d-num ui-num">{Number(d.slice(8))}</span>
                          {d === today && <span className="ac-today">היום</span>}
                          {!past && t.tentative > 0 && <span className="ac-d-opt" title={`${t.tentative} חדרים באופציה`}>{t.tentative} אופ׳</span>}
                        </span>
                        <span className={`ac-d-free ${past ? '' : closed ? 'is-full' : freeTone(t.available)}`}>
                          <b className="ui-num">{closed ? <X size={24} aria-hidden="true" /> : t.available}</b>
                          <span>{closed ? 'סגור' : !past && t.available <= 0 ? 'מלא' : 'פנויים'}</span>
                        </span>
                        <span className="ac-d-occ ui-num">
                          <span className="ac-bar"><i className={lvl(t.occupancyPct)} style={{ width: `${Math.min(100, t.occupancyPct)}%` }} /></span>{t.occupancyPct}%
                        </span>
                        <span className="ac-d-move ui-num">
                          <span className="ac-chip is-in" title={`${t.arrivals} מגיעים`}><ArrowDown size={12} />{t.arrivals}<em> מגיעים</em></span>
                          <span className="ac-chip is-out" title={`${t.departures} עוזבים`}><ArrowUp size={12} />{t.departures}<em> עוזבים</em></span>
                        </span>
                      </>
                    ) : (<>
                    <span className="ac-d-top">
                      <span className="ac-d-num">{dayMonth(d)}</span>
                      {d === today && <span className="ac-today">היום</span>}
                      {!past && t.tentative > 0 && <span className="ac-d-opt" title={`${t.tentative} חדרים באופציה`}>{t.tentative} באופציה</span>}
                      <span className="ac-d-pct ui-num">{t.occupancyPct}% תפוסה</span>
                    </span>
                    {/* the day as a small sheet: one label/value row per figure, free rooms first and strongest */}
                    <span className="ac-d-rows ui-num">
                      <span className={`ac-row is-free ${past ? '' : closed ? 'is-full' : freeTone(t.available)}`}>
                        <em>{closed ? 'סגור למכירה' : !past && t.available <= 0 ? 'מלא' : 'חדרים פנויים'}</em><b>{closed ? '–' : t.available}</b>
                      </span>
                      <span className="ac-row"><em>מגיעים</em><b>{t.arrivals}</b></span>
                      <span className="ac-row"><em>עוזבים</em><b>{t.departures}</b></span>
                    </span>
                    </>)}
                  </button>
                );
        };
        const cells = [...Array.from({ length: lead }, (_, k) => outCell(`lead${k}`)), ...data.dates.map(dayCell), ...Array.from({ length: tail }, (_, k) => outCell(`tail${k}`))];
        // Weeks layout: a summary card closes every row of seven — the week's free room-nights, arrivals and departures.
        const weekRows = [];
        if (layout === 'weeks') {
          for (let r = 0; r * 7 < cells.length; r += 1) {
            const from = Math.max(0, r * 7 - lead);
            const to = Math.min(data.dates.length, (r + 1) * 7 - lead);
            const T = data.totals.slice(from, to);
            weekRows.push(...cells.slice(r * 7, r * 7 + 7), (
              <div key={`week${r}`} className="ac-week">
                <span className="ac-week-dates">{from === to - 1 ? dayMonth(data.dates[from]) : `${Number(data.dates[from].slice(8))}–${dayMonth(data.dates[to - 1])}`}</span>
                <span className="ac-week-free ui-num"><b>{sumOf(T, 'available')}</b> לילות פנויים</span>
                <span className="ac-week-moves ui-num">{sumOf(T, 'arrivals')} מגיעים · {sumOf(T, 'departures')} עוזבים</span>
              </div>
            ));
          }
        }
        // Two-months layout: the following month beside this one; a click there moves to that month.
        const nextMonth = layout === 'two-months' && next.data?.dates[0]?.startsWith(addMonths(month, 1)) ? next.data : null;
        return (
          <div className={`ac-layout ${range ? 'has-panel' : ''}`}>
            <section className="ac-cal" aria-label={`לוח זמינות ${monthName(month)}`} aria-busy={loading}>
              {(layout === 'curve' || layout === 'original') && (
                <div className="ac-curve" role="group" aria-label="חדרים פנויים לכל לילה בחודש">
                  <div className="ac-curve-head"><b>חדרים פנויים לכל לילה</b><span>בחירה בעמודה בוחרת את היום</span></div>
                  <div className="ac-curve-bars">
                    {data.dates.map((d, i) => {
                      const t = data.totals[i];
                      const inSel = range && i >= range[0] && i <= range[1];
                      return (
                        <button key={d} type="button" className={`ac-cbar ${d < today ? 'is-past' : ''} ${d === today ? 'is-today' : ''} ${inSel ? 'is-sel' : ''} ${dow(d) >= 5 ? 'is-wk' : ''}`} onClick={(e) => pick(i, e.shiftKey)} aria-pressed={!!inSel} aria-label={`${dayMonth(d)}: ${t.available} פנויים`}>
                          <em className="ui-num">{t.available}</em>
                          <i style={{ height: `${t.total ? Math.round((Math.max(0, t.available) / t.total) * 100) : 0}%` }} />
                          <small className="ui-num">{Number(d.slice(8))}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {layout === 'two-months' && <h2 className="ac-cal-title">{monthName(month)}</h2>}
              <div className="ac-dows">{DAYS.map((d, i) => <div key={d} className={i >= 5 ? 'is-wk' : ''}>{d}</div>)}{layout === 'weeks' && <div>השבוע</div>}</div>
              <div className="ac-grid">{layout === 'weeks' ? weekRows : cells}</div>
              <footer className="avl-foot">
                <span>{layout === 'curve' || layout === 'two-months' ? 'בכל יום: חדרים פנויים · שאר הפרטים בלחיצה על היום' : 'בכל יום: חדרים פנויים · תפוסה · הגעות ועזיבות'}</span>
                <span className="avl-keys">לחיצה על יום לפרטים · גרירה לטווח · Esc לניקוי</span>
              </footer>
            </section>
            {nextMonth && (
              <section className="ac-cal is-next" aria-label={`לוח זמינות ${monthName(addMonths(month, 1))}`}>
                <h2 className="ac-cal-title">{monthName(addMonths(month, 1))}</h2>
                <div className="ac-dows">{DAYS.map((d, i) => <div key={d} className={i >= 5 ? 'is-wk' : ''}>{d}</div>)}</div>
                <div className="ac-grid">
                  {Array.from({ length: dow(nextMonth.dates[0]) }, (_, k) => outCell(`nlead${k}`))}
                  {nextMonth.dates.map((d, i) => {
                    const t = nextMonth.totals[i];
                    return (
                      <button key={d} type="button" className={`ac-day ${dow(d) >= 5 ? 'is-wk' : ''}`} onClick={() => url.set({ month: addMonths(month, 1) })} aria-label={`${dayMonth(d)}: ${t.available} פנויים — מעבר לחודש`}>
                        <span className="ac-d-top"><span className="ac-d-num">{dayMonth(d)}</span></span>
                        <span className="ac-d-rows ui-num"><span className={`ac-row is-free ${t.stopSell ? 'is-full' : freeTone(t.available)}`}><em>חדרים פנויים</em><b>{t.stopSell ? '–' : t.available}</b></span></span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {/* The details panel exists only while a day or range is picked; otherwise the calendar has the whole width. */}
            {range && (
              <aside className="ac-panel" aria-live="polite">
                <Details key={`${range[0]}-${range[1]}`} data={data} range={range} today={today} canBlock={canBlock} onBook={book} onBlock={setBlockRange} navigate={navigate} onClear={() => setSel(null)} />
              </aside>
            )}
          </div>
        );
      })()}
      {data && data.blocks.length > 0 && (
        <Card title={`חסימות בחודש (${data.blocks.length})`}>
          {(
            <table className="ui-table">
              <tbody>
                {data.blocks.map((b) => (
                  <tr key={b.id}>
                    <td className="ui-nowrap"><b>חדר {b.room}</b> <span className="ui-sub">{b.roomType}</span></td>
                    <td className="ui-nowrap ui-num">{he(b.from)} – {he(b.to)} <span className="ui-sub">({b.nights} לילות)</span></td>
                    <td><Tag tone="bad">{b.kind === 'out_of_service' ? 'מחוץ לשירות' : 'לא תקין'}</Tag> {b.reason}</td>
                    <td className="ui-sub">{b.createdBy || ''}</td>
                    <td style={{ textAlign: 'left' }}>{canBlock && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRelease(b)}>שחרור</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      <BlockDialog
        open={!!blockRange}
        range={blockRange}
        onClose={() => setBlockRange(null)}
        propertyId={propertyId}
        today={today}
        onSaved={(b) => { setBlockRange(null); success(`חדר ${b.room} נחסם ${he(b.from)}–${he(b.to)}`); reload(); }}
      />
      <ConfirmDialog
        open={!!release}
        onClose={() => setRelease(null)}
        title={release ? `שחרור חסימה — חדר ${release.room}` : ''}
        subtitle={release ? `${he(release.from)} – ${he(release.to)} · ${release.reason}` : ''}
        confirmLabel="שחרור והחזרה למכירה"
        requireReason
        onConfirm={async (reason) => { await ops.releaseBlock(propertyId, release.id, reason); setRelease(null); success('החסימה שוחררה'); reload(); }}
      />
    </div>
  );
}

const Stat = ({ value, label, tone = '' }) => <div className={`ac-stat ${tone}`}><b className="ui-num">{value}</b><span>{label}</span></div>;

// The selected day or range: the numbers, per room type what can be sold for every night, day by day, actions.
function Details({ data, range, today, canBlock, onBook, onBlock, navigate, onClear }) {
  const [a, b] = range;
  const days = data.dates.slice(a, b + 1);
  const T = data.totals.slice(a, b + 1);
  const single = a === b;
  const first = days[0];
  const last = days[days.length - 1];
  const checkout = addDays(last, 1);
  const sellable = T.reduce((s, t) => s + Math.max(0, t.total - t.outOfSale), 0);
  const occ = sellable ? Math.round((Math.min(sumOf(T, 'definite'), sellable) / sellable) * 100) : 0;
  const minFree = Math.min(...T.map((t) => (t.stopSell ? 0 : t.available)));
  const canBook = first >= today && minFree > 0;

  return (
    <div className="ac-details">
      <div className="ac-p-head">
        <div className="ac-p-top"><h2>{single ? `יום ${DAYS[dow(first)]}, ${dm(first)}` : `${dm(first)} – ${dm(last)}`}</h2><button type="button" className="ac-navbtn" onClick={onClear} aria-label="ניקוי בחירת תאריכים"><X size={15} /></button></div>
        <div className="ac-p-sub">{single ? (first < today ? 'יום שעבר — מה היה בפועל' : first === today ? 'היום' : 'לילה אחד') : `${days.length} לילות · יציאה ב־${dm(checkout)}`}</div>
        <div className={`ac-availability ${minFree <= 0 || T.some((t) => t.stopSell) ? 'is-full' : ''}`}><strong className="ui-num">{minFree}</strong><span>{single ? 'חדרים פנויים למכירה' : 'חדרים פנויים לכל הלילות'}</span></div>
        <div className="ac-p-acts">
          <button type="button" className="btn btn-primary btn-sm" disabled={!canBook} onClick={() => onBook(first, checkout)} title={canBook ? undefined : first < today ? 'אי אפשר להזמין לתאריך שעבר' : 'אין חדר פנוי לכל הלילות'}>
            הזמנה חדשה {single ? 'ללילה הזה' : `ל־${days.length} הלילות`}
          </button>
          {canBlock && checkout > today && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onBlock({ from: first < today ? today : first, to: checkout })}>חסימת חדר</button>}
          {single && <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/pms/arrivals?date=${first}`)}>רשימת מגיעים</button>}
        </div>
      </div>

      <div className="ac-p-sec">
        <h3>{single ? 'הלילה במספרים' : 'הטווח במספרים'}</h3>
        <div className="ac-stats">
          {single ? (
            <>
              <Stat value={`${T[0].occupancyPct}%`} label="תפוסה" />
              <Stat value={`${T[0].occupancyWithOptionsPct}%`} label="כולל אופציות" />
              <Stat value={T[0].definite} label="נמכרו" />
              <Stat value={T[0].tentative} label="אופציות" />
              <Stat value={T[0].outOfSale} label="חסומים" />
              <Stat value={T[0].arrivals} label="מגיעים" />
              <Stat value={T[0].departures} label="עוזבים" />
              <Stat value={T[0].stayovers} label="שוהים" />
              <Stat value={T[0].guests} label="אורחים בבית" />
              <Stat value={T[0].total} label="חדרים במלון" />
            </>
          ) : (
            <>
              <Stat value={`${occ}%`} label="תפוסה ממוצעת" />
              <Stat value={sumOf(T, 'definite')} label="לילות חדר נמכרו" />
              <Stat value={sumOf(T, 'tentative')} label="לילות באופציה" />
              <Stat value={sumOf(T, 'arrivals')} label="הגעות" />
              <Stat value={sumOf(T, 'departures')} label="עזיבות" />
              <Stat value={sumOf(T, 'guests')} label="לילות אורח" />
              <Stat value={Math.max(...T.map((t) => t.guests))} label="שיא אורחים בלילה" />
              <Stat value={Math.max(...T.map((t) => t.outOfSale))} label="חסומים (שיא)" />
            </>
          )}
        </div>
      </div>

      <div className="ac-p-sec">
        <h3>{single ? 'לפי סוג חדר' : 'לפי סוג חדר — פנוי לכל הטווח'}</h3>
        <div className="ac-table-scroll"><table className="ac-pt">
          <thead><tr><th>סוג</th><th>פנויים</th><th>נמכרו</th><th>אופציות</th><th>חסומים</th><th /></tr></thead>
          <tbody>
            {data.rows.map((row) => {
              const N = row.nights.slice(a, b + 1);
              const closed = N.some((n) => n.stopSell);
              const f = closed ? 0 : Math.min(...N.map((n) => n.available));
              const opt = sumOf(N, 'tentative');
              const blk = Math.max(...N.map((n) => n.outOfSale));
              return (
                <tr key={row.roomType.id}>
                  <td>{row.roomType.name}<div className="ac-p-note">{row.rooms} חדרים</div></td>
                  <td className={`ui-num is-free ${last < today ? '' : closed ? 'is-full' : freeTone(f)}`}>{closed ? 'סגור' : f}</td>
                  <td className="ui-num">{sumOf(N, 'definite')}</td>
                  <td className="ui-num">{opt || '–'}</td>
                  <td className="ui-num">{blk || '–'}</td>
                  <td><button type="button" className="ac-go" disabled={!(f > 0 && first >= today)} onClick={() => onBook(first, checkout, row.roomType.id)}>הזמנה</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {!single && <div className="ac-p-note">פנויים = המספר הקטן ביותר בטווח, כלומר כמה חדרים מהסוג אפשר למכור לכל הלילות יחד. נמכרו ואופציות = לילות חדר.</div>}
      </div>

      {!single && (
        <div className="ac-p-sec">
          <h3>יום אחרי יום</h3>
          <div className="ac-table-scroll"><table className="ac-pt">
            <thead><tr><th>יום</th><th>פנויים</th><th>תפוסה</th><th>מגיעים</th><th>עוזבים</th><th>אורחים</th></tr></thead>
            <tbody>
              {days.map((d, i) => {
                const t = T[i];
                return (
                  <tr key={d}>
                    <td>{DAYS[dow(d)]} {dm(d)}</td>
                    <td className={`ui-num is-free ${d < today ? '' : freeTone(t.available)}`}>{t.available}</td>
                    <td className="ui-num">{t.occupancyPct}%</td>
                    <td>{t.arrivals ? <button type="button" className="ac-link ui-num" onClick={() => navigate(`/pms/arrivals?date=${d}`)}>{t.arrivals}</button> : <span className="ui-num">0</span>}</td>
                    <td>{t.departures ? <button type="button" className="ac-link ui-num" onClick={() => navigate(`/pms/departures?date=${d}`)}>{t.departures}</button> : <span className="ui-num">0</span>}</td>
                    <td className="ui-num">{t.guests}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

// Blocks a room for dates — opened from the calendar with the selected nights pre-filled.
function BlockDialog({ open, range, onClose, propertyId, today, onSaved }) {
  const action = useAction();
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState({});
  const [oversell, setOversell] = useState(null);
  useEffect(() => {
    if (!open) return;
    action.reset(); setOversell(null);
    const from = range?.from || today || '';
    setForm({ roomId: '', from, to: range?.to || (from ? addDays(from, 1) : ''), kind: 'out_of_order', reason: '' });
    ops.roomsLite(propertyId).then(setRooms).catch(() => setRooms([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => { setOversell(null); setForm((f) => ({ ...f, [k]: e.target.value })); };
  const nights = form.from && form.to && form.to > form.from ? Math.round((Date.parse(form.to) - Date.parse(form.from)) / 86400000) : 0;
  const why = !form.roomId ? 'יש לבחור חדר' : !nights ? 'תאריך החזרה חייב להיות אחרי ההתחלה' : form.reason.trim().length < 3 ? 'נדרשת סיבה' : null;
  const submit = (confirmOversell) => action.run(async () => {
    try {
      const b = await ops.createBlock(propertyId, form.roomId, { from: form.from, to: form.to, kind: form.kind, reason: form.reason.trim(), confirmOversell: confirmOversell || undefined });
      onSaved(b);
    } catch (e) {
      if (e.code === 'oversell') { setOversell(e.message); return; }
      throw e;
    }
  });
  return (
    <Modal
      open={open} onClose={onClose} busy={action.busy} title="חסימת חדר לתאריכים" subtitle="החדר יוצא מהמכירה ומהשיבוץ בלילות האלה"
      footer={(
        <>
          {why && <span className="ui-foot-note">{why}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
          {oversell
            ? <button type="button" className="btn btn-danger" disabled={action.busy} onClick={() => submit(true)}>לחסום בכל זאת</button>
            : <button type="button" className="btn btn-primary" disabled={action.busy || !!why} onClick={() => submit(false)}>{action.busy ? <><Spinner /> שומר…</> : <><Plus size={14} />חסימה{nights ? ` · ${nights} לילות` : ''}</>}</button>}
        </>
      )}
    >
      <div className="ui-stack">
        <ErrorBanner error={action.error} />
        {oversell && <Banner tone="warn">{oversell}. אפשר לחסום בכל זאת — אז צריך למצוא חדר אחר להזמנות האלה.</Banner>}
        <Field id="bl-room" label="חדר" required>
          <select id="bl-room" className="input w-full" value={form.roomId || ''} onChange={set('roomId')}>
            <option value="">בחירת חדר…</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.number} · קומה {r.floor}</option>)}
          </select>
        </Field>
        <div className="ui-grid-2">
          <Field id="bl-from" label="לילה ראשון חסום" required error={action.fields.from}><input id="bl-from" type="date" className="input w-full" min={today} value={form.from || ''} onChange={set('from')} /></Field>
          <Field id="bl-to" label="חוזר למכירה ב־" required error={action.fields.to}><input id="bl-to" type="date" className="input w-full" min={form.from || today} value={form.to || ''} onChange={set('to')} /></Field>
        </div>
        <Segmented label="סוג" value={form.kind} onChange={(v) => setForm((f) => ({ ...f, kind: v }))} options={[{ value: 'out_of_order', label: 'לא תקין (תקלה / שיפוץ)' }, { value: 'out_of_service', label: 'מחוץ לשירות (שימוש פנימי)' }]} />
        <Field id="bl-reason" label="סיבה" required error={action.fields.reason}><input id="bl-reason" className="input w-full" maxLength={300} value={form.reason || ''} onChange={set('reason')} /></Field>
      </div>
    </Modal>
  );
}
