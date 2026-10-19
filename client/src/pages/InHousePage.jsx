// FD-06 — In-house. Split view: the list of stays in the house on one side, the selected stay's
// money, requests, exceptions and actions on the other. Balance and guarantee are two separate
// facts; DND and room problems come from operations, not from the desk.
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Moon } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useAuthStore } from '../stores/authStore';
import { frontdesk } from '../utils/api';
import { formatShort } from '../utils/date';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import {
  Page, Toolbar, Card, Tiles, SearchBox, DataTable, Pager, KeyValues, Banner, Tag, Pill, Avatar, Empty,
  useUrlState, useLoader, money,
} from '../components/kit';
import { ChargeDialog, GuestRequestDialog, TimeDialog } from '../components/frontdesk/StayDialogs';
import CheckOutWizard from '../components/frontdesk/CheckOutWizard';
import { MoveRoomDialog, ExtendDialog, EarlyDepartureDialog } from '../components/stay/StayChangeDialogs';

const MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const REFUND_ROLES = [...MANAGER_ROLES, 'finance_manager'];
const DEFAULTS = { view: 'all', q: '', page: '1', size: '50' };

export default function InHousePage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const isManager = MANAGER_ROLES.includes(user?.role) || user?.role === 'finance_manager';
  const navigate = useNavigate();
  const { toasts, success } = useToast();
  const url = useUrlState(DEFAULTS);
  const view = url.get('view');
  const [selectedId, setSelectedId] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind, stay }
  const checkoutId = url.params.get('checkout');

  const { data, loading, error, reload } = useLoader(async () => {
    if (!propertyId) return null;
    return frontdesk.inHouse(propertyId, {
      q: url.get('q') || undefined,
      view: view !== 'all' ? view : undefined,
      page: url.get('page'),
      pageSize: url.get('size'),
    });
  }, [propertyId, url.key]);
  useLiveRefresh(propertyId, ['Reservation', 'ReservationRoom', 'Folio', 'ArrivalQueueEntry', 'Room'], reload);

  const rows = useMemo(() => data?.rows || [], [data]);

  const selected = rows.find((r) => r.reservationId === selectedId) || null;
  useEffect(() => { if (selectedId && data && !data.rows.some((r) => r.reservationId === selectedId)) setSelectedId(null); }, [data, selectedId]);

  const c = data?.counts || {};
  const columns = [
    {
      key: 'guest', label: 'אורח', render: (r) => (
        <div className="ui-guest">
          <Avatar name={r.guest.name} />
          <div className="min-w-0">
            <div className="ui-guest-name">{r.guest.name}{r.guest.vip && <Crown size={12} className="text-amber-600" aria-label="VIP" />}</div>
            <div className="ui-sub"><bdi>{r.confirmationNumber}</bdi>{r.company && ` · ${r.company.name}`}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'rooms', label: 'חדר', nowrap: true, render: (r) => (
        <div>
          <div className="ui-num font-medium">{r.rooms.map((x) => x.number).join(', ') || '—'}</div>
          <div className="ui-sub">{r.unitsTotal > 1 ? `${r.unitsInHouse}/${r.unitsTotal} יחידות` : r.roomType}</div>
        </div>
      ),
    },
    {
      key: 'dates', label: 'יציאה', nowrap: true, render: (r) => (
        <div>
          <div className={`ui-num ${r.departureDate < data.businessDate ? 'text-[rgb(185_28_28)] font-semibold' : ''}`}>{formatShort(r.departureDate)}{r.etd ? ` · ${r.etd}` : ''}</div>
          <div className="ui-sub">מ־{formatShort(r.arrivalDate)}</div>
        </div>
      ),
    },
    {
      key: 'money', label: 'יתרה', align: 'left', nowrap: true, render: (r) => (
        <div>
          <div className={`ui-amount ${r.money.owed > 0 ? 'is-due' : r.money.credit < 0 ? 'is-credit' : 'is-zero'}`}>
            {r.money.owed > 0 ? money(r.money.owed) : r.money.credit < 0 ? `${money(-r.money.credit)} זכות` : '—'}
          </div>
          <div className="ui-sub">{r.guarantee.ok ? r.guarantee.label : 'ללא ערבות'}</div>
        </div>
      ),
    },
    {
      key: 'flags', label: 'שים לב', render: (r) => (
        <div className="ui-row" style={{ gap: 4 }}>
          {r.rooms.some((x) => x.dnd) && <Tag>DND</Tag>}
          {r.openRequests > 0 && <Tag tone="warn">{r.openRequests} בקשות</Tag>}
          {r.exceptions.map((e) => <Tag key={e.code + e.label} tone={e.code === 'overdue' || e.code === 'ticket' ? 'bad' : 'warn'}>{e.label}</Tag>)}
        </div>
      ),
    },
  ];

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <Toolbar
        start={<SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם, חדר או מספר אישור — Enter" id="ih-q" />}
        end={<button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/pms/departures')}>לעזיבות היום</button>}
      />
      <Tiles
        label="תצוגה"
        selected={view}
        onSelect={(v) => url.set({ view: v })}
        items={[
          { id: 'all', label: 'בבית', value: data ? c.all : undefined },
          { id: 'today', label: 'יוצאים היום', value: data ? c.departingToday : undefined },
          { id: 'overdue', label: 'עבר מועד יציאה', value: data ? c.overdue : undefined, tone: c.overdue ? 'bad' : undefined },
          { id: 'balance', label: 'עם יתרה לתשלום', value: data ? c.withBalance : undefined, tone: c.withBalance ? 'warn' : undefined },
        ]}
      />
      <div className="ui-split">
        <Card flush>
          <DataTable
            caption="שוהים"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.reservationId}
            loading={loading && !data}
            error={error}
            onRetry={reload}
            filtered={!!url.get('q') || view !== 'all'}
            empty={<Empty title="אין שוהים כרגע">שהייה נכנסת לכאן אחרי השלמת כניסה ממסך ההגעות.</Empty>}
            rowClass={(r) => (r.reservationId === selectedId ? 'is-selected' : '')}
            onRowClick={(r) => setSelectedId(r.reservationId)}
          />
          {data && (
            <div style={{ padding: '8px 12px' }}>
              <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} unit="שהיות" onPage={(p) => url.set({ page: p }, { resetPage: false })} onSize={(n) => url.set({ size: n })} />
            </div>
          )}
        </Card>

        <Card title={selected ? selected.guest.name : 'פרטי שהייה'}>
          {!selected ? (
            <Empty title="בחרו שהייה מהרשימה">יוצגו כאן היתרה, הבקשות והפעולות לשהייה.</Empty>
          ) : (
            <div className="ui-stack">
              <KeyValues rows={[
                ['אישור', <bdi key="c">{selected.confirmationNumber}</bdi>],
                ['חדר', selected.rooms.map((x) => x.number).join(', ') || '—'],
                ['תאריכים', `${formatShort(selected.arrivalDate)}–${formatShort(selected.departureDate)}`],
                ['אורחים', `${selected.adults} מבוגרים${selected.children ? ` · ${selected.children} ילדים` : ''}`],
                ['יתרה', selected.money.owed > 0 ? money(selected.money.owed) : selected.money.credit < 0 ? `${money(-selected.money.credit)} זכות` : 'מאוזן'],
                ['ערבות', selected.guarantee.label],
                ['יציאה צפויה', selected.etd || 'לא ידוע'],
              ]} />
              {selected.exceptions.length > 0 && (
                <Banner tone="warn">{selected.exceptions.map((e) => e.label).join(' · ')}</Banner>
              )}
              <div className="ui-row">
                {selected.departureDate > data.businessDate
                  ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'early', stay: selected })}>עזיבה מוקדמת</button>
                  : <button type="button" className="btn btn-primary btn-sm" onClick={() => url.set({ checkout: selected.reservationId }, { resetPage: false })}>יציאה</button>}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'move', stay: selected })}>מעבר חדר</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'extend', stay: selected })}>הארכה</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'charge', stay: selected })}>חיוב שירות</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'request', stay: selected })}>בקשת אורח</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'etd', stay: selected })}>שעת יציאה</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/pms/reservations/${selected.reservationId}`)}>תיק הזמנה</button>
              </div>
              {selected.rooms.length > 1 && <div className="ui-sub"><Moon size={11} aria-hidden="true" /> בשהייה עם כמה חדרים — מעבר חדר נבחר ליחידה בתיק ההזמנה.</div>}
            </div>
          )}
        </Card>
      </div>

      <ChargeDialog open={dialog?.kind === 'charge'} propertyId={propertyId} stay={dialog?.stay} onClose={() => setDialog(null)} onDone={() => { setDialog(null); success('החיוב נרשם'); reload(); }} />
      <GuestRequestDialog open={dialog?.kind === 'request'} propertyId={propertyId} stay={dialog?.stay} onClose={() => setDialog(null)} onDone={() => { setDialog(null); success('הבקשה נפתחה'); reload(); }} />
      <TimeDialog
        open={dialog?.kind === 'etd'}
        title="שעת יציאה צפויה"
        subtitle={dialog?.stay ? `${dialog.stay.guest.name} · ${dialog.stay.confirmationNumber}` : ''}
        label="שעה (שעון הנכס)"
        hint="מה שהאורח מסר — לא שעת יציאה בפועל. ריק = לא ידוע."
        value={dialog?.stay?.etd}
        onClose={() => setDialog(null)}
        onSave={async (v) => { await frontdesk.setEtd(propertyId, dialog.stay.reservationId, v); setDialog(null); success('שעת היציאה עודכנה'); reload(); }}
      />
      <CheckOutWizard
        open={!!checkoutId}
        propertyId={propertyId}
        reservationId={checkoutId}
        isManager={isManager}
        canRefund={REFUND_ROLES.includes(user?.role)}
        initialEarlyReason={url.params.get('early') || ''}
        onClose={() => url.set({ checkout: null, early: null }, { resetPage: false })}
        onDone={() => { url.set({ checkout: null, early: null }, { resetPage: false }); reload(); success('היציאה נרשמה'); }}
      />
      <MoveRoomDialog
        open={dialog?.kind === 'move'}
        onClose={() => setDialog(null)}
        propertyId={propertyId}
        reservationId={dialog?.stay?.reservationId}
        canChangePrice={isManager}
        onDone={(out) => { setDialog(null); success(`עבר מחדר ${out.from || '—'} לחדר ${out.to}${out.ticket ? (out.ticket.linked ? ' · נרשם בתקלה הפתוחה' : ' · נפתחה תקלה בתחזוקה') + (out.ticket.blocked ? ' והחדר נחסם' : '') : ''}${out.key ? ' · יש להנפיק מפתח' : ''}`); reload(); }}
      />
      <ExtendDialog
        open={dialog?.kind === 'extend'}
        onClose={() => setDialog(null)}
        propertyId={propertyId}
        reservationId={dialog?.stay?.reservationId}
        departureDate={dialog?.stay?.departureDate}
        canManualPrice={isManager}
        onMoveInstead={() => setDialog((d) => ({ kind: 'move', stay: d.stay }))}
        onDone={(out) => { setDialog(null); success(`השהייה הוארכה עד ${formatShort(out.departureDate)}`); reload(); }}
      />
      <EarlyDepartureDialog
        open={dialog?.kind === 'early'}
        onClose={() => setDialog(null)}
        propertyId={propertyId}
        reservationId={dialog?.stay?.reservationId}
        onContinue={(reasonLabel) => { const id = dialog.stay.reservationId; setDialog(null); url.set({ checkout: id, early: reasonLabel }, { resetPage: false }); }}
      />
    </Page>
  );
}
