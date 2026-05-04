/**
 * פרק י"ח — Permissions Middleware
 * Roles & Permissions matrix per spec sections 34–35.
 *
 * Usage:
 *   import { can } from '../middleware/permissions.js';
 *   router.post('/', can('reservation.create'), asyncHandler(...));
 */

// ── Role hierarchy ─────────────────────────────────────────────────────────────
export const ROLES = [
  'super_admin',
  'chain_admin',
  'property_admin',
  'general_manager',
  'front_desk_manager',
  'receptionist',
  'housekeeping_manager',
  'housekeeper',
  'maintenance_manager',
  'technician',
  'finance_manager',
  'cashier',
  'revenue_manager',
  'sales_manager',
  'auditor',
  'owner_readonly',
];

// ── Permission → allowed roles ────────────────────────────────────────────────
// spec section 35: critical permissions
const PERMISSION_MAP = {
  // Reservations
  'reservation.create':       ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','receptionist','sales_manager'],
  'reservation.modify':       ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','receptionist','sales_manager'],
  'reservation.cancel':       ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','sales_manager'],
  'reservation.noshow':       ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager'],
  'reservation.price_change': ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','revenue_manager'],
  'reservation.price_override':['super_admin','chain_admin','property_admin','general_manager'],

  // Check-in / Check-out
  'checkin':    ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','receptionist'],
  'checkout':   ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','receptionist'],

  // Folio
  'folio.open':  ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','receptionist','cashier','finance_manager'],
  'folio.close': ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','cashier','finance_manager'],
  'folio.reopen':['super_admin','chain_admin','property_admin','general_manager','finance_manager'],

  // Financial operations
  'payment.refund':     ['super_admin','chain_admin','property_admin','general_manager','finance_manager','cashier'],
  'payment.void':       ['super_admin','chain_admin','property_admin','general_manager','finance_manager'],
  'payment.adjustment': ['super_admin','chain_admin','property_admin','general_manager','finance_manager'],
  'payment.line_delete':['super_admin','property_admin','general_manager','finance_manager'],
  'invoice.generate':   ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','cashier','finance_manager'],

  // Rooms
  'room.status_change': ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','housekeeping_manager'],
  'room.block':         ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager','maintenance_manager'],
  'room.release':       ['super_admin','chain_admin','property_admin','general_manager','front_desk_manager'],

  // Rates & Channels
  'rates.manage':    ['super_admin','chain_admin','property_admin','general_manager','revenue_manager'],
  'channels.manage': ['super_admin','chain_admin','property_admin','general_manager','revenue_manager'],

  // Reports & Data
  'reports.financial': ['super_admin','chain_admin','property_admin','general_manager','finance_manager','revenue_manager','auditor','owner_readonly'],
  'reports.export':    ['super_admin','chain_admin','property_admin','general_manager','finance_manager','revenue_manager'],
  'audit_log.view':    ['super_admin','chain_admin','property_admin','general_manager','finance_manager','auditor'],

  // Users & Settings
  'users.manage':    ['super_admin','chain_admin','property_admin'],
  'settings.manage': ['super_admin','chain_admin','property_admin','general_manager'],

  // Housekeeping
  'housekeeping.assign':  ['super_admin','property_admin','general_manager','housekeeping_manager'],
  'housekeeping.inspect': ['super_admin','property_admin','general_manager','housekeeping_manager'],

  // Maintenance
  'maintenance.assign': ['super_admin','property_admin','general_manager','maintenance_manager'],
  'maintenance.close':  ['super_admin','property_admin','general_manager','maintenance_manager'],

  // Automation
  'automation.manage': ['super_admin','chain_admin','property_admin','general_manager'],
};

// ── Middleware factory ─────────────────────────────────────────────────────────
/**
 * can(permission)
 * Returns an Express middleware that verifies the actor has the given permission.
 *
 * @param {string} permission  - key from PERMISSION_MAP
 */
export function can(permission) {
  return (req, res, next) => {
    const actor = req.actor;

    // Unauthenticated
    if (!actor) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const allowedRoles = PERMISSION_MAP[permission];
    if (!allowedRoles) {
      // Unknown permission — deny by default
      return res.status(403).json({ success: false, error: `Unknown permission: ${permission}` });
    }

    if (!allowedRoles.includes(actor.role)) {
      return res.status(403).json({
        success: false,
        error: `Permission denied: requires one of [${allowedRoles.join(', ')}], you have "${actor.role}"`,
      });
    }

    next();
  };
}

/**
 * hasPermission(actor, permission) → boolean
 * Pure utility (no Express context needed).
 */
export function hasPermission(actor, permission) {
  if (!actor?.role) return false;
  const allowed = PERMISSION_MAP[permission];
  if (!allowed) return false;
  return allowed.includes(actor.role);
}

/**
 * actorPermissions(actor) → string[]
 * Returns the full list of permissions the actor holds.
 */
export function actorPermissions(actor) {
  if (!actor?.role) return [];
  return Object.entries(PERMISSION_MAP)
    .filter(([, roles]) => roles.includes(actor.role))
    .map(([perm]) => perm);
}
