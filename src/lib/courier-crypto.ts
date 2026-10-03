import { env } from 'cloudflare:workers';
import { HttpError } from './http';
import type { CourierProvider } from './courier-validation';

const encoder = new TextEncoder();
async function encryptionKey() {
  if (!/^[a-f0-9]{64}$/.test(env.COURIER_ENCRYPTION_KEY ?? '')) throw new HttpError(503, 'Courier settings are unavailable. Try again shortly.');
  return crypto.subtle.importKey('raw', Buffer.from(env.COURIER_ENCRYPTION_KEY, 'hex'), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptCourier(ownerId: string, provider: CourierProvider, value: unknown, session = false) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${ownerId}:${provider}${session ? ':session' : ''}`) }, await encryptionKey(), encoder.encode(JSON.stringify(value)));
  return `v1:${Buffer.from(iv).toString('base64')}:${Buffer.from(encrypted).toString('base64')}`;
}

export async function decryptCourier<T>(ownerId: string, provider: CourierProvider, envelope: string, session = false): Promise<T> {
  const [version, iv, encrypted] = envelope.split(':');
  if (version !== 'v1' || !iv || !encrypted) throw new Error('Invalid credential envelope.');
  const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64'), additionalData: encoder.encode(`${ownerId}:${provider}${session ? ':session' : ''}`) }, await encryptionKey(), Buffer.from(encrypted, 'base64'));
  return JSON.parse(new TextDecoder().decode(decoded));
}
