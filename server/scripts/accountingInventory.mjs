#!/usr/bin/env node
// Read-only inventory. Deliberately does not load the application's production .env.
import mongoose from 'mongoose';
import { writeFile } from 'node:fs/promises';
import Property from '../models/Property.js';
import Invoice from '../models/Invoice.js';
import { migrationInventory } from '../domain/accountingMigration.js';

const uri = process.env.MONGO_MIGRATION_URI;
if (!uri) throw new Error('Set MONGO_MIGRATION_URI explicitly to the reviewed source database');
const output = process.argv.find((a) => a.startsWith('--output='))?.slice(9);
try {
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  const [properties, documents] = await Promise.all([
    Property.find({}).select('name legalName taxNumber address city legalEntity docSequences').lean(),
    Invoice.find({}).select('property type status invoiceNumber seq').lean(),
  ]);
  const report = migrationInventory(properties, documents);
  if (output) await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx', encoding: 'utf8' });
  console.log(JSON.stringify({ mode: 'dry_run', properties: report.propertyCount, documents: report.documentCount, groupsRequiringReview: report.candidateEntityGroups.length, issues: report.issues.length, reportWritten: !!output }));
} finally { await mongoose.disconnect(); }
