import mongoose from 'mongoose';
import Property from '../models/Property.js';
import AuditLog from '../models/AuditLog.js';
import { LegalEntity, IssuerProfile, DocumentSeries, ComplianceDecision, TaxRule, Account, AccountingPeriod, JournalEntry, AccountingEvent, FiscalOutbox } from '../models/Accounting.js';
import { runFiscalTransaction } from './fiscalTransaction.js';
import { payloadHash, validDate, validateJournal } from '../domain/accounting.js';
import { minor, amount, decimal, ROUNDING_POLICY } from '../domain/money.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';

export const ACCOUNTING_RELEASE_GATES = [
  ['ENTITY_SERIES', 'זהויות מנפיק וסדרות מסמכים', 'Finance'], ['TAX_TIMING', 'עיתוי מסמכים ומקדמות', 'רו״ח'],
  ['TOURIST_TAX', 'תיירים, אילת וחבילות', 'רו״ח'], ['SIGNING', 'חתימה ומסמך ממוחשב', 'Legal'],
  ['DELIVERY_CONSENT', 'הסכמה ומסירה', 'Legal'], ['ALLOCATION', 'חשבוניות ישראל — סביבת בדיקות והרשאות', 'Finance'],
  ['UNIFORM_EXPORT', 'מיפוי מבנה אחיד וסימולטור', 'רו״ח'], ['SOFTWARE_REGISTRATION', 'רישום תוכנה ומהדורה', 'Product'],
  ['PAYMENTS', 'סליקה, החזרים ובירור מצב לא ידוע', 'Finance'], ['LEDGER', 'ספר כפול ומיפוי פקודות', 'רו״ח'],
  ['PRIVACY_RETENTION', 'פרטיות ושמירת מידע', 'Legal'], ['SECURITY', 'הרשאות ובדיקות חדירה', 'Security'],
  ['RESTORE', 'בדיקת שחזור ורצפים', 'Engineering'], ['MIGRATION', 'מיגרציה ויתרות פתיחה', 'Finance'],
  ['PILOT', 'פיילוט והחלטת שחרור חתומה', 'Product'],
].map(([id, label, owner]) => ({ id, label, owner }));
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const keyOf = (key) => {
  if (!/^[A-Za-z0-9_:-]{8,120}$/.test(String(key || ''))) throw fail('נדרש מזהה פעולה באורך 8–120 תווים');
  return String(key);
};
const clean = (value, max = 200) => String(value || '').trim().slice(0, max);
export async function entityContext(propertyId, session) {
  const property = await Property.findById(propertyId).session(session || null);
  if (!property) throw fail('הנכס לא נמצא', 404);
  if (!property.legalEntity) throw fail('יש להגדיר תחילה ישות משפטית לנכס', 409);
  const entity = await LegalEntity.findById(property.legalEntity).session(session || null);
  if (!entity || entity.status !== 'active') throw fail('הישות המשפטית אינה פעילה', 409);
  return { property, entity };
}
export async function fiscalAudit({ propertyId, actor, action, entityId, after, reason }, session) {
  await AuditLog.create([{ property: propertyId, actor: actor.id, actorName: actor.name, action, entityType: 'Accounting', entityId, after, reason }], { session });
}
export async function emitAccountingEvent({ propertyId, legalEntity, eventKey, type, sourceId, payload, topics = ['accounting.review'] }, session) {
  const [event] = await AccountingEvent.create([{ property: propertyId, legalEntity, eventKey, type, sourceId: String(sourceId), payloadHash: payloadHash(payload), payload }], { session });
  await FiscalOutbox.create(topics.map((topic) => ({ property: propertyId, event: event._id, topic })), { session, ordered: true });
  return event;
}
export async function setupEntity({ propertyId, input, actor }) {
  return runFiscalTransaction(async (session) => {
    const p = await Property.findById(propertyId).session(session);
    if (!p) throw fail('הנכס לא נמצא', 404);
    if (p.legalEntity) return LegalEntity.findById(p.legalEntity).session(session);
    const details = { legalName: clean(input.legalName), taxId: clean(input.taxId), address: clean(input.address), city: clean(input.city) };
    if (!details.legalName || !/^\d{9}$/.test(details.taxId) || !details.address || !details.city) throw fail('נדרשים שם משפטי, מספר עוסק בן 9 ספרות, כתובת ועיר');
    // Tenant membership is derived from the authenticated property, never from request data.
    const [entity] = await LegalEntity.create([{ ...details, tenantKey: String(p._id), mode: 'shadow' }], { session });
    await IssuerProfile.create([{ legalEntity: entity._id, version: 1, ...details }], { session });
    const updated = await Property.updateOne({ _id: p._id, legalEntity: { $exists: false } }, { $set: { legalEntity: entity._id } }, { session });
    if (updated.modifiedCount !== 1) throw fail('שיוך הנכס השתנה; יש לרענן', 409);
    await ComplianceDecision.create(ACCOUNTING_RELEASE_GATES.map((g) => ({ legalEntity: entity._id, requirementId: g.id, recordedBy: actor.id })), { session, ordered: true });
    await fiscalAudit({ propertyId, actor, action: 'accounting.entity_created', entityId: entity._id, after: { mode: 'shadow' } }, session);
    return entity;
  });
}
export async function accountingOverview(propertyId) {
  const p = await Property.findById(propertyId).lean();
  if (!p) throw fail('הנכס לא נמצא', 404);
  const defaults = { legalName: p.legalName || p.name, taxId: p.taxNumber || '', address: p.address || '', city: p.city || '' };
  if (!p.legalEntity) return { entity: null, defaults, gates: ACCOUNTING_RELEASE_GATES.map((g) => ({ ...g, status: 'UNRESOLVED' })), accounts: [], periods: [], series: [], entries: [], outbox: { pending: 0, failed: 0 } };
  const { entity } = await entityContext(propertyId);
  const [decisions, accounts, periods, series, entries, pending, failed] = await Promise.all([
    ComplianceDecision.find({ legalEntity: entity._id }).lean(), Account.find({ legalEntity: entity._id }).sort({ code: 1 }).lean(),
    AccountingPeriod.find({ legalEntity: entity._id }).sort({ month: -1 }).limit(36).lean(),
    DocumentSeries.find({ legalEntity: entity._id, $or: [{ property: p._id }, { property: { $exists: false } }] }).lean(),
    JournalEntry.find({ legalEntity: entity._id, property: p._id }).sort({ postedAt: -1 }).limit(100).lean(),
    FiscalOutbox.countDocuments({ property: propertyId, state: { $in: ['pending', 'processing'] } }),
    FiscalOutbox.countDocuments({ property: propertyId, state: 'failed' }),
  ]);
  const today = todayYmdInTimezone(p.timezone);
  const gates = ACCOUNTING_RELEASE_GATES.map((g) => {
    const d = decisions.find((x) => x.requirementId === g.id);
    return { ...g, ...d, status: d?.reviewDue && d.reviewDue < today ? 'EXPIRED' : d?.validFrom && d.validFrom > today ? 'UNRESOLVED' : d?.status || 'UNRESOLVED' };
  });
  return { entity, defaults, gates, accounts, periods, series, entries, outbox: { pending, failed }, readyForLive: gates.every((g) => ['APPROVED', 'NOT_APPLICABLE'].includes(g.status)) };
}
export async function recordCompliance({ propertyId, input, actor }) {
  const { entity } = await entityContext(propertyId);
  if (!ACCOUNTING_RELEASE_GATES.some((g) => g.id === input.requirementId)) throw fail('מזהה שער לא מוכר');
  if (!['APPROVED', 'NOT_APPLICABLE', 'UNRESOLVED', 'EXPIRED'].includes(input.status)) throw fail('מצב החלטה לא תקין');
  const accepted = ['APPROVED', 'NOT_APPLICABLE'].includes(input.status);
  if (accepted && (!input.professionalName || !input.legalSource || !input.sourceVersion || !input.evidenceReference || !input.rationale)) throw fail('נדרשים שם בעל הסמכות, מקור, גרסה, אסמכתה ונימוק');
  if (accepted) { validDate(input.validFrom); validDate(input.reviewDue); if (input.reviewDue < input.validFrom) throw fail('מועד הבדיקה קודם לתחולה'); }
  const fields = Object.fromEntries(['status', 'legalSource', 'sourceVersion', 'evidenceReference', 'rationale', 'professionalName', 'validFrom', 'reviewDue'].map((k) => [k, clean(input[k], k === 'rationale' ? 1000 : 300)]));
  return runFiscalTransaction(async (session) => {
    const d = await ComplianceDecision.findOneAndUpdate({ legalEntity: entity._id, requirementId: input.requirementId }, { $set: { ...fields, recordedBy: actor.id } }, { returnDocument: 'after', runValidators: true, session });
    if (!d) throw fail('שער הציות לא אותחל עבור הישות', 409);
    await fiscalAudit({ propertyId, actor, action: 'accounting.compliance_recorded', entityId: entity._id, after: { requirementId: input.requirementId, ...fields } }, session);
    return d;
  });
}
const BASE_ACCOUNTS = [
  ['1000', 'מזומן', 'asset'], ['1100', 'בנק', 'asset'], ['1200', 'מעבר סליקה', 'asset'], ['1300', 'לקוחות ואורחים', 'asset'],
  ['1400', 'מע״מ תשומות', 'asset'], ['2000', 'ספקים', 'liability'], ['2100', 'מע״מ עסקאות', 'liability'],
  ['2200', 'מקדמות אורחים', 'liability'], ['2300', 'שוברי מתנה', 'liability'], ['3000', 'יתרות פתיחה', 'equity'],
  ['4000', 'הכנסה מחדרים', 'income'], ['4100', 'מזון ומשקאות', 'income'], ['4200', 'ספא', 'income'],
  ['5000', 'עמלות סליקה', 'expense'], ['5100', 'הפרשי שער', 'expense'],
];
export async function seedAccounts({ propertyId, actor }) {
  return runFiscalTransaction(async (session) => {
    const { entity } = await entityContext(propertyId, session);
    for (const [code, name, classification] of BASE_ACCOUNTS) await Account.updateOne({ legalEntity: entity._id, code }, { $setOnInsert: { name, classification } }, { upsert: true, session, runValidators: true });
    await fiscalAudit({ propertyId, actor, action: 'accounting.accounts_initialized', entityId: entity._id, after: { count: BASE_ACCOUNTS.length } }, session);
    return { count: BASE_ACCOUNTS.length };
  });
}
export async function createPeriod({ propertyId, month, actor }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw fail('חודש לא תקין');
  const { entity } = await entityContext(propertyId);
  return runFiscalTransaction(async (session) => {
    const period = await AccountingPeriod.findOneAndUpdate({ legalEntity: entity._id, month }, { $setOnInsert: { state: 'open' } }, { upsert: true, returnDocument: 'after', session, runValidators: true });
    if (period.state !== 'open') throw fail('התקופה כבר נעולה ואינה נפתחת מחדש', 409);
    await fiscalAudit({ propertyId, actor, action: 'accounting.period_opened', entityId: period._id, after: { month } }, session);
    return period;
  });
}
export async function postJournal({ propertyId, input, actor, reversalOf }) {
  const accountingDate = validDate(input.accountingDate);
  const sourceEventId = keyOf(input.sourceEventId);
  const checked = validateJournal(input.lines);
  const description = clean(input.description, 500);
  const hash = payloadHash({ accountingDate, description, reversalOf: reversalOf ? String(reversalOf) : undefined, ...checked });
  const work = async (session) => {
    const { entity } = await entityContext(propertyId, session);
    const existing = await JournalEntry.findOne({ legalEntity: entity._id, sourceEventId }).session(session);
    if (existing) {
      if (String(existing.property) !== String(propertyId) || existing.payloadHash !== hash) throw fail('מזהה הפעולה כבר שימש לתוכן אחר', 409);
      return { entry: existing, duplicate: true };
    }
    const period = await AccountingPeriod.findOneAndUpdate({ legalEntity: entity._id, month: accountingDate.slice(0, 7), state: 'open' }, { $inc: { writeVersion: 1 } }, { session });
    if (!period) throw fail('התקופה אינה פתוחה לרישום', 409);
    const codes = [...new Set(checked.lines.map((l) => l.accountCode))];
    const count = await Account.countDocuments({ legalEntity: entity._id, code: { $in: codes }, active: true }).session(session);
    if (count !== codes.length) throw fail('חשבון לא פעיל או לא שייך לישות');
    if (reversalOf && !await JournalEntry.exists({ _id: reversalOf, legalEntity: entity._id, property: propertyId }).session(session)) throw fail('פקודת מקור אינה שייכת לישות', 409);
    const [entry] = await JournalEntry.create([{ legalEntity: entity._id, property: propertyId, accountingDate, sourceEventId, payloadHash: hash, description, reversalOf, ...checked, postedBy: actor.id }], { session });
    await emitAccountingEvent({ propertyId, legalEntity: entity._id, eventKey: `journal:${sourceEventId}`, type: 'journal.posted', sourceId: entry._id, payload: { totalDebit: entry.totalDebit, totalCredit: entry.totalCredit }, topics: ['accounting.journal_posted'] }, session);
    await fiscalAudit({ propertyId, actor, action: 'accounting.journal_posted', entityId: entry._id, after: { sourceEventId, total: entry.totalDebit } }, session);
    return { entry, duplicate: false };
  };
  try { return await runFiscalTransaction(work); } catch (err) {
    // An uncertain result is resolved by reading the same operation, never by changing its key.
    if (err.code !== 11000) throw err;
    return runFiscalTransaction(work);
  }
}
export async function closePeriod({ propertyId, periodId, reason, actor }) {
  if (clean(reason).length < 3) throw fail('נדרש נימוק לסגירה');
  return runFiscalTransaction(async (session) => {
    const { entity } = await entityContext(propertyId, session);
    const linkedProperties = await Property.countDocuments({ legalEntity: entity._id }).session(session);
    if (linkedProperties > 1 && !['super_admin', 'chain_admin'].includes(actor.role)) throw fail('סגירת תקופה משותפת מחייבת מנהל רשת', 403);
    const period = await AccountingPeriod.findOneAndUpdate({ _id: periodId, legalEntity: entity._id, state: 'open' }, { $set: { state: 'locked', closedBy: actor.id, closedAt: new Date(), closeReason: clean(reason, 500) }, $inc: { writeVersion: 1 } }, { returnDocument: 'after', session });
    if (!period) throw fail('התקופה כבר נעולה או לא נמצאה', 409);
    await fiscalAudit({ propertyId, actor, action: 'accounting.period_locked', entityId: period._id, reason, after: { month: period.month } }, session);
    return period;
  });
}
export async function reverseJournal({ propertyId, id, input, actor }) {
  const { entity } = await entityContext(propertyId);
  const original = await JournalEntry.findOne({ _id: id, legalEntity: entity._id, property: propertyId }).lean();
  if (!original) throw fail('פקודת המקור לא נמצאה', 404);
  if (clean(input.reason).length < 3) throw fail('נדרשת סיבת היפוך');
  // Deterministic source key allows only one full reversal per original.
  return postJournal({ propertyId, actor, reversalOf: original._id, input: { accountingDate: input.accountingDate, sourceEventId: `reverse:${original._id}`, description: `היפוך — ${clean(input.reason)}: ${original.description || 'פקודת יומן'}`, lines: original.lines.map((l) => ({ accountCode: l.accountCode, debit: l.credit, credit: l.debit, description: l.description })) } });
}
export async function trialBalance({ propertyId, from, to }) {
  validDate(from); validDate(to); if (from > to) throw fail('טווח תאריכים לא תקין');
  const { entity } = await entityContext(propertyId);
  const rows = await JournalEntry.find({ legalEntity: entity._id, property: propertyId, accountingDate: { $gte: from, $lte: to } }).select('lines').lean();
  const accounts = await Account.find({ legalEntity: entity._id }).lean();
  const totals = new Map(accounts.map((a) => [a.code, { code: a.code, name: a.name, classification: a.classification, debit: 0n, credit: 0n }]));
  let debit = 0n, credit = 0n;
  for (const entry of rows) for (const line of entry.lines) {
    const row = totals.get(line.accountCode); if (!row) throw fail('חשבון חסר בספר', 409);
    row.debit += minor(line.debit); row.credit += minor(line.credit); debit += minor(line.debit); credit += minor(line.credit);
  }
  return { from, to, currency: entity.currency, mode: entity.mode, entryCount: rows.length, totalDebit: amount(debit), totalCredit: amount(credit), balanced: debit === credit, rows: [...totals.values()].map((r) => ({ ...r, debit: amount(r.debit), credit: amount(r.credit), balance: amount(r.debit - r.credit) })) };
}
export async function createSeries({ propertyId, input, actor }) {
  const { entity } = await entityContext(propertyId);
  if (!['tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_note', 'debit_note', 'proforma'].includes(input.documentType)) throw fail('סוג מסמך לא תקין');
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(input.code || '') || !/^[A-Za-z0-9_-]{0,20}$/.test(input.prefix || '') || !Number.isSafeInteger(input.firstNumber) || input.firstNumber < 1) throw fail('קוד סדרה או מספר התחלה לא תקינים');
  if (!clean(input.approvalReference)) throw fail('נדרשת אסמכתה למדיניות המספור');
  return runFiscalTransaction(async (session) => {
    const [series] = await DocumentSeries.create([{ legalEntity: entity._id, property: propertyId, code: input.code, prefix: input.prefix || '', documentType: input.documentType, lastNumber: input.firstNumber - 1, approvalReference: clean(input.approvalReference), active: false }], { session });
    await fiscalAudit({ propertyId, actor, action: 'accounting.series_created', entityId: series._id, after: { code: series.code, firstNumber: input.firstNumber, active: false } }, session);
    return series;
  });
}
export async function createTaxRule({ propertyId, input, actor }) {
  const { entity, property } = await entityContext(propertyId);
  validDate(input.validFrom); if (input.validTo) { validDate(input.validTo); if (input.validTo < input.validFrom) throw fail('טווח תחולה לא תקין'); }
  const rate = decimal(input.rate);
  if (rate.n < 0n || rate.n > 100n * rate.d || !['standard', 'zero', 'exempt', 'outside_scope'].includes(input.classification) || (input.classification !== 'standard' && rate.n !== 0n)) throw fail('סיווג או שיעור מס לא תקינים');
  const decision = await ComplianceDecision.findOne({ _id: input.decisionId, legalEntity: entity._id, status: 'APPROVED' }).lean();
  const today = todayYmdInTimezone(property.timezone);
  if (!decision || !['TAX_TIMING', 'TOURIST_TAX'].includes(decision.requirementId) || !decision.validFrom || decision.validFrom > today || !decision.reviewDue || decision.reviewDue < today) throw fail('כלל מס מחייב החלטת ציות בנושא מס מאושרת ובתוקף', 409);
  for (const field of ['code', 'version', 'serviceCategory', 'customerClassification']) if (!clean(input[field])) throw fail('חסרים פרטי כלל מס');
  return runFiscalTransaction(async (session) => {
    const [rule] = await TaxRule.create([{ legalEntity: entity._id, code: clean(input.code), version: clean(input.version), classification: input.classification, rate: String(input.rate), validFrom: input.validFrom, validTo: input.validTo || undefined, serviceCategory: clean(input.serviceCategory), customerClassification: clean(input.customerClassification), decision: decision._id, evidencePolicy: clean(input.evidencePolicy), roundingPolicy: ROUNDING_POLICY }], { session });
    await fiscalAudit({ propertyId, actor, action: 'accounting.tax_rule_created', entityId: rule._id, after: { code: rule.code, version: rule.version } }, session);
    return rule;
  });
}

// Preview/validation only: no passport-country shortcut, implicit default rate or ambiguous match.
export async function resolveTaxRule({ propertyId, input }) {
  const date = validDate(input.serviceDate);
  const { entity, property } = await entityContext(propertyId);
  const rules = await TaxRule.find({ legalEntity: entity._id, code: clean(input.code), serviceCategory: clean(input.serviceCategory), customerClassification: clean(input.customerClassification), validFrom: { $lte: date }, $or: [{ validTo: { $exists: false } }, { validTo: { $gte: date } }] }).lean();
  if (rules.length !== 1) throw fail(rules.length ? 'יותר מכלל מס אחד חל על השירות; נדרשת הכרעה' : 'אין כלל מס מאושר המתאים לשירות', 409);
  const rule = rules[0];
  const today = todayYmdInTimezone(property.timezone);
  const decision = await ComplianceDecision.findOne({ _id: rule.decision, legalEntity: entity._id, status: 'APPROVED', validFrom: { $lte: today }, reviewDue: { $gte: today } }).lean();
  if (!decision) throw fail('האישור המקצועי לכלל המס אינו בתוקף', 409);
  const evidence = Array.isArray(input.evidenceReferences) ? input.evidenceReferences.map((r) => clean(r)).filter(Boolean) : [];
  if (rule.evidencePolicy && !evidence.length) throw fail('כלל המס מחייב הפניה לראיות זכאות', 409);
  return { ruleId: String(rule._id), code: rule.code, version: rule.version, classification: rule.classification, ratePercent: rule.rate, roundingPolicy: rule.roundingPolicy, serviceDate: date, decisionId: String(decision._id), evidenceReferences: evidence };
}
