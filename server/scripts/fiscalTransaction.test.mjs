import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

// Covers the legacy in-app numbering; live documents are issued by the invoicing system (qa:invoicer).
process.env.LEGACY_LOCAL_DOCUMENTS = '1';
import { runFiscalTransaction } from '../services/fiscalTransaction.js';
import { nextDocumentNumber } from '../services/documentService.js';
import Property from '../models/Property.js';

test('fiscal transaction returns committed result and closes the session', async (t) => {
  let ended = false;
  const session = { withTransaction: async (work) => work(), endSession: async () => { ended = true; } };
  t.mock.method(mongoose, 'startSession', async () => session);
  assert.equal(await runFiscalTransaction(async (received) => {
    assert.equal(received, session);
    return 'issued';
  }), 'issued');
  assert.equal(ended, true);
});

test('unsupported transactions reject without a second nontransactional write', async (t) => {
  let calls = 0;
  let ended = false;
  const failure = Object.assign(new Error('standalone'), { code: 20 });
  const session = { withTransaction: async (work) => work(), endSession: async () => { ended = true; } };
  t.mock.method(mongoose, 'startSession', async () => session);
  await assert.rejects(runFiscalTransaction(async (received) => {
    calls += 1;
    assert.equal(received, session);
    throw failure;
  }), (err) => err.status === 503 && err.code === 'FISCAL_TRANSACTIONS_REQUIRED' && err.cause === failure);
  assert.equal(calls, 1);
  assert.equal(ended, true);
});

test('commit failure preserves the error and never replays issuance', async (t) => {
  const failure = new Error('commit failed');
  let calls = 0;
  let ended = false;
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (work) => { await work(); throw failure; },
    endSession: async () => { ended = true; },
  }));
  await assert.rejects(runFiscalTransaction(async () => { calls += 1; }), (err) => err === failure);
  assert.equal(calls, 1);
  assert.equal(ended, true);
});

test('sequence allocation uses the issuance session', async (t) => {
  const session = {};
  t.mock.method(Property, 'findByIdAndUpdate', (id, update, options) => {
    assert.equal(id, 'property');
    assert.deepEqual(update, { $inc: { 'docSequences.credit_note': 1 } });
    assert.equal(options.session, session);
    assert.equal(options.returnDocument, 'after');
    return { select: () => ({ lean: async () => ({ docSequences: { credit_note: 42 } }) }) };
  });
  assert.deepEqual(await nextDocumentNumber('property', 'credit_note', session), { seq: 42, number: '42' });
});
