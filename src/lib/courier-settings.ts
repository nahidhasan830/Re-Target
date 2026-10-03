import { env } from 'cloudflare:workers';
import type { Account } from './auth';
import { limitLogin, requireSameOrigin } from './auth';
import { HttpError, readBody } from './http';
import { decryptCourier, encryptCourier } from './courier-crypto';
import { startSync } from './lead-sync';
import { verifyCourier } from './courier-sessions';
import { courierFields, courierProviders, validateCourier, type CourierErrors, type CourierProvider, type CourierValues } from './courier-validation';

export type CourierFormState = { saved: boolean; connected: boolean; legacy: boolean; values: CourierValues; errors: CourierErrors; message?: string };
export type CourierSettingsState = { forms: Record<CourierProvider, CourierFormState>; status: number; saved?: CourierProvider; verified?: CourierProvider; message?: string };
type CredentialRow = { provider: CourierProvider; encryptedCredentials: string; encryptedSession: string | null; authError: string | null };

export async function courierSettings(request: Request, account: Account): Promise<CourierSettingsState> {
  const empty = (): CourierFormState => ({ saved: false, connected: false, legacy: false, values: {}, errors: {} });
  const state: CourierSettingsState = { forms: { pathao: empty(), steadfast: empty() }, status: 200 };
  let provider: CourierProvider | undefined;
  try {
    if (request.method === 'POST') requireSameOrigin(request);
    const rows = await env.DB.prepare(`SELECT provider, encrypted_credentials AS encryptedCredentials,
      encrypted_session AS encryptedSession, auth_error AS authError FROM courier_credentials WHERE owner_id = ?`).bind(account.id).all<CredentialRow>();
    const stored: Partial<Record<CourierProvider, CourierValues>> = {};
    for (const row of rows.results) {
      const values = await decryptCourier<CourierValues>(account.id, row.provider, row.encryptedCredentials);
      stored[row.provider] = values;
      const target = state.forms[row.provider];
      target.saved = Boolean(values.username && values.password);
      target.legacy = !target.saved;
      target.connected = target.saved && Boolean(row.encryptedSession) && !row.authError;
      target.message = row.authError ?? undefined;
      for (const field of courierFields[row.provider]) if (!field.secret) target.values[field.name] = values[field.name];
    }
    if (request.method !== 'POST') return state;
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'Refresh the page and try again.');
    const form = new URLSearchParams(await readBody(request));
    const selected = form.get('provider');
    if (!courierProviders.includes(selected as CourierProvider)) throw new HttpError(400, 'Choose a courier to save.');
    provider = selected as CourierProvider;
    const intent = form.get('intent') ?? 'save';
    if (!['save', 'connect', 'reconnect'].includes(intent)) throw new HttpError(400, 'Choose a courier action.');
    const target = state.forms[provider];
    const validated = validateCourier(provider, Object.fromEntries(form), target.saved);
    target.errors = validated.errors;
    for (const field of courierFields[provider]) if (!field.secret) target.values[field.name] = validated.data[field.name];
    if (!validated.valid) { state.status = 400; return state; }
    const values = validated.data;
    if (!values.password) values.password = stored[provider]!.password;
    const previous = stored[provider];
    const changed = !previous || previous.username !== values.username || previous.password !== values.password;
    if (changed || Object.keys(previous ?? {}).some(key => !['username', 'password'].includes(key))) {
      const ciphertext = await encryptCourier(account.id, provider, values);
      await env.DB.prepare(`INSERT INTO courier_credentials (owner_id, user_id, provider, encrypted_credentials, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, provider) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, updated_at = excluded.updated_at,
          encrypted_session = NULL, session_version = session_version + 1, credential_version = credential_version + 1, source_account_id = NULL, auth_lock = NULL, auth_lock_expires_at = 0, retry_after = 0, auth_error = NULL`)
        .bind(account.id, account.role === 'user' ? account.id : null, provider, ciphertext, Math.floor(Date.now() / 1000)).run();
      target.connected = false;
      target.message = undefined;
    }
    target.saved = true;
    target.legacy = false;
    if (intent !== 'save') {
      await limitLogin(request, `courier:${account.id}:${provider}`, 5);
      await verifyCourier(account, provider, intent === 'reconnect');
      target.connected = true;
      target.message = undefined;
      await startSync(account, provider, 'connect');
      state.verified = provider;
    } else state.saved = provider;
  } catch (error) {
    if (!(error instanceof HttpError)) console.error(JSON.stringify({ event: 'courier_settings_failed' }));
    state.status = error instanceof HttpError ? error.status : 503;
    const message = error instanceof HttpError ? error.message : 'Couldn’t load or save courier settings. Try again shortly.';
    if (provider) state.forms[provider].message = message;
    else state.message = message;
  }
  return state;
}
