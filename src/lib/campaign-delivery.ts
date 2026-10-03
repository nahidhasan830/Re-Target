import { env } from 'cloudflare:workers';
import { z } from 'zod';
import {
  compileParts,
  dhakaDate,
  nextBudgetDay,
  skipReasons,
  SEND_INTERVAL_SECONDS,
  DAILY_SEND_ATTEMPTS,
  type Content,
} from './campaign-content';
import {
  getCampaign,
  campaignAssets,
  outboxStatement,
  dispatchOutbox,
  nowSeconds,
} from './campaigns';
import { whatsAppState, checkWhatsAppNumber } from './waha';
import { signedMediaUrl } from './campaign-media';
import { sendCampaignPart } from './campaign-provider';
import { reconcileMessageEvents } from './campaign-events';
import { restrictionReasons } from './whatsapp-restrictions';

export const campaignQueueMessage = z
  .object({
    kind: z.literal('campaign'),
    ownerId: z.union([z.literal('admin'), z.uuid()]),
    campaignId: z.uuid(),
    workId: z.string().min(1).max(120),
    task: z.enum(['prepare', 'send']),
  })
  .strict();
export const sessionFor = (ownerId: string) =>
  ownerId === 'admin' ? 'admin' : `business_${ownerId.replaceAll('-', '')}`;
export async function activeCampaignOwner(ownerId: string) {
  return (
    ownerId === 'admin' ||
    !!(await env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1')
      .bind(ownerId)
      .first())
  );
}
export async function ensureSender(ownerId: string, phone: string) {
  await env.DB.prepare(
    `INSERT INTO sender_dispatch_state(owner_id,session_name,phone) VALUES (?,?,?)
    ON CONFLICT(owner_id) DO UPDATE SET phone=CASE WHEN active_attempt IS NULL THEN excluded.phone ELSE phone END,
    pause_reason=CASE WHEN phone!=excluded.phone THEN 'Sender number changed. Review before continuing.' ELSE pause_reason END`,
  )
    .bind(ownerId, sessionFor(ownerId), phone)
    .run();
}
export async function prepareCampaign(ownerId: string, id: string) {
  const campaign = await getCampaign(ownerId, id);
  if (campaign.status !== 'preparing' || !(await activeCampaignOwner(ownerId)))
    return;
  if (
    await env.DB.prepare(
      'SELECT owner_id FROM sender_dispatch_state WHERE owner_id=? AND active_attempt IS NOT NULL',
    )
      .bind(ownerId)
      .first()
  )
    return;
  const token = crypto.randomUUID();
  const claim = await env.DB.prepare(
    "UPDATE campaigns SET preparation_token=?,preparation_until=unixepoch()+180 WHERE owner_id=? AND id=? AND status='preparing' AND preparation_until<=unixepoch()",
  )
    .bind(token, ownerId, id)
    .run();
  if (!claim.meta.changes) return;
  try {
    const rows = await env.DB.prepare(
      'SELECT id,lead_id,phone,name,chat_id,skip_reason FROM campaign_recipients WHERE owner_id=? AND campaign_id=? AND prepared=0 ORDER BY id LIMIT 25',
    )
      .bind(ownerId, id)
      .all<{
        id: string;
        lead_id: string | null;
        phone: string;
        name: string;
        chat_id: string | null;
        skip_reason: string | null;
      }>();
    const content = JSON.parse(campaign.content_json) as Content,
      assets = await campaignAssets(ownerId, content);
    const current = await whatsAppState(sessionFor(ownerId));
    if (current.restriction) {
      await ensureSender(ownerId, campaign.sender_phone!);
      await pauseSender(ownerId, current.restriction.error);
      return;
    }
    if (
      current.status !== 'WORKING' ||
      current.phone !== campaign.sender_phone
    ) {
      await pauseSender(ownerId, 'Reconnect the original campaign sender.');
      return;
    }
    let checks = 0;
    for (const recipient of rows.results) {
      let chatId = recipient.chat_id,
        reason = recipient.skip_reason,
        reasons: string[] = [];
      if (recipient.lead_id) {
        let lead = await currentLead(ownerId, recipient.lead_id);
        if (
          lead &&
          (!lead.whatsappCheckedAt ||
            lead.whatsappCheckedAt < nowSeconds() - 604800 ||
            lead.whatsappExists === null)
        ) {
          if (checks >= 5) break;
          checks++;
          try {
            const check = await checkWhatsAppNumber(
              sessionFor(ownerId),
              recipient.phone,
            );
            await env.DB.prepare(
              'UPDATE leads SET whatsapp_exists=?,whatsapp_chat_id=?,whatsapp_checked_at=unixepoch() WHERE owner_id=? AND id=?',
            )
              .bind(
                Number(check.exists),
                check.chatId,
                ownerId,
                recipient.lead_id,
              )
              .run();
            lead = await currentLead(ownerId, recipient.lead_id);
          } catch {
            /* Unresolved registration stays a distinct skip reason. */
          }
        }
        if (lead) {
          reasons = skipReasons(lead, nowSeconds());
          reason = reasons[0] ?? null;
          chatId = lead.chatId;
        } else {
          reason = 'excluded';
          reasons = ['excluded'];
        }
      }
      const parts = reason
        ? []
        : compileParts(content, assets, recipient.name, campaign.company_name);
      const guard =
        "EXISTS(SELECT 1 FROM campaigns WHERE owner_id=? AND id=? AND status='preparing' AND preparation_token=?)";
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE campaign_recipients SET prepared=1,chat_id=?,skip_reason=?,reasons_json=? WHERE owner_id=? AND id=? AND prepared=0 AND ${guard}`,
        ).bind(
          chatId,
          reason,
          JSON.stringify(reasons),
          ownerId,
          recipient.id,
          ownerId,
          id,
          token,
        ),
        ...parts.map((part) =>
          env.DB.prepare(
            `INSERT INTO campaign_messages(id,owner_id,campaign_id,recipient_id,ordinal,kind,text,asset_id,due_at)
          SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(owner_id,recipient_id,ordinal) DO NOTHING`,
          ).bind(
            `${recipient.id}:${part.ordinal}`,
            ownerId,
            id,
            recipient.id,
            part.ordinal,
            part.kind,
            part.text,
            part.assetId,
            campaign.is_test ? nowSeconds() : Math.max(nowSeconds(), campaign.scheduled_at ?? 0),
            ownerId,
            id,
            token,
          ),
        ),
      ]);
    }
    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) n FROM campaign_recipients WHERE owner_id=? AND campaign_id=? AND prepared=0',
    )
      .bind(ownerId, id)
      .first<number>('n');
    if (remaining) {
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE campaigns SET preparation_done=(SELECT COUNT(*) FROM campaign_recipients WHERE owner_id=? AND campaign_id=? AND prepared=1),preparation_until=0,preparation_token=NULL WHERE owner_id=? AND id=? AND preparation_token=?',
        ).bind(ownerId, id, ownerId, id, token),
        outboxStatement(ownerId, id, 'prepare', id, nowSeconds() + 10),
      ]);
    } else {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE campaigns SET status=CASE WHEN scheduled_at>unixepoch() THEN 'scheduled' ELSE 'running' END,preparation_done=(SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id=?),preparation_until=0,preparation_token=NULL
          WHERE owner_id=? AND id=? AND status='preparing' AND preparation_token=?`,
        ).bind(id, ownerId, id, token),
        env.DB.prepare(
          `INSERT INTO campaign_outbox(id,owner_id,campaign_id,kind,work_id,available_at)
          SELECT 'send:'||m.id,m.owner_id,m.campaign_id,'send',m.id,m.due_at FROM campaign_messages m WHERE m.owner_id=? AND m.campaign_id=? AND m.ordinal=0
          AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=m.campaign_id AND c.status IN ('running','scheduled')) ON CONFLICT DO NOTHING`,
        ).bind(ownerId, id),
        env.DB.prepare('DELETE FROM campaign_outbox WHERE id=?').bind(
          `prepare:${id}`,
        ),
      ]);
      await finishCampaign(ownerId, id);
    }
  } catch (error) {
    await env.DB.prepare(
      "UPDATE campaigns SET status='paused',preparation_until=0,preparation_token=NULL WHERE owner_id=? AND id=? AND preparation_token=?",
    )
      .bind(ownerId, id, token)
      .run();
    throw error;
  } finally {
    await env.DB.prepare(
      'UPDATE campaigns SET preparation_until=0,preparation_token=NULL WHERE owner_id=? AND id=? AND preparation_token=?',
    )
      .bind(ownerId, id, token)
      .run();
  }
  await dispatchOutbox();
}
type CurrentLead = {
  excluded: number;
  whatsappExists: number | null;
  whatsappCheckedAt: number | null;
  chatId: string | null;
  nextAllowedAt: number | null;
  activeRecipient: string | null;
};
async function currentLead(ownerId: string, leadId: string) {
  return env.DB.prepare(
    `SELECT l.excluded,l.whatsapp_exists whatsappExists,l.whatsapp_checked_at whatsappCheckedAt,l.whatsapp_chat_id chatId,
    cs.next_allowed_at nextAllowedAt,cs.active_recipient activeRecipient FROM leads l
    LEFT JOIN lead_contact_state cs ON cs.owner_id=l.owner_id AND cs.lead_id=l.id WHERE l.owner_id=? AND l.id=?`,
  )
    .bind(ownerId, leadId)
    .first<CurrentLead>();
}
export async function pauseSender(ownerId: string, reason: string) {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO sender_dispatch_state(owner_id,session_name,phone) SELECT owner_id,session_name,phone FROM whatsapp_connections WHERE owner_id=? AND phone IS NOT NULL ON CONFLICT DO NOTHING',
    ).bind(ownerId),
    env.DB.prepare(
      'UPDATE sender_dispatch_state SET pause_reason=? WHERE owner_id=?',
    ).bind(reason, ownerId),
    env.DB.prepare(
      "UPDATE campaigns SET status='paused',updated_at=unixepoch() WHERE owner_id=? AND status IN ('running','scheduled','preparing')",
    ).bind(ownerId),
  ]);
}
type Message = {
  id: string;
  owner_id: string;
  campaign_id: string;
  recipient_id: string;
  ordinal: number;
  kind: string;
  text: string;
  asset_id: string | null;
  status: string;
  due_at: number;
  lease_token: string | null;
  lease_until: number;
  retry_count: number;
};
type Recipient = {
  id: string;
  lead_id: string | null;
  phone: string;
  chat_id: string | null;
  reserved: number;
  budget_date: string | null;
  replied_at: number | null;
  skip_reason: string | null;
};
export async function processCampaignPart(
  ownerId: string,
  campaignId: string,
  messageId: string,
) {
  const campaign = await getCampaign(ownerId, campaignId);
  if (campaign.status !== 'running') return;
  if (!(await activeCampaignOwner(ownerId))) {
    await pauseSender(ownerId, 'Account is inactive.');
    return;
  }
  const message = await env.DB.prepare(
    'SELECT * FROM campaign_messages WHERE owner_id=? AND campaign_id=? AND id=?',
  )
    .bind(ownerId, campaignId, messageId)
    .first<Message>();
  if (!message || message.status !== 'pending' || message.due_at > nowSeconds())
    return;
  const recipient = await env.DB.prepare(
    'SELECT * FROM campaign_recipients WHERE owner_id=? AND id=?',
  )
    .bind(ownerId, message.recipient_id)
    .first<Recipient>();
  if (!recipient) return;
  const previous = await env.DB.prepare(
    "SELECT id FROM campaign_messages WHERE owner_id=? AND recipient_id=? AND ordinal<? AND status!='sent' LIMIT 1",
  )
    .bind(ownerId, recipient.id, message.ordinal)
    .first();
  if (previous) return;
  if (recipient.replied_at || recipient.skip_reason) {
    await skipSequence(
      ownerId,
      campaignId,
      recipient,
      recipient.skip_reason ?? 'replied',
    );
    return;
  }
  if (recipient.lead_id) {
    const lead = await currentLead(ownerId, recipient.lead_id);
    const reasons = lead
      ? skipReasons(
          {
            ...lead,
            nextAllowedAt:
              lead.activeRecipient === recipient.id ? 0 : lead.nextAllowedAt,
          },
          nowSeconds(),
        )
      : ['excluded'];
    if (reasons.length) {
      await skipSequence(ownerId, campaignId, recipient, reasons[0]!);
      return;
    }
    if (lead!.activeRecipient && lead!.activeRecipient !== recipient.id) {
      await defer(message, nowSeconds() + 60);
      return;
    }
    if (lead!.chatId !== recipient.chat_id) {
      await skipSequence(ownerId, campaignId, recipient, 'not_verified');
      return;
    }
  }
  let media: { url: string; mime: string } | undefined;
  try {
    if (message.asset_id)
      media = await signedMediaUrl(ownerId, message.asset_id);
  } catch {
    await definitiveFailure(
      message,
      'Attachment unavailable. Replace this failed part through recovery.',
    );
    return;
  }
  let state;
  try {
    state = await whatsAppState(sessionFor(ownerId));
  } catch {
    await ensureSender(ownerId, campaign.sender_phone!);
    await pauseSender(
      ownerId,
      'Gateway unavailable. Review the connection before resuming.',
    );
    return;
  }
  if (state.status !== 'WORKING' || state.phone !== campaign.sender_phone) {
    await ensureSender(ownerId, campaign.sender_phone!);
    await pauseSender(ownerId, 'Reconnect the original campaign sender.');
    return;
  }
  if (!recipient.chat_id) {
    await skipSequence(ownerId, campaignId, recipient, 'not_verified');
    return;
  }
  if (state.restriction) {
    await ensureSender(ownerId, state.phone!);
    await pauseSender(ownerId, state.restriction.error);
    await skipSequence(ownerId, campaignId, recipient, state.restriction.reason, state.restriction.error);
    return;
  }
  await ensureSender(ownerId, state.phone!);
  const now = nowSeconds(),
    date = dhakaDate(now),
    token = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE sender_dispatch_state SET budget_date=?,consumed=0,reserved=0 WHERE owner_id=? AND budget_date!=? AND active_attempt IS NULL',
    ).bind(date, ownerId, date),
    env.DB.prepare(
      "UPDATE campaign_recipients SET reserved=0,budget_date=? WHERE owner_id=? AND budget_date IS NOT ? AND NOT EXISTS(SELECT 1 FROM campaign_messages WHERE recipient_id=campaign_recipients.id AND status IN ('submitting','unconfirmed'))",
    ).bind(date, ownerId, date),
    ...(recipient.lead_id
      ? [
          env.DB.prepare(
            'INSERT INTO lead_contact_state(owner_id,lead_id) VALUES (?,?) ON CONFLICT DO NOTHING',
          ).bind(ownerId, recipient.lead_id),
        ]
      : []),
  ]);
  const pending =
    (await env.DB.prepare(
      "SELECT COUNT(*) n FROM campaign_messages WHERE owner_id=? AND recipient_id=? AND status='pending'",
    )
      .bind(ownerId, recipient.id)
      .first<number>('n')) ?? 0;
  const fresh = await env.DB.prepare(
    'SELECT reserved,budget_date FROM campaign_recipients WHERE owner_id=? AND id=?',
  )
    .bind(ownerId, recipient.id)
    .first<{ reserved: number; budget_date: string }>();
  const needed = Math.max(0, pending - (fresh?.reserved ?? 0));
  // Each dependent mutation is fenced by the sender token in the same atomic D1 batch.
  const mutableGate = `EXISTS(SELECT 1 FROM campaigns c WHERE c.owner_id=? AND c.id=? AND c.status='running' AND c.revision=? AND ?<=unixepoch()
    AND (c.owner_id='admin' OR EXISTS(SELECT 1 FROM users u WHERE u.id=c.owner_id AND u.active=1))
    AND EXISTS(SELECT 1 FROM whatsapp_connections w WHERE w.owner_id=c.owner_id AND w.phone=c.sender_phone AND w.status='WORKING' AND w.operation_until<=unixepoch()))
    AND EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.owner_id=? AND r.id=? AND r.skip_reason IS NULL AND r.replied_at IS NULL
      AND (r.lead_id IS NULL OR EXISTS(SELECT 1 FROM leads l
        WHERE l.owner_id=r.owner_id AND l.id=r.lead_id AND l.excluded=0
        AND l.whatsapp_exists=1 AND l.whatsapp_chat_id=r.chat_id AND l.whatsapp_checked_at>=?-604800)))`;
  const gateArgs = [
    ownerId,
    campaignId,
    campaign.revision,
    now,
    ownerId,
    recipient.id,
    now,
  ];
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE sender_dispatch_state SET active_attempt=?,lease_until=?,reserved=reserved+?,last_dispatch_at=?,active_recipient=?
      WHERE owner_id=? AND phone=? AND active_attempt IS NULL AND pause_reason IS NULL AND next_allowed_at<=? AND budget_date=? AND consumed+reserved+?<=${DAILY_SEND_ATTEMPTS}
      AND (SELECT COUNT(*) FROM sender_dispatch_state WHERE active_attempt IS NOT NULL)<2
      AND (active_recipient IS NULL OR active_recipient=?) AND ${mutableGate}
      AND EXISTS(SELECT 1 FROM campaign_messages WHERE owner_id=? AND id=? AND status='pending' AND due_at<=?)
      AND NOT EXISTS(SELECT 1 FROM campaign_messages m JOIN campaign_recipients r ON r.id=m.recipient_id WHERE m.owner_id=? AND m.status='pending' AND r.id!=? AND r.reserved>0)
      ${recipient.lead_id ? 'AND EXISTS(SELECT 1 FROM lead_contact_state WHERE owner_id=? AND lead_id=? AND (active_recipient IS NULL OR active_recipient=?) AND (active_recipient=? OR next_allowed_at<=?))' : ''}`,
    ).bind(
      token,
      now + 180,
      needed,
      now,
      recipient.id,
      ownerId,
      state.phone!,
      now,
      date,
      needed,
      recipient.id,
      ...gateArgs,
      ownerId,
      messageId,
      now,
      ownerId,
      recipient.id,
      ...(recipient.lead_id
        ? [ownerId, recipient.lead_id, recipient.id, recipient.id, now]
        : []),
    ),
    ...(recipient.lead_id
      ? [
          env.DB.prepare(
            `UPDATE lead_contact_state SET active_recipient=? WHERE owner_id=? AND lead_id=? AND EXISTS(SELECT 1 FROM sender_dispatch_state WHERE owner_id=? AND active_attempt=?)`,
          ).bind(recipient.id, ownerId, recipient.lead_id, ownerId, token),
        ]
      : []),
    env.DB.prepare(
      `UPDATE campaign_recipients SET reserved=reserved+?,budget_date=? WHERE owner_id=? AND id=? AND EXISTS(SELECT 1 FROM sender_dispatch_state WHERE owner_id=? AND active_attempt=?)`,
    ).bind(needed, date, ownerId, recipient.id, ownerId, token),
    env.DB.prepare(
      `UPDATE campaign_messages SET status='submitting',lease_token=?,lease_until=? WHERE owner_id=? AND id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM sender_dispatch_state WHERE owner_id=? AND active_attempt=?)`,
    ).bind(token, now + 180, ownerId, messageId, ownerId, token),
    env.DB.prepare(
      `INSERT INTO campaign_send_attempts(id,owner_id,message_id,status,submitted_at) SELECT ?,?,?,'submitting',? WHERE EXISTS(SELECT 1 FROM campaign_messages WHERE owner_id=? AND id=? AND status='submitting' AND lease_token=?)`,
    ).bind(token, ownerId, messageId, now, ownerId, messageId, token),
    env.DB.prepare(
      `UPDATE sender_dispatch_state SET consumed=consumed+1,reserved=reserved-1 WHERE owner_id=? AND active_attempt=? AND reserved>0`,
    ).bind(ownerId, token),
    env.DB.prepare(
      `UPDATE campaign_recipients SET reserved=reserved-1 WHERE owner_id=? AND id=? AND reserved>0 AND EXISTS(SELECT 1 FROM sender_dispatch_state WHERE owner_id=? AND active_attempt=?)`,
    ).bind(ownerId, recipient.id, ownerId, token),
  ]);
  if (!result[0]!.meta.changes) {
    const sender = await env.DB.prepare(
      'SELECT next_allowed_at,consumed,reserved FROM sender_dispatch_state WHERE owner_id=?',
    )
      .bind(ownerId)
      .first<{ next_allowed_at: number; consumed: number; reserved: number }>();
    await defer(
      message,
      sender && sender.consumed + sender.reserved + needed > DAILY_SEND_ATTEMPTS
        ? nextBudgetDay(now)
        : Math.max(now + SEND_INTERVAL_SECONDS, sender?.next_allowed_at ?? 0),
    );
    return;
  }
  const persisted = await env.DB.prepare(
    `SELECT m.id FROM campaign_messages m JOIN sender_dispatch_state s ON s.owner_id=m.owner_id
    JOIN campaign_recipients r ON r.owner_id=m.owner_id AND r.id=m.recipient_id
    ${recipient.lead_id ? 'JOIN lead_contact_state cs ON cs.owner_id=r.owner_id AND cs.lead_id=r.lead_id' : ''}
    WHERE m.id=? AND m.owner_id=? AND m.status='submitting' AND m.lease_token=? AND s.active_attempt=? AND s.lease_until>unixepoch() AND s.pause_reason IS NULL
    ${recipient.lead_id ? 'AND cs.active_recipient=r.id' : ''} AND ${mutableGate}`,
  )
    .bind(messageId, ownerId, token, token, ...gateArgs)
    .first();
  if (!persisted) {
    const pauseReason = await env.DB.prepare(
      'SELECT pause_reason FROM sender_dispatch_state WHERE owner_id=?',
    ).bind(ownerId).first<string>('pause_reason');
    await rejectBeforeSubmission(
      message,
      token,
      pauseReason ?? 'Requirements changed before dispatch.',
      Object.entries(restrictionReasons).find(([, error]) => error === pauseReason)?.[0],
    );
    return;
  }
  const outcome = await sendCampaignPart(
    sessionFor(ownerId),
    recipient.chat_id,
    {
      kind: message.kind,
      text: message.text,
      ...(media ? { mediaUrl: media.url, mime: media.mime } : {}),
    },
  );
  const finished = nowSeconds();
  try {
    const saved = await env.DB.batch([
      env.DB.prepare(
        `UPDATE campaign_messages SET status=?,gateway_id=?,error=?,accepted_at=CASE WHEN ?='accepted' THEN ? ELSE NULL END,lease_until=0
        WHERE owner_id=? AND id=? AND status='submitting' AND lease_token=? AND EXISTS(SELECT 1 FROM sender_dispatch_state WHERE owner_id=? AND active_attempt=?)`,
      ).bind(
        outcome.outcome === 'accepted'
          ? 'sent'
          : outcome.outcome === 'unconfirmed'
            ? 'unconfirmed'
            : outcome.skipReason ? 'skipped' : 'failed',
        outcome.messageId,
        outcome.error,
        outcome.outcome,
        finished,
        ownerId,
        messageId,
        token,
        ownerId,
        token,
      ),
      env.DB.prepare(
        "UPDATE campaign_send_attempts SET status=?,finished_at=?,gateway_id=?,error=? WHERE id=? AND status='submitting'",
      ).bind(
        outcome.outcome,
        finished,
        outcome.messageId,
        outcome.error,
        token,
      ),
      env.DB.prepare(
        `UPDATE sender_dispatch_state SET active_attempt=CASE WHEN ?='unconfirmed' THEN active_attempt ELSE NULL END,lease_until=0,next_allowed_at=?,pause_reason=CASE WHEN ?=1 THEN ? ELSE pause_reason END
        WHERE owner_id=? AND active_attempt=?`,
      ).bind(
        outcome.outcome,
        finished + Math.max(SEND_INTERVAL_SECONDS, outcome.retryAfter ?? 0),
        Number(outcome.pause),
        outcome.error,
        ownerId,
        token,
      ),
      ...(outcome.outcome === 'accepted' && recipient.lead_id
        ? [
            env.DB.prepare(
              'UPDATE lead_contact_state SET last_contact_at=?,next_allowed_at=? WHERE owner_id=? AND lead_id=? AND active_recipient=?',
            ).bind(
              finished,
              finished + 604800,
              ownerId,
              recipient.lead_id,
              recipient.id,
            ),
          ]
        : []),
      env.DB.prepare('DELETE FROM campaign_outbox WHERE id=?').bind(
        `send:${messageId}`,
      ),
    ]);
    if (!saved[0]!.meta.changes) {
      await markUnconfirmed(
        ownerId,
        messageId,
        token,
        'A stale worker could not persist the send outcome.',
      );
      return;
    }
  } catch {
    await markUnconfirmed(
      ownerId,
      messageId,
      token,
      'The send outcome could not be saved. Check WhatsApp before resolving.',
    );
    return;
  }
  if (outcome.pause) await pauseSender(ownerId, outcome.error!);
  if (outcome.outcome === 'accepted') {
    await reconcileMessageEvents(ownerId, outcome.messageId!);
    await continueSequence(message, finished + SEND_INTERVAL_SECONDS);
  }
  if (outcome.outcome === 'rejected') {
    if (outcome.skipReason) {
      await skipSequence(ownerId, campaignId, recipient, outcome.skipReason, outcome.error!);
    } else {
      await env.DB.prepare(
        "UPDATE campaign_messages SET status='skipped',error='Previous part failed' WHERE owner_id=? AND recipient_id=? AND status='pending'",
      )
        .bind(ownerId, recipient.id)
        .run();
      await releaseSequence(ownerId, recipient);
    }
    const failures = await env.DB.prepare(
      "SELECT status FROM campaign_send_attempts WHERE owner_id=? AND status IN ('accepted','rejected') ORDER BY submitted_at DESC,id DESC LIMIT 10",
    )
      .bind(ownerId)
      .all<{ status: string }>();
    if (!outcome.pause && failures.results.filter((r) => r.status === 'rejected').length >= 3)
      await pauseSender(
        ownerId,
        'Three definitive failures in the last ten attempts. Review before continuing.',
      );
  }
  await finishCampaign(ownerId, campaignId);
  await dispatchOutbox();
}
async function rejectBeforeSubmission(
  message: Message,
  token: string,
  error: string,
  skipReason?: string,
) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE campaign_messages SET status='skipped',error=?,lease_until=0 WHERE owner_id=? AND id=? AND lease_token=? AND status='submitting'",
    ).bind(error, message.owner_id, message.id, token),
    env.DB.prepare(
      "UPDATE campaign_send_attempts SET status='rejected',error=?,finished_at=unixepoch() WHERE id=? AND status='submitting'",
    ).bind(error, token),
    env.DB.prepare(
      'UPDATE sender_dispatch_state SET active_attempt=NULL,lease_until=0,next_allowed_at=unixepoch()+? WHERE owner_id=? AND active_attempt=?',
    ).bind(SEND_INTERVAL_SECONDS, message.owner_id, token),
  ]);
  await env.DB.prepare(
    "UPDATE campaign_messages SET status='skipped',error=? WHERE owner_id=? AND recipient_id=? AND status='pending'",
  )
    .bind(error, message.owner_id, message.recipient_id)
    .run();
  const recipient = await env.DB.prepare(
    'SELECT id,lead_id FROM campaign_recipients WHERE owner_id=? AND id=?',
  )
    .bind(message.owner_id, message.recipient_id)
    .first<Recipient>();
  if (recipient) {
    if (skipReason) await skipSequence(message.owner_id, message.campaign_id, recipient, skipReason, error);
    else await releaseSequence(message.owner_id, recipient);
  }
  await finishCampaign(message.owner_id, message.campaign_id);
}
async function definitiveFailure(message: Message, error: string) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE campaign_messages SET status='failed',error=? WHERE owner_id=? AND id=? AND status='pending'",
    ).bind(error, message.owner_id, message.id),
    env.DB.prepare(
      "UPDATE campaign_messages SET status='skipped',error='Previous part failed' WHERE owner_id=? AND recipient_id=? AND ordinal>? AND status='pending'",
    ).bind(message.owner_id, message.recipient_id, message.ordinal),
  ]);
  const recipient = await env.DB.prepare(
    'SELECT id,lead_id FROM campaign_recipients WHERE owner_id=? AND id=?',
  )
    .bind(message.owner_id, message.recipient_id)
    .first<Recipient>();
  if (recipient) await releaseSequence(message.owner_id, recipient);
  await finishCampaign(message.owner_id, message.campaign_id);
}
async function defer(message: Message, due: number) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE campaign_messages SET due_at=? WHERE owner_id=? AND id=? AND status='pending'",
    ).bind(due, message.owner_id, message.id),
    outboxStatement(
      message.owner_id,
      message.campaign_id,
      'send',
      message.id,
      due,
    ),
  ]);
  await dispatchOutbox();
}
export async function releaseSequence(
  ownerId: string,
  recipient: Pick<Recipient, 'id' | 'lead_id'>,
) {
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE sender_dispatch_state SET active_recipient=CASE WHEN active_recipient=? THEN NULL ELSE active_recipient END,reserved=MAX(0,reserved-COALESCE((SELECT reserved FROM campaign_recipients WHERE owner_id=? AND id=? AND budget_date=sender_dispatch_state.budget_date),0)) WHERE owner_id=?',
    ).bind(recipient.id, ownerId, recipient.id, ownerId),
    env.DB.prepare(
      'UPDATE campaign_recipients SET reserved=0 WHERE owner_id=? AND id=?',
    ).bind(ownerId, recipient.id),
    ...(recipient.lead_id
      ? [
          env.DB.prepare(
            "UPDATE lead_contact_state SET active_recipient=NULL WHERE owner_id=? AND lead_id=? AND active_recipient=? AND NOT EXISTS(SELECT 1 FROM campaign_messages WHERE recipient_id=? AND status IN ('submitting','unconfirmed'))",
          ).bind(ownerId, recipient.lead_id, recipient.id, recipient.id),
        ]
      : []),
  ]);
}
async function skipSequence(
  ownerId: string,
  campaignId: string,
  recipient: Recipient,
  reason: string,
  error = reason,
) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE campaign_messages SET status='skipped',error=? WHERE owner_id=? AND recipient_id=? AND status='pending'",
    ).bind(error, ownerId, recipient.id),
    env.DB.prepare(
      "UPDATE campaign_recipients SET skip_reason=?,reasons_json=? WHERE owner_id=? AND id=? AND NOT EXISTS(SELECT 1 FROM campaign_messages WHERE recipient_id=? AND status='sent')",
    ).bind(reason, JSON.stringify([reason]), ownerId, recipient.id, recipient.id),
  ]);
  await releaseSequence(ownerId, recipient);
  await finishCampaign(ownerId, campaignId);
}
async function continueSequence(message: Message, due: number) {
  const next = await env.DB.prepare(
    "SELECT id FROM campaign_messages WHERE owner_id=? AND recipient_id=? AND ordinal>? AND status='pending' ORDER BY ordinal LIMIT 1",
  )
    .bind(message.owner_id, message.recipient_id, message.ordinal)
    .first<{ id: string }>();
  if (next)
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE campaign_messages SET due_at=? WHERE owner_id=? AND id=? AND status='pending'",
      ).bind(due, message.owner_id, next.id),
      outboxStatement(
        message.owner_id,
        message.campaign_id,
        'send',
        next.id,
        due,
      ),
    ]);
  else {
    const recipient = await env.DB.prepare(
      'SELECT id,lead_id FROM campaign_recipients WHERE owner_id=? AND id=?',
    )
      .bind(message.owner_id, message.recipient_id)
      .first<Recipient>();
    if (recipient) await releaseSequence(message.owner_id, recipient);
  }
}
export async function finishCampaign(ownerId: string, id: string) {
  await env.DB.prepare(
    `UPDATE campaigns SET status='completed',updated_at=unixepoch() WHERE owner_id=? AND id=? AND status IN ('running','scheduled')
    AND NOT EXISTS(SELECT 1 FROM campaign_recipients WHERE owner_id=? AND campaign_id=? AND prepared=0)
    AND NOT EXISTS(SELECT 1 FROM campaign_messages WHERE owner_id=? AND campaign_id=? AND status IN ('pending','submitting','unconfirmed'))`,
  )
    .bind(ownerId, id, ownerId, id, ownerId, id)
    .run();
}
async function markUnconfirmed(
  ownerId: string,
  id: string,
  token: string,
  error: string,
) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE campaign_messages SET status='unconfirmed',lease_until=0,error=? WHERE owner_id=? AND id=? AND status='submitting' AND lease_token=?",
    ).bind(error, ownerId, id, token),
    env.DB.prepare(
      "UPDATE campaign_send_attempts SET status='unconfirmed',error=? WHERE id=? AND owner_id=? AND status='submitting'",
    ).bind(error, token, ownerId),
  ]);
  await pauseSender(ownerId, error);
}
export async function recoverCampaigns() {
  const invitations = await env.DB.prepare(
    "SELECT a.id FROM campaign_send_attempts a JOIN sender_dispatch_state s ON s.active_attempt=a.id WHERE a.invitation_id IS NOT NULL AND a.status='submitting' AND s.lease_until<=unixepoch() LIMIT 10",
  ).all<{ id: string }>();
  for (const attempt of invitations.results) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE campaign_send_attempts SET status='unconfirmed',error='Invitation request expired without a persisted outcome.' WHERE id=? AND status='submitting'",
      ).bind(attempt.id),
      env.DB.prepare(
        "UPDATE invitations SET delivery_status='unknown',delivery_error='Check WhatsApp before resending.' WHERE id=(SELECT invitation_id FROM campaign_send_attempts WHERE id=?) AND delivery_status='sending'",
      ).bind(attempt.id),
    ]);
    await pauseSender(
      'admin',
      'Invitation send unconfirmed. Review the sender on WhatsApp.',
    );
  }
  const expired = await env.DB.prepare(
    "SELECT owner_id,id,lease_token FROM campaign_messages WHERE status='submitting' AND lease_until<=unixepoch() LIMIT 30",
  ).all<{ owner_id: string; id: string; lease_token: string }>();
  for (const m of expired.results)
    await markUnconfirmed(
      m.owner_id,
      m.id,
      m.lease_token,
      'The submitting lease expired. Check WhatsApp before resolving.',
    );
  await env.DB.prepare(
    "UPDATE campaigns SET status='running' WHERE status='scheduled' AND scheduled_at<=unixepoch()",
  ).run();
  const preparing = await env.DB.prepare(
    "SELECT owner_id,id FROM campaigns WHERE status='preparing' AND preparation_until<=unixepoch() LIMIT 20",
  ).all<{ owner_id: string; id: string }>();
  if (preparing.results.length)
    await env.DB.batch(
      preparing.results.map((c) =>
        outboxStatement(c.owner_id, c.id, 'prepare', c.id, nowSeconds()),
      ),
    );
  const due = await env.DB.prepare(
    `SELECT m.owner_id,m.campaign_id,m.id,m.due_at FROM campaign_messages m JOIN campaigns c ON c.owner_id=m.owner_id AND c.id=m.campaign_id
    LEFT JOIN sender_dispatch_state s ON s.owner_id=m.owner_id WHERE m.status='pending' AND m.due_at<=unixepoch()+900 AND c.status IN ('running','scheduled')
    AND (s.active_attempt IS NULL AND s.pause_reason IS NULL) AND NOT EXISTS(SELECT 1 FROM campaign_messages p WHERE p.owner_id=m.owner_id AND p.recipient_id=m.recipient_id AND p.ordinal<m.ordinal AND p.status!='sent')
    ORDER BY COALESCE(s.last_dispatch_at,0),c.created_at,m.recipient_id,m.ordinal LIMIT 50`,
  ).all<{
    owner_id: string;
    campaign_id: string;
    id: string;
    due_at: number;
  }>();
  if (due.results.length)
    await env.DB.batch(
      due.results.map((m) =>
        outboxStatement(m.owner_id, m.campaign_id, 'send', m.id, m.due_at),
      ),
    );
  const held = await env.DB.prepare(
    `SELECT r.owner_id,r.id,r.lead_id FROM campaign_recipients r WHERE r.reserved>0 AND NOT EXISTS(SELECT 1 FROM campaign_messages m WHERE m.recipient_id=r.id AND m.status IN ('submitting','unconfirmed'))
    AND (EXISTS(SELECT 1 FROM campaigns c WHERE c.id=r.campaign_id AND c.status IN ('cancelled','archived','completed')) OR NOT EXISTS(SELECT 1 FROM campaign_messages m WHERE m.recipient_id=r.id AND m.status='pending')) LIMIT 30`,
  ).all<{ owner_id: string; id: string; lead_id: string | null }>();
  for (const r of held.results) await releaseSequence(r.owner_id, r);
  await dispatchOutbox();
}
