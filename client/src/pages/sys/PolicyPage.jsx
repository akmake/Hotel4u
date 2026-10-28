// ADM-05 — operating and cancellation policy. Business rules are edited here and published as a
// new version (with a reason); existing bookings keep the terms frozen on them. Legal rights are
// not configured here — the rest-day calendar only feeds the cancellation proposal (gate G06).
import { useEffect, useMemo, useState } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { platform } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, Card, Field, ErrorBanner, Banner, Spinner, KeyValues, Modal, Tag, useLoader, useAction, money, formatDateTime } from '../../components/kit';
import AdminNav from '../../components/sys/AdminNav';

const ADMIN = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
const PETS = { not_allowed: 'אסור', on_request: 'בתיאום מראש', allowed: 'מותר' };
const SMOKING = { non_smoking: 'אסור בכל הנכס', designated_areas: 'באזורים מיועדים', allowed: 'מותר' };
const LABELS = {
  checkInTime: 'שעת כניסה', checkOutTime: 'שעת יציאה', readiness: 'מוכנות לכניסה', requireGuarantee: 'ערבות', requireRegistration: 'רישום אורח',
  requireSignature: 'חתימה', terms: 'נוסח תנאים', inspectorMustDiffer: 'הפרדת מנקה/בודק', cancellation: 'ביטול חוזי', finance: 'כספים',
  childMaxAge: 'גיל ילד', petPolicy: 'חיות', smokingPolicy: 'עישון', restDays: 'ימי מנוחה',
};

export default function PolicyPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = ADMIN.includes(role);
  const { toasts, success } = useToast();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? platform.policy(propertyId) : null), [propertyId]);
  const [f, setF] = useState(null);
  const [newDay, setNewDay] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const pub = useAction();
  useEffect(() => { if (data) setF(JSON.parse(JSON.stringify(data))); }, [data]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const changed = useMemo(() => (f && data ? Object.keys(LABELS).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(data[k])) : []), [f, data]);
  const termsChanged = f && data && f.terms.text.trim() !== data.terms.text.trim();

  if (loading && !data) return <Page><div className="ui-empty"><Spinner /> טוען…</div></Page>;
  if (error) return <Page><ErrorBanner error={error} onRetry={reload} /></Page>;
  if (!f) return null;

  const why = !changed.length ? 'לא שונה דבר' : termsChanged && (f.terms.approvedBy || '').trim().length < 2 ? 'שינוי נוסח התנאים מחייב מאשר' : null;
  async function publish() {
    const out = await pub.run(() => platform.publishPolicy(propertyId, {
      version: data.version, reason,
      checkInTime: f.checkInTime, checkOutTime: f.checkOutTime, readiness: f.readiness,
      requireGuarantee: f.requireGuarantee, requireRegistration: f.requireRegistration, requireSignature: f.requireSignature,
      inspectorMustDiffer: f.inspectorMustDiffer, cancellation: f.cancellation, finance: f.finance,
      childMaxAge: f.childMaxAge === '' ? null : f.childMaxAge, petPolicy: f.petPolicy, smokingPolicy: f.smokingPolicy, restDays: f.restDays,
      ...(termsChanged ? { terms: { text: f.terms.text, approvedBy: f.terms.approvedBy } } : {}),
    }));
    if (out) { setConfirm(false); setReason(''); success(`פורסמה גרסה ${out.version}`); reload(); }
  }

  const disabled = !canEdit;
  return (
    <Page title="מדיניות תפעול וביטול" back="/pms">
      <ToastContainer toasts={toasts} />
      <AdminNav end={<span className="ui-muted">גרסה {data.version}{data.publishedBy ? ` · ${data.publishedBy} · ${formatDateTime(data.publishedAt)}` : ''}</span>} />
      {!canEdit && <Banner tone="info">צפייה בלבד — פרסום מדיניות מותר למנהל נכס.</Banner>}
      <Card title="כניסה ויציאה">
        <div className="ui-grid-3">
          <Field id="pl-ci" label="שעת כניסה" required><input id="pl-ci" type="time" className="input w-full" disabled={disabled} value={f.checkInTime} onChange={(e) => set('checkInTime')(e.target.value)} /></Field>
          <Field id="pl-co" label="שעת יציאה" required><input id="pl-co" type="time" className="input w-full" disabled={disabled} value={f.checkOutTime} onChange={(e) => set('checkOutTime')(e.target.value)} /></Field>
          <Field id="pl-rd" label="חדר מוכן לכניסה כש…" required>
            <select id="pl-rd" className="select w-full" disabled={disabled} value={f.readiness} onChange={(e) => set('readiness')(e.target.value)}><option value="clean">נקי</option><option value="inspected">נבדק על ידי מפקח</option></select>
          </Field>
        </div>
        <div className="ui-stack" style={{ gap: 6 }}>
          <label className="ui-check"><input type="checkbox" disabled={disabled} checked={f.requireGuarantee} onChange={(e) => set('requireGuarantee')(e.target.checked)} /><span>נדרשת ערבות לפני כניסה (חריג — מנהל משמרת עם סיבה)</span></label>
          <label className="ui-check"><input type="checkbox" disabled={disabled} checked={f.requireRegistration} onChange={(e) => set('requireRegistration')(e.target.checked)} /><span>נדרש כרטיס רישום אורח לפני כניסה</span></label>
          <label className="ui-check"><input type="checkbox" disabled={disabled} checked={f.requireSignature} onChange={(e) => set('requireSignature')(e.target.checked)} /><span>חתימת אורח חובה ברישום</span></label>
          <label className="ui-check"><input type="checkbox" disabled={disabled} checked={f.inspectorMustDiffer} onChange={(e) => set('inspectorMustDiffer')(e.target.checked)} /><span>מי שניקה חדר אינו מאשר אותו בבדיקה</span></label>
        </div>
      </Card>
      <Card title="נוסח תנאי השהייה (מוצג בחתימת האורח)">
        <Field id="pl-terms" label={`נוסח מאושר · גרסה ${data.terms.version}`} hint={data.terms.approvedBy ? `אושר ע״י ${data.terms.approvedBy} · ${formatDateTime(data.terms.approvedAt)}` : 'טרם הוגדר נוסח מאושר — חתימה לא נחשבת "חתומה" עד שיוגדר'}>
          <textarea id="pl-terms" className="input w-full" rows={5} maxLength={20000} disabled={disabled} value={f.terms.text} onChange={(e) => set('terms')({ ...f.terms, text: e.target.value })} />
        </Field>
        {termsChanged && (
          <Field id="pl-app" label="שם המאשר (משפטי/הנהלה)" required><input id="pl-app" className="input w-full" maxLength={120} value={f.terms.approvedBy || ''} onChange={(e) => set('terms')({ ...f.terms, approvedBy: e.target.value })} /></Field>
        )}
      </Card>
      <Card title="ביטול חוזי (נפרד מזכויות לפי דין)">
        <div className="ui-grid-3">
          <Field id="pl-fh" label="ביטול חינם עד (שעות לפני ההגעה)" required><input id="pl-fh" type="number" min="0" max="1440" className="input w-full" disabled={disabled} value={f.cancellation.freeHours} onChange={(e) => set('cancellation')({ ...f.cancellation, freeHours: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
          <Field id="pl-ft" label="אחר כך" required>
            <select id="pl-ft" className="select w-full" disabled={disabled} value={f.cancellation.fee.type} onChange={(e) => set('cancellation')({ ...f.cancellation, fee: { type: e.target.value, amount: f.cancellation.fee.amount || '' } })}>
              <option value="first_night">חיוב הלילה הראשון</option><option value="fixed">סכום קבוע</option><option value="none">ללא דמי ביטול</option>
            </select>
          </Field>
          {f.cancellation.fee.type === 'fixed' && <Field id="pl-fa" label="סכום" required><input id="pl-fa" type="number" min="1" className="input w-full" disabled={disabled} value={f.cancellation.fee.amount || ''} onChange={(e) => set('cancellation')({ ...f.cancellation, fee: { type: 'fixed', amount: Number(e.target.value) } })} /></Field>}
        </div>
        <div className="ui-sub">תנאי חוזי אינו גובר על זכות ביטול לפי דין. מנוע הביטול מציע ומסמן לבדיקה; דמי ביטול לא נגבים אוטומטית (שער G06).</div>
        <div>
          <div className="ui-section-title">ימי מנוחה וחגים (למניין ימים בביטול — שבתות נספרות תמיד)</div>
          <div className="ui-row">
            {(f.restDays || []).map((d) => <span key={d} className="ui-chip">{d}{!disabled && <button type="button" aria-label={`הסרת ${d}`} onClick={() => set('restDays')(f.restDays.filter((x) => x !== d))}>×</button>}</span>)}
            {(f.restDays || []).length === 0 && <span className="ui-sub">לא הוגדרו</span>}
          </div>
          {!disabled && (
            <div className="ui-row" style={{ marginTop: 6 }}>
              <input type="date" className="input" value={newDay} onChange={(e) => setNewDay(e.target.value)} aria-label="יום מנוחה" />
              <button type="button" className="btn btn-secondary btn-sm" disabled={!newDay || f.restDays.includes(newDay)} onClick={() => { set('restDays')([...f.restDays, newDay].sort()); setNewDay(''); }}>הוספה</button>
            </div>
          )}
        </div>
      </Card>
      <Card title="כספים">
        <div className="ui-grid-2">
          <Field id="pl-rf" label="החזר מעל סכום זה דורש מנהל/כספים" hint="0 = כל החזר דורש מנהל"><input id="pl-rf" type="number" min="0" className="input w-full" disabled={disabled} value={f.finance.refundApprovalOver} onChange={(e) => set('finance')({ ...f.finance, refundApprovalOver: Number(e.target.value || 0) })} /></Field>
          <Field id="pl-cl" label="מזומן מצטבר מקסימלי לשהייה" optional hint="ריק = ללא בדיקה. הסף החוקי — החלטת בעל העסק (שער G05)"><input id="pl-cl" type="number" min="1" className="input w-full" disabled={disabled} value={f.finance.cashLimitPerStay ?? ''} onChange={(e) => set('finance')({ ...f.finance, cashLimitPerStay: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
        </div>
      </Card>
      <Card title="אורחים">
        <div className="ui-grid-3">
          <Field id="pl-ch" label="גיל מרבי של ילד (כלל עסקי)" optional hint="משמש לתמחור ולהרכב — לא דרישת חוק"><input id="pl-ch" type="number" min="0" max="17" className="input w-full" disabled={disabled} value={f.childMaxAge ?? ''} onChange={(e) => set('childMaxAge')(e.target.value === '' ? '' : Number(e.target.value))} /></Field>
          <Field id="pl-pt" label="חיות מחמד"><select id="pl-pt" className="select w-full" disabled={disabled} value={f.petPolicy} onChange={(e) => set('petPolicy')(e.target.value)}>{Object.entries(PETS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field id="pl-sm" label="עישון"><select id="pl-sm" className="select w-full" disabled={disabled} value={f.smokingPolicy} onChange={(e) => set('smokingPolicy')(e.target.value)}>{Object.entries(SMOKING).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        <div className="ui-sub">כלב נחייה/שירות אינו "חיית מחמד" — הסדר נגישות לפי דין גובר על כלל זה.</div>
      </Card>
      {canEdit && (
        <div className="ui-step-foot">
          {changed.length > 0 && <span className="ui-foot-note">שונו: {changed.map((k) => LABELS[k]).join(', ')}</span>}
          <button type="button" className="btn btn-secondary" disabled={!changed.length} onClick={() => setF(JSON.parse(JSON.stringify(data)))}>ביטול שינויים</button>
          <button type="button" className="btn btn-primary" disabled={!!why} title={why || undefined} onClick={() => setConfirm(true)}>פרסום גרסה {data.version + 1}</button>
        </div>
      )}
      {data.history.length > 0 && (
        <Card title="היסטוריית פרסומים">
          <ul className="ui-staff">{data.history.map((h, i) => <li key={i}><span>גרסה {h.version} · {h.changed.map((k) => LABELS[k] || k).join(', ') || '—'}{h.reason ? ` · ${h.reason}` : ''}</span><span className="ui-sub">{h.by} · {formatDateTime(h.at)}</span></li>)}</ul>
        </Card>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} busy={pub.busy} width={480} title={`פרסום גרסה ${data.version + 1}`} footer={(
        <>
          {reason.trim().length < 3 && <span className="ui-foot-note">נדרשת סיבה</span>}
          <button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)} disabled={pub.busy}>ביטול</button>
          <button type="button" className="btn btn-primary" disabled={pub.busy || reason.trim().length < 3} onClick={publish}>{pub.busy ? <Spinner /> : 'פרסום'}</button>
        </>
      )}>
        <ErrorBanner error={pub.error} />
        <KeyValues rows={changed.map((k) => [LABELS[k], 'ישתנה'])} />
        <Banner tone="info">חל על כניסות ועל הזמנות חדשות מעכשיו. הזמנות קיימות שומרות את תנאי הביטול והמחיר שנשמרו בהן.</Banner>
        <Field id="pl-why" label="סיבת השינוי" required error={pub.fields.reason}><input id="pl-why" className="input w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {termsChanged && <Tag tone="warn">נוסח התנאים ישתנה לגרסה חדשה (מאשר: {f.terms.approvedBy})</Tag>}
        {f.finance.cashLimitPerStay ? <div className="ui-sub">מגבלת מזומן: {money(f.finance.cashLimitPerStay)}</div> : null}
      </Modal>
    </Page>
  );
}
