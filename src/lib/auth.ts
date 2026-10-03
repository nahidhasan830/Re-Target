import type { AstroCookies } from 'astro';
import { env } from 'cloudflare:workers';
import { HttpError } from './http';
import { hashPassword, verifyPassword, PASSWORD_HASH_PATTERN } from './password';
export { hashPassword, verifyPassword } from './password';

export const SESSION_COOKIE = 'retarget_session';
const SESSION_SECONDS = 60 * 60 * 8;
const ATTEMPT_WINDOW = 60 * 15;
const encoder = new TextEncoder();

export async function digest(value: string) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', encoder.encode(value))).toString('hex');
}

export async function adminCredentials() {
  const hash = env.ADMIN_PASSWORD_HASH;
  if (!/^01[0-9]{9}$/.test(env.ADMIN_PHONE) || !PASSWORD_HASH_PATTERN.test(hash ?? '')) {
    throw new HttpError(503, 'Login is temporarily unavailable. Please try again later.');
  }
  const sourceVersion = await digest(hash);
  const saved = await env.DB.prepare('SELECT company_name AS companyName, password_hash AS passwordHash, source_credential_version AS sourceVersion FROM admin_accounts WHERE phone = ?')
    .bind(env.ADMIN_PHONE).first<{ companyName: string; passwordHash: string | null; sourceVersion: string | null }>();
  // Rotating the configured secret resets an admin's saved password.
  return { phone: env.ADMIN_PHONE, companyName: saved?.companyName ?? 'Re-Target', sourceVersion, sourceHash: hash,
    hash: saved?.passwordHash && saved.sourceVersion === sourceVersion ? saved.passwordHash : hash };
}

export async function limitLogin(request: Request, scope = 'login', maximum = 10) {
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const key = await digest(scope === 'login' ? ip : `${scope}:${ip}`);
  // One atomic statement prevents concurrent requests from bypassing the limit.
  const attempt = await env.DB.prepare(`
    INSERT INTO login_attempts (key, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    WHERE expires_at <= ? OR attempts < ?
    RETURNING attempts
  `).bind(key, now + ATTEMPT_WINDOW, now, now, now, maximum).first();
  if (!attempt) throw new HttpError(429, scope === 'login' ? 'Too many login attempts. Please try again in 15 minutes.' : 'Too many attempts. Please try again in 15 minutes.');
}

export async function checkCredentials(phone: string, password: string) {
  const configured = await adminCredentials();
  return await verifyPassword(password, configured.hash) && phone === configured.phone;
}

export function cookieOptions(url: URL) {
  return { path: '/', httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax' as const };
}

export async function createSession(cookies: AstroCookies, url: URL, expectedVersion?: string) {
  const configured = await adminCredentials();
  const version = await digest(configured.hash);
  if (expectedVersion && expectedVersion !== version) throw new HttpError(409, 'Your password changed. Log in again.');
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  await destroySession(cookies, url);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM login_attempts WHERE expires_at <= ?').bind(now),
    env.DB.prepare('INSERT INTO admin_sessions (token_hash, phone, credential_version, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await digest(token), configured.phone, version, now + SESSION_SECONDS),
  ]);
  cookies.set(SESSION_COOKIE, token, { ...cookieOptions(url), maxAge: SESSION_SECONDS });
}

export async function currentAdmin(cookies: AstroCookies) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const configured = await adminCredentials();
  const credentialVersion = await digest(configured.hash);
  const session = await env.DB.prepare('SELECT phone FROM admin_sessions WHERE token_hash = ? AND phone = ? AND credential_version = ? AND expires_at > ?')
    .bind(await digest(token), configured.phone, credentialVersion, Math.floor(Date.now() / 1000))
    .first<{ phone: string }>();
  return session ? { ...session, companyName: configured.companyName, credentialVersion } : null;
}

export async function destroySession(cookies: AstroCookies, url: URL) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const hash = await digest(token);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(hash),
      env.DB.prepare('DELETE FROM user_sessions WHERE token_hash = ?').bind(hash),
    ]);
  }
  cookies.delete(SESSION_COOKIE, cookieOptions(url));
}

export type UserAccount = { role: 'user'; id: string; phone: string; companyName: string; credentialVersion: number };
export type Account = { role: 'admin'; id: 'admin'; phone: string; companyName: string; credentialVersion: string } | UserAccount;

export async function authenticate(phone: string, password: string): Promise<Account | null> {
  const configured = await adminCredentials();
  if (phone === configured.phone) {
    if (!await verifyPassword(password, configured.hash)) return null;
    if (configured.hash.startsWith('pbkdf2-')) {
      const nextHash = await hashPassword(password);
      const saved = await env.DB.prepare(`INSERT INTO admin_accounts (phone, company_name, password_hash, source_credential_version) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(phone) DO UPDATE SET password_hash=excluded.password_hash,source_credential_version=excluded.source_credential_version
        WHERE CASE WHEN admin_accounts.source_credential_version=?4 AND admin_accounts.password_hash IS NOT NULL
          THEN admin_accounts.password_hash ELSE ?5 END=?6 RETURNING phone`)
        .bind(phone, configured.companyName, nextHash, configured.sourceVersion, configured.sourceHash, configured.hash).first();
      if (!saved) throw new HttpError(409, 'Your password changed. Log in again.');
      configured.hash = nextHash;
    }
    return { role: 'admin', id: 'admin', phone, companyName: configured.companyName, credentialVersion: await digest(configured.hash) };
  }
  const user = await env.DB.prepare('SELECT id, phone, company_name AS companyName, password_hash AS passwordHash, credential_version AS credentialVersion FROM users WHERE phone = ? AND active = 1')
    .bind(phone).first<UserAccount & { passwordHash: string }>();
  const matches = await verifyPassword(password, user?.passwordHash ?? configured.hash);
  if (user && matches && user.passwordHash.startsWith('pbkdf2-')) {
    const saved = await env.DB.prepare(`UPDATE users SET password_hash=?,credential_version=credential_version+1
      WHERE id=? AND active=1 AND credential_version=? AND password_hash=? RETURNING credential_version AS credentialVersion`)
      .bind(await hashPassword(password), user.id, user.credentialVersion, user.passwordHash).first<{ credentialVersion: number }>();
    if (!saved) throw new HttpError(409, 'Your password changed. Log in again.');
    user.credentialVersion = saved.credentialVersion;
  }
  return user && matches ? { role: 'user', id: user.id, phone: user.phone, companyName: user.companyName, credentialVersion: user.credentialVersion } : null;
}

export async function currentAccount(cookies: AstroCookies): Promise<Account | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const admin = await currentAdmin(cookies);
  if (admin) return { ...admin, role: 'admin', id: 'admin' };
  const user = await env.DB.prepare(`SELECT u.id, u.phone, u.company_name AS companyName, u.credential_version AS credentialVersion
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1 AND s.credential_version = u.credential_version`)
    .bind(await digest(token), Math.floor(Date.now() / 1000)).first<Omit<UserAccount, 'role'>>();
  return user ? { ...user, role: 'user' } : null;
}

export async function createAccountSession(cookies: AstroCookies, url: URL, account: Account) {
  if (account.role === 'admin') return createSession(cookies, url, account.credentialVersion);
  await destroySession(cookies, url);
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('INSERT INTO user_sessions (token_hash, user_id, credential_version, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await digest(token), account.id, account.credentialVersion, now + SESSION_SECONDS),
  ]);
  cookies.set(SESSION_COOKIE, token, { ...cookieOptions(url), maxAge: SESSION_SECONDS });
}

export async function requireAccount(cookies: AstroCookies) {
  const account = await currentAccount(cookies);
  if (!account) throw new HttpError(401, 'Log in to continue.');
  return account;
}

export async function requireAdmin(cookies: AstroCookies) {
  const account = await requireAccount(cookies);
  if (account.role !== 'admin') throw new HttpError(403, 'Admin access is required.');
  return account;
}

export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError(403, 'Refresh the page and try again.');
}
