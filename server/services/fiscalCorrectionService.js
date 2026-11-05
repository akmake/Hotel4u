// Folio ↔ fiscal documents stay in step (2026-11-05).
//
// The folio is the one source: every correction of a charge that is already on an issued invoice is a
// folio line, and the credit note that documents it is issued from that line, in the same operation:
//  - a discount or a reversal of an invoiced charge → correction lines + a credit note on exactly the
//    invoice line that covers the charge (the invoicing system credits by source line);
//  - "credit" on a document (an amount: the guest pays less) → the credit note, and correction lines
//    mirroring each credited line, with the VAT split the invoicing system computed;
//  - "cancel for re-issue" (wrong details, same money) → a full credit and no folio lines; the charges
//    are freed for a corrected invoice;
//  - a credit made directly in the invoicing system → mirrored here with its correction lines too.
// All of it runs under the folio lock in one transaction; the call to the invoicing system carries a
// fixed operation key, so a retry (or a crash before commit) never issues a second credit, and the
// sync heals a credit that exists there without its folio lines.
import Folio from '../models/Folio.js';
import Invoice, { CHARGE_DOC_TYPES } from '../models/Invoice.js';
import Property from '../models/Property.js';
import { audit } from './auditService.js';
import { httpError, businessDateOf } from './frontDeskService.js';
import { folioBalance } from './departureService.js';
import { invoicerClient } from './invoicerClient.js';
import { docCoverage, saveCreditMirror } from './documentService.js';
import { financialWrite } from './financialTransaction.js';
import { legacyNumber } from '../domain/money.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const gross = (l) => round2(Number(l.amount || 0) + Number(l.taxAmount || 0));
const fixed2 = (n) => round2(n).toFixed(2);
const num = (v) => legacyNumber(v ?? '0');
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

const invoicerFailure = (what) => (err) => {
  if (err.status >= 400 && err.status < 500) throw httpError(`מערכת החשבוניות לא הפיקה את ${what}: ${err.message}`, 422, { code: err.code || 'invoicer_rejected' });
  throw err;
};

// Mirrors issued before line ids were kept: take each line's id from the invoicing system (same order)
// and which folio lines it covers (its charge + the discounts folded into it).
async function ensureLineIds(docs, folio, session) {
  for (const d of docs) {
    if ((d.lines || []).every((l) => l.externalLineId && l.folioLineIds?.length)) continue;
    const remote = await invoicerClient().getDocument(d.external.workspace, d.external.documentId);
    const base = (d.lines || []).map((l) => (l.folioLineIds?.length ? l.folioLineIds.map(String) : l.folioLineId ? [String(l.folioLineId)] : []));
    const taken = new Set(base.flat());
    for (const id of (d.coveredLineIds || []).map(String).filter((x) => !taken.has(x))) {
      const fl = folio.lines.id(id);
      let i = fl?.discountOf ? base.findIndex((ids) => ids.includes(String(fl.discountOf))) : -1;
      if (i < 0) i = 0;
      base[i].push(id);
    }
    const set = {};
    d.lines.forEach((l, i) => {
      set[`lines.${i}.externalLineId`] = l.externalLineId || (remote.lines?.[i]?._id ? String(remote.lines[i]._id) : undefined);
      set[`lines.${i}.folioLineIds`] = base[i];
      l.externalLineId = set[`lines.${i}.externalLineId`];
      l.folioLineIds = base[i];
    });
    await Invoice.updateOne({ _id: d._id }, { $set: set }, { session });
  }
}

// Which invoice line (in the invoicing system) covers each folio line of this folio, now.
async function invoicedLineMap(folio, session) {
  const coverage = await docCoverage(folio._id, session);
  const docs = await Invoice.find({ folio: folio._id, issuer: 'invoicer', status: 'issued', type: { $in: CHARGE_DOC_TYPES } }).session(session).lean();
  await ensureLineIds(docs, folio, session);
  const map = new Map();
  for (const d of docs) {
    for (const l of d.lines || []) {
      for (const id of l.folioLineIds || []) if (coverage.charges.get(String(id)) === d.invoiceNumber) map.set(String(id), { doc: d, line: l });
    }
  }
  return { map, coverage };
}

// A closed folio that a correction leaves with money to settle opens again, so it can be refunded
// or collected — and it shows up in the open balances instead of hiding.
async function reopenIfNeeded({ folio, propertyId, actor, session, afterCommit, reason }) {
  if (folio.status !== 'closed' || Math.abs(folioBalance(folio)) < 0.005) return false;
  folio.status = 'open';
  folio.closedAt = undefined;
  folio.settlement = undefined;
  await audit({ property: propertyId, actor: actor?.id, actorName: actor?.name || 'מערכת', action: 'folio.reopened_by_credit', entityType: 'Folio', entityId: folio._id, reason, after: { balance: folioBalance(folio) }, session, afterCommit });
  return true;
}

// Split a credited invoice line (net/VAT as the invoicing system computed) over the folio parts it
// stands for, in proportion to their gross; the last part takes the rounding.
function splitIssued(issuedLine, parts) {
  const total = round2(parts.reduce((s, p) => s + p.gross, 0));
  const tax = num(issuedLine.tax);
  let usedTax = 0;
  return parts.map((p, i) => {
    const t = i === parts.length - 1 ? round2(tax - usedTax) : round2(tax * p.gross / total);
    usedTax = round2(usedTax + t);
    return { ...p, net: round2(p.gross - t), tax: t };
  });
}

// ── Correction of invoiced folio lines (discount / reversal) ───────────────────────────────────
// parts: [{ folioLineId, gross }] — gross > 0, the amount taken off the charge. Issues one credit
// note per invoice involved, on its exact source lines. Returns the credits with each part's net/VAT.
export async function creditInvoicedParts({ folio, parts, reason, key, session }) {
  const { map } = await invoicedLineMap(folio, session);
  const groups = new Map();
  for (const p of parts) {
    const hit = map.get(String(p.folioLineId));
    // Covered by an in-app document of the old stack (not the invoicing system): the old rule holds —
    // the correction is a credit note on that document, not an automatic one.
    if (!hit) {
      const fl = folio.lines.id(p.folioLineId);
      throw httpError(`"${fl?.description || 'החיוב'}" כלול במסמך שהונפק בתוכנה (לא במערכת החשבוניות) — תיקון במסמך זיכוי`, 409, { code: 'on_document' });
    }
    if (!hit.line.externalLineId) throw httpError('לשורת החשבונית אין מזהה במערכת החשבוניות', 409);
    const k = String(hit.doc._id);
    const g = groups.get(k) || { doc: hit.doc, byLine: new Map() };
    const arr = g.byLine.get(hit.line.externalLineId) || [];
    arr.push(p);
    g.byLine.set(hit.line.externalLineId, arr);
    groups.set(k, g);
  }
  const out = [];
  for (const { doc, byLine } of groups.values()) {
    const selections = [...byLine.entries()].map(([sourceLineId, ps]) => ({ sourceLineId, grossAmount: fixed2(ps.reduce((s, p) => s + p.gross, 0)) }));
    const issued = await invoicerClient()
      .credit(doc.external.workspace, doc.external.documentId, { reason: clip(reason, 300), selections }, `hotel4u:fix:${key}:${doc._id}`)
      .catch(invoicerFailure('מסמך הזיכוי'));
    const amounts = new Map();
    for (const [sourceLineId, ps] of byLine) {
      const il = (issued.lines || []).find((l) => String(l.sourceLineId) === String(sourceLineId));
      for (const s of il ? splitIssued(il, ps) : ps.map((p) => ({ ...p, net: null, tax: null }))) amounts.set(String(s.folioLineId), s);
    }
    out.push({ doc, issued, amounts });
  }
  return out;
}

// After the folio lines were pushed (and saved): one credit-note mirror per credit, covering them.
export async function mirrorCredits({ propertyId, credits, lineIdsOf, actor, reason, session }) {
  const docs = [];
  for (const c of credits) {
    const ids = lineIdsOf(c);
    const { doc, created } = await saveCreditMirror({
      propertyId, source: c.doc, issued: c.issued, requestKey: `fix:${c.issued._id}`, actor, notes: reason,
      purpose: 'correction', origin: 'hotel4u', coveredLineIds: ids, session,
    });
    if (!created && !(doc.coveredLineIds || []).length) await Invoice.updateOne({ _id: doc._id }, { $set: { coveredLineIds: ids, creditPurpose: 'correction' } }, { session });
    docs.push(doc);
  }
  return docs;
}

// Correction lines for a credit note whose lines carry their source (credit made on a document, or
// directly in the invoicing system): a discount line per credited invoice line, on its main charge.
function correctionLinesFor({ folio, source, issued, reference, reason, businessDate }) {
  const out = [];
  for (const il of issued.lines || []) {
    const src = (source.lines || []).find((l) => String(l.externalLineId) === String(il.sourceLineId));
    const mainId = src?.folioLineIds?.[0] || (src?.folioLineId ? String(src.folioLineId) : null);
    const main = mainId ? folio.lines.id(mainId) : null;
    out.push({
      type: 'discount', description: clip(`זיכוי ${issued.number}: ${il.description || main?.description || ''}`, 200),
      amount: -num(il.net), taxAmount: -num(il.tax), vatRate: Number(il.vatRate) || 0,
      department: main?.department || il.department || undefined, serviceDate: main?.serviceDate || businessDate,
      taxReason: main?.taxReason, source: 'manual', status: 'posted',
      reference: `${reference}:${il.sourceLineId}`, discountOf: main?._id, reason: clip(reason, 300) || undefined,
    });
  }
  return out;
}

// ── "Credit" on a document ─────────────────────────────────────────────────────────────────────
// purpose 'correction' (default): an amount the guest no longer pays — credit note + correction lines.
// purpose 'reissue': the whole document is cancelled to be issued again correctly — no folio lines.
export async function creditDocument({ propertyId, invoiceId, amount, purpose = 'correction', reason, idempotencyKey, actor, ip }) {
  const k = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(k)) throw httpError('חסר מזהה פעולה (idempotency key)', 422);
  if (!['correction', 'reissue'].includes(purpose)) throw httpError('יש לבחור סוג זיכוי', 422, { fields: { purpose: 'סוג' } });
  const why = clip(reason, 300);
  if (why.length < 3) throw httpError('נדרשת סיבת זיכוי', 422, { fields: { reason: 'סיבה' } });
  const partial = amount === undefined || amount === null || amount === '' ? null : round2(Number(amount));
  if (partial !== null && !(partial > 0)) throw httpError('סכום הזיכוי חייב להיות חיובי', 422, { fields: { amount: 'סכום' } });
  if (purpose === 'reissue' && partial !== null) throw httpError('ביטול להפקה מחדש הוא על כל יתרת המסמך', 422, { fields: { amount: 'ללא סכום' } });
  const requestKey = `credit:${k}`;
  const head = await Invoice.findOne({ _id: invoiceId, property: propertyId, issuer: 'invoicer' }).select('folio type').lean();
  if (!head) throw httpError('המסמך לא נמצא', 404);
  if (!CHARGE_DOC_TYPES.includes(head.type)) throw httpError('קבלה לא מזכים כאן: רושמים החזר כספי בחשבון ומפיקים קבלת החזר', 422, { code: 'receipt_is_refunded' });
  if (!head.folio) throw httpError('המסמך אינו קשור לחשבון', 409);
  // Credits made there since the last look count first.
  const { syncInvoicerDocuments } = await import('./documentService.js');
  await syncInvoicerDocuments(propertyId).catch(() => null);
  return financialWrite(`folio:${head.folio}`, async (session, afterCommit) => {
    const dup = await Invoice.findOne({ property: propertyId, requestKey }).session(session).lean();
    if (dup) return { id: String(dup._id), number: dup.invoiceNumber, gross: round2(dup.totalGross), duplicate: true };
    const source = await Invoice.findById(invoiceId).session(session).lean();
    const folio = await Folio.findById(head.folio).session(session);
    if (!folio) throw httpError('החשבון לא נמצא', 404);
    if (purpose === 'correction') await ensureLineIds([source], folio, session);
    const issued = await invoicerClient()
      .credit(source.external.workspace, source.external.documentId, { reason: why, ...(partial !== null ? { creditAmount: fixed2(partial) } : {}) }, `hotel4u:credit:${k}`)
      .catch(invoicerFailure('מסמך הזיכוי'));
    let coveredLineIds = [];
    let reopened = false;
    if (purpose === 'correction') {
      const property = await Property.findById(propertyId).select('timezone dayClose').session(session).lean();
      const lines = correctionLinesFor({ folio, source, issued, reference: `credit:${issued._id}`, reason: why, businessDate: businessDateOf(property) });
      for (const l of lines) folio.lines.push({ ...l, createdBy: actor.id || undefined });
      coveredLineIds = folio.lines.slice(-lines.length).map((l) => String(l._id));
      reopened = await reopenIfNeeded({ folio, propertyId, actor, session, afterCommit, reason: why });
      await folio.save({ session });
    }
    const { doc } = await saveCreditMirror({ propertyId, source, issued, requestKey, actor, notes: why, purpose, origin: 'hotel4u', coveredLineIds, session });
    await audit({
      property: propertyId, actor: actor.id, actorName: actor.name, action: 'invoice.credit_note', entityType: 'Invoice', entityId: source._id, reason: why,
      after: { issuer: 'invoicer', purpose, creditNote: String(doc._id), externalId: String(issued._id), number: doc.invoiceNumber, gross: doc.totalGross, folioLines: coveredLineIds.length, reopened }, ip, session, afterCommit,
    });
    return { id: String(doc._id), number: doc.invoiceNumber, gross: round2(doc.totalGross), purpose, folioLines: coveredLineIds.length, balance: folioBalance(folio) };
  }, propertyId);
}

// ── A credit made in the invoicing system (sync) or a mirror without its folio lines (backfill) ──
// Mirrors it (if new) and posts its correction lines, under the folio lock.
export async function recordInvoicerCredit({ propertyId, source, issued, origin = 'invoicer' }) {
  if (!source?.folio) return { skipped: 'no_folio' };
  return financialWrite(`folio:${source.folio}`, async (session, afterCommit) => {
    let mirror = await Invoice.findOne({ property: propertyId, 'external.documentId': String(issued._id) }).session(session).lean();
    if (mirror && (mirror.creditPurpose === 'reissue' || (mirror.coveredLineIds || []).length)) return { created: false, posted: 0 };
    const folio = await Folio.findById(source.folio).session(session);
    if (!folio) return { skipped: 'no_folio' };
    const fresh = await Invoice.findById(source._id).session(session).lean();
    await ensureLineIds([fresh], folio, session);
    const reference = `credit:${issued._id}`;
    const already = folio.lines.filter((l) => String(l.reference || '').startsWith(`${reference}:`));
    let coveredLineIds = already.map((l) => String(l._id));
    if (!already.length) {
      const property = await Property.findById(propertyId).select('timezone dayClose').session(session).lean();
      const why = issued.notes || 'זיכוי שהופק במערכת החשבוניות';
      const lines = correctionLinesFor({ folio, source: fresh, issued, reference, reason: why, businessDate: businessDateOf(property) });
      for (const l of lines) folio.lines.push(l);
      coveredLineIds = folio.lines.slice(-lines.length).map((l) => String(l._id));
      await reopenIfNeeded({ folio, propertyId, actor: null, session, afterCommit, reason: why });
      await folio.save({ session });
    }
    let created = false;
    if (mirror) await Invoice.updateOne({ _id: mirror._id }, { $set: { coveredLineIds, creditPurpose: 'correction', creditOrigin: mirror.creditOrigin || origin } }, { session });
    else {
      const r = await saveCreditMirror({ propertyId, source: fresh, issued, requestKey: `invoicer:${issued._id}`, actor: null, notes: issued.notes, purpose: 'correction', origin, coveredLineIds, session });
      mirror = r.doc;
      created = r.created;
    }
    await audit({
      property: propertyId, actor: null, actorName: 'מערכת החשבוניות', action: 'invoice.credit_note', entityType: 'Invoice', entityId: source._id,
      after: { issuer: 'invoicer', synced: true, origin, externalId: String(issued._id), number: String(issued.number), source: source.invoiceNumber, folioLines: coveredLineIds.length }, session, afterCommit,
    });
    return { created, posted: already.length ? 0 : coveredLineIds.length };
  }, propertyId);
}
