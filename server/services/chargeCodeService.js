// ADM-13 (gap G1) — charge codes and payment methods catalogue.
//
// Every manual posting path resolves its code here, so a line's `department` is always a code the
// property defined: the revenue group feeds the day-close report, the VAT class decides whether
// VAT is extracted, and the post level decides who may post it by hand. Codes are created once and
// never renamed or deleted — only deactivated — so lines posted under them stay readable.
import mongoose from 'mongoose';
import ChargeCode, { REVENUE_GROUPS, VAT_CLASSES, POST_LEVELS } from '../models/ChargeCode.js';
import { audit } from './auditService.js';
import { httpError, MANAGER_ROLES } from './frontDeskService.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const CODE_RX = /^[a-z][a-z0-9_]{1,23}$/;

export const CATALOG_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
// Who counts as "manager" for codes with postLevel=manager (same set that may reverse a charge).
export const MANAGER_POST_ROLES = [...new Set([...MANAGER_ROLES, 'finance_manager', 'chain_admin'])];
// Payment methods are a fixed set (the posting logic depends on them); the property names them,
// maps them to accounts, may demand a reference and may switch them off.
export const PAYMENT_METHOD_CODES = ['cash', 'credit_card', 'bank_transfer', 'cheque', 'voucher'];
const REF_ALWAYS = ['bank_transfer', 'cheque', 'voucher'];

export const REVENUE_GROUP_LABELS = { rooms: 'לינה', f_and_b: 'מזון ומשקאות', other_operated: 'מחלקות תפעול אחרות', fees: 'דמי ביטול ואי־הגעה', misc: 'שונות' };

// Shipped defaults. Codes match the department keys already on folio lines, so history maps.
const DEFAULT_CHARGES = [
  { code: 'rooms', name: 'לינה', revenueGroup: 'rooms', postLevel: 'system', sortOrder: 1 },
  { code: 'late_checkout', name: 'יציאה מאוחרת', revenueGroup: 'rooms', sortOrder: 2 },
  { code: 'no_show_fee', name: 'דמי אי־הגעה', revenueGroup: 'fees', postLevel: 'manager', sortOrder: 3 },
  { code: 'cancellation_fee', name: 'דמי ביטול', revenueGroup: 'fees', postLevel: 'manager', sortOrder: 4 },
  { code: 'board', name: 'אירוח (ארוחות לפי פנסיון)', revenueGroup: 'f_and_b', postLevel: 'system', sortOrder: 9 },
  { code: 'f_and_b', name: 'מזון ומשקאות', revenueGroup: 'f_and_b', sortOrder: 10 },
  { code: 'minibar', name: 'מיני־בר', revenueGroup: 'f_and_b', sortOrder: 11 },
  { code: 'spa', name: 'ספא', revenueGroup: 'other_operated', sortOrder: 20 },
  { code: 'parking', name: 'חניה', revenueGroup: 'other_operated', sortOrder: 21 },
  { code: 'laundry', name: 'כביסה', revenueGroup: 'other_operated', sortOrder: 22 },
  { code: 'telephone', name: 'טלפון', revenueGroup: 'other_operated', sortOrder: 23 },
  { code: 'damage', name: 'נזק לרכוש', revenueGroup: 'misc', postLevel: 'manager', sortOrder: 30 },
  { code: 'other', name: 'שונות', revenueGroup: 'misc', sortOrder: 99 },
];
const DEFAULT_PAYMENTS = [
  { code: 'cash', name: 'מזומן', sortOrder: 1 },
  { code: 'credit_card', name: 'כרטיס אשראי (מסוף חיצוני)', sortOrder: 2 },
  { code: 'bank_transfer', name: 'העברה בנקאית', requireReference: true, sortOrder: 3 },
  { code: 'cheque', name: 'שיק', requireReference: true, sortOrder: 4 },
  { code: 'voucher', name: 'שובר', requireReference: true, sortOrder: 5 },
];
// Department keys older paths wrote before the catalogue existed.
const LEGACY_ALIASES = { room: 'rooms', service: 'other', fnb: 'f_and_b' };

const seeded = new Set();

export async function ensureCatalog(propertyId) {
  const key = String(propertyId);
  if (seeded.has(key)) return;
  const ops = [
    ...DEFAULT_CHARGES.map((d) => ({ kind: 'charge', ...d })),
    ...DEFAULT_PAYMENTS.map((d) => ({ kind: 'payment', revenueGroup: 'misc', ...d })),
  ].map((d) => ({
    updateOne: {
      filter: { property: propertyId, kind: d.kind, code: d.code },
      update: { $setOnInsert: { property: propertyId, builtIn: true, active: true, ...d } },
      upsert: true,
    },
  }));
  try {
    await ChargeCode.bulkWrite(ops, { ordered: false });
  } catch (e) {
    if (e?.code !== 11000 && !String(e?.message || '').includes('E11000')) throw e;
  }
  seeded.add(key);
}

function dto(c) {
  return {
    id: String(c._id), kind: c.kind, code: c.code, name: c.name, revenueGroup: c.revenueGroup, vatClass: c.vatClass,
    glAccount: c.glAccount || null, defaultPrice: c.defaultPrice ?? null, priceEditable: c.priceEditable !== false,
    postLevel: c.postLevel, requireReference: !!c.requireReference || (c.kind === 'payment' && REF_ALWAYS.includes(c.code)),
    active: c.active !== false, builtIn: !!c.builtIn, sortOrder: c.sortOrder ?? 100,
    updatedAt: c.updatedAt, updatedBy: c.updatedByName || null,
  };
}

export async function listCodes({ propertyId, kind, includeInactive = false }) {
  await ensureCatalog(propertyId);
  const filter = { property: propertyId };
  if (kind) filter.kind = kind;
  if (!includeInactive) filter.active = true;
  const rows = await ChargeCode.find(filter).sort({ kind: 1, sortOrder: 1, code: 1 }).lean();
  return { codes: rows.map(dto), revenueGroups: REVENUE_GROUP_LABELS };
}

// Map of every code (active or not) — reports and folio views label lines with it.
export async function codeMap(propertyId) {
  await ensureCatalog(propertyId);
  const rows = await ChargeCode.find({ property: propertyId }).lean();
  const charges = new Map();
  const payments = new Map();
  for (const r of rows) (r.kind === 'payment' ? payments : charges).set(r.code, dto(r));
  return { charges, payments, alias: (k) => LEGACY_ALIASES[k] || k };
}

function validate(input, { creating, kind }) {
  const errors = {};
  const out = {};
  if (creating) {
    const code = String(input.code || '').trim().toLowerCase();
    if (!CODE_RX.test(code)) errors.code = 'קוד: אותיות לטיניות קטנות, ספרות וקו תחתון (2–24), מתחיל באות';
    out.code = code;
  }
  if (input.name !== undefined || creating) {
    const name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 80) errors.name = 'שם בין 2 ל־80 תווים';
    out.name = name;
  }
  if (kind === 'charge') {
    if (input.revenueGroup !== undefined || creating) {
      if (!REVENUE_GROUPS.includes(input.revenueGroup)) errors.revenueGroup = 'יש לבחור קבוצת הכנסה';
      out.revenueGroup = input.revenueGroup;
    }
    if (input.vatClass !== undefined) {
      if (!VAT_CLASSES.includes(input.vatClass)) errors.vatClass = 'סיווג מע״מ לא תקין';
      out.vatClass = input.vatClass;
    }
    if (input.postLevel !== undefined) {
      if (!POST_LEVELS.includes(input.postLevel)) errors.postLevel = 'רמת הרשאה לא תקינה';
      out.postLevel = input.postLevel;
    }
    if (input.defaultPrice !== undefined) {
      if (input.defaultPrice === null || input.defaultPrice === '') out.defaultPrice = null;
      else if (!(Number(input.defaultPrice) >= 0) || Number(input.defaultPrice) > 1e6) errors.defaultPrice = 'מחיר לא תקין';
      else out.defaultPrice = round2(input.defaultPrice);
    }
    if (input.priceEditable !== undefined) out.priceEditable = !!input.priceEditable;
  }
  if (kind === 'payment' && input.requireReference !== undefined) out.requireReference = !!input.requireReference;
  if (input.glAccount !== undefined) {
    const gl = String(input.glAccount || '').trim();
    if (gl.length > 40) errors.glAccount = 'עד 40 תווים';
    out.glAccount = gl || null;
  }
  if (input.sortOrder !== undefined) {
    const n = Number(input.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 9999) errors.sortOrder = 'מספר שלם 0–9999';
    out.sortOrder = n;
  }
  if (input.active !== undefined) out.active = !!input.active;
  if (Object.keys(errors).length) throw httpError('יש לתקן את פרטי הקוד', 422, { fields: errors });
  return out;
}

export async function createCode({ propertyId, input, actor, ip }) {
  if (!CATALOG_ROLES.includes(actor.role)) throw httpError('ניהול קודי חיוב מותר להנהלה ולכספים', 403);
  await ensureCatalog(propertyId);
  const kind = input.kind === 'payment' ? 'payment' : 'charge';
  if (kind === 'payment') throw httpError('אמצעי התשלום קבועים במערכת — אפשר לשנות שם, חשבון ואסמכתה, או להשבית', 422);
  const data = validate(input, { creating: true, kind });
  if (!data.vatClass) data.vatClass = 'standard';
  if (data.vatClass !== 'standard' && String(input.reason || '').trim().length < 3) throw httpError('קוד שאינו חייב במע״מ מחייב סיבה', 422, { fields: { reason: 'יש לפרט את הבסיס לפטור' } });
  if (data.postLevel === 'system') throw httpError('רמת "מערכת בלבד" שמורה לקודים מובנים', 422, { fields: { postLevel: 'לא זמין לקוד חדש' } });
  if (data.priceEditable === false && !(data.defaultPrice > 0)) throw httpError('מחיר נעול מחייב מחיר ברירת מחדל', 422, { fields: { defaultPrice: 'נדרש מחיר' } });
  let doc;
  try {
    doc = await ChargeCode.create({ property: propertyId, kind, ...data, builtIn: false, updatedBy: actor.id || undefined, updatedByName: actor.name });
  } catch (e) {
    if (e?.code === 11000) throw httpError(`הקוד ${data.code} כבר קיים`, 409, { fields: { code: 'קוד קיים' } });
    throw e;
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'charge_code.created', entityType: 'ChargeCode', entityId: doc._id, after: dto(doc.toObject()), reason: input.reason || undefined, ip });
  return dto(doc.toObject());
}

export async function updateCode({ propertyId, id, input, actor, ip }) {
  if (!CATALOG_ROLES.includes(actor.role)) throw httpError('ניהול קודי חיוב מותר להנהלה ולכספים', 403);
  if (!mongoose.isValidObjectId(String(id || ''))) throw httpError('מזהה קוד לא תקין', 400);
  const doc = await ChargeCode.findOne({ _id: id, property: propertyId });
  if (!doc) throw httpError('הקוד לא נמצא', 404);
  if (input.version && new Date(input.version).getTime() !== new Date(doc.updatedAt).getTime()) {
    throw httpError('הקוד עודכן בינתיים על ידי משתמש אחר — רעננו', 409, { code: 'stale' });
  }
  if (input.code !== undefined && String(input.code) !== doc.code) throw httpError('קוד אינו ניתן לשינוי — יוצרים קוד חדש ומשביתים את הישן', 422, { fields: { code: 'קבוע' } });
  const data = validate(input, { creating: false, kind: doc.kind });
  const before = dto(doc.toObject());
  const next = { ...before, ...data };
  if (doc.builtIn && doc.kind === 'charge' && doc.code === 'rooms') {
    if (data.active === false) throw httpError('קוד הלינה משמש לחיוב הלילות — אי אפשר להשבית', 422);
    if (data.postLevel && data.postLevel !== 'system') throw httpError('לינה נרשמת רק על ידי המערכת (סגירת יום ויציאה)', 422);
  }
  if (doc.kind === 'charge' && !['rooms', 'board'].includes(doc.code) && data.postLevel === 'system') throw httpError('רמת "מערכת בלבד" שמורה לקודי הלינה והאירוח', 422);
  if (data.vatClass && data.vatClass !== before.vatClass && String(input.reason || '').trim().length < 3) {
    throw httpError('שינוי סיווג מע״מ מחייב סיבה', 422, { fields: { reason: 'יש לפרט' } });
  }
  if (doc.kind === 'charge' && next.priceEditable === false && !(next.defaultPrice > 0)) throw httpError('מחיר נעול מחייב מחיר ברירת מחדל', 422, { fields: { defaultPrice: 'נדרש מחיר' } });
  if (doc.kind === 'payment' && data.active === false) {
    const others = await ChargeCode.countDocuments({ property: propertyId, kind: 'payment', active: true, _id: { $ne: doc._id } });
    if (!others) throw httpError('חייב להישאר לפחות אמצעי תשלום פעיל אחד', 422);
  }
  if (doc.kind === 'payment' && REF_ALWAYS.includes(doc.code) && data.requireReference === false) {
    throw httpError('העברה, שיק ושובר מחייבים אסמכתה תמיד', 422, { fields: { requireReference: 'חובה' } });
  }
  Object.assign(doc, data, { updatedBy: actor.id || undefined, updatedByName: actor.name });
  await doc.save();
  const after = dto(doc.toObject());
  const changed = Object.keys(after).filter((k) => !['updatedAt', 'updatedBy'].includes(k) && JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  if (changed.length) {
    await audit({
      property: propertyId, actor: actor.id, actorName: actor.name, action: 'charge_code.updated', entityType: 'ChargeCode', entityId: doc._id,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      reason: input.reason || undefined, ip,
    });
  }
  return after;
}

// Resolve the code of a manual charge: it must exist, be active, and the actor must be allowed to
// post it. Returns the price rule and VAT treatment the posting must follow.
export async function resolveChargeCode({ propertyId, code, actorRole, unitPrice }) {
  await ensureCatalog(propertyId);
  const key = LEGACY_ALIASES[code] || code;
  const doc = typeof key === 'string' && key ? await ChargeCode.findOne({ property: propertyId, kind: 'charge', code: key }).lean() : null;
  if (!doc || doc.active === false) throw httpError('יש לבחור קוד חיוב פעיל מהקטלוג', 422, { fields: { department: 'קוד לא קיים או מושבת' } });
  if (doc.postLevel === 'system') throw httpError(`"${doc.name}" נרשם רק על ידי המערכת (סגירת יום ויציאה)`, 422, { fields: { department: 'לא לרישום ידני' } });
  if (doc.postLevel === 'manager' && !MANAGER_POST_ROLES.includes(actorRole)) throw httpError(`רישום "${doc.name}" מותר למנהל או לכספים`, 403, { code: 'approval_required' });
  let price = unitPrice === undefined || unitPrice === null || unitPrice === '' ? null : round2(unitPrice);
  if (doc.priceEditable === false) {
    if (price !== null && Math.abs(price - Number(doc.defaultPrice)) > 0.005) throw httpError(`המחיר של "${doc.name}" קבוע (${Number(doc.defaultPrice).toFixed(2)})`, 422, { fields: { unitPrice: 'מחיר קבוע' } });
    price = round2(doc.defaultPrice);
  }
  if (price === null && doc.defaultPrice > 0) price = round2(doc.defaultPrice);
  return { code: doc.code, name: doc.name, vatClass: doc.vatClass || 'standard', unitPrice: price, revenueGroup: doc.revenueGroup };
}

// VAT for a gross amount under the code's class (standard → extracted with the property rate).
export function taxFor(gross, vatClass, vatRatePct) {
  const g = round2(gross);
  if (vatClass && vatClass !== 'standard') return { net: g, tax: 0 };
  const rate = Number(vatRatePct ?? 18) / 100;
  const net = round2(g / (1 + rate));
  return { net, tax: round2(g - net) };
}

// Payment method gate: active in the catalogue, reference when required.
export async function resolvePaymentMethod({ propertyId, method, methodRef }) {
  await ensureCatalog(propertyId);
  if (!PAYMENT_METHOD_CODES.includes(method)) throw httpError('יש לבחור אמצעי תשלום', 422, { fields: { method: 'יש לבחור אמצעי' } });
  const doc = await ChargeCode.findOne({ property: propertyId, kind: 'payment', code: method }).lean();
  if (!doc || doc.active === false) throw httpError('אמצעי התשלום מושבת בנכס', 422, { fields: { method: 'מושבת' } });
  const needRef = REF_ALWAYS.includes(method) || !!doc.requireReference;
  if (needRef && String(methodRef || '').trim().length < 2) throw httpError('נדרשת אסמכתה לאמצעי תשלום זה', 422, { fields: { methodRef: 'אסמכתה נדרשת' } });
  return { code: doc.code, name: doc.name, requireReference: needRef };
}
