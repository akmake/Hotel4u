// FD-02 — Arrivals. One row per stay unit (a 3-room booking is 3 rows), readiness computed by the
// server with its reasons, and every action from the screen contract: open stay, start check-in,
// assign room, add to the waiting queue, walk-in, no-show. Filter/sort/page state lives in the URL
// so refresh and back keep the context; `?checkin=<reservationId>` opens the wizard directly.
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronLeft, ChevronRight, MoreHorizontal, Search, X, Crown, Moon, User, Baby, RefreshCw, ArrowUpDown } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useAuthStore } from '../stores/authStore';
import { frontdesk, properties as propApi } from '../utils/api';
import { addDays, formatLong, formatShort } from '../utils/date';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import { Modal, Field, Spinner, ErrorBanner, ReadinessBadge, ReasonList, guestInitials } from '../components/kit';
import CheckInWizard from '../components/frontdesk/CheckInWizard';
import AssignRoomDialog from '../components/frontdesk/AssignRoomDialog';
import QueueDialog from '../components/frontdesk/QueueDialog';
import WalkInDialog from '../components/frontdesk/WalkInDialog';

const MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];

const TILES = [
  { id: 'all', label: 'כל ההגעות' },
  { id: 'ready', label: 'מוכנים לכניסה' },
  { id: 'waiting', label: 'ממתינים לחדר' },
  { id: 'blocked', label: 'חסומים' },
];

const DEFAULTS = { readiness: 'all', assignment: 'all', sort: 'eta', dir: 'asc', page: '1', size: '50' };

export default function ArrivalsPage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const isManager = MANAGER_ROLES.includes(user?.role);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toasts, success, error: toastError } = useToast();

  const p = (k) => params.get(k) ?? DEFAULTS[k] ?? '';
  const date = params.get('date') || '';
  const includeCheckedIn = params.get('all') === '1';

  const [draftQ, setDraftQ] = useState(params.get('q') || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [roomTypes, setRoomTypes] = useState([]);

  // Dialog state
  const [assignRow, setAssignRow] = useState(null);
  const [queueRow, setQueueRow] = useState(null);
  const [etaRow, setEtaRow] = useState(null);
  const [noShowRow, setNoShowRow] = useState(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  // When a dialog is opened from inside the wizard, refresh the wizard afterwards.
  const [wizardReload, setWizardReload] = useState(null);

  const checkinId = params.get('checkin');

  const update = useCallback((patch, { resetPage = true } = {}) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '' || v === DEFAULTS[k]) next.delete(k);
        else next.set(k, String(v));
      });
      if (resetPage && !('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true); setError(null);
    try {
      const d = await frontdesk.arrivals(propertyId, {
        date: date || undefined,
        q: params.get('q') || undefined,
        roomTypeId: params.get('roomType') || undefined,
        assignment: p('assignment') !== 'all' ? p('assignment') : undefined,
        readiness: p('readiness') !== 'all' ? p('readiness') : undefined,
        includeCheckedIn: includeCheckedIn ? '1' : undefined,
        sort: p('sort'),
        dir: p('dir'),
        page: p('page'),
        pageSize: p('size'),
      });
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, params.toString()]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(propertyId, ['Reservation', 'ReservationRoom', 'Folio', 'ArrivalQueueEntry', 'Room'], load);
  const committedQ = params.get('q') || '';
  useEffect(() => { setDraftQ(committedQ); }, [committedQ]);
  useEffect(() => {
    if (!propertyId) return;
    propApi.roomTypes(propertyId).then((r) => setRoomTypes(Array.isArray(r) ? r : r?.data || [])).catch(() => setRoomTypes([]));
  }, [propertyId]);

  const businessDate = data?.businessDate;
  const viewDate = data?.date || date;
  const isToday = viewDate && businessDate && viewDate === businessDate;
  const counts = data?.counts || {};
  const activeFilters = useMemo(() => {
    const list = [];
    if (params.get('q')) list.push({ k: 'q', label: `חיפוש: ${params.get('q')}` });
    if (params.get('roomType')) list.push({ k: 'roomType', label: `סוג: ${roomTypes.find((r) => r._id === params.get('roomType'))?.name || '…'}` });
    if (p('assignment') !== 'all') list.push({ k: 'assignment', label: p('assignment') === 'assigned' ? 'משובצים' : 'ללא שיבוץ' });
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, roomTypes]);

  const openCheckIn = (resId) => update({ checkin: resId }, { resetPage: false });
  const closeCheckIn = () => update({ checkin: null }, { resetPage: false });

  function sortBy(key) {
    if (p('sort') === key) update({ dir: p('dir') === 'asc' ? 'desc' : 'asc' }, { resetPage: false });
    else update({ sort: key, dir: 'asc' }, { resetPage: false });
  }
  const sortIcon = (key) => (p('sort') === key ? (p('dir') === 'asc' ? ' ↑' : ' ↓') : '');
  const ariaSort = (key) => (p('sort') === key ? (p('dir') === 'asc' ? 'ascending' : 'descending') : 'none');

  return (
    <div className="ui-page" dir="rtl">
      <ToastContainer toasts={toasts} />

      {/* Toolbar: date navigation · search · actions (Cloudbeds dashboard layout) */}
      <div className="ui-toolbar">
        <div className="ui-datenav" role="group" aria-label="בחירת יום">
          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="יום קודם" onClick={() => update({ date: addDays(viewDate, -1) })} disabled={!viewDate}><ChevronRight size={15} /></button>
          <label className="ui-datebox">
            <span className="sr-only">תאריך הגעה</span>
            <input type="date" value={viewDate || ''} onChange={(e) => update({ date: e.target.value || null })} />
          </label>
          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="יום הבא" onClick={() => update({ date: addDays(viewDate, 1) })} disabled={!viewDate}><ChevronLeft size={15} /></button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => update({ date: null })} disabled={isToday}>היום</button>
          {viewDate && <span className="ui-date-label">{formatLong(viewDate)}{!isToday && businessDate && <span className="ui-tag is-warn">לא היום העסקי</span>}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/pms/arrival-queue" className="btn btn-secondary btn-sm">תור המתנה{counts.queued ? ` · ${counts.queued}` : ''}</Link>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setWalkInOpen(true)} disabled={!businessDate}>הזמנת Walk-in</button>
        </div>
      </div>

      <section className="ui-card" aria-label="הגעות">
        {/* Tiles — counts come from the server for the whole day, before filters */}
        <div className="ui-tiles" role="tablist" aria-label="סינון לפי מוכנות">
          {TILES.map((t) => {
            const n = t.id === 'all' ? (counts.all ?? 0) - (counts.checked_in ?? 0) : t.id === 'waiting' ? (counts.waiting ?? 0) + (counts.queued ?? 0) : counts[t.id] ?? 0;
            const selected = p('readiness') === t.id;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={selected} className={`ui-tile ${selected ? 'is-selected' : ''}`} onClick={() => update({ readiness: t.id })}>
                <span className="ui-tile-n">{data ? n : '–'}</span>
                <span className="ui-tile-l">{t.label}</span>
              </button>
            );
          })}
          <div className="ui-tile is-static" aria-label="נכנסו היום">
            <span className="ui-tile-n">{data ? counts.checked_in ?? 0 : '–'}</span>
            <span className="ui-tile-l">נכנסו</span>
          </div>
        </div>

        {/* Search + filters (L01–L06) */}
        <form className="ui-filters" role="search" onSubmit={(e) => { e.preventDefault(); update({ q: draftQ.trim() || null }); }}>
          <div className="ui-search">
            <Search size={14} aria-hidden="true" />
            <label htmlFor="arr-q" className="sr-only">חיפוש לפי שם או מספר אישור</label>
            <input id="arr-q" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="שם אורח או מספר אישור — Enter לחיפוש" />
            {draftQ && <button type="button" aria-label="ניקוי חיפוש" className="ui-search-x" onClick={() => { setDraftQ(''); update({ q: null }); }}><X size={13} /></button>}
          </div>
          <label className="sr-only" htmlFor="arr-rt">סוג חדר</label>
          <select id="arr-rt" className="select select-sm" value={params.get('roomType') || ''} onChange={(e) => update({ roomType: e.target.value || null })}>
            <option value="">כל סוגי החדרים</option>
            {roomTypes.map((rt) => <option key={rt._id} value={rt._id}>{rt.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="arr-as">מצב שיבוץ</label>
          <select id="arr-as" className="select select-sm" value={p('assignment')} onChange={(e) => update({ assignment: e.target.value })}>
            <option value="all">משובצים ולא משובצים</option>
            <option value="assigned">משובצים</option>
            <option value="unassigned">ללא שיבוץ</option>
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} aria-label="רענון"><RefreshCw size={14} /></button>
        </form>
        {activeFilters.length > 0 && (
          <div className="ui-chips">
            {activeFilters.map((f) => (
              <span key={f.k} className="ui-chip">{f.label}<button type="button" aria-label={`הסרת ${f.label}`} onClick={() => update({ [f.k]: null })}><X size={11} /></button></span>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ q: null, roomType: null, assignment: null, readiness: null })}>איפוס סינון</button>
          </div>
        )}

        <ErrorBanner error={error} onRetry={load} />

        {/* Table — Guest | Accommodation | Stay | Readiness | Status action | ⋯ */}
        <div className="ui-table-wrap" aria-busy={loading}>
          <table className="ui-table ui-arrivals">
            <thead>
              <tr>
                <th scope="col" aria-sort={ariaSort('guest')}><button type="button" className="ui-th-sort" onClick={() => sortBy('guest')}>אורח{sortIcon('guest')}{p('sort') !== 'guest' && <ArrowUpDown size={11} aria-hidden="true" />}</button></th>
                <th scope="col" aria-sort={ariaSort('room')}><button type="button" className="ui-th-sort" onClick={() => sortBy('room')}>יחידה{sortIcon('room')}{p('sort') !== 'room' && <ArrowUpDown size={11} aria-hidden="true" />}</button></th>
                <th scope="col">שהייה</th>
                <th scope="col" aria-sort={ariaSort('eta')}><button type="button" className="ui-th-sort" onClick={() => sortBy('eta')}>הגעה צפויה{sortIcon('eta')}{p('sort') !== 'eta' && <ArrowUpDown size={11} aria-hidden="true" />}</button></th>
                <th scope="col">מוכנות</th>
                <th scope="col">סטטוס</th>
                <th scope="col"><span className="sr-only">פעולות נוספות</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={7}><div className="ui-empty"><Spinner /> טוען הגעות…</div></td></tr>
              )}
              {data && data.rows.length === 0 && (
                <tr><td colSpan={7}>
                  {(data.counts.all || 0) === 0 ? (
                    <div className="ui-empty"><strong>אין הגעות ב{isToday ? 'יום הזה' : `־${formatShort(viewDate)}`}</strong>אפשר ליצור הזמנת Walk-in לאורח שהגיע ללא הזמנה.</div>
                  ) : (
                    <div className="ui-empty"><strong>אין תוצאות לסינון הנוכחי</strong>
                      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => update({ q: null, roomType: null, assignment: null, readiness: null })}>ניקוי סינון</button>
                    </div>
                  )}
                </td></tr>
              )}
              {data?.rows.map((row) => (
                <ArrivalRow
                  key={row.key}
                  row={row}
                  businessDate={businessDate}
                  onCheckIn={() => openCheckIn(row.reservationId)}
                  onOpen={() => navigate(`/pms/reservations/${row.reservationId}`)}
                  onAssign={() => setAssignRow(row)}
                  onQueue={() => setQueueRow(row)}
                  onEta={() => setEtaRow(row)}
                  onNoShow={() => setNoShowRow(row)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer: include checked-in · count · pagination (L12/L13) */}
        <div className="ui-foot">
          <label className="ui-switch">
            <input type="checkbox" checked={includeCheckedIn} onChange={(e) => update({ all: e.target.checked ? '1' : null })} />
            <span>הצגת יחידות שכבר נכנסו</span>
          </label>
          {data && (
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-[rgb(var(--fg-muted))]">{data.total} יחידות</span>
              <label className="sr-only" htmlFor="arr-size">שורות בעמוד</label>
              <select id="arr-size" className="select select-sm" value={p('size')} onChange={(e) => update({ size: e.target.value })}>
                {[25, 50, 100].map((n) => <option key={n} value={n}>{n} בעמוד</option>)}
              </select>
              {data.pages > 1 && (
                <div className="flex items-center gap-1">
                  <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="עמוד קודם" disabled={data.page <= 1} onClick={() => update({ page: data.page - 1 }, { resetPage: false })}><ChevronRight size={14} /></button>
                  <span className="text-[13px] tabular-nums">{data.page}/{data.pages}</span>
                  <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="עמוד הבא" disabled={data.page >= data.pages} onClick={() => update({ page: data.page + 1 }, { resetPage: false })}><ChevronLeft size={14} /></button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Dialogs */}
      <CheckInWizard
        open={!!checkinId}
        propertyId={propertyId}
        reservationId={checkinId}
        isManager={isManager}
        onClose={closeCheckIn}
        onDone={() => { closeCheckIn(); load(); success('הכניסה נרשמה'); }}
        onAssign={(row, reload) => { setAssignRow(row); setWizardReload(() => reload); }}
        onQueue={(row, reload) => { setQueueRow(row); setWizardReload(() => reload); }}
      />
      <AssignRoomDialog
        open={!!assignRow}
        propertyId={propertyId}
        row={assignRow}
        onClose={() => { setAssignRow(null); setWizardReload(null); }}
        onAssigned={(out) => { setAssignRow(null); success(`שובץ חדר ${out.room.number}`); load(); wizardReload?.(); setWizardReload(null); }}
      />
      <QueueDialog
        open={!!queueRow}
        propertyId={propertyId}
        row={queueRow}
        currentUser={user}
        isManager={isManager}
        onClose={() => { setQueueRow(null); setWizardReload(null); }}
        onQueued={() => { setQueueRow(null); success('נוסף לתור ההמתנה'); load(); wizardReload?.(); setWizardReload(null); }}
      />
      <EtaDialog row={etaRow} propertyId={propertyId} onClose={() => setEtaRow(null)} onSaved={() => { setEtaRow(null); load(); success('שעת ההגעה עודכנה'); }} />
      <NoShowDialog row={noShowRow} propertyId={propertyId} onClose={() => setNoShowRow(null)} onDone={() => { setNoShowRow(null); load(); success('סומנה אי הגעה'); }} onError={toastError} />
      <WalkInDialog
        open={walkInOpen}
        propertyId={propertyId}
        businessDate={businessDate}
        onClose={() => setWalkInOpen(false)}
        onCreated={(r) => { setWalkInOpen(false); load(); openCheckIn(String(r._id)); }}
      />

    </div>
  );
}

function ArrivalRow({ row, businessDate, onCheckIn, onOpen, onAssign, onQueue, onEta, onNoShow }) {
  const st = row.readiness.state;
  const done = st === 'checked_in';
  const future = row.arrivalDate > businessDate;
  const multi = row.unitsTotal > 1;
  const primary = done ? null : st === 'ready' ? 'checkin' : (!row.room ? 'assign' : (st === 'waiting' && !row.queue ? 'queue' : 'checkin'));

  return (
    <tr className={done ? 'is-done' : ''}>
      <td>
        <div className="ui-guest">
          <span className="ui-avatar" aria-hidden="true">{guestInitials(row.guest.name)}</span>
          <div className="min-w-0">
            <button type="button" className="ui-guest-name" onClick={onOpen}>
              {row.guest.name}
              {row.guest.vip && <Crown size={12} className="text-amber-600" aria-label="VIP" />}
            </button>
            <div className="ui-sub">
              <bdi>{row.confirmationNumber}</bdi>
              {multi && <span> · יחידה {row.unitIndex}/{row.unitsTotal}</span>}
              {row.company && <span> · {row.company.name}</span>}
            </div>
          </div>
        </div>
      </td>
      <td>
        {row.room ? (
          <div>
            <button type="button" className="ui-link tabular-nums font-medium" onClick={onAssign} disabled={done} aria-label={`חדר ${row.room.number} — ${done ? '' : 'החלפת חדר'}`}>{row.room.number}</button>
            <div className="ui-sub ui-nowrap">{row.roomType?.name}</div>
          </div>
        ) : (
          <div>
            <span className="text-[rgb(var(--fg-muted))]">{row.roomType?.name}</span>
            {!done && <div><button type="button" className="ui-link is-accent" onClick={onAssign}>שיבוץ חדר</button></div>}
          </div>
        )}
      </td>
      <td>
        <div className="tabular-nums">{formatShort(row.arrivalDate)} – {formatShort(row.departureDate)}</div>
        <div className="ui-stay-chips">
          <span className="ui-mini" title="לילות"><Moon size={11} aria-hidden="true" />{row.nights}<span className="sr-only"> לילות</span></span>
          <span className="ui-mini" title="מבוגרים"><User size={11} aria-hidden="true" />{row.adults}<span className="sr-only"> מבוגרים</span></span>
          <span className="ui-mini" title="ילדים"><Baby size={11} aria-hidden="true" />{row.children || 0}<span className="sr-only"> ילדים</span></span>
        </div>
      </td>
      <td className="tabular-nums">
        {row.eta ? <button type="button" className="ui-link" onClick={onEta} disabled={done}>{row.eta}</button>
          : done ? '—' : <button type="button" className="ui-link is-muted" onClick={onEta}>לא ידוע</button>}
      </td>
      <td style={{ minWidth: 220 }}>
        <ReadinessBadge state={st} />
        {row.queue && <span className="ui-sub"> · בתור מ־{new Date(row.queue.arrivedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>}
        <ReasonList reasons={row.readiness.reasons} compact />
      </td>
      <td>
        {done ? <span className="ui-sub">נכנס</span>
          : primary === 'assign' ? <button type="button" className="btn btn-secondary btn-sm" onClick={onAssign}>שיבוץ</button>
            : primary === 'queue' ? <button type="button" className="btn btn-secondary btn-sm" onClick={onQueue}>לתור המתנה</button>
              : <button type="button" className={`btn btn-sm ${st === 'ready' ? 'btn-primary' : 'btn-secondary'}`} onClick={onCheckIn}>{st === 'ready' ? 'כניסה' : 'פתיחת כניסה'}</button>}
      </td>
      <td>
        <Menu.Root dir="rtl">
          <Menu.Trigger asChild>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`פעולות נוספות — ${row.guest.name}`}><MoreHorizontal size={15} /></button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="ui-menu" align="end" sideOffset={4}>
              <Menu.Item className="ui-menu-item" onSelect={onOpen}>פתיחת תיק הזמנה</Menu.Item>
              {!done && <Menu.Item className="ui-menu-item" onSelect={onCheckIn}>אשף כניסה</Menu.Item>}
              {!done && <Menu.Item className="ui-menu-item" onSelect={onAssign}>{row.room ? 'החלפת חדר' : 'שיבוץ חדר'}</Menu.Item>}
              {!done && !row.queue && !future && <Menu.Item className="ui-menu-item" onSelect={onQueue}>הוספה לתור המתנה</Menu.Item>}
              {!done && <Menu.Item className="ui-menu-item" onSelect={onEta}>עדכון שעת הגעה צפויה</Menu.Item>}
              {!done && (
                <>
                  <Menu.Separator className="ui-menu-sep" />
                  <Menu.Item
                    className="ui-menu-item is-danger"
                    disabled={multi || future || !!row.queue}
                    onSelect={onNoShow}
                  >
                    סימון אי הגעה
                    {(multi || future || row.queue) && (
                      <span className="ui-menu-why">{multi ? 'הזמנה מרובת חדרים — מתוך תיק ההזמנה' : future ? 'לפני יום ההגעה' : 'האורח בתור — הגיע'}</span>
                    )}
                  </Menu.Item>
                </>
              )}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </td>
    </tr>
  );
}

function EtaDialog({ row, propertyId, onClose, onSaved }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setValue(row?.eta || ''); setError(null); }, [row]);
  async function save() {
    setSaving(true); setError(null);
    try { await frontdesk.setEta(propertyId, row.reservationId, value || null); onSaved(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      busy={saving}
      width={420}
      title="שעת הגעה צפויה"
      subtitle={row ? `${row.guest.name} · ${row.confirmationNumber}` : ''}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <><Spinner /> שומר…</> : 'שמירה'}</button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      <Field id="eta-v" label="שעה (שעון הנכס)" optional hint="הערכה שמסר האורח — לא שעת הגעה בפועל. ריק = לא ידוע.">
        <input id="eta-v" type="time" className="input" style={{ width: 160 }} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </Modal>
  );
}

function NoShowDialog({ row, propertyId, onClose, onDone, onError }) {
  const [saving, setSaving] = useState(false);
  async function confirm() {
    setSaving(true);
    try { await frontdesk.noShow(propertyId, row.reservationId); onDone(); }
    catch (e) { onError(e.message); onClose(); }
    finally { setSaving(false); }
  }
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      busy={saving}
      width={480}
      title="סימון אי הגעה"
      subtitle={row ? `${row.guest.name} · ${row.confirmationNumber}` : ''}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-danger" onClick={confirm} disabled={saving}>{saving ? <><Spinner /> מסמן…</> : 'אישור אי הגעה'}</button>
        </>
      )}
    >
      <div className="ui-summary">
        <div className="ui-sum-row"><span>תאריכים</span><strong>{row && `${formatShort(row.arrivalDate)}–${formatShort(row.departureDate)}`}</strong></div>
        <div className="ui-sum-row"><span>יחידה</span><strong>{row?.room ? `חדר ${row.room.number}` : row?.roomType?.name}</strong></div>
        <div className="ui-sum-row"><span>ערבות</span><strong>{row?.guarantee?.label}</strong></div>
      </div>
      <p className="ui-p mt-3">
        אי הגעה אינה ביטול ואינה מוחקת את ההזמנה. המלאי של הלילות ישוחרר והחדר יחזור לפנוי.
        חיוב דמי אי הגעה או החזר מקדמה אינם מתבצעים כאן — הם פעולות כספיות נפרדות בתיק ההזמנה.
      </p>
    </Modal>
  );
}
