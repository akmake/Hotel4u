// INV-01 availability by night and room type, INV-04 room blocks by dates.
// Numbers come from the server: rooms of the type that are in sale that night, minus what is sold.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, ChevronRight, ChevronLeft, Plus } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, Toolbar, Card, Segmented, Empty, ErrorBanner, Banner, Spinner, Modal, Field, ConfirmDialog, Tag, useLoader, useAction, useUrlState } from '../../components/kit';

const BLOCK_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'maintenance_manager', 'revenue_manager'];
const DAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dm = (ymd) => `${Number(ymd.slice(8))}.${Number(ymd.slice(5, 7))}`;
const he = (ymd) => ymd.split('-').reverse().join('.');
const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const tone = (n) => (n.stopSell ? 'is-closed' : n.available <= 0 ? 'is-bad' : n.available <= 2 ? 'is-warn' : '');

export default function AvailabilityPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canBlock = BLOCK_ROLES.includes(role);
  const navigate = useNavigate();
  const { toasts, success } = useToast();
  const url = useUrlState({ from: '', days: '14' });
  const [blockOpen, setBlockOpen] = useState(false);
  const [release, setRelease] = useState(null);
  const days = Number(url.get('days')) || 14;

  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.availability(propertyId, { from: url.get('from') || undefined, days }) : null), [propertyId, url.get('from'), days]);
  const from = data?.from || url.get('from');
  const shift = (n) => url.set({ from: addDays(from || data?.today, n) });
  const book = (typeId, date) => navigate(`/pms/reservations/new?arrival=${date}&departure=${addDays(date, 1)}&roomTypeId=${typeId}`);

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <Toolbar
        start={(
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(-days)} aria-label="תקופה קודמת"><ChevronRight size={15} /></button>
            <label className="ui-datebox"><span className="sr-only">מתאריך</span><input type="date" value={from || ''} onChange={(e) => e.target.value && url.set({ from: e.target.value })} /></label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(days)} aria-label="תקופה הבאה"><ChevronLeft size={15} /></button>
            {data && from !== data.today && <button type="button" className="btn btn-ghost btn-sm" onClick={() => url.set({ from: '' })}>היום</button>}
            <Segmented label="טווח" value={String(days)} onChange={(v) => url.set({ days: v })} options={[{ value: '14', label: 'שבועיים' }, { value: '31', label: 'חודש' }]} />
          </>
        )}
        end={canBlock ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBlockOpen(true)}><Ban size={14} />חסימת חדר</button> : null}
      />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && !data.rows.length && <Empty title="אין סוגי חדרים">מגדירים סוגי חדרים וחדרים בהגדרות.</Empty>}
      {data && data.rows.length > 0 && (
        <Card flush>
          <div className="ui-table-wrap avail-wrap">
            <table className="ui-table avail-grid">
              <thead>
                <tr>
                  <th scope="col">סוג חדר</th>
                  {data.dates.map((d) => <th scope="col" key={d} className={dow(d) === 5 || dow(d) === 6 ? 'is-weekend' : ''}><div className="ui-sub">{DAY[dow(d)]}</div>{dm(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.roomType.id}>
                    <th scope="row"><div>{r.roomType.name}</div><div className="ui-sub">{r.rooms} חדרים</div></th>
                    {r.nights.map((n) => (
                      <td key={n.date} className={`avail-cell ${tone(n)}`} title={`${he(n.date)} · פנויים ${n.available} · נמכרו ${n.sold} · מחוץ למכירה ${n.outOfSale}${n.stopSell ? ' · סגור למכירה' : ''}`}>
                        <button type="button" className="avail-btn" onClick={() => book(r.roomType.id, n.date)} disabled={n.available <= 0 || n.stopSell} aria-label={`הזמנה ${r.roomType.name} ${he(n.date)}`}>
                          <b className="ui-num">{n.stopSell ? '✕' : n.available}</b>
                          {n.outOfSale > 0 && <small className="avail-ooo">{n.outOfSale} חסום</small>}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="avail-total">
                  <th scope="row">סה״כ פנויים</th>
                  {data.totals.map((t) => <td key={t.date} className="ui-num"><b>{t.available}</b><div className="ui-sub">{t.occupancyPct}%</div></td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {data && (
        <Card title={`חסימות בתקופה (${data.blocks.length})`}>
          {!data.blocks.length && <p className="ui-sub">אין חדרים חסומים לתאריכים בתקופה הזו.</p>}
          {data.blocks.length > 0 && (
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
      <BlockDialog open={blockOpen} onClose={() => setBlockOpen(false)} propertyId={propertyId} today={data?.today} onSaved={(b) => { setBlockOpen(false); success(`חדר ${b.room} נחסם ${he(b.from)}–${he(b.to)}`); reload(); }} />
      <ConfirmDialog
        open={!!release}
        onClose={() => setRelease(null)}
        title={release ? `שחרור חסימה — חדר ${release.room}` : ''}
        subtitle={release ? `${he(release.from)} – ${he(release.to)} · ${release.reason}` : ''}
        confirmLabel="שחרור והחזרה למכירה"
        requireReason
        onConfirm={async (reason) => { await ops.releaseBlock(propertyId, release.id, reason); setRelease(null); success('החסימה שוחררה'); reload(); }}
      />
    </Page>
  );
}

function BlockDialog({ open, onClose, propertyId, today, onSaved }) {
  const action = useAction();
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState({});
  const [oversell, setOversell] = useState(null);
  useEffect(() => {
    if (!open) return;
    action.reset(); setOversell(null);
    setForm({ roomId: '', from: today || '', to: today ? addDays(today, 1) : '', kind: 'out_of_order', reason: '' });
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
