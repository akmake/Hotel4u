// Room chart (tape chart): rooms × nights. A bar is a stay on its room (click → reservation file);
// an empty night opens a new booking for that room; hatched = room out of sale. Rooms are grouped by
// floor or by room type (or not at all). Changes (assign, move) happen in the reservation file,
// under the same rules as everywhere else.
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, CalendarDays, Plus, Crown, ArrowRight } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { ops } from '../../utils/api';
import { Empty, ErrorBanner, Spinner, useLoader, useUrlState } from '../../components/kit';
import { cleanLabel } from '../../lib/labels';
import './RoomChartPage.css';
import DragMoveDialog from '../../components/stay/DragMoveDialog';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';

const DAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const dm = (ymd) => `${Number(ymd.slice(8))}.${Number(ymd.slice(5, 7))}`;
const he = (ymd) => ymd.split('-').reverse().join('.');
const STATUS_CLASS = { in_house: 'is-in', checked_in: 'is-in', partially_checked_in: 'is-in', checked_out: 'is-out', hold: 'is-hold', pending_payment: 'is-hold' };
const STATUS_LABEL = { in_house: 'בבית', checked_in: 'בבית', checked_out: 'עזב', hold: 'שמור', pending_payment: 'ממתין לתשלום', confirmed: 'מאושר', modified: 'מאושר' };

export default function RoomChartPage() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const url = useUrlState({ from: '', days: '14', group: 'floor' });
  const group = url.get('group') || 'floor';
  const days = Number(url.get('days')) || 14;
  const { toasts, success } = useToast();
  const [pending, setPending] = useState(null);
  const [over, setOver] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.roomChart(propertyId, { from: url.get('from') || undefined, days }) : null), [propertyId, url.get('from'), days]);
  useLiveRefresh(propertyId, ['Reservation', 'ReservationRoom', 'Room'], reload);
  const from = data?.from;
  const idx = useMemo(() => new Map((data?.dates || []).map((d, i) => [d, i])), [data]);
  const span = (a, b) => {
    const s = Math.max(0, a < data.dates[0] ? 0 : idx.get(a) ?? 0);
    const last = data.dates.length;
    const e = b > data.dates[last - 1] ? last : (idx.get(b) ?? last);
    return { start: s, len: Math.max(1, e - s), cutStart: a < data.dates[0], cutEnd: b > addDays(data.dates[last - 1], 1) };
  };
  const barsByRoom = useMemo(() => {
    const m = new Map();
    for (const b of data?.bars || []) m.set(b.roomId, [...(m.get(b.roomId) || []), b]);
    return m;
  }, [data]);
  const blocksByRoom = useMemo(() => {
    const m = new Map();
    for (const b of data?.blocks || []) m.set(b.roomId, [...(m.get(b.roomId) || []), b]);
    return m;
  }, [data]);

  const allRooms = useMemo(() => (data?.types || []).flatMap((t) => t.rooms.map((r) => ({ _id: r.id, number: r.number }))), [data]);
  const drop = (room, e) => {
    e.preventDefault(); setOver(null);
    let b; try { b = JSON.parse(e.dataTransfer.getData('application/json')); } catch { return; }
    if (!b || b.roomId === room.id) return;
    const inHouse = ['in_house', 'checked_in'].includes(b.unitStatus || b.status);
    setPending({ res: { status: inHouse ? 'in_house' : b.status, primaryGuest: { firstName: b.guest || '' } }, resId: b.reservationId, sourceRoomId: b.roomId, targetRoomId: room.id });
  };
  const cols = data ? `176px repeat(${data.dates.length}, minmax(44px, 1fr))` : '';
  const book = (room, typeId, date) => navigate(`/pms/reservations/new?arrival=${date}&departure=${addDays(date, 1)}&roomTypeId=${typeId}&roomId=${room.id}`);

  const lastNight = data?.dates?.[data.dates.length - 1];
  const byNumber = (a, b) => String(a.room.number).localeCompare(String(b.room.number), undefined, { numeric: true });
  const groups = useMemo(() => {
    if (!data) return [];
    const all = data.types.flatMap((t) => t.rooms.map((room) => ({ t, room })));
    if (group === 'type') return data.types.filter((t) => t.rooms.length).map((t) => ({ key: t.id, label: t.name, items: t.rooms.map((room) => ({ t, room })) }));
    if (group === 'none') return [{ key: 'all', label: null, items: all }];
    const floors = [...new Set(all.map((x) => x.room.floor ?? 0))].sort((a, b) => a - b);
    return floors.map((f) => ({ key: `f${f}`, label: `קומה ${f}`, items: all.filter((x) => (x.room.floor ?? 0) === f).sort(byNumber) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, group]);

  return (
    <div className={`board-page ${days > 14 ? "is-dense" : ""}`} dir="rtl">
      <ToastContainer toasts={toasts} />
      <DragMoveDialog pending={pending} rooms={allRooms} propertyId={propertyId} onClose={() => setPending(null)} onDone={(msg) => { setPending(null); success(msg); reload(); }} />
      <header className="board-head">
        <button type="button" className="board-icon board-back" onClick={() => navigate('/pms')} aria-label="חזרה ליום בקבלה" title="חזרה ליום בקבלה"><ArrowRight size={20} /></button>
        <div className="board-title">
          <h1>לוח חדרים</h1>
          <span>{data ? `${dm(data.dates[0])} – ${dm(lastNight)}` : ''}</span>
        </div>
        <div className="board-tools">
          <div className="board-nav">
            <button type="button" className="board-icon" onClick={() => url.set({ from: addDays(from, -7) })} aria-label="שבוע קודם"><ChevronRight size={20} /></button>
            <label className="board-date"><span className="sr-only">מתאריך</span><CalendarDays size={16} aria-hidden="true" /><input type="date" value={from || ''} onChange={(e) => e.target.value && url.set({ from: e.target.value })} /></label>
            <button type="button" className="board-icon" onClick={() => url.set({ from: addDays(from, 7) })} aria-label="שבוע הבא"><ChevronLeft size={20} /></button>
            {data && url.get('from') && <button type="button" className="board-btn" onClick={() => url.set({ from: '' })}>היום</button>}
          </div>
          <div className="board-seg" role="group" aria-label="טווח">
            {[{ value: '14', label: 'שבועיים' }, { value: '31', label: 'חודש' }].map((o) => (
              <button key={o.value} type="button" aria-pressed={String(days) === o.value} onClick={() => url.set({ days: o.value })}>{o.label}</button>
            ))}
          </div>
          <label className="board-select">
            <span>חלוקה</span>
            <select value={group} onChange={(e) => url.set({ group: e.target.value })} aria-label="חלוקת החדרים">
              <option value="floor">לפי קומה</option>
              <option value="type">לפי סוג חדר</option>
              <option value="none">בלי חלוקה</option>
            </select>
          </label>
          <button type="button" className="board-btn is-filled" onClick={() => navigate('/pms/reservations/new')}><Plus size={18} aria-hidden="true" />הזמנה חדשה</button>
        </div>
      </header>
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && !data.types.length && <Empty title="אין חדרים">מגדירים חדרים במסך הקמת מלון.</Empty>}
      {data && data.types.length > 0 && (
        <section className="board-card" aria-label="לוח חדרים">
          <div className="chart-wrap" role="grid" aria-label="לוח חדרים">
            <div className="chart-row chart-head" style={{ gridTemplateColumns: cols }}>
              <div className="chart-room">חדר · ניקיון</div>
              {data.dates.map((d) => <div key={d} className={`chart-day ${d === data.today ? 'is-today' : ''} ${dow(d) >= 5 ? 'is-weekend' : ''}`} title={`${DAY[dow(d)]} ${he(d)}`}><small>{d === data.today ? 'היום' : DAY[dow(d)]}</small><b>{dm(d)}</b></div>)}
            </div>
            {groups.map((g) => (
              <Fragment key={g.key}>
                {g.label && <div className="chart-group"><b>{g.label}</b><small>{g.items.length} חדרים</small></div>}
                {g.items.map(({ t, room }) => (
                  <div key={room.id} className={`chart-row ${over === room.id ? 'is-drop' : ''}`} style={{ gridTemplateColumns: cols }}
                    onDragOver={(e) => { e.preventDefault(); if (over !== room.id) setOver(room.id); }} onDragLeave={() => setOver((o) => (o === room.id ? null : o))} onDrop={(e) => drop(room, e)}>
                    <div className="chart-room" style={{ gridColumn: 1, gridRow: 1 }}>
                      <span className="ui-num"><b>{room.number}</b></span>
                      <span className={`chart-clean is-${room.cleanStatus}`}>{cleanLabel(room.cleanStatus)}</span>
                      {room.heldNow && <span className="chart-held" title={room.heldNow.until ? `חסום עד ${he(room.heldNow.until)}` : 'חסום עד שחרור'}>חסום</span>}
                    </div>
                    {data.dates.map((d, i) => <button key={d} type="button" style={{ gridColumn: i + 2 }} className={`chart-cell ${d === data.today ? 'is-today' : ''}`} onClick={() => book(room, t.id, d)} aria-label={`הזמנה חדשה לחדר ${room.number} ב־${he(d)}`} title={d < data.today ? undefined : `הזמנה חדשה · חדר ${room.number} · ${he(d)}`} disabled={d < data.today} />)}
                    {(blocksByRoom.get(room.id) || []).map((b) => {
                      const s = span(b.from, b.to);
                      return <div key={`${b.from}`} className="chart-bar is-block" style={{ gridColumn: `${s.start + 2} / span ${s.len}` }} title={`חסום ${he(b.from)}–${he(b.to)}: ${b.reason}`}>{b.reason}</div>;
                    })}
                    {(barsByRoom.get(room.id) || []).map((b) => {
                      const s = span(b.from, b.to);
                      return (
                        <button key={`${b.reservationId}-${b.from}`} type="button" draggable={(b.unitStatus || b.status) !== 'checked_out'}
                          onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify(b)); e.dataTransfer.effectAllowed = 'move'; }} className={`chart-bar ${STATUS_CLASS[b.unitStatus || b.status] || 'is-booked'} ${s.cutStart ? 'cut-start' : ''} ${s.cutEnd ? 'cut-end' : ''}`}
                          style={{ gridColumn: `${s.start + 2} / span ${s.len}` }} onClick={() => navigate(`/pms/reservations/${b.reservationId}`)}
                          title={`${b.guest || '—'} · ${b.confirmation} · ${he(b.from)}–${he(b.to)} · ${STATUS_LABEL[b.unitStatus || b.status] || b.status}`}>
                          {b.vip && <Crown size={12} aria-label="VIP" />}<span>{b.guest || b.confirmation}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </section>
      )}
      <ul className="board-legend" aria-label="מקרא">
        <li><i className="is-in" />בבית</li>
        <li><i className="is-booked" />מאושר</li>
        <li><i className="is-hold" />שמור / ממתין לתשלום</li>
        <li><i className="is-out" />עזב</li>
      </ul>
    </div>
  );
}
