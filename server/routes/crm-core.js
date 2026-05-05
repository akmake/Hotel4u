import mongoose from 'mongoose';
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertPropertyScope } from '../middleware/authContext.js';
import { audit, auditCtxFromReq } from '../services/auditService.js';
import CrmAccount from '../models/crm/CrmAccount.js';
import CrmContact from '../models/crm/CrmContact.js';
import CrmLead from '../models/crm/CrmLead.js';
import CrmOpportunity from '../models/crm/CrmOpportunity.js';
import CrmActivity from '../models/crm/CrmActivity.js';
import CrmTask from '../models/crm/CrmTask.js';
import CrmTimelineEvent from '../models/crm/CrmTimelineEvent.js';
import CrmPipeline from '../models/crm/CrmPipeline.js';
import CrmLeadRoutingRule from '../models/crm/CrmLeadRoutingRule.js';
import User from '../models/User.js';

const router = Router();

const registry = {
  accounts: {
    model: CrmAccount,
    singular: 'account',
    entityType: 'account',
    label: 'חשבון',
    searchFields: ['name', 'email', 'phone', 'industry'],
    statusField: 'lifecycleStatus',
    allowed: [
      'name',
      'type',
      'lifecycleStatus',
      'owner',
      'parentAccount',
      'industry',
      'website',
      'email',
      'phone',
      'address',
      'sourceSystem',
      'externalId',
      'healthScore',
      'tags',
      'customFields',
      'active',
    ],
    populate: [
      { path: 'owner', select: 'firstName lastName email role' },
      { path: 'parentAccount', select: 'name type lifecycleStatus' },
    ],
    sort: { updatedAt: -1 },
  },
  contacts: {
    model: CrmContact,
    singular: 'contact',
    entityType: 'contact',
    label: 'איש קשר',
    searchFields: ['firstName', 'lastName', 'email', 'phone', 'title'],
    statusField: 'lifecycleStatus',
    allowed: [
      'account',
      'firstName',
      'lastName',
      'email',
      'phone',
      'title',
      'buyerRoles',
      'preferredChannel',
      'consent',
      'owner',
      'lifecycleStatus',
      'lastInteractionAt',
      'sourceSystem',
      'externalId',
      'tags',
      'customFields',
      'active',
    ],
    populate: [
      { path: 'account', select: 'name type lifecycleStatus' },
      { path: 'owner', select: 'firstName lastName email role' },
    ],
    sort: { updatedAt: -1 },
  },
  leads: {
    model: CrmLead,
    singular: 'lead',
    entityType: 'lead',
    label: 'ליד',
    searchFields: ['fullName', 'email', 'phone', 'companyName', 'title'],
    statusField: 'status',
    allowed: [
      'account',
      'contact',
      'fullName',
      'email',
      'phone',
      'companyName',
      'title',
      'source',
      'status',
      'score',
      'owner',
      'assignedTeam',
      'nextActionAt',
      'lastActivityAt',
      'lostReason',
      'convertedOpportunity',
      'convertedAt',
      'notes',
      'sourceSystem',
      'externalId',
      'tags',
      'customFields',
      'active',
    ],
    populate: [
      { path: 'account', select: 'name type lifecycleStatus' },
      { path: 'contact', select: 'firstName lastName email phone' },
      { path: 'owner', select: 'firstName lastName email role' },
      { path: 'convertedOpportunity', select: 'name stage amount probability' },
    ],
    sort: { createdAt: -1 },
  },
  opportunities: {
    model: CrmOpportunity,
    singular: 'opportunity',
    entityType: 'opportunity',
    label: 'הזדמנות',
    searchFields: ['name', 'pipelineKey'],
    statusField: 'stage',
    allowed: [
      'account',
      'primaryContact',
      'lead',
      'name',
      'pipelineKey',
      'stage',
      'amount',
      'currency',
      'probability',
      'expectedCloseDate',
      'closedAt',
      'lostReason',
      'healthStatus',
      'owner',
      'lastActivityAt',
      'tags',
      'customFields',
      'active',
    ],
    populate: [
      { path: 'account', select: 'name type lifecycleStatus' },
      { path: 'primaryContact', select: 'firstName lastName email phone' },
      { path: 'lead', select: 'fullName email source status' },
      { path: 'owner', select: 'firstName lastName email role' },
    ],
    sort: { updatedAt: -1 },
  },
  activities: {
    model: CrmActivity,
    singular: 'activity',
    entityType: 'activity',
    label: 'פעילות',
    searchFields: ['subject', 'summary', 'outcome'],
    statusField: null,
    allowed: [
      'type',
      'direction',
      'channel',
      'subject',
      'summary',
      'outcome',
      'happenedAt',
      'account',
      'contact',
      'lead',
      'opportunity',
      'owner',
      'metadata',
      'active',
    ],
    populate: [
      { path: 'account', select: 'name type lifecycleStatus' },
      { path: 'contact', select: 'firstName lastName email phone' },
      { path: 'lead', select: 'fullName email source status' },
      { path: 'opportunity', select: 'name stage amount probability' },
      { path: 'owner', select: 'firstName lastName email role' },
    ],
    sort: { happenedAt: -1 },
  },
  tasks: {
    model: CrmTask,
    singular: 'task',
    entityType: 'task',
    label: 'משימה',
    searchFields: ['title', 'description'],
    statusField: 'status',
    allowed: [
      'title',
      'description',
      'status',
      'priority',
      'dueAt',
      'completedAt',
      'assignee',
      'createdBy',
      'account',
      'contact',
      'lead',
      'opportunity',
      'tags',
      'customFields',
      'active',
    ],
    populate: [
      { path: 'assignee', select: 'firstName lastName email role' },
      { path: 'createdBy', select: 'firstName lastName email role' },
      { path: 'account', select: 'name type lifecycleStatus' },
      { path: 'contact', select: 'firstName lastName email phone' },
      { path: 'lead', select: 'fullName email source status' },
      { path: 'opportunity', select: 'name stage amount probability' },
    ],
    sort: { dueAt: 1, updatedAt: -1 },
  },
};

function hasPath(model, path) {
  return Boolean(model.schema.path(path));
}

function pickAllowed(input, allowed) {
  const out = {};
  allowed.forEach((key) => {
    if (input[key] !== undefined) out[key] = input[key];
  });
  return out;
}

function resolvePropertyId(req, source = null) {
  const propertyId = source
    || req.query.propertyId
    || req.body.propertyId
    || req.actor?.propertyId
    || null;

  if (!propertyId) {
    const err = new Error('propertyId נדרש');
    err.status = 400;
    throw err;
  }

  assertPropertyScope(req, String(propertyId));
  return String(propertyId);
}

async function appendTimeline({
  req,
  property,
  entityType,
  entityId,
  eventType,
  title,
  description = '',
  payload = {},
  source = 'system',
}) {
  try {
    const actorId = req.actor?.id;
    await CrmTimelineEvent.create({
      property,
      entityType,
      entityId: String(entityId),
      eventType,
      title,
      description,
      source,
      actor: actorId && mongoose.Types.ObjectId.isValid(actorId) ? actorId : null,
      payload,
      happenedAt: new Date(),
    });
  } catch (err) {
    // Timeline is helpful, but must never break the main business flow.
    console.error('[crm.timeline] write failed:', err.message);
  }
}

const DEFAULT_PIPELINE_STAGES = [
  { key: 'qualification', name: 'Qualification', order: 1, probabilityDefault: 10, requiredFields: ['account'], closeType: 'none' },
  { key: 'discovery', name: 'Discovery', order: 2, probabilityDefault: 25, requiredFields: ['account'], closeType: 'none' },
  { key: 'proposal', name: 'Proposal', order: 3, probabilityDefault: 50, requiredFields: ['account', 'amount'], closeType: 'none' },
  { key: 'negotiation', name: 'Negotiation', order: 4, probabilityDefault: 70, requiredFields: ['account', 'amount'], closeType: 'none' },
  { key: 'contract', name: 'Contract', order: 5, probabilityDefault: 85, requiredFields: ['account', 'amount'], closeType: 'none' },
  { key: 'closed_won', name: 'Closed Won', order: 6, probabilityDefault: 100, requiredFields: ['account', 'amount'], closeType: 'won' },
  { key: 'closed_lost', name: 'Closed Lost', order: 7, probabilityDefault: 0, requiredFields: ['account', 'lostReason'], closeType: 'lost' },
];

function getLeadTotalScore(lead) {
  return Number(lead?.score?.total || 0);
}

function includesAllTags(current = [], required = []) {
  if (!required?.length) return true;
  const bucket = new Set((current || []).map((x) => String(x).toLowerCase()));
  return required.every((tag) => bucket.has(String(tag).toLowerCase()));
}

function matchRoutingRule(lead, rule) {
  const cond = rule?.conditions || {};
  if (cond.sources?.length && !cond.sources.includes(lead.source)) return false;
  if (cond.statuses?.length && !cond.statuses.includes(lead.status)) return false;

  const total = getLeadTotalScore(lead);
  if (cond.minScore !== null && cond.minScore !== undefined && total < Number(cond.minScore)) return false;
  if (cond.maxScore !== null && cond.maxScore !== undefined && total > Number(cond.maxScore)) return false;
  if (!includesAllTags(lead.tags, cond.requiredTags)) return false;
  return true;
}

async function chooseOwnerFromRule(rule, propertyId) {
  const assignment = rule?.assignment || {};

  if (assignment.strategy === 'single_owner') {
    if (!assignment.owner) return { ownerId: null, assignmentStrategy: 'single_owner' };
    const owner = await User.findOne({ _id: assignment.owner, property: propertyId, active: true }).select('_id').lean();
    return { ownerId: owner?._id || null, assignmentStrategy: 'single_owner' };
  }

  if (assignment.strategy === 'round_robin') {
    const pool = assignment.ownerPool || [];
    if (!pool.length) return { ownerId: null, assignmentStrategy: 'round_robin' };

    const activeOwners = await User.find({
      _id: { $in: pool },
      property: propertyId,
      active: true,
    }).select('_id').lean();
    if (!activeOwners.length) return { ownerId: null, assignmentStrategy: 'round_robin' };

    const cursor = Number(rule.roundRobinCursor || 0);
    const chosen = activeOwners[cursor % activeOwners.length];
    rule.roundRobinCursor = (cursor + 1) % Math.max(activeOwners.length, 1);
    await rule.save();

    return { ownerId: chosen?._id || null, assignmentStrategy: 'round_robin' };
  }

  return { ownerId: null, assignmentStrategy: assignment.strategy || 'unassigned' };
}

function summarizeRequiredFieldViolations(opportunity, requiredFields = [], stageKey = '') {
  const missing = [];
  requiredFields.forEach((field) => {
    const value = opportunity[field];
    if (value === null || value === undefined || value === '') missing.push(field);
    if (field === 'amount' && Number(opportunity.amount || 0) <= 0) missing.push(field);
  });

  if (!missing.length) return null;
  return `לא ניתן לעבור לשלב ${stageKey}. חסרים שדות: ${[...new Set(missing)].join(', ')}`;
}

async function findOrCreateDefaultPipeline(propertyId) {
  let pipeline = await CrmPipeline.findOne({ property: propertyId, key: 'default', active: true });
  if (pipeline) return pipeline;

  pipeline = await CrmPipeline.create({
    property: propertyId,
    key: 'default',
    name: 'Default Sales Pipeline',
    stages: DEFAULT_PIPELINE_STAGES,
    active: true,
  });
  return pipeline;
}

async function findPipelineForOpportunity(propertyId, pipelineKey = 'default') {
  const key = pipelineKey || 'default';
  const pipeline = await CrmPipeline.findOne({ property: propertyId, key, active: true });
  if (pipeline) return pipeline;
  if (key === 'default') return findOrCreateDefaultPipeline(propertyId);
  return null;
}

function findStageConfig(pipeline, stageKey) {
  if (!pipeline?.stages?.length) return null;
  return pipeline.stages.find((stage) => stage.key === stageKey && stage.active !== false) || null;
}

function isoDateOrNull(input) {
  if (!input) return null;
  const v = String(input);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function computeHealthStatus(opportunity) {
  const last = opportunity.lastActivityAt ? new Date(opportunity.lastActivityAt) : null;
  const now = Date.now();
  const daysFromLast = last ? Math.floor((now - last.getTime()) / 86400000) : 999;
  const closeDate = opportunity.expectedCloseDate ? new Date(`${opportunity.expectedCloseDate}T00:00:00Z`) : null;
  const overdue = closeDate ? closeDate.getTime() < now : false;

  if (opportunity.stage === 'closed_won') return 'healthy';
  if (opportunity.stage === 'closed_lost') return 'stalled';
  if (daysFromLast > 30) return 'stalled';
  if (daysFromLast > 14 || overdue) return 'at_risk';
  return 'healthy';
}

async function applyOpportunityStageChange({
  req,
  opportunity,
  nextStage,
  reason = '',
  closedAt = null,
  probability = undefined,
  expectedCloseDate = undefined,
  healthStatus = undefined,
  skipValidation = false,
}) {
  const propertyId = String(opportunity.property);
  const pipeline = await findPipelineForOpportunity(propertyId, opportunity.pipelineKey || 'default');
  if (!pipeline) {
    const err = new Error(`Pipeline לא נמצא: ${opportunity.pipelineKey}`);
    err.status = 400;
    throw err;
  }
  const stageConfig = findStageConfig(pipeline, nextStage);
  if (!stageConfig) {
    const err = new Error(`שלב לא קיים ב-pipeline: ${nextStage}`);
    err.status = 400;
    throw err;
  }

  if (!skipValidation) {
    const validationSource = {
      ...opportunity.toObject(),
      lostReason: reason || opportunity.lostReason,
    };
    const fieldError = summarizeRequiredFieldViolations(validationSource, stageConfig.requiredFields, nextStage);
    if (fieldError) {
      const err = new Error(fieldError);
      err.status = 400;
      throw err;
    }
  }

  const before = opportunity.toObject();
  opportunity.stage = nextStage;

  if (probability !== undefined) {
    opportunity.probability = Number(probability);
  } else if (stageConfig.probabilityDefault !== undefined) {
    opportunity.probability = Number(stageConfig.probabilityDefault);
  }

  if (expectedCloseDate !== undefined) {
    const parsed = isoDateOrNull(expectedCloseDate);
    if (expectedCloseDate && !parsed) {
      const err = new Error('expectedCloseDate חייב להיות YYYY-MM-DD');
      err.status = 400;
      throw err;
    }
    opportunity.expectedCloseDate = parsed;
  }

  if (stageConfig.closeType === 'won') {
    opportunity.closedAt = closedAt ? new Date(closedAt) : new Date();
    opportunity.lostReason = null;
    opportunity.healthStatus = 'healthy';
  } else if (stageConfig.closeType === 'lost') {
    const finalReason = reason || opportunity.lostReason;
    if (!finalReason) {
      const err = new Error('reason נדרש ב-closed_lost');
      err.status = 400;
      throw err;
    }
    opportunity.lostReason = finalReason;
    opportunity.closedAt = closedAt ? new Date(closedAt) : new Date();
    opportunity.healthStatus = 'stalled';
  } else {
    opportunity.closedAt = null;
    if (healthStatus) opportunity.healthStatus = healthStatus;
  }

  await opportunity.save();

  await audit({
    property: propertyId,
    ...auditCtxFromReq(req),
    action: 'crm.opportunity.stage_change',
    entityType: 'CrmOpportunity',
    entityId: opportunity._id,
    before,
    after: opportunity.toObject(),
    reason: reason || '',
  });

  await appendTimeline({
    req,
    property: propertyId,
    entityType: 'opportunity',
    entityId: opportunity._id,
    eventType: 'opportunity.stage_changed',
    title: 'שלב עסקה השתנה',
    description: `${before.stage} -> ${opportunity.stage}`,
    payload: {
      fromStage: before.stage,
      toStage: opportunity.stage,
      reason: reason || null,
      pipelineKey: opportunity.pipelineKey,
    },
    source: 'workflow',
  });

  return opportunity;
}

function listEntities(kind) {
  return asyncHandler(async (req, res) => {
    const cfg = registry[kind];
    const propertyId = resolvePropertyId(req);
    const { q, status, source, page = 1, limit = 50 } = req.query;
    const parsedPage = Math.max(1, Number(page) || 1);
    const parsedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = (parsedPage - 1) * parsedLimit;

    const filter = { property: propertyId };
    if (hasPath(cfg.model, 'active')) filter.active = true;
    if (q && cfg.searchFields.length) {
      filter.$or = cfg.searchFields.map((field) => ({
        [field]: { $regex: q, $options: 'i' },
      }));
    }
    if (status && cfg.statusField) filter[cfg.statusField] = status;
    if (source && hasPath(cfg.model, 'source')) filter.source = source;

    const total = await cfg.model.countDocuments(filter);
    const query = cfg.model.find(filter).sort(cfg.sort).skip(skip).limit(parsedLimit);
    cfg.populate.forEach((p) => query.populate(p));
    const items = await query.lean();

    res.json({
      success: true,
      data: {
        items,
        total,
        page: parsedPage,
        pages: Math.ceil(total / parsedLimit),
      },
    });
  });
}

function getEntity(kind) {
  return asyncHandler(async (req, res) => {
    const cfg = registry[kind];
    const item = await cfg.model.findById(req.params.id).populate(cfg.populate).lean();
    if (!item) return res.status(404).json({ success: false, error: `${cfg.label} לא נמצא` });
    assertPropertyScope(req, String(item.property));
    res.json({ success: true, data: item });
  });
}

function createEntity(kind) {
  return asyncHandler(async (req, res) => {
    const cfg = registry[kind];
    const propertyId = resolvePropertyId(req);
    const payload = pickAllowed(req.body, cfg.allowed);
    payload.property = propertyId;

    if (kind === 'tasks' && !payload.createdBy && req.actor?.id) payload.createdBy = req.actor.id;
    if (['accounts', 'contacts', 'leads', 'opportunities', 'activities'].includes(kind) && !payload.owner && req.actor?.id) {
      payload.owner = req.actor.id;
    }

    const created = await cfg.model.create(payload);

    await audit({
      property: propertyId,
      ...auditCtxFromReq(req),
      action: `crm.${cfg.singular}.create`,
      entityType: `Crm${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)}`,
      entityId: created._id,
      after: created.toObject(),
    });
    await appendTimeline({
      req,
      property: propertyId,
      entityType: cfg.entityType,
      entityId: created._id,
      eventType: `${cfg.singular}.created`,
      title: `${cfg.label} נוצר`,
      payload: { id: String(created._id) },
      source: 'manual',
    });

    const hydrated = await cfg.model.findById(created._id).populate(cfg.populate).lean();
    res.status(201).json({ success: true, data: hydrated });
  });
}

function patchEntity(kind) {
  return asyncHandler(async (req, res) => {
    const cfg = registry[kind];
    const item = await cfg.model.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: `${cfg.label} לא נמצא` });
    assertPropertyScope(req, String(item.property));

    const update = pickAllowed(req.body, cfg.allowed);
    delete update.property;
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, error: 'לא נשלחו שדות לעדכון' });
    }

    const before = item.toObject();
    Object.assign(item, update);
    await item.save();
    const after = item.toObject();

    await audit({
      property: String(item.property),
      ...auditCtxFromReq(req),
      action: `crm.${cfg.singular}.update`,
      entityType: `Crm${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)}`,
      entityId: item._id,
      before,
      after,
    });
    await appendTimeline({
      req,
      property: String(item.property),
      entityType: cfg.entityType,
      entityId: item._id,
      eventType: `${cfg.singular}.updated`,
      title: `${cfg.label} עודכן`,
      payload: { updatedFields: Object.keys(update) },
      source: 'manual',
    });

    const hydrated = await cfg.model.findById(item._id).populate(cfg.populate).lean();
    res.json({ success: true, data: hydrated });
  });
}

function deleteEntity(kind) {
  return asyncHandler(async (req, res) => {
    const cfg = registry[kind];
    const item = await cfg.model.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: `${cfg.label} לא נמצא` });
    assertPropertyScope(req, String(item.property));

    if (hasPath(cfg.model, 'active')) {
      item.active = false;
      await item.save();
    } else {
      await cfg.model.deleteOne({ _id: item._id });
    }

    await audit({
      property: String(item.property),
      ...auditCtxFromReq(req),
      action: `crm.${cfg.singular}.delete`,
      entityType: `Crm${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)}`,
      entityId: item._id,
      after: hasPath(cfg.model, 'active') ? item.toObject() : undefined,
    });
    await appendTimeline({
      req,
      property: String(item.property),
      entityType: cfg.entityType,
      entityId: item._id,
      eventType: `${cfg.singular}.deleted`,
      title: `${cfg.label} נמחק`,
      source: 'manual',
    });

    res.json({ success: true, data: { deleted: true } });
  });
}

// Overview
router.get('/overview', asyncHandler(async (req, res) => {
  const propertyId = resolvePropertyId(req);
  const filter = { property: propertyId, active: true };
  const [accounts, contacts, leads, opportunities, activities, tasks] = await Promise.all([
    CrmAccount.countDocuments(filter),
    CrmContact.countDocuments(filter),
    CrmLead.countDocuments(filter),
    CrmOpportunity.countDocuments(filter),
    CrmActivity.countDocuments(filter),
    CrmTask.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { accounts, contacts, leads, opportunities, activities, tasks },
  });
}));

// Accounts
router.get('/accounts', listEntities('accounts'));
router.post('/accounts', createEntity('accounts'));
router.get('/accounts/:id', getEntity('accounts'));
router.patch('/accounts/:id', patchEntity('accounts'));
router.delete('/accounts/:id', deleteEntity('accounts'));

// Contacts
router.get('/contacts', listEntities('contacts'));
router.post('/contacts', createEntity('contacts'));
router.get('/contacts/:id', getEntity('contacts'));
router.patch('/contacts/:id', patchEntity('contacts'));
router.delete('/contacts/:id', deleteEntity('contacts'));

// Leads
router.get('/leads', listEntities('leads'));
router.post('/leads', createEntity('leads'));
router.get('/leads/:id', getEntity('leads'));
router.patch('/leads/:id', patchEntity('leads'));
router.delete('/leads/:id', deleteEntity('leads'));

// Lead Routing Rules
router.get('/lead-routing-rules', asyncHandler(async (req, res) => {
  const propertyId = resolvePropertyId(req);
  const rules = await CrmLeadRoutingRule.find({ property: propertyId })
    .sort({ priority: 1, createdAt: 1 })
    .populate('assignment.owner', 'firstName lastName email role')
    .populate('assignment.ownerPool', 'firstName lastName email role')
    .lean();
  res.json({ success: true, data: rules });
}));

router.post('/lead-routing-rules', asyncHandler(async (req, res) => {
  const propertyId = resolvePropertyId(req);
  const payload = {
    property: propertyId,
    name: req.body.name,
    priority: req.body.priority ?? 100,
    active: req.body.active !== undefined ? Boolean(req.body.active) : true,
    conditions: req.body.conditions || {},
    assignment: req.body.assignment || {},
  };

  if (!payload.name) {
    return res.status(400).json({ success: false, error: 'name נדרש' });
  }

  const created = await CrmLeadRoutingRule.create(payload);
  await audit({
    property: propertyId,
    ...auditCtxFromReq(req),
    action: 'crm.lead_routing_rule.create',
    entityType: 'CrmLeadRoutingRule',
    entityId: created._id,
    after: created.toObject(),
  });

  res.status(201).json({ success: true, data: created });
}));

router.patch('/lead-routing-rules/:id', asyncHandler(async (req, res) => {
  const rule = await CrmLeadRoutingRule.findById(req.params.id);
  if (!rule) return res.status(404).json({ success: false, error: 'כלל ניתוב לא נמצא' });
  assertPropertyScope(req, String(rule.property));

  const before = rule.toObject();
  const allowed = ['name', 'priority', 'active', 'conditions', 'assignment', 'roundRobinCursor'];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) rule[field] = req.body[field];
  });
  await rule.save();

  await audit({
    property: String(rule.property),
    ...auditCtxFromReq(req),
    action: 'crm.lead_routing_rule.update',
    entityType: 'CrmLeadRoutingRule',
    entityId: rule._id,
    before,
    after: rule.toObject(),
  });

  res.json({ success: true, data: rule });
}));

router.delete('/lead-routing-rules/:id', asyncHandler(async (req, res) => {
  const rule = await CrmLeadRoutingRule.findById(req.params.id);
  if (!rule) return res.status(404).json({ success: false, error: 'כלל ניתוב לא נמצא' });
  assertPropertyScope(req, String(rule.property));

  const before = rule.toObject();
  rule.active = false;
  await rule.save();

  await audit({
    property: String(rule.property),
    ...auditCtxFromReq(req),
    action: 'crm.lead_routing_rule.deactivate',
    entityType: 'CrmLeadRoutingRule',
    entityId: rule._id,
    before,
    after: rule.toObject(),
  });

  res.json({ success: true, data: { deactivated: true } });
}));

router.post('/leads/:id/route', asyncHandler(async (req, res) => {
  const lead = await CrmLead.findById(req.params.id);
  if (!lead) return res.status(404).json({ success: false, error: 'ליד לא נמצא' });
  assertPropertyScope(req, String(lead.property));

  const before = lead.toObject();
  let appliedRule = null;
  if (req.body.ruleId) {
    appliedRule = await CrmLeadRoutingRule.findOne({
      _id: req.body.ruleId,
      property: lead.property,
      active: true,
    });
  } else {
    const rules = await CrmLeadRoutingRule.find({ property: lead.property, active: true })
      .sort({ priority: 1, createdAt: 1 });
    appliedRule = rules.find((rule) => matchRoutingRule(lead, rule)) || null;
  }

  let ownerId = null;
  let assignmentStrategy = 'unassigned';
  if (appliedRule) {
    const picked = await chooseOwnerFromRule(appliedRule, lead.property);
    ownerId = picked.ownerId || null;
    assignmentStrategy = picked.assignmentStrategy;
    if (appliedRule.assignment?.assignTeam) lead.assignedTeam = appliedRule.assignment.assignTeam;
  }

  if (!ownerId && req.body.ownerId) {
    const explicitOwner = await User.findOne({
      _id: req.body.ownerId,
      property: lead.property,
      active: true,
    }).select('_id').lean();
    ownerId = explicitOwner?._id || null;
    assignmentStrategy = 'manual_owner';
  }

  if (!ownerId && req.actor?.id && mongoose.Types.ObjectId.isValid(req.actor.id)) {
    ownerId = req.actor.id;
    assignmentStrategy = 'actor_fallback';
  }

  if (ownerId) lead.owner = ownerId;
  if (lead.status === 'new') lead.status = 'working';
  await lead.save();

  await audit({
    property: String(lead.property),
    ...auditCtxFromReq(req),
    action: 'crm.lead.route',
    entityType: 'CrmLead',
    entityId: lead._id,
    before,
    after: lead.toObject(),
    reason: appliedRule ? `rule:${appliedRule._id}` : 'no_rule',
  });

  await appendTimeline({
    req,
    property: String(lead.property),
    entityType: 'lead',
    entityId: lead._id,
    eventType: 'lead.routed',
    title: 'ליד נותב',
    description: ownerId ? 'הליד קיבל בעלים' : 'הליד נותב ללא בעלים',
    payload: {
      ruleId: appliedRule ? String(appliedRule._id) : null,
      ownerId: ownerId ? String(ownerId) : null,
      strategy: assignmentStrategy,
      assignedTeam: lead.assignedTeam || null,
    },
    source: 'workflow',
  });

  const hydratedLead = await CrmLead.findById(lead._id)
    .populate(registry.leads.populate)
    .lean();

  res.json({
    success: true,
    data: {
      lead: hydratedLead,
      routing: {
        ruleId: appliedRule ? String(appliedRule._id) : null,
        strategy: assignmentStrategy,
      },
    },
  });
}));

router.post('/leads/:id/convert', asyncHandler(async (req, res) => {
  const lead = await CrmLead.findById(req.params.id);
  if (!lead) return res.status(404).json({ success: false, error: 'ליד לא נמצא' });
  assertPropertyScope(req, String(lead.property));

  if (lead.status === 'converted') {
    return res.status(400).json({ success: false, error: 'הליד כבר הומר בעבר' });
  }

  const before = lead.toObject();
  const propertyId = String(lead.property);
  const createAccount = req.body.createAccount !== false;
  const createContact = req.body.createContact !== false;
  const createOpportunity = req.body.createOpportunity !== false;

  let account = null;
  if (req.body.accountId) {
    account = await CrmAccount.findOne({ _id: req.body.accountId, property: propertyId, active: true });
    if (!account) return res.status(404).json({ success: false, error: 'חשבון יעד לא נמצא' });
  } else if (lead.account) {
    account = await CrmAccount.findOne({ _id: lead.account, property: propertyId, active: true });
  } else if (createAccount) {
    account = await CrmAccount.create({
      property: propertyId,
      name: lead.companyName || lead.fullName,
      type: lead.companyName ? 'business' : 'person',
      lifecycleStatus: 'prospect',
      owner: lead.owner || req.actor?.id || null,
      email: lead.email || undefined,
      phone: lead.phone || undefined,
    });
  }

  let contact = null;
  if (req.body.contactId) {
    contact = await CrmContact.findOne({ _id: req.body.contactId, property: propertyId, active: true });
    if (!contact) return res.status(404).json({ success: false, error: 'איש קשר יעד לא נמצא' });
  } else if (lead.contact) {
    contact = await CrmContact.findOne({ _id: lead.contact, property: propertyId, active: true });
  } else if (createContact) {
    const parts = String(lead.fullName || '').trim().split(/\s+/);
    const firstName = parts.shift() || 'Lead';
    const lastName = parts.join(' ');
    contact = await CrmContact.create({
      property: propertyId,
      account: account?._id || null,
      firstName,
      lastName,
      email: lead.email || undefined,
      phone: lead.phone || undefined,
      title: lead.title || undefined,
      owner: lead.owner || req.actor?.id || null,
      lifecycleStatus: 'active',
    });
  }

  let opportunity = null;
  if (createOpportunity) {
    if (!account?._id) {
      return res.status(400).json({ success: false, error: 'נדרש חשבון כדי ליצור הזדמנות מהליד' });
    }
    const pipelineKey = req.body.pipelineKey || 'default';
    const stage = req.body.stage || 'qualification';
    opportunity = await CrmOpportunity.create({
      property: propertyId,
      account: account._id,
      primaryContact: contact?._id || null,
      lead: lead._id,
      name: req.body.opportunityName || `${lead.fullName} - Opportunity`,
      pipelineKey,
      stage,
      amount: Number(req.body.amount || 0),
      currency: req.body.currency || 'ILS',
      probability: Number(req.body.probability || 10),
      expectedCloseDate: isoDateOrNull(req.body.expectedCloseDate),
      owner: lead.owner || req.actor?.id || null,
      healthStatus: 'healthy',
    });
  }

  lead.account = account?._id || null;
  lead.contact = contact?._id || null;
  lead.status = 'converted';
  lead.convertedAt = new Date();
  lead.convertedOpportunity = opportunity?._id || null;
  await lead.save();

  await audit({
    property: propertyId,
    ...auditCtxFromReq(req),
    action: 'crm.lead.convert',
    entityType: 'CrmLead',
    entityId: lead._id,
    before,
    after: lead.toObject(),
  });

  await appendTimeline({
    req,
    property: propertyId,
    entityType: 'lead',
    entityId: lead._id,
    eventType: 'lead.converted',
    title: 'ליד הומר',
    payload: {
      accountId: account?._id ? String(account._id) : null,
      contactId: contact?._id ? String(contact._id) : null,
      opportunityId: opportunity?._id ? String(opportunity._id) : null,
    },
    source: 'workflow',
  });

  const hydratedLead = await CrmLead.findById(lead._id)
    .populate(registry.leads.populate)
    .lean();
  const hydratedOpportunity = opportunity
    ? await CrmOpportunity.findById(opportunity._id).populate(registry.opportunities.populate).lean()
    : null;

  res.json({
    success: true,
    data: {
      lead: hydratedLead,
      account,
      contact,
      opportunity: hydratedOpportunity,
    },
  });
}));

// Opportunities
router.get('/opportunities', listEntities('opportunities'));
router.post('/opportunities', createEntity('opportunities'));
router.get('/opportunities/:id', getEntity('opportunities'));
router.patch('/opportunities/:id', patchEntity('opportunities'));
router.delete('/opportunities/:id', deleteEntity('opportunities'));

// Pipelines
router.get('/pipelines', asyncHandler(async (req, res) => {
  const propertyId = resolvePropertyId(req);
  const pipelines = await CrmPipeline.find({ property: propertyId, active: true })
    .sort({ createdAt: 1 })
    .lean();
  res.json({ success: true, data: pipelines });
}));

router.post('/pipelines', asyncHandler(async (req, res) => {
  const propertyId = resolvePropertyId(req);
  const key = req.body.key || 'default';
  const name = req.body.name || 'Default Sales Pipeline';
  const stages = Array.isArray(req.body.stages) && req.body.stages.length
    ? req.body.stages
    : DEFAULT_PIPELINE_STAGES;

  const exists = await CrmPipeline.findOne({ property: propertyId, key });
  if (exists) {
    return res.status(400).json({ success: false, error: `Pipeline key already exists: ${key}` });
  }

  const created = await CrmPipeline.create({
    property: propertyId,
    key,
    name,
    description: req.body.description || '',
    stages,
    active: req.body.active !== undefined ? Boolean(req.body.active) : true,
  });

  await audit({
    property: propertyId,
    ...auditCtxFromReq(req),
    action: 'crm.pipeline.create',
    entityType: 'CrmPipeline',
    entityId: created._id,
    after: created.toObject(),
  });

  res.status(201).json({ success: true, data: created });
}));

router.patch('/pipelines/:id', asyncHandler(async (req, res) => {
  const pipeline = await CrmPipeline.findById(req.params.id);
  if (!pipeline) return res.status(404).json({ success: false, error: 'Pipeline לא נמצא' });
  assertPropertyScope(req, String(pipeline.property));

  const before = pipeline.toObject();
  const allowed = ['name', 'description', 'stages', 'active'];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) pipeline[field] = req.body[field];
  });
  await pipeline.save();

  await audit({
    property: String(pipeline.property),
    ...auditCtxFromReq(req),
    action: 'crm.pipeline.update',
    entityType: 'CrmPipeline',
    entityId: pipeline._id,
    before,
    after: pipeline.toObject(),
  });

  res.json({ success: true, data: pipeline });
}));

router.delete('/pipelines/:id', asyncHandler(async (req, res) => {
  const pipeline = await CrmPipeline.findById(req.params.id);
  if (!pipeline) return res.status(404).json({ success: false, error: 'Pipeline לא נמצא' });
  assertPropertyScope(req, String(pipeline.property));

  const before = pipeline.toObject();
  pipeline.active = false;
  await pipeline.save();

  await audit({
    property: String(pipeline.property),
    ...auditCtxFromReq(req),
    action: 'crm.pipeline.deactivate',
    entityType: 'CrmPipeline',
    entityId: pipeline._id,
    before,
    after: pipeline.toObject(),
  });

  res.json({ success: true, data: { deactivated: true } });
}));

router.post('/opportunities/:id/stage', asyncHandler(async (req, res) => {
  const opportunity = await CrmOpportunity.findById(req.params.id);
  if (!opportunity) return res.status(404).json({ success: false, error: 'הזדמנות לא נמצאה' });
  assertPropertyScope(req, String(opportunity.property));

  const nextStage = req.body.stage;
  if (!nextStage) return res.status(400).json({ success: false, error: 'stage נדרש' });
  if (opportunity.stage === nextStage) return res.json({ success: true, data: opportunity });

  await applyOpportunityStageChange({
    req,
    opportunity,
    nextStage,
    reason: req.body.reason || req.body.lostReason || '',
    closedAt: req.body.closedAt || null,
    probability: req.body.probability,
    expectedCloseDate: req.body.expectedCloseDate,
    healthStatus: req.body.healthStatus,
    skipValidation: req.body.skipValidation === true,
  });

  const hydrated = await CrmOpportunity.findById(opportunity._id).populate(registry.opportunities.populate).lean();
  res.json({ success: true, data: hydrated });
}));

router.post('/opportunities/:id/health/recalculate', asyncHandler(async (req, res) => {
  const opportunity = await CrmOpportunity.findById(req.params.id);
  if (!opportunity) return res.status(404).json({ success: false, error: 'הזדמנות לא נמצאה' });
  assertPropertyScope(req, String(opportunity.property));

  const before = opportunity.toObject();
  opportunity.healthStatus = computeHealthStatus(opportunity);
  await opportunity.save();

  await audit({
    property: String(opportunity.property),
    ...auditCtxFromReq(req),
    action: 'crm.opportunity.health_recalculate',
    entityType: 'CrmOpportunity',
    entityId: opportunity._id,
    before,
    after: opportunity.toObject(),
  });

  await appendTimeline({
    req,
    property: String(opportunity.property),
    entityType: 'opportunity',
    entityId: opportunity._id,
    eventType: 'opportunity.health_recalculated',
    title: 'בריאות הזדמנות חושבה מחדש',
    payload: { from: before.healthStatus, to: opportunity.healthStatus },
    source: 'system',
  });

  res.json({ success: true, data: opportunity });
}));

router.get('/forecast', asyncHandler(async (req, res) => {
  const propertyId = resolvePropertyId(req);
  const { pipelineKey, ownerId, from, to } = req.query;

  const filter = { property: propertyId, active: true };
  if (pipelineKey) filter.pipelineKey = pipelineKey;
  if (ownerId) filter.owner = ownerId;
  if (from || to) {
    filter.expectedCloseDate = {};
    if (from) filter.expectedCloseDate.$gte = from;
    if (to) filter.expectedCloseDate.$lte = to;
  }

  const opportunities = await CrmOpportunity.find(filter).lean();
  const open = opportunities.filter((op) => !['closed_won', 'closed_lost'].includes(op.stage));
  const won = opportunities.filter((op) => op.stage === 'closed_won');
  const lost = opportunities.filter((op) => op.stage === 'closed_lost');

  const byStage = {};
  open.forEach((op) => {
    const key = op.stage || 'unknown';
    if (!byStage[key]) byStage[key] = { count: 0, amount: 0, weighted: 0 };
    const amount = Number(op.amount || 0);
    const weighted = amount * (Number(op.probability || 0) / 100);
    byStage[key].count += 1;
    byStage[key].amount += amount;
    byStage[key].weighted += weighted;
  });

  const totalOpenAmount = open.reduce((sum, op) => sum + Number(op.amount || 0), 0);
  const weightedForecast = open.reduce((sum, op) => sum + (Number(op.amount || 0) * Number(op.probability || 0) / 100), 0);
  const commitForecast = open
    .filter((op) => Number(op.probability || 0) >= 70)
    .reduce((sum, op) => sum + Number(op.amount || 0), 0);
  const wonAmount = won.reduce((sum, op) => sum + Number(op.amount || 0), 0);
  const lostAmount = lost.reduce((sum, op) => sum + Number(op.amount || 0), 0);

  res.json({
    success: true,
    data: {
      totals: {
        openCount: open.length,
        openAmount: totalOpenAmount,
        weightedForecast,
        commitForecast,
        wonCount: won.length,
        wonAmount,
        lostCount: lost.length,
        lostAmount,
      },
      byStage,
    },
  });
}));

router.post('/opportunities/:id/close-won', asyncHandler(async (req, res) => {
  const opportunity = await CrmOpportunity.findById(req.params.id);
  if (!opportunity) return res.status(404).json({ success: false, error: 'הזדמנות לא נמצאה' });
  assertPropertyScope(req, String(opportunity.property));

  await applyOpportunityStageChange({
    req,
    opportunity,
    nextStage: 'closed_won',
    reason: req.body.reason || '',
    closedAt: req.body.closedAt || null,
    probability: req.body.probability,
    expectedCloseDate: req.body.expectedCloseDate,
    skipValidation: req.body.skipValidation === true,
  });

  const hydrated = await CrmOpportunity.findById(opportunity._id).populate(registry.opportunities.populate).lean();
  res.json({ success: true, data: hydrated });
}));

router.post('/opportunities/:id/close-lost', asyncHandler(async (req, res) => {
  const opportunity = await CrmOpportunity.findById(req.params.id);
  if (!opportunity) return res.status(404).json({ success: false, error: 'הזדמנות לא נמצאה' });
  assertPropertyScope(req, String(opportunity.property));

  await applyOpportunityStageChange({
    req,
    opportunity,
    nextStage: 'closed_lost',
    reason: req.body.reason || req.body.lostReason || '',
    closedAt: req.body.closedAt || null,
    probability: req.body.probability,
    expectedCloseDate: req.body.expectedCloseDate,
    skipValidation: req.body.skipValidation === true,
  });

  const hydrated = await CrmOpportunity.findById(opportunity._id).populate(registry.opportunities.populate).lean();
  res.json({ success: true, data: hydrated });
}));

// Activities
router.get('/activities', listEntities('activities'));
router.post('/activities', createEntity('activities'));
router.get('/activities/:id', getEntity('activities'));
router.patch('/activities/:id', patchEntity('activities'));
router.delete('/activities/:id', deleteEntity('activities'));

// Tasks
router.get('/tasks', listEntities('tasks'));
router.post('/tasks', createEntity('tasks'));
router.get('/tasks/:id', getEntity('tasks'));
router.patch('/tasks/:id', patchEntity('tasks'));
router.delete('/tasks/:id', deleteEntity('tasks'));

// Timeline
router.get('/timeline', asyncHandler(async (req, res) => {
  const propertyId = resolvePropertyId(req);
  const { entityType, entityId, page = 1, limit = 100 } = req.query;
  const parsedPage = Math.max(1, Number(page) || 1);
  const parsedLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const skip = (parsedPage - 1) * parsedLimit;
  const filter = { property: propertyId };
  if (entityType) filter.entityType = entityType;
  if (entityId) filter.entityId = String(entityId);

  const total = await CrmTimelineEvent.countDocuments(filter);
  const events = await CrmTimelineEvent.find(filter)
    .sort({ happenedAt: -1 })
    .skip(skip)
    .limit(parsedLimit)
    .populate('actor', 'firstName lastName email role')
    .lean();

  res.json({
    success: true,
    data: {
      items: events,
      total,
      page: parsedPage,
      pages: Math.ceil(total / parsedLimit),
    },
  });
}));

router.post('/timeline', asyncHandler(async (req, res) => {
  const propertyId = resolvePropertyId(req);
  const { entityType, entityId, eventType, title, description, payload } = req.body;
  if (!entityType || !entityId || !eventType || !title) {
    return res.status(400).json({ success: false, error: 'entityType/entityId/eventType/title נדרשים' });
  }

  const created = await CrmTimelineEvent.create({
    property: propertyId,
    entityType,
    entityId: String(entityId),
    eventType,
    title,
    description: description || '',
    source: 'manual',
    actor: req.actor?.id || null,
    payload: payload || {},
    happenedAt: new Date(),
  });

  await audit({
    property: propertyId,
    ...auditCtxFromReq(req),
    action: 'crm.timeline.create',
    entityType: 'CrmTimelineEvent',
    entityId: created._id,
    after: created.toObject(),
  });

  res.status(201).json({ success: true, data: created });
}));

export default router;
