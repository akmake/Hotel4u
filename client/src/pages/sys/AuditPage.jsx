// ADM-07 — audit log: who changed what and with what result. Read-only; before/after values come
// back with secrets and identity documents masked; the CSV export is itself recorded.
import { useState } from 'react';
import { Download } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { audit } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, Toolbar, Card, SearchBox, DataTable, Tag, Empty, Pager, Drawer, KeyValues, ErrorBanner, Spinner, FilterChips, useUrlState, useLoader, useAction, formatDateTime } from '../../components/kit';
import AdminNav from '../../components/sys/AdminNav';

const GROUP_LABELS = { finance: 'כספים', inventory: 'מלאי וחדרים', reservations: 'הזמנות', operations: 'תפעול', permissions: 'משתמשים והרשאות', auth: 'התחברות', privacy: 'פרטיות' };
const DEFAULTS = { from: '', to: '', actor: '', group: '', q: '', entityId: '', page: '1' };

function Diff({ before, after }) {
  if (!before && !after) return <div className="ui-sub">אין פירוט לפני/אחרי לאירוע זה.</div>;
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].slice(0, 60);
  const show = (v) => (v === undefined ? '—' : typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 300) : String(v));
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <thead><tr><th>שדה</th><th>לפני</th><th>אחרי</th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td className="ui-nowrap">{k}</td>
              <td dir="auto" style={{ wordBreak: 'break-word' }}>{show(before?.[k])}</td>
              <td dir="auto" style={{ wordBreak: 'break-word' }}>{show(after?.[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditPage() {
  const { propertyId } = useProperty();
  const { toasts, success } = useToast();
  const url = useUrlState(DEFAULTS);
  const [openId, setOpenId] = useState(null);
  const exp = useAction();
  const params = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, url.get(k) || undefined]));
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? audit.list(propertyId, params) : null), [propertyId, url.key]);
  const detail = useLoader(async () => (openId ? audit.get(openId) : null), [openId]);

  async function doExport() {
    const out = await exp.run(() => audit.exportCsv(propertyId, { ...params, page: undefined }));
    if (!out) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(out.blob);
    a.download = out.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    success('הקובץ ירד; הייצוא נרשם ביומן');
  }

  const columns = [
    { key: 'at', label: 'מועד', nowrap: true, render: (l) => <span className="ui-num">{formatDateTime(l.at)}</span> },
    { key: 'who', label: 'משתמש', nowrap: true, render: (l) => (l.source === 'system' ? <Tag>מערכת</Tag> : l.actorName) },
    { key: 'act', label: 'פעולה', render: (l) => <div><bdi className="font-medium">{l.action}</bdi>{l.reason && <div className="ui-sub">{l.reason}</div>}</div> },
    { key: 'ent', label: 'רשומה', nowrap: true, render: (l) => <div><div>{l.entityType}</div><button type="button" className="ui-link is-muted ui-sub" onClick={() => url.set({ entityId: l.entityId })} title="כל האירועים של הרשומה"><bdi>{l.entityId?.slice(-8)}</bdi></button></div> },
    { key: 'd', label: 'פירוט', srOnly: true, nowrap: true, render: (l) => <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(l.id)}>{l.hasDiff ? 'לפני/אחרי' : 'פרטים'}</button> },
  ];
  const chips = [
    url.get('actor') && { key: 'actor', label: `משתמש: ${data?.actors?.find((a) => a.id === url.get('actor'))?.name || '…'}` },
    url.get('group') && { key: 'group', label: GROUP_LABELS[url.get('group')] },
    url.get('entityId') && { key: 'entityId', label: `רשומה: …${url.get('entityId').slice(-8)}` },
    url.get('q') && { key: 'q', label: `טקסט: ${url.get('q')}` },
  ].filter(Boolean);

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <AdminNav end={<button type="button" className="btn btn-secondary btn-sm" onClick={doExport} disabled={exp.busy || !data}>{exp.busy ? <Spinner /> : <Download size={14} />} ייצוא CSV</button>} />
      <ErrorBanner error={exp.error} />
      <Toolbar
        start={(
          <>
            <label className="ui-datebox"><span className="sr-only">מתאריך</span><input type="date" value={url.get('from') || (data ? String(data.from).slice(0, 10) : '')} onChange={(e) => url.set({ from: e.target.value })} /></label>
            <span className="ui-sub">עד</span>
            <label className="ui-datebox"><span className="sr-only">עד תאריך</span><input type="date" value={url.get('to') || (data ? String(data.to).slice(0, 10) : '')} onChange={(e) => url.set({ to: e.target.value })} /></label>
            <label className="sr-only" htmlFor="au-g">סוג פעולה</label>
            <select id="au-g" className="select select-sm" value={url.get('group')} onChange={(e) => url.set({ group: e.target.value })}>
              <option value="">כל סוגי הפעולות</option>
              {Object.entries(GROUP_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="sr-only" htmlFor="au-a">משתמש</label>
            <select id="au-a" className="select select-sm" value={url.get('actor')} onChange={(e) => url.set({ actor: e.target.value })}>
              <option value="">כל המשתמשים</option>
              {(data?.actors || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </>
        )}
        end={<SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="פעולה או סיבה" id="au-q" />}
      />
      <FilterChips chips={chips} onRemove={(k) => url.set({ [k]: '' })} onReset={() => url.set({ actor: '', group: '', entityId: '', q: '' })} />
      <Card flush>
        <DataTable caption="יומן ביקורת" columns={columns} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} filtered={chips.length > 0} empty={<Empty title="אין אירועים בטווח" />} />
      </Card>
      {data && <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => url.set({ page: p }, { resetPage: false })} unit="אירועים" />}
      <Drawer open={!!openId} onClose={() => setOpenId(null)} title={detail.data?.action || 'אירוע'} subtitle={detail.data ? `${detail.data.actorName} · ${formatDateTime(detail.data.at)}` : ''} width={620}>
        <ErrorBanner error={detail.error} />
        {detail.loading && !detail.data && <div className="ui-empty"><Spinner /> טוען…</div>}
        {detail.data && (
          <>
            <KeyValues rows={[
              ['רשומה', `${detail.data.entityType} · ${detail.data.entityId}`],
              ['מקור', detail.data.source === 'system' ? 'מערכת / תהליך רקע' : 'משתמש'],
              detail.data.reason && ['סיבה', detail.data.reason],
              detail.data.ip && ['IP', detail.data.ip],
              detail.data.userAgent && ['מכשיר', detail.data.userAgent],
            ]} />
            <div className="ui-sub">ערכים רגישים (סיסמאות, סודות, מספרי מסמכים, חתימות) מוסתרים.</div>
            <Diff before={detail.data.before} after={detail.data.after} />
          </>
        )}
      </Drawer>
    </Page>
  );
}
