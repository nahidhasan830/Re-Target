import { env } from 'cloudflare:workers';
import { adminCredentials, digest, hashPassword } from './auth';
import { HttpError } from './http';
import { finishAdminReservation, reserveAdminSender } from './sender-reservation';
import { sendPasswordReset } from './waha';

export const RESET_SECONDS = 30 * 60;
const RESEND_SECONDS = 5 * 60;
type PasswordReset = { id: string; phone: string; token_hash: string; credential_version: string; expires_at: number; used_at: number | null };
export type ResetState = 'valid' | 'used' | 'expired' | 'invalid';

async function currentCredential(phone: string) {
  if (phone === env.ADMIN_PHONE) return digest((await adminCredentials()).hash);
  const user = await env.DB.prepare('SELECT credential_version AS version FROM users WHERE phone = ? AND active = 1')
    .bind(phone).first<{ version: number }>();
  return user ? String(user.version) : null;
}

async function settle(id: string, tokenHash: string, status: 'sent' | 'failed' | 'unknown', messageId: string | null) {
  // An undelivered link is expired and its cooldown lifted so the person can ask again.
  await env.DB.prepare(`UPDATE password_resets SET delivery_status = ?1, message_id = ?2,
    expires_at = CASE WHEN ?1 = 'failed' THEN 0 ELSE expires_at END, sent_at = CASE WHEN ?1 = 'failed' THEN 0 ELSE sent_at END
    WHERE id = ?3 AND token_hash = ?4`).bind(status, messageId, id, tokenHash).run();
}

async function reserve(id: string, phone: string) {
  // Campaign sends hold the sender for a moment, so a short retry avoids dropping the request.
  for (let attempt = 1; ; attempt++) {
    try { return await reserveAdminSender(id, phone, 'password_reset'); }
    catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function requestPasswordReset(phone: string, origin: string) {
  const credential = await currentCredential(phone);
  if (!credential) return;
  const sender = await env.DB.prepare("SELECT phone FROM whatsapp_connections WHERE owner_id='admin' AND status='WORKING'").first<{ phone: string }>();
  if (!sender?.phone) throw new Error('The admin WhatsApp is not connected.');
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const tokenHash = await digest(token);
  const now = Math.floor(Date.now() / 1000);
  const reset = await env.DB.prepare(`INSERT INTO password_resets (id, phone, token_hash, credential_version, expires_at, delivery_status, sent_at)
    VALUES (?, ?, ?, ?, ?, 'sending', ?)
    ON CONFLICT(phone) DO UPDATE SET token_hash = excluded.token_hash, credential_version = excluded.credential_version,
      expires_at = excluded.expires_at, delivery_status = 'sending', message_id = NULL, sent_at = excluded.sent_at, used_at = NULL
    WHERE password_resets.sent_at <= ? RETURNING id`)
    .bind(crypto.randomUUID(), phone, tokenHash, credential, now + RESET_SECONDS, now, now - RESEND_SECONDS).first<{ id: string }>();
  if (!reset) return;
  let reservation: string;
  try { reservation = await reserve(reset.id, sender.phone); }
  catch (error) {
    await settle(reset.id, tokenHash, 'failed', null);
    throw error;
  }
  const delivery = await sendPasswordReset(phone, new URL(`/reset-password/${token}`, origin).href);
  await settle(reset.id, tokenHash, delivery.status, delivery.messageId);
  await finishAdminReservation(reservation, delivery.status, delivery.messageId, 'password_reset');
}

export async function passwordResetForToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const reset = await env.DB.prepare('SELECT id, phone, token_hash, credential_version, expires_at, used_at FROM password_resets WHERE token_hash = ?')
    .bind(await digest(token)).first<PasswordReset>();
  if (!reset) return null;
  const state: ResetState = reset.used_at ? 'used'
    : reset.expires_at <= Math.floor(Date.now() / 1000) || reset.credential_version !== await currentCredential(reset.phone) ? 'expired' : 'valid';
  return { ...reset, state };
}

export async function resetPassword(token: string, password: string) {
  const reset = await passwordResetForToken(token);
  if (reset?.state !== 'valid') throw new HttpError(409, 'This reset link is no longer valid. Request a new one.');
  const nextHash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);
  const unused = (n: number) => `SELECT 1 FROM password_resets WHERE id = ?${n} AND token_hash = ?${n + 1} AND used_at IS NULL AND expires_at > ?${n + 2}`;
  // The token is consumed only if this exact new verifier was stored; both statements run atomically.
  const consume = (account: string) => env.DB.prepare(`UPDATE password_resets SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL
    AND EXISTS (SELECT 1 FROM ${account} WHERE phone = ?3 AND password_hash = ?4)`).bind(now, reset.id, reset.phone, nextHash);
  let results;
  if (reset.phone === env.ADMIN_PHONE) {
    const configured = await adminCredentials();
    results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO admin_accounts (phone, company_name, password_hash, source_credential_version) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (${unused(7)})
        ON CONFLICT(phone) DO UPDATE SET password_hash = excluded.password_hash, source_credential_version = excluded.source_credential_version
        WHERE CASE WHEN admin_accounts.source_credential_version = ?4 AND admin_accounts.password_hash IS NOT NULL
          THEN admin_accounts.password_hash ELSE ?5 END = ?6`)
        .bind(reset.phone, configured.companyName, nextHash, configured.sourceVersion, configured.sourceHash, configured.hash, reset.id, reset.token_hash, now),
      consume('admin_accounts'),
    ]);
  } else {
    results = await env.DB.batch([
      env.DB.prepare(`UPDATE users SET password_hash = ?1, credential_version = credential_version + 1
        WHERE phone = ?2 AND active = 1 AND credential_version = ?3 AND EXISTS (${unused(4)})`)
        .bind(nextHash, reset.phone, Number(reset.credential_version), reset.id, reset.token_hash, now),
      consume('users'),
    ]);
  }
  if (results[1]!.meta.changes !== 1) throw new HttpError(409, 'This reset link is no longer valid. Request a new one.');
  return reset.phone;
}
