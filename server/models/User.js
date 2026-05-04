import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
const { Schema, model } = mongoose;

export const ROLES = [
  'super_admin','property_admin','general_manager','front_desk_manager',
  'receptionist','housekeeping_manager','housekeeper','maintenance_manager',
  'technician','finance_manager','cashier','revenue_manager','sales_manager',
  'auditor','owner_readonly',
];

const UserSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property' },
  firstName:    { type: String, required: true },
  lastName:     { type: String, required: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ROLES, required: true },
  active:       { type: Boolean, default: true },
  lastLoginAt:  Date,
}, { timestamps: true });

UserSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

UserSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

UserSchema.pre('save', async function () {
  if (this.isModified('passwordHash')) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  }
});

export default model('User', UserSchema);
