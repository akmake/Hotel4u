import test from 'node:test';
import assert from 'node:assert/strict';
import { minor, amount, calculateLine, distributeMinor, sumMoney } from '../domain/money.js';
import { creditLines } from '../domain/credit.js';
import { payloadHash, validDate, validateJournal, assertPaymentTransition } from '../domain/accounting.js';
import Invoice, { assertInvoiceMetadataUpdate } from '../models/Invoice.js';
import { JournalEntry, AccountingEvent, DocumentArtifact } from '../models/Accounting.js';
import { allocationRule } from '../services/documentService.js';
import { migrationInventory } from '../domain/accountingMigration.js';

test('decimal boundary: half agoras, negative ties, large sums and invalid floats', () => {
  assert.equal(amount(minor('1.005')), '1.01');
  assert.equal(amount(minor('-1.005')), '-1.01');
  assert.equal(sumMoney(['0.10', '0.20']), '0.30');
  assert.equal(sumMoney(['90071992547409.91', '0.01']), '90071992547409.92');
  for (const value of ['NaN', 'Infinity', '1e6', '', '1,000', '0.123456789']) assert.throws(() => minor(value));
});
test('money: line totals conserve agoras over inclusive/exclusive pricing and discounts', () => {
  for (let i = 1; i <= 1000; i += 1) for (const pricesIncludeVat of [true, false]) {
    const line = calculateLine({ unitPrice: amount(BigInt(i)), quantity: '1.25', discountPct: '7.5', vatRate: '18', pricesIncludeVat });
    assert.equal(minor(line.net) + minor(line.tax), minor(line.gross));
  }
  assert.deepEqual(Object.values(calculateLine({ unitPrice: '118', vatRate: '18', pricesIncludeVat: true })).slice(0, 3), ['100.00', '18.00', '118.00']);
  assert.throws(() => calculateLine({ unitPrice: '1', quantity: '0', vatRate: '18' }));
  assert.throws(() => calculateLine({ unitPrice: '1', discountPct: '101', vatRate: '18' }));
});
test('largest remainder allocation preserves exact total and never exceeds a source', () => {
  const weights = [13n, 29n, 7n, 51n];
  for (let total = 0n; total <= 100n; total += 1n) {
    const parts = distributeMinor(total, weights);
    assert.equal(parts.reduce((a, b) => a + b, 0n), total);
    assert.ok(parts.every((n, i) => n >= 0n && n <= weights[i]));
  }
  assert.deepEqual(distributeMinor(1n, [1n, 1n]), [1n, 0n]);
});
const original = { lines: [
  { _id: 'taxed', description: 'לינה', quantity: 1, unitPrice: 100, netAmount: 100, vatAmount: 18, grossAmount: 118, vatRate: 18 },
  { _id: 'zero', description: 'פריט אחר', quantity: 1, unitPrice: 20, netAmount: 20, vatAmount: 0, grossAmount: 20, vatRate: 0 },
] };
test('DOC-T09: selection credits only the chosen line and preserves original tax', () => {
  const lines = creditLines(original, [], { selections: [{ sourceLineId: 'zero', grossAmount: '5.00' }] });
  assert.equal(lines.length, 1); assert.equal(lines[0].sourceInvoiceLineId, 'zero');
  assert.equal(lines[0].vatAmount, 0); assert.equal(lines[0].grossAmount, -5);
  assert.throws(() => creditLines(original, [], { selections: [{ sourceLineId: 'zero', grossAmount: '20.01' }] }));
});
test('partial credit then full remainder exactly reverses each source net/tax/gross', () => {
  const first = creditLines(original, [], { creditAmount: '0.03' });
  const rest = creditLines(original, [{ lines: first }]);
  for (const source of original.lines) for (const key of ['netAmount', 'vatAmount', 'grossAmount']) {
    const total = [...first, ...rest].filter((l) => l.sourceInvoiceLineId === source._id).reduce((s, l) => s + minor(l[key]), 0n);
    assert.equal(total, -minor(source[key]));
  }
  assert.throws(() => creditLines(original, [{ lines: first }, { lines: rest }]), /במלואה/);
});
test('credit history without source references is blocked instead of guessed', () => {
  assert.throws(() => creditLines(original, [{ lines: [{ grossAmount: -1 }] }]), (e) => e.code === 'CREDIT_HISTORY_REVIEW_REQUIRED');
});
test('inconsistent source totals are blocked before any credit allocation', () => {
  assert.throws(() => creditLines({ ...original, totalGross: 100 }, []), /אינם תואמים/);
});
test('one-agora credit repeated exhausts a mixed-tax invoice exactly', () => {
  const small = { lines: [{ ...original.lines[0], netAmount: 0.06, vatAmount: 0.01, grossAmount: 0.07 }, { ...original.lines[1], netAmount: 0.03, grossAmount: 0.03 }] };
  const prior = [];
  for (let i = 0; i < 10; i += 1) prior.push({ lines: creditLines(small, prior, { creditAmount: '0.01' }) });
  assert.equal(sumMoney(prior.flatMap((p) => p.lines).map((l) => l.grossAmount)), '-0.10');
  assert.throws(() => creditLines(small, prior, { creditAmount: '0.01' }));
});
test('journal rejects imbalance, both sides, zero lines and bad dates', () => {
  const line = { accountCode: '1000', debit: '0.10' }, opposite = { accountCode: '2000', credit: '0.10' };
  assert.equal(validateJournal([line, opposite]).totalDebit, '0.10');
  assert.throws(() => validateJournal([line, { ...opposite, credit: '0.11' }]));
  assert.throws(() => validateJournal([{ ...line, credit: '0.10' }, opposite]));
  assert.throws(() => validateJournal([{ accountCode: '1000' }, opposite]));
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', 'x']) assert.throws(() => validDate(date));
  assert.equal(validDate('2024-02-29'), '2024-02-29');
});
test('payload hashes ignore key order but detect a changed monetary request', () => {
  assert.equal(payloadHash({ amount: '1.00', lines: [{ x: 1, y: 2 }] }), payloadHash({ lines: [{ y: 2, x: 1 }], amount: '1.00' }));
  assert.notEqual(payloadHash({ amount: '1.00' }), payloadHash({ amount: '1.01' }));
});
test('payment unknown state cannot start another capture and terminal states cannot regress', () => {
  assert.throws(() => assertPaymentTransition('captured', 'authorized'));
  assert.throws(() => assertPaymentTransition('refunded', 'captured'));
  assert.throws(() => assertPaymentTransition('unknown', 'pending'));
  assert.doesNotThrow(() => assertPaymentTransition('unknown', 'captured'));
});
test('DOC-T07: monetary, replacement, pipeline, rename and status downgrade updates are blocked', () => {
  for (const update of [{ $set: { totalGross: 0 } }, { $unset: { 'seller.name': '' } }, { $rename: { totalNet: 'allocationNumber' } }, [{ $set: { totalNet: 0 } }], { totalNet: 0 }, { $set: { status: 'draft' } }]) assert.throws(() => assertInvoiceMetadataUpdate(update));
  assert.doesNotThrow(() => assertInvoiceMetadataUpdate({ $set: { allocationNumber: '123456789' }, $push: { creditedBy: 'id' } }));
});
test('actual Mongoose middleware rejects update and replacement before touching the DB', async () => {
  await assert.rejects(Invoice.updateOne({}, { $set: { totalGross: 1 } }), /מסמך סופי/);
  await assert.rejects(Invoice.replaceOne({}, { property: 'x' }), /מסמך סופי/);
  for (const Model of [JournalEntry, AccountingEvent, DocumentArtifact]) {
    await assert.rejects(Model.updateOne({}, { $set: { totalDebit: '0.00' } }), /סופית/);
    await assert.rejects(Model.deleteMany({}), /סופית/);
  }
});
test('DOC-T12/13/14: dated allocation boundaries use net and strict greater-than', () => {
  const base = { type: 'tax_invoice', buyer: { kind: 'business', vatNumber: '123456789' }, totalVat: 900, issueDate: '2026-06-01' };
  assert.equal(allocationRule({ ...base, totalNet: 5000 }).required, false);
  assert.equal(allocationRule({ ...base, totalNet: 5000.01 }).required, true);
  assert.equal(allocationRule({ ...base, totalNet: 4999, totalVat: 899.82 }).required, false);
  assert.equal(allocationRule({ ...base, totalNet: 10000, issueDate: '2026-05-31' }).required, false);
  assert.equal(allocationRule({ ...base, totalNet: 10000.01, issueDate: '2026-01-01' }).required, true);
  assert.equal(allocationRule({ ...base, totalNet: 6000, totalVat: 0 }).required, false);
  assert.equal(allocationRule({ ...base, totalNet: 6000, buyer: { kind: 'private' } }).required, false);
});
test('migration inventory reports candidate merges and invalid numbering without rewriting input', () => {
  const properties = [{ _id: 'a', taxNumber: '123456789', name: 'A', address: 'x', city: 'y' }, { _id: 'b', taxNumber: '123456789', name: 'B', address: 'x', city: 'y' }];
  const invoices = [{ _id: '1', property: 'a', type: 'tax_invoice', status: 'issued', invoiceNumber: '1', seq: 1 }, { _id: '2', property: 'a', type: 'tax_invoice', status: 'issued', invoiceNumber: '1', seq: 1 }];
  const copy = JSON.stringify({ properties, invoices });
  const report = migrationInventory(properties, invoices);
  assert.equal(report.mode, 'dry_run'); assert.equal(report.candidateEntityGroups.length, 1);
  assert.equal(report.candidateEntityGroups[0].requiresProfessionalReview, true);
  assert.ok(report.issues.some((i) => i.code === 'DUPLICATE_LEGACY_NUMBER'));
  assert.equal(JSON.stringify({ properties, invoices }), copy);
});
