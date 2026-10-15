// G2 — board / meal plan (לינה בלבד, ארוחת בוקר, חצי פנסיון, פנסיון מלא). Two ways to price it,
// side by side, as the owner asked:
//  - by rate: a rate plan that includes a board (flags on the plan) — its calendar price already
//    contains the meals; the board is fixed by the plan;
//  - by board: a room-only plan + a supplement per person per night from the property's table
//    (adult / child; infants free), posted every night as its own line (code 'board', F&B revenue).
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import { RatePlan } from '../models/RatePlan.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';

export const BOARDS = ['room_only', 'breakfast', 'half_board', 'full_board'];
export const BOARD_LABELS = { room_only: 'לינה בלבד', breakfast: 'לינה וארוחת בוקר', half_board: 'חצי פנסיון', full_board: 'פנסיון מלא' };
export const BOARD_ADMIN_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager', 'finance_manager'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function boardOfPlan(plan) {
  if (!plan) return 'room_only';
  if (plan.allInclusive || plan.fullBoard) return 'full_board';
  if (plan.halfBoard) return 'half_board';
  if (plan.includesBreakfast) return 'breakfast';
  return 'room_only';
}

const PLAN_FLAGS = {
  room_only: { includesBreakfast: false, halfBoard: false, fullBoard: false, allInclusive: false },
  breakfast: { includesBreakfast: true, halfBoard: false, fullBoard: false, allInclusive: false },
  half_board: { includesBreakfast: true, halfBoard: true, fullBoard: false, allInclusive: false },
  full_board: { includesBreakfast: true, halfBoard: false, fullBoard: true, allInclusive: false },
};

// Price of the board for one room for one night (gross, incl. VAT). null = not priced.
export function supplementPerNight({ property, board, adults, children, childAges }) {
  if (!board || board === 'room_only') return 0;
  const row = (property?.boardPricing?.supplements || []).find((s) => s.board === board && s.active !== false);
  if (!row || !(Number(row.adult) >= 0)) return null;
  const infantMax = Number(property?.boardPricing?.infantMaxAge ?? 2);
  const childMax = Number(property?.childMaxAge ?? 12);
  const ages = Array.isArray(childAges) && childAges.length === Number(children || 0) ? childAges.map(Number) : Array.from({ length: Number(children || 0) }, () => childMax);
  let total = Number(adults || 0) * Number(row.adult);
  for (const a of ages) {
    if (a <= infantMax) continue;
    total += a <= childMax ? Number(row.child ?? row.adult) : Number(row.adult);
  }
  return round2(total);
}

export async function getBoardConfig({ propertyId }) {
  const p = await Property.findById(propertyId).select('boardPricing childMaxAge pricingMode').lean();
  if (!p) throw httpError('הנכס לא נמצא', 404);
  const plans = await RatePlan.find({ property: propertyId, active: { $ne: false } }).select('code name includesBreakfast halfBoard fullBoard allInclusive').sort({ sortOrder: 1, code: 1 }).lean();
  const bp = p.boardPricing || {};
  return {
    pricingMode: p.pricingMode || 'rates',
    supplements: ['breakfast', 'half_board', 'full_board'].map((b) => {
      const r = (bp.supplements || []).find((s) => s.board === b);
      return { board: b, label: BOARD_LABELS[b], adult: r?.adult ?? null, child: r?.child ?? null, active: r ? r.active !== false : false };
    }),
    infantMaxAge: bp.infantMaxAge ?? 2,
    childMaxAge: p.childMaxAge ?? 12,
    version: bp.version || 0,
    updatedBy: bp.updatedByName || null,
    plans: plans.map((pl) => ({ id: String(pl._id), code: pl.code, name: pl.name, board: boardOfPlan(pl) })),
    labels: BOARD_LABELS,
  };
}

export async function updateBoardConfig({ propertyId, input, actor, ip }) {
  if (!BOARD_ADMIN_ROLES.includes(actor.role)) throw httpError('הגדרת סוגי אירוח מותרת להנהלה, הכנסות וכספים', 403);
  const cur = await getBoardConfig({ propertyId });
  if (input.version !== undefined && Number(input.version) !== cur.version) throw httpError('ההגדרות עודכנו בינתיים — רעננו', 409, { code: 'stale' });
  const fields = {};
  const supplements = (Array.isArray(input.supplements) ? input.supplements : cur.supplements.filter((x) => x.active || x.adult !== null)).filter((s) => ['breakfast', 'half_board', 'full_board'].includes(s.board)).map((s) => {
    const active = !!s.active;
    const adult = s.adult === '' || s.adult === null || s.adult === undefined ? null : Number(s.adult);
    const child = s.child === '' || s.child === null || s.child === undefined ? null : Number(s.child);
    if (active && !(adult >= 0)) fields[`adult_${s.board}`] = 'מחיר למבוגר';
    if (child !== null && !(child >= 0)) fields[`child_${s.board}`] = 'מחיר לא תקין';
    return { board: s.board, adult: adult ?? undefined, child: child ?? undefined, active };
  });
  const infantMaxAge = Number(input.infantMaxAge ?? cur.infantMaxAge);
  if (!Number.isInteger(infantMaxAge) || infantMaxAge < 0 || infantMaxAge > 5) fields.infantMaxAge = 'גיל 0–5';
  const planBoards = Array.isArray(input.plans) ? input.plans : [];
  for (const pl of planBoards) if (!BOARDS.includes(pl.board) || !mongoose.isValidObjectId(String(pl.id || ''))) fields.plans = 'סוג אירוח לא תקין';
  if (String(input.reason || '').trim().length < 3) fields.reason = 'סיבת השינוי';
  if (Object.keys(fields).length) throw httpError('יש לתקן את ההגדרות', 422, { fields });
  const pricingMode = input.pricingMode === undefined ? cur.pricingMode : input.pricingMode;
  if (!['rates', 'board'].includes(pricingMode)) throw httpError('שיטת תמחור לא מוכרת', 422, { fields: { pricingMode: 'תעריפים או פנסיון' } });
  if (pricingMode === 'board') {
    const boards = new Set(planBoards.length ? planBoards.map((x) => x.board) : cur.plans.map((x) => x.board));
    if (![...boards].some((b) => b !== 'room_only')) throw httpError('במלון לפי פנסיון צריך לפחות תעריף אחד שמוגדר כפנסיון (למשל חצי פנסיון)', 422, { fields: { plans: 'הגדירו לכל תעריף איזה פנסיון הוא' } });
  }
  await Property.updateOne({ _id: propertyId }, { $set: { pricingMode, boardPricing: { supplements, infantMaxAge, version: cur.version + 1, updatedByName: actor.name } } });
  const changedPlans = [];
  for (const pl of planBoards) {
    const before = cur.plans.find((x) => x.id === String(pl.id));
    if (!before || before.board === pl.board) continue;
    await RatePlan.updateOne({ _id: pl.id, property: propertyId }, { $set: PLAN_FLAGS[pl.board] });
    changedPlans.push({ code: before.code, from: before.board, to: pl.board });
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'board_pricing.updated', entityType: 'Property', entityId: propertyId, before: { pricingMode: cur.pricingMode, supplements: cur.supplements, infantMaxAge: cur.infantMaxAge }, after: { pricingMode, supplements, infantMaxAge, plans: changedPlans }, reason: String(input.reason).trim(), ip });
  return getBoardConfig({ propertyId });
}
