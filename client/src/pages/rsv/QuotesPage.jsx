// Quotations (Optima "Quotation" / "Quotation multi"): one offer to one customer with several
// alternatives (room type × rate × board), priced by the booking engine. Print/send it, then turn
// the option the customer picked into a reservation. Single-option quotes made from the booking
// form remain on the reservations list ("quotes" view).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Printer, Send, Check } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { proposals, booking } from '../../utils/api';
import { formatShort } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, PageBar, Card, Segmented, SearchBox, DataTable, Empty, Modal, Field, ConfirmDialog, Tag, Banner,
  ErrorBanner, Spinner, useUrlState, useLoader, useAction, money, newOpKey, formatDateTime,
} from '../../components/kit';

const WORK = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'revenue_manager', 'sales_manager'];
const DEFAULTS = { view: 'open', q: '', quote: '' };
const BOARD = { room_only: 'לינה בלבד', breakfast: 'ארוחת בוקר', half_board: 'חצי פנסיון', full_board: 'פנסיון מלא' };
const tone = (p) => (p.status === 'won' ? 'ok' : p.status === 'lost' || p.expired ? 'bad' : p.status === 'sent' ? undefined : 'warn');
const localDT = (d) => { const z = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
const openHtml = (html) => { const w = window.open('', '_blank'); if (w) { w.document.open(); w.document.write(html); w.document.close(); } };

function NewQuoteDialog({ open, onClose, propertyId, onSaved }) {
  const act = useAction();
  const find = useAction();
  const [f, setF] = useState({});
  const [offers, setOffers] = useState(null);
  const [picked, setPicked] = useState({});
  useEffect(() => {
    if (!open) return;
    act.reset(); find.reset(); setOffers(null); setPicked({});
    setF({ name: '', phone: '', email: '', company: '', arrival: '', departure: '', adults: '2', children: '0', ages: '', rooms: '1', board: '', promoCode: '', validUntil: localDT(new Date(Date.now() + 3 * 86400000)), note: '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => { setF((p) => ({ ...p, [k]: e.target.value })); if (['arrival', 'departure', 'adults', 'children', 'ages', 'rooms', 'board', 'promoCode'].includes(k)) { setOffers(null); setPicked({}); } };
  const ages = String(f.ages || '').split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  const search = () => find.run(async () => {
    const r = await booking.availability(propertyId, { arrival: f.arrival, departure: f.departure, adults: Number(f.adults), children: Number(f.children || 0), rooms: Number(f.rooms || 1), childAges: ages.length ? ages.join(',') : undefined, board: f.board || undefined, promoCode: f.promoCode || undefined });
    setOffers(r);
  });
  const keyOf = (o) => `${o.roomType.id}|${o.ratePlan.id}|${o.board.type}`;
  const chosen = Object.values(picked);
  const why = (f.name || '').trim().length < 2 ? 'נדרש שם הלקוח' : !(f.phone || '').trim() && !(f.email || '').trim() ? 'טלפון או דוא״ל' : !chosen.length ? 'בחרו לפחות חלופה אחת' : chosen.length > 8 ? 'עד 8 חלופות' : null;
  const submit = () => act.run(async () => onSaved(await proposals.create(propertyId, {
    customer: { name: f.name, phone: f.phone, email: f.email, company: f.company }, arrival: f.arrival, departure: f.departure,
    adults: Number(f.adults), children: Number(f.children || 0), childAges: ages, rooms: Number(f.rooms || 1), promoCode: f.promoCode || undefined,
    validUntil: new Date(f.validUntil).toISOString(), note: f.note,
    options: chosen.map((o) => ({ roomTypeId: o.roomType.id, ratePlanId: o.ratePlan.id, board: f.board || undefined, note: o.note })),
  })));
  const bookable = (offers?.offers || []).filter((o) => o.bookable);
  return (
    <Modal open={open} onClose={onClose} busy={act.busy} width={820} title="הצעת מחיר חדשה" subtitle="בחרו כמה חלופות — הלקוח מקבל את כולן במסמך אחד ובוחר"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={act.busy}>ביטול</button>
          <button type="submit" form="qt-form" className="btn btn-primary" disabled={!!why || act.busy} title={why || undefined}>{act.busy ? <Spinner /> : `שמירת הצעה${chosen.length ? ` (${chosen.length} חלופות)` : ''}`}</button>
        </>
      )}>
      <form id="qt-form" className="ui-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (!why) submit(); }}>
        <ErrorBanner error={act.error} />
        <div className="ui-grid-2">
          <Field id="qt-name" label="שם הלקוח" required error={act.fields['customer.name']}><input id="qt-name" className="input w-full" maxLength={120} value={f.name || ''} onChange={set('name')} /></Field>
          <Field id="qt-co" label="חברה" optional><input id="qt-co" className="input w-full" maxLength={120} value={f.company || ''} onChange={set('company')} /></Field>
          <Field id="qt-ph" label="טלפון" error={act.fields['customer.phone']}><input id="qt-ph" dir="ltr" className="input w-full" maxLength={30} value={f.phone || ''} onChange={set('phone')} /></Field>
          <Field id="qt-em" label="דוא״ל" optional><input id="qt-em" dir="ltr" className="input w-full" maxLength={120} value={f.email || ''} onChange={set('email')} /></Field>
        </div>
        <div className="ui-grid-2" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <Field id="qt-a" label="הגעה" required><input id="qt-a" type="date" className="input w-full" value={f.arrival} onChange={set('arrival')} /></Field>
          <Field id="qt-d" label="עזיבה" required><input id="qt-d" type="date" className="input w-full" min={f.arrival || undefined} value={f.departure} onChange={set('departure')} /></Field>
          <Field id="qt-ad" label="מבוגרים" required><input id="qt-ad" type="number" min="1" className="input w-full" value={f.adults} onChange={set('adults')} /></Field>
          <Field id="qt-ch" label="ילדים" optional><input id="qt-ch" type="number" min="0" className="input w-full" value={f.children} onChange={set('children')} /></Field>
          {Number(f.children) > 0 && <Field id="qt-ag" label="גילאי ילדים" hint="מופרדים בפסיק"><input id="qt-ag" className="input w-full" value={f.ages} onChange={set('ages')} placeholder="4, 9" /></Field>}
          <Field id="qt-r" label="חדרים" required><input id="qt-r" type="number" min="1" max="20" className="input w-full" value={f.rooms} onChange={set('rooms')} /></Field>
          <Field id="qt-b" label="אירוח" optional><select id="qt-b" className="select w-full" value={f.board} onChange={set('board')}><option value="">לפי התעריף</option>{Object.entries(BOARD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="qt-p" label="קוד מבצע" optional error={offers?.promo && !offers.promo.ok ? offers.promo.why : undefined}><input id="qt-p" dir="ltr" className="input w-full" value={f.promoCode} onChange={(e) => { set('promoCode')({ target: { value: e.target.value.toUpperCase() } }); }} /></Field>
        </div>
        <div><button type="button" className="btn btn-secondary" disabled={!f.arrival || !f.departure || find.busy} onClick={search}>{find.busy ? <Spinner /> : 'בדיקת זמינות ומחירים'}</button></div>
        <ErrorBanner error={find.error} />
        {offers && (
          bookable.length ? (
            <table className="ui-table" style={{ width: '100%' }}>
              <thead><tr><th /><th>חדר</th><th>תעריף</th><th>ממוצע ללילה</th><th>סה״כ</th><th>הערה לחלופה</th></tr></thead>
              <tbody>
                {bookable.map((o) => {
                  const k = keyOf(o);
                  const on = !!picked[k];
                  return (
                    <tr key={k}>
                      <td><input type="checkbox" aria-label={`בחירת ${o.roomType.name} ${o.ratePlan.name}`} checked={on} onChange={() => setPicked((p) => { const n = { ...p }; if (on) delete n[k]; else n[k] = { ...o, note: '' }; return n; })} /></td>
                      <td>{o.roomType.name}<div className="ui-sub">נותרו {o.available}</div></td>
                      <td>{o.ratePlan.name}<div className="ui-sub">{BOARD[o.board.type]}{o.ratePlan.refundable ? '' : ' · ללא החזר'}{o.promotion ? ` · ${o.promotion.label}` : ''}</div></td>
                      <td className="ui-num">{money(o.averageNight)}</td>
                      <td className="ui-num"><b>{money(o.total)}</b></td>
                      <td>{on && <input className="input" maxLength={200} aria-label="הערה לחלופה" value={picked[k].note} onChange={(e) => setPicked((p) => ({ ...p, [k]: { ...p[k], note: e.target.value } }))} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <Banner tone="warn">אין חדר זמין שמתאים לתאריכים ולהרכב.</Banner>
        )}
        <div className="ui-grid-2">
          <Field id="qt-v" label="תוקף ההצעה" required error={act.fields.validUntil}><input id="qt-v" type="datetime-local" className="input w-full" value={f.validUntil} onChange={set('validUntil')} /></Field>
          <Field id="qt-n" label="הערה ללקוח" optional><input id="qt-n" className="input w-full" maxLength={1000} value={f.note} onChange={set('note')} /></Field>
        </div>
      </form>
    </Modal>
  );
}

function QuoteView({ propertyId, id, role }) {
  const nav = useNavigate();
  const { toasts, success } = useToast();
  const [dialog, setDialog] = useState(null);
  const busy = useAction();
  const [acceptErr, setAcceptErr] = useState(null);
  const { data: p, loading, error, reload } = useLoader(async () => (propertyId ? proposals.get(propertyId, id) : null), [propertyId, id]);
  const canWork = WORK.includes(role);
  if (loading && !p) return <div className="ui-empty"><Spinner /> טוען…</div>;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!p) return null;
  const live = ['open', 'sent'].includes(p.status) && !p.expired;
  const accept = async (o, acceptNewPrice = false) => {
    setAcceptErr(null);
    try {
      const out = await proposals.accept(propertyId, p.id, { optionId: o.id, acceptNewPrice, idempotencyKey: dialog?.key || newOpKey() });
      setDialog(null);
      success(`נוצרה הזמנה ${out.confirmationNumber || ''}`);
      nav(`/pms/reservations/${out.reservationId}?created=1`);
    } catch (e) {
      setDialog(null);
      setAcceptErr({ message: e.message, code: e.code, total: e.details?.[0]?.total, option: o });
    }
  };
  const priceChanged = acceptErr?.code === 'price_changed';
  return (
    <>
      <ToastContainer toasts={toasts} />
      <PageBar back="/pms/quotes" title={<>הצעה {p.number} <Tag tone={tone(p)}>{p.statusLabel}</Tag></>}
        meta={`${p.customer.name}${p.customer.company ? ` · ${p.customer.company}` : ''} · ${formatShort(p.arrival)} – ${formatShort(p.departure)} · ${p.nights} לילות · ${p.adults} מבוגרים${p.children ? ` · ${p.children} ילדים` : ''}`}
        tools={(
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => busy.run(() => proposals.print(propertyId, p.id)).then((h) => h && openHtml(h))}><Printer size={16} /> הדפסה / PDF</button>
            {live && canWork && p.status === 'open' && <button type="button" className="btn btn-secondary" onClick={() => busy.run(() => proposals.sent(propertyId, p.id)).then((o) => { if (o) { success('סומן כנשלח'); reload(); } })}><Send size={16} /> סימון כנשלח</button>}
            {live && canWork && <button type="button" className="btn btn-ghost" onClick={() => setDialog({ kind: 'lost' })}>סגירה בלי הזמנה</button>}
          </div>
        )} />
      <ErrorBanner error={busy.error || (acceptErr && !priceChanged ? acceptErr.message : null)} />
      {priceChanged && (
        <Banner tone="warn">
          המחיר של החלופה השתנה מאז ההצעה ({money(acceptErr.total)} במקום {money(acceptErr.option.total)}).{' '}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => accept(acceptErr.option, true)}>הזמנה במחיר החדש</button>
        </Banner>
      )}
      {p.expired && <Banner tone="warn">תוקף ההצעה עבר ב־{formatDateTime(p.validUntil)}. צרו הצעה חדשה כדי לבדוק זמינות ומחיר מחדש.</Banner>}
      {p.status === 'lost' && <Banner tone="warn">נסגרה: {p.lostReason}</Banner>}
      {p.note && <Card><p className="ui-p">{p.note}</p></Card>}
      <div className="ui-tiles" style={{ '--tiles': Math.min(p.options.length, 3) }}>
        {p.options.map((o, i) => (
          <div key={o.id} className={`ui-tile is-static ${p.chosenOption === o.id ? 'is-selected' : ''}`} style={{ textAlign: 'start', alignItems: 'stretch', gap: 6 }}>
            <span className="ui-sub">חלופה {i + 1}{p.chosenOption === o.id ? ' · נבחרה' : ''}</span>
            <b>{o.roomTypeName}{o.rooms > 1 ? ` × ${o.rooms}` : ''}</b>
            <span className="ui-sub">{o.ratePlanName} · {o.boardLabel}{o.refundable === false ? ' · ללא החזר' : ''}</span>
            {o.note && <span className="ui-sub">{o.note}</span>}
            <span className="ui-tile-n">{money(o.total)}</span>
            <span className="ui-sub">{money(o.averageNight)} ללילה בממוצע</span>
            <span className="ui-sub">{o.cancellation}</span>
            {live && canWork && <button type="button" className="btn btn-primary btn-sm" disabled={busy.busy} onClick={() => { setDialog({ kind: 'accept', option: o, key: newOpKey() }); }}><Check size={14} /> הלקוח בחר</button>}
          </div>
        ))}
      </div>
      {p.reservationId && <Banner tone="info">הוזמן: <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav(`/pms/reservations/${p.reservationId}`)}>לתיק ההזמנה</button></Banner>}
      <p className="ui-sub">נוצרה {formatDateTime(p.createdAt)}{p.createdBy ? ` · ${p.createdBy}` : ''} · בתוקף עד {formatDateTime(p.validUntil)}{p.sentAt ? ` · נשלחה ${formatDateTime(p.sentAt)}` : ''}</p>
      <ConfirmDialog open={dialog?.kind === 'accept'} onClose={() => setDialog(null)} title="יצירת הזמנה מהחלופה" subtitle={dialog?.option ? `${dialog.option.roomTypeName} · ${dialog.option.ratePlanName} · ${money(dialog.option.total)}` : ''} confirmLabel="יצירת הזמנה"
        onConfirm={() => accept(dialog.option)}>
        <p className="ui-p">תיווצר הזמנה מאושרת על שם {p.customer.name}. הזמינות והמחיר נבדקים מחדש.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog?.kind === 'lost'} onClose={() => setDialog(null)} title="סגירת ההצעה" confirmLabel="סגירה" danger requireReason reasonLabel="למה הלקוח לא הזמין?"
        onConfirm={async (reason) => { await proposals.lost(propertyId, p.id, reason); setDialog(null); success('ההצעה נסגרה'); reload(); }}>
        <p className="ui-p">ההצעה תסומן כאבודה, עם הסיבה.</p>
      </ConfirmDialog>
    </>
  );
}

function QuoteIndex({ propertyId, url, canWork, onOpen }) {
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? proposals.list(propertyId, { view: url.get('view'), q: url.get('q') || undefined }) : null), [propertyId, url.key]);
  const c = data?.counts || {};
  const cols = [
    { key: 'n', label: 'מספר', nowrap: true, render: (p) => <bdi className="ui-num">{p.number}</bdi> },
    { key: 'c', label: 'לקוח', render: (p) => (<div><button type="button" className="ui-guest-name" onClick={() => onOpen(p)}>{p.customer.name}</button><div className="ui-sub">{p.customer.company || p.customer.phone || p.customer.email || ''}</div></div>) },
    { key: 'd', label: 'תאריכים', nowrap: true, render: (p) => <span className="ui-num">{formatShort(p.arrival)} – {formatShort(p.departure)} · {p.nights} לילות</span> },
    { key: 'o', label: 'חלופות', nowrap: true, render: (p) => <span>{p.options.length} · מ־{money(p.cheapest, 'ILS', 0)}</span> },
    { key: 's', label: 'מצב', nowrap: true, render: (p) => <Tag tone={tone(p)}>{p.statusLabel}</Tag> },
    { key: 'v', label: 'בתוקף עד', nowrap: true, render: (p) => <span className="ui-num">{formatDateTime(p.validUntil)}</span> },
  ];
  return (
    <>
      <PageBar title="הצעות מחיר" back="/pms"
        tools={(
          <>
            <SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="מספר, שם, טלפון או חברה" id="qt-q" />
            <button type="button" className="btn btn-ghost" onClick={() => nav('/pms/reservations?view=quotes')}>הצעות בודדות מטופס ההזמנה</button>
            {canWork && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> הצעה חדשה</button>}
          </>
        )} />
      <Segmented label="סינון" value={url.get('view')} onChange={(v) => url.set({ view: v })} options={[{ value: 'open', label: 'פתוחות', count: data ? c.open : undefined }, { value: 'won', label: 'הומרו להזמנה', count: data ? c.won : undefined }, { value: 'lost', label: 'נסגרו', count: data ? c.lost : undefined }]} />
      <Card flush>
        <DataTable caption="הצעות מחיר" columns={cols} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} onRowClick={onOpen} filtered={!!url.get('q')}
          empty={<Empty title="אין הצעות בתצוגה זו">הצעת מחיר מרובת חלופות: כמה סוגי חדר ותעריפים ללקוח אחד, במסמך אחד.</Empty>} />
      </Card>
      <NewQuoteDialog open={creating} onClose={() => setCreating(false)} propertyId={propertyId} onSaved={(o) => { setCreating(false); onOpen(o); }} />
    </>
  );
}

export default function QuotesPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const url = useUrlState(DEFAULTS);
  const id = url.get('quote');
  return (
    <Page wide approved>
      {id ? <QuoteView propertyId={propertyId} id={id} role={role} /> : <QuoteIndex propertyId={propertyId} url={url} canWork={WORK.includes(role)} onOpen={(p) => url.set({ quote: p.id }, { resetPage: false })} />}
    </Page>
  );
}
