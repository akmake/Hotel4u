// One price per room per night — used by booking, quotes, stay changes and the legacy quote route.
//
//   base   = the rate calendar (RateDate) for that night, or — when no row was entered — the room
//            type's base price, so a night is never unsellable just because nobody filled the calendar;
//   then   occupancy prices of the row (2/3/4 adults), the row's weekday adjustment,
//          the plan's pricing rules that match (season / holiday dates, weekdays, guests, LOS, lead
//          time, channel, company…), in priority order;
//   extras child price per night (rule, else row) × children, extra-adult price × adults beyond the
//          room type's regular occupancy.
// Prices include VAT, rounded to the agora.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function matchesRule(rule, ctx) {
  if (rule.active === false) return false;
  if (rule.weekdays?.length && !rule.weekdays.includes(ctx.weekday)) return false;
  if (rule.seasonFrom && ctx.date < rule.seasonFrom) return false;
  if (rule.seasonTo && ctx.date > rule.seasonTo) return false;
  if (rule.minGuests != null && ctx.adults < rule.minGuests) return false;
  if (rule.maxGuests != null && ctx.adults > rule.maxGuests) return false;
  if (rule.minChildren != null && ctx.children < rule.minChildren) return false;
  if (rule.maxChildren != null && ctx.children > rule.maxChildren) return false;
  if (rule.minLos != null && ctx.los < rule.minLos) return false;
  if (rule.maxLos != null && ctx.los > rule.maxLos) return false;
  if (rule.minLeadDays != null && ctx.leadDays < rule.minLeadDays) return false;
  if (rule.maxLeadDays != null && ctx.leadDays > rule.maxLeadDays) return false;
  if (rule.channels?.length && !rule.channels.includes(ctx.channel)) return false;
  if (rule.companies?.length && (!ctx.companyId || !rule.companies.map(String).includes(String(ctx.companyId)))) return false;
  if (rule.agents?.length && (!ctx.agentId || !rule.agents.map(String).includes(String(ctx.agentId)))) return false;
  if (rule.promoCodes?.length && (!ctx.promoCode || !rule.promoCodes.includes(ctx.promoCode))) return false;
  if (rule.loyaltyTiers?.length && (!ctx.loyaltyTier || !rule.loyaltyTiers.includes(ctx.loyaltyTier))) return false;
  return true;
}

export function applyRuleToPrice(basePrice, rule) {
  if (rule.adjustmentType === 'set') return Math.max(0, Number(rule.adjustmentValue) || 0);
  if (rule.adjustmentType === 'fixed') return Math.max(0, basePrice + (Number(rule.adjustmentValue) || 0));
  return Math.max(0, basePrice * (1 + (Number(rule.adjustmentValue) || 0) / 100));
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Returns { price, source: 'calendar'|'base'|null, rules: [names] }; price null = cannot be priced.
// parent = { plan, rd } of plan.derived.from for the same night (derived rates).
export function priceNight({ plan, roomType, rd, date, adults = 2, children = 0, los = 1, today = null, context = {}, parent = null }) {
  const fromRow = rd && Number(rd.price) >= 0 && rd.price !== null && rd.price !== undefined;
  if (!fromRow && plan?.derived?.from && parent?.plan && String(parent.plan._id) !== String(plan._id)) {
    const p = priceNight({ plan: parent.plan, roomType, rd: parent.rd, date, adults, children, los, today, context });
    if (p.price === null) return p;
    return { price: round2(Math.max(0, p.price * (1 + (Number(plan.derived.pct) || 0) / 100))), source: 'derived', rules: p.rules };
  }
  let price = fromRow ? Number(rd.price) : Number(roomType?.baseRate);
  if (!(price > 0) && !fromRow) return { price: null, source: null, rules: [] };
  if (fromRow) {
    const occ = { 2: rd.occupancy2Price, 3: rd.occupancy3Price, 4: rd.occupancy4Price }[Math.min(4, adults)];
    if (adults >= 2 && Number(occ) > 0) price = Number(occ);
    if (Number(rd.weekdayAdjustmentPct)) price *= 1 + Number(rd.weekdayAdjustmentPct) / 100;
  }
  const ctx = { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), adults, children, los, leadDays: today ? daysBetween(today, date) : 0, ...context };
  const rules = [...(plan?.pricingRules || [])].filter((r) => !(fromRow && r.appliesTo === 'base') && matchesRule(r, ctx)).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  let childPrice = fromRow && Number(rd.childPricePerNight) > 0 ? Number(rd.childPricePerNight) : null;
  let extraPrice = fromRow && Number(rd.extraGuestPricePerNight) > 0 ? Number(rd.extraGuestPricePerNight) : null;
  for (const rule of rules) {
    price = applyRuleToPrice(price, rule);
    if (rule.childPricePerNight != null) childPrice = Number(rule.childPricePerNight);
    if (rule.extraGuestPricePerNight != null) extraPrice = Number(rule.extraGuestPricePerNight);
  }
  if (children > 0 && childPrice) price += childPrice * children;
  const regular = Math.max(1, Number(roomType?.capacityBase) || 2);
  const extraAdults = Math.max(0, adults - regular);
  if (extraAdults > 0 && extraPrice) price += extraPrice * extraAdults;
  return { price: round2(Math.max(0, price)), source: fromRow ? 'calendar' : 'base', rules: rules.map((r) => r.name) };
}
