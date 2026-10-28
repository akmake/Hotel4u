import mongoose from 'mongoose';
import Property from '../models/Property.js';
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import DayCloseRun from '../models/DayCloseRun.js';
import OperationLock from '../models/OperationLock.js';
import BusinessDayMigration from '../models/BusinessDayMigration.js';
import { payloadHash } from '../domain/accounting.js';
import { minor, amount } from '../domain/money.js';
import { todayYmdInTimezone } from '../utils/dateHelpers.js';
import { nextBusinessDate } from '../utils/businessDate.js';
import { resolverForSnapshot } from './ledgerService.js';
import { withLocks } from './locks.js';
import { runStayTransaction } from './stayTransaction.js';
import { audit } from './auditService.js';

export const MIGRATION_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'finance_manager'];
export const MIGRATION_LIMITS = { folios: 250, lines: 5000, bytes: 8 * 1024 * 1024, runs: 5000 };
const error = (message, code, status = 409, details) => Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
const serial = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => payloadHash(serial(value));
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function authorize(propertyId, actor) {
  if (!mongoose.isValidObjectId(propertyId)) throw error('מזהה נכס לא תקין', 'invalid_property', 400);
  if (!actor?.id || !MIGRATION_ROLES.includes(actor.role)) throw error('הפעלת יום עסקי מותרת להנהלה או לכספים', 'migration_forbidden', 403);
  if (actor.propertyId && String(actor.propertyId) !== String(propertyId) && !['super_admin', 'chain_admin'].includes(actor.role)) throw error('הנכס אינו בתחום ההרשאה', 'migration_forbidden', 403);
}
async function migrationKeys(propertyId) {
  const folios = await Folio.find({ property: propertyId }).select('reservation').limit(MIGRATION_LIMITS.folios + 1).lean();
  const reservations = await Reservation.find({ _id: { $in: folios.map((f) => f.reservation) }, property: propertyId }).select('_id').lean();
  return [`dayclose:${propertyId}`, ...reservations.map((r) => `res:${r._id}`)];
}
async function snapshot(propertyId, session) {
  const property = await Property.findById(propertyId).session(session).select('timezone defaultCurrency dayClose').lean();
  if (!property) throw error('הנכס לא נמצא', 'property_not_found', 404);
  const [size = {}] = await Folio.aggregate([{ $match: { property: property._id } }, { $group: { _id: null, folios: { $sum: 1 }, lines: { $sum: { $size: { $ifNull: ['$lines', []] } } }, bytes: { $sum: { $bsonSize: '$$ROOT' } } } }]).session(session);
  const runCount = await DayCloseRun.countDocuments({ property: propertyId }).session(session);
  const limited = (size.folios || 0) > MIGRATION_LIMITS.folios || (size.lines || 0) > MIGRATION_LIMITS.lines || (size.bytes || 0) > MIGRATION_LIMITS.bytes || runCount > MIGRATION_LIMITS.runs;
  if (limited) return { property, size, limited: true, folios: [], runs: [], reservations: [] };
  const folios = await Folio.find({ property: propertyId }).session(session).sort({ _id: 1 }).lean();
  const runs = await DayCloseRun.find({ property: propertyId }).session(session).sort({ businessDate: 1, _id: 1 }).select('businessDate status finishedAt updatedAt steps.key steps.status steps.result.trial').lean();
  const reservations = await Reservation.find({ _id: { $in: folios.map((f) => f.reservation) }, property: propertyId }).session(session).sort({ _id: 1 }).select('property status').lean();
  return { property, size, limited: false, folios, runs, reservations };
}
const sourceFingerprint = (s) => hash({ property: s.property, folios: s.folios, runs: s.runs, reservations: s.reservations });
const financialHash = (folios) => hash(folios.map(({ updatedAt, __v, ...f }) => ({ ...f, lines: (f.lines || []).map(({ accountingDate, ...line }) => line) })));
function exactMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) throw new Error('invalid');
  const cents = minor(value);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('unsafe_money');
  if (Number(amount(cents)) !== Number(value)) throw new Error('precision');
  return cents;
}
function trialFor(rows, date) {
  let opening = 0n, closing = 0n, charges = 0n, adjustments = 0n, payments = 0n, refunds = 0n;
  for (const r of rows) {
    if (r.status !== 'posted') continue;
    if (r.date < date) opening += r.gross;
    if (r.date <= date) closing += r.gross;
    if (r.date !== date) continue;
    if (['charge', 'fee', 'tax'].includes(r.type)) charges += r.gross;
    else if (['adjustment', 'discount'].includes(r.type)) adjustments += r.gross;
    else if (['payment', 'deposit'].includes(r.type)) payments -= r.gross;
    else if (r.type === 'refund') refunds += r.gross;
  }
  return Object.fromEntries(Object.entries({ opening, closing, charges, adjustments, payments, refunds, difference: closing - (opening + charges + adjustments - payments + refunds) }).map(([key, value]) => [key, amount(value)]));
}

async function inspect(propertyId, session, { ownedLock = false, targetDate } = {}) {
  const s = await snapshot(propertyId, session), blockers = [], warnings = [], checks = [], changes = [], rows = [];
  let blockerCount = 0;
  const add = (code, message, ref) => { blockerCount += 1; if (blockers.length < 100) blockers.push({ code, message, ...(ref ? { ref } : {}) }); };
  const p = s.property;
  let calendar;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: p.timezone || 'Asia/Jerusalem' }).format(new Date()); calendar = todayYmdInTimezone(p.timezone || 'Asia/Jerusalem'); }
  catch { add('invalid_timezone', 'אזור הזמן של הנכס אינו תקין'); }
  if (s.limited) add('migration_too_large', 'נדרש מעבר מתוכנן בקבוצות; הנתונים חורגים מגבול הפעולה האטומית');
  if (!ownedLock && await OperationLock.exists({ key: `dayclose:${propertyId}`, expiresAt: { $gt: new Date() } }).session(session)) add('business_day_busy', 'פעולה כספית או סגירה מתבצעות כעת בנכס');
  if (p.dayClose?.businessDate) add('already_managed', 'הנכס כבר משתמש ביום עסקי מנוהל');
  const done = s.runs.filter((r) => r.status === 'done');
  if (s.runs.some((r) => r.status !== 'done')) add('unfinished_day_close', 'קיימת ריצת סגירה שטרם הושלמה; יש להשלים או לברר אותה לפני המעבר');
  const last = p.dayClose?.lastClosedDate || null;
  if (last && !isDate(last)) add('invalid_last_closed_date', 'תאריך הסגירה האחרון בנכס אינו תקין');
  if ((done.at(-1)?.businessDate || null) !== last) add('close_pointer_mismatch', 'תאריך הנכס אינו תואם לריצת הסגירה האחרונה');
  if (p.dayClose?.lastRunId && String(p.dayClose.lastRunId) !== String(done.at(-1)?._id)) add('close_pointer_mismatch', 'מזהה ריצת הסגירה בנכס אינו תואם להיסטוריה');
  const openDate = isDate(last) ? nextBusinessDate(last) : calendar;
  if (targetDate && targetDate !== openDate) add('target_date_mismatch', 'יום היעד חייב להיות היום הראשון לאחר הסגירה האחרונה');
  if (openDate && calendar && openDate > nextBusinessDate(calendar)) add('future_business_date', 'יום היעד מתקדם מעבר ליום הבא בלוח השנה');
  if (openDate && calendar && openDate < calendar) warnings.push({ code: 'calendar_backlog', message: 'היום העסקי המוצע מוקדם מלוח השנה; נדרשת השלמת פיגור בסגירות' });
  let previousDay = null, previousTime = null;
  for (const run of done) {
    const time = new Date(run.finishedAt || 0).getTime();
    if (!isDate(run.businessDate) || !run.finishedAt || !Number.isFinite(time) || time > Date.now()) { add('invalid_close_history', 'תאריך או מועד סיום של סגירה אינם תקינים', String(run._id)); continue; }
    if (previousDay && nextBusinessDate(previousDay) !== run.businessDate) add('close_history_gap', 'היסטוריית הסגירות אינה רציפה', run.businessDate);
    if (previousTime != null && time <= previousTime) add('close_time_order', 'סדר מועדי סיום הסגירות אינו חד משמעי', run.businessDate);
    if (!(run.steps || []).length || run.steps.some((step) => !['done', 'skipped'].includes(step.status))) add('unfinished_close_steps', 'ריצה סומנה כמושלמת אך כוללת שלבים שלא הושלמו', run.businessDate);
    if (!(run.steps || []).some((step) => step.key === 'advance' && step.status === 'done')) add('missing_advance_evidence', 'אין ראיה להשלמת קידום היום בריצה', run.businessDate);
    if (!(run.steps || []).some((step) => step.key === 'ledgers' && step.status === 'done' && step.result?.trial)) add('missing_ledger_evidence', 'אין מאזן שמור שמאפשר לאמת את הסגירה', run.businessDate);
    previousDay = run.businessDate; previousTime = time;
  }
  const resById = new Map(s.reservations.map((r) => [String(r._id), r]));
  let resolve;
  try { resolve = resolverForSnapshot(p, done).resolve; } catch { add('invalid_close_history', 'לא ניתן לפענח את היסטוריית התאריכים'); }
  for (const f of s.folios) {
    if ((f.currency || 'ILS') !== (p.defaultCurrency || 'ILS')) add('currency_mismatch', 'מטבע החשבון אינו תואם למטבע הנכס; נדרשת התאמה נפרדת', String(f._id));
    const res = resById.get(String(f.reservation));
    if (!res || String(res.property) !== String(propertyId)) add('foreign_or_missing_reservation', 'חשבון מקושר להזמנה חסרה או לנכס אחר', String(f._id));
    const ids = new Set();
    for (const [index, row] of (f.lines || []).entries()) {
      const ref = `${f._id}:${row._id}`;
      if (!row._id || ids.has(String(row._id))) { add('duplicate_line_id', 'מזהה שורה חסר או כפול בחשבון', ref); continue; } ids.add(String(row._id));
      if (!isDate(row.serviceDate) || !row.postedAt || !Number.isFinite(new Date(row.postedAt).getTime()) || new Date(row.postedAt).getTime() > Date.now()) { add('invalid_line_dates', 'מועד השירות או זמן הרישום בשורה אינם תקינים', ref); continue; }
      let gross;
      try { gross = exactMoney(row.amount) + exactMoney(row.taxAmount ?? 0); } catch { add('invalid_money', 'סכום חסר או דיוק כספי שאינו ניתן להעברה ללא תיקון', ref); continue; }
      if (!['posted', 'voided', 'refunded', 'adjusted'].includes(row.status) || !['charge', 'fee', 'tax', 'adjustment', 'discount', 'payment', 'deposit', 'refund'].includes(row.type)) { add('invalid_line_state', 'מצב או סוג שורה לא מוכרים', ref); continue; }
      if ((['payment', 'deposit'].includes(row.type) && gross > 0n) || (row.type === 'refund' && gross < 0n) || (['charge', 'fee'].includes(row.type) && gross < 0n)) { add('invalid_money_direction', 'סימן הסכום אינו תואם לסוג התנועה; אין לתקן אותו אוטומטית במעבר', ref); continue; }
      if (row.accountingDate && !isDate(row.accountingDate)) { add('invalid_accounting_date', 'יום הרישום המפורש אינו תקין', ref); continue; }
      if (!row.accountingDate && row.source === 'night_audit' && !done.some((r) => new Date(r.finishedAt).getTime() >= new Date(row.postedAt).getTime())) { add('unmatched_night_audit', 'חיוב לילה אינו מקושר לסגירה שהושלמה; אין לנחש את יומו', ref); continue; }
      let date;
      try { date = resolve?.(row); } catch { /* handled below */ }
      if (!isDate(date) || (openDate && date > openDate)) { add('line_after_target', 'יום הרישום של שורה אינו ניתן לשיוך ליום היעד', ref); continue; }
      rows.push({ date, gross, status: row.status, type: row.type });
      if (!Object.hasOwn(row, 'accountingDate')) changes.push({ folio: f._id, line: row._id, index, accountingDate: date });
      else if (!row.accountingDate) add('empty_accounting_date', 'שדה יום רישום ריק דורש בירור במקום הנחה שהוא חסר', ref);
    }
  }
  for (const run of done) {
    const stored = run.steps.find((step) => step.key === 'ledgers')?.result?.trial;
    if (!stored) continue;
    const actual = trialFor(rows, run.businessDate);
    let matches = true;
    try { matches = Object.keys(actual).every((key) => exactMoney(stored[key]) === minor(actual[key])); } catch { matches = false; }
    checks.push({ date: run.businessDate, matches, actual, stored });
    if (!matches) add('closed_trial_mismatch', 'המאזן החי אינו תואם למאזן שנשמר בסגירה', run.businessDate);
  }
  const fingerprint = sourceFingerprint(s);
  const planHash = hash({ version: 1, propertyId: String(propertyId), fingerprint, calendar, targetDate: openDate, requestedTargetDate: targetDate || openDate, changes });
  // Report totals without guest names, descriptions or document identity data.
  let total = 0n; for (const f of s.folios) for (const row of f.lines || []) if (row.status === 'posted') { try { total += exactMoney(row.amount) + exactMoney(row.taxAmount ?? 0); } catch { /* blocker already recorded */ } }
  const plan = { version: 1, propertyId: String(propertyId), calendarDate: calendar, targetDate: openDate, ready: blockers.length === 0, planHash, sourceFingerprint: fingerprint, financialHash: financialHash(s.folios), blockers, blockerCount, blockersTruncated: blockerCount > blockers.length, warnings, checks, limits: { ...MIGRATION_LIMITS }, totals: { folios: s.size.folios || 0, lines: s.size.lines || 0, sourceBytes: s.size.bytes || 0, missingAccountingDates: changes.length, postedBalance: amount(total) }, changes: serial(changes), rollbackPolicy: 'ניתן לבטל רק לפני פעילות או שינוי נוסף בנתונים. הפניה לגיבוי היא הצהרת מפעיל ואינה הוכחה שהגיבוי ניתן לשחזור.' };
  return { plan, source: s, changes };
}

export async function previewBusinessDayMigration({ propertyId, actor, targetDate }) {
  authorize(propertyId, actor);
  const session = await mongoose.startSession();
  try { return await session.withTransaction(async () => (await inspect(propertyId, session, { targetDate })).plan, { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); }
  catch (e) {
    if (e?.code === 20 || String(e?.message || '').includes('Transaction numbers are only allowed')) throw error('דוח מעבר עקבי מחייב מסד עם תמיכה בעסקאות', 'MIGRATION_TRANSACTIONS_REQUIRED', 503);
    throw e;
  }
  finally { await session.endSession(); }
}

export async function applyBusinessDayMigration({ propertyId, actor, input = {}, ip }) {
  authorize(propertyId, actor);
  const requestKey = String(input.requestKey || '').trim(), reason = String(input.reason || '').trim().slice(0, 300), backupReference = String(input.backupReference || '').trim().slice(0, 300);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestKey) || !/^[a-f0-9]{64}$/.test(input.planHash || '') || reason.length < 3 || backupReference.length < 3) throw error('נדרשים דוח התאמה מזוהה, סיבה והפניה לגיבוי', 'migration_input_required', 422);
  const requestHash = hash({ planHash: input.planHash, targetDate: input.targetDate || null, reason, backupReference });
  const keys = await migrationKeys(propertyId);
  return withLocks(keys, (lease) => runStayTransaction(async (session, afterCommit) => {
    const old = await BusinessDayMigration.findOne({ property: propertyId, requestKey }).session(session).lean();
    if (old) {
      if (old.requestHash !== requestHash) throw error('מזהה הפעולה כבר שימש לתוכן אחר', 'migration_key_conflict');
      if (old.status !== 'applied') throw error('ההפעלה כבר בוטלה; נדרש דוח ופעולה חדשים', 'migration_rolled_back');
      return { ...old.result, duplicate: true };
    }
    const { plan, source, changes } = await inspect(propertyId, session, { ownedLock: true, targetDate: input.targetDate });
    if (plan.planHash !== input.planHash) throw error('הנתונים השתנו מאז הדוח — יש להפיק דוח חדש', 'migration_plan_stale');
    if (!plan.ready) throw error('המעבר חסום עד לבירור הפערים בדוח', 'migration_blocked', 409, plan.blockers);
    const migrationId = new mongoose.Types.ObjectId(), folioBackups = [], now = new Date();
    for (const f of source.folios) {
      const mine = changes.filter((c) => String(c.folio) === String(f._id));
      folioBackups.push({ folio: f._id, version: f.__v, hadVersion: Object.hasOwn(f, '__v'), updatedAt: f.updatedAt, hadUpdatedAt: Object.hasOwn(f, 'updatedAt') });
      const set = Object.fromEntries(mine.map((c) => [`lines.${c.index}.accountingDate`, c.accountingDate]));
      // Narrow, journalled raw write: only dates/version/timestamp change. Every folio is fenced,
      // including one with no missing dates, so a parallel metadata writer cannot escape the hash.
      const out = await Folio.collection.updateOne({ _id: f._id }, { $set: { ...set, updatedAt: now }, $inc: { __v: 1 } }, { session });
      if (out.matchedCount !== 1) throw error('חשבון השתנה בזמן ההפעלה', 'migration_plan_stale');
    }
    await Property.updateOne({ _id: propertyId }, { $set: { 'dayClose.businessDate': plan.targetDate, 'dayClose.migrationId': migrationId }, $inc: { 'dayClose.writeVersion': 1 } }, { session });
    const after = await snapshot(propertyId, session);
    if (financialHash(after.folios) !== plan.financialHash) throw error('סכומים או שדות מקור השתנו במעבר', 'migration_financial_mismatch');
    const afterFingerprint = sourceFingerprint(after);
    const result = { migrationId: String(migrationId), propertyId: String(propertyId), status: 'applied', businessDate: plan.targetDate, changedLines: changes.length, sourceFingerprint: plan.sourceFingerprint, afterFingerprint, financialHash: plan.financialHash };
    await BusinessDayMigration.create([{ _id: migrationId, property: propertyId, requestKey, requestHash, status: 'applied', targetDate: plan.targetDate, sourceFingerprint: plan.sourceFingerprint, afterFingerprint, financialHash: plan.financialHash, originalDayClose: source.property.dayClose, hadDayClose: Object.hasOwn(source.property, 'dayClose'), folios: folioBackups, changes, backupReference, reason, appliedBy: actor.id, appliedByName: actor.name, result }], { session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'business_day.migration_applied', entityType: 'BusinessDayMigration', entityId: migrationId, before: { sourceFingerprint: plan.sourceFingerprint }, after: result, reason, ip, session, afterCommit });
    return result;
  }, lease, { operation: 'הפעלת יום עסקי' }), { waitMs: 4000 });
}

export async function rollbackBusinessDayMigration({ propertyId, migrationId, actor, input = {}, ip }) {
  authorize(propertyId, actor);
  if (!mongoose.isValidObjectId(migrationId)) throw error('מזהה מעבר לא תקין', 'invalid_migration', 400);
  const reason = String(input.reason || '').trim().slice(0, 300);
  if (reason.length < 3 || !/^[a-f0-9]{64}$/.test(input.expectedFingerprint || '')) throw error('נדרשות סיבה וטביעת המצב שלאחר ההפעלה', 'rollback_input_required', 422);
  const rollbackHash = hash({ reason, expectedFingerprint: input.expectedFingerprint });
  const keys = await migrationKeys(propertyId);
  return withLocks(keys, (lease) => runStayTransaction(async (session, afterCommit) => {
    const journal = await BusinessDayMigration.findOne({ _id: migrationId, property: propertyId }).session(session);
    if (!journal) throw error('המעבר לא נמצא בנכס', 'migration_not_found', 404);
    if (journal.status === 'rolled_back') {
      if (journal.rollbackHash !== rollbackHash) throw error('המעבר כבר בוטל בבקשה אחרת', 'rollback_key_conflict');
      return { migrationId: String(journal._id), status: 'rolled_back', duplicate: true };
    }
    const current = await snapshot(propertyId, session);
    if (input.expectedFingerprint !== journal.afterFingerprint || sourceFingerprint(current) !== journal.afterFingerprint) throw error('הנתונים השתנו מאז ההפעלה — ביטול אוטומטי אינו מותר', 'rollback_has_activity');
    for (const backup of journal.folios) {
      const mine = journal.changes.filter((c) => String(c.folio) === String(backup.folio));
      const unset = Object.fromEntries(mine.map((c) => [`lines.${c.index}.accountingDate`, '']));
      const set = {};
      if (backup.hadVersion) set.__v = backup.version; else unset.__v = '';
      if (backup.hadUpdatedAt) set.updatedAt = backup.updatedAt; else unset.updatedAt = '';
      await Folio.collection.updateOne({ _id: backup.folio }, { ...(Object.keys(set).length ? { $set: set } : {}), $unset: unset }, { session });
    }
    await Property.updateOne({ _id: propertyId }, journal.hadDayClose ? { $set: { dayClose: journal.originalDayClose } } : { $unset: { dayClose: '' } }, { session });
    const restored = await snapshot(propertyId, session);
    if (sourceFingerprint(restored) !== journal.sourceFingerprint || financialHash(restored.folios) !== journal.financialHash) throw error('השחזור אינו תואם למצב המקורי', 'rollback_fingerprint_mismatch');
    journal.status = 'rolled_back'; journal.rollbackHash = rollbackHash; journal.rollbackReason = reason; journal.rolledBackAt = new Date(); journal.rolledBackBy = actor.id; await journal.save({ session });
    await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'business_day.migration_rolled_back', entityType: 'BusinessDayMigration', entityId: journal._id, after: { sourceFingerprint: journal.sourceFingerprint }, reason, ip, session, afterCommit });
    return { migrationId: String(journal._id), status: 'rolled_back', sourceFingerprint: journal.sourceFingerprint };
  }, lease, { operation: 'ביטול הפעלת יום עסקי' }), { waitMs: 4000 });
}
