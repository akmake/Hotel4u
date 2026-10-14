// One-off migration: replace the old compound *sparse* unique index on
// reservations { property, idempotencyKey } with a *partial* unique index.
// The sparse version indexes every reservation that has `property`, so the second
// reservation created without an idempotencyKey fails with E11000 (dup key null).
// Safe to run more than once.  Usage (from server/):  node scripts/migrateReservationIdempotencyIndex.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Reservation from '../models/Reservation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const INDEX_NAME = 'property_1_idempotencyKey_1';

await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
const coll = Reservation.collection;

const existing = (await coll.indexes()).find((i) => i.name === INDEX_NAME);
if (existing && !existing.partialFilterExpression) {
  await coll.dropIndex(INDEX_NAME);
  console.log(`Dropped legacy sparse index ${INDEX_NAME}`);
}
await Reservation.createIndexes();
const now = (await coll.indexes()).find((i) => i.name === INDEX_NAME);
console.log('Current index:', JSON.stringify(now));

await mongoose.disconnect();
