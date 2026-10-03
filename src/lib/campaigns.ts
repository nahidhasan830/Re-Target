import { env } from 'cloudflare:workers';
import { z } from 'zod';
import type { Account } from './auth';
import { digest } from './auth';
import { HttpError } from './http';
import {
  compileParts,
  draftInput,
  type Content,
  type Audience,
  type DraftInput,
  type AssetDefinition,
} from './campaign-content';
import {
  audienceSelection,
  previewAudience,
  reasonSql,
} from './campaign-audience';
import { accountWhatsAppState } from './whatsapp-connections';

export type Campaign = {
  id: string;
  owner_id: string;
  name: string;
  status: string;
  revision: number;
  content_json: string;
  audience_json: string;
  company_name: string;
  sender_phone: string | null;
  scheduled_at: number | null;
  expires_at: number | null;
  launch_status: string | null;
  preparation_cursor: string;
  preparation_done: number;
  is_test: number;
  created_at: number;
  updated_at: number;
};
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export async function getCampaign(ownerId: string, id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new HttpError(404, 'Campaign not found.');
  const campaign = await env.DB.prepare(
    'SELECT * FROM campaigns WHERE owner_id = ? AND id = ?',
  )
    .bind(ownerId, id)
    .first<Campaign>();
  if (!campaign) throw new HttpError(404, 'Campaign not found.');
  return campaign;
}
export async function campaignAssets(ownerId: string, content: Content) {
  const rows = await env.DB.prepare(
    "SELECT id,kind FROM campaign_assets WHERE owner_id = ? AND id IN (SELECT value FROM json_each(?)) AND state = 'ready'",
  )
    .bind(ownerId, JSON.stringify(content.assetIds))
    .all<AssetDefinition>();
  if (rows.results.length !== content.assetIds.length)
    throw new HttpError(
      400,
      'Prepare all attachments before saving the campaign.',
    );
  return rows.results;
}
function inputDraft(input: unknown) {
  const parsed = draftInput.safeParse(input);
  if (!parsed.success)
    throw new HttpError(
      400,
      parsed.error.issues[0]?.message ?? 'Check the campaign content.',
    );
  return parsed.data;
}
async function validateDraft(account: Account, input: DraftInput) {
  const assets = await campaignAssets(account.id, input.content);
  try {
    compileParts(input.content, assets, 'Sample customer', account.companyName);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Check the message.',
    );
  }
  if (input.audience.mode === 'selected') {
    const rows = await env.DB.prepare(
      'SELECT id FROM leads WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))',
    )
      .bind(account.id, JSON.stringify([...new Set(input.audience.ids)]))
      .all();
    if (rows.results.length !== new Set(input.audience.ids).size)
      throw new HttpError(404, 'One or more selected leads are unavailable.');
  }
  return assets;
}
export async function createDraft(
  account: Account,
  raw: unknown,
  audit?: {
    parentId: string;
    input: CampaignAction;
    hash: string;
    copyId: string;
  },
) {
  const input = inputDraft(raw);
  const assets = await validateDraft(account, input);
  const id = audit?.copyId ?? crypto.randomUUID(),
    now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO campaigns (id,owner_id,user_id,name,content_json,audience_json,company_name,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      account.id,
      account.role === 'user' ? account.id : null,
      input.name,
      JSON.stringify(input.content),
      JSON.stringify(input.audience),
      account.companyName,
      input.expiresAt,
      now,
      now,
    ),
    ...(audit
      ? [
          env.DB.prepare(
            'INSERT INTO campaign_actions(id,owner_id,campaign_id,actor,action,request_id,input_hash,evidence_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          ).bind(
            crypto.randomUUID(),
            account.id,
            audit.parentId,
            account.phone,
            'duplicate',
            audit.input.requestId,
            audit.hash,
            JSON.stringify({ duplicateId: id }),
            now,
          ),
        ]
      : []),
    ...compileParts(input.content, assets, null, account.companyName).map(
      (part) =>
        env.DB.prepare(
          'INSERT INTO campaign_parts(owner_id,campaign_id,ordinal,kind,text,asset_id) VALUES (?,?,?,?,?,?)',
        ).bind(
          account.id,
          id,
          part.ordinal,
          part.kind,
          part.text,
          part.assetId,
        ),
    ),
  ]);
  return detailCampaign(account.id, id);
}
export async function editDraft(account: Account, id: string, raw: unknown) {
  const input = inputDraft(raw);
  await getCampaign(account.id, id);
  const assets = await validateDraft(account, input);
  if (!input.revision)
    throw new HttpError(400, 'A campaign revision is required.');
  const next = input.revision + 1,
    editToken = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE campaigns SET name=?,content_json=?,audience_json=?,company_name=?,expires_at=?,revision=?,updated_at=?,edit_token=?
      WHERE owner_id=? AND id=? AND status='draft' AND revision=?`,
    ).bind(
      input.name,
      JSON.stringify(input.content),
      JSON.stringify(input.audience),
      account.companyName,
      input.expiresAt,
      next,
      nowSeconds(),
      editToken,
      account.id,
      id,
      input.revision,
    ),
    env.DB.prepare(
      "DELETE FROM campaign_parts WHERE owner_id=? AND campaign_id=? AND EXISTS(SELECT 1 FROM campaigns WHERE owner_id=? AND id=? AND status='draft' AND revision=? AND edit_token=?)",
    ).bind(account.id, id, account.id, id, next, editToken),
    ...compileParts(input.content, assets, null, account.companyName).map(
      (part) =>
        env.DB.prepare(
          `INSERT INTO campaign_parts(owner_id,campaign_id,ordinal,kind,text,asset_id)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaigns WHERE owner_id=? AND id=? AND status='draft' AND revision=? AND edit_token=?)`,
        ).bind(
          account.id,
          id,
          part.ordinal,
          part.kind,
          part.text,
          part.assetId,
          account.id,
          id,
          next,
          editToken,
        ),
    ),
  ]);
  if (!results[0]!.meta.changes)
    throw new HttpError(
      409,
      'This draft changed or was launched. Reload it before editing.',
    );
  return detailCampaign(account.id, id);
}
export async function listCampaigns(ownerId: string, url: URL) {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      size: z.coerce.number().int().min(1).max(50).default(20),
      archived: z.enum(['true', 'false']).default('false'),
    })
    .safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) throw new HttpError(400, 'Invalid campaign page.');
  const clause =
    q.data.archived === 'true' ? "status='archived'" : "status!='archived'";
  const total = await env.DB.prepare(
    `SELECT COUNT(*) n FROM campaigns WHERE owner_id=? AND ${clause} AND is_test=0`,
  )
    .bind(ownerId)
    .first<number>('n');
  const rows = await env.DB.prepare(
    `SELECT id,name,status,revision,audience_json audienceJson,scheduled_at scheduledAt,expires_at expiresAt,created_at createdAt,preparation_done preparationDone,
    (SELECT COUNT(*) FROM campaign_recipients r WHERE r.owner_id=campaigns.owner_id AND r.campaign_id=campaigns.id) recipients
    FROM campaigns WHERE owner_id=? AND ${clause} AND is_test=0 ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
  )
    .bind(ownerId, q.data.size, (q.data.page - 1) * q.data.size)
    .all<{ id: string; name: string; status: string; revision: number; audienceJson: string; scheduledAt: number | null; expiresAt: number | null; createdAt: number; preparationDone: number; recipients: number }>();
  const audiences = [...new Set(rows.results.filter(row => row.status === 'draft').map(row => row.audienceJson))];
  const counts = audiences.length ? await env.DB.batch<{ n: number }>(audiences.map(value => {
    const selection = audienceSelection(ownerId, JSON.parse(value) as Audience);
    return env.DB.prepare(`SELECT COUNT(*) n FROM (${selection.sql})`).bind(...selection.values);
  })) : [];
  const draftCounts = new Map(audiences.map((value, index) => [value, counts[index]!.results[0]!.n]));
  return {
    items: rows.results.map(({ audienceJson, ...campaign }) => ({
      ...campaign,
      leadCount: campaign.status === 'draft' ? draftCounts.get(audienceJson)! : campaign.recipients,
    })),
    total: total ?? 0,
    page: q.data.page,
    pages: Math.max(1, Math.ceil((total ?? 0) / q.data.size)),
  };
}
export async function deleteCampaign(account: Account, id: string, revision: number) {
  const campaign = await getCampaign(account.id, id);
  if (!['draft', 'completed', 'cancelled', 'archived'].includes(campaign.status))
    throw new HttpError(409, 'Cancel this campaign before deleting it.');
  const result = await env.DB.prepare(
    `DELETE FROM campaigns WHERE owner_id=? AND id=? AND revision=? AND status IN ('draft','completed','cancelled','archived')
    AND NOT EXISTS(SELECT 1 FROM campaign_send_attempts a JOIN campaign_messages m ON m.owner_id=a.owner_id AND m.id=a.message_id
      WHERE m.owner_id=campaigns.owner_id AND m.campaign_id=campaigns.id AND a.status IN ('submitting','unconfirmed'))`,
  ).bind(account.id, id, revision).run();
  if (!result.meta.changes)
    throw new HttpError(409, 'This campaign changed or has an unconfirmed send. Reload and resolve it before deleting.');
  return { deleted: true };
}
export async function detailCampaign(ownerId: string, id: string) {
  const campaign = await getCampaign(ownerId, id);
  const progress = await campaignProgress(ownerId, id, campaign);
  const assets = await env.DB.prepare(
    'SELECT a.id,a.kind,a.original_name name,a.mime,a.bytes,a.state,a.width,a.height,a.background FROM campaign_assets a JOIN campaign_parts p ON p.owner_id=a.owner_id AND p.asset_id=a.id WHERE p.owner_id=? AND p.campaign_id=? ORDER BY p.ordinal',
  )
    .bind(ownerId, id)
    .all();
  const connectedSender = await env.DB.prepare(
    'SELECT phone,status FROM whatsapp_connections WHERE owner_id=?',
  )
    .bind(ownerId)
    .first<{ phone: string | null; status: string }>();
  return {
    ...campaign,
    ...progress,
    connectedSender,
    tests: (
      await env.DB.prepare(
        "SELECT c.id,c.name,c.status,c.created_at createdAt,json_extract(a.evidence_json,'$.destination') destination FROM campaign_actions a JOIN campaigns c ON c.owner_id=a.owner_id AND c.id=json_extract(a.evidence_json,'$.testId') WHERE a.owner_id=? AND a.campaign_id=? AND a.action='test' ORDER BY a.created_at DESC LIMIT 10",
      )
        .bind(ownerId, id)
        .all<{
          id: string;
          name: string;
          status: string;
          createdAt: number;
          destination: string;
        }>()
    ).results,
    content: JSON.parse(campaign.content_json) as Content,
    audience: JSON.parse(campaign.audience_json) as Audience,
    assets: assets.results,
  };
}
type MessageCounts = {
  total: number; sent: number; pending: number; submitting: number; skipped: number;
  failed: number; unconfirmed: number; cancelled: number; delivered: number; read: number;
  nextDue: number | null;
};
export async function campaignProgress(ownerId: string, id: string, existing?: Campaign) {
  const campaign = existing ?? await getCampaign(ownerId, id);
  const [recipients, messages, recipientReasons, messageReasons, sender, replies, infrastructure] = await env.DB.batch([
    env.DB.prepare(`SELECT state,COUNT(*) count,SUM(prepared) prepared,
      SUM(totalParts>0 AND deliveredParts=totalParts) delivered
      FROM (${recipientStates} WHERE r.owner_id=? AND r.campaign_id=?) GROUP BY state`).bind(ownerId, id),
    env.DB.prepare(`SELECT COUNT(*) total,COALESCE(SUM(status='sent'),0) sent,
      COALESCE(SUM(status='pending'),0) pending,COALESCE(SUM(status='submitting'),0) submitting,
      COALESCE(SUM(status='skipped'),0) skipped,COALESCE(SUM(status='failed'),0) failed,
      COALESCE(SUM(status='unconfirmed'),0) unconfirmed,COALESCE(SUM(status='cancelled'),0) cancelled,
      COUNT(delivered_at) delivered,COUNT(read_at) read,
      MIN(CASE WHEN status='pending' THEN due_at END) nextDue
      FROM campaign_messages m WHERE owner_id=? AND campaign_id=?`).bind(ownerId, id),
    env.DB.prepare(`SELECT skip_reason reason,COUNT(*) count FROM campaign_recipients
      WHERE owner_id=? AND campaign_id=? AND skip_reason IS NOT NULL GROUP BY skip_reason ORDER BY count DESC,reason`).bind(ownerId, id),
    env.DB.prepare(`SELECT status,COALESCE(NULLIF(error,''),'Reason unavailable') reason,COUNT(*) count FROM campaign_messages
      WHERE owner_id=? AND campaign_id=? AND status IN ('skipped','failed') GROUP BY status,reason ORDER BY count DESC,reason`).bind(ownerId, id),
    env.DB.prepare(`SELECT phone,next_allowed_at nextAllowedAt,pause_reason pauseReason,budget_date budgetDate,
      consumed,reserved FROM sender_dispatch_state WHERE owner_id=?`).bind(ownerId),
    env.DB.prepare("SELECT COUNT(*) count FROM campaign_actions WHERE owner_id=? AND campaign_id=? AND action='reply'").bind(ownerId, id),
    env.DB.prepare("SELECT evidence_json FROM campaign_actions WHERE owner_id=? AND campaign_id=? AND action='infrastructure_failed' ORDER BY created_at DESC LIMIT 1").bind(ownerId, id),
  ]);
  const states = recipients.results as { state: string; count: number; prepared: number; delivered: number }[];
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    revision: campaign.revision,
    is_test: campaign.is_test,
    sender_phone: campaign.sender_phone,
    scheduled_at: campaign.scheduled_at,
    updated_at: campaign.updated_at,
    preparation_done: states.reduce((sum, row) => sum + row.prepared, 0),
    recipientTotal: states.reduce((sum, row) => sum + row.count, 0),
    recipientCounts: Object.fromEntries(states.map(row => [row.state, row.count])),
    messageCounts: messages.results[0] as MessageCounts,
    recipientSkipReasons: recipientReasons.results as { reason: string; count: number }[],
    messageReasons: messageReasons.results as { status: string; reason: string; count: number }[],
    sender: (sender.results[0] ?? null) as { phone: string; nextAllowedAt: number; pauseReason: string | null; budgetDate: string; consumed: number; reserved: number } | null,
    deliveredRecipients: states.reduce((sum, row) => sum + row.delivered, 0),
    replies: Number((replies.results[0] as { count: number } | undefined)?.count ?? 0),
    infrastructureFailure: (infrastructure.results[0] ?? null) as { evidence_json: string } | null,
    checkedAt: nowSeconds(),
  };
}
export const recipientStates = `SELECT r.*, CASE WHEN r.skip_reason IS NOT NULL THEN 'skipped'
  WHEN EXISTS(SELECT 1 FROM campaign_messages m WHERE m.recipient_id=r.id AND m.status='unconfirmed') THEN 'unconfirmed'
  WHEN EXISTS(SELECT 1 FROM campaign_messages m WHERE m.recipient_id=r.id AND m.status='submitting') THEN 'in_progress'
  WHEN NOT EXISTS(SELECT 1 FROM campaign_messages m WHERE m.recipient_id=r.id) THEN 'ready'
  WHEN NOT EXISTS(SELECT 1 FROM campaign_messages m WHERE m.recipient_id=r.id AND m.status!='sent') THEN 'fully_sent'
  WHEN EXISTS(SELECT 1 FROM campaign_messages m WHERE m.recipient_id=r.id AND m.status='sent') THEN 'partially_sent'
  WHEN EXISTS(SELECT 1 FROM campaign_messages m WHERE m.recipient_id=r.id AND m.status='failed') THEN 'failed'
  WHEN EXISTS(SELECT 1 FROM campaign_messages m WHERE m.recipient_id=r.id AND m.status='cancelled') THEN 'cancelled' ELSE 'queued' END state,
  (SELECT COUNT(*) FROM campaign_messages m WHERE m.recipient_id=r.id AND m.delivered_at IS NOT NULL) deliveredParts,
  (SELECT COUNT(*) FROM campaign_messages m WHERE m.recipient_id=r.id) totalParts FROM campaign_recipients r`;
export async function listRecipients(ownerId: string, id: string, url: URL) {
  await getCampaign(ownerId, id);
  const q = z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      size: z.coerce.number().int().min(1).max(50).default(20),
      state: z
        .enum([
          'all',
          'ready',
          'queued',
          'in_progress',
          'fully_sent',
          'partially_sent',
          'failed',
          'unconfirmed',
          'skipped',
          'cancelled',
        ])
        .default('all'),
    })
    .safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) throw new HttpError(400, 'Invalid recipient page.');
  const query = `SELECT * FROM (${recipientStates} WHERE r.owner_id=? AND r.campaign_id=?) ${q.data.state === 'all' ? '' : 'WHERE state=?'}`;
  const args = [ownerId, id, ...(q.data.state === 'all' ? [] : [q.data.state])];
  const total =
    (await env.DB.prepare(`SELECT COUNT(*) n FROM (${query})`)
      .bind(...args)
      .first<number>('n')) ?? 0;
  const rows = await env.DB.prepare(`${query} ORDER BY id LIMIT ? OFFSET ?`)
    .bind(...args, q.data.size, (q.data.page - 1) * q.data.size)
    .all<{ id: string; phone: string }>();
  const ids = rows.results.map((row) => row.id);
  const parts = await env.DB.prepare(
    'SELECT id,recipient_id,ordinal,kind,text,status,gateway_id,accepted_at,delivered_at,read_at,error FROM campaign_messages WHERE owner_id=? AND recipient_id IN (SELECT value FROM json_each(?)) ORDER BY ordinal',
  )
    .bind(ownerId, JSON.stringify(ids))
    .all<{ recipient_id: string }>();
  return {
    items: rows.results.map((row) => ({
      ...row,
      phone: row.phone.slice(2),
      parts: parts.results.filter((p) => p.recipient_id === row.id),
    })),
    total,
    page: q.data.page,
    pages: Math.max(1, Math.ceil(total / q.data.size)),
  };
}
export const actionInput = z
  .object({
    action: z.enum([
      'start',
      'schedule',
      'pause',
      'resume',
      'cancel',
      'duplicate',
      'archive',
      'resolve',
      'recover_part',
    ]),
    requestId: z.uuid(),
    revision: z.number().int().positive(),
    scheduledAt: z.number().int().positive().optional(),
    messageId: z.string().max(100).optional(),
    resolution: z.enum(['sent', 'unsent', 'failed']).optional(),
    evidence: z.string().trim().min(1).max(1000).optional(),
    gatewayId: z.string().max(200).optional(),
    assetId: z.uuid().optional(),
    acknowledgeDuplicateRisk: z.boolean().optional(),
  })
  .strict();
export type CampaignAction = z.infer<typeof actionInput>;
export async function dispatchOutbox() {
  const jobs = await env.DB.prepare(
    'SELECT id,owner_id,campaign_id,kind,work_id,available_at FROM campaign_outbox WHERE available_at<=unixepoch()+900 AND dispatch_until<=unixepoch() ORDER BY available_at,id LIMIT 30',
  ).all<{
    id: string;
    owner_id: string;
    campaign_id: string;
    kind: string;
    work_id: string;
    available_at: number;
  }>();
  for (const job of jobs.results) {
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      'UPDATE campaign_outbox SET dispatch_token=?,dispatch_until=unixepoch()+120 WHERE id=? AND dispatch_until<=unixepoch()',
    )
      .bind(token, job.id)
      .run();
    if (!claimed.meta.changes) continue;
    try {
      await env.CAMPAIGN_QUEUE.send(
        {
          kind: 'campaign',
          ownerId: job.owner_id,
          campaignId: job.campaign_id,
          workId: job.work_id,
          task: job.kind,
        },
        {
          delaySeconds: Math.max(
            0,
            Math.min(900, job.available_at - nowSeconds()),
          ),
        },
      );
    } catch {
      await env.DB.prepare(
        'UPDATE campaign_outbox SET dispatch_until=0 WHERE id=? AND dispatch_token=?',
      )
        .bind(job.id, token)
        .run();
    }
  }
}
export function outboxStatement(
  ownerId: string,
  campaignId: string,
  kind: 'prepare' | 'send',
  workId: string,
  due: number,
) {
  return env.DB.prepare(
    `INSERT INTO campaign_outbox(id,owner_id,campaign_id,kind,work_id,available_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET available_at=excluded.available_at,dispatch_until=0,dispatch_token=NULL`,
  ).bind(`${kind}:${workId}`, ownerId, campaignId, kind, workId, due);
}
async function previousAction(
  ownerId: string,
  id: string,
  input: CampaignAction,
) {
  const hash = await digest(JSON.stringify(input));
  const previous = await env.DB.prepare(
    'SELECT campaign_id,input_hash,evidence_json FROM campaign_actions WHERE owner_id=? AND request_id=?',
  )
    .bind(ownerId, input.requestId)
    .first<{
      campaign_id: string;
      input_hash: string;
      evidence_json: string;
    }>();
  if (previous && (previous.campaign_id !== id || previous.input_hash !== hash))
    throw new HttpError(
      409,
      'This request ID was already used for another action.',
    );
  return { previous, hash };
}
export async function campaignAction(
  account: Account,
  id: string,
  input: CampaignAction,
) {
  const { previous, hash } = await previousAction(account.id, id, input);
  if (previous) {
    const evidence = JSON.parse(previous.evidence_json);
    return detailCampaign(account.id, evidence.duplicateId ?? id);
  }
  const campaign = await getCampaign(account.id, id);
  if (campaign.revision !== input.revision)
    throw new HttpError(
      409,
      'This campaign changed. Reload before trying again.',
    );
  if (input.action === 'duplicate') {
    const copyId = crypto.randomUUID();
    const copy = await createDraft(
      account,
      {
        name: `${campaign.name.slice(0, 105)} (copy)`,
        content: JSON.parse(campaign.content_json),
        audience: JSON.parse(campaign.audience_json),
        expiresAt: null,
      },
      { parentId: id, input, hash, copyId },
    );
    return copy;
  }
  if (input.action === 'resolve' || input.action === 'recover_part')
    return resolvePart(account, campaign, input, hash);
  if (input.action === 'start' || input.action === 'schedule')
    return launch(account, campaign, input, hash);
  const allowed: Record<string, string[]> = {
    pause: ['running', 'scheduled'],
    resume: ['paused'],
    cancel: ['preparing', 'scheduled', 'running', 'paused'],
    archive: ['completed', 'cancelled', 'draft'],
  };
  if (!allowed[input.action]?.includes(campaign.status))
    throw new HttpError(409, 'That action is unavailable for this campaign.');
  if (input.action === 'resume') {
    const uncertain = await env.DB.prepare(
      "SELECT id FROM campaign_send_attempts WHERE owner_id=? AND status IN ('submitting','unconfirmed') LIMIT 1",
    )
      .bind(account.id)
      .first();
    if (uncertain)
      throw new HttpError(
        409,
        'Resolve the active or unconfirmed send before resuming.',
      );
    const state = await accountWhatsAppState(account);
    if (state.restriction) throw new HttpError(409, state.restriction.error);
    if (state.status !== 'WORKING' || state.phone !== campaign.sender_phone)
      throw new HttpError(
        409,
        'Reconnect the original campaign sender before resuming.',
      );
  }
  const target =
    input.action === 'pause'
      ? 'paused'
      : input.action === 'resume'
        ? (await env.DB.prepare(
            'SELECT id FROM campaign_recipients WHERE owner_id=? AND campaign_id=? AND prepared=0 LIMIT 1',
          )
            .bind(account.id, id)
            .first())
          ? 'preparing'
          : campaign.scheduled_at && campaign.scheduled_at > nowSeconds()
            ? 'scheduled'
            : 'running'
        : input.action === 'archive'
          ? 'archived'
          : 'cancelled';
  const actionId = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      'UPDATE campaigns SET status=?,updated_at=? WHERE owner_id=? AND id=? AND status=? AND revision=?',
    ).bind(
      target,
      nowSeconds(),
      account.id,
      id,
      campaign.status,
      input.revision,
    ),
    env.DB.prepare(
      `INSERT INTO campaign_actions(id,owner_id,campaign_id,actor,action,request_id,input_hash,evidence_json,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaigns WHERE owner_id=? AND id=? AND status=?)`,
    ).bind(
      actionId,
      account.id,
      id,
      account.phone,
      input.action,
      input.requestId,
      hash,
      JSON.stringify({ evidence: input.evidence }),
      nowSeconds(),
      account.id,
      id,
      target,
    ),
    ...(input.action === 'cancel'
      ? cancellationStatements(account.id, id)
      : []),
    ...(input.action === 'resume'
      ? [
          env.DB.prepare(
            'UPDATE sender_dispatch_state SET pause_reason=NULL WHERE owner_id=? AND active_attempt IS NULL',
          ).bind(account.id),
          ...(target === 'preparing'
            ? [outboxStatement(account.id, id, 'prepare', id, nowSeconds())]
            : [env.DB.prepare(`INSERT INTO campaign_outbox(id,owner_id,campaign_id,kind,work_id,available_at)
                SELECT 'send:'||m.id,m.owner_id,m.campaign_id,'send',m.id,MAX(m.due_at,?) FROM campaign_messages m
                WHERE m.owner_id=? AND m.campaign_id=? AND m.status='pending'
                AND NOT EXISTS(SELECT 1 FROM campaign_messages p WHERE p.recipient_id=m.recipient_id AND p.ordinal<m.ordinal AND p.status!='sent')
                AND EXISTS(SELECT 1 FROM campaign_actions WHERE id=?)
                ON CONFLICT(id) DO UPDATE SET dispatch_until=0,available_at=excluded.available_at`)
                .bind(campaign.scheduled_at ?? nowSeconds(), account.id, id, actionId)]),
        ]
      : []),
  ]);
  if (!results[0]!.meta.changes)
    throw new HttpError(409, 'The campaign changed. Reload it.');
  await dispatchOutbox();
  return detailCampaign(account.id, id);
}
export function cancellationStatements(ownerId: string, id: string) {
  return [
    env.DB.prepare(
      "UPDATE campaign_messages SET status='cancelled',error='Campaign cancelled' WHERE owner_id=? AND campaign_id=? AND status='pending'",
    ).bind(ownerId, id),
    env.DB.prepare(
      'UPDATE sender_dispatch_state SET active_recipient=CASE WHEN active_attempt IS NULL AND active_recipient IN (SELECT id FROM campaign_recipients WHERE owner_id=? AND campaign_id=?) THEN NULL ELSE active_recipient END,reserved=MAX(0,reserved-COALESCE((SELECT SUM(reserved) FROM campaign_recipients WHERE owner_id=? AND campaign_id=? AND budget_date=sender_dispatch_state.budget_date),0)) WHERE owner_id=?',
    ).bind(ownerId, id, ownerId, id, ownerId),
    env.DB.prepare(
      'UPDATE campaign_recipients SET reserved=0 WHERE owner_id=? AND campaign_id=?',
    ).bind(ownerId, id),
    env.DB.prepare(
      `UPDATE lead_contact_state SET active_recipient=NULL WHERE owner_id=? AND active_recipient IN (SELECT id FROM campaign_recipients WHERE owner_id=? AND campaign_id=?)
      AND NOT EXISTS(SELECT 1 FROM campaign_messages WHERE recipient_id=active_recipient AND status IN ('submitting','unconfirmed'))`,
    ).bind(ownerId, ownerId, id),
    env.DB.prepare(
      'DELETE FROM campaign_outbox WHERE owner_id=? AND campaign_id=?',
    ).bind(ownerId, id),
  ];
}
async function launch(
  account: Account,
  campaign: Campaign,
  input: CampaignAction,
  hash: string,
) {
  if (campaign.status !== 'draft')
    throw new HttpError(409, 'Only a draft can be launched.');
  const state = await accountWhatsAppState(account);
  if (state.restriction) throw new HttpError(409, state.restriction.error);
  if (state.status !== 'WORKING' || !state.phone)
    throw new HttpError(409, 'Connect WhatsApp before launching.');
  const due = input.action === 'schedule' ? input.scheduledAt : nowSeconds();
  if (!due || (input.action === 'schedule' && due <= nowSeconds()))
    throw new HttpError(400, 'Choose a future launch time.');
  const selection = audienceSelection(
    account.id,
    JSON.parse(campaign.audience_json),
  );
  const preview = await previewAudience(
    account.id,
    JSON.parse(campaign.audience_json),
  );
  if (!preview.total)
    throw new HttpError(400, 'No qualifying leads match this audience.');
  const actionId = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE campaigns SET status='preparing',sender_phone=?,scheduled_at=?,launch_status=?,updated_at=? WHERE owner_id=? AND id=? AND status='draft' AND revision=?`,
    ).bind(
      state.phone,
      due,
      input.action === 'schedule' ? 'scheduled' : 'running',
      nowSeconds(),
      account.id,
      campaign.id,
      input.revision,
    ),
    env.DB.prepare(
      `INSERT INTO campaign_actions(id,owner_id,campaign_id,actor,action,request_id,input_hash,evidence_json,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaigns WHERE owner_id=? AND id=? AND status='preparing' AND revision=?)`,
    ).bind(
      actionId,
      account.id,
      campaign.id,
      account.phone,
      input.action,
      input.requestId,
      hash,
      '{}',
      nowSeconds(),
      account.id,
      campaign.id,
      input.revision,
    ),
    env.DB.prepare(
      `INSERT INTO campaign_recipients(id,owner_id,campaign_id,lead_id,phone,name,chat_id,evidence_json,skip_reason,reasons_json)
      SELECT lower(hex(randomblob(16))),?,?,id,phone,name,chatId,json_object('sources',sources,'deliveries',deliveryCount,'latestDelivery',latestDelivery,'parcelValue',totalParcelValue,'excluded',excluded,'whatsappCheckedAt',whatsappCheckedAt),${reasonSql},
      json_array(CASE WHEN excluded=1 THEN 'excluded' END,
      CASE WHEN whatsappExists=0 THEN 'no_whatsapp' WHEN whatsappExists IS NOT 1 OR chatId IS NULL OR whatsappCheckedAt IS NULL OR whatsappCheckedAt<unixepoch()-604800 THEN 'not_verified' END,CASE WHEN nextAllowedAt>unixepoch() THEN 'cooldown' END)
      FROM (${selection.sql}) WHERE EXISTS(SELECT 1 FROM campaign_actions WHERE id=?)`,
    ).bind(account.id, campaign.id, ...selection.values, actionId),
    env.DB.prepare(
      `INSERT INTO campaign_outbox(id,owner_id,campaign_id,kind,work_id,available_at) SELECT ?,?,?,'prepare',?,? WHERE EXISTS(SELECT 1 FROM campaign_actions WHERE id=?)`,
    ).bind(
      `prepare:${campaign.id}`,
      account.id,
      campaign.id,
      campaign.id,
      nowSeconds(),
      actionId,
    ),
  ]);
  if (!results[0]!.meta.changes)
    throw new HttpError(409, 'This draft was already launched or changed.');
  await dispatchOutbox();
  return detailCampaign(account.id, campaign.id);
}
async function resolvePart(
  account: Account,
  campaign: Campaign,
  input: CampaignAction,
  hash: string,
) {
  if (!input.messageId || !input.evidence)
    throw new HttpError(400, 'Choose a part and record the recovery evidence.');
  const message = await env.DB.prepare(
    'SELECT * FROM campaign_messages WHERE owner_id=? AND campaign_id=? AND id=?',
  )
    .bind(account.id, campaign.id, input.messageId)
    .first<{
      id: string;
      status: string;
      lease_until: number;
      lease_token: string | null;
      recipient_id: string;
      ordinal: number;
      kind: string;
      asset_id: string | null;
    }>();
  if (!message) throw new HttpError(404, 'Message part not found.');
  if (message.status === 'submitting' || message.lease_until > nowSeconds())
    throw new HttpError(
      409,
      'Wait for the active request to finish before resolving it.',
    );
  const recovery = input.action === 'recover_part';
  let target: string,
    evidence: Record<string, unknown> = {
      evidence: input.evidence,
      resolution: input.resolution,
      duplicateRisk: !!input.acknowledgeDuplicateRisk,
    };
  if (recovery) {
    if (message.status !== 'failed' || !input.assetId)
      throw new HttpError(
        409,
        'Only a definitively failed attachment can use a recovery asset.',
      );
    if (['cancelled', 'archived'].includes(campaign.status))
      throw new HttpError(409, 'Duplicate this campaign to send new content.');
    const asset = await env.DB.prepare(
      "SELECT kind FROM campaign_assets WHERE owner_id=? AND id=? AND state='ready'",
    )
      .bind(account.id, input.assetId)
      .first<{ kind: string }>();
    if (!asset || asset.kind !== message.kind)
      throw new HttpError(400, 'Use a prepared attachment of the same type.');
    target = 'pending';
    evidence = {
      ...evidence,
      originalAssetId: message.asset_id,
      recoveryAssetId: input.assetId,
    };
  } else {
    if (message.status !== 'unconfirmed' || !input.resolution)
      throw new HttpError(
        409,
        'Choose an unconfirmed part and its confirmed outcome.',
      );
    if (input.resolution === 'unsent' && !input.acknowledgeDuplicateRisk)
      throw new HttpError(
        400,
        'Acknowledge the possible duplicate before deliberately retrying an unconfirmed send.',
      );
    if (
      input.resolution === 'unsent' &&
      ['cancelled', 'archived'].includes(campaign.status)
    )
      throw new HttpError(409, 'Duplicate this campaign to send new content.');
    if (input.resolution === 'sent' && !input.gatewayId)
      throw new HttpError(400, 'Record the verified gateway message ID.');
    target =
      input.resolution === 'sent'
        ? 'sent'
        : input.resolution === 'unsent'
          ? 'pending'
          : 'failed';
  }
  const token = crypto.randomUUID(),
    due = nowSeconds() + 60;
  const fence =
    'EXISTS(SELECT 1 FROM campaign_messages WHERE owner_id=? AND id=? AND lease_token=?)';
  const args = [account.id, message.id, token];
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE campaign_messages SET status=?,asset_id=?,gateway_id=?,accepted_at=CASE WHEN ?='sent' THEN unixepoch() ELSE accepted_at END,lease_token=?,lease_until=0,error=NULL,due_at=? WHERE owner_id=? AND id=? AND status=? AND lease_until<=unixepoch()`,
    ).bind(
      target,
      recovery ? input.assetId! : message.asset_id,
      input.gatewayId ?? null,
      target,
      token,
      due,
      account.id,
      message.id,
      recovery ? 'failed' : 'unconfirmed',
    ),
    env.DB.prepare(
      `INSERT INTO campaign_actions(id,owner_id,campaign_id,actor,action,request_id,input_hash,evidence_json,created_at) SELECT ?,?,?,?,?,?,?,?,unixepoch() WHERE ${fence}`,
    ).bind(
      crypto.randomUUID(),
      account.id,
      campaign.id,
      account.phone,
      input.action,
      input.requestId,
      hash,
      JSON.stringify(evidence),
      ...args,
    ),
    ...(!recovery
      ? [
          env.DB.prepare(
            `UPDATE campaign_send_attempts SET status=?,resolution_json=?,finished_at=unixepoch() WHERE owner_id=? AND message_id=? AND status='unconfirmed' AND ${fence}`,
          ).bind(
            target === 'sent' ? 'resolved_sent' : 'resolved_unsent',
            JSON.stringify({
              ...evidence,
              actor: account.phone,
              outcome: input.resolution,
            }),
            account.id,
            message.id,
            ...args,
          ),
          env.DB.prepare(
            `UPDATE sender_dispatch_state SET active_attempt=NULL,lease_until=0,next_allowed_at=unixepoch()+60 WHERE owner_id=? AND active_attempt=? AND ${fence}`,
          ).bind(account.id, message.lease_token, ...args),
          ...(target === 'sent'
            ? [
                env.DB.prepare(
                  `UPDATE lead_contact_state SET last_contact_at=unixepoch(),next_allowed_at=unixepoch()+604800 WHERE owner_id=? AND lead_id=(SELECT lead_id FROM campaign_recipients WHERE owner_id=? AND id=?) AND ${fence}`,
                ).bind(account.id, account.id, message.recipient_id, ...args),
              ]
            : []),
          ...(target === 'failed'
            ? [
                env.DB.prepare(
                  `UPDATE campaign_messages SET status='skipped',error='Previous part failed' WHERE owner_id=? AND recipient_id=? AND ordinal>? AND status='pending' AND ${fence}`,
                ).bind(
                  account.id,
                  message.recipient_id,
                  message.ordinal,
                  ...args,
                ),
              ]
            : []),
        ]
      : [
          env.DB.prepare(
            `UPDATE campaign_messages SET status='pending',error=NULL,due_at=? WHERE owner_id=? AND recipient_id=? AND ordinal>? AND status='skipped' AND error='Previous part failed' AND ${fence}`,
          ).bind(
            due,
            account.id,
            message.recipient_id,
            message.ordinal,
            ...args,
          ),
        ]),
    env.DB.prepare(
      `UPDATE campaigns SET status='paused' WHERE owner_id=? AND id=? AND status='completed' AND ${fence}`,
    ).bind(account.id, campaign.id, ...args),
  ]);
  if (!results[0]!.meta.changes)
    throw new HttpError(
      409,
      'This part was already resolved. Reload its history.',
    );
  const next = await env.DB.prepare(
    "SELECT id FROM campaign_messages WHERE owner_id=? AND recipient_id=? AND status='pending' ORDER BY ordinal LIMIT 1",
  )
    .bind(account.id, message.recipient_id)
    .first<{ id: string }>();
  if (next)
    await env.DB.batch([
      outboxStatement(account.id, campaign.id, 'send', next.id, due),
    ]);
  else {
    const recipient = await env.DB.prepare(
      'SELECT id,lead_id FROM campaign_recipients WHERE owner_id=? AND id=?',
    )
      .bind(account.id, message.recipient_id)
      .first<{ id: string; lead_id: string | null }>();
    if (recipient) {
      const { releaseSequence } = await import('./campaign-delivery');
      await releaseSequence(account.id, recipient);
    }
  }
  if (target === 'sent') {
    const { reconcileMessageEvents } = await import('./campaign-events');
    await reconcileMessageEvents(account.id, input.gatewayId!);
  }
  return detailCampaign(account.id, campaign.id);
}
