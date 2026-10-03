import type { AstroCookies } from 'astro';
import { env } from 'cloudflare:workers';
import { adminCredentials, createAccountSession, digest, hashPassword, limitLogin, requireSameOrigin, verifyPassword, type Account } from './auth';
import { validateAccountUpdate, type AccountErrors } from './account-validation';
import { HttpError, readBody } from './http';

export type AccountSettingsState = { companyName: string; errors: AccountErrors; form?: 'company' | 'password'; message?: string; saved?: boolean; status: number };

export async function accountSettings(request: Request, cookies: AstroCookies, url: URL, account: Account): Promise<AccountSettingsState> {
  const state: AccountSettingsState = { companyName: account.companyName, errors: {}, status: 200 };
  if (request.method !== 'POST') return state;
  try {
    requireSameOrigin(request);
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'Refresh the page and try again.');
    const form = new URLSearchParams(await readBody(request));
    const action = form.get('action');
    if (action !== 'company' && action !== 'password') throw new HttpError(400, 'Choose which account details to update.');
    state.form = action;
    if (action === 'company') state.companyName = form.get('companyName') ?? '';
    const validated = validateAccountUpdate(Object.fromEntries(form));
    state.errors = validated.errors;
    if (!validated.result.success) {
      state.status = 400;
      if (!Object.keys(state.errors).length) state.message = 'Refresh the page and try again.';
      return state;
    }
    const input = validated.result.data;
    if (input.action === 'company') {
      const saved = account.role === 'admin'
        ? await env.DB.prepare(`INSERT INTO admin_accounts (phone, company_name) VALUES (?, ?)
          ON CONFLICT(phone) DO UPDATE SET company_name = excluded.company_name RETURNING phone`)
          .bind(account.phone, input.companyName).first()
        : await env.DB.prepare('UPDATE users SET company_name = ? WHERE id = ? AND active = 1 AND credential_version = ? RETURNING id')
          .bind(input.companyName, account.id, account.credentialVersion).first();
      if (!saved) throw new HttpError(409, 'Your account changed. Refresh the page and try again.');
    } else {
      await limitLogin(request, `password-change:${account.id}`, 5);
      if (account.role === 'admin') {
        const configured = await adminCredentials();
        if (account.credentialVersion !== await digest(configured.hash)) throw new HttpError(409, 'Your password changed. Log in again.');
        if (!await verifyPassword(input.currentPassword, configured.hash)) {
          state.errors.currentPassword = 'Current password is incorrect.';
          state.status = 400;
          return state;
        }
        const nextHash = await hashPassword(input.newPassword);
        const saved = await env.DB.prepare(`INSERT INTO admin_accounts (phone, company_name, password_hash, source_credential_version) VALUES (?1, ?2, ?3, ?4)
          ON CONFLICT(phone) DO UPDATE SET password_hash = excluded.password_hash, source_credential_version = excluded.source_credential_version
          WHERE CASE WHEN admin_accounts.source_credential_version = ?4 AND admin_accounts.password_hash IS NOT NULL
            THEN admin_accounts.password_hash ELSE ?5 END = ?6 RETURNING phone`)
          .bind(account.phone, configured.companyName, nextHash, configured.sourceVersion, configured.sourceHash, configured.hash).first();
        if (!saved) throw new HttpError(409, 'Your password changed. Log in again.');
        await createAccountSession(cookies, url, { ...account, credentialVersion: await digest(nextHash) });
      } else {
        const user = await env.DB.prepare('SELECT password_hash AS passwordHash FROM users WHERE id = ? AND active = 1 AND credential_version = ?')
          .bind(account.id, account.credentialVersion).first<{ passwordHash: string }>();
        if (!user) throw new HttpError(409, 'Your account changed. Log in again.');
        if (!await verifyPassword(input.currentPassword, user.passwordHash)) {
          state.errors.currentPassword = 'Current password is incorrect.';
          state.status = 400;
          return state;
        }
        const saved = await env.DB.prepare(`UPDATE users SET password_hash = ?, credential_version = credential_version + 1
          WHERE id = ? AND active = 1 AND credential_version = ? RETURNING credential_version AS credentialVersion`)
          .bind(await hashPassword(input.newPassword), account.id, account.credentialVersion).first<{ credentialVersion: number }>();
        if (!saved) throw new HttpError(409, 'Your password changed. Log in again.');
        await createAccountSession(cookies, url, { ...account, credentialVersion: saved.credentialVersion });
      }
    }
    state.saved = true;
  } catch (error) {
    if (!(error instanceof HttpError)) console.error(JSON.stringify({ event: 'account_update_failed' }));
    state.status = error instanceof HttpError ? error.status : 503;
    state.message = error instanceof HttpError ? error.message : 'Couldn’t save your changes. Try again shortly.';
  }
  return state;
}
