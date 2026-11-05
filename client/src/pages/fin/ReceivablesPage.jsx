// Receivables / city ledger (G5 + gap-map item 7): accounts with aging, the holding bin, debt search,
// traces across accounts, batch statements and reminders, batch charge, and the daily checklist.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance, booking } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import ChargeCodeSelect from '../../components/fin/ChargeCodeSelect';
import { Page, Card, Tiles, Empty, ErrorBanner, Spinner, Modal, Field, Tag, Banner, Segmented, SearchBox, useLoader, useAction, useUrlState, money, newOpKey } from '../../components/kit';
import { ArTransferDialog, AR_WORK_ROLES, AR_MANAGE_ROLES, he } from '../../components/fin/ArDialogs';

const URL_DEFAULTS = { tab: 'accounts' };
const BUCKET_LABEL = { b0: 'עד 30', b30: '31–60', b60: '61–90', b90: 'מעל 90' };

export default function ReceivablesPage() {
  const { propertyId } = useProperty();
  const nav = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canWork = AR_WORK_ROLES.includes(role);
  const canManage = AR_MANAGE_ROLES.includes(role);
  const { toasts, success } = useToast();
  const url = useUrlState(URL_DEFAULTS);
  const tab = url.get('tab');
  const setSt = url.set;
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.receivables(propertyId) : null), [propertyId]);
  const [dlg, setDlg] = useState(null);
  const t = data?.totals;
  const binItems = (data?.rows || []).flatMap((r) => r.items.filter((i) => i.status === 'bin').map((i) => ({ ...i, companyId: r.companyId, companyName: r.name })));
  const changed = (msg) => { setDlg(null); success(msg); reload(); };
  return (
    <Page wide title="חייבים" back="/pms" meta={data ? `יום עסקי ${he(data.today)}` : ''}
      tools={data && <>
        {canManage && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDlg('mass')}>חיוב מרוכז</button>}
        {canManage && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDlg('policy')}>הגדרות</button>}
      </>}
      primary={canManage && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg('open')}>פתיחת חשבון חייבים</button>}>
      <ToastContainer toasts={toasts} />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && (
        <>
          <Tiles label="גיול חובות" items={[
            { id: 'total', label: 'יתרה לגבייה', value: money(t.total), static: true },
            { id: 'overdue', label: 'באיחור', value: money(t.overdue), tone: t.overdue > 0 ? 'bad' : undefined, static: true },
            { id: 'bin', label: 'בסל ביניים', value: t.binCount ? `${t.binCount} · ${money(t.bin)}` : '—', tone: t.binCount ? 'warn' : undefined, static: true },
            { id: 'unapplied', label: 'על החשבון (לא שויך)', value: money(t.unapplied), static: true },
            { id: 'b90', label: 'מעל 90 יום', value: money(t.b90), tone: t.b90 > 0 ? 'bad' : undefined, static: true },
            { id: 'inHouse', label: 'בשהייה', value: money(t.inHouse), static: true },
          ]} />
          <Segmented label="אזור" value={tab} onChange={(v) => setSt({ tab: v })} options={[
            { value: 'accounts', label: 'חשבונות', count: data.rows.length },
            { value: 'bin', label: 'סל ביניים', count: binItems.length || null },
            { value: 'search', label: 'חיפוש חובות' },
            { value: 'traces', label: 'משימות' },
            { value: 'statements', label: 'דפי חשבון' },
            { value: 'reminders', label: 'תזכורות' },
            { value: 'checklist', label: 'בדיקה יומית' },
          ]} />
          {tab === 'accounts' && <AccountsTab data={data} onOpen={(id) => nav(`/pms/fin/receivables/${id}`)} />}
          {tab === 'bin' && <BinTab items={binItems} holdBin={data.holdBin} propertyId={propertyId} canWork={canWork} canManage={canManage} onChanged={changed} />}
          {tab === 'search' && <SearchTab propertyId={propertyId} />}
          {tab === 'traces' && <TracesTab propertyId={propertyId} canWork={canWork} />}
          {(tab === 'statements' || tab === 'reminders') && <LettersTab kind={tab === 'reminders' ? 'reminder' : 'statement'} propertyId={propertyId} canWork={canWork} cycles={data.config.cycles} types={data.config.types} onSent={(out, via) => { if (via === 'print' && out.letters.length) nav(`/pms/fin/receivables/print?letters=${out.letters.map((l) => l.id).join(',')}`); else success(`נשלחו ${out.letters.length}${out.failed.length ? `, לא נשלחו ${out.failed.length}` : ''}`); }} />}
          {tab === 'checklist' && <ChecklistTab propertyId={propertyId} onTab={(v) => setSt({ tab: v })} />}
        </>
      )}
      <OpenAccountDialog open={dlg === 'open'} propertyId={propertyId} onClose={() => setDlg(null)} onDone={(id) => { setDlg(null); nav(`/pms/fin/receivables/${id}`); }} />
      <MassChargeDialog open={dlg === 'mass'} propertyId={propertyId} types={data?.config?.types} onClose={() => setDlg(null)} onDone={(out) => changed(`נפתחו ${out.created.length} חובות${out.skipped.length ? ` · ${out.skipped.length} דולגו (${out.skipped.map((s) => s.name).join(', ')})` : ''}`)} />
      <PolicyDialog open={dlg === 'policy'} propertyId={propertyId} holdBin={data?.holdBin} limit={data?.writeOffApprovalOver} onClose={() => setDlg(null)} onDone={() => changed('ההגדרות נשמרו')} />
    </Page>
  );
}

function AccountsTab({ data, onOpen }) {
  if (!data.rows.length) return <Card><Empty title="אין חשבונות חייבים">חשבון נפתח מכרטיס החברה או מכפתור "פתיחת חשבון חייבים". חברות עם יתרה מיציאה יופיעו כאן גם בלי חשבון.</Empty></Card>;
  return (
    <Card flush>
      <div className="ui-table-wrap ar-table is-tall">
        <table className="ui-table">
          <thead><tr><th scope="col">חשבון</th><th scope="col">יתרה</th><th scope="col">באיחור</th>{Object.values(BUCKET_LABEL).map((l) => <th key={l} scope="col">{l}</th>)}<th scope="col">על החשבון</th><th scope="col">מסגרת</th><th scope="col">תנאים</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.companyId} className="is-clickable" onClick={() => onOpen(r.companyId)}>
                <th scope="row"><Link className="ui-link" to={`/pms/fin/receivables/${r.companyId}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                  <div className="ui-sub">{r.number || 'ללא חשבון חייבים'}{r.restricted && <> · <Tag tone="bad">מוגבל</Tag></>}{r.binCount > 0 && <> · <Tag tone="warn">{r.binCount} בסל</Tag></>}{r.inHouse > 0 && <> · בשהייה {money(r.inHouse)}</>}</div></th>
                <td className="ui-amount"><b>{money(r.total)}</b></td>
                <td className="ui-amount">{r.overdue ? <span className="ar-bad">{money(r.overdue)}</span> : <span className="ui-sub">—</span>}</td>
                {Object.keys(BUCKET_LABEL).map((k) => <td key={k} className="ui-amount">{r[k] ? money(r[k]) : <span className="ui-sub">—</span>}</td>)}
                <td className="ui-amount">{r.unapplied ? money(r.unapplied) : <span className="ui-sub">—</span>}</td>
                <td>{r.creditLimit ? <>{money(r.creditLimit)} {r.overLimit && <Tag tone="bad">חריגה</Tag>}</> : <span className="ui-sub">—</span>}</td>
                <td>{r.termsLabel}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th scope="row">סה״כ</th><td className="ui-amount"><b>{money(data.totals.total)}</b></td><td className="ui-amount">{money(data.totals.overdue)}</td>{Object.keys(BUCKET_LABEL).map((k) => <td key={k} className="ui-amount">{money(data.totals[k])}</td>)}<td className="ui-amount">{money(data.totals.unapplied)}</td><td colSpan={2} /></tr></tfoot>
        </table>
      </div>
    </Card>
  );
}

function BinTab({ items, holdBin, propertyId, canWork, canManage, onChanged }) {
  const [sel, setSel] = useState([]);
  const [move, setMove] = useState(null);
  const action = useAction();
  useEffect(() => { setSel((p) => p.filter((id) => items.some((i) => i.folioId === id))); }, [items]);
  return (
    <Card flush title={`סל ביניים — ${items.length} חובות`} actions={canWork && items.length > 0 && <>
      <button type="button" className="btn btn-secondary btn-sm" disabled={!sel.length || action.busy} onClick={() => action.run(async () => { const out = await finance.arApproveBin(propertyId, sel); setSel([]); onChanged(`נכנסו לחשבונות ${out.entered.length} חובות`); })}>אישור הנבחרים ({sel.length})</button>
      <button type="button" className="btn btn-primary btn-sm" disabled={action.busy} onClick={() => action.run(async () => { const out = await finance.arApproveBin(propertyId); onChanged(`נכנסו לחשבונות ${out.entered.length} חובות`); })}>אישור הכול</button>
    </>}>
      <ErrorBanner error={action.error} />
      <div className="ar-strip">{holdBin ? 'יציאות לחשבון חברה מחכות כאן עד שהנהלת החשבונות בודקת שכל חוב רשום על החברה הנכונה ומאשרת. רק אז החוב מקבל מספר ותאריך יעד.' : 'הסל כבוי: חובות נכנסים לחשבונות אוטומטית בסגירת היום.'}</div>
      {!items.length ? <Empty title="הסל ריק">אין חובות שמחכים לאישור.</Empty> : (
        <div className="ui-table-wrap ar-table">
          <table className="ui-table">
            <thead><tr><th scope="col" className="ar-chk"><input type="checkbox" aria-label="בחירת הכול" checked={sel.length === items.length} onChange={(e) => setSel(e.target.checked ? items.map((i) => i.folioId) : [])} /></th><th scope="col">חברה</th><th scope="col">הזמנה</th><th scope="col">אורח</th><th scope="col">עזב</th><th scope="col">יתרה</th><th scope="col"><span className="sr-only">פעולות</span></th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.folioId}>
                  <td className="ar-chk"><input type="checkbox" aria-label={`בחירת ${i.confirmationNumber || ''}`} checked={sel.includes(i.folioId)} onChange={(e) => setSel((p) => (e.target.checked ? [...p, i.folioId] : p.filter((x) => x !== i.folioId)))} /></td>
                  <td><Link className="ui-link" to={`/pms/fin/receivables/${i.companyId}`}>{i.companyName}</Link></td>
                  <td>{i.reservationId ? <Link className="ui-link" to={`/pms/folio?reservation=${i.reservationId}&folio=${i.folioId}`}>{i.confirmationNumber}</Link> : i.confirmationNumber}</td>
                  <td>{i.guest || '—'}</td>
                  <td>{he(i.departureDate)}</td>
                  <td className="ui-amount"><b>{money(i.balance)}</b></td>
                  <td className="ui-row-actions">{canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMove(i)}>חברה אחרת</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ArTransferDialog open={!!move} debt={move} fromName={move?.companyName} propertyId={propertyId} onClose={() => setMove(null)} onDone={(out) => { setMove(null); onChanged(`הועבר — חוב ${out.number}`); }} />
    </Card>
  );
}

function SearchTab({ propertyId }) {
  const [f, setF] = useState({ q: '', status: 'open', from: '', to: '' });
  const { data, loading, error } = useLoader(async () => (propertyId ? finance.arSearch(propertyId, { q: f.q || undefined, status: f.status, from: f.from || undefined, to: f.to || undefined }) : null), [propertyId, f.q, f.status, f.from, f.to]);
  return (
    <Card flush title="חיפוש חובות" actions={<>
      <SearchBox id="ar-search" value={f.q} onCommit={(q) => setF((p) => ({ ...p, q }))} placeholder="מספר חוב, הזמנה, אורח, חברה" />
      <Segmented label="מצב" value={f.status} onChange={(status) => setF((p) => ({ ...p, status }))} options={[{ value: 'open', label: 'פתוחים' }, { value: 'all', label: 'כולל סגורים' }]} />
      <input type="date" className="input" aria-label="מתאריך" value={f.from} onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))} />
      <input type="date" className="input" aria-label="עד תאריך" value={f.to} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))} />
    </>}>
      <ErrorBanner error={error} />
      {loading && !data && <div className="ui-empty"><Spinner /></div>}
      {data && !data.length && <Empty title="לא נמצאו חובות">אפשר לחפש לפי מספר חוב, מספר הזמנה, שם אורח או שם חברה.</Empty>}
      {data?.length > 0 && (
        <div className="ui-table-wrap ar-table">
          <table className="ui-table">
            <thead><tr><th scope="col">חוב</th><th scope="col">חברה</th><th scope="col">תאריך</th><th scope="col">אורח</th><th scope="col">יתרה</th><th scope="col">לתשלום עד</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.folioId}>
                  <th scope="row">{d.number || d.confirmationNumber || '—'}{d.status === 'bin' && <> <Tag tone="warn">בסל</Tag></>}{d.status === 'moved' && <> <Tag>הועבר</Tag></>}</th>
                  <td><Link className="ui-link" to={`/pms/fin/receivables/${d.companyId}`}>{d.companyName}</Link></td>
                  <td>{he(d.since)}</td>
                  <td>{d.guest || '—'}</td>
                  <td className="ui-amount">{money(d.balance)}</td>
                  <td>{he(d.dueDate)}{d.overdueDays > 0 && <> <Tag tone="bad">{d.overdueDays} ימים</Tag></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TracesTab({ propertyId, canWork }) {
  const [view, setView] = useState('open');
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.arTraces(propertyId, view) : null), [propertyId, view]);
  return (
    <Card flush title="משימות בכל החשבונות" actions={<Segmented label="תצוגה" value={view} onChange={setView} options={[{ value: 'open', label: 'פתוחות' }, { value: 'all', label: 'כולן' }]} />}>
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /></div>}
      {data && !data.length && <Empty title="אין משימות פתוחות">משימה נוספת מתוך החשבון (לשונית "משימות").</Empty>}
      {data?.length > 0 && (
        <div className="ui-table-wrap ar-table">
          <table className="ui-table">
            <thead><tr><th scope="col">טופל</th><th scope="col">עד</th><th scope="col">חשבון</th><th scope="col">משימה</th><th scope="col">נפתחה ע״י</th></tr></thead>
            <tbody>
              {data.map((n) => (
                <tr key={n.id} className={n.done ? 'is-muted' : ''}>
                  <td><input type="checkbox" aria-label="טופל" disabled={!canWork} checked={n.done} onChange={async (e) => { await finance.arTraceDone(propertyId, n.id, e.target.checked); reload(); }} /></td>
                  <td>{he(n.dueDate)}</td>
                  <td><Link className="ui-link" to={`/pms/fin/receivables/${n.companyId}`}>{n.companyName}</Link></td>
                  <td>{n.text}</td>
                  <td>{n.byName}{n.done ? <div className="ui-sub">טופל ע״י {n.doneByName}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LettersTab({ kind, propertyId, canWork, cycles, types, onSent }) {
  const [minBalance, setMin] = useState('0');
  const [type, setType] = useState('all');
  const [sel, setSel] = useState([]);
  const [opts, setOpts] = useState({ text: '', withCopies: false });
  const action = useAction();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.arCandidates(propertyId, { kind, minBalance: kind === 'statement' ? minBalance : undefined, type }) : null), [propertyId, kind, minBalance, type]);
  useEffect(() => { if (data) setSel(data.filter((x) => kind === 'reminder' || !x.printed).map((x) => x.companyId)); }, [data, kind]);
  const send = (via) => action.run(async () => { const out = await finance.arSendLetters(propertyId, { kind, companyIds: sel, via, text: opts.text || undefined, withCopies: opts.withCopies }); reload(); onSent(out, via); });
  return (
    <Card flush title={kind === 'reminder' ? 'תזכורות לפי מחזור הגיול' : 'דפי חשבון מרוכזים'} actions={<>
      {kind === 'statement' && <label className="ar-inline">יתרה מ־<input className="input" inputMode="decimal" aria-label="יתרה מינימלית" value={minBalance} onChange={(e) => setMin(e.target.value)} /></label>}
      <select className="input" aria-label="סוג חשבון" value={type} onChange={(e) => setType(e.target.value)}><option value="all">כל הסוגים</option>{Object.entries(types || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {canWork && <button type="button" className="btn btn-secondary btn-sm" disabled={!sel.length || action.busy} onClick={() => send('email')}>שליחה בדוא״ל ({sel.length})</button>}
      {canWork && <button type="button" className="btn btn-primary btn-sm" disabled={!sel.length || action.busy} onClick={() => send('print')}>הפקה והדפסה ({sel.length})</button>}
    </>}>
      <ErrorBanner error={error || action.error} onRetry={reload} />
      <div className="ar-strip">
        {kind === 'reminder'
          ? <>תזכורת נוצרת לפי ימי האיחור וסוג החשבון ({Object.entries(cycles || {}).map(([k, v]) => `${types?.[k] || k}: ${v.join('/')} ימים`).join(' · ')}). תזכורת שנשלחה לא מוצעת שוב עד השלב הבא.</>
          : <>חשבונות שמסומנים "כלול בדפי חשבון מרוכזים" עם יתרה. מסומן "נשלח" — כבר הופק דף החודש.</>}
        <span className="ar-strip-acts">
          <input className="input" aria-label="שורת טקסט" placeholder="שורת טקסט (רשות)" maxLength={300} value={opts.text} onChange={(e) => setOpts((p) => ({ ...p, text: e.target.value }))} />
          {kind === 'statement' && <label className="ui-check"><input type="checkbox" checked={opts.withCopies} onChange={(e) => setOpts((p) => ({ ...p, withCopies: e.target.checked }))} /> עם פירוט</label>}
        </span>
      </div>
      {loading && !data && <div className="ui-empty"><Spinner /></div>}
      {data && !data.length && <Empty title={kind === 'reminder' ? 'אין תזכורות לשלוח' : 'אין חשבונות לדף חשבון'}>{kind === 'reminder' ? 'אין חשבונות באיחור שהגיע זמן התזכורת שלהם.' : 'אין חשבונות עם יתרה מעל המינימום.'}</Empty>}
      {data?.length > 0 && (
        <div className="ui-table-wrap ar-table">
          <table className="ui-table">
            <thead><tr><th scope="col" className="ar-chk"><input type="checkbox" aria-label="בחירת הכול" checked={sel.length === data.length} onChange={(e) => setSel(e.target.checked ? data.map((x) => x.companyId) : [])} /></th><th scope="col">חשבון</th><th scope="col">יתרה</th><th scope="col">באיחור</th>{kind === 'reminder' ? <><th scope="col">שלב</th><th scope="col">ימי איחור</th></> : <th scope="col">נשלח לאחרונה</th>}<th scope="col">דוא״ל</th></tr></thead>
            <tbody>
              {data.map((x) => (
                <tr key={x.companyId}>
                  <td className="ar-chk"><input type="checkbox" aria-label={`בחירת ${x.name}`} checked={sel.includes(x.companyId)} onChange={(e) => setSel((p) => (e.target.checked ? [...p, x.companyId] : p.filter((y) => y !== x.companyId)))} /></td>
                  <th scope="row"><Link className="ui-link" to={`/pms/fin/receivables/${x.companyId}`}>{x.name}</Link><div className="ui-sub">{x.number}</div></th>
                  <td className="ui-amount">{money(x.balance)}</td>
                  <td className="ui-amount">{x.overdue ? money(x.overdue) : '—'}</td>
                  {kind === 'reminder' ? <><td><Tag tone={x.level >= 3 ? 'bad' : 'warn'}>תזכורת {x.level}</Tag></td><td>{x.daysPast}</td></> : <td>{x.lastAt ? <>{he(x.lastAt)} {x.printed && <Tag tone="ok">נשלח</Tag>}</> : <span className="ui-sub">לא נשלח</span>}</td>}
                  <td>{x.email || <span className="ui-sub">אין</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ChecklistTab({ propertyId, onTab }) {
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.arChecklist(propertyId) : null), [propertyId]);
  if (loading && !data) return <div className="ui-empty"><Spinner /></div>;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;
  const item = (ok, title, body, tab) => (
    <li className={`ar-check ${ok ? 'is-ok' : 'is-todo'}`}>
      <span className="ar-check-dot" aria-hidden="true" />
      <div><b>{title}</b>{body && <div className="ui-sub">{body}</div>}</div>
      {tab && !ok && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onTab(tab)}>לטיפול</button>}
    </li>
  );
  return (
    <div className="ui-grid-2 ar-checklist">
      <Card title={`שגרה יומית — ${he(data.today)}`}>
        <ul className="ar-checks-list">
          {item(!data.bin.count, data.bin.count ? `${data.bin.count} חובות בסל (${money(data.bin.total)})` : 'הסל ריק', data.bin.holdBin ? 'לבדוק שכל חוב רשום על החברה הנכונה ולאשר' : 'הסל כבוי — נכנס אוטומטית בסגירת היום', 'bin')}
          {item(!data.unapplied.length, data.unapplied.length ? `תשלומים על החשבון שלא שויכו: ${money(data.unapplied.reduce((s, u) => s + u.amount, 0))}` : 'כל התשלומים משויכים', data.unapplied.map((u) => u.name).join(' · '))}
          {item(!data.traces.length, data.traces.length ? `${data.traces.length} משימות שהגיע זמנן` : 'אין משימות פתוחות להיום', data.traces.slice(0, 3).map((n) => `${n.companyName}: ${n.text}`).join(' · '), 'traces')}
          {item(!data.reminders, data.reminders ? `${data.reminders} תזכורות לשלוח` : 'אין תזכורות לשלוח', null, 'reminders')}
          {item(!data.statements, data.statements ? `${data.statements} דפי חשבון שעוד לא נשלחו החודש` : 'דפי החשבון של החודש נשלחו', null, 'statements')}
          {item(!data.overLimit.length, data.overLimit.length ? `${data.overLimit.length} חשבונות בחריגה ממסגרת` : 'אין חריגות ממסגרת', data.overLimit.map((o) => `${o.name} ${money(o.debts)}/${money(o.creditLimit)}`).join(' · '))}
          {item(!data.restrictedWithBalance.length, data.restrictedWithBalance.length ? `${data.restrictedWithBalance.length} חשבונות מוגבלים עם יתרה` : 'אין חשבונות מוגבלים עם יתרה', data.restrictedWithBalance.map((o) => o.name).join(' · '))}
          {item(true, `${data.enteredToday} חובות ישירים / קבועים / מרוכזים נפתחו היום`)}
        </ul>
      </Card>
      <Card flush title={`הגעות היום ומחר עם חיוב לחברה (${data.arrivals.length})`}>
        {!data.arrivals.length ? <Empty title="אין הגעות עם Voucher לחברה">הזמנות שהחברה או הסוכן משלמים בהן יופיעו כאן, כדי לוודא שהחשבון מוכן.</Empty> : (
          <div className="ui-table-wrap ar-table">
            <table className="ui-table">
              <thead><tr><th scope="col">הזמנה</th><th scope="col">מגיע</th><th scope="col">משלם</th><th scope="col">בדיקה</th></tr></thead>
              <tbody>
                {data.arrivals.map((r) => (
                  <tr key={r.reservationId}>
                    <th scope="row"><Link className="ui-link" to={`/pms/reservations/${r.reservationId}`}>{r.confirmationNumber}</Link><div className="ui-sub">{r.guest}</div></th>
                    <td>{he(r.arrivalDate)}</td>
                    <td>{r.payer}</td>
                    <td>{r.warn ? <Tag tone="bad">{r.warn}</Tag> : <Tag tone="ok">תקין</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function OpenAccountDialog({ open, propertyId, onClose, onDone }) {
  const action = useAction();
  const [cos, setCos] = useState([]);
  const [id, setId] = useState('');
  useEffect(() => { if (open) { setId(''); action.reset(); booking.companies(propertyId).then((r) => setCos(Array.isArray(r) ? r : r?.rows || [])).catch(() => setCos([])); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={460} title="פתיחת חשבון חייבים" subtitle="בוחרים חברה; את התנאים והמסגרת קובעים במסך החשבון"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button><button type="button" className="btn btn-primary" disabled={!id || action.busy} onClick={() => action.run(async () => { await finance.arSaveAccount(propertyId, id, { active: true }); onDone(id); })}>{action.busy ? <Spinner /> : 'פתיחה'}</button></>}>
      <ErrorBanner error={action.error} />
      <Field id="oa-co" label="חברה / סוכן" required><select id="oa-co" className="input w-full" value={id} onChange={(e) => setId(e.target.value)}><option value="">בחירה…</option>{cos.map((c) => <option key={c._id || c.id} value={c._id || c.id}>{c.name}</option>)}</select></Field>
    </Modal>
  );
}

function MassChargeDialog({ open, propertyId, types, onClose, onDone }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [key, setKey] = useState('');
  useEffect(() => { if (open) { setF({ code: null, amount: '', description: '', type: 'all', overrideLimit: false }); setKey(newOpKey()); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title="חיוב מרוכז לחשבונות" subtitle="אותו קוד ואותו סכום — חוב חדש בכל חשבון פעיל שאינו מוגבל"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button><button type="button" className="btn btn-primary" disabled={!f.code || !(Number(f.amount) > 0) || action.busy} onClick={() => action.run(async () => onDone(await finance.arMassCharge(propertyId, { code: f.code.code, amount: Number(f.amount), description: f.description || undefined, type: f.type, overrideLimit: f.overrideLimit, idempotencyKey: key })))}>{action.busy ? <Spinner /> : 'חיוב'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={action.error} />
        <div className="ui-grid-2">
          <Field id="mc-code" label="קוד חיוב" required><ChargeCodeSelect id="mc-code" propertyId={propertyId} value={f.code?.code} onChange={(code) => setF((p) => ({ ...p, code, description: p.description || code?.name || '' }))} /></Field>
          <Field id="mc-amount" label="סכום לכל חשבון" required><input id="mc-amount" className="input w-full" inputMode="decimal" value={f.amount || ''} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} /></Field>
        </div>
        <div className="ui-grid-2">
          <Field id="mc-desc" label="תיאור" optional><input id="mc-desc" className="input w-full" maxLength={200} value={f.description || ''} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} /></Field>
          <Field id="mc-type" label="סוג חשבון"><select id="mc-type" className="input w-full" value={f.type} onChange={(e) => setF((p) => ({ ...p, type: e.target.value }))}><option value="all">כל החשבונות</option>{Object.entries(types || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <label className="ui-check"><input type="checkbox" checked={!!f.overrideLimit} onChange={(e) => setF((p) => ({ ...p, overrideLimit: e.target.checked }))} /> לחייב גם חשבונות שיעברו את מסגרת האשראי</label>
      </div>
    </Modal>
  );
}

function PolicyDialog({ open, propertyId, holdBin, limit, onClose, onDone }) {
  const action = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ holdBin: holdBin !== false, writeOffApprovalOver: String(limit ?? 0) }); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={480} title="הגדרות חייבים"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button><button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => action.run(async () => { await finance.arPolicy(propertyId, { holdBin: f.holdBin, writeOffApprovalOver: Number(f.writeOffApprovalOver) || 0 }); onDone(); })}>{action.busy ? <Spinner /> : 'שמירה'}</button></>}>
      <div className="ui-stack">
        <ErrorBanner error={action.error} />
        <label className="ui-check"><input type="checkbox" checked={!!f.holdBin} onChange={(e) => setF((p) => ({ ...p, holdBin: e.target.checked }))} /> סל ביניים: חובות מיציאה מחכים לאישור הנהלת החשבונות</label>
        <p className="ui-sub">כבוי — החובות נכנסים לחשבונות אוטומטית בסגירת היום.</p>
        <Field id="pol-wo" label="התאמה / מחיקת חוב בלי אישור — עד סכום" hint="מעל הסכום: כספים או מנהל כללי. 0 = תמיד באישור"><input id="pol-wo" className="input w-full" inputMode="decimal" value={f.writeOffApprovalOver || ''} onChange={(e) => setF((p) => ({ ...p, writeOffApprovalOver: e.target.value }))} /></Field>
        <Banner tone="info">חיוב קבוע נרשם בסגירת היום. כרטיסי אשראי כחייב תלויים בבחירת חברת הסליקה.</Banner>
      </div>
    </Modal>
  );
}
