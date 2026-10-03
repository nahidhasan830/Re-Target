import { env } from 'cloudflare:workers';
import { HttpError, readBody } from './http';
import { sessionRestriction, type WhatsAppRestriction } from './whatsapp-restrictions';

const SESSION = 'admin';
export const QR_REFRESH_SECONDS = 5;
export type WhatsAppSession = { name?: string; status: string; me?: { id?: string } | null };
export type WhatsAppState = { status: string; phone: string | null; qr: string | null; refreshAfterSeconds: number; restriction?: WhatsAppRestriction };

export async function gatewayRequest(path: string, method = 'GET', body?: unknown, timeout = 10000) {
  const base = env.WAHA_BASE_URL;
  const key = env.WAHA_API_KEY;
  if (!base || !key || key.startsWith('replace-with-')) throw new HttpError(503, 'WhatsApp is unavailable. Try again shortly.');
  const url = new URL(base);
  const endpoint = new URL(path, url);
  if (url.username || url.password || url.search || url.hash || endpoint.origin !== url.origin ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new HttpError(503, 'WhatsApp requires a protected HTTPS service.');
  }
  const headers: Record<string, string> = { 'X-Api-Key': key, Accept: 'application/json' };
  if (new URL(base).protocol === 'https:' && env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(endpoint, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(timeout),
    });
  } catch { throw new HttpError(503, 'Couldn’t reach WhatsApp. Try again shortly.'); }
}

export async function gatewayJson(response: Response) {
  try { return JSON.parse(await readBody(response, 1024 * 1024)); }
  catch { throw new HttpError(503, 'WhatsApp returned an unexpected response.'); }
}

async function session(name: string): Promise<WhatsAppSession | null> {
  const response = await gatewayRequest(`/api/sessions/${encodeURIComponent(name)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new HttpError(503, 'Couldn’t reach WhatsApp. Try again shortly.');
  const data = await gatewayJson(response) as WhatsAppSession;
  if (typeof data.status !== 'string') throw new HttpError(503, 'WhatsApp returned an unexpected response. Try again.');
  return data;
}

export function localPhone(id?: string) {
  const number = id?.split('@')[0] ?? '';
  if (/^8801[0-9]{9}$/.test(number)) return number.slice(2);
  return /^01[0-9]{9}$/.test(number) ? number : null;
}

export async function whatsAppState(name = SESSION): Promise<WhatsAppState> {
  const current = await session(name);
  // WPP briefly reports WORKING before it has a linked identity.
  const status = current?.status === 'WORKING' && !current.me?.id ? 'STARTING' : current?.status ?? 'STOPPED';
  const result: WhatsAppState = {
    status, phone: localPhone(current?.me?.id),
    qr: null, refreshAfterSeconds: status === 'WORKING' ? 30 : QR_REFRESH_SECONDS,
  };
  const restriction = sessionRestriction(current);
  if (restriction) result.restriction = restriction;
  if (result.status === 'SCAN_QR_CODE') {
    const response = await gatewayRequest(`/api/${encodeURIComponent(name)}/auth/qr`);
    // A scan can complete or the QR can rotate between the two requests.
    if (response.status === 422) return { ...result, status: 'STARTING' };
    if (!response.ok) throw new HttpError(503, 'Couldn’t refresh the QR code. Try again.');
    const image = await gatewayJson(response) as { mimetype?: string; data?: string };
    if (image.mimetype !== 'image/png' || !image.data || image.data.length > 512000 || !/^[A-Za-z0-9+/=]+$/.test(image.data)) {
      throw new HttpError(503, 'Couldn’t load the QR code. Try again.');
    }
    result.qr = `data:image/png;base64,${image.data}`;
  }
  return result;
}

export async function connectWhatsApp(name = SESSION) {
  const current = await session(name);
  let response: Response | undefined;
  if (!current) response = await gatewayRequest('/api/sessions', 'POST', { name, start: true });
  else if (current.status === 'STOPPED') response = await gatewayRequest(`/api/sessions/${encodeURIComponent(name)}/start`, 'POST');
  else if (current.status === 'FAILED') response = await gatewayRequest(`/api/sessions/${encodeURIComponent(name)}/restart`, 'POST');
  if (response && !response.ok && response.status !== 409) throw new HttpError(503, 'Couldn’t start WhatsApp. Try again.');
  return whatsAppState(name);
}

export async function disconnectWhatsApp(name: string) {
  const response = await gatewayRequest(`/api/sessions/${encodeURIComponent(name)}/logout`, 'POST');
  if (!response.ok && response.status !== 404) throw new HttpError(503, 'Couldn’t disconnect WhatsApp. Try again.');
  const stopped = await gatewayRequest(`/api/sessions/${encodeURIComponent(name)}/stop`, 'POST');
  if (!stopped.ok && stopped.status !== 404 && stopped.status !== 422) throw new HttpError(503, 'Couldn’t finish disconnecting WhatsApp. Try again.');
}

export async function pairingCode(name: string, phone: string) {
  const state = await connectWhatsApp(name);
  if (state.status === 'WORKING') throw new HttpError(409, 'WhatsApp is already connected. Disconnect it before changing numbers.');
  const response = await gatewayRequest(`/api/${encodeURIComponent(name)}/auth/request-code`, 'POST', { phoneNumber: `88${phone}` });
  if (!response.ok) throw new HttpError(503, 'Couldn’t get a pairing code. Try again or scan the QR code from another screen.');
  const data = await gatewayJson(response) as { code?: string };
  if (!data.code || !/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(data.code)) throw new HttpError(503, 'Couldn’t get a pairing code. Try the QR code instead.');
  return { code: data.code.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), expiresInSeconds: 120 };
}

export async function listWhatsAppSessions() {
  const response = await gatewayRequest('/api/sessions?all=true');
  if (!response.ok) throw new HttpError(503, 'WhatsApp is unavailable. Try again shortly.');
  const data = await gatewayJson(response) as WhatsAppSession[];
  if (!Array.isArray(data)) throw new HttpError(503, 'WhatsApp returned an unexpected response.');
  return data;
}

export async function sendInvitation(phone: string, link: string): Promise<{ status: 'sent' | 'failed' | 'unknown'; messageId: string | null; error: string | null }> {
  let response: Response;
  try {
    response = await gatewayRequest('/api/sendText', 'POST', {
      session: SESSION, chatId: `88${phone}@c.us`, linkPreview: false,
      text: `You’re invited to Re-Target.\n\nSet up your business account:\n${link}\n\nThis invitation expires in 72 hours. Keep this link private.`,
    });
  } catch {
    return { status: 'unknown', messageId: null, error: 'Sending could not be confirmed. Check WhatsApp before resending.' };
  }
  if (!response.ok) return { status: response.status >= 500 ? 'unknown' : 'failed', messageId: null,
    error: response.status >= 500 ? 'Sending could not be confirmed. Check WhatsApp before resending.' : 'WhatsApp could not send the invitation. Check the number and resend.' };
  try {
    const data = await gatewayJson(response) as { id?: string };
    if (typeof data.id !== 'string' || !data.id) throw new Error('Missing message ID');
    return { status: 'sent', messageId: data.id, error: null };
  } catch { return { status: 'unknown', messageId: null, error: 'Sending could not be confirmed. Check WhatsApp before resending.' }; }
}

export async function checkWhatsAppNumber(name: string, phone: string) {
  const query = new URLSearchParams({ session: name, phone });
  const response = await gatewayRequest(`/api/contacts/check-exists?${query}`);
  if (!response.ok) throw new HttpError(503, 'Could not check this WhatsApp number. It will be retried.');
  const data = await gatewayJson(response) as { numberExists?: boolean; chatId?: string };
  if (typeof data.numberExists !== 'boolean' || (data.numberExists && (typeof data.chatId !== 'string' || !/^[0-9]+@(c\.us|lid)$/.test(data.chatId)))) {
    throw new HttpError(503, 'WhatsApp returned an unexpected account check. It will be retried.');
  }
  return { exists: data.numberExists, chatId: data.numberExists ? data.chatId! : null };
}
