// RSV-03 — reservation and stay file: the shared context for everything done on a booking.
// Commercial status apart from unit states; guests, booker and payer; units and rooms; the price
// and terms frozen at booking; money (balance, documents) for those allowed; requests; history.
// Actions open the dedicated flows (check-in wizard, check-out wizard, folio) — nothing is
// re-implemented here. Quotes and holds get their own lifecycle actions.
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Crown, Printer } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { booking, frontdesk, roomTypes as roomTypesApi } from '../../utils/api';
import { RES_STATUS_LABELS, SOURCE_LABELS, GUARANTEE_LABELS, QUOTE_CHANNEL_LABELS, DOC_TYPE_LABELS, cleanLabel } from '../../lib/labels';
import { formatShort, formatLong } from '../../utils/date';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Toolbar, Card, DataTable, Pill, Tag, Banner, KeyValues, RowMenu, ConfirmDialog, Modal, ErrorBanner, Spinner, Empty, Field,
  useLoader, useAction, money, formatDateTime,
} from '../../components/kit';
import { MoveRoomDialog, ExtendDialog, EarlyDepartureDialog, ModifyBookingDialog, CancelBookingDialog } from '../../components/stay/StayChangeDialogs';
import { ReinstateDialog, ReverseCheckInDialog, PostStayChargeDialog } from '../../components/stay/ReversalDialogs';
import TouristDialog, { DECISION_TONE } from '../../components/stay/TouristDialog';
import { stay as stayApi } from '../../utils/api';

const STATUS_TONE = {
  confirmed: 'ok', modified: 'ok', in_house: 'ok', checked_in: 'ok', partially_checked_in: 'ok', partially_checked_out: 'warn',
  hold: 'warn', pending_payment: 'warn', quote: 'muted', draft: 'muted', checked_out: 'muted', cancelled: 'bad', no_show: 'bad',
};
const UNIT_STATUS = { reserved: 'שמורה', tentative: 'זמנית', in_house: 'בבית', checked_in: 'בבית', checked_out: 'יצאה', cancelled: 'בוטלה', no_show: 'לא הגיעה' };
const PAYER = { guest: 'האורח', company: 'חברה', booker: 'המזמין' };
const CANCEL_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'sales_manager'];
const FRONT_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist'];
const MODIFY_ROLES = [...FRONT_ROLES, 'sales_manager', 'revenue_manager'];
const PRICE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'revenue_manager'];
const PRE_ARRIVAL = ['confirmed', 'modified', 'pending_payment', 'hold'];
const IN_HOUSE = ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'];
// G6: who may walk a stay back (the server enforces the same).
const SHIFT_MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const POST_STAY_ROLES = [...SHIFT_MANAGER_ROLES, 'finance_manager'];
const REVERSAL_LABELS = { reinstate_cancelled: 'שחזור הזמנה שבוטלה', reinstate_no_show: 'שחזור "לא הגיע"', reverse_check_in: 'ביטול כניסה' };

export default function ReservationPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const { toasts, success } = useToast();
  const [mailTo, setMailTo] = useState('');
  const [dialog, setDialog] = useState(null);
  const act = useAction();
  const { data: r, loading, error, reload } = useLoader(async () => (propertyId ? booking.get(propertyId, id) : null), [propertyId, id]);
  const types = useLoader(async () => (propertyId && dialog?.kind === 'modify' ? roomTypesApi.list(propertyId) : null), [propertyId, dialog?.kind]);
  const [cancelled, setCancelled] = useState(null);
  const tourist = useLoader(async () => (propertyId && FRONT_ROLES.concat(['finance_manager', 'auditor']).includes(role) ? stayApi.tourist(propertyId, id) : null), [propertyId, id]);

  if (loading && !r) return <Page><div className="ui-empty"><Spinner /> טוען…</div></Page>;
  if (error) return <Page><ErrorBanner error={error} onRetry={reload} /></Page>;
  if (!r) return null;

  const isQuote = !!r.quote && ['quote', 'hold'].includes(r.status);
  const inHouse = IN_HOUSE.includes(r.status);
  const liveUnits = r.units.filter((u) => ['in_house', 'checked_in'].includes(u.status) || (u.status === null && inHouse));
  const canFront = FRONT_ROLES.includes(role);
  const isHold = r.status === 'hold';
  const created = params.get('created') === '1';

  async function openPreview() {
    const html = await act.run(() => booking.quotePreview(propertyId, r.id));
    if (!html) return;
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  }
  async function convert(sig) {
    try {
      await booking.quoteConvert(propertyId, r.id, sig);
      setDialog(null); success('ההזמנה אושרה'); reload();
    } catch (e) {
      if (e.code === 'price_changed') { setDialog({ kind: 'reprice', next: e.details?.[0] }); return; }
      throw e;
    }
  }

  const unitCols = [
    { key: 'i', label: 'יחידה', nowrap: true, render: (u) => `#${u.index}` },
    { key: 'type', label: 'סוג חדר', render: (u) => u.roomType || '—' },
    { key: 'room', label: 'חדר', nowrap: true, render: (u) => (u.room ? <div><div className="ui-room-n">{u.room.number}</div>{u.room.cleanStatus && <div className="ui-sub">{cleanLabel(u.room.cleanStatus)}</div>}</div> : <span className="ui-sub">לא שובץ</span>) },
    { key: 'dates', label: 'תאריכים', nowrap: true, render: (u) => <span className="ui-num">{formatShort(u.arrivalDate)} – {formatShort(u.departureDate)}</span> },
    { key: 'st', label: 'מצב', nowrap: true, render: (u) => (u.status ? UNIT_STATUS[u.status] || u.status : <span className="ui-sub">—</span>) },
    ...(r.price ? [{ key: 'rate', label: 'ללילה', nowrap: true, align: 'left', render: (u) => (u.nightlyRate != null ? <span className="ui-amount">{money(u.nightlyRate, r.price.currency)}</span> : '—') }] : []),
    ...(inHouse && canFront ? [{
      key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (u) => (['in_house', 'checked_in'].includes(u.status) || (u.status === null && inHouse)
        ? <RowMenu label={`פעולות — יחידה ${u.index}`} items={[{ label: 'מעבר חדר', onSelect: () => setDialog({ kind: 'move', unitId: u.id }) }]} />
        : null),
    }] : []),
  ];

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <Toolbar
        start={(
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav('/pms/reservations')}><ArrowRight size={14} /> הזמנות</button>
            <span className="ui-date-label">{r.guest?.name || '—'}{r.guest?.vip && <Crown size={13} className="text-amber-600" aria-label="VIP" />} · <bdi>{r.confirmationNumber}</bdi></span>
            <Pill tone={STATUS_TONE[r.status] || 'muted'}>{RES_STATUS_LABELS[r.status] || r.status}</Pill>
            <Tag>{SOURCE_LABELS[r.source] || r.source}</Tag>
          </>
        )}
        end={(
          <>
            {r.actions.checkIn.ok && <button type="button" className="btn btn-primary btn-sm" onClick={() => nav(`/pms/arrivals?date=${r.arrivalDate}&checkin=${r.id}`)}>כניסה</button>}
            {r.actions.checkOut.ok && <button type="button" className="btn btn-primary btn-sm" onClick={() => nav(`/pms/departures?checkout=${r.id}`)}>יציאה</button>}
            {r.money && <button type="button" className="btn btn-secondary btn-sm" onClick={() => nav(`/pms/folio?reservation=${r.id}`)}>חשבון</button>}
            <RowMenu
              label="פעולות נוספות"
              items={[
                PRE_ARRIVAL.includes(r.status) && { label: 'שינוי הזמנה', hint: 'תאריכים, הרכב, סוג חדר', disabled: !MODIFY_ROLES.includes(role), why: 'אין הרשאה', onSelect: () => setDialog({ kind: 'modify' }) },
                { label: 'כניסה', disabled: !r.actions.checkIn.ok, why: r.actions.checkIn.why, onSelect: () => nav(`/pms/arrivals?date=${r.arrivalDate}&checkin=${r.id}`) },
                inHouse && liveUnits.length === 1 && { label: 'מעבר חדר', disabled: !canFront, why: 'קבלה בלבד', onSelect: () => setDialog({ kind: 'move', unitId: liveUnits[0].id }) },
                inHouse && liveUnits.length > 1 && { label: 'מעבר חדר', disabled: true, why: 'בחרו יחידה בטבלת היחידות' },
                inHouse && { label: 'הארכת שהייה', disabled: !canFront, why: 'קבלה בלבד', onSelect: () => setDialog({ kind: 'extend' }) },
                inHouse && r.departureDate > r.businessDate && { label: 'עזיבה מוקדמת', disabled: !canFront, why: 'קבלה בלבד', onSelect: () => setDialog({ kind: 'early' }) },
                r.confirmation && ['confirmed', 'modified', 'hold', 'pending_payment', 'checked_in', 'in_house'].includes(r.status) && { label: r.confirmation.sent ? 'שליחת אישור שוב' : 'שליחת אישור הזמנה', hint: r.confirmation.sent ? `נשלח ל־${r.confirmation.to || ''}` : 'במייל לאורח', onSelect: () => setDialog({ kind: 'confirm-mail' }) },
                { label: 'סימון "לא הגיע"', disabled: !r.actions.noShow.ok, why: r.actions.noShow.why, onSelect: () => setDialog({ kind: 'noshow' }) },
                r.actions.reverseCheckIn?.ok && { label: 'ביטול כניסה', hint: 'נרשם בטעות / חדר לא נכון', disabled: !SHIFT_MANAGER_ROLES.includes(role), why: 'מנהל משמרת ומעלה', onSelect: () => setDialog({ kind: 'reverse' }) },
                r.actions.postStay?.ok && { label: 'חיוב אחרי יציאה', hint: 'מיני־בר, נזק, חיוב שנשכח', disabled: !POST_STAY_ROLES.includes(role), why: 'מנהל משמרת או כספים', onSelect: () => setDialog({ kind: 'poststay' }) },
                ['cancelled', 'no_show'].includes(r.status) && r.actions.reinstate && {
                  label: r.status === 'no_show' ? 'שחזור "לא הגיע"' : 'שחזור ההזמנה', hint: 'בודק מלאי לכל לילה',
                  disabled: !r.actions.reinstate.ok || (r.actions.reinstate.managerOnly ? !SHIFT_MANAGER_ROLES.includes(role) : !CANCEL_ROLES.includes(role)),
                  why: !r.actions.reinstate.ok ? r.actions.reinstate.why : r.actions.reinstate.managerOnly ? 'מנהל משמרת ומעלה' : 'אין הרשאה',
                  onSelect: () => setDialog({ kind: 'reinstate' }),
                },
                { separator: true },
                !isQuote && { label: 'ביטול הזמנה', hint: 'קליטת הודעה ובדיקת זכאות', danger: true, disabled: !r.actions.cancel.ok || !CANCEL_ROLES.includes(role), why: !CANCEL_ROLES.includes(role) ? 'אין הרשאה' : r.actions.cancel.why, onSelect: () => setDialog({ kind: 'cancel' }) },
              ]}
            />
          </>
        )}
      />
      {created && (
        <Banner tone="ok">
          <div className="ui-row" style={{ justifyContent: 'space-between', width: '100%' }}>
            <span>{r.status === 'quote' ? 'הצעת המחיר נשמרה' : r.status === 'draft' ? 'הטיוטה נשמרה' : r.status === 'hold' && !r.quote ? 'ההזמנה מוחזקת' : 'ההזמנה נוצרה'} — מספר <bdi>{r.confirmationNumber}</bdi>.</span>
            <span className="ui-row">
              {r.money && ['confirmed', 'hold'].includes(r.status) && r.terms.deposit && <button type="button" className="btn btn-secondary btn-sm" onClick={() => nav(`/pms/folio?reservation=${r.id}`)}>גביית מקדמה</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>סגירה</button>
            </span>
          </div>
        </Banner>
      )}
      {cancelled && (
        <Banner tone="info">
          <div className="ui-stack" style={{ gap: 6, width: '100%' }}>
            <strong>הביטול נרשם והמלאי שוחרר. הכסף והמסמכים — בנפרד:</strong>
            <span>דמי ביטול מוצעים: {cancelled.proposal.proposedFee === null ? 'לבירור' : money(cancelled.proposal.proposedFee)} · שולם: {money(cancelled.proposal.paid)} · החזר מוצע: {cancelled.proposal.proposedRefund === null ? 'לבירור' : money(cancelled.proposal.proposedRefund)}</span>
            <span className="ui-sub">{cancelled.proposal.gate}</span>
            <div className="ui-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => nav(`/pms/folio?reservation=${r.id}`)}>לחשבון (דמי ביטול / החזר / זיכוי)</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancelled(null)}>סגירה</button>
            </div>
          </div>
        </Banner>
      )}
      {params.get('assignWarn') && <Banner tone="warn">{params.get('assignWarn')} מהחדרים שנבחרו נתפסו בינתיים — ההזמנות נשמרו בלי שיבוץ. יש לשבץ מחדש.</Banner>}
      {r.party && r.party.size > 1 && (
        <Card title={`הזמנה מרובת חדרים · ${r.party.code} · ${r.party.members.length} חדרים`}>
          <ul className="ui-staff">
            {r.party.members.map((m) => (
              <li key={m.id}>
                <div>
                  <div className="font-medium">חדר {m.index} · {m.roomType || '—'}{m.room ? ` · חדר ${m.room}` : ''}{m.id === r.id ? ' · ההזמנה הזו' : ''}</div>
                  <div className="ui-sub"><bdi>{m.confirmationNumber}</bdi> · {RES_STATUS_LABELS[m.status] || m.status} · {m.adults} מבוגרים{m.children ? ` · ${m.children} ילדים` : ''}{m.total != null ? ` · ${money(m.total)}` : ''}</div>
                </div>
                {m.id !== r.id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav(`/pms/reservations/${m.id}`)}>פתיחה</button>}
              </li>
            ))}
          </ul>
          <div className="ui-sub">כל חדר מנוהל בנפרד: כניסה, יציאה, חשבון וביטול.</div>
        </Card>
      )}
      {r.guest?.blacklisted && <Banner tone="error">האורח ברשימה השחורה — כל פעולה דורשת אישור מנהל.</Banner>}
      {(r.reversals || []).length > 0 && (
        <Banner tone="info">
          {r.reversals.map((x, i) => <div key={i}>{REVERSAL_LABELS[x.kind] || x.kind} · {x.by} · {formatDateTime(x.at)}{x.reason ? ` · ${x.reason}` : ''}</div>)}
        </Banner>
      )}
      {isQuote && (
        <Card title={`הצעת מחיר · גרסה ${r.quote.version}`} actions={<Tag tone={r.quote.expired ? 'bad' : r.quote.sentAt ? undefined : 'warn'}>{r.quote.expired ? 'פג תוקף' : r.quote.sentAt ? `נשלחה ${formatDateTime(r.quote.sentAt)}` : 'טרם נשלחה'}</Tag>}>
          <KeyValues rows={[
            ['תוקף', formatDateTime(r.quote.validUntil)],
            ['ערוץ מסירה', QUOTE_CHANNEL_LABELS[r.quote.channel] || r.quote.channel],
            ['שפה', r.quote.language === 'en' ? 'English' : 'עברית'],
            ['מלאי', isHold ? `מוחזק עד ${formatDateTime(r.holdExpiresAt)}` : 'לא מוחזק — ייבדק בהמרה'],
          ]} />
          <ErrorBanner error={act.error} />
          <div className="ui-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={openPreview} disabled={act.busy}><Printer size={14} /> תצוגה והדפסה</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={r.quote.expired} onClick={() => setDialog({ kind: 'sent' })}>סימון כנשלחה</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={r.quote.expired} title={r.quote.expired ? 'תוקף ההצעה עבר' : undefined} onClick={() => setDialog({ kind: 'convert' })}>המרה להזמנה</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'close' })}>סגירת הצעה</button>
          </div>
          <div className="ui-sub">ההצעה אינה הזמנה ואינה מסמך מס. שליחה בפועל נעשית מחוץ למערכת (הדפסה/דוא״ל) — כאן מתעדים שנשלחה.</div>
        </Card>
      )}
      {isHold && !r.quote && (
        <Banner tone="warn">
          <div className="ui-row" style={{ justifyContent: 'space-between', width: '100%' }}>
            <span>ההזמנה מוחזקת עד {formatDateTime(r.holdExpiresAt)}. אם לא תאושר עד אז — המלאי ישתחרר אוטומטית.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'convert' })}>אישור ההזמנה</button>
          </div>
        </Banner>
      )}
      {r.quote?.lostReason && <Banner tone="info">ההצעה נסגרה: {r.quote.lostReason}</Banner>}

      <div className="ui-split">
        <div className="ui-stack">
          <Card title={`${formatLong(r.arrivalDate)} – ${formatShort(r.departureDate)} · ${r.nights} לילות`} flush>
            <DataTable caption="יחידות שהייה" columns={unitCols} rows={r.units} rowKey={(u) => u.id || `i${u.index}`} empty={<Empty title="אין יחידות" />} />
          </Card>
          <Card title="אורחים ומשלם">
            <KeyValues rows={[
              ['אורח ראשי', r.guest ? <span key="g">{r.guest.name}{r.guest.phone ? <> · <bdi>{r.guest.phone}</bdi></> : null}{r.guest.email ? <> · <bdi>{r.guest.email}</bdi></> : null}</span> : '—'],
              ['הרכב', `${r.adults} מבוגרים${r.children ? ` · ${r.children} ילדים (גילים ${r.childAges.join(', ') || '—'})` : ''}`],
              r.additionalGuests.length ? ['אורחים נוספים', r.additionalGuests.map((g) => g.name).join(', ')] : null,
              r.booker ? ['מזמין', [r.booker.name, r.booker.phone, r.booker.email].filter(Boolean).join(' · ')] : null,
              ['משלם', `${PAYER[r.payerType] || r.payerType}${r.company ? ` · ${r.company.name}` : ''}`],
              r.externalId || r.channelReservationId ? ['אסמכתת ערוץ', r.externalId || r.channelReservationId] : null,
            ]} />
          </Card>
          {(r.specialRequests || r.requests.length > 0 || r.internalNotes) && (
            <Card title="בקשות והערות">
              {r.specialRequests && <div><div className="ui-section-title">בקשות האורח</div><div>{r.specialRequests}</div></div>}
              {r.requests.length > 0 && (
                <ul className="ui-staff">{r.requests.map((q) => <li key={q.id}><span>{q.description}</span><Tag tone={q.priority === 'urgent' ? 'bad' : undefined}>{q.status}</Tag></li>)}</ul>
              )}
              {r.internalNotes && <div><div className="ui-section-title">הערה פנימית</div><div className="ui-sub">{r.internalNotes}</div></div>}
            </Card>
          )}
        </div>
        <div className="ui-stack">
          {r.price && (
            <Card title="מחיר שהוסכם">
              <KeyValues rows={[
                ['תעריף', r.ratePlan ? `${r.ratePlan.name} (${r.ratePlan.code})` : '—'],
                ...(r.price.snapshot?.nightly || []).slice(0, 10).map((n) => [formatShort(n.date), money(n.price, r.price.currency)]),
                (r.price.snapshot?.nightly?.length || 0) > 10 ? ['…', `${r.price.snapshot.nightly.length} לילות`] : null,
                ['סה״כ (כולל מע״מ)', money(r.price.total, r.price.currency)],
              ]} />
              {r.price.snapshot?.override?.reason && <div className="ui-sub">מחיר ידני: {r.price.snapshot.override.reason} · {r.price.snapshot.override.by}</div>}
              {!r.price.snapshot && <div className="ui-sub">הזמנה ישנה — לא נשמר פירוט מחיר ללילה.</div>}
            </Card>
          )}
          {tourist.data && (
            <Card title="תושבות ומעמד מס" actions={canFront && !['cancelled', 'no_show'].includes(r.status) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'tourist' })}>{tourist.data.recorded ? 'עדכון' : 'רישום'}</button> : null}>
              {tourist.data.recorded
                ? <div className="ui-stack" style={{ gap: 4 }}><Pill tone={DECISION_TONE[tourist.data.decision]}>{tourist.data.decisionLabel}</Pill>{tourist.data.evidence.nonResident && <div className="ui-sub">דרכון {tourist.data.evidence.passportCountry} · אשרה {tourist.data.evidence.visaType} · כניסה {tourist.data.evidence.entryDate}</div>}</div>
                : <div className="ui-sub">לא נרשם. לאורח מחו״ל — רישום בכניסה או כאן.</div>}
            </Card>
          )}
          <Card title="תנאים">
            <KeyValues rows={[
              ['ביטול', r.terms.cancellation || 'לא נשמר בהזמנה'],
              ['מקדמה', r.terms.deposit || '—'],
              ['ערבות', GUARANTEE_LABELS[r.terms.guarantee] || r.terms.guarantee],
            ]} />
          </Card>
          {r.money && (
            <Card title="כספים" actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => nav(`/pms/folio?reservation=${r.id}`)}>לחשבון</button>}>
              <KeyValues rows={[
                ['יתרה', <span key="b" className={`ui-amount ${r.money.balance > 0.005 ? 'is-due' : r.money.balance < -0.005 ? 'is-credit' : 'is-zero'}`}>{money(r.money.balance, r.price?.currency)}</span>],
                ['חשבונות', String(r.money.folios)],
                ...r.money.documents.map((d) => [DOC_TYPE_LABELS[d.type] || d.type, `${d.number} · ${money(d.gross, r.price?.currency)}`]),
              ]} />
            </Card>
          )}
          <Card title="היסטוריה">
            {r.history.length === 0 ? <div className="ui-sub">אין רשומות</div> : (
              <ol className="ui-timeline">
                {r.history.map((h, i) => <li key={i}><strong>{h.action}</strong><span className="ui-sub">{h.by} · {formatDateTime(h.at)}{h.reason ? ` · ${h.reason}` : ''}</span></li>)}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog open={dialog?.kind === 'confirm-mail'} onClose={() => setDialog(null)} title="שליחת אישור הזמנה במייל"
        subtitle={r.confirmation?.sent ? `נשלח לאחרונה ל־${r.confirmation.to} · ${formatDateTime(r.confirmation.at)}` : 'האורח יקבל את פרטי ההזמנה והשהייה'} confirmLabel="שליחה"
        onConfirm={async () => { const out = await booking.sendConfirmation(propertyId, r.id, mailTo || undefined); setDialog(null); success(`האישור נשלח ל־${out.to}`); reload(); }}>
        <Field id="cm-to" label="לכתובת" hint={r.confirmation?.guestEmail ? `ריק = ${r.confirmation.guestEmail}` : 'לאורח אין כתובת שמורה'}>
          <input id="cm-to" type="email" dir="ltr" className="input w-full" value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder={r.confirmation?.guestEmail || 'guest@example.com'} />
        </Field>
      </ConfirmDialog>
      <TouristDialog open={dialog?.kind === 'tourist'} onClose={() => setDialog(null)} propertyId={propertyId} reservationId={r.id} onDone={() => { setDialog(null); success('נשמר'); tourist.reload(); }} />
      <ReinstateDialog open={dialog?.kind === 'reinstate'} onClose={() => setDialog(null)} propertyId={propertyId} reservation={r} onDone={(out) => { setDialog(null); success(out.roomReleased ? 'ההזמנה שוחזרה · החדר ששובץ נתפס — יש לשבץ מחדש' : 'ההזמנה שוחזרה'); reload(); }} />
      <ReverseCheckInDialog open={dialog?.kind === 'reverse'} onClose={() => setDialog(null)} propertyId={propertyId} reservation={r} onDone={() => { setDialog(null); success('הכניסה בוטלה — ההזמנה מאושרת וממתינה לכניסה'); reload(); }} />
      <PostStayChargeDialog open={dialog?.kind === 'poststay'} onClose={() => setDialog(null)} propertyId={propertyId} reservation={r} onDone={(out) => { setDialog(null); success('החיוב נרשם בחשבון "אחרי יציאה"'); nav(`/pms/folio?reservation=${r.id}&folio=${out.folioId}`); }} />
      <CancelBookingDialog open={dialog?.kind === 'cancel'} onClose={() => setDialog(null)} propertyId={propertyId} reservation={r} onDone={(out) => { setDialog(null); setCancelled(out); success('הביטול נרשם'); reload(); }} />
      <ModifyBookingDialog open={dialog?.kind === 'modify'} onClose={() => setDialog(null)} propertyId={propertyId} reservation={r} roomTypes={(types.data || []).map((t) => ({ id: t._id, name: t.name }))} onDone={(out) => { setDialog(null); success(out.unassignedRooms ? `ההזמנה עודכנה · ${out.unassignedRooms} חדרים שוחררו משיבוץ` : 'ההזמנה עודכנה'); reload(); }} />
      <MoveRoomDialog open={dialog?.kind === 'move'} onClose={() => setDialog(null)} propertyId={propertyId} reservationId={r.id} unitId={dialog?.unitId} canChangePrice={PRICE_ROLES.includes(role)} onDone={(out) => { setDialog(null); success(`עבר מחדר ${out.from || '—'} לחדר ${out.to}${out.ticket ? (out.ticket.linked ? ' · נרשם בתקלה הפתוחה' : ' · נפתחה תקלה בתחזוקה') + (out.ticket.blocked ? ' והחדר נחסם' : '') : ''}${out.key ? ' · יש להנפיק מפתח' : ''}`); reload(); }} />
      <ExtendDialog open={dialog?.kind === 'extend'} onClose={() => setDialog(null)} propertyId={propertyId} reservationId={r.id} departureDate={r.departureDate} canManualPrice={PRICE_ROLES.includes(role)} onMoveInstead={liveUnits.length === 1 ? () => setDialog({ kind: 'move', unitId: liveUnits[0].id }) : undefined} onDone={(out) => { setDialog(null); success(`השהייה הוארכה עד ${formatShort(out.departureDate)}`); reload(); }} />
      <EarlyDepartureDialog open={dialog?.kind === 'early'} onClose={() => setDialog(null)} propertyId={propertyId} reservationId={r.id} onContinue={(reasonLabel) => nav(`/pms/departures?checkout=${r.id}&early=${encodeURIComponent(reasonLabel)}`)} />
      <ConfirmDialog open={dialog?.kind === 'noshow'} onClose={() => setDialog(null)} title='סימון "לא הגיע"' subtitle={r.confirmationNumber} confirmLabel="סימון" danger onConfirm={async () => { await frontdesk.noShow(propertyId, r.id); setDialog(null); success('סומן "לא הגיע"'); reload(); }}>
        <p className="ui-p">המלאי ישתחרר. דמי אי־הגעה — לפי המדיניות, כחיוב נפרד בחשבון.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog?.kind === 'close'} onClose={() => setDialog(null)} title="סגירת הצעה" confirmLabel="סגירה" requireReason reasonLabel="סיבת אובדן" onConfirm={async (reason) => { await booking.quoteClose(propertyId, r.id, reason); setDialog(null); success('ההצעה נסגרה'); reload(); }}>
        <p className="ui-p">ההצעה נשארת לתיעוד; מלאי שהוחזק ישתחרר.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog?.kind === 'convert'} onClose={() => setDialog(null)} title={r.quote ? 'המרת הצעה להזמנה' : 'אישור הזמנה מוחזקת'} subtitle={r.price ? money(r.price.total, r.price.currency) : ''} confirmLabel="אישור" onConfirm={() => convert()}>
        <p className="ui-p">המחיר והזמינות ייבדקו מחדש עכשיו. אם המחיר השתנה — תתבקשו לאשר אותו.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog?.kind === 'reprice'} onClose={() => setDialog(null)} title="המחיר השתנה" subtitle={dialog?.next ? `${money(r.price?.total, r.price?.currency)} ← ${money(dialog.next.total, r.price?.currency)}` : ''} confirmLabel="אישור המחיר החדש" onConfirm={() => convert(dialog.next.priceSignature)}>
        <p className="ui-p">ההזמנה תאושר במחיר החדש. ללקוח שקיבל את ההצעה הקודמת — כדאי לעדכן לפני האישור.</p>
      </ConfirmDialog>
      <SentDialog open={dialog?.kind === 'sent'} onClose={() => setDialog(null)} initial={r.quote?.channel} onSave={async (channel) => { await booking.quoteSent(propertyId, r.id, channel); setDialog(null); success('נרשם שההצעה נשלחה'); reload(); }} />
    </Page>
  );
}

function SentDialog({ open, onClose, initial, onSave }) {
  const [channel, setChannel] = useState(initial || 'email');
  const action = useAction();
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={action.busy}
      width={420}
      title="סימון הצעה כנשלחה"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
          <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => action.run(() => onSave(channel))}>{action.busy ? <Spinner /> : 'שמירה'}</button>
        </>
      )}
    >
      <ErrorBanner error={action.error} />
      <fieldset className="ui-fieldset" style={{ marginTop: 0 }}>
        <legend className="ui-label">איך נשלחה</legend>
        {Object.entries(QUOTE_CHANNEL_LABELS).map(([v, l]) => <label key={v} className="ui-radio"><input type="radio" name="ch" checked={channel === v} onChange={() => setChannel(v)} /><span>{l}</span></label>)}
      </fieldset>
    </Modal>
  );
}
