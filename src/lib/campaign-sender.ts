import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { digest, type Account } from './auth';
import { HttpError } from './http';
import { accountWhatsAppState } from './whatsapp-connections';

export const senderReviewInput = z
  .object({
    requestId: z.uuid(),
    evidence: z.string().trim().min(1).max(1000),
    invitationOutcome: z.enum(['sent', 'unsent', 'failed']).optional(),
    gatewayId: z.string().trim().min(1).max(200).optional(),
    acknowledgeDuplicateRisk: z.boolean().optional(),
  })
  .strict();
export async function senderReviewState(account: Account) {
  const sender = await env.DB.prepare(
    'SELECT phone,pause_reason pauseReason,active_attempt activeAttempt,lease_until leaseUntil,budget_date budgetDate,consumed,reserved,next_allowed_at nextAllowedAt FROM sender_dispatch_state WHERE owner_id=?',
  )
    .bind(account.id)
    .first();
  const attempt = await env.DB.prepare(
    'SELECT id,invitation_id invitationId,message_id messageId,status,error,(SELECT campaign_id FROM campaign_messages m WHERE m.id=campaign_send_attempts.message_id AND m.owner_id=campaign_send_attempts.owner_id) campaignId FROM campaign_send_attempts WHERE owner_id=? AND id=(SELECT active_attempt FROM sender_dispatch_state WHERE owner_id=?)',
  )
    .bind(account.id, account.id)
    .first();
  return { sender, attempt };
}
export async function reviewSender(
  account: Account,
  input: z.infer<typeof senderReviewInput>,
) {
  const hash = await digest(JSON.stringify(input));
  const previous = await env.DB.prepare(
    'SELECT input_hash FROM campaign_actions WHERE owner_id=? AND request_id=?',
  )
    .bind(account.id, input.requestId)
    .first<{ input_hash: string }>();
  if (previous) {
    if (previous.input_hash !== hash)
      throw new HttpError(409, 'This request ID was already used.');
    return senderReviewState(account);
  }
  const sender = await env.DB.prepare(
    'SELECT active_attempt,pause_reason FROM sender_dispatch_state WHERE owner_id=?',
  )
    .bind(account.id)
    .first<{ active_attempt: string | null; pause_reason: string | null }>();
  if (!sender) throw new HttpError(409, 'No sender state needs review.');
  const attempt = sender.active_attempt
    ? await env.DB.prepare(
        'SELECT id,status,invitation_id FROM campaign_send_attempts WHERE owner_id=? AND id=?',
      )
        .bind(account.id, sender.active_attempt)
        .first<{ id: string; status: string; invitation_id: string | null }>()
    : null;
  if (sender.active_attempt) {
    if (!attempt?.invitation_id || attempt.status !== 'unconfirmed')
      throw new HttpError(
        409,
        'Resolve campaign parts in their campaign, or wait for the active request.',
      );
    if (!input.invitationOutcome)
      throw new HttpError(400, 'Choose the confirmed invitation outcome.');
    if (input.invitationOutcome === 'sent' && !input.gatewayId)
      throw new HttpError(400, 'Record the verified gateway message ID.');
    if (input.invitationOutcome === 'unsent' && !input.acknowledgeDuplicateRisk)
      throw new HttpError(
        400,
        'Acknowledge duplicate risk before allowing a deliberate resend.',
      );
  }
  const state = await accountWhatsAppState(account);
  if (state.restriction) throw new HttpError(409, state.restriction.error);
  if (state.status !== 'WORKING' || !state.phone)
    throw new HttpError(
      409,
      'Connect WhatsApp before clearing a sender pause.',
    );
  const token = crypto.randomUUID();
  const result = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO campaign_actions(id,owner_id,actor,action,request_id,input_hash,evidence_json,created_at) SELECT ?,?,?,'sender_review',?,?,?,unixepoch() WHERE EXISTS(SELECT 1 FROM sender_dispatch_state WHERE owner_id=? AND active_attempt IS ? AND pause_reason IS ?)",
    ).bind(
      token,
      account.id,
      account.phone,
      input.requestId,
      hash,
      JSON.stringify({ ...input, attemptId: attempt?.id ?? null }),
      account.id,
      sender.active_attempt,
      sender.pause_reason,
    ),
    env.DB.prepare(
      'UPDATE sender_dispatch_state SET pause_reason=NULL,phone=?,active_attempt=NULL,lease_until=0,next_allowed_at=unixepoch()+60 WHERE owner_id=? AND active_attempt IS ? AND pause_reason IS ? AND EXISTS(SELECT 1 FROM campaign_actions WHERE id=?)',
    ).bind(
      state.phone,
      account.id,
      sender.active_attempt,
      sender.pause_reason,
      token,
    ),
    ...(attempt
      ? [
          env.DB.prepare(
            "UPDATE campaign_send_attempts SET status=?,resolution_json=?,finished_at=unixepoch() WHERE owner_id=? AND id=? AND status='unconfirmed' AND EXISTS(SELECT 1 FROM campaign_actions WHERE id=?)",
          ).bind(
            input.invitationOutcome === 'sent'
              ? 'resolved_sent'
              : 'resolved_unsent',
            JSON.stringify({ actor: account.phone, ...input }),
            account.id,
            attempt.id,
            token,
          ),
          env.DB.prepare(
            "UPDATE invitations SET delivery_status=?,message_id=?,delivery_error=? WHERE id=? AND delivery_status IN ('unknown','sending') AND EXISTS(SELECT 1 FROM campaign_actions WHERE id=?)",
          ).bind(
            input.invitationOutcome === 'sent' ? 'sent' : 'failed',
            input.gatewayId ?? null,
            input.invitationOutcome === 'sent'
              ? null
              : 'Outcome reviewed. Resend explicitly if needed.',
            attempt.invitation_id,
            token,
          ),
        ]
      : []),
  ]);
  if (!result[0]!.meta.changes)
    throw new HttpError(409, 'Sender state changed. Reload before reviewing.');
  return senderReviewState(account);
}
