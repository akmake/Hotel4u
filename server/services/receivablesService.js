// G5 — company receivables (city ledger): what each company owes on its folios, how old it is, its
// credit limit, and receiving a company payment. A payment is spread over the open folios from the
// oldest (or as the clerk allocates it) and each part is posted by recordFolioPayment — the same rules,
// details and idempotency as a payment at the desk; a retry with the same key completes, never doubles.
import mongoose from 'mongoose';
import Folio from '../models/Folio.js';
import Company from '../models/Company.js';
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import { folioBalance } from './departureService.js';
import { recordFolioPayment } from './financeService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { audit } from './auditService.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const BUCKETS = [['b0', 30], ['b30', 60], ['b60', 90], ['b90', Infinity]];
const IN_HOUSE = ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'];

async function openCompanyItems(propertyId, companyId = null) {
  const q = { property: propertyId, ownerType: 'company', status: { $ne: 'closed' } };
  if (companyId) q.ownerRef = String(companyId);
  const folios = await Folio.find(q).select('reservation ownerRef lines status updatedAt').lean();
  const items = folios.map((f) => ({ f, balance: folioBalance(f) })).filter((x) => Math.abs(x.balance) > 0.005);
  const res = new Map((await Reservation.find({ _id: { $in: items.map((x) => x.f.reservation) } })
    .select('confirmationNumber status arrivalDate departureDate checkedOutAt primaryGuest').populate('primaryGuest', 'firstName lastName').lean()).map((r) => [String(r._id), r]));
  return items.map(({ f, balance }) => {
    const r = res.get(String(f.reservation));
    const lastCharge = (f.lines || []).filter((l) => l.status === 'posted' && Number(l.amount) > 0).map((l) => l.serviceDate).filter(Boolean).sort().pop();
    return {
      folioId: String(f._id), companyId: String(f.ownerRef), reservationId: r ? String(r._id) : null,
      confirmationNumber: r?.confirmationNumber || null, guest: r?.primaryGuest ? `${r.primaryGuest.firstName || ''} ${r.primaryGuest.lastName || ''}`.trim() : null,
      arrivalDate: r?.arrivalDate || null, departureDate: r?.departureDate || null, inHouse: IN_HOUSE.includes(r?.status),
      since: r?.departureDate || lastCharge || null, balance,
    };
  });
}

export async function receivables({ propertyId }) {
  const property = await Property.findById(propertyId).select('timezone dayClose').lean();
  const today = businessDateOf(property);
  const items = await openCompanyItems(propertyId);
  const companies = new Map((await Company.find({ _id: { $in: [...new Set(items.map((i) => i.companyId))].filter((id) => mongoose.isValidObjectId(id)) } })
    .select('name taxId creditLimit paymentTerms contactName email phone').lean()).map((c) => [String(c._id), c]));
  const by = new Map();
  for (const it of items) {
    const age = it.inHouse || !it.since ? 0 : Math.max(0, daysBetween(it.since, today));
    const bucket = it.inHouse ? 'inHouse' : BUCKETS.find(([, max]) => age <= max)[0];
    const c = companies.get(it.companyId);
    const row = by.get(it.companyId) || { companyId: it.companyId, name: c?.name || 'חברה לא מזוהה', taxId: c?.taxId || null, creditLimit: c?.creditLimit ?? null, paymentTerms: c?.paymentTerms || null, contact: c ? { name: c.contactName || null, email: c.email || null, phone: c.phone || null } : null, total: 0, inHouse: 0, b0: 0, b30: 0, b60: 0, b90: 0, items: [] };
    row.total = round2(row.total + it.balance);
    row[bucket] = round2(row[bucket] + it.balance);
    row.items.push({ ...it, age, bucket });
    by.set(it.companyId, row);
  }
  const rows = [...by.values()].map((r) => ({ ...r, overLimit: r.creditLimit != null && r.creditLimit > 0 && r.total > r.creditLimit, items: r.items.sort((a, b) => String(a.since || '').localeCompare(String(b.since || ''))) }))
    .sort((a, b) => b.total - a.total);
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  return { today, rows, totals: { total: sum('total'), inHouse: sum('inHouse'), b0: sum('b0'), b30: sum('b30'), b60: sum('b60'), b90: sum('b90') } };
}

// input: { amount, method, details, note, idempotencyKey, allocations?: [{ folioId, amount }] }
export async function receiveCompanyPayment({ propertyId, companyId, input, actor, ip }) {
  if (!mongoose.isValidObjectId(String(companyId || ''))) throw httpError('מזהה חברה לא תקין', 400);
  const key = String(input.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,60}$/.test(key)) throw httpError('חסר מזהה פעולה', 422);
  const amount = round2(input.amount);
  if (!(amount > 0)) throw httpError('סכום חיובי', 422, { fields: { amount: 'סכום' } });
  const items = (await openCompanyItems(propertyId, companyId)).filter((i) => i.balance > 0.005)
    .sort((a, b) => String(a.since || '').localeCompare(String(b.since || '')));
  if (!items.length) throw httpError('לחברה אין יתרה פתוחה', 409);
  let plan;
  if (Array.isArray(input.allocations) && input.allocations.length) {
    plan = input.allocations.map((a) => ({ folioId: String(a.folioId), amount: round2(a.amount) })).filter((a) => a.amount > 0);
    for (const a of plan) {
      const it = items.find((i) => i.folioId === a.folioId);
      if (!it) throw httpError('חשבון שאינו פתוח לחברה הזו', 422);
      if (a.amount - it.balance > 0.005) throw httpError(`בחשבון ${it.confirmationNumber || ''} היתרה ${it.balance.toFixed(2)} בלבד`, 422);
    }
    if (Math.abs(plan.reduce((s, a) => s + a.amount, 0) - amount) > 0.005) throw httpError('סכום החלוקה אינו שווה לסכום התשלום', 422, { fields: { amount: 'חלוקה' } });
  } else {
    const total = round2(items.reduce((s, i) => s + i.balance, 0));
    if (amount - total > 0.005) throw httpError(`הסכום גבוה מהיתרה הפתוחה (${total.toFixed(2)}) — יתרת זכות לא נרשמת כאן`, 422, { fields: { amount: 'מעל היתרה' } });
    let left = amount; plan = [];
    for (const it of items) { if (left <= 0.005) break; const part = round2(Math.min(left, it.balance)); plan.push({ folioId: it.folioId, amount: part }); left = round2(left - part); }
  }
  const posted = [];
  for (const [i, a] of plan.entries()) {
    const out = await recordFolioPayment({ propertyId, folioId: a.folioId, input: { amount: a.amount, method: input.method, details: input.details || {}, note: input.note, idempotencyKey: `${key}-${i}` }, actor, ip });
    posted.push({ folioId: a.folioId, amount: a.amount, duplicate: out.duplicate, balance: out.balance });
  }
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'receivable.payment', entityType: 'Company', entityId: companyId, after: { amount, method: input.method, folios: posted.length }, ip }).catch(() => null);
  return { amount, posted };
}
