import { isDeepStrictEqual } from 'node:util';
import Property from '../models/Property.js';
import OperationLock from '../models/OperationLock.js';
import { openBusinessDate } from '../utils/businessDate.js';
import { ymdInTimezone } from '../utils/dateHelpers.js';

const error = (message, code, status = 409) => Object.assign(new Error(message), { status, code });
const plain = (value) => JSON.parse(JSON.stringify(value?.toObject ? value.toObject() : value));
export async function guardFinancialSave(doc) {
  if (!doc.isModified('lines') && !doc.isModified('property') && !doc.isNew) return;
  if (!doc.lines?.length && doc.isNew) return;
  if (!doc.isNew && doc.isModified('property')) throw error('אין להעביר חשבון בין נכסים', 'closed_business_day');
  const session = doc.$session();
  const property = await Property.findById(doc.property).session(session).select('timezone dayClose').lean();
  if (!property) throw error('הנכס לא נמצא', 'property_not_found', 404);
  const managed = !!property.dayClose?.businessDate;
  const closing = await OperationLock.exists({ key: `dayclose:${doc.property}`, expiresAt: { $gt: new Date() } }).session(session);
  if (closing && !session?.financialDayCloseLease) throw error('סגירת היום מתבצעת — יש לנסות שוב לאחר סיומה', 'business_day_closing');
  if (!session) {
    if (managed) throw error('רישום כספי ביום מנוהל מחייב שמירה אטומית', 'FINANCIAL_TRANSACTIONS_REQUIRED', 503);
    return; // Existing unactivated installations/legacy imports retain their old format.
  }
  // The owning transaction fences this lease immediately before commit. Do not take its
  // write lock here: an early fence would prevent a later expiry/takeover from being observed.
  const previous = doc.isNew ? null : await doc.constructor.findById(doc._id).session(session).select('property lines').lean();
  if (previous && String(previous.property) !== String(doc.property)) throw error('אין להעביר חשבון בין נכסים', 'closed_business_day');
  const oldById = new Map((previous?.lines || []).map((l) => [String(l._id), l]));
  const newById = new Map(doc.lines.map((l) => [String(l._id), l]));
  if (newById.size !== doc.lines.length) throw error('מזהה שורה כספית כפול אינו מותר', 'financial_query_write_forbidden');
  const lastClosed = property.dayClose?.lastClosedDate;
  for (const old of previous?.lines || []) {
    const date = old.accountingDate || (managed && lastClosed ? lastClosed : ymdInTimezone(old.postedAt || new Date(0), property.timezone));
    if (lastClosed && date <= lastClosed && (!newById.has(String(old._id)) || !isDeepStrictEqual(plain(old), plain(newById.get(String(old._id)))))) throw error('אין לשנות שורה מיום סגור — יש לרשום תיקון ביום פתוח', 'closed_business_day');
  }
  const open = openBusinessDate(property);
  const expected = session.financialPostingDate || open;
  if (lastClosed && expected <= lastClosed) throw error('היום העסקי כבר נסגר', 'closed_business_day');
  for (const row of doc.lines) {
    if (oldById.has(String(row._id))) continue;
    if (row.accountingDate && row.accountingDate !== expected) throw error('יום הרישום חייב להיות היום העסקי הפתוח', 'closed_business_day');
    row.accountingDate = expected;
  }
  // A day close writes the same document at entry and completion: concurrent writers conflict
  // and retry against the new lock/date instead of committing a late line to the old day.
  await Property.updateOne({ _id: doc.property }, { $inc: { 'dayClose.writeVersion': 1 } }, { session });
}

export async function guardFinancialQuery() {
  const update = this.getUpdate?.() || {};
  const destructive = ['replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'].includes(this.op);
  const financialPath = (p) => p === 'lines' || p.startsWith('lines.') || p === 'property';
  const touches = destructive || Array.isArray(update) || Object.entries(update).some(([key, value]) => financialPath(key) || (value && typeof value === 'object' && (Object.keys(value).some(financialPath) || (key === '$rename' && Object.values(value).some((p) => typeof p === 'string' && financialPath(p))))));
  if (!touches) return;
  if (this.getOptions().upsert) throw error('אין ליצור שורות כספיות באמצעות upsert — יש לשמור חשבון אטומי', 'financial_query_write_forbidden');
  const docs = await this.model.find(this.getFilter()).session(this.getOptions().session || null).select('property').lean();
  const candidates = [...docs.map((d) => d.property), this.getFilter().property, update.property, update.$set?.property, update.$setOnInsert?.property].filter((v) => typeof v === 'string' || v?._bsontype === 'ObjectId');
  if (await Property.exists({ _id: { $in: candidates }, 'dayClose.businessDate': { $exists: true } }).session(this.getOptions().session || null)) throw error('עדכון שורות כספיות נעשה דרך שמירת חשבון אטומית בלבד', 'financial_query_write_forbidden');
}
