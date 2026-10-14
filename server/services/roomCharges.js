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
  if (!folio) folio = await Folio.findOne({ reservation: reservation._id, status: { $ne: 'closed' } });
  if (!folio && create) {
    folio = await Folio.create({
      property: reservation.property, reservation: reservation._id, ownerType: 'guest',
      currency: reservation.currency || 'ILS', lines: [],
    });
  }
  return folio;
}

// Nights not yet posted for the reservation's in-house (or given) units, up to `until`
// (exclusive). Pure read — nothing is written.
export async function planNights({ reservation, until, unitFilter, includeStatuses = ['in_house', 'checked_in'] }) {
  const units = await ReservationRoom.find({ reservation: reservation._id }).populate('assignedRoom', 'number').sort({ createdAt: 1, _id: 1 }).lean();
  const vatRate = (await Property.findById(reservation.property).select('vatRate').lean())?.vatRate;
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
    const flat = Number(u?.nightlyRate || reservation.ratePerNight || 0);
    for (const date of nightsOf(from, to)) {
      // The price frozen at booking/extension for that night (per room), else the unit's rate.
      const gross = agreed.has(date) ? agreed.get(date) : flat;
      const { net, tax } = splitGross(gross, vatRate);
      const reference = `night:${unitKey}:${date}`;
      if (posted.has(reference)) continue;
      if ((legacyByDate.get(date) || 0) > 0) { legacyByDate.set(date, legacyByDate.get(date) - 1); continue; }
      items.push({
        reference, date, net, tax, gross: round2(net + tax),
        description: `לינה ${date}${u?.assignedRoom?.number ? ` · חדר ${u.assignedRoom.number}` : ''}`,
      });
    }
  }
  return { items, count: items.length, gross: round2(items.reduce((s, i) => s + i.gross, 0)) };
}

export async function postPlannedNights({ reservation, items, source = 'night_audit', actorId }) {
  if (!items.length) return 0;
  const folio = await lodgingFolio(reservation);
  const existing = new Set(folio.lines.map((l) => l.reference).filter(Boolean));
  let added = 0;
  for (const it of items) {
    if (existing.has(it.reference)) continue;
    folio.lines.push({
      type: 'charge', description: it.description, amount: it.net, taxAmount: it.tax, department: 'rooms',
      serviceDate: it.date, source, status: 'posted', reference: it.reference, createdBy: actorId || undefined,
    });
    added += 1;
  }
  if (added) await folio.save();
  return added;
}

export async function postNightsUntil({ reservation, until, source, actorId, unitFilter, includeStatuses }) {
  const plan = await planNights({ reservation, until, unitFilter, includeStatuses });
  return postPlannedNights({ reservation, items: plan.items, source, actorId });
}
