// ADM-04 (gates G04 / G05) — the property's tax and cash rules for guests from abroad.
// Tourist zero-rating stays OFF until the property's accountant approves it: switching it on records
// who approved it and the legal basis, and bumps a version every posted line refers to. The cash-law
// rule (directive 1/2024 thresholds) is the owner's decision. Nothing here is legal advice — the
// screen only enforces what the property approved.
import { useEffect, useState } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { useChargeCodes } from '../../hooks/useChargeCodes';
import { Page, Card, Field, ErrorBanner, Banner, Spinner, Pill, useLoader, useAction, money, formatDateTime } from '../../components/kit';
import AdminNav from '../../components/sys/AdminNav';

const TAX_ADMIN_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];

export default function TaxPolicyPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = TAX_ADMIN_ROLES.includes(role);
  const { toasts, success } = useToast();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.taxPolicy(propertyId) : null), [propertyId]);
  const { charges } = useChargeCodes(propertyId);
  const [f, setF] = useState(null);
  const [visaInput, setVisaInput] = useState('');
  const [reason, setReason] = useState('');
  const save = useAction();
  useEffect(() => { if (data) { setF(JSON.parse(JSON.stringify(data))); setReason(''); } }, [data]);
  if (loading && !data) return <Page><div className="ui-empty"><Spinner /> טוען…</div></Page>;
  if (error) return <Page><ErrorBanner error={error} onRetry={reload} /></Page>;
  if (!f) return null;
  const t = f.tourist;
  const setT = (patch) => setF((p) => ({ ...p, tourist: { ...p.tourist, ...patch } }));
  const setC = (patch) => setF((p) => ({ ...p, cash: { ...p.cash, ...patch } }));
  const changed = JSON.stringify(f) !== JSON.stringify(data);
  const e = save.fields;
  let why = null;
  if (!changed) why = 'לא שונה דבר';
  else if (t.enabled && (t.approvedBy || '').trim().length < 2) why = 'שם רואה החשבון שאישר';
  else if (t.enabled && (t.legalRef || '').trim().length < 3) why = 'הבסיס החוקי';
  else if (t.enabled && !t.visaTypes.length) why = 'לפחות סוג אשרה אחד';
  else if (reason.trim().length < 3) why = 'סיבת השינוי';
  async function submit() {
    const out = await save.run(() => finance.setTaxPolicy(propertyId, { version: data.tourist.version, reason: reason.trim(), tourist: t, cash: f.cash }));
    if (out) { success(`נשמר · גרסה ${out.tourist.version}`); reload(); }
  }
  const addVisa = () => { const v = visaInput.trim().toUpperCase(); if (v && !t.visaTypes.includes(v)) setT({ visaTypes: [...t.visaTypes, v] }); setVisaInput(''); };
  const dis = !canEdit;
  return (
    <Page title="מדיניות מס" back="/pms">
      <ToastContainer toasts={toasts} />
      <AdminNav end={<span className="ui-muted">גרסה {data.tourist.version}{data.tourist.updatedBy ? ` · ${data.tourist.updatedBy}` : ''}{data.tourist.approvedAt ? ` · ${formatDateTime(data.tourist.approvedAt)}` : ''}</span>} />
      {!canEdit && <Banner tone="info">צפייה בלבד — הגדרת כללי מס מותרת להנהלה ולכספים.</Banner>}
      <ErrorBanner error={save.error} />
      <Card title="לינה ללא מע״מ לתייר" actions={<Pill tone={data.tourist.enabled ? 'ok' : 'muted'}>{data.tourist.enabled ? 'פעיל' : 'כבוי'}</Pill>}>
        <Banner tone="warn">הפעלה רק לפי אישור רואה החשבון של הנכס ובהתאם לנוסח החוק העדכני. מדינת דרכון לבדה אינה מקנה פטור — המערכת בודקת תושבות, סוג אשרה ותאריך כניסה שנרשמו בקבלה.</Banner>
        <label className="ui-check"><input type="checkbox" disabled={dis} checked={t.enabled} onChange={(ev) => setT({ enabled: ev.target.checked })} /><span>להפעיל: אורח זכאי לפי הכלל יחויב בשירותים שנבחרו ללא מע״מ</span></label>
        <div className="ui-grid-2">
          <Field id="tx-by" label="אושר על ידי (רו״ח)" required={t.enabled} error={e.approvedBy}><input id="tx-by" className="input w-full" disabled={dis} maxLength={120} value={t.approvedBy} onChange={(ev) => setT({ approvedBy: ev.target.value })} /></Field>
          <Field id="tx-ref" label="בסיס חוקי" required={t.enabled} error={e.legalRef} hint="חוק / תקנה / סעיף"><input id="tx-ref" className="input w-full" disabled={dis} maxLength={300} value={t.legalRef} onChange={(ev) => setT({ legalRef: ev.target.value })} /></Field>
        </div>
        <Field id="tx-visa" label="סוגי אשרה מזכים" required={t.enabled} error={e.visaTypes} hint="כפי שקבע רואה החשבון">
          <div className="ui-row">
            {t.visaTypes.map((v) => <span key={v} className="ui-chip">{v}{!dis && <button type="button" aria-label={`הסרת ${v}`} onClick={() => setT({ visaTypes: t.visaTypes.filter((x) => x !== v) })}>×</button>}</span>)}
            {!dis && <><input id="tx-visa" className="input" dir="ltr" style={{ width: 110 }} maxLength={20} value={visaInput} onChange={(ev) => setVisaInput(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addVisa(); } }} placeholder="B/2" /><button type="button" className="btn btn-secondary btn-sm" onClick={addVisa} disabled={!visaInput.trim()}>הוספה</button></>}
          </div>
        </Field>
        <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
          <legend className="ui-label">שירותים שהפטור חל עליהם</legend>
          <div className="ui-row" style={{ flexWrap: 'wrap', gap: 12 }}>
            {charges.filter((c) => c.active).map((c) => (
              <label key={c.code} className="ui-check"><input type="checkbox" disabled={dis} checked={t.chargeCodes.includes(c.code)} onChange={(ev) => setT({ chargeCodes: ev.target.checked ? [...t.chargeCodes, c.code] : t.chargeCodes.filter((x) => x !== c.code) })} /><span>{c.name}</span></label>
            ))}
          </div>
        </fieldset>
      </Card>
      <Card title="מגבלת מזומן" actions={<Pill tone={data.cash.rule === 'il_2024' ? 'ok' : 'muted'}>{data.cash.rule === 'il_2024' ? 'פעיל' : 'כבוי'}</Pill>}>
        <label className="ui-radio"><input type="radio" name="cash" disabled={dis} checked={f.cash.rule === 'none'} onChange={() => setC({ rule: 'none' })} /><span>ללא כלל חוקי<span className="ui-sub" style={{ display: 'block' }}>רק המגבלה הפנימית במדיניות (אם הוגדרה)</span></span></label>
        <label className="ui-radio"><input type="radio" name="cash" disabled={dis} checked={f.cash.rule === 'il_2024'} onChange={() => setC({ rule: 'il_2024' })} /><span>חוק צמצום השימוש במזומן (הוראת ביצוע 1/2024)<span className="ui-sub" style={{ display: 'block' }}>עד הסף — ללא הגבלה; מעליו — הנמוך מ־10% מהעסקה ומהסף. לתייר מאומת — סף גבוה. נבדק מצטבר לכל השהייה.</span></span></label>
        {f.cash.rule === 'il_2024' && (
          <div className="ui-grid-2">
            <Field id="tx-th" label="סף — עסקה רגילה" required error={e.cashThreshold}><input id="tx-th" type="number" min="1" className="input w-full" disabled={dis} value={f.cash.threshold} onChange={(ev) => setC({ threshold: Number(ev.target.value) })} /></Field>
            <Field id="tx-tth" label="סף — תייר מאומת" required><input id="tx-tth" type="number" min="1" className="input w-full" disabled={dis} value={f.cash.touristThreshold} onChange={(ev) => setC({ touristThreshold: Number(ev.target.value) })} /></Field>
          </div>
        )}
        {f.cash.rule === 'il_2024' && <div className="ui-sub">לדוגמה: עסקה של {money(8000)} — מזומן עד {money(Math.min(800, f.cash.threshold))} לתושב; לתייר מאומת עד {money(8000 <= f.cash.touristThreshold ? 8000 : Math.min(800, f.cash.touristThreshold))}.</div>}
      </Card>
      {canEdit && (
        <Card>
          <div className="ui-row" style={{ alignItems: 'flex-end' }}>
            <Field id="tx-why" label="סיבת השינוי" required error={e.reason}><input id="tx-why" className="input" style={{ minWidth: 320 }} maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
            {why && <span className="ui-foot-note">{why}</span>}
            <button type="button" className="btn btn-primary" disabled={!!why || save.busy} onClick={submit}>{save.busy ? <Spinner /> : 'שמירה'}</button>
          </div>
          <div className="ui-sub">כל שינוי נרשם ביומן הביקורת עם הסיבה. חיובים שכבר נרשמו לא משתנים.</div>
        </Card>
      )}
    </Page>
  );
}
