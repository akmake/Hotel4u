// Receivables dialogs (gap-map item 7): payment (oldest first / selected / on account), matching money on
// account, new debt, extra charge, adjustment / write-off, transfer to another account, account details,
// statement / reminder. Every form starts from the context it was opened in.
import { useEffect, useMemo, useState } from 'react';
import { finance, booking } from '../../utils/api';
import { PAY_METHOD_LABELS } from '../../lib/labels';
import PaymentMethodFields from './PaymentMethodFields';
import ChargeCodeSelect from './ChargeCodeSelect';
import { Modal, Field, Spinner, ErrorBanner, Banner, Segmented, useAction, money, newOpKey } from '../kit';

export const AR_WORK_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'finance_manager', 'cashier'];
export const AR_MANAGE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
export const he = (ymd) => (ymd ? String(ymd).slice(0, 10).split('-').reverse().join('.') : '—');
const METHODS = ['bank_transfer', 'cheque', 'credit_card', 'cash', 'voucher'];
const num = (v) => Math.round((Number(v) || 0) * 100) / 100;

function Foot({ onClose, busy, disabled, label, onGo, danger }) {
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ביטול</button>
      <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || disabled} onClick={onGo}>{busy ? <Spinner /> : label}</button>
    </>
  );
}

// ── Payment from the company ───────────────────────────────────────────────
export function ArPayDialog({ open, account, debts, preselect, propertyId, onClose, onDone }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [alloc, setAlloc] = useState({});
  const [key, setKey] = useState('');
  const openDebts = useMemo(() => (debts || []).filter((d) => d.balance > 0.005 && !['moved', 'unapplied'].includes(d.status)).sort((a, b) => String(a.since || '').localeCompare(String(b.since || ''))), [debts]);
  useEffect(() => {
    if (!open) return;
    const pre = (preselect || []).filter((id) => openDebts.some((d) => d.folioId === id));
    const total = pre.length ? openDebts.filter((d) => pre.includes(d.folioId)).reduce((s, d) => s + d.balance, 0) : openDebts.reduce((s, d) => s + d.balance, 0);
    setF({ amount: String(num(total) || ''), method: 'bank_transfer', details: {}, note: '', mode: pre.length ? 'selected' : openDebts.length ? 'fifo' : 'unapplied', rest: false });
    setAlloc(Object.fromEntries(pre.map((id) => [id, String(openDebts.find((d) => d.folioId === id).balance)])));
    setKey(newOpKey()); action.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = num(f.amount);
  const open$ = num(openDebts.reduce((s, d) => s + d.balance, 0));
  const allocated = num(Object.values(alloc).reduce((s, v) => s + num(v), 0));
  const fifo = useMemo(() => {
    let left = amount; const out = [];
    for (const d of openDebts) { if (left <= 0.005) break; const part = Math.min(left, d.balance); out.push({ ...d, part }); left = num(left - part); }
    return { out, rest: num(left) };
  }, [amount, openDebts]);
  const rest = f.mode === 'unapplied' ? amount : f.mode === 'selected' ? num(amount - allocated) : fifo.rest;
  const needRest = f.mode !== 'unapplied' && rest > 0.005;
  const bad = !(amount > 0) || (f.mode === 'selected' && (allocated - amount > 0.005 || !allocated)) || (needRest && !f.rest);
  const go = () => action.run(async () => onDone(await finance.receivePayment(propertyId, account.companyId, {
    amount, method: f.method, details: f.details, note: f.note || undefined, idempotencyKey: key, mode: f.mode, restUnapplied: !!f.rest || undefined,
    allocations: f.mode === 'selected' ? Object.entries(alloc).filter(([, v]) => num(v) > 0).map(([folioId, v]) => ({ folioId, amount: num(v) })) : undefined,
  })));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={640} title={account ? `קבלת תשלום — ${account.name}` : ''} subtitle={account ? `חובות פתוחים ${money(open$)}` : ''}
      footer={<Foot onClose={onClose} busy={action.busy} disabled={bad} label="רישום התשלום" onGo={go} />}>
      {account && (
        <div className="ui-stack">
          <ErrorBanner error={action.error} />
          <Segmented label="שיוך התשלום" value={f.mode} onChange={(mode) => setF((p) => ({ ...p, mode }))} options={[
            { value: 'fifo', label: 'לפי ותק' }, { value: 'selected', label: 'לחובות שבוחרים' }, { value: 'unapplied', label: 'על החשבון' },
          ]} />
          <div className="ui-grid-2">
            <Field id="arp-amount" label="סכום" required error={action.fields.amount}><input id="arp-amount" className="input w-full" inputMode="decimal" value={f.amount || ''} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} /></Field>
            <Field id="arp-method" label="אמצעי"><select id="arp-method" className="input w-full" value={f.method} onChange={(e) => setF((p) => ({ ...p, method: e.target.value, details: {} }))}>{METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m] || m}</option>)}</select></Field>
          </div>
          <PaymentMethodFields idPrefix="arp" method={f.method} amount={amount} value={f.details} onChange={(details) => setF((p) => ({ ...p, details }))} errors={action.fields} />
          {f.mode === 'selected' && (
            <div className="ar-alloc" role="group" aria-label="חלוקה לחובות">
              {openDebts.map((d) => (
                <label key={d.folioId} className="ar-alloc-row">
                  <input type="checkbox" checked={alloc[d.folioId] !== undefined} onChange={(e) => setAlloc((p) => { const n = { ...p }; if (e.target.checked) n[d.folioId] = String(Math.min(d.balance, Math.max(0, num(amount - allocated))) || d.balance); else delete n[d.folioId]; return n; })} />
                  <span><b>{d.number || d.confirmationNumber || 'חוב'}</b> <span className="ui-sub">{d.guest || ''} · {he(d.since)}</span></span>
                  <span className="ui-amount">{money(d.balance)}</span>
                  <input className="input" inputMode="decimal" aria-label={`סכום לחוב ${d.number || ''}`} disabled={alloc[d.folioId] === undefined} value={alloc[d.folioId] ?? ''} onChange={(e) => setAlloc((p) => ({ ...p, [d.folioId]: e.target.value }))} />
                </label>
              ))}
              <div className="ui-sub">חולק {money(allocated)} · נשאר לחלק {money(Math.max(0, num(amount - allocated)))}</div>
            </div>
          )}
          {f.mode === 'fifo' && fifo.out.length > 0 && <Banner tone="info">יחולק מהישן לחדש: {fifo.out.map((s) => `${s.number || s.confirmationNumber || 'חוב'} ${money(s.part)}`).join(' · ')}</Banner>}
          {f.mode === 'unapplied' && <Banner tone="warn">תשלום על החשבון מקטין את היתרה, אבל החובות ממשיכים להזדקן עד שמשייכים אותו.</Banner>}
          {needRest && (
            <label className="ui-check"><input type="checkbox" checked={!!f.rest} onChange={(e) => setF((p) => ({ ...p, rest: e.target.checked }))} /> היתרה ({money(rest)}) נרשמת על החשבון</label>
          )}
          <Field id="arp-note" label="הערה" optional><input id="arp-note" className="input w-full" maxLength={200} value={f.note || ''} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field>
          <p className="ui-sub">הקבלה מופקת במערכת החשבוניות, מכל חשבון שהתשלום נרשם בו.</p>
        </div>
      )}
    </Modal>
  );
}

// ── Match money on account to debts ───────────────────────────────────────
export function ArAllocateDialog({ open, account, credit, debts, propertyId, onClose, onDone }) {
  const action = useAction();
  const [alloc, setAlloc] = useState({});
  const [key, setKey] = useState('');
  const openDebts = useMemo(() => (debts || []).filter((d) => d.balance > 0.005 && !['moved', 'unapplied', 'bin', 'inHouse'].includes(d.status)).sort((a, b) => String(a.since || '').localeCompare(String(b.since || ''))), [debts]);
  useEffect(() => {
    if (!open) return;
    let left = credit; const pre = {};
    for (const d of openDebts) { if (left <= 0.005) break; const part = num(Math.min(left, d.balance)); pre[d.folioId] = String(part); left = num(left - part); }
    setAlloc(pre); setKey(newOpKey()); action.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = num(Object.values(alloc).reduce((s, v) => s + num(v), 0));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={560} title="שיוך תשלום שעל החשבון" subtitle={`על החשבון ${money(credit)}`}
      footer={<Foot onClose={onClose} busy={action.busy} disabled={!(total > 0) || total - credit > 0.005} label={`שיוך ${money(total)}`} onGo={() => action.run(async () => onDone(await finance.arAllocate(propertyId, account.companyId, { allocations: Object.entries(alloc).filter(([, v]) => num(v) > 0).map(([folioId, v]) => ({ folioId, amount: num(v) })), idempotencyKey: key })))} />}>
      <ErrorBanner error={action.error} />
      {!openDebts.length ? <p className="ui-sub">אין חובות פתוחים שנכנסו לחשבון.</p> : (
        <div className="ar-alloc">
          {openDebts.map((d) => (
            <label key={d.folioId} className="ar-alloc-row">
              <input type="checkbox" checked={alloc[d.folioId] !== undefined} onChange={(e) => setAlloc((p) => { const n = { ...p }; if (e.target.checked) n[d.folioId] = String(Math.min(d.balance, Math.max(0, num(credit - total)))); else delete n[d.folioId]; return n; })} />
              <span><b>{d.number}</b> <span className="ui-sub">{d.guest || ''} · {he(d.since)}</span></span>
              <span className="ui-amount">{money(d.balance)}</span>
              <input className="input" inputMode="decimal" aria-label={`סכום לחוב ${d.number}`} disabled={alloc[d.folioId] === undefined} value={alloc[d.folioId] ?? ''} onChange={(e) => setAlloc((p) => ({ ...p, [d.folioId]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}
      {total - credit > 0.005 && <Banner tone="bad">מעל מה שיש על החשבון</Banner>}
    </Modal>
  );
}

// ── New debt directly on the account (or extra charge on a debt) ───────────
export function ArChargeDialog({ open, mode = 'new', account, debt, propertyId, onClose, onDone }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [key, setKey] = useState('');
  useEffect(() => { if (open) { setF({ code: null, amount: '', description: '', ref: debt?.ref || '', note: '' }); setKey(newOpKey()); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = () => action.run(async () => onDone(mode === 'new'
    ? await finance.arNewDebt(propertyId, account.companyId, { code: f.code?.code, amount: num(f.amount), description: f.description || undefined, ref: f.ref || undefined, note: f.note || undefined, idempotencyKey: key })
    : await finance.arDebtCharge(propertyId, debt.folioId, { department: f.code?.code, unitPrice: num(f.amount), quantity: 1, description: f.description || undefined, reason: f.note || undefined, idempotencyKey: key })));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title={mode === 'new' ? `חוב חדש — ${account?.name || ''}` : `חיוב נוסף לחוב ${debt?.number || ''}`}
      subtitle={mode === 'new' ? `נכנס היום, לתשלום לפי ${account?.termsLabel || 'התנאים'}` : debt?.guest || ''}
      footer={<Foot onClose={onClose} busy={action.busy} disabled={!f.code || !(num(f.amount) > 0)} label={mode === 'new' ? 'פתיחת החוב' : 'רישום החיוב'} onGo={go} />}>
      <div className="ui-stack">
        <ErrorBanner error={action.error} />
        <div className="ui-grid-2">
          <Field id="arc-code" label="קוד חיוב" required error={action.fields.code || action.fields.department}><ChargeCodeSelect id="arc-code" propertyId={propertyId} value={f.code?.code} onChange={(code) => setF((p) => ({ ...p, code, amount: p.amount || (code?.defaultPrice ? String(code.defaultPrice) : ''), description: p.description || code?.name || '' }))} /></Field>
          <Field id="arc-amount" label="סכום כולל מע״מ" required error={action.fields.amount || action.fields.unitPrice}><input id="arc-amount" className="input w-full" inputMode="decimal" value={f.amount || ''} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} /></Field>
        </div>
        <Field id="arc-desc" label="תיאור" optional><input id="arc-desc" className="input w-full" maxLength={200} value={f.description || ''} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} /></Field>
        {mode === 'new' && <Field id="arc-ref" label="אסמכתה (הזמנת רכש, חוזה)" optional><input id="arc-ref" className="input w-full" maxLength={60} value={f.ref || ''} onChange={(e) => setF((p) => ({ ...p, ref: e.target.value }))} /></Field>}
        <Field id="arc-note" label={mode === 'new' ? 'הערה' : 'סיבה'} optional><input id="arc-note" className="input w-full" maxLength={200} value={f.note || ''} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field>
      </div>
    </Modal>
  );
}

// ── Adjustment / write-off ─────────────────────────────────────────────────
export function ArAdjustDialog({ open, debt, reasons, limit, canManage, propertyId, onClose, onDone }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [key, setKey] = useState('');
  useEffect(() => { if (open) { setF({ by: 'amount', amount: String(debt?.balance || ''), percent: '', reason: 'bad_debt', note: '', code: null }); setKey(newOpKey()); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = f.by === 'percent' ? num((debt?.balance || 0) * num(f.percent) / 100) : num(f.amount);
  const needsManager = !canManage && amount > (limit || 0) + 0.005;
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title={`התאמה / מחיקת חוב ${debt?.number || ''}`} subtitle={debt ? `יתרה ${money(debt.balance)}` : ''}
      footer={<Foot danger onClose={onClose} busy={action.busy} disabled={!(amount > 0) || amount - (debt?.balance || 0) > 0.005 || needsManager || (f.reason === 'other' && (f.note || '').trim().length < 3)} label={`הורדה של ${money(amount)}`}
        onGo={() => action.run(async () => onDone(await finance.arAdjust(propertyId, debt.folioId, { reason: f.reason, note: f.note || undefined, code: f.code?.code || undefined, ...(f.by === 'percent' ? { percent: num(f.percent) } : { amount }), idempotencyKey: key })))} />}>
      <div className="ui-stack">
        <ErrorBanner error={action.error} />
        <Segmented label="לפי" value={f.by} onChange={(by) => setF((p) => ({ ...p, by }))} options={[{ value: 'amount', label: 'סכום' }, { value: 'percent', label: 'אחוז' }]} />
        <div className="ui-grid-2">
          {f.by === 'amount'
            ? <Field id="ara-amount" label="סכום" required error={action.fields.amount}><input id="ara-amount" className="input w-full" inputMode="decimal" value={f.amount || ''} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} /></Field>
            : <Field id="ara-pct" label="אחוז מהיתרה" required hint={money(amount)}><input id="ara-pct" className="input w-full" inputMode="decimal" value={f.percent || ''} onChange={(e) => setF((p) => ({ ...p, percent: e.target.value }))} /></Field>}
          <Field id="ara-reason" label="סיבה" required error={action.fields.reason}><select id="ara-reason" className="input w-full" value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))}>{Object.entries(reasons || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <Field id="ara-code" label="קוד לדוחות" optional hint="ברירת מחדל: שונות"><ChargeCodeSelect id="ara-code" propertyId={propertyId} value={f.code?.code} onChange={(code) => setF((p) => ({ ...p, code }))} /></Field>
        <Field id="ara-note" label="פירוט" required={f.reason === 'other'} error={action.fields.note}><input id="ara-note" className="input w-full" maxLength={200} value={f.note || ''} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field>
        {needsManager && <Banner tone="warn">התאמה מעל {money(limit || 0)} מבוצעת על ידי כספים או מנהל כללי.</Banner>}
        <p className="ui-sub">נרשמת שורה חדשה בחוב. החשבונית שכבר הופקה לא משתנה.</p>
      </div>
    </Modal>
  );
}

// ── Transfer a debt to another account ─────────────────────────────────────
export function ArTransferDialog({ open, debt, fromName, propertyId, onClose, onDone }) {
  const action = useAction();
  const [cos, setCos] = useState([]);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState('');
  useEffect(() => {
    if (!open) return;
    setTo(''); setReason(''); setKey(newOpKey()); action.reset();
    booking.companies(propertyId).then((r) => setCos((Array.isArray(r) ? r : r?.rows || []).filter((c) => String(c._id || c.id) !== String(debt?.companyId)))).catch(() => setCos([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={480} title={`העברת חוב ${debt?.number || debt?.confirmationNumber || ''}`} subtitle={debt ? `${money(debt.balance)} · מ${fromName || ''}` : ''}
      footer={<Foot onClose={onClose} busy={action.busy} disabled={!to || reason.trim().length < 3} label="העברה" onGo={() => action.run(async () => onDone(await finance.arTransfer(propertyId, debt.folioId, { toCompanyId: to, reason, idempotencyKey: key })))} />}>
      <div className="ui-stack">
        <ErrorBanner error={action.error} />
        <Field id="art-to" label="לחשבון" required><select id="art-to" className="input w-full" value={to} onChange={(e) => setTo(e.target.value)}><option value="">בחירה…</option>{cos.map((c) => <option key={c._id || c.id} value={c._id || c.id}>{c.name}</option>)}</select></Field>
        <Field id="art-reason" label="סיבה" required error={action.fields.reason}><input id="art-reason" className="input w-full" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: נרשם על החברה הלא נכונה" /></Field>
        <p className="ui-sub">החוב מקבל מספר חדש בחשבון היעד. בחשבון המקורי נשארות שורת פלוס ושורת מינוס, והן לא מופיעות בדף החשבון. חוב ששולם בחלקו — קודם מבטלים את שיוך התשלום.</p>
      </div>
    </Modal>
  );
}

// ── Account details ────────────────────────────────────────────────────────
export function ArAccountDialog({ open, account, config, propertyId, onClose, onDone }) {
  const action = useAction();
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open || !account) return;
    setF({
      number: account.number || '', type: account.type || 'standard', paymentTerms: account.paymentTerms in (config?.terms || {}) ? account.paymentTerms : 'net30', creditLimit: String(account.creditLimit ?? ''),
      restricted: !!account.restricted, restrictedReason: account.restrictedReason || '', inStatements: account.inStatements !== false, permanent: !!account.permanent,
      billing: { name: account.billing?.name || account.contact?.name || '', email: account.billing?.email || account.contact?.email || '', phone: account.billing?.phone || account.contact?.phone || '', address: account.billing?.address || account.address || '' },
    });
    action.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setB = (k) => (e) => setF((p) => ({ ...p, billing: { ...p.billing, [k]: e.target.value } }));
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={620} title={account?.active ? `חשבון חייבים — ${account?.name || ''}` : `פתיחת חשבון חייבים — ${account?.name || ''}`}
      footer={<Foot onClose={onClose} busy={action.busy} label={account?.active ? 'שמירה' : 'פתיחת החשבון'} onGo={() => action.run(async () => onDone(await finance.arSaveAccount(propertyId, account.companyId, { ...f, active: true, number: f.number || undefined })))} />}>
      {f.billing && (
        <div className="ui-stack">
          <ErrorBanner error={action.error} />
          <div className="ui-grid-3">
            <Field id="aa-num" label="מספר חשבון" optional hint={account?.number ? undefined : 'ריק = אוטומטי'} error={action.fields.number}><input id="aa-num" className="input w-full" maxLength={20} value={f.number} onChange={set('number')} /></Field>
            <Field id="aa-type" label="סוג" hint="קובע את מחזור התזכורות"><select id="aa-type" className="input w-full" value={f.type} onChange={set('type')}>{Object.entries(config?.types || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field id="aa-terms" label="תנאי תשלום" error={action.fields.paymentTerms}><select id="aa-terms" className="input w-full" value={f.paymentTerms} onChange={set('paymentTerms')}>{Object.entries(config?.terms || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <div className="ui-grid-3">
            <Field id="aa-limit" label="מסגרת אשראי" hint="מסמנת חריגה, לא חוסמת" error={action.fields.creditLimit}><input id="aa-limit" className="input w-full" inputMode="decimal" value={f.creditLimit} onChange={set('creditLimit')} /></Field>
            <Field id="aa-bname" label="איש קשר לגבייה" optional><input id="aa-bname" className="input w-full" value={f.billing.name} onChange={setB('name')} /></Field>
            <Field id="aa-bphone" label="טלפון" optional><input id="aa-bphone" className="input w-full" value={f.billing.phone} onChange={setB('phone')} /></Field>
          </div>
          <div className="ui-grid-2">
            <Field id="aa-bemail" label="דוא״ל לדפי חשבון" optional error={action.fields.billingEmail}><input id="aa-bemail" className="input w-full" type="email" value={f.billing.email} onChange={setB('email')} /></Field>
            <Field id="aa-baddr" label="כתובת לגבייה" optional><input id="aa-baddr" className="input w-full" value={f.billing.address} onChange={setB('address')} /></Field>
          </div>
          <p className="ui-sub">פרטי הגבייה נשמרים בחשבון החייבים בלבד, ולא משנים את כרטיס החברה.</p>
          <div className="ar-checks">
            <label className="ui-check"><input type="checkbox" checked={f.inStatements} onChange={set('inStatements')} /> כלול בדפי חשבון מרוכזים</label>
            <label className="ui-check"><input type="checkbox" checked={f.permanent} onChange={set('permanent')} /> חשבון קבוע (לא נמחק בניקוי נתונים)</label>
            <label className="ui-check"><input type="checkbox" checked={f.restricted} onChange={set('restricted')} /> מוגבל — חוסם חיובים חדשים</label>
          </div>
          {f.restricted && <Field id="aa-rr" label="סיבת ההגבלה" required error={action.fields.restrictedReason}><input id="aa-rr" className="input w-full" maxLength={200} value={f.restrictedReason} onChange={set('restrictedReason')} /></Field>}
        </div>
      )}
    </Modal>
  );
}

// ── Statement / reminder for one account ───────────────────────────────────
export function ArLetterDialog({ open, kind = 'statement', account, propertyId, onClose, onDone }) {
  const action = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ from: '', to: '', text: '', withCopies: false, via: 'print' }); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const email = account?.billing?.email || account?.contact?.email;
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title={`${kind === 'reminder' ? 'תזכורת תשלום' : 'דף חשבון'} — ${account?.name || ''}`}
      footer={<Foot onClose={onClose} busy={action.busy} disabled={f.via === 'email' && !email} label={f.via === 'email' ? 'שליחה בדוא״ל' : 'הפקה והדפסה'}
        onGo={() => action.run(async () => onDone(await finance.arSendLetters(propertyId, { kind, companyIds: [account.companyId], from: f.from || undefined, to: f.to || undefined, text: f.text || undefined, withCopies: f.withCopies, via: f.via }), f.via))} />}>
      <div className="ui-stack">
        <ErrorBanner error={action.error} />
        {kind === 'statement' && (
          <div className="ui-grid-2">
            <Field id="al-from" label="מתאריך" optional><input id="al-from" type="date" className="input w-full" value={f.from || ''} onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))} /></Field>
            <Field id="al-to" label="עד תאריך" optional hint="ריק = היום"><input id="al-to" type="date" className="input w-full" value={f.to || ''} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))} /></Field>
          </div>
        )}
        <Field id="al-text" label="שורת טקסט" optional hint={kind === 'reminder' ? 'ריק = נוסח לפי שלב התזכורת' : undefined}><input id="al-text" className="input w-full" maxLength={300} value={f.text || ''} onChange={(e) => setF((p) => ({ ...p, text: e.target.value }))} /></Field>
        {kind === 'statement' && <label className="ui-check"><input type="checkbox" checked={!!f.withCopies} onChange={(e) => setF((p) => ({ ...p, withCopies: e.target.checked }))} /> עם פירוט החשבונות</label>}
        <Segmented label="אופן משלוח" value={f.via} onChange={(via) => setF((p) => ({ ...p, via }))} options={[{ value: 'print', label: 'הדפסה / PDF' }, { value: 'email', label: 'דוא״ל' }]} />
        {f.via === 'email' && (email ? <p className="ui-sub">יישלח אל {email}</p> : <Banner tone="warn">אין דוא״ל לגבייה בחשבון — מוסיפים אותו בפרטי החשבון.</Banner>)}
        <p className="ui-sub">המכתב נשמר בהיסטוריה של החשבון, ואפשר להדפיס אותו שוב בדיוק כפי שנשלח.</p>
      </div>
    </Modal>
  );
}
