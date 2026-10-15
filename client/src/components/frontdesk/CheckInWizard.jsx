// FD-03 — check-in wizard. Steps: stay units → guest registration (FD-05) → guarantee (FIN-03)
// → summary & confirm. Nothing here decides readiness; it renders the server's reasons and the
// server re-checks everything on "השלמת צ׳ק-אין". Moving between steps never commits anything.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, BedDouble, KeyRound, ChevronDown, AlertTriangle, Star } from 'lucide-react';
import { frontdesk, finance, stay as stayApi } from '../../utils/api';
import { TouristFields, TouristSummary } from '../stay/TouristDialog';
import { useChargeCodes } from '../../hooks/useChargeCodes';
import { GUARANTEE_LABELS, ID_DOC_LABELS, cleanLabel, opsLabel } from '../../lib/labels';
import { countryOptions } from '../../lib/countries';
import { formatShort } from '../../utils/date';
import { Modal, Field, Spinner, ErrorBanner, ReadinessBadge, ReasonList, newOpKey } from '../kit';
import SignaturePad from './SignaturePad';

const money = (n, cur = 'ILS') => new Intl.NumberFormat('he-IL', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n || 0));

export default function CheckInWizard({ open, propertyId, reservationId, isManager, onClose, onDone, onAssign, onQueue }) {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
    const [selected, setSelected] = useState([]);
  const [result, setResult] = useState(null);
  const [method, setMethod] = useState(''); // guarantee method; sent with the final confirmation
  const [guaranteeRef, setGuaranteeRef] = useState('');
  // Registration input lives here so moving between steps never loses what was typed.
  const [regDraft, setRegDraft] = useState(null);

  const load = useCallback(async () => {
    if (!reservationId) return null;
    setLoading(true); setLoadError(null);
    try {
      const data = await frontdesk.checkInContext(propertyId, reservationId);
      setCtx(data);
      return data;
    } catch (e) {
      setLoadError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [propertyId, reservationId]);

  useEffect(() => {
    if (!open) return;
    setCtx(null); setOpenSec(undefined); setResult(null); setMethod(''); setGuaranteeRef(''); setRegDraft(null);
    load().then((data) => {
      if (!data) return;
      setMethod(data.reservation.guaranteeType && data.reservation.guaranteeType !== 'none' ? data.reservation.guaranteeType : '');
      const open_ = data.units.filter((u) => !['checked_in'].includes(u.readiness.state));
      // Pre-select units that are ready; a single unit is always pre-selected.
      const pre = open_.length === 1 ? open_ : open_.filter((u) => u.readiness.state === 'ready');
      // Units are selected by their position: stable even before unit records exist on the server.
      setSelected(pre.map((u) => u.index));
    });
  }, [open, load]);

  const units = ctx?.units || [];
  const openUnits = units.filter((u) => u.readiness.state !== 'checked_in');
  const chosen = openUnits.filter((u) => selected.includes(u.index));
  const regDone = !!ctx?.registration;
  const guaranteeOk = !!ctx?.guarantee?.ok;

  const title = ctx ? `צ׳ק-אין — ${ctx.guest.firstName} ${ctx.guest.lastName}` : 'צ׳ק-אין';
  const subtitle = ctx
    ? `${ctx.reservation.confirmationNumber} · ${formatShort(ctx.reservation.arrivalDate)}–${formatShort(ctx.reservation.departureDate)} · ${ctx.reservation.nights} לילות · ${ctx.reservation.adults} מבוגרים${ctx.reservation.children ? ` · ${ctx.reservation.children} ילדים` : ''}`
    : '';

  // Sections, not pages: everything is on one screen; the first thing that needs the desk is open.
  const unitsOk = chosen.length > 0 && chosen.every((u) => u.readiness.state === 'ready' || u.readiness.reasons.every((r) => r.code === 'guarantee'));
  const regOk = regDone || !ctx?.policy?.requireRegistration;
  const guaranteeDone = guaranteeOk || !ctx?.policy?.requireGuarantee;
  const stepDone = { units: unitsOk, registration: regOk, guarantee: guaranteeDone };
  const firstOpen = ['units', 'registration', 'guarantee'].find((id) => !stepDone[id]) || null;
  const [openSec, setOpenSec] = useState(undefined); // undefined = not chosen by the user yet
  const current = openSec === undefined ? firstOpen : openSec;
  const toggle = (id) => setOpenSec(current === id ? null : id);
  const next = (id) => setOpenSec(id);

  const summaries = ctx ? {
    units: chosen.length
      ? chosen.map((u) => (u.room ? `חדר ${u.room.number}` : `יחידה ${u.index} ללא חדר`)).join(' · ') + (unitsOk ? ' · מוכן' : ' · דורש טיפול')
      : 'לא נבחר חדר',
    registration: regDone ? (ctx.registration.status === 'signed' ? 'נחתם' : 'נשמר') : ctx.policy.requireRegistration ? 'נדרש לפני צ׳ק-אין' : 'לא נדרש',
    guarantee: `${ctx.guarantee.label} · התקבל ${money(ctx.guarantee.paid, ctx.reservation.currency)} מתוך ${money(ctx.guarantee.total, ctx.reservation.currency)}`,
  } : {};
  const SECTIONS = [
    { id: 'units', label: 'חדר' },
    { id: 'registration', label: 'פרטי אורח' },
    { id: 'guarantee', label: 'תשלום וערבות' },
  ];
  const balance = ctx ? Math.max(0, Number(ctx.guarantee.total || 0) - Number(ctx.guarantee.paid || 0)) : 0;

  return (
    <Modal open={open} onClose={result ? onDone : onClose} width={720} title={title} subtitle={subtitle}>
      {loadError && <ErrorBanner error={loadError} onRetry={load} />}
      {!ctx && loading && <div className="ui-empty"><Spinner /> טוען את פרטי ההזמנה…</div>}
      {ctx && result ? (
        <ResultView result={result} ctx={ctx} onClose={onDone} />
      ) : ctx && (
        <div className="ck">
          <div className="ck-tiles">
            <div><span>הגעה</span><strong>{formatShort(ctx.reservation.arrivalDate)}</strong></div>
            <div><span>יציאה</span><strong>{formatShort(ctx.reservation.departureDate)}</strong></div>
            <div><span>לילות · אורחים</span><strong>{ctx.reservation.nights} · {ctx.reservation.adults + (ctx.reservation.children || 0)}</strong></div>
            <div className={balance > 0 ? 'is-due' : ''}><span>יתרה לתשלום</span><strong>{money(balance, ctx.reservation.currency)}</strong></div>
          </div>
          {ctx.reservation.specialRequests && (
            <div className="ck-note"><Star size={14} aria-hidden="true" /><span>{ctx.reservation.specialRequests}</span></div>
          )}

          {SECTIONS.map((sec, i) => {
            const done = stepDone[sec.id];
            const isOpen = current === sec.id;
            return (
              <section key={sec.id} className={`ck-sec ${isOpen ? 'is-open' : ''} ${done ? 'is-done' : ''}`}>
                <button type="button" className="ck-sec-head" aria-expanded={isOpen} onClick={() => toggle(sec.id)}>
                  <span className="ck-sec-n" aria-hidden="true">{done ? <Check size={14} /> : i + 1}</span>
                  <span className="ck-sec-title">{sec.label}</span>
                  <span className={`ck-sec-sum ${done ? '' : 'is-todo'}`}>{summaries[sec.id]}</span>
                  <ChevronDown size={16} className="ck-sec-chev" aria-hidden="true" />
                </button>
                {isOpen && (
                  <div className="ck-sec-body">
                    {sec.id === 'units' && (
                      <UnitsStep
                        ctx={ctx}
                        selected={selected}
                        setSelected={setSelected}
                        onAssign={(u) => onAssign?.(u, load)}
                        onQueue={(u) => onQueue?.(u, load)}
                        onNext={() => next('registration')}
                      />
                    )}
                    {sec.id === 'registration' && (
                      <RegistrationStep ctx={ctx} propertyId={propertyId} reload={load} draft={regDraft} setDraft={setRegDraft} onNext={() => next('guarantee')} />
                    )}
                    {sec.id === 'guarantee' && (
                      <GuaranteeStep ctx={ctx} propertyId={propertyId} reload={load} method={method} setMethod={setMethod} reference={guaranteeRef} setReference={setGuaranteeRef} onNext={() => next(null)} />
                    )}
                  </div>
                )}
              </section>
            );
          })}

          <ConfirmStep
            ctx={ctx}
            chosen={chosen}
            method={method}
            guaranteeRef={guaranteeRef}
            isManager={isManager}
            propertyId={propertyId}
            reload={load}
            goTo={(id) => setOpenSec(id)}
            onSuccess={setResult}
          />
        </div>
      )}
    </Modal>
  );
}

// ── Step 1: units ───────────────────────────────────────────────────────────
function UnitsStep({ ctx, selected, setSelected, onAssign, onQueue, onNext }) {
  const multi = ctx.units.length > 1;
  const toggle = (key) => setSelected((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));
  return (
    <div>
      {multi && <p className="ui-p">סמנו את היחידות שנכנסות עכשיו. יחידה שאינה מוכנה יכולה להמתין בתור בלי לעכב את האחרות.</p>}
      <div className="ck-units">
        {ctx.units.map((u) => {
          const key = u.index;
          const done = u.readiness.state === 'checked_in';
          const reasons = (u.readiness.reasons || []).filter((r) => r.code !== 'guarantee');
          const row = {
            key, reservationId: ctx.reservation.id, unitId: u.unitId, confirmationNumber: ctx.reservation.confirmationNumber,
            guest: { name: `${ctx.guest.firstName} ${ctx.guest.lastName}` }, room: u.room, readiness: u.readiness,
          };
          return (
            <div key={key} className={`ck-unit ${selected.includes(key) ? 'is-selected' : ''} ${done ? 'is-done' : ''}`}>
              <div className="ck-unit-top">
                {multi && <input type="checkbox" disabled={done} checked={done || selected.includes(key)} onChange={() => toggle(key)} aria-label={`יחידה ${u.index}`} />}
                <div className="ck-unit-room">
                  <BedDouble size={18} aria-hidden="true" />
                  <div>
                    <strong>{u.room ? `חדר ${u.room.number}` : 'חדר לא משובץ'}</strong>
                    <small>{multi ? `יחידה ${u.index} · ` : ''}{u.roomType?.name}{u.room?.floor != null ? ` · קומה ${u.room.floor}` : ''}</small>
                  </div>
                </div>
                <div className="ck-unit-tags">
                  {u.room && <span className={`ck-tag ${['clean', 'inspected'].includes(u.room.cleanStatus) ? 'is-ok' : 'is-warn'}`}>{cleanLabel(u.room.cleanStatus)}</span>}
                  {u.room && <span className={`ck-tag ${u.room.opsStatus === 'available' ? 'is-ok' : 'is-warn'}`}>{opsLabel(u.room.opsStatus)}</span>}
                  {u.queue && <span className="ck-tag">בתור מאז {new Date(u.queue.arrivedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>}
                </div>
              </div>
              {reasons.length > 0 && (
                <ul className="ck-unit-issues">
                  {reasons.map((r, i) => <li key={i} className={r.severity === 'blocked' ? 'is-blocked' : 'is-waiting'}>{r.label}</li>)}
                </ul>
              )}
              {!done && (
                <div className="ck-unit-actions">
                  <button type="button" className={`btn btn-sm ${!u.room || reasons.length ? 'btn-primary' : 'btn-secondary'}`} onClick={() => onAssign(row)}>{u.room ? 'החלפת חדר' : 'שיבוץ חדר'}</button>
                  {['waiting', 'blocked'].includes(u.readiness.state) && !u.queue && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onQueue(row)}>המתנה לחדר</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="ui-step-foot">
        <button type="button" className="btn btn-secondary" onClick={onNext}>המשך לפרטי אורח</button>
      </div>
    </div>
  );
}

// ── Step 2: registration (FD-05) ────────────────────────────────────────────
function RegistrationStep({ ctx, propertyId, reload, draft, setDraft, onNext }) {
  const reg = ctx.registration;
  const [editing, setEditing] = useState(!reg || !!draft);
  const initial = () => ({
    firstName: ctx.guest.firstName || '',
    lastName: ctx.guest.lastName || '',
    dateOfBirth: ctx.guest.dateOfBirth ? String(ctx.guest.dateOfBirth).slice(0, 10) : '',
    nationality: ctx.guest.nationality || 'IL',
    idDocType: ctx.guest.knownDoc?.idDocType || 'id_card',
    idDocNumber: '',
    idDocExpiry: '',
    idVerified: false,
    signature: null,
    digitalDocConsent: false,
    marketingConsent: false,
  });
  const form = draft || initial();
  const setForm = (updater) => setDraft((prev) => (typeof updater === 'function' ? updater(prev || initial()) : updater));
  const [showTerms, setShowTerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const countries = useMemo(() => countryOptions(), []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  // EXT-04: a guest from abroad — residency evidence is taken here, from what was already typed
  // (country = citizenship, last 4 = passport number); only visa type and entry date are asked.
  const [touristInfo, setTouristInfo] = useState(null);
  useEffect(() => { stayApi.tourist(propertyId, ctx.reservation.id).then(setTouristInfo).catch(() => setTouristInfo(null)); }, [propertyId, ctx.reservation.id]);
  const abroad = form.nationality && form.nationality !== 'IL';
  const tourist = form.tourist || { nonResident: true, visaType: '', entryDate: '' };
  // What we already know about the guest is shown for confirmation; only the gaps become inputs.
  const g = ctx.guest;
  const known = g.knownDoc;
  const [editAll, setEditAll] = useState(false);
  const showName = editAll || !g.firstName || !g.lastName;
  const showDob = editAll || !g.dateOfBirth;
  const showNat = editAll || !g.nationality;
  const showDoc = editAll || !known;
  const hasKnown = !showName || !showDob || !showNat || !showDoc;
  const natName = countries.find((c) => c.code === form.nationality)?.name || form.nationality;
  const last4 = form.idDocType === 'passport'
    ? (showDoc ? String(form.idDocNumber || '').replace(/\D/g, '') : known?.last4 || '').slice(-4)
    : '';

  async function save() {
    setError(null); setFields({});
    if (abroad && tourist.nonResident && (!tourist.visaType?.trim() || !tourist.entryDate)) {
      setFields({ visaType: !tourist.visaType?.trim() ? 'סוג אשרת הכניסה' : undefined, entryDate: !tourist.entryDate ? 'תאריך הכניסה לישראל' : undefined });
      setError('אורח מחו״ל: יש להשלים סוג אשרה ותאריך כניסה, או לסמן שהוא תושב ישראל');
      return;
    }
    setSaving(true);
    try {
      const { tourist: _t, ...regBody } = form;
      const docPart = showDoc
        ? { idDocExpiry: form.idDocExpiry || undefined }
        : { idDocType: known.idDocType, idDocNumber: '', idDocExpiry: undefined, reuseKnownDoc: true };
      await frontdesk.saveRegistration(propertyId, ctx.reservation.id, { ...regBody, ...docPart });
      if (abroad) {
        setTouristInfo(await stayApi.recordTourist(propertyId, ctx.reservation.id, tourist.nonResident
          ? { nonResident: true, passportCountry: form.nationality, visaType: tourist.visaType.trim(), entryDate: tourist.entryDate, docLast4: last4.length === 4 ? last4 : undefined }
          : { nonResident: false }));
      }
      await reload();
      setDraft(null);
      setEditing(false);
    } catch (e) {
      setFields(e.fields || {});
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing && reg) {
    return (
      <div>
        <h3 className="ui-h3">רישום אורח</h3>
        <div className="ui-summary">
          <div className="ui-sum-row"><span>מצב</span><strong>{reg.status === 'signed' ? 'נחתם' : ctx.policy.termsText ? 'נשמר ללא חתימה' : 'נשמר — חתימה לא נחשבת עד שיוגדר נוסח תנאים מאושר'}</strong></div>
          <div className="ui-sum-row"><span>מסמך</span><strong>{ID_DOC_LABELS[reg.idDocType] || reg.idDocType} · נבדק בדלפק</strong></div>
          <div className="ui-sum-row"><span>נוסח תנאים</span><strong>{reg.termsVersion || '—'}</strong></div>
          {reg.signedAt && <div className="ui-sum-row"><span>מועד חתימה</span><strong>{new Date(reg.signedAt).toLocaleString('he-IL')}</strong></div>}
        </div>
        {touristInfo?.recorded && <div className="ui-sub-card"><div className="ui-label">תושבות ומעמד מס</div><TouristSummary data={touristInfo} /></div>}
        <div className="ui-step-foot">
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>תיקון רישום</button>
          <button type="button" className="btn btn-primary" onClick={onNext}>הבא</button>
        </div>
      </div>
    );
  }

  const policy = ctx.policy;
  return (
    <div>
      <h3 className="ui-h3">רישום אורח</h3>
      <ErrorBanner error={error} />
      {hasKnown && (
        <div className="ui-summary">
          {!showName && <div className="ui-sum-row"><span>שם</span><strong>{g.firstName} {g.lastName}</strong></div>}
          {!showDob && <div className="ui-sum-row"><span>תאריך לידה</span><strong>{formatShort(String(g.dateOfBirth).slice(0, 10))}</strong></div>}
          {!showNat && <div className="ui-sum-row"><span>אזרחות</span><strong>{natName}</strong></div>}
          {!showDoc && <div className="ui-sum-row"><span>מסמך מזהה</span><strong>{ID_DOC_LABELS[known.idDocType] || known.idDocType} · ···{known.last4}{known.source === 'previous_stay' ? ' · משהייה קודמת' : ''}</strong></div>}
          <div className="ui-sum-row"><span/><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditAll(true)}>פרטים שגויים? עריכה</button></div>
        </div>
      )}
      <div className="ui-grid-2">
        {showName && (
          <>
            <Field id="r-first" label="שם פרטי" required error={fields.firstName}>
              <input id="r-first" className="input w-full" value={form.firstName} maxLength={200} onChange={set('firstName')} aria-invalid={!!fields.firstName} />
            </Field>
            <Field id="r-last" label="שם משפחה" required error={fields.lastName}>
              <input id="r-last" className="input w-full" value={form.lastName} maxLength={200} onChange={set('lastName')} aria-invalid={!!fields.lastName} />
            </Field>
          </>
        )}
        {showDob && (
          <Field id="r-dob" label="תאריך לידה" required error={fields.dateOfBirth}>
            <input id="r-dob" type="date" className="input w-full" value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={set('dateOfBirth')} aria-invalid={!!fields.dateOfBirth} />
          </Field>
        )}
        {showNat && (
          <Field id="r-nat" label="אזרחות" required error={fields.nationality}>
            <select id="r-nat" className="select w-full" value={form.nationality} onChange={set('nationality')}>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>
        )}
        {showDoc && (
          <>
            <Field id="r-doctype" label="סוג מסמך מזהה" required error={fields.idDocType}>
              <select id="r-doctype" className="select w-full" value={form.idDocType} onChange={set('idDocType')}>
                {Object.entries(ID_DOC_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field id="r-docnum" label="מספר מסמך" required error={fields.idDocNumber}>
              <input id="r-docnum" className="input w-full" dir="ltr" value={form.idDocNumber} maxLength={40} autoComplete="off" onChange={set('idDocNumber')} aria-invalid={!!fields.idDocNumber} />
            </Field>
            {form.idDocType === 'passport' && (
              <Field id="r-docexp" label="תוקף הדרכון" optional>
                <input id="r-docexp" type="date" className="input w-full" value={form.idDocExpiry} onChange={set('idDocExpiry')} />
              </Field>
            )}
          </>
        )}
      </div>

      {abroad && (
        <div className="ui-sub-card">
          <div className="ui-label">אורח מחו״ל — תושבות ומעמד מס</div>
          <TouristFields
            idPrefix="r-tr"
            value={{ ...tourist, passportCountry: form.nationality }}
            onChange={(v) => setForm((f) => ({ ...f, tourist: { nonResident: v.nonResident, visaType: v.visaType || '', entryDate: v.entryDate || '' } }))}
            errors={fields}
            countryLocked
            hideDoc
          />
          {tourist.nonResident && <div className="ui-sub">מדינת הדרכון לפי האזרחות{last4.length === 4 ? ` · 4 ספרות אחרונות (${last4}) לפי מספר הדרכון` : ''}. מעמד המס נקבע לפי כלל הנכס — לא לפי הדרכון לבדו.</div>}
        </div>
      )}

      <label className="ui-check">
        <input type="checkbox" checked={form.idVerified} onChange={set('idVerified')} aria-invalid={!!fields.idVerified} />
        <span>בדקתי את מסמך הזיהוי מול האורח <span className="ui-req">· חובה</span></span>
      </label>
      {fields.idVerified && <div className="ui-error" role="alert">{fields.idVerified}</div>}

      <div className="ui-terms">
        <div className="flex items-center justify-between gap-2">
          <span>תנאי שהייה · נוסח <bdi>{policy.termsVersion}</bdi></span>
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showTerms} onClick={() => setShowTerms((v) => !v)}>{showTerms ? 'הסתרת הנוסח' : 'הצגת הנוסח'}</button>
        </div>
        {showTerms && (
          <p className="ui-terms-text" style={{ whiteSpace: 'pre-wrap' }}>
            {policy.termsText || 'לא הוגדר עדיין נוסח תנאים מאושר בהגדרות הנכס. אפשר לשמור רישום; חתימה תישמר כראיה אך הכרטיס יסומן "ממתין" עד שיוגדר נוסח.'}
          </p>
        )}
      </div>

      <Field id="r-sign" label="חתימת האורח" required={policy.requireSignature} optional={!policy.requireSignature} error={fields.signature}>
        <SignaturePad id="r-sign" value={form.signature} onChange={(v) => setForm((f) => ({ ...f, signature: v }))} />
      </Field>

      <label className="ui-check">
        <input type="checkbox" checked={form.digitalDocConsent} onChange={set('digitalDocConsent')} />
        <span>האורח מסכים לקבל מסמכים בדיגיטל <span className="ui-opt">· רשות</span></span>
      </label>
      <label className="ui-check">
        <input type="checkbox" checked={form.marketingConsent} onChange={set('marketingConsent')} disabled={ctx.guest.marketingConsent} />
        <span>
          האורח מסכים לקבל דיוור שיווקי <span className="ui-opt">· רשות, נפרד מהרישום</span>
          {ctx.guest.marketingConsent && <span className="ui-hint"> — כבר ניתנה הסכמה בעבר</span>}
        </span>
      </label>

      <div className="ui-step-foot">
        {reg && <button type="button" className="btn btn-ghost" onClick={() => { setDraft(null); setEditing(false); }} disabled={saving}>ביטול השינויים</button>}
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <><Spinner /> שומר…</> : reg ? 'שמירת רישום מתוקן' : 'שמירת רישום'}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: guarantee (FIN-03, manual methods only) ─────────────────────────
function GuaranteeStep({ ctx, propertyId, reload, method, setMethod, reference, setReference, onNext }) {
  const g = ctx.guarantee;
  const hasCompany = !!ctx.reservation.company;
  const [dep, setDep] = useState({ amount: '', method: 'cash', methodRef: '' });
  const [depKey, setDepKey] = useState(newOpKey());
  const { payments: methods } = useChargeCodes(propertyId);
  const depMethods = methods.filter((m) => m.active);
  const depNeedRef = !!depMethods.find((m) => m.code === dep.method)?.requireReference;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function recordDeposit() {
    setSaving(true); setError(null); setNotice(null);
    try {
      if (!ctx.reservation.folioId) throw new Error('אין חשבון פתוח להזמנה — לא ניתן לרשום מקדמה');
      // FIN-03 gate: deposit up to the stay cost, active method, reference when required, one post per key.
      await finance.pay(propertyId, ctx.reservation.folioId, { kind: 'deposit', amount: Number(dep.amount), method: dep.method, methodRef: dep.methodRef?.trim() || undefined, idempotencyKey: depKey });
      setDep((d) => ({ ...d, amount: '', methodRef: '' }));
      setDepKey(newOpKey());
      setNotice(`נרשמה מקדמה של ${money(dep.amount, ctx.reservation.currency)}`);
      setMethod('deposit');
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h3 className="ui-h3">ערבות ותשלום</h3>
      <div className="ui-summary">
        <div className="ui-sum-row"><span>מצב נוכחי</span><strong className={g.ok ? 'text-[rgb(21_128_61)]' : 'text-[rgb(180_83_9)]'}>{g.label}</strong></div>
        <div className="ui-sum-row"><span>סכום ההזמנה</span><strong>{money(g.total, ctx.reservation.currency)}</strong></div>
        <div className="ui-sum-row"><span>התקבל</span><strong>{money(g.paid, ctx.reservation.currency)}</strong></div>
      </div>
      <div className="ui-banner is-info mt-3">לא מחובר ספק סליקה. אישור כרטיס אינו מבוצע מכאן — שיטה ״כרטיס אשראי״ מתעדת הסדר ידני בלבד, ואינה תקבול.</div>

      <fieldset className="ui-fieldset">
        <legend className="ui-label">שיטת ערבות {ctx.policy.requireGuarantee && <span className="ui-req">· חובה לפי מדיניות</span>}</legend>
        {['credit_card', 'deposit', 'voucher', 'company_guarantee'].map((m) => {
          const disabled = m === 'company_guarantee' && !hasCompany;
          return (
            <label key={m} className={`ui-radio ${disabled ? 'is-disabled' : ''}`}>
              <input type="radio" name="guarantee" value={m} checked={method === m} disabled={disabled} onChange={() => setMethod(m)} />
              <span>
                {GUARANTEE_LABELS[m]}
                {m === 'company_guarantee' && (hasCompany ? <span className="ui-hint"> — {ctx.reservation.company.name}</span> : <span className="ui-hint"> — אין חברה משויכת להזמנה</span>)}
                {m === 'deposit' && <span className="ui-hint"> — נדרשת מקדמה שנרשמה בחשבון</span>}
              </span>
            </label>
          );
        })}
      </fieldset>

      {['credit_card', 'voucher'].includes(method) && (
        <Field
          id="g-ref"
          label={method === 'credit_card' ? '4 ספרות אחרונות או מספר אישור מהמסוף' : 'מספר השובר'}
          required
          hint="אסמכתה שאפשר לבדוק בדיעבד — לא מספר כרטיס מלא"
        >
          <input id="g-ref" className="input" dir="ltr" style={{ width: 220 }} maxLength={40} autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value.replace(/\s+/g, ''))} />
        </Field>
      )}

      <div className="ui-sub-card">
        <div className="ui-label">רישום מקדמה שהתקבלה בדלפק</div>
        <ErrorBanner error={error} />
        {notice && <div className="ui-banner is-ok" role="status">{notice}</div>}
        <div className="flex gap-2 items-end flex-wrap">
          <Field id="dep-amount" label="סכום">
            <input id="dep-amount" type="number" min={1} step={1} className="input" style={{ width: 140 }} value={dep.amount} onChange={(e) => setDep((d) => ({ ...d, amount: e.target.value }))} />
          </Field>
          <Field id="dep-method" label="אמצעי">
            <select id="dep-method" className="select" style={{ width: 160 }} value={dep.method} onChange={(e) => setDep((d) => ({ ...d, method: e.target.value }))}>
              {(depMethods.length ? depMethods.map((m) => [m.code, m.name]) : [['cash', 'מזומן'], ['credit_card', 'כרטיס אשראי (מסוף חיצוני)'], ['bank_transfer', 'העברה בנקאית']]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {depNeedRef && (
            <Field id="dep-ref" label="אסמכתה">
              <input id="dep-ref" className="input" dir="ltr" style={{ width: 160 }} maxLength={80} value={dep.methodRef} onChange={(e) => setDep((d) => ({ ...d, methodRef: e.target.value }))} />
            </Field>
          )}
          <button type="button" className="btn btn-secondary mb-[2px]" onClick={recordDeposit} disabled={saving || !(Number(dep.amount) > 0) || (depNeedRef && dep.methodRef.trim().length < 2)}>
            {saving ? <><Spinner /> רושם…</> : 'רישום מקדמה'}
          </button>
        </div>
      </div>

      <div className="ui-step-foot">
        <button type="button" className="btn btn-primary" onClick={onNext}>הבא</button>
      </div>
    </div>
  );
}

// ── Step 4: summary & confirm ───────────────────────────────────────────────
function ConfirmStep({ ctx, chosen, method, guaranteeRef, isManager, propertyId, reload, goTo, onSuccess }) {
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [details, setDetails] = useState(null);
  const [fields, setFields] = useState({});
  const policy = ctx.policy;

  // Open items the desk must resolve (or a manager must override with a reason).
  const issues = [];
  if (!chosen.length) issues.push({ text: 'לא נבחרה יחידה לצ׳ק-אין', step: 'units', hard: true });
  for (const u of chosen) {
    for (const r of u.readiness.reasons) {
      if (r.code === 'guarantee') continue;
      issues.push({ text: `יחידה ${u.index}: ${r.label}`, step: 'units', hard: r.severity === 'blocked' });
    }
  }
  // The guest register is a legal record — no override replaces it.
  if (policy.requireRegistration && !ctx.registration) issues.push({ text: 'לא נשמר רישום אורח', step: 'registration', hard: true });
  const refOk = String(guaranteeRef || '').trim().length >= 4;
  if (['credit_card', 'voucher'].includes(method) && !refOk) issues.push({ text: method === 'voucher' ? 'חסר מספר שובר' : 'חסרה אסמכתת כרטיס', step: 'guarantee', hard: true });
  const guaranteeWillBeOk = ctx.guarantee.ok || (['credit_card', 'voucher'].includes(method) && refOk) || (method === 'company_guarantee' && ctx.reservation.company);
  if (policy.requireGuarantee && !guaranteeWillBeOk) issues.push({ text: method === 'deposit' ? 'לא התקבלה מקדמה' : 'לא נבחרה שיטת ערבות', step: 'guarantee' });

  const hardIssues = issues.filter((i) => i.hard);
  const softIssues = issues.filter((i) => !i.hard);
  const needsOverride = softIssues.length > 0;
  const disabledReason = hardIssues.length ? 'יש חסימות שדורשות טיפול לפני צ׳ק-אין'
    : needsOverride && !override ? 'יש פריטים פתוחים — טפלו בהם או אשרו חריג מנהל'
      : override && reason.trim().length < 3 ? 'חריג מחייב סיבה' : null;

  async function submit() {
    setSaving(true); setError(null); setDetails(null); setFields({});
    try {
      const out = await frontdesk.checkIn(propertyId, ctx.reservation.id, {
        unitIds: chosen.map((u) => u.unitId).filter(Boolean),
        unitIndexes: chosen.map((u) => u.index),
        guarantee: method ? { method, reference: guaranteeRef || undefined } : undefined,
        override: override ? { enabled: true, reason } : undefined,
      });
      onSuccess(out);
    } catch (e) {
      setError(e.message);
      setFields(e.fields || {});
      if (e.details) setDetails(e.details);
      await reload(); // the room may have changed underneath us
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ck-confirm">
      {issues.length > 0 && (
        <div className="ui-issues">
          <div className="ui-label">פריטים פתוחים</div>
          <ul>
            {issues.map((i, k) => (
              <li key={k} className={i.hard ? 'is-blocked' : 'is-waiting'}>
                <span>{i.text}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => goTo(i.step)}>לטיפול</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {needsOverride && !hardIssues.length && (
        <div className="ui-sub-card">
          <label className={`ui-check ${!isManager ? 'is-disabled' : ''}`}>
            <input type="checkbox" checked={override} disabled={!isManager} onChange={(e) => setOverride(e.target.checked)} />
            <span>
              חריג צ׳ק-אין באישור מנהל
              {!isManager && <span className="ui-hint"> — זמין רק למנהל משמרת ומעלה. אפשר להעביר את האורח לתור המתנה.</span>}
            </span>
          </label>
          {override && (
            <Field id="ov-reason" label="סיבת החריג" required error={fields.overrideReason}>
              <input id="ov-reason" className="input w-full" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </div>
      )}

      {error && (
        <div className="ui-banner is-error mt-3" role="alert">
          <div>
            <div className="font-medium">{error}</div>
            {details?.length > 0 && (
              <ul className="mt-1 list-disc pr-4">
                {details.flatMap((d) => d.reasons.map((r, i) => <li key={`${d.unitId}-${i}`}>{r.label}</li>))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="ui-step-foot">
        {disabledReason && <span className="ui-foot-note">{disabledReason}</span>}
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!!disabledReason || saving}>
          {saving ? <><Spinner /> מבצע צ׳ק-אין…</> : `השלמת צ׳ק-אין${chosen.length > 1 ? ` (${chosen.length} יחידות)` : ''}`}
        </button>
      </div>
    </div>
  );
}

function ResultView({ result, ctx, onClose }) {
  return (
    <div className="ui-result" role="status">
      <div className="ui-result-icon"><Check size={22} /></div>
      <h3 className="ui-h3">הצ׳ק-אין הושלם</h3>
      <p className="ui-p">
        {ctx.guest.firstName} {ctx.guest.lastName} · {ctx.reservation.confirmationNumber} ·
        {' '}{result.checkedInUnits.length} {result.checkedInUnits.length === 1 ? 'יחידה נכנסה' : 'יחידות נכנסו'}
        {result.remainingUnits > 0 && ` · ${result.remainingUnits} ממתינות`}
      </p>
      {result.overridden?.length > 0 && <div className="ui-banner is-warn">בוצע בחריג מנהל — נרשם ביומן הביקורת.</div>}
      <div className="ui-banner is-info"><KeyRound size={14} aria-hidden="true" /> {result.key.label}</div>
      <div className="ui-step-foot">
        <button type="button" className="btn btn-primary" onClick={onClose}>חזרה להגעות</button>
      </div>
    </div>
  );
}
