import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// SYS-02 / ADM-06: one-time links for setting or resetting a password. Only a hash of the token is
// stored; a token is valid once and until it expires.
const AuthTokenSchema = new Schema({
  user:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind:      { type: String, enum: ['reset', 'setup'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt:    Date,
  createdBy: String,
}, { timestamps: true });

AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
AuthTokenSchema.index({ user: 1, kind: 1, createdAt: -1 });

export default model('AuthToken', AuthTokenSchema);
