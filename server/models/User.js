import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema, model } = mongoose;

const MAX_FAILED = 5;
const LOCK_MS    = 10 * 60 * 1000;

// ─── All roles: Ziporiclass + PMS ────────────────────────────────────────────
export const ROLES = [
  // Ziporiclass
  'admin', 'sales', 'maintenance', 'shift_manager',
  // PMS hotel4u
  'super_admin', 'property_admin', 'general_manager', 'front_desk_manager',
  'receptionist', 'housekeeping_manager', 'housekeeper', 'maintenance_manager',
  'technician', 'finance_manager', 'cashier', 'revenue_manager', 'sales_manager',
  'auditor', 'owner_readonly',
];

// ─── PMS role groups (used for route guarding) ────────────────────────────────
export const PMS_ROLES = [
  'super_admin', 'property_admin', 'general_manager', 'front_desk_manager',
  'receptionist', 'housekeeping_manager', 'housekeeper', 'maintenance_manager',
  'technician', 'finance_manager', 'cashier', 'revenue_manager', 'sales_manager',
  'auditor', 'owner_readonly',
];

export const ZIPORICLASS_ROLES = ['admin', 'sales', 'maintenance', 'shift_manager', 'housekeeper'];

// ─── Cart item (Ziporiclass) ──────────────────────────────────────────────────
const cartItemSchema = new Schema({
  product:  { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, min: 1, default: 1 },
}, { _id: false });

// ─── Unified User schema ──────────────────────────────────────────────────────
const UserSchema = new Schema({
  // Identity
  // Ziporiclass uses `name` (full name string)
  // PMS uses `firstName` + `lastName` (auto-merged into `name` on save)
  name:      { type: String, trim: true },
  firstName: { type: String, trim: true },
  lastName:  { type: String, trim: true },

  email:        { type: String, required: true, unique: true, lowercase: true, trim: true,
                  match: [/^\S+@\S+\.\S+$/, 'פורמט אימייל לא תקין'] },
  passwordHash: { type: String, required: true },

  // Role — single field, all roles from both systems
  role:     { type: String, enum: ROLES, required: true, default: 'sales' },

  // PMS: which property this user belongs to
  property: { type: Schema.Types.ObjectId, ref: 'Property' },

  // Status
  active:      { type: Boolean, default: true },
  lastLoginAt: { type: Date },

  // Ziporiclass-specific permissions
  canManagePriceLists: { type: Boolean, default: false },
  canViewCommissions:  { type: Boolean, default: false },
  reportNames:         { type: [String], default: [] },
  cart:                { type: [cartItemSchema], default: [] },
  uiPreferences: {
    bulkJobsDefaultPresetByProperty: { type: Map, of: String, default: {} },
    bulkJobsFilterBundlesByProperty: { type: Map, of: Schema.Types.Mixed, default: {} },
  },

  // Security
  forcedLogoutTime:    { type: String, default: null },
  twoFactorEnabled:    { type: Boolean, default: false },
  totpSecret:          { type: String, default: '' },
  failedLoginAttempts: { type: Number, default: 0 },
  lockUntil:           { type: Date, default: null },
  tokenVersion:        { type: Number, default: 0 },      // bumped on deactivation / password change / "log out everywhere"
  accessUntil:         { type: Date, default: null },     // ADM-06-F07: end of access for temps and vendors
  language:            { type: String, enum: ['he', 'en'], default: 'he' },
  displayName:         { type: String, maxlength: 100 },
  deactivatedAt:       Date,
  deactivatedBy:       String,
}, { timestamps: true, versionKey: false });

// ─── Virtuals ─────────────────────────────────────────────────────────────────
UserSchema.virtual('fullName').get(function () {
  if (this.firstName || this.lastName) {
    return `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }
  return this.name || '';
});

UserSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ─── Pre-save ─────────────────────────────────────────────────────────────────
// Mongoose 9: async hooks must not take/call `next` (calling it throws "next is not a function")
UserSchema.pre('save', async function () {
  // Auto-fill `name` from firstName+lastName for PMS users
  if (!this.name && (this.firstName || this.lastName)) {
    this.name = `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }

  // Hash password only if it's plain text (not already a bcrypt hash)
  if (this.isModified('passwordHash') && !this.passwordHash.startsWith('$2')) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  }
});

// ─── Methods ──────────────────────────────────────────────────────────────────
UserSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

UserSchema.methods.incrementLoginAttempts = function () {
  if (this.isLocked) return;
  const updates = { $inc: { failedLoginAttempts: 1 } };
  if (this.failedLoginAttempts + 1 >= MAX_FAILED) {
    updates.$set = { lockUntil: Date.now() + LOCK_MS };
  }
  return this.updateOne(updates);
};

UserSchema.methods.resetLoginAttempts = function () {
  if (this.failedLoginAttempts || this.lockUntil) {
    return this.updateOne({ failedLoginAttempts: 0, lockUntil: null });
  }
};

export default mongoose.models.User || model('User', UserSchema);
