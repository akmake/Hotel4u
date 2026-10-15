// EXT-04 — non-resident guest: the evidence the desk records and the decision the property's rule
// gives. The tax effect is never chosen here: the approved rule (ADM-04, gate G04) decides it.
import { useEffect, useState } from 'react';
import { stay } from '../../utils/api';
import { countryOptions } from '../../lib/countries';
import { todayYmd } from '../../utils/date';
import { Modal, Field, ErrorBanner, Banner, Spinner, KeyValues, Pill, useAction, useLoader } from '../kit';

export const DECISION_TONE = { none: 'muted', resident: 'muted', pending_rule: 'warn', ineligible: 'warn', eligible: 'ok' };

// Shared fields — used in the dialog and inline in the check-in registration step.
export function TouristFields({ value, onChange, errors = {}, countryLocked = false, hideDoc = false, idPrefix = 'tr' }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const countries = countryOptions();
  return (
    <div className="ui-stack" style={{ gap: 8 }}>
      <label className="ui-check"><input type="checkbox" checked={!!value.nonResident} onChange={set('nonResident')} /><span>האורח אינו תושב ישראל (נכנס לישראל כמבקר)</span></label>
      {value.nonResident && (
        <div className="ui-grid-2">
          <Field id={`${idPrefix}-c`} label="מדינת הדרכון" required error={errors.passportCountry} hint={countryLocked ? 'לפי האזרחות שנרשמה' : undefined}>
            <select id={`${idPrefix}-c`} className="select w-full" disabled={countryLocked} value={value.passportCountry || ''} onChange={set('passportCountry')}>
              <option value="">בחירה…</option>
              {countries.filter((c) => c.code !== 'IL').map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>
          <Field id={`${idPrefix}-v`} label="סוג אשרת הכניסה" required error={errors.visaType} hint="כפי שמופיע בפתק הכניסה / בדרכון (למשל B/2)">
            <input id={`${idPrefix}-v`} className="input w-full" dir="ltr" maxLength={20} value={value.visaType || ''} onChange={set('visaType')} />
          </Field>
          <Field id={`${idPrefix}-e`} label="תאריך הכניסה לישראל" required error={errors.entryDate}>
            <input id={`${idPrefix}-e`} type="date" className="input w-full" max={todayYmd()} value={value.entryDate || ''} onChange={set('entryDate')} />
          </Field>
          {!hideDoc && (
            <Field id={`${idPrefix}-d`} label="4 ספרות אחרונות של הדרכון" optional error={errors.docLast4} hint="לא את המספר המלא">
              <input id={`${idPrefix}-d`} className="input w-full" dir="ltr" inputMode="numeric" maxLength={4} value={value.docLast4 || ''} onChange={(e) => onChange({ ...value, docLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

export function TouristSummary({ data }) {
  if (!data) return null;
  const e = data.evidence;
  return (
    <div className="ui-stack" style={{ gap: 6 }}>
      <div className="ui-row" style={{ gap: 6 }}><Pill tone={DECISION_TONE[data.decision]}>{data.decisionLabel}</Pill></div>
      {data.reason && <div className="ui-sub">{data.reason}</div>}
      {e.nonResident && <KeyValues rows={[['דרכון', e.passportCountry], ['אשרה', e.visaType], ['כניסה לישראל', e.entryDate], e.docLast4 ? ['4 ספרות אחרונות', e.docLast4] : null, ['נרשם', data.recordedBy || '—']]} />}
      {data.decision === 'eligible' && data.postedWithVat > 0 && <Banner tone="warn">{data.postedWithVat} חיובי לינה כבר נרשמו עם מע״מ לפני הרישום. לתיקון: היפוך החיוב במסך החשבון ורישום מחדש ייעשה ללא מע״מ.</Banner>}
      {data.decision === 'pending_rule' && <div className="ui-sub">כשמנהל/כספים יאשר בנכס כלל פטור (בהתאם לרו״ח) — החיובים הבאים יחושבו לפיו אוטומטית.</div>}
    </div>
  );
}

export default function TouristDialog({ open, onClose, propertyId, reservationId, onDone }) {
  const action = useAction();
  const { data, loading, error, reload } = useLoader(async () => (open ? stay.tourist(propertyId, reservationId) : null), [open, reservationId]);
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open || !data) return;
    const e = data.evidence;
    setF(data.recorded ? { nonResident: e.nonResident, passportCountry: e.passportCountry || '', visaType: e.visaType || '', entryDate: e.entryDate || '', docLast4: e.docLast4 || '' }
      : { nonResident: !!(data.prefill?.passportCountry && data.prefill.passportCountry !== 'IL'), passportCountry: data.prefill?.passportCountry && data.prefill.passportCountry !== 'IL' ? data.prefill.passportCountry : '', visaType: '', entryDate: '', docLast4: '' });
    action.reset();
  }, [open, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const why = f.nonResident && (!f.passportCountry ? 'מדינת דרכון' : !f.visaType?.trim() ? 'סוג אשרה' : !f.entryDate ? 'תאריך כניסה' : null);
  const submit = () => action.run(async () => { const out = await stay.recordTourist(propertyId, reservationId, f); await reload(); onDone?.(out); });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={560} title="תושבות ומעמד מס"
      footer={(
        <>
          {why && <span className="ui-foot-note">{why}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>סגירה</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={action.busy || !!why || !data}>{action.busy ? <Spinner /> : 'שמירה'}</button>
        </>
      )}>
      <ErrorBanner error={error || action.error} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && (
        <>
          {data.recorded && <TouristSummary data={data} />}
          <TouristFields value={f} onChange={setF} errors={action.fields} />
          <div className="ui-sub">
            {data.rule.enabled
              ? `כלל הנכס (גרסה ${data.rule.version}, אושר ע״י ${data.rule.approvedBy || '—'}): אשרות ${data.rule.visaTypes.join(', ') || '—'} · חל על ${data.rule.chargeCodes.join(', ')}.`
              : 'בנכס לא אושר כלל פטור לתייר — המע״מ נגבה כרגיל עד שיוגדר כלל מאושר (מסך כלל מס).'}
          </div>
        </>
      )}
    </Modal>
  );
}
