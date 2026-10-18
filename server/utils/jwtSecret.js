import { randomBytes } from 'node:crypto';

// One source for the PMS token secret. There is no secret in the code: production refuses to start
// without one, and a dev server with no secret gets a random one (tokens die on restart).
// JWT_ACCESS_SECRET is accepted so deployments that only define it (render.yaml) keep working.
let devSecret = null;

export function pmsJwtSecret() {
  const configured = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is not set — refusing to sign or verify tokens');
  if (!devSecret) {
    devSecret = randomBytes(48).toString('hex');
    console.warn('[auth] JWT_SECRET is not set — using a random secret for this run only');
  }
  return devSecret;
}

/** Called once at startup so a production server without a secret fails loudly instead of on first login. */
export function assertJwtSecretConfigured() {
  if (process.env.NODE_ENV === 'production' && !(process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET)) {
    throw new Error('JWT_SECRET (or JWT_ACCESS_SECRET) must be set in production');
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.warn('[auth] JWT_SECRET is shorter than 32 characters');
  }
}
