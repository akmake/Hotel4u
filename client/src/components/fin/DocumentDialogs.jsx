// FIN-06 issue a document from a folio, FIN-10 allocation number, print (original / copy).
// The server builds the document from the folio (no retyping), refuses double documents, numbers it
// in its own series and decides whether an allocation number is needed — this screen shows the
// draft, the recipient and what the law asks, and sends one request per click (operation key).
import { useEffect, useMemo, useState } from 'react';
import { Printer, FileText, Hash, Send } from 'lucide-react';
import { finance } from '../../utils/api';
import { useAuthStore } from '../../stores/authStore';
import { Modal, Field, ErrorBanner, Banner, Spinner, KeyValues, Tag, Segmented, useAction, money, newOpKey } from '../kit';
import { DOC_TYPE_LABELS, DOC_TYPE_HINTS, ALLOCATION_LABELS, PAY_METHOD_LABELS } from '../../lib/labels';
import { formatShort } from '../../utils/date';

export const ALLOCATION_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'finance_manager'];
const TYPE_ORDER = ['tax_invoice_receipt', 'tax_invoice', 'receipt', 'proforma'];
const digits = (v) => String(v || '').replace(/\D/g, '');

// Mirrors documentService.allocationRule so the desk knows before issuing; the server decides.
function allocationPreview({ type, buyer, totals, threshold }) {
  if (!['tax_invoice', 'tax_invoice_receipt'].includes(type) || !threshold) return null;
  if (buyer.kind !== 'business' || digits(buyer.vatNumber).length !== 9) return null;
  if (!(totals.vat > 0)) return null;
  return totals.net > threshold.threshold ? threshold.threshold : null;
}

export async function openPrint(propertyId, docId, onError) {
  try { await finance.printDoc(propertyId, docId); } catch (e) { onError?.(e.message); }
}

export function IssueDocumentDialog({ open, onClose, propertyId, folioId, subtitle, initialType, onIssued }) {
  const action = useAction();
  const [ctx, setCtx] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [type, setType] = useState(null);
  const [buyer, setBuyer] = useState({ kind: 'private' });
  const [notes, setNotes] = useState('');
  const [askAlloc, setAskAlloc] = useState(false);
  const [opKey, setOpKey] = useState('');
  const [issued, setIssued] = useState(null);
  const [printErr, setPrintErr] = useState(null);

  async function load(preferType) {
    setLoadErr(null);
    try {
      const c = await finance.docContext(propertyId, folioId);
      setCtx(c);
      const pick = preferType && c.types[preferType]?.ok ? preferType : c.recommended;
      setType(pick);
      const b = c.buyerDefault || c.buyers.guest || { kind: 'private', name: '' };
      setBuyer({ ...b });
    } catch (e) { setLoadErr(e.message); }
  }

  useEffect(() => {
    if (!open || !folioId) return;
    setCtx(null); setIssued(null); setNotes(''); setAskAlloc(false); setPrintErr(null); setOpKey(newOpKey()); action.reset();
    load(initialType);
  }, [open, folioId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setB = (k) => (ev) => setBuyer((b) => ({ ...b, [k]: ev.target.value }));
  const switchKind = (kind) => {
    const src = kind === 'business' ? ctx?.buyers.company : ctx?.buyers.guest;
    setBuyer(src ? { ...src } : { kind, name: '' });
  };

  const withCharges = type && type !== 'receipt';
  const withPayments = ['receipt', 'tax_invoice_receipt'].includes(type);
  const totals = ctx?.totals.charges || { net: 0, vat: 0, gross: 0 };
  const needsAlloc = ctx && type ? allocationPreview({ type, buyer, totals, threshold: ctx.allocation }) : null;
  // Below the threshold a business customer may still ask for an allocation number (ITA §1.2).
  const external = ctx?.issuer?.system === 'invoicer';
  const canAsk = !!ctx && !external && ['tax_invoice', 'tax_invoice_receipt'].includes(type) && buyer.kind === 'business' && digits(buyer.vatNumber).length === 9 && totals.vat > 0 && !needsAlloc;

  const why = useMemo(() => {
    if (!ctx) return 'טוען…';
    if (!ctx.seller.ok) return external ? 'מערכת החשבוניות לא זמינה' : 'חסרים פרטי העסק';
    if (!type) return 'אין מה להפיק';
    if (!ctx.types[type]?.ok) return ctx.types[type]?.why;
    if (String(buyer.name || '').trim().length < 2) return 'נדרש שם הנמען';
    if (buyer.kind === 'business') {
      if (digits(buyer.vatNumber).length !== 9) return 'מספר עוסק / ח.פ. — 9 ספרות';
      if (!String(buyer.address || '').trim()) return 'נדרשת כתובת העסק';
    }
    return null;
  }, [ctx, type, buyer]);

  const submit = () => action.run(async () => {
    const out = await finance.issueDoc(propertyId, folioId, {
      type, notes: notes.trim() || undefined, idempotencyKey: opKey, requestAllocation: canAsk && askAlloc ? true : undefined,
      buyer: { kind: buyer.kind, name: buyer.name, vatNumber: buyer.kind === 'business' ? digits(buyer.vatNumber) : undefined, idNumber: buyer.kind === 'private' ? digits(buyer.idNumber) || undefined : undefined, address: buyer.address || undefined, city: buyer.city || undefined, email: buyer.email || undefined, phone: buyer.phone || undefined },
    });
    setIssued(out);
    onIssued?.(out);
  });

  // After an invoice there may still be payments to receipt (and the other way round).
  const next = issued && ctx ? (issued.type === 'tax_invoice' && ctx.totals.payments > 0.005 ? 'receipt' : null) : null;

  const footer = issued ? (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>סגירה</button>
      {next && <button type="button" className="btn btn-secondary" onClick={() => { setIssued(null); setOpKey(newOpKey()); action.reset(); load(next); }}>הפקת קבלה על התקבולים</button>}
      <button type="button" className="btn btn-primary" onClick={() => openPrint(propertyId, issued.id, setPrintErr)}><Printer size={15} />{issued.issuer === 'invoicer' ? 'העתק לעיון' : 'הדפסה'}</button>
    </>
  ) : (
    <>
      {why && ctx && <span className="ui-foot-note">{why}</span>}
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
      <button type="submit" form="doc-form" className="btn btn-primary" disabled={action.busy || !!why}>
        {action.busy ? <><Spinner /> מפיק…</> : `הפקת ${DOC_TYPE_LABELS[type] || 'מסמך'}`}
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={680} title={issued ? 'המסמך הופק' : 'הפקת מסמך'} subtitle={subtitle} footer={footer}>
      {loadErr && <ErrorBanner error={loadErr} onRetry={() => load(type)} />}
      {!ctx && !loadErr && <div className="ui-empty"><Spinner /> טוען…</div>}

      {issued && (
        <div className="ui-stack">
          <ErrorBanner error={printErr} />
          <KeyValues rows={[
            ['מסמך', <b key="n">{issued.typeLabel} מס׳ <bdi>{issued.number}</bdi></b>],
            ['נמען', issued.buyer?.name || '—'],
            issued.type === 'receipt' ? ['התקבל', money(issued.paid)] : ['סה״כ כולל מע״מ', money(issued.gross)],
            issued.type !== 'receipt' && ['מתוכו מע״מ', money(issued.vat)],
          ]} />
          {issued.issuer === 'invoicer' && (
            <Banner tone={issued.external?.environment === 'live' ? 'ok' : 'warn'}>
              המסמך הופק במערכת החשבוניות{issued.external?.environment === 'live' ? '' : ' — סביבת בדיקות, ללא תוקף חשבונאי'}. המקור, מספר ההקצאה, הזיכוי והשליחה ללקוח מנוהלים שם; כאן נשמר העתק.
            </Banner>
          )}
          {issued.allocation.status === 'approved' && (
            <Banner tone="ok"><Hash size={14} /> מספר הקצאה מרשות המסים: <b className="ui-num">{issued.allocation.number}</b> — מודפס על החשבונית.</Banner>
          )}
          {issued.allocation.status === 'pending' && (
            <Banner tone="warn">
              נדרש מספר הקצאה מרשות המסים ({issued.allocation.reason}).
              {issued.allocation.lastError ? ` הבקשה לא הושלמה: ${issued.allocation.lastError}.${issued.allocation.retry ? ' תישלח שוב אוטומטית.' : ''}` : ' המסמך הונפק ונעול; את המספר מזינים ברשימת המסמכים (״ממתינים להקצאה״).'}
              {' '}עד שיתקבל המספר המסמך יודפס כ״העתק לעיון״ והלקוח לא יוכל לנכות ממנו מע״מ.
            </Banner>
          )}
          {issued.allocation.status === 'rejected' && (
            <Banner tone="bad">רשות המסים לא אישרה את החשבונית ({issued.allocation.rejectReason || issued.allocation.lastError}). יש לבחור איך ממשיכים — ברשימת המסמכים › ״מספר הקצאה״.</Banner>
          )}
          {issued.duplicate && <Banner tone="info">הבקשה כבר טופלה — זה המסמך שהופק בה.</Banner>}
        </div>
      )}

      {ctx && !issued && (
        <form id="doc-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
          <ErrorBanner error={action.error} />
          {!ctx.seller.ok && !external && (
            <Banner tone="warn">אי אפשר להפיק מסמך לפני שמוגדרים פרטי העסק: {ctx.seller.missing.join(', ')}. מגדירים בהגדרות › פרטי הנכס.</Banner>
          )}
          {external && !ctx.issuer.ready && (
            <Banner tone="bad">אי אפשר להפיק מסמך כרגע: {ctx.issuer.reason}</Banner>
          )}
          {external && ctx.issuer.ready && (
            <Banner tone="info">המסמך יופק במערכת החשבוניות{ctx.issuer.environment === 'live' ? '' : ' (סביבת בדיקות)'} ויקבל שם את מספרו. פרטי העסק ומספר ההקצאה נקבעים שם.</Banner>
          )}

          <div>
            <div className="ui-label">סוג המסמך</div>
            <div className="doc-types" role="radiogroup" aria-label="סוג המסמך">
              {TYPE_ORDER.map((t) => {
                const a = ctx.types[t] || {};
                return (
                  <button type="button" key={t} role="radio" aria-checked={type === t} className={`doc-type ${type === t ? 'is-on' : ''}`} disabled={!a.ok} title={a.ok ? undefined : a.why} onClick={() => setType(t)}>
                    <b>{DOC_TYPE_LABELS[t]}{ctx.recommended === t ? ' · מומלץ' : ''}</b>
                    <small>{a.ok ? DOC_TYPE_HINTS[t] : a.why}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="ui-label">נמען</div>
            <Segmented
              label="סוג נמען"
              value={buyer.kind}
              onChange={switchKind}
              options={[{ value: 'private', label: 'אורח פרטי' }, { value: 'business', label: ctx.buyers.company ? `עסק · ${ctx.buyers.company.name}` : 'עסק / חברה' }]}
            />
            <div className="ui-grid-2" style={{ marginTop: 8 }}>
              <Field id="db-name" label={buyer.kind === 'business' ? 'שם העסק' : 'שם'} required>
                <input id="db-name" className="input w-full" maxLength={120} value={buyer.name || ''} onChange={setB('name')} />
              </Field>
              {buyer.kind === 'business' ? (
                <Field id="db-vat" label="ע.מ. / ח.פ." required hint="9 ספרות">
                  <input id="db-vat" className="input w-full" dir="ltr" inputMode="numeric" maxLength={11} value={buyer.vatNumber || ''} onChange={(ev) => setBuyer((b) => ({ ...b, vatNumber: digits(ev.target.value).slice(0, 9) }))} />
                </Field>
              ) : (
                <Field id="db-id" label="ת.ז." optional>
                  <input id="db-id" className="input w-full" dir="ltr" inputMode="numeric" maxLength={9} value={buyer.idNumber || ''} onChange={(ev) => setBuyer((b) => ({ ...b, idNumber: digits(ev.target.value).slice(0, 9) }))} />
                </Field>
              )}
              <Field id="db-addr" label="כתובת" required={buyer.kind === 'business'} optional={buyer.kind !== 'business'}>
                <input id="db-addr" className="input w-full" maxLength={200} value={buyer.address || ''} onChange={setB('address')} />
              </Field>
              <Field id="db-mail" label="אימייל" optional>
                <input id="db-mail" type="email" className="input w-full" dir="ltr" maxLength={120} value={buyer.email || ''} onChange={setB('email')} />
              </Field>
            </div>
          </div>

          {withCharges && ctx.charges.length > 0 && (
            <div>
              <div className="ui-label">חיובים במסמך ({ctx.charges.length})</div>
              <table className="ui-table">
                <tbody>
                  {ctx.charges.map((c) => (
                    <tr key={c.id}>
                      <td className="ui-nowrap ui-num">{formatShort(c.serviceDate)}</td>
                      <td>{c.description}{c.vatRate === 0 ? <span className="ui-sub"> · ללא מע״מ</span> : null}</td>
                      <td className="ui-amount" style={{ textAlign: 'left' }}>{money(c.gross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <KeyValues rows={[['לפני מע״מ', money(totals.net)], ['מע״מ', money(totals.vat)], ['סה״כ', <b key="g">{money(totals.gross)}</b>]]} />
            </div>
          )}

          {withPayments && ctx.payments.length > 0 && (
            <div>
              <div className="ui-label">תקבולים במסמך ({ctx.payments.length})</div>
              <table className="ui-table">
                <tbody>
                  {ctx.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="ui-nowrap ui-num">{formatShort(p.date)}</td>
                      <td>{PAY_METHOD_LABELS[p.method] || p.method}<span className="ui-sub"> · {p.description}</span></td>
                      <td className="ui-amount" style={{ textAlign: 'left' }}>{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {type === 'tax_invoice' && ctx.totals.payments > 0.005 && <Banner tone="info">יש תקבולים בחשבון שטרם הופקה עליהם קבלה ({money(ctx.totals.payments)}). אחרי החשבונית אפשר להפיק קבלה.</Banner>}
          {needsAlloc && (
            <Banner tone="warn">
              <Hash size={14} /> חשבונית לעוסק מורשה מעל {needsAlloc.toLocaleString('he-IL')} ₪ לפני מע״מ — נדרש מספר הקצאה מרשות המסים. המסמך יונפק ויסומן ״ממתין״ עד שיוזן המספר.
            </Banner>
          )}

          {canAsk && (
            <label className="ui-check"><input type="checkbox" checked={askAlloc} onChange={(ev) => setAskAlloc(ev.target.checked)} /><span>הלקוח ביקש מספר הקצאה לחשבונית (גם מתחת לסף)</span></label>
          )}

          <Field id="db-notes" label="הערה על המסמך" optional>
            <input id="db-notes" className="input w-full" maxLength={500} value={notes} onChange={(ev) => setNotes(ev.target.value)} />
          </Field>
        </form>
      )}
    </Modal>
  );
}

const DECISIONS = {
  continue: { label: 'הפקה בלי מספר', hint: 'החשבונית נשארת סופית ותודפס עם ״אין לנכות מס תשומות בגין חשבונית זו״. הלקוח לא ינכה מע״מ.' },
  cancel: { label: 'ביטול החשבונית', hint: 'רשות המסים מעודכנת; את החשבונית מבטלים במסמך זיכוי מלא ומפיקים חדשה אם צריך.' },
  hearing: { label: 'בקשת שימוע', hint: 'מגישים בקשה בפורטל רשות המסים. אם תאושר — שולחים שוב מכאן (אותו מזהה חשבונית) או מזינים את המספר.' },
};

export function AllocationDialog({ open, onClose, propertyId, doc, onSaved }) {
  const action = useAction();
  const [mode, setMode] = useState('number');
  const [num, setNum] = useState('');
  const [reason, setReason] = useState('');
  const [ita, setIta] = useState(null);
  const state = doc?.allocation?.status;
  const api = ita?.mode === 'api' && ita?.connected;
  useEffect(() => {
    if (!open) return;
    setNum(''); setReason(''); action.reset();
    setMode(state === 'rejected' && !doc?.allocation?.decision ? 'continue' : 'number');
    finance.fiscal(propertyId).then((f) => setIta(f.ita)).catch(() => setIta(null));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = state === 'rejected'
    ? [...(!doc?.allocation?.decision ? ['continue', 'cancel', 'hearing'] : []), 'number', ...(api ? ['retry'] : [])]
    : ['number', ...(api ? ['retry'] : ['reject'])];
  const labels = { number: 'התקבל מספר', retry: 'שליחה חוזרת לרשות המסים', reject: 'הבקשה סורבה', ...Object.fromEntries(Object.entries(DECISIONS).map(([k, v]) => [k, v.label])) };
  let why = null;
  if (mode === 'number' && num.length !== 9) why = 'מספר הקצאה — 9 ספרות';
  if (mode === 'reject' && reason.trim().length < 3) why = 'נדרשת סיבת הסירוב';
  const submit = () => action.run(async () => {
    const body = mode === 'number' ? { allocationNumber: num } : mode === 'reject' ? { rejected: true, reason: reason.trim() } : mode === 'retry' ? { retry: true } : { decision: mode };
    const out = await finance.setAllocation(propertyId, doc.id, body);
    onSaved?.(out);
  });
  const a = doc?.allocation || {};
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={action.busy}
      width={540}
      title="מספר הקצאה"
      subtitle={doc ? `${DOC_TYPE_LABELS[doc.type] || doc.type} ${doc.number} · ${doc.buyer?.name || ''}` : ''}
      footer={(
        <>
          {why && <span className="ui-foot-note">{why}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
          <button type="submit" form="alloc-form" className={`btn ${['reject', 'cancel'].includes(mode) ? 'btn-danger' : 'btn-primary'}`} disabled={action.busy || !!why}>{action.busy ? <Spinner /> : mode === 'number' ? 'שמירת המספר' : mode === 'retry' ? 'שליחה' : mode === 'reject' ? 'רישום סירוב' : 'אישור הבחירה'}</button>
        </>
      )}
    >
      <form id="alloc-form" className="ui-stack" onSubmit={(ev) => { ev.preventDefault(); if (!why) submit(); }} noValidate>
        <ErrorBanner error={action.error} />
        {doc && <KeyValues rows={[['לפני מע״מ', money(doc.net)], ['סה״כ', money(doc.gross)], ['ע.מ. הנמען', doc.buyer?.vatNumber || '—'], ['בסיס החובה', a.reason || '—'], a.lastError && ['תשובה אחרונה', a.lastError], a.decision && ['החלטה שנרשמה', `${DECISIONS[a.decision]?.label}${a.decisionSent === false ? ' (לא דווחה לרשות — אין חיבור)' : ''}`]]} />}
        {state === 'rejected' && !a.decision && <Banner tone="bad">רשות המסים לא אישרה את החשבונית. לפי הנחיות רשות המסים יש לבחור אחת מהדרכים ולדווח עליה.</Banner>}
        {state === 'pending' && !api && <p className="ui-sub">את מספר ההקצאה מבקשים ממערכת ״חשבוניות ישראל״ של רשות המסים (או דרך רואה החשבון) ומזינים כאן. אפשר לחבר את המערכת לרשות המסים בהגדרות › מסמכים ורשות המסים, ואז המספר יתקבל אוטומטית. אין להמציא מספר.</p>}
        <Segmented label="פעולה" value={mode} onChange={setMode} options={options.map((o) => ({ value: o, label: labels[o] }))} />
        {DECISIONS[mode] && <Banner tone="info">{DECISIONS[mode].hint}{mode === 'hearing' && ita?.hearingPortal && <> · <a className="ui-link" href={ita.hearingPortal} target="_blank" rel="noreferrer">לפורטל רשות המסים</a></>}</Banner>}
        {mode === 'retry' && <p className="ui-sub">הבקשה תישלח שוב לרשות המסים עם אותו מזהה חשבונית{state === 'rejected' ? ' — רק אחרי שהשימוע אישר את החשבונית' : ''}.</p>}
        {mode === 'number' && (
          <Field id="al-num" label="מספר הקצאה" required hint="9 הספרות הימניות" error={action.fields.allocationNumber}>
            <input id="al-num" className="input w-full" dir="ltr" inputMode="numeric" autoComplete="off" maxLength={11} value={num} onChange={(ev) => setNum(digits(ev.target.value).slice(-9))} autoFocus />
          </Field>
        )}
        {mode === 'reject' && (
          <Field id="al-why" label="סיבת הסירוב" required error={action.fields.reason}>
            <input id="al-why" className="input w-full" maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} />
          </Field>
        )}
      </form>
    </Modal>
  );
}

export function SendDocumentDialog({ open, onClose, propertyId, doc, onSent }) {
  const action = useAction();
  const [to, setTo] = useState('');
  useEffect(() => { if (open) { setTo(doc?.buyer?.email || ''); action.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const why = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to.trim()) ? null : 'כתובת דוא״ל';
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={460} title="שליחת מסמך בדוא״ל" subtitle={doc ? `${DOC_TYPE_LABELS[doc.type] || doc.type} ${doc.number}` : ''} footer={(
      <>
        {why && <span className="ui-foot-note">{why}</span>}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
        <button type="button" className="btn btn-primary" disabled={action.busy || !!why} onClick={async () => { const out = await action.run(() => finance.sendDoc(propertyId, doc.id, to.trim())); if (out) onSent?.(out); }}>{action.busy ? <Spinner /> : <><Send size={14} /> שליחה</>}</button>
      </>
    )}>
      <div className="ui-stack">
        <ErrorBanner error={action.error} />
        <Field id="sd-to" label="אל" required><input id="sd-to" type="email" className="input w-full" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} autoFocus /></Field>
        <p className="ui-sub">נשלח העתק של המסמך (מסומן ״העתק — נשלח בדוא״ל״). המקור נשמר במערכת.{doc?.sent?.length ? ` נשלח בעבר אל: ${doc.sent.map((x) => x.to).join(', ')}.` : ''}</p>
      </div>
    </Modal>
  );
}

// Compact list of documents with print / allocation / credit actions (folio card, check-out, stay).
export function DocumentList({ docs, propertyId, onAllocate, onCredit, canCredit, onError, onChanged }) {
  const role = useAuthStore((s) => s.user?.role);
  const canAllocate = ALLOCATION_ROLES.includes(role);
  const [sending, setSending] = useState(null);
  if (!docs?.length) return null;
  return (
    <>
    <SendDocumentDialog open={!!sending} onClose={() => setSending(null)} propertyId={propertyId} doc={sending} onSent={() => { setSending(null); onChanged?.(); }} />
    <ul className="doc-list">
      {docs.map((d) => {
        const a = d.allocation?.status || 'not_required';
        return (
          <li key={d.id}>
            <div className="min-w-0">
              <div className="font-medium"><FileText size={13} style={{ display: 'inline', marginInlineEnd: 4 }} />{DOC_TYPE_LABELS[d.type] || d.type} <bdi>{d.number}</bdi></div>
              <div className="ui-sub">
                {money(d.type === 'receipt' ? d.paid : d.gross)}{d.buyer?.name ? ` · ${d.buyer.name}` : ''}{d.credited ? ` · זוכה ${money(d.credited)}` : ''}
                {a === 'approved' && d.allocation.number ? ` · הקצאה ${d.allocation.number}` : ''}
              </div>
              {a === 'pending' && <Tag tone="warn">{ALLOCATION_LABELS.pending}</Tag>}
              {a === 'rejected' && <Tag tone={d.allocation.decision === 'continue' ? 'warn' : 'bad'}>{d.allocation.decision === 'continue' ? 'הופקה בלי מספר הקצאה' : d.allocation.decision === 'hearing' ? 'בשימוע' : d.allocation.decision === 'cancel' ? 'לביטול במסמך זיכוי' : ALLOCATION_LABELS.rejected}</Tag>}
              {d.sent?.length > 0 && <span className="ui-sub"> · נשלח בדוא״ל</span>}
            </div>
            <div className="doc-acts">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openPrint(propertyId, d.id, onError)} title={a === 'pending' ? 'יודפס כהעתק לעיון עד הזנת מספר ההקצאה' : 'הדפסה'}><Printer size={14} />הדפסה</button>
              {d.issuer !== 'invoicer' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSending(d)}><Send size={14} />שליחה</button>}
              {d.issuer !== 'invoicer' && ['pending', 'rejected'].includes(a) && onAllocate && <button type="button" className="btn btn-secondary btn-sm" disabled={!canAllocate} title={canAllocate ? undefined : 'כספים או הנהלה'} onClick={() => onAllocate(d)}>מספר הקצאה</button>}
              {onCredit && d.issuer !== 'invoicer' && d.creditable > 0.005 && <button type="button" className="btn btn-secondary btn-sm" disabled={!canCredit} title={!canCredit ? 'כספים או הנהלה' : undefined} onClick={() => onCredit(d)}>זיכוי</button>}
            </div>
          </li>
        );
      })}
    </ul>
    </>
  );
}
