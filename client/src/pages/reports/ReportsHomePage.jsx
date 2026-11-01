// Reports home — copied from Cloudbeds "Reporting → Home": every report the hotel has, grouped in
// columns by area, one search box over all of them, and the subscriptions one click away. Reports of
// the report centre open in the shared report view; screens that already exist link to themselves.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { reportCenter } from '../../utils/api';
import { Page, Card, Spinner, ErrorBanner, useLoader } from '../../components/kit';
import './reports.css';

export default function ReportsHomePage() {
  const { propertyId } = useProperty();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? reportCenter.catalog(propertyId) : null), [propertyId]);
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    if (!data) return [];
    const term = q.trim();
    const items = [
      ...data.reports.map((r) => ({ key: r.code, name: r.name, group: r.group, description: r.description, to: `/pms/reports/r/${r.code}` })),
      ...data.linked.map((l) => ({ key: l.to, name: l.name, group: l.group, description: null, to: l.to })),
    ].filter((r) => !term || r.name.includes(term) || (r.description || '').includes(term) || r.group.includes(term));
    return data.groups.map((g) => ({ name: g, items: items.filter((r) => r.group === g).sort((a, b) => a.name.localeCompare(b.name, 'he')) })).filter((g) => g.items.length);
  }, [data, q]);
  const total = data ? data.reports.length + data.linked.length : 0;

  return (
    <Page wide title="דוחות" back="/pms">
      <nav className="rp-tabs" aria-label="אזורי דוחות">
        <span className="rp-tab is-on" aria-current="page">כל הדוחות</span>
        <Link className="rp-tab" to="/pms/reports/subscriptions">מנויים</Link>
      </nav>
      <Card title="כל הדוחות" actions={data ? <span className="ui-sub">{total} דוחות</span> : null}>
        <label className="rp-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">חיפוש דוח</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש דוח" />
        </label>
        <ErrorBanner error={error} onRetry={reload} />
        {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
        {data && !groups.length && <div className="ui-empty">לא נמצא דוח בשם הזה</div>}
        <div className="rp-columns">
          {groups.map((g) => (
            <section key={g.name} className="rp-group" aria-label={g.name}>
              <h2 className="rp-group-title">{g.name}</h2>
              <ul>
                {g.items.map((r) => (
                  <li key={r.key}><Link to={r.to} title={r.description || undefined}>{r.name}</Link></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Card>
    </Page>
  );
}
