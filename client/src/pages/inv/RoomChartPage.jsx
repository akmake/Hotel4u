// Room chart (tape chart): rooms × nights. A bar is a stay on its room (click → reservation file);
// an empty night opens a new booking for that room; hatched = room out of sale; the row under each room
// type counts stays sold but not yet assigned a room. Changes (assign, move) happen in the reservation
// file, under the same rules as everywhere else.
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { ops } from '../../utils/api';
import { Page, Toolbar, Card, Segmented, Empty, ErrorBanner, Spinner, useLoader, useUrlState } from '../../components/kit';
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
  const url = useUrlState({ from: '', days: '14' });
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
  const cols = data ? `140px repeat(${data.dates.length}, minmax(44px, 1fr))` : '';
  const book = (room, typeId, date) => navigate(`/pms/reservations/new?arrival=${date}&departure=${addDays(date, 1)}&roomTypeId=${typeId}&roomId=${room.id}`);

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <DragMoveDialog pending={pending} rooms={allRooms} propertyId={propertyId} onClose={() => setPending(null)} onDone={(msg) => { setPending(null); success(msg); reload(); }} />
      <Toolbar
        start={(
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => url.set({ from: addDays(from, -7) })} aria-label="שבוע קודם"><ChevronRight size={15} /></button>
            <label className="ui-datebox"><span className="sr-only">מתאריך</span><input type="date" value={from || ''} onChange={(e) => e.target.value && url.set({ from: e.target.value })} /></label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => url.set({ from: addDays(from, 7) })} aria-label="שבוע הבא"><ChevronLeft size={15} /></button>
            {data && url.get('from') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => url.set({ from: '' })}>היום</button>}
            <Segmented label="טווח" value={String(days)} onChange={(v) => url.set({ days: v })} options={[{ value: '14', label: 'שבועיים' }, { value: '31', label: 'חודש' }]} />
          </>
        )}
        end={<span className="ui-sub">לחיצה על שהייה — תיק ההזמנה · גרירה לחדר אחר — שיבוץ / מעבר חדר · לילה פנוי — הזמנה חדשה</span>}
      />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && !data.types.length && <Empty title="אין חדרים">מגדירים חדרים במסך הקמת מלון.</Empty>}
      {data && data.types.length > 0 && (
        <Card flush>
          <div className="chart-wrap" role="grid" aria-label="לוח חדרים">
            <div className="chart-row chart-head" style={{ gridTemplateColumns: cols }}>
              <div className="chart-room">חדר</div>
              {data.dates.map((d) => <div key={d} className={`chart-day ${d === data.today ? 'is-today' : ''} ${dow(d) >= 5 ? 'is-weekend' : ''}`}><small>{DAY[dow(d)]}</small>{dm(d)}</div>)}
            </div>
            {data.types.map((t) => (
              <div key={t.id} role="rowgroup">
                <div className="chart-row chart-type" style={{ gridTemplateColumns: cols }}>
                  <div className="chart-room"><b>{t.name}</b></div>
                  {data.dates.map((d) => {
                    const n = t.unassigned[d] || 0;
                    return <div key={d} className={`chart-day ${n ? 'has-unassigned' : ''}`} title={n ? `${n} הזמנות בלי חדר משובץ` : undefined}>{n ? n : ''}</div>;
                  })}
                </div>
                {t.rooms.map((room) => (
                  <div key={room.id} className={`chart-row ${over === room.id ? 'is-drop' : ''}`} style={{ gridTemplateColumns: cols }}
                    onDragOver={(e) => { e.preventDefault(); if (over !== room.id) setOver(room.id); }} onDragLeave={() => setOver((o) => (o === room.id ? null : o))} onDrop={(e) => drop(room, e)}>
                    <div className="chart-room" style={{ gridColumn: 1, gridRow: 1 }}>
                      <span className="ui-num"><b>{room.number}</b></span>
                      <span className={`chart-dot is-${room.cleanStatus}`} title={room.cleanStatus} />
                      {room.heldNow && <span className="chart-held" title={room.heldNow.until ? `חסום עד ${he(room.heldNow.until)}` : 'חסום עד שחרור'}>חסום</span>}
                    </div>
                    {data.dates.map((d, i) => <button key={d} type="button" style={{ gridColumn: i + 2 }} className={`chart-cell ${d === data.today ? 'is-today' : ''}`} onClick={() => book(room, t.id, d)} aria-label={`הזמנה לחדר ${room.number} ב־${he(d)}`} disabled={d < data.today} />)}
                    {(blocksByRoom.get(room.id) || []).map((b) => {
                      const s = span(b.from, b.to);
                      return <div key={`${b.from}`} className="chart-bar is-block" style={{ gridColumn: `${s.start + 2} / span ${s.len}` }} title={`חסום ${he(b.from)}–${he(b.to)}: ${b.reason}`}>{b.reason}</div>;
                    })}
                    {(barsByRoom.get(room.id) || []).map((b) => {
                      const s = span(b.from, b.to);
                      return (
                        <button key={`${b.reservationId}-${b.from}`} type="button" draggable={(b.unitStatus || b.status) !== 'checked_out'}
                          onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify(b)); e.dataTransfer.effectAllowed = 'move'; }} className={`chart-bar ${STATUS_CLASS[b.unitStatus || b.status] || ''} ${s.cutStart ? 'cut-start' : ''} ${s.cutEnd ? 'cut-end' : ''}`}
                          style={{ gridColumn: `${s.start + 2} / span ${s.len}` }} onClick={() => navigate(`/pms/reservations/${b.reservationId}`)}
                          title={`${b.guest || '—'} · ${b.confirmation} · ${he(b.from)}–${he(b.to)} · ${STATUS_LABEL[b.unitStatus || b.status] || b.status}`}>
                          {b.vip && '★ '}{b.guest || b.confirmation}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </Page>
  );
}
