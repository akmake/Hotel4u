// Room-night posting — the single charging model for lodging (spec W09, T22).
//
// One charge per stay unit per night, posted by day close (night audit) for the night that just
// ended, and by checkout for any nights still missing. Every posting carries a deterministic
// reference (`night:<unit>:<date>`), so running day close twice, or day close followed by
// checkout, never charges a night twice.
//
// Rates are the price the guest was quoted (gross). VAT is extracted, not added on top:
// 118 at 18% → net 100 + VAT 18.
import Folio from '../models/Folio.js';
import Property from '../models/Property.js';
import ReservationRoom from '../models/ReservationRoom.js';
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
export async function lodgingFolio(reservation, { create = true } = {}) {
  let folio = await Folio.findOne({ reservation: reservation._id, ownerType: 'guest', status: { $ne: 'closed' } });
  if (!folio) folio = await Folio.findOne({ reservation: reservation._id, ownerType: { $ne: 'room' }, status: { $ne: 'closed' } });
  if (!folio && create) {
    folio = await Folio.create({
      property: reservation.property, reservation: reservation._id, ownerType: 'guest',
      currency: reservation.currency || 'ILS', lines: [],
    });
  }
  return folio;
}

// The own account of one room of a group (a room whose guest pays for themselves).
export async function unitFolio(reservation, unitId, { create = true } = {}) {
  const ref = String(unitId);
  let folio = await Folio.findOne({ reservation: reservation._id, ownerType: 'room', ownerRef: ref, status: { $ne: 'closed' } });
  if (!folio && create) {
    folio = await Folio.create({
      property: reservation.property, reservation: reservation._id, ownerType: 'room', ownerRef: ref,
      currency: reservation.currency || 'ILS', lines: [],
    });
  }
  return folio;
}

// Nights not yet posted for the reservation's in-house (or given) units, up to `until`
// (exclusive). Pure read — nothing is written.
export async function planNights({ reservation, until, unitFilter, includeStatuses = ['in_house', 'checked_in'] }) {
  const units = await ReservationRoom.find({ reservation: reservation._id }).populate('assignedRoom', 'number').sort({ createdAt: 1, _id: 1 }).lean();
  const propertyVat = (await Property.findById(reservation.property).select('vatRate').lean())?.vatRate;
  // Lodging of an eligible tourist under the property's approved rule is zero-rated (EXT-04).
  const vat = await vatForLine({ reservation, code: 'rooms', propertyVatRate: propertyVat ?? 18 });
  const vatRate = vat.rate;
  const boardVat = await vatForLine({ reservation, code: 'board', propertyVatRate: propertyVat ?? 18 });
  const boardByDate = reservation.priceSnapshot?.board?.source === 'supplement' ? new Map((reservation.priceSnapshot.board.nightly || []).map((n) => [n.date, Number(n.price)])) : new Map();
  const split = (gross, v) => (v.rate === 0 ? { net: v.strip ? splitGross(gross, propertyVat ?? 18).net : round2(gross), tax: 0 } : splitGross(gross, v.rate));
  const all = await Folio.find({ reservation: reservation._id }).select('lines').lean();
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
  const agreed = new Map((reservation.priceSnapshot?.nightly || []).filter((n) => n?.date && Number(n.price) > 0).map((n) => [n.date, Number(n.price)]));
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
      if (posted.has(reference)) continue;
      if ((legacyByDate.get(date) || 0) > 0) { legacyByDate.set(date, legacyByDate.get(date) - 1); continue; }
      items.push({
        ...route,
        reference, date, net, tax, gross: round2(net + tax), vatRate, taxReason: vat.reason || undefined, code: 'rooms',
        description: `לינה ${date}${u?.assignedRoom?.number ? ` · חדר ${u.assignedRoom.number}` : ''}`,
      });
      // G2: the board of that night, posted on its own line (F&B revenue, own VAT decision).
      const boardGross = boardByDate.get(date);
      const boardRef = `board:${unitKey}:${date}`;
      if (boardGross > 0 && !posted.has(boardRef)) {
        const b = split(boardGross, boardVat);
        items.push({ ...route, reference: boardRef, date, net: b.net, tax: b.tax, gross: round2(b.net + b.tax), vatRate: boardVat.rate, taxReason: boardVat.reason || undefined, code: 'board', description: `אירוח (${BOARD_LABEL[reservation.priceSnapshot.board.type] || 'ארוחות'}) ${date}` });
      }
    }
  }
  return { items, count: items.filter((i) => i.code === 'rooms').length, gross: round2(items.reduce((s, i) => s + i.gross, 0)) };
}

// Which account an unposted night lands on: the room's own account when its guest pays the room,
// else the reservation's lodging account.
export function pendingGrossFor(folio, items, lodgingId) {
  if (!folio) return 0;
  const mine = folio.ownerType === 'room'
    ? items.filter((i) => i.toUnit && String(i.unitId) === String(folio.ownerRef))
    : String(folio._id) === String(lodgingId) ? items.filter((i) => !i.toUnit) : [];
  return round2(mine.reduce((s, i) => s + i.gross, 0));
}

export async function postPlannedNights({ reservation, items, source = 'night_audit', actorId }) {
  if (!items.length) return 0;
  const groups = new Map();
  for (const it of items) {
    const key = it.toUnit ? `unit:${it.unitId}` : 'lodging';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  let added = 0;
  for (const [key, list] of groups) {
    const folio = key === 'lodging' ? await lodgingFolio(reservation) : await unitFolio(reservation, key.slice(5));
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
    if (here) await folio.save();
    added += here;
  }
  return added;
}

export async function postNightsUntil({ reservation, until, source, actorId, unitFilter, includeStatuses }) {
  const plan = await planNights({ reservation, until, unitFilter, includeStatuses });
  return postPlannedNights({ reservation, items: plan.items, source, actorId });
}
