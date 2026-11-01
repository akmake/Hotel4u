// One report — copied from the Cloudbeds report view: the title with its actions (Excel, CSV,
// print, subscribe), the period, a "summary information" strip, and the table with a totals row.
// Every report of the report centre opens here (server: services/reportCenter.js).
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Download, Printer, Mail, ArrowUp, ArrowDown } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { reportCenter } from '../../utils/api';
import { Page, Card, Spinner, ErrorBanner, useLoader } from '../../components/kit';
import './reports.css';

const PRESETS = {
  range: [['yesterday', 'אתמול'], ['last7', '7 ימים'], ['last30', '30 ימים'], ['mtd', 'החודש'], ['lastMonth', 'חודש קודם'], ['last90', '90 ימים'], ['ytd', 'מתחילת השנה']],
  month: [['lastMonth', 'חודש קודם'], ['mtd', 'החודש']],
  ahead: [['next7', '7 ימים'], ['next30', '30 ימים'], ['next90', '90 ימים']],
};

function fmt(v, type) {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'money') return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
  if (type === 'pct') return `${Number(v).toLocaleString('he-IL', { maximumFractionDigits: 1 })}%`;
  if (type === 'int') return Number(v).toLocaleString('he-IL', { maximumFractionDigits: 2 });
  if (type === 'date') return String(v).split('-').reverse().join('.');
  if (type === 'datetime') return new Date(v).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  return String(v);
}
const dmy = (s) => (s ? s.split('-').reverse().join('.') : '');

export default function ReportViewPage() {
  const { code } = useParams();
  const { propertyId } = useProperty();
  const [sp, setSp] = useSearchParams();
  const params = { preset: sp.get('preset') || undefined, from: sp.get('from') || undefined, to: sp.get('to') || undefined };
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? reportCenter.run(propertyId, code, params) : null), [propertyId, code, sp.toString()]);
  const [sort, setSort] = useState(null); // { key, dir }
  const [busy, setBusy] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [draft, setDraft] = useState({ from: '', to: '' });

  const rows = useMemo(() => {
    if (!data) return [];
    if (!sort) return data.rows;
    const col = data.columns.find((c) => c.key === sort.key);
    const numeric = col && ['int', 'money', 'pct'].includes(col.type);
    return [...data.rows].sort((a, b) => {
      const x = a[sort.key]; const y = b[sort.key];
      const c = numeric ? (Number(x ?? -Infinity) - Number(y ?? -Infinity)) : String(x ?? '').localeCompare(String(y ?? ''), 'he', { numeric: true });
      return sort.dir === 'asc' ? c : -c;
    });
  }, [data, sort]);
  const totals = useMemo(() => {
    if (!data || !data.columns.some((c) => c.total)) return null;
    return data.columns.map((c) => (c.total === 'sum' ? data.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0) : null));
  }, [data]);

  const setPeriod = (patch) => { const next = new URLSearchParams(); Object.entries(patch).forEach(([k, v]) => v && next.set(k, v)); setSp(next, { replace: true }); setSort(null); };
  async function download(format) {
    setBusy(format); setFileError(null);
    try { await reportCenter.download(propertyId, code, data?.period ? { from: data.period.from, to: data.period.to } : params, format); } catch (e) { setFileError(e.message); } finally { setBusy(null); }
  }
  const presets = data ? PRESETS[data.periodType] || [] : [];
  const activePreset = !sp.get('from') && (sp.get('preset') || data?.period?.preset);
  const periodLabel = data ? (data.periodType === 'none' ? `נכון ל־${dmy(data.period.from)}` : data.period.from === data.period.to ? dmy(data.period.from) : `${dmy(data.period.from)} – ${dmy(data.period.to)}`) : '';
  const numeric = (c) => ['int', 'money', 'pct'].includes(c.type);

  return (
    <Page
      wide
      title={data?.name || 'דוח'}
      back="/pms/reports"
      meta={data ? `${data.group} · ${periodLabel}` : undefined}
      tools={data && (
        <div className="rp-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => download('xlsx')} disabled={!!busy}>{busy === 'xlsx' ? <Spinner /> : <Download size={14} />} Excel</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => download('csv')} disabled={!!busy}>{busy === 'csv' ? <Spinner /> : <Download size={14} />} CSV</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}><Printer size={14} /> הדפסה</button>
          <Link className="btn btn-secondary btn-sm" to="/pms/reports/subscriptions"><Mail size={14} /> מנוי במייל</Link>
        </div>
      )}
    >
      {data?.description && <p className="rp-desc">{data.description}</p>}
      <ErrorBanner error={error || fileError} onRetry={error ? reload : undefined} />

      {data && data.periodType !== 'none' && (
        <div className="rp-period" role="group" aria-label="תקופה">
          {presets.map(([k, label]) => (
            <button key={k} type="button" className={`rp-chip ${activePreset === k ? 'is-on' : ''}`} aria-pressed={activePreset === k} onClick={() => setPeriod({ preset: k })}>{label}</button>
          ))}
          {data.periodType !== 'month' && (
            <form className="rp-custom" onSubmit={(e) => { e.preventDefault(); if (draft.from && draft.to) setPeriod({ from: draft.from, to: draft.to }); }}>
              <label><span className="sr-only">מתאריך</span><input type="date" className="input" value={draft.from || data.period.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value, to: d.to || data.period.to }))} /></label>
              <span aria-hidden="true">–</span>
              <label><span className="sr-only">עד תאריך</span><input type="date" className="input" value={draft.to || data.period.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value, from: d.from || data.period.from }))} /></label>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={!draft.from && !draft.to}>הצגה</button>
            </form>
          )}
          {data.periodType === 'month' && (
            <label className="rp-custom"><span className="sr-only">חודש</span>
              <input type="month" className="input" value={data.period.from.slice(0, 7)} onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); if (!y) return; const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); setPeriod({ from: `${e.target.value}-01`, to: last }); }} />
            </label>
          )}
        </div>
      )}

      {loading && !data && <Card><div className="ui-empty"><Spinner /> מפיק את הדוח…</div></Card>}

      {data && (
        <section className="rp-panel" aria-label="תוצאות הדוח">
          <div className="rp-summary" aria-label="סיכום">
            {data.summary.map((s) => (
              <div key={s.label} className="rp-kpi"><span>{s.label}</span><b className="ui-num">{fmt(s.value, s.type)}</b></div>
            ))}
            <div className="rp-kpi"><span>שורות</span><b className="ui-num">{data.rows.length}</b></div>
          </div>
          <div className="rp-table-wrap" aria-busy={loading}>
            <table className="rp-table">
              <thead>
                <tr>
                  {data.columns.map((c) => {
                    const on = sort?.key === c.key;
                    return (
                      <th key={c.key} scope="col" className={numeric(c) ? 'is-num' : ''} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="rp-sort" onClick={() => setSort(on ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: numeric(c) ? 'desc' : 'asc' })}>
                          {c.label}{on && (sort.dir === 'asc' ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {!rows.length && <tr><td colSpan={data.columns.length}><div className="ui-empty">אין נתונים לתקופה הזו</div></td></tr>}
                {rows.map((r, i) => (
                  <tr key={i}>
                    {data.columns.map((c, j) => <td key={c.key} className={`${numeric(c) ? 'is-num ui-num' : ''} ${j === 0 ? 'is-first' : ''}`}>{c.type === 'ltr' ? <bdi dir="ltr">{fmt(r[c.key], 'text')}</bdi> : fmt(r[c.key], c.type)}</td>)}
                  </tr>
                ))}
              </tbody>
              {totals && rows.length > 0 && (
                <tfoot>
                  <tr>
                    {data.columns.map((c, j) => <td key={c.key} className={numeric(c) ? 'is-num ui-num' : ''}>{j === 0 ? 'סה״כ' : totals[j] === null ? '' : fmt(Math.round(totals[j] * 100) / 100, c.type)}</td>)}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {data.note && <p className="rp-note">{data.note}</p>}
        </section>
      )}
    </Page>
  );
}

