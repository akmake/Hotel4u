import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Short-lived mutual exclusion for read-check-write operations that must not interleave
// (two clerks checking in the same reservation, two assignments of the same room).
// The unique key makes the second acquirer fail fast; the TTL frees a lock left by a crash.
const OperationLockSchema = new Schema({
  key:       { type: String, required: true, unique: true },
  owner:     String,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

OperationLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default model('OperationLock', OperationLockSchema);
