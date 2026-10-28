// G5 — company receivables: open balance per company, aging, credit limit, open folios, receiving a payment.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance } from '../../utils/api';
import { PAY_METHOD_LABELS } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import PaymentMethodFields from '../../components/fin/PaymentMethodFields';
import { Page, Card, Tiles, Empty, ErrorBanner, Spinner, Modal, Field, Tag, Banner, useLoader, useAction, money, newOpKey } from '../../components/kit';

const PAY_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'finance_manager', 'cashier'];
const METHODS = ['bank_transfer', 'cheque', 'credit_card', 'cash', 'voucher'];
const he = (ymd) => (ymd ? ymd.split('-').reverse().join('.') : '—');
const BUCKET_LABEL = { inHouse: 'בשהייה', b0: 'עד 30', b30: '31–60', b60: '61–90', b90: 'מעל 90' };

export default function ReceivablesPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canPay = PAY_ROLES.includes(role);
  const { toasts, success } = useToast();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.receivables(propertyId) : null), [propertyId]);
  const [open, setOpen] = useState(null);
  const [paying, setPaying] = useState(null);
  const t = data?.totals;
  return (
    <Page wide title="חובות פתוחים" back="/pms">
      <ToastContainer toasts={toasts} />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && (
        <>
          <Tiles label="גיול חובות" items={[
            { id: 'total', label: 'סה״כ פתוח', value: money(t.total), static: true },
            { id: 'inHouse', label: 'בשהייה', value: money(t.inHouse), static: true },
            { id: 'b0', label: 'עד 30 יום', value: money(t.b0), static: true },
            { id: 'b30', label: '31–60', value: money(t.b30), tone: t.b30 > 0 ? 'warn' : undefined, static: true },
            { id: 'b60', label: '61–90', value: money(t.b60), tone: t.b60 > 0 ? 'warn' : undefined, static: true },
            { id: 'b90', label: 'מעל 90', value: money(t.b90), tone: t.b90 > 0 ? 'bad' : undefined, static: true },
          ]} />
          <Card flush title={`חברות עם יתרה (${data.rows.length})`} actions={<span className="ui-sub">גיל החוב נספר מיום העזיבה</span>}>
            {!data.rows.length && <Empty title="אין חובות פתוחים">חשבונות שהחברה משלמת ונשארה בהם יתרה יופיעו כאן.</Empty>}
            {data.rows.length > 0 && (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead><tr><th scope="col">חברה</th><th scope="col">סה״כ</th>{Object.values(BUCKET_LABEL).map((l) => <th key={l} scope="col">{l}</th>)}<th scope="col">מסגרת</th><th scope="col"><span className="sr-only">פעולות</span></th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <Fragment key={r.companyId}>
                        <tr>
                          <th scope="row"><button type="button" className="btn btn-ghost btn-sm" aria-expanded={open === r.companyId} onClick={() => setOpen(open === r.companyId ? null : r.companyId)}>{open === r.companyId ? '▾' : '▸'} {r.name}</button>{r.paymentTerms && <div className="ui-sub">{r.paymentTerms}</div>}</th>
                          <td className="ui-amount"><b>{money(r.total)}</b></td>
                          {Object.keys(BUCKET_LABEL).map((k) => <td key={k} className="ui-amount">{r[k] ? money(r[k]) : <span className="ui-sub">—</span>}</td>)}
                          <td>{r.creditLimit ? <>{money(r.creditLimit)} {r.overLimit && <Tag tone="bad">חריגה</Tag>}</> : <span className="ui-sub">—</span>}</td>
                          <td style={{ textAlign: 'left' }}>{canPay && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaying(r)}>קבלת תשלום</button>}</td>
                        </tr>
                        {open === r.companyId && r.items.map((it) => (
                          <tr key={it.folioId} className="ui-subrow">
                            <td><Link to={`/pms/folio?reservation=${it.reservationId}&folio=${it.folioId}`}>{it.confirmationNumber || 'חשבון'}</Link> <span className="ui-sub">{it.guest || ''}</span></td>
                            <td className="ui-amount">{money(it.balance)}</td>
                            <td colSpan={5} className="ui-sub">{it.inHouse ? 'בשהייה' : `עזב ${he(it.departureDate)} · ${it.age} ימים`}</td>
                            <td colSpan={2} />
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      <PayDialog row={paying} propertyId={propertyId} onClose={() => setPaying(null)} onDone={(out) => { setPaying(null); success(`נרשם תשלום ${money(out.amount)} על ${out.posted.length} חשבונות`); reload(); }} />
    </Page>
  );
}

function PayDialog({ row, propertyId, onClose, onDone }) {
  const action = useAction();
  const [f, setF] = useState({});
  const [key, setKey] = useState('');
  useEffect(() => { if (row) { setF({ amount: String(row.total), method: 'bank_transfer', details: {}, note: '' }); setKey(newOpKey()); action.reset(); } }, [row]); // eslint-disable-line react-hooks/exhaustive-deps
  // Oldest first — the same split the server makes.
  const split = useMemo(() => {
    if (!row) return [];
    let left = Number(f.amount) || 0; const out = [];
    for (const it of row.items.filter((i) => i.balance > 0)) { if (left <= 0.005) break; const part = Math.min(left, it.balance); out.push({ ...it, part }); left -= part; }
    return out;
  }, [row, f.amount]);
  const over = row && Number(f.amount) - row.total > 0.005;
  return (
    <Modal open={!!row} onClose={onClose} busy={action.busy} title={row ? `קבלת תשלום — ${row.name}` : ''} subtitle={row ? `יתרה פתוחה ${money(row.total)}` : ''}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
        <button type="button" className="btn btn-primary" disabled={action.busy || over || !(Number(f.amount) > 0)} onClick={() => action.run(async () => onDone(await finance.receivePayment(propertyId, row.companyId, { amount: Number(f.amount), method: f.method, details: f.details, note: f.note || undefined, idempotencyKey: key })))}>{action.busy ? <Spinner /> : 'רישום התשלום'}</button></>}>
      {row && (
        <div className="ui-stack">
          <ErrorBanner error={action.error} />
          <div className="ui-grid-2">
            <Field id="rp-amount" label="סכום" required error={action.fields.amount || (over ? 'מעל היתרה הפתוחה' : undefined)}><input id="rp-amount" className="input w-full" inputMode="decimal" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} /></Field>
            <Field id="rp-method" label="אמצעי"><select id="rp-method" className="input w-full" value={f.method} onChange={(e) => setF((p) => ({ ...p, method: e.target.value, details: {} }))}>{METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m] || m}</option>)}</select></Field>
          </div>
          <PaymentMethodFields idPrefix="rp" method={f.method} amount={Number(f.amount) || 0} value={f.details} onChange={(details) => setF((p) => ({ ...p, details }))} errors={action.fields} />
          <Field id="rp-note" label="הערה" optional><input id="rp-note" className="input w-full" maxLength={200} value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field>
          {split.length > 0 && <Banner tone="info">יחולק מהחוב הישן לחדש: {split.map((s) => `${s.confirmationNumber || 'חשבון'} ${money(s.part)}`).join(' · ')}</Banner>}
          <p className="ui-sub">אחרי הרישום מפיקים קבלה מכל חשבון (במערכת החשבוניות).</p>
        </div>
      )}
    </Modal>
  );
}
