import { env } from 'cloudflare:workers';
import { digest, hashPassword, type Account } from './auth';
import { HttpError } from './http';
import { accountWhatsAppState, refreshConnectionStatuses } from './whatsapp-connections';
import { reserveInvitationSender, finishInvitationReservation } from './sender-reservation';
import { sendInvitation } from './waha';

const INVITATION_SECONDS = 72 * 60 * 60;
type Invitation = { id: string; phone: string; status: 'pending' | 'accepted' | 'revoked'; expires_at: number; token_hash: string; request_id: string; delivery_status: string; sent_at: number };
export type InvitationRow = {
  id: string; phone: string; status: string; expiresAt: number; deliveryStatus: string; deliveryError: string | null;
  companyName: string | null; whatsappPhone: string | null; whatsappStatus: string | null; checkedAt: number | null; createdAt: number; sentAt: number;
};

export async function invitationForToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare('SELECT id, phone, status, expires_at, token_hash, request_id, delivery_status, sent_at FROM invitations WHERE token_hash = ?')
    .bind(await digest(token)).first<Invitation>();
}

export function invitationStatus(invitation: { status: string; expires_at: number }) {
  return invitation.status === 'pending' && invitation.expires_at <= Math.floor(Date.now() / 1000) ? 'expired' : invitation.status;
}

export async function listInvitations(refresh = false, cursor?: string) {
  let gatewayAvailable = true;
  if (refresh) try { await refreshConnectionStatuses(); } catch { gatewayAvailable = false; }
  if (cursor && !/^[0-9]{10}:[a-f0-9-]{36}$/.test(cursor)) throw new HttpError(400, 'Invalid page.');
  const [cursorTime, cursorId] = cursor?.split(':') ?? ['9999999999', ''];
  const { results } = await env.DB.prepare(`SELECT i.id, i.phone, i.status, i.expires_at AS expiresAt, i.delivery_status AS deliveryStatus,
    i.delivery_error AS deliveryError, i.created_at AS createdAt, i.sent_at AS sentAt, u.company_name AS companyName,
    w.phone AS whatsappPhone, w.status AS whatsappStatus, w.checked_at AS checkedAt
    FROM invitations i LEFT JOIN users u ON u.id = i.user_id LEFT JOIN whatsapp_connections w ON w.user_id = u.id
    WHERE i.created_at < ? OR (i.created_at = ? AND i.id < ?)
    ORDER BY i.created_at DESC, i.id DESC LIMIT 51`).bind(Number(cursorTime), Number(cursorTime), cursorId).all<InvitationRow>();
  const now = Math.floor(Date.now() / 1000);
  const visible = results.slice(0, 50);
  const last = visible.at(-1);
  return { items: visible.map((row) => ({ ...row,
    status: row.status === 'pending' && row.expiresAt <= now ? 'expired' : row.status,
    deliveryStatus: row.deliveryStatus === 'sending' && row.sentAt + 120 < now ? 'unknown' : row.deliveryStatus,
    whatsappStatus: !gatewayAvailable || !row.checkedAt || row.checkedAt < now - 90 ? 'UNKNOWN' : row.whatsappStatus,
  })), gatewayAvailable, nextCursor: results.length > 50 && last ? `${last.createdAt}:${last.id}` : null };
}

async function requireSender(account: Account) {
  if (account.role !== 'admin') throw new HttpError(403, 'Admin access is required.');
  const whatsapp = await accountWhatsAppState(account);
  if (whatsapp.status !== 'WORKING' || !whatsapp.phone) throw new HttpError(409, 'Connect your admin WhatsApp before sending invitations.');
}

async function finishSending(id: string, token: string, phone: string, origin: string) {
  const sender = await env.DB.prepare("SELECT phone FROM whatsapp_connections WHERE owner_id='admin' AND status='WORKING'").first<{ phone: string }>();
  if (!sender?.phone) throw new HttpError(409, 'Connect the admin WhatsApp before sending.');
  let reservation: string;
  try { reservation = await reserveInvitationSender(id, sender.phone); }
  catch (error) {
    await env.DB.prepare("UPDATE invitations SET delivery_status='failed',delivery_error='Sender is busy or paused. Retry after reviewing the sender.' WHERE id=? AND token_hash=?").bind(id, await digest(token)).run();
    throw error;
  }
  const delivery = await sendInvitation(phone, new URL(`/invite/${token}`, origin).href);
  await env.DB.prepare('UPDATE invitations SET delivery_status = ?, delivery_error = ?, message_id = ? WHERE id = ? AND token_hash = ?')
    .bind(delivery.status, delivery.error, delivery.messageId, id, await digest(token)).run();
  await finishInvitationReservation(reservation, delivery.status, delivery.messageId);
  return { id, deliveryStatus: delivery.status, message: delivery.status === 'sent' ? 'Invitation sent on WhatsApp.' : delivery.error };
}

export async function inviteUser(account: Account, phone: string, requestId: string, origin: string) {
  if (phone === env.ADMIN_PHONE) throw new HttpError(409, 'This number belongs to the admin account.');
  const previous = await env.DB.prepare('SELECT id, phone, delivery_status FROM invitations WHERE request_id = ?').bind(requestId)
    .first<{ id: string; phone: string; delivery_status: string }>();
  if (previous) {
    if (previous.phone !== phone) throw new HttpError(409, 'Refresh the page and try again.');
    return { id: previous.id, deliveryStatus: previous.delivery_status, message: 'This invitation request was already recorded.' };
  }
  const registered = await env.DB.prepare('SELECT id FROM users WHERE phone = ?').bind(phone).first();
  if (registered) throw new HttpError(409, 'This phone number already has an account.');
  await requireSender(account);
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const inserted = await env.DB.prepare(`INSERT INTO invitations
    (id, phone, token_hash, expires_at, delivery_status, request_id, created_by, created_at, sent_at)
    SELECT ?, ?, ?, ?, 'sending', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE phone = ?)
    ON CONFLICT DO NOTHING`).bind(id, phone, await digest(token), now + INVITATION_SECONDS, requestId, account.phone, now, now, phone).run();
  if (!inserted.meta.changes) {
    const duplicate = await env.DB.prepare('SELECT id, phone, delivery_status FROM invitations WHERE request_id = ?').bind(requestId)
      .first<{ id: string; phone: string; delivery_status: string }>();
    if (duplicate?.phone === phone) return { id: duplicate.id, deliveryStatus: duplicate.delivery_status, message: 'This invitation request was already recorded.' };
    throw new HttpError(409, 'This number already has an invitation. Use Resend to send a new link.');
  }
  return finishSending(id, token, phone, origin);
}

export async function resendInvitation(account: Account, id: string, requestId: string, origin: string) {
  const invitation = await env.DB.prepare('SELECT id, phone, status, expires_at, token_hash, request_id, delivery_status, sent_at FROM invitations WHERE id = ?')
    .bind(id).first<Invitation>();
  if (!invitation) throw new HttpError(404, 'Invitation not found.');
  if (invitation.request_id === requestId) return { id, deliveryStatus: invitation.delivery_status, message: 'This resend request was already recorded.' };
  if (invitation.status === 'accepted') throw new HttpError(409, 'This user has already set up their account.');
  if (await env.DB.prepare('SELECT id FROM invitations WHERE request_id = ? AND id != ?').bind(requestId, id).first()) {
    throw new HttpError(409, 'Refresh the page and try again.');
  }
  await requireSender(account);
  const now = Math.floor(Date.now() / 1000);
  if (invitation.sent_at + 30 > now) throw new HttpError(429, 'Wait 30 seconds before resending.');
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const updated = await env.DB.prepare(`UPDATE invitations SET token_hash = ?, status = 'pending', expires_at = ?, delivery_status = 'sending',
    delivery_error = NULL, message_id = NULL, request_id = ?, sent_at = ?
    WHERE id = ? AND token_hash = ? AND status != 'accepted' AND NOT EXISTS (SELECT 1 FROM users WHERE phone = invitations.phone)
    AND (delivery_status != 'sending' OR sent_at < ?)`)
    .bind(await digest(token), now + INVITATION_SECONDS, requestId, now, id, invitation.token_hash, now - 120).run();
  if (!updated.meta.changes) throw new HttpError(409, 'This invitation changed. Refresh the list and try again.');
  return finishSending(id, token, invitation.phone, origin);
}

export async function revokeInvitation(id: string) {
  const result = await env.DB.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ? AND status = 'pending'").bind(id).run();
  if (!result.meta.changes) throw new HttpError(409, 'This invitation is already accepted or revoked. Refresh the list.');
  return { message: 'Invitation revoked.' };
}

export async function acceptInvitation(token: string, companyName: string, password: string) {
  const invitation = await invitationForToken(token);
  if (!invitation || invitationStatus(invitation) !== 'pending') throw new HttpError(409, 'This invitation is no longer available. Ask the admin for a new link.');
  if (invitation.phone === env.ADMIN_PHONE) throw new HttpError(409, 'This number already has an account.');
  const passwordHash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);
  const userId = crypto.randomUUID();
  const name = `business_${userId.replaceAll('-', '')}`;
  // Every statement is conditional on the same newly created user; the batch is atomic.
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO users (id, phone, company_name, password_hash, created_at)
      SELECT ?, phone, ?, ?, ? FROM invitations WHERE id = ? AND token_hash = ? AND status = 'pending' AND expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM users WHERE phone = invitations.phone)`)
      .bind(userId, companyName, passwordHash, now, invitation.id, invitation.token_hash, now),
    env.DB.prepare(`UPDATE invitations SET status = 'accepted', user_id = ?, accepted_at = ?
      WHERE id = ? AND token_hash = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM users WHERE id = ?)`)
      .bind(userId, now, invitation.id, invitation.token_hash, userId),
    env.DB.prepare(`INSERT INTO whatsapp_connections (owner_id, user_id, session_name)
      SELECT id, id, ? FROM users WHERE id = ?`).bind(name, userId),
  ]);
  if (results[0].meta.changes !== 1) throw new HttpError(409, 'This invitation was already used or has expired. Log in or ask the admin for a new link.');
  return invitation.phone;
}
