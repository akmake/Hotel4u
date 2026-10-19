// OPS-03 — room status. Three separate dimensions per room: occupancy (from stays, read-only here),
// cleanliness (editable by hand only as an exception, with a reason and the version the user saw)
// and operational status (blocking is its own decision; unblocking needs a manager and no open
// blocking ticket). "Inspected" is never set here — only through OPS-04.
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useMemo, useState } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops } from '../../utils/api';
import { cleanLabel, opsLabel, TASK_TYPE_LABELS, TASK_STATUS_LABELS } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Toolbar, Card, Tiles, SearchBox, DataTable, Tag, Pill, Empty, RowMenu, ConfirmDialog, FilterChips,
  useUrlState, useLoader,
} from '../../components/kit';
import OpsNav, { HK_MANAGER_ROLES, HK_STAFF, FRONT_ROLES, UNBLOCK_ROLES } from '../../components/ops/OpsNav';
import { TicketDialog } from '../../components/ops/OpsDialogs';

const DEFAULTS = { clean: '', floor: '', q: '' };
const CLEAN_TONE = { dirty: 'bad', pickup: 'warn', cleaning: 'warn', clean: 'ok', inspected: 'ok', turndown_required: 'warn' };
const WRITE_ROLES = [...HK_MANAGER_ROLES, ...HK_STAFF, ...FRONT_ROLES];

export default function RoomStatusPage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const canWrite = WRITE_ROLES.includes(role);
  const canMarkClean = HK_MANAGER_ROLES.includes(role);
  const canUnblock = UNBLOCK_ROLES.includes(role);
  const { toasts, success } = useToast();
  const url = useUrlState(DEFAULTS);
  const [dialog, setDialog] = useState(null);

  // Clean filter is applied locally so the tiles always show the counts of the whole floor.
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.rooms(propertyId, { floor: url.get('floor') || undefined, q: url.get('q') || undefined }) : null), [propertyId, url.get('floor'), url.get('q')]);
  useLiveRefresh(propertyId, ['Room', 'HousekeepingTask', 'MaintenanceTicket', 'Reservation', 'ReservationRoom'], reload);
  const all = data?.rows || [];
  const floors = useMemo(() => [...new Set(all.map((r) => r.floor))].sort((a, b) => a - b), [all]);
  const match = (r, k) => (k === 'dirty' ? ['dirty', 'pickup'].includes(r.cleanStatus) : k === 'blocked' ? r.opsStatus !== 'available' || r.tickets.blocking : r.cleanStatus === k);
  const rows = url.get('clean') ? all.filter((r) => match(r, url.get('clean'))) : all;
  const count = (k) => all.filter((r) => match(r, k)).length;

  const columns = [
    { key: 'room', label: 'חדר', nowrap: true, render: (r) => <div><div className="ui-room-n">{r.number}</div><div className="ui-sub">{r.roomType || '—'} · קומה {r.floor}</div></div> },
    { key: 'occ', label: 'תפוסה', nowrap: true, render: (r) => r.occupancy.label },
    { key: 'clean', label: 'ניקיון', nowrap: true, render: (r) => <Pill tone={CLEAN_TONE[r.cleanStatus] || 'muted'}>{cleanLabel(r.cleanStatus)}</Pill> },
    {
      key: 'ops', label: 'תפעול', nowrap: true, render: (r) => (
        <div className="ui-stack" style={{ gap: 2 }}>
          {r.opsStatus === 'available' ? <span className="ui-sub">זמין</span> : <Tag tone="bad">{opsLabel(r.opsStatus)}</Tag>}
          {r.tickets.open > 0 && <span className={`ui-dot-label ${r.tickets.blocking ? 'is-bad' : 'is-warn'}`}>{r.tickets.open} תקלות{r.tickets.blocking ? ' · חוסמת' : ''}</span>}
        </div>
      ),
    },
    { key: 'svc', label: 'שירות', nowrap: true, render: (r) => (r.service === 'dnd' ? <Tag tone="warn">DND</Tag> : r.service === 'declined' ? <Tag>ויתר על שירות</Tag> : <span className="ui-sub">רגיל</span>) },
    { key: 'task', label: 'משימה היום', render: (r) => (r.task ? <div><div>{TASK_TYPE_LABELS[r.task.type]}</div><div className="ui-sub">{TASK_STATUS_LABELS[r.task.status]}{r.task.assignee ? ` · ${r.task.assignee}` : ''}</div></div> : <span className="ui-sub">—</span>) },
    {
      key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (r) => (
        <div className="ui-row-actions">
          <RowMenu
            label={`פעולות — חדר ${r.number}`}
            items={[
              canWrite && r.cleanStatus !== 'dirty' && { label: 'סימון מלוכלך', hint: 'נדרשת סיבה', onSelect: () => setDialog({ kind: 'clean', room: r, to: 'dirty' }) },
              canWrite && !['clean', 'inspected'].includes(r.cleanStatus) && {
                label: 'סימון נקי (ללא משימה)', disabled: !canMarkClean, why: 'למפקח חדרנות בלבד', hint: 'חריג — נדרשת סיבה', onSelect: () => setDialog({ kind: 'clean', room: r, to: 'clean' }),
              },
              (r.opsStatus !== 'available') && {
                label: 'שחרור חסימה', disabled: !canUnblock || r.tickets.blocking, why: r.tickets.blocking ? 'יש תקלה חוסמת פתוחה' : 'למנהל בלבד', onSelect: () => setDialog({ kind: 'unblock', room: r }),
              },
              { separator: true },
              { label: 'דיווח תקלה', onSelect: () => setDialog({ kind: 'ticket', room: r }) },
            ]}
          />
        </div>
      ),
    },
  ];

  const chips = [
    url.get('floor') && { key: 'floor', label: `קומה ${url.get('floor')}` },
    url.get('q') && { key: 'q', label: `חדר: ${url.get('q')}` },
  ].filter(Boolean);

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <OpsNav role={role} />
      <Toolbar
        start={(
          <>
            <SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="מספר חדר" id="rs-q" />
            <label className="sr-only" htmlFor="rs-floor">קומה</label>
            <select id="rs-floor" className="select select-sm" value={url.get('floor')} onChange={(e) => url.set({ floor: e.target.value })}>
              <option value="">כל הקומות</option>
              {(url.get('floor') && !floors.includes(Number(url.get('floor'))) ? [...floors, Number(url.get('floor'))] : floors).map((f) => <option key={f} value={f}>קומה {f}</option>)}
            </select>
          </>
        )}
        end={data && <span className="ui-muted">יום עסקי {data.businessDate}</span>}
      />
      <FilterChips chips={chips} onRemove={(k) => url.set({ [k]: '' })} onReset={() => url.set({ floor: '', q: '', clean: '' })} />
      <Tiles
        label="סינון לפי ניקיון"
        selected={url.get('clean') || 'all'}
        onSelect={(v) => url.set({ clean: v === 'all' ? '' : v })}
        items={[
          { id: 'all', label: 'כל החדרים', value: data ? all.length : undefined },
          { id: 'dirty', label: 'מלוכלכים', value: data ? count('dirty') : undefined, tone: data && count('dirty') ? 'warn' : undefined },
          { id: 'cleaning', label: 'בניקיון', value: data ? count('cleaning') : undefined },
          { id: 'clean', label: 'נקיים (לא נבדקו)', value: data ? count('clean') : undefined },
          { id: 'inspected', label: 'נבדקו', value: data ? count('inspected') : undefined, tone: 'ok' },
          { id: 'blocked', label: 'חסומים', value: data ? count('blocked') : undefined, tone: data && count('blocked') ? 'bad' : undefined },
        ]}
      />
      <Card flush>
        <DataTable
          caption="מצב חדרים"
          columns={columns}
          rows={data ? rows : undefined}
          loading={loading && !data}
          error={error}
          onRetry={reload}
          filtered={!!(url.get('clean') || url.get('floor') || url.get('q'))}
          empty={<Empty title="אין חדרים פעילים" />}
        />
      </Card>

      <ConfirmDialog
        open={dialog?.kind === 'clean'}
        onClose={() => setDialog(null)}
        title={dialog?.to === 'clean' ? `סימון חדר ${dialog?.room?.number} כנקי` : `סימון חדר ${dialog?.room?.number} כמלוכלך`}
        subtitle={dialog ? `כעת: ${cleanLabel(dialog.room.cleanStatus)} → ${cleanLabel(dialog.to)}` : ''}
        confirmLabel="עדכון ניקיון"
        requireReason
        onConfirm={async (reason) => {
          try {
            await ops.setClean(propertyId, dialog.room.id, { cleanStatus: dialog.to, reason, version: dialog.room.version });
          } catch (e) {
            if (e.code === 'version_conflict') reload();
            throw e;
          }
          setDialog(null); success('מצב הניקיון עודכן'); reload();
        }}
      >
        {dialog?.to === 'clean' && <p className="ui-p">סימון ידני עוקף את משימת הניקיון. "נבדק" נקבע רק בבדיקת חדר.</p>}
        {dialog?.room?.occupancy?.code !== 'vacant' && <p className="ui-p">התפוסה לא משתנה — היא נקבעת מהשהייה בלבד.</p>}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog?.kind === 'unblock'}
        onClose={() => setDialog(null)}
        title={`שחרור חסימת חדר ${dialog?.room?.number}`}
        subtitle={dialog ? `${opsLabel(dialog.room.opsStatus)} → זמין` : ''}
        confirmLabel="שחרור לשימוש"
        requireReason
        onConfirm={async (reason) => { await ops.unblock(propertyId, dialog.room.id, reason); setDialog(null); success('החדר שוחרר לשימוש'); reload(); }}
      >
        <p className="ui-p">השחרור לא מסמן את החדר נקי — אם נדרש, שלחו ניקיון ובדיקה לפני אכלוס.</p>
      </ConfirmDialog>
      <TicketDialog open={dialog?.kind === 'ticket'} onClose={() => setDialog(null)} propertyId={propertyId} room={dialog?.room ? { id: dialog.room.id, number: dialog.room.number } : null} onSaved={() => { setDialog(null); success('התקלה נפתחה'); reload(); }} />
    </Page>
  );
}
