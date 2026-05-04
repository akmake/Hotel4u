// Ch. 17 — Billing Windows / Routing Rules
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope, requireRoles, actorOrSystem } from '../middleware/authContext.js';
import { audit } from '../services/auditService.js';
import FolioRoutingRule from '../models/FolioRoutingRule.js';
import Folio from '../models/Folio.js';
import Reservation from '../models/Reservation.js';
import Company from '../models/Company.js';
import GroupBlock from '../models/GroupBlock.js';

const router = Router();

const MANAGER_ROLES = ['super_admin','property_admin','general_manager','front_desk_manager','finance_manager','cashier'];

// ── GET /api/folio-routing?propertyId=&reservationId=
router.get('/', asyncHandler(async (req, res) => {
  const { propertyId, reservationId } = req.query;
  assertPropertyScope(req, propertyId);

  const filter = { property: propertyId };
  if (reservationId) filter.reservation = reservationId;

  const rules = await FolioRoutingRule.find(filter)
    .sort({ createdAt: 1 })
    .lean();
  res.json({ success: true, data: rules });
}));

// ── POST /api/folio-routing — create rule
router.post('/', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Creating routing rules requires finance/manager permissions');
  const {
    propertyId, reservationId, name, departments, chargeTypes,
    fromDate, toDate, percentage, targetOwnerType, targetOwnerId, notes,
  } = req.body;
  assertPropertyScope(req, propertyId);

  if (!reservationId) return res.status(400).json({ success: false, error: 'reservationId is required' });
  if (!name?.trim())  return res.status(400).json({ success: false, error: 'name is required' });
  if (!targetOwnerType) return res.status(400).json({ success: false, error: 'targetOwnerType is required' });

  const reservation = await Reservation.findById(reservationId);
  if (!reservation || String(reservation.property) !== String(propertyId)) {
    return res.status(404).json({ success: false, error: 'Reservation not found' });
  }

  // Ensure target folio exists or create it
  let targetFolioId;
  if (targetOwnerType !== 'guest') {
    let existingFolio = await Folio.findOne({
      property: propertyId,
      ownerType: targetOwnerType,
      ownerRef: targetOwnerId || undefined,
      status: 'open',
    });
    if (!existingFolio) {
      existingFolio = await Folio.create({
        property:  propertyId,
        reservation: reservationId,
        ownerType: targetOwnerType,
        ownerRef:  targetOwnerId || undefined,
        status:    'open',
        currency:  reservation.currency || 'ILS',
        lines:     [],
      });
    }
    targetFolioId = existingFolio._id;
  }

  const a = actorOrSystem(req);
  const rule = await FolioRoutingRule.create({
    property:        propertyId,
    reservation:     reservationId,
    name:            name.trim(),
    departments:     departments || [],
    chargeTypes:     chargeTypes || [],
    fromDate:        fromDate || undefined,
    toDate:          toDate || undefined,
    percentage:      percentage || 100,
    targetOwnerType,
    targetOwnerId:   targetOwnerId || undefined,
    targetFolioId:   targetFolioId || undefined,
    notes:           notes || undefined,
    createdBy:       a.id || undefined,
  });

  await audit({ property: propertyId, actor: a.id, actorName: a.name, action: 'folio_routing.created', entityType: 'FolioRoutingRule', entityId: rule._id, after: rule.toObject(), ip: req.ip }).catch(() => null);
  res.status(201).json({ success: true, data: rule });
}));

// ── PATCH /api/folio-routing/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Editing routing rules requires finance/manager permissions');
  const rule = await FolioRoutingRule.findById(req.params.id);
  if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
  assertPropertyScope(req, rule.property);

  const allowed = ['name','departments','chargeTypes','fromDate','toDate','percentage','notes','active'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) rule[key] = req.body[key];
  }
  const a = actorOrSystem(req);
  await rule.save();

  await audit({ property: rule.property, actor: a.id, actorName: a.name, action: 'folio_routing.updated', entityType: 'FolioRoutingRule', entityId: rule._id, after: rule.toObject(), ip: req.ip }).catch(() => null);
  res.json({ success: true, data: rule });
}));

// ── DELETE /api/folio-routing/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Deleting routing rules requires finance/manager permissions');
  const rule = await FolioRoutingRule.findById(req.params.id);
  if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
  assertPropertyScope(req, rule.property);

  await FolioRoutingRule.deleteOne({ _id: rule._id });
  const a = actorOrSystem(req);
  await audit({ property: rule.property, actor: a.id, actorName: a.name, action: 'folio_routing.deleted', entityType: 'FolioRoutingRule', entityId: rule._id, ip: req.ip }).catch(() => null);
  res.json({ success: true, data: { deleted: true } });
}));

// ── POST /api/folio-routing/apply — apply routing rules to a charge
// Called internally when adding a charge, routes it to the correct folio per active rules
router.post('/apply', asyncHandler(async (req, res) => {
  requireRoles(req, MANAGER_ROLES, 'Applying routing requires finance permissions');
  const { propertyId, reservationId, department, chargeType = 'charge', serviceDate, amount, taxAmount, description } = req.body;
  assertPropertyScope(req, propertyId);

  const rules = await FolioRoutingRule.find({
    reservation: reservationId,
    active: true,
  }).sort({ createdAt: 1 });

  const guestFolio = await Folio.findOne({ reservation: reservationId, ownerType: 'guest', status: 'open' });
  if (!guestFolio) return res.status(404).json({ success: false, error: 'Guest folio not found' });

  let remainingPct = 100;
  const posted = [];

  for (const rule of rules) {
    // Match department
    if (rule.departments.length > 0 && !rule.departments.includes(department)) continue;
    // Match charge type
    if (rule.chargeTypes.length > 0 && !rule.chargeTypes.includes(chargeType)) continue;
    // Match date range
    if (rule.fromDate && serviceDate && serviceDate < rule.fromDate) continue;
    if (rule.toDate   && serviceDate && serviceDate > rule.toDate)   continue;
    // Match remaining percentage
    if (remainingPct <= 0) break;

    const pct = Math.min(rule.percentage, remainingPct);
    const routedAmount = Math.round(amount * pct) / 100;
    const routedTax    = Math.round((taxAmount || 0) * pct) / 100;

    const targetFolio = rule.targetFolioId
      ? await Folio.findById(rule.targetFolioId)
      : null;

    if (targetFolio && targetFolio.status === 'open') {
      targetFolio.lines.push({
        type: chargeType,
        description: `[Routing ${pct}%] ${description}`,
        amount: routedAmount,
        taxAmount: routedTax,
        department,
        serviceDate,
        source: 'routing',
        status: 'posted',
      });
      await targetFolio.save();
      posted.push({ folioId: targetFolio._id, ownerType: rule.targetOwnerType, amount: routedAmount });
      remainingPct -= pct;
    }
  }

  // Post remaining percentage to guest folio
  if (remainingPct > 0) {
    const guestAmount = Math.round(amount * remainingPct) / 100;
    const guestTax    = Math.round((taxAmount || 0) * remainingPct) / 100;
    guestFolio.lines.push({
      type: chargeType,
      description,
      amount: guestAmount,
      taxAmount: guestTax,
      department,
      serviceDate,
      source: 'routing',
      status: 'posted',
    });
    await guestFolio.save();
    posted.push({ folioId: guestFolio._id, ownerType: 'guest', amount: guestAmount });
  }

  res.json({ success: true, data: { applied: posted } });
}));

export default router;
