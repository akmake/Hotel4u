// RSV-01 — reservations list. Finds a booking in any state (incl. cancelled, no-show, quotes):
// date range by arrival / stay / departure / creation, free search by guest, phone or
// confirmation (internal or channel), status groups, source and company. Counts units, not only
// bookings. Filter, sort and page live in the URL.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Crown } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { booking } from '../../utils/api';
import { RES_STATUS_LABELS, SOURCE_LABELS } from '../../lib/labels';
import { formatShort } from '../../utils/date';
import {
  Page, Toolbar, Card, Tiles, SearchBox, DataTable, Pill, Empty, Pager, FilterChips,
  useUrlState, useLoader, money, formatDateTime,
} from '../../components/kit';

const DEFAULTS = { status: 'all', q: '', from: '', to: '', dateField: 'arrival', source: '', sort: 'arrival', dir: 'asc', page: '1' };
const STATUS_TONE = {
  confirmed: 'ok', modified: 'ok', in_house: 'ok', checked_in: 'ok', partially_checked_in: 'ok', partially_checked_out: 'warn',
  hold: 'warn', pending_payment: 'warn', quote: 'muted', draft: 'muted', checked_out: 'muted', cancelled: 'bad', no_show: 'bad',
};
const DATE_FIELDS = { arrival: 'הגעה', stay: 'שהייה', departure: 'יציאה', created: 'יצירה' };

export default function ReservationsListPage() {
  const { propertyId } = useProperty();
  const nav = useNavigate();
  const url = useUrlState(DEFAULTS);
  const params = useMemo(() => {
    const o = {};
    for (const k of Object.keys(DEFAULTS)) { const v = url.get(k); if (v && !(k === 'status' && v === 'all')) o[k] = v; }
    return o;
  }, [url]);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? booking.list(propertyId, params) : null), [propertyId, url.key]);
  const open = (r) => nav(`/pms/reservations/${r.id}`);

  const columns = [
    {
      key: 'guest', label: 'אורח', sort: 'guest', render: (r) => (
        <div>
          <button type="button" className="ui-guest-name" onClick={() => open(r)}>{r.guest}{r.vip && <Crown size={12} className="text-amber-600" aria-label="VIP" />}</button>
          <div className="ui-sub"><bdi>{r.confirmationNumber}</bdi>{r.externalId ? <> · <bdi>{r.externalId}</bdi></> : null}{r.company ? ` · ${r.company}` : ''}</div>
        </div>
      ),
    },
    { key: 'arr', label: 'הגעה', sort: 'arrival', nowrap: true, render: (r) => <span className="ui-num">{formatShort(r.arrivalDate)}</span> },
    { key: 'dep', label: 'יציאה', sort: 'departure', nowrap: true, render: (r) => <div><div className="ui-num">{formatShort(r.departureDate)}</div><div className="ui-sub">{r.nights} לילות</div></div> },
    {
      key: 'rooms', label: 'יחידות', nowrap: true, render: (r) => (
        <div>
          <div>{r.rooms > 1 ? `${r.rooms} × ` : ''}{r.roomType || '—'}</div>
          <div className="ui-sub ui-num">{r.roomNumbers.length ? r.roomNumbers.join(', ') : 'לא שובץ'} · {r.guests} אורחים</div>
        </div>
      ),
    },
    { key: 'src', label: 'ערוץ', nowrap: true, render: (r) => SOURCE_LABELS[r.source] || r.source || '—' },
    { key: 'total', label: 'סכום', sort: 'total', nowrap: true, align: 'left', render: (r) => <span className="ui-amount">{money(r.total, r.currency, 0)}</span> },
    {
      key: 'bal', label: 'יתרה', nowrap: true, align: 'left', render: (r) => (r.balance === null ? <span className="ui-sub">—</span>
        : <span className={`ui-amount ${r.balance > 0.005 ? 'is-due' : r.balance < -0.005 ? 'is-credit' : 'is-zero'}`}>{money(r.balance, r.currency, 0)}</span>),
    },
    {
      key: 'st', label: 'מצב', nowrap: true, render: (r) => (
        <div>
          <Pill tone={STATUS_TONE[r.status] || 'muted'}>{RES_STATUS_LABELS[r.status] || r.status}</Pill>
          {r.quote && <div className="ui-sub">{r.quote.sentAt ? 'נשלחה' : 'לא נשלחה'} · עד {formatDateTime(r.quote.validUntil)}</div>}
        </div>
      ),
    },
  ];

  const chips = [
    (url.get('from') || url.get('to')) && { key: 'range', label: `${DATE_FIELDS[url.get('dateField')]}: ${url.get('from') ? formatShort(url.get('from')) : '…'} – ${url.get('to') ? formatShort(url.get('to')) : '…'}` },
    url.get('source') && { key: 'source', label: `ערוץ: ${SOURCE_LABELS[url.get('source')] || url.get('source')}` },
    url.get('q') && { key: 'q', label: `חיפוש: ${url.get('q')}` },
  ].filter(Boolean);
  const filtered = chips.length > 0 || url.get('status') !== 'all';

  return (
    <Page wide title="הזמנות" back="/pms" meta={data ? `${data.total} תוצאות` : undefined}
      primary={<button type="button" className="btn btn-primary" onClick={() => nav('/pms/reservations/new')}><Plus size={16} /> הזמנה חדשה</button>}>
      <Toolbar
        start={(
          <>
            <SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם, טלפון, מספר אישור או אסמכתת ערוץ" id="rsv-q" />
            <label className="sr-only" htmlFor="rsv-df">סוג תאריך</label>
            <select id="rsv-df" className="select select-sm" value={url.get('dateField')} onChange={(e) => url.set({ dateField: e.target.value })}>
              {Object.entries(DATE_FIELDS).map(([v, l]) => <option key={v} value={v}>לפי {l}</option>)}
            </select>
            <label className="ui-datebox"><span className="sr-only">מתאריך</span><input type="date" value={url.get('from')} onChange={(e) => url.set({ from: e.target.value })} /></label>
            <span className="ui-sub">עד</span>
            <label className="ui-datebox"><span className="sr-only">עד תאריך</span><input type="date" value={url.get('to')} min={url.get('from') || undefined} onChange={(e) => url.set({ to: e.target.value })} /></label>
            <label className="sr-only" htmlFor="rsv-src">ערוץ</label>
            <select id="rsv-src" className="select select-sm" value={url.get('source')} onChange={(e) => url.set({ source: e.target.value })}>
              <option value="">כל הערוצים</option>
              {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </>
        )}
      />
      <FilterChips chips={chips} onRemove={(k) => url.set(k === 'range' ? { from: '', to: '' } : { [k]: '' })} onReset={() => url.set({ q: '', from: '', to: '', source: '', status: 'all' })} />
      <Tiles
        label="מצב הזמנה"
        selected={url.get('status')}
        onSelect={(v) => url.set({ status: v })}
        items={[
          { id: 'all', label: 'הכול' },
          { id: 'upcoming', label: 'עתידיות' },
          { id: 'inhouse', label: 'בבית' },
          { id: 'departed', label: 'יצאו' },
          { id: 'quotes', label: 'הצעות וטיוטות' },
          { id: 'cancelled', label: 'בוטלו / לא הגיעו' },
        ].map((t) => ({ ...t, value: url.get('status') === t.id && data ? data.total : undefined }))}
      />
      <Card flush>
        <DataTable
          caption="הזמנות"
          columns={columns}
          rows={data?.rows}
          loading={loading && !data}
          error={error}
          onRetry={reload}
          sort={url.get('sort')}
          dir={url.get('dir')}
          onSort={(k) => url.set({ sort: k, dir: url.get('sort') === k && url.get('dir') === 'asc' ? 'desc' : 'asc' })}
          filtered={filtered}
          onRowClick={open}
          rowClass={(r) => (['cancelled', 'no_show'].includes(r.status) ? 'is-done' : '')}
          empty={<Empty title="אין הזמנות" action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => nav('/pms/reservations/new')}>הזמנה חדשה</button>} />}
        />
      </Card>
      {data && (
        <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => url.set({ page: p }, { resetPage: false })} unit={`הזמנות · ${data.units} יחידות`} />
      )}
    </Page>
  );
}
