import mongoose from 'mongoose';
const { Schema } = mongoose;
const ref = (name, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });
const money = { type: String, required: true, match: /^-?\d+\.\d{2}$/ };
const options = { timestamps: true, strict: 'throw' };
const IMMUTABLE_MODELS = new Set(['JournalEntry', 'AccountingEvent', 'PaymentEvent', 'IssuerProfile', 'TaxRule', 'DocumentArtifact']);
const build = (name, definition, indexes = []) => {
  const schema = new Schema(definition, options);
  for (const [keys, opts] of indexes) schema.index(keys, opts);
  if (IMMUTABLE_MODELS.has(name)) {
    const fail = () => { throw Object.assign(new Error('רשומה חשבונאית סופית אינה ניתנת לשינוי'), { status: 422 }); };
    schema.pre('save', function () { if (!this.isNew && this.isModified()) fail(); });
    for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'bulkWrite']) schema.pre(op, fail);
    schema.pre('deleteOne', { document: true, query: false }, fail);
  }
  if (name === 'JournalEntry') schema.pre('validate', function () {
    let debit = 0n, credit = 0n;
    if (!this.lines || this.lines.length < 2) throw new Error('Journal requires at least two lines');
    const cents = (v) => { if (!/^\d+\.\d{2}$/.test(v || '')) throw new Error('Invalid journal money'); return BigInt(v.replace('.', '')); };
    for (const line of this.lines) { const d = cents(line.debit), c = cents(line.credit); if ((d > 0n) === (c > 0n)) throw new Error('Journal line requires one positive side'); debit += d; credit += c; }
    if (debit !== credit || debit !== cents(this.totalDebit) || credit !== cents(this.totalCredit)) throw new Error('Unbalanced journal');
  });
  return mongoose.models[name] || mongoose.model(name, schema);
};
export const LegalEntity = build('LegalEntity', {
  tenantKey: { type: String, required: true }, legalName: { type: String, required: true },
  taxId: { type: String, required: true, match: /^\d{9}$/ }, address: { type: String, required: true }, city: { type: String, required: true },
  currency: { type: String, enum: ['ILS'], default: 'ILS' }, mode: { type: String, enum: ['shadow', 'pilot', 'live'], default: 'shadow' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' }, version: { type: Number, default: 1 },
}, [[{ tenantKey: 1, taxId: 1 }, { unique: true }]]);
export const IssuerProfile = build('IssuerProfile', {
  legalEntity: ref('LegalEntity'), version: { type: Number, required: true }, legalName: String, taxId: String, address: String, city: String,
  signingProfileId: String, source: { type: String, enum: ['configured', 'migrated_inferred'], default: 'configured' },
}, [[{ legalEntity: 1, version: 1 }, { unique: true }]]);
export const DocumentSeries = build('DocumentSeries', {
  legalEntity: ref('LegalEntity'), property: ref('Property', false), documentType: { type: String, required: true },
  code: { type: String, required: true }, prefix: { type: String, default: '' }, lastNumber: { type: Number, default: 0, min: 0, max: Number.MAX_SAFE_INTEGER },
  active: { type: Boolean, default: false }, approvalReference: String,
}, [[{ legalEntity: 1, code: 1 }, { unique: true }]]);
export const ComplianceDecision = build('ComplianceDecision', {
  legalEntity: ref('LegalEntity'), requirementId: { type: String, required: true },
  status: { type: String, enum: ['APPROVED', 'NOT_APPLICABLE', 'UNRESOLVED', 'EXPIRED'], default: 'UNRESOLVED' },
  legalSource: String, sourceVersion: String, evidenceReference: String, rationale: String, professionalName: String,
  validFrom: String, reviewDue: String, recordedBy: ref('User'),
}, [[{ legalEntity: 1, requirementId: 1 }, { unique: true }]]);
export const TaxRule = build('TaxRule', {
  legalEntity: ref('LegalEntity'), code: { type: String, required: true }, version: { type: String, required: true },
  classification: { type: String, enum: ['standard', 'zero', 'exempt', 'outside_scope'], required: true },
  rate: { type: String, required: true }, validFrom: { type: String, required: true }, validTo: String,
  serviceCategory: { type: String, required: true }, customerClassification: { type: String, required: true },
  decision: ref('ComplianceDecision'), evidencePolicy: String, roundingPolicy: { type: String, required: true },
}, [[{ legalEntity: 1, code: 1, version: 1 }, { unique: true }]]);
export const Account = build('Account', {
  legalEntity: ref('LegalEntity'), code: { type: String, required: true }, name: { type: String, required: true },
  classification: { type: String, enum: ['asset', 'liability', 'equity', 'income', 'expense'], required: true }, active: { type: Boolean, default: true },
}, [[{ legalEntity: 1, code: 1 }, { unique: true }]]);
export const AccountingPeriod = build('AccountingPeriod', {
  legalEntity: ref('LegalEntity'), month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  state: { type: String, enum: ['open', 'review', 'closing', 'locked'], default: 'open' },
  writeVersion: { type: Number, default: 0 }, closedBy: ref('User', false), closedAt: Date, closeReason: String,
}, [[{ legalEntity: 1, month: 1 }, { unique: true }]]);
export const JournalEntry = build('JournalEntry', {
  legalEntity: ref('LegalEntity'), property: ref('Property'), accountingDate: { type: String, required: true },
  currency: { type: String, enum: ['ILS'], default: 'ILS' }, sourceEventId: { type: String, required: true },
  payloadHash: { type: String, required: true }, description: String, reversalOf: ref('JournalEntry', false),
  lines: [{ accountCode: { type: String, required: true }, debit: money, credit: money, description: String, _id: false }],
  totalDebit: money, totalCredit: money, postedBy: ref('User'), postedAt: { type: Date, default: Date.now },
}, [[{ legalEntity: 1, sourceEventId: 1 }, { unique: true }], [{ legalEntity: 1, accountingDate: 1 }, {}], [{ reversalOf: 1 }, { unique: true, partialFilterExpression: { reversalOf: { $type: 'objectId' } } }]]);
export const AccountingEvent = build('AccountingEvent', {
  legalEntity: ref('LegalEntity', false), property: ref('Property'), eventKey: { type: String, required: true },
  type: { type: String, required: true }, sourceId: { type: String, required: true }, payloadHash: { type: String, required: true }, payload: Schema.Types.Mixed,
}, [[{ property: 1, eventKey: 1 }, { unique: true }]]);
export const FiscalOutbox = build('FiscalOutbox', {
  property: ref('Property'), event: ref('AccountingEvent'), topic: { type: String, required: true },
  state: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' }, attempts: { type: Number, default: 0 },
  availableAt: { type: Date, default: Date.now }, leaseUntil: Date, leaseToken: String, completedAt: Date, lastError: String,
}, [[{ event: 1, topic: 1 }, { unique: true }], [{ state: 1, availableAt: 1 }, {}]]);
export const PaymentOperation = build('PaymentOperation', {
  legalEntity: ref('LegalEntity'), property: ref('Property'), provider: { type: String, required: true },
  operationKey: { type: String, required: true }, payloadHash: { type: String, required: true }, providerReference: String,
  amount: money, refunded: { ...money, default: '0.00' }, currency: { type: String, enum: ['ILS'], default: 'ILS' },
  state: { type: String, enum: ['created', 'pending', 'authorized', 'captured', 'settled', 'failed', 'unknown', 'voided', 'partially_refunded', 'refunded', 'disputed', 'chargeback'], default: 'created' },
  customerReference: String, lastReconciledAt: Date,
}, [[{ legalEntity: 1, operationKey: 1 }, { unique: true }]]);
export const PaymentEvent = build('PaymentEvent', {
  payment: ref('PaymentOperation'), legalEntity: ref('LegalEntity'), provider: { type: String, required: true },
  providerEventId: { type: String, required: true }, type: String, amount: money, occurredAt: Date, verifiedAt: { type: Date, required: true }, payloadHash: String,
}, [[{ legalEntity: 1, provider: 1, providerEventId: 1 }, { unique: true }]]);
export const DocumentArtifact = build('DocumentArtifact', {
  property: ref('Property'), document: ref('Invoice'), version: { type: String, required: true },
  mime: { type: String, required: true }, content: { type: String, required: true }, sha256: { type: String, required: true },
  signatureStatus: { type: String, enum: ['unsigned', 'signed'], default: 'unsigned' },
  retentionPolicy: { type: String, default: 'legal_review_required' }, legalHold: { type: Boolean, default: true },
}, [[{ document: 1, version: 1 }, { unique: true }]]);
export const PaymentRefund = build('PaymentRefund', {
  legalEntity: ref('LegalEntity'), property: ref('Property'), payment: ref('PaymentOperation'),
  operationKey: { type: String, required: true }, payloadHash: { type: String, required: true }, amount: money,
  state: { type: String, enum: ['pending', 'unknown', 'succeeded', 'failed'], default: 'pending' }, providerReference: String, reason: String,
}, [[{ legalEntity: 1, operationKey: 1 }, { unique: true }]]);

