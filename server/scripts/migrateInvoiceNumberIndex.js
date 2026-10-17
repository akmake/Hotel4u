// One-off migration for document series (FIN-06):
//  1. drop the old *global* unique index on invoices.invoiceNumber — numbers are now unique per
//     property + document type, so a second property (or a second type) may also have "1";
//  2. move legacy status 'pending_allocation' to status 'issued' + allocationStatus 'pending'
//     (a document waiting for its allocation number is still a final, locked document).
// Safe to run more than once.  Usage (from server/):  node scripts/migrateInvoiceNumberIndex.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
const coll = Invoice.collection;

const legacy = (await coll.indexes()).find((i) => i.name === 'invoiceNumber_1');
if (legacy) {
  await coll.dropIndex('invoiceNumber_1');
  console.log('Dropped legacy global unique index invoiceNumber_1');
}
await Invoice.createIndexes();

const moved = await coll.updateMany({ status: 'pending_allocation' }, { $set: { status: 'issued', allocationStatus: 'pending', requiresAllocation: true } });
const approved = await coll.updateMany({ allocationNumber: { $type: 'string', $ne: '' }, allocationStatus: { $exists: false } }, { $set: { allocationStatus: 'approved' } });
console.log(`pending_allocation → issued+pending: ${moved.modifiedCount}; existing numbers marked approved: ${approved.modifiedCount}`);
console.log('Indexes:', (await coll.indexes()).map((i) => i.name).join(', '));

await mongoose.disconnect();
