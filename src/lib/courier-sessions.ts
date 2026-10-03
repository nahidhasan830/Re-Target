import { env } from 'cloudflare:workers';
import type { Account } from './auth';
import { HttpError } from './http';
import type { CourierProvider, CourierValues } from './courier-validation';
import { decryptCourier, encryptCourier } from './courier-crypto';
import { steadfastTransport } from './steadfast-transport';
import { CourierAuthError, courierOrigins, courierSessionFresh, courierSessionIdentity, courierText, mergeSteadfastCookies, renewPathao, renewSteadfast, steadfastCookieHeader, steadfastNeedsLogin, type CourierSession } from './courier-auth';

type Row = { encryptedCredentials: string; encryptedSession: string | null; sessionVersion: number; retryAfter: number; authError: string | null };
async function stored(ownerId: string, provider: CourierProvider) {
  const row = await env.DB.prepare(`SELECT encrypted_credentials AS encryptedCredentials, encrypted_session AS encryptedSession,
    session_version AS sessionVersion, retry_after AS retryAfter, auth_error AS authError FROM courier_credentials WHERE owner_id = ? AND provider = ?`)
    .bind(ownerId, provider).first<Row>();
  if (!row) throw new HttpError(400, 'Save your merchant email and password first.');
  const credentials = await decryptCourier<CourierValues>(ownerId, provider, row.encryptedCredentials);
  if (!credentials.username || !credentials.password) throw new HttpError(400, 'Save your merchant email and password first.');
  const session = row.encryptedSession ? await decryptCourier<CourierSession>(ownerId, provider, row.encryptedSession, true) : null;
  return { row, credentials: { username: credentials.username, password: credentials.password }, session };
}

export async function courierSession(account: Account, provider: CourierProvider, rejected = '', reconnect = false): Promise<CourierSession> {
  const lock = crypto.randomUUID();
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await stored(account.id, provider);
    if (!reconnect && current.session && courierSessionFresh(current.session) && courierSessionIdentity(current.session) !== rejected) return current.session;
    if (current.row.retryAfter > Date.now()) throw new HttpError(429, current.row.authError ?? 'Courier connection is cooling down. Try again shortly.');
    const claimed = await env.DB.prepare(`UPDATE courier_credentials SET auth_lock = ?, auth_lock_expires_at = ?
      WHERE owner_id = ? AND provider = ? AND encrypted_credentials = ? AND session_version = ? AND auth_lock_expires_at <= ? RETURNING owner_id`)
      .bind(lock, Date.now() + 60000, account.id, provider, current.row.encryptedCredentials, current.row.sessionVersion, Date.now()).first();
    if (!claimed) { await new Promise(resolve => setTimeout(resolve, 200)); continue; }
    try {
      const previous = reconnect ? null : current.session;
      const session = provider === 'pathao'
        ? await renewPathao(current.credentials, previous?.provider === 'pathao' ? previous : null)
        : await renewSteadfast(current.credentials, previous?.provider === 'steadfast' ? previous : null, steadfastTransport(process.env.STEADFAST_TRANSPORT_URL, process.env.STEADFAST_TRANSPORT_TOKEN));
      const ciphertext = await encryptCourier(account.id, provider, session, true);
      const updated = await env.DB.prepare(`UPDATE courier_credentials SET encrypted_session = ?, session_version = session_version + 1,
        auth_lock = NULL, auth_lock_expires_at = 0, retry_after = 0, auth_error = NULL
        WHERE owner_id = ? AND provider = ? AND encrypted_credentials = ? AND auth_lock = ? RETURNING owner_id`)
        .bind(ciphertext, account.id, provider, current.row.encryptedCredentials, lock).first();
      if (!updated) throw new HttpError(409, 'Courier credentials changed during connection. Try again.');
      return session;
    } catch (error) {
      const message = error instanceof CourierAuthError || error instanceof HttpError ? error.message : 'Couldn’t connect to the courier. Try again shortly.';
      await env.DB.prepare(`UPDATE courier_credentials SET auth_lock = NULL, auth_lock_expires_at = 0, retry_after = ?, auth_error = ?
        WHERE owner_id = ? AND provider = ? AND encrypted_credentials = ? AND auth_lock = ?`)
        .bind(Date.now() + 30000, message, account.id, provider, current.row.encryptedCredentials, lock).run();
      throw error instanceof CourierAuthError ? new HttpError(error.status, message) : error;
    }
  }
  throw new HttpError(409, 'Another courier connection is in progress. Try again shortly.');
}

async function retainCookies(account: Account, session: CourierSession, response: Response) {
  if (session.provider !== 'steadfast' || !response.headers.getSetCookie().length) return;
  const current = await stored(account.id, 'steadfast');
  if (!current.session || courierSessionIdentity(current.session) !== courierSessionIdentity(session)) return;
  const renewed = mergeSteadfastCookies(session, response.headers.getSetCookie());
  await env.DB.prepare(`UPDATE courier_credentials SET encrypted_session = ?, session_version = session_version + 1
    WHERE owner_id = ? AND provider = 'steadfast' AND encrypted_credentials = ? AND session_version = ? AND auth_lock_expires_at <= ?`)
    .bind(await encryptCourier(account.id, 'steadfast', renewed, true), account.id, current.row.encryptedCredentials, current.row.sessionVersion, Date.now()).run();
}

export async function courierRead(account: Account, provider: CourierProvider, path: string): Promise<Response> {
  const url = new URL(path, courierOrigins[provider]);
  if (!path.startsWith('/') || url.origin !== courierOrigins[provider] || url.username || url.password) throw new HttpError(400, 'Invalid courier resource.');
  let session = await courierSession(account, provider);
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers({ Accept: provider === 'pathao' ? 'application/json' : 'text/html' });
    if (session.provider === 'pathao') headers.set('Authorization', `Bearer ${session.accessToken}`);
    else headers.set('Cookie', steadfastCookieHeader(session));
    let response;
    const fetcher = provider === 'steadfast' ? steadfastTransport(process.env.STEADFAST_TRANSPORT_URL, process.env.STEADFAST_TRANSPORT_TOKEN) : fetch;
    try { response = await fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(12000) }); }
    catch { throw new HttpError(502, 'The courier could not be reached. Try again shortly.'); }
    const html = provider === 'steadfast' ? await courierText(response) : '';
    const rejected = provider === 'pathao' ? response.status === 401 : steadfastNeedsLogin(response, html);
    if (rejected) {
      await response.body?.cancel();
      if (attempt) throw new HttpError(401, 'The courier refused the renewed session. Reconnect your merchant account.');
      session = await courierSession(account, provider, courierSessionIdentity(session));
      continue;
    }
    await retainCookies(account, session, response);
    if (provider === 'pathao') return response;
    return new Response([204, 205, 304].includes(response.status) ? null : html, { status: response.status, headers: response.headers });
  }
  throw new HttpError(502, 'Couldn’t read the courier account. Try again shortly.');
}

export async function verifyCourier(account: Account, provider: CourierProvider, reconnect = false) {
  await courierSession(account, provider, '', reconnect);
  const response = await courierRead(account, provider, provider === 'pathao' ? '/api/v1/user' : '/user/frauds/create');
  const text = await courierText(response);
  if (!response.ok) throw new HttpError(502, 'The courier account could not be verified. Try again later.');
  if (provider === 'pathao') {
    let data;
    try { data = JSON.parse(text); } catch { throw new HttpError(502, 'Pathao returned an unexpected account response.'); }
    if (!data?.data?.merchant_id) throw new HttpError(502, 'Pathao returned an unexpected account response.');
    return String(data.data.merchant_id);
  }
  return text.match(/\"user_id\"\s*:\s*(\d+)/)?.[1] ?? null;
}
