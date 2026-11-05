// One receivables account (gap-map item 7): debts with numbers and due dates, payments and where they sit,
// actions on a debt (detail, extra charge, adjustment / write-off, transfer, consolidation and its undo),
// money on account, notes & traces, year view, future bookings, letters sent and recurring charges.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance } from '../../utils/api';
import { PAY_METHOD_LABELS } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import ChargeCodeSelect from '../../components/fin/ChargeCodeSelect';
import { Page, Card, Tiles, Empty, ErrorBanner, Spinner, Banner, Tag, Segmented, SearchBox, RowMenu, Drawer, ConfirmDialog, Field, useLoader, useAction, money, newOpKey } from '../../components/kit';
import { ArPayDialog, ArAllocateDialog, ArChargeDialog, ArAdjustDialog, ArTransferDialog, ArAccountDialog, ArLetterDialog, AR_WORK_ROLES, AR_MANAGE_ROLES, he } from '../../components/fin/ArDialogs';

const STATUS = { open: ['פתוח', null], bin: ['בסל', 'warn'], inHouse: ['בשהייה', 'info'], paid: ['שולם', 'ok'], credit: ['זכות', 'info'], moved: ['הועבר', null] };
const ORIGIN = { stay: 'שהייה', direct: 'ישיר', transfer: 'הועבר', consolidated: 'מאוחד', recurring: 'קבוע', mass: 'מרוכז' };

export default function ArAccountPage() {
  const { companyId } = useParams();
  const nav = useNavigate();
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canWork = AR_WORK_ROLES.includes(role);
  const canManage = AR_MANAGE_ROLES.includes(role);
  const { toasts, success } = useToast();
  const [view, setView] = useState('open');
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.arAccount(propertyId, companyId, { view, q }) : null), [propertyId, companyId, view, q]);
  const [sel, setSel] = useState([]);
  const [dlg, setDlg] = useState(null); // { kind, debt? }
  const close = () => setDlg(null);
  const done = (msg) => () => { setDlg(null); setSel([]); success(msg); reload(); };
  const a = data?.account;
  const s = data?.summary;
  const debts = data?.debts || [];
  const selectable = (d) => d.status === 'open' && d.balance > 0.005;
  const allOpen = useMemo(() => debts.filter(selectable).map((d) => d.folioId), [debts]);

  const menu = (d) => [
    { label: 'פירוט החוב', onSelect: () => setDlg({ kind: 'detail', debt: d }) },
    d.reservationId && { label: 'תיק ההזמנה', onSelect: () => nav(`/pms/reservations/${d.reservationId}`) },
    { separator: true },
    { label: 'חיוב נוסף', hidden: !canWork || d.status === 'moved', disabled: a?.restricted, why: 'חשבון מוגבל', onSelect: () => setDlg({ kind: 'charge', debt: d }) },
    { label: 'התאמה / מחיקת חוב', hidden: !canWork || !(d.balance > 0.005), onSelect: () => setDlg({ kind: 'adjust', debt: d }) },
    { label: 'העברה לחשבון אחר', hidden: !canManage || !(d.balance > 0.005) || d.status === 'inHouse', disabled: d.paid > 0.005 || d.adjusted > 0.005, why: 'קודם מבטלים שיוך', onSelect: () => setDlg({ kind: 'transfer', debt: d }) },
    { label: 'ביטול האיחוד', hidden: !canManage || d.origin !== 'consolidated' || d.consolidatedOn !== data?.today, onSelect: () => setDlg({ kind: 'uncons', debt: d }) },
  ];

  return (
    <Page wide title={a?.name || 'חשבון חייבים'} back="/pms/fin/receivables"
      meta={a ? [a.number || 'ללא חשבון חייבים', a.active ? a.typeLabel : null, `תנאים: ${a.termsLabel}`].filter(Boolean).join(' · ') : ''}
      tools={a && <>
        {canManage && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDlg({ kind: 'account' })}>{a.active ? 'פרטי החשבון' : 'פתיחת חשבון חייבים'}</button>}
        {a.active && canWork && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDlg({ kind: 'letter', letter: 'statement' })}>דף חשבון</button>}
        {a.active && canWork && s?.overdue > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDlg({ kind: 'letter', letter: 'reminder' })}>תזכורת</button>}
        {a.active && canWork && <button type="button" className="btn btn-secondary btn-sm" disabled={a.restricted} onClick={() => setDlg({ kind: 'new' })}>חוב חדש</button>}
      </>}
      primary={a && canWork && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg({ kind: 'pay' })}>קבלת תשלום</button>}>
      <ToastContainer toasts={toasts} />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && (
        <>
          {!a.active && <Banner tone="info">לחברה אין חשבון חייבים פעיל. החובות שלה מוצגים, אבל חוב ישיר, תשלום על החשבון ודפי חשבון זמינים רק אחרי פתיחת החשבון.</Banner>}
          {a.restricted && <Banner tone="bad">החשבון מוגבל{a.restrictedReason ? `: ${a.restrictedReason}` : ''} — לא נרשמים אליו חיובים חדשים (גם לא ביציאה וב־Voucher).</Banner>}
          {s.overLimit && <Banner tone="warn">חריגה ממסגרת האשראי: חובות {money(s.debts)} מתוך {money(a.creditLimit)}.</Banner>}
          <Tiles label="מצב החשבון" items={[
            { id: 'total', label: 'יתרה לתשלום', value: money(s.total), static: true },
            { id: 'debts', label: 'חובות פתוחים', value: money(s.debts), static: true },
            { id: 'overdue', label: 'באיחור', value: money(s.overdue), tone: s.overdue > 0 ? 'bad' : undefined, static: true },
            { id: 'unapplied', label: 'על החשבון', value: money(s.unapplied), tone: s.unapplied > 0 ? 'warn' : undefined, static: true },
            { id: 'bin', label: 'בסל ביניים', value: s.binCount ? `${s.binCount} · ${money(s.bin)}` : '—', static: true },
            { id: 'limit', label: 'מסגרת', value: a.creditLimit ? money(a.creditLimit) : 'אין', static: true },
          ]} />
          <div className="ui-split ar-split">
            <Card flush title={view === 'payments' ? 'תשלומים' : 'חובות'} actions={<>
              <Segmented label="תצוגה" value={view} onChange={(v) => { setView(v); setSel([]); }} options={[{ value: 'open', label: 'פתוחים' }, { value: 'all', label: 'כולם' }, { value: 'payments', label: 'תשלומים' }]} />
              {view !== 'payments' && <SearchBox id="ar-q" value={q} onCommit={setQ} placeholder="מספר, אורח, תאריך" />}
            </>}>
              {s.unapplied > 0.005 && canWork && (
                <div className="ar-strip">על החשבון {money(s.unapplied)} שעדיין לא שויך לחוב — החובות ממשיכים להזדקן.
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDlg({ kind: 'allocate' })}>שיוך לחובות</button></div>
              )}
              {sel.length > 0 && (
                <div className="ar-strip is-sel"><b>{sel.length} נבחרו</b> · {money(debts.filter((d) => sel.includes(d.folioId)).reduce((x, d) => x + d.balance, 0))}
                  <span className="ar-strip-acts">
                    {canWork && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDlg({ kind: 'pay', preselect: sel })}>תשלום לנבחרים</button>}
                    {canManage && sel.length > 1 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDlg({ kind: 'consolidate' })}>איחוד לחוב אחד</button>}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel([])}>ניקוי</button>
                  </span>
                </div>
              )}
              {view === 'payments' ? <PaymentsTable data={data} canWork={canWork} canManage={canManage} onUnallocate={(p) => setDlg({ kind: 'unalloc', pay: p })} onVoid={(p) => setDlg({ kind: 'void', pay: p })} /> : (
                !debts.length ? <Empty title={view === 'open' ? 'אין חובות פתוחים' : 'אין חובות'}>{q ? 'לא נמצא חוב שמתאים לחיפוש.' : 'חובות מיציאות לחשבון החברה, חובות ישירים וחיובים קבועים יופיעו כאן.'}</Empty> : (
                  <div className="ui-table-wrap ar-table">
                    <table className="ui-table">
                      <thead><tr>
                        <th scope="col" className="ar-chk"><input type="checkbox" aria-label="בחירת כל החובות הפתוחים" checked={allOpen.length > 0 && sel.length === allOpen.length} onChange={(e) => setSel(e.target.checked ? allOpen : [])} /></th>
                        <th scope="col">חוב</th><th scope="col">תאריך</th><th scope="col">אורח / תיאור</th><th scope="col">סכום</th><th scope="col">שולם</th><th scope="col">יתרה</th><th scope="col">לתשלום עד</th><th scope="col"><span className="sr-only">פעולות</span></th>
                      </tr></thead>
                      <tbody>
                        {debts.map((d) => (
                          <tr key={d.folioId} className={sel.includes(d.folioId) ? 'is-selected' : ''}>
                            <td className="ar-chk">{selectable(d) && <input type="checkbox" aria-label={`בחירת ${d.number || ''}`} checked={sel.includes(d.folioId)} onChange={(e) => setSel((p) => (e.target.checked ? [...p, d.folioId] : p.filter((x) => x !== d.folioId)))} />}</td>
                            <th scope="row"><button type="button" className="ui-link" onClick={() => setDlg({ kind: 'detail', debt: d })}>{d.number || d.confirmationNumber || 'חוב'}</button>
                              <div className="ui-sub">{ORIGIN[d.origin] || ''}{STATUS[d.status] && d.status !== 'open' ? <> · <Tag tone={STATUS[d.status][1]}>{STATUS[d.status][0]}</Tag></> : null}</div></th>
                            <td>{he(d.since)}</td>
                            <td>{d.guest || '—'}{d.confirmationNumber && d.number ? <div className="ui-sub">{d.confirmationNumber}</div> : d.ref ? <div className="ui-sub">{d.ref}</div> : null}</td>
                            <td className="ui-amount">{money(d.charged)}</td>
                            <td className="ui-amount">{d.paid || d.adjusted ? money(d.paid + d.adjusted) : <span className="ui-sub">—</span>}</td>
                            <td className="ui-amount"><b>{money(d.balance)}</b></td>
                            <td>{d.status === 'inHouse' ? <span className="ui-sub">בשהייה</span> : <>{he(d.dueDate)}{d.overdueDays > 0 && <div><Tag tone="bad">{d.overdueDays} ימי איחור</Tag></div>}</>}</td>
                            <td className="ui-row-actions"><RowMenu label={`פעולות לחוב ${d.number || ''}`} items={menu(d)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </Card>
            <SidePanel data={data} propertyId={propertyId} companyId={companyId} canWork={canWork} canManage={canManage} onChanged={(msg) => { success(msg); reload(); }} />
          </div>
        </>
      )}
      {a && (
        <>
          <ArPayDialog open={dlg?.kind === 'pay'} account={a} debts={debts} preselect={dlg?.preselect} propertyId={propertyId} onClose={close}
            onDone={(out) => { setDlg(null); setSel([]); success(`נרשם תשלום ${money(out.amount)}${out.unapplied > 0 ? ` (מתוכו ${money(out.unapplied)} על החשבון)` : ''}`); reload(); }} />
          <ArAllocateDialog open={dlg?.kind === 'allocate'} account={a} credit={s?.unapplied || 0} debts={debts} propertyId={propertyId} onClose={close} onDone={done('התשלום שויך לחובות')} />
          <ArChargeDialog open={dlg?.kind === 'new'} mode="new" account={a} propertyId={propertyId} onClose={close} onDone={(out) => { setDlg(null); success(`נפתח חוב ${out.number}`); reload(); }} />
          <ArChargeDialog open={dlg?.kind === 'charge'} mode="charge" account={a} debt={dlg?.debt} propertyId={propertyId} onClose={close} onDone={done('החיוב נרשם בחוב')} />
          <ArAdjustDialog open={dlg?.kind === 'adjust'} debt={dlg?.debt} reasons={data?.config?.adjustReasons} limit={0} canManage={canManage} propertyId={propertyId} onClose={close} onDone={done('ההתאמה נרשמה')} />
          <ArTransferDialog open={dlg?.kind === 'transfer'} debt={dlg?.debt ? { ...dlg.debt, companyId } : null} fromName={a.name} propertyId={propertyId} onClose={close} onDone={(out) => { setDlg(null); success(`החוב הועבר — מספר חדש ${out.number}`); reload(); }} />
          <ArAccountDialog open={dlg?.kind === 'account'} account={a} config={data?.config} propertyId={propertyId} onClose={close} onDone={done('פרטי החשבון נשמרו')} />
          <ArLetterDialog open={dlg?.kind === 'letter'} kind={dlg?.letter} account={a} propertyId={propertyId} onClose={close}
            onDone={(out, via) => { setDlg(null); reload(); if (out.failed?.length) success(`לא נשלח: ${out.failed[0].reason}`); else if (via === 'email') success('נשלח בדוא״ל ונשמר בהיסטוריה'); else nav(`/pms/fin/receivables/print?letters=${out.letters.map((l) => l.id).join(',')}`); }} />
          <ConsolidateDialog open={dlg?.kind === 'consolidate'} ids={sel} debts={debts} companyId={companyId} propertyId={propertyId} onClose={close} onDone={(out) => { setDlg(null); setSel([]); success(`אוחד לחוב ${out.number}`); reload(); }} />
          <DebtDrawer open={dlg?.kind === 'detail'} debt={dlg?.debt} propertyId={propertyId} onClose={close} />
          <ConfirmDialog open={dlg?.kind === 'uncons'} onClose={close} title={`ביטול האיחוד של ${dlg?.debt?.number || ''}`} confirmLabel="ביטול האיחוד"
            onConfirm={async () => { await finance.arUnconsolidate(propertyId, dlg.debt.folioId); done('האיחוד בוטל — החובות המקוריים נפתחו')(); }}>
            <p>החובות המקוריים נפתחים שוב עם המספרים שלהם. אפשר רק ביום האיחוד, ורק כשאין בחוב המאוחד תשלומים.</p>
          </ConfirmDialog>
          <ConfirmDialog open={dlg?.kind === 'unalloc'} onClose={close} title="ביטול שיוך התשלום" confirmLabel="ביטול השיוך"
            onConfirm={async () => { await finance.arUnallocate(propertyId, dlg.pay.folioId, dlg.pay.lineId); done('התשלום חזר להיות על החשבון והחוב נפתח')(); }}>
            <p>{dlg?.pay ? `${money(dlg.pay.amount)} יוצאים מחוב ${dlg.pay.where} וחוזרים להיות על החשבון. החוב נפתח מחדש.` : ''}</p>
          </ConfirmDialog>
          <ConfirmDialog open={dlg?.kind === 'void'} onClose={close} danger requireReason reasonLabel="סיבה (למשל: שיק חזר)" title="ביטול תשלום" confirmLabel="ביטול התשלום"
            onConfirm={async (reason) => { const out = await finance.arVoidPayment(propertyId, companyId, dlg.pay.lineId, { reason, folioId: dlg.pay.folioId }); done(out.refundReceipt ? `התשלום בוטל · הופקה קבלת החזר ${out.refundReceipt}` : out.refundReceiptError ? `התשלום בוטל · קבלת ההחזר לא הופקה: ${out.refundReceiptError} — אפשר להפיק אותה ממסמכי החשבון` : 'התשלום בוטל והיתרה עלתה')(); }}>
            <p>{dlg?.pay ? `${money(dlg.pay.amount)} · ${PAY_METHOD_LABELS[dlg.pay.method] || dlg.pay.method || ''} ${dlg.pay.methodRef || ''}` : ''}</p>
            <p className="ui-sub">התשלום יוצא מהחשבון והיתרה עולה. אם הופקה לו קבלה — מופקת אוטומטית קבלת החזר במערכת החשבוניות. כסף שעל החשבון ששויך לחובות — קודם מבטלים את השיוך.</p>
          </ConfirmDialog>
        </>
      )}
    </Page>
  );
}

function PaymentsTable({ data, canWork, canManage, onUnallocate, onVoid }) {
  const rows = data.payments || [];
  if (!rows.length) return <Empty title="אין תשלומים">תשלומים מהחברה יופיעו כאן, עם החוב שכל תשלום משויך אליו.</Empty>;
  return (
    <div className="ui-table-wrap ar-table">
      <table className="ui-table">
        <thead><tr><th scope="col">תאריך</th><th scope="col">סכום</th><th scope="col">אמצעי</th><th scope="col">משויך ל</th><th scope="col"><span className="sr-only">פעולות</span></th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.lineId} className={p.undone ? 'is-muted' : ''}>
              <td>{he(p.date)}</td>
              <td className="ui-amount">{money(p.amount)}</td>
              <td>{PAY_METHOD_LABELS[p.method] || p.method || '—'}{p.methodRef ? <div className="ui-sub">{p.methodRef}</div> : null}</td>
              <td>{p.where}{p.allocated && <div className="ui-sub">שויך מ"על החשבון"</div>}{p.returned && <div className="ui-sub">חזר מחוב</div>}{p.undone && <div><Tag>{p.unapplied ? 'בוטל' : 'השיוך בוטל'}</Tag></div>}</td>
              <td className="ui-row-actions">
                {canWork && p.canUnallocate && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUnallocate(p)}>ביטול שיוך</button>}
                {canManage && p.canVoid && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onVoid(p)}>ביטול תשלום</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsolidateDialog({ open, ids, debts, companyId, propertyId, onClose, onDone }) {
  const [ref, setRef] = useState('');
  const chosen = debts.filter((d) => ids.includes(d.folioId));
  return (
    <ConfirmDialog open={open} onClose={onClose} title={`איחוד ${chosen.length} חובות`} confirmLabel={`איחוד ${money(chosen.reduce((s, d) => s + d.balance, 0))}`}
      onConfirm={async () => { const out = await finance.arConsolidate(propertyId, companyId, { folioIds: ids, ref: ref || undefined, idempotencyKey: newOpKey() }); setRef(''); onDone(out); }}>
      <p>{chosen.map((d) => d.number).join(' · ')}</p>
      <Field id="cons-ref" label="אסמכתה לחוב המאוחד" optional hint="למשל מספר טיסה או הזמנת רכש"><input id="cons-ref" className="input w-full" maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <p className="ui-sub">נוצר חוב אחד עם מספר חדש. אפשר לבטל את האיחוד היום בלבד.</p>
    </ConfirmDialog>
  );
}

function DebtDrawer({ open, debt, propertyId, onClose }) {
  const { data, loading, error } = useLoader(async () => (open && debt ? finance.arDebt(propertyId, debt.folioId) : null), [open, debt?.folioId]);
  return (
    <Drawer open={open} onClose={onClose} title={debt ? `חוב ${debt.number || debt.confirmationNumber || ''}` : ''} subtitle={debt ? `${debt.guest || ''} · יתרה ${money(debt.balance)}` : ''} width={560}>
      <ErrorBanner error={error} />
      {loading && <div className="ui-empty"><Spinner /></div>}
      {data && (
        <div className="ui-stack">
          <div className="ar-kv">
            <span>נכנס לחשבון</span><b>{he(data.enteredOn)}</b>
            <span>לתשלום עד</span><b>{he(data.dueDate)}</b>
            <span>מקור</span><b>{ORIGIN[data.origin] || data.origin}</b>
            {data.ref && <><span>אסמכתה</span><b>{data.ref}</b></>}
            {data.confirmationNumber && <><span>הזמנה</span><b>{data.reservationId ? <Link className="ui-link" to={`/pms/reservations/${data.reservationId}`}>{data.confirmationNumber}</Link> : data.confirmationNumber}</b></>}
          </div>
          <table className="ui-table">
            <thead><tr><th scope="col">תאריך</th><th scope="col">שורה</th><th scope="col">סכום</th></tr></thead>
            <tbody>
              {data.lines.filter((l) => l.status === 'posted').map((l) => (
                <tr key={l.id} className={l.arKind === 'out' || l.reversalOf ? 'is-muted' : ''}><td>{he(l.serviceDate)}</td><td>{l.description}{l.reason && <div className="ui-sub">{l.reason}</div>}</td><td className="ui-amount">{money(l.gross)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}

// Side: notes / traces / 12 months / future bookings / letters / recurring — one card, a tab each.
function SidePanel({ data, propertyId, companyId, canWork, canManage, onChanged }) {
  const [tab, setTab] = useState('notes');
  const [text, setText] = useState('');
  const [due, setDue] = useState(data.today);
  const [rec, setRec] = useState({ code: null, amount: '', day: '1', description: '' });
  const action = useAction();
  const max = Math.max(1, ...data.year.map((m) => Math.max(m.charged, m.paid)));
  const openTraces = data.traces.filter((t) => !t.done).length;
  const add = (kind) => action.run(async () => { await finance.arNote(propertyId, companyId, { kind, text, dueDate: kind === 'trace' ? due : undefined }); setText(''); onChanged(kind === 'trace' ? 'המשימה נוספה' : 'ההערה נשמרה'); });
  return (
    <Card title={null} className="ar-side">
      <Segmented label="מידע נוסף" value={tab} onChange={setTab} options={[
        { value: 'notes', label: 'הערות' }, { value: 'traces', label: 'משימות', count: openTraces || null }, { value: 'year', label: 'שנה' },
        { value: 'future', label: 'עתידיות', count: data.future.length || null }, { value: 'letters', label: 'מכתבים' }, { value: 'recurring', label: 'קבועים' },
      ]} />
      <ErrorBanner error={action.error} />
      {(tab === 'notes' || tab === 'traces') && (
        <div className="ar-side-body">
          {canWork && (
            <div className="ar-note-add">
              <input className="input w-full" aria-label={tab === 'notes' ? 'הערה חדשה' : 'משימה חדשה'} placeholder={tab === 'notes' ? 'שיחה, הבטחת תשלום, בעיה…' : 'מה צריך לעשות'} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
              {tab === 'traces' && <input type="date" className="input" aria-label="תאריך יעד" value={due} onChange={(e) => setDue(e.target.value)} />}
              <button type="button" className="btn btn-secondary btn-sm" disabled={action.busy || text.trim().length < 2} onClick={() => add(tab === 'notes' ? 'note' : 'trace')}>הוספה</button>
            </div>
          )}
          <ul className="ar-notes">
            {(tab === 'notes' ? data.notes : data.traces).map((n) => (
              <li key={n.id} className={n.done ? 'is-done' : ''}>
                {n.kind === 'trace' && <input type="checkbox" aria-label="טופל" checked={n.done} disabled={!canWork} onChange={async (e) => { await finance.arTraceDone(propertyId, n.id, e.target.checked); onChanged(e.target.checked ? 'סומן כטופל' : 'נפתח מחדש'); }} />}
                <div><div>{n.text}</div><div className="ui-sub">{n.kind === 'trace' ? `עד ${he(n.dueDate)} · ` : ''}{n.byName} · {he(String(n.at).slice(0, 10))}{n.done ? ` · טופל ע״י ${n.doneByName}` : ''}</div></div>
              </li>
            ))}
            {!(tab === 'notes' ? data.notes : data.traces).length && <li className="ui-sub">{tab === 'notes' ? 'אין הערות.' : 'אין משימות.'}</li>}
          </ul>
        </div>
      )}
      {tab === 'year' && (
        <div className="ar-side-body">
          <div className="ar-year" role="img" aria-label="חיובים ותשלומים ב־12 החודשים האחרונים">
            {data.year.map((m) => (
              <div key={m.month} className="ar-year-col" title={`${m.month}: חויב ${money(m.charged)}, שולם ${money(m.paid)}`}>
                <div className="ar-year-bars"><span className="is-c" style={{ height: `${(m.charged / max) * 100}%` }} /><span className="is-p" style={{ height: `${(m.paid / max) * 100}%` }} /></div>
                <small>{m.month.slice(5)}</small>
              </div>
            ))}
          </div>
          <div className="ar-legend"><span><i className="is-c" /> חויב {money(data.year.reduce((x, m) => x + m.charged, 0))}</span><span><i className="is-p" /> שולם {money(data.year.reduce((x, m) => x + m.paid, 0))}</span></div>
        </div>
      )}
      {tab === 'future' && (
        <ul className="ar-notes ar-side-body">
          {data.future.map((r) => (
            <li key={r.reservationId}><div><Link className="ui-link" to={`/pms/reservations/${r.reservationId}`}>{r.confirmationNumber}</Link> · {r.guest}<div className="ui-sub">{he(r.arrivalDate)}–{he(r.departureDate)} · {money(r.totalAmount)}{r.payer ? ' · החברה משלמת' : ''}</div></div></li>
          ))}
          {!data.future.length && <li className="ui-sub">אין הזמנות עתידיות לחשבון.</li>}
        </ul>
      )}
      {tab === 'letters' && (
        <ul className="ar-notes ar-side-body">
          {data.letters.map((l) => (
            <li key={l.id}><div><Link className="ui-link" to={`/pms/fin/receivables/print?letters=${l.id}`}>{l.kind === 'reminder' ? `תזכורת ${l.level || ''}` : 'דף חשבון'}</Link> · {money(l.balance)}<div className="ui-sub">{he(String(l.at).slice(0, 10))} · {l.via === 'email' ? `דוא״ל ${l.email || ''}` : 'הדפסה'} · {l.byName}</div></div></li>
          ))}
          {!data.letters.length && <li className="ui-sub">עוד לא נשלחו דפי חשבון או תזכורות.</li>}
        </ul>
      )}
      {tab === 'recurring' && (
        <div className="ar-side-body">
          <ul className="ar-notes">
            {data.account.recurring.map((x) => (
              <li key={x.id} className={x.active ? '' : 'is-done'}><div><b>{money(x.amount)}</b> · {x.description || x.code} <div className="ui-sub">כל {x.day} בחודש{x.lastPeriod ? ` · אחרון ${x.lastPeriod}` : ''}</div></div>
                {canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await finance.arRecurring(propertyId, companyId, { id: x.id, active: !x.active }); onChanged(x.active ? 'החיוב הקבוע הופסק' : 'החיוב הקבוע הופעל'); }}>{x.active ? 'הפסקה' : 'הפעלה'}</button>}</li>
            ))}
            {!data.account.recurring.length && <li className="ui-sub">אין חיובים קבועים. חיוב קבוע נרשם כחוב חדש בסגירת היום של היום שנקבע.</li>}
          </ul>
          {canManage && data.account.active && (
            <div className="ar-rec-add">
              <ChargeCodeSelect id="rec-code" propertyId={propertyId} value={rec.code?.code} onChange={(code) => setRec((p) => ({ ...p, code, description: p.description || code?.name || '' }))} />
              <input className="input" aria-label="סכום" placeholder="סכום" inputMode="decimal" value={rec.amount} onChange={(e) => setRec((p) => ({ ...p, amount: e.target.value }))} />
              <input className="input" aria-label="יום בחודש" placeholder="יום" inputMode="numeric" value={rec.day} onChange={(e) => setRec((p) => ({ ...p, day: e.target.value }))} />
              <input className="input" aria-label="תיאור" placeholder="תיאור" value={rec.description} onChange={(e) => setRec((p) => ({ ...p, description: e.target.value }))} />
              <button type="button" className="btn btn-secondary btn-sm" disabled={action.busy || !rec.code || !(Number(rec.amount) > 0)} onClick={() => action.run(async () => { await finance.arRecurring(propertyId, companyId, { code: rec.code.code, amount: Number(rec.amount), day: Number(rec.day), description: rec.description }); setRec({ code: null, amount: '', day: '1', description: '' }); onChanged('החיוב הקבוע נוסף'); })}>הוספה</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
