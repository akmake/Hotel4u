import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Folio from '../models/Folio.js';
import Company from '../models/Company.js';
import { audit } from '../services/auditService.js';
import { randomUUID } from 'node:crypto';
import { actorOrSystem, assertPropertyScope, requireRoles } from '../middleware/authContext.js';
import { postCharge, recordFolioPayment } from '../services/financeService.js';

const router = Router();

const FOLIO_READ_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'receptionist',
  'finance_manager',
  'cashier',
  'auditor',
  'owner_readonly',
];

const FOLIO_WRITE_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'receptionist',
  'finance_manager',
  'cashier',
];

const FOLIO_MANAGER_ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'finance_manager',
  'front_desk_manager',
];

function calcBalance(folio) {
  return (folio.lines || [])
    .filter((line) => line.status === 'posted')
    .reduce((sum, line) => sum + (line.amount || 0) + (line.taxAmount || 0), 0);
}

function todayYmd() {
  return new Date().toISOString().split('T')[0];
}

async function getFolioInScope(req, folioId, { lean = false, populate = null } = {}) {
  let query = Folio.findById(folioId);
  if (populate) query = query.populate(populate);
  if (lean) query = query.lean();

  const folio = await query;
  if (!folio) return null;

  assertPropertyScope(req, String(folio.property));
  return folio;
}

async function getReservationFolioInScope(req, reservationId, { lean = false, populate = null } = {}) {
  let query = Folio.findOne({ reservation: reservationId });
  if (populate) query = query.populate(populate);
  if (lean) query = query.lean();

  const folio = await query;
  if (!folio) return null;

  assertPropertyScope(req, String(folio.property));
  return folio;
}

// GET /api/folio/reservation/:resId
router.get('/reservation/:resId', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_READ_ROLES);

  const folio = await getReservationFolioInScope(req, req.params.resId, {
    lean: true,
    populate: { path: 'reservation', select: 'confirmationNumber primaryGuest arrivalDate departureDate' },
  });

  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  res.json({ success: true, data: { ...folio, balance: calcBalance(folio) } });
}));

// GET /api/folio/reservation/:resId/receipt
router.get('/reservation/:resId/receipt', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_READ_ROLES);

  const folio = await getReservationFolioInScope(req, req.params.resId, {
    lean: true,
    populate: {
      path: 'reservation',
      select: 'confirmationNumber arrivalDate departureDate nights ratePerNight totalAmount taxAmount currency',
      populate: [
        { path: 'primaryGuest', select: 'firstName lastName email phone' },
        { path: 'assignedRoom', select: 'number' },
        { path: 'roomType', select: 'name code' },
        { path: 'property', select: 'name address phone email' },
      ],
    },
  });

  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  const activeLines = (folio.lines || []).filter((line) => line.status === 'posted');
  const totalCharges = activeLines
    .filter((line) => line.amount > 0)
    .reduce((sum, line) => sum + (line.amount || 0) + (line.taxAmount || 0), 0);
  const totalPayments = activeLines
    .filter((line) => line.amount < 0)
    .reduce((sum, line) => sum + Math.abs(line.amount || 0), 0);

  res.json({
    success: true,
    data: {
      folio,
      totalCharges,
      totalPayments,
      balance: calcBalance(folio),
      generatedAt: new Date().toISOString(),
    },
  });
}));

// GET /api/folio/reservation/:resId/invoice
router.get('/reservation/:resId/invoice', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_READ_ROLES);

  const folio = await getReservationFolioInScope(req, req.params.resId, {
    lean: true,
    populate: {
      path: 'reservation',
      populate: [
        { path: 'primaryGuest', select: 'firstName lastName email phone country idDocNumber' },
        { path: 'assignedRoom', select: 'number' },
        { path: 'roomType', select: 'name code' },
        { path: 'property', select: 'name address phone email vatNumber' },
        { path: 'company', select: 'name address vatNumber' },
      ],
    },
  });

  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  const activeLines = (folio.lines || []).filter((line) => line.status === 'posted');
  const chargeLines = activeLines.filter((line) => line.amount > 0);
  const totalNet = chargeLines.reduce((sum, line) => sum + (line.amount || 0), 0);
  const totalTax = chargeLines.reduce((sum, line) => sum + (line.taxAmount || 0), 0);
  const totalGross = totalNet + totalTax;
  const totalPayments = activeLines
    .filter((line) => line.amount < 0)
    .reduce((sum, line) => sum + Math.abs(line.amount || 0), 0);

  res.json({
    success: true,
    data: {
      folio,
      chargeLines,
      totalNet,
      totalTax,
      totalGross,
      totalPayments,
      balance: totalGross - totalPayments,
      issuedAt: new Date().toISOString(),
    },
  });
}));

// ── Writes ──────────────────────────────────────────────────────────────────
// Every money write goes through the finance services (spec decision 2): catalogue code, VAT class,
// balance caps, cash policy, audit and one-operation-per-key. Legacy callers have no operation key,
// so one is minted per request (same behaviour as before: no dedupe across retries).
// Line deletion, free adjustments, transfers and reopen are closed: corrections are new lines
// (reversal / refund / credit note) on /api/pms/finance, and reopen-for-late-charge is a manager
// action in the stay file (gap G6).
const legacyKey = () => `legacy-${randomUUID()}`;
const financeActor = (req) => { const a = actorOrSystem(req); return { id: a.id, name: a.name, role: a.role }; };
async function scopedFolio(req) {
  const folio = await getFolioInScope(req, req.params.folioId, { lean: true });
  if (!folio) { const e = new Error('Folio not found'); e.status = 404; throw e; }
  return folio;
}
const send = (fn) => asyncHandler(async (req, res) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status >= 500) throw err;
    res.status(status).json({ success: false, error: err.message, ...(err.fields ? { fields: err.fields } : {}) });
  }
});

// POST /api/folio/:folioId/charge — gross price as entered (amount + legacy taxAmount)
router.post('/:folioId/charge', send(async (req) => {
  requireRoles(req, FOLIO_WRITE_ROLES);
  const folio = await scopedFolio(req);
  const b = req.body || {};
  const gross = Number(b.amount || 0) + Number(b.taxAmount || 0);
  return postCharge({
    propertyId: String(folio.property), folioId: String(folio._id), actor: financeActor(req), ip: req.ip,
    input: { description: b.description, department: b.department || 'other', quantity: 1, unitPrice: gross, serviceDate: b.serviceDate, idempotencyKey: b.idempotencyKey || legacyKey() },
  });
}));

// POST /api/folio/:folioId/payment | /deposit
for (const kind of ['payment', 'deposit']) {
  router.post(`/:folioId/${kind}`, send(async (req) => {
    requireRoles(req, FOLIO_WRITE_ROLES);
    const folio = await scopedFolio(req);
    const b = req.body || {};
    return recordFolioPayment({
      propertyId: String(folio.property), folioId: String(folio._id), actor: financeActor(req), ip: req.ip,
      input: { kind, amount: b.amount, method: b.method || 'cash', methodRef: b.methodRef || b.reference, note: b.note, idempotencyKey: b.idempotencyKey || legacyKey() },
    });
  }));
}

const GONE = {
  discount: 'הנחה נרשמת כהיפוך חלקי או במסמך זיכוי במסך החשבון',
  adjustment: 'תיקון נרשם כהיפוך חיוב במסך החשבון',
  refund: 'החזר נרשם מתשלום מסוים במסך החשבון',
  'void-line': 'שורות לא נמחקות — תיקון בהיפוך או במסמך זיכוי',
  'transfer-line': 'העברת חיובים בין משלמים — ניתוב (FIN-05)',
  close: 'החשבון נסגר באשף היציאה',
  reopen: 'פתיחה מחדש לחיוב מאוחר — מתוך תיק ההזמנה (מנהל, עם סיבה)',
  'post-checkout-charge': 'חיוב אחרי יציאה — "פתיחה לחיוב מאוחר" בתיק ההזמנה',
};
for (const [path, msg] of Object.entries(GONE)) {
  router.post(`/:folioId/${path}`, (req, res) => res.status(410).json({ success: false, error: `הפעולה הוחלפה: ${msg}` }));
}

// POST /api/folio/:folioId/check-company-credit
router.post('/:folioId/check-company-credit', asyncHandler(async (req, res) => {
  requireRoles(req, FOLIO_MANAGER_ROLES);

  const { amount } = req.body;
  const numericAmount = Number(amount || 0);

  const folio = await getFolioInScope(req, req.params.folioId, { lean: true });
  if (!folio) return res.status(404).json({ success: false, error: 'Folio not found' });

  if (folio.ownerType !== 'company' || !folio.ownerRef) {
    return res.json({ success: true, data: { applicable: false, withinLimit: true } });
  }

  const company = await Company.findById(folio.ownerRef).lean();
  if (!company) {
    return res.json({ success: true, data: { applicable: false, withinLimit: true } });
  }

  assertPropertyScope(req, String(company.property));

  const creditLimit = Number(company.creditLimit || 0);
  const currentBalance = calcBalance(folio);
  const projectedBalance = currentBalance + numericAmount;
  const withinLimit = creditLimit === 0 || projectedBalance <= creditLimit;

  res.json({
    success: true,
    data: {
      applicable: true,
      companyId: String(company._id),
      companyName: company.name,
      creditLimit,
      currentBalance,
      projectedBalance,
      withinLimit,
      overage: withinLimit ? 0 : projectedBalance - creditLimit,
    },
  });
}));

export default router;
