import mongoose from 'mongoose';
import Property from '../models/Property.js';
import Invoice from '../models/Invoice.js';
import { AccountingEvent, FiscalOutbox, DocumentArtifact } from '../models/Accounting.js';

// QA fixture deletion only. Production models intentionally forbid deleting issued documents.
export async function removeFiscalTestFixtures(propertyIds, tag) {
  if (!propertyIds.length) return;
  if (!/^[A-Z0-9]{6,}$/.test(tag || '')) throw new Error('Refusing fiscal fixture cleanup without a unique QA tag');
  const ids = [...new Set(propertyIds.map(String))].map((id) => new mongoose.Types.ObjectId(id));
  const properties = await Property.find({ _id: { $in: ids } }).select('name').lean();
  if (properties.length !== ids.length || properties.some((p) => !p.name.includes(tag))) throw new Error('Refusing cleanup: properties do not all belong to this QA run');
  for (const Model of [Invoice, FiscalOutbox, DocumentArtifact, AccountingEvent]) await Model.collection.deleteMany({ property: { $in: ids } });
}
