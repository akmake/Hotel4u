// RSV-02 — create a booking (with INV-03 search) or save it as an RSV-04 quote.
// Step 1: stay + live availability and price per night (the server's price, never typed in).
// Step 2: guest (existing or new, duplicates surfaced), booker, payer, channel.
// Step 3: review the frozen price and terms, then confirm / hold / quote / draft.
// The server re-checks availability and price at commit; a changed price must be accepted again.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Check, Crown } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { booking } from '../../utils/api';
import { SOURCE_LABELS, QUOTE_CHANNEL_LABELS } from '../../lib/labels';
import { addDays, formatShort, formatLong, todayYmd } from '../../utils/date';
import {
  Page, Card, Field, ErrorBanner, Banner, Spinner, KeyValues, Tag, Empty,
  useUrlState, useAction, money, newOpKey,
} from '../../components/kit';

const PRICE_OVERRIDE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'revenue_manager', 'sales_manager'];
const STEPS = ['שהייה ומחיר', 'אורח ומשלם', 'סיכום ואישור'];
const MODES = {
  confirm: { label: 'אישור הזמנה', hint: 'תופס מלאי ומאשר מחיר ותנאים' },
  hold: { label: 'החזקה זמנית', hint: 'תופס מלאי עד מועד; משתחרר אוטומטית אם לא אושר' },
  quote: { label: 'הצעת מחיר', hint: 'מסמך הצעה עם תוקף — לא הזמנה; מלאי רק אם מבקשים' },
  draft: { label: 'טיוטה', hint: 'שמירה בלי מלאי ובלי התחייבות' },
};
const DEFAULTS = { arrival: '', departure: '', adults: '2', children: '0', rooms: '1' };

function inDays(n) { return addDays(todayYmd(), n); }
function localDateTime(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Steps({ step, setStep, can }) {
  return (
    <nav className="ui-steps" aria-label="שלבי הזמנה">
      <ol>
        {STEPS.map((label, i) => (
          <li key={label}>
            <button type="button" className={`ui-step ${step === i ? 'is-current' : ''} ${step > i ? 'is-done' : ''}`} disabled={!can(i)} aria-current={step === i ? 'step' : undefined} onClick={() => setStep(i)}>
              <span className="ui-step-n">{step > i ? <Check size={12} /> : i + 1}</span>{label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ── Step 1: search ──────────────────────────────────────────────────────────
function StayStep({ propertyId, url, onPick, picked }) {
  const [stay, setStay] = useState(() => ({
    arrival: url.get('arrival') || inDays(0), departure: url.get('departure') || inDays(1),
    adults: url.get('adults') || '2', children: url.get('children') || '0', rooms: url.get('rooms') || '1',
  }));
  const [ages, setAges] = useState([]);
  const search = useAction();
  const [result, setResult] = useState(null);
  const nights = stay.arrival && stay.departure ? Math.round((Date.parse(stay.departure) - Date.parse(stay.arrival)) / 86400000) : 0;
  const kids = Number(stay.children || 0);
  useEffect(() => { setAges((a) => Array.from({ length: kids }, (_, i) => a[i] ?? '')); }, [kids]);
  const set = (k) => (v) => setStay((p) => ({ ...p, [k]: v }));

  async function run(e) {
    e?.preventDefault();
    url.set({ ...stay }, { resetPage: false });
    const out = await search.run(() => booking.availability(propertyId, stay));
    if (out) setResult(out);
  }
  useEffect(() => { if (url.get('arrival') && url.get('departure') && propertyId) run(); }, [propertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const m = new Map();
    for (const o of result?.offers || []) {
      if (!m.has(o.roomType.id)) m.set(o.roomType.id, { roomType: o.roomType, offers: [] });
      m.get(o.roomType.id).offers.push(o);
    }
    return [...m.values()];
  }, [result]);
  const f = search.fields;
  const agesMissing = kids > 0 && ages.some((a) => a === '' || Number(a) < 0 || Number(a) > 17);

  return (
    <div className="ui-step-body">
      <form className="ui-stack" onSubmit={run} noValidate>
        <div className="ui-grid-3">
          <Field id="bk-arr" label="כניסה" required error={f.arrival}>
            <input id="bk-arr" type="date" className="input w-full" min={todayYmd()} value={stay.arrival} onChange={(e) => { set('arrival')(e.target.value); if (stay.departure <= e.target.value) set('departure')(addDays(e.target.value, 1)); }} />
          </Field>
          <Field id="bk-dep" label="יציאה" required error={f.departure} hint={nights > 0 ? `${nights} לילות` : undefined}>
            <input id="bk-dep" type="date" className="input w-full" min={stay.arrival ? addDays(stay.arrival, 1) : undefined} value={stay.departure} onChange={(e) => set('departure')(e.target.value)} />
          </Field>
          <Field id="bk-rooms" label="יחידות" required error={f.rooms}>
            <input id="bk-rooms" type="number" min="1" max="20" className="input w-full" value={stay.rooms} onChange={(e) => set('rooms')(e.target.value)} />
          </Field>
          <Field id="bk-ad" label="מבוגרים" required error={f.adults}>
            <input id="bk-ad" type="number" min="1" max="40" className="input w-full" value={stay.adults} onChange={(e) => set('adults')(e.target.value)} />
          </Field>
          <Field id="bk-ch" label="ילדים" error={f.children}>
            <input id="bk-ch" type="number" min="0" max="20" className="input w-full" value={stay.children} onChange={(e) => set('children')(e.target.value)} />
          </Field>
        </div>
        {kids > 0 && (
          <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
            <legend className="ui-label">גילי ילדים · חובה</legend>
            <div className="ui-row">
              {ages.map((a, i) => (
                <label key={i} className="ui-row" style={{ gap: 4 }}>
                  <span className="ui-sub">ילד {i + 1}</span>
                  <input type="number" min="0" max="17" className="input" style={{ width: 70 }} value={a} onChange={(e) => setAges((p) => p.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`גיל ילד ${i + 1}`} />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="ui-row">
          <button type="submit" className="btn btn-primary" disabled={search.busy || nights < 1}>{search.busy ? <Spinner /> : <Search size={14} />} בדיקת זמינות ומחיר</button>
          {result && <span className="ui-sub">המחירים כוללים מע״מ · נבדקים מחדש באישור</span>}
        </div>
      </form>
      <ErrorBanner error={search.error && !Object.keys(search.fields).length ? search.error : null} />
      {result && grouped.length === 0 && <Empty title="אין סוגי חדרים פעילים למכירה" />}
      {grouped.map(({ roomType, offers }) => (
        <Card key={roomType.id} title={roomType.name} actions={<span className="ui-sub">עד {roomType.capacityMax} אורחים · {offers[0]?.available ?? 0} פנויות בכל הלילות</span>}>
          <div className="ui-row" style={{ gap: 4 }} aria-label="מלאי לפי לילה">
            {offers[0]?.availability.map((a) => <span key={a.date} className="ui-mini" title={a.date}>{formatShort(a.date)}: {a.available === null ? '—' : a.available}</span>)}
          </div>
          <ul className="ui-units">
            {offers.map((o) => {
              const isPicked = picked && picked.roomType.id === o.roomType.id && picked.ratePlan.id === o.ratePlan.id;
              return (
                <li key={o.ratePlan.id} className={`ui-unit ${isPicked ? 'is-selected' : ''}`}>
                  <div className="min-w-0">
                    <div className="ui-row" style={{ gap: 6 }}>
                      <strong>{o.ratePlan.name}</strong>
                      {!o.ratePlan.refundable && <Tag tone="warn">ללא החזר</Tag>}
                      {o.ratePlan.breakfast && <Tag>כולל ארוחת בוקר</Tag>}
                    </div>
                    <div className="ui-sub">{o.cancellation.text}</div>
                    {!o.bookable && <ul className="ui-reasons">{o.reasons.map((x) => <li key={x.code + x.label} className="is-blocked">{x.label}</li>)}</ul>}
                  </div>
                  <div className="ui-unit-actions">
                    <div className="ui-amount font-medium">{money(o.total)}</div>
                    <div className="ui-sub">{money(o.averageNight)} ללילה בממוצע</div>
                    <button type="button" className={`btn btn-sm ${isPicked ? 'btn-secondary' : 'btn-primary'}`} disabled={!o.bookable || agesMissing} title={!o.bookable ? o.reasons[0]?.label : agesMissing ? 'יש למלא גילי ילדים' : undefined} onClick={() => onPick(o, result, ages.map(Number))}>
                      {isPicked ? 'נבחר' : 'בחירה'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}

// ── Step 2: guest & payer ───────────────────────────────────────────────────
function GuestStep({ propertyId, form, setForm, duplicates, onNext }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [busy, setBusy] = useState(false);
  const [companies, setCompanies] = useState([]);
  useEffect(() => { if (form.payerType === 'company' && propertyId) booking.companies(propertyId).then(setCompanies).catch(() => setCompanies([])); }, [form.payerType, propertyId]);
  async function find(e) {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try { setHits(await booking.guests(propertyId, q.trim())); } catch { setHits([]); } finally { setBusy(false); }
  }
  const set = (k) => (v) => setForm((p) => ({ ...p, [k]: v }));
  const g = form.newGuest;
  const guestOk = form.guest || (g.firstName.trim() && g.lastName.trim() && (g.phone.trim() || g.email.trim()));
  const payerOk = form.payerType !== 'company' || form.companyId;
  return (
    <div className="ui-step-body">
      {duplicates?.length > 0 && (
        <Banner tone="warn">
          <div className="ui-stack" style={{ gap: 6 }}>
            <strong>נמצא אורח קיים עם אותו טלפון או דוא״ל — עדיף לבחור בו כדי לא לפצל היסטוריה:</strong>
            {duplicates.map((d) => (
              <div key={d.id} className="ui-row">
                <span>{d.name} · <bdi>{d.phone || d.email}</bdi></span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm((p) => ({ ...p, guest: { id: d.id, name: d.name }, forceNewGuest: false }))}>בחירה באורח הקיים</button>
              </div>
            ))}
            <label className="ui-check"><input type="checkbox" checked={!!form.forceNewGuest} onChange={(e) => set('forceNewGuest')(e.target.checked)} /><span>זה אדם אחר — ליצור אורח חדש בכל זאת</span></label>
          </div>
        </Banner>
      )}
      <Card title="אורח ראשי">
        {form.guest ? (
          <div className="ui-picked"><span>{form.guest.name}{form.guest.vip && <Crown size={12} className="text-amber-600" />}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => set('guest')(null)}>החלפה</button></div>
        ) : (
          <>
            <form className="ui-row" onSubmit={find} role="search">
              <label htmlFor="bk-gq" className="sr-only">חיפוש אורח</label>
              <input id="bk-gq" className="input" style={{ flex: 1, minWidth: 200 }} placeholder="חיפוש לפי שם, טלפון או דוא״ל" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || q.trim().length < 2}>{busy ? <Spinner /> : 'חיפוש'}</button>
            </form>
            {hits && hits.length === 0 && <div className="ui-sub">לא נמצא אורח — מלאו פרטי אורח חדש למטה.</div>}
            {hits && hits.length > 0 && (
              <ul className="ui-results">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" disabled={h.blacklisted} onClick={() => setForm((p) => ({ ...p, guest: h }))}>
                      <span>{h.name}{h.vip ? ' · VIP' : ''}{h.blacklisted ? ' · ברשימה שחורה' : ''}</span>
                      <span className="ui-sub"><bdi>{[h.phone, h.email].filter(Boolean).join(' · ')}</bdi>{h.stays ? ` · ${h.stays} שהיות` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="ui-section-title" style={{ marginTop: 8 }}>או אורח חדש</div>
            <div className="ui-grid-2">
              <Field id="ng-f" label="שם פרטי" required error={form.fieldErrors?.firstName}><input id="ng-f" className="input w-full" maxLength={60} value={g.firstName} onChange={(e) => set('newGuest')({ ...g, firstName: e.target.value })} /></Field>
              <Field id="ng-l" label="שם משפחה" required error={form.fieldErrors?.lastName}><input id="ng-l" className="input w-full" maxLength={60} value={g.lastName} onChange={(e) => set('newGuest')({ ...g, lastName: e.target.value })} /></Field>
              <Field id="ng-p" label="טלפון" hint="טלפון או דוא״ל — לפחות אחד" error={form.fieldErrors?.phone}><input id="ng-p" type="tel" inputMode="tel" className="input w-full" maxLength={20} value={g.phone} onChange={(e) => set('newGuest')({ ...g, phone: e.target.value })} /></Field>
              <Field id="ng-e" label="דוא״ל" error={form.fieldErrors?.email}><input id="ng-e" type="email" className="input w-full" maxLength={120} value={g.email} onChange={(e) => set('newGuest')({ ...g, email: e.target.value })} /></Field>
            </div>
            <div className="ui-sub">פרטים לשירות בלבד — הסכמה שיווקית נאספת בנפרד ברישום.</div>
          </>
        )}
      </Card>
      <Card title="מזמין, משלם וערוץ">
        <label className="ui-check"><input type="checkbox" checked={form.bookerDiffers} onChange={(e) => set('bookerDiffers')(e.target.checked)} /><span>המזמין אינו האורח</span></label>
        {form.bookerDiffers && (
          <div className="ui-grid-3">
            <Field id="bk-bn" label="שם המזמין"><input id="bk-bn" className="input w-full" maxLength={120} value={form.booker.name} onChange={(e) => set('booker')({ ...form.booker, name: e.target.value })} /></Field>
            <Field id="bk-bp" label="טלפון"><input id="bk-bp" type="tel" className="input w-full" maxLength={30} value={form.booker.phone} onChange={(e) => set('booker')({ ...form.booker, phone: e.target.value })} /></Field>
            <Field id="bk-be" label="דוא״ל"><input id="bk-be" type="email" className="input w-full" maxLength={120} value={form.booker.email} onChange={(e) => set('booker')({ ...form.booker, email: e.target.value })} /></Field>
          </div>
        )}
        <div className="ui-grid-3">
          <Field id="bk-payer" label="משלם" required>
            <select id="bk-payer" className="select w-full" value={form.payerType} onChange={(e) => set('payerType')(e.target.value)}>
              <option value="guest">האורח</option>
              <option value="company">חברה</option>
              {form.bookerDiffers && <option value="booker">המזמין</option>}
            </select>
          </Field>
          {form.payerType === 'company' && (
            <Field id="bk-co" label="חברה" required error={!form.companyId ? undefined : null}>
              <select id="bk-co" className="select w-full" value={form.companyId} onChange={(e) => set('companyId')(e.target.value)}>
                <option value="">בחירה…</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <Field id="bk-src" label="ערוץ" required>
            <select id="bk-src" className="select w-full" value={form.source} onChange={(e) => set('source')(e.target.value)}>
              {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <Field id="bk-req" label="בקשות האורח" optional hint="מוצג לקבלה ולחדרנות">
          <textarea id="bk-req" className="input w-full" rows={2} maxLength={1000} value={form.specialRequests} onChange={(e) => set('specialRequests')(e.target.value)} />
        </Field>
        <Field id="bk-int" label="הערה פנימית" optional hint="לא מוצג לאורח ולא לחדרנות">
          <input id="bk-int" className="input w-full" maxLength={1000} value={form.internalNotes} onChange={(e) => set('internalNotes')(e.target.value)} />
        </Field>
      </Card>
      <div className="ui-step-foot">
        {!guestOk && <span className="ui-foot-note">יש לבחור אורח או למלא פרטי אורח חדש</span>}
        {guestOk && !payerOk && <span className="ui-foot-note">יש לבחור חברה משלמת</span>}
        <button type="button" className="btn btn-primary" disabled={!guestOk || !payerOk} onClick={onNext}>המשך לסיכום</button>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function BookingWizardPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const nav = useNavigate();
  const url = useUrlState(DEFAULTS);
  const [step, setStep] = useState(0);
  const [pick, setPick] = useState(null); // { offer, search, ages }
  const [form, setForm] = useState({
    guest: null, newGuest: { firstName: '', lastName: '', phone: '', email: '' }, forceNewGuest: false,
    bookerDiffers: false, booker: { name: '', phone: '', email: '' }, payerType: 'guest', companyId: '', source: 'direct',
    specialRequests: '', internalNotes: '', fieldErrors: {},
  });
  const [mode, setMode] = useState('confirm');
  const [holdMinutes, setHoldMinutes] = useState('60');
  const [quote, setQuote] = useState(() => ({ validUntil: localDateTime(new Date(Date.now() + 3 * 86400000)), language: 'he', channel: 'email', holdInventory: false }));
  const [override, setOverride] = useState({ on: false, rate: '', reason: '' });
  const [duplicates, setDuplicates] = useState(null);
  const [priceChange, setPriceChange] = useState(null);
  const [opKey, setOpKey] = useState(newOpKey);
  const submit = useAction();
  const canOverride = PRICE_OVERRIDE_ROLES.includes(role);
  const offer = pick?.offer;

  const can = (i) => i === 0 || (i === 1 && !!pick) || (i === 2 && !!pick && (form.guest || form.newGuest.firstName));

  async function go(acceptSignature) {
    const s = pick.search;
    const body = {
      arrival: s.arrival, departure: s.departure, adults: s.adults, children: s.children, rooms: s.rooms, childAges: pick.ages,
      roomTypeId: offer.roomType.id, ratePlanId: offer.ratePlan.id, priceSignature: acceptSignature || offer.priceSignature,
      mode, idempotencyKey: opKey, source: form.source, specialRequests: form.specialRequests || undefined, internalNotes: form.internalNotes || undefined,
      payerType: form.payerType, companyId: form.payerType === 'company' ? form.companyId : undefined,
      booker: form.bookerDiffers ? form.booker : undefined,
      ...(form.guest ? { guestId: form.guest.id } : { newGuest: form.newGuest, forceNewGuest: form.forceNewGuest }),
      ...(mode === 'hold' ? { holdMinutes: Number(holdMinutes) } : {}),
      ...(mode === 'quote' ? { validUntil: new Date(quote.validUntil).toISOString(), language: quote.language, channel: quote.channel, holdInventory: quote.holdInventory } : {}),
      ...(override.on ? { override: { ratePerNight: Number(override.rate), reason: override.reason } } : {}),
    };
    try {
      const out = await booking.create(propertyId, body);
      nav(`/pms/reservations/${out.id}${out.duplicate ? '' : '?created=1'}`);
    } catch (e) {
      if (e.code === 'price_changed') { setPriceChange(e.details?.[0] || null); return; }
      if (e.code === 'possible_duplicate') { setDuplicates(e.details || []); setStep(1); return; }
      if (e.fields) setForm((p) => ({ ...p, fieldErrors: e.fields }));
      if (e.code === 'sold_out' || e.code === 'not_bookable') setOpKey(newOpKey());
      throw e;
    }
  }

  const overrideWhy = override.on && (!(Number(override.rate) > 0) ? 'מחיר ידני חיובי' : override.reason.trim().length < 3 ? 'נדרשת סיבה למחיר ידני' : null);
  const quoteWhy = mode === 'quote' && (!quote.validUntil || new Date(quote.validUntil) <= new Date()) ? 'תוקף ההצעה חייב להיות בעתיד' : null;
  const total = offer ? (override.on && Number(override.rate) > 0 ? Number(override.rate) * offer.nightly.length * pick.search.rooms : offer.total) : 0;

  return (
    <Page>
      <div className="ui-toolbar">
        <div className="ui-h3">הזמנה חדשה</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav('/pms/reservations')}>חזרה לרשימה</button>
      </div>
      <Card>
        <div className="ui-wizard">
          <div>
            <Steps step={step} setStep={setStep} can={can} />
            {offer && (
              <div className="ui-note-box">
                <div className="ui-note-k">{offer.roomType.name} · {offer.ratePlan.name}</div>
                <div>{formatShort(pick.search.arrival)} – {formatShort(pick.search.departure)} · {pick.search.nights} לילות</div>
                <div>{pick.search.rooms} יחידות · {pick.search.adults} מבוגרים{pick.search.children ? ` · ${pick.search.children} ילדים` : ''}</div>
                <div className="font-medium">{money(total)}</div>
              </div>
            )}
          </div>
          <div className="min-w-0">
            {step === 0 && <StayStep propertyId={propertyId} url={url} picked={offer} onPick={(o, search, ages) => { setPick({ offer: o, search, ages }); setPriceChange(null); setStep(1); }} />}
            {step === 1 && <GuestStep propertyId={propertyId} form={form} setForm={setForm} duplicates={duplicates} onNext={() => setStep(2)} />}
            {step === 2 && offer && (
              <div className="ui-step-body">
                <ErrorBanner error={submit.error} />
                {priceChange && (
                  <Banner tone="warn">
                    <div className="ui-stack" style={{ gap: 6 }}>
                      <strong>המחיר השתנה מאז שהוצג: {money(offer.total)} ← {money(priceChange.total)}</strong>
                      <div className="ui-row">
                        <button type="button" className="btn btn-primary btn-sm" disabled={submit.busy} onClick={() => submit.run(async () => { setPick((p) => ({ ...p, offer: { ...p.offer, total: priceChange.total, nightly: priceChange.nightly, priceSignature: priceChange.priceSignature } })); await go(priceChange.priceSignature); })}>אישור המחיר החדש והמשך</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setPriceChange(null); setStep(0); }}>חזרה לחיפוש</button>
                      </div>
                    </div>
                  </Banner>
                )}
                <div className="ui-grid-2">
                  <Card title="מחיר לפי לילה">
                    <KeyValues rows={[
                      ...offer.nightly.map((n) => [formatLong(n.date), money(override.on && Number(override.rate) > 0 ? Number(override.rate) : n.price)]),
                      pick.search.rooms > 1 ? ['יחידות', `× ${pick.search.rooms}`] : null,
                      ['סה״כ (כולל מע״מ)', money(total)],
                    ]} />
                    {canOverride && (
                      <div className="ui-stack" style={{ gap: 6 }}>
                        <label className="ui-check"><input type="checkbox" checked={override.on} onChange={(e) => setOverride((o) => ({ ...o, on: e.target.checked }))} /><span>מחיר ידני ללילה (הרשאת מנהל)</span></label>
                        {override.on && (
                          <div className="ui-grid-2">
                            <Field id="ov-r" label="מחיר ללילה ליחידה" required><input id="ov-r" type="number" min="1" step="0.01" className="input w-full" value={override.rate} onChange={(e) => setOverride((o) => ({ ...o, rate: e.target.value }))} /></Field>
                            <Field id="ov-why" label="סיבה" required error={submit.fields.overrideReason}><input id="ov-why" className="input w-full" maxLength={300} value={override.reason} onChange={(e) => setOverride((o) => ({ ...o, reason: e.target.value }))} /></Field>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                  <Card title="תנאים שיישמרו בהזמנה">
                    <KeyValues rows={[
                      ['ביטול', offer.cancellation.text],
                      ['מקדמה', offer.deposit],
                      ['אורח', form.guest?.name || `${form.newGuest.firstName} ${form.newGuest.lastName}`],
                      ['משלם', form.payerType === 'company' ? 'חברה' : form.payerType === 'booker' ? 'המזמין' : 'האורח'],
                      ['ערוץ', SOURCE_LABELS[form.source]],
                    ]} />
                    <div className="ui-sub">אחרי האישור שינוי תעריף או מדיניות לא ישנה את התנאים האלה.</div>
                  </Card>
                </div>
                <fieldset className="ui-fieldset">
                  <legend className="ui-label">מה לעשות</legend>
                  {Object.entries(MODES).map(([v, m]) => (
                    <label key={v} className="ui-radio"><input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} /><span>{m.label}<span className="ui-sub" style={{ display: 'block' }}>{m.hint}</span></span></label>
                  ))}
                </fieldset>
                {mode === 'hold' && (
                  <Field id="hold-min" label="להחזיק עד" required error={submit.fields.holdMinutes}>
                    <select id="hold-min" className="select" value={holdMinutes} onChange={(e) => setHoldMinutes(e.target.value)}>
                      {[['30', '30 דקות'], ['60', 'שעה'], ['240', '4 שעות'], ['1440', '24 שעות'], ['4320', '3 ימים']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                )}
                {mode === 'quote' && (
                  <div className="ui-grid-3">
                    <Field id="q-valid" label="תוקף ההצעה" required error={submit.fields.validUntil}><input id="q-valid" type="datetime-local" className="input w-full" value={quote.validUntil} onChange={(e) => setQuote((q) => ({ ...q, validUntil: e.target.value }))} /></Field>
                    <Field id="q-lang" label="שפת הנמען" required>
                      <select id="q-lang" className="select w-full" value={quote.language} onChange={(e) => setQuote((q) => ({ ...q, language: e.target.value }))}><option value="he">עברית</option><option value="en">English</option></select>
                    </Field>
                    <Field id="q-ch" label="ערוץ מסירה" required>
                      <select id="q-ch" className="select w-full" value={quote.channel} onChange={(e) => setQuote((q) => ({ ...q, channel: e.target.value }))}>{Object.entries(QUOTE_CHANNEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    </Field>
                    <label className="ui-check"><input type="checkbox" checked={quote.holdInventory} onChange={(e) => setQuote((q) => ({ ...q, holdInventory: e.target.checked }))} /><span>להחזיק מלאי עד תום התוקף</span></label>
                  </div>
                )}
                <div className="ui-step-foot">
                  {(overrideWhy || quoteWhy) && <span className="ui-foot-note">{overrideWhy || quoteWhy}</span>}
                  <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} disabled={submit.busy}>חזרה</button>
                  <button type="button" className="btn btn-primary" disabled={submit.busy || !!overrideWhy || !!quoteWhy || !!priceChange} onClick={() => submit.run(() => go())}>
                    {submit.busy ? <><Spinner /> שומר…</> : MODES[mode].label}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Page>
  );
}
