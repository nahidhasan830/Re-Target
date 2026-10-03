import { scryptSync, timingSafeEqual } from 'node:crypto';

export const PASSWORD_HASH_PATTERN = /^(?:pbkdf2-sha256:100000|scrypt:16384:8:5):[a-f0-9]{32}:[a-f0-9]{64}$/;
const options = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const encoder = new TextEncoder();

export async function verifyPassword(password: string, hash: string) {
  if (!PASSWORD_HASH_PATTERN.test(hash) || !password.length || password.length > 128) return false;
  const parts = hash.split(':');
  const salt = Buffer.from(parts.at(-2)!, 'hex');
  const expected = Buffer.from(parts.at(-1)!, 'hex');
  if (parts[0] === 'scrypt') return timingSafeEqual(scryptSync(password, salt, 32, options), expected);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return timingSafeEqual(new Uint8Array(actual), expected);
}

export async function hashPassword(password: string) {
  if (!password.length || password.length > 128) throw new Error('Invalid password length.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = scryptSync(password, salt, 32, options);
  return `scrypt:16384:8:5:${Buffer.from(salt).toString('hex')}:${hash.toString('hex')}`;
}
