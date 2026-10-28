// OPS-05 — lost & found with a chain of custody: every move (found → transferred → returned /
// disposed) is a dated entry with who did it. Release needs a verified recipient; an ID document is
// never donated or discarded; final disposal is a manager action.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { ops } from '../../utils/api';
import { LOST_STATUS_LABELS, LOST_CATEGORY_LABELS, DISPOSAL_LABELS } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Toolbar, Card, Tiles, SearchBox, DataTable, Tag, Pill, Empty, RowMenu, Drawer, KeyValues,
  useUrlState, useLoader, formatDateTime,
} from '../../components/kit';
import OpsNav, { HK_MANAGER_ROLES, FRONT_ROLES } from '../../components/ops/OpsNav';
import { LostItemDialog, ReleaseLostDialog, TransferLostDialog, DisposeLostDialog } from '../../components/ops/OpsDialogs';

const DEFAULTS = { status: 'open', q: '' };
const STATUS_TONE = { found: 'warn', stored: 'warn', returned: 'ok', disposed: 'muted' };
const CUSTODY_LABELS = { found: 'נמצא ונרשם', stored: 'אוחסן', transferred: 'הועבר', returned: 'נמסר', disposed: 'טופל סופית' };
const RELEASE_ROLES = [...HK_MANAGER_ROLES, ...FRONT_ROLES];
const DISPOSE_ROLES = [...HK_MANAGER_ROLES, 'front_desk_manager'];

export default function LostFoundPage() {
  const { propertyId } = useProperty();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const { toasts, success } = useToast();
  const url = useUrlState(DEFAULTS);
  const [dialog, setDialog] = useState(null);

  const { data, loading, error, reload } = useLoader(async () => (propertyId ? ops.lostItems(propertyId, { status: url.get('status'), q: url.get('q') || undefined }) : null), [propertyId, url.key]);
  const c = data?.counts || {};
  const isOpen = (i) => ['found', 'stored'].includes(i.status);

  const columns = [
    { key: 'code', label: 'מזהה', nowrap: true, render: (i) => <button type="button" className="ui-link font-medium" onClick={() => setDialog({ kind: 'detail', item: i })}><bdi>{i.code}</bdi></button> },
    {
      key: 'desc', label: 'חפץ', render: (i) => (
        <div>
          <div>{i.description}</div>
          <div className="ui-sub">{LOST_CATEGORY_LABELS[i.category] || i.category}{i.category === 'hazardous' && ' · לטיפול מנהל'}</div>
        </div>
      ),
    },
    { key: 'where', label: 'נמצא ב', nowrap: true, render: (i) => <div><div>{i.room ? `חדר ${i.room}` : i.location || '—'}</div><div className="ui-sub">{formatDateTime(i.foundAt)} · {i.foundBy || '—'}</div></div> },
    { key: 'storage', label: 'מאוחסן ב', render: (i) => (isOpen(i) ? i.storage : <span className="ui-sub">—</span>) },
    {
      key: 'status', label: 'מצב', nowrap: true, render: (i) => (
        <div>
          <Pill tone={STATUS_TONE[i.status]}>{LOST_STATUS_LABELS[i.status]}</Pill>
          {i.status === 'returned' && i.recipientName && <div className="ui-sub">ל{i.recipientName}</div>}
          {i.status === 'disposed' && i.disposal && <div className="ui-sub">{DISPOSAL_LABELS[i.disposal]}</div>}
        </div>
      ),
    },
    {
      key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (i) => (
        <div className="ui-row-actions">
          {isOpen(i) && RELEASE_ROLES.includes(role) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'release', item: i })}>מסירה</button>}
          <RowMenu
            label={`פעולות — ${i.code}`}
            items={[
              { label: 'שרשרת אחזקה', onSelect: () => setDialog({ kind: 'detail', item: i }) },
              isOpen(i) && { label: 'העברת אחזקה', onSelect: () => setDialog({ kind: 'transfer', item: i }) },
              isOpen(i) && { label: 'טיפול סופי', disabled: !DISPOSE_ROLES.includes(role), why: 'למנהל בלבד', danger: true, onSelect: () => setDialog({ kind: 'dispose', item: i }) },
            ]}
          />
        </div>
      ),
    },
  ];

  const detail = dialog?.kind === 'detail' ? dialog.item : null;

  return (
    <Page wide title="אבידות ומציאות" back="/pms">
      <ToastContainer toasts={toasts} />
      <OpsNav role={role} end={<button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'new' })}><Plus size={14} /> רישום מציאה</button>} />
      <Toolbar start={<SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="תיאור או מזהה (L-0001)" id="lf-q" />} />
      <Tiles
        label="מצב פריטים"
        selected={url.get('status')}
        onSelect={(v) => url.set({ status: v })}
        items={[
          { id: 'open', label: 'בשמירה', value: data ? (c.found || 0) + (c.stored || 0) : undefined, tone: 'warn' },
          { id: 'returned', label: 'נמסרו', value: data ? c.returned || 0 : undefined },
          { id: 'disposed', label: 'טופלו סופית', value: data ? c.disposed || 0 : undefined },
          { id: 'all', label: 'הכול', value: data ? Object.values(c).reduce((a, b) => a + b, 0) : undefined },
        ]}
      />
      <Card flush>
        <DataTable
          caption="אבידות ומציאות"
          columns={columns}
          rows={data?.rows}
          loading={loading && !data}
          error={error}
          onRetry={reload}
          filtered={!!url.get('q')}
          rowClass={(i) => (isOpen(i) ? '' : 'is-done')}
          empty={<Empty title={url.get('status') === 'open' ? 'אין פריטים בשמירה' : 'אין פריטים'} action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'new' })}>רישום מציאה</button>} />}
        />
      </Card>

      <Drawer open={!!detail} onClose={() => setDialog(null)} title={detail ? `${detail.code} · ${detail.description}` : ''} subtitle={detail ? LOST_STATUS_LABELS[detail.status] : ''} width={480}>
        {detail && (
          <>
            <KeyValues rows={[
              ['סוג', LOST_CATEGORY_LABELS[detail.category]],
              ['נמצא ב', detail.room ? `חדר ${detail.room}` : detail.location],
              ['מועד', formatDateTime(detail.foundAt)],
              ['מוצא', detail.foundBy],
              isOpen(detail) && ['מאוחסן ב', detail.storage],
              detail.recipientName && ['נמסר ל', detail.recipientName],
              detail.disposal && ['טיפול', DISPOSAL_LABELS[detail.disposal]],
            ]} />
            <div>
              <div className="ui-section-title">שרשרת אחזקה</div>
              <ol className="ui-timeline">
                {detail.custody.map((e, idx) => (
                  <li key={idx}>
                    <strong>{CUSTODY_LABELS[e.action] || e.action}{e.to ? ` ← ${e.to}` : ''}</strong>
                    <span className="ui-sub">{formatDateTime(e.at)} · {e.by || '—'}{e.storage ? ` · ${e.storage}` : ''}</span>
                    {e.note && <span className="ui-sub">{e.note}</span>}
                  </li>
                ))}
              </ol>
            </div>
            {detail.category === 'document' && isOpen(detail) && <Tag tone="warn">מסמך זיהוי — נמסר לבעליו או למשטרה בלבד</Tag>}
          </>
        )}
      </Drawer>

      <LostItemDialog open={dialog?.kind === 'new'} onClose={() => setDialog(null)} propertyId={propertyId} onSaved={(out) => { setDialog(null); success(`נרשם ${out?.code || ''}`); reload(); }} />
      <ReleaseLostDialog open={dialog?.kind === 'release'} onClose={() => setDialog(null)} propertyId={propertyId} item={dialog?.item} onSaved={() => { setDialog(null); success('המסירה נרשמה'); reload(); }} />
      <TransferLostDialog open={dialog?.kind === 'transfer'} onClose={() => setDialog(null)} propertyId={propertyId} item={dialog?.item} onSaved={() => { setDialog(null); success('האחזקה הועברה'); reload(); }} />
      <DisposeLostDialog open={dialog?.kind === 'dispose'} onClose={() => setDialog(null)} propertyId={propertyId} item={dialog?.item} onSaved={() => { setDialog(null); success('הטיפול נרשם'); reload(); }} />
    </Page>
  );
}
