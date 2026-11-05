// Group money (gap-map item 6, knowledge 14 §6): what the group is expected to pay (billing profile:
// lines by category, discount with a reason, VAT, terms, due date), the payments it sent with their
// proof, and finance's approval — which posts the money to the group's account. Receipts are issued
// from that account (house accounts) through the invoicing system.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Paperclip, Check, X, Wand2 } from 'lucide-react';
import { groupBlocks } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { Modal, Field, Segmented, Banner, ErrorBanner, Spinner, Empty, Tag, ConfirmDialog, KeyValues, useLoader, useAction, money, formatDateTime } from '../kit';

const APPROVERS = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const STATE = { none: ['לא הוגדר חיוב', undefined], unpaid: ['לא שולם', 'bad'], pending: ['ממתין לאישור', 'warn'], partial: ['שולם חלקית', 'warn'], paid: ['שולם במלואו', 'ok'] };
const PAY_STATUS = { pending: ['ממתין לאישור', 'warn'], approved: ['אושר', 'ok'], rejected: ['נדחה', 'bad'], cancelled: ['בוטל', undefined] };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

function Foot({ onClose, busy, label, why, form }) {
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ביטול</button>
      <button type="submit" form={form} className="btn btn-primary" disabled={!!why || busy} title={why || undefined}>{busy ? <Spinner /> : label}</button>
    </>
  );
}

function BillingDialog({ open, onClose, propertyId, groupId, data, onSaved }) {
  const act = useAction();
  const [f, setF] = useState(null);
  const o = data.options;
  useEffect(() => {
    if (!open) return;
    act.reset();
    const b = data.billing || {};
    setF({
      lines: (b.lines || []).map((l) => ({ category: l.category, description: l.description, amount: String(l.amount) })),
      vatIncluded: b.vatIncluded !== false, vatRate: b.vatRate ?? 18,
      dKind: b.discount?.kind || 'percent', dValue: b.discount?.value ? String(b.discount.value) : '', dReason: b.discount?.reason || '', dNote: b.discount?.note || '',
      terms: b.terms || 'immediate', termsText: b.termsText || '', dueDate: b.dueDate || '', notes: b.notes || '',
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const setLine = (i, k, v) => setF((p) => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const subtotal = f.lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const disc = Number(f.dValue || 0) > 0 ? (f.dKind === 'percent' ? subtotal * Number(f.dValue) / 100 : Number(f.dValue)) : 0;
  const after = Math.max(0, subtotal - disc);
  const total = f.vatIncluded ? after : after * (1 + Number(f.vatRate || 0) / 100);
  const pct = subtotal > 0 ? disc * 100 / subtotal : 0;
  const suggest = async () => { const s = await groupBlocks.suggestBilling(propertyId, groupId); setF((p) => ({ ...p, lines: [...p.lines, ...s.lines.map((l) => ({ ...l, amount: String(l.amount) }))] })); };
  const why = !f.lines.length ? 'הוסיפו שורת חיוב' : f.lines.some((l) => !(Number(l.amount) >= 0) || l.amount === '') ? 'סכום לכל שורה' : Number(f.dValue || 0) > 0 && !f.dReason ? 'סיבת ההנחה' : f.terms === 'custom' && f.termsText.trim().length < 3 ? 'פרטו את תנאי התשלום' : null;
  const submit = () => act.run(async () => onSaved(await groupBlocks.saveBilling(propertyId, groupId, {
    lines: f.lines.map((l) => ({ ...l, amount: Number(l.amount) })), vatIncluded: f.vatIncluded, vatRate: Number(f.vatRate),
    discount: Number(f.dValue || 0) > 0 ? { kind: f.dKind, value: Number(f.dValue), reason: f.dReason, note: f.dNote } : null,
    terms: f.terms, termsText: f.termsText, dueDate: f.dueDate || undefined, notes: f.notes,
  })));
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={760} title="פרופיל חיוב לקבוצה" subtitle={data.group.name} footer={<Foot onClose={onClose} busy={act.busy} label={`שמירה · ${money(total, 'ILS', 0)}`} why={why} form="gb-bill" />}>
      <form id="gb-bill" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <table className="ui-table" style={{ width: '100%' }}>
          <thead><tr><th>קטגוריה</th><th>תיאור</th><th>סכום (₪)</th><th aria-label="הסרה" /></tr></thead>
          <tbody>
            {f.lines.map((l, i) => (
              <tr key={i}>
                <td><select className="select" aria-label="קטגוריה" value={l.category} onChange={(e) => setLine(i, 'category', e.target.value)}>{Object.entries(o.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                <td><input className="input w-full" aria-label="תיאור" maxLength={200} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></td>
                <td><input className="input" style={{ width: 120 }} type="number" min="0" step="0.01" aria-label="סכום" value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} /></td>
                <td><button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="הסרת שורה" onClick={() => setF((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))}><X size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setF((p) => ({ ...p, lines: [...p.lines, { category: 'other', description: '', amount: '' }] }))}><Plus size={14} /> שורה</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={suggest}><Wand2 size={14} /> מילוי מהקבוצה (חדרים ולו״ז)</button>
        </div>
        <div className="ui-grid-3">
          <Field id="gb-vi" label="המחירים">
            <select id="gb-vi" className="select w-full" value={f.vatIncluded ? 'in' : 'out'} onChange={(e) => setF((p) => ({ ...p, vatIncluded: e.target.value === 'in' }))}><option value="in">כוללים מע״מ</option><option value="out">לפני מע״מ</option></select>
          </Field>
          <Field id="gb-vr" label="מע״מ %"><input id="gb-vr" type="number" min="0" max="30" className="input w-full" value={f.vatRate} onChange={(e) => setF((p) => ({ ...p, vatRate: e.target.value }))} /></Field>
          <Field id="gb-due" label="תאריך יעד לתשלום" optional hint="ריק = לפי התנאי"><input id="gb-due" type="date" className="input w-full" value={f.dueDate} onChange={(e) => setF((p) => ({ ...p, dueDate: e.target.value }))} /></Field>
        </div>
        <div className="ui-grid-3">
          <Field id="gb-dv" label="הנחה" optional>
            <div style={{ display: 'flex', gap: 6 }}>
              <select className="select" aria-label="סוג הנחה" value={f.dKind} onChange={(e) => setF((p) => ({ ...p, dKind: e.target.value }))}><option value="percent">%</option><option value="amount">₪</option></select>
              <input id="gb-dv" type="number" min="0" className="input w-full" value={f.dValue} onChange={(e) => setF((p) => ({ ...p, dValue: e.target.value }))} />
            </div>
          </Field>
          <Field id="gb-dr" label="סיבת ההנחה" required={Number(f.dValue || 0) > 0} optional={!(Number(f.dValue || 0) > 0)} error={act.fields.discountReason}>
            <select id="gb-dr" className="select w-full" value={f.dReason} onChange={(e) => setF((p) => ({ ...p, dReason: e.target.value }))}><option value="">— בחרו —</option>{Object.entries(o.discountReasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field id="gb-terms" label="תנאי תשלום">
            <select id="gb-terms" className="select w-full" value={f.terms} onChange={(e) => setF((p) => ({ ...p, terms: e.target.value }))}>{Object.entries(o.terms).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
        </div>
        {(f.dReason === 'other' || f.terms === 'custom') && (
          <div className="ui-grid-2">
            {f.dReason === 'other' ? <Field id="gb-dn" label="פירוט ההנחה" required error={act.fields.discountNote}><input id="gb-dn" className="input w-full" maxLength={200} value={f.dNote} onChange={(e) => setF((p) => ({ ...p, dNote: e.target.value }))} /></Field> : <span />}
            {f.terms === 'custom' && <Field id="gb-tt" label="התנאי" required error={act.fields.termsText}><input id="gb-tt" className="input w-full" maxLength={200} value={f.termsText} onChange={(e) => setF((p) => ({ ...p, termsText: e.target.value }))} /></Field>}
          </div>
        )}
        {pct - o.discountApprovalPercent > 0.005 && <Banner tone="warn">הנחה של {pct.toFixed(1)}% — מעל {o.discountApprovalPercent}%, נשמרת רק באישור מנהל.</Banner>}
        <KeyValues rows={[['סה״כ שורות', money(subtotal)], disc > 0 && ['הנחה', `−${money(disc)}`], ['לתשלום', <b key="t">{money(total)}</b>]]} />
      </form>
    </Modal>
  );
}

const DETAIL_FIELDS = {
  cash: [],
  credit_card: [['last4', '4 ספרות אחרונות', 'numeric', 4], ['approval', 'מספר אישור', 'text', 20], ['installments', 'תשלומים', 'numeric', 2]],
  bank_transfer: [['reference', 'אסמכתה', 'text', 40], ['payDate', 'תאריך ההעברה', 'date'], ['payerName', 'שם המעביר', 'text', 80]],
  cheque: [['number', 'מספר שיק', 'numeric', 12], ['bank', 'בנק', 'numeric', 3], ['branch', 'סניף', 'numeric', 4], ['account', 'חשבון', 'numeric', 12], ['dueDate', 'תאריך פירעון', 'date']],
};

function PaymentDialog({ open, onClose, propertyId, groupId, data, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({});
  const [files, setFiles] = useState([]);
  useEffect(() => { if (open) { act.reset(); setFiles([]); setF({ method: 'bank_transfer', amount: data.summary.left ? String(data.summary.left) : '', date: today(), description: '', d: { payDate: today() } }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const setD = (k, v) => setF((p) => ({ ...p, d: { ...p.d, [k]: v } }));
  const e = act.fields;
  const why = !(Number(f.amount) > 0) ? 'נדרש סכום' : null;
  const submit = () => act.run(async () => {
    const p = await groupBlocks.addPayment(propertyId, groupId, { method: f.method, amount: Number(f.amount), date: f.date, description: f.description, reference: f.d?.reference || f.d?.approval || f.d?.number, details: f.d });
    for (const file of files) await groupBlocks.attach(propertyId, groupId, p.id, file);
    onSaved(p);
  });
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={620} title="רישום תשלום מהקבוצה" subtitle="נרשם כממתין — כספים מאשרים ואז הוא נכנס לחשבון הקבוצה" footer={<Foot onClose={onClose} busy={act.busy} label="רישום" why={why} form="gb-pay" />}>
      <form id="gb-pay" className="ui-stack" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <Segmented label="אמצעי" value={f.method} onChange={(v) => setF((p) => ({ ...p, method: v, d: v === 'bank_transfer' ? { payDate: today() } : {} }))} options={Object.entries(data.options.methods).map(([k, v]) => ({ value: k, label: v }))} />
        <div className="ui-grid-3">
          <Field id="gp-amt" label="סכום (₪)" required error={e.amount}><input id="gp-amt" type="number" min="0.01" step="0.01" className="input w-full" value={f.amount || ''} onChange={(ev) => setF((p) => ({ ...p, amount: ev.target.value }))} /></Field>
          <Field id="gp-date" label="תאריך התשלום" error={e.date}><input id="gp-date" type="date" className="input w-full" max={today()} value={f.date || ''} onChange={(ev) => setF((p) => ({ ...p, date: ev.target.value }))} /></Field>
          <Field id="gp-desc" label="תיאור" optional><input id="gp-desc" className="input w-full" maxLength={200} placeholder="מקדמה, תשלום שני…" value={f.description || ''} onChange={(ev) => setF((p) => ({ ...p, description: ev.target.value }))} /></Field>
        </div>
        {DETAIL_FIELDS[f.method]?.length > 0 && (
          <div className="ui-grid-3">
            {DETAIL_FIELDS[f.method].map(([k, label, type, max]) => (
              <Field key={k} id={`gp-${k}`} label={label} error={e[k]}>
                <input id={`gp-${k}`} className="input w-full" dir="ltr" type={type === 'date' ? 'date' : 'text'} inputMode={type === 'numeric' ? 'numeric' : undefined} maxLength={max} value={f.d?.[k] || ''} onChange={(ev) => setD(k, type === 'numeric' ? ev.target.value.replace(/\D/g, '') : ev.target.value)} />
              </Field>
            ))}
          </div>
        )}
        {f.method === 'credit_card' && <div className="ui-sub">אין להקליד מספר כרטיס מלא — רק 4 ספרות אחרונות ומספר האישור מהמסוף.</div>}
        <Field id="gp-files" label="צרופות" optional hint="צילום השיק, אישור ההעברה — תמונה או PDF, עד 5MB">
          <input id="gp-files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(ev) => setFiles([...ev.target.files].slice(0, 5))} />
        </Field>
      </form>
    </Modal>
  );
}

export default function GroupMoney({ propertyId, groupId, role, onToast }) {
  const nav = useNavigate();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? groupBlocks.money(propertyId, groupId) : null), [propertyId, groupId]);
  const [dialog, setDialog] = useState(null);
  const [err, setErr] = useState(null);
  if (loading && !data) return <div className="ui-empty"><Spinner /> טוען…</div>;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.summary;
  const b = data.billing;
  const canApprove = APPROVERS.includes(role);
  const live = !['cancelled'].includes(data.group.status);
  const decide = (p, decision, reason) => groupBlocks.decidePayment(propertyId, groupId, p.id, decision, { reason }).then(() => { setDialog(null); onToast(decision === 'approve' ? 'התשלום אושר ונרשם בחשבון הקבוצה' : decision === 'reject' ? 'התשלום נדחה' : 'הרישום בוטל'); reload(); });
  const upload = async (p, file) => { setErr(null); try { await groupBlocks.attach(propertyId, groupId, p.id, file); onToast('הצרופה נוספה'); reload(); } catch (e2) { setErr(e2); } };
  const open = (a) => groupBlocks.openAttachment(propertyId, groupId, a.id).catch(setErr);
  const [label, tone] = STATE[s.state] || STATE.none;
  return (
    <div className="gm">
      <ErrorBanner error={err} />
      <section className="fo-panel gm-sum" aria-label="מצב תשלום">
        <div className="gm-sum-head">
          <div><div className="ui-label">מצב תשלום</div><Tag tone={tone}>{label}</Tag>{s.overdue && <Tag tone="bad">עבר תאריך היעד</Tag>}</div>
          <div className="gm-nums">
            <div><span>לתשלום</span><b className="ui-num">{money(s.expected, 'ILS', 0)}</b></div>
            <div><span>אושר</span><b className="ui-num">{money(s.approved, 'ILS', 0)}</b></div>
            <div><span>ממתין</span><b className="ui-num">{money(s.pending, 'ILS', 0)}</b></div>
            <div><span>נותר</span><b className="ui-num">{money(s.left, 'ILS', 0)}</b></div>
          </div>
        </div>
        <div className="gm-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.progress} aria-label="התקדמות התשלום"><i style={{ width: `${s.progress}%` }} /></div>
        <div className="gm-sum-foot ui-sub">
          {b ? `${b.termsLabel}${b.termsText ? ` · ${b.termsText}` : ''}${b.dueDate ? ` · יעד ${formatShort(b.dueDate)}` : ''}` : 'עוד לא הוגדר פרופיל חיוב'}
          {data.account && <> · <button type="button" className="ui-link" onClick={() => nav(`/pms/house-accounts?account=${data.account.id}`)}>חשבון הקבוצה {data.account.number}</button> (יתרה {money(data.account.balance, 'ILS', 0)}) — קבלות וחשבוניות מופקות משם</>}
        </div>
      </section>
      <div className="fo-layout">
        <section className="fo-panel" aria-label="פרופיל חיוב">
          <h2 className="fo-panel-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>פרופיל חיוב</span>
            {live && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'billing' })}>{b ? 'עריכה' : 'הגדרה'}</button>}
          </h2>
          {!b ? <Empty title="אין פרופיל חיוב" action={live ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'billing' })}>הגדרת חיוב</button> : null}>כמה הקבוצה צריכה לשלם, לפי קטגוריות, עם הנחה ותנאי תשלום.{data.group.minPax ? ` התחייבות מינימום: ${data.group.minPax} משתתפים.` : ''}</Empty> : (
            <>
              <ul className="fo-lines">
                {b.lines.map((l) => <li key={l.id} className="fo-line"><div className="fo-line-main"><div className="fo-line-t">{l.description}</div><div className="fo-line-meta"><span>{l.categoryLabel}</span></div></div><b className="ui-num">{money(l.amount)}</b></li>)}
              </ul>
              <KeyValues rows={[
                ['סה״כ שורות', money(b.totals.subtotal)],
                b.totals.discount > 0 && [`הנחה (${data.options.discountReasons[b.discount?.reason] || ''}${b.discount?.approvedByName ? ` · אישר ${b.discount.approvedByName}` : ''})`, `−${money(b.totals.discount)}`],
                [`מע״מ ${b.vatRate}%${b.vatIncluded ? ' (כלול)' : ''}`, money(b.totals.vat)],
                ['לתשלום', <b key="t">{money(b.totals.total)}</b>],
              ]} />
            </>
          )}
        </section>
        <aside className="fo-panel" aria-label="תשלומים">
          <h2 className="fo-panel-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>תשלומים <span className="ui-sub">{data.payments.length || ''}</span></span>
            {live && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'pay' })}><Plus size={14} /> תשלום</button>}
          </h2>
          {!data.payments.length && <Empty title="עוד לא התקבלו תשלומים">כל תשלום נרשם עם הצרופה שלו וממתין לאישור כספים.</Empty>}
          <ul className="fo-lines">
            {data.payments.map((p) => (
              <li key={p.id} className="fo-line gm-pay">
                <div className="fo-line-main">
                  <div className="fo-line-t"><b className="ui-num">{money(p.amount)}</b> · {p.methodLabel} <Tag tone={PAY_STATUS[p.status]?.[1]}>{PAY_STATUS[p.status]?.[0]}</Tag></div>
                  <div className="fo-line-meta">
                    <span className="ui-num">{formatShort(p.date)}</span>
                    {p.reference && <span dir="ltr">{p.reference}</span>}
                    {p.description && <span>{p.description}</span>}
                    <span>רשם {p.recordedBy}</span>
                    {p.decidedBy && <span>{p.status === 'approved' ? 'אישר' : p.status === 'rejected' ? 'דחה' : 'ביטל'} {p.decidedBy} · {formatDateTime(p.decidedAt)}</span>}
                    {p.decisionReason && <span>{p.decisionReason}</span>}
                  </div>
                  <div className="gm-files">
                    {p.attachments.map((a) => <button key={a.id} type="button" className="btn btn-ghost btn-sm" onClick={() => open(a)}><Paperclip size={13} /> {a.name}</button>)}
                    {p.status === 'pending' && <label className="btn btn-ghost btn-sm"><Paperclip size={13} /> צרופה<input type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(ev) => ev.target.files[0] && upload(p, ev.target.files[0])} /></label>}
                  </div>
                </div>
                {p.status === 'pending' && (
                  <span className="gp-acts">
                    {canApprove && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'approve', p })}><Check size={14} /> אישור</button>}
                    {canApprove && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'reject', p })}>דחייה</button>}
                    {!canApprove && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'cancel', p })}>ביטול</button>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <BillingDialog open={dialog?.kind === 'billing'} onClose={() => setDialog(null)} propertyId={propertyId} groupId={groupId} data={data} onSaved={() => { setDialog(null); onToast('פרופיל החיוב נשמר'); reload(); }} />
      <PaymentDialog open={dialog?.kind === 'pay'} onClose={() => setDialog(null)} propertyId={propertyId} groupId={groupId} data={data} onSaved={() => { setDialog(null); onToast('התשלום נרשם וממתין לאישור'); reload(); }} />
      <ConfirmDialog open={dialog?.kind === 'approve'} onClose={() => setDialog(null)} title="אישור תשלום" confirmLabel="אישור ורישום בחשבון" onConfirm={() => decide(dialog.p, 'approve')}>
        <p className="ui-p">{dialog?.p && `${money(dialog.p.amount)} · ${dialog.p.methodLabel}${dialog.p.reference ? ` · ${dialog.p.reference}` : ''}`}</p>
        <p className="ui-p">הסכום יירשם בחשבון הקבוצה{data.account ? ` (${data.account.number})` : ' (ייפתח עכשיו)'}. את הקבלה מפיקים משם.</p>
        {dialog?.p && !dialog.p.attachments.length && <Banner tone="warn">אין צרופה לתשלום הזה.</Banner>}
      </ConfirmDialog>
      <ConfirmDialog open={dialog?.kind === 'reject'} onClose={() => setDialog(null)} title="דחיית תשלום" confirmLabel="דחייה" danger requireReason onConfirm={(reason) => decide(dialog.p, 'reject', reason)}><p className="ui-p">התשלום לא יירשם בחשבון.</p></ConfirmDialog>
      <ConfirmDialog open={dialog?.kind === 'cancel'} onClose={() => setDialog(null)} title="ביטול רישום" confirmLabel="ביטול הרישום" danger onConfirm={() => decide(dialog.p, 'cancel')}><p className="ui-p">הרישום יסומן כמבוטל.</p></ConfirmDialog>
    </div>
  );
}
