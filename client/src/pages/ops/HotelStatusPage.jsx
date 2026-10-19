// Housekeeping — the hotel's situation for the day and the order to work in. Departures (who left,
// who is still in), arrivals (time, VIP, waiting at the desk, room ready or not), stayovers, rooms
// ready / dirty / blocked, arrivals without a room against the clean rooms of their type, and the
// next days' load. The priority is computed on the server; the rules are listed on the screen.
// No guest identity here (OPS-01-F05) — heads, VIP, group and times only.
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops } from '../../utils/api';
import { addDays, formatLong } from '../../utils/date';
import { cleanLabel, opsLabel, TASK_TYPE_LABELS, TASK_STATUS_LABELS } from '../../lib/labels';
import {
  Page, Toolbar, Card, Tiles, DataTable, Tag, Pill, Banner, Empty, ErrorBanner, Spinner,
  useUrlState, useLoader, formatTime, minutesSince, formatWait,
} from '../../components/kit';
import OpsNav from '../../components/ops/OpsNav';

const CLEAN_TONE = { dirty: 'bad', pickup: 'warn', cleaning: 'warn', clean: 'ok', inspected: 'ok', turndown_required: 'warn' };
const RANK_TONE = { 1: 'bad', 2: 'bad', 3: 'warn', 4: 'warn', 5: 'warn' };
const DAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const he = (ymd) => ymd.split('-').reverse().slice(0, 2).join('.');
const num = (a, b) => (a.floor - b.floor) || String(a.number).localeCompare(String(b.number), 'he', { numeric: true });

const VIEWS = {
  work: { filter: (r) => !!r.priority, sort: (a, b) => a.priority.order - b.priority.order },
  departures: { filter: (r) => !!r.departure, sort: (a, b) => Number(!!b.departure.left) - Number(!!a.departure.left) || num(a, b) },
  arrivals: { filter: (r) => !!r.arrival || r.stay?.arrivedToday, sort: (a, b) => String(a.arrival?.eta || '99').localeCompare(String(b.arrival?.eta || '99')) || num(a, b) },
  stayovers: { filter: (r) => !!r.stay && !r.stay.arrivedToday, sort: num },
  ready: { filter: (r) => r.ready, sort: num },
  blocked: { filter: (r) => r.blocking, sort: num },
  all: { filter: () => true, sort: num },
};

function Movement({ r, checkOutTime }) {
  const lines = [];
  if (r.departure) {
    lines.push(r.departure.left
      ? <div key="d"><strong>יצא</strong>{r.departure.checkedOutAt ? ` · ${formatTime(r.departure.checkedOutAt)}` : ''}</div>
      : <div key="d"><strong>עוזב היום</strong> · עד {checkOutTime} · {r.departure.guests} אורחים</div>);
  }
  if (r.arrival) {
    lines.push(
      <div key="a" className="ui-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <strong>מגיע{r.arrival.eta ? ` ${r.arrival.eta}` : ' היום'}</strong>
        <span className="ui-sub">{r.arrival.guests} אורחים</span>
        {r.arrival.vip && <Tag tone="warn">VIP</Tag>}
        {r.arrival.group && <Tag>{r.arrival.group}</Tag>}
        {r.arrival.tentative && <Tag>באופציה</Tag>}
        {r.arrival.waitingSince && <Tag tone="bad">ממתין בקבלה · {formatWait(minutesSince(r.arrival.waitingSince))}</Tag>}
      </div>,
    );
  }
  if (r.stay) {
    lines.push(r.stay.arrivedToday
      ? <div key="s"><strong>הגיע היום</strong>{r.stay.checkedInAt ? ` · ${formatTime(r.stay.checkedInAt)}` : ''}</div>
      : <div key="s">שוהה · עד {he(r.stay.departureDate)} · {r.stay.guests} אורחים{r.stay.vip ? ' · VIP' : ''}</div>);
  }
  if (!lines.length) return <span className="ui-sub">פנוי — אין תנועה</span>;
  return <div className="ui-stack" style={{ gap: 2 }}>{lines}</div>;
}

export default function HotelStatusPage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const url = useUrlState({ view: 'work', floor: '', date: '' });
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.hkOverview(propertyId, { date: url.get('date') || undefined }) : null), [propertyId, url.get('date')]);
  useLiveRefresh(propertyId, ['HousekeepingTask', 'Room', 'Reservation', 'ArrivalQueueEntry'], reload);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60000);
    return () => clearInterval(id);
  }, [reload]);

  const c = data?.counts;
  const view = VIEWS[url.get('view')] ? url.get('view') : 'work';
  const floors = useMemo(() => [...new Set((data?.rooms || []).map((r) => r.floor))].sort((a, b) => a - b), [data]);
  const rows = useMemo(() => {
    if (!data) return undefined;
    const f = url.get('floor');
    return data.rooms.filter((r) => (f === '' || String(r.floor) === f) && VIEWS[view].filter(r)).sort(VIEWS[view].sort);
  }, [data, view, url]);
  const missing = (data?.shortage || []).filter((s) => s.missing > 0);

  const columns = useMemo(() => [
    ...(view === 'work' ? [{ key: 'n', label: 'סדר', width: 44, render: (r) => <b className="ui-num">{r.priority.order}</b> }] : []),
    { key: 'room', label: 'חדר', nowrap: true, render: (r) => <div><div className="ui-room-n">{r.number}</div><div className="ui-sub">{r.roomType?.name || '—'} · קומה {r.floor}</div></div> },
    { key: 'mv', label: 'היום בחדר', render: (r) => <Movement r={r} checkOutTime={data?.checkOutTime} /> },
    {
      key: 'clean', label: 'ניקיון', nowrap: true, render: (r) => (
        <div className="ui-stack" style={{ gap: 2 }}>
          <Pill tone={CLEAN_TONE[r.cleanStatus] || 'muted'}>{cleanLabel(r.cleanStatus)}</Pill>
          {r.ready && <span className="ui-sub">מוכן לאורח</span>}
          {r.blocking && <Tag tone="bad">{r.opsStatus !== 'available' ? opsLabel(r.opsStatus) : 'תקלה חוסמת'}</Tag>}
          {!r.blocking && r.openTickets > 0 && <span className="ui-dot-label is-warn">{r.openTickets} תקלות</span>}
          {(r.dnd || r.serviceDeclined) && <Tag tone="warn">{r.dnd ? 'DND' : 'ויתר על שירות'}</Tag>}
        </div>
      ),
    },
    {
      key: 'prio', label: 'עדיפות', render: (r) => (r.priority ? (
        <div>
          <Tag tone={RANK_TONE[r.priority.rank]}>{r.priority.label}</Tag>
          {r.priority.notes.length > 0 && <div className="ui-sub">{r.priority.notes.join(' · ')}</div>}
        </div>
      ) : <span className="ui-sub">{r.blocking ? 'חסום' : r.stayoverDone ? 'סודר היום' : '—'}</span>),
    },
    {
      key: 'task', label: 'משימה', render: (r) => (r.task ? (
        <div>
          <div>{TASK_TYPE_LABELS[r.task.type] || r.task.type}</div>
          <div className="ui-sub">{TASK_STATUS_LABELS[r.task.status] || r.task.status}{r.task.assignee ? ` · ${r.task.assignee}` : ' · לא שובץ'}{r.task.status === 'in_progress' && r.task.startedAt ? ` · מ־${formatTime(r.task.startedAt)}` : ''}</div>
        </div>
      ) : <span className="ui-sub">{r.priority ? 'אין משימה — ליצור בתכנון' : '—'}</span>),
    },
  ], [view, data]);

  const viewDate = data?.date;
  return (
    <Page wide>
      <OpsNav
        role={user?.role}
        end={(
          <>
            <Link className="btn btn-primary btn-sm" to="/pms/ops-reports?r=hk-sheets">דפי עבודה ודוחות</Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()} disabled={!data}><Printer size={14} /> הדפסה</button>
          </>
        )}
      />
      <Toolbar
        start={(
          <>
            <div className="ui-datenav" role="group" aria-label="בחירת יום">
              <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="יום קודם" disabled={!viewDate} onClick={() => url.set({ date: addDays(viewDate, -1) })}><ChevronRight size={15} /></button>
              <label className="ui-datebox"><span className="sr-only">יום</span><input type="date" value={viewDate || ''} onChange={(e) => url.set({ date: e.target.value || null })} /></label>
              <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="יום הבא" disabled={!viewDate} onClick={() => url.set({ date: addDays(viewDate, 1) })}><ChevronLeft size={15} /></button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!data || data.isToday} onClick={() => url.set({ date: null })}>היום</button>
            </div>
            {viewDate && <span className="ui-date-label">{formatLong(viewDate)}{data && !data.isToday && <Tag tone="warn">{viewDate > data.businessDate ? 'תכנון לפי הזמנות' : 'לא היום העסקי'}</Tag>}</span>}
          </>
        )}
        end={(
          <>
            <label className="sr-only" htmlFor="hs-floor">קומה</label>
            <select id="hs-floor" className="select select-sm" value={url.get('floor')} onChange={(e) => url.set({ floor: e.target.value })}>
              <option value="">כל הקומות</option>
              {floors.map((f) => <option key={f} value={f}>קומה {f}</option>)}
            </select>
          </>
        )}
      />
      <ErrorBanner error={error} onRetry={reload} />
      {c?.arrivals.waiting > 0 && <Banner tone="error">{c.arrivals.waiting} אורחים ממתינים בקבלה לחדר — בראש הרשימה.</Banner>}
      {missing.length > 0 && (
        <Banner tone="warn">
          חסרים חדרים נקיים להגעות: {missing.map((s) => `${s.roomType?.name || 'סוג לא ידוע'} — חסרים ${s.missing}`).join(' · ')}. החדרים הפנויים מסוג זה סומנו בעדיפות.
        </Banner>
      )}
      {c?.staleArrivals > 0 && (
        <Banner tone="info">{c.staleArrivals} הזמנות עם תאריך הגעה שעבר ולא נקלטו — לא נספרו כשוהים. <Link className="ui-link" to="/pms/arrivals">לטיפול בקבלה</Link></Banner>
      )}

      <Tiles
        label="מצב המלון"
        selected={view}
        onSelect={(v) => url.set({ view: v })}
        items={[
          { id: 'work', label: 'לעבודה לפי עדיפות', value: c?.work, tone: c?.work ? 'warn' : undefined },
          { id: 'departures', label: c ? `יציאות · ${c.departures.left} יצאו · ${c.departures.pending} עוד בחדר` : 'יציאות', value: c?.departures.total },
          { id: 'arrivals', label: c ? `הגעות · ${c.arrivals.arrived} הגיעו · ${c.arrivals.roomReady}/${c.arrivals.assigned} חדרים מוכנים` : 'הגעות', value: c?.arrivals.total, tone: c?.arrivals.waiting ? 'bad' : undefined },
          { id: 'stayovers', label: c ? `שוהים · ${c.stayovers.serviced} סודרו${c.stayovers.dnd ? ` · ${c.stayovers.dnd} DND` : ''}` : 'שוהים', value: c?.stayovers.total },
          { id: 'ready', label: c ? `פנויים מוכנים · ${c.vacant.dirty} פנויים מלוכלכים` : 'פנויים מוכנים', value: c?.vacant.ready },
          { id: 'blocked', label: 'חסומים', value: c?.blocked, tone: c?.blocked ? 'bad' : undefined },
        ]}
      />
      {c && (c.departures.noRoom > 0 || c.stayovers.noRoom > 0) && (
        <p className="ui-sub">כולל {[c.departures.noRoom && `${c.departures.noRoom} יציאות`, c.stayovers.noRoom && `${c.stayovers.noRoom} שוהים`].filter(Boolean).join(' ו־')} שעדיין לא שובץ להם חדר — לא מופיעים ברשימת החדרים.</p>
      )}

      <div className="ui-split">
        <Card flush>
          <div className="ui-card-head">
            <span className="ui-sub">{view === 'work' ? 'סדר העבודה מחושב מהמצב בחדרים — מתעדכן אוטומטית.' : `${rows?.length ?? 0} חדרים`}</span>
            <button type="button" className={`btn btn-ghost btn-sm ${view === 'all' ? 'is-on' : ''}`} onClick={() => url.set({ view: 'all' })}>כל החדרים</button>
          </div>
          <DataTable
            caption="מצב המלון לחדרנות"
            columns={columns}
            rows={rows}
            loading={loading && !data}
            filtered={view !== 'all' || !!url.get('floor')}
            rowClass={(r) => (r.priority?.rank <= 2 ? 'is-urgent' : '')}
            empty={<Empty title="אין חדרים פעילים בנכס" />}
            noResults={<Empty title={view === 'work' ? 'אין עבודה פתוחה — כל החדרים מוכנים' : 'אין חדרים בסינון הזה'} />}
          />
        </Card>

        <div className="ui-stack">
          <Card title={`הגעות בלי חדר${data ? ` · ${data.unassignedArrivals.length}` : ''}`}>
            {!data && loading && <div className="ui-empty"><Spinner /> טוען…</div>}
            {data && data.unassignedArrivals.length === 0 && <Empty title="לכל ההגעות שובץ חדר" />}
            {data && data.shortage.length > 0 && (
              <ul className="ui-staff">
                {data.shortage.map((s) => (
                  <li key={s.roomType?.id || 'x'}>
                    <div className="min-w-0">
                      <div className="font-medium">{s.roomType?.name || '—'}</div>
                      <div className="ui-sub">{s.arrivals} הגעות · {s.readyRooms} חדרים מוכנים{s.dirtyCandidates ? ` · ${s.dirtyCandidates} לניקוי` : ''}</div>
                    </div>
                    {s.missing > 0 ? <Tag tone="bad">חסרים {s.missing}</Tag> : <Tag tone="ok">מכוסה</Tag>}
                  </li>
                ))}
              </ul>
            )}
            {data && data.unassignedArrivals.some((a) => a.vip || a.waiting) && (
              <p className="ui-sub">{data.unassignedArrivals.filter((a) => a.waiting).length ? `${data.unassignedArrivals.filter((a) => a.waiting).length} ממתינים בקבלה · ` : ''}{data.unassignedArrivals.filter((a) => a.vip).length} VIP — השיבוץ נעשה בקבלה.</p>
            )}
          </Card>

          <Card flush title="הימים הקרובים">
            {data && (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <caption className="sr-only">יציאות, הגעות ושוהים לפי יום — לתכנון הצוות</caption>
                  <thead><tr><th scope="col">יום</th><th scope="col">יציאות</th><th scope="col">הגעות</th><th scope="col">שוהים</th><th scope="col">אורחים</th></tr></thead>
                  <tbody>
                    {data.forecast.map((d) => (
                      <tr key={d.date} className={`is-clickable ${d.date === data.date ? 'is-selected' : ''}`} onClick={() => url.set({ date: d.date })}>
                        <th scope="row" className="ui-nowrap">{DAY[new Date(`${d.date}T00:00:00Z`).getUTCDay()]} {he(d.date)}</th>
                        <td className="ui-num">{d.departures}</td>
                        <td className="ui-num">{d.arrivals}{d.tentativeArrivals ? <span className="ui-sub"> +{d.tentativeArrivals}</span> : ''}</td>
                        <td className="ui-num">{d.stayovers}</td>
                        <td className="ui-num">{d.guests}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="ui-foot-note ui-sub">יציאה = ניקוי יציאה, שוהה = סידור. +N = הגעות באופציה.</div>
          </Card>

          <Card title="סדר העדיפויות">
            <ol className="ui-sub" style={{ paddingInlineStart: 18, display: 'grid', gap: 2 }}>
              {(data?.rules || []).map((r) => <li key={r.code}>{r.label}</li>)}
            </ol>
            <p className="ui-sub">בתוך כל דרגה: VIP קודם, אחר כך לפי שעת הגעה, ואז קומה ומספר חדר. חדרים חסומים לא נכנסים לסדר.</p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
