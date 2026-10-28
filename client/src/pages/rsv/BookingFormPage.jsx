// RSV-02 — new booking on ONE screen: stay, rooms, guest, payer and summary side by side.
// Several rooms of the same or different types are booked in one action; each room becomes its own
// reservation linked as a party (POST /booking/party — all or nothing). Prices are the server's
// (per room: type, rate plan, adults, children); a manager may override one room's price with a reason.
// Prefill from the URL: arrival, departure, roomTypeId, roomId, adults, children.
// One choice per room: a rate plan. The manager decides how the hotel sells (Property.pricingMode):
// 'rates' → the column is "תעריף"; 'board' → the column is "פנסיון" and every board is a rate plan
// with its own price calendar (plans grouped by the board they represent).
// Resident / tourist at the top (EXT-04): a tourist sees the price without VAT only when the property
// approved the tourist rule; the evidence is completed at check-in.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Copy, Trash2, Crown } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { booking, finance } from '../../utils/api';
import { SOURCE_LABELS, QUOTE_CHANNEL_LABELS, BOARD_LABELS } from '../../lib/labels';
import { addDays, formatShort, todayYmd } from '../../utils/date';
import { Page, Card, Field, ErrorBanner, Banner, Spinner, KeyValues, money, newOpKey } from '../../components/kit';

const PRICE_OVERRIDE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'revenue_manager', 'sales_manager'];
const HOLD_OPTIONS = [['30', '30 דקות'], ['60', 'שעה'], ['240', '4 שעות'], ['1440', '24 שעות'], ['4320', '3 ימים']];
const nightsOf = (a, d) => (a && d ? Math.max(0, Math.round((Date.parse(d) - Date.parse(a)) / 86400000)) : 0);
const rowKey = () => Math.random().toString(36).slice(2, 10);
const newRow = (p = {}) => ({ key: rowKey(), roomTypeId: '', ratePlanId: '', board: 'room_only', adults: 2, children: 0, childAges: [], roomId: '', override: null, ...p });
// A plan that includes a board fixes it ("by rate"); otherwise the row's own choice ("by board").
const effBoardOf = (r, types) => {
  const pl = types?.find((x) => x.id === r.roomTypeId)?.plans.find((p) => p.id === r.ratePlanId);
  return pl?.board && pl.board !== 'room_only' ? pl.board : (r.board || 'room_only');
};
// The offer depends on the board and (for a supplement) on the children's ages.
const offerKey = (r, types) => {
  const b = effBoardOf(r, types);
  return `${r.roomTypeId}|${r.adults}|${r.children}|${b}|${b !== 'room_only' ? r.childAges.join(',') : ''}`;
};
const localDateTime = (d) => { const z = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };

// ── data: offers per (type, adults, children) and free rooms per type, cached per stay ──
function useStayData(propertyId, arrival, departure, rows) {
  const [types, setTypes] = useState(null); // [{ id, name, capacityMax, available, plans: [{id,name,refundable,breakfast}] }]
  const [offers, setOffers] = useState({}); // key → { byPlan: { planId: offer } } | { error }
  const [rooms, setRooms] = useState({}); // typeId → [{id, number, floor}]
  const [error, setError] = useState(null);
  const stayKey = `${arrival}|${departure}`;
  const valid = nightsOf(arrival, departure) > 0;
  useEffect(() => { setOffers({}); setRooms({}); setTypes(null); setError(null); }, [stayKey]);
  useEffect(() => {
    if (!propertyId || !valid) return undefined;
    let alive = true;
    booking.availability(propertyId, { arrival, departure, adults: 1, children: 0, rooms: 1 }).then((r) => {
      if (!alive) return;
      const m = new Map();
      for (const o of r.offers || []) {
        if (!m.has(o.roomType.id)) m.set(o.roomType.id, { ...o.roomType, available: o.available, plans: [] });
        m.get(o.roomType.id).plans.push(o.ratePlan);
      }
      setTypes([...m.values()]);
    }).catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [propertyId, stayKey, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const need = useMemo(() => (types ? [...new Set(rows.filter((r) => r.roomTypeId && r.ratePlanId && (effBoardOf(r, types) === 'room_only' || !r.childAges.some((a) => a === '' || a === undefined))).map((r) => offerKey(r, types)))] : []), [rows, types]);
  const inflight = useRef(new Set());
  useEffect(() => {
    if (!propertyId || !valid) return;
    for (const k of need) {
      const full = `${stayKey}|${k}`;
      if (offers[k] || inflight.current.has(full)) continue;
      inflight.current.add(full);
      const [roomTypeId, adults, children, board, ages] = k.split('|');
      booking.availability(propertyId, { arrival, departure, adults, children, rooms: 1, roomTypeId, board, childAges: ages || undefined })
        .then((r) => setOffers((o) => ({ ...o, [k]: { byPlan: Object.fromEntries((r.offers || []).map((x) => [x.ratePlan.id, x])) } })))
        .catch((e) => setOffers((o) => ({ ...o, [k]: { error: e.message } })))
        .finally(() => inflight.current.delete(full));
    }
  }, [need, stayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const typeIds = useMemo(() => [...new Set(rows.map((r) => r.roomTypeId).filter(Boolean))], [rows]);
  useEffect(() => {
    if (!propertyId || !valid) return;
    for (const t of typeIds) {
      if (rooms[t]) continue;
      setRooms((x) => ({ ...x, [t]: [] }));
      booking.freeRooms(propertyId, { roomTypeId: t, arrival, departure }).then((list) => setRooms((x) => ({ ...x, [t]: list }))).catch(() => null);
    }
  }, [typeIds, stayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => setOffers({});
  return { types, offers, rooms, error, refresh };
}

// The one price choice of a room. By board: plans grouped under the board they represent; a board
// with a single plan shows just the board name.
function PlanSelect({ id, plans, byBoard, value, onChange, label }) {
  if (!byBoard) {
    return (
      <select id={id} className="select w-full" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.board && p.board !== 'room_only' ? ` · כולל ${BOARD_LABELS[p.board]}` : ''}{p.refundable === false ? ' · ללא החזר' : ''}</option>)}
      </select>
    );
  }
  const groups = Object.keys(BOARD_LABELS).map((b) => ({ b, items: plans.filter((p) => (p.board || 'room_only') === b) })).filter((g) => g.items.length);
  return (
    <select id={id} className="select w-full" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {groups.map(({ b, items }) => (items.length === 1
        ? <option key={items[0].id} value={items[0].id}>{BOARD_LABELS[b]}{items[0].refundable === false ? ' · ללא החזר' : ''}</option>
        : (
          <optgroup key={b} label={BOARD_LABELS[b]}>
            {items.map((p) => <option key={p.id} value={p.id}>{BOARD_LABELS[b]} · {p.name}{p.refundable === false ? ' · ללא החזר' : ''}</option>)}
          </optgroup>
        )))}
    </select>
  );
}

function GuestCard({ propertyId, form, setForm, duplicates }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((p) => ({ ...p, [k]: v }));
  async function find(e) {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try { setHits(await booking.guests(propertyId, q.trim())); } catch { setHits([]); } finally { setBusy(false); }
  }
  const g = form.newGuest;
  const fe = form.fieldErrors || {};
  return (
    <Card title="אורח ראשי">
      {duplicates?.length > 0 && (
        <Banner tone="warn">
          <div className="ui-stack" style={{ gap: 6 }}>
            <strong>נמצא אורח קיים עם אותו טלפון או דוא״ל:</strong>
            {duplicates.map((d) => (
              <div key={d.id} className="ui-row">
                <span>{d.name} · <bdi>{d.phone || d.email}</bdi></span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm((p) => ({ ...p, guest: { id: d.id, name: d.name }, forceNewGuest: false }))}>זה הוא</button>
              </div>
            ))}
            <label className="ui-check"><input type="checkbox" checked={!!form.forceNewGuest} onChange={(e) => set('forceNewGuest')(e.target.checked)} /><span>אדם אחר — ליצור אורח חדש</span></label>
          </div>
        </Banner>
      )}
      {form.guest ? (
        <div className="ui-picked"><span>{form.guest.name}{form.guest.vip && <Crown size={12} className="text-amber-600" />}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => set('guest')(null)}>החלפה</button></div>
      ) : (
        <>
          <form className="ui-row" onSubmit={find} role="search">
            <label htmlFor="bf-gq" className="sr-only">חיפוש אורח</label>
            <input id="bf-gq" className="input" style={{ flex: 1, minWidth: 0 }} placeholder="אורח קיים: שם, טלפון או דוא״ל" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || q.trim().length < 2}>{busy ? <Spinner /> : 'חיפוש'}</button>
          </form>
          {hits && hits.length === 0 && <div className="ui-sub">לא נמצא — מלאו אורח חדש.</div>}
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
          <div className="ui-grid-2">
            <Field id="bf-f" label="שם פרטי" required error={fe.firstName}><input id="bf-f" className="input w-full" maxLength={60} value={g.firstName} onChange={(e) => set('newGuest')({ ...g, firstName: e.target.value })} /></Field>
            <Field id="bf-l" label="שם משפחה" required error={fe.lastName}><input id="bf-l" className="input w-full" maxLength={60} value={g.lastName} onChange={(e) => set('newGuest')({ ...g, lastName: e.target.value })} /></Field>
            <Field id="bf-p" label="טלפון" error={fe.phone}><input id="bf-p" type="tel" inputMode="tel" className="input w-full" maxLength={20} value={g.phone} onChange={(e) => set('newGuest')({ ...g, phone: e.target.value })} /></Field>
            <Field id="bf-e" label="דוא״ל" error={fe.email}><input id="bf-e" type="email" className="input w-full" maxLength={120} value={g.email} onChange={(e) => set('newGuest')({ ...g, email: e.target.value })} /></Field>
          </div>
          <div className="ui-sub">טלפון או דוא״ל — לפחות אחד.</div>
        </>
      )}
    </Card>
  );
}

export default function BookingFormPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canOverride = PRICE_OVERRIDE_ROLES.includes(role);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [arrival, setArrival] = useState(() => params.get('arrival') || todayYmd());
  const [departure, setDeparture] = useState(() => params.get('departure') || addDays(params.get('arrival') || todayYmd(), 1));
  const [defaultPlan, setDefaultPlan] = useState('');
  const [rows, setRows] = useState(() => [newRow({ roomTypeId: params.get('roomTypeId') || '', roomId: params.get('roomId') || '', adults: Number(params.get('adults') || 2), children: Number(params.get('children') || 0) })]);
  const [form, setForm] = useState({
    guest: null, newGuest: { firstName: '', lastName: '', phone: '', email: '' }, forceNewGuest: false,
    bookerDiffers: false, booker: { name: '', phone: '', email: '' }, payerType: 'guest', companyId: '', source: 'direct',
    specialRequests: '', internalNotes: '', fieldErrors: {},
  });
  const [companies, setCompanies] = useState([]);
  const [holdMinutes, setHoldMinutes] = useState('60');
  const [quote, setQuote] = useState(() => ({ on: false, validUntil: localDateTime(new Date(Date.now() + 3 * 86400000)), language: 'he', channel: 'email' }));
  const [duplicates, setDuplicates] = useState(null);
  const [lineErrors, setLineErrors] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [opKey, setOpKey] = useState(newOpKey);
  const [residency, setResidency] = useState('resident');
  const [taxRule, setTaxRule] = useState(null);
  const [pricingMode, setPricingMode] = useState('rates');
  useEffect(() => { if (propertyId) booking.boardConfig(propertyId).then((c) => setPricingMode(c.pricingMode || 'rates')).catch(() => setPricingMode('rates')); }, [propertyId]);
  const byBoard = pricingMode === 'board';
  const planLabel = byBoard ? 'פנסיון' : 'תעריף';
  useEffect(() => { if (propertyId) finance.taxPolicy(propertyId).then((t) => setTaxRule(t.tourist)).catch(() => setTaxRule(null)); }, [propertyId]);
  const touristPrice = residency === 'tourist' && taxRule?.enabled && taxRule.pricing !== 'same_price';
  // Tourist display price: the VAT part removed from the services the approved rule covers.
  const touristOf = (r) => {
    const o = offerOf(r); if (!o) return null;
    const vat = 1 + Number(o.vatRate ?? 18) / 100; const codes = taxRule?.chargeCodes || ['rooms'];
    const room = r.override?.rate > 0 ? r.override.rate * nights : o.roomPerRoom;
    const board = Number(o.board?.total || 0);
    return Math.round(((codes.includes('rooms') ? room / vat : room) + (codes.includes('board') ? board / vat : board)) * 100) / 100;
  };
  const nights = nightsOf(arrival, departure);
  const data = useStayData(propertyId, arrival, departure, rows);
  useEffect(() => { if (form.payerType === 'company' && propertyId) booking.companies(propertyId).then(setCompanies).catch(() => setCompanies([])); }, [form.payerType, propertyId]);

  // Defaults once the types are known: first plan, first type for empty rows.
  useEffect(() => {
    if (!data.types?.length) return;
    const plan = defaultPlan || data.types[0].plans[0]?.id || '';
    if (!defaultPlan && plan) setDefaultPlan(plan);
    setRows((rs) => rs.map((r) => {
      const t = data.types.find((x) => x.id === r.roomTypeId) || (r.roomTypeId ? null : data.types[0]);
      if (!t) return r;
      const planOk = t.plans.some((p) => p.id === r.ratePlanId);
      return { ...r, roomTypeId: t.id, ratePlanId: planOk ? r.ratePlanId : (t.plans.some((p) => p.id === plan) ? plan : t.plans[0]?.id || '') };
    }));
  }, [data.types]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (key, patch) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); setLineErrors({}); };
  const rowOffer = (r) => data.offers[offerKey(r, data.types)];
  const offerOf = (r) => rowOffer(r)?.byPlan?.[r.ratePlanId] || null;
  const usedByType = rows.reduce((m, r) => (r.roomTypeId ? m.set(r.roomTypeId, (m.get(r.roomTypeId) || 0) + 1) : m), new Map());
  const rowTotal = (r) => { const o = offerOf(r); if (!o) return null; return r.override?.rate > 0 ? Math.round((r.override.rate * nights + Number(o.board?.total || 0)) * 100) / 100 : o.perRoom; };
  const grand = rows.reduce((s, r) => s + (rowTotal(r) || 0), 0);
  const grandTourist = touristPrice ? rows.reduce((s, r) => s + (touristOf(r) || 0), 0) : null;
  const guests = rows.reduce((s, r) => ({ a: s.a + Number(r.adults || 0), c: s.c + Number(r.children || 0) }), { a: 0, c: 0 });

  // What still blocks a commit (the server re-checks everything).
  const rowWhy = (r, i) => {
    const t = data.types?.find((x) => x.id === r.roomTypeId);
    const o = offerOf(r);
    if (!r.roomTypeId) return 'בחרו סוג חדר';
    if (!r.ratePlanId) return 'בחרו תעריף';
    if (Number(r.children) > 0 && r.childAges.some((a) => a === '' || a === undefined || Number(a) < 0 || Number(a) > 17)) return effBoardOf(r, data.types) !== 'room_only' ? 'גיל לכל ילד (נדרש למחיר האירוח)' : 'גיל לכל ילד';
    if (rowOffer(r)?.error) return rowOffer(r).error;
    if (!o) return null; // still loading
    if (!o.bookable) return o.reasons[0]?.label || 'לא ניתן למכור';
    if (t && (usedByType.get(r.roomTypeId) || 0) > t.available) return `נבחרו ${usedByType.get(r.roomTypeId)} חדרים מסוג זה — פנויים ${t.available}`;
    if (r.override && (!(Number(r.override.rate) > 0) || (r.override.reason || '').trim().length < 3)) return 'מחיר ידני: מחיר וסיבה';
    return lineErrors[i] || null;
  };
  const loading = rows.some((r) => r.roomTypeId && r.ratePlanId && !rowOffer(r));
  const guestOk = form.guest || (form.newGuest.firstName.trim() && form.newGuest.lastName.trim() && (form.newGuest.phone.trim() || form.newGuest.email.trim()));
  const firstRowWhy = rows.map(rowWhy).find(Boolean);
  let why = null;
  if (nights < 1) why = 'בחרו תאריכים';
  else if (!rows.length) why = 'הוסיפו חדר';
  else if (firstRowWhy) why = firstRowWhy;
  else if (loading) why = 'טוען מחירים…';
  else if (!guestOk) why = 'בחרו אורח או מלאו אורח חדש';
  else if (form.payerType === 'company' && !form.companyId) why = 'בחרו חברה משלמת';

  const guestPart = form.guest ? { guestId: form.guest.id } : { newGuest: form.newGuest, forceNewGuest: form.forceNewGuest };
  const common = {
    arrival, departure, source: form.source, payerType: form.payerType, companyId: form.payerType === 'company' ? form.companyId : undefined,
    booker: form.bookerDiffers ? form.booker : undefined, specialRequests: form.specialRequests || undefined, internalNotes: form.internalNotes || undefined, ...guestPart, residency,
  };
  const lineBody = (r) => ({
    roomTypeId: r.roomTypeId, ratePlanId: r.ratePlanId, board: effBoardOf(r, data.types), adults: Number(r.adults), children: Number(r.children || 0),
    childAges: Number(r.children) > 0 ? r.childAges.map(Number) : [], priceSignature: offerOf(r)?.priceSignature, roomId: r.roomId || undefined,
    ...(r.override ? { override: { ratePerNight: Number(r.override.rate), reason: r.override.reason } } : {}),
  });

  async function submit(mode) {
    setBusy(mode); setError(null); setNotice(null); setLineErrors({});
    try {
      let out;
      if (mode === 'quote') {
        const r = rows[0];
        out = await booking.create(propertyId, { ...common, ...lineBody(r), rooms: 1, mode: 'quote', idempotencyKey: opKey, validUntil: new Date(quote.validUntil).toISOString(), language: quote.language, channel: quote.channel });
        nav(`/pms/reservations/${out.id}?created=1`);
        return;
      }
      out = await booking.party(propertyId, { ...common, mode, lines: rows.map(lineBody), idempotencyKey: opKey, ...(mode === 'hold' ? { holdMinutes: Number(holdMinutes) } : {}) });
      const failed = (out.assignments || []).filter((a) => !a.ok);
      nav(`/pms/reservations/${out.rooms[0].id}?created=1${failed.length ? `&assignWarn=${failed.length}` : ''}`);
    } catch (e) {
      if (e.code === 'possible_duplicate') { setDuplicates(e.details || []); setError(null); return; }
      if (e.code === 'price_changed') { data.refresh(); setNotice('המחיר של אחד החדרים השתנה מאז שהוצג — המחירים עודכנו. בדקו ואשרו שוב.'); return; }
      if (e.fields?.lines && typeof e.fields.lines === 'object') setLineErrors(e.fields.lines);
      if (e.fields && !e.fields.lines) setForm((p) => ({ ...p, fieldErrors: e.fields }));
      setError(e);
    } finally { setBusy(null); }
  }

  const multi = rows.length > 1;
  const typeLabel = (t) => `${t.name}${t.available !== undefined ? ` · ${t.available} פנויים` : ''}`;
  return (
    <Page wide title="הזמנה חדשה" back="/pms/reservations">
      <div className="ui-toolbar">
        <div>
          <div className="ui-sub">{nights > 0 ? `${formatShort(arrival)} – ${formatShort(departure)} · ${nights} לילות · ${rows.length} ${rows.length === 1 ? 'חדר' : 'חדרים'} · ${guests.a} מבוגרים${guests.c ? ` · ${guests.c} ילדים` : ''}` : 'בחרו תאריכים'}</div>
        </div>
        <div className="ui-toolbar-end ui-row">
          {why && <span className="ui-foot-note">{why}</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav('/pms/reservations')} disabled={!!busy}>ביטול</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => submit('draft')} disabled={!!busy || nights < 1 || !guestOk || !rows.every((r) => r.roomTypeId && r.ratePlanId)} title="בלי מלאי ובלי התחייבות">{busy === 'draft' ? <Spinner /> : 'טיוטה'}</button>
          <span className="ui-row" style={{ gap: 4 }}>
            <select className="select" aria-label="משך החזקה" value={holdMinutes} onChange={(e) => setHoldMinutes(e.target.value)}>{HOLD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => submit('hold')} disabled={!!busy || !!why} title="תופס מלאי עד המועד; משתחרר אם לא אושר">{busy === 'hold' ? <Spinner /> : 'החזקה'}</button>
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => submit('confirm')} disabled={!!busy || !!why}>
            {busy === 'confirm' ? <><Spinner /> שומר…</> : `אישור ${multi ? `${rows.length} חדרים` : 'הזמנה'}${grand ? ` · ${money(grand)}` : ''}`}
          </button>
        </div>
      </div>
      <ErrorBanner error={error || data.error} />
      {notice && <Banner tone="warn">{notice}</Banner>}

      <div className="ui-split">
        <div className="ui-stack">
          <Card title="שהייה" actions={(
            <div className="ui-seg" role="tablist" aria-label="תושבות">
              <button type="button" role="tab" aria-selected={residency === 'resident'} className={residency === 'resident' ? 'is-on' : ''} onClick={() => setResidency('resident')}>תושב ישראל</button>
              <button type="button" role="tab" aria-selected={residency === 'tourist'} className={residency === 'tourist' ? 'is-on' : ''} onClick={() => setResidency('tourist')}>תייר</button>
            </div>
          )}>
            {residency === 'tourist' && (
              <Banner tone={taxRule?.enabled ? 'info' : 'warn'}>
                {taxRule?.enabled
                  ? (taxRule.pricing === 'same_price' ? 'תייר: אותו מחיר, נרשם ללא מע״מ — בכפוף לאימות דרכון ואשרה בכניסה.' : 'תייר: המחיר מוצג גם ללא מע״מ — בכפוף לאימות דרכון ואשרה בכניסה. אם לא יאומת — המחיר הרגיל.')
                  : 'תייר: בנכס לא אושר כלל פטור ממע״מ — המחיר כולל מע״מ. ההזמנה תסומן כ"תייר" והראיות יירשמו בכניסה.'}
              </Banner>
            )}
            <div className="ui-grid-3">
              <Field id="bf-arr" label="כניסה" required>
                <input id="bf-arr" type="date" className="input w-full" min={todayYmd()} value={arrival} onChange={(e) => { setArrival(e.target.value); if (departure <= e.target.value) setDeparture(addDays(e.target.value, 1)); }} />
              </Field>
              <Field id="bf-dep" label="יציאה" required hint={nights > 0 ? `${nights} לילות` : undefined}>
                <input id="bf-dep" type="date" className="input w-full" min={arrival ? addDays(arrival, 1) : undefined} value={departure} onChange={(e) => setDeparture(e.target.value)} />
              </Field>
              <Field id="bf-plan" label={`${planLabel} ברירת מחדל`} hint="לחדרים חדשים; אפשר לשנות לכל חדר">
                <PlanSelect id="bf-plan" plans={[...new Map((data.types || []).flatMap((t) => t.plans).map((p) => [p.id, p])).values()]} byBoard={byBoard} value={defaultPlan} label={`${planLabel} ברירת מחדל`} onChange={(v) => { setDefaultPlan(v); setRows((rs) => rs.map((r) => { const t = data.types?.find((x) => x.id === r.roomTypeId); return t?.plans.some((p) => p.id === v) ? { ...r, ratePlanId: v } : r; })); }} />
              </Field>
            </div>
          </Card>

          <Card title={`חדרים · ${rows.length}`} flush actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setRows((rs) => [...rs, newRow({ roomTypeId: rs[rs.length - 1]?.roomTypeId || '', ratePlanId: rs[rs.length - 1]?.ratePlanId || defaultPlan })])} disabled={rows.length >= 20}><Plus size={14} /> הוספת חדר</button>}>
            {!data.types && nights > 0 && <div className="ui-empty"><Spinner /> טוען סוגי חדרים וזמינות…</div>}
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr><th>#</th><th>סוג חדר</th><th>מבוגרים</th><th>ילדים</th><th>{planLabel}</th><th>חדר</th><th style={{ textAlign: 'left' }}>מחיר</th><th><span className="sr-only">פעולות</span></th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const t = data.types?.find((x) => x.id === r.roomTypeId);
                    const o = offerOf(r);
                    const w = rowWhy(r, i);
                    const taken = new Set(rows.filter((x) => x.key !== r.key && x.roomId).map((x) => x.roomId));
                    const free = (data.rooms[r.roomTypeId] || []).filter((x) => !taken.has(x.id));
                    return (
                      <tr key={r.key}>
                        <td className="ui-num">{i + 1}</td>
                        <td style={{ minWidth: 170 }}>
                          <select className="select w-full" aria-label={`סוג חדר ${i + 1}`} value={r.roomTypeId} onChange={(e) => { const nt = data.types.find((x) => x.id === e.target.value); setRow(r.key, { roomTypeId: e.target.value, roomId: '', ratePlanId: nt?.plans.some((p) => p.id === r.ratePlanId) ? r.ratePlanId : nt?.plans.find((p) => p.id === defaultPlan)?.id || nt?.plans[0]?.id || '' }); }}>
                            {!r.roomTypeId && <option value="">בחירה…</option>}
                            {(data.types || []).map((x) => <option key={x.id} value={x.id}>{typeLabel(x)}</option>)}
                          </select>
                          {t && <div className="ui-sub">עד {t.capacityMax} אורחים</div>}
                          {w && <div className="ui-error">{w}</div>}
                        </td>
                        <td><input type="number" min="1" max="10" className="input" style={{ width: 60 }} aria-label={`מבוגרים בחדר ${i + 1}`} value={r.adults} onChange={(e) => setRow(r.key, { adults: Math.max(1, Number(e.target.value) || 1) })} /></td>
                        <td>
                          <input type="number" min="0" max="8" className="input" style={{ width: 60 }} aria-label={`ילדים בחדר ${i + 1}`} value={r.children} onChange={(e) => { const c = Math.max(0, Number(e.target.value) || 0); setRow(r.key, { children: c, childAges: Array.from({ length: c }, (_, j) => r.childAges[j] ?? '') }); }} />
                          {Number(r.children) > 0 && (
                            <div className="ui-row" style={{ gap: 4, marginTop: 4 }}>
                              {r.childAges.map((a, j) => <input key={j} type="number" min="0" max="17" placeholder="גיל" className="input" style={{ width: 52 }} aria-label={`גיל ילד ${j + 1} בחדר ${i + 1}`} value={a} onChange={(e) => setRow(r.key, { childAges: r.childAges.map((x, k) => (k === j ? e.target.value : x)) })} />)}
                            </div>
                          )}
                        </td>
                        <td style={{ minWidth: 140 }}>
                          <PlanSelect plans={t?.plans || []} byBoard={byBoard} value={r.ratePlanId} label={`${planLabel} חדר ${i + 1}`} onChange={(v) => setRow(r.key, { ratePlanId: v })} />
                        </td>
                        <td style={{ minWidth: 120 }}>
                          <select className="select w-full" aria-label={`חדר ספציפי ${i + 1}`} value={r.roomId} onChange={(e) => setRow(r.key, { roomId: e.target.value })}>
                            <option value="">שיבוץ בהמשך</option>
                            {r.roomId && !free.some((x) => x.id === r.roomId) && <option value={r.roomId}>החדר שנבחר אינו פנוי</option>}
                            {free.map((x) => <option key={x.id} value={x.id}>{x.number} · קומה {x.floor}</option>)}
                          </select>
                        </td>
                        <td style={{ textAlign: 'left', minWidth: 120 }}>
                          {!o ? (r.roomTypeId && r.ratePlanId && !rowOffer(r)?.error ? <Spinner /> : '—') : (
                            <div>
                              <div className="ui-amount font-medium">{money(rowTotal(r))}</div>
                              <div className="ui-sub">{r.override?.rate > 0 ? `${money(r.override.rate)} ללילה · ידני` : `${money(o.averageNight)} ללילה`}</div>
                              {Number(o.board?.total) > 0 && <div className="ui-sub">לינה {money(r.override?.rate > 0 ? r.override.rate * nights : o.roomPerRoom)} · אירוח {money(o.board.total)}</div>}
                              {touristPrice && <div className="ui-sub">לתייר: {money(touristOf(r))}</div>}
                              {canOverride && !r.override && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRow(r.key, { override: { rate: '', reason: '' } })}>מחיר ידני</button>}
                            </div>
                          )}
                          {r.override && (
                            <div className="ui-stack" style={{ gap: 4, marginTop: 4 }}>
                              <input type="number" min="1" step="0.01" className="input" placeholder="ללילה" aria-label={`מחיר ידני חדר ${i + 1}`} value={r.override.rate} onChange={(e) => setRow(r.key, { override: { ...r.override, rate: e.target.value === '' ? '' : Number(e.target.value) } })} />
                              <input className="input" maxLength={300} placeholder="סיבה" aria-label={`סיבת מחיר ידני חדר ${i + 1}`} value={r.override.reason} onChange={(e) => setRow(r.key, { override: { ...r.override, reason: e.target.value } })} />
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRow(r.key, { override: null })}>ביטול מחיר ידני</button>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="ui-row" style={{ gap: 2 }}>
                            <button type="button" className="btn btn-ghost btn-sm btn-icon" title="עוד חדר כזה" aria-label={`שכפול חדר ${i + 1}`} disabled={rows.length >= 20} onClick={() => setRows((rs) => [...rs.slice(0, i + 1), { ...r, key: rowKey(), roomId: '' }, ...rs.slice(i + 1)])}><Copy size={14} /></button>
                            <button type="button" className="btn btn-ghost btn-sm btn-icon" title="הסרה" aria-label={`הסרת חדר ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {multi && <div className="ui-sub" style={{ padding: '8px 14px' }}>כל חדר נשמר כהזמנה משלו, מקושרת לאחרות — כניסה, יציאה, חשבון וביטול לכל חדר בנפרד. אם חדר אחד לא נשמר — אף חדר לא נשמר.</div>}
          </Card>
        </div>

        <div className="ui-stack">
          <GuestCard propertyId={propertyId} form={form} setForm={setForm} duplicates={duplicates} />
          <Card title="מזמין, משלם וערוץ">
            <label className="ui-check"><input type="checkbox" checked={form.bookerDiffers} onChange={(e) => setForm((p) => ({ ...p, bookerDiffers: e.target.checked }))} /><span>המזמין אינו האורח</span></label>
            {form.bookerDiffers && (
              <div className="ui-stack" style={{ gap: 6 }}>
                <input className="input w-full" placeholder="שם המזמין" maxLength={120} value={form.booker.name} onChange={(e) => setForm((p) => ({ ...p, booker: { ...p.booker, name: e.target.value } }))} aria-label="שם המזמין" />
                <div className="ui-grid-2">
                  <input className="input w-full" type="tel" placeholder="טלפון" maxLength={30} value={form.booker.phone} onChange={(e) => setForm((p) => ({ ...p, booker: { ...p.booker, phone: e.target.value } }))} aria-label="טלפון המזמין" />
                  <input className="input w-full" type="email" placeholder="דוא״ל" maxLength={120} value={form.booker.email} onChange={(e) => setForm((p) => ({ ...p, booker: { ...p.booker, email: e.target.value } }))} aria-label="דוא״ל המזמין" />
                </div>
              </div>
            )}
            <div className="ui-grid-2">
              <Field id="bf-payer" label="משלם" required>
                <select id="bf-payer" className="select w-full" value={form.payerType} onChange={(e) => setForm((p) => ({ ...p, payerType: e.target.value }))}>
                  <option value="guest">האורח</option><option value="company">חברה</option>{form.bookerDiffers && <option value="booker">המזמין</option>}
                </select>
              </Field>
              <Field id="bf-src" label="ערוץ" required>
                <select id="bf-src" className="select w-full" value={form.source} onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))}>{Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </Field>
            </div>
            {form.payerType === 'company' && (
              <Field id="bf-co" label="חברה" required>
                <select id="bf-co" className="select w-full" value={form.companyId} onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value }))}><option value="">בחירה…</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </Field>
            )}
            <Field id="bf-req" label="בקשות האורח" optional hint="מוצג לקבלה ולחדרנות"><textarea id="bf-req" className="input w-full" rows={2} maxLength={1000} value={form.specialRequests} onChange={(e) => setForm((p) => ({ ...p, specialRequests: e.target.value }))} /></Field>
            <Field id="bf-int" label="הערה פנימית" optional><input id="bf-int" className="input w-full" maxLength={1000} value={form.internalNotes} onChange={(e) => setForm((p) => ({ ...p, internalNotes: e.target.value }))} /></Field>
          </Card>
          <Card title="סיכום">
            <KeyValues rows={[
              ...rows.map((r, i) => {
                const t = data.types?.find((x) => x.id === r.roomTypeId);
                return [`חדר ${i + 1}${t ? ` · ${t.name}` : ''}`, rowTotal(r) !== null ? money(rowTotal(r)) : '—'];
              }),
              ['סה״כ (כולל מע״מ)', money(grand)],
              grandTourist !== null ? ['סה״כ לתייר (ללא מע״מ, לאחר אימות)', money(grandTourist)] : null,
              offerOf(rows[0]) ? ['ביטול', offerOf(rows[0]).cancellation.text] : null,
              offerOf(rows[0]) ? ['מקדמה', offerOf(rows[0]).deposit] : null,
            ]} />
            {!multi && (
              <div className="ui-stack" style={{ gap: 6 }}>
                <label className="ui-check"><input type="checkbox" checked={quote.on} onChange={(e) => setQuote((q) => ({ ...q, on: e.target.checked }))} /><span>לשמור כהצעת מחיר (לא הזמנה)</span></label>
                {quote.on && (
                  <>
                    <div className="ui-grid-2">
                      <input type="datetime-local" className="input w-full" aria-label="תוקף ההצעה" value={quote.validUntil} onChange={(e) => setQuote((q) => ({ ...q, validUntil: e.target.value }))} />
                      <select className="select w-full" aria-label="ערוץ מסירה" value={quote.channel} onChange={(e) => setQuote((q) => ({ ...q, channel: e.target.value }))}>{Object.entries(QUOTE_CHANNEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy || !!why} onClick={() => submit('quote')}>{busy === 'quote' ? <Spinner /> : 'שמירת הצעת מחיר'}</button>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
