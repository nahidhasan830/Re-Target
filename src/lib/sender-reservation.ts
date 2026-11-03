import { env } from 'cloudflare:workers';
import { HttpError } from './http';
import { dhakaDate, SEND_INTERVAL_SECONDS, DAILY_SEND_ATTEMPTS } from './campaign-content';

export type AdminMessage = 'invitation' | 'password_reset';
const attemptColumn = { invitation: 'invitation_id', password_reset: 'password_reset_id' } as const;
export const unconfirmedReason = {
  invitation: 'Invitation send unconfirmed. Check WhatsApp before resolving.',
  password_reset: 'Password reset send unconfirmed. Check WhatsApp before resolving.',
} as const;

export async function reserveAdminSender(id: string, phone: string, kind: AdminMessage) {
  const token = crypto.randomUUID(),
    now = Math.floor(Date.now() / 1000),
    date = dhakaDate(now);
  await env.DB.prepare(
    "INSERT INTO sender_dispatch_state(owner_id,session_name,phone) VALUES ('admin','admin',?) ON CONFLICT DO NOTHING",
  )
    .bind(phone)
    .run();
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE sender_dispatch_state SET budget_date=?,consumed=0,reserved=0 WHERE owner_id='admin' AND budget_date!=? AND active_attempt IS NULL",
    ).bind(date, date),
    env.DB.prepare(
      `UPDATE sender_dispatch_state SET active_attempt=?,lease_until=?,consumed=consumed+1,phone=? WHERE owner_id='admin' AND active_attempt IS NULL AND pause_reason IS NULL AND consumed+reserved<${DAILY_SEND_ATTEMPTS} AND (SELECT COUNT(*) FROM sender_dispatch_state WHERE active_attempt IS NOT NULL)<2`,
    ).bind(token, now + 60, phone),
    env.DB.prepare(
      `INSERT INTO campaign_send_attempts(id,owner_id,${attemptColumn[kind]},status,submitted_at) SELECT ?,'admin',?,'submitting',? WHERE EXISTS(SELECT 1 FROM sender_dispatch_state WHERE owner_id='admin' AND active_attempt=?)`,
    ).bind(token, id, now, token),
  ]);
  if (!results[1]!.meta.changes)
    throw new HttpError(
      409,
      'The WhatsApp sender is busy, paused, or has used its daily budget. Review Campaigns before sending again.',
    );
  return token;
}
export async function finishAdminReservation(
  token: string,
  status: 'sent' | 'failed' | 'unknown',
  messageId: string | null,
  kind: AdminMessage,
) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE campaign_send_attempts SET status=?,gateway_id=?,finished_at=unixepoch() WHERE id=? AND status='submitting'",
    ).bind(
      status === 'sent'
        ? 'accepted'
        : status === 'failed'
          ? 'rejected'
          : 'unconfirmed',
      messageId,
      token,
    ),
    env.DB.prepare(
      `UPDATE sender_dispatch_state SET active_attempt=CASE WHEN ?='unknown' THEN active_attempt ELSE NULL END,lease_until=0,next_allowed_at=unixepoch()+?,
      pause_reason=CASE WHEN ?='unknown' THEN ? ELSE pause_reason END WHERE owner_id='admin' AND active_attempt=?`,
    ).bind(status, SEND_INTERVAL_SECONDS, status, unconfirmedReason[kind], token),
  ]);
}
export const reserveInvitationSender = (id: string, phone: string) =>
  reserveAdminSender(id, phone, 'invitation');
export const finishInvitationReservation = (
  token: string,
  status: 'sent' | 'failed' | 'unknown',
  messageId: string | null,
) => finishAdminReservation(token, status, messageId, 'invitation');
