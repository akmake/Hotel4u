export function migrationInventory(properties, invoices) {
  const groups = new Map(), issues = [];
  for (const p of properties) {
    const taxId = String(p.taxNumber || '').replace(/\D/g, '');
    if (!/^\d{9}$/.test(taxId) || !p.address || !p.city || !(p.legalName || p.name)) issues.push({ propertyId: String(p._id), code: 'ISSUER_DETAILS_INCOMPLETE' });
    const key = taxId || `missing:${p._id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(String(p._id));
  }
  const series = new Map(), numbers = new Set();
  for (const d of invoices) {
    if (d.status === 'draft') continue;
    const key = `${d.property}:${d.type}`, unique = `${key}:${d.invoiceNumber}`;
    if (numbers.has(unique)) issues.push({ documentId: String(d._id), code: 'DUPLICATE_LEGACY_NUMBER' });
    numbers.add(unique);
    if (!d.invoiceNumber || !Number.isSafeInteger(d.seq) || d.seq < 1) issues.push({ documentId: String(d._id), code: 'NUMBER_REQUIRES_REVIEW' });
    if (!series.has(key)) series.set(key, { propertyId: String(d.property), type: d.type, count: 0, maxSequence: 0 });
    const s = series.get(key); s.count += 1; s.maxSequence = Math.max(s.maxSequence, Number.isSafeInteger(d.seq) ? d.seq : 0);
  }
  return { version: 'ACCOUNTING_MIGRATION_V1', mode: 'dry_run', generatedAt: new Date().toISOString(), propertyCount: properties.length, documentCount: invoices.length,
    candidateEntityGroups: [...groups.values()].map((propertyIds) => ({ propertyIds, requiresProfessionalReview: true })),
    series: [...series.values()], issues,
    invariants: ['No historical documents rewritten', 'No numbers reallocated', 'Candidate groups are unverified', 'Explicit reviewed mapping required before cutover'],
  };
}
