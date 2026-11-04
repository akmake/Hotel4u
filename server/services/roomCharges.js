// Room-night posting — the single charging model for lodging (spec W09, T22).
//
// One charge per stay unit per night, posted by day close (night audit) for the night that just
// ended, and by checkout for any nights still missing. Every posting carries a deterministic
// reference (`night:<unit>:<date>`), so running day close twice, or day close followed by
// checkout, never charges a night twice.
//
// Rates are the price the guest was quoted (gross). VAT is extracted, not added on top:
// 118 at 18% → net 100 + VAT 18.
import { routesRoom, ROOM_CODES } from './voucherService.js';
import Folio from '../models/Folio.js';
import Property from '../models/Property.js';
import ReservationRoom from '../models/ReservationRoom.js';
import Reservation from '../models/Reservation.js';
import { withLocks } from './locks.js';
import { runStayTransaction } from './stayTransaction.js';
import { vatForLine } from './touristService.js';

const BOARD_LABEL = { breakfast: 'ארוחת בוקר', half_board: 'חצי פנסיון', full_board: 'פנסיון מלא' };

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function nightsOf(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function splitGross(gross, vatRatePct) {
  const rate = Number(vatRatePct ?? 18) / 100;
  const g = round2(gross);
  const net = round2(g / (1 + rate));
  return { net, tax: round2(g - net) };
}

// The guest folio the lodging goes to (routing to a company happens through FIN-05 rules).
// The billing window of a Share guest (created with the share; re-created if missing).
export async function shareFolio(reservation, shareId, { session = null } = {}) {
  let folio = await Folio.findOne({ reservation: reservation._id, ownerRef: `share:${shareId}` }).session(session);
  if (!folio) {
    const s = (reservation.shares || []).find((x) => String(x._id) === String(shareId));
    [folio] = await Folio.create([{ property: reservation.property, reservation: reservation._id, ownerType: 'guest', ownerRef: `share:${shareId}`, account: { name: s?.name || 'Share' }, currency: reservation.currency || 'ILS', lines: [] }], { session });
  }
  return folio;
}

export async function lodgingFolio(reservation, { create = true, session = null } = {}) {
  // Lodging never lands on an extra window the desk opened (ownerRef extra:N) or the post-stay window.
  const mainWindow = { ownerRef: { $not: /^(extra:|post_stay|share:)/ } };
  let folio = await Folio.findOne({ reservation: reservation._id, ownerType: 'guest', status: { $ne: 'closed' }, ...mainWindow }).sort({ createdAt: 1 }).session(session);
  if (!folio) folio = await Folio.findOne({ reservation: reservation._id, ownerType: { $nin: ['room', 'company'] }, status: { $ne: 'closed' }, ...mainWindow }).sort({ createdAt: 1 }).session(session);
  if (!folio && create) {
    [folio] = await Folio.create([{
      property: reservation.property, reservation: reservation._id, ownerType: 'guest',
      currency: reservation.currency || 'ILS', lines: [],
    }], { session });
  }
  return folio;
}

// The own account of one room of a group (a room whose guest pays for themselves).
export async function unitFolio(reservation, unitId, { create = true, session = null } = {}) {
  const ref = String(unitId);
  let folio = await Folio.findOne({ reservation: reservation._id, ownerType: 'room', ownerRef: ref, status: { $ne: 'closed' } }).session(session);
  if (!folio && create) {
    [folio] = await Folio.create([{
      property: reservation.property, reservation: reservation._id, ownerType: 'room', ownerRef: ref,
      currency: reservation.currency || 'ILS', lines: [],
    }], { session });
  }
  return folio;
}

// Nights not yet posted for the reservation's in-house (or given) units, up to `until`
// (exclusive). Pure read — nothing is written.
export async function planNights({ reservation, until, unitFilter, includeStatuses = ['in_house', 'checked_in'], session = null }) {
  const units = await ReservationRoom.find({ reservation: reservation._id }).session(session).populate('assignedRoom', 'number').sort({ createdAt: 1, _id: 1 }).lean();
  const propertyVat = (await Property.findById(reservation.property).session(session).select('vatRate').lean())?.vatRate;
  // Lodging of an eligible tourist under the property's approved rule is zero-rated (EXT-04).
  const vat = await vatForLine({ reservation, code: 'rooms', propertyVatRate: propertyVat ?? 18, session });
  const vatRate = vat.rate;
  const boardVat = await vatForLine({ reservation, code: 'board', propertyVatRate: propertyVat ?? 18, session });
  const boardByDate = reservation.priceSnapshot?.board?.source === 'supplement' ? new Map((reservation.priceSnapshot.board.nightly || []).map((n) => [n.date, Number(n.price)])) : new Map();
  const split = (gross, v) => (v.rate === 0 ? { net: v.strip ? splitGross(gross, propertyVat ?? 18).net : round2(gross), tax: 0 } : splitGross(gross, v.rate));
  const all = await Folio.find({ reservation: reservation._id }).session(session).select('lines ownerType ownerRef').lean();
  // Voucher: nights/board of the booker's account go to the payer's window; "deposit" only up to its amount.
  const v = reservation.voucher;
  const toPayer = routesRoom(v);
  let payerLeft = v?.type === 'deposit' ? round2(Number(v.amount || 0) - all.filter((f) => f.ownerType === 'company' && String(f.ownerRef) === String(v.payerRef))
    .flatMap((f) => f.lines).filter((l) => l.status === 'posted' && l.type === 'charge' && ROOM_CODES.includes(l.department)).reduce((s, l) => s + Number(l.amount || 0) + Number(l.taxAmount || 0), 0)) : Infinity;
  const routed = (it) => {
    if (!toPayer || it.toUnit) return [it];
    if (payerLeft >= it.gross - 0.005) { payerLeft = round2(payerLeft - it.gross); return [{ ...it, toPayer: true, payerId: String(v.payerRef) }]; }
    if (payerLeft <= 0.005) return [it];
    // The night that crosses the deposit amount is split: the payer's part and the guest's rest.
    const share = payerLeft / it.gross; payerLeft = 0;
    const pNet = round2(it.net * share); const pTax = round2(it.tax * share);
    return [
      { ...it, net: pNet, tax: pTax, gross: round2(pNet + pTax), toPayer: true, payerId: String(v.payerRef), description: `${it.description} · חלק הסוכן` },
      { ...it, reference: `${it.reference}:rest`, net: round2(it.net - pNet), tax: round2(it.tax - pTax), gross: round2(it.net - pNet + it.tax - pTax), description: `${it.description} · יתרה לאורח` },
    ];
  };
  // Shares (gap-map item 5): a guest sharing the room pays part of each lodging night on their own
  // window — half (equal parts with the others on "half") or a full night on top ("full").
  const activeShares = (reservation.shares || []).filter((s) => s.status === 'active' && s.split !== 'none');
  const shareSplit = (list) => list.flatMap((it) => {
    if (!activeShares.length || it.code !== 'rooms' || it.toPayer || it.toUnit) return [it];
    const parts = activeShares.filter((s) => s.split === 'half').length + 1;
    let main = { ...it };
    const out = [];
    for (const s of activeShares) {
      const ratio = s.split === 'half' ? 1 / parts : 1;
      // Split on the gross so the parts add up to the night exactly; VAT follows pro rata.
      const g = round2(it.gross * ratio); const tax = round2(it.tax * ratio);
      out.push({ ...it, toShare: true, shareId: String(s._id), net: round2(g - tax), tax, gross: g, reference: `${it.reference}:share:${s._id}`, description: `${it.description} · ${s.name}` });
      if (s.split === 'half') main = { ...main, gross: round2(main.gross - g), tax: round2(main.tax - tax) };
    }
    main.net = round2(main.gross - main.tax);
    return [main, ...out];
  });
  const live = all.flatMap((f) => f.lines.filter((l) => l.status !== 'voided'));
  const posted = new Set(live.filter((l) => l.reference).map((l) => l.reference));
  // Lodging posted before this model (no night reference) still covers its night: count those
  // per service date and let each cover one unit-night, so old stays are not charged twice.
  const legacyByDate = new Map();
  for (const l of live) {
    if (l.type !== 'charge' || !['rooms', 'room'].includes(l.department)) continue;
    if (String(l.reference || '').startsWith('night:')) continue;
    legacyByDate.set(l.serviceDate, (legacyByDate.get(l.serviceDate) || 0) + 1);
  }
  const items = [];
  const agreed = new Map((reservation.priceSnapshot?.nightly || []).filter((n) => n?.date && n.price != null && Number.isFinite(Number(n.price)) && Number(n.price) >= 0).map((n) => [n.date, Number(n.price)]));
  const list = units.length ? units : [null];
  for (const u of list) {
    if (u && unitFilter && !unitFilter(u)) continue;
    if (u && !includeStatuses.includes(u.status)) continue;
    const from = u?.arrivalDate || reservation.arrivalDate;
    const to = [u?.departureDate || reservation.departureDate, until].sort()[0];
    const unitKey = u ? String(u._id) : `res-${reservation._id}`;
    // A room whose guest pays for the room posts its nights to the room's own account.
    const route = u?.roomPayer === 'guest' ? { unitId: String(u._id), toUnit: true } : { unitId: u ? String(u._id) : null, toUnit: false };
    const flat =Number(u?.nightlyRate || reservation.ratePerNight || 0);
    for (const date of nightsOf(from, to)) {
      // The price frozen at booking/extension for that night (per room), else the unit's rate.
      const gross = agreed.has(date) ? agreed.get(date) : flat;
      const { net, tax } = split(gross, vat);
      const reference = `night:${unitKey}:${date}`;
      const legacyCovered = !posted.has(reference) && (legacyByDate.get(date) || 0) > 0;
      if (legacyCovered) legacyByDate.set(date, legacyByDate.get(date) - 1);
      if (!posted.has(reference) && !legacyCovered) items.push(...shareSplit(routed({
        ...route,
        reference, date, net, tax, gross: round2(net + tax), vatRate, taxReason: vat.reason || undefined, code: 'rooms',
        description: `לינה ${date}${u?.assignedRoom?.number ? ` · חדר ${u.assignedRoom.number}` : ''}`,
      })));
      // G2: the board of that night, posted on its own line (F&B revenue, own VAT decision).
      const boardGross = boardByDate.get(date);
      const boardRef = `board:${unitKey}:${date}`;
      if (boardGross > 0 && !posted.has(boardRef)) {
        const b = split(boardGross, boardVat);
        items.push(...routed({ ...route, reference: boardRef, date, net: b.net, tax: b.tax, gross: round2(b.net + b.tax), vatRate: boardVat.rate, taxReason: boardVat.reason || undefined, code: 'board', description: `אירוח (${BOARD_LABEL[reservation.priceSnapshot.board.type] || 'ארוחות'}) ${date}` }));
      }
    }
  }
  return { items, count: items.filter((i) => i.code === 'rooms' && !i.toShare).length, gross: round2(items.reduce((s, i) => s + i.gross, 0)) };
}

// Which account an unposted night lands on: the room's own account when its guest pays the room,
// else the reservation's lodging account.
export function pendingGrossFor(folio, items, lodgingId) {
  if (!folio) return 0;
  if (String(folio.ownerRef || '').startsWith('share:')) return round2(items.filter((i) => i.toShare && `share:${i.shareId}` === String(folio.ownerRef)).reduce((s, i) => s + i.gross, 0));
  const mine = folio.ownerType === 'room'
    ? items.filter((i) => i.toUnit && String(i.unitId) === String(folio.ownerRef))
    : folio.ownerType === 'company' && items.some((i) => i.toPayer && String(i.payerId) === String(folio.ownerRef)) ? items.filter((i) => i.toPayer && String(i.payerId) === String(folio.ownerRef))
      : String(folio._id) === String(lodgingId) ? items.filter((i) => !i.toUnit && !i.toPayer && !i.toShare) : [];
  return round2(mine.reduce((s, i) => s + i.gross, 0));
}

export async function postPlannedNights({ reservation, items, source = 'night_audit', actorId, session = null }) {
  if (!items.length) return 0;
  const groups = new Map();
  for (const it of items) {
    const key = it.toShare ? `share:${it.shareId}` : it.toUnit ? `unit:${it.unitId}` : it.toPayer ? `payer:${it.payerId}` : 'lodging';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  let added = 0;
  for (const [key, list] of groups) {
    const folio = key === 'lodging' ? await lodgingFolio(reservation, { session })
      : key.startsWith('share:') ? await shareFolio(reservation, key.slice(6), { session })
      : key.startsWith('payer:') ? await (await import('./voucherService.js')).payerFolio(reservation, key.slice(6), { session })
        : await unitFolio(reservation, key.slice(5), { session });
    const existing = new Set(folio.lines.map((l) => l.reference).filter(Boolean));
    let here = 0;
    for (const it of list) {
      if (existing.has(it.reference)) continue;
      folio.lines.push({
        type: 'charge', description: it.description, amount: it.net, taxAmount: it.tax, department: it.code || 'rooms', vatRate: it.vatRate, taxReason: it.taxReason,
        serviceDate: it.date, source, status: 'posted', reference: it.reference, createdBy: actorId || undefined,
      });
      here += 1;
    }
    if (here) await folio.save({ session });
    added += here;
  }
  return added;
}

export async function postNightsUntil({ reservation, until, source, actorId, unitFilter, includeStatuses, session = null, guardLease = null, accountingDate = null }) {
  if (!session) return withLocks([`res:${reservation._id}`], (lease) => runStayTransaction(async (session) => {
    const current = await Reservation.findById(reservation._id).session(session);
    if (!current) throw Object.assign(new Error('Reservation not found'), { status: 404 });
    session.financialDayCloseLease = guardLease;
    session.financialPostingDate = accountingDate;
    const posted = await postNightsUntil({ reservation: current, until, source, actorId, unitFilter, includeStatuses, session, accountingDate });
    if (guardLease) await guardLease.assertOwned(session);
    return posted;
  }, lease, { operation: 'רישום לילות' }), { waitMs: 4000 });
  const plan = await planNights({ reservation, until, unitFilter, includeStatuses, session });
  return postPlannedNights({ reservation, items: plan.items, source, actorId, session });
}
