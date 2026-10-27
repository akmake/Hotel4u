import { useMemo, useState } from 'react';
import { TODAY, formatShort } from '../utils/date';
import './RoomCalendarViews.css';

/* Alternative structures for the room calendar design page.
   Every view reads the same live data as the tape chart: filtered rooms,
   reservations in range, and the visible days. */

const LIVE = ['confirmed', 'in_house', 'modified', 'pending_payment'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const STATUS_LABEL = {
  confirmed: 'מאושר', in_house: 'שוהה', pending_payment: 'ממתין לתשלום', modified: 'שונה',
  checked_out: 'עזב', cancelled: 'בוטל', no_show: 'לא הגיע',
};
const CLEAN_LABEL = { clean: 'נקי', inspected: 'נבדק', dirty: 'מלוכלך', cleaning: 'בניקיון' };
const BLOCKED = ['out_of_order', 'out_of_service'];

const idOf = v => String(v?._id || v || '');
const covers = (r, date) => r.arrivalDate <= date && r.departureDate > date;
const guestName = r => [r.primaryGuest?.firstName, r.primaryGuest?.lastName].filter(Boolean).join(' ') || 'הזמנה';
const nights = r => Math.round((new Date(r.departureDate + 'T00:00:00') - new Date(r.arrivalDate + 'T00:00:00')) / 86400000);
const ddmm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/* ── 1. Availability by room type: numbers, no bars ─────────────────────── */
function AvailabilityMatrix({ rooms, reservations, days }) {
  const types = useMemo(() => {
    const map = new Map();
    rooms.forEach(r => {
      const key = idOf(r.roomType) || 'none';
      if (!map.has(key)) map.set(key, { id: key, name: r.roomType?.name || 'ללא סוג', code: r.roomType?.code, rooms: [] });
      map.get(key).rooms.push(r);
    });
    return [...map.values()];
  }, [rooms]);

  const cells = useMemo(() => {
    const live = reservations.filter(r => LIVE.includes(r.status));
    return types.map(t => {
      const ids = new Set(t.rooms.map(r => idOf(r._id)));
      const blocked = t.rooms.filter(r => BLOCKED.includes(r.opsStatus)).length;
      return days.map(d => {
        const sold = live.filter(r => covers(r, d.date) && (ids.has(idOf(r.assignedRoom)) || (!idOf(r.assignedRoom) && idOf(r.roomType) === t.id))).length;
        const sellable = t.rooms.length - blocked;
        return { free: Math.max(0, sellable - sold), sellable, sold, arrivals: live.filter(r => r.arrivalDate === d.date && (ids.has(idOf(r.assignedRoom)) || idOf(r.roomType) === t.id)).length };
      });
    });
  }, [types, reservations, days]);

  const totals = days.map((d, i) => {
    const free = cells.reduce((s, row) => s + row[i].free, 0);
    const sellable = cells.reduce((s, row) => s + row[i].sellable, 0);
    return { free, pct: sellable ? Math.round((sellable - free) / sellable * 100) : 0 };
  });

  return (
    <div className="rcv-scroll">
      <table className="rcv-matrix">
        <thead>
          <tr>
            <th className="rcv-matrix-corner">סוג חדר</th>
            {days.map(d => (
              <th key={d.date} className={`${d.isToday ? 'is-today' : ''}${d.isWeekend ? ' is-weekend' : ''}`}>
                <span>{d.weekday}</span><strong>{d.day}</strong>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((t, ti) => (
            <tr key={t.id}>
              <th scope="row">
                <strong>{t.name}</strong>
                <span>{t.rooms.length} חדרים{t.code ? ` · ${t.code}` : ''}</span>
              </th>
              {cells[ti].map((c, i) => {
                const ratio = c.sellable ? c.sold / c.sellable : 1;
                const level = c.free === 0 ? 'full' : ratio >= 0.75 ? 'high' : ratio >= 0.4 ? 'mid' : 'low';
                return (
                  <td key={days[i].date} className={`is-${level}${days[i].isToday ? ' is-today' : ''}`} title={`${t.name} · ${formatShort(days[i].date)}: ${c.free} פנויים מתוך ${c.sellable} · ${c.arrivals} מגיעים`}>
                    <strong>{c.free === 0 ? 'מלא' : c.free}</strong>
                    {c.free > 0 && <span>מתוך {c.sellable}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row"><strong>סה״כ פנויים</strong><span>ותפוסה</span></th>
            {totals.map((t, i) => (
              <td key={days[i].date} className={days[i].isToday ? 'is-today' : ''}>
                <strong>{t.free}</strong><span>{t.pct}%</span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ── 2. Day by day: who arrives, who leaves, how full ──────────────────── */
function DayAgenda({ rooms, reservations, days, onOpen }) {
  const roomIds = new Set(rooms.map(r => idOf(r._id)));
  const live = reservations.filter(r => LIVE.includes(r.status) || r.status === 'checked_out');
  const mine = r => !idOf(r.assignedRoom) || roomIds.has(idOf(r.assignedRoom));
  const chip = r => (
    <button key={r._id} type="button" className="rcv-chip" data-status={r.status} onClick={() => onOpen(r)}>
      <b>{r.assignedRoom?.number || 'ללא חדר'}</b>
      <span>{guestName(r)}</span>
    </button>
  );
  return (
    <div className="rcv-scroll rcv-agenda">
      {days.map(d => {
        const arrivals = live.filter(r => r.arrivalDate === d.date && mine(r));
        const departures = live.filter(r => r.departureDate === d.date && mine(r));
        const staying = live.filter(r => covers(r, d.date) && r.arrivalDate !== d.date && mine(r) && r.status !== 'checked_out');
        const occupied = live.filter(r => covers(r, d.date) && idOf(r.assignedRoom) && roomIds.has(idOf(r.assignedRoom)) && r.status !== 'checked_out').length;
        const pct = rooms.length ? Math.round(occupied / rooms.length * 100) : 0;
        return (
          <section key={d.date} className={`rcv-day${d.isToday ? ' is-today' : ''}${d.isWeekend ? ' is-weekend' : ''}`} aria-label={formatShort(d.date)}>
            <header className="rcv-day-date">
              <strong>{d.day}</strong>
              <span>{d.isToday ? 'היום' : `יום ${d.weekday}`} · {HE_MONTHS[d.month]}</span>
              <div className="rcv-day-occ">
                <i style={{ '--fill': `${pct}%` }} />
                <small>{pct}% תפוסה · {Math.max(0, rooms.length - occupied)} פנויים</small>
              </div>
            </header>
            <div className="rcv-day-col">
              <h3>מגיעים <em>{arrivals.length}</em></h3>
              <div className="rcv-chips">{arrivals.length ? arrivals.map(chip) : <p className="rcv-empty">אין הגעות</p>}</div>
            </div>
            <div className="rcv-day-col">
              <h3>עוזבים <em>{departures.length}</em></h3>
              <div className="rcv-chips">{departures.length ? departures.map(chip) : <p className="rcv-empty">אין עזיבות</p>}</div>
            </div>
            <div className="rcv-day-col is-narrow">
              <h3>נשארים <em>{staying.length}</em></h3>
              <p className="rcv-stay-note">{staying.length ? staying.slice(0, 4).map(r => r.assignedRoom?.number).filter(Boolean).join(' · ') + (staying.length > 4 ? ` ועוד ${staying.length - 4}` : '') : '—'}</p>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ── 3. The house on one date: a tile per room ──────────────────────────── */
function RoomTiles({ rooms, resByRoom, days, onOpen, onNew }) {
  const [date, setDate] = useState(() => (days.some(d => d.date === TODAY) ? TODAY : days[0]?.date));
  const activeDate = days.some(d => d.date === date) ? date : days[0]?.date;
  const floors = [...new Set(rooms.map(r => r.floor))].sort((a, b) => a - b);
  return (
    <div className="rcv-scroll rcv-tiles-wrap">
      <div className="rcv-date-strip" role="tablist" aria-label="בחירת תאריך">
        {days.map(d => (
          <button key={d.date} type="button" role="tab" aria-selected={d.date === activeDate} className={d.isToday ? 'is-today' : ''} onClick={() => setDate(d.date)}>
            <span>{d.weekday}</span><strong>{d.day}</strong>
          </button>
        ))}
      </div>
      {floors.map(f => (
        <section key={f} className="rcv-floor">
          <h3>קומה {f}</h3>
          <div className="rcv-tiles">
            {rooms.filter(r => r.floor === f).map(room => {
              const list = (resByRoom[idOf(room._id)] || []).filter(r => LIVE.includes(r.status));
              const stay = list.find(r => covers(r, activeDate));
              const leaving = list.find(r => r.departureDate === activeDate);
              const arriving = list.find(r => r.arrivalDate === activeDate);
              const blocked = BLOCKED.includes(room.opsStatus);
              const state = blocked ? 'blocked' : arriving ? 'arriving' : stay ? 'occupied' : leaving ? 'leaving' : 'free';
              const shown = arriving || stay || leaving;
              return (
                <button key={room._id} type="button" className="rcv-tile" data-state={state}
                  onClick={() => (shown ? onOpen(shown) : !blocked && onNew(room, activeDate))}>
                  <div className="rcv-tile-top">
                    <strong>{room.number}</strong>
                    <span className="rcv-clean" data-clean={room.cleanStatus}>{CLEAN_LABEL[room.cleanStatus] || '—'}</span>
                  </div>
                  <span className="rcv-tile-type">{room.roomType?.name || '—'}</span>
                  <div className="rcv-tile-state">
                    {state === 'blocked' && <b>חסום</b>}
                    {state === 'free' && <b>פנוי</b>}
                    {state === 'arriving' && <><b>מגיע היום</b><span>{guestName(arriving)}</span></>}
                    {state === 'occupied' && <><b>{guestName(stay)}</b><span>{stay.departureDate === activeDate ? 'יוצא היום' : `עד ${ddmm(stay.departureDate)}`}</span></>}
                    {state === 'leaving' && <><b>יוצא היום</b><span>{guestName(leaving)}</span></>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ── 4. One room in focus: list + its stays ─────────────────────────────── */
function RoomFocus({ rooms, resByRoom, days, onOpen }) {
  const [roomId, setRoomId] = useState(() => idOf(rooms[0]?._id));
  const room = rooms.find(r => idOf(r._id) === roomId) || rooms[0];
  if (!room) return <div className="rcv-scroll"><p className="rcv-empty">אין חדרים להצגה</p></div>;
  const stays = (resByRoom[idOf(room._id)] || []).slice().sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate));
  const liveStays = stays.filter(r => LIVE.includes(r.status));
  const busy = days.filter(d => liveStays.some(r => covers(r, d.date))).length;
  return (
    <div className="rcv-focus">
      <nav className="rcv-focus-list" aria-label="חדרים">
        {rooms.map(r => {
          const now = (resByRoom[idOf(r._id)] || []).find(x => LIVE.includes(x.status) && covers(x, TODAY));
          return (
            <button key={r._id} type="button" aria-current={idOf(r._id) === idOf(room._id) ? 'true' : undefined} onClick={() => setRoomId(idOf(r._id))}>
              <strong>{r.number}</strong>
              <span>{r.roomType?.name || '—'}</span>
              <em data-busy={now ? '1' : undefined}>{BLOCKED.includes(r.opsStatus) ? 'חסום' : now ? 'תפוס' : 'פנוי'}</em>
            </button>
          );
        })}
      </nav>
      <div className="rcv-focus-main">
        <header className="rcv-focus-head">
          <div>
            <h2>חדר {room.number}</h2>
            <p>{room.roomType?.name || '—'} · קומה {room.floor} · {CLEAN_LABEL[room.cleanStatus] || 'מצב ניקיון לא ידוע'}</p>
          </div>
          <div className="rcv-focus-kpi"><strong>{busy}</strong><span>מתוך {days.length} לילות תפוסים בטווח</span></div>
        </header>
        <div className="rcv-nights" aria-label="לילות בטווח">
          {days.map(d => {
            const r = liveStays.find(x => covers(x, d.date));
            return (
              <button key={d.date} type="button" className={`${r ? 'is-busy' : ''}${d.isToday ? ' is-today' : ''}`} disabled={!r} onClick={() => r && onOpen(r)} title={r ? `${guestName(r)} · ${formatShort(d.date)}` : `${formatShort(d.date)} · פנוי`}>
                <span>{d.weekday}</span><strong>{d.day}</strong>
              </button>
            );
          })}
        </div>
        <h3 className="rcv-focus-sub">הזמנות בטווח <em>{stays.length}</em></h3>
        {stays.length === 0 ? <p className="rcv-empty">אין הזמנות לחדר הזה בטווח הנבחר</p> : (
          <table className="rcv-stays">
            <thead><tr><th>אורח</th><th>תאריכים</th><th>לילות</th><th>סטטוס</th><th className="is-num">סכום</th></tr></thead>
            <tbody>
              {stays.map(r => (
                <tr key={r._id} onClick={() => onOpen(r)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(r); }}>
                  <td><strong>{guestName(r)}</strong></td>
                  <td>{ddmm(r.arrivalDate)} – {ddmm(r.departureDate)}</td>
                  <td>{nights(r)}</td>
                  <td><span className="rcv-pill" data-status={r.status}>{STATUS_LABEL[r.status] || r.status}</span></td>
                  <td className="is-num">{r.totalAmount ? `₪${r.totalAmount.toLocaleString('he-IL')}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function RoomCalendarView({ variant, rooms, reservations, resByRoom, days, onOpen, onNew }) {
  if (variant === 'matrix') return <AvailabilityMatrix rooms={rooms} reservations={reservations} days={days} />;
  if (variant === 'agenda') return <DayAgenda rooms={rooms} reservations={reservations} days={days} onOpen={onOpen} />;
  if (variant === 'tiles') return <RoomTiles rooms={rooms} resByRoom={resByRoom} days={days} onOpen={onOpen} onNew={onNew} />;
  if (variant === 'focus') return <RoomFocus rooms={rooms} resByRoom={resByRoom} days={days} onOpen={onOpen} />;
  return null;
}
