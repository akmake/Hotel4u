// FD-07 — Departures. Physical departure and closing the money are shown separately: a stay can
// be "left" while a folio stays open with an approved settlement, and that stays visible here.
// Late departures (still in the house after their date) are part of today's list.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Crown } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useAuthStore } from '../stores/authStore';
import { frontdesk } from '../utils/api';
import { SETTLEMENT_LABELS } from '../lib/labels';
import { addDays, formatLong, formatShort } from '../utils/date';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import {
  Page, Toolbar, Card, Tiles, SearchBox, DataTable, Tag, Pill, Avatar, Empty, RowMenu,
  useUrlState, useLoader, money, formatTime,
} from '../components/kit';
import { TimeDialog } from '../components/frontdesk/StayDialogs';
import CheckOutWizard from '../components/frontdesk/CheckOutWizard';

const MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const REFUND_ROLES = [...MANAGER_ROLES, 'finance_manager'];
const DEFAULTS = { status: 'all', q: '', date: '' };
const STATE = {
  expected: { label: 'צפוי לצאת', tone: 'warn' },
  late: { label: 'עבר מועד', tone: 'bad' },
  completed: { label: 'יצא', tone: 'muted' },
};

export default function DeparturesPage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const isManager = MANAGER_ROLES.includes(user?.role) || user?.role === 'finance_manager';
  const { toasts, success } = useToast();
  const url = useUrlState(DEFAULTS);
  const [dialog, setDialog] = useState(null);
  const checkoutId = url.params.get('checkout');
  const nav = useNavigate();
  const openStay = (r) => nav(`/pms/reservations/${r.reservationId}`);

  const { data, loading, error, reload } = useLoader(async () => {
    if (!propertyId) return null;
    return frontdesk.departures(propertyId, {
      date: url.get('date') || undefined,
      status: url.get('status') !== 'all' ? url.get('status') : undefined,
      q: url.get('q') || undefined,
    });
  }, [propertyId, url.key]);

  const viewDate = data?.date;
  const isToday = data && data.date === data.businessDate;
  const c = data?.counts || {};

  const columns = useMemo(() => [
    {
      key: 'guest', label: 'אורח', render: (r) => (
        <div className="ui-guest">
          <Avatar name={r.guest.name} />
          <div className="min-w-0">
            <button type="button" className="ui-guest-name" onClick={() => openStay(r)}>{r.guest.name}{r.guest.vip && <Crown size={12} className="text-amber-600" aria-label="VIP" />}</button>
            <div className="ui-sub"><bdi>{r.confirmationNumber}</bdi>{r.company && ` · ${r.company.name}`}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'units', label: 'חדרים', nowrap: true, render: (r) => (
        <div>
          <div className="ui-num font-medium">{r.units.map((u) => u.room || '—').join(', ')}</div>
          {r.units.length > 1 && <div className="ui-sub">{r.units.filter((u) => u.status === 'checked_out').length}/{r.units.length} יצאו</div>}
        </div>
      ),
    },
    {
      key: 'when', label: 'יציאה', nowrap: true, render: (r) => (
        <div>
          <div className="ui-num">{formatShort(r.departureDate)}{r.etd ? ` · ${r.etd}` : ''}</div>
          <div className="ui-sub">{r.checkedOutAt ? `יצא ${formatTime(r.checkedOutAt)}` : r.etd ? 'שעה צפויה' : 'שעה לא ידועה'}</div>
        </div>
      ),
    },
    {
      key: 'folios', label: 'חשבונות', render: (r) => (
        <div className="ui-stack" style={{ gap: 2 }}>
          {r.folios.length === 0 && <span className="ui-sub">אין חשבון</span>}
          {r.folios.map((f) => (
            <div key={f.id} className="ui-row" style={{ gap: 6 }}>
              <span className="ui-sub">{f.ownerLabel}</span>
              <span className={`ui-amount ${f.balance > 0.005 ? 'is-due' : f.balance < -0.005 ? 'is-credit' : 'is-zero'}`}>{Math.abs(f.balance) < 0.005 ? '0' : `${money(Math.abs(f.balance))}${f.balance < 0 ? ' זכות' : ''}`}</span>
              {f.status === 'closed' && <Tag>סגור</Tag>}
              {f.settlement && <Tag tone="warn" key="s">{SETTLEMENT_LABELS[f.settlement.mode]}{f.settlement.by ? ` · ${f.settlement.by}` : ''}</Tag>}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'docs', label: 'מסמכים', nowrap: true, render: (r) => (
        r.documents.issued + r.documents.draft + r.documents.pending === 0
          ? <span className="ui-sub">טרם הופק</span>
          : <span className="ui-sub">{r.documents.issued} הונפקו{r.documents.draft ? ` · ${r.documents.draft} טיוטה` : ''}{r.documents.pending ? ` · ${r.documents.pending} ממתין להקצאה` : ''}</span>
      ),
    },
    { key: 'state', label: 'מצב', nowrap: true, render: (r) => <Pill tone={STATE[r.state].tone}>{STATE[r.state].label}</Pill> },
    {
      key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (r) => (
        <div className="ui-row-actions">
          {r.state !== 'completed' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => url.set({ checkout: r.reservationId }, { resetPage: false })}>יציאה</button>
          )}
          <RowMenu
            label={`פעולות נוספות — ${r.guest.name}`}
            items={[
              { label: 'פתיחת תיק הזמנה', onSelect: () => openStay(r) },
              r.state !== 'completed' && { label: 'עדכון שעת יציאה צפויה', onSelect: () => setDialog({ kind: 'etd', row: r }) },
              r.state !== 'completed' && { label: 'הכנת חשבון', hint: 'בדיקת כל החשבונות לפני יציאה', onSelect: () => url.set({ checkout: r.reservationId }, { resetPage: false }) },
            ]}
          />
        </div>
      ),
    },
  ], [url]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <Toolbar
        start={(
          <>
            <div className="ui-datenav" role="group" aria-label="בחירת יום">
              <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="יום קודם" disabled={!viewDate} onClick={() => url.set({ date: addDays(viewDate, -1) })}><ChevronRight size={15} /></button>
              <label className="ui-datebox"><span className="sr-only">תאריך יציאה</span><input type="date" value={viewDate || ''} onChange={(e) => url.set({ date: e.target.value || null })} /></label>
              <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="יום הבא" disabled={!viewDate} onClick={() => url.set({ date: addDays(viewDate, 1) })}><ChevronLeft size={15} /></button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={isToday} onClick={() => url.set({ date: null })}>היום</button>
            </div>
            {viewDate && <span className="ui-date-label">{formatLong(viewDate)}{data && !isToday && <Tag tone="warn">לא היום העסקי</Tag>}</span>}
          </>
        )}
        end={<SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם או מספר אישור" id="dep-q" />}
      />
      <Tiles
        label="מצב יציאה"
        selected={url.get('status')}
        onSelect={(v) => url.set({ status: v })}
        items={[
          { id: 'all', label: 'כל העזיבות', value: data ? c.all : undefined },
          { id: 'expected', label: 'צפויים לצאת', value: data ? c.expected : undefined },
          { id: 'late', label: 'עבר מועד היציאה', value: data ? c.late : undefined, tone: c.late ? 'bad' : undefined },
          { id: 'completed', label: 'יצאו', value: data ? c.completed : undefined },
          { id: 'money', label: 'חשבון פתוח', value: data ? c.openMoney : undefined, tone: c.openMoney ? 'warn' : undefined, static: true },
        ]}
      />
      <Card flush>
        <DataTable
          caption="עזיבות"
          columns={columns}
          rows={data?.rows}
          rowKey={(r) => r.reservationId}
          loading={loading && !data}
          error={error}
          onRetry={reload}
          filtered={url.get('status') !== 'all' || !!url.get('q')}
          rowClass={(r) => (r.state === 'completed' ? 'is-done' : '')}
          empty={<Empty title={`אין עזיבות ב־${viewDate ? formatShort(viewDate) : 'יום זה'}`} />}
        />
      </Card>

      <TimeDialog
        open={dialog?.kind === 'etd'}
        title="שעת יציאה צפויה"
        subtitle={dialog?.row ? `${dialog.row.guest.name} · ${dialog.row.confirmationNumber}` : ''}
        label="שעה (שעון הנכס)"
        hint="מה שהאורח מסר — לא שעת יציאה בפועל."
        value={dialog?.row?.etd}
        onClose={() => setDialog(null)}
        onSave={async (v) => { await frontdesk.setEtd(propertyId, dialog.row.reservationId, v); setDialog(null); success('שעת היציאה עודכנה'); reload(); }}
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
    </Page>
  );
}
