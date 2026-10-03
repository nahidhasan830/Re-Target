import { scryptSync, randomBytes } from 'node:crypto';

export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }).toString('hex');
  return `scrypt:16384:8:5:${salt}:${hash}`;
}
