// Encrypts secrets kept in the database (Tax Authority OAuth tokens) with AES-256-GCM.
// Key: TAX_TOKEN_KEY (any string, hashed to 32 bytes); falls back to a key derived from JWT_SECRET so
// a dev install works — production should set its own TAX_TOKEN_KEY.
import crypto from 'crypto';

function key() {
  const base = process.env.TAX_TOKEN_KEY || `hotel4u-ita:${process.env.JWT_SECRET || 'dev'}`;
  return crypto.createHash('sha256').update(base).digest();
}

export function seal(plain) {
  if (plain === undefined || plain === null || plain === '') return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function open(sealed) {
  if (!sealed || typeof sealed !== 'string' || !sealed.startsWith('v1:')) return null;
  try {
    const [, iv, tag, data] = sealed.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
